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

## Marble 接入

详细手册（API 速查、定价、三种资产接入路径、坐标系约定、预览器交互规范、已知坑、实测档案）见 **[tools/MARBLE.md](./MARBLE.md)**。

要点速记：
- 测试用 `marble-1.0-draft` 档（150 积分 ≈ $0.12，三种资产全给）
- 资产：全景图 → `scene.background`；GLB → 碰撞/占位；SPZ → 写实场景层
- ⚠️ GLB/SPZ 与 three.js 朝向相反，接入必须绕 X 翻 180°（全景图不用）
- 预览器：`node tools/marble.mjs serve` → http://localhost:8788/ ，双范式控制（V 切换）+ 边界碰撞
