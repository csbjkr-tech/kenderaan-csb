const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Helper: ralat ringkas & mudah baca (termasuk respons HTTP Brevo)
function briefError(e) {
    if (!e) return 'Unknown error';
    return e.message || String(e);
}

// ===== CONFIGURATION =====
// Update these values with your actual email and SMS provider credentials

const EMAIL_CONFIG = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false, // true for 465, false for other ports
    // Had masa supaya request API tidak tergantung bila rangkaian menyekat SMTP
    connectionTimeout: parseInt(process.env.EMAIL_CONNECT_TIMEOUT || '10000'),
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
};

// Brevo API HTTP — SATU-SATUNYA cara emel production Railway (port SMTP 587/465 disekat platform;
// hanya port 443 terbuka). Rujuk RAILWAY-FIX-GUIDE.md (Audit Ke-3).
const BREVO_CONFIG = {
    apiKey: process.env.BREVO_API_KEY || '',
    apiUrl: 'https://api.brevo.com/v3/smtp/email',
    senderEmail: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
    senderName: process.env.EMAIL_SENDER_NAME || 'Sistem Penggunaan Kenderaan',
    timeoutMs: parseInt(process.env.BREVO_TIMEOUT || '10000')
};

const SMS_CONFIG = {
    // Terima kedua-dua nama kunci (TWILIO_SID/TWILIO_ACCOUNT_SID, TWILIO_FROM/TWILIO_PHONE_NUMBER)
    // supaya kedua-dua konvensyen .env berfungsi tanpa kegagalan senyap.
    accountSid: process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || 'your-account-sid',
    authToken: process.env.TWILIO_AUTH_TOKEN || 'your-auth-token',
    fromNumber: process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '+1234567890'
};

// ===== TRANSPORTERS =====
let emailTransporter = null;
let twilioClient = null;

// Initialize email transporter
function initEmailTransporter() {
    try {
        emailTransporter = nodemailer.createTransport(EMAIL_CONFIG);
        console.log('✅ Email transporter initialized');
        return true;
    } catch (error) {
        console.warn('⚠️ Email transporter failed to initialize:', error.message);
        return false;
    }
}

// Initialize Twilio client
function initTwilioClient() {
    try {
        if (SMS_CONFIG.accountSid && SMS_CONFIG.accountSid !== 'your-account-sid') {
            twilioClient = twilio(SMS_CONFIG.accountSid, SMS_CONFIG.authToken);
            console.log('✅ Twilio client initialized');
            return true;
        }
        console.warn('⚠️ Twilio credentials not configured');
        return false;
    } catch (error) {
        console.warn('⚠️ Twilio client failed to initialize:', error.message);
        return false;
    }
}

// ===== EMAIL VIA BREVO API HTTP (untuk production Railway) =====
async function sendEmailViaBrevo(to, subject, htmlContent) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BREVO_CONFIG.timeoutMs);
    try {
        const resp = await fetch(BREVO_CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_CONFIG.apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { email: BREVO_CONFIG.senderEmail, name: BREVO_CONFIG.senderName },
                to: [{ email: to }],
                subject: subject,
                htmlContent: htmlContent
            }),
            signal: controller.signal
        });
        const bodyText = await resp.text();
        if (!resp.ok) {
            // Brevo pulangkan JSON { message, code } bila gagal — tampilkan untuk diagnosis pantas
            let detail = bodyText;
            try { detail = JSON.parse(bodyText).message || bodyText; } catch (_) { /* kekal teks mentah */ }
            console.error('Brevo API error:', resp.status, detail);
            return { success: false, provider: 'brevo', error: `Brevo API ${resp.status}: ${detail}` };
        }
        const data = JSON.parse(bodyText);
        console.log('📧 Email sent via Brevo API:', data.messageId || '(tiada id)');
        return { success: true, provider: 'brevo', messageId: data.messageId };
    } catch (error) {
        const reason = error.name === 'AbortError'
            ? `Brevo API timeout selepas ${BREVO_CONFIG.timeoutMs}ms`
            : briefError(error);
        console.error('Brevo send error:', reason);
        return { success: false, provider: 'brevo', error: reason };
    } finally {
        clearTimeout(timer);
    }
}

function isEmailConfigured() {
    // Brevo dikira konfigurasi bila kunci API + alamat pengirim wujud (bukan placeholder)
    if (BREVO_CONFIG.apiKey && BREVO_CONFIG.senderEmail &&
        BREVO_CONFIG.apiKey !== 'your-brevo-api-key') return true;
    return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS &&
        process.env.EMAIL_USER !== 'your-email@gmail.com' && process.env.EMAIL_PASS !== 'your-app-password');
}

function getEmailProvider() {
    return (BREVO_CONFIG.apiKey && BREVO_CONFIG.apiKey !== 'your-brevo-api-key') ? 'brevo' : 'smtp';
}

// ===== EMAIL NOTIFICATIONS =====
// Strategi: jika BREVO_API_KEY diset -> hantar melalui API HTTP (port 443, satu-satunya laluan
// di Railway). Jika tidak -> fallback SMTP (lokal mesin sendiri, Gmail App Password diperlukan).
async function sendEmail(to, subject, htmlContent) {
    if (getEmailProvider() === 'brevo') {
        return sendEmailViaBrevo(to, subject, htmlContent);
    }

    if (!emailTransporter) {
        console.warn('Email transporter not initialized');
        return { success: false, provider: 'smtp', error: 'Email not configured' };
    }

    try {
        const mailOptions = {
            from: `"Sistem Penggunaan Kenderaan" <${EMAIL_CONFIG.auth.user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log('📧 Email sent via SMTP:', info.messageId);
        return { success: true, provider: 'smtp', messageId: info.messageId };
    } catch (error) {
        console.error('Email send error:', error.message);
        return { success: false, provider: 'smtp', error: error.message };
    }
}

// ===== SMS NOTIFICATIONS =====
async function sendSMS(to, message) {
    if (!twilioClient) {
        console.warn('Twilio client not initialized');
        return { success: false, error: 'SMS not configured' };
    }

    try {
        const result = await twilioClient.messages.create({
            body: message,
            from: SMS_CONFIG.fromNumber,
            to: to
        });
        console.log('📱 SMS sent:', result.sid);
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('SMS send error:', error.message);
        return { success: false, error: error.message };
    }
}

// ===== NOTIFICATION TEMPLATES =====
function generateApprovalEmail(request) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #2E7D32, #4CAF50); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
                .footer { background: #eee; padding: 15px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
                .badge { background: #4CAF50; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
                .detail-row { padding: 10px 0; border-bottom: 1px solid #ddd; }
                .detail-label { font-weight: bold; color: #1e3c72; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ Permohonan Diluluskan</h1>
                </div>
                <div class="content">
                    <p>Tuan/Puan <strong>${request.nama}</strong>,</p>
                    <p>Permohonan penggunaan kenderaan anda telah <span class="badge">DILULUSKAN</span></p>
                    
                    <div class="detail-row">
                        <span class="detail-label">No. Plat:</span> ${request.no_plate}
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tarikh:</span> ${formatDate(request.tarikh_bertolak)} - ${formatDate(request.tarikh_kembali)}
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tujuan:</span> ${request.tujuan}
                    </div>
                    
                    <p style="margin-top: 20px;">Sila ambil kenderaan mengikut jadual yang ditetapkan.</p>
                </div>
                <div class="footer">
                    <p>Sistem Penggunaan Kenderaan - Cawangan Senggara Bangunan</p>
                    <p>Emel ini dijana secara automatik. Sila jangan balas emel ini.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

function generateRejectionEmail(request) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #c62828, #f44336); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
                .footer { background: #eee; padding: 15px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
                .badge { background: #f44336; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
                .detail-row { padding: 10px 0; border-bottom: 1px solid #ddd; }
                .detail-label { font-weight: bold; color: #1e3c72; }
                .notes { background: #fff3e0; padding: 15px; border-left: 4px solid #ff9800; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>❌ Permohonan Ditolak</h1>
                </div>
                <div class="content">
                    <p>Tuan/Puan <strong>${request.nama}</strong>,</p>
                    <p>Permohonan penggunaan kenderaan anda telah <span class="badge">DITOLAK</span></p>
                    
                    <div class="detail-row">
                        <span class="detail-label">No. Plat:</span> ${request.no_plate}
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tarikh:</span> ${formatDate(request.tarikh_bertolak)} - ${formatDate(request.tarikh_kembali)}
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tujuan:</span> ${request.tujuan}
                    </div>
                    
                    ${request.admin_notes ? `
                    <div class="notes">
                        <strong>Nota Admin:</strong> ${request.admin_notes}
                    </div>
                    ` : ''}
                    
                    <p style="margin-top: 20px;">Untuk pertanyaan lanjut, sila hubungi pentadbir sistem.</p>
                </div>
                <div class="footer">
                    <p>Sistem Penggunaan Kenderaan - Cawangan Senggara Bangunan</p>
                    <p>Emel ini dijana secara automatik. Sila jangan balas emel ini.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

function generateApprovalSMS(request) {
    return `Sistem Penggunaan Kenderaan: Permohonan kenderaan ${request.no_plate} pada ${formatDate(request.tarikh_bertolak)} telah DILULUSKAN. Sila ambil kenderaan mengikut jadual.`;
}

function generateRejectionSMS(request) {
    return `Sistem Penggunaan Kenderaan: Permohonan kenderaan ${request.no_plate} pada ${formatDate(request.tarikh_bertolak)} telah DITOLAK. ${request.admin_notes ? 'Nota: ' + request.admin_notes : ''}`;
}

function formatDate(dateStr) {
    const options = { day: 'numeric', month: 'short', year: 'numeric' };
    return new Date(dateStr).toLocaleDateString('ms-MY', options);
}

// ===== MAIN NOTIFICATION FUNCTION =====
async function sendNotification(request, type, db) {
    const notifications = [];
    
    // Format phone number for SMS (add country code if needed)
    let phoneNumber = request.no_hp;
    if (phoneNumber.startsWith('0')) {
        phoneNumber = '+60' + phoneNumber.substring(1);
    }
    
    // Email notification (if email is provided)
    if (request.email) {
        const emailSubject = type === 'approved' 
            ? '✅ Permohonan Kenderaan Diluluskan' 
            : '❌ Permohonan Kenderaan Ditolak';
        
        const emailHtml = type === 'approved' 
            ? generateApprovalEmail(request) 
            : generateRejectionEmail(request);
        
        const emailResult = await sendEmail(request.email, emailSubject, emailHtml);
        notifications.push({
            type: 'email',
            recipient: request.email,
            status: emailResult.success ? 'sent' : 'failed',
            error: emailResult.error || null
        });
    }
    
    // SMS notification
    const smsMessage = type === 'approved' 
        ? generateApprovalSMS(request) 
        : generateRejectionSMS(request);
    
    const smsResult = await sendSMS(phoneNumber, smsMessage);
    notifications.push({
        type: 'sms',
        recipient: phoneNumber,
        status: smsResult.success ? 'sent' : 'failed',
        error: smsResult.error || null
    });
    
    // Save notification log to database
    if (db) {
        try {
            for (const notif of notifications) {
                await db.prepare(`
                    INSERT INTO notifications (request_id, type, recipient, status, error_message, created_at)
                    VALUES (?, ?, ?, ?, ?, NOW()::TEXT)
                `).run(request.id, notif.type, notif.recipient, notif.status, notif.error);
            }
        } catch (error) {
            console.error('Error saving notification log:', error);
        }
    }
    
    return notifications;
}

// ===== INITIALIZE =====
function initialize() {
    console.log('🔧 Initializing notification service...');
    let emailReady;
    if (getEmailProvider() === 'brevo') {
        // Brevo: tiada transporter diperlukan — penghantaran melalui API HTTP on-demand
        emailReady = isEmailConfigured();
        console.log(`✅ Email provider: Brevo API HTTP (${BREVO_CONFIG.senderEmail || 'sender tiada'})`);
    } else {
        emailReady = initEmailTransporter();
    }
    const smsReady = initTwilioClient();
    
    return {
        email: emailReady,
        sms: smsReady
    };
}

module.exports = {
    sendEmail,
    sendSMS,
    sendNotification,
    initialize,
    isEmailConfigured,
    getEmailProvider,
    generateApprovalEmail,
    generateRejectionEmail,
    generateApprovalSMS,
    generateRejectionSMS
};
