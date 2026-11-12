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
  t('serves game.js', (await fetch(base + '/game.js')).status === 200);
  t('serves sound', (await fetch(base + '/assets/sounds/move.wav')).headers.get('content-type') === 'audio/wav');
  t('hides server.js', (await fetch(base + '/server.js')).status === 404);
  t('hides package.json', (await fetch(base + '/package.json')).status === 404);
  t('blocks traversal', (await fetch(base + '/assets/../server.js')).status === 404);

  const A = client(url), B = client(url), C = client(url);
  await Promise.all([A.ready, B.ready, C.ready]);

  A.send({ t: 'create', name: 'Ali' });
  const created = await A.next(is('created'));
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

  // Many rooms get unique ids
  const ids = new Set();
  const D = client(url); await D.ready;
  for (let i = 0; i < 30; i++) { D.send({ t: 'create', name: 'x' }); ids.add((await D.next(is('created'))).room); }
  t('unique ids', ids.size === 30);

  console.log(`${pass} passed, ${fail} failed`);
  for (const c of [A, B2, C, D]) c.ws.terminate();
  server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
