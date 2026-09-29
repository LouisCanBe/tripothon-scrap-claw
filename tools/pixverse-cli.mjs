// ============================================================
// PixVerse 官方 CLI 桥接（会员账号 / pixverse auth login）
// 与 pixverse.mjs 的 PixVerseClient 同形，供 hub.serve / pixverse.serve 复用
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pixverseSpawnArgs(cliArgs) {
  const bin = path.join(ROOT, 'node_modules', 'pixverse', 'dist', 'index.js');
  if (fs.existsSync(bin)) return [process.execPath, [bin, ...cliArgs]];
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return [npx, ['pixverse', ...cliArgs], { shell: process.platform === 'win32' }];
}

export function runPixverseCli(cliArgs, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, args, extra] = pixverseSpawnArgs(cliArgs);
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...extra,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`pixverse CLI 超时（${timeoutMs}ms）：${cliArgs.join(' ')}`));
    }, timeoutMs) : null;
    child.on('error', e => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      const out = stdout.trim();
      let json;
      try {
        json = out ? JSON.parse(out) : {};
      } catch {
        reject(new Error(
          `pixverse CLI 非 JSON 输出（code=${code}）：${out.slice(0, 300) || stderr.slice(0, 300)}`,
        ));
        return;
      }
      if (json.error && !json.video_id && !json.id && json.status_code == null) {
        reject(new Error(json.error || json.message || 'pixverse CLI 失败'));
        return;
      }
      if (code !== 0 && json.status !== 'completed' && json.status !== 'submitted') {
        reject(new Error(json.error || stderr.trim() || `pixverse 退出码 ${code}`));
        return;
      }
      resolve(json);
    });
  });
}

export async function isCliAuthenticated() {
  try {
    const j = await runPixverseCli(['auth', 'status', '--json'], { timeoutMs: 30_000 });
    return !!(j.authenticated ?? j.logged_in);
  } catch {
    return false;
  }
}

/** @returns {Promise<{ client: PixVerseCliClient, mode: 'cli' }>} */
export async function resolvePixverseClient() {
  const { PixVerseClient } = await import('./pixverse.mjs');
  const force = (process.env.PIXVERSE_HUB || 'auto').toLowerCase();
  const hasKey = !!process.env.PIXVERSE_API_KEY?.trim();
  const authed = await isCliAuthenticated();

  if (force === 'openapi') {
    return { client: new PixVerseClient(), mode: 'openapi' };
  }
  if (force === 'cli') {
    if (!authed) throw new Error('PIXVERSE_HUB=cli 但未登录，请 npm run pixverse:login');
    return { client: new PixVerseCliClient(), mode: 'cli' };
  }
  // auto：已登录会员优先（与网页积分一致）
  if (authed) return { client: new PixVerseCliClient(), mode: 'cli' };
  if (hasKey) return { client: new PixVerseClient(), mode: 'openapi' };
  throw new Error('PixVerse 未就绪：npm run pixverse:login（会员）或在 .env.local 配置 PIXVERSE_API_KEY');
}

export class PixVerseCliClient {
  constructor() {
    this.authMode = 'cli';
  }

  async getBalance() {
    const info = await runPixverseCli(['account', 'info', '--json'], { timeoutMs: 45_000 });
    const c = info.credits ?? {};
    return {
      auth_mode: 'cli',
      member_label: info.memberLabel,
      email: info.email,
      credits_total: c.total,
      credit_monthly: c.membership ?? 0,
      credit_package: (c.bonus ?? 0) + (c.daily ?? 0),
      credit_daily: c.daily,
      credit_bonus: c.bonus,
      high_quality_times: c.highQualityTimes,
      _raw: info,
    };
  }

  async uploadImage(filePath) {
    const j = await runPixverseCli(['asset', 'upload', filePath, '--json'], { timeoutMs: 120_000 });
    const imgId = j.id ?? j.image_id ?? j.asset_id;
    return { img_id: imgId, id: imgId, ...j };
  }

  _audioFlags(opts) {
    if (opts.audio === true || opts.generate_audio === true) return ['--audio'];
    if (opts.audio === false || opts.generate_audio === false) return ['--no-audio'];
    return ['--no-audio'];
  }

  _videoArgs(opts, extra = []) {
    const model = opts.model === 'v5.6' ? 'v5.6' : (opts.model ?? 'v6');
    const args = [
      '-m', model,
      '-d', String(opts.duration ?? 5),
      '-q', opts.quality ?? '540p',
      '--aspect-ratio', opts.aspect_ratio ?? opts.aspectRatio ?? '16:9',
      ...this._audioFlags(opts),
      '--no-wait',
      '--json',
      ...extra,
    ];
    const prompt = opts.prompt?.trim();
    if (prompt) args.unshift('--prompt', prompt);
    return args;
  }

  async textToVideo(opts = {}) {
    if (!opts.prompt?.trim()) throw new Error('textToVideo 需要 prompt');
    const j = await runPixverseCli(['create', 'video', ...this._videoArgs(opts)], { timeoutMs: 120_000 });
    return this._submitShape(j);
  }

  async imageToVideo(opts = {}) {
    const img = opts.img_id ?? opts.imgId;
    if (img == null) throw new Error('imageToVideo 需要 img_id');
    const j = await runPixverseCli([
      'create', 'video',
      ...this._videoArgs(opts, ['--image', String(img)]),
    ], { timeoutMs: 120_000 });
    return this._submitShape(j);
  }

  async transition(opts = {}) {
    const first = opts.first_frame_img_id ?? opts.firstImgId;
    const last = opts.last_frame_img_id ?? opts.lastImgId;
    if (first == null || last == null) {
      throw new Error('transition 需要 first_frame_img_id 与 last_frame_img_id');
    }
    const model = opts.model === 'v5.6' ? 'v5.6' : (opts.model ?? 'v6');
    const args = [
      'create', 'transition',
      '--images', String(first), String(last),
      '-m', model,
      '-d', String(opts.duration ?? 5),
      '-q', opts.quality ?? '540p',
      ...this._audioFlags(opts),
      '--no-wait',
      '--json',
    ];
    const prompt = opts.prompt?.trim();
    if (prompt) args.splice(2, 0, '--prompt', prompt);
    const j = await runPixverseCli(args, { timeoutMs: 120_000 });
    return this._submitShape(j);
  }

  async extend(opts = {}) {
    const vid = opts.video_id ?? opts.videoId;
    if (vid == null) throw new Error('extend 需要 video_id');
    const model = opts.model === 'v5.6' ? 'v5.6' : (opts.model ?? 'v6');
    const args = [
      'create', 'extend',
      '--video', String(vid),
      '-m', model,
      '-d', String(opts.duration ?? 5),
      '-q', opts.quality ?? '540p',
      ...this._audioFlags(opts),
      '--no-wait',
      '--json',
    ];
    if (opts.prompt?.trim()) args.splice(2, 0, '--prompt', opts.prompt.trim());
    const j = await runPixverseCli(args, { timeoutMs: 120_000 });
    return this._submitShape(j);
  }

  _submitShape(j) {
    const videoId = j.video_id ?? j.id ?? j.video_ids?.[0];
    if (!videoId) throw new Error(`提交成功但未返回 video_id：${JSON.stringify(j).slice(0, 200)}`);
    return { video_id: videoId, VideoId: videoId, id: videoId, _cli: j };
  }

  async getVideo(id) {
    const j = await runPixverseCli(['task', 'status', String(id), '--type', 'video', '--json'], {
      timeoutMs: 60_000,
    });
    const code = j.status_code ?? (j.status === 'completed' ? 1 : j.status === 'processing' ? 5 : 5);
    const url = j.video_url ?? j.url;
    return {
      status: code,
      url,
      video_url: url,
      _cli: j,
    };
  }

  async call() {
    throw new Error('CLI 模式不支持 OpenAPI call 逃生舱，请用 npx pixverse 或切换 PIXVERSE_HUB=openapi');
  }

  async download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }
}
