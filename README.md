# Z-Quiz

A real-time, interactive quiz application (Kahoot-style) built for workshops and team events. Each admin gets their own isolated quiz with a unique join code — just share the link or QR code and start playing.

**Tech stack:** Node.js, Express, Socket.IO, SQLite (sql.js), Docker

## Quick Start

```bash
# Clone and install
git clone https://github.com/slindermann/quiz.git
cd quiz
npm install

# Start the server
node server.js
```

The server starts on port **3000**. On first run, an admin account is created automatically — the username and a generated password are printed to the console.

Open the admin dashboard at **http://localhost:3000/admin.html** and log in.

### Environment Variables (optional)

Create a `.env` file to override defaults:

```env
ADMIN_USER=admin
ADMIN_PASS=your-password
PORT=3000
```

## Docker Deployment

```bash
docker compose up -d --build
```

The database and uploaded logos are persisted in `./data/`. Make sure the DB file exists before first run:

```bash
mkdir -p data && touch data/quiz.db
```

## Admin Guide

### Dashboard Overview

After login, the admin dashboard has three tabs:

| Tab | Purpose |
|-----|---------|
| **Game** | Control the live quiz — start questions, view answers, show leaderboards |
| **Questions** | Create and manage categories, questions, and answers |
| **Settings** | Quiz name, logo, language, CSV import/export, password change |

### Setting Up Your Quiz

#### 1. Load Example Questions (optional)

If your quiz is empty, a prompt appears on the Game tab offering to load example questions. Click **Load Examples** to get started quickly, then customize from there.

#### 2. Create Categories

Go to the **Questions** tab and click **Add Category**. Each category has:

- **Name** — displayed to players during the quiz
- **Timer** — how many seconds players have to answer (5–120s)

#### 3. Add Questions

Select a category, then click **Add Question**. Each question supports:

- A question text
- 2–6 answer options (A through F)
- One or multiple correct answers (checkboxes)

If multiple answers are marked correct, a player selecting *any one* of them receives full points.

#### 4. Import Questions via CSV

Instead of adding questions manually, you can bulk-import them. Go to **Settings** and use:

- **Download CSV Template** — get an example file showing the expected format
- **Import CSV** — upload your file

CSV format:

```
Category,Timer(s),Question,Answer A,Answer B,Answer C,Answer D,Correct
General Knowledge,30,What is the capital of France?,Berlin,Paris,London,Madrid,B
Science,20,Which planet is closest to the Sun?,Venus,Mercury,Earth,Mars,B
Mixed,25,Which are primary colors?,Red,Green,Blue,Yellow,A;C
```

Categories are created automatically. If a category already exists, questions are added to it.

### Customizing Your Quiz

In the **Settings** tab you can configure:

- **Quiz Name** — shown on the presenter screen and player view
- **Language** — English or German (affects all player-facing text)
- **Answer Delay** — seconds before answer options appear after the question text (0–30s, default 3s). This gives players time to read the question before the timer starts.
- **Logo** — upload a custom image (PNG, JPG, GIF, WEBP). Shown on the presenter waiting screen, player view, and as the favicon.

### Sharing Your Quiz

Every quiz has a unique **6-character join code**. Players can join in two ways:

- **QR Code** — displayed in the Game tab and on the presenter waiting screen. Players scan it with their phone.
- **Join URL** — `https://your-server/join/CODE` — click the copy button next to the QR code to share it.

### Running a Live Quiz

#### Game Control

The **Game** tab is your control center during a live session:

- **Categories panel** (left) — shows all categories with question counts. Click a question's **Start** button to begin it.
- **Status panel** (right) — shows the active question and a live answer counter. Click **Close Question** to end it early.
- **Quick Actions** — buttons for Overall Leaderboard, Waiting Screen, Finale, and New Quiz.

#### Locking / Unlocking Categories

Each category can be **locked** or **unlocked**:

- **Unlocked** categories are visible to players (they can see category names on their screen)
- **Locked** categories are hidden from players

Use this to reveal categories one at a time during the event.

#### Question Lifecycle

When you start a question, here is what happens:

1. **Question text appears** — players and presenter see the question (no answer options yet)
2. **Answers become visible** — after the configured answer delay, options appear and the countdown timer starts
3. **Timer runs out** (or you click Close) — the question closes, correct answers are highlighted, and players see their result
4. **Next action** — depending on your automation settings, the next question starts automatically, a leaderboard is shown, or you take manual control

Already-played questions appear grayed out with a checkmark. You can replay any question by clicking its **Start** button again.

#### Scoring

- **1000 base points** for a correct answer
- **Up to 500 bonus points** for speed (faster answer = more bonus)
- **0 points** for a wrong answer

#### Leaderboards

- **Category Leaderboard** — click the trophy icon next to a category to show rankings for that category only
- **Overall Leaderboard** — click the **Overall Leaderboard** button to show cumulative scores across all categories

All players are included in leaderboards (even those with 0 points), sorted by score descending, then by name.

#### Automation Settings

Four toggles in the **Game Settings** panel (all enabled by default):

| Setting | What it does |
|---------|-------------|
| **Auto-advance** | Automatically starts the next question in the category 4 seconds after closing one |
| **Auto-close** | Closes the question 1 second after all players have answered |
| **Auto-category leaderboard** | Shows the category leaderboard after the last question of a category is closed |
| **Auto-finale** | Starts the finale automatically once all questions in all categories have been played |

Disable any of these to take full manual control.

#### The Finale

The finale is a podium ceremony that reveals the top 3 players:

1. **3rd place** is revealed first
2. **2nd place** follows after 4 seconds
3. **1st place** is revealed last (with confetti)
4. The full overall leaderboard is shown automatically afterward

Start the finale manually with the gold **Finale** button, or let it trigger automatically if auto-finale is enabled.

#### Exporting Results

After the quiz ends, click **Download Results (CSV)** (available during/after the finale) to export a spreadsheet with all player answers and scores.

### Presenter View

Click **Open Presenter View** in the Game tab to open a full-screen view designed for projectors or shared screens. It displays:

- **Waiting screen** — logo, QR code, player count, and names of joined players
- **Questions** — question text, answer options, countdown timer, live answer count
- **Results** — correct answer highlighted, percentage bars for each option
- **Leaderboards** — top 10 with gold/silver/bronze medals
- **Finale** — animated podium with confetti

The presenter view runs independently and reconnects automatically if the connection drops — safe to use on a separate device.

### Player Experience

Players join on their phone or laptop:

1. Scan the QR code or open the join URL
2. Enter a name and tap **Join**
3. Wait for the admin to start questions
4. Tap an answer before the timer runs out
5. See instant feedback: correct/wrong and points earned
6. View leaderboard standings between questions

The player view handles network interruptions gracefully — if a phone screen locks or connectivity drops, it automatically reconnects and syncs state.

### Resetting Your Quiz

Click the red **New Quiz** button in Quick Actions to:

- Delete all player answers, questions, and categories
- Generate a new quiz code (and QR code)
- Restore the default logo

This gives you a clean slate. Use **Load Examples** to repopulate with seed questions afterward if needed.

## License

MIT
