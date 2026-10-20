import { Currency } from './currency.js';
import { Drafts } from './drafts.js';
import { Managers } from './managers.js';
import { ShortName } from './journal-row.js';

/** Заготовка — КП без клиента (позиции, условия, цены), общая для всех: новое КП из заготовки за один щелчок. */
export class Presets {
  // поля КП конкретного клиента — в заготовку не попадают
  static DROP = [
    'kpId',
    'number',
    'createdAt',
    'authorId',
    'managerId',
    'manager',
    'date',
    'client',
    'clientId',
    'clientInn',
    'clientKpp',
    'clientOgrn',
    'clientFull',
    'clientAddr',
    'clientDir',
    'clientDirPost',
    'clientStatus',
    'contact',
    'object',
    'check',
    'tender',
    'deal',
  ];
  static TITLE_MAX = 120;
  /** кто я — по ответу сервера (свои заготовки можно удалить) */
  static myId = null;

  /**
   * Заготовки включены в «Функциях».
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('presets');
  }

  /**
   * Все заготовки.
   * @returns {Promise<object[]>}
   */
  static async list() {
    try {
      const answer = await api('/api/presets');
      this.myId = answer.me;
      return answer.items || [];
    } catch {
      return [];
    }
  }

  /** Сохранить текущее КП как заготовку. */
  static ask() {
    if (!S.items.length) {
      toast('Добавьте в КП позиции — заготовка хранит позиции, цены и условия');
      return;
    }
    const title = S.items
      .slice(0, 2)
      .map(item => item.name)
      .filter(Boolean)
      .join(' + ')
      .slice(0, this.TITLE_MAX);
    const modal =
      new Modal(`<div class="dlg-h"><h3>Сохранить как заготовку</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">В заготовку войдут позиции, цены, валюта и условия — без клиента, контакта, объекта и экономики сделки. Заготовки видны всем менеджерам.</p>
      <label class="f"><span>Название</span><input type="text" id="prN" maxlength="120" placeholder="Например: Винтовой 37 кВт + осушитель + ресивер" value="${esc(title)}"></label>
      <div class="dlg-acts"><button class="btn ghost" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-ok>Сохранить</button></div>`);
    modal.d.onclick = event => {
      if (event.target.closest('[data-x]')) modal.close();
      else if (event.target.closest('[data-ok]')) this._put(modal);
    };
    modal.$('#prN').onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._put(modal);
      }
    };
    modal.$('#prN').select();
  }

  static async _put(modal) {
    const title = modal.$('#prN').value.trim();
    if (!title) {
      modal.$('#prN').focus();
      return;
    }
    const state = Drafts.clean();
    for (const key of this.DROP) delete state[key];
    try {
      await api(`/api/presets/${Drafts.newId('p')}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ state, title, sum: totalsS().sum, cur: (S.pricing && S.pricing.cur) || 'RUB' }),
      });
      modal.close();
      toast(`Заготовка «${title}» сохранена — «Новое КП» → по заготовке`);
    } catch (error) {
      toast(`Не сохранено: ${error.message || error}`);
    }
  }

  /**
   * Новое КП из заготовки: менеджер и его контакты — текущие.
   * @param {string} id
   */
  static async use(id) {
    if (!(await Drafts.stash())) return;
    let answer;
    try {
      answer = await api(`/api/presets/${encodeURIComponent(id)}`);
    } catch (error) {
      toast(`Заготовка не открылась: ${error.message || error}`);
      return;
    }
    const keep = { manager: S.manager, managerId: S.managerId };
    S = Object.assign(freshState(), answer.data.state || {}, keep);
    S.authorId = Managers.meId() || S.managerId || '';
    S.date = today();
    S.items.forEach(item => {
      item.id = uid();
    });
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    renderForm();
    persist();
    Drafts.loaded();
    window.scrollTo({ top: 0 });
    goStep('client');
    toast(`Новое КП по заготовке «${answer.row.title}» — укажите клиента`);
  }

  /**
   * Удалить заготовку.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  static async remove(id) {
    try {
      await api(`/api/presets/${encodeURIComponent(id)}/delete`, { method: 'POST' });
      toast('Заготовка удалена');
      return true;
    } catch (error) {
      toast(`Не удалено: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Строка заготовки в окне «Новое КП».
   * @param {object} row
   * @returns {string}
   */
  static rowHtml(row) {
    const mine = row.owner === this.myId || ADMIN.on;
    const sum = row.sum ? ` · ${money(row.sum)} ${esc(Currency.short(row.cur || 'RUB'))}` : '';
    const owner = row.owner_name ? ` · ${esc(ShortName.of(row.owner_name))}` : '';
    const drop = mine
      ? `<button class="btn ghost" type="button" data-prd="${esc(row.id)}" data-prt="${esc(row.title)}">Удалить</button>`
      : '';
    return `<div class="st-row"><div><b>${esc(row.title)}</b><span class="muted">${row.positions || 0} поз.${sum}${owner} · ${esc(Fmt.dateTime(row.updated))}</span></div>
      <div class="acts"><button class="btn primary" type="button" data-pru="${esc(row.id)}">Создать КП</button>${drop}</div></div>`;
  }
}
