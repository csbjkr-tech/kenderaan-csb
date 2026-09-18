# 🛠️ Panduan Database Railway — Sistem Penggunaan Kenderaan CSB

> **STATUS: SELESAI ✅ (2026-09-17)** — Production kini berjalan dengan PostgreSQL penuh.

## 🔍 Audit Ke-2 (2026-09-17): Punca Duplicate Permohonan & Pembaikan Menyeluruh

**Gejala:** setiap permohonan pengguna muncul 2 rekod di production.

**Punca sebenar:** `user.html` (portal pengguna) memuatkan `script.js` (fail panel admin yang lama)
BERSAMA `user-portal.js`. `script.js` masih mengandungi **kod borang lapuk** yang auto-attach
handler submit ke borang `#vehicleForm` yang sama — maka setiap penghantaran dihantar 2 kali
(sekali serta-merta oleh kod lapuk, sekali lagi selepas modal pengesahan).

**Pembaikan audit (commit ini):**
1. Kod borang lapuk dipadam dari `script.js` (panel admin kini tulen)
2. **Auth token**: semua endpoint admin/user-management wajib Bearer token (HMAC, 12 jam)
   — sebelum ini SESIAPA di internet boleh padam data melalui API terbuka
3. **Kata laluan di-hash** (scrypt) — migrasi automatik untuk rekod lama semasa boot
4. Permohonan dikaitkan dengan `user_id` + endpoint `/api/requests/mine` (portal papar hanya
   permohonan sendiri — sebelum ini ia muat turun SEMUA permohonan semua pengguna)
5. Pembersihan duplicate legasi semasa boot → index unik PostgreSQL kini **tercipta di production**
6. Layer 2 dedup diperluas: cukup plat+telefon+tarikh (tujuan/odo tak lagi diwajibkan sama)
7. Cache-buster `?v=` pada CSS/JS supaya browser tak pegang kod lama selepas deploy

---

## 📖 Punca Sebenar Masalah (untuk rujukan masa depan)

Gejala: production `degraded`, API gagal `ECONNREFUSED`, `databaseUrl: false`.

Punca: **Projek Railway `energetic-dream` (sistem kenderaan) TIDAK PERNAH ada plugin Postgres sendiri.** Plugin Postgres yang lama berada di projek lain (`imaginative-unity`), dan hostname-nya (`postgres.railway.internal`) hanya boleh dicapai dari rangkaian projek itu sendiri — maka sambungan selalu gagal.

## ✅ Pembaikan Yang Dilakukan (2026-09-17)

Melalui Railway CLI (`npm i -g @railway/cli` → `railway login --browserless`):

```bash
railway link -p energetic-dream -e production     # pautkan folder ke projek betul
railway add -d postgres                            # cipta plugin Postgres dalam projek
railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
    -e production -s kenderaan-csb                 # wire variable ke service
```

Railway auto-redeploy → `/health` bertukar ke `"ok"`. Admin auto-seed (`admin`/`admin123`) terhasil automatik kerana jadual kosong.

## 🩺 Semakan Kesihatan Production

```
GET https://kenderaan-csb-production.up.railway.app/health
```

| Keputusan | Maksud |
|-----------|--------|
| `"status": "ok"`, `"db": true` | ✅ Database berfungsi |
| `"databaseUrl": false` | ❌ Variable `DATABASE_URL` tiada di runtime |
| `"status": "degraded"` + `dbError` | ❌ Variable ada tapi sambungan gagal (baca `dbError`) |

Endpoint ini melakukan ping DB sebenar (`SELECT 1`) sejak commit `7de8cd2`.

## 💾 Pasal Data

- Database baru bermula **kosong** — admin lalai `admin`/`admin123` dicipta automatik
- Data lama (jika ada backup JSON): Panel Admin → **Backup & Restore** → muat naik fail backup
- Database lokal mesin ini (`kenderaan_db` di PostgreSQL 18) adalah berasingan — tak terjejas

## ⚠️ Nota Penyelenggaraan

- Jangan padam plugin **Postgres** dalam projek `energetic-dream` — itu kini database production yang sebenar
- Volume `postgres-volume` menyimpan data — Railway mengekalkannya merentas deploy- Kata laluan DB tidak perlu diketahui oleh manusia; reference `${{Postgres.DATABASE_URL}}` mengurusnya secara automatik

---

## 📧 Audit Ke-3 (2026-09-18): Emel di Railway — Port SMTP Disekat & Penyelesaiannya

**Gejala:** butang **Uji Emel** di production tergantung ~45 saat tanpa jawapan; selepas itu pula gagal
`ENETUNREACH` / `ETIMEDOUT` walaupun kredensial Gmail betul.

### Punca Berlapis (didiagnosis berperingkat)

1. **Tiada timeout SMTP** — nodemailer menunggu sambungan selamanya apabila rangkaian menyekat;
   request API tergantung (tidak ada jawapan 45+ saat).
2. **Percubaan IPv6** — DNS Gmail memulangkan alamat IPv6 (`2a00:1450:...`); kontainer Railway
   **tiada rangkaian IPv6** → `ENETUNREACH` serta-merta.
3. **Penyekatan port SMTP oleh Railway** (polisi platform anti-spam) — selepas dua isu di atas
   dibaiki, sambungan TCP ke Gmail masih tersekat. Bukti dari DALAM kontainer
   (`railway ssh` → probe node `net.connect`):

   | Sasaran dari kontainer Railway | Keputusan |
   |---|---|
   | `smtp.gmail.com:587` (SMTP) | ❌ `ETIMEDOUT` — **disekat** |
   | `smtp.gmail.com:465` (SMTPS) | ❌ `ETIMEDOUT` — **disekat** |
   | HTTPS `:443` | ✅ `200` — terbuka |

   **Kesimpulan:** penghantaran SMTP terus dari Railway **tidak mungkin** — ini bukan masalah kod.

### Pembaikan Yang Di-push

| Commit | Pembaikan | Detail |
|---|---|---|
| `42e4baf` | **Timeout SMTP** (`notifications.js`) | `connectionTimeout: 10s` (boleh atur melalui `EMAIL_CONNECT_TIMEOUT`), `greetingTimeout: 10s`, `socketTimeout: 15s` → request gagal **pantas ~10 saat** dengan mesej jelas, bukan tergantung selamanya |
| `9da9f7e` | **IPv4-first DNS** (`server.js`) | `dns.setDefaultResultOrder('ipv4first')` di atas fail → tiada lagi `ENETUNREACH` IPv6 |

Selepas kedua-duanya: ralat berubah daripada *hang* → `ETIMEDOUT` pantas yang **menunjukkan dengan
tepat** penyekatan port (inilah yang membawa kepada diagnosis #3).

### Penyelesaian Production: API HTTP Emel (port 443 yang terbuka)

Guna penyedia emel dengan **API HTTP** dan `API_KEY` dalam variables Railway — contoh pilihan:

| Penyedia | Percuma | Cara guna |
|---|---|---|
| **Brevo** (dahulunya Sendinblue) | 300 emel/hari | `POST https://api.brevo.com/v3/smtp/email` dengan header `api-key` |
| **Resend** | 100 emel/hari | `POST https://api.resend.com/emails` dengan `Authorization: Bearer` |

Langkah: daftar akaun → sahkan domain/pengirim → simpan kunci sebagai `BREVO_API_KEY` (atau
`RESEND_API_KEY`) dalam Railway variables → integrasi dalam `notifications.js` sebagai provider
HTTP selari dengan SMTP.

> ✅ **STATUS: INTEGRASI SELESAI (2026-09-18)** — `notifications.js` kini menyokong Brevo API HTTP
> secara native: bila `BREVO_API_KEY` diset, emel dihantar melalui `POST api.brevo.com/v3/smtp/email`
> (port 443, timeout 10s, boleh atur `BREVO_TIMEOUT`); bila kosong → fallback SMTP seperti biasa
> (lokal). Tab 📢 Notifikasi memaparkan provider aktif (`brevo`/`smtp`). Laluan Brevo telah diuji
> (kunci tidak sah → `401 Key not found` dilaporkan dengan jelas dalam ~1.3s). **Lokal tidak terjejas** — sambungan SMTP dari mesin sendiri ke Gmail
berfungsi (terbukti: ralat `534/535` daripada Gmail bermakna pakej sampai; cuma perlu
**App Password 16 aksara**, bukan kata laluan akaun).

### Nota Berkaitan (2026-09-18)

- **Sesi admin kini kekal merentas deploy** (2026-09-18): `ADMIN_SESSION_SECRET` tetap telah diset dalam
   Railway variables — token tidak lagi terbatal setiap redeploy (dibuktikan: token yang diterima
   *sebelum* redeploy masih sah `200` *selepas* redeploy kedua). Lokal juga ada rahsia tetap sendiri
   dalam `.env`; kunci didokumenkan dalam `.env.example` (jangan pernah commit nilai sebenar).
- **Rate limiting login** (commit `3b331cb`): 5 cubaan/akaun & 20 cubaan/IP setiap 15 minit → `429`
   dengan header `Retry-After`. Ujian brute-force boleh "membakar" kuota IP sendiri buat sementara.
- Status semasa konfigurasi semak dalam Panel Admin → tab **📢 Notifikasi** (badge ✅/❌ + log gagal
   dengan sebab sebenar).
