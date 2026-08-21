const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const notifications = require('./notifications');

const app = express();
const PORT = 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== DATABASE SETUP =====
const db = new Database('vehicle_requests.db');

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
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
        admin_notes TEXT DEFAULT ''
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nama TEXT NOT NULL,
        password_changed_at TEXT DEFAULT NULL,
        last_login_at TEXT DEFAULT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        type TEXT NOT NULL,
        recipient TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES requests(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

// ===== MIGRATION: Add missing columns to admins table =====
try {
    const columns = db.prepare("PRAGMA table_info(admins)").all().map(c => c.name);
    if (!columns.includes('password_changed_at')) {
        db.exec("ALTER TABLE admins ADD COLUMN password_changed_at TEXT DEFAULT NULL");
        console.log('✅ Added password_changed_at column to admins table');
    }
    if (!columns.includes('last_login_at')) {
        db.exec("ALTER TABLE admins ADD COLUMN last_login_at TEXT DEFAULT NULL");
        console.log('✅ Added last_login_at column to admins table');
    }
} catch (error) {
    console.warn('⚠️ Migration warning:', error.message);
}

// Insert default admin if not exists
const adminExists = db.prepare('SELECT COUNT(*) as count FROM admins').get();
if (adminExists.count === 0) {
    db.prepare('INSERT INTO admins (username, password, nama) VALUES (?, ?, ?)').run('admin', 'admin123', 'Administrator');
}

// ===== INITIALIZE NOTIFICATIONS =====
const notificationStatus = notifications.initialize();
console.log('📧 Email notifications:', notificationStatus.email ? 'ENABLED' : 'DISABLED');
console.log('📱 SMS notifications:', notificationStatus.sms ? 'ENABLED' : 'DISABLED');

// ===== API ROUTES =====

// Get all requests
app.get('/api/requests', (req, res) => {
    try {
        const { status } = req.query;
        let requests;
        
        if (status && status !== 'all') {
            requests = db.prepare('SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC').all(status);
        } else {
            requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
        }
        
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single request
app.get('/api/requests/:id', (req, res) => {
    try {
        const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        
        if (!request) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        res.json(request);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new request
app.post('/api/requests', (req, res) => {
    try {
        const { nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas } = req.body;
        
        // Generate ID
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        
        // Validation
        if (!nama || !jawatan || !no_hp || !no_plate || !tujuan || !tarikh_bertolak || !tarikh_kembali || !odo_sebelum) {
            return res.status(400).json({ error: 'Semua ruangan wajib mesti diisi' });
        }
        
        const stmt = db.prepare(`
            INSERT INTO requests (id, nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `);
        
        stmt.run(id, nama, jawatan, no_hp, email || null, no_plate.toUpperCase(), tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas || null);
        
        const newRequest = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
        res.status(201).json(newRequest);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update request
app.put('/api/requests/:id', (req, res) => {
    try {
        const { nama, jawatan, no_hp, email, no_plate, tujuan, tarikh_bertolak, tarikh_kembali, odo_sebelum, odo_selepas } = req.body;
        
        const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        const stmt = db.prepare(`
            UPDATE requests 
            SET nama = ?, jawatan = ?, no_hp = ?, email = ?, no_plate = ?, tujuan = ?, tarikh_bertolak = ?, tarikh_kembali = ?, odo_sebelum = ?, odo_selepas = ?
            WHERE id = ?
        `);
        
        stmt.run(
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
        
        const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Approve request
app.put('/api/requests/:id/approve', async (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        const stmt = db.prepare(`
            UPDATE requests 
            SET status = 'approved', approved_at = datetime('now')
            WHERE id = ?
        `);
        
        stmt.run(req.params.id);
        
        const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        
        // Send notifications
        try {
            await notifications.sendNotification(updated, 'approved', db);
            console.log('✅ Notifications sent for approval:', updated.id);
        } catch (notifError) {
            console.error('⚠️ Notification error:', notifError.message);
        }
        
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reject request
app.put('/api/requests/:id/reject', async (req, res) => {
    try {
        const { admin_notes } = req.body;
        
        const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        const stmt = db.prepare(`
            UPDATE requests 
            SET status = 'rejected', rejected_at = datetime('now'), admin_notes = ?
            WHERE id = ?
        `);
        
        stmt.run(admin_notes || '', req.params.id);
        
        const updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        
        // Send notifications
        try {
            await notifications.sendNotification(updated, 'rejected', db);
            console.log('✅ Notifications sent for rejection:', updated.id);
        } catch (notifError) {
            console.error('⚠️ Notification error:', notifError.message);
        }
        
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete request
app.delete('/api/requests/:id', (req, res) => {
    try {
        const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Permohonan tidak ditemui' });
        }
        
        db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
        res.json({ message: 'Permohonan berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get statistics
app.get('/api/stats', (req, res) => {
    try {
        const total = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
        const pending = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'").get().count;
        const approved = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'approved'").get().count;
        const rejected = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'rejected'").get().count;
        
        res.json({ total, pending, approved, rejected });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get notifications log
app.get('/api/notifications', (req, res) => {
    try {
        const { request_id } = req.query;
        let notificationsList;
        
        if (request_id) {
            notificationsList = db.prepare('SELECT * FROM notifications WHERE request_id = ? ORDER BY created_at DESC').all(request_id);
        } else {
            notificationsList = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all();
        }
        
        res.json(notificationsList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== AUTHENTICATION =====
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
        
        if (admin) {
            // Update last login time
            db.prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(admin.id);
            
            res.json({ 
                success: true, 
                username: admin.username, 
                nama: admin.nama,
                password_changed_at: admin.password_changed_at,
                last_login_at: new Date().toISOString()
            });
        } else {
            res.status(401).json({ success: false, error: 'Nama pengguna atau kata laluan salah' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== PASSWORD MANAGEMENT =====

// Change password
app.put('/api/admin/change-password', (req, res) => {
    try {
        const { username, current_password, new_password } = req.body;
        
        // Validation
        if (!username || !current_password || !new_password) {
            return res.status(400).json({ error: 'Semua ruangan mesti diisi' });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'Kata laluan baru mesti sekurang-kurangnya 6 aksara' });
        }
        
        // Verify current password
        const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, current_password);
        
        if (!admin) {
            return res.status(401).json({ error: 'Kata laluan semasa salah' });
        }
        
        // Update password
        db.prepare("UPDATE admins SET password = ?, password_changed_at = datetime('now') WHERE id = ?").run(new_password, admin.id);
        
        res.json({ success: true, message: 'Kata laluan berjaya ditukar' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset password to default
app.put('/api/admin/reset-password', (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Nama pengguna diperlukan' });
        }
        
        // Check if admin exists
        const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin tidak ditemui' });
        }
        
        // Reset to default password
        const defaultPassword = 'admin123';
        db.prepare('UPDATE admins SET password = ?, password_changed_at = NULL WHERE id = ?').run(defaultPassword, admin.id);
        
        res.json({ 
            success: true, 
            message: 'Kata laluan berjaya direset ke lalai',
            default_password: defaultPassword
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get admin info
app.get('/api/admin/info', (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ error: 'Nama pengguna diperlukan' });
        }
        
        const admin = db.prepare('SELECT username, nama, password_changed_at, last_login_at FROM admins WHERE username = ?').get(username);
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin tidak ditemui' });
        }
        
        res.json(admin);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== USER MANAGEMENT =====

// User registration
app.post('/api/users/register', (req, res) => {
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
        
        // Check if username already exists
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'Nama pengguna telah digunakan' });
        }
        
        const stmt = db.prepare(
            "INSERT INTO users (username, password, nama, jawatan, no_hp, email, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
        );
        const result = stmt.run(username, password, nama, jawatan || '', no_hp || '', email || '');
        
        res.status(201).json({ success: true, message: 'Pendaftaran berjaya', userId: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// User login
app.post('/api/users/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Nama pengguna dan kata laluan wajib diisi' });
        }
        
        const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ? AND is_active = 1').get(username, password);
        
        if (!user) {
            return res.status(401).json({ error: 'Nama pengguna atau kata laluan salah' });
        }
        
        // Update last login
        db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
        
        res.json({
            success: true,
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
        res.status(500).json({ error: error.message });
    }
});

// Get all users (admin only)
app.get('/api/users', (req, res) => {
    try {
        const users = db.prepare('SELECT id, username, nama, jawatan, no_hp, email, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC').all();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Toggle user active status (admin only)
app.put('/api/users/:id/toggle', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemui' });
        }
        
        const newStatus = user.is_active ? 0 : 1;
        db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);
        
        res.json({ success: true, is_active: newStatus, message: newStatus ? 'Pengguna diaktifkan' : 'Pengguna dinyahaktifkan' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemui' });
        }
        
        db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'Pengguna berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user stats (admin only)
app.get('/api/users/stats', (req, res) => {
    try {
        const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const active = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
        const inactive = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 0').get().count;
        res.json({ total, active, inactive });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== DANGER ZONE =====

// Reset all requests data
app.delete('/api/admin/reset-data', (req, res) => {
    try {
        db.prepare('DELETE FROM requests').run();
        db.prepare('DELETE FROM notifications').run();
        res.json({ success: true, message: 'Semua data berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset all users
app.put('/api/admin/reset-users', (req, res) => {
    try {
        db.prepare('DELETE FROM users').run();
        res.json({ success: true, message: 'Semua pengguna berjaya dipadam' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset to default password
app.put('/api/admin/reset-to-default', (req, res) => {
    try {
        const defaultPassword = 'admin123';
        db.prepare('UPDATE admins SET password = ?, password_changed_at = NULL').run(defaultPassword);
        
        res.json({ 
            success: true, 
            message: 'Kata laluan berjaya direset ke lalai',
            default_password: defaultPassword
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export data as CSV
app.get('/api/export', (req, res) => {
    try {
        const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
        
        const headers = ['Nama', 'Jawatan', 'No. HP', 'Emel', 'No. Plate', 'Tujuan', 'Tarikh Bertolak', 'Tarikh Kembali', 'Odo Sebelum', 'Odo Selepas', 'Status'];
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
            r.status
        ]);
        
        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        const filename = `permohonan_kenderaan_${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csvContent);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
            // Skip internal (loopback) and non-IPv4 addresses
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

// Start server on all network interfaces (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🚗 SISTEM PENGGUNAAN KENDERAAN');
    console.log('========================================');
    console.log(`✅ Server berjalan di port ${PORT}`);
    console.log(`📊 Database: vehicle_requests.db\n`);
    
    console.log('🌐 Akses Portal:');
    console.log(`   • Local:    http://localhost:${PORT}`);
    
    const networkIPs = getNetworkIPs();
    if (networkIPs.length > 0) {
        console.log('\n📱 Akses dari Peranti Lain (WiFi/LAN):');
        networkIPs.forEach(ip => {
            console.log(`   • ${ip.name}: http://${ip.address}:${PORT}`);
        });
    } else {
        console.log('\n⚠️  Tiada IP rangkaian ditemui.');
    }
    
    console.log('\n📋 URL untuk dikongsi kepada pengguna:');
    if (networkIPs.length > 0) {
        console.log(`   Pengguna: http://${networkIPs[0]?.address || 'YOUR_IP'}:${PORT}`);
        console.log(`   Admin:    http://${networkIPs[0]?.address || 'YOUR_IP'}:${PORT}/admin`);
    }
    console.log('========================================\n');
});
