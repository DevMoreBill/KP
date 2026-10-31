import { DealLogistics } from './deal-logistics.js';
import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealUi } from './deal-ui.js';
import { LgGeo } from './lg-geo.js';
import { LgOffers } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { FEAT } from '../../core/features.js';
import { KitDoc } from '../kit/kit-doc.js';
import { KpState } from '../../core/state.js';
import { Api } from '../../core/net.js';
import { KpForm } from '../../core/kp-form.js';
import { Currency } from '../../core/currency.js';
import { DealLink } from '../../core/deal-link.js';

/**
 * Цены перевозчиков «дверь в дверь»: запрос по кнопке и сам, когда открыта вкладка «Логистика» и груз посчитан (после паузы
 * во вводе, один раз на набор данных). Сравнение и выбор предложения — LgOffers.
 */
export class LgAsk {
  static KOPECKS = 100;
  static NEAR = { top: 60, km: 150, count: 2 };
  static QUOTE_MS = 1200;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Запросить цены перевозчиков для поставщика.
   * @param {number} k номер поставщика
   */
  static async quote(k) {
    const sup = DealState.deal().sup[k];
    if (!sup) return;
    const res = LgState.res[sup.id];
    if (!res || res.need || LgState.busy[sup.id]) return;
    const key = LgOffers.quoteKey(res);
    const body = LgAsk._body(sup, res);
    LgState.busy[sup.id] = true;
    LgState.err[sup.id] = '';
    LgState.tried[key] = true;
    DealLink.render();
    try {
      const reply = await Api.request('/api/logistics/quote', {
        method: 'POST',
        headers: LgAsk.JSON_HEAD,
        body: JSON.stringify(body),
      });
      sup.lg.quote = { key, res: reply };
      KpState.persist();
    } catch (error) {
      LgState.err[sup.id] = `Не удалось запросить цены: ${error.message || error}`;
    }
    LgState.busy[sup.id] = false;
    DealLink.render();
    KpForm.renderSide();
  }

  static _body(sup, res) {
    const inp = DealLogistics.input(sup);
    const declared = KitDoc.cargo()
      .filter(item => String(item.name || '').trim() && DealSuppliers.of(item.id) === sup.id)
      .reduce(
        (sum, item) =>
          sum +
          (item.cost
            ? (item.cost / LgAsk.KOPECKS) * (+item.qty || 0) * (Currency.rate(item.costCur || 'RUB') || 0)
            : 0),
        0,
      );
    const near = point => LgGeo.nearBig(point, LgAsk.NEAR);
    return {
      from: {
        name: res.from && res.from.name,
        addr: String(sup.wh || '').trim() || (res.from && res.from.name),
        alt: near(res.from),
      },
      to: { name: res.to && res.to.name, addr: inp.to.addr, alt: near(res.to) },
      km: res.km,
      places: inp.items
        .filter(item => item.l && item.w && item.h && item.m && item.qty)
        .map(item => ({ l: item.l, w: item.w, h: item.h, m: item.m, qty: item.qty })),
      vehicles: res.vehicles.map(vehicle => ({
        id: vehicle.C.id,
        name: vehicle.C.name,
        extras: Math.round(vehicle.parts.slice(1).reduce((sum, part) => sum + part[1], 0)),
      })),
      ltl: !res.openOnly,
      unload: res.unload ? res.unload.cost : 0,
      model: Math.round(res.total),
      modelNote: LgOffers.note(res),
      declared,
    };
  }

  /** Цены перевозчиков — сами, когда открыта вкладка и груз посчитан (после паузы во вводе, один раз на набор данных). */
  static autoQuote() {
    if (!FEAT.on('carriers') || DealUi.open !== 'log' || !LgState.tar) return;
    DealState.deal().sup.forEach((sup, k) => LgAsk._later(sup, k));
  }

  static _later(sup, k) {
    const res = LgState.res[sup.id];
    if (!res || res.need) return;
    const key = LgOffers.quoteKey(res);
    if (LgOffers.quoteFor(sup, res) || LgState.tried[key] || LgState.busy[sup.id]) return;
    clearTimeout(LgState.quoteTimers[sup.id]);
    LgState.quoteTimers[sup.id] = setTimeout(() => {
      const now = LgState.res[sup.id];
      if (now && LgOffers.quoteKey(now) === key && DealUi.open === 'log') LgAsk.quote(k);
    }, LgAsk.QUOTE_MS);
  }
}
