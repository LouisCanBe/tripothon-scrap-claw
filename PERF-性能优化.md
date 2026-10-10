# 《拾荒娃娃机》性能优化 · 诊断与行动计划

> **触发背景**：已提交参赛并部署上线，Render 服务选在新加坡节点。大陆/跨境访问首屏极慢。
> **本文档性质**：性能诊断记录 + A 档行动计划 + 进度追踪。改完一项就更新「执行状态」表。
> **本地 fps**：用户确认加载完成后本地运行不卡，故 **C 档（运行时帧率）暂缓**，只在文末留档。

---

## 一、结论先行

问题**不在运行时渲染**，在**首屏要下载的东西太多 + 传输方式太差**。

部署形态是「Render 跑 `tools/devServer.mjs`（Node 裸 `http` 服务）」。它带来三个叠加伤害，再撞上新加坡跨境带宽与 RTT：

1. **首屏闸门要约 170MB 才开局**（`main.js` 的 `machineVisualsReady` 要 claw + shell + 全部奖品 GLB + 全部装饰 GLB 就绪）。
2. **裸 Node 服务 = 无 gzip/brotli、无 HTTP/2**，文本类白白全量传。
3. **JS/CSS 在生产也走 `no-store`**，每次刷新重下 `three.module.js`（1.28MB）。

---

## 二、诊断数据（2026-10 实测）

### 2.1 首屏闸门体积

| 资源 | 体积 | 是否进首屏闸门 |
|---|---|---|
| `assets/machine/claw_parts.glb` | **36.95 MB** | ✅ 爪模型 |
| `assets/machine/placed/shell.glb` | **16.10 MB** | ✅ 机壳 |
| `assets/prizes-good-p2/`（33 件） | **74.8 MB** | ✅ 池内 14 件的显形+败露 ≈ 28 件、约 64MB |
| `assets/decor-low/`（20 件） | **51.72 MB** | ✅ `pool.decor.glbEnabled` 全换 Tripo |
| **小计** | **≈ 170 MB** | |
| `vendor/`（three + addons） | 4.5 MB（`three.module.js` 1.28MB） | ✅ 未压缩直出 |
| `assets/worlds/ending-*-500k.spz` | ~7.2 MB | ⏱ 第四幕才懒加载（做得对） |

> 单件也普遍偏重：`decor-low/ribbon_string.glb` 6.0MB、`disk_cork.glb` 4.4MB、`fish-rot.glb` 4.2MB。
> 单件 ≤1.5MB 的目标（`prize-pairs.json` 的 `lightweight` 规则）远远没达到。

### 2.2 传输层问题（`tools/devServer.mjs`）

```js
res.writeHead(200, { 'Content-Type': ..., 'Cache-Control': cache });
createReadStream(file).pipe(res);     // ← 零压缩直出
```

| 问题 | 后果 |
|---|---|
| 无 `Content-Encoding` | JS/CSS/`.gltf` 这些能压 70–80% 的文本全量传 |
| 裸 `http.createServer`，无 HTTP/2 | 单连接、55+ 个 ES Module 在高 RTT 跨境链路排队、队头阻塞 |
| `LONG_CACHE_EXT` 只含 glb/spz/img/audio/font | **`.js`/`.mjs`/`.css`/`.html` 全落 `no-store`** → 每次刷新重下 1.28MB 的 three.module.js |

### 2.3 死文件 / 源文件风险

`prototype/` 全量 **712.7 MB**，其中大量是 gitignore 的源文件：

| 目录 | 体积 | 说明 |
|---|---|---|
| `assets/machine/` | 234.88 MB | 含 21MB `.blend`、21MB `.blend1`、`archive/` 17MB 预览 |
| `assets/prizes-good/` | 104.2 MB | 非默认套（默认 `good-p2`） |
| `assets/generated/` | **50.41 MB** | `imageToModel-5d85d7df.glb` 40MB，**代码零引用** |
| `assets/prizes/` | 11.36 MB | legacy 套 |

> 走 git 部署不会带上这些（已 gitignore）。但 README 的 Netlify Drop / itch.io 流程是**拖 `prototype/` 文件夹**——那样会全传上去。
> `vendor/three180/`（r180，约 2MB）只被 `display-frame.html` 用，不影响主游戏首屏。

---

## 三、方案分层

| 档 | 范围 | 状态 |
|---|---|---|
| **A** | 首屏体积 + 传输（不改架构） | 🔵 本轮执行 |
| **B** | 部署架构：静态上 CDN、拆出 SSE | ⬜ 待定（跨境的根因解） |
| **C** | 运行时帧率 | ⬜ **暂缓**（本地加载完不卡） |
| **D** | 加载体验：分级加载 / 占位 | ⬜ 待定 |

### A 档 · 首屏体积 + 传输（本轮）

| # | 动作 | 预期收益 | 落地方式 |
|---|---|---|---|
| A2 | `devServer.mjs` 开 brotli/gzip（仅文本类，小文件内存缓存） | JS/文本省 ~70% | 改 `tools/devServer.mjs` |
| A3 | JS/CSS/HTML 从 `no-store` → `no-cache` + ETag；`?v=` 支持 immutable | 回头客 JS 不再重下（1.28MB → 304） | 改 `devServer.mjs` + `index.html` |
| A4 | 部署打包脚本，prune 死文件/源文件/旧套 | 拖文件夹部署少几百 MB | 新增 `tools/build-deploy.mjs` |
| A5 | 目录里单件 >1.5MB 的 GLB 做 Draco + 贴图降尺寸 | claw 37→~4MB、decor 52→~8MB、奖品 65→~15MB | 新增 `tools/gltf-optimize.mjs` |
| A1 | 重压 claw + shell | 首屏 **−45MB** | 同 A5 脚本 |

### B 档 · 部署架构（跨境的根因）

本项目 95% 是静态站，唯一真需要服务器的只有副屏 SSE（`collectDisplayHub.mjs`）。

- **静态上 CDN**（自带 brotli + HTTP/2 + 就近 PoP）：大陆受众选阿里云 OSS+CDN / 腾讯云 COS；或 **Netlify**（仓库已有 `.netlify` 配置，自带压缩 + HTTP/2 + 亚洲边缘）。Render 只留几十 KB 的 SSE hub。
- **彻底静态化**：副屏 SSE 换托管实时（Supabase Realtime / Pusher / Ably 免费档）→ 整站可上任意静态托管。
- Render 无大陆节点，CDN 是唯一能补上新加坡→大陆这笔账的办法（CDN 回源在新加坡无所谓，边缘离用户近就行）。

### C 档 · 运行时帧率（暂缓，仅留档）

- **pixelRatio 上限**：桌面现在允许 `×2`，叠加 bloom + grade 后处理，4K/Retina 下 fill-rate 爆炸 → 降到 `×1.5` 或自适应（`main.js` 的 `setPixelRatio`、`config.mobile.maxPixelRatio`）。
- **Bloom pass** 是全屏最贵的一趟（5 级 mip blur），现按 coarse-pointer 关 → 可改按设备/分辨率门控。
- **Draw call**：装饰约 100 件 + `comicFx` 描边复制一份网格 + 高模机壳爪 → 同形态合批/实例化（改造量大，放最后）。
- **终幕点云**：低端机可降 `100k` 档（`revealWorlds.js` 已备分档）。

### D 档 · 加载体验

- **分级加载**：别让 claw+shell+全奖品+全装饰一起闸门。先加载第一幕必需（shell + 面包/罐头/青菜三件 + claw）→ 开局 → 其余后台流式。
- 终幕 SPZ 已第四幕懒加载，保持。

---

## 四、执行状态

| # | 动作 | 状态 | 改动文件 |
|---|---|---|---|
| A2 | brotli/gzip 压缩 | ✅ 已改并实测 | `tools/devServer.mjs` |
| A3 | JS/CSS revalidate + `?v=` immutable | ✅ 已改并实测 | `tools/devServer.mjs`、`prototype/index.html`、`tools/build-deploy.mjs` |
| A4 | 部署打包脚本 | ✅ 已加并实测 | `tools/build-deploy.mjs` |
| A1/A5 | GLB 几何压缩 + 贴图降尺寸 | ⏳ **待运行**（需联网装 `@gltf-transform/*`） | `tools/gltf-optimize.mjs`，解码器接线已完成 |
| 内存安全（换态 dispose / 并发限流 / 预载改 fetch） | ✅ 已改并实测 | `prototype/src/glbMemory.js`（新）、`prizePool.js`、`config.js` |
| `?aa=` MSAA 档位旋钮 | ✅ 已加 | `post.js`、`perfHud.js` |
| B1 | 静态上 CDN / 拆 SSE | ⬜ 未开始 | — |
| C1–C4 | 运行时帧率 | ⬜ 暂缓（本地加载完不卡） | — |

**A1/A5 的解码器接线已完成**（不依赖联网，可先合）：
- `prototype/src/glbDecoders.js` —— 单例 `withCompressedDecoders()`，同时挂 meshopt + draco
- `prototype/vendor/addons/loaders/DRACOLoader.js` —— 从 three180 复制（只依赖 three 核心类）
- `prototype/vendor/addons/libs/meshopt_decoder.module.js` —— 24KB，wasm 内嵌，MIT
- `prototype/vendor/addons/libs/draco/` —— wasm + wrapper，取自 JupiterSR Developer Kit（Apache 2.0）
- 7 处 `new GLTFLoader()` 全部接上：`clawMachine` / `machineShellTripo` ×2 / `prizePool` ×2 / `prizePoolDecor` / `displayMain` ×3 / `revealMarble`

> 没压几何的 GLB 完全不受影响——两个 setter 只是给 GLTFLoader 多挂解码器，
> 文件里没有对应扩展时永远不触发。解码器都是**懒创建**的，不 preload、不发多余请求。
>
> **默认 codec 已改为 meshopt**（`gltf-optimize.mjs --codec meshopt|draco|none`），
> 理由见 6.3。meshopt 路径走 `gltfpack`，**不需要 @gltf-transform**；
> 只有 `--dry` 和 `--codec draco` 才需要。

---

## 五、开发模式 · 性能面板

**先结论：three.js 的 GLB 解析没有"我方能释放的 ArrayBuffer"。**
r170 的 GLTFLoader 走 `body.slice()` + 每个 bufferView 再 `slice()`，TypedArray 是 bufferView
的视图，gltf 结果里并不保留原始 ArrayBuffer。所以 JS 堆的大头是**解码后的几何属性**
≈ GLB 文件体积量级 —— 这正是面板上 300~400MB 的来路。

真正有效的三件事（`prototype/src/glbMemory.js`）：

| 改动 | 解决的 | 效果 |
|---|---|---|
| `disposeObject()` 在换态时释放旧模型 | 旧模型只 `remove` 不 `dispose`，GPU 资源要等 GC 才还 | 两态反复切换不再累积 |
| 桌面并发限流 `desktopGlbConcurrency: 6` | 桌面原本 28 个 GLB 全并行解析，每个 parse 的瞬时副本叠加 | 峰值内存成倍下降 |
| 预载改 `preloadIntoHttpCache`（只 fetch 不解析） | `THREE.Cache` 默认关闭，原预载解析完即弃，既没缓存又白解析 | 不产生常驻解析结果；线上 GLB immutable 能真正命中 |

⚠️ **dispose 的边界**：`Object3D.clone(true)` 是**共享** geometry/material 的，
所以只有换入独立 GLB 时才 dispose 旧模型（`prizePool.js` 用 `url` 是否为真区分）。
实测：换货 rot→manifest 后 **28 个 mesh 几何体完好**，无误伤。

---

## 六、关于 three.js 版本与解码器（问题的答案）

### 用法

```
?perf=1    只开面板
?gui=1     面板 + 调参面板
P          运行中随时显隐
```

新增 `prototype/src/perfHud.js`（默认不渲染、不占开销）+ `theme.css` 样式 +
`main.js` 主循环埋点 + `input.js` 的 `P` 键。

### 显示内容

FPS / 帧 ms（avg·worst·p99）/ **分段耗时（更新 vs 渲染）** /
draw call / 三角 / 几何·贴图数 / program / 缓冲尺寸与 pixelRatio /
JS 堆 / **真实 GPU 名**（SwiftShader 软渲染会标⚠）/ **资源加载时间线**。

> `?gui=1` 下 H 被调参面板占用，面板自己的开关是 **P**。

### 首次实测（2026-10-09，本机 SwiftShader 软渲染）

| 指标 | 值 | 读数 |
|---|---|---|
| FPS | 22.7 | 软渲染，不代表真机 |
| **分段** | **更新 0.90ms · 渲染 1.50ms** | 逻辑和后处理链都极便宜 |
| 几何 / 贴图 | 82 / **131** | 贴图数量偏多，显存隐患 |
| program | 25 | 正常 |
| JS 堆 | 227 MB | — |

**结论：44ms 的帧时间几乎全在 SwiftShader 光栅化，游戏逻辑不背锅。**
这正面回答了「本地加载完卡不卡」——逻辑侧 2.4ms，剩下的是软件渲染。
面板 GPU 一行直接暴露了这点，也解释了 `_e2e.mjs` 为何在无 GPU 环境必超时。

### 加载时间线（改优先级的关键证据）

| 阶段 | 时刻 |
|---|---|
| 池底装饰 GLB | +8296ms |
| 机壳 GLB | +14408ms |
| 爪 GLB | +17359ms |
| **奖品 GLB** | **+32882ms** |
| ▶ 上货条满 | +32884ms |

**奖品单独花了 15.5s，占总加载时长 47%，是最大单项**——
爪+壳 17s 就跑完了。所以 A5（奖品压缩）的收益被低估了，
**它才是首屏的第一优先级**，A1（爪/壳）排第二。

---

## 七、内存安全（iPad 向）

### 6.1 结论：先不合 180

`vendor/three180/` 只有 **12 个文件**，是相框 SDK（Jupiter）的最小依赖，
**不含主游戏需要的任何后处理件**：

| 主游戏需要 | three180 有吗 |
|---|---|
| `three.core.js` / `three.module.js` | ✅ |
| GLTFLoader / DRACOLoader / KTX2Loader | ✅ |
| OrbitControls / BufferGeometryUtils / WorkerPool | ✅ |
| `meshopt_decoder.module.js` / ktx-parse / zstddec | ✅ |
| EffectComposer | ❌ |
| RenderPass / ShaderPass / OutputPass | ❌ |
| UnrealBloomPass | ❌ |
| RoomEnvironment | ❌ |
| OBJLoader / lil-gui / gaussian-splats-3d | ❌ |

**合 180 ≠ 改 importmap 一行**：得先补齐上面 7 类 addon（三个都不在磁盘上，要联网抓 r180 发布包）。
这正好解释了为什么当初会分成两套——不是偷懒，是相框只要 loader 那几个文件。

### 6.2 升 180 不能解决解码器问题

**Draco 的解码器 wasm 在两个版本里都没有**——`DRACOLoader.js` 只是"加载器"，
真正干活的 `draco_decoder.wasm` / `draco_wasm_wrapper.js` 属于 `examples/jsm/libs/draco/`，
r170/r180 都不随 addons 分发。所以无论升不升 180，都得自己找 wasm（本次取自 JupiterSR Developer Kit）。

### 6.3 更好的答案：meshopt 而非 Draco

`three180/addons/libs/meshopt_decoder.module.js`：

- **单文件自带 wasm**（`wasm_base` base64 内嵌），零额外文件、零安装
- MIT，meshoptimizer 0.22
- **r170 的 GLTFLoader 原生支持**（`setMeshoptDecoder` / `EXT_meshopt_compression` 都在）

比 Draco 更适合本项目：

| | Draco | **meshopt** |
|---|---|---|
| 体积 | 较小 | **更小** |
| 解码速度 | 慢（熵解码） | **快 1–2 个数量级**（基本是位拆包） |
| 额外 wasm | 要（已从 JupiterSR 拿到） | **已在磁盘** |

这台发布机是 Render 免费实例（0.1 核），用户端还可能是老手机——
**Draco 会把"下载变快"又赔回去一部分在解码上**，meshopt 几乎不赔。
下一版 `gltf-optimize.mjs` 应把 `--codec meshopt` 设为默认，Draco 留作 `--codec draco` 备选。

---

## 八、原生 three.js 还能优化的（按性价比）

| 项 | 依据 | 预期 |
|---|---|---|
| ~~`powerPreference: 'high-performance'`~~ | `new THREE.WebGLRenderer` 没设 | ✅ **已加** `main.js` |
| ~~`antialias` 浪费~~ | 画面走 EffectComposer 渲到 RT | ✅ **已改**：canvas 关 MSAA，改在 `post.js` 给 composer RT 开 `samples:4`（触屏 0）——既省带宽又把抗锐角真正做好 |
| 贴图转 WebP | 实测 131 张 | 见下方「为什么 WebP 有效」 |
| meshopt 几何压缩 | 见 6.3 | 爪 37→~4MB，且解码不拖累弱 CPU |
| 描边复制网格 | `comicFx` 给奖池/爪复制一份做 inverted hull | draw call ≈翻倍 |
| 装饰约 100 件合批 | `pool.decor` 54+26+22 | 静态件用 `BatchedMesh`(r165+) 或 `mergeGeometries` |
| KTX2 / Basis | `KTX2Loader` 与 `ktx-parse`/`zstddec` 都在磁盘，但 **Basis 转码器 wasm 不在** | GPU 压缩贴图，VRAM 再降 4–8×；离线拿不到转码器，暂搁 |

### 为什么奖品贴图转 WebP 有效

Tripo 出的贴图基本是 **PNG（无损）**，对 3D 贴图来说是最大的浪费：

| | 磁盘体积 | 解码后 VRAM |
|---|---|---|
| PNG 1024² RGBA | 1.5~4 MB | 4 MB（不变） |
| **WebP 1024² 同等观感** | **0.1~0.3 MB** | 4 MB（不变） |

关键点：**WebP 降的是"下载 + 解码"，不降 VRAM**（位图尺寸没变）。
想降 VRAM 得同时降分辨率（`--tex 1024`）——这是两件事，`gltf-optimize.mjs` 两个都能做。

对本项目的收益链：

- 现在 **131 张贴图**，若都是 1024² PNG，光下载就是 **约 200MB**；转 WebP 后约 **26MB**
  —— 这正是首屏慢的主因之一（配合 6.4 的时间线，奖品是最大项）
- PNG 解码也明显慢于 WebP，能压掉加载闸门里的一部分解析耗时
- **不需要额外解码器**：three.js r170 的 GLTFLoader 原生支持 `EXT_texture_webp`
  （浏览器自己解 WebP），所以这条路离线可走——这正是它优于 KTX2 的地方
  （KTX2 要 Basis 转码器 wasm，磁盘上没有）

**但有个必须盯的代价**：这一作的叙事**全靠败露态贴图撑着**——发霉的霉斑、锈罐的锈迹、
烂菜的颜色，是黑场反转那一刻的全部信息量。WebP 是有损的，压狠了那一下就会变糊。
所以验收标准是：**先只转 `--only prizes`，用 Hub 同机位预览 A/B，重点看败露态那几件**，
看不出差别才全量。判据见你之前问的那套（单件 ≤1.5MB、四个镜头无失真）。

---

## 九、Babylon.js 值不值得换

**结论：不作为迁移选项，只作为参考。**

| | 说明 |
|---|---|
| 它是什么 | **完整游戏引擎**（物理、GUI、动画、材质、资产管线、Inspector 一把抓）；three.js 是**渲染库** |
| 它的优势 | 内置 Draco/meshopt/KTX2 自动解码、BatchedThinInstances、性能 Inspector、Havok 物理 |
| 换它的代价 | 鱼眼 GradeShader、漫画描边（inverted hull）、终幕 gaussian-splat、Marble collider 抽边、导演引擎、触屏/副屏全部要重写；`tools/` 的生成管线与 Hub 预览同理 |
| 时间成本 | 提交期做这件事等于推翻重来，**明确不建议** |
| 该抄它的 | ① 贴图压缩管线的做法（见上表）② 静态物件合批的思路 ③ 用引擎自带 Inspector 的度量思路——本项目已用 `perfHud` 顶上 |

> 真要换引擎，等参赛结束、且是因为"要上 Havok 物理/可视化编辑"这类**功能性**理由时再评估，
> 不要以"性能"为由——本项目逻辑侧 0.9ms，瓶颈在资产体积和软件渲染，换引擎治不了这两个。

---

## 十、验证方法

```powershell
# —— 压缩与缓存（生产模式 PORT 注入后才开）——
$env:PORT=8000; node tools/devServer.mjs
curl.exe -sI -H "Accept-Encoding: br, gzip" http://127.0.0.1:8000/src/main.js

# GLB 二进制：应无 Content-Encoding + immutable
curl.exe -sI -H "Accept-Encoding: br, gzip" http://127.0.0.1:8000/assets/prizes-good-p2/bread.glb

# 版本串：应 immutable + br
curl.exe -sI -H "Accept-Encoding: br" "http://127.0.0.1:8000/vendor/three.module.js?v=abc123"

# —— 体积与资产 ——
node tools/build-deploy.mjs                        # 712MB → 目标 <200MB
node tools/gltf-optimize.mjs --dry                 # 先体检，不动文件
node tools/_verify-variants.mjs                    # 压缩后必跑：两态配对回归

# —— 开发模式面板：看「分段」与「加载时间线」——
#    浏览器打开 http://127.0.0.1:8000/?perf=1
```

> ⚠️ **两个坑**
> 1. **PowerShell 会把 ETag 的引号吃掉**：ETag 形如 `W/"abc"`，PowerShell 传给 `curl.exe` 时
>    内层引号丢失，`If-None-Match` 永远不命中、返回 200 而非 304。测 304 请写成 .mjs 用 `fetch` 跑。
> 2. **无 GPU 环境下 FPS 不可信**：SwiftShader 软渲染下 22fps 不代表真机。
>    判断游戏自身开销请看「分段」里的 `更新 Xms · 渲染 Yms`，以及「加载时间线」——
>    这两项不随 GPU 变化。
>
> ⚠️ **坑三（11 号踩过，通用）**：**模块不能引用别的模块的局部 `const`**。
> 我在 `post.js` 里写了 `perf.setMsaaSamples(...)`，而 `perf` 是 `main.js` 的模块局部变量，
> `post.js` 根本看不见 → `ReferenceError: perf is not defined` → main.js 中断、`loadReady` 永不置位、
> 面板全空、只有 `started:true`。**症状极具误导性**：看起来像 TDZ、像 MSAA 参数、
> 像加载失败，其实是 import 作用域。
> 判据：报错信息说"X is not defined"而 X 明明在同项目另一个文件里声明过，就是这一类。
> 正确做法：要跨模块传就让持有方暴露（本例 `post.msaaSamples`），由 `main.js` 转交。

---

## 十一、仍待办

| 项 | 说明 |
|---|---|
| **A1/A5 实跑** | 需联网：`npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf sharp`，然后 `npm run optimize:assets -- --only prizes`。**奖品优先**（时间线显示它占 47%） |
| 装饰约 100 件合批 | `BatchedMesh`(r165+) 或 `mergeGeometries`，静态件收益大 |
| 描边复制使 draw call 翻倍 | `comicFx` 的 inverted hull；可考虑后处理描边替代 |
| 副屏 SSE 与静态拆分（B1） | 静态上 CDN + Brotli/HTTP2，SSE 留小 Node 服务；这是新加坡→大陆的根治方案 |
| `_e2e.mjs` 超时问题 | 根因是无 GPU 环境；正式测试应在有 GPU 的机器上跑，或给脚本加 `--gl=angle` 而非 swiftshader |

---

## 十二、滚动记录

- **2026-10-09** 建立文档。实测首屏闸门 ≈170MB（claw 37 + shell 16 + 奖品 ~64 + decor-low 52）。
- **2026-10-09** A2/A3/A4 落地并实测：
  - `vendor/three.module.js` 1,314,681 → 240,586 B，**省 81.7%**
  - 4/4 路径 304 重验证正确；无 `Accept-Encoding` 不压缩、二进制不压缩
  - SSE `/api/collect/*` 与 `/health` 未受影响
  - `build-deploy`：712MB → 357MB，剔除 356MB；54 条必在引用全部找到，37 条兜底引用识别为预期
  - 启动检查：`loadReady:true`、`__errs` 空、DRACOLoader 初始化成功
- **2026-10-09** 加开发模式性能面板 `?perf=1` / `P`：
  - 逻辑侧极便宜（更新 0.9ms / 渲染 1.5ms），帧时间全在 SwiftShader 光栅化
  - GPU 一行直接点明软渲染，解释 `_e2e.mjs` 无 GPU 环境必超时
  - 加载时间线揭示**奖品 GLB 是最大单项（15.5s / 47%）**，A5 优先级高于 A1
  - 贴图 131 张，显存隐患
- **2026-10-09** 解码器默认改 meshopt + 两个渲染器改动（用户确认继续 three.js）：
  - `gltfDecoders.js` 替代 `dracoLoader.js`，同时挂 meshopt + draco，**懒创建**
  - 复制 `meshopt_decoder.module.js`（24KB，wasm 内嵌）与 `DRACOLoader.js` 到 r170 addons
  - `gltf-optimize.mjs` 改 `--codec meshopt|draco|none`，默认 meshopt，走 gltfpack；
    **meshopt 路径不再依赖 @gltf-transform**
  - 修了两个脚本 bug：`--only claw` 因 basename 不匹配永远不中；Windows 上 `spawn('npx')` ENOENT
    （改用 `npx.cmd` + shell，并手动给带空格参数加引号）
  - `main.js`：`powerPreference: 'high-performance'`，`antialias` 改由 `post.js` 的 composer RT
    `samples:4` 负责（触屏 0）
  - 实测：`meshopt=true draco=true / decoderAPI=ok`、`loadReady:true`、`__errs` 空
  - ⚠️ 副作用观测：MSAA 让软渲染下「渲染」段 1.50ms → 2.60ms。真机 GPU 上应近零，
     但**这正是面板存在的意义**——上线后用 `?perf=1` 量一下，若变差就把 `?aa=` 设 2 或 0
- **2026-10-10** 用户 `chrome://gpu` 实机确认：双 GPU（Intel UHD 630 **ACTIVE** + GTX 1060 闲置），
  `Optimus: false`、`Has Discrete GPU: no`、`Intel GPU Generation: 9`、屏幕 **144Hz**。
  Chrome 对该卡自身打了 `msaa_is_slow` + `max_msaa_sample_count_4`
  → 我方默认 `samples:4` 正好压在官方上限，`?aa=` 参数因此而来。
  144Hz 意味着 `PARAMS.md` 的"60fps 验收"在此屏无意义，**改看帧 ms**。
- **2026-10-10** 内存安全三项 + `?aa=` 参数 + **修了一个线上级的 TDZ bug**：
  - `glbMemory.js`（新）：`disposeObject` / `preloadIntoHttpCache`
  - 换态 dispose 旧模型（仅独立 GLB 路径，避免误伤 `clone(true)` 的共享 geometry/material）
  - 桌面并发限流 `desktopGlbConcurrency: 6`（原先 28 个 GLB 全并行）
  - 预载从 `loadAsync` 改为 fetch-only——原实现因 `THREE.Cache` 默认关闭而白解析一次
  - `post.js`：`?aa=0|2|4|off` 覆盖 MSAA 档位；`perfHud` 缓冲行显示 `MSAA n` 自证生效
  - **TDZ 修复（本次最有价值的发现）**：`shellLoaded` / `paintLoading` 等加载闸门状态原先声明在
    文件第 1750 行之后，而 `shellReady.then()` 可能在模块顶层还没执行到那儿时就 resolve
    （`loadPlacedShell` 里 `await enqueueRendererCompile` 可能同步返回），
    于是线上随机报 `Cannot access 'shellLoaded' before initialization`、加载闸门卡死。
    已把全部加载闸门状态提升到所有 GLB Promise 之前。**本地只是时序侥幸没触发。**
  - 实测：换货 rot→manifest 后 **28 个 mesh 几何体完好**，`disposed=2`，`__errs` 空

---
