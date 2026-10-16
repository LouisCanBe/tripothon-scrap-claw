// ============================================================
// 提交热度日历图：git log → GitHub 风格贡献日历 SVG（零依赖）
//
//   node tools/heatmap.mjs            # 默认输出 docs/activity.svg
//   node tools/heatmap.mjs --out x.svg
//
// 为什么自己画而不用现成服务（github-readme-activity-graph 之类）：
//   那些都挂在 Vercel 公共实例上，国内网络经常连不上 —— README 里就成破图。
//   生成的是仓库内静态 SVG，本地 VS Code 预览 / GitHub / 离线打开都能看，
//   跟本项目「three.js vendor 本地化、不依赖 CDN」一个路子。
// 配色取自 prototype/theme.css 的强调色 #9db87a。
// ============================================================
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const outArgIndex = process.argv.indexOf('--out');
const OUT = outArgIndex > -1
  ? resolve(process.argv[outArgIndex + 1])
  : resolve(ROOT, 'docs', 'activity.svg');

// ---------- 1. 读提交日期（作者日期，按本地时区取到天） ----------
const log = execSync('git log --date=short --format=%ad', {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const perDay = new Map(); // 'YYYY-MM-DD' -> 次数
for (const line of log.split(/\r?\n/)) {
  const d = line.trim();
  if (d) perDay.set(d, (perDay.get(d) ?? 0) + 1);
}
if (perDay.size === 0) {
  console.error('[heatmap] 没有提交记录，退出');
  process.exit(1);
}

const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const firstCommit = toDate([...perDay.keys()].sort()[0]);
const today = new Date(); today.setHours(0, 0, 0, 0);

// ---------- 2. 日历网格：从首个提交所在周的周日 到今天 ----------
const start = new Date(firstCommit);
start.setDate(start.getDate() - start.getDay()); // 回退到周日

const weeks = [];
let cursor = new Date(start);
while (cursor <= today) {
  const col = [];
  for (let i = 0; i < 7; i++) { col.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
  weeks.push(col);
}

const total = [...perDay.values()].reduce((a, b) => a + b, 0);
const maxDay = Math.max(...perDay.values());
const activeDays = perDay.size;

// ---------- 3. 样式（主题色板） ----------
const CELL = 11, GAP = 3, STEP = CELL + GAP;
const PAD_L = 30, PAD_T = 34, PAD_R = 6, PAD_B = 30;
const BG = '#0d0f0b', INK = '#d8d4c8', INK_DIM = '#8a877e';
const LEVELS = ['#22261f', '#33422a', '#4f6b3d', '#778a55', '#9db87a'];

const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil(n / (maxDay / 4))));

const W = PAD_L + weeks.length * STEP + PAD_R;
const H = PAD_T + 7 * STEP + PAD_B;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// ---------- 4. 画格子 ----------
const cells = [];
const monthLabels = [];
let lastMonth = -1;

weeks.forEach((col, w) => {
  col.forEach((day, r) => {
    const key = toKey(day);
    const n = perDay.get(key) ?? 0;
    const x = PAD_L + w * STEP;
    const y = PAD_T + r * STEP;
    const future = day > today;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${future ? 'transparent' : LEVELS[level(n)]}" stroke="${future ? 'none' : 'rgba(216,212,200,.06)'}">` +
      `<title>${key} · ${n} 次提交</title></rect>`
    );
    // 月份标签：该列包含当月 1 号时打一个（同一个月只打第一次）
    if (day.getDate() === 1 && day.getMonth() !== lastMonth) {
      lastMonth = day.getMonth();
      monthLabels.push(
        `<text x="${x}" y="${PAD_T - 8}" font-size="9" fill="${INK_DIM}" font-family="ui-monospace,Consolas,monospace">${day.getMonth() + 1}月</text>`
      );
    }
  });
});

// 左侧星期标签（一/三/五）
const weekdayLabels = [1, 3, 5].map((r) =>
  `<text x="0" y="${PAD_T + r * STEP + CELL - 2}" font-size="9" fill="${INK_DIM}" font-family="ui-monospace,Consolas,monospace">${WEEKDAYS[r]}</text>`
).join('');

// 图例
const legendY = PAD_T + 7 * STEP + 12;
const legendX = PAD_L + weeks.length * STEP - 5 * STEP;
const legend = [
  `<text x="${legendX - 16}" y="${legendY + CELL - 2}" font-size="9" fill="${INK_DIM}" font-family="ui-monospace,Consolas,monospace">少</text>`,
  ...LEVELS.map((c, i) =>
    `<rect x="${legendX + i * STEP}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${c}" stroke="rgba(216,212,200,.06)"/>`
  ),
  `<text x="${legendX + 5 * STEP + 4}" y="${legendY + CELL - 2}" font-size="9" fill="${INK_DIM}" font-family="ui-monospace,Consolas,monospace">多</text>`,
].join('');

const title =
  `<text x="0" y="12" font-size="12" fill="${INK}" font-family="ui-monospace,Consolas,monospace">提交热度 · ${toKey(firstCommit)} → ${toKey(today)}</text>` +
  `<text x="0" y="26" font-size="10" fill="${INK_DIM}" font-family="ui-monospace,Consolas,monospace">${total} commits · 活跃 ${activeDays} 天 · 单日最多 ${maxDay} 次</text>`;

const svg =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Consolas,monospace">` +
  `<rect width="${W}" height="${H}" rx="6" fill="${BG}"/>` +
  title + monthLabels.join('') + weekdayLabels + cells.join('') + legend +
  `</svg>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, 'utf8');
console.log(`[heatmap] ${total} commits / ${activeDays} active days → ${OUT.replace(ROOT + '\\', '').replace(ROOT + '/', '')} (${W}x${H})`);
