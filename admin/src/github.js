/**
 * GitHub REST API 封装。
 *
 * 列表场景用 git/trees（一次请求拿全仓库路径），读写单文件用 Contents API
 * （读写都顺带返回 sha，便于做乐观锁）。
 */

const API = "https://api.github.com";

export class GitHubError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "GitHubError";
        this.status = status;
    }
}

async function gh(path, token, init = {}) {
    const res = await fetch(API + path, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "huayu-blog-admin",
            ...(init.headers || {}),
        },
    });

    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }

    if (!res.ok) {
        // 截断 GitHub 的报错正文，避免把整段 HTML 带进日志
        const msg = (data && data.message) || `GitHub 返回 ${res.status}`;
        throw new GitHubError(msg, res.status);
    }
    return data;
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function fromBase64(b64) {
    const bin = atob(String(b64).replace(/\n/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ 读 */

/** 全仓库文件路径（一次请求）。仓库很大时可能被截断，此时 truncated=true */
export async function listTree(token) {
    const branch = encodeURIComponent(env("GITHUB_BRANCH"));
    const data = await gh(`/repos/${repoPath()}/git/trees/${branch}?recursive=1`, token);
    return {
        truncated: data.truncated === true,
        entries: Array.isArray(data.tree) ? data.tree : [],
    };
}

/** 读单个文件；不存在返回 null */
export async function getFile(path, token) {
    try {
        const data = await gh(`/repos/${repoPath()}/contents/${encodePath(path)}`, token);
        if (Array.isArray(data) || data.type !== "file") return null;
        return {
            path: data.path,
            sha: data.sha,
            text: data.encoding === "base64" ? fromBase64(data.content) : data.content,
        };
    } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
    }
}

/* ------------------------------------------------------------------ 写 */

export function putFile(path, text, token, { sha, message }) {
    return gh(`/repos/${repoPath()}/contents/${encodePath(path)}`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message,
            content: toBase64(text),
            branch: env("GITHUB_BRANCH"),
            ...(sha ? { sha } : {}),
        }),
    });
}

/** 写二进制（图片）。content 已是 base64。 */
export function putBinaryFile(path, base64, token, { message }) {
    return gh(`/repos/${repoPath()}/contents/${encodePath(path)}`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message,
            content: base64,
            branch: env("GITHUB_BRANCH"),
        }),
    });
}

export function deleteFile(path, token, { sha, message }) {
    return gh(`/repos/${repoPath()}/contents/${encodePath(path)}`, token, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sha, branch: env("GITHUB_BRANCH") }),
    });
}

/** 删整个目录：逐个删文件，GitHub Contents API 没有删目录的接口 */
export async function deleteDir(dirPath, token, message) {
    const entries = await gh(`/repos/${repoPath()}/contents/${encodePath(dirPath)}`, token);
    if (!Array.isArray(entries)) return 0;

    let removed = 0;
    for (const entry of entries) {
        if (entry.type === "dir") {
            removed += await deleteDir(`${dirPath}/${entry.name}`, token, message);
        } else {
            await deleteFile(entry.path, token, { sha: entry.sha, message });
            removed++;
        }
    }
    return removed;
}

/* ------------------------------------------------------------------ 其它 */

export function getUser(token) {
    return gh("/user", token);
}

/**
 * 某个文件的提交历史（新的在前）。
 * GitHub 的 commits 接口按 path 过滤，能拿到每次改这个文件的提交。
 */
export async function listCommits(path, token, limit = 20) {
    const qs = new URLSearchParams({
        path,
        sha: env("GITHUB_BRANCH"),
        per_page: String(limit),
    });
    const data = await gh(`/repos/${repoPath()}/commits?${qs.toString()}`, token);
    if (!Array.isArray(data)) return [];

    return data.map((c) => ({
        sha: c.sha,
        message: String(c.commit?.message || "").split("\n")[0],
        date: c.commit?.author?.date || c.commit?.committer?.date || "",
        author: c.commit?.author?.name || "",
    }));
}

/** 读某个 ref（commit sha / 分支）下的文件内容，用于版本回滚 */
export async function getFileAtRef(path, ref, token) {
    const qs = new URLSearchParams({ ref });
    const data = await gh(
        `/repos/${repoPath()}/contents/${encodePath(path)}?${qs.toString()}`,
        token
    );
    if (Array.isArray(data) || data.type !== "file") return null;
    return {
        path: data.path,
        sha: data.sha,
        text: data.encoding === "base64" ? fromBase64(data.content) : data.content,
    };
}

/* ------------------------------------------------------------------ 搜索 */

/**
 * 仓库内全文搜索，返回命中的文件路径。
 *
 * 为什么用 code search 而不是自己遍历：把整个仓库的文件都读一遍会撞上
 * Cloudflare 免费版单请求 50 个子请求的上限。code search 一次请求就能
 * 给出命中路径，之后只读这几个文件。
 *
 * 认证 token 的 code search 配额是每分钟 10 次，够个人博客用了。
 */
export async function searchFiles(token, { query, pathPrefix, limit = 40 }) {
    const parts = [query, `repo:${repoPath()}`];
    if (pathPrefix) parts.push(`path:${pathPrefix}`);

    const data = await gh(
        `/search/code?q=${encodeURIComponent(parts.join(" "))}&per_page=${Math.min(limit, 100)}`,
        token
    );
    if (!data || !Array.isArray(data.items)) return [];
    return data.items.map((item) => item.path);
}

/* ------------------------------------------------------------- 批量提交 */
/**
 * 一次提交写入多个文件（可同时删除）。
 *
 * 走 Git Data API 而不是逐个 Contents API：
 * Contents API 一个文件一次请求，Cloudflare 免费版单请求只有 50 个子请求，
 * 批量改 20 篇文章就会撞线。Git Data API 可以把文件内容直接内联在 tree 里，
 * 无论改几个文件都只花 5 次请求（取 ref → 取 tree → 建 tree → 建 commit → 更新 ref）。
 *
 * files:    [{ path, text }]
 * deletions:[path]
 */
export async function commitFiles(token, { message, files = [], deletions = [] }) {
    const branch = env("GITHUB_BRANCH");
    const branchRef = encodeURIComponent(branch);

    const ref = await gh(`/repos/${repoPath()}/git/ref/heads/${branchRef}`, token);
    const baseCommit = ref.object.sha;

    const base = await gh(`/repos/${repoPath()}/git/commits/${baseCommit}`, token);
    const baseTree = base.tree.sha;

    const tree = files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.text,
    }));

    // sha 为 null 表示删除该路径
    for (const path of deletions) {
        tree.push({ path, mode: "100644", type: "blob", sha: null });
    }

    const newTree = await gh(`/repos/${repoPath()}/git/trees`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTree, tree }),
    });

    const commit = await gh(`/repos/${repoPath()}/git/commits`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommit] }),
    });

    // force:false 表示只允许快进，仓库有并发提交时会失败而不是覆盖别人的改动
    await gh(`/repos/${repoPath()}/git/refs/heads/${branchRef}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return commit.sha;
}

function repoPath() {
    return `${env("GITHUB_OWNER")}/${env("GITHUB_REPO")}`;
}

/** 路径里的斜杠不能整体编码，Contents API 要求分段编码 */
function encodePath(path) {
    return String(path)
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
}

function env(key) {
    const value = globalThis.__env?.[key];
    if (value === undefined || value === "") throw new Error(`缺少环境变量 ${key}`);
    return value;
}

export function optionalEnv(key) {
    return globalThis.__env?.[key] || "";
}

/** 并发受限的 map，避免一次打太多子请求 */
export async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}
