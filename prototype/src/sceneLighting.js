// 主场景三点光 + IBL（RoomEnvironment 在 main.js 挂到 scene.environment）
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createSceneLights(scene, { shadows = true, shadowMapSize = 2048, coarse = false } = {}) {
  const L = CONFIG.lights;
  const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  key.position.set(...L.key.position);
  key.castShadow = shadows;
  key.shadow.mapSize.setScalar((coarse ? 0.5 : 1) * shadowMapSize);
  key.shadow.camera.left = key.shadow.camera.bottom = L.key.shadowHalf;
  key.shadow.camera.right = key.shadow.camera.top = L.key.shadowHalf;
  key.shadow.camera.near = L.key.shadowNear;
  key.shadow.camera.far = L.key.shadowFar;
  key.shadow.bias = L.key.shadowBias;
  key.shadow.normalBias = L.key.shadowNormalBias;
  scene.add(key);

  const glow = new THREE.PointLight(L.glow.color, L.glow.intensity, L.glow.distance, L.glow.decay);
  glow.position.set(...L.glow.position);
  scene.add(glow);

  return { hemi, key, glow };
}

/** 娃娃机主玩法默认暖光（终幕 / 四幕合成从此基线插值） */
export function applyMemoryLighting({ key, glow, hemi }) {
  const L = CONFIG.lights;
  key.color.set(L.key.color);
  key.intensity = L.key.intensity;
  hemi.intensity = L.hemi.intensity;
  glow.visible = true;
  glow.intensity = L.glow.intensity;
  glow.position.set(...L.glow.position);
}

export function applyRevealColdLighting({ key, glow, hemi }, scene) {
  const c = CONFIG.lights.revealCold;
  key.color.set(c.keyColor);
  key.intensity = c.keyIntensity;
  hemi.intensity = c.hemiIntensity;
  glow.visible = false;
  if (scene) scene.environmentIntensity = CONFIG.render.envIntensity * (c.envMul ?? 0.35);
}
