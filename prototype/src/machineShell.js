// ============================================================
// 娃娃机外壳（独立模块 —— 机器生成实验的换皮接缝）
//
// 之后用 Tripo 生成机器本体时：只改这一个文件。
// 保持契约：返回的 Group 原点在地板中心，y=0 为奖池地面；
// 洞口位置必须与 CONFIG.claw.holePos 一致（视觉与判定对齐）。
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function buildMachineShell(parent) {
  const shell = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.55, metalness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 2.3), matBody);
  base.position.y = -0.15;
  shell.add(base);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x3d3428, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  shell.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), matDark);
  back.position.set(0, 1.05, -1.12);
  shell.add(back);

  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.1, 10);
  for (const [px, pz] of [[-1.58, -1.08], [1.58, -1.08], [-1.58, 1.08], [1.58, 1.08]]) {
    const m = new THREE.Mesh(postGeo, matBody);
    m.position.set(px, 1.05, pz);
    shell.add(m);
  }

  const top = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.32, 2.3), matBody);
  top.position.y = 2.2;
  shell.add(top);

  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.06), matDark);
  panel.position.set(0.9, 0.05, 1.14);
  shell.add(panel);

  // 取物洞（位置与判定同源：CONFIG.claw.holePos）
  const [hx, hz] = CONFIG.claw.holePos;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.claw.holeRadius, 0.02, 10, 32), matBody);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hx, 0.015, hz);
  shell.add(rim);
  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(CONFIG.claw.holeRadius, CONFIG.claw.holeRadius, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pit.position.set(hx, -0.14, hz);
  shell.add(pit);

  parent.add(shell);
  return shell;
}
