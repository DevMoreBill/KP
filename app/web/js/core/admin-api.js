import { AdminSession, Api } from './net.js';

/** Запросы «Настроек» к серверу (/api/admin/…): сессия истекла — снова форма входа. */
export class AdminApi {
  static EXPIRED = /сессия|Войдите/;

  /** Сессия истекла — перерисовать «Настройки» (форма входа): подключает раздел «Настройки» (admin/index.js). */
  static onExpired = () => {};

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
        this.onExpired();
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
