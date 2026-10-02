# 操作视口与描边（勿拆坐标）

玩法可见区由 `#stage` 的 `clip-path` 决定（`frameMask.js` → `#rect()`）。

| DOM | 职责 |
|-----|------|
| `#stage` | `clip-path` = 矩形 **r** 或 `circle()`（`acts.viewportShape`） |
| `#narrativeViewportShade` | 盖住视口内概念底图；**位置只在 `FrameMask.apply()`**；显隐由 `narrativeBg.syncViewport` |
| `#frameBorder` | `viewportEdge=fisheye` 时椭圆内缘暗角（可外扩 `viewportFeatherPx`）；`square` 时隐藏 |

调参：`config.js` → `frame.viewportEdge`（`fisheye` \| `square`）、`viewportFeatherPx`；URL `?frameEdge=`；H 面板「视口缘」。旧白描边：`borderWidth`、`borderColor`。

首屏：`main.js` 在 loading 结束前 `mask.bootstrapLayout(起始幕 layout)`，避免 `center`→`right` 动画拖影。

`#narrativeInterstitial` 必须带 `[hidden] { display: none !important }`（勿用 `display:flex` 盖掉 hidden）。

呈现 / TA：`config.present` + `present.js`（幕情绪、底图滤镜、视口渐变、全屏颗粒与 margin 暗角）；3D 色温/边缘色散见 `post.js` + `presentPostCoeffs()`。
