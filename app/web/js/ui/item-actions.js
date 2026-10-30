import { FormView } from './form-view.js';
import { Mobile } from './mobile.js';
import { Steps } from './steps.js';
import { CoverSync } from './step-cover.js';
import { Tender } from './tender.js';
import { KpSave } from '../features/doc/kp-save.js';
import { Discount } from '../features/kp/currency.js';
import { Templates } from '../features/doc/templates.js';
import { Kit } from '../features/kit/kit.js';
import { SpecValues } from '../core/spec-values.js';
import { Attrs, ItemParse } from '../core/item-attrs.js';
import { CatFind, Catalog } from '../features/catalog/catalog-store.js';
import { Str } from '../core/str.js';
import { MailDlg } from '../features/kp/mail-dlg.js';
import { KpFile } from '../features/doc/kp-file.js';
import { Api, RemoteResult } from '../core/net.js';
import { DealState } from '../features/deal/deal-state.js';
import { ClientsExportDlg } from '../features/catalog/catalog-export.js';
import { MyPrefs } from '../features/kp/my-prefs.js';
import { ProblemReport } from './problem-report.js';
import { Tour } from './tour.js';
import { DealCard } from '../features/crm/deal-card.js';
import { MyDay } from '../features/kp/my-day.js';
import { QuickSearch } from '../features/kp/quick-search.js';
import { Journal } from '../features/kp/journal.js';
import { CbrRates } from '../features/kp/cbr-rates.js';
import { HelpWindow } from '../features/kp/help-window.js';
import { UiTexts } from '../features/kp/ui-texts.js';
import { SettingsWindow } from '../features/admin/settings-window.js';
import { PartyCheck } from '../features/kp/party-check.js';
import { ClientFields, ClientStore, PartyFind } from '../features/kp/client-store.js';
import { Requisites } from '../features/kp/client-card.js';
import { CatalogSync } from '../features/catalog/catalog-fill.js';
import { CatPrice, PriceHist } from '../features/kp/price-hints.js';
import { CatalogWindow } from '../features/catalog/catalog-window.js';
import { CatSections } from '../features/catalog/cat-sections.js';
import { ItemEditor } from '../features/catalog/item-editor.js';
import { EquipWizard } from '../features/wizard/equip-wizard.js';
import { AiPart } from '../features/catalog/ai-part.js';
import { AiSource } from '../features/catalog/ai-chat.js';
import { AiFill } from '../features/catalog/ai-fill.js';
import { SpecPaste } from '../features/catalog/ai-parse.js';
import { StationModsUi } from '../features/station/station-mods-ui.js';
import { TzImport } from '../features/tz/tz-import.js';
import { IssueSpot } from '../features/station/issue-spot.js';
import { LazyJs } from '../core/lazy-js.js';
import { ExpertFix } from '../features/station/expert-fix.js';
import { StationUi } from '../features/station/station-ui.js';
import { StationParams } from '../features/station/station-params.js';
import { PaintView } from '../features/kit/paint-view.js';
import { KitView } from '../features/kit/kit-view.js';
import { KitActions } from '../features/kit/kit-actions.js';
import { DrawPic } from '../features/kit/draw-pic.js';
import { StationImages } from '../features/station/station-images.js';
import { PageImages } from '../features/catalog/page-images.js';
import { ImageFiles } from '../features/catalog/images.js';
import { CoverHint, ItemSpec } from '../core/item-spec.js';
import { ItemLinks } from '../features/catalog/item-links.js';
import { $, Uid } from '../core/util.js';
import { EquipTypes } from '../core/equip-types.js';
import { Toast } from '../core/toast.js';
import { KpState, S } from '../core/state.js';

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
    delItem: ({ i }) => ItemActions._drop(i),
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
      Toast.show('Заголовок и параметры — по оборудованию КП');
      return RENDER;
    },
    dmode: ({ i, item, button }) => ItemActions._discMode(i, item, button),
  };

  static OPTIONS = {
    addOpt: ({ item }) => {
      (item.options = item.options || []).push(EquipTypes.newOpt(item));
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
      item.features.push({ id: Uid.next(), label: button.dataset.l || '', text: '' });
      item.page = true;
      return RENDER;
    },
    featMv: ({ item, j, button }) => when(ItemLinks.moveFeat(item, j, j + +button.dataset.d)),
    delFeat: ({ item, j }) => {
      const feature = item.features[j];
      if (feature && feature.id) item.gallery = (item.gallery || []).filter(pic => pic.at !== `feat:${feature.id}`);
      item.features.splice(j, 1);
      return RENDER;
    },
    autoAttrs: ({ item }) => ItemActions._autoAttrs(item),
    specTpl: ({ item }) => {
      const added = ItemSpec.applyTemplate(item);
      item.page = true;
      Toast.show(
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
    galAdd: ({ i, button }) => ImageFiles.pickGallery(i, button.dataset.slot || ''),
    galPage: ({ i, event }) => (event.shiftKey ? PageImages.ask(i) : PageImages.open(i)),
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
    pickImg: ({ i, button }) => ImageFiles.pick(button.dataset.k, i),
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
        .then(({ TzOut }) => TzOut.download(i))
        .catch(error => Toast.show(error.message)),
    stSpot: ({ i, j }) => IssueSpot.open(i, j),
    tzLoad: ({ i }) => TzImport.pick(i),
    stlMods: ({ i }) => StationModsUi.open(i),
  };

  static AI_FILL = {
    paste: ({ i }) => SpecPaste.open(i),
    aiCopy: ({ i, button }) => AiFill.copy(i, button.dataset.url || ''),
    aiMore: ({ i }) => AiFill.more(i),
    aiFetch: ({ i }) => AiSource.fetch(i),
    aiAuto: ({ i }) => AiFill.auto(i),
    aiProps: ({ i }) => AiSource.props(i),
    aiPart: ({ i, j }) => AiPart.open(i, j),
    aiPartCopy: ({ i, j, button }) => AiPart.copy(i, j, button.dataset.url || ''),
    aiApply: ({ i }) => AiFill.apply(i),
  };

  static CATALOG = {
    addItem: ({ button }) => EquipWizard.open('kp', button.dataset.cat || ''),
    addStation: ({ button }) => EquipWizard.open('kp', button.dataset.cat || 'station'),
    edit: ({ i, button }) => ItemEditor.open(i, button.dataset.tab),
    secOf: ({ button }) => CatSections.open(button.dataset.sec),
    catOf: ({ button }) => ItemActions._category(button.dataset.cat),
    openCatalog: () => CatalogWindow.open({}),
    priceHist: ({ i }) => PriceHist.open(i),
    catPrice: ({ i }) => CatPrice.apply(i),
    saveCat: ({ i }) => CatalogSync.save(i),
  };

  static CLIENT = {
    partyFind: () => PartyFind.run(),
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
      KpState.persist();
      setTimeout(() => $('#clFind')?.focus(), ItemActions.FOCUS_DELAY);
    },
    checkRun: ({ button }) => PartyCheck.run(button.dataset.force === '1'),
    kpKind: ({ button }) => ItemActions._kpKind(button.dataset.v === 'tender'),
    pickObject: ({ k }) => {
      const place = (ClientStore.current()?.objects || [])[k];
      if (place) S.object = { ...S.object, ...place };
      return RENDER;
    },
    pickContact: ({ k }) => {
      const contact = (ClientStore.current()?.contacts || [])[k];
      if (contact) S.contact = { ...S.contact, ...contact };
      return RENDER;
    },
    clPrev: () => ItemActions._clientKps(),
    clientReq: () =>
      Requisites.copy({
        name: S.client,
        full: S.clientFull,
        inn: S.clientInn,
        kpp: S.clientKpp,
        ogrn: S.clientOgrn,
        address: S.clientAddr,
        director: S.clientDir,
        directorPost: S.clientDirPost,
      }),
  };

  static APP = {
    toPrice: () => Steps.open('price'),
    download: () => ItemActions._download(),
    toSave: () => ItemActions._toSave(),
    integrations: () => SettingsWindow.open('keys'),
    settings: () => SettingsWindow.open(),
    uitexts: () => {
      document.querySelector('details.topmenu')?.removeAttribute('open');
      return UiTexts.toggle();
    },
    help: () => HelpWindow.open(),
    versions: () => HelpWindow.open('versions'),
    cbr: () => CbrRates.load(),
    journal: () => Journal.open(),
    find: () => QuickSearch.open(),
    myDay: () => MyDay.open(),
    dealOpen: ({ button }) => DealCard.open(button.dataset.id),
    myPrefs: () => MyPrefs.open(),
    report: () => ProblemReport.open(),
    tour: () => Tour.start(),
    clientsExport: () => ClientsExportDlg.open(),
    deal: () => DealState.open(),
    docsFolder: () =>
      Api.request(`/api/folder?dir=${encodeURIComponent(KpFile.folder())}`, { method: 'POST' })
        .then(reply => RemoteResult.show(reply))
        .catch(error => Toast.show(`Папка не открыта: ${error.message || error}`)),
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
    copy.id = Uid.next();
    (copy.features || []).forEach(feature => {
      const old = feature.id;
      feature.id = Uid.next();
      (copy.gallery || []).forEach(pic => {
        if (pic.at === `feat:${old}`) pic.at = `feat:${feature.id}`;
      });
    });
    (copy.options || []).forEach(opt => {
      opt.id = Uid.next();
    });
    S.items.splice(i + 1, 0, copy);
    Toast.show('Позиция скопирована');
    return RENDER;
  }

  static _preset(item, k) {
    item.options = item.options || [];
    const preset = EquipTypes.presetsFor(item)[k];
    const index = item.options.findIndex(opt => Str.norm(opt.name) === Str.norm(preset.name));
    if (index >= 0) {
      item.options.splice(index, 1);
    } else {
      const card = CatFind.name(preset.name);
      item.options.push(
        EquipTypes.newOpt(item, {
          ...preset,
          price: card?.price || 0,
          cost: card?.cost || 0,
          costCur: card?.costCur,
          catId: card?.id,
        }),
      );
    }
    return RENDER;
  }

  static _attrsToGroups(item) {
    const groups = ItemSpec.groups(item);
    const keep = (item.groups || []).filter(group => !groups.some(made => made.name === group.name));
    item.groups = [...groups, ...keep];
    if (!item.hint) item.hint = CoverHint.of(item);
    item.page = true;
    Toast.show('Таблица характеристик сформирована');
    return RENDER;
  }

  static _autoAttrs(item) {
    const cat = Attrs.of(item).cat;
    const type = EquipTypes.byId(cat);
    const keep = new Set(['maker', 'series', 'model', ...type.fields.map(param => param.key)]);
    const filled = value => value !== '' && value != null;
    const own = Object.fromEntries(Object.entries(item.attrs || {}).filter(([, value]) => filled(value)));
    const merged = { ...ItemParse.extract(item), ...SpecValues.fromSpec(item, type), ...own, cat };
    item.attrs = Object.fromEntries(
      Object.entries(merged).filter(([key, value]) => filled(value) && (key === 'cat' || keep.has(key))),
    );
    Toast.show('Параметры определены по характеристикам — проверьте');
    return RENDER;
  }

  static _galMain(item, j) {
    if (!(item.gallery || [])[j]) return false;
    const was3d = StationImages.chosen(item);
    if (!ItemLinks.setMain(item, j)) return false;
    Toast.show(
      was3d
        ? 'Главное фото заменено — 3D-вид вернуть можно на вкладке «Компоновка»'
        : 'Главное фото заменено — прежнее перенесено в изображения',
    );
    return RENDER;
  }

  static _galMove(item, j, step) {
    const free = ItemLinks.freeGal(item);
    const place = free.indexOf(j) + step;
    return when(place >= 0 && place < free.length && ItemLinks.moveGal(item, j, free[place]));
  }

  static _stationPhoto(item, j) {
    const part = Kit.parts(item)[j];
    if (!part || !part.photo || !part.photo.src) return false;
    StationImages.chosen(item);
    item.photo = { ...part.photo };
    delete item.photoFrom;
    Toast.show(`Главное фото станции — фото «${part.name || 'элемента'}»`);
    return RENDER;
  }

  static _category(cat) {
    if (EquipTypes.byId(cat).station || !Catalog.cache.some(card => Attrs.of(card).cat === cat))
      return EquipWizard.open('kp', cat);
    return CatalogWindow.open({ cat });
  }

  // тендерное КП — в шаблоне «Тендерный»; обратно — прежний шаблон
  static _kpKind(tender) {
    const was = Tender.active();
    S.tender = Object.assign({ on: false, number: '', url: '' }, S.tender || {}, { on: tender });
    const template = Templates.list.find(tpl => tpl.id === 'tender' && !tpl.error);
    if (tender && !was && template && S.template !== 'tender') {
      S._tplPrev = S.template;
      S.template = 'tender';
      Toast.show(`Шаблон КП: ${template.name}`);
    } else if (!tender && was && S.template === 'tender') {
      const prev = Templates.list.find(tpl => tpl.id === (S._tplPrev || 'pnevmotekh') && !tpl.error);
      if (prev) {
        S.template = prev.id;
        Toast.show(`Шаблон КП: ${prev.name}`);
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
    item._discBad = !Discount.set(item, text);
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
    if (Mobile.isPhone() && Steps.current !== last) Steps.open(last);
    const side = $('#side');
    side.scrollIntoView({ behavior: Mobile.isPhone() ? 'auto' : 'smooth' });
    side.classList.add('pulse');
    setTimeout(() => side.classList.remove('pulse'), this.PULSE);
  }

  static _clientKps() {
    return Journal.open().then(() => {
      const query = $('#jQ');
      if (query) {
        query.value = S.clientInn || S.client;
        query.dispatchEvent(new Event('input'));
      }
    });
  }

  static _fileAction(id, what) {
    return Api.request(`/api/kp/${id}/${what}`, { method: 'POST' })
      .then(reply => RemoteResult.show(reply))
      .catch(error => Toast.show(error.message || 'Файл не найден'));
  }

  static _go(link) {
    const target = link.dataset.go;
    const step = Steps.ofTarget(target, link.textContent || '');
    if (step && step !== Steps.current) {
      Steps.open(step, target);
      return;
    }
    const box = document.getElementById(target);
    box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box?.querySelector('input.bad, input:placeholder-shown, input')?.focus({ preventScroll: true });
  }

  // удалить позицию сразу, «Отменить» — вернуть на то же место (того же КП)
  static _drop(i) {
    const [removed] = S.items.splice(i, 1);
    const opened = S;
    Toast.undo(`Позиция «${removed.name || i + 1}» удалена`, () => {
      if (S !== opened) return;
      S.items.splice(i, 0, removed);
      FormView.render();
      KpState.persist();
    });
    return RENDER;
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
      ImageFiles.pick(drop.dataset.drop, +drop.dataset.i);
      return;
    }
    const button = event.target.closest('[data-a]');
    const handler = button && Object.hasOwn(this.ACTIONS, button.dataset.a) && this.ACTIONS[button.dataset.a];
    const result = handler && handler(this._context(button, event));
    if (result instanceof Promise) result.catch(error => Toast.show(error.message || String(error)));
    if (result !== RENDER) return;
    FormView.render();
    KpState.persist();
  }

  /** Обработчик щелчков формы. */
  static listen() {
    document.addEventListener('click', event => this.click(event));
  }
}
