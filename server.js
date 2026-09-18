// Muat .env (lokal sahaja — di Railway tiada fail .env, variables datang dari platform)
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const notifications = require('./notifications');

// Rangkaian kontainer Railway tiada IPv6 — paksa DNS pulangkan IPv4 dahulu
// (tanpa ini, nodemailer cuba sambung Gmail melalui IPv6 dan gagal ENETUNREACH)
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080; // tolak PORT=0/negatif yang rosak dari env mesin

// ===== AUTH HELPERS (token HMAC + hash kata laluan) =====
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(payload) {
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function verifyToken(token, type) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.t !== type) return null;
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch { return null; }
}

function getAdminPayload(req) {
    // Bearer header (biasa) atau ?token= untuk muat turun terus (export/backup)
    const h = req.headers['authorization'] || '';
    if (h.startsWith('Bearer ')) return verifyToken(h.slice(7), 'admin');
    if (req.query && req.query.token) return verifyToken(String(req.query.token), 'admin');
    return null;
}

function getUserPayload(req) {
    const t = req.headers['x-user-token'] || '';
    return verifyToken(t, 'user') ? { t: 'user', id: verifyToken(t, 'user').id } : null;
}

function requireAdmin(req, res, next) {
    const p = getAdminPayload(req);
    if (!p) return res.status(401).json({ error: 'Akses admin diperlukan. Sila log masuk semula.' });
    req.admin = p;
    next();
}

function requireUser(req, res, next) {
    const t = req.headers['x-user-token'] || '';
    const p = verifyToken(t, 'user');
    if (!p) return res.status(401).json({ error: 'Sila log masuk untuk meneruskan.' });
    req.user = p;
    next();
}

// Pemilik permohonan ATAU admin — untuk endpoint yang portal pengguna guna pada rekod sendiri
async function requireOwnerOrAdmin(req, res, next) {
    const adminP = getAdminPayload(req);
    if (adminP) { req.admin = adminP; return next(); }
    const userP = getUserPayload(req);
    if (!userP) return res.status(401).json({ error: 'Sila log masuk untuk meneruskan.' });
    try {
        const request = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!request) return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(userP.id);
        const isOwner = request.user_id === userP.id || (user && request.no_hp === user.no_hp);
        if (!isOwner) return res.status(403).json({ error: 'Akses hanya kepada pemilik permohonan ini.' });
        req.user = userP;
        next();
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
    return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

function verifyPassword(pw, stored) {
    if (!stored) return false;
    if (stored.includes(':')) {
        const [salt, hash] = stored.split(':');
        const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
        const a = Buffer.from(hash, 'hex');
        const b = Buffer.from(test, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    return stored === pw; // format legasi (teks kosong) — auto-migrasi semasa log masuk
}

// ===== DEDUP: prevent rapid duplicate submissions =====
const recentRequests = new Map();
function isDuplicate(key) {
    const now = Date.now();
    const last = recentRequests.get(key);
    if (last && (now - last) < 5000) return true;
    recentRequests.set(key, now);
    if (recentRequests.size > 100) {
        for (const [k, v] of recentRequests) {
            if (now - v > 10000) recentRequests.delete(k);
        }
    }
    return false;
}

// Middleware
app.use(cors());
app.use(express.json());

// Block sensitive files from static serving (local DBs, env, logs, scripts, docs)
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const deny = p.startsWith('/.') ||
        /\.(db|db-shm|db-wal|sqlite|sqlite3|env|log|bat|ps1|md)$/.test(p) ||
        p === '/package-lock.json';
    if (deny) return res.status(404).json({ error: 'Not found' });
    next();
});

app.use(express.static(__dirname));

// ===== DATABASE SETUP (PostgreSQL) =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1'))
        ? { rejectUnauthorized: false }
        : false
});

// Log pool errors
pool.on('error', (err) => {
    console.error('❌ Unexpected PG pool error:', err.message);
});

// Helper: convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
function toPG(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

// Compatibility wrapper so the rest of the code stays minimal
const db = {
    prepare(sql) {
        const pgSql = toPG(sql);
        const self = this;
        return {
            get(...params) {
                return self._queryOne(pgSql, params);
            },
            all(...params) {
                return self._queryAll(pgSql, params);
            },
            run(...params) {
                return self._run(pgSql, params);
            }
        };
    },
    exec(sql) {
        // For multi-statement exec (table creation), run each statement separately
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        return Promise.all(statements.map(s => pool.query(s)));
    },
    transaction(fn) {
        return async (...args) => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                // Temporarily override pool.query to use client for the transaction
                const origQuery = pool.query.bind(pool);
                pool.query = client.query.bind(client);
                const result = fn(...args);
                // If fn returns a promise, await it
                if (result && typeof result.then === 'function') await result;
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                pool.query = origQuery;
                client.release();
            }
        };
    },
    async _queryOne(sql, params) {
        const result = await pool.query(sql, params);
        return result.rows[0] || null;
    },
    async _queryAll(sql, params) {
        const result = await pool.query(sql, params);
        return result.rows;
    },
    async _run(sql, params) {
        const result = await pool.query(sql, params);
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
    }
};

// ===== TABLE CREATION =====
async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            nama TEXT NOT NULL,
            jawatan TEXT NOT NULL,
            no_hp TEXT NOT NULL,
            email TEXT,
            no_plate TEXT NOT NULL,
            tujuan TEXT NOT NULL,
            tarikh_bertolak TEXT NOT NULL,
            tarikh_kembali TEXT NOT NULL,
            odo_sebelum INTEGER NOT NULL,
            odo_selepas INTEGER,
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL,
            approved_at TEXT,
            rejected_at TEXT,
            admin_notes TEXT DEFAULT '',
            returned_at TEXT
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nama TEXT NOT NULL,
            password_changed_at TEXT DEFAULT NULL,
            last_login_at TEXT DEFAULT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            request_id TEXT NOT NULL,
            type TEXT NOT NULL,
            recipient TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (request_id) REFERENCES requests(id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nama TEXT NOT NULL,
            jawatan TEXT DEFAULT '',
            no_hp TEXT DEFAULT '',
            email TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT NULL,
            last_login_at TEXT DEFAULT NULL
        )
    `);

    console.log('✅ Tables created/verified');

    // Insert default admin if not exists
    const adminResult = await pool.query('SELECT COUNT(*) as count FROM admins');
    if (parseInt(adminResult.rows[0].count) === 0) {
        await pool.query('INSERT INTO admins (username, password, nama) VALUES ($1, $2, $3)', ['admin', hashPassword('admin123'), 'Administrator']);
        console.log('✅ Default admin created (kata laluan di-hash)');
    }

    // Migrasi kata laluan teks kosong (format legasi) -> scrypt hash
    const plainAdmins = await pool.query("SELECT id, password FROM admins WHERE password NOT LIKE '%:%'");
    for (const row of plainAdmins.rows) {
        await pool.query('UPDATE admins SET password = $1 WHERE id = $2', [hashPassword(row.password), row.id]);
        console.log(`🔐 Admin '${row.id}' password migrated to hash`);
    }
    const plainUsers = await pool.query("SELECT id, password FROM users WHERE password NOT LIKE '%:%'");
    for (const row of plainUsers.rows) {
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(row.password), row.id]);
        console.log(`🔐 User '${row.id}' password migrated to hash`);
    }

    // ===== ANTI-DUPLICATE: kunci metadata permohonan ke pengguna yang log masuk =====
    try {
        await pool.query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS user_id INTEGER');
    } catch (e) {
        console.warn('⚠️ Could not add user_id column:', e.message);
    }

    // ===== BERSIHKAN DUPLICATE LEGASI (sebelum index unik dicipta) =====
    // Kumpul mengikut (no_hp, no_plate, tarikh_bertolak) pada status PENDING sahaja;
    // kekalkan rekod paling awal, padam sisanya.
    try {
        const cleanup = await pool.query(`
            DELETE FROM requests r
            USING requests keep
            WHERE r.status = 'pending' AND keep.status = 'pending'
              AND r.no_hp = keep.no_hp
              AND UPPER(r.no_plate) = UPPER(keep.no_plate)
              AND r.tarikh_bertolak = keep.tarikh_bertolak
              AND r.created_at > keep.created_at
        `);
        if (cleanup.rowCount > 0) {
            console.log(`🧹 Cleaned up ${cleanup.rowCount} duplicate pending request(s)`);
        }
    } catch (e) {
        console.warn('⚠️ Duplicate cleanup failed:', e.message);
    }

    // ===== ANTI-DUPLICATE (lapisan 3): index unik peringkat DB =====
    // Satu permohonan PENDING sahaja bagi setiap pengguna + kenderaan + tarikh bertolak.
    // Atomi (dikuatkuasakan PostgreSQL) — kekal berkuatkuasa walaupun selepas restart server.
    try {
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_one_pending
            ON requests (no_hp, UPPER(no_plate), tarikh_bertolak)
            WHERE status = 'pending'
        `);
        console.log('✅ Duplicate-protection index ready (one pending per user/vehicle/date)');
    } catch (e) {
        console.warn('⚠️ Duplicate-protection index not created (data sedia ada mungkin ada duplikat):', e.message);
    }

    // Cleanup orphaned notifications
    const orphanResult = await pool.query('DELETE FROM notifications WHERE request_id NOT IN (SELECT id FROM requests)');
    if (orphanResult.rowCount > 0) {
        console.log(`🧹 Cleaned up ${orphanResult.rowCount} orphaned notification(s)`);
    }
}

// ===== INITIALIZE NOTIFICATIONS =====
const notificationStatus = notifications.initialize();
console.log('📧 Email notifications:', notificationStatus.email ? 'ENABLED' : 'DISABLED');

// Helper: extract readable error message
function errMsg(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return error.message || error.detail || error.hint || JSON.stringify(error);
}

// ===== API ROUTES =====

// Get all requests
app.get('/api/requests', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let requests;
        
        if (status && status !== 'all') {
            requests = await db.prepare('SELECT * FROM requests WHERE status = $1 ORDER BY created_at DESC').all(status);
        } else {
            requests = await db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
        }
        
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get permohonan milik pengguna yang log masuk (token)
app.get('/api/requests/mine', requireUser, async (req, res) => {
    try {
        const mine = await db.prepare('SELECT * FROM requests WHERE user_id = $1 ORDER BY created_at DESC').all(req.user.id);
        res.json(mine);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get single request
app.get('/api/requests/:id', requireOwnerOrAdmin, async (req, res) => {
    try {
        const request = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        
        if (!request) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        res.json(request);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Normalize nombor telefon Malaysia kepada digit bermula 0 (0123456789).
// Terima 012-345 6789, +60123456789, 6012-345678, dll.
function normalizePhoneMY(raw) {
    let v = String(raw || '').trim();
    v = v.replace(/\(0\)/g, '');
    v = v.replace(/[^0-9+]/g, '');
    if (v.startsWith('+60')) v = '0' + v.slice(3);
    else if (v.startsWith('60') && v.length >= 10) v = '0' + v.slice(2);
    return v;
}

// Create new request
app.post('/api/requests', requireUser, async (req, res) => {
    try {
        let { nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas } = req.body;
        
        // Generate ID
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        
        // Validation
        if (!nama || !jawatan || !no_hp || !no_plate || !tujuan || !tarikh_bertolak || !tarikh_kembali || !odo_sebelum) {
            return res.status(400).json({ error: 'Semua ruangan wajib mesti diisi' });
        }

        // Normalize telefon sebelum apa-apa semakan/rekod
        no_hp = normalizePhoneMY(no_hp);
        if (!/^0[0-9]{9,10}$/.test(no_hp)) {
            return res.status(400).json({ error: 'Format nombor telefon tidak sah — guna 10–11 digit tanpa sengkang, bermula 0 (contoh: 0123456789)' });
        }

        // Server-side dedup LAYER 1: serangan pantas (in-memory, tetingkap 5 saat)
        const dedupKey = `${nama}|${no_hp}|${no_plate.toUpperCase()}|${tujuan}|${tarikh_bertolak}|${tarikh_kembali}|${odo_sebelum}`;
        if (isDuplicate(dedupKey)) {
            return res.status(429).json({ error: 'Permohonan sama telah dihantar. Sila tunggu sebentar.' });
        }

        // Server-side dedup LAYER 2: semakan database (bertahan merentas restart server,
        // melindungi retry lambat) — permohonan PENDING yang SAMA (nombor + kenderaan + tarikh)
        // dalam tetingkap 24 jam. Tujuan/odo tidak disertakan — double-submit selepas
        // pengeditan kecil masih dianggap duplicate.
        const dup = await db.prepare(`
            SELECT id, created_at FROM requests
            WHERE status = 'pending'
              AND UPPER(no_plate) = UPPER($1)
              AND no_hp = $2
              AND tarikh_bertolak = $3
              AND tarikh_kembali = $4
              AND created_at::timestamptz >= NOW() - INTERVAL '24 hours'
            LIMIT 1
        `).get(no_plate, no_hp, tarikh_bertolak, tarikh_kembali);
        if (dup) {
            return res.status(409).json({
                error: `Permohonan untuk kenderaan ini pada tarikh yang sama masih MENUNGGU kelulusan (dihantar ${dup.created_at}). Sila tunggu keputusan admin — jangan hantar semula.`
            });
        }
        
        try {
            await db.prepare(`
                INSERT INTO requests (id, nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas, status, created_at, user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', NOW()::TEXT, $12)
            `).run(id, nama, jawatan, no_hp, email || null, no_plate.toUpperCase(), tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas || null, req.user ? req.user.id : null);
        } catch (insertErr) {
            // Lapisan 3: unique partial index (23505) — perlindungan atomik dari race condition
            if (insertErr.code === '23505') {
                return res.status(409).json({
                    error: 'Permohonan PENDING untuk pengguna/kenderaan/tarikh yang sama sudah wujud. Tunggu keputusan admin terlebih dahulu.'
                });
            }
            throw insertErr;
        }
        
        const newRequest = await db.prepare('SELECT * FROM requests WHERE id = $1').get(id);
        res.status(201).json(newRequest);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Update request
app.put('/api/requests/:id', requireOwnerOrAdmin, async (req, res) => {
    try {
        const { nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas } = req.body;
        
        const existing = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        await db.prepare(`
            UPDATE requests 
            SET nama = $1, jawatan = $2, no_hp = $3, email = $4, no_plate = $5, tujuan = $6, tarikh_bertolak = $7, tarikh_kembali = $8, odo_sebelum = $9, odo_selepas = $10
            WHERE id = $11
        `).run(
            nama || existing.nama,
            jawatan || existing.jawatan,
            no_hp || existing.no_hp,
            email !== undefined ? email : existing.email,
            (no_plate || existing.no_plate).toUpperCase(),
            tujuan || existing.tujuan,
            tarikh_bertolak || existing.tarikh_bertolak,
            tarikh_kembali || existing.tarikh_kembali,
            odo_sebelum || existing.odo_sebelum,
            odo_selepas !== undefined ? odo_selepas : existing.odo_selepas,
            req.params.id
        );
        
        const updated = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Approve request
app.put('/api/requests/:id/approve', requireAdmin, async (req, res) => {
    try {
        const existing = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        await db.prepare(`
            UPDATE requests 
            SET status = 'approved', approved_at = NOW()::TEXT
            WHERE id = $1
        `).run(req.params.id);
        
        const updated = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        
        // Send notifications
        try {
            await notifications.sendNotification(updated, 'approved', db);
            console.log('✅ Notifications sent for approval:', updated.id);
        } catch (notifError) {
            console.error('⚠️ Notification error:', notifError.message);
        }
        
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Reject request
app.put('/api/requests/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { admin_notes } = req.body;
        
        const existing = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        await db.prepare(`
            UPDATE requests 
            SET status = 'rejected', rejected_at = NOW()::TEXT, admin_notes = $1
            WHERE id = $2
        `).run(admin_notes || '', req.params.id);
        
        const updated = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        
        // Send notifications
        try {
            await notifications.sendNotification(updated, 'rejected', db);
            console.log('✅ Notifications sent for rejection:', updated.id);
        } catch (notifError) {
            console.error('⚠️ Notification error:', notifError.message);
        }
        
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Return vehicle (user updates odo_selepas and marks as completed)
app.put('/api/requests/:id/return', requireOwnerOrAdmin, async (req, res) => {
    try {
        const { odo_selepas } = req.body;

        const existing = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }

        if (existing.status !== 'approved') {
            return res.status(400).json({ error: 'Hanya permohonan yang diluluskan boleh dikembalikan' });
        }

        if (!odo_selepas || odo_selepas < existing.odo_sebelum) {
            return res.status(400).json({ error: 'Odo meter selepas mesti lebih besar daripada odo meter sebelum' });
        }

        await db.prepare(
            `UPDATE requests SET odo_selepas = $1, status = 'completed', returned_at = NOW()::TEXT WHERE id = $2`
        ).run(odo_selepas, req.params.id);

        const updated = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Delete request (use transaction to avoid FK constraint issues)
app.delete('/api/requests/:id', requireAdmin, async (req, res) => {
    try {
        const existing = await db.prepare('SELECT * FROM requests WHERE id = $1').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        // Use transaction to ensure atomicity
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM notifications WHERE request_id = $1', [req.params.id]);
            await client.query('DELETE FROM requests WHERE id = $1', [req.params.id]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        
        res.json({ message: 'Permohonan berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get statistics
app.get('/api/stats', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'approved') as approved,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
                COUNT(*) FILTER (WHERE status = 'completed') as completed
            FROM requests
        `);
        const row = result.rows[0];
        res.json({
            total: parseInt(row.total),
            pending: parseInt(row.pending),
            approved: parseInt(row.approved),
            rejected: parseInt(row.rejected),
            completed: parseInt(row.completed)
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get notifications log
app.get('/api/notifications', requireAdmin, async (req, res) => {
    try {
        const { request_id } = req.query;
        let notificationsList;
        
        if (request_id) {
            notificationsList = await db.prepare('SELECT * FROM notifications WHERE request_id = $1 ORDER BY created_at DESC').all(request_id);
        } else {
            notificationsList = await db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all();
        }
        
        res.json(notificationsList);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Uji hantar notifikasi (emel ujian tanpa permohonan sebenar)
app.post('/api/admin/notifications/test', requireAdmin, async (req, res) => {
    try {
        const { channel = 'both', recipient } = req.body || {};
        const results = {};
        const testReq = {
            id: 'test',
            nama: 'Pentadbir Sistem',
            no_plate: 'UJI 000 X',
            tarikh_bertolak: new Date().toISOString().split('T')[0],
            tarikh_kembali: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            tujuan: 'Ujian penghantaran daripada Panel Admin',
            admin_notes: ''
        };
        if (channel === 'sms') {
            return res.status(400).json({ error: 'SMS telah dibuang (2026-09-18) — sistem menggunakan notifikasi emel sahaja (Brevo).' });
        }
        if (channel === 'email' || channel === 'both') {
            let to = (recipient && recipient.includes('@')) ? recipient.trim() : '';
            if (!to && process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your-email@gmail.com') to = process.env.EMAIL_USER;
            if (!to) return res.status(400).json({ error: 'Tiada alamat emel sasaran. Isi kredensial EMAIL_USER dahulu atau nyatakan alamat.' });
            results.email = { to, ...(await notifications.sendEmail(to, '✅ Emel Ujian - Sistem Penggunaan Kenderaan', notifications.generateApprovalEmail(testReq))) };
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// ===== AUTHENTICATION =====
// ===== RATE LIMITING (lindungi endpoint login daripada brute-force) =====
const rateBuckets = new Map();

function clientIp(req) {
    const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit({ windowMs, max, message, keyGen }) {
    return (req, res, next) => {
        const key = keyGen(req);
        const now = Date.now();
        const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
        if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
        bucket.count += 1;
        rateBuckets.set(key, bucket);
        if (bucket.count > max) {
            const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({ error: `${message} Sila cuba lagi dalam ${retryAfter} saat.` });
        }
        next();
    };
}

// Bersihkan bucket yang luput supaya memori tidak membengkak
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(k);
}, 5 * 60 * 1000).unref();

const loginKey = (req) => `login:${clientIp(req)}:${String((req.body && req.body.username) || '').toLowerCase()}`;
const ipKey = (req) => `iplogin:${clientIp(req)}`;

// Lapisan 1: maksimum 5 cubaan per akaun (IP + username) dalam 15 minit
const loginAccountLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGen: loginKey, message: 'Terlalu banyak cubaan log masuk untuk akaun ini.' });
// Lapisan 2: maksimum 20 cubaan per IP (melintasi semua akaun) dalam 15 minit — halang password spraying
const loginIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyGen: ipKey, message: 'Terlalu banyak cubaan log masuk dari rangkaian ini.' });
// Pendaftaran: maksimum 3 akaun per IP dalam sejam — halang spam akaun
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyGen: (req) => `register:${clientIp(req)}`, message: 'Terlalu banyak pendaftaran dari rangkaian ini.' });

function clearLoginRate(req) { rateBuckets.delete(loginKey(req)); }

app.post('/api/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const admin = await db.prepare('SELECT * FROM admins WHERE username = $1').get(username);
        
        if (admin && verifyPassword(password, admin.password)) {
            clearLoginRate(req);
            await db.prepare("UPDATE admins SET last_login_at = NOW()::TEXT WHERE id = $1").run(admin.id);
            
            res.json({ 
                success: true,
                username: admin.username,
                nama: admin.nama,
                token: signToken({ t: 'admin', u: admin.username, exp: Date.now() + 12 * 60 * 60 * 1000 }),
                password_changed_at: admin.password_changed_at,
                last_login_at: new Date().toISOString()
            });
        } else {
            res.status(401).json({ success: false, error: 'Nama pengguna atau kata laluan salah' });
        }
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// ===== PASSWORD MANAGEMENT =====

// Change password
app.put('/api/admin/change-password', requireAdmin, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Semua ruangan mesti diisi' });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'Kata laluan baru mesti sekurang-kurangnya 6 aksara' });
        }
        
        const admin = await db.prepare('SELECT * FROM admins WHERE username = $1').get(req.admin.u);
        
        if (!admin || !verifyPassword(current_password, admin.password)) {
            return res.status(401).json({ error: 'Kata laluan semasa salah' });
        }
        
        await db.prepare("UPDATE admins SET password = $1, password_changed_at = NOW()::TEXT WHERE id = $2").run(hashPassword(new_password), admin.id);
        
        res.json({ success: true, message: 'Kata laluan berjaya ditukar' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Reset password to default
app.put('/api/admin/reset-password', requireAdmin, async (req, res) => {
    try {
        const admin = await db.prepare('SELECT * FROM admins WHERE username = $1').get(req.admin.u);
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin tidak ditemui' });
        }
        
        await db.prepare('UPDATE admins SET password = $1, password_changed_at = NULL WHERE id = $2').run(hashPassword('admin123'), admin.id);
        
        res.json({ 
            success: true,
            message: 'Kata laluan berjaya direset ke lalai',
            default_password: 'admin123'
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Status notifikasi: konfigurasi emel + ringkasan kejayaan penghantaran
app.get('/api/admin/notifications/status', requireAdmin, async (req, res) => {
    try {
        const rows = await db.prepare('SELECT type, status, COUNT(*) AS n FROM notifications GROUP BY type, status').all();
        const summary = { email: { sent: 0, failed: 0 } }; // SMS dibuang (2026-09-18); rekod legasi sms diabaikan
        for (const r of rows) {
            const t = (r.type || '').toLowerCase();
            if (t !== 'email') continue;
            if (summary[t] && (r.status === 'sent' || r.status === 'failed')) summary[t][r.status] = parseInt(r.n);
        }
        const recentRows = await db.prepare('SELECT id, type, recipient, status, error_message, created_at FROM notifications ORDER BY id DESC LIMIT 15').all();
        const recent = recentRows.map(r => ({
            type: r.type,
            recipient: r.recipient,
            status: r.status,
            error: r.error_message,
            created_at: r.created_at
        }));
        res.json({
            config: {
                email: {
                    configured: notifications.isEmailConfigured(),
                    provider: notifications.getEmailProvider(), // 'brevo' (API HTTP) atau 'smtp'
                    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
                    port: process.env.EMAIL_PORT || '587',
                    user: process.env.EMAIL_USER || '',
                    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '' // pengirim sebenar (Brevo)
                },
                sms: {
                    configured: false,
                    removed: true,
                    note: 'SMS dibuang 2026-09-18 — notifikasi emel sahaja (Brevo)'
                }
            },
            summary,
            recent
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get admin info
app.get('/api/admin/info', requireAdmin, async (req, res) => {
    try {
        const admin = await db.prepare('SELECT username, nama, password_changed_at, last_login_at FROM admins WHERE username = $1').get(req.admin.u);
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin tidak ditemui' });
        }
        
        res.json(admin);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// ===== USER MANAGEMENT =====

// User registration
app.post('/api/users/register', registerLimiter, async (req, res) => {
    try {
        const { username, password, nama, jawatan, no_hp, email } = req.body;
        
        if (!username || !password || !nama) {
            return res.status(400).json({ error: 'Nama pengguna, kata laluan, dan nama penuh wajib diisi' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'Nama pengguna mesti sekurang-kurangnya 3 aksara' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Kata laluan mesti sekurang-kurangnya 6 aksara' });
        }
        
        const existing = await db.prepare('SELECT id FROM users WHERE username = $1').get(username);
        if (existing) {
            return res.status(400).json({ error: 'Nama pengguna telah digunakan' });
        }
        
        let regPhone = no_hp ? normalizePhoneMY(no_hp) : '';
        if (regPhone && !/^0[0-9]{9,10}$/.test(regPhone)) {
            return res.status(400).json({ error: 'Format nombor telefon tidak sah — guna 10–11 digit tanpa sengkang, bermula 0 (contoh: 0123456789)' });
        }
        
        const result = await pool.query(
            "INSERT INTO users (username, password, nama, jawatan, no_hp, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()::TEXT) RETURNING id",
            [username, hashPassword(password), nama, jawatan || '', regPhone, email || '']
        );
        
        res.status(201).json({ success: true, message: 'Pendaftaran berjaya', userId: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// User login
app.post('/api/users/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Nama pengguna dan kata laluan wajib diisi' });
        }
        
        const user = await db.prepare('SELECT * FROM users WHERE username = $1').get(username);
        
        if (!user || !user.is_active || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'Nama pengguna atau kata laluan salah' });
        }
        
        clearLoginRate(req);
        await db.prepare("UPDATE users SET last_login_at = NOW()::TEXT WHERE id = $1").run(user.id);
        
        res.json({
            success: true,
            token: signToken({ t: 'user', id: user.id, u: user.username, exp: Date.now() + 12 * 60 * 60 * 1000 }),
            user: {
                id: user.id,
                username: user.username,
                nama: user.nama,
                jawatan: user.jawatan,
                no_hp: user.no_hp,
                email: user.email
            }
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get all users (admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const users = await db.prepare('SELECT id, username, nama, jawatan, no_hp, email, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC').all();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Toggle user active status (admin only)
app.put('/api/users/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemui' });
        }
        
        const newStatus = user.is_active ? 0 : 1;
        await db.prepare('UPDATE users SET is_active = $1 WHERE id = $2').run(newStatus, req.params.id);
        
        res.json({ success: true, is_active: newStatus, message: newStatus ? 'Pengguna diaktifkan' : 'Pengguna dinyahaktifkan' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemui' });
        }
        
        await db.prepare('DELETE FROM users WHERE id = $1').run(req.params.id);
        res.json({ success: true, message: 'Pengguna berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Get user stats (admin only)
app.get('/api/users/stats', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_active = 1) as active,
                COUNT(*) FILTER (WHERE is_active = 0) as inactive
            FROM users
        `);
        const row = result.rows[0];
        res.json({
            total: parseInt(row.total),
            active: parseInt(row.active),
            inactive: parseInt(row.inactive)
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// ===== DANGER ZONE =====

// Reset all requests data
app.delete('/api/admin/reset-data', requireAdmin, async (req, res) => {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM notifications');
            await client.query('DELETE FROM requests');
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
        res.json({ success: true, message: 'Semua data berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Reset all users
app.put('/api/admin/reset-users', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM users');
        res.json({ success: true, message: 'Semua pengguna berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Reset to default password
app.put('/api/admin/reset-to-default', requireAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE admins SET password = $1, password_changed_at = NULL", [hashPassword('admin123')]);
        
        res.json({ 
            success: true,
            message: 'Kata laluan berjaya direset ke lalai',
            default_password: defaultPassword
        });
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Export data as CSV
app.get('/api/export', requireAdmin, async (req, res) => {
    try {
        const requests = await db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
        
        const headers = ['Nama', 'Jawatan', 'No. HP', 'Emel', 'No. Plate', 'Tujuan', 'Tarikh Bertolak', 'Tarikh Kembali', 'Odo Sebelum', 'Odo Selepas', 'Jarak', 'Status', 'Tarikh Kembali Kenderaan'];
        const rows = requests.map(r => [
            r.nama,
            r.jawatan,
            r.no_hp,
            r.email || '',
            r.no_plate,
            r.tujuan,
            r.tarikh_bertolak,
            r.tarikh_kembali,
            r.odo_sebelum,
            r.odo_selepas || '',
            r.odo_selepas ? (r.odo_selepas - r.odo_sebelum) : '',
            r.status,
            r.returned_at || ''
        ]);
        
        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        const filename = `permohonan_kenderaan_${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csvContent);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// ===== BACKUP & RESTORE =====

// Backup all data as JSON
app.get('/api/admin/backup', requireAdmin, async (req, res) => {
    try {
        const requests = await db.prepare('SELECT * FROM requests ORDER BY created_at ASC').all();
        const users = await db.prepare('SELECT id, username, nama, jawatan, no_hp, email, is_active, created_at, last_login_at FROM users ORDER BY created_at ASC').all();
        const admins = await db.prepare('SELECT * FROM admins ORDER BY id ASC').all();
        const notifs = await db.prepare('SELECT * FROM notifications ORDER BY created_at ASC').all();

        const backup = {
            version: 1,
            exported_at: new Date().toISOString(),
            app_name: 'Sistem Penggunaan Kenderaan CSB',
            data: {
                requests,
                users,
                admins,
                notifications: notifs
            },
            counts: {
                requests: requests.length,
                users: users.length,
                admins: admins.length,
                notifications: notifs.length
            }
        };

        const filename = `backup_kenderaan_${new Date().toISOString().split('T')[0]}.json`;

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(backup);
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Restore data from JSON backup
app.post('/api/admin/restore', requireAdmin, async (req, res) => {
    try {
        const { backup } = req.body;

        if (!backup || !backup.data) {
            return res.status(400).json({ error: 'Format backup tidak sah' });
        }

        const { requests, users, admins, notifications } = backup.data;

        // Use a single transaction for atomicity
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Clear existing data (notifications first due to FK)
            await client.query('DELETE FROM notifications');
            await client.query('DELETE FROM requests');
            await client.query('DELETE FROM users');
            await client.query('DELETE FROM admins');

            // Restore admins (preserve structure)
            if (admins && admins.length > 0) {
                for (const a of admins) {
                    await client.query(
                        `INSERT INTO admins (id, username, password, nama, password_changed_at, last_login_at)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (username) DO UPDATE SET
                         password = EXCLUDED.password, nama = EXCLUDED.nama,
                         password_changed_at = EXCLUDED.password_changed_at, last_login_at = EXCLUDED.last_login_at`,
                        [a.id, a.username, a.password, a.nama, a.password_changed_at, a.last_login_at]
                    );
                }
            }

            // Restore users
            if (users && users.length > 0) {
                for (const u of users) {
                    await client.query(
                        `INSERT INTO users (id, username, password, nama, jawatan, no_hp, email, is_active, created_at, last_login_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         ON CONFLICT (username) DO UPDATE SET
                         password = EXCLUDED.password, nama = EXCLUDED.nama, jawatan = EXCLUDED.jawatan,
                         no_hp = EXCLUDED.no_hp, email = EXCLUDED.email, is_active = EXCLUDED.is_active`,
                        [u.id, u.username, u.password, u.nama, u.jawatan || '', u.no_hp || '', u.email || '', u.is_active ?? 1, u.created_at, u.last_login_at]
                    );
                }
            }

            // Restore requests
            if (requests && requests.length > 0) {
                for (const r of requests) {
                    await client.query(
                        `INSERT INTO requests (id, nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas, status, created_at, approved_at, rejected_at, admin_notes, returned_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                         ON CONFLICT (id) DO NOTHING`,
                        [r.id, r.nama, r.jawatan, r.no_hp, r.email, r.no_plate, r.tujuan, r.tarikh_bertolak, r.tarikh_kembali, r.odo_sebelum, r.odo_selepas, r.status, r.created_at, r.approved_at, r.rejected_at, r.admin_notes || '', r.returned_at]
                    );
                }
            }

            // Restore notifications
            if (notifications && notifications.length > 0) {
                for (const n of notifications) {
                    await client.query(
                        `INSERT INTO notifications (id, request_id, type, recipient, status, error_message, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         ON CONFLICT DO NOTHING`,
                        [n.id, n.request_id, n.type, n.recipient, n.status, n.error_message, n.created_at]
                    );
                }
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Data berjaya dipulihkan',
                restored: {
                    requests: requests?.length || 0,
                    users: users?.length || 0,
                    admins: admins?.length || 0,
                    notifications: notifications?.length || 0
                }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ error: errMsg(error) });
    }
});

// Health check (pings the database for real, not just checks the env var)
app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        db: false,
        databaseUrl: !!process.env.DATABASE_URL,
        dbError: null,
        timestamp: new Date().toISOString()
    };
    try {
        await pool.query('SELECT 1');
        health.db = true;
    } catch (err) {
        health.status = 'degraded';
        health.dbError = err.code ? `${err.code}: ${err.message}` : (err.message || String(err));
    }
    res.json(health);
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get local network IP addresses
const os = require('os');

function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({
                    name: name,
                    address: iface.address
                });
            }
        }
    }
    return addresses;
}

// Start server
async function startServer() {
    try {
        await initDatabase();
    } catch (error) {
        console.error('⚠️ Database init failed:', error.message || error);
        console.error(error.stack || '');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n========================================');
        console.log('🚗 SISTEM PENGGUNAAN KENDERAAN');
        console.log('========================================');
        console.log(`✅ Server berjalan di port ${PORT}`);
        console.log(`📊 Database: PostgreSQL\n`);
        
        console.log('🌐 Akses Portal:');
        console.log(`   • Local:    http://localhost:${PORT}`);
        
        const networkIPs = getNetworkIPs();
        if (networkIPs.length > 0) {
            console.log('\n📱 Akses dari Peranti Lain (WiFi/LAN):');
            networkIPs.forEach(ip => {
                console.log(`   • ${ip.name}: http://${ip.address}:${PORT}`);
            });
        }
        console.log('========================================\n');
    });
}

startServer();
