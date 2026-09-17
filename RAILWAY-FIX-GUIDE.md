# 🛠️ Panduan Baiki `DATABASE_URL` di Railway

> **Masalah:** Server production hidup, tetapi `DATABASE_URL` tidak ditetapkan — semua query database gagal dengan `ECONNREFUSED`.

---

## 🩺 Cara Sahkan Masalah (selepas fix /health)

Buka: **https://kenderaan-csb-production.up.railway.app/health**

| Keputusan | Maksud |
|-----------|--------|
| `"status": "ok"` + `"db": true` | ✅ Database berfungsi |
| `"databaseUrl": false` | ❌ Variable `DATABASE_URL` tiada di Railway |
| `"status": "degraded"` + `dbError` | ❌ Variable ada, tapi sambungan gagal (baca `dbError`) |

---

## 📋 Langkah Pembaikan

### Langkah 1 — Buka Projek

1. Pergi ke [railway.app](https://railway.app) dan log masuk
2. Klik projek **kenderaan-csb** (atau nama projek yang mengandungi service `kenderaan-csb-production`)

### Langkah 2 — Semak Ada Tak Plugin Postgres

Dalam paparan **canvas** (lukisan kotak-kotak service):

- **Kalau ADA kotak database Postgres** (ikon database/kura-kura 🐢):
  - Klik kotak Postgres tersebut → tab **Connect**
  - Salin **`DATABASE_URL`** (bermula dengan `postgresql://...`)
  - → Terus ke **Langkah 4**

- **Kalau TIADA kotak Postgres** (kemungkinan besar — dipadam atau tak pernah dibuat):
  - Klik **+ Create** (tombol atas kanan canvas)
  - Pilih **Database** → **Add PostgreSQL**
  - Tunggu 1–2 minit sampai status jadi hijau
  - Klik kotak Postgres baru → tab **Connect** → salin **`DATABASE_URL`**
  - ⚠️ **PENTING:** Database baru ini KOSONG. Data lama hilang kecuali ada backup (lihat bahagian "Data Lama" di bawah)
  - → Terus ke **Langkah 4**

### Langkah 3 — (Semak dulu sebab masa lalu) Variable Hilang

1. Klik **service Node** (kotak utama sistem kenderaan)
2. Pergi tab **Variables**
3. Cari `DATABASE_URL` dalam senarai
4. Kalau wujud tapi kosong/salah format — itulah punca masalah

### Langkah 4 — Tetapkan Variable

1. Klik **service Node** → tab **Variables**
2. Klik **+ New Variable** dan masukkan salah satu cara:

   **Cara A (Disyorkan — auto-link):**
   ```
   Nama:  DATABASE_URL
   Nilai: ${{Postgres.DATABASE_URL}}
   ```
   *(Nama reference mungkin berbeza ikut nama service Postgres — mula taip `${{Post` dan Railway akan tunjukkan pilihan yang sah)*

   **Cara B (tampal terus):**
   ```
   Nama:  DATABASE_URL
   Nilai: postgresql://postgres:PASSWORD@host:5432/railway
   ```
   *(Salin dari tab **Connect** kotak Postgres)*

3. Klik **Add** — Railway akan **auto-redeploy** service Node (tunggu 1–2 minit)

### Langkah 5 — Sahkan Pembaikan

Tunggu deploy siap (tab **Deployments** tunjuk "Success"), kemudian buka:

```
https://kenderaan-csb-production.up.railway.app/health
```

Hasil yang diharap:

```json
{
  "status": "ok",
  "db": true,
  "databaseUrl": true,
  "dbError": null,
  "timestamp": "..."
}
```

Kemudian uji login admin di https://kenderaan-csb-production.up.railway.app/admin
(`admin` / `admin123` — **hanya jika database baru & kosong**; jika database lama masih ada, guna kata laluan sedia ada)

---

## 💾 Pasal Data Lama

| Keadaan | Tindakan |
|---------|----------|
| Postgres plugin masih ada, cuma variable hilang | ✅ Data selamat — sambung semula saja |
| Postgres plugin telah dipadam dari projek | ❌ Data hilang — perlu mulakan semula atau restore dari backup JSON |

**Restore dari backup:** Panel Admin → bahagian **Backup & Restore** → muat naik fail JSON backup yang pernah dimuat turun.

---

## 📌 Nota Tambahan

- Commit `529837a` sudah fix SSL untuk sambungan PostgreSQL — konfigurasi SSL sepatutnya berfungsi automatik untuk host Railway
- Kalau selepas fix masih `degraded` dengan `dbError` mengandungi `SSL` / `self signed certificate`, sila screenshot `dbError` tersebut untuk semakan lanjut
