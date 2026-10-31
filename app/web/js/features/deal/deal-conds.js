import { DealCal } from './deal-cal.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { S } from '../../core/state.js';
import { KpDate } from '../../core/kp-date.js';
import { CondAuto } from '../../core/cond-auto.js';

/**
 * Условия КП из экономики сделки: срок поставки, этапы оплаты, монтаж и ПНР, документация — человеческим текстом.
 * Подставляются, пока поле пустое или в нём прежняя подстановка (S.condAuto); вписанное вручную не меняется.
 */
export class DealConds {
  static MNT = 'Монтаж, ШМР и ПНР';
  static DOC = 'Документация';
  static LABELS = ['Срок поставки', 'Условия оплаты', DealConds.MNT, DealConds.DOC];
  static DOC_GEN = { pd: 'проектной', rd: 'рабочей', id: 'исполнительной' };
  static EPS = 0.004;
  static WHEN = {
    sign: ['при подписании договора', 'с даты подписания договора'],
    ready: [
      'перед отгрузкой, по уведомлению о готовности оборудования',
      'после уведомления о готовности оборудования к отгрузке',
    ],
    pnr: ['после завершения пусконаладочных работ', 'после завершения пусконаладочных работ'],
    delivery: ['по факту поставки оборудования', 'после поставки оборудования'],
  };

  /**
   * Когда платит заказчик — словами, как в договоре.
   * @param {object} stage этап оплаты
   * @returns {string}
   */
  static when(stage) {
    const days = +stage.off || 0;
    const [now, after] = DealConds.WHEN[stage.ev] || DealConds.WHEN.delivery;
    if (stage.ev === 'pnr') return `${days ? `в течение ${KpDate.daysText(days, stage.offK)} ` : ''}${after}`;
    return days ? `в течение ${KpDate.daysText(days, stage.offK)} ${after}` : now;
  }

  /**
   * Название этапа для условий: своё (если осмысленное) или по месту в графике.
   * @param {object} stage
   * @param {number} k
   * @param {number} count
   * @returns {string}
   */
  static name(stage, k, count) {
    const own = String(stage.name || '').trim();
    // название, повторяющее событие («Перед отгрузкой», «После поставки»), не пишем — событие и так в тексте
    const dup =
      own &&
      DealConds.when(stage)
        .toLowerCase()
        .includes(own.toLowerCase().replace(/^после /, ''));
    if (own && !dup && !/^(оплата|платёж|платеж)( \d+)?$/i.test(own)) return own;
    if (count === 1) return '';
    if (k === 0 && stage.ev === 'sign') return 'Аванс';
    return k === count - 1 ? 'Окончательный расчёт' : '';
  }

  /**
   * Условия КП из расчёта сделки.
   * @param {object} calc
   * @returns {object} { подпись условия: текст }
   */
  static suggest(calc) {
    const out = {};
    const deal = DealState.deal();
    const lead = DealLeadTime.of(calc);
    if (lead) {
      const start = DealCal.contractDate();
      const until = start && !deal.startAuto ? ` (ориентировочно до ${DealCal.dayRu(calc.D)})` : '';
      out['Срок поставки'] = `${KpDate.daysText(lead.n, lead.kind)} с даты подписания договора${until}`;
    }
    const pay = DealConds._payment(calc);
    if (pay) out['Условия оплаты'] = pay;
    if (calc.M > 0) out[DealConds.MNT] = DealConds._mounting(calc, deal);
    const docs = Object.keys(DealConds.DOC_GEN)
      .filter(key => deal.docK && deal.docK[key])
      .map(key => DealConds.DOC_GEN[key]);
    if (calc.Dc > 0 || docs.length)
      out[DealConds.DOC] = `Разработка ${DealConds._docs(docs)} документации входит в стоимость`;
    return out;
  }

  static _payment(calc) {
    const stages = calc.trs.filter(stage => stage.p > DealConds.EPS);
    if (stages.length === 1) return DealConds._single(stages[0]);
    return stages
      .map((stage, k) => {
        const name = DealConds.name(stage, k, stages.length);
        const lead = name ? `${k ? name.charAt(0).toLowerCase() + name.slice(1) : name} ` : '';
        return `${lead}${DealTerms.pctText(stage.p)} — ${DealConds.when(stage)}`;
      })
      .join('; ');
  }

  static _single(stage) {
    if (stage.ev === 'sign' && !+stage.off) return '100 % предоплата при подписании договора';
    const name = DealConds.name(stage, 0, 1);
    return `${name ? `${name} ` : ''}100 % ${stage.ev === 'sign' && !name ? 'предоплата ' : ''}${DealConds.when(stage)}`;
  }

  static _mounting(calc, deal) {
    const days = calc.pnrDays
      ? ` и выполняются в течение ${KpDate.daysText(calc.pnrDays, deal.pnrK === 'work' ? 'work' : '')} после поставки оборудования`
      : '';
    return `Монтажные и пусконаладочные работы входят в стоимость${days}`;
  }

  static _docs(docs) {
    if (!docs.length) return 'проектной, рабочей и исполнительной';
    if (docs.length === 1) return docs[0];
    return `${docs.slice(0, -1).join(', ')} и ${docs[docs.length - 1]}`;
  }

  /**
   * Подставить условия из расчёта в раздел «Условия».
   * @param {object} calc
   * @returns {boolean} что-то изменилось
   */
  static sync(calc) {
    if (!S.deal || !S.deal.touched || !Array.isArray(S.conditions)) return false;
    const suggested = DealConds.suggest(calc);
    S.condAuto = S.condAuto || {};
    let changed = false;
    for (const label of DealConds.LABELS) changed = CondAuto.apply(label, suggested[label] || '') || changed;
    return changed;
  }
}

/**
 * Срок поставки для условий КП: в рабочих днях, если все отрезки заданы в рабочих днях, иначе — календарный итог расчёта.
 * Сборка станции — цепочкой: max(контейнер готов; элементы доехали до сборщика) + сборка + доставка станции.
 */
export class DealLeadTime {
  /**
   * Все сроки поставщика — в рабочих днях.
   * @param {object} sup
   * @returns {boolean}
   */
  static work(sup) {
    return sup.prodK === 'work' && sup.shipK === 'work';
  }

  /**
   * Срок поставки: { n, kind }; нет активных поставщиков — null.
   * @param {object} calc
   * @returns {{n: number, kind: string}|null}
   */
  static of(calc) {
    const active = calc.sup.filter(sup => sup.active);
    if (!(calc.D > 0) || !active.length) return null;
    const asm = calc.asm;
    if (asm && asm.A) return DealLeadTime._assembled(calc, asm, active);
    if (!active.every(sup => this.work(sup))) return { n: calc.D, kind: '' };
    return { n: Math.max(...active.map(sup => sup.prod + sup.ship)), kind: 'work' };
  }

  static _assembled(calc, asm, active) {
    const toAsm = asm.toAsm.filter(sup => sup.active);
    const rest = active.filter(sup => sup !== asm.A && !toAsm.includes(sup));
    const work = this.work(asm.A) && asm.daysK === 'work' && [...toAsm, ...rest].every(sup => this.work(sup));
    if (!work) return { n: calc.D, kind: '' };
    const ready = Math.max(asm.A.prod, ...toAsm.map(sup => sup.prod + sup.ship));
    return { n: Math.max(ready + asm.days + asm.A.ship, ...rest.map(sup => sup.prod + sup.ship)), kind: 'work' };
  }
}
