# 爪机手感参数清单 & 调参指南（灰盒原型 v0.1）

> 所有参数集中在 `src/config.js`，运行时按 **H** 打开面板实时调。
> 调到满意后把数值抄回 `config.js` 作为新默认值。

## 运行

入口和 `?act=` / `?lang=` / `?gui=1` 等链接见仓库根 `README.md`。下面是旧的本地静态服写法，日常用 `npm start` 即可。

ES Module 必须走本地服务器（不能直接双击 html）：

```powershell
cd prototype
python -m http.server 8017   # 或: npx serve -l 8017
# 浏览器打开 http://localhost:8017
```

依赖 three@0.170（jsdelivr CDN）。离线环境：`npm i three@0.170` 后把 index.html 里 importmap 两行指向 `./node_modules/three/build/three.module.js` 和 `./node_modules/three/examples/jsm/`。

## 键位

| 键 | 作用 |
|---|---|
| ←→↑↓ / WASD | 移动爪子（前后 = 机器纵深） |
| 空格 | 落爪（**落下后不可取消**） |
| 1 / 2 / 3 | 视角 左 / 前 / 右 |
| Q / E | 视角循环 |
| V | 取景 凑近/站远 切换（仅居中画幅幕；站远 = 全窗取景裁切的首版中远景，凑近 = 只对画幅区域取景的近景） |
| F | 画幅 1:1 ↔ 16:9（平滑过渡，完整版转场雏形） |
| Shift+F | 硬切（黑闪降级版，终幕保底方案） |
| H | 调参面板显隐 |

---

## 一、移动惯性（手感第一印象）

| 参数 | 默认 | 建议范围 | 控制什么 | 调大 / 调小 |
|---|---|---|---|---|
| `moveSpeed` | 1.7 | 1.2–2.5 | 目标点移动速度 | 太大→爪子跟不上、发飘；太小→迟钝憋屈 |
| `moveTau` | 0.09 | 0.05–0.18 | 追踪时间常数，**稳定耗时≈2τ**（outline 要求 100–200ms 惯性） | 太大→棉花糖；太小→没有机械惯性，像鼠标指针 |
| `boundsX/Z` | ±1.35 / ±0.9 | — | 可达范围 | 必须罩得住全部奖池 + 洞口 |

验收：按住方向键 1 秒后松开，爪子应**再滑行一小段才停稳**，但停稳不超过 0.4s。

## 二、落爪时序（紧张感来源）

| 参数 | 默认 | 建议范围 | 控制什么 |
|---|---|---|---|
| `dropSpeed` | 2.4 | 1.5–4.0 | 下落速度；快→果决，慢→煎熬 |
| `closeDelay` | 0.18 | 0.05–0.4 | 到底后合爪前的停顿，**"屏息的一拍"** |
| `closeDuration` | 0.42 | 0.25–0.7 | 合爪动画时长，慢→仪式感，快→脆 |
| `afterGrabPause` | 0.14 | 0–0.3 | 合爪→上升间隙，给玩家"中没中？"的一瞬 |
| `liftSpeed` | 1.35 | 0.8–2.2 | **务必比 dropSpeed 慢**，上升是悬心段 |
| `returnTau` | 0.12 | 0.08–0.25 | 回收迟钝度，比 moveTau 略大 → 机械感 |

一次完整抓取时长 ≈ 下落0.5s + 停顿0.18 + 合爪0.42 + 停顿0.14 + 上升0.8 + 回收≈1 + 投放0.7 ≈ **3.7s**。节奏目标 3–5s，超出就压缩。

## 三、爪力与滑落（难度曲线旋钮，全项目最重要的一组）

判定模型（透明、可调）：

```
p(抓住)   = gripStrength × item.gripFactor
p(滑落)   = baseSlipProb × (1 − gripStrength × item.gripFactor)   ← 抓住后才掷签
```

| 参数 | 默认 | 建议范围 | 控制什么 |
|---|---|---|---|
| `gripStrength` | 0.85 | 0.5–1.0 | **全局爪力 = 难度总开关**，幕间变化只调它 |
| `baseSlipProb` | 0.38 | 0–0.7 | 滑落权重；0 = 抓住就必成 |
| `grabRadius` | 0.30 | 0.2–0.45 | 合爪判定半径，宽容度 |
| `wobbleAmp/Freq` | 0.022 / 9 | 0–0.05 | 上升抖动；**安排了滑落的物品会抖得更凶**（预兆演出） |

`gripFactor` 在数据表 `prizePool.js` 每件物品上：食物 0.65–0.95，垃圾 0.35–0.8（碎砖 0.35 几乎抓不起来 = 天然障碍）。

**幕间难度曲线建议**：

| 幕 | gripStrength | baseSlipProb | 意图 |
|---|---|---|---|
| 一幕·引子 | —（不让抓） | — | 只切视角 |
| 二幕·教学 | 1.0 | 0 | **首抓必成**，建立信任 |
| 三幕·任务 | 0.75 → 0.6 | 0.45 | 爪力衰减，"机器在坏"的压迫感 |
| 四幕·合成 | 不抓 | — | 仪式感 |

## 四、镜头

| 参数 | 默认 | 建议范围 | 备注 |
|---|---|---|---|
| `fov` | 78 | 70–85 | outline 广角规范 |
| `views.*` | 见 config | — | 三观察位坐标，只允许左/前/右 |
| `tau` | 0.38 | 0.2–0.7 | 视角切换阻尼 |
| `breathDeg` | 0.25 | 0–0.3 | 呼吸幅度，**outline 硬上限 0.3°** |
| `acts.js 的 zoom` | 一幕 0.68 | 0.5–1.2 | **逐幕变焦**：机位 = look + (pos−look)×zoom。<1 贴近玻璃柜（一幕近景），缺省 1 = 看全整机。相机只对画幅可见区域取景（setViewOffset），画幅偏右时机器自动居中 |
| `userZoomMin` | 0.55 | — | 滚轮/捏合 **最近**（有效 zoom 下限，越大越近） |
| `userZoomMaxGameplay` | 1.28 | 0.85–1.6 | **三幕起**滚轮 **最远**（H「镜头·三幕滚轮最远」） |
| `userZoomMax` | 1.6 | — | 一二幕滚轮最远上限 |

## 四·五、AI 分件爪（config.clawGLB）

替换机制：`upgradeClawVisual()` 加载分件 GLB → 静态件保持原变换 → 每条爪臂按**节点位移的方位角**包一个关节 pivot（`attach` 保持世界位姿）→ 替换 `this.pivots` 引用，开合时序/#setProngs 照常工作。

| 参数 | 默认 | 控制什么 |
|---|---|---|
| `url` | assets/machine/claw_parts.glb | 分件模型路径；清空即回退 procedural |
| `scale / offsetY` | 0.58 / -0.24 | 体量对齐：顶盖≈+0.05 接吊缆，爪尖≈-0.53（= 抓物悬挂点 -0.52 附近） |
| `staticParts` | part_0/2/5/7 | 不动的件（外壳/中柱/细杆/顶盖） |
| `prongGroups` | [1,6] [3] [4] | 同组共享一个关节；part_6 小关节贴前臂同组随动 |
| `attachY / attachR` | -0.14 / 0.15 | 关节点：臂顶端高度 / 臂根内缘半径（模型单位） |
| `openAngle / closeAngle` | 0 / -0.50 | 生成姿态即张开；闭合=绕关节内收（负=向内）。臂穿插/合不拢就调它 |
| `rotationY` | π/2 | 生成模型臂朝侧向时转正，正视角看到「两边向内合」的剪刀感 |

开合实现（灰盒 / Tripo 同一套）：`CLOSE` 阶段 `prongT` 递增 → `#setProngs` 对每个 `pivot` 写 `rotation.z = lerp(openAngle, closeAngle, t)`。Tripo 只是用 `prongGroups`+`attach` 把分件挂到 pivot 上，**转轴仍是 pivot 的 Z**。

落爪：`grabY` / `hang` 只乘 **爪** `meshVisualScale`（与 `tipDepthBase`），**不**乘 `pool.visualScale`；`grabRadius` 才跟奖品放大。

**漫画描边**：奖池与 Hub 预览对「整棵 GLB」做 Toon+描边；爪子只对 `comicVisualRoot`（Tripo `newClaw` / 灰盒 `clawVisual`）。描边实现见 `tools/comic-render.mjs`（子 Mesh 零位姿 + 共享 geometry，勿用 `mesh.clone()` 挂自己）。分件爪每片独立转 pivot，描边会跟片走；仍乱时可关 `claw.comicFx.useOutline` 只留 Toon。

**换新一版爪子模型时**：分件名会变 → 浏览器控制台把 GLB 挂进场景，逐件染不同颜色截图确认归属（本次就是这么标的），再更新 `staticParts` / `prongGroups`。

## 五、后处理

| 参数 | 默认 | 备注 |
|---|---|---|
| `postLensGameplay.k1/k2` | 0.65 / 0.45 | 三幕起切幕写回 `CONFIG.post`；改这里即改玩法默认 |
| `present.actPost` 1/2 | 0.12 / 0.048 | 一二幕较轻桶形 |

## 奖池装饰 GLB（`pool.decor` + `decor-low`）

| 参数 | 默认 | 备注 |
|---|---|---|
| `decor.glbEnabled` | true | 部分装饰换成 Tripo 小件 |
| `decor.glbShare` | 0.36 | 替换比例（其余仍是毛绒灰盒） |
| `decor.glbTargetSize` | 0.095 | 归一化最大边（米） |
| 替换规则 | decorKind → 同形 GLB | ball/roll/disk/ribbon 各 good/junk 50%；脚底对齐防悬空 |
| 资产 | 8× decor-low | `node tools/generate.mjs --set decor-low` |
| `grain` | 0.055 | 胶片颗粒 |
| `vignette` | 0.55 | 全画面径向暗角（shader；与 `#frameBorder` 内缘 CSS 暗角是两层） |
| `vignetteSquare` | 0 | 暗角（square 时关；桶形 k1/k2 也关） |
| `frame.viewportEdge` | fisheye | **fisheye** = 椭圆内缘暗角+羽化压锯齿；**square** = 纯直角 clip |
| `frame.viewportFeatherPx` | 14 | fisheye 叠层外扩 px（压 clip 锯齿） |
| URL `?frameEdge=` | — | `fisheye` \| `square` 快速对比两版 |
| `acts[].viewportShape` | — | `circle`：该幕圆形视口（默认一二幕） |
| `frame.circleScale` | 0.94 | 圆直径相对布局矩形短边 |
| 2→3 幕 | — | `inset(... round R)` 与 `transitionSec` 同步渐变（圆→方框+鱼眼缘） |
| `fisheyeVigEllipseX/Y` | 1.58 / 1.42 | **视口内缘 CSS 暗角**椭圆（`#frameBorder`，H「视口缘」） |
| `fisheyeVigInner` | 0.20 | 内缘透明区比例（越小暗角越贴边） |
| `present.transition.interstitialDipAfter` | false | 闪回淡出后是否再黑场 |
| `frame.fisheyeFadeOnWide` | true | 展开 16:9 时鱼眼消退（"梦醒了"），终幕语言 |

---

## 手感验收清单（M1 通过的 Definition of Done）

- [ ] 惯性可感知但不拖沓（松键 0.4s 内停稳）
- [ ] 落爪后按键完全无效（不可取消的紧张感成立）
- [ ] 上升段明显比下落段"悬心"
- [ ] 滑落发生在上升中段、且有抖动预兆，玩家会骂但认账
- [ ] 三视角切换能看出奖池内部遮挡差异（这才支撑一幕"观察"玩法）
- [ ] **仅靠轮廓**能在池里找出面包/罐头/蔬菜（设计语言验证！颜色故意相近后仍成立才算过）
- [ ] F 展开 16:9 时鱼眼同步消退，"梦醒"感成立
- [ ] 60fps（打开 devtools 确认）

## 奖池尺寸与姿态（`prizePool.js` + `config.pool`）

| 层级 | 位置 | 作用 |
|------|------|------|
| **槽位轮廓** | `prizePool.js` → `PRIZE_TABLE[].collider` | 灰盒几何与 Tripo GLB 归一化的目标尺寸（box/cylinder/sphere 米制） |
| **落地高度** | 同上表 + `buildPrimitive` / `normalizeGLB` 的 `restY` | `mesh.position.y === restY` 时底面贴池底 |
| **全局放大** | `CONFIG.pool.visualScale` | H 面板可**当场缩放**；数值写入 `localStorage` 键 `tripo.poolDev`，刷新仍保留 |
| **横躺 GLB** | `CONFIG.pool.glbExtraRotX` | 载入时生效，改后需 **F5**（同样会写入 `tripo.poolDev`） |
| **漫画** | `CONFIG.pool.comicFx` | 与 Hub 同参；H 面板实时开关，刷新保留 |

Hub 单模型预览还会把模型缩到约 `1.4 / max(包围盒)` 摆到网格上，**游戏内不用这套**，只靠 collider 槽位 + `visualScale`。

---

## Tripo 接缝（M2 冒烟测试时做）

1. 数据表某项 `visual` 改为 `{ type:'glb', url }`，走 `prizePool.js → normalizeGLB()`（归一化四步已写在注释里）——机制代码零改动；
2. 生成侧参数：`face_limit` 1万–5万（Web）或 `smart_low_poly:true`；风格统一走 image-to-3D（先出一套概念图）；
3. **爪子已换 AI 分件**（2026-09-11 起）：`generate_parts` 出的 `assets/machine/claw_parts.glb` 经 `clawMachine.upgradeClawVisual()` 热替换，只换视觉、状态机/判定零改动，失败自动回退 procedural 爪。分件归属与关节参数见下"AI 分件爪"一节；
4. 冒烟 DoD：面包 + 罐头各生成一次，跑通 `生成→GLB→归一化→入池→被抓→60fps`。

## 灰盒已知简化（不是 bug，别现在修）

- 奖池单层平铺，无堆叠物理（正赛如需堆叠再上网格碰撞）
- 无玻璃反射、无音效、无故障 shader（后处理链已留扩展位）
- HUD/字幕是最简 HTML，未做漫画分镜样式（二幕美术阶段替换）
- 终幕实景：`config.reveal.pano` + 共用 `src/sceneControls.js`（与 Marble 工具台同套）；`yawOffset` 对齐朝向；SPZ 见 `tools/MARBLE.md`

---

## 流程编排（director.js + acts.js）

**分层原则：编排层只调稳定接口**（爪机 controlEnabled/参数/hooks、画幅 setLayout、镜头三视角、灯光），
不碰机器外壳与爪子的实现 —— 所以机器生成实验（换 machineShell.js / 爪片视觉）与编排互不影响。

- **改文案/时长/参数** → 只动 `acts.js`（数据驱动：sub 字幕、panel 旁白框、wait 事件、tuning 爪力、quest 任务）
- **改流程结构**（加幕/加步骤类型）→ `director.js`
- **画幅三布局位**：`right`（一幕左文右窗）/ `center`（二三四幕居中）/ `wide`（终幕 16:9）；相机取景跟随画幅（阻尼 0.28s），转场时机器不跑偏
- **取景近/远**：`acts.js` 每幕可写 `framing: 'near'/'far'`（缺省 = 沿用上一幕，保留玩家 V 键选择）。实现 = 投影平移把机器中心钉在画幅中心（无放大无畸变、与窗口宽度无关）+ near 时变焦 ×`frame.nearZoom`(0.7)；far 偏移为 0 = 首版构图。一幕锁 near，二~四幕默认 far 可切
- **加载闸门**：所有 GLB 下载+预编译完成才开演（`#loading` 进度条，30s 兜底强开）——线上资产走网络时必须，否则玩家会看到"几何体变模型"的换装过程
- **逐幕变焦**：`acts.js` 每幕可写 `zoom`（一幕 0.68 近景贴玻璃柜；缺省 1 看全整机，二幕起自动拉回）
- **幕间难度曲线**已按本文档"三、爪力"表接线：二幕必成（1.0/0）→ 三幕衰减（0.78 起步，每抓 -0.06）
- 调试：**N 键跳幕**；控制台 `__debug.director / claw / items` 可直接操作（自动化测试用的就是这个）

---

## M2 生成管线用法（tools/generate.mjs）

**生成是离线批处理，不在浏览器里实时调 API** —— key 安全、demo 可离线、单件可策展。

1. 复制根目录 `.env.example` 为 `.env.local`，填入 `TRIPO_API_KEY=tsk_你的key`（已 gitignore，别提交）
   - 域名默认 `https://openapi.tripo3d.com/v3`：`.ai` 域名在部分网络下直连超时（Node 不走系统代理），不通时用 `TRIPO_API_BASE` 覆盖
2. **冒烟测试（只花 2 件的积分）**：`node tools/generate.mjs --only bread,can`
3. 全量：`node tools/generate.mjs`；单件重生：`--only veg --force`；只看不调：`--dry`
4. GLB 落到 `prototype/assets/prizes/`，manifest 自动重建，**刷新页面即热替换**（抓取判定不变）

**好版第二套**（v3.1 + detailed 贴图，强调单体完整、少碎屑；旧套保留在 `prizes/`）：

- **轻量好版（推荐部署）**：`tools/prompts-good-p2.json`（P2、`face_limit` 5500、standard 贴图）→ `.\tools\run-generate-good-p2.ps1 -Force`（默认并行 4 路）→ `assets/prizes-good-p2/`
- **高精好版**：`prompts-good.json`（v3.1 detailed）→ `prizes-good/`（体积大，试效果用）
- 游戏默认 `glbSet: 'good-p2'`；manifest 空则回退 good → legacy。URL：`?models=good-p2` | `good` | `legacy`
5. 爪子分件实验：`node tools/generate.mjs claw`（generate_parts 与贴图互斥，出无贴图分件；不行就沿用灰盒的 procedural 爪子）
6. 风格漂移控制：prompts.json 里给某件加 `"image": "概念图URL"` 即切换为 image-to-model 路线
7. 积分提醒：每件标准贴图约 20 积分（以官网计费为准），先 `--dry` 检查 prompt 再花钱

## 字体 / 文案样式调整

全部集中在 `index.html` 顶部 `:root` 的"字体样式调整区"：

- `--font-main` 正文/UI（现等宽打字机感），`--font-hand` 手写体（终幕那行字）
- 字号 / 颜色 / 字距 / 文字阴影都是变量，改一处全站生效
- 终幕手写体触发方式已内置：`msgEl.classList.add('stinger')`
- 换自定义字体：woff2 放 `prototype/fonts/`，取消 `:root` 里 @font-face 注释即可。**中文务必做字体子集化**（只打包用到的字），否则一个字体文件好几 MB，首屏 8s 预算直接爆
