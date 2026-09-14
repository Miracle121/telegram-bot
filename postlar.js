// Kutib turgan postlar — foydalanuvchi "chop etish / qayta yozish / bekor qilish"
// tugmalaridan birini bosguncha shu yerda turadi.
//
// Tugmaning `callback_data` si 64 baytdan oshmaydi, postning o'zi esa 1-2 ming belgi.
// Shuning uchun tugmaga faqat qisqa ID yoziladi, qolgani shu xaritada.
//
// Faqat xotirada: restart yoki deploy'dan keyin eski tugmalar "eskirgan" deb javob
// beradi. Buning evaziga fayl yozish ham, tozalash ham kerak emas.

import crypto from "node:crypto";

// Bir kundan keyin post baribir dolzarbligini yo'qotadi.
const TTL_MS = 24 * 60 * 60 * 1000;

// Bitta foydalanuvchi o'nlab /post qilib, hech birini bosmasa xotira o'smasin.
const MAX_PER_USER = 5;

/**
 * @typedef {object} Post
 * @property {number} userId
 * @property {number} chatId
 * @property {string} lang
 * @property {string} userName
 * @property {string} topic
 * @property {string} material   material bosqichining matni — qayta yozishda kerak
 * @property {string} post
 * @property {string} photoFileId Telegram'dagi kover (qayta yuklamaslik uchun)
 * @property {Buffer|null} photoBuffer file_id olinmagan bo'lsa — rasmning o'zi
 * @property {number} messageId  tugmalar turgan xabar
 * @property {number} rewrites   foydalanuvchi so'rovi bilan necha marta qayta yozildi
 * @property {"kutmoqda"|"chiqarilmoqda"|"yozilmoqda"} holat
 * @property {number} createdAt
 */

/** @type {Map<string, Post>} */
const postlar = new Map();

function tozala() {
  const now = Date.now();
  for (const [id, post] of postlar) {
    if (now - post.createdAt > TTL_MS) postlar.delete(id);
  }
}

/** Postni saqlaydi va tugmalar uchun qisqa ID qaytaradi. */
export function saqla(post) {
  tozala();

  // Map qo'shilish tartibini saqlaydi — birinchi uchragani eng eskisi.
  const mine = [...postlar].filter(([, item]) => item.userId === post.userId);
  for (const [id] of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) {
    postlar.delete(id);
  }

  const id = crypto.randomBytes(6).toString("base64url"); // 8 belgi
  postlar.set(id, { ...post, holat: "kutmoqda", rewrites: post.rewrites ?? 0, createdAt: Date.now() });
  return id;
}

/** Postni oladi; yo'q yoki eskirgan bo'lsa — null. */
export function ol(id) {
  const post = postlar.get(id);
  if (!post) return null;
  if (Date.now() - post.createdAt > TTL_MS) {
    postlar.delete(id);
    return null;
  }
  return post;
}

export function ochir(id) {
  postlar.delete(id);
}
