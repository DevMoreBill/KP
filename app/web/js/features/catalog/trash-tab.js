import { Catalog } from './catalog-store.js';
import { CatalogIndex } from './catalog-index.js';
import { CatalogWindow } from './catalog-window.js';
import { CatalogTool } from '../admin/records-tab.js';
import { EquipWizard } from '../wizard/equip-wizard.js';
import { SettingsWindow } from '../admin/settings-window.js';
import { Managers } from '../kp/managers.js';
import { Toast } from '../../core/toast.js';
import { Debounce } from '../../core/debounce.js';
import { Fmt, Str } from '../../core/str.js';
import { AdminApi, AdminDialog, AuditLabels } from '../admin/admin-core.js';
import { esc } from '../../core/util.js';

/** Корзина в «Настройках»: восстановить, удалить навсегда, очистить (всё или один вид). */
export class TrashTab {
  static TYPES = [
    ['', 'Всё'],
    ['catalog', 'Товары'],
    ['kp', 'КП'],
    ['client', 'Клиенты'],
    ['deal', 'Сделки'],
    ['supplier', 'Поставщики'],
    ['manager', 'Менеджеры'],
  ];
  static state = { type: '', q: '' };
  static LIMIT = 300;
  static DELAY = 250;

  static _types(state, counts, total) {
    const tabs = this.TYPES.map(([key, label]) => {
      const count = key ? counts[key] || 0 : total;
      return `<button type="button" role="tab" class="chip${state.type === key ? ' on' : ''}" data-trt="${key}" aria-selected="${state.type === key}">${label} <i>${count}</i></button>`;
    }).join('');
    return `<div class="tr-types" role="tablist">${tabs}</div>`;
  }

  static _row(entry) {
    return `<div class="st-row tr-row"><div><b>${esc(entry.title || entry.entityId)}</b><span class="muted">${esc(AuditLabels.ENT[entry.entityType] || entry.entityType)} · удалено ${esc(Fmt.dateTime(entry.deletedAt))}${entry.deletedBy ? ` · ${esc(entry.deletedBy)}` : ''}</span></div>
        <div class="acts"><button class="btn" type="button" data-rest="${entry.id}">Восстановить</button><button class="btn ghost danger-t" type="button" data-purge="${entry.id}" title="Удалить навсегда — восстановить будет нельзя">Удалить навсегда</button></div></div>`;
  }

  static _html(view, { state, only, list }) {
    const label = Object.fromEntries(this.TYPES);
    const shown =
      list.length > this.LIMIT
        ? `показано ${this.LIMIT} из ${Fmt.num(list.length)}`
        : `записей: ${Fmt.num(list.length)}`;
    return `${only ? '' : this._types(state, view.counts || {}, view.total)}
      <div class="row tr-bar"><input type="search" data-trq placeholder="Найти в корзине" value="${esc(state.q || '')}" autocomplete="off" aria-label="Найти в корзине"><span class="muted">${shown} · хранятся ${view.days} дн.</span><span class="sp"></span>
        <button class="btn danger" type="button" data-trclear ${view.items.length ? '' : 'disabled'}>${state.type ? `Очистить: ${esc(label[state.type])}` : 'Очистить корзину'}</button></div>
      <div class="tr-list">${
        list
          .slice(0, this.LIMIT)
          .map(entry => this._row(entry))
          .join('') || '<p class="muted">Корзина пуста.</p>'
      }</div>`;
  }

  /**
   * Нарисовать корзину.
   * @param {HTMLElement} box куда рисовать
   * @param {string} [only] только этот вид (корзина товаров во вкладке «Товары»)
   */
  static async render(box, only) {
    const state = only ? { type: only, q: this.state.q } : this.state;
    const view = await AdminApi.get(`trash${state.type ? `?type=${state.type}` : ''}`);
    view.total = Object.values(view.counts || {}).reduce((sum, count) => sum + count, 0);
    const query = Str.norm(state.q || '');
    const list = query
      ? view.items.filter(entry => Str.norm(`${entry.title || ''} ${entry.entityId}`).includes(query))
      : view.items;
    box.innerHTML = this._html(view, { state, only, list });
    const ctx = { box, only, state, view };
    const delay = new Debounce(this.DELAY);
    box.oninput = event => this._search(event, ctx, delay);
    box.onclick = event => this._click(event, ctx);
  }

  static _search(event, { box, only, state }, delay) {
    const field = event.target.closest('[data-trq]');
    if (!field) return;
    state.q = field.value;
    if (only) this.state.q = field.value;
    delay.run(() =>
      this.render(box, only).then(() => {
        const input = box.querySelector('[data-trq]');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }),
    );
  }

  static async _purge(button, view) {
    const entry = view.items.find(one => String(one.id) === button.dataset.purge);
    const ok = await AdminDialog.confirm(
      'Удалить навсегда?',
      `«${(entry && entry.title) || 'запись'}» удалится окончательно — восстановить будет нельзя.`,
      'Удалить навсегда',
    );
    if (!ok) return false;
    await AdminApi.post(`trash/${button.dataset.purge}/purge`);
    Toast.show('Удалено навсегда');
    return true;
  }

  static async _clear({ state, view }) {
    const label = Object.fromEntries(this.TYPES);
    const count = state.type ? (view.counts || {})[state.type] || 0 : view.total;
    const ok = await AdminDialog.danger(
      state.type ? `Очистить корзину: ${label[state.type]}?` : 'Очистить корзину?',
      `${Fmt.num(count)} ${KPGen.plural(count, 'запись удалится', 'записи удалятся', 'записей удалятся')} окончательно — восстановить будет нельзя.`,
      'Удалить навсегда',
    );
    if (!ok) return false;
    const answer = await AdminApi.post('trash/clear', { type: state.type });
    Toast.show(`Удалено навсегда: ${Fmt.num(answer.deleted)}`);
    return true;
  }

  static async _restore(button) {
    await AdminApi.post(`trash/${button.dataset.rest}/restore`);
    Toast.show('Восстановлено');
    Catalog.refresh();
    Managers.load();
    return true;
  }

  static async _act(event, ctx) {
    const restore = event.target.closest('[data-rest]');
    if (restore) return await this._restore(restore);
    const purge = event.target.closest('[data-purge]');
    if (purge) return await this._purge(purge, ctx.view);
    if (event.target.closest('[data-trclear]')) return await this._clear(ctx);
    return false;
  }

  static async _click(event, ctx) {
    const tab = event.target.closest('[data-trt]');
    if (tab) {
      ctx.state.type = tab.dataset.trt;
      await this.render(ctx.box, ctx.only);
      return;
    }
    try {
      if (!(await this._act(event, ctx))) return;
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    this.render(ctx.box, ctx.only);
  }
}

/** «Настройки → Каталог → Товары»: плитки, кнопки каталога, корзина товаров. */
export class GoodsTab {
  static _tile(value, label, tab) {
    const tag = tab ? `button type="button" data-sttab="${tab}"` : 'div';
    return `<${tag} class="st-tile"><b>${Fmt.num(value)}</b><span>${label}</span></${tab ? 'button' : 'div'}>`;
  }

  static async _counts() {
    let mod = { pending: [] };
    let trash = { counts: {} };
    try {
      [mod, trash] = await Promise.all([AdminApi.get('moderation'), AdminApi.get('trash?type=catalog')]);
    } catch {
      // без счётчиков
    }
    return { pend: (mod.pending || []).length, bin: (trash.counts || {}).catalog || 0 };
  }

  /**
   * Нарисовать вкладку.
   * @param {HTMLElement} box
   * @param {boolean} [auto] сразу открыть окно товаров
   */
  static async render(box, auto) {
    const { pend, bin } = await this._counts();
    const count = Catalog.cache.length;
    const cats = new Set(Catalog.cache.map(card => CatalogIndex.attrs(card).cat)).size;
    box.innerHTML = `<div class="st-tiles gd-tiles">${this._tile(count, KPGen.plural(count, 'позиция', 'позиции', 'позиций'))}${this._tile(cats, 'категорий', 'types')}${this._tile(pend, 'на модерации', 'moderation')}${this._tile(bin, 'в корзине')}</div>
      <div class="st-card"><div class="row st-btns"><button class="btn primary" type="button" data-gd="open">Открыть товары</button><button class="btn" type="button" data-gd="new">+ Новая позиция</button>
        <button class="btn" type="button" data-gd="xls">Импорт из Excel…</button><button class="btn" type="button" data-gd="imp">Загрузить файл каталога (.json)…</button><button class="btn" type="button" data-gd="exp">Файл каталога для загрузки (.json)</button></div>
        <p class="muted">«Открыть товары» — окно каталога: поиск, фильтры, сортировка, карточка с фото, «Редактировать». Отметьте позиции галочками — внизу появятся «В корзину», «Выгрузить…» (Excel, JSON, XML, YML — по любому фильтру) и «Перенести в категорию…».</p></div>
      <div class="st-card"><p class="sub">Корзина товаров</p><div id="gdBin"><p class="muted">Загружаю…</p></div></div>`;
    TrashTab.render(box.querySelector('#gdBin'), 'catalog').catch(() => {});
    box.onclick = event => this._click(event);
    if (auto) this.open();
  }

  static _click(event) {
    const button = event.target.closest('[data-gd]');
    if (!button) return undefined;
    const act = button.dataset.gd;
    if (act === 'open') return this.open();
    if (act === 'new') {
      SettingsWindow.dialog().close();
      return EquipWizard.open('catalog', '');
    }
    return CatalogTool.run(act);
  }

  /**
   * Окно каталога поверх «Настроек» — в режиме администратора.
   * @returns {Promise<void>}
   */
  static open() {
    return CatalogWindow.open({ admin: true });
  }
}
