# PixVerse 视频生成 → 游戏接入手册

> Marble 管「3D 世界」，PixVerse 管「动态镜头」——分镜过渡、幕间视频、终幕氛围短片。

## 两条通路（别混用）

| 通路 | 鉴权 | 积分 | 适合 |
|---|---|---|---|
| **官方 `pixverse` CLI**（推荐：你有网页会员） | `pixverse auth login`，令牌在 `~/.pixverse/` | **网页会员积分**，与 App 同源 | Cursor 智能体 + Skill、`pixverse create video` 等全能力 |
| **`tools/pixverse.mjs`**（OpenAPI） | 根目录 `.env.local` 里 `PIXVERSE_API_KEY` | [platform.pixverse.ai](https://platform.pixverse.ai/billing) **API Credits**，与网页会员**不通用** | 本地 `serve` + `video.html`、脚本批处理、与 Hub 同构的 HTTP 封装 |

会员账号请走 **CLI + 登录**；只有开放平台 Key 时再走下面的 `pixverse.mjs`。

## 官方三步（项目级，勿 `npm -g`）

在仓库根目录：

```bash
npm install                    # 已写入 devDependency: pixverse
npm run pixverse:login         # 浏览器用 PixVerse 账号登录，延续会员权益与积分
npm run pixverse:status        # 应显示已登录
```

智能体能力包（已装可跳过）：

```bash
npm run skills:pixverse
# 等价：npx skills add https://github.com/pixverseai/skills --skill pixverse-ai-image-and-video-generator --project -y
```

- 技能文件：`.agents/skills/pixverse-ai-image-and-video-generator/`（Cursor 通过 `.cursor/skills/` 目录联接指向同一份）
- 生成示例：`npx pixverse create video --prompt "雨夜霓虹小巷，慢推" --quality 540p --duration 5 --json`，再用 `pixverse asset download` 落到 `prototype/assets/videos/`
- 智能体读 Skill 时会优先用 **`npx pixverse` / `npm run pixverse`**，与全局 `pixverse` 命令等价（本项目不装全局 CLI）

登录一次后，本机所有终端会话共用 `~/.pixverse/` 里的会话。

**Hub 已接入**：`node tools/hub.serve.mjs` 在检测到 CLI 已登录时，PixVerse 标签页走会员账号（`auto` 优先 CLI；强制 OpenAPI 设 `PIXVERSE_HUB=openapi`）。

Hub 内 `video.html` 仅覆盖 **文生 / 图生 / 首尾帧** + 积分粗算说明；续写、参考融合、模板等见面板内「差异说明」，或 Cursor Skill / `npx pixverse`。

## OpenAPI 快速开始（`pixverse.mjs`）

```bash
# .env.local
PIXVERSE_API_KEY=你的key
# 可选代理（与 tripo/marble 相同）
HTTPS_PROXY=http://127.0.0.1:7890

node tools/pixverse.mjs balance          # 查 API 积分（与网页会员积分分开）
node tools/pixverse.mjs serve            # → http://localhost:8789/
node tools/pixverse.mjs text --prompt "雨夜霓虹小巷，慢推" --wait --out prototype/assets/videos/test.mp4
```

官方文档：[Introduction](https://docs.platform.pixverse.ai/introduction-to-pixverse-api-platform-796055m0) · [Quick Start](https://docs.platform.pixverse.ai/quick-start-796052m0) · [Pricing](https://docs.platform.pixverse.ai/model-pricing-796039m0)

## API 约定（接入必记）

| 项 | 值 |
|---|---|
| 基址 | `https://app-api.pixverse.ai/openapi/v2` |
| 鉴权头 | `API-KEY: <key>` |
| 追踪头 | `Ai-trace-id: <新 UUID 每次请求>` — **重复会返回上一次结果** |
| 响应 | `{ ErrCode, ErrMsg, Resp }`，`ErrCode=0` 成功 |
| 异步 | 提交 → `video_id` → GET `/video/result/{id}` 每 3–5s 轮询 → `status=1` 取 `url` |

**状态码**：`1` 成功 · `5` 生成中 · `6` 删除 · `7` 审核失败 · `8` 生成失败

## 本地已实现（P0）

| 功能 | CLI | serve API |
|---|---|---|
| 余额 | `balance` | `GET /api/pixverse/balance` |
| 上传图片 | `upload --file` | `POST /api/pixverse/upload` |
| 文本→视频 | `text --prompt` | `POST /api/pixverse/text` |
| 图→视频 | `image --file` | `POST /api/pixverse/image` |
| 首尾帧过渡 | `transition --first --last` | `POST /api/pixverse/transition` |
| 续写 | `extend --id` | `POST /api/pixverse/extend` |
| 状态 | `status --id` | `GET /api/pixverse/video/:id` |
| 下载 | `--out` | `POST /api/pixverse/download` |
| 逃生舱 | `call` | `POST /api/pixverse/call` |

下载目录：`prototype/assets/videos/`。CLI `asset download` 会生成 `pixverse_video_<id>_<时间戳>.mp4`；建议 **重命名** 为 `demo-*.mp4` 后删掉自动名，避免同一任务占双份空间（Hub「下载」则直接用你填的文件名）。

## 暂未封装（用 call 或后续加）

Fusion、Swap、Restyle、Effects/template、Mimic、Modify、Lipsync、Sound、Multi-transition — 参数重、调试贵，有明确镜头需求再加。

**MCP**（`uvx pixverse-mcp`）目前主要是 text-to-video 创意辅助；图生视频/首尾帧等**必须走 API**（见 [PixVerse MCP 文档](https://docs.platform.pixverse.ai/pixverse-mcp-972890m0)）。

## 积分与 6000 会员积分

⚠️ **网页「会员积分」≠ API Credits**。API 要在 [Billing](https://platform.pixverse.ai/billing) 单独充值。

粗估（以 [Model & Pricing](https://docs.platform.pixverse.ai/model-pricing-796039m0) 为准，测试请锁 **540p + 5s**）：

| 操作 | 单次约消耗 | 6000 API 积分约可 |
|---|---|---|
| Text-to-Video 540p 5s | 30–60 | **100–200 条** |
| Image-to-Video 540p 5s | 50–80 | **75–120 条** |
| Transition 首尾帧 | 80–150 | **40–75 条** |
| 1080p / 8s | ×2–4 | 明显更少 |

**冒烟预算**：text + image + transition 各 2–3 条 ≈ **200–400 积分**。工具默认 540p，避免误点 1080p 烧光。

## 游戏叙事接入建议

| 场景 | PixVerse 能力 | 接入点 |
|---|---|---|
| 幕间过渡 | Transition（设计稿首尾帧） | 全屏 `<video>` 遮罩，播完切下一幕 |
| 引子/终幕氛围 | Text-to-Video | 终幕 `hooks.onReveal` 前播短片 |
| 分镜验证 | Image-to-Video（设计稿截图） | 预览叙事节奏再进 Marble/Tripo |
| 延长镜头 | Extend | 5s 不够时续写 |

与 Marble 分工：Marble = 可行走 3D 世界；PixVerse = 2D 动态镜头/过渡。终幕可 Marble 全景背景 + PixVerse 短片叠加。

## 已知坑

1. **`Ai-trace-id` 必须每次新建** — 封装里已 `randomUUID()`，手动 call 时注意
2. **路径若 404** — 用 `call` 对照官方文档改 `PATHS` 表（不同版本可能微调）
3. **余额接口字段名** — 控制台已兼容 `credit/credits/balance/remain` 多种返回
4. **API 与网页会员不通用** — 别拿 6000 会员积分当 API 余额
5. **测试锁 540p·5s** — 1080p·8s 单次可能上百积分

## 路径表（pixverse.mjs PATHS）

```
POST /image/upload
POST /video/text/generate
POST /video/img/generate
POST /video/transition/generate
POST /video/extend/generate
GET  /video/result/{id}
GET  /account/balance
```

不通时：`node tools/pixverse.mjs call --method GET --path /account/balance`
