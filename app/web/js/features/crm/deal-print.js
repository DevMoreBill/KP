import { CrmFmt } from './crm-fmt.js';
import { CrmFunnel } from './crm-funnel.js';
import { DealFeed } from './deal-feed.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';

/** Печать карточки сделки (🖨 или клавиша P): сделка, клиент, открытые дела и лента — на листе A4 без кнопок. */
export class DealPrint {
  static AREA = 'dkPrint';
  static FEED_ROWS = 40;

  /**
   * Напечатать.
   * @param {object} deal
   * @param {Function} hist строка истории сделки
   */
  static open(deal, hist) {
    document.getElementById(this.AREA)?.remove();
    const area = document.createElement('div');
    area.id = this.AREA;
    area.innerHTML = this._html(deal, hist);
    document.body.append(area);
    document.body.classList.add('printing-deal');
    const done = () => {
      document.body.classList.remove('printing-deal');
      area.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }

  static _html(deal, hist) {
    const rows = [
      ['Клиент', deal.client || '—'],
      ['Стадия', CrmFunnel.label(deal)],
      ['Сумма', deal.sum ? CrmFmt.rub(deal.sum) : '—'],
      ['Ответственный', deal.manager || '—'],
      ['Создана', Fmt.dateTime(deal.created)],
    ];
    const open = (deal.tasks || []).filter(task => task.state === 'open');
    const tasks = open.length
      ? `<h3>Запланировано</h3><ul>${open.map(task => `<li>${esc(task.due || '')}${task.time ? ` ${esc(task.time)}` : ''} — ${esc(task.title)}</li>`).join('')}</ul>`
      : '';
    const feed = DealFeed.items(deal, hist)
      .slice(0, this.FEED_ROWS)
      .map(
        ([when, , text, who]) =>
          `<tr><td>${esc(Fmt.dateTime(when))}</td><td>${esc(this._plain(text))}</td><td>${esc(who || '')}</td></tr>`,
      )
      .join('');
    return `<h1>Сделка № ${esc(deal.number)} — ${esc(deal.title || '')}</h1>
      <table class="dp-info">${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</table>
      ${deal.note ? `<h3>Заметка</h3><p>${esc(deal.note)}</p>` : ''}${tasks}
      ${feed ? `<h3>Лента</h3><table class="dp-feed">${feed}</table>` : ''}
      <p class="dp-foot">Напечатано ${esc(Fmt.dateTime(new Date().toISOString()))}</p>`;
  }

  // текст события ленты без разметки
  static _plain(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.textContent.trim();
  }
}
