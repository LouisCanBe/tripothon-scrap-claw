// 出货展示屏联动：主游戏 ↔ 独立 display.html（同机多屏 / 多标签）
// 传输：BroadcastChannel + localStorage 快照（副屏晚开也能看到上一件）
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

export function publishCollectEvent(type, item, extra) {
  if (!CONFIG.collectDisplay?.enabled || !item) return;
  const msg = envelope(type, itemToPrizePayload(item), extra);
  persist(msg);
  getChannel({ listen: false })?.postMessage(msg);
  return msg;
}

/** 爪在洞口松手、奖品开始坠入出货道（尚未离屏） */
export function publishHoleDrop(item) {
  return publishCollectEvent('collect.hole_drop', item);
}

/** 奖品落至出货平面以下、主画面隐藏 —— 副屏「单独展示」的主触发点 */
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

export function subscribeCollectDisplay(handler) {
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

export function openCollectDisplayWindow() {
  const url = CONFIG.collectDisplay?.displayPath ?? '/display.html';
  return window.open(url, 'tripo-collect-display', 'noopener');
}
