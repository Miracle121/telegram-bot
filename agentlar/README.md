# Agentlar

Bu papkada har bir agentning **xarakter fayli** turadi. Fayl — oddiy matn: siz
tahrirlaysiz, bot o'qiydi.

| Fayl | Kim |
|---|---|
| `yozuvchi.md` | Yig'ilgan material asosida post yozadi |
| `muharrir.md` | Yozuvchi yozganini tekshiradi |

## Qanday ishlaydi

```
/post mavzu
   ↓
material yig'ish   (bilim bazasi + internet)
   ↓
YOZUVCHI           (yozuvchi.md ga qarab yozadi)
   ↓
MUHARRIR           (muharrir.md ga qarab tekshiradi)
   ├─ o'tdi      → post sizga yuboriladi
   └─ qayta yoz  → sabab yozuvchiga qaytadi, maksimal 2 marta
```

## Tahrirlash

Faylni o'zgartiring va saqlang — **restart kerak emas**, keyingi `/post` da
yangi matn ishlaydi (fayl `mtime` si kuzatiladi).

Serverga chiqarish uchun `git push` yetarli: papka repoga commit qilinadi va
deploy uni o'zi olib chiqadi.

## Qoidalar

- **Fayl nomini o'zgartirmang.** `yozuvchi.md` va `muharrir.md` — kod shu
  nomlarni qidiradi. Fayl yo'q bo'lsa `/post` tushunarli xato beradi, bot esa
  ishlayveradi.
- **Formatni emas, mazmunni yozing.** Muharrirning javob formati (`O'TDI` /
  `QAYTA YOZ`) kodda belgilangan — uni faylda o'zgartirib bo'lmaydi.
- **Xarakter fayli asosiy qoidalarni bekor qilmaydi.** Muloyimlik, foydalanuvchini
  kamsitmaslik va Telegram HTML formati har doim kuchda qoladi.
- **Bu papka public repoda.** Mijoz ismi, telefon raqami, shartnoma summasi bu
  yerga yozilmaydi — xuddi `bilim/` dagi kabi.
- Fayl qancha uzun bo'lsa, har bir `/post` shuncha qimmat: matn har chaqiruvda
  modelga yuboriladi. 2-3 KB — qulay o'lcham.
