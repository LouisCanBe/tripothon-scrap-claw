#!/usr/bin/env node
// ============================================================
// 开发服务器：静态服务 prototype/，所有响应 no-store
// 解决 python http.server 的启发式缓存咬住 ES module 的问题
// —— 改任何 .js 后普通刷新即生效，不用 Ctrl+F5。
//
// 用法：
//   node tools/devServer.mjs [端口=8000]           仅本机 127.0.0.1
//   node tools/devServer.mjs 8000 --lan          0.0.0.0，内网其它设备可访问
//   node tools/devServer.mjs --host=0.0.0.0
// ============================================================
import http from 'node:http';
import os from 'node:os';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCollectApi } from './collectDisplayHub.mjs';
import { DEFAULT_COLLECT_PAIR } from '../prototype/src/collectPairDefault.js';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(TOOLS, '../prototype');

let handleFrameUpgrade = (_req, socket) => { socket.destroy(); };
const frameStreamPath = path.join(TOOLS, 'frameStream.mjs');
if (existsSync(frameStreamPath)) {
  const mod = await import('./frameStream.mjs');
  handleFrameUpgrade = mod.handleFrameUpgrade;
}

function parseArgs(argv) {
  let port = 8000;
  let host = '127.0.0.1';
  let gui = false;
  for (const a of argv) {
    if (a === '--lan' || a === '--bind-all') host = '0.0.0.0';
    else if (a === '--gui' || a === '--dev') gui = true;
    else if (a.startsWith('--host=')) host = a.slice('--host='.length) || host;
    else if (/^\d+$/.test(a)) port = +a;
  }
  return { port, host, gui };
}

let { port: PORT, host: HOST, gui: OPEN_GUI } = parseArgs(process.argv.slice(2));
// PaaS（Render / Railway 等）注入 PORT，并需监听 0.0.0.0
if (process.env.PORT && /^\d+$/.test(process.env.PORT)) {
  PORT = +process.env.PORT;
  if (!process.argv.includes('--lan') && !process.argv.some((a) => a.startsWith('--host='))) {
    HOST = '0.0.0.0';
  }
}

function ipv4Lan() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

// Render 会注入 PORT。只有线上才给大资源长缓存，本地开发仍 no-store，换模型刷新即见。
const LONG_CACHE = Boolean(process.env.PORT);
const LONG_CACHE_EXT = new Set([
  '.glb', '.gltf', '.obj', '.spz',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp3', '.ogg', '.wav',
  '.woff2', '.woff',
]);

// ============================================================
// A2 压缩 / A3 缓存 —— 见 PERF-性能优化.md
//
// A2：文本类（js/mjs/css/html/json/svg/gltf/map）按 Accept-Encoding 出 br 优先、gzip 兜底。
//     只对 ≤4MB 的文件做，结果按 mtime 缓存进内存 —— 免费实例 CPU 弱，
//     不能每个请求都重压一遍 three.module.js。GLB/SPZ/图/音不在列，原样直出。
//
// A3：本地（无 PORT）保持 no-store，行为与以前完全一致 —— 改完 .js 刷新即生效。
//     生产（Render 注入 PORT → LONG_CACHE）：
//       .js/.mjs/.css/.html/.json 从 no-store 改成 no-cache + ETag
//         —— 「存，但每次校验」。文件一改 mtime 变 → ETag 变 → 200 拿新的，
//            所以开发新鲜度不丢；没变则回 304（一两百字节），不再整包重下 1.28MB。
//       带 ?v=<真实版本号>（build-deploy.mjs 注入 git hash）→ immutable 强缓存。
//
//       ⚠️ __ASSET_V__ 陷阱：Render 走 git 部署，**不跑 build-deploy.mjs**，
//       仓库里 index.html 的 ?v=__ASSET_V__ 会原样上线。若认这个占位符，
//       three.module.js / main.js 就被打上 immutable 一年缓存 ——
//       以后改 JS，老访客浏览器永远用旧代码，只能手动清缓存才更新。
//       所以显式把「占位符 / 空值」当没有版本号，退回 no-cache + ETag。
// ============================================================
const VERSION_PLACEHOLDERS = new Set(['__ASSET_V__', '__DEPLOY_V__', '__VERSION__', 'undefined', 'null', '']);
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json']);
const COMPRESSIBLE_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.gltf', '.txt', '.webmanifest',
]);
const COMPRESS_MIN_BYTES = 1024;              // 太小压了反而亏
const COMPRESS_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const _compressCache = new Map();             // `${file}|${mtimeMs}|${enc}` → Buffer

/** br 优先，其次 gzip；客户端都不要就返回 null（直出）。 */
function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (ae.includes('br')) return 'br';
  if (ae.includes('gzip')) return 'gzip';
  return null;
}

function compressBytes(buf, enc) {
  return enc === 'br'
    ? brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) // 5 而非 11：免费实例 CPU 友好
    : gzipSync(buf, { level: 6 });
}

/** 弱 ETag：同文件 + 同编码 + 同 mtime 才算命中。编码不同 ETag 也不同（RFC 要求）。 */
function weakETag(file, stat, enc) {
  const h = createHash('sha1')
    .update(`${stat.size}:${stat.mtimeMs}:${enc || 'identity'}:${path.basename(file)}`)
    .digest('base64url')
    .slice(0, 20);
  return `W/"${h}"`;
}

function cachedCompressed(file, stat, enc) {
  const key = `${file}|${stat.mtimeMs}|${enc}`;
  let buf = _compressCache.get(key);
  if (buf) return buf;
  try {
    buf = compressBytes(readFileSync(file), enc);
  } catch {
    return null;                              // 压缩失败就退回直出，不挡请求
  }
  _compressCache.set(key, buf);
  if (_compressCache.size > 400) _compressCache.delete(_compressCache.keys().next().value);
  return buf;
}

/** 该文件的 Cache-Control。immutable > revalidate(no-cache) > no-store。 */
function cachePolicyFor(ext, url) {
  if (!LONG_CACHE) return 'no-store';
  if (LONG_CACHE_EXT.has(ext)) return 'public, max-age=31536000, immutable';
  // 只有「真实版本号」才给 immutable；占位符/空值退回 no-cache + ETag
  const ver = url.searchParams.get('v');
  if (ver != null && !VERSION_PLACEHOLDERS.has(ver.trim())) {
    return 'public, max-age=31536000, immutable';
  }
  if (TEXT_EXT.has(ext)) return 'no-cache';    // 存，但每次带 If-None-Match 校验
  return 'no-store';
}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end('{"ok":true}');
    }
    if (await handleCollectApi(req, res, url)) return;

    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    if (p === '/comic-render.mjs') {
      const comic = path.join(TOOLS, 'comic-render.mjs');
      if (existsSync(comic)) {
        res.writeHead(200, { 'Content-Type': MIME['.mjs'], 'Cache-Control': 'no-store' });
        return createReadStream(comic).pipe(res);
      }
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    const ext = path.extname(file).toLowerCase();
    const stat = statSync(file);
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const cache = cachePolicyFor(ext, url);

    // —— A2/A3：先定一套头（HEAD 与 GET 共用同一套，行为才一致）——
    const enc = pickEncoding(req);
    const canCompress = enc && COMPRESSIBLE_EXT.has(ext) && stat.size >= COMPRESS_MIN_BYTES;
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cache,
      // 同一 URL 按 Accept-Encoding 出不同编码，必须告诉缓存
      Vary: 'Accept-Encoding',
    };
    let status = 200;
    let body = null;   // HEAD 不取 body，省一次压缩

    if (canCompress && stat.size <= COMPRESS_CACHE_MAX_BYTES) {
      const etag = weakETag(file, stat, enc);
      headers['Content-Encoding'] = enc;
      headers.ETag = etag;
      if (req.headers['if-none-match'] === etag) status = 304;
      else if (req.method !== 'HEAD') body = cachedCompressed(file, stat, enc);
    } else if (LONG_CACHE && (TEXT_EXT.has(ext) || LONG_CACHE_EXT.has(ext))) {
      const etag = weakETag(file, stat, null);
      headers.ETag = etag;
      if (req.headers['if-none-match'] === etag) status = 304;
    }

    if (status === 304) {
      res.writeHead(304, headers);
      return res.end();
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    if (body) {
      res.writeHead(200, headers);
      return res.end(body);
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(e?.message ?? e));
  }
});
server.on('upgrade', (req, socket) => {
  handleFrameUpgrade(req, socket);
});
server.listen(PORT, HOST, () => {
  const pair = DEFAULT_COLLECT_PAIR;
  console.log(`[dev] http://127.0.0.1:${PORT}/  (no-store, prototype/)`);
  if (HOST === '0.0.0.0') {
    for (const ip of ipv4Lan()) console.log(`[dev] http://${ip}:${PORT}/  (LAN)`);
    console.log('[dev] 若连不上：检查 Windows 防火墙是否放行 Node 专用网络');
  } else {
    console.log('[dev] 内网访问：加参数 --lan');
  }
  const q = encodeURIComponent(pair);
  const game = OPEN_GUI ? `http://127.0.0.1:${PORT}/?gui=1` : `http://127.0.0.1:${PORT}/`;
  console.log(`[collect] 默认配对口令 pair=${pair}（config.collectDisplay.pairId；书签可无参，多展台改 ?pair=）`);
  console.log(`  健康检查 http://127.0.0.1:${PORT}/health`);
  console.log(`  主游戏  ${game}`);
  console.log(`  调参    http://127.0.0.1:${PORT}/?gui=1  (npm run game:dev / ?gui=1；此时 H 切换)`);
  console.log(`  副屏    http://127.0.0.1:${PORT}/display.html`);
  console.log(`  相框    http://127.0.0.1:${PORT}/display-frame.html`);
  console.log(`  相框放映 http://127.0.0.1:${PORT}/display-frame-play.html`);
  console.log(`  电脑出图 http://127.0.0.1:${PORT}/display-frame.html?relay=host`);
  console.log(`  校准    http://127.0.0.1:${PORT}/frame-calibrate.html`);
  console.log(`  含参示例 http://127.0.0.1:${PORT}/?pair=${q}`);
  console.log(`          http://127.0.0.1:${PORT}/display.html?pair=${q}`);
  if (HOST === '0.0.0.0') {
    for (const ip of ipv4Lan()) {
      console.log(`  主游戏  http://${ip}:${PORT}/${OPEN_GUI ? '?gui=1' : ''}`);
      console.log(`  调参    http://${ip}:${PORT}/?gui=1`);
      console.log(`  副屏    http://${ip}:${PORT}/display.html`);
      console.log(`  相框    http://${ip}:${PORT}/display-frame.html`);
      console.log(`  相框放映 http://${ip}:${PORT}/display-frame-play.html`);
      console.log(`  电脑出图 http://${ip}:${PORT}/display-frame.html?relay=host`);
      console.log(`  校准    http://${ip}:${PORT}/frame-calibrate.html`);
      console.log(`  含参示例 http://${ip}:${PORT}/?pair=${q}`);
      console.log(`          http://${ip}:${PORT}/display.html?pair=${q}`);
    }
  }
  console.log(`[collect] 日志：[collect][pair=${pair}] …`);
});
