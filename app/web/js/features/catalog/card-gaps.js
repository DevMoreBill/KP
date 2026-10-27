import { CardRules } from './card-rules.js';
import { Attrs } from '../../core/item-attrs.js';
import { esc } from '../../core/util.js';

/**
 * Почему карточка основного оборудования не сохраняется: после отказа — красная полоса под вкладками со списком
 * недостающего (пункт ведёт к полю), «!» на вкладках, красные пустые обязательные поля и рамка главного фото.
 * Подсветка держится, пока карточка открыта, и сама уходит с заполненного.
 */
export class CardGaps {
  static shown = false;
  static TAB_OF = { photo: 'desc' };
  static MAIN_TAB = 'main';
  static PHOTO = 'photo';

  /** Показать пробелы (сохранение не прошло). */
  static show() {
    this.shown = true;
  }

  /** Карточку открыли заново или закрыли — без подсветки. */
  static reset() {
    this.shown = false;
  }

  static _filled(value) {
    return value != null && String(value).trim() !== '';
  }

  /**
   * Чего не хватает сейчас: [{key, label, tab}] (распознанное из характеристик — серые значения — считается заполненным,
   * его сохранение запишет само).
   * @param {object} item
   * @returns {Array<{key: string, label: string, tab: string}>}
   */
  static list(item) {
    if (!item || !CardRules.enabled() || !CardRules.isMain(item)) return [];
    const auto = Attrs.of(item);
    const attrs = item.attrs || {};
    const out = CardRules.keys(auto.cat)
      .filter(([key]) => !this._filled(attrs[key]) && !this._filled(auto[key]))
      .map(([key, label]) => ({ key, label, tab: this.MAIN_TAB }));
    if (this.noPhoto(item)) out.push({ key: this.PHOTO, label: CardRules.PHOTO, tab: this.TAB_OF.photo });
    return out;
  }

  /**
   * Нет своего главного фото (фото похожей модели не считается).
   * @param {object} item
   * @returns {boolean}
   */
  static noPhoto(item) {
    return !(item.photo && item.photo.src) || !!item.photoFrom;
  }

  /**
   * Поле параметра подсветить красным.
   * @param {object} item
   * @param {string} key
   * @returns {boolean}
   */
  static badField(item, key) {
    return this.shown && this.list(item).some(gap => gap.key === key);
  }

  /**
   * Рамку главного фото подсветить красным.
   * @param {object} item
   * @returns {boolean}
   */
  static badPhoto(item) {
    return this.shown && this.list(item).some(gap => gap.key === this.PHOTO);
  }

  /**
   * Знак «!» у вкладки, где есть незаполненное.
   * @param {object} item
   * @param {string} tab
   * @returns {string}
   */
  static tabMark(item, tab) {
    if (!this.shown || !this.list(item).some(gap => gap.tab === tab)) return '';
    return ' <b class="ed-gapdot" title="Здесь не заполнено обязательное">!</b>';
  }

  /**
   * Полоса под вкладками: что не заполнено и где; всё заполнено — подсказка сохранить.
   * @param {object} item
   * @returns {string}
   */
  static banner(item) {
    if (!this.shown) return '';
    const gaps = this.list(item);
    if (!gaps.length)
      return '<div class="ed-gaps ok" role="status">Всё обязательное заполнено — нажмите «Сохранить».</div>';
    const links = gaps
      .map(
        gap =>
          `<button type="button" class="ed-gapgo" data-gapgo="${esc(gap.tab)}" data-gapkey="${esc(gap.key)}">${esc(gap.label)}</button>`,
      )
      .join('');
    return `<div class="ed-gaps" role="alert"><b>Карточка не сохранена.</b> Для основного оборудования обязательны:
      ${links}<span class="ed-gaphint">Нажмите пункт — откроется место, где его заполнить (поля обведены красным).</span></div>`;
  }

  /**
   * Подпись под пустым обязательным полем.
   * @returns {string}
   */
  static fieldNote() {
    return '<em class="ed-gapnote">Обязательно — не заполнено</em>';
  }

  /**
   * Подпись под рамкой главного фото.
   * @param {object} item
   * @returns {string}
   */
  static photoNote(item) {
    if (!this.badPhoto(item)) return '';
    const why = item.photoFrom
      ? 'Стоит фото похожей модели — нужно своё фото этой модели.'
      : 'Нет главного фото — добавьте файлом, перетаскиванием или вставкой (Ctrl+V).';
    return `<p class="ed-gapnote">${why}</p>`;
  }
}
