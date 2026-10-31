import { ImageFiles } from './images.js';
import { Logos } from './image-slots.js';
import { ImageDrop } from './item-blocks.js';
import { ItemLinks } from './item-links.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Str } from '../../core/str.js';
import { Attrs } from '../../core/item-attrs.js';
import { esc } from '../../core/util.js';
import { CardGaps } from './card-gaps.js';
import { UiKit } from '../../core/ui-kit.js';
import { Kit } from '../../core/kit.js';
import { StationLink } from '../../core/station-link.js';

/** Вкладка «Описание и фото»: главное фото и логотип, блоки описания со своими фото, схемы и другие изображения. */
export class DescTab {
  static NOT_PHOTO = ['stdraw', 'stschema']; // чертёж и схема станции — не фото

  // выбор главного фото среди изображений позиции (фото со страницы поставщика, загруженные вручную)
  static _mainPick(item, i) {
    const free = ItemLinks.freeGal(item).filter(
      j => item.gallery[j] && item.gallery[j].src && !this.NOT_PHOTO.includes(item.gallery[j].gen),
    );
    if (!free.length) return '';
    return `<div class="mainpick"><span class="muted">Главное фото — выбрать из изображений позиции:</span>
    <div class="mainpick-l">${free.map(j => `<button type="button" class="mainpick-i" data-a="galMain" data-i="${i}" data-j="${j}" title="Сделать главным"><img src="${esc(item.gallery[j].src)}" alt=""></button>`).join('')}</div></div>`;
  }

  static _photoNote(item, from) {
    const cur = item.photo && item.photo.src;
    if (from) return `Сейчас — фото элемента «${esc(from.p.name || 'без названия')}» из состава.`;
    if (item.photo && item.photo.gen === 'st3d') {
      return 'Сейчас — 3D-вид с вкладки «Компоновка»: он сам обновляется при изменении состава и контейнера.';
    }
    if (cur) return 'Сейчас — своё фото.';
    return StationLink.enabled(item)
      ? 'Фото пока нет — 3D-вид станции вставляется с вкладки «Компоновка».'
      : 'Фото пока нет.';
  }

  static _partPhotos(parts, cur, i) {
    if (!parts.length) return '';
    const buttons = parts
      .map(
        ({ p, j }) =>
          `<button type="button" class="st-phi${p.photo.src === cur ? ' on' : ''}" data-a="stPhoto" data-i="${i}" data-j="${j}" title="${esc(p.name || '')}"><img src="${esc(p.photo.src)}" alt=""><small>${esc(p.role === 'container' ? 'контейнер' : p.name || 'элемент')}</small></button>`,
      )
      .join('');
    return `<div class="st-phl"><span class="muted">Взять фото элемента состава:</span>${buttons}</div>`;
  }

  // станция: главное фото — общий вид изделия (титул и строка КП); можно взять фото любого элемента состава
  static _stationPhoto(item, i) {
    if (!Kit.station(item)) return '';
    const parts = Kit.parts(item)
      .map((part, j) => ({ p: part, j }))
      .filter(row => row.p.photo && row.p.photo.src);
    const cur = item.photo && item.photo.src;
    const from = cur ? parts.find(row => row.p.photo.src === cur) : null;
    return `<div class="st-ph"><p class="st-phn"><b>Это фото станции целиком</b> — оно стоит в строке КП и на титульном листе. Лучше всего — общий вид станции или контейнера.
      ${this._photoNote(item, from)}
      Фото компрессора, насоса, осушителя и других элементов — на вкладке «Состав станции»: в КП они стоят рядом с описанием элемента.</p>
    ${this._partPhotos(parts, cur, i)}</div>`;
  }

  static _featPhoto(item, i, feat) {
    const pic = ItemLinks.featImage(item, feat);
    const place = pic ? (item.gallery || []).indexOf(pic) : -1;
    const ctl = pic
      ? `<div class="row" style="gap:4px;justify-content:center"><label class="row muted" style="gap:4px"><input type="checkbox" data-gon="${i}" data-j="${place}" ${pic.on === false ? '' : 'checked'} style="width:auto">в КП</label><button class="icon" type="button" data-a="galDel" data-i="${i}" data-j="${place}" aria-label="Убрать фото">✕</button></div>`
      : '';
    return `<div class="fimg">${ImageDrop.box(pic && pic.src, `data-fimg="${i}" data-fid="${esc(feat.id)}"`, '+ фото к блоку<br><small>нажмите, перетащите или Ctrl+V</small>')}<button type="button" class="lnk imgp" data-imgpaste="${esc(`[data-fimg="${i}"][data-fid="${feat.id}"]`)}">Вставить из буфера</button>
        ${ctl}</div>`;
  }

  static _block(item, i, feat, j) {
    const path = `items.${i}`;
    ItemLinks.featId(feat);
    const last = (item.features || []).length - 1;
    return `<div class="fblock" data-fj="${j}">
      ${this._featPhoto(item, i, feat)}
      <div class="ftext"><div class="fhead"><input type="text" data-p="${path}.features.${j}.label" value="${esc(feat.label)}" placeholder="Заголовок блока (Двигатель, Альтернатор…)" style="font-weight:600">
        <span class="ed-hdl" draggable="true" data-edrag="feat" data-i="${i}" data-j="${j}" title="Перетащите блок выше или ниже" aria-hidden="true">⠿</span>
        <button class="icon" type="button" data-a="featMv" data-i="${i}" data-j="${j}" data-d="-1" aria-label="Блок выше" title="Выше" ${j === 0 ? 'disabled' : ''}>↑</button><button class="icon" type="button" data-a="featMv" data-i="${i}" data-j="${j}" data-d="1" aria-label="Блок ниже" title="Ниже" ${j === last ? 'disabled' : ''}>↓</button><button class="icon" type="button" data-a="delFeat" data-i="${i}" data-j="${j}" aria-label="Удалить блок">✕</button></div>
        <textarea data-p="${path}.features.${j}.text" rows="3" placeholder="Описание: одно-два предложения">${esc(feat.text)}</textarea></div></div>`;
  }

  static _where(item, i, { j, link }) {
    const groups = (item.groups || []).map(group => group.name).filter(Boolean);
    const toGroups = groups
      .map(
        name =>
          `<option value="group:${esc(name)}"${link.kind === 'group' && link.name === name ? ' selected' : ''}>К характеристикам: ${esc(name)}</option>`,
      )
      .join('');
    const toFeats = (item.features || [])
      .filter(feat => feat.label)
      .map(feat => `<option value="feat:${ItemLinks.featId(feat)}">К описанию: ${esc(feat.label)}</option>`)
      .join('');
    return `<label class="f"><span>Где показать</span><select data-gat="${i}" data-j="${j}"><option value="free"${link.kind === 'free' ? ' selected' : ''}>Раздел «Фото и схемы»</option>
        ${toGroups}
        ${toFeats}</select></label>`;
  }

  static _ctl(i, pic, j) {
    const path = `items.${i}`;
    return `<div class="gctl"><select data-p="${path}.gallery.${j}.wide" aria-label="Ширина"><option value=""${!pic.wide ? ' selected' : ''}>Ширина: авто</option><option value="half"${pic.wide === 'half' ? ' selected' : ''}>Половина</option><option value="full"${pic.wide === 'full' ? ' selected' : ''}>Вся ширина</option></select>
        <label class="row muted" style="gap:4px"><input type="checkbox" data-gon="${i}" data-j="${j}" ${pic.on === false ? '' : 'checked'} style="width:auto">в КП</label><span style="flex:1"></span>
        <button class="lnk" type="button" data-a="galMain" data-i="${i}" data-j="${j}" title="Сделать главным фото позиции (текущее главное встанет на его место)">★ Главное</button>
        <button class="icon" type="button" data-a="galDel" data-i="${i}" data-j="${j}" aria-label="Удалить">✕</button></div>`;
  }

  static _card(item, i, { pic, j, link }, { n, count }) {
    const path = `items.${i}`;
    return `<div class="gcard${pic.on === false ? ' off' : ''}" data-gj="${j}"><div class="gmv"><span class="ed-hdl" draggable="true" data-edrag="gal" data-i="${i}" data-j="${j}" title="Перетащите, чтобы поменять порядок" aria-hidden="true">⠿</span>
      <button class="icon" type="button" data-a="galMv" data-i="${i}" data-j="${j}" data-d="-1" aria-label="Раньше" title="Раньше" ${n === 0 ? 'disabled' : ''}>↑</button><button class="icon" type="button" data-a="galMv" data-i="${i}" data-j="${j}" data-d="1" aria-label="Позже" title="Позже" ${n === count - 1 ? 'disabled' : ''}>↓</button></div><img src="${esc(pic.src)}" alt="">
      <input type="text" data-p="${path}.gallery.${j}.caption" value="${esc(pic.caption || '')}" placeholder="${link.kind === 'group' ? esc(link.name) : 'Подпись под изображением'}">
      ${this._where(item, i, { j, link })}
      ${this._ctl(i, pic, j)}</div>`;
  }

  static _cards(item, i) {
    const free = (item.gallery || [])
      .map((pic, j) => ({ pic, j, link: ItemLinks.linkOf(item, pic) }))
      .filter(row => row.link.kind !== 'feat');
    return free.map((row, num) => this._card(item, i, row, { n: num, count: free.length })).join('');
  }

  static _logoText(item) {
    const maker = Attrs.of(item).maker;
    if (!maker) return 'Логотип подставится сам, если указать производителя (точное совпадение с каталогом)';
    return Logos.of(maker)
      ? 'Логотип производителя'
      : `Логотип производителя (PNG) — у «${esc(maker)}» в каталоге логотипа нет`;
  }

  static _media(item, i, station) {
    const path = `items.${i}`;
    const photo = ImageDrop.html({
      img: item.photo,
      kind: 'photo',
      i,
      text: `<b>${station ? 'Главное фото станции' : 'Главное фото'}</b><br>нажмите, перетащите файл или картинку с сайта,<br>или вставьте из буфера (Ctrl+V).<br><small>Белые поля обрежутся сами.</small>`,
      small: false,
    });
    const logo = ImageDrop.html({ img: item.logo, kind: 'logo', i, text: this._logoText(item), small: true });
    return `<div class="ed-sec"><p class="sub">${station ? 'Главное фото станции и логотип' : 'Главное фото и логотип'}</p>${this._stationPhoto(item, i)}
     <div class="media2"><div><div class="ed-gapphoto${CardGaps.badPhoto(item) ? ' bad' : ''}">${photo}${CardGaps.photoNote(item)}</div>${this._mainPick(item, i)}${UiKit.field('Подпись под фото', `${path}.photoCaption`, { ph: 'Исполнение в кожухе' })}</div>
       <div>${logo}</div></div></div>`;
  }

  static _feats(item, i, { type, station }) {
    const slots = (type.gallerySlots || []).filter(slot => !ImageFiles.WIDE_RX.test(slot));
    const have = new Set((item.features || []).map(feat => Str.norm(feat.label)));
    const blocks = (item.features || []).map((feat, j) => this._block(item, i, feat, j)).join('');
    const chips = slots
      .filter(slot => !have.has(Str.norm(slot)))
      .map(
        slot =>
          `<button class="chip" type="button" data-a="addFeatL" data-i="${i}" data-l="${esc(slot)}">+ ${esc(slot)}</button>`,
      )
      .join('');
    const hint = `У каждого блока — своё фото: в КП текст и фото стоят рядом.${station ? ' Для станции — например, «Контейнер снаружи», «Внутри контейнера»; элементы состава описываются на вкладке «Состав станции».' : ''}`;
    return `<div class="ed-sec"><div class="sub">${station ? 'Описание станции по узлам' : 'Описание узлов'}${UiKit.tip(hint)}</div>
     ${blocks || '<p class="muted">Добавьте блоки описания — например, «Двигатель», «Альтернатор», «Контроллер».</p>'}
     <div class="chips">${chips}<button class="chip" type="button" data-a="addFeatL" data-i="${i}" data-l="">+ свой блок</button></div></div>`;
  }

  static _gallery(item, i, type) {
    const schemes = (type.gallerySlots || [])
      .filter(slot => ImageFiles.WIDE_RX.test(slot))
      .map(
        slot =>
          `<button class="chip" type="button" data-a="galAdd" data-i="${i}" data-slot="${esc(slot)}">+ ${esc(slot)}</button>`,
      )
      .join('');
    const page =
      item.feed && item.feed.url
        ? `Все фото со страницы товара: ${esc(item.feed.url)} (Shift+клик — другая ссылка)`
        : 'Все фото со страницы товара на сайте поставщика — по ссылке';
    return `<div class="ed-sec"><div class="sub">Схемы, чертежи и другие фото${UiKit.tip('Выводятся после характеристик; можно привязать к группе характеристик. Перетащите файлы или вставьте из буфера (Ctrl+V).')}</div>
     <div class="gal" data-gal="${i}" tabindex="0">${this._cards(item, i) || '<p class="muted" style="margin:0">Перетащите сюда файлы или картинки с сайта, или вставьте из буфера (Ctrl+V). Схемы и чертежи в PNG сохраняются без потери чёткости.</p>'}</div>
     <div class="chips" style="margin-top:8px">${schemes}<button class="chip" type="button" data-a="galAdd" data-i="${i}" data-slot="">+ изображение</button><button class="chip" type="button" data-imgpaste='[data-gal="${i}"]'>Вставить из буфера</button><button class="chip" type="button" data-a="galPage" data-i="${i}" title="${page}">⤓ Фото с сайта поставщика</button></div></div>`;
  }

  /**
   * Вкладка «Описание и фото».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static html(item, i) {
    const type = EquipTypes.byId(Attrs.of(item).cat);
    const station = !!Kit.station(item);
    const feats = this._feats(item, i, { type, station }); // коды блоков описания — до привязки изображений
    const gallery = this._gallery(item, i, type);
    const media = this._media(item, i, station);
    const brief = station ? StationLink.brief(item, i) : '';
    return `${media}
   ${brief}
   ${feats}
   ${gallery}${StationLink.drawHtml(item, i)}`;
  }
}
