// 管理员登录接口：POST 校验账号密码并签发 token；GET 校验当前 token 是否有效。
// 账号通过环境变量 SITE_ADMIN_USERS（多账号）或 SITE_ADMIN_PASSWORD（单账号）配置，不写入代码仓库。
const { hasAnyAccount, authenticate, signToken, verifyToken, bearerToken, sendUnauthorized, TOKEN_TTL } = require("./_lib/auth");

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
            const user = authenticate(username, password);
            if (!user) {
                sendJson(res, 401, { error: "用户名或密码错误" });
                return;
            }
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
