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
