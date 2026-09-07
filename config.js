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

// --- AI ---
// ANTHROPIC_API_KEY ixtiyoriy: bo'lmasa bot baribir ishga tushadi, faqat suhbat qismi
// o'chiq bo'ladi. Shu tanlov tufayli kalitni serverga qo'shishdan oldin ham deploy
// qilish xavfsiz — bot til tanlash va buyruqlar bilan ishlayveradi.
const aiApiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
if (aiApiKey && aiApiKey.length < 20) {
  errors.push("ANTHROPIC_API_KEY juda qisqa — console.anthropic.com dan olingan to'liq kalitni qo'ying.");
}

const aiModel = (process.env.AI_MODEL ?? "claude-opus-5").trim();

// Fikrlash chuqurligi. Telegram'da foydalanuvchi kutib turadi, shuning uchun standart
// qiymat "medium": sifat yetarli, javob esa "high" ga qaraganda sezilarli tez keladi.
const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const aiEffort = (process.env.AI_EFFORT ?? "medium").trim();
if (!AI_EFFORTS.includes(aiEffort)) {
  errors.push(`AI_EFFORT quyidagilardan biri bo'lishi kerak: ${AI_EFFORTS.join(", ")}.`);
}

const aiMaxTokens = Number.parseInt(process.env.AI_MAX_TOKENS ?? "8000", 10);
if (!Number.isInteger(aiMaxTokens) || aiMaxTokens < 1024 || aiMaxTokens > 64000) {
  errors.push("AI_MAX_TOKENS 1024 dan 64000 gacha butun son bo'lishi kerak.");
}

// So'rov shuncha vaqtda javob bermasa uziladi. Telegram foydalanuvchisi 2 daqiqadan
// ko'p kutmasligi kerak — aks holda u savolni qayta yozadi.
const aiTimeoutMs = Number.parseInt(process.env.AI_TIMEOUT_MS ?? "120000", 10);
if (!Number.isInteger(aiTimeoutMs) || aiTimeoutMs < 5000) {
  errors.push("AI_TIMEOUT_MS kamida 5000 (5 soniya) bo'lishi kerak.");
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
  ai: Object.freeze({
    enabled: Boolean(aiApiKey),
    apiKey: aiApiKey,
    model: aiModel,
    effort: aiEffort,
    maxTokens: aiMaxTokens,
    timeoutMs: aiTimeoutMs,
  }),
});
