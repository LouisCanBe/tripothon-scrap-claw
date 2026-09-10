// ============================================================
// 《拾荒娃娃机》灰盒原型 · 全局参数中枢
// 所有手感 / 镜头 / 后处理参数集中在此。
// 运行时按 H 打开调参面板实时修改；每个参数的含义、
// 建议范围与"调大/调小会怎样"见 PARAMS.md。
// ============================================================

export const CONFIG = {
  claw: {
    // —— 水平移动（惯性手感核心）——
    moveSpeed: 1.7,          // 目标点移动速度（单位/秒）
    moveTau: 0.09,           // 爪子追踪目标的时间常数(秒)；稳定时间≈2τ → outline 要求的 100~200ms 惯性
    boundsX: [-1.35, 1.35],  // 爪子可达范围（水平）
    boundsZ: [-0.90, 0.90],  // 爪子可达范围（前后）

    // —— 落爪时序（紧张感核心；落下后输入锁死、不可取消）——
    restY: 1.55,             // 待机/巡移高度
    grabY: 0.50,             // 下抓到底高度（爪尖刚好触地）
    dropSpeed: 2.4,          // 下落速度
    liftSpeed: 1.35,         // 上升速度（比下落慢 → 悬心感）
    closeDelay: 0.18,        // 到底→合爪的停顿（屏息感）
    closeDuration: 0.42,     // 合爪动画时长
    afterGrabPause: 0.14,    // 合爪完成→上升的停顿
    returnTau: 0.12,         // 回收移动时间常数（比巡移更钝 → 机械感）

    // —— 爪力与滑落（难度旋钮核心）——
    gripStrength: 0.85,      // 全局爪力 0~1；p(抓住) = gripStrength × item.gripFactor
    baseSlipProb: 0.38,      // 滑落权重；p(上升中滑落) = baseSlipProb × (1 - gripStrength × gripFactor)
    grabRadius: 0.30,        // 合爪判定半径（水平距离）
    wobbleAmp: 0.022,        // 上升途中奖品抖动幅度（滑落预兆演出）
    wobbleFreq: 9.0,         // 抖动频率

    // —— 洞口 / 待机点 ——
    home: [-1.12, 0.82],     // 待机点 = 洞口上方 [x, z]
    holePos: [-1.12, 0.82],
    holeRadius: 0.24,
  },

  camera: {
    fov: 78,                 // 广角，outline 建议 70~85
    tau: 0.38,               // 视角切换时间常数(秒)
    breathDeg: 0.25,         // 呼吸晃动幅度(度)，outline 上限 <0.3°
    breathFreq: 0.22,        // 呼吸频率(Hz)
    views: {
      front: { pos: [ 0.00, 2.05, 3.15], look: [ 0.0, 0.30, -0.05] },
      left:  { pos: [-2.25, 1.95, 2.30], look: [ 0.1, 0.30, -0.05] },
      right: { pos: [ 2.25, 1.95, 2.30], look: [-0.1, 0.30, -0.05] },
    },
  },

  post: {
    k1: 0.10,                // 鱼眼一阶系数（边缘约 10% 畸变；若呈枕形把符号取反）
    k2: 0.04,                // 鱼眼二阶系数
    grain: 0.055,            // 胶片颗粒强度
    vignette: 0.55,          // 暗角强度
  },

  frame: {
    squareFill: 0.88,        // 1:1 画幅占窗口短边比例
    wideFill: 0.94,          // 16:9 画幅占窗口宽比例
    transitionSec: 1.15,     // 画幅展开时长（需与 index.html 的 CSS transition 一致）
    fisheyeFadeOnWide: true, // 展开 16:9 时鱼眼同步消退（"梦醒了"的镜头语言）
  },

  pool: {
    boundsX: [-1.30, 1.30],
    boundsZ: [-0.85, 0.85],
  },
};
