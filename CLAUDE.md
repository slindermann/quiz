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
- **routes/admin.js** — Admin REST API + game control (timer management via `global.activeTimers[adminId]`)
- **routes/api.js** — Public player API (join, state, quiz-info)
- **sockets/index.js** — Real-time events (answer submit, room management)
- **public/js/admin.js** — Admin dashboard client (session-based auth, no localStorage)
- **public/js/player.js** — Player client
- **public/js/presenter.js** — Beamer/projector view
- **public/js/i18n.js** — EN/DE translations (`data-i18n` attributes + `t()` function)

### Game State Machine

```
idle → question_active → answers_visible → question_closed → [showing_leaderboard] → idle/finale
```

- Timer management: `global.activeTimers[adminId]` stores setInterval refs
- Leaderboard context: `global.activeLeaderboardContext[adminId]` tracks category vs overall
- Scoring: Base 1000 pts + up to 500 speed bonus (time-based)
- Multi-correct: Multiple answers can have `is_correct=1`; any one correct = full points

## Authentication

- **Session-based**: POST `/admin/api/login` → httpOnly cookie `admin_session`
- **Basic Auth fallback**: For API/testing, checked only if no valid session cookie
- **Socket.IO**: `admin:join` validates session cookie from handshake headers
- **Rate limiting**: Login 10/15min, player join 20/15min

### Roles

- **Superadmin**: Can create/delete admins (Admins tab). First admin from `.env` is auto-promoted.
- **Admin**: Can only manage own quiz + change password.
- Middleware: `requireAdmin` (all admin routes), `requireSuperadmin` (admin management)

## Conventions

- DB functions go in `db/database.js` and are exported in `module.exports`
- Socket events use namespaced format: `game:state`, `question:show`, `leaderboard:show`
- All leaderboard queries include 0-point players (sorted by score DESC, name ASC)
- All UI strings use i18n: `data-i18n` attributes in HTML, `t('key')` in JS
- SQL injection prevention: Column allowlists (`ADMIN_FIELDS`, `CATEGORY_FIELDS`, etc.) on all update functions
- CSV export: `csvSafe()` prevents formula injection
- File upload: MIME type + extension allowlist for logo, per-admin filenames (`logo-{adminId}.ext`)
- Legal pages: `/impressum.html` and `/datenschutz.html` with footer links on player + admin pages

## Security

- **Helmet**: CSP, X-Frame-Options, X-Content-Type-Options, etc.
- **CORS**: Socket.IO restricted via `ALLOWED_ORIGINS` env var (comma-separated)
- **Player auth**: Cookie-only (`quiz_token`), no tokens in URLs/query params
- **Socket rate limiting**: Per-socket limits on `quiz:join` (10/min), `answer:submit` (30/min)
- **Cross-quiz isolation**: Socket validates player belongs to the quiz before accepting answers
- **SQL injection**: Column allowlists (`ADMIN_FIELDS`, `CATEGORY_FIELDS`, etc.) on all update functions
- **CSV formula injection**: `csvSafe()` prefixes trigger characters
- **Body size limit**: `express.json({ limit: '100kb' })`

## Known Gotchas

- **sql.js, not better-sqlite3**: `better-sqlite3` fails on Node v25 (no prebuilds, `<climits>` compilation error). Using `sql.js` (pure WASM) instead — requires async `init()` before use, then synchronous queries.
- **DB persistence**: sql.js operates in-memory; `persist()` debounces writes to `quiz.db` on disk. Data loss possible if server crashes during the 100ms debounce window.
- **renderGameCategories timing**: `loadQuestions()` must call `renderGameCategories()` directly — relying on `renderQuestions()` fails when no category is selected (early return skips the re-render).
- **CSV import column mapping**: Don't `.filter()` answer columns before mapping — empty columns must preserve position for correct A/B/C/D mapping.
- **Seed questions**: `seedExampleQuestions()` uses JS data (NOT seed.sql) to avoid hardcoded ID problems with AUTOINCREMENT.
- **INTEGER columns**: sql.js returns JS numbers for INTEGER; `!!answer.is_correct` works correctly.
