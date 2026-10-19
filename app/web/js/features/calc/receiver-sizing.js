import { ReceiverPlan } from '../layout/receiver-plan.js';
import { StationEquip } from '../layout/station-equip.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const l = v => f(v, 0);

/** Ресиверы по методике ПНЕВМОТЕХ (ReceiverPlan): приоритеты 1–3, рекомендация, проверки; учёт в Ростехнадзоре. */
export class ReceiverSizing {
  static run(N, q) {
    if (!q.units.some(u => u.kind === 'compressor')) return;
    N.section('recv', 'Ресиверы');
    const rq = q.recvIn || {};
    const R = ReceiverPlan.from(StationEquip.list(q.parts, { recv: rq.mode, recvOut: q.recvOut }), rq);
    if (!R) {
      N.missing('recv.flow', 'Объём ресивера не рассчитан: у компрессоров не указана производительность');
      return;
    }
    const M = N.rule('receiver.method');
    const Rv = q.units.filter(u => u.kind === 'receiver');
    ReceiverSizing.priorities(N, R, M, rq);
    ReceiverSizing.advice(N, R, Rv);
    for (const c of R.checks) N.issue(c.level, c.text);
    if (!Rv.length) N.issue('warn', `Ресиверов в составе нет — нужно: ${ReceiverPlan.text(R)}.`);
    ReceiverSizing.vessels(N, Rv, R.bar);
  }

  static priorities(N, R, M, rq) {
    N.step({
      what: 'Приоритет 1. Цикл нагрузки/разгрузки (не более 10–15 циклов в час)',
      formula: `V = Q / (${M.cycles} · ΔP)`,
      rules: ['receiver.method', ...(rq.dp > 0 ? [] : ['pressure.band'])],
      data: [
        ['Q — наибольший компрессор', `${R.big.name} — ${f(R.Q)} м³/мин`],
        ['ΔP (разгрузка − нагрузка)', `${f(R.dp)} бар${rq.dp > 0 ? '' : ' (по правилу, не задан)'}`],
      ],
      result: `V = ${l(R.V.p1)} л`,
    });
    if (R.V.p2 != null) {
      N.step({
        what: 'Приоритет 2. Пиковый разбор по циклограмме',
        formula: 'V = T · (C − S) · Pa / (P1 − P2)',
        rules: ['receiver.method'],
        data: [
          ['T — длительность пика', `${f(R.cyc.T)} мин`],
          ['C — расход в пике', `${f(R.cyc.C)} м³/мин`],
          ['S — подача рабочих компрессоров', `${f(R.S)} м³/мин`],
          ['Pa', `${f(M.pa)} бар`],
          ['P1 − P2', `${f(R.cyc.drop)} бар`],
        ],
        result: R.cyc.C > R.S ? `V = ${l(R.V.p2)} л` : 'компрессоры покрывают пик (C ≤ S): V = 0',
      });
    }
    if (R.V.p3 != null) {
      N.step({
        what: 'Приоритет 3. Базовый буфер (поршневой компрессор, циклограммы нет)',
        formula: 'V ≥ 1 · Q (поршневой компрессор)',
        rules: ['receiver.method'],
        data: [['Q', `${f(R.Q)} м³/мин = ${l(R.Q * 1000)} л/мин`]],
        result: `V = ${l(R.V.p3)} л`,
      });
    }
  }

  static advice(N, R, Rv) {
    N.step({
      what: 'Теоретически необходимый суммарный объём',
      formula: `винтовой — по циклу (приоритет 1), с циклограммой — не меньше пикового разбора (2), поршневой — не меньше базового буфера (3)${R.V.tz ? ', не меньше объёма по ТЗ' : ''}`,
      data: R.V.tz ? [['по ТЗ', `${l(R.V.tz)} л`]] : [],
      result: `V = ${l(R.theor)} л — сработал приоритет ${ReceiverPlan.PRIO[R.prio]}`,
    });
    N.step({
      what: 'Рекомендация',
      formula:
        'ряд 500 → 900 → 1 800 → 2 700 → …: объём ресивера кратно 900 л, 500 л — только при крайней необходимости; число — наименьшее допустимое: не меньше 80 % нужного и 15 % минутной производительности; мокрый — при риске проскока влаги или если задан',
      rules: ['receiver.method'],
      data: [
        ['основной', R.main.why],
        ...(R.wet ? [['мокрый (30–50 % основного)', R.wet.why]] : []),
        ...(R.local ? [['у потребителя', R.local.why]] : []),
      ],
      result: ReceiverPlan.text(R),
      pick: Rv.map(u => u.name + (u.qty > 1 ? ` × ${u.qty}` : '')).join('; '),
    });
    const E = R.checks;
    let ok = E.length ? null : true;
    if (E.some(c => c.level === 'error')) ok = false;
    N.step({
      what: `Проверки «на здравый смысл»${Rv.length ? ' (по составу)' : ' (по рекомендации)'}`,
      formula:
        'запас 80–200 %; 15 % — 5-кратная минутная производительность; запас по давлению; «мёртвый объём»; ряд 900/500; осушитель',
      rules: ['receiver.method'],
      data: E.map(c => [c.level === 'error' ? 'ошибка' : 'предупреждение', c.text]),
      result: E.length ? `сработало: ${E.length}` : 'Все проверки пройдены.',
      ok,
    });
  }

  /** Учёт в Ростехнадзоре: p · V больше vessel.pv (ФНП ОРПД). */
  static vessels(N, Rv, bar) {
    const pv = N.rule('vessel.pv');
    for (const u of Rv) {
      const v = u.info.vol || 0;
      const x = ((bar / 10) * v) / 1000;
      if (v > 0 && bar > 0) {
        N.step({
          what: `Учёт в Ростехнадзоре: ${u.name}`,
          formula: `p · V ≤ ${f(pv)} МПа·м³`,
          rules: ['vessel.pv'],
          data: [
            ['p', `${f(bar / 10, 2)} МПа`],
            ['V', `${f(v / 1000, 3)} м³`],
          ],
          result: `p·V = ${f(x, 3)}`,
          ok: x <= pv + 1e-9,
        });
      }
      if (x > pv + 1e-9)
        N.issue('warn', `${u.name}: p·V = ${f(x, 3)} МПа·м³ — подлежит учёту в Ростехнадзоре (ФНП ОРПД).`);
    }
  }
}
