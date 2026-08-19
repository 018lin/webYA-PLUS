# 后台管理员登录验证

后台管理系统（`/admin/`）已接入密码登录：进入后台需输入管理密码，所有写操作（保存内容、上传图片、恢复备份、处理/删除咨询信息）均校验登录 token。

## 部署配置（Vercel，必做）

1. 打开 Vercel 项目 → **Settings → Environment Variables**，添加：

   | 变量名 | 说明 |
   |---|---|
   | `SITE_ADMIN_PASSWORD` | 管理员登录密码（必填）。**生产环境不配置时，所有写操作一律拒绝（返回 401）**，防止未授权修改 |
   | `SITE_AUTH_SECRET` | 登录 token 的签名密钥（建议设置）。不设置时自动用密码派生，改密码会立即使所有已签发的 token 失效 |

2. 重新部署后生效。

3. 环境变量会保留在 Vercel 控制台，不会出现在代码仓库中；`api/_lib/auth.js` 中也不包含任何真实密码。

## 本地开发

- 未设置 `SITE_ADMIN_PASSWORD` 时使用默认密码 **`admin123`**（启动时控制台会提示）。
- 如需自定义：`SITE_ADMIN_PASSWORD=你的密码 node server.js`。
- 登录 token 有效期 **7 天**，过期后重新输入密码即可。

## 安全边界说明

- **写接口全部鉴权**：`/api/content`（POST）、`/api/upload`（POST）、`/api/backups`（POST）、`/api/consultations`（PATCH/DELETE）都需要 `Authorization: Bearer <token>`。
- **前台患者提交预约**（`/api/consultations` POST）保持开放，患者无需登录。
- **内容读取**（GET）保持公开：数据本就是公开的静态文件，鉴权保护的是"谁能改"，而不是"谁能看"。
- **纯静态模式**（直接双击 `admin/index.html` 打开，无服务端）无法鉴权，保持原状，仅本地查看使用。

## 常见问题

- **后台弹出"服务端尚未配置管理员密码"**：说明 Vercel 上没设置 `SITE_ADMIN_PASSWORD`，按上文配置后重新部署。
- **保存时提示"登录已过期"**：token 超过 7 天有效期，重新输入密码登录。
- **改了密码后旧 token 全部失效**：属于预期行为，重新登录即可。
