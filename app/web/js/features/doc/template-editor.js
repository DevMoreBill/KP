import { KpSave } from './kp-save.js';
import { TemplateDraft } from './template-draft.js';
import { TemplateFields } from './template-fields.js';
import { Templates } from './templates.js';
import { Translit } from './translit.js';
import { ObjPath } from '../../core/str.js';
import { FormView } from '../../ui/form-view.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { $, esc } from '../../core/util.js';
import { S } from '../../core/state.js';

/**
 * Редактор шаблона КП («Настроить»): форма строится по editor.json из папки шаблона, настройки сохраняются в template.json.
 * Всё оформление документа (цвета, шрифт, стили, надписи, разделы, правила) правится здесь без программирования.
 */
export class TemplateEditor {
  static state = { id: '', pack: null, form: null, work: null, dirty: false, tab: '', err: '', note: '' };
  static KIND_NAMES = {
    template: 'Настройки (template.json)',
    base: 'Основа Word (base.docx)',
    skeleton: 'Скелет (skeleton.js)',
    editor: 'Форма редактора (editor.json)',
  };
  static FILES_TAB = { id: 'files', title: 'Файлы шаблона', fields: [{ type: 'files' }] };
  static JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
  static ACTIONS = {
    close: '_close',
    save: '_save',
    preview: '_preview',
    copy: '_copy',
    reset: '_reset',
    delete: '_delete',
  };
  static PRESENT = ['secOn', 'teOpen'];
  static BUTTONS = [
    ['te', '_buttonAction'],
    ['tab', '_buttonTab'],
    ['sw', '_buttonSwitch'],
    ['st', '_buttonStyle'],
    ['secOn', '_buttonSectionOn'],
    ['secMv', '_buttonSectionMove'],
    ['rowAdd', '_buttonRowAdd'],
    ['rowDel', '_buttonRowDelete'],
    ['imgDel', '_buttonImageDelete'],
    ['teOpen', '_buttonOpen'],
    ['teRestore', '_buttonRestore'],
  ];

  /**
   * Открыть редактор шаблона.
   * @param {string} [id] шаблон; нет — выбранный в КП
   * @param {{keepNote?: boolean}} [options] keepNote — оставить сообщение в строке состояния
   */
  static async open(id, options = {}) {
    const state = this.state;
    const templateId = id || S.template;
    const dialog = $('#dlg');
    dialog.className = 'tpled';
    dialog.innerHTML = '<div class="dlg-b"><p class="muted">Загружаю шаблон…</p></div>';
    if (!dialog.open) dialog.showModal();
    Object.assign(state, {
      id: templateId,
      pack: null,
      form: null,
      work: null,
      dirty: false,
      err: '',
      note: options.keepNote ? state.note : '',
    });
    try {
      Object.assign(state, await TemplateDraft.load(templateId));
    } catch (error) {
      state.err = error.message || String(error);
      state.form = { tabs: [this.FILES_TAB] };
    }
    if (!state.form.tabs || !state.form.tabs.length) state.form.tabs = [this.FILES_TAB];
    if (!state.form.tabs.some(tab => tab.id === state.tab)) state.tab = state.err ? 'files' : state.form.tabs[0].id;
    this.render();
  }

  static _reopen(id) {
    return this.open(id, { keepNote: true });
  }

  /** Окно редактора по состоянию. */
  static render() {
    const { form, id, err } = this.state;
    const tab = form.tabs.find(row => row.id === this.state.tab) || form.tabs[0];
    $('#dlg').innerHTML = `<div class="dlg-h"><h3>Шаблон КП</h3>
      <select class="te-pick" aria-label="Шаблон">${Templates.list.map(row => `<option value="${esc(row.id)}"${row.id === id ? ' selected' : ''}>${esc(row.name)}</option>`).join('')}</select>
      <button class="btn" type="button" data-te="preview" ${err ? 'disabled' : ''} title="Собрать .docx по текущему КП с этими настройками — без номера и записи в журнал">Пробный DOCX</button>
      <button class="btn primary" type="button" data-te="save" ${err ? 'disabled' : ''}>Сохранить</button>
      <button class="icon" type="button" data-te="close" aria-label="Закрыть">✕</button></div>
    ${err ? `<p class="msg err te-err">Шаблон не загружается: ${esc(err)}. Верните рабочую версию из истории или заводской вариант.</p>` : ''}
    <div class="te-wrap"><nav class="te-nav">${form.tabs.map(row => `<button type="button" data-tab="${esc(row.id)}" class="${row.id === tab.id ? 'on' : ''}">${esc(row.title)}</button>`).join('')}</nav>
      <div class="te-body" id="teBody">${tab.intro ? `<p class="muted te-intro">${esc(tab.intro)}</p>` : ''}${(tab.fields || []).map(field => TemplateFields.html(field)).join('')}</div></div>
    <div class="te-foot">${this._stateLine()}
      <span class="muted">Папка шаблона: templates/${esc(id)}</span></div>`;
    if (tab.fields && tab.fields.some(field => field.type === 'files')) this._history();
  }

  static _stateLine() {
    const { dirty, note } = this.state;
    let cls = 'muted';
    if (dirty) cls = 'warn';
    else if (note) cls = 'okn';
    return `<span id="teState" class="${cls}">${esc(dirty ? 'Есть несохранённые изменения' : note || 'Изменений нет')}</span>`;
  }

  /**
   * Сообщение в строке состояния окна (всплывающие уведомления окно перекрывает).
   * @param {string} text
   */
  static note(text) {
    this.state.note = text;
    const line = $('#teState');
    if (!line) {
      Toast.show(text);
      return;
    }
    line.textContent = text;
    line.className = this.state.dirty ? 'warn' : 'okn';
  }

  static _dirty() {
    this.state.dirty = true;
    this.state.note = '';
    const line = $('#teState');
    if (line) {
      line.textContent = 'Есть несохранённые изменения';
      line.className = 'warn';
    }
  }

  static async _history() {
    const box = $('#teHist');
    if (!box) return;
    try {
      const list = await Api.request(`/api/templates/${encodeURIComponent(this.state.id)}/history`);
      box.innerHTML = list.length
        ? list
            .map(
              row =>
                `<div class="te-hrow"><span>${esc(row.time)}</span><span>${esc(this.KIND_NAMES[row.kind] || row.kind)}</span><button class="btn ghost" type="button" data-te-restore="${esc(row.name)}">Вернуть</button></div>`,
            )
            .join('')
        : 'Пока пусто — версии появятся после первого сохранения.';
    } catch (error) {
      box.textContent = `История недоступна: ${error.message}`;
    }
  }

  static _refresh() {
    const top = ($('#teBody') || {}).scrollTop || 0;
    this.render();
    const body = $('#teBody');
    if (body) body.scrollTop = top;
  }

  static _url(path) {
    return `/api/templates/${encodeURIComponent(this.state.id)}/${path}`;
  }

  static async _reload() {
    await Templates.load();
    FormView.render();
  }

  static async _save() {
    const state = this.state;
    const body = JSON.stringify(JSON.parse(JSON.stringify(state.work)), null, 2);
    await Api.request(this._url('file?name=template.json'), { method: 'PUT', headers: this.JSON_HEADERS, body });
    state.dirty = false;
    Templates.dropCache(state.id);
    await this._reload();
    state.pack = await Templates.pack(state.id);
    state.note = 'Шаблон сохранён. Прежняя версия — в истории (вкладка «Файлы шаблона»).';
    this.render();
  }

  static async _putFile(name, file) {
    await Api.request(this._url(`file?name=${encodeURIComponent(name)}`), { method: 'PUT', body: file }); // с токеном сессии администратора
  }

  static _close() {
    if (this.state.dirty && !confirm('Закрыть без сохранения? Изменения шаблона пропадут.')) return;
    const dialog = $('#dlg');
    dialog.close();
    dialog.className = '';
  }

  static async _preview() {
    this.note('Собираю пробный файл…');
    await KpSave.trial(this.state.id, this.state.work);
    this.note(
      'Пробный файл скачан — откройте его из загрузок браузера. Шаблон не изменён, пока не нажмёте «Сохранить».',
    );
  }

  static async _copy() {
    const state = this.state;
    if (
      state.dirty &&
      !confirm('Сначала сохраните изменения — копия делается из сохранённого шаблона. Продолжить без них?')
    )
      return undefined;
    const name = prompt(
      'Название нового шаблона (например, для другой компании группы):',
      `${(state.work && state.work.name) || 'Шаблон'} — копия`,
    );
    if (!name) return undefined;
    const id = Translit.templateId(name);
    await Api.request(this._url(`copy?to=${encodeURIComponent(id)}&title=${encodeURIComponent(name)}`), {
      method: 'POST',
    });
    await this._reload();
    state.note = `Создан шаблон «${name}» (папка templates/${id})`;
    return this._reopen(id);
  }

  static async _reset() {
    if (!confirm('Вернуть заводской вариант шаблона? Текущие файлы останутся в истории версий.')) return undefined;
    await Api.request(this._url('reset'), { method: 'POST' });
    await this._reload();
    this.state.note = 'Заводской шаблон восстановлен, прежние файлы — в истории';
    return this._reopen(this.state.id);
  }

  static async _delete() {
    const state = this.state;
    if (
      !confirm(
        `Удалить шаблон «${(state.work && state.work.name) || state.id}»? Папка будет перемещена в templates/_deleted.`,
      )
    )
      return undefined;
    await Api.request(this._url('delete'), { method: 'POST' });
    Templates.dropCache(state.id);
    await this._reload();
    state.note = 'Шаблон удалён (папка перенесена в templates/_deleted)';
    return this._reopen(S.template);
  }

  /**
   * Действие кнопки окна (data-te).
   * @param {string} action
   * @returns {Promise<void>|void}
   */
  static action(action) {
    const method = this.ACTIONS[action];
    return method ? this[method]() : undefined;
  }

  /** Обработчики окна редактора (ввод, выбор, щелчки, Esc). */
  static listen() {
    document.addEventListener('input', event => this._input(event.target));
    document.addEventListener('change', event => this._change(event.target));
    document.addEventListener('click', event => this._click(event));
    // Esc закрывает окно — с тем же вопросом о несохранённых изменениях
    document.addEventListener('DOMContentLoaded', () => {
      const dialog = $('#dlg');
      if (!dialog) return;
      dialog.addEventListener('cancel', event => {
        if (!dialog.classList.contains('tpled')) return;
        event.preventDefault();
        this.action('close');
      });
    });
  }

  static _input(field) {
    if (!field.closest || !field.closest('#dlg.tpled') || !this.state.work) return;
    const work = this.state.work;
    const data = field.dataset;
    if (data.k) {
      this._inputValue(field);
      return;
    }
    if (data.hex) {
      const hex = field.value.replace(/^#/, '').toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(hex)) return;
      ObjPath.set(work, data.hex, hex);
      const color = field.parentNode.querySelector('[data-color]');
      if (color) color.value = `#${hex}`;
      this._dirty();
      return;
    }
    if (data.color) {
      const hex = field.value.replace('#', '').toUpperCase();
      ObjPath.set(work, data.color, hex);
      const text = field.parentNode.querySelector('[data-hex]');
      if (text) text.value = hex;
      this._dirty();
      return;
    }
    if (data.pair && field.tagName !== 'SELECT') {
      ObjPath.get(work, data.pair)[+data.i][+data.j] = field.value;
      this._dirty();
    }
  }

  static _inputValue(field) {
    const key = field.dataset.k;
    let value = field.value;
    if (field.dataset.num) {
      value = value === '' ? '' : +value;
      if (value !== '' && !isFinite(value)) return;
    }
    ObjPath.set(this.state.work, key, value);
    this._dirty();
    if (/^styles\./.test(key) || key === 'font') this._samples();
  }

  static async _change(field) {
    if (!field.closest || !field.closest('#dlg.tpled')) return;
    try {
      await this._changeField(field);
    } catch (error) {
      alert(`Не получилось: ${error.message || error}`);
    }
  }

  static async _changeField(field) {
    const state = this.state;
    const data = field.dataset;
    if (field.classList.contains('te-pick')) {
      if (state.dirty && !confirm('Перейти к другому шаблону без сохранения изменений?')) {
        field.value = state.id;
        return;
      }
      await this.open(field.value);
      return;
    }
    if (data.pair && field.tagName === 'SELECT') {
      ObjPath.get(state.work, data.pair)[+data.i][+data.j] = field.value;
      this._dirty();
      this._refresh();
      return;
    }
    if (data.k && field.tagName === 'SELECT') {
      this._samples();
      return;
    }
    if (data.secNp != null) {
      state.work.sections[+data.secNp].newPage = field.checked;
      this._dirty();
      return;
    }
    await this._changeFile(field);
  }

  static async _changeFile(field) {
    const state = this.state;
    const data = field.dataset;
    const file = field.files && field.files[0];
    if (data.img && file) {
      const base = data.img.replace(/Image$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
      const name = `${base}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
      await this._putFile(name, file);
      Templates.dropCache(state.id);
      state.pack = await Templates.pack(state.id);
      ObjPath.set(state.work, data.img, name);
      this._dirty();
      this._refresh();
      this.note('Картинка загружена — нажмите «Сохранить»');
      return;
    }
    if (data.tePut && file) {
      const name = data.tePut;
      if (
        name === 'template.json' &&
        !confirm('Заменить настройки шаблона содержимым файла? Несохранённые изменения в окне пропадут.')
      )
        return;
      await this._putFile(name, file);
      await this._reload();
      state.note = `Файл ${name} заменён, прежний — в истории`;
      await this._reopen(state.id);
    }
  }

  static async _click(event) {
    const dialog = $('#dlg');
    if (!dialog || !dialog.classList.contains('tpled') || !dialog.contains(event.target)) return;
    const button = event.target.closest('button');
    if (!button) return;
    const handler = this.BUTTONS.find(([key]) => this._has(button, key));
    if (!handler) return;
    try {
      await this[handler[1]](button);
    } catch (error) {
      alert(`Не получилось: ${error.message || error}`);
    }
  }

  // «Открыть папку шаблона» — data-te-open без значения, раздел — номер (бывает «0»)
  static _has(button, key) {
    const value = button.dataset[key];
    return this.PRESENT.includes(key) ? value != null : !!value;
  }

  static _buttonAction(button) {
    return this.action(button.dataset.te);
  }

  static _buttonTab(button) {
    this.state.tab = button.dataset.tab;
    this.render();
  }

  static _buttonSwitch(button) {
    const work = this.state.work;
    const path = button.dataset.sw;
    ObjPath.set(work, path, !ObjPath.get(work, path));
    this._dirty();
    button.setAttribute('aria-checked', String(!!ObjPath.get(work, path)));
  }

  static _buttonStyle(button) {
    const work = this.state.work;
    const path = button.dataset.st;
    const prop = button.dataset.prop;
    const style = ObjPath.get(work, path) || {};
    style[prop] = !style[prop];
    ObjPath.set(work, path, style);
    this._dirty();
    button.classList.toggle('on', !!style[prop]);
    button.setAttribute('aria-pressed', String(!!style[prop]));
    this._samples();
  }

  static _buttonSectionOn(button) {
    const section = this.state.work.sections[+button.dataset.secOn];
    section.on = !section.on;
    this._dirty();
    this._refresh();
  }

  static _buttonSectionMove(button) {
    const i = +button.dataset.i;
    const j = i + +button.dataset.secMv;
    const list = this.state.work.sections;
    [list[i], list[j]] = [list[j], list[i]];
    this._dirty();
    this._refresh();
  }

  static _buttonRowAdd(button) {
    const work = this.state.work;
    const list = ObjPath.get(work, button.dataset.rowAdd) || [];
    list.push(button.dataset.kind === 'brand' ? ['', 'BLUE'] : ['', '']);
    ObjPath.set(work, button.dataset.rowAdd, list);
    this._dirty();
    this._refresh();
  }

  static _buttonRowDelete(button) {
    ObjPath.get(this.state.work, button.dataset.rowDel).splice(+button.dataset.i, 1);
    this._dirty();
    this._refresh();
  }

  static _buttonImageDelete(button) {
    ObjPath.set(this.state.work, button.dataset.imgDel, '');
    this._dirty();
    this._refresh();
  }

  static async _buttonOpen(button) {
    const name = button.dataset.teOpen;
    const result = await Api.request(this._url(`open?name=${encodeURIComponent(name)}`), { method: 'POST' });
    if (result && result.remote) {
      this.note('Файлы шаблона открываются на компьютере-сервере отдела — используйте «Скачать» и «Заменить…»');
    } else if (name === 'base.docx') {
      this.note('Открыто в Word. Сохраните и закройте документ — изменения будут в следующем КП и в «Пробном DOCX».');
    } else if (name) this.note('Открыто в Блокноте. После сохранения файла откройте редактор шаблона заново.');
  }

  static async _buttonRestore(button) {
    const state = this.state;
    if (state.dirty && !confirm('Несохранённые изменения в окне пропадут. Продолжить?')) return;
    const result = await Api.request(this._url(`restore?name=${encodeURIComponent(button.dataset.teRestore)}`), {
      method: 'POST',
    });
    await this._reload();
    state.note = `Версия возвращена: ${result.file}`;
    await this._reopen(state.id);
  }

  static _samples() {
    const { form, work, tab } = this.state;
    document.querySelectorAll('#dlg.tpled .te-style').forEach(row => {
      const input = row.querySelector('[data-k$=".size"]');
      if (!input) return;
      const key = input.dataset.k.replace(/\.size$/, '');
      const field = ((form.tabs.find(row2 => row2.id === tab) || {}).fields || []).find(item => item.key === key) || {};
      const sample = row.querySelector('.te-sample');
      if (sample) sample.setAttribute('style', TemplateFields.sample(ObjPath.get(work, key) || {}, field));
    });
  }
}
