import { DealCal } from './deal-cal.js';
import { DealSeen } from './deal-seen.js';
import { AppTabs } from '../../core/app-tabs.js';
import { DealCalculator } from './deal-calculator.js';
import { DealDefaults } from './deal-defaults.js';
import { DealHs } from './deal-hs.js';
import { DealSeller } from './deal-seller.js';
import { DealLogistics } from './deal-logistics.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { InputNum } from './input-num.js';
import { KpDate } from '../kp/kp-date.js';
import { Modal } from '../../core/modal.js';
import { AdminDialog } from '../admin/admin-core.js';
import { Toast } from '../../core/toast.js';
import { Currency } from '../kp/currency.js';
import { today } from '../../core/util.js';
import { DefRegistry } from '../../core/defaults.js';
import { Attrs } from '../../core/item-attrs.js';
import { KitDoc } from '../kit/kit-doc.js';
import { KpEconomics, PriceCalc } from '../kp/price-calc.js';
import { KpState, S } from '../../core/state.js';
import { KpForm } from '../../core/kp-form.js';

/**
 * Данные сделки: входы расчёта из КП, расчёт КП (новый — из «Умолчаний» и справочника поставщиков), цены позиций под цену
 * КП, открытие окна, краткий итог для правой панели, журнала и Битрикс24.
 */
export class DealState {
  static ISO = /^\d{4}-\d{2}-\d{2}$/;
  static KOPECKS = 100;
  static SHIFT_MAX = 20;
  static PROBE = 1.1;
  static PROBE_STEP = 0.1;
  static PAYS = 60;
  static LABEL = 120;
  static DIR_MARK = '\u0001';

  static _start(state) {
    return state.deal && DealState.ISO.test(state.deal.start || '') ? state.deal.start : '';
  }

  static _calendar(start) {
    if (!(start && DealCal.ready(start))) return {};
    return {
      isOff: day => DealCal.off(start, day),
      workShift: day => {
        let shifted = day;
        let guard = 0;
        while (DealCal.off(start, shifted) && guard++ < DealState.SHIFT_MAX) shifted++;
        return shifted;
      },
      addWork: DealCal.addWorkFn(start),
    };
  }

  /**
   * Данные конструктора для расчёта.
   * @param {object} [state]
   * @returns {object}
   */
  static kpInputs(state = S) {
    const econ = KpEconomics.of(state);
    const pricing = state.pricing || {};
    const rate = econ.cur === 'RUB' ? 1 : InputNum.parse(pricing.rates && pricing.rates[econ.cur]);
    const start = DealState._start(state);
    if (start && !DealCal.ready(start)) DealCal.load(start);
    return {
      ...DealState._calendar(start),
      date: start || today(),
      sumRub: rate > 0 ? (econ.sum / DealState.KOPECKS) * rate : 0,
      sumNoRate: !(rate > 0),
      cur: econ.cur,
      vat: +state.vat || 0,
      rates: { ...(pricing.rates || {}) },
      costNoVat: !!pricing.costNoVat,
      sellerVat: DealSeller.vatOf(state.deal),
      sellerUsn: DealSeller.usnOf(state.deal),
      sellerUsnRate: DealSeller.usnRateOf(state.deal),
      moneyAuto: DealDefaults.moneyAuto(),
      items: KitDoc.lines(state).map(line => DealState._line(line, state)),
    };
  }

  // доп — «Позиция — доп.: опция», элемент станции — «Станция: элемент»
  static _name(line) {
    if (line.opt) return `${line.of} — доп.: ${line.name}`;
    return line.of ? `${line.of}: ${line.name}` : line.name;
  }

  // обычная позиция — как есть, сборка — по элементам (у каждого своя валюта и поставщик)
  static _line(line, state) {
    const item = line.item;
    const hsCode = DealHs.of(item, state.deal);
    return {
      id: line.id,
      name: DealState._name(line),
      qty: line.qty,
      cost: (line.cost || 0) / DealState.KOPECKS,
      cur: line.costCur || 'RUB',
      cat: Attrs.of(item).cat,
      maker: line.maker || '',
      catId: item.catId || '',
      kit: !!line.part,
      role: (line.part && line.part.role) || '',
      code: hsCode.code,
      duty: InputNum.parse(hsCode.duty),
      hsSrc: hsCode.src,
    };
  }

  /**
   * Расчёт сделки КП: прежний — обновлённый, нового нет — по производителям позиций и справочнику поставщиков.
   * @returns {object}
   */
  static ensure() {
    if (S.deal && S.deal.v) {
      DealTerms.upgrade(S.deal);
      if (!S.deal.hs) S.deal.hs = {};
      DealSuppliers.autoMap(S.deal);
      DealSuppliers.asmAuto(S.deal);
      DealState.startAuto(S.deal);
      return S.deal;
    }
    const def = DealDefaults.get();
    const deal = DealTerms.blank(def);
    deal.hs = {};
    if (def.target) deal.target = { type: def.targetType || 'margin', v: def.target };
    DealState._suppliers(deal, def);
    S.deal = deal;
    DealSuppliers.asmAuto(deal);
    DealState.startAuto(deal);
    return deal;
  }

  // позиция каталога, закреплённая в справочнике за поставщиком, — к нему; остальные — по производителю
  static _suppliers(deal, def) {
    const dirOf = line =>
      line.item.catId && (DealUi.sups || []).find(dir => (dir.items || []).includes(line.item.catId));
    // опция без своего поставщика в справочнике — у поставщика позиции (DealSuppliers.of), своей карточки не заводит
    const lines = KitDoc.lines(S).filter(line => String(line.name || '').trim() && (!line.opt || dirOf(line)));
    const keyOf = line => {
      const dir = dirOf(line);
      return dir ? DealState.DIR_MARK + dir.id : line.maker || '';
    };
    deal.sup = [];
    deal.map = {};
    [...new Set(lines.map(keyOf))].forEach((key, k) => {
      const sup = DealState._supplier(key, k, { lines, keyOf, def });
      deal.sup.push(sup);
      lines
        .filter(line => keyOf(line) === key)
        .forEach(line => {
          deal.map[line.id] = sup.id;
        });
    });
    if (!deal.sup.length) deal.sup = [DealTerms.newSupplier('s1', def)];
  }

  static _supplier(key, k, { lines, keyOf, def }) {
    const sup = DealTerms.newSupplier(`s${k + 1}`, def);
    const fromDir =
      key[0] === DealState.DIR_MARK ? (DealUi.sups || []).find(dir => DealState.DIR_MARK + dir.id === key) : null;
    sup.name = fromDir ? fromDir.name : key;
    const dir = fromDir || DealSuppliers.dir(key);
    if (dir) {
      DealSuppliers.applyDir(sup, dir);
      return sup;
    }
    // страна по умолчанию — из «Умолчаний» (обычно Россия)
    const cur = lines.find(line => keyOf(line) === key && line.cost)?.costCur;
    if (cur && cur !== 'RUB') {
      sup.cur = cur;
      if (!sup.country) {
        sup.cusMode = 'calc';
        sup.log.cur = cur;
      }
    }
    return sup;
  }

  /**
   * Дата договора по умолчанию — сегодня: пока её не указали вручную, каждый день сдвигается на сегодня.
   * @param {object} deal
   */
  static startAuto(deal) {
    if (!deal || (!deal.start && !DefRegistry.value('deal.startToday'))) return;
    if (!deal.start) {
      deal.start = today();
      deal.startAuto = true;
    } else if (deal.startAuto && deal.start !== today()) deal.start = today();
  }

  /**
   * Входы расчёта текущего КП.
   * @returns {object}
   */
  static inputs() {
    return DealState.kpInputs();
  }

  /**
   * Расчёт сделки текущего КП.
   * @returns {object}
   */
  static deal() {
    return DealState.ensure();
  }

  /**
   * Цены позиций под цену КП: по закупке (одинаковая наценка), иначе по текущим ценам, иначе поровну.
   * @param {number} sumRub цена КП с НДС, ₽
   * @returns {object|null}
   */
  static plan(sumRub) {
    const cur = Currency.current();
    const rate = Currency.rate(cur);
    if (!(rate > 0)) return null;
    const items = S.items.filter(item => String(item.name || '').trim());
    if (!items.length) return null;
    const target = Math.round((sumRub / rate) * DealState.KOPECKS);
    const { weights, basis } = DealState._weights(items);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const totalOf = prices => DealState._total(items, prices);
    const pricesOf = sum =>
      items.map((item, k) => Math.max(0, PriceCalc.round(((weights[k] / total) * sum) / (+item.qty || 1))));
    const first = totalOf(pricesOf(target));
    const second = totalOf(pricesOf(target * DealState.PROBE));
    const sum =
      second !== first ? target + ((target - first) * (target * DealState.PROBE_STEP)) / (second - first) : target;
    const prices = pricesOf(sum);
    return { its: items, prices, total: totalOf(prices), target, basis, cur };
  }

  static _weights(items) {
    const rub = item => {
      const rate = Currency.rate(item.costCur || 'RUB');
      return item.cost > 0 && rate > 0 ? item.cost * rate * (+item.qty || 0) : 0;
    };
    let weights = items.map(rub);
    if (weights.every(weight => weight > 0))
      return { weights, basis: 'пропорционально закупке — у всех позиций одна наценка' };
    weights = items.map(item => (item.price || 0) * (+item.qty || 0));
    if (weights.every(weight => weight > 0)) return { weights, basis: 'пропорционально текущим ценам' };
    return { weights: items.map(item => +item.qty || 1), basis: 'поровну на единицу' };
  }

  static _total(items, prices) {
    const rows = S.items.map(item => {
      const k = items.indexOf(item);
      const options = (item.options || [])
        .filter(option => option.name)
        .map(option => ({ qty: +option.qty || 0, price: option.price || 0 }));
      return { qty: +item.qty || 0, price: k >= 0 ? prices[k] : item.price || 0, disc: item.disc, options };
    });
    return KPGen.totals(rows, +S.vat || 0).sum;
  }

  /**
   * Перенести цены в КП (после вопроса).
   * @param {number} sumRub
   */
  static async applyPrice(sumRub) {
    const plan = DealState.plan(sumRub);
    if (!plan) {
      Toast.show(
        Currency.rate(Currency.current()) > 0
          ? 'В КП нет позиций'
          : 'Нет курса валюты КП — укажите его в разделе «Цены»',
      );
      return;
    }
    const ok = await AdminDialog.confirm(
      'Перенести цены в КП?',
      `Итог КП с НДС: ${KPGen.money(KpState.totals().sum)} → ${KPGen.money(plan.total)} ${Currency.short(plan.cur)}. Цена распределена по позициям ${plan.basis}; опции и скидки не меняются.`,
      'Перенести цены',
    );
    if (!ok) return;
    plan.its.forEach((item, k) => {
      item.price = plan.prices[k];
      item.priceManual = true;
      delete item._priceText;
    });
    const deal = DealState.ensure();
    deal.over.price = '';
    deal.touched = true;
    KpForm.render();
    KpState.persist();
    DealWin.render();
    Toast.show(`Цены позиций перенесены: итог КП ${KPGen.money(plan.total)} ${Currency.short(plan.cur)}`);
  }

  /** Открыть окно «Экономика сделки»: сразу, содержимое — после загрузки справочников. */
  static async open() {
    if (!DealDefaults.allowed()) {
      Toast.show('Экономика сделки доступна автору КП и администратору');
      return;
    }
    DealUi.open = undefined;
    const dlg = Modal.host('dealdlg', 'dealwin', 'Экономика сделки', box => {
      DealWin.bind(box);
      box.addEventListener('close', () => DealSeen.close(DealState.deal()));
    });
    if (!dlg.open) {
      dlg.innerHTML =
        '<div class="dlg-h"><h3>Экономика сделки</h3><button class="icon" type="button" data-dlx="close" aria-label="Закрыть">✕</button></div><p class="empty">Загружаю…</p>';
    }
    AppTabs.show(dlg, 'deal');
    await Promise.all([DealSuppliers.loadDirs(), DealLogistics.loadAll(), DealSeller.load()]);
    DealSeller.sync(DealState.ensure());
    dlg.innerHTML = '';
    DealWin.show();
  }

  /**
   * Краткий итог для правой панели и журнала (только если расчёт заполнен); экономика полностью — для Битрикс24.
   * @param {object} [state]
   * @returns {object|null}
   */
  static summary(state = S) {
    if (!state.deal || !state.deal.touched) return null;
    const calc = DealCalculator.calc(DealState.kpInputs(state), state.deal);
    const base = calc.base;
    const full = DealState._full(calc, DealState._start(state));
    // для списка «Оплаты» Битрикс24: поставщики и НДС в закупке
    full.sup = (state.deal.sup || []).map(sup => ({
      name: String(sup.name || '').slice(0, DealState.LABEL),
      vatIn: Boolean(sup.vatIn),
    }));
    const cents = value => Math.round(value * DealState.KOPECKS) / DealState.KOPECKS;
    if (base) {
      return {
        confirmed: true,
        profit: cents(base.P),
        net: cents(base.net),
        margin: base.margin,
        markup: base.markup,
        full,
      };
    }
    const { lo: low, hi: high } = calc;
    return {
      confirmed: false,
      lo: Math.round(low.P),
      hi: Math.round(high.P),
      marginLo: low.margin,
      marginHi: high.margin,
      full,
    };
  }

  static _full(calc, start) {
    const cents = value => (Number.isFinite(value) ? Math.round(value * DealState.KOPECKS) / DealState.KOPECKS : null);
    const pays = (calc.rows || [])
      .filter(row => Number.isFinite(row.day) && row.amount)
      .slice(0, DealState.PAYS)
      .map(row => ({
        day: row.day,
        d: start ? KpDate.addDays(start, row.day) : '',
        t: String(row.label || '').slice(0, DealState.LABEL),
        a: cents(row.amount),
      }));
    return {
      price: cents(calc.S),
      revenue: cents(calc.R),
      cost: cents((calc.base || calc.lo).Ctot),
      fin: cents(calc.F),
      parts: (calc.parts || []).map(([name, value]) => [name, cents(value)]),
      pays,
      fix: Object.fromEntries(
        (calc.bxFix || []).filter(line => line.active).map(line => [line.key, cents(line.delta)]),
      ),
      calc: DealState._calc(calc),
    };
  }

  // для поправок из Битрикс24 на сервере (deal_econ.EconShift) — те же величины, что в DealCalculator.result
  static _calc(calc) {
    const side = res => ({ Pa: res.Pa, Ctot: res.Ctot });
    return {
      lo: side(calc.lo),
      hi: side(calc.hi),
      taxP: calc.taxP,
      taxBase: calc.taxBase,
      xMode: calc.xMode,
      xV: calc.xV,
      xG: calc.xG,
      R: calc.R,
      S: calc.S,
      sv: calc.sv,
      vatShare: calc.bxShare || {},
    };
  }
}
