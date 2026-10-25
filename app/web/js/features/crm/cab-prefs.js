import { CabLayout } from './cab-layout.js';
import { CabDeals } from './cab-deals.js';
import { CabToday } from './cab-today.js';
import { Cabinet } from './cabinet.js';
import { MyPrefs } from '../kp/my-prefs.js';
import { DefRegistry } from '../../core/defaults.js';
import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';

/**
 * Вкладка кабинета «⚙ Мои настройки»: общие настройки менеджера (MyPrefs) и свои для кабинета — раздел при запуске,
 * вид сделок, что показывать на «Сегодня», сколько строк в списках, расположение разделов.
 */
export class CabPrefs {
  static TABS = [
    ['today', 'Сегодня'],
    ['deals', 'Сделки'],
    ['clients', 'Клиенты'],
  ];
  static VIEWS = [
    ['board', 'Доска'],
    ['list', 'Список'],
    ['gantt', 'График'],
    ['pay', 'Оплаты'],
  ];
  static LIMIT_MAX = 30;

  /**
   * Вкладка есть (функция включена).
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('cabPrefs');
  }

  /**
   * Раздел.
   * @returns {string}
   */
  static html() {
    if (!MyPrefs.uid) {
      return '<p class="msg warn">Выберите себя в разделе «Менеджер» — настройки сохраняются для менеджера и действуют на любом компьютере.</p>';
    }
    return `<div class="cp" id="cabPrefs"><div class="cp-g"><section class="md-s cp-s">${MyPrefs.form()}</section>
      <section class="md-s cp-s">${this._cabinet()}${this._shown()}${this._limits()}</section></div>
      <div class="cp-bar"><span class="muted">${esc(MyPrefs.myName())}</span><button class="btn primary" type="button" data-cpsave>Сохранить</button></div></div>`;
  }

  static _select(id, list, value) {
    const options = list
      .map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`)
      .join('');
    return `<select id="${id}">${options}</select>`;
  }

  static _cabinet() {
    const views = this.VIEWS.filter(([key]) => key !== 'pay' || FEAT.on('payCalendar'));
    return `<p class="sub mp-h">Кабинет</p><div class="grid g2">
      <label class="f"><span>При запуске открывать</span>${this._select('cpTab', this.TABS, MyPrefs.prefs.cabTab || 'today')}</label>
      <label class="f"><span>Сделки показывать</span>${this._select('cpView', views, MyPrefs.prefs.dealsView || CabDeals.view || 'board')}</label></div>`;
  }

  static _shown() {
    if (!CabLayout.enabled()) return '';
    const hidden = CabLayout.hidden('today');
    const boxes = CabLayout.keys('today')
      .map(
        key =>
          `<label class="mp-ck"><input type="checkbox" data-cpshow="${key}"${hidden.includes(key) ? '' : ' checked'}> ${esc(CabLayout.NAMES[key])}</label>`,
      )
      .join('');
    return `<p class="sub mp-h">«Сегодня»: что показывать</p><div class="cp-ck">${boxes}</div>
      <p class="muted cp-how">Разделы «Сегодня» и «Отдел» перетаскиваются за ⠿, нижний край и граница колонок тянутся. <button class="lnk" type="button" data-cpreset>Вернуть расположение как в программе</button></p>`;
  }

  static _limits() {
    const rows = [
      ['todo', 'Сделок в группе «Что сделать»', CabToday.SHOW],
      ['rem', 'КП: напоминания', Math.round(DefRegistry.num('ui.mdRem', CabToday.REM))],
      ['drafts', 'Черновики КП', Math.round(DefRegistry.num('ui.mdDrafts', CabToday.DRAFTS))],
    ];
    const own = MyPrefs.prefs.limits || {};
    const fields = rows
      .map(
        ([key, label, base]) =>
          `<label class="f"><span>${label}</span><input type="number" min="1" max="${this.LIMIT_MAX}" step="1" inputmode="numeric" data-cplim="${key}" value="${own[key] || ''}" placeholder="${base}"></label>`,
      )
      .join('');
    return `<p class="sub mp-h">Сколько строк показывать <span class="muted">(пусто — как у отдела)</span></p><div class="grid g3">${fields}</div>`;
  }

  static _numbers(root) {
    const limits = {};
    root.querySelectorAll('[data-cplim]').forEach(input => {
      const value = Math.round(Number(input.value));
      if (value >= 1 && value <= this.LIMIT_MAX) limits[input.dataset.cplim] = value;
    });
    return limits;
  }

  static async _save(root) {
    const view = root.querySelector('#cpView').value;
    const patch = {
      ...MyPrefs.collect(root),
      cabTab: root.querySelector('#cpTab').value,
      dealsView: view,
      limits: this._numbers(root),
    };
    const boxes = [...root.querySelectorAll('[data-cpshow]')];
    if (boxes.length) {
      patch.cabLayout = CabLayout.withHidden(
        'today',
        boxes.filter(box => !box.checked).map(box => box.dataset.cpshow),
      );
    }
    if (await MyPrefs.store(patch)) {
      CabDeals.useView(view);
      Cabinet.render();
    }
  }

  /**
   * Щелчки вкладки. true — обработано.
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const root = event.target.closest && event.target.closest('#cabPrefs');
    if (!root) return false;
    if (event.target.closest('[data-cpsave]')) {
      this._save(root);
      return true;
    }
    if (event.target.closest('[data-cpreset]')) {
      CabLayout.reset('today');
      CabLayout.reset('team');
      return true;
    }
    return false;
  }
}
