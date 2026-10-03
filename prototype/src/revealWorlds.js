// 终幕世界目录。换模型时改 CONFIG.reveal.world，点云、全景、碰撞和出生点一起换。
// 出生点相对碰撞包围盒：offsetX 米，offsetZFrac 是进深比例（0 = 水平正中）。

const SPAWN = { yaw: 0, pitch: 0, eyeHeight: 1.55, offsetX: 0, offsetZFrac: 0 };

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
  },
};

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
  if (profile.fov != null) reveal.fov = profile.fov;
  return profile;
}
