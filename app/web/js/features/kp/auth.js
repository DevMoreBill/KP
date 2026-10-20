/**
 * Вход менеджеров по логину и паролю (включает администратор: «Настройки → Менеджеры и доступ»). Выключен — менеджер
 * выбирается на устройстве; права (каталог, чужие КП, экономика) проверяет сервер, здесь — только скрываем лишнее.
 */
export class Auth {
  static PW_MIN = 4;
  static state = {
    enabled: false,
    user: null,
    admin: false,
    perms: [],
    shown: false,
    help: '',
    sessionDays: 0,
    shortHours: 0,
    pwMin: Auth.PW_MIN,
  };
  static TEXT = {
    catAdd: 'добавлять оборудование',
    catEdit: 'редактировать оборудование',
    kpOthers: 'открывать КП других менеджеров',
    dealView: 'смотреть экономику сделки',
    catDelete: 'удалять товары',
    catSelfMod: 'принимать правки других и править справочник поставщиков',
    export: 'выгружать каталог и клиентов',
  };

  /** Состояние входа с сервера. */
  static async load() {
    try {
      const answer = await api('/api/auth/status');
      Object.assign(this.state, {
        enabled: !!answer.enabled,
        user: answer.user || null,
        admin: !!answer.admin,
        perms: answer.perms || [],
        help: answer.help || '',
        sessionDays: answer.sessionDays || 0,
        shortHours: answer.shortHours || 0,
        pwMin: answer.pwMin || this.PW_MIN,
      });
    } catch {
      // без сервера — вход выключен
    }
  }

  /**
   * Право менеджера: при выключенном входе и у администратора — всё можно; особые права (Powers.STRICT) — только
   * администратору и менеджеру, вошедшему по паролю, которому их выдали.
   * @param {string} perm
   * @returns {boolean}
   */
  static can(perm) {
    const state = this.state;
    if (state.admin || ADMIN.on) return true;
    if (Powers.STRICT.includes(perm)) return Powers.has(perm);
    if (!state.enabled) return true;
    return !!(state.user && state.user.perms && state.user.perms[perm]);
  }

  /**
   * Сообщение «нет права».
   * @param {string} perm
   */
  static cannot(perm) {
    toast(`Нет права ${this.TEXT[perm] || perm} — обратитесь к администратору`);
  }
}

/**
 * Особые права менеджеров («Настройки → Менеджеры»): удалять товары (в корзину), правки без модерации, выгрузка каталога
 * и клиентов. Сервер проверяет их сам; здесь — показать или скрыть кнопки.
 */
export class Powers {
  static STRICT = ['catDelete', 'catSelfMod', 'export'];

  /**
   * Есть ли особое право.
   * @param {string} perm
   * @returns {boolean}
   */
  static has(perm) {
    const state = Auth.state;
    return state.admin || ADMIN.on || !!(state.enabled && state.user && state.user.perms && state.user.perms[perm]);
  }
}
