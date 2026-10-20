import { LayoutEditor } from './layout-editor.js';
import { LayoutParams } from '../layout/layout-params.js';
import { RuleEdit } from './rule-edit.js';
import { StationCalc } from '../calc/station-calc.js';
import { StationRules } from '../rules/station-rules.js';
import { StationRulesDoc } from './rules-doc.js';

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' } };

/** Вкладка «Настроек» «Нормы станций»: правила компоновки формой, все правила таблицей, версии файла правил. */
export class RulesPanel {
  // правятся формой «Правила компоновки» (как LayoutValues.IDS на сервере)
  static LAYOUT = new Set(['layout.matrix', 'norm.aisle', 'norm.aisle_tight', 'clear.kind']);
  static CHIP = { confirmed: 'on', practice: '', unconfirmed: 'warn' };

  constructor(m) {
    this.m = m;
    this.info = null;
    this.data = null;
    this.flt = '';
    this.rq = '';
    this.mx = new LayoutEditor(this);
    this.re = new RuleEdit(this);
    this.mxOpen = true;
  }

  async open() {
    try {
      const [a, d] = await Promise.all([aapi('rules/stations'), StationRulesDoc.load()]);
      this.info = a.info;
      this.layoutDef = a.layoutDef || null;
      this.data = d;
    } catch (e) {
      this.m.innerHTML = `<p class="msg err">${esc(e.message || e)}</p>`;
      return;
    }
    this.render();
    this.bind();
  }

  box() {
    return this.m.querySelector('[data-mxbox]');
  }

  keep() {
    const b = this.box();
    if (b && this.mx.w)
      this._try(
        () => this.mx.read(b),
        () => {},
      );
    const open = [...this.m.querySelectorAll('[data-lpsec]')].filter(s => s.open).map(s => s.dataset.lpsec);
    if (open.length) this.secOpen = new Set(open);
  }

  /** keep — сначала забрать введённое (после программной правки формы — нет: старые поля затёрли бы её). */
  render(keep = true) {
    if (keep) this.keep();
    this.m.innerHTML = this._head() + this._layoutBox() + this._table();
    const b = this.box();
    if (!b) return;
    if (this.secOpen) for (const s of b.querySelectorAll('[data-lpsec]')) s.open = this.secOpen.has(s.dataset.lpsec);
    this.mx.filter(b);
  }

  _version() {
    const i = this.info || {};
    if (!i.own) return 'файл поставки программы';
    const by = i.saved?.by ? `, ${esc(i.saved.by)}` : '';
    const saved = i.saved ? ` (сохранена ${esc(String(i.saved.at || '').replace('T', ' '))}${by})` : '';
    return `своя версия администратора${saved}; в поставке — ${esc(i.bundled || '')}`;
  }

  _head() {
    const i = this.info || {};
    const s = i.byStatus || {};
    return `<div class="st-card"><p style="margin:0">Действует версия <b>${esc(i.version || '—')}</b> от ${esc(i.date || '—')} — ${this._version()}.
        Правил: ${i.rules || 0} (подтверждено — ${s.confirmed || 0}, практика — ${s.practice || 0}, требует подтверждения — ${s.unconfirmed || 0}); данных производителей по сериям: ${i.series || 0}.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" data-rl="doc">Документ «Инженерные правила и источники» (DOCX)</button>
          <button class="btn ghost" type="button" data-rl="json">Скачать файл правил (JSON)</button><button class="btn ghost" type="button" data-rl="up">Загрузить свою версию…</button>
          ${i.own ? '<button class="btn ghost" type="button" data-rl="reset">Вернуть файл поставки</button>' : ''}</div></div>
      `;
  }

  _layoutBox() {
    return `<details class="st-card mx"${this.mxOpen ? ' open' : ''} data-mxbox><summary><b>Правила компоновки станций</b> <span class="muted">— габарит перевозки, размер контейнера, проходы, отступы, двери, ворота, ресиверы, исключения</span></summary>${this.mx.html()}</details>
      `;
  }

  _rules() {
    const q = this.rq.trim().toLowerCase();
    const text = r => [r.title, r.id, r.group, r.note, StationRulesDoc.val(r.value, r.unit)].join(' ').toLowerCase();
    return (this.data?.rules || []).filter(r => (!this.flt || r.status === this.flt) && (!q || text(r).includes(q)));
  }

  _table() {
    const opts = Object.entries(StationRulesDoc.STATUS)
      .map(([k, t]) => `<option value="${k}"${this.flt === k ? ' selected' : ''}>${esc(t)}</option>`)
      .join('');
    return `<div class="st-card"><p style="margin:0 0 6px"><b>Все инженерные правила</b> <span class="muted">— «Изменить» у правила: значение, статус и источник; сохранение — новая версия правил</span></p>
        <div class="row" style="gap:10px;flex-wrap:wrap"><label class="f" style="max-width:320px"><span>Показать</span><select data-rlf data-nodirty><option value="">все правила</option>${opts}</select></label>
          <label class="f" style="max-width:320px"><span>Найти</span><input type="search" data-rlq data-nodirty value="${esc(this.rq)}" placeholder="название, значение, группа" autocomplete="off"></label></div>
        <div class="tzi-tw" style="max-height:none"><table class="tzi-t re-all"><thead><tr><th>Правило</th><th>Значение</th><th>Статус</th><th>Источник</th><th></th></tr></thead><tbody>
        ${this._rules()
          .map(r => this._row(r))
          .join('')}</tbody></table></div></div>`;
  }

  _row(r) {
    const on = r.id === this.re.id;
    const note = r.note ? `<div class="muted">${esc(r.note)}</div>` : '';
    const st = StationRulesDoc.STATUS;
    return `<tr${on ? ' class="re-on"' : ''}><td><b>${esc(r.title)}</b><div class="muted">${esc(r.group || '')} · ${esc(r.id)}</div>${note}</td>
          <td>${on ? this.re.html(r) : esc(StationRulesDoc.val(r.value, r.unit))}</td>
          <td><span class="chip sm ${RulesPanel.CHIP[r.status] || ''}">${esc(st[r.status] || r.status)}</span></td><td>${esc(StationRulesDoc.src(r.source))}</td>
          <td>${this._rowButton(r, on)}</td></tr>`;
  }

  _rowButton(r, on) {
    if (on) return '';
    if (RulesPanel.LAYOUT.has(r.id))
      return '<button class="btn ghost sm" type="button" data-rl="tolayout" title="Правится в «Правилах компоновки» выше">Выше ↑</button>';
    return `<button class="btn ghost sm" type="button" data-reopen="${esc(r.id)}">Изменить</button>`;
  }

  /** fn с ошибкой — toast (или свой обработчик); true — выполнилось. */
  _try(fn, fail = er => toast(er.message)) {
    try {
      fn();
      return true;
    } catch (er) {
      fail(er);
      return false;
    }
  }

  bind() {
    this.m.onchange = e => this._change(e.target);
    this.m.oninput = e => this._input(e.target);
    this.m.addEventListener('toggle', e => this._toggle(e.target), true);
    this.m.onclick = e => this._click(e.target);
  }

  _change(t) {
    if (t.matches('[data-rlf]')) {
      this.flt = t.value;
      this.render();
    } else if (/^m\|pair\.rows\.\d+\.[ab]$/.test(t.dataset.mx || '')) {
      this._try(() => {
        this.mx.read(this.box());
        this.render();
      });
    } else if (t.dataset.mx) {
      const r = t.closest('.lp-r');
      if (r)
        this._try(() => {
          this.mx.read(this.box());
          LayoutEditor.mark(r);
        });
    }
  }

  _input(t) {
    if (t.matches('[data-lpq]')) {
      this.mx.q = t.value;
      this.mx.filter(this.box());
    } else if (t.matches('[data-rlq]')) {
      this.rq = t.value;
      const p = t.selectionStart;
      this.render();
      const x = this.m.querySelector('[data-rlq]');
      x?.focus();
      x?.setSelectionRange(p, p);
    }
  }

  _toggle(t) {
    if (t.matches?.('[data-mxbox]')) this.mxOpen = t.open;
  }

  /** Щелчок: первый подходящий элемент из CLICKS. */
  _click(t) {
    for (const [sel, fn] of RulesPanel.CLICKS) {
      const el = t.closest(sel);
      if (el) return fn.call(this, el);
    }
    return null;
  }

  static CLICKS = [
    [
      '[data-mxdel]',
      function (el) {
        this._try(() => {
          this.mx.del(this.box(), Number(el.dataset.mxdel));
          this.render();
        });
      },
    ],
    [
      '[data-lpdef]',
      function (el) {
        this._try(() => {
          this.mx.read(this.box());
          this.mx.def(el.dataset.lpdef);
          this.render(false);
        });
      },
    ],
    [
      '[data-lppre]',
      function (el) {
        return this._preset(el.dataset.lppre);
      },
    ],
    [
      '[data-reopen]',
      function (el) {
        const r = this.data.rules.find(q => q.id === el.dataset.reopen);
        if (!r) return;
        this.re.open(r);
        this.render();
      },
    ],
    [
      '[data-readd]',
      function (el) {
        this._try(() => {
          this.re.add(this.m.querySelector('.re'), el.dataset.readd);
          this.render();
        });
      },
    ],
    [
      '[data-redel]',
      function (el) {
        this._try(() => {
          this.re.del(this.m.querySelector('.re'), el.dataset.redel);
          this.render();
        });
      },
    ],
    [
      '[data-rl]',
      function (el) {
        return this[`_rl_${el.dataset.rl}`]?.();
      },
    ],
  ];

  /** Набор правил компоновки — сразу в действие (новая версия правил; прежняя — для отката). */
  _preset(id) {
    const P = LayoutParams.PRESETS.find(p => p.id === id) || {};
    let d;
    const ok = this._try(() => {
      this.mx.read(this.box());
      this.mx.usePreset(P.id);
      d = this.mx.build();
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(d) }, '', `Набор «${P.title}» действует`) : null;
  }

  _rl_mxadd() {
    this._try(() => {
      this.mx.add(this.box());
      this.render();
    });
  }

  /** Все значения — как в файле поставки, и сразу новой версией правил. */
  async _rl_mxdef() {
    const ok = await stConfirm(
      'Все правила компоновки — по умолчанию?',
      'Матрица расстановки, проходы и отступы станут как в файле поставки программы и сразу сохранятся новой версией правил; прежняя версия останется для отката.',
      'Вернуть по умолчанию',
    );
    if (!ok) return null;
    const old = this.mx.w;
    let d;
    const built = this._try(
      () => {
        this.mx.reset();
        d = this.mx.build();
      },
      er => {
        this.mx.w = old;
        toast(er.message);
      },
    );
    return built ? this.post({ ...JSON_POST, body: JSON.stringify(d) }, '', 'Правила компоновки — по умолчанию') : null;
  }

  _rl_mxsave() {
    let d;
    const ok = this._try(() => {
      this.mx.read(this.box());
      d = this.mx.build();
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(d) }) : null;
  }

  _rl_recancel() {
    this.re.id = '';
    this.render();
  }

  _rl_resave() {
    let d;
    const ok = this._try(() => {
      d = this.re.build(this.m.querySelector('.re'));
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(d) }) : null;
  }

  _rl_tolayout() {
    const x = this.box();
    if (!x) return;
    x.open = true;
    x.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _rl_doc() {
    return StationRulesDoc.download();
  }

  _rl_json() {
    const blob = new Blob([JSON.stringify(this.data, null, 1)], { type: 'application/json' });
    saveFileA(`Правила станций ${this.data.version || ''}.json`, blob);
  }

  _rl_reset() {
    if (!confirm('Вернуть файл правил из поставки программы? Своя версия сохранится как предыдущая.')) return null;
    return this.post({ method: 'POST', body: '' }, '?reset=1');
  }

  _rl_up() {
    const f = $('#filePick');
    f.value = '';
    f.multiple = false;
    f.accept = '.json';
    f.onchange = () => {
      const fl = f.files[0];
      f.accept = '';
      if (!fl) return;
      if (fl.size > 2 * 1024 * 1024) {
        toast('Файл больше 2 МБ');
        return;
      }
      this.post({ ...JSON_POST, body: fl });
    };
    f.click();
  }

  async post(opts, qs = '', what = 'Правила станций') {
    try {
      const r = await aapi(`rules/stations${qs}`, opts);
      this.info = r.info;
      this.data = await StationRulesDoc.load();
      StationRules.use(this.data);
      this.mx.w = null;
      this.re.id = '';
      if (typeof StationUi !== 'undefined') StationUi.cache.clear();
      StationCalc.cache.clear();
      toast(`${what}: сохранено, версия ${this.info.version || ''}`);
      this.render(false);
    } catch (e) {
      toast(`Не принято: ${e.message || e}`);
    }
  }
}
