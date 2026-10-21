/* ==========================================================================
   博客后台前端逻辑
   --------------------------------------------------------------------------
   六种内容类型共用一套代码：类型差异全部收在 TYPES 注册表里，
   新增一种内容只要加一段配置，列表 / 表单 / 保存 / 删除自动生效。

   交互要点：
     · Markdown 工具栏 + 双链 [[]] 补全
     · 本地自动草稿，关页面不丢稿
     · 编辑 / 分栏 / 预览 三种布局
     · 专注模式、多选批量操作、版本历史回滚、图片库
   ========================================================================== */
(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };
    var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    /* ------------------------------------------------------------------ 类型注册表
       字段的 id 是 DOM 元素 id，api 是它对应后端 API 的字段名。
       两个不一致时，以 api 为准。 */

    var TYPES = {
        posts: {
            label: "文章",
            base: "/api/posts",
            key: "slug",
            newLabel: "＋ 新建文章",
            flags: ["draft", "featured"],
            fields: [
                { id: "fSlug", api: "slug", label: "网址别名 slug", kind: "text", placeholder: "my-post",
                  hint: "决定线上地址 /posts/<slug>/，只允许小写字母、数字和连字符" },
                { id: "fDate", api: "date", label: "发布日期", kind: "date" },
                { id: "fCategory", api: "category", label: "分类", kind: "text", placeholder: "项目" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags", placeholder: "ESP32, AI" },
                { id: "fRedirect", api: "redirectFrom", label: "旧网址跳转", kind: "list", placeholder: "/p/old-slug",
                  hint: "逗号分隔，不要带结尾斜杠。Hugo 时代的旧链接靠它跳转" },
                { id: "fExcerpt", api: "excerpt", label: "摘要", kind: "textarea", placeholder: "列表页和首页卡片上显示的一句话" },
                { id: "fCover", api: "coverImage", label: "封面图", kind: "cover" }
            ]
        },
        flows: {
            label: "随笔",
            base: "/api/flows",
            key: "date",
            newLabel: "＋ 写今天的随笔",
            flags: ["draft"],
            fields: [
                { id: "fFlowDate", api: "date", label: "日期", kind: "date" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags", placeholder: "训练, 装备" }
            ]
        },
        notes: {
            label: "笔记",
            base: "/api/notes",
            key: "slug",
            newLabel: "＋ 新建笔记",
            flags: ["draft"],
            fields: [
                { id: "fNoteSlug", api: "slug", label: "网址别名 slug", kind: "text", placeholder: "note-slug",
                  hint: "决定线上地址 /notes/<slug>，只允许小写字母、数字和连字符" },
                { id: "fNoteDate", api: "date", label: "日期", kind: "date" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags", placeholder: "知识库, 技巧" },
                { id: "fNoteAliases", api: "aliases", label: "别名（逗号分隔）", kind: "list", placeholder: "旧名字, another-name",
                  hint: "别名也是双链目标，全站唯一。改了旧的链接还能跳过来" }
            ]
        },
        series: {
            label: "系列",
            base: "/api/series",
            key: "slug",
            newLabel: "＋ 新建系列",
            flags: ["draft", "featured"],
            fields: [
                { id: "fSeriesType", api: "type", label: "类型", kind: "select",
                  options: [["", "系列：文章归到同一个系列下"], ["collection", "合集：手工挑文章拼成一组"]],
                  hint: "系列靠文章的 series 字段自动收集成员；合集不改任何文章的归属，自己挑成员（至少 1 个，否则 amytis 拒绝构建）" },
                { id: "fSeriesSlug", api: "slug", label: "网址别名 slug", kind: "text", placeholder: "my-series" },
                { id: "fSeriesDate", api: "date", label: "日期", kind: "date" },
                { id: "fSeriesDesc", api: "excerpt", label: "简介", kind: "textarea", placeholder: "这个系列在做什么" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags" },
                { id: "fSeriesCover", api: "coverImage", label: "封面图", kind: "cover" }
            ]
        },
        books: {
            label: "书籍",
            base: "/api/books",
            key: "slug",
            newLabel: "＋ 新建书籍",
            flags: ["draft", "featured"],
            fields: [
                { id: "fBookSlug", api: "slug", label: "网址别名 slug", kind: "text", placeholder: "my-book" },
                { id: "fBookDate", api: "date", label: "date", kind: "date" },
                { id: "fBookDesc", api: "excerpt", label: "简介", kind: "textarea", placeholder: "这本书讲什么" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags" },
                { id: "fBookCover", api: "coverImage", label: "封面图", kind: "cover" }
            ]
        },
        pages: {
            label: "页面",
            base: "/api/pages",
            key: "name",
            newLabel: "＋ 新建页面",
            flags: ["draft", "featured"],
            fields: [
                { id: "fPageName", api: "name", label: "文件名", kind: "text", placeholder: "about",
                  hint: "content/<文件名>.md，对应线上 /<文件名>/" },
                { id: "fPageDate", api: "date", label: "日期", kind: "date" },
                { id: "fPageLayout", api: "layout", label: "版式", kind: "text", placeholder: "post",
                  hint: "默认 post，写 simple 是简洁版式" },
                { id: "fPageExcerpt", api: "excerpt", label: "摘要", kind: "textarea" },
                { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags" }
            ]
        }
    };

    var FLAG_LABELS = { draft: "草稿", featured: "精选" };

    var state = {
        session: null,
        mode: "posts",
        lists: {},                 // type -> { items, total, loaded }
        current: null,             // { key }
        currentData: null,         // 当前打开条目的完整数据
        dirty: false,
        filter: "",
        sort: "date-desc",
        booted: false,
        batch: null,               // Set<string> 选中的 key
        linkTargets: {},           // slug -> { title, type }
        collectionItems: []        // 合集成员的工作副本
    };

    var SUN_ICON =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"></circle>' +
        '<path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"></path></svg>';
    var MOON_ICON =
        '<svg viewBox="0 0 24 24"><path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.9 6.9 0 0 0 11.1 11.1z"></path></svg>';

    /* --------------------------------------------------------------- 网络 */

    async function api(path, options) {
        var res = await fetch(path, Object.assign({
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin"
        }, options || {}));

        var data = null;
        try { data = await res.json(); } catch (e) { /* 非 JSON 响应 */ }

        if (res.status === 401) {
            showGate(state.booted ? "登录已过期，请重新登录" : "");
            throw new Error("未登录");
        }
        if (!res.ok) throw new Error((data && data.error) || ("请求失败：" + res.status));
        return data;
    }

    function toast(message, isError) {
        var el = $("toast");
        el.textContent = message;
        el.classList.toggle("is-error", Boolean(isError));
        el.hidden = false;
        clearTimeout(el._timer);
        el._timer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 2600);
    }

    /* --------------------------------------------------------------- 启动 */

    async function boot() {
        try {
            state.session = await api("/api/session");
        } catch (e) {
            return; // showGate 已在 api 里处理
        }

        $("gate").hidden = true;
        $("app").hidden = false;
        state.booted = true;

        $("who").textContent = state.session.name || state.session.login;
        $("avatar").src = state.session.avatar || "";
        $("repoInfo").textContent = state.session.repo + " @ " + state.session.branch;

        buildTabs();
        buildFields();
        paintSchemeBtn();
        paintLayout();

        // 先把文章列表拉起来，双链补全要用
        await loadList("posts", false);
        await loadList(state.mode, false);
        var first = visibleItems()[0];
        if (first) openItem(keyOf(first));
    }

    function showGate(hint) {
        $("app").hidden = true;
        $("gate").hidden = false;
        if (hint) $("gateHint").textContent = hint;
    }

    /* --------------------------------------------------------------- 明暗 / 布局 */

    function paintSchemeBtn() {
        var btn = $("schemeBtn");
        btn.innerHTML = document.documentElement.dataset.scheme === "dark" ? SUN_ICON : MOON_ICON;
        btn.setAttribute("aria-label",
            document.documentElement.dataset.scheme === "dark" ? "切换到浅色" : "切换到深色");
    }

    function paintLayout() {
        var layout = document.documentElement.dataset.layout || "split";
        qsa(".seg-btn").forEach(function (b) {
            b.classList.toggle("is-on", b.dataset.layout === layout);
        });
    }

    function setLayout(layout) {
        document.documentElement.dataset.layout = layout;
        try { localStorage.setItem("hd-layout", layout); } catch (e) {}
        paintLayout();
    }

    function toggleFocus() {
        var on = document.body.classList.toggle("is-focus");
        $("focusBtn").classList.toggle("is-on", on);
    }

    /* --------------------------------------------------------------- 类型标签页 */

    function buildTabs() {
        var box = $("tabs");
        box.replaceChildren();
        Object.keys(TYPES).forEach(function (type) {
            var btn = document.createElement("button");
            btn.className = "tab" + (type === state.mode ? " is-active" : "");
            btn.dataset.mode = type;
            btn.type = "button";
            btn.setAttribute("role", "tab");
            btn.innerHTML = "<span>" + TYPES[type].label + '</span><span class="tab-count" data-count="' + type + '"></span>';
            btn.addEventListener("click", function () { setMode(type); });
            box.appendChild(btn);
        });
    }

    function paintCounts() {
        qsa("[data-count]").forEach(function (el) {
            var type = el.dataset.count;
            var list = state.lists[type];
            el.textContent = list ? String(list.total) : "";
        });
    }

    /* --------------------------------------------------------------- 表单字段 */

    function buildFields() {
        var grid = $("metaGrid");
        grid.replaceChildren();

        var type = TYPES[state.mode];
        type.fields.forEach(function (f) {
            var label = document.createElement("label");
            label.className = "field";

            var span = document.createElement("span");
            span.textContent = f.label;
            label.appendChild(span);

            if (f.kind === "textarea") {
                var ta = document.createElement("textarea");
                ta.id = f.id;
                ta.rows = 2;
                ta.placeholder = f.placeholder || "";
                ta.addEventListener("input", markDirty);
                label.appendChild(ta);
            } else if (f.kind === "select") {
                var sel = document.createElement("select");
                sel.id = f.id;
                (f.options || []).forEach(function (opt) {
                    var o = document.createElement("option");
                    o.value = opt[0];
                    o.textContent = opt[1];
                    sel.appendChild(o);
                });
                sel.addEventListener("change", function () {
                    markDirty();
                    // 类型切换后，系列面板要跟着换（关联文章 ↔ 合集成员）
                    if (f.api === "type") refreshSpecialPanel();
                });
                label.appendChild(sel);
            } else if (f.kind === "cover") {
                var row = document.createElement("div");
                row.className = "cover-row";
                var input = document.createElement("input");
                input.id = f.id;
                input.placeholder = f.placeholder || "";
                input.addEventListener("input", markDirty);
                var pick = document.createElement("button");
                pick.className = "btn-ghost";
                pick.type = "button";
                pick.textContent = "上传";
                pick.addEventListener("click", function () { $("coverFile").click(); });
                row.appendChild(input);
                row.appendChild(pick);
                label.appendChild(row);
            } else {
                var el = document.createElement("input");
                el.id = f.id;
                if (f.kind === "date") el.type = "date";
                else if (f.kind === "tags" || f.kind === "list") el.type = "text";
                else el.type = "text";
                el.placeholder = f.placeholder || "";
                el.autocomplete = "off";
                el.addEventListener("input", markDirty);
                label.appendChild(el);
            }

            if (f.hint) {
                var hint = document.createElement("p");
                hint.className = "field-hint";
                hint.textContent = f.hint;
                label.appendChild(hint);
            }

            grid.appendChild(label);
        });
    }

    /* --------------------------------------------------------------- 列表 */

    function store(type) {
        var t = type || state.mode;
        if (!state.lists[t]) state.lists[t] = { items: [], total: 0, loaded: 40 };
        return state.lists[t];
    }

    function keyOf(item, type) {
        var t = type || state.mode;
        return item[TYPES[t].key];
    }

    function currentKey() {
        return state.current ? state.current.key : null;
    }

    async function loadList(type, append) {
        var t = type || state.mode;
        var box = store(t);
        // 重新加载时从第 0 条开始；追加时从已加载条数往后接。
        // 之前写成「先把 loaded 设成 40 再拿它当 offset」，等于首屏跳过了前 40 条，
        // 博客文章不足 40 篇时列表会空空如也。
        if (!append) {
            box.items = [];
            box.loaded = 0;
        }

        var params = new URLSearchParams();
        params.set("limit", "40");
        params.set("offset", String(box.loaded));
        if (state.filter.trim() && t === state.mode) params.set("q", state.filter.trim());
        if (state.sort !== "date-desc" && t === state.mode) params.set("sort", state.sort);

        try {
            var data = await api(TYPES[t].base + "?" + params.toString());
            box.items = append ? box.items.concat(data.items) : data.items;
            box.total = data.total;
            box.loaded = box.items.length;

            data.items.forEach(function (item) {
                var k = keyOf(item, t);
                if (k && item.title) state.linkTargets[k] = { title: item.title, type: t };
            });

            paintCounts();
            if (t === state.mode) renderList();
        } catch (e) {
            toast(e.message, true);
        }
    }

    function visibleItems() {
        var needle = state.filter.trim().toLowerCase();
        var items = store().items;

        if (needle) {
            items = items.filter(function (item) {
                var hay = [
                    item.title || "",
                    item.slug || item.name || "",
                    item.date || "",
                    (item.tags || []).join(" "),
                    item.category || ""
                ].join(" ").toLowerCase();
                return hay.indexOf(needle) >= 0;
            });
        }

        var sort = state.sort;
        var list = items.slice();
        list.sort(function (a, b) {
            if (sort === "date-asc") return (a.date || "").localeCompare(b.date || "");
            if (sort === "words-desc") return (b.words || 0) - (a.words || 0);
            if (sort === "title-asc") return (a.title || "").localeCompare(b.title || "", "zh");
            return (b.date || "").localeCompare(a.date || "");
        });
        return list;
    }

    function renderList() {
        var list = $("list");
        list.replaceChildren();

        var items = visibleItems();
        $("listEmpty").hidden = items.length > 0;
        $("listMore").hidden = store().items.length >= store().total;

        var active = currentKey();

        items.forEach(function (item) {
            var key = keyOf(item);
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "item" + (key === active ? " is-active" : "");
            btn.dataset.key = key;

            var body = document.createElement("span");
            body.className = "item-body";

            var title = document.createElement("span");
            title.className = "item-title";
            title.textContent = item.title || "(无标题)";

            var meta = document.createElement("span");
            meta.className = "item-meta";

            var date = document.createElement("span");
            date.textContent = item.date || item.name || "";
            meta.appendChild(date);

            if (item.draft) meta.appendChild(badge("草稿"));
            if (item.featured) meta.appendChild(badge("精选"));
            if (item.words) {
                var w = document.createElement("span");
                w.textContent = item.words + " 字";
                meta.appendChild(w);
            }

            (item.tags || []).slice(0, 2).forEach(function (t) {
                meta.appendChild(badge("#" + t));
            });

            body.appendChild(title);
            body.appendChild(meta);

            if (state.batch) {
                var check = document.createElement("input");
                check.type = "checkbox";
                check.className = "item-check";
                check.checked = state.batch.has(key);
                check.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (check.checked) state.batch.add(key); else state.batch.delete(key);
                    paintBatchBar();
                });
                btn.appendChild(check);
            }

            btn.appendChild(body);
            btn.addEventListener("click", function () {
                if (state.batch) {
                    if (state.batch.has(key)) state.batch.delete(key); else state.batch.add(key);
                    renderList();
                    paintBatchBar();
                    return;
                }
                openItem(key);
            });
            list.appendChild(btn);
        });
    }

    function badge(text) {
        var span = document.createElement("span");
        span.className = "item-tag";
        span.textContent = text;
        return span;
    }

    /* --------------------------------------------------------------- 批量 */

    function paintBatchBar() {
        var bar = $("listTools");
        if (!state.batch) { bar.hidden = true; return; }
        bar.hidden = false;
        $("batchCount").textContent = "已选 " + state.batch.size + " 项";
    }

    function toggleBatch() {
        if (state.batch) {
            state.batch = null;
        } else {
            state.batch = new Set();
            visibleItems().forEach(function (item) { state.batch.add(keyOf(item)); });
        }
        renderList();
        paintBatchBar();
    }

    async function batchAction(action) {
        if (!state.batch || !state.batch.size) return;
        var keys = Array.from(state.batch);
        var verb = action === "delete" ? "删除" : "转为草稿";
        if (!confirm("确定要" + verb + "选中的 " + keys.length + " 项吗？")) return;

        try {
            var res = await api("/api/batch", {
                method: "POST",
                body: JSON.stringify({ type: state.mode, action: action, keys: keys })
            });
            toast(res.message || "批量操作完成");
            state.batch = null;
            await loadList(state.mode, false);
            renderList();
            paintBatchBar();
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* --------------------------------------------------------------- 模式切换 */

    function setMode(mode) {
        if (state.mode === mode) return;
        if (state.dirty && !confirm("当前修改还没保存，确定要切换吗？")) return;

        state.mode = mode;
        state.current = null;
        state.batch = null;

        qsa(".tab").forEach(function (t) {
            t.classList.toggle("is-active", t.dataset.mode === mode);
        });

        $("newBtn").textContent = TYPES[mode].newLabel;
        $("form").hidden = true;
        $("editorEmpty").hidden = false;

        buildFields();
        paintBatchBar();
        renderList();

        loadList(mode, false).then(function () {
            var first = visibleItems()[0];
            if (first) openItem(keyOf(first));
        });
    }

    /* --------------------------------------------------------------- 打开条目 */

    async function openItem(key) {
        if (state.dirty && !confirm("当前修改还没保存，确定要切换吗？")) return;

        var type = state.mode;
        try {
            var data = await api(TYPES[type].base + "/" + encodeURIComponent(key));
            state.current = { key: key, type: type };
            state.currentData = data;
            state.dirty = false;

            $("editorEmpty").hidden = true;
            $("form").hidden = false;

            $("fTitle").value = data.title || "";
            $("fContent").value = data.content || "";
            $("fDraft").checked = data.draft === true;
            $("fFeatured").checked = data.featured === true;

            TYPES[type].fields.forEach(function (f) {
                var el = $(f.id);
                if (!el) return;
                var value = data[f.api];
                if (f.kind === "tags" || f.kind === "list") {
                    el.value = Array.isArray(value) ? value.join(", ") : (value || "");
                } else if (f.kind === "select") {
                    // 只有选项里有的值才认，否则回到第一项
                    var known = qsa("option", el).some(function (o) { return o.value === value; });
                    el.value = known ? value : "";
                } else {
                    el.value = value !== undefined && value !== null ? value : "";
                }
            });

            // 合集成员的工作副本，改完随表单一起保存
            state.collectionItems = (data.items || []).map(function (it) {
                if (it && it.series) {
                    return { series: it.series, exclude: (it.exclude || []).slice() };
                }
                return { post: (it && it.post) || "" };
            });

            $("viewLink").hidden = false;
            $("viewLink").href = data.url || "#";
            $("saveState").textContent = data.path || "";
            $("saveState").classList.remove("is-dirty", "is-error");

            renderSpecialPanel(type, data);

            renderList();
            updatePreview();
            checkLocalDraft(type, key);
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* --------------------------------------------------------------- 专用面板 */

    /**
     * 有些东西列表表单表达不了：
     *   系列 → 哪些文章挂在这个系列下
     *   合集 → 手工挑的成员（文章 / 整个系列）
     *   书籍 → 章节表 + 每章正文
     * 这些单独用一个面板渲染。
     */
    function renderSpecialPanel(type, data) {
        var panel = $("specialPanel");
        panel.replaceChildren();
        panel.hidden = true;

        if (type === "series") {
            if (data && data.type === "collection") renderCollectionPanel(panel, data);
            else renderSeriesPanel(panel, data);
        } else if (type === "books") renderBookPanel(panel, data);
    }

    /**
     * 类型切换（系列 ↔ 合集）后重画面板。
     * 面板内容取决于表单里的类型选择，不是文件里已保存的类型。
     */
    function refreshSpecialPanel() {
        if (state.mode !== "series") return;
        var typeEl = $("fSeriesType");
        var isCollection = typeEl && typeEl.value === "collection";
        var saved = state.currentData || {};
        renderSpecialPanel("series", {
            type: isCollection ? "collection" : "series",
            items: isCollection ? (state.collectionItems || []) : [],
            members: saved.members || []
        });
    }

    /* ------------------------------------------------------ 系列：关联文章 */

    function renderSeriesPanel(panel, data) {
        panel.hidden = false;

        var head = document.createElement("div");
        head.className = "panel-head";
        var h = document.createElement("strong");
        h.textContent = "关联文章";
        head.appendChild(h);
        var hint = document.createElement("span");
        hint.className = "pane-hint";
        hint.textContent = "勾选后写入文章的 series 字段";
        head.appendChild(hint);
        panel.appendChild(head);

        var box = document.createElement("div");
        box.className = "panel-body";
        panel.appendChild(box);

        var members = (data.members || []).map(function (m) { return m.slug; });

        if (!state.lists.posts || !state.lists.posts.items.length) {
            var empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "没有可选的文章";
            box.appendChild(empty);
            return;
        }

        state.lists.posts.items.forEach(function (post) {
            var row = document.createElement("label");
            row.className = "check-row";

            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = members.indexOf(post.slug) >= 0;
            cb.setAttribute("data-slug", post.slug);
            cb.addEventListener("change", function () {
                var slugs = qsa("input:checked", box).map(function (el) {
                    return el.getAttribute("data-slug");
                });
                applySeriesMembers(slugs);
            });

            var text = document.createElement("span");
            text.textContent = (post.title || post.slug) + "  ·  " + (post.date || "");

            row.appendChild(cb);
            row.appendChild(text);
            box.appendChild(row);
        });
    }

    function applySeriesMembers(slugs) {
        if (!state.current || !state.current.key) return;
        var slug = state.current.key;
        api("/api/series/" + encodeURIComponent(slug) + "/posts", {
            method: "PUT",
            body: JSON.stringify({ slugs: slugs })
        }).then(function (res) {
            toast(res.message || "系列成员已更新");
        }).catch(function (e) {
            toast(e.message, true);
        });
    }

    /* --------------------------------------------------------- 合集：成员表 */

    /**
     * 合集的成员写在索引文件的 items 数组里，跟表单一起保存。
     * 两种条目：
     *   引用一篇文章   { post: "<slug>" }
     *   整个系列收进来 { series: "<slug>", exclude: [...] }
     *
     * 引用键的形态由文章归属决定（跟 amytis 的 getCollectionKey 一致）：
     *   独立文章   → posts/<slug>
     *   系列内文章 → <series>/<slug>
     */
    function renderCollectionPanel(panel, data) {
        panel.hidden = false;

        var head = document.createElement("div");
        head.className = "panel-head";
        var h = document.createElement("strong");
        h.textContent = "合集成员";
        head.appendChild(h);
        var hint = document.createElement("span");
        hint.className = "pane-hint";
        hint.textContent = "不改文章的系列归属，自己挑成员（至少 1 个）";
        head.appendChild(hint);
        panel.appendChild(head);

        var box = document.createElement("div");
        box.className = "panel-body";
        panel.appendChild(box);

        var items = state.collectionItems || [];
        if (!items.length) {
            var empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "还没有成员，底下加一条";
            box.appendChild(empty);
        } else {
            items.forEach(function (item, idx) {
                box.appendChild(collectionItemRow(item, idx));
            });
        }

        var bar = document.createElement("div");
        bar.className = "panel-actions";

        var addPost = document.createElement("button");
        addPost.className = "btn-link";
        addPost.type = "button";
        addPost.textContent = "＋ 加一篇文章";
        addPost.addEventListener("click", function () {
            state.collectionItems = (state.collectionItems || []).concat([{ post: "" }]);
            refreshSpecialPanel();
            markDirty();
        });

        var addSeries = document.createElement("button");
        addSeries.className = "btn-link";
        addSeries.type = "button";
        addSeries.textContent = "＋ 加一个系列";
        addSeries.addEventListener("click", function () {
            state.collectionItems = (state.collectionItems || []).concat([{ series: "" }]);
            refreshSpecialPanel();
            markDirty();
        });

        bar.appendChild(addPost);
        bar.appendChild(addSeries);
        box.appendChild(bar);
    }

    function collectionItemRow(item, idx) {
        var row = document.createElement("div");
        row.className = "coll-row";

        var kind = document.createElement("select");
        kind.className = "coll-kind";
        [["post", "一篇文章"], ["series", "整个系列"]].forEach(function (opt) {
            var o = document.createElement("option");
            o.value = opt[0];
            o.textContent = opt[1];
            kind.appendChild(o);
        });
        kind.value = item.series ? "series" : "post";
        kind.addEventListener("change", function () {
            state.collectionItems[idx] = kind.value === "series" ? { series: "" } : { post: "" };
            refreshSpecialPanel();
            markDirty();
        });

        var target = document.createElement("select");
        target.className = "coll-target";
        if (kind.value === "series") fillSeriesOptions(target, item.series);
        else fillPostOptions(target, item.post);
        target.addEventListener("change", function () {
            var cur = state.collectionItems[idx] || {};
            if (kind.value === "series") {
                cur.series = target.value;
                delete cur.post;
                delete cur.exclude;
            } else {
                cur.post = target.value;
                delete cur.series;
                delete cur.exclude;
            }
            state.collectionItems[idx] = cur;
            markDirty();
        });

        row.appendChild(kind);
        row.appendChild(target);

        if (kind.value === "series") {
            var ex = document.createElement("input");
            ex.className = "coll-exclude";
            ex.placeholder = "排除（逗号分隔的文章 slug，可留空）";
            ex.value = (item.exclude || []).join(", ");
            ex.addEventListener("input", function () {
                var cur = state.collectionItems[idx] || {};
                cur.exclude = ex.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
                state.collectionItems[idx] = cur;
                markDirty();
            });
            row.appendChild(ex);
        }

        var del = document.createElement("button");
        del.className = "btn-link danger";
        del.type = "button";
        del.textContent = "删除";
        del.addEventListener("click", function () {
            state.collectionItems.splice(idx, 1);
            refreshSpecialPanel();
            markDirty();
        });
        row.appendChild(del);

        return row;
    }

    /** 文章下拉。引用键跟 amytis 的 getCollectionKey 保持一致 */
    function fillPostOptions(select, current) {
        var posts = (state.lists.posts && state.lists.posts.items) || [];
        var blank = document.createElement("option");
        blank.value = "";
        blank.textContent = posts.length ? "选一篇文章…" : "（仓库里还没有文章）";
        select.appendChild(blank);

        posts.forEach(function (post) {
            var key = post.series ? post.series + "/" + post.slug : "posts/" + post.slug;
            var o = document.createElement("option");
            o.value = key;
            o.textContent = (post.title || post.slug) + "  ·  " + key;
            select.appendChild(o);
        });

        select.value = current || "";
    }

    /** 系列下拉。不能选自己，否则合集会把自己收进来 */
    function fillSeriesOptions(select, current) {
        var list = (state.lists.series && state.lists.series.items) || [];
        var self = state.current ? state.current.key : "";

        var blank = document.createElement("option");
        blank.value = "";
        blank.textContent = list.length ? "选一个系列…" : "（仓库里还没有别的系列）";
        select.appendChild(blank);

        list.forEach(function (s) {
            if (s.slug === self) return;
            var o = document.createElement("option");
            o.value = s.slug;
            o.textContent = (s.title || s.slug);
            select.appendChild(o);
        });

        select.value = current || "";
    }

    /* --------------------------------------------------------- 书籍：章节 */

    function renderBookPanel(panel, data) {
        panel.hidden = false;

        var head = document.createElement("div");
        head.className = "panel-head";
        var h = document.createElement("strong");
        h.textContent = "章节";
        head.appendChild(h);
        var hint = document.createElement("span");
        hint.className = "pane-hint";
        hint.textContent = "id 对应 content/books/<slug>/<id>.md";
        head.appendChild(hint);
        var addBtn = document.createElement("button");
        addBtn.className = "btn-link";
        addBtn.type = "button";
        addBtn.textContent = "＋ 新增章节";
        addBtn.addEventListener("click", function () { addChapter(); });
        head.appendChild(addBtn);
        panel.appendChild(head);

        var list = document.createElement("div");
        list.className = "panel-body";
        panel.appendChild(list);

        var chapters = data.chapters || [];
        if (!chapters.length) {
            var empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "还没有章节，点右上角新增";
            list.appendChild(empty);
            return;
        }

        chapters.forEach(function (ch) {
            var item = document.createElement("div");
            item.className = "chapter-item";

            var head2 = document.createElement("div");
            head2.className = "chapter-head";
            var title = document.createElement("span");
            title.className = "chapter-title";
            title.textContent = ch.title;
            var id = document.createElement("span");
            id.className = "chapter-id";
            id.textContent = ch.id;
            head2.appendChild(title);
            head2.appendChild(id);

            var edit = document.createElement("button");
            edit.className = "btn-link";
            edit.type = "button";
            edit.textContent = "编辑";
            edit.addEventListener("click", function () { openChapterEditor(ch); });

            var del = document.createElement("button");
            del.className = "btn-link danger";
            del.type = "button";
            del.textContent = "删除";
            del.addEventListener("click", function () {
                if (!confirm("确定删除章节「" + ch.title + "」吗？")) return;
                api("/api/books/" + encodeURIComponent(state.current.key) + "/chapters/" + encodeURIComponent(ch.id), { method: "DELETE" })
                    .then(function (res) {
                        toast(res.message || "章节已删除");
                        openItem(state.current.key);
                    })
                    .catch(function (e) { toast(e.message, true); });
            });
            head2.appendChild(edit);
            head2.appendChild(del);

            var body = document.createElement("textarea");
            body.className = "chapter-body";
            body.rows = 4;
            body.value = ch.content || "";
            body.placeholder = "章节正文（Markdown）";
            body.addEventListener("input", markDirty);

            item.appendChild(head2);
            item.appendChild(body);
            list.appendChild(item);
        });
    }

    function addChapter() {
        if (!state.current || !state.current.key) return;
        var id = prompt("章节 id（文件名，不带扩展名）", "chapter-1");
        if (!id) return;
        id = id.trim().replace(/\.md$/i, "");
        if (!id) return;

        api("/api/books/" + encodeURIComponent(state.current.key) + "/chapters/" + encodeURIComponent(id), {
            method: "PUT",
            body: JSON.stringify({ title: id, content: "" })
        }).then(function () {
            toast("章节已创建");
            openItem(state.current.key);
        }).catch(function (e) { toast(e.message, true); });
    }

    function openChapterEditor(ch) {
        var body = document.createElement("textarea");
        body.className = "chapter-body";
        body.rows = 18;
        body.value = ch.content || "";

        var box = document.createElement("div");
        box.className = "modal";
        var card = document.createElement("div");
        card.className = "modal-card";
        var head = document.createElement("div");
        head.className = "modal-head";
        var title = document.createElement("strong");
        title.textContent = ch.title;
        head.appendChild(title);
        var close = document.createElement("button");
        close.className = "icon-btn";
        close.type = "button";
        close.textContent = "✕";
        close.addEventListener("click", function () { box.remove(); });
        head.appendChild(close);

        var bodyBox = document.createElement("div");
        bodyBox.className = "modal-body";
        bodyBox.appendChild(body);

        var foot = document.createElement("div");
        foot.className = "modal-foot";
        var save = document.createElement("button");
        save.className = "btn-primary";
        save.type = "button";
        save.textContent = "保存章节";
        save.addEventListener("click", function () {
            api("/api/books/" + encodeURIComponent(state.current.key) + "/chapters/" + encodeURIComponent(ch.id), {
                method: "PUT",
                body: JSON.stringify({ title: ch.title, content: body.value })
            }).then(function (res) {
                toast(res.message || "章节已保存");
                box.remove();
                openItem(state.current.key);
            }).catch(function (e) { toast(e.message, true); });
        });
        foot.appendChild(save);

        card.appendChild(head);
        card.appendChild(bodyBox);
        card.appendChild(foot);
        box.appendChild(card);
        document.body.appendChild(box);
    }

    /* --------------------------------------------------------------- 新建 */

    function startNew() {
        if (state.dirty && !confirm("当前修改还没保存，确定要新建吗？")) return;

        var type = state.mode;
        state.dirty = false;
        $("editorEmpty").hidden = true;
        $("form").hidden = false;
        $("viewLink").hidden = true;

        var today = new Date().toISOString().slice(0, 10);

        $("fTitle").value = "";
        $("fContent").value = "## \n\n";
        $("fDraft").checked = false;
        $("fFeatured").checked = false;

        TYPES[type].fields.forEach(function (f) {
            var el = $(f.id);
            if (!el) return;
            el.value = f.kind === "date" ? today : "";
        });

        state.current = { key: null, type: type, isNew: true };
        state.currentData = null;
        state.collectionItems = [];
        $("saveState").textContent = "新内容，填完点保存";
        $("saveState").classList.remove("is-dirty", "is-error");

        var panel = $("specialPanel");
        panel.replaceChildren();
        panel.hidden = true;

        $("fTitle").focus();
        renderList();
        updatePreview();
    }

    /* --------------------------------------------------------------- 本地草稿 */

    function draftKey(type, key) {
        return "hd-draft:" + type + ":" + (key || "__new__");
    }

    function saveLocalDraft() {
        if (!state.current) return;
        var payload = {
            title: $("fTitle").value,
            content: $("fContent").value,
            fields: {},
            at: Date.now()
        };
        TYPES[state.mode].fields.forEach(function (f) {
            var el = $(f.id);
            if (el) payload.fields[f.id] = el.value;
        });
        try {
            localStorage.setItem(draftKey(state.mode, state.current.key), JSON.stringify(payload));
        } catch (e) { /* 存储满了就算了 */ }
    }

    function readLocalDraft(type, key) {
        try {
            var raw = localStorage.getItem(draftKey(type, key));
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function clearLocalDraft(type, key) {
        try { localStorage.removeItem(draftKey(type, key)); } catch (e) {}
    }

    /** 打开条目后，若本地草稿比仓库里的新，提示恢复 */
    function checkLocalDraft(type, key) {
        var draft = readLocalDraft(type, key);
        if (!draft) return;

        var serverText = $("fContent").value;
        if (draft.content === serverText && draft.title === $("fTitle").value) {
            clearLocalDraft(type, key);
            return;
        }

        var bar = $("draftBar");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "draftBar";
            bar.className = "draft-bar";
            $("form").insertBefore(bar, $("form").firstChild);
        }
        bar.replaceChildren();
        bar.hidden = false;

        var msg = document.createElement("span");
        msg.textContent = "本地有一份更新的草稿（" + timeAgo(draft.at) + "）";
        var restore = document.createElement("button");
        restore.className = "btn-link";
        restore.type = "button";
        restore.textContent = "恢复";
        restore.addEventListener("click", function () {
            $("fTitle").value = draft.title || "";
            $("fContent").value = draft.content || "";
            Object.keys(draft.fields || {}).forEach(function (id) {
                var el = $(id);
                if (el) el.value = draft.fields[id];
            });
            markDirty();
            updatePreview();
            bar.hidden = true;
            toast("已恢复本地草稿");
        });
        var drop = document.createElement("button");
        drop.className = "btn-link";
        drop.type = "button";
        drop.textContent = "丢弃";
        drop.addEventListener("click", function () {
            clearLocalDraft(type, key);
            bar.hidden = true;
        });

        bar.appendChild(msg);
        bar.appendChild(restore);
        bar.appendChild(drop);
    }

    function timeAgo(ts) {
        var diff = Date.now() - ts;
        if (diff < 60e3) return "刚刚";
        if (diff < 3600e3) return Math.floor(diff / 60e3) + " 分钟前";
        if (diff < 86400e3) return Math.floor(diff / 3600e3) + " 小时前";
        return Math.floor(diff / 86400e3) + " 天前";
    }

    /* --------------------------------------------------------------- 保存 */

    async function save(event) {
        if (event) event.preventDefault();

        var btn = $("saveBtn");
        btn.disabled = true;
        setSaveState("保存中…");

        var type = state.mode;
        var title = $("fTitle").value.trim();
        var payload = {
            title: title,
            content: $("fContent").value,
            draft: $("fDraft").checked
        };

        TYPES[type].flags.forEach(function (flag) {
            if (flag === "featured") payload.featured = $("fFeatured").checked;
        });

        TYPES[type].fields.forEach(function (f) {
            var el = $(f.id);
            if (!el) return;
            payload[f.api] = el.value;
        });

        // 合集的成员表不在普通字段里，单独带上，随表单一起保存
        if (type === "series" && payload.type === "collection") {
            payload.items = state.collectionItems || [];
        }

        // 主键字段（slug / name）留空时按标题生成
        var keyField = TYPES[type].key;
        if (!payload[keyField]) {
            var generated = suggestSlug(title);
            payload[keyField] = generated;
            TYPES[type].fields.forEach(function (f) {
                if (f.api === keyField) {
                    var el = $(f.id);
                    if (el) el.value = generated;
                }
            });
        }

        if (!payload.title) {
            btn.disabled = false;
            setSaveState("标题不能为空", "is-error");
            toast("标题不能为空", true);
            $("fTitle").focus();
            return;
        }
        var path;
        var key = state.current ? state.current.key : null;
        if (key) {
            path = TYPES[type].base + "/" + encodeURIComponent(key);
        } else {
            path = TYPES[type].base;
        }

        try {
            var res = await api(path, { method: key ? "PUT" : "POST", body: JSON.stringify(payload) });
            state.dirty = false;
            toast(res.message || "已保存");
            setSaveState(res.path || "已保存", null);

            if (state.current) clearLocalDraft(type, state.current.key);

            await loadList(type, false);
            var newKey = res.key || res.slug || res.date || res.name;
            if (newKey) {
                state.current = { key: newKey, type: type };
                await openItem(newKey);
            }
        } catch (e) {
            toast(e.message, true);
            setSaveState(e.message, "is-error");
        } finally {
            btn.disabled = false;
        }
    }

    function setSaveState(text, cls) {
        var el = $("saveState");
        el.textContent = text || "";
        el.classList.remove("is-dirty", "is-error");
        if (cls) el.classList.add(cls);
    }

    /* --------------------------------------------------------------- 删除 */

    async function remove() {
        if (!state.current || !state.current.key) return;
        var type = state.mode;
        var name = $("fTitle").value || currentKey();

        var warn = type === "posts"
            ? "确定要删除《" + name + "》吗？\n文章目录和随文图片都会被删除，无法从后台撤销。"
            : "确定要删除「" + name + "」吗？无法从后台撤销。";
        if (!confirm(warn)) return;

        try {
            var res = await api(TYPES[type].base + "/" + encodeURIComponent(currentKey()), { method: "DELETE" });
            toast(res.message || "已删除");

            if (state.current) clearLocalDraft(type, state.current.key);
            state.current = null;
            $("form").hidden = true;
            $("editorEmpty").hidden = false;

            await loadList(type, false);
            var first = visibleItems()[0];
            if (first) openItem(keyOf(first));
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* --------------------------------------------------------------- 上传 */

    async function uploadImage(file, scope) {
        if (!file || !/^image\//.test(file.type)) return null;

        var dataUrl = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        var payload = {
            filename: file.name,
            contentType: file.type,
            data: dataUrl,
            scope: scope
        };

        if (scope === "post" || scope === "note") {
            payload.slug = slugGuess();
            payload.date = $("fDate") ? $("fDate").value : "";
        } else if (scope === "flow") {
            payload.date = $("fFlowDate") ? $("fFlowDate").value : "";
        } else if (scope === "book") {
            payload.slug = slugGuess();
        }

        var res = await api("/api/upload", { method: "POST", body: JSON.stringify(payload) });
        return res.url;
    }

    function slugGuess() {
        var el = $("fSlug") || $("fNoteSlug") || $("fSeriesSlug") || $("fBookSlug");
        var typed = el ? el.value.trim() : "";
        if (typed) return typed;
        return suggestSlug($("fTitle").value);
    }

    async function handleImage(file, scope) {
        toast("上传中…");
        try {
            var url = await uploadImage(file, scope);
            if (!url) return;

            if (scope === "cover") {
                $("fCover").value = url;
                markDirty();
            } else {
                insertAtCursor($("fContent"), "\n![" + file.name.replace(/\.[^.]+$/, "") + "](" + url + ")\n");
                updatePreview();
            }
            toast("图片已上传");
        } catch (e) {
            toast(e.message, true);
        }
    }

    function insertAtCursor(area, text) {
        var start = area.selectionStart;
        var end = area.selectionEnd;
        area.value = area.value.slice(0, start) + text + area.value.slice(end);
        area.selectionStart = area.selectionEnd = start + text.length;
        area.focus();
        markDirty();
    }

    /* --------------------------------------------------------------- 图片库 */

    async function openImageLib() {
        $("imageModal").hidden = false;
        var grid = $("imageGrid");
        grid.replaceChildren();
        var loading = document.createElement("p");
        loading.className = "empty";
        loading.textContent = "加载中…";
        grid.appendChild(loading);

        try {
            var data = await api("/api/images");
            grid.replaceChildren();
            if (!data.items || !data.items.length) {
                var none = document.createElement("p");
                none.className = "empty";
                none.textContent = "仓库里还没有图片";
                grid.appendChild(none);
                return;
            }
            data.items.forEach(function (img) {
                var fig = document.createElement("figure");
                fig.className = "img-cell";
                var im = document.createElement("img");
                im.src = img.url;
                im.alt = img.name;
                im.loading = "lazy";
                im.addEventListener("click", function () {
                    insertAtCursor($("fContent"), "\n![" + img.name + "](" + img.url + ")\n");
                    updatePreview();
                    $("imageModal").hidden = true;
                });
                var cap = document.createElement("figcaption");
                cap.textContent = img.name;
                var del = document.createElement("button");
                del.className = "img-del";
                del.type = "button";
                del.textContent = "✕";
                del.title = "删除这张图片";
                del.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (!confirm("确定删除图片 " + img.name + " 吗？")) return;
                    api("/api/images?path=" + encodeURIComponent(img.path), { method: "DELETE" })
                        .then(function () { toast("图片已删除"); openImageLib(); })
                        .catch(function (err) { toast(err.message, true); });
                });
                fig.appendChild(im);
                fig.appendChild(cap);
                fig.appendChild(del);
                grid.appendChild(fig);
            });
        } catch (e) {
            grid.replaceChildren();
            var err = document.createElement("p");
            err.className = "empty";
            err.textContent = e.message;
            grid.appendChild(err);
        }
    }

    /* --------------------------------------------------------------- 版本历史 */

    async function openHistory() {
        if (!state.current || !state.current.key) {
            toast("先打开一篇内容", true);
            return;
        }
        $("historyDrawer").hidden = false;
        var box = $("historyList");
        box.replaceChildren();
        var loading = document.createElement("p");
        loading.className = "empty";
        loading.textContent = "加载中…";
        box.appendChild(loading);

        try {
            var data = await api("/api/history?path=" + encodeURIComponent(state.current.path || "") +
                "&type=" + encodeURIComponent(state.mode) + "&key=" + encodeURIComponent(state.current.key));
            box.replaceChildren();
            if (!data.items || !data.items.length) {
                var none = document.createElement("p");
                none.className = "empty";
                none.textContent = "还没有提交记录";
                box.appendChild(none);
                return;
            }
            data.items.forEach(function (h) {
                var item = document.createElement("div");
                item.className = "hist-item";
                var msg = document.createElement("div");
                msg.className = "hist-msg";
                msg.textContent = h.message;
                var meta = document.createElement("div");
                meta.className = "hist-meta";
                meta.textContent = h.sha.slice(0, 7) + " · " + h.date;
                var actions = document.createElement("div");
                actions.className = "hist-actions";
                var restore = document.createElement("button");
                restore.className = "btn-ghost";
                restore.type = "button";
                restore.textContent = "回滚到这个版本";
                restore.addEventListener("click", function () {
                    if (!confirm("确定把内容回滚到 " + h.sha.slice(0, 7) + " 吗？\n这会新增一次提交，站点随后更新。")) return;
                    api("/api/history", {
                        method: "POST",
                        body: JSON.stringify({ type: state.mode, key: state.current.key, sha: h.sha })
                    }).then(function (res) {
                        toast(res.message || "已回滚");
                        $("historyDrawer").hidden = true;
                        openItem(state.current.key);
                    }).catch(function (err) { toast(err.message, true); });
                });
                actions.appendChild(restore);
                item.appendChild(msg);
                item.appendChild(meta);
                item.appendChild(actions);
                box.appendChild(item);
            });
        } catch (e) {
            box.replaceChildren();
            var err = document.createElement("p");
            err.className = "empty";
            err.textContent = e.message;
            box.appendChild(err);
        }
    }

    /* ---------------------------------------------------- Markdown 预览渲染 */

    var previewTimer;
    function updatePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            $("preview").innerHTML = renderMarkdown($("fContent").value);
            updateStat();
        }, 180);
    }

    function updateStat() {
        var text = $("fContent").value;
        var cjk = (text.match(/[一-龥]/g) || []).length;
        var latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
        var words = cjk + latin;
        var mins = Math.max(1, Math.round(words / 400));
        $("statLine").textContent = words + " 字 · 约 " + mins + " 分钟";
    }

    function esc(str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function inlineText(text) {
        var t = esc(text);
        t = t.replace(/`([^`]+)`/g, function (_, c) { return "<code>" + c + "</code>"; });
        t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, a, u) {
            return '<img src="' + u + '" alt="' + a + '" loading="lazy">';
        });
        t = t.replace(/\[\[([^\]]+)\]\]/g, function (_, a) {
            return '<mark>[[' + a + ']]</mark>';
        });
        t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, a, u) {
            return '<a href="' + u + '" target="_blank" rel="noopener">' + a + "</a>";
        });
        t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        return t;
    }

    /** 轻量 Markdown 渲染器：够用于预览，完全离线，不依赖 CDN */
    function renderMarkdown(src) {
        var lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
        var out = "";
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            var fence = line.match(/^\s*```+\s*(\S*)\s*$/);
            if (fence) {
                var code = [];
                i++;
                while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
                i++;
                out += "<pre><code>" + esc(code.join("\n")) + "</code></pre>";
                continue;
            }

            var h = line.match(/^(#{1,6})\s+(.*)$/);
            if (h) {
                var lv = h[1].length;
                out += "<h" + lv + ">" + inlineText(h[2]) + "</h" + lv + ">";
                i++;
                continue;
            }

            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out += "<hr>"; i++; continue; }

            if (/^\s*>\s?/.test(line)) {
                var quote = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^\s*>\s?/, ""));
                    i++;
                }
                out += "<blockquote>" + renderMarkdown(quote.join("\n")) + "</blockquote>";
                continue;
            }

            if (line.indexOf("|") >= 0 && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
                var rows = [];
                while (i < lines.length && lines[i].indexOf("|") >= 0) { rows.push(lines[i]); i++; }
                out += renderTable(rows);
                continue;
            }

            if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
                var items = [];
                while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
                    items.push(lines[i]);
                    i++;
                }
                out += renderMdList(items);
                continue;
            }

            if (!line.trim()) { i++; continue; }

            var para = [];
            while (i < lines.length && lines[i].trim() &&
                   !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) &&
                   !isTableDivider(lines[i])) {
                para.push(lines[i]);
                i++;
            }
            if (!para.length) { para.push(lines[i]); i++; }
            out += "<p>" + inlineText(para.join("\n")).replace(/\n/g, "<br>") + "</p>";
        }

        return out || '<p style="opacity:.5">（正文还是空的）</p>';
    }

    function isTableDivider(line) {
        return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line || "") && (line || "").indexOf("-") >= 0;
    }

    function splitRow(line) {
        return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
    }

    function renderTable(rows) {
        if (!rows || rows.length < 2) return "";
        var head = splitRow(rows[0]);
        var body = rows.slice(2).map(splitRow);
        var html = "<table><thead><tr>";
        head.forEach(function (c) { html += "<th>" + inlineText(c) + "</th>"; });
        html += "</tr></thead><tbody>";
        body.forEach(function (r) {
            html += "<tr>";
            r.forEach(function (c) { html += "<td>" + inlineText(c) + "</td>"; });
            html += "</tr>";
        });
        return html + "</tbody></table>";
    }

    /** Markdown 列表渲染。注意别和左侧栏的 renderList() 同名，后者会被覆盖 */
    function renderMdList(lines) {
        if (!lines || !lines.length) return "";
        var ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
        var html = ordered ? "<ol>" : "<ul>";
        var open = false;

        lines.forEach(function (line) {
            if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
                if (open) html += "</li>";
                html += "<li>" + inlineText(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
                open = true;
            } else if (open) {
                html += "<br>" + inlineText(line.trim());
            }
        });

        if (open) html += "</li>";
        return html + (ordered ? "</ol>" : "</ul>");
    }

    /* ------------------------------------------------------------- 工具栏动作 */

    function lineBounds(area) {
        var start = area.selectionStart;
        var end = area.selectionEnd;
        var before = area.value.slice(0, start);
        var lineStart = before.lastIndexOf("\n") + 1;
        return { start: start, end: end, lineStart: lineStart, lineEnd: area.value.indexOf("\n", end) === -1 ? area.value.length : area.value.indexOf("\n", end) };
    }

    function wrapSelection(before, after) {
        var area = $("fContent");
        var s = area.selectionStart;
        var e = area.selectionEnd;
        var selected = area.value.slice(s, e);
        area.value = area.value.slice(0, s) + before + selected + after + area.value.slice(e);
        area.selectionStart = s + before.length;
        area.selectionEnd = s + before.length + selected.length;
        area.focus();
        markDirty();
        updatePreview();
    }

    function prefixLines(prefix, numbered) {
        var area = $("fContent");
        var b = lineBounds(area);
        var block = area.value.slice(b.lineStart, b.lineEnd);
        var lines = block.split("\n");
        var out = lines.map(function (ln, idx) {
            if (numbered) return (/^\s*\d+[.)]\s/.test(ln) ? ln : (idx + 1) + ". " + ln);
            return (/^\s*([-*+])\s/.test(ln) ? ln : prefix + ln);
        }).join("\n");
        area.value = area.value.slice(0, b.lineStart) + out + area.value.slice(b.lineEnd);
        area.focus();
        markDirty();
        updatePreview();
    }

    function insertBlock(text) {
        var area = $("fContent");
        var s = area.selectionStart;
        area.value = area.value.slice(0, s) + text + area.value.slice(area.selectionEnd);
        area.selectionStart = area.selectionEnd = s + text.length;
        area.focus();
        markDirty();
        updatePreview();
    }

    var MD_ACTIONS = {
        h2: function () { prefixLines("## ", false); },
        h3: function () { prefixLines("### ", false); },
        bold: function () { wrapSelection("**", "**"); },
        italic: function () { wrapSelection("*", "*"); },
        strike: function () { wrapSelection("~~", "~~"); },
        code: function () { wrapSelection("`", "`"); },
        codeblock: function () { insertBlock("\n```\n\n```\n"); },
        ul: function () { prefixLines("- ", false); },
        ol: function () { prefixLines("", true); },
        quote: function () { prefixLines("> ", false); },
        link: function () { wrapSelection("[", "](https://)"); },
        image: function () { $("coverFile").click(); },
        wikilink: function () { insertBlock("[[]]"); }
    };

    /* ------------------------------------------------------------- 双链补全 */

    var acState = { active: false, items: [], index: 0, start: -1 };

    function detectWikilink(area) {
        var s = area.selectionStart;
        var text = area.value.slice(0, s);
        var open = text.lastIndexOf("[[");
        if (open < 0) return null;
        var close = text.lastIndexOf("]]");
        if (close > open) return null;
        return { start: open, query: text.slice(open + 2) };
    }

    function updateWikilink() {
        var area = $("fContent");
        var hit = detectWikilink(area);
        var popup = $("wikilinkPopup");

        if (!hit) {
            popup.hidden = true;
            acState.active = false;
            return;
        }

        var needle = hit.query.toLowerCase();
        var candidates = Object.keys(state.linkTargets).filter(function (k) {
            var t = state.linkTargets[k];
            return !needle || k.toLowerCase().indexOf(needle) >= 0 || t.title.toLowerCase().indexOf(needle) >= 0;
        }).slice(0, 12);

        acState.items = candidates;
        acState.start = hit.start;
        acState.index = 0;
        acState.active = true;

        popup.replaceChildren();
        if (!candidates.length) {
            var none = document.createElement("div");
            none.className = "ac-empty";
            none.textContent = "没有匹配的条目，双链要按 slug 写";
            popup.appendChild(none);
        } else {
            candidates.forEach(function (k, idx) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ac-item" + (idx === 0 ? " is-active" : "");
                var title = document.createElement("span");
                title.className = "ac-title";
                title.textContent = state.linkTargets[k].title;
                var type = document.createElement("span");
                type.className = "ac-type";
                type.textContent = k;
                btn.appendChild(title);
                btn.appendChild(type);
                btn.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applyWikilink(k);
                });
                popup.appendChild(btn);
            });
        }

        popup.hidden = false;
        placePopup(area);
    }

    function placePopup(area) {
        var popup = $("wikilinkPopup");
        var rect = area.getBoundingClientRect();
        var lineHeight = 20;
        var lines = area.value.slice(0, area.selectionStart).split("\n").length;
        var top = rect.top + Math.min(lines, 20) * lineHeight + 26;
        popup.style.left = Math.min(rect.left + 16, window.innerWidth - 320) + "px";
        popup.style.top = Math.min(top, window.innerHeight - 240) + "px";
    }

    function applyWikilink(slug) {
        var area = $("fContent");
        var s = area.selectionStart;
        var before = area.value.slice(0, acState.start);
        var after = area.value.slice(s);
        var text = "[[" + slug + "]]";
        area.value = before + text + after;
        area.selectionStart = area.selectionEnd = before.length + text.length;
        area.focus();
        $("wikilinkPopup").hidden = true;
        acState.active = false;
        markDirty();
        updatePreview();
    }

    function moveWikilink(delta) {
        if (!acState.active || !acState.items.length) return;
        acState.index = (acState.index + delta + acState.items.length) % acState.items.length;
        var nodes = qsa(".ac-item");
        nodes.forEach(function (n, i) {
            n.classList.toggle("is-active", i === acState.index);
        });
        if (nodes[acState.index]) nodes[acState.index].scrollIntoView({ block: "nearest" });
    }

    /* --------------------------------------------------------------- 工具 */

    var draftTimer;
    function markDirty() {
        state.dirty = true;
        setSaveState("有未保存的修改", "is-dirty");
        clearTimeout(draftTimer);
        draftTimer = setTimeout(function () {
            saveLocalDraft();
            updatePreview();
        }, 500);
    }

    /** 中文标题生成不出 ASCII slug，退化成时间戳 */
    function suggestSlug(title) {
        var base = String(title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60);
        return base || "post-" + Date.now().toString(36);
    }

    /* --------------------------------------------------------------- 绑定 */

    function bind() {
        $("newBtn").addEventListener("click", startNew);
        $("batchBtn").addEventListener("click", toggleBatch);
        $("imageLibBtn").addEventListener("click", openImageLib);
        $("form").addEventListener("submit", save);
        $("deleteBtn").addEventListener("click", remove);
        $("historyBtn").addEventListener("click", openHistory);
        $("historyClose").addEventListener("click", function () { $("historyDrawer").hidden = true; });

        $("moreBtn").addEventListener("click", function () {
            loadList(state.mode, true);
        });

        $("batchCancel").addEventListener("click", toggleBatch);
        $("batchDelete").addEventListener("click", function () { batchAction("delete"); });
        $("batchDraft").addEventListener("click", function () { batchAction("draft"); });

        var filterTimer;
        $("filter").addEventListener("input", function (e) {
            state.filter = e.target.value;
            clearTimeout(filterTimer);
            filterTimer = setTimeout(function () {
                loadList(state.mode, false);
                renderList();
            }, 320);
        });

        $("sort").addEventListener("change", function (e) {
            state.sort = e.target.value;
            loadList(state.mode, false).then(renderList);
        });

        $("schemeBtn").addEventListener("click", function () {
            var next = document.documentElement.dataset.scheme === "dark" ? "light" : "dark";
            document.documentElement.dataset.scheme = next;
            try { localStorage.setItem("hd-scheme", next); } catch (e) {}
            paintSchemeBtn();
        });

        qsa(".seg-btn").forEach(function (b) {
            b.addEventListener("click", function () { setLayout(b.dataset.layout); });
        });

        $("focusBtn").addEventListener("click", toggleFocus);
        $("keysBtn").addEventListener("click", function () { $("keysModal").hidden = false; });
        $("keysClose").addEventListener("click", function () { $("keysModal").hidden = true; });
        $("imageClose").addEventListener("click", function () { $("imageModal").hidden = true; });
        $("navToggle").addEventListener("click", function () {
            document.body.classList.toggle("mobile-list");
            document.body.classList.toggle("mobile-edit");
        });

        // 移动端底栏：列表 / 编辑 / 保存
        qsa(".mb-btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var view = btn.dataset.mobile;
                document.body.classList.remove("mobile-list", "mobile-edit");
                if (view === "list") document.body.classList.add("mobile-list");
                if (view === "edit") document.body.classList.add("mobile-edit");
                if (view === "save") {
                    if (!$("form").hidden) $("form").requestSubmit();
                    return;
                }
                qsa(".mb-btn").forEach(function (b) {
                    b.classList.toggle("is-on", b.dataset.mobile === view);
                });
            });
        });

        $("fDraft").addEventListener("change", markDirty);
        $("fFeatured").addEventListener("change", markDirty);

        // 工具栏
        qsa(".tb-btn[data-md]").forEach(function (btn) {
            btn.addEventListener("mousedown", function (e) {
                e.preventDefault(); // 别抢 textarea 的焦点
                var fn = MD_ACTIONS[btn.dataset.md];
                if (fn) fn();
            });
        });
        $("clearMd").addEventListener("mousedown", function (e) {
            e.preventDefault();
            if (!confirm("确定清空正文吗？")) return;
            $("fContent").value = "";
            markDirty();
            updatePreview();
        });

        // 正文：粘贴图片 / 拖拽图片 / 双链补全
        $("fContent").addEventListener("paste", function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (items) {
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf("image/") === 0) {
                        var file = items[i].getAsFile();
                        if (file) {
                            e.preventDefault();
                            handleImage(file, "body");
                            return;
                        }
                    }
                }
            }
        });

        var area = $("fContent");
        ["dragenter", "dragover"].forEach(function (evt) {
            area.addEventListener(evt, function (e) { e.preventDefault(); });
        });
        area.addEventListener("drop", function (e) {
            e.preventDefault();
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files[0]) handleImage(files[0], "body");
        });
        area.addEventListener("input", function () {
            markDirty();
            updateWikilink();
        });
        area.addEventListener("keydown", function (e) {
            if (acState.active) {
                if (e.key === "ArrowDown") { e.preventDefault(); moveWikilink(1); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); moveWikilink(-1); return; }
                if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    if (acState.items[acState.index]) applyWikilink(acState.items[acState.index]);
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    $("wikilinkPopup").hidden = true;
                    acState.active = false;
                    return;
                }
            }
        });
        area.addEventListener("blur", function () {
            setTimeout(function () { $("wikilinkPopup").hidden = true; }, 150);
        });

        // 封面文件选择
        $("coverFile").addEventListener("change", function (e) {
            var file = e.target.files && e.target.files[0];
            if (file) handleImage(file, "cover");
            e.target.value = "";
        });

        window.addEventListener("beforeunload", function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = "";
        });

        // 快捷键
        document.addEventListener("keydown", function (e) {
            var mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (!$("form").hidden) $("form").requestSubmit();
                return;
            }
            if (mod && e.key.toLowerCase() === "n") {
                e.preventDefault();
                startNew();
                return;
            }
            if (mod && e.key.toLowerCase() === "f") {
                e.preventDefault();
                $("filter").focus();
                $("filter").select();
                return;
            }
            if (mod && e.key === "\\") {
                e.preventDefault();
                setLayout(document.documentElement.dataset.layout === "split" ? "edit" : "split");
                return;
            }
            if (mod && e.key.toLowerCase() === "b" && e.target === $("fContent")) {
                e.preventDefault();
                MD_ACTIONS.bold();
                return;
            }
            if (mod && e.key.toLowerCase() === "i" && e.target === $("fContent")) {
                e.preventDefault();
                MD_ACTIONS.italic();
                return;
            }
            if (mod && e.key.toLowerCase() === "k") {
                e.preventDefault();
                MD_ACTIONS.link();
                return;
            }
            if (e.key === "Escape") {
                if (!$("keysModal").hidden) { $("keysModal").hidden = true; return; }
                if (!$("imageModal").hidden) { $("imageModal").hidden = true; return; }
                if (!$("historyDrawer").hidden) { $("historyDrawer").hidden = true; return; }
                if (state.batch) { toggleBatch(); return; }
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (document.activeElement === $("fContent") || document.activeElement === $("filter")) return;
                if (state.batch) return;
                var items = visibleItems();
                if (!items.length) return;
                var idx = items.findIndex(function (it) { return keyOf(it) === currentKey(); });
                var next = e.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
                if (items[next]) {
                    e.preventDefault();
                    openItem(keyOf(items[next]));
                }
            }
        });
    }

    bind();
    boot();
})();
