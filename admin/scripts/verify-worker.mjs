/**
 * Worker 端到端验证：把 GitHub API 打桩，在内存里模拟一个仓库。
 *
 * 跑的是真正的 Worker 代码（src/index.js），验证的是路由分发、参数校验、
 * front matter 序列化、路径推导这些容易出错的地方。
 * 不联网、不碰真实仓库。
 *
 * 运行：bun run scripts/verify-worker.mjs
 */
import { signSession, COOKIE_NAME } from "../src/session.js";
import worker from "../src/index.js";

const SECRET = "test-secret-value";

const ENV = {
    GITHUB_OWNER: "huayu0824",
    GITHUB_REPO: "huayu0824.github.io",
    GITHUB_BRANCH: "main",
    ALLOWED_LOGINS: "huayu0824",
    DEFAULT_AUTHOR: "花羽",
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csecret",
    SESSION_SECRET: SECRET,
};

/* ------------------------------------------------------------ 仓库打桩 */

/** path -> { text, sha } */
const repo = new Map();
let shaCounter = 0;
const commits = [];

function nextSha() {
    shaCounter += 1;
    return "sha" + String(shaCounter).padStart(4, "0");
}

function put(path, text) {
    const sha = nextSha();
    repo.set(path, { text, sha });
    return sha;
}

function b64(str) {
    return Buffer.from(str, "utf8").toString("base64");
}

function fromB64(str) {
    return Buffer.from(str, "base64").toString("utf8");
}

/** 把内存仓库的当前状态包装成 git tree */
function treeEntries() {
    return Array.from(repo.entries()).map(([path, v]) => ({
        path,
        type: "blob",
        sha: v.sha,
    }));
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("https://api.github.com")) return realFetch(input, init);

    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;

    const json = (data, status = 200) =>
        new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
        });

    // git tree
    if (u.pathname.endsWith("/git/trees/main") && u.searchParams.get("recursive") === "1") {
        return json({ truncated: false, tree: treeEntries() });
    }

    // git ref
    if (/\/git\/ref\/heads\/main$/.test(u.pathname) && method === "GET") {
        return json({ object: { sha: "basecommit" } });
    }
    if (/\/git\/refs\/heads\/main$/.test(u.pathname) && method === "PATCH") {
        commits.push({ message: body.message, files: body });
        return json({ sha: nextSha() });
    }
    if (/\/git\/commits\/basecommit$/.test(u.pathname)) {
        return json({ tree: { sha: "basetree" } });
    }
    if (u.pathname.endsWith("/git/trees") && method === "POST") {
        // 内联内容建树
        for (const entry of body.tree || []) {
            if (entry.sha === null) {
                repo.delete(entry.path);
            } else if (entry.content !== undefined) {
                put(entry.path, entry.content);
            }
        }
        return json({ sha: nextSha() });
    }
    if (u.pathname.endsWith("/git/commits") && method === "POST") {
        return json({ sha: nextSha() });
    }

    // 提交历史
    if (u.pathname.endsWith("/commits") && u.searchParams.get("path")) {
        return json([
            {
                sha: "abc1234",
                commit: { message: "更新文章：测试\n\n正文", author: { name: "花羽", date: "2026-10-15T10:00:00Z" } },
            },
            {
                sha: "def5678",
                commit: { message: "发布文章：测试", author: { name: "花羽", date: "2026-10-14T10:00:00Z" } },
            },
        ]);
    }

    // 文件内容（Contents API）
    const contentMatch = u.pathname.match(/\/contents\/(.+)$/);
    if (contentMatch) {
        const path = decodeURIComponent(contentMatch[1]);
        const ref = u.searchParams.get("ref");

        if (method === "GET") {
            const file = repo.get(path);
            if (!file) return json({ message: "Not Found" }, 404);
            if (ref) {
                // 回滚场景：假装那个 ref 上有同样的内容
                return json({
                    path,
                    type: "file",
                    sha: file.sha,
                    encoding: "base64",
                    content: b64(file.text),
                });
            }
            return json({
                path,
                type: "file",
                sha: file.sha,
                encoding: "base64",
                content: b64(file.text),
            });
        }
        if (method === "PUT") {
            put(path, fromB64(body.content));
            commits.push({ message: body.message, path });
            return json({ content: { path } });
        }
        if (method === "DELETE") {
            repo.delete(path);
            commits.push({ message: body.message, path });
            return json({});
        }
    }

    // 目录列举（删目录用）
    if (contentMatch) {
        const prefix = decodeURIComponent(contentMatch[1]) + "/";
        const entries = Array.from(repo.keys())
            .filter((p) => p.startsWith(prefix))
            .map((p) => ({
                path: p,
                name: p.slice(prefix.length).split("/")[0],
                type: p.slice(prefix.length).includes("/") ? "dir" : "file",
                sha: repo.get(p).sha,
            }));
        if (entries.length) return json(entries);
    }

    // 搜索：GitHub code search 匹配的是文件内容，path: 限定目录
    if (u.pathname === "/search/code") {
        const q = u.searchParams.get("q") || "";
        const needle = q.split(" ")[0];
        const pathFilter = (q.match(/path:(\S+)/) || [])[1];
        const hits = [];
        for (const [path, file] of repo) {
            if (pathFilter && !path.startsWith(pathFilter)) continue;
            if (!file.text.includes(needle)) continue;
            hits.push({ path });
        }
        return json({ total_count: hits.length, items: hits });
    }

    return json({ message: `未打桩的请求：${method} ${u.pathname}` }, 500);
};

/* ------------------------------------------------------------ 调用助手 */

let cookie = "";

async function call(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
    if (options.body) headers["Content-Type"] = "application/json";

    const request = new Request("https://admin.test" + path, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const res = await worker.fetch(request, ENV, {});
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, res };
}

/* ------------------------------------------------------------ 断言 */

let pass = 0;
let fail = 0;

async function check(name, fn) {
    try {
        const detail = await fn();
        console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`);
        pass++;
    } catch (err) {
        console.log(`  ✗ ${name}\n      ${err.message}`);
        fail++;
    }
}

function eq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
    return `${label} = ${JSON.stringify(actual)}`;
}

/* ------------------------------------------------------------ 准备 */

console.log("\n鉴权");
const noAuth = await call("/api/posts");
await check("未登录时返回 401", () => eq(noAuth.status, 401, "status"));

const token = await signSession(
    {
        login: "huayu0824",
        name: "花羽",
        avatar: "https://example.com/a.png",
        token: "gh-token",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SECRET
);
cookie = token;

const session = await call("/api/session");
await check("会话信息可读", () => {
    if (session.status !== 200) throw new Error("status = " + session.status);
    eq(session.data.login, "huayu0824", "login");
    eq(session.data.repo, "huayu0824/huayu0824.github.io", "repo");
    return "repo = " + session.data.repo;
});

/* ------------------------------------------------------------ 列表 */

console.log("\n列表接口");
put("content/posts/2026-06-23-with-u/index.md", [
    "---",
    'title: "WITH-U：我把另一个自己写进了代码里"',
    "date: 2026-06-23",
    "tags:",
    "  - ESP32",
    "  - AI",
    "---",
    "",
    "正文内容",
].join("\n"));
put("content/notes/my-note.md", ["---", 'title: "一条笔记"', "date: 2026-10-15", "---", "", "笔记正文"].join("\n"));
put("content/series/my-series/index.md", ["---", 'title: "我的系列"', "date: 2026-10-15", "---", "", "系列正文"].join("\n"));
put("content/books/my-book/index.md", [
    "---", 'title: "一本书"', "date: 2026-10-15", "chapters:", "  - title: 第一章", "    id: chapter-1", "---", "", "书籍正文",
].join("\n"));
put("content/about.md", ["---", 'title: "关于"', "---", "", "关于页正文"].join("\n"));
put("content/flows/2026/10/15.md", ["---", "date: 2026-10-15", "---", "", "随笔"].join("\n"));

const listPosts = await call("/api/posts");
await check("文章列表", () => {
    if (listPosts.status !== 200) throw new Error("status = " + listPosts.status);
    eq(listPosts.data.items.length, 1, "文章数");
    eq(listPosts.data.items[0].slug, "with-u", "slug");
    eq(listPosts.data.total, 1, "total");
    return "1 篇";
});

for (const [type, expect] of [["notes", "my-note"], ["series", "my-series"], ["books", "my-book"], ["pages", "about"]]) {
    const res = await call(`/api/${type}`);
    check(`${type} 列表`, () => {
        if (res.status !== 200) throw new Error("status = " + res.status);
        eq(res.data.items.length, 1, "条目数");
        const item = res.data.items[0];
        const key = item.slug || item.name;
        eq(key, expect, "key");
        return "key = " + key;
    });
}

/* ------------------------------------------------------------ 详情 */

console.log("\n详情接口");
const getNote = await call("/api/notes/my-note");
await check("笔记详情带 content 与 url", () => {
    if (getNote.status !== 200) throw new Error("status = " + getNote.status);
    eq(getNote.data.content.trim(), "笔记正文", "content");
    eq(getNote.data.url, "/notes/my-note", "url");
    return "url = " + getNote.data.url;
});

const getPage = await call("/api/pages/about");
await check("页面详情", () => {
    if (getPage.status !== 200) throw new Error("status = " + getPage.status);
    eq(getPage.data.url, "/about", "url");
    return "url = " + getPage.data.url;
});

const getSeries = await call("/api/series/my-series");
await check("系列详情带成员列表", () => {
    if (getSeries.status !== 200) throw new Error("status = " + getSeries.status);
    if (!Array.isArray(getSeries.data.members)) throw new Error("members 不是数组");
    return "members = " + getSeries.data.members.length;
});

const getBook = await call("/api/books/my-book");
await check("书籍详情带章节正文", () => {
    if (getBook.status !== 200) throw new Error("status = " + getBook.status);
    eq(getBook.data.chapters.length, 1, "章节数");
    eq(getBook.data.chapters[0].id, "chapter-1", "章节 id");
    return "章节 id = " + getBook.data.chapters[0].id;
});

/* ------------------------------------------------------------ 校验 */

console.log("\n参数校验");
await check("笔记缺 title 被拒", async () => {
    const res = await call("/api/notes", { method: "POST", body: { slug: "no-title", content: "x" } });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("书籍缺 date 被拒", async () => {
    const res = await call("/api/books", { method: "POST", body: { slug: "no-date", title: "T", chapters: [] } });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("非法 slug 被拒", async () => {
    const res = await call("/api/notes/bad%20slug", { method: "PUT", body: { title: "T" } });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("不存在的条目返回 404", async () => {
    const res = await call("/api/notes/nope");
    if (res.status !== 404) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("未知接口返回 404", async () => {
    const res = await call("/api/unknown-thing");
    if (res.status !== 404) throw new Error("status = " + res.status);
    return res.data.error;
});

/* ------------------------------------------------------------ 写入 */

console.log("\n写入");
const created = await call("/api/notes", {
    method: "POST",
    body: { slug: "new-note", title: "新笔记", date: "2026-10-21", tags: "a, b", content: "正文" },
});
await check("新建笔记写入 content/notes/<slug>.md", () => {
    if (created.status !== 200) throw new Error("status = " + created.status + " " + JSON.stringify(created.data));
    eq(created.data.key, "new-note", "key");
    eq(created.data.path, "content/notes/new-note.md", "path");
    if (!repo.has("content/notes/new-note.md")) throw new Error("文件没落盘");
    const text = repo.get("content/notes/new-note.md").text;
    if (!text.includes("title: 新笔记")) throw new Error("front matter 里没有 title");
    if (!text.includes("- a")) throw new Error("标签没有写成数组");
    return "path = " + created.data.path;
});

const createdPage = await call("/api/pages", {
    method: "POST",
    body: { name: "colophon", title: "版本说明", date: "2026-10-21", layout: "simple", content: "说明" },
});
await check("新建页面写入 content/<name>.md", () => {
    if (createdPage.status !== 200) throw new Error("status = " + createdPage.status);
    eq(createdPage.data.path, "content/colophon.md", "path");
    return "path = " + createdPage.data.path;
});

const createdSeries = await call("/api/series", {
    method: "POST",
    body: { slug: "new-series", title: "新系列", date: "2026-10-21", content: "系列正文" },
});
await check("新建系列写入 content/series/<slug>/index.md", () => {
    if (createdSeries.status !== 200) throw new Error("status = " + createdSeries.status);
    eq(createdSeries.data.path, "content/series/new-series/index.md", "path");
    const text = repo.get("content/series/new-series/index.md").text;
    if (!text.includes("posts: []")) throw new Error("posts 数组没有留空");
    return "posts 已留空";
});

const createdBook = await call("/api/books", {
    method: "POST",
    body: { slug: "new-book", title: "新书", date: "2026-10-21", chapters: [{ id: "c1", title: "第一章" }] },
});
await check("新建书籍同时补出章节文件", () => {
    if (createdBook.status !== 200) throw new Error("status = " + createdBook.status);
    eq(createdBook.data.path, "content/books/new-book/index.md", "索引路径");
    if (!repo.has("content/books/new-book/c1.md")) throw new Error("章节文件没生成");
    return "章节文件已生成";
});

const updatedNote = await call("/api/notes/new-note", {
    method: "PUT",
    body: { slug: "new-note", title: "改过的笔记", date: "2026-10-21", content: "新正文" },
});
await check("更新笔记", () => {
    if (updatedNote.status !== 200) throw new Error("status = " + updatedNote.status);
    const text = repo.get("content/notes/new-note.md").text;
    if (!text.includes("改过的笔记")) throw new Error("标题没更新");
    return "标题已更新";
});

/* ------------------------------------------------------------ 系列成员 */

console.log("\n系列成员");
const attach = await call("/api/series/my-series/posts", {
    method: "PUT",
    body: { slugs: ["with-u"] },
});
await check("挂文章到系列会写 series 字段", () => {
    if (attach.status !== 200) throw new Error("status = " + attach.status);
    eq(attach.data.changed, 1, "改动数");
    const text = repo.get("content/posts/2026-06-23-with-u/index.md").text;
    if (!text.includes("series: my-series")) throw new Error("文章里没写上 series 字段");
    return "series 字段已写入";
});

const detach = await call("/api/series/my-series/posts", { method: "PUT", body: { slugs: [] } });
await check("取消关联会移除 series 字段", () => {
    if (detach.status !== 200) throw new Error("status = " + detach.status);
    const text = repo.get("content/posts/2026-06-23-with-u/index.md").text;
    if (text.includes("series: my-series")) throw new Error("series 字段还在");
    return "series 字段已移除";
});

/* ------------------------------------------------------------ 合集 */

console.log("\n合集（type: collection）");
const createCollection = await call("/api/series", {
    method: "POST",
    body: {
        slug: "my-collection",
        title: "我的合集",
        date: "2026-10-21",
        type: "collection",
        items: [{ post: "posts/with-u" }],
    },
});
await check("新建合集写入 type: collection + items，不写 posts", () => {
    if (createCollection.status !== 200) throw new Error("status = " + createCollection.status);
    const text = repo.get("content/series/my-collection/index.md").text;
    if (!text.includes("type: collection")) throw new Error("type 没写上");
    if (!text.includes("items:")) throw new Error("items 没写上");
    if (text.includes("posts:")) throw new Error("合集不该有 posts 字段");
    return "type/items 已写入";
});

await check("合集详情返回 type 与 items", async () => {
    const res = await call("/api/series/my-collection");
    if (res.status !== 200) throw new Error("status = " + res.status);
    eq(res.data.type, "collection", "type");
    eq(res.data.items.length, 1, "成员数");
    eq(res.data.items[0].post, "posts/with-u", "成员引用键");
    return "type = collection";
});

await check("空合集被拒（amytis 不接受，会让整站构建失败）", async () => {
    const res = await call("/api/series", {
        method: "POST",
        body: { slug: "empty-collection", title: "空合集", date: "2026-10-21", type: "collection", items: [] },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("引用不存在的文章被拒", async () => {
    const res = await call("/api/series", {
        method: "POST",
        body: {
            slug: "bad-collection", title: "坏合集", date: "2026-10-21",
            type: "collection", items: [{ post: "posts/does-not-exist" }],
        },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("引用不存在的系列被拒", async () => {
    const res = await call("/api/series", {
        method: "POST",
        body: {
            slug: "bad-collection-2", title: "坏合集2", date: "2026-10-21",
            type: "collection", items: [{ series: "no-such-series" }],
        },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("合集可以整包收编一个存在的系列", async () => {
    const res = await call("/api/series", {
        method: "POST",
        body: {
            slug: "collection-2", title: "收编合集", date: "2026-10-21",
            type: "collection", items: [{ series: "my-series", exclude: ["skip-me"] }],
        },
    });
    if (res.status !== 200) throw new Error("status = " + res.status);
    const text = repo.get("content/series/collection-2/index.md").text;
    if (!text.includes("series: my-series")) throw new Error("系列引用没写上");
    return "系列已收编";
});

await check("从合集切回系列会清掉 type 和 items", async () => {
    const res = await call("/api/series/my-collection", {
        method: "PUT",
        body: { title: "我的合集", date: "2026-10-21", type: "" },
    });
    if (res.status !== 200) throw new Error("status = " + res.status);
    const text = repo.get("content/series/my-collection/index.md").text;
    if (text.includes("type: collection")) throw new Error("type 没清掉");
    if (text.includes("items:")) throw new Error("items 没清掉");
    if (!text.includes("posts: []")) throw new Error("posts 应该留空");
    return "已切成系列";
});

/* ------------------------------------------------------------ 站点设置 */

console.log("\n站点设置");
put("site.settings.json", JSON.stringify({
    title: { zh: "旧名字", en: "Old" },
    nav: [{ name: "文章", url: "/posts", weight: 1 }],
}, null, 2));

const getSettings = await call("/api/settings");
await check("读取站点设置", () => {
    if (getSettings.status !== 200) throw new Error("status = " + getSettings.status);
    eq(getSettings.data.settings.title.zh, "旧名字", "title");
    eq(getSettings.data.path, "site.settings.json", "path");
    return "设置已读出";
});

const putSettings = await call("/api/settings", {
    method: "PUT",
    body: { settings: { title: { zh: "新名字", en: "New" }, nav: [{ name: "文章", url: "/posts", weight: 1 }] } },
});
await check("保存站点设置写进 site.settings.json", () => {
    if (putSettings.status !== 200) throw new Error("status = " + putSettings.status);
    const text = repo.get("site.settings.json").text;
    if (!text.includes("新名字")) throw new Error("标题没写进去");
    if (!text.includes("nav")) throw new Error("导航没写进去");
    return "已写入";
});

await check("设置结构不对被拒（写坏了站点会构建失败）", async () => {
    const res = await call("/api/settings", {
        method: "PUT",
        body: { settings: { nav: [{ name: "缺 url" }] } },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

await check("页面开关必须是布尔值", async () => {
    const res = await call("/api/settings", {
        method: "PUT",
        body: { settings: { features: { series: { enabled: "yes" } } } },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

/* ------------------------------------------------------------ 页面文字 */

console.log("\n页面文字");
put("src/i18n/translations.ts", [
    "export const translations = {",
    "  en: {",
    '    home: "Home",',
    '    archive: "Archive",',
    "  },",
    "  zh: {",
    '    home: "首页",',
    '    archive: "归档",',
    "  },",
    "};",
].join("\n"));
put("site.texts.json", JSON.stringify({ zh: {}, en: {} }, null, 2));

const getTexts = await call("/api/texts");
await check("读取页面文字时带上默认词条", () => {
    if (getTexts.status !== 200) throw new Error("status = " + getTexts.status);
    eq(getTexts.data.defaults.zh.home, "首页", "默认词条");
    eq(getTexts.data.defaults.en.archive, "Archive", "英文默认词条");
    return "默认词条已读出";
});

await check("保存页面文字覆盖", async () => {
    const res = await call("/api/texts", {
        method: "PUT",
        body: { overrides: { zh: { home: "首页改过了" } } },
    });
    if (res.status !== 200) throw new Error("status = " + res.status);
    const text = repo.get("site.texts.json").text;
    if (!text.includes("首页改过了")) throw new Error("没写进去");
    return "已写入 site.texts.json";
});

await check("不存在的文案键被拒（写了也不生效）", async () => {
    const res = await call("/api/texts", {
        method: "PUT",
        body: { overrides: { zh: { not_a_real_key: "随便写" } } },
    });
    if (res.status !== 400) throw new Error("status = " + res.status);
    return res.data.error;
});

/* ------------------------------------------------------------ 历史 */

console.log("\n版本历史");
const history = await call("/api/history?type=notes&key=new-note");
await check("取到提交历史", () => {
    if (history.status !== 200) throw new Error("status = " + history.status);
    eq(history.data.items.length, 2, "条数");
    eq(history.data.items[0].sha, "abc1234", "最新 sha");
    return "2 条记录";
});

const restore = await call("/api/history", {
    method: "POST",
    body: { type: "notes", key: "new-note", sha: "abc1234" },
});
await check("回滚会写回文件", () => {
    if (restore.status !== 200) throw new Error("status = " + restore.status);
    return restore.data.message;
});

/* ------------------------------------------------------------ 图片库 */

console.log("\n图片库");
put("content/posts/2026-06-23-with-u/images/cover.png", "fake");
const images = await call("/api/images");
await check("列出仓库里的图片", () => {
    if (images.status !== 200) throw new Error("status = " + images.status);
    eq(images.data.items.length, 1, "图片数");
    eq(images.data.items[0].url, "/posts/2026-06-23-with-u/images/cover.png", "url");
    return "url = " + images.data.items[0].url;
});

const delImage = await call("/api/images?path=" + encodeURIComponent("content/posts/2026-06-23-with-u/images/cover.png"), {
    method: "DELETE",
});
await check("删除图片", () => {
    if (delImage.status !== 200) throw new Error("status = " + delImage.status);
    if (repo.has("content/posts/2026-06-23-with-u/images/cover.png")) throw new Error("文件还在");
    return "已删除";
});

const badImage = await call("/api/images?path=etc/passwd", { method: "DELETE" });
await check("拒绝删仓库外的路径", () => {
    if (badImage.status !== 400) throw new Error("status = " + badImage.status);
    return badImage.data.error;
});

/* ------------------------------------------------------------ 批量 */

console.log("\n批量操作");
const batch = await call("/api/batch", {
    method: "POST",
    body: { type: "notes", action: "delete", keys: ["new-note"] },
});
await check("批量删除", () => {
    if (batch.status !== 200) throw new Error("status = " + batch.status);
    if (repo.has("content/notes/new-note.md")) throw new Error("文件还在");
    return batch.data.message;
});

const draft = await call("/api/batch", {
    method: "POST",
    body: { type: "notes", action: "draft", keys: ["my-note"] },
});
await check("批量转草稿", () => {
    if (draft.status !== 200) throw new Error("status = " + draft.status);
    const text = repo.get("content/notes/my-note.md").text;
    if (!text.includes("draft: true")) throw new Error("draft 字段没写上");
    return "draft 字段已写入";
});

const badBatch = await call("/api/batch", {
    method: "POST",
    body: { type: "notes", action: "explode", keys: ["my-note"] },
});
await check("不支持的批量操作被拒", () => {
    if (badBatch.status !== 400) throw new Error("status = " + badBatch.status);
    return badBatch.data.error;
});

/* ------------------------------------------------------------ 搜索 */

console.log("\n搜索与排序");
const searched = await call("/api/notes?q=笔记");
await check("搜索命中路径", () => {
    if (searched.status !== 200) throw new Error("status = " + searched.status);
    if (!searched.data.items.length) throw new Error("没有命中");
    return "命中 " + searched.data.items.length + " 条";
});

const sorted = await call("/api/posts?sort=date-asc");
await check("按日期升序", () => {
    if (sorted.status !== 200) throw new Error("status = " + sorted.status);
    return "ok";
});

/* ------------------------------------------------------------ 汇总 */

console.log(`\n${fail === 0 ? "全部通过" : "存在失败"}：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
