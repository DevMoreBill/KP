import { ContainerPart } from './container-part.js';
import { KitPipe } from './kit-fields.js';
import { StationReq } from '../req/station-req.js';
import { CalcInput } from '../calc/calc-input.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationRules } from '../rules/station-rules.js';
import { Kit } from '../../core/kit.js';
import { ContainerKind } from '../layout/container-kind.js';

/**
 * Элементы станции, без которых её не бывает: мастер кладёт их в состав сразу (ДГУ — глушитель на крыше, дополнительный
 * топливный бак, топливопровод; насосная и компрессорная — трубопроводная обвязка); новый элемент с узнаваемым названием
 * получает описание. Расход топлива, нагрузка, запас и типовые баки — правила `dgu.*` (`stations.json`).
 */
export class StationDefaults {
  static TANKS_DEFAULT = [500, 1000, 1500, 2000, 3000];
  static HOURS_DEFAULT = 16;
  static LPH_DEFAULT = 0.25;
  static LOAD_DEFAULT = 0.75;
  static MARGIN_DEFAULT = 1.1;
  static TANK_STEP = 500;
  static TANK_NO_DGU = 1000;
  static PERCENT = 100;
  static FUEL = /топливн\S* бак|дополнительн\S* бак|бак топлив/i;
  static PIPING = 'Трубопроводная обвязка и запорная арматура';
  /** вид станции → обязательные элементы [название, материал трубопровода] */
  static REQUIRED = {
    st_dgu: [['Глушитель на крыше'], ['Дополнительный топливный бак'], ['Топливопровод и запорная арматура', 'steel']],
    st_pump: [[StationDefaults.PIPING]],
    st_comp: [[StationDefaults.PIPING]],
  };
  static TEXT = [
    [
      /глушител/i,
      'Глушитель выхлопа на крыше контейнера, на опорах: сильфонный компенсатор, термоизоляция выхлопной трубы, дождевой колпак. На время перевозки снимается.',
      [['Установка', 'на крыше контейнера']],
    ],
    [
      StationDefaults.FUEL,
      'Дополнительный топливный бак для увеличения времени автономной работы ДГУ: датчик уровня, заливная горловина, дыхательный клапан, поддон, подключение к топливной системе ДГУ.',
      [],
    ],
    [
      /трубопровод|топливопровод|обвязк/i,
      'Трубопроводная обвязка оборудования станции: магистраль, отводы к оборудованию, запорная арматура, крепления. Материал труб и условный проход — в составе станции.',
      [],
    ],
    [
      /асу ?тп/i,
      'Шкаф АСУ ТП: контроллер, панель оператора, сбор сигналов и аварий оборудования станции, архив событий, передача данных в диспетчерскую.',
      [['Связь с диспетчерской', 'Modbus TCP / Ethernet или GSM — по проекту']],
    ],
    [
      /(?:^|[^а-яё])АВР(?![а-яё])|ввод\S* резерв/i,
      'Шкаф автоматического ввода резерва: переключение питания станции на резервный ввод при пропадании основного, индикация, ручной режим.',
      [['Вводы', 'основной и резервный']],
    ],
  ];

  /** типовые объёмы дополнительного бака, л (правило dgu.tank_sizes) */
  static get TANKS() {
    const sizes = StationRules.ok() ? StationRules.opt('dgu.tank_sizes') : null;
    return Array.isArray(sizes) && sizes.length ? sizes : this.TANKS_DEFAULT;
  }

  /** время работы от бака по умолчанию, ч (правило dgu.tank_hours) */
  static get HOURS() {
    const hours = StationRules.ok() ? StationRules.opt('dgu.tank_hours') : null;
    return hours > 0 ? hours : this.HOURS_DEFAULT;
  }

  /** расход топлива, л на кВт·ч */
  static get LPH() {
    return StationRules.ok() ? StationRules.raw('dgu.lph') : this.LPH_DEFAULT;
  }

  /** нагрузка по умолчанию */
  static get LOAD() {
    return StationRules.ok() ? StationRules.raw('dgu.fuel_load') : this.LOAD_DEFAULT;
  }

  /** запас топлива (недоступный остаток) */
  static get MARGIN() {
    return StationRules.ok() ? StationRules.raw('dgu.fuel_margin') : this.MARGIN_DEFAULT;
  }

  /**
   * Сколько часов работы даёт объём, л, при расходе perHour, л/ч: с тем же запасом, что при подборе бака, с округлением вниз.
   * @param {number} volume
   * @param {number} perHour
   * @returns {number}
   */
  static hours(volume, perHour) {
    return perHour > 0 ? Math.floor(volume / this.MARGIN / perHour) : 0;
  }

  /**
   * Мастер станции: обязательные элементы по виду станции.
   * @param {object} item
   * @param {string} typeId
   */
  static add(item, typeId) {
    const parts = item.kit.parts;
    for (const [name, pipeMat] of this.REQUIRED[typeId] || []) {
      const part = this.part(item, name);
      if (pipeMat) {
        part.pipeMat = pipeMat;
        KitPipe.rows(part);
      }
      parts.push(part);
    }
    const container = parts.find(part => part.role === 'container');
    // насосы почти не греют — рекуперация не нужна
    if (container && typeId === 'st_pump') {
      container.sys = { ...(container.sys || ContainerKind.SYSTEMS_ON), rec: false };
      ContainerPart.apply(container);
    }
  }

  /**
   * Новый элемент с описанием.
   * @param {object} item
   * @param {string} name
   * @returns {object}
   */
  static part(item, name) {
    const part = Kit.newPart({ name });
    this.fill(part, item);
    return part;
  }

  /**
   * Шкафы АВР и АСУ ТП по требованиям — добавить, если их нет.
   * @param {object} item
   * @returns {string[]} названия добавленного
   */
  static ensureParts(item) {
    const req = StationReq.of(item);
    const parts = Kit.parts(item);
    const added = [];
    const has = pattern => parts.some(part => pattern.test(String(part.name || '')));
    if (req.ats && !has(StationReq.ATS)) {
      const part = this.part(item, 'Шкаф АВР (автоматический ввод резерва)');
      part.attrs = { cat: 'ats' };
      parts.push(part);
      added.push(part.name);
    }
    if (req.scada && !has(StationReq.SCADA)) {
      const part = this.part(item, 'Шкаф АСУ ТП (автоматизация и диспетчеризация)');
      parts.push(part);
      added.push(part.name);
    }
    return added;
  }

  /**
   * Элемент с узнаваемым названием — описание и строки характеристик (своё не перезаписывается).
   * @param {object} part
   * @param {object} item
   * @returns {object}
   */
  static fill(part, item) {
    const text = this.TEXT.find(([pattern]) => pattern.test(String(part.name || '')));
    if (!text) return part;
    if (!String(part.desc || '').trim()) part.desc = text[1];
    part.rows = part.rows || [];
    for (const [k, v] of text[2]) if (!part.rows.some(row => row.k === k)) part.rows.push({ k, v });
    if (this.FUEL.test(part.name) && !part.rows.some(row => /объ[её]м/i.test(row.k))) this._fuelRows(part, item);
    return part;
  }

  static _fuelRows(part, item) {
    const power = this.kw(item);
    const volume = this.tank(power);
    part.rows.push({ k: 'Объём', v: `${volume} л` });
    if (power) part.rows.push(this._workRow(volume, power));
  }

  static _workRow(volume, power) {
    return {
      k: `Время работы ДГУ от бака при нагрузке ${Math.round(this.LOAD * this.PERCENT)} %`,
      v: `около ${this.hours(volume, this.perHour(power))} ч`,
    };
  }

  /**
   * Мощность ДГУ станции, кВт.
   * @param {object} item
   * @returns {number|null}
   */
  static kw(item) {
    const dgu = Kit.parts(item).find(part => StationEquip.kindOf(part) === 'dgu');
    return dgu ? CalcInput.num((dgu.attrs || {}).kw) : null;
  }

  /**
   * Объём бака, л: на hours ч работы при нагрузке по умолчанию с запасом топлива, как в расчёте станции (GensetSizing),
   * ближайший типовой (больше типовых — кратно 500 л).
   * @param {number} power кВт
   * @param {number} [hours]
   * @returns {number}
   */
  static tank(power, hours = this.HOURS) {
    if (!(power > 0)) return this.TANK_NO_DGU;
    return this._typical(this.perHour(power) * hours * this.MARGIN);
  }

  /**
   * Расход топлива рабочих ДГУ мощностью power при нагрузке по умолчанию, л/ч.
   * @param {number} power кВт
   * @returns {number}
   */
  static perHour(power) {
    return power * this.LOAD * this.LPH;
  }

  static _typical(need) {
    return this.TANKS.find(size => size >= need) || Math.ceil(need / this.TANK_STEP) * this.TANK_STEP;
  }

  /**
   * Бак станции — под время работы из требований (ТЗ): объём и строка «время работы».
   * @param {object} item
   * @param {number} hours
   * @returns {number|null} объём, л
   */
  static retank(item, hours) {
    const part = Kit.parts(item).find(line => this.FUEL.test(String(line.name || '')));
    const tank = part ? this.tankFor(item, hours) : null;
    if (!tank) return null;
    part.rows = (part.rows || []).filter(row => !/^объ[её]м|^время работы/i.test(String(row.k || '')));
    part.rows.push(...tank.rows);
    return tank.v;
  }

  /**
   * Какой нужен бак на hours ч (без изменения состава). С расчётом станции (GensetSizing) — по расходу ДГУ на нагрузке из
   * требований с запасом, за вычетом бака ДГУ; без него — нагрузка и расход по умолчанию.
   * @param {object} item
   * @param {number} hours
   * @returns {{v: number, rows: object[]}|null}
   */
  static tankFor(item, hours) {
    const power = this._workingKw(item);
    if (!(power > 0) || !(hours > 0)) return null;
    const plan = StationRules.ok() ? GensetSizing.plan(item) : null;
    if (plan) return this._planned(plan);
    const volume = this.tank(power, hours);
    return { v: volume, rows: [{ k: 'Объём', v: `${volume} л` }, this._workRow(volume, power)] };
  }

  /** мощность работающих ДГУ (без резервных), кВт */
  static _workingKw(item) {
    const reserve = Math.max(0, Math.round(StationReq.num(StationReq.of(item).reserve) || 0));
    return Kit.parts(item)
      .filter(part => StationEquip.kindOf(part) === 'dgu' && part.role === 'main')
      .reduce(
        (sum, part) => sum + (CalcInput.num((part.attrs || {}).kw) || 0) * Math.max(0, (+part.qty || 1) - reserve),
        0,
      );
  }

  static _planned(plan) {
    const need = Math.max(0, plan.need - plan.built);
    const volume = need > 0 ? this._typical(need) : this.TANKS[0];
    return {
      v: volume,
      rows: [
        { k: 'Объём', v: `${volume} л` },
        {
          k: `Время работы ДГУ от баков (с баком ДГУ) при нагрузке ${Math.round(plan.x * this.PERCENT)} %`,
          v: `около ${this.hours(volume + plan.built, plan.c)} ч`,
        },
      ],
    };
  }
}
