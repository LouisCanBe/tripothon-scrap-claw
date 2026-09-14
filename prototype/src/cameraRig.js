// ============================================================
// 镜头：三观察位（左/前/右）+ 阻尼插值 + 呼吸式晃动
// outline 约束：不可环绕、不可进机器内部；呼吸幅度 <0.3°
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const damp = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
const ORDER = ['left', 'front', 'right'];

export class CameraRig {
  constructor(camera, cfg = CONFIG.camera) {
    this.camera = camera;
    this.cfg = cfg;
    this.cur = 'front';
    const v = cfg.views.front;
    this.pos = new THREE.Vector3(...v.pos);
    this.look = new THREE.Vector3(...v.look);
    this.zoom = 1;          // 有效机位 = look + (pos - look) × zoom（一幕拉近用）
    this.baseZoom = 1;      // 幕级变焦（acts.js 的 zoom 字段）
    this.modeZoom = 1;      // 取景模式倍率（near 凑近 / far 站远），main 每帧写入
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  setZoom(z) { this.baseZoom = z; }
  setModeZoom(f) { this.modeZoom = f; }

  setView(name) { if (this.cfg.views[name]) this.cur = name; }

  cycle(dir) {
    const i = ORDER.indexOf(this.cur);
    this.cur = ORDER[(i + dir + ORDER.length) % ORDER.length];
  }

  update(dt, t) {
    const cfg = this.cfg;
    const v = cfg.views[this.cur];
    this.zoom = damp(this.zoom, this.baseZoom * this.modeZoom, cfg.tau, dt);
    const z = this.zoom;

    // 以观察目标为锚点缩放机位（zoom<1 = 贴近玻璃柜）
    this.pos.x = damp(this.pos.x, v.look[0] + (v.pos[0] - v.look[0]) * z, cfg.tau, dt);
    this.pos.y = damp(this.pos.y, v.look[1] + (v.pos[1] - v.look[1]) * z, cfg.tau, dt);
    this.pos.z = damp(this.pos.z, v.look[2] + (v.pos[2] - v.look[2]) * z, cfg.tau, dt);
    this.look.x = damp(this.look.x, v.look[0], cfg.tau, dt);
    this.look.y = damp(this.look.y, v.look[1], cfg.tau, dt);
    this.look.z = damp(this.look.z, v.look[2], cfg.tau, dt);

    this.camera.position.copy(this.pos);
    if (this.camera.fov !== cfg.fov) {
      this.camera.fov = cfg.fov;
      this.camera.updateProjectionMatrix();
    }

    this._m.lookAt(this.pos, this.look, this.camera.up);
    this.camera.quaternion.setFromRotationMatrix(this._m);

    // 呼吸晃动：两组不同频正弦叠加，幅度换算自度数
    const A = THREE.MathUtils.degToRad(cfg.breathDeg);
    const w = Math.PI * 2 * cfg.breathFreq;
    const nx = A * (0.6 * Math.sin(w * t) + 0.4 * Math.sin(w * 1.70 * t + 1.3));
    const ny = A * (0.6 * Math.sin(w * 0.83 * t + 4.1) + 0.4 * Math.sin(w * 1.31 * t + 2.2));
    this._e.set(nx, ny, 0);
    this._q.setFromEuler(this._e);
    this.camera.quaternion.multiply(this._q);
  }
}
