// Uchdan-uchgacha sinov:  npm test
//
// Soxta Telegram API ko'tariladi, bot shunga qaratib ishga tushiriladi, so'ng unga
// haqiqiy webhook so'rovlari yuboriladi va javoblari tekshiriladi.
// Haqiqiy token ham, internet ham kerak emas.

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API_PORT = 8791;
const AI_PORT = 8792;
const BOT_PORT = 3991;
const SECRET = "test_secret_0123456789abcdef";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bot-smoke-"));

const sent = []; // sendMessage / answerCallbackQuery chaqiruvlari

const api = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const method = req.url.split("/").pop();
    const payload = body ? JSON.parse(body) : {};
    sent.push({ method, payload });

    const results = {
      getMe: { id: 1, is_bot: true, username: "smoke_test_bot" },
      sendMessage: { message_id: sent.length },
      answerCallbackQuery: true,
      editMessageReplyMarkup: true,
      sendChatAction: true,
      setWebhook: true,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: results[method] ?? true }));
  });
});

await new Promise((r) => api.listen(API_PORT, r));

// Soxta Claude API. `aiResponse` ni o'zgartirib turli holatlarni sinaymiz.
const aiRequests = [];
let aiResponse = { status: 200, text: "Bugungi reja tayyor." };

const aiApi = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    aiRequests.push(body ? JSON.parse(body) : {});

    if (aiResponse.status !== 200) {
      res.writeHead(aiResponse.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "soxta xato" } }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: aiResponse.text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
  });
});

await new Promise((r) => aiApi.listen(AI_PORT, r));

const PROJECT_ROOT = path.join(import.meta.dirname, "..");

const bot = spawn(process.execPath, ["bot.js"], {
  cwd: PROJECT_ROOT,
  env: {
    ...process.env,
    TELEGRAM_BOT_TOKEN: "123456789:AAFakeTokenForLocalSmokeTest_abcdefg",
    WEBHOOK_SECRET: SECRET,
    PUBLIC_URL: "",
    PORT: String(BOT_PORT),
    TELEGRAM_API_BASE: `http://127.0.0.1:${API_PORT}`,
    DATA_DIR,
    ANTHROPIC_API_KEY: "sk-ant-smoke-test-0123456789",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`,
    AI_EFFORT: "low",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const botLog = [];
bot.stdout.on("data", (d) => botLog.push(d.toString()));
bot.stderr.on("data", (d) => botLog.push(d.toString()));

// Server ko'tarilishini kutamiz
await waitFor(async () => (await fetch(`http://127.0.0.1:${BOT_PORT}/health`)).ok);

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  OK    ${name}`);
  } else {
    failures += 1;
    console.log(`  XATO  ${name} ${detail}`);
  }
}

async function post(update, secret = SECRET) {
  const res = await fetch(`http://127.0.0.1:${BOT_PORT}/webhook/${SECRET}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: JSON.stringify(update),
  });
  await sleep(250); // fon rejimidagi ishlov tugashini kutamiz
  return res;
}

const message = (id, text) => ({
  update_id: id,
  message: {
    message_id: id,
    from: { id: 555, first_name: "Ali", language_code: "uz" },
    chat: { id: 555, type: "private" },
    text,
  },
});

/** AI so'raladigan xabar yuboradi va javob kelguncha kutadi. */
async function postAi(update) {
  sent.length = 0;
  aiRequests.length = 0;
  await post(update);
  await waitFor(() => sent.some((c) => c.method === "sendMessage"));
}

const lastText = () => [...sent].reverse().find((c) => c.method === "sendMessage")?.payload.text ?? "";

console.log("\nSinov natijalari:\n");

// 1. Health
const health = await (await fetch(`http://127.0.0.1:${BOT_PORT}/health`)).json();
check("/health javob beradi", health.status === "ok");

// 2. Noto'g'ri maxfiy kalit rad etiladi
const bad = await post(message(1, "/start"), "wrong-secret");
check("noto'g'ri secret -> 401", bad.status === 401, `(kelgani: ${bad.status})`);

// 3. Yangi foydalanuvchi -> til tanlash
sent.length = 0;
await post(message(2, "/start"));
check("yangi foydalanuvchiga til so'raladi", lastText().includes("Tilni tanlang"));
const keyboard = sent.find((c) => c.method === "sendMessage")?.payload.reply_markup;
check("3 tilli klaviatura yuborildi", keyboard?.inline_keyboard?.length === 3);

// 4. Ingliz tilini tanlash
sent.length = 0;
await post({
  update_id: 3,
  callback_query: {
    id: "cb1",
    from: { id: 555, first_name: "Ali", language_code: "uz" },
    data: "lang:en",
    message: { message_id: 2, chat: { id: 555, type: "private" } },
  },
});
check("callback javob oldi", sent.some((c) => c.method === "answerCallbackQuery"));
check("tugmalar olib tashlandi", sent.some((c) => c.method === "editMessageReplyMarkup"));
check("salomlashuv inglizcha", lastText().includes("Hello") && lastText().includes("Ali"));

// 5. AI javob beradi
await postAi(message(4, "ertangi kunimni rejalashtir"));
check("ai javobi yuborildi", lastText().includes("Bugungi reja tayyor"));
check("\"yozmoqda\" belgisi ko'rsatildi", sent.some((c) => c.method === "sendChatAction"));
check("so'rov tanlangan tilda so'raldi", (aiRequests[0]?.system ?? "").includes("English"));
check("savol modelga yetib bordi", aiRequests[0]?.messages?.at(-1)?.content === "ertangi kunimni rejalashtir");
check(
  "xarakter ko'rsatmasi yuborildi",
  (aiRequests[0]?.system ?? "").includes("Tone and character:") &&
    (aiRequests[0]?.system ?? "").includes("Never belittle the person asking"),
);

// 6. Suhbat tarixi eslab qolinadi
await postAi(message(5, "endi qisqartir"));
check("tarix modelga uzatildi", aiRequests[0]?.messages?.length === 3, `(${aiRequests[0]?.messages?.length} ta xabar)`);

// 6a. /new tarixni tozalaydi
sent.length = 0;
await post(message(51, "/new"));
check("/new tarixni tozaladi", lastText().includes("Conversation cleared"));

await postAi(message(52, "yana savol"));
check("tozalashdan keyin tarix bo'sh", aiRequests[0]?.messages?.length === 1, `(${aiRequests[0]?.messages?.length} ta xabar)`);

// 6b. Uzun javob bo'laklarga bo'linadi (Telegram chegarasi — 4096 belgi)
aiResponse = { status: 200, text: "salom.\n\n".repeat(700) };
await postAi(message(53, "uzun javob ber"));
const chunks = sent.filter((c) => c.method === "sendMessage");
check("uzun javob bo'lindi", chunks.length > 1, `(${chunks.length} ta xabar)`);
check("har bir bo'lak chegaradan oshmadi", chunks.every((c) => c.payload.text.length <= 4096));

// 6c. AI xatosi tushunarli javobga aylanadi
aiResponse = { status: 401, text: "" };
await postAi(message(54, "xato chiqsin"));
check("ai xatosi tushuntirildi", lastText().includes("AI key isn't working"));
aiResponse = { status: 200, text: "Bugungi reja tayyor." };

// 7. /help tanlangan tilda
sent.length = 0;
await post(message(6, "/help"));
check("/help inglizcha", lastText().includes("Help"));

// 8. Noma'lum buyruq
sent.length = 0;
await post(message(7, "/nomalum"));
check("noma'lum buyruq ushlandi", lastText().includes("Unknown command"));

// 9. Matnsiz xabar
sent.length = 0;
await post({
  update_id: 8,
  message: {
    message_id: 8,
    from: { id: 555, first_name: "Ali" },
    chat: { id: 555, type: "private" },
    sticker: { file_id: "x" },
  },
});
check("stikerga to'g'ri javob", lastText().includes("only understand text"));

// 10. Takrorlangan update tashlab yuboriladi
sent.length = 0;
await post(message(4, "ertangi kunimni rejalashtir")); // update_id 4 allaqachon ishlangan
check("takroriy update e'tiborsiz qoldirildi", sent.length === 0, `(${sent.length} ta chaqiruv)`);

// 11. Til diskda saqlandi
const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"));
check("til faylga yozildi", saved["555"]?.language === "en");

// 12. Noma'lum yo'l -> 404
const notFound = await fetch(`http://127.0.0.1:${BOT_PORT}/admin`);
check("begona yo'l -> 404", notFound.status === 404);

// 13. Yopilish. Windows'da SIGTERM ni ushlab bo'lmaydi (Node hujjati) —
// u yerda faqat jarayon tugashini tekshiramiz, graceful yo'l Linux'da sinaladi.
const exited = new Promise((r) => bot.once("exit", (code) => r(code)));
bot.kill("SIGTERM");
const exitCode = await Promise.race([exited, sleep(8000).then(() => "timeout")]);

if (process.platform === "win32") {
  check("SIGTERM da jarayon tugadi (Windows)", exitCode !== "timeout", `(kod: ${exitCode})`);
} else {
  check("SIGTERM da toza yopildi", exitCode === 0, `(kod: ${exitCode})`);
  check("yopilish loglandi", botLog.join("").includes("yopilmoqda"));
}

api.close();
aiApi.close();
fs.rmSync(DATA_DIR, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "Barcha sinovlar o'tdi" : `${failures} ta sinov muvaffaqiyatsiz`}\n`);
if (failures > 0) {
  console.log("Bot loglari:\n" + botLog.join(""));
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      // hali tayyor emas
    }
    await sleep(150);
  }
  throw new Error("kutish vaqti tugadi");
}
