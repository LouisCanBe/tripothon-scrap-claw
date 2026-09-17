# Tripo API 小工具（tools/tripo.mjs）

对 Tripo API（v3）的完整薄封装，不带业务逻辑。三种用法：CLI、import 成模块、本地 HTTP 转发（给可视化界面）。

> 批量生产资产仍走 `tools/generate.mjs`（读 prompts.json + 重建 manifest）；本文件是"API 本身"，适合试验和给 UI 打底。

## 配置

`.env.local`（与 generate.mjs 共用）：

```
TRIPO_API_KEY=tsk_xxxxxxxx
# 可选：换域名（默认 .com 国内站；国际站用 https://openapi.tripo3d.ai/v3）
TRIPO_API_BASE=https://openapi.tripo3d.com/v3
# 可选：代理
HTTPS_PROXY=http://127.0.0.1:7890
```

## 一、接口清单

| 方法 | CLI 命令 | 路径 | 说明 |
|---|---|---|---|
| `textToModel` | `text` | POST /generation/text-to-model | 文本→模型。**分件也走这**（`generate_parts`） |
| `imageToModel` | `image` | POST /generation/image-to-model | 图片→模型（`input` = URL 或 file_token） |
| `multiviewToModel` | `multiview` | POST /generation/multiview-to-model | 四视图→模型（P 系，低面数干净拓扑） |
| `refineModel` | `refine` | POST /generation/refine | 草稿精修 |
| `textureModel` | `texture` | POST /generation/texture | 已有模型重新贴图 |
| `convertModel` | `convert` | POST /generation/convert | 格式转换（GLB/FBX/USDZ，可转四边面） |
| `rigCheck` | `rigcheck` | POST /animations/rig-check | 检查模型可否自动绑骨 → `rig_type` |
| `rigModel` | `rig` | POST /animations/rig | 自动绑骨（人形） |
| `retarget` | `retarget` | POST /animations/retarget | 套预设动画（如 `preset:run`） |
| `getTask` | `task` | GET /tasks/{id} | 任务状态轮询 |
| `uploadFile` | `upload` | POST /files | 本地文件 → file_token |
| `getBalance` | `balance` | GET /user/balance | 余额 |
| `call` | `call` | 任意 | **逃生舱**：表里没有/路径变了直接调 |

生成类常用参数（text/image/multiview）：`model`（如 `v3.1-20260211`、`P1-20260311`）、`face_limit`、`texture`、`pbr`、`texture_quality`(standard/detailed/extreme)、`geometry_quality`、`model_seed`、`auto_size`、`quad`、`smart_low_poly`、`generate_parts`（仅 text，且必须 `texture:false pbr:false`）。

⚠️ 标 ? 的路径（见 tripo.mjs 顶部 PATHS 表注释）是文档未完全核实的；404 时按官方文档改 PATHS 一处即可，或用 `call` 逃生舱。

## 二、CLI 示例

```bash
# 文本→模型，轮询到完成并下载（一条命令出资产）
node tools/tripo.mjs text --prompt "生锈的罐头，低多边形" --model v3.1-20260211 \
  --wait --out prototype/assets/prizes/can_v2.glb

# 不花积分检查请求体
node tools/tripo.mjs text --prompt "test" --dry

# 图片→模型（先上传拿 token，或直接给 URL）
node tools/tripo.mjs upload --file ./refs/can.png
node tools/tripo.mjs image --input <file_token> --wait --out out.glb

# 查任务 / 余额
node tools/tripo.mjs task --id <task_id>
node tools/tripo.mjs balance

# 人形模型：查能否绑骨 → 绑骨 → 套跑步动画
node tools/tripo.mjs rigcheck --task <task_id>
node tools/tripo.mjs rig --task <task_id> --wait --out rigged.glb
node tools/tripo.mjs retarget --task <绑骨task_id> --animation preset:run --wait --out run.glb
```

## 三、serve 模式（给可视化界面打底）

```bash
node tools/tripo.mjs serve --port 8787
```

浏览器 UI 直接 fetch 本地转发层，无 CORS、key 不出前端：

```js
// 提交
const { task_id } = await fetch('http://localhost:8787/api/gen/textToModel', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '生锈的罐头', model: 'v3.1-20260211' }),
}).then(r => r.json());

// 轮询
const t = await fetch(`http://localhost:8787/api/task/${task_id}`).then(r => r.json());
// t.status === 'success' 时 t.output.model_url 是 GLB 地址

// 下载到 prototype/assets/generated/
await fetch('http://localhost:8787/api/download', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: t.output.model_url, name: 'can.glb' }),
});
```

上传图片：`POST /api/upload?filename=a.png`（二进制 body）→ `file_token`。

## 四、分件 → 可动：本项目爪子就是完整示例

**生成**（generate_parts 与贴图互斥，官方限制）：

```bash
node tools/tripo.mjs text --prompt "娃娃机三爪，金属" \
  --generate_parts true --texture false --pbr false --wait --out claw_parts.glb
```

产出的 GLB 里是**平铺的命名节点**（`tripo_part_0..N`），没有关节结构。让它动起来 = 自己给每件包关节 pivot，本项目真实代码在 `prototype/src/clawMachine.js` 的 `upgradeClawVisual()`：

```
1. traverse 按名字收集节点 → byName
2. 人工标归属（控制台逐件染色看哪个是哪个）：
   config.js 的 clawGLB.staticParts（不动的）/ prongGroups（每条臂一组）
3. 每条臂包两层 Group：
     assembly（rotation.y = atan2(-z, x)，对齐该臂方位角）
     └ pivot（position = 关节点 attachR/attachY）
4. pivot.attach(part) —— 关键 API：保持世界位姿换父节点
5. 转 pivot.rotation.y 就是开合：lerp(openAngle, closeAngle, t)
```

最小骨架：

```js
const pivot = new THREE.Group();
pivot.position.set(关节x, 关节y, 关节z);
assembly.add(pivot);
pivot.attach(part);            // attach 而不是 add：位姿不跳
pivot.rotation.y = angle;      // 之后只转 pivot
```

## 五、人形可动另一条路：rig + retarget

分件适合"机械关节"（爪子/门/盖）；**角色动画**用官方绑骨：

```
textToModel(人形) → rigCheck(task_id) 看 rig_type
→ rigModel(task_id) 出带骨骼 GLB
→ retarget(绑骨task_id, 'preset:run') 出带动画 GLB
```

three.js 播放：

```js
const gltf = await loader.loadAsync('run.glb');
scene.add(gltf.scene);
const mixer = new THREE.AnimationMixer(gltf.scene);
mixer.clipAction(gltf.animations[0]).play();
// 每帧：mixer.update(dt)
```

## 六、替换进游戏（奖品）

```
node tools/tripo.mjs text --prompt "..." --wait --out prototype/assets/prizes/<id>.glb
→ 在 prototype/src/assets.manifest.js 加一行 '<id>': './assets/prizes/<id>.glb'
→ 刷新页面，normalizeGLB 自动归一化尺寸/落点，抓取判定不变
```

（用 generate.mjs 改 prompts.json 重生则可自动重建 manifest。）
