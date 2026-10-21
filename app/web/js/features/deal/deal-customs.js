import { DealFmt } from './deal-fmt.js';
import { DealHs } from './deal-hs.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealValues } from './deal-values.js';
import { TnVed } from './tn-ved.js';
import { Attrs } from '../../core/item-attrs.js';
import { EquipTypes } from '../../core/equip-types.js';
import { S } from '../../core/state.js';
import { KitDoc } from '../kit/kit-doc.js';
import { esc } from '../../core/util.js';
import { Fmt } from '../../core/str.js';

/**
 * Вкладка «Таможня»: режим по поставщику (рассчитать по позициям, ЕАЭС, сумма целиком, нет), коды ТН ВЭД и пошлины
 * позиций, сбор по шкале, ввозной НДС; расчёт таможенных платежей наглядно.
 */
export class DealCustoms {
  static MODES = [
    ['calc', 'Рассчитать'],
    ['eaeu', 'ЕАЭС'],
    ['sum', 'Сумма целиком'],
    ['none', 'Нет'],
  ];
  static IVAT = [
    ['22', '22 %'],
    ['10', '10 %'],
    ['0', '0 %'],
  ];
  static BODY = { calc: '_calc', eaeu: '_eaeu', sum: '_bySum' };

  /**
   * Вкладка «Таможня»; без таможни у всех поставщиков — пусто.
   * @param {object} calc
   * @returns {string}
   */
  static html(calc) {
    const blocks = DealState.deal()
      .sup.map((sup, k) => DealCustoms._block(calc, sup, k))
      .join('');
    if (!blocks.trim()) return '';
    const own = calc.sup.reduce((sum, sup) => sum + sup.T - (sup.vi || 0), 0);
    return DealSteps.html({
      n: 2,
      title: 'Таможня и ввозные налоги',
      sub: 'Пошлина — по коду ТН ВЭД каждой позиции; ввозной НДС возвращается вычетом.',
      body: `${blocks}<p class="dl-foot-n">Код ТН ВЭД (10 знаков) и ставка подбираются по виду оборудования и его характеристикам — по ЕТТ ЕАЭС (${TnVed.RATES_AT});
        «справочно» с пометкой «проверьте» — код зависит от исполнения, его подтверждает таможенный брокер. Исправленный код и ставка запоминаются для модели. <button type="button" class="lnk" data-dlx="hsdir">Справочник кодов по категориям</button> · <a href="https://www.alta.ru/tnved/" target="_blank" rel="noopener">Проверить ставку на alta.ru ↗</a></p>`,
      tot: [
        'Итого платим на таможне',
        calc.Tsum,
        `из них в себестоимость ${Fmt.rub(own)}, остальное — ввозной НДС к вычету`,
      ],
      id: 'cus',
    });
  }

  static _block(calc, sup, k) {
    const customs = calc.sup[k];
    if (customs.mode === 'none' && /^росс/i.test(sup.country || '')) return '';
    const seg = DealCustoms.MODES.map(
      ([mode, title]) =>
        `<button type="button" class="${customs.mode === mode ? 'on' : ''}" data-dlx="cusmode" data-k="${k}" data-v="${mode}">${title}</button>`,
    ).join('');
    const method = DealCustoms.BODY[customs.mode];
    const body = method ? DealCustoms[method](calc, sup, k) : '<p class="muted">Таможни нет.</p>';
    return `<div class="dl-card"><div class="dl-ch"><b>${esc(customs.name)}${sup.country ? ` · ${esc(sup.country)}` : ''}</b><span class="dl-seg">${seg}</span></div>${body}</div>`;
  }

  static _calc(calc, sup, k) {
    const customs = calc.sup[k];
    const path = `sup.${k}`;
    const rows = DealCustoms._rows(customs, sup);
    const extra = DealCustoms._extraRow(calc, sup, k);
    const table =
      rows || extra
        ? `<div class="dl-tw dl-hsw"><table class="dl-it dl-hs"><thead><tr><th>Позиция</th><th>Код ТН ВЭД</th><th>Пошлина</th><th></th><th class="num">Тамож. стоимость</th><th class="num">Пошлина, ₽</th></tr></thead><tbody>${rows}${extra}</tbody></table></div>`
        : '';
    const own = DealValues.feeOwn() ? '; шкала изменена в «Настройках»' : '';
    const fee = DealFmt.field('Таможенный сбор', `${path}.fee`, {
      calc,
      unit: '₽',
      auto: customs.fee,
      autoLabel: 'по шкале',
      autoTitle: `Сбор за таможенные операции: ${DealValues.feeBand(customs.cv) || 'по таможенной стоимости'} (${DealValues.FEE_TITLE})`,
      q: `Фиксированная сумма за декларацию — зависит от общей таможенной стоимости партии (цена + доставка до границы + страховка): ${DealValues.feeText()} (${DealValues.FEE_TITLE}${own}).`,
    });
    return `${table}
          <div class="dl-g g3">${DealFmt.field('НДС на ввоз', `${path}.ivat`, { calc, select: DealCustoms.IVAT })}
            ${fee}</div>
          ${DealCustoms.summary(customs)}`;
  }

  // строки закупки поставщика: обычные позиции и элементы станций (у каждого свой код и пошлина)
  static _rows(customs, sup) {
    const cats = DealHs.cats();
    return KitDoc.lines(S)
      .filter(line => String(line.name || '').trim() && DealSuppliers.of(line.id) === sup.id)
      .map(line => DealCustoms._row(line, customs, cats))
      .join('');
  }

  static _row(line, customs, cats) {
    const item = line.item;
    const hsCode = DealHs.of(item);
    const own = customs.lines.find(row => row.id === line.id);
    const kind = item.role === 'container' ? 'блок-контейнер' : EquipTypes.byId(Attrs.of(item).cat).name;
    const options = cats
      .map(
        cat =>
          `<option value="${esc(cat.key)}">${esc(cat.name)} · ${esc(cat.code || '—')} · ${esc(cat.duty === '' ? '?' : cat.duty)} %</option>`,
      )
      .join('');
    return `<tr><td class="c-nm"><b>${esc(line.name)}</b><small>${line.of ? `в составе «${esc(line.of)}» · ` : ''}${esc(kind)}</small></td>
            <td><input type="text" class="hs" data-hs-i="${esc(item.id)}" data-f="code" value="${esc(hsCode.code)}" placeholder="0000 00 000 0" aria-label="Код ТН ВЭД"></td>
            <td><span class="dl-in"><input type="text" inputmode="decimal" class="hs-d" data-hs-i="${esc(item.id)}" data-f="duty" value="${esc(hsCode.duty)}" placeholder="?" aria-label="Ставка пошлины, %"><i>%</i></span></td>
            <td class="c-src">${DealHs.badge(item, hsCode)}${DealCustoms._special(own)}
              <select class="dl-hspick" data-hspick="${esc(item.id)}" aria-label="Взять код и ставку из справочника"><option value="">из справочника…</option>${options}</select></td>
            <td class="num">${own ? Fmt.rub(own.cv) : '—'}</td><td class="num">${own ? Fmt.rub(own.dutyA) : '—'}</td></tr>`;
  }

  static _special(line) {
    if (!line || !line.special) return '';
    const special = line.special;
    const until = special.until.split('-').reverse().join('.');
    const title = `${special.src}: ставка ${special.duty} % для товаров происхождения ${special.country} по ${until}. Происхождение другое — впишите свою ставку`;
    return `<span class="dl-badge warn" title="${esc(title)}">${special.duty} % — ${esc(special.country)}</span>`;
  }

  // прочая закупка у поставщика (опции, ЗИП): своя ставка или средняя по позициям поставщика
  static _extraRow(calc, sup, k) {
    const line = calc.sup[k].lines.find(row => row.id === 'extra');
    if (!line) return '';
    const path = `sup.${k}`;
    const own = String(sup.duty ?? '').trim() !== '';
    return `<tr><td class="c-nm"><b>Прочая закупка у поставщика</b><small>опции, ЗИП — из шага «Закупка»</small></td>
            <td><input type="text" class="hs" data-dl="${path}.hsx" value="${esc(sup.hsx || '')}" placeholder="0000 00 000 0" aria-label="Код ТН ВЭД прочей закупки"></td>
            <td><span class="dl-in"><input type="text" inputmode="decimal" class="hs-d${calc.err[`${path}.duty`] ? ' bad' : ''}" data-dl="${path}.duty" value="${esc(sup.duty ?? '')}" placeholder="${line.dutyAuto ? esc(DealFmt.inp(line.duty)) : '?'}" aria-label="Ставка пошлины прочей закупки, %"><i>%</i></span></td>
            <td class="c-src">${DealCustoms._extraBadge(own, line)}</td>
            <td class="num">${Fmt.rub(line.cv)}</td><td class="num">${Fmt.rub(line.dutyA)}</td></tr>`;
  }

  static _extraBadge(own, line) {
    if (own) return '<span class="dl-badge kp">вручную</span>';
    if (!line.dutyAuto) return '<span class="dl-badge warn">укажите</span>';
    return '<span class="dl-badge kp" title="Средняя ставка позиций этого поставщика, взвешенная по стоимости. Впишите свою, если прочая закупка облагается иначе.">как у позиций</span>';
  }

  static _eaeu(calc, sup, k) {
    return `<div class="dl-g g3">${DealFmt.field('НДС при ввозе', `sup.${k}.ivat`, { calc, select: DealCustoms.IVAT })}</div>
          ${DealCustoms.summary(calc.sup[k], { eaeu: true })}`;
  }

  static _bySum(calc, sup, k) {
    const customs = calc.sup[k];
    const path = `sup.${k}`;
    const total = DealFmt.field('Таможенные платежи целиком', `${path}.cus.v`, {
      calc,
      cur: `${path}.cus.cur`,
      q: 'Пошлина, сбор и ввозной НДС одной суммой — например, по расчёту брокера.',
    });
    const vat = DealFmt.field('Из них ввозной НДС к вычету', `${path}.vi`, {
      calc,
      unit: '₽',
      ph: customs.T ? 'Сумма по декларации' : '0',
      unknown: customs.T > 0,
      hint: customs.T ? 'Пусто — сумма неизвестна (не ноль). Нет права на вычет — 0.' : '',
    });
    return `<div class="dl-g">${total}
          ${vat}</div>`;
  }

  static _cell(label, value, note, cls = '') {
    return `<div class="dl-cx ${cls}"><small>${label}</small><b>${Fmt.rub(value)}</b>${note ? `<em>${note}</em>` : ''}</div>`;
  }

  /**
   * Из чего складывается сумма к оплате на таможне и что вернётся вычетом.
   * @param {object} cs поставщик в расчёте
   * @param {{eaeu?: boolean}} [kind]
   * @returns {string}
   */
  static summary(customs, kind = {}) {
    const eaeu = !!kind.eaeu;
    const cell = DealCustoms._cell;
    const base = eaeu
      ? cell('Стоимость оборудования', customs.cv, 'база для НДС')
      : cell('Таможенная стоимость', customs.cv, 'оборудование + перевозка до границы + страхование');
    const vatNote = eaeu
      ? 'платится в налоговую → вернётся вычетом'
      : `(стоимость + пошлина) × ${DealFmt.inp(customs.ivP)} % → вернётся вычетом`;
    return `<div class="dl-cus2">
      <div class="dl-cbase">${base}</div>
      <div class="dl-cpay">${eaeu ? '' : DealCustoms._duties(customs)}
        ${cell(`НДС при ввозе ${DealFmt.inp(customs.ivP)} %`, customs.ivatA, vatNote, 'vat')}</div>
      <div class="dl-ctot"><small>${eaeu ? 'Платим НДС при ввозе' : 'Платим на таможне'}</small><b>${Fmt.rub(customs.T)}</b><em>из них в себестоимость: <b>${Fmt.rub(customs.T - customs.ivatA)}</b></em></div></div>
      ${eaeu ? '<p class="dl-foot-n">Из стран ЕАЭС пошлины и таможенного сбора нет (Договор о ЕАЭС).</p>' : ''}`;
  }

  static _duties(customs) {
    const band =
      customs.feeAuto && DealValues.feeBand(customs.cv)
        ? `${DealValues.feeBand(customs.cv).replace(/ → сбор.*/, '')} · `
        : '';
    return `${DealCustoms._cell('Пошлина', customs.dutyA, 'по ставкам позиций → в себестоимость')}${DealCustoms._cell('Таможенный сбор', customs.fee, `${band}по шкале ПП РФ № 1637 → в себестоимость`)}`;
  }
}
