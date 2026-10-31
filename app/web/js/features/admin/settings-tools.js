import { $ } from '../../core/util.js';
import { LISTS } from '../../core/lists.js';
import { FEAT } from '../../core/features.js';
import { DEF_BY } from '../../core/defaults.js';
import { ServerDefaults } from '../../core/net.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';
import { AdminState } from './admin-state.js';

/** Переход по вкладкам и подсветка найденного. */
export class StNav {
  static sup = ''; // поставщик для «Копии и база → Каталог поставщика» (переход из «Фидов поставщиков»)
  static HIT_MS = 2600;

  /**
   * Сравнимый текст: строчные, ё → е.
   * @param {string} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
  }

  /**
   * Выбрать вкладку в меню.
   * @param {string} key
   */
  static select(key) {
    AdminState.tab = AdminState.route(key);
    const dialog = $('#setdlg');
    if (dialog)
      dialog
        .querySelectorAll('.st-nav [data-sttab]')
        .forEach(button => button.classList.toggle('on', button.dataset.sttab === AdminState.tab));
    this.showActive(dialog);
  }

  /**
   * Показать выбранную вкладку, прокрутив только меню (полосу разделов на телефоне, список на ПК): на телефоне окно
   * прокручивается целиком, и прокрутка до кнопки в прилипшей полосе сдвигала бы всё окно.
   * @param {HTMLElement|null} dialog
   */
  static showActive(dialog) {
    const button = dialog?.querySelector('.st-nav .on');
    const nav = button?.closest('.st-nav');
    if (!nav || !button.getClientRects().length) return;
    const box = nav.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    nav.scrollLeft += this._shift([item.left, item.right], [box.left, box.right]);
    nav.scrollTop += this._shift([item.top, item.bottom], [box.top, box.bottom]);
  }

  // насколько сдвинуть, чтобы отрезок кнопки оказался в отрезке меню (как scrollIntoView «nearest»)
  static _shift([start, end], [min, max]) {
    if (start < min) return start - min;
    if (end > max) return Math.min(end - max, start - min);
    return 0;
  }

  /**
   * Найти элемент на открытой вкладке (селектор или текст) и показать его.
   * @param {string} [selector]
   * @param {string} [text]
   */
  static highlight(selector, text) {
    const body = $('#stMain .st-body');
    if (!body) return;
    const found = this._find(body, selector, text);
    if (!found) return;
    found.scrollIntoView({ block: 'center' });
    found.classList.add('st-hit');
    setTimeout(() => found.classList.remove('st-hit'), this.HIT_MS);
    found.querySelector?.('input:not([type=checkbox]),select,textarea')?.focus({ preventScroll: true });
  }

  static _find(body, selector, text) {
    const bySelector = selector ? body.querySelector(selector) : null;
    if (bySelector) return bySelector.closest('.df-row,.ft-r,.key-f,.st-row,tr,label,.st-card') || bySelector;
    if (!text) return null;
    const norm = this.norm(text);
    const byText = [...body.querySelectorAll('td,b,h4,.sub,.ls-it,label span')].find(node =>
      this.norm(node.textContent).includes(norm),
    );
    return byText && (byText.closest('tr,.st-row,.ls-it,label') || byText);
  }
}

/** Несохранённые изменения: отметка в заголовке и вопрос при уходе с вкладки или закрытии окна. */
export class StDirty {
  static dirty = false;
  // поля, которые не настройки: поиск, фильтры журнала, выбор строк, параметры выгрузки, файлы
  static SKIP =
    '[type=search],[type=file],[data-nodirty],[data-nodirty] *,[data-af],[data-did],#dtExp *,#seBox *,.st-find *,[name=dtScope]';

  /**
   * Следить за окном.
   * @param {HTMLDialogElement} dialog
   */
  static watch(dialog) {
    if (dialog._dirtyWatch) return;
    dialog._dirtyWatch = true;
    const mark = event => {
      const target = event.target;
      if (!target.closest || !target.closest('#stMain .st-body') || target.matches(this.SKIP)) return;
      if (target.matches('input,select,textarea')) this.set(true);
    };
    dialog.addEventListener('input', mark);
    dialog.addEventListener('change', mark);
    dialog.addEventListener('cancel', async event => {
      if (!this.dirty) return;
      event.preventDefault();
      if (await this.leave()) dialog.close();
    });
    dialog.addEventListener('close', () => this.set(false));
    window.addEventListener('beforeunload', event => {
      if (!this.dirty || !dialog.open) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  /**
   * Отметить (или снять отметку) несохранённое.
   * @param {boolean} value
   */
  static set(value) {
    this.dirty = !!value;
    const dialog = $('#setdlg');
    if (!dialog) return;
    let badge = dialog.querySelector('.st-dirty');
    if (this.dirty && !badge) {
      const head = dialog.querySelector('.dlg-h h3');
      if (head) {
        badge = document.createElement('span');
        badge.className = 'st-dirty';
        badge.textContent = '● Не сохранено';
        badge.title = 'На этой вкладке есть несохранённые изменения';
        head.after(badge);
      }
    }
    if (!this.dirty && badge) badge.remove();
    dialog.querySelector('.st-nav .on')?.classList.toggle('dirty', this.dirty);
  }

  /** Сохранение прошло (kp:saved — любой запрос на изменение) — отметку снять. */
  static listen() {
    document.addEventListener('kp:saved', () => this.saved());
  }

  /** Сохранение прошло (любой запрос на изменение) — отметку снять. */
  static saved() {
    if (this.dirty) this.set(false);
  }

  /**
   * Можно уйти с вкладки?
   * @returns {Promise<boolean>} true — изменений нет или пользователь согласен их потерять
   */
  static async leave() {
    if (!this.dirty) return true;
    const ok = await AdminDialog.confirm(
      'Есть несохранённые изменения',
      'Если уйти, они пропадут. Чтобы сохранить — останьтесь и нажмите «Сохранить» на этой вкладке.',
      'Уйти без сохранения',
    );
    if (ok) this.set(false);
    return !!ok;
  }
}

/** После отката: настройки в этом браузере — заново с сервера. */
export class StRefresh {
  /** Умолчания, функции и списки — заново. */
  static async all() {
    const jobs = [
      ServerDefaults.load(),
      FEAT.refresh(),
      AdminApi.get('lists').then(reply => {
        LISTS.use(reply.values || {});
        LISTS.cache();
      }),
    ];
    await Promise.all(jobs.map(job => job.catch(() => {})));
  }
}

/** Значения настроек для показа в истории и списке изменённого. */
export class StVal {
  static SHORT = 140;
  static PAIR = 2;
  static WHO = { admin: 'администратору', users: 'выбранным' };
  // понятные имена полей истории: ['defaults', 'kp.vat'] → «Значения программы → НДС в ценах КП»
  static PART = {
    defaults: 'Значения программы',
    lists: 'Списки',
    features: 'Функции',
    ai: 'Нейросеть',
    userLogin: 'Вход менеджеров',
    productEditModeration: 'Модерация',
    auditYears: 'Срок журнала',
    backup2: 'Вторая папка копий',
    host: 'Сервер',
    port: 'Порт',
    security: 'Защита',
    login: 'Логин',
    fromEmail: 'Адрес отправителя',
    fromName: 'Имя отправителя',
    bccSelf: 'Копия себе',
    subject: 'Тема письма',
    body: 'Текст письма',
    types: 'Категории',
    items: 'Фиды',
    enabled: 'Включено',
    model: 'Модель',
    base: 'Адрес API',
    on: 'Включено',
    path: 'Папка',
    keep: 'Хранить копий',
    images: 'Изображения',
  };

  /**
   * Значение коротко.
   * @param {*} value
   * @returns {string}
   */
  static text(value) {
    if (value == null || value === '') return '— (встроенное)';
    if (typeof value === 'boolean') return value ? 'да' : 'нет';
    if (Array.isArray(value)) return `${value.length} ${KPGen.plural(value.length, 'строка', 'строки', 'строк')}`;
    if (typeof value === 'object') return this._object(value);
    return String(value);
  }

  static _object(value) {
    const state = value.on === false ? 'выключено' : 'включено';
    if ('on' in value && Object.keys(value).length <= this.PAIR)
      return state + (value.v != null && value.v !== '' ? `, ${value.v}` : '');
    if ('on' in value && 'who' in value)
      return state + (value.who && value.who !== 'all' ? `, доступ: ${this.WHO[value.who] || value.who}` : '');
    const json = JSON.stringify(value);
    return json.length > this.SHORT ? `${json.slice(0, this.SHORT)}…` : json;
  }

  /**
   * Значение целиком (для подсказки).
   * @param {*} value
   * @returns {string}
   */
  static full(value) {
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value);
  }

  /**
   * Имя поля истории.
   * @param {string[]} path
   * @returns {string}
   */
  static path(path) {
    const [first, second] = path;
    const name = key => this.PART[key] || key;
    if (!second) return name(first) || 'всё значение';
    return `${name(first)} → ${this._second(first, second)}`;
  }

  static _second(first, second) {
    if (first === 'defaults' && DEF_BY[second]) return DEF_BY[second][2];
    if (first === 'features' && FEAT.get(second)) return FEAT.get(second).label;
    if (first === 'lists' && LISTS.get(second)) return LISTS.get(second).label;
    return this.PART[second] || second;
  }
}

/**
 * Сохранение сразу: изменили поле формы «Настроек» — через мгновение срабатывает её кнопка «Сохранить» (у таких кнопок
 * data-autosave, сами кнопки скрыты). Значения программы, списки и тексты сохраняются своим способом.
 */
export class StAutoSave {
  static WAIT_MS = 300;
  static FOCUS_MS = 700;
  static OWN = '.df-wrap *,.ls *,.tx-l *';

  /**
   * Следить за окном.
   * @param {HTMLDialogElement} dialog
   */
  static watch(dialog) {
    if (dialog._autoSave) return;
    dialog._autoSave = true;
    dialog.addEventListener('change', event => this._changed(event.target));
  }

  static _changed(target) {
    if (!target.closest || !target.closest('#stMain .st-body') || target.closest('#stMain.st-ro')) return; // только просмотр — не сохранять
    if (!target.matches('input,select,textarea') || target.matches(StDirty.SKIP) || target.matches(this.OWN)) return;
    const button = this._button(target);
    if (!button) return;
    const focusId = document.activeElement && document.activeElement.id;
    setTimeout(() => this._press(button, focusId), this.WAIT_MS);
  }

  // кнопка той формы, где поле: ближайший общий контейнер
  static _button(target) {
    for (let box = target.parentElement; box && !box.matches('#stMain'); box = box.parentElement) {
      const button = box.querySelector('[data-autosave]');
      if (button) return button;
    }
    return null;
  }

  static _press(button, focusId) {
    const all = [...document.querySelectorAll('#stMain [data-autosave]')];
    const target = button.isConnected ? button : all.length === 1 && all[0];
    if (!target || target.disabled) return;
    target.click();
    StDirty.set(false);
    setTimeout(() => {
      const active = document.activeElement;
      if (focusId && (!active || active === document.body)) document.getElementById(focusId)?.focus();
    }, this.FOCUS_MS);
  }
}
