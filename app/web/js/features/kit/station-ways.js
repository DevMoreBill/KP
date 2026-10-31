import { FEAT } from '../../core/features.js';
import { esc } from '../../core/util.js';

/**
 * Два равноправных способа создать станцию выбранного вида — карточками рядом (на телефоне — друг под другом): «Подобрать и
 * скомпоновать» (подбор по требованиям, компоновка, чертёж, 3D, расчёты) и «Собрать из готовых позиций» (сборное изделие).
 * Открытый способ отмечен, другой — нажатием. «Сборное изделие» выключено — карточек нет, только прежний подбор.
 */
export class StationWays {
  static WAYS = [
    {
      key: 'layout',
      icon: '⚙',
      title: 'Подобрать и скомпоновать',
      text: 'по требованиям: подбор, компоновка, чертёж, 3D, расчёты',
    },
    {
      key: 'asm',
      icon: '🧩',
      title: 'Собрать из готовых позиций',
      text: 'контейнер и оборудование: из каталога, по ссылке или из техничек с ИИ',
    },
  ];

  /**
   * Карточки способов (только в КП и при включённом «Сборном изделии»).
   * @param {string} cat категория станции
   * @param {string} current layout | asm — открытый способ
   * @returns {string}
   */
  static html(cat, current) {
    if (!FEAT.on('asmItem')) return '';
    const cards = this.WAYS.map(way => this._card(way, cat, way.key === current)).join('');
    return `<div class="nw-ways" role="group" aria-label="Способ создания">${cards}</div>`;
  }

  static _card(way, cat, active) {
    const attr = way.key === 'asm' ? `data-asmnew="${esc(cat)}"` : `data-asmway="${esc(cat)}"`;
    return `<button type="button" class="nw-way${active ? ' on' : ''}" ${active ? 'aria-current="true" tabindex="-1"' : attr}><i aria-hidden="true">${way.icon}</i><span><b>${esc(way.title)}</b><small>${esc(way.text)}</small></span></button>`;
  }
}
