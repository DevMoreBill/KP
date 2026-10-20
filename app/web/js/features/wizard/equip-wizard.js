import { NewStation } from './new-station.js';

/**
 * Окно «Добавить оборудование» — один порядок для КП и для каталога: что добавляем (найти в каталоге — только в КП,
 * станция в контейнере, единица оборудования) → как заполнить карточку (по ссылке, с ИИ, таблицей, вручную) или
 * требования станции → карточка открывается сразу на нужной вкладке (в каталоге — карточка каталога).
 */
export class EquipWizard {
  static state = { where: 'kp', cat: '', q: '', url: '', name: '', busy: false };
  static ICONS = { st_pump: '💧', st_comp: '💨', st_dgu: '⚡' };
  static FOCUS_DELAY = 40;
  static CAT_FOCUS_DELAY = 30;
  static MAIN_LINE = 3;
  static URL_RE = /^https?:\/\/./;
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
   */
  static open(where, pre) {
    if (where === 'catalog' && !can('catAdd')) {
      cannot('catAdd');
      return;
    }
    Object.assign(this.state, { where: where || 'kp', cat: '', q: '', url: '', name: '', busy: false });
    NewStation.reset();
    if (pre === 'station') this.state.cat = 'station';
    else if (pre && TYPES.some(type => type.id === pre)) this.state.cat = pre;
    const dialog = $('#dlg');
    dialog.className = 'wide nw';
    this.draw();
    if (!dialog.open) dialog.showModal();
    setTimeout(() => ($('#nwQ') || $('#nwName') || $('#nwUrl') || $('[data-nsr]'))?.focus(), this.FOCUS_DELAY);
  }

  static _stations() {
    return TYPES.filter(type => type.station);
  }

  /** Перерисовать окно по состоянию. */
  static draw() {
    const { where, cat } = this.state;
    const type = cat && cat !== 'station' ? typeById(cat) : null;
    const back = cat ? `<button class="btn ghost" type="button" data-nw="back">← Назад</button>` : '';
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
    return TYPES.filter(type => !type.station && (this.state.where === 'catalog' || type.role !== 'accessory'));
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
      ${this._groups()}
      ${more}</div>`;
  }

  static _groups() {
    const units = this._units();
    const counts = new Map();
    catCache.forEach(card => {
      const cat = attrsOf(card).cat;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    const groups = [...new Set(units.map(type => type.group || 'Прочее'))];
    return groups
      .map(group => {
        const buttons = units
          .filter(type => (type.group || 'Прочее') === group)
          .map(
            type =>
              `<button type="button" class="btn" data-nwcat="${esc(type.id)}">${esc(type.name)}${counts.get(type.id) ? ` <small class="muted">${counts.get(type.id)}</small>` : ''}</button>`,
          )
          .join('');
        return `<div class="nw-grp"><span>${esc(group)}</span><div class="tpick">${buttons}</div></div>`;
      })
      .join('');
  }

  /**
   * Найденное в каталоге по строке поиска.
   * @returns {string}
   */
  static found() {
    if (!this.state.q.trim()) return '';
    const hits = quickMatches(this.state.q);
    if (!hits.length) return '<p class="muted">В каталоге не нашлось — заведите карточку ниже: выберите категорию.</p>';
    return hits
      .map(
        card =>
          `<button type="button" class="nw-hit" data-nwadd="${esc(card.id)}">${card.photo ? `<img src="${esc(card.photo.src)}" alt="">` : '<i></i>'}<span><b>${esc(card.name)}</b><small>${esc(mainLine(card, this.MAIN_LINE) || card.spec || '')}</small></span><em>В КП</em></button>`,
      )
      .join('');
  }

  // единица оборудования: как заполнить карточку
  static _unit(type) {
    const { url, busy, name } = this.state;
    const aiText = AI_DIRECT.enabled
      ? `${esc(AI_DIRECT.provider)} прямо в программе: вставьте текст паспорта, загрузите ТЗ или укажите модель — описание и характеристики разложатся по полям одной кнопкой.`
      : 'ChatGPT, Claude, Алиса, GigaChat, DeepSeek — любой. Вставьте текст паспорта или только модель: ИИ разложит описание и характеристики по полям.';
    const urlBox = `<div class="nw-url"><input type="url" id="nwUrl" value="${esc(url)}" placeholder="https://… страница товара" autocomplete="off"><button class="btn primary" type="button" data-nwgo="url"${busy ? ' disabled' : ''}>${busy ? 'Загружаю…' : 'Загрузить'}</button></div>`;
    return `<label class="f nw-name"><span>Наименование или модель <small class="muted">— можно заполнить позже</small></span><input type="text" id="nwName" value="${esc(name)}" placeholder="${esc(type.item)} …, например «Grundfos CR 32-4»" autocomplete="off"></label>
    <p class="nw-h">Как заполнить карточку?</p>
    <div class="nw-opts">
      ${this._option({ key: 'url', icon: '🔗', title: 'По ссылке на сайт', text: 'Программа скачает со страницы текст и характеристики, дальше — ИИ или сразу в таблицу.', extra: urlBox })}
      ${this._option({ key: 'ai', icon: '✨', title: 'С помощью ИИ — рекомендуем', text: aiText })}
      ${this._option({ key: 'paste', icon: '📋', title: 'Таблицей из паспорта или Excel', text: 'Скопируйте два столбца «параметр — значение» — строки станут таблицей характеристик.' })}
      ${this._option({ key: 'manual', icon: '✎', title: 'Вручную', text: 'Пустая карточка: параметры категории, описание, фото и характеристики.' })}
    </div>`;
  }

  static _option({ key, icon, title, text, extra }) {
    return `<div class="nw-opt${key === 'ai' ? ' rec' : ''}"><button type="button" class="nw-optb" data-nwgo="${key}"><i>${icon}</i><span><b>${title}</b><small>${text}</small></span></button>${extra || ''}</div>`;
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
    if (STEP !== 'equip') STEP = 'equip';
    renderForm();
    persist();
    openEditor(S.items.indexOf(item), tab);
    if (after) after(S.items.indexOf(item));
  }

  static _toCatalog(item, tab, after) {
    const { _src, _srcProps, _srcUrl, _srcImgs } = item;
    const doc = CatalogEditor.toDoc(item, { id: uid() + uid(), prices: [] });
    CatalogEditor.openNew(doc, saved => CatalogWindow.win.afterSave(saved));
    Object.assign(S.items[0], { _src, _srcProps, _srcUrl, _srcImgs, _aiStep: item._aiStep, _aiMsg: item._aiMsg });
    EDIT.tab = tab;
    renderEditor();
    if (after) after(0);
  }

  static async _makeUnit(how) {
    const type = typeById(this.state.cat);
    const item = newItem();
    item.attrs = { cat: type.id };
    item.page = true;
    item.name = this.state.name.trim();
    item.features = [];
    if (how === 'url') {
      await this._fromUrl(item);
      return;
    }
    if (how === 'ai') {
      item._aiStep = 1;
      this.finish(item, 'ai');
      return;
    }
    if (how === 'paste') {
      this.finish(item, 'spec', index => openPaste(index));
      return;
    }
    item.features = [{ id: uid(), label: '', text: '' }];
    this.finish(item, 'main');
  }

  static async _fromUrl(item) {
    const url = String(($('#nwUrl') || {}).value || this.state.url).trim();
    this.state.url = url;
    if (!this.URL_RE.test(url)) {
      toast('Вставьте ссылку на страницу товара (начинается с http)');
      return;
    }
    this.state.busy = true;
    this.draw();
    item._srcUrl = url;
    const ok = await aiFetchInto(item);
    this.state.busy = false;
    if (!ok) {
      this.draw();
      toast(item._aiMsg || 'Страница не прочитана');
      return;
    }
    this.finish(item, 'ai');
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
      this._addFound(catCache.find(card => card.id === hit.dataset.nwadd));
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
    if (method) this[method](typeById(this.state.cat));
  }

  static _pickCat(cat) {
    this.state.cat = cat;
    this.draw();
    setTimeout(() => ($('#nwName') || document.querySelector('#dlg [data-nsr]'))?.focus(), this.CAT_FOCUS_DELAY);
  }

  static _addFound(card) {
    this._close();
    if (card) addFromCatalog(card);
  }

  static _back(type) {
    this.state.cat = this.state.cat !== 'station' && type.station ? 'station' : '';
    this.draw();
  }

  static _newType() {
    this._close();
    cwNewType(id => this.open('catalog', id));
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
    if (target.dataset.nsr) NewStation.input(target);
    if (target.id === 'nwName') this.state.name = target.value;
    if (target.id === 'nwUrl') this.state.url = target.value;
  }

  static _enter(event) {
    const target = event.target;
    if (!target.closest || !target.closest('#dlg.nw') || event.key !== 'Enter') return;
    if (target.id === 'nwQ') {
      const card = quickMatches(this.state.q)[0];
      if (card) {
        event.preventDefault();
        this._addFound(card);
      }
    }
    if (target.id === 'nwUrl') {
      event.preventDefault();
      this._readName();
      this._makeUnit('url');
    }
    if (target.dataset.nsr) {
      event.preventDefault();
      NewStation.pick(typeById(this.state.cat));
    }
  }
}
