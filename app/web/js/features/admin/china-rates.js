/** Ставки экспедиторов файлом: шаблон Excel, загрузка .xlsx / .csv (столбцы — по заголовкам, значения — по словам), запрос экспедитору. */
export class ChinaRateBook {
  // поле → заголовок столбца шаблона, как узнать заголовок в чужом файле
  static COLS = [
    ['from', 'Откуда (город в Китае или место прибытия)', /^откуда|отправлен|^from/],
    ['to', 'Куда (место прибытия в ЕАЭС или город в РФ)', /^куда|назначен|^to$/],
    ['scope', 'Участок', /участок|scope/],
    ['kind', 'Вид перевозки', /^вид|перевозк|транспорт|kind/],
    ['price', 'Ставка', /^ставка|^цена|^стоимост|price|rate/],
    ['cur', 'Валюта', /валют|cur/],
    ['unit', 'За (рейс / кг / м³)', /^за($|[\s(])|единиц|unit/],
    ['min', 'Минимальная сумма', /^мин|миним|min/],
    ['days', 'Срок в пути, дн.', /срок|дн|days/],
    ['until', 'Действует до', /действ|до\s*даты|valid|until/],
    ['who', 'Экспедитор', /экспедит|перевозчик|компан|who/],
    ['note', 'Примечание', /примеч|коммент|note/],
  ];
  static MAX = 300;
  static MAX_DAYS = 365;
  static DAY_MS = 864e5;
  static EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  static ISO_DAY = 10;
  // значение из файла → код таблицы: первое совпавшее слово
  static SCOPES = [
    [/по рф|по росси|после|от места|after/, 'after'],
    [/сквозн|through/, 'through'],
    [/^$|до (места|границ|пункта пропуска)|прибыт|border/, 'border'],
  ];
  static KINDS = [
    [/сборн|ltl|lcl/, 'ltl'],
    [/негабарит|трал|tral/, 'tral'],
    [/фура|тент|ftl/, 'ftl'],
    [/контейнер|docker|fcl/, 'docker'],
    [/машин|авто|truck/, 'ftl'],
  ];
  static UNITS = [
    [/^$|рейс|контейнер|машин|фур|trip/, 'trip'],
    [/кг|kg|килограм/, 'kg'],
    [/м3|м³|куб|cbm|m3/, 'm3'],
  ];
  static CURS = [
    [/cny|rmb|юан|¥/, 'CNY'],
    [/usd|\$|доллар/, 'USD'],
    [/eur|€|евро/, 'EUR'],
    [/rub|руб|₽|^р$/, 'RUB'],
  ];
  static SAMPLE = {
    from: 'Шанхай',
    to: 'Забайкальск',
    scope: 'border',
    kind: 'ftl',
    price: 21000,
    cur: 'CNY',
    unit: 'trip',
    days: 12,
    until: '',
    who: 'Экспедитор',
    note: 'пример — замените',
  };
  static WIDTHS = [22, 22, 24, 22, 12, 8, 18, 12, 10, 13, 22, 30];
  static HOW_WIDTHS = [22, 100];
  static REQUEST_WIDTH = 120;

  /**
   * Текст для сравнения: строчные, «ё» → «е», одиночные пробелы.
   * @param {*} text
   * @returns {string}
   */
  static norm(text) {
    return String(text ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static _code(table, text) {
    const value = this.norm(text);
    return (table.find(([words]) => words.test(value)) || [null, ''])[1];
  }

  /**
   * Участок из файла → код ('' — не узнан).
   * @param {*} text
   * @returns {string}
   */
  static scope(text) {
    return this._code(this.SCOPES, text);
  }

  /**
   * Вид перевозки из файла → код.
   * @param {*} text
   * @returns {string}
   */
  static kind(text) {
    return this._code(this.KINDS, text);
  }

  /**
   * «За» из файла → код.
   * @param {*} text
   * @returns {string}
   */
  static unit(text) {
    return this._code(this.UNITS, text);
  }

  /**
   * Валюта из файла → код.
   * @param {*} text
   * @returns {string}
   */
  static cur(text) {
    return this._code(this.CURS, text);
  }

  /**
   * Число из ячейки (NaN — не число).
   * @param {*} text
   * @returns {number}
   */
  static num(text) {
    if (typeof text === 'number') return text;
    const clean = String(text ?? '')
      .replace(/[\s ]/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '');
    return clean ? +clean : NaN;
  }

  /**
   * Дата: число Excel, ДД.ММ.ГГГГ или ГГГГ-ММ-ДД → ГГГГ-ММ-ДД ('' — пусто, null — не дата).
   * @param {*} text
   * @returns {string|null}
   */
  static date(text) {
    const value = String(text ?? '').trim();
    if (text == null || value === '') return '';
    if (/^\d{5}(\.\d+)?$/.test(value))
      return new Date(this.EXCEL_EPOCH + Math.floor(+text) * this.DAY_MS).toISOString().slice(0, this.ISO_DAY);
    const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
    if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return iso ? iso[0] : null;
  }

  static _columns(lines, headIndex) {
    const head = lines[headIndex].map(cell => this.norm(cell));
    const columns = {};
    for (const [key, , words] of this.COLS) {
      const index = head.findIndex((title, col) => words.test(title) && !Object.values(columns).includes(col));
      if (index >= 0) columns[key] = index;
    }
    return columns;
  }

  static _rate(value) {
    return {
      from: value('from'),
      to: value('to'),
      scope: this.scope(value('scope')),
      kind: this.kind(value('kind')),
      price: this.num(value('price')),
      cur: this.cur(value('cur')),
      unit: this.unit(value('unit')),
      min: value('min') ? this.num(value('min')) : '',
      days: value('days') ? Math.round(this.num(value('days'))) : '',
      until: this.date(value('until')),
      who: value('who'),
      note: value('note'),
    };
  }

  static _why(rate) {
    return [...this._missing(rate), ...this._wrong(rate)].filter(Boolean);
  }

  static _missing(rate) {
    return [
      !rate.from && '«Откуда»',
      !rate.to && '«Куда»',
      !(rate.price > 0) && 'ставка',
      !rate.kind && 'вид перевозки',
      !rate.scope && 'участок',
      !rate.unit && '«За»',
      !rate.cur && 'валюта',
    ];
  }

  static _wrong(rate) {
    return [
      rate.min !== '' && !(rate.min >= 0) && 'минимальная сумма',
      rate.days !== '' && !(rate.days >= 0 && rate.days <= this.MAX_DAYS) && 'срок',
      rate.until === null && 'дата «Действует до»',
    ];
  }

  /**
   * Строки файла ([[ячейки]]) → {rows, bad:[«строка N: причина»]}; заголовок — первая строка с «Откуда» и «Ставка».
   * @param {Array<Array<*>>} lines
   * @returns {{rows: object[], bad: string[]}}
   */
  static parse(lines) {
    const headIndex = lines.findIndex(
      line =>
        line.some(cell => /^откуда|^from/.test(this.norm(cell))) &&
        line.some(cell => /^ставка|^цена|^стоимост|price|rate/.test(this.norm(cell))),
    );
    if (headIndex < 0)
      throw new Error(
        'не найдена строка заголовков со столбцами «Откуда» и «Ставка» — возьмите шаблон кнопкой «Шаблон Excel»',
      );
    const columns = this._columns(lines, headIndex);
    const rows = [];
    const bad = [];
    for (let line = headIndex + 1; line < lines.length && rows.length < this.MAX; line++) {
      const cells = lines[line];
      const value = key => (columns[key] == null ? '' : String(cells[columns[key]] ?? '').trim());
      if (!value('from') && !value('to') && !value('price')) continue;
      const rate = this._rate(value);
      const why = this._why(rate);
      if (why.length) bad.push(`строка ${line + 1}: ${why.join(', ')}`);
      else rows.push(rate);
    }
    return { rows, bad };
  }

  static _csvLine(text, sep) {
    const out = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted && char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = !quoted;
      else if (!quoted && char === sep) {
        out.push(cell);
        cell = '';
      } else cell += char;
    }
    out.push(cell);
    return out;
  }

  /**
   * Файл .xlsx / .csv → строки ячеек.
   * @param {File} file
   * @returns {Promise<Array<string[]>>}
   */
  static async lines(file) {
    if (/\.xlsx$/i.test(file.name)) return LgTariffFile.readXlsx(await file.arrayBuffer());
    const text = (await file.text()).replace(/^﻿/, '');
    const first = text.split('\n')[0];
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    return text
      .split(/\r?\n/)
      .map(line => this._csvLine(line, sep))
      .filter(row => row.some(cell => cell.trim()));
  }

  /**
   * Текст запроса экспедитору по полям расчёта: участки раздельно, срок действия, что включено.
   * @param {object} query поля расчёта
   * @param {object} state ответ сервера (виды, условия)
   * @returns {string}
   */
  static request(query, state) {
    return [...this._cargo(query, state), ...this._asks(query)].join('\n');
  }

  static _cargo(query, state) {
    const kind = (state.kinds[query.kind] || '').toLowerCase();
    const terms = (state.terms[query.terms] || query.terms || '').split(' — ')[0];
    return [
      'Здравствуйте! Просим рассчитать перевозку из Китая.',
      `Маршрут: ${query.from || '(город в Китае)'} → ${query.to || '(пункт пропуска)'}${query.dest ? ` → ${query.dest}` : ''}.`,
      `Груз: ${kind}${query.kg ? `, вес брутто ${query.kg} кг` : ''}${query.m3 ? `, объём ${query.m3} м³` : ''}. Условия поставки: ${terms}.`,
    ];
  }

  static _asks(query) {
    return [
      'Прошу в ответе:',
      `1) отдельной суммой — стоимость до места прибытия на территорию ЕАЭС (${query.to || 'пункт пропуска'}), включая погрузку, перевалку и оформление на границе;`,
      `2) отдельной суммой — стоимость по территории ${/казахстан|достык|хоргос/i.test(query.to || '') ? 'ЕАЭС (Казахстан и РФ)' : 'РФ'} от места прибытия${query.dest ? ` до пункта назначения: ${query.dest}` : ''};`,
      '3) эти суммы так же раздельно указать в договоре и счёте (ТК ЕАЭС ст. 40 п. 2 — для таможенной стоимости);',
      '4) валюту, за что ставка (рейс / кг / м³), минимальную сумму, срок в пути и до какой даты действует ставка;',
      '5) что не входит в ставку (экспортное оформление в Китае, страхование, хранение, простой).',
      'Удобнее всего — в приложенном файле Excel (лист «Ставки»).',
    ];
  }

  static _dataRow(rate, state) {
    const label = (map, key) => map[key] || key;
    return [
      rate.from,
      rate.to,
      label(state.scopes, rate.scope || 'border'),
      label(state.kinds, rate.kind),
      { v: +rate.price, s: 'tdMoney2' },
      rate.cur,
      label(state.units, rate.unit || 'trip'),
      rate.min ? { v: +rate.min, s: 'tdMoney2' } : '',
      rate.days ?? '',
      rate.until ? { v: XlsxBook.date(rate.until), s: 'tdDate' } : '',
      rate.who || '',
      rate.note || '',
    ].map(cell => (typeof cell === 'object' ? cell : { v: cell, s: 'td' }));
  }

  static _how(state) {
    return [
      [{ v: 'Как заполнить лист «Ставки»', s: 'title' }],
      [],
      ...[
        [
          'Откуда / Куда',
          'Город в Китае и место прибытия (Забайкальск, Пограничный, Достык, Хоргос…). Для участка «по РФ»: откуда — место прибытия, куда — город в РФ.',
        ],
        [
          'Участок',
          `${Object.values(state.scopes).join(' / ')}. Для таможенной стоимости нужна ставка «до места прибытия» — отдельно от участка по РФ (ТК ЕАЭС ст. 40 п. 2).`,
        ],
        ['Вид перевозки', Object.values(state.kinds).join(' / ')],
        ['Ставка, Валюта', `Число и валюта: ${state.curs.join(', ')}.`],
        [
          'За',
          `${Object.values(state.units).join(' / ')}. Сборный груз: две строки — «за кг» и «за м³», программа берёт большее.`,
        ],
        ['Минимальная сумма', 'Если есть — в той же валюте.'],
        ['Действует до', 'Дата ДД.ММ.ГГГГ: после неё ставка в расчёте помечается просроченной.'],
      ].map(([title, text]) => [
        { v: title, s: 'bold' },
        { v: text, s: 'text' },
      ]),
    ];
  }

  /**
   * Шаблон: «Ставки» (текущие строки таблицы или пример), «Как заполнить», «Запрос экспедитору».
   * @param {object[]} rows
   * @param {object} query
   * @param {object} state
   * @returns {Promise<Blob>}
   */
  static async template(rows, query, state) {
    const head = this.COLS.map(col => ({ v: col[1], s: 'head' }));
    const data = (rows.length ? rows : [this.SAMPLE]).map(rate => this._dataRow(rate, state));
    const request = [
      [{ v: 'Запрос экспедитору', s: 'title' }],
      [],
      ...this.request(query, state)
        .split('\n')
        .map(line => [{ v: line, s: 'text' }]),
    ];
    return XlsxBook.make(
      [
        { name: 'Ставки', cols: this.WIDTHS, rows: [head, ...data], freeze: 1 },
        { name: 'Как заполнить', cols: this.HOW_WIDTHS, rows: this._how(state) },
        { name: 'Запрос экспедитору', cols: [this.REQUEST_WIDTH], rows: request },
      ],
      'Ставки экспедиторов Китай',
    );
  }
}
