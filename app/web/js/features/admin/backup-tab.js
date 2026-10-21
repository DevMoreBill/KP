import { AdminApi, AdminDialog, AuditLabels } from './admin-core.js';
import { CatFilterPane, DataTransfer, DbHealthCard, SupplierExport } from './data-transfer.js';
import { DbMaint, MigrationsCard } from './maint-card.js';
import { SettingsFileCard } from './settings-file.js';
import { MirrorCard } from './settings-panels.js';
import { StNav } from './settings-tools.js';
import { Toast } from '../../core/toast.js';
import { UiKit } from '../../ui/ui-kit.js';
import { esc } from '../../core/util.js';
import { DefRegistry } from '../../core/defaults.js';
import { Fmt } from '../../core/str.js';

/** «База и копии»: сводка плитками и подвкладки Выгрузить · Загрузить · Автокопии · Обслуживание · История. */
export class BackupTab {
  static SUBS = [
    ['out', 'Выгрузить'],
    ['in', 'Загрузить'],
    ['copies', 'Автокопии'],
    ['maint', 'Обслуживание'],
    ['hist', 'История'],
  ];
  static OUT = [
    ['db', 'Вся база', 'Все разделы одним файлом'],
    ['parts', 'Разделы базы', 'Каталог, клиенты, КП, настройки — на выбор'],
    ['sup', 'Каталог поставщика', 'Позиции поставщика, без цен'],
    ['filter', 'Каталог по фильтру', 'Категория, марка, поиск — с ценами на выбор'],
    ['settings', 'Настройки программы', 'Перенести на другой компьютер'],
  ];
  static INCOMING = [
    ['file', 'Копия или правки', 'Любой выгруженный файл: Excel, JSON, XML, YML, .zip'],
    ['settings', 'Файл настроек', 'КП_настройки_… любого формата'],
    ['db', 'Файл базы целиком', '.sqlite3 или архив копии — заменяет всё'],
  ];
  static HIST = [
    ['', 'Все операции', ['export_db', 'import_db', 'backup_db', 'maintain_db']],
    ['out', 'Выгрузки', ['export_db']],
    ['in', 'Загрузки', ['import_db']],
    ['copies', 'Копии и обслуживание', ['backup_db', 'maintain_db']],
  ];
  static HIST_ENT = { auto: 'автокопия', mirror: 'во вторую папку', vacuum: '', sqlite: 'вся база' };
  static HIST_LIMIT = 30;
  static COUNTS = [
    ['catalog', 'Позиций каталога'],
    ['kp', 'КП'],
    ['clients', 'Клиентов'],
    ['managers', 'Менеджеров'],
    ['deals', 'Сделок'],
  ];
  static FMT = [
    ['xlsx', 'Excel (.xlsx) — таблица, можно править'],
    ['json', 'JSON — данные как есть'],
    ['xml', 'XML'],
    ['yml', 'YML — для сайтов (только каталог, без закупки)'],
    ['zip', 'Архив .zip — данные и все фото'],
  ];
  static SQLITE = ['sqlite', 'Точная копия базы (.sqlite в архиве .zip)'];
  static FMT_TIP =
    '<p>У всех вариантов выгрузки — одни и те же форматы, и любой файл загружается обратно: «Загрузить → Копия или правки» (настройки — «Файл настроек»).</p><p><b>Excel</b> — лист на раздел: строка 2 — служебные ключи, столбец «Код» не меняйте; при загрузке можно взять только изменённые строки. <b>JSON</b> и <b>XML</b> — данные как есть. <b>YML</b> — каталог в формате Яндекса для сайтов и маркетплейсов (и данные для загрузки обратно). <b>Архив .zip</b> — JSON и все фото, на которые он ссылается.</p>';
  static ALL = 'catalog,kp,managers,clients,suppliers,audit,settings';
  static FMT_KEY = 'kp.bk.fmt';
  static LOW_DISK_GB = 2;
  static GIB = 1024 ** 3;
  static SUMMARY_DELAY_MS = 1500;
  static RELOAD_MS = 1500;
  static PANES = { out: 'paneOut', in: 'paneIn', copies: 'paneCopies', maint: 'paneMaint', hist: 'paneHist' };
  static SIDE_OUT = {
    db: '_outDb',
    parts: '_outParts',
    sup: '_outSup',
    filter: '_outFilter',
    settings: '_outSettings',
  };
  static SIDE_IN = { file: '_inFile', settings: '_inSettings', db: '_inDb' };

  static sub = 'out'; // открытая подвкладка
  static out = 'db'; // выбранное в «Выгрузить»
  static inn = 'file'; // выбранное в «Загрузить»
  static hist = ''; // фильтр «Истории»
  static main = null;
  static overview = null; // сводка /api/admin/maint/overview
  static flt = null; // «Каталог по фильтру»: выбранное (переживает переключение вариантов)

  /**
   * Строка «что — пояснение — кнопки» (и в «Файле настроек» на вкладке «Файл, изменения, откат»).
   * @param {string} title
   * @param {string} note
   * @param {string} acts
   * @param {string} [id]
   * @returns {string}
   */
  static row(title, note, acts, id = '') {
    return `<div class="bk-row"${id ? ` id="${id}"` : ''}><div class="bk-t"><b>${title}</b><small class="muted">${note}</small></div><div class="bk-a">${acts}</div></div>`;
  }

  /**
   * Вкладка.
   * @param {HTMLElement} main
   */
  static async render(main) {
    this.main = main;
    if (StNav.sup) {
      this.sub = 'out';
      this.out = 'sup';
    }
    const tabs = this.SUBS.map(
      ([key, label]) =>
        `<button type="button" role="tab" data-bks="${key}" aria-selected="${key === this.sub}"${key === this.sub ? ' class="on"' : ''}>${label}</button>`,
    ).join('');
    main.innerHTML = `<div class="bk-sum" id="bkSum">${this.tiles(null)}</div>
      <div class="bk-tabs" role="tablist" aria-label="База и копии">${tabs}</div>
      <div id="bkPane" class="bk-pane"></div>`;
    main.onclick = event => {
      const tab = event.target.closest('[data-bks]');
      if (tab) this.switchTo(tab.dataset.bks);
    };
    this.pane();
    this.summary();
  }

  /**
   * Открыть подвкладку (и выбор слева) — из поиска по настройкам; вкладку затем рисует SettingsWindow.tab.
   * @param {string} sub
   * @param {string} [pick]
   */
  static show(sub, pick) {
    this.sub = sub;
    if (pick && sub === 'out') this.out = pick;
    if (pick && sub === 'in') this.inn = pick;
  }

  /**
   * Переключить подвкладку.
   * @param {string} sub
   */
  static switchTo(sub) {
    this.sub = sub;
    this.main.querySelectorAll('[data-bks]').forEach(button => {
      const current = button.dataset.bks === sub;
      button.classList.toggle('on', current);
      button.setAttribute('aria-selected', current);
    });
    this.pane();
  }

  /** Сводка: база, последняя копия, вторая папка, место на диске. */
  static async summary() {
    try {
      this.overview = await AdminApi.get('maint/overview');
    } catch {
      this.overview = null;
    }
    const box = this.main && this.main.querySelector('#bkSum');
    if (!box || !this.overview) return;
    box.innerHTML = this.tiles(this.overview);
    const size = this.main.querySelector('#bkDbSz');
    if (size) size.textContent = Fmt.size(this.overview.dbBytes);
  }

  static _tile(sub, label, value, note, cls = '') {
    return `<button type="button" class="bk-tile${cls ? ` ${cls}` : ''}" data-bks="${sub}"><small>${label}</small><b>${value}</b><span>${note}</span></button>`;
  }

  /**
   * Плитки сводки (null — заглушки «…»).
   * @param {object|null} overview
   * @returns {string}
   */
  static tiles(overview) {
    if (!overview)
      return (
        this._tile('maint', 'База данных', '…', 'загружаю') +
        this._tile('copies', 'Последняя копия', '…', '') +
        this._tile('copies', 'Вторая папка', '…', '') +
        this._tile('maint', 'Свободно на диске', '…', '')
      );
    const counts = overview.counts || {};
    const count = (key, word) => (counts[key] != null ? `${word} ${Fmt.num(counts[key])}` : '');
    const disk = overview.disk;
    const low = disk && disk.free < DefRegistry.num('srv.lowDiskGB', this.LOW_DISK_GB) * this.GIB;
    const [copyValue, copyNote, copyCls] = this._copy(overview);
    return (
      this._tile(
        'maint',
        'База данных',
        Fmt.size(overview.dbBytes),
        [count('catalog', 'позиций'), count('kp', 'КП'), count('clients', 'клиентов')].filter(Boolean).join(' · '),
      ) +
      this._tile('copies', 'Последняя копия', esc(copyValue), esc(copyNote), copyCls) +
      this._mirrorTile(overview.mirror || {}) +
      this._tile(
        'maint',
        'Свободно на диске',
        disk ? Fmt.size(disk.free) : '—',
        disk ? `из ${Fmt.size(disk.total)}` : 'не удалось узнать',
        low ? 'bad' : '',
      )
    );
  }

  static _copy(overview) {
    const backup = overview.backup || {};
    if (!backup.at) return ['нет', 'копий ещё не было', 'bad'];
    if (!backup.ok) return [Fmt.dateTime(backup.at), 'с ошибкой', 'bad'];
    const stale = overview.stale;
    return [
      Fmt.dateTime(backup.at),
      `${stale ? 'давно · ' : 'исправна · '}копий ${overview.copies}`,
      stale ? 'warn' : 'ok',
    ];
  }

  static _mirrorTile(mirror) {
    if (!mirror.on) return this._tile('copies', 'Вторая папка', 'выключена', 'копии только на этом диске', 'warn');
    const last = mirror.last || {};
    const failed = last.at && !last.ok;
    const note = this._mirrorNote(mirror, failed);
    return this._tile(
      'copies',
      'Вторая папка',
      last.at ? esc(Fmt.dateTime(last.at)) : 'включена',
      note,
      mirror.stale || failed ? 'bad' : 'ok',
    );
  }

  static _mirrorNote(mirror, failed) {
    if (mirror.running) return 'идёт копирование';
    if (failed) return 'последняя — с ошибкой';
    return mirror.stale ? 'копия давно не обновлялась' : 'копии на другом диске';
  }

  /** Нарисовать открытую подвкладку. */
  static pane() {
    const pane = this.main.querySelector('#bkPane');
    pane.onclick = null;
    pane.onchange = null;
    pane.oninput = null;
    pane.ondragover = null;
    pane.ondrop = null;
    this[this.PANES[this.sub]](pane);
  }

  /**
   * Левый список «что» (радиокнопки) и правая панель.
   * @param {string} name
   * @param {Array<string[]>} list
   * @param {string} current
   * @returns {string}
   */
  static two(name, list, current) {
    const options = list
      .map(
        ([key, label, note]) =>
          `<label class="bk-opt${key === current ? ' on' : ''}"><input type="radio" name="${name}" value="${key}"${key === current ? ' checked' : ''} data-nodirty><span><b>${label}</b><small>${note}</small></span></label>`,
      )
      .join('');
    return `<div class="bk-two"><div class="bk-pick" role="radiogroup" aria-label="${name === 'bkOut' ? 'Что выгрузить' : 'Что загрузить'}">${options}</div>
      <div class="bk-side" id="bkSide"></div></div>`;
  }

  static _pick(pane, name, key, draw) {
    pane
      .querySelectorAll('.bk-opt')
      .forEach(option => option.classList.toggle('on', option.querySelector('input').checked));
    this[key] = pane.querySelector(`[name="${name}"]:checked`).value;
    draw.call(this, pane.querySelector('#bkSide'));
  }

  /**
   * «Выгрузить».
   * @param {HTMLElement} pane
   */
  static paneOut(pane) {
    pane.innerHTML = this.two('bkOut', this.OUT, this.out);
    pane.onchange = event => {
      if (event.target.name === 'bkOut') this._pick(pane, 'bkOut', 'out', this.sideOut);
    };
    this.sideOut(pane.querySelector('#bkSide'));
  }

  /**
   * Низ формы: строка состояния и кнопка.
   * @param {string} button
   * @param {string} [note]
   * @returns {string}
   */
  static foot(button, note = '') {
    return `<div class="bk-foot"><span class="bk-note" id="bkSt">${note}</span>${button}</div>`;
  }

  /**
   * Таблица «название — значение».
   * @param {Array<string[]>} rows
   * @returns {string}
   */
  static table(rows) {
    return `<table class="pv-t bk-kv">${rows.map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('')}</table>`;
  }

  /**
   * Запомненный формат выгрузки.
   * @returns {string}
   */
  static fmt() {
    try {
      return localStorage.getItem(this.FMT_KEY) || 'xlsx';
    } catch {
      return 'xlsx';
    }
  }

  /**
   * Варианты формата.
   * @param {{sqlite?: boolean}} [opts] sqlite — и точная копия базы
   * @returns {string}
   */
  static fmtOpts({ sqlite = false } = {}) {
    const current = this.fmt();
    const list = [...(sqlite ? [this.SQLITE] : []), ...this.FMT];
    return list
      .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`)
      .join('');
  }

  /**
   * Поле «Формат».
   * @param {{sqlite?: boolean}} [opts]
   * @returns {string}
   */
  static fmtSel(opts) {
    return `<label class="f"><span class="st-mh">Формат ${UiKit.tip(this.FMT_TIP)}</span><select id="bkFmt" data-nodirty>${this.fmtOpts(opts)}</select></label>`;
  }

  /**
   * Выбранный формат (запоминается для всех вариантов, кроме точной копии базы).
   * @param {HTMLElement} box
   * @returns {string}
   */
  static fmtOf(box) {
    const value = box.querySelector('#bkFmt').value;
    if (value !== 'sqlite')
      try {
        localStorage.setItem(this.FMT_KEY, value);
      } catch {
        // без запоминания
      }
    return value;
  }

  static _head(title, help = '') {
    return `<div class="sub st-mh">${title}${help ? ` ${UiKit.tip(help)}` : ''}</div>`;
  }

  /**
   * Правая панель «Выгрузить».
   * @param {HTMLElement} side
   */
  static sideOut(side) {
    side.onclick = null;
    side.onchange = null;
    side.oninput = null;
    this[this.SIDE_OUT[this.out]](side);
  }

  static _outDb(side) {
    const overview = this.overview || {};
    side.innerHTML = `<div class="bk-form">${this._head('Вся база одним файлом', '<p>Все разделы: каталог, КП, клиенты, менеджеры, поставщики, настройки, журнал действий. Любой формат загружается обратно в «Загрузить → Копия или правки» (записи с теми же кодами заменяются, новые добавляются).</p><p><b>Точная копия базы</b> — файл kp.sqlite3 в архиве: заменяет всю базу целиком («Загрузить → Файл базы целиком»). Изображения (папка img) в неё не входят — их копирует «Вторая папка».</p>')}${this.table(
      [
        ['Внутри', 'каталог, КП, клиенты, менеджеры, поставщики, настройки, журнал'],
        ['Размер базы', `<span id="bkDbSz">${overview.dbBytes ? Fmt.size(overview.dbBytes) : '…'}</span>`],
      ],
    )}${this.fmtSel({ sqlite: true })}${this.foot('<button class="btn primary" type="button" data-bkx="db">Скачать</button>')}</div>`;
    side.onclick = event => {
      const button = event.target.closest('[data-bkx]');
      if (!button) return;
      const fmt = this.fmtOf(side);
      this._dl(
        button,
        fmt === 'sqlite' ? 'export/sqlite' : `export?${new URLSearchParams({ sections: this.ALL, fmt })}`,
      );
    };
  }

  static _outParts(side) {
    side.innerHTML = DataTransfer.html();
    DataTransfer.mount(side, () => this.summary());
  }

  static _outSup(side) {
    side.innerHTML = `<div class="bk-form" id="seBox">${this._head('Каталог поставщика', SupplierExport.TIP)}<label class="f"><span>Поставщик</span><select id="seSup" data-nodirty><option value="">Загружаю…</option></select></label>
          ${this.fmtSel()}${this.foot('<button class="btn primary" type="button" data-se="go">Скачать</button>', 'Без цен, закупки и остатков — при загрузке они остаются как в программе.')}<p class="muted bk-st" id="seSt"></p></div>`;
    SupplierExport.mount(side, StNav.sup || '');
    StNav.sup = '';
  }

  static _outFilter(side) {
    CatFilterPane.mount(side);
  }

  static _outSettings(side) {
    side.innerHTML = `<div class="bk-form">${this._head('Все настройки программы', '<p>Значения программы, списки, тексты, функции, категории, тарифы доставки, ставки из Китая, нормы станций, фиды, почта (без пароля), права менеджеров (без паролей), личные настройки.</p><p>Загрузить — «Загрузить → Файл настроек»: сначала покажем разделы файла, отметите, какие заменить.</p>')}${this.table(
      [
        ['Внутри', 'значения, списки, тексты, функции, тарифы, нормы станций, фиды, почта, права менеджеров'],
        ['Не попадают', 'пароли — никогда; ключи API — только по галочке ниже'],
      ],
    )}<label class="ck bk-ck"><input type="checkbox" id="sfKeys" data-nodirty> С ключами API ${UiKit.tip('<p>Ключи сервисов: проверка контрагентов, перевозчики, PDF, нейросеть, GitHub. Такой файл храните как пароль.</p>')}</label>${this.fmtSel()}${this.foot('<button class="btn primary" type="button" data-bkx="settings">Скачать</button>')}</div>`;
    side.querySelector('#sfKeys').onchange = async event => {
      const sure = () =>
        AdminDialog.confirm(
          'Сохранить вместе с ключами API?',
          'В файл попадут ключи сервисов (проверка контрагентов, перевозчики, PDF, нейросеть, GitHub). Храните его как пароль и не пересылайте.',
          'С ключами',
        );
      if (event.target.checked && !(await sure())) event.target.checked = false;
    };
    side.onclick = event => {
      const button = event.target.closest('[data-bkx]');
      if (!button) return;
      const keys = side.querySelector('#sfKeys').checked ? { keys: '1' } : {};
      this._dl(button, `settings-file?${new URLSearchParams({ fmt: this.fmtOf(side), ...keys })}`);
    };
  }

  static async _dl(button, url) {
    button.disabled = true;
    try {
      if (await DataTransfer.download(url, this.main.querySelector('#bkSt'))) this.summary();
    } finally {
      button.disabled = false;
    }
  }

  /**
   * «Загрузить»: файл — кнопкой или перетаскиванием, сначала предпросмотр.
   * @param {HTMLElement} pane
   */
  static paneIn(pane) {
    pane.innerHTML = this.two('bkIn', this.INCOMING, this.inn);
    pane.onchange = event => {
      if (event.target.name === 'bkIn') this._pick(pane, 'bkIn', 'inn', this.sideIn);
    };
    pane.ondragover = event => {
      const zone = event.target.closest('.bk-drop');
      if (!zone) return;
      event.preventDefault();
      zone.classList.add('over');
    };
    pane.ondragleave = event => {
      const zone = event.target.closest('.bk-drop');
      if (zone) zone.classList.remove('over');
    };
    pane.ondrop = event => {
      const zone = event.target.closest('.bk-drop');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('over');
      const file = event.dataTransfer.files[0];
      if (file) this._file(pane.querySelector('#bkSide'), file);
    };
    this.sideIn(pane.querySelector('#bkSide'));
  }

  static _drop(id, accept, what) {
    return `<div class="bk-drop"><input type="file" id="${id}" accept="${accept}" class="sr-file"><label for="${id}" class="btn">Выбрать файл…</label><span class="muted">или перетащите ${what} сюда</span></div>`;
  }

  /**
   * Правая панель «Загрузить».
   * @param {HTMLElement} side
   */
  static sideIn(side) {
    side.onclick = null;
    side.onchange = null;
    this[this.SIDE_IN[this.inn]](side);
    side.onchange = event => {
      const input = event.target.closest('input[type=file]');
      if (!input) return;
      const file = input.files[0];
      input.value = '';
      if (file) this._file(side, file);
    };
    if (this.inn === 'file') DataTransfer.bindImport(side, () => this.summary());
    if (this.inn === 'settings')
      side.onclick = event => {
        const apply = event.target.closest('[data-sfapply]');
        if (apply) SettingsFileCard.apply(side, apply);
      };
  }

  static _inFile(side) {
    side.innerHTML = [
      this._head(
        'Копия или правки',
        '<p>Любой файл из «Выгрузить» — Excel, JSON, XML, YML или архив .zip: вся база, разделы, каталог поставщика, каталог по фильтру. Записи с теми же кодами заменяются, новые добавляются, ничего не удаляется; изображения из архива — только недостающие.</p><p><b>Только изменённое в файле</b> (по умолчанию для Excel) — загрузятся записи, которые правили в файле; если ту же запись успели изменить и в программе — она пропускается с отчётом.</p><p>Подходит и книга «…_для_правки.xlsx» прежних версий.</p>',
      ),
      this.table([
        ['Подходит', 'любой выгруженный файл: .xlsx, .json, .xml, .yml, .zip'],
        ['Сначала', 'покажем, сколько записей добавится и заменится'],
        ['Перед загрузкой', 'программа сама сохранит копию базы'],
      ]),
      this._drop('impF', '.xlsx,.json,.xml,.yml,.zip', 'файл'),
      '<div id="impP" class="bk-prev"></div>',
    ].join('');
  }

  static _inSettings(side) {
    side.innerHTML = [
      this._head(
        'Файл настроек',
        '<p>Файл «КП_настройки_…» любого формата из «Выгрузить → Настройки программы». Свои ключи API и пароль почты остаются, если в файле их нет. Каждое изменение попадёт в «Историю изменений настроек» — его можно вернуть.</p>',
      ),
      this.table([
        ['Подходит', 'КП_настройки_… (.xlsx, .json, .xml, .yml, .zip)'],
        ['Сначала', 'покажем разделы файла — отметите, какие заменить'],
      ]),
      this._drop('sfFile', '.xlsx,.json,.xml,.yml,.zip', 'файл'),
      '<div id="sfPrev" class="bk-prev"></div>',
    ].join('');
  }

  static _inDb(side) {
    side.innerHTML = [
      this._head(
        'Файл базы целиком',
        '<p>Так и нужно подменять базу: вручную копировать kp.sqlite3 в папку data нельзя — рядом лежат файлы kp.sqlite3-wal и -shm от прежней базы, и она повредится («database disk image is malformed»).</p>',
      ),
      this.table([
        ['Подходит', '.sqlite3 или .zip с ним (выгрузка «Вся база», автокопия из data\\backup)'],
        ['Что будет', '<b class="warn-t">вся база заменится</b>; текущая сохранится в копию (data\\backup)'],
        ['После', 'страница обновится сама'],
      ]),
      this._drop('impDb', '.sqlite3,.sqlite,.db,.zip', 'файл базы'),
      '<p class="muted bk-st" id="impDbSt"></p>',
    ].join('');
  }

  /**
   * Файл настроек или базы целиком, выбранный в «Копия или правки», — открыть свой пункт и продолжить там.
   * @param {string} kind settings | db
   * @param {File} file
   * @returns {Promise<*>}
   */
  static redirect(kind, file) {
    this.inn = kind === 'settings' ? 'settings' : 'db';
    const pane = this.main.querySelector('#bkPane');
    this.pane();
    Toast.show(
      kind === 'settings'
        ? 'Это файл настроек — открыт пункт «Файл настроек»'
        : 'Это файл базы целиком — открыт пункт «Файл базы целиком»',
    );
    return this._file(pane.querySelector('#bkSide'), file);
  }

  static _file(side, file) {
    if (this.inn === 'file') return DataTransfer.preview(side, file);
    if (this.inn === 'settings') return SettingsFileCard.preview(side, file);
    return this._db(side, file);
  }

  static async _db(side, file) {
    const sure = await AdminDialog.confirm(
      `Заменить всю базу файлом «${file.name}»?`,
      'Текущие данные будут заменены содержимым файла. Перед этим программа сохранит копию текущей базы в data\\backup.',
      'Заменить базу',
    );
    if (!sure) return;
    const status = side.querySelector('#impDbSt');
    status.textContent = `Загружаю «${file.name}» (${Fmt.size(file.size)})…`;
    try {
      const reply = await AdminApi.get(`import/sqlite?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      status.textContent = '';
      Toast.show(
        `База заменена: позиций ${Fmt.num(reply.catalog)}, КП ${Fmt.num(reply.kp)}. Прежняя сохранена: ${reply.backup.split(/[\\/]/).pop()}`,
      );
      setTimeout(() => location.reload(), this.RELOAD_MS);
    } catch (error) {
      status.textContent = '';
      Toast.show(`Не загружено: ${error.message || error}`);
    }
  }

  /**
   * «Автокопии».
   * @param {HTMLElement} pane
   */
  static paneCopies(pane) {
    pane.innerHTML =
      '<div class="st-card" id="stMaint"><p class="muted">Загружаю…</p></div><div class="st-card" id="stMirror"></div>';
    DbMaint.render(pane.querySelector('#stMaint'), this.overview, 'copies');
    new MirrorCard(pane.querySelector('#stMirror')).open();
    pane.onclick = event => {
      if (event.target.closest('[data-mt],[data-mb]')) setTimeout(() => this.summary(), this.SUMMARY_DELAY_MS);
    };
  }

  /**
   * «Обслуживание».
   * @param {HTMLElement} pane
   */
  static paneMaint(pane) {
    const counts = (this.overview || {}).counts || {};
    const shown = this.COUNTS.filter(([key]) => counts[key] != null);
    const numbers = shown
      .map(([key, label]) => `<div><b>${Fmt.num(counts[key])}</b><small>${label}</small></div>`)
      .join('');
    pane.innerHTML = `<div class="st-card" id="stMaint"><p class="muted">Загружаю…</p></div>
      ${shown.length ? `<div class="st-card"><p class="sub">Записей в базе</p><div class="bk-nums">${numbers}</div></div>` : ''}
      <div class="st-card" id="stHealth"></div><div id="stMigr"></div>`;
    DbMaint.render(pane.querySelector('#stMaint'), this.overview, 'service');
    DbHealthCard.open(pane.querySelector('#stHealth'));
    MigrationsCard.render(pane.querySelector('#stMigr'));
  }

  /**
   * «История»: выгрузки, загрузки, копии и обслуживание.
   * @param {HTMLElement} pane
   */
  static paneHist(pane) {
    const options = this.HIST.map(
      ([key, label]) => `<option value="${key}"${key === this.hist ? ' selected' : ''}>${label}</option>`,
    ).join('');
    pane.innerHTML = `<div class="st-card"><div class="row bk-hh"><p class="sub" style="margin:0">История операций с базой</p><span class="sp"></span>
        <select id="bkHf" aria-label="Какие операции" data-nodirty>${options}</select></div>
      <div id="bkHist"><p class="muted">Загружаю…</p></div><p class="muted">Последние 30 операций; все — в «Журнале действий».</p></div>`;
    pane.onchange = event => {
      if (event.target.id !== 'bkHf') return;
      this.hist = event.target.value;
      this.history(pane.querySelector('#bkHist'));
    };
    this.history(pane.querySelector('#bkHist'));
  }

  static _what(row) {
    const after = row.after || {};
    const ids = String(row.entityId || '')
      .split(',')
      .map(key => DataTransfer.NAMES[key] || key)
      .join(', ');
    const entity = row.entityId in this.HIST_ENT ? this.HIST_ENT[row.entityId] : ids;
    return [entity, after.supplier || '', after.file || '', after.path || ''].filter(Boolean).map(esc).join(' · ');
  }

  static _histRow(row) {
    const after = row.after || {};
    return `<tr><td>${esc(Fmt.dateTime(row.timestamp))}</td><td><b class="${row.result === 'failed' ? 'bad-t' : ''}">${esc(AuditLabels.ACT[row.action] || row.action)}</b></td><td>${this._what(row)}${after.bytes ? ` · ${Fmt.size(after.bytes)}` : ''}</td><td>${esc(row.userName || row.userId || '')}</td></tr>`;
  }

  /**
   * Список операций.
   * @param {HTMLElement} box
   */
  static async history(box) {
    const actions = (this.HIST.find(entry => entry[0] === this.hist) || this.HIST[0])[2];
    try {
      const replies = await Promise.all(
        actions.map(action => AdminApi.get(`audit?${new URLSearchParams({ action })}`)),
      );
      const ops = replies
        .flatMap(reply => reply.items)
        .sort((first, second) => second.id - first.id)
        .slice(0, this.HIST_LIMIT);
      box.innerHTML = ops.length
        ? `<table class="pv-t bk-hist"><thead><tr><th>Когда</th><th>Операция</th><th>Что</th><th>Кто</th></tr></thead><tbody>${ops.map(row => this._histRow(row)).join('')}</tbody></table>`
        : '<p class="empty">Операций ещё не было.</p>';
    } catch (error) {
      box.innerHTML = `<p class="muted">${esc(error.message || error)}</p>`;
    }
  }
}
