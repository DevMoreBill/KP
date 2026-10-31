import { BackupTab } from './backup-tab.js';
import { ClientStore } from '../kp/client-store.js';
import { Managers } from '../kp/managers.js';
import { Catalog } from '../catalog/catalog-store.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Toast } from '../../core/toast.js';
import { FileSave } from '../../core/files.js';
import { Api } from '../../core/net.js';
import { Fmt, Str } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';

/** «Проверка базы» (db_health.DbHealth): целостность, позиции без категории, одинаковые названия, КП без файла Word. */
export class DbHealthCard {
  static TIP =
    'Раз в неделю ночью программа сама проверяет базу; итог — в «Обзоре». Ничего не исправляется само: позиции без категории переносят в окне каталога, повторы — сливают или удаляют в «Товарах», КП без файла — пересохраняют.';

  /**
   * Последняя проверка.
   * @param {HTMLElement} box
   */
  static open(box) {
    return this._load(box, 'Загружаю…', () => AdminApi.get('maint/health'));
  }

  /**
   * Проверить сейчас.
   * @param {HTMLElement} box
   */
  static run(box) {
    return this._load(box, 'Проверяю…', () => AdminApi.post('maint/health', {}));
  }

  static async _load(box, busy, request) {
    if (!box) return;
    box.innerHTML = `<p class="sub">Проверка базы</p><p class="muted">${busy}</p>`;
    let reply;
    try {
      reply = await request();
    } catch (error) {
      box.innerHTML = `<p class="sub">Проверка базы</p><p class="muted">${esc(error.message || error)}</p>`;
      return;
    }
    box.innerHTML = `<div class="row"><p class="sub" style="margin:0">Проверка базы ${UiKit.tip(this.TIP)}</p><span class="sp"></span>
        <button class="btn sm" type="button" data-hrun>Проверить сейчас</button></div>
      ${reply && reply.at ? this._table(reply) : '<p class="muted">Проверки ещё не было.</p>'}`;
    box.querySelector('[data-hrun]').onclick = () => this.run(box);
  }

  static _line(title, count, rows) {
    return `<tr><td>${title}</td><td class="num"><b class="${count ? 'bad-t' : ''}">${count ? Fmt.num(count) : 'нет'}</b></td><td>${rows || ''}</td></tr>`;
  }

  static _more(list, show) {
    return list && list.length ? `<details><summary>примеры</summary>${list.map(show).join('<br>')}</details>` : '';
  }

  static _table(reply) {
    const noCat = reply.noCat || {};
    const dups = reply.dups || {};
    const noFile = reply.noFile || {};
    const intact = reply.integrity === 'ok';
    return `<p class="muted">Последняя проверка: ${esc(Fmt.dateTime(reply.at))}${reply.seconds != null ? ` · ${String(reply.seconds).replace('.', ',')} с` : ''}</p>
      <table class="pv-t bk-kv"><tbody>
        <tr><td>Файл базы</td><td class="num"><b class="${intact ? '' : 'bad-t'}">${intact ? 'в порядке' : esc(String(reply.integrity))}</b></td><td></td></tr>
        ${this._line(
          'Позиции без категории',
          noCat.n,
          this._more(noCat.samples, row => esc(row.name)),
        )}
        ${this._line(
          'Одинаковые названия оборудования (групп)',
          dups.groups,
          this._more(dups.samples, group => group.map(row => esc(row.name)).join(' · ')),
        )}
        ${this._line(
          'КП без файла Word',
          noFile.n,
          this._more(noFile.samples, row => `№ ${esc(row.number)} — ${esc(row.why)}`),
        )}
      </tbody></table>`;
  }
}

/** Выгрузка разделов базы (каталог целиком или выбор) и загрузка выгруженного файла обратно с предпросмотром. */
export class DataTransfer {
  static SECTIONS = [
    ['catalog', 'Каталог'],
    ['clients', 'Клиенты'],
    ['settings', 'Настройки программы'],
    ['suppliers', 'Поставщики и ТН ВЭД'],
    ['managers', 'Менеджеры'],
    ['kp', 'КП (журнал)'],
    ['audit', 'Журнал действий'],
  ];
  static NAMES = {
    catalog: 'Каталог',
    kp: 'КП',
    managers: 'Менеджеры',
    clients: 'Клиенты',
    suppliers: 'Поставщики',
    settings: 'Настройки программы',
  };
  static PRESETS = [
    ['all', 'Всё', null],
    ['catalog', 'Только каталог', ['catalog', 'settings']],
    ['clients', 'Только клиенты', ['clients']],
    ['settings', 'Только настройки', ['settings']],
  ];
  static PICKS = [
    ['cats', 'data-dc'],
    ['makers', 'data-dm'],
    ['sups', 'data-ds'],
    ['feeds', 'data-df'],
  ];
  static FMT_NAMES = { xlsx: 'Excel', json: 'JSON', xml: 'XML', zip: 'архив .zip', 'xlsx-patch': 'Excel' };
  static FIND_FROM = 12; // длиннее списка — поле поиска
  static DONE_DELAY_MS = 1500;
  static file = null;
  static mode = 'all'; // загрузка: «all» — всё как в файле, «edits» — только изменённое в файле после выгрузки
  static scope = null; // {rows:[{cat, maker, sup, feed, n}], feeds:{id: название}}

  /**
   * «Выгрузить → Разделы базы»: быстрый выбор, разделы, каталог, формат, «Скачать».
   * @returns {string}
   */
  static html() {
    const presets = this.PRESETS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
    const sections = this.SECTIONS.map(
      ([value, label]) =>
        `<label class="ck"><input type="checkbox" data-xs="${value}" data-nodirty${value === 'audit' ? '' : ' checked'}> ${label}</label>`,
    ).join('');
    return `<div id="dtExp" class="bk-form"><div class="sub st-mh">Разделы базы ${UiKit.tip('<p>Каталог можно выгрузить целиком или выбрать категории, производителей, поставщиков, фиды. Файл любого формата загружается обратно в «Загрузить → Копия или правки»: записи с теми же кодами заменяются, новые добавляются, изображения (из архива .zip) — только недостающие.</p><p>«Настройки программы» — категории, умолчания, списки, функции, тексты интерфейса, тарифы доставки, фиды, почта; пароли, ключи API и учётные записи не выгружаются.</p>')}</div>
      <label class="f"><span>Быстрый выбор</span><select id="dtPre" data-nodirty>${presets}<option value="">Свой выбор</option></select></label>
      <div class="f"><span>Разделы</span><div class="bk-cks">${sections}</div></div>
      <div class="f" id="dtCatBox"><span>Каталог</span><div></div></div>
      ${BackupTab.fmtSel()}
      ${BackupTab.foot('<button class="btn primary" type="button" data-dx="json">Скачать</button>').replace('id="bkSt"', 'id="dtExpSt"')}</div>`;
  }

  /**
   * Скачать файл выгрузки администратора (GET /api/admin/…).
   * @param {string} url
   * @param {HTMLElement|null} status строка состояния
   * @returns {Promise<boolean>}
   */
  static async download(url, status) {
    if (status) status.textContent = 'Готовлю файл…';
    try {
      const reply = await Api.request(`/api/admin/${url}`, { raw: true });
      const name = decodeURIComponent((reply.headers.get('Content-Disposition') || '').split("''")[1] || 'backup');
      const blob = await reply.blob();
      FileSave.download(name, blob);
      if (status) status.textContent = `Скачано: ${name} (${Fmt.size(blob.size)})`;
      return true;
    } catch (error) {
      if (status) status.textContent = '';
      Toast.show(`Не выгружено: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Подключить форму выгрузки разделов.
   * @param {HTMLElement} main
   * @param {Function} done после скачивания
   */
  static async mount(main, done) {
    const box = main.querySelector('#dtCatBox>div');
    try {
      this._cats(box, await AdminApi.get('export/scope'));
    } catch (error) {
      box.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
    const form = main.querySelector('#dtExp');
    form.addEventListener('click', event => {
      const button = event.target.closest('[data-dx]');
      if (button) this._export(main, button.dataset.dx, done);
    });
    form.addEventListener('change', event => this._change(main, event.target));
    this._preset(main, 'all');
    form.addEventListener('input', event => {
      const find = event.target.closest('[data-dtq]');
      if (!find) return;
      const words = Str.norm(find.value);
      find
        .closest('[data-dtk]')
        .querySelectorAll('[data-dtn]')
        .forEach(chip => {
          chip.hidden = !!words && !chip.dataset.dtn.includes(words);
        });
    });
  }

  static _change(main, target) {
    if (target.id === 'dtPre') {
      this._preset(main, target.value);
      return;
    }
    if (target.dataset.xs) main.querySelector('#dtPre').value = this._which(main);
    this._toggle(main, target);
  }

  static _sum(rows, key) {
    const out = new Map();
    rows.forEach(row => out.set(row[key], (out.get(row[key]) || 0) + row.n));
    return out;
  }

  static _byCount(map) {
    return [...map].sort(
      (first, second) => second[1] - first[1] || String(first[0]).localeCompare(String(second[0]), 'ru'),
    );
  }

  /**
   * Категории по группам: [группа, [{cat, name, n}]].
   * @param {Map} sums
   * @returns {Map}
   */
  static groups(sums) {
    const groups = new Map();
    for (const [cat, count] of sums) {
      const type = cat ? EquipTypes.byId(cat) : null;
      const ok = type && type.id === cat;
      const group = ok ? type.group || 'Прочее' : 'Без категории';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ cat, name: ok ? type.name : cat || 'Без категории', n: count });
    }
    return groups;
  }

  static _chip(attr, value, label, count) {
    return `<label class="chk-chip" data-dtn="${esc(Str.norm(label))}"><input type="checkbox" ${attr}="${esc(value)}"> ${esc(label)} · ${Fmt.num(count)}</label>`;
  }

  static _block(key, title, body, count, find) {
    return `<details class="dt-k" data-dtk="${key}"${key === 'cats' ? ' open' : ''}><summary>${title} <span class="muted">· ${count}</span> <b class="md-c" data-dtc="${key}" hidden></b></summary>
      ${find ? `<input type="search" class="dt-find" data-dtq="${key}" placeholder="${esc(find)}" autocomplete="off" data-nodirty>` : ''}<div class="chips dt-l">${body}</div></details>`;
  }

  static _group([group, list], index) {
    if (list.length === 1 && list[0].name === group)
      return `<div class="dt-g">${this._chip('data-dc', list[0].cat, group, list[0].n)}</div>`;
    const total = list.reduce((sum, entry) => sum + entry.n, 0);
    const chips = list
      .map(
        entry =>
          `<label class="chk-chip"><input type="checkbox" data-dc="${esc(entry.cat)}" data-dgi="${index}"> ${esc(entry.name)} · ${Fmt.num(entry.n)}</label>`,
      )
      .join('');
    return `<div class="dt-g"><label class="chk-chip dt-gh"><input type="checkbox" data-dg="${index}"> <b>${esc(group)}</b> · ${Fmt.num(total)}</label>
        <div class="chips">${chips}</div></div>`;
  }

  static _list({ key, title, list, attr, label, find }) {
    const many = list.length > this.FIND_FROM;
    const chips = list.map(([value, count]) => this._chip(attr, value, label(value), count)).join('');
    return this._block(key, title, chips, list.length, many ? find : '');
  }

  // каталог: «Весь каталог» или выбор — внутри списка любое из отмеченного, между списками — всё сразу
  static _cats(box, scope) {
    this.scope = scope;
    const rows = scope.rows || [];
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const groups = this.groups(this._sum(rows, 'cat'));
    const cats = [...groups].map((entry, index) => this._group(entry, index)).join('');
    const same = value => value;
    const feedName = value => (scope.feeds || {})[value] || value || 'Не из фида';
    box.innerHTML = `<div class="chips" role="radiogroup"><label class="chk-chip"><input type="radio" name="dtScope" value="all" checked> Весь каталог · ${Fmt.num(total)}</label>
        <label class="chk-chip"><input type="radio" name="dtScope" value="some"> Выбрать: категории, производители, поставщики, фиды</label></div>
      <div id="dtCats" hidden style="margin-top:8px"><p class="muted dt-how">В каждом списке можно отметить несколько. Внутри списка — любое из отмеченного, между списками — всё сразу (например, производитель Atlas Copco <b>и</b> поставщик «Абсолют»).</p>
        ${this._block('cats', 'Категории', cats, `${groups.size} гр.`)}
        ${this._list({ key: 'makers', title: 'Производители', list: this._byCount(this._sum(rows, 'maker')), attr: 'data-dm', label: same, find: 'Найти производителя' })}
        ${this._list({ key: 'sups', title: 'Поставщики', list: this._byCount(this._sum(rows, 'sup')), attr: 'data-ds', label: same, find: 'Найти поставщика' })}
        ${this._list({ key: 'feeds', title: 'Фиды', list: this._byCount(this._sum(rows, 'feed')), attr: 'data-df', label: feedName, find: 'Найти фид' })}
        <p class="dt-sum" id="dtSel">Ничего не выбрано</p></div>`;
  }

  static _preset(main, key) {
    if (!key) return;
    const picked = (this.PRESETS.find(entry => entry[0] === key) || [])[2];
    main.querySelectorAll('[data-xs]').forEach(box => {
      box.checked = picked ? picked.includes(box.dataset.xs) : box.dataset.xs !== 'audit';
    });
    this._scope(main);
  }

  // какой быстрый выбор совпадает с отмеченными разделами ('' — свой)
  static _which(main) {
    const checked = new Set([...main.querySelectorAll('[data-xs]:checked')].map(box => box.dataset.xs));
    const same = list => list.length === checked.size && list.every(key => checked.has(key));
    const usual = this.SECTIONS.map(entry => entry[0]).filter(key => key !== 'audit');
    const preset = this.PRESETS.find(([, , list]) => same(list || usual));
    return preset ? preset[0] : '';
  }

  // выбор групп и категорий — только когда выгружается каталог
  static _scope(main) {
    const box = main.querySelector('#dtCatBox');
    const cat = main.querySelector('[data-xs=catalog]');
    if (box && cat) box.hidden = !cat.checked;
  }

  static _toggle(main, el) {
    if (el.dataset.xs === 'catalog') this._scope(main);
    if (el.name === 'dtScope') main.querySelector('#dtCats').hidden = el.value !== 'some';
    if (el.dataset.dg != null)
      main.querySelectorAll(`[data-dgi="${el.dataset.dg}"]`).forEach(box => {
        box.checked = el.checked;
      });
    if (el.dataset.dgi != null) this._groupMark(main, el.dataset.dgi);
    this._count(main);
  }

  static _groupMark(main, index) {
    const all = [...main.querySelectorAll(`[data-dgi="${index}"]`)];
    const group = main.querySelector(`[data-dg="${index}"]`);
    group.checked = all.every(box => box.checked);
    group.indeterminate = !group.checked && all.some(box => box.checked);
  }

  // выбор: {cats, makers, sups, feeds} — только непустые списки
  static _picked(main) {
    const values = attr => [...main.querySelectorAll(`[${attr}]:checked`)].map(box => box.getAttribute(attr));
    const out = {};
    for (const [key, attr] of this.PICKS) {
      const list = values(attr);
      if (list.length) out[key] = list;
    }
    return out;
  }

  static _fits(row, sets) {
    return (
      (!sets.cats || sets.cats.has(row.cat)) &&
      (!sets.makers || sets.makers.has(Str.norm(row.maker))) &&
      (!sets.sups || sets.sups.has(Str.norm(row.sup))) &&
      (!sets.feeds || sets.feeds.has(row.feed))
    );
  }

  // сколько позиций попадёт в выгрузку и сколько отмечено в каждом списке
  static _count(main) {
    const selected = main.querySelector('#dtSel');
    if (!selected || !this.scope) return;
    const picked = this._picked(main);
    const set = (key, map) => (picked[key] ? new Set(picked[key].map(map)) : null);
    const same = value => value;
    const sets = {
      cats: set('cats', same),
      makers: set('makers', text => Str.norm(text)),
      sups: set('sups', text => Str.norm(text)),
      feeds: set('feeds', same),
    };
    main.querySelectorAll('[data-dtc]').forEach(badge => {
      const count = (picked[badge.dataset.dtc] || []).length;
      badge.hidden = !count;
      badge.textContent = count;
    });
    if (!Object.keys(picked).length) {
      selected.textContent = 'Ничего не выбрано';
      return;
    }
    const count = this.scope.rows.reduce((sum, row) => sum + (this._fits(row, sets) ? row.n : 0), 0);
    selected.innerHTML = count
      ? `Будет выгружено позиций: <b>${Fmt.num(count)}</b>`
      : '<span class="warn-t">Ни одна позиция не подходит под все условия сразу</span>';
  }

  static _url(main) {
    const sections = [...main.querySelectorAll('[data-xs]:checked')].map(box => box.dataset.xs);
    if (!sections.length) {
      Toast.show('Отметьте разделы');
      return '';
    }
    const some = (main.querySelector('[name="dtScope"]:checked') || {}).value === 'some';
    const pick = some ? this._picked(main) : {};
    const catalog = some && sections.includes('catalog');
    if (catalog && !Object.keys(pick).length) {
      Toast.show('Отметьте категории, производителей, поставщиков или фиды');
      return '';
    }
    return `export?${new URLSearchParams({ sections: sections.join(','), fmt: BackupTab.fmtOf(main), ...(catalog ? { pick: JSON.stringify(pick) } : {}) })}`;
  }

  static async _export(main, kind, done) {
    const status = main.querySelector('#dtExpSt');
    const url = kind === 'json' ? this._url(main) : 'export/sqlite';
    if (!url) return;
    if ((await this.download(url, status)) && done) setTimeout(done, this.DONE_DELAY_MS);
  }

  /**
   * Загрузка: «Загрузить» / «Внести правки» под предпросмотром.
   * @param {HTMLElement} main
   * @param {Function} done после загрузки
   */
  static bindImport(main, done) {
    main.querySelector('#impP').addEventListener('click', async event => {
      const button = event.target.closest('[data-imp]');
      if (!button || !this.file) return;
      const patch = button.dataset.patch === '1';
      if (
        !(await AdminDialog.confirm(
          `Загрузить данные из «${this.file.name}»?`,
          this._sureText(button, patch),
          'Загрузить',
        ))
      )
        return;
      button.disabled = true;
      try {
        const reply = await this._send(
          `import/file?${new URLSearchParams({ sections: button.dataset.imp, mode: patch ? 'all' : this.mode })}`,
          this.file,
        );
        const msg = this._doneText(reply);
        this.file = null;
        Toast.show(msg);
        main.querySelector('#impP').innerHTML = `<p class="ok-t">✓ ${esc(msg)}</p>`;
        Catalog.refresh();
        Managers.load();
        ClientStore.load();
        if (done) done();
      } catch (error) {
        button.disabled = false;
        Toast.show(`Не загружено: ${error.message}`);
      }
    });
  }

  static _sureText(button, patch) {
    const before = 'Перед загрузкой программа сохранит копию текущей базы. ';
    if (patch)
      return `${before}В позициях каталога изменятся только перечисленные в файле поля; цены, закупка, остатки и фото не меняются. Поля, изменённые после выгрузки копии, пропускаются.`;
    if (this.mode === 'edits')
      return `${before}Загрузятся только записи, изменённые в файле после выгрузки; цены и остатки позиций не меняются.`;
    return `${before}Записи с теми же кодами будут заменены, новые — добавлены, ничего не удаляется. Изображения добавляются только недостающие.${button.dataset.keep === '1' ? ' Цены, закупка и остатки имеющихся позиций не меняются.' : ''}`;
  }

  static _doneText(reply) {
    if (reply.patch)
      return `Правки внесены: позиций ${Fmt.num(reply.patch.written)}, полей ${Fmt.num(reply.patch.fields)}${reply.patch.conflictCount ? `, пропущено ${Fmt.num(reply.patch.conflictCount)}` : ''}`;
    const parts = Object.entries(reply.report || {})
      .map(([key, value]) => `${this.NAMES[key] || key} — ${Fmt.num((value.new || 0) + (value.updated || 0))}`)
      .join(', ');
    return `Загружено: ${parts}${reply.images ? `; изображений добавлено ${Fmt.num(reply.images.written)}` : ''}`;
  }

  static _send(path, file) {
    const json = file.name.toLowerCase().endsWith('.json');
    return AdminApi.get(`${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': json ? 'application/json; charset=utf-8' : 'application/octet-stream' },
      body: file,
    });
  }

  /**
   * Предпросмотр: что добавится и заменится; mode — по умолчанию у Excel «только изменённое», у остальных — «всё».
   * @param {HTMLElement} main
   * @param {File} file
   * @param {string} [mode]
   * @returns {Promise<*>}
   */
  static async preview(main, file, mode) {
    const box = main.querySelector('#impP');
    box.innerHTML = `<p class="muted">Проверяю «${esc(file.name)}» (${Fmt.size(file.size)})…</p>`;
    try {
      const reply = await this._send(`import/file/preview?mode=${mode || 'auto'}`, file);
      this.file = file;
      if (reply.kind) return BackupTab.redirect(reply.kind, file);
      this.mode = reply.mode || 'all';
      if (reply.patch) {
        box.innerHTML = this._patchHtml(reply);
        return undefined;
      }
      box.innerHTML = this._previewHtml(reply);
      const select = box.querySelector('#impMode');
      if (select) select.onchange = () => this.preview(main, file, select.value);
    } catch (error) {
      this.file = null;
      box.innerHTML = `<p class="msg err" style="text-align:left">${esc(error.message)}</p>`;
    }
    return undefined;
  }

  static _line(key, value) {
    const parts = [
      value.new ? `новых ${Fmt.num(value.new)}` : '',
      value.updated ? `заменится ${Fmt.num(value.updated)}` : '',
      value.same ? `<span class="muted">не менялось ${Fmt.num(value.same)}</span>` : '',
      value.conflict ? `<span class="warn-t">пропущено ${Fmt.num(value.conflict)} — изменено и в программе</span>` : '',
      value.invalid ? `<span class="bad-t">с ошибками ${value.invalid}</span>` : '',
    ];
    return `<tr><td>${this.NAMES[key] || esc(key)}</td><td>${parts.filter(Boolean).join(', ') || '<span class="muted">ничего</span>'}</td></tr>`;
  }

  static _mode(edits) {
    return `<label class="f bk-mode"><span class="st-mh">Что загрузить ${UiKit.tip('<p><b>Только изменённое в файле</b> — записи, которые правили в файле после выгрузки. Если ту же запись после выгрузки изменили и в программе (вручную или фидом), она пропускается и попадает в список ниже. Цены и остатки позиций каталога при этом не меняются.</p><p><b>Всё как в файле</b> — записи с теми же кодами заменяются, как в файле (восстановить копию).</p>')}</span>
          <select id="impMode" data-nodirty><option value="edits"${edits ? ' selected' : ''}>Только изменённое в файле</option><option value="all"${edits ? '' : ' selected'}>Всё как в файле (восстановить)</option></select></label>`;
  }

  static _source(reply) {
    return `<p class="muted">${reply.supplier ? `Каталог поставщика «${esc(reply.supplier)}»` : 'Выгрузка'} от ${esc(Fmt.dateTime(reply.createdAt))}${reply.fmt ? ` · ${esc(this.FMT_NAMES[reply.fmt] || reply.fmt)}` : ''}.</p>`;
  }

  static _images(images) {
    if (!images) return '';
    return `<tr><td>Изображения</td><td>добавится ${Fmt.num(images.new)}, уже есть ${Fmt.num(images.exist)}${images.invalid ? `, <span class="bad-t">пропущено ${images.invalid}</span>` : ''}</td></tr>`;
  }

  static _previewHtml(reply) {
    const edits = reply.mode === 'edits';
    const conflicts = reply.conflicts || [];
    return `${this._source(reply)}
        ${reply.digests ? this._mode(edits) : ''}
        <table class="pv-t bk-kv">${Object.entries(reply.report)
          .map(([key, value]) => this._line(key, value))
          .join('')}
          ${this._images(reply.images)}</table>
        ${conflicts.length ? `<details class="more"><summary>Что пропущено (${conflicts.length})</summary><p class="muted" style="text-align:left">${conflicts.map(esc).join('<br>')}</p></details>` : ''}
        ${reply.errors.length ? `<p class="msg err" style="text-align:left">${reply.errors.map(esc).join('<br>')}</p>` : ''}
        ${reply.keep ? '<p class="muted">Цен, закупки и остатков в файле нет — у имеющихся позиций они останутся как сейчас.</p>' : ''}
        ${edits ? '<p class="muted">Цены и остатки позиций каталога не меняются.</p>' : ''}
        <div class="bk-foot"><span class="bk-note">Перед загрузкой программа сохранит копию базы.</span><button class="btn primary" type="button" data-imp="${esc(Object.keys(reply.report).join(','))}" data-keep="${reply.keep ? 1 : 0}">Загрузить</button></div>`;
  }

  // предпросмотр файла правок каталога (CatalogPatch на сервере): сколько позиций и полей изменится, что пропущено
  static _patchHtml(reply) {
    const patch = reply.patch;
    return `<p class="muted">${esc(patch.title || 'Правки каталога')} — от ${esc(Fmt.dateTime(reply.createdAt))}. Будет:</p><table class="pv-t">
        <tr><td>Каталог</td><td>изменится позиций ${Fmt.num(patch.items)}, полей ${Fmt.num(patch.fields)}${patch.same ? `; уже как в файле — ${Fmt.num(patch.same)}` : ''}${patch.missing ? `; нет в базе — ${Fmt.num(patch.missing)}` : ''}</td></tr>
        ${patch.conflictCount ? `<tr><td>Пропущено</td><td><span class="bad-t">${Fmt.num(patch.conflictCount)}</span> — изменены после выгрузки копии</td></tr>` : ''}</table>
      ${patch.conflicts.length ? `<details style="margin-top:6px"><summary class="muted">Что пропущено</summary><p class="muted" style="text-align:left">${patch.conflicts.map(esc).join('<br>')}${patch.conflictCount > patch.conflicts.length ? '<br>…' : ''}</p></details>` : ''}
      ${reply.errors.length ? `<p class="msg err" style="text-align:left">${reply.errors.map(esc).join('<br>')}</p>` : ''}
      ${patch.items ? `<button class="btn primary" type="button" data-imp="catalog" data-patch="1" style="margin-top:10px">Внести правки</button>` : '<p class="muted">Изменять нечего.</p>'}`;
  }
}

/** Каталог одного поставщика (сервер: supplier_scope.py) — без цен, закупки и остатков. */
export class SupplierExport {
  static groups = [];
  static NONE = 'Без поставщика';
  static TIP =
    '<p>Все позиции одного поставщика из справочника «Поставщики и склады» (позиции фида — поставщик, к которому привязан фид, иначе — название фида; не из фида — по производителю из карточки поставщика).</p><p>Цены, закупка и остатки в файл не попадают: при загрузке файла обратно они остаются как в программе. Формат — любой из общего списка; Excel можно править и загрузить только изменённые строки.</p>';

  /**
   * Заполнить список поставщиков и подключить «Скачать».
   * @param {HTMLElement} main
   * @param {string} [selected] поставщик, выбранный заранее
   */
  static async mount(main, selected = '') {
    const box = main.querySelector('#seBox');
    const status = main.querySelector('#seSt');
    if (!box) return;
    try {
      this.groups = await AdminApi.get('export/suppliers');
    } catch (error) {
      if (status) status.textContent = error.message;
      return;
    }
    const select = box.querySelector('#seSup');
    select.innerHTML = this.groups
      .map(
        group =>
          `<option value="${esc(group.name)}"${Str.norm(group.name) === Str.norm(selected) ? ' selected' : ''}>${esc(group.name)} · ${Fmt.num(group.count)}${group.dir || group.name === this.NONE ? '' : ' (фид, не привязан к справочнику)'}</option>`,
      )
      .join('');
    box.addEventListener('click', event => {
      const button = event.target.closest('[data-se]');
      if (button && select.value) this.run(button, select.value, BackupTab.fmtOf(box));
    });
  }

  /**
   * Скачать.
   * @param {HTMLButtonElement} button
   * @param {string} name поставщик
   * @param {string} fmt
   */
  static async run(button, name, fmt) {
    button.disabled = true;
    try {
      if (
        await DataTransfer.download(
          `export?${new URLSearchParams({ sup: name, fmt })}`,
          BackupTab.main.querySelector('#bkSt'),
        )
      )
        BackupTab.summary();
    } finally {
      button.disabled = false;
    }
  }
}

/** «Выгрузить → Каталог по фильтру»: отбор как в окне каталога, цены и остатки в файл — галочками, число позиций — сразу. */
export class CatFilterPane {
  static scope = null; // сочетания категория / производитель / поставщик (/api/admin/export/scope)
  static PRICES = [
    ['price', 'Цена КП', true],
    ['rrc', 'РРЦ', true],
    ['cost', 'Закупка', false],
    ['stock', 'Остатки', true],
  ];
  static timer = 0;
  static seq = 0; // номер запроса счётчика: ответ на устаревший запрос не показывается
  static NO_CAT = '__none__';
  static TYPE_WAIT_MS = 400;

  static _filter() {
    if (!BackupTab.flt)
      BackupTab.flt = {
        cat: '',
        maker: '',
        sup: '',
        q: '',
        priced: false,
        instock: false,
        prices: this.PRICES.filter(entry => entry[2]).map(entry => entry[0]),
      };
    return BackupTab.flt;
  }

  static _html(filter) {
    const prices = this.PRICES.map(
      ([key, label]) =>
        `<label class="ck"><input type="checkbox" data-cfp="${key}" data-nodirty${filter.prices.includes(key) ? ' checked' : ''}> ${label}</label>`,
    ).join('');
    return `<div class="bk-form" id="cfBox"><div class="sub st-mh">Каталог по фильтру ${UiKit.tip('<p>Отбор — как в окне каталога: категория, производитель, поставщик, слова поиска (все — в названии, кратком описании, артикуле или характеристиках), «С ценой», «В наличии».</p><p>Цены и остатки — галочками: что не отмечено, в файл не попадёт, а при загрузке файла обратно останется как в программе. Закупку видит только администратор.</p>')}</div>
      <div class="bk-grid"><label class="f"><span>Категория</span><select data-cf="cat" data-nodirty><option value="">Загружаю…</option></select></label>
        <label class="f"><span>Производитель</span><select data-cf="maker" data-nodirty></select></label>
        <label class="f"><span>Поставщик</span><select data-cf="sup" data-nodirty></select></label>
        <label class="f"><span>Поиск</span><input type="search" data-cf="q" value="${esc(filter.q)}" placeholder="модель, артикул, слово" autocomplete="off" data-nodirty></label></div>
      <div class="bk-cks"><label class="ck"><input type="checkbox" data-cf="priced" data-nodirty${filter.priced ? ' checked' : ''}> С ценой</label><label class="ck"><input type="checkbox" data-cf="instock" data-nodirty${filter.instock ? ' checked' : ''}> В наличии</label></div>
      <div class="f"><span>В файл — цены и остатки</span><div class="bk-cks">${prices}</div></div>
      ${BackupTab.fmtSel()}${BackupTab.foot('<button class="btn primary" type="button" data-bkx="filter">Скачать</button>', '<span id="cfN">Считаю…</span>')}</div>`;
  }

  /**
   * Нарисовать во вкладке.
   * @param {HTMLElement} side
   */
  static async mount(side) {
    const filter = this._filter();
    side.innerHTML = this._html(filter);
    side.oninput = event => {
      if (event.target.dataset.cf !== 'q') return;
      filter.q = event.target.value;
      this.count(side, this.TYPE_WAIT_MS);
    };
    side.onchange = event => this._change(side, filter, event.target);
    side.onclick = event => {
      const button = event.target.closest('[data-bkx]');
      if (!button) return;
      BackupTab._dl(
        button,
        `export?${new URLSearchParams({ sections: 'catalog', fmt: BackupTab.fmtOf(side), flt: JSON.stringify(this.query()), prices: filter.prices.join(',') })}`,
      );
    };
    try {
      this.scope = this.scope || (await AdminApi.get('export/scope'));
    } catch (error) {
      side.querySelector('#cfN').textContent = error.message || String(error);
      return;
    }
    this.options(side);
    this.count(side, 0);
  }

  static _change(side, filter, target) {
    const field = target.dataset.cf;
    if (field && field !== 'q') {
      filter[field] = target.type === 'checkbox' ? target.checked : target.value;
      this.count(side, 0);
    }
    if (target.dataset.cfp)
      filter.prices = [...side.querySelectorAll('[data-cfp]:checked')].map(box => box.dataset.cfp);
  }

  /**
   * Выпадающие списки: категории по группам, производители и поставщики — по числу позиций.
   * @param {HTMLElement} side
   */
  static options(side) {
    const filter = BackupTab.flt;
    const rows = this.scope.rows || [];
    const sum = key => DataTransfer._byCount(DataTransfer._sum(rows, key));
    const total = rows.reduce((acc, row) => acc + row.n, 0);
    const opt = (key, value, label, count) =>
      `<option value="${esc(value)}"${value === filter[key] ? ' selected' : ''}>${esc(label)} · ${Fmt.num(count)}</option>`;
    const groups = DataTransfer.groups(sum('cat'));
    const cats = [...groups]
      .map(
        ([group, list]) =>
          `<optgroup label="${esc(group)}">${list.map(entry => opt('cat', entry.cat || this.NO_CAT, entry.name, entry.n)).join('')}</optgroup>`,
      )
      .join('');
    side.querySelector('[data-cf=cat]').innerHTML =
      `<option value="">Все категории · ${Fmt.num(total)}</option>${cats}`;
    side.querySelector('[data-cf=maker]').innerHTML = `<option value="">Все производители</option>${sum('maker')
      .map(([value, count]) => opt('maker', value, value, count))
      .join('')}`;
    side.querySelector('[data-cf=sup]').innerHTML = `<option value="">Все поставщики</option>${sum('sup')
      .map(([value, count]) => opt('sup', value, value, count))
      .join('')}`;
  }

  /**
   * Отбор для сервера.
   * @returns {object}
   */
  static query() {
    const filter = BackupTab.flt;
    return {
      cat: filter.cat,
      maker: filter.maker,
      sup: filter.sup,
      q: filter.q,
      priced: filter.priced,
      instock: filter.instock,
    };
  }

  /**
   * Пересчитать число позиций (с задержкой ввода).
   * @param {HTMLElement} side
   * @param {number} wait мс
   */
  static count(side, wait) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._count(side), wait);
  }

  static async _count(side) {
    const label = side.querySelector('#cfN');
    const button = side.querySelector('[data-bkx=filter]');
    if (!label) return;
    const mine = ++this.seq;
    try {
      const reply = await AdminApi.get(`export/filter?${new URLSearchParams({ flt: JSON.stringify(this.query()) })}`);
      if (mine !== this.seq) return;
      label.innerHTML = reply.n
        ? `Попадёт позиций: <b>${Fmt.num(reply.n)}</b>`
        : '<span class="warn-t">Под условия не подходит ни одна позиция</span>';
      button.disabled = !reply.n;
    } catch (error) {
      if (mine === this.seq) label.textContent = error.message || String(error);
    }
  }
}
