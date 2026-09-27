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
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCollectApi } from './collectDisplayHub.mjs';
import { DEFAULT_COLLECT_PAIR } from '../prototype/src/collectPairDefault.js';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(TOOLS, '../prototype');

function parseArgs(argv) {
  let port = 8000;
  let host = '127.0.0.1';
  for (const a of argv) {
    if (a === '--lan' || a === '--bind-all') host = '0.0.0.0';
    else if (a.startsWith('--host=')) host = a.slice('--host='.length) || host;
    else if (/^\d+$/.test(a)) port = +a;
  }
  return { port, host };
}

const { port: PORT, host: HOST } = parseArgs(process.argv.slice(2));

function ipv4Lan() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',   // 关键：禁一切缓存（含 ES module 启发式缓存）
    });
    createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(e?.message ?? e));
  }
}).listen(PORT, HOST, () => {
  const pair = DEFAULT_COLLECT_PAIR;
  console.log(`[dev] http://127.0.0.1:${PORT}/  (no-store, prototype/)`);
  if (HOST === '0.0.0.0') {
    for (const ip of ipv4Lan()) console.log(`[dev] http://${ip}:${PORT}/  (LAN)`);
    console.log('[dev] 若连不上：检查 Windows 防火墙是否放行 Node 专用网络');
  } else {
    console.log('[dev] 内网访问：加参数 --lan');
  }
  const q = encodeURIComponent(pair);
  console.log(`[collect] 默认配对口令 pair=${pair}（config.collectDisplay.pairId；书签可无参，多展台改 ?pair=）`);
  console.log(`  主游戏  http://127.0.0.1:${PORT}/`);
  console.log(`  副屏    http://127.0.0.1:${PORT}/display.html`);
  console.log(`  含参示例 http://127.0.0.1:${PORT}/?pair=${q}`);
  console.log(`          http://127.0.0.1:${PORT}/display.html?pair=${q}`);
  if (HOST === '0.0.0.0') {
    for (const ip of ipv4Lan()) {
      console.log(`  主游戏  http://${ip}:${PORT}/`);
      console.log(`  副屏    http://${ip}:${PORT}/display.html`);
      console.log(`  含参示例 http://${ip}:${PORT}/?pair=${q}`);
      console.log(`          http://${ip}:${PORT}/display.html?pair=${q}`);
    }
  }
  console.log(`[collect] 日志：[collect][pair=${pair}] …`);
});
