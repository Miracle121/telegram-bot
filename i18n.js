// Matnlar va til bilan ishlash.
// Yangi til qo'shish uchun LOCALES ga yangi kalit qo'shish yetarli.

import { config } from "./config.js";

// /help dagi qidiruv haqidagi qator faqat qidiruv yoqilgan bo'lsa ko'rinadi:
// AI_WEB_SEARCH=off bo'lganda bot qila olmaydigan ishni va'da qilmasin.
const searchLine = (text) => (config.ai.webSearch ? text : "");

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
      searchLine("Kerak bo'lganda internetdan qidirib topaman — narxlar, yangiliklar, " +
        "raqobatchilar. Manbani havola bilan ko'rsataman.\n\n") +
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
      searchLine("Когда нужно, ищу в интернете — цены, новости, конкуренты. " +
        "Источник указываю ссылкой.\n\n") +
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
      searchLine("When it helps, I'll search the web — prices, news, competitors. " +
        "I'll link the source.\n\n") +
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

/** Til tanlash uchun inline klaviatura. */
export function languageKeyboard() {
  return {
    inline_keyboard: Object.entries(LANGUAGES).map(([code, { flag, label }]) => [
      { text: `${flag} ${label}`, callback_data: `lang:${code}` },
    ]),
  };
}

/** Til hali tanlanmaganda ko'rsatiladigan uch tilli so'rov. */
export function chooseLanguagePrompt() {
  return Object.keys(LANGUAGES)
    .map((code) => t(code, "chooseLanguage"))
    .join("\n");
}
