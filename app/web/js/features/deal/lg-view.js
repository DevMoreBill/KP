import { DealFmt } from './deal-fmt.js';
import { DealLogistics } from './deal-logistics.js';
import { DealState } from './deal-state.js';
import { DealSteps } from './deal-steps.js';
import { Freight } from './freight.js';
import { LgCargoIn } from './lg-cargo-in.js';
import { LgCarrier } from './lg-carrier.js';
import { LgFmt } from './lg-fmt.js';
import { LgOffers } from './lg-offers.js';
import { LgState } from './lg-state.js';
import { LgValues } from './lg-values.js';
import { Fmt } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { AdminGear } from '../../core/admin-gear.js';
import { LgCargo } from '../../core/lg-cargo.js';

/** Вкладка «Логистика»: по каждому поставщику — до границы, маршрут по России, груз, транспорт и разгрузка, цены, итог. */
export class LgView {
  /**
   * Вкладка «Логистика».
   * @param {object} calc расчёт сделки
   * @returns {string}
   */
  static html(calc) {
    const deal = DealState.deal();
    if (!LgState.tar) {
      return DealSteps.html({
        n: 0,
        title: 'Логистика',
        sub: '',
        body: '<p class="muted">Загружаю тарифы…</p>',
        id: 'log',
      });
    }
    const asm = DealLogistics.asm();
    const cards = deal.sup.map((sup, k) => new LgCard(calc, k, asm).html()).join('');
    const sum = calc.sup.reduce((total, sup) => total + sup.L + sup.Lru + sup.ins, 0);
    const sub = asm
      ? `Станция собирается у «${esc(calc.sup[deal.sup.indexOf(asm.A)].name)}»: поставщики элементов везут их туда, а собранная станция едет к заказчику одним грузом (габариты контейнера, масса — сумма элементов). Итог по каждому поставщику сразу идёт в расчёт сделки.`
      : 'Перевозка от поставщика до объекта заказчика: маршрут, груз, транспорт, цены перевозчиков. Итог по каждому поставщику сразу идёт в расчёт сделки.';
    return DealSteps.html({
      n: 0,
      title: 'Логистика',
      sub,
      body: cards,
      tot: ['Итого логистика', sum, 'до границы, страхование и доставка по России'],
      id: 'log',
    });
  }
}

/** Карточка поставщика на вкладке «Логистика». */
export class LgCard {
  static ROUTE_Q =
    ' Можно вставить координаты или ссылку на точку из Google или Яндекс Карт — адрес определится сам. Достаточно и города — тогда расчёт от центра города.';
  static FROM_Q_RU =
    'Точный адрес склада поставщика — выберите из подсказок (склады из справочника поставщиков, DaData или OpenStreetMap). Запоминается в справочнике поставщиков.';
  static FROM_Q_IMP =
    'Где груз выпускается с таможни и откуда едет по России. По умолчанию — из «Настроек» → «Логистика».';
  static GEO_DIGITS = 5;

  /**
   * @param {object} calc
   * @param {number} k номер поставщика
   * @param {object|null} asm сборка станции
   */
  constructor(calc, k, asm) {
    const deal = DealState.deal();
    this.calc = calc;
    this.k = k;
    this.deal = deal;
    this.sup = deal.sup[k];
    this.cs = calc.sup[k];
    this.path = `sup.${k}`;
    this.ru = LgFmt.isRu(this.sup);
    this.lg = this.sup.lg || {};
    this.res = LgState.res[this.sup.id] || Freight.calc(DealLogistics.input(this.sup), LgState.tar);
    this.fin = LgState.fin[this.sup.id] || LgOffers.final(this.res, null, this.lg.pick);
    this.toAsm = asm && asm.toAsm.has(this.sup.id);
    this.isAsm = asm && asm.A === this.sup;
    this.asm = asm;
    this.asmName = asm ? calc.sup[deal.sup.indexOf(asm.A)].name : '';
    this.first = this.ru ? 0 : 1;
  }

  /**
   * Карточка.
   * @returns {string}
   */
  html() {
    const carrier = new LgCarrier(this);
    return `<div class="dl-card lg-card">${this._head()}
        ${this._abroad()}${this._route()}${this._cargo()}${this._transport()}${carrier.offers()}${carrier.total()}</div>`;
  }

  _head() {
    if (this.deal.sup.length <= 1) return '';
    const where = this.ru ? 'покупаем в России' : 'ввозим сами';
    return `<div class="lg-ch"><b>${esc(this.cs.name)}</b><span class="muted">${where}${this._role()}</span></div>`;
  }

  _role() {
    if (this.toAsm) return ` · везём на сборку к «${esc(this.asmName)}»`;
    return this.isAsm ? ' · собирает станцию и везёт заказчику' : '';
  }

  // 1. до границы и страхование — только импорт
  _abroad() {
    if (this.ru) return '';
    const { calc, path, sup } = this;
    const log = DealFmt.field('Перевозка до границы РФ', `${path}.log.v`, {
      calc,
      cur: `${path}.log.cur`,
      src: sup.log && sup.log.src,
      q: 'Сколько стоит довезти груз от поставщика до границы ЕАЭС. Входит в таможенную стоимость.',
    });
    const ins = DealFmt.field('Страхование груза', `${path}.ins`, {
      calc,
      unit: '% от оборудования',
      ph: '0,3',
      q: 'Процент от стоимости оборудования. Входит в таможенную стоимость.',
    });
    return `<div class="lg-sec lg-s-abr"><h5><span class="lg-sn">1</span>До границы РФ</h5><div class="dl-g">${log}
        ${ins}</div></div>`;
  }

  _point(point, what) {
    if (!point) return `<span class="bad-t">${what} не найден — впишите адрес или город</span>`;
    if (point.exact) {
      const coords = `${point.lat.toFixed(LgCard.GEO_DIGITS)}, ${point.lon.toFixed(LgCard.GEO_DIGITS)}`;
      return `<b>${esc(point.name)}</b> <span class="geo-ok" title="${esc(coords)}">точный адрес ✓</span>`;
    }
    const note =
      point.how === 'регион'
        ? ' <span class="muted">(центр региона — уточните адрес)</span>'
        : ' <span class="muted">(центр города)</span>';
    return `<b>${esc(point.name)}</b>${note}`;
  }

  _where() {
    const { res, lg } = this;
    const points = [
      this._point(res.from, this.ru ? 'склад' : 'пункт отправки'),
      this._point(res.to, this.toAsm ? 'склад сборщика' : 'адрес объекта'),
    ].join(' → ');
    if (!res.km) return points;
    const byRoad = lg.route && lg.route.key === res.routeKey && !LgCard._own(lg.km);
    const hours = byRoad && lg.route.hours ? `, в пути без остановок ≈ ${LgFmt.comma(lg.route.hours)} ч` : '';
    return `${points} · <b>${Fmt.num(res.km)} км</b> <span class="muted">${esc(res.kmSrc)}${hours}${esc(this._routeState())}</span>`;
  }

  static _own(dist) {
    return !!LgCargo.num(dist);
  }

  _routeState() {
    const { res, lg } = this;
    if (!(res.routeKey && !(lg.route && lg.route.key === res.routeKey) && !LgCard._own(lg.km))) return '';
    const state = LgState.routes[res.routeKey];
    if (state === 'busy') return ' · считаю путь по дорогам…';
    return state && state !== 'ok' ? ` · ${state}` : '';
  }

  // 2. маршрут
  _route() {
    const { res, lg, sup } = this;
    const title = LgCard._routeTitle(this);
    const noWh = this._noWh();
    const fromQ = DealFmt.help((this.ru ? LgCard.FROM_Q_RU : LgCard.FROM_Q_IMP) + LgCard.ROUTE_Q);
    const toQ = DealFmt.help(
      'Из раздела «Клиент» (объект или юридический адрес). Выберите точный адрес из подсказок (DaData или OpenStreetMap) или вставьте координаты / ссылку на точку из Google или Яндекс Карт. Можно просто город.',
    );
    const kmQ = DealFmt.help(
      'Расстояние по дорогам (OSRM, карты OpenStreetMap): между точными адресами, а если адрес не уточнён — от центра города. Пока маршрут не посчитан (нет связи) — по прямой с поправкой на дороги (точность ±5–10 %). Знаете точное — впишите.',
    );
    const inp = DealLogistics.input(sup);
    return `<div class="lg-sec lg-s-route"><h5><span class="lg-sn">${this.first + 1}</span>${title}${AdminGear.html('params:log', 'логистика')}${AdminGear.html('carriers', 'тарифы перевозчиков')}</h5>
        ${noWh}
        <div class="lg-route">
          <label class="f"><span>Откуда — ${this.ru ? 'склад поставщика' : 'СВХ / терминал'}${fromQ}</span>
            <input type="text" data-lgf="wh" data-geo="wh" data-k="${this.k}" value="${esc(sup.wh || '')}" placeholder="${esc(this.ru ? 'адрес склада, город или координаты' : LgState.tar.hub)}" autocomplete="off"></label>
          ${this._toField(toQ, lg.to ?? inp.to.addr)}
          <label class="f lg-km"><span>Расстояние, км${kmQ}</span>
            <input type="text" inputmode="numeric" data-lgf="km" data-k="${this.k}" value="${esc(lg.km || '')}" placeholder="${res.km ? `${esc(res.km)} — авто` : 'авто'}"></label></div>
        <p class="lg-where">${this._where()}</p></div>`;
  }

  _noWh() {
    if (!(this.toAsm && !String(this.asm.A.wh || '').trim())) return '';
    return `<p class="msg warn">Укажите склад «${esc(this.asmName)}» (адрес производства контейнера) в его карточке ниже — туда едут элементы станции.</p>`;
  }

  _toField(help, value) {
    const label = this.toAsm ? `Куда — склад «${esc(this.asmName)}» (сборка)` : 'Куда — адрес объекта';
    const placeholder = this.toAsm ? 'адрес производства контейнера' : 'адрес объекта, город или координаты';
    const toKp = DealLogistics.differsFromKp(this.sup, value)
      ? `<button class="btn ghost sm lg-tokp" type="button" data-lgx="tokp" data-k="${this.k}" title="Скопировать в КП: «Клиент» → «Адрес объекта»">→ В КП</button>`
      : '';
    return `<label class="f"><span>${label}${help}${toKp}</span>
            <input type="text" data-lgf="to" data-geo="to" data-k="${this.k}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off"></label>`;
  }

  static _routeTitle(card) {
    if (card.toAsm) return `Маршрут на сборку к «${esc(card.asmName)}»`;
    return card.isAsm ? 'Станция в сборе — до заказчика' : 'Маршрут по России';
  }

  _cell(item, field, placeholder, label) {
    const value = item[field];
    const cls = `${value.v == null ? 'need' : ''}${value.own ? ' own' : ''}`;
    return `<input type="text" inputmode="decimal" data-lgi="${esc(item.id)}" data-k="${this.k}" data-f="${field}" value="${esc(value.t)}" placeholder="${placeholder}" class="${cls}" aria-label="${esc(`${item.name}: ${label}`)}" autocomplete="off">`;
  }

  // 3. груз
  _cargo() {
    const tariffs = LgState.tar;
    const items = DealLogistics.items(this.sup);
    const help = DealFmt.help(
      `Масса и габариты — из характеристик позиций («Масса», «Габариты Д × Ш × В»). Габариты — в миллиметрах, масса одного места — в килограммах (например, 2400 × 1200 × 1800 и 1500). Пустые поля заполните; кнопка ниже сохранит их в каталог. К местам легче ${LgCargoIn.kgText(tariffs.packMax)} добавляется упаковка +${LgFmt.num(tariffs.pack)} %.`,
    );
    const body = items.length ? this._cargoTable(items) : '<p class="muted">У этого поставщика нет позиций в КП.</p>';
    return `<div class="lg-sec lg-s-cargo"><h5><span class="lg-sn">${this.first + 2}</span>Груз${help}</h5>
        ${body}</div>`;
  }

  _cargoTable(items) {
    const rows = items
      .map(
        item => `<tr><td class="lg-nm"><b>${esc(item.name)}</b><small>${esc([item.dimSrc, item.massSrc].filter(Boolean).join(' · ') || 'нет габаритов и массы в характеристиках')}</small></td><td class="num">${esc(item.qty)}</td>
            <td>${this._cell(item, 'l', 'Д, мм', 'длина, мм')}</td><td>${this._cell(item, 'w', 'Ш, мм', 'ширина, мм')}</td><td>${this._cell(item, 'h', 'В, мм', 'высота, мм')}</td><td>${this._cell(item, 'm', 'кг', 'масса 1 шт, кг')}</td></tr>`,
      )
      .join('');
    const own = Object.values(this.lg.items || {}).some(row => Object.keys(row).length);
    const save = own
      ? `<div class="lg-row"><button class="btn ghost" type="button" data-lgx="savecargo" data-k="${this.k}">Сохранить массу и габариты в каталог</button><span class="muted">вписанные значения — в карточки позиций, в следующий раз подставятся сами</span></div>`
      : '';
    return `<div class="lg-tw"><table class="lg-t"><thead><tr><th>Позиция</th><th class="num">Мест</th><th>Длина, мм</th><th>Ширина, мм</th><th>Высота, мм</th><th>Масса 1 шт, кг</th></tr></thead><tbody>
          ${rows}</tbody></table></div>
          ${save}`;
  }

  _vehicle(vehicle, i, count) {
    const units = vehicle.units.length;
    const tags = `${vehicle.over ? '<span class="lg-tag warn">негабарит</span>' : ''}${vehicle.heavy ? '<span class="lg-tag warn">тяжеловес</span>' : ''}${vehicle.escort ? '<span class="lg-tag bad">прикрытие</span>' : ''}`;
    const parts = vehicle.parts
      .map(([title, sum]) => `<tr><td>${esc(title)}</td><td class="num">${Fmt.rub(sum)}</td></tr>`)
      .join('');
    return `<div class="lg-veh"><div class="lg-vh"><b>${count > 1 ? `Машина ${i + 1}: ` : ''}${esc(vehicle.C.name)}</b>
          <span class="muted">${units} ${KPGen.plural(units, 'место', 'места', 'мест')} · ${LgCargoIn.kgText(vehicle.fit.mass)} · занято ${LgCargoIn.mmText(vehicle.fit.depth)} из ${LgCargoIn.mmText(vehicle.C.L)}</span>
          ${tags}</div>
          <table class="lg-p">${parts}</table></div>`;
  }

  _vehicles() {
    const res = this.res;
    if (res.need)
      return `<p class="msg">${esc(res.need)}${res.missing.length ? `: ${esc(res.missing.join(', '))}` : ''}</p>`;
    const unload = res.unload
      ? `<div class="lg-veh"><table class="lg-p"><tr><td>Разгрузка: ${esc(res.unload.name)}</td><td class="num">${Fmt.rub(res.unload.cost)}</td></tr></table></div>`
      : '';
    const missing = res.missing.length
      ? `<p class="msg warn">Не посчитаны (нет массы или габаритов): ${esc(res.missing.join(', '))}</p>`
      : '';
    return (
      res.vehicles.map((vehicle, i) => this._vehicle(vehicle, i, res.vehicles.length)).join('') +
      unload +
      res.warn.map(text => `<p class="msg warn">${esc(text)}</p>`).join('') +
      missing
    );
  }

  _unloadSelect() {
    const now = this.lg.unload || LgValues.unload();
    const options = LgState.tar.unload
      .map(
        row =>
          `<option value="${esc(row.id)}"${now === row.id ? ' selected' : ''}>${esc(row.name)} — ${Fmt.rub(row.cost)}</option>`,
      )
      .join('');
    return `<select data-lgf="unload" data-k="${this.k}">
          <option value="auto"${now === 'auto' ? ' selected' : ''}>Подобрать по самому тяжёлому месту</option>
          <option value="none"${now === 'none' ? ' selected' : ''}>Не нужна (разгружает заказчик)</option>
          ${options}</select>`;
  }

  // 4. транспорт и разгрузка
  _transport() {
    const help = DealFmt.help(
      'Машина подбирается по массе и габаритам: самая дешёвая из тарифов, куда помещается груз. Рейс — подача + ставка за км до 1 000 км + «дальняя» ставка дальше (не меньше минимального заказа). Морской контейнер 20 или 40 футов едет на контейнеровозе. Негабарит (шире 2,55 м, выше 4 м от дороги), тяжеловес (тяжелее грузоподъёмности без разрешения) и прикрытие — по правилам РФ. Ставки — «Настройки» → «Тарифы доставки».',
    );
    return `<div class="lg-sec lg-s-trans"><h5><span class="lg-sn">${this.first + 3}</span>Транспорт и разгрузка${help}</h5>
        <label class="f lg-un"><span>Разгрузка на объекте</span>${this._unloadSelect()}</label>
        ${this._vehicles()}<p class="muted lg-note">Ставки за км: ${esc(LgOffers.rateSrc(this.res))}. Погрузка на складе поставщика обычно за его счёт.</p></div>`;
  }
}
