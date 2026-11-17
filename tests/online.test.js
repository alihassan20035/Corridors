// Run with: node tests/online.test.js   (starts its own server on a random port)
const WebSocket = require('ws');
process.env.PORT = 0;
const { server, rooms } = require('../server.js');
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex(w => w.pred(m));
    if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.to); w.res(m); } else inbox.push(m);
  });
  return {
    ws,
    ready: new Promise(r => ws.on('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next: (pred, ms = 2000) => new Promise((res, rej) => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return res(inbox.splice(i, 1)[0]);
      const w = { pred, res, to: setTimeout(() => rej(new Error('timeout waiting')), ms) };
      waiters.push(w);
    }),
    drain: () => inbox.splice(0),
  };
}
const is = (type, extra = () => true) => (m) => m.t === type && extra(m);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${server.address().port}/ws`;

  // Static files: allowed vs. private
  const base = `http://127.0.0.1:${server.address().port}`;
  t('serves index', (await fetch(base + '/')).status === 200);
  t('serves portal', (await fetch(base + '/portal.css')).status === 200);
  t('serves corridors game.js', (await fetch(base + '/games/corridors/game.js')).status === 200);
  t('serves sound', (await fetch(base + '/games/corridors/assets/sounds/move.wav')).headers.get('content-type') === 'audio/wav');
  t('hides server.js', (await fetch(base + '/server.js')).status === 404);
  t('hides package.json', (await fetch(base + '/package.json')).status === 404);
  t('hides node_modules', (await fetch(base + '/node_modules/ws/package.json')).status === 404);
  t('hides tests', (await fetch(base + '/tests/online.test.js')).status === 404);
  t('serves tic-tac-toe', (await fetch(base + '/games/tic-tac-toe/game.js')).status === 200);
  t('blocks traversal', (await fetch(base + '/assets/../server.js')).status === 404);

  const A = client(url), B = client(url), C = client(url);
  await Promise.all([A.ready, B.ready, C.ready]);

  A.send({ t: 'chat', text: 'hello' });
  t('chat outside room refused', (await A.next(is('error'))).code === 'noroom');
  A.send({ t: 'create', name: 'Ali' });
  const created = await A.next(is('created'));
  A.send({ t: 'chat', text: 'anyone?' });
  t('chat before friend joins refused', (await A.next(is('error'))).code === 'wait');
  t('5-digit room id', /^[1-9]\d{4}$/.test(created.room));
  const s0 = await A.next(is('state'));
  t('waiting state', s0.ready === false && s0.you === 0);

  B.send({ t: 'join', room: '1234' });
  t('bad code rejected', (await B.next(is('error'))).code === 'code');
  B.send({ t: 'join', room: created.room === '99999' ? '10000' : '99999' });
  t('missing room', (await B.next(is('error'))).code === 'missing');

  B.send({ t: 'join', room: created.room, name: 'Sara' });
  const joined = await B.next(is('joined'));
  t('joined as blue', joined.you === 1);
  const sa = await A.next(is('state', m => m.ready)), sb = await B.next(is('state', m => m.ready));
  t('both see names', sa.names.join() === 'Ali,Sara' && sb.names.join() === 'Ali,Sara');
  t('A told B joined', (await A.next(is('notice'))).kind === 'joined');

  C.send({ t: 'join', room: created.room, name: 'Eve' });
  t('room full', (await C.next(is('error'))).code === 'full');

  // Turn order enforced
  B.send({ t: 'action', action: { type: 'move', r: 1, c: 4 } });
  t('blue cannot move first', (await B.next(is('error'))).code === 'turn');
  // Illegal move rejected
  A.send({ t: 'action', action: { type: 'move', r: 5, c: 4 } });
  t('illegal move rejected', (await A.next(is('error'))).code === 'illegal');
  A.drain();
  // Legal move broadcast to both
  A.send({ t: 'action', action: { type: 'move', r: 7, c: 4 } });
  const ea = await A.next(is('action')), eb = await B.next(is('action'));
  t('move echoed to both', ea.moveCount === 1 && eb.action.r === 7 && eb.by === 0);
  // Wall by blue
  B.send({ t: 'action', action: { type: 'wall', r: 6, c: 4, o: 'h' } });
  const wa = await A.next(is('action'));
  t('wall reaches red', wa.action.type === 'wall' && wa.action.o === 'h');
  await B.next(is('action'));
  // Overlapping wall rejected
  A.send({ t: 'action', action: { type: 'wall', r: 6, c: 4, o: 'h' } });
  t('overlap rejected', (await A.next(is('error'))).code === 'illegal');
  A.drain();

  // Chat and emoji
  A.drain(); B.drain();
  A.send({ t: 'chat', text: '  Nice   move!\n ' });
  const ca = await A.next(is('chat')), cb = await B.next(is('chat'));
  t('chat reaches both', ca.text === 'Nice move!' && cb.text === 'Nice move!' && cb.by === 0 && cb.name === 'Ali' && cb.kind === 'text');
  B.send({ t: 'emoji', e: '🔥' });
  const ea2 = await A.next(is('chat'));
  t('emoji reaches friend', ea2.kind === 'emoji' && ea2.text === '🔥' && ea2.by === 1);
  await B.next(is('chat'));
  B.send({ t: 'emoji', e: '💩' });
  t('unknown emoji refused', (await B.next(is('error'))).code === 'bad');
  A.send({ t: 'chat', text: 'x'.repeat(121) });
  t('long message refused', (await A.next(is('error'))).code === 'long');
  A.send({ t: 'chat', text: '<img src=x onerror=alert(1)>' });
  t('html kept as plain text', (await B.next(is('chat'))).text === '<img src=x onerror=alert(1)>');
  for (let i = 0; i < 6; i++) A.send({ t: 'chat', text: 'spam ' + i });
  t('rate limit kicks in', (await A.next(is('error', m => m.code === 'slow'))).code === 'slow');
  await new Promise(r => setTimeout(r, 300));
  A.drain(); B.drain();

  // Disconnect and rejoin with token
  B.ws.terminate();
  t('A sees friend away', (await A.next(is('notice', m => m.kind === 'away'))).name === 'Sara');
  const B2 = client(url); await B2.ready;
  B2.send({ t: 'rejoin', room: created.room, token: joined.token });
  await B2.next(is('rejoined'));
  const sb2 = await B2.next(is('state'));
  t('rejoin restores position', sb2.snap.moveCount === 2 && sb2.snap.pawns[0].r === 7 && sb2.connected[1]);
  t('A sees friend back', (await A.next(is('notice', m => m.kind === 'back'))).name === 'Sara');
  B2.send({ t: 'rejoin', room: created.room, token: 'wrong' });
  t('bad token refused', (await B2.next(is('error'))).code === 'gone');

  // Play to a finish quickly by forcing positions on the server copy
  const room = rooms.get(created.room);
  room.game.pawns[0] = { r: 1, c: 0 };
  A.send({ t: 'action', action: { type: 'move', r: 0, c: 0 } });
  const fin = await B2.next(is('action'));
  t('winning move broadcast', fin.action.r === 0 && room.game.winner === 0);
  A.send({ t: 'action', action: { type: 'move', r: 1, c: 0 } });
  t('no moves after win', (await A.next(is('error'))).code === 'over');

  // Rematch needs both
  A.drain(); B2.drain();
  A.send({ t: 'rematch' });
  t('offer reaches friend', (await B2.next(is('notice', m => m.kind === 'rematch-offer'))).name === 'Ali');
  B2.send({ t: 'rematch' });
  const ns = await A.next(is('state'));
  t('rematch resets board', ns.snap.moveCount === 0 && ns.snap.winner === -1 && ns.snap.wallsLeft[0] === 10);

  // Leaving closes the room for the friend
  B2.drain();
  A.send({ t: 'leave' });
  const closed = await B2.next(is('closed'));
  t('friend told room closed', !!closed.reason && !rooms.has(created.room));

  // Tic-Tac-Toe online: separate game type in the same room system
  const TA = client(url), TB = client(url), XC = client(url);
  await Promise.all([TA.ready, TB.ready, XC.ready]);
  TA.send({ t: 'create', game: 'tictactoe', name: 'Ali' });
  const tcreated = await TA.next(is('created'));
  t('ttt room created with game', tcreated.game === 'tictactoe' && /^[1-9]\d{4}$/.test(tcreated.room));
  const ts0 = await TA.next(is('state'));
  t('ttt state carries game', ts0.game === 'tictactoe' && ts0.names[1] === 'O');
  // Wrong game cannot join a tictactoe room
  XC.send({ t: 'join', game: 'corridors', room: tcreated.room });
  t('wrong game rejected', (await XC.next(is('error'))).code === 'wrong-game');
  TB.send({ t: 'join', game: 'tictactoe', room: tcreated.room, name: 'Sara' });
  const tjoined = await TB.next(is('joined'));
  t('ttt joined', tjoined.you === 1 && tjoined.game === 'tictactoe');
  await TA.next(is('state', m => m.ready)); await TB.next(is('state', m => m.ready)); await TA.next(is('notice'));
  // X cannot be placed by O first
  TB.send({ t: 'action', action: { type: 'place', i: 0 } });
  t('ttt O cannot move first', (await TB.next(is('error'))).code === 'turn');
  // Corridors-style action rejected on a tictactoe room
  TA.send({ t: 'action', action: { type: 'move', r: 7, c: 4 } });
  t('ttt rejects wrong action type', (await TA.next(is('error'))).code === 'bad');
  // Play to an X win: X at 0,1,2 ; O at 3,4
  TA.drain(); TB.drain();
  for (const [who, i] of [[TA,0],[TB,3],[TA,1],[TB,4],[TA,2]]) {
    who.send({ t: 'action', action: { type: 'place', i } });
    await TA.next(is('action')); await TB.next(is('action'));
  }
  const troom = rooms.get(tcreated.room);
  t('ttt X wins on server', troom.game.winner === 0 && troom.game.cells[0] === 1);
  TB.send({ t: 'action', action: { type: 'place', i: 5 } });
  t('ttt no move after win', (await TB.next(is('error'))).code === 'over');
  // Chat works in ttt rooms
  TA.send({ t: 'chat', text: 'gg' });
  t('ttt chat delivered', (await TB.next(is('chat'))).text === 'gg');
  await TA.next(is('chat'));
  // Rematch resets the ttt board
  TA.drain(); TB.drain();
  TA.send({ t: 'rematch' }); await TB.next(is('notice', m => m.kind === 'rematch-offer'));
  TB.send({ t: 'rematch' });
  const tns = await TA.next(is('state'));
  t('ttt rematch resets', tns.snap.moveCount === 0 && tns.snap.winner === -1 && tns.snap.cells.every(c => c === 0));
  // 5x5 room carries its size through state and rematch
  const FA = client(url), FB = client(url);
  await Promise.all([FA.ready, FB.ready]);
  FA.send({ t: 'create', game: 'tictactoe', size: 5, name: 'Big' });
  const fc = await FA.next(is('created'));
  await FA.next(is('state'));
  FB.send({ t: 'join', game: 'tictactoe', room: fc.room });
  await FB.next(is('joined'));
  const fs = await FB.next(is('state', m => m.ready));
  t('5x5 room snapshot size', fs.snap.size === 5 && fs.snap.win === 4 && fs.snap.cells.length === 25);
  FA.ws.terminate(); FB.ws.terminate();

  for (const c of [TA, TB, XC]) c.ws.terminate();

  // Many rooms get unique ids
  const ids = new Set();
  const D = client(url); await D.ready;
  for (let i = 0; i < 30; i++) { D.send({ t: 'create', name: 'x' }); ids.add((await D.next(is('created'))).room); }
  t('unique ids', ids.size === 30);

  console.log(`${pass} passed, ${fail} failed`);
  for (const c of [A, B2, C, D]) c.ws.terminate();
  server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
