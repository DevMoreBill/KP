import { AdminSession } from '../core/net.js';
import { AuthMenu } from '../features/kp/auth-screen.js';
import { DealDefaults } from '../features/deal/deal-defaults.js';
import { Presets } from '../features/kp/presets.js';
import { Theme } from '../core/theme.js';
import { Modal } from '../core/modal.js';
import { FormView } from './form-view.js';
import { SettingsWindow } from '../features/admin/settings-window.js';
import { MyPrefs } from '../features/kp/my-prefs.js';
import { HelpWindow } from '../features/kp/help-window.js';
import { DealState } from '../features/deal/deal-state.js';
import { KpPreview } from '../features/doc/kp-preview.js';
import { CatalogWindow } from '../features/catalog/catalog-window.js';
import { Reminders } from '../features/kp/reminders.js';
import { MyDay } from '../features/kp/my-day.js';
import { QuickSearch } from '../features/kp/quick-search.js';
import { Journal } from '../features/kp/journal.js';
import { UiTexts } from '../features/kp/ui-texts.js';
import { $ } from '../core/util.js';
/**
 * Телефон (Safari iOS, Chrome Android): режим «mob» на <html> (ставится ещё в <head>, чтобы не мигала настольная
 * раскладка), меню «☰», поле названия по высоте текста, пустые поля дат, шапка прячется при прокрутке вниз.
 */
export class Mobile {
  static QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';
  static DOUBLE_TAP = 350;
  static FIT_GAP = 2;
  static SCROLL_STEP = 8;
  static HIDE_FROM = 90;
  static topY = 0;
  static dateFrame = 0;
  // пункт меню → действие; настольные функции (папки на сервере, импорт, типы) — на компьютере
  static MENU = {
    new: () => $('#btnNew').click(),
    uitexts: () => UiTexts.toggle(),
    journal: () => Journal.open(),
    find: () => QuickSearch.open(),
    myday: () => MyDay.open(),
    reminders: () => Reminders.open(),
    catalog: () => CatalogWindow.open({}),
    preview: () => KpPreview.open(),
    deal: () => DealState.open(),
    help: () => HelpWindow.open(),
    theme: () => $('#btnTheme').click(),
    prefs: () => MyPrefs.open(),
    settings: () => SettingsWindow.open(),
  };

  /**
   * Телефонная раскладка включена.
   * @returns {boolean}
   */
  static isPhone() {
    return document.documentElement.classList.contains('mob');
  }

  /**
   * Следить за шириной экрана: раскладка сменилась — перерисовать форму. При загрузке только ставится раскладка:
   * форму первым рисует main.js, когда загружены все разделы.
   */
  static watch() {
    const query = matchMedia(this.QUERY);
    const apply = () => document.documentElement.classList.toggle('mob', query.matches);
    query.addEventListener('change', () => {
      const was = this.isPhone();
      apply();
      if (was !== query.matches) FormView.render();
    });
    apply();
  }

  /** Меню телефона: только то, что нужно для работы с КП. */
  static openMenu() {
    const dialog = Modal.host('mmenu', 'sheet', 'Меню');
    dialog.innerHTML = `<div class="dlg-h"><h3>Меню</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="mm-l">${this._menuItems()}</div>`;
    dialog.onclick = event => this._menuClick(dialog, event);
    dialog.showModal();
    dialog._at = Date.now();
  }

  static _item(key, icon, title, sub) {
    return `<button type="button" class="mm-i" data-mm="${key}"><i aria-hidden="true">${icon}</i><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  }

  static _menuItems() {
    const item = (key, icon, title, sub) => this._item(key, icon, title, sub);
    const dark = Theme.current() === 'dark';
    const reminders = Reminders.items.length;
    return `${MyDay.enabled() ? item('myday', '☀', 'Кабинет', 'Дела на сегодня, сделки, график') : ''}${item('new', '＋', 'Новое КП', Presets.enabled() ? 'Пустое или по заготовке' : 'Начать с чистого листа')}
      ${item('find', '⌕', 'Найти', 'КП, клиент, сделка, модель — одной строкой')}${item('journal', '☰', 'Журнал КП', 'Открыть, повторить прошлое КП, статусы, отчёт')}
      ${reminders ? item('reminders', '🔔', `Напоминания (${reminders})`, 'Перезвонить, срок действия КП') : ''}
      ${item('catalog', '▦', 'Каталог оборудования', 'Подбор и своё оборудование')}
      ${item('preview', '▤', 'Предпросмотр КП', 'Документ целиком')}
      ${DealDefaults.allowed() ? item('deal', '₽', 'Экономика сделки', 'Прибыль, финансирование, Excel') : ''}
      ${item('help', '?', 'Руководство', 'Как пользоваться, история версий')}
      <hr>${item('prefs', '☺', 'Мои настройки', 'Тема, стартовый экран, мои условия, подпись в письмах')}${item('theme', dark ? '☀' : '☾', dark ? 'Светлая тема' : 'Тёмная тема', '')}
      ${AuthMenu.mobileItems(item)}${item('settings', '⚙', 'Настройки', 'Для администратора')}${AdminSession.on ? item('uitexts', '✎', 'Тексты интерфейса', 'Правка надписей и подсказок') : ''}`;
  }

  static _menuClick(dialog, event) {
    const button = event.target.closest('[data-mm],[data-close]');
    if (!button) {
      // второе касание двойного «☰» не закрывает только что открытое меню
      if (event.target === dialog && Date.now() - (dialog._at || 0) > this.DOUBLE_TAP) dialog.close();
      return;
    }
    dialog.close();
    const key = button.dataset.mm;
    if (this.MENU[key]) this.MENU[key]();
    else if (key?.startsWith('auth')) AuthMenu.mobile(key);
  }

  /**
   * Поле по высоте текста (на узком экране длинное название не обрезается).
   * @param {HTMLTextAreaElement} area
   */
  static fitText(area) {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + this.FIT_GAP}px`;
  }

  // пустое поле даты на iPhone выглядит белым прямоугольником — CSS показывает в помеченных подсказку «дд.мм.гггг»
  static _markDate(input) {
    input.classList.toggle('dt-empty', !input.value);
  }

  static _scanDates() {
    this.dateFrame = 0;
    document.querySelectorAll('input[type=date]').forEach(input => this._markDate(input));
  }

  // шапка с логотипом прячется при прокрутке вниз и возвращается при прокрутке вверх — больше рабочей зоны
  static _scroll() {
    if (!this.isPhone()) return;
    const top = scrollY;
    const delta = top - this.topY;
    if (Math.abs(delta) < this.SCROLL_STEP) return;
    document.body.classList.toggle('top-hide', delta > 0 && top > this.HIDE_FROM);
    this.topY = top;
  }

  /** Обработчики: меню, высота названия, поля дат, прокрутка. */
  static listen() {
    document.addEventListener('click', event => {
      if (event.target.closest('#btnMenu')) this.openMenu();
    });
    document.addEventListener('input', event => {
      if (event.target.matches?.('textarea.iname')) this.fitText(event.target);
    });
    for (const type of ['input', 'change']) {
      document.addEventListener(
        type,
        event => {
          if (event.target.type === 'date') this._markDate(event.target);
        },
        true,
      );
    }
    new MutationObserver(() => {
      if (!this.dateFrame) this.dateFrame = requestAnimationFrame(() => this._scanDates());
    }).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('scroll', () => this._scroll(), { passive: true });
  }
}
