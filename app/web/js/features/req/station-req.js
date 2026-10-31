import { ReqChecks } from './req-checks.js';
import { ReqForm } from './req-form.js';
import { ReqLine } from './req-line.js';
import { ReqNum } from './req-num.js';
import { AirDemand } from '../calc/air-demand.js';
import { AirChain } from '../layout/air-chain.js';
import { DryerDerate } from '../layout/dryer-derate.js';
import { ReceiverPlan } from '../layout/receiver-plan.js';
import { StationEquip } from '../layout/station-equip.js';
import { SummerTemp } from '../layout/summer-temp.js';
import { StationDefaults } from '../kit/station-defaults.js';
import { Attrs } from '../../core/item-attrs.js';
import { StationRules } from '../rules/station-rules.js';
import { Kit } from '../../core/kit.js';

/** Требования к станции (из ТЗ заказчика или вручную): вид станции, значения для подбора, расчёта и чертежа. */
export class StationReq {
  static FIRE = ['А', 'Б', 'В1', 'В2', 'В3', 'В4', 'Г', 'Д'];
  static FIRE_DEF = { comp: 'В4', dgu: 'В1', pump: 'Д' };
  static RES = [
    ['', 'без резерва'],
    ['1', 'N + 1'],
    ['2', 'N + 2'],
  ];
  static WORK = [
    ['', 'по подбору'],
    ['1', '1'],
    ['2', '2'],
    ['3', '3'],
    ['4', '4'],
  ];
  // особые требования ТЗ: ключ, подпись, виды станций; АВР и диспетчеризация — шкафы в составе
  static OPTS = [
    ['oilFree', 'Безмасляный компрессор (класс 0 по маслу)', ['comp']],
    ['vsd', 'Частотное регулирование', ['comp', 'pump']],
    ['ats', 'Два ввода питания с АВР', ['comp', 'pump', 'dgu']],
    ['scada', 'Диспетчеризация — шкаф АСУ ТП', ['comp', 'pump', 'dgu']],
  ];
  static ATS = /АВР|ввод\S*\s+резерв/i;
  static SCADA = /АСУ\s?ТП|диспетчер/i;
  static INDUSTRY = [
    ['', 'общепромышленная'],
    ['food', 'пищевая (в т. ч. напитки)'],
    ['med', 'медицинская, фармацевтическая'],
  ];
  static INDUSTRY_WORD = { food: 'пищевой', med: 'медицинской и фармацевтической' };
  static OIL_FREE = { industries: ['food', 'med'] };
  static RECV = [
    ['', 'по методике (мокрый — при пиках)'],
    ['both', 'основной + мокрый'],
    ['after', 'только после осушителя'],
    ['before', 'только до осушителя'],
  ];
  static RECV_MODES = ['before', 'after', 'both'];
  static RSIZE = [
    ['', 'авто: кратно 900 л'],
    ['900', '900 л'],
    ['500', '500 л (крайняя необх.)'],
  ];
  static RWHY = [
    ['', 'обоснование 500 л —'],
    ['space', 'нехватка места'],
    ['mass', 'ограничение по массе'],
  ];
  // режим «эксперт» вентиляции: [ключ требований, ключ расчёта, подпись, подсказка]; пусто — по правилам
  static VENT = [
    ['ventK', 'k', 'k — доля мощности в тепло', '0,9'],
    ['ventTin', 'tIn', 't_вн летом, °C', '40'],
    ['ventDt', 'dt', 'Δt помещения летом, °C', 't_вн − t_нар'],
    ['ventDtc', 'dtc', 'Нагрев воздуха в компрессоре, °C', '15'],
    ['ventVin', 'vIn', 'Скорость притока (по рамке), м/с', '3'],
    ['ventVout', 'vOut', 'Скорость выброса (по рамке), м/с', '4'],
    ['ventRes', 'res', 'Запас притока', '1,1'],
    ['ventU', 'U', 'U стенки, Вт/(м²·°C)', 'по утеплителю'],
    ['ventFan', 'fan', 'Вытяжной вентилятор, м³/ч', 'нет'],
    ['ventEta', 'eta', 'КПД рекуператора', 'по типу'],
    ['ventTexh', 'tExh', 't выбросного воздуха зимой, °C', '+5'],
    ['ventPhi', 'phi', 'Влажность выбросного воздуха, %', '50'],
    ['ventDays', 'days', 'Отопительный период, сут', '205'],
    ['ventTavg', 'tavg', 'Средняя температура периода, °C', '−2,2'],
  ];
  static HRV = [
    ['', 'с промежуточным теплоносителем (по умолчанию)'],
    ['plate', 'пластинчатый перекрёстный'],
    ['rotary', 'роторный'],
    ['glycol', 'с промежуточным теплоносителем'],
  ];
  static BASIS = [
    ['fad', 'на выходе компрессора (FAD, как в каталогах — ISO 1217)'],
    ['normal', 'нормальные н. м³ (0 °C, 101,3 кПа)'],
    ['std', 'стандартные ст. м³ (20 °C, 101,3 кПа, ГОСТ 2939)'],
  ];
  static LIQUID = [
    ['', 'вода (по умолчанию)'],
    ['other', 'другая — по паспорту насоса и данным заказчика'],
  ];
  static MODE = [
    ['prime', 'основной источник (PRP)'],
    ['standby', 'резервный — до 200 ч в год (ESP)'],
  ];
  static START = [
    ['', 'не указан'],
    ['direct', 'прямой'],
    ['stardelta', 'звезда — треугольник'],
    ['soft', 'плавный пуск'],
    ['vsd', 'частотный преобразователь'],
  ];
  static KINDS = [
    ['comp', /comp/],
    ['dgu', /dgu/],
    ['pump', /pump/],
  ];
  static NOISE = 80;
  static CENTS = 100;
  static PERCENT = 100;
  static FULL_HUMIDITY = 100;
  static WHY_MAX = 300;

  /**
   * Требования позиции (пустой объект, если их нет).
   * @param {object} item
   * @returns {object}
   */
  static of(item) {
    return item && item.req && typeof item.req === 'object' ? item.req : {};
  }

  /**
   * Требования позиции — создать, если их нет.
   * @param {object} item
   * @returns {object}
   */
  static ensure(item) {
    if (!item.req || typeof item.req !== 'object') item.req = {};
    return item.req;
  }

  /**
   * Число поля требований.
   * @param {*} value
   * @returns {number|null}
   */
  static num(value) {
    return ReqNum.num(value);
  }

  /**
   * Число резервных агрегатов.
   * @param {object} req
   * @returns {number}
   */
  static reserve(req) {
    return Math.max(0, Math.round(this.num(req.reserve) || 0));
  }

  /**
   * Вид станции: comp — компрессорная, dgu — ДГУ, pump — насосная, '' — не станция.
   * @param {object} item
   * @returns {string}
   */
  static kind(item) {
    const cat = String(Attrs.of(item).cat || '');
    const found = this.KINDS.find(([, pattern]) => pattern.test(cat));
    return found ? found[0] : '';
  }

  /**
   * Безмасляный компрессор нужен: по требованию или по отрасли (правило comp.oil_free), если масляный не разрешён.
   * @param {object} item
   * @returns {boolean}
   */
  static oilFree(item) {
    const req = this.of(item);
    if (this.kind(item) !== 'comp') return false;
    if (req.oilFree) return true;
    const industries = (StationRules.opt('comp.oil_free') || this.OIL_FREE).industries || [];
    return industries.includes(req.industry) && !req.oilOk;
  }

  /**
   * Почему безмасляный: «для пищевой промышленности» или «по ТЗ».
   * @param {object} item
   * @returns {string}
   */
  static oilWhy(item) {
    const req = this.of(item);
    return !req.oilFree && this.oilFree(item) ? `для ${this.INDUSTRY_WORD[req.industry]} промышленности` : 'по ТЗ';
  }

  /**
   * Шкафы АВР и АСУ ТП по требованиям — добавить, если их нет.
   * @param {object} item
   * @returns {string[]} названия добавленного
   */
  static ensureParts(item) {
    const req = this.of(item);
    const parts = Kit.parts(item);
    const added = [];
    const has = pattern => parts.some(part => pattern.test(String(part.name || '')));
    if (req.ats && !has(this.ATS)) {
      const part = StationDefaults.part(item, 'Шкаф АВР (автоматический ввод резерва)');
      part.attrs = { cat: 'ats' };
      parts.push(part);
      added.push(part.name);
    }
    if (req.scada && !has(this.SCADA)) {
      const part = StationDefaults.part(item, 'Шкаф АСУ ТП (автоматизация и диспетчеризация)');
      parts.push(part);
      added.push(part.name);
    }
    return added;
  }

  /**
   * Где ставить ресиверы: '' — по методике, both, after, before.
   * @param {object} item
   * @returns {string}
   */
  static recv(item) {
    const mode = this.of(item).recv;
    return this.RECV_MODES.includes(mode) ? mode : '';
  }

  /**
   * Ресивер после подготовки — снаружи.
   * @param {object} item
   * @returns {boolean}
   */
  static recvOut(item) {
    return !!this.of(item).recvOut;
  }

  /**
   * Расчёт ресиверов по составу станции (ReceiverPlan) или null.
   * @param {object} item
   * @returns {object|null}
   */
  static recvPlan(item) {
    const equipment = StationEquip.list(Kit.parts(item), { recv: this.recv(item), recvOut: this.recvOut(item) });
    return ReceiverPlan.from(equipment, this.recvIn(item));
  }

  /**
   * Исходные данные расчёта ресиверов (ReceiverPlan): ошибочные поля — как не заданные.
   * @param {object} item
   * @returns {object}
   */
  static recvIn(item) {
    const req = this.of(item);
    const valid = key => (ReqNum.check(key, req[key]) ? null : this.num(req[key]));
    const peakTime = valid('recvT');
    const peakFlow = valid('recvC');
    const drop = valid('recvDrop');
    return {
      dp: valid('recvDp'),
      cyc: peakTime > 0 && peakFlow > 0 && drop > 0 ? { T: peakTime, C: peakFlow, drop } : null,
      point: valid('recvPoint'),
      tz: valid('recvVol'),
      mode: this.recv(item),
      force: req.recvSize === '500' || req.recvSize === '900' ? req.recvSize : '',
      reason: req.recvWhy === 'space' || req.recvWhy === 'mass' ? req.recvWhy : '',
      auto: !!req.recvSizeAuto,
      valve: valid('recvValve'),
      reserve: this.reserve(req),
    };
  }

  /**
   * Категория помещения по СП 12.13130: своя или ориентировочная по виду станции.
   * @param {object} item
   * @returns {string}
   */
  static fire(item) {
    const fire = this.of(item).fire;
    return this.FIRE.includes(fire) ? fire : this.fireDef(item);
  }

  /**
   * Ориентировочная категория помещения по виду станции.
   * @param {object} item
   * @returns {string}
   */
  static fireDef(item) {
    return this.FIRE_DEF[this.kind(item)] || 'Д';
  }

  /**
   * Допустимый уровень звука на рабочем месте, дБА (своё или правило norm.noise).
   * @param {object} item
   * @returns {number}
   */
  static noise(item) {
    const noise = this.num(this.of(item).noise);
    if (noise > 0) return noise;
    return StationRules.ok() ? StationRules.raw('norm.noise') : this.NOISE;
  }

  /**
   * Для расстановки, проверок и чертежа: вид станции, категория, шум, наружный воздух, резерв, вентиляция, ворота, ресиверы.
   * @param {object} item
   * @returns {object}
   */
  static plan(item) {
    const req = this.of(item);
    const kind = this.kind(item);
    return {
      kind,
      fire: this.fire(item),
      fireAuto: !this.FIRE.includes(req.fire),
      noise: this.noise(item),
      tmin: ReqNum.loose(req.tmin),
      tmax: ReqNum.loose(req.tmax),
      res: this.reserve(req),
      vent: this.vent(item),
      gate: {
        off: ReqNum.check('gateOff', req.gateOff) ? null : ReqNum.loose(req.gateOff),
        why: String(req.gateWhy || '')
          .trim()
          .slice(0, this.WHY_MAX),
      },
      recvIn: kind === 'comp' ? this.recvIn(item) : null,
      dryer: kind === 'comp' ? this.dryer(item) : null,
    };
  }

  /**
   * Условия поправок осушителя из требований — те же числа, что у расчётной записки (ошибочные поля — как не заданные).
   * @param {object} item
   * @returns {{tmax: number|null, tin: number|null, pressure: number|null}}
   */
  static dryer(item) {
    const req = this.of(item);
    const valid = key => (ReqNum.check(key, req[key]) ? null : ReqNum.num(req[key]));
    return { tmax: valid('tmax'), tin: valid('tin'), pressure: valid('pressure') };
  }

  /**
   * Числа режима «эксперт» для расчёта вентиляции (VentCalc).
   * @param {object} item
   * @returns {object} {k, tIn, dt, dtc, vIn, vOut, res, U, fan, eta, tExh, phi, days, tavg, hrvType}
   */
  static vent(item) {
    const req = this.of(item);
    const out = {};
    for (const [reqKey, key] of this.VENT) {
      const value = ReqNum.loose(req[reqKey]);
      if (value != null) out[key] = value;
    }
    if (req.hrvType) out.hrvType = req.hrvType;
    return out;
  }

  /**
   * Документы при поставке — в КП (по умолчанию да).
   * @param {object} item
   * @returns {boolean}
   */
  static docs(item) {
    return this.of(item).docs !== false;
  }

  /**
   * Что даёт состав против требований.
   * @param {object} item
   * @returns {{ok: boolean, text: string}[]}
   */
  static checks(item) {
    return ReqChecks.of(item);
  }

  /**
   * Требуемая производительность компрессоров, м³/мин FAD: потребность (нормальные м³ — к условиям всасывания) с запасом.
   * @param {object} req
   * @param {number} flow
   * @returns {{v: number, why: string}}
   */
  static need(req, flow) {
    const why = [];
    let value = flow;
    if (AirDemand.REF[req.basis]) {
      value = this._fad(req, flow);
      why.push(`${AirDemand.unit(req.basis)} → FAD`);
    }
    const margin = ReqNum.loose(req.margin);
    if (margin > 0) {
      value *= 1 + margin / this.PERCENT;
      why.push(`запас ${String(margin).replace('.', ',')} %`);
    }
    return { v: value, why: why.join(', ') };
  }

  static _fad(req, flow) {
    const tmax = ReqNum.loose(req.tmax);
    const humidity = ReqNum.loose(req.rh);
    return AirDemand.fad(
      flow,
      ReqNum.loose(req.alt) || 0,
      SummerTemp.room(tmax),
      humidity != null ? humidity : this.FULL_HUMIDITY,
      req.basis,
    );
  }

  /**
   * Потери давления в подготовке воздуха и трубопроводе станции, бар — как в расчётной записке (DryerDerate.loss):
   * перепад аппарата по паспорту, иначе по правилу.
   * @param {object[]} parts
   * @returns {number}
   */
  static loss(parts) {
    const units = parts
      .map(part => ({ part, kind: StationEquip.kindOf(part) }))
      .filter(entry => entry.kind === 'dryer' || entry.kind === 'filter')
      .map(entry => ({ kind: entry.kind, info: AirChain.info(entry.part, entry.kind) }));
    return Math.round(DryerDerate.loss(units) * this.CENTS) / this.CENTS;
  }

  /**
   * Короткая строка требований для заголовка блока.
   * @param {object} item
   * @returns {string}
   */
  static line(item) {
    return ReqLine.of(item);
  }

  /**
   * «Все требования, условия расчёта и проверки» — под раскрывающимся блоком «Подбора станции».
   * @param {object} item
   * @param {number} index позиция КП
   * @returns {string}
   */
  static details(item, index) {
    return ReqForm.html(item, index);
  }

  /**
   * Поле требований изменилось.
   * @param {HTMLElement} target
   */
  static change(target) {
    ReqForm.change(target);
  }
}
