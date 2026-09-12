# bilim/ — botning bilim bazasi

Bu papkadagi fayllarni bot `bilim_qidiruv` vositasi orqali o'qiydi. Foydalanuvchi
biznes haqida savol bersa — narx, xizmat, ish tartibi, oldingi qaror — model shu
yerdan qidiradi. Internet bu ma'lumotlarni bilmaydi.

## Format

- `.md` va `.txt` fayllar o'qiladi, boshqasi e'tiborsiz qoldiriladi.
- Ichki papkalar ham o'qiladi (3 qavatgacha), masalan `bilim/mijozlar/x.md`.
- Fayl `##` sarlavhalari bo'yicha parchalarga bo'linadi. Sarlavha yo'q bo'lsa —
  bo'sh qator bo'yicha.
- **Har bo'lim o'zicha tushunarli bo'lsin.** Modelga butun fayl emas, faqat mos
  kelgan parcha beriladi: "yuqorida aytilganidek" degan havolalar ishlamaydi.
- Sarlavhaga odam qidiradigan so'zni yozing — sarlavhadagi moslik uch barobar
  og'irroq baholanadi.

## Ehtiyot bo'ling

Repo **public**. Bu papkaga mijoz ismi, telefon raqami, shartnoma summasi yoki
boshqa maxfiy ma'lumot yozilmasin — GitHub'da hamma ko'radi.

Maxfiy material kerak bo'lsa: `bilim/` ni `.gitignore` ga qo'shing va serverga
`scp` bilan qo'lda yuboring.

## Yangi fayl qo'shgandan keyin

Fayllar o'zgarsa bot ularni o'zi qayta o'qiydi — restart shart emas.
Faqat **birinchi** fayl qo'shilganda restart kerak: baza bo'sh bo'lsa vosita
modelga umuman e'lon qilinmaydi.

Quyidagi uchta fayl — **namuna**. O'z materialingiz bilan almashtiring.
