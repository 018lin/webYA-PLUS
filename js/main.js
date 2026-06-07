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
