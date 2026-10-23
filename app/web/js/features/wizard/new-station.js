import { EquipWizard } from './equip-wizard.js';
import { KitPick } from '../kit/kit-pick.js';
import { KitNeed } from '../kit/kit-need.js';
import { StationImages } from '../station/station-images.js';
import { Toast } from '../../core/toast.js';
import { StationAuto, StationName } from '../kit/station-auto.js';
import { StationDefaults } from '../kit/station-defaults.js';
import { ContainerPart } from '../kit/container-part.js';
import { KpState, S } from '../../core/state.js';
import { StationView3D } from '../draw/station-view3d.js';
import { Kit } from '../kit/kit.js';
import { StationUi } from '../station/station-ui.js';
import { StationReq } from '../req/station-req.js';
import { TzPick } from '../tz/tz-pick.js';
import { EquipTypes } from '../../core/equip-types.js';
import { ReqNum } from '../req/req-num.js';
import { $, esc } from '../../core/util.js';
import { StationQuick } from '../station/station-quick.js';
import { Mm } from '../layout/mm.js';
import { StationGeo } from '../layout/station-geo.js';
import { ContainerKind } from '../kit/container-kind.js';
import { DefRegistry } from '../../core/defaults.js';
import { StationLibrary } from './station-library.js';

/**
 * Новая станция в окне «Добавить оборудование»: «что нужно заказчику» (главные требования — те же поля, что в «Подборе
 * станции») → «Подобрать станцию»; контейнер — строкой (другой — по ссылке). Предпросмотр — размер контейнера и 3D-вид до
 * карточки: тот же подбор, что у «Подобрать оборудование», на станции, которая ещё не в КП; «Взять в КП» добавляет её как есть.
 */
export class NewStation {
  static state = { ctype: 'block', ins: '', climate: '', req: {}, cont: false };
  static draft = null; // предпросмотр: {key, x — подобранная станция (ещё не в КП), busy, err}
  static WAIT = 700; // пауза ввода перед подбором для предпросмотра, мс
  static PICK_MAX = 900;
  static KINDS = [
    ['comp', /comp/],
    ['dgu', /dgu/],
    ['pump', /pump/],
  ];
  static MISSING = /В каталоге нет: ([^]*?)(?: — добавьте вручную|$)/;
  static timer = 0;

  /** Состояние по умолчанию: блок-контейнер, утепление и климат — из «Умолчаний». */
  static reset() {
    this.state = {
      ctype: 'block',
      ins: DefRegistry.value('st.ins') || '100 мм',
      climate: DefRegistry.value('st.climate') || 'УХЛ1',
      req: {},
      cont: false,
    };
    this.draft = null;
    clearTimeout(this.timer);
  }

  /**
   * Вид станции по категории.
   * @param {object} type категория
   * @returns {string} comp | dgu | pump | ''
   */
  static kind(type) {
    const found = this.KINDS.find(([, pattern]) => pattern.test(type.id));
    return found ? found[0] : '';
  }

  /**
   * Контейнер одной строкой.
   * @returns {string}
   */
  static cont() {
    const { ctype, ins, climate } = this.state;
    const kind = ContainerKind.of(ctype);
    let size = '';
    if (StationGeo.FLEX[ctype])
      size = ` — размер по оборудованию, в габарите перевозки (ширина до ${Mm.text(StationGeo.ROAD_W)} мм)`;
    else if (kind.size) size = ` (${kind.size})`;
    return `${kind.name}${size}; утепление ${ins}; ${climate}`;
  }

  /**
   * Шаг станции в окне.
   * @param {object} type категория станции
   * @returns {string}
   */
  static html(type) {
    const { where, busy } = EquipWizard.state;
    const kind = this.kind(type);
    const need = (StationQuick.NEED[kind] || [])[0];
    const fields = (StationQuick.KEYS[kind] || []).map(row => this._field(row, need)).join('');
    const pickLabel = this.ready() ? 'Взять в КП' : 'Подобрать станцию';
    return `<p class="muted nw-lead">Что нужно заказчику (* — обязательно) — программа подберёт оборудование из каталога, контейнер, компоновку и изображения для КП. Всё можно поправить в карточке станции.</p>
      ${StationLibrary.html(kind)}<div class="ns-g">${fields}</div>
      <div class="ns-c"><span class="muted">Контейнер:</span> <span>${esc(this.cont())}</span> <button class="link" type="button" data-nw="nsCont">${this.state.cont ? 'скрыть' : 'другой'}</button></div>
      ${this.state.cont ? this._contFields() : ''}
      <div class="ns-pv" id="nsPv">${this.pvHtml(type)}</div>
      <div class="row nw-go"><button class="btn primary" type="button" data-nw="nsPick"${busy ? ' disabled' : ''}>${busy ? 'Подбираю…' : pickLabel}</button>
        ${where === 'kp' ? '<button class="btn" type="button" data-nw="tz">📄 По ТЗ заказчика</button>' : ''}</div>
      <p class="muted ns-alt"><button class="link" type="button" data-nw="nsMain">Выбрать ${esc((type.station.mainLabel || 'оборудование').toLowerCase())} вручную</button> · <button class="link" type="button" data-nw="mkStation">пустая станция</button> — состав и требования в карточке</p>`;
  }

  /**
   * Выбрана типовая станция: её требования — в поля, затем подбор для предпросмотра.
   * @param {object} type категория станции
   * @param {number} index
   */
  static library(type, index) {
    const req = StationLibrary.req(this.kind(type), index);
    if (!req) return;
    Object.assign(this.state.req, req);
    EquipWizard.draw();
    this.later();
  }

  static _field([key, label, hint, mode = 'decimal'], need) {
    const value = this.state.req[key] ?? '';
    const bad = ReqNum.check(key, value);
    return `<label class="f"><span>${esc(label)}${key === need ? ' *' : ''}</span><input type="text" inputmode="${mode}" data-nsr="${esc(key)}" value="${esc(value)}" placeholder="${esc(hint)}" autocomplete="off"${bad ? ' class="bad"' : ''}>${bad ? `<small class="err">${esc(bad)}</small>` : ''}</label>`;
  }

  static _option(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  }

  static _contFields() {
    const { ctype, ins, climate } = this.state;
    const types = ContainerKind.TYPES.map(row => this._option(row.id, row.name, ctype === row.id)).join('');
    const layers = ContainerKind.INSULATION.map(value => this._option(value, value, value === ins)).join('');
    const climates = ContainerKind.CLIMATES.map(row =>
      this._option(row[0], `${row[0]} — ${row[1]}`, row[0] === climate),
    ).join('');
    return `<div class="ns-row"><label class="f"><span>Тип</span><select id="nsCt">${types}</select></label>
        <label class="f"><span>Утепление</span><select id="nsIns">${layers}</select></label>
        <label class="f"><span>Климатическое исполнение</span><select id="nsCl">${climates}</select></label></div>`;
  }

  /**
   * Поле требования → состояние (ошибка — под полем, без перерисовки окна); после паузы — предпросмотр.
   * @param {HTMLInputElement} input
   */
  static input(input) {
    const key = input.dataset.nsr;
    this.state.req[key] = input.value;
    const bad = ReqNum.check(key, input.value);
    input.classList.toggle('bad', !!bad);
    let note = input.parentNode.querySelector('small.err');
    if (bad) {
      if (!note) {
        note = document.createElement('small');
        note.className = 'err';
        input.after(note);
      }
      note.textContent = bad;
    } else if (note) note.remove();
    this.later();
  }

  /**
   * Выбран тип контейнера, утепление или климат.
   * @param {HTMLSelectElement} select
   */
  static change(select) {
    const state = this.state;
    if (select.id === 'nsCt') {
      state.ctype = select.value;
      const kind = ContainerKind.of(state.ctype);
      if (kind.ins) state.ins = kind.ins;
      if (kind.climate) state.climate = kind.climate;
    } else if (select.id === 'nsIns') state.ins = select.value;
    else if (select.id === 'nsCl') state.climate = select.value;
    EquipWizard.draw();
    this.later();
  }

  /**
   * Отпечаток ввода для предпросмотра.
   * @returns {string}
   */
  static key() {
    const { req, ctype, ins, climate } = this.state;
    return JSON.stringify([EquipWizard.state.cat, req, ctype, ins, climate]);
  }

  /**
   * Предпросмотр готов и соответствует вводу.
   * @returns {boolean}
   */
  static ready() {
    return !!(this.draft && this.draft.x && !this.draft.busy && this.draft.key === this.key());
  }

  /** Предпросмотр — после паузы ввода. */
  static later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.preview(), this.WAIT);
  }

  /** Подобрать станцию для предпросмотра (только в КП, при верном вводе и главном требовании). */
  static async preview() {
    const { cat, where } = EquipWizard.state;
    const type = cat && EquipTypes.byId(cat);
    if (!type || !type.station || where !== 'kp') return;
    const need = (StationQuick.NEED[this.kind(type)] || [])[0];
    const key = this.key();
    if (ReqNum.errors({ req: this.state.req }).length || !(ReqNum.num(this.state.req[need]) > 0)) {
      this.draft = null;
      this.pvDraw(type);
      return;
    }
    if (this.draft && this.draft.key === key) return;
    const view = { key, x: null, busy: true };
    this.draft = view;
    this.pvDraw(type);
    await this._assemble(type, view);
    view.busy = false;
    if (this.draft === view) this.pvDraw(type);
  }

  static async _assemble(type, view) {
    try {
      const item = this.make(type);
      const note = await TzPick.assemble(item, StationQuick.query(item));
      StationReq.ensure(item).pick = String(note || '').slice(0, this.PICK_MAX);
      view.x = item;
    } catch (error) {
      view.err = String((error && error.message) || error);
    }
  }

  /**
   * Перерисовать предпросмотр и надпись кнопки.
   * @param {object} type
   */
  static pvDraw(type) {
    const box = $('#nsPv');
    if (!box) return;
    box.innerHTML = this.pvHtml(type);
    const button = document.querySelector('#dlg.nw [data-nw="nsPick"]');
    if (button && !EquipWizard.state.busy) button.textContent = this.ready() ? 'Взять в КП' : 'Подобрать станцию';
  }

  /**
   * Итог подбора: состав коротко, контейнер с размером, главное замечание, 3D-вид.
   * @param {object} type
   * @returns {string}
   */
  static pvHtml(type) {
    const view = this.draft;
    if (!view || view.key !== this.key()) return '';
    if (view.busy) return '<p class="muted ns-pv-w">Подбираю станцию…</p>';
    if (view.err || !view.x) return `<p class="msg err">Не получилось подобрать: ${esc(view.err || '')}</p>`;
    const item = view.x;
    const plan = StationUi.enabled(item) ? StationUi.plan(item) : null;
    const container = Kit.container(item);
    const missing = String(StationReq.of(item).pick || '').match(this.MISSING);
    const lines = StationQuick.lines(item)
      .map(line => `<div>${esc(line)}</div>`)
      .join('');
    return `<div class="ns-pv-b"><div class="ns-pv-t"><b>${esc(String(item.name || type.item))}</b>
        ${lines}
        ${container ? `<div class="muted">${this._containerLine(container, plan)}</div>` : ''}
        ${this._issue(plan)}
        ${missing ? `<p class="msg warn">⚠ В каталоге не нашлось: ${esc(missing[1])}</p>` : ''}</div>${this._image(item, plan)}</div>`;
  }

  static _containerLine(container, plan) {
    const ext = plan && plan.geo && plan.geo.ext;
    const size = ext ? `${Mm.text(ext[0])} × ${Mm.text(ext[1])} × ${Mm.text(ext[2])} мм` : '';
    const mode = this._mode(plan);
    return `${esc(ContainerKind.of(container.ctype).name)}${size ? `, ${esc(size)}` : ''}${mode ? ` — ${esc(mode)}` : ''}`;
  }

  static _mode(plan) {
    const mode = plan && plan.mode;
    if (!mode) return '';
    if (mode.ends) return 'без продольного прохода (компрессор у торца)';
    if (mode.tight) return 'проход «в крайнем случае»';
    return mode.cross ? 'агрегат поперёк' : '';
  }

  static _issue(plan) {
    const bad = plan && plan.level === 'error' ? (plan.issues.find(issue => issue.level === 'error') || {}).text : '';
    if (bad) return `<p class="msg err">✕ ${esc(bad)}</p>`;
    const wide = plan && (plan.issues || []).find(issue => issue.wide);
    return wide ? `<p class="msg warn">⚠ ${esc(wide.text.split('.')[0])}</p>` : '';
  }

  static _image(item, plan) {
    if (!plan || plan.level === 'error' || !plan.geo || !plan.geo.ext) return '';
    return `<img src="${esc(StationUi.url(StationView3D.svg(plan, StationUi.meta(item, plan))))}" alt="3D-вид станции">`;
  }

  /**
   * Новая станция: контейнер, элементы по умолчанию, требования.
   * @param {object} type
   * @returns {object} позиция КП
   */
  static make(type) {
    const item = KpState.newItem();
    item.attrs = { cat: type.id };
    item.page = true;
    item.features = [];
    item.kit = { parts: [] };
    const req = Object.fromEntries(
      Object.entries(this.state.req)
        .map(([key, value]) => [key, String(value).trim()])
        .filter(([, value]) => value),
    );
    if (Object.keys(req).length) item.req = req;
    const container = ContainerPart.create(this.state.ctype);
    ContainerPart.apply(container, { ins: this.state.ins, climate: this.state.climate });
    item.kit.parts.push(container);
    StationDefaults.add(item, type.id); // глушитель и бак ДГУ, трубопроводная обвязка
    Kit.sync(item);
    StationAuto.fill(item);
    StationName.apply(item);
    return item;
  }

  static _valid() {
    const bad = ReqNum.errors({ req: this.state.req });
    if (!bad.length) return true;
    Toast.show(`Исправьте «${bad[0].label}»: ${bad[0].text}`);
    $(`[data-nsr="${bad[0].key}"]`)?.focus();
    return false;
  }

  // главное поле (производительность, мощность, подача) — обязательно для подбора
  static _hasMain(type) {
    const need = StationQuick.NEED[this.kind(type)] || [];
    if (!need.length || ReqNum.num(this.state.req[need[0]]) > 0) return true;
    Toast.show(`Укажите ${need[1]} — без неё станцию не подобрать`);
    $(`[data-nsr="${need[0]}"]`)?.focus();
    return false;
  }

  /**
   * «Подобрать станцию»: станция в КП и сразу подбор оборудования; подобранная в предпросмотре — «Взять в КП» как есть.
   * @param {object} type
   */
  static async pick(type) {
    if (!this._valid() || !this._hasMain(type)) return;
    if (this.ready()) {
      const item = this.draft.x;
      this.draft = null;
      EquipWizard.finish(item, 'kit', () => StationImages.soon(item));
      return;
    }
    const inKp = EquipWizard.state.where === 'kp';
    EquipWizard.finish(this.make(type), 'kit', inKp ? index => StationQuick.pick(index) : null);
  }

  /**
   * «Выбрать вручную»: станция и окно каталога основного оборудования (по требованиям — рекомендуемый первым).
   * @param {object} type
   */
  static main(type) {
    if (!this._valid()) return;
    EquipWizard.finish(this.make(type), 'kit', index => {
      if (EquipWizard.state.where !== 'kp') return;
      const preset = KitNeed.mainPreset(S.items[index]) || {
        test: card => !TzPick.mobile(card),
        need: 'Укажите производительность в «Подборе станции» — покажем подходящие и рекомендуемый первым. Сейчас — все стационарные.',
      };
      KitPick.open(index, { cats: type.station.main, role: 'main', preset });
    });
  }

  /**
   * Пустая станция — состав и требования в карточке.
   * @param {object} type
   */
  static empty(type) {
    EquipWizard.finish(this.make(type), 'kit');
  }
}
