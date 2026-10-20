import { Mm } from './mm.js';

/**
 * Расход воздуха и проёмы вентиляции (решение ПНЕВМОТЕХ, коэффициенты — правила vent.*, air.cp; «эксперт» — в требованиях
 * станции). Лето: тепло компрессора Q = N·k, воздух охлаждения L = Q·3600 / (c·ρ·Δt_к), помещение — перепадом Δt =
 * t_вн − t_нар, один поток, не меньше кратности; проёмы по рамке S = L / (3600·v). Зима: потери ограждений и минимального
 * воздухообмена против тепла компрессора. Рекуператор — по требованию заказчика.
 */
export class VentCalc {
  static _rule = id => StationRules.raw(id);

  static _round10 = v => Math.round(v / 10) * 10;

  static _round2 = v => Math.round(v * 100) / 100;

  static round1 = v => Math.round(v * 10) / 10;

  static _round3 = v => Math.round(v * 1000) / 1000;

  static CFM = 1.69901;
  static GRAVITY = 9.81;
  static TYPE = { screw: 'винтовой', piston: 'поршневой', centrifugal: 'центробежный', scroll: 'спиральный' };
  static TYPES = { plate: 'пластинчатый перекрёстный', rotary: 'роторный', glycol: 'с промежуточным теплоносителем' };

  /** Плотность воздуха при t, кг/м³: ρ ≈ 353 / (273 + t). */
  static rho(temp) {
    return VentCalc._rule('air.cp').rhoK / (273 + temp);
  }

  /** Расход, м³/ч, уносящий Q кВт при нагреве на dt °C. */
  static flow(heat, temp, deltaT) {
    return heat > 0 && deltaT > 0 ? (heat * 3600) / (VentCalc._rule('air.cp').c * VentCalc.rho(temp) * deltaT) : 0;
  }

  /** Тепло, кВт, которое уносит L м³/ч при Δt. */
  static heatOf(flow, temp, deltaT) {
    return (flow * VentCalc._rule('air.cp').c * VentCalc.rho(temp) * deltaT) / 3600;
  }

  static cfm(flow) {
    return Math.round(flow / VentCalc.CFM);
  }

  /** Число «эксперта» в пределах [lo, hi], иначе null и предупреждение. */
  static userValue(extra, key, [low, high], warn, what) {
    const v = extra && extra[key];
    if (v == null || v === '' || !Number.isFinite(+v)) return null;
    if (+v < low || +v > high) {
      warn.push({
        level: 'warn',
        text: `Режим «эксперт»: ${what} ${Mm.dec(v)} — вне допустимого (${Mm.dec(low)}…${Mm.dec(high)}), взято значение по умолчанию.`,
      });
      return null;
    }
    return +v;
  }

  static type(temp) {
    return /^(piston|centrifugal|scroll)$/.test(temp) ? temp : 'screw';
  }

  /** k (доля мощности в тепло): «эксперт» в диапазоне типа, иначе по умолчанию. */
  static heatK(type, extra, warn) {
    const rule = VentCalc._rule('vent.k_heat');
    const type2 = VentCalc.type(type);
    return (
      VentCalc.userValue(extra, 'k', rule.range[type2] || [0.5, 1], warn, `k для типа «${VentCalc.TYPE[type2]}»`) ??
      rule.def[type2]
    );
  }

  /**
   * Летний режим. inp: {units: [{key, pos, type, kw, heat?, cool?}], qRoom, qSun, use, V, tSum, boost, exfan, ex}.
   */
  static summer(inp, warn) {
    const extra = inp.ex || {};
    const temps = VentCalc.temps(inp, extra, warn);
    const cool = VentCalc.cooling(inp, extra, warn, temps);
    const flows = VentCalc.flows(inp, warn, temps, cool);
    const speeds = VentCalc.speeds(inp, extra, warn, cool.comp);
    return VentCalc.summary(inp, extra, warn, { ...temps, ...cool, ...flows, ...speeds });
  }

  /** Перепад помещения: меньше наименьшего — предупреждение и расчёт при нём. */
  static temps(inp, extra, warn) {
    const rule = VentCalc._rule('vent.temps');
    const tSum = inp.tSum;
    const tIn = VentCalc.userValue(extra, 'tIn', [20, 60], warn, 't_вн летом, °C') ?? rule.tIn;
    const dtSet = VentCalc.userValue(extra, 'dt', [1, 40], warn, 'Δt, °C');
    const dtRaw = dtSet ?? tIn - tSum;
    if (dtRaw < rule.dtMin) {
      warn.push({
        level: 'warn',
        text: `Недостаточный перепад температур летом: Δt = ${VentCalc.dec(dtRaw)} °C (t_вн ${VentCalc.dec(tIn)} − t_нар ${VentCalc.dec(tSum)}) меньше ${rule.dtMin} °C — расход посчитан при Δt = ${rule.dtMin} °C. Требуется принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха; уточните допустимую температуру в помещении по паспорту компрессора.`,
      });
    }
    return { tSum, tIn, dtRaw, dt: Math.max(rule.dtMin, dtRaw) };
  }

  /** Компрессоры: тепло — паспорт или N·k; воздух охлаждения — паспорт или его вентилятор при нагреве Δt_к. */
  static cooling(inp, extra, warn, { tSum }) {
    const dtc =
      VentCalc.userValue(extra, 'dtc', [5, 30], warn, 'нагрев воздуха в компрессоре, °C') ??
      VentCalc._rule('heat.cool_dt');
    const units = (inp.units || []).map(u => {
      const k = VentCalc.heatK(u.type, extra, warn);
      const heat = u.heat > 0 ? u.heat : (u.kw || 0) * k;
      const flow = u.cool > 0 ? u.cool : VentCalc._round10(VentCalc.flow(heat, tSum, dtc));
      return {
        key: u.key,
        pos: u.pos,
        type: VentCalc.type(u.type),
        kw: u.kw || 0,
        k: u.heat > 0 ? null : k,
        Q: VentCalc.round1(heat),
        cool: flow,
        src: u.cool > 0 ? 'паспорт' : 'расчёт',
        qsrc: u.heat > 0 ? 'паспорт' : 'N·k',
      };
    });
    return {
      dtc,
      units,
      Lcool: units.reduce((sum, u) => sum + u.cool, 0),
      Qc: units.reduce((sum, u) => sum + u.Q, 0),
      comp: units.length > 0,
    };
  }

  /** Один поток через помещение: больший из охлаждения и помещения; кратность; вентилятор стоянки; воздух у компрессора. */
  static flows(inp, warn, { tSum, tIn, dt: deltaT }, { Lcool, comp }) {
    const ach = VentCalc._rule('vent.ach');
    const fan = VentCalc._rule('vent.fan');
    const air = VentCalc._rule('air.cp');
    const Lroom = VentCalc._round10(VentCalc.flow(inp.qRoom || 0, tSum, deltaT));
    const use = Math.round(inp.use || 0);
    const vol = inp.V || 0;
    let Lrun = comp ? Math.max(Lcool, Lroom) : Lroom;
    const Lmin = VentCalc._round10(ach.min * vol);
    const raised = Lrun + use < Lmin;
    if (raised) {
      Lrun = Lmin - use;
      warn.push({
        level: 'info',
        text: `Расход увеличен до нормативного минимума по кратности: ${ach.min} объёма в час — ${Mm.text(Lmin)} м³/ч.`,
      });
    }
    const Lsun = VentCalc.flow(inp.qSun || 0, tSum, deltaT);
    const Lst = comp ? VentCalc._round10(Math.max(fan.stand, Math.max(Lsun, ach.min * vol) * fan.reserve)) : 0;
    const Lgen = comp ? Math.max(Lrun - Lcool, Lst) : Lrun;
    const tComp = VentCalc.round1(
      tSum + ((inp.qRoom || 0) * 3600) / (air.c * VentCalc.rho(tSum) * Math.max(1, Lrun + use)),
    );
    if (comp && tComp > tIn) {
      warn.push({
        level: 'warn',
        text: `Воздух у входа компрессора около ${VentCalc.dec(tComp)} °C — выше допустимых ${VentCalc.dec(tIn)} °C: увеличьте приток или проверьте паспорт компрессора.`,
      });
    }
    return {
      Lroom,
      use,
      V: vol,
      Lrun,
      Lmin,
      Lemerg: VentCalc._round10(ach.emerg * vol),
      raised,
      Lst,
      Lgen,
      Lin: Math.max(Lrun, Lst) + use,
      Lout: Lcool + Lgen,
      tComp,
    };
  }

  /** Скорости по рамке: обычные, с вентилятором в воздуховоде выброса или с вытяжными вентиляторами в стене. */
  static speeds(inp, extra, warn, comp) {
    const speed = VentCalc._rule('vent.speed');
    const exRule = StationRules.opt('vent.exfan');
    const exfan = !!inp.exfan && comp && !!exRule;
    const boost = !!inp.boost && comp && !exfan;
    if (inp.boost && exfan) {
      warn.push({
        level: 'info',
        text: 'Вентилятор в воздуховоде выброса не нужен: горячий воздух выводят вытяжные вентиляторы в стене — систему «Вентилятор в воздуховоде выброса» можно выключить.',
      });
    }
    const pick = k => {
      if (exfan) return exRule[k];
      return boost ? VentCalc._rule('vent.boost')[k] : speed[k === 'vIn' ? 'in' : 'out'];
    };
    const vIn = VentCalc.userValue(extra, 'vIn', [0.5, 8], warn, 'скорость притока, м/с') ?? pick('vIn');
    const vOut = VentCalc.userValue(extra, 'vOut', [0.5, 10], warn, 'скорость выброса, м/с') ?? pick('vOut');
    const res = VentCalc.userValue(extra, 'res', [1, 2], warn, 'запас притока') ?? speed.inReserve;
    VentCalc.speedNotes(warn, { vIn, vOut, own: !boost && !exfan });
    return { exfan, boost, vIn, vOut, res };
  }

  static speedNotes(warn, { vIn, vOut, own }) {
    const speed = VentCalc._rule('vent.speed');
    const dec = VentCalc.dec;
    if (vIn > speed.max) {
      warn.push({
        level: 'warn',
        text: `Скорость воздуха в притоке ${dec(vIn)} м/с больше ${speed.max} м/с (Atlas Copco) — высокие потери давления и шум; увеличьте проём.`,
      });
    } else if (vIn < speed.inRange[0] || vIn > speed.inRange[1]) {
      warn.push({
        level: 'info',
        text: `Скорость воздуха в притоке ${dec(vIn)} м/с — вне рекомендуемого диапазона ${dec(speed.inRange[0])}…${dec(speed.inRange[1])} м/с.`,
      });
    }
    if (!own) return;
    if (vOut > speed.max) {
      warn.push({
        level: 'warn',
        text: `Скорость воздуха в выбросе ${dec(vOut)} м/с больше ${speed.max} м/с — штатный вентилятор компрессора может не справиться; увеличьте проём или включите «Вентилятор в воздуховоде выброса».`,
      });
    } else if (vOut < speed.outRange[0] || vOut > speed.outRange[1]) {
      warn.push({
        level: 'info',
        text: `Скорость воздуха в выбросе ${dec(vOut)} м/с — вне рекомендуемого диапазона ${dec(speed.outRange[0])}…${dec(speed.outRange[1])} м/с.`,
      });
    }
  }

  static summary(inp, extra, warn, sum) {
    const speed = VentCalc._rule('vent.speed');
    const free = VentCalc._rule('vent.free');
    const user = sum.comp ? VentCalc.userValue(extra, 'fan', [1, 1e6], warn, 'вытяжной вентилятор, м³/ч') : null;
    if (user && user < sum.Lst) {
      warn.push({
        level: 'warn',
        text: `Вытяжной вентилятор ${Mm.text(user)} м³/ч меньше нужного при остановленных компрессорах ${Mm.text(sum.Lst)} м³/ч — замените вентилятор.`,
      });
    }
    return {
      tSum: sum.tSum,
      tIn: sum.tIn,
      dtRaw: VentCalc.round1(sum.dtRaw),
      dt: sum.dt,
      dtc: sum.dtc,
      rho: VentCalc._round3(VentCalc.rho(sum.tSum)),
      units: sum.units,
      Qc: VentCalc.round1(sum.Qc),
      qRoom: VentCalc.round1(inp.qRoom || 0),
      Lcool: sum.Lcool,
      Lroom: sum.Lroom,
      Lrun: sum.Lrun,
      Lgen: sum.Lgen,
      use: sum.use,
      Lin: sum.Lin,
      Lout: sum.Lout,
      V: VentCalc.round1(sum.V),
      Lmin: sum.Lmin,
      Lemerg: sum.Lemerg,
      raised: sum.raised,
      tComp: sum.tComp,
      cfmIn: VentCalc.cfm(sum.Lin),
      cfmOut: VentCalc.cfm(sum.Lout),
      vIn: sum.vIn,
      vOut: sum.vOut,
      res: sum.res,
      Sin: VentCalc._round2((sum.Lin / (3600 * sum.vIn)) * sum.res),
      Sout: VentCalc._round2(sum.Lout / (3600 * sum.vOut)),
      free,
      vLiveIn: VentCalc.round1(sum.vIn / sum.res / free),
      vLiveOut: VentCalc.round1(sum.vOut / free),
      ductDp: speed.ductDp,
      ...VentCalc.fans(sum, user),
    };
  }

  /** Вентилятор стоянки, канальный в воздуховоде выброса, вытяжные в стене (весь выброс с запасом). */
  static fans(sum, user) {
    const fan = VentCalc._rule('vent.fan');
    const boost = VentCalc._rule('vent.boost');
    const exfan = StationRules.opt('vent.exfan');
    const exFlow = sum.exfan ? VentCalc._round10(sum.Lout * exfan.reserve) : 0;
    return {
      stand: sum.comp
        ? {
            L: sum.Lst,
            dp: fan.dp,
            eta: fan.eta,
            P: VentCalc.fanPower(sum.Lst, fan.dp, fan.eta),
            user: user ? { q: user, ok: user >= sum.Lst } : null,
          }
        : null,
      boost: sum.boost
        ? { L: sum.Lcool, dp: boost.dp, eta: boost.eta, P: VentCalc.fanPower(sum.Lcool, boost.dp, boost.eta) }
        : null,
      exfan: sum.exfan
        ? {
            L: exFlow,
            dp: exfan.dp,
            eta: exfan.eta,
            P: VentCalc.fanPower(exFlow, exfan.dp, exfan.eta),
            reserve: exfan.reserve,
          }
        : null,
    };
  }

  /** Мощность вентилятора, кВт: P = L·ΔP / (3600·1000·η). */
  static fanPower(flow, press, eta) {
    return Math.round(((flow * press) / (3600 * 1000 * eta)) * 1000) / 1000;
  }

  /** Естественная тяга общей вытяжки: ΔP = (ρ_нар − ρ_вн)·g·h; меньше vent.fan.draft — вытяжной вентилятор. */
  static draft(summer, height, Lroom, extra, warn) {
    const fan = VentCalc._rule('vent.fan');
    const rhoOut = VentCalc.rho(summer.tSum);
    const rhoIn = VentCalc.rho(summer.tIn);
    const press = Math.round((rhoOut - rhoIn) * VentCalc.GRAVITY * Math.max(0, height) * 10) / 10;
    const need = Lroom > 0 && press < fan.draft;
    const fanFlow = VentCalc._round10(Lroom * fan.reserve);
    const power = VentCalc.fanPower(fanFlow, fan.dp, fan.eta);
    const user = VentCalc.userValue(extra, 'fan', [1, 1e6], warn, 'вытяжной вентилятор, м³/ч');
    const out = {
      h: VentCalc._round2(height),
      rhoOut: VentCalc._round3(rhoOut),
      rhoIn: VentCalc._round3(rhoIn),
      dp: press,
      need,
      L: Lroom,
      fan: need || user ? { L: fanFlow, dp: fan.dp, P: power, eta: fan.eta } : null,
      user: user ? { q: user, ok: user >= fanFlow - 1e-9 } : null,
    };
    if (need) {
      warn.push({
        level: 'info',
        text: `Естественная тяга общей вытяжки ${VentCalc.dec(press)} Па меньше ${fan.draft} Па — рекомендуется вытяжной вентилятор помещения: ${Mm.text(fanFlow)} м³/ч, напор не менее ${fan.dp} Па, около ${VentCalc.dec(power, 2)} кВт (при остановленном компрессоре его вентилятор помещение не продувает).`,
      });
    }
    if (out.user && !out.user.ok) {
      warn.push({
        level: 'warn',
        text: `Вытяжной вентилятор ${Mm.text(user)} м³/ч меньше нужного ${Mm.text(fanFlow)} м³/ч (расход общей вытяжки × ${Mm.dec(fan.reserve)}) — замените вентилятор.`,
      });
    }
    return out;
  }

  /** Зимний режим. inp: {tWin, tInMin, V, env: {U, A, qEnv}, Qrun, useRun, ex}; S — летний результат. */
  static winter(inp, summer, warn) {
    const extra = inp.ex || {};
    const { tWin, tInMin } = inp;
    const deltaT = tInMin - tWin;
    if (deltaT <= 0) {
      warn.push({
        level: 'info',
        text: `Зимняя расчётная ${VentCalc.dec(tWin)} °C не ниже допустимой внутри ${VentCalc.dec(tInMin)} °C — защита от переохлаждения не нужна.`,
      });
      return { tWin, tInMin, dt: 0, warm: true };
    }
    const userU = VentCalc.userValue(extra, 'U', [0.1, 6], warn, 'U, Вт/(м²·°C)');
    const uValue = userU ?? inp.env.U;
    const area = inp.env.A;
    const Qenv = (userU != null ? userU * area * deltaT : inp.env.qEnv) / 1000;
    const winterFlow = VentCalc._round10(Math.max(VentCalc._rule('vent.ach').winter * (inp.V || 0), inp.useRun || 0));
    const Qvent = VentCalc.heatOf(winterFlow, tWin, deltaT);
    const Qloss = Qenv + Qvent;
    const Qrun = inp.Qrun || 0;
    const bal = Qrun - Qloss;
    if (bal < 0) {
      warn.push({
        level: 'info',
        text: `Зимой при работе тепла не хватает: дефицит ${VentCalc.dec(-bal)} кВт — подогрев (конвекторы) и полная рециркуляция при минимальном притоке.`,
      });
    }
    return {
      tWin,
      tInMin,
      dt: deltaT,
      U: VentCalc._round3(uValue),
      A: VentCalc.round1(area),
      Qenv: VentCalc._round2(Qenv),
      Lw: winterFlow,
      Qvent: VentCalc._round2(Qvent),
      Qloss: VentCalc._round2(Qloss),
      Qrun: VentCalc._round2(Qrun),
      bal: VentCalc._round2(bal),
      ...VentCalc.louvers(winterFlow, summer),
      heat: bal < 0 ? VentCalc._round2(-bal) : 0,
      warm: false,
    };
  }

  /** Регулируемые жалюзи зимой: доля открытия = L_зима / L_лето, не меньше наименьшего открытия клапана. */
  static louvers(winterFlow, summer) {
    const ratio = summer && summer.Lin > 0 ? winterFlow / summer.Lin : 1;
    return {
      ratio: Math.round(ratio * 1000) / 10,
      open: Math.round(Math.max(ratio, VentCalc._rule('vent.winter').openMin) * 100),
      SinW: summer ? VentCalc._round2(summer.Sin * ratio) : null,
      SoutW: summer ? VentCalc._round2(summer.Sout * ratio) : null,
    };
  }

  /** Рекуператор: целесообразность, тип, КПД, приток после него, обмерзание, экономия за сезон. */
  static recup(wanted, winter, inp, warn) {
    if (!winter || winter.warm) return null;
    const extra = inp.ex || {};
    const recup = VentCalc._rule('vent.recup');
    const why = VentCalc.recupWhy(wanted, winter, recup);
    const type = /^(plate|rotary|glycol)$/.test(extra.hrvType || '') ? extra.hrvType : 'glycol';
    const eta = VentCalc.userValue(extra, 'eta', recup.range[type], warn, 'КПД рекуператора') ?? recup.eta[type];
    const tExh =
      VentCalc.userValue(extra, 'tExh', [winter.tInMin, 40], warn, 't выбросного воздуха зимой, °C') ?? winter.tInMin;
    const phi = VentCalc.userValue(extra, 'phi', [5, 100], warn, 'влажность выбросного воздуха, %') ?? recup.phi;
    const tAfter = VentCalc.round1(winter.tWin + eta * (tExh - winter.tWin));
    const frost = tAfter < recup.frost.t && phi > recup.frost.phi;
    const bypass = winter.tWin < recup.frost.bypass;
    const measures = VentCalc.measures(recup, { frost, bypass, type });
    const { days, tavg } = VentCalc.season(extra, warn);
    const saved = VentCalc.heatOf(winter.Lw, winter.tWin, eta * (tExh - winter.tWin));
    const Qavg = VentCalc.heatOf(winter.Lw, tavg, eta * Math.max(0, tExh - tavg));
    if (wanted && frost) {
      warn.push({
        level: 'warn',
        text: `Рекуператор: приток после него ${VentCalc.dec(tAfter)} °C при влажности выбросного воздуха ${phi} % — риск обмерзания; ${measures.join(', ')}.`,
      });
    }
    return {
      on: wanted,
      worth: why.length > 0,
      why,
      type,
      eta,
      tExh,
      phi,
      tAfter,
      frost,
      bypass,
      measures,
      Q: VentCalc._round2(saved),
      Qavg: VentCalc._round2(Qavg),
      year: Math.round(Qavg * days * 24),
      days,
      tavg,
    };
  }

  static measures(recup, { frost, bypass, type }) {
    const out = [];
    if (frost || bypass) out.push(`предподогрев приточного воздуха до +${recup.frost.preheat} °C`);
    if (bypass) out.push(`байпас рекуператора при наружной ниже ${recup.frost.bypass} °C`);
    if (frost && type === 'plate') out.push('периодическая разморозка');
    return out;
  }

  static season(extra, warn) {
    const season = VentCalc._rule('vent.season');
    const days = VentCalc.userValue(extra, 'days', [0, 365], warn, 'отопительный период, сут') ?? season.days;
    const tavg =
      VentCalc.userValue(extra, 'tavg', [-40, 8], warn, 'средняя температура отопительного периода, °C') ?? season.tavg;
    return { days, tavg };
  }

  static recupWhy(wanted, winter, recup) {
    const why = [];
    if (winter.Qloss > recup.worth * winter.Qrun)
      why.push(
        `потери зимой ${VentCalc.dec(winter.Qloss)} кВт больше ${Math.round(recup.worth * 100)} % тепла компрессора`,
      );
    if (winter.bal < 0) why.push('нужен подогрев приточного воздуха');
    if (wanted) why.push('требование заказчика');
    return why;
  }

  static dec(v, digits = 1) {
    const k = Math.pow(10, digits);
    return String(Math.round(v * k) / k)
      .replace('.', ',')
      .replace(/^-/, '−');
  }
}
