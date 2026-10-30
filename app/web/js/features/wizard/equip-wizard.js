import { PageImages } from '../catalog/page-images.js';
import { NewStation } from './new-station.js';
import { TzImport } from '../tz/tz-import.js';
import { SpecPaste } from '../catalog/ai-parse.js';
import { CatalogWindow } from '../catalog/catalog-window.js';
import { CatalogEditor } from '../catalog/catalog-edit.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { Kit } from '../kit/kit.js';
import { KpState, S } from '../../core/state.js';
import { AiDirect } from '../catalog/ai-chat.js';
import { ItemSpec } from '../../core/item-spec.js';
import { Catalog } from '../catalog/catalog-store.js';
import { FEAT } from '../../core/features.js';
import { $, Uid, esc } from '../../core/util.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Auth } from '../kp/auth.js';
import { CatPicker } from './cat-picker.js';
import { QuickFind } from '../catalog/quick-find.js';
import { KpForm } from '../../core/kp-form.js';

/**
 * Окно «Добавить оборудование» — один порядок для КП и для каталога: что добавляем (найти в каталоге — только в КП,
 * станция в контейнере, единица оборудования) → как заполнить карточку (с ИИ — по ссылке, файлу или тексту; таблицей;
 * вручную) или требования станции → карточка открывается сразу на нужной вкладке (в каталоге — карточка каталога).
 * Открыто из окна сборного изделия — «← Назад» с первого шага возвращает в него.
 */
export class EquipWizard {
  static state = { where: 'kp', cat: '', entry: '', q: '', name: '', onSaved: null, onBack: null };
  static ICONS = { st_pump: '💧', st_comp: '💨', st_dgu: '⚡' };
  static FOCUS_DELAY = 40;
  static CAT_FOCUS_DELAY = 30;
  static MAIN_LINE = 3;
  static BUTTONS = {
    back: '_back',
    newtype: '_newType',
    nsCont: '_toggleCont',
    nsPick: '_pickStation',
    nsMain: '_mainStation',
    mkStation: '_emptyStation',
    tz: '_tzImport',
  };

  /**
   * Открыть окно.
   * @param {string} where kp | catalog
   * @param {string} [pre] station или id категории — сразу на её шаге
   * @param {{onSaved?: function(object): *, onBack?: function(): *}} [from] открыто из окна сборного изделия:
   *   новая карточка каталога сохранена — onSaved (изделие берёт её частью), «← Назад» с первого шага — onBack
   */
  static open(where, pre, from = {}) {
    if (where === 'catalog' && !Auth.can('catAdd')) {
      Auth.cannot('catAdd');
      return;
    }
    Object.assign(this.state, { where: where || 'kp', cat: '', q: '', name: '' });
    this.state.onSaved = from.onSaved || null;
    this.state.onBack = from.onBack || null;
    NewStation.reset();
    CatPicker.reset();
    if (pre === 'station') this.state.cat = 'station';
    else if (pre && EquipTypes.list.some(type => type.id === pre)) this.state.cat = pre;
    this.state.entry = this.state.cat;
    const dialog = $('#dlg');
    dialog.className = 'wide nw';
    this.draw();
    if (!dialog.open) dialog.showModal();
    setTimeout(() => ($('#nwQ') || $('#nwName') || $('[data-nsr]'))?.focus(), this.FOCUS_DELAY);
  }

  static _stations() {
    return EquipTypes.list.filter(type => type.station);
  }

  /** Перерисовать окно по состоянию. */
  static draw() {
    const { where, cat, onBack } = this.state;
    const type = cat && cat !== 'station' ? EquipTypes.byId(cat) : null;
    const back = cat || onBack ? `<button class="btn ghost" type="button" data-nw="back">← Назад</button>` : '';
    const title = `${where === 'catalog' ? 'Новая позиция каталога' : 'Добавить оборудование'}${type ? ` <small class="muted">· ${esc(type.station ? type.item : type.name)}</small>` : ''}`;
    $('#dlg').innerHTML =
      `<div class="dlg-h"><h3>${title}</h3>${back}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b">${this._body(type)}</div>`;
  }

  static _body(type) {
    if (!this.state.cat) return this._start();
    if (this.state.cat === 'station') {
      return `<p class="muted nw-lead">Какую станцию собираем? Комплектуем только станции в контейнере.</p>${this._stationCards()}${this._tz()}`;
    }
    return type.station ? NewStation.html(type) : this._unit(type);
  }

  static _stationCards() {
    const cards = this._stations()
      .map(
        type =>
          `<button type="button" class="nw-card st" data-nwcat="${esc(type.id)}"><i>${this.ICONS[type.id] || '▣'}</i><b>${esc(type.item)}</b><small>${esc(type.coverTitle || type.name)}: контейнер, ${esc((type.station.mainLabel || '').toLowerCase())}, обвязка и системы — одним изделием</small></button>`,
      )
      .join('');
    return `<div class="nw-cards">${cards}</div>`;
  }

  // станция по ТЗ заказчика: вид станции, требования, контейнер и оборудование — из файла ТЗ
  static _tz() {
    if (this.state.where !== 'kp') return '';
    return `<div class="nw-tz"><button class="btn" type="button" data-nw="tz">📄 По ТЗ заказчика</button><span class="muted">PDF, Word, Excel — найдём требования, подберём контейнер и оборудование; всё проверите перед созданием</span></div>`;
  }

  static _units() {
    return EquipTypes.list.filter(
      type => !type.station && (this.state.where === 'catalog' || type.role !== 'accessory'),
    );
  }

  static _start() {
    const inKp = this.state.where === 'kp';
    const search = inKp
      ? `<div class="nw-sec"><p class="nw-h">Есть в каталоге?</p><input type="search" id="nwQ" value="${esc(this.state.q)}" placeholder="Модель, производитель, мощность — Enter добавит первую" autocomplete="off"><div class="nw-res" id="nwRes">${this.found()}</div></div>`
      : '';
    const stations = FEAT.on('stations')
      ? `<div class="nw-sec"><p class="nw-h">Станция в контейнере <span class="muted">— комплектуем сами</span></p>${this._stationCards()}${this._tz()}</div>`
      : '';
    const more = inKp
      ? '<p class="muted">Нужной категории нет? Её можно добавить в каталоге: «Каталог» → «+ Новая позиция» → «+ Новая категория…».</p>'
      : '<button class="btn ghost" type="button" data-nw="newtype">+ Новая категория…</button>';
    return `${search}
    ${stations}
    <div class="nw-sec"><p class="nw-h">Единица оборудования <span class="muted">— ${inKp ? 'нет в каталоге: заведём карточку' : 'выберите категорию'}</span></p>
      ${CatPicker.html(this._units())}
      ${more}</div>`;
  }

  /**
   * Найденное в каталоге по строке поиска.
   * @returns {string}
   */
  static found() {
    if (!this.state.q.trim()) return '';
    const hits = QuickFind.matches(this.state.q);
    if (!hits.length) return '<p class="muted">В каталоге не нашлось — заведите карточку ниже: выберите категорию.</p>';
    return hits
      .map(
        card =>
          `<button type="button" class="nw-hit" data-nwadd="${esc(card.id)}">${card.photo ? `<img src="${esc(card.photo.src)}" alt="">` : '<i></i>'}<span><b>${esc(card.name)}</b><small>${esc(ItemSpec.mainLine(card, this.MAIN_LINE) || card.spec || '')}</small></span><em>В КП</em></button>`,
      )
      .join('');
  }

  // единица оборудования: как заполнить карточку (ссылка на страницу товара — на вкладке ИИ, шаг 1)
  static _unit(type) {
    const options = [
      FEAT.on('ai') ? { key: 'ai', icon: '✨', title: 'С помощью ИИ — рекомендуем', text: this._aiText() } : null,
      {
        key: 'paste',
        icon: '📋',
        title: 'Таблицей из паспорта или Excel',
        text: 'Скопируйте два столбца «параметр — значение» — строки станут таблицей характеристик.',
      },
      {
        key: 'manual',
        icon: '✎',
        title: 'Вручную',
        text: 'Пустая карточка: параметры категории, описание, фото и характеристики.',
      },
    ].filter(Boolean);
    return `<label class="f nw-name"><span>Наименование или модель <small class="muted">— можно заполнить позже</small></span><input type="text" id="nwName" value="${esc(this.state.name)}" placeholder="${esc(type.item)} …" autocomplete="off"></label>
    <p class="nw-h">Как заполнить карточку?</p>
    <div class="nw-opts">${options.map(option => this._option(option)).join('')}</div>`;
  }

  static _aiText() {
    const what = 'ссылка на страницу товара, файл или текст паспорта — или только модель';
    return AiDirect.state.enabled
      ? `${esc(AiDirect.state.provider)} прямо в программе: ${what}; описание и характеристики разложатся по полям одной кнопкой.`
      : `ChatGPT, Claude, Алиса, GigaChat, DeepSeek — любой: ${what}; ИИ разложит описание и характеристики по полям.`;
  }

  static _option({ key, icon, title, text }) {
    return `<button type="button" class="nw-opt${key === 'ai' ? ' rec' : ''}" data-nwgo="${key}"><i aria-hidden="true">${icon}</i><span><b>${title}</b><small>${text}</small></span></button>`;
  }

  static _close() {
    const dialog = $('#dlg');
    dialog.close();
    dialog.className = '';
  }

  /**
   * Новая позиция → в КП (карточка позиции) или в каталог (карточка каталога), открыть на вкладке tab.
   * @param {object} item
   * @param {string} tab
   * @param {Function|null} [after] (индекс позиции) => …
   */
  static finish(item, tab, after) {
    this._close();
    if (this.state.where === 'catalog') {
      this._toCatalog(item, tab, after);
      return;
    }
    const first = S.items[0];
    const blank = S.items.length === 1 && !first.name.trim() && !first.price && !Kit.has(first);
    if (blank) S.items = [item];
    else S.items.push(item);
    if (KpForm.step() !== 'equip') KpForm.select('equip');
    KpForm.render();
    KpState.persist();
    ItemEditor.open(S.items.indexOf(item), tab);
    if (after) after(S.items.indexOf(item));
  }

  static _toCatalog(item, tab, after) {
    const { _src, _srcProps, _srcUrl, _srcImgs } = item;
    const doc = CatalogEditor.toDoc(item, { id: Uid.next() + Uid.next(), prices: [] });
    const onSaved = this.state.onSaved;
    CatalogEditor.openNew(doc, saved => (onSaved ? onSaved(saved) : CatalogWindow.win.afterSave(saved)));
    Object.assign(S.items[0], { _src, _srcProps, _srcUrl, _srcImgs, _aiStep: item._aiStep, _aiMsg: item._aiMsg });
    PageImages.move(item, S.items[0]);
    ItemEditor.current.tab = tab;
    ItemEditor.render();
    if (after) after(0);
  }

  static _makeUnit(how) {
    const type = EquipTypes.byId(this.state.cat);
    const item = KpState.newItem();
    item.attrs = { cat: type.id };
    item.page = true;
    item.name = this.state.name.trim();
    item.features = [];
    if (how === 'ai') {
      item._aiStep = 1;
      this.finish(item, 'ai');
      return;
    }
    if (how === 'paste') {
      this.finish(item, 'spec', index => SpecPaste.open(index));
      return;
    }
    item.features = [{ id: Uid.next(), label: '', text: '' }];
    this.finish(item, 'main');
  }

  static _readName() {
    this.state.name = ($('#nwName') || {}).value || this.state.name;
  }

  /** Обработчики окна (щелчки, ввод, выбор, Enter, закрытие). */
  static listen() {
    document.addEventListener('click', event => this._click(event));
    document.addEventListener('input', event => this._input(event.target));
    document.addEventListener('change', event => {
      if (event.target.closest('#dlg.nw') && /^ns(Ct|Ins|Cl)$/.test(event.target.id)) NewStation.change(event.target);
    });
    document.addEventListener('keydown', event => this._enter(event));
    // событие close приходит позже самого закрытия: окно могли уже открыть снова — тогда не трогаем
    document.addEventListener(
      'close',
      event => {
        const dialog = event.target;
        if (dialog.id === 'dlg' && !dialog.open && dialog.classList.contains('nw')) dialog.className = '';
      },
      true,
    );
  }

  static _click(event) {
    const target = event.target;
    if (!target.closest('#dlg.nw')) return;
    if (target.closest('[data-close]')) {
      this._close();
      return;
    }
    const cat = target.closest('[data-nwcat]');
    if (cat) {
      this._pickCat(cat.dataset.nwcat);
      return;
    }
    const hit = target.closest('[data-nwadd]');
    if (hit) {
      this._addFound(Catalog.cache.find(card => card.id === hit.dataset.nwadd));
      return;
    }
    const lib = target.closest('[data-nslib]');
    if (lib) {
      NewStation.library(EquipTypes.byId(this.state.cat), +lib.dataset.nslib);
      return;
    }
    const fillHow = target.closest('[data-nwgo]');
    if (fillHow) {
      this._readName();
      this._makeUnit(fillHow.dataset.nwgo);
      return;
    }
    const button = target.closest('[data-nw]');
    const method = button && this.BUTTONS[button.dataset.nw];
    if (method) this[method](EquipTypes.byId(this.state.cat));
  }

  static _pickCat(cat) {
    this.state.cat = cat;
    const type = EquipTypes.byId(cat);
    if (type && !type.station) CatPicker.remember(cat);
    this.draw();
    setTimeout(() => ($('#nwName') || document.querySelector('#dlg [data-nsr]'))?.focus(), this.CAT_FOCUS_DELAY);
  }

  static _addFound(card) {
    this._close();
    if (card) QuickFind.add(card);
  }

  static _back(type) {
    const { cat, entry, onBack } = this.state;
    if (onBack && cat === entry) {
      onBack();
      return;
    }
    this.state.cat = cat !== 'station' && type.station ? 'station' : '';
    this.draw();
  }

  static _newType() {
    this._close();
    CatalogWindow.win.newType(id => this.open('catalog', id));
  }

  static _toggleCont() {
    NewStation.state.cont = !NewStation.state.cont;
    this.draw();
  }

  static _pickStation(type) {
    return NewStation.pick(type);
  }

  static _mainStation(type) {
    NewStation.main(type);
  }

  static _emptyStation(type) {
    NewStation.empty(type);
  }

  static _tzImport() {
    this._close();
    TzImport.pick(null);
  }

  static _input(target) {
    if (!target.closest('#dlg.nw')) return;
    if (target.id === 'nwQ') {
      this.state.q = target.value;
      $('#nwRes').innerHTML = this.found();
    }
    if (target.id === 'nwCatQ') $('#nwGroups').innerHTML = CatPicker.filter(target.value, this._units());
    if (target.dataset.nsr) NewStation.input(target);
    if (target.id === 'nwName') this.state.name = target.value;
  }

  static _enter(event) {
    const target = event.target;
    if (!target.closest || !target.closest('#dlg.nw') || event.key !== 'Enter') return;
    if (target.id === 'nwQ') {
      const card = QuickFind.matches(this.state.q)[0];
      if (card) {
        event.preventDefault();
        this._addFound(card);
      }
    }
    if (target.id === 'nwCatQ') {
      event.preventDefault();
      const cat = CatPicker.first(this._units());
      if (cat) this._pickCat(cat);
    }
    if (target.dataset.nsr) {
      event.preventDefault();
      NewStation.pick(EquipTypes.byId(this.state.cat));
    }
  }
}
