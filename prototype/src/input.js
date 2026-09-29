// ============================================================
// 输入：键盘状态 + 事件分发
// 移动 = 持续按键（axis 轮询）；落爪/视角/画幅 = 边沿触发（on/emit）
// ============================================================

export class Input {
  constructor() {
    this.keys = new Set();
    this._analog = { x: 0, z: 0 };
    this._analogOn = false;
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
        case 'KeyN':   this.emit('next'); break;   // 调试：跳过当前幕
        case 'KeyY':   this.emit('replay'); break; // 通关后再玩一次
        case 'KeyV':   this.emit('frameMode'); break;   // 取景 近/远 切换
        case 'KeyG':   this.emit('design'); break;      // 设计稿叠加层
        case 'KeyL':   this.emit('designLock'); break;  // 设计稿锁定/穿透
        case 'KeyR':   this.emit('designReset'); break; // 设计稿复位
        case 'BracketLeft':  this.emit('designCycle', -1); break;
        case 'BracketRight': this.emit('designCycle', 1); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  on(evt, fn) { (this._cb[evt] ??= []).push(fn); }
  emit(evt, arg) { (this._cb[evt] || []).forEach(fn => fn(arg)); }

  // 虚拟按键（屏幕按钮/触屏用）：与物理键盘共用 keys 集合，axis() 天然兼容
  press(code)   { this.keys.add(code); }
  release(code) { this.keys.delete(code); }

  /** 屏幕摇杆：-1~1，与键盘轴同语义 */
  setAnalogMove(x, z) {
    this._analog.x = x;
    this._analog.z = z;
    this._analogOn = Math.hypot(x, z) > 0.08;
  }

  clearAnalog() {
    this._analog.x = 0;
    this._analog.z = 0;
    this._analogOn = false;
  }

  // 移动轴：x 左右，z 前后（上 = 向机器深处 -z）；摇杆优先，键盘/屏幕方向键备用
  axis() {
    if (this._analogOn) return { x: this._analog.x, z: this._analog.z };
    const k = this.keys;
    let x = 0, z = 0;
    if (k.has('ArrowLeft')  || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp')    || k.has('KeyW')) z -= 1;
    if (k.has('ArrowDown')  || k.has('KeyS')) z += 1;
    return { x, z };
  }
}
