import { DocxWriter } from '../doc/docx-writer.js';
import { LayoutDigest } from '../layout/layout-digest.js';
import { StationUi } from '../station/station-ui.js';
import { Toast } from '../../core/toast.js';
import { FileSave } from '../../core/files.js';
import { Api } from '../../core/net.js';

/** Документ «Инженерные правила и источники» (DOCX) и общий вид значений правил. */
export class StationRulesDoc {
  static STATUS = { confirmed: 'Подтверждено', practice: 'Практика', unconfirmed: 'Требует подтверждения' };
  static KIND = { dryer: 'Осушители', filter: 'Фильтры', genset: 'ДГУ' };

  /** Значение правила текстом: число, таблица [[x, y]], список, параметры {ключ: значение}. */
  static val(value, unit) {
    const num = x => (typeof x === 'number' ? String(x).replace('.', ',').replace('-', '−') : String(x));
    let text;
    if (Array.isArray(value))
      text = value.every(row => Array.isArray(row) && row.length === 2)
        ? value.map(([x, y]) => `${num(x)} → ${num(y)}`).join('; ')
        : value.map(x => (Array.isArray(x) ? x.map(num).join(' — ') : num(x))).join('; ');
    else if (value && typeof value === 'object')
      text = Object.entries(value)
        .map(([k, x]) => `${k}: ${x && typeof x === 'object' ? this.val(x) : num(x)}`)
        .join('; ');
    else text = num(value);
    return unit && !Array.isArray(value) && (!value || typeof value !== 'object') ? `${text} ${unit}` : text;
  }
  /** Источник правила одной строкой. */
  static src(source) {
    return (
      [source && source.doc, source && source.item].filter(Boolean).join(', ') +
      (source && source.url ? ` — ${source.url}` : '')
    );
  }

  /** Правила с сервера (действующая версия). */
  static async load() {
    return (await Api.request('/api/rules/stations')).rules;
  }

  /** Скачать документ «Инженерные правила и источники». */
  static async download() {
    try {
      const data = await this.load();
      FileSave.download(
        `Инженерные правила и источники — ${String(data.version || '').replace(/[\\/:*?"<>|]+/g, ' ')}.docx`,
        await this.make(data),
      );
    } catch (err) {
      Toast.show(`Не удалось подготовить документ: ${(err && err.message) || err}`);
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
  static make(data) {
    const doc = new DocxWriter({
      title: 'Инженерные правила и источники',
      author: StationUi.org(),
      footer: `Инженерные правила и источники — версия ${data.version || ''}`,
    });
    const rules = data.rules || [];
    this._intro(doc, data, rules);
    this._digest(doc);
    const groups = this._groups(doc, rules);
    this._series(doc, data.series || [], groups.length + 1);
    this._unconfirmed(doc, rules);
    return doc.pack('blob');
  }

  static _intro(doc, data, rules) {
    const cnt = k => rules.filter(rule => rule.status === k).length;
    doc.title1('Инженерные правила и источники');
    doc.para(
      `Расчёт модульных станций (компрессорных и дизель-генераторных) — версия правил ${data.version || '—'} от ${data.date || '—'}. Правил: ${rules.length}; подтверждено источником — ${cnt('confirmed')}, отраслевая практика — ${cnt('practice')}, требует подтверждения — ${cnt('unconfirmed')}. Данных производителей по сериям: ${(data.series || []).length}.`,
      { align: 'center' },
    );
    doc.heading('Как читать');
    doc.items(this.HOW);
  }

  static _digest(doc) {
    doc.heading('Свод правил компоновки');
    doc.para(
      'Как программа компонует станцию — по действующим значениям этой версии правил (правятся в «Настройки → Инженерные правила станций → Правила компоновки»).',
    );
    for (const line of LayoutDigest.sections()) {
      doc.para(line.h, { run: { b: true }, keep: true });
      doc.items(line.items);
    }
  }

  static _groups(doc, rules) {
    const groups = [...new Set(rules.map(rule => rule.group || 'Прочее'))];
    groups.forEach((group, index) => {
      doc.heading(`${index + 1}. ${group}`);
      const rows = rules
        .filter(rule => (rule.group || 'Прочее') === group)
        .map((rule, k) => this._ruleRow(rule, `${index + 1}.${k + 1}`));
      doc.table([10, 46, 44, 60, 20], ['№', 'Правило', 'Значение', 'Источник', 'Статус'], rows);
    });
    return groups;
  }

  static _ruleRow(rule, index) {
    const title = [
      [rule.title, { b: true }],
      ...(rule.note ? [[`\n${rule.note}`, { sz: 8.5, color: '5E6984' }]] : []),
      [`\n${rule.id}`, { sz: 8, color: '8A94A8' }],
    ];
    return [
      index,
      title,
      this.val(rule.value, rule.unit),
      this.src(rule.source),
      this.STATUS[rule.status] || rule.status,
    ];
  }

  static _series(doc, series, index) {
    if (!series.length) return;
    doc.heading(`${index}. Данные производителей по сериям`);
    doc.para(
      'Поправочные коэффициенты производителя применяются, если позиция каталога относится к серии (производитель и выражение по названию, модели, серии). Производительность с поправками = номинал × Fдавление × Fвход × Fокружающая.',
    );
    const factors = entry =>
      Object.entries(entry.f || {})
        .map(([k, table]) => `${this.FACTOR[k] || k}: ${this.val(table)}`)
        .join('\n');
    const rows = series.map(entry => [
      `${this.KIND[entry.kind] || entry.kind}, ${entry.maker}`,
      [
        [entry.title || '', { b: true }],
        [`\n${entry.note || ''}`, { sz: 8.5, color: '5E6984' }],
      ],
      factors(entry),
      this.src(entry.source),
    ]);
    doc.table([28, 34, 70, 48], ['Вид, производитель', 'Серия', 'Поправки', 'Источник'], rows);
  }

  static _unconfirmed(doc, rules) {
    const unconfirmed = rules.filter(rule => rule.status === 'unconfirmed');
    if (!unconfirmed.length) return;
    doc.heading('Требует подтверждения — что запросить');
    doc.items(
      unconfirmed.map(
        rule =>
          `${rule.title} (${rule.id}) — сейчас ${this.val(rule.value, rule.unit)}${rule.note ? `. ${rule.note}` : ''}`,
      ),
    );
  }
}
