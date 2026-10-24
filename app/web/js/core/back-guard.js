import { AppTabs } from './app-tabs.js';
import { FEAT } from './features.js';
import { Toast } from './toast.js';

/**
 * Кнопка «Назад» браузера (и жест «назад» на телефоне) не уводит из программы: закрывает верхнее окно, затем вкладку
 * «по месту», затем возвращает в кабинет; на главном экране — подсказка. Закрыть вкладку или перезагрузить страницу
 * с несохранённым КП — браузер переспросит.
 */
export class BackGuard {
  static MARK = { kpGuard: true };
  static _unsaved = () => false;

  /**
   * Включить защиту.
   * @param {() => boolean} [unsaved] есть несохранённое (спросить при закрытии страницы)
   */
  static listen(unsaved) {
    if (unsaved) this._unsaved = unsaved;
    history.pushState(this.MARK, '');
    window.addEventListener('popstate', () => this._back());
    window.addEventListener('beforeunload', event => this._leave(event));
  }

  static _back() {
    if (!FEAT.on('backGuard')) {
      history.back();
      return;
    }
    history.pushState(this.MARK, '');
    if (this._closeTop()) return;
    if (AppTabs.active !== AppTabs.MAIN && AppTabs.active !== AppTabs.HOME && this._closeTab()) return;
    if (AppTabs.active !== AppTabs.MAIN) {
      AppTabs.open(AppTabs.MAIN);
      return;
    }
    Toast.show('«Назад» не закрывает программу. Чтобы выйти — закройте вкладку браузера.');
  }

  // окно поверх всего — как Esc: окно может отказаться закрываться (несохранённое)
  static _closeTop() {
    const dialogs = [...document.querySelectorAll('dialog[open]:modal')];
    const top = dialogs[dialogs.length - 1];
    if (!top) return false;
    this._cancel(top);
    return true;
  }

  static _closeTab() {
    const dialog = AppTabs.dialogs.get(AppTabs.active);
    if (!AppTabs.visible(dialog)) return false;
    this._cancel(dialog);
    return true;
  }

  static _cancel(dialog) {
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) dialog.close();
  }

  static _leave(event) {
    if (!FEAT.on('backGuard') || !this._unsaved()) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
