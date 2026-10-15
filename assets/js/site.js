/* ==========================================================================
   全站通用交互：明暗切换、返回顶部、外链处理、代码复制
   纯原生 JS，无依赖。所有页面共用。
   ========================================================================== */
(function () {
    "use strict";

    /* ------------------------------------------------------------ 明暗切换 */

    var SCHEME_KEY = "StackColorScheme"; // 与 Stack 主题共用同一个键，切换状态保持一致

    var SUN_ICON =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"></circle>' +
        '<path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"></path></svg>';
    var MOON_ICON =
        '<svg viewBox="0 0 24 24"><path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.9 6.9 0 0 0 11.1 11.1z"></path></svg>';

    function currentScheme() {
        return document.documentElement.dataset.scheme === "dark" ? "dark" : "light";
    }

    var schemeBtn = document.getElementById("site-scheme");
    if (schemeBtn) {
        var paintBtn = function () {
            schemeBtn.innerHTML = currentScheme() === "dark" ? SUN_ICON : MOON_ICON;
            schemeBtn.setAttribute(
                "aria-label",
                currentScheme() === "dark" ? "切换到浅色模式" : "切换到深色模式"
            );
        };
        schemeBtn.addEventListener("click", function () {
            var next = currentScheme() === "dark" ? "light" : "dark";
            document.documentElement.dataset.scheme = next;
            try { localStorage.setItem(SCHEME_KEY, next); } catch (e) {}
            paintBtn();
        });
        paintBtn();
    }

    /* ------------------------------------------------------------ 返回顶部 */

    var toTop = document.getElementById("site-to-top");
    if (toTop) {
        toTop.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: "smooth" });
        });

        var onScroll = function () {
            toTop.classList.toggle("is-visible", window.scrollY > 600);
        };
        var ticking = false;
        window.addEventListener("scroll", function () {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(function () {
                onScroll();
                ticking = false;
            });
        }, { passive: true });
        onScroll();
    }

    /* -------------------------------------------------- 正文外链新标签打开 */

    var prose = document.querySelectorAll(".sd-prose");
    for (var i = 0; i < prose.length; i++) {
        var links = prose[i].querySelectorAll("a[href^='http']");
        for (var j = 0; j < links.length; j++) {
            if (links[j].host !== window.location.host) {
                links[j].target = "_blank";
                links[j].rel = "noopener noreferrer";
            }
        }
    }

    /* -------------------------------------------------------- 代码块复制按钮 */

    var blocks = document.querySelectorAll(".sd-prose pre");
    for (var k = 0; k < blocks.length; k++) {
        (function (pre) {
            var code = pre.querySelector("code");
            if (!code || pre.querySelector(".sd-copy")) return;

            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sd-copy";
            btn.textContent = "复制";
            btn.addEventListener("click", function () {
                var done = function () {
                    btn.textContent = "已复制";
                    setTimeout(function () { btn.textContent = "复制"; }, 1600);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(code.innerText).then(done, function () {});
                } else {
                    var ta = document.createElement("textarea");
                    ta.value = code.innerText;
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand("copy"); done(); } catch (e) {}
                    document.body.removeChild(ta);
                }
            });

            pre.appendChild(btn);
        })(blocks[k]);
    }
})();
