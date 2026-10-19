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
    const M = StationMatrix.modes();
    const both = M.cross && M.tight ? [{ cross: true, tight: true }] : [];
    return [
      {},
      ...(M.ends ? [{ ends: true }] : []),
      ...(M.tight ? [{ tight: true }] : []),
      ...(M.cross ? [{ cross: true }] : []),
      ...both,
    ];
  }

  static aisle(aisle0, m) {
    return m.tight ? [aisle0[0], Math.min(aisle0[1], LayoutMode.TIGHT)] : aisle0;
  }

  /** Плотность подобранного размера (названия — как у готовых наборов правил). */
  static density(lw, m, r, wide) {
    const md = { ...(m || {}), ...(r.mode || {}) };
    const ex = [
      md.ends && 'без продольного прохода',
      md.tight && 'проход в крайнем случае',
      md.cross && 'агрегат поперёк',
    ].filter(Boolean);
    const roomy = lw === 0 || !(r.issues || []).some(i => /рекоменд/i.test(i.text));
    let d = { id: 'dense', title: 'Плотно', text: 'допустимые отступы и проход' };
    if (ex.length) d = { id: 'max', title: 'Максимально плотно', text: ex.join(', ') };
    else if (roomy) d = { id: 'roomy', title: 'Просторно', text: 'рекомендуемые отступы и проход' };
    if (wide) d.text += ', негабарит по ширине';
    return d;
  }

  /** «Плотно» по умолчанию: отступы меньше рекомендуемых, но не меньше допустимых — сведения, а не предупреждения. */
  static soft(r) {
    if (!StationMatrix.fit().dense) return r;
    for (const i of r.issues || []) {
      if (i.level === 'warn' && !i.wide && /рекоменд/.test(i.text) && !/исключение/i.test(i.text)) i.level = 'info';
    }
    if (r.level === 'warn' && !r.issues.some(i => i.level === 'warn')) r.level = 'ok';
    return r;
  }

  /** Положение ворот в торце одной фразой: по оси торца или смещены — на сколько и почему. */
  static gateAxis(q) {
    if (!q || q.sea) return '';
    if (q.full) return 'Ворота во весь торец — по оси торца.';
    if (!q.off) return 'Ворота — по оси торца.';
    const why = q.offWhy
      ? ` — ${q.manual ? 'причина: ' : ''}${q.offWhy.replace(/^смещены на \S+ мм от оси торца /, '')}`
      : ' — причина не указана';
    return `Ворота смещены от оси торца на ${Mm.text(Math.abs(q.off))} мм${why}.`;
  }
}
