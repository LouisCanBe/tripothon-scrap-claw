// ============================================================
// 压缩 GLB 的解码器 —— 见 PERF-性能优化.md 第六节
//
// tools/gltf-optimize.mjs 压出来的 GLB 需要对应解码器才能读。两条路：
//
//   meshopt（EXT_meshopt_compression）  —— 默认推荐
//     解码器：vendor/addons/libs/meshopt_decoder.module.js（24KB，wasm base64 内嵌，MIT）
//     体积比 Draco 更小，解码快 1~2 个数量级（基本是位拆包）。
//     对 Render 免费实例（0.1 核）和老手机是关键差异：Draco 会把省下的
//     下载时间又赔回去一部分在解码上。
//
//   draco（KHR_draco_mesh_compression） —— 备选
//     解码器：vendor/addons/libs/draco/*（取自 JupiterSR Developer Kit，Apache 2.0）
//
// 三个 addons 文件原先不在 r170 vendor 里（three180 只给了相框 SDK 用的那几个），
// 已复制过来：loaders/DRACOLoader.js、loaders/GLTFLoader.js 已有、libs/meshopt_decoder.module.js。
// DRACOLoader.js 只 import three 核心类，跨版本兼容。
//
// 没压几何的 GLB 完全不受影响 —— 这两个 setter 只是给 GLTFLoader 多挂解码器，
// 文件里没有对应扩展时永远不触发。解码器都是**懒创建**的，不 preload、不发多余请求。
// ============================================================
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let _draco = null;
let _meshopt = null;

export function getDRACOLoader() {
  if (_draco) return _draco;
  const loader = new DRACOLoader();
  loader.setDecoderPath('./vendor/addons/libs/draco/');
  _draco = loader;
  return loader;
}

export function getMeshoptDecoder() {
  // meshopt 解码器是纯模块，无需 setDecoderPath（wasm 已内嵌）
  if (_meshopt) return _meshopt;
  _meshopt = MeshoptDecoder;
  return _meshopt;
}

/**
 * 给 GLTFLoader 挂上 meshopt + draco 解码。
 *
 * 每个加载点都该用 —— clawMachine / machineShellTripo ×2 / prizePool ×2 /
 * prizePoolDecor / displayMain ×3 / revealMarble 各有一处 new GLTFLoader()。
 */
export function withCompressedDecoders(loader) {
  try {
    loader.setMeshoptDecoder(getMeshoptDecoder());
  } catch (e) {
    console.warn('[glbDecoders] meshopt 解码器挂载失败，meshopt GLB 将无法读取', e);
  }
  try {
    loader.setDRACOLoader(getDRACOLoader());
  } catch (e) {
    console.warn('[glbDecoders] draco 解码器挂载失败，draco GLB 将无法读取', e);
  }
  return loader;
}

/** @deprecated 旧名，保留给一次性脚本；新代码一律用 withCompressedDecoders */
export const withDraco = withCompressedDecoders;
