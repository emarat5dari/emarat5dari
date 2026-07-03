/* ==========================================================================
   عمارت ۵ دری — chat.js
   Real-time support chat.
     - Customers: floating chat widget (#chat-widget), present on every page.
     - Admins: full inbox in the admin dashboard (#admin-chat-list / panel).

   Firestore shape:
     chats/{chatId}        { userId, userName, status: 'open'|'closed',
                              lastMessage, lastMessageAt,
                              unreadByAdmin, unreadByUser, createdAt }
     messages/{messageId}  { chatId, senderId, senderRole: 'customer'|'admin',
                              text, createdAt }

   Expected DOM hooks:
     #support-btn, #chat-widget, #chat-close, #chat-messages, #chat-form, #chat-input
     #admin-chat-list, #admin-chat-panel-messages, #admin-chat-panel-form,
     #admin-chat-panel-input, #admin-chat-panel-header, #admin-chat-close-btn,
     #admin-chat-empty, #admin-nav-chat-badge
   ========================================================================== */

import { auth, collections } from "./firebase.js";
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showToast, escapeHtml, formatTime } from "./script.js";
import { requireAdmin } from "./auth.js";

/* ------------------------------------------------------------------------
   1. USER RESOLUTION (guests get an anonymous session, same pattern as cart.js)
   ------------------------------------------------------------------------ */
let resolveUser;
const userReady = new Promise((resolve) => { resolveUser = resolve; });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInAnonymously(auth); } catch (error) { console.error("خطا در ایجاد نشست میهمان:", error); }
    return;
  }
  resolveUser(user);
});

function ensureUser() {
  return userReady;
}

/* ------------------------------------------------------------------------
   2. CUSTOMER WIDGET
   ------------------------------------------------------------------------ */
let customerMessagesUnsubscribe = null;

async function getOrCreateChat(user) {
  const chatRef = doc(collections.chats, user.uid);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      userId: user.uid,
      userName: user.displayName || user.email || "مهمان",
      status: "open",
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unreadByAdmin: false,
      unreadByUser: false,
      createdAt: serverTimestamp()
    });
  }
  return chatRef;
}

function renderMessageBubble(message) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${message.senderRole === "admin" ? "chat-bubble--admin" : "chat-bubble--user"}`;
  div.innerHTML = `<p>${escapeHtml(message.text)}</p><span class="chat-bubble__time">${formatTime(message.createdAt)}</span>`;
  return div;
}

async function openChatWidget() {
  const widget = document.getElementById("chat-widget");
  if (!widget) return;
  widget.hidden = false;

  const user = await ensureUser();
  const chatRef = await getOrCreateChat(user);
  await updateDoc(chatRef, { unreadByUser: false });

  const messagesContainer = document.getElementById("chat-messages");
  if (customerMessagesUnsubscribe) customerMessagesUnsubscribe();

  const q = query(collections.messages, where("chatId", "==", user.uid), orderBy("createdAt", "asc"));
  customerMessagesUnsubscribe = onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = "";
    if (snapshot.empty) {
      messagesContainer.innerHTML = '<p class="chat-empty-hint">پیامی ارسال نشده. سوال خود را بنویسید، همکاران ما پاسخ می‌دهند.</p>';
      return;
    }
    snapshot.forEach((docSnap) => messagesContainer.appendChild(renderMessageBubble(docSnap.data())));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

function closeChatWidget() {
  const widget = document.getElementById("chat-widget");
  if (widget) widget.hidden = true;
}

async function sendCustomerMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const user = await ensureUser();
  const chatRef = await getOrCreateChat(user);

  await addDoc(collections.messages, {
    chatId: user.uid,
    senderId: user.uid,
    senderRole: "customer",
    text: trimmed,
    createdAt: serverTimestamp()
  });

  await updateDoc(chatRef, {
    lastMessage: trimmed,
    lastMessageAt: serverTimestamp(),
    unreadByAdmin: true,
    status: "open"
  });
}

function initCustomerWidget() {
  const supportBtn = document.getElementById("support-btn");
  const closeBtn = document.getElementById("chat-close");
  const form = document.getElementById("chat-form");
  if (!supportBtn) return;

  supportBtn.addEventListener("click", openChatWidget);
  closeBtn?.addEventListener("click", closeChatWidget);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value;
    input.value = "";
    try {
      await sendCustomerMessage(text);
    } catch (error) {
      console.error("خطا در ارسال پیام:", error);
      showToast("خطا در ارسال پیام. دوباره تلاش کنید.", "error");
    }
  });
}

/* ------------------------------------------------------------------------
   3. ADMIN INBOX
   ------------------------------------------------------------------------ */
let activeChatId = null;
let adminMessagesUnsubscribe = null;
let knownChatIds = new Set();
let isFirstChatSnapshot = true;

function chatListItemTemplate(chatId, chat) {
  const initial = (chat.userName || "?").charAt(0);
  return `
    <div class="admin-chat-list__item ${chatId === activeChatId ? "active" : ""}" data-chat-id="${chatId}">
      <div class="admin-chat-list__avatar">${initial}</div>
      <div class="admin-chat-list__meta">
        <span class="admin-chat-list__name">${escapeHtml(chat.userName || "مهمان")}</span>
        <span class="admin-chat-list__preview">${escapeHtml(chat.lastMessage || "بدون پیام")}</span>
      </div>
      <span class="status-pill status-pill--${chat.status === "closed" ? "closed" : "open"}">${chat.status === "closed" ? "بسته" : "باز"}</span>
      ${chat.unreadByAdmin ? '<span class="admin-chat-list__unread">●</span>' : ""}
    </div>
  `;
}

function initAdminInbox() {
  const listContainer = document.getElementById("admin-chat-list");
  if (!listContainer) return;

  requireAdmin().then((admin) => {
    if (!admin) return;

    const q = query(collections.chats, orderBy("lastMessageAt", "desc"));
    onSnapshot(q, (snapshot) => {
      listContainer.innerHTML = "";
      let unreadCount = 0;

      snapshot.forEach((docSnap) => {
        const chat = docSnap.data();
        if (chat.unreadByAdmin) unreadCount++;
        listContainer.insertAdjacentHTML("beforeend", chatListItemTemplate(docSnap.id, chat));
        knownChatIds.add(docSnap.id);
      });

      snapshot.docChanges().forEach((change) => {
        if (!isFirstChatSnapshot && change.type === "modified" && change.doc.data().unreadByAdmin) {
          showToast(`پیام جدید از ${change.doc.data().userName || "مشتری"}`, "success");
        }
      });
      isFirstChatSnapshot = false;

      const badge = document.getElementById("admin-nav-chat-badge");
      if (badge) {
        badge.textContent = unreadCount;
        badge.hidden = unreadCount === 0;
      }

      listContainer.querySelectorAll(".admin-chat-list__item").forEach((item) => {
        item.addEventListener("click", () => openAdminConversation(item.dataset.chatId));
      });

      if (snapshot.empty) {
        listContainer.innerHTML = '<p class="chat-empty-hint">هنوز گفتگویی ثبت نشده است.</p>';
      }
    });
  });

  document.getElementById("admin-chat-close-btn")?.addEventListener("click", async () => {
    if (!activeChatId) return;
    await updateDoc(doc(collections.chats, activeChatId), { status: "closed" });
    showToast("گفتگو بسته شد.", "success");
  });

  document.getElementById("admin-chat-panel-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeChatId) return;
    const input = document.getElementById("admin-chat-panel-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await sendAdminMessage(activeChatId, text);
  });
}

async function openAdminConversation(chatId) {
  activeChatId = chatId;
  document.querySelectorAll(".admin-chat-list__item").forEach((item) => {
    item.classList.toggle("active", item.dataset.chatId === chatId);
  });

  const emptyState = document.getElementById("admin-chat-empty");
  if (emptyState) emptyState.hidden = true;

  const chatSnap = await getDoc(doc(collections.chats, chatId));
  const chatData = chatSnap.data();
  const header = document.getElementById("admin-chat-panel-header");
  if (header) {
    header.innerHTML = `
      <div>
        <strong>${escapeHtml(chatData.userName || "مهمان")}</strong>
        <span class="status-pill status-pill--${chatData.status === "closed" ? "closed" : "open"}">${chatData.status === "closed" ? "بسته" : "باز"}</span>
      </div>
      <button id="admin-chat-close-btn-inner" class="btn btn--outline">بستن گفتگو</button>
    `;
  }

  await updateDoc(doc(collections.chats, chatId), { unreadByAdmin: false });

  const messagesContainer = document.getElementById("admin-chat-panel-messages");
  if (adminMessagesUnsubscribe) adminMessagesUnsubscribe();

  const q = query(collections.messages, where("chatId", "==", chatId), orderBy("createdAt", "asc"));
  adminMessagesUnsubscribe = onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = "";
    snapshot.forEach((docSnap) => messagesContainer.appendChild(renderMessageBubble(docSnap.data())));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

async function sendAdminMessage(chatId, text) {
  const admin = auth.currentUser;
  await addDoc(collections.messages, {
    chatId,
    senderId: admin.uid,
    senderRole: "admin",
    text,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(collections.chats, chatId), {
    lastMessage: text,
    lastMessageAt: serverTimestamp(),
    unreadByUser: true,
    status: "open"
  });
}

function initContactPageForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const name = document.getElementById("contact-form-name").value.trim();
    const email = document.getElementById("contact-form-email").value.trim();
    const phone = document.getElementById("contact-form-phone").value.trim();
    const message = document.getElementById("contact-form-message").value.trim();
    if (!message) return;

    submitBtn.disabled = true;
    try {
      const user = await ensureUser();
      const chatRef = await getOrCreateChat(user);
      if (name) await updateDoc(chatRef, { userName: name });

      const composedText = `${message}\n\n— نام: ${name || "نامشخص"} | ایمیل: ${email || "-"} | تلفن: ${phone || "-"}`;
      await sendCustomerMessage(composedText);

      showToast("پیام شما ارسال شد. همکاران ما به‌زودی پاسخ می‌دهند.", "success");
      form.reset();
    } catch (error) {
      console.error("خطا در ارسال فرم تماس:", error);
      showToast("خطا در ارسال پیام. دوباره تلاش کنید.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------------
   4. INIT
   ------------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  initCustomerWidget();
  initAdminInbox();
  initContactPageForm();
});
