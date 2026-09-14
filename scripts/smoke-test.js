// Uchdan-uchgacha sinov:  npm test
//
// Soxta Telegram API ko'tariladi, bot shunga qaratib ishga tushiriladi, so'ng unga
// haqiqiy webhook so'rovlari yuboriladi va javoblari tekshiriladi.
// Haqiqiy token ham, internet ham kerak emas.

import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API_PORT = 8791;
const AI_PORT = 8792;
const KOVER_PORT = 8793;
const BOT_PORT = 3991;
const SECRET = "test_secret_0123456789abcdef";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bot-smoke-"));

// Sinov o'z bilim bazasi bilan ishlaydi: loyihadagi `bilim/` o'zgarsa ham natija
// o'zgarmasin. README indekslanmasligi ham shu yerda tekshiriladi.
const BILIM_DIR = path.join(DATA_DIR, "bilim");
fs.mkdirSync(path.join(BILIM_DIR, "ichki"), { recursive: true });
fs.writeFileSync(
  path.join(BILIM_DIR, "narxlar.md"),
  "# Narxlar\n\n## Landing\n\nLanding sayt narxi 5 000 000 so'm, muddati 4-6 kun.\n\n" +
    "## Bot\n\nOddiy bot 6 000 000 so'm.\n",
);
fs.writeFileSync(path.join(BILIM_DIR, "ichki", "kafolat.md"), "# Kafolat\n\nKafolat muddati 30 kun.\n");
fs.writeFileSync(path.join(BILIM_DIR, "README.md"), "# Qo'llanma\n\nBu fayl indekslanmasligi kerak.\n");
fs.writeFileSync(path.join(BILIM_DIR, "rasm.png"), "png emas, lekin kengaytmasi mos emas");

// Xarakter fayllari ham sinovga xos: loyihadagi `agentlar/` tahrirlansa sinov o'zgarmasin.
const AGENTLAR_DIR = path.join(DATA_DIR, "agentlar");
fs.mkdirSync(AGENTLAR_DIR, { recursive: true });
fs.writeFileSync(path.join(AGENTLAR_DIR, "yozuvchi.md"), "# Yozuvchi\n\nDo'stona yoz, 10 qator.\n");
fs.writeFileSync(path.join(AGENTLAR_DIR, "muharrir.md"), "# Muharrir\n\nUydirma faktni ushla.\n");

const sent = []; // sendMessage / answerCallbackQuery chaqiruvlari

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// Xabar ID'lari `sent` tozalansa ham takrorlanmasin: tugmalar aynan ID bo'yicha ishlaydi.
let nextMessageId = 1000;

// Shu chatga yuborilgan hamma narsa 400 bilan qaytadi — "bot kanalda admin emas" holati.
let failChatId = null;

// getChat va getChatMember javoblari: kalit — "@nomi" yoki ID; a'zolik — "chatId:userId".
const fakeChats = {};
const fakeMembers = {};

/** Multipart tanasidan matnli maydonlarni oladi (rasm baytlariga tegmaydi). */
function multipartFields(raw, names) {
  const text = raw.toString("latin1");
  const fields = {};
  for (const name of names) {
    const match = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`));
    if (match) fields[name] = Buffer.from(match[1], "latin1").toString("utf8");
  }
  return fields;
}

const api = http.createServer((req, res) => {
  // Bayt sifatida yig'amiz: sendPhoto multipart yuboradi, uni satrga aylantirsak buziladi.
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const method = req.url.split("/").pop();
    const isJson = (req.headers["content-type"] ?? "").includes("application/json");

    // sendPhoto ikki xil keladi: fayl (multipart) yoki file_id (JSON — kanalga chop etishda).
    const payload = method === "sendPhoto" && !isJson
      ? {
          bytes: raw.length,
          isPng: raw.includes(PNG_SIGNATURE),
          isJpeg: raw.includes(JPEG_SIGNATURE),
          ...multipartFields(raw, ["chat_id", "caption", "parse_mode", "reply_markup"]),
        }
      : (raw.length > 0 ? JSON.parse(raw.toString()) : {});
    if (typeof payload.reply_markup === "string") payload.reply_markup = JSON.parse(payload.reply_markup);
    // Multipart'da hamma maydon satr; JSON'dagi "@nomi" ga esa tegilmaydi.
    if (!isJson && /^-?\d+$/.test(payload.chat_id ?? "")) payload.chat_id = Number(payload.chat_id);

    // Model buzuq HTML yozgan holat: Telegram izohni o'qiy olmaydi.
    if (method === "sendPhoto" && payload.parse_mode && String(payload.caption ?? "").includes("<buzuq")) {
      sent.push({ method, payload, failed: true });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }));
      return;
    }

    if (failChatId !== null && payload.chat_id === failChatId) {
      sent.push({ method, payload, failed: true });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: need administrator rights in the channel chat" }));
      return;
    }

    // Kanalni qo'lda ulash: bot getChat va getChatMember bilan tekshiradi.
    if (method === "getChat" && !fakeChats[payload.chat_id]) {
      sent.push({ method, payload, failed: true });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
      return;
    }

    const messageId = nextMessageId++;
    const results = {
      getChat: fakeChats[payload.chat_id],
      getChatMember: fakeMembers[`${payload.chat_id}:${payload.user_id}`] ?? { status: "left" },
      getMe: { id: 1, is_bot: true, username: "smoke_test_bot" },
      sendMessage: { message_id: messageId },
      sendPhoto: { message_id: messageId, photo: [{ file_id: "kichik_id" }, { file_id: "soxta_file_id" }] },
      answerCallbackQuery: true,
      editMessageReplyMarkup: true,
      sendChatAction: true,
      setWebhook: true,
    };

    const result = results[method] ?? true;
    sent.push({ method, payload, result });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
});

await new Promise((r) => api.listen(API_PORT, r));

// Soxta Claude API. `aiResponse` ni o'zgartirib turli holatlarni sinaymiz.
const aiRequests = [];
let aiResponse = { status: 200, text: "Bugungi reja tayyor." };

// Navbat: qidiruv va pause_turn kabi murakkab holatlar uchun to'liq javob tanasini
// oldindan qo'yib ketamiz. Bo'sh bo'lsa oddiy `aiResponse` ishlatiladi.
let aiQueue = [];

/** Soxta Claude javobi. */
const aiBody = (content, stopReason = "end_turn", container = null) => ({
  id: "msg_smoke",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  // Server vositasi (qidiruv) kod bajarish muhitini ko'taradi — javobda uning id'si keladi.
  ...(container ? { container: { id: container, expires_at: "2030-01-01T00:00:00Z" } } : {}),
  usage: { input_tokens: 10, output_tokens: 5 },
});

const aiApi = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    aiRequests.push(body ? JSON.parse(body) : {});

    if (aiQueue.length > 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(aiQueue.shift()));
      return;
    }

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

// Soxta rasm API'si (Gemini o'rnida). `koverResponse` bilan holatlarni almashtiramiz.
const koverRequests = [];
let koverResponse = { status: 200, kind: "png" };

// 1x1 rasmlar — API rostdan rasm qaytargan holatni ifodalaydi.
// Gemini JPEG qaytaradi (`response_format` da faqat "image/jpeg" qabul qilinadi),
// shablon esa PNG bo'lib chiziladi — ikkala yo'l ham sinaladi.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const koverApi = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    koverRequests.push(body ? JSON.parse(body) : {});

    if (koverResponse.status !== 200) {
      // billing: bepul rejada rasm limiti 0 — Gemini aynan shu matnni qaytaradi
      const message = koverResponse.billing
        ? "You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image"
        : "soxta xato";
      res.writeHead(koverResponse.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: koverResponse.status, message } }));
      return;
    }

    const content = {
      png: [{ type: "image", mime_type: "image/png", data: PNG_1X1 }],
      jpeg: [{ type: "image", mime_type: "image/jpeg", data: JPEG_1X1 }],
    }[koverResponse.kind] ?? [{ type: "text", text: "bu rasm emas" }];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "v1_soxta",
      object: "interaction",
      status: "completed",
      steps: [{ type: "model_output", content }],
    }));
  });
});

await new Promise((r) => koverApi.listen(KOVER_PORT, r));

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
    BILIM_DIR,
    AGENTLAR_DIR,
    KOVER_API_KEY: "soxta-kover-kaliti",
    KOVER_API_BASE: `http://127.0.0.1:${KOVER_PORT}`,
    KOVER_BRAND: "Mrxone",
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

/**
 * `/post` oqimi bir necha xabar yuboradi: iz, bosqichlar va oxirida postning o'zi.
 * Nechtasini kutish kerakligini chaqiruvchi aytadi — bosqichlar soni oqimga bog'liq.
 */
async function postCommand(update, expected) {
  sent.length = 0;
  aiRequests.length = 0;
  await post(update);
  await waitFor(() => textMessages().length >= expected);
}

/**
 * Matnli xabarlar: oddiy xabar yoki izohli rasm. Post endi rasm + izoh bo'lib ketadi,
 * shuning uchun "post yetkazildi" degan tekshiruvlar ikkalasiga ham qaraydi.
 */
const textOf = (c) => (c.method === "sendMessage" ? c.payload.text : c.payload.caption);
const textMessages = () =>
  sent.filter((c) => !c.failed && (c.method === "sendMessage" || (c.method === "sendPhoto" && c.payload.caption)));

/** Yuborilgan hamma xabar bitta matnda — bosqich qatorlarini qidirish uchun. */
const allText = () => textMessages().map(textOf).join("\n");

/** So'rovdagi tizim ko'rsatmasi (endi bloklar massivi) — matn bo'yicha qidirish uchun. */
const systemText = (req) => JSON.stringify(req?.system ?? "");

const lastText = () => textOf(textMessages().at(-1) ?? { method: "sendMessage", payload: {} }) ?? "";

/**
 * Modulni alohida jarayonda yuklaydi va JSON natijasini qaytaradi.
 *
 * Bot bir marta ishga tushadi va uning `env` i o'zgarmaydi; kalitsiz yoki
 * `KOVER=off` holatlarini esa faqat boshqa `env` bilan sinash mumkin.
 */
function childJson(script, env) {
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "123456789:AAFakeTokenForLocalSmokeTest_abcdefg",
      WEBHOOK_SECRET: SECRET,
      PUBLIC_URL: "",
      BILIM_DIR,
      ...env,
    },
  });

  try {
    return JSON.parse((out.stdout ?? "").trim().split("\n").at(-1));
  } catch {
    return { xato: out.stderr };
  }
}

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
check("so'rov tanlangan tilda so'raldi", systemText(aiRequests[0]).includes("English"));
check("savol modelga yetib bordi", aiRequests[0]?.messages?.at(-1)?.content === "ertangi kunimni rejalashtir");
check(
  "xarakter ko'rsatmasi yuborildi",
  systemText(aiRequests[0]).includes("Tone and character:") &&
    systemText(aiRequests[0]).includes("Never belittle the person asking"),
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

// 6d. Veb qidiruv asbobi so'rovga qo'shiladi
await postAi(message(55, "dollar kursi qancha"));
const webTool = aiRequests[0]?.tools?.find((tool) => tool.type === "web_search_20260209");
check("qidiruv asbobi e'lon qilindi", Boolean(webTool));
check("qidiruv chegarasi berildi", webTool?.max_uses === 5, `(${webTool?.max_uses})`);
check("qidiruv qoidasi ko'rsatmaga qo'shildi", systemText(aiRequests[0]).includes("Web search:"));
check(
  "o'zgarmas qism keshlanadi, o'zgaruvchani keyin keladi",
  aiRequests[0]?.system?.[0]?.cache_control?.type === "ephemeral" &&
    aiRequests[0]?.system?.[1]?.cache_control === undefined &&
    aiRequests[0]?.system?.[1]?.text?.includes("Today is"),
);

// 6e. pause_turn — model davom ettirishni so'raydi, so'rov qayta yuboriladi
aiQueue = [
  aiBody(
    [
      { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "dollar kursi" } },
      { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://cbu.uz", title: "Kurs" }] },
    ],
    "pause_turn",
    "cnt_soxta_1",
  ),
  aiBody([{ type: "text", text: "Bugungi kurs — 12 500 so'm." }]),
];
await postAi(message(56, "kursni ayting"));
check("pause_turn da so'rov qayta yuborildi", aiRequests.length === 2, `(${aiRequests.length} ta so'rov)`);
check("oraliq javob modelga qaytarildi", aiRequests[1]?.messages?.at(-1)?.role === "assistant");
check("qidiruv bloklari o'zgarmasdan qaytdi", aiRequests[1]?.messages?.at(-1)?.content?.[0]?.type === "server_tool_use");
check("pause_turn dan keyin javob yetkazildi", lastText().includes("12 500"));
// Qidiruv asbobi server tomonda kod bajarish muhitini ko'taradi. Uning id'si
// qaytarilmasa API 400 beradi: "container_id is required when there are pending
// tool uses generated by code execution with tools".
check("birinchi so'rovda container yo'q", aiRequests[0]?.container === undefined);
check("davomida container qaytarildi", aiRequests[1]?.container === "cnt_soxta_1", `(${aiRequests[1]?.container})`);

// 6f. Qidiruv xatosi (massiv o'rniga error obyekti) javobni buzmaydi
aiQueue = [
  aiBody([
    { type: "web_search_tool_result", tool_use_id: "srv_2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    { type: "text", text: "Hozir topa olmadim." },
  ]),
];
await postAi(message(57, "yana qidir"));
check("qidiruv xatosi javobni buzmadi", lastText().includes("Hozir topa olmadim"));
check("qidiruv xatosi loglandi", botLog.join("").includes("max_uses_exceeded"));

// ---------------------------------------------------------------
// 6g. Bilim bazasi vositasi — bizning tool-loop
// ---------------------------------------------------------------

const bilimTool = aiRequests[0]?.tools?.find((tool) => tool.name === "bilim_qidiruv");
check("bilim vositasi e'lon qilindi", Boolean(bilimTool));
check(
  "vositaga tavsif berildi",
  (bilimTool?.description?.length ?? 0) > 200 && bilimTool.description.includes("knowledge base"),
);
check("vosita query maydonini so'raydi", bilimTool?.input_schema?.required?.[0] === "query");
check("bilim qoidasi ko'rsatmaga qo'shildi", systemText(aiRequests[0]).includes("Knowledge base:"));

/** Modelning vosita chaqirig'i — `tool_use` bilan to'xtaydi. */
const toolUse = (query, id = "tu_1") =>
  aiBody([{ type: "tool_use", id, name: "bilim_qidiruv", input: { query } }], "tool_use");

aiQueue = [toolUse("landing narxi"), aiBody([{ type: "text", text: "Landing — 5 000 000 so'm." }])];
await postAi(message(58, "landing qancha turadi"));

const toolResult = aiRequests[1]?.messages?.at(-1);
check("tool_use ga javob qaytarildi", aiRequests.length === 2, `(${aiRequests.length} ta so'rov)`);
check("chaqiruv modelga qaytarildi", aiRequests[1]?.messages?.at(-2)?.role === "assistant");
check("tool_result yuborildi", toolResult?.content?.[0]?.type === "tool_result");
check("tool_use_id mos keldi", toolResult?.content?.[0]?.tool_use_id === "tu_1");
check(
  "topilgan matn natijaga tushdi",
  String(toolResult?.content?.[0]?.content ?? "").includes("5 000 000"),
);
check(
  "natijada fayl nomi ko'rsatildi",
  String(toolResult?.content?.[0]?.content ?? "").includes("narxlar.md"),
);
check("vosita chaqirilgandan keyin javob yetkazildi", lastText().includes("5 000 000"));

// Ichki papka ham o'qiladi, README esa yo'q
aiQueue = [toolUse("kafolat muddati", "tu_2"), aiBody([{ type: "text", text: "30 kun." }])];
await postAi(message(59, "kafolat qancha"));
check(
  "ichki papkadagi fayl topildi",
  String(aiRequests[1]?.messages?.at(-1)?.content?.[0]?.content ?? "").includes("30 kun"),
);

aiQueue = [toolUse("qo'llanma indekslanmasligi", "tu_3"), aiBody([{ type: "text", text: "Topilmadi." }])];
await postAi(message(60, "qo'llanma bormi"));
check(
  "README indekslanmadi",
  !String(aiRequests[1]?.messages?.at(-1)?.content?.[0]?.content ?? "").includes("indekslanmasligi kerak"),
);

// Bazada yo'q mavzu — javob buzilmaydi
aiQueue = [toolUse("kosmik kema", "tu_4"), aiBody([{ type: "text", text: "Bazada yo'q ekan." }])];
await postAi(message(61, "kosmik kema"));
check(
  "topilmaganda tushunarli javob qaytdi",
  String(aiRequests[1]?.messages?.at(-1)?.content?.[0]?.content ?? "").includes("topilmadi"),
);
check("topilmaganda ham javob yetkazildi", lastText().includes("Bazada yo'q ekan"));

// Noma'lum vosita — exception emas, is_error
aiQueue = [
  aiBody([{ type: "tool_use", id: "tu_5", name: "yoq_vosita", input: {} }], "tool_use"),
  aiBody([{ type: "text", text: "Baribir javob beraman." }]),
];
await postAi(message(62, "noma'lum vosita"));
check("noma'lum vosita is_error bilan qaytdi", aiRequests[1]?.messages?.at(-1)?.content?.[0]?.is_error === true);
check("noma'lum vositadan keyin javob yetkazildi", lastText().includes("Baribir javob beraman"));

// ---------------------------------------------------------------
// 6h. /post — material -> yozuvchi -> muharrir oqimi
// ---------------------------------------------------------------

sent.length = 0;
await post(message(63, "/post"));
check("mavzusiz /post yo'riqnoma berdi", lastText().includes("/post prices"));

// Tarixni tozalab, bitta oddiy almashuv qilamiz — /post unga tegmasligi shunda ko'rinadi
await post(message(64, "/new"));
aiQueue = [];
await postAi(message(65, "salom"));

// Oqim: material (vosita bilan) -> yozuvchi -> muharrir "o'tdi"
aiQueue = [
  toolUse("landing narxi", "tu_6"),
  aiBody([{ type: "text", text: "Material yig'ildi: landing 5 000 000 so'm." }]),
  aiBody([{ type: "text", text: "Landing kerakmi? 5 000 000 so'm. Qanday sayt kerak?" }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
// iz + yozuvchi + muharrir + post = 4 xabar
await postCommand(message(66, "/post landing"), 4);

check("/post vosita izini ko'rsatdi", allText().includes("The tool ran"));
check("/post izda parcha soni bor", /knowledge base:.*passages/.test(allText()));
check("/post izda fayl nomi bor", allText().includes("narxlar.md"));
check("/post material yig'ish rejimida so'radi", systemText(aiRequests[0]).includes("material-gathering"));
check("/post tarixni ishlatmadi", aiRequests[0]?.messages?.length === 1, `(${aiRequests[0]?.messages?.length})`);
check("oqim uch bosqichdan o'tdi", aiRequests.length === 4, `(${aiRequests.length} ta so'rov)`);

// Yozuvchi: 3-so'rov (material vosita tufayli ikkita so'rov bo'ldi)
check("yozuvchi ko'rsatmasi yuborildi", systemText(aiRequests[2]).includes("you are the writer"));
check(
  "yozuvchining xarakter fayli yuborildi",
  systemText(aiRequests[2]).includes("character file (agentlar/yozuvchi.md)") &&
    systemText(aiRequests[2]).includes("Do'stona yoz"),
);
check(
  "yozuvchiga material uzatildi",
  String(aiRequests[2]?.messages?.[0]?.content ?? "").includes("Material yig'ildi"),
);

// Muharrir: 4-so'rov
check("muharrir ko'rsatmasi yuborildi", systemText(aiRequests[3]).includes("you are the editor"));
check(
  "muharrirning xarakter fayli yuborildi",
  systemText(aiRequests[3]).includes("character file (agentlar/muharrir.md)") &&
    systemText(aiRequests[3]).includes("Uydirma faktni ushla"),
);
check(
  "muharrirga post uzatildi",
  String(aiRequests[3]?.messages?.[0]?.content ?? "").includes("Landing kerakmi"),
);
check("muharrir tarixsiz ishladi", aiRequests[3]?.messages?.length === 1, `(${aiRequests[3]?.messages?.length})`);

check("bosqichlar ko'rsatildi", allText().includes("The writer") && allText().includes("passed"));
check("post foydalanuvchiga yetkazildi", lastText().includes("Landing kerakmi"));

// Keyingi oddiy savolda faqat oldingi almashuv + yangi savol ko'rinishi kerak (3 ta xabar).
aiQueue = [];
await postAi(message(67, "yana savol"));
check("/post tarixga yozilmadi", aiRequests[0]?.messages?.length === 3, `(${aiRequests[0]?.messages?.length})`);

// Vosita chaqirilmasa, iz shuni aytadi
aiQueue = [
  aiBody([{ type: "text", text: "Material yo'q." }]),
  aiBody([{ type: "text", text: "Vositasiz post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(68, "/post umumiy mavzu"), 4);
check("vosita chaqirilmagani izda ko'rindi", allText().includes("no tool was called"));

// --- Muharrir "qayta yoz" desa, sabab yozuvchiga qaytadi ---
aiQueue = [
  aiBody([{ type: "text", text: "Material: kafolat 30 kun." }]),
  aiBody([{ type: "text", text: "Birinchi variant." }]),
  aiBody([{ type: "text", text: "QAYTA YOZ\nSabab: oxirida savol yo'q." }]),
  aiBody([{ type: "text", text: "Ikkinchi variant. Sizda qanday?" }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
// iz + yozuvchi + muharrir + qayta yozdi + muharrir + post = 6 xabar
await postCommand(message(69, "/post kafolat"), 6);

check("qayta yozish bo'ldi", aiRequests.length === 5, `(${aiRequests.length} ta so'rov)`);
check(
  "muharrir sababi yozuvchiga uzatildi",
  String(aiRequests[3]?.messages?.at(-1)?.content ?? "").includes("oxirida savol yo'q"),
);
check(
  "yozuvchi oldingi variantini ko'rdi",
  aiRequests[3]?.messages?.some((m) => m.role === "assistant" && m.content === "Birinchi variant."),
);
check("sabab foydalanuvchiga ko'rsatildi", allText().includes("oxirida savol yo'q"));
check("qayta yozish bosqichi ko'rindi", allText().includes("rewrote it (1/2)"));
check("oxirgi variant yetkazildi", lastText().includes("Ikkinchi variant"));

// --- Muharrir hech rozi bo'lmasa: 2 qayta yozishdan keyin to'xtaydi ---
const rewrite = () => aiBody([{ type: "text", text: "QAYTA YOZ\nSabab: hali ham qisqa." }]);
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody([{ type: "text", text: "Variant bir." }]),
  rewrite(),
  aiBody([{ type: "text", text: "Variant ikki." }]),
  rewrite(),
  aiBody([{ type: "text", text: "Variant uch." }]),
  rewrite(),
];
// iz + (yozuvchi + muharrir) x3 + ogohlantirish + post = 9 xabar
await postCommand(message(70, "/post narx"), 9);

check("ikkitadan ko'p qayta yozilmadi", aiRequests.length === 7, `(${aiRequests.length} ta so'rov)`);
check("chegara haqida ogohlantirildi", allText().includes("Rewritten 2 times"));
check("oxirgi variant baribir ko'rsatildi", lastText().includes("Variant uch"));

// --- Muharrir javobi tushunarsiz bo'lsa: post shundayligicha chiqadi (fail-open) ---
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody([{ type: "text", text: "Yaxshi post." }]),
  aiBody([{ type: "text", text: "Menimcha yomon emas, lekin bilmadim." }]),
];
await postCommand(message(71, "/post tushunarsiz"), 4);
check("tushunarsiz javobda qayta yozilmadi", aiRequests.length === 3, `(${aiRequests.length} ta so'rov)`);
check("tushunarsiz javob izda aytildi", allText().includes("made no sense"));
check("tushunarsiz javobda ham post yetkazildi", lastText().includes("Yaxshi post"));

// --- Xarakter fayli yo'q bo'lsa: tushunarli xato, model chaqirilmaydi ---
const writerFile = path.join(AGENTLAR_DIR, "yozuvchi.md");
fs.renameSync(writerFile, `${writerFile}.bak`);
sent.length = 0;
aiRequests.length = 0;
await post(message(72, "/post fayl yo'q"));
await waitFor(() => sent.some((c) => c.method === "sendMessage"));
check("yo'q fayl haqida xabar berildi", lastText().includes("Couldn't read the character file"));
check("xabarda fayl nomi bor", lastText().includes("yozuvchi.md"));
check("fayl yo'qligida model chaqirilmadi", aiRequests.length === 0, `(${aiRequests.length} ta so'rov)`);
fs.renameSync(`${writerFile}.bak`, writerFile);

// --- Xarakter fayli tahrirlansa restartsiz ko'rinadi (mtime) ---
fs.writeFileSync(path.join(AGENTLAR_DIR, "muharrir.md"), "# Muharrir\n\nYangi mezon: sarlavha shart.\n");
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody([{ type: "text", text: "Post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(73, "/post yangi mezon"), 4);
check(
  "tahrirlangan xarakter fayli restartsiz ishladi",
  systemText(aiRequests[2]).includes("Yangi mezon: sarlavha shart"),
);

// ---------------------------------------------------------------
// 6i. Kover rasm — uchinchi vosita
// ---------------------------------------------------------------

{
  const tool = aiRequests[0]?.tools?.find((item) => item.name === "kover_rasm");
  check("kover vositasi e'lon qilindi", Boolean(tool));
  check(
    "kover vositasiga tavsif berildi",
    (tool?.description?.length ?? 0) > 200 && tool.description.includes("cover image"),
  );
  check(
    "kover vositasi tavsif va sarlavha so'raydi",
    tool?.input_schema?.required?.join(",") === "tavsif,sarlavha",
  );
}

/** Yozuvchining kover chaqirig'i. */
const koverUse = (id = "kv_1") =>
  aiBody(
    [{
      type: "tool_use",
      id,
      name: "kover_rasm",
      input: { tavsif: "a desk with a laptop", sarlavha: "Landing narxi" },
    }],
    "tool_use",
  );

const lastPhoto = () => [...sent].reverse().find((c) => c.method === "sendPhoto")?.payload;

// --- API ishlagan holat ---
koverResponse = { status: 200, kind: "png" };
koverRequests.length = 0;
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_1"),
  aiBody([{ type: "text", text: "Post matni." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
// iz + yozuvchi + kover + muharrir + post = 5 xabar (rasm alohida sendPhoto bo'lib ketadi)
await postCommand(message(74, "/post kover"), 5);

check("rasm API'ga so'rov ketdi", koverRequests.length === 1, `(${koverRequests.length})`);
check("so'rovda model ko'rsatildi", Boolean(koverRequests[0]?.model));
check("so'rov 16:9 nisbatda", koverRequests[0]?.response_format?.aspect_ratio === "16:9");
// Gemini "image/png" ga 400 qaytaradi: "Supported values: 'image/jpeg'".
check(
  "so'rov jpeg so'raydi",
  koverRequests[0]?.response_format?.mime_type === "image/jpeg",
  `(${koverRequests[0]?.response_format?.mime_type})`,
);
check(
  "rasmda matn bo'lmasligi so'raldi",
  String(koverRequests[0]?.input?.[0]?.text ?? "").includes("no text"),
);
check(
  "modelning tavsifi so'rovga tushdi",
  String(koverRequests[0]?.input?.[0]?.text ?? "").includes("a desk with a laptop"),
);
check("kover API'dan olingani izda ko'rindi", allText().includes("image generated"));
check("rasm Telegram'ga yuborildi", lastPhoto()?.isPng === true);
check(
  "modelga qisqa natija qaytdi",
  aiRequests[2]?.messages?.at(-1)?.content?.[0]?.content === "Kover tayyor.",
);
check("rasm va post bitta xabar: post rasm izohida", lastPhoto()?.caption === "Post matni.", `(${lastPhoto()?.caption})`);
check("izoh HTML sifatida yuborildi", lastPhoto()?.parse_mode === "HTML");
check("tugmalar rasmning tagida", String(lastPhoto()?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? "").startsWith("post:pub:"));
check("post alohida matn bo'lib takrorlanmadi", !sent.some((c) => c.method === "sendMessage" && c.payload.text === "Post matni."));

// --- JPEG javob ham yuboriladi (Gemini aynan shu turni qaytaradi) ---
koverResponse = { status: 200, kind: "jpeg" };
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_jpeg"),
  aiBody([{ type: "text", text: "JPEG koverli post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(741, "/post jpeg"), 5);
check("jpeg rasm ham yuborildi", lastPhoto()?.isJpeg === true);
check("jpeg koverdan keyin post yetkazildi", lastText().includes("JPEG koverli post"));

// --- Limit tugadi: shablonga o'tadi ---
koverResponse = { status: 429 };
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_2"),
  aiBody([{ type: "text", text: "Limitli post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(75, "/post limit"), 5);

check("limitda shablonga o'tildi", allText().includes("quota spent"));
check("shablon ham PNG bo'lib yuborildi", lastPhoto()?.isPng === true);
check("shablon rostdan chizildi", (lastPhoto()?.bytes ?? 0) > 5000, `(${lastPhoto()?.bytes} bayt)`);
check("limitda ham post yetkazildi", lastText().includes("Limitli post"));

// --- Javob rasm emas: shablon, xatolik yo'q ---
koverResponse = { status: 200, kind: "matn" };
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_3"),
  aiBody([{ type: "text", text: "Buzuq javobli post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(76, "/post buzuq"), 5);
check("buzuq javobda shablon chizildi", allText().includes("made no sense"));
check("buzuq javobda ham post yetkazildi", lastText().includes("Buzuq javobli post"));

// --- Muharrir bosqichida chaqirilsa: rad etiladi ---
koverResponse = { status: 200, kind: "png" };
koverRequests.length = 0;
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody([{ type: "text", text: "Koversiz post." }]),
  aiBody([{ type: "tool_use", id: "kv_4", name: "kover_rasm", input: { tavsif: "x", sarlavha: "y" } }], "tool_use"),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(77, "/post chegara"), 4);

const muharrirResult = aiRequests[3]?.messages?.at(-1)?.content?.[0];
check("muharrirning kover chaqirig'i rad etildi", muharrirResult?.is_error === true);
check(
  "rad sababi tushuntirildi",
  String(muharrirResult?.content ?? "").includes("faqat post yozishda"),
);
check("chegara buzilganda rasm yasalmadi", koverRequests.length === 0, `(${koverRequests.length})`);

// --- Bitta postga ikkita kover: ikkinchisi rad etiladi ---
koverRequests.length = 0;
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody(
    [
      { type: "tool_use", id: "kv_5", name: "kover_rasm", input: { tavsif: "a", sarlavha: "b" } },
      { type: "tool_use", id: "kv_6", name: "kover_rasm", input: { tavsif: "c", sarlavha: "d" } },
    ],
    "tool_use",
  ),
  aiBody([{ type: "text", text: "Ikki koverli post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(78, "/post ikkita"), 5);

const ikkiNatija = aiRequests[2]?.messages?.at(-1)?.content ?? [];
check("birinchi kover yasaldi", ikkiNatija[0]?.is_error === undefined);
check("ikkinchi kover rad etildi", ikkiNatija[1]?.is_error === true);
check("ikkinchisiga rasm so'ralmadi", koverRequests.length === 1, `(${koverRequests.length})`);

// --- Qayta yozishda kover qaytadan yasalmaydi ---
koverRequests.length = 0;
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_7"),
  aiBody([{ type: "text", text: "Birinchi variant." }]),
  aiBody([{ type: "text", text: "QAYTA YOZ\nSabab: juda qisqa." }]),
  koverUse("kv_8"),
  aiBody([{ type: "text", text: "Ikkinchi variant." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
// iz + yozuvchi + kover + muharrir + qayta yozdi + muharrir + post = 7 xabar
await postCommand(message(79, "/post qayta kover"), 7);

check("qayta yozishda yangi rasm yasalmadi", koverRequests.length === 1, `(${koverRequests.length})`);
check(
  "qayta chaqiruv rad etildi",
  aiRequests[5]?.messages?.at(-1)?.content?.[0]?.is_error === true,
);
check("bitta rasm yuborildi", sent.filter((c) => c.method === "sendPhoto").length === 1);

// --- Kalitsiz holat: kover.js to'g'ridan-to'g'ri tekshiriladi ---
// Bot jarayoni kalit bilan ishga tushgan, shuning uchun bu shoxobcha alohida
// jarayonda sinaladi — env ni yo'lda o'zgartirib bo'lmaydi.
{
  const koverUrl = pathToFileURL(path.join(PROJECT_ROOT, "kover.js")).href;
  const script =
    `const kover = await import(${JSON.stringify(koverUrl)});` +
    `const r = await kover.yasa({ tavsif: "x", sarlavha: "Landing narxi qancha" });` +
    `console.log(JSON.stringify({ usul: r.usul, sabab: r.sabab, bytes: r.buffer.length,` +
    ` png: r.buffer.subarray(0, 4).toString("hex"), font: kover.hasFont }));`;

  const result = childJson(script, { KOVER_API_KEY: "", KOVER_BRAND: "Mrxone" });

  check("kalitsiz shablonga o'tdi", result.usul === "shablon" && result.sabab === "kalitYoq");
  check("shablon haqiqiy PNG", result.png === "89504e47", `(${result.png})`);
  check("shablonda matn chizildi", result.font === true && result.bytes > 5000, `(${result.bytes} bayt)`);
}

// --- KOVER=off: vosita umuman e'lon qilinmaydi ---
{
  const aiUrl = pathToFileURL(path.join(PROJECT_ROOT, "ai.js")).href;
  const script =
    `const ai = await import(${JSON.stringify(aiUrl)});` +
    `console.log(JSON.stringify({ names: ai.toolNames() }));`;

  const names = childJson(script, {
    KOVER: "off",
    ANTHROPIC_API_KEY: "sk-ant-smoke-test-0123456789",
  }).names ?? [];

  check("KOVER=off da vosita e'lon qilinmadi", !names.includes("kover_rasm"), `(${names.join(", ")})`);
  check("boshqa vositalar joyida qoldi", names.includes("bilim_qidiruv"), `(${names.join(", ")})`);
}

// ---------------------------------------------------------------
// 6j. Kanalga chop etish — post tagidagi tugmalar
// ---------------------------------------------------------------

/** Post tugmalari bor oxirgi xabar — oddiy matn yoki izohli rasm. */
const keyboardMessage = () =>
  [...sent].reverse().find((c) =>
    !c.failed &&
    (c.method === "sendMessage" || c.method === "sendPhoto") &&
    String(c.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? "").startsWith("post:"));

const keyboardText = () => {
  const msg = keyboardMessage();
  return msg ? String(textOf(msg) ?? "") : "";
};

const KANAL = { id: -1001234567890, type: "channel", title: "Test <kanal>", username: "test_kanal" };

/** Botning kanaldagi holati o'zgargani haqidagi update. */
const memberUpdate = (updateId, chat, status, rights = {}, fromId = 555) => ({
  update_id: updateId,
  my_chat_member: {
    chat,
    from: { id: fromId, first_name: "Ali", language_code: "uz" },
    date: 0,
    old_chat_member: { status: "left", user: { id: 1, is_bot: true } },
    new_chat_member: { status, user: { id: 1, is_bot: true }, ...rights },
  },
});

/** Post tugmasini bosish. */
const press = (updateId, data, messageId, fromId = 555) => ({
  update_id: updateId,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: fromId, first_name: "Ali", language_code: "uz" },
    data,
    message: { message_id: messageId, chat: { id: 555, type: "private" } },
  },
});

const toChannel = (method) => sent.filter((c) => c.method === method && c.payload?.chat_id === KANAL.id && !c.failed);
/** Kanalga ketgan postlar: matnli xabar yoki izohli rasm (izohsiz rasm post emas). */
const channelPosts = () => [...toChannel("sendMessage"), ...toChannel("sendPhoto").filter((c) => c.payload.caption)];
const lastAnswer = () => [...sent].reverse().find((c) => c.method === "answerCallbackQuery")?.payload.text ?? "";
const kanallarFile = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "kanallar.json"), "utf8"));
  } catch {
    return {};
  }
};

/** Tugmali /post: kutilgan xabarlar soni + tugmalar chiqqach ID va xabar raqamini qaytaradi. */
async function postWithButtons(updateId, topic, queue, expected) {
  aiQueue = queue;
  await postCommand(message(updateId, `/post ${topic}`), expected);
  await waitFor(() => keyboardMessage());
  const msg = keyboardMessage();
  return {
    id: msg.payload.reply_markup.inline_keyboard[0][0].callback_data.split(":")[2],
    messageId: msg.result.message_id,
    msg,
  };
}

const simpleQueue = (text) => [
  aiBody([{ type: "text", text: "Material." }]),
  aiBody([{ type: "text", text }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];

// --- Kanal ulanmagan: tugmalar baribir chiqadi, chop etish yo'l ko'rsatadi ---
{
  const { id, messageId } = await postWithButtons(790, "kanalsiz", simpleQueue("Kanalsiz post."), 4);
  check("kanal ulanmaganda ham tugmalar chiqdi", keyboardText().includes("Kanalsiz post"));

  sent.length = 0;
  await post(press(791, `post:pub:${id}`, messageId));
  await waitFor(() => allText().includes("No channel connected"));
  check("kanalsiz chop etishda qanday ulash aytildi", lastText().includes("Add Admin"));
  check("kanalsiz chop etishda tugmalar olinmadi", !sent.some((c) => c.method === "editMessageReplyMarkup"));

  // Qayta yozish kanalsiz ham ishlaydi
  sent.length = 0;
  aiQueue = [aiBody([{ type: "text", text: "Kanalsiz ikkinchi." }]), aiBody([{ type: "text", text: "O'TDI" }])];
  await post(press(792, `post:re:${id}`, messageId));
  await waitFor(() => keyboardText().includes("Kanalsiz ikkinchi"));
  check("kanalsiz qayta yozish ishladi", Boolean(keyboardMessage()));
}

// --- Allaqachon admin bo'lgan kanalni qo'lda ulash: /kanal va forward ---
// my_chat_member faqat holat o'zgarganda keladi; bot oldin qo'shilgan bo'lsa u kelmaydi.
{
  const ESKI = { id: -1002000000001, type: "channel", title: "Eski kanal", username: "eski_kanal" };
  fakeChats["@eski_kanal"] = ESKI;
  fakeChats[ESKI.id] = ESKI;
  fakeChats["@guruh"] = { id: -100777, type: "supergroup", title: "Guruh" };

  const forwarded = (updateId, chat, text) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 555, first_name: "Ali", language_code: "uz" },
      chat: { id: 555, type: "private" },
      text,
      forward_origin: { type: "channel", chat, message_id: 5, date: 0 },
    },
  });

  sent.length = 0;
  await post(message(760, "/kanal"));
  check("/kanal yo'riqnoma berdi", lastText().includes("Connecting a channel") && lastText().includes("forward"));

  sent.length = 0;
  await post(message(761, "/kanal @yoq_kanal"));
  check("/kanal: yo'q kanal", lastText().includes("Channel not found"));

  sent.length = 0;
  await post(message(762, "/kanal guruh"));
  check("/kanal: @ siz nom ham qabul qilindi, guruh rad etildi", lastText().includes("not a channel"));

  sent.length = 0;
  await post(message(763, "/kanal @eski_kanal"));
  check("/kanal: bot admin bo'lmasa aytildi", lastText().includes("isn't an admin"));

  // Bot admin, lekin so'rayotgan odam kanal a'zosi xolos — begona odam ulay olmasin
  fakeMembers[`${ESKI.id}:1`] = { status: "administrator", can_post_messages: true };
  fakeMembers[`${ESKI.id}:555`] = { status: "member" };
  sent.length = 0;
  await post(message(764, "/kanal @eski_kanal"));
  check("/kanal: kanal admini bo'lmagan odam ulay olmadi", lastText().includes("You aren't an admin"));
  check("/kanal: begonaga kanal yozilmadi", !kanallarFile()["555"]);

  // Bot admin, lekin post joylash huquqisiz
  fakeMembers[`${ESKI.id}:1`] = { status: "administrator", can_post_messages: false };
  fakeMembers[`${ESKI.id}:555`] = { status: "creator" };
  sent.length = 0;
  await post(message(765, "/kanal @eski_kanal"));
  check("/kanal: huquqsiz bot aytildi", lastText().includes("isn't allowed to post"));

  fakeMembers[`${ESKI.id}:1`] = { status: "administrator", can_post_messages: true };
  sent.length = 0;
  await post(message(766, "/kanal @eski_kanal"));
  check("/kanal: kanal ulandi", lastText().includes("connected") && kanallarFile()["555"]?.id === ESKI.id);

  sent.length = 0;
  await post(message(767, "/kanal"));
  check("/kanal: ulangan kanal ko'rsatildi", lastText().includes("Connected channel: <b>Eski kanal</b>"));

  // Ulangan kanaldan forward — oddiy xabar, AI javob beradi
  await postAi(forwarded(768, ESKI, "shu postni tahlil qil"));
  check("ulangan kanaldan forward AI'ga ketdi", lastText().includes("Bugungi reja tayyor"));

  // Bot admin bo'lmagan kanaldan forward — jim, AI'ga ketadi
  const BEGONA = { id: -1003000000001, type: "channel", title: "Begona" };
  fakeChats[BEGONA.id] = BEGONA;
  await postAi(forwarded(769, BEGONA, "boshqa kanal posti"));
  check("begona kanaldan forward jim o'tdi", lastText().includes("Bugungi reja tayyor") && !allText().includes("isn't an admin"));

  // Forward bilan ulash: kanalni uzib, qayta forward qilamiz
  await post(memberUpdate(770, ESKI, "left"));
  check("uzilgach kanal o'chdi", !kanallarFile()["555"]);
  sent.length = 0;
  await post(forwarded(771, ESKI, "istalgan post"));
  check("forward bilan kanal ulandi", lastText().includes("connected") && kanallarFile()["555"]?.id === ESKI.id);

  // Keyingi sinovlar kanalsiz holatdan boshlanadi
  await post(memberUpdate(772, ESKI, "left"));
}

// --- Guruh — e'tiborsiz ---
sent.length = 0;
await post(memberUpdate(800, { id: -100555, type: "supergroup", title: "Guruh" }, "administrator", { can_post_messages: true }));
check("guruhga qo'shilish e'tiborsiz qoldi", sent.length === 0 && !kanallarFile()["555"], `(${sent.length})`);

// --- Admin, lekin post joylash huquqisiz ---
sent.length = 0;
await post(memberUpdate(801, KANAL, "administrator", { can_post_messages: false }));
check("huquqsiz adminlik aytildi", lastText().includes("isn't allowed to post"));
check("huquqsiz kanal ulanmadi", !kanallarFile()["555"]);

// --- To'liq huquq bilan: kanal ulanadi ---
sent.length = 0;
await post(memberUpdate(802, KANAL, "administrator", { can_post_messages: true }));
check("kanal ulangani aytildi", lastText().includes("connected"));
check("kanal nomi xavfsiz ko'rsatildi", lastText().includes("Test &lt;kanal&gt;"));
check("kanal diskka yozildi", kanallarFile()["555"]?.id === KANAL.id, JSON.stringify(kanallarFile()));

// --- /post endi tugmalar bilan ---
koverResponse = { status: 200, kind: "png" };
{
  const { id, messageId, msg } = await postWithButtons(803, "kanal", [
    aiBody([{ type: "text", text: "Material." }]),
    koverUse("kv_k1"),
    aiBody([{ type: "text", text: "Kanal uchun post." }]),
    aiBody([{ type: "text", text: "O'TDI" }]),
  ], 5);

  const rows = msg.payload.reply_markup.inline_keyboard;
  const datas = rows.flat().map((b) => b.callback_data);
  check("tugmalar post matni tagida", String(textOf(msg)).includes("Kanal uchun post"));
  check("uchta tugma: 1 + 2 qator", rows.length === 2 && rows[0].length === 1 && rows[1].length === 2);
  check(
    "tugma ma'lumoti to'g'ri va 64 baytdan kichik",
    datas.every((d) => /^post:(pub|re|no):[\w-]{8}$/.test(d) && Buffer.byteLength(d) <= 64),
    datas.join(" "),
  );
  check("tugmalar inglizcha", rows[0][0].text.includes("Publish to channel"));

  // Begona foydalanuvchi
  sent.length = 0;
  await post(press(804, `post:pub:${id}`, messageId, 777));
  // 777 til tanlamagan — javob uning language_code (uz) bo'yicha.
  check("begona odam chop eta olmadi", lastAnswer().includes("sizning postingiz uchun emas"), `(${lastAnswer()})`);
  check("begonadan kanalga hech narsa ketmadi", channelPosts().length === 0);

  // Ikki marta tez bosish — bitta post
  sent.length = 0;
  await Promise.all([
    post(press(805, `post:pub:${id}`, messageId)),
    post(press(806, `post:pub:${id}`, messageId)),
  ]);
  await waitFor(() => allText().includes("is live"));
  check("ikki bosishda kanalga bitta post ketdi", channelPosts().length === 1, `(${channelPosts().length})`);
  check("kanalga post matni ketdi", textOf(channelPosts()[0] ?? { payload: {} }) === "Kanal uchun post.");
  check("kanalga kover file_id bilan ketdi", toChannel("sendPhoto")[0]?.payload.photo === "soxta_file_id");
  check("kanalda rasm va matn bitta post", toChannel("sendPhoto").length === 1 && toChannel("sendMessage").length === 0);
  check("kanalda tugma yo'q", !toChannel("sendPhoto")[0]?.payload.reply_markup);
  check(
    "chop etilgach tugmalar olindi",
    sent.some((c) => c.method === "editMessageReplyMarkup" && c.payload.message_id === messageId),
  );
  const photoId = toChannel("sendPhoto")[0]?.result?.message_id;
  check("tasdiqda kanaldagi postga havola bor", allText().includes(`https://t.me/test_kanal/${photoId}`));

  // Chop etilgandan keyin yana bosish
  sent.length = 0;
  await post(press(807, `post:pub:${id}`, messageId));
  check("chop etilgan post eskirgan deb javob berdi", lastAnswer().includes("expired"));
  check("qayta bosishda kanalga hech narsa ketmadi", channelPosts().length === 0);
}

// --- Bekor qilish ---
{
  const { id, messageId } = await postWithButtons(810, "bekor", simpleQueue("Bekor post."), 4);

  sent.length = 0;
  await post(press(811, `post:no:${id}`, messageId));
  check("bekor qilindi deb aytildi", lastText().includes("Cancelled"));
  check("bekor qilishda tugmalar olindi", sent.some((c) => c.method === "editMessageReplyMarkup" && c.payload.message_id === messageId));
  check("bekor qilishda kanalga hech narsa ketmadi", channelPosts().length === 0);

  sent.length = 0;
  await post(press(812, `post:pub:${id}`, messageId));
  check("bekor qilingan postni chop etib bo'lmadi", lastAnswer().includes("expired") && channelPosts().length === 0);
}

// --- Noma'lum ID ---
sent.length = 0;
await post(press(813, "post:pub:yoqIDyoq", 1));
check("noma'lum ID eskirgan deb javob berdi", lastAnswer().includes("expired"));

// --- Qayta yozish ---
{
  const { id, messageId } = await postWithButtons(820, "qayta", simpleQueue("Birinchi variant K."), 4);

  sent.length = 0;
  aiRequests.length = 0;
  aiQueue = [
    aiBody([{ type: "text", text: "Ikkinchi variant K." }]),
    aiBody([{ type: "text", text: "O'TDI" }]),
  ];
  await post(press(821, `post:re:${id}`, messageId));
  await waitFor(() => keyboardText().includes("Ikkinchi variant K."));
  const fresh = keyboardMessage();

  check("qayta yozish faqat yozuvchi + muharrir", aiRequests.length === 2, `(${aiRequests.length} ta so'rov)`);
  check("material qayta yig'ilmadi", !aiRequests.some((r) => systemText(r).includes("material-gathering")));
  check("qayta yozishda yozuvchi ishladi", systemText(aiRequests[0]).includes("you are the writer"));
  check("qayta yozishda muharrir tekshirdi", systemText(aiRequests[1]).includes("you are the editor"));
  check(
    "yozuvchi materialni ko'rdi",
    String(aiRequests[0]?.messages?.[0]?.content ?? "").includes("Material."),
  );
  check(
    "yozuvchi eski variantini ko'rdi",
    aiRequests[0]?.messages?.[1]?.role === "assistant" && aiRequests[0]?.messages?.[1]?.content === "Birinchi variant K.",
  );
  check(
    "yozuvchiga foydalanuvchi qoniqmagani aytildi",
    String(aiRequests[0]?.messages?.[2]?.content ?? "").includes("not happy"),
  );
  check("qayta yozish boshlangani aytildi", allText().includes("Rewriting (1/3)"));
  check("eski xabardan tugmalar olindi", sent.some((c) => c.method === "editMessageReplyMarkup" && c.payload.message_id === messageId));
  check("yangi variant o'sha ID bilan tugmali", fresh.payload.reply_markup.inline_keyboard[0][0].callback_data === `post:pub:${id}`);

  // Eski xabardagi tugma endi ishlamaydi
  sent.length = 0;
  await post(press(822, `post:pub:${id}`, messageId));
  check("eski xabardagi tugma eskirgan", lastAnswer().includes("expired") && channelPosts().length === 0);

  // Yangi variant chop etiladi
  sent.length = 0;
  await post(press(823, `post:pub:${id}`, fresh.result.message_id));
  await waitFor(() => allText().includes("is live"));
  check("kanalga yangi variant chiqdi", textOf(channelPosts()[0] ?? { payload: {} }) === "Ikkinchi variant K.");
}

// --- Qayta yozish chegarasi: 3 martadan keyin to'xtaydi ---
{
  let { id, messageId } = await postWithButtons(830, "limit", simpleQueue("Variant 0."), 4);

  for (let round = 1; round <= 3; round += 1) {
    sent.length = 0;
    aiQueue = [
      aiBody([{ type: "text", text: `Variant ${round}.` }]),
      aiBody([{ type: "text", text: "O'TDI" }]),
    ];
    await post(press(830 + round, `post:re:${id}`, messageId));
    await waitFor(() => keyboardText().includes(`Variant ${round}.`));
    messageId = keyboardMessage().result.message_id;
  }

  sent.length = 0;
  aiRequests.length = 0;
  await post(press(835, `post:re:${id}`, messageId));
  check("uch martadan keyin qayta yozilmadi", lastAnswer().includes("rewritten 3 times"));
  check("chegarada model chaqirilmadi", aiRequests.length === 0, `(${aiRequests.length})`);
}

// --- Kanal xatosi: tugmalar joyida qoladi, keyin qayta urinish ishlaydi ---
{
  const { id, messageId } = await postWithButtons(840, "xato", simpleQueue("Xatoli post."), 4);

  failChatId = KANAL.id;
  sent.length = 0;
  await post(press(841, `post:pub:${id}`, messageId));
  await waitFor(() => allText().includes("Couldn't publish"));
  check("kanal xatosi tushuntirildi", lastText().includes("need administrator rights"));
  check(
    "xatoda tugmalar olinmadi",
    !sent.some((c) => c.method === "editMessageReplyMarkup" && c.payload.message_id === messageId),
  );

  failChatId = null;
  sent.length = 0;
  await post(press(842, `post:pub:${id}`, messageId));
  await waitFor(() => allText().includes("is live"));
  check("tuzatilgach qayta chop etildi", textOf(channelPosts()[0] ?? { payload: {} }) === "Xatoli post.");
}

// ---------------------------------------------------------------
// 6k. Rasm + izoh bitta post: uzunlik chegarasi
// ---------------------------------------------------------------

// --- Uzun post: muharrirga bormay qisqartirishga qaytadi ---
{
  const LONG = "Uzun post matni. ".repeat(70); // ~1190 belgi
  koverResponse = { status: 200, kind: "png" };
  const { id, messageId } = await postWithButtons(860, "uzun", [
    aiBody([{ type: "text", text: "Material." }]),
    koverUse("kv_u1"),
    aiBody([{ type: "text", text: LONG }]),
    aiBody([{ type: "text", text: "Qisqa post." }]),
    aiBody([{ type: "text", text: "O'TDI" }]),
  ], 7); // iz + yozuvchi + kover + uzun + yozuvchi + muharrir + post

  const writerReq = aiRequests.find((r) => systemText(r).includes("you are the writer"));
  check("yozuvchiga izoh chegarasi aytildi (ko'rsatmada)", systemText(writerReq).includes("caption under the cover image"));
  check("uzun post bosqichi ko'rsatildi", allText().includes("came out long"));
  check(
    "uzun postda muharrir chaqirilmadi",
    aiRequests.filter((r) => systemText(r).includes("you are the editor")).length === 1,
  );
  check(
    "yozuvchiga qisqartirish so'raldi",
    aiRequests.some((r) => String(r.messages?.at(-1)?.content ?? "").includes("has to fit into an image caption")),
  );
  check("qisqargan post rasm izohida", lastPhoto()?.caption === "Qisqa post.", `(${lastPhoto()?.caption})`);
  check("uzun variant yuborilmadi", !allText().includes("Uzun post matni"));

  // Rasmli postni qayta yozish: rasm qayta yuklanmaydi, yangi izoh bilan keladi
  sent.length = 0;
  aiQueue = [aiBody([{ type: "text", text: "Qayta yozilgan qisqa post." }]), aiBody([{ type: "text", text: "O'TDI" }])];
  await post(press(861, `post:re:${id}`, messageId));
  await waitFor(() => keyboardText().includes("Qayta yozilgan qisqa post"));
  const fresh = keyboardMessage();
  check("qayta yozilgan post ham rasm + izoh", fresh.method === "sendPhoto" && fresh.payload.photo === "soxta_file_id");
  check("qayta yozishda rasm qayta yuklanmadi", !sent.some((c) => c.method === "sendPhoto" && c.payload.bytes));

  // Kanalga ham rasm + izoh
  await post(memberUpdate(862, KANAL, "administrator", { can_post_messages: true }));
  sent.length = 0;
  await post(press(863, `post:pub:${id}`, fresh.result.message_id));
  await waitFor(() => allText().includes("is live"));
  check("kanalga qayta yozilgan post rasm izohida chiqdi", toChannel("sendPhoto")[0]?.payload.caption === "Qayta yozilgan qisqa post.");
}

// --- Hech sig'madi: post yo'qolmaydi, rasm va matn alohida ketadi ---
{
  const LONG = "Juda uzun post. ".repeat(80);
  aiQueue = [
    aiBody([{ type: "text", text: "Material." }]),
    koverUse("kv_u2"),
    aiBody([{ type: "text", text: LONG }]),
    aiBody([{ type: "text", text: LONG }]),
    aiBody([{ type: "text", text: LONG }]),
  ];
  // iz + (yozuvchi + uzun) x3 + kover + ogohlantirish + post = 10
  await postCommand(message(870, "/post sig'madi"), 10);
  await waitFor(() => keyboardMessage());

  check("sig'maganda muharrir umuman chaqirilmadi", !aiRequests.some((r) => systemText(r).includes("you are the editor")));
  check("sig'magani aytildi", allText().includes("didn't fit into 1000"));
  check("sig'maganda rasm izohsiz ketdi", sent.some((c) => c.method === "sendPhoto" && !c.failed && !c.payload.caption));
  check("sig'maganda matn tugmalar bilan ketdi", keyboardMessage()?.method === "sendMessage" && keyboardText().includes("Juda uzun post"));
  check("\"muharrir rozi bo'lmadi\" deyilmadi", !allText().includes("editor still said no"));
}

// --- Buzuq HTML izohi: formatlashsiz qayta yuboriladi ---
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_u3"),
  aiBody([{ type: "text", text: "<buzuq>teg yopilmagan post" }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(875, "/post buzuq html"), 5);
await waitFor(() => sent.some((c) => c.method === "sendPhoto" && !c.failed && c.payload.caption));
check("buzuq HTML izoh avval rad etildi", sent.some((c) => c.method === "sendPhoto" && c.failed));
check(
  "buzuq HTML izoh formatlashsiz yetkazildi",
  sent.some((c) => c.method === "sendPhoto" && !c.failed && c.payload.caption?.includes("teg yopilmagan") && !c.payload.parse_mode),
);

// --- Gemini billing yoqilmagan: "limit" emas, aniq sabab ---
koverResponse = { status: 429, billing: true };
aiQueue = [
  aiBody([{ type: "text", text: "Material." }]),
  koverUse("kv_u4"),
  aiBody([{ type: "text", text: "Billingsiz post." }]),
  aiBody([{ type: "text", text: "O'TDI" }]),
];
await postCommand(message(876, "/post billing"), 5);
check("billing yoqilmagani aytildi", allText().includes("billing for images isn't enabled"));
check("billingda ham post rasm bilan yetkazildi", lastPhoto()?.caption === "Billingsiz post." && lastPhoto()?.isPng === true);
koverResponse = { status: 200, kind: "png" };

// --- Izoh uzunligi Telegram kabi sanaladi ---
{
  const tgUrl = pathToFileURL(path.join(PROJECT_ROOT, "telegram.js")).href;
  const r = childJson(
    `const tg = await import(${JSON.stringify(tgUrl)});` +
      `console.log(JSON.stringify({ a: tg.captionLength("<b>ab</b> &lt; <a href=\\"https://x.uz\\">c</a>"), b: tg.captionLength("😀") }));`,
    {},
  );
  check("izoh uzunligida teglar sanalmadi", r.a === 6, JSON.stringify(r));
  check("smaylik ikki birlik sanaldi", r.b === 2);
}

// --- Bot kanaldan chiqarildi: kanal uziladi, tugmalar chiqmaydi ---
sent.length = 0;
await post(memberUpdate(850, KANAL, "left"));
check("kanal uzilgani aytildi", lastText().includes("removed from"));
check("kanal diskdan o'chdi", !kanallarFile()["555"]);

aiQueue = simpleQueue("Uzilgandan keyingi post.");
await postCommand(message(851, "/post uzildi"), 4);
check("uzilgandan keyin ham tugmalar chiqdi", keyboardText().includes("Uzilgandan keyingi post"));

// --- ADMIN_IDS va havola — alohida jarayonda ---
{
  const kanalUrl = pathToFileURL(path.join(PROJECT_ROOT, "kanallar.js")).href;
  const script =
    `const k = await import(${JSON.stringify(kanalUrl)});` +
    `console.log(JSON.stringify({ admin: k.ruxsat(111), begona: k.ruxsat(555),` +
    ` yopiq: k.havola({ id: -1009876, username: "" }, 5), ochiq: k.havola({ id: -1001, username: "abc" }, 7) }));`;
  const extraDir = fs.mkdtempSync(path.join(DATA_DIR, "admin-"));

  const r = childJson(script, { ADMIN_IDS: "111, 222", DATA_DIR: extraDir });
  check("ADMIN_IDS dagi odamga ruxsat", r.admin === true, JSON.stringify(r));
  check("ADMIN_IDS da yo'q odamga ruxsat yo'q", r.begona === false);
  check("yopiq kanal havolasi", r.yopiq === "https://t.me/c/9876/5", `(${r.yopiq})`);
  check("ochiq kanal havolasi", r.ochiq === "https://t.me/abc/7", `(${r.ochiq})`);

  const bad = childJson(script, { ADMIN_IDS: "ali,222", DATA_DIR: extraDir });
  check("noto'g'ri ADMIN_IDS ushlandi", String(bad.xato ?? "").includes("ADMIN_IDS"));
}

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
koverApi.close();
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
