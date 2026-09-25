// 副屏 3D 入场动效（指数阻尼 + 触地回弹，末段无弹簧/无跟旋锚定）
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { resolveEntranceConfigForPrize } from './collectBouncePresets.js';

const damp = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));

export function getEntranceConfig() {
  return CONFIG.collectDisplay?.entrance ?? {};
}

/**
 * @param {THREE.Object3D} lift 只改 position.y（展台高度）
 * @param {THREE.Object3D} [tumble] 下落倾斜；与 lift 分离
 */
export function createCollectEntrance(lift, tumble = null, prize = null) {
  const cfg = prize ? resolveEntranceConfigForPrize(prize) : getEntranceConfig();
  const preset = cfg.preset ?? 'dropFromAbove';
  if (preset === 'none') return new IdleEntrance();

  if (preset === 'dropFromAbove') {
    return new DropFromAboveEntrance(lift, tumble, cfg);
  }
  if (preset === 'fadeScale') {
    return new FadeScaleEntrance(lift, cfg);
  }
  return new DropFromAboveEntrance(lift, tumble, cfg);
}

class IdleEntrance {
  update() { return false; }
  get active() { return false; }
}

function dampEuler(euler, tau, dt) {
  euler.x = damp(euler.x, 0, tau, dt);
  euler.y = damp(euler.y, 0, tau, dt);
  euler.z = damp(euler.z, 0, tau, dt);
}

function tumbleFlat(tumble, eps = 0.022) {
  if (!tumble) return true;
  return Math.abs(tumble.rotation.x) < eps
    && Math.abs(tumble.rotation.y) < eps
    && Math.abs(tumble.rotation.z) < eps;
}

function resolveBounceCount(cfg) {
  const r = cfg.bounceCountRandom;
  if (Array.isArray(r) && r.length >= 2) {
    const lo = Math.min(r[0], r[1]);
    const hi = Math.max(r[0], r[1]);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  return cfg.bounceCount ?? 2;
}

/** 每次出货略不同的下落手感（重力 / 高度 / 初速度） */
function sampleFallMotion(cfg) {
  const pick = (base, spreadKey, absKey) => {
    const abs = cfg[absKey];
    if (Array.isArray(abs) && abs.length >= 2) {
      const lo = Math.min(abs[0], abs[1]);
      const hi = Math.max(abs[0], abs[1]);
      return lo + Math.random() * (hi - lo);
    }
    const spread = cfg[spreadKey] ?? cfg.fallVariation ?? 0;
    if (!spread) return base;
    return base * (1 + (Math.random() * 2 - 1) * spread);
  };
  const vySpread = cfg.initialVySpread ?? 0.18;
  return {
    dropHeight: pick(cfg.dropHeight ?? 2.35, 'dropHeightVariation', 'dropHeightRandom'),
    gravity: pick(cfg.gravity ?? 16, 'gravityVariation', 'gravityRandom'),
    initialVy: (cfg.initialVy ?? 0) + (Math.random() * 2 - 1) * vySpread,
  };
}

/**
 * 重力下落 + 限定次数触地回弹 → 压稳（不再启弹簧，避免第三下微颤）
 * 底面对齐仅在「仍有倾斜」时启用；压平后不再跟 bbox（否则与 idle 自转打架）
 */
class DropFromAboveEntrance {
  constructor(lift, tumble, cfg) {
    this.lift = lift;
    this.tumble = tumble;
    this.groundY = cfg.groundY ?? 0;
    const fall = sampleFallMotion(cfg);
    this._y = fall.dropHeight;
    this._vy = fall.initialVy;
    this._g = fall.gravity;
    this._tauRot = cfg.tumbleTau ?? 0.38;
    this._anchorTau = cfg.floorAnchorTau ?? 0.07;
    this._anchorBand = cfg.floorAnchorBand ?? 0.22;
    this._coastTauY = cfg.coastTauY ?? 0.09;
    this._coastTauVy = cfg.coastTauVy ?? 0.11;
    this._settleY = cfg.settleY ?? 0.008;
    this._settleVy = cfg.settleVy ?? 0.045;
    this._settleHold = cfg.settleHold ?? 0.1;
    this._settleT = 0;
    this._done = false;
    this._coast = false;
    this._box = new THREE.Box3();
    this._targetBounces = resolveBounceCount(cfg);
    this._bouncesLeft = this._targetBounces;
    this._impactVyMin = cfg.impactVyMin ?? 0.28;
    this._rest1 = cfg.bounceRestitution1 ?? 0.44;
    this._rest2 = cfg.bounceRestitution2 ?? 0.2;
    this._restFurther = cfg.bounceRestitutionFurther ?? 0.12;
    lift.position.set(0, this._y, 0);
    if (tumble && cfg.tumbleDuringDrop) {
      tumble.rotation.x = cfg.tumbleX ?? 0.28;
      tumble.rotation.z = cfg.tumbleZ ?? 0.1;
    }
  }

  _worldMinY() {
    if (!this.tumble) return this.lift.position.y;
    this.tumble.updateWorldMatrix(true, true);
    this._box.setFromObject(this.tumble);
    return this._box.min.y;
  }

  /** 仅倾斜未压平时补偿接地点；压平后交给 lift._y，避免自转时 bbox 抖动 */
  _applyFloorAnchor(dt) {
    if (!this.tumble || tumbleFlat(this.tumble) || this._coast) return;
    const err = this.groundY - this._worldMinY();
    if (Math.abs(err) > this._anchorBand) return;
    const target = this.lift.position.y + err;
    this.lift.position.y = damp(this.lift.position.y, target, this._anchorTau, dt);
    this._y = this.lift.position.y;
  }

  _dampTumble(dt) {
    if (!this.tumble) return;
    dampEuler(this.tumble.rotation, this._tauRot, dt);
  }

  _restitutionFor(impactIndex) {
    if (impactIndex <= 0) return this._rest1;
    if (impactIndex === 1) return this._rest2;
    return this._restFurther;
  }

  _resolveFloorImpact() {
    if (this._y > this.groundY) return;
    this._y = this.groundY;
    if (this._vy < -this._impactVyMin && this._bouncesLeft > 0) {
      const i = this._targetBounces - this._bouncesLeft;
      this._vy = -this._vy * this._restitutionFor(i);
      this._bouncesLeft -= 1;
      if (this._bouncesLeft <= 0) this._coast = true;
    } else if (this._vy < 0) {
      this._vy = 0;
      if (this._bouncesLeft <= 0) this._coast = true;
    }
  }

  _stepCoast(dt) {
    this._vy = damp(this._vy, 0, this._coastTauVy, dt);
    this._y = damp(this._y, this.groundY, this._coastTauY, dt);
    if (this._y < this.groundY) {
      this._y = this.groundY;
      this._vy = 0;
    }
  }

  update(dt) {
    if (this._done) return false;
    dt = Math.min(dt, 0.05);

    this._dampTumble(dt);

    if (this._coast) {
      this._stepCoast(dt);
    } else {
      this._vy -= this._g * dt;
      this._y += this._vy * dt;
      this._resolveFloorImpact();
    }

    this.lift.position.y = this._y;
    this._applyFloorAnchor(dt);

    const flat = tumbleFlat(this.tumble);
    const near = Math.abs(this._y - this.groundY) < 0.06;
    const settled = this._coast && near
      && Math.abs(this._vy) < this._settleVy
      && Math.abs(this._y - this.groundY) < this._settleY
      && flat;

    if (settled) this._settleT += dt;
    else this._settleT = 0;

    if (this._settleT >= this._settleHold) {
      this._vy = 0;
      this._y = this.groundY;
      this.lift.position.y = this.groundY;
      this._done = true;
    }
    return !this._done;
  }

  get active() { return !this._done; }
}

/** 原地放大淡入（备用 preset） */
class FadeScaleEntrance {
  constructor(content, cfg) {
    this.content = content;
    this._t = 0;
    this._dur = cfg.fadeDuration ?? 0.55;
    this._from = cfg.fadeScaleFrom ?? 0.35;
    this._base = content.scale.clone();
    content.scale.copy(this._base).multiplyScalar(this._from);
  }

  update(dt) {
    this._t += dt;
    const u = Math.min(1, this._t / this._dur);
    const k = 1 - (1 - u) ** 3;
    const s = THREE.MathUtils.lerp(this._from, 1, k);
    this.content.scale.copy(this._base).multiplyScalar(s);
    return u < 1;
  }

  get active() { return this._t < this._dur; }
}
