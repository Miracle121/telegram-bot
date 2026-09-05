// Foydalanuvchi sozlamalarini (hozircha faqat til) saqlash.
// Oddiy JSON fayl — restartdan keyin ham saqlanib qoladi.
// Keyinchalik baza kerak bo'lsa, faqat shu fayl almashtiriladi: interfeys o'zgarmaydi.

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
