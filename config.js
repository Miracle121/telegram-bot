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

// Veb qidiruv. Yoqilgan bo'lsa model kerak bo'lganda internetdan ma'lumot oladi.
// Har bir qidiruv alohida pul turadi, shuning uchun o'chirib qo'yish imkoni qoldirilgan.
const aiWebSearch = (process.env.AI_WEB_SEARCH ?? "on").trim().toLowerCase();
if (!["on", "off"].includes(aiWebSearch)) {
  errors.push("AI_WEB_SEARCH faqat \"on\" yoki \"off\" bo'lishi mumkin.");
}

// Bitta javob ichida nechta qidiruvga ruxsat. Chegara bo'lmasa model bir savolga
// o'nlab qidiruv qilib, hisobni kutilmaganda oshirib yuborishi mumkin.
const aiWebSearchMaxUses = Number.parseInt(process.env.AI_WEB_SEARCH_MAX_USES ?? "5", 10);
if (!Number.isInteger(aiWebSearchMaxUses) || aiWebSearchMaxUses < 1 || aiWebSearchMaxUses > 20) {
  errors.push("AI_WEB_SEARCH_MAX_USES 1 dan 20 gacha butun son bo'lishi kerak.");
}

// --- Bilim bazasi ---
// Model shu papkadagi fayllardan qidiradi. Papka bo'sh yoki yo'q bo'lsa xato emas:
// vosita shunchaki e'lon qilinmaydi va bot avvalgidek ishlayveradi.
const bilimDir = (process.env.BILIM_DIR ?? "bilim").trim();

// Bitta qidiruvda modelga nechta parcha beriladi. Har parcha kirish tokeni, ya'ni pul.
const bilimMaxResults = Number.parseInt(process.env.BILIM_MAX_RESULTS ?? "4", 10);
if (!Number.isInteger(bilimMaxResults) || bilimMaxResults < 1 || bilimMaxResults > 10) {
  errors.push("BILIM_MAX_RESULTS 1 dan 10 gacha butun son bo'lishi kerak.");
}

// --- Agentlar ---
// Yozuvchi va muharrirning xarakter fayllari shu papkada. Fayl yo'q bo'lsa bot
// ishga tushaveradi: faqat `/post` tushunarli xato beradi.
const agentlarDir = (process.env.AGENTLAR_DIR ?? "agentlar").trim();

// Muharrir rozi bo'lmasa, yozuvchi shuncha marta qayta yozadi. Har qayta yozish —
// ikkita qo'shimcha so'rov (yozuvchi + muharrir), ya'ni ikki barobar pul.
const agentMaxRewrites = Number.parseInt(process.env.AGENT_MAX_REWRITES ?? "2", 10);
if (!Number.isInteger(agentMaxRewrites) || agentMaxRewrites < 0 || agentMaxRewrites > 5) {
  errors.push("AGENT_MAX_REWRITES 0 dan 5 gacha butun son bo'lishi kerak.");
}

// --- Kover rasm ---
// Kalit ixtiyoriy: bo'lmasa kover shablon bo'lib chiziladi (lokal, bepul).
// Shu tanlov tufayli rasm API'siz ham bot to'liq ishlaydi.
const koverEnabled = (process.env.KOVER ?? "on").trim().toLowerCase();
if (!["on", "off"].includes(koverEnabled)) {
  errors.push("KOVER faqat \"on\" yoki \"off\" bo'lishi mumkin.");
}

const koverApiKey = (process.env.KOVER_API_KEY ?? "").trim();
const koverModel = (process.env.KOVER_MODEL ?? "gemini-3.1-flash-image").trim();
const koverApiBase = (process.env.KOVER_API_BASE ?? "https://generativelanguage.googleapis.com")
  .trim()
  .replace(/\/+$/, "");

// Rasm generatsiyasi matndan sekinroq. Chegara Telegram foydalanuvchisi kutadigan
// vaqtdan kelib chiqadi: bundan uzoq kutgandan ko'ra shablon koverni yuborgan ma'qul.
const koverTimeoutMs = Number.parseInt(process.env.KOVER_TIMEOUT_MS ?? "60000", 10);
if (!Number.isInteger(koverTimeoutMs) || koverTimeoutMs < 5000) {
  errors.push("KOVER_TIMEOUT_MS kamida 5000 (5 soniya) bo'lishi kerak.");
}

// Shablon koverning pastiga yoziladigan ism.
const koverBrand = (process.env.KOVER_BRAND ?? "Mrxone").trim();

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
    webSearch: aiWebSearch === "on",
    webSearchMaxUses: aiWebSearchMaxUses,
  }),
  bilim: Object.freeze({
    dir: bilimDir,
    maxResults: bilimMaxResults,
  }),
  agentlar: Object.freeze({
    dir: agentlarDir,
    maxRewrites: agentMaxRewrites,
  }),
  kover: Object.freeze({
    enabled: koverEnabled === "on",
    apiKey: koverApiKey,
    apiBase: koverApiBase,
    model: koverModel,
    timeoutMs: koverTimeoutMs,
    brand: koverBrand,
  }),
});
