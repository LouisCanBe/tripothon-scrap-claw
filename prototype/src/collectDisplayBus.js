// 出货展示屏联动：同机 BC + 跨设备 SSE（devServer /api/collect/*）
import { CONFIG } from './config.js';
import { GLB_MANIFEST } from './assets.manifest.js';
import { poolVisualScale } from './prizePool.js';
import { resolveBounceMaterial } from './collectBouncePresets.js';

const SCHEMA = 1;
const LS_KEY = 'tripo.collectDisplay.last';

function channelName() {
  return CONFIG.collectDisplay?.channel ?? 'tripo.collect-display.v1';
}

let _bc = null;
function getChannel({ listen = false } = {}) {
  if (!listen && !CONFIG.collectDisplay?.enabled) return null;
  try {
    if (!_bc) _bc = new BroadcastChannel(channelName());
    return _bc;
  } catch {
    return null;
  }
}

/** URL ?room= 优先，其次 config.roomId */
export function resolveCollectRoom() {
  try {
    const q = new URLSearchParams(location.search).get('room');
    if (q) return q;
  } catch { /* ignore */ }
  return CONFIG.collectDisplay?.roomId ?? 'default';
}

function transport() {
  return CONFIG.collectDisplay?.transport ?? 'auto';
}

export function shouldUseRemotePublish() {
  if (!CONFIG.collectDisplay?.enabled) return false;
  const t = transport();
  if (t === 'local') return false;
  if (typeof location === 'undefined' || location.protocol === 'file:') return false;
  return true;
}

export function shouldUseRemoteSubscribe() {
  if (!CONFIG.collectDisplay?.enabled) return false;
  const t = transport();
  if (t === 'local') return false;
  if (typeof location === 'undefined' || location.protocol === 'file:') return false;
  if (t === 'lan') return true;
  return /display\.html/i.test(location.pathname || '');
}

/** @param {object} item prizePool 条目 */
export function itemToPrizePayload(item) {
  const id = item.id;
  return {
    id,
    name: item.name,
    category: item.category,
    quest: !!item.quest,
    glbUrl: GLB_MANIFEST[id] ?? null,
    visualScale: poolVisualScale(),
    bounceMaterial: resolveBounceMaterial(item),
  };
}

function envelope(type, prize, extra = {}) {
  return {
    schema: SCHEMA,
    type,
    ts: Date.now(),
    room: resolveCollectRoom(),
    prize,
    outlet: { kind: CONFIG.collectDisplay?.outletKind ?? 'hole', version: 1 },
    ...extra,
  };
}

function persist(msg) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(msg));
  } catch { /* ignore */ }
}

function publishRemote(msg) {
  if (!shouldUseRemotePublish()) return;
  const path = CONFIG.collectDisplay?.publishPath ?? '/api/collect/publish';
  const room = msg.room ?? resolveCollectRoom();
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, msg }),
    keepalive: true,
  }).catch((e) => console.warn('[collectDisplay] publish', e));
}

export function publishCollectEvent(type, item, extra) {
  if (!CONFIG.collectDisplay?.enabled || !item) return;
  const msg = envelope(type, itemToPrizePayload(item), extra);
  persist(msg);
  getChannel({ listen: false })?.postMessage(msg);
  publishRemote(msg);
  return msg;
}

export function publishHoleDrop(item) {
  return publishCollectEvent('collect.hole_drop', item);
}

export function publishVended(item) {
  return publishCollectEvent('collect.vended', item);
}

export function readLastCollectEvent() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function subscribeCollectLocal(handler) {
  const ch = getChannel({ listen: true });
  const onMsg = (e) => { if (e.data?.schema === SCHEMA) handler(e.data); };
  ch?.addEventListener('message', onMsg);
  const onStorage = (e) => {
    if (e.key !== LS_KEY || !e.newValue) return;
    try { handler(JSON.parse(e.newValue)); } catch { /* ignore */ }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    ch?.removeEventListener('message', onMsg);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * @param {(state: 'connecting'|'open'|'error') => void} [onLink]
 */
function subscribeCollectRemote(handler, onLink) {
  const room = resolveCollectRoom();
  const path = CONFIG.collectDisplay?.ssePath ?? '/api/collect/stream';
  const url = `${path}?room=${encodeURIComponent(room)}`;
  onLink?.('connecting');
  const es = new EventSource(url);
  es.onopen = () => onLink?.('open');
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg?.schema === SCHEMA) handler(msg);
    } catch { /* ignore */ }
  };
  es.onerror = () => onLink?.('error');
  return () => {
    es.close();
  };
}

/**
 * @param {(msg: object) => void} handler
 * @param {{ onLink?: (s: string) => void }} [opts]
 */
export function subscribeCollectDisplay(handler, opts = {}) {
  if (shouldUseRemoteSubscribe()) {
    return subscribeCollectRemote(handler, opts.onLink);
  }
  return subscribeCollectLocal(handler);
}

export function openCollectDisplayWindow() {
  const base = CONFIG.collectDisplay?.displayPath ?? '/display.html';
  const room = resolveCollectRoom();
  const url = `${base}${base.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`;
  return window.open(url, 'tripo-collect-display', 'noopener');
}
