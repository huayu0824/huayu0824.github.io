/* ==========================================================================
   站点设置面板
   --------------------------------------------------------------------------
   改的是仓库根目录的两个文件：
     site.settings.json   博客名称、页面开关、导航、页脚、首页文案
     site.texts.json      页面文字（覆盖 amytis 的 i18n 词条）

   保存 = 提交一次 commit → CI 重建 → 站点生效（约 1 分钟）。
   ========================================================================== */
(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };
    var qsa = function (sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    };

    var state = {
        group: "site",
        settings: null,
        texts: { defaults: {}, overrides: {} },
        textLocale: "zh",
        textQuery: "",
        dirty: false,
    };

    /* ------------------------------------------------------------------ 分组 */

    var GROUPS = [
        {
            id: "site",
            label: "站点",
            desc: "博客名称、描述、图标与分享图",
            fields: [
                { path: "title.zh", label: "博客名称（中文）", kind: "text" },
                { path: "title.en", label: "博客名称（英文）", kind: "text" },
                { path: "description.zh", label: "博客描述（中文）", kind: "textarea",
                  hint: "搜索引擎和分享卡片上显示的那段话" },
                { path: "description.en", label: "博客描述（英文）", kind: "textarea" },
                { path: "logo.src", label: "Logo 路径", kind: "text", hint: "左上角那个小图" },
                { path: "logo.favicon", label: "站点图标路径", kind: "text", hint: "浏览器标签页上的那个" },
                { path: "ogImage", label: "分享图路径", kind: "text", hint: "分享到微信 / 推特时的封面" },
            ],
        },
        { id: "features", label: "页面开关", desc: "关掉的页面，导航里也不再出现" },
        { id: "homepage", label: "首页分区", desc: "首页从上到下显示哪些区块" },
        { id: "nav", label: "导航", desc: "顶部导航的条目与顺序" },
        { id: "footer", label: "页脚", desc: "页脚链接、社交账号与版权" },
        {
            id: "hero",
            label: "首页文案",
            desc: "首页大标题区域的那几行字",
            fields: [
                { path: "hero.tagline.zh", label: "标语", kind: "text" },
                { path: "hero.title.zh", label: "大标题", kind: "textarea" },
                { path: "hero.subtitle.zh", label: "副标题", kind: "textarea" },
            ],
        },
        { id: "texts", label: "页面文字", desc: "站点各处显示的文案：标题、说明、按钮" },
    ];

    var SECTION_LABELS = {
        hero: "首屏",
        "featured-posts": "精选文章",
        "latest-posts": "最新文章",
        "recent-flows": "最近随笔",
        "featured-series": "精选系列",
        "featured-books": "精选书籍",
    };

    var FEATURE_LABELS = {
        posts: "文章",
        series: "系列",
        books: "书籍",
        flow: "随笔 / 笔记 / 图谱",
    };

    var FOOTER_LISTS = [
        { key: "explore", label: "探索" },
        { key: "connect", label: "链接" },
    ];

    /* ------------------------------------------------------------------ 工具 */

    function api(path, options) {
        return window.AdminCore.api(path, options);
    }

    function toast(message, isError) {
        return window.AdminCore.toast(message, isError);
    }

    function getPath(obj, path) {
        return path.split(".").reduce(function (acc, key) {
            return acc === null || acc === undefined ? undefined : acc[key];
        }, obj);
    }

    function setPath(obj, path, value) {
        var parts = path.split(".");
        var last = parts.pop();
        var target = obj;
        parts.forEach(function (key) {
            if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
            target = target[key];
        });
        target[last] = value;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function markDirty() {
        state.dirty = true;
        var btn = $("settingsSave");
        if (btn) btn.textContent = "保存设置 •";
    }

    /** 把可能是字符串的本地化字段统一成 { zh, en }，前端路径才好用 */
    function normalizeLocale(value, fallback) {
        if (value && typeof value === "object") {
            return { zh: value.zh || "", en: value.en || "" };
        }
        return { zh: typeof value === "string" ? value : (fallback || ""), en: "" };
    }

    function normalizeSettings(input) {
        var s = input && typeof input === "object" ? input : {};
        s.title = normalizeLocale(s.title);
        s.description = normalizeLocale(s.description);
        s.hero = s.hero && typeof s.hero === "object" ? s.hero : {};
        s.hero.tagline = normalizeLocale(s.hero.tagline);
        s.hero.title = normalizeLocale(s.hero.title);
        s.hero.subtitle = normalizeLocale(s.hero.subtitle);
        s.logo = s.logo && typeof s.logo === "object" ? s.logo : {};
        s.features = s.features && typeof s.features === "object" ? s.features : {};
        s.homepage = s.homepage && typeof s.homepage === "object" ? s.homepage : {};
        if (!Array.isArray(s.homepage.sections)) s.homepage.sections = [];
        if (!Array.isArray(s.nav)) s.nav = [];
        s.footer = s.footer && typeof s.footer === "object" ? s.footer : {};
        FOOTER_LISTS.forEach(function (list) {
            if (!Array.isArray(s.footer[list.key])) s.footer[list.key] = [];
        });
        s.footerText = normalizeLocale(s.footerText);
        s.social = s.social && typeof s.social === "object" ? s.social : {};
        s.share = s.share && typeof s.share === "object" ? s.share : {};
        return s;
    }

    /* ------------------------------------------------------------------ 载入 */

    function init() {
        var btn = $("settingsBtn");
        if (btn) {
            btn.addEventListener("click", function () {
                if (state.settings) open();
                else {
                    toast("正在读取设置…");
                    load();
                }
            });
        }
        var close = $("settingsClose");
        if (close) close.addEventListener("click", closeSettings);
    }

    function load() {
        Promise.all([api("/api/settings"), api("/api/texts")])
            .then(function (res) {
                state.settings = normalizeSettings(res[0].settings);
                state.texts = {
                    defaults: res[1].defaults || {},
                    overrides: res[1].overrides || {},
                };
                state.dirty = false;
                open();
            })
            .catch(function (e) { toast(e.message, true); });
    }

    function open() {
        $("app").hidden = true;
        $("settingsView").hidden = false;
        renderNav();
        renderGroup();
    }

    function closeSettings() {
        if (state.dirty && !confirm("有没保存的修改，确定要关掉吗？")) return;
        state.dirty = false;
        $("settingsView").hidden = true;
        $("app").hidden = false;
    }

    /* ------------------------------------------------------------------ 渲染 */

    function renderNav() {
        var nav = $("settingsNav");
        nav.replaceChildren();
        GROUPS.forEach(function (group) {
            var btn = el("button", "set-nav-item" + (group.id === state.group ? " is-on" : ""));
            btn.type = "button";
            btn.appendChild(el("span", "set-nav-label", group.label));
            btn.addEventListener("click", function () {
                state.group = group.id;
                renderNav();
                renderGroup();
            });
            nav.appendChild(btn);
        });
    }

    function renderGroup() {
        var main = $("settingsMain");
        main.replaceChildren();

        var group = GROUPS.find(function (g) { return g.id === state.group; });
        if (!group) return;

        var head = el("div", "set-head");
        head.appendChild(el("h2", "set-title", group.label));
        if (group.desc) head.appendChild(el("p", "set-desc", group.desc));
        main.appendChild(head);

        var body = el("div", "set-body");
        main.appendChild(body);

        if (group.id === "features") renderFeatures(body);
        else if (group.id === "homepage") renderSections(body);
        else if (group.id === "nav") renderNavList(body);
        else if (group.id === "footer") renderFooter(body);
        else if (group.id === "texts") renderTexts(body);
        else renderFields(body, group.fields || []);

        if (group.id !== "texts") {
            var foot = el("div", "set-foot");
            var save = el("button", "btn-primary", "保存设置");
            save.id = "settingsSave";
            save.type = "button";
            save.addEventListener("click", function () { saveSettings(); });
            foot.appendChild(save);

            var reload = el("button", "btn-ghost", "放弃修改");
            reload.type = "button";
            reload.addEventListener("click", function () {
                if (state.dirty && !confirm("确定要放弃未保存的修改吗？")) return;
                state.dirty = false;
                load();
            });
            foot.appendChild(reload);

            var tip = el("span", "set-tip", "保存后会自动提交，约 1 分钟后站点生效");
            foot.appendChild(tip);
            main.appendChild(foot);
        }
    }

    /** 普通字段组：按 path 读写 settings */
    function renderFields(body, fields) {
        fields.forEach(function (field) {
            var row = el("label", "set-field");
            row.appendChild(el("span", "set-label", field.label));

            var value = getPath(state.settings, field.path);
            var input;
            if (field.kind === "textarea") {
                input = el("textarea", "set-input set-textarea");
                input.value = value === undefined || value === null ? "" : String(value);
            } else {
                input = el("input", "set-input");
                input.type = "text";
                input.value = value === undefined || value === null ? "" : String(value);
            }
            input.addEventListener("input", function () {
                setPath(state.settings, field.path, input.value);
                markDirty();
            });
            row.appendChild(input);

            if (field.hint) row.appendChild(el("span", "set-hint", field.hint));
            body.appendChild(row);
        });
    }

    /** 页面开关 */
    function renderFeatures(body) {
        var features = state.settings.features;
        var keys = Object.keys(features);
        if (!keys.length) {
            body.appendChild(el("p", "set-empty", "没有可开关的页面"));
            return;
        }

        keys.forEach(function (key) {
            var feature = features[key];
            var row = el("div", "set-switch-row");

            var left = el("label", "set-switch");
            var cb = el("input");
            cb.type = "checkbox";
            cb.checked = feature.enabled === true;
            cb.addEventListener("change", function () {
                feature.enabled = cb.checked;
                markDirty();
            });
            left.appendChild(cb);
            left.appendChild(el("span", "set-switch-label", FEATURE_LABELS[key] || key));
            row.appendChild(left);

            var nameWrap = el("label", "set-field set-field-inline");
            nameWrap.appendChild(el("span", "set-label", "显示名"));
            var name = el("input", "set-input");
            name.type = "text";
            name.value = (feature.name && feature.name.zh) || "";
            name.addEventListener("input", function () {
                if (!feature.name || typeof feature.name !== "object") feature.name = {};
                feature.name.zh = name.value;
                markDirty();
            });
            nameWrap.appendChild(name);
            row.appendChild(nameWrap);

            body.appendChild(row);
        });
    }

    /** 首页分区 */
    function renderSections(body) {
        var sections = state.settings.homepage.sections;
        if (!sections.length) {
            body.appendChild(el("p", "set-empty", "没有可配置的分区"));
            return;
        }

        sections.forEach(function (section) {
            var row = el("div", "set-switch-row");

            var left = el("label", "set-switch");
            var cb = el("input");
            cb.type = "checkbox";
            cb.checked = section.enabled === true;
            cb.addEventListener("change", function () {
                section.enabled = cb.checked;
                markDirty();
            });
            left.appendChild(cb);
            left.appendChild(el("span", "set-switch-label", SECTION_LABELS[section.id] || section.id));
            row.appendChild(left);

            if (section.maxItems !== undefined) {
                var wrap = el("label", "set-field set-field-inline set-field-narrow");
                wrap.appendChild(el("span", "set-label", "最多"));
                var num = el("input", "set-input");
                num.type = "number";
                num.min = "1";
                num.value = String(section.maxItems);
                num.addEventListener("input", function () {
                    var n = parseInt(num.value, 10);
                    section.maxItems = isNaN(n) ? 1 : Math.max(1, n);
                    markDirty();
                });
                wrap.appendChild(num);
                row.appendChild(wrap);
            }

            body.appendChild(row);
        });
    }

    /** 导航：名字 / 链接 / 权重 / 子项 */
    function renderNavList(body) {
        var list = state.settings.nav;
        var box = el("div", "set-list");
        body.appendChild(box);

        list.forEach(function (item, index) {
            box.appendChild(navRow(item, index, list, null));
        });

        var add = el("button", "btn-ghost", "＋ 加一项");
        add.type = "button";
        add.addEventListener("click", function () {
            list.push({ name: "新条目", url: "", weight: list.length + 1 });
            markDirty();
            renderGroup();
        });
        body.appendChild(add);
    }

    function navRow(item, index, list, parent) {
        var row = el("div", "set-list-item");

        var name = el("input", "set-input");
        name.type = "text";
        name.value = item.name || "";
        name.placeholder = "名称";
        name.addEventListener("input", function () { item.name = name.value; markDirty(); });

        var url = el("input", "set-input set-input-url");
        url.type = "text";
        url.value = item.url || "";
        url.placeholder = "/about 或 https://…";
        url.addEventListener("input", function () { item.url = url.value; markDirty(); });

        row.appendChild(name);
        row.appendChild(url);

        if (!parent) {
            var weight = el("input", "set-input set-input-num");
            weight.type = "number";
            weight.value = String(item.weight === undefined ? index + 1 : item.weight);
            weight.addEventListener("input", function () {
                var n = parseInt(weight.value, 10);
                item.weight = isNaN(n) ? index + 1 : n;
                markDirty();
            });
            row.appendChild(weight);
        }

        var acts = el("span", "set-list-acts");
        acts.appendChild(iconBtn("↑", "上移", function () {
            var target = parent || list;
            var i = target.indexOf(item);
            if (i > 0) { target.splice(i - 1, 0, target.splice(i, 1)[0]); markDirty(); renderGroup(); }
        }));
        acts.appendChild(iconBtn("↓", "下移", function () {
            var target = parent || list;
            var i = target.indexOf(item);
            if (i >= 0 && i < target.length - 1) { target.splice(i + 1, 0, target.splice(i, 1)[0]); markDirty(); renderGroup(); }
        }));
        acts.appendChild(iconBtn("＋", "加子项", function () {
            if (!Array.isArray(item.children)) item.children = [];
            item.children.push({ name: "新子项", url: "" });
            markDirty();
            renderGroup();
        }));
        acts.appendChild(iconBtn("×", "删除", function () {
            if (!confirm("确定要删掉「" + (item.name || "这一项") + "」吗？")) return;
            (parent || list).splice((parent || list).indexOf(item), 1);
            markDirty();
            renderGroup();
        }, true));
        row.appendChild(acts);

        if (Array.isArray(item.children) && item.children.length) {
            var kids = el("div", "set-list-children");
            item.children.forEach(function (child, i) {
                kids.appendChild(navRow(child, i, item.children, item));
            });
            row.appendChild(kids);
        }

        return row;
    }

    /** 页脚：两组链接 + 社交 + 版权 */
    function renderFooter(body) {
        FOOTER_LISTS.forEach(function (list) {
            body.appendChild(el("h3", "set-subtitle", list.label));

            var box = el("div", "set-list");
            body.appendChild(box);

            state.settings.footer[list.key].forEach(function (item) {
                box.appendChild(simpleLinkRow(item, state.settings.footer[list.key]));
            });

            var add = el("button", "btn-ghost", "＋ 加一个链接");
            add.type = "button";
            add.addEventListener("click", function () {
                state.settings.footer[list.key].push({ name: "新链接", url: "", weight: state.settings.footer[list.key].length + 1 });
                markDirty();
                renderGroup();
            });
            body.appendChild(add);
        });

        body.appendChild(el("h3", "set-subtitle", "社交账号"));
        var social = el("div", "set-grid");
        body.appendChild(social);
        Object.keys(state.settings.social).forEach(function (key) {
            var row = el("label", "set-field");
            row.appendChild(el("span", "set-label", key));
            var input = el("input", "set-input");
            input.type = "text";
            input.value = state.settings.social[key] || "";
            input.addEventListener("input", function () {
                state.settings.social[key] = input.value;
                markDirty();
            });
            row.appendChild(input);
            social.appendChild(row);
        });

        body.appendChild(el("h3", "set-subtitle", "版权"));
        var copy = el("label", "set-field");
        copy.appendChild(el("span", "set-label", "页脚版权文字"));
        var copyInput = el("input", "set-input");
        copyInput.type = "text";
        copyInput.value = state.settings.footerText && state.settings.footerText.zh ? state.settings.footerText.zh : "";
        copyInput.addEventListener("input", function () {
            if (!state.settings.footerText || typeof state.settings.footerText !== "object") {
                state.settings.footerText = {};
            }
            state.settings.footerText.zh = copyInput.value;
            markDirty();
        });
        copy.appendChild(copyInput);
        body.appendChild(copy);
    }

    function simpleLinkRow(item, list) {
        var row = el("div", "set-list-item");

        var name = el("input", "set-input");
        name.type = "text";
        name.value = item.name || "";
        name.placeholder = "名称";
        name.addEventListener("input", function () { item.name = name.value; markDirty(); });

        var url = el("input", "set-input set-input-url");
        url.type = "text";
        url.value = item.url || "";
        url.placeholder = "/about";
        url.addEventListener("input", function () { item.url = url.value; markDirty(); });

        row.appendChild(name);
        row.appendChild(url);

        var acts = el("span", "set-list-acts");
        acts.appendChild(iconBtn("×", "删除", function () {
            list.splice(list.indexOf(item), 1);
            markDirty();
            renderGroup();
        }, true));
        row.appendChild(acts);
        return row;
    }

    function iconBtn(text, title, onClick, danger) {
        var btn = el("button", "btn-link" + (danger ? " danger" : ""), text);
        btn.type = "button";
        btn.title = title;
        btn.addEventListener("click", onClick);
        return btn;
    }

    /* ------------------------------------------------------------------ 页面文字 */

    function renderTexts(body) {
        var defaults = state.texts.defaults[state.textLocale] || {};
        var overrides = state.texts.overrides[state.textLocale] || {};

        var tools = el("div", "set-text-tools");
        var search = el("input", "set-input set-input-search");
        search.type = "search";
        search.placeholder = "搜文案键或内容…";
        search.value = state.textQuery;
        search.addEventListener("input", function () {
            state.textQuery = search.value;
            renderTextList();
        });
        tools.appendChild(search);
        body.appendChild(tools);

        var list = el("div", "set-text-list");
        body.appendChild(list);

        function renderTextList() {
            list.replaceChildren();
            var keys = Object.keys(defaults).sort();
            var q = state.textQuery.trim().toLowerCase();
            var shown = 0;

            keys.forEach(function (key) {
                var fallback = defaults[key];
                var current = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
                if (q && key.toLowerCase().indexOf(q) < 0 && String(current).toLowerCase().indexOf(q) < 0) return;
                shown++;

                var row = el("label", "set-text-row");
                var name = el("span", "set-text-key", key);
                row.appendChild(name);

                var input = el("input", "set-input");
                input.type = "text";
                input.value = current || "";
                input.placeholder = fallback || "";
                input.addEventListener("input", function () {
                    if (!state.texts.overrides[state.textLocale]) state.texts.overrides[state.textLocale] = {};
                    if (input.value === fallback) delete state.texts.overrides[state.textLocale][key];
                    else state.texts.overrides[state.textLocale][key] = input.value;
                    markDirty();
                });
                row.appendChild(input);
                list.appendChild(row);
            });

            if (!shown) {
                list.appendChild(el("p", "set-empty", "没有匹配的文案"));
            }
        }

        renderTextList();

        var foot = el("div", "set-foot");
        var save = el("button", "btn-primary", "保存文案");
        save.id = "settingsSave";
        save.type = "button";
        save.addEventListener("click", function () { saveTexts(); });
        foot.appendChild(save);
        var tip = el("span", "set-tip", "只保存你改过的词条，没动过的保持原样");
        foot.appendChild(tip);
        body.appendChild(foot);
    }

    /* ------------------------------------------------------------------ 保存 */

    function saveSettings() {
        var btn = $("settingsSave");
        if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }

        api("/api/settings", {
            method: "PUT",
            body: JSON.stringify({ settings: state.settings }),
        }).then(function (res) {
            state.dirty = false;
            toast(res.message || "站点设置已保存");
            if (btn) btn.textContent = "保存设置";
        }).catch(function (e) {
            toast(e.message, true);
            if (btn) btn.textContent = "保存设置 •";
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function saveTexts() {
        var btn = $("settingsSave");
        if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }

        // 没改过的语言不写，文件里不留空对象
        var payload = {};
        Object.keys(state.texts.overrides).forEach(function (locale) {
            var map = state.texts.overrides[locale];
            if (map && Object.keys(map).length) payload[locale] = map;
        });

        api("/api/texts", {
            method: "PUT",
            body: JSON.stringify({ overrides: payload }),
        }).then(function (res) {
            state.dirty = false;
            toast(res.message || "页面文字已保存");
            if (btn) btn.textContent = "保存文案";
        }).catch(function (e) {
            toast(e.message, true);
            if (btn) btn.textContent = "保存文案 •";
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    window.AdminSettings = { init: init, open: open, close: closeSettings };
})();
