import { DocxWriter } from '../doc/docx-writer.js';
import { TzImport } from './tz-import.js';

/** Вопросы заказчику по ТЗ — документ Word. */
export class TzQuestions {
  /** cur — окно разбора (TzImport.cur): вопросы, анкета, имя файла ТЗ. */
  static async download(cur) {
    const questions = cur.r.questions || [];
    const later = cur.r.later || [];
    if (!questions.length && !later.length) {
      toast('Вопросов нет — всё нужное найдено в ТЗ');
      return;
    }
    try {
      await LazyJs.load('tz-out/index.js');
      const blob = await this.make(cur, questions, cur.r.fields || [], later);
      saveFileA(`Вопросы по ТЗ — ${TzOut.NAME(cur.name) || 'заказчик'}.docx`, blob);
    } catch (err) {
      toast(`Не удалось подготовить документ: ${err?.message || err}`);
    }
  }

  /** Документ Word с вопросами. */
  static make(cur, questions, fields, later = []) {
    const org = StationUi.org();
    const doc = new DocxWriter({
      title: 'Вопросы по техническому заданию',
      author: org,
      footer: `Вопросы по ТЗ — ${cur.name || ''}`,
    });
    const mgr = S.manager || {};
    doc.title1('Вопросы по техническому заданию');
    doc
      .para([
        ['Документ: ', { b: true }],
        [cur.name || '', {}],
      ])
      .para([
        ['От: ', { b: true }],
        [org + (mgr.name ? `, ${mgr.name}` : '') + (mgr.phone ? `, ${mgr.phone}` : ''), {}],
      ]);
    this._asks(doc, questions, later);
    if (fields.length) this._taken(doc, fields);
    return doc.pack('blob');
  }

  static _asks(doc, questions, later) {
    if (questions.length) {
      doc.para('Для подбора оборудования просим сообщить:', { before: 6 });
      doc.items(questions);
    }
    if (!later.length) return;
    doc.para(
      questions.length
        ? 'По возможности уточните также (без ответа расчёт выполнен по значениям с запасом):'
        : 'Расчёт выполнен по ТЗ; по возможности уточните (без ответа приняты значения с запасом):',
      { before: 6 },
    );
    doc.items(later);
  }

  static _taken(doc, fields) {
    doc.subheading('Что принято из ТЗ');
    doc.table(
      [50, 28, 28, 74],
      ['Параметр', 'Статус', 'Значение', 'Источник / почему'],
      fields.map(field => [
        field.label,
        (TzImport.STATUS[field.status] || [''])[0],
        TzImport.val(field.key, field.value),
        this._source(field),
      ]),
    );
  }

  /** Источник значения: цитата со страницей, разные значения или почему принято по умолчанию. */
  static _source(field) {
    if (field.status === 'found') return (field.page ? `стр. ${field.page}: ` : '') + (field.src || '');
    if (field.status === 'conflict')
      return (field.values || [])
        .map(value => TzImport.val(field.key, value.value) + (value.page ? ` (стр. ${value.page})` : ''))
        .join('; ');
    return field.why || '';
  }
}
