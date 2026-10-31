import { KpTrack } from './kp-track.js';
import { Toast } from '../../core/toast.js';
import { XlsxBook } from '../../core/xlsx.js';
import { FileSave } from '../../core/files.js';
import { esc } from '../../core/util.js';
import { FEAT } from '../../core/features.js';
import { KpDate } from '../../core/kp-date.js';
import { ShortName } from './short-name.js';

/** Вид отчёта по КП: плитки и таблицы в окне, книга Excel. Прибыль и маржа — только при включённой экономике сделки. */
export class KpReportView {
  static PERCENT = 100;
  static KOPECKS = 100;
  // экономика сделки выключена — без прибыли, закупки и маржи (номера столбцов листа)
  static NO_DEAL = { Менеджеры: [7, 8], Категории: [5, 6, 7, 8], КП: [6] };

  /**
   * Доля в процентах с одним знаком.
   * @param {number} part
   * @param {number} whole
   * @returns {string}
   */
  static pct(part, whole) {
    return whole ? `${((part / whole) * this.PERCENT).toFixed(1).replace('.', ',')} %` : '—';
  }

  /**
   * Конверсия: выиграно из закрытых.
   * @param {{won: number, lost: number}} row
   * @returns {string}
   */
  static conv(row) {
    return row.won + row.lost ? `${Math.round((row.won / (row.won + row.lost)) * this.PERCENT)} %` : '—';
  }

  static _rub(value) {
    return `${KPGen.money(value || 0)} ₽`;
  }

  static _tile(label, value, sub = '') {
    return `<div class="rp-t"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  }

  // столбец: [заголовок, (строка) => ячейка, числовой, только при экономике]
  static _table(cols, rows) {
    const deal = FEAT.on('deal');
    const shown = cols.filter(col => deal || !col[3]);
    const head = shown.map(col => `<th>${col[0]}</th>`).join('');
    const body = rows
      .map(row => `<tr>${shown.map(col => `<td${col[2] ? ' class="n"' : ''}>${col[1](row)}</td>`).join('')}</tr>`)
      .join('');
    return `<div class="rp-tw"><table class="rp-tb"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  static _cols() {
    const rub = field => row => this._rub(row[field]);
    const num = field => row => row[field];
    return {
      name: row => esc(row.name),
      num,
      rub,
      conv: row => this.conv(row),
      won: row => `${row.won} · ${this._rub(row.wonSum)}`,
    };
  }

  /**
   * Отчёт в окне.
   * @param {object} data KpReport.calc
   * @returns {string}
   */
  static html(data) {
    if (!data.list.length) return '<p class="empty">За этот период КП нет.</p>';
    const deal = FEAT.on('deal');
    return `${this._tiles(data.tot, deal)}
      <h4>По менеджерам</h4>${this._managers(data.mgr)}
      <h4>По категориям оборудования${deal ? ' <span class="muted">— прибыль по позициям с закупкой, без логистики и финансирования</span>' : ''}</h4>${this._categories(data.cat)}
      <h4>Крупнейшие клиенты</h4>${this._clients(data.cli)}
      <details class="rp-all"><summary>Все КП периода (${data.list.length})</summary>${this._list(data.list)}</details>`;
  }

  static _tiles(total, deal) {
    const profit = deal
      ? this._tile(
          'Прибыль',
          this._rub(total.profit),
          total.pBase ? `${this.pct(total.profit, total.pBase)} от суммы КП с расчётом` : 'нет КП с закупкой',
        )
      : '';
    return `<div class="rp-tiles">${this._tile('КП', total.n, `на ${this._rub(total.sum)}`)}${this._tile('Выиграно', total.won, this._rub(total.wonSum))}${this._tile('Проиграно', total.lost)}${this._tile('Конверсия', this.conv(total), 'выиграно из закрытых')}
        ${profit}</div>`;
  }

  static _managers(rows) {
    const col = this._cols();
    return this._table(
      [
        ['Менеджер', col.name],
        ['КП', col.num('n'), 1],
        ['Сумма', col.rub('sum'), 1],
        ['Отправлено', col.num('sent'), 1],
        ['Выиграно', col.won, 1],
        ['Проиграно', col.num('lost'), 1],
        ['Конверсия', col.conv, 1],
        ['Прибыль', row => (row.pBase ? this._rub(row.profit) : '—'), 1, 1],
        ['% от суммы', row => this.pct(row.profit, row.pBase), 1, 1],
      ],
      rows,
    );
  }

  static _categories(rows) {
    const col = this._cols();
    return this._table(
      [
        ['Категория', col.name],
        ['КП', col.num('n'), 1],
        ['Позиций', col.num('pos'), 1],
        ['Сумма', col.rub('sum'), 1],
        ['Выиграно на', col.rub('won'), 1],
        ['Продажа с закупкой', col.rub('sale'), 1, 1],
        ['Закупка', col.rub('cost'), 1, 1],
        ['Прибыль', row => this._rub(row.sale - row.cost), 1, 1],
        ['Маржа', row => this.pct(row.sale - row.cost, row.sale), 1, 1],
      ],
      rows,
    );
  }

  static _clients(rows) {
    const col = this._cols();
    return this._table(
      [
        ['Клиент', col.name],
        ['КП', col.num('n'), 1],
        ['Сумма', col.rub('sum'), 1],
        ['Выиграно', col.won, 1],
        ['Конверсия', col.conv, 1],
      ],
      rows,
    );
  }

  static _list(rows) {
    const col = this._cols();
    return this._table(
      [
        ['№', row => `<button type="button" class="lnk" data-ro="${esc(row.id)}">${esc(row.number)}</button>`],
        ['Дата', row => esc(KpDate.ddmm(row.date))],
        ['Клиент', row => esc(row.client || '')],
        ['Автор', row => esc(ShortName.of(row.manager || ''))],
        ['Статус', row => `<span class="jst st-${row.st}">${KpTrack.STATUS[row.st]}</span>`],
        ['Сумма', col.rub('sum'), 1],
        ['Прибыль', row => (row.profit == null ? '—' : this._rub(row.profit)), 1, 1],
      ],
      rows,
    );
  }

  /**
   * Выгрузить отчёт в Excel.
   * @param {object} data KpReport.calc
   * @param {string} from ГГГГ-ММ-ДД
   * @param {string} till ГГГГ-ММ-ДД
   */
  static async excel(data, from, till) {
    const sheets = this._sheets(data, [
      [{ v: `Отчёт по КП за ${KpDate.ddmm(from)} — ${KpDate.ddmm(till)}`, s: 'title' }],
      [],
    ]);
    if (!FEAT.on('deal')) this._dropDeal(sheets);
    FileSave.download(`Отчёт_КП_${from}_${till}.xlsx`, await XlsxBook.make(sheets, 'Отчёт по КП'));
    Toast.show('Отчёт выгружен в Excel');
  }

  static _cells() {
    return {
      head: text => ({ v: text, s: 'head' }),
      headR: text => ({ v: text, s: 'headR' }),
      money: value => ({ v: Math.round(value || 0) / this.KOPECKS, s: 'tdMoney' }),
      int: value => ({ v: value, s: 'tdInt' }),
      text: value => ({ v: String(value ?? ''), s: 'td' }),
      pct: (part, whole) => ({ v: whole ? part / whole : 0, s: 'tdPct' }),
    };
  }

  static _sheets(data, title) {
    const cell = this._cells();
    const heads = (left, ...right) => [cell.head(left), ...right.map(text => cell.headR(text))];
    return [
      this._managerSheet(data, title, cell, heads),
      this._categorySheet(data, title, cell, heads),
      {
        name: 'Клиенты',
        cols: [44, 8, 16, 10, 16],
        freeze: 3,
        rows: [
          ...title,
          heads('Клиент', 'КП', 'Сумма, руб.', 'Выиграно', 'Выиграно на, руб.'),
          ...data.cli.map(row => [
            cell.text(row.name),
            cell.int(row.n),
            cell.money(row.sum),
            cell.int(row.won),
            cell.money(row.wonSum),
          ]),
        ],
      },
      this._listSheet(data, title, cell),
    ];
  }

  static _managerSheet(data, title, cell, heads) {
    return {
      name: 'Менеджеры',
      cols: [34, 8, 16, 12, 10, 16, 11, 16, 12],
      freeze: 3,
      rows: [
        ...title,
        heads(
          'Менеджер',
          'КП',
          'Сумма, руб.',
          'Отправлено',
          'Выиграно',
          'Выиграно на, руб.',
          'Проиграно',
          'Прибыль, руб.',
          '% от суммы',
        ),
        ...data.mgr.map(row => [
          cell.text(row.name),
          cell.int(row.n),
          cell.money(row.sum),
          cell.int(row.sent),
          cell.int(row.won),
          cell.money(row.wonSum),
          cell.int(row.lost),
          cell.money(row.profit),
          cell.pct(row.profit, row.pBase),
        ]),
      ],
    };
  }

  static _categorySheet(data, title, cell, heads) {
    return {
      name: 'Категории',
      cols: [36, 8, 10, 16, 16, 18, 16, 16, 10],
      freeze: 3,
      rows: [
        ...title,
        heads(
          'Категория',
          'КП',
          'Позиций',
          'Сумма, руб.',
          'Выиграно на, руб.',
          'Продажа с закупкой, руб.',
          'Закупка, руб.',
          'Прибыль, руб.',
          'Маржа',
        ),
        ...data.cat.map(row => [
          cell.text(row.name),
          cell.int(row.n),
          cell.int(row.pos),
          cell.money(row.sum),
          cell.money(row.won),
          cell.money(row.sale),
          cell.money(row.cost),
          cell.money(row.sale - row.cost),
          cell.pct(row.sale - row.cost, row.sale),
        ]),
      ],
    };
  }

  static _listSheet(data, title, cell) {
    return {
      name: 'КП',
      cols: [12, 12, 40, 28, 14, 16, 16],
      freeze: 3,
      rows: [
        ...title,
        [
          cell.head('№'),
          cell.head('Дата'),
          cell.head('Клиент'),
          cell.head('Автор'),
          cell.head('Статус'),
          cell.headR('Сумма, руб.'),
          cell.headR('Прибыль, руб.'),
        ],
        ...data.list.map(row => [
          cell.text(row.number),
          cell.text(KpDate.ddmm(row.date)),
          cell.text(row.client),
          cell.text(row.manager),
          cell.text(KpTrack.STATUS[row.st]),
          cell.money(row.sum),
          row.profit == null ? cell.text('—') : cell.money(row.profit),
        ]),
      ],
    };
  }

  static _dropDeal(sheets) {
    const keep = drop => (_, index) => !drop.includes(index);
    for (const sheet of sheets) {
      const drop = this.NO_DEAL[sheet.name];
      if (!drop) continue;
      sheet.cols = sheet.cols.filter(keep(drop));
      sheet.rows = sheet.rows.map(row => (row.length > 2 ? row.filter(keep(drop)) : row));
    }
  }
}
