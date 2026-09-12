# Telegram Bot

Webhook orqali ishlaydigan Telegram bot — Claude bilan quvvatlangan ish yordamchisi.
Foydalanuvchi til tanlaydi (o'zbek / rus / ingliz), so'ng oddiy tilda yozadi: kun rejasi,
mijozlar fikrini tahlil qilish, matnni qisqartirish, xat yozish, qaror qabul qilishda
yordam. Kerak bo'lganda internetdan qidirib, manbani havola bilan ko'rsatadi.
Suhbat eslab qolinadi, `/new` bilan noldan boshlanadi.

## Fayl tuzilishi

```
bot.js                 kirish nuqtasi — server, webhook, xabarlarni qayta ishlash
ai.js                  Claude qatlami — ko'rsatma, vositalar, tool-loop, xatolarni tarjima qilish
bilim.js               bilim bazasi — bilim/ dagi fayllarni o'qish va qidirish
bilim/                 bilim bazasining o'zi (.md / .txt fayllar)
agentlar.js            post oqimi — xarakter fayllarini o'qish, yozuvchi/muharrir sikli
agentlar/              agentlarning xarakter fayllari (yozuvchi.md, muharrir.md)
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

## Veb qidiruv

Model kerak bo'lganda o'zi qidiradi — narx, yangilik, raqobatchi, bozor ma'lumoti.
Qidiruv Anthropic serverida bajariladi, javob ichida natija bilan qaytadi.

```
AI_WEB_SEARCH=on           # o'chirish uchun: off
AI_WEB_SEARCH_MAX_USES=5   # bitta javobda nechta qidiruvga ruxsat
```

**Xarajat.** Qidiruv asbobining ta'rifi har bir so'rovga ~6800 token qo'shadi — qidiruv
bo'lmasa ham. Shuning uchun ko'rsatmaning o'zgarmas qismi prompt-keshga olingan: ketma-ket
kelgan so'rovlar uni 10 barobar arzon o'qiydi (kesh 5 daqiqa yashaydi). Qidiruvli javob
esa baribir qimmat — natijalar modelga kirish tokeni bo'lib qaytadi.

`npm run ai:test "savol"` javob ostida qidiruv sonini va kesh hisobini ko'rsatadi.

## Bilim bazasi

`bilim/` papkasidagi `.md` va `.txt` fayllar model uchun ochiq: savol shu biznes haqida
bo'lsa (narx, muddat, ish tartibi, kafolat) model `bilim_qidiruv` vositasini chaqiradi va
javobni o'sha fayllardan quradi.

```
BILIM_DIR=bilim          # papka yo'li
BILIM_MAX_RESULTS=4      # bitta qidiruvda nechta parcha beriladi (1-10)
```

Format va qoidalar — `bilim/README.md` da. Qisqasi:

- fayl `##` sarlavhalari bo'yicha parchalarga bo'linadi; modelga butun fayl emas, faqat
  mos kelgan parcha beriladi, shuning uchun har bo'lim o'zicha tushunarli bo'lsin
- sarlavhadagi so'z gavdadagidan uch barobar og'ir baholanadi
- ichki papkalar ham o'qiladi (3 qavatgacha), `README.md` esa indekslanmaydi
- **repo public** — bu papkaga maxfiy ma'lumot yozilmasin

Fayllarni tahrirlash uchun restart shart emas — bot `mtime` ni kuzatib, o'zgarganini
qayta o'qiydi. Faqat **birinchi** fayl qo'shilganda restart kerak: baza bo'sh bo'lsa
vosita modelga umuman e'lon qilinmaydi.

**Xarajat.** Vosita ta'rifi ~250 token (keshlanadi), har chaqiruv esa ~1200 tokengacha
natija va bitta qo'shimcha so'rov qo'shadi — ya'ni bazadan qidirish internetdan
qidirishdan o'nlab barobar arzon.

## Agentlar — `/post [mavzu]`

`/post` uchta bosqichdan o'tadi. Har bosqich alohida model chaqiruvi:

```
/post landing narxi
   │
   ├─ 1. material yig'ish   bilim_qidiruv + web_search
   ├─ 2. YOZUVCHI           agentlar/yozuvchi.md ga qarab post yozadi
   └─ 3. MUHARRIR           agentlar/muharrir.md ga qarab tekshiradi
         ├─ o'tdi      → post yuboriladi
         └─ qayta yoz  → sabab yozuvchiga qaytadi (maksimal 2 marta)
```

Foydalanuvchi oqimni ko'rib turadi — har bosqichdan keyin qisqa qator keladi:

```
🔎 Vosita ishladi
• bilim bazasi: «landing narxi» → 3 parcha — narxlar.md, xizmatlar.md
• internet qidiruvi: 1 marta
✍️ Yozuvchi yozdi
📝 Muharrir: qayta yoz
• postda "kafolat 60 kun" deyilgan, materialda 30 kun
✍️ Yozuvchi qayta yozdi (1/2)
📝 Muharrir: o'tdi ✅
```

Iz javob tarkibidan quriladi, modelning gapidan emas. `/post` suhbat tarixiga tegmaydi.

### Xarakter fayllari

| Fayl | Kim |
|---|---|
| `agentlar/yozuvchi.md` | uslub, uzunlik, oxirgi qator (savol yoki chaqiriq) |
| `agentlar/muharrir.md` | nimani tekshirish: mavzu, uydirma fakt, ohang, uzunlik |

Faylni tahrirlang va saqlang — **restart kerak emas**, keyingi `/post` yangi matn bilan
ishlaydi (`mtime` kuzatiladi). Fayl yo'q bo'lsa bot ishlayveradi, faqat `/post`
tushunarli xato beradi va model umuman chaqirilmaydi.

**Format kodda turadi.** Muharrirning javobi qat'iy: birinchi qator `O'TDI` yoki
`QAYTA YOZ`, keyin `Sabab:` qatorlari. Buni `ai.js` talab qiladi, xarakter fayli emas —
fayl egasi formatni tasodifan o'chirib qo'ysa ham sikl buzilmaydi. Javob tushunib
bo'lmasa oqim to'xtaydi va post shundayligicha ko'rsatiladi (fail-open).

```
AGENTLAR_DIR=agentlar      # papka yo'li
AGENT_MAX_REWRITES=2       # muharrir rozi bo'lmasa nechta qayta yozish (0-5)
```

**Xarajat.** Eng yaxshi holatda 3 ta chaqiruv (material + yozuvchi + muharrir), eng
yomonida 7 ta. Qidiruvli material bosqichi eng qimmati — taxminan $0.26, qolgan
bosqichlar ~$0.02 dan. `AGENT_MAX_REWRITES=0` qo'yilsa muharrir baribir tekshiradi,
lekin qayta yozish bo'lmaydi.

## Keyingi qadam

Taqdimot va hujjat fayllarini tayyorlash (`.pptx`, `.xlsx`, `.docx`) — `code_execution`
va Agent Skills orqali. Bunda `telegram.js` ga `sendDocument` qo'shilishi kerak bo'ladi.
