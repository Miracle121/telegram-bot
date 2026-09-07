# Telegram Bot

Webhook orqali ishlaydigan Telegram bot — Claude bilan quvvatlangan ish yordamchisi.
Foydalanuvchi til tanlaydi (o'zbek / rus / ingliz), so'ng oddiy tilda yozadi: kun rejasi,
mijozlar fikrini tahlil qilish, matnni qisqartirish, xat yozish, qaror qabul qilishda
yordam. Suhbat eslab qolinadi, `/new` bilan noldan boshlanadi.

## Fayl tuzilishi

```
bot.js                 kirish nuqtasi — server, webhook, xabarlarni qayta ishlash
ai.js                  Claude qatlami — tizim ko'rsatmasi, so'rov, xatolarni tarjima qilish
config.js              .env o'qish va tekshirish (xato bo'lsa ishga tushmaydi)
telegram.js            Bot API klienti — timeout, qayta urinish, 429, uzun matnni bo'lish
i18n.js                uz / ru / en matnlari va til tanlash klaviaturasi
store.js               foydalanuvchi tili (data/users.json) + suhbat tarixi (xotirada)
scripts/webhook.js     webhookni o'rnatish / ko'rish / o'chirish
scripts/secret.js      WEBHOOK_SECRET generatori
scripts/ai-test.js     AI kalitini tekshirish — Telegram'siz bitta so'rov
scripts/smoke-test.js  uchdan-uchgacha sinov (soxta Telegram va Claude API bilan)
deploy/                systemd unit va nginx konfigi
.github/workflows/     GitHub Actions — main ga push da avtomatik deploy
```

## Buyruqlar

| Buyruq | Vazifasi |
|---|---|
| `npm start` | Botni ishga tushirish |
| `npm run dev` | Fayl o'zgarganda avtomatik qayta ishga tushish |
| `npm test` | Uchdan-uchgacha sinov (token va internet kerak emas) |
| `npm run webhook:set` | Webhookni Telegram'da ro'yxatdan o'tkazish |
| `npm run webhook:info` | Webhook holati va oxirgi xato |
| `npm run webhook:delete` | Webhookni o'chirish |
| `npm run secret` | Yangi `WEBHOOK_SECRET` generatsiya qilish |
| `npm run ai:test "savol"` | AI kaliti ishlayotganini tekshirish |

## Lokal ishga tushirish

```bash
npm install
```

`.env` faylini to'ldiring — `TELEGRAM_BOT_TOKEN` ni [@BotFather](https://t.me/BotFather)
dan oling (`/newbot`). `WEBHOOK_SECRET` allaqachon generatsiya qilingan.
`ANTHROPIC_API_KEY` ni [console.anthropic.com](https://console.anthropic.com/settings/keys)
dan oling — busiz bot ishlaydi, lekin AI javob bermaydi.

`PUBLIC_URL` bo'sh bo'lsa bot ishga tushadi, lekin webhook o'rnatilmaydi — bu normal:
webhook uchun public HTTPS domen kerak, ya'ni serverga chiqarilgandan keyin ishlaydi.

```bash
npm start
```

Server ko'tarilganini tekshirish: <http://localhost:3000/health>

### Sinov

```bash
npm test
```

Sinov soxta Telegram va Claude API'larini ko'taradi va botga haqiqiy webhook so'rovlarini
yuboradi: maxfiy kalit tekshiruvi, til tanlash, AI javobi, suhbat tarixi, `/new`, uzun
javobning bo'linishi, AI xatosi, takroriy update va tilning diskka yozilishi tekshiriladi.
Haqiqiy token ham, AI kaliti ham, internet ham kerak emas.

AI kaliti haqiqatan ishlayotganini tekshirish (internet kerak, pul sarflanadi):

```bash
npm run ai:test "bir jumlada o'zingni tanishtir"
```

## Serverga chiqarish (VPS + nginx + systemd)

### 1. Serverni tayyorlash

```bash
# Node.js 22 (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx git

# Bot uchun alohida foydalanuvchi — root ostida ishlatmaymiz
sudo useradd --system --create-home --shell /bin/bash botuser
sudo mkdir -p /opt/telegram-bot
sudo chown botuser:botuser /opt/telegram-bot
```

### 2. Kodni joylashtirish

```bash
sudo -u botuser git clone https://github.com/<user>/<repo>.git /opt/telegram-bot
cd /opt/telegram-bot
sudo -u botuser npm ci --omit=dev
```

### 3. `.env` yaratish

```bash
sudo -u botuser cp .env.example .env
sudo -u botuser nano .env
sudo chmod 600 .env      # tokenni faqat botuser o'qiy olsin
```

Server uchun qiymatlar:

```
TELEGRAM_BOT_TOKEN=<BotFather token>
WEBHOOK_SECRET=<lokal .env dagi bilan bir xil bo'lishi shart emas, lekin bitta bo'lsin>
PUBLIC_URL=https://bot.example.com
PORT=3000
NODE_ENV=production
ANTHROPIC_API_KEY=<console.anthropic.com dan olingan kalit>
```

### 4. nginx va HTTPS

Domenning A-yozuvi server IP'siga qaratilgan bo'lishi kerak.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/telegram-bot
sudo sed -i 's/bot.example.com/<domeningiz>/' /etc/nginx/sites-available/telegram-bot
sudo ln -sf /etc/nginx/sites-available/telegram-bot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domeningiz>
```

Konfig ataylab faqat 80-port bilan keladi — sertifikat yo'q paytda `listen 443 ssl`
yozilsa nginx ishga tushmaydi. HTTPS blokini va yo'naltirishni certbot o'zi qo'shadi.

### 5. systemd xizmati

```bash
sudo cp deploy/telegram-bot.service /etc/systemd/system/
which node    # yo'l /usr/bin/node dan farq qilsa, unit faylida to'g'rilang
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-bot
sudo systemctl status telegram-bot
```

Loglar: `journalctl -u telegram-bot -f`

### 6. Webhookni tekshirish

Bot ishga tushganda `PUBLIC_URL` bo'lsa webhookni o'zi o'rnatadi. Tekshirish:

```bash
sudo -u botuser npm run webhook:info --prefix /opt/telegram-bot
```

`Kutayotgan update: 0` va xatolar yo'q bo'lsa — botga Telegram'da yozib ko'ring.

### 7. Avtomatik deploy (GitHub Actions)

`main` ga push bo'lganda `.github/workflows/deploy.yml` serverga kiradi, kodni yangilaydi
va xizmatni qayta ishga tushiradi. Repo sozlamalarida
**Settings → Secrets and variables → Actions** bo'limiga qo'shing:

| Secret | Qiymat |
|---|---|
| `VPS_HOST` | server IP yoki domeni |
| `VPS_USER` | SSH foydalanuvchisi (masalan `deploy` yoki `botuser`) |
| `VPS_SSH_KEY` | maxfiy SSH kalit (to'liq matn, `-----BEGIN ...` bilan birga) |
| `VPS_PORT` | SSH porti, 22 dan farq qilsa |

SSH kalit juftligini yaratish:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/gh_deploy -N ""
ssh-copy-id -i ~/.ssh/gh_deploy.pub <user>@<server>
cat ~/.ssh/gh_deploy        # shu matnni VPS_SSH_KEY ga qo'ying
```

Deploy foydalanuvchisi parolsiz `restart` qila olishi uchun:

```bash
echo '<user> ALL=(ALL) NOPASSWD: /bin/systemctl restart telegram-bot, /bin/systemctl is-active telegram-bot' \
  | sudo tee /etc/sudoers.d/telegram-bot
```

## Nosozliklarni bartaraf qilish

| Belgi | Sabab va yechim |
|---|---|
| `Konfiguratsiya xatosi` | `.env` da token yoki secret yo'q / noto'g'ri formatda |
| `Telegram API bilan bog'lanib bo'lmadi` | Token noto'g'ri yoki serverda internet yo'q |
| Bot javob bermaydi | `npm run webhook:info` — `last_error_message` ni o'qing |
| `webhook_info` da `SSL error` | Sertifikat to'liq emas: `sudo certbot --nginx` ni qayta ishga tushiring |
| 401 loglarda | Begona so'rov — normal, e'tibor bermang |
| «AI hali sozlanmagan» javobi | `.env` da `ANTHROPIC_API_KEY` yo'q — qo'shing va xizmatni restart qiling |
| «AI kaliti ishlamayapti» | Kalit noto'g'ri yoki bekor qilingan: `npm run ai:test` bilan tekshiring |

## Keyingi qadam

Taqdimot va hujjat fayllarini tayyorlash (`.pptx`, `.xlsx`, `.docx`) hamda veb qidiruv —
ikkalasi ham `ai.js` ga `tools` qo'shish bilan ochiladi, qolgan qatlamlarga tegilmaydi.
