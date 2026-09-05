// WEBHOOK_SECRET uchun tasodifiy qiymat generatsiya qiladi.
//   npm run secret

import crypto from "node:crypto";

console.log(crypto.randomBytes(32).toString("hex"));
