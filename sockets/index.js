const cookie = require('cookie');
const db = require('../db/database');
const { getSession } = require('../sessions');
const { closeQuestion } = require('../routes/admin');

// Track when answers became visible per quiz (for time-based scoring)
const answersVisibleAt = {};

// Simple per-socket rate limiter
function rateLimit(socket, event, maxPerMinute) {
  if (!socket._rateLimits) socket._rateLimits = {};
  const now = Date.now();
  const key = event;
  if (!socket._rateLimits[key]) socket._rateLimits[key] = [];
  socket._rateLimits[key] = socket._rateLimits[key].filter(ts => now - ts < 60000);
  if (socket._rateLimits[key].length >= maxPerMinute) return false;
  socket._rateLimits[key].push(now);
  return true;
}

module.exports = function setupSockets(io) {
  io.on('connection', (socket) => {

    // ─── Join quiz room ───────────────────────────────────

    socket.on('quiz:join', ({ quiz_code, playerToken }) => {
      if (!quiz_code) return;
      if (!rateLimit(socket, 'quiz:join', 10)) return;

      const code = quiz_code.toUpperCase();
      socket.join(code);
      socket.quizCode = code;

      // Identify the player and verify they belong to this quiz
      if (playerToken) {
        const player = db.getPlayerByToken(playerToken);
        const admin = db.getAdminByQuizCode(code);
        if (player && admin && player.admin_id === admin.id) {
          socket.playerId = player.id;
          socket.playerName = player.name;
          socket.adminId = admin.id;
        } else {
          socket.playerId = null;
          socket.playerName = null;
          socket.adminId = null;
        }
      }

      // Send current state
      const admin = db.getAdminByQuizCode(code);
      if (admin) {
        const state = db.getGameState(admin.id);
        const playerCount = db.getPlayerCount(admin.id);
        socket.emit('game:state', {
          status: state.status,
          currentQuestionId: state.current_question_id,
          day: state.day,
          language: state.language
        });
        socket.emit('player:count', { count: playerCount });
      }
    });

    // ─── Admin joins (H6: validate session) ───────────────

    socket.on('admin:join', ({ quiz_code }) => {
      if (!quiz_code) return;
      const code = quiz_code.toUpperCase();

      // Validate admin session from cookie
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const sessionToken = cookies.admin_session;
      const session = getSession(sessionToken);
      if (!session) {
        return socket.emit('error', { message: 'Authentication required' });
      }

      const admin = db.getAdminById(session.adminId);
      if (!admin || admin.quiz_code !== code) {
        return socket.emit('error', { message: 'Unauthorized' });
      }

      socket.join(code);
      socket.quizCode = code;
      socket.isAdmin = true;
      socket.adminId = admin.id;
    });

    // ─── Submit answer ────────────────────────────────────

    socket.on('answer:submit', ({ questionId, answerId }) => {
      if (!socket.playerId || !socket.quizCode) {
        return socket.emit('answer:error', { error: 'Not in a quiz' });
      }
      if (!rateLimit(socket, 'answer:submit', 30)) {
        return socket.emit('answer:error', { error: 'Too many requests' });
      }

      const admin = db.getAdminByQuizCode(socket.quizCode);
      if (!admin) return;

      // Verify player belongs to this quiz
      if (socket.adminId !== admin.id) {
        return socket.emit('answer:error', { error: 'Not in this quiz' });
      }

      const state = db.getGameState(admin.id);
      if (state.status !== 'answers_visible') {
        return socket.emit('answer:error', { error: 'Answers not accepted right now' });
      }

      // Coerce to number for comparison (sql.js may return different types)
      const currentQId = Number(state.current_question_id);
      const submittedQId = Number(questionId);
      if (currentQId !== submittedQId) {
        return socket.emit('answer:error', { error: 'Wrong question' });
      }

      // Already answered?
      if (db.hasPlayerAnswered(socket.playerId, submittedQId)) {
        return socket.emit('answer:error', { error: 'Already answered' });
      }

      // Calculate points
      const q = db.getQuestionWithAnswers(submittedQId);
      if (!q) return;
      const answer = q.answers.find(a => Number(a.id) === Number(answerId));
      if (!answer) return;

      const cat = db.getCategoryById(q.category_id);
      const timerSeconds = cat ? cat.timer_seconds : 15;

      const isCorrect = !!answer.is_correct;
      let points = 0;

      // Calculate response time from when answers became visible
      const visibleTs = answersVisibleAt[admin.id];
      const responseTimeMs = visibleTs ? (Date.now() - visibleTs) : 0;

      if (isCorrect) {
        // Base 1000 + speed bonus up to 500
        const timeRatio = Math.max(0, 1 - (responseTimeMs / (timerSeconds * 1000)));
        points = 1000 + Math.round(500 * timeRatio);
      }

      db.saveResponse(socket.playerId, submittedQId, Number(answerId), isCorrect, responseTimeMs, points);
      db.updatePlayerScore(socket.playerId);

      // Don't reveal correct/wrong yet — just acknowledge receipt
      socket.emit('answer:ack', { received: true });

      // Update live answer count
      const count = db.getAnswerCount(submittedQId);
      io.to(socket.quizCode).emit('question:answer-count', { questionId: submittedQId, count });

      // Auto-close question 1s after all players have answered
      const playerCount = db.getPlayerCount(admin.id);
      if (count >= playerCount) {
        if (!global.autoCloseTimers) global.autoCloseTimers = {};
        if (!global.autoCloseTimers[admin.id]) {
          global.autoCloseTimers[admin.id] = setTimeout(() => {
            delete global.autoCloseTimers[admin.id];
            closeQuestion(admin.id, submittedQId, io, socket.quizCode);
          }, 1000);
        }
      }
    });

    // ─── Disconnect ───────────────────────────────────────

    socket.on('disconnect', () => {
      // Could track online players here if needed
    });
  });

  // Expose answersVisibleAt for the routes to set
  return { answersVisibleAt };
};
