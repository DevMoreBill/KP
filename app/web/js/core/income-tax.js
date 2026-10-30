/**
 * Налог с результата сделки по налогообложению продавца («Наши реквизиты» → «Налог на прибыль или УСН»): ОСНО — налог на
 * прибыль с прибыли (ставка — в «Деньгах и налоге» сделки); УСН «доходы» — с выручки без НДС, УСН «доходы минус расходы» —
 * с прибыли; ставка УСН — юрлица (регион может снизить), без неё — по НК РФ, ст. 346.20.
 */
export class IncomeTax {
  static INCOME = 'income';
  static PROFIT = 'profit';
  static PCT = 100;
  static OSNO = {
    rate: null,
    base: IncomeTax.PROFIT,
    name: 'Налог на прибыль',
    short: 'налог на прибыль',
    lower: 'налог на прибыль',
    gen: 'налога на прибыль',
    from: 'с прибыли',
    option: 'ОСНО — налог на прибыль',
  };
  static MODES = {
    income: {
      rate: 6,
      base: IncomeTax.INCOME,
      name: 'Налог УСН «доходы»',
      short: 'УСН «доходы»',
      lower: 'налог УСН',
      gen: 'налога УСН',
      from: 'с выручки без НДС',
      option: 'УСН «доходы» — 6 % с выручки',
      help: 'Продавец на УСН «доходы»: налог — с выручки без НДС, расходы сделки его не уменьшают (НК РФ, ст. 346.15, 346.20). Ставка — юрлица в «Настройки → Документы → Наши реквизиты», по закону 6 %, регион может снизить. Уменьшение налога на страховые взносы считается за год по всей компании — в сделке не учтено.',
    },
    profit: {
      rate: 15,
      base: IncomeTax.PROFIT,
      name: 'Налог УСН «доходы минус расходы»',
      short: 'УСН «доходы минус расходы»',
      lower: 'налог УСН',
      gen: 'налога УСН',
      from: 'с прибыли',
      option: 'УСН «доходы минус расходы» — 15 % с прибыли',
      help: 'Продавец на УСН «доходы минус расходы»: налог — с прибыли после всех расходов, как налог на прибыль (НК РФ, ст. 346.18, 346.20). Ставка — юрлица в «Настройки → Документы → Наши реквизиты», по закону 15 %, регион может снизить. Минимальный налог 1 % с доходов считается за год по всей компании — в сделке не учтён.',
    },
  };

  /**
   * Варианты поля юрлица: [значение, подпись]; пусто — ОСНО.
   * @returns {Array<[string, string]>}
   */
  static options() {
    return [['', this.OSNO.option], ...Object.entries(this.MODES).map(([mode, tax]) => [mode, tax.option])];
  }

  /**
   * Режим из поля юрлица: «income», «profit» или '' (ОСНО).
   * @param {string} value
   * @returns {string}
   */
  static mode(value) {
    const text = String(value ?? '');
    return Object.hasOwn(this.MODES, text) ? text : '';
  }

  /**
   * Описание режима: база, подписи, ставка по закону.
   * @param {string} mode
   * @returns {object}
   */
  static of(mode) {
    return this.MODES[this.mode(mode)] || this.OSNO;
  }

  /**
   * Ставка УСН, %: своя юрлица (не выше закона), иначе — по закону; при ОСНО — null.
   * @param {string} mode
   * @param {string} own
   * @returns {number|null}
   */
  static rate(mode, own) {
    const tax = this.of(mode);
    if (tax.rate == null) return null;
    const text = String(own ?? '').trim();
    const value = Number(text.replace(',', '.'));
    return text && Number.isFinite(value) && value >= 0 && value <= tax.rate ? value : tax.rate;
  }

  /**
   * Налог: с выручки или прибыли по режиму; база не больше нуля — 0.
   * @param {string} base «income» | «profit»
   * @param {{revenue: number, profit: number}} sums
   * @param {number} rate
   * @returns {number}
   */
  static amount(base, { revenue, profit }, rate) {
    const sum = base === this.INCOME ? revenue : profit;
    return sum > 0 ? (sum * rate) / this.PCT : 0;
  }
}
