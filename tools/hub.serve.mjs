#!/usr/bin/env node
// ============================================================
// 统一工具 Hub：单端口挂载 Tripo + Marble + PixVerse API 与控制台
//   node tools/hub.serve.mjs [--port 8780]
//   → http://localhost:8780/
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sendFile, json, corsPreflight } from './http-util.mjs';
import { loadEnvFile, hasProxyEnv } from './env-bootstrap.mjs';
import { prizeOverview } from './prize-lib.mjs';

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools');

function tryClient(Ctor) {
  try { return { client: new Ctor(), error: null }; }
  catch (e) { return { client: null, error: e.message ?? String(e) }; }
}

function hubStatic(req, res, u, dirs) {
  if (req.method !== 'GET') return false;
  const p = u.pathname;

  if (p === '/' || p === '/index.html') return sendFile(res, TOOLS, 'hub.html');
  if (p === '/console-theme.css') return sendFile(res, TOOLS, 'console-theme.css');
  if (p === '/comic-render.mjs') return sendFile(res, TOOLS, 'comic-render.mjs');
  if (p === '/prize-view.mjs') return sendFile(res, TOOLS, 'prize-view.mjs');

  const panel = {
    '/tripo': 'ui.html', '/tripo/': 'ui.html',
    '/marble': 'world.html', '/marble/': 'world.html',
    '/pixverse': 'video.html', '/pixverse/': 'video.html',
    '/prizes': 'prize.html', '/prizes/': 'prize.html',
  };
  if (panel[p]) return sendFile(res, TOOLS, panel[p]);

  if (p.startsWith('/vendor/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'vendor'), decodeURIComponent(p.slice(8)));
  }
  if (p.startsWith('/src/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'src'), decodeURIComponent(p.slice(5)));
  }
  if (p.startsWith('/src/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'src'), decodeURIComponent(p.slice(5)));
  }
  if (p.startsWith('/files/')) {
    return sendFile(res, dirs.tripoGen, decodeURIComponent(p.slice(7)));
  }
  if (p.startsWith('/worlds/')) {
    return sendFile(res, dirs.world, decodeURIComponent(p.slice(8)));
  }
  if (p.startsWith('/videos/')) {
    return sendFile(res, dirs.video, decodeURIComponent(p.slice(8)));
  }
  if (p === '/art-pairs.json') return sendFile(res, TOOLS, 'art-pairs.json');
  if (p === '/prompts-machine.json') return sendFile(res, TOOLS, 'prompts-machine.json');
  if (p === '/docs/ART') return sendFile(res, ROOT, 'ART-美术设定.md');
  if (p === '/concepts' || p === '/concepts/') {
    return sendFile(res, path.join(ROOT, 'prototype', 'design', 'concepts'), 'review.html');
  }
  if (p.startsWith('/design/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'design'), decodeURIComponent(p.slice(8)));
  }
  if (p.startsWith('/assets/')) {
    return sendFile(res, path.join(ROOT, 'prototype', 'assets'), decodeURIComponent(p.slice(8)));
  }
  return false;
}

export function serve(port = 8780, ctx) {
  const { tripo, marble, pixverse, handleTripoApi, handleMarbleApi, handlePixverseApi, dirs } = ctx;

  fs.mkdirSync(dirs.tripoGen, { recursive: true });
  fs.mkdirSync(dirs.world, { recursive: true });
  fs.mkdirSync(dirs.video, { recursive: true });

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return corsPreflight(res);
    const u = new URL(req.url, 'http://x');
    try {
      if (hubStatic(req, res, u, dirs)) return;

      if (u.pathname === '/api/prizes' && req.method === 'GET') {
        return json(res, 200, prizeOverview());
      }

      if (u.pathname === '/api/hub/status' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          services: {
            tripo: tripo.client ? { ok: true } : { ok: false, error: tripo.error },
            marble: marble.client ? { ok: true } : { ok: false, error: marble.error },
            pixverse: pixverse.client
              ? { ok: true, mode: pixverse.mode ?? 'openapi' }
              : { ok: false, error: pixverse.error },
          },
        });
      }

      if (tripo.client && await handleTripoApi(req, res, u, tripo.client) === 'handled') return;
      if (marble.client && await handleMarbleApi(req, res, u, marble.client) === 'handled') return;
      if (pixverse.client && await handlePixverseApi(req, res, u, pixverse.client) === 'handled') return;

      if (u.pathname.startsWith('/api/marble/') && !marble.client) {
        return json(res, 503, { error: 'Marble 未配置', hint: marble.error });
      }
      if (u.pathname.startsWith('/api/pixverse/') && !pixverse.client) {
        return json(res, 503, { error: 'PixVerse 未配置', hint: pixverse.error });
      }
      if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/hub') && u.pathname !== '/api/prizes' && !tripo.client) {
        return json(res, 503, { error: 'Tripo 未配置', hint: tripo.error });
      }

      json(res, 404, { error: 'not found', hint: '打开 http://localhost:' + port + '/' });
    } catch (e) {
      json(res, 500, { error: e.message ?? String(e) });
    }
  }).listen(port, () => {
    console.log(`工具 Hub → http://localhost:${port}/`);
    console.log('  Tripo:', tripo.client ? 'OK' : tripo.error);
    console.log('  Marble:', marble.client ? 'OK' : marble.error);
    console.log('  PixVerse:', pixverse.client ? `OK (${pixverse.mode ?? 'openapi'})` : pixverse.error);
  });
}

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return Number(argv[i + 1]) || 8780;
  return 8780;
}

async function boot() {
  const { bootstrapNetworkEnv } = await import('./env-bootstrap.mjs');
  await bootstrapNetworkEnv();
  process.env.SCRAPCLAW_LIB_MODE = '1';
  let tripoMod, marbleMod, tripoServe, marbleServe, pixServe;
  try {
    tripoMod = await import('./tripo.mjs');
    marbleMod = await import('./marble.mjs');
    tripoServe = await import('./tripo.serve.mjs');
    marbleServe = await import('./marble.serve.mjs');
    pixServe = await import('./pixverse.serve.mjs');
  } catch (e) {
    console.error('[hub] import failed:', e);
    throw e;
  }

  let pixverse;
  try {
    const { resolvePixverseClient } = await import('./pixverse-cli.mjs');
    const resolved = await resolvePixverseClient();
    pixverse = { client: resolved.client, error: null, mode: resolved.mode };
  } catch (e) {
    pixverse = { client: null, error: e.message ?? String(e), mode: null };
  }

  const ctx = {
    tripo: tryClient(tripoMod.TripoClient),
    marble: tryClient(marbleMod.MarbleClient),
    pixverse,
    handleTripoApi: tripoServe.handleTripoApi,
    handleMarbleApi: marbleServe.handleMarbleApi,
    handlePixverseApi: pixServe.handlePixverseApi,
    dirs: {
      tripoGen: tripoServe.GEN_DIR,
      world: marbleServe.WORLD_DIR,
      video: pixServe.VIDEO_DIR,
    },
  };
  serve(parsePort(process.argv), ctx);
}

const runHub = import.meta.main
  || (process.argv[1] && /hub\.serve\.mjs$/i.test(process.argv[1].replace(/\\/g, '/')));

function startHub() {
  // 与 node tools/tripo.mjs serve 相同：进程启动时带上 NODE_USE_ENV_PROXY（库模式不会走 tripo 自重启）
  if (hasProxyEnv() && process.env.NODE_USE_ENV_PROXY !== '1' && !process.argv.includes('--no-respawn')) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    });
    process.exit(r.status ?? 0);
  }
  boot().catch(e => { console.error(e.message ?? e); process.exit(1); });
}

if (runHub) startHub();
