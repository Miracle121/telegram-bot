// Matnlar va til bilan ishlash.
// Yangi til qo'shish uchun LOCALES ga yangi kalit qo'shish yetarli.

import * as bilim from "./bilim.js";
import { config } from "./config.js";

// /help dagi qidiruv haqidagi qator faqat qidiruv yoqilgan bo'lsa ko'rinadi:
// AI_WEB_SEARCH=off bo'lganda bot qila olmaydigan ishni va'da qilmasin.
const searchLine = (text) => (config.ai.webSearch ? text : "");

// Xuddi shu qoida bilim bazasiga ham tegishli: baza bo'sh bo'lsa vosita e'lon
// qilinmaydi, demak /help da ham va'da qilinmasin.
const bilimLine = (text) => (config.ai.enabled && bilim.stats().chunks > 0 ? text : "");

export const LANGUAGES = {
  uz: { flag: "🇺🇿", label: "O'zbekcha" },
  ru: { flag: "🇷🇺", label: "Русский" },
  en: { flag: "🇬🇧", label: "English" },
};

// Modelga "javobni qaysi tilda yoz" deb aytish uchun. Ko'rsatma ingliz tilida bo'lgani
// sababli til nomlari ham shu yerda inglizcha turadi.
export const LANGUAGE_NAMES = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

export const DEFAULT_LANGUAGE = "uz";

const LOCALES = {
  uz: {
    chooseLanguage: "Tilni tanlang:",
    languageSet: "Til o'zbekchaga o'zgartirildi.",
    welcome:
      "Assalomu alaykum, <b>{name}</b>! 👋\n\n" +
      "Men sizning ish yordamchingizman. Menga oddiy tilda yozing:\n\n" +
      "• kuningiz yoki haftangizni rejalashtirib beray\n" +
      "• mijozlar fikrini tashlang — tahlil qilib xulosa chiqaray\n" +
      "• uzun matnni qisqartiray yoki xat/taklif yozib beray\n" +
      "• qaror qabul qilishda variantlarni taroziga solay\n\n" +
      "Suhbatni eslab qolaman. Yangisini boshlash uchun /new.\n" +
      "Boshqa buyruqlar: /help",
    help:
      "<b>Yordam</b>\n\n" +
      "Shunchaki savolingizni yoki vazifangizni yozing — javob beraman. " +
      "Oldingi xabarlaringizni eslab turaman, shuning uchun «buni qisqartir» deb " +
      "davom ettirsangiz ham tushunaman.\n\n" +
      bilimLine("Sizning bilim bazangizdan qidira olaman — xizmatlar, narxlar, ish " +
        "tartibi. Fayllar <code>bilim/</code> papkasida turadi.\n\n") +
      searchLine("Kerak bo'lganda internetdan qidirib topaman — narxlar, yangiliklar, " +
        "raqobatchilar. Manbani havola bilan ko'rsataman.\n\n") +
      "/post [mavzu] — mavzu bo'yicha post yozib beraman. Botni kanalingizga admin " +
      "qilib qo'shsangiz, post tagida «Kanalga chop etish» tugmasi chiqadi\n" +
      "/new — suhbatni noldan boshlash\n" +
      "/lang — tilni o'zgartirish\n" +
      "/start — tanishtiruv xabari\n" +
      "/help — shu xabar",
    historyCleared: "Suhbat tozalandi. Yangi mavzuni boshlashimiz mumkin.",
    onlyText: "Hozircha faqat matnli xabarlarni tushunaman.",
    unknownCommand: "Bunday buyruq yo'q. /help ni yuboring.",
    error: "Kutilmagan xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.",
    aiBusy: "Oldingi savolingiz ustida ishlayapman — bir lahza kuting.",
    aiDisabled: "AI hali sozlanmagan (kalit qo'yilmagan). Boshqa buyruqlar ishlayveradi.",
    aiAuth: "AI kaliti ishlamayapti. Iltimos, bot egasiga xabar bering.",
    aiRateLimit: "So'rovlar juda ko'p bo'lib ketdi. Bir daqiqadan so'ng qayta urinib ko'ring.",
    aiTimeout: "Javob juda uzoq davom etdi. Savolni qisqaroq qilib qayta yuboring.",
    aiRefused: "Bu savolga javob bera olmayman. Boshqacharoq so'rab ko'ring.",
    aiEmpty: "Javob bo'sh chiqdi. Savolni boshqacha ifodalab ko'ring.",
    aiUnknown: "AI bilan bog'lanishda muammo bo'ldi. Birozdan so'ng qayta urinib ko'ring.",
    aiTruncated: "\n\n<i>(javob uzun bo'lgani uchun kesildi — davomini so'rang)</i>",
    postUsage: "Mavzuni ham yozing. Masalan: <code>/post narxlar</code>",
    postTraceTitle: "🔎 <b>Vosita ishladi</b>",
    postTraceBilim: "• bilim bazasi: «{query}» → {chunks} parcha{files}",
    postTraceBilimError: "• bilim bazasi: «{query}» → xato: {error}",
    postTraceWeb: "• internet qidiruvi: {count} marta",
    postTraceNone: "• hech qanday vosita chaqirilmadi — model o'zi javob berdi",
    postStageWriter: "✍️ <b>Yozuvchi</b> yozdi",
    postStageRewrite: "✍️ <b>Yozuvchi</b> qayta yozdi ({round}/{max})",
    postStageKoverApi: "🖼 <b>Kover:</b> rasm yasaldi",
    postStageKoverTemplate: "🖼 <b>Kover:</b> shablon — {sabab}",
    koverKalitYoq: "rasm kaliti qo'yilmagan",
    koverKalitIshlamadi: "rasm kaliti ishlamadi",
    koverLimit: "limit tugagan",
    koverRad: "so'rov rad etildi",
    koverJavobYoq: "xizmat javob bermadi",
    koverBuzuq: "javob tushunarsiz",
    postStageEditorPass: "📝 <b>Muharrir:</b> o'tdi ✅",
    postStageEditorFail: "📝 <b>Muharrir:</b> qayta yoz\n{reasons}",
    postStageEditorUnclear: "📝 <b>Muharrir</b> javobini tushunmadim — post shundayligicha qoldi",
    postNoReason: "• sabab aytilmadi",
    postLimitReached: "⚠️ <i>{max} marta qayta yozildi, muharrir baribir rozi bo'lmadi. Oxirgi variant:</i>",
    postAgentMissing:
      "Xarakter fayli o'qilmadi: <code>agentlar/{file}</code> — {reason}.\n" +
      "Faylni joyiga qo'yib qayta urinib ko'ring.",
    btnPublish: "📢 Kanalga chop etish",
    btnRewrite: "🔄 Qayta yozish",
    btnCancel: "❌ Bekor qilish",
    postPublishing: "Kanalga yuborilmoqda…",
    postPublished: "✅ Post <b>{title}</b> kanaliga chiqdi.{link}",
    postOpenLink: "Postni ochish",
    postPublishFailed:
      "⚠️ Kanalga chiqarib bo'lmadi: <code>{reason}</code>\n" +
      "Bot kanalda admin va «Post joylash» huquqi borligini tekshiring. Tugmalar joyida qoldi.",
    postCancelled: "❌ Bekor qilindi — post kanalga chiqarilmadi.",
    postExpired: "Bu post eskirgan (24 soat o'tgan yoki bot qayta ishga tushgan). /post ni qaytadan yozing.",
    postNotYours: "Bu tugma sizning postingiz uchun emas.",
    postInProgress: "Bu post ustida ish ketyapti — bir lahza.",
    postNoChannel:
      "📢 <b>Kanal hali ulanmagan.</b> Ulash uchun:\n" +
      "1. Kanal sozlamalari → <b>Administratorlar</b> → <b>Admin qo'shish</b>\n" +
      "2. Shu botni tanlang va <b>«Post joylash»</b> huquqini yoqing\n" +
      "3. «✅ kanal ulandi» xabarini kuting\n\n" +
      "Keyin shu post tagidagi «Kanalga chop etish» tugmasini qayta bosing.",
    postRewriteStart: "🔄 Qayta yozilmoqda ({round}/{max})…",
    postRewriteLimit: "Bu post {max} marta qayta yozildi. Boshqacha natija kerak bo'lsa, yangi /post bilan boshlang.",
    kanalUlandi:
      "✅ <b>{title}</b> kanali ulandi.\n" +
      "Endi /post natijasi tagida «Kanalga chop etish» tugmasi chiqadi.",
    kanalHuquqYoq:
      "⚠️ Bot <b>{title}</b> kanalida admin, lekin «Post joylash» huquqi yo'q. " +
      "Shu huquqni bering — kanal o'zi ulanadi.",
    kanalUzildi: "Bot <b>{title}</b> kanalidan chiqarildi — kanal uzildi.",
    kanalRuxsatYoq: "Bu botda kanal ulash faqat bot egasi uchun yoqilgan.",
  },
  ru: {
    chooseLanguage: "Выберите язык:",
    languageSet: "Язык изменён на русский.",
    welcome:
      "Здравствуйте, <b>{name}</b>! 👋\n\n" +
      "Я ваш рабочий помощник. Пишите мне обычным языком:\n\n" +
      "• составлю план дня или недели\n" +
      "• пришлите отзывы клиентов — разберу и сделаю выводы\n" +
      "• сокращу длинный текст, напишу письмо или предложение\n" +
      "• взвешу варианты при принятии решения\n\n" +
      "Я помню разговор. Чтобы начать заново — /new.\n" +
      "Другие команды: /help",
    help:
      "<b>Помощь</b>\n\n" +
      "Просто напишите вопрос или задачу — я отвечу. " +
      "Я помню предыдущие сообщения, поэтому можно продолжать: «сократи это».\n\n" +
      bilimLine("Могу искать в вашей базе знаний — услуги, цены, порядок работы. " +
        "Файлы лежат в папке <code>bilim/</code>.\n\n") +
      searchLine("Когда нужно, ищу в интернете — цены, новости, конкуренты. " +
        "Источник указываю ссылкой.\n\n") +
      "/post [тема] — напишу пост по теме. Добавьте бота админом в свой канал — " +
      "под постом появится кнопка «Опубликовать в канал»\n" +
      "/new — начать разговор заново\n" +
      "/lang — сменить язык\n" +
      "/start — приветственное сообщение\n" +
      "/help — это сообщение",
    historyCleared: "Разговор очищен. Можем начать новую тему.",
    onlyText: "Пока я понимаю только текстовые сообщения.",
    unknownCommand: "Такой команды нет. Отправьте /help.",
    error: "Произошла непредвиденная ошибка. Попробуйте позже.",
    aiBusy: "Я ещё работаю над предыдущим вопросом — подождите немного.",
    aiDisabled: "ИИ пока не настроен (нет ключа). Остальные команды работают.",
    aiAuth: "Ключ ИИ не работает. Пожалуйста, сообщите владельцу бота.",
    aiRateLimit: "Слишком много запросов. Попробуйте через минуту.",
    aiTimeout: "Ответ занял слишком много времени. Задайте вопрос короче.",
    aiRefused: "На этот вопрос я ответить не могу. Попробуйте сформулировать иначе.",
    aiEmpty: "Ответ получился пустым. Попробуйте переформулировать вопрос.",
    aiUnknown: "Не удалось связаться с ИИ. Попробуйте чуть позже.",
    aiTruncated: "\n\n<i>(ответ обрезан из-за длины — попросите продолжение)</i>",
    postUsage: "Укажите тему. Например: <code>/post цены</code>",
    postTraceTitle: "🔎 <b>Инструмент сработал</b>",
    postTraceBilim: "• база знаний: «{query}» → фрагментов: {chunks}{files}",
    postTraceBilimError: "• база знаний: «{query}» → ошибка: {error}",
    postTraceWeb: "• поиск в интернете: {count} раз",
    postTraceNone: "• инструмент не вызывался — модель ответила сама",
    postStageWriter: "✍️ <b>Автор</b> написал",
    postStageRewrite: "✍️ <b>Автор</b> переписал ({round}/{max})",
    postStageKoverApi: "🖼 <b>Обложка:</b> картинка сгенерирована",
    postStageKoverTemplate: "🖼 <b>Обложка:</b> шаблон — {sabab}",
    koverKalitYoq: "ключ для картинок не задан",
    koverKalitIshlamadi: "ключ не работает",
    koverLimit: "лимит исчерпан",
    koverRad: "запрос отклонён",
    koverJavobYoq: "сервис не ответил",
    koverBuzuq: "непонятный ответ",
    postStageEditorPass: "📝 <b>Редактор:</b> принято ✅",
    postStageEditorFail: "📝 <b>Редактор:</b> переписать\n{reasons}",
    postStageEditorUnclear: "📝 <b>Ответ редактора</b> непонятен — пост оставлен как есть",
    postNoReason: "• причина не названа",
    postLimitReached: "⚠️ <i>Переписано {max} раза, редактор всё равно не принял. Последний вариант:</i>",
    postAgentMissing:
      "Не удалось прочитать файл характера: <code>agentlar/{file}</code> — {reason}.\n" +
      "Положите файл на место и попробуйте снова.",
    btnPublish: "📢 Опубликовать в канал",
    btnRewrite: "🔄 Переписать",
    btnCancel: "❌ Отменить",
    postPublishing: "Отправляю в канал…",
    postPublished: "✅ Пост опубликован в канале <b>{title}</b>.{link}",
    postOpenLink: "Открыть пост",
    postPublishFailed:
      "⚠️ Не удалось опубликовать: <code>{reason}</code>\n" +
      "Проверьте, что бот — админ канала с правом «Публикация сообщений». Кнопки остались на месте.",
    postCancelled: "❌ Отменено — пост в канал не отправлен.",
    postExpired: "Этот пост устарел (прошло 24 часа или бот перезапускался). Отправьте /post заново.",
    postNotYours: "Эта кнопка не для вашего поста.",
    postInProgress: "Над этим постом уже идёт работа — секунду.",
    postNoChannel:
      "📢 <b>Канал ещё не подключён.</b> Чтобы подключить:\n" +
      "1. Настройки канала → <b>Администраторы</b> → <b>Добавить администратора</b>\n" +
      "2. Выберите этого бота и включите право <b>«Публикация сообщений»</b>\n" +
      "3. Дождитесь сообщения «✅ канал подключён»\n\n" +
      "Затем снова нажмите «Опубликовать в канал» под этим постом.",
    postRewriteStart: "🔄 Переписываю ({round}/{max})…",
    postRewriteLimit: "Этот пост переписан {max} раза. Нужен другой результат — начните новый /post.",
    kanalUlandi:
      "✅ Канал <b>{title}</b> подключён.\n" +
      "Теперь под результатом /post появится кнопка «Опубликовать в канал».",
    kanalHuquqYoq:
      "⚠️ Бот — админ канала <b>{title}</b>, но без права «Публикация сообщений». " +
      "Дайте это право — канал подключится сам.",
    kanalUzildi: "Бот удалён из канала <b>{title}</b> — канал отключён.",
    kanalRuxsatYoq: "В этом боте подключать канал может только владелец.",
  },
  en: {
    chooseLanguage: "Choose your language:",
    languageSet: "Language changed to English.",
    welcome:
      "Hello, <b>{name}</b>! 👋\n\n" +
      "I'm your work assistant. Just write to me in plain language:\n\n" +
      "• I'll plan your day or your week\n" +
      "• send me customer feedback — I'll analyse it and draw conclusions\n" +
      "• I'll shorten long texts, draft emails or proposals\n" +
      "• I'll weigh the options when you need to decide\n\n" +
      "I remember our conversation. To start fresh, send /new.\n" +
      "Other commands: /help",
    help:
      "<b>Help</b>\n\n" +
      "Just write your question or task and I'll answer. " +
      "I remember earlier messages, so you can follow up with «make it shorter».\n\n" +
      bilimLine("I can search your own knowledge base — services, prices, how you work. " +
        "The files live in the <code>bilim/</code> folder.\n\n") +
      searchLine("When it helps, I'll search the web — prices, news, competitors. " +
        "I'll link the source.\n\n") +
      "/post [topic] — I'll write a post on a topic. Add the bot to your channel as an " +
      "admin and a «Publish to channel» button appears under the post\n" +
      "/new — start a fresh conversation\n" +
      "/lang — change language\n" +
      "/start — the intro message\n" +
      "/help — this message",
    historyCleared: "Conversation cleared. We can start a new topic.",
    onlyText: "For now I only understand text messages.",
    unknownCommand: "Unknown command. Send /help.",
    error: "Something went wrong. Please try again later.",
    aiBusy: "I'm still working on your previous question — one moment.",
    aiDisabled: "AI is not configured yet (no key). The other commands still work.",
    aiAuth: "The AI key isn't working. Please tell the bot owner.",
    aiRateLimit: "Too many requests right now. Please try again in a minute.",
    aiTimeout: "That took too long. Try sending a shorter question.",
    aiRefused: "I can't answer that one. Try asking it differently.",
    aiEmpty: "The answer came back empty. Try rephrasing the question.",
    aiUnknown: "Couldn't reach the AI. Please try again shortly.",
    aiTruncated: "\n\n<i>(answer cut off — ask me to continue)</i>",
    postUsage: "Add a topic too. For example: <code>/post prices</code>",
    postTraceTitle: "🔎 <b>The tool ran</b>",
    postTraceBilim: "• knowledge base: «{query}» → {chunks} passages{files}",
    postTraceBilimError: "• knowledge base: «{query}» → error: {error}",
    postTraceWeb: "• web search: {count} times",
    postTraceNone: "• no tool was called — the model answered on its own",
    postStageWriter: "✍️ <b>The writer</b> wrote it",
    postStageRewrite: "✍️ <b>The writer</b> rewrote it ({round}/{max})",
    postStageKoverApi: "🖼 <b>Cover:</b> image generated",
    postStageKoverTemplate: "🖼 <b>Cover:</b> template — {sabab}",
    koverKalitYoq: "no image key configured",
    koverKalitIshlamadi: "the key didn't work",
    koverLimit: "quota spent",
    koverRad: "the request was refused",
    koverJavobYoq: "the service didn't answer",
    koverBuzuq: "the answer made no sense",
    postStageEditorPass: "📝 <b>The editor:</b> passed ✅",
    postStageEditorFail: "📝 <b>The editor:</b> rewrite\n{reasons}",
    postStageEditorUnclear: "📝 <b>The editor's answer</b> made no sense — the post is left as it is",
    postNoReason: "• no reason given",
    postLimitReached: "⚠️ <i>Rewritten {max} times and the editor still said no. The last version:</i>",
    postAgentMissing:
      "Couldn't read the character file: <code>agentlar/{file}</code> — {reason}.\n" +
      "Put the file back and try again.",
    btnPublish: "📢 Publish to channel",
    btnRewrite: "🔄 Rewrite",
    btnCancel: "❌ Cancel",
    postPublishing: "Sending to the channel…",
    postPublished: "✅ The post is live in <b>{title}</b>.{link}",
    postOpenLink: "Open the post",
    postPublishFailed:
      "⚠️ Couldn't publish: <code>{reason}</code>\n" +
      "Check that the bot is a channel admin allowed to post messages. The buttons are still there.",
    postCancelled: "❌ Cancelled — the post was not published.",
    postExpired: "This post has expired (24 hours passed or the bot restarted). Send /post again.",
    postNotYours: "This button isn't for your post.",
    postInProgress: "This post is already being worked on — one moment.",
    postNoChannel:
      "📢 <b>No channel connected yet.</b> To connect one:\n" +
      "1. Channel settings → <b>Administrators</b> → <b>Add Admin</b>\n" +
      "2. Pick this bot and turn on <b>«Post Messages»</b>\n" +
      "3. Wait for the «✅ channel connected» message\n\n" +
      "Then press «Publish to channel» under this post again.",
    postRewriteStart: "🔄 Rewriting ({round}/{max})…",
    postRewriteLimit: "This post was rewritten {max} times. For something different, start a new /post.",
    kanalUlandi:
      "✅ Channel <b>{title}</b> connected.\n" +
      "From now on a «Publish to channel» button appears under each /post result.",
    kanalHuquqYoq:
      "⚠️ The bot is an admin of <b>{title}</b> but isn't allowed to post messages. " +
      "Grant that right and the channel connects by itself.",
    kanalUzildi: "The bot was removed from <b>{title}</b> — the channel is disconnected.",
    kanalRuxsatYoq: "In this bot only the owner can connect a channel.",
  },
};

export function isSupported(language) {
  return Object.hasOwn(LANGUAGES, language);
}

/** Telegram bergan language_code asosida boshlang'ich tilni taxmin qiladi. */
export function detectLanguage(languageCode) {
  const code = (languageCode ?? "").slice(0, 2).toLowerCase();
  return isSupported(code) ? code : DEFAULT_LANGUAGE;
}

/** Tarjima matnini oladi va {kalit} o'rniga qiymat qo'yadi. */
export function t(language, key, vars = {}) {
  const locale = LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
  const template = locale[key] ?? LOCALES[DEFAULT_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/** AiError kodini foydalanuvchiga ko'rsatiladigan matnga aylantiradi. */
export function aiErrorText(language, code) {
  const key = `ai${code.charAt(0).toUpperCase()}${code.slice(1)}`;
  const locale = LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
  return Object.hasOwn(locale, key) ? t(language, key) : t(language, "aiUnknown");
}

/** Kover sababini (`kover.js` dagi kod) foydalanuvchi matniga aylantiradi. */
export function koverReasonText(language, code) {
  const key = `kover${String(code ?? "").charAt(0).toUpperCase()}${String(code ?? "").slice(1)}`;
  const locale = LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
  return Object.hasOwn(locale, key) ? t(language, key) : t(language, "koverJavobYoq");
}

/** Til tanlash uchun inline klaviatura. */
export function languageKeyboard() {
  return {
    inline_keyboard: Object.entries(LANGUAGES).map(([code, { flag, label }]) => [
      { text: `${flag} ${label}`, callback_data: `lang:${code}` },
    ]),
  };
}

/**
 * Post tagidagi tugmalar. `callback_data` 64 baytdan oshmasligi kerak — shuning uchun
 * postning o'zi emas, faqat qisqa ID (`postlar.js`).
 */
export function postKeyboard(language, id) {
  return {
    inline_keyboard: [
      [{ text: t(language, "btnPublish"), callback_data: `post:pub:${id}` }],
      [
        { text: t(language, "btnRewrite"), callback_data: `post:re:${id}` },
        { text: t(language, "btnCancel"), callback_data: `post:no:${id}` },
      ],
    ],
  };
}

/** Til hali tanlanmaganda ko'rsatiladigan uch tilli so'rov. */
export function chooseLanguagePrompt() {
  return Object.keys(LANGUAGES)
    .map((code) => t(code, "chooseLanguage"))
    .join("\n");
}
