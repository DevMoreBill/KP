import { StationEquip } from '../layout/station-equip.js';
import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';
import { PumpPoint } from './pump-point.js';
import { ReserveCheck } from './reserve-check.js';

/**
 * Насосная станция: рабочие насосы (самые крупные — резерв) параллельно на общий коллектор — Σ Qраб ≥ Qтреб, напор
 * каждого при доле Q/n не меньше требуемого (номинальная точка паспорта или крайние точки диапазона — PumpPoint; кривой
 * Q–H в каталоге нет). Кавитационный запас
 * NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас — если есть NPSHr и условия всасывания; жидкость — вода.
 */
export class PumpSizing {
  static MMHG_KPA = 0.133322; // мм рт. ст. → кПа (уравнение Антуана)
  static _names = list => [...new Set(list.map(entry => entry.u.name))];
  static GRAVITY = 9.81;
  static WORST = [PumpPoint.SHORT, PumpPoint.OVER, PumpPoint.CHECK, PumpPoint.FITS];
  static STEP_OK = {
    [PumpPoint.FITS]: true,
    [PumpPoint.CHECK]: null,
    [PumpPoint.SHORT]: false,
    [PumpPoint.OVER]: false,
  };
  /** Замечание по худшему насосу диапазона: напора не хватает или подача больше паспорта — ошибка; между точками — уточнить. */
  static RANGE_ISSUE = {
    [PumpPoint.SHORT]: {
      level: 'error',
      text: ({ name, attrs, need, fmt }) =>
        `Напор насоса «${name}» — не больше ${fmt(PumpPoint.of(attrs).head.hi)} м, меньше требуемого ${fmt(need)} м.`,
    },
    [PumpPoint.OVER]: {
      level: 'error',
      text: ({ name, attrs, share, fmt }) =>
        `Насос «${name}»: подача на насос ${fmt(share)} м³/ч больше наибольшей по паспорту ${fmt(PumpPoint.of(attrs).flow.hi)} м³/ч — такую подачу он не даст; нужно больше рабочих насосов или насос на большую подачу.`,
    },
    [PumpPoint.CHECK]: {
      level: 'warn',
      text: ({ name, share, need, passport, fmt }) =>
        `Насос «${name}»: при ${fmt(share)} м³/ч нужен напор ${fmt(need)} м — между крайними точками паспорта (${passport}); уточните рабочую точку по кривой Q–H.`,
    },
  };

  static _units(input) {
    return input.units
      .filter(unit => unit.kind === 'pump')
      .flatMap(unit => Array.from({ length: unit.qty }, () => unit))
      .map(unit => {
        const flow = StationEquip.top(unit.attrs.flow);
        const head = StationEquip.top(unit.attrs.head);
        const npsh = CalcInput.row(unit, /NPSH|кавитацион/i);
        return {
          u: unit,
          Q: flow ? flow.v : 0,
          H: head ? head.v : null,
          range: !!((flow && flow.range) || (head && head.range)),
          npsh: npsh ? npsh.v : null,
        };
      });
  }

  /** Насосы: подача, напор и кавитационный запас. */
  static run(note, input) {
    const req = input.req;
    const units = PumpSizing._units(input);
    note.section('pump', 'Насосы');
    if (!units.length) {
      note.issue('error', 'В составе нет насосов.');
      return;
    }
    PumpSizing._data(note, req, units);
    const sorted = [...units].sort((first, second) => second.Q - first.Q);
    const res = ReserveCheck.check(note, req, sorted.length, 'pump');
    const work = sorted.slice(res);
    if (!(req.q > 0)) {
      note.issue('info', 'Подача станции не задана — проверка насосов не выполнена.');
      note.ask('Подача насосной станции, м³/ч, и требуемый напор, м.');
      return;
    }
    PumpSizing._flow(note, req, work, res);
    if (req.head > 0) PumpSizing.head(note, req, work);
    else note.ask('Требуемый напор насосной станции, м.', true);
    PumpSizing.npsh(note, req, work);
  }

  static _data(note, req, units) {
    for (const name of PumpSizing._names(units.filter(entry => !(entry.Q > 0))))
      note.issue(
        'warn',
        `У «${name}» в карточке не указана подача — по нему проверка подачи не выполнена; заполните карточку оборудования.`,
      );
    for (const name of PumpSizing._names(units.filter(entry => !(entry.H > 0))))
      note.issue(
        'warn',
        `У «${name}» в карточке не указан напор — по нему проверка напора не выполнена; заполните карточку оборудования.`,
      );
    if (units.some(entry => entry.range))
      note.assume(
        'Подача или напор насоса в карточке заданы диапазоном — это крайние точки кривой Q–H: наибольшая подача — при наименьшем напоре, наибольший напор — при наименьшей подаче; рабочая точка между ними — по кривой Q–H из паспорта.',
      );
    if (req.reserve == null)
      note.missing(
        'pump.reserve.tz',
        'Резерв насосов в ТЗ не задан — расчёт без резерва',
        'Нужен ли резервный насос (N+1)?',
      );
  }

  static _flow(note, req, work, res) {
    const flow = work.reduce((sum, entry) => sum + entry.Q, 0);
    const flowFit = note.fits(flow, req.q);
    if (!work.some(entry => entry.Q > 0)) return;
    note.step({
      what: 'Подача рабочих насосов против требуемой',
      formula: 'Σ Qраб ≥ Qтреб (резервные — самые крупные, не считаются)',
      rules: ['calc.tolerance'],
      data: [
        ['Qтреб', `${CalcNote.fmt(req.q, 1)} м³/ч`],
        ['рабочих', work.length + (res ? ` (+${res} резерв)` : '')],
        ...work
          .slice(0, 4)
          .map(entry => [
            'насос',
            `${entry.u.name} — ${entry.Q > 0 ? `${CalcNote.fmt(entry.Q, 1)} м³/ч` : 'подача не указана'}`,
          ]),
      ],
      result: `Σ Qраб = ${CalcNote.fmt(flow, 1)} м³/ч`,
      ok: flowFit.ok,
      margin: CalcNote.pct(flow, req.q),
      note: flowFit.note,
      pick: PumpSizing._names(work).join('; '),
    });
    if (!flowFit.ok)
      note.issue(
        'error',
        `Подача рабочих насосов ${CalcNote.fmt(flow, 1)} м³/ч меньше требуемой ${CalcNote.fmt(req.q, 1)} м³/ч.`,
      );
  }

  /** Напор каждого рабочего насоса при своей доле подачи (параллельная работа на общий коллектор). */
  static head(note, req, work) {
    const heads = work.filter(entry => entry.H > 0);
    if (!heads.length) {
      note.missing(
        'pump.head',
        'Напор насосов в карточках не указан — проверка напора не выполнена',
        'Напор насосов по паспорту, м.',
      );
      return;
    }
    const share = req.q / work.length;
    const ranged = heads.some(entry => entry.range);
    if (ranged) PumpSizing._headRange(note, req, heads, share);
    else PumpSizing._headPoint(note, req, heads, share);
    note.missing(
      'pump.curve',
      `Рабочая точка — по кривой Q–H из паспорта насоса (в каталоге кривых нет), проверка по ${ranged ? 'крайним точкам диапазона' : 'номинальной точке'}`,
    );
  }

  static _headPoint(note, req, heads, share) {
    const low = heads.reduce((first, second) => (second.H < first.H ? second : first));
    const headFit = note.fits(low.H, req.head);
    const over = low.Q > 0 && share > low.Q * (1 + note.rule('calc.tolerance'));
    note.step({
      what: 'Напор рабочих насосов против требуемого',
      formula: 'Hнас ≥ Hтреб при подаче каждого Qтреб / n (номинальная точка паспорта)',
      rules: ['calc.tolerance'],
      data: [
        ['Hтреб', `${CalcNote.fmt(req.head, 1)} м`],
        ['подача на насос', `${CalcNote.fmt(share, 1)} м³/ч`],
        [
          'наименьший напор',
          `${low.u.name} — ${CalcNote.fmt(low.H, 1)} м${low.Q > 0 ? ` при ${CalcNote.fmt(low.Q, 1)} м³/ч` : ''}`,
        ],
      ],
      result: `Hнас = ${CalcNote.fmt(low.H, 1)} м`,
      ok: headFit.ok && !over,
      margin: CalcNote.pct(low.H, req.head),
      note:
        headFit.note ||
        (over
          ? 'Подача на насос больше номинальной — напор в этой точке ниже паспортного; проверьте по кривой Q–H.'
          : ''),
    });
    if (!headFit.ok)
      note.issue(
        'error',
        `Напор насоса «${low.u.name}» ${CalcNote.fmt(low.H, 1)} м меньше требуемого ${CalcNote.fmt(req.head, 1)} м.`,
      );
    else if (over)
      note.issue(
        'warn',
        `Насос «${low.u.name}»: подача на насос ${CalcNote.fmt(share, 1)} м³/ч больше номинальной ${CalcNote.fmt(low.Q, 1)} м³/ч — напор в этой точке ниже паспортного ${CalcNote.fmt(low.H, 1)} м; уточните рабочую точку по кривой Q–H.`,
      );
  }

  /** Диапазон паспорта: по крайним точкам — точно да, точно нет или «уточните рабочую точку» (худший из насосов). */
  static _headRange(note, req, heads, share) {
    const tol = note.rule('calc.tolerance');
    const worst = heads
      .map(entry => ({ entry, state: PumpPoint.verdict(entry.u.attrs, share, req.head, tol) }))
      .reduce((first, second) =>
        PumpSizing.WORST.indexOf(second.state) < PumpSizing.WORST.indexOf(first.state) ? second : first,
      );
    const attrs = worst.entry.u.attrs;
    const name = worst.entry.u.name;
    const fmt = value => CalcNote.fmt(value, 1);
    const sure = PumpPoint.sure(attrs, share);
    const passport = PumpPoint.text(attrs, fmt);
    note.step({
      what: 'Напор рабочих насосов против требуемого',
      formula:
        'Hнас ≥ Hтреб при подаче каждого Qтреб / n; диапазон паспорта — крайние точки кривой Q–H (подача растёт — напор падает)',
      rules: ['calc.tolerance'],
      data: [
        ['Hтреб', `${fmt(req.head)} м`],
        ['подача на насос', `${fmt(share)} м³/ч`],
        ['по паспорту', `${name} — ${passport}`],
      ],
      result: PumpSizing._rangeResult(worst.state, { sure, attrs, share, fmt }),
      ok: PumpSizing.STEP_OK[worst.state],
      margin: worst.state === PumpPoint.FITS ? CalcNote.pct(sure, req.head) : null,
      note:
        worst.state === PumpPoint.OVER
          ? 'Подача на насос больше наибольшей по паспорту — такую подачу насос не даст.'
          : '',
    });
    const issue = PumpSizing.RANGE_ISSUE[worst.state];
    if (issue) note.issue(issue.level, issue.text({ name, attrs, share, need: req.head, passport, fmt }));
    PumpSizing._under(note, heads, share);
  }

  // подача на насос меньше наименьшей по паспорту — вне рабочей части кривой
  static _under(note, heads, share) {
    const tol = note.rule('calc.tolerance');
    const low = heads.find(entry => PumpPoint.under(entry.u.attrs, share, tol));
    if (!low) return;
    note.issue(
      'warn',
      `Насос «${low.u.name}»: подача на насос ${CalcNote.fmt(share, 1)} м³/ч меньше наименьшей по паспорту ${CalcNote.fmt(PumpPoint.of(low.u.attrs).flow.lo, 1)} м³/ч — работа вне рабочей части кривой (перегрев, вибрация); проверьте по паспорту или возьмите насос на меньшую подачу.`,
    );
  }

  static _rangeResult(state, { sure, attrs, share, fmt }) {
    const { flow, head } = PumpPoint.of(attrs);
    const text = {
      [PumpPoint.FITS]: () => `Hнас ≥ ${fmt(sure)} м при ${fmt(share)} м³/ч`,
      [PumpPoint.SHORT]: () => `Hнас ≤ ${fmt(head.hi)} м`,
      [PumpPoint.OVER]: () => `подача на насос больше ${fmt(flow.hi)} м³/ч`,
      [PumpPoint.CHECK]: () => `Hнас при ${fmt(share)} м³/ч — ${PumpSizing._span(head, fmt)}по кривой Q–H`,
    };
    return text[state]();
  }

  // известные границы напора для «уточните по кривой»: «от 20 до 50 м: », «до 50 м: »; напор числом — без них
  static _span(head, fmt) {
    if (head.lo == null) return `до ${fmt(head.hi)} м: `;
    return head.range ? `от ${fmt(head.lo)} до ${fmt(head.hi)} м: ` : '';
  }

  /** Кавитационный запас: нужны NPSHr (паспорт) и высота всасывания (ТЗ); давление пара — уравнение Антуана. */
  static npsh(note, req, work) {
    const npshUnits = work.filter(entry => entry.npsh > 0);
    if (req.hsuct == null || !npshUnits.length) {
      note.missing(
        'pump.npsh.data',
        'Кавитационный запас (NPSH) не проверен: нужны NPSHr по паспорту насоса и высота всасывания по ТЗ',
      );
      return;
    }
    const temp = req.tliq != null ? req.tliq : 20;
    const antoine = note.rule('pump.antoine');
    const vapor = Math.pow(10, antoine.A - antoine.B / (antoine.C + temp)) * PumpSizing.MMHG_KPA;
    const baro = AirDemand.baro(req.alt || 0);
    const loss = note.rule('pump.suct_loss');
    const margin = note.rule('pump.npsh');
    const NPSHa = ((baro - vapor) * 1000) / (1000 * PumpSizing.GRAVITY) - req.hsuct - loss;
    const npshr = Math.max(...npshUnits.map(entry => entry.npsh));
    const need = npshr + margin;
    const ok = NPSHa >= need - 1e-9;
    note.step({
      what: 'Кавитационный запас на всасывании',
      formula: 'NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас',
      rules: ['pump.suct_loss', 'pump.npsh', 'pump.antoine'],
      data: [
        ['pатм', `${CalcNote.fmt(baro, 1)} кПа`],
        [`pнп(${CalcNote.fmt(temp, 0)} °C)`, `${CalcNote.fmt(vapor, 2)} кПа`],
        ['hвс', `${CalcNote.fmt(req.hsuct, 1)} м`],
        ['hпот', `${CalcNote.fmt(loss, 1)} м`],
        ['NPSHr', `${CalcNote.fmt(npshr, 1)} м`],
      ],
      result: `NPSHa = ${CalcNote.fmt(NPSHa, 1)} м`,
      ok,
      margin: CalcNote.pct(NPSHa, need),
    });
    if (!ok)
      note.issue(
        'error',
        `Кавитационный запас на всасывании ${CalcNote.fmt(NPSHa, 1)} м меньше нужного ${CalcNote.fmt(need, 1)} м — уменьшите высоту всасывания или подберите насос с меньшим NPSHr.`,
      );
    if (!req.liquid)
      note.assume(
        'Перекачиваемая жидкость — вода (плотность 1000 кг/м³); другая жидкость — по паспорту насоса и данным заказчика.',
      );
  }
}
