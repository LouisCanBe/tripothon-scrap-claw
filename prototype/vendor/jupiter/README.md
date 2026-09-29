# Jupiter Interlace SDK 1.0.0 · 完整中文开发包

本包包含 SDK 以及开发接入所需的全部配套内容。

## 从这里开始

先打开“打开这里.html”查看内容导航。运行完整示例：安装 Node.js 20.19+ 后双击 Start-Demo.cmd，或执行以下命令：

```sh
node scripts/serve.mjs
```

浏览器打开终端显示的示例地址。示例已构建完成，不需要先安装 npm 依赖。接入自己项目时安装根目录的 TGZ。

## 开发包内容

| 内容 | 路径 | 用途 |
| --- | --- | --- |
| SDK 构建文件 | [dist/](dist/) | 模块化 SDK、独立浏览器构建、核心算法模块 |
| npm 安装包 | [jupiter-interlace-sdk-1.0.0.tgz](jupiter-interlace-sdk-1.0.0.tgz) | 安装到开发者自己的项目 |
| 类型声明 | [dist/types/](dist/types/) | 完整 TypeScript API 签名 |
| GLB 解码器 | [dist/decoders/](dist/decoders/) | Draco 与 Basis/KTX2；Meshopt 已集成 |
| 开发者指南 | [docs/developer-guide.html](docs/developer-guide.html) | HTML 与 Markdown 接入指南 |
| AI 开发提示词 | [docs/AI-PROMPTS.md](docs/AI-PROMPTS.md) | 六组可直接使用的开发提示词 |
| GLB 完整示例 | [examples/glb-viewer/](examples/glb-viewer/) | 本地/地址加载、动画、调参、全屏、测试图 |
| 已有场景示例 | [examples/existing-scene/](examples/existing-scene/) | 接入普通 Three.js 场景 |
| 图集交织示例 | [examples/atlas/](examples/atlas/) | 接入已有多视点纹理 |
| 全部示例模型 | [examples/assets/](examples/assets/) | 普通、Draco、Meshopt、KTX2 四个 GLB |
| 示例参数 | [profiles/sample-profile.json](profiles/sample-profile.json) | 可直接导入的参数配置 |
| 运行工具 | [Start-Demo.cmd](Start-Demo.cmd) | 另附 scripts/serve.mjs 本地服务器 |
| 验证记录 | [verification/README.md](verification/README.md) | 完整验证记录和机器可读结果 |
| 界面预览 | [preview/](preview/) | 指南、模型及移动端界面预览 |
| 许可信息 | [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) | 第三方说明与许可原文 |

API 标识、资源路径、Pitch/Tan/Offset 和第三方许可原文保持原样。设备光学效果仍需在目标裸眼屏上校准。
