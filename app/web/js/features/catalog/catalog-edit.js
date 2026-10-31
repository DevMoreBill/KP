import { CatalogCache } from './catalog-cache.js';
import { CatalogStore } from './catalog-store.js';
import { Toast } from '../../core/toast.js';
import { AdminSession } from '../../core/net.js';
import { ItemEditor } from './item-editor.js';
import { $, Uid } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { Makers } from './makers.js';
import { CardRules } from './card-rules.js';
import { CardGaps } from './card-gaps.js';
import { KpForm } from '../../core/kp-form.js';
import { Kit } from '../../core/kit.js';
import { CatalogLink } from '../../core/catalog-link.js';
import { CatalogPrice } from './catalog-price.js';
import { CatalogSession } from './catalog-session.js';

/**
 * Правка позиции каталога прямо из окна каталога — в той же карточке, что и позиция КП, плюс цена в каталоге.
 * На время правки список позиций КП подменяется одной позицией каталога (CATED): черновик КП не сохраняется и не
 * перерисовывается, после закрытия всё возвращается как было.
 */
export class CatalogEditor {
  // правка позиции каталога: пока она открыта, S.items подменены — черновик не сохраняется
  static TEMP = ['_light', '_a', '_nv', '_hay', '_sup', '_pq', 'pricesCount', 'st', 'src', 'art']; // служебные поля карточки
  static FOCUS_DELAY = 30;

  static _clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  /**
   * Карточка каталога → позиция редактора.
   * @param {object} doc
   * @returns {object}
   */
  static toItem(doc) {
    const copy = JSON.parse(JSON.stringify(doc));
    this.TEMP.forEach(key => delete copy[key]);
    return Object.assign(KpState.newItem(), copy, {
      qty: 1,
      page: true,
      features: copy.features || [],
      groups: copy.groups || [],
      attrs: copy.attrs || {},
      options: (copy.options || []).map(option => ({ ...option, id: option.id || Uid.next() })),
      gallery: (copy.gallery || []).map(pic => ({ ...pic, id: pic.id || Uid.next() })),
    });
  }

  static _gallery(item) {
    // source — адрес картинки у поставщика: по нему фид не добавит то же фото повторно
    return (item.gallery || []).map(({ id, src, w, h, caption, slot, wide, on, at, source }) => ({
      id,
      src,
      w,
      h,
      caption,
      slot,
      wide,
      on,
      at,
      ...(source ? { source } : {}),
    }));
  }

  static _texts(item) {
    const clone = this._clone;
    return {
      features: clone((item.features || []).filter(feat => feat.label || feat.text)),
      groups: clone(
        (item.groups || [])
          .map(group => ({ ...group, rows: (group.rows || []).filter(row => row.k || row.v) }))
          .filter(group => group.name || group.rows.length),
      ),
    };
  }

  static _head(item) {
    return {
      name: String(item.name || '').trim(),
      spec: item.spec || '',
      pageTitle: item.pageTitle || '',
      photoCaption: item.photoCaption || '',
    };
  }

  static _media(item) {
    const clone = this._clone;
    return {
      hint: clone(item.hint || null),
      photo: clone(item.photo || null),
      logo: clone(item.logo || null),
      photoSource: item.photoSource || null,
      pageUrl: item.pageUrl || undefined,
      gallery: this._gallery(item),
    };
  }

  static _money(item) {
    return {
      attrs: Object.fromEntries(Object.entries(item.attrs || {}).filter(([, value]) => value !== '' && value != null)),
      options: (item.options || [])
        .filter(option => option.name)
        .map(option => CatalogCache.omit(CatalogCache.omit(option, '_priceText'), '_costText')),
      price: item.price || 0,
      priceCur: item.priceCur || 'RUB',
      cost: item.cost || 0,
      costCur: item.costCur || 'RUB',
      lead: String(item.lead || '').trim(),
    };
  }

  static _fields(item) {
    return { ...this._head(item), ...this._texts(item), ...this._media(item), ...this._money(item) };
  }

  /**
   * Позиция редактора → карточка каталога (поверх base).
   * @param {object} item
   * @param {object} base
   * @returns {object}
   */
  static toDoc(item, base) {
    const doc = this._clone(base);
    Object.assign(doc, this._fields(item));
    if (Kit.has(item)) doc.kit = this._clone(Kit.store(item));
    else delete doc.kit;
    if (item.draw && (item.draw.front || item.draw.top)) doc.draw = this._clone(item.draw);
    else delete doc.draw; // свой рисунок для габаритного чертежа
    this.TEMP.forEach(key => delete doc[key]);
    if (JSON.stringify(doc.photo || null) !== JSON.stringify(base.photo || null)) delete doc.photoFrom;
    return doc;
  }

  static _open(doc, onSave, isNew) {
    if (!doc || doc._light) {
      CatalogLink.say('Не удалось загрузить позицию целиком — повторите');
      return;
    }
    if (CatalogSession.current || ItemEditor.current) return;
    const item = this.toItem(doc);
    CatalogSession.current = { items: S.items, base: doc, onSave, snap: '', isNew };
    S.items = [item];
    CatalogSession.current.snap = JSON.stringify(this.toDoc(item, doc));
    ItemEditor.open(0, 'main');
  }

  /**
   * Открыть позицию каталога на правку.
   * @param {object} doc полная карточка
   * @param {function(object): *} [onSave]
   */
  static open(doc, onSave) {
    this._open(doc, onSave, false);
  }

  /**
   * Открыть новую позицию (копию): «Сохранить» нужно даже без правок.
   * @param {object} doc
   * @param {function(object): *} [onSave]
   */
  static openNew(doc, onSave) {
    this._open(doc, onSave, true);
  }

  /**
   * Есть несохранённые правки.
   * @returns {boolean}
   */
  static dirty() {
    return (
      !!CatalogSession.current &&
      (CatalogSession.current.isNew ||
        JSON.stringify(this.toDoc(S.items[0], CatalogSession.current.base)) !== CatalogSession.current.snap)
    );
  }

  static async _put(item) {
    let doc = this.toDoc(item, CatalogSession.current.base);
    doc.updatedAt = new Date().toISOString();
    const button = $('#edlg [data-catsave]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Сохраняю…';
    }
    try {
      doc = await CatalogStore.put(doc);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = this.saveLabel();
      }
      const text = String(error.message || error);
      if (text.startsWith(CardRules.text([]))) this.askMissing(0, text.slice(CardRules.text([]).length).split(', '));
      else Toast.show(`Не удалось сохранить в каталог: ${text}`);
      return null;
    }
    if (doc._pending)
      Toast.show('Отправлено на модерацию — изменения появятся в каталоге после одобрения администратором');
    return doc;
  }

  static async _finish(doc) {
    const after = CatalogSession.current.onSave;
    S.items = CatalogSession.current.items;
    CatalogSession.current = null;
    ItemEditor.current = null;
    const dialog = $('#edlg');
    if (dialog.open) dialog.close();
    KpForm.render();
    if (doc && after) await after(doc);
  }

  /** «Сохранить в каталог». */
  static async save() {
    if (!CatalogSession.current) return;
    const item = S.items[0];
    if (!String(item.name || '').trim()) {
      ItemEditor.current.tab = 'main';
      ItemEditor.render();
      setTimeout(() => $('#edlg [data-p="items.0.name"]')?.focus(), this.FOCUS_DELAY);
      Toast.show('Укажите наименование позиции');
      return;
    }
    if (CatalogSession.current.isNew && !Makers.ensure(item)) {
      this.askMaker(0);
      return;
    }
    if (!(await this._quality(item))) return;
    const doc = await this._put(item);
    if (doc) await this._finish(doc);
  }

  // обязательное у основного оборудования и похожие позиции (сервер проверит то же самое)
  static async _quality(item) {
    CardRules.fill(item);
    const base = CatalogSession.current.base;
    let found;
    try {
      found = await CardRules.check(this.toDoc(item, base), base.id);
    } catch {
      return true; // нет ответа — решит сервер при сохранении
    }
    if (found.missing.length) {
      this.askMissing(0, found.missing);
      return false;
    }
    return !found.dups.length || CardRules.askDups(found.dups, { admin: AdminSession.on });
  }

  /**
   * Не заполнено обязательное: открыть нужную вкладку (фото — «Описание и фото»), сказать, чего не хватает.
   * @param {number} index позиция в окне
   * @param {string[]} missing
   */
  static askMissing(index, missing) {
    CardGaps.show();
    const gaps = CardGaps.list(S.items[index]);
    ItemEditor.current.tab = (gaps[0] && gaps[0].tab) || 'main';
    ItemEditor.render();
    if (gaps[0]) ItemEditor.goGap(gaps[0].tab, gaps[0].key);
    Toast.show(CardRules.text(missing));
  }

  /**
   * Новое оборудование без производителя: открыть «Основное», поле производителя — в фокус.
   * @param {number} index позиция в окне
   */
  static askMaker(index) {
    ItemEditor.current.tab = 'main';
    ItemEditor.render();
    setTimeout(() => $(`#edlg [data-p="items.${index}.attrs.${Makers.FIELD}"]`)?.focus(), this.FOCUS_DELAY);
    Toast.show('Укажите производителя — выберите из списка или впишите');
  }

  /** «Отмена» и Esc — с вопросом, если есть несохранённые правки. */
  static async cancel() {
    if (!CatalogSession.current) return;
    if (this.dirty() && !confirm('Закрыть без сохранения? Изменения позиции каталога будут потеряны.')) return;
    await this._finish(null);
  }

  /** Обработчики карточки каталога (вешаются один раз). */
  static listen() {
    document.addEventListener('click', event => {
      if (!CatalogSession.current || !event.target.closest('#edlg')) return;
      if (event.target.closest('[data-catsave]')) this.save();
      else if (event.target.closest('[data-catcancel]')) this.cancel();
    });
    document.addEventListener(
      'cancel',
      event => {
        if (event.target.id !== 'edlg' || !CatalogSession.current) return;
        event.preventDefault();
        this.cancel();
      },
      true,
    );
    CatalogPrice.listen();
  }
}
