/* ==========================================================================
   online.js — WebSocket connection to the Corridors server
   --------------------------------------------------------------------------
   Small wrapper that:
     * connects to ws(s)://<same host>/ws,
     * reconnects automatically with back-off when the network drops,
     * remembers { room, token } in sessionStorage so a page refresh or a
       reconnect puts the player straight back in their seat.
   The UI (script.js) supplies handlers; this file knows nothing about the board.
   ========================================================================== */
(function (root) {
  'use strict';

  const SESSION_KEY = 'corridors.online';

  const session = {
    get() {
      try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
    },
    set(v) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } },
  };

  /** Online play needs the page to be served by server.js over http(s). */
  function available() {
    return /^https?:$/.test(location.protocol) && 'WebSocket' in root;
  }

  class Connection {
    /**
     * @param {object} h handlers: onMessage(msg), onStatus('connecting'|'open'|'down')
     */
    constructor(h) {
      this.h = h;
      this.ws = null;
      this.queue = [];       // messages sent while the socket was not open yet
      this.retry = 0;
      this.closedByUser = false;
      this.timer = null;
      this.keepAlive = null;
    }

    url() {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }

    open() {
      this.closedByUser = false;
      clearTimeout(this.timer);
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      this.h.onStatus('connecting');
      let ws;
      try { ws = new WebSocket(this.url()); } catch (e) { this.scheduleRetry(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        this.h.onStatus('open');
        const s = session.get();
        // Rejoin first so queued actions go to the right seat.
        if (s && s.room && s.token && !this.queue.some(m => m.t === 'create' || m.t === 'join')) {
          this.raw({ t: 'rejoin', room: s.room, token: s.token });
        }
        const q = this.queue; this.queue = [];
        for (const m of q) this.raw(m);
        clearInterval(this.keepAlive);
        this.keepAlive = setInterval(() => this.raw({ t: 'ping' }), 25000);
      };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.t === 'pong') return;
        if (msg.t === 'created' || msg.t === 'joined') session.set({ room: msg.room, token: msg.token });
        if (msg.t === 'closed' || msg.t === 'left' || (msg.t === 'error' && msg.code === 'gone')) session.clear();
        this.h.onMessage(msg);
      };
      ws.onclose = () => {
        clearInterval(this.keepAlive);
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.closedByUser) return;
        this.h.onStatus('down');
        this.scheduleRetry();
      };
      ws.onerror = () => { /* onclose follows */ };
    }

    scheduleRetry() {
      if (this.closedByUser) return;
      const delay = Math.min(8000, 600 * Math.pow(1.6, this.retry++));
      this.timer = setTimeout(() => this.open(), delay);
    }

    raw(msg) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
      else this.queue.push(msg);
    }

    send(msg) { this.raw(msg); if (!this.ws) this.open(); }

    /** Leave the room on purpose and stop reconnecting. */
    close() {
      this.closedByUser = true;
      clearTimeout(this.timer); clearInterval(this.keepAlive);
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) { /* ignore */ }
      }
      const ws = this.ws; this.ws = null; this.queue = [];
      if (ws) setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } }, 50);
      session.clear();
    }
  }

  root.CorridorsOnline = { Connection, available, session };
})(window);
