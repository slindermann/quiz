const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const mail = require('../mail');

const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function copySuperadminLogo(targetAdminId) {
  const superadmin = db.getAdminByUsername(process.env.ADMIN_USER || 'admin');
  if (!superadmin || superadmin.id === targetAdminId) return;
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  let srcPath = null;
  for (const ext of ALLOWED_IMAGE_EXTS) {
    const p = path.join(uploadsDir, `logo-${superadmin.id}${ext}`);
    if (fs.existsSync(p)) { srcPath = p; break; }
  }
  if (!srcPath) return;
  const ext = path.extname(srcPath);
  fs.copyFileSync(srcPath, path.join(uploadsDir, `logo-${targetAdminId}${ext}`));
}

const ALLOWED_DOMAIN = process.env.REGISTRATION_DOMAIN || 'zscaler.com';

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─── Request verification code ───────────────────────────────

router.post('/register/request-code', registerLimiter, async (req, res) => {
  if (!mail.isConfigured()) {
    return res.status(503).json({ error: 'Registration is not available (SMTP not configured)' });
  }

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.endsWith('@' + ALLOWED_DOMAIN)) {
    return res.status(400).json({ error: `Only @${ALLOWED_DOMAIN} email addresses are allowed` });
  }

  // Clean up expired registrations
  db.cleanExpiredRegistrations();

  // Check if admin already exists — return same response to prevent user enumeration
  const existing = db.getAdminByUsername(normalizedEmail);
  if (existing) {
    return res.json({ ok: true });
  }

  // Generate 6-digit code
  const code = String(crypto.randomInt(100000, 999999));
  db.createPendingRegistration(normalizedEmail, code);

  try {
    await mail.sendVerificationCode(normalizedEmail, code);
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to send verification email:', e.message);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// ─── Verify code and create account ──────────────────────────

router.post('/register/verify', registerLimiter, async (req, res) => {
  if (!mail.isConfigured()) {
    return res.status(503).json({ error: 'Registration is not available (SMTP not configured)' });
  }

  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  const normalizedEmail = email.trim().toLowerCase();

  // Clean up expired registrations
  db.cleanExpiredRegistrations();

  const pending = db.getPendingRegistration(normalizedEmail);
  if (!pending) {
    return res.status(400).json({ error: 'No pending registration found. Please request a new code.' });
  }

  if (pending.attempts >= 5) {
    db.deletePendingRegistration(normalizedEmail);
    return res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
  }

  if (pending.code !== code.trim()) {
    db.incrementRegistrationAttempts(normalizedEmail);
    return res.status(400).json({ error: 'Invalid verification code' });
  }

  // Code is valid — create the admin account
  const tempPassword = crypto.randomBytes(8).toString('base64url');
  const hash = bcrypt.hashSync(tempPassword, 10);
  const result = db.createAdmin(normalizedEmail, hash);
  db.setMustChangePassword(result.id, true);
  copySuperadminLogo(result.id);
  db.deletePendingRegistration(normalizedEmail);

  try {
    await mail.sendTempPassword(normalizedEmail, tempPassword);
  } catch (e) {
    console.error('Failed to send temp password email:', e.message);
    // Account is created, but email failed — still return success
  }

  res.json({ ok: true });
});

module.exports = router;
