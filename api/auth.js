// 管理员登录接口：POST 校验账号密码并签发 token；GET 校验当前 token 是否有效。
// 账号通过环境变量 SITE_ADMIN_USERS（多账号）或 SITE_ADMIN_PASSWORD（单账号）配置，不写入代码仓库。
const { hasAnyAccount, authenticate, signToken, verifyToken, bearerToken, sendUnauthorized, TOKEN_TTL, MAX_LOGIN_FAILURES, LOGIN_LOCK_MS, recordLoginFailure, clearLoginFailures, loginLockRemaining, loginFailureCount } = require("./_lib/auth");

// 客户端 IP：Vercel 经 x-forwarded-for 传入真实来源地址
function clientIp(req) {
    const forwarded = req.headers && req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    return (req.socket && req.socket.remoteAddress) || "";
}

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value, null, 2));
}

function readBody(req) {
    if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
    if (typeof req.body === "string") {
        try {
            return Promise.resolve(JSON.parse(req.body));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 64 * 1024) {
                reject(new Error("Request body is too large"));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}

module.exports = async function handler(req, res) {
    if (!hasAnyAccount()) {
        sendJson(res, 503, { error: "管理员账号尚未配置，请设置环境变量 SITE_ADMIN_USERS 或 SITE_ADMIN_PASSWORD 后重新部署" });
        return;
    }

    if (req.method === "GET") {
        if (verifyToken(bearerToken(req))) {
            sendJson(res, 200, { ok: true });
        } else {
            sendUnauthorized(res);
        }
        return;
    }

    if (req.method === "POST") {
        try {
            const payload = await readBody(req);
            const username = String((payload && payload.username) || "").trim();
            const password = String((payload && payload.password) || "");
            const ip = clientIp(req);

            const lockRemaining = loginLockRemaining(ip, username);
            if (lockRemaining > 0) {
                sendJson(res, 429, { error: `尝试次数过多，请 ${Math.ceil(lockRemaining / 60000)} 分钟后再试` });
                return;
            }

            const user = authenticate(username, password);
            if (!user) {
                recordLoginFailure(ip, username);
                const locked = loginLockRemaining(ip, username) > 0;
                const message = locked
                    ? `连续输错 ${MAX_LOGIN_FAILURES} 次，账号已锁定 ${Math.ceil(LOGIN_LOCK_MS / 60000)} 分钟`
                    : `用户名或密码错误，还可尝试 ${MAX_LOGIN_FAILURES - loginFailureCount(ip, username)} 次`;
                sendJson(res, 401, { error: message });
                return;
            }
            clearLoginFailures(ip, username);
            sendJson(res, 200, {
                token: signToken(user),
                expiresAt: Date.now() + TOKEN_TTL,
                user
            });
        } catch (error) {
            sendJson(res, 400, { error: "请求格式错误" });
        }
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
};
