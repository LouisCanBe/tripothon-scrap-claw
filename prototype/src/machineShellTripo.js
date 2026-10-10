// Tripo 分件外壳：按灰盒槽位缩放摆放，失败保留 machineShell 程序化几何。
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GLB_MANIFEST_MACHINE } from './assets.manifest-machine.js';
import { capTextures, enableShadows } from './prizePool.js';
import { enqueueRendererCompile } from './renderCompile.js';
import { MACHINE_SHELL_SLOTS, fitMeshToSlot } from './machineShellSlots.js';

export { MACHINE_SHELL_SLOTS };

/**
 * @param {THREE.Group} shell from buildMachineShell
 * @param {THREE.Group} procedural 可隐藏的灰盒件
 */
async function loadPlacedShell(shell, procedural, renderer, camera, url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { withCompressedDecoders } = await import('./glbDecoders.js');
  const loader = withCompressedDecoders(new GLTFLoader());
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  root.name = 'machineShellPlaced';
  if (matchMedia('(pointer: coarse)').matches && CONFIG.mobile?.maxTextureSize) {
    capTextures(root, CONFIG.mobile.maxTextureSize);
  }
  enableShadows(root);
  shell.add(root);
  if (procedural) procedural.visible = false;
  // 底座已经挖穿，灰盒圆环会和 Tripo 洞圈叠在一起
  const rim = shell.getObjectByName('machine_hole_rim');
  if (rim) rim.visible = false;
  if (renderer && camera) {
    root.visible = false;
    await enqueueRendererCompile(renderer, camera, root);
    root.visible = true;
  }
  return 1;
}

export async function upgradeMachineShellTripo(shell, procedural, renderer, camera) {
  const cfg = CONFIG.machineShell;
  if (!cfg?.useTripo) return 0;

  if (cfg.placedShell) {
    try {
      const n = await loadPlacedShell(shell, procedural, renderer, camera, cfg.placedShell);
      console.log('[machineShell] 已装入 Blender 摆好的外壳');
      return n;
    } catch (e) {
      console.warn('[machineShell] 摆好的外壳加载失败，回退分件槽位:', e.message);
    }
  }

  const ids = (cfg.partIds ?? Object.keys(MACHINE_SHELL_SLOTS)).filter((id) => GLB_MANIFEST_MACHINE[id]);
  if (!ids.length) return 0;

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { withCompressedDecoders } = await import('./glbDecoders.js');
  const loader = withCompressedDecoders(new GLTFLoader());
  const tripo = new THREE.Group();
  tripo.name = 'machineShellTripo';

  let loaded = 0;
  for (const id of ids) {
    const slot = MACHINE_SHELL_SLOTS[id];
    if (!slot) continue;
    const url = GLB_MANIFEST_MACHINE[id].replace(/^\.\//, '');
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      if (matchMedia('(pointer: coarse)').matches && CONFIG.mobile?.maxTextureSize) {
        capTextures(root, CONFIG.mobile.maxTextureSize);
      }
      enableShadows(root);
      fitMeshToSlot(root, slot);
      root.name = id;
      tripo.add(root);
      loaded += 1;
    } catch (e) {
      console.warn(`[machineShell] 跳过 ${id}:`, e.message);
    }
  }

  if (!loaded) return 0;

  shell.add(tripo);
  if (procedural) procedural.visible = false;

  if (renderer && camera) {
    tripo.visible = false;
    await enqueueRendererCompile(renderer, camera, tripo);
    tripo.visible = true;
  }
  console.log('[machineShell] Tripo 分件已拼装', loaded, '/', ids.length);
  return loaded;
}
