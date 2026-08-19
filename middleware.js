// Vercel Routing Middleware(纯静态项目):兜底拦截 /data/* 数据目录。
//
// 为什么需要:Vercel 路由中静态文件系统优先于 vercel.json 的 rewrites,
// 已存在的文件(如 data/consultations.json)会绕过 rewrite 直接返回。
// Middleware 运行在请求路由之前(缓存之前),是唯一可靠的 URL 层拦截点。
// 第一道防线是 .vercelignore 排除 data/(文件不进部署);本层为第二道防线,
// 即使将来有文件被误放入部署,此层也直接返回 404。

export default function middleware(request) {
    // 仅拦截 /data 及 /data/*(含各种编码形式,到达本层时路径已归一化)
    return new Response("Not Found", {
        status: 404,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

export const config = {
    // 只对 /data 路径运行 middleware,其余请求零开销、直通 CDN
    matcher: "/data/:path*"
};
