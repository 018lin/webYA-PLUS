(function initCmsRender() {
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    const apiContentUrls = ["api/content", "/api/content"];
    const staticContentUrls = ["data/site-content.json", "/data/site-content.json"];

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function splitTags(value) {
        return String(value || "")
            .split(/[，,]/)
            .map(tag => tag.trim())
            .filter(Boolean);
    }

    function visibleItems(list) {
        return Array.isArray(list) ? list.filter(item => item && item.visible !== false) : [];
    }

    function pagePath(path) {
        return path || "#";
    }

    async function fetchContent() {
        for (const url of apiContentUrls) {
            try {
                const response = await fetch(url, { cache: "no-store" });
                if (response.ok) return response.json();
            } catch (error) {
                // Try the next API source. The site can be mounted at root or a subpath.
            }
        }

        const localDraft = loadLocalDraft();
        let staticContent = null;
        for (const url of staticContentUrls) {
            try {
                const response = await fetch(url, { cache: "no-store" });
                if (response.ok) {
                    staticContent = await response.json();
                    break;
                }
            } catch (error) {
                // Try the next static source.
            }
        }

        if (staticContent && shouldUseLocalDraft(localDraft, staticContent)) return localDraft;
        return staticContent || localDraft;
    }

    function loadLocalDraft() {
        try {
            const saved = localStorage.getItem("here-dental-admin-content");
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    function contentTimestamp(value) {
        const time = Date.parse(value && value.updatedAt);
        return Number.isFinite(time) ? time : 0;
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

    function shouldUseLocalDraft(localDraft, staticContent) {
        if (!localDraft) return false;

        const localTime = contentTimestamp(localDraft);
        const staticTime = contentTimestamp(staticContent);

        if (localTime && staticTime) return localTime > staticTime;
        if (localTime && !staticTime) return true;

        return contentScore(localDraft) > contentScore(staticContent);
    }

    function renderTags(tags, className = "tag") {
        return splitTags(tags).map(tag => `<span class="${className}">${escapeHtml(tag)}</span>`).join("");
    }

    function doctorCardForTeam(doctor) {
        return `
            <a href="${escapeHtml(pagePath(doctor.href))}" class="team-card-link fade-in visible">
                <div class="team-photo">
                    <img src="${escapeHtml(doctor.avatar)}" alt="${escapeHtml(doctor.name)}">
                </div>
                <div class="team-body">
                    <h4>${escapeHtml(doctor.name)}</h4>
                    <div class="team-title">${escapeHtml(doctor.title)}</div>
                    <p>${escapeHtml(doctor.summary)}</p>
                    <div class="team-tags">
                        ${renderTags(doctor.tags, "")}
                    </div>
                </div>
            </a>
        `;
    }

    function doctorCardForHome(doctor) {
        return `
            <a href="${escapeHtml(pagePath(doctor.href))}" class="specialty-card fade-in visible">
                <div class="specialty-img" style="background:#f0f7ff;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                    <img src="${escapeHtml(doctor.avatar)}" alt="${escapeHtml(doctor.name)}" class="specialty-img-cover" style="object-position:center top;">
                </div>
                <div class="specialty-body">
                    <h4>${escapeHtml(doctor.name)}</h4>
                    <div class="doc-name">${escapeHtml(doctor.title)}</div>
                    <p>${escapeHtml(doctor.summary)}</p>
                    <div class="tag-group">
                        ${renderTags(doctor.tags)}
                    </div>
                </div>
            </a>
        `;
    }

    function specialtyCard(specialty) {
        return `
            <a href="${escapeHtml(pagePath(specialty.href))}" class="specialty-card fade-in visible">
                <div class="specialty-img">
                    <img src="${escapeHtml(specialty.cover)}" alt="${escapeHtml(specialty.name)}" class="specialty-img-cover">
                </div>
                <div class="specialty-body">
                    <h4>${escapeHtml(specialty.name)}</h4>
                    <div class="doc-name">${escapeHtml(specialty.subtitle)}</div>
                    <p>${escapeHtml(specialty.summary)}</p>
                    <div class="tag-group">
                        ${renderTags(specialty.tags)}
                    </div>
                </div>
            </a>
        `;
    }

    function articleLink(article, index) {
        return article.topic
            ? `knowledge-detail.html?topic=${encodeURIComponent(article.topic)}`
            : `knowledge-detail.html?article=${index}`;
    }

    function articleIcon(category) {
        const text = String(category || "");
        if (text.includes("矫正")) return "fas fa-teeth";
        if (text.includes("种植")) return "fas fa-tooth";
        if (text.includes("修复")) return "fas fa-gem";
        if (text.includes("儿童")) return "fas fa-child";
        if (text.includes("牙周")) return "fas fa-bacteria";
        if (text.includes("美容")) return "fas fa-smile";
        if (text.includes("拔牙")) return "fas fa-syringe";
        if (text.includes("牙髓")) return "fas fa-microscope";
        return "fas fa-stethoscope";
    }

    function articleCard(article, index) {
        return `
            <a href="${escapeHtml(articleLink(article, index))}" class="knowledge-card fade-in visible">
                <div class="knowledge-img"><i class="${articleIcon(article.category)}"></i></div>
                <div class="knowledge-body">
                    <span class="knowledge-cat">${escapeHtml(article.category)}</span>
                    <h4>${escapeHtml(article.title)}</h4>
                    <p>${escapeHtml(article.summary)}</p>
                    <div class="knowledge-meta"><i class="fas fa-clock"></i> 更新于 ${escapeHtml(article.date)}</div>
                </div>
            </a>
        `;
    }

    function initRenderedCarousel(hero) {
        const slides = hero.querySelectorAll(".carousel-slide");
        const dots = hero.querySelectorAll(".dot");
        if (slides.length < 2 || dots.length !== slides.length) return;

        let current = 0;
        function goTo(index) {
            slides[current].classList.remove("active");
            dots[current].classList.remove("active");
            current = ((index % slides.length) + slides.length) % slides.length;
            slides[current].classList.add("active");
            dots[current].classList.add("active");
        }

        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => goTo(index));
        });

        window.setInterval(() => goTo(current + 1), 4000);
    }

    function renderHome(content) {
        const home = content.home || {};
        const site = content.site || {};
        const hero = document.getElementById("heroBanner");
        const slides = visibleItems(home.heroSlides);
        const carousel = hero && hero.querySelector(".hero-carousel");
        const dots = hero && hero.querySelector(".carousel-dots");

        if (carousel && dots && slides.length) {
            carousel.innerHTML = slides.map((slide, index) => `
                <div class="carousel-slide ${index === 0 ? "active" : ""}">
                    <img src="${escapeHtml(slide.image)}" alt="${escapeHtml(slide.alt || slide.title)}">
                </div>
            `).join("");
            dots.innerHTML = slides.map((slide, index) => `
                <span class="dot ${index === 0 ? "active" : ""}" data-index="${index}"></span>
            `).join("");
            initRenderedCarousel(hero);
        }

        const title = document.querySelector("#philosophy .title-text");
        if (title && (home.philosophyTitle || site.slogan)) {
            title.innerHTML = `${escapeHtml(home.philosophyTitle || "我们的理念")}<br><em>${escapeHtml(site.slogan || "")}</em>`;
        }

        const philosophy = document.querySelector("#philosophy .highlight p");
        if (philosophy && home.philosophyText) {
            philosophy.textContent = home.philosophyText;
        }

        const grid = document.querySelector("#specialties .specialties-grid");
        const doctors = visibleItems(content.doctors);
        if (grid && doctors.length) {
            grid.innerHTML = doctors.map(doctorCardForHome).join("");
        }

        const ctaTitle = Array.from(document.querySelectorAll("section h2"))
            .find(el => el.textContent.includes("守护牙齿"));
        if (ctaTitle && home.ctaTitle) ctaTitle.textContent = home.ctaTitle;

        const ctaButton = Array.from(document.querySelectorAll("section a"))
            .find(el => el.textContent.includes("预约口腔检查"));
        if (ctaButton && home.ctaButton) ctaButton.textContent = home.ctaButton;
    }

    function renderTeam(content) {
        const grid = document.querySelector(".team-grid");
        const doctors = visibleItems(content.doctors);
        if (grid && doctors.length) grid.innerHTML = doctors.map(doctorCardForTeam).join("");
    }

    function renderSpecialties(content) {
        const grid = document.querySelector(".specialties-grid");
        const specialties = visibleItems(content.specialties);
        if (grid && specialties.length) grid.innerHTML = specialties.map(specialtyCard).join("");
    }

    function renderKnowledgeList(content) {
        const grid = document.querySelector(".knowledge-grid");
        const articles = visibleItems(content.articles);
        if (grid && articles.length) {
            grid.innerHTML = articles.map(articleCard).join("");
        }
    }

    function selectArticle(articles) {
        const params = new URLSearchParams(window.location.search);
        const byIndex = Number(params.get("article"));
        if (Number.isInteger(byIndex) && articles[byIndex]) return articles[byIndex];

        const topic = params.get("topic");
        if (topic) {
            const match = articles.find(article => article.topic === topic);
            if (match) return match;
        }

        return articles[0];
    }

    function renderKnowledgeDetail(content) {
        const articles = visibleItems(content.articles);
        const article = selectArticle(articles);
        if (!article || !document.getElementById("article-title")) return;

        document.title = `${article.title} - 惠尔口腔科普`;
        document.getElementById("article-category").textContent = article.category || "";
        document.getElementById("article-title").textContent = article.title || "";
        document.getElementById("article-summary").textContent = article.summary || "";
        document.getElementById("article-section-title").textContent = article.sectionTitle || article.title || "";

        const image = document.getElementById("article-image");
        if (image) {
            image.src = article.image || "";
            image.alt = article.title || "";
        }

        const paragraphs = document.getElementById("article-paragraphs");
        if (paragraphs) {
            const body = String(article.body || article.summary || "")
                .split(/\n{2,}|\r?\n/)
                .map(text => text.trim())
                .filter(Boolean);
            paragraphs.innerHTML = body.map(text => `<p>${escapeHtml(text)}</p>`).join("");
        }

        const points = document.getElementById("article-points");
        if (points) points.innerHTML = "";
    }

    function renderContent(content) {
        if (pageName === "home.html" || pageName === "index.html") renderHome(content);
        if (pageName === "team.html") renderTeam(content);
        if (pageName === "specialties.html") renderSpecialties(content);
        if (pageName === "knowledge.html") renderKnowledgeList(content);
        if (pageName === "knowledge-detail.html") renderKnowledgeDetail(content);
    }

    async function start() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("preview")) {
            try {
                const preview = JSON.parse(localStorage.getItem("here-dental-article-preview"));
                if (preview && typeof preview === "object") {
                    renderKnowledgeDetail({ articles: [{ ...preview, visible: true }] });
                    return;
                }
            } catch (error) {
                // Fall back to normal content loading.
            }
        }

        const content = await fetchContent();
        if (content) renderContent(content);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
