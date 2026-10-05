// ============================================================
// 一组模型的透明度淡入 / 淡出。
//
// 不绑定具体网格。传进来的根节点下面，现在的灰盒、之后换上的 GLB、
// 漫画描边子网格，都走同一条：每帧重新走过子树，新出现的材质
// 按「第一次见到时的透明度」当基准，立刻乘上当前进度，不会中途弹出。
//
// 只在 transparent / depthWrite 真的变了才 needsUpdate 一次。
// 消失开始时先把透明开关打开、不透明度仍是 1，着色器在画面还没变时编译完，
// 后面只改 opacity，避免淡到一半卡顿。
//
//   const fade = createModelFade();
//   await fade.out(root, { dur: 2.6 });   // 消失，停在 0
//   await fade.in(root, { dur: 2.6 });    // 从 0 出现，结束还原成原本的透明/深度写入
//   await fade.ghost(root, { dur: 3.4 }); // 淡到 0.16 即停，留一层"淡影"（终幕扫过用）
//   fade.tick(dt);                         // 主循环里调用
//   fade.restore();                        // 重开：材质回到调用前
// ============================================================

function smoothstep(u) {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));

function isOutlineMesh(obj) {
  return obj.userData?.comicOutline === true || String(obj.name || '').endsWith('__comic_outline');
}

/** 淡影的默认停靠值：ghost() 落到这里就不再变（能和 latch 判定阈值得一致） */
const GHOST_HOLD = 0.16;

/** 一个"根"可以是单个 Object3D，也可以是一组（分组淡出时传数组） */
function eachRoot(root, fn) {
  if (!root) return;
  if (Array.isArray(root)) { for (const r of root) eachRoot(r, fn); return; }
  if (!root.isObject3D) return;   // 认不出来的东西直接忽略，别把渲染循环带崩
  fn(root);
}

function eachMaterial(root, fn) {
  eachRoot(root, (r) => {
    if (!r?.isObject3D || typeof r.traverse !== 'function') return;
    r.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat?.isMaterial) fn(mat);
      }
    });
  });
}

export function createModelFade() {
  /** @type {Map<object, { opacity: number, transparent: boolean, depthWrite: boolean }>} */
  const bases = new Map();
  /** @type {Map<object, boolean>} 网格原来是否投影。描边壳不投影。 */
  const castBases = new Map();
  /** @type {null | { root: object, from: number, to: number, t: number, dur: number, resolve: () => void }} */
  let job = null;
  /** 动画结束后继续套用，盖住暂停期间才换上的 GLB。release / restore 后停止。 */
  let latchRoot = null;
  /** @type {number | null} 1 = 完全可见，0 = 完全消失 */
  let factor = null;

  function remember(mat) {
    let rec = bases.get(mat);
    if (!rec) {
      rec = {
        opacity: mat.opacity,
        transparent: mat.transparent,
        depthWrite: mat.depthWrite,
      };
      bases.set(mat, rec);
    }
    return rec;
  }

  /**
   * @param {object} root
   * @param {number} k
   * @param {boolean} solid 到达完全可见时，还原该材质原来的 transparent / depthWrite
   */
  function applyFactor(root, k, solid) {
    eachMaterial(root, (mat) => {
      const rec = remember(mat);
      const transparent = solid ? rec.transparent : true;
      const depthWrite = solid ? rec.depthWrite : (k > 0.98 ? rec.depthWrite : false);
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      if (mat.depthWrite !== depthWrite) mat.depthWrite = depthWrite;
      const next = rec.opacity * k;
      if (mat.opacity !== next) mat.opacity = next;
    });
    // 影子只跟实体外壳。描边是放大的背面壳，投影会往机器外面甩出一块。
    // 淡过一半就停投影，避免机器已经变淡，地上还留着一块实心黑影。
    eachRoot(root, (r) => {
      if (!r?.isObject3D || typeof r.traverse !== 'function') return;
      r.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!castBases.has(obj)) castBases.set(obj, !!obj.castShadow);
        if (isOutlineMesh(obj)) {
          obj.castShadow = false;
          return;
        }
        // 一淡就停投影。透明材质仍会投出实心黑影，和正在变淡的机器对不上。
        obj.castShadow = !!castBases.get(obj) && (solid || k > 0.92);
      });
    });
  }

  /**
   * @param {object} root
   * @param {{ to?: number, from?: number, dur?: number, hold?: number }} [opts]
   *   hold：动画结束后继续停在这个值（默认停到 to）。
   *   终端要的是「淡影」不是「消失」时用 hold=0.16 之类（见 acts.js 的 fadeGhost）。
   */
  function play(root, { to = 0, from, dur = 2.6, hold } = {}) {
    const start = from ?? factor ?? 1;
    const dest = to;
    const d = Math.max(0.05, dur);
    if (job) {
      job.root = root;
      job.from = factor ?? start;
      job.to = dest;
      job.t = 0;
      job.dur = d;
      job.hold = hold;
      latchRoot = root;
      return job.promise;
    }
    latchRoot = root;
    if (Math.abs(start - dest) < 0.001) {
      factor = dest;
      applyFactor(root, dest, dest > 0.995);
      return Promise.resolve();
    }
    let resolve = () => {};
    const promise = new Promise((done) => { resolve = done; });
    job = { root, from: start, to: dest, t: 0, dur: d, hold, resolve, promise };
    factor = start;
    // 目标不是「完全实心」时，这一下只打开透明、不透明度仍是起点，给着色器预热
    applyFactor(root, start, dest > 0.995 && start > 0.995);
    return promise;
  }

  function tick(dt) {
    if (job) {
      job.t += dt;
      const u = Math.min(1, job.t / job.dur);
      const k = job.from + (job.to - job.from) * smoothstep(u);
      factor = k;
      applyFactor(job.root, k, false);
      if (u >= 1) {
        factor = job.hold ?? job.to;
        applyFactor(job.root, factor, factor > 0.995);
        const done = job.resolve;
        job = null;
        done?.();
      }
      return;
    }
    if (latchRoot && factor != null && factor < 0.995) {
      applyFactor(latchRoot, factor, false);
    }
  }

  /** 停止追踪新网格，不改当前透明度。世界隐藏后调用，避免一直遍历。 */
  function release() {
    latchRoot = null;
    if (job) {
      const done = job.resolve;
      job = null;
      done?.();
    }
  }

  /** 取消动画，材质回到第一次被淡化之前。 */
  function restore() {
    const done = job?.resolve;
    job = null;
    latchRoot = null;
    factor = null;
    for (const [mat, rec] of bases) {
      mat.opacity = rec.opacity;
      mat.transparent = rec.transparent;
      mat.depthWrite = rec.depthWrite;
      mat.needsUpdate = true;
    }
    bases.clear();
    for (const [obj, cast] of castBases) {
      obj.castShadow = isOutlineMesh(obj) ? false : cast;
    }
    castBases.clear();
    done?.();
  }

  return {
    play,
    /** 消失。结束后停在 0，直到 in() 或 restore()。 */
    out(root, opts = {}) {
      return play(root, { ...opts, to: 0 });
    },
    /** 出现。从 0（或 opts.from）回到 1，结束时还原原本的透明和深度写入。 */
    in(root, opts = {}) {
      return play(root, { from: 0, ...opts, to: 1 });
    },
    /** 淡到 opts.hold（默认 0.16）即停，留一层"淡影"，不彻底消失。 */
    ghost(root, opts = {}) {
      const hold = opts.hold ?? GHOST_HOLD;
      return play(root, { ...opts, to: hold, hold });
    },
    /**
     * 分批淡出：把构件一组一组地"化掉"，不是整块一起消失。
     * 一组淡完接着下一组（play 共用一个 job，所以中途可以被 restore/新演出接手）。
     * @param {Array<{ parts: any[], dur?: number, gap?: number, done?: () => void }>} stages
     */
    async sequence(stages) {
      for (const s of (stages ?? [])) {
        if (!s?.parts?.length) continue;
        try { s.done?.(); } catch { /* 单段回调失败不影响整段 */ }
        await play(s.parts, { to: 0, from: 1, dur: s.dur ?? 0.55, hold: 0 });
        if (s.gap) await sleepMs(s.gap * 1000);
      }
    },
    tick,
    release,
    restore,
    get factor() { return factor; },
    get active() { return !!job; },
  };
}
