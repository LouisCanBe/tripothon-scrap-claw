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

## 展台多设备（笔记本 + 平板 + 安卓触控盒）— 方案对齐

### 设备分工

| 设备 | 角色 | 典型页面 |
|------|------|----------|
| **笔记本** | 现场 **Web 主机**：`devServer --lan` +（规划）出货 **SSE/WS 中转**；可 H 调参 | 本机调试 / 不必必玩 |
| **平板** | **主游戏**：触控 + 虚拟摇杆，抓娃娃 | `/` |
| **安卓盒子（触控屏）** | **出货副屏**：全屏 `display.html`；后续可点按、滑动等 **出货界面交互** | `/display.html` |

三台浏览器访问 **同一 origin**（笔记本局域网 IP 或日后 HTTPS 域名），GLB 与 API 同源，避免跨域。

### 网络

- 室外 / 展馆：**笔记本开热点或共 WiFi**，平板与盒子连同一网段；`node tools/devServer.mjs 8000 --lan`。
- **不依赖公网**即可 demo；日后部署到云时，平板与盒子改为同一 `https://域名`，协议与 payload **不变**。

### 同步（已实现 · devServer SSE）

```text
平板（publish） ──POST──► /api/collect/publish { pair, msg }
安卓副屏（subscribe） ◄──SSE── /api/collect/stream?pair=  (+ 25s 心跳，断线自动重连)
```

- 实现：`tools/collectDisplayHub.mjs`，由 `devServer.mjs` 挂载。
- `config.collectDisplay.transport`：`auto`（默认）主屏 HTTP 下会 POST；`display.html` 订阅 SSE。`local` 仅 BroadcastChannel。
- `pair`：默认 **`config.collectDisplay.pairId`**（口令样式，见 `collectPairDefault.js`）；多展台时 URL **`?pair=XXXX-XXXX`** 覆盖。主副屏须同一 pair。
- 同机第二标签：仍可用 BC；副屏在 `auto` 下 **只订 SSE**（避免双份事件）。

**展台联调**

```text
node tools/devServer.mjs 8000 --lan
平板：  http://<笔记本IP>:8000/
副屏：  http://<笔记本IP>:8000/display.html
```

（默认口令写在 `prototype/src/collectPairDefault.js`，改配置即可换展台，书签无需带 `?pair=`。）

副屏页脚显示连接与引导（先开副屏会提示「请先打开主游戏」）。  
主游戏 **第三幕起** 右上角统一 **出货副屏** 条：`未连接` 折叠即显示完整 URL，展开含二维码；`已连接` / `同步未就绪` 仅摘要（仅 LAN/SSE）。  
主游戏每 8s `POST /api/collect/ping`（标签页在后台时不 ping）；副屏经 SSE 收 `collect.hub_status`（约 8s 一次）。

### 联动提示判定（验证逻辑）

| 信号 | 周期 / 阈值 | 作用 |
|------|-------------|------|
| 主游戏 `ping` | 每 **8s**（前台） | 刷新 `gamePingAt` |
| `gameActive` | **22s** 内有过 ping 或 `publish` | 副屏：「主游戏在线」vs「请先打开主游戏」 |
| 主游戏查副屏 | 每 **4.5s** `GET /status` | HUD：副屏路数，关副屏后最多约 4.5s 显示未连接 |
| 副屏 SSE | 长连接 + 25s 注释心跳 | 断网显示「重连中…」，关页即断开 |

关主游戏标签或切后台：**约 22s** 后副屏 `gameActive=false`，文案回到 **「请先打开主游戏」**（并清除「已联动」状态）。  
出货 `publish` 也会刷新在线窗口（22s 内算在线）。

### 展示日 vs 配对（预留）

| 模式 | 用途 | 做法 |
|------|------|------|
| **固定配对口令（展示日推荐）** | 免扫码、最快联调 | 改 `collectPairDefault.js` / `pairId`，盒子与平板只收藏无参数的 URL；可完全 **不做扫码** |
| **配对（预留设置）** | 多展台防串台、临时布场 | 配置项开启后走配对流；**展示日可关闭** |

配对设计要点（仅平板有摄像头，盒子 **不扫**）：

1. 副屏先打开 `display.html`，生成配对口令 `P`，**在盒子触控屏上显示二维码/短码**。
2. 平板游戏内「连接副屏」→ **扫盒子上的码** → 主端开始往 `P` 发布事件。
3. 盒子页已订阅 `P`（出码时即连 SSE），扫完只完成「平板认领 pair」。

配置预留（实现时写入 `config.collectDisplay`，当前可无 UI）：

- `transport: 'local' | 'lan'`（及日后 `cloud`）
- `pairId`：固定配对口令；空则走动态配对
- `pairingEnabled: false` — **展示日默认关**；将来展馆多机再开
- `hubUrl`：笔记本或云上的 API 根（如 `http://192.168.x.x:8000`）

### 安卓副屏后续交互

- 触控屏可丰富 **出货层 UI**（动效、文案、按钮），逻辑仍建议：**只改 display 页 DOM/Three**，经 **上行消息**（规划 `collect.display_action`）回 hub，主游戏是否响应另议。
- 预留 DOM：`#cta[data-prize-id]`；总线 schema 版本号 `schema: 1` 便于加字段而不破副屏。

## 扩展（未实现）

- **配对 UI**：副屏出码、平板扫（`pairingEnabled`）
- **双向**：独立 WebSocket `/api/collect/ws`，payload 与 SSE 相同；上行 `collect.display_action`
- 非圆孔：只改主场景 `machineShell` 与 `holeFloorY`，事件层不变
