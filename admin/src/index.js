/**
 * 博客后台 Worker
 *
 *   /auth/*        GitHub OAuth 登录，只放行配置里的账号
 *   /api/posts     文章 CRUD   → content/posts/<YYYY-MM-DD-slug>/index.md
 *   /api/flows     随笔 CRUD   → content/flows/YYYY/MM/DD.md
 *   /api/notes     笔记 CRUD   → content/notes/<slug>.md（扁平单文件）
 *   /api/series    系列 CRUD   → content/series/<slug>/index.md
 *   /api/books     书籍 CRUD   → content/books/<slug>/index.md + 章节文件
 *   /api/pages     页面 CRUD   → content/<name>.md
 *   /api/history   某文件的提交历史 + 回滚
 *   /api/images    图片库列举与删除
 *   /api/batch     批量操作（删除 / 转草稿）
 *   /api/upload    图片上传     → 文章目录的 images/ 下
 *
 * 保存即向仓库提交一次 commit，GitHub Actions 随即重新构建部署。
 *
 * 关于并发额度：Cloudflare 免费版每次请求最多 50 个子请求，
 * 所以列表接口分页取数（默认一次 40 篇），并用进程内缓存复用目录树；
 * 涉及多个文件的写操作走 Git Data API，无论几个文件都只花 5 次请求。
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
    commitFiles,
    deleteDir,
    deleteFile,
    getFile,
    getFileAtRef,
    getUser,
    listCommits,
    listTree,
    mapLimit,
    optionalEnv,
    putBinaryFile,
    putFile,
    searchFiles,
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

        if (workerEnv.ASSETS) return await serveAsset(request, url, workerEnv);
        return new Response("Not Found", { status: 404 });
    },
};

/**
 * 静态资源默认会被浏览器缓存住。
 * 后台改完前端重新部署后，浏览器若还拿着旧版 app.js，界面就会莫名其妙失效
 * （字段不显示、按钮没反应），而且极难排查。
 * 所以后台自己的 html / js / css 一律 no-store，拿到的一定是最新版本。
 */
async function serveAsset(request, url, workerEnv) {
    const res = await workerEnv.ASSETS.fetch(request);
    if (!/\.(?:html|js|css)$/.test(url.pathname)) return res;

    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-store, must-revalidate");
    return out;
}

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
        if (request.method === "GET") return respond(await listPosts(token, url));
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

    if (path === "/api/flows") {
        if (request.method === "GET") return respond(await listFlows(token, url));
        return respond(await saveFlow(token, null, await readBody(request)));
    }

    const flowMatch = path.match(/^\/api\/flows\/([^/]+)$/);
    if (flowMatch) {
        const date = decodeURIComponent(flowMatch[1]);
        if (!c.isValidDate(date)) return respond(fail(400, "日期格式应为 YYYY-MM-DD"));

        if (request.method === "GET") return respond(await getFlow(token, date));
        if (request.method === "PUT") return respond(await saveFlow(token, date, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeFlow(token, date));
    }

    /* ------------------------------------------------------------- 笔记 */

    if (path === "/api/notes") {
        if (request.method === "GET") return respond(await listNotes(token, url));
        return respond(await saveNote(token, null, await readBody(request)));
    }

    const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
    if (noteMatch) {
        const slug = decodeURIComponent(noteMatch[1]);
        if (!c.isValidSlug(slug)) return respond(fail(400, "slug 只能包含字母、数字和连字符"));

        if (request.method === "GET") return respond(await getNote(token, slug));
        if (request.method === "PUT") return respond(await saveNote(token, slug, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeNote(token, slug));
    }

    /* ------------------------------------------------------------- 系列 */

    if (path === "/api/series") {
        if (request.method === "GET") return respond(await listSeries(token, url));
        return respond(await saveSeries(token, null, await readBody(request)));
    }

    const seriesMatch = path.match(/^\/api\/series\/([^/]+)$/);
    if (seriesMatch) {
        const slug = decodeURIComponent(seriesMatch[1]);
        if (!c.isValidSlug(slug)) return respond(fail(400, "slug 只能包含字母、数字和连字符"));

        if (request.method === "GET") return respond(await getSeries(token, slug));
        if (request.method === "PUT") return respond(await saveSeries(token, slug, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeSeries(token, slug));
    }

    // 关联文章：改的是每篇文章 front matter 的 series 字段，一次提交搞定
    const seriesPostsMatch = path.match(/^\/api\/series\/([^/]+)\/posts$/);
    if (seriesPostsMatch && request.method === "PUT") {
        const slug = decodeURIComponent(seriesPostsMatch[1]);
        return respond(await setSeriesMembers(token, slug, await readBody(request)));
    }

    /* ------------------------------------------------------------- 书籍 */

    if (path === "/api/books") {
        if (request.method === "GET") return respond(await listBooks(token, url));
        return respond(await saveBook(token, null, await readBody(request)));
    }

    const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
    if (bookMatch) {
        const slug = decodeURIComponent(bookMatch[1]);
        if (!c.isValidSlug(slug)) return respond(fail(400, "slug 只能包含字母、数字和连字符"));

        if (request.method === "GET") return respond(await getBook(token, slug));
        if (request.method === "PUT") return respond(await saveBook(token, slug, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeBook(token, slug));
    }

    const chapterMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(.+)$/);
    if (chapterMatch) {
        const slug = decodeURIComponent(chapterMatch[1]);
        const id = decodeURIComponent(chapterMatch[2]);
        if (!c.isValidSlug(slug)) return respond(fail(400, "书籍 slug 不合法"));
        if (!id || id.includes("..") || id.startsWith("/")) return respond(fail(400, "章节 id 不合法"));

        if (request.method === "PUT") return respond(await saveChapter(token, slug, id, await readBody(request)));
        if (request.method === "DELETE") return respond(await removeChapter(token, slug, id));
    }

    /* ------------------------------------------------------------- 页面 */

    if (path === "/api/pages") {
        if (request.method === "GET") return respond(await listPages(token, url));
        return respond(await savePage(token, null, await readBody(request)));
    }

    const pageMatch = path.match(/^\/api\/pages\/([^/]+)$/);
    if (pageMatch) {
        const name = decodeURIComponent(pageMatch[1]);
        if (!c.isValidSlug(name)) return respond(fail(400, "页面文件名只能包含字母、数字和连字符"));

        if (request.method === "GET") return respond(await getPage(token, name));
        if (request.method === "PUT") return respond(await savePage(token, name, await readBody(request)));
        if (request.method === "DELETE") return respond(await removePage(token, name));
    }

    /* ------------------------------------------------------------- 历史 */

    if (path === "/api/history") {
        if (request.method === "GET") {
            return respond(await getHistory(token, url));
        }
        if (request.method === "POST") {
            return respond(await restoreHistory(token, await readBody(request)));
        }
    }

    /* ------------------------------------------------------------- 图片库 */

    if (path === "/api/images") {
        if (request.method === "GET") return respond(await listImages(token, url));
        if (request.method === "DELETE") {
            return respond(await removeImage(token, url.searchParams.get("path")));
        }
    }

    /* ------------------------------------------------------------- 批量 */

    if (path === "/api/batch" && request.method === "POST") {
        return respond(await runBatch(token, await readBody(request)));
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

/**
 * 列表的搜索与排序。
 *
 * q：全文检索走 GitHub code search，先拿到命中的文件路径再只读这几个文件，
 *     避免为了搜索把整个仓库的文件都拉一遍（那会撞 Cloudflare 的子请求上限）。
 *     搜索接口失败时退回「只筛当前页」。
 * sort：date 方向可以在目录树层面排，words / title 需要读到正文才知道，
 *     只在当前页内排。
 */
function listOptions(url) {
    const q = String(url.searchParams.get("q") || "").trim();
    const sort = String(url.searchParams.get("sort") || "date-desc");
    return { q, sort };
}

function sortEntries(entries, sort, dateKey = "date") {
    const list = entries.slice();
    if (sort === "date-asc") {
        list.sort((a, b) => (a[dateKey] || "").localeCompare(b[dateKey] || ""));
    } else {
        list.sort((a, b) => (b[dateKey] || "").localeCompare(a[dateKey] || ""));
    }
    return list;
}

/**
 * 用 GitHub code search 找出命中的文件路径。
 * 失败不抛错，交由调用方退回当前页筛选。
 */
async function searchPaths(token, query, pathPrefix) {
    if (!query) return null;
    try {
        const paths = await searchFiles(token, { query, pathPrefix, limit: MAX_PAGE });
        return paths;
    } catch (err) {
        console.error("搜索失败，退回当前页筛选", err?.message);
        return null;
    }
}

/* ---------------------------------------------------------------- 文章 */

async function listPosts(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const { q, sort } = listOptions(url);

    let candidates = tree.posts;
    const hits = await searchPaths(token, q, "content/posts");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((p) => hitSet.has(p.path));
    }

    candidates = sortEntries(candidates, sort);
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `p:${entry.dirName}`);
        if (!parsed) return null;
        return { ...entry, ...md.postSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.posts.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
    };
}

async function getPost(token, slug) {
    const tree = await getTree(token);
    const entry = tree.posts.find((p) => p.slug === slug);
    if (!entry) return fail(404, "文章不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `p:${entry.dirName}`);
    if (!parsed) return fail(500, "读取文章失败");

    return {
        key: slug,
        slug,
        dirName: entry.dirName,
        date: parsed.data.date || entry.date,
        ...md.postSummary(parsed.data, parsed.body),
        redirectFrom: Array.isArray(parsed.data.redirectFrom) ? parsed.data.redirectFrom : [],
        content: parsed.body,
        path: entry.path,
        url: `/posts/${slug}/`,
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
        key: slug,
        slug,
        dirName,
        date,
        created: !sha,
        renamed: Boolean(movedFrom),
        message: sha ? "已保存，站点约 1 分钟后更新" : "已创建，站点约 1 分钟后更新",
        path,
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
    const { q, sort } = listOptions(url);

    let candidates = tree.flows;
    const hits = await searchPaths(token, q, "content/flows");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((f) => hitSet.has(f.path));
    }

    candidates = sortEntries(candidates, sort);
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `f:${entry.date}`);
        if (!parsed) return null;
        return { date: entry.date, folder: Boolean(entry.folderPath), ...md.flowSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.flows.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
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
        key: date,
        date,
        folder: hit.folder,
        ...md.flowSummary(parsed.data, parsed.body),
        content: parsed.body,
        path: hit.path,
        url: `/flows/${date.replace(/-/g, "/")}/`,
    };
}

async function saveFlow(token, dateFromUrl, input) {
    const date = String(input.date || dateFromUrl || "").trim();
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
        key: date,
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

/* ---------------------------------------------------------------- 笔记 */

/**
 * 笔记：content/notes/<slug>.md，扁平单文件。
 * amytis 只认这个形态，写成 notes/<slug>/index.md 会被静默忽略。
 */
async function listNotes(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const { q, sort } = listOptions(url);

    let candidates = tree.notes;
    const hits = await searchPaths(token, q, "content/notes");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((n) => hitSet.has(n.path));
    }

    candidates = sortEntries(candidates, sort, "slug");
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `n:${entry.slug}`);
        if (!parsed) return null;
        return { ...entry, ...md.noteSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.notes.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
    };
}

async function getNote(token, slug) {
    const tree = await getTree(token);
    const entry = tree.notes.find((n) => n.slug === slug);
    if (!entry) return fail(404, "笔记不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `n:${slug}`);
    if (!parsed) return fail(500, "读取笔记失败");

    return {
        key: slug,
        slug,
        date: parsed.data.date || "",
        ...md.noteSummary(parsed.data, parsed.body),
        aliases: Array.isArray(parsed.data.aliases) ? parsed.data.aliases : [],
        content: parsed.body,
        path: entry.path,
        url: `/notes/${slug}`,
    };
}

async function saveNote(token, slugFromUrl, input) {
    const slug = String(input.slug || slugFromUrl || "").trim();
    if (!c.isValidSlug(slug)) return fail(400, "slug 只能包含字母、数字和连字符");

    const title = String(input.title || "").trim();
    if (!title) return fail(400, "请填写笔记标题（amytis 要求 title 必填）");

    const tree = await getTree(token);
    const path = c.notePath(slug);
    const prior = tree.notes.find((n) => n.slug === slug) || null;

    let sha;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(prior.path, prior.sha, token, `n:${slug}`);
        if (parsed) {
            existing = parsed;
            sha = prior.sha;
        }
    }

    // slug 改了要清掉旧文件，否则仓库里会留下访问不到的孤儿笔记
    let movedFrom = null;
    if (slugFromUrl && slugFromUrl !== slug) {
        const old = tree.notes.find((n) => n.slug === slugFromUrl);
        if (old) movedFrom = old;
    }

    const data = md.applyNoteMeta(existing.data, { ...input });
    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "新建"}笔记：${title}`,
    });

    if (movedFrom) {
        await deleteFile(movedFrom.path, token, { sha: movedFrom.sha, message: `重命名笔记：${movedFrom.slug} → ${slug}` })
            .catch((err) => console.error("清理旧笔记失败", err));
    }

    invalidate();
    return {
        ok: true,
        key: slug,
        slug,
        path,
        created: !sha,
        renamed: Boolean(movedFrom),
        message: sha ? "笔记已保存" : "笔记已创建",
        data,
    };
}

async function removeNote(token, slug) {
    const tree = await getTree(token);
    const entry = tree.notes.find((n) => n.slug === slug);
    if (!entry) return fail(404, "笔记不存在");

    await deleteFile(entry.path, token, { sha: entry.sha, message: `删除笔记：${slug}` });
    invalidate();
    return { ok: true, message: "笔记已删除" };
}

/* ---------------------------------------------------------------- 系列 */

/**
 * 系列：content/series/<slug>/index.md
 *
 * 系列的成员是「文章 front matter 里 series 字段等于这个 slug」的文章，
 * 由 amytis 自动收集。这样就不用手写 posts 数组，
 * 免得引用了不存在的 slug 导致构建直接失败。
 */
async function listSeries(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const { q, sort } = listOptions(url);

    let candidates = tree.series;
    const hits = await searchPaths(token, q, "content/series");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((s) => hitSet.has(s.path));
    }

    candidates = sortEntries(candidates, sort, "slug");
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `s:${entry.slug}`);
        if (!parsed) return null;
        return { ...entry, ...md.seriesSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.series.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
    };
}

async function getSeries(token, slug) {
    const tree = await getTree(token);
    const entry = tree.series.find((s) => s.slug === slug);
    if (!entry) return fail(404, "系列不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `s:${slug}`);
    if (!parsed) return fail(500, "读取系列失败");

    // 哪些文章挂在这个系列下
    const members = [];
    for (const post of tree.posts) {
        const p = await readEntry(post.path, post.sha, token, `p:${post.dirName}`);
        if (!p) continue;
        if (p.data.series === slug) {
            members.push({ slug: post.slug, title: p.data.title || post.slug, date: p.data.date || post.date });
        }
    }

    return {
        key: slug,
        slug,
        date: parsed.data.date || "",
        ...md.seriesSummary(parsed.data, parsed.body),
        members,
        content: parsed.body,
        path: entry.path,
        url: `/series/${slug}`,
    };
}

async function saveSeries(token, slugFromUrl, input) {
    const slug = String(input.slug || slugFromUrl || "").trim();
    if (!c.isValidSlug(slug)) return fail(400, "slug 只能包含字母、数字和连字符");

    const title = String(input.title || "").trim();
    if (!title) return fail(400, "请填写系列标题（amytis 要求 title 必填）");

    const tree = await getTree(token);
    const path = c.seriesIndexPath(slug);
    const prior = tree.series.find((s) => s.slug === slug) || null;

    let sha;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(prior.path, prior.sha, token, `s:${slug}`);
        if (parsed) {
            existing = parsed;
            sha = prior.sha;
        }
    }

    // posts 数组留空：交给 amytis 按文章 front matter 的 series 字段自动收集。
    // 手写数组一旦引用了不存在的 slug，amytis 会直接构建失败。
    const data = md.applySeriesMeta(existing.data, { ...input, posts: [] });
    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "新建"}系列：${title}`,
    });

    invalidate();
    return {
        ok: true,
        key: slug,
        slug,
        path,
        created: !sha,
        message: sha ? "系列已保存" : "系列已创建",
        data,
    };
}

async function removeSeries(token, slug) {
    const tree = await getTree(token);
    const entry = tree.series.find((s) => s.slug === slug);
    if (!entry) return fail(404, "系列不存在");

    const removed = await deleteDir(c.seriesDir(slug), token, `删除系列：${slug}`);

    // 系列没了，挂在下面的文章也要摘掉 series 字段
    await detachSeriesFromPosts(token, slug).catch((err) => console.error("清理文章关联失败", err));

    invalidate();
    return { ok: true, removed, message: `系列已删除（连带清理 ${removed} 个文件）` };
}

/** 把某系列下的文章批量摘掉 / 挂上 series 字段 */
async function setSeriesMembers(token, slug, input) {
    if (!c.isValidSlug(slug)) return fail(400, "slug 不合法");
    const slugs = Array.isArray(input.slugs) ? input.slugs.map(String) : [];

    const tree = await getTree(token);
    const files = [];
    let changed = 0;

    for (const post of tree.posts) {
        const parsed = await readEntry(post.path, post.sha, token, `p:${post.dirName}`);
        if (!parsed) continue;

        const shouldAttach = slugs.includes(post.slug);
        const isAttached = parsed.data.series === slug;
        if (shouldAttach === isAttached) continue;

        const data = md.applyPostMeta(parsed.data, { series: shouldAttach ? slug : "" });
        files.push({ path: post.path, text: md.stringify(data, parsed.body) });
        changed++;
    }

    if (changed) {
        await commitFiles(token, {
            message: `调整系列成员：${slug}`,
            files,
        });
        invalidate();
    }

    return {
        ok: true,
        changed,
        slugs,
        message: changed ? `已更新 ${changed} 篇文章的系列归属` : "系列成员没有变化",
    };
}

async function detachSeriesFromPosts(token, slug) {
    const tree = await getTree(token);
    const files = [];
    for (const post of tree.posts) {
        const parsed = await readEntry(post.path, post.sha, token, `p:${post.dirName}`);
        if (!parsed || parsed.data.series !== slug) continue;
        const data = md.applyPostMeta(parsed.data, { series: "" });
        files.push({ path: post.path, text: md.stringify(data, parsed.body) });
    }
    if (files.length) {
        await commitFiles(token, { message: `清理系列关联：${slug}`, files });
    }
}

/* ---------------------------------------------------------------- 书籍 */

/**
 * 书籍：content/books/<slug>/index.md + 章节文件 <id>.md
 * amytis 的 BookSchema 要求 title、date、chapters 三个都必填，
 * 且 chapters 里每个 id 都必须能找到对应文件，否则构建失败。
 */
async function listBooks(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const { q, sort } = listOptions(url);

    let candidates = tree.books;
    const hits = await searchPaths(token, q, "content/books");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((b) => hitSet.has(b.path));
    }

    candidates = sortEntries(candidates, sort, "slug");
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `b:${entry.slug}`);
        if (!parsed) return null;
        return { ...entry, ...md.bookSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.books.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
    };
}

async function getBook(token, slug) {
    const tree = await getTree(token);
    const entry = tree.books.find((b) => b.slug === slug);
    if (!entry) return fail(404, "书籍不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `b:${slug}`);
    if (!parsed) return fail(500, "读取书籍失败");

    const chapters = Array.isArray(parsed.data.chapters) ? parsed.data.chapters : [];
    const details = await mapLimit(chapters, 6, async (ch) => {
        const path = c.bookChapterPath(slug, ch.id);
        const file = await readEntry(path, null, token, `bc:${slug}:${ch.id}`);
        return {
            id: ch.id,
            title: ch.title || ch.id,
            content: file ? file.body : "",
            path,
            exists: Boolean(file),
        };
    });

    return {
        key: slug,
        slug,
        date: parsed.data.date || "",
        ...md.bookSummary(parsed.data, parsed.body),
        chapters: details,
        content: parsed.body,
        path: entry.path,
        url: `/books/${slug}`,
    };
}

async function saveBook(token, slugFromUrl, input) {
    const slug = String(input.slug || slugFromUrl || "").trim();
    if (!c.isValidSlug(slug)) return fail(400, "slug 只能包含字母、数字和连字符");

    const title = String(input.title || "").trim();
    if (!title) return fail(400, "请填写书名（amytis 要求 title 必填）");

    const date = String(input.date || "").trim();
    if (!c.isValidDate(date)) return fail(400, "请填写发布日期（amytis 的 books 要求 date 必填）");

    const tree = await getTree(token);
    const path = c.bookIndexPath(slug);
    const prior = tree.books.find((b) => b.slug === slug) || null;

    let sha;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(prior.path, prior.sha, token, `b:${slug}`);
        if (parsed) {
            existing = parsed;
            sha = prior.sha;
        }
    }

    const chapters = md.normalizeChapters(input.chapters);

    // 章节表里有的 id 必须有对应文件，否则 amytis 构建会报错。
    // 这里把缺的章节补成空文件，多出来的删掉。
    const files = [];
    const deletions = [];
    const keepIds = new Set(chapters.map((ch) => ch.id));

    for (const ch of chapters) {
        const chPath = c.bookChapterPath(slug, ch.id);
        const exists = tree.byPath.has(chPath);
        if (!exists) {
            files.push({
                path: chPath,
                text: `---\ntitle: ${ch.title}\n---\n\n`,
            });
        }
    }

    // 清理掉已经不在章节表里的旧章节文件
    for (const [p] of tree.byPath) {
        const m = p.match(/^content\/books\/([^/]+)\/(.+)\.md$/);
        if (!m || m[1] !== slug) continue;
        if (m[2] === "index") continue;
        if (!keepIds.has(m[2])) deletions.push(p);
    }

    const data = md.applyBookMeta(existing.data, { ...input, date, chapters });
    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "新建"}书籍：${title}`,
    });

    if (files.length || deletions.length) {
        await commitFiles(token, {
            message: `同步书籍章节：${title}`,
            files,
            deletions,
        });
    }

    invalidate();
    return {
        ok: true,
        key: slug,
        slug,
        path,
        created: !sha,
        message: sha ? "书籍已保存" : "书籍已创建",
        data,
    };
}

async function removeBook(token, slug) {
    const tree = await getTree(token);
    const entry = tree.books.find((b) => b.slug === slug);
    if (!entry) return fail(404, "书籍不存在");

    const removed = await deleteDir(c.bookDir(slug), token, `删除书籍：${slug}`);
    invalidate();
    return { ok: true, removed, message: `书籍已删除（清理 ${removed} 个文件）` };
}

async function saveChapter(token, slug, id, input) {
    const tree = await getTree(token);
    const path = c.bookChapterPath(slug, id);
    const prior = tree.byPath.get(path);

    let sha = prior ? prior.sha : undefined;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(path, prior.sha, token, `bc:${slug}:${id}`);
        if (parsed) existing = parsed;
    }

    const title = String(input.title || "").trim() || id;
    const data = { ...existing.data };
    data.title = title;
    if (input.excerpt !== undefined) data.excerpt = String(input.excerpt).trim();
    if (data.excerpt === "") delete data.excerpt;

    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "新建"}章节：${title}`,
    });

    invalidate();
    return { ok: true, id, title, path, message: sha ? "章节已保存" : "章节已创建" };
}

async function removeChapter(token, slug, id) {
    const tree = await getTree(token);
    const path = c.bookChapterPath(slug, id);
    const prior = tree.byPath.get(path);
    if (!prior) return fail(404, "章节不存在");

    await deleteFile(path, token, { sha: prior.sha, message: `删除章节：${id}` });

    // 章节表里也要去掉这一项，否则 amytis 会因为找不到文件而构建失败
    const book = tree.books.find((b) => b.slug === slug);
    if (book) {
        const parsed = await readEntry(book.path, book.sha, token, `b:${slug}`);
        if (parsed) {
            const chapters = (Array.isArray(parsed.data.chapters) ? parsed.data.chapters : [])
                .filter((ch) => ch.id !== id);
            const data = md.applyBookMeta(parsed.data, { chapters });
            await putFile(book.path, md.stringify(data, parsed.body), token, {
                sha: book.sha,
                message: `同步书籍章节表：${slug}`,
            });
        }
    }

    invalidate();
    return { ok: true, message: "章节已删除" };
}

/* ---------------------------------------------------------------- 页面 */

/** 顶层页面：content/<name>.md，对应线上 /<name> */
async function listPages(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);
    const { q, sort } = listOptions(url);

    let candidates = tree.pages;
    const hits = await searchPaths(token, q, "content");
    if (hits) {
        const hitSet = new Set(hits);
        candidates = candidates.filter((p) => hitSet.has(p.path));
    }

    candidates = sortEntries(candidates, sort, "name");
    const slice = candidates.slice(offset, offset + limit);

    const detailed = await mapLimit(slice, 8, async (entry) => {
        const parsed = await readEntry(entry.path, entry.sha, token, `pg:${entry.name}`);
        if (!parsed) return null;
        return { ...entry, ...md.pageSummary(parsed.data, parsed.body) };
    });

    return {
        items: detailed.filter(Boolean),
        total: hits ? candidates.length : tree.pages.length,
        offset,
        limit,
        truncated: tree.truncated,
        searched: Boolean(hits),
    };
}

async function getPage(token, name) {
    const tree = await getTree(token);
    const entry = tree.pages.find((p) => p.name === name);
    if (!entry) return fail(404, "页面不存在");

    const parsed = await readEntry(entry.path, entry.sha, token, `pg:${name}`);
    if (!parsed) return fail(500, "读取页面失败");

    return {
        key: name,
        name,
        date: parsed.data.date || "",
        ...md.pageSummary(parsed.data, parsed.body),
        content: parsed.body,
        path: entry.path,
        url: `/${name}`,
    };
}

async function savePage(token, nameFromUrl, input) {
    const name = String(input.name || nameFromUrl || "").trim();
    if (!c.isValidSlug(name)) return fail(400, "页面文件名只能包含字母、数字和连字符");

    const title = String(input.title || "").trim();
    if (!title) return fail(400, "请填写页面标题（amytis 要求 title 必填）");

    const tree = await getTree(token);
    const path = c.pagePath(name);
    const prior = tree.pages.find((p) => p.name === name) || null;

    let sha;
    let existing = { data: {}, body: "" };
    if (prior) {
        const parsed = await readEntry(prior.path, prior.sha, token, `pg:${name}`);
        if (parsed) {
            existing = parsed;
            sha = prior.sha;
        }
    }

    const data = md.applyPageMeta(existing.data, { ...input });
    const raw = md.stringify(data, input.content ?? existing.body);

    await putFile(path, raw, token, {
        sha,
        message: `${sha ? "更新" : "新建"}页面：${title}`,
    });

    invalidate();
    return {
        ok: true,
        key: name,
        name,
        path,
        created: !sha,
        message: sha ? "页面已保存" : "页面已创建",
        data,
    };
}

async function removePage(token, name) {
    const tree = await getTree(token);
    const entry = tree.pages.find((p) => p.name === name);
    if (!entry) return fail(404, "页面不存在");

    await deleteFile(entry.path, token, { sha: entry.sha, message: `删除页面：${name}` });
    invalidate();
    return { ok: true, message: "页面已删除" };
}

/* -------------------------------------------------------------- 版本历史 */

async function getHistory(token, url) {
    const type = String(url.searchParams.get("type") || "posts");
    const key = String(url.searchParams.get("key") || "");
    if (!key) return fail(400, "缺少 key");

    const path = await resolveFilePath(token, type, key);
    if (!path) return fail(404, "找不到对应的文件");

    const commits = await listCommits(path, token, 20);
    return { ok: true, path, items: commits };
}

async function restoreHistory(token, input) {
    const type = String(input.type || "posts");
    const key = String(input.key || "");
    const sha = String(input.sha || "");
    if (!key || !sha) return fail(400, "缺少 key 或 sha");

    const path = await resolveFilePath(token, type, key);
    if (!path) return fail(404, "找不到对应的文件");

    const old = await getFileAtRef(path, sha, token);
    if (!old) return fail(404, "该版本的文件内容不存在");

    // 用当前文件内容覆盖回去，保留仓库里最新的 sha 做乐观锁
    const current = await getFile(path, token);
    await putFile(path, old.text, token, {
        sha: current ? current.sha : undefined,
        message: `回滚文件：${path.split("/").pop()} → ${sha.slice(0, 7)}`,
    });

    invalidate();
    return { ok: true, path, message: "已回滚到该版本，站点约 1 分钟后更新" };
}

/** 把「类型 + key」解析成仓库里的文件路径 */
async function resolveFilePath(token, type, key) {
    const tree = await getTree(token);

    if (type === "posts") {
        const entry = tree.posts.find((p) => p.slug === key);
        return entry ? entry.path : null;
    }
    if (type === "flows") {
        const entry = tree.flows.find((f) => f.date === key);
        return entry ? entry.path : null;
    }
    if (type === "notes") {
        const entry = tree.notes.find((n) => n.slug === key);
        return entry ? entry.path : null;
    }
    if (type === "series") {
        const entry = tree.series.find((s) => s.slug === key);
        return entry ? entry.path : null;
    }
    if (type === "books") {
        const entry = tree.books.find((b) => b.slug === key);
        return entry ? entry.path : null;
    }
    if (type === "pages") {
        const entry = tree.pages.find((p) => p.name === key);
        return entry ? entry.path : null;
    }
    return null;
}

/* ---------------------------------------------------------------- 图片库 */

async function listImages(token, url) {
    const tree = await getTree(token);
    const { limit, offset } = paging(url);

    const all = tree.images || [];
    const slice = all.slice(offset, offset + limit);
    return {
        ok: true,
        items: slice.map((img) => ({
            path: img.path,
            name: img.name,
            url: c.publicUrlFor(img.path),
        })),
        total: all.length,
        offset,
        limit,
    };
}

async function removeImage(token, path) {
    if (!path) return fail(400, "缺少图片路径");
    if (!/^(content\/|public\/uploads\/)/.test(path)) return fail(400, "路径不合法");

    const tree = await getTree(token);
    const entry = tree.byPath.get(path);
    if (!entry) return fail(404, "图片不存在");

    await deleteFile(path, token, { sha: entry.sha, message: `删除图片：${path.split("/").pop()}` });
    invalidate();
    return { ok: true, message: "图片已删除" };
}

/* ---------------------------------------------------------------- 批量 */

async function runBatch(token, input) {
    const type = String(input.type || "");
    const action = String(input.action || "");
    const keys = Array.isArray(input.keys) ? input.keys.map(String) : [];

    if (!keys.length) return fail(400, "没有选中任何条目");
    if (keys.length > 50) return fail(400, "一次最多处理 50 项");

    const tree = await getTree(token);
    const files = [];
    const deletions = [];

    if (action === "delete") {
        for (const key of keys) {
            const entry = findEntry(tree, type, key);
            if (!entry) continue;
            if (type === "posts") {
                // 文章要连目录一起删，交给单条删除逻辑
                await removePost(token, key);
                continue;
            }
            if (type === "series") {
                await removeSeries(token, key);
                continue;
            }
            if (type === "books") {
                await removeBook(token, key);
                continue;
            }
            deletions.push(entry.path);
        }
        if (deletions.length) {
            await commitFiles(token, { message: `批量删除 ${deletions.length} 项`, deletions });
            invalidate();
        }
        return { ok: true, count: keys.length, message: `已删除 ${keys.length} 项` };
    }

    if (action === "draft") {
        for (const key of keys) {
            const entry = findEntry(tree, type, key);
            if (!entry) continue;
            const parsed = await readEntry(entry.path, entry.sha, token, batchCacheKey(type, key));
            if (!parsed) continue;
            const data = applyMetaFor(type, parsed.data, { draft: true });
            files.push({ path: entry.path, text: md.stringify(data, parsed.body) });
        }
        if (files.length) {
            await commitFiles(token, { message: `批量转草稿 ${files.length} 项`, files });
            invalidate();
        }
        return { ok: true, count: files.length, message: `已把 ${files.length} 项转为草稿` };
    }

    return fail(400, "不支持的批量操作");
}

function findEntry(tree, type, key) {
    if (type === "posts") return tree.posts.find((p) => p.slug === key);
    if (type === "flows") return tree.flows.find((f) => f.date === key);
    if (type === "notes") return tree.notes.find((n) => n.slug === key);
    if (type === "series") return tree.series.find((s) => s.slug === key);
    if (type === "books") return tree.books.find((b) => b.slug === key);
    if (type === "pages") return tree.pages.find((p) => p.name === key);
    return null;
}

function batchCacheKey(type, key) {
    if (type === "posts") {
        const entry = cache.tree?.posts?.find((p) => p.slug === key);
        return entry ? `p:${entry.dirName}` : null;
    }
    if (type === "flows") return `f:${key}`;
    if (type === "notes") return `n:${key}`;
    if (type === "series") return `s:${key}`;
    if (type === "books") return `b:${key}`;
    if (type === "pages") return `pg:${key}`;
    return null;
}

function applyMetaFor(type, existing, input) {
    if (type === "posts") return md.applyPostMeta(existing, input);
    if (type === "flows") return md.applyFlowMeta(existing, input);
    if (type === "notes") return md.applyNoteMeta(existing, input);
    if (type === "series") return md.applySeriesMeta(existing, input);
    if (type === "books") return md.applyBookMeta(existing, input);
    if (type === "pages") return md.applyPageMeta(existing, input);
    return existing;
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
