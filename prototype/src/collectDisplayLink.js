// 主游戏侧：副屏是否在线、主游戏心跳（配合 hub /api/collect/status、ping）
import { CONFIG } from './config.js';
import {
  resolveCollectPair, shouldUseRemotePublish, collectDisplayPathWithPair,
} from './collectDisplayBus.js';

const PING_MS = 8_000;
const STATUS_MS = 4_500;

function statusUrl() {
  const base = CONFIG.collectDisplay?.statusPath ?? '/api/collect/status';
  const pair = encodeURIComponent(resolveCollectPair());
  return `${base}?pair=${pair}`;
}

function pingUrl() {
  return CONFIG.collectDisplay?.pingPath ?? '/api/collect/ping';
}

export function startCollectDisplayLinkMonitor(el) {
  if (!el || !shouldUseRemotePublish()) {
    if (el) el.hidden = true;
    return () => {};
  }
  el.hidden = false;
  const pair = resolveCollectPair();
  const displayHint = collectDisplayPathWithPair(
    CONFIG.collectDisplay?.displayPath ?? '/display.html',
  );

  const doPing = () => {
    if (document.hidden) return;
    fetch(pingUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair: resolveCollectPair() }),
      keepalive: true,
    }).catch(() => {});
  };
  doPing();
  const pingIv = setInterval(doPing, PING_MS);

  const refresh = async () => {
    try {
      const r = await fetch(statusUrl(), { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const s = await r.json();
      if (s.displaySubscribers > 0) {
        el.textContent = `出货副屏：已连接（${s.displaySubscribers}）· pair=${pair}`;
        el.dataset.state = 'ok';
      } else {
        el.textContent = `出货副屏：未连接 · 请打开 ${displayHint}`;
        el.dataset.state = 'wait';
      }
    } catch {
      el.textContent = '出货副屏：同步服务未就绪（需 devServer）';
      el.dataset.state = 'err';
    }
  };
  refresh();
  const statusIv = setInterval(refresh, STATUS_MS);

  return () => {
    clearInterval(pingIv);
    clearInterval(statusIv);
  };
}
