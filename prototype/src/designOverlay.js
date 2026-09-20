// ============================================================
// 设计稿叠加对照层（纯调试工具，不影响游戏逻辑）
//
// 用法：
//   G       显示/隐藏叠加层
//   [ / ]   切换设计稿（预设清单见 design/manifest.js）
//   拖拽    移动设计稿位置
//   滚轮    调透明度
//   Shift+滚轮  缩放
//   R       复位（居中适应窗口）
//   L       锁定：锁定后鼠标穿透（正常玩游戏，设计稿只盖着看）
//   也可以直接把本地 PNG/JPG 拖进窗口 → 立即成为叠加层
//
// 事件策略：显示且未锁定时 overlay 拦截全部鼠标（拖图/调参）；
// 锁定后 pointer-events: none 完全穿透，游戏操作不受影响。
//
// 清单走 fetch（带时间戳，永不缓存）：改 manifest.json 后刷新即生效，
// 不会像 ES module 那样被浏览器模块缓存咬住。
// ============================================================

export class DesignOverlay {
  constructor() {
    this.visible = false;
    this.locked = false;
    this.idx = 0;
    this.opacity = 0.5;
    this.scale = 1;
    this.x = 0; this.y = 0;          // 相对居中的偏移 px
    this.sheets = [];
    this._customURL = null;          // 拖入的本地图片

    fetch('./design/manifest.json?_=' + Date.now())
      .then(r => r.ok ? r.json() : [])
      .then(list => { this.sheets = list; if (this.visible) this._load(); this._apply(); })
      .catch(() => {});

    // DOM
    this.root = document.createElement('div');
    this.root.id = 'designOverlay';
    this.img = document.createElement('img');
    this.img.draggable = false;
    this.img.alt = '设计稿';
    this.status = document.createElement('div');
    this.status.className = 'd-status';
    this.root.append(this.img, this.status);
    document.body.appendChild(this.root);

    // 交互
    let drag = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (this.locked) return;
      drag = { x: e.clientX - this.x, y: e.clientY - this.y };
      this.root.setPointerCapture?.(e.pointerId);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!drag || this.locked) return;
      this.x = e.clientX - drag.x;
      this.y = e.clientY - drag.y;
      this._apply();
    });
    this.root.addEventListener('pointerup', () => drag = null);
    this.root.addEventListener('wheel', (e) => {
      if (this.locked) return;
      e.preventDefault();
      if (e.shiftKey) {
        this.scale = Math.min(4, Math.max(0.1, this.scale * Math.exp(-e.deltaY * 0.001)));
      } else {
        this.opacity = Math.min(1, Math.max(0.05, this.opacity - e.deltaY * 0.0008));
      }
      this._apply();
    }, { passive: false });

    // 拖本地图片进窗口
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f || !f.type.startsWith('image/')) return;
      e.preventDefault();
      if (this._customURL) URL.revokeObjectURL(this._customURL);
      this._customURL = URL.createObjectURL(f);
      if (!this.sheets.includes(this._customURL)) this.sheets.push(this._customURL);
      this.idx = this.sheets.length - 1;
      if (!this.visible) this.toggle();
      this._load();
      this.reset();
    });

    this._apply();
  }

  toggle() { this.visible = !this.visible; this._apply(); if (this.visible) this._load(); }
  toggleLock() { this.locked = !this.locked; this._apply(); return this.locked; }

  cycle(dir) {
    if (!this.sheets.length) return;
    this.idx = (this.idx + dir + this.sheets.length) % this.sheets.length;
    this._load();
  }

  reset() { this.x = 0; this.y = 0; this.scale = 1; this._apply(); }

  _load() {
    const src = this.sheets[this.idx];
    if (src) this.img.src = src;
    this._apply();
  }

  _apply() {
    this.root.style.display = this.visible ? 'block' : 'none';
    this.root.style.pointerEvents = this.locked ? 'none' : 'auto';
    this.img.style.opacity = this.opacity;
    this.img.style.transform = `translate(calc(-50% + ${this.x}px), calc(-50% + ${this.y}px)) scale(${this.scale})`;
    const name = this.sheets[this.idx]?.split('/').pop() ?? '（design/ 里还没放图）';
    this.status.textContent = this.visible
      ? `${this.idx + 1}/${this.sheets.length} ${name} · 不透明 ${(this.opacity * 100) | 0}% · ${(this.scale * 100) | 0}%${this.locked ? ' · 已锁定(L 解锁)' : ' · 拖拽移动 / 滚轮透明度 / Shift+滚轮缩放'}`
      : '';
  }
}
