import { FEAT } from '../../core/features.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { AdminApi } from '../../core/admin-api.js';

/**
 * «Битрикс24 → Журнал и проверка → Расхождения»: связанные сделки, у которых стадия, сумма или ответственный в программе
 * и в Битриксе разные; «Выровнять» — отправить сделку по значениям программы при следующем обмене.
 */
export class BitrixDiffCard {
  static report = null;

  /**
   * Карточка (функция выключена — пусто).
   * @param {boolean} enabled связь с Битриксом включена
   * @returns {string}
   */
  static html(enabled) {
    if (!FEAT.on('bxDiff')) return '';
    return `<div class="st-card" id="bxDiffCard"><div class="row"><p class="sub" style="margin:0">Расхождения с Битрикс24</p><span class="sp"></span><button class="btn" type="button" data-bxdiff="run"${enabled ? '' : ' disabled'}>Найти расхождения</button></div>
      <p class="muted">Сделки, у которых стадия, сумма или ответственный в программе и в Битриксе разные (читается, ничего не меняется). «Выровнять» — отправить сделку в Битрикс по программе.</p>${this._rows()}</div>`;
  }

  static _rows() {
    const report = this.report;
    if (!report) return '';
    if (!report.rows.length) return `<p class="ok-t">Расхождений нет · проверено сделок: ${report.checked}</p>`;
    const value = (diff, key) => esc(String(diff[key] ?? '—'));
    return `<p class="muted">Расхождений: ${report.rows.length} из ${report.checked}</p>${report.rows
      .map(
        row => `<div class="bx-f"><div><b>${esc(row.title)}</b> <span class="muted">${esc(row.manager)}</span>
        ${row.diffs.map(diff => `<span>${esc(diff.label)}: программа <b>${value(diff, 'program')}</b> · Битрикс <b>${value(diff, 'bitrix')}</b></span>`).join('')}</div>
        <button class="btn sm" type="button" data-bxdiff="align" data-deal="${esc(row.deal)}">Выровнять</button></div>`,
      )
      .join('')}`;
  }

  /**
   * Щелчок в карточке. true — обработано.
   * @param {Event} event
   * @param {() => void} redraw
   * @returns {boolean}
   */
  static click(event, redraw) {
    const button = event.target.closest('[data-bxdiff]');
    if (!button) return false;
    if (button.dataset.bxdiff === 'run') this._run(button, redraw);
    else this._align(button);
    return true;
  }

  static async _run(button, redraw) {
    button.disabled = true;
    button.textContent = 'Сверяю…';
    try {
      this.report = await AdminApi.post('bitrix/diff', {});
    } catch (error) {
      Toast.show(error.message || String(error));
    }
    redraw();
  }

  static async _align(button) {
    button.disabled = true;
    try {
      await AdminApi.post('bitrix/diff/align', { deal: button.closest('[data-deal]').dataset.deal });
      button.textContent = '✓ В очереди';
    } catch (error) {
      button.disabled = false;
      Toast.show(error.message || String(error));
    }
  }
}
