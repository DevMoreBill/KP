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
  static use(d) {
    if (!d || !Array.isArray(d.rules)) return;
    this.data = d;
    this.map = new Map(d.rules.map(r => [r.id, r]));
    this._stamp = null;
  }

  static ok() {
    return !!this.data;
  }

  static version() {
    return this.data ? String(this.data.version || '') : '';
  }

  /** Отпечаток значений: правка любого значения в «Настройках» пересобирает станции и картинки. */
  static stamp() {
    if (!this.data) return '';
    this._stamp ??= this.fnv(JSON.stringify([this.data.rules.map(r => [r.id, r.value]), this.data.series || []]));
    return this._stamp;
  }

  /** FNV-1a строки — 8 шестнадцатеричных знаков. */
  static fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /** Правило целиком; без правил расчёт не выполняется. */
  static rule(id) {
    const r = this.map.get(id);
    if (!r) throw new Error(`Нет инженерного правила «${id}» — файл правил станций не загружен или неполный`);
    return r;
  }

  /** Значение правила (копия). */
  static v(id) {
    const v = this.rule(id).value;
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }

  /** Значение необязательного правила или null (в старой своей версии файла его может не быть). */
  static opt(id) {
    const r = this.map.get(id);
    return r ? r.value : null;
  }

  /** Значение без копии — только для чтения. */
  static raw(id) {
    return this.rule(id).value;
  }

  static status(id) {
    return this.rule(id).status;
  }

  /** Источник: «документ, пункт». */
  static src(id) {
    const s = this.rule(id).source || {};
    return [s.doc, s.item].filter(Boolean).join(', ');
  }

  /** Коротко: документ без пояснений; статус — если не подтверждено. */
  static short(id) {
    const r = this.rule(id);
    const s = r.source || {};
    const d = String(s.doc || '')
      .split(/\s*[(:]|\s+—\s+|;\s*/)[0]
      .trim();
    const doc = d.length > 90 ? `${d.slice(0, 88)}…` : d;
    const tail = r.status === 'confirmed' ? '' : ` — ${this.STATUS[r.status]}`;
    return [doc, s.item].filter(Boolean).join(', ') + tail;
  }

  /** Данные производителя по серии позиции: производитель и выражение match по названию, модели, серии. */
  static series(p, kind) {
    const a = p?.attrs || {};
    const maker = String(a.maker || '').toLowerCase();
    const text = [p?.name, a.model, a.series].filter(Boolean).join(' ');
    const fits = s => (!kind || s.kind === kind) && String(s.maker || '').toLowerCase() === maker;
    return this.data?.series?.find(s => fits(s) && this._matches(s.match, text)) || null;
  }

  static _matches(rx, text) {
    try {
      return new RegExp(rx, 'i').test(text);
    } catch {
      return false;
    }
  }

  /** Линейная интерполяция по таблице [[x, y], …]; за краями — крайние значения. */
  static interp(T, x) {
    if (!Array.isArray(T) || !T.length || !Number.isFinite(x)) return null;
    if (x <= T[0][0]) return T[0][1];
    const i = T.findIndex(([tx]) => x <= tx);
    if (i < 0) return T.at(-1)[1];
    const [x0, y0] = T[i - 1];
    const [x1, y1] = T[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
}
