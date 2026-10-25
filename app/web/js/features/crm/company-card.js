import { FEAT } from '../../core/features.js';
import { Api } from '../../core/net.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { DealIntakeView } from './deal-intake.js';

/**
 * «Клиенты» → «📄 Из карточки предприятия»: вставленный текст или файл (PDF, Word, Excel, TXT) — сервер находит реквизиты
 * и сверяет ИНН с ФНС; менеджер проверяет поля и создаёт клиента.
 */
export class CompanyCardView {
  static FIELDS = [
    ['name', 'Наименование'],
    ['inn', 'ИНН'],
    ['kpp', 'КПП'],
    ['ogrn', 'ОГРН / ОГРНИП'],
    ['address', 'Адрес'],
    ['director', 'Руководитель'],
    ['phone', 'Телефон'],
    ['email', 'Почта'],
    ['bank', 'Банк'],
    ['bik', 'БИК'],
    ['account', 'Расчётный счёт'],
    ['corr', 'Корр. счёт'],
  ];

  /**
   * Кнопка в строке раздела «Клиенты» (функция выключена — пусто).
   * @returns {string}
   */
  static button() {
    return FEAT.on('reqParse')
      ? '<button class="btn sm" type="button" data-ccard>📄 Из карточки предприятия</button>'
      : '';
  }

  /**
   * Открыть окно.
   * @param {() => void} [after] после создания клиента
   */
  static open(after) {
    const modal = new Modal(this._html(), 'tk-dlg cc-dlg');
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) modal.close();
      else if (event.target.closest('[data-ccparse]')) this._parseText(modal);
      else if (event.target.closest('[data-ccfile]')) this._parseFile(modal);
    });
    modal.$('form').onsubmit = event => {
      event.preventDefault();
      this._create(modal, after);
    };
  }

  static _html() {
    const rows = this.FIELDS.map(
      ([key, label]) =>
        `<label class="f"><span>${esc(label)}</span><input type="text" name="${key}" maxlength="300"></label>`,
    ).join('');
    return `<div class="dlg-h"><h3>Клиент из карточки предприятия</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <textarea name="text" rows="4" maxlength="40000" placeholder="Вставьте текст карточки предприятия (реквизиты) или выберите файл — PDF, Word, Excel, TXT"></textarea>
      <div class="row"><button class="btn sm primary" type="button" data-ccparse>Распознать</button><button class="btn sm" type="button" data-ccfile>Файл…</button><span class="muted">скан без текста не читается</span></div>
      <div class="cc-r" aria-live="polite"></div>
      <form class="cc-f" hidden><div class="cc-fg">${rows}</div>
        <div class="row"><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="submit">Создать клиента</button></div></form>`;
  }

  static _parseText(modal) {
    const text = modal.$('[name=text]').value.trim();
    if (!text) {
      Toast.show('Вставьте текст карточки или выберите файл');
      return;
    }
    this._run(modal, () =>
      this._post('/api/companycard/parse', JSON.stringify({ text }), 'application/json; charset=utf-8'),
    );
  }

  static _parseFile(modal) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = DealIntakeView.ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (file)
        this._run(modal, () =>
          this._post(`/api/companycard/parse?name=${encodeURIComponent(file.name)}`, file, 'application/octet-stream'),
        );
    };
    input.addEventListener('cancel', () => input.remove());
    input.click();
  }

  static _post(url, body, type) {
    return Api.request(url, { method: 'POST', headers: { 'Content-Type': type }, body });
  }

  static async _run(modal, request) {
    const box = modal.$('.cc-r');
    box.innerHTML = '<p class="muted">Распознаю и проверяю ИНН в ФНС…</p>';
    let found;
    try {
      found = await request();
    } catch (error) {
      box.innerHTML = `<p class="msg err">${esc(error.message)}</p>`;
      return;
    }
    const form = modal.$('form');
    const fields = found.fields || {};
    const fns = found.fns || {};
    for (const [key] of this.FIELDS) form.elements[key].value = fields[key] || '';
    if (!fields.name && fns.short) form.elements.name.value = fns.short;
    if (!fields.address && fns.address) form.elements.address.value = fns.address;
    form.hidden = false;
    box.innerHTML = this._check(fns, found.warnings || []);
  }

  static _check(fns, warnings) {
    const name = fns.short || fns.full;
    const ok = name ? `<p class="ok-t">ФНС: ${esc(name)}${fns.status ? ` · ${esc(fns.status)}` : ''}</p>` : '';
    return ok + warnings.map(text => `<p class="msg warn">${esc(text)}</p>`).join('');
  }

  static async _create(modal, after) {
    const form = modal.$('form');
    const data = Object.fromEntries(this.FIELDS.map(([key]) => [key, form.elements[key].value.trim()]));
    try {
      const reply = await this._post(
        '/api/companycard/create',
        JSON.stringify(data),
        'application/json; charset=utf-8',
      );
      Toast.show(`Клиент «${reply.client.name}» сохранён в справочнике`);
      modal.close();
      if (after) after();
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }
}
