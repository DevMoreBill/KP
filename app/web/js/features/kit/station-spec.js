import { ContainerKind } from './container-kind.js';
import { StationReq } from '../req/station-req.js';
import { ItemSpec } from '../../core/item-spec.js';
import { StationPower } from '../layout/station-power.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { StationParams } from './station-params.js';
import { StationPlan } from './station-plan.js';
import { Kit } from '../../core/kit.js';

/**
 * Таблица характеристик станции: вместо «Производитель / Модель», угаданных по названию станции, — строка основного
 * оборудования («Компрессор: Dalgakiran EAGLE 315W»), расчётная мощность по компоновке и свои параметры станции.
 */
export class StationSpec {
  static FIRST = 'Основные';
  static MAIN = 'Основное оборудование';

  /**
   * Нагрузки станции по компоновке или null (нет контейнера, не помещается).
   * @param {object} item
   * @returns {object|null}
   */
  static power(item) {
    if (!Kit.has(item)) return null;
    try {
      const plan = StationPlan.plan(item);
      return (plan && plan.level !== 'error' && plan.power) || null;
    } catch {
      return null;
    }
  }

  /**
   * Разделы характеристик станции.
   * @param {object} item
   * @param {object[]} groups разделы из параметров позиции
   * @returns {object[]}
   */
  static groups(item, groups) {
    const station = EquipTypes.byId(Attrs.of(item).cat).station;
    const out = groups
      .map(group => ({ ...group, rows: group.rows.filter(row => !/^(Производитель|Модель)$/.test(row.k)) }))
      .filter(group => group.rows.length);
    if (!station) return out;
    this._main(item, station, out);
    this._power(item, out);
    this._own(item, out);
    return out.filter(group => group.rows.length);
  }

  static _main(item, station, out) {
    const main = Kit.main(item);
    const attrs = (main && main.attrs) || {};
    const name = [attrs.maker, attrs.model].filter(Boolean).join(' ') || (main && main.name) || '';
    if (!name) return;
    const row = { k: station.mainLabel || this.MAIN, v: name, hl: false };
    if (out.length) out[0].rows.unshift(row);
    else out.push({ name: this.FIRST, rows: [row] });
  }

  /** расчётная мощность по компоновке (у ДГУ — собственные нужды) */
  static _power(item, out) {
    const power = this.power(item);
    if (!power || !(power.kw > 0)) return;
    const breaker = power.breaker ? `, вводной автомат ${power.breaker} А` : '';
    this._push(out, [
      {
        k: power.dgu ? 'Собственные нужды станции' : 'Потребляемая мощность (расчётная)',
        v: `${StationPower.fmt(power.kw)} кВт, 3 × 400 В${breaker}`,
        hl: false,
      },
    ]);
  }

  /** свои параметры станции (ручной режим): после автоматических; совпадающая строка заменяется своей */
  static _own(item, out) {
    const own = StationParams.rows(item);
    if (!own.length) return;
    const names = new Set(own.map(row => row.k.toLowerCase()));
    for (const group of out) group.rows = group.rows.filter(row => !names.has(String(row.k || '').toLowerCase()));
    this._push(
      out,
      own.map(row => ({ k: row.k, v: row.v, hl: false })),
    );
  }

  static _push(out, rows) {
    if (out.length) out[0].rows.push(...rows);
    else out.push({ name: this.FIRST, rows });
  }
}

/**
 * Связный текст «Назначение и состав» станции — только из её данных (вид, основное оборудование, параметры, состав,
 * контейнер и исполнение); в КП — если менеджер не написал свой блок «Назначение…».
 */
export class StationPurpose {
  static LABEL = 'Назначение и состав';
  static FEATURE_ID = 'st_purpose';
  static WHAT = {
    comp: 'выработки, подготовки (осушки и очистки) и подачи сжатого воздуха потребителям',
    dgu: 'электроснабжения объекта',
    pump: 'перекачки жидкости с заданными подачей и напором',
  };
  static OTHER = 'работы в составе объекта заказчика';
  static KPI = 4;

  /**
   * Есть ли у станции свой блок назначения (вписан менеджером или ИИ).
   * @param {object} item
   * @returns {boolean}
   */
  static own(item) {
    return (item.features || []).some(
      feature => /назначени|описание станции/i.test(String(feature.label || '')) && String(feature.text || '').trim(),
    );
  }

  /**
   * Блок описания для документа КП (с перечнем остального состава) или null.
   * @param {object} item
   * @returns {object|null}
   */
  static feature(item) {
    return this._feature(item, this._rest(item));
  }

  /**
   * Блок без перечня состава (его показывает шаблон, умеющий сборки) или null.
   * @param {object} item
   * @returns {object|null}
   */
  static brief(item) {
    return this._feature(item, []);
  }

  static _feature(item, rest) {
    if (this.own(item)) return null;
    const text = this._text(item, rest);
    return text ? { id: this.FEATURE_ID, label: this.LABEL, text } : null;
  }

  static _rest(item) {
    const main = Kit.main(item);
    return Kit.parts(item).filter(part => part !== main && part.role !== 'container' && this._name(part));
  }

  static _text(item, rest) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    if (!type.station || Kit.simple(item)) return '';
    const main = Kit.main(item);
    const mainName = main && this._name(main);
    const kpi = ItemSpec.mainLine(item, this.KPI);
    const out = [`${type.item || type.name} предназначена для ${this.WHAT[StationReq.kind(item)] || this.OTHER}.`];
    if (mainName) out.push(`Основное оборудование — ${mainName}${this._qty(main)}.`);
    if (kpi) out.push(`Основные параметры: ${kpi}.`);
    if (rest.length)
      out.push(
        `В составе${mainName ? ' также' : ''}: ${rest.map(part => this._name(part) + this._qty(part)).join('; ')}.`,
      );
    const container = Kit.container(item);
    if (container) out.push(this._container(container));
    return out.join(' ');
  }

  static _container(container) {
    const kind = ContainerKind.of(container.ctype);
    const climate = [
      container.climate ? `климатическое исполнение ${container.climate}` : '',
      container.ins ? `утепление ${container.ins}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `Оборудование размещено в контейнере: ${String(kind.name || '').toLowerCase()}${climate ? `; ${climate}` : ''}.`;
  }

  static _name(part) {
    return String(part.name || '').trim();
  }

  static _qty(part) {
    return (+part.qty || 1) > 1 ? ` — ${part.qty} шт.` : '';
  }
}
