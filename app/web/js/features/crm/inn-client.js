import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';

/** Клиент по ИНН: вписали в поле «Клиент» 10 или 12 цифр — программа находит его в справочнике или в ФНС сама. */
export class InnClient {
  static INN = /^\d{10}(\d{2})?$/;

  /**
   * Похоже на ИНН (10 или 12 цифр, пробелы не мешают).
   * @param {string} text
   * @returns {boolean}
   */
  static looks(text) {
    return this.INN.test(String(text || '').replace(/\s/g, ''));
  }

  /**
   * Найти или завести клиента по ИНН.
   * @param {string} inn
   * @returns {Promise<{id: string, name: string, inn: string, address: string}|null>} null — не нашли (сообщение уже показано)
   */
  static async find(inn) {
    try {
      return await Api.request('/api/crm/client/inn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ inn: String(inn).replace(/\s/g, '') }),
      });
    } catch (error) {
      Toast.show(`Клиент по ИНН не найден: ${error.message}`);
      return null;
    }
  }
}
