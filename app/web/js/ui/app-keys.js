import { Problems } from './side-panel.js';

/** Кнопки шапки «Выход» и «Новое КП». */
export class TopBar {
  /** Обработчики кнопок шапки. */
  static listen() {
    $('#btnExit').addEventListener('click', () => this.exit());
    $('#btnNew').addEventListener('click', () => NewKp.open());
  }

  /** Закрыть программу (сервер останавливается; черновик остаётся в браузере). */
  static async exit() {
    if (!confirm('Закрыть программу? Несохранённый черновик останется в браузере.')) return;
    try {
      await api('/api/shutdown', { method: 'POST' });
    } catch {
      // сервер уже остановлен
    }
    document.body.innerHTML =
      '<p style="padding:40px;font:18px Onest,Arial">Программа закрыта. Эту вкладку можно закрыть.</p>';
  }
}

/** Клавиатура формы: раскрытые блоки позиций, место для картинки (Enter / пробел), Ctrl+S и Ctrl+K. */
export class AppKeys {
  // горячие клавиши (когда не открыто окно): Ctrl+S — сохранить КП, Ctrl+K — каталог (и в русской раскладке)
  static HOTKEYS = {
    s: () => AppKeys._save(),
    ы: () => AppKeys._save(),
    k: () => openCatalog({}),
    л: () => openCatalog({}),
  };

  static _toggle(event) {
    const details = event.target;
    if (details.dataset && details.dataset.more != null && S.items[+details.dataset.more]) {
      S.items[+details.dataset.more]._open = details.open;
    }
  }

  static _drop(event) {
    const zone = event.target.closest?.('[data-drop]');
    if (zone && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      pickImage(zone.dataset.drop, +zone.dataset.i);
    }
  }

  static _save() {
    const list = Problems.list();
    if (list.length) {
      toast(`Сначала заполните: ${list[0][0]}${list.length > 1 ? ` (и ещё ${list.length - 1})` : ''}`);
      return;
    }
    document.querySelector('#side [data-a="download"]')?.click();
  }

  static _hotkey(event) {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      !FEAT.on('hotkeys') ||
      document.querySelector('dialog[open]')
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (!Object.hasOwn(this.HOTKEYS, key)) return;
    event.preventDefault();
    this.HOTKEYS[key]();
  }

  /** Обработчики клавиатуры и раскрытия блоков. */
  static listen() {
    document.addEventListener('toggle', event => this._toggle(event), true);
    document.addEventListener('keydown', event => this._drop(event));
    document.addEventListener('keydown', event => this._hotkey(event));
  }
}
