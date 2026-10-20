import { StationReq } from './station-req.js';

/**
 * Значения режима «эксперт» (вентиляция, ворота): у заданного вручную — отметка и сброс к инженерным правилам; каждая
 * правка — в журнал станции (когда, кто, что было и стало; хранится в КП, последние MAX записей).
 */
export class ExpertLog {
  static MAX = 40;
  static TEXT_MAX = 300;
  static WHO_MAX = 80;
  static GATE = ['gateOff', 'gateWhy'];
  static LABEL = {
    hrvType: 'Тип рекуператора',
    gateOff: 'Смещение ворот от оси торца, мм',
    gateWhy: 'Причина смещения ворот',
  };

  /**
   * Ключи вентиляции режима «эксперт».
   * @returns {string[]}
   */
  static VENT() {
    return [...StationReq.VENT.map(row => row[0]), 'hrvType'];
  }

  /**
   * Все ключи режима «эксперт».
   * @returns {string[]}
   */
  static keys() {
    return [...this.VENT(), ...this.GATE];
  }

  /**
   * Подпись значения для журнала.
   * @param {string} key
   * @returns {string}
   */
  static label(key) {
    const vent = StationReq.VENT.find(row => row[0] === key);
    return vent ? vent[2] : this.LABEL[key] || key;
  }

  /**
   * Значение задано вручную.
   * @param {object} req
   * @param {string} key
   * @returns {boolean}
   */
  static set(req, key) {
    return req[key] != null && String(req[key]).trim() !== '';
  }

  static _snap(req) {
    const out = {};
    for (const key of this.keys()) {
      if (this.set(req, key)) out[key] = String(req[key]).trim().slice(0, this.TEXT_MAX);
    }
    return out;
  }

  static _stamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  /**
   * Записать отличия от прошлого снимка (первый раз — только снимок: значения прежних версий не считаются правкой).
   * @param {object} item позиция КП
   */
  static note(item) {
    const req = StationReq.ensure(item);
    const now = this._snap(req);
    if (!req._xs || typeof req._xs !== 'object') {
      req._xs = now;
      return;
    }
    const was = req._xs;
    const who = String((S.manager && S.manager.name) || '')
      .trim()
      .slice(0, this.WHO_MAX);
    const time = this._stamp();
    const log = Array.isArray(req.xlog) ? req.xlog : [];
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (was[key] !== now[key]) log.push({ t: time, k: key, from: was[key] ?? '', to: now[key] ?? '', who });
    }
    req.xlog = log.slice(-this.MAX);
    req._xs = now;
  }

  /**
   * Вернуть значения к инженерным правилам.
   * @param {object} item
   * @param {string[]} keys
   */
  static reset(item, keys) {
    const req = StationReq.ensure(item);
    const known = new Set(this.keys());
    if (!req._xs) req._xs = this._snap(req);
    for (const key of keys) if (known.has(key)) delete req[key];
    this.note(item);
  }

  /**
   * Под полем: «вручную · по правилам» (кнопка сброса); не задано — ''.
   * @param {object} item
   * @param {number} index позиция КП
   * @param {string} key
   * @returns {string}
   */
  static mark(item, index, key) {
    if (!this.set(StationReq.of(item), key)) return '';
    return `<small class="f-src">вручную · <button class="lnk" type="button" data-a="reqReset" data-i="${index}" data-k="${esc(key)}" title="Вернуть значение инженерных правил">по правилам</button></small>`;
  }

  /**
   * Низ блока: сбросить всё заданное вручную; журнал правок этого блока.
   * @param {object} item
   * @param {number} index
   * @param {string[]} keys
   * @returns {string}
   */
  static foot(item, index, keys) {
    const req = StationReq.of(item);
    const manual = keys.filter(key => this.set(req, key));
    const log = (Array.isArray(req.xlog) ? req.xlog : []).filter(entry => keys.includes(entry.k));
    if (!manual.length && !log.length) return '';
    const reset = manual.length
      ? `<button class="btn ghost sm" type="button" data-a="reqReset" data-i="${index}" data-k="${esc(manual.join(','))}">Всё по правилам (задано вручную: ${manual.length})</button>`
      : '';
    return `<div class="kr-xp">${reset}
      ${log.length ? `<details class="kr-log"><summary>Журнал правок (${log.length})</summary><ul>${this._entries(log)}</ul></details>` : ''}</div>`;
  }

  static _entries(log) {
    return log
      .slice()
      .reverse()
      .map(
        entry =>
          `<li><span class="muted">${esc(entry.t)}${entry.who ? ` · ${esc(entry.who)}` : ''}</span> ${esc(this.label(entry.k))}: ${esc(entry.from || 'по правилам')} → ${esc(entry.to || 'по правилам')}</li>`,
      )
      .join('');
  }
}
