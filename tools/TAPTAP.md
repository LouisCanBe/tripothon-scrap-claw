# TapTap 接入指南（CLI + MCP）

> 从《拾荒娃娃机》(app 983258) 2026-10 上架全流程实证提取。新项目开箱用。
> 涉及文件：`tools/package-h5.mjs`（H5 打包）、`tools/_qr-png.cjs`（测试码转二维码）——可直接拷去新项目。

---

## 0. 两个工具的分工（先搞清用哪个）

| 工具 | 定位 | 什么时候用 |
|---|---|---|
| **`@taptap/cli`**（npm 全局） | 开发者中心的全功能命令行：发版、资料、审核、包体、数据、资质 | 所有「管理」操作：打包上传、改商店资料、提审、查状态 |
| **`@taptap/instant-games-open-mcp`**（MCP） | 小游戏/H5 **运行时能力**的文档+服务端状态入口 | 接广告（查广告位 ID）、查排行榜/云存档/分享/振动的 API 文档 |

本项目实证：**发版全程用 CLI；广告接入用 MCP 拿权威广告位 ID + 生命周期文档，游戏内代码调 `tap.*` API**。MCP 不替代 CLI，两者互补。

---

## 1. CLI 安装与认证

```bash
npm i -g @taptap/cli
taptap-cli auth login        # 终端出链接 → 浏览器确认 → 凭证存本机
taptap-cli auth status       # 看登录态 / 服务地址 / 配置文件路径
```

- 凭证在 `~/.taptap-cli/taptap.json`，**勿外泄、勿提交**
- token 有效期约 3 个月，过期重跑 `auth login`
- AI Agent 场景：`taptap-cli auth login --no-wait --json` 拿链接给用户，再轮询 recovery 命令

## 2. Skills 安装（GitHub 仓库是私有的，别走 npx skills add）

`npx skills add taptap/cli` 会失败（私有仓库）。正确姿势——**从 npm 包内拷贝**：

```bash
npm root -g                    # 找到全局 node_modules
# 拷贝 <global>/@taptap/cli/skills/ 下全部目录到项目的 .agents/skills/
# （12 个 Skill：publish-game / app-edit / package-management / materials /
#   qualification / test-plan / dashboard-stats / identity / asset-library 等）
```

`.agents/` 和 `skills-lock.json` 建议进 `.gitignore`（本机工具，且 lock 里含本机绝对路径）。

## 3. H5 发包流水线（Web 游戏上架主路径）

```bash
node tools/build-deploy.mjs                  # ① prototype/ → deploy/prototype/（剥源文件/设计稿）
node tools/package-h5.mjs                    # ② → dist/pickman-h5.zip（结构+引用校验）
taptap-cli materials +inspect dist/xxx.zip   # ③ 只读预检（top_level_entries 须只有 game/）
taptap-cli upload-h5-package dist/xxx.zip \
  --dev-id <id> --app-id <id> --screen-orientation 0 --dry-run   # ④ 预览
taptap-cli upload-h5-package dist/xxx.zip ... --yes             # ⑤ 上传 → 得 h5VersionId
taptap-cli app select-package ... --data '{"expected":{...},"package":{"id":"<h5VersionId>","type":"h5"},"slot":"main"}' --yes   # ⑥ 绑主槽位
taptap-cli package-management get-test-qr-code \
  --dev-id <id> --app-id <id> --data '{"package_id":<h5VersionId>}'   # ⑦ 真机自测码
```

**zip 结构硬规范**（预检不过传不上）：

```
game.zip
└── game/           ← 根目录有且只有一个文件夹
    ├── index.html  ← 入口在第一层
    └── ...
```

**`tools/package-h5.mjs` 已内置的救命逻辑**（新项目建议直接抄）：
- `devServer.mjs` 的专属路由文件（如 `/comic-render.mjs`）必须随包分发，且**改名 `.js` + 相对 import**——本地 devServer 有的路由，静态包没有
- **`.ogg` 音频一律转 `.mp3`**：CDN 不给 .ogg 配 MIME，静默失败（.mjs 同款坑）
- 点文件/开发残留全部剥掉（隐藏文件也是预检 warning）
- 打包时扫全部静态引用，缺一个直接失败（防黑屏类事故）

## 4. 商店资料与版本管理

```bash
taptap-cli app get-app-module --dev-id <id> --app-id <id> --data '{"module_id":"basic-info"}'   # 读字段
taptap-cli app save-changes --dev-id <id> --app-id <id> --data @changes.json --idempotency-key <key> --yes
```

- 9 个模块：`basic-info` / `assets-upload` / `profile-promotion` / `windows-exclusive` / `platform-status` / `release-settings` / `package` / `developer-info` / `other-settings`
- **分发状态**（`platform-status` 的 `region_flag_android/ios/pc`）：1=敬请期待 / 3=预约 / 4 或 0=提供游玩。**H5 游戏 PC 端不允许 0**，安卓/iOS 用 4。上线前全部设「提供游玩」
- 版本名 `V-20261025` 系统按日期自动生成，**不可自定义**；每次发布后自动建新草稿
- **线上版本锁定**：online 状态改不了任何字段，改动都在新草稿上进行
- ⚠️ **比赛保鲜期**：参加官方活动（如聚光灯）后评审期间禁止提审，提前问清楚活动方时间

## 5. 提审（三步契约，务必人工确认）

```bash
taptap-cli app prepare-review-snapshot --dev-id <id> --app-id <id>     # ① 快照
taptap-cli app precheck-app-review --dev-id <id> --app-id <id> --data @precheck.json   # ② 预检
taptap-cli app submit-app-review --dev-id <id> --app-id <id> --data '{"release_schedule":{"kind":"immediate"}}' --idempotency-key <key> --yes   # ③ 提交
```

- 日常体检（不用等提审）：`taptap-cli app analyze-app-status` → blockers / suggestions / warnings 三项清单
- 资质类 blocker（版号/备案）走 `taptap-qualification` skill；SCE 协议（创意工坊）需用户明确同意后签
- **永远不要替用户自动提交审核**——提审是人工决策

## 6. CLI 实战避坑（条条是踩过的）

| 坑 | 解法 |
|---|---|
| `save-changes` 409「字段被外部修改」 | `expected` 写错了：字符串字段的 expected = **当前字符串本身**（不是数组）；null 才写 `[]`。重读模块再写 |
| `--data @file.json` 报「invalid format」 | 文件带 BOM。用 node 写 JSON，别用 PowerShell Out-File |
| PowerShell 引号地狱 | 命令一律 `cmd /c "taptap-cli ... --data ""{...}"" > %TEMP%\x.json 2>&1`，再 node 解析文件；**永远不要**在 PowerShell 里内联带正则的 node -e |
| `select-package` 409 | 先用 `list-packages` 看 `package_slots.main.expected`，原样回填 |
| `get-app-version` 不返回包体 ID | 用 `package-management list-h5-packages` 看 `is_releasing: true` 哪个包 |
| 测试码 URL 被客户端自动变成链接 | `node tools/_qr-png.cjs "<url>" out.png` 出图（vm 加载 vendor 里的 qrcode-generator + 手写 PNG 编码，零依赖） |
| 评测/比赛期间提审被拒 | 活动保鲜期锁定，问活动方解禁时间，期间别重复试 |

## 7. MCP 配置（opencode.json 格式）

项目根目录建 `opencode.json`（注意：不是 Cursor 的 mcp.json 格式）：

```json
{
  "mcp": {
    "taptap-minigame": {
      "type": "local",
      "command": ["npx", "-y", "@taptap/instant-games-open-mcp"],
      "environment": { "TAPTAP_MCP_WORKSPACE_ROOT": "<项目绝对路径>" },
      "enabled": true
    }
  }
}
```

- 首次使用 OAuth：`start_oauth_authorization` → 用户扫码 → `complete_oauth_authorization`。**链接只有 2 分钟有效**，超时重取
- 先 `select_app`（`list_developers_and_apps` 拿 ID），后续工具默认用选中应用
- 文档资源：`docs://ads/*`、`docs://leaderboard/*`、`docs://cloud-save/*`、`docs://share/*`、`docs://vibrate/*`——接入对应能力前先读

## 8. 广告接入（激励视频）

**流程**：`check_ads_status`（服务端返回匹配广告位 ID，**永远用服务端的值，不要手填**）→ `get_ad_integration_guide`（拿注入真实 ID 的完整代码）。

**游戏内 `tap.*` 生命周期要点**（全是真机踩出来的）：

```js
const ad = tap.createRewardedVideoAd({ adUnitId: '<服务端ID>' });  // 单例
ad.onLoad(() => { adReady = true; });          // 状态以回调为准
ad.onError(() => { adReady = false; });
ad.onClose((res) => {
  if (res && res.isEnded) { /* 发奖 */ }        // 只有看完整才发奖
  // ❌ 不要在这里手动 ad.load()：官方文档明确「关闭后素材清空并自动
  // 加载下一份」，手动 load 会双 load 冲突导致卡死再也打不开
});
ad.load();  // 创建时预拉一次就够

// 点击入口时：没就绪 → toast 反馈（别无声点击）；show 失败 → load → show 重试一次
```

**其他教训**：
- 点位设计：激励视频绑「受挫瞬间」（连败救济/終幕揭晓），玩家主动点，绝不自动弹
- 本地调试：URL 加 `?ad=1` 强制显示入口、点击直发奖，不依赖 TapTap 运行时
- 非 TapTap 环境（自建站/本地）`typeof tap === 'undefined'`，入口整体不渲染
- 测试位不计收益；验收要加测试设备（OAID），过了再转正式

## 9. 常用链接

- 开发者中心：https://developer.taptap.cn
- 小游戏文档（广告/排行榜/云存档）：https://developer.taptap.cn/minigameapidoc/
- 广告平台 Dirichlet（TapADN）：https://ssp.dirichlet.cn
- REP 资源置换（流量金/冷启动扶持）：https://rep.taptap.cn
- 创意工坊协议（SCE）：https://www.taptap.cn/doc/ugcgame-agreement
- MCP 仓库：https://github.com/taptap/instant-games-open-mcp

---

*本文档从实战提取，与 `tools/package-h5.mjs`、`tools/_qr-png.cjs` 配合使用。新项目：拷这三个文件 + 按第 1/3/7 节走即可。*
