import { EquipWizard } from '../wizard/equip-wizard.js';
import { CatalogWindow } from './catalog-window.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';
import { DefRegistry } from '../../core/defaults.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { Catalog } from './catalog-store.js';
/**
 * Разделы каталога: в разделе «Оборудование» — плитки разделов (группа категории) с пиктограммой, числом позиций и
 * крупнейшими подкатегориями; маленькие разделы (меньше cat.sectionMin позиций) — одной плиткой «Другое оборудование».
 * Нажатие открывает каталог на разделе, подкатегории — кнопками над списком.
 */
export class CatSections {
  static OTHER = 'Другое оборудование';
  static TOP = 3;
  static DEFAULTS = [
    [],
    [
      [
        'cat.sectionMin',
        'catsearch',
        'Раздел отдельной плиткой — от',
        'num',
        '20',
        {
          unit: 'позиций',
          req: true,
          min: 0,
          max: 1000,
          hint: 'Разделы каталога, в которых позиций меньше, в разделе «Оборудование» собираются в одну плитку «Другое оборудование», чтобы плиток было немного. 0 — каждый раздел своей плиткой.',
        },
      ],
    ],
  ];
  // пиктограмма раздела — по названию группы категорий (свои группы отдела тоже узнаются по словам)
  static ICONS = [
    [/компрес|воздуходув/i, 'comp'],
    [/воздух|осуш|фильтр|азот|кислород|конденсат/i, 'air'],
    [/генерат|электро|дгу|мачт/i, 'gen'],
    [/свар|резк/i, 'weld'],
    [/насос|мотопомп/i, 'pump'],
    [/холод|чиллер/i, 'cold'],
  ];
  static PATHS = {
    comp: '<rect x="6" y="34" width="52" height="20" rx="10"/><rect x="14" y="16" width="24" height="18" rx="3"/><path d="M38 22h8v12M22 16v-6h8v6"/><circle cx="50" cy="14" r="6"/><path d="M50 14l3-3M14 54v4M50 54v4"/>',
    air: '<path d="M20 8h24v8H20z"/><path d="M22 16v22a10 10 0 0 0 20 0V16"/><path d="M27 24h10M27 30h10M27 36h10"/><path d="M32 48v6"/><path d="M50 40c0 4-3 7-5 7s-5-3-5-7 5-10 5-10 5 6 5 10z"/>',
    gen: '<rect x="6" y="20" width="52" height="30" rx="4"/><path d="M12 50v6M52 50v6M14 28h14v14H14z"/><path d="M42 26l-6 10h8l-6 10"/>',
    weld: '<path d="M14 10h36l4 14v14a22 18 0 0 1-44 0V24z"/><rect x="20" y="22" width="24" height="10" rx="2"/><path d="M32 46v12M26 58h12"/>',
    pump: '<circle cx="26" cy="34" r="14"/><circle cx="26" cy="34" r="4"/><path d="M26 20h20v-8h8v16h-8v-8"/><path d="M40 34h16M12 54h32M18 48l-4 6M34 48l4 6"/>',
    cold: '<path d="M32 6v52M9 19l46 26M55 19L9 45"/><path d="M26 10l6 6 6-6M26 54l6-6 6 6"/>',
    other: '<rect x="8" y="22" width="48" height="32" rx="4"/><path d="M24 22v-8h16v8M8 34h48M28 34v6h8v-6"/>',
    box: '<rect x="4" y="18" width="56" height="30" rx="2"/><path d="M14 18v30M24 18v30M34 18v30M44 18v30M54 18v30M4 48h56v4H4z"/>',
  };
  static cache = null; // {types, cat, list, byCat} — пересчёт, когда сменились категории или каталог

  /**
   * Пиктограмма раздела.
   * @param {string} key
   * @param {string} [cls]
   * @returns {string}
   */
  static svg(key, cls = 'sec-i') {
    return `<svg class="${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this.PATHS[key] || this.PATHS.other}</svg>`;
  }

  /**
   * Пиктограмма по названию группы.
   * @param {string} name
   * @returns {string}
   */
  static iconOf(name) {
    const found = this.ICONS.find(([pattern]) => pattern.test(name));
    return found ? found[1] : 'other';
  }

  static _counts() {
    const counts = new Map();
    for (const card of Catalog.cache) {
      const cat = Attrs.of(card).cat;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return counts;
  }

  static _groups(counts) {
    const groups = new Map();
    for (const type of EquipTypes.list) {
      if (type.station || type.role === 'accessory') continue;
      const group = type.group || 'Прочее';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ id: type.id, name: type.name, n: counts.get(type.id) || 0 });
    }
    return groups;
  }

  static _sum(types) {
    return types.reduce((total, type) => total + type.n, 0);
  }

  // маленькие разделы и «Прочее» — одной плиткой «Другое оборудование»
  static _sections(groups) {
    const min = Catalog.cache.length ? Math.round(DefRegistry.num('cat.sectionMin', 20)) : 0;
    const out = [];
    const rest = [];
    for (const [group, types] of groups) {
      const count = this._sum(types);
      if ((count < min || /^прочее$/i.test(group)) && groups.size > 1) rest.push(...types);
      else out.push({ key: group, name: group, icon: this.iconOf(group), n: count, types });
    }
    if (rest.length) out.push({ key: this.OTHER, name: this.OTHER, icon: 'other', n: this._sum(rest), types: rest });
    return out;
  }

  /**
   * Разделы по убыванию числа позиций в подкатегориях; key — имя группы (или OTHER).
   * @returns {{key: string, name: string, icon: string, n: number, types: object[]}[]}
   */
  static list() {
    const cached = this.cache;
    if (cached && cached.types === EquipTypes.list && cached.cat === Catalog.cache) return cached.list;
    const out = this._sections(this._groups(this._counts()));
    for (const section of out) {
      section.types.sort((first, second) => second.n - first.n || first.name.localeCompare(second.name, 'ru'));
    }
    const byCat = new Map();
    for (const section of out) for (const type of section.types) byCat.set(type.id, section.key);
    this.cache = { types: EquipTypes.list, cat: Catalog.cache, list: out, byCat };
    return out;
  }

  /**
   * Раздел категории.
   * @param {string} cat
   * @returns {string}
   */
  static keyOf(cat) {
    this.list();
    return this.cache.byCat.get(cat) || '';
  }

  /**
   * Раздел по ключу.
   * @param {string} key
   * @returns {object|null}
   */
  static get(key) {
    return this.list().find(section => section.key === key) || null;
  }

  /**
   * Плитки раздела «Оборудование» (пустой КП).
   * @returns {string}
   */
  static tiles() {
    return this.list()
      .map(section => {
        const full = section.types.filter(type => type.n);
        const top = full
          .slice(0, this.TOP)
          .map(type => `${type.name} ${Fmt.num(type.n)}`)
          .join(' · ');
        const sub = section.n ? esc(full.length > 1 ? top : 'в каталоге') : 'добавить вручную';
        return `<button type="button" class="tile sec${section.n ? '' : ' zero'}" data-a="secOf" data-sec="${esc(section.key)}">${this.svg(section.icon)}<b>${esc(section.name)}</b>
        <em>${section.n ? Fmt.num(section.n) : 'пусто'}</em><span>${sub}</span></button>`;
      })
      .join('');
  }

  /**
   * Нажата плитка раздела: одна категория — сразу она, пустой раздел — новое оборудование, иначе — каталог на разделе.
   * @param {string} key
   * @returns {*}
   */
  static open(key) {
    const section = this.get(key);
    if (!section) return CatalogWindow.open({});
    const full = section.types.filter(type => type.n);
    if (!full.length) return EquipWizard.open('kp', section.types[0].id);
    if (full.length === 1) return CatalogWindow.open({ cat: full[0].id });
    return CatalogWindow.open({ grp: key });
  }
}
