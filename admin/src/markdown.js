import YAML from "yaml";

/**
 * Hugo 文章的 front matter 解析与序列化。
 *
 * 用 YAML 库而不是手写字符串拼接，是为了原样保留作者写在 front matter 里的
 * 任何自定义字段——后台不该把没见过的字段吃掉。
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
    return { data, body: text.slice(m[0].length), hadFrontMatter: true };
}

export function stringify(data, body) {
    // lineWidth: -1 禁止 YAML 自动换行，避免长文本被折断
    const yaml = YAML.stringify(data, { lineWidth: -1, aliasDuplicateObjects: false });
    const text = String(body ?? "").replace(/\s+$/, "");
    return `---\n${yaml}---\n\n${text}\n`;
}

/**
 * 把内部文章对象规整成 front matter 里该有的样子。
 * 只写入显式提供的字段，未提供的保留原值。
 */
export function applyMeta(data, input) {
    const out = { ...data };

    if (input.title !== undefined) out.title = String(input.title ?? "").trim();
    if (input.date !== undefined) {
        const date = String(input.date ?? "").trim();
        // 空日期会让 Hugo 解析失败，宁可删掉让它回退到文件修改时间
        if (date) out.date = date;
        else delete out.date;
    }
    if (input.draft !== undefined) out.draft = Boolean(input.draft);

    if (input.categories !== undefined) {
        out.categories = splitList(input.categories);
    }
    if (input.tags !== undefined) {
        out.tags = splitList(input.tags);
    }

    if (input.description !== undefined) {
        const desc = String(input.description ?? "").trim();
        if (desc) out.description = desc;
        else delete out.description;
    }

    if (input.image !== undefined) {
        const img = String(input.image ?? "").trim();
        if (img) out.image = img;
        else delete out.image;
    }

    // slug 由目录名决定，保持与文件路径一致
    if (input.slug !== undefined) out.slug = String(input.slug ?? "");

    return out;
}

function splitList(value) {
    if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter(Boolean);
    }
    return String(value ?? "")
        .split(/[,，\s]+/)
        .map((v) => v.trim())
        .filter(Boolean);
}

/** 文章列表用的轻量投影 */
export function summarize(slug, data, body) {
    return {
        slug,
        title: data.title || slug,
        date: typeof data.date === "string" ? data.date : "",
        draft: data.draft === true,
        description: data.description || "",
        image: data.image || "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        categories: Array.isArray(data.categories) ? data.categories : [],
        words: countWords(body),
    };
}

function countWords(text) {
    const cjk = (text.match(/[一-龥]/g) || []).length;
    const latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
}
