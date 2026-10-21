import { ContainerKind } from './container-kind.js';
import { ContainerPart } from './container-part.js';
import { Kit } from './kit.js';
import { KitCabinet, KitPipe, PartField } from './kit-fields.js';
import { KitPick } from './kit-pick.js';
import { StationAuto, StationName } from './station-auto.js';
import { CbrRates } from '../kp/cbr-rates.js';
import { Currency } from '../kp/currency.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationSize } from '../station/station-size.js';
import { PaintView } from './paint-view.js';
import { DealWin } from '../deal/deal-win.js';
import { SidePanel } from '../../ui/side-panel.js';
import { InputNum } from '../deal/input-num.js';
import { Toast } from '../../core/toast.js';
import { FormView } from '../../ui/form-view.js';
import { ImageFiles } from '../catalog/images.js';
import { $ } from '../../core/util.js';
import { KitNeed } from './kit-need.js';
import { EquipTypes } from '../../core/equip-types.js';
import { KitView } from './kit-view.js';
import { KitScope } from './kit-scope.js';
import { KpState, S } from '../../core/state.js';

/**
 * Действия вкладки «Состав» (кнопки data-a — из общего обработчика) и поля состава (закупка, валюта, количество,
 * контейнер, трубопровод, шкаф, окраска). Ответ действия: true — перерисовать, 'async' — окно откроется само, false — не
 * моё.
 */
export class KitActions {
  static ACTIONS = {
    kitAdd: '_add',
    kitCat: '_catalog',
    kitPreset: '_preset',
    kitMain: '_main',
    kitSys: '_system',
    kitCont: '_container',
    kitDel: '_delete',
    kitMv: '_move',
    kitRowAdd: '_rowAdd',
    kitRowDel: '_rowDelete',
    kitPhotoDel: '_photoDelete',
    kitPhoto: '_photo',
  };
  static QTY = /^items\.\d+\.kit\.parts\.\d+\.qty$/;
  static KOPECKS = 100;

  /**
   * Действие кнопки.
   * @param {string} action
   * @param {number} index позиция КП
   * @param {HTMLElement} button
   * @returns {boolean|string}
   */
  static run(action, index, button) {
    const item = S.items[index];
    if (!item) return false;
    item.kit = item.kit || { parts: [] };
    const method = this.ACTIONS[action];
    if (!method) return false;
    return this[method]({ item, index, button, parts: item.kit.parts, j: +button.dataset.j });
  }

  static _add({ item, button, parts }) {
    const part = Kit.newPart({ name: button.dataset.n || '' });
    if (button.dataset.role) part.role = button.dataset.role;
    const scope = button.dataset.by;
    if (scope && scope !== KitScope.def(part)) part.by = scope;
    parts.push(part);
    KitView.open.add(part.id);
    item.page = true;
    return true;
  }

  static _catalog({ index, button }) {
    KitPick.open(index, { by: button.dataset.by });
    return 'async';
  }

  static _preset({ item, index, button }) {
    const cat = button.dataset.cat;
    KitPick.open(index, {
      cats: cat && EquipTypes.list.some(type => type.id === cat) ? [cat] : null,
      name: button.dataset.n,
      preset: cat ? KitNeed.presetFor(item, cat) : null,
      by: button.dataset.by,
    });
    return 'async';
  }

  static _main({ item, index }) {
    KitPick.open(index, { cats: (Kit.station(item) || {}).main, role: 'main', preset: KitNeed.mainPreset(item) });
    return 'async';
  }

  static _system({ item, button, parts, j }) {
    const part = parts[j];
    const id = button.dataset.sys;
    part.sys = { ...(part.sys || ContainerKind.SYSTEMS_ON) };
    part.sys[id] = !KitView.sysOn(item, part, id);
    ContainerPart.apply(part);
    return true;
  }

  static _container({ item, button, parts }) {
    parts.push(ContainerPart.create(button.dataset.ct));
    item.page = true;
    StationAuto.fill(item);
    StationName.apply(item);
    return true;
  }

  static _delete({ item, parts, j }) {
    if (!confirm(`Убрать из состава «${parts[j].name || 'элемент'}»?`)) return 'async';
    parts.splice(j, 1);
    Kit.sync(item);
    return true;
  }

  static _move({ button, parts, j }) {
    const k = j + +button.dataset.d;
    if (parts[k]) [parts[j], parts[k]] = [parts[k], parts[j]];
    return true;
  }

  static _rowAdd({ parts, j }) {
    (parts[j].rows = parts[j].rows || []).push({ k: '', v: '' });
    return true;
  }

  static _rowDelete({ button, parts, j }) {
    parts[j].rows.splice(+button.dataset.k, 1);
    return true;
  }

  static _photoDelete({ parts, j }) {
    parts[j].photo = null;
    return true;
  }

  static _photo({ parts, j }) {
    const picker = $('#filePick');
    picker.value = '';
    picker.multiple = false;
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        parts[j].photo = await ImageFiles.gallery(file);
        FormView.render();
        KpState.persist();
      } catch {
        Toast.show('Не удалось открыть изображение');
      }
    };
    picker.click();
    return 'async';
  }

  /** поля состава: закупка (ввод и уход с поля) и прочие (выбор) */
  static listen() {
    document.addEventListener('input', event => this._costInput(event.target));
    document.addEventListener('focusout', event => this._costLeave(event.target));
    document.addEventListener('change', event => this._change(event.target));
  }

  static _costInput(field) {
    if (field.dataset.kitcost == null) return;
    const found = PartField.of(field.dataset.kitcost);
    if (!found) return;
    const cost = InputNum.parse(field.value);
    found.part._costText = field.value;
    field.classList.toggle('bad', Number.isNaN(cost));
    if (!Number.isNaN(cost)) found.part.cost = cost == null ? 0 : Math.round(cost * this.KOPECKS);
    Kit.sync(found.item);
    SidePanel.updateLive();
    KpState.persist();
    this._deal();
  }

  static _costLeave(field) {
    if (field.dataset.kitcost == null) return;
    const found = PartField.of(field.dataset.kitcost);
    if (found && !Number.isNaN(InputNum.parse(found.part._costText))) delete found.part._costText;
    FormView.render();
    this._deal();
  }

  static _deal() {
    DealWin.render();
  }

  static _change(field) {
    const data = field.dataset;
    if (data.kitpp != null) KitPipe.change(field);
    else if (data.kitcab != null) KitCabinet.change(field);
    else if (data.kitpaint != null || data.kitbook != null || data.kitart != null) PaintView.change(field);
    else if (data.kitct != null) this._containerField(field);
    else if (data.kitcur != null) this._currency(field);
    else if (this.QTY.test(data.p || '')) this._qty(data.p);
  }

  /** вид, утепление, климат, размер контейнера; вписан свой размер — подбор по оборудованию отключается */
  static _containerField(field) {
    const found = PartField.of(field.dataset.kitct);
    if (!found) return;
    const { item, part } = found;
    const fld = field.dataset.fld;
    const changes = { [fld]: field.value };
    if (fld === 'ctype') this._kindChanges(part, field.value, changes);
    if (fld === 'size') this._sizeChanges(part, field.value, changes);
    ContainerPart.apply(part, changes);
    StationSize.apply(item);
    StationAuto.fill(item);
    StationName.apply(item);
    FormView.render();
    KpState.persist();
  }

  static _kindChanges(part, ctype, changes) {
    const kind = ContainerKind.of(ctype);
    if (kind.ins) changes.ins = kind.ins;
    if (kind.climate) changes.climate = kind.climate;
    if (part.sizeAuto) changes.size = '';
  }

  /** вписана только длина (блок-контейнер): длина — заданная, ширина, высота и плотность — по оборудованию */
  static _sizeChanges(part, size, changes) {
    changes.sizeAuto = !String(size).trim();
    changes.lenFix = null;
    const length = StationGeo.FLEX[part.ctype] ? StationGeo.len(size) : null;
    if (length) Object.assign(changes, { lenFix: length, size: '', sizeAuto: true });
  }

  static _currency(field) {
    const found = PartField.of(field.dataset.kitcur);
    if (!found) return;
    found.part.costCur = field.value;
    if (field.value !== 'RUB' && !(Currency.rate(field.value) > 0)) CbrRates.fillEmpty();
    Kit.sync(found.item);
    FormView.render();
    KpState.persist();
    this._deal();
  }

  static _qty(path) {
    Kit.sync(S.items[+path.split('.')[1]]);
    FormView.render();
    KpState.persist();
  }
}
