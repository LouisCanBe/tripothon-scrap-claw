# 拾荒娃娃机（TripoThon 2026.9.6）

Web3D 抓娃娃机叙事 Demo：四幕方框画幅（记忆）+ 终幕 16:9 故障转场露废墟实景（现实反转）。
全部美术资产走 Tripo AI 生成，机制边界锁死（三爪抓取 / 三视角 / 鱼眼弱第一人称）。
完整项目方案（产品、运营、盲盒与共创）见 `PROJECT-方案说明.md`；设计文档见 `outline.md`；参赛与裸眼 3D 见 `CONCEPT-参赛与裸眼3D.md`；调参见 `prototype/PARAMS.md`；界面/模型二开见 `prototype/GUIDE.md`。

## 启动（玩 / 调试）

需要一个静态文件服务器（ES Module 不能双击 html 直接开）：

```powershell
node tools/devServer.mjs 8000    # 推荐：no-store 禁缓存，改代码普通刷新即生效
node tools/devServer.mjs 8000 --lan   # 监听 0.0.0.0，手机/副屏用 http://<本机局域网IP>:8000/
# 或传统方式：cd prototype; python -m http.server 8021（改 JS 后需 Ctrl+F5 强刷）
```

浏览器打开 **http://localhost:8000/** 即玩。跨设备出货副屏见 `prototype/COLLECT-DISPLAY.md`（`--lan` + `?room=`）。

### 键位

| 键 | 作用 |
|---|---|
| ←→↑↓ / WASD | 移动爪子 |
| 空格 | 落爪（落下后不可取消） |
| 1 / 2 / 3，Q / E | 切换 / 循环视角 |
| V | 取景 凑近 / 站远 切换（二~四幕） |
| G | 设计稿叠加层（调试对齐 UI，叠加内 `[` `]` 切图 / `R` 复位 / `L` 锁定穿透） |
| N | 跳过当前幕（调试用） |
| H | 调参面板显隐 |
| F / Shift+F | 画幅切换 / 硬切（调试） |

**鼠标 / 触屏**：横向拖拽 = 循环视角；滚轮 / 双指捏合 = 缩放观察（用户层缩放，不影响幕级调参）。
触屏设备（iPad/手机）自动显示屏幕按钮：左下方向键 + 右下「视角」「抓」；桌面端可在 H 面板点「屏幕按钮」开启。

## 发布（给别人玩）

项目是纯静态站，three.js 已 vendor 在 `prototype/vendor/`（不依赖任何 CDN，弱网/离线可跑）。
**发布 = 把 `prototype/` 文件夹的内容传上去**，`index.html` 就是入口。整站约 50MB（主要是 GLB）。

三选一：

| 平台 | 步骤 | 适合 |
|---|---|---|
| **Netlify Drop** | 打开 [app.netlify.com/drop](https://app.netlify.com/drop)，把 `prototype/` 文件夹拖进去 → 得到公开链接 | 最快，30 秒出链接 |
| **itch.io** | 把 `prototype/` 内容打成 zip（index.html 在 zip 根目录）→ 新建项目 → Kind: HTML → 上传 → Viewport 建议 1280×720、勾选 "SharedArrayBuffer" 不需要、不勾 fullscreen 也能玩 | 游戏 jam / 评委试玩 |
| **GitHub Pages** | push 本仓库 → Settings → Pages → 选分支 + `/prototype` 目录（或把 prototype 内容放根分支） | 长期托管 |

注意：**不要**把根目录的 `.env.local`（API key）传上去——它在 `prototype/` 外面，正常不会带上；`tools/` 生成管线同理，发布不需要。

## 资产生成（Tripo 管线，离线批处理）

只在需要重新生成模型时跑，平时玩不需要：

```powershell
# 首次：复制 .env.example 为 .env.local，填入 TRIPO_API_KEY
node tools/generate.mjs --dry           # 只看不调，检查 prompt
node tools/generate.mjs --only bread,can  # 冒烟：只生成两件
node tools/generate.mjs                 # 全量 16 件
```

GLB 落到 `prototype/assets/prizes/`，manifest 自动重建，刷新页面即热替换。
爪子分件：`node tools/generate.mjs claw`。详见 `prototype/PARAMS.md` 末节。

## AI 工具台（Tripo + Marble + PixVerse）

```bash
node tools/hub.serve.mjs    # http://localhost:8780/  黄强调色统一控制台
```

剪影记忆/现实对照：`ART-美术设定.md`、`tools/art-pairs.json`。

## 设计稿工作流（UI 对齐 / 模型风格统一）

**UI 对齐**：设计稿导出 PNG → 放进 `prototype/design/` 并在 `design/manifest.json` 加一行
（或直接把图片拖进游戏窗口）→ 游戏里按 `G` 半透明叠加在画面上，拖拽对位置、
滚轮调透明度、`Shift+滚轮` 缩放、`L` 锁定后正常玩游戏对照看。
主题色值/字体定稿后只改 `prototype/theme.css` 一个文件。

**模型风格统一**：设计稿喂给 Tripo —— 工具页「图片 → 模型」上传设计稿道具图，
或「四视图 → 模型」喂正/侧/背视图，生成的模型天然贴合美术风格；
批量管线 `tools/generate.mjs` 的 `prompts.json` 里给条目加 `"image": "路径"` 即走图生模型。

## 目录结构

```
outline.md              设计文档（叙事/机制/美术纲领）
prototype/              可玩原型（Three.js 0.170，CDN 引入）
  index.html            页面骨架 + 画幅遮罩/HUD 样式
  theme.css             主题变量（字体/颜色/字号，设计稿定稿只改这里）
  design/               设计稿目录（manifest.json 清单，G 键叠加对照）
  src/
    main.js             装配 + 主循环
    acts.js             五幕编排数据（文案/时长/权限/变焦，改内容只动这里）
    director.js         幕导演引擎
    clawMachine.js      爪机状态机 + AI 分件爪热替换
    prizePool.js        奖品数据表 + GLB 热替换
    cameraRig.js        三视角 + 逐幕变焦
    frameMask.js        画幅布局 + 近/远取景
    post.js             鱼眼/颗粒/暗角后处理
    config.js           全部手感参数中枢（H 键实时调）
  PARAMS.md             参数文档 + 验收清单 + 管线用法
  assets/               生成的 GLB（prizes/ 奖品、machine/ 爪子）
tools/generate.mjs      Tripo 批处理脚本（Node，零依赖）
tools/tripo.mjs         Tripo API 全接口薄封装：CLI / 可 import / serve 本地转发（给可视化 UI）
tools/marble.mjs        Marble 世界生成 API 薄封装（同 tripo 三段式，已实测）
tools/pixverse.mjs      PixVerse 视频生成 API 薄封装（text/image/transition → MP4）
tools/devServer.mjs     开发静态服务器（no-store 禁模块缓存）
tools/TRIPO.md          接口清单 + 分件可动/绑骨动画/替换流程示例
tools/MARBLE.md         Marble 场景接入手册（资产路径/坐标系/预览器交互/已知坑）
tools/PIXVERSE.md       PixVerse 视频接入手册（积分估算/叙事接入/已知坑）
tools/TOOLS.md          多服务整合方案（Tripo/Marble/PixVerse/TapTap）
tools/prompts.json      16 件物品 prompt + 统一风格后缀
```
