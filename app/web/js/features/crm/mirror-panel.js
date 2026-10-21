import { AdminApi, AdminDialog } from '../admin/admin-core.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/**
 * «Настройки → Битрикс24 → Как в Битрикс24»: структура портала (воронки, стадии, поля сделки), загрузка сделок (открытые и
 * закрытые за 2 года), перенос прежних связанных сделок, воронки (показывать, ход КП → стадия, куда новые сделки) и поля
 * карточки по воронкам.
 */
export class MirrorPanel {
  static TRACK = [
    ['lead', 'Запрос'],
    ['sent', 'КП отправлено'],
    ['talks', 'Переговоры'],
    ['contract', 'Договор и оплата'],
  ];
  static POLL_MS = 3000;
  static PERCENT = 100;
  static view = null;
  static box = null;
  static funnel = '';
  static edited = new Set();
  static timer = null;

  /**
   * Открыть вкладку в узле box.
   * @param {HTMLElement} box
   */
  static async open(box) {
    this.box = box;
    this.edited.clear();
    try {
      this.view = await AdminApi.get('bitrix/mirror');
    } catch (error) {
      box.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    this.render();
  }

  /**
   * Перерисовать вкладку.
   * @param {{t: string, err?: boolean}} [note]
   */
  static render(note) {
    const view = this.view;
    const mirror = view.funnels.filter(funnel => funnel.id !== 'main');
    if (!this.funnel || !mirror.some(funnel => funnel.id === this.funnel))
      this.funnel = mirror.length ? mirror[0].id : '';
    const message = note ? `<p class="msg${note.err ? ' err' : ''}" style="text-align:left">${esc(note.t)}</p>` : '';
    this.box.innerHTML = `${message}${this._load(view, mirror)}${mirror.length ? this._funnels(view) + this._fields(view, mirror) : ''}`;
    this._bind();
    this._poll();
  }

  static _load(view, mirror) {
    const job = view.job || {};
    const run = job.state === 'run';
    const jobText = this._job(job);
    const convert = view.convert
      ? `<p>Прежние сделки программы, связанные с Битриксом: <b>${view.convert}</b> — <button class="btn sm" type="button" data-mr="convert">Перенести в воронки Битрикса</button></p>`
      : '';
    return `<div class="st-card"><p class="sub">Кабинет как в Битрикс24</p>
      <p class="muted">Воронки и стадии сделок, поля карточки — как в Битрикс24; сделки и поля синхронизируются в обе стороны.</p>
      <p>${mirror.length ? `Структура загружена ${esc(Fmt.dateTime(view.loaded))}: воронок ${mirror.length}, полей в карточках ${view.fields.filter(field => (field.on || []).length).length}.` : 'Структура ещё не загружена.'}
        <button class="btn${mirror.length ? '' : ' primary'}" type="button" data-mr="structure">${mirror.length ? 'Обновить структуру' : 'Загрузить структуру из Битрикс24'}</button></p>
      ${mirror.length ? `<p>Сделки: открытые и закрытые за последние 2 года. <button class="btn${job.state ? '' : ' primary'}" type="button" data-mr="import"${run ? ' disabled' : ''}>${run ? 'Загружаю…' : 'Загрузить сделки'}</button></p>` : ''}
      ${jobText}${convert}</div>`;
  }

  static _job(job) {
    if (!job.state) return '';
    const counts = `новых ${job.created || 0}, обновлено ${job.updated || 0}, пропущено ${job.skipped || 0}`;
    const states = {
      run: `<p class="msg">Загружаю сделки: обработано ${job.done || 0} (${counts})…</p>`,
      done: `<p class="msg">Загрузка сделок закончена ${esc(Fmt.dateTime(job.at))}: ${counts}, дел ${job.tasks || 0}.</p>`,
      error: `<p class="msg err">Загрузка сделок прервана: ${esc(job.error || '')}</p>`,
    };
    return states[job.state] || '';
  }

  static _stageOptions(funnel, cur) {
    const open = funnel.stages.filter(stage => !stage.sem);
    return [
      `<option value="">— не двигать —</option>`,
      ...open.map(
        stage =>
          `<option value="${esc(stage.key)}"${stage.key === cur ? ' selected' : ''}>${esc(stage.label)}</option>`,
      ),
    ].join('');
  }

  static _funnels(view) {
    const rows = view.funnels
      .map(funnel => {
        const track =
          funnel.id === 'main'
            ? '<td colspan="4" class="muted">этапы программы</td>'
            : this.TRACK.map(
                ([key, label]) =>
                  `<td><select data-mft="${esc(funnel.id)}:${key}" aria-label="${esc(label)}">${this._stageOptions(funnel, (funnel.track || {})[key])}</select></td>`,
              ).join('');
        return `<tr><td><b>${esc(funnel.name)}</b><span class="muted"> · стадий ${funnel.stages.length}</span></td>
          <td><label class="cab-ck"><input type="checkbox" data-mfh="${esc(funnel.id)}"${funnel.hidden ? '' : ' checked'}> показывать</label></td>${track}</tr>`;
      })
      .join('');
    const choose = cur =>
      view.funnels
        .filter(funnel => !funnel.hidden)
        .map(
          funnel =>
            `<option value="${esc(funnel.id)}"${funnel.id === cur ? ' selected' : ''}>${esc(funnel.name)}</option>`,
        )
        .join('');
    const managers = (view.managers || [])
      .map(
        mgr =>
          `<label class="f"><span>${esc(mgr.name)}</span><select data-mfm="${esc(mgr.id)}"><option value="">как у всех</option>${choose((view.byManager || {})[mgr.id])}</select></label>`,
      )
      .join('');
    return `<div class="st-card"><p class="sub">Воронки</p>
      <p class="muted">Ход КП (сохранено, отправлено, в работе, выиграно) двигает сделку по стадиям только вперёд — какие стадии соответствуют.</p>
      <div class="tbl-wrap"><table class="bx-tt"><thead><tr><th>Воронка</th><th></th>${this.TRACK.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <label class="f"><span>Новые сделки (из КП и «＋ Сделка») — в воронку</span><select id="mfNew">${choose(view.newDeals)}</select></label>
      ${managers ? `<details><summary>У отдельных менеджеров — своя воронка</summary><div class="dk-f">${managers}</div></details>` : ''}</div>`;
  }

  static _fields(view, mirror) {
    const tabs = mirror
      .map(
        funnel =>
          `<button type="button" class="chip sm${funnel.id === this.funnel ? ' on' : ''}" data-mff="${esc(funnel.id)}">${esc(funnel.name)} (${view.fields.filter(field => (field.on || []).includes(funnel.id)).length})</button>`,
      )
      .join('');
    const list = view.fields
      .filter(field => (field.fill || {})[this.funnel] || (field.on || []).includes(this.funnel))
      .sort((one, two) => ((two.fill || {})[this.funnel] || 0) - ((one.fill || {})[this.funnel] || 0));
    const rows = list
      .map(field => {
        const share = Math.round(((field.fill || {})[this.funnel] || 0) * this.PERCENT);
        return `<tr><td><label class="cab-ck"><input type="checkbox" data-mfo="${esc(field.code)}"${(field.on || []).includes(this.funnel) ? ' checked' : ''}></label></td>
          <td><input type="text" data-mfl="${esc(field.code)}" value="${esc(field.label || '')}" maxlength="120" aria-label="Название в карточке"><span class="muted"> ${esc(field.title || '')}</span></td>
          <td class="muted">${share}%</td></tr>`;
      })
      .join('');
    return `<div class="st-card"><p class="sub">Поля карточки сделки</p>
      <p class="muted">Включены поля, заполненные хотя бы в 10 % сделок воронки за год; служебные поля Битрикса не показываются. Отметьте нужные.</p>
      <div class="chips">${tabs}</div>
      <div class="tbl-wrap"><table class="bx-tt"><thead><tr><th>В карточке</th><th>Поле</th><th>Заполнено</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">Заполненных полей нет</td></tr>'}</tbody></table></div>
      <div class="row"><button class="btn primary" type="button" data-mr="save">Сохранить</button></div></div>`;
  }

  static _bind() {
    this.box.onclick = event => this._click(event);
    this.box.onchange = event => this._change(event.target);
  }

  static _click(event) {
    const tab = event.target.closest('[data-mff]');
    if (tab) {
      this.funnel = tab.dataset.mff;
      this.render();
      return;
    }
    const action = event.target.closest('[data-mr]');
    if (action) this._act(action.dataset.mr, action);
  }

  static _change(input) {
    const data = input.dataset;
    if (data.mfo != null) this._fieldOn(input);
    else if (data.mfl != null) this._fieldLabel(data.mfl, input.value);
    else if (data.mfh != null) this._funnelOf(data.mfh).hidden = !input.checked;
    else if (data.mft != null) this._track(data.mft, input.value);
    else if (data.mfm != null) this._manager(data.mfm, input.value);
    else if (input.id === 'mfNew') this.view.newDeals = input.value;
  }

  static _funnelOf(id) {
    return this.view.funnels.find(funnel => funnel.id === id);
  }

  static _fieldOf(code) {
    this.edited.add(code);
    return this.view.fields.find(field => field.code === code);
  }

  static _fieldOn(input) {
    const field = this._fieldOf(input.dataset.mfo);
    const list = new Set(field.on || []);
    list[input.checked ? 'add' : 'delete'](this.funnel);
    field.on = [...list];
  }

  static _fieldLabel(code, label) {
    this._fieldOf(code).label = label;
  }

  static _track(address, stage) {
    const [id, key] = address.split(':');
    const funnel = this._funnelOf(id);
    funnel.track = { ...(funnel.track || {}), [key]: stage };
  }

  static _manager(mid, id) {
    this.view.byManager = { ...(this.view.byManager || {}), [mid]: id };
    if (!id) delete this.view.byManager[mid];
  }

  static async _act(action, button) {
    const asks = {
      structure: [
        'Загрузить структуру Битрикс24?',
        'Воронки, стадии и поля сделки — с портала; выбор полей администратором сохраняется.',
        'Загрузить',
      ],
      import: [
        'Загрузить сделки из Битрикс24?',
        'Открытые сделки и закрытые за 2 года — в фоне (несколько тысяч сделок — до получаса).',
        'Загрузить',
      ],
      convert: [
        'Перенести сделки в воронки Битрикса?',
        'Связанные сделки программы встанут в воронку и стадию, как в Битрикс24.',
        'Перенести',
      ],
    };
    if (asks[action] && !(await AdminDialog.confirm(...asks[action]))) return;
    button.disabled = true;
    try {
      this.view =
        action === 'save'
          ? await AdminApi.post('bitrix/mirror/options', this._payload())
          : await AdminApi.post(`bitrix/mirror/${action}`, {});
      this.edited.clear();
      this.render({ t: this._done(action, this.view.result || {}) });
    } catch (error) {
      button.disabled = false;
      this.render({ t: String(error.message || error), err: true });
    }
  }

  static _done(action, result) {
    const texts = {
      structure: () => `Загружено: воронок ${result.funnels}, полей ${result.fields}, в карточках ${result.on}`,
      import: () => 'Загрузка сделок идёт в фоне — ход виден здесь',
      convert: () => `Перенесено сделок: ${result.moved}`,
      save: () => 'Сохранено',
    };
    return texts[action]();
  }

  static _payload() {
    const view = this.view;
    const funnels = Object.fromEntries(
      view.funnels.map(funnel => [
        funnel.id,
        funnel.id === 'main' ? { hidden: !!funnel.hidden } : { hidden: !!funnel.hidden, track: funnel.track || {} },
      ]),
    );
    const fields = Object.fromEntries(
      view.fields
        .filter(field => this.edited.has(field.code))
        .map(field => [field.code, { on: field.on || [], label: field.label }]),
    );
    return { funnels, newDeals: view.newDeals, byManager: view.byManager || {}, fields };
  }

  /** ход загрузки сделок — опрос, пока идёт и вкладка открыта */
  static _poll() {
    clearTimeout(this.timer);
    if ((this.view.job || {}).state !== 'run') return;
    this.timer = setTimeout(async () => {
      if (!this.box || !this.box.isConnected) return;
      try {
        this.view = await AdminApi.get('bitrix/mirror');
      } catch {
        return;
      }
      this.render();
    }, this.POLL_MS);
  }
}
