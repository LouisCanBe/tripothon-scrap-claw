# Hub 奖池管理面板 · 实施计划

**目标**：在 `node tools/hub.serve.mjs`（:8780）里加一个 **「奖池」** 标签页，
让奖池的维护从"改三个文件 + 背命令行"变成"一个面板里点几下"。

**一句话**：这是**给策划用的奖池编辑器** —— 一眼看清 13 件物品的两态配对状况，
一次创建一对好坏模型，指定哪三件是配额，并且能立刻预览模型效果。

**现状**：Hub 是个 tab 壳（`tools/hub.html`），四个标签各自 iframe 一个子服务：
`tripo / marble / pixverse` 三个 AI 服务 + `art` 一个纯静态面板。新面板照 `art` 那种
"纯前端 + 几个 JSON API"的形态做最省事。

---

## 一、要解决的问题

现在维护奖池要同时碰**四个地方**，而且它们之间没有任何一致性校验：

| 文件 | 管什么 | 痛处 |
|---|---|---|
| `tools/prompts-good-p2.json` | 生成用的 prompt | 键名必须和 GLB 文件名一致，容易写错 |
| `prototype/assets/prizes-good-p2/*.glb` | 模型文件 | 有没有、多大、贴图几 K，全得自己去翻 |
| `prototype/src/assets.manifest-*.js` | id → 路径 | 自动生成，但哪套套有哪些文件得猜 |
| `prototype/src/prizePool.js` 的 `PRIZE_TABLE` | **两态关系 + collider + 抓感 + 配额** | 最关键，但纯手写；两态配对写错不会报错，只会静默变"只调材质" |
| `tools/art-pairs.json` | 剪影配对进度 | 和上面那张表**内容重复**，已经对不上了 |

**典型事故**（这次就踩到）：`questAlias` 用了 GLB 名（`moldy`）而不是物品 id（`bread-rot`），
抓对了却被判成垃圾。这种错误没有任何地方会报出来，只能靠 e2e 或肉眼看。

面板要做的就是：**把这四个地方收成一个源，并且每次改动都当场校验。**

---

## 二、单一事实来源：`tools/prize-pairs.json`（已建）

面板的核心数据是 `tools/prize-pairs.json`，它把"一件物品是什么"写全：

```jsonc
{
  "id": "carton",                       // 物品 id = GLB 文件名的基名
  "name": "牛奶盒", "category": "food",
  "collider": { "shape": "box", "size": [0.12,0.15,0.09] },   // 两态共用，判定唯一来源
  "gripFactor": 0.95, "bounceMaterial": "rubber",
  "quest": false, "questLabel": null,   // 只有 true 的进第三幕配额单
  "memory": { "id": "carton",  "label": "牛奶盒", "prompt": "..." },
  "rot":    { "id": "carton-rot", "label": "空盒", "prompt": "..." },   // id 相同 = 只调材质
  "paired": false,                      // 面板算出来的：rot.id !== memory.id
  "inGame": true
}
```

**约定**：`memory.id` / `rot.id` **就是 GLB 文件名**。这一条把"生成"和"接入"焊在一起，
不用再在某处做一次名字映射（那正是最容易错的地方）。

---

## 三、面板长什么样

新标签 **「奖池」**，四个区，从上到下是"看 → 改 → 生成 → 校验"：

### 区 1 · 资产总览（只读，一眼看全局）

```
奖池 13 件 · 两态成套 3 · 只调材质 5 · 未生成 5 · 配额 面包/罐头/蔬菜
⚠ 5 件缺败露态   ⚠ 5 件未生成   ✓ 配额三件都可达成
```

### 区 2 · 物品表（主界面）

一行一件，**两态并排**，这是整个面板的核心：

| | 显形态 | | 败露态 | | 状态 |
|---|---|---|---|---|---|
| id | 预览 | 文件 | 预览 | 文件 | |
| `bread` | `[模型缩略图]` | 534KB ✓ | `[模型缩略图]` | 800KB ✓ | 🟢 成套 |
| `carton` | `[缩略图]` | 628KB ✓ | 同左 | — | 🟡 只调材质 |
| `fish` | — | 缺 | — | 缺 | 🔴 未生成 |

- **预览**：用现有的 `frame-calibrate` / `display` 页那套 Three 加载器，做成小于 128px 的缩略图，
  同一套灯光、同一角度、同一归一化尺度 —— 好和坏**并排同角度**，轮廓对不对一眼就看出来。
  点击缩略图 → 放大到右侧「预览台」（可拖动旋转，带网格底与尺寸标尺）。
- **状态灯**：`pair` / `onDisk` / `lightweight` 三条规则的合成结果，点一下展开原因。
- **行内可改**：配额勾选框、中文名、抓感 `gripFactor`、`collider` 数值。
- **行内可预览**："并排闪切"（同一位置交替显示好/坏两态）—— 这是验证轮廓是否对齐最快的办法。

### 区 3 · 一次创建一对（这是"省事"的关键）

选中一件（或新建一行）→ 右侧出现生成表单：

```
物品 id      [carton        ]  ← 决定文件名，改这里会同步改 memory.id
显形态 prompt [a milk carton, clean label            ]
败露态 prompt [a crushed empty milk carton, stained   ]
风格后缀      [ ] 从 ART-美术设定.md 的 _style 带出，可覆盖
选项          [x] 直接跑  [x] 用 good-p2（轻量化）  [ ] 四视图模式
--------------------------------------------------
预计消耗 2 件 · 约 XX 积分        [ 生成这一对 ]
```

点下去做的事（**串成一条流水线，不需要再敲命令**）：

```
1) 两条 prompt 写进 tools/prompts-good-p2.json
2) 并行提交两次 Tripo 生成（沿用 generate.mjs 的 submit/poll/download）
3) 下载到 prototype/assets/prizes-good-p2/<id>.glb 与 <rot-id>.glb
4) 重建 assets.manifest-good-p2.js
5) 回到面板刷新缩略图 + 更新状态灯
```

**要有 dry-run**：先显示"会写哪两个文件、会调几次 API、大概多少积分"，确认了再真跑。
（`generate.mjs` 已有 `--dry` 的先例。）

### 区 4 · 导出与校验

- **应用更改**：把面板里的表导出成两处：
  1. `prototype/src/prizePool.js` 的 `PRIZE_TABLE`（**生成整段文本，人工粘贴**）；
  2. `tools/art-pairs.json`（配对进度，自动同步，消灭重复）。
  
  > 故意**不自动写 `prizePool.js`**：那是个带大量注释、还夹着手写逻辑的文件，
  > 机器重写会把注释吃掉。生成一段标准文本让人贴，比自动改安全。
- **一键校验**（等价于现在命令行跑的）：
  - `pair` / `silhouette` / `onDisk` / `lightweight` / `questCover` 五条规则逐条列红黄绿
  - 「跑一次数据自检」→ 内部调 `tools/_verify-variants.mjs` 的逻辑（它已经在做 GLB 解析 + 配额归属）
  - 「跑一次浏览器验收」→ 提示在终端执行 `node tools/_e2e.mjs`（面板不启动浏览器）

---

## 四、实现拆解（按能独立上线的顺序）

| 步 | 内容 | 产出 | 依赖 |
|---|---|---|---|
| **P0** | `tools/prize-pairs.json` 建好 | ✅ 已完成 | — |
| **P1** | Hub 加「奖池」tab + 读表渲染**只读**总览与物品表（无预览） | 能看到 13 件、配对状态、缺失清单 | — |
| **P2** | 缩略图预览：两态并排、同角度同尺度 | 轮廓对齐一眼可验 | P1 |
| **P3** | 行内编辑 + `prizePool.js` 片段导出 | 改配额/名字/抓感不用手写代码 | P1 |
| **P4** | 「生成这一对」：写 prompt + 调 Tripo + 下载 + 重建 manifest | 一次点出好坏两个模型 | P1（生成逻辑复用 `generate.mjs`） |
| **P5** | 校验区：五条规则 + 数据自检 | 配对错了当场标红 | P2 |
| **P6** | `silhouette` 规则真正比对两个模型（归一化后最大边/体积差） | 剪影对齐自动判定 | P2 |
| **P7** | 同步 `art-pairs.json`，删掉重复字段 | 消灭重复源 | P3 |

**P1→P3 是纯前端 + 只读 API，风险最低，建议先做。P4 是唯一会花积分的一步，放在后面。**

---

## 五、服务端接口（`tools/hub.serve.mjs` 加）

沿用现有 `http-util.mjs` 的风格。全部只读，除了生成：

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/prizes` | 读 `prize-pairs.json` + 目录实况 + `prizePool.js` 解析结果，**合并成一份**（含每件的 `paired/fileSize/mtime`） |
| `GET` | `/api/prizes/thumb?id=<glb-id>` | 不需要 —— 缩略图在前端用 Three 直接渲染，省一套服务端渲染 |
| `POST` | `/api/prizes/generate` | body: `{ items:[{id, memoryPrompt, rotPrompt, ...}], dryRun }` |
| `POST` | `/api/prizes/export` | 返回 `prizePool.js` 的 `PRIZE_TABLE` 文本片段（不落盘） |
| `GET` | `/api/prizes/check` | 跑五条规则，返回逐条结果（复用 `_verify-variants.mjs` 的逻辑，抽成共享模块） |

**重构点**：把 `tools/_verify-variants.mjs` 里"读 PRIZE_TABLE 文本 + 解析 manifest + 校验"
的逻辑抽成一个共享模块（暂定 `tools/prize-lib.mjs`，待建），让**面板**和**命令行**共用一份校验代码
（现在那份是从文件里切文本再 eval，比较糙，抽出来正好收拾一下）。

**另一个重构点**：`generate.mjs` 现在是个一次性脚本（`main()` 里读 prompts.json 全量跑）。
要把"生成一件/一对"抽成可调用的函数（`generateOne(cfg, def)` 之类），面板才能只跑一对。
它内部的 `submit / poll / download / rebuildManifest` 已经是可以直接复用的粒度。

---

## 六、几个设计决定（写下来免得以后反复）

1. **不自动写 `prizePool.js`。** 那个文件是"手写注释 + 数据"的混合体，
   机器重写会吃掉注释和手写逻辑。生成文本、人工粘贴。
   （如果以后真想自动写，得先把注释迁出去。）
2. **缩略图不用服务端渲染。** 前端 Three 加载 + 固定机位 + 正交相机，
   省一套 puppeteer/headless 依赖，也更快。同一套归一化参数与游戏一致才可信。
3. **`collider` 只在面板里改数值，不做可视化拖拽。** 拖拽编辑碰撞体是另一个量级的工程，
   而现在改数值已经够用了（判定与视觉的偏差靠"并排闪切"就能看出来）。
4. **面板不启动浏览器验收。** 那需要一张显卡和几十秒，放在面板里体验很差；
   面板只显示"该跑哪条命令"，跑完把结果读回来。
5. **`prize-pairs.json` 是权威，`art-pairs.json` 降级成它的派生输出。**
   两份手写表一定会漂移（现在已经漂了：art-pairs 只有 4 对，且 apple/carton 的状态不对）。

---

## 七、顺带要收拾的历史债

| 项 | 现状 | 怎么办 |
|---|---|---|
| `tools/art-pairs.json` | 4 对，和现实不符 | P7 改成从 `prize-pairs.json` 生成 |
| `prototype/design/assets-master.json` | 按"四幕 + 独立垃圾池"那版写的，全面过期 | 重写或标注历史（见 `PROGRESS.md` 第五节） |
| `bone/brick/cloth/foil/stone` | 5 个模型在盘上没进池子（4.1MB） | 在面板里标成"未使用"，给三个处置选项（见 `prize-pairs.json` 的 `orphanModels`） |
| `_verify-variants.mjs` 的文本切片解析 | `new Function` 切字符串，脆 | 抽成共享模块（待建），面板与 CLI 共用 |
| 三套模型目录（`prizes` / `-good` / `-good-p2`） | 三套内容一样，容易搞混 | 面板顶部明确标出"发布套 = good-p2"，其余标灰 |

---

## 八、验收标准

面板做完，下面这件事应该**只在浏览器里**完成：

> 新建一件物品 → 写两条 prompt → 点"生成这一对" → 看到两个缩略图并排 →
> 检查轮廓对齐 → 勾成配额 → 导出 `PRIZE_TABLE` 片段 → 跑一次校验全绿。

达成即算完成。**在此之前不改 `prizePool.js` 的任何机制**，面板只是外挂。

---

## 九、和现有 e2e 的关系

`tools/_e2e.mjs`（主流程 32 项）与 `tools/_e2e-display.mjs`（副屏 12 项）**不动**。
它们是"游戏有没有跑坏"的闸门；面板是"资产有没有配错"的闸门，两者互补：

- 面板校验：**静态**（文件在不在、配对对不对、配额能不能达成）
- e2e 校验：**动态**（真开浏览器、真抓、真换模型、真出货）

面板的 `check` 接口可以直接把 `_verify-variants.mjs` 的结果读回来显示，
省得两头各跑一次。
