import { Mm } from '../layout/mm.js';
import { StationVent } from '../layout/station-vent.js';
import { SummerTemp } from '../layout/summer-temp.js';
import { VentCalc } from '../layout/vent-calc.js';
import { CalcNote } from './calc-note.js';

/** Раздел записки «Вентиляция и отопление»: лето, вентиляторы, проёмы, тяга, зима, рекуператор, маркизы, радиатор ДГУ. */
export class VentSizing {
  static FAN = 'P = L · ΔP / (3600 · 1000 · η)';
  /** Вентиляция: лето, вентиляторы, проёмы, тяга, зима, рекуперация, радиаторы ДГУ. */
  static run(note, plan) {
    const vent = plan && plan.vent;
    const heatVent = plan && plan.heat && plan.heat.vent;
    if (!vent) return;
    const sum = heatVent && heatVent.sum;
    note.section('vent', 'Вентиляция и отопление');
    if (sum) VentSizing._summer(note, sum, vent, plan.req || {});
    if (vent.infan) VentSizing._infan(note, vent.infan);
    VentSizing.opening(note, vent, sum, 'Приточные жалюзи', 'in');
    VentSizing.opening(note, vent, sum, 'Выброс горячего воздуха', 'out');
    if (vent.draft) VentSizing._draft(note, vent.draft);
    VentSizing.cold(note, heatVent || {});
    VentSizing.hoods(note, vent);
    if (vent.rad) VentSizing._rad(note, vent.rad);
  }

  /** Зима и рекуператор (по требованию заказчика или если целесообразен). */
  static cold(note, { win, rec }) {
    if (win && !win.warm) VentSizing._winter(note, win);
    if (rec && (rec.on || rec.worth)) VentSizing._recup(note, rec);
  }

  static _summer(note, sum, vent, req) {
    if (!Number.isFinite(req.tmax)) note.rule(SummerTemp.RULE);
    note.rule('air.cp');
    note.rule('vent.temps');
    if (sum.units.length) VentSizing._compressors(note, sum);
    note.step({
      what: 'Вентиляция помещения',
      formula: 'L = Q_пом · 3600 / (c · ρ · Δt) + воздух на сжатие и горение',
      rules: ['heat.case', 'heat.sun'],
      data: [
        ['Q_пом (корпуса, осушители, солнце)', `${CalcNote.fmt(sum.qRoom, 1)} кВт`],
        ['на сжатие и горение', `${Mm.text(sum.use)} м³/ч`],
      ],
      result: `L = ${Mm.text(sum.Lroom)} м³/ч + ${Mm.text(sum.use)} м³/ч`,
    });
    note.step({
      what: 'Проверка по кратности воздухообмена',
      formula: 'L_мин = 3 · V, L_авар = 8 · V',
      rules: ['vent.ach'],
      data: [['V', `${CalcNote.fmt(sum.V, 1)} м³`]],
      result: `L_мин = ${Mm.text(sum.Lmin)} м³/ч, аварийная — ${Mm.text(sum.Lemerg)} м³/ч${sum.raised ? '; расход увеличен до нормативного минимума' : ''}`,
      ok: true,
    });
    VentSizing._flow(note, sum);
    VentSizing.fans(note, sum, vent);
  }

  static _compressors(note, sum) {
    note.step({
      what: 'Тепловыделение компрессоров (лето)',
      formula: 'Q = N · k; паспортное тепловыделение — важнее',
      rules: ['vent.k_heat'],
      data: sum.units.map(unit => [
        `поз. ${unit.pos} (${VentCalc.TYPE[unit.type]})`,
        unit.k != null ? `${CalcNote.fmt(unit.kw, 1)} кВт · ${CalcNote.fmt(unit.k, 2)}` : 'по паспорту',
      ]),
      result: `Q = ${CalcNote.fmt(sum.Qc, 1)} кВт`,
    });
    const low = sum.dtRaw < sum.dt;
    note.step({
      what: 'Перепад температур помещения летом',
      formula: 'Δt = t_вн − t_нар (для тепла помещения); меньше 5 °C — расчёт при 5 °C',
      rules: ['vent.temps'],
      data: [
        ['t_вн', `${CalcNote.fmt(sum.tIn, 1)} °C`],
        ['t_нар', `${CalcNote.fmt(sum.tSum, 1)} °C`],
      ],
      result: `Δt = ${CalcNote.fmt(sum.dt, 1)} °C${low ? ` (по температурам ${CalcNote.fmt(sum.dtRaw, 1)} °C — мало)` : ''}`,
      ok: low ? false : null,
      note: low
        ? 'Недостаточный перепад: нужна принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха.'
        : '',
    });
    note.step({
      what: 'Воздух охлаждения компрессоров',
      formula:
        'L = Q · 3600 / (c · ρ · Δt_к), ρ = 353 / (273 + t_нар); Δt_к — нагрев воздуха в компрессоре (его вентилятор, горячий воздух — воздуховодом наружу); паспортный расход — важнее',
      rules: ['air.cp', 'heat.cool_dt'],
      data: [
        ['c', `${CalcNote.fmt(note.rule('air.cp').c, 3)} кДж/(кг·°C)`],
        ['ρ', `${CalcNote.fmt(sum.rho, 3)} кг/м³`],
        ['Δt_к', `${CalcNote.fmt(sum.dtc, 1)} °C`],
        ...sum.units.map(unit => [`поз. ${unit.pos}`, `${Mm.text(unit.cool)} м³/ч (${unit.src})`]),
      ],
      result: `L = ${Mm.text(sum.Lcool)} м³/ч`,
    });
  }

  static _flow(note, sum) {
    const comp = sum.units.length > 0;
    note.step({
      what: 'Расход воздуха летом',
      formula: comp
        ? 'приток = max(охлаждение, помещение) + воздух на сжатие — компрессор протягивает воздух через помещение (один поток); t у входа компрессора = t_нар + Q_пом · 3600 / (c · ρ · L); выброс = воздуховоды компрессоров + общая вытяжка'
        : 'приток = помещение + воздух на сжатие и горение; выброс = помещение',
      data: [
        ['1 CFM', '1,699 м³/ч'],
        ...(comp
          ? [
              ['t у входа компрессора', `${CalcNote.fmt(sum.tComp, 1)} °C`],
              ['общая вытяжка', `${Mm.text(sum.Lgen)} м³/ч`],
            ]
          : []),
      ],
      result: `приток ${Mm.text(sum.Lin)} м³/ч (${Mm.text(sum.cfmIn)} CFM), выброс ${Mm.text(sum.Lout)} м³/ч (${Mm.text(sum.cfmOut)} CFM)`,
      ok: comp ? sum.tComp <= sum.tIn : null,
    });
  }

  /** Вентилятор стоянки, в воздуховоде выброса, вытяжные в стене. */
  static fans(note, sum, vent) {
    if (sum.stand && !sum.exfan) {
      const user = sum.stand.user;
      note.rule('vent.fan');
      note.step({
        what: 'Вытяжной вентилятор при остановленных компрессорах',
        formula: `L = max(солнце · 3600 / (c · ρ · Δt), 3 · V) · 1,15, не меньше 500 м³/ч; ${VentSizing.FAN}; с термостатом`,
        rules: ['vent.fan', 'heat.sun'],
        data: [
          ['ΔP', `${sum.stand.dp} Па`],
          ['η', CalcNote.fmt(sum.stand.eta, 2)],
        ],
        result: `${Mm.text(sum.stand.L)} м³/ч, около ${CalcNote.fmt(sum.stand.P, 2)} кВт${user ? `; заданный ${Mm.text(user.q)} м³/ч — ${user.ok ? 'достаточно' : 'мал'}` : ''}`,
        ok: user ? user.ok : null,
      });
    }
    if (sum.boost) {
      note.rule('vent.boost');
      note.step({
        what: 'Вентилятор в воздуховоде выброса',
        formula: `${VentSizing.FAN}; приток и выброс — с большей скоростью (компактные жалюзи)`,
        rules: ['vent.boost'],
        data: [
          ['L', `${Mm.text(sum.boost.L)} м³/ч`],
          ['ΔP', `${sum.boost.dp} Па`],
          ['η', CalcNote.fmt(sum.boost.eta, 2)],
        ],
        result: `около ${CalcNote.fmt(sum.boost.P, 2)} кВт; приток ${CalcNote.fmt(sum.vIn, 1)} м/с, выброс ${CalcNote.fmt(sum.vOut, 1)} м/с по рамке`,
      });
    }
    if (sum.exfan) VentSizing._exfan(note, sum, vent);
  }

  static _exfan(note, sum, vent) {
    const exfan = sum.exfan;
    const holes = vent.exfan ? ` — ${vent.exfan.n} ${vent.exfan.n === 1 ? 'проём' : 'проёма(ов)'}` : '';
    note.rule('vent.exfan');
    note.step({
      what: 'Вытяжные вентиляторы (стена напротив притока, по датчику температуры)',
      formula:
        'L_в = L_выброс · запас; P = L_в · ΔP / (3600 · 1000 · η); выброс — через проёмы вентиляторов, приток — до 4 м/с',
      rules: ['vent.exfan'],
      data: [
        ['L_выброс', `${Mm.text(sum.Lout)} м³/ч`],
        ['запас', CalcNote.fmt(exfan.reserve, 2)],
        ['ΔP', `${exfan.dp} Па`],
        ['η', CalcNote.fmt(exfan.eta, 2)],
      ],
      result: `${Mm.text(exfan.L)} м³/ч, около ${CalcNote.fmt(exfan.P, 2)} кВт${holes}; приток ${CalcNote.fmt(sum.vIn, 1)} м/с, выброс ${CalcNote.fmt(sum.vOut, 1)} м/с по рамке; при остановленных компрессорах — те же вентиляторы`,
    });
  }

  static _infan(note, infan) {
    note.rule('vent.exfan');
    note.step({
      what: 'Приточные вентиляторы (жалюзи притока целиком не встали)',
      formula: 'L_в = L_недостающий · запас; S = L_в / (3600 · v_вент) — по рамке; P = L_в · ΔP / (3600 · 1000 · η)',
      rules: ['vent.exfan'],
      data: [
        ['L_недостающий', `${Mm.text(infan.q)} м³/ч`],
        ['v_вент', `${CalcNote.fmt(infan.v, 1)} м/с`],
        ['ΔP', `${infan.dp} Па`],
      ],
      result: `${Mm.text(infan.L)} м³/ч в ${infan.n} ${infan.n === 1 ? 'проёме' : 'проёмах'}, около ${CalcNote.fmt(infan.P, 2)} кВт; включаются по датчику температуры`,
    });
  }

  /** Проёмы по рамке S = L / (3600 · v), приток — с запасом; поставлено на стенах и крыше — против нужного. */
  static opening(note, vent, sum, what, kind) {
    const need = vent.need[kind];
    if (!need) return;
    const roof = kind === 'out' ? vent.roof || [] : [];
    const placed =
      vent.louvers
        .filter(louver => louver.kind === kind)
        .reduce((area, louver) => area + (louver.w * louver.h) / 1e6, 0) +
      roof.reduce((area, louver) => area + (louver.w * louver.l) / 1e6, 0);
    const ok = !(vent.short[kind] > 0);
    const where = StationVent.where(vent)[kind];
    const list = VentSizing._placedText(vent, kind, roof);
    note.step({
      what,
      formula: kind === 'in' ? 'S = L / (3600 · v) · запас — по рамке' : 'S = L / (3600 · v) — по рамке',
      rules: ['vent.speed', 'vent.free'],
      data: [
        ['L', `${Mm.text(vent.q[kind])} м³/ч`],
        ['v', `${CalcNote.fmt(need.v, 1)} м/с`],
        ...(kind === 'in' ? [['запас', CalcNote.fmt(vent.res, 2)]] : []),
      ],
      result: `S ≥ ${CalcNote.fmt(need.gross)} м²; ${list || 'жалюзи —'}${where ? ` (${where})` : ''}`,
      ok,
      margin: CalcNote.pct(placed, need.gross),
      note: VentSizing.liveNote(vent, sum, kind),
    });
    if (!ok)
      note.issue(
        'warn',
        `${what}: на стенах не поместилось ${CalcNote.fmt(vent.short[kind])} м² жалюзи (по рамке) — освободите стену или выведите воздух воздуховодом через крышу.`,
      );
  }

  static _placedText(vent, kind, roof) {
    const walls = vent.louvers.some(louver => louver.kind === kind) ? `жалюзи ${StationVent.list(vent, kind)}` : '';
    return [walls, roof.length ? `через крышу ${StationVent.roofList(vent)}` : ''].filter(Boolean).join(', ');
  }

  /** Скорость в живом сечении решётки; выброс через штатный вентилятор компрессора — малое сопротивление. */
  static liveNote(vent, sum, kind) {
    const speed = kind === 'in' ? vent.vIn / vent.res / vent.free : vent.vOut / vent.free;
    const duct = kind === 'out' && sum && sum.units.length && !sum.boost && !sum.exfan;
    const tail = duct
      ? ` Воздуховод с жалюзи — не более ${sum.ductDp} Па (штатный вентилятор компрессора): жалюзи с малым сопротивлением, подтвердить по паспорту.`
      : '';
    return `В живом сечении решётки (${Math.round(vent.free * 100)} % рамки) — около ${CalcNote.fmt(speed, 1)} м/с.${tail}`;
  }

  static _draft(note, draft) {
    note.rule('vent.fan');
    note.step({
      what: 'Естественная тяга общей вытяжки',
      formula: 'ΔP = (ρ_нар − ρ_вн) · g · h, ρ = 353 / (273 + t)',
      rules: ['vent.fan'],
      data: [
        ['ρ_нар', `${CalcNote.fmt(draft.rhoOut, 3)} кг/м³`],
        ['ρ_вн', `${CalcNote.fmt(draft.rhoIn, 3)} кг/м³`],
        ['h', `${CalcNote.fmt(draft.h, 2)} м`],
      ],
      result: `ΔP = ${CalcNote.fmt(draft.dp, 1)} Па${draft.need ? ' — меньше 5 Па' : ''}`,
      ok: draft.need ? null : true,
    });
    if (!draft.fan) return;
    const user = draft.user;
    note.step({
      what: 'Вытяжной вентилятор помещения',
      formula: 'L_в = L · 1,15; P = L_в · ΔP / (3600 · 1000 · η)',
      rules: ['vent.fan'],
      data: [
        ['L', `${Mm.text(draft.L)} м³/ч`],
        ['ΔP', `${draft.fan.dp} Па`],
        ['η', CalcNote.fmt(draft.fan.eta, 2)],
      ],
      result: `${Mm.text(draft.fan.L)} м³/ч, напор ≥ ${draft.fan.dp} Па, около ${CalcNote.fmt(draft.fan.P, 2)} кВт${user ? `; заданный ${Mm.text(user.q)} м³/ч — ${user.ok ? 'достаточно' : 'мало, заменить'}` : ''}`,
      ok: user ? user.ok : null,
    });
  }

  static _winter(note, winter) {
    note.rule('vent.winter');
    note.step({
      what: 'Зимой: потери через ограждения',
      formula: 'Q = U · A · Δt, Δt = t_вн_мин − t_нар_зима; U — по утеплителю',
      rules: ['heat.lambda', 'heat.rsurf', 'heat.bridge'],
      data: [
        ['U', `${CalcNote.fmt(winter.U, 3)} Вт/(м²·°C)`],
        ['A', `${CalcNote.fmt(winter.A, 1)} м²`],
        ['Δt', `${CalcNote.fmt(winter.dt, 1)} °C`],
      ],
      result: `Q_огр = ${CalcNote.fmt(winter.Qenv, 2)} кВт`,
    });
    note.step({
      what: 'Зимой: минимальный воздухообмен',
      formula: 'L = max(2 · V, воздух на сжатие); Q = L · c · ρ · Δt / 3600',
      rules: ['vent.ach'],
      data: [['L', `${Mm.text(winter.Lw)} м³/ч`]],
      result: `Q_вент = ${CalcNote.fmt(winter.Qvent, 2)} кВт`,
    });
    note.step({
      what: 'Тепловой баланс зимой при работе',
      formula: 'Q_баланс = Q_тепл − Q_огр − Q_вент (один работающий агрегат, рециркуляция)',
      rules: ['heat.rec'],
      data: [
        ['Q_тепл', `${CalcNote.fmt(winter.Qrun, 2)} кВт`],
        ['Q_потерь', `${CalcNote.fmt(winter.Qloss, 2)} кВт`],
      ],
      result:
        winter.bal >= 0
          ? `профицит ${CalcNote.fmt(winter.bal, 2)} кВт — частичная рециркуляция`
          : `дефицит ${CalcNote.fmt(-winter.bal, 2)} кВт — подогрев`,
      ok: winter.bal >= 0 ? true : null,
    });
    note.step({
      what: 'Зимой: открытие регулируемых жалюзи',
      formula: 'доля = L_зима / L_лето (не меньше наименьшего открытия клапана); S_зима = S · L_зима / L_лето',
      rules: ['vent.winter'],
      data: [['L_зима / L_лето', `${CalcNote.fmt(winter.ratio, 1)} %`]],
      result: `открытие ${winter.open} %; приток ${CalcNote.fmt(winter.SinW)} м², выброс ${CalcNote.fmt(winter.SoutW)} м²`,
    });
  }

  static _recup(calcNote, recup) {
    calcNote.rule('vent.recup');
    calcNote.rule('vent.season');
    const note = [
      recup.why.length ? `Целесообразность: ${recup.why.join('; ')}.` : '',
      recup.frost ? 'Риск обмерзания.' : '',
      recup.measures.length ? `Защита: ${recup.measures.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    calcNote.step({
      what: `Рекуператор${recup.on ? '' : ' (оценка — опция не включена)'}`,
      formula: 't_после = t_нар + η · (t_выб − t_нар); Q = L · ρ · c · η · (t_выб − t_нар) / 3600',
      rules: ['vent.recup'],
      data: [
        ['тип', VentCalc.TYPES[recup.type]],
        ['η', CalcNote.fmt(recup.eta, 2)],
        ['t_выб', `${CalcNote.fmt(recup.tExh, 1)} °C`],
        ['φ_выб', `${recup.phi} %`],
      ],
      result: `t_после = ${CalcNote.fmt(recup.tAfter, 1)} °C; Q = ${CalcNote.fmt(recup.Q, 2)} кВт; за год ≈ ${Mm.text(recup.year)} кВт·ч (${recup.days} сут, средняя ${CalcNote.fmt(recup.tavg, 1)} °C)`,
      ok: recup.frost ? false : null,
      note,
    });
  }

  /** Маркизы: угол открытия — по скорости во входе (приток) или выходе (выброс) под козырьком самой нагруженной. */
  static hoods(note, vent) {
    const vIn = note.rule('vent.hood_v');
    const list = [
      ['in', vent.hood, 'Маркиза на приточных жалюзи (снегозащита)', 'vent.hood_v', vIn],
      ['out', vent.hoodOut, 'Маркиза на жалюзи выброса (по требованию)', 'vent.speed', vent.face],
    ];
    for (const [kind, hood, what, rule, vmax] of list.filter(louver => louver[1])) {
      const louvers = vent.louvers.filter(louver => louver.kind === kind && louver.hood);
      const top = louvers.reduce((best, louver) => (louver.hood.v > best.hood.v ? louver : best), louvers[0]);
      const flowIn = Math.round((((top.hood.v * 3600 * top.hood.w) / 1000) * top.hood.d) / 1000);
      note.step({
        what,
        formula:
          'вход (выход) под козырьком B × d, d = L · sin α — вылет; α — наименьший угол открытия 30…75° (шаг 5°), при котором Q / (3600 · B · d) ≤ v; у всех маркиз один — по самой нагруженной; L — высота жалюзи + 100 мм',
        rules: [rule],
        data: [
          ['Q', `${Mm.text(flowIn)} м³/ч (жалюзи ${Mm.text(top.w)} × ${Mm.text(top.h)} мм)`],
          ['B × L', `${Mm.text(top.hood.w)} × ${Mm.text(top.hood.l)} мм`],
          ['v', `${CalcNote.fmt(vmax, 1)} м/с`],
        ],
        result: StationVent.hoodText(vent, kind),
        ok: !hood.over,
      });
    }
  }

  static _rad(note, rad) {
    const lim = StationVent.RAD_V;
    note.step({
      what:
        rad.n > 1
          ? `Выброс воздуха радиатора ДГУ (у каждой своя ${rad.door ? 'дверь-жалюзи' : 'решётка'}; самая нагруженная из ${rad.n})`
          : 'Выброс воздуха радиатора ДГУ',
      formula: 'v = Q / (3600 · A)',
      rules: ['vent.free'],
      data: [
        ['Q', `${Mm.text(rad.n > 1 ? rad.qOne : rad.q)} м³/ч`],
        [rad.door ? 'дверь-жалюзи' : 'жалюзи', `${Mm.text(rad.w)} × ${Mm.text(rad.h)} мм`],
        ['A', `${CalcNote.fmt(rad.free)} м²`],
      ],
      result: `v = ${CalcNote.fmt(rad.v, 1)} м/с`,
      ok: rad.v <= lim,
      note:
        rad.v > lim
          ? `Больше ${CalcNote.fmt(lim, 1)} м/с — проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление).`
          : '',
    });
  }
}
