import { MyPrefs } from './my-prefs.js';
import { MailTemplates } from './mail-templates.js';
import { S } from '../../core/state.js';
import { Reminders } from './reminders.js';
import { esc } from '../../core/util.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { PriceGuard } from './price-guard.js';
import { Fmt } from '../../core/str.js';
import { KpDate } from '../../core/kp-date.js';

/** Письмо клиенту с файлом КП (сервер отправляет через почту из «Настройки → Почта»). */
export class MailDlg {
  static MAIL_MB = 18;
  static BYTES_IN_MB = 1048576;

  /**
   * Справочные документы КП в письме: сколько всего вложений и не больше ли предела письма.
   * @param {Modal} modal
   * @param {object} form ответ /mailform
   */
  static sum(modal, form) {
    const box = modal.$('#mlSum');
    if (!box) return;
    const ids = new Set([...modal.d.querySelectorAll('[data-mlf]:checked')].map(input => +input.dataset.mlf));
    const word = modal.$('#mlW').checked ? form.wordSize || 0 : 0;
    const pdf = modal.$('#mlP').checked ? form.pdfSize || 0 : 0;
    const files = (form.files || []).filter(file => ids.has(+file.id)).reduce((sum, file) => sum + (file.size || 0), 0);
    const bytes = word + pdf + files;
    const limit = form.mailMB || this.MAIL_MB;
    const over = bytes > limit * this.BYTES_IN_MB;
    box.className = `ml-sum ${over ? 'bad-t' : 'muted'}`;
    box.textContent = `Вложения: ≈ ${Fmt.size(bytes)} из ${limit} МБ${over ? ' — снимите галочки с части документов (их можно отправить вторым письмом)' : ''}`;
  }

  /**
   * Окно письма.
   * @param {string} id КП
   * @param {string} number
   * @param {Function} [onSent] (track) — после отправки
   */
  static async open(id, number, onSent) {
    let form;
    try {
      form = await Api.request(`/api/kp/${encodeURIComponent(id)}/mailform`);
    } catch (error) {
      Toast.show(`Не удалось подготовить письмо: ${error.message}`);
      return;
    }
    if (!form.on) {
      Toast.show('Почта не настроена — администратор: «Настройки → Почта»');
      return;
    }
    if (!form.word) {
      Toast.show('Файл КП не найден — сохраните КП');
      return;
    }
    form = MyPrefs.mail(form); // подпись и копия себе — из «Моих настроек»
    const modal = new Modal(this._html(number, form), 'ml-dlg');
    this.sum(modal, form);
    modal.d.onchange = event => {
      if (event.target.id === 'mlTpl') this._useTemplate(modal, number, event.target.value);
      this.sum(modal, form);
    };
    modal.d.onclick = event => this._click({ modal, id, number, onSent }, event.target);
  }

  static _templates() {
    if (!MailTemplates.LIST.length) return '';
    const options = MailTemplates.LIST.map((tpl, i) => `<option value="${i}">${esc(tpl.name)}</option>`).join('');
    return `<label class="f"><span>Шаблон письма</span><select id="mlTpl"><option value="">Как обычно (текст из «Настроек»)</option>${options}</select></label>`;
  }

  // тема и текст из шаблона; подпись из «Моих настроек» — в конец
  static _useTemplate(modal, number, index) {
    const tpl = MailTemplates.LIST[+index];
    if (index === '' || !tpl) return;
    const vars = { number, client: S.client || '', manager: (S.manager && S.manager.name) || '' };
    modal.$('#mlS').value = MailTemplates.fill(tpl.subject, vars);
    modal.$('#mlB').value = MyPrefs.mail({ body: MailTemplates.fill(tpl.body, vars) }).body;
  }

  static _html(number, form) {
    const files = (form.files || [])
      .map(
        file =>
          `<label><input type="checkbox" data-mlf="${esc(String(file.id))}" checked><span>📎 ${esc(file.name)} <span class="muted">· ${Fmt.size(file.size)}${file.note ? ` · ${esc(file.note)}` : ''}</span></span></label>`,
      )
      .join('');
    const sent =
      form.sent && form.sent.length
        ? `<p class="muted" style="margin:8px 0 0">Уже отправляли: ${form.sent.map(item => `${esc(KpDate.ddmm(item.at))} → ${esc((item.to || []).join(', '))}`).join('; ')}</p>`
        : '';
    return `<div class="dlg-h"><h3>Отправить КП № ${esc(number)} клиенту</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <label class="f"><span>Кому *</span><input type="text" id="mlTo" value="${esc(form.to)}" placeholder="client@company.ru — несколько через запятую" autocomplete="off"></label>
      <label class="f"><span>Копия</span><input type="text" id="mlCc" value="${esc(form.cc)}" autocomplete="off"></label>
      ${this._templates()}
      <label class="f"><span>Тема</span><input type="text" id="mlS" value="${esc(form.subject)}"></label>
      <label class="f"><span>Текст письма</span><textarea id="mlB" rows="9">${esc(form.body)}</textarea></label>
      <div class="ml-files"><span class="muted">Вложения:</span><label><input type="checkbox" id="mlW" checked><span>Word — ${esc(form.word)}</span></label>
        <label><input type="checkbox" id="mlP"${form.pdf ? ' checked' : ''}><span>PDF${form.pdf ? ` — ${esc(form.pdf)}` : ' (будет создан)'}</span></label>
        ${files}
        ${(form.files || []).length ? '<span class="muted ml-sum" id="mlSum"></span>' : ''}</div>
      ${sent}
      <p class="msg" id="mlMsg" hidden></p>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-send>Отправить</button></div>`;
  }

  static async _click({ modal, id, number, onSent }, target) {
    if (target.closest('[data-x]')) {
      modal.close();
      return;
    }
    const button = target.closest('[data-send]');
    if (!button) return;
    if (id === S.kpId && !(await PriceGuard.confirm('Отправить'))) return;
    const msg = modal.$('#mlMsg');
    button.disabled = true;
    button.textContent = 'Отправляю…';
    msg.hidden = true;
    try {
      const answer = await Api.request(`/api/kp/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(this._body(modal)),
      });
      const refused = answer.refused || [];
      Toast.show(
        refused.length
          ? `КП № ${number} отправлено, но почтовый сервер не принял: ${refused.join(', ')} — проверьте адрес`
          : `КП № ${number} отправлено: ${modal.$('#mlTo').value}`,
      );
      if (onSent) onSent(answer.track);
      modal.close();
      Reminders.load();
    } catch (error) {
      msg.hidden = false;
      msg.className = 'msg err';
      msg.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Отправить';
    }
  }

  static _body(modal) {
    return {
      to: modal.$('#mlTo').value,
      cc: modal.$('#mlCc').value,
      subject: modal.$('#mlS').value,
      body: modal.$('#mlB').value,
      word: modal.$('#mlW').checked,
      pdf: modal.$('#mlP').checked,
      files: [...modal.d.querySelectorAll('[data-mlf]:checked')].map(input => +input.dataset.mlf),
    };
  }
}
