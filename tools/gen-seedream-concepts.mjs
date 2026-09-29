#!/usr/bin/env node
// 一次性：首轮 6 张 Seedream 概念图 → prototype/design/concepts/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env-bootstrap.mjs';
import { runPixverseCli } from './pixverse-cli.mjs';

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'prototype', 'design', 'concepts');
const STYLE_REF = path.join(OUT, 'scrapyard-thickpaint-seedream50pro-16x9.png');

const STYLE =
  'thick digital painting, hand-painted stylized texture, post-apocalyptic scavenger claw-machine world, cinematic lighting, no watermark, no legible text or logos';
const MEMORY =
  'warm amber film grain, childhood memory tone, clean bright lighting';

const JOBS = [
  {
    out: 'cabinet-rust-teaching-fisheye-seedream50pro-16x9',
    ref: true,
    prompt:
      `Fisheye lens view into a rusty vintage claw machine cabinet interior, single warm bare bulb, peeling paint and stickers, prize pool with clean memory-era food: loaf bread, bean can, apple, milk carton, teaching moment composition, worn rust shell but food looks intact, ${STYLE}`,
  },
  {
    out: 'cabinet-scrap-quota-fisheye-seedream50pro-16x9',
    ref: true,
    prompt:
      `Same fisheye claw machine framing, scavenger quota era: dirty scratched glass, cold gray-green fill light, dim bulb, prize pool mixed with emergency ration bags, rusted cans, moldy blocks, wire tangles, empty boxes, oppressive mood, ${STYLE}`,
  },
  {
    out: 'props-memory-food-lineup-seedream50pro-16x9',
    ref: false,
    prompt:
      `Horizontal game prop concept lineup on dark neutral ground: bread loaf, bean tin can, vegetable bunch, milk carton, cheese block, clean warm colors, stylized low-poly-friendly shapes, memory-era food set for claw machine, ${STYLE}`,
  },
  {
    out: 'props-reality-junk-lineup-seedream50pro-16x9',
    ref: false,
    prompt:
      `Horizontal prop lineup matching memory food silhouettes: moldy bread block, rust can, rotting vegetable lump, crushed carton, stained cheese-like mass, brick, rag ball, foil wad, rust mold stains, cold gray-green, same camera as food lineup, ${STYLE}`,
  },
  {
    out: 'reveal-ruins-wide-scrapyard-seedream50pro-16x9',
    ref: true,
    prompt:
      `Wide cinematic scrapyard panorama, wrecked claw machine cabinets and industrial ruins, gray mist, distant debris, cold green-gray atmosphere, ending reveal mood, ${STYLE}`,
  },
  {
    out: 'last-meal-memory-table-seedream50pro-16x9',
    ref: false,
    prompt:
      `Warm amber nostalgic memory, small worn table with simple meal: bread soup bowl, tin can, blanched greens, soft window light, subtle film grain, faint tiny child silhouettes in background blur, emotional contrast before harsh truth, ${STYLE}`,
  },
];

/** assets-master.json 中 status=todo 的 2D 概念（约 15 积分/张 @ 1080p seedream-5.0-pro） */
const JOBS_ROUND2 = [
  {
    out: 'cabinet-clean-memory-fisheye-seedream50pro-16x9',
    prompt:
      `Fisheye lens close to clean glass claw machine cabinet, bright white top light, prize pool with loaf bread, bean can, apples, milk carton, cookies, plush bear and rabbit in back row, pristine nostalgic arcade, ${MEMORY}, ${STYLE}`,
  },
  {
    out: 'cabinet-warm-flashback-polaroid-seedream50pro-16x9',
    prompt:
      `Full-screen warm flashback: vintage claw machine, hand pressing red start button, cake and cans inside, polaroid photo of little girl taped on glass, slight overexposure, ${MEMORY}, ${STYLE}`,
  },
  {
    out: 'silhouette-pairs-bread-can-veg-seedream50pro-16x9',
    prompt:
      `Concept sheet three pairs side by side on dark ground: bread vs moldy block, tin can vs rust can, vegetable bunch vs rotting lump, black silhouette emphasis, memory left reality right, ${STYLE}`,
  },
  {
    out: 'last-meal-truth-table-seedream50pro-16x9',
    prompt:
      `Harsh reality final scene: wooden crate table, moldy bread, single candle, fruit tin can on dirty floor, small bed in background, adult hand resting near can not picking up, cold dim light, ${STYLE}`,
  },
  {
    out: 'glitch-frame-tear-seedream50pro-16x9',
    prompt:
      `Claw machine view inside square frame tearing apart, RGB chromatic aberration, scanlines, jump frames, memory glitch transition, surreal break, ${STYLE}`,
  },
  {
    out: 'ui-ration-wall-scrap',
    outDir: 'prototype/design',
    aspectRatio: '4:3',
    prompt:
      `Handwritten ration checklist pinned on dirty concrete wall with tape, three empty checkboxes for bread can vegetables, scavenger era, worn paper stains, no readable words only scribble marks, ${STYLE}`,
  },
];

const JOBS_ROUND3 = [
  {
    out: 'key-visual-scrapyard-claw-seedream50pro-16x9',
    ref: false,
    prompt:
      `Key visual poster composition, scavenger claw machine in industrial scrapyard ruins, gray mist, distant wreckage, heroic low angle, thick digital painting poster art, ${STYLE}`,
  },
  {
    out: 'reveal-truth-hand-can-seedream50pro-16x9',
    prompt:
      `Close-up cinematic frame, dirty weathered hand in palm holding only one small rusted food tin can, dark muted background blur, harsh truth moment, emotional still, ${STYLE}`,
  },
];

function jobDest(job) {
  if (job.dest) return path.join(ROOT, job.dest);
  const dir = job.outDir ? path.join(ROOT, job.outDir) : OUT;
  return path.join(dir, `${job.out}.png`);
}

async function generateOne(job) {
  const quality = job.quality ?? '1080p';
  const ratio = job.aspectRatio ?? '16:9';
  const outDir = job.outDir ? path.join(ROOT, job.outDir) : OUT;
  fs.mkdirSync(outDir, { recursive: true });
  const dest = jobDest(job);

  const args = [
    'create', 'image',
    '-m', 'seedream-5.0-pro',
    '-q', quality,
    '--aspect-ratio', ratio,
    '--prompt', job.prompt,
    '--no-wait',
    '--json',
  ];
  if (job.ref && fs.existsSync(STYLE_REF)) {
    args.push('--image', STYLE_REF);
  }
  console.log(`\n[gen] ${job.out} …`);
  const created = await runPixverseCli(args, { timeoutMs: 120_000 });
  const id = created.image_id ?? created.id;
  if (!id) throw new Error(`无 image_id: ${JSON.stringify(created).slice(0, 400)}`);
  if (created.cost_credits != null) console.log(`[credits] ${job.out}: ${created.cost_credits}`);

  const waited = await runPixverseCli(
    ['task', 'wait', String(id), '--type', 'image', '--timeout', '900', '--json'],
    { timeoutMs: 960_000 },
  );
  const finalId = waited.image_id ?? waited.id ?? id;

  const dl = await runPixverseCli(
    ['asset', 'download', String(finalId), '--type', 'image', '--dest', outDir, '--json'],
    { timeoutMs: 600_000 },
  );
  const src = dl.file ?? dl.path;
  if (!src || !fs.existsSync(src)) {
    throw new Error(`下载失败: ${JSON.stringify(dl).slice(0, 400)}`);
  }
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.renameSync(src, dest);
  }
  console.log(`[ok] ${dest}`);
  return dest;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const argv = process.argv.slice(2);
  const parallel = argv.includes('--parallel');
  const round2 = argv.includes('--round2');
  const round3 = argv.includes('--round3');
  const only = argv.filter(a => a !== '--parallel' && a !== '--round2' && a !== '--round3');
  const pool = round3 ? JOBS_ROUND3 : round2 ? JOBS_ROUND2 : JOBS;
  const list = only.length
    ? pool.filter(j => only.some(a => j.out.includes(a)))
    : pool;
  if (!list.length) {
    console.error('无匹配任务，可用前缀过滤，例如: node tools/gen-seedream-concepts.mjs cabinet-rust');
    process.exit(1);
  }
  const pending = list.filter(job => {
    const dest = jobDest(job);
    if (fs.existsSync(dest)) {
      console.log(`[skip] 已存在 ${path.basename(dest)}`);
      return false;
    }
    return true;
  });
  if (!pending.length) {
    console.log('\n无需生成');
    return;
  }
  if (parallel) {
    console.log(`[parallel] ${pending.length} 张同时提交…`);
    const results = await Promise.allSettled(pending.map(job => generateOne(job)));
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      for (const f of failed) console.error(f.reason);
      process.exit(1);
    }
  } else {
    for (const job of pending) await generateOne(job);
  }
  console.log('\n全部完成:', pending.length);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
