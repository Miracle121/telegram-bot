// Kanallar — qaysi foydalanuvchi qaysi kanalga post chiqara oladi.
//
// Kanal `.env` da yozilmaydi. Botni kanalga admin qilib qo'shganda Telegram
// `my_chat_member` update'ini yuboradi: unda kanal ham, botni kim qo'shgani ham bor.
// Botni kanalga faqat o'sha kanalning admini qo'sha oladi — shuning uchun "kim qo'shgan
// bo'lsa, o'shaniki" qoidasi o'z-o'zidan himoya: begona odam sizning kanalingizga
// post chiqara olmaydi.
//
// Bitta foydalanuvchi — bitta kanal. Ikkinchisini qo'shsa, u birinchisining o'rnini oladi.
//
// Diskda turadi (`data/kanallar.json`): bog'lanish kamdan-kam o'zgaradi va restartdan
// keyin yo'qolsa, egasi botni kanalga qaytadan qo'shishi kerak bo'lardi.

import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";

const DATA_DIR = process.env.DATA_DIR ?? path.join(import.meta.dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "kanallar.json");

/** @type {Map<string, { id: number, title: string, username: string, addedAt: string }>} */
const kanallar = new Map();

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    for (const [userId, value] of Object.entries(JSON.parse(raw))) {
      kanallar.set(userId, value);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Kanallar faylini o'qib bo'lmadi, bo'sh holatdan boshlanadi:", error.message);
    }
  }
}

// Debounce yo'q: yozuv faqat bot kanalga qo'shilganda yoki chiqarilganda bo'ladi.
function save() {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(Object.fromEntries(kanallar), null, 2), "utf8");
  fs.renameSync(tempFile, DATA_FILE); // atomik almashtirish — yarim yozilgan fayl qolmaydi
}

load();

/** Shu foydalanuvchi kanal ulay oladimi. ADMIN_IDS bo'sh bo'lsa — hamma. */
export function ruxsat(userId) {
  const admins = config.kanal.adminIds;
  return admins.length === 0 || admins.includes(Number(userId));
}

/** Foydalanuvchining kanali (yoki null). Ruxsat olib qo'yilgan bo'lsa ham null. */
export function ol(userId) {
  if (!ruxsat(userId)) return null;
  return kanallar.get(String(userId)) ?? null;
}

/** Kanalni foydalanuvchiga bog'laydi. */
export function ula(userId, chat) {
  kanallar.set(String(userId), {
    id: chat.id,
    title: chat.title ?? "",
    username: chat.username ?? "",
    addedAt: new Date().toISOString(),
  });
  save();
}

/**
 * Kanalni kimga bog'langan bo'lsa, hammasidan uzadi.
 * Bot kanaldan chiqarilganda yoki huquqi olinganda chaqiriladi.
 * @returns {string[]} uzilgan foydalanuvchilar ID'si
 */
export function uz(chatId) {
  const uzildi = [];
  for (const [userId, kanal] of kanallar) {
    if (kanal.id === chatId) {
      kanallar.delete(userId);
      uzildi.push(userId);
    }
  }
  if (uzildi.length > 0) save();
  return uzildi;
}

/** Nechta kanal ulangan — start logi uchun. */
export function soni() {
  return kanallar.size;
}

/**
 * Kanaldagi postga havola.
 * Ochiq kanal: t.me/nomi/123. Yopiq kanal: t.me/c/<ID dan -100 olib tashlangan>/123 —
 * bu havola faqat kanal a'zolariga ochiladi, lekin egasi uchun shu yetarli.
 */
export function havola(kanal, messageId) {
  if (!messageId) return "";
  if (kanal.username) return `https://t.me/${kanal.username}/${messageId}`;
  const id = String(kanal.id);
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${messageId}` : "";
}
