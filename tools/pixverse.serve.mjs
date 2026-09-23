// ============================================================
// pixverse.mjs 的 serve 模式：本地 HTTP 转发层
// UI → http://localhost:8789/api/pixverse/* → PixVerse API
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PixVerseClient } from './pixverse.mjs';
import { sendFile, json, readBody, corsPreflight } from './http-util.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VIDEO_DIR = path.join(ROOT, 'prototype', 'assets', 'videos');

/** @returns {Promise<'handled'|'skip'>} */
export async function handlePixverseApi(req, res, u, client) {
  if (req.method === 'GET' && u.pathname === '/api/pixverse/files') {
    const files = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter(f => !f.startsWith('.')) : [];
    json(res, 200, { files });
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/health') { json(res, 200, { ok: true, service: 'pixverse' }); return 'handled'; }
  if (u.pathname === '/api/pixverse/balance') { json(res, 200, await client.getBalance()); return 'handled'; }

  if (u.pathname === '/api/pixverse/upload' && req.method === 'POST') {
    const name = path.basename(u.searchParams.get('filename') ?? 'upload.png');
    const tmp = path.join(VIDEO_DIR, '.tmp-' + name);
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    fs.writeFileSync(tmp, await readBody(req));
    try { json(res, 200, await client.uploadImage(tmp)); }
    finally { fs.rmSync(tmp, { force: true }); }
    return 'handled';
  }

  if (u.pathname === '/api/pixverse/text' && req.method === 'POST') {
    json(res, 200, await client.textToVideo(await readBody(req).then(b => JSON.parse(b.toString() || '{}'))));
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/image' && req.method === 'POST') {
    json(res, 200, await client.imageToVideo(await readBody(req).then(b => JSON.parse(b.toString() || '{}'))));
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/transition' && req.method === 'POST') {
    json(res, 200, await client.transition(await readBody(req).then(b => JSON.parse(b.toString() || '{}'))));
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/extend' && req.method === 'POST') {
    json(res, 200, await client.extend(await readBody(req).then(b => JSON.parse(b.toString() || '{}'))));
    return 'handled';
  }

  let m;
  if ((m = u.pathname.match(/^\/api\/pixverse\/video\/(\d+)$/))) {
    json(res, 200, await client.getVideo(m[1]));
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/call' && req.method === 'POST') {
    const { method = 'POST', path: p, body } = JSON.parse((await readBody(req)).toString());
    json(res, 200, await client.call(method, p, body));
    return 'handled';
  }
  if (u.pathname === '/api/pixverse/download' && req.method === 'POST') {
    const { url, name } = JSON.parse((await readBody(req)).toString());
    const safe = path.basename(name ?? 'video.mp4');
    const dest = path.join(VIDEO_DIR, safe);
    await client.download(url, dest);
    json(res, 200, { saved: safe });
    return 'handled';
  }
  return 'skip';
}

export function handlePixverseStatic(req, res, u) {
  if (req.method !== 'GET') return false;
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return sendFile(res, path.join(ROOT, 'tools'), 'video.html');
  }
  if (u.pathname.startsWith('/videos/')) {
    return sendFile(res, VIDEO_DIR, decodeURIComponent(u.pathname.slice(8)));
  }
  if (u.pathname === '/console-theme.css') {
    return sendFile(res, path.join(ROOT, 'tools'), 'console-theme.css');
  }
  return false;
}

export async function serve(port = 8789) {
  const { bootstrapNetworkEnv } = await import('./env-bootstrap.mjs');
  await bootstrapNetworkEnv();
  let client;
  try { client = new PixVerseClient(); }
  catch (e) { console.error(e.message); process.exit(1); }

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return corsPreflight(res);
    const u = new URL(req.url, 'http://x');
    try {
      if (handlePixverseStatic(req, res, u)) return;
      if (await handlePixverseApi(req, res, u, client) === 'handled') return;
      json(res, 404, { error: 'not found', hint: 'GET /api/pixverse/health' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    console.log(`PixVerse 转发层 → http://localhost:${port}/ （控制台 + /api/pixverse/*）`);
  });
}
