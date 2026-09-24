# 主场景灯光 · 定版（2026-03）

## 设计目标

- **全局柔和照亮**奖池与机壳，关点光也不黑。
- **避免机内 PointLight 直射**白模/金属爪（高光、闪）。
- 漫画 Toon 靠材质；亮度靠 **ambient + 半球 + 双平行光 + IBL**。

## 栈（从底到顶）

| 层 | 配置 | 作用 |
|----|------|------|
| **AmbientLight** | `lights.ambient` | 均匀底光，抬整体暗部 |
| **HemisphereLight** | `lights.hemi` | 暖天/冷地渐变 |
| **Directional key** | `lights.key` | 主方向光 + **阴影**（强度偏低） |
| **Directional fill** | `lights.fill` | 对侧补光，**不投影** |
| **RoomEnvironment IBL** | `render.envIntensity` | 全局反射/补亮 |
| **Point glow** | `lights.glow` | **默认 0**；四幕合成可略抬，日常不用 |

ACES 曝光：`render.exposure`（定版约 1.18）。

## 调参

- H → **场景灯光(定版)**：`环境底光` / `半球` / `主光` / `对侧补光` / `机内点光(慎用)`
- 爪闪：勿拉高点光；可略增 `环境底光` 或 `envIntensity`
- 终幕冷光：`applyRevealColdLighting`（压主光/补光/半球）

## 漫画

- 奖池：`pool.comicFx`
- 爪：`claw.comicFx`（仅 `comicVisualRoot`）
- 描边：`tools/comic-render.mjs`（共享 geometry 子 Mesh）
