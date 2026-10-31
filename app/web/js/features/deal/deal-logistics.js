import { DealState } from './deal-state.js';
import { DealSuppliers } from './deal-suppliers.js';
import { DealUi } from './deal-ui.js';
import { Freight } from './freight.js';
import { LgCargoIn } from './lg-cargo-in.js';
import { LgFmt } from './lg-fmt.js';
import { LgMoney } from './lg-money.js';
import { LgOffers } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { LgValues } from './lg-values.js';
import { Toast } from '../../core/toast.js';
import { Catalog, CatalogStore } from '../catalog/catalog-store.js';
import { StationMods } from '../layout/station-mods.js';
import { KitDoc } from '../kit/kit-doc.js';
import { KpState, S } from '../../core/state.js';
import { Api } from '../../core/net.js';
import { KpForm } from '../../core/kp-form.js';
import { LgCargo } from '../../core/lg-cargo.js';
import { Currency } from '../../core/currency.js';
import { Kit } from '../../core/kit.js';
import { DealLink } from '../../core/deal-link.js';
import { DealSupEdit } from './deal-sup-edit.js';

/**
 * Вкладка «Логистика» экономики сделки: тарифы, груз позиций и станций, маршрут, расчёт перед каждой отрисовкой окна —
 * итог доставки по России идёт в расчёт сделки (если не своя сумма), расстояние по дорогам, массы и габариты — в каталог.
 */
export class DealLogistics {
  static KOPECKS = 100;
  static KG_PER_T = 1000;
  static SAVE_MS = 800;

  /**
   * Тарифы (загружаются один раз).
   * @returns {Promise<object>}
   */
  static async load() {
    if (LgState.tar) return LgState.tar;
    return DealLogistics.reload();
  }

  /**
   * Тарифы заново с сервера.
   * @returns {Promise<object>}
   */
  static async reload() {
    try {
      LgState.saved = await Api.request('/api/logistics');
      LgState.failed = '';
    } catch (error) {
      LgState.saved = {};
      LgState.failed = String(error.message || error);
    }
    LgState.tar = Freight.tariffs(LgState.saved);
    return LgState.tar;
  }

  /** Тарифы и подключённые перевозчики. */
  static async loadAll() {
    await DealLogistics.reload();
    try {
      LgState.status = await Api.request('/api/logistics/status');
    } catch {
      LgState.status = null;
    }
  }

  /**
   * Сборка станции: A — кто собирает (к нему везут элементы), toAsm — поставщики элементов (их маршрут — до A).
   * @returns {{A: object, toAsm: Set<string>}|null}
   */
  static asm() {
    const deal = S.deal;
    if (!deal || !deal.asm || deal.asm.on === false) return null;
    const assembler = deal.sup.find(sup => sup.id === deal.asm.sup);
    if (!assembler) return null;
    const parts = KitDoc.lines(S).filter(line => line.part);
    if (!parts.length) return null;
    return {
      A: assembler,
      toAsm: new Set(parts.map(line => DealSuppliers.of(line.id)).filter(id => id !== assembler.id)),
    };
  }

  /**
   * Груз сборщика: станция целиком — габариты контейнера, масса — сумма элементов; из модулей — каждый модуль местом.
   * @returns {object[]}
   */
  static stations() {
    return S.items.filter(item => Kit.has(item)).map(item => DealLogistics._station(item));
  }

  static _addMass(rows, item) {
    const masses = Kit.parts(item).map(part => {
      const mass = LgCargo.of([{ rows: part.rows || [] }]).mass;
      return mass > 0 ? mass * (+part.qty || 1) : null;
    });
    if (!(masses.length && masses.every(mass => mass > 0))) return;
    rows.push({
      k: 'Масса станции в сборе',
      v: `${String(Math.round(masses.reduce((sum, mass) => sum + mass, 0) * DealLogistics.KG_PER_T))} кг`,
    });
  }

  static _perModule(rows, mods) {
    const massRow = rows.find(row => row.k === 'Масса станции в сборе');
    if (massRow) massRow.v = `${String(Math.round(parseInt(massRow.v, 10) / mods.n))} кг`;
  }

  static _station(item) {
    const container = Kit.container(item);
    const rows = [...((container && container.rows) || [])];
    DealLogistics._addMass(rows, item);
    const mods = container ? StationMods.of(container) : null;
    if (mods) DealLogistics._perModule(rows, mods);
    const title = mods ? `Модуль станции (${mods.n} шт.): ` : 'Станция в сборе: ';
    return {
      id: `st:${item.id}`,
      name: title + (item.name || 'без названия'),
      qty: (+item.qty || 1) * (mods ? mods.n : 1),
      groups: [{ name: '', rows }],
    };
  }

  /**
   * Позиции поставщика: масса и габариты — из характеристик, свои правки — в sup.lg.items.
   * @param {object} sup
   * @returns {object[]}
   */
  static items(sup) {
    const own = (sup.lg && sup.lg.items) || {};
    const asm = DealLogistics.asm();
    const cargo = KitDoc.cargo();
    const list =
      asm && asm.A === sup
        ? [
            ...DealLogistics.stations(),
            ...cargo.filter(item => !String(item.id).includes('~') && DealSuppliers.of(item.id) === sup.id),
          ]
        : cargo.filter(item => DealSuppliers.of(item.id) === sup.id);
    return list
      .filter(item => String(item.name || '').trim())
      .map(item => DealLogistics._item(item, own[item.id] || {}));
  }

  static _item(item, own) {
    const cargo = LgCargo.of(item.groups);
    const dims = cargo.dims || {};
    const pick = (field, auto) => {
      const value = LgCargoIn.val(own, field);
      if (value != null) return { v: value, own: true, t: LgCargoIn.text(own, field, value) };
      return { v: auto ?? null, own: false, t: LgCargoIn.text({}, field, auto ?? null) };
    };
    return {
      id: item.id,
      name: item.name,
      qty: +item.qty || 0,
      l: pick('l', dims.l),
      w: pick('w', dims.w),
      h: pick('h', dims.h),
      m: pick('m', cargo.mass),
      dimSrc: cargo.dimSrc,
      massSrc: cargo.massSrc,
    };
  }

  /**
   * Вход расчёта перевозки поставщика.
   * @param {object} sup
   * @returns {object}
   */
  static input(sup) {
    const lgData = sup.lg || {};
    const imp = !LgFmt.isRu(sup) && (sup.where === 'imp' || !!sup.country);
    const from = String(sup.wh || '').trim() || (imp ? LgState.tar.hub : '');
    const asm = DealLogistics.asm();
    return {
      from: { addr: from, geo: DealLogistics._geo(sup.whGeo, from) },
      to: DealLogistics._dest(sup, lgData, asm),
      km: lgData.km || '',
      route: lgData.route || null,
      unload: lgData.unload || LgValues.unload(),
      value: DealLogistics._value(sup, asm),
      items: DealLogistics.items(sup).map(item => DealLogistics._cargoItem(item)),
      imp,
    };
  }

  // элементы станции едут на сборку — до склада сборщика
  static _dest(sup, lgData, asm) {
    const toAsm = asm && asm.toAsm.has(sup.id);
    const object = (S.object && S.object.address) || S.clientAddr || '';
    const addr = String(lgData.to ?? (toAsm ? asm.A.wh || '' : object)).trim();
    const geo = DealLogistics._geo(lgData.toGeo, addr) || (toAsm ? DealLogistics._geo(asm.A.whGeo, addr) : null);
    return { addr, geo };
  }

  static _cargoItem(item) {
    return {
      name: item.name,
      qty: item.qty,
      l: item.l.v,
      w: item.w.v,
      h: item.h.v,
      m: item.m.v,
      open: String(item.id).startsWith('st:'),
    };
  }

  // точный адрес (с координатами) — пока текст поля совпадает с выбранной подсказкой
  static _geo(geo, text) {
    return geo && String(geo.value || '').trim() === text ? geo : null;
  }

  // стоимость груза для страхования: у сборщика — станция целиком (все элементы) и его прочие позиции
  static _value(sup, asm) {
    const own = item =>
      asm && asm.A === sup
        ? String(item.id).includes('~') || DealSuppliers.of(item.id) === sup.id
        : DealSuppliers.of(item.id) === sup.id;
    return KitDoc.cargo()
      .filter(item => String(item.name || '').trim() && own(item))
      .reduce((sum, item) => {
        const qty = +item.qty || 0;
        if (item.cost)
          return sum + (item.cost / DealLogistics.KOPECKS) * qty * (Currency.rate(item.costCur || 'RUB') || 0);
        return sum + ((item.price || 0) / DealLogistics.KOPECKS) * qty * (Currency.rate(Currency.current()) || 0);
      }, 0);
  }

  /**
   * Расчёт перед каждой отрисовкой окна: итог доставки по России — в сделку (если не своя сумма).
   * @param {object} deal
   */
  static sync(deal) {
    if (!LgState.tar) return;
    for (const sup of deal.sup) DealLogistics._syncSup(sup);
  }

  static _syncSup(sup) {
    if (!sup.lg) sup.lg = {};
    // прежние сделки: сумма вписана вручную — так и остаётся
    if (sup.lg.mode == null) {
      const manual = sup.logRu && String(sup.logRu.v ?? '').trim() !== '' && sup.logRu.src !== 'module';
      sup.lg.mode = manual ? 'manual' : LgValues.mode();
    }
    const res = Freight.calc(DealLogistics.input(sup), LgState.tar);
    const fin = LgOffers.final(res, LgOffers.quoteFor(sup, res), sup.lg.pick);
    LgState.res[sup.id] = res;
    LgState.fin[sup.id] = fin;
    if (res.routeKey && !(sup.lg.route && sup.lg.route.key === res.routeKey)) DealLogistics.route(sup, res);
    if (sup.lg.mode === 'auto') DealLogistics._autoSum(sup, res, fin);
  }

  // ins — страховая премия в сумме доставки: страхование НДС не облагается — вычета с неё нет
  static _autoSum(sup, res, fin) {
    const value = fin.price > 0 && !res.need ? String(fin.price) : '';
    const ins = value && fin.chosen && fin.chosen.ins > 0 ? String(Math.round(fin.chosen.ins)) : '';
    if (!DealLogistics._same(sup.logRu, value, ins)) sup.logRu = { v: value, src: 'module', ...(ins ? { ins } : {}) };
    if (DealLogistics._shipDays(sup, res)) sup.ship = String(res.days);
  }

  static _same(now, value, ins) {
    return !!now && now.v === value && now.src === 'module' && (now.ins || '') === ins;
  }

  static _shipDays(sup, res) {
    if (!(LgFmt.isRu(sup) && LgMoney.setDays(sup))) return false;
    return res.days > 0 && !res.need && String(sup.ship) !== String(res.days);
  }

  /**
   * Расстояние по дорогам между точками (OSRM через сервер); не ответил — остаётся «по прямой с поправкой».
   * @param {object} sup
   * @param {object} res расчёт перевозки
   */
  static route(sup, res) {
    const key = res.routeKey;
    if (!key || LgState.routes[key]) return;
    LgState.routes[key] = 'busy';
    Api.request(`/api/geo/route?a=${res.from.lat},${res.from.lon}&b=${res.to.lat},${res.to.lon}`)
      .then(reply => {
        if (!(reply && reply.km > 0)) {
          LgState.routes[key] = (reply && reply.error) || 'нет маршрута';
          return;
        }
        LgState.routes[key] = 'ok';
        sup.lg = sup.lg || {};
        sup.lg.route = { key, km: reply.km, hours: reply.hours, src: reply.src };
        KpState.persist();
        DealLink.render();
      })
      .catch(error => {
        LgState.routes[key] = error.message || 'нет связи';
      });
  }

  /**
   * Адрес поставки (вкладка «Логистика», поле «Куда») — в КП: «Клиент» → «Адрес объекта».
   * @param {object} sup
   */
  static toKp(sup) {
    const addr = DealLogistics.input(sup).to.addr;
    if (!addr) return;
    S.object = { ...S.object, address: addr };
    KpState.persist();
    KpForm.render();
    Toast.show('Адрес поставки скопирован в КП — «Клиент» → «Адрес объекта»');
  }

  /**
   * Нужна ли кнопка «В КП»: адрес объекта, а не склад сборки, и в КП записан другой.
   * @param {object} sup
   * @param {string} addr
   * @returns {boolean}
   */
  static differsFromKp(sup, addr) {
    const asm = DealLogistics.asm();
    if (asm && asm.toAsm.has(sup.id)) return false;
    const text = String(addr || '').trim();
    return Boolean(text) && text !== String((S.object && S.object.address) || '').trim();
  }

  /**
   * Вписанные масса и габариты — в характеристики позиции КП и в карточку каталога.
   * @param {object} sup
   */
  static async saveCargo(sup) {
    const own = (sup.lg && sup.lg.items) || {};
    const items = DealLogistics.items(sup);
    const done = { saved: 0, pend: 0, noCat: [], fail: [] };
    for (const id of Object.keys(own)) await DealLogistics._saveOne({ id, own, items }, done);
    KpState.persist();
    KpForm.render();
    Catalog.refresh();
    const report = [
      done.saved ? `Масса и габариты сохранены в каталог: ${done.saved}` : '',
      done.pend ? `отправлено на модерацию: ${done.pend}` : '',
      done.noCat.length ? `нет в каталоге (записано только в КП): ${done.noCat.join(', ')}` : '',
      done.fail.length ? `не сохранено: ${done.fail.join(', ')}` : '',
    ];
    Toast.show(report.filter(Boolean).join(' · ') || 'Нечего сохранять');
  }

  static _what(fields, value) {
    const dims = ['l', 'w', 'h'].some(field => LgCargoIn.has(fields, field));
    return {
      dims: dims && value.l > 0 && value.w > 0 && value.h > 0,
      mass: LgCargoIn.has(fields, 'm') && value.m > 0,
    };
  }

  // иначе при сохранении КП каталог получил бы прежние характеристики позиции
  static async _saveOne({ id, own, items }, done) {
    const fields = own[id];
    const item = KitDoc.cargo().find(row => row.id === id);
    const cargo = items.find(row => row.id === id);
    if (!item || !cargo) return;
    const value = { l: cargo.l.v, w: cargo.w.v, h: cargo.h.v, m: cargo.m.v };
    const what = DealLogistics._what(fields, value);
    if (!what.dims && !what.mass) return;
    LgCargo.write(item, value, what);
    if (!item.catId) {
      done.noCat.push(item.name);
      delete own[id];
      return;
    }
    try {
      const doc = await CatalogStore.get(item.catId);
      LgCargo.write(doc, value, what);
      doc.updatedAt = new Date().toISOString();
      const reply = await CatalogStore.put(doc);
      if (reply && reply._pending) done.pend++;
      else done.saved++;
      delete own[id];
    } catch (error) {
      done.fail.push(item.name + (error.code === 'conflict' ? ' (карточку изменили — откройте расчёт заново)' : ''));
    }
  }

  /**
   * Подсказки поля «Откуда»: склады поставщика из справочника (адрес, режим работы, контакты).
   * @param {HTMLInputElement} input
   * @returns {object[]}
   */
  static warehouses(input) {
    const sup = S.deal ? DealState.deal().sup[+input.dataset.k] : null;
    if (!sup) return [];
    const dir = (DealUi.sups || []).find(row => row.id === sup.dirId) || DealSuppliers.dir(sup.name);
    return ((dir && dir.warehouses) || [])
      .filter(house => house.addr)
      .map(house => ({
        value: house.addr,
        lat: house.lat ?? null,
        lon: house.lon ?? null,
        city: house.city || '',
        exact: house.lat != null,
        src: 'справочник поставщиков',
        tag: 'склад',
        sub: [house.name, house.hours, house.phone].filter(Boolean).join(' · '),
      }));
  }

  /**
   * Сохранить склад поставщика в справочник после паузы во вводе.
   * @param {object} sup
   */
  static saveWarehouse(sup) {
    clearTimeout(LgState.whTimer);
    LgState.whTimer = setTimeout(() => DealSupEdit.save(sup), DealLogistics.SAVE_MS);
  }
}
