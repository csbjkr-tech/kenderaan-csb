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
| **Admin** | `admin` | *(default seed: `admin123` — TELAH DITUKAR, rujuk pengurus kata laluan tuan)* |

> ⚠️ **PENTING:** Akaun ini di-seed automatik bila jadual `admins` kosong, dan portal ini **terdedah ke internet**. Kata laluan default `admin123` telah **ditukar kepada yang kukuh** (2026-09-17) di production dan lokal. Kalau deploy ke database baru yang kosong, tukar kata laluan terus melalui Panel Admin → Tetapan.

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
- **Tab 📢 Notifikasi** — status konfigurasi emel, statistik penghantaran, log + butang Uji Emel
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
- **Semua 33 endpoint diaudit** (2026-09-17) — tiada laluan tanpa auth; lulus/tolak/padam wajib admin, detail/edit/kembalikan benarkan **pemilik rekod atau admin** (`requireOwnerOrAdmin`)
- **Rate limiting login** (2026-09-18) — 5 cubaan/akaun & 20 cubaan/IP per 15 minit → `429` dengan `Retry-After` + mesej Bahasa Melayu; 3 pendaftaran/IP/jam; kiraan pulih selepas log masuk berjaya
- **Sesi kekal merentas deploy** — `ADMIN_SESSION_SECRET` tetap di Railway & lokal (rahsia berasingan); token tidak terbatal setiap redeploy (dibuktikan dengan ujian redeploy)

---

## ⚙️ Tetapan Teknikal

### Stack Teknologi

| Komponen | Teknologi |
|----------|-----------|
| **Backend** | Node.js + Express v5 |
| **Database** | **PostgreSQL** (`pg`) — Railway production & lokal (PostgreSQL 18) |
| **Frontend** | HTML / CSS / JavaScript (vanilla) |
| **Notifikasi Email** | Nodemailer SMTP (lokal) · API HTTP Brevo/Resend (production — port SMTP disekat Railway, lihat 🔔) |
| **Notifikasi** | **Emel sahaja** — Brevo API HTTP (production) / SMTP Gmail (lokal). *SMS/Twilio dibuang 2026-09-18* |
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

> 📦 Fail `*.db` SQLite legasi (`vehicle_requests.db` + `-shm`/`-wal`) telah **dipadam** (2026-09-18) selepas migrasi PostgreSQL disahkan lengkap — sistem kini tulen PostgreSQL.

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

### Email — Audit Ke-3 (2026-09-18, butiran penuh: `RAILWAY-FIX-GUIDE.md`)
- Dihantar semasa permohonan diluluskan atau ditolak; setiap cubaan direkod dalam jadual `notifications` (berjaya/gagal + sebab sebenar)
- ⚠️ **Railway menyekat port SMTP (587 & 465)** — polisi platform anti-spam (dibuktikan dengan probe dari dalam kontainer). Penghantaran SMTP terus dari production **tidak mungkin** — ini bukan masalah kod
- **Penyelesaian production (AKTIF ✅ sejak 2026-09-18):** **Brevo API HTTP** terintegrasi dan **terbukti terhantar** ke inbox sebenar — perlukan `BREVO_API_KEY`, pengirim tersahkan, dan IP keluar Railway dibenarkan di Brevo (panduan lengkap 6 langkah: `RAILWAY-FIX-GUIDE.md`). Alternatif: Resend (100/hari)
- **Lokal berfungsi** — SMTP ke Gmail dari mesin sendiri sampai; perlukan **App Password 16 aksara** dari https://myaccount.google.com/apppasswords (kata laluan akaun ditolak oleh Gmail)
- **Timeout SMTP** — connection 10s / greeting 10s / socket 15s (boleh atur: `EMAIL_CONNECT_TIMEOUT`) → request gagal pantas, tak tergantung selamanya
- **IPv4-first DNS** — `dns.setDefaultResultOrder('ipv4first')` (kontainer Railway tiada rangkaian IPv6)

### SMS — DIBUANG (2026-09-18)
- Keputusan reka bentuk: sistem menggunakan **notifikasi emel sahaja** (Brevo/SMTP)
- Twilio dibuang sepenuhnya: kod, dependency `twilio`, kunci environment, dan UI SMS

### Tab 📢 Notifikasi (Panel Admin)
- Status konfigurasi emel (badge ✅/❌), statistik berjaya/gagal, 15 penghantaran terkini dengan sebab kegagalan
- Butang **🧪 Uji Emel** — uji penghantaran tanpa perlu luluskan permohonan sebenar (ruangan kosong = hantar kepada diri sendiri)

---

## 📊 API Endpoints

### Umum
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/health` | Status server + ping database sebenar |
| `GET` | `/api/stats` 🔒 | Statistik permohonan (admin) |
| `GET` | `/api/notifications` 🔒 | Log notifikasi (admin) |
| `GET` | `/api/export` 🔒 | Eksport data sebagai CSV (admin) |

### Permohonan
| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/api/requests` 🔒 | Senarai penuh (admin; boleh filter `?status=`) |
| `GET` | `/api/requests/mine` 🔑 | Permohonan milik pengguna yang log masuk |
| `GET` | `/api/requests/:id` 🔑🔒 | Butiran permohonan (pemilik atau admin) |
| `POST` | `/api/requests` 🔑 | Hantar permohonan baru (token pengguna wajib) |
| `PUT` | `/api/requests/:id` 🔑🔒 | Kemaskini permohonan (pemilik atau admin) |
| `PUT` | `/api/requests/:id/approve` 🔒 | Luluskan |
| `PUT` | `/api/requests/:id/reject` 🔒 | Tolak (dengan nota admin) |
| `PUT` | `/api/requests/:id/return` 🔑🔒 | Kembalikan kenderaan (pemilik atau admin) |
| `DELETE` | `/api/requests/:id` 🔒 | Padam permohonan |

🔑 = token pengguna · 🔒 = token admin · 🔑🔒 = pemilik rekod atau admin

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
| `GET` | `/api/admin/notifications/status` | Status konfigurasi + ringkasan penghantaran emel |
| `POST` | `/api/admin/notifications/test` | Uji hantar emel tanpa permohonan sebenar |
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
#    (DATABASE_URL, Brevo/SMTP — rujuk panduan dalam fail)
cp .env.example .env

# 3. Jalankan server (auto-load .env melalui dotenv — tiada langkah tambahan)
npm start            # atau: node server.js

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
| 2026-09-17 | **Audit auth** — approve/reject/padam wajib admin; 6 endpoint lagi dilindungi (senarai/stats/log: admin; detail/edit/return: pemilik atau admin) |
| 2026-09-17 | **Tab 📢 Notifikasi** + butang **Uji Emel/SMS** dalam Panel Admin (endpoint status & test) |
| 2026-09-17 | **Kata laluan admin ditukar** daripada `admin123` kepada yang kukuh (production & lokal) |
| 2026-09-18 | **Rate limiting login** — 5/akaun & 20/IP per 15 minit (`429` + `Retry-After`), 3 pendaftaran/jam |
| 2026-09-18 | **Audit Ke-3 emel** — timeout SMTP + IPv4-first; disahkan **Railway sekat port 587/465** → penyelesaian API HTTP (Brevo/Resend); butiran: `RAILWAY-FIX-GUIDE.md` |
| 2026-09-18 | **`ADMIN_SESSION_SECRET` tetap** — sesi admin kekal merentas deploy (dibuktikan dengan ujian redeploy) |
| 2026-09-18 | **dotenv** — server auto-load `.env`; guard `PORT=0` rosak dari env mesin; fail legasi SQLite dipadam |
| 2026-09-18 | **Emel production aktif** — Brevo API HTTP: kunci diset, IP keluar Railway dibenarkan, emel sebenar terhantar ke inbox (terbukti) |
| 2026-09-18 | **Keputusan reka bentuk: emel sahaja** — Twilio/SMS dibuang sepenuhnya (kod, dependency, UI); **audit kod lapuk**: skrip tunnel/bat, DB SQLite kedua, salinan legasi dokumen & log lama dibuang |

---

*Dicipta untuk Cawangan Senggara Bangunan, Jabatan Kerja Raya Sabah*
