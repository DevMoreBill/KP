import { StationEquip } from '../layout/station-equip.js';
import { StationLayout } from '../layout/station-layout.js';
import { TzPick } from './tz-pick.js';
import { StationUi } from '../station/station-ui.js';
import { Kit } from '../kit/kit.js';
import { StationReq } from '../req/station-req.js';

/** Подбор, при котором станция помещается в контейнер в габарите перевозки: число агрегатов, ресиверы по 500 л, снаружи. */
export class TzFit {
  /**
   * Подбор, при котором станция помещается в контейнер: для 1 … MAX одинаковых компрессоров — ресиверы 900 л внутри,
   * по 500 л внутри, затем снаружи; иначе — ресиверы вплотную, негабарит или подсказка разделить станцию.
   */
  static async fit(station, need) {
    need = this._reset(station, need);
    const note = await TzPick.pick(station, need);
    if (need.work || need.kind !== 'comp' || !(need.flow > 0)) return note;
    const req = StationReq.ensure(station);
    const main = this._main(station);
    const job = {
      station,
      need,
      req,
      outside0: !!req.recvOut,
      size0: !!req.recvSize,
      units0: main ? main.qty - TzPick._res(need) : 1,
      tried500: false,
      hadReceivers: true,
    };
    const state = this._state(station);
    if (state === 'ok') return note;
    job.first = this._keep(station, note, { units: job.units0, outside: job.outside0, by500: false });
    job.wide = state === 'wide' ? job.first : null;
    job.close = state === 'close' ? job.first : null;
    return (await this._try(job)) || this._last(job);
  }

  /** «Снаружи» и «по 500 л», выбранные программой, — каждый подбор заново. */
  static _reset(station, need) {
    const req = StationReq.ensure(station);
    if (req.recvSizeAuto) this._clearSize(req);
    if (!req.recvOutAuto) return need;
    this._clearOut(req);
    return { ...need, recvOut: false };
  }

  static _clearOut(req) {
    delete req.recvOut;
    delete req.recvOutAuto;
  }

  static _clearSize(req) {
    delete req.recvSize;
    delete req.recvWhy;
    delete req.recvSizeAuto;
  }

  static _main(station) {
    return Kit.parts(station).find(part => part.role === 'main');
  }

  /** Как встала станция: bad — ошибка или нет агрегата, wide — негабарит, close — ресиверы вплотную, ok. */
  static _state(station) {
    if (!this._main(station)) return 'bad';
    const plan = StationLayout.solve(StationUi.input(station));
    if (plan.level === 'error') return 'bad';
    const issues = plan.issues || [];
    return ['wide', 'close'].find(key => issues.some(issue => issue[key])) || 'ok';
  }

  /** Снимок состава с вариантом {units — агрегатов, outside — ресиверы снаружи, by500 — ресиверы по 500 л}. */
  static _keep(station, note, variant) {
    return { parts: JSON.parse(JSON.stringify(station.kit.parts)), note, ...variant };
  }

  static _set(job, { outside, by500 }) {
    const { req } = job;
    if (outside) Object.assign(req, { recvOut: true, recvOutAuto: true });
    else if (!job.outside0) this._clearOut(req);
    if (by500) Object.assign(req, { recvSize: '500', recvWhy: 'space', recvSizeAuto: true });
    else if (req.recvSizeAuto) this._clearSize(req);
  }

  /** Варианты по порядку: внутри 900 л, внутри по 500 л (если типоразмер не задан менеджером), снаружи. */
  static _tries(job) {
    const tries = [];
    if (!job.outside0)
      for (let units = job.units0; units <= TzPick.MAX; units++) {
        tries.push({ units, outside: false, by500: false });
        if (!job.size0) tries.push({ units, outside: false, by500: true });
      }
    for (let units = job.units0; units <= TzPick.MAX; units++) tries.push({ units, outside: true, by500: false });
    return tries;
  }

  static async _try(job) {
    for (const variant of this._tries(job)) {
      if (variant.by500 && !job.hadReceivers) continue; // в предыдущем варианте не было ресиверов — «по 500 л» не нужен
      if (variant.outside && job.close) break; // вплотную внутри лучше, чем снаружи
      const step = await this._step(job, variant);
      if (!this._counts(job, step, variant)) continue;
      step.kept.tried500 = job.tried500;
      if (step.state === 'ok') return this._note(step.kept, job.units0, 'ok');
      if (step.state === 'close') job.close ??= step.kept;
      if (step.state === 'wide') job.wide ??= step.kept;
    }
    return null;
  }

  /** Вариант «по 500 л» без ресиверов (их нет в каталоге) не годится. */
  static _counts(job, step, variant) {
    if (!variant.by500) {
      job.hadReceivers = step.dryReceivers;
      return true;
    }
    if (!step.dryReceivers) return false;
    job.tried500 = true;
    return true;
  }

  static async _step(job, variant) {
    this._set(job, variant);
    const note = await TzPick.pick(job.station, {
      ...job.need,
      work: variant.units,
      compact: true,
      recvOut: variant.outside,
    });
    const state = this._state(job.station);
    const kept = this._keep(job.station, note, variant);
    const dryReceivers = Kit.parts(job.station).some(
      part => StationEquip.kindOf(part) === 'receiver' && part.recvRole !== 'local' && part.recvRole !== 'wet',
    );
    return { state, kept, dryReceivers };
  }

  static _last(job) {
    const kept = job.close || job.wide || job.first;
    job.station.kit.parts = kept.parts;
    this._set(job, { outside: kept.outside && !job.outside0, by500: kept.by500 });
    if (job.close) return this._note(kept, job.units0, 'close');
    if (job.wide) return this._note(kept, job.units0, 'wide');
    return `${kept.note}. Станция не помещается в один контейнер даже из ${TzPick.MAX} одинаковых агрегатов${job.tried500 ? ', с ресиверами по 500 л' : ''} и с ресиверами снаружи — разделите её на две станции (по половине производительности) или задайте контейнер вручную`;
  }

  /** Уведомление о том, как станция встала в контейнер; how — ok, close (ресиверы вплотную) или wide (негабарит). */
  static _note(kept, units0, how) {
    const why = [];
    if (kept.units > units0) why.push(`подобрано ${kept.units} одинаковых`);
    if (how === 'close')
      why.push('ресиверы и фильтры — вплотную друг к другу (исключение: иначе ресиверы пришлось бы выносить наружу)');
    if (kept.by500)
      why.push(
        'ресиверы — по 500 л (без учёта в Ростехнадзоре): с ресиверами 900 л станция не помещается в габарит перевозки',
      );
    if (kept.outside)
      why.push(
        `ресиверы — снаружи у стены станции (ФНП ОРПД, п. 65): внутри в габарите перевозки не помещаются${kept.tried500 ? ' — ни по 900 л, ни по 500 л' : ''}, хотя компоновка пробует два ряда, пары, поворот и плотные отступы`,
      );
    if (how === 'wide') why.push('ширина больше габарита перевозки — негабарит (исключение)');
    return why.length
      ? `${kept.note}. Одним ${units0 > 1 ? 'набором' : 'агрегатом'} со всем оборудованием внутри станция не помещается в контейнер в габарите перевозки — ${why.join('; ')}`
      : kept.note;
  }
}
