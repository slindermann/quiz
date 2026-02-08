// ─── Admin Client Logic ───────────────────────────────────────

const socket = io();
let authHeader = '';
let adminData = null;
let gameState = null;
let selectedCategoryId = null;
let categories = [];
let questions = [];

// ─── Auth ─────────────────────────────────────────────────────

function setAuth(user, pass) {
  authHeader = 'Basic ' + btoa(user + ':' + pass);
  localStorage.setItem('zquiz_auth', authHeader);
}

function getAuth() {
  return authHeader || localStorage.getItem('zquiz_auth') || '';
}

async function api(path, opts = {}) {
  const res = await fetch('/admin/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuth(),
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) {
    localStorage.removeItem('zquiz_auth');
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    throw new Error('Unauthorized');
  }
  return res.json();
}

async function apiRaw(path, opts = {}) {
  return fetch('/admin/api' + path, {
    ...opts,
    headers: {
      'Authorization': getAuth(),
      ...(opts.headers || {})
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────

(async function init() {
  // Login
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Try saved auth
  if (getAuth()) {
    try {
      await loadAdmin();
      document.getElementById('loginOverlay').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
    } catch (e) {
      // Show login
    }
  }

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Game control buttons
  document.getElementById('btnShowLeaderboard').addEventListener('click', () => api('/show-leaderboard', { method: 'POST', body: { overall: true } }));
  document.getElementById('btnGoIdle').addEventListener('click', () => api('/go-idle', { method: 'POST' }));
  document.getElementById('btnStartFinale').addEventListener('click', startFinale);
  document.getElementById('btnResetQuiz').addEventListener('click', resetQuiz);
  document.getElementById('btnCloseQuestion').addEventListener('click', () => api('/close-question', { method: 'POST' }));
  document.getElementById('btnSeedExamples').addEventListener('click', seedExamples);

  // Finale reveals
  document.getElementById('btnReveal3').addEventListener('click', () => revealPlace(3));
  document.getElementById('btnReveal2').addEventListener('click', () => revealPlace(2));
  document.getElementById('btnReveal1').addEventListener('click', () => revealPlace(1));

  // Content buttons
  document.getElementById('btnAddCategory').addEventListener('click', showAddCategoryModal);
  document.getElementById('btnAddQuestion').addEventListener('click', showAddQuestionModal);

  // Settings
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnUploadLogo').addEventListener('click', uploadLogo);
  document.getElementById('btnDeleteLogo').addEventListener('click', deleteLogo);
  document.getElementById('btnExport').addEventListener('click', exportCSV);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importFile);
  document.getElementById('btnImportCSV').addEventListener('click', () => document.getElementById('importCSVFile').click());
  document.getElementById('importCSVFile').addEventListener('change', importCSV);
  document.getElementById('btnDownloadTemplateCSV').addEventListener('click', downloadTemplateCSV);
  document.getElementById('btnDownloadTemplateJSON').addEventListener('click', downloadTemplateJSON);
  document.getElementById('btnOpenPresenter').addEventListener('click', openPresenter);

  // QR
  document.getElementById('btnGenQR').addEventListener('click', generateQR);
})();

async function doLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  setAuth(user, pass);
  try {
    await loadAdmin();
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
  } catch (e) {
    document.getElementById('loginError').textContent = 'Invalid credentials';
  }
}

async function loadAdmin() {
  const data = await api('/me');
  adminData = data.admin;
  gameState = data.state;

  document.getElementById('adminQuizName').textContent = `${adminData.quiz_name} (${adminData.quiz_code})`;
  document.getElementById('adminStatus').textContent = gameState.status;

  if (gameState.language) setLanguage(gameState.language);

  // Settings
  document.getElementById('settingQuizName').value = adminData.quiz_name;
  document.getElementById('settingLanguage').value = gameState.language || 'en';
  document.getElementById('settingDelay').value = gameState.answer_delay_seconds || 3;

  // Socket
  socket.emit('admin:join', { quiz_code: adminData.quiz_code });

  loadLogoPreview();
  await loadCategories();
  await loadQuestions();
  updateGameUI();
}

function loadLogoPreview() {
  const img = new Image();
  img.onload = () => {
    document.getElementById('logoPreviewImg').src = img.src;
    document.getElementById('logoPreview').style.display = '';
  };
  img.src = '/uploads/logo.png?' + Date.now();
}

// ─── Data loading ─────────────────────────────────────────────

async function loadCategories() {
  categories = await api('/categories');
  renderGameCategories();
  renderContentCategories();
}

async function loadQuestions() {
  questions = await api('/questions');
  renderQuestions();
  // Show seed examples box only when no questions exist
  const box = document.getElementById('seedExamplesBox');
  if (box) box.classList.toggle('hidden', questions.length > 0);
}

// ─── Game Control UI ──────────────────────────────────────────

function updateGameUI() {
  const status = gameState ? gameState.status : 'idle';
  document.getElementById('adminStatus').textContent = status;
  document.getElementById('btnCloseQuestion').classList.toggle('hidden', status !== 'answers_visible' && status !== 'question_active');
  document.getElementById('finaleControl').classList.toggle('hidden', status !== 'finale');
}

function renderGameCategories() {
  const container = document.getElementById('gameCategoryList');
  container.innerHTML = '';

  categories.forEach(cat => {
    const catQuestions = questions.filter(q => q.category_id === cat.id);
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(cat.name)}</div>
        <div class="list-item-subtitle">${cat.question_count || catQuestions.length} questions | ${cat.timer_seconds}s timer | ${cat.unlocked ? '&#128275; Unlocked' : '&#128274; Locked'}</div>
      </div>
      <div class="list-item-actions">
        <button class="btn btn-outline btn-sm" onclick="showCategoryLeaderboard(${cat.id})" title="Zeigt das Leaderboard dieser Kategorie">&#127942;</button>
        <button class="btn btn-sm ${cat.unlocked ? 'btn-gray' : 'btn-success'}" onclick="toggleCategory(${cat.id}, ${cat.unlocked})">${cat.unlocked ? 'Lock' : 'Unlock'}</button>
      </div>`;
    container.appendChild(div);

    // Show questions for this category
    if (cat.unlocked) {
      catQuestions.forEach(q => {
        const played = q.response_count > 0;
        const qDiv = document.createElement('div');
        qDiv.className = 'list-item';
        qDiv.style.marginLeft = '20px';
        qDiv.style.borderLeft = played ? '3px solid var(--zs-green)' : '3px solid var(--zs-blue)';
        if (played) qDiv.style.opacity = '0.6';
        qDiv.innerHTML = `
          <div class="list-item-content">
            <div class="list-item-title">${played ? '&#10003; ' : ''}${escapeHtml(q.question_text)}</div>
            <div class="list-item-subtitle">${q.answers ? q.answers.length : 0} answers${played ? ' | &#10003; played (' + q.response_count + ' responses)' : ''}</div>
          </div>
          <div class="list-item-actions">
            <button class="btn ${played ? 'btn-gray' : 'btn-primary'} btn-sm" onclick="startQuestion(${q.id})">${played ? 'Replay' : 'Start'}</button>
          </div>`;
        container.appendChild(qDiv);
      });
    }
  });
}

// ─── Content Management UI ────────────────────────────────────

function renderContentCategories() {
  const container = document.getElementById('categoryList');
  container.innerHTML = '';

  categories.forEach(cat => {
    const div = document.createElement('div');
    div.className = `list-item ${cat.id === selectedCategoryId ? 'selected' : ''}`;
    div.style.cursor = 'pointer';
    if (cat.id === selectedCategoryId) {
      div.style.borderColor = 'var(--zs-blue)';
      div.style.background = '#f0f7ff';
    }
    div.innerHTML = `
      <div class="list-item-content" onclick="selectCategory(${cat.id})">
        <div class="list-item-title">${escapeHtml(cat.name)}</div>
        <div class="list-item-subtitle">${cat.question_count || 0} questions | ${cat.timer_seconds}s</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn" onclick="editCategory(${cat.id})" title="Edit">&#9998;</button>
        <button class="icon-btn danger" onclick="deleteCategory(${cat.id})" title="Delete">&#128465;</button>
      </div>`;
    container.appendChild(div);
  });
}

function renderQuestions() {
  const container = document.getElementById('questionList');
  if (!selectedCategoryId) {
    container.innerHTML = '<p class="text-muted text-sm">Select a category</p>';
    return;
  }
  const catQuestions = questions.filter(q => q.category_id === selectedCategoryId);
  container.innerHTML = '';

  if (catQuestions.length === 0) {
    container.innerHTML = '<p class="text-muted text-sm">No questions in this category</p>';
    return;
  }

  catQuestions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(q.question_text)}</div>
        <div class="list-item-subtitle">${(q.answers || []).length} answers</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn" onclick="editQuestion(${q.id})" title="Edit">&#9998;</button>
        <button class="icon-btn danger" onclick="deleteQuestion(${q.id})" title="Delete">&#128465;</button>
      </div>`;
    container.appendChild(div);
  });

  // Also update game view
  renderGameCategories();
}

// ─── Actions ──────────────────────────────────────────────────

window.selectCategory = function(id) {
  selectedCategoryId = id;
  renderContentCategories();
  renderQuestions();
};

window.showCategoryLeaderboard = async function(catId) {
  await api('/show-leaderboard', { method: 'POST', body: { categoryId: catId } });
};

window.toggleCategory = async function(id, current) {
  await api(`/categories/${id}/${current ? 'lock' : 'unlock'}`, { method: 'PUT' });
  await loadCategories();
  renderGameCategories();
};

window.startQuestion = async function(id) {
  const q = questions.find(q => q.id === id);
  await api(`/start-question/${id}`, { method: 'POST' });
  document.getElementById('liveQuestion').textContent = q ? q.question_text : 'Question active...';
  document.getElementById('liveQuestion').style.color = 'var(--zs-navy)';
  document.getElementById('liveQuestion').style.fontWeight = '600';
  document.getElementById('liveAnswerCount').textContent = '0 answers';
  document.getElementById('btnCloseQuestion').classList.remove('hidden');
  gameState.status = 'question_active';
  updateGameUI();
};

async function startFinale() {
  await api('/start-finale', { method: 'POST' });
  document.getElementById('finaleControl').classList.remove('hidden');
}

async function revealPlace(place) {
  await api('/reveal-next', { method: 'POST', body: { place } });
}

async function resetQuiz() {
  if (!confirm('Neues Quiz starten? Generiert einen neuen Quiz-Code und loescht alle Spieler, Fragen, Kategorien und das Logo.')) return;
  const data = await api('/reset-quiz', { method: 'POST' });
  if (data.quiz_code) {
    adminData.quiz_code = data.quiz_code;
    document.getElementById('adminQuizName').textContent = `${adminData.quiz_name} (${data.quiz_code})`;
    socket.emit('admin:join', { quiz_code: data.quiz_code });
    // Refresh QR code if it was generated
    const qrContainer = document.getElementById('qrContainer');
    if (qrContainer.querySelector('img')) generateQR();
  }
  await loadCategories();
  await loadQuestions();
  renderGameCategories();
  // Hide logo preview (logo was deleted)
  document.getElementById('logoPreview').style.display = 'none';
}

async function seedExamples() {
  await api('/seed-examples', { method: 'POST' });
  await loadCategories();
  await loadQuestions();
  renderGameCategories();
  document.getElementById('seedExamplesBox').classList.add('hidden');
}

// ─── Category CRUD ────────────────────────────────────────────

function showAddCategoryModal() {
  showModal('Add Category', `
    <div class="form-group">
      <label data-i18n="categoryName">Category Name</label>
      <input type="text" id="modalCatName" class="form-control" placeholder="Category name">
    </div>
    <div class="form-group">
      <label data-i18n="timerSeconds">Timer (seconds)</label>
      <input type="number" id="modalCatTimer" class="form-control" value="15" min="5" max="120">
    </div>
  `, async () => {
    const name = document.getElementById('modalCatName').value.trim();
    if (!name) return;
    await api('/categories', { method: 'POST', body: { name, timer_seconds: parseInt(document.getElementById('modalCatTimer').value) || 15 } });
    hideModal();
    await loadCategories();
  });
}

window.editCategory = function(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  showModal('Edit Category', `
    <div class="form-group">
      <label data-i18n="categoryName">Category Name</label>
      <input type="text" id="modalCatName" class="form-control" value="${escapeHtml(cat.name)}">
    </div>
    <div class="form-group">
      <label data-i18n="timerSeconds">Timer (seconds)</label>
      <input type="number" id="modalCatTimer" class="form-control" value="${cat.timer_seconds}" min="5" max="120">
    </div>
  `, async () => {
    const name = document.getElementById('modalCatName').value.trim();
    if (!name) return;
    await api(`/categories/${id}`, { method: 'PUT', body: { name, timer_seconds: parseInt(document.getElementById('modalCatTimer').value) || 15 } });
    hideModal();
    await loadCategories();
  });
};

window.deleteCategory = async function(id) {
  if (!confirm(t('confirmDelete'))) return;
  await api(`/categories/${id}`, { method: 'DELETE' });
  if (selectedCategoryId === id) selectedCategoryId = null;
  await loadCategories();
  await loadQuestions();
};

// ─── Question CRUD ────────────────────────────────────────────

function showAddQuestionModal() {
  if (!selectedCategoryId) {
    alert('Please select a category first');
    return;
  }
  showModal('Add Question', `
    <div class="form-group">
      <label data-i18n="questionText">Question Text</label>
      <textarea id="modalQText" class="form-control" rows="3" placeholder="Question text"></textarea>
    </div>
    <h4 class="mb-1">Answers</h4>
    <div id="modalAnswers">
      <div class="form-group flex gap-1">
        <input type="text" class="form-control modal-answer-text" placeholder="Answer A">
        <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct"> Correct</label>
      </div>
      <div class="form-group flex gap-1">
        <input type="text" class="form-control modal-answer-text" placeholder="Answer B">
        <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct"> Correct</label>
      </div>
      <div class="form-group flex gap-1">
        <input type="text" class="form-control modal-answer-text" placeholder="Answer C">
        <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct"> Correct</label>
      </div>
      <div class="form-group flex gap-1">
        <input type="text" class="form-control modal-answer-text" placeholder="Answer D">
        <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct"> Correct</label>
      </div>
    </div>
  `, async () => {
    const text = document.getElementById('modalQText').value.trim();
    if (!text) return;
    const answerTexts = document.querySelectorAll('.modal-answer-text');
    const answerCorrects = document.querySelectorAll('.modal-answer-correct');
    const answers = [];
    answerTexts.forEach((el, i) => {
      if (el.value.trim()) {
        answers.push({ answer_text: el.value.trim(), is_correct: answerCorrects[i].checked ? 1 : 0 });
      }
    });
    await api('/questions', { method: 'POST', body: { category_id: selectedCategoryId, question_text: text, answers } });
    hideModal();
    await loadQuestions();
  });
}

window.editQuestion = async function(id) {
  const data = await api(`/questions/${id}`);
  showModal('Edit Question', `
    <div class="form-group">
      <label data-i18n="questionText">Question Text</label>
      <textarea id="modalQText" class="form-control" rows="3">${escapeHtml(data.question_text)}</textarea>
    </div>
    <h4 class="mb-1">Answers</h4>
    <div id="modalAnswers">
      ${(data.answers || []).map((a, i) => `
        <div class="form-group flex gap-1" data-answer-id="${a.id}">
          <input type="text" class="form-control modal-answer-text" value="${escapeHtml(a.answer_text)}">
          <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct" ${a.is_correct ? 'checked' : ''}> Correct</label>
          <button class="icon-btn danger" onclick="this.parentElement.remove()">&#128465;</button>
        </div>
      `).join('')}
      <button class="btn btn-outline btn-sm" onclick="addAnswerField()">+ Answer</button>
    </div>
  `, async () => {
    const text = document.getElementById('modalQText').value.trim();
    if (!text) return;
    await api(`/questions/${id}`, { method: 'PUT', body: { question_text: text } });

    // Delete old answers and recreate
    for (const a of data.answers) {
      await api(`/answers/${a.id}`, { method: 'DELETE' });
    }
    const answerTexts = document.querySelectorAll('.modal-answer-text');
    const answerCorrects = document.querySelectorAll('.modal-answer-correct');
    for (let i = 0; i < answerTexts.length; i++) {
      if (answerTexts[i].value.trim()) {
        await api('/answers', { method: 'POST', body: {
          question_id: id,
          answer_text: answerTexts[i].value.trim(),
          is_correct: answerCorrects[i].checked ? 1 : 0
        }});
      }
    }
    hideModal();
    await loadQuestions();
  });
};

window.addAnswerField = function() {
  const container = document.getElementById('modalAnswers');
  const div = document.createElement('div');
  div.className = 'form-group flex gap-1';
  div.innerHTML = `
    <input type="text" class="form-control modal-answer-text" placeholder="New answer">
    <label class="checkbox-label"><input type="checkbox" class="modal-answer-correct"> Correct</label>
    <button class="icon-btn danger" onclick="this.parentElement.remove()">&#128465;</button>
  `;
  container.insertBefore(div, container.lastElementChild);
};

window.deleteQuestion = async function(id) {
  if (!confirm(t('confirmDelete'))) return;
  await api(`/questions/${id}`, { method: 'DELETE' });
  await loadQuestions();
};

// ─── Settings ─────────────────────────────────────────────────

async function saveSettings() {
  await api('/settings', { method: 'PUT', body: {
    quiz_name: document.getElementById('settingQuizName').value,
    language: document.getElementById('settingLanguage').value,
    answer_delay_seconds: parseInt(document.getElementById('settingDelay').value) || 3
  }});
  setLanguage(document.getElementById('settingLanguage').value);
  document.getElementById('adminQuizName').textContent = document.getElementById('settingQuizName').value + ` (${adminData.quiz_code})`;
}

async function uploadLogo() {
  const file = document.getElementById('logoFile').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('logo', file);
  await apiRaw('/upload-logo', { method: 'POST', body: form });
  loadLogoPreview();
  alert('Logo uploaded!');
}

async function deleteLogo() {
  await api('/delete-logo', { method: 'DELETE' });
  document.getElementById('logoPreview').style.display = 'none';
}

async function exportCSV() {
  const res = await apiRaw('/export');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quiz-results.csv';
  a.click();
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    await api('/import', { method: 'POST', body: data });
    await loadCategories();
    await loadQuestions();
    alert('Import successful!');
  } catch (err) {
    alert('Import error: ' + err.message);
  }
  e.target.value = '';
}

async function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await apiRaw('/import-csv', { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) { alert('Import error: ' + data.error); return; }
    await loadCategories();
    await loadQuestions();
    alert(`CSV import successful! ${data.imported} questions imported.`);
  } catch (err) {
    alert('Import error: ' + err.message);
  }
  e.target.value = '';
}

async function downloadTemplateCSV() {
  const res = await apiRaw('/import-template-csv');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quiz-import-template.csv';
  a.click();
}

async function downloadTemplateJSON() {
  const res = await apiRaw('/import-template-json');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quiz-import-template.json';
  a.click();
}

window.copyUrl = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = event.target;
    const orig = btn.innerHTML;
    btn.innerHTML = '&#10003;';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  });
};

function openPresenter() {
  window.open(`/presenter.html?quiz=${adminData.quiz_code}`, '_blank');
}

async function generateQR() {
  const data = await api('/qrcode');
  const container = document.getElementById('qrContainer');
  container.innerHTML = `
    <img src="${data.qr}" alt="QR Code">
    <div class="qr-url">${escapeHtml(data.url)} <button class="icon-btn" onclick="copyUrl('${escapeHtml(data.url)}')" title="Copy URL">&#128203;</button></div>
    <button class="btn btn-outline btn-sm mt-1" onclick="generateQR()">Refresh</button>
  `;
}

// ─── Modal helpers ────────────────────────────────────────────

function showModal(title, body, onSave) {
  const container = document.getElementById('modalContainer');
  container.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)hideModal()">
      <div class="modal slide-in">
        <h3>${title}</h3>
        ${body}
        <div class="modal-footer">
          <button class="btn btn-outline btn-sm" onclick="hideModal()" data-i18n="cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="modalSaveBtn" data-i18n="save">Save</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modalSaveBtn').addEventListener('click', onSave);
}

window.hideModal = function() {
  document.getElementById('modalContainer').innerHTML = '';
};

// ─── Socket events ────────────────────────────────────────────

socket.on('game:state', (data) => {
  if (gameState) Object.assign(gameState, data);
  else gameState = data;
  updateGameUI();
  document.getElementById('adminStatus').textContent = data.status;
});

socket.on('player:count', (data) => {
  document.getElementById('adminPlayerNum').textContent = data.count;
});

socket.on('player:joined', (data) => {
  document.getElementById('adminPlayerNum').textContent = data.count;
});

socket.on('question:answer-count', (data) => {
  document.getElementById('liveAnswerCount').textContent = `${data.count} answers`;
});

socket.on('question:tick', (data) => {
  const el = document.getElementById('liveAnswerCount');
  const existing = el.textContent.split('|')[0].trim();
  el.textContent = `${existing} | ${data.remaining}s remaining`;
});

socket.on('question:closed', async (data) => {
  document.getElementById('liveQuestion').textContent = 'Question closed';
  document.getElementById('liveQuestion').style.color = '';
  document.getElementById('liveQuestion').style.fontWeight = '';
  document.getElementById('btnCloseQuestion').classList.add('hidden');
  gameState.status = 'question_closed';
  updateGameUI();
  await loadQuestions(); // Refresh for updated stats & played status
  renderGameCategories();
});

// ─── Helpers ──────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
