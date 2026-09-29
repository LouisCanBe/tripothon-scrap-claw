# Jupiter Interlace SDK 开发者指南

**版本 1.0.0 · 首版交付 · 2026-09-11**

SDK 接收 GLB、已有 Three.js 场景，或已经渲染好的多视点纹理，将其转换成裸眼 3D 屏幕需要的子像素交织输出。你仍然控制自己的场景、相机、模型业务和界面。

## 1. 选择接入方式

| 你的项目 | 推荐入口 | 需要自己负责的部分 |
| --- | --- | --- |
| 从零创建 GLB 查看器 | `JupiterViewer` | 容器、模型地址、设备校准 |
| 已有 Three.js 应用或游戏 | `InterlaceRenderer.render(scene, camera)` | 场景更新、输入控制、渲染循环 |
| 自定义渲染流程 | `InterlaceRenderer.renderViews(callback)` | 按 SDK 给出的视点信息渲染线性颜色纹理 |
| 已有多视点图集 | `InterlaceRenderer.compositeAtlas(input)` | 图集及准确的布局、颜色编码 |
| 只需要算法或配置 | `jupiter-interlace-sdk/core` | 渲染与平台适配 |

`InterlaceRenderer` 是基于 Three.js 的 WebGL2 后端；`core` 是没有 Three.js 依赖的纯 TypeScript/JavaScript 算法。首版没有原生 Android AAR、Unity 或 Unreal 插件。

## 2. 先运行随包示例

完整开发包内已构建好所有运行文件，不必先安装 npm 依赖。安装 Node.js 20.19+ 后：

```sh
node scripts/serve.mjs
```

Windows 可以直接双击 `Start-Demo.cmd`。打开终端显示的地址：

```text
http://127.0.0.1:4173/examples/glb-viewer/
```

页面默认使用 2D 预览，自动加载带贴图、透明材质、骨骼和动画的示例 GLB。点击“打开 GLB”选择本地文件，或输入模型 URL。右侧可切换交织输出并调整参数。

另有两个小示例：`/examples/existing-scene/` 和 `/examples/atlas/`。服务只监听本机；部署到设备时应将示例和 dist 放到你自己的静态服务器上。

不要用 `file://` 直接打开 GLB 示例。ES 模块、模型 fetch、Web Worker 和 WASM 解码器需要 HTTP/HTTPS 环境。指南 HTML 本身可以直接双击阅读。

## 3. 接入 npm 项目

把交付的 `.tgz` 放进项目目录，然后安装。无需等待 npm 公共发布：

```sh
npm install ./jupiter-interlace-sdk-1.0.0.tgz three@0.180.0
# TypeScript 项目还需要 Three.js 类型声明：
npm install -D @types/three@0.180.0
```

首版固定使用 Three.js 0.180.0，以保证相机、颜色管线及加载器行为一致。不要在同一个场景中混用不同 Three.js 版本。

### 3.1 页面容器

```html
<div id="viewer" style="width:100%;height:600px"></div>
<input id="model-file" type="file" accept=".glb">
<div id="calibration"></div>
<p id="load-status" role="status"></p>
```

容器必须有非零高度。全屏交织时，建议让显示容器独占目标屏幕。页面里的菜单可以在模型预览时显示，最终光学校准应在全屏布局下进行。

### 3.2 JavaScript / TypeScript

```ts
import { JupiterViewer, createCalibrationPanel } from 'jupiter-interlace-sdk';

const container = document.getElementById('viewer')!;
const status = document.getElementById('load-status')!;
const viewer = new JupiterViewer({
  container,
  calibration: {
    pitch: 0.27777, tan: 10, offset: 2, // 原项目示例值，请替换为设备校准值
    order: 'forward', subpixelOrder: 'RGB', rotation: 0,
  },
  render: {
    mode: '2d', views: 9, viewWidth: 640,
    viewSpacing: 0.006, focusDistance: 3,
    toneMapping: 'aces', exposure: 1,
  },
  decoders: {
    dracoDecoderPath: '/jupiter-decoders/draco/',
    ktx2TranscoderPath: '/jupiter-decoders/basis/',
  },
  onError(error) { status.textContent = error.message; },
});

const panel = createCalibrationPanel(
  viewer.interlacer,
  document.getElementById('calibration')!,
);

try {
  await viewer.loadGLB('/models/product.glb', {
    onProgress(p) {
      status.textContent = p.ratio === null
        ? `已下载 ${p.loaded} 字节`
        : p.ratio === 1 ? '正在解析模型…' : `下载 ${Math.round(p.ratio * 100)}%`;
    },
    onLoad(asset) {
      status.textContent = `加载完成，${asset.animations.length} 组动画`;
    },
  });
} catch (error) {
  // Promise 会拒绝；onError 负责展示错误，这里按业务记录或恢复。
  console.error(error);
}

document.getElementById('model-file')!.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.[0]) return;
  try { await viewer.loadGLB(input.files[0]); }
  catch (error) { console.error(error); }
  input.value = '';
});

// 完成设备校准后启用：
// viewer.setOptions({ mode: 'interlaced' });

// 页面/组件销毁时：先清理外部监听，再执行以下两行。
// panel.dispose();
// viewer.dispose();
```

`JupiterViewer` 默认会创建渲染循环、轨道控制器、半球光和方向光。已有自定义灯光时可以传 `defaultLights: false`。加载模型后默认自动居中、适配相机并播放第一条动画。

`frameModel()` 不改变模型缩放，保留场景单位；它会重新设置相机位置、近远裁剪面和 `focusDistance`，但不改变 `viewSpacing`。如需保持业务相机或预设焦平面，在 `loadGLB` 中传入 `autoFrame: false`，或加载完成后应用自己的参数。

### 3.3 复制解码器到公共目录

模块化构建被 Vite/Webpack 等打包后，解码器不能靠 npm 包内的相对路径自动出现在网站上。请完整复制：

```text
node_modules/jupiter-interlace-sdk/dist/decoders/
  → 你的项目 public/jupiter-decoders/
```

跨平台复制命令（在项目根目录运行）：

```sh
node -e "require('node:fs').cpSync('node_modules/jupiter-interlace-sdk/dist/decoders','public/jupiter-decoders',{recursive:true})"
```

上例已把 `decoders` 的 URL 配到这个位置。路径必须以 `/` 结尾；部署在子路径时应加上真实的应用 base path。

普通 GLB 不会请求 Draco/Basis 解码文件。Meshopt 解码器已随模块加载。Draco GLB 会按需加载本地 JS/WASM，KTX2/Basis 纹理会按需启动 Worker 转码。静态服务器需能返回这些文件，WASM 推荐使用 `application/wasm`。有 CSP 时需要允许相应的本地脚本、`blob:` Worker、WASM 编译，以及 GLB 嵌入图像使用的 `blob:`；具体策略与站点安全配置一起设置。

## 4. 不使用 npm / 构建工具

把完整 `dist` 复制到静态站点。以下是最小 HTML，模型路径按实际部署调整：

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#viewer{margin:0;width:100%;height:100%;overflow:hidden}</style>
<div id="viewer"></div>
<script type="module">
  import { JupiterViewer } from './dist/jupiter-interlace.standalone.js';
  const viewer = new JupiterViewer({
    container: document.querySelector('#viewer'),
    render: { mode: '2d' },
    onError: error => console.error(error),
  });
  try { await viewer.loadGLB('./models/product.glb'); }
  catch (error) { document.body.append(String(error)); }
  window.addEventListener('pagehide', () => viewer.dispose(), { once: true });
</script>
```

独立版内置 Three.js 和加载器，无需 CDN/import map，但压缩资源仍需要保留 `dist/decoders/`。如果自己创建 Three.js 对象，请从同一独立包导入 `THREE`：

```js
import { THREE, InterlaceRenderer } from './dist/jupiter-interlace.standalone.js';
```

不要再加载另一份 CDN Three.js。独立版是 ESM，必须使用 `type="module"`，不是全局 `window.Jupiter` 脚本。

## 5. 接入已有 Three.js 场景

无需经过 GLB 加载器。已有网格、粒子、动画、灯光和模型格式均由你的应用处理：

```ts
import * as THREE from 'three';
import { InterlaceRenderer } from 'jupiter-interlace-sdk';

// renderer、scene、camera、mixer 由你的应用创建。
renderer.outputColorSpace = THREE.SRGBColorSpace;
const interlacer = new InterlaceRenderer(renderer, {
  calibration: { pitch: 0.27777, tan: 10, offset: 2 },
  render: { views: 9, viewWidth: 640, viewSpacing: 0.006, focusDistance: 3 },
});
let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  mixer.update(dt);           // 每个显示帧更新一次动画
  // updatePhysics(dt);       // 业务模拟同样只更新一次
  interlacer.render(scene, camera);
});

// 销毁时：renderer.setAnimationLoop(null); interlacer.dispose();
// SDK 不会销毁你传入的 scene、camera 或 renderer。
```

相机需为 `PerspectiveCamera`。SDK 复制相机世界变换并生成平行、离轴投影视点，不修改传入相机。若相机在父节点下，也会读取其世界位置和朝向；不要给相机父级施加非均匀缩放。

默认输出占据整个 drawing buffer。你的应用需维持其物理像素尺寸，如 `renderer.setPixelRatio(devicePixelRatio)` 并使用实际容器 CSS 尺寸调用 `setSize`。最终画面不应再经过 CSS transform、降采样、抗锯齿、模糊或会混合相邻像素的后处理。特效应在每个视点交织前完成。

每个视点会调用一次场景渲染。不要在 `onBeforeRender` 中推进动画时间或物理状态，否则各视点会来自不同时间。30 视点通常需要更多 GPU 绘制，SDK 不承诺固定帧率，也不自动替你改变场景 LOD。

### 5.1 交互时降低视点数

以下策略由应用显式控制；光学校准参数不随画质档位改变：

```js
let settle;
function onStart() {
  clearTimeout(settle);
  interlacer.setOptions({ views: 3, viewWidth: 320 });
}
function onEnd() {
  settle = setTimeout(() => interlacer.setOptions({ views: 30, viewWidth: 720 }), 180);
}
controls.addEventListener('start', onStart);
controls.addEventListener('end', onEnd);
// 清理时 clearTimeout(settle)，并移除这两个监听。
```

### 5.2 自定义视点渲染

```js
interlacer.renderViews((target, view) => {
  // view = { index, logicalIndex, offset, count, width, height }
  // SDK 已绑定并清空 target：HalfFloat 线性颜色纹理，带深度缓冲。
  // 使用 view.offset 构造横移相机与离轴投影，再将该视点画到 target。
  // 可以在这里调用自己的视点后处理；结果保持场景线性颜色。
  renderMyViewToTarget(target, view);
});
```

回调必须同步，不支持返回 Promise。内部会完整生成所有视点后再发布输出。失败时不会发布未完成帧。SDK 会恢复它改动的渲染目标、viewport、scissor、clear color/alpha、autoClear、toneMapping/exposure 和 XR enabled 状态；自行操作的其他 GPU/渲染器状态由回调负责恢复。

## 6. 接入纹理图集

图集中的每格是一张完整视点图像，按从左到右、从下到上的顺序排列，所有格子尺寸相同，没有额外 padding。下面是 3×3 的 9 视点示例：

```js
interlacer.setOptions({ mode: 'interlaced' });
interlacer.compositeAtlas({
  texture: atlasTexture,
  width: 1920, height: 1080,
  columns: 3, rows: 3, views: 9,
  encoding: 'srgb',
});
```

宽高必须是真实纹理尺寸，并能整除行列数。`views` 为 1–30，不能超过格子数。`encoding: 'srgb'` 表示已经完成色调映射和显示编码，不再应用曝光；`'linear'` 表示场景线性 HDR/LDR，将按 SDK 参数完成曝光和色调映射。

带 `THREE.SRGBColorSpace` 标记的 sRGB 纹理会先由 GPU 解码，SDK 会重新编码而不重复色调映射；存放原始显示字节的 `DataTexture` 可使用 `THREE.NoColorSpace`。请不要错误标记线性数据为 sRGB。图集的 `flipY` 和行顺序应由供给方统一。

图集和输出纹理应属于同一个 WebGL 上下文。SDK 不会释放外部传入纹理，也不支持跨上下文直接共享纹理对象。

## 7. 参数参考

### 7.1 屏幕校准 `setCalibration()`

| 参数 | 类型 / 示例 | 含义 |
| --- | --- | --- |
| `pitch` | 有限数，`0.27777` | 原 v0.17.1 Pitch，纵向相位系数。不是毫米单位的光栅间距 |
| `tan` | 有限数，`10` | 原 v0.17.1 Tan，子像素坐标中的周期。允许负数；0 为原算法兼容回退到逻辑视点 14 |
| `offset` | 有限数，`2` | 交织相位偏移，与 tan 使用相同的相位单位 |
| `order` | `forward / reverse / pingpong` | 正向、反向或原算法 59 相位往返映射 |
| `subpixelOrder` | `RGB / BGR` | 每个物理像素的通道排列 |
| `rotation` | `0 / 90 / 180 / 270` | 将输出物理坐标映射至校准坐标，不旋转模型画面 |

公式沿用原项目：在旋转后的坐标中，左上角为原点，`base = offset + y × 3 × pitch + (width − 1 − x) × 3`。RGB 分别计算 `base+2`、`base+1`、`base` 对应的逻辑视点，再选择对应通道。

首版固定 30 个逻辑视点，中心基准保持原算法的 **14**，没有悄悄改成 14.5。当前源码中的 Tan 与历史其他版本的着色器命名不一定一致；旧配置只按 **v0.17.1 应用参数**迁移。

CPU 使用 JavaScript 双精度，GPU 使用高精度 float；极大参数或恰好落在量化边界上的值可能出现浮点精度差异。现场校准使用正常设备参数，不把极端数值当作跨 GPU 的精确索引编码。

### 7.2 场景和质量 `setOptions()`

| 参数 | 默认值 | 约束 / 用途 |
| --- | --- | --- |
| `views` | `9` | 实际渲染视点数，整数 1–30；可选 3/5/9/30 档位 |
| `viewWidth` | `640` | 单视点最大宽度，正整数；按输出长宽比计算高度并受 GPU 纹理上限约束 |
| `viewSpacing` | `0.006` | 相邻逻辑视点的相机间距，≥0，使用你的场景单位 |
| `focusDistance` | `3` | 零视差平面到中心相机的前向距离，>0，使用场景单位 |
| `mode` | `interlaced` | `interlaced`、`2d` 或 `view` |
| `previewView` | `14` | `view` 模式预览的逻辑视点，整数 0–29 |
| `toneMapping` | `aces` | `none`、`reinhard`、`aces`，交织前对每个视点分别处理 |
| `exposure` | `1` | 曝光倍率，>0，主要用于线性输入 |

30 个逻辑视点定义光学映射，`views` 定义实际绘制多少幅场景。9 个实际视点是对 30 个逻辑位置的近似采样，不等于 30 个真实视点。少量视点不会凭空恢复缺失角度。

所有数值在 CPU 侧验证；非法值抛出错误，不会静默修改成另一个合法值。可以用自己的滑块或数字输入框调用 setter，无需使用随包面板。

```js
viewer.setCalibration({ offset: 2.5, tan: 10 });
viewer.setOptions({ viewSpacing: 0.012, focusDistance: 4, views: 30 });
```

## 8. 配置保存、迁移与动画

```js
localStorage.setItem('device-A', viewer.exportProfile());
const saved = localStorage.getItem('device-A');
if (saved) viewer.importProfile(saved);

// 兼容旧项目的平面配置：tan 保持原名，spacing → viewSpacing，focus → focusDistance。
viewer.importProfile({ pitch: 0.27777, tan: 10, offset: 2, spacing: 0.006, focus: 3, order: 0 });

// 动画：默认只播放首条；可以按索引或名称切换。
if (viewer.model?.animations.length) viewer.model.play(0);
viewer.model?.pause();
viewer.model?.resume();
```

新 JSON 带 `schemaVersion: 1` 和 `algorithm: 'jupiter-30-v1'`，包含 `calibration`、`render` 两组设置。未知版本会拒绝导入。设备分辨率、序列号等业务信息可以由你的应用另行保存；SDK 不会自动判断设备型号。

`viewer.loadGLB()` 会自动取消上一次尚未完成的请求，解析完成后才替换旧模型；失败会保留旧模型。`onProgress` 的 100% 仅表示 GLB 主文件字节到齐，不表示纹理解码或 GPU 上传已完成，真正加载结束以 Promise resolve / `onLoad` 为准。缺少 Content-Length 时 `ratio` 为 null。

可传 `AbortSignal` 取消加载。GLTFLoader 已开始的解析、子资源加载与解码任务可能继续到完成，但取消后的模型不会被挂到页面，资源会清理。远程主 GLB fetch 支持 `credentials`；其子资源的鉴权/CORS需由 `LoadingManager` 或服务器策略另行配置。本地 File 最适合纹理和缓冲都内嵌的 GLB。

独立使用 `GLBLoader` 返回的 `GLBAsset` 由调用方释放；通过 `JupiterViewer.loadGLB` 得到的 asset 由 viewer 管理，替换、unload 或 dispose 会释放它。不要把该 asset 的材质/贴图长期共享给其他场景后再销毁它。

`viewer.dispose()` 清理 SDK 模型、控制器、观察器、RAF、解码器和 canvas；你额外添加到 `viewer.scene` 的外部模型或环境贴图仍需自己释放。

## 9. 屏幕输出与性能

1. 先确认普通 2D 模型正常显示，再切换交织。
2. 在目标裸眼屏上全屏，使用正确的物理分辨率、方向和子像素排列。
3. 输入设备校准值，调节 Offset，再结合测试图调整 Pitch 和 Tan。
4. 在多视点映射稳定后，调整场景的视点间距与焦平面。
5. 保存设备预设，并在该设备实际观看位置检查串扰、深度和视角切换。

SDK 的交织原点是 canvas drawing buffer 的左上角，不是整个操作系统桌面原点。窗口偏移、浏览器缩放、屏幕旋转、CSS 缩放及操作系统合成都可能改变物理排列。因此不能把窗口里的校准值无条件复用于另一个全屏布局。

显示画布必须按物理像素 1:1 输出；降低 `viewWidth` 可以减少场景渲染成本，但不要降低最终交织 framebuffer 分辨率。输出为不透明 sRGB，不是可随意缩放混合的 RGBA UI 图片。

内部逐视点复用一个带深度的 HalfFloat 目标，配合两个 RGBA8 输出缓冲，不会因为 30 视点而申请 30 张全屏纹理。颜色缓冲估算见 `interlacer.getStats().estimatedBufferBytes`；此值不包含模型、贴图、驱动、阴影或后处理分配。`cpuMs` 是 CPU 提交时间，不是 GPU 时间，也不是 FPS。

模型动画每帧更新一次，然后同步绘制所有视点。首版不提供跨多帧渐进生成、自动 GPU 预算或保证 60 FPS 的调度；重场景应减少视点/单视点分辨率并优化场景自身。

发生 WebGL context lost 时，高层 viewer 停止并通过 onError 报告。恢复后可调用 `viewer.start()`；若业务资源未能恢复，重新创建 viewer 并加载模型。

## 10. 常见问题

| 问题 | 排查方式 |
| --- | --- |
| 空白或初始化报错 | 容器高度、WebGL2、EXT_color_buffer_float、浏览器硬件加速、控制台错误 |
| 模型能下载但一直没显示 | 等待解析完成；检查嵌入贴图、扩展、解码器 404 和 CSP |
| 远程模型 fetch 失败 | URL、HTTP 状态、CORS、HTTPS 页面访问 HTTP 资源、鉴权 |
| 本地 GLB 丢贴图 | 检查是否引用了同目录外部图片；优先导出纹理内嵌的 GLB |
| 模型很黑 | 默认灯光是否关闭、环境光/环境贴图、材质金属度、曝光；不是先调整光学校准 |
| 正常屏幕上出现彩边/条纹 | 交织图本来是给匹配光学屏的，普通屏用 2D 或单视点检查模型 |
| 立体方向相反 | 检查 order；不要同时改相机方向和光学参数来掩盖问题 |
| 全屏后效果变化 | 重新检查物理尺寸与相位原点；全屏布局重新校准 |
| React/路由切换后多个 canvas | 不要在每次 render 创建 viewer；在 effect 清理 panel、监听与 viewer |
| SSR 报 document/window 不存在 | 在浏览器客户端挂载后创建 viewer；SSR 阶段不要实例化 |
| 30 视点卡顿 | 先降至 9 或 3，降低 viewWidth；保留最终物理输出分辨率 |

PBR 外观取决于模型、灯光和环境，不保证与创作软件逐像素一致。扩展支持以固定版本加载器与实际测试为准；首版验证了普通/Draco/Meshopt/KTX2 GLB、贴图、透明、层级及骨骼动画，不声称覆盖所有 glTF 扩展、正交相机、WebXR 或多 GPU 上下文。

## 11. 使用 AI 开发：可以直接复制的提示词

先把 SDK 的 `.tgz`、这份指南和 `dist/types` 提供给 AI。已有项目还应提供 `package.json`、创建场景/相机/渲染循环的文件及相关目录结构。提示词中的路径、框架和设备参数请替换为真实值。

### 提示词 A：从零做 GLB 查看器

```text
请使用我提供的 Jupiter Interlace SDK 1.0.0 创建一个 GLB 查看器。
先阅读 docs/developer-guide.md 和 dist/types/index.d.ts，再编写代码。
SDK 安装文件是 ./jupiter-interlace-sdk-1.0.0.tgz，Three.js 固定 0.180.0。
使用 JupiterViewer；提供 URL 加载、本地 .glb 选择、加载进度、错误提示、
旋转/缩放/平移、适配视角、动画播放暂停、2D/交织切换和全屏按钮。
使用 createCalibrationPanel，开放 pitch、tan、offset、order、
subpixelOrder、rotation、views、viewWidth、viewSpacing、focusDistance。
把 dist/decoders 复制到 public/jupiter-decoders，显式配置解码器路径。
默认先用 2D 预览；屏幕参数未知时标记为待填写，不宣称已经校准。
正确处理加载异常、组件销毁和重复加载。不要使用 PLY/Spark 或自行重写交织公式。
完成后运行构建，在浏览器验证本地 GLB、参数变化、动画和页面清理。
列出修改文件、运行命令、验证结果和仍需真机校准的项目。
```

### 提示词 B：给现有 Three.js 项目加交织

```text
请把 Jupiter Interlace SDK 1.0.0 接入我现有的 Three.js 场景。
先阅读 SDK 指南和类型，再检查现有 renderer、scene、PerspectiveCamera 与渲染循环。
复用这些对象，通过 InterlaceRenderer.render(scene, camera) 输出。
每个显示帧只更新一次动画与物理；不要在逐视点回调中推进时间。
使用 sRGB 输出，维持 drawing buffer 的物理像素尺寸；交织后不做缩放/模糊/FXAA。
保留业务模型加载方式，不强制它走 SDK GLB 加载器。
校准参数由应用提供 JSON；加入 2D/交织切换和可调视点间距、焦平面、视点数。
若现有 Three.js 版本不是 0.180.0，先说明兼容差异，不偷偷混装两份引擎。
接入后验证遮挡、相机不被改写、动画同步、参数保存和资源释放。
```

### 提示词 C：React / Vue 组件封装

```text
请按我项目的框架封装一个可复用的 JupiterGLBViewer 组件。
基于随附 SDK 的 JupiterViewer，先查阅实际 API，不臆造 loadModel/setPitch 等方法。
props 接受 GLB URL、calibration、render 参数；输出加载完成、进度和错误事件。
挂载后创建一次 viewer；URL 变化时调用 loadGLB，参数变化时调用 setter。
React 要使用 ref/effect 并处理 StrictMode；Vue 要在 onMounted/onBeforeUnmount 中管理生命周期。
仅在客户端实例化，SSR 不访问 document/window。卸载时取消加载并释放 viewer 和面板。
给出解码器 public 路径配置，并编写验证：重复挂载只有一个 canvas，
快速切换 URL 不显示过期模型，销毁后不再执行 RAF。
```

### 提示词 D：接入已有多视点图集

```text
我已有多视点图集，请用 Jupiter Interlace SDK 的 compositeAtlas 接入。
先向我的现有渲染代码确认纹理宽高、行列、视点数量、Y 方向和颜色编码。
图集各格尺寸相同，按左到右、下到上排列；views 范围是 1–30。
设置 mode: 'interlaced'，按真实输入选择 encoding: 'srgb' 或 'linear'，
检查 texture.colorSpace，避免重复曝光/色调映射/颜色编码。
不要把一张普通单视角图当成完整 30 视点，也不要跨 WebGL context 直接共享纹理。
以固定色彩的视点图先验证映射，再替换成业务纹理。
```

### 提示词 E：设备校准与调参页

```text
请为 Jupiter Interlace SDK 做设备校准页。先读取指南中的参数定义。
保留原 v0.17.1 的映射：旧 pitch → pitch，旧 tan 保持 tan，旧 offset → offset。
分开“屏幕校准”和“场景立体效果”；Pitch 不是毫米光栅间距。
支持有限数校验、负 offset、配置导入导出和设备预设命名。
tan=0 要明确提示它是兼容模式的中心视点回退，不是有效的多视点校准。
提供 2D、单视点和交织测试图，显示 drawing buffer 的物理宽高与 devicePixelRatio。
全屏后重新核对坐标原点；不能根据普通显示器截图宣称光学效果已通过。
设备参数使用我提供的值，未知的值保留待填写。
```

### 提示词 F：排查接入错误 / 性能问题

```text
请诊断我项目的 Jupiter Interlace SDK 接入问题，先看指南、控制台与网络记录。
先确认故障位于 GLB 下载、解析/解码、单视点渲染还是最终交织。
收集：SDK/Three.js 版本、WebGL 扩展、模型大小、views、viewWidth、
物理输出尺寸、getStats() 和具体异常。cpuMs 不是 GPU 时间或 FPS。
如果模型在 2D 正常，优先排查校准、原点、DPR、颜色编码和后处理；
如果 2D 也失败，优先排查模型、材质、灯光、相机、CORS与解码器路径。
性能优化可减少实际视点和单视点分辨率，但不能降低最终交织画布物理分辨率。
给出最小修复，运行相关验证，并说明真机上还需检查哪些内容。
```

### 让 AI 交付前核对

- 代码使用的是 SDK 真实导出 API，安装路径和解码器 URL 可访问。
- 本地与 URL GLB 可加载，失败能显示错误，重复加载不残留旧模型。
- 2D/交织切换、参数实时调整、配置导入导出可用。
- 动画在所有视点间使用同一模拟时刻，页面退出后资源得到清理。
- 最终画布符合物理尺寸；普通浏览器测试和目标裸眼屏校准分开记录。

## 12. API 快速索引

| 对象 | 主要成员 |
| --- | --- |
| `JupiterViewer` | `scene`、`camera`、`renderer`、`controls`、`interlacer`、`loader`、`model` |
| `JupiterViewer` 方法 | `loadGLB`、`frameModel`、`setCalibration`、`setOptions`、`exportProfile`、`importProfile`、`onFrame`、`resize`、`render`、`start`、`stop`、`unload`、`dispose` |
| `InterlaceRenderer` | `render`、`renderViews`、`compositeAtlas`、`setCalibration`、`setOptions`、`getProfile`、`exportProfile`、`importProfile`、`getStats`、`outputTexture`、`subscribe`、`dispose` |
| `GLBLoader` | `load(source, options)`、`dispose()` |
| `GLBAsset` | `scene`、`gltf`、`animations`、`mixer`、`play`、`pause`、`resume`、`update`、`isPaused`、`dispose` |
| `createCalibrationPanel` | 返回 `{ element, dispose }` |
| `core` | `createProfile`、`parseProfile`、`logicalView`、`subpixelViews`、`renderedView`、`viewLogicalIndex`、验证函数及默认值 |

完整签名和参数类型以随包 `dist/types/` 为准。`outputTexture` 是当前完整帧的只读显示编码纹理，双缓冲会在下一帧交换；不要销毁或长期缓存其引用作为永久图片。

## 13. 来源与验证范围

交织相位和相机约定提取自用户提供的 `Jupiter-World-Viewer-v0.17.1-source.zip` 内 `JupiterWorldViewer/web/main.js`。实现保留旧映射，并增加场景格式解耦、独立 GLB 加载、配置验证、颜色处理和生命周期管理。

运行依赖固定为 Three.js r180。加载器配置参考 [Three.js GLTFLoader 官方说明](https://threejs.org/docs/pages/GLTFLoader.html)，本包的实际实现以固定版本源码与测试为准，不能把官方最新版新增扩展当作本包已支持的功能。

软件验证记录见 `docs/validation.md`。硬件光学效果、设备性能和目标屏实际串扰尚需在对应设备上验证。第三方组件的许可证随包保留，见 `THIRD_PARTY_NOTICES.txt`。


本中文版的文档、示例界面和 SDK 提示采用中文。API 标识、资源路径、技术名称及第三方许可证原文保持原样。
