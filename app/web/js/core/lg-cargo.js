/**
 * Груз из характеристик позиции: масса и габариты (строки «Габариты Д × Ш × В», «Длина», «Масса брутто»…) и запись
 * вписанных значений обратно в характеристики (позиция КП или карточка каталога).
 */
export class LgCargo {
  static DIM_SKIP =
    /радиатор|рабоч|помещени|мачт|рамы|присоедин|всасыв|над уровн|упаковк[аи]? (?:не|без)|кабин|экран|дисплей|фланц|патрубк|колес|колёс/i;
  static TRIPLE =
    /(\d+(?:[.,]\d+)?)(?:\/\d+(?:[.,]\d+)?)?\s*×\s*(\d+(?:[.,]\d+)?)(?:\/\d+(?:[.,]\d+)?)?\s*×\s*(\d+(?:[.,]\d+)?)(?:\/(\d+(?:[.,]\d+)?))?/;
  static METER = /(^|[^а-я])м([^а-я]|$)/;
  // единицы — отдельным словом: «смонтированном», «смазки» — не сантиметры
  static MILLI = /(^|[^а-яё])мм([^а-яё]|$)/;
  static CENTI = /(^|[^а-яё])см([^а-яё]|$)/;
  static UNIT_K = { м: 1, см: 0.01, мм: 0.001 };
  static UNIT_DIV = { м: 1, см: 100, мм: 1000 };
  static MAX_M = 40;
  static MM_GUESS = 40;
  static LEN_GUESS = 50;
  static THOUSAND = 1000;
  static MAX_KG = 200000;
  static HEIGHT = /^высота(?!\s*(рамы|мачты|всас|над))/i;
  static GROUP = 'Габариты и масса';

  /**
   * Число из текста: «2 400,5» → 2400.5; не число — null.
   * @param {*} text
   * @returns {number|null}
   */
  static num(text) {
    const value = parseFloat(String(text).replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  /**
   * «3197 × 1840 × 2450/2200 мм», «120 x 65 x 135» (см) → [3.197, 1.84, 2.45] м.
   * @param {*} value
   * @param {string} [unitHint]
   * @returns {number[]|null}
   */
  static triple(value, unitHint) {
    const text = String(value || '')
      .replace(/(\d)\s+(?=\d{3}\b)/g, '$1')
      .replace(/[хxХX*]/g, '×');
    const match = text.match(this.TRIPLE);
    if (!match) return null;
    const sizes = [
      this.num(match[1]),
      this.num(match[2]),
      Math.max(this.num(match[3]), match[4] ? this.num(match[4]) : 0),
    ];
    const unit = this._unit(`${text} ${unitHint || ''}`.toLowerCase(), Math.max(...sizes) > this.MM_GUESS ? 'мм' : 'м');
    const meters = sizes.map(size => size * this.UNIT_K[unit]);
    return meters.every(size => size > 0 && size < this.MAX_M) ? meters : null;
  }

  static _unit(lower, guess) {
    if (this.MILLI.test(lower)) return 'мм';
    if (this.CENTI.test(lower)) return 'см';
    return this.METER.test(lower) ? 'м' : guess;
  }

  /**
   * Длина из строки «Длина: 2 400 мм» → 2.4 м.
   * @param {*} value
   * @param {string} [unitHint]
   * @returns {number|null}
   */
  static len(value, unitHint) {
    const text = String(value || '');
    const raw = this.num((text.match(/\d[\d\s]*(?:[.,]\d+)?/) || [''])[0]);
    if (raw == null) return null;
    const lower = `${text} ${unitHint || ''}`.toLowerCase();
    const unit = this._unit(lower, raw > this.LEN_GUESS ? 'мм' : 'м');
    const meters = raw / this.UNIT_DIV[unit];
    return meters > 0 && meters < this.MAX_M ? meters : null;
  }

  /**
   * Масса и габариты из групп характеристик.
   * @param {object[]} groups
   * @returns {{dims: object|null, dimSrc: string, mass: number|null, massSrc: string, dimRef: object|null, massRef: object|null}}
   */
  static of(groups) {
    const rows = this._rows(groups);
    const dims = this._dims(rows) || this._separate(rows) || { dims: null, dimSrc: '', dimRef: null };
    const mass = this._mass(rows);
    // длина — наибольший размер в плане (груз ставят вдоль площадки)
    const size = dims.dims;
    if (size && size.w > size.l) [size.l, size.w] = [size.w, size.l];
    return {
      dims: size,
      dimSrc: dims.dimSrc,
      mass: mass.mass,
      massSrc: mass.massSrc,
      dimRef: dims.dimRef,
      massRef: mass.massRef,
    };
  }

  static _rows(groups) {
    const rows = [];
    for (const group of groups || []) {
      for (const row of (group && group.rows) || []) {
        if (row && (row.k || row.v)) rows.push({ k: String(row.k || ''), v: String(row.v || ''), ref: row });
      }
    }
    return rows;
  }

  static _dims(rows) {
    let best = null;
    let prio = -1;
    for (const row of rows) {
      const key = row.k.toLowerCase();
      if (!/габарит|размер|д\s*[×xх*]\s*ш|длина\s*[×xх*]/i.test(key) || this.DIM_SKIP.test(key)) continue;
      const sizes = this.triple(row.v, key);
      if (!sizes) continue;
      const order = /ш\s*[×xх*]\s*д/i.test(key) || /ширина\s*[×xх*]\s*длина/i.test(row.v) ? 'wlh' : 'lwh';
      const rank = this._dimRank(key);
      if (rank <= prio) continue;
      prio = rank;
      best = { dims: this._ordered(sizes, order), dimSrc: `${row.k}: ${row.v}`, dimRef: { row: row.ref, order } };
    }
    return best;
  }

  static _dimRank(key) {
    if (/транспорт/i.test(key)) return 3;
    return /упаков/i.test(key) ? 2 : 1;
  }

  static _ordered([first, second, third], order) {
    return order === 'wlh' ? { l: second, w: first, h: third } : { l: first, w: second, h: third };
  }

  // отдельные строки «Длина», «Ширина», «Высота»
  static _separate(rows) {
    const one = pattern => {
      const usable = row => pattern.test(row.k) && !this.DIM_SKIP.test(row.k);
      const row = rows.find(item => usable(item) && !/открыт/i.test(item.k)) || rows.find(usable);
      return row ? this.len(row.v, row.k) : null;
    };
    const length = one(/^длина/i);
    const width = one(/^ширина/i);
    const height = one(this.HEIGHT);
    if (!(length && width && height)) return null;
    return { dims: { l: length, w: width, h: height }, dimSrc: 'Длина, ширина, высота', dimRef: { sep: true } };
  }

  static _mass(rows) {
    const out = { mass: null, massSrc: '', massRef: null };
    let prio = -1;
    for (const row of rows) {
      const weight = this._kg(row);
      const rank = weight == null ? -1 : this._massRank(row.k.toLowerCase());
      if (!(weight > 0 && weight < this.MAX_KG && rank > prio)) continue;
      prio = rank;
      Object.assign(out, { mass: weight / this.THOUSAND, massSrc: `${row.k}: ${row.v}`, massRef: row.ref });
    }
    return out;
  }

  static _kg(row) {
    const key = row.k.toLowerCase();
    if (!/масса|вес/.test(key) || /фреон|двигател|сух|масла|топлив|заправ|рабочий вес|вес\s*\(открыт/.test(key))
      return null;
    const match = String(row.v).match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(т|тонн|кг)?/i);
    if (!match) return null;
    const value = this.num(match[1]);
    if (value == null) return null;
    const unit = (match[2] || '').toLowerCase() || (/,\s*т\b|\(т\)/.test(key) ? 'т' : 'кг');
    return unit.startsWith('т') ? value * this.THOUSAND : value;
  }

  static _massRank(key) {
    if (/брутто|транспорт|в упаковке/.test(key)) return 3;
    return /^масса|^вес$/.test(key) ? 2 : 1;
  }

  /**
   * Записать массу и габариты в характеристики: в строку, из которой их прочитали, иначе — в группу «Габариты и масса».
   * @param {object} obj позиция КП или карточка каталога
   * @param {{l: number, w: number, h: number, m: number}} value м и т
   * @param {{dims?: boolean, mass?: boolean}} what что записать
   * @returns {number} сколько записано
   */
  static write(obj, value, what) {
    obj.groups = Array.isArray(obj.groups) ? obj.groups : [];
    const cargo = this.of(obj.groups);
    let count = 0;
    if (what.dims && value.l > 0 && value.w > 0 && value.h > 0) {
      this._writeDims(obj, cargo.dimRef, value);
      count++;
    }
    if (what.mass && value.m > 0) {
      const text = `${Math.round(value.m * this.THOUSAND)} кг`;
      if (cargo.massRef) cargo.massRef.v = text;
      else this._group(obj).rows.push({ k: 'Масса', v: text });
      count++;
    }
    return count;
  }

  static _mm(meters) {
    return String(Math.round(meters * LgCargo.THOUSAND));
  }

  static _writeDims(obj, ref, value) {
    const toMm = this._mm;
    const text =
      ref && ref.order === 'wlh'
        ? `${toMm(value.w)} × ${toMm(value.l)} × ${toMm(value.h)} мм`
        : `${toMm(value.l)} × ${toMm(value.w)} × ${toMm(value.h)} мм`;
    if (ref && ref.row) ref.row.v = text;
    else if (ref && ref.sep) this._writeSeparate(obj, value);
    else this._group(obj).rows.push({ k: 'Габариты Д × Ш × В', v: text });
  }

  static _writeSeparate(obj, value) {
    const toMm = this._mm;
    for (const group of obj.groups) {
      for (const row of group.rows || []) {
        const key = row.k || '';
        if (/^длина/i.test(key)) row.v = `${toMm(value.l)} мм`;
        else if (/^ширина/i.test(key)) row.v = `${toMm(value.w)} мм`;
        else if (this.HEIGHT.test(key)) row.v = `${toMm(value.h)} мм`;
      }
    }
  }

  static _group(obj) {
    let group = obj.groups.find(item => /габарит|масс/i.test(item.name || ''));
    if (!group) {
      group = { name: this.GROUP, rows: [] };
      obj.groups.push(group);
    }
    group.rows = group.rows || [];
    return group;
  }
}
