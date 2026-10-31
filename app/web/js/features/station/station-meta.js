import { ContainerKind } from '../layout/container-kind.js';
import { DocLink } from '../../core/doc-link.js';
import { HydroScheme } from '../eskd/hydro-scheme.js';
import { Kit } from '../../core/kit.js';
import { Mm } from '../layout/mm.js';
import { S } from '../../core/state.js';
import { StationScheme } from '../eskd/station-scheme.js';
import { esc } from '../../core/util.js';

/** Станция для листов и вкладки: подписи основной надписи, организация, картинка-ссылка, схема, кнопка замены контейнера. */
export class StationMeta {
  static FULL_NAME = 3;

  /**
   * Надписи листов и 3D-вида: название, контейнер, цвет, основная надпись (организация, «Разраб.», дата).
   * @param {object} item
   * @param {object} plan
   * @returns {object}
   */
  static meta(item, plan) {
    const container = Kit.container(item);
    const developer = String((S.manager || {}).name || '')
      .trim()
      .replace(/\s+/g, ' ');
    return {
      title: String(item.name || '').trim() || 'Станция в контейнере',
      cont: container ? ContainerKind.of(container.ctype).name : 'Контейнер',
      colorText: plan.colorText ? `цвет ${plan.colorText}` : '',
      org: this.org(),
      dev: this.short(developer),
      date: S.date || '',
    };
  }

  /**
   * Организация для основной надписи: из настроек шаблона КП.
   * @returns {string}
   */
  static org() {
    const pack = DocLink.pack();
    const settings = (pack && pack.settings) || {};
    const template = DocLink.template() || {};
    return String(
      settings.company || template.company || (settings.brandParts || []).map(part => part[0]).join('') || 'ПНЕВМОТЕХ',
    ).trim();
  }

  /**
   * «Иванов Иван Иванович» → «Иванов И. И.»; два слова — как есть.
   * @param {string} name
   * @returns {string}
   */
  static short(name) {
    const words = name.split(' ').filter(Boolean);
    return words.length >= this.FULL_NAME ? `${words[0]} ${words[1][0]}. ${words[2][0]}.` : name;
  }

  /**
   * SVG → адрес картинки.
   * @param {string} svg
   * @returns {string}
   */
  static url(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Схема станции: компрессорная — пневматическая, насосная — гидравлическая; иначе null.
   * @param {object} plan
   * @returns {{cls: object, title: string, name: string}|null}
   */
  static scheme(plan) {
    if (StationScheme.ok(plan))
      return { cls: StationScheme, title: 'Схема пневматическая', name: 'Схема пневматическая принципиальная' };
    if (HydroScheme.ok(plan))
      return { cls: HydroScheme, title: 'Схема гидравлическая', name: 'Схема гидравлическая принципиальная' };
    return null;
  }

  /**
   * Кнопка «Поместится: … — заменить» / «Достаточно: …».
   * @param {object} suggest подходящий контейнер
   * @param {number} index
   * @returns {string}
   */
  static fix(suggest, index) {
    const size = suggest.size ? ` ${suggest.size.map(side => Mm.text(side)).join(' × ')} мм` : '';
    const text = ContainerKind.of(suggest.ctype).name + size;
    const lead = suggest.smaller ? 'Достаточно' : 'Поместится';
    return `<button class="btn primary" type="button" data-a="stlFix" data-i="${index}" data-ct="${esc(suggest.ctype)}"${suggest.size ? ` data-size="${esc(suggest.size.join(' × '))}"` : ''}>${lead}: ${esc(text)} — заменить</button>`;
  }
}
