// 出货展示跨设备 SSE（devServer 内嵌；日后可抽到部署服务）
// POST /api/collect/publish  { room, msg }
// POST /api/collect/ping     { room }  主游戏心跳
// GET  /api/collect/status?room=
// GET  /api/collect/stream?room=  (text/event-stream)

const rooms = new Map();
const HEARTBEAT_MS = 25_000;
const STATUS_PUSH_MS = 8_000;
const GAME_ACTIVE_MS = 22_000;

function roomState(roomId) {
  const id = roomId || 'default';
  if (!rooms.has(id)) {
    rooms.set(id, { last: null, clients: new Set(), lastPublishAt: 0, gamePingAt: 0 });
  }
  return rooms.get(id);
}

function hubStatusPayload(roomId) {
  const id = roomId || 'default';
  const st = roomState(id);
  const now = Date.now();
  const lastGame = Math.max(st.gamePingAt, st.lastPublishAt);
  return {
    schema: 1,
    type: 'collect.hub_status',
    ts: now,
    room: id,
    displaySubscribers: st.clients.size,
    gameActive: lastGame > 0 && (now - lastGame) < GAME_ACTIVE_MS,
    lastEventType: st.last?.type ?? null,
  };
}

function broadcastStatus(roomId) {
  const st = roomState(roomId);
  const line = `data: ${JSON.stringify(hubStatusPayload(roomId))}\n\n`;
  for (const res of st.clients) {
    try { res.write(line); } catch { st.clients.delete(res); }
  }
}

export function hubPublish(roomId, msg) {
  const st = roomState(roomId);
  st.last = msg;
  st.lastPublishAt = Date.now();
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of st.clients) {
    try { res.write(line); } catch { st.clients.delete(res); }
  }
  broadcastStatus(roomId);
}

export function hubGamePing(roomId) {
  const st = roomState(roomId);
  st.gamePingAt = Date.now();
  broadcastStatus(roomId);
}

export function hubGetStatus(roomId) {
  const id = roomId || 'default';
  const st = roomState(id);
  const now = Date.now();
  const lastGame = Math.max(st.gamePingAt, st.lastPublishAt);
  return {
    room: id,
    displaySubscribers: st.clients.size,
    gameActive: lastGame > 0 && (now - lastGame) < GAME_ACTIVE_MS,
    lastPublishAt: st.lastPublishAt,
    lastEventType: st.last?.type ?? null,
  };
}

export function hubStream(roomId, res) {
  const id = roomId || 'default';
  const st = roomState(id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  st.clients.add(res);
  if (st.last) res.write(`data: ${JSON.stringify(st.last)}\n\n`);
  res.write(`data: ${JSON.stringify(hubStatusPayload(id))}\n\n`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {
      clearInterval(ping);
      st.clients.delete(res);
    }
  }, HEARTBEAT_MS);

  const statusIv = setInterval(() => broadcastStatus(id), STATUS_PUSH_MS);

  res.on('close', () => {
    clearInterval(ping);
    clearInterval(statusIv);
    st.clients.delete(res);
    broadcastStatus(id);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** @returns {boolean} handled */
export async function handleCollectApi(req, res, url) {
  const path = url.pathname;
  if (path === '/api/collect/stream' && req.method === 'GET') {
    const room = url.searchParams.get('room') || 'default';
    hubStream(room, res);
    return true;
  }
  if (path === '/api/collect/status' && req.method === 'GET') {
    const room = url.searchParams.get('room') || 'default';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(hubGetStatus(room)));
    return true;
  }
  if (path === '/api/collect/ping' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      hubGamePing(body.room || 'default');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return true;
  }
  if (path === '/api/collect/publish' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const room = body.room || 'default';
      const msg = body.msg;
      if (!msg || msg.schema !== 1) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'invalid msg' }));
        return true;
      }
      hubPublish(room, msg);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return true;
  }
  if (path.startsWith('/api/collect/') && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }
  return false;
}
