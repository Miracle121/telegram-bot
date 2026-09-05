// Webhook boshqaruvi uchun kichik CLI.
//
//   npm run webhook:set      — webhookni o'rnatadi (PUBLIC_URL kerak)
//   npm run webhook:info     — hozirgi holatni ko'rsatadi
//   npm run webhook:delete   — webhookni o'chiradi

import process from "node:process";
import { config } from "../config.js";
import * as tg from "../telegram.js";

const command = process.argv[2];

const commands = {
  async set() {
    if (!config.webhookUrl) {
      console.error("PUBLIC_URL .env faylida ko'rsatilmagan — webhookni o'rnatib bo'lmaydi.");
      process.exit(1);
    }
    await tg.setWebhook(config.webhookUrl, config.webhookSecret);
    console.log(`Webhook o'rnatildi: ${config.publicUrl}/webhook/***`);
  },

  async info() {
    const info = await tg.getWebhookInfo();
    const me = await tg.getMe();

    console.log(`Bot:                   @${me.username}`);
    console.log(`URL:                   ${info.url || "(o'rnatilmagan)"}`);
    console.log(`Maxfiy token:          ${info.has_custom_certificate ? "sertifikat" : "header orqali"}`);
    console.log(`Kutayotgan update:     ${info.pending_update_count}`);
    console.log(`Ruxsat etilgan turlar: ${(info.allowed_updates ?? []).join(", ") || "(barchasi)"}`);

    if (info.last_error_message) {
      const when = new Date(info.last_error_date * 1000).toISOString();
      console.log(`\nOxirgi xato (${when}):\n  ${info.last_error_message}`);
    } else {
      console.log("\nXatolar yo'q.");
    }
  },

  async delete() {
    await tg.deleteWebhook(false);
    console.log("Webhook o'chirildi.");
  },
};

if (!command || !Object.hasOwn(commands, command)) {
  console.error("Foydalanish: node scripts/webhook.js <set|info|delete>");
  process.exit(1);
}

try {
  await commands[command]();
} catch (error) {
  console.error(`Xato: ${error.message}`);
  process.exit(1);
}
