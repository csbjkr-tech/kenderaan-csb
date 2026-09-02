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
| **👤 Portal Pengguna** | [https://kenderaan-csb-production.up.railway.app/user.html](https://kenderaan-csb-production.up.railway.app/user.html) | Pohon kenderaan, urus permohonan, kembalikan kenderaan |
| **🔐 Panel Admin** | [https://kenderaan-csb-production.up.railway.app/admin](https://kenderaan-csb-production.up.railway.app/admin) | Lulus/tolak permohonan, urus pengguna, tetapan |

### 🔑 Log Masuk Lalai

| Akaun | Nama Pengguna | Kata Laluan |
|-------|---------------|-------------|
| **Admin** | `admin` | `admin123` |

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

## 👥 Pengguna & Akses

### Portal Pengguna
- **Daftar akaun baru** — Isi maklumat peribadi (nama, jawatan, telefon, emel)
- **Log masuk** — Akses dashboard permohonan
- **Pohon baru** — Isi borang permohonan kenderaan
  - Auto-isi dari profil (nama, jawatan, telefon, emel)
  - Validasi inline masa nyata
  - Pengesahan ringkasan sebelum hantar
- **Lihat permohonan** — Semak status permohonan sendiri
- **Kembalikan kenderaan** — Masukkan bacaan odometer selepas selesai

### Panel Admin
- **Semak permohonan** — Lihat senarai permohonan mengikut status
- **Luluskan / Tolak** — Kelulusan dengan notifikasi automatik
- **Urus pengguna** — Aktif/nyahaktif pengguna
- **Tetapan** — Tukar kata laluan, maklumat akaun
- **Eksport data** — Muat turun data sebagai CSV
- **Zon bahaya** — Padam semua data, reset kata laluan

---

## ⚙️ Tetapan Teknikal

### Stack Teknologi

| Komponen | Teknologi |
|----------|-----------|
| **Backend** | Node.js + Express v5 |
| **Database** | SQLite (better-sqlite3) |
| **Frontend** | HTML / CSS / JavaScript (vanilla) |
| **Notifikasi Email** | Nodemailer (Gmail SMTP) |
| **Notifikasi SMS** | Twilio |
| **Port** | 8080 (default) |

### Struktur Fail Utama

```
├── server.js           # API server + database + endpoints
├── index.html          # Halaman utama (pilihan portal)
├── admin.html          # Panel admin
├── user.html           # Portal pengguna
├── script.js           # JavaScript admin panel
├── user-portal.js      # JavaScript portal pengguna
├── style.css           # Gaya visual dengan animasi
├── notifications.js    # Modul notifikasi email/SMS
├── vehicle_requests.db # Database SQLite
├── .env                # Konfigurasi notifikasi (rahsia)
├── .env.example        # Contoh fail .env
└── package.json        # Kebergantungan npm
```

---

## 🔔 Notifikasi

### Email (Gmail SMTP)
- Dihantar semasa permohonan diluluskan atau ditolak
- Konfigurasi melalui `.env`:
  ```
  EMAIL_HOST=smtp.gmail.com
  EMAIL_PORT=587
  EMAIL_USER=your-email@gmail.com
  EMAIL_PASS=your-app-password
  ```

### SMS (Twilio)
- Dihantar semasa permohonan diluluskan atau ditolak
- Konfigurasi melalui `.env`:
  ```
  TWILIO_SID=your-account-sid
  TWILIO_AUTH_TOKEN=your-auth-token
  TWILIO_FROM=+1234567890
  ```

---

## 📊 API Endpoints

| Method | Endpoint | Penerangan |
|--------|----------|------------|
| `GET` | `/api/requests` | Senarai semua permohonan |
| `GET` | `/api/requests/:id` | Butiran permohonan |
| `POST` | `/api/requests` | Hantar permohonan baru |
| `PUT` | `/api/requests/:id` | Kemaskini permohonan |
| `PUT` | `/api/requests/:id/approve` | Luluskan permohonan |
| `PUT` | `/api/requests/:id/reject` | Tolak permohonan |
| `PUT` | `/api/requests/:id/return` | Kembalikan kenderaan (isi odometer) |
| `DELETE` | `/api/requests/:id` | Padam permohonan |
| `GET` | `/api/stats` | Statistik permohonan |
| `GET` | `/api/export` | Eksport data sebagai CSV |
| `GET` | `/api/notifications` | Log notifikasi |

---

## 🛠️ Permulaan

### Keperluan
- Node.js (versi terkini)
- npm

### Pasang & Jalankan

```bash
# Pasang kebergantungan
npm install

# Jalankan server
npm start

# Atau terus
node server.js
```

### 🌐 Akses

| Moda | URL |
|------|-----|
| **Production** | [https://kenderaan-csb-production.up.railway.app](https://kenderaan-csb-production.up.railway.app) |
| **Lokal** | `http://localhost:8080` |

---

## 📅 Sejarah Pengemaskinian

| Tarikh | Pengemaskinian |
|--------|----------------|
| 2026-08-21 | Versi awal — borang permohonan asas |
| 2026-09-02 | Portal pengguna — daftar/log masuk |
| 2026-09-02 | Validasi inline borang + auto-isi profil |
| 2026-09-02 | Modal pengesahan khusus (ganti confirm asal) |
| 2026-09-02 | Aliran "Kembalikan Kenderaan" + status completed |
| 2026-09-02 | Fix FK constraint (delete notifications dulu) |
| 2026-09-02 | Selaraskan kesemua fail (stat card, filter, detail view) |

---

*Dicipta untuk Cawangan Senggara Bangunan, Jabatan Kerja Raya Sabah*
