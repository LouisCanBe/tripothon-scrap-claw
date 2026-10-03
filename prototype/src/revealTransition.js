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
    uWash: { value: 0.42 },
    uMode: { value: 0 },
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
    uniform float uWash;
    uniform float uMode;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7) + uSeed)) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float n = hash(floor(uv * uCells));
      float base = smoothstep(0.0, 1.0, uProgress);
      float inv = 1.0 - uProgress;
      float grain = smoothstep(inv - uSoft, inv + uSoft, n);
      float m = mix(base, grain, 0.08);
      m = clamp(m, 0.0, 1.0);
      vec3 a = texture2D(tFrom, uv).rgb;
      vec3 b = texture2D(tTo, uv).rgb;
      vec3 col = mix(a, b, m);
      float wash = smoothstep(0.72, 1.0, uProgress) * uWash * 0.35;
      col = mix(col, b, wash);
      if (uMode > 0.5) {
        gl_FragColor = vec4(a, 1.0 - m);
      } else {
        gl_FragColor = vec4(col, 1.0);
      }
    }`,
};

/** 溶解进度：后半更柔，避免硬揭 */
function easeDissolveProgress(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3.4;
}

function easeLiftProgress(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3.8;
}

/**
 * @param {{
 *   renderer: THREE.WebGLRenderer,
 *   post: import('./post.js').Post,
 *   revealCtl?: import('./sceneControls.js').SceneControls,
 *   applyLift?: (k: number) => void,
 *   onHandoff?: () => void | Promise<void>,
 *   onPrepareFrame?: () => void,
 *   onExitBlend?: (k: number) => void,
 *   onComplete?: () => void,
 * }} opts
 */
export function createRevealDissolveTransition(opts) {
  const {
    renderer, post, revealCtl, applyLift, onHandoff, onPrepareFrame, onComplete,
  } = opts;
  const tc = CONFIG.reveal?.transition ?? {};
  const duration = tc.duration ?? 3.2;
  const soft = tc.dissolveSoft ?? 0.16;
  const brightenDuration = tc.brightenDuration ?? 2.8;
  const dissolveLiftStart = tc.dissolveLiftStart ?? 0.34;
  const liftCapEnd = tc.liftCapEnd ?? 0.78;
  const dissolveWash = tc.dissolveWash ?? 0.42;
  const cellsX = tc.dissolveCellsX ?? 120;
  const cellsY = tc.dissolveCellsY ?? 68;
  const totalLiftT = duration + brightenDuration;

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
    toneMapped: false,
  });
  mat.uniforms.uSeed.value = Math.random() * 100;
  mat.uniforms.uSoft.value = soft;
  mat.uniforms.uCells.value.set(cellsX, cellsY);
  mat.uniforms.uWash.value = dissolveWash;

  const blitScene = new THREE.Scene();
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  // 盖在实时 Marble 上的定格层：溶解掉的地方露出已经在播的真实画面
  const overlayMat = mat.clone();
  overlayMat.transparent = true;
  overlayMat.depthTest = false;
  overlayMat.depthWrite = false;
  overlayMat.toneMapped = false;
  const overlayScene = new THREE.Scene();
  overlayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMat));

  let phase = 'capture';
  let mixElapsed = 0;
  let brightenElapsed = 0;
  let handoffDone = false;
  let finished = false;
  let captureStarted = false;

  const blit = (progress) => {
    onPrepareFrame?.();
    mat.uniforms.tFrom.value = rtFrom.texture;
    mat.uniforms.tTo.value = rtTo.texture;
    mat.uniforms.uProgress.value = progress;
    mat.uniforms.uMode.value = 0;
    mat.transparent = false;
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCam);
  };

  /** 底下已经是实时后处理的 Marble，只把定格娃娃机按溶解遮罩盖上去 */
  const compositeOverLive = (progress, dt, t) => {
    onPrepareFrame?.();
    post.render(dt, t);
    overlayMat.uniforms.tFrom.value = rtFrom.texture;
    overlayMat.uniforms.tTo.value = rtFrom.texture;
    overlayMat.uniforms.uProgress.value = progress;
    overlayMat.uniforms.uMode.value = 1;
    const prevClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(overlayScene, blitCam);
    renderer.autoClear = prevClear;
  };

  const beginCapture = (dt, t) => {
    if (captureStarted) return;
    captureStarted = true;
    onPrepareFrame?.();
    post.renderToTarget(rtFrom, dt, t);
    blit(0);
    phase = 'handoff';
    Promise.resolve(onHandoff?.()).then(() => {
      applyLift?.(dissolveLiftStart);
      revealCtl?.apply?.();
      handoffDone = true;
      mixElapsed = 0;
    });
  };

  const dispose = () => {
    rtFrom.dispose();
    rtTo.dispose();
    mat.dispose();
    overlayMat.dispose();
    blitScene.children[0].geometry.dispose();
    overlayScene.children[0].geometry.dispose();
  };

  const setSize = () => {
    ({ w, h } = rtSize());
    rtFrom.setSize(w, h);
    rtTo.setSize(w, h);
  };

  const liftForElapsed = (elapsed) => {
    const overall = Math.min(elapsed / totalLiftT, 1);
    const k = easeLiftProgress(overall);
    return dissolveLiftStart + (liftCapEnd - dissolveLiftStart) * k;
  };

  const update = (dt, t) => {
    if (finished) return;

    if (phase === 'capture') {
      beginCapture(dt, t);
      return;
    }

    if (phase === 'handoff') {
      blit(0);
      if (!handoffDone) return;
      onPrepareFrame?.();
      post.renderToTarget(rtTo, dt, t);
      applyLift?.(dissolveLiftStart);
      blit(0);
      phase = 'dissolve';
      return;
    }

    if (phase === 'dissolve') {
      mixElapsed += dt;
      const raw = Math.min(mixElapsed / duration, 1);
      const progress = easeDissolveProgress(raw);
      applyLift?.(liftForElapsed(mixElapsed));
      compositeOverLive(progress, dt, t);
      if (raw >= 1) {
        phase = 'brighten';
        brightenElapsed = 0;
      }
      return;
    }

    if (phase === 'brighten') {
      // 溶解最后一帧已是完整 Marble。这里直接走实时后处理，不再贴截图，
      // 避免「渐亮停住后再切到真实画面」的滤镜跳变。
      brightenElapsed += dt;
      const elapsed = duration + brightenElapsed;
      applyLift?.(liftForElapsed(elapsed));
      onPrepareFrame?.();
      post.render(dt, t);
      if (brightenElapsed >= brightenDuration) {
        applyLift?.(liftCapEnd);
        finished = true;
        dispose();
        onComplete?.();
      }
    }
  };

  return {
    active: true,
    get revealViewReady() { return handoffDone && !finished; },
    get exitBlending() { return false; },
    /** 创建后立刻定格上一帧，避免等下一 rAF 时黑一帧 */
    prime(dt = 0, t = 0) {
      if (phase === 'capture') beginCapture(dt, t);
    },
    update,
    dispose,
    setSize,
  };
}
