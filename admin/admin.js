const modules = [
    { id: "settings", label: "全站设置", icon: "fa-gear" },
    { id: "home", label: "首页内容", icon: "fa-house" },
    { id: "doctors", label: "医生管理", icon: "fa-user-doctor" },
    { id: "specialties", label: "专科管理", icon: "fa-tooth" },
    { id: "articles", label: "科普文章", icon: "fa-book-medical" },
    { id: "media", label: "媒体资源", icon: "fa-images" }
];

const fallbackContent = {
    site: {
        name: "惠尔口腔",
        slogan: "预防胜于一切的治疗",
        phone: "0752-7820202",
        email: "hcjkqmz@163.com",
        address: "惠州市惠城区麦地东二路鸿润花园A栋102-106铺",
        hours: "周一至周四09:00-20:00 周五至周日09:00-18:00",
        icpText: "（备案号）",
        mapLng: "114.409602",
        mapLat: "23.06347"
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

const navEl = document.getElementById("adminNav");
const titleEl = document.getElementById("moduleTitle");
const panelEl = document.getElementById("editorPanel");
const summaryEl = document.getElementById("adminSummary");
const stateEl = document.getElementById("saveState");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function setState(text, tone = "neutral") {
    stateEl.textContent = text;
    stateEl.style.color = tone === "error" ? "#b91c1c" : tone === "ok" ? "#0f766e" : "";
}

function normalizeContent(raw) {
    return {
        ...clone(fallbackContent),
        ...raw,
        site: { ...fallbackContent.site, ...(raw.site || {}) },
        home: { ...fallbackContent.home, ...(raw.home || {}) },
        doctors: Array.isArray(raw.doctors) ? raw.doctors : [],
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

async function loadContent() {
    setState("正在读取内容");
    try {
        content = normalizeContent(await fetchJson("../api/content"));
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
            const staticContent = normalizeContent(await fetchJson("../data/site-content.json"));
            content = localDraft && contentScore(localDraft) >= contentScore(staticContent)
                ? localDraft
                : staticContent;
            setState(localDraft === content ? "本地草稿模式" : "已读取静态内容数据", "neutral");
        } catch (staticError) {
            content = localDraft || normalizeContent(fallbackContent);
            setState(localDraft ? "本地草稿模式" : "使用默认空数据", "neutral");
        }
    }
    render();
}

async function saveContent() {
    content.updatedAt = new Date().toISOString();
    if (!apiMode) {
        localStorage.setItem("here-dental-admin-content", JSON.stringify(content));
        setState("本地草稿已保存", "ok");
        renderSummary();
        return;
    }

    setState("正在保存");
    try {
        const response = await fetch("../api/content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(content)
        });
        if (!response.ok) throw new Error(await response.text());
        content = normalizeContent(await response.json());
        setState("内容已保存", "ok");
        renderSummary();
    } catch (error) {
        setState("保存失败", "error");
        console.error(error);
    }
}

function render() {
    renderNav();
    renderSummary();
    const module = modules.find(item => item.id === activeModule);
    titleEl.textContent = module ? module.label : "内容管理";

    if (activeModule === "settings") renderSettings();
    if (activeModule === "home") renderHome();
    if (activeModule === "doctors") renderCollection("doctors");
    if (activeModule === "specialties") renderCollection("specialties");
    if (activeModule === "articles") renderCollection("articles");
    if (activeModule === "media") renderCollection("media");
}

function renderNav() {
    navEl.innerHTML = modules.map(item => `
        <button type="button" class="${activeModule === item.id ? "active" : ""}" data-module="${item.id}">
            <i class="fas ${item.icon}"></i>
            ${item.label}
        </button>
    `).join("");
}

function renderSummary() {
    const cards = [
        ["医生", content.doctors.length],
        ["专科", content.specialties.length],
        ["文章", content.articles.length],
        ["轮播", content.home.heroSlides.length],
        ["媒体", content.media.length]
    ];
    summaryEl.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
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
    const safeValue = value == null ? "" : String(value).replaceAll('"', "&quot;");
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
            <textarea data-path="${path}">${value || ""}</textarea>
        </label>
    `;
}

function renderSettings() {
    panelEl.innerHTML = `
        ${panelHead("全站设置", "管理全站公共联系方式、地址、地图和备案内容。")}
        <div class="form-grid">
            ${field("网站名称", content.site.name, "site.name")}
            ${field("品牌口号", content.site.slogan, "site.slogan")}
            ${field("联系电话", content.site.phone, "site.phone")}
            ${field("电子邮箱", content.site.email, "site.email")}
            ${field("营业时间", content.site.hours, "site.hours", "text", true)}
            ${field("诊所地址", content.site.address, "site.address", "text", true)}
            ${field("地图经度", content.site.mapLng, "site.mapLng")}
            ${field("地图纬度", content.site.mapLat, "site.mapLat")}
            ${field("备案文字", content.site.icpText, "site.icpText")}
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
                ["图片路径", "image"],
                ["图片说明", "alt"]
            ], true)).join("")}
        </div>
    `;
}

function getCollectionConfig(type) {
    return {
        doctors: {
            title: "医生管理",
            desc: "维护医生列表、简介、标签、头像和首页推荐状态。",
            addText: "添加医生",
            titleKey: "name",
            subKey: "title",
            fields: [
                ["姓名", "name"],
                ["职称", "title"],
                ["头像/海报路径", "avatar"],
                ["擅长标签（用逗号分隔）", "tags"],
                ["简介", "summary", "textarea"]
            ],
            defaultItem: { name: "新医生", title: "医生", avatar: "", tags: "", summary: "", featured: false, visible: true },
            switches: [["首页推荐", "featured"], ["显示", "visible"]]
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
                ["封面图路径", "cover"],
                ["标签（用逗号分隔）", "tags"],
                ["关联医生（用逗号分隔）", "doctorNames"],
                ["简介", "summary", "textarea"]
            ],
            defaultItem: { name: "新专科", subtitle: "", cover: "", tags: "", doctorNames: "", summary: "", visible: true },
            switches: [["显示", "visible"]]
        },
        articles: {
            title: "科普文章",
            desc: "维护口腔科普文章的标题、分类、封面、摘要和正文。",
            addText: "添加文章",
            titleKey: "title",
            subKey: "category",
            fields: [
                ["文章标题", "title"],
                ["分类", "category"],
                ["发布时间", "date"],
                ["封面图路径", "image"],
                ["摘要", "summary", "textarea"],
                ["正文", "body", "textarea"]
            ],
            defaultItem: { title: "新文章", category: "口腔科普", date: new Date().toISOString().slice(0, 10), image: "", summary: "", body: "", visible: true },
            switches: [["发布", "visible"]]
        },
        media: {
            title: "媒体资源",
            desc: "维护网站常用图片路径和资源分类。",
            addText: "添加资源",
            titleKey: "name",
            subKey: "category",
            fields: [
                ["资源名称", "name"],
                ["分类", "category"],
                ["文件路径", "path"],
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

function renderItem(collectionPath, item, index, titleKey, fields, open = false, config = null) {
    const sub = config && config.subKey ? item[config.subKey] || "" : "";
    const switches = config && config.switches ? config.switches : [["显示", "visible"]];
    return `
        <article class="content-item ${open ? "open" : ""}" data-item="${collectionPath}.${index}">
            <div class="content-item-head">
                ${collectionPath === "media" && item.path ? `<img class="content-item-thumb" src="../${item.path}" alt="">` : ""}
                <div class="content-item-title">
                    <strong>${item[titleKey] || "未命名内容"}</strong>
                    <span>${sub || collectionPath}</span>
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
                    return kind === "textarea"
                        ? textarea(label, item[key], path)
                        : field(label, item[key], path, "text", false);
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

document.addEventListener("input", event => {
    const path = event.target.dataset.path;
    if (!path) return;
    setByPath(path, event.target.value);
    renderSummary();
});

document.addEventListener("change", event => {
    const path = event.target.dataset.path;
    if (!path) return;
    setByPath(path, event.target.dataset.boolean ? event.target.checked : event.target.value);
    renderSummary();
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

    const toggleButton = event.target.closest("[data-toggle-item]");
    if (toggleButton) {
        toggleButton.closest(".content-item").classList.toggle("open");
    }
});

saveBtn.addEventListener("click", saveContent);
reloadBtn.addEventListener("click", loadContent);

loadContent();
