const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { requireAuth, sendUnauthorized } = require("./_lib/auth");

const DATA_FILE = path.join(process.cwd(), "data", "consultations.json");
const BLOB_PREFIX = "cms/consultations-";
const BLOB_ACCESS = process.env.CMS_BLOB_ACCESS === "public" ? "public" : "private";

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value, null, 2));
}

function readRequestBody(req) {
    if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
    if (typeof req.body === "string") {
        try {
            return Promise.resolve(JSON.parse(req.body || "{}"));
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

function readSeedConsultations() {
    if (!fs.existsSync(DATA_FILE)) return { items: [], updatedAt: null };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function normalizeStore(value) {
    const items = Array.isArray(value && value.items)
        ? value.items
        : Array.isArray(value)
            ? value
            : [];

    return {
        items: items
            .filter(Boolean)
            .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)),
        updatedAt: value && value.updatedAt ? value.updatedAt : null
    };
}

async function readLatestBlobConsultations() {
    const sdk = await getBlobSdk();
    if (!sdk) return null;

    const result = await sdk.list({ prefix: BLOB_PREFIX, limit: 100 });
    const latest = (result.blobs || [])
        .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];

    if (!latest) return null;

    const blob = await sdk.get(latest.pathname, {
        access: BLOB_ACCESS,
        useCache: false
    });
    if (!blob || blob.statusCode !== 200) return null;

    return JSON.parse(await streamToText(blob.stream));
}

async function readConsultations() {
    if (process.env.VERCEL) {
        try {
            const blobContent = await readLatestBlobConsultations();
            if (blobContent) return normalizeStore(blobContent);
        } catch (error) {
            console.error("Consultations Blob read failed:", error);
        }
    }

    return normalizeStore(readSeedConsultations());
}

async function writeBlobConsultations(store) {
    const sdk = await getBlobSdk();
    if (!sdk) throw new Error("Vercel Blob SDK is not available");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pathname = `${BLOB_PREFIX}${stamp}.json`;
    await sdk.put(pathname, JSON.stringify(store, null, 2), {
        access: BLOB_ACCESS,
        contentType: "application/json; charset=utf-8"
    });

    return store;
}

async function writeConsultations(items) {
    const store = normalizeStore({
        items,
        updatedAt: new Date().toISOString()
    });

    if (process.env.VERCEL) return writeBlobConsultations(store);

    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
    return store;
}

function cleanText(value, maxLength) {
    return String(value == null ? "" : value)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function cleanMessage(value) {
    return String(value == null ? "" : value)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim()
        .slice(0, 500);
}

function createConsultation(payload) {
    const name = cleanText(payload.name, 40);
    const phone = cleanText(payload.phone, 30);
    if (!name) throw new Error("请填写姓名");
    if (!/^[0-9+\-\s()]{6,30}$/.test(phone)) throw new Error("请填写正确的手机号");

    return {
        id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        name,
        phone,
        type: cleanText(payload.type, 60),
        date: cleanText(payload.date, 30),
        message: cleanMessage(payload.message),
        page: cleanText(payload.page, 160),
        status: "new",
        createdAt: new Date().toISOString()
    };
}

function consultationUrl(req) {
    const host = req.headers && req.headers.host ? req.headers.host : "localhost";
    return new URL(req.url || "/api/consultations", `http://${host}`);
}

module.exports = async function handler(req, res) {
    if (req.method === "GET") {
        try {
            sendJson(res, 200, await readConsultations());
        } catch (error) {
            sendJson(res, 500, { error: "Cannot read consultations" });
        }
        return;
    }

    if (req.method === "POST") {
        try {
            const payload = await readRequestBody(req);
            const current = await readConsultations();
            const created = createConsultation(payload);
            const saved = await writeConsultations([created, ...current.items]);
            sendJson(res, 201, { item: created, ...saved });
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot submit consultation" });
        }
        return;
    }

    if (req.method === "PATCH") {
        if (!requireAuth(req)) return sendUnauthorized(res);
        try {
            const payload = await readRequestBody(req);
            const status = payload.status === "handled" ? "handled" : "new";
            const current = await readConsultations();
            let found = false;
            const items = current.items.map(item => {
                if (item.id !== payload.id) return item;
                found = true;
                return {
                    ...item,
                    status,
                    handledAt: status === "handled" ? new Date().toISOString() : null
                };
            });
            if (!found) throw new Error("Consultation not found");
            sendJson(res, 200, await writeConsultations(items));
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot update consultation" });
        }
        return;
    }

    if (req.method === "DELETE") {
        if (!requireAuth(req)) return sendUnauthorized(res);
        try {
            const id = consultationUrl(req).searchParams.get("id");
            if (!id) throw new Error("Missing consultation id");
            const current = await readConsultations();
            const items = current.items.filter(item => item.id !== id);
            if (items.length === current.items.length) throw new Error("Consultation not found");
            sendJson(res, 200, await writeConsultations(items));
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot delete consultation" });
        }
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
};
