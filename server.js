const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const dataFile = path.join(dataDir, "site-content.json");
const backupDir = path.join(dataDir, "backups");
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
    ".svg": "image/svg+xml"
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

function ensureDataDirs() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
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

async function handleApi(req, res, pathname) {
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
