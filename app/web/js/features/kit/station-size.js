import { Kit } from './kit.js';
import { StationAuto } from './station-auto.js';
import { ContainerPart } from './container-part.js';
import { StationLayout } from '../layout/station-layout.js';
import { esc } from '../../core/util.js';
import { Mm } from '../layout/mm.js';
import { Toast } from '../../core/toast.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationPlan } from './station-plan.js';
/**
 * Размер блок-контейнера «по проекту» по оборудованию: наименьший размер из ряда, при котором всё помещается; длина задана —
 * компоновка пересобирается с нужной плотностью и уведомлением. Размер, вписанный менеджером, не трогается.
 */
export class StationSize {
  static last = new Map();
  static dens = new Map();
  static TOAST_MS = 7000;

  /**
   * Длина задана: компоновка пересобрана — уведомление, если сменилась плотность или длина не подходит.
   * @param {object} item
   * @param {object} container
   * @param {object} plan
   */
  static notify(item, container, plan) {
    const length = StationGeo.len(container.lenFix);
    if (!length) {
      this.dens.delete(item.id);
      return;
    }
    const key = `${length}|${this._density(plan)}`;
    const was = this.dens.get(item.id);
    this.dens.set(item.id, key);
    if (was === key) return;
    const message = this._message(plan, length);
    // после перерисовки окна (иначе уведомление пропадает вместе со старым содержимым)
    if (message) setTimeout(() => Toast.show(message, this.TOAST_MS), 0);
  }

  static _density(plan) {
    if (plan.level === 'error') return 'error';
    return plan.density ? plan.density.id : '';
  }

  static _message(plan, length) {
    if (plan.level === 'error') return (plan.issues[0] || {}).text || 'Не помещается';
    return plan.density
      ? `Длина ${Mm.text(length)} мм: компоновка пересобрана — «${plan.density.title}» (${plan.density.text})`
      : '';
  }

  /**
   * Подпись под полем размера: длина задана — плотность и «размер — по оборудованию».
   * @param {object} container
   * @param {object} plan
   * @param {number} index
   * @returns {string}
   */
  static note(container, plan, index) {
    const length = StationGeo.len(container && container.lenFix);
    if (!length) return '';
    return `<p class="muted kit-szn">Длина задана: <b>${esc(Mm.text(length))} мм</b>${this._noteState(plan)}. <button type="button" class="lnk" data-a="stlAuto" data-i="${index}">размер — по оборудованию</button></p>`;
  }

  static _noteState(plan) {
    const density = plan && plan.density;
    if (density) return ` — компоновка «${esc(density.title)}» (${esc(density.text)})`;
    return plan && plan.level === 'error' ? ' — <span class="bad-t">не помещается</span>' : '';
  }

  /**
   * Размер по оборудованию, если исходные изменились.
   * @param {object} item
   * @returns {boolean} размер изменился
   */
  static apply(item) {
    return this._apply(item, { force: false });
  }

  /**
   * Размер по оборудованию заново (состав или требования изменены программой).
   * @param {object} item
   * @returns {boolean} размер изменился
   */
  static refresh(item) {
    return this._apply(item, { force: true });
  }

  static _apply(item, { force }) {
    const container = this._flexible(item);
    if (!container) return false;
    // исходные — те же, что у расстановки (где ресивер, ресиверы снаружи, ворота): иначе размер расходился с чертежом
    const full = StationPlan.input(item);
    const input = { ...full, cont: { ...full.cont, size: '', sizeAuto: true } };
    const hash = StationLayout.hash(input);
    const last = this.last.get(item.id);
    if (!force && last && last.h === hash && last.size === String(container.size || '')) return false;
    const plan = StationLayout.solve(input);
    const size = this._size(plan);
    this.last.set(item.id, { h: hash, size });
    this.notify(item, container, plan);
    const changed = !(size === String(container.size || '') && container.sizeAuto);
    if (changed) ContainerPart.apply(container, { size, sizeAuto: true });
    // та же расстановка — вкладке «Компоновка» и характеристикам второй раз не считать
    StationPlan.keep(item, plan, `${hash}|${full.air}`);
    if (changed) StationAuto.fill(item);
    return changed;
  }

  /** блок-контейнер «по проекту» без своего размера (вписанный менеджером — не трогать) или null */
  static _flexible(item) {
    if (!StationPlan.enabled(item)) return null;
    const container = Kit.container(item);
    if (!container || !StationGeo.FLEX[container.ctype]) return null;
    return String(container.size || '').trim() && !container.sizeAuto ? null : container;
  }

  /** размер по расстановке; из модулей — размер одного модуля (в составе контейнер × N) */
  static _size(plan) {
    const geo = plan.geo;
    if (plan.level === 'error' || plan.level === 'none' || !geo || !geo.ext) return '';
    const module = geo.mods && geo.mods.Lm;
    return (module ? [geo.mods.Lm, geo.mods.Wm, geo.ext[2]] : geo.ext).join(' × ');
  }
}
