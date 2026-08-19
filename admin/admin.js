const modules = [
    { id: "settings", label: "全站设置", icon: "fa-gear" },
    { id: "home", label: "首页内容", icon: "fa-house" },
    { id: "doctors", label: "医生管理", icon: "fa-user-doctor" },
    { id: "specialties", label: "专科管理", icon: "fa-tooth" },
    { id: "articles", label: "科普文章", icon: "fa-book-medical" },
    { id: "consultations", label: "咨询信息", icon: "fa-inbox" },
    { id: "editLog", label: "编辑记录", icon: "fa-history" }
];

const fallbackContent = {
    site: {
        name: "惠尔口腔",
        slogan: "预防胜于一切的治疗",
        phone: "0752-7820202",
        email: "hcjkqmz@163.com",
        address: "惠州市惠城区麦地东二路鸿润花园A栋102-106铺",
        hours: "周一至周四09:00-20:00 周五至周日09:00-18:00"
    },
    home: {
        heroSlides: [
            { title: "首页轮播 1", image: "images/轮播图/轮播图1.JPG", alt: "轮播图1", visible: true },
            { title: "首页轮播 2", image: "images/轮播图/轮播图2.jpg", alt: "轮播图2", visible: true }
        ],
        philosophyTitle: "我们的理念",
        philosophyText: "我们希望您来惠尔，不是因为牙疼。而是为了让牙疼永远不会发生。",
        ctaTitle: "守护牙齿，从今天开始",
        ctaButton: "预约口腔检查"
    },
    doctors: [],
    specialties: [],
    articles: []
};

let content = JSON.parse(JSON.stringify(fallbackContent));
let activeModule = "settings";
let apiMode = false;
let apiUrl = "../api/content";
let consultations = [];
let consultationsLoaded = false;
let consultationsLoading = false;
let consultationApiUrl = "../api/consultations";
let articleSearch = "";
let articleCategoryFilter = "all";
let articleEditorIndex = null;
let articleCoverValue = "";
let carouselEditorIndex = null;
let carouselImageValue = "";
let dirty = false;
let collectionOpenIndex = null;
let authToken = localStorage.getItem("here-dental-auth-token") || "";
let authExpiresAt = Number(localStorage.getItem("here-dental-auth-expires") || 0);
let authUser = localStorage.getItem("here-dental-auth-user") || "";
let authRequired = false;
let revision = 0;
let consultationFilter = "all";
let consultationSearch = "";
let articleSearchTimer = null;
let consultationSearchTimer = null;
let editLogItems = [];
let editLogLoading = false;
let editLogLoaded = false;

const apiUrls = ["../api/content", "/api/content"];
const authUrls = ["../api/auth", "/api/auth"];
const uploadUrls = ["../api/upload", "/api/upload"];
const consultationUrls = ["../api/consultations", "/api/consultations"];
const editLogUrls = ["../api/edit-log", "/api/edit-log"];
const backupUrls = ["../api/backups", "/api/backups"];
const staticContentUrls = ["../data/site-content.json", "/data/site-content.json"];

const navEl = document.getElementById("adminNav");
const titleEl = document.getElementById("moduleTitle");
const panelEl = document.getElementById("editorPanel");
const stateEl = document.getElementById("saveState");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const currentUserEl = document.getElementById("currentUser");
const currentUserNameEl = document.getElementById("currentUserName");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[char]);
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function assetSrc(value) {
    const src = String(value || "").trim();
    if (!src) return "";
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return src;
    return `../${src}`;
}

function setState(text, tone = "neutral") {
    stateEl.textContent = text;
    stateEl.style.color = tone === "error" ? "#b91c1c" : tone === "ok" ? "#0f766e" : tone === "warn" ? "#b45309" : "";
}

function markDirty() {
    revision++;
    if (dirty) return;
    dirty = true;
    saveBtn.classList.add("is-dirty");
    setState("有未保存的修改", "warn");
}

function clearDirty() {
    dirty = false;
    saveBtn.classList.remove("is-dirty");
}

async function confirmDiscard(message) {
    if (!dirty) return true;
    return confirmDialog(message, { okText: "放弃修改", danger: false });
}

function confirmDialog(message, { okText = "确定", danger = true } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.id = "confirmModal";
        overlay.innerHTML = `
            <div class="modal confirm-modal" role="alertdialog" aria-modal="true">
                <div class="modal-head">
                    <div>
                        <h3>确认操作</h3>
                    </div>
                </div>
                <div class="modal-body confirm-body">
                    <p>${escapeHtml(message)}</p>
                </div>
                <div class="modal-foot">
                    <button class="ghost-btn" type="button" data-confirm-cancel>取消</button>
                    <button class="${danger ? "danger-btn" : "primary-btn"}" type="button" data-confirm-ok>
                        <i class="fas ${danger ? "fa-trash" : "fa-check"}"></i> ${okText}
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const onKey = event => {
            if (event.key === "Escape") close(false);
        };
        const close = result => {
            overlay.remove();
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };

        document.addEventListener("keydown", onKey);
        overlay.addEventListener("click", event => {
            if (event.target === overlay) close(false);
        });
        overlay.querySelector("[data-confirm-cancel]").addEventListener("click", () => close(false));
        overlay.querySelector("[data-confirm-ok]").addEventListener("click", () => close(true));
    });
}

function viewSiteLink(href, label = "查看前台页面") {
    return `
        <a class="small-btn" href="${escapeAttr(href)}" target="_blank" rel="noopener">
            <i class="fas fa-arrow-up-right-from-square"></i> ${label}
        </a>
    `;
}

function saveTimeText() {
    return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function normalizeCommaFields() {
    content.doctors.forEach(doctor => {
        if (typeof doctor.tags === "string") doctor.tags = doctor.tags.replace(/，/g, ",");
    });
    content.specialties.forEach(item => {
        if (typeof item.tags === "string") item.tags = item.tags.replace(/，/g, ",");
        if (typeof item.doctorNames === "string") item.doctorNames = item.doctorNames.replace(/，/g, ",");
    });
}

function getByPath(path) {
    const parts = path.split(".");
    let target = content;
    while (parts.length > 1) {
        const part = parts.shift();
        if (target == null) return undefined;
        target = target[part];
    }
    return target ? target[parts[0]] : undefined;
}

function refreshImageField(path, value) {
    const input = document.querySelector(`input[data-image-path="${CSS.escape(path)}"]`);
    if (!input) return;
    const picker = input.closest(".image-picker");
    if (!picker) return;

    const preview = picker.querySelector(".image-preview");
    const src = assetSrc(value);
    if (preview) {
        preview.innerHTML = src
            ? `<img src="${escapeAttr(src)}" alt="">`
            : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`;
    }

    const actions = picker.querySelector(".image-picker-actions");
    if (!actions) return;
    const clearButton = actions.querySelector("[data-clear-image]");
    if (value && !clearButton) {
        const button = document.createElement("button");
        button.className = "ghost-btn";
        button.type = "button";
        button.dataset.clearImage = path;
        button.innerHTML = `<i class="fas fa-xmark"></i> 清除`;
        actions.appendChild(button);
    } else if (!value && clearButton) {
        clearButton.remove();
    }
}

function normalizeContent(raw) {
    const site = { ...fallbackContent.site, ...(raw.site || {}) };
    delete site.icpText;
    delete site.mapLng;
    delete site.mapLat;

    const doctors = Array.isArray(raw.doctors)
        ? raw.doctors.map(({ featured, ...doctor }) => doctor)
        : [];

    return {
        ...clone(fallbackContent),
        ...raw,
        site,
        home: { ...fallbackContent.home, ...(raw.home || {}) },
        doctors,
        specialties: Array.isArray(raw.specialties) ? raw.specialties : [],
        articles: Array.isArray(raw.articles) ? raw.articles : []
    };
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cannot load ${url}`);
    return response.json();
}

async function fetchFirstJson(urls) {
    let lastError = null;
    for (const url of urls) {
        try {
            return { url, data: await fetchJson(url) };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("Cannot load content");
}

function authHeaders(extra = {}) {
    return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

function clearAuth() {
    authToken = "";
    authExpiresAt = 0;
    authUser = "";
    localStorage.removeItem("here-dental-auth-token");
    localStorage.removeItem("here-dental-auth-expires");
    localStorage.removeItem("here-dental-auth-user");
}

function showCurrentUser() {
    if (!authRequired || !authUser) {
        currentUserEl.hidden = true;
        return;
    }
    currentUserEl.hidden = false;
    currentUserNameEl.textContent = authUser;
}

// 探测服务端鉴权状态：已登录返回 true；需要登录返回 false（并弹遮罩）；
// 服务不可达（静态模式 / 旧部署无 auth 接口）时视为无需鉴权。
async function checkAuthStatus() {
    if (authToken && authExpiresAt > Date.now()) {
        authRequired = true;
        return true;
    }

    let lastError = null;
    for (const url of authUrls) {
        try {
            const response = await fetch(url, { cache: "no-store", headers: authHeaders() });
            if (response.status === 200) {
                authRequired = true;
                return true;
            }
            if (response.status === 503) {
                setState("服务端尚未配置管理员密码（SITE_ADMIN_PASSWORD）", "error");
            }
            authRequired = true;
            clearAuth();
            return false;
        } catch (error) {
            lastError = error;
        }
    }
    authRequired = false;
    return true;
}

async function performLogin(username, password) {
    let lastError = null;
    for (const url of authUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const text = await response.text();
            let data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch (parseError) {
                data = {};
            }
            if (!response.ok) throw new Error(data.error || "登录失败");
            authToken = data.token || "";
            authExpiresAt = Number(data.expiresAt || 0);
            authUser = data.user || "管理员";
            if (authToken) {
                localStorage.setItem("here-dental-auth-token", authToken);
                localStorage.setItem("here-dental-auth-expires", String(authExpiresAt));
                localStorage.setItem("here-dental-auth-user", authUser);
            }
            authRequired = true;
            return true;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("登录失败");
}

function handleUnauthorized() {
    clearAuth();
    logoutBtn.hidden = true;
    showLoginOverlay("登录已过期，请重新输入密码");
}

function showLoginOverlay(message = "") {
    if (document.getElementById("loginOverlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "login-overlay";
    overlay.id = "loginOverlay";
    overlay.innerHTML = `
        <div class="login-card" role="dialog" aria-modal="true">
            <img src="../images/01_logo.png" alt="惠尔口腔">
            <h2>惠尔口腔 · 内容管理</h2>
            <p class="login-desc">请输入账号密码继续操作</p>
            <form id="loginForm">
                <input type="text" id="loginUsername" placeholder="账号" autocomplete="username">
                <input type="password" id="loginPassword" placeholder="密码" autocomplete="current-password">
                <button class="primary-btn" type="submit">
                    <i class="fas fa-unlock"></i> 进入后台
                </button>
            </form>
            <p class="login-error" id="loginError">${escapeHtml(message)}</p>
        </div>
    `;
    document.body.appendChild(overlay);

    const usernameInput = overlay.querySelector("#loginUsername");
    const passwordInput = overlay.querySelector("#loginPassword");
    overlay.querySelector("#loginForm").addEventListener("submit", async event => {
        event.preventDefault();
        const errorEl = overlay.querySelector("#loginError");
        const submitButton = overlay.querySelector("button[type=submit]");
        submitButton.disabled = true;
        errorEl.textContent = "";
        try {
            await performLogin(usernameInput.value.trim(), passwordInput.value);
            overlay.remove();
            logoutBtn.hidden = false;
            showCurrentUser();
            setState(`登录成功，当前用户：${authUser}`, "ok");
        } catch (error) {
            errorEl.textContent = error.message || "登录失败";
            passwordInput.select();
        } finally {
            submitButton.disabled = false;
        }
    });
    usernameInput.focus();
}

function contentScore(value) {
    if (!value) return 0;
    return [
        value.doctors,
        value.specialties,
        value.articles,
        value.home && value.home.heroSlides
    ].reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function contentTimestamp(value) {
    const time = Date.parse(value && value.updatedAt);
    return Number.isFinite(time) ? time : 0;
}

function shouldUseLocalDraft(localDraft, staticContent) {
    if (!localDraft) return false;

    const localTime = contentTimestamp(localDraft);
    const staticTime = contentTimestamp(staticContent);

    if (localTime && staticTime) return localTime > staticTime;
    if (localTime && !staticTime) return true;

    return contentScore(localDraft) > contentScore(staticContent);
}

function normalizeConsultations(raw) {
    const items = Array.isArray(raw && raw.items)
        ? raw.items
        : Array.isArray(raw)
            ? raw
            : [];

    return items
        .filter(Boolean)
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

async function loadConsultations(showState = true) {
    consultationsLoading = true;
    if (showState) setState("正在读取咨询信息");

    try {
        const apiConsultations = await fetchFirstJson(consultationUrls);
        consultationApiUrl = apiConsultations.url;
        consultations = normalizeConsultations(apiConsultations.data);
        consultationsLoaded = true;
        if (showState) setState("咨询信息已读取", "ok");
    } catch (error) {
        consultations = [];
        consultationsLoaded = showState || activeModule === "consultations";
        if (showState || activeModule === "consultations") {
            setState(error.message || "咨询信息读取失败", "error");
        }
    } finally {
        consultationsLoading = false;
        renderNav();
        if (activeModule === "consultations") renderConsultations();
    }
}

async function loadContent() {
    dirty = false;
    saveBtn.classList.remove("is-dirty");
    setState("正在读取内容");
    try {
        const apiContent = await fetchFirstJson(apiUrls);
        apiUrl = apiContent.url;
        content = normalizeContent(apiContent.data);
        apiMode = true;
        setState("已连接保存服务", "ok");
    } catch (error) {
        apiMode = false;

        const saved = localStorage.getItem("here-dental-admin-content");
        let localDraft = null;
        if (saved) {
            try {
                localDraft = normalizeContent(JSON.parse(saved));
            } catch (draftError) {
                localStorage.removeItem("here-dental-admin-content");
            }
        }

        try {
            const staticContent = normalizeContent((await fetchFirstJson(staticContentUrls)).data);
            const useLocalDraft = shouldUseLocalDraft(localDraft, staticContent);
            content = useLocalDraft ? localDraft : staticContent;
            setState(useLocalDraft ? "修改只保存在本机，前台和其他设备不会同步" : "已读取静态内容，保存仅留在本机", "error");
        } catch (staticError) {
            content = localDraft || normalizeContent(fallbackContent);
            setState(localDraft ? "修改只保存在本机，前台和其他设备不会同步" : "数据读取失败，已使用默认内容", "error");
        }
    }
    render();
    loadConsultations(false);
}

async function saveContent() {
    normalizeCommaFields();
    content.updatedAt = new Date().toISOString();
    const saveRevision = revision;
    if (!apiMode) {
        localStorage.setItem("here-dental-admin-content", JSON.stringify(content));
        dirty = false;
        saveBtn.classList.remove("is-dirty");
        setState(`本地草稿已保存（${saveTimeText()}），未写入服务器`, "error");
        return;
    }

    setState("正在保存");
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(content)
        });
        if (response.status === 401) handleUnauthorized();
        if (!response.ok) {
            const text = await response.text();
            let message = text;
            try {
                message = JSON.parse(text).error || message;
            } catch (parseError) {
                // Keep the raw response text.
            }
            throw new Error(message);
        }
        content = normalizeContent(await response.json());
        if (revision === saveRevision) {
            clearDirty();
            setState(`内容已保存（${saveTimeText()}）`, "ok");
        } else {
            setState(`内容已保存（${saveTimeText()}），保存期间的新修改还未保存`, "warn");
        }
    } catch (error) {
        setState(error.message || "保存失败", "error");
        saveBtn.classList.add("save-error");
        setTimeout(() => saveBtn.classList.remove("save-error"), 2500);
        console.error(error);
    }
}

function render() {
    try {
        history.replaceState(null, "", `#${activeModule}`);
    } catch (hashError) {
        // 静态文件环境下 history 可能受限，忽略即可
    }
    renderNav();
    const module = modules.find(item => item.id === activeModule);
    titleEl.textContent = module ? module.label : "内容管理";
    saveBtn.hidden = activeModule === "consultations" || activeModule === "editLog";

    if (activeModule === "settings") renderSettings();
    if (activeModule === "home") renderHome();
    if (activeModule === "doctors" || activeModule === "specialties") renderCollectionCards(activeModule);
    if (activeModule === "articles") renderArticles();
    if (activeModule === "consultations") renderConsultations();
    if (activeModule === "editLog") renderEditLog();
}

function renderNav() {
    const unhandledCount = consultations.filter(item => item.status !== "handled").length;
    navEl.innerHTML = modules.map(item => `
        <button type="button" class="${activeModule === item.id ? "active" : ""}" data-module="${item.id}">
            <i class="fas ${item.icon}"></i>
            ${item.label}
            ${item.id === "consultations" && unhandledCount > 0 ? `<span class="nav-badge">${unhandledCount}</span>` : ""}
        </button>
    `).join("");
}

function panelHead(title, desc, action = "") {
    return `
        <div class="panel-head">
            <div>
                <h2>${title}</h2>
                <p>${desc}</p>
            </div>
            ${action}
        </div>
    `;
}

function field(label, value, path, type = "text", wide = false) {
    const safeValue = escapeAttr(value);
    return `
        <label class="field ${wide ? "field-wide" : ""}">
            <span>${label}</span>
            <input type="${type}" value="${safeValue}" data-path="${path}">
        </label>
    `;
}

function textarea(label, value, path, wide = true) {
    return `
        <label class="field ${wide ? "field-wide" : ""}">
            <span>${label}</span>
            <textarea data-path="${path}">${escapeHtml(value)}</textarea>
        </label>
    `;
}

function imageField(label, value, path, wide = false) {
    const safePath = escapeAttr(path);
    const src = assetSrc(value);
    return `
        <div class="field image-field ${wide ? "field-wide" : ""}">
            <span>${label}</span>
            <div class="image-picker">
                <div class="image-preview">
                    ${src
                        ? `<img src="${escapeAttr(src)}" alt="">`
                        : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`}
                </div>
                <div class="image-picker-main">
                    <div class="image-picker-actions">
                        <label class="small-btn file-btn">
                            <i class="fas fa-folder-open"></i>
                            选择图片
                            <input class="image-file-input" type="file" accept="image/*" data-image-path="${safePath}">
                        </label>
                        ${value ? `
                            <button class="ghost-btn" type="button" data-clear-image="${safePath}">
                                <i class="fas fa-xmark"></i>
                                清除
                            </button>
                        ` : ""}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderSettings() {
    panelEl.innerHTML = `
        ${panelHead("全站设置", "管理全站公共联系方式和地址。", viewSiteLink("../home.html"))}
        <div class="form-grid">
            ${field("网站名称", content.site.name, "site.name")}
            ${field("品牌口号", content.site.slogan, "site.slogan")}
            ${field("联系电话", content.site.phone, "site.phone")}
            ${field("电子邮箱", content.site.email, "site.email")}
            ${field("营业时间", content.site.hours, "site.hours", "text", true)}
            ${field("诊所地址", content.site.address, "site.address", "text", true)}
        </div>
    `;
}

function renderHome() {
    panelEl.innerHTML = `
        ${panelHead("首页内容", "管理首页轮播、品牌理念和预约引导。", `
            <button class="small-btn" type="button" data-carousel-add>
                <i class="fas fa-plus"></i>
                添加轮播
            </button>
            ${viewSiteLink("../home.html")}
        `)}
        <div class="form-grid">
            ${field("理念标题", content.home.philosophyTitle, "home.philosophyTitle")}
            ${field("预约按钮", content.home.ctaButton, "home.ctaButton")}
            ${textarea("理念文案", content.home.philosophyText, "home.philosophyText")}
            ${textarea("底部预约标题", content.home.ctaTitle, "home.ctaTitle")}
        </div>
        <div class="data-table-wrap">
            <div id="carouselTableContainer"></div>
        </div>
    `;
    renderCarouselTable();
}

function renderCarouselTable() {
    const container = document.getElementById("carouselTableContainer");
    if (!container) return;

    const slides = content.home.heroSlides;
    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>图片</th>
                    <th>标题</th>
                    <th>说明</th>
                    <th>状态</th>
                    <th class="col-actions">操作</th>
                </tr>
            </thead>
            <tbody>
                ${slides.length ? slides.map((slide, index) => `
                    <tr>
                        <td>
                            ${slide.image
                                ? `<img class="table-thumb" src="${escapeAttr(assetSrc(slide.image))}" alt="">`
                                : `<span class="badge badge-muted">无图</span>`}
                        </td>
                        <td class="cell-title" title="${escapeAttr(slide.title || "")}">${escapeHtml(slide.title || "未命名轮播")}</td>
                        <td>${escapeHtml(slide.alt || "-")}</td>
                        <td><span class="badge ${slide.visible ? "badge-ok" : "badge-muted"}">${slide.visible ? "显示" : "隐藏"}</span></td>
                        <td class="col-actions">
                            <button class="ghost-btn btn-sm" type="button" data-carousel-edit="${index}">
                                <i class="fas fa-pen"></i> 编辑
                            </button>
                            <button class="danger-btn btn-sm" type="button" data-carousel-delete="${index}">
                                <i class="fas fa-trash"></i> 删除
                            </button>
                        </td>
                    </tr>
                `).join("") : `
                    <tr><td colspan="5" class="empty-row">暂无轮播图</td></tr>
                `}
            </tbody>
        </table>
    `;
}

function openCarouselEditor(index) {
    carouselEditorIndex = index == null ? null : Number(index);
    renderCarouselEditor();
}

function closeCarouselEditor() {
    carouselEditorIndex = null;
    document.removeEventListener("keydown", onCarouselModalKeydown);
    const modal = document.getElementById("carouselModal");
    if (modal) modal.remove();
}

function onCarouselModalKeydown(event) {
    if (event.key === "Escape") closeCarouselEditor();
}

function renderCarouselEditor() {
    const editing = carouselEditorIndex != null;
    const slide = editing ? content.home.heroSlides[carouselEditorIndex] : null;
    carouselImageValue = (slide && slide.image) || "";
    const imageSrc = carouselImageValue ? assetSrc(carouselImageValue) : "";

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "carouselModal";
    modal.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div>
                    <h3>${editing ? "编辑轮播" : "添加轮播"}</h3>
                    <p>轮播图展示在首页顶部，最多建议 3-4 张。</p>
                </div>
            </div>
            <div class="modal-body">
                <label class="field field-wide">
                    <span>轮播标题</span>
                    <input id="carouselTitle" maxlength="60" value="${escapeAttr(slide ? slide.title : "")}" placeholder="请输入轮播标题">
                </label>
                <div class="field field-wide image-field">
                    <span>轮播图片</span>
                    <div class="image-picker">
                        <div class="image-preview" id="carouselImagePreview">
                            ${imageSrc
                                ? `<img src="${escapeAttr(imageSrc)}" alt="">`
                                : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`}
                        </div>
                        <div class="image-picker-main">
                            <div class="image-picker-actions">
                                <label class="small-btn file-btn">
                                    <i class="fas fa-folder-open"></i>
                                    选择图片
                                    <input class="image-file-input" type="file" id="carouselImageFile" accept="image/*">
                                </label>
                                <button class="ghost-btn" type="button" id="carouselImageClear" ${carouselImageValue ? "" : "hidden"}>
                                    <i class="fas fa-xmark"></i> 清除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <label class="field field-wide">
                    <span>图片说明</span>
                    <input id="carouselAlt" maxlength="100" value="${escapeAttr(slide ? slide.alt : "")}" placeholder="轮播图的替代文字，可留空">
                </label>
                <div class="field-wide">
                    <label class="switch-field">
                        <input type="checkbox" id="carouselVisible" ${slide && slide.visible !== false ? "checked" : ""}>
                        在首页显示该轮播
                    </label>
                </div>
            </div>
            <div class="modal-foot">
                <button class="ghost-btn" type="button" id="carouselCancelBtn">取消</button>
                <button class="primary-btn" type="button" id="carouselSaveBtn">
                    <i class="fas fa-floppy-disk"></i> 保存轮播
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.addEventListener("keydown", onCarouselModalKeydown);

    modal.addEventListener("click", event => {
        if (event.target === modal) closeCarouselEditor();
    });
    document.getElementById("carouselCancelBtn").addEventListener("click", closeCarouselEditor);
    document.getElementById("carouselSaveBtn").addEventListener("click", saveCarouselSlide);
    document.getElementById("carouselImageClear").addEventListener("click", () => {
        carouselImageValue = "";
        updateCarouselImagePreview();
    });
    document.getElementById("carouselImageFile").addEventListener("change", handleCarouselImageFile);
    document.getElementById("carouselTitle").focus();
}

function updateCarouselImagePreview() {
    const preview = document.getElementById("carouselImagePreview");
    const clearButton = document.getElementById("carouselImageClear");
    if (preview) {
        preview.innerHTML = carouselImageValue
            ? `<img src="${escapeAttr(assetSrc(carouselImageValue))}" alt="">`
            : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`;
    }
    if (clearButton) clearButton.hidden = !carouselImageValue;
}

async function handleCarouselImageFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
        setState("请选择图片文件", "error");
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        setState("图片不能超过 10MB", "error");
        return;
    }
    if (!apiMode) {
        setState("请通过本地服务或部署后的后台上传图片", "error");
        return;
    }

    setState("正在上传图片");
    try {
        carouselImageValue = await uploadImage(file);
        updateCarouselImagePreview();
        setState("图片已上传，保存轮播后生效", "ok");
    } catch (error) {
        setState(error.message || "图片上传失败", "error");
        console.error(error);
    }
}

async function saveCarouselSlide() {
    const title = document.getElementById("carouselTitle").value.trim() || "新轮播";
    const slide = {
        title,
        image: carouselImageValue,
        alt: document.getElementById("carouselAlt").value.trim(),
        visible: document.getElementById("carouselVisible").checked
    };
    if (carouselEditorIndex == null) {
        content.home.heroSlides.push(slide);
    } else {
        content.home.heroSlides[carouselEditorIndex] = slide;
    }
    closeCarouselEditor();
    await saveContent();
    render();
}

async function removeCarouselSlide(index) {
    if (!(await confirmDialog("确定删除这张轮播图？此操作不可恢复。", { okText: "删除" }))) return;
    content.home.heroSlides.splice(index, 1);
    markDirty();
    render();
}

function getCollectionConfig(type) {
    return {
        doctors: {
            title: "医生管理",
            desc: "医生以缩略名片展示，点击名片展开详情编辑。",
            addText: "添加医生",
            titleKey: "name",
            subKey: "title",
            mediaKey: "avatar",
            mediaShape: "round",
            mediaIcon: "fa-user-doctor",
            fields: [
                ["姓名", "name"],
                ["职称", "title"],
                ["头像/海报", "avatar", "image"],
                ["擅长标签（用逗号分隔）", "tags"],
                ["简介", "summary", "textarea"]
            ],
            defaultItem: { name: "新医生", title: "医生", avatar: "", href: "team.html", tags: "", summary: "", visible: true },
            switches: [["显示", "visible"]]
        },
        specialties: {
            title: "专科管理",
            desc: "专科以缩略名片展示，点击名片展开详情编辑。",
            addText: "添加专科",
            titleKey: "name",
            subKey: "subtitle",
            mediaKey: "cover",
            mediaShape: "square",
            mediaIcon: "fa-tooth",
            fields: [
                ["专科名称", "name"],
                ["副标题", "subtitle"],
                ["封面图", "cover", "image"],
                ["详情页链接", "href"],
                ["标签（用逗号分隔）", "tags"],
                ["关联医生（用逗号分隔）", "doctorNames"],
                ["简介", "summary", "textarea"]
            ],
            defaultItem: { name: "新专科", subtitle: "", cover: "", href: "specialties.html", tags: "", doctorNames: "", summary: "", visible: true },
            switches: [["显示", "visible"]]
        }
    }[type];
}

function renderCollectionCards(type) {
    const config = getCollectionConfig(type);
    const list = content[type];
    if (collectionOpenIndex != null && collectionOpenIndex >= list.length) collectionOpenIndex = null;
    panelEl.innerHTML = `
        ${panelHead(config.title, config.desc, `
            <button class="small-btn" type="button" data-add="${type}">
                <i class="fas fa-plus"></i>
                ${config.addText}
            </button>
            ${viewSiteLink(type === "doctors" ? "../team.html" : "../specialties.html")}
        `)}
        <div class="card-grid">
            ${list.length ? list.map((item, index) =>
                index === collectionOpenIndex
                    ? renderCollectionDetail(type, item, index, config)
                    : renderCollectionCard(type, item, index, config)
            ).join("") : `<div class="empty-state">暂无${config.title}，点击右上角「${config.addText}」创建。</div>`}
        </div>
    `;
}

function renderCollectionCard(type, item, index, config) {
    const visible = item.visible !== false;
    const mediaSrc = assetSrc(item[config.mediaKey]);
    const mediaShape = config.mediaShape === "round" ? "round" : "square";
    const tags = String(item.tags || "").split(",").map(tag => tag.trim()).filter(Boolean);
    const sub = config.subKey ? item[config.subKey] || "" : "";
    return `
        <article class="mini-card" data-card-toggle="${index}">
            <div class="mini-card-head">
                ${mediaSrc
                    ? `<img class="mini-card-media ${mediaShape}" src="${escapeAttr(mediaSrc)}" alt="">`
                    : `<div class="mini-card-media ${mediaShape} mini-card-media-empty"><i class="fas ${config.mediaIcon}"></i></div>`}
                <div class="mini-card-info">
                    <div class="mini-card-title">
                        <strong>${escapeHtml(item.name || "未命名内容")}</strong>
                        <span class="badge ${visible ? "badge-ok" : "badge-muted"}">${visible ? "显示" : "隐藏"}</span>
                    </div>
                    ${sub ? `<div class="mini-card-sub">${escapeHtml(sub)}</div>` : ""}
                </div>
            </div>
            <div class="mini-tags">
                ${tags.length
                    ? tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")
                    : `<span class="mini-tags-empty">暂无标签</span>`}
            </div>
            ${item.summary ? `<p class="mini-card-summary">${escapeHtml(item.summary)}</p>` : ""}
            <div class="mini-card-actions">
                <span class="mini-card-hint"><i class="fas fa-chevron-down"></i> 点击展开详情</span>
            </div>
        </article>
    `;
}

function renderCollectionDetail(type, item, index, config) {
    return `
        <article class="mini-card mini-card-expanded">
            <div class="detail-head">
                <strong><i class="fas ${config.mediaIcon}"></i> ${escapeHtml(item.name || "未命名内容")} · 编辑详情</strong>
                <div class="detail-actions">
                    <button class="danger-btn btn-sm" type="button" data-remove="${type}" data-index="${index}">
                        <i class="fas fa-trash"></i> 删除
                    </button>
                    <button class="ghost-btn btn-sm" type="button" data-card-close>
                        <i class="fas fa-chevron-up"></i> 收起
                    </button>
                </div>
            </div>
            <div class="form-grid">
                ${config.fields.map(([label, key, kind]) => {
                    const path = `${type}.${index}.${key}`;
                    if (kind === "textarea") return textarea(label, item[key], path);
                    if (kind === "image") return imageField(label, item[key], path, true);
                    return field(label, item[key], path, "text", false);
                }).join("")}
                <div class="field-wide">
                    ${config.switches.map(([label, key]) => `
                        <label class="switch-field">
                            <input type="checkbox" ${item[key] ? "checked" : ""} data-path="${type}.${index}.${key}" data-boolean="true">
                            ${label}
                        </label>
                    `).join("")}
                </div>
            </div>
        </article>
    `;
}

function toggleCollectionCard(type, index) {
    collectionOpenIndex = collectionOpenIndex === index ? null : index;
    renderCollectionCards(type);
    if (collectionOpenIndex != null) {
        const detail = panelEl.querySelector(".mini-card-expanded");
        if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "未知时间";

    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

function filteredConsultations() {
    const keyword = consultationSearch.trim().toLowerCase();
    return consultations
        .filter(item => {
            if (consultationFilter === "new" && item.status === "handled") return false;
            if (consultationFilter === "handled" && item.status !== "handled") return false;
            if (keyword) {
                const name = String(item.name || "").toLowerCase();
                const phone = String(item.phone || "").toLowerCase();
                if (!name.includes(keyword) && !phone.includes(keyword)) return false;
            }
            return true;
        })
        .sort((a, b) => (a.status === "handled" ? 1 : 0) - (b.status === "handled" ? 1 : 0));
}

function renderConsultations() {
    if (!consultationsLoaded && !consultationsLoading) {
        loadConsultations();
    }

    const action = `
        <button class="small-btn" type="button" data-refresh-consultations>
            <i class="fas fa-rotate-right"></i>
            刷新
        </button>
    `;

    const filtered = filteredConsultations();
    const body = consultationsLoading
        ? `<div class="empty-state">正在读取咨询信息</div>`
        : filtered.length
            ? `<div class="consultation-list">${filtered.map(renderConsultationItem).join("")}</div>`
            : consultations.length
                ? `<div class="empty-state">没有匹配的咨询信息</div>`
                : `<div class="empty-state">暂无咨询信息</div>`;

    panelEl.innerHTML = `
        ${panelHead("咨询信息", "接收前台在线预约提交的姓名、电话、项目、期望日期和备注。", action)}
        <div class="list-toolbar">
            <input type="search" id="consultationSearch" placeholder="搜索姓名或电话…" value="${escapeAttr(consultationSearch)}">
            <select id="consultationFilter">
                <option value="all" ${consultationFilter === "all" ? "selected" : ""}>全部状态</option>
                <option value="new" ${consultationFilter === "new" ? "selected" : ""}>未处理</option>
                <option value="handled" ${consultationFilter === "handled" ? "selected" : ""}>已处理</option>
            </select>
        </div>
        ${body}
    `;
}

function renderConsultationItem(item) {
    const handled = item.status === "handled";
    const phone = String(item.phone || "");
    const tel = phone.replace(/[^\d+]/g, "");
    const statusText = handled ? "已处理" : "未处理";
    const nextStatus = handled ? "new" : "handled";
    const nextText = handled ? "标记未处理" : "标记已处理";
    const dateText = item.date ? escapeHtml(item.date) : "未填写";
    const typeText = item.type ? escapeHtml(item.type) : "未选择";
    const pageText = item.page ? escapeHtml(item.page) : "未知来源";
    const message = item.message ? escapeHtml(item.message) : "未填写备注";

    return `
        <article class="consultation-item ${handled ? "handled" : ""}">
            <div class="consultation-head">
                <div>
                    <strong>${escapeHtml(item.name || "未填写姓名")}</strong>
                    ${phone ? `<a href="tel:${escapeAttr(tel)}">${escapeHtml(phone)}</a>` : ""}
                </div>
                <span class="consultation-status ${handled ? "handled" : "new"}">${statusText}</span>
            </div>
            <div class="consultation-meta">
                <span><i class="fas fa-tooth"></i>${typeText}</span>
                <span><i class="fas fa-calendar-day"></i>${dateText}</span>
                <span><i class="fas fa-clock"></i>${formatDateTime(item.createdAt)}</span>
                <span><i class="fas fa-location-dot"></i>${pageText}</span>
            </div>
            <p class="consultation-message">${message}</p>
            <div class="consultation-actions">
                <button class="small-btn" type="button" data-consultation-status="${escapeAttr(item.id)}" data-status="${nextStatus}">
                    <i class="fas fa-check"></i>
                    ${nextText}
                </button>
                <button class="danger-btn" type="button" data-remove-consultation="${escapeAttr(item.id)}">
                    <i class="fas fa-trash"></i>
                    删除
                </button>
            </div>
        </article>
    `;
}

function setByPath(path, value) {
    const parts = path.split(".");
    let target = content;
    while (parts.length > 1) {
        const part = parts.shift();
        target = target[part];
    }
    target[parts[0]] = value;
}

function addItem(path) {
    content[path].push(clone(getCollectionConfig(path).defaultItem));
    if (path === "doctors" || path === "specialties") collectionOpenIndex = content[path].length - 1;
    markDirty();
    render();
    const items = panelEl.querySelectorAll(".mini-card-expanded");
    const last = items[items.length - 1];
    if (last) last.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function removeItem(path, index) {
    const label = path === "doctors" ? "这位医生" : path === "specialties" ? "这个专科" : "这项内容";
    if (!(await confirmDialog(`确定删除${label}？此操作不可恢复。`, { okText: "删除" }))) return;

    const segments = path.split(".");
    let list = content;
    segments.forEach(segment => { list = list[segment]; });
    list.splice(Number(index), 1);
    markDirty();
    render();
}

const defaultArticleCategories = [
    "口腔科普", "牙齿矫正", "牙齿种植", "牙齿修复", "牙齿美容",
    "儿童牙科", "牙周治疗", "牙体牙髓", "微创拔牙", "牙齿全科"
];

function articleCategories() {
    const seen = new Set(defaultArticleCategories);
    const list = [...defaultArticleCategories];
    content.articles.forEach(article => {
        const category = article.category;
        if (category && !seen.has(category)) {
            seen.add(category);
            list.push(category);
        }
    });
    return list;
}

function filteredArticles() {
    const keyword = articleSearch.trim().toLowerCase();
    return content.articles
        .map((article, index) => ({ article, index }))
        .filter(({ article }) => !keyword || String(article.title || "").toLowerCase().includes(keyword))
        .filter(({ article }) => articleCategoryFilter === "all" || article.category === articleCategoryFilter)
        .sort((a, b) => String(b.article.date || "").localeCompare(String(a.article.date || "")));
}

function renderArticles() {
    panelEl.innerHTML = `
        ${panelHead("科普文章", "管理文章发布流程：新文章默认为草稿，发布后前台可见。", `
            <button class="small-btn" type="button" data-article-add>
                <i class="fas fa-plus"></i>
                添加文章
            </button>
            ${viewSiteLink("../knowledge.html")}
        `)}
        <div class="list-toolbar">
            <input type="search" id="articleSearch" placeholder="搜索文章标题…" value="${escapeAttr(articleSearch)}">
            <select id="articleCategoryFilter">
                <option value="all">全部分类</option>
                ${articleCategories().map(category => `
                    <option value="${escapeAttr(category)}" ${articleCategoryFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>
                `).join("")}
            </select>
        </div>
        <div class="data-table-wrap">
            <div id="articleTableContainer"></div>
        </div>
    `;
    renderArticleTable();
}

function renderArticleTable() {
    const container = document.getElementById("articleTableContainer");
    if (!container) return;

    const filtered = filteredArticles();
    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>标题</th>
                    <th>分类</th>
                    <th>发布时间</th>
                    <th>状态</th>
                    <th class="col-actions">操作</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.length ? filtered.map(({ article, index }) => `
                    <tr>
                        <td class="cell-title" title="${escapeAttr(article.title || "")}">${escapeHtml(article.title || "未命名文章")}</td>
                        <td>${escapeHtml(article.category || "-")}</td>
                        <td>${escapeHtml(article.date || "-")}</td>
                        <td><span class="badge ${article.visible ? "badge-ok" : "badge-muted"}">${article.visible ? "已发布" : "草稿"}</span></td>
                        <td class="col-actions">
                            <button class="ghost-btn btn-sm" type="button" data-article-edit="${index}">
                                <i class="fas fa-pen"></i> 编辑
                            </button>
                            <button class="danger-btn btn-sm" type="button" data-article-delete="${index}">
                                <i class="fas fa-trash"></i> 删除
                            </button>
                        </td>
                    </tr>
                `).join("") : `
                    <tr><td colspan="5" class="empty-row">没有匹配的文章</td></tr>
                `}
            </tbody>
        </table>
    `;
}

function openArticleEditor(index) {
    articleEditorIndex = index == null ? null : Number(index);
    renderArticleEditor();
}

function closeArticleEditor() {
    articleEditorIndex = null;
    document.removeEventListener("keydown", onArticleModalKeydown);
    const modal = document.getElementById("articleModal");
    if (modal) modal.remove();
}

function onArticleModalKeydown(event) {
    if (event.key === "Escape") closeArticleEditor();
}

function renderArticleEditor() {
    const editing = articleEditorIndex != null;
    const article = editing ? content.articles[articleEditorIndex] : null;
    articleCoverValue = (article && article.image) || "";
    const categories = articleCategories();
    const currentCategory = (article && article.category) || "口腔科普";
    const coverSrc = articleCoverValue ? assetSrc(articleCoverValue) : "";

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "articleModal";
    modal.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div>
                    <h3>${editing ? "编辑文章" : "添加文章"}</h3>
                    <p>${editing ? "修改后保存，前台按发布状态更新。" : "新文章默认为草稿，保存后可随时发布。"}</p>
                </div>
                <button class="ghost-btn" type="button" id="articlePreviewBtn">
                    <i class="fas fa-eye"></i> 预览
                </button>
            </div>
            <div class="modal-body">
                <label class="field field-wide">
                    <span>文章标题</span>
                    <input id="articleTitle" maxlength="100" value="${escapeAttr(article ? article.title : "")}" placeholder="请输入文章标题">
                </label>
                <label class="field">
                    <span>文章分类</span>
                    <select id="articleCategory">
                        ${categories.map(category => `
                            <option value="${escapeAttr(category)}" ${category === currentCategory ? "selected" : ""}>${escapeHtml(category)}</option>
                        `).join("")}
                    </select>
                </label>
                <div class="field field-wide image-field">
                    <span>封面图</span>
                    <div class="image-picker">
                        <div class="image-preview" id="articleCoverPreview">
                            ${coverSrc
                                ? `<img src="${escapeAttr(coverSrc)}" alt="">`
                                : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`}
                        </div>
                        <div class="image-picker-main">
                            <div class="image-picker-actions">
                                <label class="small-btn file-btn">
                                    <i class="fas fa-folder-open"></i>
                                    选择图片
                                    <input class="image-file-input" type="file" id="articleCoverFile" accept="image/*">
                                </label>
                                <button class="ghost-btn" type="button" id="articleCoverClear" ${articleCoverValue ? "" : "hidden"}>
                                    <i class="fas fa-xmark"></i> 清除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <label class="field field-wide">
                    <span>摘要</span>
                    <textarea id="articleSummary" rows="3" placeholder="用于列表页展示的简短介绍">${escapeHtml(article ? article.summary : "")}</textarea>
                </label>
                <label class="field field-wide">
                    <span>正文</span>
                    <textarea id="articleBody" rows="14" placeholder="正文内容，空行分段">${escapeHtml(article ? article.body : "")}</textarea>
                </label>
            </div>
            <div class="modal-foot">
                <span class="modal-foot-note">发布时间在首次保存时自动生成，不可修改</span>
                <button class="ghost-btn" type="button" id="articleCancelBtn">取消</button>
                <button class="ghost-btn" type="button" id="articleDraftBtn">
                    <i class="fas fa-pen-to-square"></i> 保存草稿
                </button>
                <button class="primary-btn" type="button" id="articlePublishBtn">
                    <i class="fas fa-paper-plane"></i> 发布文章
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.addEventListener("keydown", onArticleModalKeydown);

    modal.addEventListener("click", event => {
        if (event.target === modal) closeArticleEditor();
    });
    document.getElementById("articleCancelBtn").addEventListener("click", closeArticleEditor);
    document.getElementById("articleDraftBtn").addEventListener("click", () => saveArticle(false));
    document.getElementById("articlePublishBtn").addEventListener("click", () => saveArticle(true));
    document.getElementById("articlePreviewBtn").addEventListener("click", previewArticle);
    document.getElementById("articleCoverClear").addEventListener("click", () => {
        articleCoverValue = "";
        updateArticleCoverPreview();
    });
    document.getElementById("articleCoverFile").addEventListener("change", handleArticleCoverFile);
    document.getElementById("articleTitle").focus();
}

function updateArticleCoverPreview() {
    const preview = document.getElementById("articleCoverPreview");
    const clearButton = document.getElementById("articleCoverClear");
    if (preview) {
        preview.innerHTML = articleCoverValue
            ? `<img src="${escapeAttr(assetSrc(articleCoverValue))}" alt="">`
            : `<div class="image-preview-empty"><i class="fas fa-image"></i></div>`;
    }
    if (clearButton) clearButton.hidden = !articleCoverValue;
}

async function handleArticleCoverFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
        setState("请选择图片文件", "error");
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        setState("图片不能超过 10MB", "error");
        return;
    }
    if (!apiMode) {
        setState("请通过本地服务或部署后的后台上传图片", "error");
        return;
    }

    setState("正在上传图片");
    try {
        articleCoverValue = await uploadImage(file);
        updateArticleCoverPreview();
        setState("图片已上传，保存文章后生效", "ok");
    } catch (error) {
        setState(error.message || "图片上传失败", "error");
        console.error(error);
    }
}

function readArticleForm() {
    return {
        title: document.getElementById("articleTitle").value.trim(),
        category: document.getElementById("articleCategory").value,
        summary: document.getElementById("articleSummary").value,
        body: document.getElementById("articleBody").value,
        image: articleCoverValue
    };
}

function articleFromForm(values, visible) {
    const existing = articleEditorIndex != null ? { ...content.articles[articleEditorIndex] } : {};
    return {
        ...existing,
        ...values,
        visible,
        date: existing.date || new Date().toISOString().slice(0, 10),
        topic: existing.topic || `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    };
}

async function saveArticle(visible) {
    const values = readArticleForm();
    if (!values.title) {
        setState("请填写文章标题", "error");
        document.getElementById("articleTitle").focus();
        return;
    }

    const article = articleFromForm(values, visible);
    if (articleEditorIndex == null) {
        content.articles.push(article);
    } else {
        content.articles[articleEditorIndex] = article;
    }

    closeArticleEditor();
    await saveContent();
    render();
}

function previewArticle() {
    const values = readArticleForm();
    const existing = articleEditorIndex != null ? content.articles[articleEditorIndex] : null;
    const article = {
        ...(existing || {}),
        ...values,
        title: values.title || "未命名文章",
        sectionTitle: values.title || "未命名文章",
        topic: (existing && existing.topic) || `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        visible: true
    };
    localStorage.setItem("here-dental-article-preview", JSON.stringify(article));
    window.open(`../knowledge-detail.html?preview=1&t=${Date.now()}`, "_blank");
}

async function removeArticle(index) {
    if (!(await confirmDialog("确定删除这篇文章？此操作不可恢复。", { okText: "删除" }))) return;
    content.articles.splice(index, 1);
    markDirty();
    render();
}

function parentByPath(path) {
    const parts = path.split(".");
    parts.pop();
    let target = content;
    for (const part of parts) {
        if (target == null) return null;
        target = target[part];
    }
    return target;
}

function applyUploadedImageMetadata(path, fileName) {
    const parent = parentByPath(path);
    if (!parent || typeof parent !== "object") return;

    const baseName = String(fileName || "")
        .replace(/\.[^.]+$/, "")
        .trim();
    if (!baseName) return;

    if ("alt" in parent && !parent.alt) parent.alt = baseName;
}

async function uploadImage(file) {
    const formData = new FormData();
    formData.append("image", file);

    let lastError = null;
    for (const url of uploadUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: authHeaders(),
                body: formData
            });
            const text = await response.text();
            let payload = {};
            try {
                payload = text ? JSON.parse(text) : {};
            } catch (parseError) {
                payload = {};
            }

            if (response.status === 401) handleUnauthorized();
            if (!response.ok) {
                throw new Error(payload.error || text || "图片上传失败");
            }

            const imagePath = payload.path || payload.url;
            if (!imagePath) throw new Error("上传接口没有返回图片地址");
            return imagePath;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("图片上传失败");
}

async function handleImageSelection(input, path) {
    const file = input.files && input.files[0];
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
        setState("请选择图片文件", "error");
        input.value = "";
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        setState("图片不能超过 10MB", "error");
        input.value = "";
        return;
    }

    if (!apiMode) {
        setState("请通过本地服务或部署后的后台上传图片", "error");
        input.value = "";
        return;
    }

    setState("正在上传图片");
    try {
        const imagePath = await uploadImage(file);
        setByPath(path, imagePath);
        applyUploadedImageMetadata(path, file.name);
        refreshImageField(path, imagePath);
        markDirty();
        setState("图片已上传，请保存内容", "ok");
    } catch (error) {
        setState(error.message || "图片上传失败", "error");
        console.error(error);
    } finally {
        input.value = "";
    }
}

async function requestConsultations(method, payload = null, id = "") {
    const urls = [
        consultationApiUrl,
        ...consultationUrls.filter(url => url !== consultationApiUrl)
    ];
    let lastError = null;

    for (const url of urls) {
        try {
            const targetUrl = method === "DELETE"
                ? `${url}?id=${encodeURIComponent(id)}`
                : url;
            const options = { method, headers: authHeaders() };
            if (payload) {
                options.headers["Content-Type"] = "application/json";
                options.body = JSON.stringify(payload);
            }

            const response = await fetch(targetUrl, options);
            const text = await response.text();
            let data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch (parseError) {
                data = {};
            }

            if (response.status === 401) handleUnauthorized();
            if (!response.ok) {
                throw new Error(data.error || text || "咨询信息操作失败");
            }

            consultationApiUrl = url;
            consultations = normalizeConsultations(data);
            consultationsLoaded = true;
            renderNav();
            renderConsultations();
            return data;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("咨询信息操作失败");
}

async function loadEditLog(showState = true) {
    editLogLoading = true;
    if (showState) setState("正在读取编辑记录");

    try {
        const response = await fetchFirstJson(editLogUrls);
        const data = response.data || {};
        editLogItems = Array.isArray(data.items) ? data.items : [];
        editLogLoaded = true;
        if (showState) setState(editLogItems.length ? `共有 ${editLogItems.length} 条编辑记录` : "暂无编辑记录", "ok");
    } catch (error) {
        editLogItems = [];
        editLogLoaded = true;
        if (showState) setState("编辑记录读取失败，当前环境可能不支持", "error");
    } finally {
        editLogLoading = false;
        if (activeModule === "editLog") renderEditLog();
    }
}

function renderEditLog() {
    if (!editLogLoaded && !editLogLoading) {
        loadEditLog();
    }

    const action = `
        <button class="small-btn" type="button" data-refresh-edit-log>
            <i class="fas fa-rotate-right"></i>
            刷新
        </button>
    `;

    const body = editLogLoading
        ? `<div class="empty-state">正在读取编辑记录</div>`
        : editLogItems.length
            ? `<div class="edit-log-list">${editLogItems.map(renderEditLogItem).join("")}</div>`
            : `<div class="empty-state">暂无编辑记录</div>`;

    panelEl.innerHTML = `
        ${panelHead("编辑记录", "每次保存内容都会自动留下一条记录，方便回溯改动历史。", action)}
        ${body}
    `;
}

function renderEditLogItem(item) {
    const timeText = formatDateTime(item.time);
    const modules = Array.isArray(item.modules) ? item.modules : [];
    return `
        <article class="edit-log-item">
            <div class="edit-log-head">
                <div class="edit-log-title">
                    <strong>${escapeHtml(timeText)}</strong>
                    <span class="edit-log-user">
                        <i class="fas fa-user-shield"></i> ${escapeHtml(item.user || "管理员")}
                    </span>
                </div>
                ${item.backup ? `
                    <button class="small-btn" type="button" data-rollback="${escapeAttr(item.id)}" title="回退到这次修改之前的内容">
                        <i class="fas fa-rotate-left"></i> 回退到修改前
                    </button>
                ` : ""}
            </div>
            ${modules.length
                ? `<ul class="edit-log-changes">
                    ${modules.map(module => `<li>${escapeHtml(module)}</li>`).join("")}
                </ul>`
                : `<p class="edit-log-empty">内容无实质变化</p>`}
        </article>
    `;
}

async function rollbackEditLogItem(id) {
    const item = editLogItems.find(entry => entry.id === id);
    if (!item || !item.backup) return;
    const timeText = formatDateTime(item.time);

    if (!(await confirmDialog(`确定回退到 ${timeText} 修改之前的内容吗？当前内容会先自动备份一份，之后还可以改回来。`, { okText: "回退", danger: true }))) return;

    setState("正在回退");
    try {
        const endpoint = await fetchFirstJson(backupUrls);
        const response = await fetch(endpoint.url, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ action: "restore", file: item.backup })
        });
        if (response.status === 401) handleUnauthorized();
        if (!response.ok) {
            const text = await response.text();
            let message = text;
            try {
                message = JSON.parse(text).error || message;
            } catch (parseError) {
                // Keep the raw response text.
            }
            throw new Error(message);
        }
        await loadContent();
        await loadEditLog(false);
        setState(`已回退到 ${timeText} 修改之前的内容`, "ok");
    } catch (error) {
        setState(error.message || "回退失败，请确认当前环境支持回退", "error");
    }
}

async function updateConsultationStatus(id, status) {
    setState("正在更新咨询状态");
    try {
        await requestConsultations("PATCH", { id, status });
        setState("咨询状态已更新", "ok");
    } catch (error) {
        setState(error.message || "咨询状态更新失败", "error");
    }
}

async function removeConsultation(id) {
    if (!(await confirmDialog("确定删除这条咨询信息？", { okText: "删除" }))) return;

    setState("正在删除咨询信息");
    try {
        await requestConsultations("DELETE", null, id);
        setState("咨询信息已删除", "ok");
    } catch (error) {
        setState(error.message || "咨询信息删除失败", "error");
    }
}

document.addEventListener("input", event => {
    const searchInput = event.target.closest("#articleSearch");
    if (searchInput) {
        articleSearch = searchInput.value;
        clearTimeout(articleSearchTimer);
        articleSearchTimer = setTimeout(renderArticleTable, 250);
        return;
    }

    const consultationSearchInput = event.target.closest("#consultationSearch");
    if (consultationSearchInput) {
        consultationSearch = consultationSearchInput.value;
        clearTimeout(consultationSearchTimer);
        consultationSearchTimer = setTimeout(renderConsultations, 250);
        return;
    }

    const path = event.target.dataset.path;
    if (!path) return;
    setByPath(path, event.target.value);
    markDirty();
});

document.addEventListener("change", event => {
    const categoryFilter = event.target.closest("#articleCategoryFilter");
    if (categoryFilter) {
        articleCategoryFilter = categoryFilter.value;
        renderArticleTable();
        return;
    }

    const consultationFilterEl = event.target.closest("#consultationFilter");
    if (consultationFilterEl) {
        consultationFilter = consultationFilterEl.value;
        renderConsultations();
        return;
    }

    const imagePath = event.target.dataset.imagePath;
    if (imagePath) {
        handleImageSelection(event.target, imagePath);
        return;
    }

    const path = event.target.dataset.path;
    if (!path) return;
    setByPath(path, event.target.dataset.boolean ? event.target.checked : event.target.value);
    markDirty();
});

document.addEventListener("click", async event => {
    const navButton = event.target.closest("[data-module]");
    if (navButton) {
        if (!(await confirmDiscard("有未保存的修改，切换模块会丢失。确定继续吗？"))) return;
        activeModule = navButton.dataset.module;
        collectionOpenIndex = null;
        render();
        return;
    }

    const addButton = event.target.closest("[data-add]");
    if (addButton) {
        addItem(addButton.dataset.add);
        return;
    }

    const removeButton = event.target.closest("[data-remove]");
    if (removeButton) {
        removeItem(removeButton.dataset.remove, removeButton.dataset.index);
        return;
    }

    const carouselAddButton = event.target.closest("[data-carousel-add]");
    if (carouselAddButton) {
        openCarouselEditor(null);
        return;
    }

    const carouselEditButton = event.target.closest("[data-carousel-edit]");
    if (carouselEditButton) {
        openCarouselEditor(carouselEditButton.dataset.carouselEdit);
        return;
    }

    const carouselDeleteButton = event.target.closest("[data-carousel-delete]");
    if (carouselDeleteButton) {
        removeCarouselSlide(Number(carouselDeleteButton.dataset.carouselDelete));
        return;
    }

    const articleAddButton = event.target.closest("[data-article-add]");
    if (articleAddButton) {
        openArticleEditor(null);
        return;
    }

    const articleEditButton = event.target.closest("[data-article-edit]");
    if (articleEditButton) {
        openArticleEditor(articleEditButton.dataset.articleEdit);
        return;
    }

    const articleDeleteButton = event.target.closest("[data-article-delete]");
    if (articleDeleteButton) {
        removeArticle(Number(articleDeleteButton.dataset.articleDelete));
        return;
    }

    const clearImageButton = event.target.closest("[data-clear-image]");
    if (clearImageButton) {
        const path = clearImageButton.dataset.clearImage;
        setByPath(path, "");
        refreshImageField(path, "");
        markDirty();
        setState("图片已清除，请保存内容", "warn");
        return;
    }

    const refreshConsultationsButton = event.target.closest("[data-refresh-consultations]");
    if (refreshConsultationsButton) {
        loadConsultations();
        return;
    }

    const refreshEditLogButton = event.target.closest("[data-refresh-edit-log]");
    if (refreshEditLogButton) {
        loadEditLog();
        return;
    }

    const rollbackButton = event.target.closest("[data-rollback]");
    if (rollbackButton) {
        rollbackEditLogItem(rollbackButton.dataset.rollback);
        return;
    }

    const consultationStatusButton = event.target.closest("[data-consultation-status]");
    if (consultationStatusButton) {
        updateConsultationStatus(
            consultationStatusButton.dataset.consultationStatus,
            consultationStatusButton.dataset.status
        );
        return;
    }

    const removeConsultationButton = event.target.closest("[data-remove-consultation]");
    if (removeConsultationButton) {
        removeConsultation(removeConsultationButton.dataset.removeConsultation);
        return;
    }

    const cardCloseButton = event.target.closest("[data-card-close]");
    if (cardCloseButton) {
        collectionOpenIndex = null;
        renderCollectionCards(activeModule);
        return;
    }

    const cardToggle = event.target.closest("[data-card-toggle]");
    if (cardToggle) {
        toggleCollectionCard(activeModule, Number(cardToggle.dataset.cardToggle));
        return;
    }

});

saveBtn.addEventListener("click", saveContent);
reloadBtn.addEventListener("click", async () => {
    if (activeModule === "consultations") {
        loadConsultations();
        return;
    }
    if (activeModule === "editLog") {
        loadEditLog();
        return;
    }
    if (!(await confirmDiscard("重新读取将丢弃未保存的修改，确定继续吗？"))) return;
    loadContent();
});

const siteLink = document.querySelector(".site-link");
if (siteLink) {
    siteLink.addEventListener("click", async event => {
        if (!dirty) return;
        event.preventDefault();
        if (await confirmDiscard("有未保存的修改，返回网站将丢失。确定离开吗？")) {
            window.location.href = siteLink.getAttribute("href");
        }
    });
}

document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (document.getElementById("articleModal")) {
        saveArticle(false);
        return;
    }
    if (document.getElementById("carouselModal")) {
        saveCarouselSlide();
        return;
    }
    if (activeModule !== "consultations") saveContent();
});

window.addEventListener("hashchange", async () => {
    const hash = location.hash.replace(/^#/, "");
    const module = modules.find(item => item.id === hash);
    if (!module || module.id === activeModule) return;
    if (!(await confirmDiscard("有未保存的修改，切换模块会丢失。确定继续吗？"))) {
        try {
            history.replaceState(null, "", `#${activeModule}`);
        } catch (hashError) {
            // ignore
        }
        return;
    }
    activeModule = module.id;
    collectionOpenIndex = null;
    render();
});

window.addEventListener("beforeunload", event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
});

const initialHash = location.hash.replace(/^#/, "");
if (modules.some(item => item.id === initialHash)) {
    activeModule = initialHash;
}

logoutBtn.addEventListener("click", () => {
    clearAuth();
    logoutBtn.hidden = true;
    showCurrentUser();
    setState("已退出登录", "warn");
    showLoginOverlay();
});

(async function init() {
    const loggedIn = await checkAuthStatus();
    logoutBtn.hidden = !authRequired || !authToken;
    showCurrentUser();
    loadContent();
    if (authRequired && !loggedIn) {
        showLoginOverlay();
    }
})();
