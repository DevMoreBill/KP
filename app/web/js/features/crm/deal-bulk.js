import { CrmData } from './crm-data.js';
import { CrmTask } from './crm-task.js';
import { DealPause } from './deal-pause.js';
import { Modal } from '../../core/modal.js';
import { FEAT } from '../../core/features.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { DateChips } from '../../core/crm-fmt.js';

/**
 * Массовые действия в «Сделках» (доска и список): «☐ Выбрать» → галочки на карточках → внизу панель: стадия, ответственный
 * (руководителю), дело всем, отложить на неделю. Каждая сделка сохраняется своим запросом — не прошедшие (регламент,
 * права) называются в итоге.
 */
export class DealBulk {
  static picking = false;
  static picked = new Set();
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Кнопка «Выбрать» на панели раздела.
   * @returns {string}
   */
  static toggle() {
    if (!FEAT.on('dealBulk')) return '';
    return `<button type="button" class="chip${this.picking ? ' on' : ''}" data-cpick aria-pressed="${this.picking}" title="Выбрать несколько сделок и изменить их разом">☐ Выбрать</button>`;
  }

  /**
   * Галочка на карточке или строке.
   * @param {object} deal
   * @returns {string}
   */
  static box(deal) {
    if (!this.picking) return '';
    const chosen = this.picked.has(deal.id);
    return `<input type="checkbox" class="dc-pk" data-dpick="${esc(deal.id)}"${chosen ? ' checked' : ''} aria-label="Выбрать сделку">`;
  }

  /**
   * Панель действий над выбранными.
   * @returns {string}
   */
  static bar() {
    if (!this.picking) return '';
    const count = this.picked.size;
    const stages = CrmData.stages({ open: true })
      .map(stage => `<option value="${esc(stage.key)}">${esc(stage.label)}</option>`)
      .join('');
    const people = CrmData.board.canAll
      ? `<select data-bmgr aria-label="Передать ответственному"><option value="">Ответственный…</option>${CrmData.managers()
          .map(mgr => `<option value="${esc(mgr.id)}">${esc(mgr.name)}</option>`)
          .join('')}</select>`
      : '';
    const acts = count
      ? `<select data-bstage aria-label="Перевести на стадию"><option value="">Стадия…</option>${stages}</select>${people}
        <button type="button" class="btn sm" data-btask>＋ Дело всем</button><button type="button" class="btn sm" data-bpause>⏸ Отложить на неделю</button>`
      : '<span class="muted">Отметьте сделки галочками</span>';
    return `<div class="cab-bulk" role="toolbar" aria-label="Действия с выбранными"><b>Выбрано: ${count}</b>${acts}<span class="sp"></span><button type="button" class="btn sm ghost" data-bnone>Готово</button></div>`;
  }

  /**
   * Щелчки: «Выбрать», галочки (и щелчок по карточке при выборе), действия. true — обработано.
   * @param {Event} event
   * @param {Function} after перерисовать раздел
   * @param {Function} reload загрузить сделки заново
   * @returns {boolean}
   */
  static click(event, after, reload) {
    const target = event.target;
    if (target.closest('[data-cpick]')) {
      this.picking = !this.picking;
      this.picked.clear();
      after();
      return true;
    }
    if (target.closest('[data-bnone]')) {
      this.picking = false;
      this.picked.clear();
      after();
      return true;
    }
    if (this.picking && this._pick(target)) {
      after();
      return true;
    }
    if (target.closest('[data-btask]')) {
      this._task(reload);
      return true;
    }
    if (target.closest('[data-bpause]')) {
      this._each(id => DealPause.week({ id }), reload, 'отложено на неделю');
      return true;
    }
    const unpause = target.closest('[data-dunpause]');
    if (unpause) {
      DealPause.set({ id: unpause.dataset.dunpause }, '', reload);
      return true;
    }
    return false;
  }

  // при выборе щелчок по карточке или галочке отмечает сделку, а не открывает её
  static _pick(target) {
    const card = target.closest('[data-dpick], .dc[data-deal], .cab-lr[data-deal]');
    if (!card || target.closest('a')) return false;
    const id = card.dataset.dpick || card.dataset.deal;
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    return true;
  }

  /**
   * Выбор стадии или ответственного в панели. true — обработано.
   * @param {HTMLElement} target
   * @param {Function} reload
   * @returns {boolean}
   */
  static change(target, reload) {
    if (target.matches('[data-bstage]') && target.value) {
      const stage = target.value;
      this._each(id => this._put(id, { stage }), reload, 'переведено');
      return true;
    }
    if (target.matches('[data-bmgr]') && target.value) {
      const managerId = target.value;
      this._each(id => this._put(id, { managerId }), reload, 'передано');
      return true;
    }
    return false;
  }

  static _put(id, body) {
    return Api.request(`/api/crm/deal/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.JSON_HEAD,
      body: JSON.stringify(body),
    });
  }

  // по сделке за раз; не прошедшие — с причиной в итоге
  static async _each(run, reload, done) {
    const ids = [...this.picked];
    const failed = [];
    for (const id of ids) {
      try {
        await run(id);
      } catch (error) {
        const deal = CrmData.deal(id) || {};
        failed.push(`${deal.title || deal.client || id}: ${error.message}`);
      }
    }
    const good = ids.length - failed.length;
    Toast.show(
      `${done}: ${good} из ${ids.length}${failed.length ? ` — не вышло: ${failed.slice(0, 2).join('; ')}` : ''}`,
    );
    this.picked.clear();
    reload();
  }

  // одно дело каждой выбранной сделке: вид, что сделать, дата, время
  static _task(reload) {
    const modal = new Modal(
      `<div class="dlg-h"><h3>Дело по ${this.picked.size} сделкам</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>${CrmTask.form('')}`,
      'tk-dlg tq-dlg',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
      else if (!DateChips.click(event) && event.target.closest('[data-tqk]'))
        CrmTask.pickKind(event.target.closest('[data-tqk]'));
    });
    modal.d.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const fields = event.target.elements;
      const body = {
        kind: modal.d.querySelector('[data-tqk].on')?.dataset.tqk || 'task',
        title: fields.title.value.trim(),
        due: fields.due.value,
        time: fields.time.value,
        again: true,
      };
      modal.close();
      this._each(id => this._add({ ...body, deal: id }), reload, 'дело поставлено');
    });
  }

  static _add(body) {
    return Api.request('/api/crm/task', { method: 'POST', headers: this.JSON_HEAD, body: JSON.stringify(body) });
  }
}
