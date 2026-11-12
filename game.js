/* ==========================================================================
   game.js — Rules engine for Corridors (a Quoridor-style game)
   --------------------------------------------------------------------------
   Pure game logic, no DOM. Works in the browser (window.Corridors) and in
   Node (module.exports) so the rules and the AI can be unit-tested.

   Coordinates
     Cells are (r, c) with r = 0 at the TOP row and r = 8 at the BOTTOM row.
     Player 0 = Red  : starts (8,4), wins on row 0.
     Player 1 = Blue : starts (0,4), wins on row 8.

   Walls
     A wall is anchored at a groove intersection (r, c), 0 <= r,c <= 7,
     which sits between rows r/r+1 and columns c/c+1. Every wall is two
     cells long.
       Horizontal 'h' at (r,c): blocks (r,c)<->(r+1,c) and (r,c+1)<->(r+1,c+1)
       Vertical   'v' at (r,c): blocks (r,c)<->(r,c+1) and (r+1,c)<->(r+1,c+1)
     Stored in Uint8Arrays of 64; value 0 = empty, 1 = red wall, 2 = blue wall.
   ========================================================================== */
(function (root) {
  'use strict';

  const N = 9;              // board size
  const W = N - 1;          // wall-grid size (8 x 8 intersections)
  const WALLS_PER_PLAYER = 10;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // up, down, left, right

  // Shared BFS scratch buffers (the engine is single-threaded).
  const bfsQueue = new Int16Array(N * N);
  const bfsSeen = new Int16Array(N * N);
  const bfsParent = new Int16Array(N * N);
  let bfsStamp = 0;

  function nextStamp() {
    bfsStamp++;
    if (bfsStamp > 30000) { bfsSeen.fill(0); bfsStamp = 1; }
    return bfsStamp;
  }

  class GameState {
    constructor() { this.reset(); }

    /** Put everything back to the opening position. */
    reset() {
      this.pawns = [{ r: 8, c: 4 }, { r: 0, c: 4 }];
      this.h = new Uint8Array(W * W);
      this.v = new Uint8Array(W * W);
      this.wallsLeft = [WALLS_PER_PLAYER, WALLS_PER_PLAYER];
      this.turn = 0;          // Red always opens
      this.winner = -1;
      this.moveCount = 0;
      this.lastAction = null; // { type, player, ... } for "last move" highlight
    }

    clone() {
      const s = Object.create(GameState.prototype);
      s.pawns = [{ ...this.pawns[0] }, { ...this.pawns[1] }];
      s.h = this.h.slice();
      s.v = this.v.slice();
      s.wallsLeft = this.wallsLeft.slice();
      s.turn = this.turn;
      s.winner = this.winner;
      s.moveCount = this.moveCount;
      s.lastAction = this.lastAction ? { ...this.lastAction } : null;
      return s;
    }

    /** Plain-object snapshot, used for undo history. */
    snapshot() {
      return {
        pawns: [{ ...this.pawns[0] }, { ...this.pawns[1] }],
        h: Array.from(this.h), v: Array.from(this.v),
        wallsLeft: this.wallsLeft.slice(), turn: this.turn,
        winner: this.winner, moveCount: this.moveCount,
        lastAction: this.lastAction ? { ...this.lastAction } : null,
      };
    }

    restore(s) {
      this.pawns = [{ ...s.pawns[0] }, { ...s.pawns[1] }];
      this.h = Uint8Array.from(s.h); this.v = Uint8Array.from(s.v);
      this.wallsLeft = s.wallsLeft.slice(); this.turn = s.turn;
      this.winner = s.winner; this.moveCount = s.moveCount;
      this.lastAction = s.lastAction ? { ...s.lastAction } : null;
    }

    static goalRow(p) { return p === 0 ? 0 : N - 1; }

    /* ------------------------------------------------------------ walls -- */
    hAt(r, c) { return r >= 0 && r < W && c >= 0 && c < W && this.h[r * W + c] !== 0; }
    vAt(r, c) { return r >= 0 && r < W && c >= 0 && c < W && this.v[r * W + c] !== 0; }

    /** True when stepping from (r,c) by (dr,dc) leaves the board or hits a wall. */
    isBlocked(r, c, dr, dc) {
      if (dr === -1) return r === 0 || this.hAt(r - 1, c - 1) || this.hAt(r - 1, c);
      if (dr === 1) return r === N - 1 || this.hAt(r, c - 1) || this.hAt(r, c);
      if (dc === -1) return c === 0 || this.vAt(r - 1, c - 1) || this.vAt(r, c - 1);
      return c === N - 1 || this.vAt(r - 1, c) || this.vAt(r, c);
    }

    /** Geometry-only check: in bounds, no overlap, no crossing. */
    wallFits(r, c, o) {
      if (r < 0 || r >= W || c < 0 || c >= W) return false;
      const i = r * W + c;
      if (this.h[i] || this.v[i]) return false;           // same slot / crossing
      if (o === 'h') return !this.hAt(r, c - 1) && !this.hAt(r, c + 1);
      return !this.vAt(r - 1, c) && !this.vAt(r + 1, c);
    }

    /** Full legality for player p: has walls, fits, and leaves both paths open. */
    canPlaceWall(p, r, c, o) {
      if (this.winner !== -1 || this.wallsLeft[p] <= 0) return false;
      return this.wallFits(r, c, o) && this.wallKeepsPaths(r, c, o);
    }

    /** Reason a wall is illegal (for friendly UI messages), or null. */
    wallProblem(p, r, c, o) {
      if (this.wallsLeft[p] <= 0) return 'No walls left';
      if (r < 0 || r >= W || c < 0 || c >= W) return 'Walls must sit inside the board';
      if (!this.wallFits(r, c, o)) return 'That overlaps or crosses another wall';
      if (!this.wallKeepsPaths(r, c, o)) return 'A wall can’t seal off a player’s route';
      return null;
    }

    wallKeepsPaths(r, c, o) {
      const arr = o === 'h' ? this.h : this.v;
      const i = r * W + c;
      arr[i] = 3; // temporary marker
      const ok = this.hasPath(0) && this.hasPath(1);
      arr[i] = 0;
      return ok;
    }

    /* ---------------------------------------------------------- pathing -- */
    /** Shortest number of steps to the goal row, ignoring pawns. -1 if sealed. */
    distance(p) {
      const goal = GameState.goalRow(p);
      const start = this.pawns[p].r * N + this.pawns[p].c;
      if (this.pawns[p].r === goal) return 0;
      const stamp = nextStamp();
      let head = 0, tail = 0, depthEnd = 1, depth = 0;
      bfsQueue[tail++] = start; bfsSeen[start] = stamp;
      while (head < tail) {
        if (head === depthEnd) { depth++; depthEnd = tail; }
        const cur = bfsQueue[head++];
        const r = (cur / N) | 0, c = cur - r * N;
        for (let d = 0; d < 4; d++) {
          const dr = DIRS[d][0], dc = DIRS[d][1];
          if (this.isBlocked(r, c, dr, dc)) continue;
          const nr = r + dr, nc = c + dc, ni = nr * N + nc;
          if (bfsSeen[ni] === stamp) continue;
          if (nr === goal) return depth + 1;
          bfsSeen[ni] = stamp; bfsQueue[tail++] = ni;
        }
      }
      return -1;
    }

    hasPath(p) { return this.distance(p) !== -1; }

    /** One shortest path as a list of cells (excluding the start). Empty if none. */
    shortestPath(p) {
      const goal = GameState.goalRow(p);
      const start = this.pawns[p].r * N + this.pawns[p].c;
      if (this.pawns[p].r === goal) return [];
      const stamp = nextStamp();
      let head = 0, tail = 0, end = -1;
      bfsQueue[tail++] = start; bfsSeen[start] = stamp; bfsParent[start] = -1;
      // Explore toward the goal first so the path looks natural.
      const order = p === 0 ? [0, 2, 3, 1] : [1, 2, 3, 0];
      outer: while (head < tail) {
        const cur = bfsQueue[head++];
        const r = (cur / N) | 0, c = cur - r * N;
        for (const d of order) {
          const dr = DIRS[d][0], dc = DIRS[d][1];
          if (this.isBlocked(r, c, dr, dc)) continue;
          const ni = (r + dr) * N + (c + dc);
          if (bfsSeen[ni] === stamp) continue;
          bfsSeen[ni] = stamp; bfsParent[ni] = cur; bfsQueue[tail++] = ni;
          if (r + dr === goal) { end = ni; break outer; }
        }
      }
      if (end === -1) return [];
      const path = [];
      for (let x = end; x !== start; x = bfsParent[x]) path.push({ r: (x / N) | 0, c: x % N });
      return path.reverse();
    }

    /** Distance from every cell to player p's goal row (reverse BFS). */
    distanceMap(p) {
      const goal = GameState.goalRow(p);
      const dist = new Int16Array(N * N).fill(-1);
      let head = 0, tail = 0;
      for (let c = 0; c < N; c++) { const i = goal * N + c; dist[i] = 0; bfsQueue[tail++] = i; }
      while (head < tail) {
        const cur = bfsQueue[head++];
        const r = (cur / N) | 0, c = cur - r * N;
        for (let d = 0; d < 4; d++) {
          const dr = DIRS[d][0], dc = DIRS[d][1];
          if (this.isBlocked(r, c, dr, dc)) continue;
          const ni = (r + dr) * N + (c + dc);
          if (dist[ni] !== -1) continue;
          dist[ni] = dist[cur] + 1; bfsQueue[tail++] = ni;
        }
      }
      return dist;
    }

    /* ------------------------------------------------------- pawn moves -- */
    /**
     * Legal destinations for player p, including the standard jump rule:
     *  - an adjacent opponent can be jumped straight over when nothing is behind;
     *  - if a wall or the board edge is behind them, step diagonally to either
     *    side of the opponent instead (where no wall blocks that side).
     * Each result: { r, c, kind: 'step' | 'jump' | 'diagonal' }.
     */
    legalPawnMoves(p) {
      const me = this.pawns[p], op = this.pawns[1 - p];
      const out = [];
      const seen = new Set();
      const add = (r, c, kind) => {
        const k = r * N + c;
        if (seen.has(k) || (r === me.r && c === me.c)) return;
        seen.add(k); out.push({ r, c, kind });
      };
      for (const [dr, dc] of DIRS) {
        if (this.isBlocked(me.r, me.c, dr, dc)) continue;
        const nr = me.r + dr, nc = me.c + dc;
        if (nr !== op.r || nc !== op.c) { add(nr, nc, 'step'); continue; }
        // Opponent is next to us in this direction.
        if (!this.isBlocked(op.r, op.c, dr, dc)) {
          add(op.r + dr, op.c + dc, 'jump');
        } else {
          // Straight jump blocked: try the two sides of the opponent.
          const sides = dr !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
          for (const [sr, sc] of sides) {
            if (!this.isBlocked(op.r, op.c, sr, sc)) add(op.r + sr, op.c + sc, 'diagonal');
          }
        }
      }
      return out;
    }

    isLegalPawnMove(p, r, c) {
      return this.legalPawnMoves(p).some(m => m.r === r && m.c === c);
    }

    /* ---------------------------------------------------------- actions -- */
    /**
     * Apply a validated action for the player whose turn it is.
     * action = { type: 'move', r, c } | { type: 'wall', r, c, o: 'h' | 'v' }
     * Returns true on success, false if illegal (state unchanged).
     */
    apply(action) {
      if (this.winner !== -1) return false;
      const p = this.turn;
      if (action.type === 'move') {
        if (!this.isLegalPawnMove(p, action.r, action.c)) return false;
        const from = { ...this.pawns[p] };
        this.pawns[p] = { r: action.r, c: action.c };
        this.lastAction = { type: 'move', player: p, from, r: action.r, c: action.c };
        if (action.r === GameState.goalRow(p)) this.winner = p;
      } else if (action.type === 'wall') {
        if (!this.canPlaceWall(p, action.r, action.c, action.o)) return false;
        (action.o === 'h' ? this.h : this.v)[action.r * W + action.c] = p + 1;
        this.wallsLeft[p]--;
        this.lastAction = { type: 'wall', player: p, r: action.r, c: action.c, o: action.o };
      } else {
        return false;
      }
      this.moveCount++;
      if (this.winner === -1) this.turn = 1 - p;
      return true;
    }

    /* --- fast, unvalidated do/undo used inside the AI search tree -------- */
    pushMove(p, r, c) {
      const prev = this.pawns[p];
      this.pawns[p] = { r, c };
      this.turn = 1 - p;
      return prev;
    }
    popMove(p, prev) { this.pawns[p] = prev; this.turn = p; }

    pushWall(p, r, c, o) {
      (o === 'h' ? this.h : this.v)[r * W + c] = p + 1;
      this.wallsLeft[p]--; this.turn = 1 - p;
    }
    popWall(p, r, c, o) {
      (o === 'h' ? this.h : this.v)[r * W + c] = 0;
      this.wallsLeft[p]++; this.turn = p;
    }

    /** List of placed walls for rendering: { r, c, o, owner }. */
    wallList() {
      const list = [];
      for (let i = 0; i < W * W; i++) {
        if (this.h[i]) list.push({ r: (i / W) | 0, c: i % W, o: 'h', owner: this.h[i] - 1 });
        if (this.v[i]) list.push({ r: (i / W) | 0, c: i % W, o: 'v', owner: this.v[i] - 1 });
      }
      return list;
    }
  }

  const api = { GameState, N, W, WALLS_PER_PLAYER, DIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Corridors = api;
})(typeof window !== 'undefined' ? window : globalThis);
