/* portal.js — Wood Games hub: theme toggle + decorative mini boards */
(() => {
  'use strict';
  const root = document.documentElement;
  const btn = document.getElementById('btn-theme');

  /* Theme (shared across the portal, remembered per browser) */
  const get = () => { try { return localStorage.getItem('portal.theme') || 'system'; } catch (e) { return 'system'; } };
  const set = (v) => { try { localStorage.setItem('portal.theme', v); } catch (e) { /* ignore */ } };
  const resolved = () => { const t = get(); return t !== 'system' ? t : (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); };
  function apply() {
    const t = get();
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    const r = resolved(); root.setAttribute('data-resolved', r);
    btn.setAttribute('aria-label', r === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  btn.addEventListener('click', () => { set(resolved() === 'dark' ? 'light' : 'dark'); apply(); });
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(apply); }
  apply();

  /* Decorative Corridors board: 9x9 with a couple of pawns and walls */
  const corr = document.getElementById('board-corridors');
  if (corr) {
    const g = document.createElement('div'); g.className = 'mini c9';
    for (let i = 0; i < 81; i++) {
      const r = (i / 9) | 0, c = i % 9;
      const sq = document.createElement('div'); sq.className = 'sq';
      if (r === 7 && c === 4) sq.innerHTML = '<span class="pawn x"></span>';
      if (r === 2 && c === 4) sq.innerHTML = '<span class="pawn o"></span>';
      g.appendChild(sq);
    }
    corr.appendChild(g);
  }

  /* Decorative Tic-Tac-Toe board */
  const ttt = document.getElementById('board-ttt');
  if (ttt) {
    const g = document.createElement('div'); g.className = 'mini c3';
    const marks = { 0: 'tx', 4: 'to', 8: 'tx', 2: 'to', 3: 'tx' };
    for (let i = 0; i < 9; i++) {
      const sq = document.createElement('div'); sq.className = 'sq';
      if (marks[i]) sq.innerHTML = `<span class="${marks[i]}"></span>`;
      g.appendChild(sq);
    }
    ttt.appendChild(g);
  }
})();
