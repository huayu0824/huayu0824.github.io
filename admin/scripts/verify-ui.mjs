/**
 * 后台前端的 DOM 级验证：用 happy-dom 加载真实的 index.html + app.js，
 * 打桩 fetch，驱动真实交互（切类型、加成员、点保存），断言最后发出去的请求体。
 *
 * 后端（verify-worker.mjs）验的是「Worker 收到什么」，
 * 这里验的是「浏览器里点一通，到底会不会把 type/items 带上」——
 * 这段链路只有跑真 DOM 才测得到。
 *
 * 运行：bun run scripts/verify-ui.mjs
 */
import fs from "fs";
import path from "path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ADMIN = path.resolve(import.meta.dir, "..");

GlobalRegistrator.register({ url: "http://localhost:8788/", width: 1280, height: 800 });

/* ------------------------------------------------------------------ 断言 */

let pass = 0;
let fail = 0;

async function check(name, fn) {
    try {
        const detail = await fn();
        console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`);
        pass++;
    } catch (err) {
        console.log(`  ✗ ${name}\n      ${err.message}`);
        fail++;
    }
}

function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${label}：期望 ${b}，实际 ${a}`);
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 假接口 */

const POSTS = [
    { key: "post-1", slug: "post-1", title: "第一篇", date: "2026-10-01", tags: [], series: "", words: 10, draft: false, featured: false },
    { key: "post-2", slug: "post-2", title: "第二篇", date: "2026-10-02", tags: [], series: "", words: 20, draft: false, featured: false },
];

const SERIES = [
    { key: "series-a", slug: "series-a", title: "系列甲", date: "2026-10-03", type: "series", items: [], tags: [], draft: false, featured: false },
    { key: "coll-b", slug: "coll-b", title: "合集乙", date: "2026-10-04", type: "collection", items: [{ post: "posts/post-1" }], tags: [], draft: false, featured: false },
];

const sent = [];

function jsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
    };
}

globalThis.fetch = async (path, options) => {
    const method = (options && options.method) || "GET";
    const body = options && options.body ? JSON.parse(options.body) : null;
    sent.push({ path, method, body });

    if (path === "/api/session") {
        return jsonResponse({ login: "huayu0824", name: "花羽", avatar: "", repo: "huayu0824/huayu0824.github.io", branch: "main", defaultAuthor: "花羽" });
    }
    if (path.startsWith("/api/posts?") || path === "/api/posts") {
        return jsonResponse({ items: POSTS, total: POSTS.length, offset: 0, limit: 40, truncated: false, searched: false });
    }
    if (path.startsWith("/api/series?") || path === "/api/series") {
        return jsonResponse({ items: SERIES, total: SERIES.length, offset: 0, limit: 40, truncated: false, searched: false });
    }
    const one = path.match(/^\/api\/series\/([^/?]+)$/);
    if (one && method === "GET") {
        const item = SERIES.find((s) => s.slug === decodeURIComponent(one[1]));
        if (!item) return jsonResponse({ error: "不存在" }, 404);
        return jsonResponse({
            key: item.slug, slug: item.slug, title: item.title, date: item.date,
            type: item.type, items: item.items, members: [],
            content: "正文", path: `content/series/${item.slug}/index.md`, url: `/series/${item.slug}`,
            draft: false, featured: false, tags: [],
        });
    }    if (method === "PUT" || method === "POST") {
        // 假接口也要「保存后能读回来」，否则保存完重新拉详情会退回旧数据
        if (path.startsWith("/api/series/") && body && Array.isArray(body.items)) {
            const slug = decodeURIComponent(path.split("/").pop());
            const target = SERIES.find((s) => s.slug === slug);
            if (target) {
                target.items = body.items;
                target.type = body.type === "collection" ? "collection" : "series";
            }
        }
        return jsonResponse({ ok: true, key: "coll-b", path: "content/series/coll-b/index.md", message: "已保存" });
    }
    return jsonResponse({ ok: true, items: [], total: 0 });
};

/* ------------------------------------------------------------------ 装载页面 */

const html = fs.readFileSync(path.join(ADMIN, "public", "index.html"), "utf8");
let bodyHtml = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
// 去掉 <script src>：happy-dom 会真去加载它，这里改成手动 eval
bodyHtml = bodyHtml.replace(/<script[^>]*src=[^>]*><\/script>/g, "");
document.body.innerHTML = bodyHtml;

const appCode = fs.readFileSync(path.join(ADMIN, "public", "app.js"), "utf8");
(0, eval)(appCode);

await tick(120); // 等 boot() 把列表拉完

const $ = (id) => document.getElementById(id);
const qsa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

/* ------------------------------------------------------------------ 用例 */

console.log("\n后台前端：合集编辑");

await check("启动后列表加载完成", () => {
    eq($("app").hidden, false, "app 是否显示");
    eq(qsa(".item").length, POSTS.length, "文章条目数");
    return `${POSTS.length} 篇文章`;
});

await check("切到系列标签页后列出系列与合集", () => {
    qsa(".tab").find((t) => t.dataset.mode === "series").click();
    return "已切换";
});

await tick(80);

await check("系列列表包含系列和合集两种", () => {
    const titles = qsa(".item .item-title").map((el) => el.textContent);
    if (!titles.includes("系列甲")) throw new Error("没列出系列");
    if (!titles.includes("合集乙")) throw new Error("没列出合集");
    return titles.join(" / ");
});

await check("打开合集：类型下拉显示合集，成员表列出现有成员", async () => {
    qsa(".item").find((el) => el.textContent.includes("合集乙")).click();
    await tick(80);
    eq($("fSeriesType").value, "collection", "类型下拉");
    const rows = qsa(".coll-row");
    eq(rows.length, 1, "成员行数");
    eq(qsa(".coll-target")[0].value, "posts/post-1", "成员引用键");
    return "1 个成员";
});

await check("把类型切成系列，成员表换成关联文章面板", async () => {
    const sel = $("fSeriesType");
    sel.value = "";
    sel.dispatchEvent(new window.Event("change"));
    await tick(40);
    eq(qsa(".coll-row").length, 0, "合集成员行应消失");
    if (!qsa(".check-row").length) throw new Error("关联文章面板没出现");
    return "已切换成系列面板";
});

await check("切回合集，成员表回来", async () => {
    const sel = $("fSeriesType");
    sel.value = "collection";
    sel.dispatchEvent(new window.Event("change"));
    await tick(40);
    eq(qsa(".coll-row").length, 1, "成员行数");
    return "成员表已恢复";
});

await check("加一条成员并在目标下拉里选文章", async () => {
    const add = qsa("#specialPanel .btn-link").find((b) => b.textContent.includes("加一篇文章"));
    if (!add) throw new Error("没找到「加一篇文章」按钮");
    add.click();
    await tick(40);

    const rows = qsa(".coll-row");
    eq(rows.length, 2, "成员行数");

    const target = qsa(".coll-target")[1];
    target.value = "posts/post-2";
    target.dispatchEvent(new window.Event("change"));
    await tick(40);
    return "已加第 2 条";
});

await check("保存时把 type 和 items 一起发出去", async () => {
    $("saveBtn").click();
    await tick(120);

    const put = sent.find((s) => s.method === "PUT" && s.path === "/api/series/coll-b");
    if (!put) throw new Error("没发出保存请求");
    eq(put.body.type, "collection", "请求体 type");
    eq(put.body.items, [{ post: "posts/post-1" }, { post: "posts/post-2" }], "请求体 items");
    return "type=collection，2 个成员";
});

await check("删掉一条成员后保存，items 少一条", async () => {
    const del = qsa(".coll-row")[1].querySelector(".btn-link.danger");
    del.click();
    await tick(40);
    eq(qsa(".coll-row").length, 1, "删除后行数");

    $("saveBtn").click();
    await tick(120);

    const puts = sent.filter((s) => s.method === "PUT" && s.path === "/api/series/coll-b");
    const last = puts[puts.length - 1];
    eq(last.body.items, [{ post: "posts/post-1" }], "最后一次请求体 items");
    return "剩 1 个成员";
});

await check("切回系列保存，items 不再发出去", async () => {
    const sel = $("fSeriesType");
    sel.value = "";
    sel.dispatchEvent(new window.Event("change"));
    await tick(40);

    $("saveBtn").click();
    await tick(120);

    const puts = sent.filter((s) => s.method === "PUT" && s.path === "/api/series/coll-b");
    const last = puts[puts.length - 1];
    if (last.body.items) throw new Error("切回系列后还在发 items");
    if (last.body.type === "collection") throw new Error("type 还是 collection");
    return "type 已清空";
});

/* ------------------------------------------------------------------ 收尾 */

console.log(`\n全部通过：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
