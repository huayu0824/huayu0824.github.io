import YAML from "yaml";

/**
 * amytis front matter 的解析与序列化。
 *
 * 字段严格对齐 amytis 的 Zod schema：
 *   PostSchema  src/lib/content/parse.ts
 *   FlowSchema  src/lib/content/flows.ts
 * 多写或少写都会让 amytis 构建时报错，所以只输出这两套认识的字段。
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parse(raw) {
    const text = String(raw ?? "");
    const m = text.match(FM_RE);
    if (!m) return { data: {}, body: text, hadFrontMatter: false };

    let data = {};
    try {
        data = YAML.parse(m[1]) || {};
    } catch (err) {
        throw new Error(`front matter 不是合法的 YAML：${err.message}`);
    }
    if (typeof data !== "object" || Array.isArray(data)) data = {};
    return { data, body: text.slice(m[0].length), hadFrontMatter: true };
}

export function stringify(data, body) {
    // lineWidth: -1 禁止 YAML 自动折行，避免长文本被拆坏
    const yaml = YAML.stringify(data, { lineWidth: -1, aliasDuplicateObjects: false });
    const text = String(body ?? "").replace(/\s+$/, "");
    return `---\n${yaml}---\n\n${text}\n`;
}

/* ---------------------------------------------------------------- 文章字段 */

const POST_ORDER = [
    "title",
    "date",
    "excerpt",
    "category",
    "tags",
    "authors",
    "coverImage",
    "featured",
    "draft",
    "toc",
    "commentable",
    "series",
    "subtitle",
    "redirectFrom",
];

/**
 * 把后台表单写回 front matter。
 * 显式提供的字段才写入，其余保留文件里原有的值。
 */
export function applyPostMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title, "未命名文章");
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.excerpt !== undefined) out.excerpt = clean(input.excerpt);
    if (input.category !== undefined) out.category = clean(input.category, "Uncategorized");
    if (input.tags !== undefined) out.tags = toList(input.tags);
    if (input.authors !== undefined) out.authors = toList(input.authors, "花羽");
    if (input.coverImage !== undefined) out.coverImage = clean(input.coverImage);
    if (input.featured !== undefined) out.featured = Boolean(input.featured);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);
    if (input.series !== undefined) out.series = clean(input.series);
    if (input.redirectFrom !== undefined) out.redirectFrom = toList(input.redirectFrom);

    // tags 在 amytis 的 schema 里没有默认值，必须始终存在
    if (!Array.isArray(out.tags)) out.tags = [];

    // 空字符串会让 YAML 输出 ""，amytis 解析成空值反而出错，直接删掉
    for (const key of ["excerpt", "coverImage", "series", "subtitle"]) {
        if (out[key] === "") delete out[key];
    }

    return orderKeys(out, POST_ORDER);
}

/* ---------------------------------------------------------------- 随笔字段 */

const FLOW_ORDER = ["title", "date", "tags", "draft", "commentable"];

export function applyFlowMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title);
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.tags !== undefined) out.tags = toList(input.tags);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);

    if (!Array.isArray(out.tags)) out.tags = [];
    if (out.title === "") delete out.title;

    return orderKeys(out, FLOW_ORDER);
}

/* ---------------------------------------------------------------- 笔记字段 */

// amytis 的 NoteSchema：title 必填，其余可选
const NOTE_ORDER = ["title", "date", "tags", "draft", "aliases", "toc", "backlinks", "commentable"];

export function applyNoteMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title, "未命名笔记");
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.tags !== undefined) out.tags = toList(input.tags);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);
    if (input.aliases !== undefined) out.aliases = toList(input.aliases);
    if (input.toc !== undefined) out.toc = Boolean(input.toc);
    if (input.backlinks !== undefined) out.backlinks = Boolean(input.backlinks);

    if (!Array.isArray(out.tags)) out.tags = [];
    if (!Array.isArray(out.aliases)) out.aliases = [];
    if (out.date === "") delete out.date;

    return orderKeys(out, NOTE_ORDER);
}

/* ---------------------------------------------------------------- 系列字段 */

// 系列索引走 PostSchema，额外支持 posts（手动排序）与 sort
// 合集（type: collection）则用 items 表达成员，两者是互斥的两种形态
const SERIES_ORDER = [
    "title",
    "date",
    "excerpt",
    "category",
    "tags",
    "authors",
    "coverImage",
    "featured",
    "draft",
    "toc",
    "commentable",
    "series",
    "subtitle",
    "redirectFrom",
    "type",
    "items",
    "posts",
    "sort",
];

/**
 * 合集成员归一化。
 *
 * amytis 的合集用 items 数组表达成员，两种形态：
 *   { post: "<slug>" | "posts/<slug>" | "<series>/<slug>" }  引用一篇文章
 *   { series: "<slug>", exclude?: ["<slug>", ...] }        整个系列收进来，可排除其中几篇
 *
 * 引用了仓库里不存在的 slug，amytis 构建时会直接抛错让整站挂掉，
 * 所以这里只做结构清洗，存在性校验交给 saveSeries（要读仓库才知道）。
 */
export function normalizeCollectionItems(value) {
    const list = Array.isArray(value) ? value : [];
    const out = [];

    for (const item of list) {
        if (!item) continue;

        if (typeof item === "string") {
            const ref = item.trim();
            if (ref) out.push({ post: ref });
            continue;
        }

        const series = String(item.series || "").trim();
        if (series) {
            const entry = { series };
            const exclude = Array.isArray(item.exclude)
                ? item.exclude.map((s) => String(s).trim()).filter(Boolean)
                : [];
            if (exclude.length) entry.exclude = exclude;
            out.push(entry);
            continue;
        }

        const post = String(item.post || "").trim();
        if (post) out.push({ post });
    }

    return out;
}

export function applySeriesMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title, "未命名系列");
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.excerpt !== undefined) out.excerpt = clean(input.excerpt);
    if (input.tags !== undefined) out.tags = toList(input.tags);
    if (input.coverImage !== undefined) out.coverImage = clean(input.coverImage);
    if (input.featured !== undefined) out.featured = Boolean(input.featured);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);
    if (input.sort !== undefined) out.sort = input.sort || "date-desc";

    // 类型：系列，还是合集。
    // 系列靠「文章 front matter 的 series 字段」自动收集成员，索引里的 posts 留空；
    // 合集靠 items 手工挑选成员，type: collection。
    // 两者互斥，来回切的时候要把对方留下的字段清干净。
    if (input.type === "collection") {
        out.type = "collection";
        if (input.items !== undefined) out.items = normalizeCollectionItems(input.items);
        else if (!Array.isArray(out.items)) out.items = [];
        delete out.posts;
    } else {
        delete out.type;
        delete out.items;
        // posts 是系列内文章的 slug 列表，顺序即展示顺序
        if (input.posts !== undefined) out.posts = toList(input.posts);
        else if (!Array.isArray(out.posts)) out.posts = [];
    }

    if (!Array.isArray(out.tags)) out.tags = [];

    for (const key of ["excerpt", "coverImage"]) {
        if (out[key] === "") delete out[key];
    }

    return orderKeys(out, SERIES_ORDER);
}

/* ---------------------------------------------------------------- 书籍字段 */

// amytis 的 BookSchema：title / date / chapters 三个都必填
const BOOK_ORDER = [
    "title",
    "date",
    "excerpt",
    "authors",
    "coverImage",
    "featured",
    "draft",
    "latex",
    "showChapterExcerpt",
    "chapters",
];

export function applyBookMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title, "未命名书籍");
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.excerpt !== undefined) out.excerpt = clean(input.excerpt);
    if (input.coverImage !== undefined) out.coverImage = clean(input.coverImage);
    if (input.featured !== undefined) out.featured = Boolean(input.featured);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);
    if (input.showChapterExcerpt !== undefined) out.showChapterExcerpt = Boolean(input.showChapterExcerpt);

    // chapters 必须是数组，且每一项都要有 id
    if (input.chapters !== undefined) {
        out.chapters = normalizeChapters(input.chapters);
    }
    if (!Array.isArray(out.chapters)) out.chapters = [];

    for (const key of ["excerpt", "coverImage"]) {
        if (out[key] === "") delete out[key];
    }

    return orderKeys(out, BOOK_ORDER);
}

/**
 * 章节表归一化。
 * amytis 接受三种形态：{ title, id }、{ part, chapters: [...] }、{ section, items: [...] }。
 * 后台只产出最简单的一种，避免嵌套层级带来的麻烦。
 */
export function normalizeChapters(value) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const item of list) {
        if (!item) continue;
        if (typeof item === "string") {
            const id = item.trim();
            if (id) out.push({ title: id, id });
            continue;
        }
        const id = String(item.id || "").trim();
        if (!id) continue; // 没有 id 的章节会让 amytis 找不到文件
        out.push({ title: String(item.title || id).trim(), id });
    }
    return out;
}

/* ---------------------------------------------------------------- 页面字段 */

// 顶层页面复用 PostSchema
const PAGE_ORDER = [
    "title",
    "date",
    "excerpt",
    "category",
    "tags",
    "authors",
    "coverImage",
    "featured",
    "draft",
    "toc",
    "commentable",
    "layout",
    "subtitle",
    "redirectFrom",
];

export function applyPageMeta(existing, input) {
    const out = { ...existing };

    if (input.title !== undefined) out.title = clean(input.title, "未命名页面");
    if (input.date !== undefined) out.date = clean(input.date);
    if (input.excerpt !== undefined) out.excerpt = clean(input.excerpt);
    if (input.tags !== undefined) out.tags = toList(input.tags);
    if (input.coverImage !== undefined) out.coverImage = clean(input.coverImage);
    if (input.draft !== undefined) out.draft = Boolean(input.draft);
    if (input.layout !== undefined) out.layout = clean(input.layout, "post");

    if (!Array.isArray(out.tags)) out.tags = [];

    for (const key of ["excerpt", "coverImage"]) {
        if (out[key] === "") delete out[key];
    }

    return orderKeys(out, PAGE_ORDER);
}

/* -------------------------------------------------------------- 列表投影 */

export function postSummary(meta, body) {
    return {
        title: meta.title || "(无标题)",
        date: meta.date || "",
        excerpt: meta.excerpt || firstParagraph(body),
        category: meta.category || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        authors: Array.isArray(meta.authors) ? meta.authors : [],
        coverImage: meta.coverImage || "",
        featured: meta.featured === true,
        draft: meta.draft === true,
        series: meta.series || "",
        words: countWords(body),
    };
}

export function flowSummary(meta, body) {
    return {
        title: meta.title || meta.date || "",
        date: meta.date || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        draft: meta.draft === true,
        words: countWords(body),
        preview: firstParagraph(body),
    };
}

export function noteSummary(meta, body) {
    return {
        title: meta.title || "(无标题)",
        date: meta.date || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        draft: meta.draft === true,
        words: countWords(body),
        preview: firstParagraph(body),
    };
}

export function seriesSummary(meta, body) {
    const isCollection = meta.type === "collection";
    return {
        title: meta.title || "(无标题)",
        date: meta.date || "",
        excerpt: meta.excerpt || firstParagraph(body),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        coverImage: meta.coverImage || "",
        featured: meta.featured === true,
        draft: meta.draft === true,
        // 合集用 items，系列用 posts
        type: isCollection ? "collection" : "series",
        items: isCollection && Array.isArray(meta.items) ? meta.items : [],
        posts: !isCollection && Array.isArray(meta.posts) ? meta.posts : [],
        words: countWords(body),
    };
}

export function bookSummary(meta, body) {
    const chapters = Array.isArray(meta.chapters) ? meta.chapters : [];
    return {
        title: meta.title || "(无标题)",
        date: meta.date || "",
        excerpt: meta.excerpt || firstParagraph(body),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        coverImage: meta.coverImage || "",
        featured: meta.featured === true,
        draft: meta.draft === true,
        chapterCount: chapters.length,
        words: countWords(body),
    };
}

export function pageSummary(meta, body) {
    return {
        title: meta.title || meta.name || "(无标题)",
        date: meta.date || "",
        excerpt: meta.excerpt || firstParagraph(body),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        draft: meta.draft === true,
        words: countWords(body),
    };
}

/* ---------------------------------------------------------------- 工具 */

function clean(value, fallback = "") {
    const s = String(value ?? "").trim();
    return s || fallback;
}

function toList(value, fallback) {
    if (Array.isArray(value)) {
        const list = value.map((v) => String(v).trim()).filter(Boolean);
        return list.length ? list : fallback ? [fallback] : [];
    }
    const s = String(value ?? "").trim();
    if (!s) return fallback ? [fallback] : [];
    return s
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean);
}

function orderKeys(obj, order) {
    const out = {};
    for (const key of order) {
        if (obj[key] !== undefined) out[key] = obj[key];
    }
    // schema 之外的字段保留在末尾，避免后台编辑时误删别人的自定义内容
    for (const key of Object.keys(obj)) {
        if (out[key] === undefined) out[key] = obj[key];
    }
    return out;
}

function firstParagraph(body) {
    const text = String(body ?? "")
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/^#{1,6}\s+.*$/m, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`>#-]/g, "")
        .trim();
    if (!text) return "";
    const para = text.split(/\n\s*\n/)[0] || text;
    return para.length > 140 ? para.slice(0, 140) + "…" : para;
}

function countWords(text) {
    const cjk = (String(text).match(/[一-龥]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
}
