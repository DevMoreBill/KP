import { AdminApi, AdminDialog } from './admin-core.js';
import { BitrixPanel } from './bitrix-panel.js';
import { UiKit } from '../../ui/ui-kit.js';
import { esc } from '../../core/util.js';

/** «Подключение и состояние»: адрес вебхука (ключ — только на сервере), проверка, обмен кнопками. */
export class BitrixLink {
  static MODE = { both: 'в обе стороны', in: 'только из Битрикса в программу', out: 'только из программы в Битрикс' };
  static POLL_SEC = 90;
  static MINUTE = 60;
  static TENTHS = 10;

  static _status(state, rules) {
    if (!state.on)
      return 'Задайте адрес вебхука, нажмите «Проверить связь», настройте «Направление обмена», «Менеджеры», «Воронки и этапы» — и включите. Подробно — «Руководство».';
    const mode = this.MODE[rules.mode] || 'в обе стороны';
    const minutes = Math.round(((state.pollSec || this.POLL_SEC) / this.MINUTE) * this.TENTHS) / this.TENTHS;
    const hours = rules.sched && rules.sched.from ? `, с ${esc(rules.sched.from)} до ${esc(rules.sched.to)}` : '';
    return `Обмен — <b>${esc(mode)}</b> («Направление обмена»); изменения из Битрикса — раз в ${minutes} мин${hours}.`;
  }

  static _exchange(state) {
    const queue = state.queue || {};
    const linked = state.linked || {};
    const off = state.on ? '' : ' disabled';
    return `<p class="bx-sum">Последний обмен: <b>${esc(BitrixPanel.when(state.lastRun))}</b> · в Битриксе сделок <b>${linked.deals || 0}</b>, компаний <b>${linked.companies || 0}</b>, дел <b>${linked.tasks || 0}</b>
        · в очереди <b>${queue.queued || 0}</b>${queue.failed ? ` · <span class="bad-t">с ошибкой ${queue.failed}: ${esc(queue.lastError || '')}</span>` : ''}</p>
        <div class="row bx-btns"><button class="btn" type="button" id="bxRun"${off}>Обменяться сейчас</button>
          <button class="btn ghost" type="button" id="bxPull"${off} title="Забрать изменения и новые сделки, очередь не отправлять">Загрузить из Битрикса</button>
          ${queue.failed ? '<button class="btn" type="button" id="bxRetry">Отправить снова</button>' : ''}
          <button class="btn ghost" type="button" id="bxAll"${off} title="Все сделки программы, включая закрытые">Выгрузить все сделки</button></div>
        <div class="row bx-btns"><label class="f bx-num"><span>Выгрузить сделку №</span><input type="text" id="bxNum" inputmode="numeric" placeholder="номер сделки"></label>
          <button class="btn" type="button" id="bxPush"${off}>Выгрузить сейчас</button></div>`;
  }

  static _connect(state, portal) {
    return `<div class="st-card"><p class="sub">Подключение</p>
      <label class="f"><span>Адрес входящего вебхука ${state.hasUrl ? `<b class="ok-t">задан: ${esc(state.url)}</b>` : ''}</span><input type="password" id="bxUrl" autocomplete="off" placeholder="${state.hasUrl ? 'Новый адрес — заменит текущий' : 'https://bitrix24.kompr.ru/rest/1/ключ/'}"></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="bxTest">${state.hasUrl ? 'Проверить связь' : 'Сохранить и проверить'}</button>${state.hasUrl ? '<button class="btn ghost" type="button" id="bxDel">Удалить адрес</button>' : ''}</div>
      ${portal ? `<p class="ok-t" style="margin:8px 0 0">Связь есть: ${esc(portal.user)}${portal.admin ? ' (администратор портала)' : ''}</p>` : ''}
      <details class="more"><summary>Как получить адрес вебхука</summary><ol class="muted">
        <li>В Битрикс24 под администратором: «Приложения» → «Разработчикам» → «Другое» → «Входящий вебхук».</li>
        <li>Права: «CRM (crm)», «Пользователи (user)», «Диск (disk)» — для файлов КП; сохраните.</li>
        <li>Скопируйте «Вебхук для вызова rest api» (вида https://bitrix24.kompr.ru/rest/1/…/) и вставьте сюда. Никому не пересылайте: по этому адресу открыта CRM.</li>
        <li>Сервер программы должен открывать адрес Битрикса (проверка — кнопкой выше).</li></ol></details></div>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const state = BitrixPanel.state;
    const queue = state.queue || {};
    const portal = BitrixPanel.portal;
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Битрикс24 — сделки, дела и КП</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="bxOn"${state.on ? ' checked' : ''}${state.hasUrl ? '' : ' disabled'}><span>${state.on ? 'включена' : 'выключена'}</span></label></div>
      <p class="muted">${this._status(state, BitrixPanel.rules())}</p>
      ${state.on || queue.queued ? this._exchange(state) : ''}</div>
    ${this._connect(state, portal)}`;
  }

  static _busy(button, text) {
    button.disabled = true;
    button.textContent = text;
  }

  static _on(selector, handler) {
    const el = BitrixPanel.one(selector);
    if (el) el.onclick = handler;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxOn').onchange = event =>
      panel.run(
        () => AdminApi.post('bitrix', { on: event.target.checked }),
        event.target.checked
          ? 'Связь включена: открытые сделки поставлены в очередь отправки'
          : 'Связь выключена: обмен остановлен, данные в Битриксе остаются',
      );
    panel.one('#bxTest').onclick = event => this._test(event.target);
    this._on('#bxDel', () => this._delete());
    this._on('#bxRun', event => {
      this._busy(event.target, 'Обмениваюсь…');
      panel.run(
        () => AdminApi.post('bitrix/run', {}),
        reply => panel.result(reply),
      );
    });
    this._on('#bxPull', event => {
      this._busy(event.target, 'Загружаю…');
      panel.run(
        () => AdminApi.post('bitrix/pull', {}),
        reply => panel.result(reply),
      );
    });
    this._on('#bxPush', event => this._push(event.target));
    this._on('#bxRetry', () =>
      panel.run(() => AdminApi.post('bitrix/resend', {}), 'Записи с ошибкой будут отправлены при следующем обмене'),
    );
    this._on('#bxAll', () => this._all());
  }

  static async _test(button) {
    const panel = BitrixPanel;
    this._busy(button, 'Проверяю…');
    try {
      const url = panel.one('#bxUrl').value.trim();
      if (url) panel.state = await AdminApi.post('bitrix', { url });
      panel.portal = await AdminApi.post('bitrix/test', {});
      panel.render({
        t: 'Связь с Битрикс24 есть. Настройте «Направление обмена», «Менеджеры», «Воронки и этапы» и включите связь.',
      });
    } catch (error) {
      panel.render({ t: String(error.message || error), err: true });
    }
  }

  static async _delete() {
    if (
      !(await AdminDialog.confirm(
        'Удалить адрес вебхука?',
        'Обмен с Битрикс24 остановится. Данные в обеих системах останутся.',
        'Удалить',
      ))
    )
      return;
    BitrixPanel.portal = null;
    BitrixPanel.run(() => AdminApi.post('bitrix', { url: '' }), 'Адрес удалён, связь выключена');
  }

  static _push(button) {
    const panel = BitrixPanel;
    const number = panel.one('#bxNum').value.trim();
    if (!number) {
      panel.render({ t: 'Укажите номер сделки', err: true });
      return;
    }
    this._busy(button, 'Выгружаю…');
    panel.run(
      () => AdminApi.post('bitrix/push', { number }),
      reply => panel.result(reply),
    );
  }

  static async _all() {
    const text =
      'Все сделки программы, включая выигранные и проигранные, будут отправлены в Битрикс24 (уже связанные — обновятся).';
    if (!(await AdminDialog.confirm('Выгрузить все сделки?', text, 'Выгрузить'))) return;
    BitrixPanel.run(
      () => AdminApi.post('bitrix/resend', { what: 'all' }),
      reply => `В очередь поставлено сделок: ${reply.queued || 0}`,
    );
  }
}

/** «Направление обмена»: общее и сводка по видам данных (меняются в их пунктах). */
export class BitrixFlow {
  static KINDS = [
    ['deal', 'Сделки', 'название, этап, дата, ответственный, сумма, экономика, новые сделки', 'deals'],
    ['company', 'Компании', 'компания сделки в Битрикс24; компании Битрикс24 — в справочник клиентов', 'company'],
    ['contacts', 'Контакты', 'контактные лица клиента — в компанию Битрикс24 и обратно', 'contacts'],
    ['task', 'Дела', 'звонки, встречи, письма, задачи по сделкам', 'tasks'],
  ];
  static WHY = {
    in: 'В Битрикс24 ничего не пишется. Изменения и новые сделки из Битрикс24 приходят в программу; правки менеджера в программе остаются в программе (изменят в Битрикс24 — придёт значение Битрикс24).',
    out: 'Программа только отправляет: сделки, КП, экономику и дела. Изменения, сделанные в Битрикс24, в программу не приходят.',
  };
  static BOTH =
    'Сделки, КП, экономика и дела уходят в Битрикс24; стадии, даты, ответственные, дела и новые сделки приходят обратно. Кто главный при правке с обеих сторон — в «Поля сделки».';

  static _dir(kind, rules) {
    if (kind === 'contacts') return (rules.contacts || {}).dir || 'both';
    return (rules.flow || {})[kind] || '';
  }

  static _row([kind, label, hint, tab], rules) {
    const panel = BitrixPanel;
    const own = this._dir(kind, rules);
    const text = own ? panel.DIR[own] : `как общее: ${(panel.DIR[rules.mode] || '').toLowerCase()}`;
    return `<tr><td><b>${esc(label)}</b><small class="muted">${esc(hint)}</small></td><td>${esc(text)}</td>
      <td><button class="btn ghost sm" type="button" data-bxtab="${tab}">Изменить →</button></td></tr>`;
  }

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const rules = panel.rules();
    const modes = ['both', 'in', 'out']
      .map(
        dir =>
          `<button type="button" data-bxmode="${dir}" class="${rules.mode === dir ? 'on' : ''}" aria-pressed="${rules.mode === dir}">${esc(panel.DIR[dir])}</button>`,
      )
      .join('');
    const rows = this.KINDS.map(entry => this._row(entry, rules)).join('');
    return `<div class="st-card"><p class="sub">Общее направление</p>
      <div class="seg bx-seg" role="radiogroup">${modes}</div>
      <p class="muted bx-why">${this.WHY[rules.mode] || this.BOTH}</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveFlow" data-autosave>Сохранить</button></div></div>
    <div class="st-card"><p class="sub">По видам данных${UiKit.tip('<p>Каждому виду данных можно задать своё направление поверх общего — в его пункте меню.</p><p>Пример: общее — «в обе стороны», а «Компании» — «только из Битрикс24 в программу»: сделки и дела обмениваются в обе стороны, а компании в Битрикс24 программа не создаёт и не правит — только забирает их в справочник клиентов.</p>')}</p>
      <div class="tzi-tw"><table class="tzi-t bx-kinds"><thead><tr><th>Что</th><th>Направление</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted">Ещё строже — у отдельных менеджеров («Менеджеры») и у отдельных полей сделки («Поля сделки»): действует самое строгое из общего, вида данных, менеджера и поля.</p></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    let mode = panel.rules().mode;
    const buttons = panel.all('[data-bxmode]');
    buttons.forEach(button => {
      button.onclick = () => {
        mode = button.dataset.bxmode;
        buttons.forEach(other => {
          other.classList.toggle('on', other === button);
          other.setAttribute('aria-pressed', other === button);
        });
        panel.one('#bxSaveFlow').click();
      };
    });
    panel.one('#bxSaveFlow').onclick = () => panel.save({ mode });
  }
}

/** «Товары и файлы КП»: что кроме полей уходит в сделку Битрикс24. */
export class BitrixSend {
  static FILES = [
    ['word', 'КП (Word)'],
    ['pdf', 'КП (PDF)'],
    ['refs', 'Справочные документы КП'],
    ['econ', 'Экономика сделки (Excel)'],
  ];
  static FILE_MB = 20;

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const panel = BitrixPanel;
    const send = panel.rules().send || {};
    const files = send.files || {};
    const how = [
      ['kp', 'позиции последнего КП (цены со скидкой, с НДС)'],
      ['sum', 'одной строкой — итог КП'],
    ];
    return `<div class="st-card"><p class="sub">Товары сделки</p>
      ${panel.opt({
        control: panel.toggle('id="bxRows"', send.rows !== false, 'Передавать товары'),
        label: 'Передавать товары',
        what: 'Вкладка «Товары» сделки Битрикс24 заполняется по последнему КП сделки и обновляется при каждом новом КП.',
        off: 'товары сделки в Битрикс24 ведут вручную; сумма сделки по-прежнему передаётся (см. «Поля сделки»).',
      })}
      ${panel.opt({
        control: panel.sel('id="bxRowsHow"', how, send.rowsHow || 'kp', 'Товары'),
        label: 'Как',
        what: '«Позиции последнего КП» — каждая позиция строкой с ценой со скидкой и НДС, как в документе КП. «Одной строкой» — «КП № 2026-015» на итоговую сумму.',
        example:
          'В Битрикс24 нет каталога товаров — «одной строкой»: в сделке одна понятная строка вместо десятка позиций.',
      })}</div>
    <div class="st-card"><p class="sub">Файлы КП — в ленту сделки</p>
      ${panel.opt({
        control: `<div class="bx-chips">${this.FILES.map(([key, label]) => panel.chk(`data-bxfile="${key}"`, files[key] !== false, esc(label))).join('')}</div>`,
        label: 'Какие файлы отправлять',
        what: 'Сохранили КП — файлы появляются в ленте сделки Битрикс24 комментарием с суммой и экономикой КП. Каждый файл отправляется один раз; новое КП — новые файлы.',
      })}
      ${panel.opt({
        control: `<input type="number" id="bxMB" min="1" max="100" inputmode="numeric" value="${send.fileMB || this.FILE_MB}" aria-label="Предел файла, МБ">`,
        label: 'Файл больше, МБ, — не отправлять',
        what: 'Защита от тяжёлых вложений: такой файл не уходит, а в журнале обмена появляется запись.',
      })}
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveSend" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    panel.one('#bxSaveSend').onclick = () => {
      const one = selector => panel.one(selector);
      const files = {};
      panel.all('[data-bxfile]').forEach(box => {
        files[box.dataset.bxfile] = box.checked;
      });
      panel.save({
        send: { rows: one('#bxRows').checked, rowsHow: one('#bxRowsHow').value, files, fileMB: one('#bxMB').value },
      });
    };
  }
}

/** «Расписание»: частота опроса, часы обмена, записей за раз, попыток. */
export class BitrixSchedule {
  static POLL_SEC = 90;
  static BATCH = 200;
  static TRIES = 20;

  /**
   * Вкладка.
   * @returns {string}
   */
  static html() {
    const state = BitrixPanel.state;
    const sched = BitrixPanel.rules().sched || {};
    return `<div class="st-card"><p class="sub">Расписание обмена</p>
      <div class="bx-map"><label>Спрашивать изменения раз в, с${UiKit.tip('<p>Как часто программа забирает из Битрикса изменения и новые сделки. Пример: 90 — раз в полторы минуты. Меньше — быстрее, но больше запросов к порталу (не реже 30 с).</p>')}</label><input type="number" id="bxPoll" min="30" max="3600" inputmode="numeric" value="${state.pollSec || this.POLL_SEC}"></div>
      <div class="bx-map"><label>Часы обмена (пусто — круглосуточно)</label><span class="bx-hours"><input type="time" id="bxFrom" value="${esc(sched.from || '')}" aria-label="С"> — <input type="time" id="bxTo" value="${esc(sched.to || '')}" aria-label="До"></span></div>
      <div class="bx-map"><label>Записей за один обмен${UiKit.tip('<p>Сколько сделок и дел отправить за один раз. Остальное уйдёт следующим обменом. Пример: 200 — при первом включении 1 000 сделок уйдут за 5 обменов (около 8 минут при опросе раз в 90 с).</p>')}</label><input type="number" id="bxBatch" min="10" max="2000" inputmode="numeric" value="${sched.batch || this.BATCH}"></div>
      <div class="bx-map"><label>Попыток отправки записи (потом — «Не отправлено»)${UiKit.tip('<p>Битрикс недоступен или ответил ошибкой — запись пробуется снова с паузой от 1 минуты до часа. После стольких попыток она попадает в «Журнал и проверка → Не отправлено», откуда её можно повторить вручную.</p>')}</label><input type="number" id="bxTries" min="1" max="100" inputmode="numeric" value="${sched.tries || this.TRIES}"></div>
      <p class="muted">Вне часов обмена фоновый обмен ждёт; кнопки «Обменяться сейчас», «Загрузить из Битрикса», «Выгрузить сделку» работают всегда. Повтор после ошибки — с паузой от 1 минуты до часа.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="bxSaveSched" data-autosave>Сохранить</button></div></div>`;
  }

  /** События вкладки. */
  static bind() {
    const panel = BitrixPanel;
    const one = selector => panel.one(selector);
    one('#bxSaveSched').onclick = () =>
      panel.save({
        pollSec: +one('#bxPoll').value || this.POLL_SEC,
        sched: {
          from: one('#bxFrom').value,
          to: one('#bxTo').value,
          batch: one('#bxBatch').value,
          tries: one('#bxTries').value,
        },
      });
  }
}
