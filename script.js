// ===== API BASE URL =====
const API_URL = '';

// ===== API HELPER FUNCTIONS =====
async function apiGet(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`);
    if (!response.ok) {
        throw new Error('Ralat semasa mengambil data');
    }
    return response.json();
}

async function apiPost(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
    const response = await fetch(`${API_URL}${endpoint}`, { method: 'DELETE' });
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
            startInactivityTimer();
            startAutoRefresh();
            return { success: true, nama: result.nama };
        }
        return { success: false };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function logout() {
    clearInactivityTimer();
    stopAutoRefresh();
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('adminName');
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
    }
}

function showSettings() { showTab('settings'); }

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
        alert(`✅ ${result.message}`);
        await loadUsersData();
    } catch (e) {
        alert('Ralat: ' + e.message);
    }
}

async function deleteUser(id, nama) {
    if (!confirm(`⚠️ Padam pengguna "${nama}" secara kekal?`)) return;
    try {
        await apiDelete(`/api/users/${id}`);
        alert('✅ Pengguna berjaya dipadam!');
        await loadUsersData();
    } catch (e) {
        alert('Ralat: ' + e.message);
    }
}

// ===== DANGER ZONE =====
async function resetAllData() {
    if (!confirm('⚠️ AMARAN: Ini akan memadam SEMUA data permohonan dan pengguna!')) return;
    if (!confirm('Adakah anda benar-benar pasti?')) return;
    try {
        await apiDelete('/api/admin/reset-data');
        // Also reset users
        try { await apiPut('/api/admin/reset-users'); } catch (ignore) {}
        alert('✅ Semua data berjaya dipadam!');
        await loadAdminData();
        const usersTab = document.getElementById('usersTab');
        if (usersTab && !usersTab.classList.contains('hidden')) await loadUsersData();
    } catch (e) { alert('Ralat: ' + e.message); }
}

async function resetToDefault() {
    if (!confirm('⚠️ Reset kata laluan ke lalai (admin123)?')) return;
    try { const r = await apiPut('/api/admin/reset-to-default'); alert(`✅ Kata laluan direset!\n\nLalai: ${r.default_password}`); }
    catch (e) { alert('Ralat: ' + e.message); }
}

// ===== USER FORM =====
function validateForm(data) {
    if (!data.nama || !data.jawatan || !data.no_hp || !data.no_plate || !data.tujuan) { alert('Sila isi semua ruangan wajib!'); return false; }
    if (!/^[0-9]{10,11}$/.test(data.no_hp)) { alert('Nombor telefon tidak sah!'); return false; }
    if (new Date(data.tarikh_kembali) < new Date(data.tarikh_bertolak)) { alert('Tarikh kembali mesti selepas tarikh bertolak!'); return false; }
    if (data.odo_selepas && data.odo_selepas < data.odo_sebelum) { alert('Odo meter selepas mesti lebih besar!'); return false; }
    return true;
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const fd = {
        nama: document.getElementById('nama').value.trim(),
        jawatan: document.getElementById('jawatan').value.trim(),
        no_hp: document.getElementById('noHp').value.trim(),
        email: document.getElementById('email')?.value.trim() || null,
        no_plate: document.getElementById('noPlate').value.trim(),
        tujuan: document.getElementById('tujuan').value.trim(),
        tarikh_bertolak: document.getElementById('tarikhBertolak').value,
        tarikh_kembali: document.getElementById('tarikhKembali').value,
        odo_sebelum: parseInt(document.getElementById('odoSebelum').value),
        odo_selepas: document.getElementById('odoSelepas').value ? parseInt(document.getElementById('odoSelepas').value) : null,
    };
    if (!validateForm(fd)) return;
    try {
        await apiPost('/api/requests', fd);
        document.getElementById('vehicleForm').classList.add('hidden');
        document.getElementById('successMessage').classList.remove('hidden');
    } catch (e) { alert('Ralat: ' + e.message); }
}

function resetForm() {
    document.getElementById('vehicleForm').reset();
    document.getElementById('vehicleForm').classList.remove('hidden');
    document.getElementById('successMessage').classList.add('hidden');
}

// ===== ADMIN PANEL =====
async function loadAdminData() { await updateStats(); await filterRequests(); }

async function updateStats() {
    try {
        const s = await apiGet('/api/stats');
        document.getElementById('totalRequests').textContent = s.total;
        document.getElementById('pendingRequests').textContent = s.pending;
        document.getElementById('approvedRequests').textContent = s.approved;
        document.getElementById('rejectedRequests').textContent = s.rejected;
        const cr = document.getElementById('completedRequests');
        if (cr) cr.textContent = s.completed || 0;
    } catch (e) { console.error('Ralat mengambil statistik:', e); }
}

async function filterRequests() {
    try {
        const f = document.getElementById('filterStatus').value;
        const ep = f !== 'all' ? `/api/requests?status=${f}` : '/api/requests';
        const r = await apiGet(ep);
        renderRequests(r);
    } catch (e) { console.error('Ralat mengambil permohonan:', e); }
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
    } catch (e) { alert('Ralat: ' + e.message); }
}

function closeModal() { document.getElementById('detailModal').classList.add('hidden'); }

async function approveRequest(id) {
    if (!confirm('Luluskan permohonan ini?')) return;
    try { await apiPut(`/api/requests/${id}/approve`); await loadAdminData(); } catch (e) { alert('Ralat: ' + e.message); }
}

async function rejectRequest(id) {
    const notes = prompt('Nota penolakan (pilihan):');
    try { await apiPut(`/api/requests/${id}/reject`, { admin_notes: notes || '' }); await loadAdminData(); } catch (e) { alert('Ralat: ' + e.message); }
}

async function deleteRequest(id) {
    if (!confirm('Padam permohonan ini secara kekal?')) return;
    try { await apiDelete(`/api/requests/${id}`); await loadAdminData(); closeModal(); } catch (e) { alert('Ralat: ' + e.message); }
}

function exportData() { window.location.href = `${API_URL}/api/export`; }

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

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    const cpf = document.getElementById('changePasswordForm');
    if (cpf) cpf.addEventListener('submit', handlePasswordChange);

    setupActivityTracking();

    const form = document.getElementById('vehicleForm');
    if (form) {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('tarikhBertolak').min = today;
        document.getElementById('tarikhKembali').min = today;
        form.addEventListener('submit', handleFormSubmit);
    }

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

// Close modal on outside click
document.addEventListener('click', function(e) {
    const modal = document.getElementById('detailModal');
    if (modal && e.target === modal) closeModal();
});

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});
