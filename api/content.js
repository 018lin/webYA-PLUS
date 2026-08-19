const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(process.cwd(), "data", "site-content.json");
const BLOB_PREFIX = "cms/site-content-";
const BLOB_ACCESS = process.env.CMS_BLOB_ACCESS === "public" ? "public" : "private";

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

async function readLatestBlobContent() {
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

async function writeBlobContent(content) {
    const sdk = await getBlobSdk();
    if (!sdk) {
        throw new Error("Vercel Blob SDK is not available");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pathname = `${BLOB_PREFIX}${stamp}.json`;
    await sdk.put(pathname, JSON.stringify(content, null, 2), {
        access: BLOB_ACCESS,
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

const EDIT_LOG_PREFIX = "cms/edit-log-";

const moduleConfig = {
    site: { key: "site", type: "object", label: "全站设置" },
    home: { key: "home", type: "object", label: "首页内容" },
    doctors: { key: "doctors", type: "list", label: "医生管理", itemLabel: "医生", titleKey: "name" },
    specialties: { key: "specialties", type: "list", label: "专科管理", itemLabel: "专科", titleKey: "name" },
    articles: { key: "articles", type: "list", label: "科普文章", itemLabel: "文章", titleKey: "title" }
};

const moduleFieldLabels = {
    site: { name: "网站名称", slogan: "品牌口号", phone: "联系电话", email: "电子邮箱", address: "诊所地址", hours: "营业时间", icpText: "备案信息", mapLng: "地图经度", mapLat: "地图纬度" },
    home: { heroSlides: "轮播", philosophyTitle: "理念标题", philosophyText: "理念文案", ctaTitle: "底部预约标题", ctaButton: "预约按钮" },
    doctors: { name: "姓名", title: "职称", avatar: "头像", tags: "擅长标签", summary: "简介", href: "详情页链接", visible: "显示状态" },
    specialties: { name: "名称", subtitle: "副标题", cover: "封面图", href: "详情页链接", tags: "标签", doctorNames: "关联医生", summary: "简介", visible: "显示状态" },
    articles: { title: "标题", category: "分类", date: "发布时间", image: "封面图", summary: "摘要", body: "正文", visible: "发布状态" }
};

function itemKey(item, index) {
    const key = item && (item.name || item.title || item.topic);
    return key ? String(key) : `#${index}`;
}

function escapeLabel(value) {
    return String(value == null ? "" : value).replace(/[\r\n"「」]/g, "").slice(0, 30);
}

function diffList(previousList, nextList, config) {
    const changes = [];
    const before = Array.isArray(previousList) ? previousList : [];
    const after = Array.isArray(nextList) ? nextList : [];
    const beforeKeys = before.map((item, index) => itemKey(item, index));
    const afterKeys = after.map((item, index) => itemKey(item, index));
    const labels = moduleFieldLabels[config.key] || {};

    before.forEach((item, index) => {
        const key = beforeKeys[index];
        if (!afterKeys.includes(key)) {
            changes.push(`${config.label}：删除${config.itemLabel}「${escapeLabel(item[config.titleKey] || key)}」`);
        }
    });

    after.forEach((item, index) => {
        const key = afterKeys[index];
        const prevIndex = beforeKeys.indexOf(key);
        if (prevIndex === -1) {
            changes.push(`${config.label}：新增${config.itemLabel}「${escapeLabel(item[config.titleKey] || key)}」`);
            return;
        }
        const changedFields = Object.keys(labels)
            .filter(field => JSON.stringify(before[prevIndex][field]) !== JSON.stringify(item[field]));
        if (changedFields.length) {
            changes.push(`${config.label}：修改${config.itemLabel}「${escapeLabel(item[config.titleKey] || key)}」（${changedFields.map(field => labels[field]).join("、")}）`);
        }
    });
    return changes;
}

function diffObject(previousObj, nextObj, config) {
    const changes = [];
    const before = previousObj && typeof previousObj === "object" ? previousObj : {};
    const after = nextObj && typeof nextObj === "object" ? nextObj : {};
    const labels = moduleFieldLabels[config.key] || {};

    if (Array.isArray(before.heroSlides) || Array.isArray(after.heroSlides)) {
        changes.push(...diffList(
            Array.isArray(before.heroSlides) ? before.heroSlides : [],
            Array.isArray(after.heroSlides) ? after.heroSlides : [],
            { key: "home", type: "list", label: "首页内容", itemLabel: "轮播", titleKey: "title" }
        ));
    }

    const changedScalars = Object.keys(labels)
        .filter(field => field !== "heroSlides" && JSON.stringify(before[field]) !== JSON.stringify(after[field]))
        .map(field => labels[field])
        .filter(Boolean);
    if (changedScalars.length) {
        changes.push(`${config.label}：修改（${changedScalars.join("、")}）`);
    }
    return changes;
}

function changedModules(previous, next) {
    const changes = [];
    for (const config of Object.values(moduleConfig)) {
        const before = previous && previous[config.key];
        const after = next && next[config.key];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;

        if (config.type === "list") {
            changes.push(...diffList(before, after, config));
        } else {
            changes.push(...diffObject(before, after, config));
        }
    }
    return changes;
}

async function appendEditLogBlob(previous, next) {
    const changes = changedModules(previous, next);
    if (!changes.length) return;

    const sdk = await getBlobSdk();
    if (!sdk) return;

    let items = [];
    try {
        const result = await sdk.list({ prefix: EDIT_LOG_PREFIX, limit: 100 });
        const latest = (result.blobs || [])
            .filter(blob => blob.pathname && blob.pathname.endsWith(".json"))
            .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))[0];
        if (latest) {
            const blob = await sdk.get(latest.pathname, { access: BLOB_ACCESS, useCache: false });
            if (blob && blob.statusCode === 200) {
                const parsed = JSON.parse(await streamToText(blob.stream));
                items = Array.isArray(parsed.items) ? parsed.items : [];
            }
        }
    } catch (error) {
        items = [];
    }

    items.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        time: new Date().toISOString(),
        modules: changes,
        user: "管理员"
    });
    items = items.slice(0, 200);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await sdk.put(`${EDIT_LOG_PREFIX}${stamp}.json`, JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2), {
        access: BLOB_ACCESS,
        contentType: "application/json; charset=utf-8"
    });
}

async function writeContent(payload) {
    const content = {
        ...payload,
        updatedAt: new Date().toISOString()
    };

    if (process.env.VERCEL) {
        let previous = {};
        try {
            previous = (await readLatestBlobContent()) || {};
        } catch (error) {
            previous = {};
        }
        await writeBlobContent(content);
        await appendEditLogBlob(previous, content);
        return content;
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
