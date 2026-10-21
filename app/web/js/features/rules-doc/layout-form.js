import { LayoutDigest } from '../layout/layout-digest.js';
import { LayoutEditor } from './layout-editor.js';
import { LayoutParams } from '../layout/layout-params.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { esc } from '../../core/util.js';
import { StationEquip } from '../layout/station-equip.js';

/** Разметка формы «Правила компоновки станций»: разделы чисел, таблицы матрицы, готовые наборы. */
export class LayoutForm {
  static KINDS = ['compressor', 'dryer', 'receiver', 'filter', 'pump', 'dgu', 'cabinet', 'tank', 'other'];
  static CLEAR = [
    ['back', 'сзади'],
    ['side', 'сбоку'],
    ['top', 'сверху'],
  ];
  static SIDES = [
    ['Ф', 'спереди'],
    ['З', 'сзади'],
    ['Л', 'слева'],
    ['П', 'справа'],
  ];
  static OPTIONS = {
    compressor: 'ширины компрессора',
    dryer: 'ширины осушителя',
    receiver: 'Ø ресивера',
    pump: 'ширины насоса',
    filter: 'ширины фильтра',
    other: 'ширины',
  };
  static AISLE_MM = { u: 'мм', lo: 600, hi: 3000 };

  /** editor — LayoutEditor (рабочая копия work, значения по умолчанию defs(), поиск query). */
  constructor(editor) {
    this.editor = editor;
  }

  /** Название вида оборудования. */
  static label(k) {
    return { ...StationEquip.LABEL, other: 'Прочее' }[k] || k;
  }

  static _num(value) {
    return typeof value === 'number' ? String(value).replace('.', ',') : '';
  }

  /** Числовое поле матрицы. */
  inp(path, value, width = 76) {
    return `<input type="text" inputmode="decimal" data-mx="${esc(path)}" value="${esc(LayoutForm._num(value))}" style="width:${width}px">`;
  }

  /** Выпадающий список матрицы. */
  sel(path, value, opts) {
    const options = opts.map(
      ([k, text]) => `<option value="${esc(k)}"${String(k) === String(value) ? ' selected' : ''}>${esc(text)}</option>`,
    );
    return `<select data-mx="${esc(path)}">${options.join('')}</select>`;
  }

  /** Строка числа: [path, подпись, пояснение], значение, по умолчанию, описание поля f. */
  row([path, label, hint], value, def, field) {
    const chg = def != null && String(value) !== String(def);
    const lpd = def != null ? ` data-lpd="${esc(String(def))}"` : '';
    const small = hint ? `<small>${esc(hint)}</small>` : '';
    return `<div class="lp-r${chg ? ' chg' : ''}" data-lps="${esc(`${label} ${hint || ''}`.toLowerCase())}"${lpd}><div class="lp-t">${esc(label)}${small}</div>
      <div class="lp-v">${this._control(path, value, field)}</div><div class="lp-d">${this._def(path, def, field, chg)}</div></div>`;
  }

  _control(path, value, field) {
    if (field?.opt) return this.sel(path, value, field.opt);
    const unitText = field?.u && field.u !== 'доля' ? `<i>${esc(field.u)}</i>` : '';
    return this.inp(path, value) + unitText;
  }

  _def(path, def, field, chg) {
    const lim =
      field && !field.opt ? `от ${LayoutParams.show({}, field.lo)} до ${LayoutParams.show({}, field.hi)}` : '';
    const small = lim ? `<small>${esc(lim)}</small>` : '';
    if (def == null) return small;
    const shown = field ? LayoutParams.show(field, def) : String(def);
    return `по умолчанию ${esc(shown)}${small} <button class="icon" type="button" data-lpdef="${esc(path)}" title="Вернуть значение по умолчанию" aria-label="Вернуть значение по умолчанию"${chg ? '' : ' hidden'}>↺</button>`;
  }

  /** Раздел формы под раскрытием. */
  sec([id, title, hint], body, open) {
    const hintHtml = hint ? `<p class="muted lp-h">${esc(hint)}</p>` : '';
    return `<details class="lp-s" data-lpsec="${esc(id)}"${open ? ' open' : ''}><summary><b>${esc(title)}</b></summary>${hintHtml}${body}</details>`;
  }

  /** Вся форма: поиск, наборы, разделы, таблицы. */
  html() {
    const query = this.editor.query;
    return `<div class="lp-top"><label class="f lp-q"><span>Найти параметр</span><input type="search" data-lpq data-nodirty value="${esc(query)}" placeholder="например: ворота, ресивер, габарит" autocomplete="off"></label>
        <span class="muted">Изменённые значения подсвечены; «↺» — вернуть значение по умолчанию. Сохранение — новая версия правил, прежняя остаётся для отката.</span></div>
      ${this.presets()}
      <details class="lp-s lp-dg"><summary><b>Как программа компонует станцию — свод по действующим значениям</b></summary>${LayoutDigest.html()}</details>
      ${this._sections()}${this._tables()}
      <div class="row lp-go"><button class="btn primary" type="button" data-rl="mxsave">Сохранить правила компоновки</button><button class="btn ghost" type="button" data-rl="mxdef">Все значения — по умолчанию</button></div>`;
  }

  _sections() {
    const { m: work } = this.editor.work;
    const defs = this.editor.defs().m;
    const searching = !!this.editor.query;
    return LayoutParams.SECTIONS.map(section => {
      const body = section.f
        .map(field =>
          this.row(
            [`m|${field.g}.${field.k}`, field.t, field.h],
            work[field.g][field.k],
            defs[field.g][field.k],
            field,
          ),
        )
        .join('');
      const head = section.id === 'aisle' ? this._aisle() : '';
      return this.sec([section.id, section.title, section.t], head + body, searching || section.id === 'fit');
    }).join('');
  }

  _aisle() {
    const { a: aisle, t: tight } = this.editor.work;
    const defs = this.editor.defs();
    const limits = LayoutForm.AISLE_MM;
    return (
      this.row(
        ['a|0', 'Проход оператора: рекомендуется', 'Вдоль оборудования, от двери.'],
        aisle[0],
        defs.a[0],
        limits,
      ) +
      this.row(
        ['a|1', 'Проход оператора: допустимо (плотная компоновка)', 'ПУЭ, п. 4.1.23: не менее 0,8 м.'],
        aisle[1],
        defs.a[1],
        limits,
      ) +
      this.row(
        [
          't|',
          'Проход оператора: в крайнем случае (исключение)',
          'Решение ПНЕВМОТЕХ 12.10: не меньше 600 мм; только ради габарита перевозки.',
        ],
        tight,
        defs.t,
        limits,
      )
    );
  }

  static _table(head, rows) {
    return `<div class="tzi-tw mx-tw"><table class="tzi-t mx-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  static TABLES = [
    {
      sec: [
        'pair',
        'Расстояния между соседними агрегатами по длине',
        'Рекомендуется — большее из «не меньше» и «доля × размер»; «плотно» — при плотной компоновке (по умолчанию); вплотную — только где отмечено и только в заданном контейнере.',
      ],
      head: () =>
        '<th>Пара</th><th>Рекомендуется не меньше, мм</th><th>и не меньше доли размера</th><th>Плотно, мм</th><th>Вплотную можно</th><th></th>',
      rows: '_pairRows',
      tail: '\n        <button class="btn ghost sm" type="button" data-rl="mxadd">+ пара</button>',
    },
    {
      sec: [
        'wall',
        'Отступ за агрегатом от стены',
        '«Плотно» — с сервисными воротами в стене за агрегатом (только тем, кому они разрешены в таблице «Стороны»).',
      ],
      head: () => '<th>Вид</th><th>Рекомендуется не меньше, мм</th><th>и не меньше доли</th><th>Плотно, мм</th>',
      rows: '_wallRows',
    },
    {
      sec: [
        'clear',
        'Отступы по видам: рекомендуется / допустимо',
        'Сзади, сбоку и сверху до стены, потолка и соседнего оборудования, мм. Паспорт конкретной модели важнее.',
      ],
      head: () => `<th>Вид</th>${LayoutForm.CLEAR.map(([, form]) => `<th>${form}</th>`).join('')}`,
      rows: '_clearRows',
    },
    {
      sec: [
        'sides',
        'Стороны обслуживания, поворот, сервисные ворота, вынос',
        'Отмечены стороны, к которым нужен доступ. «Сервисные ворота» снято — монтаж и демонтаж только через ворота в торце (решение ПНЕВМОТЕХ: осушители и ресиверы).',
      ],
      head: () =>
        `<th>Вид</th>${LayoutForm.SIDES.map(([, form]) => `<th>${form}</th>`).join('')}<th>Можно повернуть</th><th>Сервисные ворота</th><th>Наклонить при выносе</th>`,
      rows: '_sideRows',
    },
  ];

  _tables() {
    const searching = !!this.editor.query;
    return LayoutForm.TABLES.map(table =>
      this.sec(table.sec, LayoutForm._table(table.head(), this[table.rows]()) + (table.tail || ''), searching),
    ).join('');
  }

  _pairRows() {
    const kinds = LayoutForm.KINDS.map(k => [k, LayoutForm.label(k)]);
    return (this.editor.work.m.pair.rows || [])
      .map((row, j) => {
        const key = `m|pair.rows.${j}`;
        const options = [
          ['', '—'],
          ...[...new Set([row.a, row.b])].map(k => [`${k}.w`, LayoutForm.OPTIONS[k] || 'ширины']),
        ];
        return `<tr><td>${this.sel(`${key}.a`, row.a, kinds)} ↔ ${this.sel(`${key}.b`, row.b, kinds)}</td>
      <td>${this.inp(`${key}.base`, row.base, 70)}</td><td>${this.inp(`${key}.k`, row.k, 52)} × ${this.sel(`${key}.of`, row.of || '', options)}</td>
      <td>${this.inp(`${key}.min`, row.min, 70)}</td><td><input type="checkbox" data-mx="${key}.close"${row.close ? ' checked' : ''} aria-label="Вплотную можно"></td>
      <td><button class="icon" type="button" data-mxdel="${j}" aria-label="Убрать строку">✕</button></td></tr>`;
      })
      .join('');
  }

  _wallRows() {
    return (this.editor.work.m.wall.rows || [])
      .map((row, j) => {
        const key = `m|wall.rows.${j}`;
        return `<tr><td>${esc(LayoutForm.label(row.kind))}</td><td>${this.inp(`${key}.base`, row.base, 70)}</td><td>${this.inp(`${key}.k`, row.k, 52)} × глубины</td><td>${this.inp(`${key}.tight`, row.tight, 70)}</td></tr>`;
      })
      .join('');
  }

  _clearRows() {
    const clear = this.editor.work.c;
    const cell = (k, side) =>
      Array.isArray(clear[k][side])
        ? `<td>${this.inp(`c|${k}.${side}.0`, clear[k][side][0], 58)} / ${this.inp(`c|${k}.${side}.1`, clear[k][side][1], 58)}</td>`
        : '<td>—</td>';
    return Object.keys(clear)
      .map(
        k => `<tr><td>${esc(LayoutForm.label(k))}</td>${LayoutForm.CLEAR.map(([side]) => cell(k, side)).join('')}</tr>`,
      )
      .join('');
  }

  _sideRows() {
    const matrix = this.editor.work.m;
    const rot = new Map((matrix.rotate.rows || []).map(row => [row.kind, row.on !== false]));
    const box = (row, j) =>
      LayoutForm.SIDES.map(
        ([col, title]) =>
          `<td><input type="checkbox" data-mxs="${j}" value="${col}"${String(row.s || '').includes(col) ? ' checked' : ''} aria-label="${esc(title)}"></td>`,
      ).join('');
    const turn = row =>
      rot.has(row.kind)
        ? `<input type="checkbox" data-mx="r|${esc(row.kind)}"${rot.get(row.kind) ? ' checked' : ''} aria-label="Можно повернуть">`
        : '—';
    return (matrix.sides.rows || [])
      .map(
        (row, j) => `<tr><td>${esc(LayoutForm.label(row.kind))}</td>${box(row, j)}
      <td>${turn(row)}</td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.door"${StationMatrix.noDoor(row.kind) ? '' : ' checked'} aria-label="Сервисные ворота можно"></td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.tilt"${row.tilt ? ' checked' : ''} aria-label="Можно наклонить при выносе"></td></tr>`,
      )
      .join('');
  }

  /** Готовые наборы: какой действует (сохранённые правила) и кнопки — применить сразу. */
  presets() {
    const matrix = LayoutEditor.rule(this.editor.panel.data, 'layout.matrix');
    const act = LayoutParams.which(LayoutEditor.merge(matrix?.value));
    const cur = LayoutParams.which(this.editor.work.m);
    const name = preset => (preset ? `«${preset.title}»` : 'свои значения');
    const diff = act?.id !== cur?.id ? ` <span class="warn-t">(в форме — ${esc(name(cur))}, не сохранено)</span>` : '';
    const btn = preset => {
      const active = act?.id === preset.id;
      return `<button type="button" class="lp-pb${active ? ' on' : ''}" data-lppre="${esc(preset.id)}" aria-pressed="${active ? 'true' : 'false'}"><b>${esc(preset.title)}${active ? ' ✓ действует' : ''}</b><small>${esc(preset.t)}</small></button>`;
    };
    return `<div class="lp-pre"><span class="lp-pre-h"><b>Готовые наборы</b> — действует сейчас: <b class="ok-t">${esc(name(act))}</b>${diff}</span>
      ${LayoutParams.PRESETS.map(btn).join('')}</div>`;
  }

  /** Поиск параметра: строки и разделы без совпадений скрыты. */
  filter(root) {
    const query = this.editor.query.trim().toLowerCase();
    for (const section of root.querySelectorAll('[data-lpsec]')) {
      const hit = LayoutForm._filterSec(section, query);
      section.hidden = !hit;
      if (query && hit) section.open = true;
    }
  }

  static _filterSec(section, query) {
    let hit = !query || section.querySelector('summary').textContent.toLowerCase().includes(query);
    for (const row of section.querySelectorAll('.lp-r')) {
      const match = hit || row.dataset.lps.includes(query);
      row.hidden = !match;
      hit ||= match;
    }
    const opt = x => x.selectedOptions[0]?.textContent.toLowerCase().includes(query);
    for (const title of section.querySelectorAll('tbody tr')) {
      hit ||= title.textContent.toLowerCase().includes(query) || [...title.querySelectorAll('select')].some(opt);
    }
    return hit;
  }
}
