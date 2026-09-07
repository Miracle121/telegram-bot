// Foydalanuvchi holati: til (diskda) va suhbat tarixi (faqat xotirada).
//
// Til — oddiy JSON fayl, restartdan keyin ham saqlanib qoladi.
// Suhbat tarixi ataylab diskka yozilmaydi: unda foydalanuvchining shaxsiy yozishmalari
// bo'ladi, restartdan keyin esa toza suhbat boshlangani ma'qul. Kerak bo'lsa shu faylda
// bitta joyni o'zgartirish yetadi — interfeys tashqaridan bir xil ko'rinadi.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(import.meta.dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");
const SAVE_DELAY_MS = 1000;

/** @type {Map<string, { language: string, updatedAt: string }>} */
const users = new Map();
let saveTimer = null;
let dirty = false;

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    for (const [id, value] of Object.entries(JSON.parse(raw))) {
      users.set(id, value);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Saqlangan ma'lumotni o'qib bo'lmadi, bo'sh holatdan boshlanadi:", error.message);
    }
  }
}

function writeToDisk() {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(Object.fromEntries(users), null, 2), "utf8");
  fs.renameSync(tempFile, DATA_FILE); // atomik almashtirish — yarim yozilgan fayl qolmaydi
  dirty = false;
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeToDisk();
    } catch (error) {
      console.error("Ma'lumotni saqlab bo'lmadi:", error.message);
    }
  }, SAVE_DELAY_MS);
  saveTimer.unref(); // bu taymer jarayonni ushlab turmasin
}

load();

export function getLanguage(userId) {
  return users.get(String(userId))?.language ?? null;
}

export function setLanguage(userId, language) {
  users.set(String(userId), { language, updatedAt: new Date().toISOString() });
  scheduleSave();
}

// ---------------------------------------------------------------
// Suhbat tarixi — AI kontekstni eslab qolishi uchun
//
// Ikkita chegara bor: uzunlik (uzun tarix qimmat va sekin) va vaqt (ertalabki suhbat
// kechqurungi savolga aralashmasligi kerak).
// ---------------------------------------------------------------

const HISTORY_MAX_MESSAGES = 20; // ~10 ta savol-javob
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000; // 2 soat jimlikdan keyin tarix unutiladi

/** @type {Map<string, { messages: Array<{role: string, content: string}>, updatedAt: number }>} */
const histories = new Map();

function activeHistory(key) {
  const entry = histories.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > HISTORY_TTL_MS) {
    histories.delete(key);
    return null;
  }
  return entry;
}

/** Foydalanuvchining hozirgi suhbatini qaytaradi (eskirgan bo'lsa — bo'sh ro'yxat). */
export function getHistory(userId) {
  return activeHistory(String(userId))?.messages ?? [];
}

/** Suhbatga bitta xabar qo'shadi va eng eskilarini chegaradan chiqarib tashlaydi. */
export function appendToHistory(userId, role, content) {
  const key = String(userId);
  const entry = activeHistory(key) ?? { messages: [], updatedAt: Date.now() };

  entry.messages.push({ role, content });
  if (entry.messages.length > HISTORY_MAX_MESSAGES) {
    entry.messages.splice(0, entry.messages.length - HISTORY_MAX_MESSAGES);
  }
  entry.updatedAt = Date.now();
  histories.set(key, entry);
}

/** Suhbatni noldan boshlaydi (/new buyrug'i). */
export function clearHistory(userId) {
  histories.delete(String(userId));
}

/** Jarayon yopilishidan oldin kutilayotgan yozuvni diskka tushiradi. */
export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty) return;
  try {
    writeToDisk();
  } catch (error) {
    console.error("Yopilish oldidan saqlab bo'lmadi:", error.message);
  }
}
