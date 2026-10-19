import { AirChain } from '../layout/air-chain.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { AirDemand } from './air-demand.js';
import { CalcInput } from './calc-input.js';
import { CalcNote } from './calc-note.js';

const f = CalcNote.f;
const each = U => U.flatMap(u => Array.from({ length: u.qty }, () => u));
const prpOf = u => CalcInput.num(u.attrs.kw) || 0;
const tankVol = u => AirChain.volume(u.p) || CalcInput.num(u.attrs.tank) || 0;

/** ДГУ: мощность PRP/ESP против нагрузки, средняя и малая нагрузка, высота и жара, пуск двигателя, топливо. */
export class GensetSizing {
  /** Наибольший бак в отсеке контейнера, л (раздел tank матрицы). */
  static get TANK_MAX() {
    return StationMatrix.tank().max;
  }

  /** Расход топлива при доле нагрузки x, л/ч: строки «При нагрузке N %» / «Расход топлива при N % нагрузки»; нет — null. */
  static fuel(u, x) {
    const T = [];
    for (const r of u.rows || []) {
      const m = String((r && r.k) || '').match(/(\d{2,3})\s*%/);
      const v =
        m && /нагрузк/i.test(String(r.k)) && /л\s*\/\s*ч/i.test(`${String(r.k)} ${String(r.v)}`)
          ? AirChain.first(r.v)
          : null;
      if (v > 0) T.push([+m[1] / 100, v]);
    }
    T.sort((a, b) => a[0] - b[0]);
    return T.length >= 2 || (T.length === 1 && Math.abs(T[0][0] - x) < 0.01) ? StationRules.interp(T, x) : null;
  }

  /** Мощность, кВт: основной источник — PRP; резервный — ESP, нет ESP — PRP (в запас). */
  static cap(attrs, standby) {
    const prp = CalcInput.num((attrs || {}).kw) || 0;
    const esp = CalcInput.num((attrs || {}).kwMax) || 0;
    return standby && esp > 0 ? esp : prp;
  }

  /** Полная мощность генератора, кВА: паспорт, нет — PRP / cos φ ном. */
  static kva(attrs) {
    const k = CalcInput.num((attrs || {}).kva) || 0;
    const prp = CalcInput.num((attrs || {}).kw) || 0;
    if (k > 0) return { v: k, src: 'паспорт' };
    return prp > 0 ? { v: prp / StationRules.raw('dgu.cos'), src: 'по мощности' } : { v: 0, src: '' };
  }

  /** Топливо на автономность: расход рабочих ДГУ при доле нагрузки, с запасом; есть — баки ДГУ и дополнительные. */
  static fuelPlan(q) {
    const r = q.req;
    const G = q.units.filter(u => u.kind === 'dgu');
    if (!G.length || !(r.hours > 0)) return null;
    const U = each(G)
      .map(u => ({ u, prp: prpOf(u) }))
      .sort((a, b) => b.prp - a.prp);
    const work = U.slice(r.reserve != null ? Math.min(r.reserve, U.length - 1) : 0);
    const PRP = work.reduce((s, o) => s + o.prp, 0);
    if (!(PRP > 0)) return null;
    const x =
      r.kw > 0 ? Math.min(1.1, (r.load > 0 ? (r.kw * r.load) / 100 : r.kw) / PRP) : StationRules.raw('dgu.fuel_load');
    let c = 0;
    let src = 'паспорт ДГУ';
    for (const o of work) {
      const v = GensetSizing.fuel(o.u, x);
      if (v == null) src = 'удельный расход (правило)';
      c += v != null ? v : StationRules.raw('dgu.lph') * x * o.prp;
    }
    const built = G.reduce((s, u) => s + GensetSizing.tank(u) * u.qty, 0);
    const extra = q.units.filter(u => u.kind === 'tank').reduce((s, u) => s + tankVol(u) * u.qty, 0);
    return {
      x,
      c,
      src,
      n: work.length,
      need: c * r.hours * StationRules.raw('dgu.fuel_margin'),
      built,
      extra,
      have: built + extra,
    };
  }

  static plan(x) {
    return GensetSizing.fuelPlan(CalcInput.of(x));
  }

  static tank(u) {
    const r = CalcInput.row(
      u,
      /^(?:встроенн\S*\s+)?топливн\S*\s+бак|объ[её]м\s+(?:топливного\s+)?бака|[её]мкость\s.*бака/i,
      /(?:^|[^а-я])л(?:[^а-я]|$)/i,
    );
    return r ? r.v : CalcInput.num(u.attrs.tank) || 0;
  }

  static run(N, q, E) {
    const r = q.req;
    const G = q.units.filter(u => u.kind === 'dgu');
    N.section('dgu', 'ДГУ');
    if (!G.length) {
      N.issue('error', 'В составе нет ДГУ.');
      return;
    }
    const standby = /standby|резерв|аварийн/i.test(r.mode || '');
    const units = each(G)
      .map(u => {
        const k = GensetSizing.kva(u.attrs);
        return {
          u,
          prp: prpOf(u),
          esp: CalcInput.num(u.attrs.kwMax) || 0,
          cap: GensetSizing.cap(u.attrs, standby),
          kva: k.v,
          ksrc: k.src,
        };
      })
      .sort((a, b) => b.prp - a.prp);
    const res = r.reserve != null ? Math.min(r.reserve, units.length - 1) : 0;
    const work = units.slice(res);
    const sum = k => work.reduce((s, o) => s + o[k], 0);
    const g = { G, work, res, standby, PRP: sum('prp'), CAP: sum('cap'), KVA: sum('kva') };
    GensetSizing.inputs(N, r, units, g);
    if (r.kw > 0 && g.CAP > 0) GensetSizing.power(N, r, g);
    GensetSizing.site(N, r);
    if (r.motor > 0 || (E && E.Sst)) GensetSizing.start(N, r, E, g);
    GensetSizing.fuelStep(N, q);
  }

  static inputs(N, r, units, { work, standby }) {
    if (r.reserve == null)
      N.missing('dgu.reserve.tz', 'Резерв ДГУ в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный ДГУ (N+1)?');
    for (const nm of new Set(units.filter(o => !(o.prp > 0)).map(o => o.u.name))) {
      N.issue(
        'warn',
        `У «${nm}» в карточке не указана мощность (PRP) — проверки мощности, нагрузки и топлива по нему не выполнены; заполните карточку.`,
      );
    }
    if (standby && work.some(o => o.prp > 0 && !(o.esp > 0)))
      N.assume('Мощность ESP (резервный режим) в карточке ДГУ не указана — для проверки взята PRP (в запас).');
    if (!(r.kw > 0)) {
      N.issue('info', 'Мощность нагрузки не задана — проверка мощности ДГУ не выполнена.');
      N.ask('Мощность нагрузки ДЭС, кВт (длительная и максимальная).');
    }
  }

  /** PRP (или ESP для резервного источника) против нагрузки; средняя нагрузка — не больше 70 % PRP и не меньше малой. */
  static power(N, r, { G, work, res, standby, CAP, PRP }) {
    const fit = N.fits(CAP, r.kw);
    const rid = standby ? 'dgu.esp_hours' : 'dgu.prp_avg';
    N.step({
      what: standby ? 'Мощность ESP (резервный источник) против нагрузки' : 'Мощность PRP против нагрузки',
      formula: 'Σ Pраб ≥ Pнагр',
      rules: [rid],
      data: [
        ['нагрузка', `${f(r.kw, 0)} кВт`],
        ['рабочих ДГУ', work.length + (res ? ` (+${res} резерв)` : '')],
        ...work
          .slice(0, 4)
          .map(o => ['ДГУ', `${o.u.name} — PRP ${f(o.prp, 0)}${o.esp > 0 ? ` / ESP ${f(o.esp, 0)}` : ''} кВт`]),
      ],
      result: `${standby ? 'ESP = ' : 'PRP = '}${f(CAP, 0)} кВт`,
      ok: fit.ok,
      margin: CalcNote.pct(CAP, r.kw),
      note: fit.note,
      pick: [...new Set(G.map(u => u.name))].join('; '),
    });
    N.rule(rid);
    if (!fit.ok) N.issue('error', `Мощность ДГУ ${f(CAP, 0)} кВт меньше нагрузки ${f(r.kw, 0)} кВт.`);
    const avg = r.load > 0 ? (r.kw * r.load) / 100 : r.kw;
    const lim = N.rule('dgu.prp_avg') * PRP;
    const low = N.rule('dgu.minload') * PRP;
    if (!standby && PRP > 0) GensetSizing.average(N, r, { avg, lim, low });
  }

  static average(N, r, { avg, lim, low }) {
    N.step({
      what: 'Средняя нагрузка за 24 ч',
      formula: 'Pср ≤ 0,7 · PRP',
      rules: ['dgu.prp_avg'],
      data: [
        [
          'Pср',
          `${f(avg, 0)} кВт${r.load > 0 ? ` (${f(r.load, 0)} % от нагрузки)` : ' (график не задан — принята постоянной)'}`,
        ],
      ],
      result: `0,7 · PRP = ${f(lim, 0)} кВт`,
      ok: avg <= lim + 1e-9 ? true : null,
    });
    if (!(r.load > 0)) N.ask('График нагрузки за сутки: средняя нагрузка, % от максимальной.', true);
    if (avg > lim + 1e-9) {
      N.issue(
        'warn',
        `Средняя нагрузка ${f(avg, 0)} кВт больше 70 % PRP (${f(lim, 0)} кВт): для постоянной круглосуточной нагрузки нужна мощность COP (уточните у производителя) или больше ДГУ.`,
      );
    }
    if (avg < low - 1e-9) {
      N.issue(
        'warn',
        `Средняя нагрузка ${f(avg, 0)} кВт меньше ${Math.round(N.rule('dgu.minload') * 100)} % PRP (${f(low, 0)} кВт): длительная работа на малой нагрузке ведёт к нагарообразованию — уточните у изготовителя минимальную нагрузку или подберите ДГУ меньшей мощности.`,
      );
    }
  }

  /** Выше базовых условий изготовителя (dgu.site) — мощность снижается по его таблице (в каталоге нет). */
  static site(N, r) {
    const site = N.rule('dgu.site');
    const hot = r.tmax != null && r.tmax > site.t;
    const high = (r.alt || 0) > site.alt;
    if (!hot && !high) return;
    const where = [high ? `высота ${f(r.alt, 0)} м` : '', hot ? `до +${f(r.tmax, 0)} °C` : '']
      .filter(Boolean)
      .join(', ');
    N.issue(
      'warn',
      `Условия площадки (${where}) выше базовых условий изготовителей ДГУ (до ${f(site.alt, 0)} м и +${f(site.t, 0)} °C): мощность снижается по таблице изготовителя — в каталоге её нет; проверьте запас мощности по паспорту.`,
    );
    N.missing('dgu.derate', 'Снижение мощности ДГУ по высоте и температуре — по таблице изготовителя (в каталоге нет)');
    N.step({
      what: 'Высота и температура площадки',
      formula: 'местные условия против базовых условий изготовителя',
      rules: ['dgu.site', 'dgu.ref'],
      data: [
        ['высота', `${f(r.alt || 0, 0)} м → ${f(AirDemand.baro(r.alt || 0), 1)} кПа`],
        ['до', r.tmax != null ? `${f(r.tmax, 0)} °C` : 'не задано'],
      ],
      result: 'требуется снижение мощности по данным изготовителя',
      ok: null,
    });
  }

  /** Пуск наибольшего двигателя от ДГУ: Sпуск = k · P / (cos φ · η); провал напряжения — по ISO 8528-5. */
  static start(N, r, E, { work, KVA }) {
    const K = N.rule('el.start');
    const how = r.start && K[r.start] ? r.start : (E && E.how) || '';
    const cos = N.rule('el.cos');
    const eta = N.rule('el.eta');
    const P = r.motor > 0 ? r.motor : E.kw;
    const k = how ? K[how] : K.default;
    const S = (k * P) / (cos * eta);
    const ratio = KVA > 0 ? S / KVA : null;
    const dip = N.rule('dgu.dip');
    const byKw = work.some(o => o.ksrc === 'по мощности');
    if (byKw)
      N.assume(
        `Полная мощность генератора в карточке ДГУ не указана — принята PRP / ${f(N.rule('dgu.cos'), 2)} (cos φ ном.).`,
      );
    if (!how) N.missing('dgu.start', 'Способ пуска двигателя нагрузки не указан — принят прямой');
    N.step(GensetSizing.startStep({ P, k, KVA, byKw, S, ratio, dip }));
    N.missing(
      'dgu.skva',
      'Способность генератора к пуску двигателей (кВА пуска при допустимом провале) — по паспорту генератора',
    );
    if (ratio != null && ratio > 1) {
      N.issue(
        'warn',
        `Пусковая мощность двигателя ≈ ${f(S, 0)} кВА больше мощности генератора ${f(KVA, 0)} кВА — нужен плавный пуск или частотный преобразователь, либо ДГУ больше (проверить по паспорту генератора).`,
      );
    }
  }

  static startStep({ P, k, KVA, byKw, S, ratio, dip }) {
    return {
      what: 'Пуск наибольшего двигателя от ДГУ',
      formula: 'Sпуск = k · P / (cos φ · η)',
      rules: ['el.start', 'dgu.dip'],
      data: [
        ['P', `${f(P, 1)} кВт`],
        ['k', f(k, 1)],
        ['генератор', KVA > 0 ? `${f(KVA, 0)} кВА${byKw ? ' (по мощности)' : ''}` : 'мощность не указана'],
      ],
      result: `Sпуск ≈ ${f(S, 0)} кВА${ratio != null ? ` (${f(ratio * 100, 0)} % мощности генератора)` : ''}`,
      ok: null,
      note: `Допустимый провал напряжения по ISO 8528-5: G1 — ${dip.G1} %, G2 — ${dip.G2} %, G3 — ${dip.G3} %. Проверка — по паспорту генератора (кВА пуска при провале), в каталоге этих данных нет.`,
    };
  }

  /** Запас топлива на автономность против баков; дополнительный бак больше отсека — предупреждение. */
  static fuelStep(N, q) {
    const fp = GensetSizing.fuelPlan(q);
    if (!fp) return;
    const r = q.req;
    const passport = fp.src === 'паспорт ДГУ';
    N.rule('dgu.fuel_margin');
    if (!passport) N.rule('dgu.lph');
    if (!(r.kw > 0)) N.rule('dgu.fuel_load');
    const { need, have } = fp;
    N.step({
      what: 'Запас топлива на автономность',
      formula: 'V = Σ расход рабочих ДГУ(нагрузка) · часы · запас',
      rules: ['dgu.fuel_margin', passport ? '' : 'dgu.lph', r.kw > 0 ? '' : 'dgu.fuel_load'],
      data: [
        ['нагрузка', `${f(fp.x * 100, 0)} % PRP`],
        ['расход', `${f(fp.c, 1)} л/ч, все рабочие ДГУ (${fp.src})`],
        ['рабочих ДГУ', String(fp.n)],
        ['часы', f(r.hours, 0)],
        ['баки', `ДГУ ${f(fp.built, 0)} л + дополнительные ${f(fp.extra, 0)} л`],
      ],
      result: `нужно ${f(need, 0)} л; в баках ${f(have, 0)} л`,
      ok: N.fits(have, need).ok,
      margin: CalcNote.pct(have, need),
      note: N.fits(have, need).note,
    });
    if (!N.fits(have, need).ok)
      N.issue('error', `Топлива в баках ${f(have, 0)} л — меньше нужного на ${f(r.hours, 0)} ч (${f(need, 0)} л).`);
    const big = q.units
      .filter(u => u.kind === 'tank')
      .map(tankVol)
      .filter(v => v > GensetSizing.TANK_MAX);
    if (big.length) {
      N.issue(
        'warn',
        `Дополнительный бак ${f(Math.max(...big), 0)} л больше ${f(GensetSizing.TANK_MAX, 0)} л (3 000 × 1 000 × 1 500 мм) — в отсеке не поместится одним баком: два бака или бак вне контейнера.`,
      );
    }
  }
}
