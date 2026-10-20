import { AdminApi, AdminDialog } from '../admin/admin-core.js';
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

  constructor(root) {
    this.root = root;
    this.info = null;
    this.data = null;
    this.statusFilter = '';
    this.ruleQuery = '';
    this.layout = new LayoutEditor(this);
    this.ruleEdit = new RuleEdit(this);
    this.layoutOpen = true;
  }

  /** Загрузить правила и показать вкладку. */
  async open() {
    try {
      const [answer, data] = await Promise.all([AdminApi.get('rules/stations'), StationRulesDoc.load()]);
      this.info = answer.info;
      this.layoutDef = answer.layoutDef || null;
      this.data = data;
    } catch (err) {
      this.root.innerHTML = `<p class="msg err">${esc(err.message || err)}</p>`;
      return;
    }
    this.render();
    this.bind();
  }

  /** Блок формы «Правила компоновки». */
  box() {
    return this.root.querySelector('[data-mxbox]');
  }

  /** Забрать введённое в форму и запомнить открытые разделы. */
  keep() {
    const box = this.box();
    if (box && this.layout.work)
      this._try(
        () => this.layout.read(box),
        () => {},
      );
    const open = [...this.root.querySelectorAll('[data-lpsec]')]
      .filter(section => section.open)
      .map(section => section.dataset.lpsec);
    if (open.length) this.secOpen = new Set(open);
  }

  /** keep — сначала забрать введённое (после программной правки формы — нет: старые поля затёрли бы её). */
  render(keep = true) {
    if (keep) this.keep();
    this.root.innerHTML = this._head() + this._layoutBox() + this._table();
    const box = this.box();
    if (!box) return;
    if (this.secOpen)
      for (const section of box.querySelectorAll('[data-lpsec]'))
        section.open = this.secOpen.has(section.dataset.lpsec);
    this.layout.filter(box);
  }

  _version() {
    const i = this.info || {};
    if (!i.own) return 'файл поставки программы';
    const author = i.saved?.by ? `, ${esc(i.saved.by)}` : '';
    const saved = i.saved ? ` (сохранена ${esc(String(i.saved.at || '').replace('T', ' '))}${author})` : '';
    return `своя версия администратора${saved}; в поставке — ${esc(i.bundled || '')}`;
  }

  _head() {
    const i = this.info || {};
    const counts = i.byStatus || {};
    return `<div class="st-card"><p style="margin:0">Действует версия <b>${esc(i.version || '—')}</b> от ${esc(i.date || '—')} — ${this._version()}.
        Правил: ${i.rules || 0} (подтверждено — ${counts.confirmed || 0}, практика — ${counts.practice || 0}, требует подтверждения — ${counts.unconfirmed || 0}); данных производителей по сериям: ${i.series || 0}.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" data-rl="doc">Документ «Инженерные правила и источники» (DOCX)</button>
          <button class="btn ghost" type="button" data-rl="json">Скачать файл правил (JSON)</button><button class="btn ghost" type="button" data-rl="up">Загрузить свою версию…</button>
          ${i.own ? '<button class="btn ghost" type="button" data-rl="reset">Вернуть файл поставки</button>' : ''}</div></div>
      `;
  }

  _layoutBox() {
    return `<details class="st-card mx"${this.layoutOpen ? ' open' : ''} data-mxbox><summary><b>Правила компоновки станций</b> <span class="muted">— габарит перевозки, размер контейнера, проходы, отступы, двери, ворота, ресиверы, исключения</span></summary>${this.layout.html()}</details>
      `;
  }

  _rules() {
    const query = this.ruleQuery.trim().toLowerCase();
    const text = rule =>
      [rule.title, rule.id, rule.group, rule.note, StationRulesDoc.val(rule.value, rule.unit)].join(' ').toLowerCase();
    return (this.data?.rules || []).filter(
      rule => (!this.statusFilter || rule.status === this.statusFilter) && (!query || text(rule).includes(query)),
    );
  }

  _table() {
    const opts = Object.entries(StationRulesDoc.STATUS)
      .map(([k, title]) => `<option value="${k}"${this.statusFilter === k ? ' selected' : ''}>${esc(title)}</option>`)
      .join('');
    return `<div class="st-card"><p style="margin:0 0 6px"><b>Все инженерные правила</b> <span class="muted">— «Изменить» у правила: значение, статус и источник; сохранение — новая версия правил</span></p>
        <div class="row" style="gap:10px;flex-wrap:wrap"><label class="f" style="max-width:320px"><span>Показать</span><select data-rlf data-nodirty><option value="">все правила</option>${opts}</select></label>
          <label class="f" style="max-width:320px"><span>Найти</span><input type="search" data-rlq data-nodirty value="${esc(this.ruleQuery)}" placeholder="название, значение, группа" autocomplete="off"></label></div>
        <div class="tzi-tw" style="max-height:none"><table class="tzi-t re-all"><thead><tr><th>Правило</th><th>Значение</th><th>Статус</th><th>Источник</th><th></th></tr></thead><tbody>
        ${this._rules()
          .map(rule => this._row(rule))
          .join('')}</tbody></table></div></div>`;
  }

  _row(rule) {
    const editing = rule.id === this.ruleEdit.id;
    const note = rule.note ? `<div class="muted">${esc(rule.note)}</div>` : '';
    const status = StationRulesDoc.STATUS;
    return `<tr${editing ? ' class="re-on"' : ''}><td><b>${esc(rule.title)}</b><div class="muted">${esc(rule.group || '')} · ${esc(rule.id)}</div>${note}</td>
          <td>${editing ? this.ruleEdit.html(rule) : esc(StationRulesDoc.val(rule.value, rule.unit))}</td>
          <td><span class="chip sm ${RulesPanel.CHIP[rule.status] || ''}">${esc(status[rule.status] || rule.status)}</span></td><td>${esc(StationRulesDoc.src(rule.source))}</td>
          <td>${this._rowButton(rule, editing)}</td></tr>`;
  }

  _rowButton(rule, editing) {
    if (editing) return '';
    if (RulesPanel.LAYOUT.has(rule.id))
      return '<button class="btn ghost sm" type="button" data-rl="tolayout" title="Правится в «Правилах компоновки» выше">Выше ↑</button>';
    return `<button class="btn ghost sm" type="button" data-reopen="${esc(rule.id)}">Изменить</button>`;
  }

  /** fn с ошибкой — toast (или свой обработчик); true — выполнилось. */
  _try(action, fail = err => toast(err.message)) {
    try {
      action();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  /** Обработчики ввода, выбора и щелчков вкладки. */
  bind() {
    this.root.onchange = event => this._change(event.target);
    this.root.oninput = event => this._input(event.target);
    this.root.addEventListener('toggle', event => this._toggle(event.target), true);
    this.root.onclick = event => this._click(event.target);
  }

  _change(target) {
    if (target.matches('[data-rlf]')) {
      this.statusFilter = target.value;
      this.render();
    } else if (/^m\|pair\.rows\.\d+\.[ab]$/.test(target.dataset.mx || '')) {
      this._try(() => {
        this.layout.read(this.box());
        this.render();
      });
    } else if (target.dataset.mx) {
      const row = target.closest('.lp-r');
      if (row)
        this._try(() => {
          this.layout.read(this.box());
          LayoutEditor.mark(row);
        });
    }
  }

  _input(target) {
    if (target.matches('[data-lpq]')) {
      this.layout.query = target.value;
      this.layout.filter(this.box());
    } else if (target.matches('[data-rlq]')) {
      this.ruleQuery = target.value;
      const caret = target.selectionStart;
      this.render();
      const x = this.root.querySelector('[data-rlq]');
      x?.focus();
      x?.setSelectionRange(caret, caret);
    }
  }

  _toggle(target) {
    if (target.matches?.('[data-mxbox]')) this.layoutOpen = target.open;
  }

  /** Щелчок: первый подходящий элемент из CLICKS. */
  _click(target) {
    for (const [sel, action] of RulesPanel.CLICKS) {
      const el = target.closest(sel);
      if (el) return action.call(this, el);
    }
    return null;
  }

  static CLICKS = [
    [
      '[data-mxdel]',
      function (el) {
        this._try(() => {
          this.layout.del(this.box(), Number(el.dataset.mxdel));
          this.render();
        });
      },
    ],
    [
      '[data-lpdef]',
      function (el) {
        this._try(() => {
          this.layout.read(this.box());
          this.layout.def(el.dataset.lpdef);
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
        const rule = this.data.rules.find(entry => entry.id === el.dataset.reopen);
        if (!rule) return;
        this.ruleEdit.open(rule);
        this.render();
      },
    ],
    [
      '[data-readd]',
      function (el) {
        this._try(() => {
          this.ruleEdit.add(this.root.querySelector('.re'), el.dataset.readd);
          this.render();
        });
      },
    ],
    [
      '[data-redel]',
      function (el) {
        this._try(() => {
          this.ruleEdit.del(this.root.querySelector('.re'), el.dataset.redel);
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
    const preset = LayoutParams.PRESETS.find(entry => entry.id === id) || {};
    let data;
    const ok = this._try(() => {
      this.layout.read(this.box());
      this.layout.usePreset(preset.id);
      data = this.layout.build();
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(data) }, '', `Набор «${preset.title}» действует`) : null;
  }

  _rl_mxadd() {
    this._try(() => {
      this.layout.add(this.box());
      this.render();
    });
  }

  /** Все значения — как в файле поставки, и сразу новой версией правил. */
  async _rl_mxdef() {
    const ok = await AdminDialog.confirm(
      'Все правила компоновки — по умолчанию?',
      'Матрица расстановки, проходы и отступы станут как в файле поставки программы и сразу сохранятся новой версией правил; прежняя версия останется для отката.',
      'Вернуть по умолчанию',
    );
    if (!ok) return null;
    const old = this.layout.work;
    let data;
    const built = this._try(
      () => {
        this.layout.reset();
        data = this.layout.build();
      },
      err => {
        this.layout.work = old;
        toast(err.message);
      },
    );
    return built
      ? this.post({ ...JSON_POST, body: JSON.stringify(data) }, '', 'Правила компоновки — по умолчанию')
      : null;
  }

  _rl_mxsave() {
    let data;
    const ok = this._try(() => {
      this.layout.read(this.box());
      data = this.layout.build();
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(data) }) : null;
  }

  _rl_recancel() {
    this.ruleEdit.id = '';
    this.render();
  }

  _rl_resave() {
    let data;
    const ok = this._try(() => {
      data = this.ruleEdit.build(this.root.querySelector('.re'));
    });
    return ok ? this.post({ ...JSON_POST, body: JSON.stringify(data) }) : null;
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
    const picker = $('#filePick');
    picker.value = '';
    picker.multiple = false;
    picker.accept = '.json';
    picker.onchange = () => {
      const file = picker.files[0];
      picker.accept = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast('Файл больше 2 МБ');
        return;
      }
      this.post({ ...JSON_POST, body: file });
    };
    picker.click();
  }

  /** Отправить правила на сервер и обновить вкладку. */
  async post(opts, query = '', what = 'Правила станций') {
    try {
      const answer = await AdminApi.get(`rules/stations${query}`, opts);
      this.info = answer.info;
      this.data = await StationRulesDoc.load();
      StationRules.use(this.data);
      this.layout.work = null;
      this.ruleEdit.id = '';
      if (typeof StationUi !== 'undefined') StationUi.cache.clear();
      StationCalc.cache.clear();
      toast(`${what}: сохранено, версия ${this.info.version || ''}`);
      this.render(false);
    } catch (err) {
      toast(`Не принято: ${err.message || err}`);
    }
  }
}
