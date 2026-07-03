/* ==========================================================================
   عمارت ۵ دری — firebase.js
   Central Firebase initialization. Every other script imports its Firebase
   instances (auth, db) and collection references from this file. Also
   exports the Cloudinary config used for image uploads (see admin.js).
   Uses the Firebase v10 modular SDK loaded directly from the CDN, so no
   build step / bundler is required — fully compatible with GitHub Pages.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ------------------------------------------------------------------------
   1. FIREBASE CONFIG
   Replace the values below with the config object from:
   Firebase Console → Project settings → General → Your apps → SDK setup
   ------------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyA0KbyaOfajyOdOJ_IdnaBhTf2TrqG-GgQ",
  authDomain: "emarat-5-dari.firebaseapp.com",
  databaseURL: "https://emarat-5-dari-default-rtdb.firebaseio.com",
  projectId: "emarat-5-dari",
  storageBucket: "emarat-5-dari.firebasestorage.app",
  messagingSenderId: "255816485644",
  appId: "1:255816485644:web:a032f55f79f3c15be09729"
};

/* ------------------------------------------------------------------------
   1b. CLOUDINARY CONFIG
   Image uploads (products, categories, homepage slider, gallery) now go
   to Cloudinary instead of Firebase Storage, since Storage requires the
   Blaze billing plan. Replace these two values with your own Cloudinary
   account's Cloud Name and an UNSIGNED upload preset created in:
   Cloudinary Console → Settings → Upload → Upload presets → Add preset
   (set "Signing Mode" to "Unsigned").
   ------------------------------------------------------------------------ */
export const cloudinaryConfig = {
  cloudName: "YOUR_CLOUD_NAME",
  uploadPreset: "YOUR_UNSIGNED_UPLOAD_PRESET"
};

/* ------------------------------------------------------------------------
   2. INITIALIZE CORE SERVICES
   ------------------------------------------------------------------------ */
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/* Keep users logged in across page reloads / tabs (needed since every
   page on the site is a separate full navigation on GitHub Pages). */
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("خطا در تنظیم ماندگاری ورود کاربر:", error.code, error.message);
});

/* Allow the app to keep working (read cached data) when the connection
   drops briefly. Safe to ignore failures — happens if multiple tabs are
   open at once, in which case only one tab keeps persistence active. */
enableIndexedDbPersistence(db).catch((error) => {
  if (error.code === "failed-precondition") {
    console.warn("حالت آفلاین فقط در یک تب مرورگر فعال می‌شود.");
  } else if (error.code === "unimplemented") {
    console.warn("مرورگر شما از حالت آفلاین Firestore پشتیبانی نمی‌کند.");
  }
});

/* ------------------------------------------------------------------------
   3. FIRESTORE COLLECTION REFERENCES
   Central place for every collection name used across the project, so a
   typo in a string literal can never silently create a stray collection.
   ------------------------------------------------------------------------ */
export const collections = {
  users: collection(db, "users"),
  admins: collection(db, "admins"),
  products: collection(db, "products"),
  categories: collection(db, "categories"),
  orders: collection(db, "orders"),
  carts: collection(db, "carts"),
  chats: collection(db, "chats"),
  messages: collection(db, "messages"),
  reviews: collection(db, "reviews"),
  discounts: collection(db, "discounts"),
  settings: collection(db, "settings")
};

/* ------------------------------------------------------------------------
   4. STORAGE PATH HELPERS
   Keeps upload paths consistent between admin.js (writes) and products.js /
   script.js (reads), and avoids collisions between different upload types.
   ------------------------------------------------------------------------ */
export const storagePaths = {
  productImage: (productId, fileName) => `products/${productId}/${fileName}`,
  categoryImage: (categoryId, fileName) => `categories/${categoryId}/${fileName}`,
  galleryImage: (fileName) => `gallery/${fileName}`,
  sliderImage: (fileName) => `sliders/${fileName}`,
  userAvatar: (uid, fileName) => `users/${uid}/${fileName}`
};

/* ------------------------------------------------------------------------
   5. GLOBAL ERROR MESSAGE TRANSLATOR (Persian)
   Firebase error codes are always in English; this keeps every user-facing
   message in the site in Persian without repeating this switch everywhere.
   ------------------------------------------------------------------------ */
export function translateFirebaseError(code) {
  const messages = {
    "auth/email-already-in-use": "این ایمیل قبلاً ثبت‌نام شده است.",
    "auth/invalid-email": "فرمت ایمیل وارد شده صحیح نیست.",
    "auth/user-disabled": "این حساب کاربری غیرفعال شده است.",
    "auth/user-not-found": "کاربری با این مشخصات یافت نشد.",
    "auth/wrong-password": "رمز عبور اشتباه است.",
    "auth/invalid-credential": "ایمیل یا رمز عبور اشتباه است.",
    "auth/weak-password": "رمز عبور باید حداقل ۶ کاراکتر باشد.",
    "auth/too-many-requests": "تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
    "auth/network-request-failed": "خطا در اتصال به اینترنت. اتصال خود را بررسی کنید.",
    "permission-denied": "شما اجازه دسترسی به این بخش را ندارید.",
    "storage/unauthorized": "اجازه آپلود فایل را ندارید.",
    "storage/canceled": "آپلود فایل لغو شد.",
    "storage/unknown": "خطای ناشناخته در آپلود فایل رخ داد."
  };
  return messages[code] || "خطایی رخ داد. لطفاً دوباره تلاش کنید.";
}
