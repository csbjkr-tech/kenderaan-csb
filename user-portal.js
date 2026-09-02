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
        // Reset form state when switching to new request tab
        const form = document.getElementById('vehicleForm');
        const success = document.getElementById('successMessage');
        if (form && success && !success.classList.contains('hidden')) {
            // Already submitted — reset the form
            resetUserForm();
        }
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
        document.getElementById('userCompletedRequests').textContent = myRequests.filter(r => r.status === 'completed').length;

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
                    ${r.status === 'approved' ? `<button class="btn btn-success btn-sm" onclick="openReturnModal('${r.id}', ${r.odo_sebelum})">🔄 Kembalikan</button>` : ''}
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
            ${r.admin_notes ? `<div class="detail-row"><span class="detail-label">Nota Admin:</span><span class="detail-value">${r.admin_notes}</span></div>` : ''}
            ${r.returned_at ? `<div class="detail-row"><span class="detail-label">Tarikh Kembali:</span><span class="detail-value">${new Date(r.returned_at).toLocaleString('ms-MY')}</span></div>` : ''}`;
        document.getElementById('detailModal').classList.remove('hidden');
    } catch (err) {
        alert('Ralat: ' + err.message);
    }
}

function closeUserModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

// ===== RETURN VEHICLE =====
let returnRequestId = null;

function openReturnModal(id, odoSebelum) {
    returnRequestId = id;
    document.getElementById('returnOdoSebelum').value = odoSebelum;
    document.getElementById('returnOdoSelepas').value = '';
    document.getElementById('err-returnOdoSelepas').textContent = '';
    document.getElementById('err-returnOdoSelepas').classList.add('hidden');
    document.getElementById('returnError').classList.add('hidden');
    document.getElementById('confirmReturnBtn').disabled = false;
    document.getElementById('confirmReturnBtn').innerHTML = '✅ Sah Kembali';
    document.getElementById('returnModal').classList.remove('hidden');
}

function closeReturnModal() {
    returnRequestId = null;
    document.getElementById('returnModal').classList.add('hidden');
}

async function confirmReturnVehicle() {
    if (!returnRequestId) return;
    const odoSelepas = parseInt(document.getElementById('returnOdoSelepas').value);
    const odoSebelum = parseInt(document.getElementById('returnOdoSebelum').value);
    const errEl = document.getElementById('err-returnOdoSelepas');
    const globalErr = document.getElementById('returnError');
    errEl.classList.add('hidden');
    globalErr.classList.add('hidden');

    if (!odoSelepas && odoSelepas !== 0) {
        errEl.textContent = 'Sila masukkan bacaan odometer';
        errEl.classList.remove('hidden');
        return;
    }
    if (isNaN(odoSelepas) || odoSelepas < 0) {
        errEl.textContent = 'Nombor tidak sah';
        errEl.classList.remove('hidden');
        return;
    }
    if (odoSelepas <= odoSebelum) {
        errEl.textContent = 'Odo selepas mesti lebih besar daripada odo sebelum (' + odoSebelum.toLocaleString() + ')';
        errEl.classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('confirmReturnBtn');
    btn.disabled = true;
    btn.innerHTML = '⏳ Memproses...';

    try {
        await apiPut(`/api/requests/${returnRequestId}/return`, { odo_selepas: odoSelepas });
        closeReturnModal();
        loadUserRequests();
    } catch (err) {
        globalErr.textContent = err.message;
        globalErr.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '✅ Sah Kembali';
    }
}

// ===== USER VEHICLE FORM =====
let formSubmitting = false;

function setupUserForm() {
    const form = document.getElementById('vehicleForm');
    if (!form) return;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tarikhBertolak').min = today;
    document.getElementById('tarikhKembali').min = today;
    form.onsubmit = handleUserFormSubmit;

    // Real-time validation: attach blur/input listeners
    const fields = [
        { id: 'nama', validate: v => v.length > 0 || 'Nama penuh wajib diisi' },
        { id: 'jawatan', validate: v => v.length > 0 || 'Jawatan wajib diisi' },
        { id: 'noHp', validate: v => {
            if (!v) return 'Nombor telefon wajib diisi';
            if (!/^0[0-9]{9,10}$/.test(v)) return 'Format tidak sah (contoh: 0123456789)';
            return true;
        }},
        { id: 'email', validate: (v, optional) => {
            if (!v || !v.trim()) return optional; // optional field
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Format emel tidak sah';
            return true;
        }, optional: true },
        { id: 'noPlate', validate: v => v.length >= 3 || 'Nombor plat minimum 3 aksara' },
        { id: 'tujuan', validate: v => v.length >= 5 || 'Tujuan minimum 5 aksara' },
        { id: 'tarikhBertolak', validate: v => v.length > 0 || 'Tarikh bertolak wajib diisi' },
        { id: 'tarikhKembali', validate: (v, optional, formData) => {
            if (!v) return 'Tarikh kembali wajib diisi';
            const bertolak = document.getElementById('tarikhBertolak').value;
            if (bertolak && new Date(v) < new Date(bertolak)) return 'Tarikh kembali mesti selepas tarikh bertolak';
            return true;
        }},
        { id: 'odoSebelum', validate: v => {
            if (!v && v !== '0') return 'Odo meter sebelum wajib diisi';
            const n = parseInt(v);
            if (isNaN(n) || n < 0) return 'Nombor tidak sah';
            return true;
        }},
        { id: 'odoSelepas', validate: (v, optional) => {
            if (!v) return optional; // optional field
            const n = parseInt(v);
            const sebelum = parseInt(document.getElementById('odoSebelum').value);
            if (isNaN(n) || n < 0) return 'Nombor tidak sah';
            if (!isNaN(sebelum) && n < sebelum) return 'Odo selepas mesti lebih besar daripada odo sebelum';
            return true;
        }, optional: true },
    ];

    fields.forEach(({ id, validate, optional }) => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventType = (el.type === 'date' || el.tagName === 'TEXTAREA') ? 'change' : 'blur';
        el.addEventListener(eventType, () => validateAndShow(id, validate(el.value.trim(), optional)));
        // Also clear error on input
        el.addEventListener('input', () => clearFieldError(id));
    });

    // Auto-format plate number to uppercase on input
    document.getElementById('noPlate')?.addEventListener('input', function() {
        const pos = this.selectionStart;
        this.value = this.value.toUpperCase();
        this.setSelectionRange(pos, pos);
    });

    // Auto-update tarikhKembali min when tarikhBertolak changes
    document.getElementById('tarikhBertolak')?.addEventListener('change', function() {
        const kembali = document.getElementById('tarikhKembali');
        if (kembali) {
            kembali.min = this.value;
            if (kembali.value && new Date(kembali.value) < new Date(this.value)) {
                kembali.value = this.value;
                validateAndShow('tarikhKembali', true);
            }
        }
    });
}

function validateAndShow(fieldId, result) {
    const errEl = document.getElementById('err-' + fieldId);
    const inputEl = document.getElementById(fieldId);
    if (result === true) {
        clearFieldError(fieldId);
        return true;
    } else {
        if (errEl) { errEl.textContent = result; errEl.classList.remove('hidden'); }
        if (inputEl) inputEl.classList.add('input-error');
        return false;
    }
}

function clearFieldError(fieldId) {
    const errEl = document.getElementById('err-' + fieldId);
    const inputEl = document.getElementById(fieldId);
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    if (inputEl) inputEl.classList.remove('input-error');
}

function clearAllErrors() {
    ['nama', 'jawatan', 'noHp', 'email', 'noPlate', 'tujuan', 'tarikhBertolak', 'tarikhKembali', 'odoSebelum', 'odoSelepas'].forEach(clearFieldError);
    const g = document.getElementById('formGlobalError');
    if (g) { g.textContent = ''; g.classList.add('hidden'); }
}

// Pending form data for confirmation
let pendingFormData = null;

async function handleUserFormSubmit(e) {
    e.preventDefault();
    if (formSubmitting) return;
    formSubmitting = true; // lock immediately to prevent double-click during validation

    clearAllErrors();

    // Run all validations
    const validations = [
        ['nama', v => v.length > 0 || 'Nama penuh wajib diisi'],
        ['jawatan', v => v.length > 0 || 'Jawatan wajib diisi'],
        ['noHp', v => {
            if (!v) return 'Nombor telefon wajib diisi';
            if (!/^0[0-9]{9,10}$/.test(v)) return 'Format tidak sah (contoh: 0123456789)';
            return true;
        }],
        ['email', (v) => {
            if (!v || !v.trim()) return true; // optional
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Format emel tidak sah';
            return true;
        }],
        ['noPlate', v => v.length >= 3 || 'Nombor plat minimum 3 aksara'],
        ['tujuan', v => v.length >= 5 || 'Tujuan minimum 5 aksara'],
        ['tarikhBertolak', v => v.length > 0 || 'Tarikh bertolak wajib diisi'],
        ['tarikhKembali', v => {
            if (!v) return 'Tarikh kembali wajib diisi';
            const b = document.getElementById('tarikhBertolak').value;
            if (b && new Date(v) < new Date(b)) return 'Tarikh kembali mesti selepas tarikh bertolak';
            return true;
        }],
        ['odoSebelum', v => {
            if (!v && v !== '0') return 'Odo meter sebelum wajib diisi';
            if (isNaN(parseInt(v)) || parseInt(v) < 0) return 'Nombor tidak sah';
            return true;
        }],
        ['odoSelepas', v => {
            if (!v) return true; // optional
            if (isNaN(parseInt(v)) || parseInt(v) < 0) return 'Nombor tidak sah';
            const s = parseInt(document.getElementById('odoSebelum').value);
            if (!isNaN(s) && parseInt(v) < s) return 'Odo selepas mesti lebih besar daripada odo sebelum';
            return true;
        }],
    ];

    let allValid = true;
    for (const [id, validate] of validations) {
        const val = document.getElementById(id).value.trim();
        if (!validateAndShow(id, validate(val))) allValid = false;
    }

    if (!allValid) {
        formSubmitting = false; // unlock so user can fix and retry
        // Scroll to first error
        const firstErr = document.querySelector('.field-error:not(.hidden)');
        if (firstErr) firstErr.closest('.form-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }


    // Build form data
    pendingFormData = {
        nama: document.getElementById('nama').value.trim(),
        jawatan: document.getElementById('jawatan').value.trim(),
        no_hp: document.getElementById('noHp').value.trim(),
        email: document.getElementById('email')?.value.trim() || null,
        no_plate: document.getElementById('noPlate').value.trim().toUpperCase(),
        tujuan: document.getElementById('tujuan').value.trim(),
        tarikh_bertolak: document.getElementById('tarikhBertolak').value,
        tarikh_kembali: document.getElementById('tarikhKembali').value,
        odo_sebelum: parseInt(document.getElementById('odoSebelum').value),
        odo_selepas: document.getElementById('odoSelepas').value ? parseInt(document.getElementById('odoSelepas').value) : null,
    };

    // Show custom confirmation modal
    showConfirmModal(pendingFormData);
}

function showConfirmModal(fd) {
    const body = document.getElementById('confirmBody');
    if (!body) return;
    const bDate = new Date(fd.tarikh_bertolak);
    const kDate = new Date(fd.tarikh_kembali);
    body.innerHTML = `
        <div style="line-height:2">
            <div class="detail-row"><span class="detail-label">Nama:</span><span class="detail-value">${fd.nama}</span></div>
            <div class="detail-row"><span class="detail-label">Jawatan:</span><span class="detail-value">${fd.jawatan}</span></div>
            <div class="detail-row"><span class="detail-label">No. Telefon:</span><span class="detail-value">${fd.no_hp}</span></div>
            ${fd.email ? `<div class="detail-row"><span class="detail-label">Emel:</span><span class="detail-value">${fd.email}</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">No. Plat:</span><span class="detail-value" style="font-weight:700;color:#1e3c72">${fd.no_plate}</span></div>
            <div class="detail-row"><span class="detail-label">Tujuan:</span><span class="detail-value">${fd.tujuan}</span></div>
            <div class="detail-row"><span class="detail-label">Tarikh:</span><span class="detail-value">${formatDate(fd.tarikh_bertolak)} → ${formatDate(fd.tarikh_kembali)}</span></div>
            <div class="detail-row"><span class="detail-label">Odo Meter:</span><span class="detail-value">${fd.odo_sebelum.toLocaleString()}${fd.odo_selepas ? ' → ' + fd.odo_selepas.toLocaleString() : ''}</span></div>
        </div>
    `;
    document.getElementById('confirmModal').classList.remove('hidden');
}

function cancelConfirm() {
    pendingFormData = null;
    formSubmitting = false;
    document.getElementById('confirmModal').classList.add('hidden');
}

async function confirmSubmit() {
    if (!pendingFormData) return;

    // Disable confirm button
    const confirmBtn = document.getElementById('confirmSubmitBtn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '⏳ Menghantar...'; }

    formSubmitting = true;
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '⏳ Menghantar...'; }

    try {
        await apiPost('/api/requests', pendingFormData);
        document.getElementById('confirmModal').classList.add('hidden');
        document.getElementById('vehicleForm').classList.add('hidden');
        document.getElementById('successMessage').classList.remove('hidden');
        pendingFormData = null;
    } catch (err) {
        const gErr = document.getElementById('formGlobalError');
        if (gErr) { gErr.textContent = '❌ ' + err.message; gErr.classList.remove('hidden'); }
        gErr?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
        formSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '📤 Hantar Permohonan'; }
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = '✅ Ya, Hantar'; }
    }
}

function resetUserForm() {
    const form = document.getElementById('vehicleForm');
    if (!form) return;
    form.reset();
    form.classList.remove('hidden');
    document.getElementById('successMessage').classList.add('hidden');
    clearAllErrors();
    // Re-fill user data
    const user = getUserData();
    if (user) {
        document.getElementById('nama').value = user.nama || '';
        document.getElementById('jawatan').value = user.jawatan || '';
        document.getElementById('noHp').value = user.no_hp || '';
        document.getElementById('email').value = user.email || '';
    }
    // Reset date min values
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tarikhBertolak').min = today;
    document.getElementById('tarikhKembali').min = today;
    formSubmitting = false;
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '📤 Hantar Permohonan'; }
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
