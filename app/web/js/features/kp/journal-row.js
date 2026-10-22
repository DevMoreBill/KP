import { ClientCard } from './client-card.js';
import { Currency } from './currency.js';
import { KpTrack } from './kp-track.js';
import { Srv } from '../../core/net.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { FEAT } from '../../core/features.js';

/** «Иванов И. П.» из полного ФИО. */
export class ShortName {
  /**
   * Фамилия и инициалы.
   * @param {string} name
   * @returns {string}
   */
  static of(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/);
    if (parts.length <= 1) return parts[0] || '';
    return `${parts[0]} ${parts
      .slice(1)
      .map(part => `${part[0]}.`)
      .join(' ')}`;
  }
}

/** Экономика КП в журнале: сумма в рублях (для итогов), прибыль и маржа — по позициям с закупкой. */
export class JournalEcon {
  static KOPECKS = 100;

  static _pct(value) {
    return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1).replace('.', ',')} %`;
  }

  /**
   * Сумма, строка экономики, сумма и прибыль в рублях.
   * @param {object} row строка журнала
   * @returns {{sum: string, line: string, sumRub: number|null, profitRub: number|null}}
   */
  static of(row) {
    const econ = row.econ || null;
    const cur = (econ && econ.cur) || 'RUB';
    if (row.locked && FEAT.on('deal')) return this._locked(row, cur);
    const { sum, sumRub } = this._sums(row, econ, cur);
    if (!FEAT.on('deal')) return { sum, line: '', sumRub, profitRub: null }; // экономика выключена
    if (row.deal) return { sum, sumRub, ...this._deal(row.deal) };
    return { sum, sumRub, ...this._items(econ, cur) };
  }

  static _sums(row, econ, cur) {
    const own = (econ ? econ.sum : row.sum) || 0;
    return {
      sum: `${KPGen.money(own)} ${Currency.short(cur)}`,
      sumRub: cur === 'RUB' ? own : (econ && econ.sumRub) || null,
    };
  }

  static _locked(row, cur) {
    return {
      sum: `${KPGen.money(row.sum || 0)} ${Currency.short(cur)}`,
      line: '<span class="muted">экономика — у автора КП</span>',
      sumRub: cur === 'RUB' ? row.sum || 0 : null,
      profitRub: null,
    };
  }

  // заполнен расчёт «Экономика сделки» — с логистикой, растаможкой и финансированием
  static _deal(deal) {
    if (!deal.confirmed) {
      return {
        line: `прибыль от ${KPGen.money(deal.lo * this.KOPECKS)} до ${KPGen.money(deal.hi * this.KOPECKS)} руб. <span class="muted">— нужен ввозной НДС</span>`,
        profitRub: null,
      };
    }
    const profit = Math.round(deal.profit * this.KOPECKS);
    return {
      line: `<span class="${deal.profit < 0 ? 'bad-t' : 'ok-t'}">прибыль ${KPGen.money(profit)} руб.</span> · маржа ${this._pct(deal.margin)} <span class="muted">по расчёту сделки</span>`,
      profitRub: profit,
    };
  }

  static _items(econ, cur) {
    if (!econ) return { line: '<span class="muted">считаю…</span>', profitRub: null };
    if (!econ.withCost) return { line: '<span class="muted">закупка не указана</span>', profitRub: null };
    const part =
      econ.withCost < econ.positions ? ` <span class="muted">(${econ.withCost} из ${econ.positions} поз.)</span>` : '';
    return {
      line: `<span class="${econ.profit < 0 ? 'bad-t' : 'ok-t'}">прибыль ${KPGen.money(econ.profit)} ${Currency.short(cur)}</span> · маржа ${this._pct(econ.margin)}${part}${econ.discount ? ` · скидка ${KPGen.money(econ.discount)}` : ''}`,
      profitRub: this._profitRub(econ, cur),
    };
  }

  static _profitRub(econ, cur) {
    if (cur === 'RUB') return econ.profit;
    return econ.sumRub && econ.sum ? Math.round((econ.profit * econ.sumRub) / econ.sum) : null;
  }
}

/**
 * Строка журнала КП: частые действия — «Открыть» и «Копия», остальные (файл, письмо, экономика, версии) — в меню «⋯»,
 * чтобы в длинном списке не рябило от кнопок.
 */
export class JournalRow {
  static MENU_GAP = 8;

  /**
   * Тендер: номер закупки и ссылка на неё (только http(s)).
   * @param {object} row
   * @returns {string}
   */
  static tender(row) {
    const tender = row.tender;
    if (!tender || !tender.number) return '';
    const url = /^https?:\/\//i.test(tender.url || '') ? tender.url : '';
    return `<span class="jr-t" title="КП для тендера${url ? `: ${esc(url)}` : ''}">Тендер № ${esc(tender.number)}${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть закупку на площадке">↗</a>` : ''}</span>`;
  }

  /**
   * Строка журнала.
   * @param {object} row
   * @param {object} econ JournalEcon.of
   * @returns {string}
   */
  static html(row, econ) {
    return `<div class="jr${row.tender && row.tender.number ? ' tnd' : ''}">${this._number(row)}
      ${this._client(row)}
      <div class="jr-e"><div class="jr-sum"><b>${econ.sum}</b><span class="jr-st">${KpTrack.chip(row)}</span></div><span>${econ.line}</span></div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(row.id)}" title="Открыть КП для просмотра и правки">Открыть</button><button class="btn" type="button" data-jc="${esc(row.id)}" title="Новое КП на основе этого: позиции, цены и условия — те же, получатель — новый">Копия</button>${this.menu(row)}</div></div>`;
  }

  static _number(row) {
    const files =
      row.files && FEAT.on('kpFiles')
        ? `<button type="button" class="jr-f" data-jkf="${esc(row.id)}" data-jn="${esc(row.number)}" title="Справочные документы: ${esc(String(row.files))}" aria-label="Справочные документы КП № ${esc(row.number)}: ${esc(String(row.files))}">📎 ${esc(String(row.files))}</button>`
        : '';
    const saved = row.savedAt
      ? `<span class="muted" title="Последнее сохранение">сохр. ${esc(Fmt.dateTime(row.savedAt))}</span>`
      : '';
    return `<div class="jr-n"><span class="n">№ ${esc(row.number)}</span><span class="muted">от ${esc(KPGen.ruDate(row.date))}</span>${this.tender(row)}${files}${saved}</div>`;
  }

  static _client(row) {
    const first =
      row.items && row.items[0] ? esc(row.items[0]) + (row.positions > 1 ? ` и ещё ${row.positions - 1}` : '') : '';
    const author = row.manager
      ? `<span class="jr-a" title="${esc([row.manager, row.managerPost].filter(Boolean).join(', '))}">Автор: ${esc(ShortName.of(row.manager))}</span>`
      : '';
    const link = ClientCard.link({ inn: String(row.clientInn || '').replace(/\D/g, ''), name: row.client }, row.client);
    return `<div class="jr-m"><b>${link}</b><span class="muted">${first}</span>${author}</div>`;
  }

  static _item(attrs, text, title) {
    return `<button type="button" ${attrs}${title ? ` title="${title}"` : ''}>${text}</button>`;
  }

  /**
   * Меню «⋯» строки.
   * @param {object} row
   * @returns {string}
   */
  static menu(row) {
    const id = esc(row.id);
    const item = (attrs, text, title) => this._item(attrs, text, title);
    const items = [
      item(
        `data-jr="${id}"`,
        'Повторить КП',
        'Новое КП тому же клиенту: позиции те же, дата — сегодня, цены — как сейчас в каталоге',
      ),
      Srv.info && Srv.info.local === false
        ? item(`data-a="openDoc" data-id="${id}"`, 'Скачать файл КП (Word)')
        : item(`data-a="openDoc" data-id="${id}"`, 'Открыть файл КП в Word'),
      row.file && FEAT.on('mail') ? item(`data-jm="${id}"`, 'Отправить клиенту…', 'Письмо клиенту с файлом КП') : '',
      FEAT.on('kpFiles')
        ? item(
            `data-jkf="${id}" data-jn="${esc(row.number)}"`,
            'Справочные документы…',
            'Паспорта, сертификаты, схемы к КП — в документ КП не входят',
          )
        : '',
      row.locked || !FEAT.on('deal') ? '' : item(`data-je="${id}"`, 'Экономика сделки'),
      FEAT.on('versions') ? item(`data-jv="${id}" data-jn="${esc(row.number)}"`, 'Прежние версии КП') : '',
    ];
    return `<details class="jr-more" data-id="${id}"><summary class="btn" title="Другие действия с КП" aria-label="Другие действия с КП № ${esc(row.number)}">⋯</summary><div class="menu-l">${items.join('')}</div></details>`;
  }

  /**
   * Меню у нижнего края списка открывается вверх, у левого края — вправо (на телефоне оно — панель снизу экрана).
   * @param {HTMLDetailsElement} details
   */
  static place(details) {
    const menu = details.querySelector('.menu-l');
    const box = details.closest('.dlg-b');
    details.classList.remove('up', 'lft');
    if (!details.open || !menu || !box || getComputedStyle(menu).position === 'fixed') return;
    const rect = menu.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (rect.left < frame.left) details.classList.add('lft');
    if (rect.bottom > frame.bottom && rect.height + this.MENU_GAP < rect.top - frame.top) details.classList.add('up');
  }
}
