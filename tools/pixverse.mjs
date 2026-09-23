#!/usr/bin/env node
// ============================================================
// PixVerse Platform API 小工具（openapi/v2）
// 文本/图片 → 视频；首尾帧过渡；余额查询；异步轮询 + 下载
//
// 三种用法（与 tripo.mjs / marble.mjs 同构）：
//   1. CLI：    node tools/pixverse.mjs <命令> [--参数 值]
//   2. 模块：   import { PixVerseClient } from './tools/pixverse.mjs'
//   3. 本地服务：node tools/pixverse.mjs serve --port 8789
//
// .env.local：PIXVERSE_API_KEY=xxx（platform.pixverse.ai 申请，与网页会员积分分开）
// 每个请求必须带唯一 Ai-trace-id（UUID），重复会返回上一次结果而非新建任务。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 4000;
const TIMEOUT_MS = 10 * 60 * 1000;

function loadEnvFile() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\r\n]*?)["']?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnvFile();

const HAS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy
               || process.env.HTTP_PROXY || process.env.http_proxy;
if (HAS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
  if (import.meta.main && !process.env.SCRAPCLAW_LIB_MODE && !process.argv.includes('--no-respawn')) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    });
    process.exit(r.status ?? 0);
  } else {
    process.env.NODE_USE_ENV_PROXY = '1';
  }
}

const API = (process.env.PIXVERSE_API_BASE || 'https://app-api.pixverse.ai/openapi/v2').replace(/\/$/, '');

// 路径表（按官方 docs.platform.pixverse.ai 整理；不通时用 call 逃生舱）
const PATHS = {
  upload:           ['POST', '/image/upload'],
  textToVideo:      ['POST', '/video/text/generate'],
  imageToVideo:     ['POST', '/video/img/generate'],
  transition:       ['POST', '/video/transition/generate'],
  extend:           ['POST', '/video/extend/generate'],
  videoResult:      ['GET',  '/video/result/{id}'],
  balance:          ['GET',  '/account/balance'],
};

// 视频状态（get result）
export const VIDEO_STATUS = {
  1: 'success',
  5: 'generating',
  6: 'deleted',
  7: 'moderation_failed',
  8: 'generation_failed',
};

export class PixVerseClient {
  constructor({ key = process.env.PIXVERSE_API_KEY?.trim(), base = API } = {}) {
    if (!key) throw new Error('找不到 PIXVERSE_API_KEY（.env.local 里写 PIXVERSE_API_KEY=xxx，platform.pixverse.ai 申请）');
    this.key = key;
    this.base = base.replace(/\/$/, '');
  }

  traceId() { return randomUUID(); }

  async call(method, p, body, { traceId, multipart } = {}) {
    const url = this.base + p;
    const headers = {
      'API-KEY': this.key,
      'Ai-trace-id': traceId ?? this.traceId(),
    };
    let payload;
    if (multipart) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (e) {
      const code = e.cause?.code ?? e.message;
      throw new Error(`网络错误（${code}）→ ${method} ${url}\n    排查：检查代理/防火墙，或 PIXVERSE_API_BASE`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} → ${method} ${p}：${JSON.stringify(json).slice(0, 400)}`);
    }
    if (json.ErrCode !== undefined && json.ErrCode !== 0) {
      throw new Error(`PixVerse ErrCode=${json.ErrCode}：${json.ErrMsg ?? JSON.stringify(json).slice(0, 200)}`);
    }
    return json.Resp ?? json;
  }

  /** 上传本地图片 → img_id（整数） */
  async uploadImage(filePath, { traceId } = {}) {
    const buf = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const form = new FormData();
    form.append('image', new Blob([buf]), name);
    return this.call('POST', '/image/upload', form, { traceId, multipart: true });
  }

  /** 文本生成视频 */
  textToVideo(opts = {}) {
    const body = strip({
      prompt: opts.prompt,
      model: opts.model ?? 'v5.5',
      duration: opts.duration ?? 5,
      quality: opts.quality ?? '540p',
      aspect_ratio: opts.aspect_ratio ?? opts.aspectRatio ?? '16:9',
      motion_mode: opts.motion_mode ?? opts.motionMode ?? 'normal',
      negative_prompt: opts.negative_prompt ?? opts.negativePrompt,
      seed: opts.seed,
      template_id: opts.template_id ?? opts.templateId,
    });
    if (!body.prompt) throw new Error('textToVideo 需要 prompt');
    return this.call('POST', '/video/text/generate', body, { traceId: opts.traceId });
  }

  /** 图片生成视频（需先 upload 得 img_id） */
  imageToVideo(opts = {}) {
    const body = strip({
      img_id: opts.img_id ?? opts.imgId,
      prompt: opts.prompt ?? '',
      model: opts.model ?? 'v5.5',
      duration: opts.duration ?? 5,
      quality: opts.quality ?? '540p',
      aspect_ratio: opts.aspect_ratio ?? opts.aspectRatio ?? '16:9',
      motion_mode: opts.motion_mode ?? opts.motionMode ?? 'normal',
      negative_prompt: opts.negative_prompt ?? opts.negativePrompt,
      seed: opts.seed,
      template_id: opts.template_id ?? opts.templateId,
    });
    if (body.img_id == null) throw new Error('imageToVideo 需要 img_id（先 upload）');
    return this.call('POST', '/video/img/generate', body, { traceId: opts.traceId });
  }

  /** 首尾帧过渡 */
  transition(opts = {}) {
    const body = strip({
      first_frame_img_id: opts.first_frame_img_id ?? opts.firstImgId,
      last_frame_img_id: opts.last_frame_img_id ?? opts.lastImgId,
      prompt: opts.prompt ?? '',
      model: opts.model ?? 'v5.5',
      duration: opts.duration ?? 5,
      quality: opts.quality ?? '540p',
      aspect_ratio: opts.aspect_ratio ?? opts.aspectRatio ?? '16:9',
      motion_mode: opts.motion_mode ?? opts.motionMode ?? 'normal',
      negative_prompt: opts.negative_prompt ?? opts.negativePrompt,
    });
    if (body.first_frame_img_id == null || body.last_frame_img_id == null) {
      throw new Error('transition 需要 first_frame_img_id 与 last_frame_img_id');
    }
    return this.call('POST', '/video/transition/generate', body, { traceId: opts.traceId });
  }

  /** 续写已有视频 */
  extend(opts = {}) {
    const body = strip({
      video_id: opts.video_id ?? opts.videoId,
      prompt: opts.prompt ?? '',
      model: opts.model ?? 'v5.5',
      duration: opts.duration ?? 5,
      quality: opts.quality ?? '540p',
    });
    if (body.video_id == null) throw new Error('extend 需要 video_id');
    return this.call('POST', '/video/extend/generate', body, { traceId: opts.traceId });
  }

  getVideo(id) { return this.call('GET', `/video/result/${id}`); }
  getBalance() { return this.call('GET', '/account/balance'); }

  async poll(videoId, { onProgress, pollMs = POLL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, pollMs));
      const r = await this.getVideo(videoId);
      const st = r.status;
      const label = VIDEO_STATUS[st] ?? `status_${st}`;
      onProgress?.(label, st, r);
      if (st === 1) return r;
      if (st === 6 || st === 7 || st === 8) {
        throw new Error(`生成失败：${label}（status=${st}）${r.ErrMsg ? ' — ' + r.ErrMsg : ''}`);
      }
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

  /** 一条龙：提交 → 轮询 → （可选）下载 */
  async run(kind, opts = {}) {
    let submit;
    if (kind === 'text') submit = await this.textToVideo(opts);
    else if (kind === 'image') submit = await this.imageToVideo(opts);
    else if (kind === 'transition') submit = await this.transition(opts);
    else if (kind === 'extend') submit = await this.extend(opts);
    else throw new Error(`run 不支持 kind="${kind}"`);
    const videoId = submit.video_id ?? submit.VideoId ?? submit.id;
    if (!videoId) throw new Error(`提交成功但未返回 video_id：${JSON.stringify(submit)}`);
    const result = await this.poll(videoId, { onProgress: opts.onProgress });
    const url = result.url ?? result.video_url;
    if (opts.out && url) await this.download(url, opts.out);
    return { videoId, result, saved: opts.out && url ? opts.out : null };
  }
}

const strip = o => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== ''));

const COMMANDS = `
命令（--后参数 --key value，value 自动尝试 JSON 解析）：
  balance                                         查询 API 积分余额
  upload    --file <本地图片>                      上传 → img_id
  text      --prompt "黄昏小巷"                     文本生成视频
            [--model v5.5|v6] [--duration 5|8] [--quality 360p|540p|720p|1080p]
            [--aspect 16:9|9:16|1:1] [--motion normal|fast] [--negative "blur"]
  image     --file <图> 或 --img-id <整数>          图生视频（--file 会先 upload）
            [--prompt "..."] [同上参数]
  transition --first <首帧图> --last <尾帧图>       首尾帧过渡
            [--prompt "..."] [同上参数]
  status    --id <video_id>                       查生成状态
  extend    --id <video_id> [--prompt "..."]      续写视频
  call      --method POST --path /video/... --body '{"…"}'   逃生舱
  serve     [--port 8789]                         本地 HTTP + video.html 控制台

通用：--wait 轮询到完成；--out <路径.mp4> 下载；--dry 只打印不调用
测试建议：540p + 5s，单次约 30–80 积分（以 Billing 页为准）

例：node tools/pixverse.mjs text --prompt "雨夜霓虹小巷" --wait --out prototype/assets/videos/alley.mp4
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

function videoOpts(opts) {
  return {
    prompt: opts.prompt,
    model: opts.model,
    duration: opts.duration ? Number(opts.duration) : undefined,
    quality: opts.quality,
    aspect_ratio: opts.aspect ?? opts['aspect-ratio'],
    motion_mode: opts.motion,
    negative_prompt: opts.negative,
    seed: opts.seed ? Number(opts.seed) : undefined,
    template_id: opts.template ?? opts['template-id'],
    traceId: opts.trace,
  };
}

async function cli() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || cmd === '-h') { console.log(COMMANDS); return; }

  if (cmd === 'serve') {
    const { serve } = await import('./pixverse.serve.mjs');
    return serve(opts.port ?? 8789);
  }

  const dry = !!opts.dry;
  const client = dry ? null : new PixVerseClient();
  const show = (label, data) => console.log(label, JSON.stringify(data, null, 2));

  switch (cmd) {
    case 'balance': {
      if (dry) return show('[dry] GET /account/balance', {});
      const b = await client.getBalance();
      const monthly = b.credit_monthly ?? 0, pack = b.credit_package ?? 0;
      show('balance:', { ...b, total_api_credits: monthly + pack,
        note: 'API 积分与 PixVerse 网页会员积分分开；total=0 需在 platform.pixverse.ai/billing 充值' });
      break;
    }
    case 'upload': {
      if (dry) return show('[dry] POST /image/upload', { file: opts.file });
      show('upload:', await client.uploadImage(opts.file));
      break;
    }
    case 'text': {
      const body = videoOpts(opts);
      if (dry) return show('[dry] POST /video/text/generate', body);
      if (opts.wait || opts.out) {
        const r = await client.run('text', {
          ...body,
          out: opts.out,
          onProgress: (s) => process.stdout.write(`\r  ${s}   `),
        });
        console.log(`\n✓ video_id=${r.videoId}${r.saved ? ' → ' + r.saved : ''}`);
        if (!r.saved && r.result?.url) console.log('  url:', r.result.url);
      } else {
        show('submit:', await client.textToVideo(body));
      }
      break;
    }
    case 'image': {
      let imgId = opts['img-id'] ?? opts.imgId;
      if (opts.file) {
        if (dry) return show('[dry] upload + img/generate', { file: opts.file, ...videoOpts(opts) });
        const up = await client.uploadImage(opts.file);
        imgId = up.img_id ?? up.ImgId ?? up.id;
        console.log('upload img_id:', imgId);
      }
      const body = { ...videoOpts(opts), img_id: imgId };
      if (dry) return show('[dry] POST /video/img/generate', body);
      if (opts.wait || opts.out) {
        const r = await client.run('image', {
          ...body,
          out: opts.out,
          onProgress: (s) => process.stdout.write(`\r  ${s}   `),
        });
        console.log(`\n✓ video_id=${r.videoId}${r.saved ? ' → ' + r.saved : ''}`);
      } else {
        show('submit:', await client.imageToVideo(body));
      }
      break;
    }
    case 'transition': {
      if (dry) return show('[dry] transition', { first: opts.first, last: opts.last });
      const up1 = await client.uploadImage(opts.first);
      const up2 = await client.uploadImage(opts.last);
      const body = {
        ...videoOpts(opts),
        first_frame_img_id: up1.img_id ?? up1.ImgId,
        last_frame_img_id: up2.img_id ?? up2.ImgId,
      };
      console.log('img_ids:', body.first_frame_img_id, body.last_frame_img_id);
      if (opts.wait || opts.out) {
        const r = await client.run('transition', {
          ...body,
          out: opts.out,
          onProgress: (s) => process.stdout.write(`\r  ${s}   `),
        });
        console.log(`\n✓ video_id=${r.videoId}${r.saved ? ' → ' + r.saved : ''}`);
      } else {
        show('submit:', await client.transition(body));
      }
      break;
    }
    case 'status':
      if (dry) return show('[dry] GET /video/result', { id: opts.id });
      show('video:', await client.getVideo(opts.id));
      break;
    case 'extend': {
      const body = { ...videoOpts(opts), video_id: opts.id };
      if (dry) return show('[dry] POST /video/extend/generate', body);
      if (opts.wait || opts.out) {
        const r = await client.run('extend', { ...body, out: opts.out, onProgress: (s) => process.stdout.write(`\r  ${s}   `) });
        console.log(`\n✓ video_id=${r.videoId}${r.saved ? ' → ' + r.saved : ''}`);
      } else {
        show('submit:', await client.extend(body));
      }
      break;
    }
    case 'call':
      if (dry) return show('[dry] call', opts);
      show('result:', await client.call(opts.method ?? 'POST', opts.path, opts.body));
      break;
    default:
      console.error(`未知命令 "${cmd}"\n${COMMANDS}`);
  }
}

if (import.meta.main && !process.env.SCRAPCLAW_LIB_MODE) {
  cli().catch(e => { console.error(e.message ?? e); process.exit(1); });
}
