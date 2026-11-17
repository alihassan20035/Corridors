# Wood Games

A small gaming portal on a warm birch-table theme. One landing page links to each game. Everything runs from your own server with no accounts and no paid services.

Games:
- **Corridors** — a Quoridor-style wall-and-pawn game. Computer (3 levels), two players on one device, and online with a friend (5-digit room codes, chat and emoji).
- **Tic-Tac-Toe** — 3×3 (three in a row) or 5×5 (four in a row). Computer (Easy, Medium, unbeatable on 3×3), two players on one device, and online with a friend (5-digit room codes, chat and emoji). The board size is set by whoever creates an online room.

## Run it

**Everything (portal + both games + Corridors online):**

```bash
cd game-portal
npm install
npm start
```

Open http://localhost:3000 — the portal. Each game is also reachable directly:
- http://localhost:3000/games/corridors/
- http://localhost:3000/games/tic-tac-toe/

Both games share the same online server (rooms on `/ws`), so a 5-digit code from one game won’t collide with the other — joining the wrong game is refused with a clear message.

**Solo / local only, no server:** open `index.html` in a browser. The portal and both games work offline against the computer and for two players on one device. Only Corridors *online* needs the Node server.

To put it on the internet (AWS EC2, step by step), see **DEPLOY.md**.

## Project structure

```
game-portal/
  index.html          Portal landing page (choose a game)
  portal.css          Portal styling + shared wood theme
  portal.js           Theme toggle and decorative boards
  favicon.svg
  server.js           Node server: serves the portal and both games, runs Corridors online rooms on /ws
  package.json
  DEPLOY.md           AWS EC2 deployment guide
  games/
    corridors/
      index.html, style.css, script.js, game.js, ai.js, online.js
      assets/         icon + sound effects
    tic-tac-toe/
      index.html, style.css, script.js, game.js, ai.js
      assets/         icon + sound effects
  tests/
    rules.test.js       Corridors rules
    selfplay.js         Corridors AI tournament
    tictactoe.test.js   Tic-Tac-Toe rules + AI
    online.test.js      Server: rooms, chat, reconnect, file privacy
```

Each game is self-contained in its own folder, so adding another game is just a new folder under `games/` plus a card on the portal.

## Tests

```bash
npm test                     # rules + tic-tac-toe + server
node tests/selfplay.js 10    # Corridors AI-vs-AI tournament
```

- Corridors: 44 rule checks, AI strength tournament.
- Tic-Tac-Toe: 30 checks, including that Hard never loses across 300 games of 3×3 and always draws against itself, plus 5×5 four-in-a-row wins, blocking and move legality.
- Server: 52 checks — 5-digit room codes, turn order, cheating attempts, chat limits, reconnect, rematch, and that server files, dependencies and tests are never served.

## Adding a game later

1. Create `games/<name>/` with its own `index.html`, styles, script and `game.js`.
2. Reuse the wood theme tokens from any existing game's `style.css`.
3. Add a card to `index.html` on the portal.

Static serving already covers any file under `games/`, so no server change is needed unless the game needs its own online rooms.
