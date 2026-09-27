// 出货展示屏联动：同机 BC + 跨设备 SSE（devServer /api/collect/*）
import { CONFIG } from './config.js';
import { GLB_MANIFEST } from './assets.manifest.js';
import { poolVisualScale } from './prizePool.js';
import { resolveBounceMaterial } from './collectBouncePresets.js';
import { DEFAULT_COLLECT_PAIR } from './collectPairDefault.js';

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

/** URL ?pair= 优先，其次 config.pairId */
export function resolveCollectPair() {
  try {
    const q = new URLSearchParams(location.search).get('pair');
    if (q) return q;
  } catch { /* ignore */ }
  return CONFIG.collectDisplay?.pairId ?? DEFAULT_COLLECT_PAIR;
}

/** 默认口令时书签可不带 query */
/** 副屏完整 URL（扫码用，始终带 ?pair=） */
export function collectDisplayShareUrl() {
  const pair = resolveCollectPair();
  const path = CONFIG.collectDisplay?.displayPath ?? '/display.html';
  const base = `${location.origin}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${sep}pair=${encodeURIComponent(pair)}`;
}

export function collectDisplayPathWithPair(path) {
  const pair = resolveCollectPair();
  try {
    if (!new URLSearchParams(location.search).get('pair') && pair === DEFAULT_COLLECT_PAIR) {
      return path;
    }
  } catch { /* ignore */ }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}pair=${encodeURIComponent(pair)}`;
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
    pair: resolveCollectPair(),
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
  const pair = msg.pair ?? resolveCollectPair();
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair, msg }),
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
  const pair = resolveCollectPair();
  const path = CONFIG.collectDisplay?.ssePath ?? '/api/collect/stream';
  const url = `${path}?pair=${encodeURIComponent(pair)}`;
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
  const url = collectDisplayPathWithPair(base);
  return window.open(url, 'tripo-collect-display', 'noopener');
}
