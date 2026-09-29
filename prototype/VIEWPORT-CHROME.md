# 操作视口与描边（勿拆坐标）

玩法可见区由 `#stage` 的 `clip-path` 决定（`frameMask.js` → `#rect()`）。

| DOM | 职责 |
|-----|------|
| `#stage` | `clip-path` = 矩形 **r** |
| `#narrativeViewportShade` | 盖住视口内概念底图；**位置只在 `FrameMask.apply()`**；显隐由 `narrativeBg.syncViewport` |
| `#frameBorder` | 白描边；与 shade **同一组** `fx,fy,fw,fh`（r 外扩 `viewportCoverPad`） |

调参：`config.js` → `frame.borderWidth`、`borderColor`、`viewportCoverPad`。

首屏：`main.js` 在 loading 结束前 `mask.bootstrapLayout(起始幕 layout)`，避免 `center`→`right` 动画拖影。

`#narrativeInterstitial` 必须带 `[hidden] { display: none !important }`（勿用 `display:flex` 盖掉 hidden）。
