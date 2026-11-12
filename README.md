# Corridors

A two-player wall-and-pawn strategy game (Quoridor rules). Playing the computer or a friend on one device runs entirely in the browser with no internet. Online play with a friend uses the small Node server included here.

## Run it

**Offline (vs computer, or two players on one device):**

```bash
cd corridors
python -m http.server 8000
```

Open http://localhost:8000. Opening `index.html` directly also works.

**With online rooms (play a friend on another device):**

```bash
cd corridors
npm install
npm start
```

Open http://localhost:3000. To put it on the internet, follow **DEPLOY.md** (AWS EC2 step by step).

## How to play

- 9×9 board. Red starts bottom centre and must reach the top row; Blue starts top centre and must reach the bottom row.
- On your turn, either move your pawn one square (up, down, left, right) or place one of your 10 walls.
- A wall is two squares long and sits in the grooves between squares. Walls can't overlap or cross, and can never cut a player off from their finish line.
- If the other pawn is directly next to you, jump over it. If a wall or the edge is behind it, step diagonally to either side instead.

### Controls

| Action | Mouse | Touch | Keyboard |
|---|---|---|---|
| Move | Click a glowing square | Tap a glowing square | Arrow keys |
| Wall mode | Wall ─ / Wall │ buttons | same | `H` / `V`, `M` for move |
| Flip wall | Right-click | Switch button | `Space` |
| Place wall | Hover to preview, click to place | Tap to preview, then **Place wall** | `Enter` |
| Cancel preview | Move away / `Esc` | **Cancel** | `Esc` |
| Undo | Undo button | same | `Ctrl+Z` |

## Features

- **Play against the computer** (you are Red) with Easy, Medium and Hard levels, or **play with a friend** on one device.
- **Play a friend online:** create a room, share the random 5-digit code, and both screens update live. Moves are checked on the server, dropped connections rejoin automatically (seat held 10 minutes), and both players can agree to a rematch.
- **Online chat:** type messages, tap quick messages (Nice move!, Good game, Rematch?…) or send emoji reactions that pop up over your pawn. Unread badge and message preview on phones, chat sound with its own mute button. Messages are limited to 120 characters, rate-limited on the server, shown as plain text only, and never saved.
- Dashboard: turn indicator, walls left (number and bar), mode, difficulty, match timer, move counter.
- Undo (in AI mode it rewinds to your previous turn), restart with confirmation, return to menu, sound toggle, light/dark theme.
- Highlighted legal moves, last move marker, animated pawns (with a hop on jumps), dropping walls, victory confetti.
- Player names and pawn colours (8 options), optional shortest-path hint.
- Scoreboard with your record against each AI level, friend-game leaders and recent matches, saved in Local Storage.

## AI

All in `ai.js`, using BFS shortest paths from `game.js`.

- **Evaluation:** opponent's path length minus own path length, plus a small value per wall in hand, with exact race detection once a side has no walls.
- **Candidate walls:** only walls that cut the opponent's current shortest path (or sit right beside them) and actually lengthen it, so walls aren't wasted. A wall must beat simply moving to be chosen.
- **Easy:** follows its shortest path, occasionally wanders, rarely blocks.
- **Medium:** 2-ply search (its move and your best reply).
- **Hard:** iterative-deepening alpha-beta search up to 6 plies with a 1.3 s budget, wider wall set, and an anti-shuffle rule.

Self-play results (10 games each, colours alternated): Hard beat Easy 10–0 and Medium 8–2; Medium beat Easy 10–0.

## Project structure

```
index.html      Markup: menu, board, dashboard, dialogs
style.css       Theme tokens (light/dark), board materials, animations, responsive layout
script.js       UI: rendering, input, turn flow, undo, timer, sound, settings, scoreboard
game.js         Rules engine: moves, jumps, walls, path validation, win detection
ai.js           Computer opponent
online.js       Browser side of online play (WebSocket, auto-reconnect)
server.js       Node server: serves the game and runs online rooms on /ws
package.json    Server dependency (ws) and npm scripts
DEPLOY.md       AWS EC2 deployment guide
assets/         Icon and sound effects (WAV)
tests/          Node tests for rules, AI and the online server
```

## Tests

```bash
node tests/rules.test.js   # 44 rule checks: moves, jumps, diagonals, walls, overlap, sealing, wins, undo, AI legality
node tests/selfplay.js 10  # AI-vs-AI tournament across difficulties
node tests/online.test.js  # 37 server checks: room codes, joining, turn order, cheating attempts, chat limits, reconnect, rematch, file privacy
```
