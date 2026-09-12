// Bilim bazasi — `bilim/` papkasidagi matn fayllarini o'qiydi va ular ichidan qidiradi.
//
// Bu modul AI haqida hech narsa bilmaydi: kiruvchisi — so'z, chiquvchisi — mos kelgan
// parchalar. Vosita sifatida e'lon qilish va natijani modelga qaytarish `ai.js` ishi.
//
// Tashqi paket ishlatilmaydi: baza kichik (o'nlab fayl), shuning uchun oddiy so'z
// hisoblash yetarli. Indeks kutubxonasi bu hajmda ortiqcha bog'liqlik bo'lardi.

import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";

const EXTENSIONS = new Set([".md", ".txt"]);

// README bazaning o'zi haqida — format qo'llanmasi. Uni indekslasak, "format" yoki
// "fayl" so'ralganda mazmun o'rniga qo'llanma chiqadi.
const SKIP_FILES = new Set(["readme.md", "readme.txt"]);

const MAX_DEPTH = 3; // bilim/a/b/c.md gacha
const MAX_FILE_BYTES = 512 * 1024; // tasodifan qo'yilgan katta faylni o'qib o'tirmaymiz
const MAX_CHUNK_CHARS = 800; // bitta parcha — modelga tushadigan o'lcham
const MAX_TOTAL_CHARS = 4000; // bitta javobdagi hamma parchalar yig'indisi (token = pul)

// So'rov so'zi parcha so'ziga prefiks bo'lib tushishi mumkin: "narx" -> "narxlari".
// Lekin qisqa bo'laklar hamma narsaga tushib ketadi, shuning uchun eng kam uzunlik.
const MIN_PREFIX = 3;
const MIN_WORD = 3; // undan qisqa so'rov so'zlari e'tiborga olinmaydi

const TITLE_WEIGHT = 3; // sarlavhadagi moslik gavdadagidan uch barobar og'ir

// Ma'no tashimaydigan, lekin deyarli har parchada uchraydigan so'zlar. Ular ballga
// qo'shilsa, qidiruv natijasi tasodifiy bo'lib qoladi.
const STOP_WORDS = new Set([
  // o'zbekcha
  "uchun", "bilan", "yoki", "ham", "lekin", "agar", "bo'lsa", "bolsa", "kerak",
  "qanday", "qancha", "nima", "qaysi", "menga", "sizga", "bizning", "sizning",
  // ruscha
  "для", "или", "это", "как", "что", "если", "нужно", "есть", "быть", "который",
  // inglizcha
  "the", "and", "for", "with", "what", "how", "much", "many", "does", "are", "you",
]);

/** Fayl yo'li -> { mtimeMs, chunks }. Modul yashagancha xotirada turadi. */
const index = new Map();

let lastRoot = "";

/**
 * Papkani ko'zdan kechiradi va o'zgargan fayllarni qayta o'qiydi.
 * Har qidiruvda chaqiriladi: fayl kam, `stat` esa arzon. Shu tufayli bazaga fayl
 * qo'shish yoki tahrirlash uchun botni qayta ishga tushirish shart emas.
 */
function refresh() {
  const root = path.resolve(config.bilim.dir);

  // Papka yo'lini almashtirsak (sinovda shunday bo'ladi) eski indeks yaramaydi.
  if (root !== lastRoot) {
    index.clear();
    lastRoot = root;
  }

  const found = new Set();

  for (const file of walk(root, root, 0)) {
    found.add(file.rel);
    const cached = index.get(file.rel);
    if (cached && cached.mtimeMs === file.mtimeMs) continue;

    try {
      const text = fs.readFileSync(file.abs, "utf8");
      index.set(file.rel, { mtimeMs: file.mtimeMs, chunks: split(text, file.rel) });
    } catch {
      // Fayl o'qilmadi (o'chirib yuborilgan, huquq yo'q) — qolganlari bilan davom etamiz.
      index.delete(file.rel);
    }
  }

  // O'chirilgan fayllar indeksda qolib ketmasin.
  for (const rel of index.keys()) {
    if (!found.has(rel)) index.delete(rel);
  }
}

/** Papkani rekursiv aylanib, mos fayllar ro'yxatini qaytaradi. */
function walk(dir, root, depth) {
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Papka yo'q — bu xato emas: baza hali to'ldirilmagan bo'lishi mumkin.
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(abs, root, depth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (SKIP_FILES.has(entry.name.toLowerCase())) continue;

    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_BYTES) continue;
      files.push({ abs, rel: path.relative(root, abs).replaceAll("\\", "/"), mtimeMs: stat.mtimeMs });
    } catch {
      // fayl shu orada o'chirilgan
    }
  }
  return files;
}

/**
 * Faylni parchalarga bo'ladi.
 *
 * Modelga butun fayl emas, faqat mos kelgan parcha beriladi — shuning uchun har parcha
 * o'zicha tushunarli bo'lishi kerak. Sarlavha parcha bilan birga saqlanadi.
 */
function split(text, file) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let title = file;
  let body = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (content) sections.push({ title, text: content });
    body = [];
  };

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      title = heading[1];
      continue;
    }
    body.push(line);
  }
  flush();

  // Sarlavhasiz fayl bitta katta bo'lak bo'lib qolmasin.
  const chunks = [];
  for (const section of sections) {
    for (const piece of cut(section.text)) {
      chunks.push({ file, title: section.title, text: piece, words: countWords(piece) });
    }
  }
  return chunks;
}

/** Uzun matnni chegaradan oshmaydigan bo'laklarga bo'ladi — bo'sh qator chegara bo'ladi. */
function cut(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const pieces = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (current && (current.length + paragraph.length + 2) > MAX_CHUNK_CHARS) {
      pieces.push(current);
      current = "";
    }
    // Bitta abzatsning o'zi chegaradan katta bo'lsa, qattiq kesamiz.
    if (paragraph.length > MAX_CHUNK_CHARS) {
      if (current) { pieces.push(current); current = ""; }
      for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
        pieces.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Matnni qidiruv uchun soddalashtiradi.
 *
 * Apostrof butunlay olib tashlanadi: foydalanuvchi "o'zgarish", "oʻzgarish" yoki
 * "ozgarish" deb yozishi mumkin — uchalasi bir xil so'zga aylanishi kerak.
 */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function toWords(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

/** Parchadagi har so'z necha marta uchraganini sanaydi — qidiruvda shu ishlatiladi. */
function countWords(text) {
  const counts = new Map();
  for (const word of toWords(text)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/** So'rov so'zi parcha so'ziga to'g'ri keladimi (o'zbek qo'shimchalari hisobga olinadi). */
function matches(word, query) {
  if (word === query) return true;
  if (Math.min(word.length, query.length) < MIN_PREFIX) return false;
  return word.startsWith(query) || query.startsWith(word);
}

/**
 * Bazadan qidiradi.
 *
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {{ hits: Array<{ file: string, title: string, text: string }>, empty: boolean }}
 */
export function search(query, { limit = config.bilim.maxResults } = {}) {
  refresh();

  const terms = [...new Set(toWords(query))].filter(
    (word) => word.length >= MIN_WORD && !STOP_WORDS.has(word),
  );
  if (terms.length === 0) return { hits: [], empty: true };

  const scored = [];
  for (const entry of index.values()) {
    for (const chunk of entry.chunks) {
      const titleWords = countWords(`${chunk.title} ${chunk.file}`);

      let score = 0;
      let matched = 0;
      for (const term of terms) {
        let hits = 0;
        for (const [word, count] of chunk.words) {
          if (matches(word, term)) hits += count;
        }
        let titleHits = 0;
        for (const [word, count] of titleWords) {
          if (matches(word, term)) titleHits += count;
        }
        if (hits + titleHits === 0) continue;

        matched += 1;
        // Bir so'zning ko'p takrorlanishi parchani sun'iy ravishda ko'tarmasin.
        score += Math.min(hits, 5) + titleHits * TITLE_WEIGHT;
      }

      // Qamrov bonusi: so'rovning ko'proq so'zini qamragan parcha oldinga chiqadi.
      if (matched > 0) scored.push({ chunk, score: score * (1 + matched) });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const hits = [];
  let total = 0;
  for (const { chunk } of scored.slice(0, limit)) {
    if (total + chunk.text.length > MAX_TOTAL_CHARS && hits.length > 0) break;
    hits.push({ file: chunk.file, title: chunk.title, text: chunk.text });
    total += chunk.text.length;
  }

  return { hits, empty: hits.length === 0 };
}

/** Modelga beriladigan matn. Har parcha qaysi fayldan kelgani ko'rinib turadi. */
export function format({ hits }) {
  if (hits.length === 0) {
    return "Bilim bazasida bu mavzu bo'yicha hech narsa topilmadi.";
  }
  return hits
    .map((hit) => `--- ${hit.file} · ${hit.title} ---\n${hit.text}`)
    .join("\n\n");
}

/** Baza hajmi — start logi va vositani e'lon qilish qarori uchun. */
export function stats() {
  refresh();
  let chunks = 0;
  for (const entry of index.values()) chunks += entry.chunks.length;
  return { files: index.size, chunks };
}
