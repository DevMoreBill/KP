// Инженерные правила станций — из файла правил (stations.json или своя версия администратора); сервер отдаёт их
// скриптом /api/rules/stations.js: StationRules.use({...}).

export class StationRules {
  static data = null;
  static map = new Map();
  static _stamp = null;
  static STATUS = {
    confirmed: 'подтверждено источником',
    practice: 'отраслевая практика',
    unconfirmed: 'требует подтверждения',
  };

  /** Правила из файла: {version, rules: [{id, value, unit, source, status}], series: […]}. */
  static use(data) {
    if (!data || !Array.isArray(data.rules)) return;
    this.data = data;
    this.map = new Map(data.rules.map(rule => [rule.id, rule]));
    this._stamp = null;
  }

  /** Правила загружены. */
  static ok() {
    return !!this.data;
  }

  /** Версия файла правил. */
  static version() {
    return this.data ? String(this.data.version || '') : '';
  }

  /** Отпечаток значений: правка любого значения в «Настройках» пересобирает станции и картинки. */
  static stamp() {
    if (!this.data) return '';
    this._stamp ??= this.fnv(
      JSON.stringify([this.data.rules.map(rule => [rule.id, rule.value]), this.data.series || []]),
    );
    return this._stamp;
  }

  /** FNV-1a строки — 8 шестнадцатеричных знаков. */
  static fnv(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  /** Правило целиком; без правил расчёт не выполняется. */
  static rule(id) {
    const rule = this.map.get(id);
    if (!rule) throw new Error(`Нет инженерного правила «${id}» — файл правил станций не загружен или неполный`);
    return rule;
  }

  /** Значение правила (копия). */
  static value(id) {
    const value = this.rule(id).value;
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  /** Значение необязательного правила или null (в старой своей версии файла его может не быть). */
  static opt(id) {
    const rule = this.map.get(id);
    return rule ? rule.value : null;
  }

  /** Значение без копии — только для чтения. */
  static raw(id) {
    return this.rule(id).value;
  }

  /** Статус правила: confirmed, practice или unconfirmed. */
  static status(id) {
    return this.rule(id).status;
  }

  /** Источник: «документ, пункт». */
  static src(id) {
    const source = this.rule(id).source || {};
    return [source.doc, source.item].filter(Boolean).join(', ');
  }

  /** Коротко: документ без пояснений; статус — если не подтверждено. */
  static short(id) {
    const rule = this.rule(id);
    const source = rule.source || {};
    const docName = String(source.doc || '')
      .split(/\s*[(:]|\s+—\s+|;\s*/)[0]
      .trim();
    const doc = docName.length > 90 ? `${docName.slice(0, 88)}…` : docName;
    const tail = rule.status === 'confirmed' ? '' : ` — ${this.STATUS[rule.status]}`;
    return [doc, source.item].filter(Boolean).join(', ') + tail;
  }

  /** Данные производителя по серии позиции: производитель и выражение match по названию, модели, серии. */
  static series(part, kind) {
    const attrs = part?.attrs || {};
    const maker = String(attrs.maker || '').toLowerCase();
    const text = [part?.name, attrs.model, attrs.series].filter(Boolean).join(' ');
    const fits = entry => (!kind || entry.kind === kind) && String(entry.maker || '').toLowerCase() === maker;
    return this.data?.series?.find(entry => fits(entry) && this._matches(entry.match, text)) || null;
  }

  static _matches(pattern, text) {
    try {
      return new RegExp(pattern, 'i').test(text);
    } catch {
      return false;
    }
  }

  /** Линейная интерполяция по таблице [[x, y], …]; за краями — крайние значения. */
  static interp(table, x) {
    if (!Array.isArray(table) || !table.length || !Number.isFinite(x)) return null;
    if (x <= table[0][0]) return table[0][1];
    const i = table.findIndex(([tableX]) => x <= tableX);
    if (i < 0) return table.at(-1)[1];
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
}
