import { TzImport } from './tz-import.js';

/** Вопросы заказчику по ТЗ — документ Word. */
export class TzQuestions {
  /** cur — окно разбора (TzImport.cur): вопросы, анкета, имя файла ТЗ. */
  static async download(cur) {
    const Q = cur.r.questions || [];
    const L = cur.r.later || [];
    if (!Q.length && !L.length) {
      toast('Вопросов нет — всё нужное найдено в ТЗ');
      return;
    }
    try {
      await LazyJs.load('tz-out/index.js');
      const b = await this.make(cur, Q, cur.r.fields || [], L);
      saveFileA(`Вопросы по ТЗ — ${TzOut.NAME(cur.name) || 'заказчик'}.docx`, b);
    } catch (e) {
      toast(`Не удалось подготовить документ: ${e?.message || e}`);
    }
  }

  static make(cur, Q, F, L = []) {
    const org = StationUi.org();
    const d = new DocxWriter({
      title: 'Вопросы по техническому заданию',
      author: org,
      footer: `Вопросы по ТЗ — ${cur.name || ''}`,
    });
    const mgr = S.manager || {};
    d.title1('Вопросы по техническому заданию');
    d.p([
      ['Документ: ', { b: true }],
      [cur.name || '', {}],
    ]).p([
      ['От: ', { b: true }],
      [org + (mgr.name ? `, ${mgr.name}` : '') + (mgr.phone ? `, ${mgr.phone}` : ''), {}],
    ]);
    this._asks(d, Q, L);
    if (F.length) this._taken(d, F);
    return d.pack('blob');
  }

  static _asks(d, Q, L) {
    if (Q.length) {
      d.p('Для подбора оборудования просим сообщить:', { before: 6 });
      d.items(Q);
    }
    if (!L.length) return;
    d.p(
      Q.length
        ? 'По возможности уточните также (без ответа расчёт выполнен по значениям с запасом):'
        : 'Расчёт выполнен по ТЗ; по возможности уточните (без ответа приняты значения с запасом):',
      { before: 6 },
    );
    d.items(L);
  }

  static _taken(d, F) {
    d.h2('Что принято из ТЗ');
    d.table(
      [50, 28, 28, 74],
      ['Параметр', 'Статус', 'Значение', 'Источник / почему'],
      F.map(f => [f.label, (TzImport.STATUS[f.status] || [''])[0], TzImport.val(f.key, f.value), this._source(f)]),
    );
  }

  /** Источник значения: цитата со страницей, разные значения или почему принято по умолчанию. */
  static _source(f) {
    if (f.status === 'found') return (f.page ? `стр. ${f.page}: ` : '') + (f.src || '');
    if (f.status === 'conflict')
      return (f.values || []).map(v => TzImport.val(f.key, v.value) + (v.page ? ` (стр. ${v.page})` : '')).join('; ');
    return f.why || '';
  }
}
