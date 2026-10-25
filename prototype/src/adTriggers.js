/**
 * 广告入口触发规则（独立配置模块）
 * ------------------------------------------------------------
 * 「借个力」什么时候出现、能出现几次，全在这里配，不用动 tapAds.js 的渲染逻辑。
 * 改完刷新即生效（本地 dev / 打包均直接读此文件）。
 */
export const AD_TRIGGER_CONFIG = {
  /** 点位①：第三幕「借个力」（抓取失败救济） */
  boost: {
    enabled: true,          // false = 整个点位关掉
    failStreak: 2,          // 连续抓取失败几次后出现入口
    cooldownResults: 2,     // 每次用过后，还需有几次抓取结果才允许再次出现（0 = 用完立刻可再触发）
    maxPerRun: 0,           // 单局最多出现次数，0 = 不限
  },
  /** 点位②：终幕「他今天吃了什么？」真相卡 */
  truth: {
    enabled: true,          // false = 终幕入口关掉
  },
};

/**
 * 「借个力」触发器：连胜计数 + 冷却 + 单局次数上限
 *
 * 语义：
 * - onFail/onSuccess 由抓取结果驱动；每次结果都会让冷却走一格
 * - onGranted 在广告看完发奖后调用，进入冷却并计数
 * - shouldShow = enabled 且冷却归零 且连胜达标 且未超单局上限
 */
export class BoostTrigger {
  constructor(cfg = AD_TRIGGER_CONFIG.boost) {
    this.cfg = cfg;
    this.reset();
  }
  reset() { this.streak = 0; this.cooldown = 0; this.used = 0; }

  /** 抓取失败：连胜 +1、冷却 -1；返回此刻是否该显示入口 */
  onFail() {
    if (!this.cfg.enabled) return false;
    this.streak++;
    if (this.cooldown > 0) this.cooldown--;
    return this.shouldShow();
  }

  /** 抓取成功：连胜清零、冷却 -1 */
  onSuccess() {
    this.streak = 0;
    if (this.cooldown > 0) this.cooldown--;
  }

  /** 广告看完已发奖：进入冷却 + 单局计数 + 连胜清零 */
  onGranted() {
    this.cooldown = this.cfg.cooldownResults;
    this.used++;
    this.streak = 0;
  }

  shouldShow() {
    if (!this.cfg.enabled) return false;
    if (this.cfg.maxPerRun > 0 && this.used >= this.cfg.maxPerRun) return false;
    if (this.cooldown > 0) return false;
    return this.streak >= this.cfg.failStreak;
  }
}
