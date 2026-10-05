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

function isOutlineMesh(obj) {
  return obj.userData?.comicOutline === true || String(obj.name || '').endsWith('__comic_outline');
}

/** 淡影的默认停靠值：ghost() 落到这里就不再变（能和 latch 判定阈值得一致） */
const GHOST_HOLD = 0.16;

/**
 * 给一条材质算一个"用于匹配分段的路径名"。
 * 从 mesh 自己开始沿父级向上拼最多 6 层（mesh 名 + 各级祖先名），
 * 因为爪子和池底装饰本身没有 mesh 名，只有组名（clawVisual / poolDecor）。
 */
function nameForMatch(mesh) {
  if (!mesh) return '';
  const parts = [];
  let o = mesh;
  for (let i = 0; i < 6 && o; i++) {
    if (o.name) parts.push(o.name);
    o = o.parent;
  }
  return parts.join('/');
}

/** 一个"根"可以是单个 Object3D，也可以是一组（分组淡出时传数组） */
function eachRoot(root, fn) {
  if (!root) return;
  if (Array.isArray(root)) { for (const r of root) eachRoot(r, fn); return; }
  if (!root.isObject3D) return;   // 认不出来的东西直接忽略，别把渲染循环带崩
  fn(root);
}

/**
 * 遍历一棵子树下的所有材质。
 * onMesh 可选：每条材质都能回查它挂在哪个 mesh 上 —— 分段曲线要靠这个按位置分时机。
 */
function eachMaterial(root, fn, onMesh) {
  eachRoot(root, (r) => {
    if (!r?.isObject3D || typeof r.traverse !== 'function') return;
    r.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat?.isMaterial) continue;
        onMesh?.(mat, obj);
        fn(mat);
      }
    });
  });
}

export function createModelFade() {
  /** @type {Map<object, { opacity: number, transparent: boolean, depthWrite: boolean }>} */
  const bases = new Map();
  /** @type {Map<object, boolean>} 网格原来是否投影。描边壳不投影。 */
  const castBases = new Map();
  /** @type {null | { root: object, from: number, to: number, t0: number, dur: number,
   *                 hold?: number, ease?: Function|null, done: Function|null,
   *                 resolve: Function, promise: Promise, startValues: Map|null }} */
  let job = null;
  /** 被"接管"的段：效果到此为止，但它们的 promise 必须在这里结算，否则调用方永远 await */
  const pendingDone = [];
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
   * 把不透明度写进一棵子树。
   *
   * factorFn(mat) 返回**缩放系数**（0=透明，1=原本的不透明度），
   * 这样就能按材质所在的位置给不同的曲线 —— "壳先淡、东西后淡"必须走这条路。
   * 如果只给一个整组共用的标量，整棵树会一起变淡，分部件就没意义了。
   *
   * @param {object} root
   * @param {(mat: object) => number} factorFn
   * @param {boolean} solid 到达完全可见时，还原该材质原来的 transparent / depthWrite
   */
  function applyFactor(root, factorFn, solid) {
    const matOwner = new Map();   // 本轮遍历里：材质 → 所属 mesh（给分段曲线认位置）
    eachMaterial(root, (mat) => {
      const mesh = matOwner.get(mat);
      const name = nameForMatch(mesh);
      const k = Math.max(0, Math.min(1, factorFn(mat, name)));
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
    }, (mat, mesh) => matOwner.set(mat, mesh));
    // 影子只跟实体外壳。描边是放大的背面壳，投影会往机器外面甩出一块。
    // 只要有一点透明就先停投影，避免机器已经变淡、地上还留着一块实心黑影。
    eachRoot(root, (r) => {
      if (!r?.isObject3D || typeof r.traverse !== 'function') return;
      r.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!castBases.has(obj)) castBases.set(obj, !!obj.castShadow);
        if (isOutlineMesh(obj)) {
          obj.castShadow = false;
          return;
        }
        obj.castShadow = !!castBases.get(obj) && solid;
      });
    });
  }

  /** 恒定系数：最常见的用法（整组一起淡） */
  const constFn = (k) => () => k;

  /**
   * @param {object|object[]} root 单个 Object3D，或一组（分组淡出）
   * @param {{ to?: number, from?: number, dur?: number, hold?: number,
   *           ease?: (u: number, t: number, self: object) => number,
   *           __done?: () => void }} [opts]
   *   hold：动画结束后继续停在这个值（默认停到 to）。
   *   终端要的是「淡影」不是「消失」时用 hold=0.16 之类（见 acts.js 的 fadeGhost）。
   *   ease：自定义不透明度曲线。可以是 (u,t)=>k，也可以是
   *         (u,t)=>((mat)=>k) —— 后者能按材质所在位置给不同的时机（见 stageCurve）。
   *   __done：内部用。分段共用一个 job 时，前一段的收尾挂在这里 ——
   *           不能靠 promise，它是复用的，await 会等到整条链跑完。
   */
  function play(root, { to = 0, from, dur = 2.6, hold, ease, __done } = {}) {
    const start = from ?? factor ?? 1;
    const dest = to;
    const d = Math.max(0.05, dur);
    // 用**真实时间**推进，不用逐帧累加的 dt：
    // dt 会被主循环钳到 50ms/帧，低帧率设备上"2 秒的淡化"会真的跑成 1 分半。
    const now = performance.now() / 1000;
    if (job) {
      // 接管正在跑的那一条：它到此为止，收尾**立刻结算**。
      // 收尾放进 pendingDone 列表 —— 每次 play 都必须有自己的终局，
      // 否则被接管的那一位调用者会永远 await 下去（promise 是复用的）。
      if (job.done) pendingDone.push(job.done);
      job.root = root;
      job.from = factor ?? start;
      job.to = dest;
      job.t0 = now;
      job.dur = d;
      job.hold = hold;
      job.ease = ease ?? null;
      job.done = __done ?? null;
      job.startValues = null;
      latchRoot = root;
      flushPendingDone();
      return job.promise;
    }
    latchRoot = root;
    if (Math.abs(start - dest) < 0.001 && !ease) {
      factor = dest;
      applyFactor(root, constFn(dest), dest > 0.995);
      __done?.();
      return Promise.resolve();
    }
    let resolve = () => {};
    const promise = new Promise((done) => { resolve = done; });
    job = {
      root, from: start, to: dest, t0: now, dur: d, hold,
      ease: ease ?? null, done: __done ?? null, resolve, promise, startValues: null,
    };
    factor = start;
    // 先记下"这一刻各自的不透明度"当起点，曲线才能接着当前状态往下走
    if (ease) takeStartValues(root);
    // 目标不是「完全实心」时，这一下只打开透明、不透明度仍是起点，给着色器预热
    applyFactor(root, constFn(start), dest > 0.995 && start > 0.995);
    return promise;
  }

  /** 结算所有等着被接管的段（它们的效果到此为止） */
  function flushPendingDone() {
    if (!pendingDone.length) return;
    const list = pendingDone.slice();
    pendingDone.length = 0;
    for (const fn of list) { try { fn(); } catch { /* 单个收尾失败不影响其它 */ } }
  }

  /** 采样当前各自的不透明度，作为自定义曲线的起点（避免从上一个 job 的值跳变） */
  function takeStartValues(root) {
    const map = new Map();
    eachMaterial(root, (mat) => { if (!map.has(mat)) map.set(mat, mat.opacity); });
    if (job) job.startValues = map;
  }

  function finishJob() {
    if (!job) return;
    const done = job.done;
    const resolve = job.resolve;
    job = null;
    done?.();
    resolve?.();
    flushPendingDone();
  }

  function tick() {
    if (job) {
      const now = performance.now() / 1000;
      const u = Math.min(1, (now - job.t0) / job.dur);
      if (job.ease) {
        // 自定义曲线：ease 逐条材质算自己的系数（名字里带上了祖先，爪子和装饰靠组名认），
        // 于是"壳先淡、东西后淡、台子收尾"能在一次遍历里各走各的时机。
        const t = u * job.dur;
        applyFactor(job.root, (mat, name) => job.ease(u, t, { name, root: job.root }), false);
        factor = Math.min(1, job.ease(u, t, { name: '', root: job.root }));
        if (u >= 1) {
          factor = 0;
          applyFactor(job.root, constFn(0), false);
          finishJob();
        }
        return;
      }
      const k = job.from + (job.to - job.from) * smoothstep(u);
      factor = k;
      applyFactor(job.root, constFn(k), false);
      if (u >= 1) {
        factor = job.hold ?? job.to;
        applyFactor(job.root, constFn(factor), factor > 0.995);
        finishJob();
      }
      return;
    }
    if (latchRoot && factor != null && factor < 0.995) {
      applyFactor(latchRoot, constFn(factor), false);
    }
  }

  /** 停止追踪新网格，不改当前透明度。世界隐藏后调用，避免一直遍历。 */
  function release() {
    latchRoot = null;
    if (job) {
      const resolve = job.resolve;
      const done = job.done;
      job = null;
      done?.();
      resolve?.();
    }
    flushPendingDone();
  }

  /** 取消动画，材质回到第一次被淡化之前（重开时用）。等待中的调用方也一并放行。 */
  function restore() {
    const resolve = job?.resolve;
    const done = job?.done;
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
    resolve?.();
    flushPendingDone();
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
     * 多段错开的不透明度曲线：每一段有自己的 (起点时间, 时长)，各自从 1 走到 0。
     *
     * 返回的 ease 会拿到一条材质的 mesh 名字（由 play 提供），用 match 判断这段管不管它；
     * **必须按位置分** —— 整棵树共用一个系数就等于整组一起淡，分部件毫无意义。
     * 没写 match 的那一段兜底管剩下的所有材质。
     *
     * @param {Array<{ start: number, dur: number, match?: (name: string) => boolean }>} stages
     *        start/dur 单位与 dur 相同（秒）
     * @returns {(u: number, t: number, self: { name: string }) => number}
     */
    stageCurve(stages) {
      const list = (stages ?? []).filter(s => s && s.dur > 0);
      if (!list.length) return () => 1;
      const fallbackIdx = Math.max(0, list.findIndex(s => !s.match) < 0 ? list.length - 1 : list.findIndex(s => !s.match));
      return (u, t, self) => {
        const name = self?.name ?? '';
        let idx = -1;
        let bestStart = Infinity;
        for (let i = 0; i < list.length; i++) {
          const m = list[i].match;
          if (!m) continue;
          const st = list[i].start ?? 0;
          if (m(name) && st < bestStart) { bestStart = st; idx = i; }
        }
        if (idx < 0) idx = fallbackIdx;
        const s = list[idx];
        const p = (t - (s.start ?? 0)) / s.dur;
        return 1 - smoothstep(Math.max(0, Math.min(1, p)));
      };
    },
    /**
     * 分段淡化（简单情形）：**接着淡，不是轮流淡**。
     * 每段从"当前整组的不透明度"继续往 0 走，相邻两段按 overlap 交叠。
     * 复杂的三段错开请直接用 out(root, { ease: stageCurve([...]) })。
     *
     * 不要在这里 hide()：那会在淡到一半时硬切，正是要避免的观感。
     *
     * @param {Array<{ parts: any[], dur?: number }>} stages
     * @param {{ overlap?: number }} [opts] overlap：下一段提前多少（占本段时长的比例），默认 0.5
     */
    async sequence(stages, { overlap = 0.5 } = {}) {
      const list = (stages ?? []).filter(s => s?.parts?.length);
      if (!list.length) return;
      const ov = Math.max(0, Math.min(0.9, overlap));
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const dur = Math.max(0.25, s.dur ?? 0.6);
        const isLast = i === list.length - 1;
        await new Promise((resolve) => {
          play(s.parts, { to: 0, from: 1, dur: isLast ? dur : dur * (1 - ov), __done: resolve });
        });
      }
    },
    tick,
    release,
    restore,
    get factor() { return factor; },
    get active() { return !!job; },
  };
}
