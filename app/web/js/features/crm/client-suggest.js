/**
 * Подсказка клиента под полем ввода: по названию, ИНН, телефону, e-mail или ФИО контакта (поиск — на сервере). Совпало по
 * контакту у нескольких компаний — список с пометкой, чем совпало, менеджер выбирает нужную.
 */
export class ClientSuggest {
  static WAIT_MS = 200;
  static LIMIT = 8;
  static MIN = 2;
  static _seq = 0;
  static _timer = 0;

  /**
   * Ввод в поле клиента: через паузу — список подходящих клиентов под полем.
   * @param {HTMLInputElement} input
   * @param {Function} onPick (client) — выбран клиент из списка
   */
  static run(input, onPick) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._find(input, onPick), this.WAIT_MS);
  }

  static async _find(input, onPick) {
    const text = input.value.trim();
    const seq = ++this._seq;
    if (text.length < this.MIN) {
      this.close(input);
      return;
    }
    const found = await ClientStore.find(text, this.LIMIT);
    if (seq !== this._seq || !input.isConnected) return;
    this._show(input, found, onPick);
  }

  static _show(input, found, onPick) {
    this.close(input);
    if (!found.length) return;
    const many = found.length > 1 && found.every(client => client.match);
    const rows = found.map((client, index) => this._row(client, index)).join('');
    const list = document.createElement('div');
    list.className = 'csg';
    list.setAttribute('role', 'listbox');
    list.innerHTML = `${many ? '<p class="csg-h">Этот контакт есть у нескольких компаний — выберите нужную:</p>' : ''}${rows}`;
    list.addEventListener('mousedown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const row = event.target.closest('[data-csg]');
      if (!row) return;
      this.close(input);
      onPick(found[+row.dataset.csg]);
    });
    input.insertAdjacentElement('afterend', list);
  }

  static _row(client, index) {
    const match = client.match ? `<i>${esc(ClientMatchText.of(client))}</i>` : '';
    const inn = client.inn ? `ИНН ${esc(client.inn)}` : 'без ИНН';
    return `<button type="button" role="option" data-csg="${index}"><b>${esc(client.name)}</b><span>${match}${match ? ' · ' : ''}${inn}</span></button>`;
  }

  /**
   * Убрать подсказку под полем.
   * @param {HTMLElement} input
   */
  static close(input) {
    const next = input.nextElementSibling;
    if (next && next.classList.contains('csg')) next.remove();
  }
}
