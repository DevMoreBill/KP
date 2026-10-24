import { EquipTypes } from '../../core/equip-types.js';
import { FEAT } from '../../core/features.js';
import { Attrs } from '../../core/item-attrs.js';
import { Api } from '../../core/net.js';
import { esc } from '../../core/util.js';

/**
 * Обязательное у основного оборудования (как на сервере, app/catalog_quality.py): категория, производитель, модель, своё
 * главное фото и ключевые характеристики категории. Опции, станции-сборки и запчасти — без требований.
 */
export class CardRules {
  static MAIN_ROLE = 'equipment';
  static OPTION_KIND = 'option';
  static BASE = [
    ['cat', 'категория'],
    ['maker', 'производитель'],
    ['model', 'модель'],
  ];
  static PHOTO = 'главное фото';

  /**
   * Проверка включена («Функции программы» → catQuality).
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('catQuality');
  }

  /**
   * Карточка основного оборудования.
   * @param {object} card
   * @returns {boolean}
   */
  static isMain(card) {
    if (!card || card.kind === this.OPTION_KIND || card.kit) return false;
    const cat = (card.attrs || {}).cat;
    const type = cat && EquipTypes.list.find(one => one.id === cat);
    return !type || (type.role || this.MAIN_ROLE) === this.MAIN_ROLE;
  }

  /**
   * Обязательные параметры категории: [ключ, подпись].
   * @param {string} cat
   * @returns {Array<[string, string]>}
   */
  static keys(cat) {
    const type = EquipTypes.list.find(one => one.id === cat);
    const kpi = ((type && type.fields) || [])
      .filter(field => field.kpi)
      .map(field => [field.key, field.label.toLowerCase()]);
    return [...this.BASE, ...kpi];
  }

  /**
   * Поле обязательно (звёздочка в редакторе).
   * @param {string} key
   * @param {string} cat
   * @returns {boolean}
   */
  static required(key, cat) {
    return this.enabled() && this.keys(cat).some(([one]) => one === key);
  }

  static _filled(value) {
    return value != null && String(value).trim() !== '';
  }

  /**
   * Чего не хватает (для пометки «не заполнено» в каталоге).
   * @param {object} card
   * @returns {string[]}
   */
  static missing(card) {
    if (!this.enabled() || !this.isMain(card)) return [];
    const attrs = card.attrs || {};
    const out = this.keys(attrs.cat)
      .filter(([key]) => !this._filled(attrs[key]))
      .map(([, label]) => label);
    if (!(card.photo && card.photo.src) || card.photoFrom) out.push(this.PHOTO);
    return out;
  }

  /**
   * Пустые обязательные параметры — из распознанного по характеристикам (серые значения в редакторе) записать в карточку.
   * @param {object} item позиция редактора
   */
  static fill(item) {
    if (!this.enabled()) return;
    const auto = Attrs.of(item);
    item.attrs = item.attrs || {};
    for (const [key] of this.keys(auto.cat)) {
      if (!this._filled(item.attrs[key]) && this._filled(auto[key])) item.attrs[key] = auto[key];
    }
  }

  // на сервер — только то, что нужно для проверки (без картинок)
  static _brief(doc) {
    const photo = doc.photo && doc.photo.src ? { src: '1' } : null;
    return {
      name: doc.name,
      kind: doc.kind,
      kit: doc.kit ? 1 : undefined,
      attrs: doc.attrs || {},
      photo,
      photoFrom: doc.photoFrom,
    };
  }

  /**
   * Проверка на сервере перед сохранением: что не заполнено и похожие позиции.
   * @param {object} doc
   * @param {string} id
   * @returns {Promise<{missing: string[], dups: Array<{id: string, name: string, why: string}>}>}
   */
  static async check(doc, id) {
    if (!this.enabled()) return { missing: [], dups: [] };
    const answer = await Api.request('/api/catalog/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, doc: this._brief(doc) }),
    });
    return { missing: answer.missing || [], dups: answer.dups || [] };
  }

  /**
   * Текст для «не заполнено».
   * @param {string[]} labels
   * @returns {string}
   */
  static text(labels) {
    return `Заполните обязательное для основного оборудования: ${labels.join(', ')}`;
  }

  /**
   * Вопрос о похожих позициях: продолжить (на модерацию) или нет.
   * @param {Array<{name: string, why: string}>} dups
   * @param {{admin: boolean}} who
   * @returns {boolean}
   */
  static askDups(dups, who) {
    const list = dups.map(dup => `• ${dup.name} — ${dup.why}`).join('\n');
    const tail = who.admin
      ? 'Это другое оборудование? «ОК» — сохранить.'
      : 'Это другое оборудование? «ОК» — сохранить: карточка уйдёт администратору на проверку и появится в каталоге после одобрения.';
    return confirm(`Похожие позиции уже есть в каталоге:\n${list}\n\n${tail}`);
  }

  /**
   * Строка «не заполнено» в карточке каталога.
   * @param {object} card
   * @returns {string}
   */
  static note(card) {
    const gaps = this.missing(card);
    if (!gaps.length) return '';
    return `<p class="pv-gap" role="note">Не заполнено: ${esc(gaps.join(', '))}. «Редактировать» — дополнить карточку.</p>`;
  }
}
