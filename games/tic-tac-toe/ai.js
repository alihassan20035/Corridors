/* ==========================================================================
   ai.js — Tic-Tac-Toe computer opponent (any board size)
   --------------------------------------------------------------------------
   3×3 (win 3): full minimax — perfect play, cannot be beaten, only drawn.
   5×5 (win 4): the tree is far too big for full minimax, so the computer uses
     depth-limited alpha-beta search over only the cells near existing marks,
     with a threat-counting heuristic. It always takes an immediate win and
     blocks an immediate loss.

   Difficulty:
     easy   – takes an obvious win, occasionally blocks, otherwise loose.
     medium – takes wins and blocks, shallow search.
     hard   – deep search (perfect on 3×3, strong on 5×5).
   ========================================================================== */
(function (root) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./game.js') : root.TicTacToe;
  const { TTTState, linesFor } = C;

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const WIN = 1e6;

  /** Lines for a raw cells array when no state is handy (test helper). */
  function linesForCells(cells, lines) {
    if (lines) return lines;
    const size = Math.round(Math.sqrt(cells.length));
    return linesFor(size, size <= 3 ? size : 4);
  }

  /** The empty cell that completes a line for player p, or -1. */
  function winningCell(cells, p, lines) {
    lines = linesForCells(cells, lines);
    const mark = p + 1;
    for (const line of lines) {
      let mine = 0, empty = -1, blocked = false;
      for (const idx of line) {
        const v = cells[idx];
        if (v === mark) mine++;
        else if (v === 0) { if (empty === -1) empty = idx; else { blocked = true; break; } }
        else { blocked = true; break; }
      }
      if (!blocked && empty !== -1 && mine === line.length - 1) return empty;
    }
    return -1;
  }

  function winnerCells(cells, lines) {
    for (const line of lines) {
      const v = cells[line[0]];
      if (v === 0) continue;
      let all = true;
      for (let k = 1; k < line.length; k++) if (cells[line[k]] !== v) { all = false; break; }
      if (all) return v - 1;
    }
    return -1;
  }

  /* ------------------------------------------------------- exact (3×3) ---- */
  function minimax(st, toMove, me, depth) {
    const w = winnerCells(st.cells, st.lines);
    if (w === me) return 10 - depth;
    if (w === 1 - me) return depth - 10;
    if (st.cells.indexOf(0) === -1) return 0;
    let best = toMove === me ? -Infinity : Infinity;
    for (let i = 0; i < st.cells.length; i++) {
      if (st.cells[i] !== 0) continue;
      st.cells[i] = toMove + 1;
      const score = minimax(st, 1 - toMove, me, depth + 1);
      st.cells[i] = 0;
      best = toMove === me ? Math.max(best, score) : Math.min(best, score);
    }
    return best;
  }
  function bestExact(state, me) {
    let best = -Infinity, choices = [];
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] !== 0) continue;
      state.cells[i] = me + 1;
      const score = minimax(state, 1 - me, me, 1);
      state.cells[i] = 0;
      if (score > best) { best = score; choices = [i]; }
      else if (score === best) choices.push(i);
    }
    return pick(choices);
  }

  /* ------------------------------------------- heuristic search (big) ----- */
  const LINE_WEIGHT = [0, 1, 10, 80, 600];   // value of a line holding n of my marks and no enemy

  function heuristic(cells, me, lines) {
    let score = 0;
    for (const line of lines) {
      let a = 0, b = 0;
      for (const idx of line) { const v = cells[idx]; if (v === me + 1) a++; else if (v !== 0) b++; }
      if (a && b) continue;                 // mixed line: dead for both
      if (a) score += LINE_WEIGHT[a];
      else if (b) score -= LINE_WEIGHT[b] * 1.1;  // value blocking slightly higher
    }
    return score;
  }

  /** Empty cells next to any placed mark (where the action is); centre if board is empty. */
  function candidates(st) {
    const n = st.size, cells = st.cells, seen = new Set(), out = [];
    let any = false;
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) { any = true; break; }
    if (!any) return [Math.floor(cells.length / 2)];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (cells[r * n + c] === 0) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
          const idx = nr * n + nc;
          if (cells[idx] === 0 && !seen.has(idx)) { seen.add(idx); out.push(idx); }
        }
      }
    }
    return out;
  }

  function alphabeta(st, toMove, me, depth, alpha, beta) {
    const w = winnerCells(st.cells, st.lines);
    if (w === me) return WIN - (20 - depth);
    if (w === 1 - me) return -WIN + (20 - depth);
    if (depth === 0) return heuristic(st.cells, me, st.lines);
    const cands = candidates(st);
    if (!cands.length) return 0;
    let best = toMove === me ? -Infinity : Infinity;
    for (const i of cands) {
      st.pushMove(toMove, i);
      const v = alphabeta(st, 1 - toMove, me, depth - 1, alpha, beta);
      st.popMove(toMove, i);
      if (toMove === me) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (beta <= alpha) break;
    }
    return best;
  }

  function bestSearch(state, me, maxDepth) {
    const win = winningCell(state.cells, me, state.lines);
    if (win !== -1) return win;                    // take the win now
    const block = winningCell(state.cells, 1 - me, state.lines);
    if (block !== -1) return block;                // stop their win now
    const cands = candidates(state);
    let best = -Infinity, choices = [cands[0]];
    for (const i of cands) {
      state.pushMove(me, i);
      const v = alphabeta(state, 1 - me, me, maxDepth - 1, -Infinity, Infinity);
      state.popMove(me, i);
      if (v > best) { best = v; choices = [i]; }
      else if (v === best) choices.push(i);
    }
    return pick(choices);
  }

  /* --------------------------------------------------------- per level ---- */
  function easySmall(state, me) {
    const win = winningCell(state.cells, me, state.lines);
    if (win !== -1 && Math.random() < 0.7) return win;
    if (Math.random() < 0.15) { const b = winningCell(state.cells, 1 - me, state.lines); if (b !== -1) return b; }
    return pick(state.available());
  }
  function mediumSmall(state, me) {
    const win = winningCell(state.cells, me, state.lines); if (win !== -1) return win;
    const block = winningCell(state.cells, 1 - me, state.lines); if (block !== -1) return block;
    if (Math.random() < 0.15) return pick(state.available());
    const mid = Math.floor(state.cells.length / 2);
    if (state.cells[mid] === 0) return mid;
    const n = state.size, corners = [0, n - 1, n * (n - 1), n * n - 1].filter(i => state.cells[i] === 0);
    if (corners.length) return pick(corners);
    return pick(state.available());
  }
  function easyBig(state, me) {
    const win = winningCell(state.cells, me, state.lines);
    if (win !== -1 && Math.random() < 0.65) return win;
    if (Math.random() < 0.45) { const b = winningCell(state.cells, 1 - me, state.lines); if (b !== -1) return b; }
    const cands = candidates(state);
    return pick(cands.length ? cands : state.available());
  }

  /**
   * @param {TTTState} state
   * @param {number} player 0 (X) or 1 (O)
   * @param {'easy'|'medium'|'hard'} level
   * @returns {number} cell index
   */
  function chooseMove(state, player, level) {
    if (state.size <= 3) {
      if (level === 'easy') return easySmall(state, player);
      if (level === 'medium') return mediumSmall(state, player);
      return bestExact(state, player);           // perfect
    }
    // Larger boards: heuristic search.
    if (level === 'easy') return easyBig(state, player);
    if (level === 'medium') return bestSearch(state, player, 2);
    return bestSearch(state, player, 4);
  }

  const api = { chooseMove, winningCell, bestExact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TicTacToeAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
