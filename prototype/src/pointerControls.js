// ============================================================
// 指针手势：鼠标/触摸统一（Pointer Events）
//   单指横向拖拽 → 切换观察位（左/前/右循环，每次手势触发一次）
//   滚轮        → 用户缩放（与幕级/取景变焦相乘，互不影响）
//   双指捏合    → 用户缩放（iPad 触屏）
// 只回调 onCycle/onZoomFactor，权限闸（director.allow）由 main 接线处把关。
// ============================================================

const DRAG_THRESHOLD = 60;   // px，超过才算一次"甩视角"
const WHEEL_SPEED = 0.0012;  // deltaY → 指数缩放系数

export class PointerControls {
  constructor(el, { onCycle, onZoomFactor }) {
    this.el = el;
    this.onCycle = onCycle;
    this.onZoomFactor = onZoomFactor;
    this.pointers = new Map();   // pointerId → {x, y}（双指捏合用）
    this._drag = null;           // 单指拖拽状态 {startX, startY, cycled}
    this._pinchDist = 0;         // 上一帧双指距离

    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onZoomFactor(Math.exp(e.deltaY * WHEEL_SPEED));
    }, { passive: false });
  }

  _down(e) {
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 合成事件/失效指针忽略 */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this._drag = { startX: e.clientX, startY: e.clientY, cycled: false };
    } else if (this.pointers.size === 2) {
      this._drag = null;   // 进入捏合，取消拖拽判定
      this._pinchDist = this._dist();
    }
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {           // 捏合缩放
      const d = this._dist();
      if (this._pinchDist > 0 && d > 0) this.onZoomFactor(this._pinchDist / d);
      this._pinchDist = d;
      return;
    }
    if (this._drag && !this._drag.cycled) {   // 单指横向甩 → 切视角（一次手势只切一格）
      const dx = e.clientX - this._drag.startX;
      const dy = e.clientY - this._drag.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.onCycle(dx > 0 ? 1 : -1);
        this._drag.cycled = true;
      }
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this._pinchDist = 0;
    if (this.pointers.size === 0) this._drag = null;
  }

  _dist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
