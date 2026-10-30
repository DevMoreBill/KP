import { $ } from '../../core/util.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { DefRegistry } from '../../core/defaults.js';
import { Api } from '../../core/net.js';
import { Str } from '../../core/str.js';
import { KpForm } from '../../core/kp-form.js';
/** ИНН: контрольные суммы (10 цифр — организация, 12 — ИП). */
export class Inn {
  static W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  static W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  static W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  static ORG = 10;
  static PERSON = 12;
  static MOD = 11;
  static DIGIT = 10;

  static _sum(digits, weights) {
    return (weights.reduce((total, weight, index) => total + weight * +digits[index], 0) % this.MOD) % this.DIGIT;
  }

  /**
   * ИНН верный.
   * @param {string} value
   * @returns {boolean}
   */
  static valid(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === this.ORG) return this._sum(digits, this.W10) === +digits[this.ORG - 1];
    if (digits.length === this.PERSON) {
      return (
        this._sum(digits, this.W11) === +digits[this.PERSON - 2] &&
        this._sum(digits, this.W12) === +digits[this.PERSON - 1]
      );
    }
    return false;
  }

  /**
   * Только цифры.
   * @param {string} value
   * @returns {string}
   */
  static digits(value) {
    return String(value || '').replace(/\D/g, '');
  }
}

/**
 * Название клиента в КП — краткое наименование из выписки как есть (регистр и кавычки не меняются). Если краткого нет
 * и пришло полное — сокращается только организационно-правовая форма.
 */
export class OrgName {
  static FORMS = [
    [/^ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ\s*/i, 'ООО'],
    [/^ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i, 'ПАО'],
    [/^НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i, 'АО'],
    [/^АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i, 'АО'],
    [/^ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i, 'ЗАО'],
    [/^ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i, 'ОАО'],
    [/^ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ\s*/i, 'ИП'],
    [/^ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i, 'ФГУП'],
    [/^МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i, 'МУП'],
    [/^ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i, 'ГУП'],
  ];

  /**
   * Краткое название.
   * @param {string} name
   * @returns {string}
   */
  static short(name) {
    const text = String(name || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return text;
    const form = this.FORMS.find(([pattern]) => pattern.test(text));
    return form ? `${form[1]} ${text.replace(form[0], '')}` : text;
  }
}

/**
 * Получатель КП: «Сменить клиента» и копия КП из журнала — реквизиты, проверка, контакт и объект прежнего клиента не
 * должны перейти в новое КП (иначе в документе остаются чужие ИНН и «Вниманию»).
 */
export class ClientFields {
  static LISTS = { 'obj.purposes': () => ClientFields.PURPOSES };
  // назначения объекта — список «Назначение объекта» в «Настройках → Списки и выборы»
  static PURPOSES = [
    'Резервное электроснабжение',
    'Основной источник питания',
    'Строительная площадка',
    'Котельная',
    'Производство',
    'Сжатый воздух для производства',
    'Водоснабжение / водоотведение',
  ];

  /**
   * Очистить получателя. Сделку не трогает, но помнит, для какого клиента она выбрана (ClientFields.settleDeal).
   * @param {object} state КП
   */
  static clear(state) {
    if (state.dealId && state.dealId !== 'new' && !state._dealFor)
      state._dealFor = { id: state.dealId, ...this._who(state) };
    Object.assign(state, {
      client: '',
      clientId: '',
      clientInn: '',
      clientKpp: '',
      clientOgrn: '',
      clientFull: '',
      clientAddr: '',
      clientDir: '',
      clientDirPost: '',
      clientStatus: '',
      clientSrc: '',
      check: null,
      _clEdit: false,
      _clManual: false,
      _lastInn: '',
    });
    state.contact = { name: '', post: '', phone: '', email: '' };
    state.object = { purpose: '', address: '' };
  }

  /**
   * Перед сохранением КП: после «Копии» или «Сменить клиента» сделка прежнего клиента у другого клиента не остаётся
   * (тот же ИНН или то же название — остаётся; клиент ещё не выбран — решение откладывается).
   * @param {object} state КП
   */
  static settleDeal(state) {
    const was = state._dealFor;
    const who = this._who(state);
    if (!was || !(who.inn || who.name)) return;
    delete state._dealFor;
    const same = (was.inn && was.inn === who.inn) || (was.name && was.name === who.name);
    if (state.dealId === was.id && !same) delete state.dealId;
  }

  static _who(state) {
    return { inn: String(state.clientInn || '').replace(/\D/g, ''), name: Str.norm(state.client) };
  }
}

/**
 * Справочник контрагентов не грузится целиком (их тысячи): CLIENTS — последние использованные и найденные, поиск идёт
 * на сервере; CLIENTS_ALL — сколько всего в справочнике.
 */
export class ClientStore {
  // сколько клиентов в справочнике
  static total = 0;
  // последние использованные и найденные клиенты (поиск — на сервере)
  static list = [];
  static FIRST = 50;
  /** реквизиты КП ← поле записи справочника и ответа реестра */
  static FIELDS = [
    ['client', 'name'],
    ['clientFull', 'full'],
    ['clientInn', 'inn'],
    ['clientKpp', 'kpp'],
    ['clientOgrn', 'ogrn'],
    ['clientAddr', 'address'],
    ['clientDir', 'director'],
    ['clientDirPost', 'directorPost'],
    ['clientStatus', 'status'],
    ['clientSrc', 'source'],
  ];

  /**
   * Реквизиты из записи справочника или ответа реестра — полями КП (пустые — '').
   * @param {object} source
   * @param {string[][]} [fields] пары [поле КП, поле записи]
   * @returns {object}
   */
  static fields(source, fields = this.FIELDS) {
    return Object.fromEntries(fields.map(([key, from]) => [key, source[from] || '']));
  }
  /** клиенты, которые уже запрашивались с сервера по одному */
  static fetched = new Set();

  /** Последние использованные клиенты. */
  static async load() {
    try {
      const answer = await Api.request(`/api/clients?limit=${this.FIRST}`);
      ClientStore.list = answer.items || [];
      ClientStore.total = answer.all ?? ClientStore.list.length;
    } catch {
      ClientStore.list = [];
    }
  }

  /**
   * Запомнить клиентов (новые — в конец, известные — заменить).
   * @param {object[]} list
   */
  static keep(list) {
    for (const client of list || []) {
      if (!client || !client.id) continue;
      const index = ClientStore.list.findIndex(row => row.id === client.id);
      if (index < 0) ClientStore.list.push(client);
      else ClientStore.list[index] = client;
    }
  }

  /**
   * Клиент по коду (из памяти или с сервера).
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  static async byId(id) {
    if (!id) return null;
    const have = ClientStore.list.find(client => client.id === id);
    if (have) return have;
    try {
      const client = await Api.request(`/api/clients/${encodeURIComponent(id)}`);
      this.keep([client]);
      return client;
    } catch {
      return null;
    }
  }

  /**
   * Поиск в справочнике.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<object[]>}
   */
  static async find(query, limit) {
    try {
      const answer = await Api.request(
        `/api/clients?limit=${Math.round(limit || DefRegistry.num('kp.clientSuggest', 6))}&q=${encodeURIComponent(query)}`,
      );
      this.keep(answer.items);
      return answer.items || [];
    } catch {
      return [];
    }
  }

  static _idOf() {
    const inn = Inn.digits(S.clientInn);
    if (inn) return `inn${inn}`;
    return S.clientId || `c${Date.now().toString(36)}`;
  }

  /**
   * Клиент текущего КП; нет среди загруженных — подгружается с сервера один раз, затем форма перерисовывается.
   * @returns {object|null}
   */
  static current() {
    const id = S.clientId || (S.clientInn ? `inn${Inn.digits(S.clientInn)}` : '');
    if (!id) return null;
    const client = ClientStore.list.find(row => row.id === id);
    if (client) return client;
    if (!this.fetched.has(id)) {
      this.fetched.add(id);
      this.byId(id).then(found => {
        if (found) KpForm.render();
      });
    }
    return null;
  }

  /**
   * Записать клиента КП в справочник.
   * @returns {Promise<object|null>}
   */
  static save() {
    return this._save({ usedInKp: false });
  }

  /**
   * То же при сохранении КП: контакты накапливаются, отметка «был в КП».
   * @returns {Promise<object|null>}
   */
  static saveUsed() {
    return this._save({ usedInKp: true });
  }

  static async _save({ usedInKp }) {
    if (!S.client.trim()) return null;
    const id = this._idOf();
    S.clientId = id;
    try {
      const isNew = !ClientStore.list.some(row => row.id === id);
      const saved = await Api.request(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(this._record(id, usedInKp)),
      });
      this.keep([saved]);
      if (isNew && !this.fetched.has(id)) ClientStore.total++;
      return saved;
    } catch (error) {
      Toast.show(`Контрагент не сохранён: ${error.message}`);
      return null;
    }
  }

  static _record(id, usedInKp) {
    return {
      id,
      name: S.client.trim(),
      full: S.clientFull,
      inn: S.clientInn,
      kpp: S.clientKpp,
      ogrn: S.clientOgrn,
      address: S.clientAddr,
      director: S.clientDir,
      directorPost: S.clientDirPost,
      status: S.clientStatus,
      source: S.clientSrc || '',
      usedAt: new Date().toISOString(),
      contacts: S.contact.name ? [{ ...S.contact }] : [],
      objects: S.object.purpose || S.object.address ? [{ ...S.object }] : [],
      check: S.check || null,
      _usedInKp: usedInKp,
    };
  }

  /**
   * Подставить клиента из справочника в КП.
   * @param {object} client
   */
  static apply(client) {
    // своя копия проверки у каждого КП: правка одного не трогает другое открытое
    const check = client.check ? JSON.parse(JSON.stringify(client.check)) : null;
    Object.assign(S, { clientId: client.id, ...this.fields(client), check });
    if (client.contacts && client.contacts[0] && !S.contact.name) S.contact = { ...S.contact, ...client.contacts[0] };
    S._clEdit = false;
    S._clManual = false;
    KpForm.render();
    KpState.persist();
    Toast.show(`Контрагент подставлен: ${client.name || ''}`);
  }
}

/** Реквизиты по ИНН из реестра (ФНС, DaData, Checko) — в КП и справочник. */
export class PartyFind {
  static FIELDS = ClientStore.FIELDS.filter(([key]) => key !== 'client' && key !== 'clientInn');

  /** Найти организацию по ИНН текущего КП. */
  static async run() {
    const inn = Inn.digits(S.clientInn);
    if (!Inn.valid(inn)) {
      Toast.show('Проверьте ИНН: 10 цифр у организации, 12 — у ИП');
      return;
    }
    const opened = S;
    const known = await ClientStore.byId(`inn${inn}`);
    const msg = $('#partyMsg');
    if (msg) msg.textContent = 'Ищу организацию…';
    try {
      const answer = await Api.request(`/api/party?inn=${inn}`);
      if (S !== opened) return;
      if (answer.error) {
        this._failed(answer.error, known, msg);
        return;
      }
      this._fill(answer, inn, known);
    } catch (error) {
      if (msg) msg.textContent = `Ошибка запроса: ${error.message}`;
    }
  }

  static _failed(error, known, msg) {
    if (known) {
      ClientStore.apply(known);
      return;
    }
    if (!msg) return;
    msg.textContent = error;
    msg.classList.add('bad-t');
  }

  static _fill(party, inn, known) {
    Object.assign(S, { clientInn: party.inn || inn, ...ClientStore.fields(party, this.FIELDS) });
    S.client = OrgName.short(party.short || party.full || S.client);
    const contact = known && known.contacts && known.contacts[0];
    if (contact && !S.contact.name) S.contact = { ...S.contact, ...contact };
    S.clientId = `inn${party.inn || inn}`;
    S._clManual = false;
    KpForm.render();
    KpState.persist();
    Toast.show(`Реквизиты заполнены (${party.source || ''})`);
    ClientStore.save();
    if (party.active === false) Toast.show(`Внимание: организация не действует — ${party.status || ''}`);
  }
}
