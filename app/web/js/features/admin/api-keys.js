import { PartyCheck } from '../kp/party-check.js';
import { LgState } from '../deal/lg-state.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { CarrierApis } from './carrier-apis.js';
import { KeyBackup } from './key-backup.js';

/** Ключи API — форма прямо в «Настройки → Ключи API». Ключи на сервере; в браузер приходит только маска. */
export class ApiKeys {
  static GROUPS = [
    [
      'Контрагенты',
      'Реквизиты по ИНН подтягиваются и без ключей — из открытого сервиса ФНС (egrul.nalog.ru), бухотчётность — из ГИР БО ФНС (тоже без ключа). С ключами данные полнее и быстрее, а Checko ещё и проверяет контрагента: суды, ФССП, налоги, реестры. Резерв для Checko — OFData (тот же формат данных). Rusprofile открывается кнопкой в проверке: открытого API у него нет, ключ не нужен.',
      [
        {
          id: 'checkoKey',
          on: 'checko',
          mask: 'checkoMask',
          t: 'API-ключ Checko',
          ph: 'Ключ из личного кабинета checko.ru → API',
          h: 'Карточка, суды, ФССП, налоги, реестры (бухотчётность — бесплатно из ГИР БО). Запросы Checko тратятся только на проверки.',
        },
        { daily: 'checkoDaily', name: 'Checko', on: 'checko', q: 'main' },
        {
          id: 'ofdataKey',
          on: 'ofdata',
          mask: 'ofdataMask',
          t: 'API-ключ OFData — резерв Checko',
          ph: 'Ключ из личного кабинета ofdata.ru → API',
          h: 'Необязательно. Тот же формат данных, что у Checko, свои 100 бесплатных запросов в сутки: проверка идёт через OFData, когда у Checko кончился лимит, нет ключа или он не ответил; недостающее (суды, ФССП) OFData добирает за Checko.',
        },
        { daily: 'ofdataDaily', name: 'OFData', on: 'ofdata', q: 'reserve' },
        {
          id: 'dadataKey',
          on: 'dadata',
          mask: 'dadataMask',
          t: 'API-ключ DaData',
          ph: 'Ключ из личного кабинета dadata.ru',
          h: 'Быстрый поиск реквизитов по ИНН (бесплатно до 10 000 запросов в день).',
        },
      ],
    ],
    [
      'Доставка по России — цены перевозчиков',
      'Без ключа считают ПЭК и ЖелДорЭкспедиция (она же — крупногабаритный груз и длинномеры); Энергия — с токеном разработчика (без него — по старому открытому API, который Энергия сворачивает). Остальные перевозчики подключаются ключом — их цены появятся во вкладке «Логистика» сделки. В итог идёт максимальное предложение со сноской-источником.',
      [
        {
          id: 'atiToken',
          on: 'ati',
          mask: 'atiMask',
          t: 'ATI.SU — «API Средних ставок»',
          ph: 'ati.su → Профиль → API → токен',
          h: 'Отдельная машина: средние ставки по направлению (верхняя граница) и автообновление ставок за км. Платная лицензия.',
        },
        {
          id: 'dellinKey',
          on: 'dellin',
          mask: 'dellinMask',
          t: 'Деловые Линии (appkey)',
          ph: 'dev.dellin.ru → регистрация → ключ приложения',
          h: 'Сборный груз, бесплатно.',
        },
        {
          id: 'kitToken',
          on: 'kit',
          mask: 'kitMask',
          t: 'КИТ — токен',
          ph: 'tk-kit.ru → личный кабинет → «Разработчикам» → «Получение ключа API»',
          h: 'Сборный груз, дверь в дверь (тариф «Стандарт»). Лимит запросов — на каждый токен.',
        },
        {
          id: 'cdekId',
          on: 'cdek',
          mask: 'cdekIdMask',
          t: 'СДЭК — идентификатор (Account)',
          ph: 'lk.cdek.ru → Интеграция → Account',
          h: 'Нужен договор со СДЭК. Ключи выдаются в личном кабинете: «Интеграция → Создать ключ».',
        },
        {
          id: 'cdekSecret',
          on: 'cdek',
          mask: 'cdekSecretMask',
          t: 'СДЭК — секретный ключ (Secure password)',
          ph: 'lk.cdek.ru → Интеграция → Secure password',
          h: 'Считается тариф «дверь — дверь» (самый дешёвый из доступных).',
          secret: true,
        },
        {
          id: 'nrgToken',
          on: 'nrg',
          mask: 'nrgMask',
          t: 'Энергия — токен разработчика',
          ph: 'nrg-tk.ru → личный кабинет → токен разработчика (или ek@5team.tech)',
          h: 'Сборный груз, забор и доставка, надбавка за негабарит. Расчёт по API v4 Энергии.',
        },
        {
          id: 'vozovozToken',
          on: 'vozovoz',
          mask: 'vozovozMask',
          t: 'Возовоз — токен',
          ph: 'vozovoz.ru → личный кабинет → API',
          h: 'Сборный груз, бесплатно после регистрации.',
        },
      ],
    ],
    [
      'Документы',
      '',
      [
        {
          id: 'convertapiKey',
          on: 'convertapi',
          mask: 'convertapiMask',
          t: 'ConvertAPI для PDF',
          ph: 'Secret или токен из личного кабинета convertapi.com',
          h: 'Нужен, только если на компьютере, где работает программа, нет Microsoft Word и LibreOffice.',
        },
      ],
    ],
  ];
  static DAILY = { checkoDaily: 'Лимит Checko в день', ofdataDaily: 'Лимит OFData в день' };
  static FREE_DAILY = 100;
  static URL_LIFE_MS = 5000;

  // лимит запросов в день: у Checko — с остатком и очередью, у OFData — с остатком резерва
  static _daily(field, keys) {
    const quota = keys.quota || {};
    const own = field.q === 'reserve' ? quota.reserve || {} : quota;
    const info =
      keys[field.on] && own.limit
        ? ` <b class="muted">сегодня ${own.used} из ${own.limit}${field.q === 'main' && quota.queue ? ` · в очереди: ${quota.queue}` : ''}</b>`
        : '';
    const help =
      field.q === 'reserve'
        ? 'Бесплатно — 100 в сутки. Расходуется, только когда у Checko не хватает запросов или он не ответил.'
        : 'Бесплатно — 100 в календарный день (по Москве), полная проверка — 3 запроса. Когда лимит кончается, проверка идёт через OFData (если задан ключ), иначе — краткая или бесплатная по ФНС, а полная — на следующий день.';
    return `<div class="key-f"><label class="f"><span>Лимит ${esc(field.name)}, запросов в день${info}</span><input type="number" data-kday="${esc(field.daily)}" min="1" max="100000" step="1" value="${esc(keys[field.daily] || this.FREE_DAILY)}"></label>
      <p class="muted">${esc(help)}</p></div>`;
  }

  static _state(field, keys) {
    if (keys[field.mask]) return `<b class="ok-t">задан: ${esc(keys[field.mask])}</b>`;
    const cdekHalf =
      field.on && keys[field.on] === false && field.id.startsWith('cdek') && (keys.cdekIdMask || keys.cdekSecretMask);
    return cdekHalf ? '<b class="warn-t">нужны оба ключа</b>' : '';
  }

  static _field(field, keys) {
    if (field.daily) return this._daily(field, keys);
    return `<div class="key-f"><div class="key-row"><label class="f"><span>${esc(field.t)} ${this._state(field, keys)}</span>
      <input type="${field.secret ? 'password' : 'text'}" data-key="${field.id}" placeholder="${esc(keys[field.mask] ? 'Новый ключ — заменит текущий' : field.ph)}" autocomplete="off"></label>
      ${keys[field.mask] ? `<button class="btn ghost sm" type="button" data-kdel="${field.id}" title="Удалить ключ">Удалить</button>` : ''}</div>${field.h ? `<p class="muted">${esc(field.h)}</p>` : ''}</div>`;
  }

  static _fields() {
    return {
      fields: this.GROUPS.flatMap(group => group[2]).filter(field => field.id),
      daily: this.DAILY,
    };
  }

  static _importHtml(keys) {
    return KeyBackup.importHtml(keys, this._fields());
  }

  /**
   * Нарисовать вкладку ключей и оживить её.
   * @param {HTMLElement} host
   */
  static async form(host) {
    let keys = {};
    try {
      keys = await Api.request('/api/integrations');
    } catch {
      // без ответа — пустая форма
    }
    const carriers = await CarrierApis.card();
    host.innerHTML = this._groups(keys, carriers) + this._backup(keys) + this._bar();
    const ctx = { host, keys };
    host.querySelector('#kFile').onchange = event => this._file(ctx, event.target);
    host.oninput = event => {
      const input = event.target.closest('[data-caf]');
      if (input) input.parentElement.querySelector('[data-careset]').disabled = !input.value.trim();
    };
    host.onclick = event => this._click(ctx, event);
    host.onkeydown = event => this._key(host, event);
  }

  static _groups(keys, carriers) {
    return this.GROUPS.map(
      ([title, help, fields]) =>
        `<div class="st-card"><p class="sub">${esc(title)}</p>${help ? `<p class="muted">${esc(help)}</p>` : ''}<div class="key-grid">${fields.map(field => this._field(field, keys)).join('')}</div></div>${title.startsWith('Доставка') ? carriers : ''}`,
    ).join('');
  }

  static _backup(keys) {
    return `<div class="st-card"><p class="sub">Резервная копия ключей</p>
        <p class="muted">Файл со всеми ключами — чтобы перенести их на другой компьютер или восстановить после переустановки. С паролем файл зашифрован (AES-256): без пароля ключи из него не прочитать. Без пароля храните файл как пароль — в нём ключи открытым текстом; не выкладывайте его в репозиторий, почту и общие папки.</p>
        <div class="row key-bk"><label class="f"><span>Пароль для файла (необязательно)</span><input type="password" data-kpw autocomplete="new-password" placeholder="${KeyBackup.crypto ? 'пароль копии' : 'шифрование доступно только при входе через localhost или https'}"${KeyBackup.crypto ? '' : ' disabled'}></label>
          <button class="btn" type="button" data-kexp>Скачать копию ключей</button><button class="btn ghost" type="button" data-kimp>Загрузить из копии…</button><input type="file" id="kFile" accept=".json,application/json" hidden></div>
        <div id="kImp">${KeyBackup.file ? this._importHtml(keys) : ''}</div></div>`;
  }

  static _bar() {
    return '<div class="st-card key-bar"><span class="muted key-note">Ключи хранятся только на компьютере, где работает программа (в папке данных).</span><span class="sp"></span><button class="btn primary" type="button" data-ksave>Сохранить ключи</button></div>';
  }

  static async _put(host, body) {
    try {
      await Api.request('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      Toast.show('Сохранено');
      LgState.status = null;
      PartyCheck.quota = null;
      this.form(host);
    } catch (error) {
      Toast.show(`Не сохранилось: ${error.message || error}`);
    }
  }

  static async _file({ host, keys }, input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!json || json.kind !== 'kp-keys' || !(json.keys || json.enc))
        throw new Error('это не копия ключей программы');
      KeyBackup.file = { name: file.name, at: json.at, keys: json.keys || null, enc: json.enc || null, err: '' };
    } catch (error) {
      Toast.show(`Файл не подходит: ${error.message || error}`);
      return;
    }
    host.querySelector('#kImp').innerHTML = this._importHtml(keys);
    host.querySelector('#kImp [data-kipw]')?.focus();
  }

  static _ACTIONS = [
    ['[data-kdel]', (ctx, button) => ApiKeys._put(ctx.host, { [button.dataset.kdel]: '' })],
    ['[data-kimp]', ctx => ctx.host.querySelector('#kFile').click()],
    ['[data-kexp]', ctx => ApiKeys._export(ctx.host)],
    [
      '[data-kix]',
      ctx => {
        KeyBackup.file = null;
        ctx.host.querySelector('#kImp').innerHTML = '';
      },
    ],
    ['[data-kidec]', ctx => ApiKeys._decrypt(ctx)],
    ['[data-kiok]', ctx => ApiKeys._restore(ctx.host)],
    ['[data-ksave]', ctx => ApiKeys._save(ctx)],
  ];

  static async _click(ctx, event) {
    if (await CarrierApis.click(event, ctx.host)) return;
    for (const [selector, act] of this._ACTIONS) {
      const button = event.target.closest(selector);
      if (button) {
        act(ctx, button);
        return;
      }
    }
  }

  static async _export(host) {
    try {
      const json = await Api.request('/api/integrations/export');
      const password = (host.querySelector('[data-kpw]') || {}).value || '';
      const out = password
        ? { kind: 'kp-keys', v: 1, at: json.at, enc: await KeyBackup.encrypt(JSON.stringify(json.keys), password) }
        : json;
      const count = Object.keys(json.keys || {}).filter(name => !this.DAILY[name]).length;
      if (!count) {
        Toast.show('Ключей пока нет — нечего сохранять');
        return;
      }
      this._download(out, `ключи-API-${(json.at || '').slice(0, 10)}${password ? '-зашифровано' : ''}.json`);
      Toast.show(
        `Копия сохранена: ${count} ${KPGen.plural(count, 'ключ', 'ключа', 'ключей')}${password ? ', зашифровано паролем' : ''}`,
      );
    } catch (error) {
      Toast.show(`Не получилось: ${error.message || error}`);
    }
  }

  static _download(data, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), this.URL_LIFE_MS);
  }

  static async _decrypt({ host, keys }) {
    const password = host.querySelector('[data-kipw]').value;
    try {
      KeyBackup.file.keys = JSON.parse(await KeyBackup.decrypt(KeyBackup.file.enc, password));
      KeyBackup.file.err = '';
    } catch {
      KeyBackup.file.err = 'Пароль не подходит';
    }
    host.querySelector('#kImp').innerHTML = this._importHtml(keys);
  }

  static _restore(host) {
    const body = {};
    host.querySelectorAll('[data-kik]:checked').forEach(box => {
      body[box.dataset.kik] = KeyBackup.file.keys[box.dataset.kik];
    });
    if (!Object.keys(body).length) {
      Toast.show('Не выбрано, что восстановить');
      return;
    }
    KeyBackup.file = null;
    this._put(host, body);
  }

  static _save({ host, keys }) {
    const body = {};
    host.querySelectorAll('[data-key]').forEach(input => {
      const value = input.value.trim();
      if (value) body[input.dataset.key] = value;
    });
    host.querySelectorAll('[data-kday]').forEach(input => {
      const limit = +input.value;
      const id = input.dataset.kday;
      if (limit > 0 && limit !== (keys[id] || this.FREE_DAILY)) body[id] = limit;
    });
    if (!Object.keys(body).length) {
      Toast.show('Нечего сохранять — введите ключ');
      return;
    }
    this._put(host, body);
  }

  static _key(host, event) {
    if (event.key !== 'Enter') return;
    if (event.target.matches('[data-caf]')) {
      event.preventDefault();
      CarrierApis.save(host);
      return;
    }
    if (event.target.matches('[data-key],[data-kday]')) {
      event.preventDefault();
      host.querySelector('[data-ksave]').click();
    }
  }
}
