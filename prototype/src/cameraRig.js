// ============================================================
// 镜头：三观察位（左/前/右）+ 阻尼插值 + 呼吸式晃动
// outline 约束：不可环绕、不可进机器内部；呼吸幅度 <0.3°
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const damp = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
const ORDER = ['left', 'front', 'right'];
const smooth01 = (t) => t * t * (3 - 2 * t);

/** 三元插值：c = mix(a, b, k)。传 out 时写进 out，否则返回新数组（热路径上用 out）。 */
function mix3(a, b, k, out) {
  const o = out ?? [0, 0, 0];
  o[0] = a[0] + (b[0] - a[0]) * k;
  o[1] = a[1] + (b[1] - a[1]) * k;
  o[2] = a[2] + (b[2] - a[2]) * k;
  return o;
}

/** 左—前—右 一字排开：Q/E 与甩手只走相邻位，不右↔左跨跳 */
function adjacentView(cur, dir) {
  if (dir > 0) {
    if (cur === 'left') return 'front';
    if (cur === 'front') return 'right';
    return 'right';
  }
  if (cur === 'right') return 'front';
  if (cur === 'front') return 'left';
  return 'left';
}

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
    this.userZoom = 1;      // 用户缩放（滚轮/双指），与上两者相乘、互不覆盖
    this._userZoomMax = cfg.userZoomMax ?? 1.6;
    this._afterFront = null; // 数字键左↔右时先到正面再到位
    this.scan = null;        // 临时接管相机（终幕俯拍扫过奖池，见 setScan）
    this._scanDone = false;    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._tmpTarget = new THREE.Vector3();
  }

  setZoom(z) { this.baseZoom = z; }
  setModeZoom(f) { this.modeZoom = f; }
  setUserZoom(f) {
    const min = this.cfg.userZoomMin ?? 0.55;
    const max = this._userZoomMax ?? this.cfg.userZoomMax ?? 1.6;
    this.userZoom = THREE.MathUtils.clamp(f, min, max);
  }

  /** 按幕限制滚轮最远倍率（三幕起用 userZoomMaxGameplay） */
  applyUserZoomPolicy(actId = 1) {
    const cam = this.cfg;
    const per = CONFIG.present?.actCamera?.[actId]?.userZoomMax;
    const gameplay = cam.userZoomMaxGameplay ?? 1.28;
    const intro = cam.userZoomMax ?? 1.6;
    this._userZoomMax = per ?? (actId >= 3 ? gameplay : intro);
    this.setUserZoom(this.userZoom);
  }

  setView(name) {
    if (!this.cfg.views[name] || name === this.cur) return;
    const i = ORDER.indexOf(this.cur);
    const j = ORDER.indexOf(name);
    if (i >= 0 && j >= 0 && Math.abs(i - j) === 2) {
      this._afterFront = name;
      this.cur = 'front';
      return;
    }
    this._afterFront = null;
    this.cur = name;
  }

  cycle(dir) {
    this._afterFront = null;
    this.cur = adjacentView(this.cur, dir);
  }

  /**
   * 临时接管相机（终幕俯拍扫过奖池用）。传 null 归还给三观察位。
   * 只在这里写 pos/look，避免和 update() 的阻尼打架。
   */
  setScan(scan) {
    this.scan = scan ?? null;
    this._scanDone = false;
    if (this.scan) {
      if (this.scan.fromPos) this.pos.set(...this.scan.fromPos);
      if (this.scan.fromLook) this.look.set(...this.scan.fromLook);
    }
    return !!this.scan;
  }

  /** @returns {boolean} true = 本帧由扫视角接管，update() 不要再碰相机 */
  _updateScan(dt) {
    const s = this.scan;
    if (!s) return false;
    const posA = s.fromPos ?? this.pos.toArray();
    const lookA = s.fromLook ?? this.look.toArray();
    const p0 = s.startPos ?? posA;
    const l0 = s.startLook ?? lookA;
    const p1 = s.endPos ?? p0;
    const l1 = s.endLook ?? l0;
    // 起手 easeDur 秒滑到扫描起点：黑场出来是一个"移过去"，不是"切过去"
    s.ease = Math.min(1, (s.ease ?? 0) + dt / (s.easeDur ?? 1.6));
    const e = smooth01(s.ease);
    s.t = Math.min(1, (s.t ?? 0) + dt / Math.max(s.dur ?? 1, 0.01));
    const u = smooth01(s.t);
    const p = mix3(posA, p0, e);
    const l = mix3(lookA, l0, e);
    if (e >= 1) { mix3(p1, p, u, p); mix3(l1, l, u, l); }
    this.pos.set(p[0], p[1], p[2]);
    this.look.set(l[0], l[1], l[2]);
    const fov = s.fov ?? this.cfg.fov;
    this.camera.position.copy(this.pos);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this._m.lookAt(this.pos, this.look, this.camera.up);
    this.camera.quaternion.setFromRotationMatrix(this._m);
    if (e >= 1 && s.t >= 1 && !this._scanDone) {
      this._scanDone = true;
      s.onDone?.();
    }
    return true;
  }

  _viewTau(cfg) {
    return cfg.viewTau ?? cfg.tau;
  }

  _targetPos(v, z) {
    const pull = v.distanceScale ?? 1;
    const ox = (v.pos[0] - v.look[0]) * z * pull;
    const oy = (v.pos[1] - v.look[1]) * z * pull;
    const oz = (v.pos[2] - v.look[2]) * z * pull;
    return this._tmpTarget.set(
      v.look[0] + ox,
      v.look[1] + oy,
      v.look[2] + oz,
    );
  }

  update(dt, t) {
    if (this._updateScan(dt)) return;
    const cfg = this.cfg;
    const v = cfg.views[this.cur];
    const tau = this._viewTau(cfg);
    this.zoom = damp(this.zoom, this.baseZoom * this.modeZoom * this.userZoom, tau, dt);
    const z = this.zoom;
    const target = this._targetPos(v, z);

    // 以观察目标为锚点缩放机位（zoom<1 = 贴近玻璃柜）
    this.pos.x = damp(this.pos.x, target.x, tau, dt);
    this.pos.y = damp(this.pos.y, target.y, tau, dt);
    this.pos.z = damp(this.pos.z, target.z, tau, dt);
    this.look.x = damp(this.look.x, v.look[0], tau, dt);
    this.look.y = damp(this.look.y, v.look[1], tau, dt);
    this.look.z = damp(this.look.z, v.look[2], tau, dt);

    if (this._afterFront && this.cur === 'front') {
      const snap = cfg.viewHandoffDist ?? 0.12;
      if (this.pos.distanceTo(target) < snap) {
        this.cur = this._afterFront;
        this._afterFront = null;
      }
    }

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
