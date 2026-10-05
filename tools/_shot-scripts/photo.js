// 截图脚本 A：相框式过场图 —— 第三幕开场的配给单（长驻，供截图）
// 注意不要 await：await 会等到照片演完才返回，截图就拍到空画面了。
const done = __debug.narrativeBg.showFrame('rationNotice', 60, { caption: '今天的配额。' });
await new Promise(r => setTimeout(r, 2500));
const el = document.getElementById('narrativePhoto');
const b = el.getBoundingClientRect();
return JSON.stringify({
  hidden: el.hidden,
  rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
  opacity: getComputedStyle(el).opacity,
  imgW: document.getElementById('narrativePhotoImg').naturalWidth,
  caption: document.getElementById('narrativePhotoCaption').textContent,
  pending: !!done,
});
