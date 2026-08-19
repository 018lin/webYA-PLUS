const { requireAuth, sendUnauthorized } = require("./_lib/auth");

const EDIT_LOG_PREFIX = "cms/edit-log-";
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

async function readLatestEditLog() {
    const sdk = await getBlobSdk();
    if (!sdk) return { items: [], updatedAt: null };

    const result = await sdk.list({ prefix: EDIT_LOG_PREFIX, limit: 100 });
    const latest = (result.blobs || [])
        .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];
    if (!latest) return { items: [], updatedAt: null };

    const blob = await sdk.get(latest.pathname, { access: BLOB_ACCESS, useCache: false });
    if (!blob || blob.statusCode !== 200) return { items: [], updatedAt: null };

    const parsed = JSON.parse(await streamToText(blob.stream));
    return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        updatedAt: parsed.updatedAt || null
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
    }

    if (!requireAuth(req)) return sendUnauthorized(res);

    try {
        sendJson(res, 200, await readLatestEditLog());
    } catch (error) {
        sendJson(res, 500, { error: "Cannot read edit log" });
    }
};
