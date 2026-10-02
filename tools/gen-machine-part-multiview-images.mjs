#!/usr/bin/env node
// 每件 4 张正交视图 → Tripo multiview-to-model（避免单图生出整柜）
//   node tools/gen-machine-part-multiview-images.mjs --parallel
//   node tools/gen-machine-part-multiview-images.mjs --only base,back
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env-bootstrap.mjs';
import { runPixverseCli } from './pixverse-cli.mjs';

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'prototype', 'design', 'machine-parts');

const VIEWS = ['front', 'left', 'back', 'right'];

const PARTS = {
  machine_base: 'arcade claw machine pedestal base block ONLY, heavy rectangular feet, no posts no roof no walls',
  machine_frame: 'open hollow corner-post frame ONLY, four posts and top rail, empty center, no base no back panel',
  machine_top: 'flat thin roof lid slab ONLY, no sides no posts',
  machine_back: 'single flat vertical metal back plate ONLY, no frame no floor no sides',
  machine_panel: 'small front control fascia box ONLY, coin slot and joystick, no glass no cabinet',
};

const LOCK =
  'ONE isolated game prop part only, detached spare part, not assembled claw machine, no prize pool no glass no other parts in frame, centered on plain neutral gray background, orthographic studio product photo, stylized low-poly worn metal, no text';

function destFor(id, view) {
  return path.join(OUT, `${id}-${view}.png`);
}

async function generateView(id, desc, view) {
  const dest = destFor(id, view);
  const prompt = `${desc}, orthographic ${view} view, ${LOCK}`;
  const args = [
    'create', 'image', '-m', 'seedream-5.0-pro', '-q', '1080p', '--aspect-ratio', '1:1',
    '--prompt', prompt, '--no-wait', '--json',
  ];
  console.log(`\n[img] ${id} ${view} …`);
  const created = await runPixverseCli(args, { timeoutMs: 120_000 });
  const imgId = created.image_id ?? created.id;
  if (!imgId) throw new Error(`无 image_id`);
  await runPixverseCli(
    ['task', 'wait', String(imgId), '--type', 'image', '--timeout', '900', '--json'],
    { timeoutMs: 960_000 },
  );
  const dl = await runPixverseCli(
    ['asset', 'download', String(imgId), '--type', 'image', '--dest', OUT, '--json'],
    { timeoutMs: 600_000 },
  );
  const src = dl.file ?? dl.path;
  if (!src || !fs.existsSync(src)) throw new Error('下载失败');
  if (path.resolve(src) !== path.resolve(dest)) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(src, dest);
  }
  console.log(`[ok] ${path.relative(ROOT, dest)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const parallel = argv.includes('--parallel');
  const only = argv.filter(a => a !== '--parallel');
  let ids = Object.keys(PARTS);
  if (only.length) {
    ids = ids.filter((id) => only.some((o) => {
      const t = o.trim().replace(/^machine_/, '');
      return id === o || id === `machine_${t}` || id.includes(t);
    }));
  }

  const tasks = [];
  for (const id of ids) {
    for (const view of VIEWS) {
      if (fs.existsSync(destFor(id, view))) {
        console.log(`[skip] ${id}-${view}`);
        continue;
      }
      tasks.push(() => generateView(id, PARTS[id], view));
    }
  }
  if (!tasks.length) {
    console.log('无需出图');
    return;
  }
  if (parallel) {
    const pool = 2;
    let i = 0;
    const workers = Array.from({ length: pool }, async () => {
      while (i < tasks.length) {
        const j = i++;
        await tasks[j]();
      }
    });
    await Promise.all(workers);
  } else {
    for (const t of tasks) await t();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
