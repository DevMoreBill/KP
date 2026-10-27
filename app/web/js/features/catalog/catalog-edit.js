import { CatalogCache } from './catalog-cache.js';
import { CatalogStore } from './catalog-store.js';
import { CatalogWindow } from './catalog-window.js';
import { Price } from '../../core/str.js';
import { FormView } from '../../ui/form-view.js';
import { Toast } from '../../core/toast.js';
import { AdminSession } from '../../core/net.js';
import { ItemEditor } from './item-editor.js';
import { Kit } from '../kit/kit.js';
import { $, Uid, esc } from '../../core/util.js';
import { KpState, S } from '../../core/state.js';
import { Makers } from './makers.js';
import { CardRules } from './card-rules.js';
import { CardGaps } from './card-gaps.js';

/**
 * Правка позиции каталога прямо из окна каталога — в той же карточке, что и позиция КП, плюс цена в каталоге.
 * На время правки список позиций КП подменяется одной позицией каталога (CATED): черновик КП не сохраняется и не
 * перерисовывается, после закрытия всё возвращается как было.
 */
export class CatalogEditor {
  // правка позиции каталога: пока она открыта, S.items подменены — черновик не сохраняется
  static session = null;
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
    if (Kit.has(item))
      doc.kit = { parts: Kit.parts(item).map(part => this._clone(CatalogCache.omit(part, '_costText'))) };
    else delete doc.kit;
    if (item.draw && (item.draw.front || item.draw.top)) doc.draw = this._clone(item.draw);
    else delete doc.draw; // свой рисунок для габаритного чертежа
    this.TEMP.forEach(key => delete doc[key]);
    if (JSON.stringify(doc.photo || null) !== JSON.stringify(base.photo || null)) delete doc.photoFrom;
    return doc;
  }

  static _open(doc, onSave, isNew) {
    if (!doc || doc._light) {
      CatalogWindow.win.say('Не удалось загрузить позицию целиком — повторите');
      return;
    }
    if (CatalogEditor.session || ItemEditor.current) return;
    const item = this.toItem(doc);
    CatalogEditor.session = { items: S.items, base: doc, onSave, snap: '', isNew };
    S.items = [item];
    CatalogEditor.session.snap = JSON.stringify(this.toDoc(item, doc));
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
   * Надпись кнопки сохранения: при модерации правка уходит администратору (правки администратора — сразу).
   * @returns {string}
   */
  static saveLabel() {
    return CatalogWindow.win.mod && !AdminSession.on ? 'Отправить на модерацию' : 'Сохранить в каталог';
  }

  /**
   * Есть несохранённые правки.
   * @returns {boolean}
   */
  static dirty() {
    return (
      !!CatalogEditor.session &&
      (CatalogEditor.session.isNew ||
        JSON.stringify(this.toDoc(S.items[0], CatalogEditor.session.base)) !== CatalogEditor.session.snap)
    );
  }

  static async _put(item) {
    let doc = this.toDoc(item, CatalogEditor.session.base);
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
    const after = CatalogEditor.session.onSave;
    S.items = CatalogEditor.session.items;
    CatalogEditor.session = null;
    ItemEditor.current = null;
    const dialog = $('#edlg');
    if (dialog.open) dialog.close();
    FormView.render();
    if (doc && after) await after(doc);
  }

  /** «Сохранить в каталог». */
  static async save() {
    if (!CatalogEditor.session) return;
    const item = S.items[0];
    if (!String(item.name || '').trim()) {
      ItemEditor.current.tab = 'main';
      ItemEditor.render();
      setTimeout(() => $('#edlg [data-p="items.0.name"]')?.focus(), this.FOCUS_DELAY);
      Toast.show('Укажите наименование позиции');
      return;
    }
    if (CatalogEditor.session.isNew && !Makers.ensure(item)) {
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
    const base = CatalogEditor.session.base;
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
    if (!CatalogEditor.session) return;
    if (this.dirty() && !confirm('Закрыть без сохранения? Изменения позиции каталога будут потеряны.')) return;
    await this._finish(null);
  }

  /** Обработчики карточки каталога (вешаются один раз). */
  static listen() {
    document.addEventListener('click', event => {
      if (!CatalogEditor.session || !event.target.closest('#edlg')) return;
      if (event.target.closest('[data-catsave]')) this.save();
      else if (event.target.closest('[data-catcancel]')) this.cancel();
    });
    document.addEventListener(
      'cancel',
      event => {
        if (event.target.id !== 'edlg' || !CatalogEditor.session) return;
        event.preventDefault();
        this.cancel();
      },
      true,
    );
    CatalogPrice.listen();
  }
}

/** Цена в карточке каталога: продажа и закупка с валютами; ручная цена — фид её больше не трогает. */
export class CatalogPrice {
  // закупка из фида по сетке скидок поставщика: «РРЦ − 30 % (Компрессоры с ременным приводом до 75 кВт)»
  static _disc(card) {
    const disc = card.costDisc;
    if (!(disc && disc.pct && card.costSrc === 'feed')) return '';
    return ` Закупка — из фида поставщика: ${card.rrc && card.rrc.price ? 'РРЦ' : 'цена прайса'} − ${String(disc.pct).replace('.', ',')} %${disc.label ? ` (${esc(disc.label)})` : ''}.`;
  }

  static _cur(card, key) {
    const opts = Object.keys(KPGen.CURS)
      .map(
        code =>
          `<option value="${code}"${(card[key] || 'RUB') === code ? ' selected' : ''}>${esc(KPGen.CURS[code].sh)}</option>`,
      )
      .join('');
    return `<select data-ccur="${key}" aria-label="Валюта">${opts}</select>`;
  }

  /**
   * Блок «Цена в каталоге».
   * @param {object} card
   * @returns {string}
   */
  static html(card) {
    const priceText = card._priceText ?? (card.price ? KPGen.money(card.price) : '');
    const costText = card._costText ?? (card.cost ? KPGen.money(card.cost) : '');
    return `<div class="ed-sec"><p class="sub">Цена в каталоге</p><div class="cprice">
      <label class="f"><span>Цена продажи</span><input type="text" inputmode="decimal" class="num" data-cprice="price" value="${esc(priceText)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта</span>${this._cur(card, 'priceCur')}</label>
      <label class="f"><span>Закупка</span><input type="text" inputmode="decimal" class="num" data-cprice="cost" value="${esc(costText)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта закупки</span>${this._cur(card, 'costCur')}</label>
      <label class="f"><span>Срок поставки</span><input type="text" data-clead value="${esc(card.lead || '')}" maxlength="80" placeholder="под заказ 6–8 недель" autocomplete="off"></label></div>
    <p class="muted" style="margin:6px 0 0">Цена подставляется в новые КП. При сохранении КП цена позиции в каталоге обновляется сама. Срок поставки — в «Условия» КП, если позиции нет в наличии (пусто — по поставщику).${this._disc(card)}</p></div>`;
  }

  static _input(field) {
    const card = S.items[0];
    const key = field.dataset.cprice;
    const value = Price.parse(field.value);
    card[`_${key}Text`] = field.value;
    card[key] = Number.isNaN(value) ? 0 : value;
    card[`${key}Src`] = 'manual';
    field.classList.toggle('bad', Number.isNaN(value));
  }

  static _blur(field) {
    const card = S.items[0];
    const value = Price.parse(field.value);
    if (Number.isNaN(value)) return;
    delete card[`_${field.dataset.cprice}Text`];
    field.value = value ? KPGen.money(value) : '';
  }

  /** Ввод цены и валюты. */
  static listen() {
    document.addEventListener('input', event => {
      if (event.target.dataset.cprice != null && CatalogEditor.session) this._input(event.target);
      if (event.target.dataset.clead != null && CatalogEditor.session) S.items[0].lead = event.target.value;
    });
    document.addEventListener('focusout', event => {
      if (event.target.dataset.cprice != null && CatalogEditor.session) this._blur(event.target);
    });
    document.addEventListener('change', event => {
      const field = event.target;
      if (field.dataset.ccur != null && CatalogEditor.session) S.items[0][field.dataset.ccur] = field.value;
    });
  }
}
