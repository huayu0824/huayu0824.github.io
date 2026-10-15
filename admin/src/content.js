/**
 * amytis 内容层：路径规则与 front matter 映射。
 *
 * 关键约定（来自 amytis 源码 src/lib/content/）：
 *   文章  content/posts/<YYYY-MM-DD-slug>/index.md   → /posts/<slug>/
 *   随笔  content/flows/<YYYY>/<MM>/<DD>.md          → /flows/<YYYY>/<MM>/<DD>/
 *   随笔（带图）content/flows/<YYYY>/<MM>/<DD>/index.md + images/
 *
 * 文章目录名必须带日期前缀，否则 amytis 拿不到日期、排序会乱。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATED_SLUG_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i;
export const SLUG_INPUT_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i;

/* ------------------------------------------------------------------- 校验 */

export function isValidDate(value) {
    return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function isValidSlug(value) {
    return typeof value === "string" && SLUG_RE.test(value);
}

/* ------------------------------------------------------------------- 文章 */

/** 把 <slug> 和日期合成目录名；slug 已自带日期前缀时不重复拼接 */
export function postDirName(date, slug) {
    if (DATED_SLUG_RE.test(slug)) {
        const m = slug.match(DATED_SLUG_RE);
        return m[1] === date ? slug : `${date}-${m[2]}`;
    }
    return `${date}-${slug}`;
}

/** 从目录名解析出日期与 URL slug（与 amytis 的 parseSlugAndDate 保持一致） */
export function parsePostDirName(dirName) {
    const m = dirName.match(DATED_SLUG_RE);
    if (m) return { date: m[1], slug: m[2] };
    return { date: null, slug: dirName };
}

export function postPath(dirName) {
    return `content/posts/${dirName}/index.md`;
}

/* ------------------------------------------------------------------- 随笔 */

export function flowDateParts(date) {
    const [y, m, d] = date.split("-");
    return { year: y, month: m, day: d };
}

/** 随笔的两种存储形式，优先扁平文件（Obsidian 每日笔记产出的就是这种） */
export function flowFlatPath(date) {
    const p = flowDateParts(date);
    return `content/flows/${p.year}/${p.month}/${p.day}.md`;
}

export function flowFolderBase(date) {
    const p = flowDateParts(date);
    return `content/flows/${p.year}/${p.month}/${p.day}`;
}

export function flowFolderPath(date) {
    return `${flowFolderBase(date)}/index.md`;
}

/** 建新随笔默认用扁平文件，轻量；一旦要传图再转文件夹形式 */
export function flowNewPath(date) {
    return flowFlatPath(date);
}

export function flowToDate(path) {
    const m = path.match(/^content\/flows\/(\d{4})\/(\d{2})\/(\d{2})(?:\/index)?\.md$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* ------------------------------------------------------------- 目录树解析 */

/**
 * 从 GitHub git tree 的路径列表里抽出文章与随笔。
 * 一次请求拿到全量路径，比逐个目录 N+1 次请求快得多。
 */
export function parseTreePaths(paths) {
    const posts = [];
    const flows = [];

    for (const entry of paths) {
        if (entry.type !== "blob") continue;

        // content/posts/<dir>/index.md
        const pm = entry.path.match(/^content\/posts\/([^/]+)\/index\.md$/);
        if (pm) {
            const parsed = parsePostDirName(pm[1]);
            posts.push({
                slug: parsed.slug,
                dirName: pm[1],
                date: parsed.date,
                path: entry.path,
                sha: entry.sha,
            });
            continue;
        }

        // content/flows/YYYY/MM/DD.md
        const fd = flowToDate(entry.path);
        if (fd) {
            flows.push({
                date: fd,
                // 扁平 / 文件夹两种形式都收录，后续按实际存在的那个读写
                flatPath: entry.path.endsWith(`/index.md`) ? null : entry.path,
                folderPath: entry.path.endsWith(`/index.md`) ? entry.path : null,
                path: entry.path,
                sha: entry.sha,
            });
        }
    }

    posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    flows.sort((a, b) => b.date.localeCompare(a.date));

    return { posts, flows };
}

/* ----------------------------------------------------------- 上传路径推导 */

/**
 * 依据所属类型算出上传文件的仓库路径。
 *   post  → content/posts/<dirName>/images/<file>
 *   flow  → content/flows/Y/M/D/images/<file>（需随笔已是文件夹形式）
 *   site  → public/uploads/<file>（about、links 这类顶层页面用）
 */
export function uploadPath({ scope, date, slug, filename, ext }) {
    const safeName = sanitizeName(filename);

    if (scope === "post" && date && slug) {
        return `content/posts/${postDirName(date, slug)}/images/${safeName}.${ext}`;
    }
    if (scope === "flow" && date) {
        // flowFolderBase 已含 content/flows 前缀，不要重复拼
        return `${flowFolderBase(date)}/images/${safeName}.${ext}`;
    }
    return `public/uploads/${safeName}.${ext}`;
}

/** 前端引用时用的站内公开路径（与仓库路径不同，public/ 前缀要去掉） */
export function publicUrlFor(repoPathValue) {
    if (repoPathValue.startsWith("content/posts/")) {
        return "/" + repoPathValue.slice("content/".length);
    }
    if (repoPathValue.startsWith("content/flows/")) {
        return "/" + repoPathValue.slice("content/".length);
    }
    return "/" + repoPathValue;
}

/**
 * 文件名规整：只留安全字符，支持中文，其余一律转连字符。
 * 与之前 Hugo 版的 slugify 行为一致。
 */
export function sanitizeName(name) {
    const base = String(name || "")
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return base || "image";
}
