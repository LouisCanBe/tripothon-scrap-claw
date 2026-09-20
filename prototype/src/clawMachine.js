// ============================================================
// 爪机状态机（机制核心，outline 的"边界锁死"区）
//
//   IDLE → DROP → CLOSE_PAUSE → CLOSE(判定) → GRAB_PAUSE
//        → LIFT(可能滑落) → RETURN → DELIVER → OPEN → RESET → IDLE
//
// 手感三原则（对应 outline）：
//   1. 输入→位移有惯性：目标点先行，爪子指数缓动追踪（moveTau）
//   2. 落爪后不可取消：非 IDLE 状态下 move() 直接忽略输入
//   3. 滑落是正常体验：爪力/滑落全程是概率参数，不做硬失败
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { nearestItem, capTextures, enableShadows } from './prizePool.js';

const C = () => CONFIG.claw;
const lerp = THREE.MathUtils.lerp;
const damp = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));

const S = { IDLE: 0, DROP: 1, CLOSE_PAUSE: 2, CLOSE: 3, GRAB_PAUSE: 4,
            LIFT: 5, RETURN: 6, DELIVER: 7, OPEN: 8, RESET: 9 };

const MESSAGES = {
  drop: ['落爪——'],
  miss: ['空了。', '什么都没抓住。'],
  slip: ['啊——滑掉了。', '就差一点。'],
  food: ['成功了。他和妹妹分着吃。', '是吃的。今晚有着落了。'],
  junk: ['……这个也能吃。', '捡都捡了。'],
};

export class ClawMachine {
  constructor(scene, items, hooks = {}) {
    this.items = items;
    this.hooks = hooks;
    this.state = S.IDLE;
    this.timer = 0;

    this.target = new THREE.Vector2(C().home[0], C().home[1]); // 目标点（输入直接驱动它）
    this.clawY = C().restY;
    this.prongT = 0;                 // 0=张开 1=闭合
    this.openAngle = 0.55;           // 爪片张开角（弧度）
    this.closedAngle = -0.14;        // 爪片闭合角
    this.gantryY = 1.95;             // 横梁高度

    this.gripped = null;             // 当前抓住的物品
    this.slipPlanned = false;        // 本次上升是否安排滑落
    this.slipAtY = 0;                // 滑落发生高度
    this.controlEnabled = true;      // 流程编排的输入总闸（Director 控制）

    this.#build(scene);
  }

  #build(scene) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 });
    const dark  = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5,  metalness: 0.7 });

    this.rig = new THREE.Group();
    this.rig.position.set(this.target.x, 0, this.target.y);
    scene.add(this.rig);

    // 横梁小车
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.22), dark);
    carriage.position.y = this.gantryY;
    this.rig.add(carriage);

    // 吊缆（每帧按爪高缩放）
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), dark);
    this.rig.add(this.cable);

    // 爪
    this.claw = new THREE.Group();
    this.claw.position.y = this.clawY;
    this.rig.add(this.claw);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.10, 16), metal);
    this.claw.add(crown);

    // 三爪片：procedural 建模（灰盒兜底；AI 分件爪由 upgradeClawVisual 热替换）
    this._procVisuals = [crown];   // 记录 procedural 件，替换时摘除
    this.pivots = [];
    for (let i = 0; i < 3; i++) {
      const assembly = new THREE.Group();
      assembly.rotation.y = (i / 3) * Math.PI * 2;
      this.claw.add(assembly);
      this._procVisuals.push(assembly);

      const pivot = new THREE.Group();
      pivot.position.set(0.15, -0.05, 0);
      assembly.add(pivot);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.06), metal);
      arm.position.y = -0.20;
      pivot.add(arm);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.18, 0.05), metal);
      tip.position.set(-0.045, -0.44, 0);
      tip.rotation.z = -0.65;
      pivot.add(tip);

      this.pivots.push(pivot);
    }
    this.#setProngs(0);
  }

  // ============================================================
  // Tripo 接缝：AI 分件爪热替换（只换视觉，状态机/判定零改动）
  // 静态件保持原变换；爪臂按节点方位角各包一个关节 pivot，
  // 替换 this.pivots 引用 → #setProngs / 开合时序照常工作。
  // 失败（无文件/解析错）→ 保留 procedural 爪，静默回退。
  // ============================================================
  async upgradeClawVisual(renderer, camera) {
    const cfg = CONFIG.clawGLB;
    if (!cfg?.url) return;
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(cfg.url);
      const root = gltf.scene;
      if (matchMedia('(pointer: coarse)').matches) capTextures(root, CONFIG.mobile.maxTextureSize);
      enableShadows(root);
      // Tripo 金属件是 metalness=1 全金属：IBL 下会反射整个环境导致过曝发白，
      // 单独压低环境反射，保留金属质感但不白花
      root.traverse(o => { if (o.isMesh && o.material?.metalness !== undefined) o.material.envMapIntensity = 0.3; });
      const byName = {};
      root.traverse(o => { if (o.name) byName[o.name] = o; });

      const newClaw = new THREE.Group();
      newClaw.scale.setScalar(cfg.scale);
      newClaw.position.y = cfg.offsetY;
      newClaw.rotation.y = cfg.rotationY ?? 0;   // 转正：让正视角看到开合
      newClaw.add(root);
      this.claw.add(newClaw);

      // 爪臂重挂：每条臂一个 assembly（对齐方位角）+ pivot（关节点）
      const pivots = [];
      for (const group of cfg.prongGroups) {
        const first = byName[group[0]];
        if (!first) continue;
        const t = first.position;                     // 节点位移 ≈ 臂的方位
        const assembly = new THREE.Group();
        assembly.rotation.y = Math.atan2(-t.z, t.x);  // 局部 +x = 该臂径向
        const pivot = new THREE.Group();
        pivot.position.set(cfg.attachR, cfg.attachY, 0);
        assembly.add(pivot);
        newClaw.add(assembly);
        pivots.push(pivot);
        newClaw.updateMatrixWorld(true);              // attach 前刷新矩阵
        for (const name of group) {
          const part = byName[name];
          if (part) pivot.attach(part);               // 保持世界位姿挂到关节下
        }
      }
      if (!pivots.length) throw new Error('分件里没有可动爪臂');

      // 预编译材质，避免替换瞬间卡帧
      if (renderer && camera) {
        newClaw.visible = false;
        try { await renderer.compileAsync(newClaw, camera); } catch { /* 退化为同步 */ }
        newClaw.visible = true;
      }

      for (const o of this._procVisuals) this.claw.remove(o);
      this._procVisuals = [];
      this.pivots = pivots;
      this.openAngle = cfg.openAngle;                 // 生成姿态 = 张开
      this.closedAngle = cfg.closeAngle;
      this.#setProngs(this.prongT);
      console.log('[claw] AI 分件爪已替换，关节数:', pivots.length);
    } catch (err) {
      console.warn('[claw] GLB 爪加载失败，保留 procedural 爪', err);
    }
  }

  #setProngs(t) {
    for (const p of this.pivots) p.rotation.z = lerp(this.openAngle, this.closedAngle, t);
  }

  #say(kind) {
    const pool = MESSAGES[kind];
    if (pool && this.hooks.onMessage)
      this.hooks.onMessage(pool[Math.floor(Math.random() * pool.length)]);
  }

  // 水平移动：非 IDLE 一律忽略（落爪不可取消的输入锁）；
  // controlEnabled=false 时整闸关闭（一幕/四幕/终幕）
  move(ax, az, dt) {
    if (!this.controlEnabled || this.state !== S.IDLE) return;
    const c = C();
    this.target.x = THREE.MathUtils.clamp(this.target.x + ax * c.moveSpeed * dt, ...c.boundsX);
    this.target.y = THREE.MathUtils.clamp(this.target.y + az * c.moveSpeed * dt, ...c.boundsZ);
  }

  startDrop() {
    if (!this.controlEnabled || this.state !== S.IDLE) return false;
    this.state = S.DROP;
    this.#say('drop');
    return true;
  }

  #judge() {
    const c = C();
    const g = c.gripStrength;
    const cand = nearestItem(this.items, this.rig.position.x, this.rig.position.z, c.grabRadius);

    if (cand && Math.random() < g * cand.gripFactor) {
      this.gripped = cand;
      cand.state = 'gripped';
      // 上升前一次性掷签：是否滑落、在哪个高度滑
      this.slipPlanned = Math.random() < c.baseSlipProb * (1 - g * cand.gripFactor);
      this.slipAtY = lerp(c.grabY + 0.25, c.restY - 0.20, Math.random());
    } else {
      // 没抓住：把碰到的物品碰歪一点（物理存在感的廉价演出）
      if (cand) {
        cand.mesh.rotation.z += (Math.random() < 0.5 ? 1 : -1) * 0.4;
        cand.mesh.rotation.x += (Math.random() - 0.5) * 0.3;
      }
      this.#say('miss');
    }
  }

  #release(intoHole) {
    const it = this.gripped;
    if (!it) return;
    it.state = intoHole ? 'delivering' : 'falling';
    it.vy = 0;
    this.gripped = null;
    if (intoHole) {
      this.hooks.onCollect?.(it);
      this.#say(it.category === 'food' ? 'food' : 'junk');
    } else {
      this.#say('slip');
    }
  }

  // 掉落中的物品（滑落 / 入洞共用）
  #updateFalling(dt) {
    const [bx0, bx1] = CONFIG.pool.boundsX;
    const [bz0, bz1] = CONFIG.pool.boundsZ;
    for (const it of this.items) {
      if (it.state !== 'falling' && it.state !== 'delivering') continue;
      it.vy -= 6.0 * dt;
      it.mesh.position.y += it.vy * dt;
      const floorY = it.state === 'delivering' ? -0.30 : it.restY;
      if (it.mesh.position.y <= floorY) {
        if (it.state === 'delivering') {
          it.mesh.visible = false;
          it.state = 'collected';
        } else if (it.vy < -1.0) {
          it.mesh.position.y = floorY;   // 一次小反弹
          it.vy = -it.vy * 0.3;
        } else {
          it.mesh.position.y = floorY;
          it.mesh.position.x = THREE.MathUtils.clamp(it.mesh.position.x + THREE.MathUtils.randFloatSpread(0.08), bx0, bx1);
          it.mesh.position.z = THREE.MathUtils.clamp(it.mesh.position.z + THREE.MathUtils.randFloatSpread(0.08), bz0, bz1);
          it.mesh.rotation.y = Math.random() * Math.PI * 2;
          it.vy = 0;
          it.state = 'idle';
        }
      }
    }
  }

  update(dt, t) {
    const c = C();

    // 爪子 XZ 永远缓动追踪目标点（巡移与回收用不同 tau → 回收更钝）
    const tau = this.state === S.RETURN ? c.returnTau : c.moveTau;
    this.rig.position.x = damp(this.rig.position.x, this.target.x, tau, dt);
    this.rig.position.z = damp(this.rig.position.z, this.target.y, tau, dt);

    // 吊缆伸缩
    const top = this.gantryY - 0.05, bottom = this.clawY + 0.05;
    const len = Math.max(top - bottom, 0.02);
    this.cable.scale.y = len;
    this.cable.position.y = bottom + len / 2;

    this.claw.position.y = this.clawY;

    // 抓住的物品跟着爪尖走 + 抖动（安排滑落时抖得更凶 = 预兆）
    if (this.gripped) {
      const wobA = c.wobbleAmp * (this.slipPlanned ? 1.7 : 1.0);
      const wx = Math.sin(t * c.wobbleFreq) * wobA;
      const wz = Math.sin(t * c.wobbleFreq * 1.31 + 1.7) * wobA * 0.6;
      this.gripped.mesh.position.set(this.rig.position.x + wx, this.clawY - 0.52, this.rig.position.z + wz);
    }

    this.#updateFalling(dt);

    switch (this.state) {
      case S.IDLE: break;

      case S.DROP:
        this.clawY -= c.dropSpeed * dt;
        if (this.clawY <= c.grabY) { this.clawY = c.grabY; this.timer = c.closeDelay; this.state = S.CLOSE_PAUSE; }
        break;

      case S.CLOSE_PAUSE:
        this.timer -= dt;
        if (this.timer <= 0) this.state = S.CLOSE;
        break;

      case S.CLOSE:
        this.prongT = Math.min(this.prongT + dt / c.closeDuration, 1);
        this.#setProngs(this.prongT);
        if (this.prongT >= 1) { this.#judge(); this.timer = c.afterGrabPause; this.state = S.GRAB_PAUSE; }
        break;

      case S.GRAB_PAUSE:
        this.timer -= dt;
        if (this.timer <= 0) this.state = S.LIFT;
        break;

      case S.LIFT:
        this.clawY += c.liftSpeed * dt;
        if (this.slipPlanned && this.gripped && this.clawY >= this.slipAtY) {
          this.#release(false);
          this.slipPlanned = false;
        }
        if (this.clawY >= c.restY) {
          this.clawY = c.restY;
          this.target.set(c.home[0], c.home[1]);   // 回收：目标点指向洞口
          this.state = S.RETURN;
        }
        break;

      case S.RETURN: {
        const dx = this.rig.position.x - c.home[0], dz = this.rig.position.z - c.home[1];
        if (Math.abs(dx) + Math.abs(dz) < 0.03) this.state = S.DELIVER;
        break;
      }

      case S.DELIVER:
        this.clawY -= c.dropSpeed * 0.7 * dt;
        if (this.clawY <= c.restY - 0.75) { this.state = S.OPEN; }
        break;

      case S.OPEN:
        this.prongT = Math.max(this.prongT - dt / 0.30, 0);
        this.#setProngs(this.prongT);
        if (this.prongT <= 0) { this.#release(true); this.state = S.RESET; }
        break;

      case S.RESET:
        this.clawY += c.liftSpeed * 1.4 * dt;
        if (this.clawY >= c.restY) { this.clawY = c.restY; this.state = S.IDLE; }
        break;
    }
  }
}
