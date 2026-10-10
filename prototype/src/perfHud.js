// ============================================================
// 开发模式 · 性能面板 —— 见 PERF-性能优化.md
//
// 默认**关闭**，仅以下方式打开（与调参面板同一套闸门）：
//   ?perf=1            只开面板
//   ?gui=1 / ?dev=1    面板 + 调参面板（?perf=1 时 H 无效，用 P 切面板）
//   运行中按 P          显隐切换
//
// 为什么单独做而不是用浏览器 Performance 面板：
//   1. 能直接看到 renderer.info（draw call / 三角 / 贴图 / program）——
//      这些是 three.js 侧瓶颈的第一证据，截图也能带走。
//   2. 分「更新 / 渲染」两段计时，立刻知道卡在 CPU 逻辑还是 GPU 提交。
//   3. 记录资源加载时间线，定位首屏 170MB 到底慢在哪一步。
//   4. 显示真实 GPU 名字（SwiftShader 软渲染一眼可辨，e2e 慢的根因就在这）。
//
// 面板自身尽量少干活：每 200ms 才重建一次文本，不每帧碰 DOM。
// ============================================================

const $ = (sel) => document.querySelector(sel);

function fmt(n, d = 0) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(d);
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n|0}B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1048576).toFixed(1)}M`;
}

/** GPU 名字：WEBGL_debug_renderer_info 拿不到就退化成 vendor 掩码 */
function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const s = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (s) return String(s).slice(0, 48);
    }
    return String(gl.getParameter(gl.RENDERER) ?? '?').slice(0, 48);
  } catch {
    return '?';
  }
}

export function createPerfHud({ renderer, url }) {
  const root = document.createElement('div');
  root.id = 'perfHud';
  root.hidden = true;
  root.innerHTML = `
    <div class="ph-head">
      <span class="ph-title">PERF</span>
      <span class="ph-hint">P 关</span>
    </div>
    <div class="ph-body"></div>`;
  document.body.appendChild(root);

  const body = root.querySelector('.ph-body');

  // —— 帧时间环形缓冲（最近 180 帧 ≈ 3s @60fps）——
  const FRAMES = 180;
  const frames = new Float32Array(FRAMES);
  let frameIdx = 0;
  let frameCount = 0;

  // —— 两段计时：update（逻辑/物理）与 render（post.render 提交整条链）——
  let tUpdate = 0, tRender = 0, tFrame = 0;
  let _mark = 0;

  // —— 资源加载时间线（运行期标记单独放，避免互相挤掉）——
  const loads = [];          // 首屏资源就绪时刻
  const runtimeMarks = [];   // 运行期事件（换货/释放等），最多留 8 条
  const BOOT_T = performance.now();   // 基准 = 面板创建时刻（≈ 模块求值早期）
  let loadReadyAt = null;

  // —— GPU / 静态信息只取一次 ——
  const gpu = gpuName(renderer);
  const dpr = Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);

  let enabled = false;
  let lastPaint = 0;
  let _msaaSamples = 4;   // 由 main.js 在 Post 建好后回填（post.msaaSamples）

  function setVisible(v) {
    enabled = v;
    root.hidden = !v;
    if (!v) return;
    // 打开时立刻刷一次，不用等 200ms
    lastPaint = 0;
    paint();
  }

  function toggle() { setVisible(!enabled); }

  /** 由 main.js 在 Post 构造后调用，把实际生效的 MSAA 档位告诉面板 */
  function setMsaaSamples(n) { _msaaSamples = n; }

  function beginFrame() { _mark = performance.now(); }
  function endUpdate() { tUpdate = performance.now() - _mark; }
  function endRender() {
    tRender = performance.now() - _mark;
    tFrame = tRender;
    frames[frameIdx] = tFrame;
    frameIdx = (frameIdx + 1) % FRAMES;
    frameCount += 1;
  }

  /**
   * 记录首屏资源就绪时刻。这是「加载时间线」，只应被资源加载调用。
   * 逐个显示、不设上限（首屏只有个位数的资源组）。
   */
  function mark(name) {
    loads.push({ name, t: performance.now() });
  }
  /**
   * 记录运行期事件（两态换货、模型释放等）。
   * **与加载时间线分开**：运行期事件可能触发几十次（按 N/Y 重玩），
   * 混在一条列表里会把首屏的时间线挤掉，反而看不出加载慢在哪。
   * 只保留最近 6 条，且只显示累计次数。
   */
  function markRuntime(name) {
    const last = runtimeMarks[0];
    if (last && last.name === name) { last.count += 1; last.t = performance.now(); return; }
    runtimeMarks.unshift({ name, t: performance.now(), count: 1 });
    if (runtimeMarks.length > 6) runtimeMarks.pop();
  }
  function setLoadReady() {
    if (loadReadyAt == null) loadReadyAt = performance.now();
  }

  function stats() {
    const n = Math.min(frameCount, FRAMES);
    if (!n) return null;
    let sum = 0, max = 0;
    for (let i = 0; i < n; i++) { const v = frames[i]; sum += v; if (v > max) max = v; }
    const arr = Array.from(frames.slice(0, n)).sort((a, b) => a - b);
    const p99 = arr[Math.min(n - 1, Math.floor(n * 0.99))];
    return {
      fps: 1000 / (sum / n),
      avg: sum / n,
      max,
      p99,
      update: tUpdate,
      render: tRender,
    };
  }

  function paint() {
    if (!enabled) return;
    const s = stats();
    const info = renderer.info;
    // 直接读 drawingBuffer，别用 getDrawingBufferSize(plainObject) —— three 内部会调 target.set()
    const gl = renderer.getContext();
    const buf = { x: gl.drawingBufferWidth, y: gl.drawingBufferHeight };
    const heap = performance.memory
      ? `${fmtBytes(performance.memory.usedJSHeapSize)} / ${fmtBytes(performance.memory.jsHeapSizeLimit)}`
      : 'n/a';

    const fpsColor = !s ? '#9aa' : s.fps >= 55 ? '#7ee08a' : s.fps >= 40 ? '#e8c46a' : '#e87a6a';
    const row = (k, v, cls = '') =>
      `<div class="ph-row"><span class="ph-k">${k}</span><span class="ph-v ${cls}">${v}</span></div>`;

    let html = '';
    if (s) {
      html += row('FPS', `<b style="color:${fpsColor}">${fmt(s.fps, 1)}</b>`, 'ph-big');
      html += row('帧 ms', `${fmt(s.avg, 2)} avg · ${fmt(s.max, 1)} worst · p99 ${fmt(s.p99, 1)}`);
      html += row('分段', `更新 ${fmt(s.update, 2)} · 渲染 ${fmt(s.render, 2)}`);
      if (s.update > 8) html += row('⚠', '更新段 >8ms，逻辑/物理为主');
      if (s.render > 12) html += row('⚠', '渲染段 >12ms，后处理/填充率为主');
    } else {
      html += row('FPS', '收集中…');
    }

    html += '<div class="ph-sep"></div>';
    html += row('draw call', `${info.render.calls}`);
    html += row('三角', `${(info.render.triangles / 1000).toFixed(0)}k`);
    html += row('几何/贴图', `${info.memory.geometries} / ${info.memory.textures}`);
    html += row('program', `${info.programs?.length ?? 0}`);
    html += row('缓冲', `${buf.x|0}×${buf.y|0} @${dpr}x · MSAA ${_msaaSamples}`);
    html += row('JS 堆', heap);

    html += '<div class="ph-sep"></div>';
    html += row('GPU', gpu);
    if (/swiftshader|software|llvmpipe|basic render/i.test(gpu)) {
      html += row('⚠', '软渲染，帧率不代表真机');
    }

    if (loads.length || loadReadyAt != null) {
      html += '<div class="ph-sep"></div><div class="ph-k">加载时间线</div>';
      for (const l of loads) {
        html += row(l.name, `+${fmt(l.t - BOOT_T)}ms`);
      }
      if (loadReadyAt != null) {
        html += row('▶ 上货条满', `+${fmt(loadReadyAt - BOOT_T)}ms`, 'ph-ok');
      }
    }

    // 运行期事件单独一块，不与加载时间线混（否则 N/Y 重玩几次就把时间线挤掉了）
    if (runtimeMarks.length) {
      html += '<div class="ph-sep"></div><div class="ph-k">运行期事件（不计入加载）</div>';
      for (const m of runtimeMarks) {
        const dt = fmt(m.t - BOOT_T);
        html += row(m.name, `${m.count > 1 ? `×${m.count}  ` : ''}+${dt}ms`);
      }
    }

    body.innerHTML = html;
  }

  // 每 200ms 刷一次文本；帧统计每帧累计但不碰 DOM
  setInterval(() => { if (enabled) paint(); }, 200);

  function dispose() {
    root.remove();
  }

  // URL 打开：?perf=1 / ?gui=1 / ?dev=1 都算开发模式
  const q = new URLSearchParams(url ?? location.search);
  const wantOpen = q.has('perf')
    ? q.get('perf') !== '0'
    : (q.has('gui') && q.get('gui') !== '0') || (q.has('dev') && q.get('dev') !== '0');
  if (wantOpen) setVisible(true);

  return { setVisible, toggle, setMsaaSamples, mark, markRuntime, setLoadReady, beginFrame, endUpdate, endRender, dispose, get enabled() { return enabled; } };
}
