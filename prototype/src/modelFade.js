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
//   fade.tick(dt);                         // 主循环里调用
//   fade.restore();                        // 重开：材质回到调用前
// ============================================================

function smoothstep(u) {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

function eachMaterial(root, fn) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat?.isMaterial) fn(mat);
    }
  });
}

export function createModelFade() {
  /** @type {Map<object, { opacity: number, transparent: boolean, depthWrite: boolean }>} */
  const bases = new Map();
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
  }

  /**
   * @param {object} root
   * @param {{ to?: number, from?: number, dur?: number }} [opts]
   */
  function play(root, { to = 0, from, dur = 2.6 } = {}) {
    const start = from ?? factor ?? 1;
    const dest = to;
    const d = Math.max(0.05, dur);
    if (job) {
      job.root = root;
      job.from = factor ?? start;
      job.to = dest;
      job.t = 0;
      job.dur = d;
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
    job = { root, from: start, to: dest, t: 0, dur: d, resolve, promise };
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
        factor = job.to;
        applyFactor(job.root, job.to, job.to > 0.995);
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
    tick,
    release,
    restore,
    get factor() { return factor; },
    get active() { return !!job; },
  };
}
