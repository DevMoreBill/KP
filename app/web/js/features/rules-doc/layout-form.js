import { LayoutDigest } from '../layout/layout-digest.js';
import { LayoutParams } from '../layout/layout-params.js';
import { StationMatrix } from '../layout/station-matrix.js';

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
  static OF = {
    compressor: 'ширины компрессора',
    dryer: 'ширины осушителя',
    receiver: 'Ø ресивера',
    pump: 'ширины насоса',
    filter: 'ширины фильтра',
    other: 'ширины',
  };
  static AISLE_MM = { u: 'мм', lo: 600, hi: 3000 };

  /** ed — LayoutEditor (рабочая копия w, значения по умолчанию defs(), поиск q). */
  constructor(ed) {
    this.ed = ed;
  }

  static label(k) {
    return { ...StationEquip.LABEL, other: 'Прочее' }[k] || k;
  }

  static n(v) {
    return typeof v === 'number' ? String(v).replace('.', ',') : '';
  }

  inp(path, v, w = 76) {
    return `<input type="text" inputmode="decimal" data-mx="${esc(path)}" value="${esc(LayoutForm.n(v))}" style="width:${w}px">`;
  }

  sel(path, v, opts) {
    const o = opts.map(
      ([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(t)}</option>`,
    );
    return `<select data-mx="${esc(path)}">${o.join('')}</select>`;
  }

  /** Строка числа: [path, подпись, пояснение], значение, по умолчанию, описание поля f. */
  row([path, label, hint], v, def, f) {
    const chg = def != null && String(v) !== String(def);
    const lpd = def != null ? ` data-lpd="${esc(String(def))}"` : '';
    const small = hint ? `<small>${esc(hint)}</small>` : '';
    return `<div class="lp-r${chg ? ' chg' : ''}" data-lps="${esc(`${label} ${hint || ''}`.toLowerCase())}"${lpd}><div class="lp-t">${esc(label)}${small}</div>
      <div class="lp-v">${this._control(path, v, f)}</div><div class="lp-d">${this._def(path, def, f, chg)}</div></div>`;
  }

  _control(path, v, f) {
    if (f?.opt) return this.sel(path, v, f.opt);
    const u = f?.u && f.u !== 'доля' ? `<i>${esc(f.u)}</i>` : '';
    return this.inp(path, v) + u;
  }

  _def(path, def, f, chg) {
    const lim = f && !f.opt ? `от ${LayoutParams.show({}, f.lo)} до ${LayoutParams.show({}, f.hi)}` : '';
    const small = lim ? `<small>${esc(lim)}</small>` : '';
    if (def == null) return small;
    const shown = f ? LayoutParams.show(f, def) : String(def);
    return `по умолчанию ${esc(shown)}${small} <button class="icon" type="button" data-lpdef="${esc(path)}" title="Вернуть значение по умолчанию" aria-label="Вернуть значение по умолчанию"${chg ? '' : ' hidden'}>↺</button>`;
  }

  sec([id, title, hint], body, open) {
    const h = hint ? `<p class="muted lp-h">${esc(hint)}</p>` : '';
    return `<details class="lp-s" data-lpsec="${esc(id)}"${open ? ' open' : ''}><summary><b>${esc(title)}</b></summary>${h}${body}</details>`;
  }

  html() {
    const q = this.ed.q;
    return `<div class="lp-top"><label class="f lp-q"><span>Найти параметр</span><input type="search" data-lpq data-nodirty value="${esc(q)}" placeholder="например: ворота, ресивер, габарит" autocomplete="off"></label>
        <span class="muted">Изменённые значения подсвечены; «↺» — вернуть значение по умолчанию. Сохранение — новая версия правил, прежняя остаётся для отката.</span></div>
      ${this.presets()}
      <details class="lp-s lp-dg"><summary><b>Как программа компонует станцию — свод по действующим значениям</b></summary>${LayoutDigest.html()}</details>
      ${this._sections()}${this._tables()}
      <div class="row lp-go"><button class="btn primary" type="button" data-rl="mxsave">Сохранить правила компоновки</button><button class="btn ghost" type="button" data-rl="mxdef">Все значения — по умолчанию</button></div>`;
  }

  _sections() {
    const { m: M } = this.ed.w;
    const D = this.ed.defs().m;
    const on = !!this.ed.q;
    return LayoutParams.SECTIONS.map(s => {
      const body = s.f.map(f => this.row([`m|${f.g}.${f.k}`, f.t, f.h], M[f.g][f.k], D[f.g][f.k], f)).join('');
      const head = s.id === 'aisle' ? this._aisle() : '';
      return this.sec([s.id, s.title, s.t], head + body, on || s.id === 'fit');
    }).join('');
  }

  _aisle() {
    const { a, t } = this.ed.w;
    const DF = this.ed.defs();
    const F = LayoutForm.AISLE_MM;
    return (
      this.row(['a|0', 'Проход оператора: рекомендуется', 'Вдоль оборудования, от двери.'], a[0], DF.a[0], F) +
      this.row(
        ['a|1', 'Проход оператора: допустимо (плотная компоновка)', 'ПУЭ, п. 4.1.23: не менее 0,8 м.'],
        a[1],
        DF.a[1],
        F,
      ) +
      this.row(
        [
          't|',
          'Проход оператора: в крайнем случае (исключение)',
          'Решение ПНЕВМОТЕХ 12.10: не меньше 600 мм; только ради габарита перевозки.',
        ],
        t,
        DF.t,
        F,
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
      head: () => `<th>Вид</th>${LayoutForm.CLEAR.map(([, t]) => `<th>${t}</th>`).join('')}`,
      rows: '_clearRows',
    },
    {
      sec: [
        'sides',
        'Стороны обслуживания, поворот, сервисные ворота, вынос',
        'Отмечены стороны, к которым нужен доступ. «Сервисные ворота» снято — монтаж и демонтаж только через ворота в торце (решение ПНЕВМОТЕХ: осушители и ресиверы).',
      ],
      head: () =>
        `<th>Вид</th>${LayoutForm.SIDES.map(([, t]) => `<th>${t}</th>`).join('')}<th>Можно повернуть</th><th>Сервисные ворота</th><th>Наклонить при выносе</th>`,
      rows: '_sideRows',
    },
  ];

  _tables() {
    const on = !!this.ed.q;
    return LayoutForm.TABLES.map(T =>
      this.sec(T.sec, LayoutForm._table(T.head(), this[T.rows]()) + (T.tail || ''), on),
    ).join('');
  }

  _pairRows() {
    const K = LayoutForm.KINDS.map(k => [k, LayoutForm.label(k)]);
    return (this.ed.w.m.pair.rows || [])
      .map((r, j) => {
        const p = `m|pair.rows.${j}`;
        const of = [['', '—'], ...[...new Set([r.a, r.b])].map(k => [`${k}.w`, LayoutForm.OF[k] || 'ширины'])];
        return `<tr><td>${this.sel(`${p}.a`, r.a, K)} ↔ ${this.sel(`${p}.b`, r.b, K)}</td>
      <td>${this.inp(`${p}.base`, r.base, 70)}</td><td>${this.inp(`${p}.k`, r.k, 52)} × ${this.sel(`${p}.of`, r.of || '', of)}</td>
      <td>${this.inp(`${p}.min`, r.min, 70)}</td><td><input type="checkbox" data-mx="${p}.close"${r.close ? ' checked' : ''} aria-label="Вплотную можно"></td>
      <td><button class="icon" type="button" data-mxdel="${j}" aria-label="Убрать строку">✕</button></td></tr>`;
      })
      .join('');
  }

  _wallRows() {
    return (this.ed.w.m.wall.rows || [])
      .map((r, j) => {
        const p = `m|wall.rows.${j}`;
        return `<tr><td>${esc(LayoutForm.label(r.kind))}</td><td>${this.inp(`${p}.base`, r.base, 70)}</td><td>${this.inp(`${p}.k`, r.k, 52)} × глубины</td><td>${this.inp(`${p}.tight`, r.tight, 70)}</td></tr>`;
      })
      .join('');
  }

  _clearRows() {
    const C = this.ed.w.c;
    const cell = (k, s) =>
      Array.isArray(C[k][s])
        ? `<td>${this.inp(`c|${k}.${s}.0`, C[k][s][0], 58)} / ${this.inp(`c|${k}.${s}.1`, C[k][s][1], 58)}</td>`
        : '<td>—</td>';
    return Object.keys(C)
      .map(k => `<tr><td>${esc(LayoutForm.label(k))}</td>${LayoutForm.CLEAR.map(([s]) => cell(k, s)).join('')}</tr>`)
      .join('');
  }

  _sideRows() {
    const M = this.ed.w.m;
    const rot = new Map((M.rotate.rows || []).map(r => [r.kind, r.on !== false]));
    const box = (r, j) =>
      LayoutForm.SIDES.map(
        ([c, t]) =>
          `<td><input type="checkbox" data-mxs="${j}" value="${c}"${String(r.s || '').includes(c) ? ' checked' : ''} aria-label="${esc(t)}"></td>`,
      ).join('');
    const turn = r =>
      rot.has(r.kind)
        ? `<input type="checkbox" data-mx="r|${esc(r.kind)}"${rot.get(r.kind) ? ' checked' : ''} aria-label="Можно повернуть">`
        : '—';
    return (M.sides.rows || [])
      .map(
        (r, j) => `<tr><td>${esc(LayoutForm.label(r.kind))}</td>${box(r, j)}
      <td>${turn(r)}</td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.door"${StationMatrix.noDoor(r.kind) ? '' : ' checked'} aria-label="Сервисные ворота можно"></td>
      <td><input type="checkbox" data-mx="m|sides.rows.${j}.tilt"${r.tilt ? ' checked' : ''} aria-label="Можно наклонить при выносе"></td></tr>`,
      )
      .join('');
  }

  /** Готовые наборы: какой действует (сохранённые правила) и кнопки — применить сразу. */
  presets() {
    const m = this.ed.constructor.rule(this.ed.p.data, 'layout.matrix');
    const act = LayoutParams.which(this.ed.constructor.merge(m?.value));
    const cur = LayoutParams.which(this.ed.w.m);
    const nm = P => (P ? `«${P.title}»` : 'свои значения');
    const diff = act?.id !== cur?.id ? ` <span class="warn-t">(в форме — ${esc(nm(cur))}, не сохранено)</span>` : '';
    const btn = P => {
      const on = act?.id === P.id;
      return `<button type="button" class="lp-pb${on ? ' on' : ''}" data-lppre="${esc(P.id)}" aria-pressed="${on ? 'true' : 'false'}"><b>${esc(P.title)}${on ? ' ✓ действует' : ''}</b><small>${esc(P.t)}</small></button>`;
    };
    return `<div class="lp-pre"><span class="lp-pre-h"><b>Готовые наборы</b> — действует сейчас: <b class="ok-t">${esc(nm(act))}</b>${diff}</span>
      ${LayoutParams.PRESETS.map(btn).join('')}</div>`;
  }

  /** Поиск параметра: строки и разделы без совпадений скрыты. */
  filter(root) {
    const q = this.ed.q.trim().toLowerCase();
    for (const s of root.querySelectorAll('[data-lpsec]')) {
      const hit = LayoutForm._filterSec(s, q);
      s.hidden = !hit;
      if (q && hit) s.open = true;
    }
  }

  static _filterSec(s, q) {
    let hit = !q || s.querySelector('summary').textContent.toLowerCase().includes(q);
    for (const r of s.querySelectorAll('.lp-r')) {
      const m = hit || r.dataset.lps.includes(q);
      r.hidden = !m;
      hit ||= m;
    }
    const opt = x => x.selectedOptions[0]?.textContent.toLowerCase().includes(q);
    for (const t of s.querySelectorAll('tbody tr')) {
      hit ||= t.textContent.toLowerCase().includes(q) || [...t.querySelectorAll('select')].some(opt);
    }
    return hit;
  }
}
