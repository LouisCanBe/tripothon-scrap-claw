#!/usr/bin/env node
// ============================================================
// World Labs Marble API 小工具（World API v1）
// 文本/图片/全景图/视频 → 可探索 3D 世界（GLB mesh / SPZ 点云 / 全景图）
//
// 三种用法（与 tripo.mjs 完全同构）：
//   1. CLI：    node tools/marble.mjs <命令> [--参数 值]
//   2. 模块：   import { MarbleClient } from './tools/marble.mjs'
//   3. 本地服务：node tools/marble.mjs serve --port 8788
//
// .env.local：MARBLE_API_KEY=wlt_xxx（或 WLT_API_KEY）；HTTPS_PROXY 走代理
//
// 注意：路径按官方文档 docs.worldlabs.ai/api 编写，尚未实测（等 key）。
//      报错时先核对 PATHS 表与官方文档是否一致。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 5000;
const TIMEOUT_MS = 20 * 60 * 1000;   // 世界生成比单模型慢，放宽到 20 分钟

// ---------- .env.local（与 tripo.mjs 同一套） ----------
function loadEnvFile() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\r\n]*?)["']?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnvFile();

// 代理自重启（同 tripo.mjs）
const HAS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy
               || process.env.HTTP_PROXY || process.env.http_proxy;
if (HAS_PROXY && import.meta.main && !process.env.SCRAPCLAW_LIB_MODE
    && process.env.NODE_USE_ENV_PROXY !== '1' && !process.argv.includes('--no-respawn')) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 0);
}

const API = (process.env.MARBLE_API_BASE || 'https://api.worldlabs.ai/marble/v1').replace(/\/$/, '');

// ============================================================
// 接口路径表（World API v1）
// ============================================================
const PATHS = {
  generate:      ['POST', '/worlds:generate'],                 // 生成世界 → operation_id
  operation:     ['GET',  '/operations/{id}'],                 // 轮询 → done + response.world_id
  world:         ['GET',  '/worlds/{id}'],                     // 世界详情（资产 URL）
  export:        ['POST', '/worlds/{id}:export'],              // 导出 {asset_type:'splats'|'mesh', format}
  prepareUpload: ['POST', '/media-assets:prepare_upload'],     // 本地图片上传（signed URL 流程）
};

// ============================================================
// MarbleClient
// ============================================================
export class MarbleClient {
  constructor({ key = (process.env.MARBLE_API_KEY || process.env.WLT_API_KEY)?.trim(), base = API } = {}) {
    if (!key) throw new Error('找不到 MARBLE_API_KEY（.env.local 里写 MARBLE_API_KEY=wlt_xxx，platform.worldlabs.ai 申请）');
    this.key = key;
    this.base = base.replace(/\/$/, '');
  }

  get headers() { return { 'WLT-Api-Key': this.key, 'Content-Type': 'application/json' }; }

  async call(method, p, body) {
    const url = this.base + p;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const code = e.cause?.code ?? e.message;
      throw new Error(`网络错误（${code}）→ ${method} ${url}\n    排查：检查代理/防火墙，或 MARBLE_API_BASE 换域名`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 402) throw new Error('余额不足（402）：去 platform.worldlabs.ai/billing 充值');
      throw new Error(`HTTP ${res.status} → ${method} ${url}：${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  }

  // 本地文件 → media_asset_id（图片 jpg/png/webp，视频 mp4）
  async uploadMedia(filePath, kind = 'image') {
    const file_name = path.basename(filePath).slice(0, 64);
    const extension = (path.extname(file_name).slice(1) || (kind === 'video' ? 'mp4' : 'png')).toLowerCase();
    const prep = await this.call('POST', '/media-assets:prepare_upload', { file_name, kind, extension });
    const info = prep.upload_info ?? {};
    const id = prep.media_asset?.media_asset_id;
    if (!info.upload_url || !id) throw new Error('prepare_upload 未返回 upload_url / media_asset_id');
    const buf = fs.readFileSync(filePath);
    const headers = { ...(info.required_headers ?? {}) };
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = kind === 'video' ? 'video/mp4' : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    }
    const res = await fetch(info.upload_url, { method: info.upload_method || 'PUT', headers, body: buf });
    if (!res.ok) throw new Error(`文件上传失败 HTTP ${res.status}`);
    return id;
  }

  // 生成世界。文本直接传；图片/全景/视频用 mediaAssetId（本地上传）或公网 uri。
  generate(input, opts = {}) {
    let world_prompt;
    const guide = input.text;
    if (input.mediaAssetId) {
      const ref = { source: 'media_asset', media_asset_id: input.mediaAssetId };
      world_prompt = input.kind === 'video'
        ? strip({ type: 'video', video_prompt: ref, text_prompt: guide })
        : strip({ type: 'image', image_prompt: ref, is_pano: input.isPano ?? 'auto', text_prompt: guide });
    } else if (input.imageUrl || input.panoUrl) {
      world_prompt = strip({
        type: 'image',
        image_prompt: { source: 'uri', uri: input.imageUrl || input.panoUrl },
        is_pano: input.panoUrl ? true : 'auto',
        text_prompt: guide,
      });
    } else if (input.videoUrl) {
      world_prompt = strip({ type: 'video', video_prompt: { source: 'uri', uri: input.videoUrl }, text_prompt: guide });
    } else if (guide) {
      world_prompt = { type: 'text', text_prompt: guide };
    } else throw new Error('generate 需要 text，或图片/全景/视频（本地上传或公网 URL）');
    return this.call('POST', '/worlds:generate', strip({
      display_name: opts.displayName,
      model: opts.model ?? 'marble-1.0-draft',   // 测试默认 draft（150 积分）；正式用 marble-1.1 / plus
      seed: opts.seed,
      tags: opts.tags,
      world_prompt,
    }));
  }

  getCredits() { return this.call('GET', '/credits'); }
  getOperation(id) { return this.call('GET', `/operations/${id}`); }
  getWorld(id)     { return this.call('GET', `/worlds/${id}`); }
  exportWorld(id, assetType = 'mesh', format = 'glb') {
    return this.call('POST', `/worlds/${id}:export`, { asset_type: assetType, format });
  }

  // 轮询 operation → 完成后取 world 详情
  async poll(operationId, { onProgress, pollMs = POLL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, pollMs));
      const op = await this.getOperation(operationId);
      onProgress?.(op.done ? 'done' : 'running', op.progress ?? 0);
      if (op.done) {
        if (op.error) throw new Error(`生成失败：${JSON.stringify(op.error)}`);
        const worldId = op.response?.world_id;
        return worldId ? this.getWorld(worldId) : op.response;
      }
    }
    throw new Error('轮询超时（20 分钟）');
  }

  async download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }

  // 从 world 对象里挑资产 URL。实测结构（2026-09）：
  //   assets.mesh.collider_mesh_url  免费基础 GLB（hq_mesh_url 要 3500 积分导出）
  //   assets.imagery.pano_url        全景图 PNG
  //   assets.splats.spz_urls.{500k,100k,full_res}  高斯点云
  assetURL(world, prefer = 'mesh') {
    const a = world?.assets ?? {};
    if (prefer === 'mesh')  return a.mesh?.collider_mesh_url ?? a.mesh?.hq_mesh_url ?? null;
    if (prefer === 'pano')  return a.imagery?.pano_url ?? null;
    if (prefer === 'spz')   return a.splats?.spz_urls?.['100k'] ?? a.splats?.spz_urls?.full_res ?? null;
    return a.mesh?.collider_mesh_url ?? a.imagery?.pano_url ?? a.splats?.spz_urls?.full_res ?? null;
  }

  // 一条龙：生成 → 轮询 → （可选）下载
  async run(input, { out, onProgress, ...opts } = {}) {
    const op = await this.generate(input, opts);
    const operationId = op.operation_id ?? op.id;
    const world = await this.poll(operationId, { onProgress });
    const url = this.assetURL(world);
    if (out && url) await this.download(url, out);
    return { operationId, world, saved: out && url ? out : null };
  }
}

// ============================================================
// CLI
// ============================================================
const COMMANDS = `
命令（--后参数一律 --key value，value 自动尝试按 JSON 解析）：
  credits                                       查询 API 剩余积分（与 Marble 网页会员分开）
  gen       --text "废弃便利店，黄昏，暖光"        文本生成世界
            --image <图片URL>                     图片生成
            --pano <360°全景图URL>                全景图生成
            [--model marble-1.0-draft|marble-1.1|marble-1.1-plus] [--seed 42] [--name 显示名]
            默认模型 marble-1.0-draft。图片/全景/视频须是可公网访问的 URL。
  op        --id <operation_id>                   查生成进度
  world     --id <world_id>                       世界详情（资产 URL）
  export    --id <world_id> [--type mesh|splats] [--format glb|ply|spz]
  call      --method POST --path /worlds:generate --body '{"…"}'   逃生舱
  serve     [--port 8788]                         本地 HTTP 转发

通用：--wait 轮询到完成；--out <路径> 完成后下载资产；--dry 只打印请求不调用
例：node tools/marble.mjs gen --text "雨后的小巷，霓虹倒影" --wait --out prototype/assets/worlds/alley.glb
`;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const k = rest[i].slice(2);
    const v = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
    if (typeof v === 'string') { try { opts[k] = JSON.parse(v); } catch { opts[k] = v; } }
    else opts[k] = v;
  }
  return { cmd, opts };
}

async function cli() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || cmd === '-h') { console.log(COMMANDS); return; }

  if (cmd === 'serve') { const { serve } = await import('./marble.serve.mjs'); return serve(opts.port ?? 8788); }

  const dry = !!opts.dry;
  const client = dry ? null : new MarbleClient();
  const show = (label, data) => console.log(label, JSON.stringify(data, null, 2));

  switch (cmd) {
    case 'credits':
    case 'balance': {
      if (dry) return show('[dry] GET /credits', {});
      const b = await client.getCredits();
      console.log(`剩余 API 积分：${b.remaining_credits}`);
      show('credits:', b);
      break;
    }
    case 'gen': {
      const input = { text: opts.text, imageUrl: opts.image, panoUrl: opts.pano, videoUrl: opts.video };
      const genOpts = { model: opts.model, seed: opts.seed, displayName: opts.name, tags: opts.tags };
      if (dry) return show(`[dry] POST ${API}/worlds:generate\n`, { input, ...genOpts });
      if (opts.wait || opts.out) {
        const r = await client.run(input, {
          out: opts.out, ...genOpts,
          onProgress: (s, p) => process.stdout.write(`\r  ${s} ${p}%   `),
        });
        console.log(`\n✓ world=${r.world?.world_id ?? r.world?.id ?? '?'}${r.saved ? ' → ' + r.saved : ''}`);
        if (!r.saved) show('world:', r.world);
      } else {
        show('operation:', await client.generate(input, genOpts));
      }
      break;
    }
    case 'op':     show('operation:', await client.getOperation(opts.id)); break;
    case 'world':  show('world:', await client.getWorld(opts.id)); break;
    case 'export': show('export:', await client.exportWorld(opts.id, opts.type ?? 'mesh', opts.format ?? 'glb')); break;
    case 'call':   show('result:', await client.call(opts.method ?? 'POST', opts.path, opts.body)); break;
    default: console.error(`未知命令 "${cmd}"\n${COMMANDS}`);
  }
}

const strip = o => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));

if (import.meta.main && !process.env.SCRAPCLAW_LIB_MODE) {
  cli().catch(e => { console.error(e.message ?? e); process.exit(1); });
}
