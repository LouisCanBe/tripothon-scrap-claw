# 黑客松外部服务整合方案

本项目用到的外部服务统一按 **tripo.mjs 三段式** 封装：CLI 直接用 / import 进脚本 / serve 给浏览器 UI。

## 服务现状

| 服务 | 用途 | 工具 | 状态 |
|---|---|---|---|
| **Tripo3D** | 道具/爪子模型生成（text/image/multiview → GLB） | `tools/tripo.mjs` + `tripo.serve.mjs` + `tools/ui.html` | ✅ 已实测跑通 |
| **Marble（World Labs）** | 3D 世界/场景生成（text/image/pano → GLB mesh / SPZ 点云 / 全景图） | `tools/marble.mjs` + `marble.serve.mjs` + `tools/world.html` | ✅ 已实测跑通（draft 档 32s 出世界） |
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
5. **下载目录分服务**：Tripo → `prototype/assets/generated/`，Marble → `prototype/assets/worlds/`

## 快速上手

```bash
# Tripo（已可用）
node tools/tripo.mjs text --prompt "生锈的罐头" --wait --out prototype/assets/generated/can.glb
node tools/tripo.mjs serve          # → 可视化控制台 tools/ui.html

# Marble（先 .env.local 加 MARBLE_API_KEY=wlt_xxx，platform.worldlabs.ai 申请）
node tools/marble.mjs gen --text "雨后小巷，霓虹倒影" --wait --out prototype/assets/worlds/alley.glb
node tools/marble.mjs serve         # → 8788 端口转发

# 开发服务器（no-store 禁缓存，改代码刷新即生效）
node tools/devServer.mjs 8000
```

## 后续整合路线（按需做，不提前过度设计）

1. **统一 serve hub**：现在 tripo(8787)/marble(8788) 各起一个端口。服务多起来后合并成
   单服务器按前缀路由：`/api/tripo/*`、`/api/marble/*`、`/api/taptap/*`
2. **ui.html 加服务 tab**：控制台顶部切服务，任务卡列表按服务分组
3. **TapTap 发布流水线**：`npm run release` = 打包 zip → TapRails 上传 → 输出审核链接
4. **Marble → 游戏**：生成的全景图可直接当终幕"实景"背景（`hooks.onReveal` 换成全景天空盒），
   GLB mesh 可做新场景——低模娃娃机（记忆）vs Marble 写实世界（现实）的画风对比本身就是叙事

## Marble API 速查（v1，已实测）

| 操作 | 端点 | 说明 |
|---|---|---|
| 生成世界 | `POST /marble/v1/worlds:generate` | world_prompt.type: text / image / panorama / video |
| 轮询 | `GET /marble/v1/operations/{id}` | done 后取 response.world_id |
| 世界详情 | `GET /marble/v1/worlds/{id}` | 资产 URL（mesh/splats/panorama） |
| 导出 | `POST /marble/v1/worlds/{id}:export` | `{asset_type:'mesh',format:'glb'}` 或 splats/ply |

**定价**（1250 积分 = $1，响应里 `cost.total_credits` 可对账）：

| 档位 | 积分 | 折合 | 用途 |
|---|---|---|---|
| `marble-1.0-draft` | 150 | $0.12 | **测试/草稿用这个** |
| `marble-1.1` | 1,500 + 80 文本费 | ~$1.26 | 正式质量 |
| `marble-1.1-plus` | 1,500 + 0~1,500 浮动 | ~$1.3~2.5 | 大世界/室外 |
| HQ mesh 导出 | 3,500 | $2.80 | 高精度网格（贵，慎用） |

**实测资产生成物**（draft 档就全给，免费）：
- `assets.mesh.collider_mesh_url` —— 基础 GLB 网格（素模，可做碰撞/占位）
- `assets.imagery.pano_url` —— 全景图 PNG（终幕实景背景最简方案：`scene.background` 一行）
- `assets.splats.spz_urls.{100k,500k,full_res}` —— 高斯点云（写实感最强）
- `assets.caption` —— AI 扩写后的场景描述（回收当 prompt 素材）

⚠️ **坐标系**：Marble 输出的 GLB 和 SPZ 与 three.js 朝向相反，接入时**绕 X 轴翻 180°**
（GLB：`scene.rotation.x = Math.PI`；SPZ：`addSplatScene(url, { rotation: [1,0,0,0] })`）。
全景图不受影响。

**预览器**：`node tools/marble.mjs serve` → http://localhost:8788/ 三模式切换
（全景图 / GLB 网格 / SPZ 点云），SPZ 渲染用 vendor 化的 `@mkkellogg/gaussian-splats-3d`
（`prototype/vendor/addons/gaussian-splats-3d.js`，three r170 兼容已验证）。

鉴权头：`WLT-Api-Key`。402 = 余额不足。
