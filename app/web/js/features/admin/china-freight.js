import { SafeLink } from '../../core/safe-link.js';
import { ChinaRateBook } from './china-rates.js';
import { StDirty } from './settings-tools.js';
import { CopyText, FileSave } from '../../core/files.js';
import { Toast } from '../../core/toast.js';
import { Fmt } from '../../core/str.js';
import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';

/** «Доставка из Китая»: перевозка до места прибытия в ЕАЭС для таможенной стоимости (ТК ЕАЭС ст. 40) по ставкам экспедиторов. */
export class ChinaFreightTab {
  static data = null; // ответ сервера: виды, участки, единицы, валюты, места прибытия, ставки
  static query = {
    from: '',
    to: 'Забайкальск',
    dest: '',
    kind: 'ftl',
    kg: '',
    m3: '',
    terms: 'EXW',
    extraV: '',
    extraCur: 'CNY',
    insV: '',
    insCur: 'CNY',
  };
  static URL = '/api/logistics/china';
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static REF_DAYS = 30;
  static DAY_MS = 864e5;
  static ISO_DAY = 10;
  static ISO_MINUTE = 16;
  static FX_DIGITS = 10000;
  static BAD_SHOWN = 8;
  static FIELDS = {
    from: '#cfFrom',
    to: '#cfTo',
    dest: '#cfDest',
    kind: '#cfKind',
    kg: '#cfKg',
    m3: '#cfM3',
    terms: '#cfTerms',
  };
  static MORE = { extraV: '#cfExV', extraCur: '#cfExC', insV: '#cfInV', insCur: '#cfInC' };
  static CLICKS = [
    ['[data-cfadd]', '_addRow'],
    ['[data-cfref]', 'addRef'],
    ['[data-cftpl]', '_template'],
    ['[data-cfload]', '_pickFile'],
    ['[data-cfreq]', '_request'],
    ['[data-cfdel]', '_dropRow'],
    ['[data-cfsave]', '_save'],
    ['[data-cfgo]', '_quote'],
  ];

  /**
   * Варианты выбора.
   * @param {object} map код → название
   * @param {string} current
   * @returns {string}
   */
  static opts(map, current) {
    return Object.entries(map)
      .map(([key, title]) => `<option value="${esc(key)}"${key === current ? ' selected' : ''}>${esc(title)}</option>`)
      .join('');
  }

  /**
   * Валюты.
   * @param {string} current
   * @returns {string}
   */
  static curs(current) {
    return this.data.curs.map(cur => `<option${cur === current ? ' selected' : ''}>${esc(cur)}</option>`).join('');
  }

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    try {
      this.data = await Api.request(this.URL);
    } catch (error) {
      main.innerHTML = `<p class="msg err">${esc(error.message || error)}</p>`;
      return;
    }
    main.innerHTML = this._form() + this._rates();
    this.bind(main);
  }

  static _ati(state, dirs) {
    if (!state.ati) return ' (нужен ключ ATI.SU)';
    return state.atiError ? ` (ошибка: ${esc(state.atiError)})` : ` (направлений из Китая: ${dirs.length})`;
  }

  static _places(state) {
    const dirs = state.directions || [];
    const rows = state.rates.rows || [];
    const froms = [
      ...new Set([...dirs.map(dir => dir.from), ...rows.filter(row => row.scope !== 'after').map(row => row.from)]),
    ];
    const tos = [
      ...new Set([
        ...state.borders,
        ...dirs.map(dir => dir.to),
        ...rows.map(row => row.to),
        ...rows.filter(row => row.scope === 'after').map(row => row.from),
      ]),
    ];
    return { froms, tos };
  }

  static _form() {
    const state = this.data;
    const query = this.query;
    const dirs = state.directions || [];
    const { froms, tos } = this._places(state);
    return `<div class="st-card"><p class="sub">Доставка из Китая до места прибытия — для таможенной стоимости</p>
        <p class="muted">Перевозка, погрузка и страхование до места прибытия на территорию ЕАЭС входят в таможенную стоимость (ТК ЕАЭС, ст. 40);
          перевозка по РФ после места прибытия — не входит, только если выделена в договоре и подтверждена счётом. Через Казахстан место прибытия —
          Достык / Хоргос. Цена — по ставкам экспедиторов ниже; ATI.SU — сравнение с рынком${this._ati(state, dirs)},
          предупреждение при отличии больше ${esc(state.dev)} % («Параметры → Логистика»). В экономику сделки пока не передаётся.</p>
        <div class="cf-form">
          <label class="f"><span>Откуда (город в Китае)</span><input type="text" id="cfFrom" data-nodirty list="cfFromL" value="${esc(query.from)}" placeholder="например, Шанхай" autocomplete="off"></label>
          <label class="f"><span>Место прибытия в ЕАЭС${UiKit.tip('<p>Первый пункт на таможенной границе ЕАЭС, куда приходит груз: до него перевозка входит в таможенную стоимость (ТК ЕАЭС, ст. 40), после — нет.</p><p>Примеры: Забайкальск (авто и ж/д через Маньчжурию), Достык или Хоргос (через Казахстан), Владивосток (море).</p>')}</span><input type="text" id="cfTo" data-nodirty list="cfToL" value="${esc(query.to)}" autocomplete="off"></label>
          <label class="f"><span>Пункт назначения в РФ</span><input type="text" id="cfDest" data-nodirty list="cfToL" value="${esc(query.dest)}" placeholder="для сквозных ставок" autocomplete="off"></label>
          <label class="f"><span>Вид перевозки</span><select id="cfKind" data-nodirty>${this.opts(state.kinds, query.kind)}</select></label>
          <label class="f"><span>Вес брутто, кг</span><input type="text" id="cfKg" data-nodirty inputmode="decimal" value="${esc(query.kg)}"></label>
          <label class="f"><span>Объём, м³</span><input type="text" id="cfM3" data-nodirty inputmode="decimal" value="${esc(query.m3)}"></label>
          <label class="f"><span>Условия поставки${UiKit.tip('<p>Инкотермс: кто и до какого места оплачивает перевозку. EXW — забираем с завода (вся перевозка наша); FOB — поставщик довёз до порта отгрузки в Китае; CIF — оплачено до порта назначения.</p><p>Чем больше уже оплатил поставщик, тем меньше перевозки добавляется к таможенной стоимости.</p>')}</span><select id="cfTerms" data-nodirty>${this.opts(state.terms, query.terms)}</select></label>
          <label class="f"><span>Расходы в Китае (погрузка, экспорт)</span><span class="cf-m"><input type="text" id="cfExV" data-nodirty inputmode="decimal" value="${esc(query.extraV)}" placeholder="0"><select id="cfExC" data-nodirty aria-label="Валюта">${this.curs(query.extraCur)}</select></span></label>
          <label class="f"><span>Страхование груза, если оплачено</span><span class="cf-m"><input type="text" id="cfInV" data-nodirty inputmode="decimal" value="${esc(query.insV)}" placeholder="0"><select id="cfInC" data-nodirty aria-label="Валюта">${this.curs(query.insCur)}</select></span></label>
          <button class="btn primary" type="button" data-cfgo>Рассчитать</button><button class="btn ghost" type="button" data-cfreq title="Текст запроса по полям выше: участки до места прибытия и по РФ — раздельно, валюта, срок действия, что не входит">Запрос экспедитору</button></div>
        <datalist id="cfFromL">${froms.map(place => `<option value="${esc(place)}">`).join('')}</datalist>
        <datalist id="cfToL">${tos.map(place => `<option value="${esc(place)}">`).join('')}</datalist>
        <div id="cfRes"></div></div>
      `;
  }

  static _rates() {
    const state = this.data;
    const rows = state.rates.rows || [];
    const saved = state.rates.at
      ? `Сохранено ${esc(String(state.rates.at).slice(0, this.ISO_MINUTE).replace('T', ' '))}${state.rates.by ? ` · ${esc(state.rates.by)}` : ''}.`
      : '';
    const ref = (state.ref.rows || []).length
      ? `<button class="btn ghost" type="button" data-cfref title="${esc(`${state.ref.note || ''} Подборка от ${this.day(state.ref.date)}`)}">+ Ориентиры из открытых данных (${state.ref.rows.length})</button>`
      : '';
    return `<div class="st-card"><p class="sub">Ставки экспедиторов</p>
        <p class="muted">Из коммерческих предложений: участок — «до места прибытия» (входит в таможенную стоимость), «сквозная до пункта в РФ» (одной суммой — входит целиком)
          или «по РФ от места прибытия» (откуда — место прибытия). Сборный груз: строки «за кг» и «за м³» одного экспедитора — берётся большее, не меньше минимальной суммы.
          Просроченная ставка помечается. ${saved}</p>
        <div class="cf-tw"><table class="cf-t"><thead><tr><th>Откуда</th><th>Куда</th><th>Участок${UiKit.tip('<p>«До места прибытия» — ставка от Китая до границы ЕАЭС (входит в таможенную стоимость); «сквозная до пункта в РФ» — одной суммой до города в России (входит целиком); «по РФ от места прибытия» — от границы до города (не входит, если выделена счётом).</p>')}</th><th>Вид</th><th>Ставка</th><th>Валюта</th><th>За${UiKit.tip('<p>За что ставка: «рейс» (машина или контейнер целиком), «кг» или «м³» для сборного груза. Пример: 2 $/кг, 250 $/м³, мин. сумма 300 $ — берётся большее из веса и объёма, но не меньше минимальной суммы.</p>')}</th><th>Мин. сумма</th><th>Срок, дн.</th><th>Действует до</th><th>Экспедитор</th><th>Примечание</th><th></th></tr></thead>
          <tbody id="cfRows">${rows.map(row => this.row(row)).join('')}</tbody></table></div>
        <div class="row"><button class="btn ghost" type="button" data-cfadd>+ Строка</button><button class="btn ghost" type="button" data-cftpl title="Лист «Ставки» — текущая таблица (или пример), «Как заполнить», «Запрос экспедитору». Этот же файл экспедитор может заполнить и прислать">Шаблон Excel</button><button class="btn ghost" type="button" data-cfload title="Файл .xlsx или .csv: строки добавятся в таблицу, затем — «Сохранить ставки»">Загрузить из файла</button><input type="file" id="cfFile" accept=".xlsx,.csv" hidden>${ref}<span class="sp"></span><button class="btn primary" type="button" data-cfsave>Сохранить ставки</button></div></div>`;
  }

  /**
   * Строка таблицы ставок.
   * @param {object} [rate]
   * @returns {string}
   */
  static row(rate = {}) {
    return `${this._rowHead(rate)}${this._rowTail(rate)}`;
  }

  static _rowHead(rate) {
    const state = this.data;
    return `<tr><td><input type="text" data-c="from" value="${esc(rate.from || '')}" list="cfFromL" aria-label="Откуда"></td><td><input type="text" data-c="to" value="${esc(rate.to || '')}" list="cfToL" aria-label="Куда"></td>
      <td><select data-c="scope" aria-label="Участок">${this.opts(state.scopes, rate.scope || 'border')}</select></td>
      <td><select data-c="kind" aria-label="Вид">${this.opts(state.kinds, rate.kind || 'ftl')}</select></td><td><input type="text" data-c="price" inputmode="decimal" value="${esc(rate.price ?? '')}" aria-label="Ставка"></td>`;
  }

  static _rowTail(rate) {
    const state = this.data;
    const ref = rate.ref
      ? `<input type="hidden" data-c="ref" value="1"><small class="muted">ориентир${rate.src ? ` · <a href="${SafeLink.href(rate.src)}" target="_blank" rel="noopener">источник</a>` : ''}</small>`
      : '';
    return `
      <td><select data-c="cur" aria-label="Валюта">${this.curs(rate.cur || 'CNY')}</select></td>
      <td><select data-c="unit" aria-label="За">${this.opts(state.units, rate.unit || 'trip')}</select></td><td><input type="text" data-c="min" inputmode="decimal" value="${esc(rate.min || '')}" aria-label="Минимальная сумма"></td>
      <td><input type="text" data-c="days" inputmode="numeric" value="${esc(rate.days ?? '')}" aria-label="Срок"></td><td><input type="date" data-c="until" value="${esc(rate.until || '')}" aria-label="Действует до"></td>
      <td><input type="text" data-c="who" value="${esc(rate.who || '')}" aria-label="Экспедитор">${ref}<input type="hidden" data-c="src" value="${esc(rate.src || '')}"></td><td><input type="text" data-c="note" value="${esc(rate.note || '')}" aria-label="Примечание"></td>
      <td><button class="icon" type="button" data-cfdel title="Удалить строку" aria-label="Удалить строку">✕</button></td></tr>`;
  }

  /**
   * Дата ГГГГ-ММ-ДД → ДД.ММ.ГГГГ.
   * @param {string} iso
   * @returns {string}
   */
  static day(iso) {
    const parts = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || '');
    return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : '';
  }

  /**
   * Сумма в рублях и в валюте ставки.
   * @param {object} offer
   * @returns {string}
   */
  static money(offer) {
    return `<b>${Fmt.rub(offer.rub)}</b>${offer.cur && offer.cur !== 'RUB' ? `<br><small class="muted">${esc(offer.amount.toLocaleString('ru-RU'))} ${esc(offer.cur)}</small>` : ''}`;
  }

  /**
   * Предупреждения расчёта.
   * @param {object} offer
   * @returns {string}
   */
  static warns(offer) {
    return (offer.warn || []).map(warn => `<div class="warn-t">⚠ ${esc(warn)}</div>`).join('');
  }

  static _days(offer) {
    return offer.days ? `${esc(offer.days)} дн.` : '—';
  }

  static _offer(offer) {
    return `<tr>
        <td><b>${esc(offer.src)}</b>${offer.srcUrl ? ` <a href="${SafeLink.href(offer.srcUrl)}" target="_blank" rel="noopener" title="Источник">↗</a>` : ''}${offer.until ? `<br><small class="muted">до ${esc(this.day(offer.until))}</small>` : ''}</td><td>${esc(this.data.scopes[offer.scope] || '')}</td><td>${this.money(offer)}</td>
        <td><b>${Fmt.rub(offer.cv)}</b>${offer.cvParts.length > 1 ? `<br><small class="muted">${esc(offer.cvParts.map(part => `${part[0]} ${Fmt.rub(part[1])}`).join(' + '))}</small>` : ''}</td>
        <td>${this._days(offer)}</td><td class="muted">${esc(offer.note || '')}${this.warns(offer)}</td></tr>`;
  }

  static _after(offer) {
    return `<tr><td><b>${esc(offer.src)}</b></td><td>${this.money(offer)}</td>
        <td>${this._days(offer)}</td><td class="muted">${esc(offer.note || '')}${this.warns(offer)}</td></tr>`;
  }

  /**
   * Итог расчёта.
   * @param {object} reply
   * @returns {string}
   */
  static result(reply) {
    const rates = reply.fx || {};
    const rate = value => (value ? String(Math.round(value * this.FX_DIGITS) / this.FX_DIGITS).replace('.', ',') : '—');
    const offers = reply.offers.length
      ? `<table class="cf-t cf-r"><thead><tr><th>Экспедитор</th><th>Участок</th><th>Перевозка</th><th>В таможенную стоимость</th><th>Срок</th><th>Как посчитано</th></tr></thead><tbody>${reply.offers.map(offer => this._offer(offer)).join('')}</tbody></table>`
      : '';
    const after = reply.after.length
      ? `<p class="sub">По РФ от места прибытия — в таможенную стоимость не входит</p><table class="cf-t"><tbody>${reply.after.map(offer => this._after(offer)).join('')}</tbody></table>`
      : '';
    const market = reply.market
      ? `<p class="muted">Рынок (ATI.SU): ${Fmt.rub(reply.market.rub)}${reply.market.avgRub ? `, в среднем ${Fmt.rub(reply.market.avgRub)}` : ''} — ${esc(reply.market.note)}. Только для сравнения, в таможенную стоимость не идёт.</p>`
      : '';
    return `<p><b>${esc(reply.terms)}</b>: ${esc(reply.termsNote)}.</p>${offers}${after}${market}
      ${reply.errors.map(error => `<p class="${error.skip ? 'muted' : 'warn-t'}">${esc(error.src)}: ${esc(error.msg)}</p>`).join('')}
      ${reply.kz ? '<p class="muted">Через Казахстан: место прибытия на территорию ЕАЭС — граница Казахстана; перевозка по Казахстану и РФ после неё в таможенную стоимость не входит, если выделена и подтверждена.</p>' : ''}
      <p class="muted">Курс ЦБ${rates.date ? ` на ${esc(rates.date)}` : ''}: CNY ${rate(rates.CNY)} ₽, USD ${rate(rates.USD)} ₽, EUR ${rate(rates.EUR)} ₽ — для декларации берётся курс на день её регистрации.
        На несколько позиций сумма делится пропорционально весу брутто (Решение Коллегии ЕЭК № 83). Без пошлин, НДС и таможенного сбора.</p>`;
  }

  static _key(values) {
    return values.join('|');
  }

  /**
   * Ориентиры из открытых данных — в таблицу без повторов; действуют 30 дней от сегодня, сохраняет администратор кнопкой.
   * @param {HTMLElement} main
   */
  static addRef(main) {
    const value = (line, key) => (line.querySelector(`[data-c="${key}"]`) || {}).value || '';
    const have = new Set(
      [...main.querySelectorAll('#cfRows tr')].map(line =>
        this._key(['who', 'from', 'to', 'unit'].map(key => value(line, key))),
      ),
    );
    const until = new Date(Date.now() + this.REF_DAYS * this.DAY_MS).toISOString().slice(0, this.ISO_DAY);
    const add = (this.data.ref.rows || []).filter(
      rate => !have.has(this._key([rate.who, rate.from, rate.to, rate.unit])),
    );
    main
      .querySelector('#cfRows')
      .insertAdjacentHTML('beforeend', add.map(rate => this.row({ ...rate, ref: true, until })).join(''));
    if (add.length) StDirty.set(true);
    Toast.show(
      add.length
        ? `Добавлено ориентиров: ${add.length}. Проверьте и нажмите «Сохранить ставки»`
        : 'Ориентиры уже в таблице',
    );
  }

  /**
   * Строки таблицы на экране (в том числе ещё не сохранённые).
   * @param {HTMLElement} main
   * @returns {object[]}
   */
  static tableRows(main) {
    return [...main.querySelectorAll('#cfRows tr')]
      .map(line =>
        Object.fromEntries([...line.querySelectorAll('[data-c]')].map(input => [input.dataset.c, input.value.trim()])),
      )
      .filter(rate => rate.from || rate.to || rate.price);
  }

  /**
   * Поля расчёта на экране.
   * @param {HTMLElement} main
   * @returns {object}
   */
  static form(main) {
    const value = selector => (main.querySelector(selector) || {}).value || '';
    const out = { ...this.query };
    for (const [key, selector] of Object.entries(this.FIELDS))
      out[key] = key === 'kind' || key === 'terms' ? value(selector) : value(selector).trim();
    return out;
  }

  /**
   * Загрузка файла ставок: строки — в таблицу (сохраняет администратор), пропущенные — с причиной.
   * @param {HTMLElement} main
   * @param {File} file
   */
  static async load(main, file) {
    try {
      const parsed = ChinaRateBook.parse(await ChinaRateBook.lines(file));
      main.querySelector('#cfRows').insertAdjacentHTML('beforeend', parsed.rows.map(rate => this.row(rate)).join(''));
      if (parsed.rows.length) StDirty.set(true);
      const bad = parsed.bad.length
        ? `, пропущено: ${parsed.bad.length} — ${esc(parsed.bad.slice(0, this.BAD_SHOWN).join('; '))}${parsed.bad.length > this.BAD_SHOWN ? '…' : ''}`
        : '';
      main.querySelector('#cfRes').innerHTML =
        `<p class="${parsed.bad.length ? 'warn-t' : 'muted'}">Из «${esc(file.name)}» добавлено строк: ${parsed.rows.length}${bad}. Проверьте таблицу и нажмите «Сохранить ставки».</p>`;
      Toast.show(`Добавлено строк: ${parsed.rows.length}`);
    } catch (error) {
      Toast.show(`Файл не прочитан: ${error.message || error}`);
    }
  }

  /**
   * События вкладки.
   * @param {HTMLElement} main
   */
  static bind(main) {
    main.querySelector('#cfFile').onchange = event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) this.load(main, file);
    };
    main.onclick = event => {
      for (const [selector, method] of this.CLICKS) {
        const button = event.target.closest(selector);
        if (button) {
          this[method](main, button);
          return;
        }
      }
    };
  }

  static _addRow(main) {
    main.querySelector('#cfRows').insertAdjacentHTML('beforeend', this.row());
  }

  static async _template(main) {
    try {
      FileSave.download(
        'Ставки_экспедиторов_Китай.xlsx',
        await ChinaRateBook.template(this.tableRows(main), this.form(main), this.data),
      );
    } catch (error) {
      Toast.show(`Шаблон не создан: ${error.message || error}`);
    }
  }

  static _pickFile(main) {
    main.querySelector('#cfFile').click();
  }

  static async _request(main) {
    const text = ChinaRateBook.request(this.form(main), this.data);
    if (await CopyText.copy(text)) {
      Toast.show('Запрос скопирован — вставьте в письмо экспедитору');
      return;
    }
    main.querySelector('#cfRes').innerHTML =
      `<p class="muted">Скопируйте запрос:</p><textarea class="cf-req" rows="12" readonly>${esc(text)}</textarea>`;
  }

  static _dropRow(main, button) {
    button.closest('tr').remove();
    StDirty.set(true);
  }

  static async _save(main) {
    const rows = this.tableRows(main);
    try {
      await Api.request(this.URL, { method: 'PUT', headers: this.JSON_HEAD, body: JSON.stringify({ rows }) });
      Toast.show('Ставки сохранены');
      StDirty.saved();
      this.render(main);
    } catch (error) {
      Toast.show(`Не сохранено: ${error.message || error}`);
    }
  }

  static _read(main) {
    const value = selector => main.querySelector(selector).value.trim();
    for (const [key, selector] of Object.entries({ ...this.FIELDS, ...this.MORE })) this.query[key] = value(selector);
    return this.query;
  }

  static async _quote(main, button) {
    const query = this._read(main);
    const num = text => text.replace(',', '.');
    const out = main.querySelector('#cfRes');
    button.disabled = true;
    out.innerHTML = '<p class="muted">Считаю…</p>';
    try {
      const body = {
        from: query.from,
        to: query.to,
        dest: query.dest,
        kind: query.kind,
        kg: num(query.kg),
        m3: num(query.m3),
        terms: query.terms,
        extra: { v: num(query.extraV), cur: query.extraCur },
        ins: { v: num(query.insV), cur: query.insCur },
      };
      const reply = await Api.request(`${this.URL}/quote`, {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify(body),
      });
      out.innerHTML = this.result(reply);
    } catch (error) {
      out.innerHTML = `<p class="warn-t">${esc(error.message || error)}</p>`;
    }
    button.disabled = false;
  }
}
