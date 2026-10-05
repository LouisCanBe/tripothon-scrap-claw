/** 中英切换。剧本字段用 { zh, en }；界面短句走 UI 表。 */

const UI = {
  zh: {
    title: '拾荒娃娃机',
    start: '开始',
    loadShell: '正在组装娃娃机外壳……',
    loadClaw: '正在装载抓爪与导轨……',
    loadStock: '正在上货（{n}/{total}）……',
    loadDecor: '正在摆放奖池与场景杂物……',
    loadArrange: '正在整理奖池摆放……',
    loadWarm: '正在预热画面（后台进行，可先点开始）……',
    loadReady: '上货完成，可以开始了',
    loadReadyAct: '试玩就绪：从第 {n} 幕开始',
    tryAct: '从「{label}」试玩',
    hudTitle: '今日采集配额',
    hudCount: '配额进度',
    grabStat: '今天收集了 {n} 个物资',
    pairTitle: '出货副屏',
    pairCopy: '复制',
    pairHint: '扫码打开副屏，或粘贴已复制的链接',
    pairErr: '请在本机运行 node tools/devServer.mjs 后刷新页面。',
    pairOk: '出货副屏 · 已连接（{n}）',
    pairErrOpen: '出货副屏 · 同步未就绪',
    pairErrClosed: '出货副屏 · 同步未就绪（点开说明）',
    pairWaitOpen: '出货副屏 · 扫码连接',
    pairWaitClosed: '出货副屏 · 未连接（点发展码）',
    continue: '点击继续',
    replayKicker: '手心里还是那一罐',
    replay: '再记一遍',
    view: '视角',
    grab: '抓',
    keys: '键位',
    stick: '摇杆',
    moveStick: '移动：摇杆',
    moveKeys: '移动：方向键',
    restart: '重新开始',
    near: '凑近',
    far: '站远',
    fps: '第一人称',
    orbit: '环视',
    lookDrag: '按住拖拽环视 · WASD 走动 · 滚轮缩放视野',
    lookFps: '按住拖拽环视 · WASD 走动 · QE 升降 · 滚轮 FOV · V 切换环视',
    lookOrbit: '按住拖拽环视 · 滚轮缩放视野',
    ruinImmersive: '沉浸式废墟',
    ruinOrbit: '环视废墟实景',
    ruinFail: '沉浸式加载失败，回退全景图',
    panoFail: '全景加载失败',
    marbleFail: 'Marble 与全景均未加载',
    stingerLook: '按住拖拽，自己再看一圈。',
    stingerReplay: '风停在这儿。想再记一遍，就点下面。',
    collected: '+1 {name}',
    quotaLine: '{name}，入账。',
    quotaReject: '……配额不认这个。',
  },
  en: {
    title: 'Scavenger Claw',
    start: 'Start',
    loadShell: 'Assembling the cabinet…',
    loadClaw: 'Fitting the claw and rails…',
    loadStock: 'Stocking the pool ({n}/{total})…',
    loadDecor: 'Placing the pool and clutter…',
    loadArrange: 'Settling the prizes…',
    loadWarm: 'Warming up the picture. You can start now…',
    loadReady: 'Stocked. Ready to start.',
    loadReadyAct: 'Ready: starting at act {n}',
    tryAct: 'Trying “{label}”',
    hudTitle: 'Today’s quota',
    hudCount: 'Progress',
    grabStat: 'Collected {n} supplies today',
    pairTitle: 'Vend screen',
    pairCopy: 'Copy',
    pairHint: 'Scan to open the side screen, or paste the copied link',
    pairErr: 'Run node tools/devServer.mjs on this machine, then refresh.',
    pairOk: 'Vend screen · linked ({n})',
    pairErrOpen: 'Vend screen · sync not ready',
    pairErrClosed: 'Vend screen · sync not ready (tap for help)',
    pairWaitOpen: 'Vend screen · scan to link',
    pairWaitClosed: 'Vend screen · not linked (tap for the code)',
    continue: 'Tap to continue',
    replayKicker: 'Still just that can',
    replay: 'Remember it again',
    view: 'View',
    grab: 'Grab',
    keys: 'Keys',
    stick: 'Stick',
    moveStick: 'Move: stick',
    moveKeys: 'Move: keys',
    restart: 'Start over',
    near: 'Closer',
    far: 'Farther',
    fps: 'First person',
    orbit: 'Look around',
    lookDrag: 'Drag to look · WASD to walk · wheel to zoom',
    lookFps: 'Drag to look · WASD walk · QE up/down · wheel FOV · V to orbit',
    lookOrbit: 'Drag to look · wheel to zoom',
    ruinImmersive: 'Inside the ruin',
    ruinOrbit: 'Looking around the ruin',
    ruinFail: 'Immersive load failed. Falling back to the panorama.',
    panoFail: 'Panorama failed to load',
    marbleFail: 'Neither Marble nor the panorama loaded',
    stingerLook: 'Drag to look around once more.',
    stingerReplay: 'The wind stops here. To remember it again, tap below.',
    collected: '+1 {name}',
    quotaLine: '{name}, logged.',
    quotaReject: '…The quota doesn’t take this.',
  },
};

const NAMES = {
  面包: 'Bread',
  发霉面包: 'Moldy bread',
  罐头: 'A can',
  锈罐头: 'A rusted can',
  青菜: 'Greens',
  烂菜: 'Rotten greens',
  蔬菜: 'Greens',
  牛奶盒: 'A milk carton',
  空盒: 'An empty carton',
  干酪块: 'A cheese block',
  霉斑块: 'A moldy block',
  瓶子: 'A bottle',
  裂瓶: 'A cracked bottle',
  玻璃罐: 'A glass jar',
  裂罐: 'A cracked jar',
  果子: 'Fruit',
  瘪果: 'Shriveled fruit',
  咸鱼: 'Salt fish',
  '腐烂的咸鱼': 'Rotten salt fish',
  口粮袋: 'A ration sack',
  空瘪袋: 'An empty sack',
  饼干盒: 'A biscuit tin',
  受潮纸盒: 'A damp box',
  油瓶: 'A bottle of oil',
  浑浊油瓶: 'A cloudy oil bottle',
  青果: 'Green fruit',
  烂青果: 'Rotten green fruit',
  鸡腿: 'A drumstick',
  '鸡腿（败露）': 'A spoiled drumstick',
  面包汤: 'Bread soup',
  烫青菜: 'Blanched greens',
};

let lang = 'zh';
const listeners = new Set();

function readInitialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'zh') return q;
  try {
    const saved = localStorage.getItem('claw-lang');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* private mode */ }
  return 'zh';
}

export function getLang() { return lang; }

export function t(key, vars) {
  const table = UI[lang] ?? UI.zh;
  let s = table[key] ?? UI.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** 剧本 {zh,en}、纯中文物品名、或已经是当前语言的字符串 */
export function copy(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') return value[lang] || value.zh || value.en || '';
  if (lang === 'en' && NAMES[value]) return NAMES[value];
  return String(value);
}

export function setLang(next) {
  if (next !== 'zh' && next !== 'en') return;
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem('claw-lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  applyStaticCopy();
  for (const fn of listeners) fn(lang);
}

export function toggleLang() {
  setLang(lang === 'zh' ? 'en' : 'zh');
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyStaticCopy() {
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.documentElement.style.setProperty('--i18n-continue', `"${t('continue')}"`);
  const toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.textContent = lang === 'zh' ? 'EN' : '中';
    toggle.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  }
  const grab = document.getElementById('globalGrabStat');
  if (grab) grab.textContent = t('grabStat', { n: grab.dataset.n || '0' });
}

lang = readInitialLang();
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
