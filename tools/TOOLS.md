# 黑客松外部服务整合方案

本项目用到的外部服务统一按 **tripo.mjs 三段式** 封装：CLI 直接用 / import 进脚本 / serve 给浏览器 UI。

## 仓库边界（游戏 vs 工具 Hub）

| 范围 | 路径 | 运行方式 |
|------|------|----------|
| **游戏** | `prototype/` | 根目录 `npm start`（或 `npm run game`）— **不需要** `npm install` |
| **工具 Hub** | `tools/` + 根目录 `package.json` | `npm install` → `npm run hub`（Tripo / Marble / PixVerse） |
| **本机 Agent** | `.agents/`、`.cursor/` | `npm run skills:pixverse` 安装 PixVerse Skill；**不入库**，每人本机一份 |

Marble / PixVerse 在 Hub 里下载的自动命名文件（如 `world-<id>-pano.png`）视为缓冲区；确认进游戏后改名为 `reveal-draft-*` 或写入 `config.js` 再提交。

## 服务现状

| 服务 | 用途 | 工具 | 状态 |
|---|---|---|---|
| **Tripo3D** | 道具/爪子模型生成（text/image/multiview → GLB） | `tools/tripo.mjs` + `tripo.serve.mjs` + `tools/ui.html` | ✅ 已实测跑通 |
| **Marble（World Labs）** | 3D 世界/场景生成（text/image/pano → GLB mesh / SPZ 点云 / 全景图） | `tools/marble.mjs` + `marble.serve.mjs` + `tools/world.html` | ✅ 已实测跑通（draft 档 32s 出世界） |
| **PixVerse** | 分镜/幕间视频（官方 CLI + Skill，或 OpenAPI 封装） | 根目录 `npm install` → `npm run pixverse:login`；可选 `tools/pixverse.mjs` + serve | ✅ CLI/Skill 已装；需本机 `auth login` |
| **TapTap** | 游戏包体上传发布 | 官方 TapRails CLI / APK 上传 API | 📋 待开发者凭证 |
| **tapnow** | ？ | ？ | ❓ 待确认是什么服务 |

## 统一模式（每个服务一个薄封装）

```
tools/<service>.mjs        # Client 类 + PATHS 路由表 + CLI
tools/<service>.serve.mjs  # 本地 HTTP 转发（绕 CORS，key 不出前端）
```

约定：

1. **Key 全部进 `.env.local`**（gitignore 已排除），命名 `<SERVICE>_API_KEY`
2. **代理自重启**：检测到 `HTTPS_PROXY` 自动带 `NODE_USE_ENV_PROXY` 重启一次
3. **CLI 三件套**：`--dry`（只打印请求）/ `--wait`（轮询）/ `--out`（下载落盘）
4. **逃生舱**：`call` 命令可裸调任意路径，新接口不用等封装
5. **下载目录分服务**：Tripo → `prototype/assets/generated/`，Marble → `prototype/assets/worlds/`，PixVerse → `prototype/assets/videos/`

## 快速上手

```bash
# 推荐：统一工具台（单端口，Tab 切换 Tripo / Marble / PixVerse / 剪影对照）
npm run hub                           # http://localhost:8780/（配了 HTTPS_PROXY 时会像 tripo serve 一样自动带代理重启子进程）

# 也可单独起各服务（调试时用）
node tools/tripo.mjs serve            # → 8787  tools/ui.html
node tools/marble.mjs serve           # → 8788  tools/world.html
node tools/pixverse.mjs serve         # → 8789  tools/video.html

# CLI 示例
node tools/tripo.mjs text --prompt "生锈的罐头" --wait --out prototype/assets/generated/can.glb
node tools/marble.mjs gen --text "雨后小巷，霓虹倒影" --wait --out prototype/assets/worlds/alley.glb
node tools/pixverse.mjs text --prompt "雨夜小巷" --wait --out prototype/assets/videos/test.mp4

# 游戏开发服务器（项目根目录）
npm start                             # http://127.0.0.1:8000/
npm run game:lan                      # 内网可访问（终端会打印局域网 IP）
# 主屏 /  副屏出货展示：http://localhost:8000/display.html（见 prototype/COLLECT-DISPLAY.md）
```

美术剪影对照流程见根目录 **`ART-美术设定.md`**，配对表 **`tools/art-pairs.json`**。

### 2D 概念图审阅（改路由后请重启 `node tools/hub.serve.mjs`）

| 风格 | Hub（8780） | 试玩 devServer（8000） |
|------|-------------|-------------------------|
| Seedream 厚涂 | http://localhost:8780/concepts | http://127.0.0.1:8000/design/concepts/review.html |
| Cursor 写实 | http://localhost:8780/concepts?set=cursor | http://127.0.0.1:8000/design/concepts/review.html?set=cursor |

静态资源：`/design/*` → `prototype/design/`，`/assets/*` → `prototype/assets/`（定帧 #13 走 `assets/images/reveal-truth-hand-can.png`）。

**Tripo 预览器**：左侧「漫画渲染」= 实时 Toon + 描边（`tools/comic-render.mjs`，后续可接到游戏里娃娃奖品）。

## 后续整合路线（按需做，不提前过度设计）

1. ~~统一 serve hub~~ ✅ `tools/hub.serve.mjs` + `tools/hub.html`
2. Hub 内任务队列跨服务汇总（可选）
3. **TapTap 发布流水线**：`npm run release` = 打包 zip → TapRails 上传 → 输出审核链接
4. **Marble → 游戏**：生成的全景图可直接当终幕"实景"背景（`hooks.onReveal` 换成全景天空盒），
   GLB mesh 可做新场景——低模娃娃机（记忆）vs Marble 写实世界（现实）的画风对比本身就是叙事

## Marble 接入

详细手册（API 速查、定价、三种资产接入路径、坐标系约定、预览器交互规范、已知坑、实测档案）见 **[tools/MARBLE.md](./MARBLE.md)**。

要点速记：
- 测试用 `marble-1.0-draft` 档（150 积分 ≈ $0.12，三种资产全给）
- 资产：全景图 → `scene.background`；GLB → 碰撞/占位；SPZ → 写实场景层
- ⚠️ GLB/SPZ 与 three.js 朝向相反，接入必须绕 X 翻 180°（全景图不用）
- 预览器：`node tools/marble.mjs serve` → http://localhost:8788/ ，双范式控制（V 切换）+ 边界碰撞

## PixVerse 接入

详细手册见 **[tools/PIXVERSE.md](./PIXVERSE.md)**。

**会员账号（推荐）**：仓库根 `npm install` → `npm run pixverse:login` → 用 `npx pixverse create …` 或 Cursor 读项目 Skill `pixverse-ai-image-and-video-generator`。积分走网页会员，与 App 一致。

**开放平台 Key**：`.env.local` 里 `PIXVERSE_API_KEY`，`node tools/pixverse.mjs serve` → http://localhost:8789/。API Credits 与网页会员**不通用**。

要点速记：
- 测试锁 **540p + 5s**
- OpenAPI 路径：每个请求新 `Ai-trace-id`（UUID），重复会返回旧结果
