// ============================================================
// 屏幕操控：虚拟摇杆（主）+ 方向键（备）+ 抓取 + 视角
// 摇杆走 Input.setAnalogMove；方向键仍 press/release Arrow*，与键盘同路。
// 触屏自动显示；桌面 H 面板「屏幕按钮」开启。
// ============================================================
import { onLangChange, t } from './i18n.js';

const DPAD = [
  { code: 'ArrowUp',    label: '▲', cls: 'up'    },
  { code: 'ArrowLeft',  label: '◀', cls: 'left'  },
  { code: 'ArrowDown',  label: '▼', cls: 'down'  },
  { code: 'ArrowRight', label: '▶', cls: 'right' },
];

const LS_MOVE_MODE = 'tripo.moveUI';

export class OnscreenButtons {
  constructor(input) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.id = 'touchUI';
    this._moveMode = localStorage.getItem(LS_MOVE_MODE) || 'joystick';

    const movePanel = document.createElement('div');
    movePanel.className = 'move-panel';

    this.joyRoot = document.createElement('div');
    this.joyRoot.className = 'joystick';
    const joyBase = document.createElement('div');
    joyBase.className = 'joystick-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joystick-knob';
    joyBase.appendChild(this.joyKnob);
    this.joyRoot.appendChild(joyBase);
    this._bindJoystick(joyBase);

    const dpad = document.createElement('div');
    dpad.className = 'dpad dpad-backup';
    for (const { code, label, cls } of DPAD) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pad ${cls}`;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(code); });
      const off = () => input.release(code);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      dpad.appendChild(b);
    }
    this._dpad = dpad;

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'move-mode';
    modeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggleMoveMode();
    });
    this._modeBtn = modeBtn;

    movePanel.append(this.joyRoot, dpad, modeBtn);

    const acts = document.createElement('div');
    acts.className = 'acts';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'act view';
    view.textContent = t('view');
    this._viewBtn = view;
    view.addEventListener('pointerdown', (e) => { e.preventDefault(); input.emit('cycle', 1); });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'act drop';
    drop.textContent = t('grab');
    this._dropBtn = drop;
    drop.addEventListener('pointerdown', (e) => { e.preventDefault(); input.emit('drop'); });
    acts.append(view, drop);

    this.root.append(movePanel, acts);
    document.body.appendChild(this.root);
    onLangChange(() => {
      if (this._viewBtn) this._viewBtn.textContent = t('view');
      if (this._dropBtn) this._dropBtn.textContent = t('grab');
      this._applyMoveMode();
    });

    window.addEventListener('pointerup', () => DPAD.forEach(({ code }) => input.release(code)));

    this._applyMoveMode();
    this.setVisible(matchMedia('(pointer: coarse)').matches);
  }

  _bindJoystick(base) {
    const maxR = 46;
    const dead = 0.14;
    let pid = null;

    const center = () => {
      const r = base.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };

    const apply = (nx, nz) => {
      let x = nx;
      let z = nz;
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      } else if (len < dead) {
        x = 0;
        z = 0;
      }
      this.input.setAnalogMove(x, z);
    };

    const resetKnob = () => {
      pid = null;
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      this.input.clearAnalog();
    };

    const onMove = (e) => {
      if (pid !== e.pointerId) return;
      const { cx, cy } = center();
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > maxR) {
        dx *= maxR / len;
        dy *= maxR / len;
      }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      apply(dx / maxR, dy / maxR);
    };

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      base.setPointerCapture(e.pointerId);
      onMove(e);
    });
    base.addEventListener('pointermove', onMove);
    base.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pid) return;
      try { base.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      resetKnob();
    });
    base.addEventListener('pointercancel', resetKnob);
  }

  _applyMoveMode() {
    const joy = this._moveMode === 'joystick';
    this.joyRoot.hidden = !joy;
    this._dpad.hidden = joy;
    this._modeBtn.textContent = joy ? t('keys') : t('stick');
    this._modeBtn.title = joy ? t('keys') : t('stick');
    if (!joy) this.input.clearAnalog();
  }

  toggleMoveMode() {
    this._moveMode = this._moveMode === 'joystick' ? 'dpad' : 'joystick';
    localStorage.setItem(LS_MOVE_MODE, this._moveMode);
    this._applyMoveMode();
    return this._moveMode;
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
    this.visible = v;
    if (!v) this.input.clearAnalog();
  }

  toggle() { this.setVisible(!this.visible); return this.visible; }
}
