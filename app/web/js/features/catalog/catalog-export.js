import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { DefRegistry } from '../../core/defaults.js';
import { AdminDialog } from '../admin/admin-core.js';
import { FileSave } from '../../core/files.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { Fmt } from '../../core/str.js';
import { AdminSession, Api } from '../../core/net.js';
import { Auth } from '../kp/auth.js';
import { esc } from '../../core/util.js';
import { EquipTypes } from '../../core/equip-types.js';

/** Выгрузка отобранного в окне каталога: Excel, JSON, XML, YML; цены, остатки, картинки, параметры — галочками. */
export class CatalogExportDlg {
  static KEY = 'kp.catExport';
  static FMT = [
    ['xlsx', 'Excel'],
    ['json', 'JSON'],
    ['xml', 'XML'],
    ['yml', 'YML (Яндекс)'],
  ];
  static COLS = [
    ['cat', 'Категория', 1],
    ['maker', 'Производитель', 1],
    ['model', 'Модель', 1],
    ['series', 'Серия', 0],
    ['art', 'Артикул', 1],
    ['sup', 'Поставщик', 1],
    ['spec', 'Краткие характеристики', 1],
    ['desc', 'Описание', 0],
    ['specs', 'Характеристики (таблица)', 0],
    ['url', 'Страница товара', 0],
  ];
  static IMG = [
    ['none', 'Без картинок'],
    ['links', 'Ссылками'],
    ['files', 'Файлами в архиве .zip'],
  ];
  static BASE = new Set(['cat', 'maker', 'model', 'series', 'article']);
  static JSON_TYPE = 'application/json; charset=utf-8';

  /**
   * Прошлый выбор.
   * @returns {object}
   */
  static saved() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  /**
   * Запомнить выбор.
   * @param {object} choice
   */
  static remember(choice) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(choice));
    } catch {
      // браузер не хранит
    }
  }

  /**
   * Параметры категорий отобранных позиций (марка, модель, серия, категория — отдельными столбцами).
   * @param {object[]} docs
   * @returns {{key: string, label: string, n: number}[]}
   */
  static params(docs) {
    const out = new Map();
    const cats = new Map();
    for (const card of docs) {
      const cat = CatalogIndex.attrs(card).cat;
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    for (const [cat, count] of cats) {
      for (const field of EquipTypes.byId(cat).fields) {
        if (this.BASE.has(field.key)) continue;
        const param = out.get(field.key) || {
          key: field.key,
          label: field.label + (field.unit ? `, ${field.unit}` : ''),
          n: 0,
        };
        param.n += count;
        out.set(field.key, param);
      }
    }
    return [...out.values()].sort(
      (first, second) => second.n - first.n || first.label.localeCompare(second.label, 'ru'),
    );
  }

  static _ck(key, label, { checked, extra = '' }) {
    return `<label class="cx-ck"><input type="checkbox" data-cx="${key}"${checked ? ' checked' : ''}${extra}> ${esc(label)}</label>`;
  }

  static _seg(list, attr, cur) {
    return list
      .map(
        ([key, label]) =>
          `<button type="button" role="radio" data-${attr}="${key}" class="${cur === key ? 'on' : ''}" aria-checked="${cur === key}">${label}</button>`,
      )
      .join('');
  }

  static _params(params, saved, all) {
    const picked = saved.params || [];
    const count = all
      ? 'все'
      : `${picked.filter(key => params.some(param => param.key === key)).length} из ${params.length}`;
    const list = params.length
      ? `<label class="cx-ck cx-all"><input type="checkbox" data-cxall${all ? ' checked' : ''}> Все параметры</label><div class="cx-plist">${params.map(param => this._ck(`p:${param.key}`, param.label, { checked: all || picked.includes(param.key), extra: ` title="${esc(param.label)}: у ${param.n} поз."` })).join('')}</div>`
      : '<p class="muted">У отобранных позиций нет параметров категорий.</p>';
    return `<details class="cx-p"${params.length && !all ? ' open' : ''}><summary>Параметры категорий: <b class="cx-pn">${count}</b></summary>
        ${list}</details>`;
  }

  static _prices(saved, admin) {
    return (
      this._ck('price', 'Цена КП', { checked: saved.price !== false }) +
      this._ck('rrc', 'РРЦ', { checked: !!saved.rrc }) +
      (admin ? this._ck('cost', 'Закупка', { checked: false }) : '') +
      this._ck('stock', 'Остатки', { checked: !!saved.stock })
    );
  }

  /**
   * Окно выгрузки.
   * @param {number} count
   * @param {object[]} params
   * @param {object} saved
   * @returns {string}
   */
  static html(count, params, saved) {
    const admin = Auth.state.admin || AdminSession.on;
    const cols = saved.cols || this.COLS.filter(col => col[2]).map(col => col[0]);
    const all = !saved.params || saved.params.includes('*');
    return `<h3>Выгрузить ${Fmt.num(count)} ${KPGen.plural(count, 'позицию', 'позиции', 'позиций')}</h3>
      <p class="muted cx-note">Выгружается то, что сейчас отобрано в каталоге: поиск, фильтры и отметки галочками.</p>
      <div class="cx-g"><span class="cx-l">Формат</span><div class="seg" role="radiogroup">${this._seg(this.FMT, 'fmt', saved.fmt || 'xlsx')}</div></div>
      <div class="cx-g"><span class="cx-l">Цены и наличие</span><div class="cx-row">${this._prices(saved, admin)}</div></div>
      <div class="cx-g"><span class="cx-l">Картинки</span><div class="seg" role="radiogroup">${this._seg(this.IMG, 'img', saved.images || 'none')}</div></div>
      <div class="cx-g"><span class="cx-l">Столбцы</span><div class="cx-row">${this.COLS.map(([key, label]) => this._ck(`c:${key}`, label, { checked: cols.includes(key) })).join('')}</div></div>
      ${this._params(params, saved, all)}
      ${admin ? '<p class="muted cx-note">Закупка — только по галочке и только администратору; по умолчанию не выгружается.</p>' : ''}
      <div class="row"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-go>Выгрузить</button></div>`;
  }

  static _count(modal, params) {
    const all = modal.$('[data-cxall]');
    const picked = [...modal.d.querySelectorAll('[data-cx^="p:"]')].filter(input => input.checked).length;
    if (all) {
      all.checked = picked === params.length;
      all.indeterminate = picked > 0 && picked < params.length;
    }
    const badge = modal.$('.cx-pn');
    if (badge) badge.textContent = picked === params.length ? 'все' : `${picked} из ${params.length}`;
  }

  static _pick(modal, state, button) {
    const key = button.dataset.fmt ? 'fmt' : 'images';
    const attr = button.dataset.fmt ? 'fmt' : 'img';
    const value = button.dataset[attr];
    state[key] = value;
    modal.d.querySelectorAll(`[data-${attr}]`).forEach(one => {
      const picked = one.dataset[attr] === value;
      one.classList.toggle('on', picked);
      one.setAttribute('aria-checked', picked);
    });
  }

  static _body(modal, { ids, state, params }) {
    const val = key => !!modal.$(`[data-cx="${key}"]`)?.checked;
    const picked = [...modal.d.querySelectorAll('[data-cx^="p:"]')]
      .filter(input => input.checked)
      .map(input => input.dataset.cx.slice(2));
    return {
      ids,
      fmt: state.fmt,
      images: state.images,
      price: val('price'),
      rrc: val('rrc'),
      cost: val('cost'),
      stock: val('stock'),
      cols: this.COLS.map(col => col[0]).filter(key => val(`c:${key}`)),
      params: params.length && picked.length === params.length ? ['*'] : picked,
    };
  }

  static async _go(modal, button, ctx) {
    const body = this._body(modal, ctx);
    this.remember({ ...body, ids: undefined, cost: false, params: body.params });
    button.disabled = true;
    button.textContent = 'Готовлю файл…';
    try {
      await this.download('/api/catalog/export', body);
      modal.close();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Выгрузить';
      Toast.show(`Не выгружено: ${error.message || error}`);
    }
  }

  static _click(modal, event, ctx) {
    const choice = event.target.closest('[data-fmt]') || event.target.closest('[data-img]');
    if (choice) {
      this._pick(modal, ctx.state, choice);
      return;
    }
    if (event.target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = event.target.closest('[data-go]');
    if (button) this._go(modal, button, ctx);
  }

  /**
   * Открыть окно выгрузки.
   * @param {string[]} ids позиции для выгрузки
   * @param {object[]} docs их карточки (для списка параметров)
   */
  static open(ids, docs) {
    if (!Auth.can('export')) {
      Auth.cannot('export');
      return;
    }
    if (!ids.length) {
      Toast.show('Нет позиций для выгрузки — ослабьте фильтры');
      return;
    }
    const params = this.params(docs);
    const saved = this.saved();
    const modal = new Modal(this.html(ids.length, params, saved), 'cx');
    const ctx = { ids, params, state: { fmt: saved.fmt || 'xlsx', images: saved.images || 'none' } };
    modal.d.addEventListener('click', event => this._click(modal, event, ctx));
    modal.d.addEventListener('change', event => {
      const all = event.target.closest('[data-cxall]');
      if (all) {
        modal.d.querySelectorAll('[data-cx^="p:"]').forEach(input => {
          input.checked = all.checked;
        });
      }
      this._count(modal, params);
    });
  }

  /**
   * POST и скачать ответ файлом (имя — из заголовка сервера).
   * @param {string} path
   * @param {object} body
   */
  static async download(path, body) {
    const answer = await Api.request(path, {
      method: 'POST',
      headers: { 'Content-Type': this.JSON_TYPE },
      body: JSON.stringify(body),
      raw: true,
    });
    const disposition = answer.headers.get('content-disposition') || '';
    const found = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const name = found ? decodeURIComponent(found[1]) : 'выгрузка';
    FileSave.download(name, await answer.blob());
    Toast.show(`Файл готов: ${name}`);
  }
}

/** «В корзину» (администратор или право «Удалять товары»). */
export class CatalogBin {
  /**
   * Удалить позиции в корзину (с вопросом).
   * @param {string[]} ids
   * @param {string[]} names
   * @returns {Promise<boolean>} удалены
   */
  static async put(ids, names) {
    if (!Auth.can('catDelete')) return Auth.cannot('catDelete');
    const count = ids.length;
    if (!count) return false;
    const what =
      count === 1 ? `«${names[0] || 'позиция'}»` : `${count} ${KPGen.plural(count, 'позицию', 'позиции', 'позиций')}`;
    const ok = await AdminDialog.confirm(
      `Удалить ${what} в корзину?`,
      `Позиции исчезнут из каталога. В корзине они хранятся ${DefRegistry.num('srv.trashDays', 30)} дн. — восстановить может администратор («Настройки → Обслуживание → Корзина»). КП, в которых они есть, не меняются.`,
      'Удалить в корзину',
    );
    if (!ok) return false;
    try {
      const answer = await Api.request('/api/catalog/trash', {
        method: 'POST',
        headers: { 'Content-Type': CatalogExportDlg.JSON_TYPE },
        body: JSON.stringify({ ids }),
      });
      await Catalog.refresh();
      Toast.show(`В корзине: ${answer.deleted} ${KPGen.plural(answer.deleted, 'позиция', 'позиции', 'позиций')}`);
      return true;
    } catch (error) {
      Toast.show(`Не удалено: ${error.message || error}`);
      return false;
    }
  }
}

/**
 * «⋯ → Выгрузить клиентов…» — администратор или менеджер с правом «Выгрузка»: реквизиты, адрес, контакт и объекты всех
 * клиентов в Excel или JSON.
 */
export class ClientsExportDlg {
  /** Пункт меню — только с правом «Выгрузка». */
  static sync() {
    const button = document.querySelector('[data-a="clientsExport"]');
    if (button) button.hidden = !Auth.can('export');
  }

  /** Окно выбора формата и выгрузка. */
  static async open() {
    if (!Auth.can('export')) {
      Auth.cannot('export');
      return;
    }
    const fmt =
      await Modal.ask(`<h3>Выгрузить клиентов</h3><p class="muted">Все клиенты: наименование, ИНН, КПП, ОГРН, адрес, контакт, объекты, число КП.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn" type="button" data-v="json">JSON</button><button class="btn primary" type="button" data-v="xlsx">Excel</button></div>`);
    if (!fmt) return;
    try {
      await CatalogExportDlg.download('/api/clients/export', { fmt });
    } catch (error) {
      Toast.show(`Не выгружено: ${error.message || error}`);
    }
  }

  /** Меню «⋯» открыто — показать или скрыть пункт. */
  static listen() {
    document.addEventListener(
      'toggle',
      event => {
        if (event.target.matches && event.target.matches('.topmenu')) this.sync();
      },
      true,
    );
  }
}
