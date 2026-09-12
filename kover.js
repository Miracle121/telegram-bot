// Kover rasm — post uchun muqova.
//
// Ikki yo'l bor va ikkalasi ham bitta funksiyadan chiqadi:
//   asosiy  — Gemini rasm API'si (kalit `.env` da)
//   zaxira  — lokal shablon: gradient fon + sarlavha + brend nomi
//
// Bu modul **hech qachon xato tashlamaydi**. Kalit yo'qmi, limit tugadimi, API
// javob bermadimi — natija baribir PNG bo'lib qaytadi, faqat `usul: "shablon"`
// va `sabab` maydoni nima bo'lganini aytadi. Sabab: kover — postning bezagi,
// uning uchun butun post yo'qolmasin.
//
// AI ham, Telegram ham bilmaydi: kiruvchisi — tavsif va sarlavha, chiquvchisi — bayt.

import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";

import * as PImage from "pureimage";

import { config } from "./config.js";

// Telegram kover uchun qulay nisbat — 1.91:1. Kattaroq o'lcham faqat trafik.
const WIDTH = 1200;
const HEIGHT = 630;

const MARGIN = 90;
const TITLE_SIZE = 52;
const BRAND_SIZE = 26;
const MAX_TITLE_LINES = 3;

// Telegram rasm uchun chegara — 10 MB. Undan kattasi kelsa yubormaymiz.
const MAX_BYTES = 10 * 1024 * 1024;

const FONT_FILE = path.join(import.meta.dirname, "assets", "DejaVuSans-Bold.ttf");
const FONT_NAME = "Kover";

// Shrift modul yuklanganda bir marta o'qiladi: har koverda 700 KB ni qayta o'qib
// o'tirmaymiz. O'qilmasa ham to'xtamaymiz — matnsiz fon baribir koverdan yaxshiroq.
let fontReady = false;
try {
  PImage.registerFont(FONT_FILE, FONT_NAME).loadSync();
  fontReady = true;
} catch {
  fontReady = false;
}

/** Shrift joyidami — start logi uchun. */
export const hasFont = fontReady;

/** Gradient fonning yuqori va pastki rangi. */
const BG_TOP = [11, 37, 69];
const BG_BOTTOM = [26, 64, 112];
const ACCENT = "#f0a202";
const TITLE_COLOR = "#ffffff";
const BRAND_COLOR = "#9fb3c8";

// ---------------------------------------------------------------
// Tashqi interfeys
// ---------------------------------------------------------------

/**
 * Kover yasaydi.
 *
 * @param {{ tavsif: string, sarlavha: string }} params
 * `sabab` — kalit emas, **kod**: `kalitYoq | kalitIshlamadi | limit | rad | javobYoq |
 * buzuq`. Matnga aylantirish `i18n.js` ishi, chunki foydalanuvchi uch tilda bo'ladi.
 *
 * @returns {Promise<{ buffer: Buffer, usul: "api"|"shablon", sabab: string }>}
 */
export async function yasa({ tavsif, sarlavha }) {
  const title = (sarlavha ?? "").trim();

  if (!config.kover.apiKey) {
    return { buffer: await shablon(title), usul: "shablon", sabab: "kalitYoq" };
  }

  try {
    const buffer = await gemini((tavsif ?? "").trim());
    return { buffer, usul: "api", sabab: "" };
  } catch (error) {
    // Xato bu yerda tugaydi: yuqoriga faqat tayyor shablon chiqadi.
    return {
      buffer: await shablon(title),
      usul: "shablon",
      sabab: error instanceof KoverError ? error.sabab : "javobYoq",
    };
  }
}

/** Ichki xato — `yasa()` dan tashqariga chiqmaydi, faqat sababni olib o'tadi. */
class KoverError extends Error {
  constructor(sabab, message) {
    super(message ?? sabab);
    this.name = "KoverError";
    this.sabab = sabab;
  }
}

// ---------------------------------------------------------------
// Asosiy yo'l — Gemini
// ---------------------------------------------------------------

/**
 * Rasm so'rovi. Modelga tavsif beriladi, lekin **matn chizmaslik** alohida
 * ta'kidlanadi: rasm generatorlari harflarni buzib chizadi, sarlavha esa
 * postning o'zida turibdi.
 */
function prompt(tavsif) {
  return [
    tavsif,
    "Editorial cover illustration for a social media post.",
    "Absolutely no text, no letters, no words, no numbers, no logos in the image.",
    "Clean modern composition, soft lighting, calm colours, plenty of empty space.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function gemini(tavsif) {
  let response;
  try {
    response = await fetch(`${config.kover.apiBase}/v1beta/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": config.kover.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.kover.model,
        input: [{ type: "text", text: prompt(tavsif) }],
        response_format: {
          // Faqat "image/jpeg" qabul qilinadi — "image/png" ga API 400 qaytaradi
          // ("Supported values: 'image/jpeg'"). Shablon esa PNG bo'lib chiziladi,
          // shuning uchun `sendPhoto` turni baytlarga qarab aniqlaydi.
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: "16:9",
          image_size: "1K",
        },
      }),
      signal: AbortSignal.timeout(config.kover.timeoutMs),
    });
  } catch {
    // Tarmoq uzildi yoki vaqt tugadi.
    throw new KoverError("javobYoq");
  }

  if (!response.ok) throw new KoverError(statusSabab(response.status), `HTTP ${response.status}`);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new KoverError("buzuq");
  }

  const base64 = rasmniTop(data);
  if (!base64) throw new KoverError("buzuq", "javobda rasm yo'q");

  const buffer = Buffer.from(base64, "base64");
  if (!rasmmi(buffer)) throw new KoverError("buzuq", "bayt rasm emas");
  if (buffer.length > MAX_BYTES) throw new KoverError("buzuq", "rasm juda katta");

  return buffer;
}

/** HTTP kodini foydalanuvchi tushunadigan sababga aylantiradi. */
function statusSabab(status) {
  if (status === 401 || status === 403) return "kalitIshlamadi";
  if (status === 429) return "limit";
  if (status === 400 || status === 422) return "rad";
  return "javobYoq";
}

/**
 * Javobdan base64 rasmni topadi.
 *
 * Ikki joyga qaraydi: qulaylik maydoni (`output_image`) va qadamlar ro'yxati
 * (`steps[].content[]`). Javob tuzilishi o'zgarsa ham kover yo'qolmasin.
 */
function rasmniTop(data) {
  const direct = data?.output_image?.data;
  if (typeof direct === "string" && direct.length > 0) return direct;

  for (const step of data?.steps ?? []) {
    for (const part of step?.content ?? []) {
      if (part?.type === "image" && typeof part.data === "string" && part.data.length > 0) {
        return part.data;
      }
    }
  }
  return "";
}

/** PNG yoki JPEG sarlavhasi bormi — API matn yoki xato qaytarib yubormaganini tekshiramiz. */
function rasmmi(buffer) {
  if (buffer.length < 8) return false;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return png || jpeg;
}

// ---------------------------------------------------------------
// Zaxira yo'l — lokal shablon
// ---------------------------------------------------------------

/**
 * Shablon kover: gradient fon, sarlavha va brend nomi.
 *
 * Hech qanday tarmoq so'rovi yo'q va narxi nol. Shrift o'qilmagan bo'lsa matn
 * tushib qoladi, fon esa baribir chiziladi.
 */
export async function shablon(sarlavha) {
  const img = PImage.make(WIDTH, HEIGHT);
  const ctx = img.getContext("2d");

  gradient(ctx);

  if (fontReady) {
    const lines = ochish(ctx, (sarlavha || config.kover.brand).toUpperCase());

    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `${TITLE_SIZE}pt ${FONT_NAME}`;
    let y = HEIGHT / 2 - ((lines.length - 1) * (TITLE_SIZE + 22)) / 2;
    for (const line of lines) {
      ctx.fillText(line, MARGIN, y);
      y += TITLE_SIZE + 22;
    }

    // Sarlavha bilan brend orasidagi qisqa chiziq — ular bir-biriga qo'shilib ketmasin.
    ctx.fillStyle = ACCENT;
    ctx.fillRect(MARGIN, HEIGHT - 150, 90, 8);

    ctx.fillStyle = BRAND_COLOR;
    ctx.font = `${BRAND_SIZE}pt ${FONT_NAME}`;
    ctx.fillText(config.kover.brand, MARGIN, HEIGHT - 95);
  }

  return encode(img);
}

/** Vertikal gradient — pureimage'da gradient yo'q, shuning uchun qator-qator chiziladi. */
function gradient(ctx) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const k = y / (HEIGHT - 1);
    const [r, g, b] = BG_TOP.map((from, i) => Math.round(from + (BG_BOTTOM[i] - from) * k));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, WIDTH, 1);
  }
}

/** Sarlavhani qatorlarga bo'ladi. Sig'magani "…" bilan kesiladi. */
function ochish(ctx, text) {
  ctx.font = `${TITLE_SIZE}pt ${FONT_NAME}`;
  const limit = WIDTH - MARGIN * 2;
  const lines = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (PImage.measureText(ctx, candidate).width <= limit || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === MAX_TITLE_LINES) break;
  }

  if (lines.length < MAX_TITLE_LINES && current) lines.push(current);
  if (lines.length === 0) return [];

  // Oxirgi qator chegaradan oshsa qisqartiramiz — chetdan chiqib ketgani xunuk.
  const last = lines.length - 1;
  while (PImage.measureText(ctx, lines[last]).width > limit && lines[last].length > 1) {
    lines[last] = `${lines[last].slice(0, -2)}…`;
  }
  return lines;
}

/** Rasmni PNG baytga aylantiradi. */
async function encode(img) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  await PImage.encodePNGToStream(img, stream);
  return Buffer.concat(chunks);
}

/** Shrift fayli joyidami — startda tekshirish uchun. */
export function fontPath() {
  return fs.existsSync(FONT_FILE) ? FONT_FILE : "";
}
