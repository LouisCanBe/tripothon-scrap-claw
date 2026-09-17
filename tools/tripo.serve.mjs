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
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripoClient } from './tripo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN_DIR = path.join(ROOT, 'prototype', 'assets', 'generated');

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

export function serve(port = 8787) {
  let client;
  try { client = new TripoClient(); }
  catch (e) { console.error(e.message); process.exit(1); }

  http.createServer(async (req, res) => {
    // CORS 预检
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
      if (u.pathname === '/api/health')  return json(res, 200, { ok: true });
      if (u.pathname === '/api/balance') return json(res, 200, await client.getBalance());

      let m;
      if ((m = u.pathname.match(/^\/api\/task\/([\w-]+)$/))) {
        return json(res, 200, await client.getTask(m[1]));
      }
      if ((m = u.pathname.match(/^\/api\/gen\/(\w+)$/)) && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        return json(res, 200, { task_id: await client.submit(m[1], body) });
      }
      if (u.pathname === '/api/call' && req.method === 'POST') {
        const { method = 'POST', path: p, body } = JSON.parse((await readBody(req)).toString());
        return json(res, 200, await client.call(method, p, body));
      }
      if (u.pathname === '/api/upload' && req.method === 'POST') {
        const name = path.basename(u.searchParams.get('filename') ?? 'upload.bin');
        const tmp = path.join(GEN_DIR, '.tmp-' + name);
        fs.mkdirSync(GEN_DIR, { recursive: true });
        fs.writeFileSync(tmp, await readBody(req));
        try { return json(res, 200, { file_token: await client.uploadFile(tmp) }); }
        finally { fs.rmSync(tmp, { force: true }); }
      }
      if (u.pathname === '/api/download' && req.method === 'POST') {
        const { url, name } = JSON.parse((await readBody(req)).toString());
        const safe = path.basename(name ?? 'model.glb');   // 防路径穿越
        const dest = path.join(GEN_DIR, safe);
        await client.download(url, dest);
        return json(res, 200, { saved: path.relative(ROOT, dest) });
      }
      json(res, 404, { error: 'not found', hint: 'GET /api/health 看服务是否正常' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => console.log(`Tripo 转发层 → http://localhost:${port}/api/（Ctrl+C 停止）`));
}
