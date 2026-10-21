import { ContainerKind } from './container-kind.js';
import { Kit } from './kit.js';
import { StationPaint } from '../layout/station-paint.js';
import { DefRegistry } from '../../core/defaults.js';
import { Mm } from '../layout/mm.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMods } from '../layout/station-mods.js';

/** Строка характеристик контейнера «Модули» у станции из модулей (габариты в строке выше — одного модуля). */
export class StationModsText {
  /**
   * @param {object} part контейнер
   * @returns {string}
   */
  static of(part) {
    const mods = StationMods.of(part);
    if (!mods) return '';
    const dims = StationGeo.parseMm(part.size);
    const total = dims
      ? `, вместе ${Mm.text(dims[0] * mods.a)} × ${Mm.text(dims[1] * mods.b)} × ${Mm.text(dims[2])} мм`
      : '';
    return `${StationMods.shape(mods)}${total}; на объекте стыкуются в одно помещение, каждый модуль — в габарите перевозки`;
  }
}

/**
 * Элемент «контейнер»: вид, утепление, климат, крыша, пол, окраска и системы → название, описание и строки характеристик
 * (свои правки строк менеджера не теряются).
 */
export class ContainerPart {
  static OPTIONAL = new Set(['Окраска', 'Крыша', 'Модули']);
  static OLD_COLOR = 'Цвет';
  static COLOR = 'Окраска';
  static DEFAULT_INS = '100 мм';
  static DEFAULT_CLIMATE = 'УХЛ1';

  /**
   * Изменить контейнер и пересобрать его строки.
   * @param {object} part
   * @param {object} [changes]
   * @returns {object} тот же элемент
   */
  static apply(part, changes = {}) {
    Object.assign(part, changes);
    const kind = ContainerKind.of(part.ctype);
    part.role = 'container';
    const mods = StationMods.of(part);
    if (mods) part.qty = mods.n;
    this._name(part, kind);
    const roofId = StationGeo.roof(part);
    part.floor = StationGeo.floor(part);
    const values = this._values(part, kind, roofId);
    part.rows = part.rows || [];
    if (!part.sys) part.sys = { ...ContainerKind.SYSTEMS_ON };
    this._renameColor(part.rows);
    this._setRows(part.rows, values);
    this._systems(part);
    return part;
  }

  /**
   * Новый контейнер вида ctype (утепление и климат — свои у вида, иначе из «Умолчаний»).
   * @param {string} ctype
   * @returns {object}
   */
  static create(ctype) {
    const kind = ContainerKind.of(ctype);
    return this.apply(Kit.newPart({ qty: 1 }), {
      ctype: kind.id,
      ins: kind.ins || DefRegistry.value('st.ins') || this.DEFAULT_INS,
      climate: kind.climate || DefRegistry.value('st.climate') || this.DEFAULT_CLIMATE,
    });
  }

  /** название и описание вида — пока менеджер не вписал свои */
  static _name(part, kind) {
    const prevAuto = part._autoDesc;
    if (!part.name || ContainerKind.TYPES.some(type => type.name === part.name)) part.name = kind.name;
    if (!part.desc || part.desc === prevAuto) part.desc = kind.desc;
    part._autoDesc = kind.desc;
  }

  static _values(part, kind, roofId) {
    const climate = ContainerKind.climate(part.climate);
    const floor = StationGeo.FLOORS[part.floor].name;
    return {
      Тип: kind.name,
      'Габариты (Д × Ш × В)': this._size(part, kind),
      Утепление: part.ins ? `минеральная вата ${part.ins}` : '',
      'Климатическое исполнение': climate ? `${climate[0]} (${climate[1]})` : '',
      Крыша: this._roof(roofId),
      Пол: floor[0].toUpperCase() + floor.slice(1),
      Окраска: StationPaint.kpLine(part),
      Модули: StationModsText.of(part),
    };
  }

  static _size(part, kind) {
    const size = String(part.size || '').trim();
    if (!size) return kind.size;
    return size + (/мм|м\b/.test(part.size) ? '' : ' мм');
  }

  static _roof(roofId) {
    if (roofId === 'flat') return '';
    const roof = StationGeo.ROOFS[roofId];
    if (!roof) return '';
    return roof.deg ? `${roof.name}, уклон ${roof.deg}°` : roof.name;
  }

  /** прежняя строка «Цвет» — теперь «Окраска» */
  static _renameColor(rows) {
    const was = rows.find(row => row.k === this.OLD_COLOR);
    if (was && !rows.some(row => row.k === this.COLOR)) was.k = this.COLOR;
  }

  static _setRows(rows, values) {
    for (const [k, v] of Object.entries(values)) {
      const row = rows.find(line => line.k === k);
      if (!row) {
        if (v) rows.push({ k, v });
      } else if (v) row.v = v;
      else if (this.OPTIONAL.has(k)) rows.splice(rows.indexOf(row), 1);
    }
  }

  static _systems(part) {
    for (const [id, k, v] of ContainerKind.SYSTEMS) {
      const renamed = ContainerKind.SYSTEMS_RENAMED[id] || [];
      for (const row of part.rows) if (renamed.includes(row.k)) row.k = k;
      const index = part.rows.findIndex(row => row.k === k);
      if (part.sys[id] && index < 0) part.rows.push({ k, v });
      else if (!part.sys[id] && index >= 0) part.rows.splice(index, 1);
      else if (index >= 0 && (ContainerKind.SYSTEMS_OLD[id] || []).includes(part.rows[index].v)) part.rows[index].v = v;
    }
  }
}
