/* ==========================================================================
   script.js — Tic-Tac-Toe user interface
   Menu, board, input (mouse/touch/keyboard), computer timing, undo, sounds,
   themes, running score and a saved scoreboard. Rules live in game.js, the
   computer's choices in ai.js.
   ========================================================================== */
(() => {
  'use strict';
  const { TTTState } = window.TicTacToe;
  const AI = window.TicTacToeAI;

  /* storage */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ttt.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ttt.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const prefs = Object.assign({ theme: 'system', sound: true, level: 'medium', humanIsO: false, chatMute: false, name: '', boardSize: 3 }, store.get('prefs', {}));
  const savePrefs = () => store.set('prefs', prefs);

  const LEVEL_NOTES = {
    easy: 'Plays loosely and often lets a win slip by.',
    medium: 'Takes a win, blocks yours, slips now and then.',
    hard: 'Plays perfectly — the best you can get is a draw.',
  };
  const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  /* sound */
  const Sound = {
    files: { markx: 'assets/sounds/markx.wav', marko: 'assets/sounds/marko.wav', win: 'assets/sounds/win.wav', draw: 'assets/sounds/draw.wav', click: 'assets/sounds/click.wav', chat: 'assets/sounds/chat.wav' },
    pool: {}, ctx: null,
    warm() { for (const k in this.files) { if (this.pool[k]) continue; try { const a = new Audio(this.files[k]); a.preload = 'auto'; this.pool[k] = a; } catch (e) { /* ignore */ } } },
    play(name) {
      if (!prefs.sound) return;
      const base = this.pool[name];
      if (!base) return this.synth(name);
      try { const a = base.cloneNode(); a.volume = name === 'click' ? 0.35 : 0.7; const p = a.play(); if (p && p.catch) p.catch(() => this.synth(name)); }
      catch (e) { this.synth(name); }
    },
    synth(name) {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        const ctx = this.ctx, t = ctx.currentTime;
        const tones = { markx: [[420, .09]], marko: [[560, .09]], click: [[1200, .03]], chat: [[1318, .1], [1760, .15]], draw: [[330, .12], [330, .12]], win: [[523, .12], [659, .12], [784, .12], [1046, .25]] }[name] || [];
        let at = t;
        for (const [f, d] of tones) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.2, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + d); o.start(at); o.stop(at + d + 0.02); at += d * 0.9; }
      } catch (e) { /* ignore */ }
    },
  };

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const el = {
    menu: $('menu'), game: $('game'), grid: $('grid'),
    status: $('status'), statusText: $('status-text'), statusMark: $('status-mark'),
    mini: $('mini-board'), modeChip: $('mode-chip'), hint: $('tool-hint'),
    undo: $('btn-undo'), restart: $('btn-restart'), sound: $('btn-sound'), theme: $('btn-theme'),
    toast: $('toast'), overlay: $('overlay'), confetti: $('confetti'),
    names: [$('name-0'), $('name-1')], wins: [$('wins-0'), $('wins-1')], draws: $('draws'),
    scoreCards: [$('score-x'), $('score-o')],
  };

  /* state */
  let boardSize = prefs.boardSize === 5 ? 5 : 3;
  let game = new TTTState(boardSize);
  let mode = 'friend';          // 'friend' | 'ai' | 'online'
  let level = prefs.level;
  let humanPlayer = 0;          // which mark the human controls in AI mode (0=X, 1=O)
  let history = [];
  let aiThinking = false, aiTimer = null, token = 0, finished = false;
  let session = { wins: [0, 0], draws: 0 };   // running score for this sitting
  const cells = [];
  let builtSize = 0;
  // Online play (see online.js / server.js). mode can be 'friend' | 'ai' | 'online'.
  const online = { conn: null, me: -1, room: null, names: ['X', 'O'], connected: [false, false], ready: false, sending: false, net: 'idle', rematchSent: false, lobby: false };

  /* build */
  function buildBoard(n) {
    el.grid.innerHTML = ''; cells.length = 0;
    el.grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    el.grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
    el.grid.classList.toggle('n5', n >= 5);
    el.grid.setAttribute('aria-label', `${n} by ${n} board`);
    for (let i = 0; i < n * n; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.dataset.i = i; b.setAttribute('aria-label', `Square ${i + 1}`);
      el.grid.appendChild(b); cells[i] = b;
    }
    builtSize = n;
  }
  function ensureBoard() { if (builtSize !== game.size) buildBoard(game.size); }
  function buildMini() {
    const g = document.createElement('div'); g.className = 'grid';
    const marks = { 0: 'x', 4: 'o', 8: 'x', 2: 'o', 6: 'x' };
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('div'); c.className = 'cell';
      if (marks[i]) { const m = document.createElement('span'); m.className = 'm ' + (marks[i] === 'x' ? 'x-mark' : 'o-mark'); c.appendChild(m); }
      g.appendChild(c);
    }
    el.mini.appendChild(g);
  }

  const markName = (p) => (p === 0 ? 'X' : 'O');
  function playerLabel(p) {
    if (mode === 'ai') return p === humanPlayer ? 'You' : 'Computer';
    if (mode === 'online') return online.names[p] || markName(p);
    return markName(p);
  }
  const onlineCanAct = () => online.ready && online.net === 'open' && online.connected[0] && online.connected[1] && game.turn === online.me && !online.sending;
  const isHumanTurn = () => !finished && !aiThinking && (mode === 'friend' || (mode === 'ai' && game.turn === humanPlayer) || (mode === 'online' && onlineCanAct()));
  function onlineStatus() {
    const other = 1 - online.me;
    if (online.net !== 'open') return 'Reconnecting…';
    if (!online.ready) return 'Waiting for your friend to join';
    if (!online.connected[other]) return `${playerLabel(other)} is offline. Waiting…`;
    if (online.sending) return 'Sending your move…';
    return game.turn === online.me ? 'Your move' : `Waiting for ${playerLabel(other)}…`;
  }

  let toastTimer = null;
  function toast(msg) { el.toast.textContent = msg; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800); }

  /* render */
  function render(opts = {}) {
    ensureBoard();
    const p = game.turn;
    root.style.setProperty('--turn-color', `var(--${p === 0 ? 'x' : 'o'})`);
    const winColor = game.winner === 0 ? 'var(--x)' : game.winner === 1 ? 'var(--o)' : 'transparent';
    root.style.setProperty('--win-color', winColor);

    for (let i = 0; i < cells.length; i++) {
      const b = cells[i], v = game.cells[i];
      const want = v === 0 ? '' : v === 1 ? 'x' : 'o';
      const has = b.firstChild ? (b.firstChild.classList.contains('x-mark') ? 'x' : 'o') : '';
      if (want !== has) {
        b.innerHTML = '';
        if (want) { const m = document.createElement('span'); m.className = 'm ' + (want === 'x' ? 'x-mark' : 'o-mark'); if (opts.fresh === i) m.style.animationDelay = '0s'; else if (!opts.animateAll) m.style.animation = 'none'; b.appendChild(m); }
      }
      const inWin = game.winLine && game.winLine.includes(i);
      b.classList.toggle('win', !!inWin);
      if (b.firstChild) b.firstChild.classList.toggle('win-mark', !!inWin);
      const playable = isHumanTurn() && v === 0;
      b.classList.toggle('playable', playable);
      b.disabled = !playable;
    }

    // Status
    el.statusMark.className = 'status-mark ' + (finished ? '' : (p === 0 ? 'x' : 'o'));
    el.status.classList.toggle('thinking', aiThinking || (mode === 'online' && !finished && !onlineCanAct()));
    if (finished) {
      el.statusMark.className = 'status-mark';
      if (game.winner === 2) el.statusText.textContent = 'Draw';
      else if (mode === 'ai') el.statusText.textContent = game.winner === humanPlayer ? 'You win!' : 'Computer wins';
      else if (mode === 'online') el.statusText.textContent = game.winner === online.me ? 'You win!' : `${playerLabel(game.winner)} wins`;
      else el.statusText.textContent = `${markName(game.winner)} wins!`;
    } else if (aiThinking) {
      el.statusText.textContent = 'Computer is thinking…';
    } else if (mode === 'online') {
      el.statusText.textContent = onlineStatus();
    } else {
      el.statusText.textContent = mode === 'ai' ? (isHumanTurn() ? 'Your move' : '…') : `${markName(p)} to move`;
    }

    for (let i = 0; i < 2; i++) el.scoreCards[i].classList.toggle('is-turn', !finished && p === i);

    if (mode === 'online') {
      el.names[0].textContent = online.me === 0 ? `${playerLabel(0)} (you)` : playerLabel(0);
      el.names[1].textContent = online.me === 1 ? `${playerLabel(1)} (you)` : playerLabel(1);
    } else {
      el.names[0].textContent = mode === 'ai' ? (humanPlayer === 0 ? 'You (X)' : 'Computer (X)') : 'X';
      el.names[1].textContent = mode === 'ai' ? (humanPlayer === 1 ? 'You (O)' : 'Computer (O)') : 'O';
    }
    el.wins[0].textContent = session.wins[0]; el.wins[1].textContent = session.wins[1]; el.draws.textContent = session.draws;

    el.undo.hidden = mode === 'online';
    el.restart.hidden = mode === 'online';
    el.undo.disabled = finished || history.length === 0 || (!isHumanTurn() && mode === 'ai' && !finished);
    if (finished) el.hint.textContent = mode === 'online' ? 'Round over. Tap Rematch to play again.' : 'Round over. Start a new round below.';
    else if (mode === 'online') el.hint.textContent = !onlineCanAct() ? (online.net !== 'open' ? 'Your connection dropped. Reconnecting…' : 'Waiting for your friend’s move…') : 'Tap an empty square to place your mark.';
    else if (!isHumanTurn()) el.hint.textContent = 'Wait for the computer…';
    else el.hint.textContent = mode === 'ai' ? 'Tap an empty square to place your mark.' : `${markName(p)}, tap an empty square.`;

    renderChatChrome();
  }

  /* flow */
  function newRound(keepScore) {
    token++; clearTimeout(aiTimer); aiThinking = false;
    game = new TTTState(boardSize); history = []; finished = false;
    if (!keepScore) session = { wins: [0, 0], draws: 0 };
    stopConfetti();
    const sizeTag = boardSize === 5 ? ' · 5×5' : '';
    el.modeChip.textContent = (mode === 'ai' ? `vs computer · ${LEVEL_NAMES[level]}` : 'Two players') + sizeTag;
    render({ animateAll: false });
    if (mode === 'ai' && game.turn !== humanPlayer) scheduleAI();
  }

  function place(i) {
    if (mode === 'online') { sendOnline(i); return; }
    if (!isHumanTurn() || !game.isLegal(i)) { if (!game.isLegal(i) && game.winner === -1) { Sound.play('click'); } return; }
    doPlay(i);
    if (!finished && mode === 'ai' && game.turn !== humanPlayer) scheduleAI();
  }

  function doPlay(i, remote) {
    if (!game.isLegal(i)) { if (remote) requestResync(); return; }
    if (!remote) history.push(game.snapshot());
    const p = game.turn;
    game.play(i);
    Sound.play(p === 0 ? 'markx' : 'marko');
    render({ fresh: i });
    if (game.winner !== -1) finish();
  }

  function scheduleAI() {
    aiThinking = true; render();
    const my = token;
    aiTimer = setTimeout(() => {
      if (my !== token) return;
      const move = AI.chooseMove(game, game.turn, level);
      aiThinking = false;
      if (my !== token) return;
      if (game.isLegal(move)) doPlay(move);
      else { const a = game.available(); if (a.length) doPlay(a[0]); }
    }, 420 + Math.random() * 320);
  }

  function undo() {
    if (finished || !history.length) return;
    token++; clearTimeout(aiTimer); aiThinking = false;
    let snap = history.pop();
    // In AI mode step back past the computer's move too, to the player's turn.
    if (mode === 'ai' && snap.turn !== humanPlayer && history.length) snap = history.pop();
    game.restore(snap); finished = false;
    Sound.play('click'); render();
  }

  function finish() {
    finished = true; online.sending = false;
    if (game.winner === 2) { session.draws++; Sound.play('draw'); }
    else { session.wins[game.winner]++; Sound.play('win'); startConfetti(game.winner === 0 ? '#d62839' : '#1d63d8'); }
    recordMatch();
    render();
    setTimeout(showWin, 650);
  }

  function showWin() {
    if (!finished) return;
    const w = game.winner;
    $('win-mark').className = 'win-mark ' + (w === 2 ? 'draw' : w === 0 ? 'x' : 'o');
    online.rematchSent = false;
    $('win-again').disabled = false;
    $('win-again').textContent = mode === 'online' ? 'Rematch' : 'Play again';
    const row = `${game.win} in a row`;
    if (w === 2) { $('win-title').textContent = 'It’s a draw'; $('win-text').textContent = `Nobody got ${row}.`; }
    else if (mode === 'ai') { $('win-title').textContent = w === humanPlayer ? 'You win!' : 'Computer wins'; $('win-text').textContent = w === humanPlayer ? `${row} — nicely done.` : `It lined up ${row}. Try again?`; }
    else if (mode === 'online') { $('win-title').textContent = w === online.me ? 'You win!' : `${playerLabel(w)} wins`; $('win-text').textContent = w === online.me ? `${row} — nicely done.` : `Your friend lined up ${row}.`; }
    else { $('win-title').textContent = `${markName(w)} wins`; $('win-text').textContent = `${row}.`; }
    openDialog('dlg-win');
  }

  /* input */
  el.grid.addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (!c) return; Sound.warm(); place(+c.dataset.i); });
  el.undo.addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.game.classList.contains('chat-open') && el.overlay.hidden) { closeChat(); return; }
    if (!el.overlay.hidden) { if (e.key === 'Escape') { const d = currentDialog(); if (d && d.id !== 'dlg-win' && d.id !== 'dlg-lobby') closeDialog(); } return; }
    if (el.game.hidden || e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k >= '1' && k <= '9' && game.size === 3) { Sound.warm(); place(+k - 1); }
    else if (k === 'n') askRestart();
  });

  /* dialogs */
  let dialogResolve = null;
  const currentDialog = () => [...el.overlay.children].find(d => !d.hidden);
  function openDialog(id) { for (const d of el.overlay.children) d.hidden = d.id !== id; el.overlay.hidden = false; const d = $(id); const f = d.querySelector('.dialog-actions .btn-primary') || d.querySelector('button'); if (f) setTimeout(() => f.focus(), 30); }
  function closeDialog(result) { el.overlay.hidden = true; for (const d of el.overlay.children) d.hidden = true; if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(!!result); } }
  function confirmBox(title, text, yes, no) { $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-yes').textContent = yes; $('confirm-no').textContent = no || 'Keep playing'; $('confirm-no').hidden = !no && no !== undefined ? false : false; openDialog('dlg-confirm'); return new Promise(r => { dialogResolve = r; }); }
  $('confirm-yes').addEventListener('click', () => closeDialog(true));
  $('confirm-no').addEventListener('click', () => closeDialog(false));
  el.overlay.addEventListener('click', (e) => { const id = currentDialog()?.id; if (e.target === el.overlay && id !== 'dlg-win' && id !== 'dlg-lobby') closeDialog(false); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => closeDialog(false));

  const inProgress = () => !finished && game.moveCount > 0;
  async function askRestart() { if (inProgress() && !(await confirmBox('Start a new round?', 'The current board will be cleared.', 'New round'))) return; newRound(true); }
  el.restart.addEventListener('click', askRestart);
  $('btn-menu').addEventListener('click', async () => {
    if (mode === 'online' && !finished) { if (!(await confirmBox('Leave this online game?', 'The room closes and your friend is told you left.', 'Leave game'))) return; }
    else if (inProgress() && !(await confirmBox('Leave this game?', 'You’ll go back to the main menu.', 'Leave game'))) return;
    showMenu();
  });
  $('win-again').addEventListener('click', () => {
    if (mode === 'online') { online.rematchSent = true; online.conn.send({ t: 'rematch' }); $('win-again').disabled = true; $('win-again').textContent = 'Waiting for friend…'; return; }
    closeDialog(); newRound(true);
  });
  $('win-menu').addEventListener('click', () => { closeDialog(); showMenu(); });

  /* menu */
  function showMenu() { if (mode === 'online') leaveOnline(); token++; clearTimeout(aiTimer); aiThinking = false; stopConfetti(); if (mode === 'online') mode = 'friend'; el.game.hidden = true; el.menu.hidden = false; renderMenu(); }
  function startGame(m) { Sound.warm(); Sound.play('click'); mode = m; humanPlayer = (m === 'ai' && prefs.humanIsO) ? 1 : 0; el.menu.hidden = true; el.game.hidden = false; newRound(false); }
  function renderMenu() {
    $('lvl-' + level).checked = true; $('level-note').textContent = LEVEL_NOTES[level]; $('play-o').checked = prefs.humanIsO;
    $('size-' + boardSize).checked = true;
    $('size-note').textContent = boardSize === 5 ? '5 × 5 — get four in a row to win.' : 'Classic — get three in a row.';
  }
  for (const r of document.querySelectorAll('input[name="level"]')) r.addEventListener('change', () => { level = r.value; prefs.level = level; savePrefs(); renderMenu(); Sound.play('click'); });
  for (const r of document.querySelectorAll('input[name="size"]')) r.addEventListener('change', () => { boardSize = +r.value === 5 ? 5 : 3; prefs.boardSize = boardSize; savePrefs(); renderMenu(); Sound.play('click'); });
  $('play-o').addEventListener('change', (e) => { prefs.humanIsO = e.target.checked; savePrefs(); });
  $('btn-play-ai').addEventListener('click', () => startGame('ai'));
  $('btn-play-friend').addEventListener('click', () => startGame('friend'));
  $('btn-play-online').addEventListener('click', () => { Sound.warm(); Sound.play('click'); openOnlineDialog(); });
  $('btn-help').addEventListener('click', () => openDialog('dlg-help'));
  $('btn-stats').addEventListener('click', () => { renderStats(); openDialog('dlg-stats'); });

  /* ========================================================= online play */
  const OnlineAPI = window.TTTOnline;

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
      confirmBox('Online play needs the game server', 'Start it with “npm start” (see README) and open the address it prints, such as http://localhost:3000. Opening the file directly only allows offline play.', 'OK', null);
      return;
    }
    $('online-name').value = prefs.name || '';
    $('online-error').textContent = ''; $('join-code').value = '';
    openDialog('dlg-online');
    setTimeout(() => $('online-name').focus(), 40);
  }
  function myOnlineName() { const n = $('online-name').value.trim().slice(0, 16); if (n) { prefs.name = n; savePrefs(); } return n; }

  $('btn-create-room').addEventListener('click', () => { $('online-error').textContent = ''; $('btn-create-room').disabled = true; ensureConnection().send({ t: 'create', game: 'tictactoe', size: boardSize, name: myOnlineName() || 'X' }); });
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('join-code').value.trim();
    if (!/^\d{5}$/.test(code)) { $('online-error').textContent = 'Enter the 5-digit code your friend sees.'; return; }
    $('online-error').textContent = ''; $('btn-join-room').disabled = true;
    ensureConnection().send({ t: 'join', game: 'tictactoe', room: code, name: myOnlineName() || 'O' });
  });
  $('btn-copy-code').addEventListener('click', async () => {
    const code = online.room || '';
    try { await navigator.clipboard.writeText(code); $('copy-label').textContent = 'Copied'; }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('room-code')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $('copy-label').textContent = 'Selected, press Ctrl+C'; }
    setTimeout(() => { $('copy-label').textContent = 'Copy code'; }, 1800);
  });
  $('btn-cancel-room').addEventListener('click', () => { leaveOnline(); closeDialog(); showMenuScreen(); });

  function sendOnline(i) {
    if (!onlineCanAct()) { if (online.ready && online.net === 'open') toast('Wait for your turn.'); return; }
    if (!game.isLegal(i)) { Sound.play('click'); return; }
    online.sending = true;
    online.conn.send({ t: 'action', action: { type: 'place', i } });
    render();
    const sentAt = game.moveCount;
    setTimeout(() => { if (online.sending && game.moveCount === sentAt) requestResync(); }, 5000);
  }
  function requestResync() { online.sending = false; const s = OnlineAPI.session.get(); if (online.conn && s) online.conn.send({ t: 'rejoin', room: s.room, token: s.token }); }

  function applyServerState(msg) {
    const wasFinished = finished;
    if (online.room !== msg.room) session = { wins: [0, 0], draws: 0 };   // new room → fresh series
    online.me = msg.you; online.room = msg.room; online.names = msg.names;
    online.connected = msg.connected; online.ready = msg.ready; online.sending = false;
    game.restore(msg.snap); history = []; finished = game.winner !== -1;
    if (wasFinished && !finished) { stopConfetti(); if (currentDialog()?.id === 'dlg-win') closeDialog(); }
    render();
  }
  function enterOnlineGame() {
    mode = 'online'; online.lobby = false;
    humanPlayer = online.me;
    el.menu.hidden = true; el.game.hidden = false;
    el.modeChip.textContent = `online · room ${online.room || ''}` + (game.size === 5 ? ' · 5×5' : '');
    render();
  }

  function handleServer(msg) {
    switch (msg.t) {
      case 'created':
        online.me = 0; online.room = msg.room; online.lobby = true;
        $('btn-create-room').disabled = false;
        $('room-code').textContent = msg.room; $('lobby-status').textContent = 'Waiting for your friend…';
        openDialog('dlg-lobby');
        break;
      case 'joined':
      case 'rejoined':
        $('btn-join-room').disabled = false; online.me = msg.you; online.room = msg.room;
        break;
      case 'state': {
        applyServerState(msg);
        if (!msg.ready) { if (!online.lobby) { online.lobby = true; $('room-code').textContent = msg.room; openDialog('dlg-lobby'); } break; }
        const inLobby = online.lobby || currentDialog()?.id === 'dlg-online';
        if (inLobby) closeDialog();
        if (el.game.hidden || mode !== 'online') enterOnlineGame();
        else { el.modeChip.textContent = `online · room ${online.room || ''}` + (game.size === 5 ? ' · 5×5' : ''); render(); }
        if (inLobby) { Sound.play('click'); toast(online.me === 0 ? `${playerLabel(1)} joined. You’re X, you move first.` : `You joined ${playerLabel(0)}’s room. X moves first.`); }
        if (finished && currentDialog()?.id !== 'dlg-win') showWin();
        break;
      }
      case 'action': {
        online.sending = false;
        if (msg.moveCount !== game.moveCount + 1) { requestResync(); break; }
        doPlay(msg.action.i, true);
        break;
      }
      case 'chat':
        onChat(msg);
        break;
      case 'notice':
        if (msg.kind === 'away') { toast(`${msg.name} lost connection. Waiting…`); chatSys(`${msg.name} lost connection`); }
        else if (msg.kind === 'back') { toast(`${msg.name} is back.`); chatSys(`${msg.name} is back`); }
        else if (msg.kind === 'rematch') chatSys('New game started');
        else if (msg.kind === 'rematch-offer') { toast(`${msg.name} wants a rematch.`); if (currentDialog()?.id === 'dlg-win' && !online.rematchSent) $('win-text').textContent = `${msg.name} wants a rematch. Tap Rematch to start.`; }
        if (!el.game.hidden) render();
        break;
      case 'closed':
        online.ready = false;
        if (mode === 'online' || online.lobby) { const was = online.lobby; resetOnline(); showMenuScreen(); confirmBox(was ? 'Room closed' : 'Game ended', msg.reason || 'The room was closed.', 'OK', null); }
        break;
      case 'error':
        $('btn-create-room').disabled = false; $('btn-join-room').disabled = false;
        if (currentDialog()?.id === 'dlg-online') { $('online-error').textContent = msg.message; break; }
        if (msg.code === 'gone') { resetOnline(); if (mode === 'online') { showMenuScreen(); confirmBox('Game ended', 'That online game is no longer available.', 'OK', null); } break; }
        if (mode === 'online') { online.sending = false; toast(msg.message); render(); }
        break;
    }
  }

  function resetOnline() { if (online.conn) { online.conn.close(); online.conn = null; } Object.assign(online, { me: -1, room: null, ready: false, sending: false, net: 'idle', lobby: false, rematchSent: false, connected: [false, false] }); clearChat(); closeChat(); }
  function leaveOnline() { resetOnline(); }
  function showMenuScreen() { token++; stopConfetti(); if (mode === 'online') mode = 'friend'; el.game.hidden = true; el.menu.hidden = false; renderMenu(); }

  /* ================================================================ chat */
  const QUICK_MESSAGES = ['Nice move!', 'Good game', 'Your turn!', 'Hurry up!', 'Wow!', 'Rematch?', 'Thinking…', 'Oops!'];
  const CHAT_EMOJIS = ['👍', '😂', '😮', '😡', '🔥', '❤️', '👏', '😎'];
  const chat = { room: null, unread: 0, count: 0 };
  const ch = { panel: $('chat'), log: $('chat-log'), quick: $('chat-quick'), emojis: $('chat-emojis'), form: $('chat-form'), input: $('chat-input'), mute: $('chat-mute'), close: $('chat-close'), fab: $('chat-fab'), badge: $('chat-badge') };
  const phoneLayout = () => window.matchMedia('(max-width: 999px)').matches;
  const chatOpen = () => el.game.classList.contains('chat-open');
  const chatVisible = () => !ch.panel.hidden && !el.game.hidden && (!phoneLayout() || chatOpen());
  const canChat = () => mode === 'online' && online.ready && online.net === 'open';

  for (const text of QUICK_MESSAGES) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn'; b.textContent = text; b.addEventListener('click', () => sendChat(text)); ch.quick.appendChild(b); }
  for (const e of CHAT_EMOJIS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'emoji-btn'; b.textContent = e; b.setAttribute('aria-label', 'Send ' + e); b.addEventListener('click', () => sendEmoji(e)); ch.emojis.appendChild(b); }

  function renderChatChrome() {
    const on = mode === 'online' && online.ready && !el.game.hidden;
    ch.panel.hidden = !on;
    el.game.classList.toggle('has-chat', on);
    if (!on) el.game.classList.remove('chat-open');
    ch.fab.hidden = !on || !phoneLayout() || chatOpen();
    if (chatVisible() && chat.unread) chat.unread = 0;
    ch.badge.hidden = chat.unread === 0;
    ch.badge.textContent = chat.unread > 9 ? '9+' : String(chat.unread);
    ch.fab.setAttribute('aria-label', chat.unread ? `Open chat, ${chat.unread} new` : 'Open chat');
    const ok = canChat();
    for (const b of ch.panel.querySelectorAll('button.chip-btn, button.emoji-btn, .chat-send')) b.disabled = !ok;
    ch.input.disabled = !ok; ch.input.placeholder = ok ? 'Type a message…' : 'Reconnecting…';
    ch.mute.setAttribute('aria-pressed', prefs.chatMute);
    ch.mute.setAttribute('aria-label', prefs.chatMute ? 'Turn chat sounds on' : 'Mute chat sounds');
    if (!chat.count && !ch.log.querySelector('.chat-empty')) { const li = document.createElement('li'); li.className = 'chat-empty'; li.textContent = 'Say hi, or tap a quick message below.'; ch.log.appendChild(li); }
  }
  function openChat() { el.game.classList.add('chat-open'); chat.unread = 0; renderChatChrome(); scrollChat(); }
  function closeChat() { el.game.classList.remove('chat-open'); if (!el.game.hidden) renderChatChrome(); }
  ch.fab.addEventListener('click', () => { Sound.play('click'); openChat(); });
  ch.close.addEventListener('click', closeChat);
  ch.mute.addEventListener('click', () => { prefs.chatMute = !prefs.chatMute; savePrefs(); renderChatChrome(); });
  window.addEventListener('resize', () => { if (!el.game.hidden) renderChatChrome(); });
  el.grid.addEventListener('pointerdown', () => { if (chatOpen()) closeChat(); });
  ch.form.addEventListener('submit', (e) => { e.preventDefault(); const text = ch.input.value.trim(); if (!text) { ch.input.focus(); return; } if (sendChat(text)) ch.input.value = ''; });

  function sendChat(text) { if (!canChat()) { toast('Chat is available once you’re connected to your friend.'); return false; } online.conn.send({ t: 'chat', text: text.slice(0, 120) }); return true; }
  function sendEmoji(e) { if (!canChat()) { toast('Chat is available once you’re connected to your friend.'); return; } online.conn.send({ t: 'emoji', e }); }

  function onChat(msg) {
    const mine = msg.by === online.me;
    const empty = ch.log.querySelector('.chat-empty'); if (empty) empty.remove();
    const li = document.createElement('li');
    li.className = 'chat-msg' + (mine ? ' mine' : '') + (msg.kind === 'emoji' ? ' emoji' : '');
    li.dataset.p = msg.by;
    if (!mine && msg.kind === 'text') { const who = document.createElement('span'); who.className = 'who'; who.textContent = msg.name; li.appendChild(who); }
    li.appendChild(document.createTextNode(msg.text));     // plain text, never HTML
    li.setAttribute('aria-label', `${mine ? 'You' : msg.name}: ${msg.text}`);
    ch.log.appendChild(li); chat.count++;
    while (ch.log.children.length > 120) ch.log.firstElementChild.remove();
    scrollChat();
    if (msg.kind === 'emoji') popEmoji(msg.text);
    if (!mine) {
      if (!chatVisible()) { chat.unread++; if (msg.kind === 'text') cardBubble(msg.by, msg.text); }
      if (!prefs.chatMute) Sound.play('chat');
      if (navigator.vibrate && phoneLayout() && !chatVisible()) { try { navigator.vibrate(30); } catch (e) { /* ignore */ } }
    }
    renderChatChrome();
  }
  function chatSys(text) { if (mode !== 'online') return; const empty = ch.log.querySelector('.chat-empty'); if (empty) empty.remove(); const li = document.createElement('li'); li.className = 'chat-sys'; li.textContent = text; ch.log.appendChild(li); chat.count++; scrollChat(); }
  function clearChat() { ch.log.innerHTML = ''; chat.count = 0; chat.unread = 0; }
  function scrollChat() { ch.log.scrollTop = ch.log.scrollHeight; }
  function popEmoji(e) { const board = $('board'); if (!board) return; board.style.position = 'relative'; const node = document.createElement('div'); node.className = 'emoji-pop'; node.textContent = e; node.style.left = '50%'; node.style.top = '46%'; board.appendChild(node); setTimeout(() => node.remove(), 2700); }
  function cardBubble(p, text) { const card = el.scoreCards[p]; if (!card) return; card.querySelector('.card-bubble')?.remove(); const b = document.createElement('div'); b.className = 'card-bubble'; b.textContent = text; card.appendChild(b); setTimeout(() => b.remove(), 3500); }

  /* saved scoreboard (across sessions) */
  function recordMatch() {
    const all = store.get('matches', []);
    all.unshift({ ts: Date.now(), mode, level: mode === 'ai' ? level : null, winner: game.winner, human: mode === 'ai' ? humanPlayer : null, moves: game.moveCount });
    store.set('matches', all.slice(0, 200));
  }
  function renderStats() {
    const m = store.get('matches', []); const body = $('stats-body');
    if (!m.length) { body.innerHTML = '<p class="empty-note">No finished games yet. Play a round and it shows up here.</p>'; $('btn-reset-stats').hidden = true; return; }
    $('btn-reset-stats').hidden = false;
    const ai = m.filter(x => x.mode === 'ai');
    const youW = ai.filter(x => x.winner === x.human).length;
    const cpuW = ai.filter(x => x.winner !== x.human && x.winner !== 2).length;
    const dr = m.filter(x => x.winner === 2).length;
    const rec = (lvl) => { const g = ai.filter(x => x.level === lvl); return `${g.filter(x => x.winner === x.human).length}–${g.filter(x => x.winner !== x.human && x.winner !== 2).length}`; };
    let html = `<dl class="score-summary">
      <div><dt>Games</dt><dd>${m.length}</dd></div>
      <div><dt>You vs computer</dt><dd>${youW}–${cpuW}</dd></div>
      <div><dt>Draws</dt><dd>${dr}</dd></div>
    </dl>
    <div class="table-scroll"><table class="record"><thead><tr><th>vs computer</th><th>Record (W–L)</th></tr></thead><tbody>
      ${['easy', 'medium', 'hard'].map(l => `<tr><td>${LEVEL_NAMES[l]}</td><td>${rec(l)}</td></tr>`).join('')}
    </tbody></table></div>`;
    body.innerHTML = html;
  }
  $('btn-reset-stats').addEventListener('click', async () => { if (await confirmBox('Clear the scoreboard?', 'Every saved result on this device is deleted.', 'Clear history', 'Keep it')) store.set('matches', []); renderStats(); openDialog('dlg-stats'); });

  /* theme + sound toggles */
  function resolvedTheme() { return prefs.theme !== 'system' ? prefs.theme : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function applyTheme() { if (prefs.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prefs.theme); const r = resolvedTheme(); root.setAttribute('data-resolved', r); el.theme.setAttribute('aria-label', r === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); }
  function applySound() { el.sound.setAttribute('aria-pressed', prefs.sound); el.sound.setAttribute('aria-label', prefs.sound ? 'Mute sound' : 'Turn sound on'); }
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(applyTheme); }
  el.theme.addEventListener('click', () => { prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; savePrefs(); applyTheme(); Sound.play('click'); });
  el.sound.addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); applySound(); Sound.warm(); Sound.play('click'); });

  /* confetti */
  let raf = 0;
  function startConfetti(color) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = el.confetti, ctx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = [color, color, '#f5c542', '#ffffff', '#f2e7d1'];
    const parts = Array.from({ length: 150 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .4, vx: (Math.random() - .5) * 15, vy: -Math.random() * 14 - 4, w: 6 + Math.random() * 6, h: 8 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - .5) * .4, col: colors[Math.random() * colors.length | 0] }));
    const t0 = performance.now(); cancelAnimationFrame(raf);
    const step = (now) => { const t = (now - t0) / 1000; ctx.clearRect(0, 0, innerWidth, innerHeight); for (const q of parts) { q.vy += .42; q.x += q.vx; q.y += q.vy; q.a += q.va; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 2) / .9); ctx.fillStyle = q.col; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.a * 2)) + 1); ctx.restore(); } if (t < 3) raf = requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight); };
    raf = requestAnimationFrame(step);
  }
  function stopConfetti() { cancelAnimationFrame(raf); const ctx = el.confetti.getContext('2d'); ctx.clearRect(0, 0, el.confetti.width, el.confetti.height); }

  /* start */
  applyTheme(); applySound(); buildBoard(boardSize); buildMini(); renderMenu(); render();
  // Refreshed the page during an online game? Put the player back in.
  if (OnlineAPI && OnlineAPI.available() && OnlineAPI.session.get()) ensureConnection().open();
  window.__ttt = { get game() { return game; }, get finished() { return finished; }, get aiThinking() { return aiThinking; }, get session() { return session; }, get online() { return online; }, get chat() { return chat; }, place, undo, startGame, newRound, get mode() { return mode; } };
})();
