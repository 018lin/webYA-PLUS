const { requireAuth, sendUnauthorized } = require("./_lib/auth");

const BLOB_PREFIX = "cms/site-content-";
const BLOB_ACCESS = process.env.CMS_BLOB_ACCESS === "public" ? "public" : "private";

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value, null, 2));
}

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

function readRequestBody(req) {
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
            if (body.length > 5 * 1024 * 1024) {
                reject(new Error("Request body is too large"));
                req.destroy();
                return;
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

async function listBlobBackups() {
    const sdk = await getBlobSdk();
    if (!sdk) return [];

    const result = await sdk.list({ prefix: BLOB_PREFIX, limit: 100 });
    return (result.blobs || [])
        .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
        .map(blob => ({
            name: String(blob.pathname).split("/").pop(),
            size: blob.size || 0,
            modifiedAt: blob.uploadedAt || null
        }))
        .sort((a, b) => String(b.modifiedAt || "").localeCompare(String(a.modifiedAt || "")));
}

async function restoreBlobBackup(name) {
    const sdk = await getBlobSdk();
    if (!sdk) throw new Error("Vercel Blob SDK is not available");
    if (!/^site-content-[\w.-]+\.json$/.test(name)) throw new Error("Invalid backup file name");

    const pathname = `${BLOB_PREFIX}${name}`;
    const blob = await sdk.get(pathname, { access: BLOB_ACCESS, useCache: false });
    if (!blob || blob.statusCode !== 200) throw new Error("Backup file not found");

    const content = JSON.parse(await streamToText(blob.stream));
    // 恢复写入新版本，Blob 里天然保留全部历史，不覆盖旧版本
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await sdk.put(`${BLOB_PREFIX}${stamp}.json`, JSON.stringify(content, null, 2), {
        access: BLOB_ACCESS,
        contentType: "application/json; charset=utf-8"
    });
    return content;
}

module.exports = async function handler(req, res) {
    if (req.method === "GET") {
        try {
            sendJson(res, 200, { backups: await listBlobBackups() });
        } catch (error) {
            sendJson(res, 500, { error: "Cannot list backups" });
        }
        return;
    }

    if (req.method === "POST") {
        if (!requireAuth(req)) return sendUnauthorized(res);
        try {
            const payload = await readRequestBody(req);
            if (payload.action !== "restore") throw new Error("Unknown action");
            const content = await restoreBlobBackup(String(payload.file || ""));
            sendJson(res, 200, { restored: true, content });
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot restore backup" });
        }
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
};
