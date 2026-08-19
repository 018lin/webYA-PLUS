const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { requireAuth, sendUnauthorized } = require("./_lib/auth");

const uploadDir = path.join(process.cwd(), "images", "uploads");

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

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value, null, 2));
}

function readRequestBuffer(req, limit = 10 * 1024 * 1024) {
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

function uploadedFileName(extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const token = crypto.randomBytes(4).toString("hex");
    return `${stamp}-${token}${extension}`;
}

function validateImage(file) {
    const extension = imageExtension(file.contentType, file.filename);
    if (!extension || !file.data || !file.data.length) {
        throw new Error("Only common image files can be uploaded");
    }
    return extension;
}

function saveLocalImage(file, extension) {
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = uploadedFileName(extension);
    fs.writeFileSync(path.join(uploadDir, fileName), file.data);
    return `images/uploads/${fileName}`;
}

async function saveBlobImage(file, extension) {
    const sdk = await import("@vercel/blob");
    const fileName = uploadedFileName(extension);
    const pathname = `cms/images/${fileName}`;
    const result = await sdk.put(pathname, file.data, {
        access: "public",
        contentType: file.contentType
    });
    return result.url;
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
    }

    if (!requireAuth(req)) return sendUnauthorized(res);

    try {
        const body = await readRequestBuffer(req);
        const parts = parseMultipart(req.headers["content-type"], body);
        const image = parts.find(part => part.name === "image" && part.filename);
        if (!image) throw new Error("No image file uploaded");

        const extension = validateImage(image);
        const imagePath = process.env.VERCEL
            ? await saveBlobImage(image, extension)
            : saveLocalImage(image, extension);

        sendJson(res, 200, { path: imagePath });
    } catch (error) {
        const message = process.env.VERCEL
            ? "Cannot upload image. Connect a Vercel Blob store to this project, then redeploy."
            : error.message || "Cannot upload image";
        sendJson(res, 400, { error: message });
    }
};
