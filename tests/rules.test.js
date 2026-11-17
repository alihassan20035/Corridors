// Run with: node tests/rules.test.js
const { GameState } = require('../games/corridors/game.js');
const AI = require('../games/corridors/ai.js');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }
const set = (moves) => moves.map(m => `${m.r},${m.c}${m.kind?':'+m.kind[0]:''}`).sort().join(' ');

// Opening position
let s = new GameState();
t('red start', s.pawns[0].r === 8 && s.pawns[0].c === 4);
t('blue start', s.pawns[1].r === 0 && s.pawns[1].c === 4);
t('red opening moves', set(s.legalPawnMoves(0)) === '7,4:s 8,3:s 8,5:s');
t('distances 8', s.distance(0) === 8 && s.distance(1) === 8);
t('cannot move blue on red turn', !s.apply({ type: 'move', r: 1, c: 4 }));
t('cannot move 2 squares', !s.apply({ type: 'move', r: 6, c: 4 }));
t('cannot move diagonally', !s.apply({ type: 'move', r: 7, c: 3 }));
t('legal step', s.apply({ type: 'move', r: 7, c: 4 }) && s.turn === 1 && s.moveCount === 1);

// Walls block movement
s = new GameState();
t('h wall placed', s.apply({ type: 'wall', r: 7, c: 3, o: 'h' })); // between rows 7/8, cols 3-4
t('wall count', s.wallsLeft[0] === 9);
s.turn = 0;
t('red blocked upward', set(s.legalPawnMoves(0)) === '8,3:s 8,5:s');
t('distance grew', s.distance(0) === 9);
// overlap / crossing
t('same slot illegal', !s.canPlaceWall(0, 7, 3, 'h'));
t('overlap right illegal', !s.canPlaceWall(0, 7, 4, 'h'));
t('overlap left illegal', !s.canPlaceWall(0, 7, 2, 'h'));
t('cross illegal', !s.canPlaceWall(0, 7, 3, 'v'));
t('adjacent ok', s.canPlaceWall(0, 7, 5, 'h'));
t('out of range', !s.canPlaceWall(0, 8, 0, 'h') && !s.canPlaceWall(0, -1, 0, 'v'));
// vertical walls
s = new GameState();
s.apply({ type: 'wall', r: 7, c: 4, o: 'v' }); // between cols 4/5 at rows 7,8
s.turn = 0;
t('v wall blocks right', set(s.legalPawnMoves(0)) === '7,4:s 8,3:s');
t('v overlap above illegal', !s.canPlaceWall(0, 6, 4, 'v'));
t('v ok two above', s.canPlaceWall(0, 5, 4, 'v'));

// Path validation: can't seal a player in
s = new GameState();
s.h.fill(0);
// Build a box around red at (8,4) leaving it trapped: walls h(7,3) covers cols3-4, v(7,4) right side, v(7,2) left of col3
s.h[7 * 8 + 3] = 1; s.v[7 * 8 + 4] = 1; // red at 8,4: up blocked, right blocked
// red can still go left to 8,3 -> up from 8,3 blocked (h 7,3 covers col 3), left to 8,2 -> up free
t('still path', s.distance(0) > 0);
t('sealing wall rejected', !s.canPlaceWall(0, 7, 2, 'v') || s.distance(0) > 0);
s.v[7 * 8 + 2] = 1; // seal manually (cols 2|3 at rows 7,8)
t('sealed = -1', s.distance(0) === -1);
s.v[7 * 8 + 2] = 0;
t('engine refuses seal', !s.canPlaceWall(1, 7, 2, 'v'));
t('wallProblem reason', /route/.test(s.wallProblem(1, 7, 2, 'v')));

// Jumps
s = new GameState();
s.pawns = [{ r: 5, c: 4 }, { r: 4, c: 4 }];
t('straight jump', set(s.legalPawnMoves(0)) === '3,4:j 5,3:s 5,5:s 6,4:s');
// wall behind blue -> diagonals
s.h[3 * 8 + 4] = 2; // blocks (3,4)<->(4,4)
t('diagonal when wall behind', set(s.legalPawnMoves(0)) === '4,3:d 4,5:d 5,3:s 5,5:s 6,4:s');
// diagonal side blocked by wall
s.v[3 * 8 + 4] = 0; s.v[4 * 8 + 4] = 2; // hmm would cross? only test move generation: blocks (4,4)<->(4,5)
t('one diagonal blocked', set(s.legalPawnMoves(0)) === '4,3:d 5,3:s 6,4:s'
  || console.log(set(s.legalPawnMoves(0))));
// Edge of board behind opponent
s = new GameState();
s.pawns = [{ r: 1, c: 4 }, { r: 0, c: 4 }];
t('edge -> diagonals', set(s.legalPawnMoves(0)) === '0,3:d 0,5:d 1,3:s 1,5:s 2,4:s');
// Horizontal jump
s = new GameState();
s.pawns = [{ r: 4, c: 4 }, { r: 4, c: 5 }];
t('side jump', set(s.legalPawnMoves(0)).includes('4,6:j'));
s.pawns = [{ r: 4, c: 7 }, { r: 4, c: 8 }];
t('side edge -> diagonals', set(s.legalPawnMoves(0)) === '3,7:s 3,8:d 4,6:s 5,7:s 5,8:d');
// wall between pawns: no jump
s = new GameState();
s.pawns = [{ r: 5, c: 4 }, { r: 4, c: 4 }];
s.h[4 * 8 + 4] = 1;
t('wall between -> no jump', set(s.legalPawnMoves(0)) === '5,3:s 5,5:s 6,4:s');

// Winning
s = new GameState();
s.pawns = [{ r: 1, c: 0 }, { r: 5, c: 8 }];
t('win move', s.apply({ type: 'move', r: 0, c: 0 }) && s.winner === 0 && s.turn === 0);
t('no actions after win', !s.apply({ type: 'move', r: 1, c: 0 }));
s = new GameState(); s.turn = 1; s.pawns[1] = { r: 7, c: 0 };
t('blue win', s.apply({ type: 'move', r: 8, c: 0 }) && s.winner === 1);

// Wall exhaustion
s = new GameState(); s.wallsLeft[0] = 0;
t('no walls left', !s.apply({ type: 'wall', r: 3, c: 3, o: 'h' }));

// Snapshot/restore (undo)
s = new GameState(); const snap = s.snapshot();
s.apply({ type: 'move', r: 7, c: 4 }); s.apply({ type: 'wall', r: 5, c: 5, o: 'v' });
s.restore(snap);
t('restore', s.turn === 0 && s.pawns[0].r === 8 && s.wallList().length === 0 && s.wallsLeft[1] === 10);

// AI returns legal actions in all levels
for (const lvl of ['easy', 'medium', 'hard']) {
  const g = new GameState(); g.turn = 1;
  const a = AI.chooseAction(g, 1, lvl);
  const ok = g.clone().apply(a);
  t('ai legal ' + lvl, ok);
}
// AI takes immediate win
s = new GameState(); s.turn = 1; s.pawns[1] = { r: 7, c: 2 };
for (const lvl of ['medium', 'hard']) {
  const a = AI.chooseAction(s, 1, lvl);
  t('ai takes win ' + lvl, a.type === 'move' && a.r === 8);
}
// AI blocks red who is one step from winning (blue far away, has walls)
s = new GameState(); s.turn = 1; s.pawns = [{ r: 1, c: 4 }, { r: 0, c: 0 }];
const blk = AI.chooseAction(s, 1, 'hard');
t('hard blocks imminent win', blk.type === 'wall');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
