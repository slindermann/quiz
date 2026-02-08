const crypto = require('crypto');

const sessions = new Map();
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { adminId, createdAt: Date.now() });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function deleteSession(token) {
  sessions.delete(token);
}

module.exports = { createSession, getSession, deleteSession, SESSION_MAX_AGE };
