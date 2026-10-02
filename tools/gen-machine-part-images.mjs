#!/usr/bin/env node
// 机柜分件概念图（单件、灰底）→ 供 Tripo P2 image-to-model
//   node tools/gen-machine-part-images.mjs
//   node tools/gen-machine-part-images.mjs --parallel --only frame,top
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env-bootstrap.mjs';
import { runPixverseCli } from './pixverse-cli.mjs';

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'prototype', 'design', 'machine-parts');

// 勿写 whole cabinet / assembled machine —— 单图 Tripo 容易整柜化
const LOCK =
  'ONE detached spare part only, not an assembled claw machine, no other cabinet pieces visible, no prize pool no glass, centered with wide gray margin, orthographic product photo, stylized low-poly worn metal, no text';

const JOBS = [
  {
    id: 'machine_base',
    prompt: `Heavy rectangular pedestal base block, ${LOCK}`,
  },
  {
    id: 'machine_frame',
    prompt: `Open hollow four-post frame rail, ${LOCK}`,
  },
  {
    id: 'machine_top',
    prompt: `Thin flat roof lid slab, ${LOCK}`,
  },
  {
    id: 'machine_back',
    prompt: `Single flat vertical back metal plate, ${LOCK}`,
  },
  {
    id: 'machine_panel',
    prompt: `Small front control fascia box, ${LOCK}`,
  },
];

function destFor(job) {
  return path.join(OUT, `${job.id}-ref.png`);
}

async function generateOne(job) {
  const dest = destFor(job);
  fs.mkdirSync(OUT, { recursive: true });
  const args = [
    'create', 'image',
    '-m', 'seedream-5.0-pro',
    '-q', '1080p',
    '--aspect-ratio', '1:1',
    '--prompt', job.prompt,
    '--no-wait',
    '--json',
  ];
  console.log(`\n[img] ${job.id} …`);
  const created = await runPixverseCli(args, { timeoutMs: 120_000 });
  const id = created.image_id ?? created.id;
  if (!id) throw new Error(`无 image_id: ${JSON.stringify(created).slice(0, 300)}`);

  const waited = await runPixverseCli(
    ['task', 'wait', String(id), '--type', 'image', '--timeout', '900', '--json'],
    { timeoutMs: 960_000 },
  );
  const finalId = waited.image_id ?? waited.id ?? id;
  const dl = await runPixverseCli(
    ['asset', 'download', String(finalId), '--type', 'image', '--dest', OUT, '--json'],
    { timeoutMs: 600_000 },
  );
  const src = dl.file ?? dl.path;
  if (!src || !fs.existsSync(src)) throw new Error(`下载失败: ${JSON.stringify(dl).slice(0, 300)}`);
  if (path.resolve(src) !== path.resolve(dest)) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(src, dest);
  }
  console.log(`[ok] ${path.relative(ROOT, dest)}`);
  return dest;
}

async function main() {
  const argv = process.argv.slice(2);
  const parallel = argv.includes('--parallel');
  const only = argv.filter(a => a !== '--parallel' && !a.startsWith('--'));
  let list = JOBS;
  if (only.length) {
    list = JOBS.filter(j => only.some(o => j.id.includes(o)));
  }
  const pending = list.filter(j => {
    if (fs.existsSync(destFor(j))) {
      console.log(`[skip] ${j.id} 已有图`);
      return false;
    }
    return true;
  });
  if (!pending.length) {
    console.log('无需出图');
    return;
  }
  if (parallel) {
    const results = await Promise.allSettled(pending.map(generateOne));
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      for (const f of failed) console.error(f.reason);
      process.exit(1);
    }
  } else {
    for (const job of pending) await generateOne(job);
  }
  console.log('\n出图完成 →', path.relative(ROOT, OUT));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
