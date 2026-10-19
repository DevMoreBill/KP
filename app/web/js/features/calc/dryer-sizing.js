import { AirChain } from '../layout/air-chain.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const CLASS = /^([1-6])\.([1-6])\.([1-4])$/;

/**
 * Осушители: поправки производителя F = Fp · Fвх · Fокр (· Fтр — номинал серии не для +3 °C); серии нет — типовая
 * серия по виду (dryer.generic), нет и её — Kp ÷ запас. Точка росы — по классу ISO 8573-1.
 */
export class DryerSizing {
  /** Значение таблицы и признак «вне таблицы». */
  static k(T, x) {
    if (!Array.isArray(T) || !T.length || x == null) return { k: 1, out: false };
    return { k: StationRules.interp(T, x), out: x < T[0][0] - 1e-9 || x > T[T.length - 1][0] + 1e-9 };
  }

  /** Температуры: в помещении — наружная летом + нагрев вентиляцией; на входе — из ТЗ или помещение + dryer.inlet_dt. */
  static temps(r) {
    const amb = (r.tmax != null ? r.tmax : StationRules.raw('dryer.ref').ambient) + StationRules.raw('heat.vent_dt');
    return { amb, tin: r.tin != null ? r.tin : amb + StationRules.raw('dryer.inlet_dt') };
  }

  /** Серия производителя; нет — типовая серия по виду осушителя (generic). */
  static seriesOf(p, type) {
    const s = StationRules.series(p, 'dryer');
    if (s) return { s, generic: false };
    const title = (StationRules.raw('dryer.generic') || {})[type === 'ads' ? 'ads' : 'refrig'];
    const g = ((StationRules.data || {}).series || []).find(z => z.kind === 'dryer' && z.title === title) || null;
    return { s: g, generic: !!g };
  }

  static factor(p, bar, t, type) {
    const { s, generic } = DryerSizing.seriesOf(p, type);
    if (!s) {
      const kp = AirChain.kp(bar);
      return { F: kp / StationRules.raw('dryer.margin'), s: null, generic: false, kp: { k: kp }, out: [] };
    }
    const kp = DryerSizing.k(s.f.p, bar);
    const ki = DryerSizing.k(s.f.inlet, s.f.inlet ? t.tin : null);
    const ka = DryerSizing.k(s.f.ambient, s.f.ambient ? t.amb : null);
    const kc = s.k > 0 ? s.k : 1;
    const out = [kp.out && 'давление', ki.out && 'температура входа', ka.out && 'температура помещения'].filter(
      Boolean,
    );
    return { F: kp.k * ki.k * ka.k * kc, s, generic, kp, ki, ka, kc, out };
  }

  static run(N, q, A, P) {
    const r = q.req;
    const D = q.units.filter(u => u.kind === 'dryer' && u.info.type !== 'gen');
    if (!D.length) {
      DryerSizing.none(N, q);
      return;
    }
    N.section('dryer', 'Осушители');
    const Q = A && A.sum > 0 ? A.sum : null;
    if (!Q) {
      N.issue('info', 'Нет производительности компрессоров — осушитель не проверен.');
      return;
    }
    const p = DryerSizing.pressure(r, P, () => StationRules.raw('dryer.ref').p);
    const t = DryerSizing.temps(r);
    DryerSizing.assumed(N, r, t, p);
    const cls = String(q.cls || '').match(CLASS);
    const pdpNeed = cls ? AirChain.PDP[+cls[2]] : null;
    for (const u of D) DryerSizing.one(N, { q, u, Q, p, t, pdpNeed });
  }

  /** Давление для поправок: у осушителя с потерями, иначе у потребителя, иначе по умолчанию. */
  static pressure(r, P, def) {
    if (P && P.pOp > 0) return P.pOp;
    return r.pressure > 0 ? r.pressure : def();
  }

  /** Класса с точкой росы нет без осушителя (если он не встроен в компрессор). */
  static none(N, q) {
    const cls = String(q.cls || '').match(CLASS);
    if (!cls || q.units.some(u => u.kind === 'compressor' && u.info.dryer)) return;
    const pdp = f(AirChain.PDP[+cls[2]], 0);
    N.section('dryer', 'Осушители');
    N.rule('air.pdp');
    N.step({
      what: `Осушитель для класса ${q.cls}`,
      formula: `точка росы под давлением ≤ ${pdp} °C`,
      rules: ['air.pdp'],
      ok: false,
      result: 'осушителя в составе нет',
    });
    N.issue('error', `Класс ${q.cls}: в составе нет осушителя (точка росы не выше ${pdp} °C).`);
  }

  static assumed(N, r, t, p) {
    const dt = StationRules.raw('heat.vent_dt');
    N.rule('heat.vent_dt');
    if (r.tin == null) {
      N.rule('dryer.inlet_dt');
      const out = r.tmax != null ? f(r.tmax, 0) : `по умолчанию ${f(t.amb - dt, 0)}`;
      N.assume(
        `Температура воздуха на входе в осушитель — по правилу: в помещении станции ${f(t.amb, 0)} °C (наружная ${out} °C + нагрев ${f(dt, 0)} °C) + ${f(t.tin - t.amb, 0)} °C после охладителя компрессора = ${f(t.tin, 0)} °C.`,
      );
    }
    N.assume(
      `Давление на входе в осушитель и фильтры для поправок принято ${f(p, 1)} бар — не выше фактического (запас в меньшую сторону).`,
    );
  }

  static one(N, { q, u, Q, p, t, pdpNeed }) {
    const cap = (u.info.flow || 0) * u.qty;
    const o = DryerSizing.factor(u.p, p, t, u.info.type);
    const rules = ['heat.vent_dt', q.req.tin == null ? 'dryer.inlet_dt' : ''];
    if (!(cap > 0)) {
      N.missing(`dryer.flow.${u.name}`, `Нет производительности осушителя ${u.name}`);
      return;
    }
    const data = o.s ? DryerSizing.series(N, u, o, { p, t, rules }) : DryerSizing.generic(N, u, o, { p, rules });
    const corr = cap * o.F;
    const fit = N.fits(corr, Q);
    if (fit.edge) rules.push('calc.tolerance');
    const formula = DryerSizing.formula(o);
    N.step({
      what: `${u.name}${u.qty > 1 ? ` × ${u.qty} (параллельно)` : ''}`,
      formula,
      data: [['номинал', `${f(cap)} м³/мин`], ...data, ['через осушитель', `${f(Q)} м³/мин`]],
      rules,
      result: `с поправками ${f(corr)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(corr, Q),
      note: fit.note,
      pick: u.name,
    });
    const name = CalcNote.lbl('Осушитель', u.name);
    if (!fit.ok)
      N.issue(
        'error',
        `${name}: с поправками ${f(corr)} м³/мин — меньше производительности компрессоров ${f(Q)} м³/мин.`,
      );
    if (o.out.length)
      N.issue(
        'warn',
        `${name}: условия вне таблицы производителя (${o.out.join(', ')}) — взяты крайние значения, уточните у производителя.`,
      );
    if (pdpNeed != null) DryerSizing.dew(N, q, u, pdpNeed);
  }

  static formula(o) {
    if (!o.s) return 'Qосуш · Kp ÷ запас ≥ Σ Qраб';
    return `Qосуш · Fp · Fвх${o.s.f.ambient ? ' · Fокр' : ''}${o.kc !== 1 ? ' · Fтр' : ''} ≥ Σ Qраб`;
  }

  static key(u) {
    return `series.dryer.${u.attrs.maker || ''}.${u.attrs.model || u.name}`;
  }

  static series(N, u, o, { p, t, rules }) {
    const data = [
      ['давление', `${f(p, 1)} бар → ${f(o.kp.k, 3)}`],
      ...(o.s.f.inlet ? [['вход', `${f(t.tin, 0)} °C → ${f(o.ki.k, 3)}`]] : []),
      ...(o.s.f.ambient ? [['помещение', `${f(t.amb, 0)} °C → ${f(o.ka.k, 3)}`]] : []),
      ...(o.kc !== 1 ? [[o.s.kWhat || 'поправка серии', f(o.kc, 2)]] : []),
      [
        'источник',
        (o.generic ? `типовые поправки по таблице «${o.s.title}» — ` : '') +
          [o.s.source.doc, o.s.source.item].filter(Boolean).join(', '),
      ],
    ];
    if (o.generic) {
      N.rule('dryer.generic');
      rules.push('dryer.generic');
      N.missing(
        DryerSizing.key(u),
        `Данные для расчёта неполные: поправок производителя для осушителя «${u.name}» нет — типовые по таблице «${o.s.title}»`,
      );
    }
    return data;
  }

  static generic(N, u, o, { p, rules }) {
    N.rule('dryer.kp');
    N.rule('dryer.margin');
    rules.push('dryer.kp', 'dryer.margin');
    N.missing(
      DryerSizing.key(u),
      `Данные для расчёта неполные: поправки производителя для осушителя «${u.name}» не найдены — типовая таблица`,
    );
    return [
      ['давление', `${f(p, 1)} бар → ${f(o.kp.k, 3)} (типовая таблица)`],
      ['запас на температуру', `÷ ${f(StationRules.raw('dryer.margin'))}`],
    ];
  }

  static dew(N, q, u, pdpNeed) {
    const pdp = u.info.pdp;
    if (pdp == null) {
      N.missing(`dryer.pdp.${u.name}`, `Нет точки росы осушителя ${u.name}`);
      return;
    }
    const ok = pdp <= pdpNeed + 1e-9;
    N.step({
      what: 'Точка росы под давлением',
      formula: 'PDP осушителя ≤ PDP класса',
      rules: ['air.pdp'],
      data: [
        [`класс ${q.cls}`, `${f(pdpNeed, 0)} °C`],
        ['осушитель', `${f(pdp, 0)} °C`],
      ],
      ok,
      result: ok ? 'обеспечивает' : 'не обеспечивает',
    });
    N.rule('air.pdp');
    if (!ok)
      N.issue(
        'error',
        `${CalcNote.lbl('Осушитель', u.name)}: точка росы ${f(pdp, 0)} °C — хуже требуемой по классу ${q.cls} (${f(pdpNeed, 0)} °C).`,
      );
  }
}
