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
import * as kanallar from "./kanallar.js";
import * as postlar from "./postlar.js";
import {
  aiErrorText,
  koverReasonText,
  chooseLanguagePrompt,
  detectLanguage,
  isSupported,
  languageKeyboard,
  postKeyboard,
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
  if (update.my_chat_member) return handleMyChatMember(update.my_chat_member);
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

  // Kanaldan forward qilingan post — kanalni ulash urinishi bo'lishi mumkin.
  // Ulanmasa (bot u kanalda admin emas) oddiy xabar sifatida davom etadi.
  if (message.forward_origin?.type === "channel") {
    const connected = await connectChannel(chatId, user, lang, message.forward_origin.chat.id, { quiet: true });
    if (connected) return;
  }

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

    case "kanal": {
      // "/kanal @nomi" yoki "/kanal -100..." — allaqachon admin bo'lgan kanalni ulash.
      const ref = text.slice(command.length + 1).trim().split(/\s+/)[0] ?? "";
      if (!ref) {
        const kanal = kanallar.ol(user.id);
        await tg.sendMessage(chatId, kanal
          ? t(lang, "kanalHolati", { title: tg.escapeHtml(kanal.title) })
          : t(lang, "kanalUsage"));
        return;
      }
      const normalized = /^-?\d+$/.test(ref) ? Number(ref) : (ref.startsWith("@") ? ref : `@${ref}`);
      await connectChannel(chatId, user, lang, normalized);
      return;
    }

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

    if (result.verdict === "uzun") {
      await tg.sendRichText(chatId, t(lang, "postTooLong", { max: String(agentlar.POST_MAX_CHARS) }));
    }

    // Tugmalar har doim chiqadi: qayta yozish va bekor qilish kanalsiz ham ishlaydi,
    // kanal esa chop etish bosilganda tekshiriladi. Post tugma bosilguncha saqlanadi.
    const shown = result.post + (result.truncated ? t(lang, "aiTruncated") : "");
    const id = postlar.saqla({
      userId: user.id,
      chatId,
      lang,
      userName: user.first_name ?? "",
      topic,
      material: result.material.text,
      post: result.post,
      photoFileId: "",
      photoBuffer: result.kover?.buffer ?? null,
      messageId: 0,
    });
    const entry = postlar.ol(id);
    const sent = await sendPost(chatId, entry.photoBuffer, shown, postKeyboard(lang, id));
    entry.messageId = sent.messageId;
    // Telegram'ga yuklangan rasm — keyingi yuborishlar (kanal, qayta yozish) shu id bilan.
    if (sent.photoFileId) {
      entry.photoFileId = sent.photoFileId;
      entry.photoBuffer = null;
    }

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

  if (stage.type === "uzunlik") {
    await tg.sendRichText(chatId, t(lang, "postStageTooLong", {
      length: String(stage.length),
      max: String(stage.max),
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

// ---------------------------------------------------------------
// Post tagidagi tugmalar: chop etish / qayta yozish / bekor qilish
// ---------------------------------------------------------------

// Har qayta yozish — yozuvchi + muharrir, ya'ni pul. Uchtadan ko'p kerak bo'lsa,
// muammo yozishda emas, mavzuda yoki materialda.
const POST_MAX_USER_REWRITES = 3;

/** Callback javobi. Kechikkan tugma (15 s dan eski) xato beradi — bu ishni to'xtatmasin. */
const answerQuery = (query, extra = {}) => tg.answerCallbackQuery(query.id, extra).catch(() => {});

async function handlePostButton(query, chatId) {
  const [, action, id = ""] = query.data.split(":");
  const user = query.from;
  const lang = store.getLanguage(user.id) ?? detectLanguage(user.language_code);
  const messageId = query.message.message_id;
  const entry = postlar.ol(id);

  // Qayta yozishdan keyin eski xabarda tugma qolib ketgan bo'lsa ham shu yerga tushadi:
  // amaldagi tugmalar faqat postning oxirgi xabarida.
  if (!entry || entry.messageId !== messageId) {
    await answerQuery(query, { text: t(lang, "postExpired"), show_alert: true });
    await tg.editMessageReplyMarkup(chatId, messageId).catch(() => {});
    return;
  }

  // Shaxsiy chatda begona tugmani ko'rmaydi, lekin callback_data soxtalashtirilishi mumkin.
  if (entry.userId !== user.id) {
    await answerQuery(query, { text: t(lang, "postNotYours"), show_alert: true });
    return;
  }

  // Ikki marta bosish yoki qayta yozish paytida chop etish — ikkalasi ham shu yerda to'xtaydi.
  if (entry.holat !== "kutmoqda") {
    await answerQuery(query, { text: t(lang, "postInProgress") });
    return;
  }

  if (action === "pub") return publishPost(query, id, entry, lang);
  if (action === "re") return rewritePost(query, id, entry, lang);
  if (action === "no") return cancelPost(query, id, entry, lang);
  await answerQuery(query);
}

/**
 * Postni yuboradi — imkon bo'lsa **bitta xabar**: rasm va uning tagida izoh (caption).
 *
 * Izoh chegarasi 1024 belgi. Yozuvchi shunga moslab yozadi va `agentlar.js` uzunlikni
 * tekshiradi, lekin baribir sig'masa post yo'qolmaydi: rasm va matn alohida ketadi,
 * tugmalar esa matn tagida. Rasm yuborilmasa ham matn baribir yetib boradi.
 *
 * `photo` — Buffer (birinchi yuborish) yoki `file_id` (kanal, qayta yozish).
 *
 * @returns {Promise<{ messageId: number, firstMessageId: number, photoFileId: string }>}
 *   messageId — tugmalar turgan xabar, firstMessageId — havola uchun postning boshi
 */
async function sendPost(chatId, photo, text, replyMarkup) {
  const fileIdOf = (message) => message?.photo?.at(-1)?.file_id ?? ""; // eng katta o'lcham oxirida

  if (photo && tg.captionLength(text) <= tg.CAPTION_LIMIT) {
    try {
      const sent = await tg.sendPhoto(chatId, photo, { caption: text, replyMarkup });
      return { messageId: sent.message_id, firstMessageId: sent.message_id, photoFileId: fileIdOf(sent) };
    } catch (error) {
      // Rasm ketmadi — matnni rasmsiz yuboramiz. Kanal huquqi yo'q bo'lsa matn ham
      // yiqiladi va xato chaqiruvchiga chiqadi — shunisi to'g'ri.
      log.warn("rasmli post yuborilmadi, matn rasmsiz ketadi", { chatId, error: error.message });
      photo = null;
    }
  }

  let firstMessageId = 0;
  let photoFileId = "";
  if (photo) {
    try {
      const sentPhoto = await tg.sendPhoto(chatId, photo);
      firstMessageId = sentPhoto.message_id;
      photoFileId = fileIdOf(sentPhoto);
    } catch (error) {
      log.warn("kover yuborilmadi", { chatId, error: error.message });
    }
  }

  const sent = await tg.sendRichText(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
  return {
    messageId: sent.at(-1)?.message_id ?? 0,
    firstMessageId: firstMessageId || (sent[0]?.message_id ?? 0),
    photoFileId,
  };
}

async function publishPost(query, id, entry, lang) {
  // Kanal tugma chizilgandan keyin uzilgan bo'lishi mumkin — shuning uchun qayta tekshiriladi.
  // Tugma kanal ulanmagan bo'lsa ham chiqadi — shunda qanday ulashni chatda tushuntiramiz
  // (alert yopilgach yo'qoladi, xabar esa qoladi). Tugmalar joyida: ulagach qayta bosiladi.
  const kanal = kanallar.ol(entry.userId);
  if (!kanal) {
    await answerQuery(query);
    await tg.sendMessage(entry.chatId, t(lang, "postNoChannel"), {
      reply_parameters: { message_id: entry.messageId, allow_sending_without_reply: true },
    });
    return;
  }

  // Holat `await` dan oldin o'zgaradi: ikkinchi bosish shu qatordan keyin kelsa ham to'xtaydi.
  entry.holat = "chiqarilmoqda";
  await answerQuery(query, { text: t(lang, "postPublishing") });

  let firstMessageId = 0;
  try {
    // Kanalda ham shaxsiy chatdagidek: rasm + izoh bitta post.
    const sent = await sendPost(kanal.id, entry.photoFileId || entry.photoBuffer, entry.post);
    firstMessageId = sent.firstMessageId;
  } catch (error) {
    entry.holat = "kutmoqda";
    log.error("post kanalga chiqmadi", { userId: entry.userId, kanalId: kanal.id, error: error.message });
    await tg.sendMessage(entry.chatId, t(lang, "postPublishFailed", {
      reason: tg.escapeHtml(error.description ?? error.message),
    }));
    return;
  }

  postlar.ochir(id);
  await tg.editMessageReplyMarkup(entry.chatId, entry.messageId).catch(() => {});

  const link = kanallar.havola(kanal, firstMessageId);
  await tg.sendMessage(
    entry.chatId,
    t(lang, "postPublished", {
      title: tg.escapeHtml(kanal.title),
      link: link ? `\n<a href="${link}">${t(lang, "postOpenLink")}</a>` : "",
    }),
    { reply_parameters: { message_id: entry.messageId, allow_sending_without_reply: true } },
  );

  log.info("post kanalga chiqdi", {
    userId: entry.userId,
    kanalId: kanal.id,
    topic: entry.topic,
    rewrites: entry.rewrites,
  });
}

async function cancelPost(query, id, entry, lang) {
  postlar.ochir(id);
  await answerQuery(query);
  await tg.editMessageReplyMarkup(entry.chatId, entry.messageId).catch(() => {});
  await tg.sendMessage(entry.chatId, t(lang, "postCancelled"), {
    reply_parameters: { message_id: entry.messageId, allow_sending_without_reply: true },
  });
  log.info("post bekor qilindi", { userId: entry.userId, topic: entry.topic });
}

/**
 * Postni qayta yozadi. Material va kover saqlangani ishlatiladi — narxi faqat
 * yozuvchi + muharrir (`agentlar.qaytaYoz`). Post ID o'zgarmaydi, faqat tugmalar
 * yangi xabarga ko'chadi.
 */
async function rewritePost(query, id, entry, lang) {
  const chatId = entry.chatId;

  if (!ai.enabled) {
    await answerQuery(query, { text: t(lang, "aiDisabled"), show_alert: true });
    return;
  }

  if (entry.rewrites >= POST_MAX_USER_REWRITES) {
    await answerQuery(query, {
      text: t(lang, "postRewriteLimit", { max: String(POST_MAX_USER_REWRITES) }),
      show_alert: true,
    });
    return;
  }

  if (busyUsers.has(entry.userId)) {
    await answerQuery(query, { text: t(lang, "aiBusy"), show_alert: true });
    return;
  }

  busyUsers.add(entry.userId);
  entry.holat = "yozilmoqda";
  await answerQuery(query);

  // Eski tugmalar darhol olinadi: qayta yozish paytida eski variant chop etilib ketmasin.
  await tg.editMessageReplyMarkup(chatId, entry.messageId).catch(() => {});
  await tg.sendMessage(chatId, t(lang, "postRewriteStart", {
    round: String(entry.rewrites + 1),
    max: String(POST_MAX_USER_REWRITES),
  }));

  const stopTyping = keepTyping(chatId);
  const startedAt = Date.now();

  try {
    const result = await agentlar.qaytaYoz({
      topic: entry.topic,
      material: entry.material,
      post: entry.post,
      lang,
      userName: entry.userName,
      onStage: (stage) => sendStage(chatId, lang, stage),
    });

    if (result.verdict === "fail") {
      await tg.sendRichText(chatId, t(lang, "postLimitReached", { max: String(result.maxRewrites) }));
    }
    if (result.verdict === "uzun") {
      await tg.sendRichText(chatId, t(lang, "postTooLong", { max: String(agentlar.POST_MAX_CHARS) }));
    }

    entry.post = result.post;
    entry.rewrites += 1;

    // Kover o'zgarmaydi — yangi matn o'sha rasm bilan yana bitta post bo'lib keladi.
    const shown = result.post + (result.truncated ? t(lang, "aiTruncated") : "");
    const sent = await sendPost(chatId, entry.photoFileId || entry.photoBuffer, shown, postKeyboard(lang, id));
    entry.messageId = sent.messageId;
    if (sent.photoFileId && !entry.photoFileId) {
      entry.photoFileId = sent.photoFileId;
      entry.photoBuffer = null;
    }

    log.info("post qayta yozildi", {
      userId: entry.userId,
      durationMs: Date.now() - startedAt,
      topic: entry.topic,
      round: entry.rewrites,
      verdict: result.verdict,
      editorRewrites: result.rewrites,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    });
  } catch (error) {
    // Eski variant joyida qoladi va tugmalari qaytadi — foydalanuvchi uni chop eta oladi.
    await tg.editMessageReplyMarkup(chatId, entry.messageId, postKeyboard(lang, id)).catch(() => {});

    if (error instanceof agentlar.AgentError) {
      log.error("agent fayli o'qilmadi", { userId: entry.userId, file: error.file, reason: error.reason });
      await tg.sendMessage(chatId, t(lang, "postAgentMissing", {
        file: tg.escapeHtml(error.file),
        reason: tg.escapeHtml(error.reason),
      }));
      return;
    }

    if (!(error instanceof ai.AiError)) throw error;

    log.error("qayta yozish xatosi", { userId: entry.userId, code: error.code, error: error.message });
    await tg.sendMessage(chatId, aiErrorText(lang, error.code));
  } finally {
    entry.holat = "kutmoqda";
    stopTyping();
    busyUsers.delete(entry.userId);
  }
}

// ---------------------------------------------------------------
// Kanal ulash: bot kanalga qo'shilganda yoki chiqarilganda
// ---------------------------------------------------------------

/** Foydalanuvchiga xabar. U botga hech yozmagan bo'lsa Telegram 403 beradi — bu xato emas. */
async function notify(userId, text) {
  await tg.sendMessage(userId, text).catch((error) => {
    log.warn("xabar yetmadi", { userId, error: error.message });
  });
}

/**
 * `my_chat_member` — botning biror chatdagi holati o'zgardi.
 *
 * Faqat kanallar qiziq. Bot «Post joylash» huquqi bilan admin bo'lsa, kanal uni qo'shgan
 * odamga bog'lanadi: botni kanalga faqat o'sha kanalning admini qo'sha oladi.
 * Huquq olinsa yoki bot chiqarilsa — kanal kimga bog'langan bo'lsa, hammasidan uziladi.
 */
async function handleMyChatMember(update) {
  const chat = update.chat;
  if (chat?.type !== "channel") return;

  const from = update.from;
  const member = update.new_chat_member ?? {};
  const lang = store.getLanguage(from.id) ?? detectLanguage(from.language_code);
  const title = tg.escapeHtml(chat.title ?? "");
  const canPost = member.status === "administrator" && member.can_post_messages === true;

  if (canPost) {
    if (!kanallar.ruxsat(from.id)) {
      log.warn("kanal ulashga ruxsat yo'q", { userId: from.id, kanalId: chat.id });
      await notify(from.id, t(lang, "kanalRuxsatYoq"));
      return;
    }

    kanallar.ula(from.id, chat);
    log.info("kanal ulandi", { userId: from.id, kanalId: chat.id });
    await notify(from.id, t(lang, "kanalUlandi", { title }));
    return;
  }

  const uzildi = kanallar.uz(chat.id);
  if (uzildi.length > 0) log.info("kanal uzildi", { kanalId: chat.id, status: member.status });

  // Admin, lekin huquqsiz: botni qo'shgan odamga nima yetishmayotganini aytamiz.
  if (member.status === "administrator") {
    await notify(from.id, t(lang, "kanalHuquqYoq", { title }));
    return;
  }

  for (const userId of uzildi) {
    await notify(userId, t(store.getLanguage(userId) ?? lang, "kanalUzildi", { title }));
  }
}

// Botning o'z ID'si — kanalda admin ekanini tekshirish uchun. Startda getMe dan olinadi.
let botId = 0;

/**
 * Allaqachon admin bo'lgan kanalni qo'lda ulash: forward qilingan post yoki `/kanal`.
 *
 * `my_chat_member` faqat botning holati **o'zgarganda** keladi. Bot kanalga shu
 * funksiyadan oldin qo'shilgan bo'lsa, u xabar hech qachon kelmaydi — shuning uchun
 * bu yo'l kerak. Himoya Telegram'dan so'rab tekshiriladi, foydalanuvchining so'ziga emas:
 *   1. bot kanalda «Post joylash» huquqi bilan adminmi
 *   2. so'rayotgan odam o'sha kanalning egasi yoki adminimi
 *
 * `quiet` — forward holati: bot u kanalda admin bo'lmasa, bu shunchaki forward qilingan
 * xabar, ulash urinishi emas. Xato aytilmaydi, xabar oddiy yo'lda davom etadi.
 *
 * @returns {Promise<boolean>} xabarga javob berildimi (ulandi yoki sababi aytildi)
 */
async function connectChannel(chatId, user, lang, ref, { quiet = false } = {}) {
  const say = async (key, vars) => {
    await tg.sendMessage(chatId, t(lang, key, vars));
    return true;
  };

  let chat;
  try {
    chat = await tg.getChat(ref);
  } catch (error) {
    if (quiet) return false;
    log.warn("kanal topilmadi", { userId: user.id, ref: String(ref), error: error.message });
    return say("kanalTopilmadi");
  }

  if (chat.type !== "channel") return quiet ? false : say("kanalEmas");

  const title = tg.escapeHtml(chat.title ?? "");

  let botMember;
  try {
    botMember = await tg.getChatMember(chat.id, botId);
  } catch {
    botMember = { status: "left" };
  }

  const botIsAdmin = botMember.status === "administrator";
  if (!botIsAdmin) return quiet ? false : say("kanalBotAdminEmas", { title });

  // Shu kanal allaqachon ulangan bo'lsa, forward — oddiy xabar (masalan, AI'ga tahlil uchun).
  if (quiet && kanallar.ol(user.id)?.id === chat.id) return false;

  if (!kanallar.ruxsat(user.id)) return say("kanalRuxsatYoq");
  if (botMember.can_post_messages !== true) return say("kanalHuquqYoq", { title });

  let userMember;
  try {
    userMember = await tg.getChatMember(chat.id, user.id);
  } catch {
    userMember = { status: "left" };
  }
  if (!["creator", "administrator"].includes(userMember.status)) {
    log.warn("kanal ulash rad etildi: foydalanuvchi admin emas", { userId: user.id, kanalId: chat.id });
    return say("kanalSizAdminEmas", { title });
  }

  kanallar.ula(user.id, chat);
  log.info("kanal ulandi", { userId: user.id, kanalId: chat.id, usul: quiet ? "forward" : "buyruq" });
  return say("kanalUlandi", { title });
}

async function handleCallbackQuery(query) {
  const data = query.data ?? "";
  const chatId = query.message?.chat?.id;

  if (data.startsWith("post:") && chatId) return handlePostButton(query, chatId);

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
  botId = me.id;

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

  log.info("kanallar o'qildi", {
    ulangan: kanallar.soni(),
    ulashRuxsati: config.kanal.adminIds.length > 0 ? `${config.kanal.adminIds.length} ta admin` : "hamma",
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
