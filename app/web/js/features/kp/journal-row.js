import { ClientCard } from './client-card.js';
import { KpDate } from './kp-date.js';
import { Currency } from './currency.js';
import { KpTrack } from './kp-track.js';
import { Srv } from '../../core/net.js';
import { Fmt } from '../../core/str.js';
import { esc, today } from '../../core/util.js';
import { FEAT } from '../../core/features.js';

/** «Иванов И. П.» из полного ФИО. */
export class ShortName {
  // так сервер подписывает действие без выбранного менеджера — это не имя человека
  static NOBODY = 'Не выбран';

  /**
   * Фамилия и инициалы («Не выбран» — пусто).
   * @param {string} name
   * @returns {string}
   */
  static of(name) {
    if (String(name || '').trim() === this.NOBODY) return '';
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
 * Строка журнала КП — одной строкой таблицы: № и дата, клиент и позиция, менеджер, сделка и следующий шаг, срок действия,
 * сумма с маржой, статус; «Открыть» — кнопкой, остальное (копия, файл, письмо, экономика, версии) — в меню «⋯».
 */
export class JournalRow {
  static MENU_GAP = 8;
  static DAY_MS = 86400000;
  static SOON_DAYS = 7;

  /**
   * Тендер: номер закупки и ссылка на неё (только http(s)).
   * @param {object} row
   * @returns {string}
   */
  static tender(row) {
    const tender = row.tender;
    if (!tender || !tender.number) return '';
    const url = /^https?:\/\//i.test(tender.url || '') ? tender.url : '';
    return `<span class="jr-t" title="КП для тендера № ${esc(tender.number)}${url ? `: ${esc(url)}` : ''}"><span class="jr-tn">Тендер № ${esc(tender.number)}</span>${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть закупку на площадке">↗</a>` : ''}</span>`;
  }

  /**
   * Заголовок таблицы журнала.
   * @returns {string}
   */
  static head() {
    return '<div class="jr jr-h" aria-hidden="true"><span>КП</span><span>Клиент и позиция</span><span>Менеджер</span><span>Сделка · следующий шаг</span><span>Действует</span><span class="r">Сумма</span><span>Статус</span><span></span></div>';
  }

  /**
   * Строка журнала.
   * @param {object} row
   * @param {object} econ JournalEcon.of
   * @returns {string}
   */
  static html(row, econ) {
    const author = row.manager
      ? `<span class="jr-a" title="${esc([row.manager, row.managerPost].filter(Boolean).join(', '))}">${esc(ShortName.of(row.manager))}</span>`
      : '<span class="muted">—</span>';
    return `<div class="jr${row.tender && row.tender.number ? ' tnd' : ''}">${this._number(row)}${this._client(row)}
      <div class="jr-w">${author}</div>${this._deal(row)}${this._until(row)}
      <div class="jr-e"><b>${econ.sum}</b><span class="muted">${econ.line}</span></div>
      <div class="jr-st">${KpTrack.chip(row)}</div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(row.id)}" title="Открыть КП для просмотра и правки">Открыть</button>${this.menu(row)}</div></div>`;
  }

  static _number(row) {
    const files =
      row.files && FEAT.on('kpFiles')
        ? `<button type="button" class="jr-f" data-jkf="${esc(row.id)}" data-jn="${esc(row.number)}" title="Справочные документы: ${esc(String(row.files))}" aria-label="Справочные документы КП № ${esc(row.number)}: ${esc(String(row.files))}">📎 ${esc(String(row.files))}</button>`
        : '';
    const saved = row.savedAt ? ` · сохранено ${Fmt.dateTime(row.savedAt)}` : '';
    return `<div class="jr-n"><span class="n" title="КП № ${esc(row.number)} от ${esc(KPGen.ruDate(row.date))}${esc(saved)}">№ ${esc(row.number)}</span><span class="muted">${esc(KpDate.ddmm(row.date))}</span>${this.tender(row)}${files}</div>`;
  }

  static _client(row) {
    const first =
      row.items && row.items[0] ? esc(row.items[0]) + (row.positions > 1 ? ` и ещё ${row.positions - 1}` : '') : '';
    const link = ClientCard.link({ inn: String(row.clientInn || '').replace(/\D/g, ''), name: row.client }, row.client);
    return `<div class="jr-m"><b>${link}</b><span class="muted" title="${first}">${first}</span></div>`;
  }

  // сделка КП: стадия и ближайшее дело — нажатие открывает карточку сделки
  static _deal(row) {
    const link = row.crm;
    if (!link || !FEAT.on('myDay')) return '<div class="jr-d none"><span class="muted">—</span></div>';
    const tone = { won: ' ok', lost: ' bad' }[link.closed] || '';
    const task = link.task
      ? `<span class="muted${link.task.due < today() ? ' late' : ''}" title="${esc(link.task.title)}">${esc(KpDate.ddmm(link.task.due).slice(0, 5))} · ${esc(link.task.title)}</span>`
      : `<span class="muted">${link.closed ? '' : 'дел нет'}</span>`;
    return `<div class="jr-d"><button type="button" class="lnk jr-dl${tone}" data-jd="${esc(link.id)}" title="Открыть сделку № ${esc(link.number)}">${esc(link.stage)}</button>${task}</div>`;
  }

  // срок действия КП: скоро кончится — жёлтым, кончился — красным (у выигранных и проигранных — без отметки)
  static _until(row) {
    const until = String(row.validUntil || '').slice(0, 10);
    if (!until) return '<div class="jr-u none"><span class="muted">—</span></div>';
    const days = Math.round((new Date(until) - new Date(today())) / this.DAY_MS);
    const done = ['won', 'lost'].includes((row.track || {}).status);
    const mark = done ? { tone: '', left: '' } : this._left(days);
    return `<div class="jr-u${mark.tone}"><span>до ${esc(KpDate.ddmm(until).slice(0, 5))}</span><span class="muted">${mark.left}</span></div>`;
  }

  static _left(days) {
    if (days < 0) return { tone: ' bad', left: 'истекло' };
    return { tone: days <= this.SOON_DAYS ? ' warn' : '', left: `${days} дн.` };
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
      item(`data-jc="${id}"`, 'Копия', 'Новое КП на основе этого: позиции, цены и условия — те же, получатель — новый'),
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
