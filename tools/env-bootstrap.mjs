// 启动前加载 .env.local，并为 Node fetch 启用系统代理（Hub / serve 库模式不会自重启，必须在此设置）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFile() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\r\n]*?)["']?\s*$/);
      // .env.local 覆盖系统环境（避免 Windows 里残留的 TRIPO_API_BASE=.com 盖住国际站 .ai）
      if (m && (f === '.env.local' || !process.env[m[1]])) process.env[m[1]] = m[2];
    }
  }
}

export function hasProxyEnv() {
  return !!(process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy);
}

let undiciProxyReady = false;

/** 在任意 import Tripo/Marble/PixVerse 之前调用一次（Hub 必须先 await 本函数） */
export async function bootstrapNetworkEnv() {
  loadEnvFile();
  if (hasProxyEnv() && process.env.NODE_USE_ENV_PROXY !== '1') {
    process.env.NODE_USE_ENV_PROXY = '1';
  }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy || undiciProxyReady) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('node:undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    undiciProxyReady = true;
  } catch {
    // Node < 20 无 node:undici，仅依赖 NODE_USE_ENV_PROXY
  }
}
