// 出货展示跨设备 SSE（devServer 内嵌；日后可抽到部署服务）
// POST /api/collect/publish  { pair, msg }
// POST /api/collect/ping     { pair }  主游戏心跳
// GET  /api/collect/status?pair=
// GET  /api/collect/stream?pair=  (text/event-stream)

import { DEFAULT_COLLECT_PAIR } from '../prototype/src/collectPairDefault.js';

const pairs = new Map();
const HEARTBEAT_MS = 25_000;
const STATUS_PUSH_MS = 8_000;
/** 超过此时间无主游戏 ping / 出货 publish → gameActive=false（副屏提示回退） */
export const GAME_ACTIVE_MS = 22_000;

const pingLogThrottle = new Map();

function hubLog(pair, text) {
  console.log(`[collect][pair=${pair}] ${text}`);
}

function pairState(pairId) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  if (!pairs.has(id)) {
    pairs.set(id, { last: null, clients: new Set(), lastPublishAt: 0, gamePingAt: 0 });
  }
  return pairs.get(id);
}

function hubStatusPayload(pairId) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  const now = Date.now();
  const lastGame = Math.max(st.gamePingAt, st.lastPublishAt);
  return {
    schema: 1,
    type: 'collect.hub_status',
    ts: now,
    pair: id,
    displaySubscribers: st.clients.size,
    gameActive: lastGame > 0 && (now - lastGame) < GAME_ACTIVE_MS,
    lastEventType: st.last?.type ?? null,
  };
}

function writeAll(pairId, msg) {
  const st = pairState(pairId);
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of st.clients) {
    try { res.write(line); } catch { st.clients.delete(res); }
  }
}

function broadcastStatus(pairId) {
  writeAll(pairId, hubStatusPayload(pairId));
}

export function hubPublish(pairId, msg) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  st.last = msg;
  st.lastPublishAt = Date.now();
  const prize = msg.prize?.name ?? msg.prize?.id ?? '—';
  hubLog(id, `publish ${msg.type} · ${prize} → ${st.clients.size} 路副屏`);
  writeAll(id, msg);
  broadcastStatus(id);
}

/** 光学校准。不覆盖最后一条出货事件。 */
export function hubCalibrate(pairId, cal) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const msg = {
    schema: 1,
    type: 'frame.calibration',
    ts: Date.now(),
    pitch: num(cal.pitch),
    tan: num(cal.tan),
    offset: num(cal.offset),
    views: num(cal.views),
    viewWidth: num(cal.viewWidth),
    viewSpacing: num(cal.viewSpacing),
    focusDistance: num(cal.focusDistance),
    pattern: cal.pattern === true,
  };
  st.calibration = msg;
  hubLog(id, `calibrate pitch=${msg.pitch} offset=${msg.offset} → ${st.clients.size} 路副屏`);
  writeAll(id, msg);
}

export function hubGamePing(pairId) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  st.gamePingAt = Date.now();
  const now = Date.now();
  const lastLog = pingLogThrottle.get(id) ?? 0;
  if (now - lastLog > 60_000) {
    pingLogThrottle.set(id, now);
    hubLog(id, `主游戏心跳 · 副屏 ${st.clients.size} 路在线`);
  }
  broadcastStatus(id);
}

export function hubGetStatus(pairId) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  const now = Date.now();
  const lastGame = Math.max(st.gamePingAt, st.lastPublishAt);
  return {
    pair: id,
    displaySubscribers: st.clients.size,
    gameActive: lastGame > 0 && (now - lastGame) < GAME_ACTIVE_MS,
    lastPublishAt: st.lastPublishAt,
    lastEventType: st.last?.type ?? null,
  };
}

export function hubStream(pairId, res) {
  const id = pairId || DEFAULT_COLLECT_PAIR;
  const st = pairState(id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  st.clients.add(res);
  hubLog(id, `副屏 SSE 接入（共 ${st.clients.size} 路）`);
  if (st.last) res.write(`data: ${JSON.stringify(st.last)}\n\n`);
  if (st.calibration) res.write(`data: ${JSON.stringify(st.calibration)}\n\n`);
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
    hubLog(id, `副屏 SSE 断开（剩余 ${st.clients.size} 路）`);
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
    const pair = url.searchParams.get('pair') || DEFAULT_COLLECT_PAIR;
    hubStream(pair, res);
    return true;
  }
  if (path === '/api/collect/status' && req.method === 'GET') {
    const pair = url.searchParams.get('pair') || DEFAULT_COLLECT_PAIR;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(hubGetStatus(pair)));
    return true;
  }
  if (path === '/api/collect/ping' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      hubGamePing(body.pair || DEFAULT_COLLECT_PAIR);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return true;
  }
  if (path === '/api/collect/calibrate' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      hubCalibrate(body.pair || DEFAULT_COLLECT_PAIR, body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, subscribers: pairState(body.pair || DEFAULT_COLLECT_PAIR).clients.size }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    return true;
  }
  if (path === '/api/collect/publish' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const pair = body.pair || DEFAULT_COLLECT_PAIR;
      const msg = body.msg;
      if (!msg || msg.schema !== 1) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'invalid msg' }));
        return true;
      }
      hubPublish(pair, msg);
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
