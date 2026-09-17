# 🚗 Sistem Penggunaan Kenderaan — Cawangan Senggara Bangunan

> **Jabatan Kerja Raya Sabah** | Cawangan Senggara Bangunan

---

## 📋 Penerangan

Sistem ini mengurus permohonan penggunaan kenderaan jabatan. Pengguna boleh memohon kenderaan, admin meluluskan atau menolak, dan pengguna mengembalikan kenderaan dengan bacaan odometer selepas selesai digunakan.

---

## 🔗 Portal Links

| Portal | URL | Penerangan |
|--------|-----|------------|
| **🏠 Halaman Utama** | [https://kenderaan-csb-production.up.railway.app](https://kenderaan-csb-production.up.railway.app) | Pilihan Pengguna atau Admin |
| **👤 Portal Pengguna** | [https://kenderaan-csb-production.up.railway.app/user](https://kenderaan-csb-production.up.railway.app/user) | Pohon kenderaan, urus permohonan, kembalikan kenderaan |
| **🔐 Panel Admin** | [https://kenderaan-csb-production.up.railway.app/admin](https://kenderaan-csb-production.up.railway.app/admin) | Lulus/tolak permohonan, urus pengguna, tetapan |
| **🩺 Health Check** | [https://kenderaan-csb-production.up.railway.app/health](https://kenderaan-csb-production.up.railway.app/health) | Status server & sambungan database |

### 🔑 Log Masuk Lalai

| Akaun | Nama Pengguna | Kata Laluan |
|-------|---------------|-------------|
| **Admin** | `admin` | `admin123` |

> ⚠️ **PENTING:** Akaun ini di-seed automatik bila jadual `admins` kosong, dan portal ini **terdedah ke internet**. Tukar kata laluan terus melalui Panel Admin → Tetapan selepas deployment baru.

---

## 🔄 Aliran Kerja

```
Pengguna hantar permohonan
        ↓
Admin semak & luluskan / tolak
        ↓
Pengguna guna kenderaan
        ↓
Pengguna kembalikan kenderaan (isi odometer)
        ↓
Status: completed (Selesai)
```

### Status Permohonan

| Status | Warna | Penerangan |
|--------|-------|------------|
| `pending` | 🟠 Jingga | Menunggu kelulusan admin |
| `approved` | 🟢 Hijau | Diluluskan, kenderaan sedang digunakan |
| `rejected` | 🔴 Merah | Ditolak oleh admin |
| `completed` | 🔵 Biru | Kenderaan telah dikembalikan |

---

## ✨ Ciri-Ciri Utama

### Portal Pengguna
- Daftar akaun & log masuk
- Pohon kenderaan dengan validasi inline + modal pengesahan
- Auto-isi borang dari profil
- Pantau status permohonan sendiri
- Kembalikan kenderaan dengan bacaan odometer

### Panel Admin
- Semak, luluskan, tolak permohonan (dengan notifikasi automatik)
- Urus pengguna (aktif/nyahaktif)
- Tukar kata laluan, tetapan akaun
- Eksport data CSV
- **Backup & Restore** data (JSON) — penting untuk pemindahan data
- **Zon bahaya** (padam data, reset kata laluan)

### Ketahanan Sistem
- **Anti-duplicate 3 lapisan** — (1) memory 5s, (2) semakan DB permohonan PENDING sama (plat+telefon+tarikh) dalam 24 jam → `409`, (3) **partial unique index PostgreSQL** `(no_hp, UPPER(no_plate), tarikh_bertolak) WHERE status='pending'` (atomik, race-condition-proof); duplicate legasi dibersihkan semasa boot supaya index pasti tercipta
- **Health check sebenar** — `/health` melakukan ping database (`SELECT 1`), bukan sekadar semak variable; melaporkan `dbError` yang jelas bila gagal
- **Banner "Database tidak tersedia"** — bila DB down, pengguna nampak mesej mesra dengan butang 🔄 **Cuba Semula** (bukan error kosong), di panel admin, portal pengguna, dan semasa hantar permohonan (data borang tidak hilang)
- Server tetap hidup dalam mod **DEGRADED** walaupun database gagal — halaman web masih boleh diakses

### Keselamatan
- **Auth token** (HMAC SHA-256, sah 12 jam): semua endpoint admin & user-management wajib `Authorization: Bearer <token>`; POST permohonan wajib token pengguna (`X-User-Token`)
- **Kata laluan di-hash** (scrypt + salt) — migrasi automatik rekod legasi semasa boot; hash lama (teks kosong) disokong semasa log masuk lalu dinaik taraf
- Permohonan dikaitkan dengan `user_id`; portal pengguna hanya nampak permohonan sendiri (`/api/requests/mine`)
- Middleware penyekat fail sensitif daripada static serving: `*.db`, `*.env`, `*.log`, `*.bat`, `*.ps1`, `*.md`, `package-lock.json`, dan semua fail tersembunyi (`.`) — semua memulangkan 404
- `.env` (kredensial) dikecualikan dari git

---

## ⚙️ Tetapan Teknikal

### Stack Teknologi

| Komponen | Teknologi |
|----------|-----------|
| **Backend** | Node.js + Express v5 |
| **Database** | **PostgreSQL** (`pg`) — Railway production & lokal (PostgreSQL 18) |
| **Frontend** | HTML / CSS / JavaScript (vanilla) |
| **Notifikasi Email** | Nodemailer (Gmail SMTP) |
| **Notifikasi SMS** | Twilio |
| **Tunnel** | Cloudflare (cloudflared, optional) |
| **Port** | 8080 (default) |

### Struktur Fail Utama

```
├── server.js              # API server + PostgreSQL + endpoints
├── notifications.js       # Modul notifikasi email/SMS
├── index.html             # Halaman utama (pilihan portal)
├── admin.html             # Panel admin
├── user.html              # Portal pengguna
├── script.js              # JS admin panel + helper API dikongsi
├── user-portal.js         # JS portal pengguna
├── style.css              # Gaya visual + banner DB error
├── RAILWAY-FIX-GUIDE.md   # Panduan database Railway (punca & penyelesaian)
├── .env                   # Konfigurasi sebenar (RAHSIA — di-ignore git)
├── .env.example           # Templat konfigurasi untuk salin
├── QR CSB-KENDERAAN.png   # Aset QR code portal
└── .freebuff/             # Tooling preview (preview-launch.js, run.md)
```

> 📦 Fail `*.db` SQLite yang lama (`kenderaan.db`, `vehicle_requests.db`) adalah **legasi** selepas migrasi ke PostgreSQL dan tidak lagi digunakan oleh sistem.

---

## 🗄️ Database

### Production (Railway)
- Plugin **Postgres** dalam projek Railway `energetic-dream`, dihubungkan melalui variable:
  ```
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  ```
- Data kekal merentas deploy melalui volume `postgres-volume`
- Tables (`requests`, `admins`, `users`, `notifications`) dicipta automatik semasa server mula

### Lokal (development)
- PostgreSQL 18 berjalan sebagai servis Windows (port 5432)
- Database: `kenderaan_db` — kredensial dalam `.env` (rujuk `.env.example` untuk format)
- Launcher preview `.freebuff/preview-launch.js` auto-load `.env`

**Punca masalah lepas:** plugin Postgres pernah berada di projek Railway yang salah, menyebabkan `ECONNREFUSED` berpanjangan. Details penuh: `RAILWAY-FIX-GUIDE.md`.

---

## 🔔 Notifikasi

### Email (Gmail SMTP)
- Dihantar semasa permohonan diluluskan atau ditolak
- Konfigurasi melalui `.env` (rujuk `.env.example` untuk panduan App Password)

### SMS (Twilio)
- Kod menerima **kedua-dua konvensyen nama kunci**: `TWILIO_SID`/`TWILIO_ACCOUNT_SID` dan `TWILIO_FROM`/`TWILIO_PHONE_NUMBER`
- Nota: kredensial Twilio production belum diisi — SMS masih DISABLED sehingga diisi

---

## 📊 API Endpoints

### Umum
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/health` | Status server + ping database sebenar |
| `GET` | `/api/stats` | Statistik permohonan |
| `GET` | `/api/notifications` | Log notifikasi |
| `GET` | `/api/export` | Eksport data sebagai CSV |

### Permohonan
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/api/requests` 🔒 | Senarai penuh (admin; boleh filter `?status=`) |
| `GET` | `/api/requests/mine` 🔑 | Permohonan milik pengguna yang log masuk |
| `GET` | `/api/requests/:id` | Butiran permohonan |
| `POST` | `/api/requests` 🔑 | Hantar permohonan baru (token pengguna wajib) |
| `PUT` | `/api/requests/:id` | Kemaskini permohonan |
| `PUT` | `/api/requests/:id/approve` | Luluskan |
| `PUT` | `/api/requests/:id/reject` | Tolak (dengan nota admin) |
| `PUT` | `/api/requests/:id/return` | Kembalikan kenderaan (odometer) |
| `DELETE` | `/api/requests/:id` | Padam permohonan |

🔑 = token pengguna · 🔒 = token admin

### Pengguna & Auth
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `POST` | `/api/login` | Log masuk admin |
| `POST` | `/api/users/register` | Daftar pengguna baru |
| `POST` | `/api/users/login` | Log masuk pengguna |
| `GET` | `/api/users` | Senarai pengguna (admin) |
| `GET` | `/api/users/stats` | Statistik pengguna |
| `PUT` | `/api/users/:id/toggle` | Aktif/nyahaktif pengguna |
| `DELETE` | `/api/users/:id` | Padam pengguna |

### Admin
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/api/admin/info` | Maklumat akaun admin |
| `GET` | `/api/admin/backup` | Muat turun backup JSON |
| `POST` | `/api/admin/restore` | Pulihkan dari backup |
| `PUT` | `/api/admin/change-password` | Tukar kata laluan |
| `PUT` | `/api/admin/reset-password` | Reset kata laluan |
| `PUT` | `/api/admin/reset-to-default` | Reset ke default |
| `PUT` | `/api/admin/reset-users` | Reset pengguna |
| `DELETE` | `/api/admin/reset-data` | Padam semua data (zon bahaya) |

---

## 🛠️ Permulaan Lokal

### Keperluan
- Node.js + npm
- PostgreSQL berjalan lokal (atau guna Railway)

### Pasang & Jalankan

```bash
# 1. Pasang kebergantungan
npm install

# 2. Salin & isi konfigurasi
#    (DATABASE_URL, email/Twilio — rujuk panduan dalam fail)
cp .env.example .env

# 3. Jalankan server
npm start            # atau: node server.js
# atau dengan launcher preview (auto-load .env):
node .freebuff/preview-launch.js

# 4. Semak kesihatan
curl http://localhost:8080/health
```

Hasil yang diharap: `{"status":"ok","db":true,...}` — admin `admin`/`admin123` di-seed automatik pada kali pertama.

---

## 📅 Sejarah Pengemaskinian

| Tarikh | Pengemaskinian |
|--------|----------------|
| 2026-08-21 | Versi awal — borang permohonan asas |
| 2026-09-02 | Portal pengguna (daftar/log masuk), validasi inline, modal pengesahan, aliran kembalikan kenderaan, fix FK constraint |
| 2026-09-02 | Migrasi SQLite → PostgreSQL untuk Railway |
| 2026-09-02 | Backup & restore untuk admin |
| 2026-09-17 | **Fix SSL PostgreSQL** untuk Railway |
| 2026-09-17 | **Health check sebenar** — ping DB (`SELECT 1`), laporkan `dbError` sebenar |
| 2026-09-17 | **Patch keselamatan** — sekat muat turun fail sensitif (`.db`, `.env`, logs, dll.) |
| 2026-09-17 | **Fix database production** — plugin Postgres diwired ke service betul di Railway (`DATABASE_URL=${{Postgres.DATABASE_URL}}`); production kini `ok` |
| 2026-09-17 | **Banner "Database tidak tersedia"** dengan butang Cuba Semula di semua portal |
| 2026-09-17 | **Fix kunci Twilio** — terima `TWILIO_ACCOUNT_SID`/`TWILIO_PHONE_NUMBER` (SMS tak lagi lumpuh senyap) |
| 2026-09-17 | **Railway CLI** dipasang & panduan `RAILWAY-FIX-GUIDE.md` lengkap dengan punca sebenar |

---

*Dicipta untuk Cawangan Senggara Bangunan, Jabatan Kerja Raya Sabah*
