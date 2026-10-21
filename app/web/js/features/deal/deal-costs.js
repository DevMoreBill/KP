import { DealFmt } from './deal-fmt.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealTerms } from './deal-terms.js';
import { DealValues } from './deal-values.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/**
 * Вкладка «Расходы»: монтаж и ПНР, документация, прочее, резерв и бонусы; банковские гарантии; прочие расходы наличными
 * (% от чистой прибыли, % от продажи или сумма — «чистыми», на руки; после последней оплаты или с оплат заказчика).
 */
export class DealCosts {
  static XC_WHEN = [
    ['end', 'После последней оплаты заказчика'],
    ['pay', 'С оплат заказчика — по этапам'],
  ];
  static XC_MODES = [
    ['net', '% от чистой прибыли'],
    ['sale', '% от суммы продажи без НДС'],
    ['salevat', '% от суммы продажи с НДС'],
    ['sum', 'Сумма, ₽'],
  ];
  static XC_UNIT = { sum: '₽ на руки', sale: '% выручки без НДС', salevat: '% суммы с НДС' };
  static BG_BASE = {
    adv: [
      ['adv', 'от аванса заказчика'],
      ['pct', '% от цены КП'],
      ['sum', 'в рублях'],
    ],
    other: [
      ['pct', '% от цены КП'],
      ['sum', 'в рублях'],
      ['adv', 'от аванса заказчика'],
    ],
  };
  static BG_UNIT = { sum: '₽', adv: '% аванса' };
  static BG_ADV = 100;
  static BG_PCT = 10;
  static YEAR = 365;

  /**
   * Вкладка «Расходы».
   * @param {object} calc
   * @returns {string}
   */
  static step(calc) {
    const cash = (calc.base || calc.lo).K;
    const note = [
      calc.W + calc.Bn ? `резерв и бонусы ${Fmt.rub(calc.W + calc.Bn)}` : '',
      calc.BG ? `банковская гарантия ${Fmt.rub(calc.BG)}` : '',
      cash ? `наличные ${Fmt.rub(cash)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return DealSteps.html({
      n: 0,
      title: 'Расходы',
      sub: 'Всё необязательно: заполните то, что есть в сделке. Пустые поля не учитываются.',
      body: `${DealCosts._main(calc)}
        ${DealCosts.guarantees(calc)}
        ${DealCosts.cash(calc)}`,
      tot: [
        'Итого расходы',
        calc.M + calc.E + calc.Dc + calc.W + calc.Bn + calc.BG + cash,
        note ? `в т. ч. ${note}` : '',
      ],
      id: 'mnt',
    });
  }

  static _main(calc) {
    const deal = DealState.deal();
    const sum = calc.M + calc.E + calc.Dc + calc.W + calc.Bn;
    const fields = [
      DealFmt.field('Монтаж и ПНР', 'mnt', { calc, unit: '₽', hint: 'Платёж — при поставке' }),
      DealFmt.field('ПНР займут', 'pnr', {
        calc,
        int: true,
        date: { base: calc.D, val: calc.pnrDays },
        hint: 'После поставки — для оплаты «после ПНР»',
      }),
      DealFmt.field('Прочие расходы', 'oth', { calc, unit: '₽', hint: 'Платёж — при поставке' }),
    ].join('');
    return `<div class="dl-card dl-mb"><div class="dl-mbh"><h5>Монтаж, ПНР, документация и прочие расходы</h5><span class="dl-stc opt">необязательно</span>${sum > 0 ? `<b class="dl-mbs">${Fmt.rub(sum)}</b>` : ''}</div><div class="dl-g g3">
        ${fields}</div>
        ${DealCosts._docs(calc, deal)}
        ${DealCosts._other(calc, deal)}</div>`;
  }

  static _docs(calc, deal) {
    const field = DealFmt.field('Разработка документации', 'doc', {
      calc,
      unit: '₽',
      hint: 'Платёж — до отгрузки',
      q: 'Проектная (ПД), рабочая (РД) и исполнительная документация — если её разрабатываете вы или подрядчик. Отмеченные виды попадут в условия КП: «входит в стоимость».',
    });
    const kinds = Object.entries(DealTerms.DOC_KINDS)
      .map(([key, title]) => {
        const active = !!(deal.docK || {})[key];
        return `<button type="button" class="chip${active ? ' on' : ''}" data-dlx="dock" data-v="${key}" aria-pressed="${active}">${active ? '✓ ' : ''}${title.charAt(0).toUpperCase() + title.slice(1)}</button>`;
      })
      .join('');
    return `<div class="dl-doc">${field}
          <div class="dl-dock" role="group" aria-label="Виды документации"><span class="muted">Виды:</span>${kinds}</div></div>`;
  }

  static _other(calc, deal) {
    const open = DealFmt.filled(deal.vo, deal.warr, deal.bonus);
    const warr = DealFmt.field('Резерв на гарантию', 'warr', {
      calc,
      unit: '% выручки',
      ph: '1',
      q: 'Деньги на гарантийные случаи — процент от выручки без НДС.',
    });
    const bonus = DealFmt.field('Бонусы и комиссии', 'bonus', {
      calc,
      unit: '% выручки',
      q: 'Агентам, партнёрам, менеджерам — платятся после оплаты заказчика.',
    });
    const vat = DealFmt.field('Прочий НДС к вычету', 'vo', {
      calc,
      unit: '₽',
      q: 'НДС в монтаже и прочих расходах, если подрядчики с НДС.',
    });
    return `<details class="dl-more" data-more="oth"${DealFmt.more('oth', { open })}><summary>Ещё <span class="muted">— резерв на гарантию, бонусы с продажи, прочий НДС к вычету</span></summary><div class="dl-g g3">
          ${warr}${bonus}
          ${vat}</div></details>`;
  }

  static _head(title, help, sum) {
    return `<div class="dl-mbh"><h5>${title}</h5>${DealFmt.help(help)}<span class="dl-stc opt">необязательно</span>${sum > 0 ? `<b class="dl-mbs">${Fmt.rub(sum)}</b>` : ''}</div>`;
  }

  /**
   * Банковские гарантии: вид, сумма, срок, ставка банка; комиссия — в расходы.
   * @param {object} calc
   * @returns {string}
   */
  static guarantees(calc) {
    const list = DealState.deal().bg;
    const rows = (Array.isArray(list) ? list : []).map((guarantee, k) => DealCosts._guarantee(calc, k)).join('');
    const head = DealCosts._head(
      'Банковская гарантия',
      'Если заказчик просит безотзывную банковскую гарантию — на возврат аванса, исполнения договора или гарантийных обязательств, — добавьте её: комиссия банка войдёт в расходы.',
      calc.BG,
    );
    return `<div class="dl-card dl-mb">${head}
      ${rows}
      <div><button type="button" class="btn" data-dlx="addbg">+ Банковская гарантия</button></div></div>`;
  }

  static _guarantee(calc, k) {
    const guarantee = calc.bgs[k];
    const path = `bg.${k}`;
    return `<div class="dl-bg">
        <div class="dl-g g3">${DealCosts._bgSum(calc, guarantee, path)}</div>
        <div class="dl-g g3">${DealCosts._bgTerms(calc, guarantee, path)}</div>
        <p class="dl-bgr"><span>Сумма гарантии <b>${Fmt.rub(guarantee.amount)}</b> · комиссия банка <b>${Fmt.rub(guarantee.fee)}</b> <span class="muted">— при подписании договора, уменьшает прибыль</span></span><button type="button" class="lnk" data-dlx="delbg" data-k="${k}">Убрать</button></p></div>`;
  }

  static _bgPh(base) {
    if (base === 'adv') return DealFmt.inp(DealValues.num('deal.bgAdvPct', DealCosts.BG_ADV));
    return base === 'pct' ? DealFmt.inp(DealValues.num('deal.bgPct', DealCosts.BG_PCT)) : '500 000';
  }

  static _bgSum(calc, guarantee, path) {
    const type = DealFmt.field('Вид гарантии', `${path}.type`, { calc, select: Object.entries(DealTerms.BG_TYPES) });
    const base = DealFmt.field('Сумма гарантии', `${path}.base`, {
      calc,
      select: guarantee.type === 'adv' ? DealCosts.BG_BASE.adv : DealCosts.BG_BASE.other,
    });
    const value = DealFmt.field(guarantee.base === 'sum' ? 'Сумма' : 'Процент', `${path}.v`, {
      calc,
      unit: DealCosts.BG_UNIT[guarantee.base] || '% цены КП',
      ph: DealCosts._bgPh(guarantee.base),
    });
    return `${type}
          ${base}
          ${value}`;
  }

  static _bgDaysLabel(guarantee) {
    if (guarantee.type === 'adv') return 'до поставки';
    if (guarantee.type === 'perf') return 'до конца ПНР';
    return guarantee.daysAuto === DealCosts.YEAR ? 'год' : `${guarantee.daysAuto} дн.`;
  }

  static _bgTerms(calc, guarantee, path) {
    const rate = String(DealTerms.bgRate()).replace('.', ',');
    const days = DealFmt.field('Срок гарантии', `${path}.days`, {
      calc,
      int: true,
      auto: guarantee.daysAuto,
      autoLabel: DealCosts._bgDaysLabel(guarantee),
      date: { base: 0, val: guarantee.days, kind: false },
    });
    const bank = DealFmt.field('Ставка банка', `${path}.rate`, {
      calc,
      unit: '% годовых',
      ph: rate,
      q: `Комиссия банка за гарантию — процент годовых от суммы гарантии за её срок. По умолчанию ${rate} %; рынок 2026: обычно 1–3,5 %, в среднем около 2,2 % (Сбербанк — от 2 %, ВТБ — от 3,7 %). Впишите ставку своего банка.`,
    });
    const min = DealFmt.field('Минимальная комиссия', `${path}.min`, {
      calc,
      unit: '₽',
      ph: DealFmt.inp(DealValues.num('deal.bgMin', 0)),
      q: 'Если у банка есть минимальная комиссия за гарантию — впишите её.',
    });
    return `${days}
          ${bank}
          ${min}`;
  }

  static _how(calc, cash, res) {
    const value = DealFmt.inp(cash.v);
    if (cash.mode === 'net') {
      return `${value} % от чистой прибыли сделки ${Fmt.rub(Math.max(0, res.Pa - res.tax))} (после налога на прибыль, до этих расходов)`;
    }
    if (cash.mode === 'sale') return `${value} % от выручки без НДС ${Fmt.rub(calc.R)}`;
    return cash.mode === 'salevat' ? `${value} % от суммы продажи с НДС ${Fmt.rub(calc.S)}` : 'сумма на руки';
  }

  /**
   * Прочие расходы наличными.
   * @param {object} calc
   * @returns {string}
   */
  static cash(calc) {
    const deal = DealState.deal();
    const cash = calc.xc;
    const res = calc.base || calc.lo;
    const open = !!(deal.xc && Object.values(deal.xc).some(value => value != null && value !== ''));
    const head = DealCosts._head(
      'Прочие расходы (наличные)',
      'Не уменьшают налог на прибыль — вычитаются из чистой прибыли; в КП не выводятся.',
      res.K,
    );
    const when = cash.on || (open && cash.when === 'pay') ? DealCosts._when(calc, cash) : '';
    const result =
      res.K > 0
        ? `<p class="dl-cash-r">На руки <b>${Fmt.rub(res.X)}</b>${cash.cost ? ` · расход компании с получением наличных <b>${Fmt.rub(res.K)}</b>` : ''} <span class="muted">— ${esc(DealCosts._how(calc, cash, res))}</span></p>`
        : '';
    return `<div class="dl-card dl-mb dl-cash">${head}
      <div class="dl-g g3">
        ${DealCosts._cashFields(calc, cash)}</div>
      ${when}
      ${result}
  </div>`;
  }

  static _cashFields(calc, cash) {
    const sum = cash.mode === 'sum';
    const own = DealFmt.inp(DealValues.num('deal.xcCost', 0));
    const mode = DealFmt.field('Как считать', 'xc.mode', { calc, select: DealCosts.XC_MODES });
    const value = DealFmt.field(sum ? 'Сумма на руки' : 'Процент', 'xc.v', {
      calc,
      unit: DealCosts.XC_UNIT[cash.mode] || '% чистой прибыли',
      ph: sum ? '100 000' : '10',
      q: 'Сумма «чистыми» — столько получат на руки наличными, без каких-либо налогов. От чистой прибыли — процент от прибыли сделки после налога на прибыль (до этих расходов); от продажи — процент от суммы продажи без НДС или с НДС (цена КП).',
    });
    const cost = DealFmt.field('Стоимость наличных', 'xc.cost', {
      calc,
      unit: '%',
      ph: own,
      q: `Сколько процентов от перечисленной суммы удерживают за выдачу наличных. Расход компании = сумма на руки ÷ (1 − процент). Пустое поле — значение по умолчанию из «Настроек» (${own} %); если наличные уже есть — впишите 0.`,
    });
    return `${mode}
        ${value}
        ${cost}`;
  }

  static _when(calc, cash) {
    const field = DealFmt.field('Когда выдаются', 'xc.when', {
      calc,
      select: DealCosts.XC_WHEN,
      q: 'После последней оплаты — наличные не влияют на финансирование. С оплат заказчика — с каждой отмеченной оплаты выдаётся часть, пропорционально её сумме, в день оплаты; деньги уходят раньше — финансирование может вырасти.',
    });
    return `<div class="dl-g g2">${field}</div>
      ${cash.when === 'pay' ? DealCosts.cashStages(calc) : ''}`;
  }

  /**
   * С каких оплат заказчика выдаются наличные: отметки по этапам и сумма с каждой.
   * @param {object} calc
   * @returns {string}
   */
  static cashStages(calc) {
    const pays = calc.rows.filter(row => row.inflow && row.amount > 0);
    if (!pays.length) return '';
    const outs = calc.rows.filter(row => String(row.key).startsWith('xc:'));
    const rows = pays.map(row => DealCosts._stage(calc, row, outs)).join('');
    const none = calc.xc.from.length
      ? ''
      : '<p class="muted">Ни одна оплата не отмечена — наличные выдаются после последней оплаты заказчика.</p>';
    return `<div class="dl-cst" role="group" aria-label="С каких оплат заказчика">${rows}
      ${none}</div>`;
  }

  static _stageName(calc, row) {
    const stage = calc.trs[row.stage];
    if (stage && stage.name) return stage.name;
    const many = calc.trs.length > 1;
    if (row.stage === 0 && many) return 'Аванс';
    return stage && stage.last && many ? 'Окончательная оплата' : 'Оплата';
  }

  static _stage(calc, row, outs) {
    const active = calc.xc.off[row.stage] !== false;
    const out = outs.find(item => item.from === row.key);
    return `<label class="dl-cst-r${active ? '' : ' off'}"><input type="checkbox" data-xcst="${row.stage}"${active ? ' checked' : ''}><span>${esc(DealCosts._stageName(calc, row))} ${DealTerms.pctText(row.pct || 0)} <small class="muted">день ${row.day}</small></span><b>${out ? `−${Fmt.rub(-out.amount)}` : '—'}</b></label>`;
  }
}
