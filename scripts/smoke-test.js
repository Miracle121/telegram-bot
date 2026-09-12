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

const api = http.createServer((req, res) => {
  // Bayt sifatida yig'amiz: sendPhoto multipart yuboradi, uni satrga aylantirsak buziladi.
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const method = req.url.split("/").pop();

    const payload = method === "sendPhoto"
      ? { bytes: raw.length, isPng: raw.includes(PNG_SIGNATURE) }
      : (raw.length > 0 ? JSON.parse(raw.toString()) : {});
    sent.push({ method, payload });

    const results = {
      getMe: { id: 1, is_bot: true, username: "smoke_test_bot" },
      sendMessage: { message_id: sent.length },
      sendPhoto: { message_id: sent.length },
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

// Navbat: qidiruv va pause_turn kabi murakkab holatlar uchun to'liq javob tanasini
// oldindan qo'yib ketamiz. Bo'sh bo'lsa oddiy `aiResponse` ishlatiladi.
let aiQueue = [];

/** Soxta Claude javobi. */
const aiBody = (content, stopReason = "end_turn") => ({
  id: "msg_smoke",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
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

// 1x1 shaffof PNG — API rostdan rasm qaytargan holatni ifodalaydi.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const koverApi = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    koverRequests.push(body ? JSON.parse(body) : {});

    if (koverResponse.status !== 200) {
      res.writeHead(koverResponse.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: koverResponse.status, message: "soxta xato" } }));
      return;
    }

    const content = koverResponse.kind === "png"
      ? [{ type: "image", mime_type: "image/png", data: PNG_1X1 }]
      : [{ type: "text", text: "bu rasm emas" }];

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
  await waitFor(() => sent.filter((c) => c.method === "sendMessage").length >= expected);
}

/** Yuborilgan hamma xabar bitta matnda — bosqich qatorlarini qidirish uchun. */
const allText = () => sent.filter((c) => c.method === "sendMessage").map((c) => c.payload.text).join("\n");

/** So'rovdagi tizim ko'rsatmasi (endi bloklar massivi) — matn bo'yicha qidirish uchun. */
const systemText = (req) => JSON.stringify(req?.system ?? "");

const lastText = () => [...sent].reverse().find((c) => c.method === "sendMessage")?.payload.text ?? "";

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
  ),
  aiBody([{ type: "text", text: "Bugungi kurs — 12 500 so'm." }]),
];
await postAi(message(56, "kursni ayting"));
check("pause_turn da so'rov qayta yuborildi", aiRequests.length === 2, `(${aiRequests.length} ta so'rov)`);
check("oraliq javob modelga qaytarildi", aiRequests[1]?.messages?.at(-1)?.role === "assistant");
check("qidiruv bloklari o'zgarmasdan qaytdi", aiRequests[1]?.messages?.at(-1)?.content?.[0]?.type === "server_tool_use");
check("pause_turn dan keyin javob yetkazildi", lastText().includes("12 500"));

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
check("kover postdan oldin ketdi", sent.findIndex((c) => c.method === "sendPhoto") < sent.length - 1);
check("post ham yetkazildi", lastText().includes("Post matni"));

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
