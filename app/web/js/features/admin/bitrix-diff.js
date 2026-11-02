import { FEAT } from '../../core/features.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/**
 * «Битрикс24 → Журнал и проверка → Расхождения»: связанные сделки, у которых стадия, сумма или ответственный в программе
 * и в Битриксе разные (поля, которые программа отправляет в Битрикс); «Выровнять» — отправить сделку по значениям
 * программы при следующем обмене, «Выровнять все» — все найденные, «Отправить сейчас» — обмен и новая проверка.
 */
export class BitrixDiffCard {
  static report = null;
  static queued = new Set();
  static MANY = 2;

  /**
   * Карточка (функция выключена — пусто).
   * @param {boolean} enabled связь с Битриксом включена
   * @returns {string}
   */
  static html(enabled) {
    if (!FEAT.on('bxDiff')) return '';
    return `<div class="st-card" id="bxDiffCard"><div class="row"><p class="sub" style="margin:0">Расхождения с Битрикс24</p><span class="sp"></span><button class="btn" type="button" data-bxdiff="run"${enabled ? '' : ' disabled'}>Найти расхождения</button></div>
      <p class="muted">Сделки, у которых стадия, сумма или ответственный в программе и в Битриксе разные — по полям, которые программа отправляет в Битрикс (читается, ничего не меняется). «Выровнять» — отправить сделку в Битрикс по программе.</p>${this._rows()}</div>`;
  }

  static _rows() {
    const report = this.report;
    if (!report) return '';
    if (!report.rows.length) return `<p class="ok-t">Расхождений нет · проверено сделок: ${report.checked}</p>`;
    return `<div class="row bx-dh"><p class="muted">Расхождений: ${report.rows.length} из ${report.checked}</p><span class="sp"></span>${this._all()}</div>${report.rows.map(row => this._row(row)).join('')}`;
  }

  static _row(row) {
    const value = (diff, key) => esc(String(diff[key] ?? '—'));
    const action = this.queued.has(row.deal)
      ? '<span class="ok-t bx-dq">✓ В очереди</span>'
      : `<button class="btn sm" type="button" data-bxdiff="align" data-deal="${esc(row.deal)}">Выровнять</button>`;
    return `<div class="bx-f"><div><b>${esc(row.title)}</b> <span class="muted">${esc(row.manager)}</span>
        ${row.diffs.map(diff => `<span>${esc(diff.label)}: программа <b>${value(diff, 'program')}</b> · Битрикс <b>${value(diff, 'bitrix')}</b></span>`).join('')}</div>${action}</div>`;
  }

  // «Выровнять все» — пока есть невыровненные; все в очереди — «Отправить сейчас» (обмен и новая проверка)
  static _all() {
    if (!FEAT.on('bxDiffAll') || this.report.rows.length < this.MANY) return '';
    const left = this._left().length;
    if (left) return `<button class="btn sm primary" type="button" data-bxdiff="all">Выровнять все (${left})</button>`;
    return `<span class="ok-t">✓ В очереди: ${this.queued.size}</span><button class="btn sm" type="button" data-bxdiff="send" title="Обменяться с Битрикс24 сейчас и найти расхождения заново">Отправить сейчас</button>`;
  }

  static _left() {
    return this.report.rows.map(row => row.deal).filter(deal => !this.queued.has(deal));
  }

  /**
   * Щелчок в карточке. true — обработано.
   * @param {Event} event
   * @param {{redraw: () => void, keep: (reply: object) => void}} host перерисовать вкладку; принять состояние связи
   * @returns {boolean}
   */
  static click(event, host) {
    const button = event.target.closest('[data-bxdiff]');
    if (!button) return false;
    const actions = {
      run: () => this._run(button, host),
      align: () => this._align(button, host),
      all: () => this._alignAll(host),
      send: () => this._send(button, host),
    };
    actions[button.dataset.bxdiff]?.();
    return true;
  }

  static async _run(button, host) {
    button.disabled = true;
    button.textContent = 'Сверяю…';
    await this._check();
    host.redraw();
  }

  static async _check() {
    try {
      this.report = await AdminApi.post('bitrix/diff', {});
      this.queued = new Set();
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _align(button, host) {
    button.disabled = true;
    try {
      await AdminApi.post('bitrix/diff/align', { deal: button.dataset.deal });
      this.queued.add(button.dataset.deal);
    } catch (error) {
      button.disabled = false;
      Toast.show(error.message || String(error));
      return;
    }
    host.redraw();
  }

  static async _alignAll(host) {
    const deals = this._left();
    const text = `Сделок: ${deals.length}. При следующем обмене они уйдут в Битрикс24 по значениям программы — стадия, сумма, ответственный; в Битрикс24 эти значения изменятся.`;
    if (!(await AdminDialog.confirm('Выровнять все расхождения?', text, 'Выровнять все'))) return;
    try {
      const reply = await AdminApi.post('bitrix/diff/align-all', { deals });
      deals.forEach(deal => this.queued.add(deal));
      Toast.show(`В очереди: ${reply.queued} — уйдут в Битрикс24 при следующем обмене или по «Отправить сейчас»`);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    host.redraw();
  }

  static async _send(button, host) {
    button.disabled = true;
    button.textContent = 'Отправляю…';
    try {
      const reply = await AdminApi.post('bitrix/run', {});
      host.keep(reply);
      const result = reply.result || {};
      if (result.error) Toast.show(`Обмен не прошёл: ${result.error}`);
      else if (result.failed) Toast.show(`Не отправлено: ${result.failed} — причины в «Не отправлено»`);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    await this._check();
    host.redraw();
  }
}
