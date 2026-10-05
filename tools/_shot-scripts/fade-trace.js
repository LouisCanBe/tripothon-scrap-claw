// 截图脚本：验证"连续淡化"——采样各部件的不透明度随时间的曲线
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const t0 = performance.now();
while (performance.now() - t0 < 90000) {
  if (__debug.items.filter(i => i.appearance === 'rot').length >= 8) break;
  await wait(400);
}
__debug.applyRotLighting();
__debug.snapCamera('front', 1);
__debug.director.skip();
await wait(500);

// 采样器：把每类部件的最小 opacity 与 visible 记下来
window.__trace = [];
const pick = (names) => {
  const out = [];
  __debug.world.traverse(o => {
    if (o.isMesh && names.some(n => (o.name || '').includes(n))) out.push(o);
  });
  return out;
};
const shellTop = () => pick(['machine_top', 'machine_panel', 'machine_post', 'EXPORT_machine_top', 'EXPORT_machine_panel', 'EXPORT_machine_frame']);
const coreParts = () => {
  const out = [];
  const clawRoot = __debug.claw.comicVisualRoot;
  if (clawRoot) out.push(clawRoot);
  const d = __debug.world.getObjectByName('poolDecor');
  if (d) out.push(d);
  return out;
};
const itemMeshes = () => __debug.items.map(i => i.mesh);

const minOpacity = (roots) => {
  let m = 1, any = false;
  for (const r of roots) {
    r?.traverse?.((o) => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of list) { if (!mat) continue; any = true; m = Math.min(m, mat.opacity); }
    });
  }
  return any ? +m.toFixed(3) : null;
};

const sample = (tag) => {
  const st = shellTop(), co = coreParts(), im = itemMeshes();
  window.__trace.push({
    tag,
    t: Math.round(performance.now() - t0),
    shell: minOpacity(st),
    core: minOpacity(co),
    items: minOpacity(im),
    shellVis: st.length ? st.every(o => o.visible) : null,
    itemsVis: im.filter(m => m.visible).length,
  });
};

sample('before');
const fade = __debug.fadeMachineStage('all', 7.5);
for (let i = 0; i < 18; i++) { await wait(500); sample('t+' + ((i + 1) * 0.5).toFixed(1) + 's'); }
await fade;
await wait(300);
sample('after');
return JSON.stringify(window.__trace);
