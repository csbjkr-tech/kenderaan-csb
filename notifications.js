const nodemailer = require('nodemailer');
const twilio = require('twilio');

// ===== CONFIGURATION =====
// Update these values with your actual email and SMS provider credentials

const EMAIL_CONFIG = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
};

const SMS_CONFIG = {
    accountSid: process.env.TWILIO_SID || 'your-account-sid',
    authToken: process.env.TWILIO_AUTH_TOKEN || 'your-auth-token',
    fromNumber: process.env.TWILIO_FROM || '+1234567890'
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

// ===== EMAIL NOTIFICATIONS =====
async function sendEmail(to, subject, htmlContent) {
    if (!emailTransporter) {
        console.warn('Email transporter not initialized');
        return { success: false, error: 'Email not configured' };
    }

    try {
        const mailOptions = {
            from: `"Sistem Penggunaan Kenderaan" <${EMAIL_CONFIG.auth.user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log('📧 Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Email send error:', error.message);
        return { success: false, error: error.message };
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
            const stmt = db.prepare(`
                INSERT INTO notifications (request_id, type, recipient, status, error_message, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `);
            
            for (const notif of notifications) {
                stmt.run(request.id, notif.type, notif.recipient, notif.status, notif.error);
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
    const emailReady = initEmailTransporter();
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
    generateApprovalEmail,
    generateRejectionEmail,
    generateApprovalSMS,
    generateRejectionSMS
};
