import { Auth } from './auth.js';
import { ClientFields } from './client-store.js';
import { Currency } from './currency.js';
import { Drafts } from './drafts.js';
import { JournalEcon, JournalRow } from './journal-row.js';
import { KpDiff, KpReport } from './kp-report.js';
import { KpFilesPanel } from './kp-files.js';
import { KpRepeat } from './kp-repeat.js';
import { KpTrack } from './kp-track.js';
import { MailDlg } from './mail-dlg.js';
import { Managers } from './managers.js';
import { KpEconomics } from './price-calc.js';
import { Fmt } from '../../core/str.js';
import { Modal } from '../../core/modal.js';
import { AppTabs } from '../../core/app-tabs.js';
import { DealState } from '../deal/deal-state.js';
import { FormView } from '../../ui/form-view.js';
import { KpState, S } from '../../core/state.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { Debounce } from '../../core/debounce.js';
import { FEAT } from '../../core/features.js';
import { DefRegistry } from '../../core/defaults.js';
import { $, esc, today } from '../../core/util.js';
import { KpTabs } from './kp-tabs.js';

/** Журнал КП: сохранённые КП постранично (поиск, автор и итоги считает сервер), открытие, копия, статус, письмо. */
export class Journal {
  static PERCENT = 100;

  /** Окно журнала. */
  static async open() {
    const dialog = Modal.host('jrnWin', 'wide jrnwin', 'Журнал КП');
    dialog.innerHTML = this._html();
    AppTabs.show(dialog, 'jrn');
    dialog.querySelector('[data-close]').onclick = () => this._close(dialog);
    const ctx = {
      dialog,
      rows: [],
      total: 0,
      agg: null,
      funnel: null,
      seq: 0,
      size: Math.round(DefRegistry.num('ui.jPage', 50)),
      any: false,
    };
    this._bind(ctx);
    await this._load(ctx);
    $('#jList').addEventListener(
      'toggle',
      event => {
        if (event.target.classList.contains('jr-more')) JournalRow.place(event.target);
      },
      true,
    );
    $('#jList').onclick = event => this._click(ctx, event.target);
  }

  static _close(dialog) {
    dialog.close();
  }

  // к открытому КП — журнал остаётся своей вкладкой
  static _leave() {
    AppTabs.open(AppTabs.HOME);
  }

  static _html() {
    const statuses = Object.entries(KpTrack.STATUS)
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join('');
    return `<div class="dlg-h"><h3>Журнал КП</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="jbar"><input type="text" id="jQ" placeholder="Поиск: номер КП или закупки, получатель, ИНН, позиция" autocomplete="off"><select id="jK" aria-label="Вид КП"><option value="">Все КП</option><option value="std">Обычные</option><option value="tender">Тендеры</option></select><select id="jA" aria-label="Автор"><option value="">Все авторы</option></select><select id="jS" aria-label="Статус КП"${FEAT.on('track') ? '' : ' hidden'}><option value="">Все статусы</option><option value="open">Не закрытые</option>${statuses}</select><button class="btn" type="button" id="jMe" title="Только мои КП">Мои</button><button class="btn" type="button" id="jDr"${FEAT.on('drafts') ? '' : ' hidden'} title="Незаконченные КП и несохранённые правки">Черновики</button><button class="btn" type="button" id="jRep"${FEAT.on('report') ? '' : ' hidden'} title="Отчёт по КП, прибыли и марже за период — по менеджерам и категориям">Отчёт</button></div>
   <div class="jtot muted" id="jTot"></div><div class="jfun" id="jFun"></div><div id="jList"><p class="empty">Загружаю…</p></div></div>`;
  }

  static _bind(ctx) {
    const search = new Debounce();
    $('#jQ').oninput = () => search.run(() => this._load(ctx), DefRegistry.num('ui.jDelay', 220));
    $('#jA').onchange = $('#jK').onchange = $('#jS').onchange = () => this._load(ctx);
    $('#jFun').onclick = event => {
      const button = event.target.closest('[data-jf]');
      if (!button) return;
      const status = $('#jS');
      status.value = status.value === button.dataset.jf ? '' : button.dataset.jf;
      this._load(ctx);
    };
    $('#jDr').onclick = () => Drafts.dialog();
    $('#jRep').onclick = () => KpReport.open({ author: $('#jA').value, kind: $('#jK').value });
    $('#jMe').onclick = () => this._mine(ctx);
  }

  static _mine(ctx) {
    const myName = (Auth.state.user && Auth.state.user.name) || Managers.meName();
    const author = $('#jA');
    if (!myName) {
      Toast.show('Выберите себя в разделе «Менеджер» — тогда журнал покажет ваши КП');
      return;
    }
    if (![...author.options].some(option => option.value === myName)) {
      Toast.show('У вас ещё нет сохранённых КП');
      return;
    }
    author.value = author.value === myName ? '' : myName;
    $('#jMe').classList.toggle('on', author.value === myName);
    this._load(ctx);
  }

  static _draw(ctx) {
    $('#jTot').innerHTML = this._totals(ctx);
    $('#jFun').innerHTML = this._funnel(ctx.funnel || {});
    const more = ctx.total - ctx.rows.length;
    const opened = $('#jList .jr-more[open]'); // открытое меню «⋯» переживает перерисовку
    $('#jList').innerHTML = ctx.rows.length
      ? ctx.rows.map(row => JournalRow.html(row, JournalEcon.of(row))).join('') +
        (more > 0
          ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" type="button" data-jmore>Показать ещё ${Math.min(more, ctx.size)} из ${more}</button></div>`
          : '')
      : `<p class="empty">${ctx.any ? 'Ничего не найдено.' : 'Журнал пуст. Сохранённые КП появятся здесь.'}</p>`;
    if (!opened) return;
    for (const menu of $('#jList').querySelectorAll('.jr-more')) {
      if (menu.dataset.id !== opened.dataset.id) continue;
      menu.open = true;
      JournalRow.place(menu);
    }
  }

  static _totals(ctx) {
    if (!ctx.total) return '';
    const agg = ctx.agg || {};
    const profit =
      agg.profitN && FEAT.on('deal')
        ? ` · прибыль <b>${KPGen.money(agg.profit)} руб.</b> <span>(по ${agg.profitN} КП с закупкой)</span>`
        : '';
    return `КП: <b>${ctx.total}</b> · на сумму <b>${KPGen.money(agg.sum || 0)} руб.</b>${profit}`;
  }

  static _funnel(funnel) {
    if (!FEAT.on('track') || !Object.keys(funnel).length) return '';
    const count = key => (funnel[key] || {}).n || 0;
    const won = count('won');
    const closed = won + count('lost');
    const chips = Object.entries(KpTrack.STATUS)
      .filter(([key]) => count(key))
      .map(
        ([key, label]) =>
          `<button type="button" class="jf st-${key}${$('#jS').value === key ? ' on' : ''}" data-jf="${key}" title="Показать только «${label}»"><b>${count(key)}</b> ${label} <span>${KPGen.money((funnel[key] || {}).sum || 0)} руб.</span></button>`,
      )
      .join('');
    const conversion = closed
      ? `<span class="jf-c" title="Выиграно из закрытых (выиграно + проиграно)">Конверсия <b>${Math.round((won / closed) * this.PERCENT)} %</b></span>`
      : '';
    return chips + conversion;
  }

  static _query(ctx, offset) {
    const filter = { q: $('#jQ').value.trim(), author: $('#jA').value, kind: $('#jK').value, status: $('#jS').value };
    const url = `/api/history?limit=${ctx.size}&offset=${offset}&q=${encodeURIComponent(filter.q)}&author=${encodeURIComponent(filter.author)}&kind=${encodeURIComponent(filter.kind)}&status=${encodeURIComponent(filter.status)}`;
    return { url, filtered: Object.values(filter).some(Boolean) };
  }

  static _load(ctx) {
    return this._fetch(ctx, 0);
  }

  static _more(ctx) {
    return this._fetch(ctx, ctx.rows.length);
  }

  static async _fetch(ctx, offset) {
    const seq = ++ctx.seq;
    const query = this._query(ctx, offset);
    let answer;
    try {
      answer = await Api.request(query.url);
    } catch {
      if (seq === ctx.seq) $('#jList').innerHTML = '<p class="empty">Журнал недоступен.</p>';
      return;
    }
    if (seq !== ctx.seq || !ctx.dialog.open) return; // пока ждали ответ, изменили поиск
    const items = answer.items || [];
    this._take(ctx, { answer, items, offset, filtered: query.filtered });
    this._authors(answer.authors || []);
    this._draw(ctx);
    await this._oldEcon(ctx, items, seq);
    if (ctx.dialog.open && seq === ctx.seq) this._draw(ctx);
  }

  static _take(ctx, { answer, items, offset, filtered }) {
    ctx.rows = offset ? ctx.rows.concat(items) : items;
    ctx.total = answer.total || 0;
    ctx.agg = answer.agg || null;
    ctx.funnel = answer.funnel || null;
    ctx.any = filtered || ctx.total > 0;
  }

  static _authors(names) {
    const select = $('#jA');
    if (select.dataset.ok) return;
    select.dataset.ok = '1';
    select.innerHTML += names.map(name => `<option>${esc(name)}</option>`).join('');
  }

  // КП, сохранённые прежней версией: экономика считается по сохранённому состоянию КП (параллельно)
  static _oldEcon(ctx, items, seq) {
    return Promise.all(
      items
        .filter(row => !row.econ && !row.locked)
        .map(async row => {
          try {
            const state = await Api.request(`/api/kp/${row.id}/state`);
            if (seq === ctx.seq) row.econ = KpEconomics.of(state);
          } catch {
            row.econ = { cur: 'RUB', sum: row.sum || 0, withCost: 0, positions: row.positions || 0 };
          }
        }),
    );
  }

  static _row(ctx, id) {
    return ctx.rows.find(row => row.id === id);
  }

  static _ACTIONS = [
    ['.jr-t a', () => {}], // ссылка на закупку открывается в браузере
    ['[data-jmore]', ctx => Journal._more(ctx)],
    [
      '[data-jst]',
      (ctx, button) => {
        const row = Journal._row(ctx, button.dataset.jst);
        if (!row) return;
        KpTrack.open(row, track => {
          row.track = track;
          Journal._draw(ctx);
          Journal._load(ctx);
        });
      },
    ],
    [
      '[data-jm]',
      (ctx, button) => {
        const row = Journal._row(ctx, button.dataset.jm);
        if (!row) return;
        MailDlg.open(row.id, row.number, track => {
          row.track = track;
          Journal._draw(ctx);
        });
      },
    ],
    ['[data-jkf]', (ctx, button) => Journal._files(ctx, button)],
    [
      '[data-jr]',
      (ctx, button) => {
        Journal._leave();
        KpRepeat.run(button.dataset.jr);
      },
    ],
    ['[data-jv]', (ctx, button) => KpVersions.open(button.dataset.jv, button.dataset.jn, () => Journal._leave())],
    ['[data-jo]', (ctx, button) => Journal._openKp(ctx, { id: button.dataset.jo })],
    ['[data-jc]', (ctx, button) => Journal._openKp(ctx, { id: button.dataset.jc, copy: true })],
    ['[data-je]', (ctx, button) => Journal._openKp(ctx, { id: button.dataset.je, econ: true })],
  ];

  static _click(ctx, target) {
    for (const [selector, act] of this._ACTIONS) {
      const button = target.closest(selector);
      if (button) {
        act(ctx, button);
        return;
      }
    }
  }

  static _files(ctx, button) {
    const row = this._row(ctx, button.dataset.jkf);
    KpFilesPanel.open(button.dataset.jkf, button.dataset.jn, {
      onClose: count => {
        if (row && (row.files || 0) !== count) {
          row.files = count;
          this._draw(ctx);
        }
      },
    });
  }

  // open — открыть, copy — новое КП на основе этого, econ — открыть и сразу «Экономика сделки»
  static async _openKp(ctx, { id, copy, econ }) {
    try {
      const state = await Api.request(`/api/kp/${id}/state`);
      if (!(await KpTabs.prepare({ kpId: copy ? '' : id }))) return;
      KpState.replace(Object.assign(KpState.fresh(), state));
      if (copy) this._copy();
      else {
        const row = this._row(ctx, state.kpId);
        if (row && row.file) S._file = row.file;
      }
      this._leave();
      FormView.render();
      KpState.persist();
      window.scrollTo({ top: 0 });
      if (copy) Drafts.loaded();
      if (econ) {
        DealState.open();
        return;
      }
      Toast.show(this._opened(copy));
    } catch {
      Toast.show('Не удалось открыть КП');
    }
  }

  static _copy() {
    delete S.kpId;
    delete S.number;
    delete S.createdAt;
    delete S._rev;
    S.date = today();
    ClientFields.clear(S);
    S.authorId = Managers.meId();
    if (S.tender && S.tender.on) S.tender = { on: true, number: '', url: '' }; // копия тендерного КП — под другую закупку
  }

  static _opened(copy) {
    if (!copy) return `КП № ${S.number} открыто для редактирования`;
    return S.tender && S.tender.on
      ? 'Создана копия — укажите получателя и № закупки'
      : 'Создана копия — укажите получателя';
  }
}

/** История версий КП: при каждом пересохранении прежний вариант остаётся в базе (последние 30). */
export class KpVersions {
  /**
   * Окно версий.
   * @param {string} id КП
   * @param {string} number
   * @param {Function} [closeJournal]
   */
  static async open(id, number, closeJournal) {
    let list = [];
    try {
      list = await Api.request(`/api/kp/${encodeURIComponent(id)}/versions`);
    } catch {
      Toast.show('История версий недоступна');
      return;
    }
    const rows = list.length
      ? list.map((version, index) => this._row(version, list.length - index)).join('')
      : '<p class="empty">Прежних версий нет — КП сохранялось один раз.</p>';
    const modal = new Modal(
      `<div class="dlg-h"><h3>Версии КП № ${esc(number || id)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
    <p class="muted">Текущая версия — в журнале. Здесь — прежние варианты: сохраняются автоматически при каждом пересохранении КП (последние 30).</p>
    <div class="kpver-l">${rows}</div>`,
      'kpver',
    );
    modal.d.onclick = event => this._click({ modal, id, number, closeJournal }, event.target);
  }

  static _row(version, place) {
    return `<div class="st-row"><div><b>Версия ${place}</b><span class="muted">до сохранения ${esc(Fmt.dateTime(version.created))}${version.by ? ` (${esc(version.by)})` : ''}${version.sum != null ? ` · ${KPGen.money(version.sum)} ${esc(Currency.short(version.cur || 'RUB'))}` : ''}${version.client ? ` · ${esc(version.client)}` : ''}</span></div>
      <div class="acts"><button class="btn" type="button" data-vc="${version.id}" title="Что изменилось с тех пор">Сравнить с текущей</button><button class="btn" type="button" data-vo="${version.id}">Открыть</button></div></div>`;
  }

  static _click(ctx, target) {
    if (target.closest('[data-x]')) {
      ctx.modal.close();
      return;
    }
    const compare = target.closest('[data-vc]');
    if (compare) {
      KpDiff.open(ctx.id, compare.dataset.vc, ctx.number);
      return;
    }
    const open = target.closest('[data-vo]');
    if (open) this._open(ctx, open.dataset.vo);
  }

  static async _open({ modal, id, closeJournal }, vid) {
    try {
      const state = await Api.request(`/api/kp/${encodeURIComponent(id)}/versions/${vid}`);
      if (!(await KpTabs.prepare({ kpId: id, here: true }))) return;
      KpState.replace(Object.assign(KpState.fresh(), state));
      try {
        S._rev = (await Api.request(`/api/kp/${encodeURIComponent(id)}/rev`)).rev; // прежняя версия заменит текущую правку КП
      } catch {
        delete S._rev;
      }
      modal.close();
      if (closeJournal) closeJournal();
      FormView.render();
      KpState.persist();
      window.scrollTo({ top: 0 });
      Toast.show(
        `Открыта прежняя версия КП № ${S.number || ''}. Сохраните КП, чтобы она стала текущей (нынешняя останется в истории).`,
      );
    } catch {
      Toast.show('Не удалось открыть версию');
    }
  }
}
