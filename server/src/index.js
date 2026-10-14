/* Tierras de Hexaria: servidor de salas.
 * Un Durable Object por partida (código de 5 letras). Hace de relé entre los jugadores, guarda el último
 * estado de la partida para que cualquiera pueda volver, y elige quién hace de anfitrión (el humano conectado
 * con el asiento más bajo). Las reglas las siguen ejecutando los clientes; el servidor no toca el estado.
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join('');
const TTL = 36 * 3600 * 1000;   // una sala sin actividad se borra pasadas 36 h

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'hexaria-server', time: Date.now() });
    if (url.pathname === '/new') {                                   // código nuevo garantizado libre
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const info = await (await stub.fetch('https://room/info')).json();
        if (!info.exists) return json({ code });
      }
      return json({ error: 'No se pudo generar un código' }, 500);
    }
    const m = url.pathname.match(/^\/r\/([A-Z0-9]{5})(?:\/(\w+))?$/i);
    if (!m) return json({ error: 'Ruta desconocida' }, 404);
    const code = m[1].toUpperCase();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const target = new URL('https://room/' + (m[2] || 'ws'));
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    return stub.fetch(new Request(target.toString(), req));
  }
};

export class Room {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.origin = new Map();                                        // id de pregunta → socket que la hizo
    this.state.blockConcurrencyWhile(async () => {
      this.data = (await this.state.storage.get('data')) || { lobby: [], cfg: null, G: null, theme: null, names: null, created: Date.now(), touched: Date.now(), exists: false };
    });
  }
  async save() { this.data.touched = Date.now(); await this.state.storage.put('data', this.data); await this.state.storage.setAlarm(Date.now() + TTL); }
  async alarm() { if (Date.now() - this.data.touched >= TTL - 60000) { await this.state.storage.deleteAll(); } else await this.state.storage.setAlarm(this.data.touched + TTL); }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/info') return json({ exists: this.data.exists, players: this.data.lobby.length, started: !!this.data.G, cfg: this.data.cfg, over: !!(this.data.G && this.data.G.phase === 'over') });
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Se esperaba un WebSocket' }, 426);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, name: '', id: crypto.randomUUID() });
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- utilidades ---
  sockets() { return this.state.getWebSockets(); }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  setAtt(ws, a) { ws.serializeAttachment(a); }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }
  broadcast(msg, except) { for (const ws of this.sockets()) if (ws !== except && this.att(ws).seat !== null) this.send(ws, msg); }
  bySeat(seat) { return this.sockets().find(ws => this.att(ws).seat === seat); }
  hostSeat() { const seats = this.sockets().map(ws => this.att(ws).seat).filter(s => s !== null); return seats.length ? Math.min(...seats) : null; }
  lobbyMsg() { return { t: 'lobby', players: this.data.lobby.map(l => ({ name: l.name, seat: l.seat, online: !!this.bySeat(l.seat) })), cfg: this.data.cfg }; }
  announceHost() { const h = this.hostSeat(); if (h !== this.lastHost) { this.lastHost = h; this.broadcast({ t: 'host', seat: h }); } }

  async webSocketMessage(ws, raw) {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    const a = this.att(ws);
    if (msg.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
    if (msg.t === 'hello') {
      const name = String(msg.name || 'Invitado').slice(0, 14);
      if (!this.data.exists && !msg.cfg) { this.send(ws, { t: 'full', reason: 'Esa sala no existe o ha caducado.' }); return; }
      if (this.data.G && this.data.G.phase === 'over') { this.send(ws, { t: 'full', reason: 'Esa partida ya terminó.' }); return; }
      if (!this.data.exists) {                                        // primer jugador: crea la sala con sus ajustes
        this.data.exists = true; this.data.cfg = msg.cfg || { players: 4, mode: 'classic', difficulty: 'normal', vp: 10, theme: 'medieval' };
      }
      let seat = null;
      const wanted = typeof msg.seat === 'number' ? msg.seat : null;
      let back = wanted !== null ? this.data.lobby.find(l => l.seat === wanted) : null;
      if (!back && name) { const same = this.data.lobby.find(l => l.name.toLowerCase() === name.toLowerCase() && !this.bySeat(l.seat)); if (same) back = same; }   // mismo nombre y asiento sin conexión: es él que vuelve
      if (back) { seat = back.seat; back.name = name || back.name; }
      else if (this.data.G) {                                         // partida empezada: solo se puede entrar en un asiento que quedó libre
        const free = this.data.G.players.map(p => p.id).filter(id => !this.data.lobby.some(l => l.seat === id));
        if (wanted !== null && free.includes(wanted)) seat = wanted; else if (free.length && msg.allowFree) seat = free[0];
        if (seat === null) { this.send(ws, { t: 'full', reason: 'La partida ya ha empezado.' }); return; }
        this.data.lobby.push({ seat, name });
      } else {
        const max = Math.max(2, Math.min(4, this.data.cfg.players || 4));
        if (this.data.lobby.length >= max) { this.send(ws, { t: 'full', reason: 'La sala está completa.' }); return; }
        seat = [0, 1, 2, 3].find(s => !this.data.lobby.some(l => l.seat === s));
        this.data.lobby.push({ seat, name });
      }
      const prev = this.bySeat(seat); if (prev && prev !== ws) { try { prev.close(4000, 'Sesión sustituida'); } catch (e) {} }
      this.setAtt(ws, { ...a, seat, name });
      await this.save();
      this.send(ws, { t: 'seat', seat, code: this.data.code });
      this.broadcast(this.lobbyMsg());
      this.lastHost = undefined; this.announceHost();
      if (this.data.G) {
        this.send(ws, { t: 'start', G: this.data.G, theme: this.data.theme, names: this.data.names, resume: true });
        const h = this.hostSeat(); const hws = h !== null ? this.bySeat(h) : null;
        if (hws && hws !== ws) this.send(hws, { t: 'back', seat, name });
      }
      return;
    }
    if (a.seat === null) return;                                      // sin asiento no se hace nada más
    if (msg.t === 'rename') { const l = this.data.lobby.find(x => x.seat === a.seat); if (l && !this.data.G) { l.name = String(msg.name || '').slice(0, 14) || l.name; this.setAtt(ws, { ...a, name: l.name }); await this.save(); this.broadcast(this.lobbyMsg()); } return; }
    if (msg.t === 'cfg') { if (a.seat === this.hostSeat() && !this.data.G && msg.cfg) { this.data.cfg = { ...this.data.cfg, ...msg.cfg }; await this.save(); this.broadcast(this.lobbyMsg()); } return; }
    if (msg.t === 'start') { if (a.seat !== this.hostSeat() || !msg.G) return; this.data.G = msg.G; this.data.theme = msg.theme; this.data.names = msg.names; await this.save(); this.broadcast({ ...msg }, ws); return; }
    if (msg.t === 'sync' || msg.t === 'next') { if (msg.G) { this.data.G = msg.G; await this.save(); } this.broadcast(msg, ws); return; }
    if (msg.t === 'ask') { const to = this.bySeat(msg.to); if (to) { this.origin.set(msg.id, ws); this.send(to, msg); } else this.send(ws, { t: 'reply', id: msg.id, result: null }); return; }
    if (msg.t === 'reply') { const o = this.origin.get(msg.id); if (o) { this.origin.delete(msg.id); this.send(o, msg); } return; }
    if (msg.t === 'leave') { if (!this.data.G) { this.data.lobby = this.data.lobby.filter(l => l.seat !== a.seat); await this.save(); } this.setAtt(ws, { ...a, seat: null }); try { ws.close(1000, 'bye'); } catch (e) {} this.broadcast(this.lobbyMsg()); this.announceHost(); return; }
    if (msg.t === 'reset') { if (a.seat === this.hostSeat() && this.data.G && this.data.G.phase === 'over') { this.data.G = null; await this.save(); this.broadcast(this.lobbyMsg()); } return; }
  }
  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const a = this.att(ws); if (a.seat === null) return;
    this.setAtt(ws, { ...a, seat: null });
    if (!this.data.G) { this.data.lobby = this.data.lobby.filter(l => l.seat !== a.seat); this.save(); }
    this.broadcast(this.lobbyMsg());
    this.announceHost();
    if (this.data.G) { const h = this.hostSeat(); const hws = h !== null ? this.bySeat(h) : null; if (hws) this.send(hws, { t: 'left', seat: a.seat, name: a.name }); }
  }
}
