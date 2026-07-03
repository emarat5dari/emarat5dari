/* ==========================================================================
   عمارت ۵ دری — cart.js
   Cart data lives entirely in Firestore (carts/{uid}), per the project spec.
   Guests get a Firebase Anonymous Auth session so their cart still persists
   in Firestore (and survives a refresh) even before they create an account;
   when they log in with a real account, the guest cart is merged in.

   Expected DOM hooks:
     #cart-count / #mobile-cart-count   (header + mobile nav badges, any page)
     #cart-items / #cart-summary / #coupon-form   (cart.html)
     #checkout-form                     (checkout.html)
   ========================================================================== */

import { auth, db, collections } from "./firebase.js";
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, formatPrice, toggleButtonLoading } from "./script.js";

const SHIPPING_FLAT_RATE = 350000;   // تومان
const FREE_SHIPPING_THRESHOLD = 5000000; // تومان

/* ------------------------------------------------------------------------
   1. USER RESOLUTION (guests get an anonymous uid so carts stay in Firestore)
   ------------------------------------------------------------------------ */
let resolveUserPromise;
const userReady = new Promise((resolve) => { resolveUserPromise = resolve; });

let previousUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("خطا در ایجاد نشست میهمان:", error);
    }
    return; // onAuthStateChanged will fire again with the anonymous user
  }

  if (previousUid && previousUid !== user.uid && !user.isAnonymous) {
    await mergeCart(previousUid, user.uid);
  }
  previousUid = user.uid;
  resolveUserPromise(user);
  updateCartBadge();
});

function ensureUser() {
  return userReady;
}

/* ------------------------------------------------------------------------
   2. CART READ / WRITE HELPERS
   ------------------------------------------------------------------------ */

async function getCartDoc(uid) {
  const ref = doc(collections.carts, uid);
  const snap = await getDoc(ref);
  return { ref, data: snap.exists() ? snap.data() : { items: {}, couponCode: null } };
}

async function mergeCart(oldUid, newUid) {
  try {
    const oldSnap = await getDoc(doc(collections.carts, oldUid));
    if (!oldSnap.exists()) return;
    const oldItems = oldSnap.data().items || {};
    if (Object.keys(oldItems).length === 0) return;

    const newRef = doc(collections.carts, newUid);
    const newSnap = await getDoc(newRef);
    const newItems = newSnap.exists() ? newSnap.data().items || {} : {};

    const merged = { ...newItems };
    for (const [productId, qty] of Object.entries(oldItems)) {
      merged[productId] = (merged[productId] || 0) + qty;
    }
    await setDoc(newRef, { items: merged, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error("خطا در ادغام سبد خرید میهمان:", error);
  }
}

/** Adds a product to the cart. Used by product cards + product details page. */
export async function addToCart(productId, quantity = 1) {
  try {
    const user = await ensureUser();
    const { ref, data } = await getCartDoc(user.uid);
    const currentQty = (data.items && data.items[productId]) || 0;
    await setDoc(
      ref,
      { items: { ...data.items, [productId]: currentQty + quantity }, updatedAt: serverTimestamp() },
      { merge: true }
    );
    showToast("محصول به سبد خرید اضافه شد.", "success");
    updateCartBadge();
  } catch (error) {
    console.error("خطا در افزودن به سبد خرید:", error);
    showToast("خطا در افزودن محصول به سبد خرید.", "error");
  }
}

export async function updateCartItemQuantity(productId, quantity) {
  const user = await ensureUser();
  const ref = doc(collections.carts, user.uid);
  if (quantity <= 0) {
    await updateDoc(ref, { [`items.${productId}`]: deleteField() });
  } else {
    await updateDoc(ref, { [`items.${productId}`]: quantity, updatedAt: serverTimestamp() });
  }
  updateCartBadge();
}

export async function removeFromCart(productId) {
  const user = await ensureUser();
  const ref = doc(collections.carts, user.uid);
  await updateDoc(ref, { [`items.${productId}`]: deleteField() });
  showToast("محصول از سبد خرید حذف شد.", "success");
  updateCartBadge();
}

export async function clearCart() {
  const user = await ensureUser();
  const ref = doc(collections.carts, user.uid);
  await setDoc(ref, { items: {}, couponCode: null, couponPercent: 0 }, { merge: true });
  updateCartBadge();
}

/** Returns the cart's items joined with live product data (title, price, image, stock). */
export async function getCartWithProducts() {
  const user = await ensureUser();
  const { data } = await getCartDoc(user.uid);
  const items = data.items || {};
  const productIds = Object.keys(items);

  const lines = await Promise.all(
    productIds.map(async (productId) => {
      const productSnap = await getDoc(doc(collections.products, productId));
      if (!productSnap.exists()) return null;
      const product = { id: productSnap.id, ...productSnap.data() };
      const quantity = items[productId];
      const unitPrice = product.discount
        ? Math.round(product.price - (product.price * product.discount) / 100)
        : product.price;
      return { product, quantity, unitPrice, lineTotal: unitPrice * quantity };
    })
  );

  return {
    lines: lines.filter(Boolean),
    couponCode: data.couponCode || null,
    couponPercent: data.couponPercent || 0
  };
}

export function calculateSummary({ lines, couponPercent }) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountAmount = Math.round((subtotal * (couponPercent || 0)) / 100);
  const afterDiscount = subtotal - discountAmount;
  const shipping = lines.length === 0 || afterDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_RATE;
  const total = afterDiscount + shipping;
  return { subtotal, discountAmount, shipping, total };
}

/* ------------------------------------------------------------------------
   3. COUPON
   ------------------------------------------------------------------------ */
export async function applyCoupon(code) {
  const trimmed = code.trim();
  if (!trimmed) return { success: false, message: "کد تخفیف را وارد کنید." };

  const q = query(collections.discounts, where("code", "==", trimmed), where("active", "==", true));
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    return { success: false, message: "کد تخفیف نامعتبر است." };
  }
  const discount = snapshot.docs[0].data();
  if (discount.expiresAt && discount.expiresAt.toDate() < new Date()) {
    return { success: false, message: "این کد تخفیف منقضی شده است." };
  }

  const user = await ensureUser();
  await updateDoc(doc(collections.carts, user.uid), {
    couponCode: trimmed,
    couponPercent: discount.percent || 0
  });
  return { success: true, message: `کد تخفیف ${discount.percent}% اعمال شد.` };
}

/* ------------------------------------------------------------------------
   4. BADGE SYNC (header + mobile bottom nav, every page)
   ------------------------------------------------------------------------ */
export async function updateCartBadge() {
  try {
    const user = await ensureUser();
    const { data } = await getCartDoc(user.uid);
    const total = Object.values(data.items || {}).reduce((sum, qty) => sum + qty, 0);
    document.querySelectorAll("#cart-count, #mobile-cart-count").forEach((el) => {
      el.textContent = total;
    });
  } catch (error) {
    console.error("خطا در بروزرسانی نشان سبد خرید:", error);
  }
}

/* ------------------------------------------------------------------------
   5. CART PAGE (cart.html)
   ------------------------------------------------------------------------ */
function cartLineTemplate({ product, quantity, unitPrice, lineTotal }) {
  const image = (product.images && product.images[0]) || "assets/images/placeholder-product.jpg";
  return `
    <div class="cart-line" data-product-id="${product.id}">
      <a href="product.html?id=${product.id}" class="cart-line__image">
        <img src="${image}" alt="${product.title}" loading="lazy">
      </a>
      <div class="cart-line__info">
        <a href="product.html?id=${product.id}" class="cart-line__title">${product.title}</a>
        <span class="cart-line__unit-price">${formatPrice(unitPrice)}</span>
      </div>
      <div class="qty-input cart-line__qty">
        <button type="button" class="cart-qty-decrease" aria-label="کاهش تعداد">-</button>
        <input type="number" class="cart-qty-input" value="${quantity}" min="1" max="${product.stock || 99}">
        <button type="button" class="cart-qty-increase" aria-label="افزایش تعداد">+</button>
      </div>
      <span class="cart-line__total">${formatPrice(lineTotal)}</span>
      <button type="button" class="cart-line__remove" aria-label="حذف از سبد خرید">
        <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>
      </button>
    </div>
  `;
}

async function renderCartPage() {
  const itemsContainer = document.getElementById("cart-items");
  const summaryContainer = document.getElementById("cart-summary");
  if (!itemsContainer) return;

  itemsContainer.innerHTML = '<div class="skeleton skeleton--product"></div>';
  const cart = await getCartWithProducts();

  if (cart.lines.length === 0) {
    itemsContainer.innerHTML = `
      <div class="cart-empty">
        <p>سبد خرید شما خالی است.</p>
        <a href="products.html" class="btn btn--primary">مشاهده محصولات</a>
      </div>`;
  } else {
    itemsContainer.innerHTML = cart.lines.map(cartLineTemplate).join("");
  }

  if (summaryContainer) renderCartSummary(summaryContainer, cart);
  wireCartLineEvents(itemsContainer);
}

function renderCartSummary(container, cart) {
  const { subtotal, discountAmount, shipping, total } = calculateSummary(cart);
  container.innerHTML = `
    <h2>خلاصه سفارش</h2>
    <div class="cart-summary__row"><span>جمع کل کالاها</span><span>${formatPrice(subtotal)}</span></div>
    ${cart.couponCode ? `<div class="cart-summary__row cart-summary__row--discount"><span>تخفیف (${cart.couponCode})</span><span>-${formatPrice(discountAmount)}</span></div>` : ""}
    <div class="cart-summary__row"><span>هزینه ارسال</span><span>${shipping === 0 ? "رایگان" : formatPrice(shipping)}</span></div>
    <div class="cart-summary__row cart-summary__row--total"><span>مبلغ قابل پرداخت</span><span>${formatPrice(total)}</span></div>
    <a href="checkout.html" class="btn btn--accent cart-summary__checkout ${cart.lines.length === 0 ? "is-disabled" : ""}">ادامه فرآیند خرید</a>
  `;
}

function wireCartLineEvents(container) {
  container.querySelectorAll(".cart-line").forEach((line) => {
    const productId = line.dataset.productId;
    const qtyInput = line.querySelector(".cart-qty-input");

    line.querySelector(".cart-qty-increase").addEventListener("click", async () => {
      const newQty = Number(qtyInput.value) + 1;
      qtyInput.value = newQty;
      await updateCartItemQuantity(productId, newQty);
      renderCartPage();
    });
    line.querySelector(".cart-qty-decrease").addEventListener("click", async () => {
      const newQty = Number(qtyInput.value) - 1;
      qtyInput.value = Math.max(newQty, 0);
      await updateCartItemQuantity(productId, newQty);
      renderCartPage();
    });
    qtyInput.addEventListener("change", async () => {
      await updateCartItemQuantity(productId, Math.max(Number(qtyInput.value), 0));
      renderCartPage();
    });
    line.querySelector(".cart-line__remove").addEventListener("click", async () => {
      await removeFromCart(productId);
      renderCartPage();
    });
  });
}

function wireCouponForm() {
  const form = document.getElementById("coupon-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("coupon-input");
    const submitBtn = form.querySelector('[type="submit"]');
    toggleButtonLoading(submitBtn, true);
    const result = await applyCoupon(input.value);
    toggleButtonLoading(submitBtn, false);
    showToast(result.message, result.success ? "success" : "error");
    if (result.success) renderCartPage();
  });
}

/* ------------------------------------------------------------------------
   6. CHECKOUT (checkout.html)
   ------------------------------------------------------------------------ */
async function renderCheckoutSummary() {
  const summaryContainer = document.getElementById("checkout-summary");
  if (!summaryContainer) return;
  const cart = await getCartWithProducts();
  const { subtotal, discountAmount, shipping, total } = calculateSummary(cart);

  summaryContainer.innerHTML = `
    <h2>سفارش شما</h2>
    <div class="checkout-summary__items">
      ${cart.lines.map((line) => `
        <div class="checkout-summary__item">
          <span>${line.product.title} × ${line.quantity}</span>
          <span>${formatPrice(line.lineTotal)}</span>
        </div>`).join("")}
    </div>
    <div class="cart-summary__row"><span>جمع کل کالاها</span><span>${formatPrice(subtotal)}</span></div>
    ${cart.couponCode ? `<div class="cart-summary__row cart-summary__row--discount"><span>تخفیف</span><span>-${formatPrice(discountAmount)}</span></div>` : ""}
    <div class="cart-summary__row"><span>هزینه ارسال</span><span>${shipping === 0 ? "رایگان" : formatPrice(shipping)}</span></div>
    <div class="cart-summary__row cart-summary__row--total"><span>مبلغ قابل پرداخت</span><span>${formatPrice(total)}</span></div>
  `;
}

async function createOrder(shippingInfo) {
  const user = await ensureUser();
  const cart = await getCartWithProducts();
  if (cart.lines.length === 0) throw new Error("سبد خرید خالی است.");

  const { subtotal, discountAmount, shipping, total } = calculateSummary(cart);

  const orderRef = await addDoc(collections.orders, {
    userId: user.uid,
    items: cart.lines.map((line) => ({
      productId: line.product.id,
      title: line.product.title,
      image: (line.product.images && line.product.images[0]) || "",
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal
    })),
    shippingInfo,
    couponCode: cart.couponCode,
    subtotal,
    discountAmount,
    shipping,
    total,
    status: "pending",
    createdAt: serverTimestamp()
  });

  await clearCart();
  return orderRef.id;
}

function wireCheckoutForm() {
  const form = document.getElementById("checkout-form");
  if (!form) return;

  renderCheckoutSummary();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const shippingInfo = {
      fullName: document.getElementById("checkout-name")?.value.trim(),
      phone: document.getElementById("checkout-phone")?.value.trim(),
      address: document.getElementById("checkout-address")?.value.trim(),
      city: document.getElementById("checkout-city")?.value.trim(),
      postalCode: document.getElementById("checkout-postal")?.value.trim()
    };

    toggleButtonLoading(submitBtn, true);
    try {
      const orderId = await createOrder(shippingInfo);
      showToast("سفارش شما با موفقیت ثبت شد.", "success");
      window.location.href = `profile.html?order=${orderId}`;
    } catch (error) {
      console.error("خطا در ثبت سفارش:", error);
      showToast(error.message || "خطا در ثبت سفارش. دوباره تلاش کنید.", "error");
    } finally {
      toggleButtonLoading(submitBtn, false);
    }
  });
}

/* ------------------------------------------------------------------------
   7. ORDER HISTORY (profile.html)
   ------------------------------------------------------------------------ */
function orderStatusLabel(status) {
  return { pending: "در انتظار بررسی", processing: "در حال پردازش", completed: "تکمیل شده", cancelled: "لغو شده" }[status] || status;
}

async function renderOrderHistory() {
  const container = document.getElementById("profile-orders-list");
  if (!container) return;

  try {
    const user = await ensureUser();
    const q = query(collections.orders, where("userId", "==", user.uid), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = '<p class="empty-state">هنوز سفارشی ثبت نکرده‌اید.</p>';
      return;
    }

    container.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const order = docSnap.data();
      const date = order.createdAt?.toDate ? new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(order.createdAt.toDate()) : "";
      container.insertAdjacentHTML("beforeend", `
        <div class="order-history-item">
          <div class="order-history-item__info">
            <strong>سفارش #${docSnap.id.slice(0, 6)}</strong>
            <span>${date}</span>
          </div>
          <span class="status-pill status-pill--${order.status || "pending"}">${orderStatusLabel(order.status)}</span>
          <span class="order-history-item__total">${formatPrice(order.total)}</span>
        </div>
      `);
    });
  } catch (error) {
    console.error("خطا در بارگذاری تاریخچه سفارش‌ها:", error);
    container.innerHTML = '<p class="empty-state">خطا در بارگذاری سفارش‌ها.</p>';
  }
}

/* ------------------------------------------------------------------------
   8. INIT
   ------------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  renderCartPage();
  wireCouponForm();
  wireCheckoutForm();
  renderOrderHistory();
});
