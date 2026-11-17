// Run with: node tests/selfplay.js [games]
const { GameState } = require('../games/corridors/game.js');
const AI = require('../games/corridors/ai.js');
const games = +process.argv[2] || 6;
function play(redLvl, blueLvl) {
  const g = new GameState(); let maxT = 0, plies = 0; const hist = [[], []];
  while (g.winner === -1 && plies < 400) {
    const lvl = g.turn === 0 ? redLvl : blueLvl;
    const t0 = Date.now();
    const a = AI.chooseAction(g, g.turn, lvl, hist[g.turn].slice(-4));
    hist[g.turn].push({ ...g.pawns[g.turn] });
    maxT = Math.max(maxT, Date.now() - t0);
    if (!g.apply(a)) throw new Error('illegal ' + JSON.stringify(a));
    plies++;
  }
  return { winner: g.winner, plies, maxT, walls: 20 - g.wallsLeft[0] - g.wallsLeft[1] };
}
for (const [a, b] of [['hard','easy'],['hard','medium'],['medium','easy'],['easy','easy']]) {
  let wA = 0, wB = 0, draws = 0, maxT = 0, plies = 0, walls = 0;
  for (let i = 0; i < games; i++) {
    // alternate colours
    const swap = i % 2 === 1;
    const r = swap ? play(b, a) : play(a, b);
    maxT = Math.max(maxT, r.maxT); plies += r.plies; walls += r.walls;
    if (r.winner === -1) draws++;
    else if ((r.winner === 0) !== swap) wA++; else wB++;
  }
  console.log(`${a} vs ${b}: ${wA}-${wB} (unfinished ${draws}), avg plies ${(plies/games).toFixed(0)}, avg walls ${(walls/games).toFixed(1)}, max think ${maxT}ms`);
}
