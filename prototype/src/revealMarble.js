// ============================================================
// 终幕 Marble 沉浸式：collider GLB（边界）+ SPZ（写实层）
//
// 场景树与坐标系（重要！）
// -------------------
//   scene（Three.js 世界，原点 0,0,0）
//   └── revealRoot              identity
//       └── frame               rotation.x = π ← 唯一的全局旋转
//           ├── dropIn          identity（DropInViewer）
//           │   └── splatMesh   GPU 数据 = SplatScene变换 × 原始点
//           └── gltf.scene      GLB 节点变换
//
// frame.rotation.x = π 会把所有子节点的 (x,y,z) → (x,-y,-z)：
// 本地 +Y → 世界 -Y，本地 -Y → 世界 +Y。SPZ 和 GLB 都在 frame 底下，
// 所以两边受同一个翻转影响 —— 这是它们能对齐的前提。
//
// "底" 与"顶"（全部统一为**世界坐标**）
// -------------------
//   collider 底 = Box3.setFromObject(gltf.scene).min.y   含 frame 翻转
//   collider 顶 = Box3.setFromObject(gltf.scene).max.y   含 frame 翻转
//   SPZ 底      = computeSplatWorldBox().min.y           已补 applyMatrix4，含 frame 翻转
//   SPZ 顶      = computeSplatWorldBox().max.y           已补 applyMatrix4，含 frame 翻转
//
// ⚠️ computeSplatWorldBox 内部必须 applyMatrix4(splatMesh.matrixWorld)，
//    因为 splatMesh.computeBoundingBox(true) 只含 SplatScene 自身变换，
//    不含父链的 frame 翻转。少了这一步就是拿本地 Y 减世界 Y，永远对不齐。
//
// colliderFloorY —— 直接用世界 Y 指定 collider 盒底高度
// -------------------
//   revealWorlds.js 里每个场景可配 colliderFloorY（世界坐标，米）：
//     number → collider 盒底直接贴到这个 Y，不管 SPZ 在哪
//     null   → 退回自动模式：collider 盒底贴 SPZ 盒底
//   调法：调试台「对齐」面板拖滑块（拖的是绝对世界 Y），
//         同时看高度标尺 / 几何摘要确认数值，导出配置粘回 revealWorlds.js。
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withCompressedDecoders } from './glbDecoders.js';
import { DropInViewer } from '../vendor/addons/gaussian-splats-3d.js';

const loader = withCompressedDecoders(new GLTFLoader());

export function computeWorldBounds(object3d) {
  object3d.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object3d);
}

export function collectColliderMeshes(root) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry) meshes.push(o);
  });
  return meshes;
}

/**
 * 加载 collider GLB，并把它的**盒底**贴到指定的世界 Y。
 *
 * ⚠️ 关键：`localBoxMinY` 是「与 group.position.y 无关的本地盒底」。
 *    Box3.setFromObject 读的是 matrixWorld，**已经含当前 position.y**。
 *    如果拿它直接算 position.y，下次再算时旧平移会被二次计入 → 越拖越偏。
 *    所以必须先减掉 position.y 得到纯本地值并缓存，之后每次
 *    position.y = 目标Y - localBoxMinY 才能精确命中。
 *
 * @param {string} url GLB 路径
 * @param {THREE.Object3D} parent 已带 Marble 翻转的父节点（frame）
 * @param {number|null} floorWorldY collider 盒底要落在的世界 Y。
 *                 number → 盒底贴到这个高度（绝对定位，与 SPZ 无关）
 *                 null   → 盒底落到世界 y=0
 * @returns {Promise<{group: THREE.Group, box: THREE.Box3, floorWorldY: number, localBoxMinY: number}>}
 *          floorWorldY = 实际贴上去后的盒底世界 Y
 *          localBoxMinY = 纯本地盒底（不含 position.y），供后续绝对定位复用
 */
export async function loadMarbleCollider(url, parent, floorWorldY = null) {
  const gltf = await loader.loadAsync(url);
  const group = gltf.scene;
  parent.add(group);
  parent.updateMatrixWorld(true);
  // 此时 position.y 还是 GLTF 原始值，box.min.y = 本地几何盒底 + position.y
  const box = new THREE.Box3().setFromObject(group);
  // 减掉当前平移 → 纯本地盒底。GLTF 根节点自带位移也能正确处理
  const localBoxMinY = box.min.y - group.position.y;
  const target = (floorWorldY == null ? 0 : floorWorldY);
  // 用本地值算，保证贴完盒底正好在 target
  group.position.y = target - localBoxMinY;
  // 回读确认：平移后重新算盒底，把真实值暴露出去（调试台要显示）
  parent.updateMatrixWorld(true);
  const boxAfter = new THREE.Box3().setFromObject(group);
  group.visible = false;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (mat) mat.side = THREE.DoubleSide;
    }
  });
  return { group, box: boxAfter, floorWorldY: boxAfter.min.y, localBoxMinY };
}

/**
 * 点云世界包围盒。
 *
 * ⚠️ splatMesh.computeBoundingBox(true) 的 true 只表示「应用 SplatScene 自身变换」
 *    （addSplatScene 传的 position/rotation/scale），**不含 splatMesh.matrixWorld**。
 *    而 splatMesh 挂在 dropIn → frame（rotation.x = π）下，父链变换会翻转 Y/Z。
 *    所以拿到的盒是 splatMesh **本地空间**，不是世界空间 —— 必须再 applyMatrix4
 *    (splatMesh.matrixWorld) 才是真正的世界坐标。
 *
 * 这个区别很关键：collider 那边 Box3.setFromObject 默认就含全部父变换（世界空间），
 * 两边不统一的话，对齐公式就是在拿「翻了 Y 的数」减「没翻 Y 的数」。
 */
export function computeSplatWorldBox(dropIn) {
  try {
    const mesh = dropIn?.viewer?.splatMesh;
    if (!mesh) return null;
    const box = mesh.computeBoundingBox(true);
    if (box && Number.isFinite(box.min.y)) {
      // 从场景根往下刷新，确保 frame.rotation.x = π 已写进 matrixWorld
      let top = mesh;
      while (top.parent) top = top.parent;
      top.updateMatrixWorld(true);
      // 本地盒 → 世界盒（frame 翻转在这一步生效）
      box.applyMatrix4(mesh.matrixWorld);
      return box;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 挂载终幕 Marble 场景：SPZ 点云 + collider GLB，并处理两者的高度关系。
 *
 * @returns {Promise<{ frame: THREE.Group, bounds: THREE.Box3, colliderMeshes: THREE.Mesh[], colliderGroup: THREE.Group|null, splatWorldBox: THREE.Box3|null, splatFloorY: number|null, colliderFloorY: number, setColliderFloorY: (y:number)=>void, swapSplatTier: (url:string, floorY?:number|null)=>Promise<THREE.Box3|null>, dispose: () => void }>}
 */
/**
 * @param {string} opts.colliderUrl collider GLB 路径
 * @param {string} opts.spzUrl 点云 .spz 路径
 * @param {boolean} [opts.showBoundsHelper]
 * @param {boolean} [opts.alignColliderToSplat=true] 没配 colliderFloorY 时是否自动贴 SPZ 盒底
 * @param {number} [opts.splatYOffset=0] 仅自动模式：SPZ 盒底的附加偏移（米）
 * @param {number|null} [opts.colliderFloorY=null] **collider 盒底的目标世界 Y（米）**。
 *                给了就直接把 collider 盒底贴到这个绝对高度，不看 SPZ。
 *                null = 退回自动模式（贴 SPZ 盒底）。
 */
export async function mountMarbleImmersive(root, { colliderUrl, spzUrl, showBoundsHelper = false, alignColliderToSplat = true, splatYOffset = 0, colliderFloorY = null }) {
  const frame = new THREE.Group();
  frame.name = 'marbleImmersive';
  frame.rotation.x = Math.PI;
  root.add(frame);

  // —— 先挂点云：collider 要贴它，所以必须让 SPZ 先就位 ——
  const dropIn = new DropInViewer({ sharedMemoryForWorkers: false });
  frame.add(dropIn);
  await dropIn.addSplatScene(spzUrl, {
    progressiveLoad: false,
    showLoadingUI: false,
    rotation: [0, 0, 0, 0],
  });

  // 点云盒底（世界 Y）。computeSplatWorldBox 内部已 applyMatrix4(splatMesh.matrixWorld)，
  // 把 frame.rotation.x = π 的翻转算进去了，返回的是真正的世界坐标。
  let splatFloorY = null;
  let splatWorldBox = null;
  let colliderGroup = null;
  let colliderBaseY = 0;          // collider 盒底当前的世界 Y（实时值）
  let colliderLocalMinY = 0;      // 纯本地盒底（不含 position.y），绝对定位用
  let colliderFloorTarget = null; // 目标世界 Y（可能来自配置，也可能是 SPZ 自动值）

  try {
    splatWorldBox = computeSplatWorldBox(dropIn);
    if (alignColliderToSplat && splatWorldBox) {
      // 自动模式：贴 SPZ 盒底。splatYOffset 是在此基础上再抬/压点云
      splatFloorY = splatWorldBox.min.y + (splatYOffset || 0);
    }
  } catch {
    // ignore and fall back to collider-local alignment below
  }

  // colliderFloorY 优先：场景配置里给了世界 Y 就直接用，不走自动贴 SPZ
  const floorTarget = (colliderFloorY != null ? colliderFloorY : splatFloorY);
  colliderFloorTarget = floorTarget;

  try {
    const result = await loadMarbleCollider(colliderUrl, frame, floorTarget);
    colliderGroup = result.group;
    // 贴完之后盒底的真实世界 Y
    colliderBaseY = result.floorWorldY;
    // 缓存本地盒底：之后 setColliderFloorY / swapSplatTier 都用它算 position.y，
    // 不再跑 setFromObject（19 万三角，拖滑块会卡），也避免二次计入旧平移
    colliderLocalMinY = result.localBoxMinY;
  } catch {
    // if collider fails to load, continue with splat only
  }

  const bounds = computeWorldBounds(frame);
  const colliderMeshes = collectColliderMeshes(colliderGroup ?? frame);

  if (showBoundsHelper) {
    try { frame.add(new THREE.Box3Helper(bounds, 0x3a4a5a)); } catch { /* ignore */ }
  }

  const api = {
    frame,
    bounds,
    colliderMeshes,
    dropIn,
    colliderGroup,
    splatWorldBox,
    /** 点云盒底（世界 Y）。null = 本次没做对齐，collider 自己落地。 */
    splatFloorY,
    /** collider 盒底当前的世界 Y（贴齐后的实际值，实时） */
    get colliderFloorY() { return colliderBaseY; },
    /**
     * 直接把 collider 盒底设到某个世界 Y（绝对坐标，不是偏移量）。
     *
     * 用缓存的 localBoxMinY 算，不跑 setFromObject：
     *   position.y = worldY - localBoxMinY  ⇒  盒底正好落在 worldY
     * @param {number} worldY 目标世界 Y
     */
    setColliderFloorY(worldY) {
      if (!colliderGroup || !Number.isFinite(worldY)) return;
      colliderGroup.position.y = worldY - colliderLocalMinY;
      colliderBaseY = worldY;
    },
    /**
     * 热换点云档位（100k ↔ 500k），不重载 collider。
     *
     * 快的原因：不走 removeSplatScenes（它会 disposeSortWorker + splatMesh.dispose
     * + createSplatMesh 整套重建），而是 downloadSplatSceneToSplatBuffer 拿 buffer
     * 后直接 addSplatBuffers(..., replaceExisting = true) 原地替换 GPU 数据。
     *
     * collider 位置策略：如果场景配了 colliderFloorY（绝对世界 Y），
     * 换档不动 collider；否则才按新 SPZ 盒底重新贴。
     *
     * @param {string} spzUrl 新档位的 .spz 文件 URL
     * @param {number|null} floorYOverride 绝对世界 Y；null = 按当前模式自动
     * @returns {Promise<THREE.Box3|null>} 新点云的世界包围盒
     */
    async swapSplatTier(spzUrl, floorYOverride = null) {
      if (!dropIn?.viewer) return null;
      const v = dropIn.viewer;
      let buffer = null;
      try {
        // 1) 下载并解码成 SplatBuffer（SPZ 不可渐进，这里就是全量下载）
        buffer = await v.downloadSplatSceneToSplatBuffer(spzUrl);
      } catch (e) {
        console.error('[reveal] swapSplatTier download failed', e);
        return null;
      }
      try {
        // 2) 原地替换：replaceExisting = true，旧 buffer 直接被换掉，不重建 mesh
        await v.addSplatBuffers(
          [buffer],
          [{ rotation: [0, 0, 0, 1], position: [0, 0, 0], scale: [1, 1, 1], splatAlphaRemovalThreshold: 1 }],
          true,    // finalBuild
          false,   // showLoadingUI
          false,   // showLoadingUIForSplatTreeBuild
          true,    // replaceExisting ← 关键
        );
      } catch (e) {
        console.error('[reveal] swapSplatTier addSplatBuffers failed', e);
        return null;
      }
      // 3) 新 SPZ 世界包围盒
      const newBox = computeSplatWorldBox(dropIn);
      if (!newBox) return null;
      // 4) collider 位置：绝对 Y 优先，保持不动；否则按新 SPZ 盒底重贴
      if (colliderGroup) {
        let target = floorYOverride;
        if (target == null) {
          target = (colliderFloorTarget != null)
            ? colliderFloorTarget
            : newBox.min.y + (CONFIG.reveal.splatYOffset ?? 0);
        }
        // 同样用缓存的本地盒底，精确命中且不跑 setFromObject
        colliderGroup.position.y = target - colliderLocalMinY;
        colliderBaseY = target;
      }
      return newBox;
    },
    dispose() {
      try { dropIn.viewer?.dispose(); } catch { /* ignore */ }
      root.remove(frame);
      colliderGroup?.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };

  return api;
}
