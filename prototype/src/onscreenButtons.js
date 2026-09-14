// ============================================================
// 屏幕按钮：方向键（按住=移动）+ 抓取 + 视角循环
// 全部复用 Input 的既有通道——虚拟按键写进 keys 集合（axis 轮询天然兼容），
// 事件走 emit（drop/cycle 在 main 里过导演权限闸，与键盘完全同路）。
// 触屏设备（pointer: coarse）自动显示；桌面端默认隐藏，H 面板可开。
// ============================================================

const DPAD = [
  { code: 'ArrowUp',    label: '▲', cls: 'up'    },
  { code: 'ArrowLeft',  label: '◀', cls: 'left'  },
  { code: 'ArrowDown',  label: '▼', cls: 'down'  },
  { code: 'ArrowRight', label: '▶', cls: 'right' },
];

export class OnscreenButtons {
  constructor(input) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.id = 'touchUI';

    const dpad = document.createElement('div');
    dpad.className = 'dpad';
    for (const { code, label, cls } of DPAD) {
      const b = document.createElement('button');
      b.className = `pad ${cls}`;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(code); });
      const off = () => input.release(code);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      dpad.appendChild(b);
    }

    const acts = document.createElement('div');
    acts.className = 'acts';
    const view = document.createElement('button');
    view.className = 'act view';
    view.textContent = '视角';
    view.addEventListener('pointerdown', (e) => { e.preventDefault(); input.emit('cycle', 1); });
    const drop = document.createElement('button');
    drop.className = 'act drop';
    drop.textContent = '抓';
    drop.addEventListener('pointerdown', (e) => { e.preventDefault(); input.emit('drop'); });
    acts.append(view, drop);

    this.root.append(dpad, acts);
    document.body.appendChild(this.root);

    // 松手保险：任何 pointerup 落在按钮外也清空方向键
    window.addEventListener('pointerup', () => DPAD.forEach(({ code }) => input.release(code)));

    this.setVisible(matchMedia('(pointer: coarse)').matches);
  }

  setVisible(v) { this.root.style.display = v ? '' : 'none'; this.visible = v; }
  toggle() { this.setVisible(!this.visible); return this.visible; }
}
