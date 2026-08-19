const modules = [
    { id: "settings", label: "全站设置", icon: "fa-gear" },
    { id: "home", label: "首页内容", icon: "fa-house" },
    { id: "doctors", label: "医生管理", icon: "fa-user-doctor" },
    { id: "specialties", label: "专科管理", icon: "fa-tooth" },
    { id: "articles", label: "科普文章", icon: "fa-book-medical" },
    { id: "media", label: "媒体资源", icon: "fa-images" },
    { id: "consultations", label: "咨询信息", icon: "fa-inbox" }
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
    articles: [],
    media: []
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

const apiUrls = ["../api/content", "/api/content"];
const uploadUrls = ["../api/upload", "/api/upload"];
const consultationUrls = ["../api/consultations", "/api/consultations"];
const staticContentUrls = ["../data/site-content.json", "/data/site-content.json"];

const navEl = document.getElementById("adminNav");
const titleEl = document.getElementById("moduleTitle");
const panelEl = document.getElementById("editorPanel");
const stateEl = document.getElementById("saveState");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");

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
    stateEl.style.color = tone === "error" ? "#b91c1c" : tone === "ok" ? "#0f766e" : "";
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
        articles: Array.isArray(raw.articles) ? raw.articles : [],
        media: Array.isArray(raw.media) ? raw.media : []
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

function contentScore(value) {
    if (!value) return 0;
    return [
        value.doctors,
        value.specialties,
        value.articles,
        value.media,
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
        if (activeModule === "consultations") renderConsultations();
    }
}

async function loadContent() {
    setState("正在读取内容");
    try {
        const apiContent = await fetchFirstJson(apiUrls);
        apiUrl = apiContent.url;
        content = normalizeContent(apiContent.data);
        apiMode = true;
        setState("已连接保存接口", "ok");
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
            setState(useLocalDraft ? "仅本地草稿，前台/其他设备不会同步" : "已读取静态内容，保存仅本地草稿", "error");
        } catch (staticError) {
            content = localDraft || normalizeContent(fallbackContent);
            setState(localDraft ? "仅本地草稿，前台/其他设备不会同步" : "使用默认空数据", "error");
        }
    }
    render();
    loadConsultations(false);
}

async function saveContent() {
    content.updatedAt = new Date().toISOString();
    if (!apiMode) {
        localStorage.setItem("here-dental-admin-content", JSON.stringify(content));
        setState("本地草稿已保存，未写入服务器", "error");
        return;
    }

    setState("正在保存");
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(content)
        });
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
        setState("内容已保存", "ok");
    } catch (error) {
        setState(error.message || "保存失败", "error");
        console.error(error);
    }
}

function render() {
    renderNav();
    const module = modules.find(item => item.id === activeModule);
    titleEl.textContent = module ? module.label : "内容管理";
    saveBtn.hidden = activeModule === "consultations";

    if (activeModule === "settings") renderSettings();
    if (activeModule === "home") renderHome();
    if (activeModule === "doctors") renderCollection("doctors");
    if (activeModule === "specialties") renderCollection("specialties");
    if (activeModule === "articles") renderArticles();
    if (activeModule === "media") renderCollection("media");
    if (activeModule === "consultations") renderConsultations();
}

function renderNav() {
    navEl.innerHTML = modules.map(item => `
        <button type="button" class="${activeModule === item.id ? "active" : ""}" data-module="${item.id}">
            <i class="fas ${item.icon}"></i>
            ${item.label}
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
        ${panelHead("全站设置", "管理全站公共联系方式和地址。")}
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
            <button class="small-btn" type="button" data-add="home.heroSlides">
                <i class="fas fa-plus"></i>
                添加轮播
            </button>
        `)}
        <div class="form-grid">
            ${field("理念标题", content.home.philosophyTitle, "home.philosophyTitle")}
            ${field("预约按钮", content.home.ctaButton, "home.ctaButton")}
            ${textarea("理念文案", content.home.philosophyText, "home.philosophyText")}
            ${textarea("底部预约标题", content.home.ctaTitle, "home.ctaTitle")}
        </div>
        <div class="item-list">
            ${content.home.heroSlides.map((item, index) => renderItem("home.heroSlides", item, index, "title", [
                ["轮播标题", "title"],
                ["轮播图片", "image", "image"],
                ["图片说明", "alt"]
            ], true)).join("")}
        </div>
    `;
}

function getCollectionConfig(type) {
    return {
        doctors: {
            title: "医生管理",
            desc: "维护医生列表、简介、标签、头像和显示状态。",
            addText: "添加医生",
            titleKey: "name",
            subKey: "title",
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
            desc: "维护特色专科项目、封面、简介、标签和关联医生。",
            addText: "添加专科",
            titleKey: "name",
            subKey: "subtitle",
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
        },
        media: {
            title: "媒体资源",
            desc: "维护网站常用图片和资源分类。",
            addText: "添加资源",
            titleKey: "name",
            subKey: "category",
            fields: [
                ["资源名称", "name"],
                ["分类", "category"],
                ["图片文件", "path", "image"],
                ["替代文字", "alt"]
            ],
            defaultItem: { name: "新图片", category: "未分类", path: "", alt: "", visible: true },
            switches: [["可用", "visible"]]
        }
    }[type];
}

function renderCollection(type) {
    const config = getCollectionConfig(type);
    panelEl.innerHTML = `
        ${panelHead(config.title, config.desc, `
            <button class="small-btn" type="button" data-add="${type}">
                <i class="fas fa-plus"></i>
                ${config.addText}
            </button>
        `)}
        <div class="item-list">
            ${content[type].length ? content[type].map((item, index) => {
                const openByDefault = type !== "media" && content[type].length <= 12;
                return renderItem(type, item, index, config.titleKey, config.fields, openByDefault, config);
            }).join("") : `<div class="empty-state">暂无内容</div>`}
        </div>
    `;
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

    const body = consultationsLoading
        ? `<div class="empty-state">正在读取咨询信息</div>`
        : consultations.length
            ? `<div class="consultation-list">${consultations.map(renderConsultationItem).join("")}</div>`
            : `<div class="empty-state">暂无咨询信息</div>`;

    panelEl.innerHTML = `
        ${panelHead("咨询信息", "接收前台在线预约提交的姓名、电话、项目、期望日期和备注。", action)}
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

function renderItem(collectionPath, item, index, titleKey, fields, open = false, config = null) {
    const sub = config && config.subKey ? item[config.subKey] || "" : "";
    const switches = config && config.switches ? config.switches : [["显示", "visible"]];
    return `
        <article class="content-item ${open ? "open" : ""}" data-item="${collectionPath}.${index}">
            <div class="content-item-head">
                ${collectionPath === "media" && item.path ? `<img class="content-item-thumb" src="${escapeAttr(assetSrc(item.path))}" alt="">` : ""}
                <div class="content-item-title">
                    <strong>${escapeHtml(item[titleKey] || "未命名内容")}</strong>
                    <span>${escapeHtml(sub || collectionPath)}</span>
                </div>
                <div class="content-item-actions">
                    <button class="ghost-btn" type="button" data-toggle-item>
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="danger-btn" type="button" data-remove="${collectionPath}" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="content-item-body">
                ${fields.map(([label, key, kind]) => {
                    const path = `${collectionPath}.${index}.${key}`;
                    if (kind === "textarea") return textarea(label, item[key], path);
                    if (kind === "image") return imageField(label, item[key], path, true);
                    return field(label, item[key], path, "text", false);
                }).join("")}
                <div class="field-wide">
                    ${switches.map(([label, key]) => `
                        <label class="switch-field">
                            <input type="checkbox" ${item[key] ? "checked" : ""} data-path="${collectionPath}.${index}.${key}" data-boolean="true">
                            ${label}
                        </label>
                    `).join("")}
                </div>
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
    if (path === "home.heroSlides") {
        content.home.heroSlides.push({ title: "新轮播", image: "", alt: "", visible: true });
    } else {
        content[path].push(clone(getCollectionConfig(path).defaultItem));
    }
    render();
}

function removeItem(path, index) {
    const segments = path.split(".");
    let list = content;
    segments.forEach(segment => { list = list[segment]; });
    list.splice(Number(index), 1);
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

function removeArticle(index) {
    if (!window.confirm("确定删除这篇文章？此操作不可恢复。")) return;
    content.articles.splice(index, 1);
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
    if (path.startsWith("media.") && (!parent.name || parent.name === "新图片")) parent.name = baseName;
}

async function uploadImage(file) {
    const formData = new FormData();
    formData.append("image", file);

    let lastError = null;
    for (const url of uploadUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                body: formData
            });
            const text = await response.text();
            let payload = {};
            try {
                payload = text ? JSON.parse(text) : {};
            } catch (parseError) {
                payload = {};
            }

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
        setState("图片已上传，请保存内容", "ok");
        render();
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
            const options = { method };
            if (payload) {
                options.headers = { "Content-Type": "application/json" };
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

            if (!response.ok) {
                throw new Error(data.error || text || "咨询信息操作失败");
            }

            consultationApiUrl = url;
            consultations = normalizeConsultations(data);
            consultationsLoaded = true;
            renderConsultations();
            return data;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("咨询信息操作失败");
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
    if (!window.confirm("确定删除这条咨询信息？")) return;

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
        renderArticleTable();
        return;
    }

    const path = event.target.dataset.path;
    if (!path) return;
    setByPath(path, event.target.value);
});

document.addEventListener("change", event => {
    const categoryFilter = event.target.closest("#articleCategoryFilter");
    if (categoryFilter) {
        articleCategoryFilter = categoryFilter.value;
        renderArticleTable();
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
});

document.addEventListener("click", event => {
    const navButton = event.target.closest("[data-module]");
    if (navButton) {
        activeModule = navButton.dataset.module;
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
        setByPath(clearImageButton.dataset.clearImage, "");
        setState("图片已清除，请保存内容");
        render();
        return;
    }

    const refreshConsultationsButton = event.target.closest("[data-refresh-consultations]");
    if (refreshConsultationsButton) {
        loadConsultations();
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

    const toggleButton = event.target.closest("[data-toggle-item]");
    if (toggleButton) {
        toggleButton.closest(".content-item").classList.toggle("open");
    }
});

saveBtn.addEventListener("click", saveContent);
reloadBtn.addEventListener("click", () => {
    if (activeModule === "consultations") {
        loadConsultations();
    } else {
        loadContent();
    }
});

loadContent();
