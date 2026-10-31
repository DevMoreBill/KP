import { LayoutTab } from './layout-tab.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { KitNeed } from '../kit/kit-need.js';
import { Toast } from '../../core/toast.js';
import { StationAuto, StationName } from '../kit/station-auto.js';
import { ContainerPart } from '../kit/container-part.js';
import { Uid, esc } from '../../core/util.js';
import { Mm } from '../layout/mm.js';
import { HydroScheme } from '../eskd/hydro-scheme.js';
import { StationScheme } from '../eskd/station-scheme.js';
import { StationImages } from './station-images.js';
import { Templates } from '../doc/templates.js';
import { ContainerKind } from '../kit/container-kind.js';
import { KpState, S } from '../../core/state.js';
import { StationGeo } from '../layout/station-geo.js';
import { KpForm } from '../../core/kp-form.js';
import { StationSize } from '../kit/station-size.js';
import { StationPlan } from '../kit/station-plan.js';
import { Kit } from '../../core/kit.js';

/**
 * Компоновка станции в программе: расстановка (с кэшем), что вставлять в КП, вкладка «Компоновка», метка в разделе
 * «Оборудование», проверка перед сохранением. Расчёт — features/layout/, листы — eskd/ и draw/, 3D-вид — view/.
 */
export class StationUi {
  static FULL_NAME = 3;

  /**
   * Значок на вкладке «Компоновка»: число замечаний (красный — не помещается), иначе ''.
   * @param {object} item
   * @returns {string}
   */
  static badge(item) {
    if (!StationPlan.enabled(item) || !Kit.container(item)) return '';
    const plan = StationPlan.plan(item);
    if (!plan || plan.level === 'none') return '';
    const count = (plan.issues || []).filter(issue => issue.level === 'error' || issue.level === 'warn').length;
    if (!count) return '';
    const error = plan.level === 'error';
    return ` <span class="ed-n ${error ? 'err' : 'warn'}" title="Замечаний по компоновке: ${count}">${error ? '✕' : '⚠'} ${count}</span>`;
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
    if (!StationPlan.enabled(item) || !Kit.container(item)) return '';
    const plan = StationPlan.plan(item);
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
      const rec = ((StationPlan.plan(item).air || {}).recs || [])[+button.dataset.k];
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
    item.stLayout = { ...StationPlan.opts(item), [key]: input.type === 'checkbox' ? input.checked : input.value };
    if (key === 'draw' && input.checked) item.stLayout.skip = [];
    if (key === 'air' || key === 'calc') {
      KpState.persist();
      KpForm.render();
      return;
    }
    if (key === 'photo' && input.checked && item.photo && item.photo.gen !== 'st3d' && !this._takePhoto(item, input))
      return;
    await StationImages.sync(item);
    KpState.persist();
    ItemEditor.render();
    KpForm.render();
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
