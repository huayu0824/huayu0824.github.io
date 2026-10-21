/**
 * amytis 内容层：路径规则与 front matter 映射。
 *
 * 关键约定（来自 amytis 源码 src/lib/content/）：
 *   文章  content/posts/<YYYY-MM-DD-slug>/index.md   → /posts/<slug>/
 *   随笔  content/flows/<YYYY>/<MM>/<DD>.md          → /flows/<YYYY>/<MM>/<DD>/
 *   随笔（带图）content/flows/<YYYY>/<MM>/<DD>/index.md + images/
 *   笔记  content/notes/<slug>.md                    → /notes/<slug>
 *   系列  content/series/<slug>/index.md             → /series/<slug>
 *   书籍  content/books/<slug>/index.md              → /books/<slug>
 *   页面  content/<name>.md                          → /<name>
 *
 * 文章目录名必须带日期前缀，否则 amytis 拿不到日期、排序会乱。
 *
 * amytis 的硬约束（违反会构建失败或内容静默丢失）：
 *   · notes 必须是扁平单文件，写成子目录会被静默忽略
 *   · series 目录里必须恰好一个索引文件（index.md / README.md）
 *   · books 的 front matter 必须同时有 title、date、chapters
 *   · posts / notes / series 索引 / pages 的 title 都是必填
 *   · slug 全树唯一，notes 的 aliases 也参与唯一性检查
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

/* ------------------------------------------------------------------- 笔记 */

/**
 * 笔记是扁平单文件：content/notes/<slug>.md
 * amytis 只读 notes 目录下的文件，子目录会被静默忽略，所以不能写 notes/<slug>/index.md。
 */
export function notePath(slug) {
    return `content/notes/${slug}.md`;
}

/* ------------------------------------------------------------------- 系列 */

/**
 * 系列是一个目录，里面必须恰好一个索引文件。
 * amytis 认的索引文件名：index.mdx / index.md / README.mdx / README.md
 * （同格式出现多个、或 md 与 rst 并存，都会构建失败）
 */
export const SERIES_INDEX_NAMES = ["index.md", "README.md", "index.mdx", "README.mdx"];

export function seriesDir(slug) {
    return `content/series/${slug}`;
}

export function seriesIndexPath(slug) {
    return `${seriesDir(slug)}/index.md`;
}

/** 系列内的文章文件：同目录下平铺的 <name>.md */
export function seriesPostPath(slug, postSlug) {
    return `${seriesDir(slug)}/${postSlug}.md`;
}

/* ------------------------------------------------------------------- 书籍 */

/** 书籍索引：content/books/<slug>/index.md */
export function bookDir(slug) {
    return `content/books/${slug}`;
}

export function bookIndexPath(slug) {
    return `${bookDir(slug)}/index.md`;
}

/**
 * 章节文件。amytis 认 6 种形态，这里统一用 <id>.md 的平铺形式，
 * id 可以带 / 表示多级（如 maths/linear）。
 */
export function bookChapterPath(slug, id) {
    return `${bookDir(slug)}/${id}.md`;
}

/* ------------------------------------------------------------------- 页面 */

/**
 * 顶层页面：content/<name>.md，对应线上 /<name>
 * 只能放在 content 根目录，放进子目录不会被 getAllPages() 读到。
 */
export function pagePath(name) {
    return `content/${name}.md`;
}

/* ------------------------------------------------------------- 目录树解析 */

/**
 * 从 GitHub git tree 的路径列表里抽出各类型内容。
 * 一次请求拿到全量路径，比逐个目录 N+1 次请求快得多。
 */
export function parseTreePaths(paths) {
    const posts = [];
    const flows = [];
    const notes = [];
    const series = [];
    const books = [];
    const pages = [];
    const images = [];

    // content/ 下已知的子目录，根级页面要排除它们
    const RESERVED_DIRS = ["posts", "flows", "notes", "series", "books"];

    for (const entry of paths) {
        if (entry.type !== "blob") continue;
        const path = entry.path;

        // 图片：文章/随笔目录下的 images/，以及 public/uploads/
        if (/\/images\/[^/]+$/.test(path) || /^public\/uploads\/[^/]+$/.test(path)) {
            images.push({ path, sha: entry.sha, name: path.split("/").pop() });
            continue;
        }

        // content/posts/<dir>/index.md
        const pm = path.match(/^content\/posts\/([^/]+)\/index\.md$/);
        if (pm) {
            const parsed = parsePostDirName(pm[1]);
            posts.push({
                slug: parsed.slug,
                dirName: pm[1],
                date: parsed.date,
                path,
                sha: entry.sha,
            });
            continue;
        }

        // content/notes/<slug>.md —— 扁平单文件，子目录不算
        const nm = path.match(/^content\/notes\/([^/]+)\.md$/);
        if (nm) {
            notes.push({ slug: nm[1], path, sha: entry.sha });
            continue;
        }

        // content/series/<slug>/index.md —— 系列索引
        const sm = path.match(/^content\/series\/([^/]+)\/(?:index|README)\.md$/);
        if (sm) {
            series.push({ slug: sm[1], path, sha: entry.sha });
            continue;
        }

        // content/books/<slug>/index.md —— 书籍索引
        const bm = path.match(/^content\/books\/([^/]+)\/index\.md$/);
        if (bm) {
            books.push({ slug: bm[1], path, sha: entry.sha });
            continue;
        }

        // content/<name>.md —— 顶层页面（只认根级）
        const pgm = path.match(/^content\/([^/]+)\.md$/);
        if (pgm && !RESERVED_DIRS.includes(pgm[1])) {
            pages.push({ name: pgm[1], path, sha: entry.sha });
            continue;
        }

        // content/flows/YYYY/MM/DD.md
        const fd = flowToDate(path);
        if (fd) {
            flows.push({
                date: fd,
                // 扁平 / 文件夹两种形式都收录，后续按实际存在的那个读写
                flatPath: path.endsWith(`/index.md`) ? null : path,
                folderPath: path.endsWith(`/index.md`) ? path : null,
                path,
                sha: entry.sha,
            });
        }
    }

    posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    flows.sort((a, b) => b.date.localeCompare(a.date));
    notes.sort((a, b) => a.slug.localeCompare(b.slug));
    series.sort((a, b) => a.slug.localeCompare(b.slug));
    books.sort((a, b) => a.slug.localeCompare(b.slug));
    pages.sort((a, b) => a.name.localeCompare(b.name));
    images.sort((a, b) => a.path.localeCompare(b.path));

    return { posts, flows, notes, series, books, pages, images };
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
