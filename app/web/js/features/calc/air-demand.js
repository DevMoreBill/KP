import { AirChain } from '../layout/air-chain.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;

/**
 * Потребность → производительность компрессоров (ISO 1217, FAD). Н. м³ (DIN 1343) или ст. м³ (ГОСТ 2939-63) — в FAD по
 * давлению на высоте (ГОСТ 4401-81) и парциальному давлению пара (Магнус, WMO-No. 8); затем запас, продувка
 * адсорбционного осушителя и сравнение с рабочими компрессорами (резервные — самые крупные, не считаются).
 */
export class AirDemand {
  static REF = { normal: 'flow.normal', std: 'flow.standard' };

  /** Давление на высоте H, кПа. */
  static baro(H) {
    const a = StationRules.raw('flow.isa');
    return a.p0 * Math.pow(1 - a.a * Math.max(0, H || 0), a.n);
  }

  /** Давление насыщенного пара над водой при t, кПа. */
  static psat(t) {
    const m = StationRules.raw('flow.psat');
    return m.c * Math.exp((m.b * t) / (m.l + t));
  }

  static unit(b) {
    return b === 'std' ? 'ст. м³' : 'н. м³';
  }

  /** Условия приведения; ст. м³ в своей версии правил до 3.99 может не быть — 20 °C, 101,325 кПа. */
  static ref(b) {
    return b === 'std' ? StationRules.opt('flow.standard') || { t: 20, p: 101.325 } : StationRules.raw('flow.normal');
  }

  /** Н. м³/мин (или ст. м³/мин) → FAD при условиях всасывания. */
  static fad(Qn, H, t, rh, b = 'normal') {
    const nc = AirDemand.ref(b);
    const pv = ((rh || 0) / 100) * AirDemand.psat(t);
    return (((Qn * nc.p) / (AirDemand.baro(H) - pv)) * (t + 273.15)) / (nc.t + 273.15);
  }

  static units(q) {
    return q.units.filter(u => u.kind === 'compressor').flatMap(u => Array.from({ length: u.qty }, () => u));
  }

  static run(N, q) {
    const r = q.req;
    N.section('air', 'Производительность');
    if (!(r.flow > 0)) {
      N.issue('info', 'Производительность станции не задана — расчёт по потребности не выполнен.');
      N.ask(
        'Требуемая производительность станции, м³/мин, и к каким условиям она приведена (FAD — условия всасывания или нормальные м³).',
      );
      return null;
    }
    const H = r.alt != null ? r.alt : 0;
    const tAir = r.tmax != null ? r.tmax : StationRules.raw('flow.fad_ref').t;
    if (r.alt == null) {
      N.assume('Высота над уровнем моря в ТЗ не указана — принято 0 м.');
      N.ask('Высота площадки над уровнем моря, м.', true);
    }
    if (r.tmax == null)
      N.missing(
        't.max',
        `Наружная температура летом не задана — для расчёта принята ${f(tAir, 0)} °C`,
        'Максимальная температура наружного воздуха на площадке (летом), °C.',
      );
    const Q = AirDemand.REF[r.basis] ? AirDemand.toFad(N, r, H, tAir) : AirDemand.asFad(N, r.flow);
    N.rule('flow.fad_ref');
    const need = AirDemand.need(N, q, Q);
    const C = AirDemand.units(q)
      .map(u => ({ u, v: u.info.flow || 0 }))
      .sort((a, b) => b.v - a.v);
    if (!C.length) {
      N.issue('error', 'В составе нет компрессоров.');
      return { need, Q };
    }
    const out = AirDemand.compare(N, r, C, need);
    if (!out) return { need, Q };
    AirDemand.motor(N, r, H);
    return { need, Q, ...out };
  }

  static asFad(N, Q) {
    N.step({
      what: 'Потребность — FAD (приведена к условиям всасывания, ISO 1217)',
      data: [['Q', `${f(Q)} м³/мин`]],
      rules: ['flow.fad_ref'],
      result: `Qfad = ${f(Q)} м³/мин`,
    });
    return Q;
  }

  static toFad(N, r, H, tAir) {
    const b = r.basis;
    const u = AirDemand.unit(b);
    const std = b === 'std';
    const rid = std && StationRules.opt('flow.standard') ? 'flow.standard' : 'flow.normal';
    const T0 = AirDemand.ref(b).t;
    const rh = r.rh != null ? r.rh : 100;
    if (r.rh == null) N.assume(`Влажность воздуха не указана — для перевода ${u} в FAD принято 100 % (с запасом).`);
    N.rule(rid);
    N.rule('flow.isa');
    N.rule('flow.psat');
    const pb = AirDemand.baro(H);
    const ps = AirDemand.psat(tAir);
    const Q = AirDemand.fad(r.flow, H, tAir, rh, b);
    const sym = std ? 'ст' : 'н';
    N.step({
      what: `Потребность в ${std ? 'стандартных' : 'нормальных'} м³ → FAD (условия всасывания)`,
      formula: `Qfad = Q${sym} · 101,325 / (pб − φ·pн.п) · (273,15 + t) / ${f(273.15 + T0, 2)}`,
      data: [
        [`Q${sym}`, `${f(r.flow)} ${u}/мин`],
        ['высота', `${f(H, 0)} м → pб = ${f(pb, 3)} кПа`],
        ['t всасывания', `${f(tAir, 0)} °C`],
        ['φ', `${f(rh, 0)} % → pн.п = ${f(ps, 3)} кПа`],
      ],
      rules: [rid, 'flow.isa', 'flow.psat'],
      result: `Qfad = ${f(Q)} м³/мин`,
    });
    return Q;
  }

  /** Запас — по ТЗ (нормами РФ не установлен); продувка адсорбционного осушителя. */
  static need(N, q, Q) {
    const r = q.req;
    const m0 = N.rule('flow.margin');
    const m = r.margin != null ? r.margin : m0.default;
    if (r.margin == null) {
      N.missing(
        'flow.margin.tz',
        `Запас производительности в ТЗ не задан — принят ${f(m, 0)} % (нормами РФ не установлен)`,
        'Нужен ли запас производительности сверх потребности (утечки, развитие производства), %?',
      );
    }
    const ads = q.units.filter(u => u.kind === 'dryer' && u.info.type === 'ads');
    const regen = ads.length ? String(ads[0].attrs.regen || '') : '';
    let s = 0;
    if (ads.length) {
      N.rule('flow.purge');
      s = AirChain.purge(regen);
    }
    const need = (Q * (1 + m / 100)) / (1 - s);
    N.step({
      what: 'Требуемая производительность рабочих компрессоров',
      formula: 'Qтр = Qfad · (1 + запас) / (1 − продувка)',
      data: [
        ['Qfad', `${f(Q)} м³/мин`],
        ['запас', `${f(m, 1)} %${r.margin == null ? ' (не задан в ТЗ)' : ' (ТЗ)'}`],
        [
          'продувка осушителя',
          ads.length ? `${f(s * 100, 0)} % (${regen || 'тип регенерации не указан'})` : 'нет адсорбционного осушителя',
        ],
      ],
      rules: ['flow.margin', ads.length ? 'flow.purge' : ''],
      result: `Qтр = ${f(need)} м³/мин`,
    });
    return need;
  }

  /** Рабочие против требуемой; резервные — самые крупные; без производительности — предупреждение. */
  static compare(N, r, C, need) {
    const res = r.reserve != null ? Math.min(r.reserve, C.length - 1) : 0;
    const work = C.slice(res);
    const spare = C.slice(0, res);
    const sum = work.reduce((a, o) => a + o.v, 0);
    if (r.reserve == null) {
      N.rule('flow.reserve');
      N.missing(
        'flow.reserve.tz',
        'Резерв компрессоров в ТЗ не задан — расчёт без резерва',
        'Нужен ли резервный компрессор (N+1)?',
      );
    }
    const unknown = [...new Set(C.filter(o => !(o.v > 0)).map(o => o.u.name))];
    if (unknown.length) {
      N.missing('comp.flow', `Нет производительности: ${unknown.join(', ')}`);
      for (const nm of unknown)
        N.issue(
          'warn',
          `У «${nm}» в карточке не указана производительность — по нему проверка не выполнена; заполните карточку оборудования.`,
        );
    }
    if (!work.some(o => o.v > 0)) return null;
    const fit = N.fits(sum, need);
    N.step({
      what: 'Компрессоры: рабочие против требуемой',
      formula: 'Σ Qраб ≥ Qтр',
      data: [
        ['рабочих', `${work.length} шт.`],
        ['резервных', `${res} шт.${res ? ' (самые крупные — не учитываются)' : ''}`],
        ...work.slice(0, 6).map((o, i) => [`№ ${i + 1}`, `${o.u.name} — ${f(o.v)} м³/мин`]),
      ],
      result: `Σ Qраб = ${f(sum)} м³/мин`,
      ok: fit.ok,
      margin: CalcNote.pct(sum, need),
      note: fit.note,
      rules: fit.edge ? ['calc.tolerance'] : [],
      pick: [...new Set(C.map(o => o.u.name))].join('; '),
    });
    if (!fit.ok)
      N.issue('error', `Производительность рабочих компрессоров ${f(sum)} м³/мин меньше требуемой ${f(need)} м³/мин.`);
    if (res) AirDemand.reserve(N, work, spare, res);
    return { sum, work, res };
  }

  static reserve(N, work, spare, res) {
    const big = work.length ? work[0].v : 0;
    const low = spare.filter(o => o.v < big - 1e-9);
    N.step({
      what: 'Резерв',
      formula: 'резервный не меньше самого крупного рабочего',
      rules: ['flow.reserve'],
      data: spare.map(o => ['резервный', `${o.u.name} — ${f(o.v)} м³/мин`]),
      ok: !low.length,
      result: low.length ? 'резервный меньше рабочего' : `N + ${res}`,
    });
    if (low.length)
      N.issue(
        'error',
        'Резервный компрессор меньше самого крупного рабочего — при его отказе станция не обеспечит потребность.',
      );
  }

  /** Электродвигатель на высоте и в жару — снижение мощности по данным изготовителя. */
  static motor(N, r, H) {
    const ma = N.rule('flow.motor_alt');
    const hot = r.tmax != null && r.tmax > ma.t;
    if (H <= ma.h && !hot) return;
    const why = [H > ma.h ? `высота ${f(H, 0)} м` : '', hot ? `до +${f(r.tmax, 0)} °C` : ''].filter(Boolean).join(', ');
    N.issue(
      'warn',
      `Условия выше номинальных для электродвигателя (до ${ma.h} м и +${ma.t} °C): ${why} — снижение мощности по данным изготовителя.`,
    );
    N.missing('motor.derate', 'Снижение мощности двигателей компрессоров на высоте / в жару — по данным изготовителя');
  }
}
