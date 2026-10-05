// 截图脚本 B：终幕构件消失之后（只剩底座/背板 + 坏掉的东西）
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// 等换货
const t0 = performance.now();
while (performance.now() - t0 < 90000) {
  if (__debug.items.filter(i => i.appearance === 'rot').length >= 8) break;
  await wait(400);
}
__debug.applyRotLighting();
// 直接跑真实的构件消失 + 贴地那一镜
const before = JSON.stringify(__debug.machineParts());
const fade = __debug.fadeMachineToNothing(2.0);
await wait(2600);
await __debug.poolScanBeat({ preset: 'floor', dur: 0.1, restore: false });
await wait(700);
const after = JSON.stringify({
  deck: __debug.machineParts().deck,
  visMeshes: (() => {
    const shell = __debug.world.getObjectByName('machineShell');
    const vis = [];
    shell?.traverse?.(o => { if (o.isMesh && o.visible) vis.push(o.name); });
    return [...new Set(vis)];
  })(),
  rotVisible: __debug.items.filter(i => i.appearance === 'rot' && i.mesh.visible).length,
  cam: [__debug.rig.pos.x.toFixed(2), __debug.rig.pos.y.toFixed(2), __debug.rig.pos.z.toFixed(2)],
});
void fade;
return 'before=' + before + '\nafter=' + after;
