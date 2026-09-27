// 主屏右上角：副屏配对 + 连接状态（第三幕起，LAN/SSE）
import { CONFIG } from './config.js';
import {
  resolveCollectPair, shouldUseRemotePublish, collectDisplayShareUrl,
} from './collectDisplayBus.js';

const PING_MS = 8_000;
const STATUS_MS = 4_500;
const SCALE = 3;
const MARGIN = 2;

function drawQr(canvas, text) {
  const qrcode = globalThis.qrcode;
  if (!qrcode || !canvas) return false;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells = n + MARGIN * 2;
  canvas.width = cells * SCALE;
  canvas.height = cells * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0ece0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#121218';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + MARGIN) * SCALE, (r + MARGIN) * SCALE, SCALE, SCALE);
      }
    }
  }
  return true;
}

async function copyText(text, inputEl) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback */ }
  if (inputEl) {
    inputEl.focus();
    inputEl.select();
    inputEl.setSelectionRange(0, text.length);
    try {
      return document.execCommand('copy');
    } catch { /* ignore */ }
  }
  return false;
}

function shouldShowPanel(act) {
  if (!CONFIG.collectDisplay?.enabled || !shouldUseRemotePublish()) return false;
  const fromAct = CONFIG.collectDisplay?.pairQrFromActId ?? 3;
  if (!act || act.id < fromAct) return false;
  if (act.id >= 5) return false;
  return true;
}

/**
 * @param {{ hooks: { onActEnter?: (act: object, idx: number) => void } }} director
 */
export function startCollectDisplayPairPanel(director) {
  const root = document.getElementById('collectPairPanel');
  if (!root || !director) return () => {};

  const head = root.querySelector('.collect-pair-head');
  const chev = root.querySelector('.chev');
  const expand = root.querySelector('.collect-pair-expand');
  const titleEl = root.querySelector('.status-title');
  const waitBlock = root.querySelector('.pair-wait');
  const canvas = root.querySelector('canvas');
  const urlInput = root.querySelector('.pair-url');
  const copyBtn = root.querySelector('.pair-copy');
  const hintEl = root.querySelector('.pair-hint');
  const errText = root.querySelector('.pair-err-text');

  let expanded = false;
  let linkState = 'wait';
  let subscribers = 0;
  let pingIv = null;
  let statusIv = null;
  let panelVisible = false;

  const statusUrl = () => {
    const base = CONFIG.collectDisplay?.statusPath ?? '/api/collect/status';
    return `${base}?pair=${encodeURIComponent(resolveCollectPair())}`;
  };
  const pingUrl = () => CONFIG.collectDisplay?.pingPath ?? '/api/collect/ping';

  const canExpand = () => linkState === 'wait' || linkState === 'err';

  const syncChrome = () => {
    const expandable = canExpand();
    if (head) head.disabled = !expandable;
    if (chev) chev.hidden = !expandable;
    head?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    root.classList.toggle('open', expanded && expandable);
  };

  const flashHint = (msg) => {
    if (!hintEl || linkState !== 'wait') return;
    const prev = hintEl.textContent;
    hintEl.textContent = msg;
    setTimeout(() => {
      if (hintEl.textContent === msg) hintEl.textContent = prev;
    }, 2200);
  };

  const doCopy = async () => {
    const url = collectDisplayShareUrl();
    const ok = await copyText(url, urlInput);
    flashHint(ok ? '链接已复制，可粘贴到副屏浏览器' : '请点地址框全选后手动复制');
    return ok;
  };

  const openExpand = async () => {
    expanded = true;
    expand.hidden = false;
    syncChrome();

    if (linkState === 'wait') {
      const url = collectDisplayShareUrl();
      if (urlInput) urlInput.value = url;
      if (waitBlock) waitBlock.hidden = false;
      if (errText) errText.hidden = true;
      drawQr(canvas, url);
      if (hintEl) hintEl.textContent = '扫码打开副屏，或粘贴已复制的链接';
      await doCopy();
    } else if (linkState === 'err') {
      if (waitBlock) waitBlock.hidden = true;
      if (errText) {
        errText.hidden = false;
        errText.textContent = '请在本机运行 node tools/devServer.mjs 后刷新页面。';
      }
    }
    renderTitles();
  };

  const closeExpand = () => {
    expanded = false;
    expand.hidden = true;
    syncChrome();
    renderTitles();
  };

  const setExpanded = (on) => {
    if (on) {
      if (!canExpand()) return;
      openExpand();
    } else {
      closeExpand();
    }
  };

  const renderTitles = () => {
    root.dataset.state = linkState;
    if (linkState === 'ok') {
      titleEl.textContent = `出货副屏 · 已连接（${subscribers}）`;
      return;
    }
    if (linkState === 'err') {
      titleEl.textContent = expanded
        ? '出货副屏 · 同步未就绪'
        : '出货副屏 · 同步未就绪（点开说明）';
      return;
    }
    titleEl.textContent = expanded
      ? '出货副屏 · 扫码连接'
      : '出货副屏 · 未连接（点发展码）';
  };

  const render = () => {
    const shareUrl = collectDisplayShareUrl();
    if (linkState === 'ok') {
      closeExpand();
    }
    renderTitles();
    syncChrome();

    if (linkState === 'wait' && expanded) {
      if (urlInput) urlInput.value = shareUrl;
      drawQr(canvas, shareUrl);
    }
  };

  const refreshStatus = async () => {
    if (!panelVisible) return;
    try {
      const r = await fetch(statusUrl(), { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const s = await r.json();
      subscribers = s.displaySubscribers ?? 0;
      linkState = subscribers > 0 ? 'ok' : 'wait';
    } catch {
      linkState = 'err';
      subscribers = 0;
    }
    render();
  };

  const startTransport = () => {
    const doPing = () => {
      if (document.hidden || !panelVisible) return;
      fetch(pingUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: resolveCollectPair() }),
        keepalive: true,
      }).catch(() => {});
    };
    doPing();
    pingIv = setInterval(doPing, PING_MS);
    refreshStatus();
    statusIv = setInterval(refreshStatus, STATUS_MS);
  };

  const stopTransport = () => {
    clearInterval(pingIv);
    clearInterval(statusIv);
    pingIv = null;
    statusIv = null;
  };

  const setPanelVisible = (on) => {
    panelVisible = on;
    root.hidden = !on;
    if (!on) {
      stopTransport();
      closeExpand();
      return;
    }
    linkState = 'wait';
    subscribers = 0;
    render();
    startTransport();
  };

  head?.addEventListener('click', () => {
    if (!canExpand()) return;
    setExpanded(!expanded);
  });

  copyBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    doCopy();
  });

  urlInput?.addEventListener('click', (e) => {
    e.stopPropagation();
    urlInput.select();
  });

  urlInput?.addEventListener('focus', (e) => {
    e.stopPropagation();
  });

  director.hooks.onActEnter = (act) => {
    setPanelVisible(shouldShowPanel(act));
  };

  setPanelVisible(shouldShowPanel(director.act));

  return stopTransport;
}
