# Z-Quiz

Live-Quiz-App für Workshops (Kahoot-Style). Node.js + Express + Socket.IO + SQLite (sql.js).

## Quick Start

```bash
npm install
node server.js
# Admin: http://localhost:3000/admin.html (admin / admin123)
```

## Architecture

- **server.js** — Entry point, Express + Socket.IO setup
- **db/database.js** — All DB functions (sql.js, synchronous after async init)
- **db/schema.sql** — Table definitions with CASCADE foreign keys
- **routes/admin.js** — Admin API (auth via HTTP Basic), game control, CSV/JSON import
- **routes/api.js** — Public API (join, state, quiz-info)
- **sockets/index.js** — Real-time events (answer submit, room management)
- **public/js/admin.js** — Admin dashboard client
- **public/js/player.js** — Player client
- **public/js/presenter.js** — Beamer/projector view
- **public/js/i18n.js** — EN/DE translations

## Game Flow

```
idle → question_active → answers_visible → question_closed → [showing_leaderboard] → idle/finale
```

- Admin starts question → 3s delay → answers appear → timer countdown → auto-close
- After last question of a category: auto category leaderboard (4s delay)
- "Overall Leaderboard" button shows cumulative scores across all categories
- Finale reveals top 3 with podium animation

## Key Patterns

- **Leaderboard context**: `global.activeLeaderboardContext[adminId]` tracks whether current leaderboard is category-specific or overall, so `/api/state` returns correct data on page reload
- **Timer management**: `global.activeTimers[adminId]` stores setInterval refs for countdown
- **Scoring**: Base 1000 pts + up to 500 speed bonus (time-based)
- **Multi-correct answers**: Multiple answers can have `is_correct=1`; player selecting any one correct answer gets full points

## Testing

```bash
# Install socket.io-client for integration tests
npm install --save-dev socket.io-client

# Tests are written as standalone node scripts (test-*.js)
# Server must be running on port 3000
node test-example.js
```

## Conventions

- DB functions go in `db/database.js` and are exported in `module.exports`
- Admin routes require `requireAdmin` middleware (HTTP Basic Auth)
- Socket events use namespaced format: `game:state`, `question:show`, `leaderboard:show`, etc.
- All leaderboard queries include 0-point players
- German used for user-facing button tooltips in admin UI
