// ============================================================
// 娃娃机外壳（独立模块 —— 机器生成实验的换皮接缝）
//
// 之后用 Tripo 生成机器本体时：只改这一个文件。
// 保持契约：返回的 Group 原点在地板中心，y=0 为奖池地面；
// 洞口位置必须与 CONFIG.claw.holePos 一致（视觉与判定对齐）。
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

/** 与游戏一致的灰盒外壳（各 mesh 带 name，便于导出对照） */
export function createMachineShellGroup() {
  const shell = new THREE.Group();
  shell.name = 'machineShell';
  const procedural = new THREE.Group();
  procedural.name = 'machineShellProcedural';

  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.55, metalness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const [hx, hz] = CONFIG.claw.holePos;

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 2.3), matBody);
  base.name = 'machine_base';
  base.position.y = -0.15;
  procedural.add(base);

  // 奖池地面。绕 X 转 -90° 后形状 y 落到世界 -z，所以洞心写成 (hx, -hz)。
  const floorShape = new THREE.Shape();
  floorShape.moveTo(-1.5, -1);
  floorShape.lineTo(1.5, -1);
  floorShape.lineTo(1.5, 1);
  floorShape.lineTo(-1.5, 1);
  floorShape.closePath();
  const floorHole = new THREE.Path();
  floorHole.absarc(hx, -hz, CONFIG.claw.holeRadius, 0, Math.PI * 2, true);
  floorShape.holes.push(floorHole);
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(floorShape),
    new THREE.MeshStandardMaterial({ color: 0x3d3428, roughness: 0.95, side: THREE.DoubleSide }));
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

  // 取物洞（位置与判定同源：CONFIG.claw.holePos）— 始终保留灰盒，与判定对齐
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.claw.holeRadius, 0.02, 10, 32), matBody);
  rim.name = 'machine_hole_rim';
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hx, 0.015, hz);
  shell.add(rim);
  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(CONFIG.claw.holeRadius, CONFIG.claw.holeRadius, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pit.name = 'machine_hole_pit';
  pit.position.set(hx, -0.14, hz);
  shell.add(pit);

  return { shell, procedural };
}

export function buildMachineShell(parent) {
  const built = createMachineShellGroup();
  parent.add(built.shell);
  return built;
}
