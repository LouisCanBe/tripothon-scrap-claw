// ============================================================
// 输入：键盘状态 + 事件分发
// 移动 = 持续按键（axis 轮询）；落爪/视角/画幅 = 边沿触发（on/emit）
// ============================================================

export class Input {
  constructor() {
    this.keys = new Set();
    this._cb = {};

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space':  e.preventDefault(); this.emit('drop'); break;
        case 'Digit1': this.emit('view', 'left'); break;
        case 'Digit2': this.emit('view', 'front'); break;
        case 'Digit3': this.emit('view', 'right'); break;
        case 'KeyQ':   this.emit('cycle', -1); break;
        case 'KeyE':   this.emit('cycle', 1); break;
        case 'KeyF':   this.emit(e.shiftKey ? 'hardCut' : 'toggleFrame'); break;
        case 'KeyH':   this.emit('gui'); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  on(evt, fn) { (this._cb[evt] ??= []).push(fn); }
  emit(evt, arg) { (this._cb[evt] || []).forEach(fn => fn(arg)); }

  // 移动轴：x 左右，z 前后（上 = 向机器深处 -z）
  axis() {
    const k = this.keys;
    let x = 0, z = 0;
    if (k.has('ArrowLeft')  || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp')    || k.has('KeyW')) z -= 1;
    if (k.has('ArrowDown')  || k.has('KeyS')) z += 1;
    return { x, z };
  }
}
