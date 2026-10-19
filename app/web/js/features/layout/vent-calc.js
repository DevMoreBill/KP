import { Mm } from './mm.js';

const dec = v => String(v).replace('.', ',');
const R = id => StationRules.raw(id);
const r10 = v => Math.round(v / 10) * 10;
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

/**
 * Расход воздуха и проёмы вентиляции (решение ПНЕВМОТЕХ, коэффициенты — правила vent.*, air.cp; «эксперт» — в требованиях
 * станции). Лето: тепло компрессора Q = N·k, воздух охлаждения L = Q·3600 / (c·ρ·Δt_к), помещение — перепадом Δt =
 * t_вн − t_нар, один поток, не меньше кратности; проёмы по рамке S = L / (3600·v). Зима: потери ограждений и минимального
 * воздухообмена против тепла компрессора. Рекуператор — по требованию заказчика.
 */
export class VentCalc {
  static CFM = 1.69901;
  static G = 9.81;
  static TYPE = { screw: 'винтовой', piston: 'поршневой', centrifugal: 'центробежный', scroll: 'спиральный' };
  static TYPES = { plate: 'пластинчатый перекрёстный', rotary: 'роторный', glycol: 'с промежуточным теплоносителем' };

  static R(id) {
    return R(id);
  }
  static r10(v) {
    return r10(v);
  }
  static r2(v) {
    return r2(v);
  }
  static r1(v) {
    return r1(v);
  }

  /** Плотность воздуха при t, кг/м³: ρ ≈ 353 / (273 + t). */
  static rho(t) {
    return R('air.cp').rhoK / (273 + t);
  }

  /** Расход, м³/ч, уносящий Q кВт при нагреве на dt °C. */
  static flow(Q, t, dt) {
    return Q > 0 && dt > 0 ? (Q * 3600) / (R('air.cp').c * VentCalc.rho(t) * dt) : 0;
  }

  /** Тепло, кВт, которое уносит L м³/ч при Δt. */
  static heatOf(L, t, dt) {
    return (L * R('air.cp').c * VentCalc.rho(t) * dt) / 3600;
  }

  static cfm(L) {
    return Math.round(L / VentCalc.CFM);
  }

  /** Число «эксперта» в пределах [lo, hi], иначе null и предупреждение. */
  static ex(ex, key, [lo, hi], W, what) {
    const v = ex && ex[key];
    if (v == null || v === '' || !Number.isFinite(+v)) return null;
    if (+v < lo || +v > hi) {
      W.push({
        level: 'warn',
        text: `Режим «эксперт»: ${what} ${dec(v)} — вне допустимого (${dec(lo)}…${dec(hi)}), взято значение по умолчанию.`,
      });
      return null;
    }
    return +v;
  }

  static type(t) {
    return /^(piston|centrifugal|scroll)$/.test(t) ? t : 'screw';
  }

  /** k (доля мощности в тепло): «эксперт» в диапазоне типа, иначе по умолчанию. */
  static k(type, ex, W) {
    const K = R('vent.k_heat');
    const t = VentCalc.type(type);
    return VentCalc.ex(ex, 'k', K.range[t] || [0.5, 1], W, `k для типа «${VentCalc.TYPE[t]}»`) ?? K.def[t];
  }

  /**
   * Летний режим. inp: {units: [{key, pos, type, kw, heat?, cool?}], qRoom, qSun, use, V, tSum, boost, exfan, ex}.
   */
  static summer(inp, W) {
    const ex = inp.ex || {};
    const t = VentCalc.temps(inp, ex, W);
    const cool = VentCalc.cooling(inp, ex, W, t);
    const flows = VentCalc.flows(inp, W, t, cool);
    const sp = VentCalc.speeds(inp, ex, W, cool.comp);
    return VentCalc.summary(inp, ex, W, { ...t, ...cool, ...flows, ...sp });
  }

  /** Перепад помещения: меньше наименьшего — предупреждение и расчёт при нём. */
  static temps(inp, ex, W) {
    const T = R('vent.temps');
    const tSum = inp.tSum;
    const tIn = VentCalc.ex(ex, 'tIn', [20, 60], W, 't_вн летом, °C') ?? T.tIn;
    const dtSet = VentCalc.ex(ex, 'dt', [1, 40], W, 'Δt, °C');
    const dtRaw = dtSet ?? tIn - tSum;
    if (dtRaw < T.dtMin) {
      W.push({
        level: 'warn',
        text: `Недостаточный перепад температур летом: Δt = ${VentCalc.f(dtRaw)} °C (t_вн ${VentCalc.f(tIn)} − t_нар ${VentCalc.f(tSum)}) меньше ${T.dtMin} °C — расход посчитан при Δt = ${T.dtMin} °C. Требуется принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха; уточните допустимую температуру в помещении по паспорту компрессора.`,
      });
    }
    return { tSum, tIn, dtRaw, dt: Math.max(T.dtMin, dtRaw) };
  }

  /** Компрессоры: тепло — паспорт или N·k; воздух охлаждения — паспорт или его вентилятор при нагреве Δt_к. */
  static cooling(inp, ex, W, { tSum }) {
    const dtc = VentCalc.ex(ex, 'dtc', [5, 30], W, 'нагрев воздуха в компрессоре, °C') ?? R('heat.cool_dt');
    const units = (inp.units || []).map(u => {
      const k = VentCalc.k(u.type, ex, W);
      const Q = u.heat > 0 ? u.heat : (u.kw || 0) * k;
      const L = u.cool > 0 ? u.cool : r10(VentCalc.flow(Q, tSum, dtc));
      return {
        key: u.key,
        pos: u.pos,
        type: VentCalc.type(u.type),
        kw: u.kw || 0,
        k: u.heat > 0 ? null : k,
        Q: r1(Q),
        cool: L,
        src: u.cool > 0 ? 'паспорт' : 'расчёт',
        qsrc: u.heat > 0 ? 'паспорт' : 'N·k',
      };
    });
    return {
      dtc,
      units,
      Lcool: units.reduce((s, u) => s + u.cool, 0),
      Qc: units.reduce((s, u) => s + u.Q, 0),
      comp: units.length > 0,
    };
  }

  /** Один поток через помещение: больший из охлаждения и помещения; кратность; вентилятор стоянки; воздух у компрессора. */
  static flows(inp, W, { tSum, tIn, dt }, { Lcool, comp }) {
    const A = R('vent.ach');
    const F = R('vent.fan');
    const ac = R('air.cp');
    const Lroom = r10(VentCalc.flow(inp.qRoom || 0, tSum, dt));
    const use = Math.round(inp.use || 0);
    const V = inp.V || 0;
    let Lrun = comp ? Math.max(Lcool, Lroom) : Lroom;
    const Lmin = r10(A.min * V);
    const raised = Lrun + use < Lmin;
    if (raised) {
      Lrun = Lmin - use;
      W.push({
        level: 'info',
        text: `Расход увеличен до нормативного минимума по кратности: ${A.min} объёма в час — ${VentCalc.n(Lmin)} м³/ч.`,
      });
    }
    const Lsun = VentCalc.flow(inp.qSun || 0, tSum, dt);
    const Lst = comp ? r10(Math.max(F.stand, Math.max(Lsun, A.min * V) * F.reserve)) : 0;
    const Lgen = comp ? Math.max(Lrun - Lcool, Lst) : Lrun;
    const tComp = r1(tSum + ((inp.qRoom || 0) * 3600) / (ac.c * VentCalc.rho(tSum) * Math.max(1, Lrun + use)));
    if (comp && tComp > tIn) {
      W.push({
        level: 'warn',
        text: `Воздух у входа компрессора около ${VentCalc.f(tComp)} °C — выше допустимых ${VentCalc.f(tIn)} °C: увеличьте приток или проверьте паспорт компрессора.`,
      });
    }
    return {
      Lroom,
      use,
      V,
      Lrun,
      Lmin,
      Lemerg: r10(A.emerg * V),
      raised,
      Lst,
      Lgen,
      Lin: Math.max(Lrun, Lst) + use,
      Lout: Lcool + Lgen,
      tComp,
    };
  }

  /** Скорости по рамке: обычные, с вентилятором в воздуховоде выброса или с вытяжными вентиляторами в стене. */
  static speeds(inp, ex, W, comp) {
    const Sp = R('vent.speed');
    const E = StationRules.opt('vent.exfan');
    const exfan = !!inp.exfan && comp && !!E;
    const boost = !!inp.boost && comp && !exfan;
    if (inp.boost && exfan) {
      W.push({
        level: 'info',
        text: 'Вентилятор в воздуховоде выброса не нужен: горячий воздух выводят вытяжные вентиляторы в стене — систему «Вентилятор в воздуховоде выброса» можно выключить.',
      });
    }
    const pick = k => {
      if (exfan) return E[k];
      return boost ? R('vent.boost')[k] : Sp[k === 'vIn' ? 'in' : 'out'];
    };
    const vIn = VentCalc.ex(ex, 'vIn', [0.5, 8], W, 'скорость притока, м/с') ?? pick('vIn');
    const vOut = VentCalc.ex(ex, 'vOut', [0.5, 10], W, 'скорость выброса, м/с') ?? pick('vOut');
    const res = VentCalc.ex(ex, 'res', [1, 2], W, 'запас притока') ?? Sp.inReserve;
    VentCalc.speedNotes(W, { vIn, vOut, own: !boost && !exfan });
    return { exfan, boost, vIn, vOut, res };
  }

  static speedNotes(W, { vIn, vOut, own }) {
    const Sp = R('vent.speed');
    const f = VentCalc.f;
    if (vIn > Sp.max) {
      W.push({
        level: 'warn',
        text: `Скорость воздуха в притоке ${f(vIn)} м/с больше ${Sp.max} м/с (Atlas Copco) — высокие потери давления и шум; увеличьте проём.`,
      });
    } else if (vIn < Sp.inRange[0] || vIn > Sp.inRange[1]) {
      W.push({
        level: 'info',
        text: `Скорость воздуха в притоке ${f(vIn)} м/с — вне рекомендуемого диапазона ${f(Sp.inRange[0])}…${f(Sp.inRange[1])} м/с.`,
      });
    }
    if (!own) return;
    if (vOut > Sp.max) {
      W.push({
        level: 'warn',
        text: `Скорость воздуха в выбросе ${f(vOut)} м/с больше ${Sp.max} м/с — штатный вентилятор компрессора может не справиться; увеличьте проём или включите «Вентилятор в воздуховоде выброса».`,
      });
    } else if (vOut < Sp.outRange[0] || vOut > Sp.outRange[1]) {
      W.push({
        level: 'info',
        text: `Скорость воздуха в выбросе ${f(vOut)} м/с — вне рекомендуемого диапазона ${f(Sp.outRange[0])}…${f(Sp.outRange[1])} м/с.`,
      });
    }
  }

  static summary(inp, ex, W, s) {
    const Sp = R('vent.speed');
    const free = R('vent.free');
    const user = s.comp ? VentCalc.ex(ex, 'fan', [1, 1e6], W, 'вытяжной вентилятор, м³/ч') : null;
    if (user && user < s.Lst) {
      W.push({
        level: 'warn',
        text: `Вытяжной вентилятор ${VentCalc.n(user)} м³/ч меньше нужного при остановленных компрессорах ${VentCalc.n(s.Lst)} м³/ч — замените вентилятор.`,
      });
    }
    return {
      tSum: s.tSum,
      tIn: s.tIn,
      dtRaw: r1(s.dtRaw),
      dt: s.dt,
      dtc: s.dtc,
      rho: r3(VentCalc.rho(s.tSum)),
      units: s.units,
      Qc: r1(s.Qc),
      qRoom: r1(inp.qRoom || 0),
      Lcool: s.Lcool,
      Lroom: s.Lroom,
      Lrun: s.Lrun,
      Lgen: s.Lgen,
      use: s.use,
      Lin: s.Lin,
      Lout: s.Lout,
      V: r1(s.V),
      Lmin: s.Lmin,
      Lemerg: s.Lemerg,
      raised: s.raised,
      tComp: s.tComp,
      cfmIn: VentCalc.cfm(s.Lin),
      cfmOut: VentCalc.cfm(s.Lout),
      vIn: s.vIn,
      vOut: s.vOut,
      res: s.res,
      Sin: r2((s.Lin / (3600 * s.vIn)) * s.res),
      Sout: r2(s.Lout / (3600 * s.vOut)),
      free,
      vLiveIn: r1(s.vIn / s.res / free),
      vLiveOut: r1(s.vOut / free),
      ductDp: Sp.ductDp,
      ...VentCalc.fans(s, user),
    };
  }

  /** Вентилятор стоянки, канальный в воздуховоде выброса, вытяжные в стене (весь выброс с запасом). */
  static fans(s, user) {
    const F = R('vent.fan');
    const B = R('vent.boost');
    const E = StationRules.opt('vent.exfan');
    const Lx = s.exfan ? r10(s.Lout * E.reserve) : 0;
    return {
      stand: s.comp
        ? {
            L: s.Lst,
            dp: F.dp,
            eta: F.eta,
            P: VentCalc.fanPower(s.Lst, F.dp, F.eta),
            user: user ? { q: user, ok: user >= s.Lst } : null,
          }
        : null,
      boost: s.boost ? { L: s.Lcool, dp: B.dp, eta: B.eta, P: VentCalc.fanPower(s.Lcool, B.dp, B.eta) } : null,
      exfan: s.exfan
        ? { L: Lx, dp: E.dp, eta: E.eta, P: VentCalc.fanPower(Lx, E.dp, E.eta), reserve: E.reserve }
        : null,
    };
  }

  /** Мощность вентилятора, кВт: P = L·ΔP / (3600·1000·η). */
  static fanPower(L, dp, eta) {
    return Math.round(((L * dp) / (3600 * 1000 * eta)) * 1000) / 1000;
  }

  /** Естественная тяга общей вытяжки: ΔP = (ρ_нар − ρ_вн)·g·h; меньше vent.fan.draft — вытяжной вентилятор. */
  static draft(S, h, Lroom, ex, W) {
    const F = R('vent.fan');
    const rO = VentCalc.rho(S.tSum);
    const rI = VentCalc.rho(S.tIn);
    const dp = Math.round((rO - rI) * VentCalc.G * Math.max(0, h) * 10) / 10;
    const need = Lroom > 0 && dp < F.draft;
    const Lf = r10(Lroom * F.reserve);
    const P = VentCalc.fanPower(Lf, F.dp, F.eta);
    const user = VentCalc.ex(ex, 'fan', [1, 1e6], W, 'вытяжной вентилятор, м³/ч');
    const out = {
      h: r2(h),
      rhoOut: r3(rO),
      rhoIn: r3(rI),
      dp,
      need,
      L: Lroom,
      fan: need || user ? { L: Lf, dp: F.dp, P, eta: F.eta } : null,
      user: user ? { q: user, ok: user >= Lf - 1e-9 } : null,
    };
    if (need) {
      W.push({
        level: 'info',
        text: `Естественная тяга общей вытяжки ${VentCalc.f(dp)} Па меньше ${F.draft} Па — рекомендуется вытяжной вентилятор помещения: ${VentCalc.n(Lf)} м³/ч, напор не менее ${F.dp} Па, около ${VentCalc.f(P, 2)} кВт (при остановленном компрессоре его вентилятор помещение не продувает).`,
      });
    }
    if (out.user && !out.user.ok) {
      W.push({
        level: 'warn',
        text: `Вытяжной вентилятор ${VentCalc.n(user)} м³/ч меньше нужного ${VentCalc.n(Lf)} м³/ч (расход общей вытяжки × ${dec(F.reserve)}) — замените вентилятор.`,
      });
    }
    return out;
  }

  /** Зимний режим. inp: {tWin, tInMin, V, env: {U, A, qEnv}, Qrun, useRun, ex}; S — летний результат. */
  static winter(inp, S, W) {
    const ex = inp.ex || {};
    const { tWin, tInMin } = inp;
    const dt = tInMin - tWin;
    if (dt <= 0) {
      W.push({
        level: 'info',
        text: `Зимняя расчётная ${VentCalc.f(tWin)} °C не ниже допустимой внутри ${VentCalc.f(tInMin)} °C — защита от переохлаждения не нужна.`,
      });
      return { tWin, tInMin, dt: 0, warm: true };
    }
    const Ux = VentCalc.ex(ex, 'U', [0.1, 6], W, 'U, Вт/(м²·°C)');
    const U = Ux ?? inp.env.U;
    const A0 = inp.env.A;
    const Qenv = (Ux != null ? Ux * A0 * dt : inp.env.qEnv) / 1000;
    const Lw = r10(Math.max(R('vent.ach').winter * (inp.V || 0), inp.useRun || 0));
    const Qvent = VentCalc.heatOf(Lw, tWin, dt);
    const Qloss = Qenv + Qvent;
    const Qrun = inp.Qrun || 0;
    const bal = Qrun - Qloss;
    if (bal < 0) {
      W.push({
        level: 'info',
        text: `Зимой при работе тепла не хватает: дефицит ${VentCalc.f(-bal)} кВт — подогрев (конвекторы) и полная рециркуляция при минимальном притоке.`,
      });
    }
    return {
      tWin,
      tInMin,
      dt,
      U: r3(U),
      A: r1(A0),
      Qenv: r2(Qenv),
      Lw,
      Qvent: r2(Qvent),
      Qloss: r2(Qloss),
      Qrun: r2(Qrun),
      bal: r2(bal),
      ...VentCalc.louvers(Lw, S),
      heat: bal < 0 ? r2(-bal) : 0,
      warm: false,
    };
  }

  /** Регулируемые жалюзи зимой: доля открытия = L_зима / L_лето, не меньше наименьшего открытия клапана. */
  static louvers(Lw, S) {
    const ratio = S && S.Lin > 0 ? Lw / S.Lin : 1;
    return {
      ratio: Math.round(ratio * 1000) / 10,
      open: Math.round(Math.max(ratio, R('vent.winter').openMin) * 100),
      SinW: S ? r2(S.Sin * ratio) : null,
      SoutW: S ? r2(S.Sout * ratio) : null,
    };
  }

  /** Рекуператор: целесообразность, тип, КПД, приток после него, обмерзание, экономия за сезон. */
  static recup(on, Wn, inp, W) {
    if (!Wn || Wn.warm) return null;
    const ex = inp.ex || {};
    const Rc = R('vent.recup');
    const why = VentCalc.recupWhy(on, Wn, Rc);
    const type = /^(plate|rotary|glycol)$/.test(ex.hrvType || '') ? ex.hrvType : 'glycol';
    const eta = VentCalc.ex(ex, 'eta', Rc.range[type], W, 'КПД рекуператора') ?? Rc.eta[type];
    const tExh = VentCalc.ex(ex, 'tExh', [Wn.tInMin, 40], W, 't выбросного воздуха зимой, °C') ?? Wn.tInMin;
    const phi = VentCalc.ex(ex, 'phi', [5, 100], W, 'влажность выбросного воздуха, %') ?? Rc.phi;
    const tAfter = r1(Wn.tWin + eta * (tExh - Wn.tWin));
    const frost = tAfter < Rc.frost.t && phi > Rc.frost.phi;
    const bypass = Wn.tWin < Rc.frost.bypass;
    const measures = VentCalc.measures(Rc, { frost, bypass, type });
    const { days, tavg } = VentCalc.season(ex, W);
    const Q = VentCalc.heatOf(Wn.Lw, Wn.tWin, eta * (tExh - Wn.tWin));
    const Qavg = VentCalc.heatOf(Wn.Lw, tavg, eta * Math.max(0, tExh - tavg));
    if (on && frost) {
      W.push({
        level: 'warn',
        text: `Рекуператор: приток после него ${VentCalc.f(tAfter)} °C при влажности выбросного воздуха ${phi} % — риск обмерзания; ${measures.join(', ')}.`,
      });
    }
    return {
      on,
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
      Q: r2(Q),
      Qavg: r2(Qavg),
      year: Math.round(Qavg * days * 24),
      days,
      tavg,
    };
  }

  static measures(Rc, { frost, bypass, type }) {
    const out = [];
    if (frost || bypass) out.push(`предподогрев приточного воздуха до +${Rc.frost.preheat} °C`);
    if (bypass) out.push(`байпас рекуператора при наружной ниже ${Rc.frost.bypass} °C`);
    if (frost && type === 'plate') out.push('периодическая разморозка');
    return out;
  }

  static season(ex, W) {
    const Se = R('vent.season');
    const days = VentCalc.ex(ex, 'days', [0, 365], W, 'отопительный период, сут') ?? Se.days;
    const tavg = VentCalc.ex(ex, 'tavg', [-40, 8], W, 'средняя температура отопительного периода, °C') ?? Se.tavg;
    return { days, tavg };
  }

  static recupWhy(on, Wn, Rc) {
    const why = [];
    if (Wn.Qloss > Rc.worth * Wn.Qrun)
      why.push(`потери зимой ${VentCalc.f(Wn.Qloss)} кВт больше ${Math.round(Rc.worth * 100)} % тепла компрессора`);
    if (Wn.bal < 0) why.push('нужен подогрев приточного воздуха');
    if (on) why.push('требование заказчика');
    return why;
  }

  static f(v, d = 1) {
    const k = Math.pow(10, d);
    return String(Math.round(v * k) / k)
      .replace('.', ',')
      .replace(/^-/, '−');
  }

  static n(v) {
    return Mm.text(Math.round(v));
  }
}
