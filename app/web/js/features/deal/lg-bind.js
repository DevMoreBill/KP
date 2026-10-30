import { DealLogistics } from './deal-logistics.js';
import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealWin } from './deal-win.js';
import { LgCargoIn } from './lg-cargo-in.js';
import { LgMoney } from './lg-money.js';
import { LgOffers } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { Toast } from '../../core/toast.js';

/** Ввод на вкладке «Логистика»: адреса и подсказки, расстояние, груз, разгрузка, выбор перевозчика, своя сумма. */
export class LgBind {
  static FOCUS_MS = 30;

  /**
   * Обработчики на окне «Экономики сделки».
   * @param {HTMLDialogElement} dlg
   * @param {Function} touch расчёт изменён
   */
  static bind(dlg, touch) {
    const done = () => {
      touch();
      DealWin.render();
    };
    dlg.addEventListener('input', event => LgBind._input(event.target, done));
    dlg.addEventListener('geo:pick', event => LgBind._geo(event, done));
    dlg.addEventListener('change', event => LgBind._change(event.target, done));
    dlg.addEventListener('click', event => LgBind._click(event, { dlg, done }));
  }

  static _sup(index) {
    return DealState.deal().sup[+index];
  }

  // поле вкладки → расчёт поставщика; false — не поле логистики
  static _update(field) {
    const sup = LgBind._sup(field.dataset.k);
    if (!sup) return false;
    if (!sup.lg) sup.lg = {};
    if (field.dataset.lgf) {
      LgBind._field(sup, field);
      return true;
    }
    if (!field.dataset.lgi) return false;
    const id = field.dataset.lgi;
    sup.lg.items = sup.lg.items || {};
    const own = (sup.lg.items[id] = sup.lg.items[id] || {});
    LgCargoIn.set(own, field.dataset.f, field.value);
    if (!Object.keys(own).length) delete sup.lg.items[id];
    return true;
  }

  static _field(sup, field) {
    const name = field.dataset.lgf;
    if (name === 'wh') {
      sup.wh = field.value;
      DealLogistics.saveWarehouse(sup);
    } else if (name === 'setDays') sup.lg.setDays = field.checked;
    else sup.lg[name] = field.value;
  }

  static _input(field, done) {
    if (field.dataset.lgman != null) {
      const sup = LgBind._sup(field.dataset.lgman);
      if (!sup) return;
      sup.logRu = { v: field.value, cur: LgMoney.cur(sup) };
      done();
      return;
    }
    const ours = (field.dataset.lgf || field.dataset.lgi) && field.tagName === 'INPUT' && field.type !== 'checkbox';
    if (ours && LgBind._update(field)) done();
  }

  // выбран точный адрес из подсказок (или по координатам / ссылке карт)
  static _geo(event, done) {
    const field = event.target;
    const sup = LgBind._sup(field.dataset.k);
    if (!sup || !field.dataset.lgf) return;
    sup.lg = sup.lg || {};
    const geo = { ...event.detail };
    delete geo.note;
    if (field.dataset.lgf === 'wh') {
      sup.wh = geo.value;
      sup.whGeo = geo;
      DealSuppliers.save(sup);
    } else if (field.dataset.lgf === 'to') {
      sup.lg.to = geo.value;
      sup.lg.toGeo = geo;
    }
    done();
  }

  static _change(field, done) {
    if (field.dataset.lgcur != null) {
      const sup = LgBind._sup(field.dataset.lgcur);
      if (!sup) return;
      LgMoney.setCur(sup, field.value);
      done();
      return;
    }
    if (field.dataset.lgpick != null) {
      const sup = LgBind._sup(field.dataset.k);
      if (!sup) return;
      sup.lg = sup.lg || {};
      sup.lg.pick = field.dataset.lgpick;
      done();
      return;
    }
    const ours = (field.tagName === 'SELECT' || field.type === 'checkbox') && field.dataset.lgf;
    if (ours && LgBind._update(field)) done();
  }

  static _click(event, { dlg, done }) {
    const button = event.target.closest('[data-lgx]');
    if (!button) return;
    const k = +button.dataset.k;
    const sup = LgBind._sup(k);
    if (!sup) return;
    const action = button.dataset.lgx;
    if (action === 'quote') {
      delete LgState.tried[LgOffers.quoteKey(LgState.res[sup.id] || { vehicles: [] })];
      LgOffers.quote(k);
    } else if (action === 'savecargo')
      DealLogistics.saveCargo(sup)
        .then(() => DealWin.render())
        .catch(error => Toast.show(`Не сохранено: ${error.message || error}`));
    else if (action === 'mode') LgBind._mode(sup, { button, dlg, done });
    else if (action === 'tokp') {
      DealLogistics.toKp(sup);
      done();
    }
  }

  static _mode(sup, { button, dlg, done }) {
    sup.lg = sup.lg || {};
    sup.lg.mode = button.dataset.v;
    if (sup.lg.mode === 'manual') LgMoney.toManual(sup);
    done();
    setTimeout(() => {
      if (sup.lg.mode === 'manual') dlg.querySelector(`[data-lgman="${button.dataset.k}"]`)?.focus();
    }, LgBind.FOCUS_MS);
  }
}
