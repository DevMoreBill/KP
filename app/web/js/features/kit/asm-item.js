import { Kit } from './kit.js';
import { KitPart } from './kit-part.js';
import { StationPurpose } from './station-spec.js';
import { EquipTypes } from '../../core/equip-types.js';
import { SpecValues } from '../../core/spec-values.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Str } from '../../core/str.js';
import { Currency } from '../kp/currency.js';

/**
 * Сборное изделие без компоновки: контейнер и оборудование из каталога (от разных поставщиков) → одна позиция КП с
 * категорией станции. Название, назначение, сводная таблица, параметры для каталога, фото и цена — только из карточек
 * частей; чего нет в карточках, в изделии тоже нет.
 */
export class AsmItem {
  static KINDS = { st_pump: 'pump', st_comp: 'comp', st_dgu: 'dgu' };
  static AUTO_ID = 'asm_';
  static PURPOSE_ID = 'asm_purpose';
  static AI_ID = 'asm_ai_';
  static WORK_ID = 'asm_work';
  static PIC_ID = 'asmg_';
  static SUMMARY = 'Основные характеристики изделия';
  static WORK_NAME = 'Сборка и монтаж оборудования в контейнере';
  static PICS = 3;
  static SPEC_PARAMS = 3;
  static MAIN_KEYS = ['flow', 'head', 'pressure', 'kw', 'kva', 'voltage'];
  static INSTALLED = /установленн/i;
  static KW_ROUND = 100;
  static UNIT_ROUND = 1000;
  // единица карточки оборудования → единица поля станции: множитель
  static UNITS = { 'л/мин>м³/мин': 0.001 };

  /**
   * Элемент изделия из полной карточки каталога: как элемент сборки, плюс цена продажи и до PICS картинок галереи.
   * @param {object} doc карточка каталога
   * @param {string} role container | main | ''
   * @returns {object}
   */
  static part(doc, role) {
    const part = KitPart.fromCat(doc);
    if (role) part.role = role;
    part.price = doc.price || 0;
    part.priceCur = doc.priceCur || 'RUB';
    const main = part.photo ? part.photo.src : '';
    part.pics = (doc.gallery || [])
      .filter(pic => pic && pic.src && pic.on !== false && pic.src !== main)
      .slice(0, this.PICS)
      .map(pic => ({ src: pic.src, w: pic.w, h: pic.h, caption: String(pic.caption || '').trim() }));
    return part;
  }

  /**
   * Вид станции по категории.
   * @param {string} cat
   * @returns {string} pump | comp | dgu
   */
  static kind(cat) {
    return this.KINDS[cat] || '';
  }

  /**
   * Основное оборудование: отмеченное, иначе первое из основных категорий станции.
   * @param {string} cat категория изделия
   * @param {object[]} parts
   * @returns {object|undefined}
   */
  static main(cat, parts) {
    const own = parts.find(part => part.role === 'main');
    if (own) return own;
    const cats = (EquipTypes.byId(cat).station || {}).main || [];
    return parts.find(part => part.role !== 'container' && cats.includes((part.attrs || {}).cat));
  }

  /**
   * ДГУ для автономности (в насосной или компрессорной — ДГУ, которая не основное оборудование).
   * @param {string} cat
   * @param {object[]} parts
   * @returns {object[]}
   */
  static power(cat, parts) {
    if (cat === 'st_dgu') return [];
    return parts.filter(part => (part.attrs || {}).cat === 'dgu');
  }

  /**
   * Сумма частей в валюте КП: цена продажи и закупка (коп.); части без цены или без курса — списком.
   * @param {object[]} parts
   * @returns {{sale: number, cost: number, noPrice: string[], noRate: string[]}}
   */
  static sums(parts) {
    const out = { sale: 0, cost: 0, noPrice: [], noRate: [] };
    const into = Currency.rate(Currency.current());
    for (const part of parts) {
      const qty = +part.qty || 0;
      if (!part.price) out.noPrice.push(part.name);
      else {
        const rate = Currency.rate(part.priceCur || 'RUB');
        if (rate > 0 && into > 0) out.sale += Math.round((part.price * rate) / into) * qty;
        else out.noRate.push(part.name);
      }
    }
    const cost = Kit.cost({ kit: { parts } });
    out.cost = Number.isFinite(cost) ? cost : 0;
    return out;
  }

  /**
   * Название по умолчанию: «Модульная насосная станция Grundfos CR 32 с ДГУ в контейнере».
   * @param {string} cat
   * @param {object[]} parts
   * @returns {string}
   */
  static name(cat, parts) {
    const main = this.main(cat, parts);
    const attrs = (main && main.attrs) || {};
    const model = [attrs.maker, attrs.model].filter(Boolean).join(' ') || (main ? main.name : '');
    return [
      EquipTypes.byId(cat).item,
      model,
      this.power(cat, parts).length ? 'с ДГУ' : '',
      Kit.container({ kit: { parts } }) ? 'в контейнере' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Заполнить позицию КП: состав, название, назначение, сводная таблица, параметры, фото, цена и работы. Свои блоки
   * описания, таблицы и картинки менеджера остаются; название и цена — как в окне.
   * @param {object} item позиция КП (новая или прежнее изделие)
   * @param {{cat: string, parts: object[], name: string, price: number, photo: string, work: object|null}} input
   */
  static fill(item, input) {
    const { cat, parts } = input;
    const answer = this.fresh(input.ai, parts);
    item.kit = { simple: true, parts, ...(answer ? { ai: answer } : {}) };
    item.name = input.name || this.name(cat, parts);
    item.price = input.price;
    item.page = true;
    item._asmSum = this.sums(parts).sale;
    item.attrs = this._attrs(item, cat, parts);
    const own = (item.features || []).filter(feat => !String(feat.id || '').startsWith(this.AUTO_ID));
    item.features = [...this._lead(cat, parts, answer), ...own];
    item.groups = [this._summary(cat, parts, answer), ...(item.groups || []).filter(group => !group.asm)];
    item.photo = this._photo(parts, input.photo) || item.photo || null;
    item.gallery = [
      ...(item.gallery || []).filter(pic => !String(pic.id || '').startsWith(this.PIC_ID)),
      ...this._gallery(parts),
    ];
    this._spec(item);
    this._work(item, input.work);
    Kit.sync(item);
  }

  /**
   * Отпечаток состава (названия и количество): ответ ИИ действует, пока состав тот же; карточка части, дозаполненная в
   * каталоге, отпечаток не меняет.
   * @param {object[]} parts
   * @returns {string}
   */
  static sig(parts) {
    return parts.map(part => `${String(part.name || '').trim()}*${+part.qty || 1}`).join('|');
  }

  /**
   * Ответ ИИ для этого состава или null (состав изменился — ответ не действует).
   * @param {object|null} answer
   * @param {object[]} parts
   * @returns {object|null}
   */
  static fresh(answer, parts) {
    return answer && answer.sig === this.sig(parts) && ((answer.blocks || []).length || (answer.rows || []).length)
      ? answer
      : null;
  }

  /**
   * Что посчитала программа (без ИИ): установленная мощность, габариты контейнера, масса изделия.
   * @param {string} cat
   * @param {object[]} parts
   * @returns {object[]}
   */
  static calc(cat, parts) {
    const cont = (Kit.container({ kit: { parts } }) || {}).attrs || {};
    const installed = this._installed(cat, parts);
    const mass = this._mass(parts);
    return [
      installed ? { k: 'Установленная мощность оборудования', v: `${Str.comma(installed)} кВт` } : null,
      cont.size ? { k: 'Габариты контейнера (Д × Ш × В)', v: `${cont.size} мм` } : null,
      mass ? { k: 'Масса изделия (сумма составных частей)', v: `${Str.comma(mass)} кг` } : null,
    ].filter(Boolean);
  }

  /** описание: блоки ИИ (если есть для этого состава), иначе назначение по правилам */
  static _lead(cat, parts, answer) {
    if (!answer || !(answer.blocks || []).length) return [this._purpose(cat, parts)];
    return answer.blocks.map((block, k) => ({ id: `${this.AI_ID}${k}`, label: block.label, text: block.text }));
  }

  /**
   * Главное фото: выбранной части, иначе контейнера, иначе основного оборудования.
   * @param {object[]} parts
   * @param {string} chosen id части
   * @returns {string} id части с фото
   */
  static photoOf(parts, chosen) {
    const withPhoto = parts.filter(part => part.photo && part.photo.src);
    const pick =
      withPhoto.find(part => part.id === chosen) ||
      withPhoto.find(part => part.role === 'container') ||
      withPhoto.find(part => part.role === 'main') ||
      withPhoto[0];
    return pick ? pick.id : '';
  }

  static _photo(parts, chosen) {
    const id = this.photoOf(parts, chosen);
    const part = parts.find(line => line.id === id);
    return part ? { ...part.photo } : null;
  }

  static _gallery(parts) {
    return parts.flatMap(part =>
      (part.pics || []).map((pic, k) => ({
        id: `${this.PIC_ID}${part.id}_${k}`,
        src: pic.src,
        w: pic.w,
        h: pic.h,
        caption: pic.caption || part.name,
        slot: '',
        on: true,
      })),
    );
  }

  static _spec(item) {
    const spec = ItemSpec.mainLine(item, this.SPEC_PARAMS);
    if (!String(item.spec || '').trim() || item.spec === item._asmSpec) {
      item.spec = spec;
      item._asmSpec = spec;
    }
  }

  static _work(item, work) {
    const options = (item.options || []).filter(option => option.id !== this.WORK_ID);
    if (work)
      options.push({
        id: this.WORK_ID,
        name: String(work.name || '').trim() || this.WORK_NAME,
        qty: 1,
        unit: 'усл.',
        price: work.price || 0,
        cost: work.cost || 0,
        costCur: 'RUB',
      });
    item.options = options;
  }

  static _qty(part) {
    return +part.qty || 1;
  }

  static _nameQty(part) {
    return `${String(part.name || '').trim()}${this._qty(part) > 1 ? ` × ${this._qty(part)}` : ''}`;
  }

  static _equipment(parts) {
    return parts.filter(part => part.role !== 'container');
  }

  static _purpose(cat, parts) {
    const type = EquipTypes.byId(cat);
    const main = this.main(cat, parts);
    const container = Kit.container({ kit: { parts } });
    const power = this.power(cat, parts);
    const rest = this._equipment(parts).filter(part => part !== main && !power.includes(part));
    const what = StationPurpose.WHAT[this.kind(cat)] || StationPurpose.OTHER;
    const text = [
      `${type.item || type.name} — готовое изделие для ${what}.`,
      main ? `Основное оборудование — ${this._nameQty(main)}.` : '',
      container ? `Оборудование установлено в контейнер: ${this._nameQty(container)}.` : '',
      power.length ? `Автономное электроснабжение — ${power.map(part => this._nameQty(part)).join('; ')}.` : '',
      rest.length ? `Также в составе: ${rest.map(part => this._nameQty(part)).join('; ')}.` : '',
    ];
    return { id: this.PURPOSE_ID, label: 'Назначение', text: text.filter(Boolean).join(' ') };
  }

  /** параметр основного оборудования — с подписью и единицей его карточки */
  static _mainRows(main) {
    if (!main) return [];
    const attrs = main.attrs || {};
    const fields = EquipTypes.byId(attrs.cat).fields || [];
    const one = this._qty(main) > 1 ? ' (одного агрегата)' : '';
    return this.MAIN_KEYS.map(key => fields.find(field => field.key === key))
      .filter(field => field && attrs[field.key] != null && attrs[field.key] !== '')
      .map(field => ({ k: `${field.label}${one}`, v: SpecValues.show(field, attrs[field.key]), hl: true }));
  }

  /** установленная мощность — только если мощность есть у всего оборудования (ДГУ автономности не потребитель) */
  static _installed(cat, parts) {
    const field = (EquipTypes.byId(cat).fields || []).find(line => line.key === 'kw');
    if (!field || !this.INSTALLED.test(field.label)) return null;
    const users = this._equipment(parts).filter(part => !this.power(cat, parts).includes(part));
    const powers = users.map(part => Str.num((part.attrs || {}).kw));
    if (!users.length || powers.some(power => !(power > 0))) return null;
    const sum = users.reduce((total, part, k) => total + powers[k] * this._qty(part), 0);
    return Math.round(sum * this.KW_ROUND) / this.KW_ROUND;
  }

  static _mass(parts) {
    const masses = parts.map(part => Str.num((part.attrs || {}).mass));
    if (!parts.length || masses.some(mass => !(mass > 0))) return null;
    return Math.round(parts.reduce((total, part, k) => total + masses[k] * this._qty(part), 0));
  }

  static _summary(cat, parts, answer) {
    if (answer && (answer.rows || []).length)
      return { name: this.SUMMARY, asm: true, rows: answer.rows.map(row => ({ k: row.k, v: row.v, hl: false })) };
    const main = this.main(cat, parts);
    const container = Kit.container({ kit: { parts } });
    const cont = (container && container.attrs) || {};
    const label = (EquipTypes.byId(cat).station || {}).mainLabel || 'Основное оборудование';
    const calc = this.calc(cat, parts);
    const rows = [
      main ? { k: label, v: this._nameQty(main) } : null,
      ...this._mainRows(main),
      ...calc.filter(row => /^Установленная/.test(row.k)),
      ...this.power(cat, parts).map(part => ({ k: 'Автономное электроснабжение', v: this._nameQty(part) })),
      container ? { k: 'Контейнер', v: this._nameQty(container) } : null,
      ...calc.filter(row => /^Габариты/.test(row.k)),
      Str.num(cont.mass) > 0 ? { k: 'Масса контейнера', v: `${Str.comma(Str.num(cont.mass))} кг` } : null,
      ...calc.filter(row => /^Масса/.test(row.k)),
    ];
    return { name: this.SUMMARY, asm: true, rows: rows.filter(Boolean).map(row => ({ hl: false, ...row })) };
  }

  /** параметры категории станции — из основного оборудования (той же единицей или пересчётом), контейнера и суммы масс */
  static _attrs(item, cat, parts) {
    const own = { ...(item.attrs || {}) };
    for (const key of item._asmKeys || []) delete own[key];
    const out = { cat, ...this._fromMain(cat, parts), ...this._fromParts(cat, parts) };
    item._asmKeys = Object.keys(out);
    return { ...own, ...out };
  }

  static _fromMain(cat, parts) {
    const main = this.main(cat, parts);
    const from = (main && main.attrs) || {};
    const out = Object.fromEntries(['maker', 'model'].filter(key => from[key]).map(key => [key, from[key]]));
    const mainFields = EquipTypes.byId(from.cat).fields || [];
    for (const field of EquipTypes.byId(cat).fields || []) {
      const value = this.INSTALLED.test(field.label) ? null : this._value(field, mainFields, from);
      if (value != null) out[field.key] = value;
    }
    return out;
  }

  static _fromParts(cat, parts) {
    const cont = (Kit.container({ kit: { parts } }) || {}).attrs || {};
    const found = { kw: this._installed(cat, parts), size: cont.size, mass: this._mass(parts) };
    return Object.fromEntries(Object.entries(found).filter(([, value]) => value));
  }

  static _value(field, mainFields, from) {
    const source = mainFields.find(line => line.key === field.key);
    const value = from[field.key];
    if (!source || !this.MAIN_KEYS.includes(field.key) || value == null || value === '') return null;
    if (field.unit === source.unit) return value;
    const factor = this.UNITS[`${source.unit}>${field.unit}`];
    const number = Str.num(value);
    if (!factor || number == null) return null;
    return Math.round(number * factor * this.UNIT_ROUND) / this.UNIT_ROUND;
  }
}
