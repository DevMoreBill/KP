import { S } from '../../core/state.js';
import { Kit } from '../../core/kit.js';
import { CoverHint } from '../../core/cover-hint.js';
import { CatalogSession } from './catalog-session.js';

/**
 * Заголовок КП по оборудованию: пока менеджер не правил поля сам (cover.touched), они соответствуют текущим позициям —
 * при замене, удалении или перестановке оборудования обновляются; КП без позиций — пустые.
 */
export class CoverSync {
  static KPIS = 4;

  /** Обновить титул по оборудованию. */
  static run() {
    if (CatalogSession.current || S.cover.touched) return;
    const named = item => String(item.name || '').trim();
    const item = S.items.find(one => one.id === S.cover.photoFrom && named(one)) || S.items.find(named);
    const hint = item ? this._hint(item) : { title: '', model: '', desc: '', kpis: [] };
    const key = JSON.stringify(hint);
    if (S.cover._src === key) return;
    const cover = S.cover;
    cover.title = hint.title || '';
    cover.model = hint.model || '';
    cover.desc = hint.desc || '';
    cover.kpis = Array.from({ length: this.KPIS }, (_, j) => {
      const kpi = (hint.kpis || [])[j];
      return { num: kpi?.num || '', unit: kpi?.unit || '', cap: kpi?.cap || '' };
    });
    S.cover._src = key;
  }

  static _hint(item) {
    return item.hint && !Kit.station(item) ? item.hint : CoverHint.of(item);
  }
}
