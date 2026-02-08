const db = require('../db/database');

// Track when answers became visible per quiz (for time-based scoring)
const answersVisibleAt = {};

module.exports = function setupSockets(io) {
  io.on('connection', (socket) => {

    // ─── Join quiz room ───────────────────────────────────

    socket.on('quiz:join', ({ quiz_code, playerToken }) => {
      if (!quiz_code) return;
      const code = quiz_code.toUpperCase();
      socket.join(code);
      socket.quizCode = code;

      // Identify the player
      if (playerToken) {
        const player = db.getPlayerByToken(playerToken);
        if (player) {
          socket.playerId = player.id;
          socket.playerName = player.name;
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

    // ─── Admin joins ──────────────────────────────────────

    socket.on('admin:join', ({ quiz_code }) => {
      if (!quiz_code) return;
      const code = quiz_code.toUpperCase();
      socket.join(code);
      socket.quizCode = code;
      socket.isAdmin = true;
    });

    // ─── Submit answer ────────────────────────────────────

    socket.on('answer:submit', ({ questionId, answerId }) => {
      if (!socket.playerId || !socket.quizCode) {
        return socket.emit('answer:error', { error: 'Not in a quiz' });
      }

      const admin = db.getAdminByQuizCode(socket.quizCode);
      if (!admin) return;

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
    });

    // ─── Disconnect ───────────────────────────────────────

    socket.on('disconnect', () => {
      // Could track online players here if needed
    });
  });

  // Expose answersVisibleAt for the routes to set
  return { answersVisibleAt };
};
