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
import * as ai from "./ai.js";
import * as bilim from "./bilim.js";
import * as agentlar from "./agentlar.js";
import * as kover from "./kover.js";
import {
  aiErrorText,
  koverReasonText,
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
      // Oddiy matn — AI javob beradi
      await handleAiMessage(chatId, user, lang, text);
      return;

    case "start":
      await tg.sendMessage(chatId, t(lang, "welcome", { name: tg.escapeHtml(user.first_name ?? "") }));
      return;

    case "help":
      await tg.sendMessage(chatId, t(lang, "help"));
      return;

    case "new":
    case "reset":
      store.clearHistory(user.id);
      await tg.sendMessage(chatId, t(lang, "historyCleared"));
      return;

    case "lang":
      await tg.sendMessage(chatId, t(lang, "chooseLanguage"), { reply_markup: languageKeyboard() });
      return;

    case "post": {
      // "/post mavzu" — buyruqdan keyingi hamma narsa mavzu
      const topic = text.slice(command.length + 1).trim();
      if (!topic) {
        await tg.sendMessage(chatId, t(lang, "postUsage"));
        return;
      }
      await handlePost(chatId, user, lang, topic);
      return;
    }

    default:
      await tg.sendMessage(chatId, t(lang, "unknownCommand"));
  }
}

// ---------------------------------------------------------------
// AI suhbati
// ---------------------------------------------------------------

// Bir foydalanuvchi javob kutayotganda yana yozsa, ikkinchi so'rov boshlanmaydi:
// aks holda ikki javob bir-birining tarixini buzadi va hisob ikki barobar bo'lardi.
const busyUsers = new Set();

const TYPING_REFRESH_MS = 4000; // Telegram "yozmoqda" holatini ~5 soniya ushlab turadi

/** Javob kelguncha "yozmoqda..." belgisini yangilab turadi; to'xtatuvchi funksiya qaytaradi. */
function keepTyping(chatId) {
  const tick = () => tg.sendChatAction(chatId, "typing").catch(() => {});
  tick();
  const timer = setInterval(tick, TYPING_REFRESH_MS);
  timer.unref();
  return () => clearInterval(timer);
}

async function handleAiMessage(chatId, user, lang, text) {
  if (!ai.enabled) {
    await tg.sendMessage(chatId, t(lang, "aiDisabled"));
    return;
  }

  if (busyUsers.has(user.id)) {
    await tg.sendMessage(chatId, t(lang, "aiBusy"));
    return;
  }

  busyUsers.add(user.id);
  const stopTyping = keepTyping(chatId);
  const startedAt = Date.now();

  try {
    const history = [...store.getHistory(user.id), { role: "user", content: text }];
    const answer = await ai.ask({ history, lang, userName: user.first_name ?? "" });

    // Tarixga faqat muvaffaqiyatli almashuv yoziladi. Xato bo'lganda savol yozilmagani
    // ma'qul: foydalanuvchi uni qayta yuborsa, kontekst chalkashmaydi.
    store.appendToHistory(user.id, "user", text);
    store.appendToHistory(user.id, "assistant", answer.text);

    await tg.sendRichText(chatId, answer.text + (answer.truncated ? t(lang, "aiTruncated") : ""));

    log.info("ai javob berdi", {
      userId: user.id,
      durationMs: Date.now() - startedAt,
      historyLength: history.length,
      inputTokens: answer.usage.input_tokens,
      outputTokens: answer.usage.output_tokens,
      searches: answer.searches,
      // Qidiruv xatosi javobni buzmaydi (model usiz ham javob beradi), lekin
      // takrorlanaversa sabab logdan ko'rinib tursin.
      ...(answer.searchErrors.length > 0 ? { searchErrors: answer.searchErrors } : {}),
    });
  } catch (error) {
    if (!(error instanceof ai.AiError)) throw error;

    log.error("ai xatosi", { userId: user.id, code: error.code, error: error.message });
    await tg.sendMessage(chatId, aiErrorText(lang, error.code));
  } finally {
    stopTyping();
    busyUsers.delete(user.id);
  }
}

// ---------------------------------------------------------------
// /post — material -> yozuvchi -> muharrir oqimi
// ---------------------------------------------------------------

/**
 * Mavzu bo'yicha post yozadi.
 *
 * Oqimning o'zi `agentlar.js` da; bu yerda faqat Telegram tomoni — bosqich xabarlari,
 * xatolar va log. Oddiy suhbatdan ikki farqi bor:
 *  - tarix ishlatilmaydi ham, yozilmaydi ham — post suhbatni ifloslantirmasin
 *  - har bosqichdan keyin qisqa xabar ketadi: oqim bir daqiqadan ko'p davom etadi,
 *    jim turish esa "bot qotib qoldi" degan taassurot beradi
 */
async function handlePost(chatId, user, lang, topic) {
  if (!ai.enabled) {
    await tg.sendMessage(chatId, t(lang, "aiDisabled"));
    return;
  }

  if (busyUsers.has(user.id)) {
    await tg.sendMessage(chatId, t(lang, "aiBusy"));
    return;
  }

  busyUsers.add(user.id);
  const stopTyping = keepTyping(chatId);
  const startedAt = Date.now();

  try {
    const result = await agentlar.yozPost({
      topic,
      lang,
      userName: user.first_name ?? "",
      onStage: (stage) => sendStage(chatId, lang, stage),
    });

    // Muharrir oxirigacha rozi bo'lmadi — postni baribir ko'rsatamiz, lekin
    // foydalanuvchi buni bilib tursin.
    if (result.verdict === "fail") {
      await tg.sendRichText(chatId, t(lang, "postLimitReached", { max: String(result.maxRewrites) }));
    }

    // Rasm avval ketadi, matn keyin: post izohga sig'maydi (izoh chegarasi 1024 belgi).
    // Rasm yuborilmasa post baribir yetib boradi — bitta kover uchun ish yo'qolmasin.
    if (result.kover) {
      try {
        await tg.sendPhoto(chatId, result.kover.buffer);
      } catch (error) {
        log.warn("kover yuborilmadi", { userId: user.id, error: error.message });
      }
    }

    await tg.sendRichText(chatId, result.post + (result.truncated ? t(lang, "aiTruncated") : ""));

    log.info("post yozildi", {
      userId: user.id,
      durationMs: Date.now() - startedAt,
      topic,
      verdict: result.verdict,
      rewrites: result.rewrites,
      kover: result.kover ? result.kover.usul : "yo'q",
      ...(result.kover?.sabab ? { koverSabab: result.kover.sabab } : {}),
      bilimCalls: result.material.bilimCalls,
      searches: result.material.searches,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      ...(result.material.searchErrors.length > 0
        ? { searchErrors: result.material.searchErrors }
        : {}),
    });
  } catch (error) {
    // Xarakter fayli yo'q — bu AI xatosi emas, shuning uchun alohida matn:
    // foydalanuvchi nimani tuzatish kerakligini bilsin.
    if (error instanceof agentlar.AgentError) {
      log.error("agent fayli o'qilmadi", { userId: user.id, file: error.file, reason: error.reason });
      await tg.sendMessage(chatId, t(lang, "postAgentMissing", {
        file: tg.escapeHtml(error.file),
        reason: tg.escapeHtml(error.reason),
      }));
      return;
    }

    if (!(error instanceof ai.AiError)) throw error;

    log.error("post xatosi", { userId: user.id, code: error.code, error: error.message });
    await tg.sendMessage(chatId, aiErrorText(lang, error.code));
  } finally {
    stopTyping();
    busyUsers.delete(user.id);
  }
}

/** Oqimning bir bosqichi haqida qisqa xabar. Matn — javob tarkibidan, modelning gapidan emas. */
async function sendStage(chatId, lang, stage) {
  if (stage.type === "material") {
    await tg.sendRichText(chatId, toolTrace(lang, stage.answer));
    return;
  }

  if (stage.type === "yozuvchi") {
    await tg.sendRichText(chatId, stage.round === 0
      ? t(lang, "postStageWriter")
      : t(lang, "postStageRewrite", {
          round: String(stage.round),
          max: String(stage.maxRewrites),
        }));
    return;
  }

  if (stage.type === "kover") {
    await tg.sendRichText(chatId, stage.usul === "api"
      ? t(lang, "postStageKoverApi")
      : t(lang, "postStageKoverTemplate", { sabab: koverReasonText(lang, stage.sabab) }));
    return;
  }

  if (stage.verdict === "pass") {
    await tg.sendRichText(chatId, t(lang, "postStageEditorPass"));
    return;
  }

  if (stage.verdict === "unclear") {
    await tg.sendRichText(chatId, t(lang, "postStageEditorUnclear"));
    return;
  }

  const reasons = stage.reasons.length > 0
    ? stage.reasons.map((reason) => `• ${tg.escapeHtml(reason)}`).join("\n")
    : t(lang, "postNoReason");

  await tg.sendRichText(chatId, t(lang, "postStageEditorFail", { reasons }));
}

/** Qaysi vosita chaqirilgani va nima topilgani — modeldan emas, javob tarkibidan olinadi. */
function toolTrace(lang, answer) {
  const lines = [t(lang, "postTraceTitle")];

  for (const call of answer.bilimCalls) {
    if (call.error) {
      lines.push(t(lang, "postTraceBilimError", {
        query: tg.escapeHtml(call.query),
        error: tg.escapeHtml(call.error),
      }));
      continue;
    }
    lines.push(t(lang, "postTraceBilim", {
      query: tg.escapeHtml(call.query),
      chunks: String(call.chunks),
      files: call.files.length > 0 ? ` — ${tg.escapeHtml(call.files.join(", "))}` : "",
    }));
  }

  if (answer.searches > 0) {
    lines.push(t(lang, "postTraceWeb", { count: String(answer.searches) }));
  }

  // Hech qanday vosita chaqirilmagani ham natija: model o'zi shunday qaror qilgan.
  if (answer.bilimCalls.length === 0 && answer.searches === 0) {
    lines.push(t(lang, "postTraceNone"));
  }

  return lines.join("\n");
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
      ai: ai.enabled ? config.ai.model : "o'chiq",
    });
  });

  if (!ai.enabled) {
    log.warn("ANTHROPIC_API_KEY yo'q — AI suhbati o'chiq, bot faqat buyruqlarga javob beradi");
  } else if (ai.knowledgeBase) {
    log.info("bilim bazasi o'qildi", { dir: config.bilim.dir, ...bilim.stats() });
  } else {
    log.warn(`bilim bazasi bo'sh (${config.bilim.dir}/) — qidiruv vositasi e'lon qilinmadi`);
  }

  // Xarakter fayllari yo'qligi ishga tushishga to'sqinlik qilmaydi: faqat `/post`
  // ishlamaydi, qolgan hamma narsa avvalgidek. Startda ogohlantirib qo'yamiz.
  if (ai.enabled && config.kover.enabled && !kover.hasFont) {
    log.warn("kover shrifti o'qilmadi (assets/DejaVuSans-Bold.ttf) — shablon matnsiz chiziladi");
  }

  if (ai.enabled) {
    if (agentlar.ready()) {
      log.info("agentlar o'qildi", { dir: config.agentlar.dir, maxRewrites: config.agentlar.maxRewrites });
    } else {
      log.warn(`agentlar xarakter fayllari yo'q (${config.agentlar.dir}/) — /post ishlamaydi`);
    }
  }

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
