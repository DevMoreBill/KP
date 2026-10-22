import { ServerLink } from './server-link.js';
import { CopyText, FileSave } from './files.js';
import { Toast } from './toast.js';
import { Auth } from '../features/kp/auth.js';
import { AuthScreen } from '../features/kp/auth-screen.js';
import { S } from './state.js';
import { Managers } from '../features/kp/managers.js';
import { StDirty } from '../features/admin/settings-tools.js';
import { DefRegistry } from './defaults.js';

/** Сервер программы: отвечает ли (on) и что о себе сообщил (/api/ping). */
export class Srv {
  // eslint-disable-next-line id-length -- прежнее имя (SRV.on)
  static on = false;
  static info = null;
}

/**
 * Сессия «Настроек» (администратор): CSRF-токен для изменяющих запросов (cookie сессии ставит сервер). Вход и выход — через
 * set: о смене узнают те, кто показывает пункты только администратору (событие kp:admin).
 */
export class AdminSession {
  // eslint-disable-next-line id-length -- прежнее имя (ADMIN.on), им пользуются все разделы
  static on = false;
  static csrf = '';

  /**
   * @param {*} isOn
   * @param {string} [csrf]
   */
  static set(isOn, csrf) {
    const was = this.on;
    this.on = !!isOn;
    this.csrf = this.on ? csrf || '' : '';
    if (was !== this.on) document.dispatchEvent(new Event('kp:admin'));
  }
}

/** Запросы к серверу программы; каждый подписан менеджером этого устройства — для журнала действий (это не вход). */
export class Api {
  static CONFLICT = 409;
  static FORBIDDEN = 403;
  static UNAUTHORIZED = 401;
  // проверки и предпросмотр — не сохранение: отметка «несохранённые изменения» в «Настройках» остаётся
  static NOT_SAVE = /\/(preview|test|check|pdf)\b|\/connections\b/;
  /** запросов в пути: переключение КП ждёт, пока ответы допишут своё в то КП, которое их начало */
  static flying = 0;

  /**
   * @param {string} path
   * @param {{method?: string, headers?: object, body?: *, raw?: boolean, retried?: boolean}} [opts] raw — ответ целиком
   *   (файл выгрузки: blob и имя из заголовка)
   * @returns {Promise<*>}
   */
  static async request(path, opts = {}) {
    this.flying++;
    try {
      return await this._request(path, opts);
    } finally {
      this.flying--;
    }
  }

  static async _request(path, opts) {
    const headers = { ...(opts.headers || {}), ...this._signature() };
    if (AdminSession.csrf) headers['X-CSRF-Token'] = AdminSession.csrf;
    let reply;
    try {
      reply = await fetch(path, { ...opts, headers });
    } catch (error) {
      ServerLink.gone();
      throw new Error('нет связи с сервером отдела', { cause: error });
    }
    ServerLink.back();
    if (reply.status === this.CONFLICT) {
      const retried = await this._conflict(reply, path, opts);
      if (retried) return retried.value;
    }
    this._auth(reply, path);
    return this._result(reply, path, opts);
  }

  static async _result(reply, path, opts) {
    if (!reply.ok) {
      const err = new Error((await reply.text()) || `HTTP ${reply.status}`);
      err.status = reply.status;
      throw err;
    }
    if ((opts.method || 'GET') !== 'GET' && !this.NOT_SAVE.test(path)) StDirty.saved();
    if (opts.raw) return reply;
    const type = reply.headers.get('content-type') || '';
    return type.includes('json') ? reply.json() : reply.text();
  }

  // кто работает на этом устройстве (meId), а не менеджер открытого КП
  static _signature() {
    const userId = Managers.meId();
    const name = userId ? Managers.meName() : '';
    return {
      'X-KP-User-Id': encodeURIComponent(userId || S.managerId || ''),
      'X-KP-User': encodeURIComponent(name || (S.manager && S.manager.name) || ''),
    };
  }

  // запись успели изменить, пока она была открыта: спросить, перезаписать ли
  static async _conflict(reply, path, opts) {
    let info = null;
    try {
      info = await reply.clone().json();
    } catch {
      // не JSON — обычная ошибка ниже
    }
    if (!info || !info.conflict) return null;
    if (!opts.retried && this.ask(info, path)) {
      const value = await this.request(path, {
        ...opts,
        retried: true,
        headers: { ...(opts.headers || {}), 'X-KP-Rev': String(info.rev) },
      });
      return { value };
    }
    const err = new Error(
      `не сохранено — запись уже изменил(а) ${info.by || 'другой пользователь'}. Откройте её заново, чтобы увидеть изменения`,
    );
    err.code = 'conflict';
    err.info = info;
    throw err;
  }

  static _auth(reply, path) {
    if (reply.status === this.FORBIDDEN && reply.headers.get('X-KP-Auth') === 'change-password') AuthScreen.change();
    if (reply.status === this.UNAUTHORIZED && Auth.state.enabled && !/^\/api\/(admin|auth)\//.test(path)) {
      AuthScreen.show('Сессия закончилась — войдите снова.');
    }
  }

  static _time(when) {
    const date = new Date(when);
    if (isNaN(date)) return '';
    return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Запись изменили после того, как её открыли у нас: спросить, сохранить ли свою версию поверх.
   * @param {{by?: string, at?: string}} info
   * @param {string} path
   * @returns {boolean}
   */
  static ask(info, path) {
    const isKp = /^\/api\/kp\//.test(path);
    const time = this._time(info.at);
    const what = isKp ? 'Это КП' : 'Эту запись';
    const when = isKp ? ', пока оно было открыто у вас.' : ', пока она была открыта у вас.';
    return confirm(
      `${what} уже изменил(а) ${info.by || 'другой пользователь'}${time ? ` (${time})` : ''}${when}\n\n` +
        `ОК — сохранить вашу версию поверх${isKp ? ' (версия коллеги останется в «Истории версий» КП)' : ''}.\n` +
        `Отмена — не сохранять: откройте ${isKp ? 'КП из журнала' : 'запись заново'}, чтобы увидеть изменения.`,
    );
  }
}

/**
 * Картинка из data: — файлом на сервер (папка картинок); place — что это за изображение (imgPlace): категория,
 * производитель, модель — папку выбирает сервер; пометки картинки (3D-вид станции: gen, hash) сохраняются.
 */
export class ImgUpload {
  /**
   * @param {{src: string}} img
   * @param {object} [place]
   * @returns {Promise<object>}
   */
  static async put(img, place) {
    if (!img || !String(img.src).startsWith('data:')) return img;
    const ext = img.src.startsWith('data:image/png') ? 'png' : 'jpg';
    const params = Object.entries(place || {})
      .map(([key, value]) => `&${key}=${encodeURIComponent(value || '')}`)
      .join('');
    const query = `ext=${ext}${params}`;
    const reply = await Api.request(`/api/img?${query}`, { method: 'POST', body: await FileSave.blob(img.src) });
    return { ...img, src: `/img/${reply.name}` };
  }
}

/** Ответ сервера на «Открыть файл / папку» при работе по сети: скачать файл, показать путь к папке на сервере. */
export class RemoteResult {
  static IFRAME_MS = 60000;

  /** @param {{remote?: boolean, download?: string, share?: string}} reply */
  static show(reply) {
    if (!reply || !reply.remote) return;
    if (reply.download) this._download(reply.download);
    if (reply.share) {
      CopyText.copy(reply.share).then(ok =>
        Toast.show(
          `${reply.download ? 'Файл скачан. ' : ''}Папка на сервере: ${reply.share}${ok ? ' (путь скопирован — вставьте в проводник)' : ''}`,
        ),
      );
    } else if (!reply.download) {
      Toast.show(
        'Папка КП находится на компьютере-сервере отдела. Попросите администратора указать docsShare в settings.json.',
      );
    }
  }

  static _download(url) {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.src = url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), this.IFRAME_MS);
  }
}

/** «Значения программы» администратора с сервера; сервер недоступен — остаются значения из браузера. */
export class ServerDefaults {
  /** @returns {Promise<void>} */
  static load() {
    return Api.request('/api/defaults')
      .then(reply => DefRegistry.use(reply))
      .catch(() => {});
  }
}
