// 主屏：第三幕起可展开副屏配对二维码（LAN / SSE）
import { CONFIG } from './config.js';
import {
  resolveCollectPair, shouldUseRemotePublish, collectDisplayShareUrl,
} from './collectDisplayBus.js';

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

function shouldOfferPairQr(act) {
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
  if (!root || !director) return;

  const toggle = root.querySelector('.collect-pair-toggle');
  const body = root.querySelector('.collect-pair-body');
  const canvas = root.querySelector('canvas');
  const codeEl = root.querySelector('.pair-code');
  let expanded = false;

  const setExpanded = (on) => {
    expanded = on;
    body.hidden = !on;
    toggle?.setAttribute('aria-expanded', on ? 'true' : 'false');
    root.classList.toggle('open', on);
    if (on) refreshQr();
  };

  const refreshQr = () => {
    const pair = resolveCollectPair();
    if (codeEl) codeEl.textContent = pair;
    drawQr(canvas, collectDisplayShareUrl());
  };

  toggle?.addEventListener('click', () => setExpanded(!expanded));

  director.hooks.onActEnter = (act) => {
    if (!shouldOfferPairQr(act)) {
      root.hidden = true;
      setExpanded(false);
      return;
    }
    root.hidden = false;
    refreshQr();
  };

  if (shouldOfferPairQr(director.act)) {
    root.hidden = false;
    refreshQr();
  } else {
    root.hidden = true;
  }
}
