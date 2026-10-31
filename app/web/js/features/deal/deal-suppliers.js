import { DealDefaults } from './deal-defaults.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { Str } from '../../core/str.js';
import { KitDoc } from '../kit/kit-doc.js';
import { KpState, S } from '../../core/state.js';
import { Uid } from '../../core/util.js';
import { Toast } from '../../core/toast.js';
import { Api } from '../../core/net.js';
import { Auth } from '../../core/auth.js';

/**
 * Поставщики сделки: справочники отдела (поставщики, коды ТН ВЭД, ключевая ставка ЦБ), условия из справочника, страна →
 * таможня и валюта, сохранение в справочник, к кому какая позиция, сборка станции у поставщика контейнера.
 */
export class DealSuppliers {
  static KEYS = [
    'wh',
    'whGeo',
    'country',
    'cur',
    'vatIn',
    'noVat',
    'adv',
    'pay',
    'prod',
    'ship',
    'prodK',
    'shipK',
    'cusMode',
    'ivat',
    'ins',
    'fx',
  ];
  static WAIT_MS = 2500;
  static SAVE_MS = 1200;
  static ID_LEN = 24;
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };

  /** Справочники: поставщики, коды ТН ВЭД, ключевая ставка ЦБ (окно не ждёт дольше паузы). */
  static async loadDirs() {
    const jobs = [];
    if (!DealUi.sups) {
      jobs.push(
        Api.request('/api/suppliers')
          .then(res => {
            DealUi.sups = Array.isArray(res) ? res : [];
          })
          .catch(() => {
            DealUi.sups = [];
          }),
      );
    }
    if (!DealUi.cus) {
      jobs.push(
        Api.request('/api/customs')
          .then(res => {
            DealUi.cus = res || {};
          })
          .catch(() => {
            DealUi.cus = {};
          }),
      );
    }
    if (!DealUi.key && !DealUi.keyErr) DealSuppliers._keyRate();
    await Promise.race([Promise.all(jobs), new Promise(resolve => setTimeout(resolve, DealSuppliers.WAIT_MS))]);
  }

  static _keyRate() {
    Api.request('/api/cbr/keyrate')
      .then(res => {
        if (res && res.rate > 0) DealUi.key = res;
        else DealUi.keyErr = (res && res.error) || 'нет данных';
        DealWin.render();
      })
      .catch(error => {
        DealUi.keyErr = error.message || 'нет связи';
      });
  }

  /**
   * Название для сравнения.
   * @param {*} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .trim()
      .toLowerCase();
  }

  /**
   * Поставщик справочника по названию или производителю.
   * @param {string} name
   * @returns {object|null}
   */
  static dir(name) {
    const norm = DealSuppliers.norm(name);
    if (!norm || !DealUi.sups) return null;
    return (
      DealUi.sups.find(dir => DealSuppliers.norm(dir.name) === norm) ||
      DealUi.sups.find(dir => (dir.makers || []).some(maker => DealSuppliers.norm(maker) === norm)) ||
      null
    );
  }

  /**
   * Подставить условия поставщика из справочника (название, страна, валюта, аванс, сроки, таможня, комиссии).
   * @param {object} sup
   * @param {object} dir
   * @returns {boolean}
   */
  static applyDir(sup, dir) {
    if (!dir) return false;
    DealSuppliers._copyKeys(sup, dir);
    sup.name = dir.name;
    sup.dirId = dir.id;
    DealSuppliers._dirCurs(sup, dir);
    sup._dir = DealSuppliers.norm(dir.name);
    return true;
  }

  static _copyKeys(sup, dir) {
    for (const key of DealSuppliers.KEYS) {
      if (dir[key] == null || dir[key] === '') continue;
      sup[key] = typeof dir[key] === 'object' ? JSON.parse(JSON.stringify(dir[key])) : dir[key];
    }
  }

  static _dirCurs(sup, dir) {
    const logCur = dir.cur || dir.logCur;
    if (logCur && logCur !== 'RUB') sup.log.cur = logCur;
    if (sup.cusMode === 'sum' && (dir.cusCur || dir.cur)) sup.cus.cur = dir.cusCur || dir.cur;
  }

  /**
   * Страна → таможенный режим, НДС, валюта.
   * @param {object} sup
   */
  static applyCountry(sup) {
    const preset = DealTerms.countryPreset(sup.country);
    if (!preset) return;
    sup.cusMode = preset.cusMode;
    sup.vatIn = preset.vatIn;
    sup.cur = preset.cur;
    if (preset.cur !== 'RUB') sup.log.cur = preset.cur;
  }

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
    DealUi.saveT[sup.id] = setTimeout(() => DealSuppliers._put(sup), DealSuppliers.SAVE_MS);
  }

  // поля справочника, которых нет в расчёте (реквизиты, склады, контакты, оборудование), — не трогаем; номер правки — чтобы
  // не затереть изменения коллеги
  static async _put(sup) {
    const id = sup.dirId || `sup_${Uid.next()}${Uid.next()}`.slice(0, DealSuppliers.ID_LEN);
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
        headers: DealSuppliers.JSON_HEAD,
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
   * Поставщик позиции (без своего — первый).
   * @param {string} itemId
   * @returns {string}
   */
  static of(itemId) {
    const deal = S.deal;
    if (!deal) return '';
    const own = deal.map && deal.map[itemId];
    if (deal.sup.some(sup => sup.id === own)) return own;
    return DealSuppliers._ofParent(deal, String(itemId)) || deal.sup[0].id;
  }

  // опция без своего поставщика — у поставщика позиции; опция станции — у сборщика
  static _ofParent(deal, lineId) {
    const cut = lineId.indexOf(KitDoc.OPT);
    if (cut < 0) return '';
    const itemId = lineId.slice(0, cut);
    const station = KitDoc.lines(S).some(line => line.part && line.id.startsWith(`${itemId}~`));
    if (!station) return DealSuppliers.of(itemId);
    const asm = deal.asm && deal.asm.on !== false ? deal.asm.sup : '';
    return deal.sup.some(sup => sup.id === asm) ? asm : '';
  }

  /**
   * Строки без поставщика (новые позиции, элементы сборки): к поставщику с тем же названием, а если его нет и у элемента
   * указан поставщик — новая карточка поставщика (условия — из справочника).
   * @param {object} deal
   */
  static autoMap(deal) {
    const def = DealDefaults.get();
    deal.map = deal.map || {};
    for (const line of KitDoc.lines(S)) {
      if (deal.map[line.id] && deal.sup.some(sup => sup.id === deal.map[line.id])) continue;
      const maker = String(line.maker || '').trim();
      if (!maker) continue;
      const sup =
        deal.sup.find(item => Str.norm(item.name) === Str.norm(maker)) ||
        (line.part ? DealSuppliers._newFor(deal, maker, def) : null);
      if (sup) deal.map[line.id] = sup.id;
    }
  }

  static _newFor(deal, maker, def) {
    const blank =
      deal.sup.length === 1 &&
      !String(deal.sup[0].name || '').trim() &&
      !Object.values(deal.map).includes(deal.sup[0].id);
    const next = Math.max(0, ...deal.sup.map(sup => +String(sup.id).replace(/\D/g, '') || 0)) + 1;
    const sup = blank ? deal.sup[0] : DealTerms.newSupplier(`s${next}`, def);
    sup.name = maker;
    const dir = DealSuppliers.dir(maker);
    if (dir) DealSuppliers.applyDir(sup, dir);
    if (!blank) deal.sup.push(sup);
    return sup;
  }

  /**
   * Сборка станции: если в КП есть станция — элементы по умолчанию едут на сборку к поставщику контейнера.
   * @param {object} deal
   */
  static asmAuto(deal) {
    const parts = KitDoc.lines(S).filter(line => line.part);
    if (!parts.length) return;
    if (!deal.asm) deal.asm = { on: true, sup: '', days: '10', daysK: 'work', cost: { v: '' } };
    if (deal.asm.on === false || deal.sup.some(sup => sup.id === deal.asm.sup)) return;
    const container = parts.find(line => line.part.role === 'container');
    if (container) deal.asm.sup = DealSuppliers.of(container.id);
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
