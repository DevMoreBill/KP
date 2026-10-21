import { UiKit } from './ui-kit.js';
import { KpFile } from '../features/doc/kp-file.js';
import { esc } from '../core/util.js';
import { S } from '../core/state.js';
import { FEAT } from '../core/features.js';

/** Вид КП «для тендера»: номер и ссылка на закупку — в КП, журнале и имени файла «<номер> КП …». */
export class Tender {
  static URL = /^https?:\/\/\S+$/i;
  // номер закупки в ссылке: ЕИС (regNumber=…), площадки (…/tender/123456, …?id=…)
  static URL_NUMBER = [
    /[?&](?:regNumber|purchaseNumber|noticeNumber|lotNumber)=(\d{5,})/i,
    /(?:tender|purchase|trade|lot|procedure|auction|zakupk\w*|notice)[\w-]*[/=_-](\d{5,})/i,
  ];

  /**
   * КП для тендера.
   * @returns {boolean}
   */
  static active() {
    return FEAT.on('tender') && !!(S.tender && S.tender.on);
  }

  /**
   * № закупки (у обычного КП — пусто).
   * @returns {string}
   */
  static number() {
    return this.active() ? String(S.tender.number || '').trim() : '';
  }

  /**
   * Ссылка на закупку, если она правильная.
   * @returns {string}
   */
  static url() {
    const url = this.active() ? String(S.tender.url || '').trim() : '';
    return this.URL.test(url) ? url : '';
  }

  /**
   * № закупки из ссылки; не нашёлся по шаблонам — самая длинная группа цифр от 6 знаков.
   * @param {string} link
   * @returns {string}
   */
  static numberFromUrl(link) {
    const url = String(link || '');
    for (const pattern of this.URL_NUMBER) {
      const found = pattern.exec(url);
      if (found) return found[1];
    }
    const all = url.replace(/^https?:\/\/[^/]+/i, '').match(/\d{6,}/g) || [];
    return all.sort((left, right) => right.length - left.length)[0] || '';
  }

  /**
   * Площадка (домен) по ссылке.
   * @param {string} link
   * @returns {string}
   */
  static host(link) {
    try {
      return new URL(link).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Пояснение под полями тендера: имена файлов, площадка или ошибка ссылки.
   * @returns {string}
   */
  static note() {
    const url = String((S.tender || {}).url || '').trim();
    const files = this.number()
      ? `Файлы: <b>${esc(KpFile.saved())}</b> и <b>${esc(KpFile.saved().replace(/\.docx$/i, '.pdf'))}</b>.`
      : 'Номер закупки — в КП и в названии файлов: «4567892 КП ПНЕВМОТЕХ Заказчик.docx».';
    return files + this._link(url);
  }

  static _link(url) {
    if (url && !this.url()) return ' <span class="bad-t">Ссылка должна начинаться с http:// или https://</span>';
    return url ? ` Площадка: ${esc(this.host(url))}.` : '';
  }
}

/** Вид КП: обычное или для тендера. Пояснение — в «?»; поля номера и ссылки на закупку — только у тендерного. */
export class TenderBlock {
  /**
   * Блок «Вид КП» в разделе «Клиент».
   * @returns {string}
   */
  static html() {
    if (!FEAT.on('tender')) return '';
    const active = Tender.active();
    return `<div class="csec kp-kind${active ? ' on' : ''}" id="st-tender"><div class="kk-head"><div class="sub">Вид КП${UiKit.tip('<p>Для тендера КП собирается в шаблоне «Тендерный»: в нём — номер закупки, а файлы называются «№ закупки КП поставщик заказчик».</p><p>Ссылка на закупку хранится в журнале КП и в документ не выводится.</p>')}</div>
        <div class="seg" role="radiogroup" aria-label="Вид КП"><button type="button" role="radio" aria-checked="${!active}" class="${active ? '' : 'on'}" data-a="kpKind" data-v="std">Обычное</button><button type="button" role="radio" aria-checked="${active}" class="${active ? 'on' : ''}" data-a="kpKind" data-v="tender">Для тендера</button></div></div>
      ${active ? this._fields() : ''}</div>`;
  }

  static _fields() {
    const tender = S.tender || {};
    const url = String(tender.url || '').trim();
    const badUrl = url && !Tender.url();
    const numberField = UiKit.field('№ закупки (тендера)', 'tender.number', {
      req: 1,
      ph: 'Например: 4567892',
      cls: tender.number && String(tender.number).trim() ? '' : 'bad',
    });
    return `<div class="grid kk-grid">${numberField}
          <label class="f"><span>Ссылка на закупку <span class="muted">для журнала, в КП не выводится</span></span><input type="url" data-p="tender.url" value="${esc(url)}" placeholder="https://zakupki.gov.ru/…" autocomplete="off" class="${badUrl ? 'bad' : ''}"></label></div>
        <p class="muted kk-note" id="kkNote">${Tender.note()}</p>`;
  }
}
