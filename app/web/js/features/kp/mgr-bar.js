import { Managers, MgrLock } from './managers.js';
import { Morph } from '../../core/morph.js';
import { $, esc } from '../../core/util.js';
import { Str } from '../../core/str.js';
import { S } from '../../core/state.js';

/**
 * Выбор менеджера в разделе «Менеджер»: выбран из справочника — правки сохраняются сами; не выбран — подсказка,
 * а «Сохранить в справочник» появляется, когда ФИО уже вписано (до этого сохранять нечего).
 */
export class MgrBar {
  // отложенное сохранение контактов менеджера (запись КП сбрасывает его)
  static timer = null;
  static SAVE_DELAY = 900;

  /**
   * Панель выбора.
   * @returns {string}
   */
  static html() {
    return `<div class="mgrbar">${this.inner()}</div>`;
  }

  /**
   * Содержимое панели.
   * @returns {string}
   */
  static inner() {
    if (MgrLock.locked()) return MgrLock.html();
    const current = Managers.list.find(row => row.id === S.managerId);
    const typed = !!String(S.manager.name || '').trim();
    // КП прежней версии: менеджер записан под старым кодом, а в справочнике есть с тем же ФИО — предложить взять оттуда
    const same = !current && typed ? Managers.list.find(row => Str.norm(row.name) === Str.norm(S.manager.name)) : null;
    const options = Managers.list
      .map(
        row =>
          `<option value="${esc(row.id)}"${row.id === S.managerId ? ' selected' : ''}>${esc(row.name)}${row.position ? ` — ${esc(row.position)}` : ''}</option>`,
      )
      .join('');
    return `<label class="f"><span>Менеджер в КП</span><select id="mgrSel" aria-label="Выбор менеджера">
        ${current ? '' : `<option value="" selected>${typed ? `${esc(S.manager.name)} — не в справочнике` : '— выберите из списка —'}</option>`}
        ${options}</select></label>
      <div class="row">${this._buttons(current, typed)}</div>
      <p class="muted" id="mgrStat" style="grid-column:1/-1;margin:0">${this._note({ current, typed, same })}</p>`;
  }

  static _buttons(current, typed) {
    if (current) return '<button class="btn" type="button" data-a="mgrNew">+ Новый менеджер</button>';
    return typed ? '<button class="btn primary" type="button" data-a="mgrSave">Сохранить в справочник</button>' : '';
  }

  static _note({ current, typed, same }) {
    if (current) return '';
    if (same) {
      return `В справочнике есть «${esc(same.name)}» — <button class="lnk" type="button" data-a="mgrSame" data-id="${esc(same.id)}">взять контакты оттуда</button>.`;
    }
    return typed
      ? 'Сохраните в справочник — в следующих КП достаточно будет выбрать себя из списка.'
      : 'Выберите себя в списке — контакты подставятся. Нет в списке — заполните поля ниже и сохраните в справочник.';
  }

  /** ФИО вписано или стёрто у менеджера не из справочника — показать или убрать «Сохранить в справочник». */
  static refresh() {
    const bar = document.querySelector('.mgrbar');
    if (bar) Morph.apply(bar, this.inner());
  }

  /** Ввод контактов, выбор в списке, кнопки панели. */
  static listen() {
    document.addEventListener('input', event => this._input(event.target));
    document.addEventListener('change', event => {
      if (event.target.id !== 'mgrSel') return;
      if (event.target.value) Managers.select(event.target.value);
      else Managers.startNew();
    });
    document.addEventListener('click', event => {
      const same = event.target.closest('[data-a="mgrSame"]');
      if (same) Managers.select(same.dataset.id);
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-a]');
      if (!button) return;
      if (button.dataset.a === 'mgrNew') Managers.startNew();
      else if (button.dataset.a === 'mgrSave') Managers.save();
    });
  }

  // ФИО менеджера не из справочника: панель — после записи поля в S (общий обработчик ввода)
  static _input(target) {
    const path = target.dataset?.p || '';
    if (path === 'manager.name' && !S.managerId) {
      setTimeout(() => this.refresh());
      return;
    }
    if (!path.startsWith('manager.') || !S.managerId) return;
    clearTimeout(MgrBar.timer);
    const status = $('#mgrStat');
    if (status) status.textContent = 'Сохраняю…';
    MgrBar.timer = setTimeout(() => Managers.saveQuiet(), this.SAVE_DELAY);
  }
}
