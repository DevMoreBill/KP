import { FEAT } from '../../core/features.js';
import { Debounce } from '../../core/debounce.js';
import { Mobile } from '../../ui/mobile.js';
import { MyPrefs } from '../kp/my-prefs.js';

/**
 * Своё расположение разделов кабинета (ПК): две колонки, разделы перетаскиваются за ⠿ между колонками и по порядку,
 * нижний край меняет высоту, граница колонок — ширину; «—» скрывает. Хранится в личных настройках менеджера.
 */
export class CabLayout {
  static RATIO_MIN = 0.3;
  static RATIO_MAX = 0.8;
  static HEIGHT_MIN = 120;
  static HEIGHT_MAX = 3000;
  static SAVE_MS = 600;
  static ROUND = 1000;
  static NAMES = {
    todo: 'Что сделать',
    reminders: 'КП: напоминания',
    week: 'Неделя',
    month: 'Этот месяц',
    funnel: 'Воронка',
    drafts: 'Черновики КП',
    attention: 'Кому нужно внимание',
    team: 'Воронка отдела',
    managers: 'Менеджеры',
    regs: 'Регламент',
    time: 'Где тратится время',
    sum: 'Сводка сделки',
    now: 'Что сделать сейчас',
    main: 'Сделка, поля, документы',
    feed: 'Дела и лента',
  };
  static DEFAULTS = {
    today: { cols: { l: ['todo', 'reminders'], r: ['week', 'month', 'funnel', 'drafts'] }, ratio: 0.62 },
    team: { cols: { l: ['attention', 'managers', 'time'], r: ['team', 'regs'] }, ratio: 0.6 },
    deal: { cols: { l: ['sum', 'main'], r: ['now', 'feed'] }, ratio: 0.6 },
  };
  static _redraws = new Map();
  static _full = '';
  static _saving = new Debounce(CabLayout.SAVE_MS);
  static _drag = null;
  static _local = {};

  /**
   * Своё расположение действует (ПК, функция включена): кабинет — cabLayout, карточка сделки — dealLayout.
   * @param {string} [feature]
   * @returns {boolean}
   */
  static enabled(feature = 'cabLayout') {
    return FEAT.on(feature) && !Mobile.isPhone();
  }

  /**
   * Расположение страницы: сохранённое поверх умолчания, новые разделы — в свою колонку по умолчанию.
   * @param {string} page today | team
   * @param {string[]} keys разделы, которые есть сейчас
   * @returns {{cols: {l: string[], r: string[]}, ratio: number, h: object, hide: string[]}}
   */
  static of(page, keys) {
    const base = this.DEFAULTS[page];
    const saved = this._saved(page);
    const hide = (saved.hide || []).filter(key => keys.includes(key));
    const placed = new Set();
    const cols = {};
    for (const col of ['l', 'r']) {
      const order = saved.cols ? saved.cols[col] || [] : base.cols[col];
      cols[col] = order.filter(key => keys.includes(key) && !placed.has(key) && placed.add(key));
    }
    for (const col of ['l', 'r']) {
      base.cols[col].filter(key => keys.includes(key) && !placed.has(key)).forEach(key => cols[col].push(key));
    }
    return { cols, ratio: saved.ratio || base.ratio, h: { ...(saved.h || {}) }, hide };
  }

  static _saved(page) {
    const mine = (MyPrefs.prefs.cabLayout || {})[page];
    return mine || this._local[page] || {};
  }

  /**
   * Разметка страницы из разделов.
   * @param {string} page
   * @param {Object<string, string>} parts раздел → HTML (пустой — раздела нет)
   * @returns {string}
   */
  static html(page, parts) {
    const keys = Object.keys(parts).filter(key => parts[key]);
    const layout = this.of(page, keys);
    const column = col =>
      `<div class="lay-col" data-clcol="${col}">${layout.cols[col]
        .filter(key => !layout.hide.includes(key))
        .map(key => this._section(key, parts[key], layout.h[key]))
        .join('')}</div>`;
    const ratio = layout.ratio;
    const style = `grid-template-columns:minmax(0,${ratio}fr) 10px minmax(0,${(1 - ratio).toFixed(3)}fr)`;
    return `<div class="lay-g" data-clpage="${page}" style="${style}">${column('l')}<div class="lay-split" role="separator" aria-orientation="vertical" aria-label="Ширина колонок — потяните" title="Потяните — колонка шире или уже"></div>${column('r')}</div>${this._hidden(page, layout)}`;
  }

  static _section(key, html, height) {
    const full = this._full === key;
    const size = height && !full ? ` style="height:${height}px"` : '';
    const name = this.NAMES[key] || key;
    const state = `${height && !full ? ' fixed' : ''}${full ? ' lay-full' : ''}`;
    return `<div class="lay-s${state}" data-cl="${key}"${size}><div class="lay-tools">${this._fullButton(key, name)}<button type="button" class="lay-grip" draggable="true" aria-label="Перетащить раздел «${name}»" title="Перетащить в другое место">⠿</button><button type="button" class="lay-hide" data-clhide="${key}" aria-label="Скрыть раздел «${name}»" title="Скрыть (вернуть — «Мои настройки»)">—</button></div><div class="lay-in">${html}</div><div class="lay-rs" data-clrs="${key}" title="Потяните — выше или ниже; двойной щелчок — по содержимому" aria-hidden="true"></div></div>`;
  }

  // «⤢» — раздел на весь экран, «⤡» или Esc — обратно
  static _fullButton(key, name) {
    if (!FEAT.on('cabExpand')) return '';
    const full = this._full === key;
    const label = full ? `Свернуть раздел «${name}»` : `Раздел «${name}» — на весь экран`;
    return `<button type="button" class="lay-max" data-clmax="${key}" aria-pressed="${full}" aria-label="${label}" title="${full ? 'Свернуть (Esc)' : 'На весь экран'}">${full ? '⤡' : '⤢'}</button>`;
  }

  static _hidden(page, layout) {
    if (!layout.hide.length) return '';
    const names = layout.hide.map(key => this.NAMES[key] || key).join(', ');
    return `<p class="muted lay-off">Скрыто: ${names}. <button type="button" class="lnk" data-clshow="${page}">Показать все</button></p>`;
  }

  /**
   * Перетаскивание, размеры, «на весь экран» и скрытие — один раз на окно (кабинет, карточка сделки).
   * @param {HTMLElement} box
   * @param {string} owner кабинет или карточка — своя перерисовка
   * @param {Function} redraw перерисовать
   */
  static bind(box, owner, redraw) {
    // Esc — с любого места (после «⤢» фокус уходит с перерисованной кнопки), раньше закрытия окна
    if (!this._redraws.size) document.addEventListener('keydown', event => this._escape(event), true);
    this._redraws.set(owner, redraw);
    box.addEventListener('dragstart', event => this._dragStart(event));
    box.addEventListener('dragover', event => this._dragOver(event));
    box.addEventListener('drop', event => this._dropSection(event));
    box.addEventListener('dragend', () => this._dragEnd(box));
    box.addEventListener('pointerdown', event => this._pointer(event));
    box.addEventListener('dblclick', event => this._autoHeight(event));
    box.addEventListener('click', event => this._click(event));
  }

  /**
   * Все разделы страницы в порядке программы.
   * @param {string} page
   * @returns {string[]}
   */
  static keys(page) {
    const base = this.DEFAULTS[page];
    return [...base.cols.l, ...base.cols.r];
  }

  /**
   * Расположение всех страниц с другим набором скрытых на странице (не сохраняет).
   * @param {string} page
   * @param {string[]} hide
   * @returns {object}
   */
  static withHidden(page, hide) {
    const layout = this._current(page);
    layout.hide = hide;
    return { ...(MyPrefs.prefs.cabLayout || {}), [page]: layout };
  }

  /**
   * Вернуть расположение программы.
   * @param {string} page
   */
  static reset(page) {
    this._store(page, null);
  }

  /**
   * Скрытые разделы страницы (для «Мои настройки»).
   * @param {string} page
   * @returns {string[]}
   */
  static hidden(page) {
    return this._saved(page).hide || [];
  }

  /**
   * Показать или скрыть раздел.
   * @param {string} page
   * @param {string} key
   * @param {boolean} shown
   */
  static show(page, key, shown) {
    const layout = this._current(page);
    layout.hide = shown ? layout.hide.filter(name => name !== key) : [...new Set([...layout.hide, key])];
    this._store(page, layout);
  }

  static _current(page) {
    const saved = this._saved(page);
    const base = this.DEFAULTS[page];
    return {
      cols: saved.cols ? { ...saved.cols } : { l: [...base.cols.l], r: [...base.cols.r] },
      ratio: saved.ratio || base.ratio,
      h: { ...(saved.h || {}) },
      hide: [...(saved.hide || [])],
    };
  }

  // раскладку из страницы: порядок, как его видно сейчас (с учётом скрытых — остаются на своих местах в конце)
  static _read(grid) {
    const page = grid.dataset.clpage;
    const layout = this._current(page);
    for (const col of ['l', 'r']) {
      const shown = [...grid.querySelectorAll(`[data-clcol="${col}"] > .lay-s`)].map(el => el.dataset.cl);
      layout.cols[col] = [...shown, ...layout.hide.filter(key => (layout.cols[col] || []).includes(key))];
    }
    return { page, layout };
  }

  static _store(page, layout) {
    const all = { ...(MyPrefs.prefs.cabLayout || {}) };
    if (layout) all[page] = layout;
    else delete all[page];
    if (layout) this._local[page] = layout;
    else delete this._local[page];
    MyPrefs.prefs = { ...MyPrefs.prefs, cabLayout: all };
    this._saving.run(() => MyPrefs.remember({ cabLayout: all }));
    this._redrawAll();
  }

  static _redrawAll() {
    this._redraws.forEach(redraw => redraw());
  }

  static _escape(event) {
    if (event.key !== 'Escape' || !this._full) return;
    event.preventDefault();
    event.stopPropagation();
    this._full = '';
    this._redrawAll();
  }

  static _dragStart(event) {
    const grip = event.target.closest && event.target.closest('.lay-grip');
    if (!grip) return;
    const section = grip.closest('.lay-s');
    this._drag = section;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', section.dataset.cl);
    event.dataTransfer.setDragImage(section, 24, 18);
    requestAnimationFrame(() => section.classList.add('lay-moving'));
  }

  static _dragOver(event) {
    if (!this._drag) return;
    const column = event.target.closest('.lay-col');
    if (!column) return;
    event.preventDefault();
    const after = this._after(column, event.clientY);
    if (after) column.insertBefore(this._drag, after);
    else column.appendChild(this._drag);
  }

  // раздел, перед которым встать: первый, чья середина ниже указателя
  static _after(column, pointerY) {
    return [...column.querySelectorAll(':scope > .lay-s:not(.lay-moving)')].find(section => {
      const box = section.getBoundingClientRect();
      return pointerY < box.top + box.height / 2;
    });
  }

  static _dropSection(event) {
    if (!this._drag) return;
    event.preventDefault();
    const grid = this._drag.closest('.lay-g');
    this._dragEnd(grid);
    const { page, layout } = this._read(grid);
    this._store(page, layout);
  }

  static _dragEnd(box) {
    if (this._drag) this._drag.classList.remove('lay-moving');
    this._drag = null;
    if (box && box.querySelectorAll)
      box.querySelectorAll('.lay-moving').forEach(el => el.classList.remove('lay-moving'));
  }

  static _pointer(event) {
    const resize = event.target.closest && event.target.closest('[data-clrs]');
    const split = event.target.closest && event.target.closest('.lay-split');
    if (resize) this._resize(event, resize.closest('.lay-s'));
    else if (split) this._split(event, split.closest('.lay-g'));
  }

  static _track(event, move, done) {
    event.preventDefault();
    const target = event.target;
    target.setPointerCapture?.(event.pointerId);
    const onMove = moveEvent => move(moveEvent);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('lay-busy');
      done();
    };
    document.body.classList.add('lay-busy');
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  static _resize(event, section) {
    const top = section.getBoundingClientRect().top;
    let height = section.offsetHeight;
    this._track(
      event,
      moveEvent => {
        height = Math.min(this.HEIGHT_MAX, Math.max(this.HEIGHT_MIN, Math.round(moveEvent.clientY - top)));
        section.style.height = `${height}px`;
        section.classList.add('fixed');
      },
      () => {
        const { page, layout } = this._read(section.closest('.lay-g'));
        layout.h[section.dataset.cl] = height;
        this._store(page, layout);
      },
    );
  }

  static _split(event, grid) {
    const box = grid.getBoundingClientRect();
    let ratio = 0;
    this._track(
      event,
      moveEvent => {
        const share = (moveEvent.clientX - box.left) / box.width;
        ratio = Math.round(Math.min(this.RATIO_MAX, Math.max(this.RATIO_MIN, share)) * this.ROUND) / this.ROUND;
        grid.style.gridTemplateColumns = `minmax(0,${ratio}fr) 10px minmax(0,${(1 - ratio).toFixed(3)}fr)`;
      },
      () => {
        if (!ratio) return;
        const { page, layout } = this._read(grid);
        layout.ratio = ratio;
        this._store(page, layout);
      },
    );
  }

  static _autoHeight(event) {
    const resize = event.target.closest && event.target.closest('[data-clrs]');
    if (!resize) return;
    const section = resize.closest('.lay-s');
    const { page, layout } = this._read(section.closest('.lay-g'));
    delete layout.h[section.dataset.cl];
    this._store(page, layout);
  }

  static _click(event) {
    const max = event.target.closest && event.target.closest('[data-clmax]');
    if (max) {
      this._full = this._full === max.dataset.clmax ? '' : max.dataset.clmax;
      this._redrawAll();
      return;
    }
    const hide = event.target.closest && event.target.closest('[data-clhide]');
    if (hide) {
      this.show(hide.closest('.lay-g').dataset.clpage, hide.dataset.clhide, false);
      return;
    }
    const all = event.target.closest && event.target.closest('[data-clshow]');
    if (!all) return;
    const page = all.dataset.clshow;
    const layout = this._current(page);
    layout.hide = [];
    this._store(page, layout);
  }
}
