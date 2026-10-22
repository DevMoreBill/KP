import { SettingsWindow } from './settings-window.js';
import { esc } from '../../core/util.js';
import { Modal } from '../../core/modal.js';
import { AdminSession, Api } from '../../core/net.js';

/** Состояние окна «Настройки»: вкладка, выбор записей, журнал действий, график, вход администратора, открытая карточка. */
export class AdminState {
  static tab = 'home';
  static del = { type: 'kp', q: '', sel: new Set() };
  static audit = { page: 0, f: {} };
  static imp = null;
  static chart = 'day';
  static status = null;
  static editing = null;
}

/** Запросы «Настроек» к серверу (/api/admin/…): сессия истекла — снова форма входа. */
export class AdminApi {
  static EXPIRED = /сессия|Войдите/;

  /**
   * Запрос.
   * @param {string} path путь после /api/admin/
   * @param {object} [opts] параметры fetch
   * @returns {Promise<*>}
   */
  static async get(path, opts) {
    try {
      return await Api.request(`/api/admin/${path}`, opts);
    } catch (error) {
      if (this.EXPIRED.test(error.message)) {
        AdminSession.set(false);
        SettingsWindow.render();
      }
      throw error;
    }
  }

  /**
   * POST с телом JSON.
   * @param {string} path
   * @param {object} [body]
   * @returns {Promise<*>}
   */
  static post(path, body) {
    return this.get(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body || {}),
    });
  }
}

/** Окна подтверждения, выбора и формы поверх «Настроек». */
export class AdminDialog {
  static DANGER = /Удал|Откат/;

  /**
   * Подтверждение.
   * @param {string} title
   * @param {string} text
   * @param {string} ok надпись кнопки
   * @returns {Promise<*>}
   */
  static confirm(title, text, ok) {
    return Modal.ask(
      `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary${this.DANGER.test(ok) ? ' danger-bg' : ''}" type="button" data-v="1">${esc(ok)}</button></div>`,
    );
  }

  /**
   * Выбор одного из вариантов.
   * @param {string} title
   * @param {Array<[string, string]>} opts [значение, подпись]
   * @returns {Promise<*>}
   */
  static choose(title, opts) {
    const buttons = opts
      .map(([value, label]) => `<button class="btn" type="button" data-v="${value}">${esc(label)}</button>`)
      .join('');
    return Modal.ask(
      `<h3>${esc(title)}</h3><div class="st-choose">${buttons}<button class="btn ghost" type="button" data-v="0">Отмена</button></div>`,
    );
  }

  /**
   * Форма из нескольких полей.
   * @param {string} title
   * @param {Array<Array<string>>} fields [[ключ, подпись, значение, тип]]
   * @returns {Promise<object|null>} {ключ: значение} или null
   */
  static form(title, fields) {
    return new Promise(resolve => {
      let values = null;
      const inputs = fields.map(field => this._field(field)).join('');
      const modal = new Modal(
        `<form method="dialog"><h3>${esc(title)}</h3>${inputs}
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn primary" type="submit">Сохранить</button></div></form>`,
        'st-form',
      );
      modal.$('[data-k]')?.focus();
      modal.$('[data-v="0"]').onclick = () => modal.close();
      modal.$('form').onsubmit = event => {
        event.preventDefault();
        values = {};
        modal.d.querySelectorAll('[data-k]').forEach(input => {
          values[input.dataset.k] = input.value.trim();
        });
        modal.close();
      };
      modal.d.addEventListener('close', () => resolve(values));
    });
  }

  static _field([key, label, value, type]) {
    const control =
      type === 'textarea'
        ? `<textarea data-k="${key}" rows="3">${esc(value ?? '')}</textarea>`
        : `<input type="${type || 'text'}" data-k="${key}" value="${esc(value ?? '')}" autocomplete="off">`;
    return `<label class="f"><span>${esc(label)}</span>${control}</label>`;
  }
}

/** Подписи журнала действий: действия, объекты, значения «было / стало». */
export class AuditLabels {
  static ACT = {
    login: 'Вход в «Настройки»',
    backup_db: 'Копия базы',
    maintain_db: 'Сжатие и проверка базы',
    purge_images: 'Удаление лишних изображений',
    create_admin: 'Новый администратор',
    edit_admin: 'Изменение администратора',
    delete_admin: 'Удаление администратора',
    logout: 'Выход из «Настроек»',
    set_password: 'Смена пароля',
    reset_password: 'Сброс пароля (временный)',
    logout_all: 'Выход на всех устройствах',
    user_logout: 'Выход менеджера',
    delete_attempt: 'Попытка удаления',
    admin_request: 'Запрос без входа',
    kp_status: 'Ход сделки по КП',
    create_deal: 'Новая сделка',
    edit_deal: 'Этап или ответственный сделки',
    link_deal: 'КП перенесено в сделку',
    send_kp: 'Отправка КП по почте',
    edit_settings: 'Изменение настроек',
    edit_template: 'Изменение шаблона',
    create_kp: 'Создание КП',
    edit_kp: 'Изменение КП',
    create_manager: 'Новый менеджер',
    create_supplier: 'Новый поставщик',
    edit_supplier: 'Изменение поставщика',
    delete_supplier: 'Удаление поставщика',
    edit_customs: 'Код ТН ВЭД и пошлина',
    edit_manager: 'Изменение менеджера',
    create_client: 'Новый клиент',
    edit_client: 'Изменение клиента',
    edit_types: 'Категории оборудования',
    submit_edit: 'Правка на модерацию',
    edit_product: 'Правка товара',
    create_product: 'Новый товар',
    price_sync: 'Цены из КП',
    approve_edit: 'Правка одобрена',
    reject_edit: 'Правка отклонена',
    rollback_edit: 'Откат правки',
    toggle_moderation: 'Режим модерации',
    update_install: 'Установка обновления',
    rollback_settings: 'Откат изменения настроек',
    update_rollback: 'Откат обновления',
    update_remove: 'Обновление убрано',
    restart: 'Перезапуск программы',
    toggle_user_login: 'Вход менеджеров по паролю',
    edit_ai: 'Нейросеть в программе',
    edit_access: 'Доступ менеджера',
    delete_kp: 'Удаление КП',
    delete_catalog: 'Удаление товара',
    delete_manager: 'Удаление менеджера',
    delete_client: 'Удаление клиента',
    restore: 'Восстановление из корзины',
    purge_trash: 'Очистка корзины',
    export_db: 'Экспорт базы',
    import_db: 'Импорт базы',
    export_keys: 'Копия ключей API',
    import_feed: 'Загрузка фида в каталог',
    check_feed: 'Проверка РРЦ и наличия по фиду',
    add_kp_file: 'Документ к КП прикреплён',
    edit_kp_file: 'Примечание к документу КП',
    delete_kp_file: 'Документ КП удалён',
    add_deal_file: 'Документ к сделке прикреплён',
    delete_deal_file: 'Документ сделки удалён',
  };

  static ENT = {
    supplier: 'Поставщик',
    customs: 'ТН ВЭД',
    product: 'Товар',
    catalog: 'Товар',
    kp: 'КП',
    deal: 'Сделка',
    manager: 'Менеджер',
    client: 'Клиент',
    settings: 'Настройки',
    template: 'Шаблон',
    types: 'Категории',
    admin: 'Администратор',
    user: 'Вход менеджера',
    db: 'База',
    trash: 'Корзина',
    system: 'Программа',
  };

  static ABSENT = '__absent__';
  static TRUNCATED = '__truncated__';

  /**
   * Значение «было / стало» для таблицы.
   * @param {*} value
   * @returns {string}
   */
  static value(value) {
    if (value === this.ABSENT) return '<i class="muted">нет</i>';
    if (value && typeof value === 'object' && this.TRUNCATED in value) {
      return `<i class="muted">большое значение (${value[this.TRUNCATED]} знаков)</i>`;
    }
    return `<pre>${esc(typeof value === 'string' ? value : JSON.stringify(value, null, 1))}</pre>`;
  }
}
