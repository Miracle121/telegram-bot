// Matnlar va til bilan ishlash.
// Yangi til qo'shish uchun LOCALES ga yangi kalit qo'shish yetarli.

export const LANGUAGES = {
  uz: { flag: "🇺🇿", label: "O'zbekcha" },
  ru: { flag: "🇷🇺", label: "Русский" },
  en: { flag: "🇬🇧", label: "English" },
};

export const DEFAULT_LANGUAGE = "uz";

const LOCALES = {
  uz: {
    chooseLanguage: "Tilni tanlang:",
    languageSet: "Til o'zbekchaga o'zgartirildi.",
    welcome:
      "Assalomu alaykum, <b>{name}</b>! 👋\n\n" +
      "Men sinov rejimida ishlayapman: siz yozgan matnni qaytarib yuboraman.\n\n" +
      "Buyruqlar:\n" +
      "/help — yordam\n" +
      "/lang — tilni o'zgartirish",
    help:
      "<b>Yordam</b>\n\n" +
      "Menga istalgan matn yozing — men uni qaytaraman.\n\n" +
      "/start — botni qayta ishga tushirish\n" +
      "/lang — tilni o'zgartirish\n" +
      "/help — shu xabar",
    echo: "Siz yozdingiz:\n\n<i>{text}</i>",
    onlyText: "Hozircha faqat matnli xabarlarni tushunaman.",
    unknownCommand: "Bunday buyruq yo'q. /help ni yuboring.",
    error: "Kutilmagan xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.",
  },
  ru: {
    chooseLanguage: "Выберите язык:",
    languageSet: "Язык изменён на русский.",
    welcome:
      "Здравствуйте, <b>{name}</b>! 👋\n\n" +
      "Я работаю в тестовом режиме: возвращаю текст, который вы напишете.\n\n" +
      "Команды:\n" +
      "/help — помощь\n" +
      "/lang — сменить язык",
    help:
      "<b>Помощь</b>\n\n" +
      "Напишите мне любой текст — я его верну.\n\n" +
      "/start — перезапустить бота\n" +
      "/lang — сменить язык\n" +
      "/help — это сообщение",
    echo: "Вы написали:\n\n<i>{text}</i>",
    onlyText: "Пока я понимаю только текстовые сообщения.",
    unknownCommand: "Такой команды нет. Отправьте /help.",
    error: "Произошла непредвиденная ошибка. Попробуйте позже.",
  },
  en: {
    chooseLanguage: "Choose your language:",
    languageSet: "Language changed to English.",
    welcome:
      "Hello, <b>{name}</b>! 👋\n\n" +
      "I'm running in test mode: I echo back whatever text you send.\n\n" +
      "Commands:\n" +
      "/help — help\n" +
      "/lang — change language",
    help:
      "<b>Help</b>\n\n" +
      "Send me any text and I'll send it back.\n\n" +
      "/start — restart the bot\n" +
      "/lang — change language\n" +
      "/help — this message",
    echo: "You wrote:\n\n<i>{text}</i>",
    onlyText: "For now I only understand text messages.",
    unknownCommand: "Unknown command. Send /help.",
    error: "Something went wrong. Please try again later.",
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
