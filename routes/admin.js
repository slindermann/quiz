const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { createSession, getSession, deleteSession, SESSION_MAX_AGE } = require('../sessions');

// ─── Rate limiters ──────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// ─── Multer setup for logo uploads (M2: MIME type validation) ─

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, `logo-${req.admin.id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

// ─── Logo helpers ───────────────────────────────────────────

const fs = require('fs');

function getAdminLogoPath(adminId) {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  for (const ext of ALLOWED_IMAGE_EXTS) {
    const filePath = path.join(uploadsDir, `logo-${adminId}${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function deleteAdminLogo(adminId) {
  const logoPath = getAdminLogoPath(adminId);
  if (logoPath) fs.unlinkSync(logoPath);
}

// ─── Auth middleware ────────────────────────────────────────

function requireAdmin(req, res, next) {
  // Check session cookie first (H4)
  const sessionToken = req.cookies && req.cookies.admin_session;
  if (sessionToken) {
    const session = getSession(sessionToken);
    if (session) {
      const admin = db.getAdminById(session.adminId);
      if (admin) {
        req.admin = admin;
        return next();
      }
    }
    res.clearCookie('admin_session', { path: '/' });
  }

  // Fallback to Basic Auth (for API/testing)
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    // L6: Handle colons in password
    const idx = decoded.indexOf(':');
    if (idx > 0) {
      const username = decoded.substring(0, idx);
      const password = decoded.substring(idx + 1);
      const admin = db.getAdminByUsername(username);
      if (admin && bcrypt.compareSync(password, admin.password_hash)) {
        req.admin = admin;
        return next();
      }
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}

function requireSuperadmin(req, res, next) {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

// ─── Public routes (no auth) ────────────────────────────────

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const admin = db.getAdminByUsername(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createSession(admin.id);
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    path: '/'
  });

  const { password_hash, ...adminData } = admin;
  const state = db.getGameState(admin.id);
  res.json({ admin: adminData, state });
});

router.post('/logout', (req, res) => {
  const sessionToken = req.cookies && req.cookies.admin_session;
  if (sessionToken) {
    deleteSession(sessionToken);
    res.clearCookie('admin_session', { path: '/' });
  }
  res.json({ ok: true });
});

// ─── All routes below require authentication ────────────────

router.use(requireAdmin);

// ─── Admin info ─────────────────────────────────────────────

router.get('/me', (req, res) => {
  const { password_hash, ...admin } = req.admin;
  const state = db.getGameState(req.admin.id);
  res.json({ admin, state });
});

// ─── Admin management (superadmin only) ─────────────────────

router.get('/admins', requireSuperadmin, (req, res) => {
  const admins = db.getAllAdmins();
  res.json(admins);
});

router.post('/admins', requireSuperadmin, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.getAdminByUsername(email);
  if (existing) return res.status(409).json({ error: 'An admin with this email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.createAdmin(email, hash);
  res.json({ ok: true, id: result.id, quiz_code: result.quiz_code });
});

router.delete('/admins/:id', requireSuperadmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.admin.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const target = db.getAdminById(targetId);
  if (!target) return res.status(404).json({ error: 'Admin not found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'Cannot delete another superadmin' });

  db.deleteAdmin(targetId);
  res.json({ ok: true });
});

// ─── Password change (all admins) ──────────────────────────

router.put('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  if (!bcrypt.compareSync(currentPassword, req.admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.updateAdminPassword(req.admin.id, hash);
  res.json({ ok: true });
});

// ─── Categories ─────────────────────────────────────────────

router.get('/categories', (req, res) => {
  const cats = db.getCategories(req.admin.id);
  const enriched = cats.map(c => {
    const qCount = db.getQuestionCountByCategory(c.id);
    return { ...c, question_count: qCount };
  });
  res.json(enriched);
});

router.post('/categories', (req, res) => {
  const { name, timer_seconds } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.createCategory(req.admin.id, name, timer_seconds || 15);
  res.json({ id: result.lastInsertRowid });
});

router.put('/categories/:id', (req, res) => {
  const cat = db.getCategoryById(req.params.id);
  if (!cat || cat.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'sort_order', 'timer_seconds'];
  const fields = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  db.updateCategory(req.params.id, fields);
  res.json({ ok: true });
});

router.put('/categories/:id/unlock', (req, res) => {
  const cat = db.getCategoryById(req.params.id);
  if (!cat || cat.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  db.updateCategory(req.params.id, { unlocked: 1 });
  res.json({ ok: true });
});

router.put('/categories/:id/lock', (req, res) => {
  const cat = db.getCategoryById(req.params.id);
  if (!cat || cat.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  db.updateCategory(req.params.id, { unlocked: 0 });
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  const cat = db.getCategoryById(req.params.id);
  if (!cat || cat.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  db.deleteCategory(req.params.id);
  res.json({ ok: true });
});

// ─── Questions ──────────────────────────────────────────────

router.get('/questions', (req, res) => {
  const questions = db.getQuestionsByAdmin(req.admin.id);
  // Attach answers
  const enriched = questions.map(q => ({
    ...q,
    answers: db.getAnswersByQuestion(q.id)
  }));
  res.json(enriched);
});

router.get('/questions/:id', (req, res) => {
  const q = db.getQuestionWithAnswers(parseInt(req.params.id));
  if (!q || q.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  res.json(q);
});

router.post('/questions', (req, res) => {
  const { category_id, question_text, answers } = req.body;
  if (!category_id || !question_text) {
    return res.status(400).json({ error: 'category_id and question_text required' });
  }
  const cat = db.getCategoryById(category_id);
  if (!cat || cat.admin_id !== req.admin.id) {
    return res.status(404).json({ error: 'Category not found' });
  }
  const result = db.createQuestion(category_id, req.admin.id, question_text);
  const qId = result.lastInsertRowid;

  if (answers && Array.isArray(answers)) {
    for (const a of answers) {
      db.createAnswer(qId, a.answer_text, a.is_correct ? 1 : 0);
    }
  }
  res.json({ id: qId });
});

router.put('/questions/:id', (req, res) => {
  const q = db.getQuestionById(parseInt(req.params.id));
  if (!q || q.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  const allowed = ['question_text', 'sort_order', 'active', 'category_id'];
  const fields = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  db.updateQuestion(req.params.id, fields);
  res.json({ ok: true });
});

router.delete('/questions/:id', (req, res) => {
  const q = db.getQuestionById(parseInt(req.params.id));
  if (!q || q.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  db.deleteQuestion(req.params.id);
  res.json({ ok: true });
});

// ─── Answers ────────────────────────────────────────────────

router.post('/answers', (req, res) => {
  const { question_id, answer_text, is_correct } = req.body;
  if (!question_id || !answer_text) {
    return res.status(400).json({ error: 'question_id and answer_text required' });
  }
  const q = db.getQuestionById(question_id);
  if (!q || q.admin_id !== req.admin.id) {
    return res.status(404).json({ error: 'Question not found' });
  }
  const result = db.createAnswer(question_id, answer_text, is_correct ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/answers/:id', (req, res) => {
  const answer = db.getAnswerWithOwner(parseInt(req.params.id));
  if (!answer || answer.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  const allowed = ['answer_text', 'is_correct', 'sort_order'];
  const fields = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  db.updateAnswer(req.params.id, fields);
  res.json({ ok: true });
});

router.delete('/answers/:id', (req, res) => {
  const answer = db.getAnswerWithOwner(parseInt(req.params.id));
  if (!answer || answer.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });
  db.deleteAnswer(req.params.id);
  res.json({ ok: true });
});

// ─── Game control ───────────────────────────────────────────

router.post('/start-question/:id', (req, res) => {
  const q = db.getQuestionWithAnswers(parseInt(req.params.id));
  if (!q || q.admin_id !== req.admin.id) return res.status(404).json({ error: 'Not found' });

  db.updateGameState(req.admin.id, {
    current_question_id: q.id,
    status: 'question_active'
  });

  const io = req.app.get('io');
  const room = req.admin.quiz_code;
  const state = db.getGameState(req.admin.id);

  // Send question text only (no answers yet)
  io.to(room).emit('question:show', {
    questionId: q.id,
    questionText: q.question_text,
    answerDelay: state.answer_delay_seconds
  });
  io.to(room).emit('game:state', { status: 'question_active', currentQuestionId: q.id });

  // Schedule answers to appear after delay
  const delay = (state.answer_delay_seconds || 3) * 1000;
  setTimeout(() => {
    const currentState = db.getGameState(req.admin.id);
    if (currentState.status !== 'question_active' || currentState.current_question_id !== q.id) {
      return; // State changed, don't show answers
    }
    db.updateGameState(req.admin.id, { status: 'answers_visible' });

    // Record timestamp for time-based scoring
    const answersVisibleAt = req.app.get('answersVisibleAt');
    if (answersVisibleAt) answersVisibleAt[req.admin.id] = Date.now();

    const cat = db.getCategoryById(q.category_id);
    const timerSeconds = cat ? cat.timer_seconds : 15;

    io.to(room).emit('question:answers-visible', {
      questionId: q.id,
      answers: q.answers.map(a => ({ id: a.id, answer_text: a.answer_text })),
      timerSeconds
    });
    io.to(room).emit('game:state', { status: 'answers_visible', currentQuestionId: q.id });

    // Start countdown
    let remaining = timerSeconds;
    const timer = setInterval(() => {
      remaining--;
      io.to(room).emit('question:tick', { remaining, total: timerSeconds });
      if (remaining <= 0) {
        clearInterval(timer);
        closeQuestion(req.admin.id, q.id, io, room);
      }
    }, 1000);

    // Store timer so it can be cancelled
    if (!global.activeTimers) global.activeTimers = {};
    if (global.activeTimers[req.admin.id]) clearInterval(global.activeTimers[req.admin.id]);
    global.activeTimers[req.admin.id] = timer;
  }, delay);

  res.json({ ok: true, questionId: q.id });
});

function closeQuestion(adminId, questionId, io, room) {
  const currentState = db.getGameState(adminId);
  if (currentState.status !== 'answers_visible' && currentState.status !== 'question_active') {
    return;
  }

  if (global.activeTimers && global.activeTimers[adminId]) {
    clearInterval(global.activeTimers[adminId]);
    delete global.activeTimers[adminId];
  }

  db.updateGameState(adminId, { status: 'question_closed' });

  const q = db.getQuestionWithAnswers(questionId);
  const stats = db.getResponseStats(questionId);
  const correctAnswer = q.answers.find(a => a.is_correct);

  // Send closed event with stats (presenter + admin see stats)
  io.to(room).emit('question:closed', {
    questionId,
    correctAnswerId: correctAnswer ? correctAnswer.id : null,
    stats
  });
  io.to(room).emit('game:state', { status: 'question_closed', currentQuestionId: questionId });

  // Send individual answer results to each player now that question is closed
  const sockets = io.sockets.adapter.rooms.get(room);
  if (sockets) {
    for (const socketId of sockets) {
      const s = io.sockets.sockets.get(socketId);
      if (s && s.playerId) {
        const resp = db.getPlayerResponse(s.playerId, questionId);
        if (resp) {
          const newTotal = db.updatePlayerScore(s.playerId);
          s.emit('answer:result', {
            correct: !!resp.is_correct,
            points: resp.points_earned,
            totalScore: newTotal
          });
        }
      }
    }
  }

  // Auto-show category leaderboard if all questions in category are played
  if (q && db.isCategoryFullyPlayed(q.category_id)) {
    const cat = db.getCategoryById(q.category_id);
    setTimeout(() => {
      const currentState2 = db.getGameState(adminId);
      if (currentState2.status !== 'question_closed') return;
      const leaderboard = db.getCategoryLeaderboard(adminId, q.category_id);
      const categoryName = cat ? cat.name : 'Category';
      db.updateGameState(adminId, { status: 'showing_leaderboard', current_question_id: null });
      if (!global.activeLeaderboardContext) global.activeLeaderboardContext = {};
      global.activeLeaderboardContext[adminId] = { categoryId: q.category_id, categoryName, overall: false };
      io.to(room).emit('leaderboard:show', { leaderboard, categoryName, overall: false });
      io.to(room).emit('game:state', { status: 'showing_leaderboard' });
    }, 4000);
  }
}

router.post('/close-question', (req, res) => {
  const state = db.getGameState(req.admin.id);
  if (!state.current_question_id) return res.status(400).json({ error: 'No active question' });

  const io = req.app.get('io');
  closeQuestion(req.admin.id, state.current_question_id, io, req.admin.quiz_code);
  res.json({ ok: true });
});

router.post('/show-leaderboard', (req, res) => {
  db.updateGameState(req.admin.id, { status: 'showing_leaderboard', current_question_id: null });

  const { categoryId, overall } = req.body || {};
  let leaderboard, categoryName = null, isOverall = !!overall;

  if (categoryId && !overall) {
    leaderboard = db.getCategoryLeaderboard(req.admin.id, categoryId);
    const cat = db.getCategoryById(categoryId);
    categoryName = cat ? cat.name : 'Category';
  } else {
    leaderboard = db.getOverallLeaderboard(req.admin.id);
    isOverall = true;
  }

  if (!global.activeLeaderboardContext) global.activeLeaderboardContext = {};
  global.activeLeaderboardContext[req.admin.id] = { categoryId: categoryId || null, categoryName, overall: isOverall };

  const io = req.app.get('io');
  io.to(req.admin.quiz_code).emit('leaderboard:show', { leaderboard, categoryName, overall: isOverall });
  io.to(req.admin.quiz_code).emit('game:state', { status: 'showing_leaderboard' });
  res.json({ ok: true, leaderboard });
});

router.post('/go-idle', (req, res) => {
  db.updateGameState(req.admin.id, { status: 'idle', current_question_id: null });
  const io = req.app.get('io');
  io.to(req.admin.quiz_code).emit('game:state', { status: 'idle' });
  res.json({ ok: true });
});

router.post('/start-finale', (req, res) => {
  db.updateGameState(req.admin.id, { status: 'finale', current_question_id: null });
  const top3 = db.getTop3(req.admin.id);
  const io = req.app.get('io');
  io.to(req.admin.quiz_code).emit('game:state', { status: 'finale' });
  io.to(req.admin.quiz_code).emit('finale:start', { count: top3.length });
  res.json({ ok: true, top3 });
});

router.post('/reveal-next', (req, res) => {
  const { place } = req.body; // 3, 2, or 1
  const top3 = db.getTop3(req.admin.id);
  const idx = place - 1;
  if (idx < 0 || idx >= top3.length) return res.status(400).json({ error: 'Invalid place' });
  const player = top3[idx];
  const io = req.app.get('io');
  io.to(req.admin.quiz_code).emit('finale:reveal', { place, player });
  res.json({ ok: true, player });
});

router.post('/reset-quiz', (req, res) => {
  const oldCode = req.admin.quiz_code;
  const result = db.resetQuiz(req.admin.id);

  deleteAdminLogo(req.admin.id);

  if (global.activeLeaderboardContext) delete global.activeLeaderboardContext[req.admin.id];

  const io = req.app.get('io');
  io.to(oldCode).emit('game:state', { status: 'idle' });
  io.to(oldCode).emit('quiz:code-changed', { newCode: result.quiz_code });
  res.json({ ok: true, quiz_code: result.quiz_code });
});

router.post('/seed-examples', (req, res) => {
  db.seedExampleQuestions(req.admin.id);
  res.json({ ok: true });
});

// ─── Settings ───────────────────────────────────────────────

router.put('/settings', (req, res) => {
  const { language, answer_delay_seconds, quiz_name } = req.body;
  if (language || answer_delay_seconds !== undefined) {
    const fields = {};
    if (language) fields.language = language;
    if (answer_delay_seconds !== undefined) fields.answer_delay_seconds = answer_delay_seconds;
    db.updateGameState(req.admin.id, fields);
  }
  if (quiz_name) {
    db.updateAdminField(req.admin.id, 'quiz_name', quiz_name);
  }
  res.json({ ok: true });
});

// ─── Logo upload ────────────────────────────────────────────

router.post('/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: `/uploads/${req.file.filename}` });
});

router.delete('/delete-logo', (req, res) => {
  deleteAdminLogo(req.admin.id);
  res.json({ ok: true });
});

// ─── QR Code ────────────────────────────────────────────────

router.get('/qrcode', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const url = `${baseUrl}/join/${req.admin.quiz_code}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
    res.json({ qr: dataUrl, url });
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ─── Stats ──────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const players = db.getPlayersByAdmin(req.admin.id);
  const playerCount = players.length;
  const state = db.getGameState(req.admin.id);
  res.json({ playerCount, state, players });
});

// ─── Export ─────────────────────────────────────────────────

router.get('/export', (req, res) => {
  const results = db.getFullResults(req.admin.id);
  const header = 'Player,Question,Answer,Correct,Points,Time(ms)\n';
  const csv = header + results.map(r =>
    `${csvSafe(r.name)},${csvSafe(r.question_text)},${csvSafe(r.answer_text)},${r.is_correct},${r.points_earned},${r.response_time_ms}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=quiz-results.csv');
  res.send(csv);
});

// H7: Sanitize CSV values to prevent formula injection
function csvSafe(str) {
  if (!str) return '""';
  let s = String(str);
  // Prefix formula-triggering characters
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Escape double quotes and wrap in quotes
  return '"' + s.replace(/"/g, '""') + '"';
}

// ─── Import questions ───────────────────────────────────────

router.post('/import', (req, res) => {
  const { categories } = req.body;
  if (!Array.isArray(categories)) return res.status(400).json({ error: 'Expected { categories: [...] }' });

  let qCount = 0;
  for (const cat of categories) {
    const catResult = db.createCategory(req.admin.id, cat.name, cat.timer_seconds || 15);
    const catId = catResult.lastInsertRowid;
    if (cat.questions && Array.isArray(cat.questions)) {
      for (const q of cat.questions) {
        const qResult = db.createQuestion(catId, req.admin.id, q.question_text);
        const qId = qResult.lastInsertRowid;
        qCount++;
        if (q.answers && Array.isArray(q.answers)) {
          for (const a of q.answers) {
            db.createAnswer(qId, a.answer_text, a.is_correct ? 1 : 0);
          }
        }
      }
    }
  }
  res.json({ ok: true, imported: qCount });
});

// ─── CSV Import + Template ─────────────────────────────────

router.get('/import-template-csv', (req, res) => {
  const csv = `Category,Timer(s),Question,Answer A,Answer B,Answer C,Answer D,Correct
"Zero Trust Basics",15,"What does ZPA stand for?","Zscaler Private Access","Zscaler Public Access","Zero Point Authentication","Zone Protected Area","A"
"Zero Trust Basics",15,"Which protocol does ZIA inspect?","SSL/TLS","FTP only","SMTP only","DNS only","A"
"Zero Trust Basics",20,"Which of the following are core Zero Trust principles?","Never trust - always verify","Least privilege access","Direct-to-internet connections","Perimeter-based security","A;B;C"
`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=quiz-import-template.csv');
  res.send(csv);
});

router.get('/import-template-json', (req, res) => {
  const template = {
    categories: [
      {
        name: "Zero Trust Basics",
        timer_seconds: 15,
        questions: [
          {
            question_text: "What does ZPA stand for?",
            answers: [
              { answer_text: "Zscaler Private Access", is_correct: true },
              { answer_text: "Zscaler Public Access", is_correct: false },
              { answer_text: "Zero Point Authentication", is_correct: false },
              { answer_text: "Zone Protected Area", is_correct: false }
            ]
          },
          {
            question_text: "Which are core Zero Trust principles?",
            answers: [
              { answer_text: "Never trust, always verify", is_correct: true },
              { answer_text: "Least privilege access", is_correct: true },
              { answer_text: "Perimeter-based security", is_correct: false }
            ]
          }
        ]
      }
    ]
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=quiz-import-template.json');
  res.send(JSON.stringify(template, null, 2));
});

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/import-csv', csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const text = req.file.buffer.toString('utf-8');
  const lines = parseCSV(text);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + data rows' });

  // Skip header
  const rows = lines.slice(1);
  const categoryMap = {};
  let qCount = 0;

  for (const row of rows) {
    if (row.length < 7) continue;
    const [catName, timerStr, questionText, ...rest] = row;
    if (!catName || !questionText) continue;

    const timer = parseInt(timerStr) || 15;
    const correctField = (rest[rest.length - 1] || '').trim().toUpperCase();
    // Support multiple correct: "A;B;C" or "A,B,C" or just "A"
    const correctLetters = correctField.split(/[;,]/).map(l => l.trim()).filter(Boolean);
    const answerTexts = rest.slice(0, rest.length - 1);

    // Get or create category
    if (!categoryMap[catName]) {
      const catResult = db.createCategory(req.admin.id, catName.trim(), timer);
      categoryMap[catName] = catResult.lastInsertRowid;
    }
    const catId = categoryMap[catName];

    const qResult = db.createQuestion(catId, req.admin.id, questionText.trim());
    const qId = qResult.lastInsertRowid;
    qCount++;

    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    answerTexts.forEach((aText, i) => {
      if (aText.trim()) {
        const isCorrect = correctLetters.includes(letters[i]) ? 1 : 0;
        db.createAnswer(qId, aText.trim(), isCorrect);
      }
    });
  }

  res.json({ ok: true, imported: qCount });
});

function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        current.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        current.push(field);
        field = '';
        if (current.some(f => f.trim())) rows.push(current);
        current = [];
      } else {
        field += c;
      }
    }
  }
  current.push(field);
  if (current.some(f => f.trim())) rows.push(current);
  return rows;
}

// ─── Players management ────────────────────────────────────

router.get('/players', (req, res) => {
  const players = db.getPlayersByAdmin(req.admin.id);
  res.json(players);
});

router.delete('/players/:id', (req, res) => {
  db.deletePlayer(parseInt(req.params.id), req.admin.id);
  res.json({ ok: true });
});

module.exports = router;
