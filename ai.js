// AI qatlami — Claude API bilan suhbat.
//
// Bu modul Telegram haqida hech narsa bilmaydi: kiruvchisi — suhbat tarixi, chiquvchisi —
// matn. Shu sababli uni alohida sinash oson va keyinchalik boshqa kanalga (veb, CLI)
// ulash uchun o'zgartirish kerak bo'lmaydi.

import Anthropic from "@anthropic-ai/sdk";

import * as bilim from "./bilim.js";
import * as kover from "./kover.js";
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

// Bizning o'z vositamiz: chaqiruvni model qiladi, bajarishni biz. Tavsif — vositaning
// eng muhim qismi: model faqat shu matnga qarab qachon chaqirishni hal qiladi.
// Ingliz tilida, chunki model ko'rsatmani shu tilda eng aniq bajaradi.
const BILIM_TOOL = {
  name: "bilim_qidiruv",
  description: [
    "Search the owner's own knowledge base: the notes and documents this business keeps",
    "about itself — services offered, prices, working hours, order and payment procedure,",
    "warranty terms, past decisions, answers to common customer questions.",
    "",
    "Use it whenever the question is about THIS business specifically: what we sell, what",
    "we charge, how long something takes, how we work, what was agreed before. Neither you",
    "nor the internet knows any of that — only these files do. Search before answering, so",
    "the answer is the owner's real answer and not a plausible-sounding guess.",
    "",
    "Do not use it for general knowledge, news, or prices outside this business — that is",
    "what web_search is for. Do not use it for pure writing, reasoning or planning tasks.",
    "",
    "It returns the matching passages with the file and section they came from. If it",
    "returns nothing, say plainly that the knowledge base does not cover it. Never invent",
    "a price, a deadline or a rule that the passages do not state.",
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Key words to look for, in the user's own language. Content words only, no full" +
          " sentence: \"landing price\" rather than \"how much does a landing page cost\".",
      },
    },
    required: ["query"],
  },
};

// Uchinchi vosita — kover rasm. Uni faqat yozuvchi chaqira oladi (`runTool` dagi
// qattiq chegara), lekin e'lon hamma so'rovga qo'shiladi: ro'yxat o'zgarsa prompt-kesh
// kuyardi. Bitta rasm pul turadi, shuning uchun ishonch ko'rsatmaga emas — kodga.
const KOVER_TOOL = {
  name: "kover_rasm",
  description: [
    "Make the cover image for the post you have just written. Call it exactly once per",
    "post, when you already know what the post says.",
    "",
    "The image never carries text: image generators draw letters badly, and the words",
    "belong in the post itself. Describe a scene, not a poster — an object, a place, a",
    "mood that matches the topic.",
    "",
    "If the image cannot be generated (no key, quota spent, the service is down), a plain",
    "template cover is drawn locally instead, using the sarlavha you pass. That is not an",
    "error and needs no comment from you: write the post as usual either way.",
    "",
    "Do not call it for questions, plans or ordinary conversation — only for a post.",
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      tavsif: {
        type: "string",
        description:
          "What the picture shows, in English, one or two sentences. A concrete scene:" +
          " \"a desk with a laptop showing a half-built website, morning light\"." +
          " No text, no letters, no logos in the image.",
      },
      sarlavha: {
        type: "string",
        description:
          "Three to five words in the user's language — the post's short title. It is" +
          " printed on the template cover if image generation is unavailable.",
      },
    },
    required: ["tavsif", "sarlavha"],
  },
};

// Vositalar ro'yxati modul yuklanganda bir marta hisoblanadi va keyin o'zgarmaydi.
// Sabab — prompt-kesh: kesh prefiks bo'yicha ishlaydi, tartib esa `tools -> system ->
// messages`. Ro'yxat so'rovdan so'rovga o'zgarsa, har safar butun kesh kuyib ketardi.
//
// Yon ta'siri: baza butunlay bo'sh bo'lsa vosita e'lon qilinmaydi (bo'sh bazani qidirish
// faqat token sarflaydi), shuning uchun `bilim/` ga *birinchi* fayl qo'shilgandan keyin
// bot qayta ishga tushirilishi kerak. Keyingi o'zgarishlar restartsiz ko'rinadi.
const bilimReady = config.ai.enabled && bilim.stats().chunks > 0;

const TOOL_LIST = [
  ...(bilimReady ? [BILIM_TOOL] : []),
  ...(config.kover.enabled && config.ai.enabled ? [KOVER_TOOL] : []),
  ...(config.ai.webSearch ? [WEB_SEARCH_TOOL] : []),
];

const TOOLS = TOOL_LIST.length > 0 ? TOOL_LIST : undefined;

/** E'lon qilingan vositalar nomi — start logi va sinov uchun. */
export function toolNames() {
  return TOOL_LIST.map((tool) => tool.name);
}

/** Bazadan qidirish mumkinmi — start logi va `/help` matni uchun. */
export const knowledgeBase = bilimReady;

// Qidiruv paytida model `pause_turn` bilan to'xtab, davom ettirishni so'rashi mumkin;
// o'z vositamizni chaqirsa esa `tool_use` bilan to'xtaydi. Ikkalasi ham siklni davom
// ettiradi, shuning uchun chegara umumiy: har bir aylanish alohida so'rov, ya'ni pul.
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
  // Chegaralar ro'yxati yoqilgan vositalarga qarab yig'iladi: model o'zi qila oladigan
  // ishni "qila olmayman" deb aytmasin va aksincha.
  `- If you cannot do something (${[
    ...(config.ai.webSearch ? [] : ["no internet access"]),
    ...(bilimReady ? [] : ["cannot read files"]),
    "cannot send email or create documents yet",
  ].join(", ")}), say so in one line and offer what you can do instead.`,
  "",
  ...(bilimReady
    ? [
        "Knowledge base:",
        "- The bilim_qidiruv tool reads the owner's own notes: services, prices, deadlines,",
        "  order and payment procedure, warranty, past decisions. Those facts exist nowhere",
        "  else — not in your memory, not on the web.",
        "- Search it before answering anything about this business. Never answer such a",
        "  question from memory: an invented price or deadline does real damage.",
        "- Base the answer on the passages you got back and name the file they came from,",
        "  so the owner can see what the answer rests on and correct the file if it is wrong.",
        "- If the search comes back empty, say the knowledge base does not cover it and offer",
        "  to answer once it is added. Do not guess.",
        "- If a passage carries a date or a validity period, mention it.",
        ...(config.ai.webSearch
          ? [
              "- You may use both tools in one answer: the base for our own terms, the web for",
              "  outside facts. Keep it clear which fact came from where.",
            ]
          : []),
        "",
      ]
    : []),
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

/**
 * `/post` buyrug'i uchun qo'shimcha ko'rsatma.
 *
 * Bu sinov rejimi: maqsad — vositalar rostdan ishlayotganini va nima topayotganini
 * ko'rish. Shuning uchun modeldan tayyor post emas, yig'ilgan material so'raladi.
 */
const POST_INSTRUCTIONS = [
  "This turn is a material-gathering step, not a writing step.",
  "",
  "The user named a topic. Before saying anything else, gather what you actually have on",
  "it: search the knowledge base, and search the web too if the topic needs facts from",
  "outside the business. Use the tools — do not answer from memory.",
  "",
  "Then report what you found, in this shape:",
  "1. <b>Bazadan</b> — the concrete facts the knowledge base gave you, each with the file",
  "   it came from. If it gave nothing, say so in one line.",
  "2. <b>Internetdan</b> — the facts the web gave you, each with a link. Skip this section",
  "   entirely if you did not search the web.",
  "3. <b>Yetishmayapti</b> — one or two lines: what is still missing before a good post",
  "   could be written on this topic.",
  "",
  "Do not write the post itself. Do not pad with general advice. If both sources came back",
  "empty, say that plainly instead of filling the space.",
].join("\n");

/**
 * Yozuvchi bosqichi.
 *
 * Uslub, uzunlik va oxirgi qator xarakter faylida turadi — bu yerda faqat
 * o'zgarmaydigan shartnoma: nima chiqishi va nima chiqmasligi kerak.
 */
const WRITER_INSTRUCTIONS = [
  "This turn you are the writer. Your whole output is the post itself.",
  "",
  "- Output the post and nothing else: no preamble like \"Here is the post\", no title",
  "  line, no notes or explanation after it, no quotation marks around it.",
  "- Use only the facts in the material you were given. Never invent a price, deadline,",
  "  percentage, name, date or statistic. If the material does not cover something,",
  "  write around it rather than filling the gap.",
  "- Call kover_rasm once, before you write, so the post gets a cover. Whether the cover",
  "  came from the image service or from the local template changes nothing in your text:",
  "  never mention the cover in the post.",
  "- Do not call any other tool. The material has already been gathered for you.",
  "- The Telegram formatting rules above still apply.",
  "",
  "The character file below was written by the bot owner. It defines your tone, the",
  "length of the post and how it ends. Follow it closely.",
].join("\n");

/**
 * Muharrir bosqichi.
 *
 * Birinchi qator qat'iy: `agentlar.js` shu ikki so'zga qarab qaror qabul qiladi.
 * Shuning uchun format kodda turadi — xarakter faylida emas: fayl egasi uni
 * tasodifan o'chirib qo'ysa, butun sikl buzilardi.
 */
const EDITOR_INSTRUCTIONS = [
  "This turn you are the editor. You check the post; you never rewrite it yourself.",
  "",
  "Answer in exactly this shape:",
  "- The first line is one of these two Uzbek words, written exactly like this, whatever",
  "  language the rest of your answer is in:",
  "    O'TDI        — the post is good enough to publish",
  "    QAYTA YOZ    — the post must be rewritten",
  "- If the first line is QAYTA YOZ, every following line is one reason, starting with",
  "  \"Sabab:\". At most three lines, each one concrete and fixable.",
  "- If the first line is O'TDI, write nothing else at all.",
  "",
  "- No greeting, no praise, no summary, no rewritten post, no tool calls.",
  "- Judge only against the criteria in the character file. Personal taste is not a reason.",
  "",
  "The character file below was written by the bot owner. It defines what you check.",
].join("\n");

/** Har bir foydalanuvchi va kunga xos qism — keshdan keyin keladi. */
function systemPrompt(lang, userName, mode, roleText) {
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
        ...(mode === "post" ? ["", POST_INSTRUCTIONS] : []),
        ...(mode === "yozuvchi" ? ["", WRITER_INSTRUCTIONS] : []),
        ...(mode === "muharrir" ? ["", EDITOR_INSTRUCTIONS] : []),
        // Xarakter fayli oxirida turadi va chegara bilan ajratiladi: u ko'rsatma emas,
        // ko'rsatmaga berilgan material — modelga shu farq ko'rinib tursin.
        ...(roleText ? ["", `--- character file (agentlar/${mode}.md) ---`, roleText] : []),
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
 * @param {string}   [params.mode]    "post" | "yozuvchi" | "muharrir" — bosqich ko'rsatmasi
 * @param {string}   [params.roleText] agent xarakter faylining matni (agentlar/*.md)
 * @param {boolean}  [params.koverDone] kover allaqachon yasalgan — qaytadan yasalmasin
 * @returns {Promise<{ text: string, truncated: boolean, usage: object, searches: number,
 *                     searchErrors: string[], bilimCalls: object[] }>}
 */
export async function ask({ history, lang, userName, mode, roleText, koverDone = false }) {
  if (!client) throw new AiError("disabled", "ANTHROPIC_API_KEY ko'rsatilmagan");

  const system = systemPrompt(lang, userName, mode, roleText);

  // Qidiruv paytida javob bir necha so'rovga bo'linishi mumkin. `messages` shu turning
  // ish nusxasi: modelning oraliq javoblari (qidiruv chaqiruvi va natijasi) shu yerda
  // to'planadi va keyingi so'rovga qaytariladi. Suhbat tarixiga esa faqat oxirgi matn
  // yoziladi — natijalarni saqlab yursak, har bir keyingi savol qimmatlashib borardi.
  const messages = [...history];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const searchErrors = [];
  // Vosita rostdan chaqirilganini keyin ko'rsatish uchun: modelning gapiga emas, shu
  // ro'yxatga qaraymiz. `mode` shu yerda turadi, chunki kover vositasi faqat yozuvchi
  // bosqichida ishlaydi — chegarani kod qo'yadi, ko'rsatma emas.
  const bilimCalls = [];
  const toolCtx = { bilimCalls, mode, kover: null, koverDone };
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

    // Sikl ikki sababga ko'ra davom etadi:
    //   tool_use   — model bizning vositamizni chaqirdi, natijasini kutyapti
    //   pause_turn — model ishini tugatmadi, davom ettirishni so'rayapti
    const toolUses = (response.content ?? []).filter((block) => block.type === "tool_use");
    const needsTools = response.stop_reason === "tool_use" && toolUses.length > 0;
    if (!needsTools && response.stop_reason !== "pause_turn") break;

    if (turn >= MAX_TURNS) {
      turnLimitHit = true;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    // Har bir `tool_use` ga javob qaytishi shart — biri qolib ketsa API xato beradi.
    // Ketma-ket bajariladi, parallel emas: "bitta post — bitta kover" chegarasi
    // parallel chaqiruvda poygaga tushib qolardi.
    if (needsTools) {
      const results = [];
      for (const block of toolUses) results.push(await runTool(block, toolCtx));
      messages.push({ role: "user", content: results });
    }
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
    bilimCalls,
    kover: toolCtx.kover,
  };
}

/**
 * Modelning vosita chaqiruvini bajaradi.
 *
 * Xato tashlanmaydi: `is_error` bilan qaytarilgan natija modelga "bu ishlamadi" degan
 * ma'lumot beradi va u javobini vositasiz yakunlaydi. Bu `web_search` xatosi bilan bir
 * xil qoida — bitta vosita ishlamagani uchun butun javob yo'qolmasin.
 */
async function runTool(block, ctx) {
  const result = { type: "tool_result", tool_use_id: block.id };

  if (block.name === KOVER_TOOL.name) return runKover(block, ctx, result);

  if (block.name !== BILIM_TOOL.name) {
    return { ...result, is_error: true, content: `Bunday vosita yo'q: ${block.name}` };
  }

  const query = typeof block.input?.query === "string" ? block.input.query.trim() : "";

  try {
    const found = bilim.search(query);
    ctx.bilimCalls.push({
      query,
      chunks: found.hits.length,
      files: [...new Set(found.hits.map((hit) => hit.file))],
    });
    return { ...result, content: bilim.format(found) };
  } catch (error) {
    const message = error?.message ?? String(error);
    ctx.bilimCalls.push({ query, chunks: 0, files: [], error: message });
    return { ...result, is_error: true, content: `Bilim bazasi o'qilmadi: ${message}` };
  }
}

/**
 * Kover rasm vositasi.
 *
 * Ikkita chegara shu yerda, ko'rsatmada emas: bot ochiq va har rasm pul turadi,
 * model esa ko'rsatmadan chetga chiqishi mumkin.
 *   1. faqat yozuvchi bosqichi chaqira oladi
 *   2. bitta post — bitta rasm
 *
 * Rasmning o'zi modelga qaytarilmaydi: bir qator matn yetarli, baytlar esa javob
 * obyektida yuqoriga chiqadi. Rasmni modelga ko'rsatish o'n minglab token bo'lardi.
 */
async function runKover(block, ctx, result) {
  if (ctx.mode !== "yozuvchi") {
    return { ...result, is_error: true, content: "Bu vosita faqat post yozishda ishlaydi." };
  }
  // `koverDone` — oldingi so'rovda yasalgani (qayta yozish), `ctx.kover` — shu so'rovda.
  if (ctx.koverDone || ctx.kover) {
    return { ...result, is_error: true, content: "Kover allaqachon yasaldi — bittadan ko'p kerak emas." };
  }

  const tavsif = typeof block.input?.tavsif === "string" ? block.input.tavsif.trim() : "";
  const sarlavha = typeof block.input?.sarlavha === "string" ? block.input.sarlavha.trim() : "";

  try {
    const made = await kover.yasa({ tavsif, sarlavha });
    ctx.kover = { ...made, sarlavha };
    return {
      ...result,
      content: made.usul === "api"
        ? "Kover tayyor."
        : `Kover shablon bo'lib chizildi (${made.sabab}). Post matnini o'zgartirish shart emas.`,
    };
  } catch (error) {
    // `kover.yasa` xato tashlamasligi kerak, lekin shunda ham post yo'qolmasin.
    return { ...result, is_error: true, content: `Kover yasalmadi: ${error?.message ?? error}` };
  }
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
