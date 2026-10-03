// Tripo 控制台 / 游戏内共用的实时「漫画」材质：MeshToon + 背面描边
import * as THREE from 'three';

let _gradient = null;

export function getToonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([0, 110, 255]);
  _gradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.needsUpdate = true;
  return _gradient;
}

function cloneMatArray(mat) {
  return Array.isArray(mat) ? mat.slice() : mat;
}

function toToonMaterial(mat, gradient) {
  const src = Array.isArray(mat) ? mat[0] : mat;
  if (!src) return new THREE.MeshToonMaterial({ color: 0xcccccc, gradientMap: gradient });
  const color = src.color?.clone?.() ?? new THREE.Color(0xcccccc);
  const params = {
    color,
    gradientMap: gradient,
    transparent: src.transparent,
    opacity: src.opacity ?? 1,
    side: src.side,
    alphaTest: src.alphaTest,
  };
  if (src.map) {
    params.map = src.map;
    src.map.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshToonMaterial(params);
}

/**
 * 背面扩一圈描边。必须用「零位姿子 Mesh + 共享 geometry」；
 * mesh.clone() 再 add 到自身会复制父级 transform → 分件 GLB 上严重错位（奖池单件往往看不出来）。
 */
function addOutline(mesh, { thickness = 0.025, color = 0x141210 } = {}) {
  const geo = mesh.geometry;
  if (!geo) return null;
  const outline = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.92,
    }),
  );
  outline.name = (mesh.name || 'mesh') + '__comic_outline';
  outline.userData.comicOutline = true;
  outline.castShadow = false;
  outline.raycast = () => {};
  const s = 1 + thickness;
  outline.position.set(0, 0, 0);
  outline.rotation.set(0, 0, 0);
  outline.scale.set(s, s, s);
  mesh.add(outline);
  return outline;
}

/** @param {THREE.Object3D} root */
export function applyComicStyle(root, enabled, opts = {}) {
  const gradient = getToonGradient();
  const thickness = opts.outline ?? 0.028;
  const outlineColor = opts.outlineColor ?? 0x141210;
  const skipOutline = opts.skipOutline === true || thickness <= 0;

  root.traverse((o) => {
    if (!o.isMesh || o.userData.comicOutline) return;

    if (!enabled) {
      if (o.userData._comicOrigMat !== undefined) {
        o.material = o.userData._comicOrigMat;
        delete o.userData._comicOrigMat;
      }
      const kids = o.children.filter(c => c.userData?.comicOutline);
      for (const k of kids) {
        o.remove(k);
        k.material?.dispose?.();
      }
      return;
    }

    if (o.userData._comicOrigMat === undefined) {
      o.userData._comicOrigMat = cloneMatArray(o.material);
    }
    const orig = o.userData._comicOrigMat;
    if (Array.isArray(orig)) {
      o.material = orig.map(m => toToonMaterial(m, gradient));
    } else {
      o.material = toToonMaterial(orig, gradient);
    }
    if (!skipOutline && !o.children.some(c => c.userData?.comicOutline)) {
      addOutline(o, { thickness, color: outlineColor });
    }
  });
}

/** 文件名像娃娃/玩偶时默认开漫画（工具台测试） */
export function suggestComicForAsset(name = '') {
  const n = String(name).toLowerCase();
  return /doll|plush|bear|rabbit|bunny|toy|figurine|娃娃|玩偶|熊|兔/.test(n);
}
