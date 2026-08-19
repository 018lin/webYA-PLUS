// 后台管理员鉴权：HMAC 无状态 Token（Vercel serverless / 本地 server.js 共用）
// 账号支持两种配置方式：
//   - SITE_ADMIN_USERS=user1:pass1,user2:pass2  多账号（推荐），编辑记录显示真实用户名
//   - SITE_ADMIN_PASSWORD=xxx                    单账号（旧配置兼容），操作者统一记为「管理员」
// 两者都未配置时（生产环境）：所有写操作一律拒绝，防止裸奔。
const crypto = require("crypto");

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

function adminPassword() {
    if (process.env.SITE_ADMIN_PASSWORD) return process.env.SITE_ADMIN_PASSWORD;
    if (process.env.VERCEL) return "";
    return "admin123";
}

// 解析 SITE_ADMIN_USERS（"name:pass,name2:pass2"），未配置返回 null
function adminUsers() {
    const raw = process.env.SITE_ADMIN_USERS;
    if (!raw) return null;
    return String(raw)
        .split(",")
        .map(part => {
            const index = part.indexOf(":");
            if (index <= 0) return null;
            return { name: part.slice(0, index).trim(), password: part.slice(index + 1) };
        })
        .filter(Boolean);
}

function hasAnyAccount() {
    return Boolean(adminUsers() || adminPassword());
}

// 校验用户名密码，通过返回该用户在编辑记录中显示的名字，否则返回 null。
// 单账号模式不校验用户名，登录者统一记为「管理员」。
function authenticate(username, password) {
    const users = adminUsers();
    const given = Buffer.from(String(password || ""));
    const match = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

    if (users) {
        const user = users.find(entry => entry.name === String(username || "").trim());
        if (!user) return null;
        return match(given, Buffer.from(user.password)) ? user.name : null;
    }

    return match(given, Buffer.from(adminPassword())) ? "管理员" : null;
}

// token 签名密钥：优先 SITE_AUTH_SECRET；否则用账号配置派生（改密码会使旧 token 失效）。
function signingKey() {
    if (process.env.SITE_AUTH_SECRET) return process.env.SITE_AUTH_SECRET;
    const users = adminUsers();
    if (users && users.length) return users[0].password;
    return adminPassword() || "insecure-dev-key";
}

function base64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function signToken(username) {
    const body = base64Url(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL }));
    const signature = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
    return `${body}.${signature}`;
}

// 校验 token，有效则返回用户名，否则返回 null
function verifyToken(token) {
    if (!token || typeof token !== "string") return null;
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;

    const expected = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload.exp || payload.exp > Date.now()) return payload.u || "管理员";
        return null;
    } catch (error) {
        return null;
    }
}

function bearerToken(req) {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return "";
    return header.slice("Bearer ".length).trim();
}

// 校验请求是否已登录，通过返回用户名，否则返回 null
function requireAuth(req) {
    if (!hasAnyAccount()) return null;
    return verifyToken(bearerToken(req));
}

function sendUnauthorized(res) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Unauthorized" }));
}

module.exports = { adminPassword, adminUsers, hasAnyAccount, authenticate, signToken, verifyToken, bearerToken, requireAuth, sendUnauthorized, TOKEN_TTL };
