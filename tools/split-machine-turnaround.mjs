#!/usr/bin/env node
// 把一张 2×2  turnaround 联络图裁成 front/left/back/right（需已安装 sharp: npm i -D sharp）
//   node tools/split-machine-turnaround.mjs machine_base machine_base-turnaround.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'prototype', 'design', 'machine-parts');
const VIEWS = ['front', 'left', 'back', 'right'];

async function main() {
  const id = process.argv[2];
  const srcName = process.argv[3] ?? `${id}-turnaround.png`;
  if (!id) {
    console.error('用法: node tools/split-machine-turnaround.mjs <machine_base> [turnaround.png]');
    process.exit(1);
  }
  const src = path.isAbsolute(srcName) ? srcName : path.join(OUT, srcName);
  if (!fs.existsSync(src)) {
    console.error('找不到:', src);
    process.exit(1);
  }
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('请先安装: npm i -D sharp');
    process.exit(1);
  }
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const cw = Math.floor(w / 2);
  const ch = Math.floor(h / 2);
  const quads = [
    { view: 'front', left: 0, top: 0 },
    { view: 'left', left: cw, top: 0 },
    { view: 'back', left: 0, top: ch },
    { view: 'right', left: cw, top: ch },
  ];
  for (const q of quads) {
    const dest = path.join(OUT, `${id}-${q.view}.png`);
    await sharp(src).extract({ left: q.left, top: q.top, width: cw, height: ch }).toFile(dest);
    console.log('→', path.relative(ROOT, dest));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
