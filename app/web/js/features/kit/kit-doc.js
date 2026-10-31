import { FEAT } from '../../core/features.js';
import { StationPurpose } from './station-spec.js';
import { StationCalc } from '../calc/station-calc.js';
import { KitScope } from './kit-scope.js';
import { Attrs } from '../../core/item-attrs.js';
import { S } from '../../core/state.js';
import { SupplyDocs } from './supply-docs.js';
import { StationDesign } from './station-design.js';
import { StationDoc } from './station-doc.js';
import { Kit } from '../../core/kit.js';

/**
 * Сборка в документе КП, экономике сделки и логистике: шаблон, умеющий сборки, получает состав как есть (`data`), любой
 * другой — элементы блоками описания с фото и таблицами характеристик (`item`); в экономике каждый элемент — своя строка
 * закупки со своим поставщиком (`lines`), в логистике — свой груз (`cargo`).
 */
export class KitDoc {
  static CARD_ROWS = 5;
  static OPT = '~opt~';
  static SPEC_MAX = 200;

  /**
   * Позиция для документа: состав — блоками описания (с фото) и таблицами характеристик элементов.
   * @param {object} item
   * @returns {object}
   */
  static item(item) {
    if (!Kit.has(item)) return item;
    const parts = Kit.parts(item).filter(part => String(part.name || '').trim());
    const station = this._station(item);
    // станция: описание и характеристики — только основных агрегатов; остальное — в перечне состава
    const cards = station ? parts.filter(part => StationDoc.card(part)) : parts;
    const rowsOf = part => (station ? StationDoc.rows(part) : (part.rows || []).filter(row => row.k && row.v));
    const list = {
      id: 'kit_all',
      label: 'Состав изделия',
      text: `${parts.map(part => `${part.name.trim()}${this._qty(part)}`).join('; ')}.`,
    };
    const features = this._features(cards, rowsOf);
    const groups = cards
      .filter(part => rowsOf(part).length)
      .map(part => ({ name: part.name.trim(), rows: rowsOf(part).map(row => ({ k: row.k, v: row.v, hl: false })) }));
    const gallery = this._gallery(parts, features);
    const docs = SupplyDocs.feature(item);
    const calc = this._calc(item);
    const purpose = StationPurpose.feature(item);
    const design = station ? StationDesign.feature(item) : null;
    return {
      ...item,
      page: true,
      spec: item.spec || `В составе: ${parts.map(part => part.name.trim()).join(', ')}`.slice(0, this.SPEC_MAX),
      features: [
        ...this._lead(item, station, purpose, design),
        ...(purpose ? [] : [list]),
        ...features,
        ...(docs ? [docs] : []),
      ],
      groups: [...this._groups(item, station), ...groups, ...calc],
      gallery: [...(item.gallery || []), ...gallery],
    };
  }

  /**
   * Состав для шаблона, умеющего сборки: элементы как есть (без закупки и поставщика) и описание изделия без разложенного
   * состава. `card: false` — элемент только в таблице состава; `rowsKp` — ключевые характеристики карточки.
   * @param {object} item
   * @returns {{parts: object[], base: object}}
   */
  static data(item) {
    const station = this._station(item);
    const parts = Kit.parts(item)
      .filter(part => String(part.name || '').trim())
      .map(part => this._dataPart(part, station));
    const docs = SupplyDocs.feature(item);
    const calc = this._calc(item);
    const purpose = StationPurpose.brief(item);
    const design = station ? StationDesign.feature(item) : null;
    return {
      parts,
      base: {
        // сборное изделие: в документе сначала изделие целиком (описание, сводные характеристики), затем состав
        ...(Kit.simple(item) ? { asm: true } : {}),
        page: true,
        spec: item.spec || '',
        features: [...this._lead(item, station, purpose, design), ...(docs ? [docs] : [])],
        groups: [...this._groups(item, station), ...calc],
        gallery: item.gallery || [],
      },
    };
  }

  /**
   * Строки закупки для экономики сделки: элемент сборки — своя строка (своя валюта и поставщик); обычная позиция — как есть.
   * @param {object} [state]
   * @returns {object[]}
   */
  static lines(state = S) {
    const out = [];
    (state.items || []).forEach((item, i) => {
      if (!String(item.name || '').trim() && !item.cost) return;
      out.push(...this._own(item, i), ...this._options(item, i));
    });
    return out;
  }

  static _own(item, i) {
    if (Kit.has(item)) {
      return Kit.parts(item)
        .map((part, j) => ({ part, j }))
        .filter(({ part }) => String(part.name || '').trim() || part.cost)
        .map(({ part, j }) => this._line(item, part, i, j));
    }
    const maker = Attrs.of(item).maker || '';
    return [
      {
        id: item.id,
        i,
        name: item.name,
        qty: +item.qty || 0,
        cost: item.cost || 0,
        costCur: item.costCur || 'RUB',
        maker,
        item,
      },
    ];
  }

  // опции и услуги с ценой продажи или закупкой — свои строки закупки (поставщик по умолчанию — как у позиции);
  // опция без цены продажи (askPrice) не продаётся — и не закупается
  static _options(item, i) {
    if (!FEAT.on('optCost')) return [];
    return (item.options || [])
      .map((option, j) => ({ option, j }))
      .filter(
        ({ option }) => String(option.name || '').trim() && !option.askPrice && (option.cost > 0 || option.price > 0),
      )
      .map(({ option, j }) => this._optLine(item, option, i, j));
  }

  static _optLine(item, option, i, j) {
    const id = `${item.id}${this.OPT}${option.id || j}`;
    return {
      id,
      i,
      j,
      opt: option,
      name: option.name,
      of: item.name,
      qty: +option.qty || 0,
      cost: option.cost || 0,
      costCur: option.costCur || 'RUB',
      maker: '',
      item: { id, catId: option.catId || '', name: option.name, role: '', attrs: { cat: Attrs.of(item).cat } },
    };
  }

  /**
   * Груз для логистики: обычная позиция — как есть; сборка — элементами (каждый едет от своего поставщика); таблица
   * элемента — та же ссылка (габариты и масса, вписанные в логистике, сохраняются в элементе).
   * @param {object} [state]
   * @returns {object[]}
   */
  static cargo(state = S) {
    return (state.items || []).flatMap(item => {
      if (!Kit.has(item)) return [item];
      return Kit.parts(item).map(part => {
        part.rows = part.rows || [];
        return {
          id: `${item.id}~${part.id}`,
          name: `${part.name || 'Элемент'} (${item.name})`,
          qty: (+item.qty || 0) * (+part.qty || 0),
          groups: [{ name: part.name, rows: part.rows }],
          cost: part.cost,
          costCur: part.costCur || 'RUB',
          price: 0,
          catId: part.catId || '',
        };
      });
    });
  }

  static _line(item, part, i, j) {
    const attrs = part.attrs || {};
    return {
      id: `${item.id}~${part.id}`,
      i,
      j,
      part,
      name: part.name || 'Элемент',
      of: item.name,
      qty: (+item.qty || 0) * (+part.qty || 0),
      cost: part.cost || 0,
      costCur: part.costCur || 'RUB',
      maker: KitScope.sup(item, part) || attrs.maker || '',
      item: {
        id: `${item.id}~${part.id}`,
        catId: part.catId || '',
        name: part.name,
        role: part.role || '',
        attrs: { ...attrs, cat: attrs.cat || Attrs.of(item).cat },
      },
    };
  }

  static _dataPart(part, station) {
    const attrs = part.attrs || {};
    return {
      id: part.id,
      name: part.name.trim(),
      qty: +part.qty || 1,
      desc: String(part.desc || '').trim(),
      rows: (part.rows || []).filter(row => row.k && row.v).map(row => ({ k: row.k, v: row.v })),
      maker: attrs.maker || '',
      model: attrs.model || '',
      ...(station
        ? { card: StationDoc.card(part), rowsKp: StationDoc.rows(part).map(row => ({ k: row.k, v: row.v })) }
        : {}),
    };
  }

  static _features(cards, rowsOf) {
    return cards
      .map(part => {
        const rows = rowsOf(part)
          .slice(0, this.CARD_ROWS)
          .map(row => `${row.k} — ${row.v}`)
          .join('; ');
        return {
          id: `kit_${part.id}`,
          label: part.name.trim() + this._qty(part),
          text: String(part.desc || '').trim() || (rows ? `${rows}.` : ''),
        };
      })
      .filter(feature => feature.text);
  }

  static _gallery(parts, features) {
    return parts
      .filter(part => part.photo && part.photo.src && features.some(feature => feature.id === `kit_${part.id}`))
      .map(part => ({
        id: `kitg_${part.id}`,
        src: part.photo.src,
        w: part.photo.w,
        h: part.photo.h,
        caption: part.name.trim(),
        slot: '',
        at: `feat:kit_${part.id}`,
        on: true,
      }));
  }

  /** станция: назначение и устройство — первыми; иначе назначение и свои блоки позиции */
  static _lead(item, station, purpose, design) {
    if (station) return StationDoc.lead(item, purpose, design);
    return [...(purpose ? [purpose] : []), ...(item.features || []).filter(feature => feature.label || feature.text)];
  }

  static _groups(item, station) {
    return station ? StationDoc.extra(item, item.groups || []) : item.groups || [];
  }

  /** приложение «Расчётная записка и состав станции» */
  static _calc(item) {
    return StationCalc.docGroups(item);
  }

  static _station(item) {
    return !!Kit.station(item);
  }

  static _qty(part) {
    return (+part.qty || 1) > 1 ? ` × ${part.qty}` : '';
  }
}
