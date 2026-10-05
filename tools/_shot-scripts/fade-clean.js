// 干净环境里只测"连续溶解曲线"本身：act1 + 关掉剧本，世界本来就亮着
const wait = (ms) => new Promise(r => setTimeout(r, ms));
__debug.director.scriptDisabled = true;
await wait(300);

const pick = (names) => {
  const out = [];
  __debug.world.traverse(o => {
    if (o.isMesh && names.some(n => (o.name || '').includes(n))) out.push(o);
  });
  return out;
};
const minOp = (roots) => {
  let m = 1, any = false;
  for (const r of roots) {
    r?.traverse?.((o) => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of list) { if (mat) { any = true; m = Math.min(m, mat.opacity); } }
    });
  }
  return any ? +m.toFixed(3) : null;
};
const shellTop = () => pick(['machine_top', 'machine_panel', 'machine_post', 'EXPORT_machine_top', 'EXPORT_machine_panel', 'EXPORT_machine_frame']);
const coreParts = () => {
  const out = [];
  const c = __debug.claw.comicVisualRoot; if (c) out.push(c);
  const d = __debug.world.getObjectByName('poolDecor'); if (d) out.push(d);
  return out;
};
const items = () => __debug.items.map(i => i.mesh);
const base = () => pick(['EXPORT_machine_base', 'EXPORT_machine_back', 'machine_base', 'machine_back', 'machine_floor']);

const trace = [];
const sample = (tag, t) => trace.push({
  tag, t,
  shell: minOp(shellTop()), core: minOp(coreParts()), items: minOp(items()), base: minOp(base()),
  visFlags: [shellTop(), items()].every(g => g.every(o => o.visible)),
});
sample('0.0s', 0);
const t0 = performance.now();
const fade = __debug.fadeMachineStage('all', 7.5);
for (let i = 1; i <= 16; i++) {
  await wait(500);
  sample(((performance.now() - t0) / 1000).toFixed(1) + 's', Math.round(performance.now() - t0));
}
await Promise.race([fade, wait(20000)]);
sample('end', Math.round(performance.now() - t0));
return JSON.stringify(trace);
