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

// Server tomonda ishlaydigan qidiruv asbobi: biz hech narsa bajarmaymiz, natija shu
// javobning ichida keladi. Shu sababli tool-loop yozish kerak emas.
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: config.ai.webSearchMaxUses,
};

const TOOLS = config.ai.webSearch ? [WEB_SEARCH_TOOL] : undefined;

// Qidiruv paytida model `pause_turn` bilan to'xtab, davom ettirishni so'rashi mumkin.
// Sikl cheksiz bo'lmasligi uchun chegara: har bir aylanish alohida so'rov, ya'ni pul.
const MAX_TURNS = 6;

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
 * Tizim ko'rsatmasi ikkiga bo'lingan — bu prompt-keshi uchun.
 *
 * Kesh prefiks bo'yicha ishlaydi va tartib shunday: tools -> system -> messages.
 * `web_search` asbobining ta'rifi o'zi ~6000 token — qidiruv bo'lmaganda ham har bir
 * so'rovga qo'shiladi. Shuning uchun o'zgarmas qism (asbob + umumiy qoidalar) oldinda
 * turadi va kesh nuqtasi bilan belgilanadi: uni hamma foydalanuvchi baham ko'radi.
 * O'zgaruvchan qism (ism, sana, til) esa keyin keladi va keshni buzmaydi.
 *
 * Ingliz tilida yozilgan (model ko'rsatmalarni shu tilda eng aniq bajaradi), lekin javob
 * tili har doim foydalanuvchi tanlagan til bo'ladi.
 */
const STABLE_SYSTEM = [
  "You are a business assistant working inside a Telegram chat.",
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
  "- Be concise. This is a chat, not a report: 3-10 short lines is the normal length.",
  "  Go longer only when the user asks for depth or the task genuinely needs it.",
  "- Lead with the answer. No preamble, no restating the question back.",
  "- Plans and lists must be concrete: real times, real numbers, real next actions.",
  "  Never answer with generic advice that would fit any business.",
  "- Ask a clarifying question only when the answer would be useless without it.",
  "  Otherwise make a reasonable assumption and state it in one line.",
  config.ai.webSearch
    ? "- If you cannot do something (cannot read files, cannot send email or create files yet), say so in one line and offer what you can do instead."
    : "- If you cannot do something (no internet access, cannot read files, cannot send email or create files yet), say so in one line and offer what you can do instead.",
  "",
  ...(config.ai.webSearch
    ? [
        "Web search:",
        "- You have a web_search tool. Use it when the answer depends on facts you cannot",
        "  know from memory: today's prices, news, competitors, recent events, anything",
        "  that changed after your training.",
        "- Do not search for what you already know, for the user's own private matters,",
        "  or for pure reasoning and writing tasks. Searching costs money and time.",
        "- Prefer one well-aimed search over several vague ones.",
        "- When an answer rests on something you found, say where it came from and link it:",
        "  <a href=\"https://...\">source name</a>. Never state a searched fact bare.",
        "- Say the date of what you found when it matters (prices, rates, news).",
        "- If the search finds nothing useful, say so plainly. Never fill the gap by guessing.",
        "",
      ]
    : []),
  "Formatting for Telegram:",
  "- Plain text plus a small HTML subset only: <b>, <i>, <u>, <s>, <code>, <pre>, <a href=\"\">.",
  "- Never use Markdown: no **bold**, no ## headings, no ``` fences, no [text](url).",
  "- Bullet lines start with the character •. Numbered steps start with 1. 2. 3.",
  "- Write a literal < as &lt; and a literal & as &amp;.",
  "- No tables — Telegram cannot render them. Use short labelled lines instead.",
].join("\n");

/** Har bir foydalanuvchi va kunga xos qism — keshdan keyin keladi. */
function systemPrompt(lang, userName) {
  const today = new Date();
  const date = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString("en-US", { weekday: "long" });
  const language = LANGUAGE_NAMES[lang] ?? LANGUAGE_NAMES.uz;

  return [
    { type: "text", text: STABLE_SYSTEM, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: [
        `The user is ${userName || "unnamed"}. Today is ${date} (${weekday}).`,
        `Always answer in ${language}, no matter which language the question is written in.`,
      ].join("\n"),
    },
  ];
}

/**
 * Suhbat tarixini modelga yuboradi va javob matnini qaytaradi.
 *
 * @param {object}   params
 * @param {Array<{role: "user"|"assistant", content: string}>} params.history
 * @param {string}   params.lang      javob tili (uz | ru | en)
 * @param {string}   params.userName  foydalanuvchi ismi — murojaat uchun
 * @returns {Promise<{ text: string, truncated: boolean, usage: object, searches: number,
 *                     searchErrors: string[] }>}
 */
export async function ask({ history, lang, userName }) {
  if (!client) throw new AiError("disabled", "ANTHROPIC_API_KEY ko'rsatilmagan");

  const system = systemPrompt(lang, userName);

  // Qidiruv paytida javob bir necha so'rovga bo'linishi mumkin. `messages` shu turning
  // ish nusxasi: modelning oraliq javoblari (qidiruv chaqiruvi va natijasi) shu yerda
  // to'planadi va keyingi so'rovga qaytariladi. Suhbat tarixiga esa faqat oxirgi matn
  // yoziladi — natijalarni saqlab yursak, har bir keyingi savol qimmatlashib borardi.
  const messages = [...history];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const searchErrors = [];
  let searches = 0;
  let response;
  let turnLimitHit = false;

  for (let turn = 1; ; turn += 1) {
    try {
      response = await client.beta.messages.create({
        model: config.ai.model,
        max_tokens: config.ai.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system,
        // Adaptiv fikrlash: model murakkablikka qarab o'zi qancha o'ylashni tanlaydi.
        // `effort` esa umumiy chuqurlikni belgilaydi — Telegram uchun kutish vaqti muhim,
        // shuning uchun standart qiymat "medium" (AI_EFFORT bilan o'zgartiriladi).
        thinking: { type: "adaptive" },
        output_config: { effort: config.ai.effort },
        ...(TOOLS ? { tools: TOOLS } : {}),
        messages,
      });
    } catch (error) {
      throw toAiError(error);
    }

    addUsage(usage, response.usage);
    for (const block of response.content ?? []) {
      if (block.type !== "web_search_tool_result") continue;
      // Qidiruv xatosi exception tashlamaydi: javob 200 bilan keladi, natija bloki
      // ichida esa massiv o'rniga `{ error_code }` obyekti bo'ladi.
      if (Array.isArray(block.content)) searches += 1;
      else searchErrors.push(block.content?.error_code ?? "unknown");
    }

    if (response.stop_reason === "refusal") {
      throw new AiError("refused", response.stop_details?.explanation ?? "model javob bermadi");
    }

    // `pause_turn` — model ishini tugatmadi, davom ettirishni so'rayapti.
    // Javobini o'zgartirmasdan qaytarib yuboramiz.
    if (response.stop_reason !== "pause_turn") break;

    if (turn >= MAX_TURNS) {
      turnLimitHit = true;
      break;
    }

    messages.push({ role: "assistant", content: response.content });
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new AiError("empty", `bo'sh javob (stop_reason: ${response.stop_reason})`);

  return {
    text,
    truncated: response.stop_reason === "max_tokens" || turnLimitHit,
    usage,
    searches,
    searchErrors,
  };
}

/** Bir necha so'rovning token hisobini bitta obyektga qo'shib boradi. */
function addUsage(total, usage) {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
  }
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
