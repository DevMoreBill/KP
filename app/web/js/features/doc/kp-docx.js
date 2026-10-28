import { KpConditions } from '../../core/conditions.js';
import { DocImages } from './doc-images.js';
import { DocxPage, DocxSettings, DocxTypes } from './docx-parts.js';
import { DocxRoots } from './docx-roots.js';
import { KpCover } from './kp-cover.js';
import { Templates } from './templates.js';
import { ImageFiles } from '../catalog/images.js';
import { FileSave } from '../../core/files.js';
import { Kit } from '../kit/kit.js';
import { KitDoc } from '../kit/kit-doc.js';
import { Attrs } from '../../core/item-attrs.js';
import { Currency } from '../kp/currency.js';
import { ItemLinks } from '../catalog/item-links.js';
import { S } from '../../core/state.js';
import { FEAT } from '../../core/features.js';

/**
 * Сборка файла .docx КП: основа Word из шаблона + страницы по скелету шаблона с настройками; картинки — в пакет
 * (word/media), их размеры — скелету. Скелет без какой-то возможности (feature) получает данные в старом виде.
 */
export class KpDocx {
  static MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  static HEADER_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

  /**
   * Данные КП для документа (без служебных полей и изображений).
   * @returns {object}
   */
  static state() {
    S.items.forEach(item => (item.features || []).forEach(feat => ItemLinks.featId(feat)));
    const out = JSON.parse(JSON.stringify(S, (key, value) => (key.startsWith('_') ? undefined : value)));
    out.vat = +S.vat;
    out.cur = {
      code: Currency.current(),
      rate: Currency.current() !== 'RUB' ? Currency.rate(Currency.current()) : null,
      date: S.pricing.rateDate || '',
    };
    out.items = S.items.map(item => this._item(item));
    out.conditions = KpConditions.forDoc(out.conditions, (S.object || {}).address);
    return out;
  }

  static _item(source) {
    const attrs = Attrs.of(source);
    const item = Object.assign(KitDoc.item(source), Kit.has(source) ? { kitDoc: KitDoc.data(source) } : {}, {
      info: { maker: attrs.maker || '', model: attrs.model || '', type: attrs.type || '' },
    });
    const options = (item.options || [])
      .filter(option => option.name.trim() && +option.qty > 0 && !option.askPrice) // без цены продажи — не заказчику
      .map(option => ({
        name: option.name.trim(),
        short: option.short,
        unit: option.unit,
        qty: +option.qty,
        price: option.price || 0,
      }));
    return { ...item, kit: undefined, qty: +item.qty, photo: undefined, logo: undefined, _srcImg: undefined, options };
  }

  static _ext(url) {
    return /^data:image\/png/.test(url) ? 'png' : 'jpg';
  }

  /**
   * Файл .docx по данным КП.
   * @param {object} state данные КП (KpDocx.state)
   * @param {object} pack шаблон (Templates.pack)
   * @param {object} settings настройки шаблона
   * @returns {Promise<Blob>} blob.kpFloats — плавающие объекты для предпросмотра
   */
  static async render(state, pack, settings) {
    const texts = settings.texts || {};
    DocImages.reset();
    const zip = await JSZip.loadAsync(pack.base);
    const clients = await this._clients(zip, pack, settings);
    if (pack.addFooter) await DocxTypes.part(zip, 'footer_kp', 'footer');
    await DocxTypes.images(zip);
    const media = { cover: null, items: {} };
    await KpCover.stations(zip, state, media, texts);
    await this._cover(zip, media);
    for (const item of S.items.map(row => KitDoc.item(row)))
      if (item.page) media.items[item.id] = await this._itemMedia(zip, item);
    const features = pack.skel.features || [];
    if (features.includes('images')) media.extra = await this._extra(zip, pack, settings);
    const page = await this._page(zip, pack, settings, features);
    state.items = await this._kit(zip, state, media, features);
    if (features.includes('sign') && FEAT.on('kpStamp')) media.sign = await this._sign(zip, pack, settings);
    // скелет, не умеющий показывать скидку (свой или старый), получает цены уже со скидкой — суммы сходятся
    if (!features.includes('discount')) {
      state.items = state.items.map(item => ({ ...item, price: KPGen.netPrice(item), disc: undefined }));
    }
    const out = this._build(pack, { state, media, settings, clients, page });
    return this._pack(zip, pack, out, page);
  }

  static async _clients(zip, pack, settings) {
    const image = settings.clientsImage ? await Templates.image(pack, settings.clientsImage) : null;
    if (!image) return false;
    const clients = { rid: 'rIdTplClients', file: `tpl_clients.${image.ext}`, w: image.w, h: image.h };
    zip.file(`word/media/${clients.file}`, image.buf);
    return clients;
  }

  // фото на титул: выбранное в разделе «Оформление КП» или первой позиции с фото
  static async _cover(zip, media) {
    const chosen = S.items.find(item => item.id === S.cover.photoFrom && item.photo);
    const covers = [chosen, ...S.items.filter(item => item.photo)].filter(Boolean);
    for (const item of covers) {
      const url = await DocImages.url(item.photo, item.name);
      if (!url) continue;
      const file = `cover.${this._ext(url)}`;
      zip.file(`word/media/${file}`, FileSave.base64(url), { base64: true });
      media.cover = { file, w: item.photo.w, h: item.photo.h };
      break;
    }
  }

  static async _itemMedia(zip, item) {
    const out = {};
    if (item.photo) {
      const tile = await DocImages.tile(item.photo, item.name);
      if (tile) {
        zip.file(`word/media/tile_${item.id}.png`, FileSave.base64(tile.url), { base64: true });
        out.tile = { file: `tile_${item.id}.png`, w: tile.w, h: tile.h };
      }
    }
    if (item.logo) {
      const url = await DocImages.url(item.logo, `${item.name} (логотип)`);
      if (url) {
        zip.file(`word/media/logo_${item.id}.png`, FileSave.base64(url), { base64: true });
        out.logo = { file: `logo_${item.id}.png`, w: item.logo.w, h: item.logo.h };
      }
    }
    out.gallery = [];
    out.featImgs = {};
    (item.features || []).forEach(feat => ItemLinks.featId(feat));
    await this._gallery(zip, item, out);
    return out;
  }

  static async _gallery(zip, item, out) {
    let count = 0;
    for (const image of item.gallery || []) {
      if (image.on === false) continue;
      const url = await DocImages.url(image, item.name + (image.caption ? ` — ${image.caption}` : ''));
      if (!url) continue;
      const file = `gal_${item.id}_${++count}.${this._ext(url)}`;
      zip.file(`word/media/${file}`, FileSave.base64(url), { base64: true });
      const link = ItemLinks.linkOf(item, image);
      if (link.kind === 'feat') out.featImgs[link.f.id] = { file, w: image.w, h: image.h };
      else {
        out.gallery.push({
          file,
          w: image.w,
          h: image.h,
          caption: (image.caption || '').trim() || (link.kind === 'group' ? link.name : ''),
          wide: ImageFiles.wide(image),
          sheet: image.gen === 'stdraw' || image.gen === 'stschema',
        });
      }
    }
  }

  // дополнительные картинки шаблона (если скелет это умеет)
  static async _extra(zip, pack, settings) {
    const extra = {};
    for (const row of settings.images || []) {
      const image = row && row.file ? await Templates.image(pack, row.file) : null;
      if (!image) continue;
      const file = `tplx_${String(row.id).replace(/[^A-Za-z0-9_-]/g, '')}.${image.ext}`;
      zip.file(`word/media/${file}`, image.buf);
      extra[row.id] = { file, w: image.w, h: image.h };
    }
    return extra;
  }

  // поля страницы и своя шапка из настроек: прежние ссылки на шапки убираются, первая страница — с той же шапкой
  static async _page(zip, pack, settings, features) {
    const page = { sect: DocxPage.margins(pack.sect, settings.page), rels: pack.rels, headerLogo: null, header: false };
    if (!features.includes('header') || !settings.header || !settings.header.on) return page;
    page.header = true;
    const logo = settings.header.logo ? await Templates.image(pack, settings.header.logo) : null;
    if (logo) {
      page.headerLogo = { rid: 'rIdHdrLogo', file: `tpl_hdr_logo.${logo.ext}`, w: logo.w, h: logo.h };
      zip.file(`word/media/${page.headerLogo.file}`, logo.buf);
    }
    page.sect = page.sect
      .replace(/<w:headerReference[^>]*\/>/g, '')
      .replace(/<w:titlePg\/>/g, '')
      .replace(/(<w:sectPr[^>]*>)/, '$1<w:headerReference w:type="default" r:id="rIdKpHeader"/>');
    page.rels +=
      '<Relationship Id="rIdKpHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header_kp.xml"/>';
    await DocxTypes.part(zip, 'header_kp', 'header');
    return page;
  }

  // скелет, умеющий показывать сборки (feature 'kit'), получает состав как есть: таблица состава и карточки элементов;
  // остальным — состав, разложенный в блоки описания и таблицы
  static async _kit(zip, state, media, features) {
    if (!features.includes('kit'))
      return state.items.map(item => (item.kitDoc ? { ...item, kitDoc: undefined } : item));
    const items = state.items.map(item =>
      item.kitDoc ? { ...item, ...item.kitDoc.base, kit: { parts: item.kitDoc.parts }, kitDoc: undefined } : item,
    );
    for (const item of S.items) {
      if (!Kit.has(item) || !media.items[item.id]) continue;
      media.items[item.id].kitImgs = await this._kitImages(zip, item);
    }
    return items;
  }

  static async _kitImages(zip, item) {
    const images = {};
    for (const part of Kit.parts(item)) {
      if (!part.photo || !part.photo.src) continue;
      const url = await DocImages.url(part.photo, `${item.name} — ${part.name || 'элемент'}`);
      if (!url) continue;
      const file = `kit_${item.id}_${String(part.id).replace(/[^A-Za-z0-9_-]/g, '')}.${this._ext(url)}`;
      zip.file(`word/media/${file}`, FileSave.base64(url), { base64: true });
      images[part.id] = { file, w: part.photo.w, h: part.photo.h };
    }
    return images;
  }

  // подпись и печать (картинки шаблона) — для блока подписи
  static async _sign(zip, pack, settings) {
    const sign = {};
    for (const key of ['signImage', 'stampImage']) {
      const image = settings[key] ? await Templates.image(pack, settings[key]) : null;
      if (!image) continue;
      const file = `tpl_${key}.${image.ext}`;
      zip.file(`word/media/${file}`, image.buf);
      sign[key.replace('Image', '')] = { file, w: image.w, h: image.h };
    }
    return sign;
  }

  static _build(pack, { state, media, settings, clients, page }) {
    const options = { ...settings, rels: page.rels, sect: page.sect, clients, headerLogo: page.headerLogo };
    try {
      return pack.skel.build(state, media, DocxRoots.all(), options);
    } catch (error) {
      throw new Error(`ошибка в скелете шаблона (skeleton.js): ${(error && error.message) || error}`);
    }
  }

  static async _pack(zip, pack, out, page) {
    zip.file('word/document.xml', out.document);
    zip.file(pack.footerPath, out.footer);
    zip.file('word/_rels/document.xml.rels', out.rels);
    await DocxSettings.hyphenation(zip, out.hyphenate);
    if (page.header && out.header) {
      zip.file('word/header_kp.xml', out.header);
      const logo = page.headerLogo
        ? `<Relationship Id="rIdHdrLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${page.headerLogo.file}"/>`
        : '';
      zip.file('word/_rels/header_kp.xml.rels', `${this.HEADER_RELS}${logo}</Relationships>`);
    }
    const blob = await zip.generateAsync({ type: 'blob', mimeType: this.MIME, compression: 'DEFLATE' });
    blob.kpFloats = out.floats || []; // плавающие объекты по порядку — предпросмотр дорисовывает надписи
    return blob;
  }
}
