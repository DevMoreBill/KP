import { Kit } from './kit.js';
import { AsmItem } from './asm-item.js';
import { Currency } from '../kp/currency.js';
import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';

/** Вкладка «Состав изделия» у сборного изделия: части из каталога, цена и закупка частей, «Изменить состав…». */
export class AsmTab {
  static LABEL = 'Состав изделия';

  /**
   * Подпись вкладки состава: у сборного изделия — «Состав изделия».
   * @param {object} item
   * @param {string} label подпись по умолчанию
   * @returns {string}
   */
  static label(item, label) {
    return Kit.simple(item) ? this.LABEL : label;
  }

  /**
   * HTML вкладки.
   * @param {object} item позиция КП
   * @param {number} index
   * @returns {string}
   */
  static html(item, index) {
    const parts = Kit.parts(item);
    const sums = AsmItem.sums(parts);
    const cur = Currency.short(Currency.current());
    const rows = parts.map(part => this._row(part)).join('');
    const edit = FEAT.on('asmItem')
      ? `<button class="btn primary" type="button" data-asmedit="${index}">Изменить состав, цену и работы…</button>`
      : '';
    return `<div class="ed-sec asm-tab">
      <p class="muted">Сборное изделие без компоновки: контейнер и оборудование — позиции каталога. Назначение (или описание ИИ), сводная таблица «${esc(AsmItem.SUMMARY)}», фото и галерея обновляются из карточек частей при изменении состава; свои блоки описания и таблицы остаются.</p>
      <div class="asm-list">${rows}</div>
      <p class="asm-tot">Сумма частей: <b>${KPGen.money(sums.sale)} ${esc(cur)}</b> · закупка ${KPGen.money(sums.cost)} руб.</p>
      <div class="row">${edit}</div></div>`;
  }

  static _row(part) {
    const photo =
      part.photo && part.photo.src
        ? `<img src="${esc(part.photo.src)}" alt="" loading="lazy">`
        : '<span class="kit-noimg"></span>';
    const role = part.role === 'container' ? 'контейнер' : '';
    const qty = (+part.qty || 1) > 1 ? ` × ${part.qty}` : '';
    const sup = part.sup ? ` · ${part.sup}` : '';
    return `<div class="asm-row">${photo}<span class="asm-nm"><b>${esc(part.name)}${esc(qty)}</b><small class="muted">${esc([role, part.price ? `${KPGen.money(part.price)} ${Currency.short(part.priceCur || 'RUB')}` : 'без цены'].filter(Boolean).join(' · '))}${esc(sup)}</small></span></div>`;
  }
}
