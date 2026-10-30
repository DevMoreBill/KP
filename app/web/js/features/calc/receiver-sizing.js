import { ReceiverPlan } from '../layout/receiver-plan.js';
import { StationEquip } from '../layout/station-equip.js';
import { CalcNote } from './calc-note.js';

/** Ресиверы по методике ПНЕВМОТЕХ (ReceiverPlan): приоритеты 1–3, рекомендация, проверки; учёт в Ростехнадзоре. */
export class ReceiverSizing {
  static _liters = value => CalcNote.fmt(value, 0);
  /** Ресиверы по методике ПНЕВМОТЕХ и учёт в Ростехнадзоре. */
  static run(note, input) {
    if (!input.units.some(unit => unit.kind === 'compressor')) return;
    note.section('recv', 'Ресиверы');
    const recvIn = input.recvIn || {};
    const plan = ReceiverPlan.from(
      StationEquip.list(input.parts, { recv: recvIn.mode, recvOut: input.recvOut }),
      recvIn,
    );
    if (!plan) {
      note.missing('recv.flow', 'Объём ресивера не рассчитан: у компрессоров не указана производительность');
      return;
    }
    const method = note.rule('receiver.method');
    const receivers = input.units.filter(unit => unit.kind === 'receiver');
    ReceiverSizing._priorities(note, plan, method, recvIn);
    ReceiverSizing._advice(note, plan, receivers);
    for (const check of plan.checks) note.issue(check.level, check.text);
    if (!receivers.length) note.issue('warn', `Ресиверов в составе нет — нужно: ${ReceiverPlan.text(plan)}.`);
    ReceiverSizing.vessels(note, receivers, plan.bar);
  }

  static _priorities(note, plan, method, recvIn) {
    note.step({
      what: 'Приоритет 1. Цикл нагрузки/разгрузки (не чаще 1 цикла за 30 с, Atlas Copco)',
      formula: `V = Q / (${method.cycles} · ΔP)`,
      rules: ['receiver.method', ...(recvIn.dp > 0 ? [] : ['pressure.band'])],
      data: [
        ['Q — наибольший компрессор', `${plan.big.name} — ${CalcNote.fmt(plan.Q)} м³/мин`],
        ['ΔP (разгрузка − нагрузка)', `${CalcNote.fmt(plan.dp)} бар${recvIn.dp > 0 ? '' : ' (по правилу, не задан)'}`],
      ],
      result: `V = ${ReceiverSizing._liters(plan.V.p1)} л`,
    });
    if (plan.V.p2 != null) {
      note.step({
        what: 'Приоритет 2. Пиковый разбор по циклограмме',
        formula: 'V = T · (C − S) · Pa / (P1 − P2)',
        rules: ['receiver.method'],
        data: [
          ['T — длительность пика', `${CalcNote.fmt(plan.cyc.T)} мин`],
          ['C — расход в пике', `${CalcNote.fmt(plan.cyc.C)} м³/мин`],
          ['S — подача рабочих компрессоров', `${CalcNote.fmt(plan.S)} м³/мин`],
          ['Pa', `${CalcNote.fmt(method.pa)} бар`],
          ['P1 − P2', `${CalcNote.fmt(plan.cyc.drop)} бар`],
        ],
        result:
          plan.cyc.C > plan.S
            ? `V = ${ReceiverSizing._liters(plan.V.p2)} л`
            : 'компрессоры покрывают пик (C ≤ S): V = 0',
      });
    }
    if (plan.V.p3 != null) {
      note.step({
        what: 'Приоритет 3. Базовый буфер (поршневой компрессор, циклограммы нет)',
        formula: 'V ≥ 1 · Q (поршневой компрессор)',
        rules: ['receiver.method'],
        data: [['Q', `${CalcNote.fmt(plan.Q)} м³/мин = ${ReceiverSizing._liters(plan.Q * 1000)} л/мин`]],
        result: `V = ${ReceiverSizing._liters(plan.V.p3)} л`,
      });
    }
  }

  static _advice(note, plan, receivers) {
    note.step({
      what: 'Теоретически необходимый суммарный объём',
      formula: `винтовой — по циклу (приоритет 1), с циклограммой — не меньше пикового разбора (2), поршневой — не меньше базового буфера (3)${plan.V.tz ? ', не меньше объёма по ТЗ' : ''}`,
      data: plan.V.tz ? [['по ТЗ', `${ReceiverSizing._liters(plan.V.tz)} л`]] : [],
      result: `V = ${ReceiverSizing._liters(plan.theor)} л — сработал приоритет ${ReceiverPlan.PRIO[plan.prio]}`,
    });
    note.step({
      what: 'Рекомендация',
      formula:
        'ряд 500 → 900 → 1 800 → 2 700 → …: объём ресивера кратно 900 л, 500 л — только при крайней необходимости; число — наименьшее допустимое: не меньше 80 % нужного и 15 % минутной производительности; мокрый — при риске проскока влаги или если задан',
      rules: ['receiver.method'],
      data: [
        ['основной', plan.main.why],
        ...(plan.wet ? [['мокрый (30–50 % основного)', plan.wet.why]] : []),
        ...(plan.local ? [['у потребителя', plan.local.why]] : []),
      ],
      result: ReceiverPlan.text(plan),
      pick: receivers.map(unit => unit.name + (unit.qty > 1 ? ` × ${unit.qty}` : '')).join('; '),
    });
    const checks = plan.checks;
    let ok = checks.length ? null : true;
    if (checks.some(check => check.level === 'error')) ok = false;
    note.step({
      what: `Проверки «на здравый смысл»${receivers.length ? ' (по составу)' : ' (по рекомендации)'}`,
      formula:
        'запас 80–200 %; 15 % — 5-кратная минутная производительность; запас по давлению; «мёртвый объём»; ряд 900/500; осушитель',
      rules: ['receiver.method'],
      data: checks.map(check => [check.level === 'error' ? 'ошибка' : 'предупреждение', check.text]),
      result: checks.length ? `сработало: ${checks.length}` : 'Все проверки пройдены.',
      ok,
      inner: true, // только на экране: указания менеджеру («Проверить…», «Рассмотреть…»), не для заказчика
    });
  }

  /** Учёт в Ростехнадзоре: p · V больше vessel.pv (ФНП ОРПД). */
  static vessels(note, receivers, bar) {
    const pvRule = note.rule('vessel.pv');
    for (const unit of receivers) {
      const volume = unit.info.vol || 0;
      const station = ((bar / 10) * volume) / 1000;
      if (volume > 0 && bar > 0) {
        note.step({
          what: `Учёт в Ростехнадзоре: ${unit.name}`,
          formula: `p · V ≤ ${CalcNote.fmt(pvRule)} МПа·м³`,
          rules: ['vessel.pv'],
          data: [
            ['p', `${CalcNote.fmt(bar / 10, 2)} МПа`],
            ['V', `${CalcNote.fmt(volume / 1000, 3)} м³`],
          ],
          result: `p·V = ${CalcNote.fmt(station, 3)}`,
          ok: station <= pvRule + 1e-9,
        });
      }
      if (station > pvRule + 1e-9)
        note.issue(
          'warn',
          `${unit.name}: p·V = ${CalcNote.fmt(station, 3)} МПа·м³ — подлежит учёту в Ростехнадзоре (ФНП ОРПД).`,
        );
    }
  }
}
