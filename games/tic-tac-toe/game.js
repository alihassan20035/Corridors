/* ==========================================================================
   game.js — Tic-Tac-Toe rules engine (any board size)
   --------------------------------------------------------------------------
   Pure logic, no DOM. Runs in the browser (window.TicTacToe) and in Node
   (module.exports) so the rules and the AI can be unit-tested.

   Board is an N×N grid of cells, index = r*N + c. A cell holds 0 (empty),
   1 (player X) or 2 (player O). Player 0 = X and always moves first.
   A player wins by getting `win` marks in a row (across, down or diagonal).

     3×3 → win 3   (classic)
     5×5 → win 4   (four in a row)
   ========================================================================== */
(function (root) {
  'use strict';

  // All winning lines for a given size/win length, cached and shared (immutable).
  const lineCache = new Map();
  function linesFor(size, win) {
    const key = size + ':' + win;
    let lines = lineCache.get(key);
    if (lines) return lines;
    lines = [];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]; // right, down, diag ↘, diag ↙
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const [dr, dc] of dirs) {
          const er = r + (win - 1) * dr, ec = c + (win - 1) * dc;
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          const line = [];
          for (let k = 0; k < win; k++) line.push((r + k * dr) * size + (c + k * dc));
          lines.push(line);
        }
      }
    }
    lineCache.set(key, lines);
    return lines;
  }

  const winFor = (size) => (size <= 3 ? size : 4);

  class TTTState {
    constructor(size = 3, win) {
      this.size = size;
      this.win = win || winFor(size);
      this.lines = linesFor(this.size, this.win);
      this.reset();
    }

    reset() {
      this.cells = new Uint8Array(this.size * this.size);
      this.turn = 0;          // X opens
      this.winner = -1;       // -1 none, 0 X, 1 O, 2 draw
      this.winLine = null;    // the winning cells, for highlighting
      this.moveCount = 0;
      this.last = -1;
    }

    clone() {
      const s = Object.create(TTTState.prototype);
      s.size = this.size; s.win = this.win; s.lines = this.lines;
      s.cells = this.cells.slice();
      s.turn = this.turn; s.winner = this.winner;
      s.winLine = this.winLine ? this.winLine.slice() : null;
      s.moveCount = this.moveCount; s.last = this.last;
      return s;
    }

    snapshot() {
      return {
        size: this.size, win: this.win,
        cells: Array.from(this.cells), turn: this.turn, winner: this.winner,
        winLine: this.winLine ? this.winLine.slice() : null,
        moveCount: this.moveCount, last: this.last,
      };
    }

    restore(s) {
      this.size = s.size || 3; this.win = s.win || winFor(this.size);
      this.lines = linesFor(this.size, this.win);
      this.cells = Uint8Array.from(s.cells); this.turn = s.turn; this.winner = s.winner;
      this.winLine = s.winLine ? s.winLine.slice() : null;
      this.moveCount = s.moveCount; this.last = s.last;
    }

    available() {
      const out = [];
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === 0) out.push(i);
      return out;
    }

    isLegal(i) { return this.winner === -1 && i >= 0 && i < this.cells.length && this.cells[i] === 0; }

    /** Winner from the board (sets winLine). Returns -1, 0, 1 or 2 (draw). */
    evaluateBoard() {
      for (const line of this.lines) {
        const v = this.cells[line[0]];
        if (v === 0) continue;
        let all = true;
        for (let k = 1; k < line.length; k++) if (this.cells[line[k]] !== v) { all = false; break; }
        if (all) { this.winLine = line.slice(); return v - 1; }
      }
      return this.cells.indexOf(0) === -1 ? 2 : -1;
    }

    play(i) {
      if (!this.isLegal(i)) return false;
      const p = this.turn;
      this.cells[i] = p + 1;
      this.last = i;
      this.moveCount++;
      const w = this.evaluateBoard();
      if (w !== -1) this.winner = w;
      else this.turn = 1 - p;
      return true;
    }

    /* Fast do/undo for the AI search (no validation, no win bookkeeping). */
    pushMove(p, i) { this.cells[i] = p + 1; this.turn = 1 - p; }
    popMove(p, i) { this.cells[i] = 0; this.turn = p; }

    /** Winner (0/1) from a cells array using these lines, or -1. Ignores draws. */
    winnerOf(cells) {
      for (const line of this.lines) {
        const v = cells[line[0]];
        if (v === 0) continue;
        let all = true;
        for (let k = 1; k < line.length; k++) if (cells[line[k]] !== v) { all = false; break; }
        if (all) return v - 1;
      }
      return -1;
    }
  }

  const api = { TTTState, linesFor, winFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TicTacToe = api;
})(typeof window !== 'undefined' ? window : globalThis);
