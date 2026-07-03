# عمارت ۵ دری — فروشگاه اینترنتی

فروشگاه اینترنتی عمارت ۵ دری؛ یک وب‌سایت تجارت الکترونیک کامل، فارسی و راست‌چین (RTL) برای فروش کاغذ دیواری، پرده، قرنیز، دیوارپوش PVC و ابزار دکوراتیو.

ساخته‌شده با **HTML5 + CSS3 + Vanilla JavaScript (ES Modules)** در سمت کلاینت و **Firebase** (Authentication، Firestore، Storage) به‌عنوان تنها بک‌اند — بدون نیاز به PHP، Node.js یا هر سرور دیگری. کاملاً سازگار با **GitHub Pages**.

---

## ۱. پیش‌نیازها

- یک حساب [Firebase](https://console.firebase.google.com)
- یک حساب GitHub برای انتشار روی GitHub Pages
- مرورگر مدرن (Chrome، Edge، Firefox، Safari)

---

## ۲. راه‌اندازی Firebase

### ۲.۱. ایجاد پروژه
پروژه‌ی Firebase شما (`emarat5dari`) از قبل ایجاد شده و پیکربندی آن در فایل `js/firebase.js` قرار گرفته است. اگر پروژه جدیدی می‌سازید:

1. به [Firebase Console](https://console.firebase.google.com) بروید و پروژه جدید بسازید.
2. از منوی **Project settings → General → Your apps**، یک اپلیکیشن وب (Web App) اضافه کنید.
3. مقادیر `firebaseConfig` را کپی کرده و در فایل `js/firebase.js` جایگزین کنید.

### ۲.۲. فعال‌سازی سرویس‌های مورد نیاز
از منوی سمت راست Firebase Console، این سه سرویس را فعال کنید:

| سرویس | مسیر فعال‌سازی | توضیح |
|---|---|---|
| **Authentication** | Build → Authentication → Sign-in method | روش‌های **Email/Password** و **Anonymous** را فعال کنید |
| **Firestore Database** | Build → Firestore Database → Create database | در حالت **Production mode** ایجاد کنید |
| **Storage** | Build → Storage → Get started | برای آپلود تصاویر محصولات، دسته‌بندی‌ها، اسلایدر و گالری |

> **چرا Anonymous Auth؟** برای اینکه سبد خرید مهمانان (کاربرانی که هنوز ثبت‌نام نکرده‌اند) هم طبق نیازمندی پروژه در Firestore ذخیره شود، به هر بازدیدکننده یک شناسه موقت داده می‌شود. با ثبت‌نام یا ورود، سبد خرید موقت به‌طور خودکار به حساب کاربری واقعی منتقل می‌شود.

### ۲.۳. ساختار Collection های Firestore
مجموعه‌های زیر به‌صورت خودکار توسط کد هنگام اولین استفاده ساخته می‌شوند (نیازی به ساخت دستی نیست):

- `users` — پروفایل مشتریان
- `admins` — شناسه (UID) مدیران مجاز پنل ادمین
- `products` — محصولات
- `categories` — دسته‌بندی‌ها
- `orders` — سفارش‌ها
- `carts` — سبد خرید (کلید سند = UID کاربر)
- `chats` / `messages` — گفتگوی پشتیبانی زنده
- `reviews` — نظرات و امتیاز محصولات
- `discounts` — کدهای تخفیف
- `settings` — تنظیمات سایت (اسلایدر صفحه اصلی، گالری، اطلاعات تماس)

### ۲.۴. قوانین امنیتی (Security Rules) پیشنهادی

**Firestore Rules** (Build → Firestore Database → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    match /products/{id}      { allow read: if true; allow write: if isAdmin(); }
    match /categories/{id}    { allow read: if true; allow write: if isAdmin(); }
    match /discounts/{id}     { allow read: if true; allow write: if isAdmin(); }
    match /settings/{id}      { allow read: if true; allow write: if isAdmin(); }
    match /admins/{id}        { allow read: if isAdmin(); allow write: if false; }

    match /reviews/{id} {
      allow read: if true;
      allow create: if isSignedIn();
      allow update, delete: if isAdmin();
    }

    match /users/{uid} {
      allow read, write: if isSignedIn() && request.auth.uid == uid;
      allow read: if isAdmin();
    }

    match /carts/{uid} {
      allow read, write: if isSignedIn() && request.auth.uid == uid;
    }

    match /orders/{id} {
      allow create: if isSignedIn();
      allow read: if isSignedIn() && resource.data.userId == request.auth.uid;
      allow read, update: if isAdmin();
    }

    match /chats/{id} {
      allow read, write: if isSignedIn() && (id == request.auth.uid || isAdmin());
    }
    match /messages/{id} {
      allow read: if isSignedIn();
      allow create: if isSignedIn();
    }
  }
}
```

**Storage Rules** (Build → Storage → Rules):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null &&
        exists(/databases/(default)/documents/admins/$(request.auth.uid));
    }
  }
}
```

> **توجه:** این قوانین یک نقطه شروع امن هستند. پیش از انتشار نهایی، آن‌ها را متناسب با نیاز خود بازبینی کنید.

### ۲.۵. ساخت اولین حساب مدیر (Admin)
پنل مدیریت (`admin.html`) فقط به کاربرانی اجازه ورود می‌دهد که شناسه (UID) آن‌ها در مجموعه `admins` ثبت شده باشد. برای ساخت اولین مدیر:

1. یک بار از طریق صفحه `profile.html` با ایمیل و رمز عبور دلخواه **ثبت‌نام** کنید (این یک حساب کاربری عادی می‌سازد).
2. به Firebase Console → **Authentication → Users** بروید و **UID** همان کاربر را کپی کنید.
3. به **Firestore Database** بروید و یک مجموعه (Collection) جدید به نام `admins` بسازید (اگر وجود ندارد).
4. داخل آن، یک سند (Document) جدید بسازید که **شناسه سند (Document ID)** آن دقیقاً همان UID کپی‌شده باشد. محتوای سند می‌تواند ساده باشد، مثلاً:
   ```json
   { "role": "owner", "addedAt": "<تاریخ دلخواه>" }
   ```
5. اکنون با همان ایمیل و رمز عبور وارد `admin.html` شوید — به‌طور خودکار به پنل مدیریت هدایت می‌شوید.

برای افزودن مدیران بعدی، همین مراحل را برای UID کاربر جدید تکرار کنید.

---

## ۳. ساختار پروژه

```
emarat5dari/
├── index.html              صفحه اصلی
├── products.html           لیست محصولات (جستجو، فیلتر، مرتب‌سازی)
├── product.html             جزئیات محصول
├── categories.html          تمام دسته‌بندی‌ها
├── cart.html                 سبد خرید
├── checkout.html            تسویه حساب
├── about.html                درباره ما
├── gallery.html              گالری تصاویر
├── contact.html              تماس با ما
├── profile.html              ورود / ثبت‌نام / حساب کاربری
├── wishlist.html             علاقه‌مندی‌ها
├── admin.html                 پنل مدیریت
├── 404.html                    صفحه یافت نشد
├── robots.txt / sitemap.xml / manifest.json / browserconfig.xml
├── favicon.ico / apple-touch-icon.png
├── css/
│   ├── style.css            استایل اصلی (متغیرها، کامپوننت‌ها)
│   ├── responsive.css       واکنش‌گرایی (breakpoint ها)
│   └── admin.css             استایل اختصاصی پنل مدیریت
├── js/
│   ├── firebase.js          پیکربندی و اتصال به Firebase
│   ├── auth.js                ورود / ثبت‌نام / خروج / نقش مدیر
│   ├── products.js            محصولات، دسته‌بندی‌ها، نظرات، علاقه‌مندی‌ها
│   ├── cart.js                 سبد خرید و تسویه حساب
│   ├── chat.js                 گفتگوی پشتیبانی زنده
│   ├── admin.js                منطق کامل پنل مدیریت
│   └── script.js               توابع کمکی مشترک + رفتار عمومی رابط کاربری
└── assets/
    ├── images/               تصاویر ثابت (og-cover.jpg و غیره)
    ├── icons/                آیکون‌های PWA
    └── fonts/                 (در صورت نیاز به فونت محلی)
```

---

## ۴. انتشار روی GitHub Pages

1. یک مخزن (Repository) جدید در GitHub بسازید، مثلاً `emarat5dari`.
2. تمام فایل‌های این پروژه را در ریشه (root) همان مخزن قرار دهید و push کنید:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - عمارت ۵ دری"
   git branch -M main
   git remote add origin https://github.com/<username>/emarat5dari.git
   git push -u origin main
   ```
3. در GitHub به **Settings → Pages** بروید.
4. در بخش **Build and deployment**، منبع (Source) را روی **Deploy from a branch** و شاخه (Branch) را روی `main` و پوشه را روی `/ (root)` تنظیم کنید.
5. پس از چند دقیقه، سایت شما در آدرسی شبیه به `https://<username>.github.io/emarat5dari/` در دسترس خواهد بود.

### ۴.۱. مجاز کردن دامنه در Firebase
پس از انتشار، آدرس GitHub Pages را به لیست دامنه‌های مجاز اضافه کنید تا Authentication کار کند:
Firebase Console → Authentication → Settings → **Authorized domains** → Add domain → آدرس گیت‌هاب پیجز خود را وارد کنید.

---

## ۵. اجرای محلی (اختیاری)

از آنجا که پروژه کاملاً استاتیک است، کافی است فایل‌ها را با هر سرور استاتیک ساده اجرا کنید (باز کردن مستقیم فایل با `file://` به‌دلیل محدودیت ماژول‌های ES کار نمی‌کند):

```bash
# با پایتون
python3 -m http.server 8080

# یا با افزونه Live Server در VS Code
```

سپس به آدرس `http://localhost:8080` مراجعه کنید.

---

## ۶. نکات مهم

- **اولین محتوا:** بلافاصله پس از راه‌اندازی، تمام بخش‌های سایت (محصولات، دسته‌بندی‌ها، اسلایدر، گالری) خالی خواهند بود. برای شروع، از پنل مدیریت حداقل چند دسته‌بندی و محصول اضافه کنید.
- **آیکون‌ها:** فایل‌های `favicon.ico`، `apple-touch-icon.png` و آیکون‌های پوشه `assets/icons` به‌صورت خودکار با الهام از لوگوی «عمارت ۵ دری» ساخته شده‌اند؛ در صورت تمایل می‌توانید آن‌ها را با لوگوی نهایی برند جایگزین کنید.
- **نقشه سایت:** فایل `sitemap.xml` فقط صفحات ثابت را پوشش می‌دهد. از آنجا که صفحات محصول (`product.html?id=...`) به‌صورت پویا از Firestore ساخته می‌شوند، در نقشه سایت درج نشده‌اند.
- **پشتیبانی زنده:** گفتگوی پشتیبانی (`chat.js`) بین مشتریان و پنل مدیریت به‌صورت کاملاً بلادرنگ (Real-time) با Firestore `onSnapshot` کار می‌کند.

---

## ۷. اطلاعات تماس فروشگاه

- **نام فروشگاه:** عمارت ۵ دری
- **تلفن:** ۰۹۱۴۰۹۰۴۵۴۱
- **ایتا:** [emarat5dari@](https://eitaa.com/emarat5dari)
- **آدرس:** بلوار مدرس، خیابان امام حسن مجتبی، بعد از پارک بزرگشهر، نبش کوچه پیام
