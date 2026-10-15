/**
 * 博客后台 Worker
 *
 * 职责：
 *   1. 用 GitHub OAuth 登录，签发会话 Cookie
 *   2. 读写仓库里的 Hugo 文章（content/post/<slug>/index.md）
 *   3. 上传图片到 static/uploads/
 *
 * 保存文章 = 向仓库提交一次 commit，GitHub Actions 随即重新构建并发布站点。
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
import {
    GitHubError,
    deleteFile,
    getFile,
    getUser,
    listDir,
    mapLimit,
    optionalEnv,
    putBinaryFile,
    putFile,
} from "./github.js";

const SESSION_TTL = 60 * 60 * 24 * 14; // 14 天
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
};

export default {
    async fetch(request, workerEnv, ctx) {
        // github.js 里的 env() 统一从这里取
        globalThis.__env = workerEnv;

        const url = new URL(request.url);

        try {
            if (url.pathname.startsWith("/api/")) return await handleApi(request, url, workerEnv);
            if (url.pathname.startsWith("/auth/")) return await handleAuth(request, url, workerEnv);
        } catch (err) {
            console.error("unhandled", err);
            return json({ error: describe(err) }, err instanceof GitHubError ? err.status : 500);
        }

        // 其余交给静态资源（后台前端）
        if (workerEnv.ASSETS) return workerEnv.ASSETS.fetch(request);
        return new Response("Not Found", { status: 404 });
    },
};

/* ------------------------------------------------------------------ 认证 */

async function handleAuth(request, url, env) {
    const path = url.pathname;

    if (path === "/auth/login") {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
            return html(
                "<h1>后台未完成配置</h1><p>请先在 Cloudflare 上设置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 两个 secret。</p>",
                500
            );
        }

        const state = randomToken();
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
        authorize.searchParams.set("scope", "public_repo");
        authorize.searchParams.set("state", state);

        return new Response(null, {
            status: 302,
            headers: {
                Location: authorize.toString(),
                "Set-Cookie": sessionCookie(
                    // state 复用同一个签名机制，短期有效即可
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
            return html("<h1>登录失败</h1><p>state 校验未通过，请重新发起登录。</p>", 400);
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

        const allow = optionalEnvList(env.ALLOWED_LOGINS);
        if (allow.length && !allow.includes(String(profile.login).toLowerCase())) {
            return html(
                `<h1>没有访问权限</h1><p>当前登录的是 <code>${escapeHtml(profile.login)}</code>，` +
                `而后台只对 ${allow.map(escapeHtml).join("、")} 开放。</p>`,
                403
            );
        }

        const session = await signSession(
            {
                login: profile.login,
                name: profile.name || profile.login,
                avatar: profile.avatar_url,
                token: tokenData.access_token,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
            },
            env.SESSION_SECRET
        );

        return new Response(null, {
            status: 302,
            headers: {
                Location: "/",
                "Set-Cookie": sessionCookie(session, SESSION_TTL),
            },
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
    const session = await requireSession(request, env);
    if (session instanceof Response) return session;

    const path = url.pathname;

    if (path === "/api/session") {
        return json({
            login: session.login,
            name: session.name,
            avatar: session.avatar,
            repo: `${optionalEnv("GITHUB_OWNER")}/${optionalEnv("GITHUB_REPO")}`,
            branch: optionalEnv("GITHUB_BRANCH"),
        });
    }

    if (path === "/api/posts" && request.method === "GET") {
        return json({ posts: await listPosts(session.token) });
    }

    const match = path.match(/^\/api\/posts\/([^/]+)$/);
    if (match) {
        const slug = decodeURIComponent(match[1]);
        if (!SLUG_RE.test(slug)) return json({ error: "slug 只能包含字母、数字和连字符" }, 400);

        if (request.method === "GET") {
            const post = await readPost(slug, session.token);
            if (!post) return json({ error: "文章不存在" }, 404);
            return json(post);
        }

        if (request.method === "PUT") {
            const body = await request.json();
            const saved = await savePost(slug, body, session);
            return json(saved);
        }

        if (request.method === "DELETE") {
            const result = await removePost(slug, session.token);
            if (!result) return json({ error: "文章不存在" }, 404);
            return json({ ok: true, message: result.message });
        }
    }

    if (path === "/api/upload" && request.method === "POST") {
        return json(await handleUpload(request, session.token));
    }

    return json({ error: "接口不存在" }, 404);
}

async function requireSession(request, env) {
    const session = await verifySession(readCookie(request), env.SESSION_SECRET);
    if (session && session.token) return session;

    // 未登录时统一返回 401，前端据此跳转登录页
    return json({ error: "未登录" }, 401);
}

/* --------------------------------------------------------------- 文章读写 */

function contentDir() {
    return optionalEnv("CONTENT_DIR") || "content/post";
}

function postPath(slug) {
    return `${contentDir()}/${slug}/index.md`;
}

/** 列出所有文章（含草稿），按日期倒序 */
async function listPosts(token) {
    const dir = contentDir();
    const entries = await listDir(dir, token);
    if (!Array.isArray(entries)) return [];

    const dirs = entries.filter((e) => e.type === "dir" && SLUG_RE.test(e.name));
    const files = await mapLimit(dirs, 8, async (e) => {
        const file = await getFile(`${dir}/${e.name}/index.md`, token);
        if (!file) return null;
        try {
            const { data, body } = md.parse(file.text);
            return { ...md.summarize(e.name, data, body), path: file.path, sha: file.sha };
        } catch (err) {
            console.error("解析失败", e.name, err);
            return null;
        }
    });

    return files
        .filter(Boolean)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function readPost(slug, token) {
    const file = await getFile(postPath(slug), token);
    if (!file) return null;
    const { data, body } = md.parse(file.text);
    return {
        slug,
        path: file.path,
        sha: file.sha,
        ...data,
        content: body,
    };
}

async function savePost(slug, input, session) {
    const existing = await getFile(postPath(slug), session.token);

    const current = existing ? md.parse(existing.text) : { data: {}, body: "" };
    const data = md.applyMeta(current.data, input);
    const raw = md.stringify(data, input.content ?? current.body);

    const isUpdate = Boolean(existing);
    const action = isUpdate ? "更新" : "新建";
    const message =
        `${action}文章：${data.title || slug}\n\n` +
        `Co-Authored-By: Claude <noreply@anthropic.com>`;

    await putFile(postPath(slug), raw, session.token, {
        sha: existing?.sha,
        message,
    });

    return {
        ok: true,
        slug,
        created: !isUpdate,
        message: isUpdate ? "已保存，站点约 1 分钟后更新" : "已创建，站点约 1 分钟后更新",
        data,
    };
}

async function removePost(slug, token) {
    const file = await getFile(postPath(slug), token);
    if (!file) return null;

    const { data } = md.parse(file.text);
    const message = `删除文章：${data.title || slug}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;

    await deleteFile(file.path, token, { sha: file.sha, message });
    return { message: "文章已删除，站点约 1 分钟后更新" };
}

/* ------------------------------------------------------------------ 图片 */

async function handleUpload(request, token) {
    const body = await request.json();
    const mime = String(body.contentType || "");
    const ext = ALLOWED_IMAGE[mime];

    if (!ext) {
        return json({ error: `不支持的图片格式：${mime || "未知"}。可用：PNG / JPG / WebP / GIF / SVG` }, 400);
    }

    // dataURL: "data:<mime>;base64,<payload>"
    const dataUrl = String(body.data || "");
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) {
        return json({ error: "图片数据格式不正确" }, 400);
    }

    let bytes;
    try {
        bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
    } catch {
        return json({ error: "图片数据解码失败" }, 400);
    }

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return json({ error: `图片超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限` }, 400);
    }

    const name = slugifyFilename(body.filename) || randomToken(8);
    const dir = optionalEnv("UPLOAD_DIR") || "static/uploads";
    const path = `${dir}/${name}.${ext}`;

    await putBinaryFile(path, btoa(bin), token, {
        message: `上传图片：${name}.${ext}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
    });

    // 站点是 GitHub Pages 子路径部署，图片地址必须带仓库名前缀
    const base = (optionalEnv("SITE_BASE") || "").replace(/\/$/, "");
    return json({ path, url: `${base}/${path}` });
}

function slugifyFilename(name) {
    return String(name || "")
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
}

/* ------------------------------------------------------------------ 工具 */

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
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
                a{color:#12a07a}
            </style></head><body>${body}</body></html>`,
        { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
}

function randomToken(len = 24) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function optionalEnvList(value) {
    return String(value || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}

function describe(err) {
    if (err instanceof GitHubError) return `GitHub：${err.message}`;
    return err?.message || "服务器内部错误";
}
