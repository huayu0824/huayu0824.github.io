/**
 * 花羽的体育笔记 —— Amytis 站点配置
 *
 * 注意：i18n 开启后，可本地化字段（title / description / hero / features.*.name）
 * 必须是 { <locale>: string } 映射，写成纯字符串会导致 TypeScript 编译失败。
 * 这里只配了 zh 一种语言，语言切换器不会出现。
 */

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

export const siteConfig = {

    // ── 站点标识 ──────────────────────────────────────────────────────────────
    title: { zh: "花羽的体育笔记", en: "花羽的体育笔记" },
    logo: {
        src: "/images/avatar.png",
        favicon: "/icon.svg",
    },
    description: {
        zh: "学体育的，现在主要在做硬件和 AI。记录身体、流动与时间，也记录那些我拆开又装回去的东西。",
        en: "学体育的，现在主要在做硬件和 AI。",
    },
    baseUrl: "https://huayu0824.github.io",
    // TODO：换成 1200×630 的分享图，放到 public/og-image.png
    ogImage: "/og-image.png",
    footerText: { zh: `© ${new Date().getFullYear()} 花羽的体育笔记`, en: `© ${new Date().getFullYear()} 花羽的体育笔记` },

    // ── 多语言 ────────────────────────────────────────────────────────────────
    // 只保留 zh。默认语言的内容直接放在 content/ 根目录，URL 不带前缀。
    i18n: {
        enabled: true,
        defaultLocale: 'zh',
        locales: ['zh'],
    },

    // ── 导航 ──────────────────────────────────────────────────────────────────
    nav: [
        { name: "文章", url: `/${postsBasePath}`, weight: 1 },
        { name: "Flow", url: "/flows", weight: 2 },
        { name: "关于", url: "/about", weight: 3 },
        { name: "更多", url: "", weight: 4, children: [
            { name: "归档", url: "/archive" },
            { name: "标签", url: "/tags", dividerBefore: true },
            { name: "友链", url: "/links" },
        ]},
    ] as NavItem[],

    // ── 页脚 ──────────────────────────────────────────────────────────────────
    footer: {
        explore: [
            { name: "归档", url: "/archive", weight: 1 },
            { name: "标签", url: "/tags", weight: 2 },
            { name: "关于", url: "/about", weight: 3 },
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
            // 还没有系列内容，先关掉；有内容后在 content/series/ 建目录再打开
            enabled: false,
            name: { zh: "系列", en: "Series" },
        },
        books: {
            enabled: false,
            name: { zh: "书籍", en: "Books" },
        },
        flow: {
            enabled: true,
            name: { zh: "Flow", en: "Flow" },
        },
    },

    // ── 首页 Hero ─────────────────────────────────────────────────────────────
    hero: {
        tagline: { zh: "花羽的体育笔记", en: "花羽的体育笔记" },
        title: {
            zh: "在传统的底色上，画一点未来的东西。",
            en: "在传统的底色上，画一点未来的东西。",
        },
        subtitle: {
            zh: "体育教育出身，现在主要在做硬件和 AI。这里记录身体、流动与时间，也记录那些我拆开又装回去的东西。",
            en: "体育教育出身，现在主要在做硬件和 AI。",
        },
    },

    // ── 首页分区 ──────────────────────────────────────────────────────────────
    homepage: {
        sections: [
            { id: 'hero', enabled: true, weight: 1 },
            { id: 'featured-posts', enabled: true, weight: 2, maxItems: 4, order: 'date-desc' as const },
            { id: 'latest-posts', enabled: true, weight: 3, maxItems: 3 },
            // 写了 Flow 之后把 enabled 改成 true，首页就会出现「最新笔记」区
            { id: 'recent-flows', enabled: false, weight: 4, maxItems: 8 },
            { id: 'featured-series', enabled: false, weight: 5, maxItems: 6 },
            { id: 'featured-books', enabled: false, weight: 6, maxItems: 4 },
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
            bio: "体育教育 · 武术专项。训练场之外在做硬件和 AI。",
            avatar: "/images/avatar.png",
            social: [],
        },
    } as Record<string, {
        bio?: string;
        avatar?: string;
        social?: Array<{ image: string; description: string }>;
    }>,

};
