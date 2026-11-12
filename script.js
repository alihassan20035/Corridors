/* ==========================================================================
   script.js — Corridors user interface
   --------------------------------------------------------------------------
   Owns everything on screen: menu, board rendering, input (mouse, touch,
   keyboard), turn flow, the computer opponent's timing, undo, timer,
   sounds, themes, settings and the local scoreboard.
   Rules live in game.js, the opponent's thinking lives in ai.js.
   ========================================================================== */
(() => {
  'use strict';

  const { GameState, N, W } = window.Corridors;
  const AI = window.CorridorsAI;

  /* ================================================================ storage */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('corridors.' + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('corridors.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  const PALETTE = [
    { name: 'Red', hex: '#d62839' }, { name: 'Blue', hex: '#1d63d8' },
    { name: 'Green', hex: '#1e8a4c' }, { name: 'Purple', hex: '#7b3fc4' },
    { name: 'Orange', hex: '#e2670f' }, { name: 'Teal', hex: '#0d8a8c' },
    { name: 'Pink', hex: '#d63384' }, { name: 'Slate', hex: '#3d4652' },
  ];

  const prefs = Object.assign({
    theme: 'system', sound: true, hints: false, chatMute: false,
    names: ['', ''], colors: ['#d62839', '#1d63d8'], level: 'medium',
  }, store.get('prefs', {}));
  const savePrefs = () => store.set('prefs', prefs);

  const LEVEL_NOTES = {
    easy: 'Walks toward its goal and only sometimes drops a wall.',
    medium: 'Plans a move ahead and blocks when you get close.',
    hard: 'Searches several moves deep and spends walls with purpose.',
  };
  const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  /* ================================================================== sound */
  const Sound = {
    files: {
      move: 'assets/sounds/move.wav', wall: 'assets/sounds/wall.wav', win: 'assets/sounds/win.wav',
      invalid: 'assets/sounds/invalid.wav', click: 'assets/sounds/click.wav', chat: 'assets/sounds/chat.wav',
    },
    pool: {},
    ctx: null,
    warm() { // load files on the first interaction so playback is instant
      for (const k in this.files) {
        if (this.pool[k]) continue;
        try { const a = new Audio(this.files[k]); a.preload = 'auto'; this.pool[k] = a; } catch (e) { /* ignore */ }
      }
    },
    play(name) {
      if (!prefs.sound) return;
      const base = this.pool[name];
      if (!base) { this.synth(name); return; }
      try {
        const a = base.cloneNode();
        a.volume = name === 'click' ? 0.35 : 0.7;
        const p = a.play();
        if (p && p.catch) p.catch(() => this.synth(name));
      } catch (e) { this.synth(name); }
    },
    /** Fallback beeps via Web Audio if the WAV files cannot play. */
    synth(name) {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        const ctx = this.ctx, t = ctx.currentTime;
        const tones = { move: [[420, .08]], wall: [[160, .12]], invalid: [[150, .1], [150, .1]], click: [[1200, .03]], chat: [[1318, .1], [1760, .15]], win: [[523, .15], [659, .15], [784, .15], [1046, .3]] }[name] || [];
        let at = t;
        for (const [f, d] of tones) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
          g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, at + d);
          o.start(at); o.stop(at + d + 0.02); at += d * 0.9;
        }
      } catch (e) { /* no audio available */ }
    },
  };

  /* ===================================================================== DOM */
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const el = {
    menu: $('menu'), game: $('game'), grid: $('grid'), mini: $('mini-board'),
    status: $('status'), statusText: $('status-text'),
    tools: { move: $('tool-move'), h: $('tool-h'), v: $('tool-v') },
    confirmRow: $('confirm-row'), toolHint: $('tool-hint'),
    time: $('stat-time'), moves: $('stat-moves'), modeStat: $('stat-mode'), modeChip: $('mode-chip'),
    undo: $('btn-undo'), restart: $('btn-restart'), sound: $('btn-sound'), theme: $('btn-theme'),
    toast: $('toast'), overlay: $('overlay'), confetti: $('confetti'),
    cards: [$('card-0'), $('card-1')], names: [$('name-0'), $('name-1')], subs: [$('sub-0'), $('sub-1')],
    wallNums: [$('walls-0'), $('walls-1')], stocks: [$('stock-0'), $('stock-1')],
    goalTop: $('goal-top-label'), goalBottom: $('goal-bottom-label'),
  };

  /* ================================================================ geometry */
  // Everything on the board is positioned in % of the square grid.
  const U = 100 / N;           // one cell + one groove
  const G = U * 0.17;          // groove width
  const T = G * 0.8;           // wall thickness
  const pct = (x) => x.toFixed(4) + '%';

  function placeCell(node, r, c) {
    node.style.left = pct(c * U + G / 2); node.style.top = pct(r * U + G / 2);
    node.style.width = node.style.height = pct(U - G);
  }
  function placeWall(node, r, c, o) {
    const len = 2 * U - G * 0.3, start = G * 0.15;
    if (o === 'h') {
      node.style.left = pct(c * U + start); node.style.width = pct(len);
      node.style.top = pct((r + 1) * U - T / 2); node.style.height = pct(T);
    } else {
      node.style.top = pct(r * U + start); node.style.height = pct(len);
      node.style.left = pct((c + 1) * U - T / 2); node.style.width = pct(T);
    }
  }
  function placePawn(node, r, c, scale = 0.74) {
    node.style.left = pct(c * U + U / 2); node.style.top = pct(r * U + U / 2);
    node.style.width = node.style.height = pct((U - G) * scale);
  }

  /* ============================================================ app state */
  let game = new GameState();
  let mode = 'friend';              // 'friend' | 'ai'
  let level = prefs.level;          // AI difficulty
  let history = [];                 // snapshots taken before each action (for undo)
  let recent = [[], []];            // squares each pawn visited lately (AI anti-shuffle)
  let tool = 'move';                // 'move' | 'h' | 'v'
  let pawnSelected = true;
  let hover = null;                 // wall slot under the mouse { r, c, o }
  let pending = null;               // wall preview awaiting confirmation
  let aiThinking = false;
  let aiTimer = null;
  let token = 0;                    // bumps on restart/undo so stale AI timers are ignored
  let finished = false;
  let clock = { start: 0, end: 0, timer: null };
  let lastPointer = 'mouse';
  let wallNodes = new Map();        // "h:3,4" -> element
  // Online play (see online.js / server.js)
  const online = {
    conn: null, me: -1, room: null, names: ['Red', 'Blue'],
    connected: [false, false], ready: false,
    sending: false,       // an action is on its way to the server
    net: 'idle',          // 'idle' | 'connecting' | 'open' | 'down'
    rematchSent: false, lobby: false,
  };
  let lastMoveHop = false;

  /* ============================================================== board DOM */
  const cells = [];
  const pawns = [];
  const pawnHits = [];
  let ghost;

  function buildBoard() {
    el.grid.innerHTML = '';
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell' + (r === 0 ? ' goal-0' : r === N - 1 ? ' goal-1' : '');
        b.dataset.r = r; b.dataset.c = c;
        b.tabIndex = -1;
        b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`);
        placeCell(b, r, c);
        el.grid.appendChild(b);
        cells.push(b);
      }
    }
    for (let p = 0; p < 2; p++) {
      const pawn = document.createElement('div');
      pawn.className = 'pawn'; pawn.dataset.p = p;
      pawn.innerHTML = '<span class="ball"></span>';
      el.grid.appendChild(pawn); pawns[p] = pawn;
      const hit = document.createElement('button');
      hit.type = 'button'; hit.className = 'pawn-hit'; hit.dataset.p = p; hit.tabIndex = -1;
      hit.setAttribute('aria-label', 'Select pawn');
      el.grid.appendChild(hit); pawnHits[p] = hit;
    }
    ghost = document.createElement('div');
    ghost.className = 'wall ghost'; ghost.hidden = true;
    el.grid.appendChild(ghost);
  }

  /** Decorative board on the menu: a mid-game position. */
  function buildMiniBoard() {
    const g = document.createElement('div');
    g.className = 'grid';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const d = document.createElement('div');
      d.className = 'cell' + (r === 0 ? ' goal-0' : r === N - 1 ? ' goal-1' : '');
      placeCell(d, r, c); g.appendChild(d);
    }
    const walls = [[2, 3, 'h', 0], [2, 5, 'h', 0], [5, 1, 'v', 1], [4, 3, 'h', 1], [6, 6, 'v', 0], [1, 1, 'h', 1]];
    for (const [r, c, o, p] of walls) {
      const w = document.createElement('div');
      w.className = 'wall ' + o; w.dataset.p = p; placeWall(w, r, c, o); g.appendChild(w);
    }
    for (const [p, r, c] of [[0, 5, 4], [1, 3, 5]]) {
      const pawn = document.createElement('div');
      pawn.className = 'pawn'; pawn.dataset.p = p; pawn.innerHTML = '<span class="ball"></span>';
      placePawn(pawn, r, c); g.appendChild(pawn);
    }
    el.mini.appendChild(g);
  }

  /* ================================================================ helpers */
  const colorName = (hex) => (PALETTE.find(x => x.hex === hex) || { name: 'Player' }).name;
  function playerName(p) {
    if (mode === 'ai' && p === 1) return 'Computer';
    if (mode === 'online') return online.names[p] || (p === 0 ? 'Red' : 'Blue');
    return (prefs.names[p] || '').trim() || colorName(prefs.colors[p]);
  }
  const isAIPlayer = (p) => mode === 'ai' && p === 1;
  const onlineCanAct = () => online.ready && online.net === 'open' && online.connected[0] && online.connected[1]
    && game.turn === online.me && !online.sending;
  const isHumanTurn = () => !finished && !aiThinking && !isAIPlayer(game.turn)
    && (mode !== 'online' || onlineCanAct());
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const elapsed = () => ((clock.end || Date.now()) - clock.start) / 1000;

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  function onlineStatus() {
    const other = 1 - online.me;
    if (online.net !== 'open') return 'Reconnecting…';
    if (!online.ready) return 'Waiting for your friend to join';
    if (!online.connected[other]) return `${playerName(other)} is offline. Waiting…`;
    if (online.sending) return 'Sending your move…';
    return game.turn === online.me ? 'Your move' : `Waiting for ${playerName(other)}…`;
  }

  /* ================================================================= render */
  function render(opts = {}) {
    const p = game.turn;
    root.style.setProperty('--turn-color', `var(--p${p})`);
    const la = game.lastAction;
    root.style.setProperty('--last-color', la ? `var(--p${la.player})` : 'transparent');

    // Cells: move targets, last move, optional path hint
    const targets = new Set();
    if (isHumanTurn() && tool === 'move' && pawnSelected) {
      for (const m of game.legalPawnMoves(p)) targets.add(m.r * N + m.c);
    }
    const path = new Set();
    if (prefs.hints && isHumanTurn()) for (const s of game.shortestPath(p)) path.add(s.r * N + s.c);
    for (let i = 0; i < cells.length; i++) {
      const b = cells[i];
      const isT = targets.has(i);
      b.classList.toggle('target', isT);
      b.tabIndex = isT ? 0 : -1;
      b.classList.toggle('path', path.has(i));
      b.classList.toggle('last-from', !!(la && la.type === 'move' && la.from.r * N + la.from.c === i));
      b.classList.toggle('last-to', !!(la && la.type === 'move' && la.r * N + la.c === i));
    }

    // Walls (diffed so only the new wall animates)
    const want = new Map();
    for (const w of game.wallList()) want.set(`${w.o}:${w.r},${w.c}`, w);
    for (const [k, node] of wallNodes) if (!want.has(k)) { node.remove(); wallNodes.delete(k); }
    for (const [k, w] of want) {
      let node = wallNodes.get(k);
      if (!node) {
        node = document.createElement('div');
        node.className = 'wall ' + w.o + (opts.animate ? ' drop' : '');
        node.dataset.p = w.owner;
        placeWall(node, w.r, w.c, w.o);
        el.grid.insertBefore(node, ghost);
        wallNodes.set(k, node);
      }
      node.classList.toggle('last', !!(la && la.type === 'wall' && `${la.o}:${la.r},${la.c}` === k));
    }

    // Pawns
    for (let i = 0; i < 2; i++) {
      const pos = game.pawns[i];
      placePawn(pawns[i], pos.r, pos.c);
      placePawn(pawnHits[i], pos.r, pos.c, 0.95);
      pawns[i].classList.toggle('selected', isHumanTurn() && i === p && tool === 'move' && pawnSelected);
      pawns[i].classList.toggle('winner', finished && game.winner === i);
      pawnHits[i].hidden = !(isHumanTurn() && i === p);
    }
    if (opts.hop !== undefined) {
      const node = pawns[opts.hop];
      node.classList.remove('hop'); void node.offsetWidth; node.classList.add('hop');
    }

    renderGhost();
    renderPanels();
  }

  function renderGhost() {
    const slot = pending || (tool !== 'move' ? hover : null);
    if (!slot || !isHumanTurn()) { ghost.hidden = true; el.confirmRow.hidden = true; return; }
    ghost.hidden = false;
    ghost.className = 'wall ghost ' + slot.o + (pending ? ' pending' : '');
    ghost.dataset.p = game.turn;
    const problem = game.wallProblem(game.turn, slot.r, slot.c, slot.o);
    if (problem) ghost.classList.add('bad');
    placeWall(ghost, slot.r, slot.c, slot.o);
    el.confirmRow.hidden = !pending;
    if (pending) {
      $('confirm-hint').textContent = problem || 'Place this wall?';
      $('btn-confirm-wall').disabled = !!problem;
    }
  }

  function renderPanels() {
    const p = game.turn;
    for (let i = 0; i < 2; i++) {
      el.names[i].textContent = playerName(i);
      el.wallNums[i].textContent = game.wallsLeft[i];
      const bars = el.stocks[i];
      if (bars.children.length !== 10) bars.innerHTML = '<i></i>'.repeat(10);
      [...bars.children].forEach((b, k) => b.classList.toggle('used', k >= game.wallsLeft[i]));
      el.cards[i].classList.toggle('is-turn', !finished && p === i);
      el.cards[i].classList.toggle('is-thinking', aiThinking && p === i);
    }
    el.subs[0].textContent = 'Heads for the top row';
    el.subs[1].textContent = mode === 'ai' ? `${LEVEL_NAMES[level]} difficulty` : 'Heads for the bottom row';
    if (mode === 'online') {
      for (let i = 0; i < 2; i++) {
        el.subs[i].textContent = (i === online.me ? 'You' : 'Your friend') + (online.connected[i] || i === online.me ? '' : ', offline');
      }
    }
    el.goalTop.textContent = `${playerName(0)}’s finish line`;
    el.goalBottom.textContent = `${playerName(1)}’s finish line`;

    // Status line
    el.status.classList.toggle('thinking', aiThinking || (mode === 'online' && !finished && !onlineCanAct()));
    if (finished) el.statusText.textContent = `${playerName(game.winner)} wins!`;
    else if (aiThinking) el.statusText.textContent = 'Computer is thinking…';
    else if (mode === 'online') el.statusText.textContent = onlineStatus();
    else el.statusText.textContent = mode === 'ai' ? 'Your move' : `${playerName(p)} to move`;
    if (finished) root.style.setProperty('--turn-color', `var(--p${game.winner})`);

    // Tools
    const human = isHumanTurn();
    for (const k of ['move', 'h', 'v']) {
      const b = el.tools[k];
      b.classList.toggle('is-on', tool === k);
      b.setAttribute('aria-checked', tool === k);
      b.disabled = !human || (k !== 'move' && game.wallsLeft[p] === 0);
    }
    el.grid.classList.toggle('wall-mode', tool !== 'move' && human);

    let hint = '';
    if (finished) hint = 'Game over. Start a new one from the buttons below.';
    else if (!human && mode === 'online') hint = online.net !== 'open' ? 'Your connection dropped. Reconnecting automatically.' : 'Your friend’s move will appear here as soon as they make it.';
    else if (!human) hint = 'Wait for the computer’s move.';
    else if (tool === 'move') hint = game.wallsLeft[p] === 0 ? 'No walls left. Tap a glowing square to move.' : 'Tap a glowing square to move.';
    else if (pending) hint = 'Tap another groove to move the preview.';
    else hint = lastPointer === 'mouse' ? 'Click a groove to place the wall. Space flips it.' : 'Tap a groove to preview the wall.';
    el.toolHint.textContent = hint;

    el.moves.textContent = game.moveCount;
    el.undo.disabled = finished || history.length === 0 || (mode === 'ai' && !history.some(s => s.turn === 0));
    el.undo.hidden = mode === 'online';
    el.restart.hidden = mode === 'online';
    renderChatChrome();
  }

  /* ============================================================ turn flow */
  function newGame(newMode) {
    if (newMode) mode = newMode;
    token++;
    clearTimeout(aiTimer); aiThinking = false;
    game = new GameState();
    history = []; recent = [[], []];
    tool = 'move'; pawnSelected = true; hover = pending = null; finished = false;
    for (const node of wallNodes.values()) node.remove();
    wallNodes.clear();
    clock.start = Date.now(); clock.end = 0;
    clearInterval(clock.timer);
    clock.timer = setInterval(tickClock, 1000);
    tickClock();
    stopConfetti();
    updateModeLabels();
    render();
  }

  function updateModeLabels() {
    el.modeChip.textContent = mode === 'ai' ? `Against the computer, ${LEVEL_NAMES[level]}`
      : mode === 'online' ? `Online, room ${online.room || ''}` : 'Two players, one device';
    el.modeStat.textContent = mode === 'ai' ? `${LEVEL_NAMES[level]} AI` : mode === 'online' ? 'Online' : 'Friend';
  }

  function tickClock() { el.time.textContent = fmtTime(elapsed()); }

  /** Apply an action for the current player. Returns true if it happened. */
  function act(action, opts = {}) {
    if (mode === 'online' && !opts.remote) return sendOnline(action);
    const p = game.turn;
    const snap = game.snapshot();
    const from = { ...game.pawns[p] };
    if (!game.apply(action)) {
      if (opts.remote) { requestResync(); return false; }
      Sound.play('invalid');
      if (action.type === 'wall') toast(game.wallProblem(p, action.r, action.c, action.o) || 'You can’t place a wall there');
      else toast('You can’t move there');
      return false;
    }
    history.push(snap);
    recent[p].push(from); if (recent[p].length > 6) recent[p].shift();
    hover = pending = null;
    tool = 'move'; pawnSelected = true;
    if (action.type === 'move') {
      const far = Math.abs(from.r - action.r) + Math.abs(from.c - action.c) > 1;
      Sound.play('move');
      render({ hop: far ? p : undefined });
    } else {
      Sound.play('wall');
      render({ animate: true });
    }
    if (game.winner !== -1) { finish(); return true; }
    if (isAIPlayer(game.turn)) scheduleAI();
    return true;
  }

  function scheduleAI() {
    aiThinking = true;
    render();
    const myToken = token;
    // A short pause so the move feels considered, and so the human's move
    // animation finishes before the (synchronous) search starts.
    aiTimer = setTimeout(() => {
      if (myToken !== token) return;
      const t0 = performance.now();
      const action = AI.chooseAction(game, game.turn, level, recent[game.turn].slice(-4));
      const spent = performance.now() - t0;
      // Keep a minimum overall pause even when the AI answered instantly.
      aiTimer = setTimeout(() => {
        if (myToken !== token) return;
        aiThinking = false;
        if (!act(action)) {               // should never happen; fall back to a legal step
          const m = game.legalPawnMoves(game.turn)[0];
          act({ type: 'move', r: m.r, c: m.c });
        }
      }, Math.max(0, 260 - spent));
    }, 420 + Math.random() * 260);
  }

  function undo() {
    if (finished || !history.length) return;
    token++; clearTimeout(aiTimer); aiThinking = false;
    let snap = history.pop();
    if (mode === 'ai') {
      // Go back to the last position where it was the human's turn.
      while (snap.turn !== 0 && history.length) snap = history.pop();
    }
    game.restore(snap);
    recent = [[], []];
    hover = pending = null; tool = 'move'; pawnSelected = true;
    Sound.play('click');
    render();
    if (isAIPlayer(game.turn)) scheduleAI();
  }

  function finish() {
    finished = true;
    clock.end = Date.now(); clearInterval(clock.timer); tickClock();
    render();
    Sound.play('win');
    recordMatch();
    startConfetti(prefs.colors[game.winner]);
    setTimeout(showWinDialog, 900);
  }

  function showWinDialog() {
    if (!finished) return;
    const w = game.winner;
    const name = playerName(w);
    $('win-title').textContent = mode === 'ai' ? (w === 0 ? 'You win!' : 'The computer wins')
      : mode === 'online' ? (w === online.me ? 'You win!' : `${name} wins`) : `${name} wins!`;
    online.rematchSent = false;
    $('win-again').disabled = false;
    $('win-again').textContent = mode === 'online' ? 'Rematch' : 'Play again';
    $('win-pawn').style.setProperty('--pc', `var(--p${w})`);
    const myMoves = Math.ceil(game.moveCount / 2);
    $('win-text').textContent = mode === 'ai' && w === 1
      ? `It reached your side in ${myMoves} turns. Try again?`
      : `${name}${name === colorName(prefs.colors[w]) ? '' : ` (${colorName(prefs.colors[w]).toLowerCase()})`} reached the far side in ${myMoves} turns.`;
    $('win-time').textContent = fmtTime(elapsed());
    $('win-moves').textContent = game.moveCount;
    $('win-walls').textContent = `${10 - game.wallsLeft[0]} / ${10 - game.wallsLeft[1]}`;
    openDialog('dlg-win');
  }

  /* ================================================================== input */
  /** Translate a pointer position to the nearest wall slot. */
  function slotFromPoint(x, y, o) {
    const rect = el.grid.getBoundingClientRect();
    const fx = (x - rect.left) / rect.width * N;
    const fy = (y - rect.top) / rect.height * N;
    const clamp = (v) => Math.max(0, Math.min(W - 1, v));
    return { r: clamp(Math.round(fy) - 1), c: clamp(Math.round(fx) - 1), o };
  }

  el.grid.addEventListener('pointermove', (e) => {
    lastPointer = e.pointerType || 'mouse';
    if (e.pointerType !== 'mouse' || tool === 'move' || !isHumanTurn() || pending) return;
    const s = slotFromPoint(e.clientX, e.clientY, tool);
    if (!hover || hover.r !== s.r || hover.c !== s.c || hover.o !== s.o) { hover = s; renderGhost(); }
  });
  el.grid.addEventListener('pointerleave', () => { if (hover) { hover = null; renderGhost(); } });
  el.grid.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; Sound.warm(); });

  el.grid.addEventListener('click', (e) => {
    if (!isHumanTurn()) return;
    if (tool === 'move') {
      const hit = e.target.closest('.pawn-hit');
      if (hit) { pawnSelected = !pawnSelected; Sound.play('click'); render(); return; }
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (!pawnSelected) { pawnSelected = true; render(); return; }
      act({ type: 'move', r, c });
      return;
    }
    // Wall tools
    const s = slotFromPoint(e.clientX, e.clientY, tool);
    if (e.detail === 0 && pending) { confirmWall(); return; } // keyboard "click"
    if (lastPointer === 'mouse') {
      // With a mouse the hover preview *is* the preview; a click confirms it.
      act({ type: 'wall', ...s });
    } else if (pending && pending.r === s.r && pending.c === s.c && pending.o === s.o) {
      confirmWall();
    } else {
      pending = s; Sound.play('click'); render();
    }
  });

  el.grid.addEventListener('contextmenu', (e) => {
    if (tool === 'move' || !isHumanTurn()) return;
    e.preventDefault();
    flipWall();
  });

  function setTool(t) {
    if (!isHumanTurn()) return;
    if (t !== 'move' && game.wallsLeft[game.turn] === 0) { toast('No walls left'); Sound.play('invalid'); return; }
    tool = t; pending = null; hover = null; pawnSelected = true;
    Sound.play('click');
    render();
  }
  function flipWall() {
    if (tool === 'move') return;
    tool = tool === 'h' ? 'v' : 'h';
    if (pending) pending = { ...pending, o: tool };
    if (hover) hover = { ...hover, o: tool };
    render();
  }
  function confirmWall() { if (pending) act({ type: 'wall', ...pending }); }
  function cancelWall() { pending = null; hover = null; render(); }

  for (const k of ['move', 'h', 'v']) el.tools[k].addEventListener('click', () => setTool(k));
  $('btn-confirm-wall').addEventListener('click', confirmWall);
  $('btn-cancel-wall').addEventListener('click', cancelWall);
  el.undo.addEventListener('click', undo);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.game.classList.contains('chat-open') && el.overlay.hidden) { closeChat(); return; }
    if (!el.overlay.hidden) {
      if (e.key === 'Escape') { const d = currentDialog(); if (d && d.id !== 'dlg-win' && d.id !== 'dlg-lobby') closeDialog(false); }
      return;
    }
    if (el.game.hidden || e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'm') setTool('move');
    else if (k === 'h') setTool('h');
    else if (k === 'v') setTool('v');
    else if (k === ' ' && tool !== 'move') { e.preventDefault(); flipWall(); }
    else if (k === 'escape') cancelWall();
    else if (k === 'enter' && pending) { e.preventDefault(); confirmWall(); }
    else if (k.startsWith('arrow') && tool === 'move' && isHumanTurn()) {
      e.preventDefault();
      const d = { arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1] }[k];
      const me = game.pawns[game.turn];
      const moves = game.legalPawnMoves(game.turn);
      const pick = moves.find(m => m.r === me.r + d[0] && m.c === me.c + d[1])
        || moves.find(m => m.r === me.r + 2 * d[0] && m.c === me.c + 2 * d[1]);
      if (pick) act({ type: 'move', r: pick.r, c: pick.c }); else Sound.play('invalid');
    }
  });

  /* ================================================================ dialogs */
  let dialogResolve = null;
  function currentDialog() { return [...el.overlay.children].find(d => !d.hidden); }
  function openDialog(id) {
    for (const d of el.overlay.children) d.hidden = d.id !== id;
    el.overlay.hidden = false;
    const d = $(id);
    const focusable = d.querySelector('.dialog-actions .btn-primary') || d.querySelector('button');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  }
  function closeDialog(result) {
    el.overlay.hidden = true;
    for (const d of el.overlay.children) d.hidden = true;
    if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(!!result); }
  }
  function confirmBox(title, text, yesLabel, noLabel = 'Keep playing') {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel;
    $('confirm-no').textContent = noLabel || '';
    $('confirm-no').hidden = !noLabel;
    openDialog('dlg-confirm');
    return new Promise((res) => { dialogResolve = res; });
  }
  $('confirm-yes').addEventListener('click', () => closeDialog(true));
  $('confirm-no').addEventListener('click', () => closeDialog(false));
  el.overlay.addEventListener('click', (e) => {
    const id = currentDialog()?.id;
    if (e.target === el.overlay && id !== 'dlg-win' && id !== 'dlg-lobby') closeDialog(false);
  });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => closeDialog(false));

  const gameInProgress = () => !finished && game.moveCount > 0;

  el.restart.addEventListener('click', async () => {
    if (gameInProgress() && !(await confirmBox('Restart this game?', 'The board resets and this game won’t count on the scoreboard.', 'Restart'))) return;
    newGame();
  });
  $('btn-menu').addEventListener('click', async () => {
    if (mode === 'online' && !finished) {
      if (!(await confirmBox('Leave this online game?', 'The room closes and your friend is told you left.', 'Leave game'))) return;
    } else if (gameInProgress() && !(await confirmBox('Leave this game?', 'You’ll go back to the main menu and this game won’t be saved.', 'Leave game'))) return;
    showMenu();
  });
  $('win-again').addEventListener('click', () => {
    if (mode === 'online') {
      online.rematchSent = true;
      online.conn.send({ t: 'rematch' });
      $('win-again').disabled = true;
      $('win-again').textContent = 'Waiting for friend…';
      return;
    }
    closeDialog(); newGame();
  });
  $('win-menu').addEventListener('click', () => { closeDialog(); showMenu(); });

  /* ================================================================== menu */
  function showMenu() {
    if (mode === 'online') leaveOnline();
    token++; clearTimeout(aiTimer); aiThinking = false;
    clearInterval(clock.timer); stopConfetti();
    el.game.hidden = true; el.menu.hidden = false;
    renderMenu();
  }
  function startGame(m) {
    Sound.warm(); Sound.play('click');
    el.menu.hidden = true; el.game.hidden = false;
    newGame(m);
  }
  function renderMenu() {
    $('lvl-' + level).checked = true;
    $('level-note').textContent = LEVEL_NOTES[level];
  }
  for (const r of document.querySelectorAll('input[name="level"]')) {
    r.addEventListener('change', () => {
      level = r.value; prefs.level = level; savePrefs(); renderMenu(); Sound.play('click');
    });
  }
  $('btn-play-ai').addEventListener('click', () => startGame('ai'));
  $('btn-play-friend').addEventListener('click', () => startGame('friend'));
  $('btn-help').addEventListener('click', () => openDialog('dlg-help'));
  $('btn-stats').addEventListener('click', () => { renderStats(); openDialog('dlg-stats'); });
  $('btn-settings').addEventListener('click', () => { renderSettings(); openDialog('dlg-settings'); });

  /* ========================================================== online play */
  const OnlineAPI = window.CorridorsOnline;

  function ensureConnection() {
    if (online.conn) return online.conn;
    online.conn = new OnlineAPI.Connection({
      onStatus(st) {
        online.net = st;
        if (st === 'down' && mode === 'online' && !el.game.hidden) toast('Connection lost. Reconnecting…');
        if (!el.game.hidden && mode === 'online') render();
        if (online.lobby) $('lobby-status').textContent = st === 'open' ? 'Waiting for your friend…' : 'Reconnecting to the server…';
      },
      onMessage: handleServer,
    });
    return online.conn;
  }

  function openOnlineDialog() {
    if (!OnlineAPI.available()) {
      confirmBox('Online play needs the game server',
        'Start it with “npm start” (see README) and open the address it prints, such as http://localhost:3000. Opening index.html as a file only allows offline play.',
        'OK', null);
      return;
    }
    $('online-name').value = prefs.names[0] || '';
    $('online-error').textContent = '';
    $('join-code').value = '';
    openDialog('dlg-online');
    setTimeout(() => $('online-name').focus(), 40);
  }

  function myOnlineName() {
    const n = $('online-name').value.trim().slice(0, 16);
    if (n) { prefs.names[0] = n; savePrefs(); }
    return n;
  }

  $('btn-play-online').addEventListener('click', () => { Sound.warm(); Sound.play('click'); openOnlineDialog(); });
  $('btn-create-room').addEventListener('click', () => {
    $('online-error').textContent = '';
    $('btn-create-room').disabled = true;
    ensureConnection().send({ t: 'create', name: myOnlineName() || 'Red' });
  });
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('join-code').value.trim();
    if (!/^\d{5}$/.test(code)) { $('online-error').textContent = 'Enter the 5-digit code your friend sees.'; return; }
    $('online-error').textContent = '';
    $('btn-join-room').disabled = true;
    ensureConnection().send({ t: 'join', room: code, name: myOnlineName() || 'Blue' });
  });
  $('btn-copy-code').addEventListener('click', async () => {
    const code = online.room || '';
    try { await navigator.clipboard.writeText(code); $('copy-label').textContent = 'Copied'; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents($('room-code'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      $('copy-label').textContent = 'Selected, press Ctrl+C';
    }
    setTimeout(() => { $('copy-label').textContent = 'Copy code'; }, 1800);
  });
  $('btn-cancel-room').addEventListener('click', () => { leaveOnline(); closeDialog(); showMenuScreen(); });

  /** Send a local player's action to the server (the server echoes it back to both). */
  function sendOnline(action) {
    if (!onlineCanAct()) return false;
    const test = game.clone();
    if (!test.apply(action)) {
      Sound.play('invalid');
      toast(action.type === 'wall' ? (game.wallProblem(game.turn, action.r, action.c, action.o) || 'You can’t place a wall there') : 'You can’t move there');
      return false;
    }
    online.sending = true;
    hover = pending = null;
    online.conn.send({ t: 'action', action });
    render();
    // If the echo never comes (bad network), ask for the full state.
    const sentAt = game.moveCount;
    setTimeout(() => { if (online.sending && game.moveCount === sentAt) requestResync(); }, 5000);
    return true;
  }

  function requestResync() {
    online.sending = false;
    const s = OnlineAPI.session.get();
    if (online.conn && s) online.conn.send({ t: 'rejoin', room: s.room, token: s.token });
  }

  /** Load a full position from the server (join, reconnect, rematch). */
  function applyServerState(msg) {
    const wasFinished = finished;
    if (chat.room !== msg.room) { clearChat(); chat.room = msg.room; }
    online.me = msg.you; online.room = msg.room;
    online.names = msg.names; online.connected = msg.connected; online.ready = msg.ready;
    online.sending = false;
    game.restore(msg.snap);
    history = []; recent = [[], []];
    tool = 'move'; pawnSelected = true; hover = pending = null;
    finished = game.winner !== -1;
    for (const node of wallNodes.values()) node.remove();
    wallNodes.clear();
    // Line the match timer up with the server's clock.
    clearInterval(clock.timer);
    if (msg.startedAt) {
      clock.start = Date.now() - (msg.serverNow - msg.startedAt);
      clock.end = finished ? Date.now() : 0;
      if (!finished) clock.timer = setInterval(tickClock, 1000);
    } else { clock.start = Date.now(); clock.end = Date.now(); }
    tickClock();
    if (wasFinished && !finished) { stopConfetti(); if (currentDialog()?.id === 'dlg-win') closeDialog(); }
  }

  function enterOnlineGame() {
    mode = 'online';
    online.lobby = false;
    el.menu.hidden = true; el.game.hidden = false;
    updateModeLabels();
    render();
  }

  function handleServer(msg) {
    switch (msg.t) {
      case 'created':
        online.me = 0; online.room = msg.room; online.lobby = true;
        $('btn-create-room').disabled = false;
        $('room-code').textContent = msg.room;
        $('lobby-status').textContent = 'Waiting for your friend…';
        openDialog('dlg-lobby');
        break;
      case 'joined':
      case 'rejoined':
        $('btn-join-room').disabled = false;
        online.me = msg.you; online.room = msg.room;
        break;
      case 'state': {
        applyServerState(msg);
        if (!msg.ready) {               // creator still waiting in the lobby
          if (!online.lobby) { online.lobby = true; $('room-code').textContent = msg.room; openDialog('dlg-lobby'); }
          break;
        }
        const inLobby = online.lobby || currentDialog()?.id === 'dlg-online';
        if (inLobby) closeDialog();
        if (el.game.hidden || mode !== 'online') enterOnlineGame();
        else { updateModeLabels(); render(); }
        if (inLobby) {
          Sound.play('click');
          toast(online.me === 0 ? `${playerName(1)} joined. You move first.` : `You joined ${playerName(0)}’s room. ${playerName(0)} moves first.`);
        }
        if (finished && currentDialog()?.id !== 'dlg-win') showWinDialog();
        break;
      }
      case 'action': {
        online.sending = false;
        if (msg.moveCount !== game.moveCount + 1) { requestResync(); break; }
        act(msg.action, { remote: true });
        break;
      }
      case 'chat':
        onChat(msg);
        break;
      case 'notice':
        if (msg.kind === 'away') chatSys(`${msg.name} lost connection`);
        else if (msg.kind === 'back') chatSys(`${msg.name} is back`);
        else if (msg.kind === 'rematch') chatSys('New game started');
        if (msg.kind === 'away') toast(`${msg.name} lost connection. Waiting for them to come back…`);
        else if (msg.kind === 'back') toast(`${msg.name} is back.`);
        else if (msg.kind === 'rematch-offer') {
          toast(`${msg.name} wants a rematch.`);
          if (currentDialog()?.id === 'dlg-win' && !online.rematchSent) $('win-text').textContent = `${msg.name} wants a rematch. Tap Rematch to start.`;
        } else if (msg.kind === 'rematch') toast('New game. Red moves first.');
        if (!el.game.hidden) render();
        break;
      case 'closed':
        online.ready = false;
        if (mode === 'online' || online.lobby) {
          const was = online.lobby;
          resetOnline();
          showMenuScreen();
          confirmBox(was ? 'Room closed' : 'Game ended', msg.reason || 'The room was closed.', 'OK', null);
        }
        break;
      case 'error':
        $('btn-create-room').disabled = false;
        $('btn-join-room').disabled = false;
        if (currentDialog()?.id === 'dlg-online') { $('online-error').textContent = msg.message; break; }
        if (msg.code === 'gone') {
          resetOnline();
          if (mode === 'online') { showMenuScreen(); confirmBox('Game ended', 'That online game is no longer available.', 'OK', null); }
          break;
        }
        if (mode === 'online') { online.sending = false; toast(msg.message); render(); }
        break;
    }
  }

  function resetOnline() {
    clearChat(); chat.room = null; closeChat();
    if (online.conn) { online.conn.close(); online.conn = null; }
    Object.assign(online, { me: -1, room: null, ready: false, sending: false, net: 'idle', lobby: false, rematchSent: false, connected: [false, false] });
  }
  function leaveOnline() { resetOnline(); }

  /** Show the menu without the "leave game" side effects. */
  function showMenuScreen() {
    token++; clearTimeout(aiTimer); aiThinking = false;
    clearInterval(clock.timer); stopConfetti();
    if (mode === 'online') mode = 'friend';
    el.game.hidden = true; el.menu.hidden = false;
    renderMenu();
  }

  /* ================================================================== chat */
  // Online only. Text and emoji go through the server, which checks length,
  // the emoji list and a rate limit, then sends them to both players.
  const QUICK_MESSAGES = ['Nice move!', 'Good game', 'Your turn!', 'Hurry up!', 'Wow!', 'Rematch?', 'Thinking…', 'Oops!'];
  const CHAT_EMOJIS = ['👍', '😂', '😮', '😡', '🔥', '❤️', '👏', '😎'];
  const chat = { room: null, unread: 0, count: 0 };
  const ch = {
    panel: $('chat'), log: $('chat-log'), quick: $('chat-quick'), emojis: $('chat-emojis'),
    form: $('chat-form'), input: $('chat-input'), send: $('chat-send'), mute: $('chat-mute'),
    close: $('chat-close'), fab: $('chat-fab'), badge: $('chat-badge'),
  };
  const phoneLayout = () => window.matchMedia('(max-width: 900px)').matches;
  const chatOpen = () => el.game.classList.contains('chat-open');
  const chatVisible = () => !ch.panel.hidden && !el.game.hidden && (!phoneLayout() || chatOpen());
  const canChat = () => mode === 'online' && online.ready && online.net === 'open';

  for (const text of QUICK_MESSAGES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip-btn'; b.textContent = text;
    b.addEventListener('click', () => sendChat(text));
    ch.quick.appendChild(b);
  }
  for (const e of CHAT_EMOJIS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'emoji-btn'; b.textContent = e;
    b.setAttribute('aria-label', 'Send ' + e);
    b.addEventListener('click', () => sendEmoji(e));
    ch.emojis.appendChild(b);
  }

  /** Show or hide the chat panel, floating button and badge for the current state. */
  function renderChatChrome() {
    const on = mode === 'online' && online.ready && !el.game.hidden;
    ch.panel.hidden = !on;
    el.game.classList.toggle('has-chat', on);
    document.querySelector('.table').classList.toggle('has-chat', on);
    if (!on) el.game.classList.remove('chat-open');
    ch.fab.hidden = !on || !phoneLayout() || chatOpen();
    if (chatVisible() && chat.unread) chat.unread = 0;
    ch.badge.hidden = chat.unread === 0;
    ch.badge.textContent = chat.unread > 9 ? '9+' : String(chat.unread);
    ch.fab.setAttribute('aria-label', chat.unread ? `Open chat, ${chat.unread} new` : 'Open chat');
    const ok = canChat();
    for (const b of ch.panel.querySelectorAll('button.chip-btn, button.emoji-btn, .chat-send')) b.disabled = !ok;
    ch.input.disabled = !ok;
    ch.input.placeholder = ok ? 'Type a message…' : 'Reconnecting…';
    ch.mute.setAttribute('aria-pressed', prefs.chatMute);
    ch.mute.setAttribute('aria-label', prefs.chatMute ? 'Turn chat sounds on' : 'Mute chat sounds');
    if (!chat.count && !ch.log.querySelector('.chat-empty')) {
      const li = document.createElement('li');
      li.className = 'chat-empty';
      li.textContent = 'Say hi, or tap a quick message below.';
      ch.log.appendChild(li);
    }
  }

  function openChat() {
    el.game.classList.add('chat-open');
    chat.unread = 0;
    renderChatChrome();
    scrollChat();
  }
  function closeChat() {
    el.game.classList.remove('chat-open');
    if (!el.game.hidden) renderChatChrome();
  }
  ch.fab.addEventListener('click', () => { Sound.play('click'); openChat(); });
  ch.close.addEventListener('click', closeChat);
  ch.mute.addEventListener('click', () => { prefs.chatMute = !prefs.chatMute; savePrefs(); renderChatChrome(); });
  window.addEventListener('resize', () => { if (!el.game.hidden) renderChatChrome(); });
  // Tap on the board area closes the phone chat sheet.
  el.grid.addEventListener('pointerdown', () => { if (chatOpen()) closeChat(); });

  ch.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ch.input.value.trim();
    if (!text) { ch.input.focus(); return; }
    if (sendChat(text)) ch.input.value = '';
  });

  function sendChat(text) {
    if (!canChat()) { toast('Chat is available once you’re connected to your friend.'); return false; }
    online.conn.send({ t: 'chat', text: text.slice(0, 120) });
    return true;
  }
  function sendEmoji(e) {
    if (!canChat()) { toast('Chat is available once you’re connected to your friend.'); return; }
    online.conn.send({ t: 'emoji', e });
  }

  /** A chat message arrived from the server (ours or our friend's). */
  function onChat(msg) {
    const mine = msg.by === online.me;
    const empty = ch.log.querySelector('.chat-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.className = 'chat-msg' + (mine ? ' mine' : '') + (msg.kind === 'emoji' ? ' emoji' : '');
    li.dataset.p = msg.by;
    if (!mine && msg.kind === 'text') {
      const who = document.createElement('span');
      who.className = 'who'; who.textContent = msg.name;
      li.appendChild(who);
    }
    li.appendChild(document.createTextNode(msg.text));    // always plain text, never HTML
    li.setAttribute('aria-label', `${mine ? 'You' : msg.name}: ${msg.text}`);
    ch.log.appendChild(li);
    chat.count++;
    while (ch.log.children.length > 120) ch.log.firstElementChild.remove();
    scrollChat();

    if (msg.kind === 'emoji') popEmoji(msg.by, msg.text);
    if (!mine) {
      if (!chatVisible()) {
        chat.unread++;
        if (msg.kind === 'text') cardBubble(msg.by, msg.text);
      }
      if (!prefs.chatMute) Sound.play('chat');
      if (navigator.vibrate && phoneLayout() && !chatVisible()) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
    }
    renderChatChrome();
  }

  function chatSys(text) {
    if (mode !== 'online') return;
    const empty = ch.log.querySelector('.chat-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.className = 'chat-sys'; li.textContent = text;
    ch.log.appendChild(li); chat.count++;
    scrollChat();
  }
  function clearChat() { ch.log.innerHTML = ''; chat.count = 0; chat.unread = 0; }
  function scrollChat() { ch.log.scrollTop = ch.log.scrollHeight; }

  /** Emoji bubble that floats up from the sender's pawn. */
  function popEmoji(p, e) {
    const pos = pawns[p];
    if (!pos) return;
    const node = document.createElement('div');
    node.className = 'emoji-pop';
    node.textContent = e;
    node.style.left = pos.style.left; node.style.top = pos.style.top;
    el.grid.appendChild(node);
    setTimeout(() => node.remove(), 2700);
  }
  /** Short preview of a text message next to the sender's card, for when the chat is closed. */
  function cardBubble(p, text) {
    const card = el.cards[p];
    card.querySelector('.card-bubble')?.remove();
    const b = document.createElement('div');
    b.className = 'card-bubble';
    b.textContent = text;
    card.appendChild(b);
    setTimeout(() => b.remove(), 3500);
  }

  /* ============================================================= scoreboard */
  function loadStats() { return store.get('matches', []); }
  function recordMatch() {
    const matches = loadStats();
    matches.unshift({
      ts: Date.now(), mode, level: mode === 'ai' ? level : null,
      winner: game.winner, names: [playerName(0), playerName(1)], colors: prefs.colors.slice(),
      moves: game.moveCount, secs: Math.round(elapsed()),
      walls: [10 - game.wallsLeft[0], 10 - game.wallsLeft[1]],
    });
    store.set('matches', matches.slice(0, 100));
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  function renderStats() {
    const m = loadStats();
    const body = $('stats-body');
    if (!m.length) {
      body.innerHTML = '<p class="empty-note">No finished games yet. Win or lose one and it shows up here.</p>';
      $('btn-reset-stats').hidden = true;
      return;
    }
    $('btn-reset-stats').hidden = false;
    const ai = m.filter(x => x.mode === 'ai'), friend = m.filter(x => x.mode !== 'ai');
    const rec = (lvl) => {
      const g = ai.filter(x => x.level === lvl);
      return { w: g.filter(x => x.winner === 0).length, l: g.filter(x => x.winner === 1).length };
    };
    const avgMoves = Math.round(m.reduce((a, x) => a + x.moves, 0) / m.length);
    // Wins per name in friend games
    const byName = {};
    for (const x of friend) { const n = x.names[x.winner]; byName[n] = (byName[n] || 0) + 1; }
    const leaders = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 5);

    let html = `<dl class="score-summary">
      <div><dt>Games played</dt><dd>${m.length}</dd></div>
      ${['easy', 'medium', 'hard'].map(l => { const r = rec(l); return `<div><dt>You vs ${LEVEL_NAMES[l]}</dt><dd>${r.w}–${r.l}</dd></div>`; }).join('')}
      <div><dt>Average moves</dt><dd>${avgMoves}</dd></div>
    </dl>`;
    if (leaders.length) {
      html += `<h3>Friend games: most wins</h3><div class="table-scroll"><table class="record"><thead><tr><th>Player</th><th>Wins</th></tr></thead><tbody>
        ${leaders.map(([n, w]) => `<tr><td>${esc(n)}</td><td>${w}</td></tr>`).join('')}</tbody></table></div>`;
    }
    html += `<h3>Recent games</h3><div class="table-scroll"><table class="record"><thead><tr>
      <th>Date</th><th>Winner</th><th>Opponent</th><th>Mode</th><th>Moves</th><th>Time</th></tr></thead><tbody>
      ${m.slice(0, 12).map(x => {
        const d = new Date(x.ts);
        const loser = 1 - x.winner;
        return `<tr><td>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
          <td><span class="dot" style="background:${esc(x.colors[x.winner])}"></span>${esc(x.names[x.winner])}</td>
          <td>${esc(x.names[loser])}</td>
          <td>${x.mode === 'ai' ? LEVEL_NAMES[x.level] + ' AI' : x.mode === 'online' ? 'Online' : 'Friend'}</td>
          <td>${x.moves}</td><td>${fmtTime(x.secs)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    body.innerHTML = html;
  }
  $('btn-reset-stats').addEventListener('click', async () => {
    if (await confirmBox('Clear the scoreboard?', 'Every saved result on this device is deleted. This can’t be undone.', 'Clear history', 'Keep it')) {
      store.set('matches', []);
    }
    renderStats(); openDialog('dlg-stats');
  });

  /* =============================================================== settings */
  function applyColors() {
    root.style.setProperty('--p0', prefs.colors[0]);
    root.style.setProperty('--p1', prefs.colors[1]);
  }
  function resolvedTheme() {
    if (prefs.theme !== 'system') return prefs.theme;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    const r = resolvedTheme();
    root.setAttribute('data-resolved', r);
    el.theme.setAttribute('aria-label', r === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  function applySound() {
    el.sound.setAttribute('aria-pressed', prefs.sound);
    el.sound.setAttribute('aria-label', prefs.sound ? 'Mute sound' : 'Turn sound on');
  }
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(applyTheme);
  }
  el.theme.addEventListener('click', () => {
    prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    savePrefs(); applyTheme(); Sound.play('click');
  });
  el.sound.addEventListener('click', () => {
    prefs.sound = !prefs.sound; savePrefs(); applySound();
    Sound.warm(); Sound.play('click');
  });

  function renderSettings() {
    for (let p = 0; p < 2; p++) {
      const input = $('set-name-' + p);
      input.value = prefs.names[p];
      input.placeholder = colorName(prefs.colors[p]);
      const wrap = $('swatches-' + p);
      wrap.innerHTML = '';
      for (const col of PALETTE) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch'; b.style.setProperty('--sw', col.hex);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', prefs.colors[p] === col.hex);
        b.setAttribute('aria-label', col.name);
        b.title = col.name;
        b.disabled = prefs.colors[1 - p] === col.hex; // both players can't share a colour
        b.addEventListener('click', () => {
          prefs.colors[p] = col.hex; savePrefs(); applyColors(); renderSettings();
          if (!el.game.hidden) render();
        });
        wrap.appendChild(b);
      }
    }
    $('theme-' + prefs.theme).checked = true;
    $('set-sound').checked = prefs.sound;
    $('set-hints').checked = prefs.hints;
  }
  for (let p = 0; p < 2; p++) {
    $('set-name-' + p).addEventListener('input', (e) => {
      prefs.names[p] = e.target.value.slice(0, 16); savePrefs();
      if (!el.game.hidden) renderPanels();
    });
  }
  for (const r of document.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => { prefs.theme = r.value; savePrefs(); applyTheme(); });
  }
  $('set-sound').addEventListener('change', (e) => { prefs.sound = e.target.checked; savePrefs(); applySound(); });
  $('set-hints').addEventListener('change', (e) => { prefs.hints = e.target.checked; savePrefs(); if (!el.game.hidden) render(); });
  $('settings-form').addEventListener('submit', (e) => e.preventDefault());

  /* =============================================================== confetti */
  let confettiRaf = 0;
  function startConfetti(color) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = el.confetti, ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = [color, color, '#f5c542', '#ffffff', '#f2e7d1'];
    const parts = Array.from({ length: 170 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
      col: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    cancelAnimationFrame(confettiRaf);
    const step = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const q of parts) {
        q.vy += 0.42; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.a += q.va;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a);
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 2.2) / 0.8);
        ctx.fillStyle = q.col; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.a * 2)) + 1);
        ctx.restore();
      }
      if (t < 3) confettiRaf = requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    confettiRaf = requestAnimationFrame(step);
  }
  function stopConfetti() {
    cancelAnimationFrame(confettiRaf);
    const ctx = el.confetti.getContext('2d');
    ctx.clearRect(0, 0, el.confetti.width, el.confetti.height);
  }

  /* ================================================================== start */
  applyColors(); applyTheme(); applySound();
  buildBoard(); buildMiniBoard(); renderMenu();
  render();

  // Refreshed the page in the middle of an online game? Put the player back in.
  if (OnlineAPI && OnlineAPI.available() && OnlineAPI.session.get()) ensureConnection().open();

  // Small hook for automated tests (harmless in normal play).
  window.__corridors = {
    get game() { return game; }, get mode() { return mode; }, get level() { return level; },
    get aiThinking() { return aiThinking; }, get finished() { return finished; },
    get online() { return online; }, get chat() { return chat; },
    act, undo, newGame, setTool, startGame,
  };
})();
