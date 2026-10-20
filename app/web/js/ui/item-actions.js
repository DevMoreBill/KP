import { FormView } from './form-view.js';
import { Mobile } from './mobile.js';
import { Steps } from './steps.js';
import { CoverSync } from './step-cover.js';
import { Tender } from './tender.js';

// действие изменило КП — форма перерисовывается и черновик сохраняется (что вернули окна и загрузки — не в счёт)
const RENDER = Symbol('render');
const when = changed => (changed ? RENDER : null);
// «async» или пусто — окно или загрузка сами перерисуют форму
const rendered = result => when(!!result && result !== 'async');

/** Кнопки действий формы КП (data-a): позиции, опции, характеристики, изображения, станции, окна. */
export class ItemActions {
  static PULSE = 1600;
  static FOCUS_DELAY = 30;

  static ITEMS = {
    delItem: ({ i }) => {
      S.items.splice(i, 1);
      return RENDER;
    },
    up: ({ i }) => {
      [S.items[i - 1], S.items[i]] = [S.items[i], S.items[i - 1]];
      return RENDER;
    },
    down: ({ i }) => {
      [S.items[i + 1], S.items[i]] = [S.items[i], S.items[i + 1]];
      return RENDER;
    },
    qty: ({ item, button }) => {
      const old = +item.qty || 0;
      item.qty = Math.max(1, old + +button.dataset.d);
      (item.options || []).forEach(opt => {
        if (opt.unit !== 'усл.' && +opt.qty === old) opt.qty = item.qty;
      });
      return RENDER;
    },
    dupItem: ({ i, item }) => ItemActions._dup(i, item),
    togglePage: ({ item }) => {
      item.page = !item.page;
      if (item.page && !item.features.length && !item.groups.length) item.features = [{ label: '', text: '' }];
      return RENDER;
    },
    clients: () => {
      S.showClients = !S.showClients;
      return RENDER;
    },
    coverFrom: () => {
      S.cover.touched = false;
      S.cover._src = '';
      CoverSync.run();
      toast('Заголовок и параметры — по оборудованию КП');
      return RENDER;
    },
    dmode: ({ i, item, button }) => ItemActions._discMode(i, item, button),
  };

  static OPTIONS = {
    addOpt: ({ item }) => {
      (item.options = item.options || []).push(newOpt(item));
      return RENDER;
    },
    delOpt: ({ item, j }) => {
      item.options.splice(j, 1);
      return RENDER;
    },
    optPreset: ({ item, k }) => ItemActions._preset(item, k),
  };

  static SPEC = {
    attrsToGroups: ({ item }) => ItemActions._attrsToGroups(item),
    addFeatL: ({ item, button }) => {
      item.features = item.features || [];
      item.features.push({ id: uid(), label: button.dataset.l || '', text: '' });
      item.page = true;
      return RENDER;
    },
    featMv: ({ item, j, button }) => when(edMoveFeat(item, j, j + +button.dataset.d)),
    delFeat: ({ item, j }) => {
      const feature = item.features[j];
      if (feature && feature.id) item.gallery = (item.gallery || []).filter(pic => pic.at !== `feat:${feature.id}`);
      item.features.splice(j, 1);
      return RENDER;
    },
    autoAttrs: ({ item }) => ItemActions._autoAttrs(item),
    specTpl: ({ item }) => {
      const added = applySpecTemplate(item);
      item.page = true;
      toast(
        added
          ? `Добавлено строк по шаблону категории: ${added} — заполните значения`
          : 'Все строки шаблона категории уже есть',
      );
      return RENDER;
    },
    addGrp: ({ item }) => {
      item.groups.push({ name: '', rows: [{ k: '', v: '' }] });
      return RENDER;
    },
    delGrp: ({ item, j }) => {
      item.groups.splice(j, 1);
      return RENDER;
    },
    addRow: ({ item, j }) => {
      item.groups[j].rows.push({ k: '', v: '' });
      return RENDER;
    },
    delRow: ({ item, j, k }) => {
      item.groups[j].rows.splice(k, 1);
      return RENDER;
    },
    star: ({ item, j, k }) => {
      item.groups[j].rows[k].hl = !item.groups[j].rows[k].hl;
      return RENDER;
    },
  };

  static IMAGES = {
    galAdd: ({ i, button }) => pickGallery(i, button.dataset.slot || ''),
    galPage: ({ i, event }) => galFromPage(i, event.shiftKey),
    galDel: ({ item, j }) => {
      StationImages.drop(item, j);
      return RENDER;
    },
    galMain: ({ item, j }) => ItemActions._galMain(item, j),
    galMv: ({ item, j, button }) => ItemActions._galMove(item, j, +button.dataset.d),
    stPhoto: ({ item, j }) => ItemActions._stationPhoto(item, j),
    rmImg: ({ item, button }) => {
      if (button.dataset.k === 'photo' && item.photo && item.photo.gen === 'st3d') StationImages.forget(item, 'photo');
      item[button.dataset.k] = null;
      return RENDER;
    },
    pickImg: ({ i, button }) => pickImage(button.dataset.k, i),
    drawPick: ({ i, j, button }) => DrawPic.pick(i, j, button.dataset.v),
    drawDel: ({ i, j, button }) => {
      DrawPic.del(i, j, button.dataset.v);
      return RENDER;
    },
  };

  // несколько кнопок станции — одно действие
  static STATION_GROUPS = {
    kitAction: ({ action, i, button }) => when(KitActions.run(action, i, button) !== 'async'),
    kitView: ({ action, i, button }) => rendered(KitView.act(action, i, button)),
    paint: ({ action, i, button }) => rendered(PaintView.act(action, i, button)),
    stParam: ({ action, i, button }) => when(StationParams.act(action, i, button)),
    stLayout: ({ action, i, button }) => when(StationUi.act(action, i, button)),
    xFix: ({ action, i, button }) => ExpertFix.act(action, i, button),
  };
  static STATION_KEYS = {
    kitAction: 'kitAdd kitCat kitMain kitCont kitSys kitPreset kitDel kitMv kitRowAdd kitRowDel kitPhoto kitPhotoDel',
    kitView: 'kitOpen kitBy reqPickX reqReset kitNeed kitNeedAll kitSwap',
    paint: 'paintFile paintFileDel paintArt paintArtDel',
    stParam: 'stParAdd stParDel',
    stLayout: 'stlFix stlAuto stlRec',
    xFix: 'xFix xFixAll',
  };
  static STATION = {
    tzOut: ({ i }) =>
      LazyJs.load('tz-out/index.js')
        .then(() => TzOut.download(i))
        .catch(error => toast(error.message)),
    stSpot: ({ i, j }) => IssueSpot.open(i, j),
    tzLoad: ({ i }) => TzImport.pick(i),
    stlMods: ({ i }) => StationModsUi.open(i),
  };

  static AI_FILL = {
    paste: ({ i }) => openPaste(i),
    aiCopy: ({ i, button }) => AiFill.copy(i, button.dataset.url || ''),
    aiMore: ({ i }) => AiFill.more(i),
    aiFetch: ({ i }) => aiFetch(i),
    aiAuto: ({ i }) => AiFill.auto(i),
    aiProps: ({ i }) => aiProps(i),
    aiPart: ({ i, j }) => aiPartDialog(i, j),
    aiPartCopy: ({ i, j, button }) => aiPartCopy(i, j, button.dataset.url || ''),
    aiApply: ({ i }) => AiFill.apply(i),
  };

  static CATALOG = {
    addItem: ({ button }) => EquipWizard.open('kp', button.dataset.cat || ''),
    addStation: ({ button }) => EquipWizard.open('kp', button.dataset.cat || 'station'),
    edit: ({ i, button }) => openEditor(i, button.dataset.tab),
    secOf: ({ button }) => CatSections.open(button.dataset.sec),
    catOf: ({ button }) => ItemActions._category(button.dataset.cat),
    openCatalog: () => openCatalog({}),
    priceHist: ({ i }) => PriceHist.open(i),
    catPrice: ({ i }) => CatPrice.apply(i),
    saveCat: ({ i }) => saveCatalog(i),
  };

  static CLIENT = {
    partyFind: () => partyFind(),
    clientEdit: () => {
      S._clEdit = !S._clEdit;
      return RENDER;
    },
    clientManual: () => {
      S._clManual = true;
      return RENDER;
    },
    clientChange: () => {
      ClientFields.clear(S);
      FormView.render();
      persist();
      setTimeout(() => $('#clFind')?.focus(), ItemActions.FOCUS_DELAY);
    },
    checkRun: ({ button }) => PartyCheck.run(button.dataset.force === '1'),
    kpKind: ({ button }) => ItemActions._kpKind(button.dataset.v === 'tender'),
    pickObject: ({ k }) => {
      const place = (curClient()?.objects || [])[k];
      if (place) S.object = { ...S.object, ...place };
      return RENDER;
    },
    pickContact: ({ k }) => {
      const contact = (curClient()?.contacts || [])[k];
      if (contact) S.contact = { ...S.contact, ...contact };
      return RENDER;
    },
    clPrev: () => ItemActions._clientKps(),
  };

  static APP = {
    toPrice: () => Steps.open('price'),
    download: () => ItemActions._download(),
    toSave: () => ItemActions._toSave(),
    integrations: () => openSettings('keys'),
    settings: () => openSettings(),
    uitexts: () => {
      document.querySelector('details.topmenu')?.removeAttribute('open');
      return uitToggle();
    },
    help: () => openHelp(),
    versions: () => openHelp('versions'),
    cbr: () => loadCBR(),
    journal: () => openJournal(),
    find: () => QuickSearch.open(),
    myDay: () => MyDay.open(),
    dealOpen: ({ button }) => DealCard.open(button.dataset.id),
    myPrefs: () => MyPrefs.open(),
    clientsExport: () => ClientsExportDlg.open(),
    deal: () => DealState.open(),
    docsFolder: () =>
      api(`/api/folder?dir=${encodeURIComponent(KpFile.folder())}`, { method: 'POST' })
        .then(remoteResult)
        .catch(() => {}),
    mailKp: ({ button }) => MailDlg.open(button.dataset.id, S.number),
    openDoc: ({ button }) => ItemActions._fileAction(button.dataset.id, 'open'),
    showDoc: ({ button }) => ItemActions._fileAction(button.dataset.id, 'folder'),
  };

  static ACTIONS = this._table();

  static _table() {
    const station = Object.entries(this.STATION_KEYS).flatMap(([handler, keys]) =>
      keys.split(' ').map(key => [key, this.STATION_GROUPS[handler]]),
    );
    return {
      ...this.ITEMS,
      ...this.OPTIONS,
      ...this.SPEC,
      ...this.IMAGES,
      ...Object.fromEntries(station),
      ...this.STATION,
      ...this.AI_FILL,
      ...this.CATALOG,
      ...this.CLIENT,
      ...this.APP,
    };
  }

  static _dup(i, item) {
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uid();
    (copy.features || []).forEach(feature => {
      const old = feature.id;
      feature.id = uid();
      (copy.gallery || []).forEach(pic => {
        if (pic.at === `feat:${old}`) pic.at = `feat:${feature.id}`;
      });
    });
    (copy.options || []).forEach(opt => {
      opt.id = uid();
    });
    S.items.splice(i + 1, 0, copy);
    toast('Позиция скопирована');
    return RENDER;
  }

  static _preset(item, k) {
    item.options = item.options || [];
    const preset = presetsFor(item)[k];
    const index = item.options.findIndex(opt => norm(opt.name) === norm(preset.name));
    if (index >= 0) {
      item.options.splice(index, 1);
    } else {
      const card = CatFind.name(preset.name);
      item.options.push(newOpt(item, { ...preset, price: card?.price || 0, catId: card?.id }));
    }
    return RENDER;
  }

  static _attrsToGroups(item) {
    const groups = groupsFromAttrs(item);
    const keep = (item.groups || []).filter(group => !groups.some(made => made.name === group.name));
    item.groups = [...groups, ...keep];
    if (!item.hint) item.hint = CoverHint.of(item);
    item.page = true;
    toast('Таблица характеристик сформирована');
    return RENDER;
  }

  static _autoAttrs(item) {
    const cat = attrsOf(item).cat;
    const type = typeById(cat);
    const keep = new Set(['maker', 'series', 'model', ...type.fields.map(param => param.key)]);
    const filled = value => value !== '' && value != null;
    const own = Object.fromEntries(Object.entries(item.attrs || {}).filter(([, value]) => filled(value)));
    const merged = { ...extractAttrs(item), ...attrsFromSpec(item, type), ...own, cat };
    item.attrs = Object.fromEntries(
      Object.entries(merged).filter(([key, value]) => filled(value) && (key === 'cat' || keep.has(key))),
    );
    toast('Параметры определены по характеристикам — проверьте');
    return RENDER;
  }

  static _galMain(item, j) {
    if (!(item.gallery || [])[j]) return false;
    const was3d = StationImages.chosen(item);
    if (!edSetMain(item, j)) return false;
    toast(
      was3d
        ? 'Главное фото заменено — 3D-вид вернуть можно на вкладке «Компоновка»'
        : 'Главное фото заменено — прежнее перенесено в изображения',
    );
    return RENDER;
  }

  static _galMove(item, j, step) {
    const free = edFreeGal(item);
    const place = free.indexOf(j) + step;
    return when(place >= 0 && place < free.length && edMoveGal(item, j, free[place]));
  }

  static _stationPhoto(item, j) {
    const part = Kit.parts(item)[j];
    if (!part || !part.photo || !part.photo.src) return false;
    StationImages.chosen(item);
    item.photo = { ...part.photo };
    delete item.photoFrom;
    toast(`Главное фото станции — фото «${part.name || 'элемента'}»`);
    return RENDER;
  }

  static _category(cat) {
    if (typeById(cat).station || !catCache.some(card => attrsOf(card).cat === cat)) return EquipWizard.open('kp', cat);
    return openCatalog({ cat });
  }

  // тендерное КП — в шаблоне «Тендерный»; обратно — прежний шаблон
  static _kpKind(tender) {
    const was = Tender.active();
    S.tender = Object.assign({ on: false, number: '', url: '' }, S.tender || {}, { on: tender });
    const template = Templates.list.find(tpl => tpl.id === 'tender' && !tpl.error);
    if (tender && !was && template && S.template !== 'tender') {
      S._tplPrev = S.template;
      S.template = 'tender';
      toast(`Шаблон КП: ${template.name}`);
    } else if (!tender && was && S.template === 'tender') {
      const prev = Templates.list.find(tpl => tpl.id === (S._tplPrev || 'pnevmotekh') && !tpl.error);
      if (prev) {
        S.template = prev.id;
        toast(`Шаблон КП: ${prev.name}`);
      }
      delete S._tplPrev;
    }
    return RENDER;
  }

  static _discMode(i, item, button) {
    const input = document.querySelector(`[data-disc="${i}"]`);
    item.discType = button.dataset.v;
    if (item.disc) item.disc.type = button.dataset.v;
    const text = input ? input.value : '';
    item._discText = text;
    item._discBad = !setDisc(item, text);
    if (!item._discBad) delete item._discText;
    return RENDER;
  }

  static async _download() {
    const result = await KpSave.run();
    if (Mobile.isPhone()) $('#dlmsg')?.scrollIntoView({ block: 'center' });
    return result;
  }

  static _toSave() {
    const steps = Steps.visible();
    const last = steps[steps.length - 1].id;
    if (Mobile.isPhone() && STEP !== last) Steps.open(last);
    const side = $('#side');
    side.scrollIntoView({ behavior: Mobile.isPhone() ? 'auto' : 'smooth' });
    side.classList.add('pulse');
    setTimeout(() => side.classList.remove('pulse'), this.PULSE);
  }

  static _clientKps() {
    return openJournal().then(() => {
      const query = $('#jQ');
      if (query) {
        query.value = S.clientInn || S.client;
        query.dispatchEvent(new Event('input'));
      }
    });
  }

  static _fileAction(id, what) {
    return api(`/api/kp/${id}/${what}`, { method: 'POST' })
      .then(remoteResult)
      .catch(() => toast('Файл не найден'));
  }

  static _go(link) {
    const target = link.dataset.go;
    const step = Steps.ofTarget(target, link.textContent || '');
    if (step && step !== STEP) {
      Steps.open(step, target);
      return;
    }
    const box = document.getElementById(target);
    box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box?.querySelector('input.bad, input:placeholder-shown, input')?.focus({ preventScroll: true });
  }

  static _context(button, event) {
    const i = +button.dataset.i;
    return {
      action: button.dataset.a,
      button,
      event,
      i,
      j: +button.dataset.j,
      k: +button.dataset.k,
      item: S.items[i],
    };
  }

  /**
   * Щелчок по форме: шаг (data-step), переход к полю (data-go), место для картинки (data-drop), действие (data-a).
   * @param {MouseEvent} event
   */
  static click(event) {
    const step = event.target.closest('[data-step]');
    if (step) {
      Steps.open(step.dataset.step);
      return;
    }
    const link = event.target.closest('[data-go]');
    if (link) {
      this._go(link);
      return;
    }
    const drop = event.target.closest('[data-drop]');
    if (drop && !event.target.closest('[data-a]')) {
      pickImage(drop.dataset.drop, +drop.dataset.i);
      return;
    }
    const button = event.target.closest('[data-a]');
    const handler = button && Object.hasOwn(this.ACTIONS, button.dataset.a) && this.ACTIONS[button.dataset.a];
    if (!handler || handler(this._context(button, event)) !== RENDER) return;
    FormView.render();
    persist();
  }

  /** Обработчик щелчков формы. */
  static listen() {
    document.addEventListener('click', event => this.click(event));
  }
}
