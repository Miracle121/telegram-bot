// Telegram Bot API bilan ishlash qatlami.
// Node 20+ ichidagi fetch ishlatiladi — qo'shimcha HTTP paket kerak emas.

import { config } from "./config.js";

// Manzilni almashtirish mumkin — lokal test yoki o'z Bot API serveringiz uchun
const API_HOST = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "");
const API_BASE = `${API_HOST}/bot${config.token}`;

// Rasm matndan katta va sekinroq ketadi — unga alohida, uzunroq chegara.
const PHOTO_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export class TelegramError extends Error {
  constructor(method, status, description, parameters) {
    super(`${method}: ${description}`);
    this.name = "TelegramError";
    this.method = method;
    this.status = status;
    this.description = description;
    this.parameters = parameters ?? {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bot API metodini chaqiradi.
 * - har bir so'rov 10 soniyada uziladi (osilib qolmaslik uchun)
 * - 429 da Telegram bergan retry_after hurmat qilinadi
 * - 5xx va tarmoq xatolarida eksponensial backoff bilan qayta uriniladi
 * - 4xx (masalan 403 — foydalanuvchi botni bloklagan) qayta urinilmaydi
 */
export async function callApi(method, payload = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok && body.ok) return body.result;

      const error = new TelegramError(
        method,
        response.status,
        body.description ?? `HTTP ${response.status}`,
        body.parameters,
      );

      // 429 — sekinlashtiramiz va yana urinamiz
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const waitSeconds = error.parameters.retry_after ?? 1;
        await sleep(waitSeconds * 1000);
        lastError = error;
        continue;
      }

      // 5xx — Telegram tomonda vaqtinchalik muammo
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        lastError = error;
        continue;
      }

      throw error;
    } catch (error) {
      if (error instanceof TelegramError) throw error;

      // Tarmoq xatosi yoki timeout
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

function backoffMs(attempt) {
  const base = 300 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 200); // jitter
}

// HTML parse_mode uchun foydalanuvchi matnini xavfsiz qilish
export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const sendMessage = (chatId, text, extra = {}) =>
  callApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra,
  });

export const sendChatAction = (chatId, action = "typing") =>
  callApi("sendChatAction", { chat_id: chatId, action });

// Telegram bitta xabarga 4096 belgi ruxsat beradi; AI javobi undan uzun bo'lishi mumkin.
const MAX_MESSAGE_LENGTH = 4096;

/**
 * AI javobini yuboradi.
 *
 * Ikkita ehtiyot chorasi bor:
 *  - uzun matn bo'laklarga bo'linadi (imkon qadar abzas chegarasidan);
 *  - model noto'g'ri HTML yozib qo'ysa Telegram 400 qaytaradi — bunday holatda
 *    o'sha bo'lak formatlashsiz, oddiy matn sifatida qayta yuboriladi.
 */
export async function sendRichText(chatId, text) {
  for (const chunk of splitText(text, MAX_MESSAGE_LENGTH)) {
    try {
      await sendMessage(chatId, chunk);
    } catch (error) {
      const badHtml = error instanceof TelegramError && error.status === 400;
      if (!badHtml) throw error;
      await sendMessage(chatId, chunk, { parse_mode: undefined });
    }
  }
}

/** Matnni chegaradan oshmaydigan bo'laklarga bo'ladi. */
export function splitText(text, limit = MAX_MESSAGE_LENGTH) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // Eng ma'qul joy — abzas oxiri, keyin qator oxiri, bo'lmasa shunchaki kesamiz
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    const at = cut > limit * 0.5 ? cut : limit;
    chunks.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Rasm yuboradi.
 *
 * `callApi` dan alohida: u JSON yuboradi, rasm esa multipart bo'lishi kerak.
 * Yangi paket kerak emas — `FormData` va `Blob` Node 20 ichida bor, `fetch`
 * chegara qatorini o'zi qo'yadi.
 *
 * Qayta urinish yo'q: rasm katta, uni ikki marta yuborish trafik va vaqt.
 * Yiqilsa `bot.js` postni matn bo'lib yuboraveradi.
 */
export async function sendPhoto(chatId, buffer, { caption = "", parseMode = "HTML" } = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([buffer], { type: "image/png" }), "kover.png");
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", parseMode);
  }

  const response = await fetch(`${API_BASE}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
  });

  const body = await response.json().catch(() => ({}));
  if (response.ok && body.ok) return body.result;

  throw new TelegramError(
    "sendPhoto",
    response.status,
    body.description ?? `HTTP ${response.status}`,
    body.parameters,
  );
}

export const answerCallbackQuery = (callbackQueryId, extra = {}) =>
  callApi("answerCallbackQuery", { callback_query_id: callbackQueryId, ...extra });

export const editMessageReplyMarkup = (chatId, messageId, replyMarkup = { inline_keyboard: [] }) =>
  callApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });

export const getMe = () => callApi("getMe");

export const setWebhook = (url, secretToken) =>
  callApi("setWebhook", {
    url,
    secret_token: secretToken,
    // Faqat kerakli update turlarini olamiz — ortiqcha trafik kesiladi
    allowed_updates: ["message", "callback_query"],
    max_connections: 40,
  });

export const deleteWebhook = (dropPendingUpdates = false) =>
  callApi("deleteWebhook", { drop_pending_updates: dropPendingUpdates });

export const getWebhookInfo = () => callApi("getWebhookInfo");
