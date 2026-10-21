/**
 * 本地假服务器：用内存里的假仓库顶替 GitHub API，方便在浏览器里调后台前端。
 *
 * 只用于开发调试，不参与部署。
 * 运行：bun run scripts/dev-mock.mjs   然后打开 http://127.0.0.1:8788
 */
import http from "http";
import fs from "fs";
import path from "path";

const PUBLIC = path.resolve(import.meta.dir, "..", "public");
const PORT = Number(process.env.PORT || 8788);

/* ------------------------------------------------------- 内存仓库 */

const repo = new Map();
let shaCounter = 0;
const nextSha = () => "sha" + String(++shaCounter).padStart(4, "0");

function put(p, text) {
    repo.set(p, { text, sha: nextSha() });
}
function remove(p) {
    repo.delete(p);
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const fromB64 = (s) => Buffer.from(s, "base64").toString("utf8");

/* ------------------------------------------------------- 初始内容 */

put("content/posts/2026-06-23-with-u/index.md", [
    "---",
    'title: "WITH-U：我把另一个自己写进了代码里"',
    "date: 2026-06-23",
    "category: 项目",
    "tags:",
    "  - ESP32",
    "  - AI",
    "  - 玩偶",
    "authors:",
    "  - 花羽",
    "---",
    "",
    "## 起点",
    "",
    "重回到山东，一千多公里。",
    "",
    "## 过程",
    "",
    "把声音和性格写进了一个玩偶里。",
].join("\n"));

put("content/posts/2026-04-21-why-this-blog/index.md", [
    "---",
    'title: "为什么我要建立这个体育笔记"',
    "date: 2026-04-21",
    "category: 网站",
    "tags:",
    "  - Blog",
    "---",
    "",
    "这是我通过手机发布的第一篇文章。",
].join("\n"));

put("content/posts/2026-04-18-first-post/index.md", [
    "---",
    'title: "我的第一篇博客"',
    "date: 2026-04-18",
    "category: 网站",
    "tags:",
    "  - 科技",
    "---",
    "",
    "Hello World! 终于要成功了！",
].join("\n"));

put("content/notes/gym-basics.md", [
    "---",
    'title: "深蹲的几个要点"',
    "date: 2026-10-18",
    "tags:",
    "  - 训练",
    "---",
    "",
    "## 脚踝活动度",
    "",
    "下蹲时脚踝跟不上，膝盖就会内扣。",
].join("\n"));

put("content/series/with-u-story/index.md", [
    "---",
    'title: "WITH-U 制作手记"',
    "date: 2026-10-10",
    'excerpt: "把另一个自己写进代码的全过程"',
    "tags:",
    "  - 项目",
    "posts: []",
    "---",
    "",
    "这个系列记录 WITH-U 的制作过程。",
].join("\n"));

// 合集：跟系列同一个文件夹，靠 type: collection 区分
put("content/series/training-picks/index.md", [
    "---",
    'title: "训练精选"',
    "date: 2026-10-20",
    'excerpt: "把几篇训练相关的文章挑到一起"',
    "tags:",
    "  - 训练",
    "type: collection",
    "items:",
    "  - post: posts/with-u",
    "  - post: posts/first-post",
    "---",
    "",
    "这个合集把零散的训练文章挑到一起，不改它们各自的系列归属。",
].join("\n"));

put("content/books/home-gym/index.md", [
    "---",
    'title: "家庭训练手册"',
    "date: 2026-10-01",
    'excerpt: "没有器械也能练的方案"',
    "chapters:",
    "  - title: 下肢基础",
    "    id: lower-body",
    "  - title: 上肢基础",
    "    id: upper-body",
    "---",
    "",
    "这本书讲的是家里怎么练。",
].join("\n"));
put("content/books/home-gym/lower-body.md", ["---", 'title: "下肢基础"', "---", "", "深蹲与箭步蹲。"].join("\n"));
put("content/books/home-gym/upper-body.md", ["---", 'title: "上肢基础"', "---", "", "俯卧撑与划船。"].join("\n"));

put("content/about.md", ["---", 'title: "关于"', "layout: simple", "---", "", "学体育的，现在主要在做硬件和 AI。"].join("\n"));
put("content/links.md", ["---", 'title: "友链"', "---", "", "一些有趣的地方。"].join("\n"));

put("content/flows/2026/10/15.md", ["---", "date: 2026-10-15", "---", "", "今天把后台重写了一遍。"].join("\n"));
put("content/flows/2026/10/14.md", ["---", "date: 2026-10-14", "---", "", "随手一句。"].join("\n"));

put("content/posts/2026-06-23-with-u/images/cover.png", "fake-png");

/* ------------------------------------------------------- 站点设置（假数据） */

put("site.settings.json", JSON.stringify({
    title: { zh: "花羽的体育笔记", en: "花羽的体育笔记" },
    description: { zh: "学体育的，现在主要在做硬件和 AI。", en: "" },
    logo: { src: "/images/avatar.png", favicon: "/icon.svg" },
    ogImage: "/og-image.png",
    hero: {
        tagline: { zh: "花羽的体育笔记", en: "" },
        title: { zh: "在传统的底色上，画一点未来的东西。", en: "" },
        subtitle: { zh: "体育教育出身，现在主要在做硬件和 AI。", en: "" },
    },
    features: {
        posts: { enabled: true, name: { zh: "文章", en: "Posts" } },
        series: { enabled: true, name: { zh: "系列", en: "Series" } },
        books: { enabled: true, name: { zh: "书籍", en: "Books" } },
        flow: { enabled: true, name: { zh: "随笔", en: "Flow" } },
    },
    homepage: {
        sections: [
            { id: "hero", enabled: true, weight: 1 },
            { id: "featured-posts", enabled: true, weight: 2, maxItems: 4 },
            { id: "latest-posts", enabled: true, weight: 3, maxItems: 3 },
            { id: "recent-flows", enabled: true, weight: 4, maxItems: 8 },
            { id: "featured-series", enabled: true, weight: 5, maxItems: 6 },
            { id: "featured-books", enabled: true, weight: 6, maxItems: 4 },
        ],
    },
    nav: [
        { name: "文章", url: "/posts", weight: 1 },
        { name: "随笔", url: "/flows", weight: 2 },
        { name: "笔记", url: "/notes", weight: 3 },
        { name: "系列", url: "/series", weight: 4 },
        { name: "书籍", url: "/books", weight: 5 },
        { name: "关于", url: "/about", weight: 6 },
        { name: "更多", url: "", weight: 7, children: [
            { name: "归档", url: "/archive" },
            { name: "标签", url: "/tags" },
            { name: "友链", url: "/links" },
        ]},
    ],
    footer: {
        explore: [{ name: "文章", url: "/posts", weight: 1 }],
        connect: [{ name: "GitHub", url: "https://github.com/huayu0824", weight: 1 }],
        builtWith: { show: true, url: "https://github.com/hutusi/amytis", text: "Built with Amytis" },
        bottomLinks: [],
    },
    footerText: { zh: "© 2026 花羽的体育笔记", en: "© 2026 花羽的体育笔记" },
    social: {
        github: "https://github.com/huayu0824",
        twitter: "https://twitter.com/Blue_Jingling",
        bilibili: "https://bilibili.com/454659285",
    },
    share: { enabled: true, platforms: ["twitter", "weibo", "zhihu", "copy"] },
}, null, 2));

put("site.texts.json", JSON.stringify({ zh: {}, en: {} }, null, 2));

const TEXT_DEFAULTS = {
    zh: {
        home: "首页",
        archive: "归档",
        tags: "标签",
        notes: "笔记",
        series: "系列",
        books: "书籍",
        flow: "随笔",
        posts: "文章",
        view_all_posts: "查看全部 {count} 篇文章",
        no_posts: "还没有内容",
    },
    en: {
        home: "Home",
        archive: "Archive",
        tags: "Tags",
        notes: "Notes",
        series: "Series",
        books: "Books",
        flow: "Flow",
        posts: "Posts",
    },
};

/* ------------------------------------------------------- 内容解析 */

function parse(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { data: {}, body: text };
    const data = {};
    for (const line of m[1].split("\n")) {
        const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (!kv) continue;
        const key = kv[1];
        let val = kv[2].trim();
        if (val.startsWith("[")) {
            try { data[key] = JSON.parse(val.replace(/'/g, '"')); } catch (e) { data[key] = val; }
        } else if (val === "true" || val === "false") {
            data[key] = val === "true";
        } else if (val === "[]") {
            data[key] = [];
        } else {
            data[key] = val.replace(/^["']|["']$/g, "");
        }
    }
    // 列表型字段（tags / chapters / items）单独处理
    // chapters 与 items 是对象数组（- title: xx / id: yy），要能把续行并进同一个对象
    const lines = m[1].split("\n");
    for (const key of ["tags", "chapters", "items"]) {
        const start = lines.findIndex((l) => l.startsWith(key + ":"));
        if (start < 0) continue;
        if (lines[start].includes("[]")) continue;

        const items = [];
        let cur = null;
        for (let i = start + 1; i < lines.length; i++) {
            const line = lines[i];
            const item = line.match(/^\s+-\s+(.*)$/);
            if (item) {
                if (cur !== null) items.push(cur);
                const raw = item[1].trim();
                const colon = raw.indexOf(":");
                if (colon > 0) {
                    const k = raw.slice(0, colon).trim();
                    cur = { [k]: raw.slice(colon + 1).trim().replace(/^["']|["']$/g, "") };
                } else {
                    cur = raw.replace(/^["']|["']$/g, "");
                }
                continue;
            }
            // 续行：并进当前对象
            const cont = line.match(/^\s+([A-Za-z_]+):\s*(.*)$/);
            if (cont && cur && typeof cur === "object") {
                cur[cont[1]] = cont[2].trim().replace(/^["']|["']$/g, "");
                continue;
            }
            break;
        }
        if (cur !== null) items.push(cur);
        if (items.length) data[key] = items;
    }
    return { data, body: text.slice(m[0].length) };
}

function listOf(prefix, re, keyFn) {
    const out = [];
    for (const [p, v] of repo) {
        const m = p.match(re);
        if (!m) continue;
        out.push({ key: keyFn(m), path: p, sha: v.sha, text: v.text });
    }
    return out;
}

function collect() {
    return {
        posts: listOf("posts", /^content\/posts\/([^/]+)\/index\.md$/, (m) => m[1].replace(/^\d{4}-\d{2}-\d{2}-/, "")),
        notes: listOf("notes", /^content\/notes\/([^/]+)\.md$/, (m) => m[1]),
        series: listOf("series", /^content\/series\/([^/]+)\/index\.md$/, (m) => m[1]),
        books: listOf("books", /^content\/books\/([^/]+)\/index\.md$/, (m) => m[1]),
        pages: listOf("pages", /^content\/([^/]+)\.md$/, (m) => m[1]),
        flows: listOf("flows", /^content\/flows\/(\d{4})\/(\d{2})\/(\d{2})\.md$/, (m) => `${m[1]}-${m[2]}-${m[3]}`),
    };
}

const all = collect();
const byKey = (type, key) => (all[type] || []).find((x) => x.key === key);

function words(text) {
    return (text.match(/[一-龥]/g) || []).length + (text.match(/[A-Za-z0-9]+/g) || []).length;
}

function summarize(type, entry) {
    const { data, body } = parse(entry.text);
    return {
        title: data.title || entry.key,
        date: data.date || "",
        excerpt: data.excerpt || "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: data.draft === true,
        featured: data.featured === true,
        series: data.series || "",
        chapterCount: Array.isArray(data.chapters) ? data.chapters.length : 0,
        // 系列 / 合集是同一种文件夹，靠 type: collection 区分
        type: data.type === "collection" ? "collection" : "series",
        items: Array.isArray(data.items) ? data.items : [],
        words: words(body),
    };
}

/* ------------------------------------------------------- 路由 */

const TYPES = {
    posts: { base: "/api/posts", key: "slug", url: (k) => `/posts/${k}/` },
    flows: { base: "/api/flows", key: "date", url: (k) => `/flows/${k.replace(/-/g, "/")}/` },
    notes: { base: "/api/notes", key: "slug", url: (k) => `/notes/${k}` },
    series: { base: "/api/series", key: "slug", url: (k) => `/series/${k}` },
    books: { base: "/api/books", key: "slug", url: (k) => `/books/${k}` },
    pages: { base: "/api/pages", key: "name", url: (k) => `/${k}` },
};

const KEY_FIELD = {
    posts: "slug",
    flows: "date",
    notes: "slug",
    series: "slug",
    books: "slug",
    pages: "name",
};

function listType(type, url) {
    const entries = all[type] || [];
    const keyField = KEY_FIELD[type];

    // 真实 Worker 支持分页，假服务器也要老实分页，
    // 否则分页相关的 bug 在本地根本测不出来
    const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit")) || 40));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const slice = entries.slice(offset, offset + limit);

    return {
        // 真实 Worker 的列表是 { ...entry, ...summary }，entry 里带 slug / name
        items: slice.map((e) => {
            const { text, ...rest } = e;
            return { ...rest, ...summarize(type, e), [keyField]: e.key };
        }),
        total: entries.length,
        offset,
        limit,
        truncated: false,
    };
}

function detailType(type, key) {
    const entry = byKey(type, key);
    if (!entry) return { status: 404, body: { error: "不存在" } };
    const { data, body } = parse(entry.text);
    const out = {
        key,
        [TYPES[type].key]: key,
        ...summarize(type, entry),
        content: body,
        path: entry.path,
        url: TYPES[type].url(key),
    };
    if (type === "series") {
        const isCollection = data.type === "collection";
        out.members = isCollection
            ? []
            : (all.posts || [])
                .filter((p) => parse(p.text).data.series === key)
                .map((p) => ({ slug: p.key, title: parse(p.text).data.title || p.key, date: parse(p.text).data.date || "" }));
        out.items = isCollection && Array.isArray(data.items) ? data.items : [];
    }
    if (type === "books") {
        out.chapters = (Array.isArray(data.chapters) ? data.chapters : []).map((ch) => {
            const cp = `content/books/${key}/${ch.id}.md`;
            const f = repo.get(cp);
            return { id: ch.id, title: ch.title, content: f ? parse(f.text).body : "", path: cp, exists: Boolean(f) };
        });
    }
    return { status: 200, body: out };
}

function pathFor(type, key) {
    if (type === "posts") {
        const entry = (all.posts || []).find((p) => p.key === key);
        return entry ? entry.path : null;
    }
    if (type === "flows") return `content/flows/${key.replace(/-/g, "/")}.md`;
    if (type === "notes") return `content/notes/${key}.md`;
    if (type === "series") return `content/series/${key}/index.md`;
    if (type === "books") return `content/books/${key}/index.md`;
    if (type === "pages") return `content/${key}.md`;
    return null;
}

function yamlOf(data) {
    const lines = [];
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === "") continue;
        if (Array.isArray(v)) {
            if (!v.length) { lines.push(`${k}: []`); continue; }
            lines.push(`${k}:`);
            for (const item of v) {
                if (item && typeof item === "object") {
                    const pairs = Object.entries(item);
                    lines.push(`  - ${pairs[0][0]}: ${pairs[0][1]}`);
                    for (const [ik, iv] of pairs.slice(1)) {
                        if (Array.isArray(iv)) {
                            lines.push(`    ${ik}:`);
                            for (const x of iv) lines.push(`      - ${x}`);
                        } else {
                            lines.push(`    ${ik}: ${iv}`);
                        }
                    }
                } else {
                    lines.push(`  - ${item}`);
                }
            }
        } else if (typeof v === "boolean") {
            lines.push(`${k}: ${v}`);
        } else {
            lines.push(`${k}: ${v}`);
        }
    }
    return `---\n${lines.join("\n")}\n---\n\n`;
}

function saveType(type, key, input) {
    const t = TYPES[type];
    const k = input[t.key] || key;
    if (!k) return { status: 400, body: { error: "缺少标识" } };
    if (!input.title) return { status: 400, body: { error: "标题不能为空" } };

    const path = pathFor(type, k);
    const existing = repo.get(path);
    const { data: old } = existing ? parse(existing.text) : { data: {} };

    const data = { ...old };
    for (const [key2, val] of Object.entries(input)) {
        if (key2 === "content") continue;
        if (val === "") continue;
        data[key2] = val;
    }
    if (type === "series") {
        // 系列：posts 留空，靠文章的 series 字段收集
        // 合集：type: collection + items 手工挑成员
        if (input.type === "collection") {
            data.type = "collection";
            data.items = Array.isArray(input.items) ? input.items : [];
            delete data.posts;
        } else {
            data.posts = [];
            delete data.type;
            delete data.items;
        }
    }
    if (type === "books") {
        data.chapters = Array.isArray(input.chapters) ? input.chapters : (data.chapters || []);
        for (const ch of data.chapters) {
            const cp = `content/books/${k}/${ch.id}.md`;
            if (!repo.has(cp)) put(cp, `---\ntitle: ${ch.title}\n---\n\n`);
        }
    }
    data.title = input.title;
    if (input.draft !== undefined) data.draft = input.draft;
    if (input.featured !== undefined) data.featured = input.featured;

    put(path, yamlOf(data) + (input.content || ""));
    return { status: 200, body: { ok: true, key: k, path, message: "已保存", created: !existing } };
}

function deleteType(type, key) {
    const path = pathFor(type, key);
    if (!path || !repo.has(path)) return { status: 404, body: { error: "不存在" } };
    if (type === "books" || type === "series" || type === "posts") {
        const prefix = path.replace(/\/index\.md$/, "") + "/";
        for (const p of Array.from(repo.keys())) {
            if (p.startsWith(prefix)) remove(p);
        }
    }
    remove(path);
    return { status: 200, body: { ok: true, message: "已删除" } };
}

/* ------------------------------------------------------- HTTP */

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
    // 路径以 // 开头时 new URL 会当成协议相对地址，直接炸掉
    const raw = req.url.startsWith("//") ? "/" + req.url.replace(/^\/+/, "") : req.url;
    const url = new URL(raw, "http://127.0.0.1");
    const p = url.pathname;
    console.log(`[${req.method}] ${p}${url.search}`);

    if (p.startsWith("/api/")) {
        let body = {};
        if (req.method !== "GET" && req.method !== "DELETE") {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { body = {}; }
        }
        const send = (status, obj) => {
            const payload = Buffer.from(JSON.stringify(obj), "utf8");
            console.log(`   → ${status} ${payload.toString("utf8").slice(0, 120)}`);
            res.writeHead(status, {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": payload.length,
                "Connection": "close",
            });
            res.end(payload);
        };

        if (p === "/api/session") {
            return send(200, {
                login: "huayu0824", name: "花羽", avatar: "",
                repo: "huayu0824/huayu0824.github.io", branch: "main", defaultAuthor: "花羽",
            });
        }

        if (p === "/api/settings") {
            if (req.method === "PUT") {
                const incoming = body.settings || body;
                put("site.settings.json", JSON.stringify(incoming, null, 2) + "\n");
                return send(200, { ok: true, path: "site.settings.json", message: "站点设置已保存，约 1 分钟后站点生效" });
            }
            const file = repo.get("site.settings.json");
            return send(200, {
                ok: true,
                path: "site.settings.json",
                exists: Boolean(file),
                settings: file ? JSON.parse(file.text) : {},
            });
        }

        if (p === "/api/texts") {
            if (req.method === "PUT") {
                const incoming = body.overrides || body;
                put("site.texts.json", JSON.stringify(incoming, null, 2) + "\n");
                return send(200, { ok: true, path: "site.texts.json", message: "页面文字已保存，约 1 分钟后站点生效" });
            }
            const file = repo.get("site.texts.json");
            return send(200, {
                ok: true,
                path: "site.texts.json",
                exists: Boolean(file),
                defaults: TEXT_DEFAULTS,
                overrides: file ? JSON.parse(file.text) : {},
            });
        }

        if (p === "/api/history") {
            return send(200, {
                ok: true,
                items: [
                    { sha: "a1b2c3d", message: "更新笔记：深蹲的几个要点", date: "2026-10-18T10:00:00Z" },
                    { sha: "e4f5a6b", message: "新建笔记：深蹲的几个要点", date: "2026-10-17T10:00:00Z" },
                ],
            });
        }

        if (p === "/api/images") {
            if (req.method === "DELETE") {
                const target = url.searchParams.get("path");
                remove(target);
                return send(200, { ok: true, message: "图片已删除" });
            }
            const items = [];
            for (const [path, v] of repo) {
                if (/\/images\/[^/]+$/.test(path) || /^public\/uploads\//.test(path)) {
                    items.push({ path, name: path.split("/").pop(), url: "/" + path.replace(/^content\//, "") });
                }
            }
            return send(200, { ok: true, items, total: items.length, offset: 0, limit: 40 });
        }

        if (p === "/api/batch") {
            const action = body.action;
            const keys = body.keys || [];
            for (const k of keys) {
                if (action === "delete") deleteType(body.type, k);
                if (action === "draft") {
                    const path = pathFor(body.type, k);
                    if (path && repo.has(path)) {
                        const { data, body: b } = parse(repo.get(path).text);
                        data.draft = true;
                        put(path, yamlOf(data) + b);
                    }
                }
            }
            return send(200, { ok: true, count: keys.length, message: `已处理 ${keys.length} 项` });
        }

        if (p === "/api/upload") {
            return send(200, { ok: true, path: "public/uploads/mock.png", url: "/uploads/mock.png" });
        }

        for (const [type, t] of Object.entries(TYPES)) {
            if (p === t.base) {
                if (req.method === "GET") return send(200, listType(type, url));
                return send(200, saveType(type, null, body));
            }
            if (p.startsWith(t.base + "/")) {
                const rest = p.slice(t.base.length + 1);
                if (type === "books" && rest.includes("/chapters/")) {
                    const key = rest.split("/")[0];
                    const id = decodeURIComponent(rest.split("/chapters/")[1]);
                    const cp = `content/books/${key}/${id}.md`;
                    if (req.method === "DELETE") {
                        remove(cp);
                        return send(200, { ok: true, message: "章节已删除" });
                    }
                    put(cp, `---\ntitle: ${body.title || id}\n---\n\n${body.content || ""}`);
                    return send(200, { ok: true, id, message: "章节已保存" });
                }
                if (type === "series" && rest.endsWith("/posts")) {
                    const key = decodeURIComponent(rest.slice(0, -"/posts".length));
                    const slugs = body.slugs || [];
                    let changed = 0;
                    for (const post of all.posts || []) {
                        const { data, body: b } = parse(post.text);
                        const want = slugs.includes(post.key);
                        if ((data.series === key) === want) continue;
                        if (want) data.series = key; else delete data.series;
                        put(post.path, yamlOf(data) + b);
                        changed++;
                    }
                    return send(200, { ok: true, changed, message: `已更新 ${changed} 篇文章的系列归属` });
                }
                const key = decodeURIComponent(rest);
                if (req.method === "GET") {
                    const r = detailType(type, key);
                    return send(r.status, r.body);
                }
                if (req.method === "PUT") return send(200, saveType(type, key, body));
                if (req.method === "DELETE") return send(200, deleteType(type, key));
            }
        }

        return send(404, { error: "接口不存在" });
    }

    // 静态文件
    // 注意：一定要 no-store。
    // 不给缓存头的话浏览器会把 app.js 缓存住，改完代码刷新页面拿到的还是旧版，
    // 会出现「明明改对了，界面却没反应」这种极难查的问题。
    let file = p === "/" ? "/index.html" : p;
    const abs = path.join(PUBLIC, file);
    if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not Found");
    }
    res.writeHead(200, {
        "Content-Type": MIME[path.extname(abs)] || "application/octet-stream",
        "Cache-Control": "no-store, must-revalidate",
    });
    res.end(fs.readFileSync(abs));
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`后台假服务器已启动： http://127.0.0.1:${PORT}`);
    console.log(`内存仓库里有 ${repo.size} 个文件`);
});
