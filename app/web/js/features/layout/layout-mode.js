import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';

/**
 * Режимы-исключения компрессорной, чтобы станция прошла по габариту перевозки: без продольного прохода (ends), проход
 * «в крайнем случае» (tight), агрегат поперёк со второй дверью (cross). Сначала — обычный режим.
 */
export class LayoutMode {
  /** Проход «в крайнем случае», мм: не уже 600 (решение владельца 12.10). */
  static get TIGHT() {
    return Math.max(600, StationRules.opt('norm.aisle_tight') || 600);
  }

  static list(comp) {
    if (!comp) return [{}];
    const defaults = StationMatrix.modes();
    const both = defaults.cross && defaults.tight ? [{ cross: true, tight: true }] : [];
    return [
      {},
      ...(defaults.ends ? [{ ends: true }] : []),
      ...(defaults.tight ? [{ tight: true }] : []),
      ...(defaults.cross ? [{ cross: true }] : []),
      ...both,
    ];
  }

  static aisle(aisle0, mode) {
    return mode.tight ? [aisle0[0], Math.min(aisle0[1], LayoutMode.TIGHT)] : aisle0;
  }

  /** Плотность подобранного размера (названия — как у готовых наборов правил). */
  static density(looseW, mode, res, wide) {
    const merged = { ...(mode || {}), ...(res.mode || {}) };
    const extras = [
      merged.ends && 'без продольного прохода',
      merged.tight && 'проход в крайнем случае',
      merged.cross && 'агрегат поперёк',
    ].filter(Boolean);
    const roomy = looseW === 0 || !(res.issues || []).some(i => /рекоменд/i.test(i.text));
    let dense = { id: 'dense', title: 'Плотно', text: 'допустимые отступы и проход' };
    if (extras.length) dense = { id: 'max', title: 'Максимально плотно', text: extras.join(', ') };
    else if (roomy) dense = { id: 'roomy', title: 'Просторно', text: 'рекомендуемые отступы и проход' };
    if (wide) dense.text += ', негабарит по ширине';
    return dense;
  }

  /** «Плотно» по умолчанию: отступы меньше рекомендуемых, но не меньше допустимых — сведения, а не предупреждения. */
  static soft(res) {
    if (!StationMatrix.fit().dense) return res;
    for (const i of res.issues || []) {
      if (i.level === 'warn' && !i.wide && /рекоменд/.test(i.text) && !/исключение/i.test(i.text)) i.level = 'info';
    }
    if (res.level === 'warn' && !res.issues.some(i => i.level === 'warn')) res.level = 'ok';
    return res;
  }

  /** Положение ворот в торце одной фразой: по оси торца или смещены — на сколько и почему. */
  static gateAxis(gate) {
    if (!gate || gate.sea) return '';
    if (gate.full) return 'Ворота во весь торец — по оси торца.';
    if (!gate.off) return 'Ворота — по оси торца.';
    const why = gate.offWhy
      ? ` — ${gate.manual ? 'причина: ' : ''}${gate.offWhy.replace(/^смещены на \S+ мм от оси торца /, '')}`
      : ' — причина не указана';
    return `Ворота смещены от оси торца на ${Mm.text(Math.abs(gate.off))} мм${why}.`;
  }
}
