// ============================================================
// 后处理链：鱼眼(barrel) + 胶片颗粒 + 暗角，单 ShaderPass 完成
// 终幕扩展位：之后 glitch shader 加在本 pass 之后即可。
// 展开 16:9 时 fisheyeFade → 0，鱼眼同步消退（"梦醒了"）。
// ============================================================
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uK1:      { value: 0.10 },   // 鱼眼一阶
    uK2:      { value: 0.04 },   // 鱼眼二阶
    uGrain:   { value: 0.055 },  // 颗粒
    uVig:     { value: 0.55 },   // 暗角
    uTime:    { value: 0 },
    uAspect:  { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uK1, uK2, uGrain, uVig, uTime, uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      // 在方形归一空间里做径向畸变，避免宽屏下鱼眼被拉伸
      vec2 uv = vUv - 0.5;
      uv.x *= uAspect;
      float r2 = dot(uv, uv);
      vec2 d = uv * (1.0 + uK1 * r2 + uK2 * r2 * r2);
      d.x /= uAspect;
      vec2 suv = d + 0.5;

      vec3 col = (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0)
        ? vec3(0.0)
        : texture2D(tDiffuse, suv).rgb;

      // 动态胶片颗粒
      col += (hash(suv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13) - 0.5) * uGrain;

      // 暗角
      float v = smoothstep(0.95, 0.30, length(uv));
      col *= mix(1.0, v, uVig);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(GradeShader);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
    this.fisheyeFade = 1;
    this.fisheyeFadeTarget = 1;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.pass.uniforms.uAspect.value = w / h;
  }

  setFisheyeFade(v) { this.fisheyeFadeTarget = v; }

  render(dt, t) {
    const p = CONFIG.post;
    this.fisheyeFade += (this.fisheyeFadeTarget - this.fisheyeFade) * (1 - Math.exp(-dt / 0.6));
    const u = this.pass.uniforms;
    u.uK1.value = p.k1 * this.fisheyeFade;
    u.uK2.value = p.k2 * this.fisheyeFade;
    u.uGrain.value = p.grain;
    u.uVig.value = p.vignette;
    u.uTime.value = t;
    this.composer.render();
  }
}
