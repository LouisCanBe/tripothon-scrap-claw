/**
 * TapTap 广告接入（激励视频）
 * ------------------------------------------------------------
 * 两个点位（均为玩家主动点击，绝不自动弹）：
 *   ① 第三幕「借个力」：连续抓取失败 N 次后出现；看完广告，下一次抓取必中（一次性）
 *   ② 终幕「他今天吃了什么？」：结尾揭晓 stinger 的答案（真相卡）
 *
 * 环境降级：仅 TapTap 小游戏运行时存在全局 tap.*；
 * 本地 devServer / Netlify / Render 下入口不渲染、零报错。
 * 调试：URL 加 ?ad=1 可在本地强制显示入口（点击直接发奖，不调真广告）。
 */
import { CONFIG } from './config.js';
import { t } from './i18n.js';

const AD_UNIT_ID = '1054323';        // 服务端匹配广告位（check_ads_status 自动解析；勿用手动建的其他 ID）
const BOOST_FAIL_STREAK = 2;         // 连续失败几次后出「借个力」

const hasTap = () => typeof window.tap?.createRewardedVideoAd === 'function';
const DEBUG = new URLSearchParams(location.search).has('ad');
const ENABLED = hasTap() || DEBUG;

let ad = null;            // tap 广告单例
let adReady = false;      // 素材拉取成功
let pendingReward = null; // 待发奖回调（看完才发）
let boostUsed = false;    // 「借个力」是否已用过（restart 重置）
let buffActive = false;   // 必中 buff 生效中（等下一次抓取结果回收）
let failStreak = 0;
let boostEl = null;
let truthEl = null;
let cardEl = null;

// —— DOM 工具：纸片美学，风格对齐 replayCue ——
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function paperStyle(e, extra) {
  Object.assign(e.style, {
    position: 'fixed', zIndex: '30', pointerEvents: 'auto', cursor: 'pointer',
    border: '2px solid #26241f', background: 'var(--color-paper, #efe9dc)',
    color: '#26241f', padding: '12px 22px 14px', textAlign: 'center',
    fontFamily: 'var(--font-main, monospace)', borderRadius: '2px',
    boxShadow: '0 4px 0 rgba(38,36,31,.25)', userSelect: 'none',
    opacity: '0', transition: 'opacity .35s ease, transform .35s ease',
    ...extra,
  });
  return e;
}

// ------------------------------------------------------------
// 初始化（main.js boot 完成后调用）
// ------------------------------------------------------------
export function initAds() {
  if (!ENABLED) return false;
  if (hasTap()) {
    try {
      ad = window.tap.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
      ad.onLoad(() => { adReady = true; });
      ad.onError(() => { adReady = false; });
      ad.onClose((res) => {
        // 只有完整看完才发奖；没看完什么都不给
        if (res && res.isEnded && pendingReward) { const fn = pendingReward; pendingReward = null; fn(); }
        else pendingReward = null;
        ad.load();   // 预拉下一个
      });
      ad.load();     // 创建即预拉首个素材
    } catch { ad = null; }
  }
  return true;
}

// 看广告 → 发奖。DEBUG 模式直接发奖。
function watchAd(rewardFn) {
  if (DEBUG || !hasTap()) { rewardFn(); return; }
  if (!ad) return;
  pendingReward = rewardFn;
  // 官方推荐模式：show 失败（未就绪）→ load → 重试一次；仍失败只提示不卡游戏
  ad.show().catch(() => ad.load()
    .then(() => ad.show())
    .catch(() => { pendingReward = null; toastAd(t('adNotReady')); }));
}

function toastAd(text) {
  const e = el('div', null, text);
  Object.assign(e.style, {
    position: 'fixed', left: '50%', bottom: '12%', transform: 'translateX(-50%)',
    zIndex: '40', background: 'rgba(38,36,31,.92)', color: '#efe9dc',
    fontFamily: 'var(--font-main, monospace)', fontSize: '13px', letterSpacing: '2px',
    padding: '8px 18px', borderRadius: '2px', pointerEvents: 'none',
  });
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 1800);
}

// ------------------------------------------------------------
// 点位①：第三幕「借个力」
// ------------------------------------------------------------
function ensureBoostEl() {
  if (boostEl) return boostEl;
  const e = el('div');
  paperStyle(e, { right: '22px', bottom: '72px', transform: 'translateY(8px)' });
  const k = el('span', null, t('adBoostKicker'));
  k.style.cssText = 'display:block;font-size:10px;letter-spacing:3px;opacity:.55;margin-bottom:4px;';
  const label = el('span', null, t('adBoost'));
  label.style.cssText = 'display:block;font-family:var(--font-hand);font-size:24px;letter-spacing:4px;';
  const hint = el('span', null, t('adBoostHint'));
  hint.style.cssText = 'display:block;font-size:10px;letter-spacing:1px;opacity:.55;margin-top:5px;';
  e.append(k, label, hint);
  e.addEventListener('click', () => {
    if (boostUsed) return;
    watchAd(() => { grantBoost(); hideBoostEntry(); });
  });
  document.body.appendChild(e);
  boostEl = e;
  return e;
}

function showBoostEntry() {
  if (boostUsed || buffActive) return;
  const e = ensureBoostEl();
  requestAnimationFrame(() => { e.style.opacity = '1'; e.style.transform = 'translateY(0)'; });
}
function hideBoostEntry() {
  if (!boostEl) return;
  boostEl.style.opacity = '0';
  boostEl.style.transform = 'translateY(8px)';
}

/** 抓取失败：累计连胜达到阈值出「借个力」（掉落控制只在第二/三幕开放，无需判幕） */
export function onGrabFail() {
  if (buffActive) { recycleBuff(); failStreak = 0; hideBoostEntry(); return; }
  if (boostUsed) return;
  failStreak++;
  if (failStreak >= BOOST_FAIL_STREAK) showBoostEntry();
}

/** 抓取成功：回收 buff / 清零连胜 / 收入口 */
export function onCollect() {
  recycleBuff();
  failStreak = 0;
  hideBoostEntry();
}

function recycleBuff() {
  if (!buffActive) return;
  CONFIG.claw.gripStrength = Math.max(0.55, CONFIG.claw.gripStrength - 0.15);
  CONFIG.claw.baseSlipProb = Math.min(0.45, CONFIG.claw.baseSlipProb + 0.05);
  buffActive = false;
}

function grantBoost() {
  boostUsed = true;
  buffActive = true;
  CONFIG.claw.gripStrength = 1;      // 下一次抓取必中
  CONFIG.claw.baseSlipProb = 0;
  toastAd(t('adBoostOn'));
}

// ------------------------------------------------------------
// 点位②：终幕「他今天吃了什么？」真相卡
// ------------------------------------------------------------
function ensureTruthEl() {
  if (truthEl) return truthEl;
  const e = el('div');
  paperStyle(e, { left: '50%', bottom: '24%', transform: 'translateX(-50%) translateY(8px)' });
  const k = el('span', null, t('adTruthKicker'));
  k.style.cssText = 'display:block;font-size:10px;letter-spacing:3px;opacity:.55;margin-bottom:4px;';
  const label = el('span', null, t('adTruth'));
  label.style.cssText = 'display:block;font-family:var(--font-hand);font-size:26px;letter-spacing:4px;';
  const hint = el('span', null, t('adTruthHint'));
  hint.style.cssText = 'display:block;font-size:10px;letter-spacing:1px;opacity:.55;margin-top:5px;';
  e.append(k, label, hint);
  e.addEventListener('click', () => watchAd(grantTruth));
  document.body.appendChild(e);
  truthEl = e;
  return e;
}

/** 终幕揭晓入口（unlockRevealWalk 后调用） */
export function showTruthEntry() {
  if (!ENABLED || cardEl) return;
  const e = ensureTruthEl();
  requestAnimationFrame(() => { e.style.opacity = '1'; e.style.transform = 'translateX(-50%) translateY(0)'; });
}

function grantTruth() {
  hideTruthEntry();
  const c = el('div');
  Object.assign(c.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
    zIndex: '50', background: 'var(--color-paper, #efe9dc)', color: '#26241f',
    border: '2px solid #26241f', padding: '36px 48px', textAlign: 'center',
    fontFamily: 'var(--font-main, monospace)', maxWidth: '560px', borderRadius: '2px',
    boxShadow: '0 8px 0 rgba(38,36,31,.3)',
  });
  const title = el('div', null, t('adTruthCardTitle'));
  title.style.cssText = 'font-size:13px;letter-spacing:4px;opacity:.6;margin-bottom:18px;';
  const l1 = el('div', null, t('adTruthCardL1'));
  l1.style.cssText = 'font-family:var(--font-hand);font-size:34px;letter-spacing:3px;margin-bottom:10px;';
  const l2 = el('div', null, t('adTruthCardL2'));
  l2.style.cssText = 'font-size:14px;letter-spacing:2px;opacity:.75;line-height:1.9;';
  const close = el('button', null, t('adTruthCardClose'));
  close.style.cssText = 'margin-top:26px;background:none;border:2px solid #26241f;color:#26241f;' +
    'font-family:var(--font-main,monospace);font-size:13px;letter-spacing:3px;padding:8px 26px;cursor:pointer;';
  close.addEventListener('click', () => c.remove());
  c.append(title, l1, l2, close);
  document.body.appendChild(c);
  cardEl = c;
}

function hideTruthEntry() {
  if (!truthEl) return;
  truthEl.style.opacity = '0';
}

// ------------------------------------------------------------
// 重开（director.restart）：全部状态归零
// ------------------------------------------------------------
export function resetAds() {
  failStreak = 0;
  boostUsed = false;
  buffActive = false;
  pendingReward = null;
  hideBoostEntry();
  hideTruthEntry();
  cardEl?.remove();
  cardEl = null;
}
