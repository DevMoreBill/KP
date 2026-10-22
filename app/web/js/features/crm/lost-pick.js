import { CrmData } from './crm-data.js';
import { CrmFunnel } from './crm-funnel.js';
import { Toast } from '../../core/toast.js';
import { Modal } from '../../core/modal.js';
import { esc } from '../../core/util.js';
import { DealCard } from './deal-card.js';

/**
 * «Проиграно»: у воронки Битрикса — выбор стадии провала («Высокая цена», «Отмена проекта»…) и комментарий; у своей воронки
 * программы — причина из списка «Причины проигрыша» (DealCard.lostReason).
 */
export class LostPick {
  /**
   * Спросить, как закрыть сделку.
   * @param {object} deal
   * @returns {Promise<{stage: string, lostReason: string, lostNote?: string}|null>}
   */
  static async ask(deal) {
    const fails = CrmFunnel.failures(deal.funnel);
    if (fails.length < 2) {
      const reason = await DealCard.lostReason(deal);
      return reason ? { stage: fails.length ? fails[0].key : 'lost', lostReason: reason } : null;
    }
    return this._choose(deal, fails);
  }

  static _choose(deal, fails) {
    const current = deal.fstage || '';
    const options = fails
      .map(
        stage =>
          `<label class="ck"><input type="radio" name="lpS" value="${esc(stage.key)}"${stage.key === current ? ' checked' : ''}> ${esc(stage.label)}</label>`,
      )
      .join('');
    return new Promise(resolve => {
      const modal = new Modal(
        `<div class="dlg-h"><h3>Сделка проиграна</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
        <p class="muted" style="margin:0 0 8px">«${esc(deal.title || deal.client)}» — стадия провала, как в Битрикс24.</p>
        <div class="dk-lr">${options}<label class="f"><span>${CrmData.regs() ? 'Почему проиграна' : 'Комментарий'}</span><input type="text" id="lpC" maxlength="200" value="${esc(deal.lostReason || '')}" placeholder="Например: выбрали поставщика дешевле"></label></div>
        <div class="row"><button class="btn primary" type="button" data-ok>Сделка проиграна</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div>`,
        'dk-lost-dlg',
      );
      let picked = null;
      modal.d.addEventListener('click', event => {
        if (event.target.closest('[data-x]')) modal.close();
        else if (event.target.closest('[data-ok]')) picked = this._picked(modal, fails);
        if (picked) modal.close();
      });
      modal.d.addEventListener('close', () => resolve(picked));
    });
  }

  static _picked(modal, fails) {
    const radio = modal.d.querySelector('input[name=lpS]:checked');
    if (!radio) {
      Toast.show('Выберите стадию провала');
      return null;
    }
    const stage = fails.find(row => row.key === radio.value);
    const note = modal.$('#lpC').value.trim();
    if (CrmData.regs() && !note) {
      Toast.show('Напишите, почему сделка проиграна — по регламенту Битрикс24');
      modal.$('#lpC').focus();
      return null;
    }
    return { stage: radio.value, lostReason: note || stage.label, lostNote: note };
  }
}
