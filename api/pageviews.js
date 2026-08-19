const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { requireAuth, sendUnauthorized } = require("./_lib/auth");

// 前台浏览记录：POST 公开（fire-and-forget 上报），GET 仅后台可读。
// 生产环境（Vercel）存 Blob（带时间戳的不可变对象，写入后修剪旧对象防止无限增长），
// 本地开发（server.js / vercel dev）写 data/pageviews.json。
const DATA_FILE = path.join(process.cwd(), "data", "pageviews.json");
const BLOB_PREFIX = "cms/pageviews-";
const BLOB_ACCESS = process.env.CMS_BLOB_ACCESS === "public" ? "public" : "private";
const MAX_ITEMS = 5000;      // 单份存储最多保留的浏览记录条数
const MAX_PRUNE_BLOBS = 20;  // Vercel Blob 只保留最新 N 份，其余删除

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

function readSeedPageViews() {
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
            .sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0))
            .slice(0, MAX_ITEMS),
        updatedAt: value && value.updatedAt ? value.updatedAt : null
    };
}

async function readLatestBlobPageViews() {
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

async function readPageViews() {
    if (process.env.VERCEL) {
        try {
            const blobContent = await readLatestBlobPageViews();
            if (blobContent) return normalizeStore(blobContent);
        } catch (error) {
            console.error("Pageviews Blob read failed:", error);
        }
    }

    return normalizeStore(readSeedPageViews());
}

// 浏览量写入高频，旧 blob 不修剪会无限增长；只保留最新 MAX_PRUNE_BLOBS 份。
// 修剪失败不影响本次写入，尽力而为。
async function prunePageViewBlobs(sdk) {
    try {
        const result = await sdk.list({ prefix: BLOB_PREFIX, limit: 1000 });
        const blobs = (result.blobs || [])
            .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
            .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
        const stale = blobs.slice(MAX_PRUNE_BLOBS);
        if (stale.length) await sdk.del(stale.map(blob => blob.url));
    } catch (error) {
        console.error("Pageviews Blob prune failed:", error);
    }
}

async function writeBlobPageViews(store) {
    const sdk = await getBlobSdk();
    if (!sdk) throw new Error("Vercel Blob SDK is not available");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await sdk.put(`${BLOB_PREFIX}${stamp}.json`, JSON.stringify(store, null, 2), {
        access: BLOB_ACCESS,
        contentType: "application/json; charset=utf-8"
    });

    await prunePageViewBlobs(sdk);
    return store;
}

async function writePageViews(items) {
    const store = normalizeStore({
        items,
        updatedAt: new Date().toISOString()
    });

    if (process.env.VERCEL) return writeBlobPageViews(store);

    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
    return store;
}

function cleanPage(value) {
    const page = String(value == null ? "" : value)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
    return page || "/";
}

// 校验 YYYY-MM-DD 为真实存在的日历日期（格式对但日期不存在时也拒绝）
function validDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const date = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, date));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
        return null;
    }
    return String(value);
}

function createPageView(payload) {
    // 按天分组使用访客本地日期（客户端计算上报），避免服务器时区与访客时区不一致；
    // 日期非法时回退服务器 UTC 日期。
    const day = validDay(payload && payload.day) || new Date().toISOString().slice(0, 10);

    return {
        id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        page: cleanPage(payload && payload.page),
        day,
        time: new Date().toISOString()
    };
}

function summarize(store) {
    const items = Array.isArray(store.items) ? store.items : [];
    const dayCounts = new Map();
    items.forEach(item => {
        const day = item && item.day ? String(item.day) : String(item && item.time || "").slice(0, 10);
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    });

    const days = Array.from(dayCounts.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
        items,
        days,
        total: items.length,
        updatedAt: store.updatedAt || null
    };
}

module.exports = async function handler(req, res) {
    if (req.method === "GET") {
        if (!requireAuth(req)) return sendUnauthorized(res);
        try {
            sendJson(res, 200, summarize(await readPageViews()));
        } catch (error) {
            sendJson(res, 500, { error: "Cannot read page views" });
        }
        return;
    }

    if (req.method === "POST") {
        let payload;
        try {
            payload = await readRequestBody(req);
        } catch (error) {
            sendJson(res, 400, { error: "Invalid request body" });
            return;
        }
        try {
            const current = await readPageViews();
            const created = createPageView(payload);
            const saved = await writePageViews([created, ...current.items]);
            // 上报端不关心响应体，只回新记录与总数，避免把整份存储回传
            sendJson(res, 201, { item: created, total: saved.items.length });
        } catch (error) {
            console.error("Pageviews write failed:", error);
            sendJson(res, 500, { error: "Cannot record page view" });
        }
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
};
