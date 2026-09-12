// Agentlar — post yozish oqimi: material yig'iladi, yozuvchi yozadi, muharrir tekshiradi.
//
// Modul ikki ish qiladi:
//   1. `agentlar/` papkasidagi xarakter fayllarini o'qiydi (mtime bo'yicha keshlab)
//   2. material -> yozuvchi -> muharrir -> (qayta yoz) siklini boshqaradi
//
// Xarakter fayli — ko'rsatmaning faqat bir qismi. Muharrir javobining formati
// (`O'TDI` / `QAYTA YOZ`) `ai.js` da qat'iy turadi: fayl egasi uni tasodifan
// o'chirib qo'ysa ham oqim buzilmasin.
//
// Telegram haqida hech narsa bilmaydi: bosqichlarni `onStage` orqali xabar qiladi,
// ularni foydalanuvchiga ko'rsatish `bot.js` ishi.

import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";
import * as ai from "./ai.js";

const ROLES = ["yozuvchi", "muharrir"];

// Xarakter fayli har chaqiruvda modelga yuboriladi — ya'ni har bir kilobayt pul.
// Bu chegara tasodifan qo'yilgan katta faylni ushlab qoladi.
const MAX_FILE_BYTES = 64 * 1024;

/** Xarakter fayli yo'q yoki o'qilmadi. Bu AI xatosi emas — fayl masalasi. */
export class AgentError extends Error {
  constructor(file, reason) {
    super(`${file}: ${reason}`);
    this.name = "AgentError";
    this.file = file;
    this.reason = reason;
  }
}

/** Fayl nomi -> { mtimeMs, text }. Modul yashagancha xotirada turadi. */
const cache = new Map();

let lastRoot = "";

/**
 * Xarakter faylini o'qiydi.
 *
 * `bilim.js` dagi kabi `mtime` kuzatiladi: faylni tahrirlash uchun botni qayta ishga
 * tushirish shart emas, keyingi `/post` yangi matn bilan ishlaydi.
 */
export function roleText(name) {
  const root = path.resolve(config.agentlar.dir);

  // Papka yo'lini almashtirsak (sinovda shunday bo'ladi) eski kesh yaramaydi.
  if (root !== lastRoot) {
    cache.clear();
    lastRoot = root;
  }

  const file = `${name}.md`;
  const abs = path.join(root, file);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new AgentError(file, "topilmadi");
  }
  if (!stat.isFile()) throw new AgentError(file, "fayl emas");
  if (stat.size > MAX_FILE_BYTES) throw new AgentError(file, "juda katta");

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.text;

  let text;
  try {
    text = fs.readFileSync(abs, "utf8").trim();
  } catch {
    throw new AgentError(file, "o'qilmadi");
  }
  if (!text) throw new AgentError(file, "bo'sh");

  cache.set(file, { mtimeMs: stat.mtimeMs, text });
  return text;
}

/** Ikkala xarakter fayli ham joyidami — start logi va /help uchun. */
export function ready() {
  try {
    for (const role of ROLES) roleText(role);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------
// Muharrir javobini o'qish
// ---------------------------------------------------------------

// Muharrir javob tilini foydalanuvchidan oladi, lekin birinchi qator har doim shu
// ikki o'zbekcha so'zdan biri bo'lishi kerak (`ai.js` shunday talab qiladi).
// Baribir boshqa tilda yozib yuborsa ushlab qolamiz — bitta so'z uchun butun
// oqimni qurbon qilmaymiz.
const PASS_WORDS = ["otdi", "passed", "pass", "approved", "ok", "прошло", "принято"];
const FAIL_WORDS = ["qaytayoz", "qayta", "rewrite", "redo", "переписать", "перепиш"];

/** Apostrof olib tashlanadi: `o'tdi`, `oʻtdi`, `otdi` — bir xil so'z (bilim.js kabi). */
function normalize(line) {
  return line
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Sabab qatoridan bezaklarni olib tashlaydi: "• Sabab: ..." -> "..." */
function cleanReason(line) {
  return line
    .replace(/^[•\-*–—\s]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(sabab|причина|reason)\s*[:—-]\s*/i, "")
    .trim();
}

/**
 * Muharrir matnini qarorga aylantiradi.
 *
 * Uchinchi holat — `unclear`: format buzilgan. Unda oqim to'xtaydi va post
 * shundayligicha ko'rsatiladi. Tushunarsiz javob uchun pul sarflab qayta urinish
 * ham, foydalanuvchini javobsiz qoldirish ham yomonroq bo'lardi.
 *
 * @returns {{ verdict: "pass"|"fail"|"unclear", reasons: string[] }}
 */
export function parseVerdict(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const first = normalize(lines[0] ?? "");
  const reasons = lines.slice(1).map(cleanReason).filter(Boolean).slice(0, 3);

  if (PASS_WORDS.some((word) => first.startsWith(word))) return { verdict: "pass", reasons: [] };
  if (FAIL_WORDS.some((word) => first.startsWith(word))) return { verdict: "fail", reasons };
  return { verdict: "unclear", reasons: [] };
}

// ---------------------------------------------------------------
// Oqim
// ---------------------------------------------------------------

// Bosqichlarning matni ingliz tilida: javob tili tizim ko'rsatmasidan keladi, bu yerdagi
// o'zbekcha yorliqlar modelni ru/en foydalanuvchi uchun ham o'zbekchaga tortib ketardi.

function writerPrompt(topic, material) {
  return [`Topic: ${topic}`, "", "Material gathered for you:", material].join("\n");
}

function editorPrompt(topic, material, post) {
  return [
    `Topic: ${topic}`,
    "",
    "Material the writer was given:",
    material,
    "",
    "--- The post to check ---",
    post,
    "--- end of post ---",
  ].join("\n");
}

function rewritePrompt(reasons) {
  const list = reasons.length > 0
    ? reasons.map((reason) => `• ${reason}`).join("\n")
    : "• (the editor gave no reason)";

  return [
    "The editor sent the post back. Reasons:",
    list,
    "",
    "Fix exactly these points and write the whole post again. Output only the post itself.",
  ].join("\n");
}

/** Bir necha chaqiruvning token hisobini bitta obyektga yig'adi. */
function addUsage(total, usage) {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
  }
}

/**
 * Mavzu bo'yicha post yozadi.
 *
 * Yozuvchiga qidiruv natijalarining o'zi emas, material bosqichining **matni**
 * uzatiladi. Aks holda har bir qayta yozish o'n minglab tokenga aylanardi —
 * bu `store.js` dagi "qidiruv natijalari tarixga yozilmaydi" qarori bilan bir xil sabab.
 *
 * @param {object}   params
 * @param {string}   params.topic
 * @param {string}   params.lang
 * @param {string}   params.userName
 * @param {(stage: object) => void|Promise<void>} [params.onStage] bosqich xabarlari
 */
export async function yozPost({ topic, lang, userName, onStage = () => {} }) {
  // Ikkala fayl ham boshida o'qiladi: material yig'ib bo'lgandan keyin "muharrir fayli
  // yo'q ekan" deb to'xtash — bekorga sarflangan pul.
  const writer = roleText("yozuvchi");
  const editor = roleText("muharrir");

  const usage = { input_tokens: 0, output_tokens: 0 };
  const maxRewrites = config.agentlar.maxRewrites;

  // 1-bosqich: material. Bu hozirgi `/post` ning o'zi — vositalar shu yerda ishlaydi.
  const material = await ai.ask({
    history: [{ role: "user", content: topic }],
    lang,
    userName,
    mode: "post",
  });
  addUsage(usage, material.usage);
  await onStage({ type: "material", answer: material });

  const rounds = [];
  let history = [{ role: "user", content: writerPrompt(topic, material.text) }];
  let post = "";
  let truncated = false;
  // Kover bir marta yasaladi va qayta yozishda saqlanib qoladi: mavzu o'zgarmagan,
  // har qayta yozishda yangi rasm esa narxni ikki-uch barobar oshirardi.
  let kover = null;

  for (let round = 0; ; round += 1) {
    // 2-bosqich: yozuvchi. Qayta yozishda tarixda oldingi varianti va sabab turadi —
    // shuning uchun u nimani tuzatayotganini ko'radi.
    const written = await ai.ask({
      history,
      lang,
      userName,
      mode: "yozuvchi",
      roleText: writer,
      koverDone: Boolean(kover),
    });
    addUsage(usage, written.usage);
    post = written.text;
    truncated = written.truncated;
    await onStage({ type: "yozuvchi", round, maxRewrites });

    if (!kover && written.kover) {
      kover = written.kover;
      await onStage({ type: "kover", usul: kover.usul, sabab: kover.sabab });
    }

    // 3-bosqich: muharrir. Tarixsiz — u faqat mavzu, material va postni ko'radi,
    // yozuvchi bilan bahslashmaydi.
    const checked = await ai.ask({
      history: [{ role: "user", content: editorPrompt(topic, material.text, post) }],
      lang,
      userName,
      mode: "muharrir",
      roleText: editor,
    });
    addUsage(usage, checked.usage);

    const { verdict, reasons } = parseVerdict(checked.text);
    rounds.push({ verdict, reasons });
    await onStage({ type: "muharrir", verdict, reasons, round, maxRewrites });

    // "unclear" ham to'xtatadi: formatni tushunmadik, lekin post tayyor turibdi.
    if (verdict !== "fail") break;
    if (round >= maxRewrites) break;

    history = [
      ...history,
      { role: "assistant", content: post },
      { role: "user", content: rewritePrompt(reasons) },
    ];
  }

  const last = rounds.at(-1);
  return {
    post,
    truncated,
    kover,
    material,
    verdict: last.verdict,
    reasons: last.reasons,
    rewrites: rounds.length - 1,
    maxRewrites,
    usage,
  };
}
