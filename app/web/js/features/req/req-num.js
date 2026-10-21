import { esc } from '../../core/util.js';
/**
 * Числа в требованиях станции: один разбор для полей требований, расчёта и подбора (запятая или точка, пробелы между
 * разрядами, минус любого вида, «+» впереди) и допустимые значения. Ошибка — под полем, в расчёт значение не идёт.
 */
export class ReqNum {
  // ключ → [наименьшее, наибольшее, единица]; диапазоны заведомо шире реальных станций — отсекают опечатки
  static RANGE = {
    flow: [0.05, 500, 'м³/мин'],
    pressure: [0.5, 40, 'бар'],
    margin: [0, 100, '%'],
    alt: [-100, 5000, 'м'],
    rh: [0, 100, '%'],
    tin: [0, 70, '°C'],
    tmin: [-65, 15, '°C'],
    tmax: [0, 60, '°C'],
    noise: [40, 120, 'дБА'],
    recvVol: [1, 100000, 'л'],
    kw: [1, 20000, 'кВт'],
    hours: [0.5, 720, 'ч'],
    load: [1, 100, '%'],
    motor: [0.1, 5000, 'кВт'],
    q: [0.1, 20000, 'м³/ч'],
    head: [0.5, 2500, 'м'],
    hsuct: [-10, 8, 'м'],
    tliq: [1, 100, '°C'],
    gateOff: [-1500, 1500, 'мм'],
    recvDp: [0.1, 5, 'бар'],
    recvT: [0.05, 120, 'мин'],
    recvC: [0.05, 500, 'м³/мин'],
    recvDrop: [0.1, 5, 'бар'],
    recvPoint: [0.01, 500, 'м³/мин'],
    recvValve: [1, 40, 'бар'],
    ventK: [0.5, 1, ''],
    ventTin: [20, 60, '°C'],
    ventDt: [1, 40, '°C'],
    ventDtc: [5, 30, '°C'],
    ventVin: [0.5, 8, 'м/с'],
    ventVout: [0.5, 10, 'м/с'],
    ventRes: [1, 2, ''],
    ventU: [0.1, 6, 'Вт/(м²·°C)'],
    ventFan: [1, 1e6, 'м³/ч'],
    ventEta: [0.3, 0.95, ''],
    ventTexh: [0, 40, '°C'],
    ventPhi: [5, 100, '%'],
    ventDays: [0, 365, 'сут'],
    ventTavg: [-40, 8, '°C'],
  };

  static LABEL = {
    flow: 'Производительность',
    pressure: 'Давление',
    margin: 'Запас производительности',
    alt: 'Высота над уровнем моря',
    rh: 'Влажность воздуха',
    tin: 'Воздух на входе в осушитель',
    tmin: 'Наружный воздух от',
    tmax: 'Наружный воздух до',
    noise: 'Шум на рабочем месте',
    recvVol: 'Ресивер по ТЗ',
    kw: 'Мощность нагрузки',
    hours: 'Работа без дозаправки',
    load: 'Средняя нагрузка',
    motor: 'Наибольший двигатель нагрузки',
    q: 'Подача',
    head: 'Напор',
    hsuct: 'Высота всасывания',
    tliq: 'Температура жидкости',
    gateOff: 'Смещение ворот от оси торца',
    recvDp: 'ΔP нагрузка/разгрузка',
    recvT: 'Длительность пика',
    recvC: 'Расход в пике',
    recvDrop: 'Допустимый перепад в ресивере',
    recvPoint: 'Пиковый расход точки',
    recvValve: 'Уставка предохранительного клапана',
    ventK: 'k',
    ventTin: 't_вн летом',
    ventDt: 'Δt помещения',
    ventDtc: 'Нагрев воздуха в компрессоре',
    ventVin: 'Скорость притока',
    ventVout: 'Скорость выброса',
    ventRes: 'Запас притока',
    ventU: 'U стенки',
    ventFan: 'Вытяжной вентилятор',
    ventEta: 'КПД рекуператора',
    ventTexh: 't выбросного воздуха',
    ventPhi: 'Влажность выбросного воздуха',
    ventDays: 'Отопительный период',
    ventTavg: 'Средняя температура периода',
  };

  static NUMBER = /^-?\d+(?:[.,]\d+)?$/;
  static TWO_SEPARATORS = /[.,].*[.,]/;

  /**
   * Разбор числа.
   * @param {*} value
   * @returns {{n: number|null, bad: string}} n — число или null, bad — текст ошибки ('' — нет)
   */
  static parse(value) {
    const text = String(value ?? '')
      .trim()
      .replace(/[   ]+/g, '')
      .replace(/[−–—]/g, '-')
      .replace(/^\+/, '');
    if (!text) return { n: null, bad: '' };
    if (!this.NUMBER.test(text)) return { n: null, bad: this._why(text) };
    return { n: parseFloat(text.replace(',', '.')), bad: '' };
  }

  static _why(text) {
    return this.TWO_SEPARATORS.test(text) ? 'неоднозначная запись числа — один десятичный разделитель' : 'нужно число';
  }

  /**
   * Число или null (пусто или ошибка).
   * @param {*} value
   * @returns {number|null}
   */
  static num(value) {
    return this.parse(value).n;
  }

  /**
   * Число со знаком из текста, где минус может быть «−» или «–», а плюс — впереди (температуры, высота, смещение).
   * @param {*} value
   * @returns {number|null}
   */
  static loose(value) {
    return this.num(
      String(value ?? '')
        .replace(/[−–]/g, '-')
        .replace(/^\+/, ''),
    );
  }

  /**
   * Число для текста: десятичная запятая.
   * @param {number} value
   * @returns {string}
   */
  static comma(value) {
    return String(value).replace('.', ',');
  }

  /**
   * Ошибка поля: '' — нет.
   * @param {string} key
   * @param {*} value
   * @returns {string}
   */
  static check(key, value) {
    const parsed = this.parse(value);
    if (parsed.bad) return parsed.bad;
    if (parsed.n == null) return '';
    const range = this.RANGE[key];
    if (!range) return '';
    const [low, high, unit] = range;
    if (parsed.n >= low && parsed.n <= high) return '';
    return `от ${this.comma(low)} до ${this.comma(high)}${unit ? ` ${unit}` : ''}`;
  }

  /**
   * Все ошибки требований станции.
   * @param {object} item позиция КП
   * @returns {{key: string, label: string, text: string}[]}
   */
  static errors(item) {
    const req = (item && item.req) || {};
    const out = [];
    for (const key of Object.keys(this.RANGE)) {
      const text = this.check(key, req[key]);
      if (text) out.push({ key, label: this.LABEL[key] || key, text });
    }
    return out;
  }

  /**
   * Для поля ввода: класс и подпись ошибки под полем.
   * @param {object} item
   * @param {string} key
   * @returns {{cls: string, msg: string}}
   */
  static mark(item, key) {
    const text = this.check(key, ((item && item.req) || {})[key]);
    return text ? { cls: ' bad', msg: `<small class="f-err">${esc(text)}</small>` } : { cls: '', msg: '' };
  }
}
