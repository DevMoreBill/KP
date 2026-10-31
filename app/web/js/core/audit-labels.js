import { esc } from './util.js';

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
    edit_admin_rights: 'Права администратора',
    admin_denied: 'Отказ: нет прав администратора',
    access_denied: 'Отказ: чужое КП или сделка',
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
    transfer_kp: 'Передача КП другому менеджеру',
    edit_others_kp: 'Правка чужого КП',
    delete_catalog: 'Удаление товара',
    delete_manager: 'Удаление менеджера',
    delete_client: 'Удаление клиента',
    delete_deal: 'Удаление сделки',
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
    delete_contact: 'Удаление контакта клиента',
    edit_lists: 'Списки выбора',
    edit_defaults: 'Значения программы',
    export_settings: 'Выгрузка файла настроек',
    import_settings: 'Загрузка файла настроек',
    db_health: 'Проверка базы',
    export_clients: 'Выгрузка клиентов',
    export_catalog: 'Выгрузка каталога',
    preset_add: 'Новая заготовка КП',
    preset_delete: 'Удаление заготовки КП',
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
    images: 'Изображения',
    preset: 'Заготовка КП',
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
