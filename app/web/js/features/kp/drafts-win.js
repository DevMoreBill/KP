import { Api } from '../../core/net.js';
import { Drafts } from './drafts.js';
import { FEAT } from '../../core/features.js';
import { KpForm } from '../../core/kp-form.js';
import { KpState, S } from '../../core/state.js';
import { KpTabs } from './kp-tabs.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';

/** Окно «Черновики» и «Продолжить» черновик — над вкладками КП (вкладки стоят на черновиках). */
export class DraftsWin {
  /**
   * Продолжить черновик.
   * @param {string} id
   */
  static async open(id) {
    let answer;
    try {
      answer = await Api.request(`/api/drafts/${encodeURIComponent(id)}`);
    } catch (error) {
      Toast.show(`Черновик не открылся: ${error.message || error}`);
      return;
    }
    if (!(await KpTabs.prepare({ draft: id, kpId: (answer.data.state && answer.data.state.kpId) || '' }))) return;
    KpState.replace(Object.assign(KpState.fresh(), answer.data.state || {}));
    if (answer.data.rev != null) S._rev = answer.data.rev;
    S._draft = id;
    KpTabs.show();
    KpForm.render();
    KpState.persist();
    window.scrollTo({ top: 0 });
    Drafts.loaded();
    Toast.show(
      answer.row.kp
        ? `Открыты несохранённые правки КП № ${answer.row.kp} — сохраните КП, чтобы они попали в журнал`
        : 'Черновик открыт',
    );
  }

  /** Окно «Черновики». */
  static async dialog() {
    const modal = new Modal(
      `<div class="dlg-h"><h3>Черновики</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Незаконченные КП и несохранённые правки — ваши, доступны с любого компьютера.${FEAT.on('autosave') ? ` Изменения записываются сюда автоматически ${Drafts.autoText()}.` : ''} После сохранения КП в журнал черновик удаляется.</p>
      <div class="dr-l"><p class="empty">Загружаю…</p></div>`,
      'drafts-dlg',
    );
    const draw = async () => {
      const list = await Drafts.list();
      modal.$('.dr-l').innerHTML = list.length
        ? list.map(row => Drafts.rowHtml(row)).join('')
        : '<p class="empty">Черновиков нет.</p>';
    };
    modal.d.onclick = async event => {
      if (event.target.closest('[data-x]')) {
        modal.close();
        return;
      }
      const open = event.target.closest('[data-dro]');
      if (open) {
        modal.close();
        this.open(open.dataset.dro);
        return;
      }
      const drop = event.target.closest('[data-drd]');
      if (drop && (await Drafts.remove(drop.dataset.drd))) draw();
    };
    await draw();
  }
}
