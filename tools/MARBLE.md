# Marble（World Labs）场景生成 → 游戏接入手册

> 一句话：Marble 把一段文字/一张图生成可行走的 3D 世界，输出**全景图 / GLB 网格 / SPZ 高斯点云**三种资产，
> 分别对应本项目的**终幕实景背景 / 碰撞与占位 / 写实场景层**三条接入路径。
> 本文档是 2026-09-20 探索轮的结论归档，接入时照抄即可，不用重新试错。

## 快速开始

```bash
# .env.local 加 MARBLE_API_KEY=wlt_xxx（platform.worldlabs.ai 申请，已 gitignore）
node tools/marble.mjs gen --text "雨后小巷，霓虹倒影" --wait --out prototype/assets/worlds/alley.glb
node tools/marble.mjs serve        # → http://localhost:8788/ 预览器（tools/world.html）
```

- 生成是**离线批处理**（同 Tripo 哲学：key 不出前端、demo 可离线、资产可策展）
- 测试一律用 `marble-1.0-draft` 档（150 积分 ≈ $0.12，32s 出世界，三种资产全给）
- CLI 三件套：`--dry`（只打印请求）/ `--wait`（轮询）/ `--out`（下载落盘）
- 逃生舱：`node tools/marble.mjs call <path>` 裸调任意接口

## API 速查（v1，已实测）

| 操作 | 端点 | 说明 |
|---|---|---|
| 生成世界 | `POST /marble/v1/worlds:generate` | `world_prompt.type`: text / image / panorama / video |
| 轮询 | `GET /marble/v1/operations/{id}` | done 后取 `response.world_id` |
| 世界详情 | `GET /marble/v1/worlds/{id}` | 资产 URL（mesh / splats / imagery） |
| 导出 | `POST /marble/v1/worlds/{id}:export` | `{asset_type:'mesh',format:'glb'}` 或 splats/ply |

鉴权头：`WLT-Api-Key`。402 = 余额不足。响应里 `cost.total_credits` 可对账。

| 档位 | 积分 | 折合 | 用途 |
|---|---|---|---|
| `marble-1.0-draft` | 150 | $0.12 | **测试/草稿用这个** |
| `marble-1.1` | 1,500 + 80 文本费 | ~$1.26 | 正式质量 |
| `marble-1.1-plus` | 1,500 + 0~1,500 浮动 | ~$1.3~2.5 | 大世界/室外 |
| HQ mesh 导出 | 3,500 | $2.80 | 高精度网格（贵，慎用） |

## 三种资产 → 三条接入路径

| 资产 | API 字段 | 游戏用途 | 接入方式 | 状态 |
|---|---|---|---|---|
| **全景图 PNG** | `assets.imagery.pano_url` | 终幕"实景"背景 | `scene.background` 一行（见下） | ✅ 预览器验证 |
| **GLB 网格** | `assets.mesh.collider_mesh_url` | 碰撞体 / 占位场景 | `physics.js` collider 射线检测 | ✅ 预览器验证 |
| **SPZ 点云** | `assets.splats.spz_urls.{100k,500k,full_res}` | 写实场景层 | `@mkkellogg/gaussian-splats-3d`（已 vendor） | ✅ 预览器验证 |
| AI 场景描述 | `assets.caption` | — | 回收当 prompt 素材 | 副产品 |

### 1. 全景图 → 终幕实景背景（最简，优先做这个）

```js
new THREE.TextureLoader().load(panoUrl, (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
});
```

- 对应 `acts.js` 终幕的 `hooks.onReveal`：鱼眼消退 + 画幅展开 16:9 时换成 Marble 实景天空盒
- **全景图无坐标系问题**，直接用
- 低模娃娃机（记忆）vs Marble 写实世界（现实）的画风对比本身就是叙事

### 2. GLB 网格 → 碰撞体 / 占位场景

```js
gltf.scene.rotation.x = Math.PI;                    // ⚠️ 坐标系翻转，见下节
scene.add(gltf.scene);
const box = new THREE.Box3().setFromObject(gltf.scene);
gltf.scene.position.y -= box.min.y;                 // 翻转后包围盒落地
```

- collider mesh 是**素模**（无贴图），视觉上是占位级；价值在"碰撞"
- 正式接入：走 `physics.js` 已有 collider 射线检测体系，爪子/相机撞墙由它算
- 实测街角世界尺寸 **13.2×4.0×13.7m**（draft 档）

### 3. SPZ 点云 → 写实场景层（质感上限最高）

```js
const viewer = new GSplat.Viewer({
  rootElement: container,
  cameraUp: [0, 1, 0],
  sharedMemoryForWorkers: false,       // 部分环境 SharedArrayBuffer 不可用
  useBuiltInControls: false,           // ⚠️ 库自带控制反直觉，必须关掉自己接（见"预览器"节）
});
await viewer.addSplatScene(url, {
  progressiveLoad: false,
  rotation: [1, 0, 0, 0],              // ⚠️ 坐标系翻转（四元数，绕 X 180°）
});
viewer.start();
```

- 库已 vendor：`prototype/vendor/addons/gaussian-splats-3d.js`（three r170 兼容已验证）
- splat 层与 mesh 层**可同屏混合渲染**（点云场景 + 低模娃娃机/道具放里面）
- 档位选择：Web/移动端用 `100k`（快），`full_res` 文件大、加载慢，正式版按设备降级
- 接入游戏主渲染循环时：不用 `Viewer` 自驱动，改用 `SplatMesh` 挂进主 scene（库支持），统一走游戏的相机和后处理链

## ⚠️ 坐标系约定（最重要的一个坑）

**Marble 输出的 GLB 和 SPZ 与 three.js 朝向相反，接入时必须绕 X 轴翻 180°：**

| 资产 | 翻转代码 |
|---|---|
| GLB | `gltf.scene.rotation.x = Math.PI`（翻完重算包围盒把底部贴回地面） |
| SPZ | `addSplatScene(url, { rotation: [1, 0, 0, 0] })`（四元数 x=1） |
| 全景图 | **不用动** |

不翻的表现：场景上下颠倒（地面在头顶）。

## 预览器 world.html（验证接入正确性的工具）

`node tools/marble.mjs serve` → http://localhost:8788/

- 左上角下拉选 `prototype/assets/worlds/` 里已下载的资产，按扩展名自动进对应模式；也支持拖拽本地文件进去
- 顶栏按钮可强制切换模式（比如用 SPZ 模式强行加载 GLB 对比）

### 交互规范（双范式，V 键切换）—— 正式游戏相机控制直接参考这套

| 操作 | 第一人称（fps，SPZ 默认） | 第三人称/环视（orbit，GLB 默认） |
|---|---|---|
| 左键拖拽 | **只转视线**，相机位置不动 | 绕目标点转（OrbitControls 标准手感） |
| WASD / 方向键 | 身体前后左右移动 | 平移目标点（相机跟随） |
| Q / E | 垂直升降 | 垂直升降 |
| 滚轮 | FOV 推拉 | 轨道距离缩放 |
| **V** | 切换到环视 | 切换到第一人称 |

**方向约定（改方向只看这里）**：水平两范式同公式 `yaw -= dx`（往右拖 = 视线右转 = 内容左移）；
垂直各自标准但手感统一为"往下拖 = 往下看"：fps `pitch -= dy`（低头），orbit `pitch += dy`（相机升高俯视）。

**切换平滑**：fps→orbit 目标点自动放到视线正前方；orbit→fps 身体落在当前相机位置、视线方向保持。

**边界碰撞**：target 与相机双重 clamp 在包围盒内，撞墙即停（贴墙滑动）。
GLB 用模型精确包围盒（收缩 0.3m 防贴墙看穿模）+ 可见线框；SPZ 无精确包围盒 API，
用默认盒（±8m, y 0.2~4），同场景精确边界可由 collider GLB 推导。
pano 锁定球心纯旋转，无边界概念。

## 已知坑（这轮踩过的，别再踩）

1. **gaussian-splats-3d 库自带控制反直觉**：WASD 是屏幕空间平移（W/S 上下）、方向键旋转、拖拽轴向反——必须 `useBuiltInControls: false` 自己接
2. **SPZ Viewer dispose 后 DOM 可能残留** → 切换模式时 `stage.innerHTML = ''` 兜底
3. **`#empty` 的 `display:grid` 会覆盖 `hidden` 属性** → CSS 里用 `[hidden]{display:none !important}`
4. **Box3Helper 线框在 SPZ 模式被点云渲染盖住**——功能正常只是看不太清，别以为是边界没生效
5. **SPZ 没有可靠的包围盒 API**——要精确边界就从同世界的 collider GLB 算
6. **模块缓存**：改完代码用 `node tools/devServer.mjs`（no-store）或给 URL 加 `?v=xxx`，别用 `python -m http.server`

## 实测档案（reveal-draft 世界，2026-09-20）

| 项 | 值 |
|---|---|
| prompt | 终幕实景方向（雨夜街角，防水布罩着的娃娃机） |
| 档位 | marble-1.0-draft，150 积分，约 32s |
| collider GLB | 13.2×4.0×13.7m，素模 |
| SPZ 100k | 预览流畅，质感远超素模，水洼/裂缝地面细节可见 |
| 文件 | `prototype/assets/worlds/reveal-draft-{100k.spz, collider.glb, pano.png}` |

## 正式接入 TODO（按优先级）

1. **终幕全景背景**（成本最低收益最大）：`hooks.onReveal` 里 `scene.background` = Marble pano
2. **SPZ 实景层进主场景**：`SplatMesh` 挂主 scene（不用 Viewer 自驱动），统一相机/后处理；注意与 mesh 层的渲染顺序和深度
3. **collider GLB 接碰撞**：`physics.js` 射线检测，爪子/第一人称相机撞墙
4. **设备降级策略**：移动端 SPZ 用 100k 或回退 pano 背景
5. **加载体验**：SPZ 较大，走和游戏一致的加载闸门（`#loading` 进度条），必要时 `progressiveLoad: true`
