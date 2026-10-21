/**
 * 站点设置：后台「设置」页读写仓库根目录的两个 JSON 文件。
 *
 *   site.settings.json   站点名称、页面开关、导航、页脚、首页文案…
 *   site.texts.json      页面文字（覆盖 amytis 的 i18n 词条）
 *
 * 构建时这两份文件会覆盖掉 site.config.ts / translations.ts 里的默认值，
 * 所以后台改完保存 → 提交 → CI 重建 → 站点生效。
 *
 * 写之前一定要校验：设置写坏了，站点会直接构建失败。
 */

/* ------------------------------------------------------------------ 路径 */

export const SETTINGS_PATH = "site.settings.json";
export const TEXTS_PATH = "site.texts.json";
export const TRANSLATIONS_PATH = "src/i18n/translations.ts";

/* ------------------------------------------------------------------ 校验 */

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 本地化字段必须是 { zh, en } 映射，不能是纯字符串。
 * 站点代码里有直接取 .zh 的地方，写成字符串会静默拿到 undefined。
 */
function isLocaleMap(value) {
    if (!isPlainObject(value)) return false;
    if (!Object.keys(value).length) return false;
    return Object.values(value).every((v) => typeof v === "string");
}

function bad(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

/**
 * 设置结构校验。
 * 只查类型和必要字段，不做语义判断（比如导航链接指向哪、开关组合是否合理）。
 */
export function validateSettings(input) {
    if (!isPlainObject(input)) throw bad("设置必须是一个对象");

    for (const key of ["title", "description"]) {
        if (input[key] !== undefined && !isLocaleMap(input[key])) {
            throw bad(`${key} 必须是 { zh, en } 映射`);
        }
    }

    if (input.logo !== undefined) {
        if (!isPlainObject(input.logo)) throw bad("logo 必须是对象");
        for (const [k, v] of Object.entries(input.logo)) {
            if (typeof v !== "string") throw bad(`logo.${k} 必须是字符串`);
        }
    }

    if (input.ogImage !== undefined && typeof input.ogImage !== "string") {
        throw bad("ogImage 必须是字符串");
    }

    if (input.hero !== undefined) {
        if (!isPlainObject(input.hero)) throw bad("hero 必须是对象");
        for (const [k, v] of Object.entries(input.hero)) {
            if (!isLocaleMap(v)) throw bad(`hero.${k} 必须是 { zh, en } 映射`);
        }
    }

    if (input.features !== undefined) {
        if (!isPlainObject(input.features)) throw bad("features 必须是对象");
        for (const [key, value] of Object.entries(input.features)) {
            if (!isPlainObject(value)) throw bad(`features.${key} 必须是对象`);
            if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
                throw bad(`features.${key}.enabled 必须是布尔值`);
            }
            if (value.name !== undefined && !isLocaleMap(value.name)) {
                throw bad(`features.${key}.name 必须是 { zh, en } 映射`);
            }
        }
    }

    if (input.homepage !== undefined) {
        if (!isPlainObject(input.homepage)) throw bad("homepage 必须是对象");
        if (input.homepage.sections !== undefined) {
            if (!Array.isArray(input.homepage.sections)) throw bad("homepage.sections 必须是数组");
            input.homepage.sections.forEach((section, i) => {
                if (!isPlainObject(section)) throw bad(`homepage.sections[${i}] 必须是对象`);
                if (typeof section.id !== "string" || !section.id) {
                    throw bad(`homepage.sections[${i}].id 必须是非空字符串`);
                }
                if (section.enabled !== undefined && typeof section.enabled !== "boolean") {
                    throw bad(`homepage.sections[${i}].enabled 必须是布尔值`);
                }
                if (section.maxItems !== undefined && typeof section.maxItems !== "number") {
                    throw bad(`homepage.sections[${i}].maxItems 必须是数字`);
                }
            });
        }
    }

    if (input.nav !== undefined) {
        if (!Array.isArray(input.nav)) throw bad("nav 必须是数组");
        input.nav.forEach((item, i) => {
            if (!isPlainObject(item)) throw bad(`nav[${i}] 必须是对象`);
            if (typeof item.name !== "string" || !item.name) {
                throw bad(`nav[${i}].name 必须是非空字符串`);
            }
            if (typeof item.url !== "string") throw bad(`nav[${i}].url 必须是字符串`);
            if (item.weight !== undefined && typeof item.weight !== "number") {
                throw bad(`nav[${i}].weight 必须是数字`);
            }
            if (item.children !== undefined) {
                if (!Array.isArray(item.children)) throw bad(`nav[${i}].children 必须是数组`);
                item.children.forEach((child, j) => {
                    if (!isPlainObject(child)) throw bad(`nav[${i}].children[${j}] 必须是对象`);
                    if (typeof child.name !== "string" || !child.name) {
                        throw bad(`nav[${i}].children[${j}].name 必须是非空字符串`);
                    }
                    if (typeof child.url !== "string") throw bad(`nav[${i}].children[${j}].url 必须是字符串`);
                });
            }
        });
    }

    if (input.footer !== undefined) {
        if (!isPlainObject(input.footer)) throw bad("footer 必须是对象");
        for (const listKey of ["explore", "connect", "bottomLinks"]) {
            const list = input.footer[listKey];
            if (list === undefined) continue;
            if (!Array.isArray(list)) throw bad(`footer.${listKey} 必须是数组`);
            list.forEach((item, i) => {
                if (!isPlainObject(item)) throw bad(`footer.${listKey}[${i}] 必须是对象`);
                if (typeof item.name !== "undefined" && typeof item.name !== "string") {
                    throw bad(`footer.${listKey}[${i}].name 必须是字符串`);
                }
                if (typeof item.url !== "undefined" && typeof item.url !== "string") {
                    throw bad(`footer.${listKey}[${i}].url 必须是字符串`);
                }
            });
        }
        if (input.footer.builtWith !== undefined) {
            if (!isPlainObject(input.footer.builtWith)) throw bad("footer.builtWith 必须是对象");
            if (input.footer.builtWith.show !== undefined && typeof input.footer.builtWith.show !== "boolean") {
                throw bad("footer.builtWith.show 必须是布尔值");
            }
        }
    }

    if (input.social !== undefined) {
        if (!isPlainObject(input.social)) throw bad("social 必须是对象");
        for (const [k, v] of Object.entries(input.social)) {
            if (typeof v !== "string") throw bad(`social.${k} 必须是字符串`);
        }
    }

    if (input.share !== undefined) {
        if (!isPlainObject(input.share)) throw bad("share 必须是对象");
        if (input.share.enabled !== undefined && typeof input.share.enabled !== "boolean") {
            throw bad("share.enabled 必须是布尔值");
        }
        if (input.share.platforms !== undefined && !Array.isArray(input.share.platforms)) {
            throw bad("share.platforms 必须是数组");
        }
    }

    return input;
}

/**
 * 页面文字校验：{ zh: { 键: 值 }, en: { … } }
 * 键必须是 i18n 词条里已有的，否则写了也不生效。
 */
export function validateTexts(input, knownKeys) {
    if (!isPlainObject(input)) throw bad("页面文字必须是一个对象");
    for (const [locale, map] of Object.entries(input)) {
        if (!isPlainObject(map)) throw bad(`${locale} 必须是一个对象`);
        for (const [key, value] of Object.entries(map)) {
            if (typeof value !== "string") throw bad(`${locale}.${key} 必须是字符串`);
            if (knownKeys && knownKeys.length && !knownKeys.includes(key)) {
                throw bad(`没有这个文案键：${key}`);
            }
        }
    }
    return input;
}

/* ------------------------------------------------------------------ 解析 */

/**
 * 从 amytis 的 translations.ts 里抽出各语言的词条。
 * 那个文件是纯对象字面量，用正则按行取 key/value 就够用。
 */
export function parseTranslations(source) {
    const out = {};
    for (const locale of ["en", "zh"]) {
        const start = source.indexOf(`\n  ${locale}: {`);
        if (start < 0) continue;
        const end = source.indexOf("\n  },", start);
        const body = source.slice(start, end < 0 ? source.length : end);

        const map = {};
        const re = /^\s{4}([a-zA-Z0-9_]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
        let m;
        while ((m = re.exec(body))) {
            map[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
        }
        out[locale] = map;
    }
    return out;
}

/* ------------------------------------------------------------------ 序列化 */

/** 站点设置按这个顺序写，diff 干净些 */
const SETTINGS_ORDER = [
    "title",
    "description",
    "logo",
    "ogImage",
    "hero",
    "features",
    "homepage",
    "nav",
    "footer",
    "footerText",
    "social",
    "share",
];

export function stringifySettings(value) {
    const ordered = {};
    for (const key of SETTINGS_ORDER) {
        if (value[key] !== undefined) ordered[key] = value[key];
    }
    for (const key of Object.keys(value)) {
        if (ordered[key] === undefined && value[key] !== undefined) ordered[key] = value[key];
    }
    return JSON.stringify(ordered, null, 2) + "\n";
}

export function stringifyTexts(value) {
    const ordered = {};
    for (const locale of ["zh", "en"]) {
        if (value[locale] !== undefined) ordered[locale] = value[locale];
    }
    for (const locale of Object.keys(value)) {
        if (ordered[locale] === undefined && value[locale] !== undefined) ordered[locale] = value[locale];
    }
    return JSON.stringify(ordered, null, 2) + "\n";
}
