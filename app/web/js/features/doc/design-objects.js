import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignModel } from './design-model.js';
import { DesignPanels } from './design-panels.js';
import { DesignView } from './design-view.js';
import { ObjPath } from '../../core/str.js';
import { $ } from '../../core/util.js';

/** Графический редактор шаблона: свои надписи и картинки — добавить, копия, удалить, сдвиг, свободно / в тексте. */
export class DesignObjects {
  static NEW_LABEL = {
    text: 'Новая надпись',
    widthCm: 7,
    heightCm: 1.2,
    size: 14,
    color: 'BLUE',
    bold: true,
    align: 'left',
  };
  static SECTION_Y = 0.5;
  static COPY_SHIFT = 0.5;
  static FOCUS_DELAY = 50;
  static HALVES = 2;

  static _list(sel) {
    return sel.kind === 'label' ? 'labels' : 'images';
  }

  /** Новая надпись — в видимой части листа (выбран раздел — в его начале). */
  static addLabel() {
    const state = Design.state;
    const here = DesignView.here();
    const id = Design.uid();
    if (state.sel && state.sel.kind === 'sec') {
      here.place = `${state.sel.key}Top`;
      here.x = 0;
      here.y = this.SECTION_Y;
    }
    const { text, widthCm, heightCm, size, color, bold, align } = this.NEW_LABEL;
    const label = {
      id,
      text,
      place: here.place,
      float: true,
      x: Math.max(0, here.x),
      y: here.y,
      widthCm,
      heightCm,
      size,
      color,
      bold,
      align,
    };
    DesignHistory.change(
      work => {
        work.labels.push(label);
      },
      { now: true },
    );
    state.sel = { kind: 'label', key: `L_${id}` };
    state.tab = 'objs';
    DesignPanels.panels();
    setTimeout(() => {
      const area = $('#tdLblText');
      if (area) {
        area.focus();
        area.select();
      }
    }, this.FOCUS_DELAY);
  }

  /**
   * Новая картинка шаблона (файл уже загружен) — в видимой части листа.
   * @param {string} file
   * @param {string} title исходное имя файла
   */
  static addImage(file, title) {
    const state = Design.state;
    const id = Design.uid();
    const here = DesignView.here();
    const name = title.replace(/\.[^.]+$/, '').slice(0, 60);
    DesignHistory.change(
      work => {
        work.images.push({
          id,
          file,
          name,
          place: here.place,
          float: true,
          x: Math.max(0, here.x),
          y: here.y,
          widthCm: 6,
          heightCm: 0,
          align: 'center',
        });
      },
      { now: true },
    );
    state.sel = { kind: 'img', key: `X_${id}` };
    state.tab = 'objs';
    DesignPanels.panels();
  }

  /** Копия выбранного своего объекта. */
  static duplicate() {
    const state = Design.state;
    const sel = state.sel;
    const item = DesignModel.item(sel);
    if (!item) return;
    const id = Design.uid();
    DesignHistory.change(
      work => {
        const copy = JSON.parse(JSON.stringify(item));
        copy.id = id;
        if (copy.float) {
          copy.x = Design.round((+copy.x || 0) + this.COPY_SHIFT, Design.CENTS);
          copy.y = Design.round((+copy.y || 0) + this.COPY_SHIFT, Design.CENTS);
        }
        work[this._list(sel)].push(copy);
      },
      { now: true },
    );
    state.sel = { kind: sel.kind, key: (sel.kind === 'label' ? 'L_' : 'X_') + id };
    DesignPanels.panels();
  }

  /** Удалить выбранный свой объект. */
  static remove() {
    const state = Design.state;
    const sel = state.sel;
    const item = DesignModel.item(sel);
    if (!item) return;
    const list = this._list(sel);
    state.sel = null;
    DesignHistory.change(
      work => {
        work[list] = work[list].filter(row => row.id !== item.id);
      },
      { now: true },
    );
    state.note = 'Удалено. Ctrl+Z — вернуть';
    DesignPanels.top();
  }

  // свой объект в тексте при сдвиге становится свободным там, где он сейчас на экране
  static _release(sel, dx, dy) {
    const element = DesignModel.primary();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const anchor = DesignView.anchorFor(rect.left, rect.top);
    if (!anchor) return;
    DesignHistory.change(
      () => {
        const item = DesignModel.item(sel);
        Object.assign(item, {
          float: true,
          place: anchor.place,
          x: Design.round(anchor.x + dx, Design.CENTS),
          y: Design.round(anchor.y + dy, Design.CENTS),
        });
        if (sel.kind === 'label' && !item.widthCm) {
          item.widthCm = Design.round(rect.width / DesignView.pxPerCm(), Design.CENTS);
          item.heightCm = Design.round(rect.height / DesignView.pxPerCm(), Design.CENTS);
        }
      },
      { merge: 'nudge' },
    );
  }

  /**
   * Точный сдвиг стрелками: свой объект — координаты, элемент макета — отступы абзаца.
   * @param {number} dx см
   * @param {number} dy см
   */
  static nudge(dx, dy) {
    const sel = Design.state.sel;
    if (!sel) return;
    const item = DesignModel.item(sel);
    if (!item) this._shiftPara(sel, dx, dy);
    else if (item.float) this._shift(sel, dx, dy);
    else this._release(sel, dx, dy);
  }

  static _shift(sel, dx, dy) {
    DesignHistory.change(
      () => {
        const item = DesignModel.item(sel);
        item.x = Design.round((+item.x || 0) + dx, Design.CENTS);
        item.y = Design.round((+item.y || 0) + dy, Design.CENTS);
      },
      { merge: 'nudge', panels: false },
    );
  }

  static _shiftPara(sel, dx, dy) {
    const paraKey = DesignModel.paraKey(sel);
    if (!paraKey) return;
    DesignHistory.change(
      work => {
        const para = (work.para[paraKey] = work.para[paraKey] || {});
        if (dx) para.indent = Design.round((+para.indent || 0) + dx, Design.CENTS);
        if (dy) para.before = Design.round((+para.before || 0) + dy * Design.PT_PER_CM, this.HALVES);
      },
      { merge: 'nudge' },
    );
  }

  /**
   * Свободно / в тексте: координаты — там, где объект сейчас на экране.
   * @param {string} path объект в настройках
   * @param {string} value '1' — свободно, '' — в тексте
   */
  static position(path, value) {
    const float = value === '1';
    const sel = Design.state.sel;
    const element = DesignModel.primary();
    const perCm = DesignView.pxPerCm();
    const rect = element ? element.getBoundingClientRect() : null;
    const anchor = float && rect ? DesignView.anchorFor(rect.left, rect.top) : null;
    DesignHistory.change(work => {
      const item = ObjPath.get(work, path);
      if (!item) return;
      item.float = float;
      if (!float || !anchor) return;
      item.place = anchor.place;
      item.x = anchor.x;
      item.y = anchor.y;
      if (sel && sel.kind === 'label' && element) {
        item.widthCm = item.widthCm || Design.round(rect.width / perCm, Design.CENTS);
        item.heightCm = item.heightCm || Design.round(rect.height / perCm, Design.CENTS);
      }
    });
  }

  /**
   * Число из поля ввода — в настройки (пусто и не число — не меняется).
   * @param {string} path
   * @param {string} value
   */
  static setNumber(path, value) {
    const number = Design.num(value);
    if (value === '' || !isFinite(number)) return;
    DesignHistory.change(work => ObjPath.set(work, path, number), { merge: path, panels: false });
  }
}
