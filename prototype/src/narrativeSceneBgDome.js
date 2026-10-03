// 叙事幕：一幕一张概念图，作为铺满画面的 scene.background（平面，不随镜头转）。
// 换幕时混到一张临时图上，结束后交回该幕原图。
import * as THREE from 'three';

/** 16:9 图按 cover 铺满窗口，镜头左右看时画面不跟着滑 */
function lockFlat(tex, w, h) {
  if (!tex?.isTexture) return;
  tex.mapping = THREE.UVMapping;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const iw = w || tex.image?.width || 1;
  const ih = h || tex.image?.height || 1;
  const view = innerWidth / Math.max(1, innerHeight);
  const pic = iw / Math.max(1, ih);
  if (pic > view) {
    const rx = view / pic;
    tex.repeat.set(rx, 1);
    tex.offset.set((1 - rx) * 0.5, 0);
  } else {
    const ry = pic / view;
    tex.repeat.set(1, ry);
    tex.offset.set(0, (1 - ry) * 0.5);
  }
}

const MixShader = {
  uniforms: {
    tA: { value: null },
    tB: { value: null },
    uMix: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tA;
    uniform sampler2D tB;
    uniform float uMix;
    varying vec2 vUv;
    void main() {
      vec3 a = texture2D(tA, vUv).rgb;
      vec3 b = texture2D(tB, vUv).rgb;
      gl_FragColor = vec4(mix(a, b, clamp(uMix, 0.0, 1.0)), 1.0);
    }`,
};

export function createNarrativeSceneBgDome(renderer) {
  const rt = new THREE.WebGLRenderTarget(2048, 1024);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.mapping = THREE.UVMapping;
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(MixShader.uniforms),
    vertexShader: MixShader.vertexShader,
    fragmentShader: MixShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const blitScene = new THREE.Scene();
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let fade = null;
  let active = false;
  /** @type {THREE.Texture | null} */
  let shown = null;
  /** @type {THREE.Scene | null} */
  let boundScene = null;

  const fitRt = (tex) => {
    const img = tex?.image;
    const w = Math.max(2, img?.width || 2048);
    const h = Math.max(2, img?.height || 1024);
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
  };

  const paint = () => {
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(rt);
      renderer.render(blitScene, blitCam);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.toneMapping = prevTone;
    }
    lockFlat(rt.texture, rt.width, rt.height);
    if (boundScene) boundScene.background = rt.texture;
  };

  return {
    isActive() { return active; },
    refit() {
      if (!active || !boundScene) return;
      if (fade) lockFlat(rt.texture, rt.width, rt.height);
      else if (shown) lockFlat(shown);
    },
    hide(scene, fallbackBg) {
      active = false;
      shown = null;
      fade = null;
      boundScene = scene;
      scene.background = fallbackBg ?? null;
    },
    /** @param {THREE.Texture} tex */
    setImmediate(tex, scene, intensity) {
      fade = null;
      shown = tex;
      active = true;
      boundScene = scene;
      lockFlat(tex);
      scene.background = tex;
      if (intensity != null) scene.backgroundIntensity = intensity;
    },
    /**
     * @param {THREE.Texture} toTex
     * @param {number} ms
     */
    crossfadeTo(toTex, ms, scene, intensity) {
      boundScene = scene;
      if (!shown || !toTex || shown === toTex) {
        this.setImmediate(toTex, scene, intensity);
        return Promise.resolve();
      }
      if (fade?.resolve) fade.resolve();
      mat.uniforms.tA.value = shown;
      mat.uniforms.tB.value = toTex;
      mat.uniforms.uMix.value = 0;
      fitRt(shown);
      active = true;
      if (intensity != null) scene.backgroundIntensity = intensity;
      paint();
      return new Promise((resolve) => {
        fade = { elapsed: 0, ms: Math.max(16, ms), resolve, toTex };
      });
    },
    tick(dt) {
      if (!fade) return;
      fade.elapsed += dt * 1000;
      const t = Math.min(fade.elapsed / fade.ms, 1);
      const k = t * t * (3 - 2 * t);
      mat.uniforms.uMix.value = k;
      paint();
      if (t >= 1) {
        const done = fade.resolve;
        const toTex = fade.toTex;
        fade = null;
        shown = toTex;
        lockFlat(toTex);
        if (boundScene) boundScene.background = toTex;
        done?.();
      }
    },
  };
}
