import { StationEquip } from '../layout/station-equip.js';
import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const names = L => [...new Set(L.map(o => o.u.name))];

/**
 * Насосная станция: рабочие насосы (самые крупные — резерв) параллельно на общий коллектор — Σ Qраб ≥ Qтреб, напор
 * каждого при доле Q/n не меньше требуемого (номинальная точка паспорта; кривой Q–H в каталоге нет). Кавитационный запас
 * NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас — если есть NPSHr и условия всасывания; жидкость — вода.
 */
export class PumpSizing {
  static G = 9.81;

  static units(q) {
    return q.units
      .filter(u => u.kind === 'pump')
      .flatMap(u => Array.from({ length: u.qty }, () => u))
      .map(u => {
        const Q = StationEquip.top(u.attrs.flow);
        const H = StationEquip.top(u.attrs.head);
        const np = CalcInput.row(u, /NPSH|кавитацион/i);
        return {
          u,
          Q: Q ? Q.v : 0,
          H: H ? H.v : null,
          range: !!((Q && Q.range) || (H && H.range)),
          npsh: np ? np.v : null,
        };
      });
  }

  static run(N, q) {
    const r = q.req;
    const U = PumpSizing.units(q);
    N.section('pump', 'Насосы');
    if (!U.length) {
      N.issue('error', 'В составе нет насосов.');
      return;
    }
    PumpSizing.data(N, r, U);
    const L = [...U].sort((a, b) => b.Q - a.Q);
    const res = r.reserve != null ? Math.min(r.reserve, L.length - 1) : 0;
    const work = L.slice(res);
    if (!(r.q > 0)) {
      N.issue('info', 'Подача станции не задана — проверка насосов не выполнена.');
      N.ask('Подача насосной станции, м³/ч, и требуемый напор, м.');
      return;
    }
    PumpSizing.flow(N, r, work, res);
    if (r.head > 0) PumpSizing.head(N, r, work);
    else N.ask('Требуемый напор насосной станции, м.', true);
    PumpSizing.npsh(N, r, work);
  }

  static data(N, r, U) {
    for (const nm of names(U.filter(o => !(o.Q > 0))))
      N.issue(
        'warn',
        `У «${nm}» в карточке не указана подача — по нему проверка подачи не выполнена; заполните карточку оборудования.`,
      );
    for (const nm of names(U.filter(o => !(o.H > 0))))
      N.issue(
        'warn',
        `У «${nm}» в карточке не указан напор — по нему проверка напора не выполнена; заполните карточку оборудования.`,
      );
    if (U.some(o => o.range))
      N.assume(
        'Подача или напор насоса в карточке заданы диапазоном («до …») — в расчёте взята верхняя граница; рабочая точка — по кривой Q–H из паспорта.',
      );
    if (r.reserve == null)
      N.missing(
        'pump.reserve.tz',
        'Резерв насосов в ТЗ не задан — расчёт без резерва',
        'Нужен ли резервный насос (N+1)?',
      );
  }

  static flow(N, r, work, res) {
    const Q = work.reduce((s, o) => s + o.Q, 0);
    const fq = N.fits(Q, r.q);
    if (!work.some(o => o.Q > 0)) return;
    N.step({
      what: 'Подача рабочих насосов против требуемой',
      formula: 'Σ Qраб ≥ Qтреб (резервные — самые крупные, не считаются)',
      rules: ['calc.tolerance'],
      data: [
        ['Qтреб', `${f(r.q, 1)} м³/ч`],
        ['рабочих', work.length + (res ? ` (+${res} резерв)` : '')],
        ...work.slice(0, 4).map(o => ['насос', `${o.u.name} — ${o.Q > 0 ? `${f(o.Q, 1)} м³/ч` : 'подача не указана'}`]),
      ],
      result: `Σ Qраб = ${f(Q, 1)} м³/ч`,
      ok: fq.ok,
      margin: CalcNote.pct(Q, r.q),
      note: fq.note,
      pick: names(work).join('; '),
    });
    if (!fq.ok) N.issue('error', `Подача рабочих насосов ${f(Q, 1)} м³/ч меньше требуемой ${f(r.q, 1)} м³/ч.`);
  }

  /** Напор каждого рабочего насоса при своей доле подачи (параллельная работа на общий коллектор). */
  static head(N, r, work) {
    const H = work.filter(o => o.H > 0);
    if (!H.length) {
      N.missing(
        'pump.head',
        'Напор насосов в карточках не указан — проверка напора не выполнена',
        'Напор насосов по паспорту, м.',
      );
      return;
    }
    const low = H.reduce((a, b) => (b.H < a.H ? b : a));
    const share = r.q / work.length;
    const fh = N.fits(low.H, r.head);
    const over = low.Q > 0 && share > low.Q * (1 + N.rule('calc.tolerance'));
    N.step({
      what: 'Напор рабочих насосов против требуемого',
      formula: 'Hнас ≥ Hтреб при подаче каждого Qтреб / n (номинальная точка паспорта)',
      rules: ['calc.tolerance'],
      data: [
        ['Hтреб', `${f(r.head, 1)} м`],
        ['подача на насос', `${f(share, 1)} м³/ч`],
        ['наименьший напор', `${low.u.name} — ${f(low.H, 1)} м${low.Q > 0 ? ` при ${f(low.Q, 1)} м³/ч` : ''}`],
      ],
      result: `Hнас = ${f(low.H, 1)} м`,
      ok: fh.ok && !over,
      margin: CalcNote.pct(low.H, r.head),
      note:
        fh.note ||
        (over
          ? 'Подача на насос больше номинальной — напор в этой точке ниже паспортного; проверьте по кривой Q–H.'
          : ''),
    });
    if (!fh.ok) N.issue('error', `Напор насоса «${low.u.name}» ${f(low.H, 1)} м меньше требуемого ${f(r.head, 1)} м.`);
    N.missing(
      'pump.curve',
      'Рабочая точка — по кривой Q–H из паспорта насоса (в каталоге кривых нет), проверка по номинальной точке',
    );
  }

  /** Кавитационный запас: нужны NPSHr (паспорт) и высота всасывания (ТЗ); давление пара — уравнение Антуана. */
  static npsh(N, r, work) {
    const np = work.filter(o => o.npsh > 0);
    if (r.hsuct == null || !np.length) {
      N.missing(
        'pump.npsh.data',
        'Кавитационный запас (NPSH) не проверен: нужны NPSHr по паспорту насоса и высота всасывания по ТЗ',
      );
      return;
    }
    const t = r.tliq != null ? r.tliq : 20;
    const A = N.rule('pump.antoine');
    const pv = Math.pow(10, A.A - A.B / (A.C + t)) * 0.133322;
    const pa = AirDemand.baro(r.alt || 0);
    const loss = N.rule('pump.suct_loss');
    const mg = N.rule('pump.npsh');
    const NPSHa = ((pa - pv) * 1000) / (1000 * PumpSizing.G) - r.hsuct - loss;
    const npshr = Math.max(...np.map(o => o.npsh));
    const need = npshr + mg;
    const ok = NPSHa >= need - 1e-9;
    N.step({
      what: 'Кавитационный запас на всасывании',
      formula: 'NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас',
      rules: ['pump.suct_loss', 'pump.npsh', 'pump.antoine'],
      data: [
        ['pатм', `${f(pa, 1)} кПа`],
        [`pнп(${f(t, 0)} °C)`, `${f(pv, 2)} кПа`],
        ['hвс', `${f(r.hsuct, 1)} м`],
        ['hпот', `${f(loss, 1)} м`],
        ['NPSHr', `${f(npshr, 1)} м`],
      ],
      result: `NPSHa = ${f(NPSHa, 1)} м`,
      ok,
      margin: CalcNote.pct(NPSHa, need),
    });
    if (!ok)
      N.issue(
        'error',
        `Кавитационный запас на всасывании ${f(NPSHa, 1)} м меньше нужного ${f(need, 1)} м — уменьшите высоту всасывания или подберите насос с меньшим NPSHr.`,
      );
    if (!r.liquid)
      N.assume(
        'Перекачиваемая жидкость — вода (плотность 1000 кг/м³); другая жидкость — по паспорту насоса и данным заказчика.',
      );
  }
}
