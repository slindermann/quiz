// ─── Player Client Logic ──────────────────────────────────────

const socket = io();
let quizCode = null;
let playerId = null;
let playerName = '';
let playerToken = null;
let totalScore = 0;
let currentQuestionId = null;
let hasAnswered = false;
let timerTotal = 15;

// ─── Token management ─────────────────────────────────────────

function saveToken(token) {
  playerToken = token;
  localStorage.setItem('quiz_token', token);
}

function getToken() {
  return playerToken || localStorage.getItem('quiz_token');
}

// ─── Init ─────────────────────────────────────────────────────

(function init() {
  // Get quiz code from URL
  const params = new URLSearchParams(window.location.search);
  quizCode = params.get('quiz');

  if (!quizCode) {
    // Show code entry screen
    document.getElementById('codeScreen').classList.remove('hidden');
    document.getElementById('codeBtn').addEventListener('click', submitCode);
    document.getElementById('quizCodeInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') submitCode();
    });
    // Try to load logo
    loadLogo();
    return;
  }

  initWithCode(quizCode);
})();

function submitCode() {
  const code = document.getElementById('quizCodeInput').value.trim().toUpperCase();
  if (!code) {
    document.getElementById('codeError').textContent = 'Please enter a quiz code';
    return;
  }
  // Verify the code exists
  fetch(`/api/quiz-info?code=${code}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('codeError').textContent = 'Quiz not found. Check the code and try again.';
        return;
      }
      // Redirect to the proper URL with the code
      window.location.href = `/?quiz=${data.quiz_code}`;
    })
    .catch(() => {
      document.getElementById('codeError').textContent = 'Connection error';
    });
}

function initWithCode(code) {
  quizCode = code;

  // Show join screen
  document.getElementById('joinScreen').classList.remove('hidden');

  // Check quiz exists and load info
  fetch(`/api/quiz-info?code=${quizCode}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('joinError').textContent = t('quizNotFound') || 'Quiz not found';
        document.getElementById('joinBtn').disabled = true;
        return;
      }
      document.getElementById('quizTitle').textContent = data.quiz_name || 'Z-Quiz';
      quizCode = data.quiz_code;
    })
    .catch(() => {});

  // Check if already joined (via cookie — sent automatically)
  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => {
      if (data.player && data.quiz_code === quizCode) {
        playerId = data.player.id;
        playerName = data.player.name;
        playerToken = data.token;
        totalScore = data.player.total_score || 0;
        enterQuiz();
      }
    })
    .catch(() => {});

  // Join button
  document.getElementById('joinBtn').addEventListener('click', joinQuiz);
  document.getElementById('playerName').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinQuiz();
  });

  // Try to load logo
  loadLogo();
}

function loadLogo() {
  if (!quizCode) return;
  const logo = document.getElementById('logo');
  const img = new Image();
  img.onload = () => { logo.src = img.src; logo.classList.remove('hidden'); };
  img.src = `/api/logo/${quizCode}`;
}

function joinQuiz() {
  const name = document.getElementById('playerName').value.trim();
  if (!name) {
    document.getElementById('joinError').textContent = t('nameRequired');
    return;
  }

  fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, quiz_code: quizCode })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('joinError').textContent = data.error;
        return;
      }
      playerId = data.player.id;
      playerName = data.player.name;
      saveToken(data.token);
      enterQuiz();
    })
    .catch(err => {
      document.getElementById('joinError').textContent = 'Connection error';
    });
}

function enterQuiz() {
  document.getElementById('codeScreen').classList.add('hidden');
  document.getElementById('joinScreen').classList.add('hidden');
  document.getElementById('quizScreen').classList.remove('hidden');
  document.getElementById('quizSubtitle').textContent = playerName;

  // Connect socket with token for player identification
  socket.emit('quiz:join', {
    quiz_code: quizCode,
    playerToken: getToken()
  });

  // Get current state
  fetch(`/api/state?quiz_code=${quizCode}`)
    .then(r => r.json())
    .then(handleStateSync)
    .catch(() => {});
}

// ─── State handling ───────────────────────────────────────────

function handleStateSync(state) {
  if (state.language) setLanguage(state.language);
  if (state.playerCount !== undefined) {
    document.getElementById('playerCount').style.display = '';
    document.getElementById('playerCountNum').textContent = state.playerCount;
  }

  switch (state.status) {
    case 'idle':
      showWaiting();
      break;
    case 'question_active':
      if (state.question) showQuestion(state.question);
      break;
    case 'answers_visible':
      if (state.question) {
        showQuestion(state.question);
        showAnswers(state.question.answers, state.question.timerSeconds);
      }
      break;
    case 'question_closed':
      if (state.question) showClosed(state.question);
      break;
    case 'showing_leaderboard':
      if (state.leaderboard) showLeaderboard(state.leaderboard, state.overall, state.categoryName);
      break;
    case 'finale':
      showFinale();
      break;
  }
}

// ─── UI State functions ───────────────────────────────────────

function hideAll() {
  ['waitingCard', 'questionCard', 'closedCard', 'leaderboardCard', 'finaleCard', 'resultOverlay'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

function showWaiting() {
  hideAll();
  document.getElementById('waitingCard').classList.remove('hidden');
  hasAnswered = false;
  currentQuestionId = null;
}

function showQuestion(q) {
  hideAll();
  currentQuestionId = q.id || q.questionId;
  hasAnswered = false;

  document.getElementById('questionCard').classList.remove('hidden');
  document.getElementById('questionText').textContent = q.question_text || q.questionText;
  document.getElementById('readPrompt').classList.remove('hidden');
  document.getElementById('timerSection').classList.add('hidden');
  document.getElementById('answersSection').classList.add('hidden');
  document.getElementById('answeredMsg').classList.add('hidden');
}

function showAnswers(answers, timerSeconds) {
  document.getElementById('readPrompt').classList.add('hidden');
  document.getElementById('timerSection').classList.remove('hidden');
  document.getElementById('answersSection').classList.remove('hidden');

  timerTotal = timerSeconds || 15;
  document.getElementById('timerCircle').textContent = timerTotal;
  document.getElementById('timerBar').style.width = '100%';

  const grid = document.getElementById('answersGrid');
  grid.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  answers.forEach((a, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.innerHTML = `<span class="answer-letter">${letters[i]}</span> ${escapeHtml(a.answer_text)}`;
    btn.addEventListener('click', () => submitAnswer(a.id, btn));
    grid.appendChild(btn);
  });
}

function submitAnswer(answerId, btn) {
  if (hasAnswered) return;
  hasAnswered = true;

  // Mark selected
  document.querySelectorAll('.answer-btn').forEach(b => b.classList.add('disabled'));
  btn.classList.add('selected');

  document.getElementById('answeredMsg').classList.remove('hidden');
  document.getElementById('answeredMsg').textContent = t('answerSent') || 'Answer sent!';

  socket.emit('answer:submit', {
    questionId: currentQuestionId,
    answerId: answerId
  });
}

function showClosed(data) {
  hideAll();
  document.getElementById('closedCard').classList.remove('hidden');

  const container = document.getElementById('closedAnswers');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  const answers = data.answers || (data.stats && data.stats.byAnswer) || [];
  const correctId = data.correctAnswerId;

  answers.forEach((a, i) => {
    const div = document.createElement('div');
    const isCorrect = a.is_correct || a.id === correctId;
    div.className = `answer-btn disabled ${isCorrect ? 'correct' : 'wrong'}`;
    div.innerHTML = `<span class="answer-letter">${letters[i]}</span> ${escapeHtml(a.answer_text)}`;
    // No stats/counts on player view — stats only on presenter
    container.appendChild(div);
  });

  // Clear stats section on player view (stats only on presenter)
  const statsDiv = document.getElementById('closedStats');
  if (statsDiv) statsDiv.innerHTML = '';
}

function showLeaderboard(leaderboard, overall, categoryName) {
  hideAll();
  document.getElementById('leaderboardCard').classList.remove('hidden');
  const title = document.getElementById('leaderboardTitle');
  if (title) {
    title.textContent = overall ? 'Overall Leaderboard' : (categoryName ? categoryName + ' Leaderboard' : 'Leaderboard');
  }
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';

  leaderboard.forEach((p, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const highlight = p.id === playerId ? 'highlight' : '';
    list.innerHTML += `
      <div class="leaderboard-item ${highlight}">
        <div class="leaderboard-rank ${rankClass}">${i + 1}</div>
        <div class="leaderboard-name">${escapeHtml(p.name)}</div>
        <div class="leaderboard-score">${p.total_score}</div>
      </div>`;
  });
}

function showFinale() {
  hideAll();
  document.getElementById('finaleCard').classList.remove('hidden');
  // Reset podium
  document.querySelectorAll('.podium-place').forEach(p => p.classList.remove('revealed'));
}

// ─── Socket events ────────────────────────────────────────────

socket.on('game:state', (data) => {
  if (data.status === 'idle') showWaiting();
  if (data.status === 'showing_leaderboard') {
    // Will receive leaderboard data separately
  }
  if (data.status === 'finale') showFinale();
  if (data.language) setLanguage(data.language);
});

socket.on('question:show', (data) => {
  showQuestion({ id: data.questionId, question_text: data.questionText });
});

socket.on('question:answers-visible', (data) => {
  currentQuestionId = data.questionId;
  showAnswers(data.answers, data.timerSeconds);
});

socket.on('question:tick', (data) => {
  const circle = document.getElementById('timerCircle');
  const bar = document.getElementById('timerBar');
  circle.textContent = data.remaining;
  const pct = (data.remaining / data.total) * 100;
  bar.style.width = pct + '%';

  circle.className = 'timer-circle';
  bar.className = 'timer-bar-fill';
  if (data.remaining <= 5) {
    circle.classList.add('danger');
    bar.classList.add('danger');
  } else if (data.remaining <= 10) {
    circle.classList.add('warning');
    bar.classList.add('warning');
  }
});

socket.on('question:closed', (data) => {
  showClosed(data);
});

// Answer acknowledged (but result not yet revealed)
socket.on('answer:ack', () => {
  // Just update UI to show answer was received
  const msg = document.getElementById('answeredMsg');
  if (msg) {
    msg.classList.remove('hidden');
    msg.textContent = t('answerSent') || 'Answer received - waiting for results...';
  }
});

// Answer result revealed (sent after question closes)
// Stays visible until admin moves to next question / waiting screen
socket.on('answer:result', (data) => {
  totalScore = data.totalScore;

  // Show result overlay — stays until next state change (hideAll clears it)
  const overlay = document.getElementById('resultOverlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="result-card slide-in">
      <div class="result-icon">${data.correct ? '&#10003;' : '&#10007;'}</div>
      <div class="result-text" style="color:${data.correct ? 'var(--zs-green)' : 'var(--zs-red)'}">
        ${data.correct ? t('correct') : t('wrong')}
      </div>
      <div class="result-points">+${data.points} ${t('points')}</div>
    </div>`;

  if (data.correct) launchConfetti();
});

socket.on('answer:error', (data) => {
  console.log('Answer error:', data.error);
});

socket.on('leaderboard:show', (data) => {
  showLeaderboard(data.leaderboard, data.overall, data.categoryName);
});

socket.on('finale:start', () => {
  showFinale();
});

socket.on('finale:reveal', (data) => {
  const el = document.getElementById(`podium${data.place}`);
  if (el) {
    document.getElementById(`podium${data.place}Name`).textContent = data.player.name;
    document.getElementById(`podium${data.place}Score`).textContent = data.player.total_score + ' pts';
    setTimeout(() => el.classList.add('revealed'), 100);
    if (data.place === 1) launchConfetti();
  }
});

socket.on('player:count', (data) => {
  document.getElementById('playerCount').style.display = '';
  document.getElementById('playerCountNum').textContent = data.count;
});

// ─── Helpers ──────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Confetti ─────────────────────────────────────────────────

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#0078D4', '#6CC24A', '#FFB800', '#00A1E0', '#E04355'];

  for (let i = 0; i < 80; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 10 + 5,
      h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2
    });
  }

  let frames = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotV;
      p.vy += 0.05;
    });
    frames++;
    if (frames < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}
