/* ==========================================================================
   ai.js — Computer opponent for Corridors
   --------------------------------------------------------------------------
   Strategy overview
     * Pathfinding: BFS shortest-path lengths for both pawns (game.js).
     * Evaluation:  (opponent distance − my distance) is the core race metric,
                    plus a small value for walls still in hand and exact
                    endgame detection once a side has run out of walls.
     * Candidate walls: only walls that cut an edge of the opponent's current
                    shortest path (or sit right next to them) and actually
                    lengthen it. This keeps the search small and stops the AI
                    from wasting walls.
     * Search:      Negamax with alpha-beta pruning.
                      Easy   – greedy path follower, occasional blunders,
                               rare walls.
                      Medium – 2-ply search (my action + your best reply).
                      Hard   – iterative deepening up to 4 plies with a
                               time budget, wider wall candidate set.
   ========================================================================== */
(function (root) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./game.js')
    : root.Corridors;
  const { GameState, N, W } = C;

  const WIN = 100000;

  const LEVELS = {
    easy:   { depth: 1, rootWalls: 6,  innerWalls: 0,  timeMs: 0,    wallValue: 2.0, noise: 0 },
    medium: { depth: 2, rootWalls: 12, innerWalls: 8,  timeMs: 0,    wallValue: 2.5, noise: 1.5 },
    hard:   { depth: 6, rootWalls: 26, innerWalls: 14, timeMs: 1300, wallValue: 2.5, noise: 0 },
  };

  class Timeout extends Error {}

  /* ------------------------------------------------------------ helpers -- */

  /**
   * Static evaluation from the point of view of `p`, who is to move.
   * Positive is good for p.
   */
  function evaluate(st, p, wallValue) {
    const q = 1 - p;
    const dMe = st.distance(p), dOp = st.distance(q);
    if (dOp === 0) return -WIN;
    if (dMe === 0) return WIN;
    // Exact races once the other side has no walls left (pawn blocking ignored).
    if (st.wallsLeft[q] === 0 && dMe <= dOp) return 5000 - dMe * 10;
    if (st.wallsLeft[p] === 0 && dOp < dMe) return -5000 + dOp * 10;
    let score = 10 * (dOp - dMe);
    score += wallValue * (st.wallsLeft[p] - st.wallsLeft[q]);
    // Walls are worth more while the opponent still has a long way to go.
    return score;
  }

  /** Walls that block an edge of q's shortest path, or hug q's pawn. */
  function rawWallCandidates(st, q) {
    const set = new Map();
    const add = (r, c, o) => {
      if (r < 0 || r >= W || c < 0 || c >= W) return;
      const k = o + (r * W + c);
      if (!set.has(k)) set.set(k, { r, c, o });
    };
    let prev = st.pawns[q];
    const path = st.shortestPath(q);
    for (const cell of path) {
      if (cell.c === prev.c) {                // vertical step → horizontal walls
        const rr = Math.min(cell.r, prev.r);
        add(rr, cell.c - 1, 'h'); add(rr, cell.c, 'h');
      } else {                                // sideways step → vertical walls
        const cc = Math.min(cell.c, prev.c);
        add(cell.r - 1, cc, 'v'); add(cell.r, cc, 'v');
      }
      prev = cell;
    }
    const o = st.pawns[q];
    for (let r = o.r - 2; r <= o.r + 1; r++) {
      for (let c = o.c - 2; c <= o.c + 1; c++) { add(r, c, 'h'); add(r, c, 'v'); }
    }
    return [...set.values()];
  }

  /**
   * Legal walls for player p that lengthen the opponent's path, best first.
   * Each: { type:'wall', r, c, o, gain } where gain = opponent's extra steps
   * minus any extra steps the wall costs p.
   */
  function usefulWalls(st, p, limit) {
    if (st.wallsLeft[p] <= 0 || limit <= 0) return [];
    const q = 1 - p;
    const baseOp = st.distance(q), baseMe = st.distance(p);
    const res = [];
    for (const w of rawWallCandidates(st, q)) {
      if (!st.wallFits(w.r, w.c, w.o)) continue;
      const arr = w.o === 'h' ? st.h : st.v;
      const i = w.r * W + w.c;
      arr[i] = p + 1;
      const dOp = st.distance(q), dMe = st.distance(p);
      arr[i] = 0;
      if (dOp === -1 || dMe === -1) continue;      // would seal someone in: illegal
      const gain = (dOp - baseOp) - (dMe - baseMe);
      if (dOp - baseOp <= 0) continue;             // doesn't slow them: wasted wall
      res.push({ type: 'wall', r: w.r, c: w.c, o: w.o, gain });
    }
    res.sort((a, b) => b.gain - a.gain);
    return res.slice(0, limit);
  }

  /** Pawn moves for p, closest-to-goal first. */
  function orderedPawnMoves(st, p) {
    const map = st.distanceMap(p);
    return st.legalPawnMoves(p)
      .map(m => ({ type: 'move', r: m.r, c: m.c, d: map[m.r * N + m.c] }))
      .sort((a, b) => a.d - b.d);
  }

  function doAction(st, p, a) {
    if (a.type === 'move') return st.pushMove(p, a.r, a.c);
    st.pushWall(p, a.r, a.c, a.o); return null;
  }
  function undoAction(st, p, a, token) {
    if (a.type === 'move') st.popMove(p, token); else st.popWall(p, a.r, a.c, a.o);
  }

  /* ------------------------------------------------------------- search -- */

  function negamax(st, p, depth, alpha, beta, cfg, ctx) {
    ctx.nodes++;
    if (ctx.deadline && (ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) throw new Timeout();
    const q = 1 - p;
    if (st.pawns[q].r === GameState.goalRow(q)) return -WIN - depth; // q already won; sooner is worse
    if (depth === 0) return evaluate(st, p, cfg.wallValue);

    const actions = orderedPawnMoves(st, p).concat(usefulWalls(st, p, cfg.innerWalls));
    let best = -Infinity;
    for (const a of actions) {
      const tok = doAction(st, p, a);
      const val = -negamax(st, q, depth - 1, -beta, -alpha, cfg, ctx);
      undoAction(st, p, a, tok);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** Score every root action at a given depth. */
  function scoreRoot(st, p, actions, depth, cfg, ctx) {
    const q = 1 - p;
    const scored = [];
    // Actions arrive best-first from the previous iteration. Each sibling is
    // searched with a window 3 points below the best so far: anything that
    // close gets an exact score (so tie-breakers stay honest), anything worse
    // is cut off early.
    let alpha = -Infinity;
    for (const a of actions) {
      const tok = doAction(st, p, a);
      let val;
      if (a.type === 'move' && a.r === GameState.goalRow(p)) val = WIN + depth * 10;
      else val = -negamax(st, q, depth - 1, -Infinity, -(alpha - 3), cfg, ctx);
      undoAction(st, p, a, tok);
      scored.push({ a, val });
      if (val > alpha) alpha = val;
    }
    return scored;
  }

  /* --------------------------------------------------- difficulty logic -- */

  function chooseEasy(st, p, cfg) {
    const q = 1 - p;
    const moves = orderedPawnMoves(st, p);
    const dMe = st.distance(p), dOp = st.distance(q);

    // Sometimes block, but only when it clearly helps and the opponent is ahead.
    if (st.wallsLeft[p] > 0 && dOp <= dMe && dOp <= 5 && Math.random() < 0.3) {
      const walls = usefulWalls(st, p, cfg.rootWalls).filter(w => w.gain >= 2);
      if (walls.length) return pick(walls.slice(0, 3));
    }
    // Usually step along the shortest path; occasionally wander.
    const bestD = moves[0].d;
    const bestMoves = moves.filter(m => m.d === bestD);
    if (Math.random() < 0.18 && moves.length > 1 && bestD > 1) {
      return pick(moves.filter(m => m.d <= bestD + 1));
    }
    return pick(bestMoves);
  }

  function chooseSearch(st, p, cfg, recent) {
    const work = st.clone();
    const moves = orderedPawnMoves(work, p);
    // Immediate win available? Take it.
    const winning = moves.find(m => m.r === GameState.goalRow(p));
    if (winning) return winning;

    let actions = moves.concat(usefulWalls(work, p, cfg.rootWalls));
    const ctx = { nodes: 0, deadline: cfg.timeMs ? Date.now() + cfg.timeMs : 0 };
    const dMeNow = work.distance(p);
    let best = null;

    const startDepth = cfg.timeMs ? 1 : cfg.depth;
    for (let depth = startDepth; depth <= cfg.depth; depth++) {
      try {
        const scored = scoreRoot(work, p, actions, depth, cfg, ctx);
        for (const s of scored) {
          // Tie-breakers: prefer progress, and keep a little variety on medium.
          if (s.a.type === 'move') {
            s.val += (dMeNow - s.a.d) * 0.6;
            // Discourage shuffling. Stepping straight back to the square we just
            // left costs more than a full square of progress; revisiting older
            // squares costs a little. This breaks horizon-effect loops where the
            // search keeps backing away from a wall it fears.
            const last = recent[recent.length - 1];
            if (last && last.r === s.a.r && last.c === s.a.c) s.val -= 12;
            else if (recent.some(x => x.r === s.a.r && x.c === s.a.c)) s.val -= 4;
          }
          if (cfg.noise) s.val += (Math.random() - 0.5) * cfg.noise;
        }
        scored.sort((x, y) => y.val - x.val);
        best = scored[0].a;
        actions = scored.map(s => s.a);           // reorder for the next iteration
        if (scored[0].val >= WIN) break;           // forced win found
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        // Rebuild in case the timeout fired mid-tree.
        work.restore(st.snapshot());
        break;
      }
    }
    return best || moves[0];
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /**
   * Public entry point.
   * @param {GameState} state current game (not modified)
   * @param {number} player 0 or 1
   * @param {'easy'|'medium'|'hard'} level
   * @param {{r:number,c:number}[]} [recent] squares this pawn occupied recently
   * @returns {{type:'move',r,c}|{type:'wall',r,c,o}}
   */
  function chooseAction(state, player, level, recent) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const a = level === 'easy' ? chooseEasy(state, player, cfg) : chooseSearch(state, player, cfg, recent || []);
    return a.type === 'move'
      ? { type: 'move', r: a.r, c: a.c }
      : { type: 'wall', r: a.r, c: a.c, o: a.o };
  }

  const api = { chooseAction, evaluate, usefulWalls, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CorridorsAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
