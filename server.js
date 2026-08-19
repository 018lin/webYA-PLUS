const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const dataFile = path.join(dataDir, "site-content.json");
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

function writeContent(nextContent) {
    ensureDataDirs();
    if (fs.existsSync(dataFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(dataFile, path.join(backupDir, `site-content-${stamp}.json`));
    }
    const content = {
        ...nextContent,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(dataFile, JSON.stringify(content, null, 2), "utf8");
    return content;
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

async function handleApi(req, res, pathname) {
    if (pathname === "/api/upload") return handleUpload(req, res);
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
        try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const saved = writeContent(payload);
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

    if (await handleApi(req, res, pathname)) return;
    serveStatic(req, res, pathname);
});

server.listen(port, () => {
    console.log(`Here Dental site running at http://localhost:${port}/`);
    console.log(`Admin console running at http://localhost:${port}/admin/`);
});
