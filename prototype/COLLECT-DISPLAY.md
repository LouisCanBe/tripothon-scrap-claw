# 出货独立展示屏

主游戏与副屏 **解耦**：通过事件总线同步，副屏只做呈现（后续可接动销）。

## 打开方式

```text
主游戏：http://127.0.0.1:8000/
副屏：  http://127.0.0.1:8000/display.html
```

同机第二显示器 / 第二浏览器窗口即可。控制台：`__debug.openCollectDisplay()`。

副屏布局：**整页锁在视口内**（`overflow: hidden` + `100dvh`），Three 只渲染中间 `#stage` 区域，无整页垂直滚动。

## 判定时机（与洞口形状无关）

| 事件 `type` | 时机 | 副屏行为 |
|-------------|------|----------|
| `collect.hole_drop` | 洞口松手，`delivering` 开始下落 | 「出货中…」+ **预加载 GLB** |
| `collect.vended` | 落至出货平面以下、主场景隐藏奖品 | **从上落入展台**并展示（3D/占位） |

出货平面 Y 与洞口几何解耦，改 `config.collectDisplay.holeFloorY`（主逻辑在 `clawMachine` 的 `delivering` 落点）。

## 配置 `config.collectDisplay`

- `enabled`：总开关
- `channel`：BroadcastChannel 名
- `displayPath`：副屏路径
- `outletKind`：`'hole'`（未来可 `slot` / `chute` 等，payload 带给副屏）
- `entrance`：副屏 3D 入场（`dropHeight` / `gravity` / `bounceCount` / `bounceRestitution1|2` / `idleSpin` 等，见 `config.js`）
- 回弹：默认 **2 下**（第二下更小）；可开 `bounceCountRandom: [1, 3]` 每次随机抖动次数
- 下落：`fallVariation` / `initialVySpread` 让每次出货略快略慢；也可用 `gravityRandom` / `dropHeightRandom` 绝对区间

调参：副屏 F12 可改 `__display.CONFIG.collectDisplay.entrance` 后刷新；与主游戏共用 `config.js`。

## 材质弹力预设（分类 → 回弹差异）

每件娃娃可标 `bounceMaterial`（见 `PRIZE_TABLE`），副屏入场时与 `entrance` 合并：

| 预设 id | 体感 | 主要覆盖字段 |
|---------|------|----------------|
| `soft` | 软、弹得高 | 高 restitution、略轻 `gravity` |
| `rubber` / `plastic` | 中性 | 默认或略调 |
| `metal` / `stone` / `ceramic` | 沉、少弹 | 低 restitution、常 `bounceCount: 1`、大 `gravity` |
| `glass` | 脆、第二下更小 | 中等 restitution |
| `cloth` | 轻、蓬 | 偏高 restitution、低 `gravity` |

解析顺序：`prize.bounceMaterial` → `itemBounceMaterial[id]` → `categoryBounceMaterial` → `defaultBounceMaterial`。  
表与数值：`collectBouncePresets.js`、`config.collectDisplay.bouncePresets`。总线 payload 带 `bounceMaterial` 供副屏/动销扩展。

## 技术

- `collectDisplayBus.js`：BroadcastChannel + `localStorage` 最后一条（副屏晚开可恢复）
- `display.html` + `displayMain.js`：独立 Three 场景；`collectDisplayEntrance.js` 入场
- 双物体重叠：已用 `showGeneration` 取消过期 GLB 加载；旋转只作用 `spinGroup`，模型在子级 `content` 做位移
- 动效库：沿用项目内 **指数阻尼**（与爪机一致）；未引 GSAP。备用 `preset: 'fadeScale'`
- 动销位：`#cta[data-prize-id]` 预留，后续接文案/跳转/视频不改总线

## 扩展（未实现）

- 局域网第二设备：可加 devServer SSE/WebSocket，总线 payload 不变
- 非圆孔：只改主场景 `machineShell` 与 `holeFloorY`，事件层不变
