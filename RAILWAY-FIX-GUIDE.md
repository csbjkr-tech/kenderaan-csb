# 🛠️ Panduan Database Railway — Sistem Penggunaan Kenderaan CSB

> **STATUS: SELESAI ✅ (2026-09-17)** — Production kini berjalan dengan PostgreSQL penuh.

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
