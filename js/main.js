// ======================== Page View Tracking (访问统计上报) ========================
// 所有前台页面都引入本文件，每次打开页面向 /api/pageviews 上报一条浏览记录（后台统计用）。
// 上报是 fire-and-forget：两个 URL 顺序尝试（兼容子路径部署），成功即停，失败静默。
(async function trackPageView() {
    if (location.protocol === "file:") return;             // 本地直接打开文件不统计
    if (/^\/admin(\/|$)/.test(location.pathname)) return;  // 后台页面不统计（双保险）

    var d = new Date();
    var day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
        + "-" + String(d.getDate()).padStart(2, "0");      // 访客本地日期，按天分组用
    var payload = JSON.stringify({ page: location.pathname + location.search, day: day });
    var urls = ["api/pageviews", "/api/pageviews"];

    for (var i = 0; i < urls.length; i += 1) {
        try {
            var response = await fetch(urls[i], {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true
            });
            if (!response.ok) throw new Error(String(response.status));
            break; // 成功即停，避免根路径下两个 URL 都可达导致重复计数
        } catch (error) {
            // 尝试下一个 URL，全部失败则静默结束
        }
    }
})();

// ======================== Mobile Nav Toggle (side drawer) ========================
function toggleNav() {
    const nav = document.getElementById('nav');
    const isOpen = nav.classList.toggle('open');
    document.body.style.overflow = isOpen ? 'hidden' : '';
}
document.querySelectorAll('.nav a').forEach(link => {
    link.addEventListener('click', () => {
        document.getElementById('nav').classList.remove('open');
        document.body.style.overflow = '';
    });
});

// ======================== Transparent Nav (scroll to solid) ========================
(function initHeaderScroll() {
    const header = document.getElementById('header');
    if (!header) return;

    function updateHeader() {
        // Switch after scrolling past ~80% of hero height (trigger before hero fully exits)
        const scrollThreshold = window.innerHeight * 0.8;
        if (window.scrollY > scrollThreshold) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader(); // run once on load to set correct initial state
})();

// ======================== Scroll Animations (IntersectionObserver) ========================
const fadeEls = document.querySelectorAll('.fade-in');
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
fadeEls.forEach(el => observer.observe(el));

// ======================== Nav highlight on scroll ========================
const sections = document.querySelectorAll('section[id]');
if (sections.length > 0) {
    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const top = section.offsetTop - 150;
            if (window.scrollY >= top) {
                current = section.getAttribute('id');
            }
        });
        document.querySelectorAll('.nav a').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });
}

// ======================== Home-only mode (append ?preview to the URL) ========================
(function initHomeOnlyMode() {
    const suffixText = (location.search + location.hash).toLowerCase();
    const isHomeOnlyMode =
        suffixText.includes('preview') ||
        suffixText.includes('homeonly') ||
        suffixText.includes('home-only');

    if (!isHomeOnlyMode) return;

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const isHomePage = currentPage === 'index.html';
    const modeSuffix = location.search ? location.search + location.hash : (location.hash || '?preview');

    if (!isHomePage) {
        window.location.replace('index.html' + modeSuffix);
        return;
    }

    function getLocalHtmlPage(href) {
        const rawHref = (href || '').trim();
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('?')) return '';
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawHref)) return '';

        const path = rawHref.split('#')[0].split('?')[0];
        const page = path.split('/').pop() || 'index.html';
        return page.endsWith('.html') ? page : '';
    }

    document.querySelectorAll('a[href]').forEach(link => {
        const page = getLocalHtmlPage(link.getAttribute('href'));
        if (!page) return;

        if (page === 'index.html') {
            link.setAttribute('href', 'index.html' + modeSuffix);
            return;
        }

        link.setAttribute('aria-disabled', 'true');
        link.addEventListener('click', event => {
            event.preventDefault();
        });
    });

    document.querySelectorAll('.nav a[aria-disabled="true"], .mobile-float a[aria-disabled="true"]').forEach(el => {
        el.style.display = 'none';
    });
})();

// ======================== Hero Carousel ========================
(function initHeroCarousel() {
    var slides = document.querySelectorAll('#heroBanner .carousel-slide');
    var dots = document.querySelectorAll('#heroBanner .carousel-dots .dot');
    if (slides.length === 0) return;

    var current = 0;
    var timer = null;

    function goTo(index) {
        slides[current].classList.remove('active');
        dots[current].classList.remove('active');
        current = ((index % slides.length) + slides.length) % slides.length;
        slides[current].classList.add('active');
        dots[current].classList.add('active');
    }

    function next() { goTo(current + 1); }

    function startTimer() {
        stopTimer();
        timer = setInterval(next, 4000);
    }

    function stopTimer() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    dots.forEach(function(dot) {
        dot.addEventListener('click', function() {
            goTo(parseInt(this.getAttribute('data-index'), 10));
            startTimer();
        });
    });

    var hero = document.getElementById('heroBanner');
    if (hero) {
        hero.addEventListener('mouseenter', stopTimer);
        hero.addEventListener('mouseleave', startTimer);
    }

    startTimer();
})();

// ======================== Appointment Form ========================
(function initAppointmentForm() {
    var form = document.getElementById('appointmentForm');
    if (!form) return;

    var button = form.querySelector('.submit-btn');
    var statusEl = document.createElement('p');
    statusEl.className = 'form-status';
    if (button) button.insertAdjacentElement('afterend', statusEl);

    function fieldValue(selector) {
        var el = form.querySelector(selector);
        return el ? el.value.trim() : '';
    }

    function setStatus(text, tone) {
        statusEl.textContent = text || '';
        statusEl.className = 'form-status' + (tone ? ' ' + tone : '');
    }

    async function postConsultation(payload) {
        var urls = ['api/consultations', '/api/consultations'];
        var lastError = null;

        for (var i = 0; i < urls.length; i += 1) {
            try {
                var response = await fetch(urls[i], {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var text = await response.text();
                var data = {};
                try {
                    data = text ? JSON.parse(text) : {};
                } catch (error) {
                    data = {};
                }

                if (!response.ok) {
                    throw new Error(data.error || text || '提交失败');
                }

                return data;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('提交失败');
    }

    async function handleSubmit(event) {
        event.preventDefault();

        var payload = {
            name: fieldValue('#name'),
            phone: fieldValue('#phone'),
            type: fieldValue('#type'),
            date: fieldValue('#date'),
            message: fieldValue('#message'),
            page: window.location.pathname
        };

        if (!payload.name) {
            setStatus('请填写姓名', 'error');
            return;
        }
        if (!/^[0-9+\-\s()]{6,30}$/.test(payload.phone)) {
            setStatus('请填写正确的手机号', 'error');
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = '正在提交...';
        }
        setStatus('');

        try {
            await postConsultation(payload);
            form.reset();
            setStatus('预约信息已提交，我们会尽快与您联系。', 'ok');
        } catch (error) {
            setStatus(error.message || '提交失败，请稍后再试。', 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '提交预约';
            }
        }
    }

    form.addEventListener('submit', handleSubmit);
})();
