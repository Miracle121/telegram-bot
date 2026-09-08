// AI to'g'ri sozlanganini tekshirish:  npm run ai:test "savolingiz"
//
// Telegram'ga umuman tegmaydi — faqat .env dagi ANTHROPIC_API_KEY bilan bitta so'rov
// yuboradi. Kalit ishlayaptimi, model javob beryaptimi — shuni bilish uchun.

import process from "node:process";

import { config } from "../config.js";
import * as ai from "../ai.js";

if (!ai.enabled) {
  console.error("\nANTHROPIC_API_KEY ko'rsatilmagan (.env fayliga qo'ying).\n");
  process.exit(1);
}

const question = process.argv.slice(2).join(" ") || "Bir jumlada o'zingni tanishtir.";
const lang = process.env.AI_TEST_LANG ?? "uz";

console.log(`\nModel:  ${config.ai.model}  (effort: ${config.ai.effort})`);
console.log(`Savol:  ${question}\n`);

const startedAt = Date.now();

try {
  const answer = await ai.ask({
    history: [{ role: "user", content: question }],
    lang,
    userName: "Sinov",
  });

  console.log(answer.text);
  console.log(
    `\n---\n${Math.round((Date.now() - startedAt) / 1000)} s · ` +
      `kirish ${answer.usage.input_tokens ?? "?"} · chiqish ${answer.usage.output_tokens ?? "?"} token · ` +
      `qidiruv ${answer.searches}${answer.searchErrors.length > 0 ? ` (xato: ${answer.searchErrors.join(", ")})` : ""}\n` +
      `kesh: yozildi ${answer.usage.cache_creation_input_tokens ?? 0} · ` +
      `o'qildi ${answer.usage.cache_read_input_tokens ?? 0} token\n`,
  );
} catch (error) {
  console.error(`\nXato (${error.code ?? "unknown"}): ${error.message}\n`);
  process.exit(1);
}
