# Jupiter SDK · AI 开发提示词

详见 developer-guide.md 和 dist/types。

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

