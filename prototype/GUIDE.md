# 二开指南：界面怎么改 · 模型怎么换

> 面向"优化界面样式 / 模型适配"的快速索引。参数细节见 `PARAMS.md`，流程见 `README.md`。

---

## 一、界面（UI）层

所有界面元素都是 **HTML + CSS**，与 3D 场景完全分离，改样式不用碰任何 WebGL 代码。

### 1. 字体 / 颜色 / 字号 —— 全站只在一处改

主题变量已抽离到 **`prototype/theme.css`**（`:root` 变量区），设计稿定稿后只改这一个文件。
想做多方案对比：复制成 `theme.alt.css` 改值，在 `index.html` 里换 `<link>` 即可。

| 变量 | 控制 |
|---|---|
| `--font-main` | 正文/UI 字体（现等宽打字机感） |
| `--font-hand` | 手写体（终幕那行字专用） |
| `--font-size-hud / msg / hint` | 配额面板 / 字幕 / 底部提示字号 |
| `--color-ink` / `--color-ink-dim` | 主文案 / 次要提示颜色 |
| `--color-accent` | 任务完成色（配额打勾） |
| `--color-paper` / `--color-paper-ink` | 纸片元素（旁白框/toast/合成卡）底色与字色 |
| `--text-shadow` / `--panel-shadow` | 文字阴影 / 纸片投影 |

换自定义字体：woff2 放 `prototype/fonts/`，按 `theme.css` 里注释掉的 `@font-face` 模板启用。**中文务必做字体子集化**（只打包用到的字），否则单字体好几 MB。

### 1.5 设计稿叠加对照（G 键）

把设计稿 PNG 放进 `prototype/design/` 并在 `design/manifest.js` 加一行路径
（或直接把本地图片拖进游戏窗口），游戏里按 `G` 半透明叠加在画面上：

| 操作 | 效果 |
|---|---|
| 拖拽 | 移动设计稿 |
| 滚轮 / `Shift+滚轮` | 调透明度 / 缩放 |
| `[` `]` | 切换多张设计稿 |
| `R` | 复位（居中适应窗口） |
| `L` | 锁定：鼠标穿透，正常玩游戏对照看 |

逻辑在 `src/designOverlay.js`，纯调试工具，不进发布流程也无妨。

### 2. 各元素在哪定义

| 元素 | 选择器（index.html） | 行为在哪 |
|---|---|---|
| 画幅白框（颜色/粗细/圆角/阴影） | `#frameBorder` | **位置尺寸由 `src/frameMask.js` 的 `#rect()` 计算**（三个布局位 right/center/wide 的公式都在这），JS 写入 left/top/width/height |
| 画幅裁切 | `#stage`（clip-path） | 同上，转场动画时长要与 `config.js` 的 `frame.transitionSec` 一致 |
| 底部字幕（底条背板+打字机） | `#msg` | 文案在 `acts.js`；打字机在 `director.js` 的 `msg()`；终幕手写体 = 加 `.stinger` 类 |
| 底部操作提示 | `#hint` | 文案在 `acts.js` 的 `hint` 字段 |
| 配额任务卡 + 打勾动画 | `#hud` / `.quest.done::before` | `director.js` 里 notify('collect') 驱动 |
| 收集飘字 / 提示 toast | `#toasts` / `.toast` | `main.js` 的 `toast()`（onCollect、近远切换触发） |
| 视角指示点 | `#viewDots i.on` | `main.js` 主循环轮询 `rig.cur` 点亮 |
| 漫画旁白框（纸张色/旋转角/位置） | `.panel` / `.panel.right` | `acts.js` 的 `{ panel, side, text }` 步骤 |
| 幕标题卡 | `#actLabel` | `acts.js` 的 `label` 字段 |
| 四幕合成卡片 / 菜单卡 | `.syn-card` / `#menuCard` | `director.js` #synthesis()；文案在 `acts.js` 的 `menu` |
| 加载进度条 | `#loading` | `main.js` boot 段 |

### 3. 文案 / 时长 / 幕流程

**全在 `src/acts.js`**——每幕是声明式数据：`sub`（字幕+dur）、`panel`（旁白框）、`wait`（等事件）、`zoom`（变焦）、`framing`（近/远）、`tuning`（爪力）等。改文案不用动引擎。

### 4. 交互键位

`src/input.js` 的 keydown switch 定义键 → 事件；`main.js` 的 `input.on(...)` 把事件接到动作（含幕间权限闸 `director.allow()`）。

**鼠标/触屏**（同一事件通道，权限闸照常生效）：
- `src/pointerControls.js`：横向拖拽 = 循环视角；滚轮/双指捏合 = 用户缩放（`rig.userZoom`，与幕级 `zoom`、近远 `modeZoom` 三相乘、互不覆盖；范围在 `config.camera.userZoomMin/Max`）
- `src/onscreenButtons.js`：屏幕方向键（按住=移动，走 `input.press/release` 虚拟按键）+「抓」「视角」；样式在 `index.html` 的 `#touchUI`；触屏设备自动显示，桌面端 H 面板「屏幕按钮」开关

### 5. 画面观感（鱼眼/颗粒/暗角）

`src/post.js` 的单 ShaderPass；参数在 `config.js` 的 `post` 段（H 键面板可实时调）。

---

## 二、模型层

### 1. 核心原则：判定与视觉分离

- **抓取判定只读数据表**：`src/prizePool.js` 的 `PRIZES` 每件物品的 `collider`（半径/高度）+ `gripFactor`（可抓性）。**换模型不影响判定**。
- **视觉可热替换**：页面先用几何体秒开，GLB 下载+预编译完成后 `upgradeVisuals()` 原位换装（带弹出小动画）。

### 2. 换奖品模型

```
tools/prompts.json 写/改 prompt
→ node tools/generate.mjs --only <id>   （生成到 assets/prizes/，manifest 自动重建）
→ 刷新页面即生效
```

- `normalizeGLB()` 自动做归一化：缩放到 collider 尺寸 + pivot 底面对齐到 `restY`。Tripo 输出的任意比例/朝向都能接住。
- 手工换模型也行：把 `.glb` 放进 `assets/prizes/`，在 `src/assets.manifest.js` 加一行 `id: '路径'`。
- 觉得模型和抓取手感不匹配（太大/太小/抓点怪）→ 改 `prizePool.js` 里那件的 `collider` / `gripFactor`，不是改模型。

### 3. 物理边界都在哪

| 边界 | 位置 | 控制什么 |
|---|---|---|
| `config.js` → `claw.boundsX / boundsZ` | 爪子可达范围 | 移动输入的钳制 |
| `config.js` → `pool.boundsX / boundsZ` | 奖品散布/掉落范围 |  spawn 位置、滑落后落点钳制 |
| `config.js` → `claw.home / holePos / holeRadius` | 待机点 = 洞口上方 | 回收/投放 |
| `config.js` → `claw.grabY / restY / grabRadius` | 下抓深度 / 巡移高度 / 判定半径 | 抓取时序与宽容度 |
| `prizePool.js` → 每件 `collider` | 单体碰撞尺寸 | 判定与归一化缩放基准 |
| `machineShell.js` | 机器外壳几何 | 视觉边界（要罩得住 bounds） |

无真实物理引擎：掉落是简单重力 + 一次反弹（`clawMachine.js` #updateFalling），滑落是概率掷签。

### 4. 换爪子模型

`assets/machine/claw_parts.glb`（Tripo generate_parts 分件）：

1. 新模型替换该文件后，**必须重新标分件归属**：浏览器控制台把 GLB 挂进场景、逐件染不同颜色、截图确认哪些是静态件、哪些是爪臂
2. 把名单填进 `config.js` 的 `clawGLB`：`staticParts`（不动的）/ `prongGroups`（每条臂一组，共享开合关节）
3. 微调 `scale / offsetY / attachY / attachR / rotationY / closeAngle`（每个参数含义见注释和 PARAMS.md"AI 分件爪"节）
4. 加载失败自动回退 procedural 爪，不会白屏

机制侧零改动：`upgradeClawVisual()` 只替换 `this.pivots` 引用，状态机/判定照常。

### 5. 相机与取景

- 三个机位：`config.js` 的 `camera.views`（front/left/right，pos + look）
- 逐幕变焦：`acts.js` 的 `zoom`；近/远切换：`framing` 字段 + `config.frame.nearZoom`；用户缩放：滚轮/捏合 → `userZoom`（三层相乘）
- 取景绑定是投影平移（main.js `applyViewRect`），机器中心永远钉在画幅中心，与窗口尺寸无关

### 6. 触屏/低性能设备防护（iPad 防崩）

`config.js` 的 `mobile` 段，仅对 `pointer: coarse` 设备生效：渲染分辨率上限 `maxPixelRatio`、贴图降尺寸 `maxTextureSize`（`prizePool.js` 的 `capTextures`，Tripo 大贴图是 iPad 崩标签页的主因）、GLB 限流加载 `glbConcurrency`。
