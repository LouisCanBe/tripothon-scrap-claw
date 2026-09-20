// ============================================================
// marble.mjs 的 serve 模式：本地 HTTP 转发层（零依赖，node:http）
// 与 tripo.serve.mjs 同构：UI → http://localhost:8788/api/* → World Labs API
// 绕开 CORS，MARBLE_API_KEY 只留在本机。
//
// 端点：
//   GET  /api/marble/health                      探活
//   POST /api/marble/gen                         { text|imageUrl|panoUrl|videoUrl, model?, seed? } → operation
//   GET  /api/marble/operation/:id               轮询生成进度
//   GET  /api/marble/world/:id                   世界详情（资产 URL）
//   POST /api/marble/export/:id                  { asset_type, format } 导出
//   POST /api/marble/download                    { url, name } 下载到 prototype/assets/worlds/<name>
//
// 未来整合：TOOLS.md 规划的统一 hub 会把本路由挂到 /api/marble/* 前缀下，
// 与 tripo（/api/tripo/*）共用一个端口；当前先独立端口跑着验证。
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MarbleClient } from './marble.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_DIR = path.join(ROOT, 'prototype', 'assets', 'worlds');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.spz': 'application/octet-stream', '.webp': 'image/webp' };

// 静态文件：防路径穿越（resolve 后必须还在 base 下）
function sendFile(res, base, rel) {
  const p = path.resolve(base, rel);
  if (!p.startsWith(path.resolve(base)) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
                       'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(p).pipe(res);
  return true;
}

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((ok, no) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', no);
});

export function serve(port = 8788) {
  let client;
  try { client = new MarbleClient(); }
  catch (e) { console.error(e.message); process.exit(1); }

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }
    const u = new URL(req.url, 'http://x');
    try {
      // —— 静态：预览器 + vendor + 已下载的世界资产 ——
      if (req.method === 'GET') {
        if (u.pathname === '/' || u.pathname === '/index.html') {
          if (!sendFile(res, path.join(ROOT, 'tools'), 'world.html')) json(res, 404, { error: 'world.html 不存在' });
          return;
        }
        if (u.pathname.startsWith('/vendor/')) {
          if (!sendFile(res, path.join(ROOT, 'prototype', 'vendor'), decodeURIComponent(u.pathname.slice(8)))) json(res, 404, { error: 'not found' });
          return;
        }
        if (u.pathname.startsWith('/worlds/')) {
          if (!sendFile(res, WORLD_DIR, decodeURIComponent(u.pathname.slice(8)))) json(res, 404, { error: 'not found' });
          return;
        }
        if (u.pathname === '/api/marble/files') {   // 列 worlds 目录（预览器文件列表）
          const files = fs.existsSync(WORLD_DIR) ? fs.readdirSync(WORLD_DIR).filter(f => !f.startsWith('.')) : [];
          return json(res, 200, { files });
        }
      }
      if (u.pathname === '/api/marble/health') return json(res, 200, { ok: true, service: 'marble' });

      if (u.pathname === '/api/marble/gen' && req.method === 'POST') {
        const { text, imageUrl, panoUrl, videoUrl, ...opts } = JSON.parse((await readBody(req)).toString() || '{}');
        return json(res, 200, await client.generate({ text, imageUrl, panoUrl, videoUrl }, opts));
      }

      let m;
      if ((m = u.pathname.match(/^\/api\/marble\/operation\/([\w-]+)$/))) {
        return json(res, 200, await client.getOperation(m[1]));
      }
      if ((m = u.pathname.match(/^\/api\/marble\/world\/([\w-]+)$/))) {
        return json(res, 200, await client.getWorld(m[1]));
      }
      if ((m = u.pathname.match(/^\/api\/marble\/export\/([\w-]+)$/)) && req.method === 'POST') {
        const { asset_type = 'mesh', format = 'glb' } = JSON.parse((await readBody(req)).toString() || '{}');
        return json(res, 200, await client.exportWorld(m[1], asset_type, format));
      }
      if (u.pathname === '/api/marble/download' && req.method === 'POST') {
        const { url, name } = JSON.parse((await readBody(req)).toString());
        const safe = path.basename(name ?? 'world.glb');   // 防路径穿越
        const dest = path.join(WORLD_DIR, safe);
        await client.download(url, dest);
        return json(res, 200, { saved: safe });
      }
      json(res, 404, { error: 'not found', hint: 'GET /api/marble/health 看服务是否正常' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => console.log(`Marble 转发层 → http://localhost:${port}/api/marble/（Ctrl+C 停止）`));
}
