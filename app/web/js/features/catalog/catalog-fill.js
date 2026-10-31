import { PriceAge } from './price-age.js';
import { CatalogCache } from './catalog-cache.js';
import { Catalog, CatalogStore, CatFind } from './catalog-store.js';
import { Logos } from './image-slots.js';
import { Toast } from '../../core/toast.js';
import { DefRegistry } from '../../core/defaults.js';
import { Str } from '../../core/str.js';
import { KpState, S } from '../../core/state.js';
import { CatFeatures } from '../kit/kit-part.js';
import { PriceCalc } from '../kp/price-calc.js';
import { ItemSpec } from '../../core/item-spec.js';
import { CoverHint } from '../kit/cover-hint.js';
import { Uid } from '../../core/util.js';
import { RecentModels } from '../kp/quick-search.js';
import { Makers } from './makers.js';
import { CatalogEditor } from './catalog-edit.js';
import { ItemEditor } from './item-editor.js';
import { CardRules } from './card-rules.js';
import { AdminSession } from '../../core/net.js';
import { CoverSync } from '../kit/cover-sync.js';
import { KpForm } from '../../core/kp-form.js';
import { KpLead } from './kp-lead.js';
import { Kit } from '../../core/kit.js';
import { Auth } from '../../core/auth.js';
import { Currency } from '../../core/currency.js';

/** Позиция КП из карточки каталога: всё содержимое карточки, цена — в валюте КП, без следов прежнего оборудования. */
export class CatalogFill {
  // другое оборудование — без следов прежнего: адрес страницы, фото со страницы, черновик автозаполнения
  static STALE = [
    'pageUrl',
    'photoSource',
    'photoFrom',
    'feed',
    '_src',
    '_srcProps',
    '_srcImgs',
    '_srcUrl',
    '_ans',
    '_ansBase',
    '_aiMsg',
    '_aiStep',
    '_sa',
    '_saSpec',
    '_saG',
    '_autoNameV',
  ];

  static _copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Заполнить позицию КП из карточки каталога.
   * @param {object} item позиция КП
   * @param {object} card карточка каталога (полная)
   */
  static fill(item, card) {
    RecentModels.add(card); // «Недавно добавленные модели» в едином поиске
    item.gallery = this._copy(card.gallery || []).map(pic => ({ ...pic, id: pic.id || Uid.next() }));
    let doc = card;
    if (!doc.hint) doc = { ...doc, hint: CoverHint.of(doc) };
    if (!(doc.groups || []).length) doc = { ...doc, groups: ItemSpec.groups(doc) };
    Object.assign(item, this._fields(item, doc));
    delete item._priceText;
    delete item._costText;
    this.STALE.forEach(key => delete item[key]);
    this._kit(item, doc);
    this._cost(item, doc);
    if (!item.logo) Logos.auto(item); // логотип производителя из каталога, если у модели его нет
    item.page = !!(item.photo || item.groups.length || item.features.some(feat => feat.text));
    CoverSync.run();
    KpLead.take(item, card);
    const old = PriceAge.note(card);
    if (old) Toast.show(`«${card.name}»: ${old} — уточните цену у поставщика`);
  }

  // сборка из каталога — со своим составом
  static _kit(item, doc) {
    if (doc.kit && Array.isArray(doc.kit.parts) && doc.kit.parts.length) item.kit = this._copy(doc.kit);
    else delete item.kit;
  }

  static _cost(item, doc) {
    item.cost = doc.cost || 0;
    item.costCur = doc.costCur || 'RUB';
    item.margin = doc.margin;
    item.mmode = doc.mmode;
    item.priceManual = false;
    this._price(item, doc.priceCur || 'RUB');
    if (item.cost && !item.price) PriceCalc.apply(item); // у модели нет цены — по закупке и марже из каталога
  }

  static _fields(item, doc) {
    return {
      name: doc.name || item.name,
      spec: doc.spec || '',
      price: doc.price || 0,
      pageTitle: doc.pageTitle || '',
      photoCaption: doc.photoCaption || '',
      features: this._copy(CatFeatures.forKp(doc.features)),
      groups: this._copy(doc.groups || []),
      hint: doc.hint || null,
      catId: doc.id,
      photo: doc.photo || null,
      logo: doc.logo || null,
      attrs: { ...(doc.attrs || {}) },
      options: this._copy(doc.options || []).map(option => ({
        ...option,
        id: Uid.next(),
        qty: option.unit === 'усл.' ? 1 : +item.qty || 1,
      })),
    };
  }

  // цена каталога в валюте КП по курсу; курса нет — без цены
  static _price(item, priceCur) {
    if (!item.price || priceCur === Currency.current()) return;
    const from = Currency.rate(priceCur);
    const into = Currency.rate(Currency.current());
    item.price = from > 0 && into > 0 ? Math.round((item.price * from) / into) : 0;
  }
}

/**
 * Сохранение КП обновляет каталог: цена и история цен каждой позиции и опции, содержимое карточки — если в КП заполнено.
 * Поиск позиции — по словарям, полные карточки — заранее и параллельно.
 */
export class CatalogSync {
  static GALLERY_KEYS = ['id', 'src', 'w', 'h', 'caption', 'slot', 'wide', 'on', 'at'];

  /**
   * Записать позиции КП в каталог.
   * @param {string} number номер КП
   */
  static async run(number) {
    let list = [];
    try {
      list = await CatalogCache.load();
    } catch {
      try {
        list = await CatalogStore.list();
      } catch {
        // каталог недоступен — позиции станут новыми
      }
    }
    const index = this._index(list);
    const full = await this._fullDocs(index);
    for (const item of S.items) {
      if (!item.name.trim() || !item.price) continue;
      await this._item(item, { number, index, full });
      for (const option of item.options || []) await this._option(option, { number, index });
    }
    await Catalog.refresh();
  }

  static _index(list) {
    const byId = new Map(list.map(doc => [doc.id, doc]));
    const byName = new Map();
    for (const doc of list) {
      const key = Str.norm(doc.name);
      if (!byName.has(key)) byName.set(key, doc);
    }
    return { byId, byName, find: (id, name) => byId.get(id) || byName.get(Str.norm(name)) };
  }

  static async _fullDocs(index) {
    const full = new Map();
    const want = new Map();
    for (const item of S.items) {
      if (!item.name.trim() || !item.price) continue;
      const doc = index.find(item.catId, item.name);
      if (doc) want.set(doc.id, doc);
    }
    await Promise.all(
      [...want.values()].map(async doc => {
        try {
          full.set(doc.id, await Catalog.fullDoc(doc));
        } catch {
          // возьмётся ниже по одной
        }
      }),
    );
    return full;
  }

  static _keep() {
    return Math.round(DefRegistry.num('cat.priceKeep', 50));
  }

  static async _doc(item, { index, full }) {
    const light = index.find(item.catId, item.name);
    return light ? full.get(light.id) || (await Catalog.fullDoc(light)) : await Catalog.fullDoc(undefined);
  }

  // своё фото вместо фото похожей модели
  static _photoFrom(base, doc) {
    if (base.photoFrom && (!doc || JSON.stringify(base.photo || null) !== JSON.stringify(doc.photo || null))) {
      delete base.photoFrom;
    }
  }

  static async _item(item, { number, index, full }) {
    const doc = await this._doc(item, { index, full });
    const base = doc ? JSON.parse(JSON.stringify(doc)) : { id: Uid.next() + Uid.next(), prices: [] };
    Object.assign(base, this._fields(item, base));
    this._photoFrom(base, doc);
    this._history(base, number, {
      date: S.date,
      client: S.client,
      price: item.price,
      cur: Currency.current(),
      cost: item.cost || 0,
      costCur: item.costCur || 'RUB',
      qty: +item.qty,
      number: number || '',
    });
    const saved = await CatalogStore.putAuto(base);
    item.catId = base.id;
    if (saved) this._images(item, saved);
  }

  // цена КП — в историю цен позиции (одна запись на номер КП), последние cat.priceKeep
  static _history(base, number, entry) {
    base.prices = (base.prices || []).filter(price => !number || price.number !== number);
    base.prices.unshift(entry);
    base.prices = base.prices.slice(0, this._keep());
  }

  static _money(item, base) {
    return {
      name: item.name,
      spec: item.spec || base.spec || '',
      price: item.price,
      priceCur: Currency.current(),
      cost: item.cost || base.cost || 0,
      costCur: item.cost ? item.costCur || 'RUB' : base.costCur || 'RUB',
      margin: item.margin ?? base.margin,
      mmode: item.mmode || base.mmode,
    };
  }

  // содержимое карточки — если в КП заполнено
  static _texts(item, base) {
    const hasText = (item.features || []).some(feat => feat.text);
    const hasRows = (item.groups || []).some(group => (group.rows || []).some(row => row.k || row.v));
    return {
      pageTitle: item.pageTitle || base.pageTitle || '',
      photoCaption: item.photoCaption || base.photoCaption || '',
      features: hasText ? item.features : base.features || [],
      groups: hasRows ? item.groups : base.groups || [],
    };
  }

  static _media(item, base) {
    return {
      hint: item.hint || base.hint || null,
      photo: item.photo || base.photo || null,
      logo: item.logo || base.logo || null,
      gallery: this._gallery(item, base),
      updatedAt: new Date().toISOString(),
      attrs: {
        ...(base.attrs || {}),
        ...Object.fromEntries(Object.entries(item.attrs || {}).filter(([, value]) => value !== '' && value != null)),
      },
    };
  }

  static _fields(item, base) {
    return { ...this._money(item, base), ...this._texts(item, base), ...this._media(item, base) };
  }

  static _gallery(item, base) {
    if (!item.gallery || !item.gallery.length) return base.gallery || [];
    return item.gallery.map(pic => Object.fromEntries(this.GALLERY_KEYS.map(key => [key, pic[key]])));
  }

  // картинки, загруженные на сервер, — адресами в позицию КП
  static _images(item, saved) {
    if (saved.photo) item.photo = saved.photo;
    if (saved.logo) item.logo = saved.logo;
    if (saved.gallery && item.gallery && saved.gallery.length === item.gallery.length) {
      item.gallery = item.gallery.map((pic, k) => ({ ...pic, src: saved.gallery[k].src }));
    }
  }

  static async _option(option, { number, index }) {
    if (!option.name.trim() || !option.price) return;
    const doc = await Catalog.fullDoc(index.find(option.catId, option.name)); // полная позиция, а не карточка списка
    const base = doc
      ? JSON.parse(JSON.stringify(doc))
      : { id: Uid.next() + Uid.next(), kind: 'option', prices: [], features: [], groups: [] }; // новая — всегда опция
    Object.assign(base, {
      name: option.name,
      price: option.price,
      spec: base.spec || '',
      updatedAt: new Date().toISOString(),
      short: option.short || base.short || '',
      unit: option.unit || 'шт.',
    });
    this._history(base, number, {
      date: S.date,
      client: S.client,
      price: option.price,
      qty: +option.qty,
      number: number || '',
    });
    await CatalogStore.putAuto(base);
    option.catId = base.id;
    index.byId.set(base.id, base);
    if (!index.byName.has(Str.norm(base.name))) index.byName.set(Str.norm(base.name), base);
  }

  /**
   * Позиция КП → в каталог (кнопка «Сохранить позицию в каталог»).
   * @param {number} index позиция КП
   */
  static async save(index) {
    const item = S.items[index];
    if (!item.name.trim()) {
      Toast.show('Сначала укажите наименование');
      return;
    }
    const need = CatFind.id(item.catId) ? 'catEdit' : 'catAdd';
    if (need === 'catAdd' && !Makers.ensure(item)) {
      if (ItemEditor.current) CatalogEditor.askMaker(index);
      else Toast.show('Укажите производителя: «Изменить» → «Основное» → «Производитель»');
      return;
    }
    if (!Auth.can(need)) {
      Auth.cannot(need);
      return;
    }
    // карточка каталога — целиком (категория, закупка, история цен, галерея), поверх — поля редактора позиции
    const known = item.catId && CatFind.id(item.catId);
    const cur = known ? await Catalog.fullDoc(known) : null;
    if (cur && cur._light) {
      Toast.show('Карточка каталога не загрузилась — повторите, когда будет связь с сервером');
      return;
    }
    CardRules.fill(item);
    const doc = this._saveDoc(item, cur);
    if (!(await this._quality(item, doc, index))) return;
    await this._put(item, doc);
    KpForm.render();
    KpState.persist();
  }

  // обязательное у основного оборудования и похожие позиции — до записи (сервер проверит то же самое)
  static async _quality(item, doc, index) {
    let found;
    try {
      found = await CardRules.check(doc, doc.id);
    } catch {
      return true;
    }
    if (found.missing.length) {
      if (!ItemEditor.current) ItemEditor.open(index); // карточка позиции: что не заполнено — красным, с переходом к полю
      CatalogEditor.askMissing(index, found.missing);
      return false;
    }
    return !found.dups.length || CardRules.askDups(found.dups, { admin: AdminSession.on });
  }

  static async _put(item, doc) {
    try {
      const saved = await CatalogStore.put(doc);
      if (saved && saved.photo) item.photo = saved.photo;
      if (saved && saved.logo) item.logo = saved.logo;
      item.catId = doc.id;
      await Catalog.refresh();
      Toast.show(
        saved._pending
          ? 'Отправлено на модерацию — изменения появятся после одобрения администратором'
          : 'Позиция сохранена в каталог',
      );
    } catch (error) {
      Toast.show(`Не удалось сохранить в каталог: ${error.message || error}`);
    }
  }

  static _saveDoc(item, cur) {
    const kit = Kit.has(item)
      ? {
          kit: Kit.store(item),
          cost: item.cost,
          costCur: 'RUB',
          attrs: item.attrs,
        }
      : {};
    return {
      ...(cur ? JSON.parse(JSON.stringify(cur)) : {}),
      id: item.catId || Uid.next() + Uid.next(),
      name: item.name,
      spec: item.spec,
      price: item.price,
      pageTitle: item.pageTitle,
      photoCaption: item.photoCaption,
      features: item.features,
      groups: item.groups,
      hint: item.hint || null,
      photo: item.photo || null,
      logo: item.logo || null,
      updatedAt: new Date().toISOString(),
      ...kit,
    };
  }
}
