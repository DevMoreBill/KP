import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealUi } from './deal-ui.js';
import { KpState } from '../../core/state.js';
import { Uid } from '../../core/util.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { Auth } from '../../core/auth.js';

/**
 * Поставщик сделки, изменённый менеджером: подстановка условий из справочника по названию и стране, запись в справочник
 * отдела (с паузой во вводе). Справочник и подбор поставщика по производителю — DealSuppliers.
 */
export class DealSupEdit {
  static SAVE_MS = 1200;
  static ID_LEN = 24;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /**
   * Сохранить поставщика в справочник отдела (по названию); правят администратор и менеджеры с правом «Без модерации».
   * @param {object} sup
   */
  static save(sup) {
    if (!String(sup.name || '').trim()) return;
    if (!Auth.can('catSelfMod')) {
      if (!DealUi.supNote) {
        DealUi.supNote = true;
        Toast.show('Поставщик сохранится в этом КП. В общий справочник его вносит администратор');
      }
      return;
    }
    clearTimeout(DealUi.saveT[sup.id]);
    DealUi.saveT[sup.id] = setTimeout(() => DealSupEdit._put(sup), DealSupEdit.SAVE_MS);
  }

  // поля справочника, которых нет в расчёте (реквизиты, склады, контакты, оборудование), — не трогаем; номер правки — чтобы
  // не затереть изменения коллеги
  static async _put(sup) {
    const id = sup.dirId || `sup_${Uid.next()}${Uid.next()}`.slice(0, DealSupEdit.ID_LEN);
    const kpData = DealState.kpInputs();
    const makers = [
      ...new Set(
        kpData.items
          .filter(item => DealSuppliers.of(item.id) === sup.id)
          .map(item => item.maker)
          .filter(Boolean),
      ),
    ];
    const was = (DealUi.sups || []).find(dir => dir.id === id);
    const doc = {
      ...(was || {}),
      name: sup.name.trim(),
      ...Object.fromEntries(DealSuppliers.KEYS.map(key => [key, sup[key] ?? ''])),
      makers: [...new Set([...((was && was.makers) || []), ...makers])],
      ...(was && was._rev != null ? { _rev: was._rev } : {}),
    };
    delete doc.id;
    delete doc.updatedAt;
    try {
      const body = JSON.stringify(doc);
      const saved = await Api.request(`/api/suppliers/${id}`, {
        method: 'PUT',
        headers: DealSupEdit.JSON_HEAD,
        body,
      });
      sup.dirId = id;
      DealUi.sups = (DealUi.sups || []).filter(dir => dir.id !== id).concat(saved);
      KpState.persist();
    } catch {
      // не сохранилось в справочник — поставщик остаётся в КП
    }
  }

  /**
   * Изменены название или страна поставщика: подстановка из справочника, таможня и валюта по стране.
   * @param {string} path
   */
  static changed(path) {
    const deal = DealState.deal();
    const match = /^sup\.(\d+)\.(name|country)$/.exec(path);
    if (!match) return;
    const sup = deal.sup[+match[1]];
    if (match[2] === 'country') {
      DealSuppliers.applyCountry(sup);
      return;
    }
    if (DealSuppliers.norm(sup.name) === sup._dir) return;
    const dir = DealSuppliers.dir(sup.name);
    if (dir && DealSuppliers.applyDir(sup, dir)) Toast.show('Поставщик из справочника: условия подставлены');
  }
}
