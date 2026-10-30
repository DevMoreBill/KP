import { Kit } from './kit.js';
import { StationReq } from '../req/station-req.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationGeo } from '../layout/station-geo.js';
import { FEAT } from '../../core/features.js';

/**
 * Компоновка станции в позиции КП: исходные (контейнер, состав, класс воздуха, ресивер), расчёт с кэшем по отпечатку,
 * что вставлять в КП. Её берут состав, подбор, расчёты, ТЗ и форма — без окна «Компоновка» (циклы import).
 */
export class StationPlan {
  static cache = new Map();
  static GRADE = /^[1-6]\.[1-6]\.[1-4]$/;
  static SHEETS_MAX = 10;
  // виды снаружи: ключ, азимут камеры, подпись
  static VIEWS = [
    ['front', 18, 'Вид спереди'],
    ['right', -72, 'Вид справа'],
    ['back', -162, 'Вид сзади'],
    ['left', 72, 'Вид слева'],
  ];

  /**
   * Функция включена, позиция — станция в контейнере.
   * @param {object} item
   * @returns {boolean}
   */
  static enabled(item) {
    return !!item && !!Kit.station(item) && FEAT.on('stLayout');
  }

  /**
   * Исходные расстановки: контейнер, состав, класс воздуха; где ресивер и снаружи ли — из требований станции.
   * @param {object} item
   * @returns {object}
   */
  static input(item) {
    const req = StationReq;
    return {
      cont: this._cont(Kit.container(item)),
      parts: Kit.parts(item),
      air: this.opts(item).air,
      recv: req ? req.recv(item) : 'after',
      recvOut: req ? req.recvOut(item) : false,
      req: req ? req.plan(item) : null,
    };
  }

  static _cont(container) {
    if (!container) return null;
    return {
      ctype: container.ctype,
      size: container.size,
      sizeAuto: !!container.sizeAuto,
      lenFix: container.lenFix || null,
      mods: container.mods || null,
      ins: container.ins,
      ral: container.ral,
      paint: container.paint || null,
      paintBook: !!container.paintBook,
      art: container.art || null,
      sys: container.sys || null,
      climate: container.climate || '',
      roof: container.roof || '',
      floor: StationGeo.floor(container),
    };
  }

  /**
   * Расстановка — пересчитывается, только когда изменился состав, контейнер или класс чистоты воздуха.
   * @param {object} item
   * @returns {object} план компоновки
   */
  static plan(item) {
    const input = this.input(item);
    const hash = StationLayout.hash(input);
    const key = `${hash}|${input.air}`;
    const cached = this.cache.get(item.id);
    if (cached && cached.k === key) return cached.plan;
    const plan = StationLayout.solve(input);
    plan.hash = hash;
    this.cache.set(item.id, { k: key, plan });
    return plan;
  }

  /**
   * Расстановка, посчитанная подбором размера по тем же исходным с пустым размером, — в кэш: размер «по оборудованию»
   * на расстановку не влияет (только на отпечаток).
   * @param {object} item
   * @param {object} plan
   * @param {string} sizeKey отпечаток исходных с пустым размером и класс воздуха
   */
  static keep(item, plan, sizeKey) {
    const input = this.input(item);
    if (!input.cont || !input.cont.sizeAuto) return;
    if (
      `${StationLayout.hash({ ...input, cont: { ...input.cont, size: '', sizeAuto: true } })}|${input.air}` !== sizeKey
    )
      return;
    const hash = StationLayout.hash(input);
    plan.hash = hash;
    this.cache.set(item.id, { k: `${hash}|${input.air}`, plan });
  }

  /**
   * Оборудование не помещается — КП не сохраняется; по условным габаритам — только предупреждение.
   * @param {object} item
   * @returns {boolean}
   */
  static blocked(item) {
    if (!this.enabled(item) || !Kit.has(item)) return false;
    const plan = this.plan(item);
    return plan.level === 'error' && !plan.assumed;
  }

  /**
   * Что вставлять в КП: 3D-вид главным фото, чертёж и виды снаружи — в изображения (по умолчанию да, кроме убранных
   * менеджером), схема и расчётная записка — только если включили; класс чистоты воздуха.
   * @param {object} item
   * @returns {object}
   */
  static opts(item) {
    const own = item.stLayout || {};
    return {
      photo: own.photo !== false,
      out: own.out !== false,
      draw: own.draw !== false,
      scheme: own.scheme === true,
      calc: own.calc === true,
      air: this.GRADE.test(String(own.air || '')) ? own.air : '',
      skip: Array.isArray(own.skip)
        ? own.skip.filter(sheet => Number.isInteger(sheet) && sheet > 0 && sheet < this.SHEETS_MAX)
        : [],
      outSkip: Array.isArray(own.outSkip) ? own.outSkip.filter(view => this.VIEWS.some(row => row[0] === view)) : [],
    };
  }
}
