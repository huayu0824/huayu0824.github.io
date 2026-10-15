/* ==========================================================================
   博客后台前端逻辑
   两种内容：文章（/api/posts）与随笔（/api/flows），字段各自适配
   ========================================================================== */
(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };
    var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    var state = {
        session: null,
        mode: "posts",        // posts | flows
        posts: { items: [], total: 0, loaded: 40 },
        flows: { items: [], total: 0, loaded: 40 },
        current: null,        // { slug } 或 { date }
        dirty: false,
        filter: "",
        booted: false         // 是否已成功登录过，用于区分「首次访问」和「登录过期」
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
        try { data = await res.json(); } catch (e) { /* 空响应 */ }

        if (res.status === 401) {
            // 首次访问本来就没登录，不该说「已过期」
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

        paintSchemeBtn();
        await loadList();
        var first = visibleItems()[0];
        if (first) openItem(keyOf(first));
    }

    function showGate(hint) {
        $("app").hidden = true;
        $("gate").hidden = false;
        if (hint) $("gateHint").textContent = hint;
    }

    /* --------------------------------------------------------------- 明暗 */

    function paintSchemeBtn() {
        var btn = $("schemeBtn");
        btn.innerHTML = document.documentElement.dataset.scheme === "dark" ? SUN_ICON : MOON_ICON;
        btn.setAttribute("aria-label",
            document.documentElement.dataset.scheme === "dark" ? "切换到浅色" : "切换到深色");
    }

    /* --------------------------------------------------------------- 列表 */

    function store() {
        return state.mode === "posts" ? state.posts : state.flows;
    }

    function keyOf(item) {
        return state.mode === "posts" ? item.slug : item.date;
    }

    function currentKey() {
        return state.current ? (state.mode === "posts" ? state.current.slug : state.current.date) : null;
    }

    async function loadList(append) {
        if (!append) store().loaded = 40;

        try {
            var base = state.mode === "posts" ? "/api/posts" : "/api/flows";
            var data = await api(base + "?limit=40&offset=" + store().loaded);
            var box = store();
            box.items = append ? box.items.concat(data.items) : data.items;
            box.total = data.total;
            renderList();
        } catch (e) {
            toast(e.message, true);
        }
    }

    function visibleItems() {
        var needle = state.filter.trim().toLowerCase();
        return store().items.filter(function (item) {
            if (!needle) return true;
            var hay = [
                item.title || "",
                item.slug || "",
                item.date || "",
                (item.tags || []).join(" "),
                item.category || ""
            ].join(" ").toLowerCase();
            return hay.indexOf(needle) >= 0;
        });
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

            var title = document.createElement("span");
            title.className = "item-title";
            title.textContent = item.title || "(无标题)";

            var meta = document.createElement("span");
            meta.className = "item-meta";

            var date = document.createElement("span");
            date.textContent = item.date || "";
            meta.appendChild(date);

            if (item.draft) meta.appendChild(badge("草稿"));
            if (item.featured) meta.appendChild(badge("精选"));

            (item.tags || []).slice(0, 2).forEach(function (t) {
                meta.appendChild(badge("#" + t));
            });

            btn.appendChild(title);
            btn.appendChild(meta);
            btn.addEventListener("click", function () { openItem(key); });
            list.appendChild(btn);
        });
    }

    function badge(text) {
        var span = document.createElement("span");
        span.className = "item-tag";
        span.textContent = text;
        return span;
    }

    /* ------------------------------------------------------------ 模式切换 */

    function setMode(mode) {
        if (state.mode === mode) return;
        if (state.dirty && !confirm("当前修改还没保存，确定要切换吗？")) return;

        state.mode = mode;
        state.current = null;

        qsa(".tab").forEach(function (t) {
            t.classList.toggle("is-active", t.dataset.mode === mode);
        });
        qsa("[data-only]").forEach(function (el) {
            el.hidden = el.dataset.only !== mode;
        });

        $("newBtn").textContent = mode === "posts" ? "＋ 新建文章" : "＋ 写今天的随笔";
        $("form").hidden = true;
        $("editorEmpty").hidden = false;
        $("editorMain").classList.remove("is-preview-only");

        renderList();
        var first = visibleItems()[0];
        if (first) openItem(keyOf(first));
    }

    /* ------------------------------------------------------------ 打开条目 */

    async function openItem(key) {
        if (state.dirty && !confirm("当前修改还没保存，确定要切换吗？")) return;

        try {
            var isPost = state.mode === "posts";
            var data = isPost
                ? await api("/api/posts/" + encodeURIComponent(key))
                : await api("/api/flows/" + encodeURIComponent(key));

            state.current = isPost ? { slug: data.slug } : { date: data.date };
            state.dirty = false;

            $("editorEmpty").hidden = true;
            $("form").hidden = false;

            $("fTitle").value = data.title || "";
            $("fTags").value = (data.tags || []).join(", ");
            $("fContent").value = data.content || "";
            $("fDraft").checked = data.draft === true;

            if (isPost) {
                $("fSlug").value = data.slug || "";
                $("fDate").value = data.date || "";
                $("fCategory").value = data.category || "";
                $("fExcerpt").value = data.excerpt || "";
                $("fCover").value = data.coverImage || "";
                $("fRedirect").value = (data.redirectFrom || []).join(", ");
                $("fFeatured").checked = data.featured === true;
                $("viewLink").href = "/posts/" + encodeURIComponent(data.slug) + "/";
            } else {
                $("fFlowDate").value = data.date || "";
                $("viewLink").href = "/flows/" + data.date.replace(/-/g, "/") + "/";
            }

            $("viewLink").hidden = false;
            $("saveState").textContent = isPost
                ? "/posts/" + data.slug + "/"
                : data.folder ? "文件夹形式（可带图）" : "单文件形式";

            renderList();
            updatePreview();
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* ---------------------------------------------------------------- 新建 */

    function startNew() {
        if (state.dirty && !confirm("当前修改还没保存，确定要新建吗？")) return;

        state.dirty = false;
        $("editorEmpty").hidden = true;
        $("form").hidden = false;
        $("viewLink").hidden = true;

        var today = new Date().toISOString().slice(0, 10);

        $("fTitle").value = "";
        $("fContent").value = "## \n\n";
        $("fTags").value = "";
        $("fDraft").checked = false;
        $("fFeatured").checked = false;
        $("fExcerpt").value = "";
        $("fCover").value = "";
        $("fRedirect").value = "";

        if (state.mode === "posts") {
            state.current = null;
            $("fSlug").value = "";
            $("fDate").value = today;
            $("fCategory").value = "";
            $("saveState").textContent = "新文章，填完点保存（slug 留空会自动生成）";
            $("fTitle").focus();
        } else {
            state.current = { date: today };
            $("fFlowDate").value = today;
            $("saveState").textContent = "今天的随笔，写完点保存";
            $("fContent").focus();
        }

        renderList();
        updatePreview();
    }

    /* ---------------------------------------------------------------- 保存 */

    async function save(event) {
        event.preventDefault();

        var btn = $("saveBtn");
        btn.disabled = true;

        var title = $("fTitle").value.trim();
        var body = $("fContent").value;
        var isPost = state.mode === "posts";

        var payload = {
            title: title,
            tags: $("fTags").value,
            draft: $("fDraft").checked,
            content: body
        };

        var path;

        if (isPost) {
            var slug = ($("fSlug").value || "").trim() || suggestSlug(title);
            var date = $("fDate").value;
            payload.slug = slug;
            payload.date = date;
            payload.category = $("fCategory").value;
            payload.excerpt = $("fExcerpt").value;
            payload.coverImage = $("fCover").value;
            payload.featured = $("fFeatured").checked;
            payload.redirectFrom = $("fRedirect").value;
            path = "/api/posts/" + encodeURIComponent(slug);
        } else {
            var fdate = $("fFlowDate").value || new Date().toISOString().slice(0, 10);
            payload.date = fdate;
            path = "/api/flows/" + encodeURIComponent(fdate);
        }

        try {
            var res = await api(path, { method: "PUT", body: JSON.stringify(payload) });
            state.dirty = false;
            toast(res.message);

            await loadList(false);
            await openItem(isPost ? res.slug : res.date);
        } catch (e) {
            toast(e.message, true);
        } finally {
            btn.disabled = false;
        }
    }

    /* ---------------------------------------------------------------- 删除 */

    async function remove() {
        if (!state.current) return;
        var isPost = state.mode === "posts";
        var name = $("fTitle").value || currentKey();

        var warn = isPost
            ? "确定要删除《" + name + "》吗？\n文章目录和随文图片都会被删除，无法从后台撤销。"
            : "确定要删除 " + name + " 的随笔吗？无法从后台撤销。";
        if (!confirm(warn)) return;

        var path = isPost
            ? "/api/posts/" + encodeURIComponent(currentKey())
            : "/api/flows/" + encodeURIComponent(currentKey());

        try {
            var res = await api(path, { method: "DELETE" });
            toast(res.message);

            state.current = null;
            $("form").hidden = true;
            $("editorEmpty").hidden = false;

            await loadList(false);
            var first = visibleItems()[0];
            if (first) openItem(keyOf(first));
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* ---------------------------------------------------------------- 上传 */

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

        if (scope === "post") {
            payload.slug = ($("fSlug").value || "").trim() || suggestSlug($("fTitle").value);
            payload.date = $("fDate").value;
        } else if (scope === "flow") {
            payload.date = $("fFlowDate").value;
        }

        var res = await api("/api/upload", { method: "POST", body: JSON.stringify(payload) });
        return res.url;
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

    /* ---------------------------------------------------- Markdown 预览渲染 */

    var previewTimer;
    function updatePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            $("preview").innerHTML = renderMarkdown($("fContent").value);
        }, 180);
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

    /* ---------------------------------------------------------------- 工具 */

    function markDirty() {
        state.dirty = true;
        $("saveState").textContent = "有未保存的修改";
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

    /* ---------------------------------------------------------------- 绑定 */

    function bind() {
        qsa(".tab").forEach(function (t) {
            t.addEventListener("click", function () { setMode(t.dataset.mode); });
        });

        $("newBtn").addEventListener("click", startNew);
        $("form").addEventListener("submit", save);
        $("deleteBtn").addEventListener("click", remove);
        $("moreBtn").addEventListener("click", function () {
            store().loaded += 40;
            loadList(true);
        });

        $("filter").addEventListener("input", function (e) {
            state.filter = e.target.value;
            renderList();
        });

        $("schemeBtn").addEventListener("click", function () {
            var next = document.documentElement.dataset.scheme === "dark" ? "light" : "dark";
            document.documentElement.dataset.scheme = next;
            try { localStorage.setItem("hd-scheme", next); } catch (e) {}
            paintSchemeBtn();
        });

        ["fTitle", "fSlug", "fDate", "fFlowDate", "fCategory", "fTags",
            "fExcerpt", "fCover", "fRedirect", "fContent"].forEach(function (id) {
            $(id).addEventListener("input", function () {
                markDirty();
                if (id === "fContent") updatePreview();
            });
        });

        $("fDraft").addEventListener("change", markDirty);
        $("fFeatured").addEventListener("change", markDirty);

        $("previewToggle").addEventListener("click", function () {
            var main = $("editorMain");
            var on = main.classList.toggle("is-preview-only");
            this.textContent = on ? "编辑优先" : "预览优先";
            if (on) updatePreview();
        });

        $("coverPick").addEventListener("click", function () { $("coverFile").click(); });
        $("coverFile").addEventListener("change", function (e) {
            var file = e.target.files && e.target.files[0];
            if (file) handleImage(file, "cover");
            e.target.value = "";
        });

        // 正文粘贴图片
        $("fContent").addEventListener("paste", function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
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
        });

        // 正文拖拽图片
        var area = $("fContent");
        ["dragenter", "dragover"].forEach(function (evt) {
            area.addEventListener(evt, function (e) { e.preventDefault(); });
        });
        area.addEventListener("drop", function (e) {
            e.preventDefault();
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files[0]) handleImage(files[0], "body");
        });

        window.addEventListener("beforeunload", function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = "";
        });

        document.addEventListener("keydown", function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (!$("form").hidden) $("form").requestSubmit();
            }
        });
    }

    bind();
    boot();
})();
