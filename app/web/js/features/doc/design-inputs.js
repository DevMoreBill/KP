import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignModel } from './design-model.js';
import { DesignObjects } from './design-objects.js';
import { DesignPanels } from './design-panels.js';
import { TemplateDesigner } from './template-designer.js';
import { $ } from '../../core/util.js';
import { ObjPath } from '../../core/str.js';

/** Графический редактор шаблона: поля ввода, списки, галочки, загрузка картинок и клавиши. */
export class DesignInputs {
  static FINE = 0.1;
  static COARSE = 1;
  static KEYS = {
    z: '_keyUndo',
    я: '_keyUndo',
    y: '_keyRedo',
    н: '_keyRedo',
    s: '_keySave',
    ы: '_keySave',
    d: '_keyDuplicate',
    в: '_keyDuplicate',
  };
  static ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  // поля, уже применённые при наборе: при change окно не перерисовывается, чтобы не потерять щелчок, снявший фокус
  static INPUTS = [
    ['tdnum', '_number'],
    ['tdpage', '_page', 'present'],
    ['tdcolor', '_color'],
    ['tdcolorown', '_ownColor'],
    ['tdbrand', '_brandText', 'present'],
    ['tdpath', '_text'],
  ];
  static TYPED = ['tdnum', 'tdcolor', 'tdcolorown'];
  static TYPED_PRESENT = ['tdpage', 'tdbrand'];

  static _hex(value) {
    return value.replace('#', '').toUpperCase();
  }

  /**
   * Набор в поле окна редактора.
   * @param {InputEvent} event
   */
  static input(event) {
    const field = event.target;
    if (!field.closest || !field.closest('#tddlg') || !Design.state.work) return;
    const row = this.INPUTS.find(([key, , present]) => (present ? field.dataset[key] != null : field.dataset[key]));
    if (row) this[row[1]](field);
  }

  static _number(field) {
    DesignObjects.setNumber(field.dataset.tdnum, field.value);
  }

  static _color(field) {
    const key = field.dataset.tdcolor;
    DesignHistory.change(
      work => {
        work.colors[key] = this._hex(field.value);
      },
      { merge: `col${key}`, panels: false },
    );
  }

  static _ownColor(field) {
    const path = field.dataset.tdcolorown;
    DesignHistory.change(work => ObjPath.set(work, path, this._hex(field.value)), {
      merge: `own${path}`,
      panels: false,
    });
  }

  static _brandText(field) {
    DesignHistory.change(
      work => {
        work.brandParts[+field.dataset.tdbrand][0] = field.value;
      },
      { merge: 'brand', panels: false },
    );
  }

  static _text(field) {
    const path = field.dataset.tdpath;
    if (field.tagName !== 'TEXTAREA' && field.type !== 'text') return;
    DesignHistory.change(work => ObjPath.set(work, path, field.value), { merge: path, panels: false });
  }

  static _page(field) {
    const value = field.value;
    const side = field.dataset.tdpage;
    DesignHistory.change(
      work => {
        work.page = work.page || {};
        work.page[side] = value === '' ? '' : Design.num(value);
      },
      { merge: `page${side}`, panels: false },
    );
  }

  /**
   * Изменение поля окна редактора.
   * @param {Event} event
   */
  static async change(event) {
    const field = event.target;
    if (!field.closest || !field.closest('#tddlg') || !Design.state.work) return;
    try {
      await this._change(field);
    } catch (error) {
      Design.state.note = '';
      DesignPanels.top();
      alert(`Не получилось: ${error.message || error}`);
    }
  }

  static async _change(field) {
    const data = field.dataset;
    if (field.classList.contains('td-pick')) return this._pickTemplate(field);
    if (this.TYPED.some(key => data[key]) || this.TYPED_PRESENT.some(key => data[key] != null)) return undefined;
    if (data.tdbrandc != null) {
      return DesignHistory.change(work => {
        work.brandParts[+data.tdbrandc][1] = field.value;
      });
    }
    if (field.type === 'checkbox' && data.tdpath) return this._check(field);
    if (field.tagName === 'SELECT' && data.tdpath)
      return DesignHistory.change(work => ObjPath.set(work, data.tdpath, field.value));
    if (data.tdpath) return undefined;
    if (data.tdup && field.files[0]) return this._upload(field);
    return undefined;
  }

  static _pickTemplate(field) {
    const state = Design.state;
    if (Design.dirty() && !confirm('Перейти к другому шаблону без сохранения изменений?')) {
      field.value = state.id;
      return undefined;
    }
    state.saved = JSON.stringify(state.work);
    return TemplateDesigner.open(field.value);
  }

  // «Сохранять пропорции» — высота снова по пропорциям
  static _check(field) {
    const path = field.dataset.tdpath;
    DesignHistory.change(work => {
      ObjPath.set(work, path, field.checked);
      if (/\.lock$/.test(path) && field.checked) ObjPath.set(work, path.replace(/\.lock$/, '.heightCm'), 0);
    });
  }

  static async _upload(field) {
    const state = Design.state;
    const kind = field.dataset.tdup;
    const file = field.files[0];
    field.value = '';
    state.note = 'Загружаю картинку…';
    DesignPanels.top();
    const name = await TemplateDesigner.upload(kind === 'replace' ? 'extra' : kind, file);
    state.note = '';
    const apply = {
      clients: work => {
        work.clientsImage = name;
      },
      header: work => {
        work.header.logo = name;
        work.header.on = true;
      },
      replace: work => {
        const image = work.images.find(row => `X_${row.id}` === state.sel.key);
        if (image) image.file = name;
      },
    }[kind];
    if (apply) DesignHistory.change(apply);
    else DesignObjects.addImage(name, file.name);
  }

  /**
   * Клавиши: Ctrl+Z / Ctrl+Y — отмена и повтор, Ctrl+S — сохранить, Ctrl+D — копия, стрелки — сдвиг, Delete — удалить.
   * @param {KeyboardEvent} event
   */
  static keydown(event) {
    const dialog = $('#tddlg');
    if (!dialog || !dialog.open || !Design.state.work) return;
    const inField = event.target.closest('input,textarea,select,[contenteditable]');
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) this._shortcut(event, key, inField);
    else if (!inField && Design.state.sel) this._selectionKey(event, key);
  }

  static _shortcut(event, key, inField) {
    const method = !inField && this.KEYS[key];
    if (!method) return;
    event.preventDefault();
    this[method](event);
  }

  static _selectionKey(event, key) {
    const arrow = this.ARROWS[key];
    if (arrow) {
      event.preventDefault();
      const step = event.shiftKey ? this.COARSE : this.FINE;
      DesignObjects.nudge(arrow[0] * step, arrow[1] * step);
      return;
    }
    if ((key === 'delete' || key === 'backspace') && DesignModel.isOwn(Design.state.sel)) {
      event.preventDefault();
      DesignObjects.remove();
    }
  }

  static _keyUndo(event) {
    if (event.shiftKey) DesignHistory.redo();
    else DesignHistory.undo();
  }

  static _keyRedo() {
    DesignHistory.redo();
  }

  static _keySave() {
    if (Design.dirty()) TemplateDesigner.save().catch(error => alert(`Не сохранено: ${error.message || error}`));
  }

  static _keyDuplicate() {
    DesignObjects.duplicate();
  }
}
