// ============================================================
// 场景相机控制（Marble world.html 与游戏终幕共用）
//
// 双范式（与工具台一致）：
//   fps   — 拖拽转视线，WASD 水平移动，QE 升降，滚轮 FOV
//   orbit — 拖拽绕目标，WASD 平移目标，QE 升降，滚轮距离
//
// features 开关可单独启用/禁用：环视拖拽、行走、升降、滚轮、V 切换范式等。
// ============================================================
import * as THREE from 'three';

/** @typedef {'fps'|'orbit'} ControlMode */

export const SceneControlPresets = {
  /** 全景球内：只转不看，不位移（原 pano lockPos） */
  panoLook: {
    mode: 'fps',
    features: {
      pointerLook: true,
      moveWalk: false,
      moveVertical: false,
      keyboardLook: false,   // 全景默认只靠拖拽；游戏若要用方向键环视再单独开
      wheelFov: true,
      wheelOrbitDist: false,
      modeToggle: false,
    },
  },
  /** Marble 第一人称走场 */
  fpsWalk: {
    mode: 'fps',
    features: {
      pointerLook: true,
      moveWalk: true,
      moveVertical: true,
      keyboardLook: false,
      wheelFov: true,
      wheelOrbitDist: false,
      modeToggle: true,
    },
  },
  /** Marble GLB 环视检视 */
  orbitInspect: {
    mode: 'orbit',
    features: {
      pointerLook: true,
      moveWalk: true,
      moveVertical: true,
      keyboardLook: false,
      wheelFov: false,
      wheelOrbitDist: true,
      modeToggle: true,
    },
  },
};

const DEFAULT_FEATURES = {
  pointerLook: true,
  moveWalk: true,
  moveVertical: true,
  keyboardLook: false,
  wheelFov: true,
  wheelOrbitDist: true,
  modeToggle: true,
};

/** 全局 WASD（INPUT/SELECT 聚焦时不抢键） */
export function attachGlobalKeys() {
  const keys = new Set();
  const down = (e) => {
    const t = e.target?.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    keys.add(e.key.toLowerCase());
  };
  const up = (e) => keys.delete(e.key.toLowerCase());
  const clear = () => keys.clear();
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', clear);
  return {
    keys,
    dispose() {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', clear);
      keys.clear();
    },
  };
}

export class SceneControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} [opts]
   * @param {HTMLElement} [opts.canvas] 若提供则绑定指针/滚轮（工具台）
   * @param {ControlMode} [opts.mode]
   * @param {object} [opts.features]
   * @param {number[]} [opts.eye] fps 身体初始位置
   * @param {number[]|THREE.Vector3} [opts.target] orbit 目标
   * @param {number} [opts.orbitDist]
   * @param {number} [opts.orbitMin]
   * @param {number} [opts.orbitMax]
   * @param {number} [opts.lookSensitivity]
   * @param {number} [opts.moveSpeed]
   * @param {number} [opts.keyLookSpeed]
   * @param {number} [opts.yawOffset]
   * @param {number} [opts.baseFov]
   * @param {(m: ControlMode) => void} [opts.onModeChange]
   */
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.mode = opts.mode ?? 'fps';
    this.features = { ...DEFAULT_FEATURES, ...opts.features };
    this.lookSensitivity = opts.lookSensitivity ?? 0.005;
    this.moveSpeed = opts.moveSpeed ?? 3;
    this.keyLookSpeed = opts.keyLookSpeed ?? 1.8;
    this.yawOffset = opts.yawOffset ?? 0;
    this.onModeChange = opts.onModeChange;

    this.yaw = 0;
    this.pitch = 0;
    this.dist = opts.orbitDist ?? 6;
    this.orbitMin = opts.orbitMin ?? 1;
    this.orbitMax = opts.orbitMax ?? 20;

    this.target = new THREE.Vector3(...(opts.target ? (opts.target.isVector3 ? opts.target.toArray() : opts.target) : [0, 0.8, 0]));
    this.pos = new THREE.Vector3(...(opts.eye ?? [0, 1.6, 4]));
    this.baseFov = opts.baseFov ?? camera.fov;

    this.enabled = false;
    this.bounds = null;
    this._boundsMargin = 0.3;
    this.colliderMeshes = null;
    this.collisionSkin = opts.collisionSkin ?? 0.35;
    this._raycaster = new THREE.Raycaster();
    this._ray = new THREE.Ray();

    this._drag = null;
    this._boundCanvas = opts.canvas ?? null;
    this._handlers = [];
    if (this._boundCanvas) this.attachPointer(this._boundCanvas);
  }

  setFeatures(patch) {
    Object.assign(this.features, patch);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) this.apply();
  }

  setBounds(box, margin = 0.3) {
    if (!box) { this.bounds = null; return; }
    this._boundsMargin = margin;
    this.bounds = box.clone().expandByScalar(-margin);
  }

  setColliderMeshes(meshes, skin) {
    this.colliderMeshes = meshes?.length ? meshes : null;
    if (skin != null) this.collisionSkin = skin;
  }

  /** 水平移动沿 collider 三角网格阻挡（比纯 AABB 贴墙） */
  _clipAgainstMeshes(from, to) {
    const delta = to.clone().sub(from);
    const len = delta.length();
    if (len < 1e-5) return to;
    const dir = delta.normalize();
    this._ray.origin.copy(from);
    this._ray.direction.copy(dir);
    const hits = this._raycaster.intersectObjects(this.colliderMeshes, true);
    if (hits.length && hits[0].distance < len + this.collisionSkin) {
      const stop = Math.max(0, hits[0].distance - this.collisionSkin);
      return from.clone().add(dir.multiplyScalar(stop));
    }
    return to;
  }

  _moveBody(obj, fwd, right, axis, keys, speed) {
    const prev = obj.clone();
    let moved = false;
    if (this.features.moveWalk && axis) {
      const { x, z } = axis;
      if (x) { obj.addScaledVector(right, x * speed); moved = true; }
      if (z) { obj.addScaledVector(fwd, -z * speed); moved = true; }
    }
    if (keys && this.features.moveWalk) {
      if (keys.has('w') || keys.has('arrowup')) { obj.addScaledVector(fwd, speed); moved = true; }
      if (keys.has('s') || keys.has('arrowdown')) { obj.addScaledVector(fwd, -speed); moved = true; }
      if (keys.has('a') || keys.has('arrowleft')) { obj.addScaledVector(right, -speed); moved = true; }
      if (keys.has('d') || keys.has('arrowright')) { obj.addScaledVector(right, speed); moved = true; }
    }
    if (moved && this.colliderMeshes?.length && obj === this.pos) {
      this.pos.copy(this._clipAgainstMeshes(prev, this.pos));
    }
    if (keys && this.features.moveVertical) {
      if (keys.has('q') || keys.has('keyq') || keys.has('KeyQ')) { obj.y -= speed; moved = true; }
      if (keys.has('e') || keys.has('keye') || keys.has('KeyE')) { obj.y += speed; moved = true; }
    }
    return moved;
  }

  captureFromCamera() {
    this.pos.copy(this.camera.position);
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    e.setFromQuaternion(this.camera.quaternion);
    this.yaw = e.y + this.yawOffset;
    this.pitch = e.x;
    this._clampPitch();
    if (this.mode === 'orbit') {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.target.copy(this.pos).addScaledVector(dir, this.dist);
    }
  }

  addLookDelta(dx, dy) {
    if (!this.enabled) return;
    this.yaw -= dx * this.lookSensitivity;
    const sign = this.mode === 'fps' ? -1 : 1;
    this.pitch += sign * dy * this.lookSensitivity;
    this._clampPitch();
    this.apply();
  }

  applyWheelFactor(mult) {
    if (!this.enabled) return;
    if (this.mode === 'fps' && this.features.wheelFov) {
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * mult, 30, 100);
      this.camera.updateProjectionMatrix();
    } else if (this.mode === 'orbit' && this.features.wheelOrbitDist) {
      this.dist = THREE.MathUtils.clamp(this.dist * mult, this.orbitMin, this.orbitMax);
      this.apply();
    }
  }

  toggleMode() {
    if (!this.features.modeToggle) return;
    if (this.mode === 'orbit') {
      this.pos.copy(this.camera.position);
      const dir = this.target.clone().sub(this.camera.position).normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      this.mode = 'fps';
    } else {
      const dir = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      this.target.copy(this.pos).addScaledVector(dir, this.dist);
      this.mode = 'orbit';
    }
    this.apply();
    this.onModeChange?.(this.mode);
  }

  /**
   * @param {number} dt
   * @param {Set<string>|{ axis?: {x:number,z:number}, keys?: Set<string> }} [input]
   *   Set = 工具台 attachGlobalKeys（小写 w/a/s/d）
   *   对象.axis = 游戏 Input.axis() 前后左右；对象.keys = Input.keys（KeyQ/KeyE 升降）
   */
  tick(dt, input) {
    if (!this.enabled) return;

    const keys = input instanceof Set ? input : input?.keys ?? null;
    const axis = input && !(input instanceof Set) ? input.axis : null;

    if (this.features.keyboardLook && axis) {
      const { x, z } = axis;
      this.yaw -= x * this.keyLookSpeed * dt;
      this.pitch -= z * this.keyLookSpeed * dt;
      this._clampPitch();
    }

    const speed = this.moveSpeed * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const obj = this.mode === 'fps' ? this.pos : this.target;
    const moved = this._moveBody(obj, fwd, right, axis, keys, speed);

    if (this._orbit) {
      const step = Math.min(this._orbit.left, this._orbit.rate * dt);
      this.yaw += step;
      this._orbit.left -= step;
      if (this._orbit.left <= 1e-4) this._orbit = null;
      this.apply();
    } else if (moved) this.apply();
    else if (this.features.keyboardLook && axis) this.apply();
  }

  /** 终幕自动环视一圈（秒）。拖拽仍可叠加。 */
  beginOrbitSweep(turns = 1, seconds = 10) {
    const span = Math.PI * 2 * turns;
    this._orbit = { left: span, rate: span / Math.max(seconds, 0.2) };
  }

  stopOrbitSweep() {
    this._orbit = null;
  }

  apply() {
    if (this.mode === 'fps') {
      if (this.bounds) {
        this.pos.clamp(this.bounds.min, this.bounds.max);
        if (this.colliderMeshes?.length) {
          const minY = this.bounds.min.y + 0.45;
          const maxY = this.bounds.max.y - 0.15;
          this.pos.y = THREE.MathUtils.clamp(this.pos.y, minY, maxY);
        }
      }
      this.camera.position.copy(this.pos);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      if (this.bounds) this.target.clamp(this.bounds.min, this.bounds.max);
      this.camera.position.set(
        this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
        this.target.y + Math.sin(this.pitch) * this.dist + 0.4,
        this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
      );
      if (this.bounds) this.camera.position.clamp(this.bounds.min, this.bounds.max);
      this.camera.lookAt(this.target);
    }
  }

  attachPointer(canvas) {
    this.detachPointer();
    this._boundCanvas = canvas;

    const onDown = (e) => {
      if (!this.enabled || !this.features.pointerLook) return;
      this._drag = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onMove = (e) => {
      if (!this._drag || e.buttons === 0) {
        if (e.buttons === 0) this._drag = null;
        return;
      }
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag = { x: e.clientX, y: e.clientY };
      this.addLookDelta(dx, dy);
    };
    const onUp = () => { this._drag = null; };
    const onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      e.stopPropagation();
      this.applyWheelFactor(Math.exp(e.deltaY * 0.001));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this._handlers = [
      () => canvas.removeEventListener('pointerdown', onDown),
      () => canvas.removeEventListener('pointermove', onMove),
      () => canvas.removeEventListener('pointerup', onUp),
      () => canvas.removeEventListener('pointercancel', onUp),
      () => canvas.removeEventListener('wheel', onWheel),
    ];
  }

  detachPointer() {
    this._handlers.forEach((off) => off());
    this._handlers = [];
    this._drag = null;
  }

  dispose() {
    this.detachPointer();
    this.enabled = false;
  }

  _clampPitch() {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
  }
}
