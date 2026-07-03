/* ==========================================================================
   عمارت ۵ دری — admin.js
   Controls the entire admin dashboard (admin.html). Everything here is
   gated behind a confirmed entry in the 'admins' Firestore collection.

   Expected DOM hooks are documented above each section below. Every
   function only runs if its container exists, so admin.html can grow
   incrementally without breaking this file.
   ========================================================================== */

import { auth, collections, storagePaths, cloudinaryConfig } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, formatPrice, toggleButtonLoading, escapeHtml, formatDate } from "./script.js";

/* ------------------------------------------------------------------------
   1. AUTH GATE — toggles #admin-login-screen vs #admin-shell
   ------------------------------------------------------------------------ */
async function isAdminUser(uid) {
  if (!uid) return false;
  const snap = await getDoc(doc(collections.admins, uid));
  return snap.exists();
}

onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById("admin-login-screen");
  const shell = document.getElementById("admin-shell");
  if (!loginScreen || !shell) return; // not on admin.html

  const admin = user && !user.isAnonymous ? await isAdminUser(user.uid) : false;

  loginScreen.hidden = admin;
  shell.hidden = !admin;

  if (admin) initDashboard();
});

let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  initSidebarToggle();
  loadStatistics();
  initProductsSection();
  initCategoriesSection();
  initOrdersSection();
  initCustomersSection();
  initDiscountsSection();
  initSliderSection();
  initGallerySection();
  initContactSettingsForm();
}

/* ------------------------------------------------------------------------
   2. SIDEBAR / GENERIC HELPERS
   ------------------------------------------------------------------------ */
function initSidebarToggle() {
  document.getElementById("admin-sidebar-toggle")?.addEventListener("click", () => {
    document.getElementById("admin-sidebar")?.classList.toggle("is-open");
  });
}

function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }
document.querySelectorAll(".admin-modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
});
document.querySelectorAll("[data-modal-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.modalClose));
});

/**
 * Uploads a single File to Cloudinary using an unsigned upload preset and
 * returns its secure_url. pathFn(file.name) is kept for backward
 * compatibility with every call site (product/category/slider/gallery
 * uploads) — it still produces the same "folder/id/filename" style string
 * used before with Firebase Storage, and is passed through as Cloudinary's
 * `folder` field so uploaded assets stay organized the same way in the
 * Cloudinary Media Library. If your unsigned preset doesn't allow an
 * overridden folder, Cloudinary will just fall back to the preset's
 * configured folder — the upload itself still succeeds either way.
 */
async function uploadImageToCloudinary(file, path) {
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`;

  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);
  if (folder) formData.append("folder", folder);

  const response = await fetch(endpoint, { method: "POST", body: formData });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "خطا در آپلود تصویر به Cloudinary");
  }

  return data.secure_url;
}

/** Uploads a list of File objects to Cloudinary and returns their secure_url values. */
async function uploadImages(files, pathFn) {
  const urls = [];
  for (const file of files) {
    const url = await uploadImageToCloudinary(file, pathFn(file.name));
    urls.push(url);
  }
  return urls;
}

/* ------------------------------------------------------------------------
   3. DASHBOARD STATISTICS
   ------------------------------------------------------------------------ */
async function loadStatistics() {
  const grid = document.getElementById("admin-stats-grid");
  if (!grid) return;
  try {
    const [productsCount, ordersCount, customersCount, ordersSnap] = await Promise.all([
      getCountFromServer(collections.products),
      getCountFromServer(collections.orders),
      getCountFromServer(collections.users),
      getDocs(query(collections.orders, orderBy("createdAt", "desc"), limit(200)))
    ]);

    const revenue = ordersSnap.docs.reduce((sum, d) => sum + (d.data().total || 0), 0);

    setStatValue("stat-products", productsCount.data().count);
    setStatValue("stat-orders", ordersCount.data().count);
    setStatValue("stat-customers", customersCount.data().count);
    setStatValue("stat-revenue", formatPrice(revenue));
  } catch (error) {
    console.error("خطا در بارگذاری آمار داشبورد:", error);
  }
}
function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* ------------------------------------------------------------------------
   4. PRODUCTS MANAGEMENT
   ------------------------------------------------------------------------ */
let selectedProductImages = [];

function initProductsSection() {
  const tableBody = document.querySelector("#admin-products-table tbody");
  if (!tableBody) return;

  loadProductsTable();
  loadCategoryOptionsInto("product-category-select");

  document.getElementById("add-product-btn")?.addEventListener("click", () => openProductModal());
  document.getElementById("product-form")?.addEventListener("submit", saveProduct);

  const dropzone = document.getElementById("product-images-dropzone");
  const fileInput = document.getElementById("product-images-input");
  dropzone?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", (e) => handleProductImageFiles(e.target.files));
  dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("is-dragover"); });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    handleProductImageFiles(e.dataTransfer.files);
  });
}

function handleProductImageFiles(fileList) {
  selectedProductImages = [...selectedProductImages, ...Array.from(fileList)];
  renderProductImagePreview();
}

function renderProductImagePreview() {
  const container = document.getElementById("product-images-preview");
  if (!container) return;
  container.innerHTML = "";
  selectedProductImages.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "image-upload-item";
    item.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="پیش‌نمایش تصویر"><button type="button" class="image-upload-item__remove">×</button>`;
    item.querySelector("button").addEventListener("click", () => {
      selectedProductImages.splice(index, 1);
      renderProductImagePreview();
    });
    container.appendChild(item);
  });
}

async function loadProductsTable() {
  const tableBody = document.querySelector("#admin-products-table tbody");
  tableBody.innerHTML = `<tr><td colspan="7" class="admin-table__empty">در حال بارگذاری...</td></tr>`;
  try {
    const snapshot = await getDocs(query(collections.products, orderBy("createdAt", "desc")));
    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="7" class="admin-table__empty">هنوز محصولی ثبت نشده است.</td></tr>`;
      return;
    }
    tableBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const product = { id: docSnap.id, ...docSnap.data() };
      const stockStatus = !product.stock ? "outofstock" : product.stock < 5 ? "lowstock" : "instock";
      const stockLabel = !product.stock ? "ناموجود" : product.stock < 5 ? "رو به اتمام" : "موجود";
      tableBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td><img class="admin-table__thumb" src="${(product.images && product.images[0]) || "assets/images/placeholder-product.jpg"}" alt="${product.title}"></td>
          <td>${escapeHtml(product.title)}</td>
          <td>${escapeHtml(product.categoryName || "-")}</td>
          <td>${formatPrice(product.price)}</td>
          <td>${product.discount ? product.discount + "%" : "-"}</td>
          <td><span class="status-pill status-pill--${stockStatus}">${stockLabel} (${product.stock || 0})</span></td>
          <td class="admin-table__actions">
            <button type="button" class="js-edit-product" data-id="${product.id}" aria-label="ویرایش">
              <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button type="button" class="danger js-delete-product" data-id="${product.id}" aria-label="حذف">
              <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>
            </button>
          </td>
        </tr>
      `);
    });

    tableBody.querySelectorAll(".js-edit-product").forEach((btn) =>
      btn.addEventListener("click", () => openProductModal(btn.dataset.id)));
    tableBody.querySelectorAll(".js-delete-product").forEach((btn) =>
      btn.addEventListener("click", () => deleteProduct(btn.dataset.id)));
  } catch (error) {
    console.error("خطا در بارگذاری محصولات:", error);
    tableBody.innerHTML = `<tr><td colspan="7" class="admin-table__empty">خطا در بارگذاری محصولات.</td></tr>`;
  }
}

async function openProductModal(productId = null) {
  const form = document.getElementById("product-form");
  form.reset();
  selectedProductImages = [];
  renderProductImagePreview();
  document.getElementById("product-id").value = productId || "";
  document.getElementById("product-modal-title").textContent = productId ? "ویرایش محصول" : "افزودن محصول جدید";

  if (productId) {
    const snap = await getDoc(doc(collections.products, productId));
    if (snap.exists()) {
      const p = snap.data();
      document.getElementById("product-title").value = p.title || "";
      document.getElementById("product-category-select").value = p.categoryId || "";
      document.getElementById("product-price").value = p.price || 0;
      document.getElementById("product-discount").value = p.discount || 0;
      document.getElementById("product-stock").value = p.stock || 0;
      document.getElementById("product-description").value = p.description || "";
      document.getElementById("product-featured").checked = !!p.featured;
      document.getElementById("product-bestseller").checked = !!p.bestSeller;
      if (p.images) {
        const existing = document.getElementById("product-existing-images");
        existing.innerHTML = p.images
          .map((url) => `<div class="image-upload-item"><img src="${url}" alt="تصویر محصول"></div>`)
          .join("");
      }
    }
  } else {
    document.getElementById("product-existing-images").innerHTML = "";
  }

  openModal("product-modal");
}

async function saveProduct(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector('[type="submit"]');
  const productId = document.getElementById("product-id").value;
  const categorySelect = document.getElementById("product-category-select");

  toggleButtonLoading(submitBtn, true);
  try {
    const newImageUrls = selectedProductImages.length
      ? await uploadImages(selectedProductImages, (name) => storagePaths.productImage(productId || Date.now().toString(), name))
      : [];

    const existingUrls = Array.from(document.querySelectorAll("#product-existing-images img")).map((img) => img.src);

    const data = {
      title: document.getElementById("product-title").value.trim(),
      categoryId: categorySelect.value,
      categoryName: categorySelect.selectedOptions[0]?.textContent || "",
      price: Number(document.getElementById("product-price").value),
      discount: Number(document.getElementById("product-discount").value) || 0,
      stock: Number(document.getElementById("product-stock").value) || 0,
      description: document.getElementById("product-description").value.trim(),
      featured: document.getElementById("product-featured").checked,
      bestSeller: document.getElementById("product-bestseller").checked,
      images: [...existingUrls, ...newImageUrls],
      updatedAt: serverTimestamp()
    };

    if (productId) {
      await updateDoc(doc(collections.products, productId), data);
      showToast("محصول با موفقیت بروزرسانی شد.", "success");
    } else {
      await addDoc(collections.products, { ...data, rating: 0, reviewCount: 0, salesCount: 0, createdAt: serverTimestamp() });
      showToast("محصول جدید با موفقیت ثبت شد.", "success");
    }

    closeModal("product-modal");
    loadProductsTable();
  } catch (error) {
    console.error("خطا در ذخیره محصول:", error);
    showToast("خطا در ذخیره محصول.", "error");
  } finally {
    toggleButtonLoading(submitBtn, false);
  }
}

async function deleteProduct(productId) {
  if (!window.confirm("آیا از حذف این محصول اطمینان دارید؟")) return;
  try {
    await deleteDoc(doc(collections.products, productId));
    showToast("محصول حذف شد.", "success");
    loadProductsTable();
  } catch (error) {
    console.error("خطا در حذف محصول:", error);
    showToast("خطا در حذف محصول.", "error");
  }
}

/* ------------------------------------------------------------------------
   5. CATEGORIES MANAGEMENT
   ------------------------------------------------------------------------ */
let selectedCategoryImage = null;

function initCategoriesSection() {
  const tableBody = document.querySelector("#admin-categories-table tbody");
  if (!tableBody) return;

  loadCategoriesTable();
  document.getElementById("add-category-btn")?.addEventListener("click", () => openCategoryModal());
  document.getElementById("category-form")?.addEventListener("submit", saveCategory);

  const input = document.getElementById("category-image-input");
  document.getElementById("category-image-dropzone")?.addEventListener("click", () => input.click());
  input?.addEventListener("change", (e) => {
    selectedCategoryImage = e.target.files[0] || null;
    if (selectedCategoryImage) {
      document.getElementById("category-image-preview").innerHTML =
        `<div class="image-upload-item"><img src="${URL.createObjectURL(selectedCategoryImage)}" alt="پیش‌نمایش"></div>`;
    }
  });
}

async function loadCategoriesTable() {
  const tableBody = document.querySelector("#admin-categories-table tbody");
  tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">در حال بارگذاری...</td></tr>`;
  try {
    const snapshot = await getDocs(query(collections.categories, orderBy("order", "asc")));
    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">هنوز دسته‌بندی‌ای ثبت نشده است.</td></tr>`;
      return;
    }
    tableBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const category = { id: docSnap.id, ...docSnap.data() };
      tableBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td><img class="admin-table__thumb" src="${category.image || "assets/images/placeholder-category.jpg"}" alt="${category.name}"></td>
          <td>${escapeHtml(category.name)}</td>
          <td>${category.order ?? "-"}</td>
          <td class="admin-table__actions">
            <button type="button" class="js-edit-category" data-id="${category.id}" aria-label="ویرایش">
              <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25z"/></svg>
            </button>
            <button type="button" class="danger js-delete-category" data-id="${category.id}" aria-label="حذف">
              <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>
            </button>
          </td>
        </tr>
      `);
    });
    tableBody.querySelectorAll(".js-edit-category").forEach((btn) =>
      btn.addEventListener("click", () => openCategoryModal(btn.dataset.id)));
    tableBody.querySelectorAll(".js-delete-category").forEach((btn) =>
      btn.addEventListener("click", () => deleteCategory(btn.dataset.id)));
  } catch (error) {
    console.error("خطا در بارگذاری دسته‌بندی‌ها:", error);
    tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">خطا در بارگذاری دسته‌بندی‌ها.</td></tr>`;
  }
}

async function loadCategoryOptionsInto(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  try {
    const snapshot = await getDocs(query(collections.categories, orderBy("order", "asc")));
    select.innerHTML = '<option value="">انتخاب دسته‌بندی</option>';
    snapshot.forEach((docSnap) => {
      const category = docSnap.data();
      select.insertAdjacentHTML("beforeend", `<option value="${docSnap.id}">${escapeHtml(category.name)}</option>`);
    });
  } catch (error) {
    console.error("خطا در بارگذاری لیست دسته‌بندی‌ها:", error);
  }
}

async function openCategoryModal(categoryId = null) {
  const form = document.getElementById("category-form");
  form.reset();
  selectedCategoryImage = null;
  document.getElementById("category-image-preview").innerHTML = "";
  document.getElementById("category-id").value = categoryId || "";
  document.getElementById("category-modal-title").textContent = categoryId ? "ویرایش دسته‌بندی" : "افزودن دسته‌بندی";

  if (categoryId) {
    const snap = await getDoc(doc(collections.categories, categoryId));
    if (snap.exists()) {
      const c = snap.data();
      document.getElementById("category-name").value = c.name || "";
      document.getElementById("category-order").value = c.order ?? 0;
      if (c.image) {
        document.getElementById("category-image-preview").innerHTML =
          `<div class="image-upload-item"><img src="${c.image}" alt="${c.name}"></div>`;
      }
    }
  }
  openModal("category-modal");
}

async function saveCategory(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector('[type="submit"]');
  const categoryId = document.getElementById("category-id").value;

  toggleButtonLoading(submitBtn, true);
  try {
    let imageUrl = document.querySelector("#category-image-preview img")?.src || "";
    if (selectedCategoryImage) {
      const [uploadedUrl] = await uploadImages(
        [selectedCategoryImage],
        (name) => storagePaths.categoryImage(categoryId || Date.now().toString(), name)
      );
      imageUrl = uploadedUrl;
    }

    const data = {
      name: document.getElementById("category-name").value.trim(),
      order: Number(document.getElementById("category-order").value) || 0,
      image: imageUrl
    };

    if (categoryId) {
      await updateDoc(doc(collections.categories, categoryId), data);
      showToast("دسته‌بندی بروزرسانی شد.", "success");
    } else {
      await addDoc(collections.categories, data);
      showToast("دسته‌بندی جدید ثبت شد.", "success");
    }

    closeModal("category-modal");
    loadCategoriesTable();
  } catch (error) {
    console.error("خطا در ذخیره دسته‌بندی:", error);
    showToast("خطا در ذخیره دسته‌بندی.", "error");
  } finally {
    toggleButtonLoading(submitBtn, false);
  }
}

async function deleteCategory(categoryId) {
  if (!window.confirm("آیا از حذف این دسته‌بندی اطمینان دارید؟")) return;
  try {
    await deleteDoc(doc(collections.categories, categoryId));
    showToast("دسته‌بندی حذف شد.", "success");
    loadCategoriesTable();
  } catch (error) {
    console.error("خطا در حذف دسته‌بندی:", error);
    showToast("خطا در حذف دسته‌بندی.", "error");
  }
}

/* ------------------------------------------------------------------------
   6. ORDERS MANAGEMENT
   ------------------------------------------------------------------------ */
function initOrdersSection() {
  const tableBody = document.querySelector("#admin-orders-table tbody");
  if (!tableBody) return;
  loadOrdersTable();
}

async function loadOrdersTable() {
  const tableBody = document.querySelector("#admin-orders-table tbody");
  tableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">در حال بارگذاری...</td></tr>`;
  try {
    const snapshot = await getDocs(query(collections.orders, orderBy("createdAt", "desc")));
    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">هنوز سفارشی ثبت نشده است.</td></tr>`;
      return;
    }
    tableBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const order = { id: docSnap.id, ...docSnap.data() };
      tableBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>#${order.id.slice(0, 6)}</td>
          <td>${escapeHtml(order.shippingInfo?.fullName || "-")}</td>
          <td>${formatDate(order.createdAt)}</td>
          <td>${formatPrice(order.total)}</td>
          <td>
            <select class="js-order-status" data-id="${order.id}">
              ${["pending", "processing", "completed", "cancelled"].map((s) =>
                `<option value="${s}" ${order.status === s ? "selected" : ""}>${orderStatusLabel(s)}</option>`
              ).join("")}
            </select>
          </td>
          <td class="admin-table__actions">
            <button type="button" class="js-view-order" data-id="${order.id}" aria-label="مشاهده">
              <svg viewBox="0 0 24 24"><path d="M12 5c-5.5 0-10 4.5-7 7-3 2.5 1.5 7 7 7s10-4.5 7-7c3-2.5-1.5-7-7-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
            </button>
          </td>
        </tr>
      `);
    });
    tableBody.querySelectorAll(".js-order-status").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          await updateDoc(doc(collections.orders, select.dataset.id), { status: select.value });
          showToast("وضعیت سفارش بروزرسانی شد.", "success");
        } catch (error) {
          console.error("خطا در بروزرسانی وضعیت سفارش:", error);
          showToast("خطا در بروزرسانی وضعیت سفارش.", "error");
        }
      });
    });
    tableBody.querySelectorAll(".js-view-order").forEach((btn) =>
      btn.addEventListener("click", () => viewOrderDetails(btn.dataset.id)));
  } catch (error) {
    console.error("خطا در بارگذاری سفارش‌ها:", error);
    tableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">خطا در بارگذاری سفارش‌ها.</td></tr>`;
  }
}

function orderStatusLabel(status) {
  return { pending: "در انتظار بررسی", processing: "در حال پردازش", completed: "تکمیل شده", cancelled: "لغو شده" }[status] || status;
}

async function viewOrderDetails(orderId) {
  const modalBody = document.getElementById("order-detail-body");
  if (!modalBody) return;
  const snap = await getDoc(doc(collections.orders, orderId));
  if (!snap.exists()) return;
  const order = snap.data();

  modalBody.innerHTML = `
    <p><strong>گیرنده:</strong> ${escapeHtml(order.shippingInfo?.fullName || "-")} — ${escapeHtml(order.shippingInfo?.phone || "-")}</p>
    <p><strong>آدرس:</strong> ${escapeHtml(order.shippingInfo?.address || "-")}, ${escapeHtml(order.shippingInfo?.city || "-")}</p>
    <table class="admin-table">
      <thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
      <tbody>
        ${(order.items || []).map((item) => `
          <tr>
            <td>${escapeHtml(item.title)}</td>
            <td>${item.quantity}</td>
            <td>${formatPrice(item.unitPrice)}</td>
            <td>${formatPrice(item.lineTotal)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <p><strong>مبلغ نهایی:</strong> ${formatPrice(order.total)}</p>
  `;
  openModal("order-detail-modal");
}

/* ------------------------------------------------------------------------
   7. CUSTOMERS MANAGEMENT
   ------------------------------------------------------------------------ */
function initCustomersSection() {
  const tableBody = document.querySelector("#admin-customers-table tbody");
  if (!tableBody) return;
  loadCustomersTable();
}

async function loadCustomersTable() {
  const tableBody = document.querySelector("#admin-customers-table tbody");
  tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">در حال بارگذاری...</td></tr>`;
  try {
    const snapshot = await getDocs(query(collections.users, orderBy("createdAt", "desc")));
    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">هنوز مشتری‌ای ثبت‌نام نکرده است.</td></tr>`;
      return;
    }
    tableBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const customer = docSnap.data();
      tableBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${escapeHtml(customer.name || "-")}</td>
          <td dir="ltr">${escapeHtml(customer.email || "-")}</td>
          <td dir="ltr">${escapeHtml(customer.phone || "-")}</td>
          <td>${formatDate(customer.createdAt)}</td>
        </tr>
      `);
    });
  } catch (error) {
    console.error("خطا در بارگذاری مشتریان:", error);
    tableBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">خطا در بارگذاری مشتریان.</td></tr>`;
  }
}

/* ------------------------------------------------------------------------
   8. DISCOUNTS / COUPONS
   ------------------------------------------------------------------------ */
function initDiscountsSection() {
  const tableBody = document.querySelector("#admin-discounts-table tbody");
  if (!tableBody) return;
  loadDiscountsTable();
  document.getElementById("add-discount-btn")?.addEventListener("click", () => openDiscountModal());
  document.getElementById("discount-form")?.addEventListener("submit", saveDiscount);
}

async function loadDiscountsTable() {
  const tableBody = document.querySelector("#admin-discounts-table tbody");
  tableBody.innerHTML = `<tr><td colspan="5" class="admin-table__empty">در حال بارگذاری...</td></tr>`;
  try {
    const snapshot = await getDocs(collections.discounts);
    if (snapshot.empty) {
      tableBody.innerHTML = `<tr><td colspan="5" class="admin-table__empty">هنوز کد تخفیفی ثبت نشده است.</td></tr>`;
      return;
    }
    tableBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const discount = { id: docSnap.id, ...docSnap.data() };
      tableBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td dir="ltr">${escapeHtml(discount.code)}</td>
          <td>${discount.percent}%</td>
          <td>${discount.expiresAt ? formatDate(discount.expiresAt) : "بدون انقضا"}</td>
          <td><span class="status-pill status-pill--${discount.active ? "completed" : "cancelled"}">${discount.active ? "فعال" : "غیرفعال"}</span></td>
          <td class="admin-table__actions">
            <button type="button" class="js-edit-discount" data-id="${discount.id}" aria-label="ویرایش">
              <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25z"/></svg>
            </button>
            <button type="button" class="danger js-delete-discount" data-id="${discount.id}" aria-label="حذف">
              <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>
            </button>
          </td>
        </tr>
      `);
    });
    tableBody.querySelectorAll(".js-edit-discount").forEach((btn) =>
      btn.addEventListener("click", () => openDiscountModal(btn.dataset.id)));
    tableBody.querySelectorAll(".js-delete-discount").forEach((btn) =>
      btn.addEventListener("click", () => deleteDiscount(btn.dataset.id)));
  } catch (error) {
    console.error("خطا در بارگذاری کدهای تخفیف:", error);
    tableBody.innerHTML = `<tr><td colspan="5" class="admin-table__empty">خطا در بارگذاری کدهای تخفیف.</td></tr>`;
  }
}

async function openDiscountModal(discountId = null) {
  const form = document.getElementById("discount-form");
  form.reset();
  document.getElementById("discount-id").value = discountId || "";
  document.getElementById("discount-modal-title").textContent = discountId ? "ویرایش کد تخفیف" : "افزودن کد تخفیف";

  if (discountId) {
    const snap = await getDoc(doc(collections.discounts, discountId));
    if (snap.exists()) {
      const d = snap.data();
      document.getElementById("discount-code").value = d.code || "";
      document.getElementById("discount-percent").value = d.percent || 0;
      document.getElementById("discount-active").checked = !!d.active;
      if (d.expiresAt) {
        document.getElementById("discount-expires").value = d.expiresAt.toDate().toISOString().slice(0, 10);
      }
    }
  }
  openModal("discount-modal");
}

async function saveDiscount(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector('[type="submit"]');
  const discountId = document.getElementById("discount-id").value;
  const expiresValue = document.getElementById("discount-expires").value;

  toggleButtonLoading(submitBtn, true);
  try {
    const data = {
      code: document.getElementById("discount-code").value.trim().toUpperCase(),
      percent: Number(document.getElementById("discount-percent").value),
      active: document.getElementById("discount-active").checked,
      expiresAt: expiresValue ? Timestamp.fromDate(new Date(expiresValue)) : null
    };

    if (discountId) {
      await updateDoc(doc(collections.discounts, discountId), data);
      showToast("کد تخفیف بروزرسانی شد.", "success");
    } else {
      await addDoc(collections.discounts, data);
      showToast("کد تخفیف جدید ثبت شد.", "success");
    }
    closeModal("discount-modal");
    loadDiscountsTable();
  } catch (error) {
    console.error("خطا در ذخیره کد تخفیف:", error);
    showToast("خطا در ذخیره کد تخفیف.", "error");
  } finally {
    toggleButtonLoading(submitBtn, false);
  }
}

async function deleteDiscount(discountId) {
  if (!window.confirm("آیا از حذف این کد تخفیف اطمینان دارید؟")) return;
  try {
    await deleteDoc(doc(collections.discounts, discountId));
    showToast("کد تخفیف حذف شد.", "success");
    loadDiscountsTable();
  } catch (error) {
    console.error("خطا در حذف کد تخفیف:", error);
    showToast("خطا در حذف کد تخفیف.", "error");
  }
}

/* ------------------------------------------------------------------------
   9. HOMEPAGE SLIDER MANAGEMENT (settings/homeSlider → { slides: [...] })
   ------------------------------------------------------------------------ */
let selectedSlideImage = null;

function initSliderSection() {
  const list = document.getElementById("admin-slider-list");
  if (!list) return;
  loadSliderList();

  document.getElementById("add-slide-btn")?.addEventListener("click", () => openSlideModal());
  document.getElementById("slide-form")?.addEventListener("submit", saveSlide);
  const slideInput = document.getElementById("slide-image-input");
  document.getElementById("slide-image-dropzone")?.addEventListener("click", () => slideInput.click());
  slideInput?.addEventListener("change", (e) => {
    selectedSlideImage = e.target.files[0] || null;
    if (selectedSlideImage) {
      document.getElementById("slide-image-preview").innerHTML =
        `<div class="image-upload-item"><img src="${URL.createObjectURL(selectedSlideImage)}" alt="پیش‌نمایش"></div>`;
    }
  });
}

async function getHomeSliderDoc() {
  const snap = await getDoc(doc(collections.settings, "homeSlider"));
  return snap.exists() ? snap.data().slides || [] : [];
}

async function loadSliderList() {
  const list = document.getElementById("admin-slider-list");
  list.innerHTML = `<p class="admin-table__empty">در حال بارگذاری...</p>`;
  try {
    const slides = await getHomeSliderDoc();
    if (!slides.length) {
      list.innerHTML = `<p class="admin-table__empty">هنوز اسلایدی ثبت نشده است.</p>`;
      return;
    }
    list.innerHTML = slides.map((slide, index) => `
      <div class="admin-card__body admin-slide-item">
        <img class="admin-table__thumb" src="${slide.image}" alt="${slide.title || ""}">
        <div><strong>${escapeHtml(slide.title || "")}</strong><p>${escapeHtml(slide.subtitle || "")}</p></div>
        <button type="button" class="danger js-delete-slide" data-index="${index}" aria-label="حذف">
          <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>
        </button>
      </div>
    `).join("");
    list.querySelectorAll(".js-delete-slide").forEach((btn) =>
      btn.addEventListener("click", () => deleteSlide(Number(btn.dataset.index))));
  } catch (error) {
    console.error("خطا در بارگذاری اسلایدر:", error);
    list.innerHTML = `<p class="admin-table__empty">خطا در بارگذاری اسلایدر.</p>`;
  }
}

function openSlideModal() {
  document.getElementById("slide-form")?.reset();
  selectedSlideImage = null;
  document.getElementById("slide-image-preview").innerHTML = "";
  openModal("slide-modal");
}

async function saveSlide(event) {
  event.preventDefault();
  const submitBtn = event.target.querySelector('[type="submit"]');
  if (!selectedSlideImage) {
    showToast("لطفاً یک تصویر برای اسلاید انتخاب کنید.", "error");
    return;
  }
  toggleButtonLoading(submitBtn, true);
  try {
    const [imageUrl] = await uploadImages([selectedSlideImage], (name) => storagePaths.sliderImage(`${Date.now()}-${name}`));
    const slides = await getHomeSliderDoc();
    slides.push({
      image: imageUrl,
      title: document.getElementById("slide-title").value.trim(),
      subtitle: document.getElementById("slide-subtitle").value.trim(),
      buttonText: document.getElementById("slide-button-text").value.trim(),
      buttonLink: document.getElementById("slide-button-link").value.trim()
    });
    await setDoc(doc(collections.settings, "homeSlider"), { slides }, { merge: true });
    showToast("اسلاید جدید اضافه شد.", "success");
    closeModal("slide-modal");
    loadSliderList();
  } catch (error) {
    console.error("خطا در ذخیره اسلاید:", error);
    showToast("خطا در ذخیره اسلاید.", "error");
  } finally {
    toggleButtonLoading(submitBtn, false);
  }
}

async function deleteSlide(index) {
  if (!window.confirm("آیا از حذف این اسلاید اطمینان دارید؟")) return;
  try {
    const slides = await getHomeSliderDoc();
    slides.splice(index, 1);
    await setDoc(doc(collections.settings, "homeSlider"), { slides }, { merge: true });
    showToast("اسلاید حذف شد.", "success");
    loadSliderList();
  } catch (error) {
    console.error("خطا در حذف اسلاید:", error);
    showToast("خطا در حذف اسلاید.", "error");
  }
}

/* ------------------------------------------------------------------------
   10. GALLERY MANAGEMENT (settings/gallery → { images: [...] })
   ------------------------------------------------------------------------ */
function initGallerySection() {
  const grid = document.getElementById("admin-gallery-grid");
  if (!grid) return;
  loadGalleryGrid();

  const input = document.getElementById("gallery-image-input");
  document.getElementById("admin-gallery-dropzone")?.addEventListener("click", () => input.click());
  input?.addEventListener("change", (e) => uploadGalleryImages(e.target.files));
}

async function getGalleryImages() {
  const snap = await getDoc(doc(collections.settings, "gallery"));
  return snap.exists() ? snap.data().images || [] : [];
}

async function loadGalleryGrid() {
  const grid = document.getElementById("admin-gallery-grid");
  grid.innerHTML = `<p class="admin-table__empty">در حال بارگذاری...</p>`;
  try {
    const images = await getGalleryImages();
    if (!images.length) {
      grid.innerHTML = `<p class="admin-table__empty">هنوز تصویری در گالری ثبت نشده است.</p>`;
      return;
    }
    grid.innerHTML = images.map((url, index) => `
      <div class="image-upload-item">
        <img src="${url}" alt="نمونه کار">
        <button type="button" class="image-upload-item__remove js-delete-gallery-image" data-index="${index}">×</button>
      </div>
    `).join("");
    grid.querySelectorAll(".js-delete-gallery-image").forEach((btn) =>
      btn.addEventListener("click", () => deleteGalleryImage(Number(btn.dataset.index))));
  } catch (error) {
    console.error("خطا در بارگذاری گالری:", error);
    grid.innerHTML = `<p class="admin-table__empty">خطا در بارگذاری گالری.</p>`;
  }
}

async function uploadGalleryImages(fileList) {
  try {
    const urls = await uploadImages(Array.from(fileList), (name) => storagePaths.galleryImage(`${Date.now()}-${name}`));
    const images = await getGalleryImages();
    await setDoc(doc(collections.settings, "gallery"), { images: [...images, ...urls] }, { merge: true });
    showToast("تصاویر گالری اضافه شد.", "success");
    loadGalleryGrid();
  } catch (error) {
    console.error("خطا در آپلود تصاویر گالری:", error);
    showToast("خطا در آپلود تصاویر گالری.", "error");
  }
}

async function deleteGalleryImage(index) {
  if (!window.confirm("آیا از حذف این تصویر اطمینان دارید؟")) return;
  try {
    const images = await getGalleryImages();
    images.splice(index, 1);
    await setDoc(doc(collections.settings, "gallery"), { images }, { merge: true });
    showToast("تصویر حذف شد.", "success");
    loadGalleryGrid();
  } catch (error) {
    console.error("خطا در حذف تصویر گالری:", error);
    showToast("خطا در حذف تصویر گالری.", "error");
  }
}

/* ------------------------------------------------------------------------
   11. CONTACT INFO SETTINGS (settings/contact)
   ------------------------------------------------------------------------ */
function initContactSettingsForm() {
  const form = document.getElementById("contact-settings-form");
  if (!form) return;

  getDoc(doc(collections.settings, "contact")).then((snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (document.getElementById("settings-phone")) document.getElementById("settings-phone").value = data.phone || "";
    if (document.getElementById("settings-eitaa")) document.getElementById("settings-eitaa").value = data.eitaa || "";
    if (document.getElementById("settings-address")) document.getElementById("settings-address").value = data.address || "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    toggleButtonLoading(submitBtn, true);
    try {
      await setDoc(doc(collections.settings, "contact"), {
        phone: document.getElementById("settings-phone").value.trim(),
        eitaa: document.getElementById("settings-eitaa").value.trim(),
        address: document.getElementById("settings-address").value.trim()
      }, { merge: true });
      showToast("اطلاعات تماس بروزرسانی شد.", "success");
    } catch (error) {
      console.error("خطا در ذخیره اطلاعات تماس:", error);
      showToast("خطا در ذخیره اطلاعات تماس.", "error");
    } finally {
      toggleButtonLoading(submitBtn, false);
    }
  });
}
