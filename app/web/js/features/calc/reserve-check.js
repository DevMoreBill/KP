/** Резерв агрегатов по ТЗ: резервных — не больше «агрегатов − 1»; в составе меньше, чем нужно по ТЗ, — ошибка расчёта. */
export class ReserveCheck {
  /** Слова по виду агрегата: сам агрегат и «резервный» в роде агрегата (ДГУ — установка). */
  static WORDS = {
    comp: { unit: ['компрессор', 'компрессора', 'компрессоров'], spare: ['резервный', 'резервных', 'резервных'] },
    dgu: { unit: ['ДГУ', 'ДГУ', 'ДГУ'], spare: ['резервная', 'резервные', 'резервных'] },
    pump: { unit: ['насос', 'насоса', 'насосов'], spare: ['резервный', 'резервных', 'резервных'] },
  };

  /**
   * Резервных для расчёта: по ТЗ, но хотя бы один агрегат — рабочий.
   * @param {object} req требования станции
   * @param {number} total агрегатов в составе
   * @returns {number}
   */
  static of(req, total) {
    return req.reserve == null ? 0 : Math.max(0, Math.min(req.reserve, total - 1));
  }

  /**
   * То же, и ошибка в записке, если резерв по ТЗ не обеспечен (раньше урезался молча).
   * @param {object} note записка расчёта (CalcNote)
   * @param {object} req
   * @param {number} total
   * @param {string} kind comp | dgu | pump
   * @returns {number}
   */
  static check(note, req, total, kind) {
    const res = this.of(req, total);
    if (total > 0 && req.reserve > res) note.issue('error', this._text(req.reserve, total, this.WORDS[kind]));
    return res;
  }

  static _text(reserve, total, words) {
    const spare = KPGen.plural(reserve, ...words.spare);
    return `Резерв по ТЗ не обеспечен: в составе ${total} ${KPGen.plural(total, ...words.unit)}, а по ТЗ ${reserve} ${spare} — нужно не меньше ${reserve + 1} ${words.unit[2]}.`;
  }
}
