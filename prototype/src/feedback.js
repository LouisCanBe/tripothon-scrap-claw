/**
 * 反馈：封面脚注 / 角落小标 / 终幕纸条 / 留言卡
 * ------------------------------------------------------------------
 * 全程不埋点、不上报。选中的选项和备注只留在这个页面里，
 * 只有玩家点「发邮件」时才拼进 mailto:，由玩家自己的邮件客户端发出去。
 *
 * 三个入口（都靠玩家主动点，不自动弹）：
 *   ① 加载页底部一行：反馈 · louis_wxl@outlook.com（首页/封面）
 *   ② 开始游戏后右上角小标，常驻；终幕纸条出现时收起，别抢戏
 *   ③ 终幕 stinger 之后、重开按钮上方那张纸条
 *
 * 卡片里的 keydown 在 .fb-sheet 这一层就截住 —— 否则空格会落爪、方向键会移动爪子。
 */
import { copy, onLangChange } from './i18n.js';

const MAIL = 'louis_wxl@outlook.com';

/** 双语字段，与剧本同构（{zh,en}），交给 i18n 的 copy() 取当前语言 */
const L = (zh, en) => ({ zh, en });

const QUESTIONS = [
  {
    key: 'act',
    short: L('一幕', 'Act'),
    title: L('哪一幕让你停了一下？', 'Which act made you pause?'),
    opts: [
      L('一幕 · 观察', 'Act I · looking'),
      L('二幕 · 首抓', 'Act II · first grab'),
      L('三幕 · 配额', 'Act III · the quota'),
      L('四幕 · 那顿饭', 'Act IV · the meal'),
      L('终幕 · 真相', 'Ending · the truth'),
      L('说不上', 'Not sure'),
    ],
  },
  {
    key: 'stuck',
    short: L('卡住', 'Snagged'),
    title: L('哪里卡住了？', 'Where did it snag?'),
    opts: [
      L('不知道要干嘛', 'Didn’t know what to do'),
      L('抓不起来', 'Couldn’t grab it'),
      L('看不懂剧情', 'Lost the story'),
      L('加载太久', 'Loading took long'),
      L('没卡住', 'Nothing snagged'),
    ],
  },
  {
    key: 'want',
    short: L('想要', 'Want'),
    title: L('还想看到什么？', 'What would you want more of?'),
    opts: [
      L('更多可抓的东西', 'More things to grab'),
      L('配音', 'A voice'),
      L('更长的终幕', 'A longer ending'),
      L('裸眼 3D 相框', 'The glasses-free frame'),
      L('够了', 'This is enough'),
    ],
  },
];

const NONE = L('（没选）', '(none)');

const picked = new Map();   // 问题 key → 选项下标
let noteText = '';
let card = null;
let sheet = null;
let note = null;
let sendLink = null;
let copyBtn = null;
let copyStatus = null;
let chipEl = null;
let cueEl = null;
let isOpen = false;
let started = false;
let lastFocus = null;
let copyTimer = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ------------------------------------------------------------
// 入口
// ------------------------------------------------------------
export function initFeedback() {
  chipEl = document.getElementById('feedbackChip');
  cueEl = document.getElementById('feedbackCue');
  const coverBtn = document.querySelector('#loading .load-feedback-open');

  for (const btn of [chipEl, cueEl, coverBtn]) {
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFeedbackCard();
    });
  }

  // 语言切换：卡片开着就整张重画（已选项在 picked 里，不会丢）
  onLangChange(() => { if (isOpen) render(); });
}

/** 开始游戏后：右上角小标常驻 */
export function showFeedbackChip() {
  started = true;
  if (chipEl) chipEl.hidden = false;
}

export function hideFeedbackChip() {
  if (chipEl) chipEl.hidden = true;
}

/** 终幕：纸条跟着 replayCue 一起出；角落小标让位 */
export function showEndingCue() {
  if (cueEl) {
    cueEl.hidden = false;
    requestAnimationFrame(() => cueEl.classList.add('show'));
  }
  hideFeedbackChip();
}

/** 重开 / 换幕：收纸条，小标回来 */
export function hideEndingCue() {
  if (cueEl) {
    cueEl.classList.remove('show');
    cueEl.hidden = true;
  }
  if (started) showFeedbackChip();
}

// ------------------------------------------------------------
// 留言卡
// ------------------------------------------------------------
export function openFeedbackCard() {
  buildCard();
  if (isOpen) return;
  isOpen = true;
  lastFocus = document.activeElement;
  render();
  card.hidden = false;
  requestAnimationFrame(() => card.classList.add('show'));
  sheet.querySelector('.fb-close')?.focus();
}

export function closeFeedbackCard() {
  if (!isOpen) return;
  isOpen = false;
  card.classList.remove('show');
  card.hidden = true;
  try { lastFocus?.focus?.(); } catch { /* 元素可能已经不在文档里 */ }
}

function buildCard() {
  if (card) return;
  card = el('div');
  card.id = 'feedbackCard';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'fbTitle');

  const backdrop = el('div', 'fb-backdrop');
  backdrop.addEventListener('click', closeFeedbackCard);

  sheet = el('div', 'fb-sheet');
  // 这一层截住 keydown：卡片开着时空格不落爪、方向键不移动爪子、H 不开面板
  sheet.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFeedbackCard();
    }
  });

  card.append(backdrop, sheet);
  document.body.appendChild(card);
}

function render() {
  if (!sheet) return;
  const scroll = sheet.scrollTop;
  sheet.textContent = '';

  const close = el('button', 'fb-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', copy(L('关闭', 'Close')));
  close.addEventListener('click', closeFeedbackCard);

  const kicker = el('div', 'fb-kicker', 'FEEDBACK');
  const title = el('h2', 'fb-title', copy(L('想听你说一句', 'One thing, if you would')));
  title.id = 'fbTitle';
  const lede = el('p', 'fb-lede', copy(L(
    '两个人做的小东西。没有数据后台，也不记录你玩到哪——你选的只会写进这封邮件。',
    'Made by two people. No analytics, nothing tracked about how far you got. What you pick only goes into this email.',
  )));
  sheet.append(close, kicker, title, lede);

  for (const q of QUESTIONS) {
    const box = el('div', 'fb-q');
    box.append(el('div', 'fb-q-title', copy(q.title)));
    const row = el('div', 'fb-opts');
    q.opts.forEach((opt, i) => {
      const b = el('button', 'fb-opt', copy(opt));
      b.type = 'button';
      b.dataset.k = q.key;
      b.dataset.i = String(i);
      const on = picked.get(q.key) === i;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        if (picked.get(q.key) === i) picked.delete(q.key);
        else picked.set(q.key, i);
        syncOpts();
        syncSend();
      });
      row.append(b);
    });
    box.append(row);
    sheet.append(box);
  }

  note = el('textarea', 'fb-note');
  note.rows = 3;
  note.value = noteText;
  note.placeholder = copy(L('随便写两句也行（可选）', 'Anything else (optional)'));
  note.setAttribute('aria-label', note.placeholder);
  note.addEventListener('input', () => {
    noteText = note.value;
    syncSend();
  });
  sheet.append(note);

  const actions = el('div', 'fb-actions');
  sendLink = el('a', 'fb-send', copy(L('发邮件', 'Send as email')));
  sendLink.href = mailtoHref();
  sendLink.addEventListener('click', () => {
    // 邮件客户端没弹出来也不关卡片：邮箱就写在下面，可以复制正文
    syncSend();
  });
  copyBtn = el('button', 'fb-copy', copy(L('复制反馈', 'Copy feedback')));
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', onCopy);
  actions.append(sendLink, copyBtn);
  sheet.append(actions);

  const foot = el('div', 'fb-foot');
  foot.append(el('span', 'fb-foot-label', copy(L('或直接写给我', 'Or write to me directly'))));
  const mail = el('a', 'fb-mail', MAIL);
  mail.href = `mailto:${MAIL}`;
  foot.append(mail);
  sheet.append(foot);

  copyStatus = el('span', 'fb-copy-status');
  copyStatus.setAttribute('role', 'status');
  copyStatus.setAttribute('aria-live', 'polite');
  sheet.append(copyStatus);

  sheet.scrollTop = scroll;
}

function syncOpts() {
  if (!sheet) return;
  for (const b of sheet.querySelectorAll('.fb-opt')) {
    const on = picked.get(b.dataset.k) === Number(b.dataset.i);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function syncSend() {
  if (sendLink) sendLink.href = mailtoHref();
}

// ------------------------------------------------------------
// 拼正文 / 复制
// ------------------------------------------------------------
function compose() {
  const lines = [];
  for (const q of QUESTIONS) {
    const i = picked.get(q.key);
    lines.push(`${copy(q.short)}: ${i == null ? copy(NONE) : copy(q.opts[i])}`);
  }
  const extra = noteText.trim();
  if (extra) lines.push('', extra);
  lines.push('', copy(L('—— 来自《拾荒娃娃机》Demo', '— sent from the Scrap Claw demo')));
  return lines.join('\n');
}

function mailtoHref() {
  const subject = copy(L('《拾荒娃娃机》反馈', 'Scrap Claw · feedback'));
  return `mailto:${MAIL}?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(compose())}`;
}

async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 非 https / 无权限：走下面的兜底 */ }
  try {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function onCopy() {
  const ok = await writeClipboard(compose());
  if (!copyBtn || !copyStatus) return;
  copyStatus.classList.toggle('bad', !ok);
  copyStatus.textContent = ok
    ? copy(L('已复制，粘到邮件里就行', 'Copied — paste it into an email'))
    : copy(L('复制失败，直接用下面的邮箱写吧', 'Copy failed — use the address below'));
  copyBtn.textContent = ok ? copy(L('已复制', 'Copied')) : copy(L('再试一次', 'Try again'));
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyTimer = 0;
    if (copyBtn) copyBtn.textContent = copy(L('复制反馈', 'Copy feedback'));
    if (copyStatus) {
      copyStatus.textContent = '';
      copyStatus.classList.remove('bad');
    }
  }, 2600);
}
