const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: (parseInt(process.env.SMTP_PORT) || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendVerificationCode(email, code) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to: email,
    subject: 'Z-Quiz Registration - Verification Code',
    text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
        <h2 style="color:#003366">Z-Quiz Registration</h2>
        <p>Your verification code is:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f0f7ff;border-radius:8px;margin:16px 0">${code}</div>
        <p style="color:#666;font-size:14px">This code expires in 10 minutes.</p>
        <p style="color:#666;font-size:14px">If you did not request this, please ignore this email.</p>
      </div>`
  });
}

async function sendTempPassword(email, password) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to: email,
    subject: 'Z-Quiz Registration - Your Temporary Password',
    text: `Your Z-Quiz account has been created.\n\nTemporary password: ${password}\n\nPlease log in at the admin panel and change your password immediately.`,
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
        <h2 style="color:#003366">Z-Quiz Account Created</h2>
        <p>Your temporary password is:</p>
        <div style="font-size:20px;font-weight:bold;text-align:center;padding:16px;background:#f0f7ff;border-radius:8px;margin:16px 0;font-family:monospace">${password}</div>
        <p style="color:#cc0000;font-weight:bold">Please log in and change your password immediately.</p>
      </div>`
  });
}

module.exports = { isConfigured, sendVerificationCode, sendTempPassword };
