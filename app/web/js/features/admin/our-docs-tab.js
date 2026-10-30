import { Api } from '../../core/net.js';
import { IncomeTax } from '../../core/income-tax.js';
import { SellerTax } from '../../core/seller-tax.js';
import { Toast } from '../../core/toast.js';
import { Uid, esc } from '../../core/util.js';
import { UiKit } from '../../ui/ui-kit.js';

/**
 * «Настройки → Документы → Наши реквизиты»: юрлица продавца для счёта, спецификации и договора из КП и свои шаблоны Word
 * договора и спецификации с метками. Реквизиты хранятся только в базе программы.
 */
export class OurDocsTab {
  static FIELDS = [
    ['name', 'Наименование *', 'ООО «ПНЕВМОТЕХ»'],
    ['inn', 'ИНН', '10 или 12 цифр'],
    ['kpp', 'КПП', '9 цифр'],
    ['ogrn', 'ОГРН', '13 или 15 цифр'],
    ['address', 'Юридический адрес', ''],
    ['phone', 'Телефон', ''],
    ['bank', 'Банк', 'ПАО Сбербанк'],
    ['bik', 'БИК', '9 цифр'],
    ['account', 'Расчётный счёт', '20 цифр'],
    ['corr', 'Корр. счёт', '20 цифр'],
    ['director', 'Руководитель (ФИО)', 'Иванов И. И.'],
    ['directorPost', 'Должность руководителя', 'Генеральный директор'],
    ['accountant', 'Главный бухгалтер (ФИО)', ''],
  ];
  static KINDS = [
    ['contract', 'Договор', 'без шаблона договор не формируется'],
    ['spec', 'Спецификация', 'без шаблона — типовая'],
  ];
  static TAGS =
    '{номер} {дата} {номер_кп} {дата_кп} {покупатель} {покупатель_полное} {покупатель_инн} {покупатель_кпп} {покупатель_огрн} {покупатель_адрес} {покупатель_руководитель} {покупатель_должность} {продавец} {продавец_инн} {продавец_кпп} {продавец_огрн} {продавец_адрес} {продавец_банк} {продавец_бик} {продавец_счёт} {продавец_корсчёт} {продавец_руководитель} {продавец_должность} {сумма} {сумма_прописью} {ндс} {ставка_ндс} {валюта} {срок_поставки} {оплата} {адрес_поставки} {условия} {менеджер} {таблица}';

  static data = null;

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    main.innerHTML = '<p class="muted">Загружаю…</p>';
    try {
      this.data = await Api.request('/api/requisites');
    } catch (error) {
      main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    this._draw(main);
    main.onclick = event => this._click(main, event.target);
    main.onchange = event => this._change(main, event.target);
  }

  static _draw(main) {
    const items = this.data.items.map((item, index) => this._item(item, index)).join('');
    main.innerHTML = `<div class="st-card"><p class="sub">Наши юрлица — продавец в документах${UiKit.tip('<p>Счёт, спецификация и договор из КП (журнал → «⋯» → «Счёт, спецификация, договор…», окно «КП сохранено»). Менеджер выбирает юрлицо, «основное» стоит первым.</p><p>Реквизиты хранятся только в базе программы на сервере отдела.</p>')}</p>
      ${items || '<p class="muted">Юрлиц нет — добавьте своё, иначе документы из КП не формируются.</p>'}
      <div class="row"><button class="btn" type="button" data-od="add">＋ Юрлицо</button><button class="btn primary" type="button" data-od="save">Сохранить реквизиты</button></div></div>
      <div class="st-card"><p class="sub">Свои шаблоны Word${UiKit.tip(`<p>Документ Word (.docx) с метками в фигурных скобках — программа подставит данные КП. Абзац, где только <b>{таблица}</b>, заменяется таблицей товаров.</p><p>Метки: ${esc(this.TAGS)}</p><p>Метку набирайте целиком, без смены шрифта внутри скобок. Незнакомые метки программа оставит как есть и предупредит.</p>`)}</p>
      ${this.KINDS.map(kind => this._tpl(kind)).join('')}</div>`;
  }

  static _item(item, index) {
    const fields = this.FIELDS.map(
      ([key, label, hint]) =>
        `<label class="f"><span>${esc(label)}</span><input type="text" data-of="${key}" data-oi="${index}" value="${esc(item[key] || '')}" placeholder="${esc(hint)}" autocomplete="off"></label>`,
    ).join('');
    const main = item.id === this.data.main;
    return `<details class="od-item"${index === 0 || !item.name ? ' open' : ''}><summary><b>${esc(item.name || 'Новое юрлицо')}</b>${main ? ' <span class="badge">основное</span>' : ''}</summary>
      <div class="od-grid">${fields}${this._vat(item, index)}${this._usn(item, index)}</div>
      <div class="row">${main ? '' : `<button class="btn" type="button" data-od="main" data-oi="${index}">Сделать основным</button>`}<button class="btn ghost" type="button" data-od="drop" data-oi="${index}">Убрать</button></div></details>`;
  }

  static _options(list, value) {
    return list
      .map(([key, label]) => `<option value="${esc(key)}"${value === key ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
  }

  static _vat(item, index) {
    const tip = UiKit.tip(
      '<p>Ставка НДС в счёте и спецификации этого юрлица и вычет НДС в экономике сделки, где оно продавец.</p><p>Общие ставки (на ОСНО и, по выбору, на УСН) и экспорт 0 % — НДС поставщиков, ввоза и услуг к вычету. УСН с НДС 5 или 7 % и «без НДС» — вычета нет (НК РФ, ст. 170, п. 2): этот НДС остаётся в себестоимости сделки.</p>',
    );
    return `<label class="f"><span>НДС продавца${tip}</span><select data-of="vat" data-oi="${index}">${this._options(SellerTax.OPTIONS, item.vat || '')}</select></label>`;
  }

  // налог с результата сделки: ОСНО — налог на прибыль, УСН — объект и своя ставка региона
  static _usn(item, index) {
    const mode = IncomeTax.mode(item.usn);
    const tip = UiKit.tip(
      '<p>Каким налогом облагается результат сделки в экономике сделки, где это юрлицо продавец.</p><p>ОСНО — налог на прибыль с прибыли после всех расходов; ставка — в «Деньгах и налоге» сделки (по умолчанию 25 %). УСН «доходы» — с выручки без НДС, по закону 6 %; УСН «доходы минус расходы» — с прибыли, 15 % (НК РФ, ст. 346.20). Регион снизил ставку — впишите её в «Ставку УСН».</p><p>НДС 5 или 7 % — только при УСН.</p>',
    );
    const rate = IncomeTax.of(mode).rate;
    return `<label class="f"><span>Налог на прибыль или УСН${tip}</span><select data-of="usn" data-oi="${index}">${this._options(IncomeTax.options(), mode)}</select></label>
      <label class="f"><span>Ставка УСН, %</span><input type="text" inputmode="decimal" data-of="usnRate" data-oi="${index}" value="${esc(mode ? item.usnRate || '' : '')}" placeholder="${rate == null ? '—' : rate}" autocomplete="off"${mode ? '' : ' disabled'}></label>`;
  }

  // объект УСН сменили — ставка по закону для него, при ОСНО поле не нужно
  static _usnRate(select) {
    const input = select.closest('.od-grid').querySelector('[data-of="usnRate"]');
    const rate = IncomeTax.of(select.value).rate;
    input.placeholder = rate == null ? '—' : String(rate);
    input.disabled = rate == null;
    if (rate == null) {
      input.value = '';
      this.data.items[+select.dataset.oi].usnRate = '';
    }
  }

  static _tpl([kind, label, empty]) {
    const has = this.data.templates[kind];
    const state = has ? '<span class="ok-t">загружен</span>' : `<span class="muted">нет — ${esc(empty)}</span>`;
    return `<div class="st-row"><div><b>${esc(label)}</b> ${state}</div><div class="acts">
      <label class="btn">${has ? 'Заменить…' : 'Загрузить .docx…'}<input type="file" accept=".docx" data-otpl="${kind}" hidden></label>
      ${has ? `<a class="btn" href="/api/doctpl/${kind}" download>Скачать</a><button class="btn ghost" type="button" data-od="rm" data-ok="${kind}">Убрать</button>` : ''}</div></div>`;
  }

  static _change(main, target) {
    if (target.dataset.of) {
      this.data.items[+target.dataset.oi][target.dataset.of] = target.value;
      if (target.dataset.of === 'usn') this._usnRate(target);
      return;
    }
    if (target.dataset.otpl && target.files[0]) this._upload(main, target.dataset.otpl, target.files[0]);
  }

  static _ACTIONS = {
    add: () => {
      OurDocsTab.data.items.push({ id: Uid.next() });
      return true;
    },
    drop: button => {
      OurDocsTab.data.items.splice(+button.dataset.oi, 1);
      return true;
    },
    main: button => {
      OurDocsTab.data.main = OurDocsTab.data.items[+button.dataset.oi].id;
      return true;
    },
  };

  static async _click(main, target) {
    const button = target.closest('[data-od]');
    if (!button) return;
    const act = button.dataset.od;
    if (this._ACTIONS[act]) {
      if (this._ACTIONS[act](button)) this._draw(main);
      return;
    }
    if (act === 'save') await this._save(main);
    if (act === 'rm') await this._remove(main, button.dataset.ok);
  }

  static async _save(main) {
    try {
      const saved = await Api.request('/api/requisites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ items: this.data.items, main: this.data.main }),
      });
      this.data = saved;
      this._draw(main);
      Toast.show('Реквизиты сохранены');
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _upload(main, kind, file) {
    try {
      const answer = await Api.request(`/api/doctpl/${kind}`, { method: 'PUT', body: file });
      this.data.templates = answer.templates;
      this._draw(main);
      Toast.show('Шаблон загружен');
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _remove(main, kind) {
    try {
      const answer = await Api.request(`/api/doctpl/${kind}/remove`, { method: 'POST' });
      this.data.templates = answer.templates;
      this._draw(main);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }
}
