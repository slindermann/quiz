# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install
node server.js              # Start server on :3000
npm run dev                  # Start with --watch (auto-restart on file changes)
lsof -ti :3000 | xargs kill -9 && node server.js  # Kill stuck server + restart
```

- Admin UI: http://localhost:3000/admin.html
- Default credentials: `admin` / auto-generated password (printed to console on first run)
- Override with `ADMIN_USER` + `ADMIN_PASS` in `.env`
- No test framework or linter configured

## Deployment

Dockerized, runs in an LXC container on Proxmox behind a Caddy reverse proxy.

```bash
docker compose up -d              # Start
docker compose up -d --build      # Rebuild after code changes
docker compose logs               # View logs
```

- Production URL: https://quiz.local-area.network
- Git repo: https://github.com/slindermann/quiz
- Deploy: `cd /opt/quiz && git pull && docker compose up -d --build`
- DB + uploads persisted via Docker volumes in `./data/`

## Architecture

Live quiz app (Kahoot-style) for workshops. Node.js + Express + Socket.IO + SQLite (sql.js).

**Multi-admin/multi-quiz**: Each admin gets a 6-char `quiz_code`. Players join via `/join/CODE`. Socket.IO rooms = quiz_code.

### Key Files

- **server.js** — Entry point, async start (sql.js requires async init)
- **db/database.js** — All DB helpers (`get`/`all`/`run`/`runReturningId`), sql.js wrapper with debounced disk persistence
- **db/schema.sql** — Table definitions with CASCADE foreign keys
- **sessions.js** — In-memory session Map (crypto tokens, 24h expiry, lost on restart)
- **mail.js** — Nodemailer wrapper for SMTP (verification codes, temp passwords)
- **routes/admin.js** — Admin REST API + game control (timer management via `global.activeTimers[adminId]`)
- **routes/api.js** — Public player API (join, state, quiz-info, favicon, logo with superadmin fallback)
- **routes/register.js** — Self-registration API (request-code, verify)
- **sockets/index.js** — Real-time events (answer submit, room management)
- **public/js/admin.js** — Admin dashboard client (session-based auth, no localStorage)
- **public/js/player.js** — Player client
- **public/js/presenter.js** — Beamer/projector view
- **public/js/register.js** — Registration page client (email → code → success)
- **public/js/i18n.js** — EN/DE translations (`data-i18n` attributes + `t()` function)

### Game State Machine

```
idle → question_active → answers_visible → question_closed → [showing_leaderboard] → idle/finale
```

- Timer management: `global.activeTimers[adminId]` stores setInterval refs
- Leaderboard context: `global.activeLeaderboardContext[adminId]` tracks category vs overall
- Scoring: Base 1000 pts + up to 500 speed bonus (time-based)
- Multi-correct: Multiple answers can have `is_correct=1`; any one correct = full points
- Questions support 2–6 answer options (A through F)
- Answer delay: configurable seconds (0–30, default 3) before options appear after question text
- Categories can be locked/unlocked — locked categories are hidden from players
- CSV results export available during/after finale

### Socket.IO Events

Client → Server:
- `quiz:join` — Player joins quiz room (rate limited: 10/min)
- `admin:join` — Admin joins with session cookie validation
- `answer:submit` — Player submits answer (rate limited: 30/min)

Server → Client (to room):
- `game:state` — Full game state sync (camelCase fields: `status`, `currentQuestionId`, `day`, `language`)
- `player:count` / `player:joined` — Player roster updates
- `question:show` → `question:answers-visible` → `question:tick` → `question:closed` — Question lifecycle
- `question:answer-count` — Live answer count during active question
- `leaderboard:show` — Category or overall leaderboard
- `finale:start` → `finale:reveal` (×3) — Finale podium reveals (3rd → 2nd → 1st)
- `answer:ack` / `answer:error` — Answer submission feedback

## Authentication

- **Session-based**: POST `/admin/api/login` → httpOnly cookie `admin_session`
- **Basic Auth fallback**: For API/testing, checked only if no valid session cookie
- **Socket.IO**: `admin:join` validates session cookie from handshake headers
- **Rate limiting**: Login 10/15min, player join 20/15min

### Roles

- **Superadmin**: Can create/delete admins (Admins tab), manage seed questions (CSV download/upload/reset). First admin from `.env` is auto-promoted.
- **Admin**: Can only manage own quiz + change password.
- Middleware: `requireAdmin` (all admin routes), `requireSuperadmin` (admin management + seed CSV)

### Self-Registration

- Users with `@zscaler.com` (configurable via `REGISTRATION_DOMAIN`) can self-register at `/register.html`
- Flow: Enter email → receive 6-digit code via SMTP → verify → receive temp password via email → forced password change on first login
- Rate limited: 5 requests per 15 minutes per IP
- Verification codes expire after 10 minutes, max 5 failed attempts
- DB table: `pending_registrations` (email, code, attempts, created_at)
- `admins.must_change_password` column forces password change before dashboard access

### Seed Questions

- Default seed data hardcoded in `DEFAULT_SEED_DATA` in `db/database.js`
- Superadmin can override via CSV upload → stored in `seed-data.json`
- `seedExampleQuestions()` reads from `getSeedData()` (custom file or defaults)
- Reset deletes `seed-data.json` to restore defaults

### Logo System

- Per-admin logos: `uploads/logo-{adminId}.ext`
- Fallback: If admin has no logo, `/api/logo/:quiz_code` serves the superadmin's logo
- New admins (created or self-registered) get superadmin's logo copied
- Quiz reset replaces logo with superadmin default
- `/api/favicon` serves superadmin logo as favicon for all pages
- Logo displayed on presenter waiting screen, player waiting card, and registration page

## Conventions

- Env vars for SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `REGISTRATION_DOMAIN` (default: `zscaler.com`)
- DB functions go in `db/database.js` and are exported in `module.exports`
- Socket events use namespaced format: `game:state`, `question:show`, `leaderboard:show` (see full list above)
- All leaderboard queries include 0-point players (sorted by score DESC, name ASC)
- All UI strings use i18n: `data-i18n` attributes in HTML, `t('key')` in JS
- Legal pages: `/impressum.html` and `/datenschutz.html` with footer links on player + admin pages

## Security

- **Helmet**: CSP, X-Frame-Options, X-Content-Type-Options, etc.
- **CORS**: Socket.IO restricted via `ALLOWED_ORIGINS` env var (comma-separated)
- **SQL injection**: Column allowlists (`ADMIN_FIELDS`, `CATEGORY_FIELDS`, `QUESTION_FIELDS`, `ANSWER_FIELDS`) on all update functions
- **CSV formula injection**: `csvSafe()` prefixes trigger characters in exports
- **Player auth**: Cookie-only (`quiz_token`), no tokens in URLs/query params
- **Socket rate limiting**: Per-socket limits on `quiz:join` (10/min), `answer:submit` (30/min)
- **Cross-quiz isolation**: Socket validates player belongs to the quiz before accepting answers
- **File upload**: MIME type + extension allowlist for logo
- **Body size limit**: `express.json({ limit: '100kb' })`

## Mobile / Reconnection Stability

Both `player.js` and `presenter.js` include Socket.IO reconnection handling for mobile stability:
- Explicit reconnection config: `reconnectionAttempts: Infinity`, 1-5s backoff delay
- `connect`/`disconnect`/`reconnect_attempt` handlers with connection status banner UI
- `rejoinAndSync()`: re-emits `quiz:join` and fetches full state via REST `/api/state` on reconnect
- `visibilitychange` listener: detects mobile screen wake, triggers socket reconnect or state sync
- Player tracks `hasJoinedQuiz` flag; presenter tracks `hasJoined` flag — reconnection only activates after initial join

## Known Gotchas

- **sql.js, not better-sqlite3**: `better-sqlite3` fails on Node v25 (no prebuilds, `<climits>` compilation error). Using `sql.js` (pure WASM) instead — requires async `init()` before use, then synchronous queries.
- **DB persistence**: sql.js operates in-memory; `persist()` debounces writes to `quiz.db` on disk. Data loss possible if server crashes during the 100ms debounce window.
- **renderGameCategories timing**: `loadQuestions()` must call `renderGameCategories()` directly — relying on `renderQuestions()` fails when no category is selected (early return skips the re-render).
- **CSV import column mapping**: Don't `.filter()` answer columns before mapping — empty columns must preserve position for correct A/B/C/D mapping.
- **Seed questions**: `seedExampleQuestions()` reads from `getSeedData()` (custom `seed-data.json` or hardcoded `DEFAULT_SEED_DATA`). NOT seed.sql — avoids hardcoded ID problems with AUTOINCREMENT.
- **INTEGER columns**: sql.js returns JS numbers for INTEGER; `!!answer.is_correct` works correctly.
- **csvUpload must be defined early**: The `csvUpload` multer instance is used by both import-csv and seed-csv endpoints, so it must be defined near the top of `routes/admin.js` (not inline before first use).
- **Function hoisting**: `parseCSV()` and `csvSafe()` are function declarations (hoisted), so they can be called from earlier code in the same file.
