// 后台自助修改密码接口：需登录，验证当前密码后写入密码覆盖层。
// 修改后立即生效（优先于环境变量密码），不影响其他管理员账号。
const { requireAuth, sendUnauthorized, authenticate } = require("./_lib/auth");
const { makeSalt, hashPassword, writeOverride } = require("./_lib/passwords");

const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

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
    if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
    }

    // requireAuth 返回 token 中的用户名（单账号模式为「管理员」）
    const username = requireAuth(req);
    if (!username) {
        sendUnauthorized(res);
        return;
    }

    try {
        const payload = await readBody(req);
        const oldPassword = String(payload.oldPassword || "");
        const newPassword = String(payload.newPassword || "");

        if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
            throw new Error(`新密码长度需为 ${MIN_LENGTH}-${MAX_LENGTH} 个字符`);
        }
        if (newPassword === oldPassword) {
            throw new Error("新密码不能与当前密码相同");
        }

        // 验证当前密码（含覆盖层）
        const authed = await authenticate(username, oldPassword);
        if (!authed) {
            throw new Error("当前密码不正确");
        }

        const salt = makeSalt();
        const hash = hashPassword(newPassword, salt);
        await writeOverride(username, salt, hash);

        sendJson(res, 200, { ok: true, user: username });
    } catch (error) {
        sendJson(res, 400, { error: error.message || "Cannot change password" });
    }
};
