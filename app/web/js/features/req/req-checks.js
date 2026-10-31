import { StationReq } from './station-req.js';
import { StationDefaults } from '../kit/station-defaults.js';
import { StationRules } from '../rules/station-rules.js';
import { GensetSizing } from '../calc/genset-sizing.js';
import { TzPick } from '../tz/tz-pick.js';
import { AirChain } from '../layout/air-chain.js';
import { StationEquip } from '../layout/station-equip.js';
import { Kit } from '../../core/kit.js';

/**
 * Что даёт состав станции против требований: производительность, давление, безмасляные компрессоры, шкафы АВР и АСУ ТП,
 * мощность и работа ДГУ от бака, подача и напор насосов. Рабочие — без резервных самых больших агрегатов.
 */
export class ReqChecks {
  static TOLERANCE = 0.98;
  static MAX_UNITS = 20;
  static CENTS = 100;
  static TENTHS = 10;
  static PERCENT = 100;

  /**
   * Проверки состава.
   * @param {object} item позиция КП
   * @returns {{ok: boolean, text: string}[]}
   */
  static of(item) {
    const req = StationReq.of(item);
    const ctx = { item, req, kind: StationReq.kind(item), parts: Kit.parts(item), res: StationReq.reserve(req) };
    return [
      ...this._compressors(ctx),
      ...this._oil(ctx),
      ...this._cabinets(ctx),
      ...this._gensets(ctx),
      ...this._pumps(ctx),
    ];
  }

  static _fmt(value) {
    return String(Math.round(value * this.CENTS) / this.CENTS).replace('.', ',');
  }

  static _units(parts, kind) {
    return parts
      .filter(part => StationEquip.kindOf(part) === kind)
      .flatMap(part => Array.from({ length: Math.max(1, Math.min(this.MAX_UNITS, +part.qty || 1)) }, () => part));
  }

  static _sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  // «12,6 + 12,6 в резерве — не меньше 12,5»
  static _enough(ctx, values, need, what, unit) {
    const sorted = [...values].sort((first, second) => second - first);
    const sum = this._sum(sorted);
    const work = this._sum(sorted.slice(ctx.res));
    const ok = work >= need;
    const reserve = ctx.res && sorted.length > ctx.res ? ` + ${this._fmt(sum - work)} в резерве` : '';
    const verdict = ok ? 'не меньше' : 'меньше требуемых';
    return { ok, text: `${what} ${this._fmt(work)} ${unit}${reserve} — ${verdict} ${this._fmt(need)}` };
  }

  static _compressors(ctx) {
    if (ctx.kind !== 'comp') return [];
    const { req, parts } = ctx;
    const out = [];
    const units = this._units(parts, 'compressor');
    const flow = StationReq.num(req.flow);
    const bar = StationReq.num(req.pressure);
    const demand = flow > 0 ? StationReq.need(req, flow) : null;
    const need = demand ? demand.v : null;
    const purge = this._purge(parts);
    const flows = units.map(part => (AirChain.flow(part) || 0) * (1 - purge));
    if (need > 0) {
      const what = `${purge ? 'производительность за вычетом продувки осушителя' : 'производительность'}${demand.why ? ` (потребность: ${demand.why})` : ''}`;
      out.push(this._enough(ctx, flows, need, what, 'м³/мин'));
    }
    if (bar > 0) {
      const pressure = this._pressure(units, parts, bar);
      if (pressure) out.push(pressure);
    }
    return out;
  }

  static _purge(parts) {
    const ads = parts.find(
      part => StationEquip.kindOf(part) === 'dryer' && AirChain.info(part, 'dryer').type === 'ads',
    );
    return ads ? AirChain.purge((ads.attrs || {}).regen) : 0;
  }

  static _pressure(units, parts, bar) {
    const top = Math.max(0, ...units.map(part => AirChain.bar(part) || 0));
    if (!top) return null;
    const loss = StationReq.loss(parts);
    const out = Math.round((top - loss) * this.TENTHS) / this.TENTHS;
    const fmt = value => this._fmt(value);
    if (loss) {
      return {
        ok: out >= bar,
        text: `давление на выходе ≈ ${fmt(out)} бар (компрессор ${fmt(top)}, потери в подготовке воздуха и трубопроводе ≈ ${fmt(loss)}) — ${out >= bar ? 'не меньше' : 'меньше'} ${fmt(bar)}`,
      };
    }
    return { ok: out >= bar, text: `давление ${fmt(top)} бар — ${top >= bar ? 'не меньше' : 'меньше'} ${fmt(bar)}` };
  }

  static _oil(ctx) {
    if (ctx.kind !== 'comp' || !StationReq.oilFree(ctx.item)) return [];
    const units = this._units(ctx.parts, 'compressor');
    const oily = units.filter(part => !TzPick.oilFree(part)).length;
    if (!units.length) return [];
    return [
      {
        ok: !oily,
        text: oily
          ? `компрессор не безмасляный — ${StationReq.oilWhy(ctx.item)} нужен класс 0 по маслу`
          : 'компрессоры безмасляные',
      },
    ];
  }

  static _cabinets({ req, parts }) {
    const has = pattern => parts.some(part => pattern.test(String(part.name || '')));
    const out = [];
    if (req.ats && !has(StationReq.ATS)) out.push({ ok: false, text: 'нет шкафа АВР — по ТЗ два ввода питания' });
    if (req.scada && !has(StationReq.SCADA)) out.push({ ok: false, text: 'нет шкафа АСУ ТП — по ТЗ диспетчеризация' });
    return out;
  }

  static _gensets(ctx) {
    if (ctx.kind !== 'dgu') return [];
    const { req, parts } = ctx;
    const out = [];
    const units = this._units(parts, 'dgu');
    const standby = req.mode === 'standby';
    const power = units.map(part => GensetSizing.cap(part.attrs, standby));
    const need = StationReq.num(req.kw);
    const hours = StationReq.num(req.hours);
    if (units.length && power.some(value => !(value > 0))) {
      out.push({ ok: false, text: 'у ДГУ в карточке не указана мощность — заполните карточку' });
    } else if (need > 0) out.push(this._enough(ctx, power, need, 'мощность', 'кВт'));
    const fuel = this._fuel(ctx, power, hours);
    if (fuel) out.push(fuel);
    return out;
  }

  // работа от бака: топливо в баках станции (и в баке ДГУ, если указан) при нагрузке рабочих ДГУ
  static _fuel(ctx, power, hours) {
    const { item, parts } = ctx;
    const work = this._sum([...power].sort((first, second) => second - first).slice(ctx.res));
    const fuel = parts
      .filter(part => ['tank', 'dgu'].includes(StationEquip.kindOf(part)))
      .reduce((sum, part) => sum + this._litres(part) * Math.max(1, +part.qty || 1), 0);
    const plan = hours > 0 && StationRules.ok() ? GensetSizing.plan(item) : null;
    if (plan && plan.c > 0) return this._planned(plan, hours);
    if (hours > 0 && work > 0 && fuel > 0) return this._rough(work, fuel, hours);
    return null;
  }

  static _litres(part) {
    const tank = StationEquip.num((part.attrs || {}).tank);
    if (StationEquip.kindOf(part) === 'tank') return AirChain.volume(part) || tank || 0;
    return tank || 0;
  }

  // как в расчётной записке
  static _planned(plan, hours) {
    const fmt = value => this._fmt(value);
    const time = plan.have / (plan.c * StationRules.raw('dgu.fuel_margin'));
    const ok = plan.have >= plan.need * (1 - StationRules.raw('calc.tolerance'));
    const text = ok
      ? `работа от баков ≈ ${fmt(Math.floor(time))} ч при нагрузке ${Math.round(plan.x * this.PERCENT)} % (с запасом) — не меньше ${fmt(hours)}`
      : `работа от баков ≈ ${fmt(Math.floor(time))} ч — меньше ${fmt(hours)}: нужно топлива ${fmt(Math.ceil(plan.need))} л, в баках ${fmt(plan.have)}`;
    return { ok, text };
  }

  static _rough(work, fuel, hours) {
    const fmt = value => this._fmt(value);
    const time = fuel / StationDefaults.MARGIN / StationDefaults.perHour(work);
    const ok = time >= hours * this.TOLERANCE;
    const text = ok
      ? `работа от бака ≈ ${fmt(Math.floor(time))} ч при нагрузке ${Math.round(StationDefaults.LOAD * this.PERCENT)} % (с запасом) — не меньше ${fmt(hours)}`
      : `работа от бака ≈ ${fmt(Math.floor(time))} ч — меньше ${fmt(hours)}: нужен бак около ${StationDefaults.tank(work, hours)} л`;
    return { ok, text };
  }

  static _top(part, field) {
    const top = StationEquip.top((part.attrs || {})[field]);
    return top ? top.v : 0;
  }

  static _pumps(ctx) {
    if (ctx.kind !== 'pump') return [];
    const { req, parts } = ctx;
    const out = [];
    const units = this._units(parts, 'pump');
    const flows = units.map(part => this._top(part, 'flow'));
    const need = StationReq.num(req.q);
    const head = StationReq.num(req.head);
    if (units.length && flows.some(value => !(value > 0))) {
      out.push({ ok: false, text: 'у насоса в карточке не указана подача — заполните карточку' });
    } else if (need > 0) out.push(this._enough(ctx, flows, need, 'подача', 'м³/ч'));
    if (head > 0) {
      const line = this._head(ctx, units, head);
      if (line) out.push(line);
    }
    return out;
  }

  static _head(ctx, units, head) {
    const working = [...units]
      .sort((first, second) => this._top(second, 'flow') - this._top(first, 'flow'))
      .slice(Math.min(ctx.res, Math.max(0, units.length - 1)));
    const heads = working.map(part => this._top(part, 'head'));
    if (heads.some(value => !(value > 0))) {
      return { ok: false, text: 'у насоса в карточке не указан напор — заполните карточку' };
    }
    if (!heads.length) return null;
    const low = Math.min(...heads);
    const ok = low >= head * this.TOLERANCE;
    return { ok, text: `напор ${this._fmt(low)} м — ${ok ? 'не меньше' : 'меньше'} ${this._fmt(head)}` };
  }
}
