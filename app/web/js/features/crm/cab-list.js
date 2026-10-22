import { CrmData } from './crm-data.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { esc } from '../../core/util.js';

/**
 * «Сделки» списком — таблица как в Битрикс24: колонки на выбор (помнятся в браузере), сортировка щелчком по заголовку,
 * строка итогов. На телефоне — карточками (вёрстка).
 */
export class CabList {
  static COLS_KEY = 'kp.cab.cols';
  static COLS = {
    name: { label: 'Сделка', css: 'lr-n', width: 'minmax(0,2.2fr)', sort: deal => CabList.name(deal).toLowerCase() },
    client: {
      label: 'Клиент',
      css: 'lr-c',
      width: 'minmax(0,1.4fr)',
      sort: deal => String(deal.client || '').toLowerCase(),
    },
    stage: { label: 'Стадия', css: 'lr-s', width: 'minmax(0,1.2fr)', sort: deal => CrmFunnel.label(deal) },
    sum: { label: 'Сумма', css: 'lr-sum', width: '120px', sort: deal => deal.sum || 0 },
    expected: { label: 'Ожидается', css: 'lr-e', width: '120px', sort: deal => deal.expected || '9' },
    next: {
      label: 'Следующий шаг',
      css: 'lr-x',
      width: 'minmax(0,1.8fr)',
      sort: deal => (deal.next ? deal.next.due : '9'),
    },
    manager: { label: 'Ответственный', css: 'lr-m', width: 'minmax(0,1fr)', sort: deal => CrmData.mgrShort(deal) },
    created: { label: 'Создана', css: 'lr-d', width: '100px', sort: deal => deal.created || '' },
    kps: { label: 'КП', css: 'lr-k', width: '64px', sort: deal => (deal.kps || []).length },
  };
  static DEFAULT = ['name', 'client', 'stage', 'sum', 'expected', 'next', 'manager'];
  static cols = null;
  static sortBy = '';
  static desc = false;
  static menu = false;

  /**
   * Название сделки для списка.
   * @param {object} deal
   * @returns {string}
   */
  static name(deal) {
    return deal.title || deal.client || `Сделка № ${deal.number}`;
  }

  /**
   * Видимые колонки (ответственный — только когда открыт отдел или коллега).
   * @returns {string[]}
   */
  static shown() {
    if (this.cols === null) this.cols = this._load();
    return this.cols.filter(key => this.COLS[key] && (key !== 'manager' || CrmData.all()));
  }

  /**
   * Таблица.
   * @param {object[]} rows сделки (уже отобранные)
   * @param {{more: string, row: Function}} parts more — кнопка «Показать ещё», row — ячейки «Ожидается» и «Следующий шаг»
   * @returns {string}
   */
  static html(rows, parts) {
    const keys = this.shown();
    const grid = `grid-template-columns:${keys.map(key => this.COLS[key].width).join(' ')}`;
    const body = this.sorted(rows)
      .map(deal => this._row(deal, keys, grid, parts.row))
      .join('');
    const total = rows.reduce((sum, deal) => sum + (deal.sum || 0), 0);
    const foot = rows.length
      ? `<div class="cab-lt" style="${grid}"><span>Всего: <b>${rows.length}</b></span>${keys.includes('sum') ? `<b class="lr-sum" style="grid-column:${keys.indexOf('sum') + 1}">${CrmFmt.short(total)}</b>` : ''}</div>`
      : '';
    return `<div class="cab-ls" role="table">${this._head(keys, grid)}${body}${parts.more}${foot}</div>`;
  }

  /**
   * Сделки в порядке выбранной колонки (без выбора — как есть).
   * @param {object[]} rows
   * @returns {object[]}
   */
  static sorted(rows) {
    const col = this.COLS[this.sortBy];
    if (!col) return rows;
    const sign = this.desc ? -1 : 1;
    return rows.slice().sort((one, two) => {
      const left = col.sort(one);
      const right = col.sort(two);
      return this._compare(left, right) * sign;
    });
  }

  static _compare(left, right) {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }

  static _head(keys, grid) {
    const cells = keys
      .map(key => {
        const arrow = this.sortBy === key ? this._arrow() : '';
        return `<button type="button" class="lh-s" data-lsort="${key}" role="columnheader">${esc(this.COLS[key].label)}${arrow}</button>`;
      })
      .join('');
    return `<div class="cab-lh" style="${grid}" role="row">${cells}<button type="button" class="lh-cfg" data-lcols title="Колонки" aria-label="Выбрать колонки">⚙</button>${this.menu ? this._menu() : ''}</div>`;
  }

  static _arrow() {
    return this.desc ? ' ↓' : ' ↑';
  }

  static _menu() {
    const boxes = Object.entries(this.COLS)
      .map(
        ([key, col]) =>
          `<label class="ck"><input type="checkbox" data-lcol="${key}"${this.shown().includes(key) ? ' checked' : ''}${key === 'name' ? ' disabled' : ''}> ${esc(col.label)}</label>`,
      )
      .join('');
    return `<div class="lh-menu" role="group" aria-label="Колонки списка">${boxes}</div>`;
  }

  static _row(deal, keys, grid, row) {
    const cells = {
      name: () => `<b>${esc(this.name(deal))}</b><span class="muted">№ ${esc(deal.number)}</span>`,
      client: () => esc(deal.client || '—'),
      stage: () =>
        `<span class="cab-dot t-${CrmData.toneOf(deal)}" aria-hidden="true"></span>${esc(CrmFunnel.label(deal))}`,
      sum: () => CrmFmt.short(deal.sum),
      expected: () => row.expected(deal) || '<span class="muted">—</span>',
      next: () => row.next(deal),
      manager: () => esc(CrmData.mgrShort(deal)) || '<span class="muted">— не назначен —</span>',
      created: () => esc(CrmFmt.day(String(deal.created || '').slice(0, 10))),
      kps: () => String((deal.kps || []).length || '—'),
    };
    const html = keys.map(key => `<span class="${this.COLS[key].css}" role="cell">${cells[key]()}</span>`).join('');
    return `<div class="cab-lr t-${CrmData.toneOf(deal)}" style="${grid}" role="row" data-deal="${esc(deal.id)}" tabindex="0">${html}</div>`;
  }

  /**
   * Щелчки таблицы: сортировка, выбор колонок. true — обработано (нужно перерисовать).
   * @param {Event} event
   * @returns {boolean}
   */
  static click(event) {
    const sort = event.target.closest('[data-lsort]');
    if (sort) {
      const key = sort.dataset.lsort;
      this.desc = this.sortBy === key ? !this.desc : false;
      this.sortBy = key;
      return true;
    }
    if (event.target.closest('[data-lcols]')) {
      this.menu = !this.menu;
      return true;
    }
    const box = event.target.closest('[data-lcol]');
    if (!box) return false;
    const key = box.dataset.lcol;
    const keep = this.shown().filter(one => one !== key);
    this.cols = box.checked ? Object.keys(this.COLS).filter(one => keep.includes(one) || one === key) : keep;
    this._save();
    return true;
  }

  static _load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.COLS_KEY) || 'null');
      return Array.isArray(saved) && saved.includes('name') ? saved : [...this.DEFAULT];
    } catch {
      return [...this.DEFAULT];
    }
  }

  static _save() {
    try {
      localStorage.setItem(this.COLS_KEY, JSON.stringify(this.cols));
    } catch {
      // без хранилища браузера — выбор колонок до перезагрузки страницы
    }
  }
}
