import { LgFmt } from './lg-fmt.js';
import { LgState } from './lg-state.js';
import { LgValues } from './lg-values.js';
import { Fmt } from '../../core/str.js';

/**
 * Предложения перевозчиков (ATI.SU, ПЭК, Энергия, Деловые Линии, КИТ, СДЭК, Возовоз, ЖелДорЭкспедиция — сервер
 * /api/logistics/quote) «дверь в дверь» в одних условиях: перевозка, агент-экспедитор (не у сборного груза), страхование,
 * разгрузка; итог — выбранное или максимальное предложение без «выбросов».
 */
export class LgOffers {
  static PCT = 100;

  /**
   * Ключ набора данных расчёта для запроса цен.
   * @param {object} res расчёт перевозки
   * @returns {string}
   */
  static quoteKey(res) {
    return JSON.stringify([
      res.from && res.from.name,
      res.to && res.to.name,
      res.km,
      res.vehicles.map(vehicle => `${vehicle.C.id}:${Math.round(vehicle.cost)}`),
      res.unload && res.unload.id,
      Math.round(res.transport || 0),
    ]);
  }

  /**
   * Полученные цены перевозчиков для текущего расчёта.
   * @param {object} sup
   * @param {object} res
   * @returns {object|null}
   */
  static quoteFor(sup, res) {
    const quote = sup.lg && sup.lg.quote;
    return quote && quote.key === LgOffers.quoteKey(res) ? quote : null;
  }

  /**
   * Откуда ставки машин расчёта.
   * @param {object} res
   * @returns {string}
   */
  static rateSrc(res) {
    const src = [
      ...new Set(
        res.vehicles.map(
          vehicle => vehicle.C.src + (vehicle.C.srcAt ? ` от ${Fmt.dateTime(vehicle.C.srcAt).slice(0, 10)}` : ''),
        ),
      ),
    ];
    return src.join('; ') || 'тарифы «Настроек»';
  }

  /**
   * Подпись расчёта по тарифам: машины и откуда ставки.
   * @param {object} res
   * @returns {string}
   */
  static note(res) {
    return [res.vehicles.map(vehicle => vehicle.C.name).join(' + '), LgOffers.rateSrc(res)].filter(Boolean).join('; ');
  }

  /**
   * Предложения «дверь в дверь»: расчёт по тарифам и цены перевозчиков (станция в сборе — без сборного груза).
   * @param {object} res
   * @param {object|null} quote
   * @returns {object[]}
   */
  static offers(res, quote) {
    const out = [];
    const add = offer => out.push(LgOffers._full(offer, res));
    add({
      id: 'model',
      src: 'Тарифы «Настроек»',
      kind: 'model',
      base: res.transport,
      note: LgOffers.note(res),
      days: res.days,
    });
    for (const offer of (quote && quote.res && quote.res.offers) || []) {
      if (offer.kind === 'model' || !offer.complete || (res.openOnly && offer.kind === 'ltl')) continue;
      add(LgOffers._carrier(offer, res));
    }
    return out;
  }

  static _carrier(offer, res) {
    const base = offer.base != null ? offer.base : offer.price - (offer.unload || 0) - (offer.ins || 0);
    return {
      id: offer.src,
      src: offer.src,
      kind: offer.kind,
      base,
      insTk: +offer.ins || 0,
      local: offer.door === false ? 2 * (res.localLeg || 0) : 0,
      note: offer.note || '',
      days: offer.days,
      url: offer.url,
    };
  }

  // перевозчик сборного груза — без агента, его страхование — вместо своего; отдельная машина и тарифы — через агента
  static _full(offer, res) {
    const tariffs = LgState.tar;
    const unload = res.unload ? res.unload.cost : 0;
    const local = offer.local || 0;
    const ltl = offer.kind === 'ltl';
    const agent = ltl
      ? 0
      : Math.round(((offer.base + local + (LgValues.agentUnload() ? unload : 0)) * tariffs.agentPct) / LgOffers.PCT);
    const insTk = ltl && offer.insTk > 0;
    const ins = insTk ? offer.insTk : res.ins;
    return { ...offer, local, agent, ins, insTk, unload, total: Math.round(offer.base + local + agent + ins + unload) };
  }

  /**
   * Итог: выбранное предложение или максимальное (без «выбросов»); сноска — из чего цена и с чем сравнивали.
   * @param {object} res
   * @param {object|null} quote
   * @param {string} [pick]
   * @returns {object}
   */
  static final(res, quote, pick) {
    const offers = LgOutlier.mark(LgOffers.offers(res, quote));
    const normal = offers.filter(offer => !offer.outlier);
    const pool = normal.length ? normal : offers;
    const max = pool.reduce((best, offer) => (offer.total > best.total ? offer : best), pool[0]);
    const chosen = (pick && pick !== 'max' && offers.find(offer => offer.id === pick)) || max;
    const picked = chosen !== max || (pick && pick !== 'max');
    const others = offers
      .filter(offer => offer !== chosen)
      .map(
        offer =>
          `${offer.src} — ${Fmt.rub(offer.total)}${offer.outlier ? ` (выброс: в ${LgFmt.comma(offer.outlier)} раза дороже остальных, в максимум не взят)` : ''}`,
      );
    const when =
      quote && quote.res ? `, данные на ${Fmt.dateTime(quote.res.at)}` : ' (цены перевозчиков ещё не получены)';
    const compare = others.length ? ` Для сравнения: ${others.join(', ')}.` : '';
    const head = `Цена — ${picked ? 'выбрано' : 'максимальное предложение'}: ${chosen.src}${chosen.note ? ` (${chosen.note})` : ''}${when}`;
    return {
      price: chosen.total,
      name: chosen.src,
      src: chosen.kind,
      chosen,
      max,
      offers,
      picked,
      foot: `${head}. Дверь в дверь: ${LgOffers._parts(res, chosen).join(' + ')}.${compare}`,
    };
  }

  static _parts(res, chosen) {
    const tariffs = LgState.tar;
    const ins = chosen.insTk
      ? `страхование ${chosen.src} ${Fmt.rub(chosen.ins)}`
      : `страхование ${LgFmt.comma(tariffs.insPct)} %${res.insBase ? ` от ${Fmt.rub(res.insBase)}` : ''} ${Fmt.rub(chosen.ins)}`;
    return [
      `перевозка ${Fmt.rub(chosen.base)}`,
      chosen.local ? `забор и доставка по городу ${Fmt.rub(chosen.local)}` : '',
      chosen.agent ? `агент ${LgFmt.comma(tariffs.agentPct)} % ${Fmt.rub(chosen.agent)}` : '',
      ins,
      chosen.unload ? `разгрузка ${Fmt.rub(chosen.unload)}` : '',
    ].filter(Boolean);
  }
}

/**
 * Цена перевозчика во много раз выше остальных (ошибка расчёта перевозчика, негабарит по его правилам) не становится
 * «максимальным предложением»: offer.outlier — во сколько раз дороже медианы остальных.
 */
export class LgOutlier {
  static MIN_OFFERS = 3;
  static TENTHS = 10;

  /**
   * Медиана.
   * @param {number[]} values
   * @returns {number}
   */
  static median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const count = sorted.length;
    if (!count) return 0;
    return count % 2 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  }

  /**
   * Пометить выбросы.
   * @param {object[]} offers
   * @returns {object[]}
   */
  static mark(offers) {
    const factor = LgValues.outlierK();
    if (!factor || offers.length < LgOutlier.MIN_OFFERS) return offers;
    for (const offer of offers) {
      const median = this.median(offers.filter(other => other !== offer && other.total > 0).map(other => other.total));
      if (median > 0 && offer.total > factor * median)
        offer.outlier = Math.round((offer.total / median) * LgOutlier.TENTHS) / LgOutlier.TENTHS;
    }
    return offers;
  }
}
