/**
 * GitHub REST API 封装。只用到 Contents API 那几个写文件的接口。
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

/** 列出目录内容（只取一级） */
export function listDir(path, token) {
    return gh(`/repos/${repoPath()}/contents/${encodePath(path)}`, token);
}

/** 读文件；不存在时返回 null */
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

/** 新建或更新文件。传了 sha 就是更新，不传就是新建。 */
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

/** 写入二进制内容（图片上传）。content 已是 base64。 */
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
        body: JSON.stringify({
            message,
            sha,
            branch: env("GITHUB_BRANCH"),
        }),
    });
}

export function getUser(token) {
    return gh("/user", token);
}

function repoPath() {
    return `${env("GITHUB_OWNER")}/${env("GITHUB_REPO")}`;
}

/** 路径里的斜杠不能整体编码，GitHub Contents API 要求分段编码 */
function encodePath(path) {
    return String(path)
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
}

/** 统一的 env 读取，避免各处重复写 env.X */
function env(key) {
    const value = globalThis.__env?.[key];
    if (value === undefined || value === "") {
        throw new Error(`缺少环境变量 ${key}`);
    }
    return value;
}

export function optionalEnv(key) {
    return globalThis.__env?.[key] || "";
}

/** 并发受限的 map，避免一次拉几十个文件把子请求配额打爆 */
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
