# 主场景灯光（娃娃机）

## 结构

| 来源 | 作用 |
|------|------|
| **RoomEnvironment → `scene.environment`** | IBL 反射/补光，强度 `CONFIG.render.envIntensity` |
| **HemisphereLight** | 天空暖白 + 地面暗部，`CONFIG.lights.hemi` |
| **DirectionalLight（key）** | 主光、投阴影，右上前，`CONFIG.lights.key` |
| **PointLight（glow）** | 机内顶灯，在爪/洞口上方，**最容易把金属打成高光** → `CONFIG.lights.glow` |

终幕：`applyRevealColdLighting`（`main.js` / `sceneLighting.js`）关 glow、降 key/hemi、压环境。

四幕合成：`director.js` 从当前 key 色插值到暖色，并抬高 key/glow（应读 `CONFIG.lights` 基线）。

## 调参入口

- 代码：`prototype/src/config.js` → `lights`、 `render.envIntensity`
- 运行时：H 面板「场景灯光」（若已接 GUI）
- 爪闪：先降 `lights.glow.intensity` / 抬高 `glow.position[1]`；爪材质见 `clawMaterials.js`（Lambert + 关 env）

## 漫画

- **奖品**：`CONFIG.pool.comicFx`（可改全局曝光/主光）
- **爪子**：`CONFIG.claw.comicFx`（只 `applyComicStyle(claw.rig)`，不动奖品）
