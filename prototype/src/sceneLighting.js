// 主场景灯光（定版：全局柔照，无机内点光直射）+ IBL
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createSceneLights(scene, { shadows = true, shadowMapSize = 2048, coarse = false } = {}) {
  const L = CONFIG.lights;

  const ambient = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
  scene.add(ambient);

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

  const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
  fill.position.set(...L.fill.position);
  fill.castShadow = false;
  scene.add(fill);

  const glow = new THREE.PointLight(L.glow.color, L.glow.intensity, L.glow.distance, L.glow.decay);
  glow.position.set(...L.glow.position);
  glow.visible = L.glow.intensity > 0.02;
  scene.add(glow);

  return { ambient, hemi, key, fill, glow };
}

export function applyMemoryLighting({ key, fill, glow, hemi, ambient }) {
  const L = CONFIG.lights;
  ambient.intensity = L.ambient.intensity;
  hemi.intensity = L.hemi.intensity;
  key.color.set(L.key.color);
  key.intensity = L.key.intensity;
  fill.color.set(L.fill.color);
  fill.intensity = L.fill.intensity;
  fill.position.set(...L.fill.position);
  glow.intensity = L.glow.intensity;
  glow.visible = L.glow.intensity > 0.02;
  if (glow.visible) glow.position.set(...L.glow.position);
}

export function applyRevealColdLighting({ key, fill, glow, hemi, ambient }, scene) {
  const c = CONFIG.lights.revealCold;
  key.color.set(c.keyColor);
  key.intensity = c.keyIntensity;
  fill.intensity = (c.fillIntensity ?? 0) * (c.fillMul ?? 0.4);
  hemi.intensity = c.hemiIntensity;
  ambient.intensity = c.ambientIntensity ?? 0.08;
  glow.visible = false;
  if (scene) scene.environmentIntensity = CONFIG.render.envIntensity * (c.envMul ?? 0.35);
}
