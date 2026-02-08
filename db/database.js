const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'quiz.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_PATH = path.join(__dirname, 'seed.sql');

let db;
let saveTimeout;

function getDb() {
  return db;
}

// Auto-save to disk after changes (debounced)
function persist() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }, 100);
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function runReturningId(sql, params = []) {
  db.run(sql, params);
  const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  persist();
  return { lastInsertRowid: id };
}

async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  persist();

  // Migration: add day column to responses if missing
  try {
    db.run("ALTER TABLE responses ADD COLUMN day INTEGER NOT NULL DEFAULT 1");
    persist();
  } catch (e) {
    // Column already exists — ignore
  }

  // Migration: add role column to admins if missing
  try {
    db.run("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
    persist();
  } catch (e) {
    // Column already exists — ignore
  }

  // Create default admin if none exists
  const admin = get('SELECT id FROM admins LIMIT 1');
  if (!admin) {
    const username = process.env.ADMIN_USER || 'admin@local';
    const password = process.env.ADMIN_PASS || 'admin123';
    const hash = bcrypt.hashSync(password, 10);
    const quizCode = generateQuizCode();

    run(
      'INSERT INTO admins (username, password_hash, quiz_code, quiz_name, role) VALUES (?, ?, ?, ?, ?)',
      [username, hash, quizCode, 'Zscaler Workshop Quiz', 'superadmin']
    );

    run(
      'INSERT INTO game_state (admin_id, status, language, answer_delay_seconds) VALUES (?, ?, ?, ?)',
      [1, 'idle', 'en', parseInt(process.env.ANSWER_DELAY_SECONDS) || 3]
    );

    console.log(`Superadmin created: ${username} / ${password}`);
    console.log(`Quiz code: ${quizCode}`);
    console.log(`Join URL: /join/${quizCode}`);
  } else {
    // Ensure at least one superadmin exists (migration from old DB)
    const superadmin = get("SELECT id FROM admins WHERE role = 'superadmin' LIMIT 1");
    if (!superadmin) {
      const firstAdmin = get('SELECT id FROM admins ORDER BY id ASC LIMIT 1');
      if (firstAdmin) {
        run("UPDATE admins SET role = 'superadmin' WHERE id = ?", [firstAdmin.id]);
        console.log(`Migrated admin id=${firstAdmin.id} to superadmin role`);
      }
    }
  }
}

function generateQuizCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── Admin helpers ──────────────────────────────────────────

function getAdminByUsername(username) {
  return get('SELECT * FROM admins WHERE username = ?', [username]);
}

function getAdminById(id) {
  return get('SELECT * FROM admins WHERE id = ?', [id]);
}

function updateAdminField(adminId, field, value) {
  run(`UPDATE admins SET ${field} = ? WHERE id = ?`, [value, adminId]);
}

function getAdminByQuizCode(code) {
  return get('SELECT * FROM admins WHERE quiz_code = ?', [code]);
}

// ─── Category helpers ───────────────────────────────────────

function getCategories(adminId) {
  return all('SELECT * FROM categories WHERE admin_id = ? ORDER BY sort_order', [adminId]);
}

function getCategoryById(id) {
  return get('SELECT * FROM categories WHERE id = ?', [id]);
}

function createCategory(adminId, name, timerSeconds = 15) {
  const row = get('SELECT COALESCE(MAX(sort_order), 0) as m FROM categories WHERE admin_id = ?', [adminId]);
  const maxOrder = row ? row.m : 0;
  return runReturningId(
    'INSERT INTO categories (admin_id, name, sort_order, timer_seconds) VALUES (?, ?, ?, ?)',
    [adminId, name, maxOrder + 1, timerSeconds]
  );
}

function updateCategory(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function deleteCategory(id) {
  run('DELETE FROM categories WHERE id = ?', [id]);
}

function getQuestionCountByCategory(categoryId) {
  const row = get('SELECT COUNT(*) as c FROM questions WHERE category_id = ?', [categoryId]);
  return row ? row.c : 0;
}

// ─── Question helpers ───────────────────────────────────────

function getQuestionsByCategory(categoryId) {
  return all('SELECT * FROM questions WHERE category_id = ? ORDER BY sort_order', [categoryId]);
}

function getQuestionsByAdmin(adminId) {
  return all(
    `SELECT q.*, c.name as category_name, c.unlocked as category_unlocked,
     (SELECT COUNT(*) FROM responses r WHERE r.question_id = q.id) as response_count
     FROM questions q
     JOIN categories c ON q.category_id = c.id
     WHERE q.admin_id = ?
     ORDER BY c.sort_order, q.sort_order`,
    [adminId]
  );
}

function getQuestionById(id) {
  return get('SELECT * FROM questions WHERE id = ?', [id]);
}

function getQuestionWithAnswers(id) {
  const q = getQuestionById(id);
  if (!q) return null;
  q.answers = all('SELECT * FROM answers WHERE question_id = ? ORDER BY sort_order', [id]);
  return q;
}

function createQuestion(categoryId, adminId, text) {
  const row = get('SELECT COALESCE(MAX(sort_order), 0) as m FROM questions WHERE category_id = ?', [categoryId]);
  const maxOrder = row ? row.m : 0;
  return runReturningId(
    'INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES (?, ?, ?, ?)',
    [categoryId, adminId, text, maxOrder + 1]
  );
}

function updateQuestion(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  run(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function deleteQuestion(id) {
  run('DELETE FROM questions WHERE id = ?', [id]);
}

// ─── Answer helpers ─────────────────────────────────────────

function getAnswersByQuestion(questionId) {
  return all('SELECT * FROM answers WHERE question_id = ? ORDER BY sort_order', [questionId]);
}

function createAnswer(questionId, text, isCorrect = 0) {
  const row = get('SELECT COALESCE(MAX(sort_order), 0) as m FROM answers WHERE question_id = ?', [questionId]);
  const maxOrder = row ? row.m : 0;
  return runReturningId(
    'INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
    [questionId, text, isCorrect ? 1 : 0, maxOrder + 1]
  );
}

function updateAnswer(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  run(`UPDATE answers SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function deleteAnswer(id) {
  run('DELETE FROM answers WHERE id = ?', [id]);
}

// ─── Player helpers ─────────────────────────────────────────

function getPlayerByToken(token) {
  return get('SELECT * FROM players WHERE cookie_token = ?', [token]);
}

function getPlayersByAdmin(adminId) {
  return all('SELECT * FROM players WHERE admin_id = ? ORDER BY total_score DESC', [adminId]);
}

function deletePlayer(playerId, adminId) {
  run('DELETE FROM players WHERE id = ? AND admin_id = ?', [playerId, adminId]);
}

function createPlayer(adminId, name, token) {
  return runReturningId(
    'INSERT INTO players (admin_id, name, cookie_token) VALUES (?, ?, ?)',
    [adminId, name, token]
  );
}

function updatePlayerScore(playerId) {
  const row = get(
    'SELECT COALESCE(SUM(points_earned), 0) as total FROM responses WHERE player_id = ?',
    [playerId]
  );
  const total = row ? row.total : 0;
  run('UPDATE players SET total_score = ? WHERE id = ?', [total, playerId]);
  return total;
}

// ─── Response helpers ───────────────────────────────────────

function saveResponse(playerId, questionId, answerId, isCorrect, responseTimeMs, points) {
  run(
    `INSERT OR IGNORE INTO responses (player_id, question_id, answer_id, is_correct, response_time_ms, points_earned)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [playerId, questionId, answerId, isCorrect ? 1 : 0, responseTimeMs, points]
  );
}

function hasPlayerAnswered(playerId, questionId) {
  return !!get('SELECT 1 as x FROM responses WHERE player_id = ? AND question_id = ?', [playerId, questionId]);
}

function getPlayerResponse(playerId, questionId) {
  return get(
    'SELECT is_correct, points_earned FROM responses WHERE player_id = ? AND question_id = ?',
    [playerId, questionId]
  );
}

function getResponseStats(questionId) {
  const totalRow = get('SELECT COUNT(*) as c FROM responses WHERE question_id = ?', [questionId]);
  const total = totalRow ? totalRow.c : 0;
  const byAnswer = all(
    `SELECT a.id, a.answer_text, a.is_correct, COUNT(r.id) as count
     FROM answers a
     LEFT JOIN responses r ON r.answer_id = a.id AND r.question_id = ?
     WHERE a.question_id = ?
     GROUP BY a.id
     ORDER BY a.sort_order`,
    [questionId, questionId]
  );
  return { total, byAnswer };
}

function getAnswerCount(questionId) {
  const row = get('SELECT COUNT(*) as c FROM responses WHERE question_id = ?', [questionId]);
  return row ? row.c : 0;
}

// ─── Game state helpers ─────────────────────────────────────

function getGameState(adminId) {
  return get('SELECT * FROM game_state WHERE admin_id = ?', [adminId]);
}

function updateGameState(adminId, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v === null ? null : v);
  }
  vals.push(adminId);
  run(`UPDATE game_state SET ${sets.join(', ')} WHERE admin_id = ?`, vals);
}

// ─── Leaderboard helpers ────────────────────────────────────

function getLeaderboard(adminId, limit = 50) {
  return all(
    `SELECT id, name, total_score FROM players
     WHERE admin_id = ?
     ORDER BY total_score DESC, name ASC
     LIMIT ?`,
    [adminId, limit]
  );
}

function getCategoryLeaderboard(adminId, categoryId, limit = 50) {
  return all(
    `SELECT p.id, p.name, COALESCE(SUM(CASE WHEN q.category_id = ? THEN r.points_earned ELSE 0 END), 0) as total_score
     FROM players p
     LEFT JOIN responses r ON r.player_id = p.id
     LEFT JOIN questions q ON r.question_id = q.id
     WHERE p.admin_id = ?
     GROUP BY p.id
     ORDER BY total_score DESC, p.name ASC
     LIMIT ?`,
    [categoryId, adminId, limit]
  );
}

function isCategoryFullyPlayed(categoryId) {
  const total = get('SELECT COUNT(*) as c FROM questions WHERE category_id = ?', [categoryId]);
  if (!total || total.c === 0) return false;
  const played = get(
    `SELECT COUNT(DISTINCT q.id) as c FROM questions q
     JOIN responses r ON r.question_id = q.id
     WHERE q.category_id = ?`,
    [categoryId]
  );
  return played && played.c >= total.c;
}

function getOverallLeaderboard(adminId, limit = 50) {
  return all(
    `SELECT p.id, p.name, COALESCE(SUM(r.points_earned), 0) as total_score
     FROM players p
     LEFT JOIN responses r ON r.player_id = p.id
     WHERE p.admin_id = ?
     GROUP BY p.id
     ORDER BY total_score DESC, p.name ASC
     LIMIT ?`,
    [adminId, limit]
  );
}

function getTop3(adminId) {
  return all(
    `SELECT id, name, total_score FROM players
     WHERE admin_id = ?
     ORDER BY total_score DESC
     LIMIT 3`,
    [adminId]
  );
}

function getPlayerNames(adminId) {
  return all('SELECT id, name FROM players WHERE admin_id = ? ORDER BY created_at DESC', [adminId]);
}

// ─── Stats / Export ─────────────────────────────────────────

function getFullResults(adminId) {
  return all(
    `SELECT p.name, q.question_text, a.answer_text, r.is_correct, r.points_earned, r.response_time_ms
     FROM responses r
     JOIN players p ON r.player_id = p.id
     JOIN questions q ON r.question_id = q.id
     JOIN answers a ON r.answer_id = a.id
     WHERE p.admin_id = ?
     ORDER BY p.name, q.id`,
    [adminId]
  );
}

function getPlayerCount(adminId) {
  const row = get('SELECT COUNT(*) as c FROM players WHERE admin_id = ?', [adminId]);
  return row ? row.c : 0;
}

function resetQuiz(adminId) {
  const newQuizCode = generateQuizCode();
  run('UPDATE admins SET quiz_code = ? WHERE id = ?', [newQuizCode, adminId]);
  run('DELETE FROM responses WHERE player_id IN (SELECT id FROM players WHERE admin_id = ?)', [adminId]);
  run('DELETE FROM players WHERE admin_id = ?', [adminId]);
  run('DELETE FROM categories WHERE admin_id = ?', [adminId]);

  updateGameState(adminId, {
    current_question_id: null,
    status: 'idle'
  });

  return { quiz_code: newQuizCode };
}

function seedExampleQuestions(adminId) {
  const seedData = [
    {
      name: 'Zero Trust for Users (ZIA/ZPA)', timer: 15, questions: [
        { text: 'What does ZPA stand for?', answers: [
          { text: 'Zscaler Private Access', correct: true },
          { text: 'Zero Protocol Architecture', correct: false },
          { text: 'Zscaler Public Analytics', correct: false },
          { text: 'Zone Protection Agent', correct: false }
        ]},
        { text: 'Which protocol does ZIA inspect to protect users from threats?', answers: [
          { text: 'SSL/TLS', correct: true },
          { text: 'FTP only', correct: false },
          { text: 'SMTP only', correct: false },
          { text: 'DNS only', correct: false }
        ]},
        { text: "What is the primary benefit of Zscaler's Zero Trust Exchange?", answers: [
          { text: 'Users connect directly to apps, not the network', correct: true },
          { text: 'Faster VPN connections', correct: false },
          { text: 'More firewall rules', correct: false },
          { text: 'Bigger network bandwidth', correct: false }
        ]}
      ]
    },
    {
      name: 'Digital Experience (ZDX)', timer: 15, questions: [
        { text: 'What does ZDX stand for?', answers: [
          { text: 'Zscaler Digital Experience', correct: true },
          { text: 'Zero Data Exchange', correct: false },
          { text: 'Zscaler DDoS eXterminator', correct: false },
          { text: 'Zone Defense eXpert', correct: false }
        ]},
        { text: 'What does ZDX primarily monitor?', answers: [
          { text: 'End-to-end user experience and application performance', correct: true },
          { text: 'Only server CPU usage', correct: false },
          { text: 'Only network bandwidth', correct: false },
          { text: 'Only DNS resolution times', correct: false }
        ]}
      ]
    },
    {
      name: 'Branch & IoT/OT', timer: 15, questions: [
        { text: 'What is the Zscaler solution for branch office connectivity?', answers: [
          { text: 'Branch Connector', correct: true },
          { text: 'Branch VPN Hub', correct: false },
          { text: 'SD-WAN Router', correct: false },
          { text: 'MPLS Gateway', correct: false }
        ]},
        { text: 'How does Zscaler protect IoT/OT devices?', answers: [
          { text: 'By isolating IoT traffic and applying zero trust policies', correct: true },
          { text: 'By installing agents on every IoT device', correct: false },
          { text: 'By using traditional firewalls only', correct: false },
          { text: 'IoT devices cannot be protected', correct: false }
        ]}
      ]
    },
    {
      name: 'Data Protection (DLP)', timer: 15, questions: [
        { text: 'What type of data can Zscaler DLP detect?', answers: [
          { text: 'PII, financial data, intellectual property, and custom patterns', correct: true },
          { text: 'Only credit card numbers', correct: false },
          { text: 'Only email addresses', correct: false },
          { text: 'Only file names', correct: false }
        ]},
        { text: 'Where does Zscaler DLP inspect data?', answers: [
          { text: 'Inline (in transit) and at rest (SaaS apps, endpoints)', correct: true },
          { text: 'Only on the endpoint', correct: false },
          { text: 'Only in the data center', correct: false },
          { text: 'Only in email', correct: false }
        ]}
      ]
    },
    {
      name: 'Workload Protection', timer: 15, questions: [
        { text: 'What does Zscaler Workload Communications protect?', answers: [
          { text: 'Cloud workload-to-workload and workload-to-internet traffic', correct: true },
          { text: 'Only virtual machines', correct: false },
          { text: 'Only containers', correct: false },
          { text: 'Only serverless functions', correct: false }
        ]}
      ]
    }
  ];

  for (const cat of seedData) {
    const catResult = createCategory(adminId, cat.name, cat.timer);
    const catId = catResult.lastInsertRowid;
    for (const q of cat.questions) {
      const qResult = createQuestion(catId, adminId, q.text);
      const qId = qResult.lastInsertRowid;
      for (const a of q.answers) {
        createAnswer(qId, a.text, a.correct ? 1 : 0);
      }
    }
  }
}

// ─── Admin management helpers ───────────────────────────────

function createAdmin(email, passwordHash) {
  const quizCode = generateQuizCode();
  const result = runReturningId(
    'INSERT INTO admins (username, password_hash, quiz_code, quiz_name, role) VALUES (?, ?, ?, ?, ?)',
    [email, passwordHash, quizCode, 'My Quiz', 'admin']
  );
  const adminId = result.lastInsertRowid;
  run(
    'INSERT INTO game_state (admin_id, status, language, answer_delay_seconds) VALUES (?, ?, ?, ?)',
    [adminId, 'idle', 'en', 3]
  );
  return { id: adminId, quiz_code: quizCode };
}

function getAllAdmins() {
  return all("SELECT id, username, role, quiz_code, quiz_name FROM admins ORDER BY id");
}

function deleteAdmin(adminId) {
  run('DELETE FROM admins WHERE id = ?', [adminId]);
}

function updateAdminPassword(adminId, newHash) {
  run('UPDATE admins SET password_hash = ? WHERE id = ?', [newHash, adminId]);
}

module.exports = {
  init,
  getDb,
  getAdminByUsername,
  getAdminById,
  updateAdminField,
  getAdminByQuizCode,
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getQuestionCountByCategory,
  getQuestionsByCategory,
  getQuestionsByAdmin,
  getQuestionById,
  getQuestionWithAnswers,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getAnswersByQuestion,
  createAnswer,
  updateAnswer,
  deleteAnswer,
  getPlayerByToken,
  getPlayersByAdmin,
  getPlayerNames,
  deletePlayer,
  createPlayer,
  updatePlayerScore,
  saveResponse,
  hasPlayerAnswered,
  getPlayerResponse,
  getResponseStats,
  getAnswerCount,
  getGameState,
  updateGameState,
  getLeaderboard,
  getCategoryLeaderboard,
  isCategoryFullyPlayed,
  getOverallLeaderboard,
  getTop3,
  getFullResults,
  getPlayerCount,
  resetQuiz,
  seedExampleQuestions,
  generateQuizCode,
  createAdmin,
  getAllAdmins,
  deleteAdmin,
  updateAdminPassword
};
