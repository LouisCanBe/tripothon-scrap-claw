// 爪机组材质：避免 RoomEnvironment + 主光/点光在金属 Standard 上白闪
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function tameClawMaterials(root) {
  const c = CONFIG.claw ?? {};
  const useLambert = c.useLambertMaterials !== false;
  const env = c.envMapIntensity ?? 0;
  const rough = c.metalRoughness ?? 0.88;
  const metal = c.metalness ?? 0.12;

  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = [];
    for (const m of mats) {
      if (useLambert && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) {
        const lambert = new THREE.MeshLambertMaterial({
          color: m.color?.clone?.() ?? new THREE.Color(0x9aa0a8),
          map: m.map ?? null,
          transparent: m.transparent,
          opacity: m.opacity ?? 1,
          side: m.side,
        });
        m.dispose?.();
        next.push(lambert);
        continue;
      }
      if (m.metalness !== undefined) {
        m.metalness = Math.min(m.metalness, metal);
        m.roughness = Math.max(m.roughness ?? 0.5, rough);
      }
      m.envMap = null;
      m.envMapIntensity = env;
      m.needsUpdate = true;
      next.push(m);
    }
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}
