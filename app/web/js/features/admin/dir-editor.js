import { SettingsWindow } from './settings-window.js';
import { StDirty, StNav } from './settings-tools.js';
import { DealUi } from '../deal/deal-ui.js';
import { Managers } from '../kp/managers.js';
import { ClientStore, Inn } from '../kp/client-store.js';
import { Toast } from '../../core/toast.js';
import { Attrs } from '../../core/item-attrs.js';
import { CatFind, Catalog } from '../catalog/catalog-store.js';
import { $, Uid, esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { UiKit } from '../../core/ui-kit.js';
import { KpForm } from '../../core/kp-form.js';
import { AdminState } from './admin-state.js';

/** Значение по пути «a.b.0.c» в документе: прочитать, записать (недостающее создаётся — массив, если дальше номер). */
export class DocPath {
  static INDEX = /^\d+$/;

  /**
   * Прочитать.
   * @param {object} doc
   * @param {string} path
   * @returns {*}
   */
  static get(doc, path) {
    return path.split('.').reduce((node, key) => (node == null ? node : node[key]), doc);
  }

  /**
   * Записать.
   * @param {object} doc
   * @param {string} path
   * @param {*} value
   */
  static set(doc, path, value) {
    const keys = path.split('.');
    let node = doc;
    keys.slice(0, -1).forEach((key, i) => {
      if (node[key] == null) node[key] = this.INDEX.test(keys[i + 1]) ? [] : {};
      node = node[key];
    });
    node[keys[keys.length - 1]] = value;
  }
}

/**
 * Правка и добавление менеджеров, клиентов и поставщиков прямо в списке «Настроек». Поставщик: условия поставки, реквизиты
 * (по ИНН), склады с точным адресом (подставляются в «Логистике» → «Откуда»), контакты и оборудование.
 */
export class DirEditor {
  static FIELDS = {
    manager: [
      [
        'Контакты менеджера',
        [
          ['name', 'ФИО', { req: 1 }],
          ['position', 'Должность'],
          ['phone', 'Телефон'],
          ['ext', 'Добавочный'],
          ['mobile', 'Мобильный'],
          ['email', 'E-mail'],
          ['site', 'Сайт'],
          ['address', 'Адрес', { wide: 1 }],
          ['hours', 'Часы работы'],
        ],
      ],
    ],
    client: [
      [
        'Реквизиты',
        [
          ['inn', 'ИНН', { inn: 1 }],
          ['name', 'Краткое наименование', { req: 1 }],
          ['full', 'Полное наименование', { wide: 1 }],
          ['kpp', 'КПП'],
          ['ogrn', 'ОГРН'],
          ['status', 'Статус'],
          ['address', 'Юридический адрес', { wide: 1, geo: 1 }],
          ['director', 'Руководитель'],
          ['directorPost', 'Должность руководителя'],
        ],
      ],
      [
        'Контактное лицо',
        [
          ['contacts.0.name', 'ФИО'],
          ['contacts.0.post', 'Должность'],
          ['contacts.0.phone', 'Телефон'],
          ['contacts.0.email', 'E-mail'],
        ],
      ],
    ],
    supplier: [
      [
        'Поставщик и условия поставки',
        [
          ['name', 'Название', { req: 1 }],
          ['country', 'Страна'],
          ['cur', 'Валюта (RUB, USD, EUR, CNY)'],
          ['adv', 'Аванс поставщику, %'],
          ['prod', 'Срок изготовления, дней'],
          ['ship', 'Срок доставки, дней'],
          ['ins', 'Страхование, %'],
          ['fx', 'Комиссия за перевод, %'],
        ],
      ],
      [
        'Реквизиты',
        [
          ['req.inn', 'ИНН', { inn: 1 }],
          ['req.kpp', 'КПП'],
          ['req.ogrn', 'ОГРН'],
          ['req.full', 'Полное наименование', { wide: 1 }],
          ['req.address', 'Юридический адрес', { wide: 1, geo: 1 }],
          ['req.director', 'Руководитель'],
          ['req.directorPost', 'Должность руководителя'],
          ['req.bank', 'Банк'],
          ['req.bik', 'БИК'],
          ['req.account', 'Расчётный счёт'],
          ['req.corr', 'Корр. счёт'],
          ['req.phone', 'Телефон'],
          ['req.email', 'E-mail'],
          ['req.site', 'Сайт'],
        ],
      ],
    ],
  };

  static WAREHOUSE = [
    ['name', 'Склад'],
    ['addr', 'Адрес склада', { wide: 1, geo: 1 }],
    ['hours', 'Режим работы'],
    ['contact', 'Контакт на складе'],
    ['phone', 'Телефон'],
    ['note', 'Примечание (въезд, погрузка)', { wide: 1 }],
  ];
  static CONTACT = [
    ['name', 'ФИО'],
    ['post', 'Должность'],
    ['phone', 'Телефон'],
    ['email', 'E-mail'],
  ];
  static NEW = { manager: 'Новый менеджер', client: 'Новый клиент', supplier: 'Новый поставщик' };
  static KIND = { manager: 'Менеджер', client: 'Клиент', supplier: 'Поставщик' };
  static WAREHOUSE_ADDR = /^warehouses\.(\d+)\.addr$/;
  static ACTIONS = {
    cancel: '_cancel',
    export: '_export',
    add: '_add',
    del: '_delete',
    mk: '_maker',
    it: '_item',
    inn: '_inn',
    save: '_save',
  };
  static SUPPLIER_ID = 24;

  /**
   * Сравнимое написание производителя или позиции: строчные, ё → е, только буквы и цифры.
   * @param {string} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, '');
  }

  /**
   * Открыть редактор: id — запись из списка, null — новая.
   * @param {string} type manager | client | supplier
   * @param {string|null} id
   */
  static async open(type, id) {
    let source = {};
    if (id) {
      source = await this._load(type, id);
      if (!source) throw new Error('Запись не найдена');
    }
    const doc = JSON.parse(JSON.stringify(source || {}));
    if (type === 'supplier') this._supplierDefaults(doc);
    AdminState.editing = { type, id: id || null, doc, msg: '' };
  }

  static async _load(type, id) {
    if (type === 'manager') return (await Api.request('/api/managers')).find(row => row.id === id);
    if (type === 'client') return Api.request(`/api/clients/${encodeURIComponent(id)}`);
    return (await Api.request('/api/suppliers')).find(row => row.id === id);
  }

  static _supplierDefaults(doc) {
    doc.req = doc.req || {};
    doc.warehouses = doc.warehouses || [];
    doc.contacts = doc.contacts || [];
    doc.makers = doc.makers || [];
    doc.items = doc.items || [];
    if (doc.warehouses.length || !doc.wh) return;
    const geo =
      doc.whGeo && doc.whGeo.value === doc.wh ? { lat: doc.whGeo.lat, lon: doc.whGeo.lon, city: doc.whGeo.city } : {};
    doc.warehouses = [{ name: 'Основной склад', addr: doc.wh, ...geo }];
  }

  static _field(doc, [path, label, opts = {}], prefix = '') {
    const full = prefix + path;
    const value = DocPath.get(doc, full) ?? '';
    const control = opts.inn
      ? `<span class="st-inn"><input type="text" inputmode="numeric" data-ef="${full}" value="${esc(value)}" autocomplete="off"><button class="btn ghost sm" type="button" data-edx="inn" data-p="${full}" title="Заполнить реквизиты по ИНН (DaData / ФНС)">Заполнить по ИНН</button></span>`
      : `<input type="text" data-ef="${full}" value="${esc(value)}"${opts.geo ? ` data-geo="sted" placeholder="адрес — выберите из подсказок или вставьте координаты"` : ''} autocomplete="off">`;
    return `<label class="f${opts.wide ? ' wide' : ''}"><span>${esc(label)}${opts.req ? ' <b class="bad-t">*</b>' : ''}</span>${control}</label>`;
  }

  /**
   * Разметка открытого редактора.
   * @returns {string}
   */
  static html() {
    const edit = AdminState.editing;
    const doc = edit.doc;
    const type = edit.type;
    const sections = this.FIELDS[type]
      .map(
        ([title, fields]) =>
          `<div class="st-ed-sec"><p class="sub">${esc(title)}</p><div class="st-ed-g">${fields.map(field => this._field(doc, field)).join('')}</div></div>`,
      )
      .join('');
    const extra = type === 'supplier' ? this._supplier(doc) : '';
    const title = edit.id ? esc(`${this.KIND[type]}: ${doc.name || ''}`) : this.NEW[type];
    const exportBtn =
      type === 'supplier' && edit.id && doc.name
        ? `<button class="btn ghost" type="button" data-edx="export" title="Позиции этого поставщика без цен: копия с фото или Excel для правки">Выгрузить каталог…</button>`
        : '';
    return `<div class="st-ed-h"><b>${title}</b><span class="sp"></span>
      ${exportBtn}<button class="btn" type="button" data-edx="cancel">Отмена</button><button class="btn primary" type="button" data-edx="save">Сохранить</button></div>
    ${edit.msg ? `<p class="msg err">${esc(edit.msg)}</p>` : ''}${sections}${extra}
    <div class="st-ed-f"><span class="sp"></span><button class="btn" type="button" data-edx="cancel">Отмена</button><button class="btn primary" type="button" data-edx="save">Сохранить</button></div>`;
  }

  static _warehouse(doc, house, i) {
    let geo = '';
    if (house.lat != null) geo = '<span class="geo-ok">точный адрес ✓</span>';
    else if (house.addr) geo = '<span class="muted">адрес без координат — выберите из подсказок</span>';
    return `<div class="st-ed-item"><div class="st-ed-ih"><b>${esc(house.name || `Склад ${i + 1}`)}</b>${geo}<span class="sp"></span><button class="btn ghost sm" type="button" data-edx="del" data-l="warehouses" data-i="${i}">Удалить</button></div>
      <div class="st-ed-g">${this.WAREHOUSE.map(field => this._field(doc, field, `warehouses.${i}.`)).join('')}</div></div>`;
  }

  static _contact(doc, i) {
    return `<div class="st-ed-item"><div class="st-ed-g c4">${this.CONTACT.map(field => this._field(doc, field, `contacts.${i}.`)).join('')}<button class="btn ghost sm st-ed-x" type="button" data-edx="del" data-l="contacts" data-i="${i}" aria-label="Удалить контакт">✕</button></div></div>`;
  }

  static _supplier(doc) {
    const houses = doc.warehouses.map((house, i) => this._warehouse(doc, house, i)).join('');
    const contacts = doc.contacts.map((row, i) => this._contact(doc, i)).join('');
    return `<div class="st-ed-sec"><div class="sub">Склады — адрес отгрузки${UiKit.tip('Склады подставляются в «Экономике сделки» → «Логистика» → «Откуда — склад поставщика». Выберите адрес из подсказок (DaData или OpenStreetMap) или вставьте координаты / ссылку на точку из Google или Яндекс Карт — расстояние посчитается по дорогам.')}</div>
        ${houses || '<p class="muted">Складов нет.</p>'}<button class="btn ghost" type="button" data-edx="add" data-l="warehouses">+ Склад</button></div>
      <div class="st-ed-sec"><p class="sub">Контактные лица</p>${contacts || '<p class="muted">Контактов нет.</p>'}<button class="btn ghost" type="button" data-edx="add" data-l="contacts">+ Контакт</button></div>
      ${this._equipment(doc)}`;
  }

  static _equipment(doc) {
    const makers = [...new Set(Catalog.cache.map(card => Attrs.of(card).maker).filter(Boolean))].sort((first, second) =>
      first.localeCompare(second, 'ru'),
    );
    const byMaker = Catalog.cache.filter(card =>
      doc.makers.some(maker => this.norm(maker) === this.norm(Attrs.of(card).maker)),
    );
    const items = doc.items.map(id => CatFind.id(id) || { id, name: `${id} (нет в каталоге)` });
    const makerChips =
      doc.makers
        .map(
          (maker, i) =>
            `<span class="chip">${esc(maker)}<button type="button" data-edx="del" data-l="makers" data-i="${i}" aria-label="Убрать">✕</button></span>`,
        )
        .join('') || '<span class="muted">Производители не указаны</span>';
    const itemChips = items
      .map(
        (card, i) =>
          `<span class="chip">${esc(card.name)}<button type="button" data-edx="del" data-l="items" data-i="${i}" aria-label="Убрать">✕</button></span>`,
      )
      .join('');
    return `<div class="st-ed-sec"><div class="sub">Оборудование у этого поставщика${UiKit.tip('По производителям и позициям «Экономика сделки» сама относит позиции КП к этому поставщику и подставляет его условия и склад.')}</div>
        <div class="st-chips">${makerChips}</div>
        <div class="row st-ed-add"><input type="text" id="stEdMk" list="stEdMkL" placeholder="Производитель (бренд)" autocomplete="off"><datalist id="stEdMkL">${makers.map(maker => `<option value="${esc(maker)}">`).join('')}</datalist><button class="btn ghost" type="button" data-edx="mk">Добавить производителя</button></div>
        ${byMaker.length ? `<p class="muted">В каталоге у этих производителей: ${byMaker.length} ${KPGen.plural(byMaker.length, 'позиция', 'позиции', 'позиций')}.</p>` : ''}
        <div class="st-chips">${itemChips}</div>
        <div class="row st-ed-add"><input type="text" id="stEdIt" list="stEdItL" placeholder="Позиция каталога (если покупаете не всё у производителя)" autocomplete="off"><datalist id="stEdItL">${Catalog.cache.map(card => `<option value="${esc(card.name)}">`).join('')}</datalist><button class="btn ghost" type="button" data-edx="it">Добавить позицию</button></div></div>`;
  }

  /**
   * Нарисовать редактор в блоке.
   * @param {HTMLElement} box
   */
  static draw(box) {
    box.innerHTML = this.html();
  }

  /**
   * События редактора — на его контейнере .st-ed (новый при каждой отрисовке списка).
   * @param {HTMLElement} box
   * @param {Function} after после сохранения или отмены
   */
  static bind(box, after) {
    box.addEventListener('input', event => this._input(event.target));
    box.addEventListener('geo:pick', event => this._geo(box, event));
    box.addEventListener('keydown', event => this._enter(box, event));
    box.addEventListener('click', event => this._click(box, event, after));
  }

  static _input(target) {
    const edit = AdminState.editing;
    if (!edit || !target.dataset.ef) return;
    DocPath.set(edit.doc, target.dataset.ef, target.value);
    const match = target.dataset.ef.match(this.WAREHOUSE_ADDR);
    if (!match) return;
    const house = edit.doc.warehouses[+match[1]];
    if (house.geoFor !== target.value) {
      delete house.lat;
      delete house.lon;
    }
  }

  static _geo(box, event) {
    const target = event.target;
    const edit = AdminState.editing;
    if (!edit || !target.dataset.ef) return;
    const geo = event.detail;
    DocPath.set(edit.doc, target.dataset.ef, geo.value);
    const match = target.dataset.ef.match(this.WAREHOUSE_ADDR);
    if (!match) return;
    Object.assign(edit.doc.warehouses[+match[1]], { lat: geo.lat, lon: geo.lon, city: geo.city, geoFor: geo.value });
    this.draw(box);
  }

  static _enter(box, event) {
    if (event.key !== 'Enter' || !AdminState.editing) return;
    if (event.target.id === 'stEdMk') {
      event.preventDefault();
      box.querySelector('[data-edx=mk]').click();
    }
    if (event.target.id === 'stEdIt') {
      event.preventDefault();
      box.querySelector('[data-edx=it]').click();
    }
  }

  static async _click(box, event, after) {
    const button = event.target.closest('[data-edx]');
    if (!button || !AdminState.editing) return;
    event.preventDefault();
    const method = this.ACTIONS[button.dataset.edx];
    if (method) await this[method]({ box, button, after, edit: AdminState.editing, doc: AdminState.editing.doc });
  }

  static async _cancel({ after }) {
    if (!(await StDirty.leave())) return;
    AdminState.editing = null;
    after();
  }

  static async _export({ doc }) {
    if (!(await StDirty.leave())) return;
    StNav.sup = doc.name;
    AdminState.editing = null;
    StNav.select('backup');
    SettingsWindow.tab();
  }

  static _add({ box, button, doc }) {
    const list = button.dataset.l;
    doc[list].push(list === 'warehouses' ? { name: doc.warehouses.length ? '' : 'Основной склад' } : {});
    this.draw(box);
    const fields = [...box.querySelectorAll(`[data-ef^="${list}.${doc[list].length - 1}."]`)];
    fields[list === 'warehouses' ? 1 : 0]?.focus();
  }

  static _delete({ box, button, doc }) {
    doc[button.dataset.l].splice(+button.dataset.i, 1);
    this.draw(box);
  }

  static _maker({ box, doc }) {
    const value = $('#stEdMk').value.trim();
    if (!value) return;
    if (!doc.makers.some(maker => this.norm(maker) === this.norm(value))) doc.makers.push(value);
    this.draw(box);
    $('#stEdMk')?.focus();
  }

  static _item({ box, doc }) {
    const value = $('#stEdIt').value.trim();
    const card =
      Catalog.cache.find(row => row.name === value) ||
      Catalog.cache.find(row => this.norm(row.name) === this.norm(value));
    if (!card) {
      Toast.show('Такой позиции нет в каталоге');
      return;
    }
    if (!doc.items.includes(card.id)) doc.items.push(card.id);
    this.draw(box);
    $('#stEdIt')?.focus();
  }

  static async _inn({ box, button, doc }) {
    const path = button.dataset.p;
    const inn = String(DocPath.get(doc, path) || '').replace(/\D/g, '');
    if (!Inn.valid(inn)) {
      Toast.show('Проверьте ИНН: 10 цифр у организации, 12 — у ИП');
      return;
    }
    button.disabled = true;
    button.textContent = 'Ищу…';
    try {
      const party = await Api.request(`/api/party?inn=${inn}`);
      if (party.error) throw new Error(party.error);
      this._fillParty(doc, path.startsWith('req.') ? 'req.' : '', party);
      Toast.show(`Реквизиты заполнены: ${party.source || 'реестр'}`);
    } catch (error) {
      Toast.show(`Не нашли: ${error.message || error}`);
    }
    this.draw(box);
  }

  static _fillParty(doc, prefix, party) {
    const put = (key, value) => {
      if (value) DocPath.set(doc, prefix + key, value);
    };
    for (const key of ['inn', 'kpp', 'ogrn', 'full', 'address', 'director', 'directorPost']) put(key, party[key]);
    if (!prefix) {
      doc.name = doc.name || party.short;
      put('status', party.status);
      return;
    }
    put('phone', (party.phones || [])[0]);
    put('email', (party.emails || [])[0]);
    put('site', party.site);
    if (!String(doc.name || '').trim()) doc.name = party.short;
    if (!doc.country) doc.country = 'Россия';
  }

  static async _save({ box, after, edit, doc }) {
    if (!String(doc.name || '').trim()) {
      edit.msg = `${this.KIND[edit.type]}: заполните название`;
      this.draw(box);
      return;
    }
    try {
      await this.save(edit);
      AdminState.editing = null;
      Toast.show('Сохранено');
      after();
    } catch (error) {
      edit.msg = `Не сохранено: ${error.message || error}`;
      this.draw(box);
    }
  }

  static _put(path, rev, body) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      ...(rev != null ? { 'X-KP-Rev': String(rev) } : {}),
    };
    return Api.request(path, { method: 'PUT', headers, body: JSON.stringify(body) });
  }

  /**
   * Сохранить запись на сервере.
   * @param {object} edit {type, id, doc}
   */
  static async save(edit) {
    const doc = JSON.parse(JSON.stringify(edit.doc));
    const rev = doc._rev;
    for (const key of Object.keys(doc)) if (typeof doc[key] === 'string') doc[key] = doc[key].trim();
    if (edit.type === 'manager') {
      const id = edit.id || Uid.next() + Uid.next();
      await this._put(
        `/api/managers/${encodeURIComponent(id)}`,
        rev,
        Object.fromEntries(Managers.KEYS.map(key => [key, doc[key] ?? ''])),
      );
      Managers.load().then(() => KpForm.render());
      return;
    }
    if (edit.type === 'client') {
      await this._saveClient(edit, doc, rev);
      return;
    }
    await this._saveSupplier(edit, doc, rev);
  }

  static _filled(row) {
    return Object.values(row).some(value => String(value || '').trim());
  }

  static async _saveClient(edit, doc, rev) {
    const inn = String(doc.inn || '').replace(/\D/g, '');
    const id = edit.id || (inn ? `inn${inn}` : `c${Date.now().toString(36)}`);
    if (!edit.id && inn && (await ClientStore.byId(`inn${inn}`).catch(() => null))) {
      throw new Error(`клиент с ИНН ${inn} уже есть в справочнике — найдите его поиском`);
    }
    doc.contacts = (doc.contacts || []).filter(row => row && this._filled(row));
    delete doc._rev;
    doc.id = id;
    doc.source = doc.source || 'Настройки';
    doc._replace = true; // удалённый здесь контакт удаляется
    const saved = await this._put(`/api/clients/${encodeURIComponent(id)}`, rev, doc);
    if (saved) ClientStore.keep([saved]);
  }

  // склад по умолчанию — первый, с координатами — в «Откуда» логистики
  static async _saveSupplier(edit, doc, rev) {
    const id = edit.id || `sup_${Uid.next()}${Uid.next()}`.slice(0, this.SUPPLIER_ID);
    doc.warehouses = (doc.warehouses || [])
      .filter(house => Object.values(house).some(value => String(value ?? '').trim()))
      .map(house => {
        const copy = { ...house };
        delete copy.geoFor;
        return copy;
      });
    doc.contacts = (doc.contacts || []).filter(row => this._filled(row));
    const first = doc.warehouses.find(house => house.addr);
    if (first) {
      doc.wh = first.addr;
      doc.whGeo =
        first.lat != null
          ? {
              value: first.addr,
              lat: first.lat,
              lon: first.lon,
              city: first.city || '',
              exact: true,
              src: 'справочник поставщиков',
            }
          : null;
    }
    delete doc.id;
    delete doc.updatedAt;
    await this._put(`/api/suppliers/${encodeURIComponent(id)}`, rev, doc);
    DealUi.sups = null;
  }
}
