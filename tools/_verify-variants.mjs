// 一次性数据自检（不进发布包）：验证两态物资每个 id、每一态都能解析到真实存在的 GLB。
// 用 node 直接跑：node tools/_verify-variants.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = join(root, 'prototype', 'src');

// prizePool.js 是 ESM 且 import 了 three —— 这里只取数据表那段文本，不执行模块。
const code = readFileSync(join(src, 'prizePool.js'), 'utf8');
const tableSrc = code.slice(code.indexOf('export const PRIZE_TABLE'), code.indexOf('/** 按 id 找物资表条目 */'));
// eslint-disable-next-line no-new-func
const PRIZE_TABLE = new Function(`${tableSrc.replace('export const', 'const')}; return PRIZE_TABLE;`)();

const readManifest = (f) => {
  const t = readFileSync(join(src, f), 'utf8');
  const o = {};
  for (const m of t.matchAll(/"([\w-]+)"\s*:\s*'([^']+)'/g)) o[m[1]] = m[2];
  return o;
};
const M = readManifest('assets.manifest.js');
const G = readManifest('assets.manifest-good.js');
const P2 = readManifest('assets.manifest-good-p2.js');

const visual = (def, appearance) => {
  const v = appearance === 'rot' ? def.variants?.rot : def.variants?.manifest;
  const key = v?.glb ?? def.id;
  return v?.to ?? key;
};

let bad = 0;
const rows = [];
for (const def of PRIZE_TABLE) {
  const r = { id: def.id, disabled: !!def.disabled };
  for (const app of ['manifest', 'rot']) {
    const key = visual(def, app);
    const url = M[key] ?? G[key] ?? P2[key] ?? null;
    const onDisk = url ? existsSync(join(root, 'prototype', url.replace(/^\.\//, ''))) : false;
    r[app] = { key, url, onDisk };
    if (!url || !onDisk) { bad++; console.log(`MISSING ${def.id} [${app}] key=${key} url=${url} onDisk=${onDisk}`); }
  }
  rows.push(r);
}

console.log('\nid                  manifest-key -> file                        rot-key -> file');
for (const r of rows) {
  const f = (x) => `${x.key} -> ${x.url ? x.url.split('/').pop() : 'NULL'}`;
  console.log(`${r.id.padEnd(19)} ${f(r.manifest).padEnd(46)} ${f(r.rot)}${r.disabled ? '   (disabled, 不 spawn)' : ''}`);
}

// 配额别名覆盖检查
const questIds = ['bread', 'can', 'veg'];
const alias = { 'bread-rot': 'bread', 'can-rot': 'can', 'veg-rot': 'veg' };
const slotOf = (id) => alias[id] ?? (questIds.includes(id) ? id : null);
console.log('\n配额归属：');
for (const def of PRIZE_TABLE.filter(d => !d.disabled)) {
  console.log(`  ${def.id.padEnd(19)} -> ${slotOf(def.id) ?? '（不计配额：走"这不是今天的配额"）'}`);
}
const covered = questIds.every(s => PRIZE_TABLE.some(d => !d.disabled && slotOf(d.id) === s));
console.log(`\n三个配额格是否都可达成：${covered ? '是' : '否 ← BUG'}`);

// 两态资产盘点：哪些是"真的换了一套模型"，哪些只是调材质
console.log('\n两态资产盘点（真正换模型的才算一套对比）：');
let paired = 0;
for (const def of PRIZE_TABLE.filter(d => !d.disabled)) {
  const to = def.variants?.rot?.to ?? null;
  const manifestKey = def.variants?.manifest?.glb ?? def.id;
  const distinct = !!to && to !== manifestKey;
  if (distinct) paired++;
  console.log(`  ${def.id.padEnd(10)} ${distinct ? `成套：${manifestKey}.glb ↔ ${to}.glb` : `只调材质：${manifestKey}.glb（没有独立败露模型）`}`);
}
console.log(`\n真正成套的物品：${paired} / ${PRIZE_TABLE.filter(d => !d.disabled).length}`);
console.log(bad ? `\n${bad} 处解析失败` : '\n全部解析通过');
process.exit(bad || !covered ? 1 : 0);
