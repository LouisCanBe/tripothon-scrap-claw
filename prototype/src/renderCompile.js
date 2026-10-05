// 串行 compileAsync + 材质兜底：并行编译同一 WebGLRenderer 会触发 program.isReady 未定义崩溃。
import * as THREE from 'three';

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMPILE_TIMEOUT_MS = 28000;

let _compileQueue = Promise.resolve();
/** 上货阶段跳过零碎 compile，开局前统一预热 world */
let _coalesceIncrementalCompile = false;

export function setCoalesceIncrementalCompile(on) {
  _coalesceIncrementalCompile = !!on;
}

const _deferredOpening = [];
let _openingWatch = false;
let _openingPump = false;

function isDescendant(node, ancestor) {
  if (!node || !ancestor) return false;
  let p = node.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function enqueueDeferredOpening(renderer, camera, sceneRoot, resolve) {
  for (const j of _deferredOpening) {
    if (j.sceneRoot === sceneRoot) {
      const prev = j.resolve;
      j.resolve = () => {
        prev?.();
        resolve();
      };
      return;
    }
    if (isDescendant(sceneRoot, j.sceneRoot)) {
      resolve();
      return;
    }
  }
  for (let i = _deferredOpening.length - 1; i >= 0; i--) {
    const j = _deferredOpening[i];
    if (isDescendant(j.sceneRoot, sceneRoot)) {
      j.resolve?.();
      _deferredOpening.splice(i, 1);
    }
  }
  _deferredOpening.push({ renderer, camera, sceneRoot, resolve });
  scheduleOpeningPump();
}

function scheduleOpeningPump() {
  if (_openingPump || _deferredOpening.length === 0) return;
  const run = () => {
    if (_deferredOpening.length === 0) {
      _openingPump = false;
      return;
    }
    if (
      typeof document !== 'undefined'
      && document.documentElement?.classList.contains('act-opening')
    ) {
      _openingPump = true;
      pumpOneDeferred().finally(() => {
        _openingPump = false;
        const next = () => scheduleOpeningPump();
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(next, { timeout: 900 });
        } else {
          setTimeout(next, 64);
        }
      });
      return;
    }
    _openingPump = true;
    pumpOneDeferred().finally(() => {
      _openingPump = false;
      if (_deferredOpening.length) scheduleOpeningPump();
    });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 80);
  }
}

function pumpOneDeferred() {
  const j = _deferredOpening.shift();
  if (!j) return Promise.resolve();
  return enqueueRendererCompile(j.renderer, j.camera, j.sceneRoot, { force: true }).then(
    () => j.resolve?.(),
    () => j.resolve?.(),
  );
}

function flushOpeningDeferred() {
  scheduleOpeningPump();
}

function watchOpeningEnd() {
  if (_openingWatch || typeof document === 'undefined') return;
  _openingWatch = true;
  const root = document.documentElement;
  const obs = new MutationObserver(() => {
    if (!root.classList.contains('act-opening')) {
      obs.disconnect();
      _openingWatch = false;
      flushOpeningDeferred();
    }
  });
  obs.observe(root, { attributes: true, attributeFilter: ['class'] });
}

/** @param {THREE.Object3D} root */
export function sanitizeMeshMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map(
        (m) => m ?? new THREE.MeshStandardMaterial({ color: 0x808080 }),
      );
    } else if (o.material == null) {
      o.material = new THREE.MeshStandardMaterial({ color: 0x808080 });
    }
  });
}

async function runCompile(renderer, camera, sceneRoot) {
  if (!renderer || !camera || !sceneRoot) return;
  sanitizeMeshMaterials(sceneRoot);
  const label = sceneRoot.name || sceneRoot.type || 'scene';
  try {
    await Promise.race([
      renderer.compileAsync(sceneRoot, camera),
      _sleep(COMPILE_TIMEOUT_MS).then(() => {
        console.warn(`[renderCompile] compileAsync 超时 (${label})，继续显示`);
      }),
    ]);
  } catch (e) {
    console.warn('[renderCompile] compileAsync 失败，尝试同步 compile', e);
    try {
      renderer.compile(sceneRoot, camera);
    } catch {
      /* noop */
    }
  }
}

/**
 * 同一 renderer 上 compileAsync 必须排队，避免与外壳/爪子并行。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D} sceneRoot 仅包含待编译子树
 */
export function enqueueRendererCompile(renderer, camera, sceneRoot, { force = false } = {}) {
  if (!force && _coalesceIncrementalCompile) {
    return Promise.resolve();
  }
  if (
    !force
    && typeof document !== 'undefined'
    && document.documentElement?.classList.contains('act-opening')
  ) {
    watchOpeningEnd();
    return new Promise((resolve) => {
      enqueueDeferredOpening(renderer, camera, sceneRoot, resolve);
    });
  }
  const job = _compileQueue.then(() => runCompile(renderer, camera, sceneRoot));
  _compileQueue = job.catch(() => {});
  return job;
}
