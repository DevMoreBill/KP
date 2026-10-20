import { CatalogWindow } from './catalog-window.js';
import { TypeForm } from './type-form.js';

/**
 * Категории оборудования (справочник типов): слева — список по разделам каталога, справа — форма категории. Свои
 * категории и правки встроенных хранятся на сервере (/api/types).
 */
export class TypesEditor {
  static state = { cur: null, id: '', dirty: false, q: '' };
  static OTHER = 'Прочее';
  static TYPE_ID = /^[a-z][a-z0-9_]{1,30}$/;
  static ID_LEN = 28;
  static JSON_TYPE = 'application/json; charset=utf-8';
  static ACTIONS = {
    close: dialog => TypesEditor._close(dialog),
    addf: dialog => TypesEditor._addField(dialog),
    addo: dialog => TypesEditor._addOption(dialog),
    undo: () => TypesEditor._undo(),
    new: dialog => TypesEditor._new(dialog),
    copy: dialog => TypesEditor._copy(dialog),
    json: dialog => TypesEditor._json(dialog),
    save: () => TypeSave.save(),
    del: () => TypeSave.remove(),
    factory: () => TypeSave.factory(),
    resetall: () => TypeSave.resetAll(),
  };

  /**
   * Открыть справочник категорий.
   * @param {string} [id] категория
   */
  static open(id) {
    const dialog = $('#dlg');
    dialog.classList.add('wide', 'typesed');
    if (!dialog._tyBound) {
      dialog._tyBound = true;
      this._bind(dialog);
    }
    this.pick(id || this.state.id || (TYPES[0] || {}).id);
    if (!dialog.open) dialog.showModal(); // окно — после содержимого: фокус сразу внутри окна
  }

  /**
   * Выбрать категорию (с вопросом, если есть несохранённые правки).
   * @param {string} id
   */
  static pick(id) {
    const state = this.state;
    if (
      state.dirty &&
      state.cur &&
      state.cur.id !== id &&
      !confirm('Изменения категории не сохранены. Перейти к другой?')
    ) {
      this.render();
      return;
    }
    const type = TYPES.find(known => known.id === id);
    state.id = id;
    state.cur = type ? TypeForm.clone(type) : null;
    state.dirty = false;
    if (state.cur) {
      state.cur.fields = state.cur.fields || [];
      state.cur.options = (state.cur.options || []).map(option => TypeForm.opt(option));
      state.cur.gallerySlots = state.cur.gallerySlots || [];
    }
    this.render();
  }

  static _item(type, own) {
    const state = this.state;
    let mark = '';
    if (own.has(type.id)) mark = TypeForm.builtin(type.id) ? ' · изменена' : ' · своя';
    return `<button type="button" class="ty-it${type.id === state.id ? ' on' : ''}" data-typick="${esc(type.id)}"><span>${esc(type.name)}</span>
      <small>${type.fields.length} парам.${mark}${type.role === 'accessory' ? ' · комплектующие' : ''}</small></button>`;
  }

  static _list(own) {
    const query = this.state.q.trim().toLowerCase();
    const groups = [...new Set(TYPES.map(type => type.group || this.OTHER))];
    return groups
      .map(group => {
        const types = TYPES.filter(
          type =>
            (type.group || this.OTHER) === group && (!query || `${type.name} ${group}`.toLowerCase().includes(query)),
        );
        if (!types.length) return '';
        return `<div class="ty-g"><b>${esc(group)}</b>${types.map(type => this._item(type, own)).join('')}</div>`;
      })
      .join('');
  }

  static _foot(own) {
    const { cur, dirty } = this.state;
    if (!cur) return '';
    const del =
      ADMIN.on && cur.id && TYPES.some(type => type.id === cur.id) && !TypeForm.builtin(cur.id)
        ? '<button class="btn ghost danger" type="button" data-tyx="del">Удалить категорию</button>'
        : '';
    const factory =
      ADMIN.on && TypeForm.builtin(cur.id) && own.has(cur.id)
        ? '<button class="btn ghost" type="button" data-tyx="factory">Вернуть стандартную</button>'
        : '';
    return `<div class="ty-foot"><span class="${dirty ? 'warn' : 'muted'}" id="tyState">${dirty ? 'Есть несохранённые изменения' : 'Изменений нет'}</span><span class="sp"></span>
      ${dirty ? '<button class="btn ghost" type="button" data-tyx="undo">Отменить изменения</button>' : ''}
      ${del}
      ${factory}
      <button class="btn primary" type="button" data-tyx="save">Сохранить категорию</button></div>`;
  }

  static _html(own) {
    const { cur, q } = this.state;
    const resetAll =
      ADMIN.on && EquipTypes.user().length
        ? '<button class="btn ghost danger" type="button" data-tyx="resetall">Вернуть все стандартные</button>'
        : '';
    return `<div class="dlg-h"><h3>Категории оборудования</h3><span class="muted ty-sub">Параметры, фильтры каталога, ключевые параметры на титуле, быстрые опции</span><button class="icon" type="button" data-tyx="close" aria-label="Закрыть">✕</button></div>
    <div class="ty-wrap"><aside class="ty-list"><input type="search" class="ty-q" placeholder="Найти категорию" value="${esc(q)}" data-tyq>
      <div class="ty-ls">${this._list(own) || '<p class="muted">Не найдено</p>'}</div>
      <div class="ty-acts"><button class="btn" type="button" data-tyx="new">+ Новая категория</button>${cur ? '<button class="btn ghost" type="button" data-tyx="copy">Копия выбранной</button>' : ''}
      ${resetAll}</div></aside>
    <div class="ty-form">${cur ? TypeForm.html(cur) : '<p class="muted">Выберите категорию слева.</p>'}</div></div>
    ${this._foot(own)}`;
  }

  /** Перерисовать окно (прокрутка формы сохраняется). */
  static render() {
    const dialog = $('#dlg');
    if (!dialog.classList.contains('typesed')) return;
    const own = new Set(EquipTypes.user().map(type => type.id));
    const body = dialog.querySelector('.ty-form');
    const top = body ? body.scrollTop : 0;
    dialog.innerHTML = this._html(own);
    const form = dialog.querySelector('.ty-form');
    if (form) form.scrollTop = top;
  }

  /** Отметить несохранённые правки. */
  static mark() {
    this.state.dirty = true;
    const status = $('#tyState');
    if (!status) return;
    status.textContent = 'Есть несохранённые изменения';
    status.className = 'warn';
  }

  static _bind(dialog) {
    dialog.addEventListener('input', event => {
      if (dialog.classList.contains('typesed')) TypeInput.handle(dialog, event.target);
    });
    dialog.addEventListener('change', event => {
      if (dialog.classList.contains('typesed') && this.state.cur) TypeInput.change(event.target);
    });
    dialog.addEventListener('click', event => this._click(dialog, event));
    dialog.addEventListener('cancel', event => this._cancel(dialog, event));
  }

  static _cancel(dialog, event) {
    if (!dialog.classList.contains('typesed')) return;
    if (this.state.dirty && !confirm('Закрыть без сохранения изменений категории?')) {
      event.preventDefault();
      return;
    }
    this.state.dirty = false;
    dialog.classList.remove('wide', 'typesed');
  }

  static async _click(dialog, event) {
    if (!dialog.classList.contains('typesed')) return;
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (TypeInput.button(button)) return;
      await this.ACTIONS[button.dataset.tyx]?.(dialog);
    } catch (error) {
      toast(`Не сохранено: ${error.message || error}`);
    }
  }

  static _close(dialog) {
    if (this.state.dirty && !confirm('Закрыть без сохранения изменений категории?')) return;
    this.state.dirty = false;
    dialog.close();
    dialog.classList.remove('wide', 'typesed');
  }

  static _focusLast(dialog, selector) {
    const rows = dialog.querySelectorAll(selector);
    rows[rows.length - 1]?.querySelector('input')?.focus();
  }

  static _addField(dialog) {
    this.state.cur.fields.push({ key: '', label: '', group: 'Основные', _new: true });
    this.mark();
    this.render();
    this._focusLast(dialog, '.ty-t tbody tr');
  }

  static _addOption(dialog) {
    this.state.cur.options.push(['', '', '']);
    this.mark();
    this.render();
    this._focusLast(dialog, '.ty-opt');
  }

  static _undo() {
    this.state.dirty = false;
    this.pick(this.state.id);
  }

  static _start(dialog, base) {
    base.id = '';
    Object.assign(this.state, { cur: base, id: '', dirty: true });
    this.render();
    dialog.querySelector('[data-ty="name"]')?.focus();
  }

  static _blank() {
    const cur = this.state.cur;
    return {
      group: (cur && cur.group) || this.OTHER,
      name: '',
      item: '',
      coverTitle: '',
      role: 'equipment',
      main: '',
      match: '',
      fields: [{ key: '', label: '', group: 'Основные', _new: true }],
      options: [],
      gallerySlots: [],
    };
  }

  static _new(dialog) {
    if (this.state.dirty && !confirm('Изменения текущей категории не сохранены. Продолжить?')) return;
    this._start(dialog, this._blank());
  }

  static _copy(dialog) {
    const state = this.state;
    if (state.dirty && !confirm('Изменения текущей категории не сохранены. Продолжить?')) return;
    const base = state.cur ? TypeForm.clone(state.cur) : this._blank();
    base.name = `${base.name || ''} (копия)`;
    this._start(dialog, base);
  }

  static _json(dialog) {
    let type;
    try {
      type = JSON.parse(dialog.querySelector('[data-tyjson]').value);
    } catch (error) {
      $('#tyErr').textContent = `Ошибка в JSON: ${error.message}`;
      return;
    }
    type.options = (type.options || []).map(option => TypeForm.opt(option));
    type.fields = type.fields || [];
    type.gallerySlots = type.gallerySlots || [];
    this.state.cur = type;
    this.mark();
    this.render();
  }
}

/** Ввод в форме категории: поля, галочки параметров, кнопки строк. */
class TypeInput {
  static FIELD_VALUES = /^fields\.\d+\.values$/;
  static FIELD_LABEL = /^fields\.(\d+)\.label$/;
  static FIELD_NUM = /^fields\.(\d+)\.num$/;

  static _list(text) {
    return text
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
  }

  // слова через запятую → регулярное выражение: * — любое окончание, пробелы — любые
  static _match(text) {
    return text
      .split(',')
      .map(part =>
        part
          .trim()
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '\\S*')
          .replace(/ +/g, '\\s+'),
      )
      .filter(Boolean)
      .join('|');
  }

  static _query(dialog, field) {
    const state = TypesEditor.state;
    state.q = field.value;
    const pos = field.selectionStart;
    TypesEditor.render();
    const query = dialog.querySelector('[data-tyq]');
    query.focus();
    query.setSelectionRange(pos, pos);
  }

  static _regex(field) {
    try {
      new RegExp(field.value, 'i');
      field.classList.remove('bad');
    } catch {
      field.classList.add('bad');
      return;
    }
    setPath(TypesEditor.state.cur, 'match', field.value);
    TypesEditor.mark();
  }

  static _value(path, text) {
    if (path === 'match') return this._match(text);
    if (path === 'gallerySlots' || this.FIELD_VALUES.test(path)) return this._list(text);
    return text;
  }

  // новый параметр: код — по названию
  static _newKey(field, path, value) {
    const found = this.FIELD_LABEL.exec(path);
    if (!found) return;
    const param = TypesEditor.state.cur.fields[+found[1]];
    if (!param._new) return;
    param.key = TypeForm.key(value);
    const key = field.closest('td').querySelector('.ty-key');
    if (key) key.textContent = param.key;
  }

  /**
   * Ввод текста.
   * @param {HTMLElement} dialog
   * @param {HTMLInputElement} field
   */
  static handle(dialog, field) {
    if (field.dataset.tyq != null) {
      this._query(dialog, field);
      return;
    }
    const path = field.dataset.ty;
    if (!TypesEditor.state.cur || !path) return;
    if (path === 'matchRe') {
      this._regex(field);
      return;
    }
    const value = this._value(path, field.value);
    setPath(TypesEditor.state.cur, path, value);
    this._newKey(field, path, value);
    TypesEditor.mark();
  }

  static _flag(field) {
    const cur = TypesEditor.state.cur;
    setPath(cur, field.dataset.tyb, field.checked);
    const found = this.FIELD_NUM.exec(field.dataset.tyb);
    if (!found) return;
    const param = cur.fields[+found[1]];
    if (!(param.facet || param.range)) return;
    param.range = !!field.checked;
    param.facet = !field.checked;
  }

  static _filter(field) {
    const param = TypesEditor.state.cur.fields[+field.dataset.tyfilter];
    param.range = field.checked && !!param.num;
    param.facet = field.checked && !param.num;
  }

  /**
   * Галочки и списки.
   * @param {HTMLInputElement} field
   */
  static change(field) {
    const cur = TypesEditor.state.cur;
    if (field.dataset.tyb) this._flag(field);
    else if (field.dataset.tyfilter != null) this._filter(field);
    else if (field.dataset.tymain != null) cur.main = field.dataset.tymain;
    else if (field.tagName === 'SELECT' && field.dataset.ty) setPath(cur, field.dataset.ty, field.value);
    else return;
    TypesEditor.mark();
  }

  static _move(button) {
    const i = +button.dataset.i;
    const j = i + +button.dataset.tyfmv;
    const fields = TypesEditor.state.cur.fields;
    [fields[i], fields[j]] = [fields[j], fields[i]];
  }

  static _delField(button) {
    const fields = TypesEditor.state.cur.fields;
    const param = fields[+button.dataset.tyfdel];
    const ask = `Удалить параметр «${param.label}»? Значения у позиций каталога останутся, но не будут показываться.`;
    if (param.label && !confirm(ask)) return false;
    fields.splice(+button.dataset.tyfdel, 1);
    return true;
  }

  static _edit(button) {
    const cur = TypesEditor.state.cur;
    if (button.dataset.tyfdel != null) {
      if (!this._delField(button)) return true;
    } else if (button.dataset.tyrole) cur.role = button.dataset.tyrole;
    else if (button.dataset.tyfmv) this._move(button);
    else if (button.dataset.tyodel != null) cur.options.splice(+button.dataset.tyodel, 1);
    else return false;
    TypesEditor.mark();
    TypesEditor.render();
    return true;
  }

  /**
   * Кнопки списка и строк формы.
   * @param {HTMLButtonElement} button
   * @returns {boolean} обработано
   */
  static button(button) {
    if (button.dataset.typick) {
      TypesEditor.pick(button.dataset.typick);
      return true;
    }
    return this._edit(button);
  }
}

/** Сохранение справочника категорий. */
class TypeSave {
  static async _list(list, note) {
    await api('/api/types', {
      method: 'PUT',
      headers: { 'Content-Type': TypesEditor.JSON_TYPE },
      body: JSON.stringify({ version: 1, types: list }),
    });
    await loadTypes();
    catCache.forEach(card => delete card._a);
    renderForm();
    TypesEditor.state.dirty = false;
    if ($('#catdlg')?.open) CatalogWindow.win.redraw(); // открыт каталог — категории и фильтры обновляются сразу
    toast(note || 'Справочник категорий сохранён');
  }

  static _id(name) {
    const base =
      (Translit.slug(name) || 'type')
        .replace(/-/g, '_')
        .replace(/^[^a-z]+/, '')
        .slice(0, TypesEditor.ID_LEN) || 'type';
    let id = base;
    let count = 1;
    while (TYPES.some(type => type.id === id)) id = `${base}_${++count}`;
    return id;
  }

  static _fill(type) {
    type.group = String(type.group || '').trim() || TypesEditor.OTHER;
    type.item = type.item || type.name;
    type.coverTitle = type.coverTitle || type.name;
    if (!type.id) type.id = this._id(type.name);
  }

  /** Сохранить категорию. */
  static async save() {
    const type = TypeForm.out(TypesEditor.state.cur);
    type.name = String(type.name || '').trim();
    if (!type.name) return toast('Укажите название категории');
    if (!type.fields.length) return toast('Добавьте хотя бы один параметр');
    this._fill(type);
    if (!TypesEditor.TYPE_ID.test(type.id)) return toast('Код категории — латиница, цифры и «_»');
    if (!type.folder) type.folder = type.id.replace(/_/g, '-');
    const list = EquipTypes.user().filter(known => known.id !== type.id);
    list.push(type);
    TypesEditor.state.id = type.id;
    await this._list(list, `Категория «${type.name}» сохранена`);
    return TypesEditor.pick(type.id);
  }

  /** Удалить свою категорию. */
  static async remove() {
    const cur = TypesEditor.state.cur;
    if (!confirm(`Удалить категорию «${cur.name}»? Позиции этой категории останутся в каталоге как «Прочее».`)) return;
    await this._list(
      EquipTypes.user().filter(type => type.id !== cur.id),
      'Категория удалена',
    );
    TypesEditor.state.id = '';
    TypesEditor.pick((TYPES[0] || {}).id);
  }

  /** Вернуть стандартный вариант категории. */
  static async factory() {
    const cur = TypesEditor.state.cur;
    if (!confirm('Вернуть стандартный вариант этой категории? Ваши правки категории пропадут.')) return;
    await this._list(
      EquipTypes.user().filter(type => type.id !== cur.id),
      'Стандартная категория восстановлена',
    );
    TypesEditor.pick(cur.id);
  }

  /** Вернуть все стандартные категории. */
  static async resetAll() {
    if (!confirm('Удалить все свои категории и изменения и вернуть стандартные?')) return;
    await this._list([], 'Стандартные категории восстановлены');
    TypesEditor.pick((TYPES[0] || {}).id);
  }
}
