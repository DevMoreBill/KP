import { LayoutTab } from './layout-tab.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { FormView } from '../../ui/form-view.js';
import { KitNeed } from '../kit/kit-need.js';
import { Toast } from '../../core/toast.js';
import { StationAuto, StationName } from '../kit/station-auto.js';
import { StationSize } from './station-size.js';
import { ContainerPart } from '../kit/container-part.js';
import { Uid, esc } from '../../core/util.js';
import { Mm } from '../layout/mm.js';
import { HydroScheme } from '../eskd/hydro-scheme.js';
import { StationScheme } from '../eskd/station-scheme.js';
import { StationImages } from './station-images.js';
import { Templates } from '../doc/templates.js';
import { ContainerKind } from '../kit/container-kind.js';
import { KpState, S } from '../../core/state.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationReq } from '../req/station-req.js';
import { FEAT } from '../../core/features.js';
import { Kit } from '../kit/kit.js';

/**
 * Компоновка станции в программе: расстановка (с кэшем), что вставлять в КП, вкладка «Компоновка», метка в разделе
 * «Оборудование», проверка перед сохранением. Расчёт — features/layout/, листы — eskd/ и draw/, 3D-вид — view/.
 */
export class StationUi {
  static cache = new Map();
  static FULL_NAME = 3;
  static GRADE = /^[1-6]\.[1-6]\.[1-4]$/;
  static SHEETS_MAX = 10;

  /**
   * Функция включена, позиция — станция в контейнере.
   * @param {object} item
   * @returns {boolean}
   */
  static enabled(item) {
    return !!item && !!Kit.station(item) && FEAT.on('stLayout');
  }

  /**
   * Исходные расстановки: контейнер, состав, класс воздуха; где ресивер и снаружи ли — из требований станции.
   * @param {object} item
   * @returns {object}
   */
  static input(item) {
    const req = StationReq;
    return {
      cont: this._cont(Kit.container(item)),
      parts: Kit.parts(item),
      air: this.opts(item).air,
      recv: req ? req.recv(item) : 'after',
      recvOut: req ? req.recvOut(item) : false,
      req: req ? req.plan(item) : null,
    };
  }

  static _cont(container) {
    if (!container) return null;
    return {
      ctype: container.ctype,
      size: container.size,
      sizeAuto: !!container.sizeAuto,
      lenFix: container.lenFix || null,
      mods: container.mods || null,
      ins: container.ins,
      ral: container.ral,
      paint: container.paint || null,
      paintBook: !!container.paintBook,
      art: container.art || null,
      sys: container.sys || null,
      climate: container.climate || '',
      roof: container.roof || '',
      floor: StationGeo.floor(container),
    };
  }

  /**
   * Значок на вкладке «Компоновка»: число замечаний (красный — не помещается), иначе ''.
   * @param {object} item
   * @returns {string}
   */
  static badge(item) {
    if (!this.enabled(item) || !Kit.container(item)) return '';
    const plan = this.plan(item);
    if (!plan || plan.level === 'none') return '';
    const count = (plan.issues || []).filter(issue => issue.level === 'error' || issue.level === 'warn').length;
    if (!count) return '';
    const error = plan.level === 'error';
    return ` <span class="ed-n ${error ? 'err' : 'warn'}" title="Замечаний по компоновке: ${count}">${error ? '✕' : '⚠'} ${count}</span>`;
  }

  /**
   * Расстановка — пересчитывается, только когда изменился состав, контейнер или класс чистоты воздуха.
   * @param {object} item
   * @returns {object} план компоновки
   */
  static plan(item) {
    const input = this.input(item);
    const hash = StationLayout.hash(input);
    const key = `${hash}|${input.air}`;
    const cached = this.cache.get(item.id);
    if (cached && cached.k === key) return cached.plan;
    const plan = StationLayout.solve(input);
    plan.hash = hash;
    this.cache.set(item.id, { k: key, plan });
    return plan;
  }

  /**
   * Расстановка, посчитанная подбором размера по тем же исходным с пустым размером, — в кэш: размер «по оборудованию»
   * на расстановку не влияет (только на отпечаток).
   * @param {object} item
   * @param {object} plan
   * @param {string} sizeKey отпечаток исходных с пустым размером и класс воздуха
   */
  static keep(item, plan, sizeKey) {
    const input = this.input(item);
    if (!input.cont || !input.cont.sizeAuto) return;
    if (
      `${StationLayout.hash({ ...input, cont: { ...input.cont, size: '', sizeAuto: true } })}|${input.air}` !== sizeKey
    )
      return;
    const hash = StationLayout.hash(input);
    plan.hash = hash;
    this.cache.set(item.id, { k: `${hash}|${input.air}`, plan });
  }

  /**
   * Оборудование не помещается — КП не сохраняется; по условным габаритам — только предупреждение.
   * @param {object} item
   * @returns {boolean}
   */
  static blocked(item) {
    if (!this.enabled(item) || !Kit.has(item)) return false;
    const plan = this.plan(item);
    return plan.level === 'error' && !plan.assumed;
  }

  /**
   * Надписи листов и 3D-вида: название, контейнер, цвет, основная надпись (организация, «Разраб.», дата).
   * @param {object} item
   * @param {object} plan
   * @returns {object}
   */
  static meta(item, plan) {
    const container = Kit.container(item);
    const developer = String((S.manager || {}).name || '')
      .trim()
      .replace(/\s+/g, ' ');
    return {
      title: String(item.name || '').trim() || 'Станция в контейнере',
      cont: container ? ContainerKind.of(container.ctype).name : 'Контейнер',
      colorText: plan.colorText ? `цвет ${plan.colorText}` : '',
      org: this.org(),
      dev: this.short(developer),
      date: S.date || '',
    };
  }

  /**
   * Организация для основной надписи: из настроек шаблона КП.
   * @returns {string}
   */
  static org() {
    const pack = Templates.cache[S.template];
    const settings = (pack && pack.settings) || {};
    const template = Templates.current() || {};
    return String(
      settings.company || template.company || (settings.brandParts || []).map(part => part[0]).join('') || 'ПНЕВМОТЕХ',
    ).trim();
  }

  /**
   * «Иванов Иван Иванович» → «Иванов И. И.»; два слова — как есть.
   * @param {string} name
   * @returns {string}
   */
  static short(name) {
    const words = name.split(' ').filter(Boolean);
    return words.length >= this.FULL_NAME ? `${words[0]} ${words[1][0]}. ${words[2][0]}.` : name;
  }

  /**
   * Что вставлять в КП: 3D-вид главным фото, чертёж и виды снаружи — в изображения (по умолчанию да, кроме убранных
   * менеджером), схема и расчётная записка — только если включили; класс чистоты воздуха.
   * @param {object} item
   * @returns {object}
   */
  static opts(item) {
    const own = item.stLayout || {};
    return {
      photo: own.photo !== false,
      out: own.out !== false,
      draw: own.draw !== false,
      scheme: own.scheme === true,
      calc: own.calc === true,
      air: this.GRADE.test(String(own.air || '')) ? own.air : '',
      skip: Array.isArray(own.skip)
        ? own.skip.filter(sheet => Number.isInteger(sheet) && sheet > 0 && sheet < this.SHEETS_MAX)
        : [],
      outSkip: Array.isArray(own.outSkip)
        ? own.outSkip.filter(view => StationImages.VIEWS.some(row => row[0] === view))
        : [],
    };
  }

  /**
   * SVG → адрес картинки.
   * @param {string} svg
   * @returns {string}
   */
  static url(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Схема станции: компрессорная — пневматическая, насосная — гидравлическая; иначе null.
   * @param {object} plan
   * @returns {{cls: object, title: string, name: string}|null}
   */
  static scheme(plan) {
    if (StationScheme.ok(plan))
      return { cls: StationScheme, title: 'Схема пневматическая', name: 'Схема пневматическая принципиальная' };
    if (HydroScheme.ok(plan))
      return { cls: HydroScheme, title: 'Схема гидравлическая', name: 'Схема гидравлическая принципиальная' };
    return null;
  }

  /**
   * Вкладка «Компоновка».
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static tab(item, index) {
    return LayoutTab.html(item, index);
  }

  /**
   * Кнопка «Поместится: … — заменить» / «Достаточно: …».
   * @param {object} suggest подходящий контейнер
   * @param {number} index
   * @returns {string}
   */
  static fix(suggest, index) {
    const size = suggest.size ? ` ${suggest.size.map(side => Mm.text(side)).join(' × ')} мм` : '';
    const text = ContainerKind.of(suggest.ctype).name + size;
    const lead = suggest.smaller ? 'Достаточно' : 'Поместится';
    return `<button class="btn primary" type="button" data-a="stlFix" data-i="${index}" data-ct="${esc(suggest.ctype)}"${suggest.size ? ` data-size="${esc(suggest.size.join(' × '))}"` : ''}>${lead}: ${esc(text)} — заменить</button>`;
  }

  /**
   * Метка на позиции в разделе «Оборудование».
   * @param {object} item
   * @param {number} index
   * @returns {string}
   */
  static chip(item, index) {
    if (!this.enabled(item) || !Kit.container(item)) return '';
    const plan = this.plan(item);
    if (plan.level === 'none') return '';
    const [cls, text] = this._chipState(plan);
    return `<button type="button" class="chip sm stl-chip ${cls}" data-a="edit" data-i="${index}" data-tab="layout" title="Расстановка оборудования в контейнере, габаритный чертёж и 3D-вид">${text}</button>`;
  }

  static _chipState(plan) {
    if (plan.level === 'error')
      return ['bad', plan.assumed ? '✕ Компоновка: проверьте габариты' : '✕ Не помещается в контейнер'];
    return plan.level === 'warn' ? ['warn', '⚠ Компоновка'] : ['on', '✓ Компоновка'];
  }

  /**
   * Действия вкладки: заменить контейнер, размер — по оборудованию, подобрать недостающее для подготовки воздуха.
   * @param {string} action
   * @param {number} index
   * @param {HTMLElement} button
   * @returns {boolean} перерисовать окно
   */
  static act(action, index, button) {
    const item = S.items[index];
    const container = item && Kit.container(item);
    if (!container) return false;
    if (action === 'stlFix') {
      ContainerPart.apply(container, {
        ctype: button.dataset.ct,
        size: button.dataset.size || '',
        sizeAuto: !!StationGeo.FLEX[button.dataset.ct],
      });
      StationSize.apply(item);
      StationAuto.fill(item);
      StationName.apply(item);
      Toast.show(
        `Контейнер заменён: ${ContainerKind.of(container.ctype).name}. Проверьте закупку контейнера в составе станции.`,
      );
      return true;
    }
    if (action === 'stlAuto') {
      container.sizeAuto = true;
      delete container.lenFix;
      StationSize.refresh(item);
      return true;
    }
    if (action === 'stlRec') {
      const rec = ((this.plan(item).air || {}).recs || [])[+button.dataset.k];
      if (rec) KitNeed.open(index, rec);
    }
    return false;
  }

  /**
   * Галочки «главное фото» и «в КП», класс воздуха, расчётная записка.
   * @param {HTMLInputElement} input
   */
  static async check(input) {
    const item = S.items[+input.dataset.i];
    if (!item) return;
    const key = input.dataset.stl;
    item.stLayout = { ...this.opts(item), [key]: input.type === 'checkbox' ? input.checked : input.value };
    if (key === 'draw' && input.checked) item.stLayout.skip = [];
    if (key === 'air' || key === 'calc') {
      KpState.persist();
      FormView.render();
      return;
    }
    if (key === 'photo' && input.checked && item.photo && item.photo.gen !== 'st3d' && !this._takePhoto(item, input))
      return;
    await StationImages.sync(item);
    KpState.persist();
    ItemEditor.render();
    FormView.render();
  }

  /** главное фото станции → 3D-вид (с согласия): прежнее фото — в изображения позиции (фото элемента — остаётся у него) */
  static _takePhoto(item, input) {
    const part = StationImages.partPhoto(item);
    const ask = part
      ? 'Заменить главное фото станции 3D-видом? Фото элемента останется у его описания.'
      : 'Заменить главное фото станции 3D-видом? Прежнее фото останется в изображениях позиции.';
    if (!confirm(ask)) {
      item.stLayout.photo = false;
      input.checked = false;
      return false;
    }
    if (!part) {
      item.gallery = item.gallery || [];
      item.gallery.push({
        id: Uid.next(),
        src: item.photo.src,
        w: item.photo.w,
        h: item.photo.h,
        caption: '',
        slot: '',
        wide: '',
        at: '',
        on: true,
        ...(item.photoSource ? { source: item.photoSource } : {}),
      });
    }
    item.photo = null;
    delete item.photoSource;
    return true;
  }

  /** Галочки и списки вкладки «Компоновка» на странице. */
  static listen() {
    document.addEventListener('change', event => {
      const input = event.target;
      if (input && input.dataset && input.dataset.stl) this.check(input);
    });
  }
}
