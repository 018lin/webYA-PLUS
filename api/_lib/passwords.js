// 管理员密码覆盖层：管理员在后台自助改密码后写入此层，认证时优先于环境变量密码生效。
// 线上存 Vercel Blob（私有访问），本地存 data/password-overrides.json。
// 密码仅保存 scrypt 加盐哈希，不存明文。
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OVERRIDE_PATH = "cms/admin-users-override.json";
const LOCAL_FILE = path.join(process.cwd(), "data", "password-overrides.json");

async function getBlobSdk() {
    try {
        return await import("@vercel/blob");
    } catch (error) {
        return null;
    }
}

async function streamToText(stream) {
    if (!stream) return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
}

function makeSalt() {
    return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

// 校验明文密码是否匹配覆盖层哈希
function verifyPasswordHash(password, override) {
    if (!override || !override.salt || !override.hash) return false;
    const given = Buffer.from(hashPassword(password, override.salt), "hex");
    const stored = Buffer.from(override.hash, "hex");
    return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

// 读取覆盖层，返回 { 用户名: { salt, hash } }
async function readOverrides() {
    if (process.env.VERCEL) {
        const sdk = await getBlobSdk();
        if (!sdk) return {};
        try {
            const blob = await sdk.get(OVERRIDE_PATH, { access: "private", useCache: false });
            if (blob && blob.statusCode === 200) {
                const parsed = JSON.parse(await streamToText(blob.stream));
                return parsed && parsed.users ? parsed.users : {};
            }
        } catch (error) {
            // Blob 不存在或读取失败时视为无覆盖
        }
        return {};
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
        return parsed && parsed.users ? parsed.users : {};
    } catch (error) {
        return {};
    }
}

// 写入某个用户的密码覆盖
async function writeOverride(name, salt, hash) {
    const users = await readOverrides();
    users[String(name)] = { salt, hash };

    if (process.env.VERCEL) {
        const sdk = await getBlobSdk();
        if (!sdk) throw new Error("Vercel Blob SDK is not available");
        await sdk.put(OVERRIDE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), users }, null, 2), {
            access: "private",
            contentType: "application/json; charset=utf-8"
        });
        return;
    }

    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), users }, null, 2) + "\n", "utf8");
}

module.exports = { makeSalt, hashPassword, verifyPasswordHash, readOverrides, writeOverride };
