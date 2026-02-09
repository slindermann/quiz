// ─── Presenter Client Logic ───────────────────────────────────

const socket = io();
let quizCode = null;
let currentQuestionText = '';

// ─── Init ─────────────────────────────────────────────────────

(function init() {
  const params = new URLSearchParams(window.location.search);
  quizCode = params.get('quiz');

  if (!quizCode) {
    document.querySelector('.presenter-content').innerHTML =
      '<div class="presenter-waiting"><h2>No quiz code</h2><p>Add ?quiz=CODE to the URL</p></div>';
    return;
  }

  // Load quiz info
  fetch(`/api/quiz-info?code=${quizCode}`)
    .then(r => r.json())
    .then(data => {
      if (data.quiz_name) {
        document.getElementById('presQuizName').textContent = data.quiz_name;
        quizCode = data.quiz_code;
      }
    });

  // Logo
  const logo = document.getElementById('presLogo');
  const img = new Image();
  img.onload = () => { logo.src = img.src; logo.classList.remove('hidden'); };
  img.src = `/api/logo/${quizCode}`;

  // Connect socket
  socket.emit('quiz:join', { quiz_code: quizCode });

  // Get current state
  fetch(`/api/state?quiz_code=${quizCode}`)
    .then(r => r.json())
    .then(handleState);
})();

function handleState(state) {
  if (state.language) setLanguage(state.language);
  updatePlayerCount(state.playerCount);

  switch (state.status) {
    case 'idle': showWaiting(); break;
    case 'question_active':
      if (state.question) showQuestion(state.question.question_text);
      break;
    case 'answers_visible':
      if (state.question) {
        showQuestion(state.question.question_text);
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

// ─── UI states ────────────────────────────────────────────────

function hideAll() {
  ['presWaiting', 'presQuestion', 'presAnswers', 'presClosed', 'presLeaderboard', 'presFinale'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

function showWaiting() {
  hideAll();
  document.getElementById('presWaiting').classList.remove('hidden');
  loadPlayerNames();
  loadQRCode();
}

function showQuestion(text) {
  hideAll();
  currentQuestionText = text;
  document.getElementById('presQuestion').classList.remove('hidden');
  document.getElementById('presQuestionText').textContent = text;
}

function showAnswers(answers, timerSeconds) {
  hideAll();
  document.getElementById('presAnswers').classList.remove('hidden');
  document.getElementById('presQuestionText2').textContent = currentQuestionText;
  document.getElementById('presTimer').textContent = timerSeconds || '--';
  document.getElementById('presTimerBar').style.width = '100%';
  document.getElementById('presAnswerCount').textContent = '0';

  const grid = document.getElementById('presAnswersGrid');
  grid.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  answers.forEach((a, i) => {
    const div = document.createElement('div');
    div.className = 'presenter-answer';
    div.id = `presAns${a.id}`;
    div.innerHTML = `<span class="answer-letter" style="margin-right:12px;background:rgba(255,255,255,0.2)">${letters[i]}</span> ${escapeHtml(a.answer_text)}`;
    grid.appendChild(div);
  });
}

function showClosed(data) {
  hideAll();
  document.getElementById('presClosed').classList.remove('hidden');
  document.getElementById('presClosedQuestion').textContent = currentQuestionText;

  const grid = document.getElementById('presClosedAnswers');
  grid.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  const answers = data.answers || (data.stats && data.stats.byAnswer) || [];
  const correctId = data.correctAnswerId;

  answers.forEach((a, i) => {
    const isCorrect = a.is_correct || a.id === correctId;
    const div = document.createElement('div');
    div.className = `presenter-answer ${isCorrect ? 'correct' : 'wrong'}`;
    div.innerHTML = `<span class="answer-letter" style="margin-right:12px;background:rgba(255,255,255,0.2)">${letters[i]}</span> ${escapeHtml(a.answer_text)}`;
    if (a.count !== undefined) {
      div.innerHTML += `<span style="margin-left:auto;font-weight:700">${a.count}</span>`;
    }
    grid.appendChild(div);
  });

  // Stats bars
  if (data.stats) {
    const statsDiv = document.getElementById('presClosedStats');
    statsDiv.innerHTML = '';
    const total = data.stats.total || 1;
    data.stats.byAnswer.forEach(a => {
      const pct = Math.round((a.count / total) * 100) || 0;
      statsDiv.innerHTML += `
        <div class="stat-bar">
          <div class="stat-bar-label">${escapeHtml(a.answer_text)}</div>
          <div class="stat-bar-track">
            <div class="stat-bar-fill ${a.is_correct ? 'correct' : 'wrong'}" style="width:${pct}%"></div>
            <span class="stat-bar-value">${pct}%</span>
          </div>
        </div>`;
    });
  }
}

function showLeaderboard(leaderboard, overall, categoryName) {
  hideAll();
  document.getElementById('presLeaderboard').classList.remove('hidden');
  const title = document.getElementById('presLeaderboardTitle');
  if (title) title.textContent = overall ? 'Overall Leaderboard' : (categoryName ? categoryName + ' Leaderboard' : 'Leaderboard');
  const list = document.getElementById('presLeaderboardList');
  list.innerHTML = '';

  leaderboard.slice(0, 10).forEach((p, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    list.innerHTML += `
      <div class="leaderboard-item slide-in" style="animation-delay:${i * 0.1}s">
        <div class="leaderboard-rank ${rankClass}">${i + 1}</div>
        <div class="leaderboard-name">${escapeHtml(p.name)}</div>
        <div class="leaderboard-score">${p.total_score}</div>
      </div>`;
  });
}

function showFinale() {
  hideAll();
  document.getElementById('presFinale').classList.remove('hidden');
  document.querySelectorAll('#presPodium .podium-place').forEach(p => p.classList.remove('revealed'));
}

function updatePlayerCount(count) {
  if (count === undefined) return;
  document.getElementById('presPlayerNum').textContent = count;
  document.getElementById('presWaitPlayerNum').textContent = count;
}

// ─── Player names + QR ───────────────────────────────────────

function loadPlayerNames() {
  fetch(`/api/player-names?quiz_code=${quizCode}`)
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('presPlayerNames');
      if (!container) return;
      container.innerHTML = '';
      if (data.players) {
        data.players.forEach(p => addPlayerChip(p.name));
      }
    })
    .catch(() => {});
}

function addPlayerChip(name) {
  const container = document.getElementById('presPlayerNames');
  if (!container) return;
  // Avoid duplicates
  const existing = container.querySelectorAll('.player-chip');
  for (const chip of existing) {
    if (chip.textContent === name) return;
  }
  const chip = document.createElement('span');
  chip.className = 'player-chip';
  chip.textContent = name;
  container.appendChild(chip);
}

function loadQRCode() {
  const container = document.getElementById('presQRCode');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center"><p style="opacity:0.7;margin-bottom:8px">Loading QR...</p></div>`;

  fetch(`/api/qr?quiz_code=${quizCode}`)
    .then(r => r.json())
    .then(data => {
      if (data.qr) {
        container.innerHTML = '';
        container.style.textAlign = 'center';
        const img = document.createElement('img');
        img.src = data.qr;
        img.style.cssText = 'max-width:200px;border-radius:12px;background:white;padding:8px';
        container.appendChild(img);
        const urlDiv = document.createElement('div');
        urlDiv.style.cssText = 'text-align:center;margin-top:8px;font-size:0.9rem;opacity:0.7;word-break:break-all';
        urlDiv.textContent = data.url;
        container.appendChild(urlDiv);
      }
    })
    .catch(() => {
      container.innerHTML = `<div style="text-align:center;opacity:0.5">QR code unavailable</div>`;
    });
}

// ─── Socket events ────────────────────────────────────────────

socket.on('game:state', (data) => {
  if (data.status === 'idle') showWaiting();
  if (data.status === 'finale') showFinale();
  if (data.language) setLanguage(data.language);
});

socket.on('question:show', (data) => {
  showQuestion(data.questionText);
});

socket.on('question:answers-visible', (data) => {
  showAnswers(data.answers, data.timerSeconds);
});

socket.on('question:tick', (data) => {
  const timer = document.getElementById('presTimer');
  const bar = document.getElementById('presTimerBar');
  timer.textContent = data.remaining;
  bar.style.width = ((data.remaining / data.total) * 100) + '%';

  timer.className = 'presenter-timer';
  bar.className = 'timer-bar-fill';
  if (data.remaining <= 5) {
    timer.classList.add('danger');
    bar.classList.add('danger');
  } else if (data.remaining <= 10) {
    timer.classList.add('warning');
    bar.classList.add('warning');
  }
});

socket.on('question:answer-count', (data) => {
  document.getElementById('presAnswerCount').textContent = data.count;
});

socket.on('question:closed', (data) => {
  showClosed(data);
});

socket.on('leaderboard:show', (data) => {
  showLeaderboard(data.leaderboard, data.overall, data.categoryName);
});

socket.on('finale:start', () => {
  showFinale();
});

socket.on('finale:reveal', (data) => {
  const el = document.getElementById(`presPodium${data.place}`);
  if (el) {
    document.getElementById(`presPodium${data.place}Name`).textContent = data.player.name;
    document.getElementById(`presPodium${data.place}Score`).textContent = data.player.total_score + ' pts';
    setTimeout(() => el.classList.add('revealed'), 100);
    if (data.place === 1) launchConfetti();
  }
});

socket.on('player:count', (data) => {
  updatePlayerCount(data.count);
});

socket.on('player:joined', (data) => {
  updatePlayerCount(data.count);
  if (data.name) addPlayerChip(data.name);
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
  const colors = ['#0078D4', '#6CC24A', '#FFB800', '#00A1E0', '#E04355', '#FFFFFF'];

  for (let i = 0; i < 150; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 12 + 6,
      h: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.3
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
    if (frames < 180) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}
