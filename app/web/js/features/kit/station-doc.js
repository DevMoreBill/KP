import { FieldUnit } from '../../core/field-unit.js';
import { Mm } from '../layout/mm.js';
import { ContainerKind } from './container-kind.js';
import { TankSize } from '../layout/tank-size.js';
import { AirChain } from '../layout/air-chain.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationPlan } from './station-plan.js';
import { Kit } from '../../core/kit.js';

/**
 * Станция в документе КП: какие элементы состава — карточками с описанием (основные агрегаты), какие характеристики —
 * ключевые; строки характеристик станции, которых нет в таблице.
 */
export class StationDoc {
  // блок описания станции (ИИ или своё) в описании позиции — первым
  static BRIEF = 'Описание станции';
  /** карточкой с описанием — основные агрегаты; фильтры, обвязка, шкафы, контейнер — только в таблице состава */
  static CARD = /^(compressor|dryer|receiver|dgu|pump|tank)$/;
  static SKIP = /^(страна|модель|марка|производитель(?!н)|серия|бренд|артикул|код|тип контроллера|гарантия|цена)/i;
  static MAX_ROWS = 8;
  /** порядок важности строк карточки: производительность и давление — первыми, габариты и масса — в конце */
  static PRIO = [
    /производительн|подач|пропускн|мощность.*(основн|ном)/i,
    /давлен|напор/i,
    /мощност/i,
    /объ[её]м/i,
    /точк\S* росы|класс|ступен|фильтрац/i,
    /габарит/i,
    /масса|вес/i,
    /шум/i,
    /напряжен|питани/i,
  ];
  static LAST = 99;
  static FLOW_UNIT = 'м³/мин';
  static MASS_STEP = 10;

  /**
   * Карточкой с описанием в КП?
   * @param {object} part элемент состава
   * @returns {boolean}
   */
  static card(part) {
    return this.CARD.test(StationEquip.kindOf(part) || '');
  }

  /**
   * Ключевые характеристики элемента для карточки КП (не больше MAX_ROWS, по важности).
   * @param {object} part
   * @returns {Array<{k: string, v: string}>}
   */
  static rows(part) {
    const kind = StationEquip.kindOf(part) || '';
    const list = (part.rows || []).filter(row => row.k && row.v && !this.SKIP.test(String(row.k).trim()));
    const flow = this._flowRow(part, kind, list);
    if (flow) list.unshift(flow);
    const tank = this._tankRow(part, kind);
    if (tank) list.push(tank);
    const seen = new Set();
    return list
      .map((row, i) => [row, i])
      .sort((first, second) => this._rank(first[0]) - this._rank(second[0]) || first[1] - second[1])
      .map(([row]) => row)
      .filter(row => {
        const key = String(row.k).toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, this.MAX_ROWS);
  }

  static _rank(row) {
    const place = this.PRIO.findIndex(pattern => pattern.test(String(row.k)));
    return place < 0 ? this.LAST : place;
  }

  /**
   * производительность компрессора, осушителя и генератора газа — из поля каталога, если строки нет: числом паспорта в
   * единице поля категории (без перевода и округления — в документе заказчика не больше паспорта)
   */
  static _flowRow(part, kind, list) {
    if (!/^(compressor|dryer)$/.test(kind) || list.some(row => this.PRIO[0].test(String(row.k)))) return null;
    const attrs = part.attrs || {};
    const value = StationEquip.num(attrs.flow);
    if (!(value > 0)) return null;
    const gas = kind === 'dryer' && AirChain.info(part, kind).type === 'gen';
    return {
      k: kind === 'dryer' && !gas ? 'Пропускная способность' : 'Производительность',
      v: `${Mm.dec(value)} ${FieldUnit.unit(StationEquip.cat(part), 'flow') || this.FLOW_UNIT}`,
    };
  }

  /** бак без своих габаритов — по расчётному объёму */
  static _tankRow(part, kind) {
    if (kind !== 'tank' || StationEquip.dims(part, kind).known) return null;
    const volume = TankSize.vol(part);
    return volume ? { k: 'Габариты Д × Ш × В', v: TankSize.text(TankSize.of(volume)) } : null;
  }

  /**
   * Первые блоки описания позиции: описание станции (ИИ или своё), «Назначение и состав», «Устройство станции», затем
   * остальные блоки менеджера.
   * @param {object} item
   * @param {object|null} purpose
   * @param {object|null} design
   * @returns {object[]}
   */
  static lead(item, purpose, design) {
    const own = (item.features || []).filter(block => block.label || block.text);
    const brief = own.filter(block => block.label === this.BRIEF);
    const rest = own.filter(block => block.label !== this.BRIEF);
    return [...brief, ...(purpose ? [purpose] : []), ...(design ? [design] : []), ...rest];
  }

  /**
   * Строки характеристик станции, которых нет в таблице: габариты и масса станции, контейнер, исполнение.
   * @param {object} item
   * @param {object[]} groups группы характеристик
   * @returns {object[]}
   */
  static extra(item, groups) {
    const plan = this._plan(item);
    if (!plan) return groups;
    const has = key =>
      groups.some(group => (group.rows || []).some(row => new RegExp(key, 'i').test(String(row.k || ''))));
    const add = this._extraRows(item, plan, has);
    if (!add.length) return groups;
    const out = groups.map(group => ({ ...group, rows: [...(group.rows || [])] }));
    if (out.length) out[0].rows.push(...add);
    else out.push({ name: 'Основные', rows: add });
    return out;
  }

  static _plan(item) {
    if (!StationPlan.enabled(item)) return null;
    let plan;
    try {
      plan = StationPlan.plan(item);
    } catch {
      return null;
    }
    return !plan || plan.level === 'error' || !plan.geo || !plan.geo.ext ? null : plan;
  }

  static _extraRows(item, plan, has) {
    const container = Kit.container(item) || {};
    const mass = plan.mass;
    const climate = ContainerKind.CLIMATES.find(row => row[0] === container.climate);
    const rows = [];
    if (!has('^Габарит'))
      rows.push({
        k: 'Габариты станции (Д × Ш × В)',
        v: `${plan.geo.ext.map(side => Mm.text(side)).join(' × ')} мм`,
        hl: false,
      });
    if (!has('^Масса') && mass && mass.mass > 0 && !(mass.missing || []).length)
      rows.push({
        k: 'Масса станции',
        v: `около ${Mm.text(Math.round(mass.mass / this.MASS_STEP) * this.MASS_STEP)} кг`,
        hl: false,
      });
    if (!has('^Контейнер'))
      rows.push({
        k: 'Контейнер',
        v: [ContainerKind.of(container.ctype).name, container.ins ? `утепление ${container.ins}` : '']
          .filter(Boolean)
          .join(', '),
        hl: false,
      });
    if (!has('^Климатическое') && climate)
      rows.push({ k: 'Климатическое исполнение', v: `${climate[0]} (${climate[1]})`, hl: false });
    return rows;
  }
}
