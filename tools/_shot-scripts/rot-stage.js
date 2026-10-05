// 截图脚本：终幕 —— 灯灭 + 换货 + 构件消失（镜头全程不动）
// 用 STAGE 环境语义（写死在文件名里）分阶段截图：node tools/_shot.mjs 输出 p1.js
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 等换货
const t0 = performance.now();
while (performance.now() - t0 < 90000) {
  if (__debug.items.filter(i => i.appearance === 'rot').length >= 8) break;
  await wait(400);
}
__debug.applyRotLighting();
__debug.snapCamera('front', 1);
// 先把终幕剧本的等待与字幕快进掉，把节奏交给本脚本 ——
// 否则剧本自己也会跑 fadeMachine，两边打架，截到的就是物品已经没了的画面。
__debug.director.skip();
await wait(600);

const camBefore = [__debug.rig.pos.x, __debug.rig.pos.y, __debug.rig.pos.z].map(v => +v.toFixed(3));
const report = __debug.visualReport();
const swap = report.map(r => `${r.id}:${r.visualUrl}`);

// 壳先走：这一段结束时截图（壳没了，东西还在）
await __debug.fadeMachineStage('shell', 2.4);
await wait(700);
return JSON.stringify({
  swap,
  camBefore,
  camNow: [__debug.rig.pos.x, __debug.rig.pos.y, __debug.rig.pos.z].map(v => +v.toFixed(3)),
  itemsVisible: __debug.items.filter(i => i.mesh.visible).length,
  shellVisible: (() => {
    const shell = __debug.world.getObjectByName('machineShell');
    const vis = [];
    shell?.traverse?.(o => { if (o.isMesh && o.visible) vis.push(o.name); });
    return [...new Set(vis)];
  })(),
  textured: report.filter(r => r.mats.some(m => m.hasMap)).length,
  ofTotal: report.length,
});
