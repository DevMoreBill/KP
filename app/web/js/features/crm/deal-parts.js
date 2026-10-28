import { SafeLink } from '../../core/safe-link.js';
import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { Money } from '../../core/money.js';
import { esc, today } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/**
 * Разделы карточки сделки строками-раскрывашками с итогом в заголовке («Клиент и сделка · ООО … · Иванов»), строка
 * главных цифр под стадиями. Раскрытое менеджером помнится в браузере.
 */
export class DealParts {
  static KEY = 'kp.dk.parts';
  static chosen = null;

  /**
   * Раздел-раскрывашка.
   * @param {{key: string, title: string, note?: string, body: string, open?: boolean, tone?: string}} part
   *   open — раскрыт, пока менеджер сам не свернул или не раскрыл; tone — 'warn' (есть что заполнить)
   * @returns {string}
   */
  static part({ key, title, note = '', body, open = false, tone = '' }) {
    const shown = key in this._chosen() ? this._chosen()[key] : open;
    return `<details class="md-s dk-part${tone ? ` ${tone}` : ''}" data-dkpart="${esc(key)}"${shown ? ' open' : ''}><summary><b>${esc(title)}</b>${note ? `<span class="muted dk-pn">${note}</span>` : ''}</summary><div class="dk-pb">${body}</div></details>`;
  }

  /**
   * Менеджер раскрыл или свернул раздел — запомнить.
   * @param {HTMLElement} target
   */
  static toggled(target) {
    const part = target.closest && target.closest('details[data-dkpart]');
    if (!part || part !== target) return;
    this._chosen()[part.dataset.dkpart] = part.open;
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this._chosen()));
    } catch {
      // выбор просто не запомнится
    }
  }

  /**
   * Раскрыть раздел (например, «Исполнение» по кнопке «Что сделать сейчас»).
   * @param {string} key
   */
  static show(key) {
    this._chosen()[key] = true;
  }

  static _chosen() {
    if (this.chosen) return this.chosen;
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      this.chosen = saved && typeof saved === 'object' ? saved : {};
    } catch {
      this.chosen = {};
    }
    return this.chosen;
  }

  /**
   * Метка «Б24 · №» в шапке карточки: ссылка в Битрикс24 или «ждёт отправки» / «не отправлено».
   * @param {object} deal
   * @returns {string}
   */
  static bitrix(deal) {
    const link = deal.bx;
    if (!link) return '';
    if (!link.id) {
      const text = link.error ? 'не отправлено' : 'ждёт отправки';
      const hint = link.error ? `Битрикс24: не отправлено — ${link.error}` : 'Битрикс24: сделка ещё не отправлена';
      return `<span class="dk-bxc${link.error ? ' bad' : ''}" title="${esc(hint)}">Б24 · ${text}</span>`;
    }
    const hint = esc(`Сделка ${link.id} в Битрикс24 · синхронизировано ${Fmt.dateTime(link.at)}`);
    const name = `Б24 · ${esc(link.id)}`;
    return link.url
      ? `<a class="dk-bxc" href="${SafeLink.href(link.url)}" target="_blank" rel="noopener" title="${hint} — открыть">${name} ↗</a>`
      : `<span class="dk-bxc" title="${hint}">${name}</span>`;
  }

  /**
   * Главные цифры одной строкой: сумма, оплата заказчика, поставка или ожидаемая дата.
   * @param {object} deal
   * @returns {string}
   */
  static facts(deal) {
    const items = [this._sum(deal), this._paid(deal), this._when(deal)].filter(Boolean);
    return `<div class="dk-facts">${items.join('')}</div>`;
  }

  static _fact(label, value, { note = '', tone = '' } = {}) {
    return `<span class="dk-fa${tone ? ` ${tone}` : ''}"><span class="muted">${label}</span> <b>${value}</b>${note ? ` <span class="muted">${note}</span>` : ''}</span>`;
  }

  static _sum(deal) {
    return this._fact('Сумма', CrmFmt.rub(deal.sum), { note: this._sumNote(deal) });
  }

  static _sumNote(deal) {
    if (deal.sumOwn) return 'своя';
    const offer = (deal.kps || []).find(row => row.status !== 'lost');
    return offer ? `по КП № ${esc(offer.number)}` : 'КП ещё нет';
  }

  static _paid(deal) {
    const exec = deal.exec || {};
    if (!exec.toPay) return '';
    const done = exec.paid >= exec.toPay;
    return this._fact('Оплачено', esc(Money.rub(exec.paid)), {
      note: `из ${esc(Money.rub(exec.toPay))}`,
      tone: done ? 'ok' : '',
    });
  }

  static _when(deal) {
    return this._supply(deal) || this._expected(deal);
  }

  // после договора — поставка по исполнению
  static _supply(deal) {
    const exec = deal.exec || {};
    const ship = (exec.steps || []).find(step => step.key === 'delivery');
    if (!ship) return '';
    if (ship.state === 'done') return this._fact('Поставка', `✓ ${esc(CrmFmt.day(ship.fact))}`, { tone: 'ok' });
    if (!ship.plan || !exec.signed) return '';
    return this._fact('Поставка', esc(CrmFmt.day(ship.plan)), { tone: ship.state === 'overdue' ? 'bad' : '' });
  }

  static _expected(deal) {
    if (!deal.expected) return '';
    const late = deal.expected < today() && !CrmFunnel.closed(deal);
    return this._fact('Ожидаем договор', esc(CrmFmt.day(deal.expected)), {
      note: late ? '— прошла' : '',
      tone: late ? 'bad' : '',
    });
  }
}
