const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

// ─── Join quiz ──────────────────────────────────────────────

router.post('/join', (req, res) => {
  const { name, quiz_code } = req.body;
  if (!name || !quiz_code) {
    return res.status(400).json({ error: 'Name and quiz_code required' });
  }

  const admin = db.getAdminByQuizCode(quiz_code.toUpperCase());
  if (!admin) {
    return res.status(404).json({ error: 'Quiz not found' });
  }

  // Check if already joined (by cookie or token in body)
  const existingToken = req.cookies.quiz_token || req.body.token;
  if (existingToken) {
    const existing = db.getPlayerByToken(existingToken);
    if (existing && existing.admin_id === admin.id) {
      return res.json({
        player: { id: existing.id, name: existing.name },
        token: existingToken,
        quiz_code: admin.quiz_code,
        quiz_name: admin.quiz_name
      });
    }
  }

  const token = uuidv4();
  const result = db.createPlayer(admin.id, name.trim(), token);
  const playerId = result.lastInsertRowid;

  res.cookie('quiz_token', token, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  // Notify admin of new player
  const io = req.app.get('io');
  const count = db.getPlayerCount(admin.id);
  io.to(admin.quiz_code).emit('player:joined', { name: name.trim(), count });
  io.to(admin.quiz_code).emit('player:count', { count });

  res.json({
    player: { id: playerId, name: name.trim() },
    token,
    quiz_code: admin.quiz_code,
    quiz_name: admin.quiz_name
  });
});

// ─── Get current player ────────────────────────────────────

router.get('/me', (req, res) => {
  const token = req.cookies.quiz_token || req.query.token;
  if (!token) return res.status(401).json({ error: 'Not joined' });

  const player = db.getPlayerByToken(token);
  if (!player) return res.status(401).json({ error: 'Not joined' });

  const admin = db.getAdminById(player.admin_id);
  res.json({
    player: { id: player.id, name: player.name, total_score: player.total_score },
    token,
    quiz_code: admin.quiz_code,
    quiz_name: admin.quiz_name
  });
});

// ─── Get game state ────────────────────────────────────────

router.get('/state', (req, res) => {
  const { quiz_code } = req.query;
  if (!quiz_code) return res.status(400).json({ error: 'quiz_code required' });

  const admin = db.getAdminByQuizCode(quiz_code.toUpperCase());
  if (!admin) return res.status(404).json({ error: 'Quiz not found' });

  const state = db.getGameState(admin.id);
  const playerCount = db.getPlayerCount(admin.id);

  const response = {
    status: state.status,
    day: state.day,
    language: state.language,
    playerCount,
    quiz_name: admin.quiz_name
  };

  // Include current question if active
  if (state.current_question_id && ['question_active', 'answers_visible', 'question_closed'].includes(state.status)) {
    const q = db.getQuestionWithAnswers(state.current_question_id);
    if (q) {
      response.question = {
        id: q.id,
        question_text: q.question_text
      };
      if (state.status === 'answers_visible') {
        response.question.answers = q.answers.map(a => ({ id: a.id, answer_text: a.answer_text }));
        const cat = db.getCategoryById(q.category_id);
        response.question.timerSeconds = cat ? cat.timer_seconds : 15;
      }
      if (state.status === 'question_closed') {
        response.question.answers = q.answers.map(a => ({
          id: a.id, answer_text: a.answer_text, is_correct: !!a.is_correct
        }));
        response.question.stats = db.getResponseStats(q.id);
      }
    }
  }

  if (state.status === 'showing_leaderboard') {
    const ctx = global.activeLeaderboardContext && global.activeLeaderboardContext[admin.id];
    if (ctx && ctx.categoryId && !ctx.overall) {
      response.leaderboard = db.getCategoryLeaderboard(admin.id, ctx.categoryId);
      response.categoryName = ctx.categoryName;
      response.overall = false;
    } else {
      response.leaderboard = db.getOverallLeaderboard(admin.id);
      response.overall = true;
    }
  }

  if (state.status === 'finale') {
    response.top3 = db.getTop3(admin.id);
  }

  res.json(response);
});

// ─── Get player names (for presenter) ──────────────────────

router.get('/player-names', (req, res) => {
  const { quiz_code } = req.query;
  if (!quiz_code) return res.status(400).json({ error: 'quiz_code required' });

  const admin = db.getAdminByQuizCode(quiz_code.toUpperCase());
  if (!admin) return res.status(404).json({ error: 'Quiz not found' });

  const players = db.getPlayerNames(admin.id);
  res.json({ players });
});

// ─── QR code (for presenter, no auth) ──────────────────────

router.get('/qr', async (req, res) => {
  const { quiz_code } = req.query;
  if (!quiz_code) return res.status(400).json({ error: 'quiz_code required' });

  const admin = db.getAdminByQuizCode(quiz_code.toUpperCase());
  if (!admin) return res.status(404).json({ error: 'Quiz not found' });

  const QRCode = require('qrcode');
  const baseUrl = req.query.base_url || `${req.protocol}://${req.get('host')}`;
  const url = `${baseUrl}/join/${admin.quiz_code}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    res.json({ qr: dataUrl, url });
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ─── Get quiz info (for landing page) ──────────────────────

router.get('/quiz-info', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const admin = db.getAdminByQuizCode(code.toUpperCase());
  if (!admin) return res.status(404).json({ error: 'Quiz not found' });

  res.json({
    quiz_code: admin.quiz_code,
    quiz_name: admin.quiz_name
  });
});

module.exports = router;
