// Kirish nuqtasi: HTTP server ko'tariladi, Telegram webhook qabul qilinadi.
//
// Oqim:  Telegram -> POST /webhook/<secret> -> tekshiruv -> darhol 200 ->
//        fon rejimida handleUpdate() -> javob yuborish

import crypto from "node:crypto";
import process from "node:process";
import express from "express";

import { config } from "./config.js";
import * as tg from "./telegram.js";
import * as store from "./store.js";
import {
  chooseLanguagePrompt,
  detectLanguage,
  isSupported,
  languageKeyboard,
  t,
} from "./i18n.js";

// ---------------------------------------------------------------
// Log — bir qatorli JSON, journalctl va log yig'uvchilar uchun qulay
// ---------------------------------------------------------------

function write(level, msg, meta = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

const log = {
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
};

// ---------------------------------------------------------------
// Takrorlangan update'larni tashlab yuborish.
// Tarmoq uzilsa Telegram bir update'ni qayta yuborishi mumkin — biz esa
// 200 ni oldindan qaytarganimiz uchun o'zimizni himoyalashimiz kerak.
// ---------------------------------------------------------------

const MAX_REMEMBERED_UPDATES = 1000;
const seenUpdates = new Set();
const seenOrder = [];

function isDuplicate(updateId) {
  if (typeof updateId !== "number") return false;
  if (seenUpdates.has(updateId)) return true;

  seenUpdates.add(updateId);
  seenOrder.push(updateId);
  if (seenOrder.length > MAX_REMEMBERED_UPDATES) {
    seenUpdates.delete(seenOrder.shift());
  }
  return false;
}

// ---------------------------------------------------------------
// Xabarlarni qayta ishlash.
// AI qo'shilganda faqat shu bo'lim o'zgaradi.
// ---------------------------------------------------------------

async function handleUpdate(update) {
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
  if (update.message) return handleMessage(update.message);
  // Boshqa turdagi update'lar hozircha e'tiborsiz qoldiriladi
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const user = message.from;
  const savedLanguage = store.getLanguage(user.id);

  // Til hali tanlanmagan — avval tanlashni so'raymiz
  if (!savedLanguage) {
    await tg.sendMessage(chatId, chooseLanguagePrompt(), { reply_markup: languageKeyboard() });
    return;
  }

  const lang = savedLanguage;

  if (typeof message.text !== "string") {
    await tg.sendMessage(chatId, t(lang, "onlyText"));
    return;
  }

  const text = message.text.trim();
  const command = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;

  switch (command) {
    case null:
      // Oddiy matn — hozircha aks-sado. Keyinchalik shu yerda AI javobi bo'ladi.
      await tg.sendMessage(chatId, t(lang, "echo", { text: tg.escapeHtml(text) }));
      return;

    case "start":
      await tg.sendMessage(chatId, t(lang, "welcome", { name: tg.escapeHtml(user.first_name ?? "") }));
      return;

    case "help":
      await tg.sendMessage(chatId, t(lang, "help"));
      return;

    case "lang":
      await tg.sendMessage(chatId, t(lang, "chooseLanguage"), { reply_markup: languageKeyboard() });
      return;

    default:
      await tg.sendMessage(chatId, t(lang, "unknownCommand"));
  }
}

async function handleCallbackQuery(query) {
  const data = query.data ?? "";
  const chatId = query.message?.chat?.id;

  if (!data.startsWith("lang:") || !chatId) {
    await tg.answerCallbackQuery(query.id);
    return;
  }

  const requested = data.slice("lang:".length);
  const lang = isSupported(requested) ? requested : detectLanguage(query.from.language_code);

  store.setLanguage(query.from.id, lang);
  await tg.answerCallbackQuery(query.id, { text: t(lang, "languageSet") });

  // Tugmalarni olib tashlaymiz — takror bosilmasin.
  // Xabar eskirgan bo'lsa xato muhim emas.
  await tg.editMessageReplyMarkup(chatId, query.message.message_id).catch(() => {});

  await tg.sendMessage(chatId, t(lang, "welcome", { name: tg.escapeHtml(query.from.first_name ?? "") }));
  log.info("til tanlandi", { userId: query.from.id, lang });
}

/** Bitta update'ni qayta ishlaydi; xato butun serverni ag'darmasligi kafolatlanadi. */
async function processUpdate(update) {
  const startedAt = Date.now();
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;

  try {
    await handleUpdate(update);
    log.info("update qayta ishlandi", {
      updateId: update.update_id,
      chatId,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    log.error("update qayta ishlashda xato", {
      updateId: update.update_id,
      chatId,
      error: error.message,
      stack: error.stack,
    });

    if (chatId) {
      const userId = update.message?.from?.id ?? update.callback_query?.from?.id;
      const lang = store.getLanguage(userId) ?? "uz";
      await tg.sendMessage(chatId, t(lang, "error")).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: Math.round(process.uptime()) });
});

app.post(config.webhookPath, (req, res) => {
  const secret = req.get("X-Telegram-Bot-Api-Secret-Token") ?? "";

  if (!timingSafeEqual(secret, config.webhookSecret)) {
    // Sababni ochib bermaymiz — skanerlarga ma'lumot bermaslik uchun
    res.sendStatus(401);
    return;
  }

  const update = req.body;

  // Darhol javob: Telegram kutib qolmasin va update'ni qayta yubormasin
  res.sendStatus(200);

  if (!update || typeof update !== "object") return;
  if (isDuplicate(update.update_id)) {
    log.warn("takrorlangan update tashlab yuborildi", { updateId: update.update_id });
    return;
  }

  void processUpdate(update);
});

app.use((req, res) => res.sendStatus(404));

app.use((error, req, res, next) => {
  log.error("HTTP xato", { error: error.message });
  res.sendStatus(error.status === 400 ? 400 : 500);
});

function timingSafeEqual(a, b) {
  // Uzunliklar farq qilganda ham vaqt bo'yicha barqaror bo'lishi uchun hash solishtiriladi
  const hashA = crypto.createHash("sha256").update(String(a)).digest();
  const hashB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// ---------------------------------------------------------------
// Ishga tushirish va to'g'ri yopilish
// ---------------------------------------------------------------

let server;

async function start() {
  const me = await tg.getMe().catch((error) => {
    log.error("Telegram API bilan bog'lanib bo'lmadi — token to'g'rimi?", { error: error.message });
    process.exit(1);
  });

  server = app.listen(config.port, () => {
    log.info("bot ishga tushdi", {
      username: `@${me.username}`,
      port: config.port,
      webhookPath: "/webhook/***",
    });
  });

  if (config.webhookUrl) {
    try {
      await tg.setWebhook(config.webhookUrl, config.webhookSecret);
      log.info("webhook o'rnatildi", { url: `${config.publicUrl}/webhook/***` });
    } catch (error) {
      log.error("webhook o'rnatilmadi", { error: error.message });
    }
  } else {
    log.warn("PUBLIC_URL ko'rsatilmagan — webhook o'rnatilmadi. Qo'lda: npm run webhook:set");
  }
}

function shutdown(signal) {
  log.info("yopilmoqda", { signal });

  const done = () => {
    store.flush();
    process.exit(0);
  };

  if (!server) return done();

  server.close(done);

  // Ulanishlar 10 soniyada yopilmasa — majburan chiqamiz
  setTimeout(() => {
    log.warn("majburan yopildi");
    store.flush();
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.error("ushlanmagan promise xatosi", { error: String(reason) });
});

process.on("uncaughtException", (error) => {
  log.error("ushlanmagan xato", { error: error.message, stack: error.stack });
  store.flush();
  process.exit(1);
});

start();
