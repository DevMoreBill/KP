import { Mobile } from './mobile.js';
import { SidePanel } from './side-panel.js';
import { Steps } from './steps.js';

/** Перерисовка формы КП: полоса шагов, открытый шаг, фокус в поле, боковая панель. */
export class FormView {
  static NUMBER = /<h2><span class="n">\d+<\/span>/;

  /** Перерисовать форму (во время правки позиции каталога — только её карточку). */
  static render() {
    if (CATED) {
      this._editor();
      return;
    }
    Templates.pick();
    MgrLock.apply();
    const form = $('#form');
    const active = document.activeElement;
    const focusPath = active?.dataset?.p;
    const current = Steps.LIST.find(step => step.id === STEP) || Steps.LIST[0];
    morph($('#nav'), Steps.stepperHtml());
    const number = `<h2><span class="n">${Steps.visible().indexOf(current) + 1}</span>`;
    morph(form, current.f().replace(this.NUMBER, number) + Steps.navHtml());
    // поле осталось тем же узлом — фокус не трогаем (иначе на телефоне прыгает клавиатура)
    if (focusPath && !active.isConnected && !$('#edlg').open) this._refocus(form, focusPath);
    this._centerStep();
    document.body.dataset.kpstep = STEP;
    form.querySelectorAll('textarea.iname').forEach(area => Mobile.fitText(area));
    SidePanel.render();
    this._editor();
    if (STEP === 'cover') CoverThumb.soon();
  }

  static _editor() {
    if (EDIT && $('#edlg').open) renderEditor();
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
