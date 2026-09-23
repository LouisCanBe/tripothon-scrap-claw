// ============================================================
// tripo.mjs 的 serve 模式：本地 HTTP 转发层（零依赖，node:http）
// 给浏览器可视化界面用：UI → http://localhost:8787/api/* → Tripo API
// 绕开 CORS，TRIPO_API_KEY 只留在本机，不进前端代码。
//
// 端点：
//   GET  /api/health                     探活
//   GET  /api/balance                    余额
//   GET  /api/task/:id                   任务状态（前端轮询用）
//   POST /api/gen/:name                  提交生成任务，body 原样透传 → { task_id }
//                                        :name 用 PATHS 表名（textToModel / imageToModel / …）
//   POST /api/call                       { method, path, body } 逃生舱，任意接口
//   POST /api/upload?filename=a.png      二进制 body 上传 → { file_token }
//   POST /api/download                   { url, name } 下载到 prototype/assets/generated/<name>
//
// 静态服务（配套可视化页面 tools/ui.html）：
//   GET /          → tools/ui.html
//   GET /vendor/*  → prototype/vendor/*（three.js，预览器用）
//   GET /files/*   → prototype/assets/generated/*（已下载的 GLB，预览用）
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripoClient } from './tripo.mjs';
import { sendFile, json, readBody, corsPreflight } from './http-util.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GEN_DIR = path.join(ROOT, 'prototype', 'assets', 'generated');

/** @returns {Promise<'handled'|'skip'>} */
export async function handleTripoApi(req, res, u, client) {
  if (u.pathname === '/api/health') { json(res, 200, { ok: true, service: 'tripo' }); return 'handled'; }
  if (u.pathname === '/api/balance') { json(res, 200, await client.getBalance()); return 'handled'; }

  let m;
  if ((m = u.pathname.match(/^\/api\/task\/([\w-]+)$/))) {
    json(res, 200, await client.getTask(m[1]));
    return 'handled';
  }
  if ((m = u.pathname.match(/^\/api\/gen\/(\w+)$/)) && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    json(res, 200, { task_id: await client.submit(m[1], body) });
    return 'handled';
  }
  if (u.pathname === '/api/call' && req.method === 'POST') {
    const { method = 'POST', path: p, body } = JSON.parse((await readBody(req)).toString());
    json(res, 200, await client.call(method, p, body));
    return 'handled';
  }
  if (u.pathname === '/api/upload' && req.method === 'POST') {
    const name = path.basename(u.searchParams.get('filename') ?? 'upload.bin');
    const tmp = path.join(GEN_DIR, '.tmp-' + name);
    fs.mkdirSync(GEN_DIR, { recursive: true });
    fs.writeFileSync(tmp, await readBody(req));
    try { json(res, 200, { file_token: await client.uploadFile(tmp) }); }
    finally { fs.rmSync(tmp, { force: true }); }
    return 'handled';
  }
  if (u.pathname === '/api/download' && req.method === 'POST') {
    const { url, name } = JSON.parse((await readBody(req)).toString());
    const safe = path.basename(name ?? 'model.glb');
    const dest = path.join(GEN_DIR, safe);
    await client.download(url, dest);
    json(res, 200, { saved: safe });
    return 'handled';
  }
  return 'skip';
}

export function handleTripoStatic(req, res, u) {
  if (req.method !== 'GET') return false;
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return sendFile(res, path.join(ROOT, 'tools'), 'ui.html');
  }
  if (u.pathname.startsWith('/vendor/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'vendor'), decodeURIComponent(u.pathname.slice(8)));
  }
  if (u.pathname.startsWith('/files/')) {
    return sendFile(res, GEN_DIR, decodeURIComponent(u.pathname.slice(7)));
  }
  if (u.pathname === '/console-theme.css') {
    return sendFile(res, path.join(ROOT, 'tools'), 'console-theme.css');
  }
  return false;
}

export function serve(port = 8787) {
  let client;
  try { client = new TripoClient(); }
  catch (e) { console.error(e.message); process.exit(1); }

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return corsPreflight(res);
    const u = new URL(req.url, 'http://x');
    try {
      if (handleTripoStatic(req, res, u)) return;
      if (await handleTripoApi(req, res, u, client) === 'handled') return;
      json(res, 404, { error: 'not found', hint: 'GET /api/health 看服务是否正常' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => console.log(`Tripo 转发层 → http://localhost:${port}/api/（Ctrl+C 停止）`));
}
