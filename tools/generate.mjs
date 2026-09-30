#!/usr/bin/env node
// ============================================================
// 《拾荒娃娃机》Tripo 批量生成管线（离线工具，M2 冒烟 / 资产生产）
//
// 为什么不在浏览器里直接调 API？
//   1. Key 安全：key 只留在本脚本（读 .env.local），前端代码里没有，玩家抓不到
//   2. 确定性：GLB 落盘成本地资产，demo 不依赖网络/API 状态，演示不翻车
//   3. 可策展：单件不满意 → 改 prompts.json → --only 重生，其余不动
//   4. 浏览器直连 Tripo 大概率被 CORS 挡，异步轮询也不该塞给玩家
//
// 用法：
//   node tools/generate.mjs                   # 生成 prompts.json 全部物品（已有文件的跳过）
//   node tools/generate.mjs --only bread,can  # 只生成指定物品（冒烟测试：先跑这两个！）
//   node tools/generate.mjs --force           # 无视已有文件，全部重生
//   node tools/generate.mjs --dry             # 只打印请求体不调 API（检查 prompt 不花积分）
//   node tools/generate.mjs claw              # 爪子分件实验（generate_parts，无贴图）
//
// .env.local 格式：TRIPO_API_KEY=tsk_xxxxxxxx（无需引号；模板见根目录 .env.example）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MACHINE = path.join(ROOT, 'prototype', 'assets', 'machine');
const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;

// ---------- .env.local / .env 解析到 process.env（系统环境变量优先） ----------
function loadEnvFile() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); // 去 BOM
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\r\n]*?)["']?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnvFile();

// 代理支持：.env.local 配了 HTTPS_PROXY 时，带 NODE_USE_ENV_PROXY=1 重启自身。
// 注意：Node 只在进程启动时读取该开关（脚本内运行时设置无效），所以必须 respawn 一次。
const HAS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy
               || process.env.HTTP_PROXY || process.env.http_proxy;
if (HAS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },  // 子进程启动即携带开关 → 生效
  });
  process.exit(r.status ?? 0);
}

// 域名二选一（用 TRIPO_API_BASE 覆盖）：
//   .com —— 国内站账号，直连即可（.ai 在部分网络下直连超时）
//   .ai  —— 国际站 platform.tripo3d.ai 账号，本机需配 HTTPS_PROXY
const API = process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.com/v3';

// ---------- 命令行参数 ----------
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : null;
const CLAW_TEST = args[0] === 'claw';
const setIdx = args.indexOf('--set');
const PRIZE_SET = setIdx >= 0 ? args[setIdx + 1] : 'default';
const OUT_PRIZES = PRIZE_SET === 'good'
  ? path.join(ROOT, 'prototype', 'assets', 'prizes-good')
  : path.join(ROOT, 'prototype', 'assets', 'prizes');
const MANIFEST = PRIZE_SET === 'good'
  ? path.join(ROOT, 'prototype', 'src', 'assets.manifest-good.js')
  : path.join(ROOT, 'prototype', 'src', 'assets.manifest.js');
const PROMPTS_FILE = PRIZE_SET === 'good' ? 'prompts-good.json' : 'prompts.json';

const loadKey = () => process.env.TRIPO_API_KEY?.trim() ?? null;

const headers = key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

// fetch 包装：把 undici 的 "fetch failed" 翻译成能看懂的话
async function req(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    const code = e.cause?.code ?? e.message;
    throw new Error(`网络错误（${code}）→ ${url}\n    排查：域名不通可设 TRIPO_API_BASE 换域名（.com/.ai），或检查代理/防火墙`);
  }
}

async function submit(key, endpoint, body) {
  const res = await req(`${API}/generation/${endpoint}`, {
    method: 'POST', headers: headers(key), body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`提交失败：${JSON.stringify(json)}`);
  return json.data.task_id;
}

async function poll(key, taskId, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const res = await req(`${API}/tasks/${taskId}`, { headers: headers(key) });
    const d = (await res.json()).data ?? {};
    process.stdout.write(`\r  [${label}] ${d.status ?? '?'} ${d.progress ?? 0}%   `);
    if (d.status === 'success') { process.stdout.write('\n'); return d.output.model_url; }
    if (d.status === 'failed' || d.status === 'cancelled')
      throw new Error(`任务 ${d.status}：${JSON.stringify(d.error ?? d)}`);
  }
  throw new Error('轮询超时（10 分钟）');
}

async function download(url, dest) {
  const res = await req(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return (fs.statSync(dest).size / 1024).toFixed(0) + 'KB';
}

// manifest 永远反映 OUT_PRIZES 目录实况：有文件才登记
function rebuildManifest() {
  if (!fs.existsSync(OUT_PRIZES)) return;
  const relDir = PRIZE_SET === 'good' ? 'prizes-good' : 'prizes';
  const exportName = PRIZE_SET === 'good' ? 'GLB_MANIFEST_GOOD' : 'GLB_MANIFEST';
  const ids = fs.readdirSync(OUT_PRIZES).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort();
  const lines = ids.map(id => `  ${JSON.stringify(id)}: './assets/${relDir}/${id}.glb',`).join('\n');
  const header = PRIZE_SET === 'good'
    ? `// 【自动生成，勿手改】由 tools/generate.mjs --set good 维护`
    : `// 【自动生成，勿手改】由 tools/generate.mjs 维护
// 键 = 奖品 id（对应 prizePool.js 数据表），值 = GLB 路径
// 无条目的物品保持几何体显示 —— 灰盒与 Tripo 资产可混用`;
  fs.writeFileSync(MANIFEST, `${header}
export const ${exportName} = {
${lines}
};
`);
  console.log(`manifest 已更新（${ids.length} 件, set=${PRIZE_SET})→ ${path.relative(ROOT, MANIFEST)}`);
}

// def.prompt 经 _style 统一风格后缀；def 里带 "image" 字段则走 image-to-model
function buildRequest(cfg, def) {
  const { image, ...overrides } = def;
  const base = { ...cfg._defaults, ...overrides };
  delete base.prompt;
  if (image) return { endpoint: 'image-to-model', body: { input: image, ...base } };
  return { endpoint: 'text-to-model', body: { prompt: `${def.prompt}, ${cfg._style}`, ...base } };
}

async function runOne(key, endpoint, body, label, dest) {
  if (!FORCE && fs.existsSync(dest)) { console.log(`跳过 ${label}（已存在，--force 可重生）`); return; }
  if (DRY) { console.log(`[dry] ${label} → POST /generation/${endpoint}\n${JSON.stringify(body, null, 2)}\n`); return; }
  console.log(`生成 ${label} …`);
  const taskId = await submit(key, endpoint, body);
  const url = await poll(key, taskId, label);
  const size = await download(url, dest);
  console.log(`  ✓ ${label} → ${path.relative(ROOT, dest)}（${size}）`);
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', PROMPTS_FILE), 'utf8'));
  if (!DRY) console.log(`奖品套：${PRIZE_SET}（${PROMPTS_FILE} → ${path.relative(ROOT, OUT_PRIZES)}/）`);

  const key = DRY ? '(dry)' : loadKey();
  if (!key) {
    console.error('找不到 TRIPO_API_KEY：请在项目根目录 .env.local 里写一行 TRIPO_API_KEY=你的key');
    process.exit(1);
  }

  // 爪子分件实验：generate_parts 与贴图互斥（官方限制：必须 texture:false + pbr:false）
  // 产出无贴图分件网格 → 验证"AI 分件能否驱动三爪开合动画"
  // 验证不过就继续用灰盒的 procedural 爪子 —— 爪子本来就不是适合 AI 生成的资产
  if (CLAW_TEST) {
    const c = cfg._claw;
    await runOne(key, 'text-to-model',
      { prompt: c.prompt, model: c.model ?? 'v3.1-20260211', generate_parts: true, texture: false, pbr: false },
      'claw_parts(分件实验)', path.join(OUT_MACHINE, 'claw_parts.glb'));
    return;
  }

  for (const [id, def] of Object.entries(cfg.items)) {
    if (ONLY && !ONLY.includes(id)) continue;
    const { endpoint, body } = buildRequest(cfg, def);
    try {
      await runOne(key, endpoint, body, id, path.join(OUT_PRIZES, `${id}.glb`));
    } catch (e) {
      console.error(`\n✗ ${id} 失败：${e.message}（继续下一件）`);
    }
  }
  if (!DRY) rebuildManifest();
  console.log('完成。刷新页面即可看到替换效果（GLB 热替换几何体，抓取判定不变）。');
}

main().catch(e => { console.error(e); process.exit(1); });
