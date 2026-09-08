// AI qatlami — Claude API bilan suhbat.
//
// Bu modul Telegram haqida hech narsa bilmaydi: kiruvchisi — suhbat tarixi, chiquvchisi —
// matn. Shu sababli uni alohida sinash oson va keyinchalik boshqa kanalga (veb, CLI)
// ulash uchun o'zgartirish kerak bo'lmaydi.

import Anthropic from "@anthropic-ai/sdk";

import { config } from "./config.js";
import { LANGUAGE_NAMES } from "./i18n.js";

// Model xavfsizlik sababli javob berishdan bosh tortsa, so'rov server tomonda avtomatik
// boshqa modelga o'tkaziladi. Busiz foydalanuvchi shunchaki bo'sh javob olardi.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** AI sozlanganmi. Kalit bo'lmasa bot baribir ishlaydi, faqat suhbat qismi o'chiq bo'ladi. */
export const enabled = config.ai.enabled;

const client = enabled
  ? new Anthropic({
      apiKey: config.ai.apiKey,
      timeout: config.ai.timeoutMs,
      maxRetries: 2,
    })
  : null;

/**
 * AI qatlamining xatosi.
 * `code` — i18n kalitini tanlaydi, ya'ni foydalanuvchi qanday tushuntirish olishini.
 */
export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiError";
    this.code = code; // disabled | rateLimit | auth | timeout | refused | empty | unknown
  }
}

/**
 * Tizim ko'rsatmasi — botning xarakteri shu yerda.
 * Ingliz tilida yozilgan (model ko'rsatmalarni shu tilda eng aniq bajaradi), lekin javob
 * tili har doim foydalanuvchi tanlagan til bo'ladi.
 */
function systemPrompt(lang, userName) {
  const today = new Date();
  const date = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString("en-US", { weekday: "long" });
  const language = LANGUAGE_NAMES[lang] ?? LANGUAGE_NAMES.uz;

  return [
    `You are a business assistant working inside a Telegram chat. The user is ${userName || "unnamed"}.`,
    `Today is ${date} (${weekday}).`,
    "",
    "What you help with: planning days and weeks, turning goals into concrete plans,",
    "analysing customer feedback and drawing conclusions from it, summarising long texts,",
    "drafting messages and documents, and thinking through business decisions.",
    "",
    "Tone and character:",
    "- Be polite and warm with everyone, in every single answer. Greetings, thanks and",
    "  small talk get a friendly reply, not a correction.",
    "- Never belittle the person asking. No matter how simple, confused, misspelled or",
    "  badly worded the question is: do not call it obvious, basic, easy or wrong, do not",
    "  say they should have known, do not lecture them, do not correct their spelling or",
    "  grammar unless they ask. Just answer the question they meant to ask.",
    "- If they are rude, frustrated or angry, stay calm and courteous. Never answer in kind.",
    "- If you must disagree or say they are mistaken, do it gently and about the fact,",
    "  never about the person.",
    "- Emoji are allowed and welcome, but keep them light: at most one or two per message,",
    "  as a friendly touch. They never replace the answer itself.",
    "",
    "How to answer:",
    `- Always answer in ${language}, no matter which language the question is written in.`,
    "- Be concise. This is a chat, not a report: 3-10 short lines is the normal length.",
    "  Go longer only when the user asks for depth or the task genuinely needs it.",
    "- Lead with the answer. No preamble, no restating the question back.",
    "- Plans and lists must be concrete: real times, real numbers, real next actions.",
    "  Never answer with generic advice that would fit any business.",
    "- Ask a clarifying question only when the answer would be useless without it.",
    "  Otherwise make a reasonable assumption and state it in one line.",
    "- If you cannot do something (no internet access, cannot read files, cannot send",
    "  email or create files yet), say so in one line and offer what you can do instead.",
    "",
    "Formatting for Telegram:",
    "- Plain text plus a small HTML subset only: <b>, <i>, <u>, <s>, <code>, <pre>, <a href=\"\">.",
    "- Never use Markdown: no **bold**, no ## headings, no ``` fences, no [text](url).",
    "- Bullet lines start with the character •. Numbered steps start with 1. 2. 3.",
    "- Write a literal < as &lt; and a literal & as &amp;.",
    "- No tables — Telegram cannot render them. Use short labelled lines instead.",
  ].join("\n");
}

/**
 * Suhbat tarixini modelga yuboradi va javob matnini qaytaradi.
 *
 * @param {object}   params
 * @param {Array<{role: "user"|"assistant", content: string}>} params.history
 * @param {string}   params.lang      javob tili (uz | ru | en)
 * @param {string}   params.userName  foydalanuvchi ismi — murojaat uchun
 * @returns {Promise<{ text: string, truncated: boolean, usage: object }>}
 */
export async function ask({ history, lang, userName }) {
  if (!client) throw new AiError("disabled", "ANTHROPIC_API_KEY ko'rsatilmagan");

  let response;
  try {
    response = await client.beta.messages.create({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: systemPrompt(lang, userName),
      // Adaptiv fikrlash: model murakkablikka qarab o'zi qancha o'ylashni tanlaydi.
      // `effort` esa umumiy chuqurlikni belgilaydi — Telegram uchun kutish vaqti muhim,
      // shuning uchun standart qiymat "medium" (AI_EFFORT bilan o'zgartiriladi).
      thinking: { type: "adaptive" },
      output_config: { effort: config.ai.effort },
      messages: history,
    });
  } catch (error) {
    throw toAiError(error);
  }

  if (response.stop_reason === "refusal") {
    throw new AiError("refused", response.stop_details?.explanation ?? "model javob bermadi");
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new AiError("empty", `bo'sh javob (stop_reason: ${response.stop_reason})`);

  return {
    text,
    truncated: response.stop_reason === "max_tokens",
    usage: response.usage ?? {},
  };
}

/** SDK xatosini foydalanuvchiga ko'rsatiladigan sababga aylantiradi. */
function toAiError(error) {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AiError("auth", error.message);
  if (error instanceof Anthropic.RateLimitError) return new AiError("rateLimit", error.message);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", error.message);
  if (error instanceof Anthropic.APIConnectionError) return new AiError("timeout", error.message);
  return new AiError("unknown", error.message ?? String(error));
}
