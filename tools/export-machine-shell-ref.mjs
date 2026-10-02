#!/usr/bin/env node
// 导出与 machineShell.js 一致的灰盒参考模型（米制，原点=池底中心，+Z=玩家侧）
// 几何与命名须与 createMachineShellGroup() 同步。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../prototype/vendor/three.module.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'prototype', 'design', 'machine-shell-ref');

const HOLE = { x: -1.12, z: 0.82, r: 0.24 };

function buildGrayboxRoot() {
  const shell = new THREE.Group();
  shell.name = 'machineShell';
  const procedural = new THREE.Group();
  procedural.name = 'machineShellProcedural';
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2e35 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x14161a });

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 2.3), matBody);
  base.name = 'machine_base';
  base.position.y = -0.15;
  procedural.add(base);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.0), matBody);
  floor.name = 'machine_floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  shell.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), matDark);
  back.name = 'machine_back';
  back.position.set(0, 1.05, -1.12);
  procedural.add(back);

  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.1, 10);
  const postNames = ['machine_post_NW', 'machine_post_NE', 'machine_post_SW', 'machine_post_SE'];
  const postCorners = [[-1.58, -1.08], [1.58, -1.08], [-1.58, 1.08], [1.58, 1.08]];
  postCorners.forEach(([px, pz], i) => {
    const m = new THREE.Mesh(postGeo, matBody);
    m.name = postNames[i];
    m.position.set(px, 1.05, pz);
    procedural.add(m);
  });

  const top = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.32, 2.3), matBody);
  top.name = 'machine_top';
  top.position.y = 2.2;
  procedural.add(top);

  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.06), matDark);
  panel.name = 'machine_panel';
  panel.position.set(0.9, 0.05, 1.14);
  procedural.add(panel);

  shell.add(procedural);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(HOLE.r, 0.02, 10, 32), matBody);
  rim.name = 'machine_hole_rim';
  rim.rotation.x = Math.PI / 2;
  rim.position.set(HOLE.x, 0.015, HOLE.z);
  shell.add(rim);

  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLE.r, HOLE.r, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  pit.name = 'machine_hole_pit';
  pit.position.set(HOLE.x, -0.14, HOLE.z);
  shell.add(pit);

  const root = new THREE.Group();
  root.name = 'machine_shell_graybox_reference';
  root.add(shell);

  const keep = new THREE.Group();
  keep.name = 'REF_cavity_keepout';
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 2.05, 2.04),
    new THREE.MeshStandardMaterial({ color: 0x22aa66, wireframe: true }),
  );
  box.name = 'REF_cavity_volume';
  box.position.set(0, 1.025, 0);
  keep.add(box);
  const holeMark = new THREE.Mesh(
    new THREE.RingGeometry(HOLE.r, HOLE.r + 0.02, 32),
    new THREE.MeshBasicMaterial({ color: 0xff6644, side: THREE.DoubleSide }),
  );
  holeMark.name = 'REF_hole_circle';
  holeMark.rotation.x = -Math.PI / 2;
  holeMark.position.set(HOLE.x, 0.002, HOLE.z);
  keep.add(holeMark);
  const axes = new THREE.AxesHelper(0.5);
  axes.name = 'REF_axes_XYZ';
  keep.add(axes);
  root.add(keep);

  return root;
}

function exportObj(root, filePath) {
  const lines = [
    '# machine shell graybox reference (meters)',
    '# origin = pool floor center; +X right; +Y up; +Z toward player',
    '# object names match Tripo part ids where applicable',
  ];
  let vOffset = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geom = o.geometry.index ? o.geometry : o.geometry.toNonIndexed();
    const pos = geom.attributes.position;
    if (!pos) return;
    lines.push(`o ${o.name || 'mesh'}`);
    const m = o.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
    }
    const idx = geom.index;
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i) + 1 + vOffset;
        const b = idx.getX(i + 1) + 1 + vOffset;
        const c = idx.getX(i + 2) + 1 + vOffset;
        lines.push(`f ${a} ${b} ${c}`);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        lines.push(`f ${i + 1 + vOffset} ${i + 2 + vOffset} ${i + 3 + vOffset}`);
      }
    }
    vOffset += pos.count;
  });
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

const root = buildGrayboxRoot();
fs.mkdirSync(OUT_DIR, { recursive: true });
const objPath = path.join(OUT_DIR, 'machine_shell_graybox_reference.obj');
exportObj(root, objPath);
console.log('OBJ →', path.relative(ROOT, objPath));
console.log('含 REF_cavity_keepout 镂空框、REF_hole_circle、REF_axes_XYZ（红绿蓝=XYZ）');
