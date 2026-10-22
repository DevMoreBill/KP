import { CrmData } from './crm-data.js';
import { CrmFmt, DateChips } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { CrmTask } from './crm-task.js';
import { DealFieldsView } from './deal-fields.js';
import { DealFeed } from './deal-feed.js';
import { LostPick } from './lost-pick.js';
import { DealNeed } from './deal-need.js';
import { DealKp } from './deal-kp.js';
import { Cabinet } from './cabinet.js';
import { DealParts } from './deal-parts.js';
import { DealNow } from './deal-now.js';
import { DealExec } from './deal-exec.js';
import { DealWin } from './deal-win.js';
import { DealClient } from './deal-client.js';
import { ClientSuggest } from './client-suggest.js';
import { InnClient } from './inn-client.js';
import { SentCall } from './sent-call.js';
import { DealDocs } from './deal-docs.js';
import { KpTrack } from '../kp/kp-track.js';
import { MailDlg } from '../kp/mail-dlg.js';
import { FEAT } from '../../core/features.js';
import { ClientStore } from '../kp/client-store.js';
import { UiKit } from '../../ui/ui-kit.js';
import { Mobile } from '../../ui/mobile.js';
import { Fmt, Str } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { ClientCard } from '../kp/client-card.js';
import { KpDate } from '../kp/kp-date.js';
import { Morph } from '../../core/morph.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { Modal } from '../../core/modal.js';

/**
 * Карточка сделки — панель справа (на телефоне — весь экран): стадии, «О сделке», поля Битрикс24, следующий шаг и дела, КП,
 * история. Всё сохраняется сразу при изменении (номер правки — X-KP-Rev), «‹ ›» — соседняя сделка списка.
 */
export class DealCard {
  static MANY = 8;
  static SAVED_MS = 2000;
  static CLIENTS_SHOWN = 50;
  static KOPECKS = 100;
  static HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static FIELDS = {
    title: 'название',
    client: 'клиент',
    expected: 'ожидаемая дата',
    sum: 'сумма',
    note: 'заметка',
    myCompany: 'наша компания',
  };
  static deal = null;
  static modal = null;
  static changed = false;
  static list = [];
  static queue = Promise.resolve();
  static _flashTimer = 0;

  /**
   * Открыть сделку (открыта другая — панель показывает новую на месте).
   * @param {string} id
   * @param {{list?: string[]}} [opts] list — сделки, по которым листают «‹ ›»
   * @returns {Promise<void>}
   */
  static open(id, opts = {}) {
    if (opts.list) this.list = opts.list;
    else if (!this.modal) this.list = [];
    if (this.modal) return this._show(id);
    return Modal.once('deal-card', () => this._open(id));
  }

  /**
   * Свежая карточка сделки с сервера (ошибка — всплывающей строкой).
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  static async fetch(id) {
    try {
      return this._keep(await Api.request(`/api/crm/deal/${encodeURIComponent(id)}`));
    } catch (error) {
      Toast.show(`Сделка не открылась: ${error.message}`);
      return null;
    }
  }

  static _keep(deal) {
    if (deal && deal.funnels) CrmFunnel.cache = deal.funnels;
    return deal;
  }

  static async _open(id) {
    const deal = await this.fetch(id);
    if (!deal) return;
    this.deal = deal;
    this.changed = false;
    const modal = new Modal(this.html(), 'deal-dlg');
    this.modal = modal;
    DealWin.bind(modal.d);
    modal.d.addEventListener('close', () => this._closed());
    modal.d.addEventListener('click', event => this._click(event));
    modal.d.addEventListener('change', event => this._change(event));
    modal.d.addEventListener('keydown', event => this._key(event));
    modal.d.addEventListener('input', event => this._input(event));
    modal.d.addEventListener('toggle', event => DealParts.toggled(event.target), true);
    CrmTask.bind(modal.d, () => this.reload());
    DealDocs.bind(
      modal.d,
      () => this.deal,
      task => this._apply(task),
    );
  }

  static _closed() {
    const cabinet = document.getElementById('cabWin');
    if (this.changed && cabinet && cabinet.open) Cabinet.reload();
    this.modal = null;
  }

  /** Закрыть панель. */
  static close() {
    if (this.modal) this.modal.close();
  }

  static async _show(id) {
    await this.queue;
    const deal = await this.fetch(id);
    if (!deal || !this.modal) return;
    this.deal = deal;
    this.render();
    this.modal.d.querySelector('.dk-in')?.scrollTo(0, 0);
  }

  /** Обновить сделку с сервера (после изменения дела). */
  static async reload() {
    try {
      this.deal = this._keep(await Api.request(`/api/crm/deal/${this.deal.id}`));
    } catch (error) {
      Toast.show(`Не обновилось: ${error.message}`);
      return;
    }
    this.changed = true;
    this.render();
  }

  /** Перерисовать на месте: поле, в котором сейчас печатают, сохраняет набранное. */
  static render() {
    if (!this.modal) return;
    const active = document.activeElement;
    const field = active && this.modal.d.contains(active) && active.matches('input,textarea') ? active : null;
    const typed = field ? field.value : null;
    Morph.apply(this.modal.d, this.html());
    if (field && field.isConnected && field.value !== typed) field.value = typed;
  }

  /**
   * Содержимое панели.
   * @returns {string}
   */
  static html() {
    const deal = this.deal;
    return `${DealWin.grip()}${this._top(deal)}<div class="dk-in">${this._steps(deal)}${DealParts.facts(deal)}${DealNow.html(deal)}
      <div class="dk-cols"><div class="dk-main">${this._parts(deal)}</div>
      <div class="dk-side">${DealFeed.html(deal, item => this.hist(item))}</div></div></div>`;
  }

  // разделы строками-раскрывашками: итог — в заголовке
  static _parts(deal) {
    const offers = deal.kps || [];
    const fields = DealFieldsView.body(deal);
    const note = fields ? DealFieldsView.note(deal) : null;
    const parts = [
      {
        key: 'about',
        title: 'Клиент и сделка',
        note: this._aboutNote(deal),
        body: this._about(deal),
        open: !Mobile.isPhone(),
      },
      {
        key: 'kp',
        title: 'КП по сделке',
        note: offers.length
          ? `${offers.length} · последнее № ${esc(offers[0].number)}, ${CrmFmt.rub(offers[0].sum)}`
          : 'ещё нет',
        body: this._kps(deal),
      },
      { html: DealDocs.part(deal) },
      fields && {
        key: 'fields',
        title: 'Поля Битрикс24',
        note: note.text,
        body: fields,
        open: note.empty > 0,
        tone: note.empty ? 'warn' : '',
      },
      DealExec.has(deal) && {
        key: 'exec',
        title: 'Исполнение',
        note: DealExec.note(deal.exec),
        body: DealExec.body(deal),
        open: !!deal.exec.signed,
      },
    ];
    return parts
      .filter(Boolean)
      .map(part => part.html || DealParts.part(part))
      .join('');
  }

  static _aboutNote(deal) {
    const person = ((deal.clientCard || {}).contacts || [])[0];
    const who = person ? [person.name, person.phone].filter(Boolean).join(', ') : 'контакта нет';
    return esc([deal.client || 'клиент не указан', who].join(' · '));
  }

  static _top(deal) {
    const created = KpDate.ddmm(String(deal.created || '').slice(0, 10));
    const card =
      ClientCard.enabled() && (deal.client || deal.clientInn)
        ? `<button class="btn sm ghost" type="button" data-cc="${esc(JSON.stringify({ id: deal.clientId || '', inn: deal.clientInn || '', name: deal.client || '' }))}">Карточка клиента</button>`
        : '';
    return `<header class="dk-top">${this._nav(deal)}<div class="dk-hd"><span class="muted">Сделка № ${esc(deal.number)}${deal.manager ? ` · ${esc(deal.manager)}` : ''} · создана ${esc(created)} <span class="dk-saved" aria-live="polite"></span></span>
      <input type="text" class="dk-title" data-dkf="title" value="${esc(deal.title || '')}" maxlength="200" aria-label="Название сделки" placeholder="Название: объект или задача клиента">${this._bx(deal)}</div>
      <div class="dk-acts">${card}<button class="icon" type="button" data-x aria-label="Закрыть сделку" title="Закрыть (Esc)">✕</button></div></header>`;
  }

  static _nav(deal) {
    const index = this.list.indexOf(deal.id);
    if (index < 0 || this.list.length < 2) return '';
    const prev = index > 0 ? '' : ' disabled';
    const next = index < this.list.length - 1 ? '' : ' disabled';
    return `<div class="dk-nav" role="group" aria-label="Соседние сделки"><button class="icon" type="button" data-dknav="-1" aria-label="Предыдущая сделка" title="Предыдущая (←)"${prev}>‹</button><span class="muted">${index + 1} из ${this.list.length}</span><button class="icon" type="button" data-dknav="1" aria-label="Следующая сделка" title="Следующая (→)"${next}>›</button></div>`;
  }

  static _bx(deal) {
    const link = deal.bx;
    if (!link) return '';
    if (!link.id) {
      return `<span class="dk-bx${link.error ? ' bad-t' : ''}">Битрикс24: ${link.error ? `не отправлено — ${esc(link.error)}` : 'ждёт отправки'}</span>`;
    }
    const url = link.url
      ? `<a href="${esc(link.url)}" target="_blank" rel="noopener">сделка ${esc(link.id)} ↗</a>`
      : `сделка ${esc(link.id)}`;
    return `<span class="dk-bx">Битрикс24: ${url} · синхронизировано ${esc(Fmt.dateTime(link.at))}</span>`;
  }

  static _stageLabel(stages, key, fallback) {
    return (stages.find(stage => stage.key === key) || {}).label || fallback;
  }

  static _closers(deal, stages) {
    const won = deal.stage === 'won';
    const lost = deal.stage === 'lost';
    return `<span class="dk-sp"></span><button type="button" class="dk-s dk-won${won ? ' on' : ''}" data-dks="won" aria-pressed="${won}">✓ ${esc(this._stageLabel(stages, 'won', 'Выиграно'))}</button><button type="button" class="dk-s dk-lost${lost ? ' on' : ''}" data-dks="lost" aria-pressed="${lost}">✕ ${esc(this._stageLabel(stages, 'lost', 'Проиграно'))}</button>`;
  }

  static _why(deal) {
    if (deal.stage !== 'lost') return '';
    const label = CrmFunnel.label(deal);
    const reason = deal.lostReason && deal.lostReason !== label ? ` — ${esc(deal.lostReason)}` : '';
    return `<p class="msg warn dk-why">Проиграна: ${esc(label)}${reason} <button type="button" class="lnk" data-dks="lost">изменить причину</button></p>`;
  }

  static _steps(deal) {
    const stages = CrmFunnel.columns(deal.funnel);
    const open = stages.filter(stage => !stage.closed);
    if (open.length > this.MANY) return this._stepList(deal, open, stages);
    const index = open.findIndex(stage => stage.key === deal.stage);
    const closed = CrmFunnel.closed(deal);
    const chevrons = open
      .map((stage, pos) => {
        const now = stage.key === deal.stage;
        const past = pos < index && !closed;
        const tone = now || past ? ` t-${CrmFunnel.tone(deal.funnel, stage.key)}` : '';
        return `<button type="button" role="radio" aria-checked="${now}" class="dk-s${now ? ' on' : ''}${past ? ' past' : ''}${tone}" data-dks="${esc(stage.key)}" title="${esc(stage.label)}">${esc(stage.label)}</button>`;
      })
      .join('');
    return `<div class="dk-st" role="radiogroup" aria-label="Стадия сделки">${chevrons}${this._closers(deal, stages)}</div>${this._why(deal)}`;
  }

  static _stepList(deal, open, stages) {
    const closed = CrmFunnel.closed(deal);
    const head = closed ? `<option value="" selected>${esc(CrmFunnel.label(deal))}</option>` : '';
    const options = open
      .map(
        stage =>
          `<option value="${esc(stage.key)}"${stage.key === deal.stage ? ' selected' : ''}>${esc(stage.label)}</option>`,
      )
      .join('');
    const index = open.findIndex(stage => stage.key === deal.stage);
    const progress = closed ? '' : `<span class="muted dk-stn">${index + 1} из ${open.length}</span>`;
    return `<div class="dk-st dk-stl"><label class="f"><span>Стадия</span><select data-dkf="stage"${closed ? ' class="muted"' : ''}>${head}${options}</select></label>${progress}${this._closers(deal, stages)}</div>${this._why(deal)}`;
  }

  static _sumField(deal) {
    const auto = (deal.kps || []).find(row => row.status !== 'lost') || (deal.kps || [])[0];
    const autoText = auto
      ? `${Math.round((auto.sum || 0) / this.KOPECKS).toLocaleString('ru-RU')} — по КП № ${auto.number}`
      : 'по последнему КП';
    const own = deal.sumOwn ? esc(String(Math.round((deal.sum || 0) / this.KOPECKS))) : '';
    const sumTip = UiKit.tip(
      '<p>Пусто — сумма сделки берётся из последнего КП (без проигранных) и меняется вместе с ним.</p><p>Впишите свою сумму, если сделка без КП или договорились о другой цене. Сотрите — снова по КП.</p>',
    );
    return `<label class="f"><span>Сумма, ₽ <em class="muted">${deal.sumOwn ? 'своя' : 'по КП'}</em>${sumTip}</span><input type="text" inputmode="decimal" data-dkf="sum" value="${own}" placeholder="${esc(autoText)}"></label>`;
  }

  static _about(deal) {
    const clients = (ClientStore.list || [])
      .slice(0, this.CLIENTS_SHOWN)
      .map(client => `<option value="${esc(client.name)}">`)
      .join('');
    return `<p class="muted dk-auto">Всё сохраняется само.</p><div class="dk-f">
      <label class="f dk-wide"><span>Клиент</span><input type="text" data-dkf="client" value="${esc(deal.client || '')}" maxlength="300" list="dkCl" autocomplete="off" placeholder="Название, ИНН, телефон, e-mail или ФИО контакта — подскажем"></label>
      ${DealClient.html(deal)}${this._sumField(deal)}
      <label class="f"><span>Ожидаемая дата договора</span><input type="date" data-dkf="expected" value="${esc(deal.expected || '')}"></label>
      <div class="dk-wide dk-dchips">${DateChips.html(DateChips.DEAL, 'expected', deal.expected)}</div>
      <label class="f dk-wide"><span>Заметка</span><textarea data-dkf="note" rows="2" maxlength="3000" placeholder="Кратко о заявке: что нужно клиенту, кто решает, бюджет, сроки">${esc(deal.note || '')}</textarea></label>
      </div>${this._rare(deal)}<datalist id="dkCl">${clients}</datalist>`;
  }

  // редкое — воронка, ответственный, наша компания — под раскрытием
  static _rare(deal) {
    const fields = `${this.funnelSelect(deal)}${this._managerSelect(deal)}${this._myCompany(deal)}`;
    if (!fields) return '';
    return `<details class="dk-rare"><summary>Воронка, ответственный, наша компания</summary><div class="dk-f">${fields}</div></details>`;
  }

  /**
   * Выбор воронки (когда их больше одной).
   * @param {object} deal
   * @param {string} [attr] атрибут поля (по умолчанию — поле карточки)
   * @returns {string}
   */
  static funnelSelect(deal, attr = 'data-dkf="funnel"') {
    const list = CrmFunnel.visible();
    if (list.length < 2) return '';
    const options = list
      .map(
        funnel =>
          `<option value="${esc(funnel.id)}"${funnel.id === (deal.funnel || CrmFunnel.MAIN) ? ' selected' : ''}>${esc(funnel.name)}</option>`,
      )
      .join('');
    return `<label class="f"><span>Воронка${UiKit.tip('<p>Воронка — набор стадий сделки (своя программы или повторённая из Битрикс24). При переносе в другую воронку сделка встаёт на её первую стадию.</p>')}</span><select ${attr}>${options}</select></label>`;
  }

  // наша компания — реквизиты продавца в сделке Битрикс24
  static _myCompany(deal) {
    const list = deal.myCompanies || [];
    if (!list.length) return '';
    const current = deal.myCompany || deal.myCompanyDefault || '';
    const blank = current ? '' : '<option value="" selected>как в Битрикс24</option>';
    const options = list
      .map(row => `<option value="${esc(row.id)}"${row.id === current ? ' selected' : ''}>${esc(row.title)}</option>`)
      .join('');
    const tip = UiKit.tip(
      '<p>Чьи реквизиты стоят в сделке Битрикс24 («Реквизиты вашей компании»). По умолчанию — как в «Настройках → Битрикс24 → Что передаётся».</p>',
    );
    return `<label class="f"><span>Наша компания${tip}</span><select data-dkf="myCompany">${blank}${options}</select></label>`;
  }

  static _managerSelect(deal) {
    const board = CrmData.board || {};
    const managers = board.managers || [];
    if (!board.canAll || !managers.length) return '';
    const options = managers
      .map(
        mgr =>
          `<option value="${esc(mgr.id)}"${mgr.id === deal.managerId ? ' selected' : ''}>${esc(mgr.name)}</option>`,
      )
      .join('');
    const other = managers.some(mgr => mgr.id === deal.managerId)
      ? ''
      : `<option value="${esc(deal.managerId)}" selected>${esc(deal.manager || '—')}</option>`;
    return `<label class="f"><span>Ответственный</span><select data-dkf="managerId">${options}${other}</select></label>`;
  }

  static _kps(deal) {
    const rows = (deal.kps || []).map(offer => this._kpRow(offer)).join('') || '<p class="empty">КП ещё нет.</p>';
    return `${rows}<div class="row dk-kb"><button class="btn" type="button" data-dknew>＋ Новое КП для сделки</button><button class="btn ghost" type="button" data-dklink title="КП этого клиента из журнала — в эту сделку">Добавить КП клиента</button></div>`;
  }

  static _kpRow(offer) {
    const items = `${esc((offer.items || [])[0] || '')}${offer.positions > 1 ? ` и ещё ${offer.positions - 1}` : ''}`;
    const valid = offer.validUntil ? ` · действует до ${esc(KpDate.ddmm(offer.validUntil))}` : '';
    const status = FEAT.on('track')
      ? `<span class="md-st"><span class="jst st-${esc(offer.status)}">${esc(KpTrack.STATUS[offer.status] || offer.status)}</span></span>`
      : '';
    return `<div class="md-r"><span class="md-n">№ ${esc(offer.number)}</span><div><b>${esc(KpDate.ddmm(offer.date))} · ${CrmFmt.rub(offer.sum)}</b><span class="muted">${items}${valid}</span>${status}</div><button class="btn sm" type="button" data-dko="${esc(offer.id)}">Открыть</button></div>`;
  }

  /**
   * Строка истории сделки.
   * @param {object} item
   * @returns {string}
   */
  static hist(item) {
    const label = key => CrmFunnel.anyLabel(key);
    const fields = () =>
      (item.fields || []).map(
        code => ((this.deal.fields || []).find(field => field.code === code) || {}).label || code,
      );
    const texts = {
      create: () => (item.kp ? `сделка создана по КП № ${item.kp}` : 'сделка создана'),
      stage: () => `стадия: ${label(item.from)} → ${label(item.to)}${item.auto ? ' (по ходу КП)' : ''}`,
      kp: () => `добавлено КП № ${item.kp}`,
      kpOut: () => `КП № ${item.kp} перенесено в другую сделку`,
      manager: () => `ответственный: ${item.to}`,
      funnel: () => `воронка: ${CrmFunnel.get(item.from).name} → ${CrmFunnel.get(item.to).name}`,
      fields: () => `поля Битрикс24${item.auto ? ' заполнены по КП' : ''}: ${fields().join(', ')}`,
      edit: () => `изменено: ${(item.fields || []).map(field => this.FIELDS[field] || field).join(', ')}`,
    };
    return texts[item.what] ? texts[item.what]() : '';
  }

  /**
   * Сохранить изменения (по очереди: каждое — со свежим номером правки).
   * @param {object} body
   * @returns {Promise<boolean>}
   */
  static save(body) {
    const result = this.queue.then(() => this._save(body));
    this.queue = result.catch(() => false);
    return result;
  }

  static async _save(body) {
    if (!this.deal) return false;
    try {
      this.deal = this._keep(
        await Api.request(`/api/crm/deal/${this.deal.id}`, {
          method: 'PUT',
          headers: { ...this.HEAD, 'X-KP-Rev': String(this.deal.rev) },
          body: JSON.stringify(body),
        }),
      );
      this.changed = true;
      return true;
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message}`);
      this.deal = (await Api.request(`/api/crm/deal/${this.deal.id}`).catch(() => null)) || this.deal;
      return false;
    } finally {
      this.render();
    }
  }

  static _flash() {
    const mark = this.modal && this.modal.d.querySelector('.dk-saved');
    if (!mark) return;
    mark.textContent = 'Сохранено ✓';
    mark.classList.add('on');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      mark.textContent = '';
      mark.classList.remove('on');
    }, this.SAVED_MS);
  }

  static _input(event) {
    const add = event.target.closest('[data-ufadd]');
    if (add) {
      this._ufSave(DealFieldsView.added(add, this.deal));
      return;
    }
    const field = event.target.closest('[data-dkf="client"]');
    if (field) ClientSuggest.run(field, client => this._pickClient(client, field));
  }

  static async _pickClient(client, field) {
    field.value = client.name || '';
    const body = { client: client.name || '', clientId: client.id || '', clientInn: client.inn || '' };
    if (await this.save(body)) this._flash();
  }

  /**
   * Отметка точки исполнения (по очереди с прочими сохранениями).
   * @param {{key: string, at: string}} body
   * @returns {Promise<boolean>}
   */
  static mark(body) {
    const result = this.queue.then(() => this._mark(body));
    this.queue = result.catch(() => false);
    return result;
  }

  static async _mark(body) {
    try {
      this.deal = this._keep(
        await Api.request(`/api/crm/deal/${this.deal.id}/exec`, {
          method: 'PUT',
          headers: this.HEAD,
          body: JSON.stringify(body),
        }),
      );
      this.changed = true;
      this.render();
      this._flash();
      return true;
    } catch (error) {
      Toast.show(`Не отмечено: ${error.message}`);
      return false;
    }
  }

  static async _change(event) {
    const day = DealExec.change(event);
    if (day) {
      this.mark(day);
      return;
    }
    const custom = event.target.closest('[data-uf]');
    if (custom) {
      const { code, value } = DealFieldsView.read(custom, this.deal);
      if (await this.save({ uf: { [code]: value } })) this._flash();
      return;
    }
    const field = event.target.closest('[data-dkf]');
    if (field) this._field(field);
  }

  // поле «О сделке»: стадия — через регламент, ИНН в «Клиенте» — клиент из ФНС, прочее — сохранить
  static async _field(field) {
    if (field.dataset.dkf === 'stage') {
      if (field.value) this._stage(field.value);
      return;
    }
    if (field.dataset.dkf === 'client' && InnClient.looks(field.value) && !this._known(field.value)) {
      const client = await InnClient.find(field.value);
      if (client) this._pickClient(client, field);
      return;
    }
    const body = this._body(field.dataset.dkf, field.value);
    if (body && (await this.save(body))) this._flash();
  }

  static _known(text) {
    const digits = String(text).replace(/\D/g, '');
    return (ClientStore.list || []).some(row => row.inn === digits);
  }

  static _body(key, value) {
    if (key === 'stage' && !value) return null;
    if (key === 'title' && !value.trim()) {
      Toast.show('Название сделки не может быть пустым');
      return null;
    }
    const body = { [key]: key === 'sum' ? value.replace(/\s/g, '') : value };
    if (key === 'client') {
      const client = (ClientStore.list || []).find(row => Str.norm(row.name) === Str.norm(value));
      body.clientInn = client ? client.inn || '' : '';
      body.clientId = client ? client.id : '';
    }
    return body;
  }

  static async _stage(key) {
    const deal = this.deal;
    if (key === deal.stage && key !== 'lost') return;
    const body = key === 'lost' ? await LostPick.ask(deal) : { stage: key };
    if (body) this._apply(() => DealNeed.move(this.deal, body));
  }

  // кнопки «Что сделать сейчас»
  static _now(act) {
    const deal = this.deal;
    const next = DealNow.nextStage(deal);
    const actions = {
      next: () => next && this._stage(next.key),
      fill: () => deal.regsNext && this._apply(() => DealNeed.fill(this.deal, deal.regsNext.stage)),
      kp: () => DealKp.newKp(deal),
      send: () => this._sendKp(deal),
      sent: () => this._sentKp(deal),
      link: () => DealKp.link(deal, () => this.reload()),
      task: () => CrmTask.quick(deal.id, () => this.reload()),
      exec: () => this._reveal('exec', '[data-dkpart="exec"]'),
      date: () => this._reveal('about', '[data-dkf="expected"]'),
      docs: () => this._docs(),
    };
    if (actions[act]) actions[act]();
  }

  // «Прикрепить акт / УПД»: выбор файла сразу (по нажатию), раздел «Документы» раскрыт
  static _docs() {
    DealDocs.kind = 'upd';
    DealParts.show('docs');
    this.render();
    DealDocs.pick(files => this._apply(() => DealDocs.upload(this.deal, files)));
  }

  static _sendKp(deal) {
    const offer = DealNow.offer(deal);
    if (offer) MailDlg.open(offer.id, offer.number, () => this._callAfter(offer));
  }

  // КП отправлено не из программы — отметить: сделка пойдёт дальше сама
  static async _sentKp(deal) {
    const offer = DealNow.offer(deal);
    if (!offer) return;
    try {
      await KpTrack.put(offer.id, { status: 'sent' });
    } catch (error) {
      Toast.show(`Не отмечено: ${error.message}`);
      return;
    }
    this._callAfter(offer);
  }

  // КП ушло — обновить сделку (звонок программа ставит сама) и сразу спросить, когда позвонить
  static async _callAfter(offer) {
    await this.reload();
    SentCall.ask(this.deal, offer, () => this.reload());
  }

  // раскрыть раздел и показать нужное место
  static _reveal(part, selector) {
    DealParts.show(part);
    this.render();
    const target = this.modal && this.modal.d.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target.matches('input,select,textarea')) target.focus();
  }

  // по очереди с прочими сохранениями: ответ — карточка сделки
  static _apply(run) {
    const done = this.queue.then(async () => {
      const deal = await run();
      if (!deal) return false;
      this.deal = this._keep(deal);
      this.changed = true;
      this.render();
      this._flash();
      return true;
    });
    this.queue = done.catch(() => false);
    return done;
  }

  static _go(step) {
    const index = this.list.indexOf(this.deal.id) + step;
    if (index >= 0 && index < this.list.length) this._show(this.list[index]);
  }

  static _click(event) {
    if (DealWin.outside(this.modal.d, event)) {
      this.close();
      return;
    }
    if (DealFeed.click(event)) {
      this.render();
      return;
    }
    const exec = DealExec.click(event);
    if (exec) {
      this.mark(exec);
      return;
    }
    const actions = [
      ['[data-x]', () => this.close()],
      ['[data-dkpick]', el => this._pick(el.dataset.dkpick)],
      ['[data-dkcomm]', () => this._comment()],
      ['[data-ufpick]', el => this._ufSave(DealFieldsView.toggle(el, this.deal))],
      ['[data-dknav]', el => this._go(+el.dataset.dknav)],
      ['[data-dks]', el => this._stage(el.dataset.dks)],
      ['[data-dknow]', el => this._now(el.dataset.dknow)],
      ['[data-dko]', el => DealKp.openKp(el.dataset.dko)],
      ['[data-dknew]', () => DealKp.newKp(this.deal)],
      ['[data-dklink]', () => DealKp.link(this.deal, () => this.reload())],
      ['[data-cc]', el => ClientCard.open(JSON.parse(el.dataset.cc))],
    ];
    for (const [selector, run] of actions) {
      const el = event.target.closest(selector);
      if (el) {
        run(el);
        return;
      }
    }
  }

  static async _comment() {
    const area = this.modal && this.modal.d.querySelector('#dkComment');
    const text = area ? area.value.trim() : '';
    if (!text) {
      Toast.show('Напишите комментарий');
      return;
    }
    const sent = this.queue.then(async () => {
      try {
        this.deal = this._keep(
          await Api.request(`/api/crm/deal/${this.deal.id}/comment`, {
            method: 'POST',
            headers: this.HEAD,
            body: JSON.stringify({ text }),
          }),
        );
        this.changed = true;
        if (area) area.value = '';
        this.render();
        this._flash();
      } catch (error) {
        Toast.show(`Комментарий не сохранён: ${error.message}`);
      }
    });
    this.queue = sent.catch(() => false);
  }

  static async _ufSave(change) {
    if (change && (await this.save({ uf: { [change.code]: change.value } }))) this._flash();
  }

  static async _pick(id) {
    const body = DealClient.picked(this.deal, id);
    if (body && (await this.save(body))) this._flash();
  }

  static _key(event) {
    const typing = event.target.closest('input,textarea,select,[contenteditable]');
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1 };
    if (!steps[event.key]) return;
    event.preventDefault();
    this._go(steps[event.key]);
  }
}
