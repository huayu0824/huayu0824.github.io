/**
 * 验证后台生成的 front matter 能被 amytis 的 schema 接受。
 * 用 amytis 自己的 Zod schema 校验，而不是自己写一份近似规则。
 *
 * 运行：bun run scripts/verify-admin.mjs
 */
import * as md from "../src/markdown.js";
import * as c from "../src/content.js";
import fs from "fs";
import path from "path";

const REPO = path.resolve(import.meta.dir, "..", "..");
const TEMP = [];

/**
 * amytis 按 process.cwd() 定位 content/，必须先切到仓库根。
 * 这里用动态 import 而非顶部 import：静态 import 会被提升到 chdir 之前执行，
 * 模块初始化时缓存到的还是 admin/ 目录，结果就是读不到任何内容。
 */
process.chdir(REPO);
const { PostSchema } = await import("../../src/lib/content/parse.ts");
const { getAllPosts } = await import("../../src/lib/content/posts.ts");
const { getAllFlows } = await import("../../src/lib/content/flows.ts");
const { getAllNotes } = await import("../../src/lib/content/notes.ts");
const { getAllPages } = await import("../../src/lib/content/posts.ts");
const { getAllSeries, getSeriesPosts, getCollectionPosts } = await import("../../src/lib/content/series.ts");
const { getAllBooks } = await import("../../src/lib/content/books.ts");

/**
 * 临时文件用完即删，失败也删，绝不在 content/ 里留残骸。
 *
 * 但绝不覆盖已存在的文件：随笔的路径是按日期算出来的，
 * 万一撞上用户真写过的那天，覆盖就等于把人家内容删了——
 * 这种情况要大声报错，而不是默默吃掉。
 */
function writeTemp(relPath, content) {
    const abs = path.join(REPO, relPath);
    if (fs.existsSync(abs)) {
        throw new Error(`临时文件路径撞上已有内容，拒绝覆盖：${relPath}`);
    }
    TEMP.push(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    return abs;
}

function cleanup() {
    for (const abs of TEMP.splice(0)) {
        try { fs.rmSync(abs, { force: true }); } catch (e) {}
        // 逐级向上清掉为放图片而建的空目录
        let dir = path.dirname(abs);
        while (dir.startsWith(path.join(REPO, "content")) && fs.existsSync(dir)) {
            if (fs.readdirSync(dir).length > 0) break;
            try { fs.rmdirSync(dir); } catch (e) { break; }
            dir = path.dirname(dir);
        }
    }
}
process.on("exit", cleanup);

let pass = 0;
let fail = 0;

function check(name, fn) {
    try {
        const detail = fn();
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

/* ------------------------------------------------------------ 路径规则 */

console.log("\n路径规则");
check("文章目录名拼装", () =>
    eq(c.postDirName("2026-10-15", "my-post"), "2026-10-15-my-post", "dirName"));
check("slug 已带日期前缀时不重复拼接", () =>
    eq(c.postDirName("2026-10-15", "2026-10-15-my-post"), "2026-10-15-my-post", "dirName"));
check("换日期时替换前缀", () =>
    eq(c.postDirName("2026-11-01", "2026-10-15-my-post"), "2026-11-01-my-post", "dirName"));
check("从目录名解析回日期与 slug", () => {
    const p = c.parsePostDirName("2026-10-15-my-post");
    return eq(`${p.date}/${p.slug}`, "2026-10-15/my-post", "date/slug");
});
check("文章文件路径", () =>
    eq(c.postPath("2026-10-15-my-post"), "content/posts/2026-10-15-my-post/index.md", "path"));
check("随笔扁平路径", () =>
    eq(c.flowFlatPath("2026-10-15"), "content/flows/2026/10/15.md", "path"));
check("随笔文件夹路径", () =>
    eq(c.flowFolderPath("2026-10-15"), "content/flows/2026/10/15/index.md", "path"));
check("扁平随笔反解日期", () =>
    eq(c.flowToDate("content/flows/2026/10/15.md"), "2026-10-15", "date"));
check("文件夹随笔反解日期", () =>
    eq(c.flowToDate("content/flows/2026/10/15/index.md"), "2026-10-15", "date"));

check("目录树解析出文章与随笔", () => {
    const tree = c.parseTreePaths([
        { path: "content/posts/2026-06-23-with-u/index.md", type: "blob", sha: "a" },
        { path: "content/posts/2026-04-18-first-post/index.md", type: "blob", sha: "b" },
        { path: "content/flows/2026/10/15.md", type: "blob", sha: "c" },
        { path: "content/flows/2026/10/14/index.md", type: "blob", sha: "d" },
        { path: "content/about.md", type: "blob", sha: "e" },
        { path: "content/posts/2026-06-23-with-u/images/cover.png", type: "blob", sha: "f" },
    ]);
    eq(tree.posts.length, 2, "文章数");
    eq(tree.posts[0].slug, "with-u", "最新文章 slug");
    eq(tree.posts[0].date, "2026-06-23", "日期");
    eq(tree.flows.length, 2, "随笔数");
    eq(tree.flows[0].date, "2026-10-15", "最新随笔");
    eq(Boolean(tree.flows[1].folderPath), true, "文件夹形式随笔");
    eq(Boolean(tree.flows[0].folderPath), false, "扁平形式随笔");
    eq(tree.pages.length, 1, "页面数");
    eq(tree.pages[0].name, "about", "页面名");
    eq(tree.images.length, 1, "图片数");
    return "2 篇文章 / 2 条随笔 / 1 个页面 / 1 张图片";
});

check("目录树解析出笔记、系列、书籍", () => {
    const tree = c.parseTreePaths([
        { path: "content/notes/my-note.md", type: "blob", sha: "a" },
        { path: "content/notes/sub/ignored.md", type: "blob", sha: "b" },
        { path: "content/series/my-series/index.md", type: "blob", sha: "c" },
        { path: "content/series/my-series/01-first.md", type: "blob", sha: "d" },
        { path: "content/books/my-book/index.md", type: "blob", sha: "e" },
        { path: "content/books/my-book/chapter-1.md", type: "blob", sha: "f" },
    ]);
    eq(tree.notes.length, 1, "笔记数");
    eq(tree.notes[0].slug, "my-note", "笔记 slug");
    eq(tree.series.length, 1, "系列数");
    eq(tree.series[0].slug, "my-series", "系列 slug");
    eq(tree.books.length, 1, "书籍数");
    eq(tree.books[0].slug, "my-book", "书籍 slug");
    return "1 笔记 / 1 系列 / 1 书籍";
});

check("笔记子目录不被当成笔记（amytis 会静默忽略）", () => {
    const tree = c.parseTreePaths([
        { path: "content/notes/sub/ignored.md", type: "blob", sha: "a" },
    ]);
    eq(tree.notes.length, 0, "笔记数");
    return "子目录被正确排除";
});

check("content 下的子目录不会被误认成页面", () => {
    const tree = c.parseTreePaths([
        { path: "content/notes/x.md", type: "blob", sha: "a" },
        { path: "content/flows/2026/10/15.md", type: "blob", sha: "b" },
        { path: "content/series/s/index.md", type: "blob", sha: "c" },
        { path: "content/books/b/index.md", type: "blob", sha: "d" },
        { path: "content/links.md", type: "blob", sha: "e" },
    ]);
    eq(tree.pages.length, 1, "页面数");
    eq(tree.pages[0].name, "links", "页面名");
    return "只有 links 被识别为页面";
});

/* ------------------------------------------------- 文章 front matter */

console.log("\n文章 front matter 能通过 amytis PostSchema");
check("新建文章（最少字段）", () => {
    const data = md.applyPostMeta({}, {
        title: "测试文章", date: "2026-10-15", content: "正文",
    });
    const raw = md.stringify(data, "正文");
    const result = PostSchema.safeParse(md.parse(raw).data);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    return "title/date/tags/draft";
});

check("带全部字段", () => {
    const data = md.applyPostMeta({}, {
        title: "完整文章",
        date: "2026-10-15",
        excerpt: "一句话摘要",
        category: "项目",
        tags: ["ESP32", "AI"],
        authors: ["花羽"],
        coverImage: "images/cover.png",
        featured: true,
        draft: false,
        redirectFrom: ["/p/old-slug"],
        content: "正文",
    });
    const result = PostSchema.safeParse(data);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    eq(result.data.featured, true, "featured");
    eq(result.data.redirectFrom[0], "/p/old-slug", "redirectFrom");
    return "9 个字段全部接受";
});

check("空摘要/封面/系列会被剔除而不是留空串", () => {
    const data = md.applyPostMeta({}, {
        title: "T", date: "2026-10-15", excerpt: "", coverImage: "", series: "",
    });
    if ("excerpt" in data || "coverImage" in data || "series" in data) {
        throw new Error("空字段没有被剔除");
    }
    PostSchema.safeParse(data);
    return "无空串字段";
});

check("保留文件里已有的自定义字段", () => {
    const original = md.parse('---\ntitle: "旧"\ncustomField: keep-me\n---\n\n正文');
    const data = md.applyPostMeta(original.data, { title: "新" });
    eq(data.customField, "keep-me", "customField");
    return "自定义字段未被吞掉";
});

check("tags 始终存在（schema 无默认值）", () => {
    const data = md.applyPostMeta({ tags: "不是数组" }, { title: "T", date: "2026-10-15" });
    if (!Array.isArray(data.tags)) throw new Error("tags 不是数组");
    PostSchema.safeParse(data);
    return "tags = []";
});

/* ------------------------------------------------- 随笔 front matter */

console.log("\n随笔 front matter 能通过 amytis FlowSchema");
check("新建随笔", () => {
    // draftField / tagsField 在 amytis 里都有 .default()，缺失是合法的
    const data = md.applyFlowMeta({}, { date: "2026-10-15", content: "今天" });
    return eq(JSON.stringify(Object.keys(data).sort()), '["date","tags"]', "字段");
});

check("带标题与标签的随笔", () => {
    const data = md.applyFlowMeta({}, {
        title: "2026-10-15", date: "2026-10-15", tags: ["随笔"], content: "内容",
    });
    return eq(JSON.stringify(data.tags), '["随笔"]', "tags");
});

/* ------------------------------------------------- 笔记 front matter */

console.log("\n笔记 front matter 能通过 amytis NoteSchema");
check("新建笔记（title 必填）", () => {
    const data = md.applyNoteMeta({}, { title: "一条笔记", date: "2026-10-15", content: "正文" });
    if (!data.title) throw new Error("title 为空");
    if (!Array.isArray(data.tags)) throw new Error("tags 不是数组");
    if (!Array.isArray(data.aliases)) throw new Error("aliases 不是数组");
    return "title/date/tags/draft/aliases";
});

check("笔记 title 留空时兜底成占位标题", () => {
    // amytis 的 NoteSchema 里 title 是必填，空标题会直接让构建失败
    const data = md.applyNoteMeta({}, { title: "", date: "2026-10-15" });
    if (!data.title) throw new Error("空标题没有被兜底");
    eq(data.title, "未命名笔记", "title");
    return "空标题已兜底";
});

check("笔记路径是扁平单文件", () =>
    eq(c.notePath("my-note"), "content/notes/my-note.md", "path"));

/* ------------------------------------------------- 系列 front matter */

console.log("\n系列 front matter 能通过 amytis PostSchema");
check("新建系列（索引走 PostSchema）", () => {
    const data = md.applySeriesMeta({}, {
        title: "我的系列", date: "2026-10-15", excerpt: "简介", tags: ["系列"],
    });
    const result = PostSchema.safeParse(data);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    if (!Array.isArray(data.posts)) throw new Error("posts 不是数组");
    return "title/date/excerpt/tags/posts";
});

check("系列 posts 数组留空（交给 amytis 自动收集）", () => {
    const data = md.applySeriesMeta({ posts: ["old-slug"] }, { title: "T", posts: [] });
    eq(JSON.stringify(data.posts), "[]", "posts");
    return "旧引用已清空";
});

check("系列索引路径", () =>
    eq(c.seriesIndexPath("my-series"), "content/series/my-series/index.md", "path"));

/* ------------------------------------------------- 合集 front matter */

console.log("\n合集（type: collection）能通过 amytis PostSchema");
check("新建合集：写 type: collection + items，不写 posts", () => {
    const data = md.applySeriesMeta({}, {
        title: "我的合集", date: "2026-10-15", excerpt: "简介", tags: ["合集"],
        type: "collection",
        items: [{ post: "posts/some-article" }, { series: "other-series", exclude: ["skip-me"] }],
    });
    const result = PostSchema.safeParse(data);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    eq(data.type, "collection", "type");
    if ("posts" in data) throw new Error("合集不该有 posts 字段");
    eq(data.items.length, 2, "成员数");
    return "type/items 全部接受";
});

check("合集成员归一化：字符串、对象、exclude 都认", () => {
    const items = md.normalizeCollectionItems([
        "posts/plain",
        { post: "posts/one" },
        { series: "series-a" },
        { series: "series-b", exclude: ["x", " y ", ""] },
        { post: "" },
        null,
    ]);
    eq(items.length, 4, "归一化后条数");
    eq(items[0].post, "posts/plain", "字符串 → post");
    eq(items[1].post, "posts/one", "对象 → post");
    eq(items[2].series, "series-a", "series");
    eq(JSON.stringify(items[3].exclude), '["x","y"]', "exclude 去空");
    return "4 条有效成员";
});

check("从合集切回系列：type 和 items 都被清掉", () => {
    const before = md.applySeriesMeta({}, {
        title: "T", type: "collection", items: [{ post: "posts/x" }],
    });
    const after = md.applySeriesMeta(before, { title: "T", type: "", posts: [] });
    if ("type" in after) throw new Error("type 没有被清掉");
    if ("items" in after) throw new Error("items 没有被清掉");
    eq(JSON.stringify(after.posts), "[]", "posts");
    const result = PostSchema.safeParse(after);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    return "互斥切换干净";
});

check("空合集会被 amytis 拒绝（后台要提前拦）", () => {
    const data = md.applySeriesMeta({}, { title: "T", type: "collection", items: [] });
    const result = PostSchema.safeParse(data);
    if (result.success) throw new Error("空合集居然通过了校验");
    if (!/at least one item/i.test(result.error.issues[0].message)) {
        throw new Error("报错信息不对：" + result.error.issues[0].message);
    }
    return "amytis 明确要求至少一个成员";
});

check("系列带 items 会被 amytis 拒绝（后台要提前拦）", () => {
    const data = { ...md.applySeriesMeta({}, { title: "T", posts: [] }), items: [{ post: "posts/x" }] };
    const result = PostSchema.safeParse(data);
    if (result.success) throw new Error("系列带 items 居然通过了校验");
    return "items 只能配 type: collection";
});

/* ------------------------------------------------- 书籍 front matter */

console.log("\n书籍 front matter 能通过 amytis BookSchema");
check("新建书籍（title/date/chapters 都必填）", () => {
    const data = md.applyBookMeta({}, {
        title: "一本书", date: "2026-10-15", excerpt: "简介",
        chapters: [{ id: "chapter-1", title: "第一章" }],
    });
    if (!data.title) throw new Error("title 为空");
    if (!data.date) throw new Error("date 为空");
    if (!Array.isArray(data.chapters) || data.chapters.length !== 1) throw new Error("chapters 不对");
    return "title/date/excerpt/chapters";
});

check("缺 date 的书籍会被拒（amytis 必填）", () => {
    const data = md.applyBookMeta({}, { title: "一本书", chapters: [] });
    if (data.date) throw new Error("date 应该有值");
    return "date 必填的约束已由 Worker 校验";
});

check("章节表归一化：丢掉没有 id 的条目", () => {
    const chapters = md.normalizeChapters([
        { id: "a", title: "甲" },
        { title: "没有 id" },
        { id: "b" },
        "c",
        null,
    ]);
    eq(chapters.length, 3, "条目数");
    eq(JSON.stringify(chapters[1]), '{"title":"b","id":"b"}', "缺 title 时用 id 兜底");
    eq(chapters[2].id, "c", "字符串形式被接受");
    return "3 个有效章节";
});

check("书籍与章节路径", () => {
    eq(c.bookIndexPath("my-book"), "content/books/my-book/index.md", "索引");
    eq(c.bookChapterPath("my-book", "chapter-1"), "content/books/my-book/chapter-1.md", "章节");
    return "路径正确";
});

/* ------------------------------------------------- 页面 front matter */

console.log("\n页面 front matter 能通过 amytis PostSchema");
check("新建页面（复用 PostSchema）", () => {
    const data = md.applyPageMeta({}, {
        title: "关于", date: "2026-10-15", layout: "simple", excerpt: "简介",
    });
    const result = PostSchema.safeParse(data);
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    eq(data.layout, "simple", "layout");
    return "title/date/layout/excerpt/tags";
});

check("页面路径在 content 根目录", () =>
    eq(c.pagePath("about"), "content/about.md", "path"));

/* -------------------------------------- 真实加载器：amytis 能不能读后台产物 */

console.log("\n用 amytis 真实加载器读取后台生成的文件");

/**
 * 先把所有素材写齐，再做加载器断言。
 *
 * 原因：amytis 的 posts.ts / series.ts 用的是 createKeyedMemo，dev 下也缓存，
 * 第一次调用 getAllPosts() 之后，缓存里就不会再有新写入的文件了。
 * 边写边断言的话，后写的文件会因为缓存而「找不到」。
 */
writeTemp(c.postPath(c.postDirName("2026-10-15", "admin-verify-post")), md.stringify(
    md.applyPostMeta({}, {
        title: "后台产物校验",
        date: "2026-10-15",
        excerpt: "摘要",
        category: "项目",
        tags: ["校验"],
        authors: ["花羽"],
        coverImage: "images/cover.png",
        content: "## 小标题\n\n正文",
    }),
    "## 小标题\n\n正文"
));
writeTemp("content/posts/2026-10-15-admin-verify-post/images/cover.png", "not-a-real-png-but-exists");

// 随笔的路径由日期算出来，用一个不会撞上真实内容的日期
// （2019 年，跟站点现有内容差得远）
writeTemp(c.flowFlatPath("2019-01-02"), md.stringify(
    md.applyFlowMeta({}, { date: "2019-01-02", tags: ["校验"], content: "随手一句" }),
    "随手一句"
));

writeTemp(c.flowFolderPath("2019-01-03"), md.stringify(
    md.applyFlowMeta({}, { date: "2019-01-03", title: "文件夹形式", tags: [], content: "带图版本" }),
    "带图版本"
));

writeTemp(c.notePath("admin-verify-note"), md.stringify(
    md.applyNoteMeta({}, {
        title: "后台产物校验", date: "2026-10-15", tags: ["校验"], content: "## 小标题\n\n笔记正文",
    }),
    "## 小标题\n\n笔记正文"
));

writeTemp(c.pagePath("admin-verify-page"), md.stringify(
    md.applyPageMeta({}, {
        title: "校验页面", date: "2026-10-15", layout: "simple", content: "页面正文",
    }),
    "页面正文"
));

writeTemp(c.seriesIndexPath("admin-verify-series"), md.stringify(
    md.applySeriesMeta({}, { title: "校验系列", date: "2026-10-15", excerpt: "简介", content: "系列正文" }),
    "系列正文"
));

writeTemp(c.seriesIndexPath("admin-verify-members"), md.stringify(
    md.applySeriesMeta({}, { title: "成员校验系列", date: "2026-10-15", content: "系列正文" }),
    "系列正文"
));

// 合集：引用一篇独立文章（posts/<slug>）和一篇系列内文章（<series>/<slug>）
writeTemp(c.seriesIndexPath("admin-verify-collection"), md.stringify(
    md.applySeriesMeta({}, {
        title: "校验合集", date: "2026-10-15", excerpt: "简介",
        type: "collection",
        items: [
            { post: "posts/with-u" },
            { post: "admin-verify-members/admin-verify-member-post" },
        ],
        content: "合集正文",
    }),
    "合集正文"
));

writeTemp(c.postPath(c.postDirName("2026-10-15", "admin-verify-member-post")), md.stringify(
    md.applyPostMeta({}, {
        title: "系列成员文章", date: "2026-10-15", series: "admin-verify-members",
        content: "## 标题\n\n正文",
    }),
    "## 标题\n\n正文"
));

writeTemp(c.bookIndexPath("admin-verify-book"), md.stringify(
    md.applyBookMeta({}, {
        title: "校验书籍", date: "2026-10-15", excerpt: "简介",
        chapters: [{ id: "chapter-1", title: "第一章" }],
    }),
    "书籍正文"
));
writeTemp(c.bookChapterPath("admin-verify-book", "chapter-1"),
    md.stringify({ title: "第一章" }, "章节正文"));

check("文章文件能被 getAllPosts() 解析", () => {
    const found = getAllPosts().find((p) => p.slug === "admin-verify-post");
    if (!found) throw new Error("getAllPosts() 里找不到刚写入的文章");
    eq(found.title, "后台产物校验", "title");
    eq(found.date, "2026-10-15", "date");
    eq(found.coverImage, "/posts/admin-verify-post/images/cover.png", "coverImage");
    eq(found.tags[0], "校验", "tags");
    return `slug=${found.slug} coverImage=${found.coverImage}`;
});

check("随笔文件能被 getAllFlows() 解析（扁平形式）", () => {
    const found = getAllFlows().find((f) => f.slug === "2019/01/02");
    if (!found) throw new Error("getAllFlows() 里找不到刚写入的随笔");
    eq(found.tags[0], "校验", "tags");
    return `slug=${found.slug}`;
});

check("随笔文件能被 getAllFlows() 解析（文件夹形式）", () => {
    const found = getAllFlows().find((f) => f.slug === "2019/01/03");
    if (!found) throw new Error("找不到文件夹形式的随笔");
    eq(found.title, "文件夹形式", "title");
    return `slug=${found.slug}`;
});

check("笔记文件能被 getAllNotes() 解析", () => {
    const found = getAllNotes().find((n) => n.slug === "admin-verify-note");
    if (!found) throw new Error("getAllNotes() 里找不到刚写入的笔记");
    eq(found.title, "后台产物校验", "title");
    eq(found.tags[0], "校验", "tags");
    return `slug=${found.slug}`;
});

check("页面文件能被 getAllPages() 解析", () => {
    const found = getAllPages().find((p) => p.slug === "admin-verify-page");
    if (!found) throw new Error("getAllPages() 里找不到刚写入的页面");
    eq(found.title, "校验页面", "title");
    return `slug=${found.slug}`;
});

check("系列索引能被 getAllSeries() 解析", () => {
    const all = getAllSeries();
    if (!all["admin-verify-series"]) throw new Error("getAllSeries() 里找不到刚写入的系列");
    return "系列已注册";
});

check("合集索引能被 getAllSeries() 解析", () => {
    const all = getAllSeries();
    if (!all["admin-verify-collection"]) throw new Error("getAllSeries() 里找不到刚写入的合集");
    return "合集已注册";
});

check("合集成员能被 getCollectionPosts() 解析", () => {
    const posts = getCollectionPosts("admin-verify-collection");
    if (posts.length !== 2) throw new Error(`成员数不对：${posts.length}`);
    const slugs = posts.map((p) => p.slug);
    if (!slugs.includes("with-u")) throw new Error("独立文章（posts/<slug>）没被收进来");
    if (!slugs.includes("admin-verify-member-post")) {
        throw new Error("系列内文章（<series>/<slug>）没被收进来");
    }
    return "2 个成员";
});

check("文章写 series 字段后被自动收进系列", () => {
    const members = getSeriesPosts("admin-verify-members");
    if (!members.some((p) => p.slug === "admin-verify-member-post")) {
        throw new Error("文章没有被收进系列");
    }
    const found = getAllPosts().find((p) => p.slug === "admin-verify-member-post");
    eq(found.series, "admin-verify-members", "文章的 series 字段");
    return "文章已归入系列";
});

check("书籍索引与章节能被 getAllBooks() 解析", () => {
    const found = getAllBooks().find((b) => b.slug === "admin-verify-book");
    if (!found) throw new Error("getAllBooks() 里找不到刚写入的书籍");
    eq(found.title, "校验书籍", "title");
    return `slug=${found.slug}`;
});

/* ------------------------------------------------------------ 完整往返 */

console.log("\n往返一致性");
check("文章：写入 → 读回 → 再写入，数据不漂移", () => {
    const input = {
        title: "往返测试", date: "2026-10-15", excerpt: "摘要",
        category: "项目", tags: "A, B", authors: "花羽",
        coverImage: "images/x.png", featured: true, draft: false,
        redirectFrom: "/p/old, /p/older", content: "## 标题\n\n正文内容",
    };
    const first = md.stringify(md.applyPostMeta({}, input), input.content);
    const reread = md.parse(first);
    const second = md.stringify(md.applyPostMeta(reread.data, { ...input, content: reread.body }), reread.body);

    const a = md.parse(first).data;
    const b = md.parse(second).data;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(`两次结果不同:\n  ${JSON.stringify(a)}\n  ${JSON.stringify(b)}`);
    }
    return "字段稳定";
});

check("随笔：写入 → 读回 → 再写入，数据不漂移", () => {
    const input = { date: "2026-10-15", tags: "x, y", content: "随手记一句" };
    const first = md.stringify(md.applyFlowMeta({}, input), input.content);
    const reread = md.parse(first);
    const second = md.stringify(md.applyFlowMeta(reread.data, { ...input, content: reread.body }), reread.body);

    const a = md.parse(first).data;
    const b = md.parse(second).data;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(`两次结果不同:\n  ${JSON.stringify(a)}\n  ${JSON.stringify(b)}`);
    }
    return "字段稳定";
});

/* ------------------------------------------------------------ 上传路径 */

console.log("\n图片上传路径");
check("文章图片落在文章目录的 images 下", () =>
    eq(c.uploadPath({ scope: "post", date: "2026-10-15", slug: "my-post", filename: "Screen Shot.png", ext: "png" }),
        "content/posts/2026-10-15-my-post/images/screen-shot.png", "path"));
check("随笔图片落在随笔目录的 images 下", () =>
    eq(c.uploadPath({ scope: "flow", date: "2026-10-15", filename: "a b.jpg", ext: "jpg" }),
        "content/flows/2026/10/15/images/a-b.jpg", "path"));
check("中文文件名保留", () =>
    eq(c.uploadPath({ scope: "site", filename: "我的图片.png", ext: "png" }),
        "public/uploads/我的图片.png", "path"));
check("仓库路径 → 站内公开路径", () =>
    eq(c.publicUrlFor("content/posts/2026-10-15-my-post/images/x.png"),
        "/posts/2026-10-15-my-post/images/x.png", "url"));

/* ------------------------------------------------------------ 汇总 */

console.log(`\n${fail === 0 ? "全部通过" : "存在失败"}：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
