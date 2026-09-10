// ============================================================
// 装配：渲染器 / 场景 / 灯光 / 外壳 / 各模块 / 调参面板 / 主循环
// ============================================================
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { CONFIG } from './config.js';
import { spawnPool, upgradeVisuals } from './prizePool.js';
import { ClawMachine } from './clawMachine.js';
import { CameraRig } from './cameraRig.js';
import { FrameMask } from './frameMask.js';
import { Post } from './post.js';
import { Input } from './input.js';

// —— 渲染器 ——
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 60);

// —— 灯光：记忆层的"暖"（终幕实景再反转为冷调）——
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x191a20, 0.55));
const key = new THREE.DirectionalLight(0xffe7c4, 1.1);
key.position.set(2.5, 4, 3);
scene.add(key);
const glow = new THREE.PointLight(0xffd9a0, 10, 7, 1.8);
glow.position.set(0, 1.7, 0.4);
scene.add(glow);

// —— 娃娃机外壳（灰盒：框架 + 底板 + 背板，玻璃省略）——
(function buildShell() {
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.55, metalness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 2.3), matBody);
  base.position.y = -0.15;
  scene.add(base);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x3d3428, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  scene.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), matDark);
  back.position.set(0, 1.05, -1.12);
  scene.add(back);

  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.1, 10);
  for (const [px, pz] of [[-1.58, -1.08], [1.58, -1.08], [-1.58, 1.08], [1.58, 1.08]]) {
    const m = new THREE.Mesh(postGeo, matBody);
    m.position.set(px, 1.05, pz);
    scene.add(m);
  }

  const top = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.32, 2.3), matBody);
  top.position.y = 2.2;
  scene.add(top);

  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.06), matDark);
  panel.position.set(0.9, 0.05, 1.14);
  scene.add(panel);

  // 取物洞
  const [hx, hz] = CONFIG.claw.holePos;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.claw.holeRadius, 0.02, 10, 32), matBody);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hx, 0.015, hz);
  scene.add(rim);
  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(CONFIG.claw.holeRadius, CONFIG.claw.holeRadius, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pit.position.set(hx, -0.14, hz);
  scene.add(pit);
})();

// —— 奖池（几何体秒开；manifest 有 GLB 的会原位热替换）——
const items = spawnPool(scene);
upgradeVisuals(scene, items);

// —— HUD 回调 ——
let collected = 0;
const msgEl = document.getElementById('msg');
let msgTimer = 0;
const hooks = {
  onMessage(text) {
    msgEl.textContent = text;
    msgEl.style.opacity = '1';
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (msgEl.style.opacity = '0'), 2400);
  },
  onCollect(item) {
    document.getElementById('collected').textContent = ++collected;
    if (item.quest) {
      document.getElementById('q-' + item.id)?.classList.add('done');
      const allDone = ['bread', 'can', 'veg']
        .every(id => document.getElementById('q-' + id).classList.contains('done'));
      if (allDone) setTimeout(() => hooks.onMessage('配额完成。「那天他们吃得很好。」'), 1200);
    }
  },
};

// —— 模块装配 ——
const claw = new ClawMachine(scene, items, hooks);
const rig = new CameraRig(camera);
const mask = new FrameMask();
const post = new Post(renderer, scene, camera);
post.setSize(innerWidth, innerHeight);
const input = new Input();

// 画幅切换 → 鱼眼同步消退/恢复
window.addEventListener('framechange', (e) => {
  if (CONFIG.frame.fisheyeFadeOnWide) post.setFisheyeFade(e.detail === 'wide' ? 0 : 1);
});

input.on('drop', () => claw.startDrop());
input.on('view', (v) => rig.setView(v));
input.on('cycle', (d) => rig.cycle(d));
input.on('toggleFrame', () => mask.toggle(true));
input.on('hardCut', () => mask.hardCut());

// —— 调参面板（H 切换显隐）——
const gui = new GUI({ title: '爪机手感调参' });
{
  const f = gui.addFolder('移动惯性');
  f.add(CONFIG.claw, 'moveSpeed', 0.5, 4, 0.05);
  f.add(CONFIG.claw, 'moveTau', 0.02, 0.25, 0.005).name('moveTau(稳定≈2τ)');

  const d = gui.addFolder('落爪时序');
  d.add(CONFIG.claw, 'dropSpeed', 0.5, 5, 0.05);
  d.add(CONFIG.claw, 'liftSpeed', 0.3, 3, 0.05);
  d.add(CONFIG.claw, 'closeDelay', 0, 0.6, 0.01);
  d.add(CONFIG.claw, 'closeDuration', 0.1, 1, 0.01);

  const g = gui.addFolder('爪力 / 滑落');
  g.add(CONFIG.claw, 'gripStrength', 0, 1, 0.01);
  g.add(CONFIG.claw, 'baseSlipProb', 0, 1, 0.01);
  g.add(CONFIG.claw, 'grabRadius', 0.15, 0.5, 0.01);
  g.add(CONFIG.claw, 'wobbleAmp', 0, 0.06, 0.001);

  const c = gui.addFolder('镜头');
  c.add(CONFIG.camera, 'fov', 60, 100, 1);
  c.add(CONFIG.camera, 'tau', 0.1, 1, 0.01).name('切换tau');
  c.add(CONFIG.camera, 'breathDeg', 0, 0.6, 0.01);

  const p = gui.addFolder('后处理');
  p.add(CONFIG.post, 'k1', -0.2, 0.3, 0.005);
  p.add(CONFIG.post, 'k2', 0, 0.2, 0.005);
  p.add(CONFIG.post, 'grain', 0, 0.15, 0.005);
  p.add(CONFIG.post, 'vignette', 0, 1, 0.05);

  const act = {
    '展开16:9(过渡)': () => mask.toWide(true),
    '硬切16:9(降级)': () => mask.hardCut(),
    '回到1:1': () => mask.toSquare(true),
  };
  gui.add(act, '展开16:9(过渡)');
  gui.add(act, '硬切16:9(降级)');
  gui.add(act, '回到1:1');
}
let guiOn = true;
input.on('gui', () => { guiOn = !guiOn; gui.show(guiOn); });

// —— 主循环 ——
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const ax = input.axis();
  claw.move(ax.x, ax.z, dt);
  claw.update(dt, t);
  rig.update(dt, t);
  post.render(dt, t);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  // 画幅遮罩在 frameMask 内自行监听 resize
});
