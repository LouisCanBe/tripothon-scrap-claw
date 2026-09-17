#!/usr/bin/env node
// ============================================================
// Tripo API 全接口小工具（v3 形态，openapi.tripo3d.com / .ai 通用）
//
// 三种用法：
//   1. CLI：    node tools/tripo.mjs <命令> [--参数 值]     （下面 COMMANDS 列表）
//   2. 模块：   import { TripoClient } from './tools/tripo.mjs'（给将来的可视化界面/脚本复用）
//   3. 本地服务：node tools/tripo.mjs serve --port 8787
//               包一层 HTTP 转发 → 浏览器 UI 直连（绕 CORS，key 不出前端）
//
// 与 generate.mjs 的分工：generate.mjs 是"按 prompts.json 批量生产资产"的业务管线；
// 本文件是"Tripo API 本身"的完整薄封装，不带业务逻辑。
//
// .env.local：TRIPO_API_KEY=tsk_xxx；可选 TRIPO_API_BASE 换域名、HTTPS_PROXY 走代理
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;

// ---------- .env.local 解析（与 generate.mjs 同一套） ----------
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

// 代理：Node 只在启动时读 NODE_USE_ENV_PROXY → 配了代理就带开关重启自身一次
const HAS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy
               || process.env.HTTP_PROXY || process.env.http_proxy;
if (HAS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1' && !process.argv.includes('--no-respawn')) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 0);
}

const API = (process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.com/v3').replace(/\/$/, '');

// ============================================================
// 接口路径表（v3）
//   ✓ = 已实测/官方文档明确；? = 文档未核实到精确路径，404 时按官方文档改这里即可
// 所有命名方法最终都走 client.call(method, path, body)，表里没有的接口用 call 直接调。
// ============================================================
const PATHS = {
  // —— 生成 ——
  textToModel:      ['POST', '/generation/text-to-model'],        // ✓ 文本→模型（generate_parts 分件也走这）
  imageToModel:     ['POST', '/generation/image-to-model'],       // ✓ 图片→模型（input 支持 URL / file_token）
  multiviewToModel: ['POST', '/generation/multiview-to-model'],   // ✓ 四视图→模型（P 系模型，低面数干净拓扑）
  // —— 后处理 ——
  refine:           ['POST', '/generation/refine'],               // ? 草稿精修（v2 叫 refine_model）
  texture:          ['POST', '/generation/texture'],              // ? 已有模型重新贴图（v2 叫 texture_model）
  convert:          ['POST', '/generation/convert'],              // ? 格式转换 GLB/FBX/USDZ…（v2 叫 convert_model）
  // —— 动画 ——
  rigCheck:         ['POST', '/animations/rig-check'],            // ✓ 检查模型可否绑骨 → rig_type
  rig:              ['POST', '/animations/rig'],                  // ? 自动绑骨
  retarget:         ['POST', '/animations/retarget'],             // ? 套用预设动画（v2 叫 animate_retarget，如 preset:run）
  // —— 任务 / 账户 ——
  task:             ['GET',  '/tasks/{id}'],                      // ✓ 单任务查询（轮询用）
  tasks:            ['GET',  '/tasks'],                           // ? 任务列表
  upload:           ['POST', '/files'],                           // ? 文件上传→file_token（v2 是 /v2/openapi/upload/sts）
  balance:          ['GET',  '/user/balance'],                    // ? 余额查询
};

// ============================================================
// TripoClient：薄封装。submit 返回原始 data；poll 到成功返回 output；download 落盘
// ============================================================
export class TripoClient {
  constructor({ key = process.env.TRIPO_API_KEY?.trim(), base = API } = {}) {
    if (!key) throw new Error('找不到 TRIPO_API_KEY（.env.local 里写 TRIPO_API_KEY=tsk_xxx）');
    this.key = key;
    this.base = base.replace(/\/$/, '');
  }

  get headers() { return { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }; }

  // 最底层：任意方法+路径+body。path 支持 {id} 占位。所有接口的逃生舱。
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
      throw new Error(`网络错误（${code}）→ ${method} ${url}\n    排查：换 TRIPO_API_BASE 域名（.com/.ai），或检查代理/防火墙`);
    }
    const json = await res.json().catch(() => ({}));
    if (json.code !== undefined && json.code !== 0) throw new Error(`接口报错：${JSON.stringify(json)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} → ${method} ${url}：${JSON.stringify(json).slice(0, 300)}`);
    return json.data ?? json;
  }

  // 按 PATHS 表名提交生成类任务 → task_id
  async submit(name, body = {}) {
    const entry = PATHS[name];
    if (!entry) throw new Error(`未知接口 "${name}"，已知：${Object.keys(PATHS).join(', ')}（或用 call() 直接调路径）`);
    const [method, p] = entry;
    const data = await this.call(method, p, body);
    return data.task_id ?? data;
  }

  getTask(id) { return this.call('GET', `/tasks/${id}`); }

  async poll(id, { onProgress, pollMs = POLL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, pollMs));
      const d = await this.getTask(id);
      onProgress?.(d.status ?? '?', d.progress ?? 0);
      if (d.status === 'success') return d.output ?? d;
      if (d.status === 'failed' || d.status === 'cancelled')
        throw new Error(`任务 ${d.status}：${JSON.stringify(d.error ?? d)}`);
    }
    throw new Error('轮询超时（10 分钟）');
  }

  async download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }

  // 上传本地文件 → file_token（multipart；Node ≥18 自带 FormData/Blob）
  async uploadFile(filePath, fieldName = 'file') {
    const buf = fs.readFileSync(filePath);
    const fd = new FormData();
    fd.append(fieldName, new Blob([buf]), path.basename(filePath));
    const [, p] = PATHS.upload;
    const res = await fetch(this.base + p, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body: fd });
    const json = await res.json().catch(() => ({}));
    if (json.code !== undefined && json.code !== 0) throw new Error(`上传失败：${JSON.stringify(json)}`);
    return json.data?.file_token ?? json.file_token ?? json.data;
  }

  // —— 命名便捷方法（参数细节见 TRIPO.md / 官方文档）——
  textToModel(prompt, opts = {})      { return this.submit('textToModel', { prompt, ...opts }); }
  imageToModel(input, opts = {})      { return this.submit('imageToModel', { input, ...opts }); }   // input: URL 或 file_token
  multiviewToModel(inputs, opts = {}) { return this.submit('multiviewToModel', { inputs, ...opts }); } // [{front:url},{left:tok}…]
  refineModel(draftTaskId, opts = {}) { return this.submit('refine', { draft_model_task_id: draftTaskId, ...opts }); }
  textureModel(taskId, opts = {})     { return this.submit('texture', { original_model_task_id: taskId, ...opts }); }
  convertModel(taskId, format, opts = {}) { return this.submit('convert', { original_model_task_id: taskId, format, ...opts }); }
  rigCheck(taskId)                    { return this.call('POST', '/animations/rig-check', { input: taskId }); }
  rigModel(taskId, opts = {})         { return this.submit('rig', { original_model_task_id: taskId, ...opts }); }
  retarget(taskId, animation, opts = {}) { return this.submit('retarget', { original_model_task_id: taskId, animation, ...opts }); } // 如 'preset:run'
  getBalance()                        { const [, p] = PATHS.balance; return this.call('GET', p); }

  // 一条龙：提交 → 轮询 → （可选）下载
  async run(name, body, { out, onProgress } = {}) {
    const taskId = await this.submit(name, body);
    const output = await this.poll(taskId, { onProgress });
    const url = output?.model_url ?? output?.model ?? output?.url;
    if (out && url) await this.download(url, out);
    return { taskId, output, saved: out && url ? out : null };
  }
}

// ============================================================
// CLI
// ============================================================
const COMMANDS = `
命令（--后参数一律 --key value，value 自动尝试按 JSON 解析）：
  text      --prompt "..." [--model v3.1-20260211] [--generate_parts true] [--texture true] …
  image     --input <图片URL或file_token> [--model …]
  multiview --inputs '[{"front":"url"},{"left":"token"}]' --model P1-20260311
  refine    --draft <草稿task_id>
  texture   --task <原模型task_id> [--texture_prompt '{"text":"生锈金属"}']
  convert   --task <task_id> --format USDZ [--quad true] [--face_limit 5000]
  rigcheck  --task <task_id>         检查可否绑骨
  rig       --task <task_id>         自动绑骨
  retarget  --task <task_id> --animation preset:run
  upload    --file <本地路径>         → file_token
  task      --id <task_id>           查单次状态
  balance                            查余额
  call      --method POST --path /generation/text-to-model --body '{"prompt":"…"}'   逃生舱
  serve     [--port 8787]            本地 HTTP 转发（给浏览器 UI 用）

通用：--wait 轮询到完成；--out <路径> 完成后下载；--dry 只打印请求不调用
例：node tools/tripo.mjs text --prompt "生锈的罐头" --wait --out prototype/assets/prizes/can2.glb
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

  if (cmd === 'serve') { const { serve } = await import('./tripo.serve.mjs'); return serve(opts.port ?? 8787); }

  const dry = !!opts.dry;
  const client = dry ? null : new TripoClient();
  const show = (label, data) => console.log(label, JSON.stringify(data, null, 2));

  // dry 模式：只打印将发出的请求
  if (dry && !['task', 'balance'].includes(cmd)) {
    const table = { text: 'textToModel', image: 'imageToModel', multiview: 'multiviewToModel', refine: 'refine', texture: 'texture', convert: 'convert', rig: 'rig', retarget: 'retarget' };
    if (table[cmd]) return show(`[dry] POST ${API}${PATHS[table[cmd]][1]}\n`, buildBody(cmd, opts));
    if (cmd === 'call') return show(`[dry] ${opts.method} ${API}${opts.path}\n`, opts.body);
  }

  switch (cmd) {
    case 'text': case 'image': case 'multiview': case 'refine': case 'texture': case 'convert': case 'rig': case 'retarget': {
      const body = buildBody(cmd, opts);
      const name = { text: 'textToModel', image: 'imageToModel', multiview: 'multiviewToModel', refine: 'refine', texture: 'texture', convert: 'convert', rig: 'rig', retarget: 'retarget' }[cmd];
      if (opts.wait || opts.out) {
        const r = await client.run(name, body, {
          out: opts.out,
          onProgress: (s, p) => process.stdout.write(`\r  ${s} ${p}%   `),
        });
        console.log(`\n✓ task=${r.taskId}${r.saved ? ' → ' + r.saved : ''}`);
        if (!r.saved) show('output:', r.output);
      } else {
        console.log('task_id =', await client.submit(name, body));
      }
      break;
    }
    case 'rigcheck': show('rig-check:', await client.rigCheck(opts.task)); break;
    case 'upload':   console.log('file_token =', await client.uploadFile(opts.file)); break;
    case 'task':     show('task:', await client.getTask(opts.id)); break;
    case 'balance':  show('balance:', await client.getBalance()); break;
    case 'call':     show('result:', await client.call(opts.method ?? 'POST', opts.path, opts.body)); break;
    default: console.error(`未知命令 "${cmd}"\n${COMMANDS}`);
  }
}

// 把 CLI 的扁平参数翻译成各接口的请求体
function buildBody(cmd, o) {
  switch (cmd) {
    case 'text':     return strip({ prompt: o.prompt, model: o.model, negative_prompt: o.negative_prompt, model_seed: o.model_seed, face_limit: o.face_limit, texture: o.texture, pbr: o.pbr, texture_quality: o.texture_quality, geometry_quality: o.geometry_quality, generate_parts: o.generate_parts, quad: o.quad, smart_low_poly: o.smart_low_poly, auto_size: o.auto_size });
    case 'image':    return strip({ input: o.input, model: o.model, face_limit: o.face_limit, texture: o.texture, pbr: o.pbr, texture_quality: o.texture_quality, texture_alignment: o.texture_alignment, orientation: o.orientation });
    case 'multiview':return strip({ inputs: o.inputs, model: o.model, face_limit: o.face_limit, texture: o.texture, pbr: o.pbr, texture_quality: o.texture_quality });
    case 'refine':   return strip({ draft_model_task_id: o.draft });
    case 'texture':  return strip({ original_model_task_id: o.task, texture_prompt: o.texture_prompt, texture: o.texture, pbr: o.pbr, texture_quality: o.texture_quality, texture_seed: o.texture_seed });
    case 'convert':  return strip({ original_model_task_id: o.task, format: o.format, quad: o.quad, face_limit: o.face_limit });
    case 'rig':      return strip({ original_model_task_id: o.task });
    case 'retarget': return strip({ original_model_task_id: o.task, animation: o.animation, out_format: o.out_format ?? 'glb' });
  }
}
const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// 直接运行（非 import）时进 CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(e => { console.error(e.message ?? e); process.exit(1); });
}
