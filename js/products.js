/* ==========================================================================
   عمارت ۵ دری — products.js
   Handles: rendering product/category/review/gallery cards, loading all
   dynamic homepage sections from Firestore, the products listing page
   (search + filter + sort + pagination), the product details page
   (with related products), and wishlist logic.

   Expected DOM hooks (each loader only runs if its container exists):
     #featured-categories        (home)
     #latest-products            (home)
     #best-selling-products      (home)
     #discount-products          (home)
     #testimonials               (home)
     #gallery-preview            (home)
     #products-toolbar / #products-grid / #products-pagination   (products.html)
     #product-detail             (product.html)   — reads ?id= from the URL
     #related-products           (product.html)
   ========================================================================== */

import { db, collections, storagePaths } from "./firebase.js";
import {
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, formatPrice, skeletonOff } from "./script.js";
import { getCurrentUser } from "./auth.js";
import { addToCart } from "./cart.js";

/* ------------------------------------------------------------------------
   1. RENDER HELPERS
   ------------------------------------------------------------------------ */

function renderStars(rating = 0) {
  const rounded = Math.round(rating);
  return "★".repeat(rounded) + "☆".repeat(5 - rounded);
}

function productPrice(product) {
  const hasDiscount = product.discount && product.discount > 0;
  const finalPrice = hasDiscount
    ? Math.round(product.price - (product.price * product.discount) / 100)
    : product.price;
  return { finalPrice, hasDiscount };
}

export function createProductCardEl(product) {
  const { finalPrice, hasDiscount } = productPrice(product);
  const outOfStock = !product.stock || product.stock <= 0;
  const mainImage = (product.images && product.images[0]) || "assets/images/placeholder-product.jpg";

  const card = document.createElement("article");
  card.className = "product-card";
  card.innerHTML = `
    <div class="product-card__media">
      <a href="product.html?id=${product.id}" aria-label="${product.title}">
        <img src="${mainImage}" alt="${product.title}" loading="lazy" width="400" height="400">
      </a>
      ${hasDiscount ? `<span class="product-card__discount">${product.discount}%-</span>` : ""}
      <button class="product-card__wishlist" data-product-id="${product.id}" aria-label="افزودن به علاقه‌مندی‌ها">
        <svg viewBox="0 0 24 24"><path d="M12 21s-6.7-4.3-9.3-8.1C.8 10.1 1.6 6.4 4.7 5c2.2-1 4.6-.3 5.9 1.4l1.4 1.8 1.4-1.8c1.3-1.7 3.7-2.4 5.9-1.4 3.1 1.4 3.9 5.1 2 7.9C18.7 16.7 12 21 12 21z"/></svg>
      </button>
    </div>
    <div class="product-card__body">
      <span class="product-card__category">${product.categoryName || ""}</span>
      <h3 class="product-card__title">
        <a href="product.html?id=${product.id}">${product.title}</a>
      </h3>
      <div class="product-card__rating" aria-label="امتیاز ${product.rating || 0} از ۵">
        ${renderStars(product.rating || 0)}
        <span>(${product.reviewCount || 0})</span>
      </div>
      <div class="product-card__price">
        <ins>${formatPrice(finalPrice)}</ins>
        ${hasDiscount ? `<del>${formatPrice(product.price)}</del>` : ""}
      </div>
      <button class="product-card__cta" data-product-id="${product.id}" ${outOfStock ? "disabled" : ""}>
        ${outOfStock ? "ناموجود" : "افزودن به سبد خرید"}
      </button>
    </div>
  `;

  card.querySelector(".product-card__cta").addEventListener("click", () => {
    if (!outOfStock) addToCart(product.id, 1);
  });
  card.querySelector(".product-card__wishlist").addEventListener("click", (event) => {
    event.preventDefault();
    toggleWishlist(product.id, card.querySelector(".product-card__wishlist"));
  });

  return card;
}

function createCategoryCardEl(category) {
  const a = document.createElement("a");
  a.href = `products.html?category=${category.id}`;
  a.className = "category-card";
  a.innerHTML = `
    <img src="${category.image || "assets/images/placeholder-category.jpg"}" alt="${category.name}" loading="lazy">
    <span class="category-card__label">${category.name}</span>
  `;
  return a;
}

function createReviewCardEl(review) {
  const div = document.createElement("div");
  div.className = "review-card";
  div.innerHTML = `
    <div class="review-card__stars">${renderStars(review.rating || 5)}</div>
    <p class="review-card__text">${review.text || ""}</p>
    <div class="review-card__author">
      <div class="review-card__avatar">
        <img src="${review.avatar || "assets/images/placeholder-avatar.jpg"}" alt="${review.name || "مشتری"}" loading="lazy">
      </div>
      <span class="review-card__name">${review.name || "مشتری عمارت ۵ دری"}</span>
    </div>
  `;
  return div;
}

function createGalleryItemEl(imageUrl) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  div.innerHTML = `<img src="${imageUrl}" alt="نمونه کار عمارت ۵ دری" loading="lazy">`;
  return div;
}

/* ------------------------------------------------------------------------
   2. HOMEPAGE LOADERS
   ------------------------------------------------------------------------ */

async function loadFeaturedCategories() {
  const container = document.getElementById("featured-categories");
  if (!container) return;
  try {
    const q = query(collections.categories, orderBy("order", "asc"), limit(5));
    const snapshot = await getDocs(q);
    skeletonOff(container);
    if (snapshot.empty) {
      container.innerHTML = "<p class=\"empty-state\">هنوز دسته‌بندی‌ای ثبت نشده است.</p>";
      return;
    }
    snapshot.forEach((docSnap) => {
      container.appendChild(createCategoryCardEl({ id: docSnap.id, ...docSnap.data() }));
    });
  } catch (error) {
    console.error("خطا در بارگذاری دسته‌بندی‌ها:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری دسته‌بندی‌ها.</p>";
  }
}

async function loadProductSection(containerId, buildQuery) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const snapshot = await getDocs(buildQuery());
    skeletonOff(container);
    if (snapshot.empty) {
      container.innerHTML = "<p class=\"empty-state\">محصولی برای نمایش وجود ندارد.</p>";
      return;
    }
    snapshot.forEach((docSnap) => {
      container.appendChild(createProductCardEl({ id: docSnap.id, ...docSnap.data() }));
    });
  } catch (error) {
    console.error(`خطا در بارگذاری بخش ${containerId}:`, error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری محصولات.</p>";
  }
}

function loadLatestProducts() {
  return loadProductSection("latest-products", () =>
    query(collections.products, orderBy("createdAt", "desc"), limit(4))
  );
}

function loadBestSellingProducts() {
  return loadProductSection("best-selling-products", () =>
    query(collections.products, where("bestSeller", "==", true), limit(4))
  );
}

function loadDiscountProducts() {
  return loadProductSection("discount-products", () =>
    query(collections.products, where("discount", ">", 0), limit(4))
  );
}

async function loadTestimonials() {
  const container = document.getElementById("testimonials");
  if (!container) return;
  try {
    const q = query(collections.reviews, orderBy("createdAt", "desc"), limit(3));
    const snapshot = await getDocs(q);
    skeletonOff(container);
    if (snapshot.empty) {
      container.innerHTML = "<p class=\"empty-state\">هنوز نظری ثبت نشده است.</p>";
      return;
    }
    snapshot.forEach((docSnap) => container.appendChild(createReviewCardEl(docSnap.data())));
  } catch (error) {
    console.error("خطا در بارگذاری نظرات مشتریان:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری نظرات.</p>";
  }
}

async function loadGalleryPreview() {
  const container = document.getElementById("gallery-preview");
  if (!container) return;
  try {
    const settingsDoc = await getDoc(doc(collections.settings, "gallery"));
    skeletonOff(container);
    const images = settingsDoc.exists() ? settingsDoc.data().images || [] : [];
    if (!images.length) {
      container.innerHTML = "<p class=\"empty-state\">تصویری در گالری ثبت نشده است.</p>";
      return;
    }
    images.slice(0, 6).forEach((url) => container.appendChild(createGalleryItemEl(url)));
  } catch (error) {
    console.error("خطا در بارگذاری گالری:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری گالری.</p>";
  }
}

async function loadAllCategories() {
  const container = document.getElementById("all-categories-grid");
  if (!container) return;
  try {
    const q = query(collections.categories, orderBy("order", "asc"));
    const snapshot = await getDocs(q);
    skeletonOff(container);
    if (snapshot.empty) {
      container.innerHTML = "<p class=\"empty-state\">هنوز دسته‌بندی‌ای ثبت نشده است.</p>";
      return;
    }
    snapshot.forEach((docSnap) => {
      container.appendChild(createCategoryCardEl({ id: docSnap.id, ...docSnap.data() }));
    });
  } catch (error) {
    console.error("خطا در بارگذاری دسته‌بندی‌ها:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری دسته‌بندی‌ها.</p>";
  }
}

async function loadFullGallery() {
  const container = document.getElementById("full-gallery-grid");
  if (!container) return;
  try {
    const settingsDoc = await getDoc(doc(collections.settings, "gallery"));
    skeletonOff(container);
    const images = settingsDoc.exists() ? settingsDoc.data().images || [] : [];
    if (!images.length) {
      container.innerHTML = "<p class=\"empty-state\">هنوز تصویری در گالری ثبت نشده است.</p>";
      return;
    }
    images.forEach((url) => {
      const item = createGalleryItemEl(url);
      item.addEventListener("click", () => openLightbox(url));
      container.appendChild(item);
    });
  } catch (error) {
    console.error("خطا در بارگذاری گالری:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری گالری.</p>";
  }
}

function openLightbox(imageUrl) {
  let lightbox = document.getElementById("gallery-lightbox");
  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.id = "gallery-lightbox";
    lightbox.className = "lightbox";
    lightbox.innerHTML = `
      <button type="button" class="lightbox__close" aria-label="بستن">×</button>
      <img class="lightbox__image" alt="نمونه کار عمارت ۵ دری">
    `;
    document.body.appendChild(lightbox);
    lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
    lightbox.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  }
  lightbox.querySelector(".lightbox__image").src = imageUrl;
  lightbox.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  document.getElementById("gallery-lightbox")?.classList.remove("is-open");
  document.body.style.overflow = "";
}

/* ------------------------------------------------------------------------
   3. WISHLIST
   ------------------------------------------------------------------------ */

export async function getWishlist() {
  const user = await getCurrentUser();
  if (!user) return [];
  const userDoc = await getDoc(doc(collections.users, user.uid));
  return userDoc.exists() ? userDoc.data().wishlist || [] : [];
}

export async function toggleWishlist(productId, buttonEl) {
  const user = await getCurrentUser();
  if (!user) {
    showToast("برای افزودن به علاقه‌مندی‌ها ابتدا وارد حساب کاربری شوید.", "error");
    window.location.href = "profile.html";
    return;
  }
  const userRef = doc(collections.users, user.uid);
  const isActive = buttonEl?.classList.contains("is-active");
  try {
    await updateDoc(userRef, {
      wishlist: isActive ? arrayRemove(productId) : arrayUnion(productId)
    });
    if (buttonEl) buttonEl.classList.toggle("is-active", !isActive);
    showToast(isActive ? "از علاقه‌مندی‌ها حذف شد." : "به علاقه‌مندی‌ها اضافه شد.", "success");
    updateWishlistBadge();
  } catch (error) {
    console.error("خطا در بروزرسانی علاقه‌مندی‌ها:", error);
    showToast("خطا در بروزرسانی علاقه‌مندی‌ها.", "error");
  }
}

export async function updateWishlistBadge() {
  const badge = document.getElementById("wishlist-count");
  if (!badge) return;
  const wishlist = await getWishlist();
  badge.textContent = wishlist.length;
}

async function loadWishlistPage() {
  const container = document.getElementById("wishlist-grid");
  if (!container) return;

  const user = await getCurrentUser();
  if (!user || user.isAnonymous) {
    container.innerHTML = `
      <div class="cart-empty">
        <p>برای مشاهده علاقه‌مندی‌ها ابتدا وارد حساب کاربری خود شوید.</p>
        <a href="profile.html" class="btn btn--primary">ورود به حساب کاربری</a>
      </div>`;
    return;
  }

  try {
    const productIds = await getWishlist();
    if (!productIds.length) {
      container.innerHTML = `
        <div class="cart-empty">
          <p>لیست علاقه‌مندی‌های شما خالی است.</p>
          <a href="products.html" class="btn btn--primary">مشاهده محصولات</a>
        </div>`;
      return;
    }

    container.innerHTML = "";
    const products = await Promise.all(
      productIds.map(async (id) => {
        const snap = await getDoc(doc(collections.products, id));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
      })
    );

    products.filter(Boolean).forEach((product) => {
      const card = createProductCardEl(product);
      card.querySelector(".product-card__wishlist")?.classList.add("is-active");
      container.appendChild(card);
    });
  } catch (error) {
    console.error("خطا در بارگذاری علاقه‌مندی‌ها:", error);
    container.innerHTML = '<p class="empty-state">خطا در بارگذاری علاقه‌مندی‌ها.</p>';
  }
}

/* ------------------------------------------------------------------------
   4. PRODUCTS LISTING PAGE (products.html) — search, filter, sort
   ------------------------------------------------------------------------ */

let lastVisibleDoc = null;

async function loadProductsListing(reset = true) {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const params = new URLSearchParams(window.location.search);
  const searchTerm = (params.get("q") || "").trim().toLowerCase();
  const categoryId = params.get("category") || document.getElementById("filter-category")?.value || "";
  const sortValue = document.getElementById("filter-sort")?.value || "newest";

  const constraints = [];
  if (categoryId) constraints.push(where("categoryId", "==", categoryId));

  switch (sortValue) {
    case "price-asc": constraints.push(orderBy("price", "asc")); break;
    case "price-desc": constraints.push(orderBy("price", "desc")); break;
    case "bestselling": constraints.push(orderBy("salesCount", "desc")); break;
    default: constraints.push(orderBy("createdAt", "desc"));
  }

  if (reset) {
    grid.innerHTML = "";
    lastVisibleDoc = null;
    grid.dataset.loading = "true";
    grid.innerHTML = Array(8).fill('<div class="skeleton skeleton--product"></div>').join("");
  }

  const pageQuery = lastVisibleDoc
    ? query(collections.products, ...constraints, startAfter(lastVisibleDoc), limit(12))
    : query(collections.products, ...constraints, limit(12));

  try {
    const snapshot = await getDocs(pageQuery);
    if (reset) grid.innerHTML = "";
    grid.removeAttribute("data-loading");

    let docs = snapshot.docs;
    if (searchTerm) {
      docs = docs.filter((d) => (d.data().title || "").toLowerCase().includes(searchTerm));
    }

    if (docs.length === 0 && reset) {
      grid.innerHTML = "<p class=\"empty-state\">محصولی مطابق با جستجوی شما یافت نشد.</p>";
    } else {
      docs.forEach((d) => grid.appendChild(createProductCardEl({ id: d.id, ...d.data() })));
    }

    lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1] || lastVisibleDoc;

    const loadMoreBtn = document.getElementById("load-more-products");
    if (loadMoreBtn) loadMoreBtn.hidden = snapshot.docs.length < 12;
  } catch (error) {
    console.error("خطا در بارگذاری محصولات:", error);
    if (reset) grid.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری محصولات. لطفاً دوباره تلاش کنید.</p>";
  }
}

async function populateCategoryFilter() {
  const select = document.getElementById("filter-category");
  if (!select) return;
  try {
    const snapshot = await getDocs(query(collections.categories, orderBy("order", "asc")));
    const currentCategory = new URLSearchParams(window.location.search).get("category") || "";
    snapshot.forEach((docSnap) => {
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = docSnap.data().name;
      if (docSnap.id === currentCategory) option.selected = true;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("خطا در بارگذاری فیلتر دسته‌بندی:", error);
  }
}

function initProductsListingPage() {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const searchTerm = new URLSearchParams(window.location.search).get("q");
  const countLabel = document.getElementById("products-count-label");
  if (countLabel && searchTerm) countLabel.textContent = `نتایج جستجو برای «${searchTerm}»`;

  populateCategoryFilter().then(() => loadProductsListing(true));

  document.getElementById("filter-category")?.addEventListener("change", () => loadProductsListing(true));
  document.getElementById("filter-sort")?.addEventListener("change", () => loadProductsListing(true));
  document.getElementById("load-more-products")?.addEventListener("click", () => loadProductsListing(false));

  const priceForm = document.getElementById("filter-price-form");
  if (priceForm) {
    priceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      loadProductsListing(true);
    });
  }
}

/* ------------------------------------------------------------------------
   5. PRODUCT DETAILS PAGE (product.html)
   ------------------------------------------------------------------------ */

async function initProductDetailsPage() {
  const container = document.getElementById("product-detail");
  if (!container) return;

  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId) {
    container.innerHTML = "<p class=\"empty-state\">محصول مورد نظر یافت نشد.</p>";
    return;
  }

  try {
    const snap = await getDoc(doc(collections.products, productId));
    if (!snap.exists()) {
      container.innerHTML = "<p class=\"empty-state\">این محصول دیگر موجود نیست.</p>";
      return;
    }
    const product = { id: snap.id, ...snap.data() };
    renderProductDetails(container, product);
    loadRelatedProducts(product);
    loadProductReviews(product.id);
    wireReviewForm(product.id);
  } catch (error) {
    console.error("خطا در بارگذاری جزئیات محصول:", error);
    container.innerHTML = "<p class=\"empty-state\">خطا در بارگذاری اطلاعات محصول.</p>";
  }
}

async function loadProductReviews(productId) {
  const container = document.getElementById("product-reviews-list");
  if (!container) return;
  try {
    const q = query(collections.reviews, where("productId", "==", productId), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      container.innerHTML = '<p class="empty-state">هنوز نظری برای این محصول ثبت نشده است. اولین نفر باشید!</p>';
      return;
    }
    container.innerHTML = "";
    snapshot.forEach((docSnap) => container.appendChild(createReviewCardEl(docSnap.data())));
  } catch (error) {
    console.error("خطا در بارگذاری نظرات محصول:", error);
    container.innerHTML = '<p class="empty-state">خطا در بارگذاری نظرات.</p>';
  }
}

function wireReviewForm(productId) {
  const form = document.getElementById("review-form");
  if (!form) return;

  const stars = form.querySelectorAll(".review-form__stars button");
  let selectedRating = 5;
  stars.forEach((star) => {
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.value);
      stars.forEach((s) => s.classList.toggle("is-active", Number(s.dataset.value) <= selectedRating));
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = await getCurrentUser();
    if (!user || user.isAnonymous) {
      showToast("برای ثبت نظر ابتدا وارد حساب کاربری خود شوید.", "error");
      window.location.href = "profile.html";
      return;
    }
    const textInput = document.getElementById("review-text");
    const text = textInput.value.trim();
    if (!text) return;

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await addDoc(collections.reviews, {
        productId,
        rating: selectedRating,
        text,
        name: user.displayName || "مشتری عمارت ۵ دری",
        userId: user.uid,
        createdAt: serverTimestamp()
      });

      const productRef = doc(collections.products, productId);
      const productSnap = await getDoc(productRef);
      const p = productSnap.data();
      const newCount = (p.reviewCount || 0) + 1;
      const newAverage = ((p.rating || 0) * (p.reviewCount || 0) + selectedRating) / newCount;
      await updateDoc(productRef, { rating: Math.round(newAverage * 10) / 10, reviewCount: newCount });

      showToast("نظر شما با موفقیت ثبت شد.", "success");
      form.reset();
      loadProductReviews(productId);
    } catch (error) {
      console.error("خطا در ثبت نظر:", error);
      showToast("خطا در ثبت نظر.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function renderProductDetails(container, product) {
  const { finalPrice, hasDiscount } = productPrice(product);
  const outOfStock = !product.stock || product.stock <= 0;
  const images = product.images && product.images.length ? product.images : ["assets/images/placeholder-product.jpg"];

  document.title = `${product.title} | عمارت ۵ دری`;
  const breadcrumbName = document.getElementById("breadcrumb-product-name");
  if (breadcrumbName) breadcrumbName.textContent = product.title;

  container.innerHTML = `
    <div class="product-detail__gallery">
      <div class="product-detail__main-image">
        <img id="product-main-image" src="${images[0]}" alt="${product.title}">
      </div>
      <div class="product-detail__thumbs">
        ${images.map((img, i) => `<button class="product-detail__thumb ${i === 0 ? "is-active" : ""}" data-image="${img}"><img src="${img}" alt="تصویر ${i + 1}" loading="lazy"></button>`).join("")}
      </div>
    </div>
    <div class="product-detail__info">
      <span class="product-card__category">${product.categoryName || ""}</span>
      <h1>${product.title}</h1>
      <div class="product-card__rating" aria-label="امتیاز ${product.rating || 0} از ۵">
        ${renderStars(product.rating || 0)} <span>(${product.reviewCount || 0} نظر)</span>
      </div>
      <div class="product-detail__price">
        <ins>${formatPrice(finalPrice)}</ins>
        ${hasDiscount ? `<del>${formatPrice(product.price)}</del><span class="product-card__discount">${product.discount}%-</span>` : ""}
      </div>
      <p class="product-detail__stock">${outOfStock ? "ناموجود" : `موجود در انبار (${product.stock} عدد)`}</p>
      <p class="product-detail__description">${product.description || ""}</p>
      <div class="product-detail__actions">
        <div class="qty-input">
          <button type="button" id="qty-decrease" aria-label="کاهش تعداد">-</button>
          <input type="number" id="product-qty" value="1" min="1" max="${product.stock || 1}">
          <button type="button" id="qty-increase" aria-label="افزایش تعداد">+</button>
        </div>
        <button class="btn btn--primary" id="add-to-cart-btn" ${outOfStock ? "disabled" : ""}>افزودن به سبد خرید</button>
        <button class="product-card__wishlist" id="detail-wishlist-btn" data-product-id="${product.id}" aria-label="افزودن به علاقه‌مندی‌ها">
          <svg viewBox="0 0 24 24"><path d="M12 21s-6.7-4.3-9.3-8.1C.8 10.1 1.6 6.4 4.7 5c2.2-1 4.6-.3 5.9 1.4l1.4 1.8 1.4-1.8c1.3-1.7 3.7-2.4 5.9-1.4 3.1 1.4 3.9 5.1 2 7.9C18.7 16.7 12 21 12 21z"/></svg>
        </button>
      </div>
      ${product.specifications ? renderSpecsTable(product.specifications) : ""}
    </div>
  `;

  container.querySelectorAll(".product-detail__thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("product-main-image").src = btn.dataset.image;
      container.querySelectorAll(".product-detail__thumb").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });

  const qtyInput = document.getElementById("product-qty");
  document.getElementById("qty-increase").addEventListener("click", () => {
    qtyInput.value = Math.min(Number(qtyInput.value) + 1, product.stock || 99);
  });
  document.getElementById("qty-decrease").addEventListener("click", () => {
    qtyInput.value = Math.max(Number(qtyInput.value) - 1, 1);
  });
  document.getElementById("add-to-cart-btn")?.addEventListener("click", () => {
    addToCart(product.id, Number(qtyInput.value));
  });
  document.getElementById("detail-wishlist-btn")?.addEventListener("click", () => {
    toggleWishlist(product.id, document.getElementById("detail-wishlist-btn"));
  });
}

function renderSpecsTable(specifications) {
  const rows = Object.entries(specifications)
    .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
    .join("");
  return `<table class="product-detail__specs"><tbody>${rows}</tbody></table>`;
}

async function loadRelatedProducts(product) {
  const container = document.getElementById("related-products");
  if (!container || !product.categoryId) return;
  try {
    const q = query(
      collections.products,
      where("categoryId", "==", product.categoryId),
      limit(5)
    );
    const snapshot = await getDocs(q);
    skeletonOff(container);
    snapshot.forEach((docSnap) => {
      if (docSnap.id === product.id) return;
      container.appendChild(createProductCardEl({ id: docSnap.id, ...docSnap.data() }));
    });
  } catch (error) {
    console.error("خطا در بارگذاری محصولات مرتبط:", error);
  }
}

/* ------------------------------------------------------------------------
   6. INIT
   ------------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  loadFeaturedCategories();
  loadAllCategories();
  loadLatestProducts();
  loadBestSellingProducts();
  loadDiscountProducts();
  loadTestimonials();
  loadGalleryPreview();
  loadFullGallery();
  updateWishlistBadge();
  initProductsListingPage();
  initProductDetailsPage();
  loadWishlistPage();
});
