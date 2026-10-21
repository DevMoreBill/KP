import { DealCal } from './deal-cal.js';
import { DealCalculator } from './deal-calculator.js';
import { DealCombo } from './deal-combo.js';
import { DealDefaults } from './deal-defaults.js';
import { DealDrag } from './deal-drag.js';
import { DealFmt } from './deal-fmt.js';
import { DealHs } from './deal-hs.js';
import { DealLogistics } from './deal-logistics.js';
import { DealPresets } from './deal-presets.js';
import { DealRows } from './deal-rows.js';
import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { DealXlsx } from './deal-xlsx.js';
import { InputNum } from './input-num.js';
import { CbrRates } from '../kp/cbr-rates.js';
import { Currency } from '../kp/currency.js';
import { Toast } from '../../core/toast.js';
import { today } from '../../core/util.js';
import { FormView } from '../../ui/form-view.js';
import { ObjPath, Price } from '../../core/str.js';
import { Mobile } from '../../ui/mobile.js';
import { SidePanel } from '../../ui/side-panel.js';
import { KpState, S } from '../../core/state.js';

/**
 * Ввод в окне «Экономика сделки»: поля расчёта и КП (цены, закупка, курс, НДС), даты и дни платежей, готовые варианты
 * оплаты, список поставщиков и стран с клавиатуры, перетаскивание этапов и строк графика, кнопки действий.
 */
export class DealBind {
  static KOPECKS = 100;
  static SUP = /^sup\.(\d+)\./;
  static RESIZE_MS = 600;
  static MIN_W = 300;
  static COMBO_MS = 150;

  /**
   * Повесить обработчики на окно (один раз при создании).
   * @param {HTMLDialogElement} dlg
   */
  static bind(dlg) {
    const bind = new DealBind(dlg);
    DealWin.winRestore(dlg);
    DealLogistics.bind(dlg, () => bind.touch());
    bind.watchSize();
    bind.listen();
  }

  /**
   * @param {HTMLDialogElement} dlg
   */
  constructor(dlg) {
    this.dlg = dlg;
    this.sizeTimer = null;
  }

  /** Расчёт изменён: сохранить черновик и правую панель. */
  touch() {
    S.deal.touched = true;
    KpState.persist();
    SidePanel.render();
  }

  // правка цены, закупки, курса или НДС КП: updateLive сама перерисует правую панель и сохранит черновик
  _touchLive() {
    S.deal.touched = true;
    SidePanel.updateLive();
  }

  _done() {
    this.touch();
    DealWin.render();
  }

  /** Размер окна, изменённый потягиванием за угол, запоминается. */
  watchSize() {
    if (!window.ResizeObserver) return;
    const dlg = this.dlg;
    new ResizeObserver(() => {
      if (!dlg.open || Mobile.isPhone() || dlg.classList.contains('max')) return;
      clearTimeout(this.sizeTimer);
      this.sizeTimer = setTimeout(() => this._keepSize(), DealBind.RESIZE_MS);
    }).observe(dlg);
  }

  _keepSize() {
    const dlg = this.dlg;
    const rect = dlg.getBoundingClientRect();
    if (!(rect.width > DealBind.MIN_W)) return;
    dlg.style.width = `${Math.round(rect.width)}px`;
    dlg.style.height = `${Math.round(rect.height)}px`;
    DealWin.winSave(dlg);
  }

  /** Обработчики событий окна. */
  listen() {
    const dlg = this.dlg;
    dlg.addEventListener('input', event => this._input(event.target));
    dlg.addEventListener('focusin', event => this._focusIn(event.target));
    dlg.addEventListener('focusout', event => this._focusOut(event.target));
    dlg.addEventListener('keydown', event => this._key(event));
    dlg.addEventListener('cancel', event => {
      if (!DealUi.combo) return;
      event.preventDefault();
      DealCombo.close();
    });
    dlg.addEventListener('mousedown', event => {
      if (event.target.closest('.dl-cbl,.dl-cbb')) event.preventDefault();
    });
    dlg.addEventListener('change', event => this._change(event.target));
    new DealDrag(dlg, () => this.touch()).listen();
    dlg.addEventListener('toggle', event => this._toggle(event), true);
    dlg.addEventListener('click', event => this._click(event));
  }

  static INPUT = [
    ['costI', '_cost'],
    ['kppI', '_kpPrice'],
    ['kprate', '_kpRate'],
    ['kpvat', '_kpVat'],
    ['hsI', '_hs'],
  ];

  _input(field) {
    const hit = DealBind.INPUT.find(([key]) => field.dataset[key] != null);
    if (hit) {
      this[hit[1]](field);
      DealWin.render();
      return;
    }
    const path = field.dataset.dl;
    if (!path || field.tagName === 'SELECT') return;
    this._setField(path, field.value);
    if (field.dataset.combo) Object.assign(DealUi, { combo: path, comboAll: false, comboIx: -1 });
    DealSuppliers.changed(path);
    this._saveSupOf(path);
    this._done();
  }

  _setField(path, value) {
    ObjPath.set(DealState.deal(), path, value);
    DealDefaults.remember(path, value);
  }

  _saveSupOf(path) {
    const match = DealBind.SUP.exec(path);
    if (match) DealSuppliers.save(DealState.deal().sup[+match[1]]);
  }

  _cost(field) {
    const item = S.items[+field.dataset.costI];
    const value = InputNum.parse(field.value);
    item._costText = field.value;
    field.classList.toggle('bad', Number.isNaN(value));
    if (!Number.isNaN(value)) item.cost = value == null ? 0 : Math.round(value * DealBind.KOPECKS);
    this._touchLive();
  }

  // цена в КП поменялась вручную — «цена для расчёта» больше не нужна
  _kpPrice(field) {
    const item = S.items[+field.dataset.kppI];
    const price = Price.parse(field.value);
    item._priceText = field.value;
    item.price = Number.isNaN(price) ? 0 : price;
    item.priceManual = true;
    field.classList.toggle('bad', Number.isNaN(price) || !price);
    if (S.deal && S.deal.over) S.deal.over.price = '';
    this._touchLive();
  }

  _kpRate(field) {
    S.pricing.rates[field.dataset.kprate] = field.value;
    S.pricing.rateSrc = 'вручную';
    if (S.deal && S.deal.rates) delete S.deal.rates[field.dataset.kprate];
    this._touchLive();
  }

  _kpVat(field) {
    S.vat = field.value.replace(/[^\d.,]/g, '');
    this._touchLive();
  }

  _hs(field) {
    DealHs.set(field.dataset.hsI, { [field.dataset.f]: field.value });
    this.touch();
  }

  _focusIn(field) {
    if (!field.dataset.combo || DealUi.combo === field.dataset.combo) return;
    Object.assign(DealUi, { combo: field.dataset.combo, comboAll: true, comboIx: -1 });
    DealWin.render();
  }

  _focusOut(field) {
    if (field.dataset.combo) {
      setTimeout(() => {
        if (!document.activeElement?.closest?.('.dl-combo')) DealCombo.close();
      }, DealBind.COMBO_MS);
    }
    if (field.dataset.costI != null) {
      const item = S.items[+field.dataset.costI];
      if (!Number.isNaN(InputNum.parse(item._costText))) delete item._costText;
      KpState.persist();
      DealWin.render();
    }
    if (field.dataset.kppI != null) {
      const item = S.items[+field.dataset.kppI];
      if (!Number.isNaN(Price.parse(item._priceText))) delete item._priceText;
      KpState.persist();
      FormView.render();
      DealWin.render();
    }
  }

  static KEYS = { ArrowDown: '_arrow', ArrowUp: '_arrow', Enter: '_enter', Escape: '_escape', Tab: '_tab' };

  _key(event) {
    if (!event.target.dataset.combo) return;
    const method = DealBind.KEYS[event.key];
    if (method) this[method](event);
  }

  _arrow(event) {
    const field = event.target;
    const count = (DealUi.comboList || []).length;
    event.preventDefault();
    if (DealUi.combo !== field.dataset.combo) Object.assign(DealUi, { combo: field.dataset.combo, comboAll: true });
    const step = event.key === 'ArrowDown' ? 1 : -1;
    DealUi.comboIx = count ? ((DealUi.comboIx ?? -1) + step + count) % count : -1;
    DealWin.render();
    this.dlg.querySelector('.dl-cbl [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  _enter(event) {
    event.preventDefault();
    const picked = DealUi.comboList[DealUi.comboIx];
    if (DealUi.combo && DealUi.comboIx >= 0 && picked != null) DealCombo.pick(event.target.dataset.combo, picked);
    else DealCombo.close();
  }

  _escape(event) {
    if (!DealUi.combo) return;
    event.preventDefault();
    event.stopPropagation();
    DealCombo.close();
  }

  _tab() {
    DealCombo.close();
  }

  static CHANGE = [
    ['dlstart', '_start'],
    ['dldate', '_rowDate'],
    ['dlday', '_rowDay'],
    ['kpcur', '_kpCur'],
    ['dlpreset', '_preset'],
    ['dldd', '_termDate'],
    ['xcst', '_cashStage'],
    ['costcurI', '_costCur'],
    ['kpvat', '_kpDone'],
    ['kprate', '_kpDone'],
  ];

  _change(field) {
    const hit = DealBind.CHANGE.find(([key]) => field.dataset[key] != null);
    if (hit) {
      this[hit[1]](field);
      return;
    }
    if (field.dataset.dl && field.tagName === 'SELECT') {
      this._setField(field.dataset.dl, field.value);
      this._saveSupOf(field.dataset.dl);
      this._done();
    }
    if (field.dataset.hspick != null) this._hsPick(field);
    if (field.dataset.dlmap) {
      const deal = DealState.deal();
      deal.map = { ...(deal.map || {}), [field.dataset.dlmap]: field.value };
      this._done();
    }
  }

  _start(field) {
    const deal = DealState.deal();
    deal.start = field.value || '';
    deal.startAuto = false;
    if (!deal.start) {
      deal.start = today();
      deal.startAuto = true;
    }
    this._done();
  }

  _rowDate(field) {
    const day = DealCal.isoDay(field.value);
    if (day == null || day < 0) {
      Toast.show('Дата раньше дня 0 — укажите дату не раньше подписания договора');
      DealWin.render();
      return;
    }
    Toast.show(DealRows.setRowDay(field.dataset.dldate, day));
    this._done();
  }

  _rowDay(field) {
    const day = InputNum.parse(field.value);
    if (!(Number.isInteger(day) && day >= 0)) {
      Toast.show('День — целое число от 0');
      DealWin.render();
      return;
    }
    Toast.show(DealRows.setRowDay(field.dataset.dlday, day));
    this._done();
  }

  _kpCur(field) {
    Currency.setKp(field.value);
    this.touch();
  }

  _preset(field) {
    if (!field.value) return;
    const deal = DealState.deal();
    if (field.dataset.dlpreset === 'tr') {
      const preset = DealPresets.CUST[field.value];
      if (!preset) return;
      deal.cust.tr = JSON.parse(JSON.stringify(preset[1]));
      deal.days = {};
      Toast.show(`Оплата заказчика: ${preset[0]}`);
    } else {
      const preset = DealPresets.SUP[field.value];
      if (!preset) return;
      const sup = deal.sup[+field.dataset.k];
      sup.pay = JSON.parse(JSON.stringify(preset[1]));
      DealSuppliers.save(sup);
      Toast.show(`Оплата поставщику: ${preset[0]}`);
    }
    this._done();
  }

  // срок датой: дни от события, рабочие — по календарю
  _termDate(field) {
    if (!field.value) return;
    const deal = DealState.deal();
    if (!DealCal.contractDate()) {
      deal.start = today();
      deal.startAuto = true;
      Toast.show('Дата договора — сегодня. Её можно изменить вверху окна');
    }
    const base = +field.dataset.base || 0;
    const day = DealCal.isoDay(field.value);
    const count = DealBind._daysFrom(field.dataset.kind, base, day);
    if (!(count >= 0)) {
      Toast.show(`Дата раньше события, от которого считается срок (${DealCal.dayRu(base)}) — выберите дату позже`);
      DealWin.render();
      return;
    }
    ObjPath.set(deal, field.dataset.dldd, String(count));
    this._saveSupOf(field.dataset.dldd);
    this._done();
  }

  static _daysFrom(kind, base, day) {
    if (kind !== 'work') return day - base;
    return day >= base ? DealCal.countWork(base, day) : -1;
  }

  _cashStage(field) {
    const deal = DealState.deal();
    deal.xc = deal.xc || {};
    const off = { ...(deal.xc.off || {}) };
    if (field.checked) delete off[field.dataset.xcst];
    else off[field.dataset.xcst] = false;
    deal.xc.off = off;
    this._done();
  }

  _costCur(field) {
    S.items[+field.dataset.costcurI].costCur = field.value;
    if (field.value !== 'RUB' && !(Currency.rate(field.value) > 0)) CbrRates.fillEmpty();
    this._touchLive();
    DealWin.render();
  }

  _kpDone() {
    FormView.render();
  }

  _hsPick(field) {
    const cat = DealHs.cats().find(row => row.key === field.value);
    if (cat) {
      DealHs.set(field.dataset.hspick, { code: cat.code, duty: cat.duty });
      this.touch();
      Toast.show(`Код ${cat.code || '—'}, пошлина ${cat.duty === '' ? '— уточните' : `${cat.duty} %`} — «${cat.name}»`);
    }
    DealWin.render();
  }

  _toggle(event) {
    const key = event.target.dataset && event.target.dataset.more;
    if (key == null) return;
    DealUi.more = DealUi.more || {};
    DealUi.more[key] = event.target.open;
  }

  _click(event) {
    const button = event.target.closest('[data-dlx]');
    if (DealUi.combo && !event.target.closest('.dl-combo')) DealCombo.close();
    if (!button) return;
    const deal = DealState.deal();
    const action = button.dataset.dlx;
    const own = DealClicks.FINAL[action];
    if (own) {
      DealClicks[own](button, this);
      return;
    }
    const edit = DealClicks.EDIT[action];
    if (edit) DealClicks[edit](button, deal);
    this._done();
  }
}

/** Кнопки окна: действия без правки расчёта (FINAL) и правки расчёта с пересчётом (EDIT). */
export class DealClicks {
  static FINAL = {
    close: '_close',
    max: '_max',
    combo: '_combo',
    pick: '_pick',
    cbr: '_cbr',
    xlsx: '_xlsx',
    hsdir: '_hsDir',
    hsref: '_hsRef',
    apply: '_apply',
    mv: '_move',
    rowmv: '_rowMove',
    step: '_step',
  };
  static EDIT = {
    reset: '_reset',
    resetdays: '_resetDays',
    addbg: '_addBg',
    delbg: '_delBg',
    where: '_where',
    novat: '_noVat',
    asmon: '_asmOn',
    cusmode: '_cusMode',
    trmode: '_trMode',
    addsp: '_addSp',
    delsp: '_delSp',
    addtr: '_addTr',
    deltr: '_delTr',
    dock: '_dock',
    addsup: '_addSup',
    delsup: '_delSup',
  };
  static PCT = 100;

  static _close(button, bind) {
    bind.dlg.close();
  }

  static _max(button, bind) {
    bind.dlg.classList.toggle('max');
    DealWin.winSave(bind.dlg);
  }

  static _combo(button, bind) {
    const path = button.dataset.path;
    if (DealUi.combo === path) {
      DealCombo.close();
      return;
    }
    Object.assign(DealUi, { combo: path, comboAll: true, comboIx: -1 });
    DealWin.render();
    bind.dlg.querySelector(`[data-combo="${path}"]`)?.focus();
  }

  static _pick(button) {
    DealCombo.pick(button.dataset.path, button.dataset.v);
  }

  static _cbr() {
    CbrRates.load();
  }

  static _xlsx() {
    DealXlsx.save();
  }

  static _hsDir() {
    DealHs.dir();
  }

  static _report(message, bind) {
    if (message) {
      bind.touch();
      Toast.show(message);
    }
    DealWin.render();
  }

  static _hsRef(button, bind) {
    DealClicks._report(DealHs.useRef(button.dataset.id), bind);
  }

  static _apply(button) {
    DealState.applyPrice(+button.dataset.s);
  }

  static _move(button, bind) {
    DealClicks._report(DealRows.moveStage(button.dataset.grp, +button.dataset.i, +button.dataset.to), bind);
  }

  static _rowMove(button, bind) {
    DealClicks._report(DealRows.rowStep(button.dataset.key, +button.dataset.d), bind);
  }

  // новая вкладка — с начала, без анимации прокрутки; на телефоне вкладки прилипают к верху прокрутки
  static _step(button, bind) {
    DealUi.open = button.dataset.id;
    DealWin.render();
    const dlg = bind.dlg;
    const form = dlg.querySelector('.dl-form');
    const box = dlg.querySelector('.dl-b');
    const wrap = dlg.querySelector('.dl-tabw');
    const tabs = dlg.querySelector('.dl-tabs');
    if (form) form.scrollTop = 0;
    if (box && wrap && box.scrollTop > wrap.offsetTop) box.scrollTop = wrap.offsetTop;
    const active = tabs && tabs.querySelector('.dl-tab.on');
    if (active) tabs.scrollLeft = Math.max(0, active.offsetLeft - tabs.clientWidth / 2 + active.offsetWidth / 2);
  }

  static _reset(button, deal) {
    ObjPath.set(deal, button.dataset.path, '');
  }

  static _resetDays(button, deal) {
    deal.days = {};
  }

  static _addBg(button, deal) {
    const calc = DealCalculator.calc(DealState.inputs(), deal);
    const rate = String(DealTerms.bgRate()).replace('.', ',');
    deal.bg = [...(Array.isArray(deal.bg) ? deal.bg : []), { type: calc.advSum > 0 ? 'adv' : 'perf', rate }];
  }

  static _delBg(button, deal) {
    const k = +button.dataset.k;
    deal.bg = (deal.bg || []).filter((_, j) => j !== k);
  }

  static _where(button, deal) {
    const sup = deal.sup[+button.dataset.k];
    sup.where = button.dataset.v;
    if (button.dataset.v === 'ru') {
      sup.country = 'Россия';
      DealSuppliers.applyCountry(sup);
    } else if (/^росс/i.test(sup.country || '')) {
      sup.country = '';
      sup.cusMode = 'calc';
      sup.vatIn = false;
    }
    DealSuppliers.save(sup);
  }

  static _noVat(button, deal) {
    const sup = deal.sup[+button.dataset.k];
    sup.noVat = button.dataset.v === '1';
    DealSuppliers.save(sup);
  }

  static _asmOn(button, deal) {
    deal.asm = deal.asm || {};
    deal.asm.on = button.dataset.v === '1';
    DealSuppliers.asmAuto(deal);
  }

  static _cusMode(button, deal) {
    const sup = deal.sup[+button.dataset.k];
    sup.cusMode = button.dataset.v;
    DealSuppliers.save(sup);
  }

  static _trMode(button, deal) {
    const k = +button.dataset.k;
    const stage = deal.cust.tr[k];
    const calc = DealCalculator.calc(DealState.inputs(), deal);
    const parsed = calc.trs[k];
    if (button.dataset.v === 'sum' && stage.mode !== 'sum') {
      stage.mode = 'sum';
      stage.sum = parsed && parsed.p ? DealFmt.inp(Math.round((calc.S * parsed.p) / DealClicks.PCT)) : '';
    } else if (button.dataset.v === 'pct' && stage.mode === 'sum') {
      stage.mode = 'pct';
      stage.pct = parsed && parsed.p ? DealFmt.inp(parsed.p) : '';
    }
  }

  static _addSp(button, deal) {
    const sup = deal.sup[+button.dataset.k];
    sup.pay.splice(sup.pay.length - 1, 0, { name: '', pct: '', ev: 'ready', off: '0' });
    DealSuppliers.save(sup);
  }

  static _delSp(button, deal) {
    const sup = deal.sup[+button.dataset.k];
    sup.pay.splice(+button.dataset.j, 1);
    DealSuppliers.save(sup);
  }

  static _addTr(button, deal) {
    const list = deal.cust.tr;
    list.splice(list.length - 1, 0, { name: '', pct: '', ev: list.length > 1 ? 'ready' : 'sign', off: '0' });
  }

  static _delTr(button, deal) {
    deal.cust.tr.splice(+button.dataset.k, 1);
  }

  static _dock(button, deal) {
    deal.docK = { ...(deal.docK || {}) };
    deal.docK[button.dataset.v] = !deal.docK[button.dataset.v];
  }

  static _addSup(button, deal) {
    deal.sup.push(DealTerms.newSupplier(`s${Date.now().toString(36)}`, DealDefaults.get()));
  }

  static _delSup(button, deal) {
    const k = +button.dataset.k;
    const id = deal.sup[k].id;
    deal.sup.splice(k, 1);
    for (const item of Object.keys(deal.map)) if (deal.map[item] === id) delete deal.map[item];
  }
}
