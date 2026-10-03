// ============================================================
// 分幕数据（outline 三~四章的代码化，文案/时长都在这改，不动引擎）
//
// 每幕字段：
//   label   幕标题卡          layout  画幅位 right/center/wide
//   viewportShape  可选 circle（圆形 clip，一二幕试镜）
//   control 输入权限           tuning  幕间爪力曲线（难度旋钮）
//   quest   任务物品 id        hint    底部操作提示（null=隐藏）
//   script  步骤序列：
//     { sub, dur }            底部字幕，dur 秒
//     { panel, side, text, dur? }  漫画旁白框；text:'' 收起；无 dur 常驻
//       continue + continueAfter：先只显示本侧，点击该框或到时再往下走（也可派发 window 事件 narrative:continue）
//       hideAfter：本步结束后收起，避免左右同时占屏
//     { hint }                改底部提示
//     { pause, dur }          留白，dur 秒
//     { wait: 事件名 }         等待事件：firstView / allViews / firstCollect / questComplete / cinemaWidened
//     { synthesis }           四幕合成演出
//     { glitch, image? }      终幕故障转场；省略 image 则仅音画故障/黑场，不叠概念图
//     { interstitial, image, dur?, fadeIn?, fadeOut?, dipBefore?, dipAfter? }
//       实现 narrativeBg.showInterstitial；导演 #run 顺序执行 script
//       闪回后旁白卡顿：多为淡出后再 _runDip（见 present.transition.interstitialDipAfter）
//     { revealBeat, line, image?, dur? }
//     { reveal }              尘屑过渡 + Marble（main onRevealTransition）
//     { stinger }             终幕手写体收尾 + 八音盒彩蛋钩子
//   backdrop  幕背景（narrativeAssets 键名）
//   hudDecor  第三幕配额 HUD 装饰（如 rationWall）
// ============================================================

export const DEFAULT_HINT = '←→↑↓ / WASD 移动 · 空格 落爪 · 1/2/3 视角 · Q/E 循环 · H 参数面板';

// 试玩：http://127.0.0.1:8000/?act=3（devServer 根即 prototype，无需 /prototype）；终幕 Y 再玩一次

export const ACTS = [
  {
    id: 1, label: '第一幕 · 引子', layout: 'right', backdrop: 'act1', viewportShape: 'circle',
    control: { move: false, drop: false, view: true },
    zoom: 0.95,   // 幕级变焦；near 模式再 ×0.7 → 有效 0.67，贴近玻璃柜的近景
    framing: 'near',   // 右布局必须 near（投影绑定画幅中心；far 不绑定会只露个边）
    hint: '按 1 / 2 / 3（或 Q / E）转动视线，看看柜子里。',
    script: [
      { type: 'sub', text: '资源枯竭纪元 21 年。', dur: 3 },
      { type: 'sub', text: '配给制度崩坏，人们靠"采集"活下去。', dur: 4 },
      { type: 'panel', side: 'left', text: '他还记得那台机器。\n那时候，食物是装在玻璃柜里的。', dur: 4.5 },
      { type: 'wait', event: 'firstView' },
      { type: 'sub', text: '左边……右边……都一样。都是吃的。', dur: 4 },
      { type: 'wait', event: 'allViews' },
    ],
  },
  {
    id: 2, label: '第二幕 · 学会抓取', layout: 'center', backdrop: 'act2', viewportShape: 'circle',
    control: { move: true, drop: true, view: true },
    framing: 'far',   // 中远景站远抓（首版构图）；V 键可切 near 凑近看
    tuning: { gripStrength: 1.0, baseSlipProb: 0 },   // 教学：首抓必成
    hint: DEFAULT_HINT,
    script: [
      { type: 'panel', side: 'left', text: '移动爪子。\n对准。', continue: true, continueAfter: 3.4, hideAfter: true },
      { type: 'panel', side: 'right', text: '按下空格。\n落爪。' },
      { type: 'wait', event: 'firstCollect' },
      { type: 'panel', side: 'right', text: '' },
      { type: 'interstitial', image: 'flashback', dur: 3.2, fadeIn: 0.85, fadeOut: 1.0 },
      { type: 'panel', side: 'left', text: '成功了。\n他和妹妹分着吃。', dur: 4 },
    ],
  },
  {
    id: 3, label: '第三幕 · 采集任务', layout: 'center', backdrop: 'act3', hudDecor: 'rationWall',
    control: { move: true, drop: true, view: true },
    tuning: { gripStrength: 0.78, baseSlipProb: 0.45, decayPerGrab: 0.06 },  // 爪力开始不稳
    // 兜底：连续失败 streak 次后每次回升抓力；进幕 forceAfterSeconds 秒后抓到即成、不滑
    pity: { streak: 2, gripStep: 0.08, slipStep: 0.06, forceAfterSeconds: 90 },
    quest: ['bread', 'can', 'veg'],
    // 配额按标签记账，不看外观：发霉方块也算面包，锈罐也算罐头
    questAccepts: {
      bread: ['bread', 'moldy'],
      can: ['can', 'rustcan'],
      veg: ['veg', 'rot', 'apple'],
    },
    restockPool: true,   // 第二幕抓走的面包等补回池里
    questCopy: {
      right: { bread: '面包，入账。', can: '罐头。', veg: '青菜。' },
      dup: '……这一样够了。',
      wrong: '……这不是今天的配额。',
      wrongJunk: '垃圾也进洞了。不算数。',
    },
    hint: DEFAULT_HINT,
    script: [
      { type: 'panel', side: 'left', text: '配额写在墙上了。\n今天也是三样。', continue: true, continueAfter: 3.6, hideAfter: true },
      { type: 'panel', side: 'right', text: '抓够之前，\n别去想机器外面是什么。' },
      { type: 'wait', event: 'questComplete' },
      { type: 'sub', text: '……齐了。今天能吃了。', dur: 2.5 },
    ],
  },
  {
    id: 4, label: '第四幕 · 拼凑一顿饭', layout: 'center', backdrop: 'synthesis',
    control: { move: false, drop: false, view: false },
    hint: null,
    menu: { cards: ['面包', '罐头', '蔬菜'], line: '今日菜单\n面包汤 · 罐头 · 烫青菜' },
    script: [
      { type: 'panel', side: 'left', text: '' },
      { type: 'panel', side: 'right', text: '' },
      { type: 'synthesis' },
      { type: 'pause', dur: 2 },
      { type: 'sub', text: '那天他们吃得很好。', dur: 3.4 },
      { type: 'pause', dur: 1.2 },
      { type: 'sub', text: '他一直是这么记的。', dur: 3.6 },
      { type: 'pause', dur: 1.2 },
    ],
  },
  {
    id: 5, label: '', layout: 'center', backdrop: 'ambient', backdropAfter: 'glitch',
    control: { move: false, drop: false, view: false },
    framing: 'far',
    hint: null,
    script: [
      { type: 'glitch' },
      { type: 'revealBeat', dur: 3.4, line: '手心里只有一罐。' },
      // 记忆里的机器先消失，破碎房间单独露出来，再进入房间本身的溶解。dir:'in' 可反向出现。
      { type: 'fadeMachine', dur: 2.6 },
      { type: 'pause', dur: 1.2 },
      { type: 'reveal' },
      { type: 'wait', event: 'cinemaWidened' },
      { type: 'pause', dur: 1.5 },
      { type: 'stinger', text: 'Demo 结束。他今天吃了什么？' },
    ],
  },
];
