import { esc } from '../../core/util.js';
import { Toast } from '../../core/toast.js';
import { AdminSession, Api } from '../../core/net.js';
/**
 * Тексты интерфейса, изменённые администратором: названия меню и разделов, подписи полей, кнопки, подсказки. Хранятся
 * на сервере ({исходный текст: новый}) и применяются у всех: после любой перерисовки текст заменяется (MutationObserver).
 * Режим правки — «⋯» → «✎ Тексты интерфейса» (только администратор): у текстов карандаш, щелчок — окно правки.
 */
export class UiTexts {
  /** map — замены; rev — новый текст → исходный; edit — режим правки; raf — запланированная разметка карандашей */
  static state = { map: {}, rev: {}, edit: false, raf: 0 };
  static ATTRS = ['title', 'placeholder', 'aria-label'];
  static SKIP = 'script,style,textarea,select,[contenteditable="true"],.uit-dlg,.uit-pen,.uit-bar,[data-uit-skip]';
  // позиции, журнал, списки — данные, не тексты интерфейса
  static DATA_PLACES =
    '.brand b,.brand i,#side .words,#form .it-name,#form .iname,.dl-it td.c-nm,.dl-t td.c-ev,.cw-row,.jr,.st-list,.dl-cbl';
  static MARKED = 'h1,h2,h3,h4,h5,h6,label,legend,th,summary,button,a,span,p,small,b,em,div,li,dt,i';
  static ATTR_LABEL = {
    title: 'Всплывающая подсказка',
    placeholder: 'Подсказка в поле',
    'aria-label': 'Название для экранного диктора',
  };
  static TEXTAREA_ROWS = 6;
  static ROW_CHARS = 60;
  static TEXT_NODE = 3;
  static ELEMENT_NODE = 1;

  /**
   * Текст без лишних пробелов.
   * @param {string} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static _skip(el) {
    return !el || !!el.closest(this.SKIP);
  }

  /**
   * Загрузить замены и применить.
   * @returns {Promise<void>}
   */
  static load() {
    return Api.request('/api/uitexts')
      .then(map => {
        this.state.map = map && typeof map === 'object' ? map : {};
        this.index();
        this.apply(document.body);
      })
      .catch(() => {});
  }

  /** Обратный указатель: новый текст → исходный. */
  static index() {
    this.state.rev = {};
    for (const [key, value] of Object.entries(this.state.map)) this.state.rev[this.norm(value)] = key;
  }

  // замена одного текстового узла с сохранением пробелов по краям
  static _textNode(node, map) {
    const raw = node.nodeValue;
    const text = this.norm(raw);
    if (!text) return;
    const next = map[text];
    if (next == null) return;
    const want = raw.match(/^\s*/)[0] + next + raw.match(/\s*$/)[0];
    if (raw !== want) node.nodeValue = want;
  }

  /**
   * Заменить тексты в узле и его потомках.
   * @param {Node} root
   * @param {object} [map] {исходный: новый}
   */
  static apply(root, map = this.state.map) {
    if (!root || !Object.keys(map).length) return;
    if (root.nodeType === this.TEXT_NODE) {
      if (!this._skip(root.parentElement)) this._textNode(root, map);
      return;
    }
    if (root.nodeType !== this.ELEMENT_NODE || this._skip(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (this._skip(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let node;
    while ((node = walker.nextNode())) this._textNode(node, map);
    for (const el of [root, ...root.querySelectorAll('[title],[placeholder],[aria-label]')]) this._attrs(el, map);
  }

  static _attrs(el, map) {
    for (const attr of this.ATTRS) {
      if (!el.hasAttribute(attr) || this._skip(el)) continue;
      const next = map[this.norm(el.getAttribute(attr))];
      if (next != null && el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    }
  }

  // свой текст элемента — самый длинный его текстовый узел без вложенных элементов
  static _ownText(el) {
    let best = null;
    for (const node of el.childNodes) {
      if (node.nodeType !== this.TEXT_NODE) continue;
      if (this.norm(node.nodeValue).length > (best ? this.norm(best.nodeValue).length : 0)) best = node;
    }
    return best;
  }

  // данные (суммы, даты, числа) не правятся
  static _isData(text) {
    return /\d{3}|₽|\d+[.,]\d+|\d{2}\.\d{2}|^[\d\s.,%+−-]*$/.test(text) || !/[А-Яа-яЁёA-Za-z]{2}/.test(text);
  }

  static _candidate(el) {
    if (this._skip(el) || el.closest('input,option')) return false;
    if (el.closest(this.DATA_PLACES)) return false;
    const node = this._ownText(el);
    if (node && !this._isData(this.norm(node.nodeValue))) return true;
    return this.ATTRS.some(
      attr =>
        el.hasAttribute(attr) &&
        /[А-Яа-яЁё]{3}/.test(el.getAttribute(attr) || '') &&
        !this._isData(this.norm(el.getAttribute(attr))),
    );
  }

  // режим правки: карандаш у каждого «жёсткого» текста и полоса «Готово» в верхнем окне
  static _mark() {
    this.state.raf = 0;
    if (!this.state.edit) return;
    const top = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    for (const el of document.body.querySelectorAll(this.MARKED)) {
      if (el.querySelector(':scope > .uit-pen') || !this._candidate(el) || !el.getClientRects().length) continue;
      const pen = document.createElement('span');
      pen.className = 'uit-pen';
      pen.textContent = '✎';
      pen.title = 'Изменить текст';
      pen.setAttribute('aria-hidden', 'true');
      el.appendChild(pen);
    }
    if (top.querySelector(':scope > .uit-bar')) return;
    document.querySelectorAll('.uit-bar').forEach(bar => bar.remove());
    const bar = document.createElement('div');
    bar.className = 'uit-bar';
    bar.innerHTML =
      '<span>✎ Правка текстов: нажмите карандаш у надписи или подсказки</span><button type="button" class="btn" data-uitoff>Готово</button>';
    top.appendChild(bar);
  }

  static _schedule() {
    if (this.state.edit && !this.state.raf) this.state.raf = requestAnimationFrame(() => this._mark());
  }

  /** Включить или выключить режим правки. */
  static toggle() {
    this._set(!this.state.edit);
  }

  /** Включить режим правки. */
  static startEdit() {
    this._set(true);
  }

  /** Выключить режим правки. */
  static stopEdit() {
    this._set(false);
  }

  static _set(edit) {
    this.state.edit = edit;
    document.body.classList.toggle('uit-edit', edit);
    if (!edit) {
      document.querySelectorAll('.uit-pen,.uit-bar').forEach(el => el.remove());
      return;
    }
    if (!AdminSession.on) {
      this.state.edit = false;
      document.body.classList.remove('uit-edit');
      Toast.show('Править тексты может администратор: войдите в «Настройки»');
      return;
    }
    Toast.show('Правка текстов: нажмите ✎ у надписи. «Готово» — выйти');
    this._schedule();
  }

  // поля окна правки: текст элемента, его всплывающая подсказка (title), подсказка поля (placeholder)
  static _fields(el) {
    const node = this._ownText(el);
    const cur = node ? this.norm(node.nodeValue) : '';
    const fields = [];
    if (cur && !this._isData(cur)) fields.push({ kind: 'text', label: 'Текст', cur });
    for (const attr of this.ATTRS) {
      const value = this.norm(el.getAttribute(attr));
      if (!value || this._isData(value) || value === cur || fields.some(field => field.cur === value)) continue;
      fields.push({ kind: attr, label: this.ATTR_LABEL[attr], cur: value });
    }
    fields.forEach(field => {
      field.orig = this.state.rev[field.cur] || field.cur;
    });
    return fields;
  }

  static _dialogHtml(fields) {
    const rows = fields
      .map(
        (
          field,
          i,
        ) => `<label class="f"><span>${esc(field.label)}${field.orig !== field.cur ? ' <em class="muted">изменён</em>' : ''}</span>
      <textarea rows="${Math.min(this.TEXTAREA_ROWS, Math.ceil(field.cur.length / this.ROW_CHARS) + 1)}" data-uitf="${i}">${esc(field.cur)}</textarea>
      <small class="muted">Исходный: «${esc(field.orig)}»</small></label>`,
      )
      .join('');
    return `<form method="dialog"><h3>Текст интерфейса</h3>
    ${rows}
    <p class="muted">Изменение увидят все пользователи. Меняются все места, где встречается этот же текст.</p>
    <div class="row uit-acts"><button type="button" class="btn ghost" data-uitreset>Вернуть исходный</button><span class="sp"></span>
      <button type="button" class="btn" data-uitcancel>Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`;
  }

  static _open(el) {
    const fields = this._fields(el);
    if (!fields.length) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'uit-dlg';
    dialog.innerHTML = this._dialogHtml(fields);
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(dialog);
    const done = () => {
      dialog.close();
      dialog.remove();
    };
    const ctx = { dialog, fields, done };
    dialog.addEventListener('submit', event => {
      event.preventDefault();
      this._save(ctx, {
        value: (field, i) => this.norm(dialog.querySelector(`[data-uitf="${i}"]`).value),
        message: 'Текст изменён',
      });
    });
    dialog.querySelector('[data-uitreset]').onclick = () =>
      this._save(ctx, { value: field => field.orig, message: 'Возвращён исходный текст' });
    dialog.querySelector('[data-uitcancel]').onclick = done;
    dialog.addEventListener('cancel', done);
    dialog.showModal();
    dialog.querySelector('textarea')?.select();
  }

  // value(field, i) — новый текст поля: из окна или исходный («Вернуть исходный»)
  static async _save({ fields, done }, { value, message }) {
    const state = this.state;
    const old = { ...state.map };
    const back = {};
    fields.forEach((field, i) => {
      const next = value(field, i);
      if (!next) return;
      if (state.map[field.orig] != null) back[this.norm(state.map[field.orig])] = field.orig; // прежняя замена — вернуть на экране
      if (next === field.orig) delete state.map[field.orig];
      else state.map[field.orig] = next;
    });
    try {
      await Api.request('/api/uitexts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(state.map),
      });
    } catch (error) {
      state.map = old;
      Toast.show(`Не сохранено: ${error.message || error}`);
      return;
    }
    this.index();
    this.apply(document.body, back);
    this.apply(document.body);
    done();
    Toast.show(message);
    this._schedule();
  }

  static _observe(records) {
    // замен нет (обычный случай) — записи об изменениях страницы не перебираются: каждая перерисовка даёт их сотни
    if (Object.keys(this.state.map).length) records.forEach(record => this._changed(record));
    this._schedule();
  }

  static _changed(record) {
    if (record.type !== 'childList') {
      this.apply(record.target);
      return;
    }
    for (const node of record.addedNodes) if (!this._isPen(node)) this.apply(node);
  }

  static _isPen(node) {
    return (
      node.nodeType === this.ELEMENT_NODE && (node.classList.contains('uit-pen') || node.classList.contains('uit-bar'))
    );
  }

  /** Карандаш и «Готово», замена текстов после перерисовки, пункт меню только у администратора. */
  static listen() {
    // щелчок по карандашу — правка (обычное действие элемента не выполняется)
    document.addEventListener(
      'click',
      event => {
        if (event.target.closest('[data-uitoff]')) {
          event.preventDefault();
          event.stopPropagation();
          this.stopEdit();
          return;
        }
        if (!this.state.edit) return;
        const pen = event.target.closest('.uit-pen');
        if (!pen) return;
        event.preventDefault();
        event.stopPropagation();
        this._open(pen.parentElement);
      },
      true,
    );
    new MutationObserver(records => this._observe(records)).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: this.ATTRS,
    });
    document.addEventListener('kp:admin', () => {
      document.querySelectorAll('[data-a="uitexts"]').forEach(button => {
        button.hidden = !AdminSession.on;
      });
      if (this.state.edit && !AdminSession.on) this.stopEdit();
    });
  }
}
