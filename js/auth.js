/* ==========================================================================
   عمارت ۵ دری — auth.js
   Handles: register, login, logout, password reset, admin role checks,
   and keeps the header / mobile nav / profile page in sync with auth state.

   Expected DOM hooks (only wired up if present on the current page):
     #login-form            (fields: #login-email, #login-password)
     #register-form         (fields: #register-name, #register-email,
                              #register-phone, #register-password)
     #reset-password-form   (field: #reset-email)
     .js-logout             (any element that should log the user out)
     #header-account        (header account icon/link — swapped to show name)
     #profile-guest         (shown on profile.html when logged out)
     #profile-account       (shown on profile.html when logged in)
     #profile-name / #profile-email  (filled in with user data)
   ========================================================================== */

import { auth, db, collections, translateFirebaseError } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, toggleButtonLoading } from "./script.js";

/* ------------------------------------------------------------------------
   1. STATE
   ------------------------------------------------------------------------ */
let currentUser = null;
let currentUserIsAdmin = false;

/* ------------------------------------------------------------------------
   2. CORE AUTH ACTIONS
   ------------------------------------------------------------------------ */

/** Registers a new customer account and creates their Firestore profile. */
async function registerUser({ name, email, phone, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(credential.user, { displayName: name });

  await setDoc(doc(collections.users, credential.user.uid), {
    name,
    email,
    phone: phone || "",
    role: "customer",
    createdAt: serverTimestamp()
  });

  return credential.user;
}

/** Logs an existing user in with email + password. */
async function loginUser(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Logs the current user out. */
async function logoutUser() {
  await signOut(auth);
  showToast("با موفقیت از حساب خود خارج شدید.", "success");
  if (location.pathname.includes("admin.html")) {
    window.location.href = "index.html";
  }
}

/** Sends a password-reset email. */
async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/** Checks the 'admins' collection to see if a uid belongs to an admin. */
async function checkIsAdmin(uid) {
  if (!uid) return false;
  const adminDoc = await getDoc(doc(collections.admins, uid));
  return adminDoc.exists();
}

/* ------------------------------------------------------------------------
   3. PUBLIC HELPERS (used by other modules: cart.js, chat.js, admin.js…)
   ------------------------------------------------------------------------ */

/** Resolves once with the current user (or null) after the first auth check. */
export function getCurrentUser() {
  return new Promise((resolve) => {
    if (currentUser !== null || authReady) {
      resolve(currentUser);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/** Resolves true/false once the admin check for the current user is done. */
export async function isCurrentUserAdmin() {
  await getCurrentUser();
  return currentUserIsAdmin;
}

/**
 * Guards admin-only pages. Call at the top of admin.js.
 * Redirects non-admins to the homepage and returns false; returns true
 * (with the user object) for confirmed admins.
 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "index.html";
    return false;
  }
  const admin = await checkIsAdmin(user.uid);
  if (!admin) {
    showToast("دسترسی شما به پنل مدیریت مجاز نیست.", "error");
    window.location.href = "index.html";
    return false;
  }
  return user;
}

let authReady = false;

/* ------------------------------------------------------------------------
   4. AUTH STATE OBSERVER — keeps every page's UI in sync
   ------------------------------------------------------------------------ */
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentUserIsAdmin = user ? await checkIsAdmin(user.uid) : false;
  authReady = true;
  renderAuthUI(user, currentUserIsAdmin);
});

function renderAuthUI(user, admin) {
  // Header account icon (all pages)
  const headerAccount = document.getElementById("header-account");
  if (headerAccount) {
    headerAccount.innerHTML = "";
    const link = document.createElement("a");
    link.href = "profile.html";
    link.className = "header-action";
    link.setAttribute("aria-label", "حساب کاربری");
    link.innerHTML = user
      ? `<span class="header-account__initial">${(user.displayName || user.email || "?").charAt(0)}</span>`
      : `<svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>`;
    headerAccount.appendChild(link);
  }

  // Admin link in main nav — only shown to confirmed admins
  const adminNavLink = document.getElementById("nav-admin-link");
  if (adminNavLink) adminNavLink.hidden = !admin;

  // Profile page toggling between guest / account views
  const guestView = document.getElementById("profile-guest");
  const accountView = document.getElementById("profile-account");
  if (guestView && accountView) {
    guestView.hidden = !!user;
    accountView.hidden = !user;
    if (user) {
      const nameEl = document.getElementById("profile-name");
      const emailEl = document.getElementById("profile-email");
      const avatarEl = document.getElementById("profile-avatar");
      if (nameEl) nameEl.textContent = user.displayName || "کاربر عمارت ۵ دری";
      if (emailEl) emailEl.textContent = user.email;
      if (avatarEl) avatarEl.textContent = (user.displayName || user.email || "?").charAt(0);
    }
  }

  // Any element marked data-auth="in" shows only when logged in,
  // data-auth="out" shows only when logged out.
  document.querySelectorAll('[data-auth="in"]').forEach((el) => (el.hidden = !user));
  document.querySelectorAll('[data-auth="out"]').forEach((el) => (el.hidden = !!user));
}

/* ------------------------------------------------------------------------
   5. FORM WIRING
   ------------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {

  // --- Register form ---
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = registerForm.querySelector('[type="submit"]');
      const name = document.getElementById("register-name").value.trim();
      const email = document.getElementById("register-email").value.trim();
      const phone = document.getElementById("register-phone")?.value.trim() || "";
      const password = document.getElementById("register-password").value;

      toggleButtonLoading(submitBtn, true);
      try {
        await registerUser({ name, email, phone, password });
        showToast("ثبت‌نام با موفقیت انجام شد. خوش آمدید!", "success");
        registerForm.reset();
      } catch (error) {
        showToast(translateFirebaseError(error.code), "error");
      } finally {
        toggleButtonLoading(submitBtn, false);
      }
    });
  }

  // --- Login form ---
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = loginForm.querySelector('[type="submit"]');
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;

      toggleButtonLoading(submitBtn, true);
      try {
        await loginUser(email, password);
        showToast("ورود با موفقیت انجام شد.", "success");
        loginForm.reset();
      } catch (error) {
        showToast(translateFirebaseError(error.code), "error");
      } finally {
        toggleButtonLoading(submitBtn, false);
      }
    });
  }

  // --- Reset password form ---
  const resetForm = document.getElementById("reset-password-form");
  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = resetForm.querySelector('[type="submit"]');
      const email = document.getElementById("reset-email").value.trim();

      toggleButtonLoading(submitBtn, true);
      try {
        await resetPassword(email);
        showToast("ایمیل بازیابی رمز عبور ارسال شد.", "success");
        resetForm.reset();
      } catch (error) {
        showToast(translateFirebaseError(error.code), "error");
      } finally {
        toggleButtonLoading(submitBtn, false);
      }
    });
  }

  // --- Logout buttons (any number of them, any page) ---
  document.querySelectorAll(".js-logout").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      logoutUser();
    });
  });

  // --- Admin login form (admin.html) uses the same loginUser() flow,
  //     then requireAdmin() on the page itself decides access. ---
  const adminLoginForm = document.getElementById("admin-login-form");
  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = adminLoginForm.querySelector('[type="submit"]');
      const email = document.getElementById("admin-login-email").value.trim();
      const password = document.getElementById("admin-login-password").value;
      const errorBox = document.getElementById("admin-login-error");

      toggleButtonLoading(submitBtn, true);
      if (errorBox) errorBox.classList.remove("is-visible");
      try {
        const user = await loginUser(email, password);
        const admin = await checkIsAdmin(user.uid);
        if (!admin) {
          await signOut(auth);
          throw { code: "permission-denied" };
        }
        window.location.href = "admin.html";
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = translateFirebaseError(error.code);
          errorBox.classList.add("is-visible");
        }
      } finally {
        toggleButtonLoading(submitBtn, false);
      }
    });
  }
});