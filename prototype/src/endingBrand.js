/** 终幕角标：画面内左上 mark、右上 wordmark */

const REF_W = 1920;
const REF_H = 1080;
const SIZE_MUL = 0.8;

let root = null;
let active = false;

export function initEndingBrand() {
  root = document.getElementById('endingBrand');
}

/** @param {{ x: number, y: number, w: number, h: number }} picture 当前画面矩形（px） */
export function layoutEndingBrand(picture) {
  if (!root || !active) return;
  root.style.left = `${picture.x}px`;
  root.style.top = `${picture.y}px`;
  root.style.width = `${picture.w}px`;
  root.style.height = `${picture.h}px`;

  const pos = picture.w / REF_W;
  const u = pos * SIZE_MUL;
  const markSize = 55.5 * u;
  const cornerW = 186.576 * u;
  const markLeft = 39 * pos;
  const rightInset = 14 * pos;
  let cornerLeft = 1699 * pos;
  if (cornerLeft + cornerW > picture.w - rightInset) {
    cornerLeft = picture.w - cornerW - rightInset;
  }

  const topInset = Math.max(4, (31 / REF_H) * picture.h);

  root.style.setProperty('--brand-top', `${topInset}px`);
  root.style.setProperty('--brand-mark-left', `${markLeft}px`);
  root.style.setProperty('--brand-mark-size', `${markSize}px`);
  root.style.setProperty('--brand-corner-left', `${cornerLeft}px`);
  root.style.setProperty('--brand-corner-width', `${cornerW}px`);
}

export function showEndingBrand() {
  if (!root || active) return;
  active = true;
  root.hidden = false;
  root.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => root.classList.add('show'));
}

export function hideEndingBrand() {
  if (!root) return;
  active = false;
  root.classList.remove('show');
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
}

export function endingBrandActive() {
  return active;
}
