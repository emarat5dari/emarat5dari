/* ==========================================================================
   عمارت ۵ دری — script.js
   Two responsibilities:
     1) Shared utilities exported for every other module (firebase.js aside)
        to import: showToast, formatPrice, formatDate, formatTime,
        escapeHtml, toggleButtonLoading, skeletonOff.
     2) Site-wide UI behavior that isn't specific to auth/cart/products/chat:
        hero slider, mobile off-canvas nav, sticky header shadow,
        back-to-top button, footer year, newsletter form, reveal-on-scroll,
        and active-link highlighting.
   ========================================================================== */

import { collections } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ==========================================================================
   PART 1 — SHARED UTILITIES (exported)
   ========================================================================== */

const persianNumberFormatter = new Intl.NumberFormat("fa-IR");

/** Formats a number of تومان with Persian digits and grouping, e.g. ۱۲۰٬۰۰۰ تومان */
export function formatPrice(amount) {
  const value = Number(amount) || 0;
  return `${persianNumberFormatter.format(value)} تومان`;
}

/** Formats a Firestore Timestamp (or Date) as a short Persian date. */
export function formatDate(timestamp) {
  if (!timestamp) return "-";
  const dateObj = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(dateObj);
}

/** Formats a Firestore Timestamp (or Date) as a short Persian time (HH:MM). */
export function formatTime(timestamp) {
  if (!timestamp) return "";
  const dateObj = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(dateObj);
}

/** Escapes user-supplied text before it's inserted as innerHTML, to prevent XSS. */
export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

/** Clears a container's skeleton placeholders and marks it ready for real content. */
export function skeletonOff(container) {
  if (!container) return;
  container.removeAttribute("data-loading");
  container.innerHTML = "";
}

/** Puts a submit button into a disabled "loading" state (or restores it). */
export function toggleButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "در حال پردازش...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

/** Shows a toast notification. type: 'success' | 'error' | 'info' */
export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ==========================================================================
   PART 2 — SITE-WIDE UI BEHAVIOR
   ========================================================================== */

/* --------------------------- Mobile off-canvas nav ---------------------- */
function initMobileNav() {
  const toggleBtn = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");
  if (!toggleBtn || !nav) return;

  const overlay = document.createElement("div");
  overlay.className = "nav-overlay";
  document.body.appendChild(overlay);

  function openNav() {
    nav.classList.add("is-open");
    overlay.classList.add("is-visible");
    toggleBtn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }
  function closeNav() {
    nav.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    toggleBtn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  toggleBtn.addEventListener("click", () => {
    nav.classList.contains("is-open") ? closeNav() : openNav();
  });
  overlay.addEventListener("click", closeNav);
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
}

/* --------------------------- Sticky header shadow ------------------------ */
function initHeaderScrollShadow() {
  const header = document.getElementById("site-header");
  if (!header) return;
  const applyShadow = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", applyShadow, { passive: true });
  applyShadow();
}

/* --------------------------- Back to top button --------------------------- */
function initBackToTop() {
  const button = document.getElementById("back-to-top");
  if (!button) return;
  window.addEventListener("scroll", () => {
    button.classList.toggle("is-visible", window.scrollY > 480);
  }, { passive: true });
  button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/* --------------------------- Active nav link highlighting ----------------- */
function highlightActiveNavLink() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a, .mobile-bottom-nav a").forEach((link) => {
    const linkPage = link.getAttribute("href")?.split("/").pop();
    link.classList.toggle("active", linkPage === currentPage);
  });
}

/* --------------------------- Footer year ----------------------------------- */
function setFooterYear() {
  document.querySelectorAll("#footer-year").forEach((el) => {
    el.textContent = new Intl.NumberFormat("fa-IR").format(new Date().getFullYear());
  });
}

/* --------------------------- Newsletter form -------------------------------- */
function initNewsletterForm() {
  const form = document.getElementById("newsletter-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("newsletter-email");
    if (!input.value.trim()) return;
    showToast("عضویت شما در خبرنامه با موفقیت ثبت شد.", "success");
    form.reset();
  });
}

/* --------------------------- Reveal on scroll -------------------------------- */
function initRevealOnScroll() {
  const revealEls = document.querySelectorAll(".reveal");
  if (!revealEls.length) return;

  if (!("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach((el) => observer.observe(el));
}

/* --------------------------- Auth tabs (profile.html guest view) ---------- */
function initAuthTabs() {
  const tabButtons = document.querySelectorAll(".auth-tabs button");
  if (!tabButtons.length) return;

  function activate(target) {
    tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === target));
    document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.toggle("active", panel.id === target));
  }

  tabButtons.forEach((btn) => btn.addEventListener("click", () => activate(btn.dataset.tab)));
  document.querySelectorAll("[data-switch-tab]").forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.switchTab));
  });
}

/* --------------------------- Hero slider (home page) -------------------------- */
let heroAutoplayTimer = null;

function heroSlideTemplate(slide, index) {
  return `
    <div class="hero-slide ${index === 0 ? "is-active" : ""}" data-index="${index}">
      <div class="hero-slide__bg" style="background-image:url('${slide.image}')"></div>
      <div class="hero-slide__content">
        <span class="hero-slide__eyebrow">عمارت ۵ دری</span>
        <h2>${slide.title || ""}</h2>
        <p>${slide.subtitle || ""}</p>
        ${slide.buttonText ? `<a href="${slide.buttonLink || "products.html"}" class="btn btn--accent">${slide.buttonText}</a>` : ""}
      </div>
    </div>
  `;
}

function goToHeroSlide(container, dotsContainer, index) {
  const slides = container.querySelectorAll(".hero-slide");
  const dots = dotsContainer.querySelectorAll("button");
  slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
  dots.forEach((dot, i) => dot.classList.toggle("is-active", i === index));
}

async function initHeroSlider() {
  const container = document.getElementById("hero-slider");
  const dotsContainer = document.getElementById("hero-slider-dots");
  if (!container) return;

  try {
    const snap = await getDoc(doc(collections.settings, "homeSlider"));
    const slides = snap.exists() ? snap.data().slides || [] : [];

    skeletonOff(container);

    if (!slides.length) {
      container.innerHTML = '<p class="empty-state">اسلایدی برای نمایش ثبت نشده است.</p>';
      return;
    }

    container.innerHTML = slides.map(heroSlideTemplate).join("");
    if (dotsContainer) {
      dotsContainer.innerHTML = slides
        .map((_, i) => `<button type="button" aria-label="اسلاید ${i + 1}" class="${i === 0 ? "is-active" : ""}"></button>`)
        .join("");
    }

    let currentIndex = 0;
    function next() { currentIndex = (currentIndex + 1) % slides.length; goToHeroSlide(container, dotsContainer, currentIndex); }
    function prev() { currentIndex = (currentIndex - 1 + slides.length) % slides.length; goToHeroSlide(container, dotsContainer, currentIndex); }

    document.getElementById("hero-prev")?.addEventListener("click", () => { prev(); resetAutoplay(); });
    document.getElementById("hero-next")?.addEventListener("click", () => { next(); resetAutoplay(); });

    dotsContainer?.querySelectorAll("button").forEach((dot, i) => {
      dot.addEventListener("click", () => {
        currentIndex = i;
        goToHeroSlide(container, dotsContainer, currentIndex);
        resetAutoplay();
      });
    });

    function resetAutoplay() {
      if (heroAutoplayTimer) clearInterval(heroAutoplayTimer);
      if (slides.length > 1) heroAutoplayTimer = setInterval(next, 6000);
    }
    resetAutoplay();

    const heroSection = container.closest(".hero");
    heroSection?.addEventListener("mouseenter", () => clearInterval(heroAutoplayTimer));
    heroSection?.addEventListener("mouseleave", resetAutoplay);
  } catch (error) {
    console.error("خطا در بارگذاری اسلایدر:", error);
    skeletonOff(container);
    container.innerHTML = '<p class="empty-state">خطا در بارگذاری اسلایدر.</p>';
  }
}

/* ==========================================================================
   INIT
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initHeaderScrollShadow();
  initBackToTop();
  highlightActiveNavLink();
  setFooterYear();
  initNewsletterForm();
  initRevealOnScroll();
  initHeroSlider();
  initAuthTabs();
});
