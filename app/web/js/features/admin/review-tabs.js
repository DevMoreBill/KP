import { AdminApi, AdminDialog, AdminState, AuditLabels } from './admin-core.js';
import { AdminInbox, AdminReadiness } from './admin-inbox.js';
import { SettingsWindow } from './settings-window.js';
import { Debounce } from '../../core/debounce.js';
import { Catalog } from '../catalog/catalog-store.js';
import { CatalogEditor } from '../catalog/catalog-edit.js';
import { Toast } from '../../core/toast.js';
import { ModerationList, ModerationView } from '../catalog/moderation.js';
import { Journal } from '../kp/journal.js';
import { KpReport } from '../kp/kp-report.js';
import { DefRegistry } from '../../core/defaults.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/** Сводка «Обзора»: плитки, график КП по периодам, менеджеры, товары, модерация, база. */
export class StatsTab {
  static CHART = {
    width: 640,
    height: 180,
    axis: 22,
    labels: 8,
    many: 16,
    minBar: 3,
    minWidth: 2,
    round: 4,
    labelY: 15,
    maxWidth: 2000,
    pad: 40,
  };
  // ширина рисунка — по месту в окне: иначе 640 растягивались на весь монитор вместе с подписями и высотой
  static drawWidth = 640;
  static KOPECKS = 100;
  static ACTIVE_DAYS = 30;
  static PERIODS = [
    ['day', 'Дни'],
    ['week', 'Недели'],
    ['month', 'Месяцы'],
  ];
  static TITLES = { day: 'дням (30 дней)', week: 'неделям (12 недель)', month: 'месяцам (12 месяцев)' };

  /**
   * Столбцы одного ряда с подсказкой при наведении/касании.
   * @param {Array<{label: string, count: number}>} series
   * @returns {string}
   */
  static bars(series) {
    const { height, axis } = this.CHART;
    const width = this.drawWidth;
    const max = Math.max(1, ...series.map(row => row.count));
    const count = series.length;
    const barWidth = width / count;
    const step = count > this.CHART.many ? Math.ceil(count / this.CHART.labels) : 1;
    const grid = [0.5, 1]
      .map(
        share =>
          `<line x1="0" x2="${width}" y1="${height - height * share}" y2="${height - height * share}" class="grid"/><text x="0" y="${height - height * share - 3}" class="ax">${Math.round(max * share)}</text>`,
      )
      .join('');
    const bars = series.map((row, i) => this._bar({ row, i, max, barWidth, step })).join('');
    return `<svg class="st-chart" viewBox="0 0 ${width} ${height + axis}" role="img" aria-label="Количество КП по периодам">
    ${grid}
    <line x1="0" x2="${width}" y1="${height}" y2="${height}" class="base"/>
    ${bars}</svg>`;
  }

  static _bar({ row, i, max, barWidth, step }) {
    const { height, minBar, minWidth, round, labelY } = this.CHART;
    const barHeight = row.count ? Math.max(minBar, (height * row.count) / max) : 0;
    const left = i * barWidth + 1;
    const width = Math.max(minWidth, barWidth - 2);
    const path = barHeight
      ? `<path d="M${left},${height} V${height - barHeight + Math.min(round, barHeight)} q0,-4 4,-4 h${width - 8} q4,0 4,4 V${height} Z"/>`
      : '';
    const label =
      i % step === 0
        ? `<text x="${i * barWidth + barWidth / 2}" y="${height + labelY}" class="ax" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(row.label)}</text>`
        : '';
    return `<g class="bar"><title>${esc(row.label)}: ${row.count} КП</title><rect class="hit" x="${i * barWidth}" y="0" width="${barWidth}" height="${height}"/>
        ${path}
        ${label}</g>`;
  }

  static _tile(value, label) {
    return `<div class="st-tile"><b>${value}</b><span>${label}</span></div>`;
  }

  static _percent(value) {
    return value == null ? '—' : `${String(value).replace('.', ',')} %`;
  }

  static _tiles(stats) {
    const counts = stats.kp;
    const moderation = stats.moderation;
    const tile = (value, label) => this._tile(value, label);
    return `${tile(Fmt.num(counts.total), 'КП всего')}${tile(Fmt.num(counts.today), 'за сегодня')}${tile(Fmt.num(counts.week), 'за неделю')}${tile(Fmt.num(counts.month), 'за месяц')}
      ${tile(Fmt.num(Math.round((counts.sumMonth || 0) / this.KOPECKS)), 'сумма КП за месяц, руб.')}${tile(Fmt.num(stats.activeUsers), `активных за ${stats.activeDays || DefRegistry.num('srv.statActiveDays', this.ACTIVE_DAYS)} дн.`)}
      ${tile(Fmt.num(moderation.pending), 'правок на модерации')}${tile(this._percent(moderation.conversion), 'правок одобрено')}
      ${tile(Fmt.num(stats.deletions.month), 'удалений за месяц')}${tile(Fmt.size(stats.db.bytes), 'размер базы')}`;
  }

  static _chart(series) {
    const chart = AdminState.chart;
    const periods = this.PERIODS.map(
      ([value, label]) =>
        `<button type="button" class="${chart === value ? 'on' : ''}" data-chart="${value}">${label}</button>`,
    ).join('');
    return `<div class="st-card"><div class="row st-ch-h"><p class="sub" style="margin:0">КП по ${this.TITLES[chart] || this.TITLES.month}</p><span class="sp"></span>
      <div class="seg">${periods}</div></div>
      ${this.bars(series)}
      <details><summary class="muted">Таблицей</summary><table class="pv-t">${series.map(row => `<tr><td>${esc(row.label)}</td><td>${row.count}</td></tr>`).join('')}</table></details></div>`;
  }

  static _tops(stats) {
    const managers =
      stats.managers
        .map(
          row =>
            `<tr><td>${esc(row.name)}</td><td>${row.count} КП</td><td>${Fmt.num(Math.round(row.sum / this.KOPECKS))} руб.</td></tr>`,
        )
        .join('') || '<tr><td>Нет данных</td></tr>';
    const products =
      stats.products.map(row => `<tr><td>${esc(row.name)}</td><td>${row.count}</td></tr>`).join('') ||
      '<tr><td>Нет данных</td></tr>';
    return `<div class="st-cols"><div class="st-card"><p class="sub">Менеджеры — больше всего КП</p><table class="pv-t">${managers}</table></div>
      <div class="st-card"><p class="sub">Товары — чаще всего в КП</p><table class="pv-t">${products}</table></div></div>`;
  }

  static _base(stats) {
    const moderation = stats.moderation;
    const tables = Object.entries(stats.db.tables)
      .map(([table, rows]) => `<tr><td>${esc(table)}</td><td>${Fmt.num(rows)}</td></tr>`)
      .join('');
    return `<div class="st-cols"><div class="st-card"><p class="sub">Модерация правок</p><table class="pv-t"><tr><td>Режим</td><td>${moderation.enabled ? 'включена' : 'выключена'}</td></tr>
      <tr><td>На модерации</td><td>${moderation.pending}</td></tr><tr><td>Одобрено / отклонено</td><td>${moderation.approved} / ${moderation.rejected}</td></tr>
      <tr><td>Конверсия черновик → подтверждено</td><td>${this._percent(moderation.conversion)}</td></tr></table></div>
      <div class="st-card"><p class="sub">База данных · ${Fmt.size(stats.db.bytes)}</p><table class="pv-t">${tables}
      <tr><td>Удалений всего / в корзине</td><td>${stats.deletions.total} / ${stats.deletions.trash}</td></tr></table></div></div>`;
  }

  /**
   * Сводка в блок.
   * @param {HTMLElement} box
   */
  static async render(box) {
    const stats = await AdminApi.get('stats');
    this.drawWidth = Math.max(this.CHART.width, Math.min(this.CHART.maxWidth, box.clientWidth - this.CHART.pad));
    box.innerHTML = `${await AdminReadiness.html()}<div id="stAttn"></div>
    <div class="row st-quick"><button class="btn" type="button" data-q="report">Отчёт по КП…</button><button class="btn" type="button" data-q="journal">Журнал КП…</button><button class="btn" type="button" data-sttab="audit">Журнал действий</button><button class="btn" type="button" data-sttab="connections">Проверить подключения</button><button class="btn" type="button" data-sttab="changed">Изменённые настройки</button><button class="btn" type="button" data-sttab="updates">Обновления</button></div>
    <div class="st-tiles">${this._tiles(stats)}</div>
    <details class="st-more"${AdminState.chartOpen ? ' open' : ''}><summary class="sub">Статистика подробнее: КП по периодам, менеджеры, товары, база</summary>
    ${this._chart(stats.series[AdminState.chart])}
    ${this._tops(stats)}
    ${this._base(stats)}</details>`;
    AdminInbox.render(box.querySelector('#stAttn'));
    box.onclick = event => this._click(box, event);
  }

  static _click(box, event) {
    const chart = event.target.closest('[data-chart]');
    if (chart) {
      AdminState.chart = chart.dataset.chart;
      AdminState.chartOpen = true;
      this.render(box);
      return;
    }
    const quick = event.target.closest('[data-q]');
    if (!quick) return;
    SettingsWindow.dialog().close();
    if (quick.dataset.q === 'report') KpReport.open({});
    else Journal.open();
  }
}

/** Модерация правок: переключатель, очередь, рассмотренные (окно правки — ModerationView). */
export class ModerationTab {
  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    const reply = await AdminApi.get('moderation');
    const enabled = !!reply.settings.enabled;
    const pending = reply.pending;
    const done = reply.history.sort((first, second) => second.id - first.id);
    main.innerHTML = `${this._switch(reply, enabled)}
      <div class="st-card"><div class="row mv-qh"><p class="sub">На модерации · ${pending.length}</p><span class="sp"></span>${pending.length > 1 ? '<button class="btn" type="button" data-mod="all">Принять все</button>' : ''}</div>
        ${ModerationList.html(pending, enabled ? 'Правок, ожидающих решения, нет.' : 'Модерация выключена — очередь не пополняется.')}</div>
      ${done.length ? `<details class="st-card mx"><summary class="sub">Рассмотренные правки · ${done.length}</summary>${done.map(row => this._reviewed(row)).join('')}</details>` : ''}
      ${reply.archived.length ? `<details class="st-card mx"><summary class="sub">Архив модерации · ${reply.archived.length}</summary>${reply.archived.map(row => this._archived(row)).join('')}</details>` : ''}`;
    main.onclick = event => this._click(main, event, { enabled, pending });
  }

  static _switch(reply, enabled) {
    const text = enabled
      ? 'Включено: правки сотрудников сохраняются черновиком и ждут решения; у товара бейдж «На модерации».'
      : 'Выключено: правки сохраняются в каталог сразу и записываются в журнал действий (там же — откат правки).';
    return `<div class="st-card"><div class="row"><button class="sw" type="button" role="switch" aria-checked="${enabled}" data-mod="toggle"><i></i>Требовать подтверждение правок товаров</button></div>
        <p class="muted" style="margin:8px 0 0">${text}
        Принимать и отклонять правки могут и менеджеры с правом «Правки без модерации» («Люди и доступ → Менеджеры»), их собственные правки идут сразу в каталог.${reply.settings.updatedAt ? ` Изменено: ${esc(Fmt.dateTime(reply.settings.updatedAt))}.` : ''}</p></div>`;
  }

  static _reviewed(row) {
    const status =
      row.status === 'approved' ? '<span class="ok-t">Принято</span>' : '<span class="bad-t">Отклонено</span>';
    return `<div class="st-row"><div><b>${esc(row.name)}</b><span class="muted">${status}${row.reason ? ` — ${esc(row.reason)}` : ''} · ${esc(row.userName || '—')} · ${esc(row.reviewedBy || '')} ${esc(Fmt.dateTime(row.reviewedAt))}</span></div><div class="acts"><button class="btn ghost" type="button" data-pend="${row.id}">Посмотреть</button></div></div>`;
  }

  static _archived(row) {
    return `<div class="st-row"><div><b>${esc(row.name)}</b><span class="muted">${esc(row.userName || '—')} · ${esc(Fmt.dateTime(row.created))}</span></div><div class="acts"><button class="btn ghost" type="button" data-pend="${row.id}">Посмотреть</button></div></div>`;
  }

  static async _click(main, event, { enabled, pending }) {
    const view = event.target.closest('[data-pend]');
    if (view) {
      ModerationView.open(+view.dataset.pend, () => this.render(main));
      return;
    }
    const button = event.target.closest('[data-mod]');
    if (!button) return;
    if (button.dataset.mod === 'all') {
      await this._approveAll(main, pending);
      return;
    }
    const body = await this._toggleBody(enabled, pending);
    if (!body) return;
    try {
      await AdminApi.post('moderation', body);
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
      return;
    }
    Toast.show(body.enabled ? 'Модерация включена' : 'Модерация выключена');
    this.render(main);
  }

  static async _approveAll(main, pending) {
    if (
      !(await AdminDialog.confirm(
        `Принять все правки (${pending.length})?`,
        'Изменения сразу попадут в каталог.',
        'Принять все',
      ))
    )
      return;
    try {
      await AdminApi.post('pending/approve-all');
    } catch (error) {
      Toast.show(`Правки не приняты: ${error.message || error}`);
      return;
    }
    Toast.show('Правки приняты');
    Catalog.refresh();
    this.render(main);
  }

  // при выключении с накопленными правками — что с ними сделать
  static async _toggleBody(enabled, pending) {
    const body = { enabled: !enabled };
    if (enabled && pending.length) {
      const how = await AdminDialog.choose(
        `Выключить модерацию? На модерации ${pending.length} ${KPGen.plural(pending.length, 'правка', 'правки', 'правок')}.`,
        [
          ['apply', 'Принять все'],
          ['reject', 'Отклонить все'],
          ['archive', 'Оставить в архиве'],
        ],
      );
      if (!how) return null;
      body.pending = how;
      return body;
    }
    const ok = await AdminDialog.confirm(
      enabled ? 'Выключить модерацию?' : 'Включить модерацию?',
      enabled
        ? 'Правки товаров будут сохраняться сразу (и записываться в журнал).'
        : 'Новые правки товаров будут ждать вашего решения. Существующие товары не меняются.',
      enabled ? 'Выключить' : 'Включить',
    );
    return ok ? body : null;
  }
}

/** Журнал действий: фильтры, записи с «было / стало», страницы, откат правки товара. */
export class AuditTab {
  static PAGE = 50;
  static SEARCH_WAIT = 300;
  static ROLLBACK = ['edit_product', 'approve_edit'];
  static rows = [];

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    const state = AdminState.audit;
    const filter = state.f;
    const [reply, lists] = await Promise.all([
      AdminApi.get(`audit?${new URLSearchParams({ ...filter, page: state.page })}`),
      state.fl || AdminApi.get('audit/filters'),
    ]);
    state.fl = lists;
    this.rows = reply.items;
    const pages = Math.max(1, Math.ceil(reply.total / this.PAGE));
    main.innerHTML = `<div class="st-filters">${this._select('user', lists.users, 'Все пользователи')}${this._select('action', lists.actions, 'Все действия', AuditLabels.ACT)}${this._select('entity', lists.entities, 'Все объекты', AuditLabels.ENT)}
      <input type="date" data-af="from" value="${esc(filter.from || '')}" aria-label="С даты"><input type="date" data-af="to" value="${esc(filter.to || '')}" aria-label="По дату">
      <input type="search" data-af="q" value="${esc(filter.q || '')}" placeholder="Поиск: id, имя, значение" autocomplete="off"></div>
    <p class="muted">Записей: ${Fmt.num(reply.total)}</p>
    <div class="st-list">${reply.items.map(row => this._entry(row)).join('') || '<p class="muted">Записей нет.</p>'}</div>
    ${pages > 1 ? this._pager(state, pages) : ''}`;
    this._bind(main);
  }

  static _select(key, list, label, names) {
    const filter = AdminState.audit.f;
    const options = list
      .map(
        value =>
          `<option value="${esc(value)}"${filter[key] === value ? ' selected' : ''}>${esc((names && names[value]) || value)}</option>`,
      )
      .join('');
    return `<select data-af="${key}" aria-label="${label}"><option value="">${label}</option>${options}</select>`;
  }

  static _pager(state, pages) {
    return `<div class="row st-pg"><button class="btn" type="button" data-pg="-1" ${state.page ? '' : 'disabled'}>← Новее</button><span class="muted">стр. ${state.page + 1} из ${pages}</span><button class="btn" type="button" data-pg="1" ${state.page + 1 < pages ? '' : 'disabled'}>Старее →</button></div>`;
  }

  static _diff(row) {
    if (!row.before && !row.after) return '';
    const keys = [...new Set([...Object.keys(row.before || {}), ...Object.keys(row.after || {})])].filter(
      key => !key.startsWith('_'),
    );
    const cell = (side, key) => (side && key in side ? AuditLabels.value(side[key]) : '');
    const lines = keys
      .map(key => `<tr><td>${esc(key)}</td><td>${cell(row.before, key)}</td><td>${cell(row.after, key)}</td></tr>`)
      .join('');
    return `<table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${lines}</table>`;
  }

  static _openRefused(main, id) {
    const row = this.rows.find(item => item.id === id);
    if (!row) return;
    CatalogEditor.openNew(JSON.parse(JSON.stringify(row.after._card)), () => {
      Catalog.refresh();
      Toast.show('Позиция сохранена в каталог');
      this.render(main);
    });
  }

  static _summary(row, failed) {
    return `<summary><span class="t">${esc(Fmt.dateTime(row.timestamp))}</span><b>${esc(AuditLabels.ACT[row.action] || row.action)}</b>
        <span class="muted">${esc(AuditLabels.ENT[row.entityType] || row.entityType || '')} ${esc((row.after && row.after['Наименование']) || row.entityId || '')}</span><span class="u">${esc(row.userName || '')}${row.userRole === 'admin' ? ' · админ' : ''}</span>${failed ? '<span class="bad-t">отклонено</span>' : ''}</summary>`;
  }

  static _entry(row) {
    const failed = row.result === 'failed';
    return `<details class="st-log ${failed ? 'fail' : ''}">${this._summary(row, failed)}
        <div class="st-logb">${this._diff(row)}${this._refused(row)}
        <p class="muted">IP ${esc(row.ip || '—')} · ${esc(row.userAgent || '')}</p>
        ${this.ROLLBACK.includes(row.action) && row.before ? `<button class="btn" type="button" data-rb="${row.id}">Откатить эту правку</button>` : ''}</div></details>`;
  }

  // отклонённая карточка товара: открыть её и добавить в каталог самому
  static _refused(row) {
    const card = row.result === 'failed' && row.after && row.after._card;
    if (!card || typeof card !== 'object' || !card.id) return '';
    return `<button class="btn" type="button" data-refused="${row.id}">Открыть карточку и добавить в каталог…</button>`;
  }

  static _bind(main) {
    const state = AdminState.audit;
    const search = new Debounce(this.SEARCH_WAIT);
    main.onchange = event => {
      const field = event.target.closest('[data-af]');
      if (!field || field.type === 'search') return;
      state.f[field.dataset.af] = field.value;
      state.page = 0;
      this.render(main);
    };
    main.oninput = event => {
      const field = event.target.closest('[data-af]');
      if (!field || field.type !== 'search') return;
      state.f.q = field.value;
      state.page = 0;
      search.run(() => this.render(main));
    };
    main.onclick = event => this._click(main, event);
  }

  static async _click(main, event) {
    const state = AdminState.audit;
    const page = event.target.closest('[data-pg]');
    if (page) {
      state.page += +page.dataset.pg;
      this.render(main);
      return;
    }
    const refused = event.target.closest('[data-refused]');
    if (refused) {
      this._openRefused(main, +refused.dataset.refused);
      return;
    }
    const rollback = event.target.closest('[data-rb]');
    if (!rollback) return;
    if (
      !(await AdminDialog.confirm(
        'Откатить правку?',
        'Изменённые этой правкой поля товара вернутся к прежним значениям.',
        'Откатить',
      ))
    )
      return;
    try {
      await AdminApi.post(`audit/${rollback.dataset.rb}/rollback`);
      Toast.show('Правка откачена');
      Catalog.refresh();
      state.fl = null;
      this.render(main);
    } catch (error) {
      Toast.show(error.message);
    }
  }
}
