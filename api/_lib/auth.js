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
// 后台自助改密码后，覆盖层密码优先于环境变量密码。
async function authenticate(username, password) {
    const users = adminUsers();
    const given = Buffer.from(String(password || ""));
    const match = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

    // 覆盖层密码（后台修改过密码的账号）
    const { readOverrides, verifyPasswordHash } = require("./passwords");
    const overrides = await readOverrides();

    if (users) {
        const name = String(username || "").trim();
        const user = users.find(entry => entry.name === name);
        if (!user) return null;
        if (overrides[name]) {
            return verifyPasswordHash(password, overrides[name]) ? user.name : null;
        }
        return match(given, Buffer.from(user.password)) ? user.name : null;
    }

    // 单账号模式：覆盖层条目名为「管理员」
    if (overrides["管理员"]) {
        return verifyPasswordHash(password, overrides["管理员"]) ? "管理员" : null;
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

// ---- 登录限流（内存版）：仅在 LOGIN_LOCK_MS 窗口内【连续】失败
// MAX_LOGIN_FAILURES 次才锁定；窗口内成功登录清零、超过窗口重新计数，
// 历史失败不累计。Vercel serverless 多实例各自独立计数，本限流是尽力而为；
// 高安全要求建议接入 Vercel KV 等外部存储做全局限流。
const MAX_LOGIN_FAILURES = 7;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

const loginFailures = new Map(); // key: `${ip}:${username}` -> { count, lockedUntil }

function loginKey(ip, username) {
    return `${ip || "unknown"}:${String(username || "").trim().toLowerCase()}`;
}

// 防止攻击者用大量不同 IP/用户名把 Map 撑爆（内存 DoS）
function trimLoginFailures() {
    if (loginFailures.size < 5000) return;
    const now = Date.now();
    for (const [key, entry] of loginFailures) {
        // lockedUntil 为 0 表示未锁定，直接清理；已锁定但过期的也清理
        if (!entry.lockedUntil || now > entry.lockedUntil) loginFailures.delete(key);
    }
}

function recordLoginFailure(ip, username) {
    trimLoginFailures();
    const key = loginKey(ip, username);
    const now = Date.now();
    const entry = loginFailures.get(key) || { count: 0, lockedUntil: 0, lastFailAt: 0 };
    // 锁定已过期则整体重置
    if (entry.lockedUntil && now > entry.lockedUntil) {
        entry.count = 0;
        entry.lockedUntil = 0;
        entry.lastFailAt = 0;
    }
    // 距上次失败超过窗口则不累计，仅连续失败才累计
    if (entry.lastFailAt && now - entry.lastFailAt > LOGIN_LOCK_MS) {
        entry.count = 0;
    }
    entry.count += 1;
    entry.lastFailAt = now;
    if (entry.count >= MAX_LOGIN_FAILURES) {
        entry.lockedUntil = now + LOGIN_LOCK_MS;
    }
    loginFailures.set(key, entry);
}

function clearLoginFailures(ip, username) {
    loginFailures.delete(loginKey(ip, username));
}

// 返回剩余锁定毫秒数，未锁定返回 0
function loginLockRemaining(ip, username) {
    const entry = loginFailures.get(loginKey(ip, username));
    if (!entry) return 0;
    if (!entry.lockedUntil) return 0; // 有失败记录但未锁定
    if (Date.now() > entry.lockedUntil) {
        loginFailures.delete(loginKey(ip, username));
        return 0;
    }
    return entry.lockedUntil - Date.now();
}

// 窗口内当前连续失败次数（用于登录失败时提示剩余机会）
function loginFailureCount(ip, username) {
    const entry = loginFailures.get(loginKey(ip, username));
    if (!entry) return 0;
    const now = Date.now();
    if (entry.lockedUntil && now > entry.lockedUntil) return 0;
    if (entry.lastFailAt && now - entry.lastFailAt > LOGIN_LOCK_MS) return 0;
    return entry.count;
}

module.exports = { adminPassword, adminUsers, hasAnyAccount, authenticate, signToken, verifyToken, bearerToken, requireAuth, sendUnauthorized, TOKEN_TTL, MAX_LOGIN_FAILURES, LOGIN_LOCK_MS, recordLoginFailure, clearLoginFailures, loginLockRemaining, loginFailureCount };
