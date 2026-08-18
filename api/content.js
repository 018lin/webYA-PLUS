const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(process.cwd(), "data", "site-content.json");
const BLOB_PREFIX = "cms/site-content-";

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value, null, 2));
}

function readSeedContent() {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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

async function getBlobSdk() {
    try {
        return await import("@vercel/blob");
    } catch (error) {
        return null;
    }
}

async function readLatestBlobContent() {
    const sdk = await getBlobSdk();
    if (!sdk) return null;

    const result = await sdk.list({ prefix: BLOB_PREFIX, limit: 100 });
    const latest = (result.blobs || [])
        .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];

    if (!latest) return null;

    const response = await fetch(latest.url, { cache: "no-store" });
    if (!response.ok) throw new Error("Cannot read CMS content blob");
    return response.json();
}

async function writeBlobContent(content) {
    const sdk = await getBlobSdk();
    if (!sdk) {
        throw new Error("Vercel Blob SDK is not available");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pathname = `${BLOB_PREFIX}${stamp}.json`;
    await sdk.put(pathname, JSON.stringify(content, null, 2), {
        access: "public",
        contentType: "application/json; charset=utf-8"
    });

    return content;
}

async function readContent() {
    try {
        const blobContent = await readLatestBlobContent();
        if (blobContent) return blobContent;
    } catch (error) {
        console.error("CMS Blob read failed:", error);
    }

    return readSeedContent();
}

async function writeContent(payload) {
    const content = {
        ...payload,
        updatedAt: new Date().toISOString()
    };

    if (process.env.VERCEL) {
        return writeBlobContent(content);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(content, null, 2) + "\n", "utf8");
    return content;
}

module.exports = async function handler(req, res) {
    if (req.method === "GET") {
        try {
            sendJson(res, 200, await readContent());
        } catch (error) {
            sendJson(res, 500, { error: "Cannot read content data" });
        }
        return;
    }

    if (req.method === "POST") {
        try {
            const payload = await readRequestBody(req);
            const saved = await writeContent(payload);
            sendJson(res, 200, saved);
        } catch (error) {
            const message = process.env.VERCEL
                ? "Cannot save content data. Connect a Vercel Blob store to this project, then redeploy."
                : error.message || "Cannot save content data";
            sendJson(res, 500, { error: message });
        }
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
};
