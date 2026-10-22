import { AdminApi, AdminDialog } from './admin-core.js';
import { BackupTab } from './backup-tab.js';
import { DefaultsTab } from './defaults-tab.js';
import { StNav } from './settings-tools.js';
import { SettingsWindow } from './settings-window.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Fmt } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * «Обслуживание → Опасная зона»: всё необратимое в одном месте, с объяснением последствий; выполняется только после
 * ввода слова «УДАЛИТЬ» (AdminDialog.danger).
 */
export class DangerZone {
  // [действие, название, что случится, надпись кнопки]
  static ITEMS = [
    [
      'base',
      'Заменить всю базу файлом',
      'Все данные программы (КП, каталог, клиенты, сделки) заменятся содержимым файла. Перед этим программа сохранит копию текущей базы.',
      'Выбрать файл базы…',
    ],
    [
      'trash',
      'Очистить корзину целиком',
      'Всё удалённое (КП, товары, клиенты, контакты) исчезнет навсегда — восстановить из корзины будет нельзя.',
      'Очистить корзину…',
    ],
    [
      'params',
      'Вернуть все параметры программы к встроенным',
      'Все ваши значения (НДС, сроки, ставки, умолчания КП и расчётов) удалятся — будут действовать значения программы. Функции, списки и тексты не меняются.',
      'Вернуть все…',
    ],
    [
      'feeds',
      'Удалить позиции фида',
      'Позиции, загруженные из фида поставщика, — в корзину (по фиду или категории). Делается в карточке фида.',
      'Открыть фиды…',
    ],
  ];

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static render(main) {
    main.innerHTML = `<div class="st-card dz"><p class="sub bad-t">Действия, которые нельзя отменить</p>
      <p class="muted">Каждое спросит подтверждение — введите слово «${esc(AdminDialog.WORD)}». Перед заменой базы программа сохраняет копию; копии — «Обслуживание → Копии и база».</p>
      ${this.ITEMS.map(([act, title, text, button]) => `<div class="st-row dz-r"><div><b>${esc(title)}</b><span class="muted">${esc(text)}</span></div><div class="acts"><button class="btn danger" type="button" data-dz="${act}">${esc(button)}</button></div></div>`).join('')}
      <p class="muted">Забыли пароли все администраторы: на компьютере, где работает программа, создайте файл <b>data\\admin-reset.txt</b> и перезапустите программу — учётные записи администраторов удалятся, войдите и создайте новую.</p></div>`;
    main.onclick = event => {
      const button = event.target.closest('[data-dz]');
      if (button) this._run(main, button.dataset.dz).catch(error => Toast.show(error.message || String(error)));
    };
  }

  static async _run(main, act) {
    const runs = {
      base: () => this._go('backup', () => BackupTab.show('in', 'db')),
      feeds: () => this._go('feeds'),
      trash: () => this._trash(),
      params: () => this._params(),
    };
    await runs[act]();
  }

  static async _go(tab, before) {
    if (before) before();
    StNav.select(tab);
    await SettingsWindow.tab();
  }

  static async _trash() {
    const reply = await AdminApi.get('trash');
    const total = (reply.items || []).length;
    if (!total) {
      Toast.show('Корзина пуста');
      return;
    }
    const text = `В корзине: ${Fmt.num(total)}. Всё удалится окончательно.`;
    if (!(await AdminDialog.danger('Очистить корзину целиком?', text, 'Удалить навсегда'))) return;
    const answer = await AdminApi.post('trash/clear', { type: '' });
    Catalog.refresh();
    Toast.show(`Удалено навсегда: ${Fmt.num(answer.deleted)}`);
  }

  static async _params() {
    const reply = await AdminApi.get('defaults');
    const keys = Object.keys(reply.values || {});
    if (!keys.length) {
      Toast.show('Своих значений нет — уже действуют значения программы');
      return;
    }
    const text = `Ваших значений: ${keys.length}. Будут действовать значения программы.`;
    if (!(await AdminDialog.danger('Вернуть все параметры к встроенным?', text, 'Вернуть все'))) return;
    const saved = await AdminApi.post('defaults', { values: Object.fromEntries(keys.map(key => [key, null])) });
    DefaultsTab.remember(saved.values || {});
    Toast.show('Все параметры — как в программе');
  }
}
