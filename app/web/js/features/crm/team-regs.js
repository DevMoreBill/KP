import { esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { Morph } from '../../core/morph.js';
import { FEAT } from '../../core/features.js';

/** «Отдел» → «Регламент Битрикс24»: сколько открытых сделок не заполнено для своей стадии, у кого больше, чего чаще не хватает. */
export class TeamRegs {
  static data = null;
  static loadedAt = 0;
  static failedAt = 0;
  static FRESH_MS = 300000;
  static RETRY_MS = 30000;
  static loading = false;

  /**
   * Блок (данные — с сервера при первом показе).
   * @returns {string}
   */
  static html() {
    if (!FEAT.on('regAudit')) return '';
    if (this._due()) this._load();
    return `<section class="md-s" id="cabRegs">${this._inner()}</section>`;
  }

  static _inner() {
    const data = this.data;
    const head =
      '<div class="md-h"><p class="sub">Регламент Битрикс24</p><span class="muted">открытые сделки, не заполненные для своей стадии</span></div>';
    if (!data) return `${head}<p class="muted">Считаю…</p>`;
    if (data.error)
      return `${head}<p class="muted">Не загрузилось: ${esc(data.error)} <button class="lnk" type="button" data-cabretry="regs">Повторить</button></p>`;
    if (!data.on)
      return `${head}<p class="empty">Регламент сделки выключен («Настройки» → Битрикс24 → «Регламент сделки»).</p>`;
    if (!data.gaps) return `${head}<p class="ok-t">Все ${data.deals} открытых сделок заполнены по регламенту.</p>`;
    const items = data.items.map(row => `<li>${esc(row.label)} — <b>${row.n}</b></li>`).join('');
    return `${head}<p><b>${data.gaps}</b> из ${data.deals} сделок не заполнены</p><div class="tbl-wrap"><table class="cab-tt"><thead><tr><th>Менеджер</th><th>Открыто</th><th>Не заполнено</th><th>Например</th></tr></thead><tbody>${data.managers.map(row => this._row(row)).join('')}</tbody></table></div>
      <p class="muted wt-h">Чего чаще не хватает:</p><ul class="wt-why">${items}</ul>`;
  }

  static _row(row) {
    const samples = row.samples
      .map(
        sample =>
          `<button class="pay-t" type="button" data-deal="${esc(sample.deal)}" title="${esc(sample.missing.join(', '))}">${esc(sample.title)}</button>`,
      )
      .join(' ');
    const cls = row.gaps ? ' class="bad-t"' : '';
    return `<tr><td>${esc(row.name)}</td><td>${row.open}</td><td${cls}>${row.gaps}</td><td>${samples || '—'}</td></tr>`;
  }

  /**
   * Загрузить заново (кнопка «Повторить»).
   */
  static retry() {
    this.failedAt = 0;
    this._load();
  }

  // пора загрузить: нет данных, устарели или ошибка — не чаще раза в RETRY_MS
  static _due() {
    const now = Date.now();
    if (this.loading || now - this.failedAt < this.RETRY_MS) return false;
    return !this.data || Boolean(this.data.error) || now - this.loadedAt > this.FRESH_MS;
  }

  static async _load() {
    if (this.loading) return;
    this.loading = true;
    try {
      this.data = await Api.request('/api/crm/regs/audit');
      this.loadedAt = Date.now();
      this.failedAt = 0;
    } catch (error) {
      // ошибка — не «выключено» и не «сделок нет»: прежние данные остаются, иначе текст и «Повторить»; срок кэша не продлевается
      if (!this.data || this.data.error) this.data = { error: String(error.message || error) };
      this.failedAt = Date.now();
    } finally {
      this.loading = false;
    }
    const box = document.getElementById('cabRegs');
    if (box) Morph.apply(box, this._inner());
  }
}
