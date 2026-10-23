import { FEAT } from '../../core/features.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * «Заполнить из письма или ТЗ» в окне «Новая сделка»: вставленный текст или файл (PDF, Word, Excel, TXT, письмо .eml)
 * разбирает сервер — клиент, контакт, тема, суть, модели каталога; поля окна заполняются, менеджер проверяет и создаёт.
 */
export class DealIntakeView {
  static ACCEPT = '.eml,.pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.rtf,.txt';
  static found = null;

  /**
   * Раскрывашка над полями окна.
   * @returns {string}
   */
  static html() {
    this.found = null;
    if (!FEAT.on('intake')) return '';
    return `<details class="dk-mail"><summary>📩 Заполнить из письма или ТЗ</summary>
      <textarea name="mail" rows="4" maxlength="20000" placeholder="Вставьте текст письма клиента или ТЗ — программа найдёт клиента, контакт, суть и модели каталога"></textarea>
      <div class="row dk-mail-a"><button class="btn sm primary" type="button" data-dnparse>Разобрать</button><button class="btn sm" type="button" data-dnfile>Файл…</button><span class="muted">письмо .eml, PDF, Word, Excel, TXT</span></div>
      <div class="dk-mail-r" aria-live="polite"></div></details>`;
  }

  /**
   * Щелчки блока; true — щелчок был его.
   * @param {Event} event
   * @param {object} modal окно «Новая сделка»
   * @returns {boolean}
   */
  static click(event, modal) {
    if (event.target.closest('[data-dnparse]')) {
      const text = modal.$('[name=mail]').value.trim();
      if (!text) Toast.show('Вставьте текст письма или ТЗ');
      else
        this._run(modal, () =>
          this._post('/api/crm/intake', JSON.stringify({ text }), 'application/json; charset=utf-8'),
        );
      return true;
    }
    if (event.target.closest('[data-dnfile]')) {
      this._pick(file =>
        this._run(modal, () =>
          this._post(`/api/crm/intake?name=${encodeURIComponent(file.name)}`, file, 'application/octet-stream'),
        ),
      );
      return true;
    }
    return false;
  }

  static _pick(done) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (file) done(file);
    };
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }

  static _post(url, body, type) {
    return Api.request(url, { method: 'POST', headers: { 'Content-Type': type }, body });
  }

  static async _run(modal, request) {
    const box = modal.$('.dk-mail-r');
    box.innerHTML = '<p class="muted">Разбираю…</p>';
    try {
      this.found = await request();
    } catch (error) {
      box.innerHTML = `<p class="msg err">${esc(error.message)}</p>`;
      return;
    }
    this._fill(modal, this.found);
    box.innerHTML = this._result(this.found);
  }

  // поля окна: клиент (из справочника — названием, иначе ИНН — найдём в ФНС, иначе название), задача
  static _fill(modal, found) {
    const fields = modal.$('form').elements;
    const client = found.client || {};
    const value = client.known ? client.name : client.inn || client.name;
    if (value) fields.client.value = value;
    if (found.topic) fields.title.value = found.topic.slice(0, 200);
    if (!fields.task.value)
      fields.task.value = found.person ? `Позвонить: ${found.person}` : 'Позвонить, уточнить потребность';
    fields.client.dispatchEvent(new Event('input', { bubbles: true }));
  }

  static _result(found) {
    const client = found.client || {};
    const who = client.known
      ? `✓ ${esc(client.name)} — из справочника`
      : `${esc(client.name || 'название не найдено')}${client.inn ? ` · ИНН ${esc(client.inn)} — реквизиты из ФНС` : ''}`;
    const contact = [found.person, found.phone, found.email].filter(Boolean).map(esc).join(', ');
    const lines = [
      ['Клиент', who],
      ['Контакт', contact || '—'],
      ['Бренд', esc(found.brand || '—')],
    ];
    const models = (found.models || [])
      .map(
        row =>
          `<label class="ck"><input type="checkbox" name="dnmodel" value="${esc(row.id)}" checked> ${esc(row.name)}</label>`,
      )
      .join('');
    const pick = models
      ? `<div class="dk-mail-m"><span class="muted">Сразу в КП — модели из заявки:</span>${models}</div>`
      : '';
    const source = found.ai ? 'нейросеть и правила' : 'правила';
    return `<dl class="dk-mail-f">${lines.map(([label, text]) => `<dt>${label}</dt><dd>${text}</dd>`).join('')}</dl>${pick}<p class="muted">Нашли ${source}; проверьте поля ниже. Суть заявки и контакт сохранятся в сделке.</p>`;
  }

  /**
   * Что добавить к новой сделке: заметка (суть), поля Битрикс24, контакт.
   * @returns {object}
   */
  static extra() {
    const found = this.found;
    if (!found) return {};
    const contact = { name: found.person || '', phone: found.phone || '', email: found.email || '' };
    const reach = [contact.name, contact.phone, contact.email].filter(Boolean).join(', ');
    const note = [found.summary, reach && `Контакт: ${reach}`].filter(Boolean).join('\n\n');
    return { note: note.slice(0, 3000), uf: found.uf || {}, contact };
  }

  /**
   * Отмеченные модели каталога.
   * @param {HTMLFormElement} form
   * @returns {string[]}
   */
  static models(form) {
    return [...form.closest('dialog').querySelectorAll('[name=dnmodel]:checked')].map(box => box.value);
  }
}
