// 终幕世界目录。换模型时改 CONFIG.reveal.world，点云、全景、碰撞和出生点一起换。
// 出生点相对碰撞包围盒：offsetX 米，offsetZFrac 是进深比例（0 = 水平正中）。

const SPAWN = { yaw: 0, pitch: 0, eyeHeight: 1.55, offsetX: 0, offsetZFrac: 0 };

// 可行走范围：有 collider GLB 时从网格抽出地面轮廓（斜墙跟着走）。
// 下面的 yaw / inset 只在抽边失败时当矩形回退。单位米：+X 右，+Z 身后（yaw 0 朝 −Z）。
const WALK = {
  yaw: 0, insetMinX: 0.55, insetMaxX: 0.55, insetMinZ: 0.55, insetMaxZ: 0.55,
  useMesh: true, meshInset: 0.16, sealMeters: 0.6, grid: 96,
  wallY0: 1, wallY1: 2.35,
};

export const REVEAL_WORLDS = {
  'ending-room': {
    label: '终幕塌房',
    pano: 'assets/worlds/ending-room-pano.png',
    colliderGlb: 'assets/worlds/ending-room-collider.glb',
    splats: {
      '100k': 'assets/worlds/ending-room-100k.spz',
      '500k': 'assets/worlds/ending-room-500k.spz',
    },
    splat: '500k',
    // 眼高从碰撞盒底起算，盒底比主地面大约低 0.14。
    // Marble 比例 0.925：这间房层高约 2.7 米。终幕视野 78° 偏广，
    // 按真实 1.55 米摆会显得矮；2.2 看起来才像 1.5 米站姿，2.5 是舒服的站立高度。
    // 碰撞盒中心被右侧门口拉向 +X、+Z。yaw 0 朝 −Z，+Z 在身后。
    // 下面的偏移把人放回地面轮廓的正中，而不是盒子正中。
    spawn: { ...SPAWN, eyeHeight: 2.5, offsetX: -0.45, offsetZFrac: -0.068 },
    // 地面主轴相对世界 X 大约偏 65°。仅当 GLB 抽边失败时回退到这个偏转盒。
    // 墙带底 1 / 缺口闭合 0.6：这间塌房测过，门口不漏、家具不怎么切轮廓。
    walk: { ...WALK, yaw: 1.133, insetMaxX: 1.15, insetMaxZ: 1.05, insetMinX: 0.55, insetMinZ: 0.7, wallY0: 1, sealMeters: 0.6 },
  },
  'ending-ring': {
    label: '四幕环绕',
    pano: 'assets/worlds/ending-ring-pano.png',
    colliderGlb: 'assets/worlds/ending-ring-collider.glb',
    splats: {
      '100k': 'assets/worlds/ending-ring-100k.spz',
      '500k': 'assets/worlds/ending-ring-500k.spz',
    },
    splat: '500k',
    spawn: { ...SPAWN },
    walk: { ...WALK },
  },
  'reveal-draft': {
    label: '测试街角',
    pano: 'assets/worlds/reveal-draft-pano.png',
    colliderGlb: 'assets/worlds/reveal-draft-collider.glb',
    splats: {
      '100k': 'assets/worlds/reveal-draft-100k.spz',
    },
    splat: '100k',
    spawn: { ...SPAWN, offsetZFrac: 0.15 },
    walk: { ...WALK, insetMinX: 0.8, insetMaxX: 0.8, insetMinZ: 0.8, insetMaxZ: 0.8 },
  },
};

export function currentRevealProfile(reveal = {}) {
  return (reveal.worlds ?? REVEAL_WORLDS)[reveal.world] ?? null;
}

/** 相对 collider 包围盒内缩出可行走方盒。yaw 把盒转到房间墙的方向。无 GLB 网格时才用。 */
export function walkBoxFromBounds(bounds, walk, fallbackMargin = 0.55) {
  const w = walk ?? {};
  const uni = fallbackMargin;
  const yaw = w.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const cx = (bounds.min.x + bounds.max.x) * 0.5;
  const cz = (bounds.min.z + bounds.max.z) * 0.5;
  const corners = [
    [bounds.min.x, bounds.min.z],
    [bounds.max.x, bounds.min.z],
    [bounds.min.x, bounds.max.z],
    [bounds.max.x, bounds.max.z],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of corners) {
    const dx = x - cx;
    const dz = z - cz;
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (lz < minZ) minZ = lz;
    if (lz > maxZ) maxZ = lz;
  }
  minX += w.insetMinX ?? uni;
  maxX -= w.insetMaxX ?? uni;
  minZ += w.insetMinZ ?? uni;
  maxZ -= w.insetMaxZ ?? uni;
  if (minX > maxX) { const m = (minX + maxX) * 0.5; minX = maxX = m; }
  if (minZ > maxZ) { const m = (minZ + maxZ) * 0.5; minZ = maxZ = m; }
  return {
    yaw, cx, cz,
    minX, maxX, minZ, maxZ,
    minY: bounds.min.y,
    maxY: bounds.max.y,
  };
}

/** 把目录里的一份世界写进 reveal 配置。spawn 对象保持原引用，方便调参面板继续绑着它。 */
export function applyRevealWorld(reveal, id = reveal.world) {
  const profile = (reveal.worlds ?? REVEAL_WORLDS)[id];
  if (!profile) throw new Error(`未知终幕世界：${id}`);
  const tier = profile.splat ?? '100k';
  const spz = profile.splats?.[tier];
  if (!spz || !profile.pano || !profile.colliderGlb) {
    throw new Error(`终幕世界 ${id} 缺少点云、全景或碰撞`);
  }
  reveal.world = id;
  reveal.pano = profile.pano;
  reveal.colliderGlb = profile.colliderGlb;
  reveal.spz = spz;
  if (!reveal.spawn) reveal.spawn = { ...SPAWN };
  Object.assign(reveal.spawn, SPAWN, profile.spawn);
  if (!reveal.walk) reveal.walk = { ...WALK };
  Object.assign(reveal.walk, WALK, profile.walk);
  if (profile.fov != null) reveal.fov = profile.fov;
  return profile;
}
