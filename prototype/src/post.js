// ============================================================
// 后处理链：鱼眼(barrel) + 胶片颗粒 + 暗角，单 ShaderPass 完成
// 终幕扩展位：之后 glitch shader 加在本 pass 之后即可。
// 展开 16:9 时 fisheyeFade → 0，鱼眼同步消退（"梦醒了"）。
// ============================================================
import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';
import { presentPostCoeffs } from './present.js';
import { postVignetteForViewportEdge, viewportEdgeLensScale } from './frameEdge.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uK1:      { value: 0.10 },   // 鱼眼一阶
    uK2:      { value: 0.04 },   // 鱼眼二阶
    uGrain:   { value: 0.055 },  // 颗粒
    uVig:     { value: 0.55 },   // 暗角
    uTime:    { value: 0 },
    uAspect:  { value: 1 },
    uCenter:  { value: new Vector2(0.5, 0.5) },
    uWarmth:  { value: 0.06 },
    uChroma:  { value: 0.32 },
    uSat:     { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uK1, uK2, uGrain, uVig, uTime, uAspect, uWarmth, uChroma, uSat;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      // 在"画幅中心为原点"的方形归一空间里做径向畸变：
      // 画幅偏右时畸变中心跟着走，不会一侧被拉歪
      vec2 uv = vUv - uCenter;
      uv.x *= uAspect;
      float r2 = dot(uv, uv);
      vec2 d = uv * (1.0 + uK1 * r2 + uK2 * r2 * r2);
      d.x /= uAspect;
      vec2 suv = d + uCenter;

      bool inside = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
      vec3 col = vec3(0.0);
      if (inside) {
        float edge = smoothstep(0.15, 0.92, length(uv));
        float ca = uChroma * edge * 0.0028;
        col.r = texture2D(tDiffuse, suv + vec2(ca, 0.0)).r;
        col.g = texture2D(tDiffuse, suv).g;
        col.b = texture2D(tDiffuse, suv - vec2(ca, 0.0)).b;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, col * vec3(1.08, 1.02, 0.9), uWarmth * (1.0 - lum));
        col = mix(vec3(lum), col, uSat);
      }

      col += (hash(suv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13) - 0.5) * uGrain;

      float v = smoothstep(0.95, 0.30, length(uv));
      col *= mix(1.0, v, uVig);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // 泛光：只让灯带/高光晕开（threshold 守门），第四幕回暖演出更动人
    // 触屏设备默认关：全屏模糊采样对 iPad GPU 不友好
    this.bloom = new UnrealBloomPass(
      new Vector2(innerWidth, innerHeight),
      CONFIG.post.bloom,
      0.55,                       // radius：光晕扩散
      CONFIG.post.bloomThreshold  // threshold
    );
    this.composer.addPass(this.bloom);
    this.pass = new ShaderPass(GradeShader);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
    this.fisheyeFade = 1;
    this.fisheyeFadeTarget = 1;
    // 移动端泛光锁死（H 面板调不动），桌面端随 CONFIG 实时调
    this._bloomScale = matchMedia('(pointer: coarse)').matches ? 0 : 1;
    this.bloom.strength = CONFIG.post.bloom * this._bloomScale;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.pass.uniforms.uAspect.value = w / h;
  }

  setFisheyeFade(v) { this.fisheyeFadeTarget = v; }

  // 画幅中心的 UV 坐标（y 注意翻转）
  setCenter(cx, cy) { this.pass.uniforms.uCenter.value.set(cx, cy); }

  render(dt, t) {
    const p = CONFIG.post;
    this.fisheyeFade += (this.fisheyeFadeTarget - this.fisheyeFade) * (1 - Math.exp(-dt / 0.6));
    this.bloom.strength = p.bloom * this._bloomScale;   // H 面板实时可调（移动端锁 0）
    this.bloom.threshold = p.bloomThreshold;
    const u = this.pass.uniforms;
    const lens = viewportEdgeLensScale() * this.fisheyeFade;
    u.uK1.value = p.k1 * lens;
    u.uK2.value = p.k2 * lens;
    u.uGrain.value = p.grain;
    u.uVig.value = postVignetteForViewportEdge();
    u.uTime.value = t;
    const pc = presentPostCoeffs();
    u.uWarmth.value = pc.warmth * this.fisheyeFade;
    u.uChroma.value = pc.chroma * lens;
    u.uSat.value = pc.sat;
    this.composer.render();
  }
}
