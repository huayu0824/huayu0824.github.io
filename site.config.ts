/**
 * 天道 —— Amytis 站点配置
 *
 * 注意：i18n 开启后，可本地化字段（title / description / hero / features.*.name）
 * 必须是 { <locale>: string } 映射，写成纯字符串会导致 TypeScript 编译失败。
 * 这里只配了 zh 一种语言，语言切换器不会出现。
 *
 * ── 后台可改的那部分 ────────────────────────────────────────────────────────
 * 站点名称、页面开关、导航、页脚、首页文案这些，后台「设置」页写的是
 * 仓库根目录的 site.settings.json，构建时由本文件深合并覆盖掉下面的默认值。
 * 也就是说：**改这些要去改 site.settings.json（或用后台改），改这里的默认值不生效。**
 * 这里的值只作兜底（JSON 里缺哪个键就用哪个）。
 */

import siteSettings from "./site.settings.json";

export interface NavChildItem {
    name: string;
    url: string;
    external?: boolean;
    dividerBefore?: boolean;
}

export interface NavItem {
    name: string;
    url: string;
    weight: number;
    external?: boolean;
    dropdown?: string[];
    children?: NavChildItem[];
}

const postsBasePath = 'posts';

const social = {
    github: "https://github.com/huayu0824",
    twitter: "https://twitter.com/Blue_Jingling",
    bilibili: "https://bilibili.com/454659285",
};

/** 深合并：对象递归覆盖，数组和标量直接替换 */
type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings<T>(base: T, override: unknown): T {
    if (!isPlainObject(override)) return base;
    if (!isPlainObject(base)) return override as T;

    const out: Plain = { ...(base as unknown as Plain) };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        out[key] = isPlainObject(value) && isPlainObject(out[key])
            ? mergeSettings(out[key], value)
            : value;
    }
    return out as unknown as T;
}

const baseConfig = {

    // ── 站点标识 ──────────────────────────────────────────────────────────────
    title: { zh: "天道", en: "天道" },
    logo: {
        src: "/images/avatar.png",
        favicon: "/icon.svg",
    },
    description: {
        zh: "一个人怎么长成现在这样。这里记下我想过的、做过的，和一路上变了什么。",
        en: "How a person grows into what they are. What I thought, what I made, and what changed along the way.",
    },
    baseUrl: "https://huayu0824.github.io",
    // TODO：换成 1200×630 的分享图，放到 public/og-image.png
    ogImage: "/og-image.png",
    footerText: { zh: `© ${new Date().getFullYear()} 天道 · 花羽`, en: `© ${new Date().getFullYear()} 天道 · 花羽` },

    // ── 多语言 ────────────────────────────────────────────────────────────────
    // 只保留 zh。默认语言的内容直接放在 content/ 根目录，URL 不带前缀。
    i18n: {
        enabled: true,
        defaultLocale: 'zh',
        locales: ['zh'],
    },

    // ── 导航 ──────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // 这几项的可见性由 amytis 按 features 开关自动过滤
    // （src/lib/nav.ts 的 FEATURE_URLS），开关关掉时导航里就不出现，
    // 所以这里直接把入口都列上，不用再手动摘来摘去。
    //
    // 系列 / 书籍 在有内容之后会自动变成下拉菜单
    // （导航栏读 siteConfig.nav 里 /series、/books 两项的 dropdown）。
    // ─────────────────────────────────────────────────────────────────────────
    nav: [
        { name: "文章", url: `/${postsBasePath}`, weight: 1 },
        { name: "随笔", url: "/flows", weight: 2 },
        { name: "笔记", url: "/notes", weight: 3 },
        { name: "系列", url: "/series", weight: 4 },
        { name: "书籍", url: "/books", weight: 5 },
        { name: "关于", url: "/about", weight: 6 },
        { name: "更多", url: "", weight: 7, children: [
            { name: "归档", url: "/archive" },
            { name: "标签", url: "/tags", dividerBefore: true },
            { name: "友链", url: "/links" },
            { name: "图谱", url: "/graph", dividerBefore: true },
        ]},
    ] as NavItem[],

    // ── 页脚 ──────────────────────────────────────────────────────────────────
    footer: {
        explore: [
            { name: "文章", url: `/${postsBasePath}`, weight: 1 },
            { name: "随笔", url: "/flows", weight: 2 },
            { name: "笔记", url: "/notes", weight: 3 },
            { name: "系列", url: "/series", weight: 4 },
            { name: "书籍", url: "/books", weight: 5 },
            { name: "归档", url: "/archive", weight: 6 },
            { name: "标签", url: "/tags", weight: 7 },
            { name: "关于", url: "/about", weight: 8 },
        ],
        connect: [
            { name: "GitHub", url: social.github, weight: 1 },
            { name: "Bilibili", url: social.bilibili, weight: 2 },
            { name: "X (Twitter)", url: social.twitter, weight: 3 },
            { name: "RSS Feed", url: "/feed.xml", weight: 4, external: true },
        ],
        builtWith: {
            show: true,
            url: "https://github.com/hutusi/amytis",
            text: "Built with Amytis",
        },
        bottomLinks: [] as Array<{ text: string; url: string }>,
        // 例：备案号
        // bottomLinks: [{ text: '京ICP备12345678号', url: 'https://beian.miit.gov.cn/' }],
    },

    // ── 社交与分享 ────────────────────────────────────────────────────────────
    social,
    share: {
        enabled: true,
        platforms: ['twitter', 'weibo', 'zhihu', 'copy'],
    },
    subscribe: {
        substack: '',
        telegram: '',
        wechat: { qrCode: '', account: '' },
        email: '',
    },

    // ── 功能开关 ──────────────────────────────────────────────────────────────
    features: {
        posts: {
            enabled: true,
            name: { zh: "文章", en: "Posts" },
        },
        series: {
            // 开关打开后 /series/ 才是真正的列表页（关着的时候是 404），
            // 首页「精选系列」也才会出现。
            // 想让某个系列出现在首页，系列索引文件里要写 featured: true。
            enabled: true,
            name: { zh: "系列", en: "Series" },
        },
        books: {
            // 同上：/books/ 在开关关着时是 404。
            // 书籍索引需要 title + date + chapters，还要 featured: true 才进首页。
            enabled: true,
            name: { zh: "书籍", en: "Books" },
        },
        flow: {
            enabled: true,
            // 导航里 /flows 这一项的文案取自这里
            name: { zh: "随笔", en: "Flow" },
        },
    },

    // ── 首页 Hero ─────────────────────────────────────────────────────────────
    hero: {
        tagline: { zh: "天道", en: "天道" },
        title: {
            zh: "一个人怎么长成现在这样。",
            en: "How a person grows into what they are.",
        },
        subtitle: {
            zh: "这里记下我想过的、做过的，和一路上变了什么——随笔、笔记，还有拆开又装回去的东西。",
            en: "What I thought, what I made, and what changed along the way — jottings, notes, and things taken apart and put back together.",
        },
    },

    // ── 首页分区 ──────────────────────────────────────────────────────────────
    homepage: {
        sections: [
            { id: 'hero', enabled: true, weight: 1 },
            { id: 'featured-posts', enabled: true, weight: 2, maxItems: 4, order: 'date-desc' as const },
            { id: 'latest-posts', enabled: true, weight: 3, maxItems: 3 },
            // 写了 Flow / 系列 / 书籍之后把 enabled 改成 true，首页就会出现对应分区
            { id: 'recent-flows', enabled: true, weight: 4, maxItems: 8 },
            { id: 'featured-series', enabled: true, weight: 5, maxItems: 6 },
            { id: 'featured-books', enabled: true, weight: 6, maxItems: 4 },
        ],
    },

    // ── 内容 ──────────────────────────────────────────────────────────────────
    pagination: {
        posts: 10,
        series: 5,
        flows: 20,
        notes: 20,
    },
    posts: {
        basePath: postsBasePath,
        toc: true,
        showFuturePosts: false,
        includeDateInUrl: false,
        authors: {
            default: ["花羽"] as string[],
            showInHeader: true,
            showAuthorCard: true,
        },
        excludeFromListing: [] as string[],
        archive: {
            showAuthors: true,
        },
    },
    series: {
        autoPaths: true,
        customPaths: {} as Record<string, string>,
    },
    flows: {
        recentCount: 5,
    },

    feed: {
        maxItems: 20,
        format: 'rss' as 'rss' | 'atom' | 'both',
        content: 'full' as 'excerpt' | 'full',
        includeFlows: false,
    },

    // ── 图片 ──────────────────────────────────────────────────────────────────
    images: {
        cdnBaseUrl: "",
    },

    // ── 外观 ──────────────────────────────────────────────────────────────────
    themeColor: 'default',

    // ── 浏览器兼容性提示 ──────────────────────────────────────────────────────
    browserCheck: {
        updateUrl: 'https://browsehappy.com/',
    },

    // ── 统计 ──────────────────────────────────────────────────────────────────
    analytics: {
        // 必须显式标类型：空数组会被推断成 never[]，导致 includes('umami') 编译报错
        providers: [] as Array<'umami' | 'plausible' | 'google'>,
        umami: {
            websiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || '',
            src: process.env.NEXT_PUBLIC_UMAMI_URL || 'https://us.umami.is/script.js',
        },
        plausible: {
            domain: '',
            src: 'https://plausible.io/js/script.js',
        },
        google: {
            measurementId: '',
        },
    },

    // ── 评论 ──────────────────────────────────────────────────────────────────
    comments: {
        provider: null,
        commentable: {
            posts: true,
            flows: true,
            notes: true,
            bookChapters: true,
            staticPages: false,
        },
        giscus: {
            repo: 'huayu0824/huayu0824.github.io',
            repoId: '',
            category: 'Announcements',
            categoryId: '',
        },
        disqus: {
            shortname: '',
        },
    },

    // ── 作者 ──────────────────────────────────────────────────────────────────
    authors: {
        "花羽": {
            bio: "在做东西，也在长大。",
            avatar: "/images/avatar.png",
            social: [],
        },
    } as Record<string, {
        bio?: string;
        avatar?: string;
        social?: Array<{ image: string; description: string }>;
    }>,

};

/**
 * 最终生效的配置 = 默认值 + site.settings.json 里的覆盖。
 * 类型保持成 baseConfig 的类型，免得 80 个引用 site.config 的文件全要改。
 */
export const siteConfig = mergeSettings(baseConfig, siteSettings) as typeof baseConfig;
