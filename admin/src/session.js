/**
 * 会话令牌：HMAC-SHA256 签名的紧凑 JWT。
 *
 * GitHub OAuth 的 access_token 不带刷新令牌，默认长期有效，
 * 所以这里把它直接放进签名后的令牌里，服务端无需任何存储。
 * 令牌通过 HttpOnly Cookie 下发，浏览器 JS 读不到。
 */

const enc = new TextEncoder();

function toBase64Url(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function hmacKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

/** 恒定时间比较，避免按字节提前返回导致时序泄漏 */
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

export async function signSession(payload, secret) {
    const body = toBase64Url(enc.encode(JSON.stringify(payload)));
    const key = await hmacKey(secret);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
    return body + "." + toBase64Url(sig);
}

/** 校验失败一律返回 null，不向外抛具体原因 */
export async function verifySession(token, secret) {
    if (!token || typeof token !== "string") return null;
    const idx = token.lastIndexOf(".");
    if (idx <= 0) return null;

    const body = token.slice(0, idx);
    const sig = token.slice(idx + 1);

    try {
        const key = await hmacKey(secret);
        const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
        if (!timingSafeEqual(expected, fromBase64Url(sig))) return null;

        const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
        if (!payload || typeof payload !== "object") return null;
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

export const COOKIE_NAME = "hd_session";

export function sessionCookie(token, maxAgeSeconds) {
    const parts = [
        `${COOKIE_NAME}=${token}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`,
    ];
    return parts.join("; ");
}

export function clearSessionCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request) {
    const raw = request.headers.get("Cookie") || "";
    for (const part of raw.split(";")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        if (part.slice(0, i).trim() === COOKIE_NAME) {
            return decodeURIComponent(part.slice(i + 1).trim());
        }
    }
    return null;
}
