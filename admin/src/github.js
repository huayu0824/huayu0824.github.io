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
