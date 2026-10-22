import { Mobile } from './mobile.js';
import { SidePanel } from './side-panel.js';
import { Steps } from './steps.js';
import { ItemEditor } from '../features/catalog/item-editor.js';
import { CoverThumb } from '../features/doc/cover-thumb.js';
import { Morph } from '../core/morph.js';
import { AppTabs } from '../core/app-tabs.js';
import { $ } from '../core/util.js';
import { MgrLock } from '../features/kp/managers.js';
import { Templates } from '../features/doc/templates.js';
import { AdminGear } from '../core/admin-gear.js';
import { CatalogEditor } from '../features/catalog/catalog-edit.js';

/** Перерисовка формы КП: полоса шагов, открытый шаг, фокус в поле, боковая панель. */
export class FormView {
  static NUMBER = /<h2><span class="n">\d+<\/span>/;
  // шаги, у которых ⚙ ведёт в «Параметры → КП и документы»
  static GEAR = ['client', 'manager', 'conds', 'price', 'cover'];

  /** Перерисовать форму (во время правки позиции каталога — только её карточку). */
  static render() {
    if (CatalogEditor.session) {
      this._editor();
      return;
    }
    Templates.pick();
    MgrLock.apply();
    const form = $('#form');
    const active = document.activeElement;
    const focusPath = active?.dataset?.p;
    const current = Steps.LIST.find(step => step.id === Steps.current) || Steps.LIST[0];
    Morph.apply($('#nav'), Steps.stepperHtml());
    const number = `<h2><span class="n">${Steps.visible().indexOf(current) + 1}</span>`;
    const gear = this.GEAR.includes(current.id) ? AdminGear.html('params:kp', 'новое КП и условия') : '';
    Morph.apply(form, current.f().replace(this.NUMBER, number).replace('</h2>', `${gear}</h2>`) + Steps.navHtml());
    // поле осталось тем же узлом — фокус не трогаем (иначе на телефоне прыгает клавиатура)
    if (focusPath && !active.isConnected && !AppTabs.visible($('#edlg'))) this._refocus(form, focusPath);
    this._centerStep();
    document.body.dataset.kpstep = Steps.current;
    form.querySelectorAll('textarea.iname').forEach(area => Mobile.fitText(area));
    SidePanel.render();
    this._editor();
    if (Steps.current === 'cover') CoverThumb.soon();
    AppTabs.render();
  }

  static _editor() {
    if (ItemEditor.current && $('#edlg').open) ItemEditor.render();
  }

  static _refocus(form, path) {
    const input = form.querySelector(`[data-p="${CSS.escape(path)}"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {
      // поле без выделения текста
    }
  }

  static _centerStep() {
    const bar = $('#nav .stepper');
    const current = bar?.querySelector('.stp.cur');
    if (bar && current && bar.scrollWidth > bar.clientWidth) {
      bar.scrollLeft = current.offsetLeft - (bar.clientWidth - current.offsetWidth) / 2;
    }
  }
}

/** Раскрывающиеся меню и подсказки закрываются щелчком мимо них, меню действий — и после выбора пункта. */
export class Popups {
  static OPEN = 'details.tip[open], details.topmenu[open], details.pickm[open], details.jr-more[open]';

  /**
   * Закрыть открытые меню и подсказки.
   * @param {Event} event щелчок
   */
  static close(event) {
    document.querySelectorAll(this.OPEN).forEach(details => {
      const inside = details.contains(event.target);
      const picked = details.matches('.topmenu, .jr-more') && event.target.closest('.menu-l button');
      if (!inside || picked) details.open = false;
    });
  }

  /** Обработчик щелчков. */
  static listen() {
    document.addEventListener('click', event => this.close(event));
  }
}
