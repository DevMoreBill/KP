/**
 * Размер окна каталога и ширина панелей: фильтры | список | карточка — границы перетаскиваются мышью (или стрелками),
 * двойной щелчок — как было; всё запоминается в браузере.
 */
export class CatalogPanes {
  static PANE = { nav: [200, 560], pv: [300, 900] };
  static MIDMIN = 380;
  static NARROW = 1100;
  static TINY = 760;
  static SPLIT_HALF = 4;
  static KEY_STEP = 24;
  static SIZE_KEY = 'kp.catwin2';
  static PANES_KEY = 'kp.cwpanes';
  static KEYS = ['ArrowLeft', 'ArrowRight', 'Home'];

  /**
   * Запомненное в браузере.
   * @param {string} key
   * @returns {object}
   */
  static read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch {
      return {};
    }
  }

  constructor(dialog) {
    this.d = dialog;
  }

  /** Размер окна — как в прошлый раз. */
  loadSize() {
    const dialog = this.d;
    const size = CatalogPanes.read(CatalogPanes.SIZE_KEY);
    dialog.classList.toggle('max', !!size.max);
    if (size.w && size.h) {
      dialog.style.width = `${Math.min(size.w, innerWidth)}px`;
      dialog.style.height = `${Math.min(size.h, innerHeight)}px`;
    } else {
      dialog.style.width = '';
      dialog.style.height = '';
    }
  }

  /** Запомнить размер окна. */
  saveSize() {
    const dialog = this.d;
    try {
      const old = CatalogPanes.read(CatalogPanes.SIZE_KEY);
      const max = dialog.classList.contains('max');
      const size = max
        ? { ...old, max: true }
        : { max: false, w: Math.round(dialog.offsetWidth), h: Math.round(dialog.offsetHeight) };
      localStorage.setItem(CatalogPanes.SIZE_KEY, JSON.stringify(size));
    } catch {
      // браузер не хранит
    }
  }

  /** Узкое и крошечное окно — по ширине. */
  layout() {
    const dialog = this.d;
    const width = dialog.clientWidth;
    dialog.classList.toggle('narrow', width < CatalogPanes.NARROW);
    dialog.classList.toggle('tiny', width < CatalogPanes.TINY);
    this.pos();
  }

  /** Ширина панелей — как в прошлый раз. */
  load() {
    const widths = CatalogPanes.read(CatalogPanes.PANES_KEY);
    for (const key in CatalogPanes.PANE) {
      if (widths[key]) this.d.style.setProperty(`--cw-${key}`, `${widths[key]}px`);
      else this.d.style.removeProperty(`--cw-${key}`);
    }
  }

  /** Запомнить ширину панелей. */
  save() {
    const widths = {};
    for (const key in CatalogPanes.PANE) {
      const width = parseInt(this.d.style.getPropertyValue(`--cw-${key}`));
      if (width) widths[key] = width;
    }
    try {
      localStorage.setItem(CatalogPanes.PANES_KEY, JSON.stringify(widths));
    } catch {
      // браузер не хранит
    }
  }

  /**
   * Ширина панели — как было.
   * @param {string} key nav | pv
   */
  reset(key) {
    this.d.style.removeProperty(`--cw-${key}`);
    this.pos();
    this.save();
  }

  _showSplit(key, rect) {
    const classes = this.d.classList;
    if (!rect || !(rect.width > 0) || classes.contains('tiny')) return false;
    return !(key === 'pv' && classes.contains('narrow')) && !classes.contains('pvwide');
  }

  _placeSplit(split, { nav, card, box }) {
    const key = split.dataset.split;
    const rect = (key === 'nav' ? nav : card)?.getBoundingClientRect();
    const show = this._showSplit(key, rect);
    split.hidden = !show;
    if (!show) return;
    const edge = key === 'nav' ? rect.right : rect.left;
    split.style.left = `${Math.round(edge - box.left - CatalogPanes.SPLIT_HALF)}px`;
    split.setAttribute('aria-valuenow', Math.round(rect.width));
  }

  _placeWide(nav, card) {
    const dialog = this.d;
    if (!card) return;
    if (!dialog.classList.contains('pvwide')) {
      card.style.left = '';
      return;
    }
    const left = dialog.classList.contains('tiny') || !nav ? 0 : Math.round(nav.getBoundingClientRect().width);
    card.style.left = `${left}px`;
  }

  /** Положение границ и широкой карточки — по фактическим размерам панелей. */
  pos() {
    const dialog = this.d;
    const body = dialog.querySelector('.cw-b');
    if (!body) return;
    const panes = {
      box: body.getBoundingClientRect(),
      nav: dialog.querySelector('.cw-nav'),
      card: dialog.querySelector('.cw-pv'),
    };
    dialog.querySelectorAll('.cw-split').forEach(split => this._placeSplit(split, panes));
    this._placeWide(panes.nav, panes.card);
  }

  _other(key) {
    const dialog = this.d;
    if (key !== 'nav') return dialog.querySelector('.cw-nav').getBoundingClientRect().width;
    return dialog.classList.contains('narrow') ? 0 : dialog.querySelector('.cw-pv').getBoundingClientRect().width;
  }

  /**
   * Ширина панели (в пределах).
   * @param {string} key nav | pv
   * @param {number} width
   */
  set(key, width) {
    const box = this.d.querySelector('.cw-b').getBoundingClientRect();
    const [low, high] = CatalogPanes.PANE[key];
    const fit = Math.round(Math.max(low, Math.min(high, box.width - this._other(key) - CatalogPanes.MIDMIN, width)));
    this.d.style.setProperty(`--cw-${key}`, `${fit}px`);
    this.pos();
  }

  _drag(event) {
    const split = event.target.closest?.('.cw-split');
    if (!split || event.button !== 0) return;
    event.preventDefault();
    const dialog = this.d;
    const key = split.dataset.split;
    const body = dialog.querySelector('.cw-b');
    split.setPointerCapture(event.pointerId);
    dialog.classList.add('resizing');
    const move = moved => {
      const rect = body.getBoundingClientRect();
      this.set(key, key === 'nav' ? moved.clientX - rect.left : rect.right - moved.clientX);
    };
    const stop = () => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', stop);
      split.removeEventListener('pointercancel', stop);
      dialog.classList.remove('resizing');
      this.save();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', stop);
    split.addEventListener('pointercancel', stop);
  }

  _key(event) {
    const split = event.target.closest?.('.cw-split');
    if (!split || !CatalogPanes.KEYS.includes(event.key)) return;
    event.preventDefault();
    const key = split.dataset.split;
    if (event.key === 'Home') {
      this.reset(key);
      return;
    }
    const pane = this.d.querySelector(key === 'nav' ? '.cw-nav' : '.cw-pv');
    const step = (event.key === 'ArrowRight') === (key === 'nav') ? CatalogPanes.KEY_STEP : -CatalogPanes.KEY_STEP;
    this.set(key, pane.getBoundingClientRect().width + step);
    this.save();
  }

  /** Перетаскивание границ мышью и стрелками. */
  bind() {
    this.d.addEventListener('pointerdown', event => this._drag(event));
    this.d.addEventListener('keydown', event => this._key(event));
  }
}
