// 终幕：定格 canvas（娃娃机）→ 溶解进全景 → 渐亮
import * as THREE from 'three';
import { CONFIG } from './config.js';

const DissolveShader = {
  uniforms: {
    tFrom: { value: null },
    tTo: { value: null },
    uProgress: { value: 0 },
    uSeed: { value: 0 },
    uSoft: { value: 0.14 },
    uCells: { value: new THREE.Vector2(120, 68) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tFrom;
    uniform sampler2D tTo;
    uniform float uProgress;
    uniform float uSeed;
    uniform float uSoft;
    uniform vec2 uCells;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7) + uSeed)) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float n = hash(floor(uv * uCells));
      float field = n * 0.92 + uv.y * 0.22;
      float inv = 1.0 - uProgress;
      float m = smoothstep(inv - uSoft, inv + uSoft, field);
      m *= step(0.001, uProgress);
      m = max(m, step(0.998, uProgress));
      vec3 a = texture2D(tFrom, uv).rgb;
      vec3 b = texture2D(tTo, uv).rgb;
      gl_FragColor = vec4(mix(a, b, m), 1.0);
    }`,
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * @param {{
 *   renderer: THREE.WebGLRenderer,
 *   post: import('./post.js').Post,
 *   revealCtl?: import('./sceneControls.js').SceneControls,
 *   applyLift?: (k: number) => void,
 *   onHandoff?: () => void | Promise<void>,
 *   onComplete?: () => void,
 * }} opts
 */
export function createRevealDissolveTransition(opts) {
  const { renderer, post, revealCtl, applyLift, onHandoff, onComplete } = opts;
  const tc = CONFIG.reveal?.transition ?? {};
  const duration = tc.duration ?? 3.2;
  const soft = tc.dissolveSoft ?? 0.16;
  const brightenDuration = tc.brightenDuration ?? 2.8;
  const dissolveLiftEnd = tc.dissolveLiftEnd ?? 0.38;
  const cellsX = tc.dissolveCellsX ?? 120;
  const cellsY = tc.dissolveCellsY ?? 68;

  const rtSize = () => {
    const pr = renderer.getPixelRatio();
    return {
      w: Math.max(1, Math.floor(innerWidth * pr)),
      h: Math.max(1, Math.floor(innerHeight * pr)),
    };
  };
  let { w, h } = rtSize();
  const rtFrom = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
  const rtTo = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
  rtFrom.texture.colorSpace = THREE.SRGBColorSpace;
  rtTo.texture.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(DissolveShader.uniforms),
    vertexShader: DissolveShader.vertexShader,
    fragmentShader: DissolveShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  mat.uniforms.uSeed.value = Math.random() * 100;
  mat.uniforms.uSoft.value = soft;
  mat.uniforms.uCells.value.set(cellsX, cellsY);

  const blitScene = new THREE.Scene();
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let phase = 'capture';
  let mixElapsed = 0;
  let brightenElapsed = 0;
  let handoffDone = false;
  let finished = false;

  const blit = (progress) => {
    mat.uniforms.tFrom.value = rtFrom.texture;
    mat.uniforms.tTo.value = rtTo.texture;
    mat.uniforms.uProgress.value = progress;
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCam);
  };

  const dispose = () => {
    rtFrom.dispose();
    rtTo.dispose();
    mat.dispose();
    blitScene.children[0].geometry.dispose();
  };

  const setSize = () => {
    ({ w, h } = rtSize());
    rtFrom.setSize(w, h);
    rtTo.setSize(w, h);
  };

  const update = (dt, t) => {
    if (finished) return;

    if (phase === 'capture') {
      post.renderToTarget(rtFrom, dt, t);
      blit(0);
      phase = 'handoff';
      Promise.resolve(onHandoff?.()).then(() => {
        applyLift?.(0);
        revealCtl?.captureFromCamera?.();
        revealCtl?.apply?.();
        handoffDone = true;
        mixElapsed = 0;
      });
      return;
    }

    if (phase === 'handoff') {
      blit(0);
      if (!handoffDone) return;
      phase = 'dissolve';
      return;
    }

    if (phase === 'dissolve') {
      mixElapsed += dt;
      const raw = Math.min(mixElapsed / duration, 1);
      const progress = easeInOutCubic(raw);
      const lift = dissolveLiftEnd * progress;
      applyLift?.(lift);
      post.renderToTarget(rtTo, dt, t);
      blit(progress);
      if (raw >= 1) {
        phase = 'brighten';
        brightenElapsed = 0;
      }
      return;
    }

    if (phase === 'brighten') {
      brightenElapsed += dt;
      const raw = Math.min(brightenElapsed / brightenDuration, 1);
      const lift = dissolveLiftEnd + (1 - dissolveLiftEnd) * easeOutCubic(raw);
      applyLift?.(lift);
      post.render(dt, t);
      if (raw >= 1) {
        applyLift?.(1);
        finished = true;
        dispose();
        onComplete?.();
      }
    }
  };

  return {
    active: true,
    update,
    dispose,
    setSize,
  };
}
