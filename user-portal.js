// ===== USER PORTAL - user-portal.js =====
const USER_AUTH_KEY = 'userAuth';
const USER_DATA_KEY = 'userData';

// ===== AUTH HELPERS =====
function isUserLoggedIn() {
    return localStorage.getItem(USER_AUTH_KEY) === 'true';
}

function getUserData() {
    try {
        return JSON.parse(localStorage.getItem(USER_DATA_KEY));
    } catch {
        return null;
    }
}

function userLogout() {
    localStorage.removeItem(USER_AUTH_KEY);
    localStorage.removeItem(USER_DATA_KEY);
    location.reload();
}

// ===== AUTH TAB NAVIGATION =====
function showAuthTab(tab) {
    document.getElementById('loginTab').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerTab').classList.toggle('hidden', tab !== 'register');
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    if (tab === 'login') {
        document.querySelector('.auth-tab:first-child').classList.add('active');
    } else {
        document.querySelector('.auth-tab:last-child').classList.add('active');
    }
}

// ===== USER DASHBOARD TAB NAVIGATION =====
function showUserTab(tab) {
    document.getElementById('myRequestsTab').classList.toggle('hidden', tab !== 'requests');
    document.getElementById('newRequestTab').classList.toggle('hidden', tab !== 'newRequest');
    document.querySelectorAll('#userDashboard .tab-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'requests') {
        document.querySelector('#userDashboard .tab-btn:first-child').classList.add('active');
        loadUserRequests();
    } else {
        document.querySelector('#userDashboard .tab-btn:last-child').classList.add('active');
        setupUserForm();
    }
}

// ===== USER LOGIN =====
async function handleUserLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');

    if (!username || !password) {
        errEl.textContent = 'Sila isi semua ruangan!';
        errEl.classList.remove('hidden');
        return;
    }

    try {
        const result = await apiPost('/api/users/login', { username, password });
        if (result.success) {
            localStorage.setItem(USER_AUTH_KEY, 'true');
            localStorage.setItem(USER_DATA_KEY, JSON.stringify(result.user));
            showUserDashboard();
        }
    } catch (err) {
        errEl.textContent = err.message || 'Nama pengguna atau kata laluan salah!';
        errEl.classList.remove('hidden');
    }
}

// ===== USER REGISTER =====
async function handleUserRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const nama = document.getElementById('regNama').value.trim();
    const jawatan = document.getElementById('regJawatan').value.trim();
    const no_hp = document.getElementById('regNoHp').value.trim();
    const email = document.getElementById('regEmail').value.trim();

    const errEl = document.getElementById('registerError');
    const sucEl = document.getElementById('registerSuccess');
    errEl.classList.add('hidden');
    sucEl.classList.add('hidden');

    if (!username || !password || !nama) {
        errEl.textContent = 'Nama pengguna, kata laluan, dan nama penuh wajib diisi!';
        errEl.classList.remove('hidden');
        return;
    }

    try {
        await apiPost('/api/users/register', { username, password, nama, jawatan, no_hp, email });
        sucEl.textContent = '✅ Pendaftaran berjaya! Sila log masuk.';
        sucEl.classList.remove('hidden');
        document.getElementById('userRegisterForm').reset();
        setTimeout(() => showAuthTab('login'), 1500);
    } catch (err) {
        errEl.textContent = err.message || 'Ralat semasa pendaftaran!';
        errEl.classList.remove('hidden');
    }
}

// ===== SHOW USER DASHBOARD =====
function showUserDashboard() {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('userDashboard').classList.remove('hidden');
    const user = getUserData();
    if (user) {
        document.getElementById('userName').textContent = user.nama || user.username;
        // Pre-fill form fields from user data
        document.getElementById('nama').value = user.nama || '';
        document.getElementById('jawatan').value = user.jawatan || '';
        document.getElementById('noHp').value = user.no_hp || '';
        document.getElementById('email').value = user.email || '';
    }
    loadUserRequests();
}

// ===== LOAD USER REQUESTS =====
async function loadUserRequests() {
    const user = getUserData();
    if (!user) return;

    try {
        // Get all requests and filter by user's name or phone
        const allRequests = await apiGet('/api/requests');
        const myRequests = allRequests.filter(r =>
            r.nama === user.nama || r.no_hp === user.no_hp
        );

        // Update stats
        document.getElementById('userTotalRequests').textContent = myRequests.length;
        document.getElementById('userPendingRequests').textContent = myRequests.filter(r => r.status === 'pending').length;
        document.getElementById('userApprovedRequests').textContent = myRequests.filter(r => r.status === 'approved').length;
        document.getElementById('userRejectedRequests').textContent = myRequests.filter(r => r.status === 'rejected').length;

        // Render list
        const list = document.getElementById('userRequestsList');
        if (!myRequests.length) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Tiada permohonan lagi. Tekan "Pohon Baru" untuk membuat permohonan.</p></div>';
            return;
        }
        list.innerHTML = myRequests.map(r => `
            <div class="request-card ${r.status}">
                <div class="request-info">
                    <h3>${r.nama} — ${r.no_plate}</h3>
                    <div class="request-details">
                        <span>📅 ${formatDate(r.tarikh_bertolak)} - ${formatDate(r.tarikh_kembali)}</span>
                        <span>🚗 ${r.tujuan}</span>
                    </div>
                    <div style="margin-top:10px"><span class="status-badge ${r.status}">${getStatusText(r.status)}</span></div>
                </div>
                <div class="request-actions">
                    <button class="btn btn-primary btn-sm" onclick="viewUserRequest('${r.id}')">👁️ Lihat</button>
                </div>
            </div>`).join('');
    } catch (err) {
        console.error('Ralat memuatkan permohonan:', err);
    }
}

// ===== VIEW USER REQUEST DETAIL =====
async function viewUserRequest(id) {
    try {
        const r = await apiGet(`/api/requests/${id}`);
        document.getElementById('userModalBody').innerHTML = `
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
            ${r.admin_notes ? `<div class="detail-row"><span class="detail-label">Nota Admin:</span><span class="detail-value">${r.admin_notes}</span></div>` : ''}`;
        document.getElementById('detailModal').classList.remove('hidden');
    } catch (err) {
        alert('Ralat: ' + err.message);
    }
}

function closeUserModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

// ===== USER VEHICLE FORM =====
function setupUserForm() {
    const form = document.getElementById('vehicleForm');
    if (!form) return;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tarikhBertolak').min = today;
    document.getElementById('tarikhKembali').min = today;
    form.onsubmit = handleUserFormSubmit;
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    const user = getUserData();
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
    } catch (err) {
        alert('Ralat: ' + err.message);
    }
}

function resetUserForm() {
    document.getElementById('vehicleForm').reset();
    document.getElementById('vehicleForm').classList.remove('hidden');
    document.getElementById('successMessage').classList.add('hidden');
    // Re-fill user data
    const user = getUserData();
    if (user) {
        document.getElementById('nama').value = user.nama || '';
        document.getElementById('jawatan').value = user.jawatan || '';
        document.getElementById('noHp').value = user.no_hp || '';
        document.getElementById('email').value = user.email || '';
    }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function () {
    // Attach event listeners
    const loginForm = document.getElementById('userLoginForm');
    if (loginForm) loginForm.addEventListener('submit', handleUserLogin);

    const registerForm = document.getElementById('userRegisterForm');
    if (registerForm) registerForm.addEventListener('submit', handleUserRegister);

    // Check if user is already logged in
    if (isUserLoggedIn()) {
        showUserDashboard();
    }
});
