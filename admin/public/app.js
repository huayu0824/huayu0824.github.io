/* ==========================================================================
   博客后台前端逻辑
   ========================================================================== */
(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };

    var state = {
        session: null,
        posts: [],
        current: null,     // 当前打开的 slug
        dirty: false,
        filter: ""
    };

    /* --------------------------------------------------------------- 网络 */

    async function api(path, options) {
        var res = await fetch(path, Object.assign({
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin"
        }, options || {}));

        var data = null;
        try { data = await res.json(); } catch (e) { /* 空响应 */ }

        if (res.status === 401) {
            showGate("登录已过期，请重新登录");
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
        el._timer = setTimeout(function () { el.hidden = true; }, isError ? 5000 : 2600);
    }

    /* ---------------------------------------------------------------- 启动 */

    async function boot() {
        try {
            state.session = await api("/api/session");
        } catch (e) {
            return; // showGate 已在 api 内部处理
        }

        $("gate").hidden = true;
        $("app").hidden = false;

        $("who").textContent = state.session.name || state.session.login;
        $("avatar").src = state.session.avatar || "";
        $("repoInfo").textContent = state.session.repo + " @ " + state.session.branch;
        $("siteLink").href = "/" ;

        await loadList();
        if (state.posts.length) openPost(state.posts[0].slug);
    }

    function showGate(hint) {
        $("app").hidden = true;
        $("gate").hidden = false;
        if (hint) $("gateHint").textContent = hint;
    }

    /* -------------------------------------------------------------- 文章列表 */

    async function loadList() {
        try {
            var data = await api("/api/posts");
            state.posts = data.posts || [];
            renderList();
        } catch (e) {
            toast(e.message, true);
        }
    }

    function renderList() {
        var list = $("list");
        list.replaceChildren();

        var needle = state.filter.trim().toLowerCase();
        var visible = state.posts.filter(function (p) {
            if (!needle) return true;
            var hay = [p.title, p.slug, (p.tags || []).join(" "), (p.categories || []).join(" ")]
                .join(" ").toLowerCase();
            return hay.indexOf(needle) >= 0;
        });

        $("listEmpty").hidden = visible.length > 0;

        visible.forEach(function (p) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "item" + (p.slug === state.current ? " is-active" : "");
            btn.dataset.slug = p.slug;

            var title = document.createElement("span");
            title.className = "item-title";
            title.textContent = p.title;

            var meta = document.createElement("span");
            meta.className = "item-meta";

            var date = document.createElement("span");
            date.textContent = p.date || "无日期";
            meta.appendChild(date);

            if (p.draft) {
                var draft = document.createElement("span");
                draft.className = "item-tag";
                draft.textContent = "草稿";
                meta.appendChild(draft);
            }

            (p.tags || []).slice(0, 2).forEach(function (t) {
                var tag = document.createElement("span");
                tag.className = "item-tag";
                tag.textContent = "#" + t;
                meta.appendChild(tag);
            });

            btn.appendChild(title);
            btn.appendChild(meta);
            btn.addEventListener("click", function () { openPost(p.slug); });
            list.appendChild(btn);
        });
    }

    /* -------------------------------------------------------------- 打开文章 */

    async function openPost(slug) {
        if (state.dirty && !confirm("当前修改还没保存，确定要切换吗？")) return;

        try {
            var post = await api("/api/posts/" + encodeURIComponent(slug));
            state.current = slug;
            state.dirty = false;

            $("editorEmpty").hidden = true;
            $("form").hidden = false;

            $("fTitle").value = post.title || "";
            $("fSlug").value = slug;
            $("fDate").value = toDateInput(post.date);
            $("fDraft").checked = post.draft === true;
            $("fCategories").value = (post.categories || []).join(", ");
            $("fTags").value = (post.tags || []).join(", ");
            $("fDescription").value = post.description || "";
            $("fImage").value = post.image || "";
            $("fContent").value = post.content || "";

            $("saveState").textContent = "上次修改：" + (post.sha ? post.sha.slice(0, 7) : "-");
            $("viewLink").href = siteUrlFor(post);
            $("viewLink").hidden = false;

            renderList();
            updatePreview();
        } catch (e) {
            toast(e.message, true);
        }
    }

    function startNew() {
        if (state.dirty && !confirm("当前修改还没保存，确定要新建吗？")) return;

        state.current = null;
        state.dirty = false;

        $("editorEmpty").hidden = true;
        $("form").hidden = false;
        $("viewLink").hidden = true;

        $("fTitle").value = "";
        $("fSlug").value = suggestSlug("新文章");
        $("fDate").value = toDateInput(new Date().toISOString());
        $("fDraft").checked = false;
        $("fCategories").value = "";
        $("fTags").value = "";
        $("fDescription").value = "";
        $("fImage").value = "";
        $("fContent").value = "## \n\n";

        $("saveState").textContent = "新文章，填完点保存";
        $("fTitle").focus();

        renderList();
        updatePreview();
    }

    /* ---------------------------------------------------------------- 保存 */

    async function save(event) {
        event.preventDefault();

        var btn = $("saveBtn");
        btn.disabled = true;

        var title = $("fTitle").value.trim();
        if (!title) {
            toast("请先填标题", true);
            btn.disabled = false;
            return;
        }

        var slug = ($("fSlug").value || "").trim() || suggestSlug(title);
        var payload = {
            title: title,
            date: $("fDate").value,
            draft: $("fDraft").checked,
            categories: $("fCategories").value,
            tags: $("fTags").value,
            description: $("fDescription").value,
            image: $("fImage").value,
            content: $("fContent").value
        };

        try {
            var res = await api("/api/posts/" + encodeURIComponent(slug), {
                method: "PUT",
                body: JSON.stringify(payload)
            });

            state.dirty = false;
            toast(res.message);

            var wasNew = res.created;
            await loadList();
            await openPost(res.slug);

            if (wasNew) toast("已创建：" + res.message);
        } catch (e) {
            toast(e.message, true);
        } finally {
            btn.disabled = false;
        }
    }

    async function remove() {
        if (!state.current) return;
        if (!confirm("确定要删除《" + $("fTitle").value + "》吗？\n删除后站点会自动重新部署，且无法从后台撤销。")) return;

        try {
            var res = await api("/api/posts/" + encodeURIComponent(state.current), { method: "DELETE" });
            toast(res.message);
            state.current = null;
            $("form").hidden = true;
            $("editorEmpty").hidden = false;
            await loadList();
            if (state.posts.length) openPost(state.posts[0].slug);
        } catch (e) {
            toast(e.message, true);
        }
    }

    /* ---------------------------------------------------------------- 上传 */

    async function uploadImage(file) {
        if (!file || !/^image\//.test(file.type)) return null;

        var dataUrl = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        var res = await api("/api/upload", {
            method: "POST",
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type,
                data: dataUrl
            })
        });
        return res.url;
    }

    async function handlePickedImage(file, insertTarget) {
        toast("上传中…");
        try {
            var url = await uploadImage(file);
            if (!url) return;

            if (insertTarget === "cover") {
                $("fImage").value = url;
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

    /* ------------------------------------------------------ Markdown 预览 */

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

    function inline(text) {
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

    /**
     * 轻量 Markdown 渲染器：够用于预览，且完全离线。
     * 只覆盖 Hugo/Goldmark 常用语法，不追求 100% 一致。
     */
    function renderMarkdown(src) {
        var lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
        var out = "";
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            // 围栏代码块
            var fence = line.match(/^\s*```+\s*(\S*)\s*$/);
            if (fence) {
                var code = [];
                i++;
                while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
                i++;
                out += "<pre><code>" + esc(code.join("\n")) + "</code></pre>";
                continue;
            }

            // 标题
            var h = line.match(/^(#{1,6})\s+(.*)$/);
            if (h) {
                var lv = h[1].length;
                out += "<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">";
                i++;
                continue;
            }

            // 分隔线
            if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out += "<hr>"; i++; continue; }

            // 引用
            if (/^\s*>\s?/.test(line)) {
                var quote = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^\s*>\s?/, ""));
                    i++;
                }
                out += "<blockquote>" + renderMarkdown(quote.join("\n")) + "</blockquote>";
                continue;
            }

            // 表格
            if (line.indexOf("|") >= 0 && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
                var rows = [];
                while (i < lines.length && lines[i].indexOf("|") >= 0) { rows.push(lines[i]); i++; }
                out += renderTable(rows);
                continue;
            }

            // 列表
            if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
                var items = [];
                while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
                    items.push(lines[i]);
                    i++;
                }
                out += renderList(items);
                continue;
            }

            if (!line.trim()) { i++; continue; }

            // 段落
            var para = [];
            while (i < lines.length && lines[i].trim() &&
                   !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) &&
                   !isTableDivider(lines[i])) {
                para.push(lines[i]);
                i++;
            }
            if (!para.length) { para.push(lines[i]); i++; } // 兜底，防止死循环
            out += "<p>" + inline(para.join("\n")).replace(/\n/g, "<br>") + "</p>";
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
        var head = splitRow(rows[0]);
        var body = rows.slice(2).map(splitRow);

        var html = "<table><thead><tr>";
        head.forEach(function (c) { html += "<th>" + inline(c) + "</th>"; });
        html += "</tr></thead><tbody>";
        body.forEach(function (r) {
            html += "<tr>";
            r.forEach(function (c) { html += "<td>" + inline(c) + "</td>"; });
            html += "</tr>";
        });
        return html + "</tbody></table>";
    }

    function renderList(lines) {
        var ordered = /^\s*\d+[.)]\s+/.test(lines[0]);
        var html = ordered ? "<ol>" : "<ul>";
        var open = false;

        lines.forEach(function (line) {
            if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
                if (open) html += "</li>";
                html += "<li>" + inline(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
                open = true;
            } else if (open) {
                html += "<br>" + inline(line.trim());
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

    function toDateInput(value) {
        if (!value) return "";
        var s = String(value);
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
    }

    function suggestSlug(title) {
        var base = String(title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60);
        if (base) return base;
        return "post-" + Date.now().toString(36);
    }

    function siteUrlFor(post) {
        var permalink = post.permalink || "";
        if (permalink) return permalink;
        return "/p/" + encodeURIComponent(state.current || "") + "/";
    }

    /* ---------------------------------------------------------------- 绑定 */

    function bind() {
        $("newBtn").addEventListener("click", startNew);
        $("form").addEventListener("submit", save);
        $("deleteBtn").addEventListener("click", remove);

        $("filter").addEventListener("input", function (e) {
            state.filter = e.target.value;
            renderList();
        });

        ["fTitle", "fSlug", "fDate", "fCategories", "fTags", "fDescription", "fImage", "fContent"]
            .forEach(function (id) {
                $(id).addEventListener("input", function () {
                    markDirty();
                    if (id === "fContent") updatePreview();
                });
            });

        $("fDraft").addEventListener("change", markDirty);

        // 预览/编辑切换
        $("previewToggle").addEventListener("click", function () {
            var main = document.querySelector(".editor-main");
            var isPreview = main.classList.toggle("is-preview-only");
            main.classList.toggle("is-edit-only", false);
            $("previewToggle").textContent = isPreview ? "编辑优先" : "预览优先";
            if (isPreview) updatePreview();
        });

        // 封面图上传
        $("coverPick").addEventListener("click", function () { $("coverFile").click(); });
        $("coverFile").addEventListener("change", function (e) {
            var file = e.target.files && e.target.files[0];
            if (file) handlePickedImage(file, "cover");
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
                        handlePickedImage(file, "content");
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
            if (files && files[0]) handlePickedImage(files[0], "content");
        });

        // 离开页面前提醒未保存
        window.addEventListener("beforeunload", function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = "";
        });

        // Cmd/Ctrl + S 保存
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
