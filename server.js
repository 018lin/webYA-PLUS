const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { requireAuth, sendUnauthorized, adminPassword } = require("./api/_lib/auth");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const dataFile = path.join(dataDir, "site-content.json");
const consultationsFile = path.join(dataDir, "consultations.json");
const backupDir = path.join(dataDir, "backups");
const uploadDir = path.join(rootDir, "images", "uploads");
const port = Number(process.env.PORT || 8080);

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp"
};

const imageExtensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "image/bmp": ".bmp"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
    res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store"
    });
    res.end(body);
}

function sendJson(res, status, value) {
    send(res, status, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) {
                reject(new Error("Request body is too large"));
                req.destroy();
            }
        });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function readBufferBody(req, limit = 10 * 1024 * 1024) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);

    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on("data", chunk => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error("Image is too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function ensureDataDirs() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
}

function ensureUploadDir() {
    fs.mkdirSync(uploadDir, { recursive: true });
}

function readContent() {
    ensureDataDirs();
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

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

function pruneBackups(keep = 100) {
    ensureDataDirs();
    if (!fs.existsSync(backupDir)) return;
    const names = listBackups().map(backup => backup.name);
    names.slice(keep).forEach(name => {
        try {
            fs.unlinkSync(path.join(backupDir, name));
        } catch (error) {
            // 忽略删除失败
        }
    });
}

function appendEditLog(previous, next, backupName, user) {
    const changes = changedModules(previous, next);
    if (!changes.length) return;

    ensureDataDirs();
    const logFile = path.join(dataDir, "edit-log.json");
    let items = [];
    try {
        items = JSON.parse(fs.readFileSync(logFile, "utf8")).items || [];
    } catch (error) {
        items = [];
    }

    items.unshift({
        id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        time: new Date().toISOString(),
        modules: changes,
        user: user || "管理员",
        backup: backupName || null
    });
    items = items.slice(0, 200);

    fs.writeFileSync(logFile, JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

function readEditLog() {
    ensureDataDirs();
    const logFile = path.join(dataDir, "edit-log.json");
    if (!fs.existsSync(logFile)) return { items: [], updatedAt: null };
    try {
        const data = JSON.parse(fs.readFileSync(logFile, "utf8"));
        return {
            items: Array.isArray(data.items) ? data.items : [],
            updatedAt: data.updatedAt || null
        };
    } catch (error) {
        return { items: [], updatedAt: null };
    }
}

function writeContent(nextContent, user) {
    ensureDataDirs();
    let previous = {};
    let backupName = null;
    if (fs.existsSync(dataFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupName = `site-content-${stamp}.json`;
        fs.copyFileSync(dataFile, path.join(backupDir, backupName));
        try {
            previous = JSON.parse(fs.readFileSync(dataFile, "utf8"));
        } catch (parseError) {
            previous = {};
        }
    }
    const content = {
        ...nextContent,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(dataFile, JSON.stringify(content, null, 2), "utf8");
    appendEditLog(previous, content, backupName, user);
    pruneBackups();
    return content;
}

function normalizeConsultationStore(value) {
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

function readConsultations() {
    ensureDataDirs();
    if (!fs.existsSync(consultationsFile)) return { items: [], updatedAt: null };
    return normalizeConsultationStore(JSON.parse(fs.readFileSync(consultationsFile, "utf8")));
}

function writeConsultations(items) {
    ensureDataDirs();
    if (fs.existsSync(consultationsFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(consultationsFile, path.join(backupDir, `consultations-${stamp}.json`));
    }

    const store = normalizeConsultationStore({
        items,
        updatedAt: new Date().toISOString()
    });
    fs.writeFileSync(consultationsFile, JSON.stringify(store, null, 2), "utf8");
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

async function handleConsultations(req, res, requestUrl) {
    if (req.method === "GET") {
        try {
            sendJson(res, 200, readConsultations());
        } catch (error) {
            sendJson(res, 500, { error: "Cannot read consultations" });
        }
        return true;
    }

    if (req.method === "POST") {
        try {
            const payload = JSON.parse(await readBody(req) || "{}");
            const current = readConsultations();
            const created = createConsultation(payload);
            const saved = writeConsultations([created, ...current.items]);
            sendJson(res, 201, { item: created, ...saved });
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot submit consultation" });
        }
        return true;
    }

    if (req.method === "PATCH") {
        if (!requireAuth(req)) {
            sendUnauthorized(res);
            return true;
        }
        try {
            const payload = JSON.parse(await readBody(req) || "{}");
            const status = payload.status === "handled" ? "handled" : "new";
            const current = readConsultations();
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
            sendJson(res, 200, writeConsultations(items));
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot update consultation" });
        }
        return true;
    }

    if (req.method === "DELETE") {
        if (!requireAuth(req)) {
            sendUnauthorized(res);
            return true;
        }
        try {
            const id = requestUrl.searchParams.get("id");
            if (!id) throw new Error("Missing consultation id");
            const current = readConsultations();
            const items = current.items.filter(item => item.id !== id);
            if (items.length === current.items.length) throw new Error("Consultation not found");
            sendJson(res, 200, writeConsultations(items));
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot delete consultation" });
        }
        return true;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return true;
}

function multipartBoundary(contentType) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
    return match ? match[1] || match[2] : "";
}

function contentDispositionValue(header, key) {
    const quoted = new RegExp(`${key}="([^"]*)"`, "i").exec(header || "");
    if (quoted) return quoted[1];

    const bare = new RegExp(`${key}=([^;\\s]+)`, "i").exec(header || "");
    return bare ? bare[1] : "";
}

function parseMultipart(contentType, body) {
    const boundaryText = multipartBoundary(contentType);
    if (!boundaryText) throw new Error("Missing multipart boundary");

    const boundary = Buffer.from(`--${boundaryText}`);
    const headerSeparator = Buffer.from("\r\n\r\n");
    const parts = [];
    let cursor = body.indexOf(boundary);

    while (cursor !== -1) {
        cursor += boundary.length;

        if (body[cursor] === 45 && body[cursor + 1] === 45) break;
        if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

        const headerEnd = body.indexOf(headerSeparator, cursor);
        if (headerEnd === -1) break;

        const rawHeaders = body.slice(cursor, headerEnd).toString("latin1");
        const headers = {};
        rawHeaders.split(/\r\n/).forEach(line => {
            const index = line.indexOf(":");
            if (index === -1) return;
            headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
        });

        const dataStart = headerEnd + headerSeparator.length;
        const nextBoundary = body.indexOf(boundary, dataStart);
        if (nextBoundary === -1) break;

        let dataEnd = nextBoundary;
        if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;

        const disposition = headers["content-disposition"] || "";
        parts.push({
            name: contentDispositionValue(disposition, "name"),
            filename: contentDispositionValue(disposition, "filename"),
            contentType: headers["content-type"] || "",
            data: body.slice(dataStart, dataEnd)
        });

        cursor = nextBoundary;
    }

    return parts;
}

function imageExtension(contentType, filename) {
    const normalizedType = String(contentType || "").toLowerCase();
    if (imageExtensions[normalizedType]) return imageExtensions[normalizedType];

    const ext = path.extname(filename || "").toLowerCase();
    if (Object.values(imageExtensions).includes(ext)) return ext;
    return "";
}

function saveUploadedImage(file) {
    const extension = imageExtension(file.contentType, file.filename);
    if (!extension || !file.data || !file.data.length) {
        throw new Error("Only common image files can be uploaded");
    }

    ensureUploadDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const token = crypto.randomBytes(4).toString("hex");
    const fileName = `${stamp}-${token}${extension}`;
    const targetPath = path.join(uploadDir, fileName);
    fs.writeFileSync(targetPath, file.data);

    return `images/uploads/${fileName}`;
}

async function handleUpload(req, res) {
    if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
    }

    if (!requireAuth(req)) {
        sendUnauthorized(res);
        return true;
    }

    try {
        const body = await readBufferBody(req);
        const parts = parseMultipart(req.headers["content-type"], body);
        const image = parts.find(part => part.name === "image" && part.filename);
        if (!image) throw new Error("No image file uploaded");

        const imagePath = saveUploadedImage(image);
        sendJson(res, 200, { path: imagePath });
    } catch (error) {
        sendJson(res, 400, { error: error.message || "Cannot upload image" });
    }

    return true;
}

function backupTimestamp(name) {
    // 文件名形如 site-content-2026-08-18T08-52-08-935Z.json，还原冒号后即为可排序的 ISO 字符串。
    // 不依赖文件系统 mtime：git checkout / 拷贝会打乱 mtime，文件名时间戳才是最可靠的时间。
    const match = /^site-content-(.+?)\.json$/.exec(name);
    if (!match) return "";
    return String(match[1]).replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z").replace("T", "T");
}

function listBackups() {
    ensureDataDirs();
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter(name => /^site-content-\d{4}-\d{2}-\d{2}.*\.json$/.test(name))
        .map(name => {
            const stat = fs.statSync(path.join(backupDir, name));
            return {
                name,
                size: stat.size,
                modifiedAt: backupTimestamp(name) || stat.mtime.toISOString()
            };
        })
        .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

async function handleBackups(req, res) {
    if (req.method === "GET") {
        try {
            sendJson(res, 200, { backups: listBackups() });
        } catch (error) {
            sendJson(res, 500, { error: "Cannot list backups" });
        }
        return true;
    }

    if (req.method === "POST") {
        const restoreUser = requireAuth(req);
        if (!restoreUser) {
            sendUnauthorized(res);
            return true;
        }
        try {
            const payload = JSON.parse(await readBody(req) || "{}");
            if (payload.action !== "restore") throw new Error("Unknown action");
            const name = String(payload.file || "");
            if (!/^site-content-[\w.-]+\.json$/.test(name)) throw new Error("Invalid backup file name");
            const source = path.join(backupDir, name);
            if (!source.startsWith(backupDir) || !fs.existsSync(source)) {
                throw new Error("Backup file not found");
            }
            // writeContent 会先把当前内容再备份一次，再覆盖写入，恢复操作本身安全
            const restored = writeContent(JSON.parse(fs.readFileSync(source, "utf8")), restoreUser);
            sendJson(res, 200, { restored: true, content: restored });
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot restore backup" });
        }
        return true;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return true;
}

async function handleEditLog(req, res) {
    if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
    }
    try {
        sendJson(res, 200, readEditLog());
    } catch (error) {
        sendJson(res, 500, { error: "Cannot read edit log" });
    }
    return true;
}

async function handleApi(req, res, requestUrl) {
    const pathname = requestUrl.pathname;
    if (pathname === "/api/auth") {
        await require("./api/auth")(req, res);
        return true;
    }
    if (pathname === "/api/consultations") return handleConsultations(req, res, requestUrl);
    if (pathname === "/api/upload") return handleUpload(req, res);
    if (pathname === "/api/backups") return handleBackups(req, res);
    if (pathname === "/api/edit-log") return handleEditLog(req, res);
    if (pathname !== "/api/content") return false;

    if (req.method === "GET") {
        try {
            sendJson(res, 200, readContent());
        } catch (error) {
            sendJson(res, 500, { error: "Cannot read content data" });
        }
        return true;
    }

    if (req.method === "POST") {
        const saveUser = requireAuth(req);
        if (!saveUser) {
            sendUnauthorized(res);
            return true;
        }
        try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const saved = writeContent(payload, saveUser);
            sendJson(res, 200, saved);
        } catch (error) {
            sendJson(res, 400, { error: error.message || "Cannot save content data" });
        }
        return true;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return true;
}

function resolveStaticPath(pathname) {
    const decoded = decodeURIComponent(pathname);
    const requested = decoded === "/" ? "/index.html" : decoded;
    const resolved = path.normalize(path.join(rootDir, requested));
    if (!resolved.startsWith(rootDir)) return null;
    return resolved;
}

function serveStatic(req, res, pathname) {
    let filePath = resolveStaticPath(pathname);
    if (!filePath) {
        send(res, 403, "Forbidden");
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            send(res, 404, "Not found");
            return;
        }
        const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;

    if (await handleApi(req, res, requestUrl)) return;
    serveStatic(req, res, pathname);
});

server.listen(port, () => {
    console.log(`Here Dental site running at http://localhost:${port}/`);
    console.log(`Admin console running at http://localhost:${port}/admin/`);
    console.log(process.env.SITE_ADMIN_USERS
        ? "Admin auth: using SITE_ADMIN_USERS (multi-account)"
        : process.env.SITE_ADMIN_PASSWORD
            ? "Admin auth: using SITE_ADMIN_PASSWORD (single account)"
            : `Admin auth: using default account admin/admin123 (set SITE_ADMIN_USERS or SITE_ADMIN_PASSWORD to override)`);
});
