#!/usr/bin/env node
// ============================================================
// 测试码 → 二维码 PNG（ TapTap 包体自测码等）
// 用法：node tools/_qr-png.cjs "<url>" [out.png] [scale]
// 依赖：prototype/vendor/qrcode-generator.js（项目已内置，MIT）
// ============================================================
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const url = process.argv[2];
const out = path.resolve(process.argv[3] || '.shots/qr.png');
const scale = Number(process.argv[4] || 12);
const quiet = 4;

if (!url) { console.error('usage: node tools/_qr-png.cjs <url> [out.png] [scale]'); process.exit(1); }

// 该库在 node CJS 下导出异常，按浏览器 script 标签方式用 vm 加载（globalThis.qrcode）
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'prototype', 'vendor', 'qrcode-generator.js'), 'utf8'), sandbox);
const qrcode = sandbox.qrcode;

const qr = qrcode(0, 'M');
qr.addData(url);
qr.make();
const n = qr.getModuleCount();
const W = (n + quiet * 2) * scale, H = W;

const px = Buffer.alloc(W * H, 255);
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    const y0 = (r + quiet) * scale, x0 = (c + quiet) * scale;
    for (let y = y0; y < y0 + scale; y++) px.fill(0, y * W + x0, y * W + x0 + scale);
  }
}

// —— 最小 PNG 编码器（灰度 8bit，filter 0）——
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
  return t;
})();
const crc32 = (buf) => { let c = ~0; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 0; // bit depth 8, color type 0 (grayscale)
const raw = Buffer.alloc(H * (W + 1));
for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; px.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`QR saved: ${out} (${n}×${n} modules, ${W}×${H}px, ${(png.length / 1024).toFixed(1)}KB)`);
