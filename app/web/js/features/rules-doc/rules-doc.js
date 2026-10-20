import { LayoutDigest } from '../layout/layout-digest.js';

/** Документ «Инженерные правила и источники» (DOCX) и общий вид значений правил. */
export class StationRulesDoc {
  static STATUS = { confirmed: 'Подтверждено', practice: 'Практика', unconfirmed: 'Требует подтверждения' };
  static KIND = { dryer: 'Осушители', filter: 'Фильтры', genset: 'ДГУ' };

  /** Значение правила текстом: число, таблица [[x, y]], список, параметры {ключ: значение}. */
  static val(v, unit) {
    const n = x => (typeof x === 'number' ? String(x).replace('.', ',').replace('-', '−') : String(x));
    let t;
    if (Array.isArray(v))
      t = v.every(r => Array.isArray(r) && r.length === 2)
        ? v.map(([x, y]) => `${n(x)} → ${n(y)}`).join('; ')
        : v.map(x => (Array.isArray(x) ? x.map(n).join(' — ') : n(x))).join('; ');
    else if (v && typeof v === 'object')
      t = Object.entries(v)
        .map(([k, x]) => `${k}: ${x && typeof x === 'object' ? this.val(x) : n(x)}`)
        .join('; ');
    else t = n(v);
    return unit && !Array.isArray(v) && (!v || typeof v !== 'object') ? `${t} ${unit}` : t;
  }
  static src(s) {
    return [s && s.doc, s && s.item].filter(Boolean).join(', ') + (s && s.url ? ` — ${s.url}` : '');
  }

  /** Правила с сервера (действующая версия). */
  static async load() {
    return (await api('/api/rules/stations')).rules;
  }

  static async download() {
    try {
      const d = await this.load();
      saveFileA(
        `Инженерные правила и источники — ${String(d.version || '').replace(/[\\/:*?"<>|]+/g, ' ')}.docx`,
        await this.make(d),
      );
    } catch (e) {
      toast(`Не удалось подготовить документ: ${(e && e.message) || e}`);
    }
  }

  static HOW = [
    'Подтверждено — значение взято из нормативного документа или каталога производителя (указан пункт или страница).',
    'Практика — принятое в отрасли значение (методическая литература, руководства производителей), обязательной нормы нет.',
    'Требует подтверждения — значение принято программой до получения данных производителя или заказчика; в расчётной записке такие пункты перечисляются отдельно и в КП попадают в раздел «Требует подтверждения».',
    'Правило меняется только новой версией файла правил («Настройки» → «Инженерные правила станций»): прежняя версия сохраняется, вернуть файл поставки можно одной кнопкой.',
  ];
  static FACTOR = { p: 'давление, бар', inlet: 'вход, °C', ambient: 'окружающая, °C' };

  /** Документ .docx (Blob). */
  static make(d) {
    const w = new DocxWriter({
      title: 'Инженерные правила и источники',
      author: typeof StationUi !== 'undefined' ? StationUi.org() : 'ПНЕВМОТЕХ',
      footer: `Инженерные правила и источники — версия ${d.version || ''}`,
    });
    const R = d.rules || [];
    this._intro(w, d, R);
    this._digest(w);
    const groups = this._groups(w, R);
    this._series(w, d.series || [], groups.length + 1);
    this._unconfirmed(w, R);
    return w.pack('blob');
  }

  static _intro(w, d, R) {
    const cnt = k => R.filter(r => r.status === k).length;
    w.title1('Инженерные правила и источники');
    w.p(
      `Расчёт модульных станций (компрессорных и дизель-генераторных) — версия правил ${d.version || '—'} от ${d.date || '—'}. Правил: ${R.length}; подтверждено источником — ${cnt('confirmed')}, отраслевая практика — ${cnt('practice')}, требует подтверждения — ${cnt('unconfirmed')}. Данных производителей по сериям: ${(d.series || []).length}.`,
      { align: 'center' },
    );
    w.h1('Как читать');
    w.items(this.HOW);
  }

  static _digest(w) {
    w.h1('Свод правил компоновки');
    w.p(
      'Как программа компонует станцию — по действующим значениям этой версии правил (правятся в «Настройки → Инженерные правила станций → Правила компоновки»).',
    );
    for (const s of LayoutDigest.sections()) {
      w.p(s.h, { run: { b: true }, keep: true });
      w.items(s.items);
    }
  }

  static _groups(w, R) {
    const groups = [...new Set(R.map(r => r.group || 'Прочее'))];
    groups.forEach((g, gi) => {
      w.h1(`${gi + 1}. ${g}`);
      const rows = R.filter(r => (r.group || 'Прочее') === g).map((r, k) => this._ruleRow(r, `${gi + 1}.${k + 1}`));
      w.table([10, 46, 44, 60, 20], ['№', 'Правило', 'Значение', 'Источник', 'Статус'], rows);
    });
    return groups;
  }

  static _ruleRow(r, no) {
    const title = [
      [r.title, { b: true }],
      ...(r.note ? [[`\n${r.note}`, { sz: 8.5, color: '5E6984' }]] : []),
      [`\n${r.id}`, { sz: 8, color: '8A94A8' }],
    ];
    return [no, title, this.val(r.value, r.unit), this.src(r.source), this.STATUS[r.status] || r.status];
  }

  static _series(w, S, no) {
    if (!S.length) return;
    w.h1(`${no}. Данные производителей по сериям`);
    w.p(
      'Поправочные коэффициенты производителя применяются, если позиция каталога относится к серии (производитель и выражение по названию, модели, серии). Производительность с поправками = номинал × Fдавление × Fвход × Fокружающая.',
    );
    const factors = s =>
      Object.entries(s.f || {})
        .map(([k, T]) => `${this.FACTOR[k] || k}: ${this.val(T)}`)
        .join('\n');
    const rows = S.map(s => [
      `${this.KIND[s.kind] || s.kind}, ${s.maker}`,
      [
        [s.title || '', { b: true }],
        [`\n${s.note || ''}`, { sz: 8.5, color: '5E6984' }],
      ],
      factors(s),
      this.src(s.source),
    ]);
    w.table([28, 34, 70, 48], ['Вид, производитель', 'Серия', 'Поправки', 'Источник'], rows);
  }

  static _unconfirmed(w, R) {
    const U = R.filter(r => r.status === 'unconfirmed');
    if (!U.length) return;
    w.h1('Требует подтверждения — что запросить');
    w.items(U.map(r => `${r.title} (${r.id}) — сейчас ${this.val(r.value, r.unit)}${r.note ? `. ${r.note}` : ''}`));
  }
}
