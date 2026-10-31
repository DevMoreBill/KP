/** Значения разбора ТЗ: состояние поля и показ значения (окно разбора и вопросы заказчику). */
export class TzValues {
  static STATUS = {
    found: ['найдено в ТЗ', 'on'],
    default: ['принято по умолчанию', 'warn'],
    missing: ['отсутствует', 'off'],
    conflict: ['противоречие', 'bad'],
  };

  /** Значения выбора — словами. */
  static VAL = {
    basis: { fad: 'FAD — на выходе компрессора', normal: 'нормальные м³ (0 °C)', std: 'стандартные м³ (20 °C)' },
    mode: { prime: 'основной (PRP)', standby: 'резервный (ESP)' },
    start: {
      direct: 'прямой',
      stardelta: 'звезда — треугольник',
      soft: 'плавный пуск',
      vsd: 'частотный преобразователь',
    },
    reserve: { 0: 'без резерва', 1: 'N + 1', 2: 'N + 2' },
    rel: { 1: 'I', 2: 'II', 3: 'III' },
    industry: {
      food: 'пищевая — компрессоры безмасляные',
      med: 'медицинская, фармацевтическая — компрессоры безмасляные',
    },
  };

  /** Значение не задано: нет или пустая строка. */
  static empty(value) {
    return value == null || value === '';
  }

  /** Значение параметра анкеты словами. */
  static val(key, value) {
    if (value === true) return 'да';
    if (this.empty(value)) return '—';
    const names = this.VAL[key];
    if (names && names[value] != null) return names[value];
    return String(value)
      .replace('.', ',')
      .replace(/^-(?=\d)/, '−');
  }
}
