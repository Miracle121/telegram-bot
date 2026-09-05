// Konfiguratsiya: .env o'qiladi va tekshiriladi.
// Xato bo'lsa bot ishga tushmaydi — yarim sozlangan holatda ishlagandan ko'ra
// darhol tushunarli xato bilan to'xtagani yaxshi.

import process from 'node:process';

// Node 20.12+ .env faylini tashqi paketsiz o'qiydi.
// Fayl bo'lmasa xato bermaymiz — serverda o'zgaruvchilar systemd orqali kelishi mumkin.
try {
  process.loadEnvFile();
} catch {
  // .env yo'q — davom etamiz
}

const errors = [];

function required(name, validate, hint) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    errors.push(`${name} ko'rsatilmagan. ${hint}`);
    return "";
  }
  if (validate && !validate(value)) {
    errors.push(`${name} qiymati noto'g'ri. ${hint}`);
    return "";
  }
  return value;
}

const token = required(
  "TELEGRAM_BOT_TOKEN",
  (v) => /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v),
  "BotFather bergan token .env faylida bo'lishi kerak (masalan: 123456789:AA...).",
);

const webhookSecret = required(
  "WEBHOOK_SECRET",
  (v) => /^[A-Za-z0-9_-]{16,256}$/.test(v),
  "Kamida 16 ta belgi (harf, raqam, _ va -). Yangisini olish: npm run secret",
);

// PUBLIC_URL ixtiyoriy: bo'lsa — ishga tushganda webhook avtomatik o'rnatiladi.
const publicUrl = (process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
if (publicUrl && !publicUrl.startsWith("https://")) {
  errors.push("PUBLIC_URL https:// bilan boshlanishi kerak — Telegram faqat HTTPS webhook qabul qiladi.");
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  errors.push("PORT 1 dan 65535 gacha butun son bo'lishi kerak.");
}

if (errors.length > 0) {
  console.error("\nKonfiguratsiya xatosi:\n");
  for (const message of errors) console.error(`  - ${message}`);
  console.error("\nNamuna uchun .env.example fayliga qarang.\n");
  process.exit(1);
}

export const config = Object.freeze({
  token,
  webhookSecret,
  publicUrl,
  port,
  webhookPath: `/webhook/${webhookSecret}`,
  webhookUrl: publicUrl ? `${publicUrl}/webhook/${webhookSecret}` : "",
  isProduction: process.env.NODE_ENV === "production",
});
