/* ==========================================================================
   Flow 页面交互：日历与滚动定位
   纯原生 JS，无依赖。文章日期索引由 Hugo 以 JSON 内联在 #flow-index 中。
   ========================================================================== */
(function () {
    "use strict";

    var indexNode = document.getElementById("flow-index");
    if (!indexNode) return;

    var DATA = { days: [], total: 0 };
    try {
        var parsed = JSON.parse(indexNode.textContent);
        // Hugo 可能把它包成一层 JSON 字符串，这里做一次兼容
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
        // 兼容直接给出日期数组的老格式
        if (Array.isArray(parsed)) parsed = { days: parsed };
        if (parsed && Array.isArray(parsed.days)) DATA = parsed;
    } catch (err) {
        console.error("[flow] 无法解析文章索引", err);
    }

    var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS_EN = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    var postDays = Object.create(null);
    DATA.days.forEach(function (d) { postDays[d] = true; });

    /* ---------------------------------------------------------- 日期小工具 */

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    function ymd(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function parseYmd(s) {
        var p = s.split("-");
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }

    /* -------------------------------------------------------------- 日历 */

    var calDays = document.getElementById("flow-cal-days");
    if (!calDays) return;

    var calLabel = document.getElementById("flow-cal-label");
    var calPrev = document.getElementById("flow-cal-prev");
    var calNext = document.getElementById("flow-cal-next");
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // 初始月份：有文章的最新月份，没有则用当前月
    var view = DATA.days.length ? parseYmd(DATA.days[0]) : new Date();
    view.setDate(1);

    function renderCalendar() {
        var year = view.getFullYear();
        var month = view.getMonth();

        if (calLabel) {
            calLabel.textContent = MONTHS_EN[month] + " " + year;
        }

        var first = new Date(year, month, 1);
        var offset = first.getDay();          // 周日为一周起点，与表头 Sun..Sat 对齐
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var prevDays = new Date(year, month, 0).getDate();

        var frag = document.createDocumentFragment();

        for (var i = 0; i < 42; i++) {
            var dayNum, cellDate, outside = false;

            if (i < offset) {
                dayNum = prevDays - offset + 1 + i;
                cellDate = new Date(year, month - 1, dayNum);
                outside = true;
            } else if (i < offset + daysInMonth) {
                dayNum = i - offset + 1;
                cellDate = new Date(year, month, dayNum);
            } else {
                dayNum = i - offset - daysInMonth + 1;
                cellDate = new Date(year, month + 1, dayNum);
                outside = true;
            }

            var cell = document.createElement("button");
            cell.type = "button";
            cell.className = "flow-cal-day" + (outside ? " is-outside" : "");
            cell.textContent = String(dayNum);

            if (cellDate.getTime() === today.getTime()) {
                cell.classList.add("is-today");
            }

            var key = ymd(cellDate);
            if (postDays[key]) {
                cell.classList.add("has-post");
                var dot = document.createElement("i");
                cell.appendChild(dot);
                cell.setAttribute("aria-label", key + " 有文章");
                (function (target) {
                    cell.addEventListener("click", function () { focusEntry(target); });
                })(key);
            } else {
                cell.disabled = true;
            }

            frag.appendChild(cell);
        }

        calDays.replaceChildren(frag);
    }

    function shiftMonth(delta) {
        view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
        renderCalendar();
    }

    if (calPrev) calPrev.addEventListener("click", function () { shiftMonth(-1); });
    if (calNext) calNext.addEventListener("click", function () { shiftMonth(1); });

    renderCalendar();

    /* ------------------------------------------------- 点击日历跳到对应文章 */

    function focusEntry(key) {
        var el = document.getElementById("d-" + key);
        if (!el) return;

        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("is-flash");
        setTimeout(function () { el.classList.remove("is-flash"); }, 1800);
    }

    var browse = document.getElementById("flow-browse");
    if (browse) {
        browse.addEventListener("click", function (e) {
            e.preventDefault();
            var first = document.querySelector(".flow-month");
            if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    /* ------------------------------------------ 滚动：激活月份 + 进度指示点 */

    var monthSections = Array.prototype.slice.call(document.querySelectorAll(".flow-month"));
    var progress = document.getElementById("flow-progress");
    var toTopVisibleAt = 600;

    function onScroll() {
        var probe = window.scrollY + 160;
        var activeIndex = 0;

        for (var i = 0; i < monthSections.length; i++) {
            if (monthSections[i].offsetTop <= probe) activeIndex = i;
        }

        // 滚到底部时强制高亮最后一个分组，否则末组永远无法激活
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 8) {
            activeIndex = monthSections.length - 1;
        }

        for (var j = 0; j < monthSections.length; j++) {
            monthSections[j].classList.toggle("is-active", j === activeIndex);
        }

        if (progress && monthSections[activeIndex]) {
            var offset = monthSections[activeIndex].offsetTop - 14;
            progress.style.top = Math.max(0, offset) + "px";
        }

        if (toTop) {
            toTop.classList.toggle("is-visible", window.scrollY > toTopVisibleAt);
        }
    }

    var ticking = false;
    window.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
            onScroll();
            ticking = false;
        });
    }, { passive: true });

    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();

    /* -------------------------------------------------- 长正文折叠 / 展开 */

    var entries = Array.prototype.slice.call(document.querySelectorAll(".flow-entry[data-clamp]"));
    if (!entries.length) return;

    function applyClamp(entry) {
        var clamp = Number(entry.dataset.clamp);
        var content = entry.querySelector(".sd-prose");
        var btn = entry.querySelector(".flow-expand");
        if (!content) return;

        if (!(clamp > 0)) {
            entry.classList.remove("is-clamped");
            if (btn) btn.hidden = true;
            return;
        }

        entry.style.setProperty("--flow-clamp", clamp + "px");

        // 折叠状态下 max-height 会截断内容，需先解除再测量真实高度
        entry.classList.remove("is-clamped");
        if (content.scrollHeight <= clamp + 8) {
            if (btn) btn.hidden = true;
            return;
        }

        entry.classList.add("is-clamped");
        if (!btn) return;
        btn.hidden = false;
        btn.classList.remove("is-open");
        btn.firstChild.nodeValue = "展开全文";
    }

    entries.forEach(function (entry) {
        var btn = entry.querySelector(".flow-expand");
        if (!btn) return;
        btn.addEventListener("click", function () {
            var open = entry.classList.toggle("is-clamped") === false;
            btn.classList.toggle("is-open", open);
            btn.firstChild.nodeValue = open ? "收起" : "展开全文";
        });
    });

    function refreshClamps() {
        entries.forEach(function (entry) {
            if (entry.classList.contains("is-clamped")) return; // 用户已展开的条目不打断
            applyClamp(entry);
        });
    }

    entries.forEach(applyClamp);

    var clampTimer;
    window.addEventListener("resize", function () {
        clearTimeout(clampTimer);
        clampTimer = setTimeout(refreshClamps, 180);
    }, { passive: true });

    // 图片解码完成后高度会变，等 load 再校准一次
    window.addEventListener("load", refreshClamps);
})();
