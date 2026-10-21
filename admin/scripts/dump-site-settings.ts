/**
 * 从现有的 site.config.ts 导出「后台可改」的那部分配置，作为 site.settings.json 的初稿。
 *
 * 只在初始化时跑一次：bun run admin/scripts/dump-site-settings.ts
 * 之后 site.settings.json 就是唯一事实来源，site.config.ts 里的值只剩兜底作用。
 *
 * 直接写文件（不用 shell 重定向）—— PowerShell 的 > 会写成 UTF-16，JSON 解析会炸。
 *
 * 注意：site.config.ts 会 import site.settings.json，所以这个脚本只有在
 * site.settings.json 本身是合法 JSON 时才跑得起来（文件写坏时正好用来提示）。
 */
import fs from "fs";
import path from "path";
import { siteConfig } from "../../site.config";

const subset = {
    title: siteConfig.title,
    description: siteConfig.description,
    logo: siteConfig.logo,
    ogImage: siteConfig.ogImage,
    hero: siteConfig.hero,
    features: siteConfig.features,
    homepage: siteConfig.homepage,
    nav: siteConfig.nav,
    footer: siteConfig.footer,
    footerText: siteConfig.footerText,
    social: siteConfig.social,
    share: siteConfig.share,
};

const out = path.resolve(import.meta.dir, "..", "..", "site.settings.json");
fs.writeFileSync(out, JSON.stringify(subset, null, 2) + "\n", "utf8");
console.log(`已写出 ${out}（${Object.keys(subset).length} 组配置）`);
