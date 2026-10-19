import { Mm } from '../layout/mm.js';
import { StationVent } from '../layout/station-vent.js';
import { VentCalc } from '../layout/vent-calc.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const n = v => Mm.text(v);
const FAN = 'P = L · ΔP / (3600 · 1000 · η)';

/** Раздел записки «Вентиляция и отопление»: лето, вентиляторы, проёмы, тяга, зима, рекуператор, маркизы, радиатор ДГУ. */
export class VentSizing {
  static run(N, plan) {
    const V = plan && plan.vent;
    const H = plan && plan.heat && plan.heat.vent;
    if (!V) return;
    const S = H && H.sum;
    N.section('vent', 'Вентиляция и отопление');
    if (S) VentSizing.summer(N, S, V);
    if (V.infan) VentSizing.infan(N, V.infan);
    VentSizing.opening(N, V, S, 'Приточные жалюзи', 'in');
    VentSizing.opening(N, V, S, 'Выброс горячего воздуха', 'out');
    if (V.draft) VentSizing.draft(N, V.draft);
    VentSizing.cold(N, H || {});
    VentSizing.hoods(N, V);
    if (V.rad) VentSizing.rad(N, V.rad);
  }

  /** Зима и рекуператор (по требованию заказчика или если целесообразен). */
  static cold(N, { win, rec }) {
    if (win && !win.warm) VentSizing.winter(N, win);
    if (rec && (rec.on || rec.worth)) VentSizing.recup(N, rec);
  }

  static summer(N, S, V) {
    N.rule('air.cp');
    N.rule('vent.temps');
    if (S.units.length) VentSizing.compressors(N, S);
    N.step({
      what: 'Вентиляция помещения',
      formula: 'L = Q_пом · 3600 / (c · ρ · Δt) + воздух на сжатие и горение',
      rules: ['heat.case', 'heat.sun'],
      data: [
        ['Q_пом (корпуса, осушители, солнце)', `${f(S.qRoom, 1)} кВт`],
        ['на сжатие и горение', `${n(S.use)} м³/ч`],
      ],
      result: `L = ${n(S.Lroom)} м³/ч + ${n(S.use)} м³/ч`,
    });
    N.step({
      what: 'Проверка по кратности воздухообмена',
      formula: 'L_мин = 3 · V, L_авар = 8 · V',
      rules: ['vent.ach'],
      data: [['V', `${f(S.V, 1)} м³`]],
      result: `L_мин = ${n(S.Lmin)} м³/ч, аварийная — ${n(S.Lemerg)} м³/ч${S.raised ? '; расход увеличен до нормативного минимума' : ''}`,
      ok: true,
    });
    VentSizing.flow(N, S);
    VentSizing.fans(N, S, V);
  }

  static compressors(N, S) {
    N.step({
      what: 'Тепловыделение компрессоров (лето)',
      formula: 'Q = N · k; паспортное тепловыделение — важнее',
      rules: ['vent.k_heat'],
      data: S.units.map(u => [
        `поз. ${u.pos} (${VentCalc.TYPE[u.type]})`,
        u.k != null ? `${f(u.kw, 1)} кВт · ${f(u.k, 2)}` : 'по паспорту',
      ]),
      result: `Q = ${f(S.Qc, 1)} кВт`,
    });
    const low = S.dtRaw < S.dt;
    N.step({
      what: 'Перепад температур помещения летом',
      formula: 'Δt = t_вн − t_нар (для тепла помещения); меньше 5 °C — расчёт при 5 °C',
      rules: ['vent.temps'],
      data: [
        ['t_вн', `${f(S.tIn, 1)} °C`],
        ['t_нар', `${f(S.tSum, 1)} °C`],
      ],
      result: `Δt = ${f(S.dt, 1)} °C${low ? ` (по температурам ${f(S.dtRaw, 1)} °C — мало)` : ''}`,
      ok: low ? false : null,
      note: low
        ? 'Недостаточный перепад: нужна принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха.'
        : '',
    });
    N.step({
      what: 'Воздух охлаждения компрессоров',
      formula:
        'L = Q · 3600 / (c · ρ · Δt_к), ρ = 353 / (273 + t_нар); Δt_к — нагрев воздуха в компрессоре (его вентилятор, горячий воздух — воздуховодом наружу); паспортный расход — важнее',
      rules: ['air.cp', 'heat.cool_dt'],
      data: [
        ['c', `${f(N.rule('air.cp').c, 3)} кДж/(кг·°C)`],
        ['ρ', `${f(S.rho, 3)} кг/м³`],
        ['Δt_к', `${f(S.dtc, 1)} °C`],
        ...S.units.map(u => [`поз. ${u.pos}`, `${n(u.cool)} м³/ч (${u.src})`]),
      ],
      result: `L = ${n(S.Lcool)} м³/ч`,
    });
  }

  static flow(N, S) {
    const comp = S.units.length > 0;
    N.step({
      what: 'Расход воздуха летом',
      formula: comp
        ? 'приток = max(охлаждение, помещение) + воздух на сжатие — компрессор протягивает воздух через помещение (один поток); t у входа компрессора = t_нар + Q_пом · 3600 / (c · ρ · L); выброс = воздуховоды компрессоров + общая вытяжка'
        : 'приток = помещение + воздух на сжатие и горение; выброс = помещение',
      data: [
        ['1 CFM', '1,699 м³/ч'],
        ...(comp
          ? [
              ['t у входа компрессора', `${f(S.tComp, 1)} °C`],
              ['общая вытяжка', `${n(S.Lgen)} м³/ч`],
            ]
          : []),
      ],
      result: `приток ${n(S.Lin)} м³/ч (${n(S.cfmIn)} CFM), выброс ${n(S.Lout)} м³/ч (${n(S.cfmOut)} CFM)`,
      ok: comp ? S.tComp <= S.tIn : null,
    });
  }

  /** Вентилятор стоянки, в воздуховоде выброса, вытяжные в стене. */
  static fans(N, S, V) {
    if (S.stand && !S.exfan) {
      const u = S.stand.user;
      N.rule('vent.fan');
      N.step({
        what: 'Вытяжной вентилятор при остановленных компрессорах',
        formula: `L = max(солнце · 3600 / (c · ρ · Δt), 3 · V) · 1,15, не меньше 500 м³/ч; ${FAN}; с термостатом`,
        rules: ['vent.fan', 'heat.sun'],
        data: [
          ['ΔP', `${S.stand.dp} Па`],
          ['η', f(S.stand.eta, 2)],
        ],
        result: `${n(S.stand.L)} м³/ч, около ${f(S.stand.P, 2)} кВт${u ? `; заданный ${n(u.q)} м³/ч — ${u.ok ? 'достаточно' : 'мал'}` : ''}`,
        ok: u ? u.ok : null,
      });
    }
    if (S.boost) {
      N.rule('vent.boost');
      N.step({
        what: 'Вентилятор в воздуховоде выброса',
        formula: `${FAN}; приток и выброс — с большей скоростью (компактные жалюзи)`,
        rules: ['vent.boost'],
        data: [
          ['L', `${n(S.boost.L)} м³/ч`],
          ['ΔP', `${S.boost.dp} Па`],
          ['η', f(S.boost.eta, 2)],
        ],
        result: `около ${f(S.boost.P, 2)} кВт; приток ${f(S.vIn, 1)} м/с, выброс ${f(S.vOut, 1)} м/с по рамке`,
      });
    }
    if (S.exfan) VentSizing.exfan(N, S, V);
  }

  static exfan(N, S, V) {
    const E = S.exfan;
    const holes = V.exfan ? ` — ${V.exfan.n} ${V.exfan.n === 1 ? 'проём' : 'проёма(ов)'}` : '';
    N.rule('vent.exfan');
    N.step({
      what: 'Вытяжные вентиляторы (стена напротив притока, по датчику температуры)',
      formula:
        'L_в = L_выброс · запас; P = L_в · ΔP / (3600 · 1000 · η); выброс — через проёмы вентиляторов, приток — до 4 м/с',
      rules: ['vent.exfan'],
      data: [
        ['L_выброс', `${n(S.Lout)} м³/ч`],
        ['запас', f(E.reserve, 2)],
        ['ΔP', `${E.dp} Па`],
        ['η', f(E.eta, 2)],
      ],
      result: `${n(E.L)} м³/ч, около ${f(E.P, 2)} кВт${holes}; приток ${f(S.vIn, 1)} м/с, выброс ${f(S.vOut, 1)} м/с по рамке; при остановленных компрессорах — те же вентиляторы`,
    });
  }

  static infan(N, I) {
    N.rule('vent.exfan');
    N.step({
      what: 'Приточные вентиляторы (жалюзи притока целиком не встали)',
      formula: 'L_в = L_недостающий · запас; S = L_в / (3600 · v_вент) — по рамке; P = L_в · ΔP / (3600 · 1000 · η)',
      rules: ['vent.exfan'],
      data: [
        ['L_недостающий', `${n(I.q)} м³/ч`],
        ['v_вент', `${f(I.v, 1)} м/с`],
        ['ΔP', `${I.dp} Па`],
      ],
      result: `${n(I.L)} м³/ч в ${I.n} ${I.n === 1 ? 'проёме' : 'проёмах'}, около ${f(I.P, 2)} кВт; включаются по датчику температуры`,
    });
  }

  /** Проёмы по рамке S = L / (3600 · v), приток — с запасом; поставлено на стенах и крыше — против нужного. */
  static opening(N, V, S, what, kind) {
    const nd = V.need[kind];
    if (!nd) return;
    const roof = kind === 'out' ? V.roof || [] : [];
    const placed =
      V.louvers.filter(q => q.kind === kind).reduce((s, q) => s + (q.w * q.h) / 1e6, 0) +
      roof.reduce((s, q) => s + (q.w * q.l) / 1e6, 0);
    const ok = !(V.short[kind] > 0);
    const wh = StationVent.where(V)[kind];
    const list = VentSizing.placedText(V, kind, roof);
    N.step({
      what,
      formula: kind === 'in' ? 'S = L / (3600 · v) · запас — по рамке' : 'S = L / (3600 · v) — по рамке',
      rules: ['vent.speed', 'vent.free'],
      data: [
        ['L', `${n(V.q[kind])} м³/ч`],
        ['v', `${f(nd.v, 1)} м/с`],
        ...(kind === 'in' ? [['запас', f(V.res, 2)]] : []),
      ],
      result: `S ≥ ${f(nd.gross)} м²; ${list || 'жалюзи —'}${wh ? ` (${wh})` : ''}`,
      ok,
      margin: CalcNote.pct(placed, nd.gross),
      note: VentSizing.liveNote(V, S, kind),
    });
    if (!ok)
      N.issue(
        'warn',
        `${what}: на стенах не поместилось ${f(V.short[kind])} м² жалюзи (по рамке) — освободите стену или выведите воздух воздуховодом через крышу.`,
      );
  }

  static placedText(V, kind, roof) {
    const walls = V.louvers.some(q => q.kind === kind) ? `жалюзи ${StationVent.list(V, kind)}` : '';
    return [walls, roof.length ? `через крышу ${StationVent.roofList(V)}` : ''].filter(Boolean).join(', ');
  }

  /** Скорость в живом сечении решётки; выброс через штатный вентилятор компрессора — малое сопротивление. */
  static liveNote(V, S, kind) {
    const vl = kind === 'in' ? V.vIn / V.res / V.free : V.vOut / V.free;
    const duct = kind === 'out' && S && S.units.length && !S.boost && !S.exfan;
    const tail = duct
      ? ` Воздуховод с жалюзи — не более ${S.ductDp} Па (штатный вентилятор компрессора): жалюзи с малым сопротивлением, подтвердить по паспорту.`
      : '';
    return `В живом сечении решётки (${Math.round(V.free * 100)} % рамки) — около ${f(vl, 1)} м/с.${tail}`;
  }

  static draft(N, D) {
    N.rule('vent.fan');
    N.step({
      what: 'Естественная тяга общей вытяжки',
      formula: 'ΔP = (ρ_нар − ρ_вн) · g · h, ρ = 353 / (273 + t)',
      rules: ['vent.fan'],
      data: [
        ['ρ_нар', `${f(D.rhoOut, 3)} кг/м³`],
        ['ρ_вн', `${f(D.rhoIn, 3)} кг/м³`],
        ['h', `${f(D.h, 2)} м`],
      ],
      result: `ΔP = ${f(D.dp, 1)} Па${D.need ? ' — меньше 5 Па' : ''}`,
      ok: D.need ? null : true,
    });
    if (!D.fan) return;
    const u = D.user;
    N.step({
      what: 'Вытяжной вентилятор помещения',
      formula: 'L_в = L · 1,15; P = L_в · ΔP / (3600 · 1000 · η)',
      rules: ['vent.fan'],
      data: [
        ['L', `${n(D.L)} м³/ч`],
        ['ΔP', `${D.fan.dp} Па`],
        ['η', f(D.fan.eta, 2)],
      ],
      result: `${n(D.fan.L)} м³/ч, напор ≥ ${D.fan.dp} Па, около ${f(D.fan.P, 2)} кВт${u ? `; заданный ${n(u.q)} м³/ч — ${u.ok ? 'достаточно' : 'мало, заменить'}` : ''}`,
      ok: u ? u.ok : null,
    });
  }

  static winter(N, Wn) {
    N.rule('vent.winter');
    N.step({
      what: 'Зимой: потери через ограждения',
      formula: 'Q = U · A · Δt, Δt = t_вн_мин − t_нар_зима; U — по утеплителю',
      rules: ['heat.lambda', 'heat.rsurf', 'heat.bridge'],
      data: [
        ['U', `${f(Wn.U, 3)} Вт/(м²·°C)`],
        ['A', `${f(Wn.A, 1)} м²`],
        ['Δt', `${f(Wn.dt, 1)} °C`],
      ],
      result: `Q_огр = ${f(Wn.Qenv, 2)} кВт`,
    });
    N.step({
      what: 'Зимой: минимальный воздухообмен',
      formula: 'L = max(2 · V, воздух на сжатие); Q = L · c · ρ · Δt / 3600',
      rules: ['vent.ach'],
      data: [['L', `${n(Wn.Lw)} м³/ч`]],
      result: `Q_вент = ${f(Wn.Qvent, 2)} кВт`,
    });
    N.step({
      what: 'Тепловой баланс зимой при работе',
      formula: 'Q_баланс = Q_тепл − Q_огр − Q_вент (один работающий агрегат, рециркуляция)',
      rules: ['heat.rec'],
      data: [
        ['Q_тепл', `${f(Wn.Qrun, 2)} кВт`],
        ['Q_потерь', `${f(Wn.Qloss, 2)} кВт`],
      ],
      result:
        Wn.bal >= 0
          ? `профицит ${f(Wn.bal, 2)} кВт — частичная рециркуляция`
          : `дефицит ${f(-Wn.bal, 2)} кВт — подогрев`,
      ok: Wn.bal >= 0 ? true : null,
    });
    N.step({
      what: 'Зимой: открытие регулируемых жалюзи',
      formula: 'доля = L_зима / L_лето (не меньше наименьшего открытия клапана); S_зима = S · L_зима / L_лето',
      rules: ['vent.winter'],
      data: [['L_зима / L_лето', `${f(Wn.ratio, 1)} %`]],
      result: `открытие ${Wn.open} %; приток ${f(Wn.SinW)} м², выброс ${f(Wn.SoutW)} м²`,
    });
  }

  static recup(N, Rc) {
    N.rule('vent.recup');
    N.rule('vent.season');
    const note = [
      Rc.why.length ? `Целесообразность: ${Rc.why.join('; ')}.` : '',
      Rc.frost ? 'Риск обмерзания.' : '',
      Rc.measures.length ? `Защита: ${Rc.measures.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    N.step({
      what: `Рекуператор${Rc.on ? '' : ' (оценка — опция не включена)'}`,
      formula: 't_после = t_нар + η · (t_выб − t_нар); Q = L · ρ · c · η · (t_выб − t_нар) / 3600',
      rules: ['vent.recup'],
      data: [
        ['тип', VentCalc.TYPES[Rc.type]],
        ['η', f(Rc.eta, 2)],
        ['t_выб', `${f(Rc.tExh, 1)} °C`],
        ['φ_выб', `${Rc.phi} %`],
      ],
      result: `t_после = ${f(Rc.tAfter, 1)} °C; Q = ${f(Rc.Q, 2)} кВт; за год ≈ ${n(Rc.year)} кВт·ч (${Rc.days} сут, средняя ${f(Rc.tavg, 1)} °C)`,
      ok: Rc.frost ? false : null,
      note,
    });
  }

  /** Маркизы: угол открытия — по скорости во входе (приток) или выходе (выброс) под козырьком самой нагруженной. */
  static hoods(N, V) {
    const vIn = N.rule('vent.hood_v');
    const list = [
      ['in', V.hood, 'Маркиза на приточных жалюзи (снегозащита)', 'vent.hood_v', vIn],
      ['out', V.hoodOut, 'Маркиза на жалюзи выброса (по требованию)', 'vent.speed', V.face],
    ];
    for (const [kind, Hd, what, rule, vmax] of list.filter(q => q[1])) {
      const I = V.louvers.filter(q => q.kind === kind && q.hood);
      const q0 = I.reduce((a, q) => (q.hood.v > a.hood.v ? q : a), I[0]);
      const Qi = Math.round((((q0.hood.v * 3600 * q0.hood.w) / 1000) * q0.hood.d) / 1000);
      N.step({
        what,
        formula:
          'вход (выход) под козырьком B × d, d = L · sin α — вылет; α — наименьший угол открытия 30…75° (шаг 5°), при котором Q / (3600 · B · d) ≤ v; у всех маркиз один — по самой нагруженной; L — высота жалюзи + 100 мм',
        rules: [rule],
        data: [
          ['Q', `${n(Qi)} м³/ч (жалюзи ${n(q0.w)} × ${n(q0.h)} мм)`],
          ['B × L', `${n(q0.hood.w)} × ${n(q0.hood.l)} мм`],
          ['v', `${f(vmax, 1)} м/с`],
        ],
        result: StationVent.hoodText(V, kind),
        ok: !Hd.over,
      });
    }
  }

  static rad(N, R) {
    const lim = StationVent.RAD_V;
    N.step({
      what:
        R.n > 1
          ? `Выброс воздуха радиатора ДГУ (у каждой своя ${R.door ? 'дверь-жалюзи' : 'решётка'}; самая нагруженная из ${R.n})`
          : 'Выброс воздуха радиатора ДГУ',
      formula: 'v = Q / (3600 · A)',
      rules: ['vent.free'],
      data: [
        ['Q', `${n(R.n > 1 ? R.qOne : R.q)} м³/ч`],
        [R.door ? 'дверь-жалюзи' : 'жалюзи', `${n(R.w)} × ${n(R.h)} мм`],
        ['A', `${f(R.free)} м²`],
      ],
      result: `v = ${f(R.v, 1)} м/с`,
      ok: R.v <= lim,
      note:
        R.v > lim
          ? `Больше ${f(lim, 1)} м/с — проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление).`
          : '',
    });
  }
}
