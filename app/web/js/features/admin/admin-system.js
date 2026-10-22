import { AdminApi, AdminDialog } from './admin-core.js';
import { Fmt } from '../../core/str.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * «Обслуживание»: обновления программы, сведения о системе, журнал сервера, перезапуск (сервер: app/app_update.py,
 * app/admin_overview.py).
 */
export class AdminSystem {
  static RESTART = { first: 2500, settle: 8000, limit: 120000, step: 1000 };
  static DAY = 86400;
  static HOUR = 3600;
  static MINUTE = 60;
  static HOURS = 24;
  static NIGHT_WINDOW = 2;
  static NIGHTLY = [
    ['off', 'выключено'],
    ['patch', 'только исправления (3.52.0 → 3.52.1)'],
    ['all', 'все новые версии'],
  ];
  static PUBLIC_REPO = /^DevMoreBill\/KP$/;
  static DATE = 10;
  static UPDATE_ACTIONS = {
    restart: '_upRestart',
    check: '_upCheck',
    download: '_upDownload',
    rollback: '_upRollback',
    remove: '_upRemove',
    night: '_upNight',
    save: '_upSave',
    deltok: '_upSave',
  };

  static _sleep(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  static async _alive() {
    try {
      return (await fetch('/api/ping', { cache: 'no-store' })).ok;
    } catch {
      return false;
    }
  }

  /**
   * Перезапуск: окно ожидания, затем страница обновляется.
   * @param {string} [why]
   */
  static async restart(why = 'Программа перезапускается') {
    try {
      await AdminApi.post('restart');
    } catch (error) {
      Toast.show(`Не перезапущено: ${error.message || error}`);
      return;
    }
    const modal = new Modal(
      `<div class="dlg-h"><h3>${esc(why)}…</h3></div><p class="muted" id="rsMsg">Подождите 10–30 секунд — страница обновится сама.</p><div class="rs-bar"><i></i></div>`,
      'rs-dlg',
    );
    modal.d.addEventListener('cancel', event => event.preventDefault());
    if (await this._waitUp()) location.reload();
    else
      modal.$('#rsMsg').textContent =
        'Программа не ответила за 2 минуты. Проверьте компьютер-сервер и обновите страницу (Ctrl+F5).';
  }

  // сервер сначала пропадает, затем отвечает снова (или отвечает дольше settle — перезапуск уже прошёл)
  static async _waitUp() {
    const start = Date.now();
    let down = false;
    await this._sleep(this.RESTART.first);
    for (;;) {
      const ok = await this._alive();
      if (ok && (down || Date.now() - start > this.RESTART.settle)) return true;
      if (!ok) down = true;
      if (Date.now() - start > this.RESTART.limit) return false;
      await this._sleep(this.RESTART.step);
    }
  }

  static _ver(version) {
    return `<b>${esc(version)}</b>`;
  }

  /**
   * Вкладка «Обновления».
   * @param {HTMLElement} main
   * @param {string} [note] сообщение сверху
   */
  static async updates(main, note) {
    const state = await AdminApi.get('update');
    const last = state.last || {};
    const history = (state.history || [])
      .map(
        row =>
          `<tr><td>${esc(Fmt.dateTime(row.at))}</td><td>${esc(row.from || '')} → ${esc(row.version || '')}</td><td>${esc(row.source || '')}${row.reason ? `<br><small class="muted">${esc(row.reason)}</small>` : ''}</td><td>${esc(row.by || '')}</td></tr>`,
      )
      .join('');
    main.innerHTML = `${note ? `<p class="msg ok" style="text-align:left">${esc(note)}</p>` : ''}
    ${this._failed(state)}
    ${this._current(state)}
    ${this._newVersion(state, last)}
    ${this._fromFile()}
    ${this._rollback(state)}
    ${this._source(state)}
    ${this._night(state)}
    ${history ? `<div class="st-card"><p class="sub">История установок</p><table class="pv-t st-tt"><tr><th>Когда</th><th>Версия</th><th>Откуда</th><th>Кто</th></tr>${history}</table></div>` : ''}`;
    main.querySelector('#upF').onchange = event => this._upload(main, event.target);
    main.onclick = event => this._updateClick(main, event, { state, last });
  }

  static _failed(state) {
    const failed = state.failed;
    if (!failed) return '';
    return `<div class="st-card up-fail"><p><b class="bad-t">Обновление ${esc(failed.version)} не запустилось</b>${failed.at ? ` (${esc(Fmt.dateTime(failed.at))})` : ''} — программа сама вернулась к версии ${this._ver(state.current)}. Данные не пострадали: перед установкой была сделана копия базы («База и копии»).</p>
      <p>Причина: <code>${esc(failed.reason || 'неизвестна')}</code></p>
      ${failed.trace ? `<details class="up-notes"><summary>Подробности для разработчика</summary><pre>${esc(failed.trace)}</pre></details>` : ''}
      <p class="muted">Установить эту версию снова можно, когда причина устранена (обычно — в выпуске с исправлением): «Скачать и установить» или «Выбрать архив обновления…».</p></div>`;
  }

  static _current(state) {
    const kind = state.patched
      ? `обновление поверх программы ${state.base ? esc(state.base) : ''}`
      : 'версия программы (EXE)';
    const pending = state.pending
      ? `<div class="up-pend">Установлено обновление ${this._ver(state.installed)} — заработает после перезапуска <button class="btn primary" type="button" data-up="restart">Перезапустить сейчас</button></div>`
      : '';
    return `<div class="st-card"><div class="up-v"><div><span class="muted">Работает версия</span><b class="up-big">${esc(state.current)}</b>
        <span class="muted">${kind}</span></div>
      ${pending}</div>
      ${state.frozen ? '' : '<p class="msg warn" style="text-align:left">Программа запущена из исходников (не из EXE): обновление установится в папку update, но подключится только у программы, запущенной из «Конструктор КП.exe».</p>'}
      ${state.writable ? '' : `<p class="msg err" style="text-align:left">Нет прав записи в папку программы ${esc(state.root)}. Обновление из «Настроек» не установится — запустите «Установить обновление.cmd» из архива от имени администратора компьютера.</p>`}</div>`;
  }

  static _newVersion(state, last) {
    const token =
      state.hasToken || !this.PUBLIC_REPO.test(state.repo)
        ? ''
        : ' title="Репозиторий приватный — нужен токен GitHub (ниже)"';
    const checked = last.at
      ? `<p class="muted" style="margin:6px 0">Проверено ${esc(Fmt.dateTime(last.at))}${last.error ? ` — <span class="bad-t">${esc(last.error)}</span>` : ''}</p>`
      : '<p class="muted" style="margin:6px 0">Ещё не проверялось.</p>';
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Новая версия</p><span class="sp"></span><button class="btn" type="button" data-up="check"${token}>Проверить обновления</button></div>
      ${checked}
      ${last.version && !last.error ? this._available(state, last) : ''}</div>`;
  }

  static _available(state, last) {
    if (!state.available)
      return `<p class="ok-t" style="margin:0">Установлена последняя версия (${esc(last.version)}).</p>`;
    const again = state.failed && last.version === state.failed.version;
    const asset = last.asset
      ? `<button class="btn${again ? '' : ' primary'}" type="button" data-up="download">Скачать и установить ${esc(last.version)}</button> <span class="muted">${esc(last.asset.name)}${last.asset.size ? ` · ${Fmt.size(last.asset.size)}` : ''} · перед установкой — копия базы, после — перезапуск</span>`
      : '<p class="muted">В выпуске нет архива обновления — скачайте полный комплект с GitHub.</p>';
    return `<div class="up-new"><p>Доступна версия ${this._ver(last.version)}${last.published ? ` от ${esc(KPGen.ruDate(last.published.slice(0, this.DATE)))}` : ''}.${last.url ? ` <a href="${esc(last.url)}" target="_blank" rel="noopener noreferrer">Выпуск на GitHub ↗</a>` : ''}</p>
          ${last.notes ? `<details class="up-notes" open><summary>Что нового</summary><pre>${esc(last.notes)}</pre></details>` : ''}
          ${again ? '<p class="bad-t">Эта версия уже не запустилась на этом компьютере — подробности выше.</p>' : ''}
          ${asset}</div>`;
  }

  static _fromFile() {
    return `<div class="st-card"><p class="sub">Установить из файла</p>
      <p class="muted" style="margin:0 0 8px">Архив обновления «KP-Obnovlenie-….zip» из выпуска — без интернета на компьютере-сервере. Перед установкой — копия базы, после — перезапуск.</p>
      <div class="row"><label class="btn" for="upF">Выбрать архив обновления…</label><input type="file" id="upF" accept=".zip,application/zip" class="sr-file">
        <label class="row muted" style="gap:6px"><input type="checkbox" id="upForce" style="width:auto"> переустановить или поставить более старую версию</label></div>
      <p class="muted" id="upSt"></p></div>`;
  }

  static _rollback(state) {
    return `<div class="st-card"><p class="sub">Откат</p><div class="row">
      <button class="btn" type="button" data-up="rollback"${state.prev ? '' : ' disabled'}>${state.prev ? `Вернуть предыдущее обновление (${esc(state.prev)})` : 'Предыдущего обновления нет'}</button>
      <button class="btn ghost" type="button" data-up="remove"${state.installed ? '' : ' disabled'}>Убрать обновление — работать на версии EXE</button></div>
      <p class="muted" style="margin:8px 0 0">База данных при откате не меняется. Копии базы перед каждой установкой — в «База и копии».</p></div>`;
  }

  static _source(state) {
    return `<div class="st-card"><p class="sub">Источник обновлений</p><div class="grid g2">
      <label class="f"><span>Репозиторий GitHub</span><input type="text" id="upRepo" value="${esc(state.repo)}" placeholder="владелец/имя"></label>
      <label class="f"><span>Токен GitHub ${state.hasToken ? '<b class="ok-t">задан</b>' : ''}</span><input type="password" id="upTok" autocomplete="off" placeholder="${state.hasToken ? 'Новый токен — заменит текущий' : 'github_pat_… (только чтение: Contents)'}"></label></div>
      <label class="row muted" style="gap:6px;margin-top:6px"><input type="checkbox" id="upAuto" style="width:auto"${state.auto ? ' checked' : ''}> Проверять новую версию раз в сутки (в «Требует внимания» появится напоминание)</label>
      <p class="muted">Репозиторий приватный — нужен токен: github.com → Settings → Developer settings → Fine-grained tokens → доступ к репозиторию, право «Contents: Read-only». Токен хранится только на компьютере-сервере.</p>
      <div class="row"><button class="btn primary" type="button" data-up="save" data-autosave>Сохранить</button>${state.hasToken ? '<button class="btn ghost" type="button" data-up="deltok">Удалить токен</button>' : ''}</div></div>`;
  }

  static _night(state) {
    const modes = this.NIGHTLY.map(
      ([key, label]) => `<option value="${key}"${state.nightly === key ? ' selected' : ''}>${label}</option>`,
    ).join('');
    const hours = Array.from(
      { length: this.HOURS },
      (unused, hour) =>
        `<option value="${hour}"${state.nightHour === hour ? ' selected' : ''}>с ${hour}:00 до ${(hour + this.NIGHT_WINDOW) % this.HOURS}:00</option>`,
    ).join('');
    const last = state.nightLast
      ? `<p class="muted" style="margin:0 0 8px">Последняя попытка: ${esc(Fmt.dateTime(state.nightLast.at))} — <span class="${state.nightLast.error ? 'bad-t' : ''}">${esc(state.nightLast.result || '')}</span></p>`
      : '';
    return `<div class="st-card"><p class="sub">Ночные обновления</p>
      <div class="grid g2"><label class="f"><span>Ставить сами</span><select id="upNight">${modes}</select></label>
        <label class="f"><span>Время</span><select id="upHour">${hours}</select></label></div>
      <p class="muted">В это время программа сама проверит новую версию на GitHub, скачает, поставит её и перезапустится (сотрудникам — пара секунд ожидания). Не ставит, если последние 15 минут кто-то сохранял данные (попробует через полчаса), и не повторяет версию, которая уже не запустилась. Если новая версия не запустится, программа сама вернётся к прежней. Об установке придёт письмо, если включены «Письма о проблемах» (вкладка «Почта»).</p>
      ${state.nightSupported ? '' : '<p class="msg warn">Программа запущена не из EXE 3.51 и новее — ночные обновления не сработают (установите полный комплект).</p>'}
      ${last}
      <button class="btn primary" type="button" data-up="night" data-autosave>Сохранить</button></div>`;
  }

  static async _installed(main, reply) {
    const text = `Файлов: ${reply.files}. Копия базы сохранена. Чтобы новая версия заработала, программу нужно перезапустить — у всех сотрудников страница обновится сама.`;
    if (await AdminDialog.confirm(`Установлена версия ${reply.version}`, text, 'Перезапустить сейчас')) {
      this.restart(`Устанавливается версия ${reply.version}`);
      return;
    }
    this.updates(main, `Версия ${reply.version} установлена — перезапустите программу, когда будет удобно.`);
  }

  static async _upload(main, input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const status = main.querySelector('#upSt');
    status.textContent = `Загружаю «${file.name}»…`;
    try {
      const force = main.querySelector('#upForce').checked ? '&force=1' : '';
      const reply = await AdminApi.get(`update/upload?name=${encodeURIComponent(file.name)}${force}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
      });
      this._installed(main, reply);
    } catch (error) {
      status.innerHTML = `<span class="bad-t">${esc(error.message || error)}</span>`;
    }
  }

  static async _updateClick(main, event, ctx) {
    const button = event.target.closest('[data-up]');
    if (!button) return;
    const method = this.UPDATE_ACTIONS[button.dataset.up];
    if (!method) return;
    try {
      await this[method]({ main, button, ...ctx });
    } catch (error) {
      Toast.show(error.message || String(error));
      this.updates(main);
    }
  }

  static _busy(button, text) {
    button.disabled = true;
    button.textContent = text;
  }

  static _upRestart() {
    return this.restart();
  }

  static async _upCheck({ main, button }) {
    this._busy(button, 'Проверяю…');
    await AdminApi.post('update/check');
    return this.updates(main);
  }

  static async _upDownload({ main, button, last }) {
    const text =
      'Программа скачает архив обновления с GitHub, сохранит копию базы и установит обновление. Затем — перезапуск (сотрудникам — пара секунд ожидания).';
    if (!(await AdminDialog.confirm(`Установить версию ${last.version}?`, text, 'Установить'))) return undefined;
    this._busy(button, 'Скачиваю и устанавливаю…');
    return this._installed(main, await AdminApi.post('update/download'));
  }

  static async _upRollback({ state }) {
    const text = 'Установленное сейчас обновление можно будет вернуть тем же способом. После — перезапуск.';
    if (!(await AdminDialog.confirm(`Вернуть версию ${state.prev}?`, text, 'Вернуть'))) return undefined;
    const reply = await AdminApi.post('update/rollback');
    return this.restart(`Возвращается версия ${reply.version || ''}`);
  }

  static async _upRemove() {
    const text =
      'Программа будет работать на версии, встроенной в EXE. Обновление останется в update.prev — его можно вернуть кнопкой «Вернуть предыдущее». После — перезапуск.';
    if (!(await AdminDialog.confirm('Убрать обновление?', text, 'Убрать'))) return undefined;
    await AdminApi.post('update/remove');
    return this.restart();
  }

  static async _upNight({ main }) {
    await AdminApi.post('update', {
      nightly: main.querySelector('#upNight').value,
      nightHour: +main.querySelector('#upHour').value,
    });
    Toast.show('Сохранено');
    return this.updates(main);
  }

  static async _upSave({ main, button }) {
    const body = { repo: main.querySelector('#upRepo').value.trim(), auto: main.querySelector('#upAuto').checked };
    const token = main.querySelector('#upTok').value.trim();
    if (token) body.token = token;
    if (button.dataset.up === 'deltok') body.token = '';
    await AdminApi.post('update', body);
    Toast.show('Сохранено');
    return this.updates(main);
  }

  /**
   * Задача Планировщика сервера отдела (app/server_task.py) — строка состояния.
   * @param {object} task
   * @returns {string}
   */
  static task(task) {
    const bat = '«server-setup\\1. Установить сервер отдела.bat»';
    if (task.pending) return '<span class="muted">проверяется…</span>';
    if (!task.exists) {
      return task.error
        ? `<span class="bad-t">не проверена: ${esc(task.error)}</span>`
        : `<span class="muted">задачи Планировщика нет — после перезагрузки сервер сам не запустится; автозапуск включает ${bat}</span>`;
    }
    if ((task.problems || []).length) {
      return `<span class="bad-t">✕ задача Планировщика ${esc(task.problems.join(', '))}</span>${task.error ? ` <small class="muted">(исправить не удалось: ${esc(task.error)})</small>` : ''}<br><small class="muted">Запустите ${bat} от имени администратора.</small>`;
    }
    const fixed = task.fixed || task.fixedBefore;
    return `<span class="ok-t">✓ задача Планировщика: без ограничения времени работы, от батареи и ИБП, обычный приоритет</span>${fixed ? ` <small class="muted">· исправлена программой ${esc(Fmt.dateTime(fixed))}</small>` : ''}`;
  }

  /**
   * Журнал сервера (data/logs/kp.log): последние ошибки, скачать целиком.
   * @param {HTMLElement} box
   */
  static async logCard(box) {
    let reply;
    try {
      reply = await AdminApi.get('log');
    } catch (error) {
      box.innerHTML = `<p class="sub">Журнал сервера</p><p class="muted">${esc(error.message || error)}</p>`;
      return;
    }
    const errors = reply.errors || [];
    const list = errors.length
      ? `<div class="lg-list">${errors.map(row => `<details class="lg-e"><summary><span class="muted">${esc(Fmt.dateTime(row.at))}</span> ${esc(row.text)}</summary>${row.detail ? `<pre>${esc(row.detail)}</pre>` : ''}</details>`).join('')}</div>`
      : '<p class="muted" style="margin:0">Ошибок в журнале нет.</p>';
    box.innerHTML = `<div class="row"><p class="sub" style="margin:0">Журнал сервера</p><span class="sp"></span>
        <a class="btn" href="/api/admin/log/download" download>Скачать журнал</a>${reply.local ? '<button class="btn ghost" type="button" data-fold="logs">Открыть папку</button>' : ''}</div>
      <p class="muted" style="margin:6px 0">${reply.day ? `<span class="bad-t">Ошибок за сутки: ${reply.day}</span>` : '<span class="ok-t">За сутки ошибок нет</span>'} · ${Fmt.size(reply.bytes || 0)} · <code>${esc(reply.dir || '')}</code></p>
      ${list}`;
  }

  /**
   * Время работы: «2 дн. 3 ч 15 мин».
   * @param {number} seconds
   * @returns {string}
   */
  static uptime(seconds) {
    const days = Math.floor(seconds / this.DAY);
    const hours = Math.floor((seconds % this.DAY) / this.HOUR);
    const minutes = Math.floor((seconds % this.HOUR) / this.MINUTE);
    return `${days ? `${days} дн. ` : ''}${hours ? `${hours} ч ` : ''}${minutes} мин`;
  }

  /**
   * Вкладка «Система».
   * @param {HTMLElement} main
   */
  static async system(main) {
    const info = await AdminApi.get('system');
    main.innerHTML = `${this._program(info)}
    ${this._folders(info)}
    <div class="st-card" id="sysLog"><p class="sub">Журнал сервера</p><p class="muted">Загружаю…</p></div>`;
    this.logCard(main.querySelector('#sysLog'));
    main.onclick = event => this._systemClick(event);
  }

  static _row(key, value) {
    return `<tr><td>${key}</td><td>${value}</td></tr>`;
  }

  static _program(info) {
    const row = (key, value) => this._row(key, value);
    const mode =
      info.mode === 'server'
        ? `сервер отдела — сотрудники открывают <code>http://${esc(info.host)}:${info.port}/</code>`
        : `программа на этом компьютере — <code>http://localhost:${info.port}/</code>`;
    return `<div class="st-card"><div class="row"><p class="sub" style="margin:0">Программа</p><span class="sp"></span><button class="btn" type="button" data-sys="restart">Перезапустить программу</button></div>
      <table class="pv-t">${row('Версия', `<b>${esc(info.version)}</b>${info.patched ? ` (обновление поверх ${esc(info.base || 'EXE')})` : ''} <button class="lnk" type="button" data-sttab="updates">Обновления →</button>`)}
        ${row('Режим', mode)}
        ${row('Работает', `${this.uptime(info.uptime)} (с ${esc(Fmt.dateTime(info.started))})`)}
        ${info.task ? row('Автозапуск', this.task(info.task)) : ''}
        ${row('Компьютер', `${esc(info.host)} · ${esc(info.os)} · Python ${esc(info.python)}`)}
        ${info.allowedHosts.length ? row('Разрешённые имена', esc(info.allowedHosts.join(', '))) : ''}</table></div>`;
  }

  static _folders(info) {
    const row = (key, value) => this._row(key, value);
    const path = (where, which) =>
      `<code>${esc(where)}</code>${info.local && which ? ` <button class="btn sm ghost" type="button" data-fold="${which}">Открыть</button>` : ''}`;
    const backup = `${info.dataDir}${info.dataDir.includes('\\') ? '\\' : '/'}backup`;
    return `<div class="st-card"><p class="sub">Папки и место на диске</p>
      <table class="pv-t">${row('Программа', path(info.root, 'root'))}${row('Данные (база, изображения)', path(info.dataDir, 'data'))}
        ${row('Готовые КП', path(info.docsDir, 'docs') + (info.docsShare ? `<br><small class="muted">сотрудникам: ${esc(info.docsShare)}</small>` : ''))}${row('Копии базы', path(backup, 'backup'))}
        ${row('База данных', Fmt.size(info.dbBytes))}${info.disk ? row('Свободно на диске', `${Fmt.size(info.disk.free)} из ${Fmt.size(info.disk.total)}`) : ''}
        ${row('Файл настроек', `<code>${esc(info.settingsFile)}</code><br><small class="muted">режим, порт, папка данных — меняются в нём; затем «Перезапустить программу»</small>`)}</table>
      ${info.local ? '' : '<p class="muted">Кнопки «Открыть» — только на самом компьютере-сервере.</p>'}</div>`;
  }

  static async _systemClick(event) {
    if (event.target.closest('[data-sys=restart]')) {
      if (
        await AdminDialog.confirm(
          'Перезапустить программу?',
          'Сотрудники подождут 10–30 секунд, несохранённые черновики останутся в браузере.',
          'Перезапустить',
        )
      )
        this.restart();
      return;
    }
    const folder = event.target.closest('[data-fold]');
    if (!folder) return;
    try {
      await AdminApi.post('folder', { which: folder.dataset.fold });
    } catch (error) {
      Toast.show(error.message);
    }
  }
}
