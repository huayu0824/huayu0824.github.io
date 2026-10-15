/**
 * 博客后台 Worker
 *
 *   /auth/*        GitHub OAuth 登录，只放行配置里的账号
 *   /api/posts     文章 CRUD   → content/posts/<YYYY-MM-DD-slug>/index.md
 *   /api/flows     随笔 CRUD   → content/flows/YYYY/MM/DD.md
 *   /api/upload    图片上传     → 文章目录的 images/ 下
 *
 * 保存即向仓库提交一次 commit，GitHub Actions 随即重新构建部署。
 *
 * 关于并发额度：Cloudflare 免费版每次请求最多 50 个子请求，
 * 所以列表接口分页取数（默认一次 40 篇），并用进程内缓存复用目录树。
 */

import {
    COOKIE_NAME,
    clearSessionCookie,
    readCookie,
    sessionCookie,
    signSession,
    verifySession,
} from "./session.js";
import * as md from "./markdown.js";
import * as c from "./content.js";
import {
    GitHubError,
    deleteDir,
    deleteFile,
    getFile,
    getUser,
    listTree,
    mapLimit,
    optionalEnv,
    putBinaryFile,
    putFile,
} from "./github.js";

const SESSION_TTL = 60 * 60 * 24 * 14;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_PAGE = 40;
const MAX_PAGE = 40;
const TREE_TTL_MS = 60_000;
const AUTHOR_FALLBACK = "花羽";

const IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
};

/** 进程内缓存：目录树与列表解析结果，写操作后立即失效 */
const cache = { tree: null, treeAt: 0, list: new Map() };

export default {
    async fetch(request, workerEnv, ctx) {
        globalThis.__env = workerEnv;

        const url = new URL(request.url);
        try {
            if (url.pathname.startsWith("/api/")) return await handleApi(request, url, workerEnv);
            if (url.pathname.startsWith("/auth/")) return await handleAuth(request, url, workerEnv);
        } catch (err) {
            console.error("unhandled", err);
            return json({ error: describe(err) }, err instanceof GitHubError ? err.status : 500);
        }

        if (workerEnv.ASSETS) return workerEnv.ASSETS.fetch(request);
        return new Response("Not Found", { status: 404 });
    },
};

/* ------------------------------------------------------------ 返回值约定 */

/**
 * 处理函数一律返回 { __resp, status, data } 或普通对象，
 * 由 respond() 统一序列化一次。
 *
 * 踩过的坑：处理函数若直接返回 Response，而路由又用 json() 包一层，
 * Response 会被序列化成 {}、状态码被吞成 200，所有错误提示都丢了。
 */
function fail(status, message) {
    return { __resp: true, status, data: { error: message } };
}

function ok(data, status = 200) {
    return { __resp: true, status, data };
}

function respond(result) {
    if (result && result.__resp) return json(result.data, result.status);
    return json(result);
}

/* ------------------------------------------------------------------ 认证 */

async function handleAuth(request, url, env) {
    const path = url.pathname;

    if (path === "/auth/login") {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
            return html(
                "<h1>后台未完成配置</h1><p>请在 Cloudflare 上设置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、SESSION_SECRET 三个 secret。</p>",
                500
            );
        }

        const state = randomToken();
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
        // public_repo：只有公开仓库才需要；仓库转私有时改成 repo
        authorize.searchParams.set("scope", env.GITHUB_SCOPE || "public_repo");
        authorize.searchParams.set("state", state);

        return new Response(null, {
            status: 302,
            headers: {
                Location: authorize.toString(),
                "Set-Cookie": sessionCookie(
                    await signSession({ purpose: "oauth_state", state }, env.SESSION_SECRET),
                    600
                ),
            },
        });
    }

    if (path === "/auth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        const saved = await verifySession(readCookie(request), env.SESSION_SECRET);
        if (!code || !state || !saved || saved.purpose !== "oauth_state" || saved.state !== state) {
            return html("<h1>登录失败</h1><p>state 校验未通过，请回到后台重新发起登录。</p>", 400);
        }

        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                client_id: env.GITHUB_CLIENT_ID,
                client_secret: env.GITHUB_CLIENT_SECRET,
                code,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            return html(`<h1>登录失败</h1><p>${escapeHtml(tokenData.error_description || "未获取到访问令牌")}</p>`, 400);
        }

        const profile = await getUser(tokenData.access_token);

        // 只放行配置里列出的账号，避免任何能登录 GitHub 的人写你的博客
        const allow = allowedLogins(env);
        if (allow.length && !allow.includes(String(profile.login).toLowerCase())) {
            return html(
                `<h1>没有访问权限</h1><p>当前登录的是 <code>${escapeHtml(profile.login)}</code>，` +
                `后台只对 ${allow.map(escapeHtml).join("、")} 开放。</p>`,
                403
            );
        }

        const now = Math.floor(Date.now() / 1000);
        const session = await signSession(
            {
                login: profile.login,
                name: profile.name || profile.login,
                avatar: profile.avatar_url,
                token: tokenData.access_token,
                iat: now,
                exp: now + SESSION_TTL,
            },
            env.SESSION_SECRET
        );

        return new Response(null, {
            status: 302,
            headers: { Location: "/", "Set-Cookie": sessionCookie(session, SESSION_TTL) },
        });
    }

    if (path === "/auth/logout") {
        return new Response(null, {
            status: 302,
            headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
        });
    }

    return new Response("Not Found", { status: 404 });
}

/* -------------------------------------------------------------------- API */

async function handleApi(request, url, env) {
    const session = await verifySession(readCookie(request), env.SESSION_SECRET);
    if (!session || !session.token) return json({ error: "未登录" }, 401);

    const path = url.pathname;
    const token = session.token;

    if (path === "/api/session") {
        return json({
            login: session.login,
            name: session.name,
            avatar: session.avatar,
            repo: `${optionalEnv("GITHUB_OWNER")}/${optionalEnv("GITHUB_REPO")}`,
            branch: optionalEnv("GITHUB_BRANCH"),
            defaultAuthor: optionalEnv("DEFAULT_AUTHOR") || AUTHOR_FALLBACK,
        });
    }

    /* ------------------------------------------------------------- 文章 */

    if (path === "/api/posts") {
        if (request.method === "GET") {
            return respond(await listPosts(token, url));
        }
        return respond(await savePost(token, null, await readBody(request)));
    }

    const postMatch = path.match(/^\/api\/posts\/([^/]+)$/);
    if (postMatch) {
        const slug = decodeURIComponent(postMatch[1]);
        if (!c.isValidSlug(slug)) return respond(fail(400, "slug 只能包含字母、数字和连字符"));

        if (request.method === "GET") return respond(await getPost(token, slug));
        if (request.method === "PUT") return respond(await savePost(token, slug, await readBody(request)));
        if (request.method === "DELETE") return respond(await removePost(token, slug));
    }

    /* ------------------------------------------------------------- 随笔 */

    if (path === "/api/flows" && request.method === "GET") {
        return respond(await listFlows(token, url));
    }

    const flowMatch = path.match(/^\/api\/flows\/([^/]+)$/);
    if (flowMatch) {
        const date = decodeURIComponent(flowMatch[1]);
        if (!c.isValidDate(date)) return respond(fail(400, "日期格式应为 YYYY-MM-DD"));

        if (request.method === "GET") return respond(await getFlow(token, date));
        if (request.method === "PUT") return respond(await saveFlow(token, date, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeFlow(token, date));
    }

    /* ------------------------------------------------------------- 上传 */

    if (path === "/api/upload" && request.method === "POST") {
        return respond(await handleUpload(request, token));
    }

    return respond(fail(404, "接口不存在"));
}

/* -------------------------------------------------------------- 目录树 */

async function getTree(token, { fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && cache.tree && now - cache.treeAt < TREE_TTL_MS) return cache.tree;

    const { entries, truncated } = await listTree(token);
    const paths = entries.map((e) => ({ path: e.path, type: e.type, sha: e.sha }));
    const tree = { ...c.parseTreePaths(paths), truncated, byPath: new Map(paths.map((p) => [p.path, p])) };
    cache.tree = tree;
    cache.treeAt = now;
    cache.list.clear();
    return tree;
}

function invalidate() {
    cache.tree = null;
    cache.treeAt = 0;
    cache.list.clear();
}

function paging(url) {
    const limit = Math.min(
        MAX_PAGE,
        Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_PAGE)
    );
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    return { limit, offset };
}

/* ---------------------------------------------------------------- 文章 */

async function listPosts(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const slice = tree.posts.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `p:${entry.dirName}`);
        if (!parsed) return null;
        return { ...entry, ...md.postSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: tree.posts.length,
        offset,
        limit,
        truncated: tree.truncated,
    };
}

async function getPost(token, slug) {
    const tree = await getTree(token);
    const entry = tree.posts.find((p) => p.slug === slug);
    if (!entry) return fail(404, "文章不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `p:${entry.dirName}`);
    if (!parsed) return fail(500, "读取文章失败");

    return {
        slug,
        dirName: entry.dirName,
        date: parsed.data.date || entry.date,
        ...md.postSummary(parsed.data, parsed.body),
        redirectFrom: Array.isArray(parsed.data.redirectFrom) ? parsed.data.redirectFrom : [],
        content: parsed.body,
        path: entry.path,
    };
}

async function savePost(token, slugFromUrl, input) {
    const date = String(input.date || "").trim();
    // 以表单里的 slug 为准（允许改 slug 做重命名），URL 上的只作为兜底
    const slug = String(input.slug || slugFromUrl || "").trim();

    if (!c.isValidDate(date)) return fail(400, "请填写正确的发布日期（YYYY-MM-DD）");
    if (!c.isValidSlug(slug)) {
        return fail(400, "slug 只能包含小写字母、数字和连字符");
    }

    const tree = await getTree(token);
    const dirName = c.postDirName(date, slug);
    const path = c.postPath(dirName);

    // 新目录命中就续写；否则按旧 slug 找（改了日期或 slug 时目录名会变）
    let prior = tree.posts.find((p) => p.dirName === dirName) || null;
    if (!prior && slugFromUrl) {
        const moved = tree.posts.find((p) => p.slug === slugFromUrl && p.dirName !== dirName);
        if (moved) prior = moved;
    }

    let sha;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(prior.path, prior.sha, token, `p:${prior.dirName}`);
        if (parsed) {
            existing = parsed;
            sha = prior.sha;
        }
    }

    const data = md.applyPostMeta(existing.data, { ...input, date });
    const raw = md.stringify(data, input.content ?? existing.body);
    const title = data.title || slug;

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "发布"}文章：${title}`,
    });

    // 改名或改日期后，旧目录要清掉，否则仓库里会留下永远访问不到的孤儿文章
    let movedFrom = null;
    if (prior && prior.dirName !== dirName) {
        movedFrom = prior.dirName;
        await deleteDir(
            `content/posts/${movedFrom}`,
            token,
            `重命名文章：${prior.slug} → ${slug}`
        ).catch((err) => console.error("清理旧目录失败", movedFrom, err));
    }

    invalidate();

    return {
        ok: true,
        slug,
        dirName,
        date,
        created: !sha,
        renamed: Boolean(movedFrom),
        message: sha ? "已保存，站点约 1 分钟后更新" : "已创建，站点约 1 分钟后更新",
        data,
    };
}

async function removePost(token, slug) {
    const tree = await getTree(token);
    const entry = tree.posts.find((p) => p.slug === slug);
    if (!entry) return fail(404, "文章不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `p:${entry.dirName}`);
    const title = (parsed && parsed.data.title) || entry.slug;

    // 整目录删，避免把随文图片留在仓库里变成孤儿文件
    const removed = await deleteDir(
        `content/posts/${entry.dirName}`,
        token,
        `删除文章：${title}`
    );

    invalidate();
    return { ok: true, removed, message: `已删除 ${removed} 个文件，站点约 1 分钟后更新` };
}

/* ---------------------------------------------------------------- 随笔 */

async function listFlows(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const slice = tree.flows.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `f:${entry.date}`);
        if (!parsed) return null;
        return { date: entry.date, folder: Boolean(entry.folderPath), ...md.flowSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: tree.flows.length,
        offset,
        limit,
        truncated: tree.truncated,
    };
}

/** 定位某个日期的随笔文件路径；不存在返回 null */
function findFlowPath(tree, date) {
    const entry = tree.flows.find((f) => f.date === date);
    if (!entry) return null;
    return { path: entry.path, sha: entry.sha, folder: Boolean(entry.folderPath) };
}

async function getFlow(token, date) {
    const tree = await getTree(token);
    const hit = findFlowPath(tree, date);
    if (!hit) return fail(404, "随笔不存在");

    const parsed = await readEntry(hit.path, hit.sha, token, `f:${date}`);
    if (!parsed) return fail(500, "读取随笔失败");

    return {
        date,
        folder: hit.folder,
        ...md.flowSummary(parsed.data, parsed.body),
        content: parsed.body,
        path: hit.path,
    };
}

async function saveFlow(token, date, input) {
    if (!c.isValidDate(date)) return fail(400, "日期格式应为 YYYY-MM-DD");

    const tree = await getTree(token);
    const hit = findFlowPath(tree, date);

    // 已存在的随笔就地编辑，保持原来的存储形式，避免平白改写用户文件
    const targetPath = hit ? hit.path : c.flowNewPath(date);
    let sha = hit ? hit.sha : undefined;
    let existing = { data: {}, body: "" };

    if (hit) {
        const parsed = await readEntry(hit.path, hit.sha, token, `f:${date}`);
        if (parsed) existing = parsed;
    }

    const data = md.applyFlowMeta(existing.data, { ...input, date });
    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(targetPath, raw, token, {
        sha,
        message: `${sha ? "更新" : "写"}随笔：${date}`,
    });

    invalidate();

    return {
        ok: true,
        date,
        path: targetPath,
        created: !sha,
        message: sha ? "随笔已保存" : "随笔已创建",
        data,
    };
}

async function removeFlow(token, date) {
    const tree = await getTree(token);
    const hit = findFlowPath(tree, date);
    if (!hit) return fail(404, "随笔不存在");

    if (hit.folder) {
        await deleteDir(`content/flows/${date.slice(0, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}`, token, `删除随笔：${date}`);
    } else {
        await deleteFile(hit.path, token, { sha: hit.sha, message: `删除随笔：${date}` });
    }

    invalidate();
    return { ok: true, message: "随笔已删除" };
}

/* ------------------------------------------------------------------ 读取 */

async function readEntry(path, sha, token, cacheKey) {
    if (cacheKey && cache.list.has(cacheKey)) return cache.list.get(cacheKey);

    let result = null;
    try {
        const file = await getFile(path, token);
        if (file) result = md.parse(file.text);
    } catch (err) {
        console.error("读取失败", path, err);
        result = null;
    }

    if (cacheKey) cache.list.set(cacheKey, result);
    return result;
}

/* ------------------------------------------------------------------ 上传 */

async function handleUpload(request, token) {
    const body = await request.json();
    const mime = String(body.contentType || "");
    const ext = IMAGE_TYPES[mime];
    if (!ext) {
        return fail(400, `不支持的图片格式：${mime || "未知"}。可用：PNG / JPG / WebP / GIF / SVG`);
    }

    const dataUrl = String(body.data || "");
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) return fail(400, "图片数据格式不正确");

    let bytes;
    try {
        bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
    } catch {
        return fail(400, "图片数据解码失败");
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return fail(400, `图片超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限`);
    }

    const scope = body.scope === "flow" ? "flow" : body.scope === "post" ? "post" : "site";
    const path = c.uploadPath({
        scope,
        date: body.date,
        slug: body.slug,
        filename: body.filename,
        ext,
    });

    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);

    await putBinaryFile(path, btoa(bin), token, { message: `上传图片：${path.split("/").pop()}` });
    invalidate();

    return { ok: true, path, url: c.publicUrlFor(path) };
}

/* ------------------------------------------------------------------ 工具 */

async function readBody(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function allowedLogins(env) {
    return String(env.ALLOWED_LOGINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
}

function html(body, status = 200) {
    return new Response(
        `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<title>博客后台</title><style>
                body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
                     max-width:34rem;margin:12vh auto;padding:0 1.5rem;line-height:1.7;color:#222}
                code{background:#f2f2f2;padding:.15em .4em;border-radius:4px}
            </style></head><body>${body}</body></html>`,
        { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
}

function randomToken(len = 24) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
}

function describe(err) {
    if (err instanceof GitHubError) return `GitHub：${err.message}`;
    return err?.message || "服务器内部错误";
}
