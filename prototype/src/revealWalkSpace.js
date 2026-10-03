// 从 Marble collider GLB 抽出水平可走范围。斜墙、凹角跟着网格走，
// 门洞等缺口用闭合半径补上。没有网格时由调用方退回 AABB/偏转盒。

const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _c = { x: 0, y: 0, z: 0 };

function readWorldVert(out, attr, index, e) {
  out.x = attr.getX(index);
  out.y = attr.getY(index);
  out.z = attr.getZ(index);
  const x = out.x;
  const y = out.y;
  const z = out.z;
  out.x = e[0] * x + e[4] * y + e[8] * z + e[12];
  out.y = e[1] * x + e[5] * y + e[9] * z + e[13];
  out.z = e[2] * x + e[6] * y + e[10] * z + e[14];
}

function stampCell(grid, nx, nz, x, z) {
  if (x < 0 || z < 0 || x >= nx || z >= nz) return;
  grid[z * nx + x] = 1;
}

function stampLine(grid, nx, nz, ax, az, bx, bz) {
  let x0 = ax;
  let z0 = az;
  const x1 = bx;
  const z1 = bz;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const steps = (dx + dz | 0) + 3;
  for (let i = 0; i < steps; i++) {
    stampCell(grid, nx, nz, x0 | 0, z0 | 0);
    if ((x0 | 0) === (x1 | 0) && (z0 | 0) === (z1 | 0)) break;
    const e2 = err * 2;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
}

function fillTriangle(grid, nx, nz, ax, az, bx, bz, cx, cz) {
  const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  stampLine(grid, nx, nz, ax, az, bx, bz);
  stampLine(grid, nx, nz, bx, bz, cx, cz);
  stampLine(grid, nx, nz, cx, cz, ax, az);
  if (Math.abs(area) < 0.35) return;
  const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxx = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minz = Math.max(0, Math.floor(Math.min(az, bz, cz)));
  const maxz = Math.min(nz - 1, Math.ceil(Math.max(az, bz, cz)));
  for (let z = minz; z <= maxz; z++) {
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5;
      const pz = z + 0.5;
      const w0 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
      const w1 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
      const w2 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        grid[z * nx + x] = 1;
      }
    }
  }
}

function morph(src, nx, nz, r, dilate) {
  if (r <= 0) return src;
  const dst = new Uint8Array(src.length);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let on = dilate ? 0 : 1;
      loop: for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) {
            if (dilate) { on = 1; break loop; }
            on = 0;
            break loop;
          }
          const v = src[zz * nx + xx];
          if (dilate) {
            if (v) { on = 1; break loop; }
          } else if (!v) {
            on = 0;
            break loop;
          }
        }
      }
      dst[z * nx + x] = on;
    }
  }
  return dst;
}

function closeWalls(walls, nx, nz, r) {
  if (r <= 0) return walls;
  return morph(morph(walls, nx, nz, r, true), nx, nz, r, false);
}

function nearestEmpty(walls, nx, nz, ox, oz) {
  if (!walls[oz * nx + ox]) return [ox, oz];
  const lim = Math.max(nx, nz);
  for (let rad = 1; rad < lim; rad++) {
    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) !== rad && Math.abs(dz) !== rad) continue;
        const x = ox + dx;
        const z = oz + dz;
        if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
        if (!walls[z * nx + x]) return [x, z];
      }
    }
  }
  return null;
}

function floodWalkable(walls, nx, nz, sx, sz) {
  const walk = new Uint8Array(nx * nz);
  const stack = [sx, sz];
  walk[sz * nx + sx] = 1;
  let n = 1;
  while (stack.length) {
    const z = stack.pop();
    const x = stack.pop();
    const nbs = [x - 1, z, x + 1, z, x, z - 1, x, z + 1];
    for (let i = 0; i < 8; i += 2) {
      const xx = nbs[i];
      const zz = nbs[i + 1];
      if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
      const i2 = zz * nx + xx;
      if (walk[i2] || walls[i2]) continue;
      walk[i2] = 1;
      n += 1;
      stack.push(xx, zz);
    }
  }
  return { walk, n };
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts;
  const collapsed = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if (distToSeg(b, a, c) > Math.min(eps, 0.05)) collapsed.push(b);
  }
  const ring = collapsed.length >= 3 ? collapsed : pts;
  const open = rdp(ring.concat(ring[0]), eps);
  open.pop();
  return open.length >= 3 ? open : ring;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x * pts[i].z - pts[i].x * pts[j].z);
  }
  return a * 0.5;
}

function outlineFromMask(walk, nx, nz, minX, minZ, cellW, cellD) {
  const starts = new Map();
  const add = (x1, z1, x2, z2) => {
    const k = `${x1},${z1}`;
    let list = starts.get(k);
    if (!list) { list = []; starts.set(k, list); }
    list.push([x2, z2]);
  };
  const occupied = (x, z) => x >= 0 && z >= 0 && x < nx && z < nz && walk[z * nx + x];
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      if (!walk[z * nx + x]) continue;
      if (!occupied(x - 1, z)) add(x, z + 1, x, z);
      if (!occupied(x + 1, z)) add(x + 1, z, x + 1, z + 1);
      if (!occupied(x, z - 1)) add(x, z, x + 1, z);
      if (!occupied(x, z + 1)) add(x + 1, z + 1, x, z + 1);
    }
  }
  const used = new Set();
  let best = null;
  let bestAbs = 0;
  const toWorld = (loop) => loop.map(([x, z]) => ({ x: minX + x * cellW, z: minZ + z * cellD }));
  for (const [sk, dests] of starts) {
    for (let di = 0; di < dests.length; di++) {
      const uk = `${sk}>${dests[di][0]},${dests[di][1]}`;
      if (used.has(uk)) continue;
      const loop = [];
      let key = sk;
      let next = dests[di];
      let guard = 0;
      while (next && guard++ < nx * nz * 4) {
        used.add(`${key}>${next[0]},${next[1]}`);
        loop.push(next);
        const nk = `${next[0]},${next[1]}`;
        const opts = starts.get(nk);
        if (!opts) break;
        let found = null;
        for (const d of opts) {
          const ck = `${nk}>${d[0]},${d[1]}`;
          if (!used.has(ck)) { found = d; break; }
        }
        key = nk;
        next = found;
        if (nk === sk) break;
      }
      if (loop.length < 4) continue;
      const world = toWorld(loop);
      const area = polyArea(world);
      if (Math.abs(area) > bestAbs) {
        bestAbs = Math.abs(area);
        best = area < 0 ? world.reverse() : world;
      }
    }
  }
  return best;
}

function polarPolygon(walls, nx, nz, ox, oz, minX, minZ, cellW, cellD) {
  const nAng = 96;
  const dists = [];
  const rays = [];
  for (let i = 0; i < nAng; i++) {
    const ang = (i / nAng) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    let x = ox + 0.5;
    let z = oz + 0.5;
    let hit = false;
    const maxStep = (nx + nz) * 3;
    for (let s = 0; s < maxStep; s++) {
      x += dx * 0.4;
      z += dz * 0.4;
      const ix = x | 0;
      const iz = z | 0;
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) break;
      if (walls[iz * nx + ix]) { hit = true; break; }
    }
    const dist = Math.hypot((x - ox - 0.5) * cellW, (z - oz - 0.5) * cellD);
    rays.push({ ang, dist, hit });
    if (hit) dists.push(dist);
  }
  if (dists.length < 8) return null;
  dists.sort((a, b) => a - b);
  const med = dists[dists.length >> 1];
  const cap = Math.max(med * 1.4, med + 0.35);
  return rays.map((r) => {
    const d = r.hit ? Math.min(r.dist, cap) : cap;
    return {
      x: minX + (ox + 0.5) * cellW + Math.cos(r.ang) * d,
      z: minZ + (oz + 0.5) * cellD + Math.sin(r.ang) * d,
    };
  });
}

function fillPolygon(grid, nx, nz, pts, minX, minZ, cellW, cellD) {
  grid.fill(0);
  for (let z = 0; z < nz; z++) {
    const wz = minZ + (z + 0.5) * cellD;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const zi = pts[i].z;
      const zj = pts[j].z;
      if ((zi > wz) !== (zj > wz)) {
        const t = (wz - zi) / ((zj - zi) || 1e-9);
        xs.push(pts[i].x + t * (pts[j].x - pts[i].x));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.floor((xs[k] - minX) / cellW));
      const x1 = Math.min(nx - 1, Math.floor((xs[k + 1] - minX) / cellW));
      for (let x = x0; x <= x1; x++) grid[z * nx + x] = 1;
    }
  }
}

function countCells(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n += 1;
  return n;
}

function makeSpace(walk, nx, nz, minX, minZ, cellW, cellD, minY, maxY, cx, cz, polygon, source) {
  const poly = polygon?.length >= 3 ? simplifyClosed(polygon, Math.max(cellW, cellD) * 0.85) : [];
  return {
    kind: 'mesh',
    source,
    walk,
    nx,
    nz,
    minX,
    minZ,
    cellW,
    cellD,
    minY,
    maxY,
    cx,
    cz,
    polygon: poly,
    cells: countCells(walk),
    contains(x, z) {
      const ix = Math.floor((x - minX) / cellW);
      const iz = Math.floor((z - minZ) / cellD);
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
      return !!walk[iz * nx + ix];
    },
    clip(pos, from) {
      if (this.contains(pos.x, pos.z)) return pos;
      if (from && this.contains(from.x, from.z)) {
        if (this.contains(pos.x, from.z)) { pos.z = from.z; return pos; }
        if (this.contains(from.x, pos.z)) { pos.x = from.x; return pos; }
        let lo = 0;
        let hi = 1;
        let bx = from.x;
        let bz = from.z;
        for (let i = 0; i < 14; i++) {
          const m = (lo + hi) * 0.5;
          const x = from.x + (pos.x - from.x) * m;
          const z = from.z + (pos.z - from.z) * m;
          if (this.contains(x, z)) { lo = m; bx = x; bz = z; }
          else hi = m;
        }
        pos.x = bx;
        pos.z = bz;
        return pos;
      }
      pos.x = this.cx;
      pos.z = this.cz;
      return pos;
    },
  };
}

function rasterWalls(meshes, nx, nz, minX, minZ, cellW, cellD, y0, y1) {
  const walls = new Uint8Array(nx * nz);
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const attr = geo?.attributes?.position;
    if (!attr) continue;
    mesh.updateMatrixWorld(true);
    const e = mesh.matrixWorld.elements;
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : attr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3;
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      readWorldVert(_a, attr, ia, e);
      readWorldVert(_b, attr, ib, e);
      readWorldVert(_c, attr, ic, e);
      const miny = Math.min(_a.y, _b.y, _c.y);
      const maxy = Math.max(_a.y, _b.y, _c.y);
      if (maxy < y0 || miny > y1) continue;
      const abx = _b.x - _a.x;
      const aby = _b.y - _a.y;
      const abz = _b.z - _a.z;
      const acx = _c.x - _a.x;
      const acy = _c.y - _a.y;
      const acz = _c.z - _a.z;
      const ny = abz * acx - abx * acz;
      const nxn = aby * acz - abz * acy;
      const nzn = abx * acy - aby * acx;
      const nlen = Math.hypot(nxn, ny, nzn) || 1;
      if (Math.abs(ny / nlen) > 0.55) continue;
      fillTriangle(
        walls, nx, nz,
        (_a.x - minX) / cellW, (_a.z - minZ) / cellD,
        (_b.x - minX) / cellW, (_b.z - minZ) / cellD,
        (_c.x - minX) / cellW, (_c.z - minZ) / cellD,
      );
    }
  }
  return walls;
}

export const walkSpaceDiag = {};

function fail(reason, extra = {}) {
  Object.assign(walkSpaceDiag, { ok: false, reason, ...extra });
  console.warn('[walk space]', reason, extra);
  return null;
}

/**
 * @param {import('three').Mesh[]} meshes
 * @param {{x:number,z:number,y?:number}} origin
 * @param {object} [opts]
 */
export function buildWalkSpace(meshes, origin, opts = {}) {
  Object.assign(walkSpaceDiag, { ok: false, reason: 'start' });
  if (!meshes?.length || !origin) return fail('no-mesh');
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    if (!geo) continue;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (box.min.x < minX) minX = box.min.x;
    if (box.max.x > maxX) maxX = box.max.x;
    if (box.min.z < minZ) minZ = box.min.z;
    if (box.max.z > maxZ) maxZ = box.max.z;
    if (box.min.y < minY) minY = box.min.y;
    if (box.max.y > maxY) maxY = box.max.y;
  }
  if (!Number.isFinite(minX)) return fail('no-bounds');

  const pad = opts.pad ?? 0.45;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  const nx = Math.max(24, opts.grid ?? 96);
  const nz = nx;
  const cellW = (maxX - minX) / nx;
  const cellD = (maxZ - minZ) / nz;
  const cell = Math.min(cellW, cellD);
  const y0 = minY + (opts.wallY0 ?? 1);
  const y1 = minY + (opts.wallY1 ?? 2.35);

  let walls = rasterWalls(meshes, nx, nz, minX, minZ, cellW, cellD, y0, y1);
  const rawWalls = countCells(walls);
  walls = morph(walls, nx, nz, 1, true);
  const sealR = Math.round((opts.sealMeters ?? 0.6) / cell);
  walls = closeWalls(walls, nx, nz, sealR);
  const closedWalls = countCells(walls);

  let ox = Math.floor((origin.x - minX) / cellW);
  let oz = Math.floor((origin.z - minZ) / cellD);
  ox = Math.max(0, Math.min(nx - 1, ox));
  oz = Math.max(0, Math.min(nz - 1, oz));
  const seed = nearestEmpty(walls, nx, nz, ox, oz);
  if (!seed) {
    return fail('no-empty', { rawWalls, closedWalls, sealR, y0, y1, nx, cell, origin: [origin.x, origin.z] });
  }
  ox = seed[0];
  oz = seed[1];

  const flooded = floodWalkable(walls, nx, nz, ox, oz);
  const empty = nx * nz - closedWalls;
  const area = flooded.n * cellW * cellD;
  const leaked = flooded.n < 16 || area < 4 || (empty > 0 && flooded.n > empty * 0.62);

  let walk = flooded.walk;
  let source = 'flood';
  const cx = minX + (ox + 0.5) * cellW;
  const cz = minZ + (oz + 0.5) * cellD;

  if (leaked) {
    const polar = polarPolygon(walls, nx, nz, ox, oz, minX, minZ, cellW, cellD);
    if (!polar) {
      return fail('no-polar', { rawWalls, closedWalls, sealR, floodN: flooded.n, empty, area, leaked, y0, y1, cell });
    }
    walk = new Uint8Array(nx * nz);
    fillPolygon(walk, nx, nz, polar, minX, minZ, cellW, cellD);
    source = 'polar';
  }

  const insetR = Math.round((opts.meshInset ?? 0.22) / cell);
  if (insetR > 0) {
    const inset = morph(walk, nx, nz, insetR, false);
    if (countCells(inset) >= 8) {
      if (!inset[oz * nx + ox] && walk[oz * nx + ox]) inset[oz * nx + ox] = 1;
      walk = inset;
    }
  }

  const polygon = outlineFromMask(walk, nx, nz, minX, minZ, cellW, cellD);
  if (!polygon || polygon.length < 3) {
    return fail('no-outline', { source, rawWalls, closedWalls, walkCells: countCells(walk), floodN: flooded.n, leaked });
  }

  const space = makeSpace(walk, nx, nz, minX, minZ, cellW, cellD, minY, maxY, cx, cz, polygon, source);
  Object.assign(walkSpaceDiag, {
    ok: true, reason: source, rawWalls, closedWalls, sealR, floodN: flooded.n, leaked, cells: space.cells, pts: space.polygon.length,
  });
  return space;
}
