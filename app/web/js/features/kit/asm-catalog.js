import { AsmItem } from './asm-item.js';
import { CatalogEditor } from '../catalog/catalog-edit.js';
import { Catalog, CatalogStore } from '../catalog/catalog-store.js';
import { CardRules } from '../catalog/card-rules.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { ImageFiles } from '../catalog/images.js';
import { ImgUpload } from '../../core/net.js';
import { Attrs } from '../../core/item-attrs.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Str } from '../../core/str.js';
import { $, Uid } from '../../core/util.js';
import { WizardLink } from '../../core/wizard-link.js';

/**
 * Части сборного изделия, которых нет в каталоге: новая карточка каталога всеми способами окна «Добавить оборудование»
 * (с ИИ — по ссылке, файлу или тексту; таблицей; вручную) и карточки из техничек — обычными позициями каталога
 * (обязательные поля, модерация); изделие ссылается на них. Та же модель уже в каталоге — берётся она.
 */
export class AsmCatalog {
  /**
   * Новая карточка каталога окном «Добавить оборудование»; сохранённая — в изделие, «← Назад» — обратно в изделие.
   * @param {string} cat категория (пусто — выбрать в окне)
   * @param {{onSaved: function(object): *, onBack: function(): *}} from карточка после сохранения; возврат без неё
   */
  static newCard(cat, from) {
    if (ItemEditor.current) ItemEditor.close();
    WizardLink.open('catalog', cat, from);
  }

  /**
   * Дозаполнить карточку части, не принятую каталогом (не хватает обязательного, похожая позиция).
   * @param {object} part
   * @param {function(object): *} onSaved
   */
  static fill(part, onSaved) {
    if (ItemEditor.current) ItemEditor.close();
    const dialog = $('#dlg');
    if (dialog.open) dialog.close(); // окно изделия ждёт: карточка каталога — сверху без него
    CatalogEditor.openNew(part._doc, onSaved);
    if (CatalogEditor.session && (part.need || []).length) CatalogEditor.askMissing(0, part.need); // что не хватает — красным
  }

  /**
   * Та же модель (производитель и модель) уже в каталоге.
   * @param {object} attrs
   * @returns {object|undefined}
   */
  static match(attrs) {
    const maker = Str.norm(attrs.maker);
    const model = Str.norm(attrs.model);
    if (!maker || !model) return undefined;
    return Catalog.cache.find(card => {
      const own = Attrs.of(card);
      return Str.norm(own.maker) === maker && Str.norm(own.model) === model;
    });
  }

  /**
   * Часть изделия из ответа ИИ: из каталога, новой карточкой каталога или (не принята каталогом) — с перечнем, чего не
   * хватает, и черновиком карточки.
   * @param {{role: string, qty: number, doc: object}} found
   * @returns {Promise<object>}
   */
  static async fromAi(found) {
    const known = this.match(found.doc.attrs || {});
    if (known) return this._qty(AsmItem.part(await Catalog.fullDoc(known), found.role), found.qty);
    const doc = { ...found.doc, id: Uid.next() + Uid.next(), photo: await this._photo(found.doc) };
    const need = await this._need(doc);
    if (!need.length) {
      try {
        const saved = await CatalogStore.put(doc);
        return this._qty(AsmItem.part(saved, found.role), found.qty);
      } catch (error) {
        need.push(String(error.message || error));
      }
    }
    const part = this._qty(AsmItem.part(doc, found.role), found.qty);
    delete part.catId;
    part.need = need;
    part._doc = doc;
    return part;
  }

  static _qty(part, qty) {
    if (part.role !== 'container' && qty > 1) part.qty = qty;
    return part;
  }

  static async _photo(doc) {
    if (!doc.photo || !doc.photo.src) return null;
    try {
      const pic = await ImageFiles.prep(doc.photo.src, 'photo');
      return await ImgUpload.put(pic, ItemSpec.imgPlace(doc, 'photo'));
    } catch {
      return null;
    }
  }

  static async _need(doc) {
    try {
      const found = await CardRules.check(doc, doc.id);
      return [...found.missing, ...found.dups.map(dup => `похожая позиция в каталоге: ${dup.name}`)];
    } catch {
      return [];
    }
  }
}
