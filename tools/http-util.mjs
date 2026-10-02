import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.glb': 'model/gltf-binary', '.obj': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.spz': 'application/octet-stream', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export function sendFile(res, base, rel) {
  const p = path.resolve(base, rel);
  if (!p.startsWith(path.resolve(base)) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(p).pipe(res);
  return true;
}

export const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
};

export const readBody = (req) => new Promise((ok, no) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', no);
});

export function corsPreflight(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}
