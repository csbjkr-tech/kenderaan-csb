// ===== API BASE URL =====
const API_URL = '';

function getAdminToken() {
    // Token dari log masuk semasa; fallback ke meta tag yang disuntik server
    // (sesi yang masih hidup selepas deploy, tanpa log masuk semula)
    return localStorage.getItem('adminToken') ||
        (document.querySelector('meta[name="csrf-token"]')?.content || '').trim();
}
function getUserToken() { return localStorage.getItem('userToken') || ''; }

function isAuthError(err) {
    return typeof err?.message === 'string' &&
        (err.message.includes('log masuk semula') || err.message.includes('Sila log masuk'));
}

function handleAuthError(err) {
    if (!isAuthError(err)) return false;
    showToast('Sesi telah tamat — sila log masuk semula.', 'error');
    setTimeout(() => logout(), 1200);
    return true;
}

// ===== API HELPER FUNCTIONS =====
// ===== DATABASE UNAVAILABLE DETECTION =====
// Server /api/* memulangkan HTTP 500/503 bila database tak dapat dihubungi
// (ECONNREFUSED, SASL, dsb.), dan 400 untuk ralat input pengguna.
// Jadi: >=500 atau fetch gagal total => papar banner mesra + butang cuba semula.
const dbErrorState = { down: false };

function apiIsDbDown(err, res) {
    if (res && (res.status >= 500)) return true;
    if (err instanceof TypeError) return true; // fetch gagal total (rangkaian/server mati)
    return false;
}

function setGlobalDbRetry(fn) {
    window.__dbRetryFn = fn;
}

function clearDbErrorState() {
    if (!dbErrorState.down) return;
    dbErrorState.down = false;
    document.querySelectorAll('.db-error-banner').forEach(b => b.remove());
}

function renderDbErrorBanner(container) {
    if (!container || container.querySelector('.db-error-banner')) return;
    dbErrorState.down = true;
    const el = document.createElement('div');
    el.className = 'db-error-banner';
    el.innerHTML = `
        <div class="db-error-icon">🔌</div>
        <div class="db-error-text">
            <strong>Database tidak tersedia</strong>
            <p>Sistem tidak dapat menghubungi pelayan data buat masa ini. Sila cuba semula sebentar lagi.</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm db-retry-btn" onclick="window.__dbRetryFn && window.__dbRetryFn()">🔄 Cuba Semula</button>`;
    container.appendChild(el);
}

async function apiGet(endpoint) {
    try {
        const response = await fetch(`${API_URL}${endpoint}`, { headers: { 'Authorization': `Bearer ${getAdminToken()}`, 'X-User-Token': getUserToken() } });
        if (!response.ok) {
            let body = null;
            try { body = await response.json(); } catch (_) { /* body bukan JSON */ }
            if (apiIsDbDown(null, { status: response.status, body })) dbErrorState.down = true;
            throw new Error((body && body.error && typeof body.error === 'string') ? body.error : 'Ralat semasa mengambil data');
        }
        clearDbErrorState();
        return response.json();
    } catch (err) {
        if (apiIsDbDown(err)) dbErrorState.down = true;
        throw err;
    }
}

async function apiPost(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}`, 'X-User-Token': getUserToken() },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Ralat semasa menghantar data');
    }
    return response.json();
}

async function apiPut(endpoint, data = null) {
    const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAdminToken()}`, 'X-User-Token': getUserToken() },
    };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(`${API_URL}${endpoint}`, options);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Ralat semasa mengemas kini data');
    }
    return response.json();
}

async function apiDelete(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getAdminToken()}`, 'X-User-Token': getUserToken() } });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Ralat semasa memadam data');
    }
    return response.json();
}

// ===== AUTHENTICATION =====
const AUTH_KEY = 'adminAuth';

function isLoggedIn() {
    return localStorage.getItem(AUTH_KEY) === 'true';
}

async function login(username, password) {
    try {
        const result = await apiPost('/api/login', { username, password });
        if (result.success) {
            localStorage.setItem(AUTH_KEY, 'true');
            localStorage.setItem('adminName', result.username);
            localStorage.setItem('adminToken', result.token || '');
            startInactivityTimer();
            startAutoRefresh();
            return { success: true, nama: result.nama };
        }
        return { success: false };
    } catch (error) {
        return { success: false, error: dbErrorState.down ? '🔌 Database tidak tersedia. Sila cuba semula sebentar lagi.' : error.message };
    }
}

function logout() {
    clearInactivityTimer();
    stopAutoRefresh();
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('adminName');
    localStorage.removeItem('adminToken');
    window.location.reload();
}

// ===== AUTO REFRESH =====
let autoRefreshTimer = null;
let autoRefreshCountdown = null;
let autoRefreshTimeLeft = 60;
const AUTO_REFRESH_INTERVAL = 60 * 1000;

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimeLeft = 60;
    updateAutoRefreshDisplay();
    autoRefreshTimer = setTimeout(() => autoRefreshData(), AUTO_REFRESH_INTERVAL);
    autoRefreshCountdown = setInterval(() => {
        autoRefreshTimeLeft--;
        updateAutoRefreshDisplay();
        if (autoRefreshTimeLeft <= 0) autoRefreshTimeLeft = 60;
    }, 1000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) { clearTimeout(autoRefreshTimer); autoRefreshTimer = null; }
    if (autoRefreshCountdown) { clearInterval(autoRefreshCountdown); autoRefreshCountdown = null; }
}

function resetAutoRefresh() { stopAutoRefresh(); startAutoRefresh(); }

function autoRefreshData() {
    const requestsTab = document.getElementById('requestsTab');
    if (requestsTab && !requestsTab.classList.contains('hidden')) {
        loadAdminData().then(() => showAutoRefreshFeedback()).catch(console.error);
    }
    startAutoRefresh();
}

function updateAutoRefreshDisplay() {
    const el = document.getElementById('autoRefreshCountdown');
    if (el) el.textContent = autoRefreshTimeLeft;
}

function showAutoRefreshFeedback() {
    const f = document.createElement('div');
    f.className = 'auto-refresh-feedback';
    f.innerHTML = '🔄 Data automatik disegar';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1500);
}

// ===== REFRESH PAGE =====
function refreshPage() {
    const btn = document.querySelector('.admin-info .btn-secondary');
    if (btn) { btn.innerHTML = '🔄 Menyegar...'; btn.disabled = true; }
    loadAdminData().then(() => {
        if (btn) { btn.innerHTML = '🔄 Refresh'; btn.disabled = false; }
        resetInactivityTimer();
        resetAutoRefresh();
        showRefreshFeedback();
    }).catch(err => {
        if (btn) { btn.innerHTML = '🔄 Refresh'; btn.disabled = false; }
        console.error('Refresh error:', err);
    });
}

function showRefreshFeedback() {
    const f = document.createElement('div');
    f.className = 'refresh-feedback';
    f.innerHTML = '✅ Data telah disegar!';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 2000);
}

// ===== INACTIVITY TIMER =====
let inactivityTimer = null, warningTimer = null, countdownInterval = null;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;
const WARNING_TIMEOUT = 4 * 60 * 1000;

function startInactivityTimer() {
    clearInactivityTimer();
    warningTimer = setTimeout(() => showInactivityWarning(), WARNING_TIMEOUT);
    inactivityTimer = setTimeout(() => autoLogout(), INACTIVITY_TIMEOUT);
    updateSessionTimer();
}

function clearInactivityTimer() {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function resetInactivityTimer() { clearInactivityTimer(); startInactivityTimer(); }

function updateSessionTimer() {
    const el = document.getElementById('sessionTimer');
    if (!el) return;
    let t = 300;
    const update = () => {
        const m = Math.floor(t / 60), s = t % 60;
        el.textContent = `⏱️ Sesi: ${m}:${s.toString().padStart(2, '0')}`;
        if (t <= 0) clearInterval(countdownInterval);
        t--;
    };
    update();
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(update, 1000);
}

function showInactivityWarning() {
    const modal = document.getElementById('inactivityModal');
    const cd = document.getElementById('countdownTimer');
    if (modal && cd) {
        modal.classList.remove('hidden');
        let c = 60;
        cd.textContent = c;
        const uc = setInterval(() => {
            c--; cd.textContent = c;
            if (c <= 0) { clearInterval(uc); autoLogout(); }
        }, 1000);
        window.countdownUpdateInterval = uc;
    }
}

function extendSession() {
    const modal = document.getElementById('inactivityModal');
    if (modal) modal.classList.add('hidden');
    if (window.countdownUpdateInterval) clearInterval(window.countdownUpdateInterval);
    resetInactivityTimer();
    showRefreshFeedback();
}

function autoLogout() {
    clearInactivityTimer();
    stopAutoRefresh();
    const modal = document.getElementById('inactivityModal');
    if (modal) modal.classList.add('hidden');
    if (window.countdownUpdateInterval) clearInterval(window.countdownUpdateInterval);
    alert('⏰ Sesi telah tamat kerana tiada aktiviti.');
    logout();
}

function setupActivityTracking() {
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(e => {
        document.addEventListener(e, () => { if (isLoggedIn()) resetInactivityTimer(); }, { passive: true });
    });
}

// ===== TAB NAVIGATION =====
function showTab(tabName) {
    document.getElementById('requestsTab').classList.add('hidden');
    document.getElementById('settingsTab').classList.add('hidden');
    const usersTab = document.getElementById('usersTab');
    if (usersTab) usersTab.classList.add('hidden');
    const notifTab = document.getElementById('notificationsTab');
    if (notifTab) notifTab.classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tabs = document.querySelectorAll('.tab-btn');
    if (tabName === 'requests') {
        document.getElementById('requestsTab').classList.remove('hidden');
        if (tabs[0]) tabs[0].classList.add('active');
    } else if (tabName === 'users') {
        if (usersTab) usersTab.classList.remove('hidden');
        if (tabs[1]) tabs[1].classList.add('active');
        loadUsersData();
    } else if (tabName === 'settings') {
        document.getElementById('settingsTab').classList.remove('hidden');
        if (tabs[2]) tabs[2].classList.add('active');
        loadSettingsData();
    } else if (tabName === 'notifications') {
        if (notifTab) notifTab.classList.remove('hidden');
        if (tabs[3]) tabs[3].classList.add('active');
        loadNotificationsData();
    }
}

function showSettings() { showTab('settings'); }

// ===== NOTIFICATIONS STATUS TAB =====
function notifConfigBadge(elId, configured, okText, failText) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = configured ? okText : failText;
    el.className = 'status-badge ' + (configured ? 'approved' : 'rejected');
}

function notifEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function loadNotificationsData() {
    try {
        const d = await apiGet('/api/admin/notifications/status');
        // Statistik
        const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setNum('notifEmailSent', d.summary.email.sent);
        setNum('notifEmailFailed', d.summary.email.failed);
        setNum('notifSmsSent', d.summary.sms.sent);
        setNum('notifSmsFailed', d.summary.sms.failed);
        // Konfigurasi
        notifConfigBadge('notifEmailConfig', d.config.email.configured, '✅ Dikonfigurasi', '❌ Tidak dikonfigurasi');
        notifConfigBadge('notifSmsConfig', d.config.sms.configured, '✅ Dikonfigurasi', '❌ Tidak dikonfigurasi');
        const hostEl = document.getElementById('notifEmailHost');
        if (hostEl) hostEl.textContent = `${d.config.email.host}:${d.config.email.port} (${d.config.email.user || 'tiada akaun'})`;
        const hint = document.getElementById('notifConfigHint');
        if (hint) {
            const tips = [];
            if (!d.config.email.configured) tips.push('📧 Isikan EMAIL_USER & EMAIL_PASS (Gmail App Password) dalam environment');
            if (!d.config.sms.configured) tips.push('📱 Isikan TWILIO_SID, TWILIO_AUTH_TOKEN & TWILIO_PHONE_NUMBER untuk SMS');
            hint.textContent = tips.join(' · ') || '✅ Semua saluran notifikasi telah dikonfigurasi.';
        }
        // Senarai terkini
        const list = document.getElementById('notifRecentList');
        if (!list) return;
        if (!d.recent || d.recent.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📢</div><p>Tiada notifikasi lagi. Notifikasi dijana semasa permohonan diluluskan atau ditolak.</p></div>';
            return;
        }
        list.innerHTML = d.recent.map(n => {
            const icon = n.type === 'email' ? '📧' : '📱';
            const badge = n.status === 'sent' ? '<span class="status-badge approved">Berjaya</span>' : '<span class="status-badge rejected">Gagal</span>';
            const err = n.status !== 'sent' && n.error ? `<div class="notif-error">Sebab: ${notifEsc(n.error).substring(0, 120)}</div>` : '';
            const when = n.created_at ? new Date(n.created_at).toLocaleString('ms-MY') : '';
            return `<div class="request-item"><div class="req-header"><span class="req-name">${icon} ${notifEsc(n.type)} → ${notifEsc(n.recipient)}</span>${badge}</div>${err}<div class="req-meta">${notifEsc(when)}</div></div>`;
        }).join('');
    } catch (e) {
        showToast('Ralat memuatkan status notifikasi: ' + e.message, 'error');
    }
}

// ===== SETTINGS =====
async function loadSettingsData() {
    const username = localStorage.getItem('adminName');
    if (!username) return;
    try {
        const info = await apiGet(`/api/admin/info?username=${username}`);
        const ps = document.getElementById('passwordStatus');
        if (ps) {
            ps.textContent = info.password_changed_at ? 'Telah ditukar' : 'Lalai (perlu ditukar)';
            ps.className = info.password_changed_at ? 'status-badge approved' : 'status-badge pending';
        }
        const ll = document.getElementById('lastLogin');
        if (ll) ll.textContent = info.last_login_at ? new Date(info.last_login_at).toLocaleString('ms-MY') : '-';
    } catch (e) { console.error('Ralat memuatkan maklumat admin:', e); }
}

// ===== PASSWORD MANAGEMENT =====
async function handlePasswordChange(e) {
    e.preventDefault();
    const cp = document.getElementById('currentPassword').value;
    const np = document.getElementById('newPassword').value;
    const cnp = document.getElementById('confirmPassword').value;
    const err = document.getElementById('passwordError');
    const suc = document.getElementById('passwordSuccess');
    err.classList.add('hidden'); suc.classList.add('hidden');
    if (np !== cnp) { err.textContent = 'Kata laluan baru tidak sepadan!'; err.classList.remove('hidden'); return; }
    if (np.length < 6) { err.textContent = 'Kata laluan baru mesti sekurang-kurangnya 6 aksara!'; err.classList.remove('hidden'); return; }
    if (cp === np) { err.textContent = 'Kata laluan baru mesti berbeza!'; err.classList.remove('hidden'); return; }
    try {
        await apiPut('/api/admin/change-password', { username: localStorage.getItem('adminName'), current_password: cp, new_password: np });
        suc.textContent = '✅ Kata laluan berjaya ditukar!'; suc.classList.remove('hidden');
        document.getElementById('changePasswordForm').reset();
        loadSettingsData();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

// ===== USER MANAGEMENT (ADMIN) =====
async function loadUsersData() {
    try {
        const users = await apiGet('/api/users');
        const stats = await apiGet('/api/users/stats');
        document.getElementById('totalUsers').textContent = stats.total;
        document.getElementById('activeUsers').textContent = stats.active;
        document.getElementById('inactiveUsers').textContent = stats.inactive;
        renderUsers(users);
    } catch (e) {
        console.error('Ralat mengambil data pengguna:', e);
        if (dbErrorState.down && !document.querySelector('.db-error-banner')) {
            const c = document.getElementById('usersList');
            if (c) { c.innerHTML = ''; renderDbErrorBanner(c); }
        }
    }
}

function renderUsers(users) {
    const c = document.getElementById('usersList');
    if (!users.length) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Tiada pengguna didaftarkan.</p></div>';
        return;
    }
    c.innerHTML = users.map(u => `
        <div class="request-card ${u.is_active ? 'approved' : 'rejected'}">
            <div class="request-info">
                <h3>${u.nama}</h3>
                <div class="request-details">
                    <span>👤 @${u.username}</span>
                    <span>💼 ${u.jawatan || '-'}</span>
                    <span>📞 ${u.no_hp || '-'}</span>
                    ${u.email ? `<span>✉️ ${u.email}</span>` : ''}
                    ${u.last_login_at ? `<span>🕐 Log masuk: ${new Date(u.last_login_at).toLocaleString('ms-MY')}</span>` : ''}
                </div>
                <div style="margin-top:10px">
                    <span class="status-badge ${u.is_active ? 'approved' : 'rejected'}">${u.is_active ? 'Aktif' : 'Dinyahaktif'}</span>
                    <span style="margin-left:10px;color:#888;font-size:0.85em">Didaftar: ${u.created_at ? new Date(u.created_at).toLocaleDateString('ms-MY') : '-'}</span>
                </div>
            </div>
            <div class="request-actions">
                <button class="btn btn-${u.is_active ? 'danger' : 'success'} btn-sm" onclick="toggleUser(${u.id})">
                    ${u.is_active ? '🚫 Nyahaktif' : '✅ Aktifkan'}
                </button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.nama}')">🗑️ Padam</button>
            </div>
        </div>`).join('');
}

async function toggleUser(id) {
    try {
        const result = await apiPut(`/api/users/${id}/toggle`);
        showToast(`✅ ${result.message}`);
        await loadUsersData();
    } catch (e) {
        if (handleAuthError(e)) return;
        showToast('Ralat: ' + e.message, 'error');
    }
}

async function deleteUser(id, nama) {
    const ok = await adminConfirm(`Padam pengguna "${nama}" secara kekal?`, { title: '🗑️ Padam Pengguna', okText: '🗑️ Ya, Padam' });
    if (!ok) return;
    try {
        await apiDelete(`/api/users/${id}`);
        showToast('✅ Pengguna berjaya dipadam!');
        await loadUsersData();
    } catch (e) {
        showToast('Ralat: ' + e.message, 'error');
    }
}

// ===== DANGER ZONE =====
async function resetAllData() {
    const ok1 = await adminConfirm('AMARAN: Ini akan memadam SEMUA data permohonan dan pengguna!', { title: '⚠️ Zon Bahaya — Reset Data', okText: 'Teruskan' });
    if (!ok1) return;
    const ok2 = await adminConfirm('Adakah anda benar-benar pasti? Tindakan ini TIDAK boleh diundur.', { title: '⚠️ Pengesahan Terakhir', okText: 'Ya, Padam Semua' });
    if (!ok2) return;
    try {
        await apiDelete('/api/admin/reset-data');
        // Also reset users
        try { await apiPut('/api/admin/reset-users'); } catch (ignore) {}
        showToast('✅ Semua data berjaya dipadam!');
        await loadAdminData();
        const usersTab = document.getElementById('usersTab');
        if (usersTab && !usersTab.classList.contains('hidden')) await loadUsersData();
    } catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

async function resetToDefault() {
    const ok = await adminConfirm('Reset kata laluan ke lalai (admin123)?', { title: '🔑 Reset Kata Laluan', okText: '🔑 Reset' });
    if (!ok) return;
    try { const r = await apiPut('/api/admin/reset-to-default'); showToast(`✅ Kata laluan direset! Lalai: ${r.default_password}`); }
    catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

// ===== BACKUP & RESTORE =====
async function backupData() {
    try {
        const response = await fetch('/api/admin/backup', { headers: { 'Authorization': `Bearer ${getAdminToken()}` } });
        if (!response.ok) throw new Error('Gagal memuat turun backup');
        const backup = await response.json();

        // Trigger download
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_kenderaan_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`✅ Backup berjaya! Permohonan: ${backup.counts.requests} · Pengguna: ${backup.counts.users} · Admin: ${backup.counts.admins} · Notifikasi: ${backup.counts.notifications}`);
    } catch (e) {
        showToast('Ralat: ' + e.message, 'error');
    }
}

async function restoreData(input) {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('restoreStatus');
    statusEl.classList.remove('hidden');
    statusEl.style.background = '#e8f4fd';
    statusEl.style.color = '#1e3c72';
    statusEl.textContent = '⏳ Sedang memulihkan data...';

    try {
        const text = await file.text();
        const backup = JSON.parse(text);

        if (!backup.data) {
            throw new Error('Format backup tidak sah');
        }

        // Confirm before restore (modal khusus, bukan dialog native)
        const counts = backup.counts || {};
        const confirmed = await adminConfirm(
            'PULIHKAN DATA?\n\n' +
            `Ini akan menggantikan SEMUA data sedia ada dengan data backup:\n\n` +
            `• Permohonan: ${counts.requests || 0}\n` +
            `• Pengguna: ${counts.users || 0}\n` +
            `• Admin: ${counts.admins || 0}\n` +
            `• Notifikasi: ${counts.notifications || 0}\n\n` +
            `Tarikh backup: ${backup.exported_at || 'Tidak diketahui'}`,
            { title: '♻️ Pulihkan Data', okText: '♻️ Ya, Pulihkan' }
        );

        if (!confirmed) {
            statusEl.classList.add('hidden');
            input.value = '';
            return;
        }

        const result = await apiPost('/api/admin/restore', { backup });

        statusEl.style.background = '#d4edda';
        statusEl.style.color = '#155724';
        statusEl.innerHTML = `✅ Data berjaya dipulihkan!\n<br>• Permohonan: ${result.restored.requests}\n<br>• Pengguna: ${result.restored.users}\n<br>• Admin: ${result.restored.admins}\n<br>• Notifikasi: ${result.restored.notifications}`;

        // Reload data
        await loadAdminData();
        await loadSettingsData();
        const usersTab = document.getElementById('usersTab');
        if (usersTab && !usersTab.classList.contains('hidden')) await loadUsersData();

        // Clear file input
        input.value = '';

        // Auto-hide status after 5s
        setTimeout(() => statusEl.classList.add('hidden'), 5000);
    } catch (e) {
        statusEl.style.background = '#f8d7da';
        statusEl.style.color = '#721c24';
        statusEl.textContent = '❌ Ralat: ' + e.message;
        input.value = '';
    }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    const cpf = document.getElementById('changePasswordForm');
    if (cpf) cpf.addEventListener('submit', handlePasswordChange);

    setupActivityTracking();

    const loginSection = document.getElementById('loginSection');
    const adminPanel = document.getElementById('adminPanel');
    const loginForm = document.getElementById('loginForm');

    if (loginSection && adminPanel) {
        if (isLoggedIn()) {
            loginSection.classList.add('hidden');
            adminPanel.classList.remove('hidden');
            document.getElementById('adminName').textContent = localStorage.getItem('adminName') || 'Admin';
            loadAdminData();
            startInactivityTimer();
            startAutoRefresh();
        } else {
            loginSection.classList.remove('hidden');
            adminPanel.classList.add('hidden');
        }

        if (loginForm) {
            loginForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value;
                const result = await login(username, password);
                if (result.success) {
                    loginSection.classList.add('hidden');
                    adminPanel.classList.remove('hidden');
                    document.getElementById('adminName').textContent = username;
                    loadAdminData();
                } else {
                    document.getElementById('loginError').classList.remove('hidden');
                    setTimeout(() => document.getElementById('loginError').classList.add('hidden'), 3000);
                }
            });
        }
    }
});

async function updateStats() {
    try {
        const s = await apiGet('/api/stats');
        document.getElementById('totalRequests').textContent = s.total;
        document.getElementById('pendingRequests').textContent = s.pending;
        document.getElementById('approvedRequests').textContent = s.approved;
        document.getElementById('rejectedRequests').textContent = s.rejected;
        const cr = document.getElementById('completedRequests');
        if (cr) cr.textContent = s.completed || 0;
    } catch (e) {
        console.error('Ralat mengambil statistik:', e);
        if (dbErrorState.down) {
            setGlobalDbRetry(loadAdminData);
            renderDbErrorBanner(document.querySelector('.stats-container'));
        }
    }
}

async function filterRequests() {
    try {
        const f = document.getElementById('filterStatus').value;
        const ep = f !== 'all' ? `/api/requests?status=${f}` : '/api/requests';
        const r = await apiGet(ep);
        renderRequests(r);
    } catch (e) {
        console.error('Ralat mengambil permohonan:', e);
        if (dbErrorState.down && !document.querySelector('.db-error-banner')) {
            const c = document.getElementById('requestsList');
            if (c) { c.innerHTML = ''; renderDbErrorBanner(c); }
        }
    }
}

function renderRequests(requests) {
    const c = document.getElementById('requestsList');
    if (!requests.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Tiada permohonan ditemui.</p></div>'; return; }
    c.innerHTML = requests.map(r => `
        <div class="request-card ${r.status}">
            <div class="request-info">
                <h3>${r.nama}</h3>
                <div class="request-details">
                    <span>👤 ${r.jawatan}</span><span>📞 ${r.no_hp}</span><span>🚗 ${r.no_plate}</span>
                    <span>📅 ${formatDate(r.tarikh_bertolak)} - ${formatDate(r.tarikh_kembali)}</span>
                </div>
                <div style="margin-top:10px"><span class="status-badge ${r.status}">${getStatusText(r.status)}</span></div>
            </div>
            <div class="request-actions">
                <button class="btn btn-primary btn-sm" onclick="viewDetails('${r.id}')">👁️ Lihat</button>
                ${r.status === 'pending' ? `<button class="btn btn-success btn-sm" onclick="approveRequest('${r.id}')">✅ Lulus</button><button class="btn btn-danger btn-sm" onclick="rejectRequest('${r.id}')">❌ Tolak</button>` : ''}
            </div>
        </div>`).join('');
}

function getStatusText(s) { return { pending: 'Menunggu', approved: 'Diluluskan', rejected: 'Ditolak', completed: 'Selesai' }[s] || s; }
function formatDate(d) { return new Date(d).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }); }

async function viewDetails(id) {
    try {
        const r = await apiGet(`/api/requests/${id}`);
        document.getElementById('modalBody').innerHTML = `
            <div class="detail-row"><span class="detail-label">Nama:</span><span class="detail-value">${r.nama}</span></div>
            <div class="detail-row"><span class="detail-label">Jawatan:</span><span class="detail-value">${r.jawatan}</span></div>
            <div class="detail-row"><span class="detail-label">No. Telefon:</span><span class="detail-value">${r.no_hp}</span></div>
            ${r.email ? `<div class="detail-row"><span class="detail-label">Emel:</span><span class="detail-value">${r.email}</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">No. Plat:</span><span class="detail-value">${r.no_plate}</span></div>
            <div class="detail-row"><span class="detail-label">Tujuan:</span><span class="detail-value">${r.tujuan}</span></div>
            <div class="detail-row"><span class="detail-label">Tarikh Bertolak:</span><span class="detail-value">${formatDate(r.tarikh_bertolak)}</span></div>
            <div class="detail-row"><span class="detail-label">Tarikh Kembali:</span><span class="detail-value">${formatDate(r.tarikh_kembali)}</span></div>
            <div class="detail-row"><span class="detail-label">Odo Meter Sebelum:</span><span class="detail-value">${r.odo_sebelum.toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">Odo Meter Selepas:</span><span class="detail-value">${r.odo_selepas ? r.odo_selepas.toLocaleString() : 'Belum diisi'}</span></div>
            ${r.odo_selepas ? `<div class="detail-row"><span class="detail-label">Jarak:</span><span class="detail-value">${(r.odo_selepas - r.odo_sebelum).toLocaleString()} km</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value"><span class="status-badge ${r.status}">${getStatusText(r.status)}</span></span></div>
            <div class="detail-row"><span class="detail-label">Tarikh Permohonan:</span><span class="detail-value">${new Date(r.created_at).toLocaleString('ms-MY')}</span></div>
            ${r.admin_notes ? `<div class="detail-row"><span class="detail-label">Nota Admin:</span><span class="detail-value">${r.admin_notes}</span></div>` : ''}
            ${r.returned_at ? `<div class="detail-row"><span class="detail-label">Tarikh Kembali Kenderaan:</span><span class="detail-value">${new Date(r.returned_at).toLocaleString('ms-MY')}</span></div>` : ''}`;
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Tutup</button>
            <button class="btn btn-primary btn-sm" onclick="printRequestDetails('${r.id}')">🖨️ Cetak</button>
            ${r.status === 'pending' ? `<button class="btn btn-success" onclick="approveRequest('${r.id}');closeModal();">✅ Lulus</button><button class="btn btn-danger" onclick="rejectRequest('${r.id}');closeModal();">❌ Tolak</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteRequest('${r.id}')">🗑️ Padam</button>`;
        document.getElementById('detailModal').classList.remove('hidden');
    } catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

function closeModal() { document.getElementById('detailModal').classList.add('hidden'); }

// ===== ACTION MODAL (ganti confirm/prompt native) =====
// API: adminConfirm(message, {title, okText, danger}) => Promise<boolean>
//      adminPrompt(message, defaultValue, {title, okText, placeholder}) => Promise<string|null>
// Konsisten dengan modal khusus portal pengguna (tiada dialog native yang menyekat).
let actionModalResolve = null;

function openActionModal({ title = 'Sahkan', message = '', input = false, inputLabel = '', inputValue = '', okText = 'Sahkan', danger = true, placeholder = '' }) {
    return new Promise(resolve => {
        // Mod confirm pulangkan boolean; mod prompt pulangkan string (atau null bila batal)
        actionModalResolve = (ok) => {
            const inputEl = document.getElementById('actionModalInput');
            resolve(input ? (ok ? (inputEl ? inputEl.value : '') : null) : ok);
        };
        document.getElementById('actionModalTitle').textContent = title;
        document.getElementById('actionModalMessage').textContent = message;
        const okBtn = document.getElementById('actionModalOkBtn');
        okBtn.textContent = okText;
        okBtn.className = danger ? 'btn btn-danger' : 'btn btn-success';
        const wrap = document.getElementById('actionModalInputWrap');
        const inputEl = document.getElementById('actionModalInput');
        wrap.classList.toggle('hidden', !input);
        if (input) {
            document.getElementById('actionModalInputLabel').textContent = inputLabel;
            inputEl.value = inputValue;
            inputEl.placeholder = placeholder;
        } else {
            inputEl.value = '';
        }
        document.getElementById('actionModal').classList.remove('hidden');
        if (input) setTimeout(() => inputEl.focus(), 50);
    });
}

function closeActionModal(ok) {
    const modal = document.getElementById('actionModal');
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (actionModalResolve) { actionModalResolve(ok); actionModalResolve = null; }
}

function adminConfirm(message, opts = {}) {
    return openActionModal({ message, ...opts });
}

function adminPrompt(message, defaultValue = '', opts = {}) {
    return openActionModal({ message, input: true, inputValue: defaultValue, ...opts });
}

// ===== TOAST NOTIFICATION (ganti alert untuk mesej ringkas) =====
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
}

async function approveRequest(id) {
    const ok = await adminConfirm('Luluskan permohonan ini? Notifikasi emel/SMS akan dihantar kepada pengguna.', { title: '✅ Kelulusan Permohonan', okText: '✅ Ya, Luluskan', danger: false });
    if (!ok) return;
    try { await apiPut(`/api/requests/${id}/approve`); await loadAdminData(); showToast('✅ Permohonan diluluskan'); } catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

async function rejectRequest(id) {
    const notes = await adminPrompt('Nota penolakan (pilihan):', '', { title: '❌ Penolakan Permohonan', okText: '❌ Tolak', inputLabel: 'Nota penolakan', placeholder: 'Contoh: kenderaan diperlukan untuk tugas lain' });
    if (notes === null) return;
    try { await apiPut(`/api/requests/${id}/reject`, { admin_notes: notes || '' }); await loadAdminData(); showToast('Permohonan ditolak'); } catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

async function deleteRequest(id) {
    const ok = await adminConfirm('Padam permohonan ini secara kekal?', { title: '🗑️ Padam Permohonan', okText: '🗑️ Ya, Padam' });
    if (!ok) return;
    try { await apiDelete(`/api/requests/${id}`); await loadAdminData(); closeModal(); showToast('Permohonan dipadam'); } catch (e) { showToast('Ralat: ' + e.message, 'error'); }
}

function exportData() { window.location.href = `${API_URL}/api/export?token=${encodeURIComponent(getAdminToken())}`; }

// ===== PRINT FUNCTION =====
async function printRequestDetails(id) {
    try {
        const r = await apiGet(`/api/requests/${id}`);
        const html = `<!DOCTYPE html><html lang="ms"><head><meta charset="UTF-8"><title>Permohonan - ${r.nama}</title>
        <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;padding:25px 30px;color:#333;margin:0;font-size:12px}
        .header{text-align:center;margin-bottom:15px;border-bottom:3px solid #1e3c72;padding-bottom:10px}
        .header h1{color:#1e3c72;font-size:1.4em;margin-bottom:2px}.header p{color:#666;font-size:0.9em}
        .logo{font-size:40px;margin-bottom:5px}.content{margin-top:10px}
        .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e0e0e0}
        .lbl{font-weight:600;color:#1e3c72;width:40%}.val{width:60%;text-align:right}
        .badge{display:inline-block;padding:3px 12px;border-radius:15px;font-size:0.85em;font-weight:600}
        .badge.pending{background:#fff3e0;color:#ff9800}.badge.approved{background:#e8f5e9;color:#4CAF50}.badge.rejected{background:#ffebee;color:#f44336}
        .footer{margin-top:20px;padding-top:10px;border-top:2px solid #1e3c72;text-align:center;color:#666;font-size:0.85em}
        .sig{margin-top:25px;display:flex;justify-content:space-between}.sig-box{width:45%;text-align:center}
        .sig-line{border-top:1px solid #333;margin-top:35px;padding-top:8px}
        @media print{body{padding:15px 20px;font-size:11px}}</style></head><body>
        <div class="header"><div class="logo">🚗</div><h1>SISTEM PENGGUNAAN KENDERAAN</h1><p>Cawangan Senggara Bangunan</p></div>
        <div class="content">
        <div class="row"><span class="lbl">Nama Penuh:</span><span class="val">${r.nama}</span></div>
        <div class="row"><span class="lbl">Jawatan:</span><span class="val">${r.jawatan}</span></div>
        <div class="row"><span class="lbl">No. Telefon:</span><span class="val">${r.no_hp}</span></div>
        ${r.email ? `<div class="row"><span class="lbl">Emel:</span><span class="val">${r.email}</span></div>` : ''}
        <div class="row"><span class="lbl">No. Plat:</span><span class="val">${r.no_plate}</span></div>
        <div class="row"><span class="lbl">Tujuan:</span><span class="val">${r.tujuan}</span></div>
        <div class="row"><span class="lbl">Tarikh Bertolak:</span><span class="val">${formatDate(r.tarikh_bertolak)}</span></div>
        <div class="row"><span class="lbl">Tarikh Kembali:</span><span class="val">${formatDate(r.tarikh_kembali)}</span></div>
        <div class="row"><span class="lbl">Odo Meter Sebelum:</span><span class="val">${r.odo_sebelum.toLocaleString()}</span></div>
        <div class="row"><span class="lbl">Odo Meter Selepas:</span><span class="val">${r.odo_selepas ? r.odo_selepas.toLocaleString() : 'Belum diisi'}</span></div>
        ${r.odo_selepas ? `<div class="row"><span class="lbl">Jarak:</span><span class="val">${(r.odo_selepas - r.odo_sebelum).toLocaleString()} km</span></div>` : ''}
        <div class="row"><span class="lbl">Status:</span><span class="val"><span class="badge ${r.status}">${getStatusText(r.status)}</span></span></div>
        <div class="row"><span class="lbl">Tarikh Permohonan:</span><span class="val">${new Date(r.created_at).toLocaleString('ms-MY')}</span></div>
        ${r.admin_notes ? `<div class="row"><span class="lbl">Nota Admin:</span><span class="val">${r.admin_notes}</span></div>` : ''}
        ${r.returned_at ? `<div class="row"><span class="lbl">Tarikh Kembali Kenderaan:</span><span class="val">${new Date(r.returned_at).toLocaleString('ms-MY')}</span></div>` : ''}
        </div>
        <div class="sig"><div class="sig-box"><div class="sig-line"><p><strong>Pemohon</strong></p><p>${r.nama}</p></div></div>
        <div class="sig-box"><div class="sig-line"><p><strong>Pentadbir</strong></p><p>_________________</p></div></div></div>
        <div class="footer"><p>Dicetak pada: ${new Date().toLocaleString('ms-MY')}</p><p>Sistem Penggunaan Kenderaan - Cawangan Senggara Bangunan</p></div>
        </body></html>`;
        const pw = window.open('', '_blank');
        if (pw) { pw.document.write(html); pw.document.close(); pw.onload = () => setTimeout(() => pw.print(), 250); }
        else { alert('Sila benarkan popup untuk mencetak dokumen.'); }
    } catch (e) { alert('Ralat: ' + e.message); }
}

// ===== ADMIN PANEL =====
async function loadAdminData() { await updateStats(); await filterRequests(); }

// Close modal on outside click
document.addEventListener('click', function(e) {
    const modal = document.getElementById('detailModal');
    if (modal && e.target === modal) closeModal();
});

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});
