# 概念图审阅

在浏览器里按剧情顺序看图（左侧列表 + 大图，键盘 ← → 切换）：

| 入口 | 地址 |
|------|------|
| 工具 Hub · Seedream | [http://localhost:8780/concepts](http://localhost:8780/concepts) 或 [/design/concepts/review.html](http://localhost:8780/design/concepts/review.html) |
| 工具 Hub · Cursor 写实 | [http://localhost:8780/concepts?set=cursor](http://localhost:8780/concepts?set=cursor) 或 [review.html?set=cursor](http://localhost:8780/design/concepts/review.html?set=cursor) |
| 试玩 devServer（`prototype/` 根） | [http://127.0.0.1:8000/design/concepts/review.html](http://127.0.0.1:8000/design/concepts/review.html) |

顺序数据：`review-order.json` · 写实组：`review-order-cursor.json`

**写实组注意**：只有「真相定帧」用 `assets/images/reveal-truth-hand-can.png`；其它镜头生成时不要挂该参考图，否则容易 everywhere 出现手拿罐。
