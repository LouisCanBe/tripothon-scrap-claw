# 娃娃机外壳尺寸规格（与灰盒 / 玩法对齐）

**单位：米（three.js 世界坐标）**  
**原点**：奖池地面中心 `(0, 0, 0)`，`y = 0` 为池底平面。  
**朝向**：`+Z` = 玩家侧（前脸/操控台方向），`-Z` = 后墙。

改完 GLB 后仍走 `machineShellTripo.js` 的槽位，或自己在 DCC 里按下列 **目标包围盒** 建模，导出时 **底面中心 / 件中心** 与下表一致即可减少穿模。

---

## 当前确认版（2026-10-02）

效果已看过，可以先停在这一版。游戏不按槽位再拉伸，直接装入 Blender 里摆好的整壳。

| 用途 | 路径 |
|------|------|
| 游戏读取 | `prototype/assets/machine/placed/shell.glb` |
| Blender 场景 | `prototype/assets/machine/machine-shell.blend` |
| 开关 | `config.machineShell.placedShell`；灰盒对比仍用 `?machineShell=proc` |

壳内分件（Blender Z 轴向上，游戏 Y 轴向上，导出时由 glTF 换轴）：

- **底座** `EXPORT_machine_base`：保留手动的 Y 轴 180° 朝向。顶面取物洞在 `(-1.12, -0.82)`，半径 0.24，和判定一致。奖池地面另有同位置圆孔。
- **背面** `EXPORT_machine_back`：底座复制后绕 X 转 90° 立起来。宽 3.3，厚 0.3。内侧面在游戏 z≈−1.10，比爪子后限 z=−0.90 再靠后，避免爪子扎进板里。
- **立柱** `EXPORT_machine_frame_front / _left / _right`：正面一件拆出后，复制到左右。进深加厚过，外侧面不动。
- **顶盖、面板、洞圈** 按当时摆放原位进游戏。灰盒圆环隐藏，避免和洞圈叠在一起。

不要把这份 `shell.glb` 再交回 `fitMeshToSlot`，会按槽位压第二次。

---

## 必须留空的「内腔」（不要放网格）

奖品与爪子只在这一块活动；外壳 mesh **只能贴边**，中间要镂空。

| 轴 | 范围（约） | 说明 |
|----|------------|------|
| X | −1.45 ~ +1.45 | 略大于 `pool.boundsX` ±1.30 |
| Z | −1.02 ~ +1.02 | 略大于 `pool.boundsZ` ±0.85；前缘留给面板 |
| Y | 0 ~ 2.05 | 池底到顶盖下沿；爪待机约 y=1.55 |

**洞口**（灰盒永远保留，模型不要封死）：中心 `(-1.12, 0, 0.82)`，半径 **0.24**（圆在 XZ 平面）。

**爪子水平行程**：X −1.35~1.35，Z −0.90~0.90。  
**奖池逻辑边界**：X −1.30~1.30，Z −0.85~0.85（`config.pool`）。

---

## 灰盒参考（`machineShell.js`）

| 部件 | 几何 | 中心位置 (x, y, z) | 外形尺寸 (宽×高×深) = X×Y×Z |
|------|------|-------------------|------------------------------|
| 底座 | Box | (0, **−0.15**, 0) | **3.3 × 0.3 × 2.3** |
| 池底 | Plane | y=0.001 | **3.0 × — × 2.0**（仅贴图面） |
| 后墙 | Plane | (0, **1.05**, **−1.12**) | **3.3 × 2.4**（薄片） |
| 立柱 ×4 | Cylinder r=0.045 | (±**1.58**, **1.05**, ±**1.08**) | 高 **2.1** |
| 顶盖 | Box | (0, **2.2**, 0) | **3.3 × 0.32 × 2.3** |
| 前脸面板 | Box | (**0.9**, **0.05**, **1.14**) | **0.5 × 0.18 × 0.06** |

立柱内侧净空约：**3.16 × 2.16**（角点连线），高度到顶盖底约 **2.05**。

---

## Tripo 分件槽位（`MACHINE_SHELL_SLOTS`）

载入时把每件 **整体 AABB 非等比拉伸** 到 `size`，再让 **包围盒中心** 对齐 `position`。

| 文件 id | 目标包围盒 size [X,Y,Z] | 中心 position [x,y,z] | 建模提示 |
|---------|-------------------------|------------------------|----------|
| `machine_base` | 3.3, 0.3, 2.3 | 0, −0.15, 0 | 仅_pedestal；顶面 y=0 齐平池底外缘 |
| `machine_frame` | 3.16, 2.1, 2.16 | 0, 1.05, 0 | **仅四立柱+顶梁，中间完全镂空**；不要地板/玻璃/内衬 |
| `machine_top` | 3.3, 0.32, 2.3 | 0, 2.2, 0 | 顶盖；底面约在 y≈2.04 |
| `machine_back` | 3.3, 2.4, 0.08 | 0, 1.05, −1.12 | 后墙薄板，法线朝 +Z |
| `machine_panel` | 0.5, 0.18, 0.08 | 0.9, 0.05, 1.14 | 右侧操控台小块，不要向前伸进内腔 |

导出建议：

1. **一件 GLB 对应上表一行**；轴心放在 **该件目标包围盒的几何中心**（或底面中心 + 在槽位里改 `position`）。
2. `machine_frame` 最容易盖奖品：生成/建模时强调 **open frame / hollow / no interior solid**。
3. 玻璃若要做：单独薄片，放在 z≈+1.0~1.12，**不要**和 frame 并成实心体。

---

## 灰盒对照模型（与游戏完全一致）

已导出三角网格（米制、同名 object）：

- **`prototype/design/machine-shell-ref/machine_shell_graybox_reference.obj`**
- 重新生成：`node tools/export-machine-shell-ref.mjs`

物体名：`machine_base` / `machine_floor` / `machine_back` / `machine_post_*` / `machine_top` / `machine_panel` / `machine_hole_*`；辅助 **`REF_cavity_volume`**（内腔勿占）、**`REF_hole_circle`**、**`REF_axes_XYZ`**。

Blender：**File → Import → Wavefront (.obj)**，单位 **米**；轴向选 **Forward -Z、Up Y**（与 Three.js 一致）。默认导入会把灰盒整体转 90°，线框会和 Tripo 分件对不上。

### 推荐生成流程（三选一）

| 方式 | 适合 | 操作 |
|------|------|------|
| **Hub 快捷** | 单件试 prompt | 左侧 **机柜分件** 提交；预览勾选 **机柜工作区** → **套入槽位**（与游戏同算法）→ **拖移** 微调（Shift+滚轮调 Y） |
| **CLI 批量** | 5 件一口气 | `.\tools\run-generate-machine.ps1 -Force`（与 `prompts-machine.json` 一致） |
| **四视图 → P2** | **推荐** | `.\tools\run-machine-multiview-pipeline.ps1`（每件 4 张正交 → multiview-to-model） |
| **单图 → P2** | 快试（易整柜） | `run-machine-image-pipeline.ps1`；若一图多件请改四视图或 `split-machine-turnaround.mjs` |
| **DCC 手模** | 要对齐洞口/内腔 | Blender 导入 OBJ 对照 → 按表建模 → 导出 GLB 到 `assets/machine/<id>.glb` |

Tripo **不能**直接吃 OBJ 当生成输入；OBJ 只作尺寸对照。图生 3D 可在 Blender 里对单件 **渲染正视/侧视** 再走 Hub「四视图 → 模型」。

---

## 生成与接入

```text
.\tools\run-generate-machine.ps1 -Force -Only "machine_frame"
```

覆盖 `prototype/assets/machine/<id>.glb` 后刷新；`assets.manifest-machine.js` 由脚本维护。

- 先看灰盒：`?machineShell=proc`
- 当前游戏走摆好的整壳：`config.machineShell.placedShell`（见上文「当前确认版」）

槽位微调：改 `prototype/src/machineShellTripo.js` 里 `MACHINE_SHELL_SLOTS` 的 `size` / `position` 即可，无需重导 GLB。

---

## 侧视图示意（ASCII）

```text
        machine_top  y=2.2
  +---------------------------+
  |  posts   [ 内腔/奖品 ]    |  y~1.05  frame 中心
  |                          |  back @ z=-1.12
  +---------------------------+
  y=0  池底平面  ·············  洞口 (-1.12, 0.82)
  +---------------------------+
        machine_base  y=-0.15
              +Z 玩家
```
