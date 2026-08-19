// 后台管理员鉴权：HMAC 无状态 Token（Vercel serverless / 本地 server.js 共用）
const crypto = require("crypto");

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

// 管理员密码：优先取环境变量 SITE_ADMIN_PASSWORD（生产必须配置）。
// 本地开发（非 Vercel 环境）未配置时使用默认密码 admin123。
// 生产环境未配置密码时返回空串，所有写操作一律拒绝，防止裸奔。
function adminPassword() {
    if (process.env.SITE_ADMIN_PASSWORD) return process.env.SITE_ADMIN_PASSWORD;
    if (process.env.VERCEL) return "";
    return "admin123";
}

// token 签名密钥：可用 SITE_AUTH_SECRET 单独设置；不设置时退化为密码派生。
function signingKey() {
    return process.env.SITE_AUTH_SECRET || adminPassword() || "insecure-dev-key";
}

function base64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function signToken() {
    const body = base64Url(JSON.stringify({ exp: Date.now() + TOKEN_TTL }));
    const signature = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
    return `${body}.${signature}`;
}

function verifyToken(token) {
    if (!token || typeof token !== "string") return false;
    const [body, signature] = token.split(".");
    if (!body || !signature) return false;

    const expected = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
    if (signature.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        return Boolean(payload.exp) && payload.exp > Date.now();
    } catch (error) {
        return false;
    }
}

function bearerToken(req) {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return "";
    return header.slice("Bearer ".length).trim();
}

function requireAuth(req) {
    if (!adminPassword()) return false;
    return verifyToken(bearerToken(req));
}

function sendUnauthorized(res) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Unauthorized" }));
}

module.exports = { adminPassword, signToken, verifyToken, bearerToken, requireAuth, sendUnauthorized, TOKEN_TTL };
