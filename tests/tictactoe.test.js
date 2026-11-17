// node tests/tictactoe.test.js
const { TTTState } = require('../games/tic-tac-toe/game.js');
const AI = require('../games/tic-tac-toe/ai.js');
let pass=0, fail=0; const t=(n,c)=>{if(c)pass++;else{fail++;console.log('FAIL:',n)}};

let s=new TTTState();
t('X first', s.turn===0 && s.winner===-1);
t('9 available', s.available().length===9);
t('play X center', s.play(4) && s.cells[4]===1 && s.turn===1 && s.moveCount===1);
t('cant replay cell', !s.play(4));
s.play(0); // O
t('alternates', s.cells[0]===2 && s.turn===0);

// X wins top row via 1,2 (already has none)... build a row win
s=new TTTState();
s.play(0); s.play(3); s.play(1); s.play(4); // X:0,1 O:3,4
t('no winner yet', s.winner===-1);
s.play(2); // X completes 0,1,2
t('X wins row', s.winner===0 && s.winLine.join()==='0,1,2');
t('no moves after win', !s.play(5));

// Draw
s=new TTTState();
[0,1,2,4,3,5,7,6,8].forEach(i=>s.play(i)); // crafted draw
t('draw detected', s.winner===2);

// Diagonal win for O
s=new TTTState();
[1,0,3,4,6,8].forEach(i=>s.play(i)); // X:1,3,6 O:0,4,8 -> O diag 0,4,8
t('O diagonal win', s.winner===1 && s.winLine.join()==='0,4,8');

// Snapshot/restore
s=new TTTState(); const snap=s.snapshot(); s.play(4); s.play(0); s.restore(snap);
t('restore', s.moveCount===0 && s.turn===0 && s.available().length===9);

// AI helpers
s=new TTTState(); s.cells.set([1,1,0, 0,0,0, 0,0,0]); // X at 0,1 -> win at 2
t('winningCell finds win', AI.winningCell(s.cells,0)===2);

// Hard AI never loses: play 200 games vs random, AI as O (second), and as X
function randomGame(aiPlayer, level){
  const g=new TTTState();
  while(g.winner===-1){
    const mv = g.turn===aiPlayer ? AI.chooseMove(g,g.turn,level) : g.available()[Math.floor(Math.random()*g.available().length)];
    if(!g.play(mv)) throw new Error('illegal '+mv);
  }
  return g.winner;
}
let losses=0;
for(let i=0;i<300;i++){ const w=randomGame(i%2, 'hard'); const ai=i%2; if(w!==2 && w!==ai) losses++; }
t('hard AI never loses in 300 games', losses===0);

// Hard vs Hard always draws
let draws=0;
for(let i=0;i<20;i++){ const g=new TTTState(); while(g.winner===-1){ g.play(AI.chooseMove(g,g.turn,'hard')); } if(g.winner===2) draws++; }
t('hard vs hard always draw', draws===20);

// Hard AI takes immediate win
s=new TTTState(); s.cells.set([1,1,0, 2,2,0, 0,0,0]); s.turn=0; // X can win at 2
t('hard takes win', AI.chooseMove(s,0,'hard')===2);
// Hard AI blocks
s=new TTTState(); s.cells.set([2,2,0, 1,0,0, 0,0,0]); s.turn=0; // O threatens at 2, X must block
t('hard blocks', AI.chooseMove(s,0,'hard')===2);
// Medium blocks
s=new TTTState(); s.cells.set([2,2,0, 1,0,0, 0,0,0]); s.turn=0;
t('medium blocks', AI.chooseMove(s,0,'medium')===2);

// All levels return legal moves from any position
for(const lvl of ['easy','medium','hard']){
  for(let k=0;k<50;k++){ const g=new TTTState(); const n=Math.floor(Math.random()*5); for(let m=0;m<n && g.winner===-1;m++) g.play(g.available()[0]); if(g.winner!==-1) continue; const mv=AI.chooseMove(g,g.turn,lvl); if(!g.isLegal(mv)){t('legal '+lvl,false); break;} }
}
t('all levels legal', true);


// ---- 5x5 (win 4) ----
let g5 = new TTTState(5);
t('5x5 size', g5.size===5 && g5.win===4 && g5.cells.length===25);
t('5x5 25 available', g5.available().length===25);
// Build a horizontal 4-in-row for X at row0 cols0-3
g5 = new TTTState(5);
[0,5,1,6,2,7,3].forEach(i=>g5.play(i)); // X:0,1,2,3 O:5,6,7 -> X wins row 0..3
t('5x5 four in a row win', g5.winner===0 && g5.winLine.join()==='0,1,2,3');
// Not a win with only 3
g5 = new TTTState(5);
[0,10,1,11,2].forEach(i=>g5.play(i));
t('5x5 three not enough', g5.winner===-1);
// Diagonal 4-in-row
g5 = new TTTState(5);
[0,1,6,2,12,3,18].forEach(i=>g5.play(i)); // X:0,6,12,18 diagonal (step 6) O:1,2,3
t('5x5 diagonal win', g5.winner===0 && g5.winLine.join()==='0,6,12,18');
// snapshot carries size
g5 = new TTTState(5); g5.play(12);
const snap5 = g5.snapshot(); t('5x5 snapshot size', snap5.size===5 && snap5.win===4);
const r5 = new TTTState(); r5.restore(snap5); t('5x5 restore size', r5.size===5 && r5.cells[12]===1);
// AI: hard takes immediate 4-in-row win on 5x5
g5 = new TTTState(5); g5.cells.set([1,1,1,0,0, 2,2,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0]); g5.turn=0;
t('5x5 hard takes win', AI.chooseMove(g5,0,'hard')===3);
// AI: hard blocks opponent's 4th
g5 = new TTTState(5); g5.cells.set([2,2,2,0,0, 1,1,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0]); g5.turn=0;
t('5x5 hard blocks', AI.chooseMove(g5,0,'hard')===3);
t('5x5 medium blocks', AI.chooseMove(g5,0,'medium')===3);
// AI returns legal moves at all levels on 5x5, and is reasonably fast
let t0=Date.now(), slow=0;
for(const lvl of ['easy','medium','hard']){
  for(let k=0;k<8;k++){ const g=new TTTState(5); let steps=Math.floor(Math.random()*6); for(let m=0;m<steps && g.winner===-1;m++) g.play(g.available()[Math.floor(Math.random()*g.available().length)]); if(g.winner!==-1) continue; const t1=Date.now(); const mv=AI.chooseMove(g,g.turn,lvl); if(Date.now()-t1>1500) slow++; if(!g.isLegal(mv)){t('5x5 legal '+lvl,false);} }
}
t('5x5 AI legal + fast', slow===0);
// A full 5x5 hard-vs-hard game terminates (win or draw)
let g=new TTTState(5), steps=0;
while(g.winner===-1 && steps<25){ g.play(AI.chooseMove(g,g.turn,'hard')); steps++; }
t('5x5 hard vs hard terminates', g.winner!==-1);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
