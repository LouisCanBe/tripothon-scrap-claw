// 截图脚本 B：终幕 —— 灯灭 + 换货 + 构件消失（镜头全程不动）
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// 等换货
const t0 = performance.now();
while (performance.now() - t0 < 90000) {
  if (__debug.items.filter(i => i.appearance === 'rot').length >= 8) break;
  await wait(400);
}
__debug.applyRotLighting();
await wait(400);

const camBefore = [__debug.rig.pos.x, __debug.rig.pos.y, __debug.rig.pos.z].map(v => +v.toFixed(3));
const report = __debug.visualReport();
const swapOk = report.every(r => r.appearance === 'rot' && r.visualUrl && r.visible);
const textured = report.filter(r => r.mats.some(m => m.hasMap)).length;

// 壳先走
await __debug.fadeMachineStage('shell', 2.6);
await wait(500);
const shellGone = (() => {
  const shell = __debug.world.getObjectByName('machineShell');
  const vis = [];
  shell?.traverse?.(o => { if (o.isMesh && o.visible) vis.push(o.name); });
  return [...new Set(vis)];
})();

// 爪子和东西再走
const fadeCore = __debug.fadeMachineStage('core', 4.0);
await wait(1200);
const midShot = 'mid';
await fadeCore;
await wait(300);

const after = {
  itemsVisible: __debug.items.filter(i => i.mesh.visible).length,
  camAfter: [__debug.rig.pos.x, __debug.rig.pos.y, __debug.rig.pos.z].map(v => +v.toFixed(3)),
  camMoved: Math.hypot(
    __debug.rig.pos.x - camBefore[0],
    __debug.rig.pos.y - camBefore[1],
    __debug.rig.pos.z - camBefore[2],
  ).toFixed(3),
};
return JSON.stringify({
  swapOk, textured, ofTotal: report.length,
  sample: report.slice(0, 3),
  shellGone,
  after,
  midShot,
}, null, 1);
