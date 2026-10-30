import { DealLogistics } from './deal-logistics.js';
import { FreightFacts } from './freight-facts.js';
import { FreightFields } from './freight-fields.js';
import { Freight } from './freight.js';
import { LgCargo } from './lg-cargo.js';
import { LgFmt } from './lg-fmt.js';
import { LgState } from './lg-state.js';
import { LgTariffFile } from './lg-tariff-file.js';
import { Toast } from '../../core/toast.js';
import { XlsTable } from '../catalog/excel-import.js';
import { Fmt } from '../../core/str.js';
import { $, esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { UiKit } from '../../core/ui-kit.js';

/**
 * «Настройки» → «Тарифы доставки» (администратор): машины, разгрузка, общие параметры, автообновление ставок по ATI.SU,
 * сверка со счетами перевозчиков, тарифы файлом.
 */
export class FreightSettings {
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static AUTO = { on: true, days: 1, period: 30, routes: [] };
  static PERIOD_MIN = 7;
  static PERIOD_MAX = 365;
  static PERIOD = 30;
  static ROUTES = 30;
  static ID_LEN = 7;

  /**
   * Открыть раздел в окне настроек.
   * @param {HTMLElement} box
   */
  static async open(box) {
    await DealLogistics.reload();
    if (LgState.failed) {
      box.innerHTML = `<p class="msg err">Тарифы доставки не загрузились: ${esc(LgState.failed)}. Откройте раздел ещё раз — до загрузки правка недоступна, чтобы не заменить сохранённые тарифы встроенными.</p>`;
      return;
    }
    let status = null;
    try {
      status = await Api.request('/api/logistics/status');
    } catch {
      status = null;
    }
    new FreightSettings(box, status).render();
  }

  /**
   * @param {HTMLElement} box
   * @param {object|null} status состояние автообновления и подключённые перевозчики
   */
  constructor(box, status) {
    this.box = box;
    this.auto = (status && status.auto) || null;
    this.cfg = (status && status.settings) || FreightSettings.AUTO;
    this.providers = (status && status.providers) || {};
    this.tariffs = LgState.tar;
  }

  /**
   * Поле ввода значения.
   * @param {*} value
   * @param {string} [kind] 'text' — текст, иначе число
   * @returns {string}
   */
  static input(value, kind) {
    const text = kind === 'text';
    return `<input type="text" inputmode="${text ? 'text' : 'decimal'}" value="${esc(text ? value : LgFmt.num(value))}">`;
  }

  /** Нарисовать раздел и повесить обработчики. */
  render() {
    const tariffs = this.tariffs;
    this.box.innerHTML = `<div class="st-card">${FreightSettingsView.head()}
    ${this._auto()}
    ${FreightSettingsView.classes(tariffs)}
    ${FreightSettingsView.unload(tariffs)}
    <p class="sub" style="margin-top:14px">Общие параметры</p>
    <div class="lg-sc">${FreightSettingsView.params(tariffs)}</div>
    ${FreightFacts.html(tariffs)}
    <div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-lgsave>Сохранить тарифы</button><button class="btn ghost" type="button" data-lgreset>Вернуть стандартные</button></div></div>`;
    FreightFacts.bind(this.box, tariffs);
    const file = this.box.querySelector('#lgFile');
    if (file) file.onchange = () => this._file(file);
    this.box.onclick = event => this._click(event.target);
  }

  _auto() {
    const { auto, cfg, providers } = this;
    const help = UiKit.tip(
      '<p>Раз в заданное число дней программа запрашивает у ATI.SU «Средние ставки» по опорным направлениям и берёт <b>верхнюю границу</b> средних ставок за период (с НДС) — максимум по направлениям — для каждого класса машины.</p><p>Нужна лицензия «API Средних ставок» ATI.SU и ключ в «Настройки → Ключи API». Снимите галочку «Авто» у машины, чтобы закрепить свою ставку.</p>',
    );
    const last = FreightSettings._last(auto);
    const errors = FreightSettings._errors(auto);
    return `<div class="lg-auto">
      <div class="sub st-mh">Автообновление ставок за км ${help}</div>
      <p class="${providers.ati ? 'muted' : 'bad-t'}">${providers.ati ? 'Ключ ATI.SU задан.' : 'Ключ ATI.SU не задан — автообновление не работает («Настройки → Ключи API»).'}
        ${last}</p>
      ${errors}
      <div class="lg-autog"><label class="cw-chk"><input type="checkbox" id="lgAuOn"${cfg.on !== false ? ' checked' : ''}> обновлять автоматически</label>
        <label class="f"><span>раз в, дней</span><input type="text" inputmode="numeric" id="lgAuDays" value="${esc(cfg.days || 1)}"></label>
        <label class="f"><span>период ставок, дней</span><input type="text" inputmode="numeric" id="lgAuPer" value="${esc(cfg.period || FreightSettings.PERIOD)}"></label>
        <button class="btn" type="button" data-lgref${providers.ati ? '' : ' disabled'}>Обновить сейчас</button></div>
      <label class="f"><span>Опорные направления (по одному в строке: «Откуда — Куда»)</span><textarea id="lgAuRt" rows="4">${esc((cfg.routes || []).join('\n'))}</textarea></label>
    </div>`;
  }

  static _last(auto) {
    if (!(auto && auto.at)) return ' Обновлений ещё не было.';
    return ` Последнее обновление: <b>${esc(Fmt.dateTime(auto.at))}</b>, классов обновлено: ${Object.keys(auto.classes || {}).length}.`;
  }

  static _errors(auto) {
    if (!(auto && (auto.errors || []).length)) return '';
    return `<details class="lg-src"><summary>Замечания последнего обновления (${auto.errors.length})</summary><ul>${auto.errors.map(text => `<li>${esc(text)}</li>`).join('')}</ul></details>`;
  }

  static _newId(prefix) {
    return prefix + Math.random().toString(36).slice(2, FreightSettings.ID_LEN);
  }

  _savedClass(id) {
    const saved = LgState.saved;
    return saved && Array.isArray(saved.classes) ? saved.classes.find(row => row.id === id) : null;
  }

  _readClass(row) {
    const cls = { id: row.dataset.id || FreightSettings._newId('c') };
    row.querySelectorAll('td[data-k]').forEach(cell => {
      const value = cell.querySelector('input').value.trim();
      cls[cell.dataset.k] = cell.dataset.k === 'name' ? value : LgCargo.num(value);
    });
    cls.open = row.querySelector('[data-k=open]').checked;
    const auto = row.querySelector('[data-k=auto]');
    cls.auto = auto ? auto.checked : true;
    const prev = this._savedClass(cls.id);
    // своя ставка остаётся запасной, пока работает автообновление
    if (cls.auto && row.querySelector('td[data-k=km] input[readonly]')) FreightSettings._keepRates(cls, prev);
    // тариф поправлен по сверке со счетами
    if (row.dataset.src) cls.src = row.dataset.src;
    // ставка не менялась — источник (например, файл) сохраняется
    if (prev && prev.src && !cls.auto && +prev.km === +cls.km) cls.src = prev.src;
    return cls;
  }

  static _keepRates(cls, prev) {
    const def = Freight.DEFAULTS.classes.find(item => item.id === cls.id);
    cls.km = FreightSettings._fallback(prev && prev.km, def && def.km, cls.km);
    cls.kmFar = FreightSettings._fallback(prev && prev.kmFar, def && def.kmFar, cls.kmFar);
  }

  static _fallback(saved, def, own) {
    if (saved > 0) return +saved;
    return def != null ? def : own;
  }

  _readUnload(row) {
    const tech = { id: row.dataset.id || FreightSettings._newId('u') };
    row.querySelectorAll('td[data-k]').forEach(cell => {
      const value = cell.querySelector('input').value.trim();
      tech[cell.dataset.k] = cell.dataset.k === 'name' ? value : LgCargo.num(value);
    });
    return tech;
  }

  /**
   * Тарифы из формы для сохранения.
   * @returns {object}
   */
  read() {
    const box = this.box;
    const classes = [...box.querySelectorAll('#lgCl tbody tr')]
      .map(row => this._readClass(row))
      .filter(row => row.name);
    const unload = [...box.querySelectorAll('#lgUn tbody tr')]
      .map(row => this._readUnload(row))
      .filter(row => row.name);
    const bad = classes.find(cls => FreightFields.REQUIRED.some(key => !(cls[key] > 0)));
    if (bad) throw new Error(`«${bad.name}»: укажите длину, ширину, высоту, грузоподъёмность и ставку`);
    const out = {
      ver: 3,
      classes: classes.sort((left, right) => left.t - right.t),
      unload: unload.sort((left, right) => left.max - right.max),
      facts: FreightFacts.read(box),
    };
    box.querySelectorAll('[data-sc]').forEach(field => {
      const key = field.dataset.sc;
      out[key] = key === 'hub' ? field.value.trim() : LgCargo.num(field.value);
    });
    out.auto = this._readAuto();
    return out;
  }

  _readAuto() {
    const days = Math.max(1, Math.round(LgCargo.num($('#lgAuDays').value) || 1));
    const period = Math.round(LgCargo.num($('#lgAuPer').value) || FreightSettings.PERIOD);
    return {
      on: $('#lgAuOn').checked,
      days,
      period: Math.min(FreightSettings.PERIOD_MAX, Math.max(FreightSettings.PERIOD_MIN, period)),
      routes: $('#lgAuRt')
        .value.split('\n')
        .map(line => line.trim())
        .filter(line => /[—-]/.test(line))
        .slice(0, FreightSettings.ROUTES),
    };
  }

  async _file(field) {
    const file = field.files[0];
    field.value = '';
    if (!file) return;
    try {
      const rows = /\.xlsx$/i.test(file.name)
        ? await LgTariffFile.readXlsx(await file.arrayBuffer())
        : XlsTable.parse(await file.text());
      LgTariffFile.preview(this.box, { imp: LgTariffFile.parse(rows), fname: file.name, tariffs: this.tariffs });
    } catch (err) {
      Toast.show(`Файл не прочитан: ${err.message || err}`);
    }
  }

  static CLICK = [
    ['[data-lgtpl]', '_template'],
    ['[data-lgdel]', '_delete'],
    ['[data-lgref]', '_refresh'],
    ['[data-lgadd]', '_add'],
    ['[data-lgsave]', '_save'],
    ['[data-lgreset]', '_reset'],
  ];

  _click(target) {
    for (const [selector, method] of FreightSettings.CLICK) {
      const button = target.closest(selector);
      if (button) return this[method](button);
    }
    return null;
  }

  _template() {
    LgTariffFile.template(this.tariffs);
  }

  _delete(button) {
    button.closest('tr').remove();
  }

  async _put(body) {
    await Api.request('/api/logistics', { method: 'PUT', headers: FreightSettings.JSON_HEAD, body });
  }

  async _refresh(button) {
    button.disabled = true;
    button.textContent = 'Обновляю…';
    try {
      await this._put(JSON.stringify(this.read()));
      const reply = await Api.request('/api/logistics/refresh', { method: 'POST' });
      const notes = (reply.errors || []).length ? `, замечаний: ${reply.errors.length}` : '';
      Toast.show(
        reply.error ? reply.error : `Ставки обновлены: ${Object.keys(reply.classes || {}).length} классов${notes}`,
      );
    } catch (err) {
      Toast.show(`Не обновлено: ${err.message || err}`);
    }
    return FreightSettings.open(this.box);
  }

  _add(button) {
    const classes = button.dataset.lgadd === 'cl';
    const body = this.box.querySelector(classes ? '#lgCl tbody' : '#lgUn tbody');
    const row = document.createElement('tr');
    row.innerHTML = classes ? FreightSettingsView.newClass() : FreightSettingsView.newUnload();
    body.appendChild(row);
    row.querySelector('input').focus();
  }

  async _save() {
    try {
      await this._put(JSON.stringify(this.read()));
      Toast.show('Тарифы сохранены');
      FreightSettings.open(this.box);
    } catch (err) {
      Toast.show(`Не сохранено: ${err.message || err}`);
    }
  }

  async _reset() {
    if (!confirm('Вернуть стандартные тарифы доставки? Ваши ставки будут заменены.')) return;
    try {
      await this._put('{}');
      Toast.show('Стандартные тарифы');
      FreightSettings.open(this.box);
    } catch (err) {
      Toast.show(`Не сохранено: ${err.message}`);
    }
  }
}

/** Разметка раздела «Тарифы доставки»: шапка, таблицы машин и разгрузки, общие параметры. */
export class FreightSettingsView {
  /**
   * Шапка: пояснение, тарифы файлом, источники стандартных ставок, когда изменены.
   * @returns {string}
   */
  static head() {
    const saved = LgState.saved;
    const help = UiKit.tip(
      '<p>По ним «Экономика сделки» считает доставку со склада поставщика до объекта: машина подбирается по массе и габаритам груза; рейс — подача + ставка за км до 1 000 км + «дальняя» ставка за км дальше (дальний рейс дешевле за км), не меньше минимального заказа; к рейсу добавляются негабарит, тяжеловес, прикрытие и разгрузка. Ставки — с НДС 22 %, ставка перевозчика (агент — отдельно).</p><p>Стандартные значения откалиброваны по рынку осени 2026 года. Точнее всего — по вашим счетам: впишите 5–10 последних счетов в «Сверку со счетами перевозчиков» внизу, программа покажет ошибку тарифа и предложит поправку.</p><p>Негабарит по правилам РФ: шире 2,55 м или выше 4 м от дороги (высота груза на площадке — в столбце «Высота груза»). На открытой площадке груз до 2,55 м шириной едет без спецразрешения.</p>',
    );
    const fileHelp = UiKit.tip(
      '<p>Файл Excel (.xlsx) или CSV из шаблона: три таблицы — «Транспорт», «Разгрузка», «Параметр». Скачайте шаблон (в нём ваши текущие тарифы), поправьте ставки и загрузите. Перед применением программа покажет, что изменится.</p><p>Ставки из файла закрепляются: автообновление по ATI.SU для этих машин выключается (включить — галочка «Авто»).</p>',
    );
    const changed =
      saved && saved.updatedAt
        ? `Изменены ${esc(Fmt.dateTime(saved.updatedAt))}${saved.updatedBy ? ` · ${esc(saved.updatedBy)}` : ''}`
        : 'Стандартные значения — уточните по счетам перевозчиков';
    return `<div class="sub st-mh">Тарифы по России ${help}</div>
    <div class="row lg-file"><button class="btn ghost" type="button" data-lgtpl>Скачать тарифы файлом (шаблон)</button>
      <input type="file" id="lgFile" accept=".xlsx,.csv,.txt" class="sr-file"><label for="lgFile" class="btn">Загрузить тарифы из файла…</label>
      ${fileHelp}</div>
    <div id="lgImp"></div>
    <details class="lg-src"><summary>Откуда стандартные ставки</summary><ul>${Freight.DEFAULTS.sources.map(text => `<li>${esc(text)}</li>`).join('')}</ul></details>
    <p class="muted">${changed}</p>`;
  }

  static _rateCell(cls, key, kind) {
    const input = FreightSettings.input(cls[key], kind);
    if ((key === 'km' || key === 'kmFar') && cls.srcAuto) {
      return input.replace(
        '<input',
        '<input readonly title="Ставка из автообновления — снимите «Авто», чтобы задать свою"',
      );
    }
    return input;
  }

  static _classRow(cls, i) {
    const cells = FreightFields.CLASS_COLS.map(
      ([key, , kind]) => `<td data-k="${key}">${FreightSettingsView._rateCell(cls, key, kind)}</td>`,
    ).join('');
    const src = `${cls.srcAuto ? 'ATI.SU · верх средних ставок' : esc(cls.src || '')}${cls.srcAt ? `<br>${esc(Fmt.dateTime(cls.srcAt))}` : ''}`;
    return `<tr data-i="${i}" data-id="${esc(cls.id)}">${cells}<td><label class="lg-ck"><input type="checkbox" data-k="open"${cls.open ? ' checked' : ''} aria-label="Открытая площадка"></label></td>
        <td><label class="lg-ck"><input type="checkbox" data-k="auto"${cls.auto !== false ? ' checked' : ''} aria-label="Ставка из автообновления"></label></td><td class="lg-srcc" title="${esc(cls.src || '')}">${src}</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td></tr>`;
  }

  /**
   * Таблица машин.
   * @param {object} tariffs
   * @returns {string}
   */
  static classes(tariffs) {
    const head = FreightFields.CLASS_COLS.map(([, label]) => `<th>${esc(label)}</th>`).join('');
    return `<div class="lg-tw"><table class="lg-st" id="lgCl"><thead><tr>${head}<th>Открытая</th><th>Авто</th><th>Источник ставки</th><th></th></tr></thead><tbody>
      ${tariffs.classes.map((cls, i) => FreightSettingsView._classRow(cls, i)).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="cl">+ Транспорт</button>`;
  }

  static _unloadRow(tech) {
    const input = FreightSettings.input;
    return `<tr data-id="${esc(tech.id)}"><td data-k="name">${input(tech.name, 'text')}</td><td data-k="max">${input(tech.max)}</td><td data-k="cost">${input(tech.cost)}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td></tr>`;
  }

  /**
   * Таблица техники разгрузки.
   * @param {object} tariffs
   * @returns {string}
   */
  static unload(tariffs) {
    return `<p class="sub" style="margin-top:14px">Разгрузка на объекте</p>
    <div class="lg-tw"><table class="lg-st" id="lgUn"><thead><tr><th>Техника</th><th>Масса места до, т</th><th>Стоимость, ₽</th><th></th></tr></thead><tbody>
      ${tariffs.unload.map(tech => FreightSettingsView._unloadRow(tech)).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="un">+ Техника</button>`;
  }

  /**
   * Общие параметры.
   * @param {object} tariffs
   * @returns {string}
   */
  static params(tariffs) {
    return FreightFields.COMMON.map(
      ([key, label, kind]) =>
        `<label class="f"><span>${esc(label)}</span>${FreightSettings.input(tariffs[key], kind).replace('<input', `<input data-sc="${key}"`)}</label>`,
    ).join('');
  }

  /**
   * Строка новой машины.
   * @returns {string}
   */
  static newClass() {
    const cells = FreightFields.CLASS_COLS.map(
      ([key, , kind]) => `<td data-k="${key}">${FreightSettings.input('', kind)}</td>`,
    ).join('');
    return `${cells}<td><input type="checkbox" data-k="open" aria-label="Открытая площадка"></td><td><input type="checkbox" data-k="auto" aria-label="Ставка из автообновления"></td><td class="lg-srcc">вручную</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td>`;
  }

  /**
   * Строка новой техники разгрузки.
   * @returns {string}
   */
  static newUnload() {
    const input = FreightSettings.input;
    return `<td data-k="name">${input('', 'text')}</td><td data-k="max">${input('')}</td><td data-k="cost">${input('')}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td>`;
  }
}
