import { Kit } from '../../core/kit.js';
import { KitAir } from './kit-air.js';
import { StationAuto, StationName } from './station-auto.js';
import { StationDefaults } from './station-defaults.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationPlan } from '../req/station-plan.js';
import { StationSize } from './station-size.js';
import { TzFit } from './tz-fit.js';
import { TzPick } from './tz-pick.js';
/** Сборка станции по ТЗ: шкафы, подбор с защитой состава (TzFit), название, характеристики, контейнер. */
export class TzBuild {
  /** Подбор и сборка станции: шкафы по особым требованиям, оборудование, название, характеристики, контейнер. */
  static async assemble(station, need) {
    const added = StationDefaults.ensureParts(station);
    const note = await this.run(station, need);
    Kit.sync(station);
    StationPlan.cache.delete(station.id);
    StationSize.refresh(station);
    StationAuto.fill(station);
    StationName.apply(station);
    return [note, added.length ? `Добавлено по ТЗ: ${added.join(', ')}` : ''].filter(Boolean).join('. ');
  }

  /** Подбор с защитой состава: чего в каталоге не нашлось — прежнее оборудование этого вида остаётся. */
  static async run(station, need) {
    const drop = TzPick.DROP[need.kind] || /^$/;
    const before = Kit.parts(station).filter(
      part => part.role !== 'container' && drop.test(StationEquip.kindOf(part) || ''),
    );
    const note = await TzFit.fit(station, need);
    const kept = this._restore(station, before);
    return kept.length ? `${note}. Оставлено прежнее: ${kept.join('; ')}` : note;
  }

  static _restore(station, before) {
    const kept = [];
    let air = null;
    // фильтры и ресиверы — только если цепочка воздуха их по-прежнему просит
    const need = k => {
      if (k !== 'filter' && k !== 'receiver') return true;
      air ??= StationLayout.solve(StationPlan.input(station)).air || KitAir.of(station) || { recs: [] };
      return (air.recs || []).some(rec => rec.cat === k && !rec.replace);
    };
    for (const k of new Set(before.map(part => StationEquip.kindOf(part)))) {
      if (Kit.parts(station).some(part => StationEquip.kindOf(part) === k) || !need(k)) continue;
      const old = before.filter(part => StationEquip.kindOf(part) === k);
      const index = Kit.parts(station).findIndex(part => part.role === 'container');
      station.kit.parts.splice(index < 0 ? station.kit.parts.length : index, 0, ...old);
      kept.push(...old.map(part => part.name));
    }
    return kept;
  }
}
