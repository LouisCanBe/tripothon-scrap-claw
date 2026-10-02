import { DEFAULT_COLLECT_PAIR } from './collectPairDefault.js';

// ============================================================
// 《拾荒娃娃机》灰盒原型 · 全局参数中枢
// 所有手感 / 镜头 / 后处理参数集中在此。
// 运行时按 H 打开调参面板实时修改；每个参数的含义、
// 建议范围与"调大/调小会怎样"见 PARAMS.md。
// ============================================================

export const CONFIG = {
  // 叙事概念图组：'cursor' 写实摄影 | 'seedream' 厚涂；URL ?art=cursor 可临时覆盖
  narrativeSet: 'cursor',

  // —— 呈现 / TA（底图与 3D 统一镜头感，见 present.js）——
  present: {
    grainOpacity: 0.052,
    marginVignette: 0.58,
    narrativeKenBurns: true,
    // 前几幕：概念图只在方框视口内；方框外黑底。16:9 概念图直接作 scene.background（见 main.js）
    backdropInViewport: true,
    backdropAsSceneBackground: true,
    sceneBackgroundIntensity: 0.92,
    acts: {
      default: { imgFilter: 'saturate(0.88) contrast(1.05) brightness(0.9)', shade: 'default', kenBurns: true },
      1: {
        moodClass: 'memory',
        imgFilter: 'sepia(0.14) saturate(0.86) contrast(1.08) brightness(0.88)',
        shade: 'memory',
        sceneBackgroundIntensity: 0.78, // 干净回忆柜偏白，略压暗（换图后可只改这一格）
      },
      2: {
        imgFilter: 'saturate(0.82) contrast(1.06) brightness(0.86)',
        shade: 'default',
      },
      3: {
        imgFilter: 'saturate(0.7) contrast(1.12) brightness(0.8) hue-rotate(-6deg)',
        shade: 'harsh',
      },
      4: {
        imgFilter: 'sepia(0.2) saturate(0.95) contrast(1.04) brightness(0.94)',
        shade: 'warm',
      },
      5: {
        imgFilter: 'saturate(0.62) contrast(1.1) brightness(0.76) hue-rotate(-12deg)',
        shade: 'cold',
        kenBurns: false,
      },
    },
    shadeGradients: {
      default:
        'radial-gradient(ellipse 92% 88% at 50% 48%, transparent 42%, rgba(0,0,0,.38) 100%)',
      memory:
        'radial-gradient(ellipse 94% 90% at 52% 46%, transparent 40%, rgba(12,8,6,.42) 100%)',
      harsh:
        'radial-gradient(ellipse 90% 86% at 50% 50%, transparent 38%, rgba(0,0,0,.48) 100%)',
      warm:
        'radial-gradient(ellipse 92% 88% at 50% 48%, transparent 42%, rgba(16,10,8,.36) 100%)',
      cold:
        'radial-gradient(ellipse 94% 90% at 50% 50%, transparent 36%, rgba(0,0,0,.52) 100%)',
    },
    // viewportEdge=square 且概念图在视口内时：直角线性暗角，不用椭圆
    shadeGradientsSquare: {
      default: 'transparent',
      memory: 'transparent',
      harsh: 'transparent',
      warm: 'transparent',
      cold: 'transparent',
    },
    transition: {
      backdropMs: 1100,
      backdropDip: 0.48,
      interstitialFadeIn: 0.72,
      interstitialFadeOut: 0.9,
      interstitialDip: 0.52,
      interstitialDipAfter: false, // 闪回图淡出后不再黑场顿挫（旁白紧接）
    },
    post: { warmth: 0.06, chroma: 0.32, saturation: 1.02 },
    actPost: {
      1: { warmth: 0.12, chroma: 0.38 },
      3: { warmth: -0.04, chroma: 0.48, satMul: 0.94 },
      4: { warmth: 0.16, chroma: 0.28, satMul: 1.04 },
      5: { warmth: -0.08, chroma: 0.42, satMul: 0.9 },
    },
  },

  claw: {
    // —— 水平移动（惯性手感核心）——
    moveSpeed: 1.7,          // 目标点移动速度（单位/秒）
    moveTau: 0.09,           // 爪子追踪目标的时间常数(秒)；稳定时间≈2τ → outline 要求的 100~200ms 惯性
    boundsX: [-1.35, 1.35],  // 爪子可达范围（水平）
    boundsZ: [-0.90, 0.90],  // 爪子可达范围（前后）

    // —— 落爪时序（紧张感核心；落下后输入锁死、不可取消）——
    restY: 1.55,             // 待机/巡移高度（逻辑见 restYBase）
    dropSpeed: 2.4,          // 下落速度
    liftSpeed: 1.35,         // 上升速度（比下落慢 → 悬心感）
    closeDelay: 0.18,        // 到底→合爪的停顿（屏息感）
    closeDuration: 0.42,     // 合爪动画时长
    afterGrabPause: 0.14,    // 合爪完成→上升的停顿
    returnTau: 0.12,         // 回收移动时间常数（比巡移更钝 → 机械感）

    // —— 爪力与滑落（难度旋钮核心）——
    gripStrength: 0.85,      // 全局爪力 0~1；p(抓住) = gripStrength × item.gripFactor
    baseSlipProb: 0.38,      // 滑落权重；p(上升中滑落) = baseSlipProb × (1 - gripStrength × gripFactor)
    grabRadius: 0.75,        // 合爪判定半径；≈ grabRadiusBase × pool.visualScale
    grabRadiusBase: 0.30,
    // 垂直（米）：grabY/hang 只跟爪 meshVisualScale；grabRadius 跟 pool.visualScale
    grabY: 0.80,             // 落爪停高度（claw 组 y）；灰盒尖深≈tipDepthBase → 尖近池底
    grabYBase: 0.50,
    restYBase: 1.55,
    tipDepthBase: 0.53,      // 灰盒爪尖相对 crown 的向下伸出（× meshVisualScale）
    hangOffsetBase: 0.52,    // 抓住时奖品在爪尖下（× meshVisualScale）
    deliverDropBase: 0.75,
    meshVisualScale: 1.0,    // 爪模型展示倍率（≠ pool.visualScale）
    useLambertMaterials: true, // 爪组用 Lambert，切断 IBL 镜面闪
    envMapIntensity: 0,        // 若仍用 Standard 时环境反射
    metalRoughness: 0.88,
    metalness: 0.12,
    comicFx: {
      enabled: false,
      useOutline: true,        // false = 仅 Toon 色阶，不描边（分件仍怪时可关）
      outline: 0.018,          // 分件多，略薄于奖池默认 0.028
      outlineColor: 0x141210,
    },
    wobbleAmp: 0.022,        // 上升途中奖品抖动幅度（滑落预兆演出）
    wobbleFreq: 9.0,         // 抖动频率

    // —— 洞口 / 待机点 ——
    home: [-1.12, 0.82],     // 待机点 = 洞口上方 [x, z]
    holePos: [-1.12, 0.82],
    holeRadius: 0.24,
  },

  // —— AI 生成爪（Tripo 分件模型）——
  // 判定/状态机不变，只替换视觉；加载失败自动回退 procedural 爪。
  // 分件归属用浏览器染色法确认：staticParts 不动；prongGroups 同组共享一个开合关节。
  machineShell: {
    useTripo: true,          // 全套 Cursor 四视图 + P1 multiview。灰盒 ?machineShell=proc
    // 缺文件时自动跳过，保留 machineShell 灰盒；URL ?machineShell=proc 强制灰盒
    // Blender 里已经摆好的外壳（含挖过的底座）。有这个文件就按原位装入，不再套槽位缩放。
    placedShell: 'assets/machine/placed/shell.glb',
    partIds: ['machine_base', 'machine_frame', 'machine_top', 'machine_panel'],
  },

  clawGLB: {
    useTripoGLB: true,       // 仓库 8 分件版（part_0..7）；失败回退灰盒三爪
    requireProngCount: 3,
    url: 'assets/machine/claw_parts.glb',
    scale: 0.58,
    scaleWithPrize: 1.15,    // 略放大以配合 2.5× 娃娃，勿与 meshVisualScale 叠乘过大
    offsetY: -0.24,        // 缩放后整体下移：顶盖≈+0.05 接吊缆，爪尖≈-0.53
    staticParts: ['tripo_part_0', 'tripo_part_2', 'tripo_part_5', 'tripo_part_7'],
    prongGroups: [         // 三条爪臂；part_6 小关节贴在前臂上，同组随动
      ['tripo_part_1', 'tripo_part_6'],
      ['tripo_part_3'],
      ['tripo_part_4'],
    ],
    attachY: -0.14,        // 关节高度（模型单位）= 各臂顶端的 y
    attachR: 0.15,         // 关节到轴心的径向距离（臂根内缘）
    rotationY: 1.5708,     // 整体绕 Y 旋转（rad）：生成模型的臂朝前，转 90° 让正视角看到剪刀式开合
    openAngle: 0.0,        // 生成姿态即张开姿态
    closeAngle: -0.50,     // 闭合：绕关节向内收（负=向内）
  },

  camera: {
    fov: 78,                 // 广角，outline 建议 70~85
    tau: 0.38,               // 呼吸/变焦等阻尼
    viewTau: 0.48,           // 左/前/右 机位插值（略慢更顺、减穿模感）
    viewHandoffDist: 0.12,   // 数字键经正面中转：到正面多近后切到目标侧
    breathDeg: 0.25,         // 呼吸晃动幅度(度)，outline 上限 <0.3°
    breathFreq: 0.22,        // 呼吸频率(Hz)
    userZoomMin: 0.55,       // 滚轮/双指缩放的最近倍率（防止钻进机器内部）
    userZoomMax: 1.6,        // 最远倍率
    views: {
      front: { pos: [ 0.00, 2.05, 3.15], look: [ 0.0, 0.30, -0.05] },
      // 左右：更靠侧面（|x|↑、z↓），look 略向机柜中心偏，切换后以侧视为主
      left:  { pos: [-2.85, 1.92, 1.22], look: [ 0.26, 0.30, -0.02], distanceScale: 1.1 },
      right: { pos: [ 2.85, 1.92, 1.22], look: [-0.26, 0.30, -0.02], distanceScale: 1.1 },
    },
  },

  post: {
    k1: 0.12,                // 鱼眼一阶（fisheye 视口缘；square 时由 frameEdge 关）
    k2: 0.048,               // 鱼眼二阶系数
    grain: 0.02,            // 胶片颗粒强度
    vignette: 0.55,          // 暗角强度（fisheye 视口缘）
    vignetteSquare: 0,       // square：关径向暗角（与桶形畸变一起关）
    bloom: 0.32,             // 泛光强度（0=关；只让灯带/高光晕开，画面不糊）
    bloomThreshold: 0.8,     // 泛光亮度阈值：只有比它亮的才晕（0.72 时金属爪会晕开）
  },

  // —— 主场景灯光（定版：ambient+半球+主光+补光，无机内点光；见 LIGHTING.md）——
  lights: {
    ambient: { color: 0xfff6ee, intensity: 0.38 },
    hemi: { sky: 0xfff2dd, ground: 0x2a2830, intensity: 0.72 },
    key: {
      color: 0xffe7c4,
      intensity: 0.72,         // 柔主光，避免白模/金属直射高光
      position: [2.5, 4, 3],
      shadowHalf: 2.6,
      shadowNear: 1,
      shadowFar: 12,
      shadowBias: -0.002,
      shadowNormalBias: 0.02,
    },
    fill: {
      color: 0xe8eeff,
      intensity: 0.48,
      position: [-2.2, 2.8, -2.0], // 对侧冷补光，抬暗部、不聚光
    },
    glow: {
      color: 0xffd9a0,
      intensity: 0,              // 默认关；四幕合成可短暂拉高（导演）
      distance: 7,
      decay: 1.8,
      position: [0, 1.85, 0.35],
    },
    revealCold: {
      keyColor: 0xa8b8cc,
      keyIntensity: 0.35,
      hemiIntensity: 0.15,
      ambientIntensity: 0.08,
      fillIntensity: 0.48,
      fillMul: 0.35,
      envMul: 0.35,
    },
  },

  // —— 渲染质感（阴影 / 色调映射 / 环境光）——
  render: {
    shadows: true,           // 阴影总开关（关了回到平板光）
    shadowMapSize: 2048,     // 阴影贴图尺寸（移动端自动减半）
    exposure: 1.18,          // 定版全局照：略提曝光补偿无点光
    envIntensity: 0.58,      // IBL 全局补亮（配合 ambient/半球，少镜面闪）
  },

  frame: {
    squareFill: 0.88,        // 1:1 画幅占窗口短边比例
    wideFill: 0.94,          // 16:9 画幅占窗口宽比例
    transitionSec: 1.15,     // 画幅展开时长（需与 index.html 的 CSS transition 一致）
    fisheyeFadeOnWide: true, // 展开 16:9 时鱼眼同步消退（"梦醒了"的镜头语言）
    nearZoom: 0.7,           // near 取景的变焦倍率（有效变焦 = 幕zoom × 此值；far=1）
    // 视口内缘：fisheye=椭圆暗角（偏鱼眼桶形）| square=纯直角 clip，无叠层暗角
    viewportEdge: 'fisheye', // URL ?frameEdge=fisheye|square 可覆盖
    viewportFeatherPx: 14,   // fisheye：#frameBorder 外扩 px，盖住 clip 锯齿（14 比 5 更顺）
    circleScale: 0.94,       // 圆形视口：内接于布局矩形的直径比例（acts.viewportShape=circle）
    // 视口内缘 CSS 暗角（#frameBorder，不是 post.k1 桶形畸变；H「视口缘」）
    fisheyeVigEllipseX: 1.58,  // 椭圆水平 158%
    fisheyeVigEllipseY: 1.42,  // 椭圆垂直 142%
    fisheyeVigInner: 0.20,     // 透明区半径比例 0~0.5
    fisheyeVigOpacity: 1.0,    // 叠层整体不透明度
    edgeVignette: true,      // 已废弃：false 等同 viewportEdge:'square'
    photoBorder: false,      // true = 旧照片白框（与 fisheye 叠层互斥）
    borderWidth: 6,
    borderColor: 'rgba(236,232,220,0.94)',
    centerWidthFrac: 0.56,   // 居中幕视口宽（高=满屏）
    rightWidthFrac: 0.58,
    rightMargin: 0.03,
    chromeIdleMs: 5200,      // 底部指示层无操作后变淡
    chromeDimOpacity: 0.24,
    viewportCoverPad: 2,     // 描边/内遮罩相对 clip 外扩 px（压住边缘抗锯齿漏缝）
    questPulseColor: 'rgba(220,216,200,0.32)', // 配额完成等：勿用全屏 #fff
    glitchFlashMax: 0.42,    // 终幕 glitch #flash 最高不透明度（只黑闪，不白屏）
  },

  pool: {
    boundsX: [-1.30, 1.30],
    boundsZ: [-0.85, 0.85],
    boundsWallMargin: 0.06,  // 按娃娃足迹 clamp 时额外留白（防穿模）
    // 奖品视觉体量：槽位尺寸来自 prizePool PRIZE_TABLE[].collider，再乘此系数（GLB 走 normalizeGLB 同倍率）
    glbSet: 'good-p2',       // good-p2 | good | legacy；manifest 空时自动回退下一套
    visualScale: 2.5,
    // Tripo 娃娃若横躺：绕 X 额外旋转（弧度），与 Hub 预览里手动摆正同理，默认 0 等你验证后再调
    glbExtraRotX: 0,

    // 漫画渲染（与 tools/ui.html「漫画渲染」同参，只作用于奖池 mesh）
    comicFx: {
      enabled: true,
      outline: 0.028,
      outlineColor: 0x141210,
      exposure: 1.15,
      keyIntensity: 1.35,
      envIntensity: 0.12,
    },
    // 奖池底「堆娃娃」装饰：不进 PRIZE_TABLE，不参与抓取
    decor: {
      enabled: true,
      count: 48,
      rimCount: 22,
      sizeMul: 1.48,
      scaleMin: 0.68,
      scaleMax: 1.62,        // 单件尺寸随机区间（差别更大）
      edgeInner: 0.68,       // 越大越贴墙
      maxStackY: 0.26,
      avoidHoleRadius: 0.5,
      minSpacing: 0.085,
      settleIterations: 16,
      physics: {
        iterations: 3,
        iterationsIdle: 1,
        prizePush: 0.72,
        prizeMoveThreshold: 0.004,
        clawPush: 0.38,
        clawInfluenceRadius: 0.24,
        damping: 6.5,
        decorStiffness: 0.38,
        decorStiffnessIdle: 0.2,
        sleepVelocity: 0.018,
      },
    },
    // 可抓奖品互挤（远弱于装饰）
    prizePhysics: {
      enabled: true,
      stiffness: 0.06,
      rest: 0.01,
      maxStepPerFrame: 0.003,
      iterations: 1,
      radiusMul: 0.86,
    },
  },

  // 终幕 Marble：mode 'pano' = 仅全景（与工具台 PNG 一致）；'immersive' = SPZ + collider 边界 + WASD
  reveal: {
    mode: 'pano',
    pano: 'design/concepts/reveal-ruins-wide-scrapyard-cursor-photo-16x9.png',
    colliderGlb: 'assets/worlds/reveal-draft-collider.glb',
    spz: 'assets/worlds/reveal-draft-100k.spz',
    boundsMargin: 0.45,        // AABB 内缩（越大越不容易贴到盒边）
    collisionSkin: 0.35,       // 沿 collider 网格射线阻挡的留白（米）
    showBoundsHelper: false,   // true：显示 collider 包围盒线框，核对是否贴 SPZ
    moveSpeed: 4,              // immersive 行走速度（sceneControls.moveSpeed）
    backgroundIntensity: 1.0,
    yawOffset: 0,              // 全景与机位朝向对不齐时微调（弧度）
    lookSensitivity: 0.005,    // 与 Marble 工具台默认一致
    keyLookSpeed: 1.8,         // 仅 keyboardLook:true 时生效
    pitchMin: -1.45,
    pitchMax: 1.45,
    fov: 78,
    // 终幕相机能力开关（SceneControls.features，见 sceneControls.js）
    controls: {
      pointerLook: true,       // 画布拖拽环视（与 world.html pano 相同）
      moveWalk: false,         // pano 模式请保持 false；immersive 会在 onReveal 里改成 fpsWalk
      moveVertical: true,      // immersive 会强制开启；pano 下无效
      keyboardLook: false,     // false = WASD 不转视角（工具台全景 likewise）
      wheelFov: true,
      wheelOrbitDist: false,
      modeToggle: false,
    },
  },

  // —— 出货独立展示屏（display.html）——
  collectDisplay: {
    enabled: true,
    channel: 'tripo.collect-display.v1',
    displayPath: '/display.html',
    shareFrame: true,          // 扫码/复制链接用 display-frame.html（相框副屏）
    // 相框固定打开 frame.path。介绍词只改 copy，两个副屏一起变。
    copy: {
      kicker: 'COLLECT DISPLAY',
      waiting: '等待出货…',
      statusIdle: '先开主游戏或先开本页均可；配对一致即可联动出货',
      cta: '营销位预留 · 可按 prizeId 接文案/链接/视频',
    },
    frame: {
      path: '/display-frame.html',
      // 示例校准。上这台相框前改成机背标签的 Pitch / Offset，Tan 保持 10。
      // 地址可临时覆盖：?pitch= &offset= &tan= ；现场用 /frame-calibrate.html 从电脑推送
      // 笔记本检查用 ?mode=2d
      pitch: 0.27777,
      tan: 10,
      offset: 2,
      views: 30,               // 停稳后的清晰档。下落和拖拽会临时降到 9 眼
      viewWidth: 1200,         // 停稳后每一眼拉满。运动时临时用 640
      viewSpacing: 0.02,       // 立体强度。想接近 APK 再调到 0.04
      focusDistance: 2.5,
      spin: 0,                 // 0 不自转，在相框上左右拖动旋转
      fit: 0.7,                // 相对竖屏可视宽度。1 会贴到左右边
      room: '/assets/frame/WhiteSpace_Portrait_1200x1920.glb',
    },
    // 跨设备：devServer SSE（见 tools/collectDisplayHub.mjs）
    transport: 'auto',         // 'local' 仅同机 | 'lan' 副屏必走 SSE | 'auto' 主屏 publish + display 订阅
    pairId: DEFAULT_COLLECT_PAIR, // 固定配对口令；URL ?pair= 可覆盖
    ssePath: '/api/collect/stream',
    publishPath: '/api/collect/publish',
    statusPath: '/api/collect/status',
    pingPath: '/api/collect/ping',
    pairingEnabled: false,     // 预留：副屏出码、平板扫
    pairQrFromActId: 3,        // 主屏从第几幕起显示可折叠配对码（与第三幕 HUD 同期）
    outletKind: 'hole',        // 语义：出货口类型；副屏可读 payload.outlet
    holeFloorY: -0.30,         // delivering 落至此以下视为离屏（与 clawMachine 同步）
    // 副屏入场动效（displayMain + collectDisplayEntrance.js，指数阻尼无额外依赖）
    entrance: {
      preset: 'dropFromAbove', // 'none' | 'dropFromAbove' | 'fadeScale'
      dropHeight: 2.35,
      gravity: 16,
      fallVariation: 0.07,     // 每次出货：重力/高度 ±7%（可关：0）
      initialVySpread: 0.15,   // 初速度上下轻微随机（米/秒量级）
      bounceCount: 2,
      // bounceCountRandom: [1, 3],
      bounceRestitution1: 0.44,
      bounceRestitution2: 0.2,
      bounceRestitutionFurther: 0.12,
      impactVyMin: 0.28,
      coastTauY: 0.09,
      coastTauVy: 0.11,
      tumbleDuringDrop: true,
      tumbleTau: 0.38,
      floorAnchorTau: 0.07,    // 近地时底面对齐展台（消倾斜压平时的视觉跳）
      floorAnchorBand: 0.22,
      idleSpin: 0.85,
      spinDuringEntrance: 0.22,
      spinBlendTau: 0.4,       // 入场结束 → idle 自转速度平滑过渡
      comicFx: true,
      outline: 0.022,
    },
    // 材质弹力预设：与 entrance 合并；见 collectBouncePresets.js、PRIZE_TABLE.bounceMaterial
    defaultBounceMaterial: 'plastic',
    // itemBounceMaterial: { bread: 'soft' },  // 可选，覆盖表内未标材质时按 id 指定
    // categoryBounceMaterial: { junk: 'metal' },
    bouncePresets: {
      plastic: {},
      soft: {
        bounceRestitution1: 0.52, bounceRestitution2: 0.28, gravity: 14.5,
      },
      rubber: {
        bounceRestitution1: 0.5, bounceRestitution2: 0.25, gravity: 15,
      },
      metal: {
        bounceRestitution1: 0.3, bounceRestitution2: 0.1, bounceCount: 1, gravity: 18,
      },
      glass: {
        bounceRestitution1: 0.36, bounceRestitution2: 0.12, gravity: 17,
      },
      ceramic: {
        bounceRestitution1: 0.34, bounceRestitution2: 0.1, bounceCount: 1, gravity: 18,
      },
      cloth: {
        bounceRestitution1: 0.48, bounceRestitution2: 0.24, gravity: 13,
      },
      stone: {
        bounceRestitution1: 0.26, bounceRestitution2: 0.07, bounceCount: 1, gravity: 19,
      },
    },
  },

  // —— 触屏/低性能设备防护（iPad/手机防崩）——
  mobile: {
    maxPixelRatio: 1.5,      // 触屏设备渲染分辨率上限（Retina ×2 全分辨率 + 后处理极易爆显存）
    maxTextureSize: 1024,    // 触屏设备贴图降尺寸上限（Tripo GLB 可能带 2K/4K 贴图，16 件解码后显存上 GB）
    glbConcurrency: 3,       // 触屏设备 GLB 并行加载数（同时 16 个会内存尖峰）；桌面端不限
  },
};
