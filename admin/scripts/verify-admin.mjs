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

/** 临时文件用完即删，失败也删，绝不在 content/ 里留残骸 */
function writeTemp(relPath, content) {
    const abs = path.join(REPO, relPath);
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
    return "2 篇文章 / 2 条随笔";
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

/* -------------------------------------- 真实加载器：amytis 能不能读后台产物 */

console.log("\n用 amytis 真实加载器读取后台生成的文件");

check("文章文件能被 getAllPosts() 解析", () => {
    const data = md.applyPostMeta({}, {
        title: "后台产物校验",
        date: "2026-10-15",
        excerpt: "摘要",
        category: "项目",
        tags: ["校验"],
        authors: ["花羽"],
        coverImage: "images/cover.png",
        content: "## 小标题\n\n正文",
    });
    const dirName = c.postDirName("2026-10-15", "admin-verify-post");
    writeTemp(c.postPath(dirName), md.stringify(data, "## 小标题\n\n正文"));
    writeTemp(`content/posts/${dirName}/images/cover.png`, "not-a-real-png-but-exists");

    const found = getAllPosts().find((p) => p.slug === "admin-verify-post");
    if (!found) throw new Error("getAllPosts() 里找不到刚写入的文章");
    eq(found.title, "后台产物校验", "title");
    eq(found.date, "2026-10-15", "date");
    eq(found.coverImage, "/posts/admin-verify-post/images/cover.png", "coverImage");
    eq(found.tags[0], "校验", "tags");
    return `slug=${found.slug} coverImage=${found.coverImage}`;
});

check("随笔文件能被 getAllFlows() 解析（扁平形式）", () => {
    const data = md.applyFlowMeta({}, {
        date: "2026-10-15", tags: ["校验"], content: "随手一句",
    });
    writeTemp(c.flowFlatPath("2026-10-15"), md.stringify(data, "随手一句"));

    const found = getAllFlows().find((f) => f.slug === "2026/10/15");
    if (!found) throw new Error("getAllFlows() 里找不到刚写入的随笔");
    eq(found.tags[0], "校验", "tags");
    return `slug=${found.slug}`;
});

check("随笔文件能被 getAllFlows() 解析（文件夹形式）", () => {
    const data = md.applyFlowMeta({}, {
        date: "2026-10-14", title: "文件夹形式", tags: [], content: "带图版本",
    });
    writeTemp(c.flowFolderPath("2026-10-14"), md.stringify(data, "带图版本"));

    const found = getAllFlows().find((f) => f.slug === "2026/10/14");
    if (!found) throw new Error("找不到文件夹形式的随笔");
    eq(found.title, "文件夹形式", "title");
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
