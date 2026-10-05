// 截图脚本：显形态（他以为的）—— 干净柜里的同一批东西
const wait = (ms) => new Promise(r => setTimeout(r, ms));
__debug.director.skip();
__debug.restoreMemoryLighting();
await __debug.setPoolAppearance('manifest');
__debug.snapCamera('front', 1);
await wait(800);
const r = __debug.visualReport();
return JSON.stringify({
  appearance: r[0]?.appearance,
  models: r.map(v => `${v.id}:${v.visualUrl}|${v.size.join('x')}`),
});
