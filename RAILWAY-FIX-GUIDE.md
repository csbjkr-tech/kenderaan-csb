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
- Volume `postgres-volume` menyimpan data — Railway mengekalkannya merentas deploy
- Kata laluan DB tidak perlu diketahui oleh manusia; reference `${{Postgres.DATABASE_URL}}` mengurusnya secara automatik
