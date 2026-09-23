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
import { sendFile, json, readBody, corsPreflight } from './http-util.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_DIR = path.join(ROOT, 'prototype', 'assets', 'worlds');

/** @returns {Promise<'handled'|'skip'>} */
export async function handleMarbleApi(req, res, u, client) {
  if (req.method === 'GET' && u.pathname === '/api/marble/files') {
    const files = fs.existsSync(WORLD_DIR) ? fs.readdirSync(WORLD_DIR).filter(f => !f.startsWith('.')) : [];
    json(res, 200, { files });
    return 'handled';
  }
  if (u.pathname === '/api/marble/health') { json(res, 200, { ok: true, service: 'marble' }); return 'handled'; }
  if (u.pathname === '/api/marble/credits') { json(res, 200, await client.getCredits()); return 'handled'; }

  if (u.pathname === '/api/marble/upload' && req.method === 'POST') {
    const name = path.basename(u.searchParams.get('filename') ?? 'upload.png').slice(0, 64);
    const kind = u.searchParams.get('kind') === 'video' ? 'video' : 'image';
    const tmp = path.join(WORLD_DIR, '.tmp-' + name);
    fs.mkdirSync(WORLD_DIR, { recursive: true });
    fs.writeFileSync(tmp, await readBody(req));
    try {
      const media_asset_id = await client.uploadMedia(tmp, kind);
      json(res, 200, { media_asset_id });
    } finally { fs.rmSync(tmp, { force: true }); }
    return 'handled';
  }

  if (u.pathname === '/api/marble/gen' && req.method === 'POST') {
    const { text, imageUrl, panoUrl, videoUrl, mediaAssetId, kind, isPano, ...opts } = JSON.parse((await readBody(req)).toString() || '{}');
    json(res, 200, await client.generate({ text, imageUrl, panoUrl, videoUrl, mediaAssetId, kind, isPano }, opts));
    return 'handled';
  }

  let m;
  if ((m = u.pathname.match(/^\/api\/marble\/operation\/([^/]+)$/))) {
    json(res, 200, await client.getOperation(decodeURIComponent(m[1])));
    return 'handled';
  }
  if ((m = u.pathname.match(/^\/api\/marble\/world\/([^/]+)$/))) {
    json(res, 200, await client.getWorld(decodeURIComponent(m[1])));
    return 'handled';
  }
  if ((m = u.pathname.match(/^\/api\/marble\/export\/([\w-]+)$/)) && req.method === 'POST') {
    const { asset_type = 'mesh', format = 'glb' } = JSON.parse((await readBody(req)).toString() || '{}');
    json(res, 200, await client.exportWorld(m[1], asset_type, format));
    return 'handled';
  }
  if (u.pathname === '/api/marble/save' && req.method === 'POST') {
    const { worldId, name } = JSON.parse((await readBody(req)).toString() || '{}');
    const world = await client.getWorld(worldId);
    const slug = String(name || worldId).replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'world';
    const saved = {};
    for (const [prefer, tag, ext] of [['pano', 'pano', '.png'], ['mesh', 'collider', '.glb'], ['spz', '100k', '.spz']]) {
      const url = client.assetURL(world, prefer);
      if (!url) continue;
      const filename = `${slug}-${tag}${ext}`;
      await client.download(url, path.join(WORLD_DIR, filename));
      saved[prefer] = filename;
    }
    json(res, 200, { worldId, saved, caption: world.assets?.caption ?? world.caption ?? null });
    return 'handled';
  }
  if (u.pathname === '/api/marble/download' && req.method === 'POST') {
    const { url, name } = JSON.parse((await readBody(req)).toString());
    const safe = path.basename(name ?? 'world.glb');
    const dest = path.join(WORLD_DIR, safe);
    await client.download(url, dest);
    json(res, 200, { saved: safe });
    return 'handled';
  }
  return 'skip';
}

export function handleMarbleStatic(req, res, u) {
  if (req.method !== 'GET') return false;
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return sendFile(res, path.join(ROOT, 'tools'), 'world.html');
  }
  if (u.pathname.startsWith('/vendor/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'vendor'), decodeURIComponent(u.pathname.slice(8)));
  }
  if (u.pathname.startsWith('/worlds/')) {
    return sendFile(res, WORLD_DIR, decodeURIComponent(u.pathname.slice(8)));
  }
  if (u.pathname === '/console-theme.css') {
    return sendFile(res, path.join(ROOT, 'tools'), 'console-theme.css');
  }
  return false;
}

export async function serve(port = 8788) {
  const { bootstrapNetworkEnv } = await import('./env-bootstrap.mjs');
  await bootstrapNetworkEnv();
  let client;
  try { client = new MarbleClient(); }
  catch (e) { console.error(e.message); process.exit(1); }

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return corsPreflight(res);
    const u = new URL(req.url, 'http://x');
    try {
      if (handleMarbleStatic(req, res, u)) return;
      if (await handleMarbleApi(req, res, u, client) === 'handled') return;
      json(res, 404, { error: 'not found', hint: 'GET /api/marble/health 看服务是否正常' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => console.log(`Marble 转发层 → http://localhost:${port}/api/marble/（Ctrl+C 停止）`));
}
