import { LayoutMode } from './layout-mode.js';
import { Mm } from './mm.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationTidy } from './station-tidy.js';

const n = v => Mm.text(v);
const warns = r => r.issues.filter(i => i.level === 'warn').map(i => i.text);

/**
 * Уровни подбора: [отступы, промежутки (0 — рекомендуемые, 1 — не менее), что недопустимо]: 'rec' — всё рекомендуемое,
 * 'gate' — без сервисных ворот и с доступом ко всем сторонам, 'acc' — с доступом ко всем сторонам, '' — как вышло.
 */
const LEVELS = {
  fixed: [
    [0, 0, 'rec'],
    [1, 0, ''],
    [1, 1, 'gate'],
    [1, 1, 'acc'],
    [1, 1, ''],
  ],
  dense: [
    [1, 1, 'gate'],
    [1, 1, 'acc'],
    [1, 1, ''],
  ],
  roomy: [
    [0, 0, 'rec'],
    [1, 0, ''],
    [1, 1, ''],
  ],
};

/**
 * Подбор размера блок-контейнера по оборудованию: шаг размеров, наименьшая площадь пола, всегда с проходом; в габарите
 * перевозки — сначала как обычно, затем исключения компрессорной, вплотную, негабарит — последним (если разрешён).
 * Из равных по площади — аккуратнейший; у модулей — модуль с шагом × число модулей.
 */
export class LayoutSize {
  constructor(lay) {
    this.lay = lay;
  }

  /** Размер по оборудованию; ресиверы парами поперёк у торца — если так станция короче хотя бы на fit.recv2. */
  auto(units, geo) {
    const lay = this.lay;
    const r = this.pick(units, geo);
    const receivers = units.filter(e => e.kind === 'receiver' && !e.outside).length;
    if (
      lay.forcePairs ||
      geo.fixL ||
      !r.geo ||
      !r.geo.ext ||
      (r.items || []).some(i => i.pairEnd) ||
      receivers < 2 ||
      !(StationMatrix.fit().recv2 > 0)
    )
      return r;
    let q = null;
    lay.forcePairs = true;
    try {
      q = this.pick(units, geo);
    } finally {
      lay.forcePairs = false;
    }
    if (!this.shorterWithPairs(q, r)) return r;
    q.issues.push({
      level: 'info',
      text: `Ресиверы — частью в два ряда поперёк у торца: станция короче на ${n(r.geo.ext[0] - q.geo.ext[0])} мм (${n(q.geo.ext[0])} вместо ${n(r.geo.ext[0])} мм); отступы — допустимые («не менее»).`,
    });
    return q;
  }

  shorterWithPairs(q, r) {
    if (!q || q.level === 'error' || !q.geo || !q.items.some(i => i.pairEnd)) return false;
    return q.geo.ext[1] <= r.geo.ext[1] && q.geo.ext[0] <= r.geo.ext[0] - StationMatrix.fit().recv2;
  }

  /** Уровни подбора по порядку: [отступы, промежутки, негабарит, режим, что недопустимо, вплотную]. */
  tiers(fixL) {
    const lay = this.lay;
    const F = StationMatrix.fit();
    const levels = (fixL && LEVELS.fixed) || (F.dense ? LEVELS.dense : LEVELS.roomy);
    const out = levels.map(([lw, ll, st]) => [lw, ll, false, {}, st]);
    for (const m of lay
      .modes()
      .slice(1)
      .filter(x => !x.ends))
      out.push([1, 1, false, m, '']);
    const close = lay.eq.some(e => e.place && (e.kind === 'receiver' || (e.kind === 'filter' && !e.pipe)));
    if (StationMatrix.recv().close && close)
      for (const m of lay.modes().filter(x => !x.ends)) out.push([1, 1, false, m, '', true]);
    if (F.wide) for (const [lw, ll, st] of levels) out.push([lw, ll, true, {}, st]);
    return { levels, tiers: out };
  }

  pick(units, geo) {
    const lay = this.lay;
    lay.inMods = Boolean(geo.mods);
    lay.jGeo = null;
    const search = new SizeSearch(this, units, geo);
    for (const tier of this.tiers(geo.fixL || 0).tiers) {
      const got = search.tier(tier);
      if (got) return got;
    }
    return this.failure(units, geo, search);
  }

  /** Не помещается ни в одном уровне: что мешает — длина, раскладка модулей, высота, ширина. */
  failure(units, geo, search) {
    const fixL = geo.fixL || 0;
    const fail = text => ({ level: 'error', geo, ext: null, int: null, issues: [{ level: 'error', text }] });
    if (fixL) return fail(this.fixedText(units, geo, fixL));
    const G = StationGeo;
    const B = G.BLOCK;
    const maxL = StationMatrix.fit().maxL;
    if (geo.mods) {
      return fail(
        `В раскладке «${StationMods.shape(geo.mods)}» оборудование не помещается (модуль — до ${n(G.ROAD_W)} мм по ширине и ${n(maxL)} мм по длине, высота — до ${n(B.maxH)} мм): выберите другую раскладку или больше модулей («Модули…»).`,
      );
    }
    const F = StationMatrix.fit();
    const Wi = G.inner(geo.type, [10000, F.wide ? B.maxW : G.ROAD_W, B.maxH], geo.t)[1];
    const wideOk = this.need(search.probe, Wi - 2 * this.lay.G, 'row1', 1) != null;
    return fail(this.failText({ F, wideOk, tall: search.tall, B, G, maxL }));
  }

  fixedText(units, geo, fixL) {
    const r0 = this.auto(units, { ...geo, fixL: null });
    const L0 = r0.geo && r0.geo.ext ? r0.geo.ext[0] : null;
    if (L0)
      return `В заданную длину ${n(fixL)} мм оборудование не помещается даже максимально плотно — в габарите перевозки нужно не меньше ${n(L0)} мм. Увеличьте длину или уберите её (размер — по оборудованию).`;
    return `В заданную длину ${n(fixL)} мм оборудование не помещается. ${r0.issues && r0.issues[0] ? r0.issues[0].text : ''}`;
  }

  failText({ F, wideOk, tall, B, G, maxL }) {
    if (!F.wide && !wideOk) {
      return `Оборудование с проходом для оператора и обслуживания не проходит по ширине перевозки ${n(G.ROAD_W)} мм, а негабарит отключён в правилах компоновки («Настройки → Инженерные правила станций») — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
    }
    if (tall && !wideOk)
      return `Оборудование не помещается в блок-контейнер высотой до ${n(B.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`;
    if (!wideOk)
      return `Оборудование с проходом для оператора и обслуживания не проходит по ширине даже в блок-контейнере шириной ${n(B.maxW)} мм.`;
    return `Оборудование не помещается в один блок-контейнер длиной до ${n(maxL)} мм — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
  }

  /**
   * Длина ряда(ов) при ширине Wi: lvl 0 — рекомендуемые промежутки (без поворотов), 1 — «не менее»; null — не проходит
   * по ширине. ДГУ-станция — свои варианты; ДГУ вдоль посередине — сначала ширина с проходом с обеих сторон.
   */
  need(units, Wi, arr, lvl) {
    const lay = this.lay;
    if (!units.length) return 0;
    if (lay.dguSt && (arr !== 'row1' || this.dguTooNarrow(units, Wi))) return null;
    const r = this.row(units, Wi, arr, lvl);
    if (r.ok) return 0;
    if (!/^length/.test(r.why)) return null;
    if (!lvl) return r.needL0;
    return lay.closeOk && r.needLc != null ? r.needLc : r.needL;
  }

  dguTooNarrow(units, Wi) {
    if (!this.lay.midNeed) return false;
    const D = units.filter(e => e.kind === 'dgu');
    const M = StationMatrix.grp('dgu');
    const middle = D.length === 1 || (D.length === 2 && M.two && !this.lay.tank);
    return middle && D.some(e => Wi < e.w + 2 * M.pass);
  }

  row(units, Wi, arr, lvl) {
    const lay = this.lay;
    if (lay.dguSt) return lay.dgu.row(units, 0, Wi);
    const rows = {
      row1: () => lay.rows.one(units, 0, Wi, !lvl),
      rowX: () => lay.rows.cross(units, 0, Wi, !lvl),
      rowE: () => lay.rows.ends(units, 0, Wi, lay.T),
    };
    return (rows[arr] || (() => lay.rows.two(units, 0, Wi, !lvl)))();
  }

  /** Высота внутри над сервисными воротами за агрегатами: ворота, трубопровод, жалюзи выброса, зазор; ворот нет — 0. */
  overGate(r) {
    const D = (r.doors || []).filter(d => d.rear);
    if (!D.length) return 0;
    return Math.max(...D.map(d => d.h)) + StationMatrix.grp('exhaust').over + StationMatrix.louvre() + this.lay.G;
  }

  /**
   * Жалюзи притока или выброса не встали на стены — контейнер длиннее (шагами по 5, затем точнее по 1 шагу; до fit.growVent),
   * конвекторам нет места — длиннее до fit.growHeat; не вышло — как есть.
   */
  grow(plan, geo) {
    const lay = this.lay;
    const shortHeat = p => Boolean(p.heat && p.heat.short);
    const shortVent = p => Boolean(p.vent && (p.vent.short.in > 0 || p.vent.short.out > 0));
    const blocked =
      !geo.auto || geo.fixL || lay.in._grow || plan.level === 'error' || !plan.vent || !plan.geo || !plan.geo.ext;
    if (blocked || !(shortVent(plan) || shortHeat(plan))) return plan;
    const vent = shortVent(plan);
    const grower = new Grower(this, plan, vent ? shortVent : shortHeat);
    return vent ? grower.vent() : grower.heat();
  }

  /** Контейнер, в который всё поместится с проходом: морской — следующий по размеру, иначе блок-контейнер по размеру. */
  suggest(units, geo) {
    const lay = this.lay;
    if (geo.sea && !geo.own) {
      const sea = this.seaSuggest(units, geo);
      if (sea) return sea;
    }
    const type = StationGeo.FLEX[geo.type] ? geo.type : 'block';
    const r = this.auto(units, lay.geoOf({ ctype: type, ins: `${geo.t} мм`, sizeAuto: true }));
    return r.level === 'error' ? null : { ctype: type, size: r.geo.ext, level: r.level };
  }

  /** Морской больше: сначала как обычно, затем с исключениями. */
  seaSuggest(units, geo) {
    const lay = this.lay;
    const cur = StationGeo.SEA[geo.type];
    for (const modes of [[{}], lay.modes()]) {
      let warnFit = null;
      for (const t of StationGeo.SEA_ORDER) {
        const s = StationGeo.SEA[t];
        if (t === geo.type || (s.ext[0] <= cur.ext[0] && s.ext[2] <= cur.ext[2])) continue;
        const r = lay.fit(units, lay.geoOf({ ctype: t, ins: `${geo.t} мм` }), modes);
        if (r.level === 'ok') return { ctype: t, level: 'ok' };
        if (r.level === 'warn' && !warnFit) warnFit = { ctype: t, level: 'warn' };
      }
      if (warnFit) return warnFit;
    }
    return null;
  }

  /** Контейнер с большим запасом: морской — меньший морской не хуже, блок-контейнер своего размера — размер по оборудованию. */
  excess(units, geo, plan) {
    const rank = { ok: 0, warn: 1 };
    const lv = plan.issues.some(i => i.level === 'warn') ? 1 : 0;
    if (geo.sea && !geo.own) this.smallerSea(units, geo, plan, { rank, lv });
    else if (geo.own && StationGeo.FLEX[geo.type]) this.smallerBlock(units, geo, plan, { rank, lv });
  }

  smallerSea(units, geo, plan, { rank, lv }) {
    const lay = this.lay;
    const cur = StationGeo.SEA[geo.type];
    for (const t of StationGeo.SEA_ORDER) {
      const s = StationGeo.SEA[t];
      const bigger = s.ext[0] > cur.ext[0] || s.ext[2] > cur.ext[2];
      if (t === geo.type || bigger || (s.ext[0] === cur.ext[0] && s.ext[2] === cur.ext[2])) continue;
      const r = lay.fit(units, lay.geoOf({ ctype: t, ins: `${geo.t} мм` }), [{}]);
      if (r.level === 'error' || rank[r.level] > lv) continue;
      plan.suggest = { ctype: t, level: r.level, smaller: true };
      plan.issues.push({
        level: 'warn',
        big: true,
        text: `Контейнер с запасом: всё помещается в морской контейнер ${s.label} — меньше по размеру, массе и цене.`,
      });
      return;
    }
  }

  smallerBlock(units, geo, plan, { rank, lv }) {
    const r = this.auto(units, this.lay.geoOf({ ctype: geo.type, ins: `${geo.t} мм`, sizeAuto: true }));
    if (r.level === 'error' || !r.geo || !r.geo.ext || rank[r.level] > lv) return;
    const e = r.geo.ext;
    if (geo.ext[0] - e[0] < 500 && geo.ext[1] - e[1] < 300 && geo.ext[2] - e[2] < 300) return;
    plan.suggest = { ctype: geo.type, size: e, level: r.level, smaller: true };
    plan.issues.push({
      level: 'info',
      big: true,
      text: `Размер задан с запасом: по оборудованию достаточно ${n(e[0])} × ${n(e[1])} × ${n(e[2])} мм.`,
    });
  }
}

/** Перебор размеров одного подбора: высота, ширины, кандидаты по площади, длина с шагом, отбор по уровню. */
class SizeSearch {
  constructor(size, units, geo) {
    const lay = size.lay;
    const G = StationGeo;
    const f = G.flex(geo.type);
    Object.assign(this, { size, lay, units, geo, G, B: G.BLOCK, F: StationMatrix.fit(), tall: null, tried: new Map() });
    this.fixL = geo.fixL || 0;
    this.x0 = geo.x0 || 0;
    this.wallX = 2 * (geo.t + f.wall);
    this.hOf = f.floor + geo.t + f.roof;
    this.g2 = 2 * lay.G;
    const floor = units.filter(e => !e.pipe && e.mount !== 'wall');
    this.probe = floor.length ? floor : units.map(e => ({ ...e, slot: true }));
    this.MD = geo.mods;
    this.ka = this.MD ? this.MD.a : 1;
    this.kb = this.MD ? this.MD.b : 1;
    const Wroad = G.inner(geo.type, [10000, G.ROAD_W * this.kb, this.B.maxH], geo.t)[1] - this.g2;
    this.midOk = units.filter(e => e.kind === 'dgu').every(e => e.w + 2 * StationMatrix.grp('dgu').pass <= Wroad);
  }

  /** Высота внутри: проход в полный рост, оборудование и место над ним, настенный шкаф — от CAB_LOW. */
  needH(lvl) {
    const G = this.lay.G;
    const low = StationMatrix.cab().low;
    const of = e => {
      if (e.mount === 'wall') return e.h + low + 150;
      return e.h + Math.max(G, e.kind === 'compressor' ? e.c.top[1] : e.c.top[lvl]);
    };
    return Math.max(this.B.hWalk, ...this.units.filter(e => !e.pipe).map(of));
  }

  fitAt(g, m) {
    const key = g.ext.join('×') + JSON.stringify(m) + (this.lay.closeAll ? 'c' : '');
    if (!this.tried.has(key)) this.tried.set(key, this.lay.fit(this.units, g, [m]));
    return this.tried.get(key);
  }

  /** Уровень [lw, ll, wide, m, st, close]: модули — без негабарита и без продольного прохода в два ряда модулей. */
  tier([lw, ll, wide, m, st, close]) {
    const { lay, MD } = this;
    if (MD && (wide || (m.ends && MD.b > 1))) return null;
    if (lay.forcePairs && (close || wide)) return null;
    lay.closeAll = Boolean(close);
    lay.closeOk = Boolean(close);
    lay.midNeed = !wide && Boolean(st) && this.midOk;
    try {
      return lay.withMode(m, () => this.at({ lw, ll, wide, m, st, close }));
    } finally {
      lay.closeAll = false;
      lay.midNeed = false;
    }
  }

  /** Ширины: у модулей — модуля × b; иначе с шагом до габарита перевозки (и сам габарит), негабарит — шире. */
  widths(wide) {
    const { G, B } = this;
    if (this.MD) return StationMods.widths().map(Wm => Wm * this.kb);
    const out = [];
    for (let Wx = G.up(wide ? G.ROAD_W + 1 : B.minW); Wx <= (wide ? B.maxW : G.ROAD_W); Wx += G.STEP) out.push(Wx);
    if (!wide && out[out.length - 1] < G.ROAD_W) out.push(G.ROAD_W);
    return out;
  }

  /** Длина станции по полезной длине L: у модулей — модуль с шагом × a, не короче mods.lMin. */
  lengthOf(L) {
    const { G, B, MD, ka } = this;
    return ka * Math.max(B.minL, MD ? StationMods.M.lMin : 0, G.up((L + this.g2 + this.x0 + this.wallX) / ka));
  }

  arrangements(m, lw, Wx) {
    const { lay, MD, G } = this;
    const ends =
      lay.comp &&
      lw &&
      !m.cross &&
      !this.x0 &&
      (!MD || MD.b === 1) &&
      Wx === G.ROAD_W * this.kb &&
      StationMatrix.modes().ends;
    return ['row1', 'row2', ...(m.cross ? ['rowX'] : []), ...(ends ? ['rowE'] : [])];
  }

  /** Кандидаты {Lx, Wx, two, a, m} — по приведённой площади (два ряда и без прохода — с поправкой на выигрыш). */
  candidates({ ll, m, lw }, Hx) {
    const { lay, F, fixL } = this;
    const maxL = F.maxL * this.ka;
    const cand = [];
    for (const Wx of this.widths(this.wide)) {
      const Wi = this.G.inner(this.geo.type, [10000, Wx, Hx], this.geo.t)[1] - this.g2;
      for (const arr of this.arrangements(m, lw, Wx)) {
        const L = this.size.need(this.probe, Wi, arr, ll);
        if (L == null) continue;
        const Lx = this.lengthOf(L);
        if (fixL && Lx > fixL) continue;
        const k = { row2: 1 - F.two / 100, rowE: 1 - F.ends / 100 }[arr] || 1;
        if (Lx <= maxL && !lay.forcePairs)
          cand.push({ Lx, Wx, two: arr === 'row2', a: (Lx * Wx) / k, m: arr === 'rowE' ? { ...m, ends: true } : m });
        if (arr === 'row1') this.pairsCandidate(cand, { Wi, ll, Lx, Wx, m, maxL });
      }
    }
    return cand.sort((p, q) => p.a - q.a || p.Lx - q.Lx);
  }

  /** Ресиверы парами поперёк в конце ряда — если станция так заметно короче (или иначе длиннее наибольшей). */
  pairsCandidate(cand, { Wi, ll, Lx, Wx, m, maxL }) {
    const lay = this.lay;
    let L2 = null;
    lay.recv2 = true;
    try {
      L2 = this.size.need(this.probe, Wi, 'row1', lay.forcePairs ? 1 : ll);
    } finally {
      lay.recv2 = false;
    }
    if (L2 == null || this.fixL) return;
    const Lx2 = this.lengthOf(L2);
    if (lay.forcePairs || Lx2 <= Lx - StationMatrix.fit().recv2 || Lx > maxL)
      cand.push({ Lx: Lx2, Wx, two: false, a: Lx2 * Wx, m });
  }

  /** Уровень в режиме m: высота, кандидаты, первая подходящая длина; из равных по площади — аккуратнейшая. */
  at(tier) {
    const { G, B } = this;
    const Hx = Math.max(B.minH, G.up(this.needH(tier.lw) + this.hOf));
    if (Hx > B.maxH) {
      this.tall = this.tall || Hx;
      return null;
    }
    this.wide = tier.wide;
    const look = StationTidy.M;
    const extra = this.MD ? look.modStep * G.STEP * this.ka : 0;
    const state = { alt: null, pick: null, seen: new Set(), extra, tidy: look.tidy };
    for (const c of this.candidates(tier, Hx)) {
      if (this.stop(c, state)) break;
      const key = `${c.Lx}×${c.Wx}${c.m.ends ? 'E' : ''}`;
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      const done = this.lengths(c, Hx, tier, state);
      if (done) return this.done(done, tier);
    }
    if (state.pick) return this.done(state.pick, tier);
    return state.alt ? this.done(state.alt, tier) : null;
  }

  stop(c, { alt, pick, extra, tidy }) {
    if (alt && c.a > alt.a * 1.2) return true;
    return Boolean(pick) && (!tidy || c.Lx * c.Wx > pick.area + extra * c.Wx);
  }

  /** Длины от кандидата с шагом (шкафам и фильтрам может понадобиться место в ряду; у модулей — обойти стойку стыка). */
  lengths(c, Hx, tier, state) {
    const { G, MD, ka, fixL } = this;
    const last = fixL || Math.min(this.F.maxL * ka, c.Lx + (MD ? 1500 * ka + 3000 : 1500));
    for (let Lx = fixL || c.Lx; Lx <= last; Lx += G.STEP * ka) {
      const got = this.tryLength(c, Lx, Hx, tier);
      if (got === 'break') break;
      const step = got ? this.collect(got, c, Lx, state) : 'next';
      if (step === 'done') return got;
      if (step === 'stop') break;
    }
    return null;
  }

  /** Учесть подходящую длину: 'done' — первая годится, 'stop' — дальше не искать, 'next' — следующая длина. */
  collect(got, c, Lx, state) {
    if (got.alt) {
      state.alt = state.alt || { ...got, a: c.a };
      return 'next';
    }
    if (!state.tidy && !state.extra) return 'done';
    this.take(state, got, Lx);
    return !state.extra || Lx >= state.pick.lim ? 'stop' : 'next';
  }

  /** Аккуратнейший из равных по площади (у модулей — и чуть длиннее, look.modStep). */
  take(state, { r, g2, Wx }, Lx) {
    const sc = StationTidy.score(r, g2).score;
    const area = Lx * Wx;
    if (!state.pick) state.pick = { r, g2, Wx, sc, area, Lx, lim: Lx + state.extra };
    else if (sc > state.pick.sc + 2 && area <= state.pick.area + state.extra * Wx)
      Object.assign(state.pick, { r, g2, Wx, sc, Lx });
  }

  geoAt(Lx, Wx, Hx) {
    const { MD, ka, kb } = this;
    const g = {
      ...this.geo,
      auto: false,
      road: true,
      ext: [Lx, Wx, Hx],
      ...(MD ? { mods: { ...MD, Lm: Lx / ka, Wm: Wx / kb } } : {}),
    };
    g.int = this.G.inner(this.geo.type, g.ext, this.geo.t);
    return g;
  }

  /**
   * Расстановка в размере Lx × Wx: подходит — {r, g2, Wx}; шкафы заняли торцы — {…, alt}; дальше по длине не искать —
   * 'break'; эта длина не подходит — null.
   */
  tryLength(c, Lx, Hx, { st, ll, close }) {
    let g2 = this.geoAt(Lx, c.Wx, Hx);
    let r = this.fitAt(g2, c.m);
    if (r.level === 'error' || (this.MD && StationMods.cross(r.items, g2).length)) return null;
    [r, g2] = this.higher(r, g2, c);
    const stop = this.stopLength(r, c, st);
    if (stop) return stop;
    if (!this.accepted(r, st, ll, close)) return null;
    const ends = (r.doors || []).some(d => (d.why || []).some(x => /торцы заняты шкафами/.test(x)));
    return { r, g2, Wx: c.Wx, alt: ends };
  }

  /** Над сервисными воротами — трубопровод и выброс воздуха коробом: контейнер выше, если места мало. */
  higher(r, g2, c) {
    const up = this.size.overGate(r);
    if (!(up > g2.int[2])) return [r, g2];
    const H2 = this.G.up(up + this.hOf);
    if (H2 > this.B.maxH) return [r, g2];
    const g3 = { ...g2, ext: [g2.ext[0], c.Wx, H2] };
    g3.int = this.G.inner(this.geo.type, g3.ext, this.geo.t);
    const r3 = this.fitAt(g3, c.m);
    return r3.level === 'error' ? [r, g2] : [r3, g3];
  }

  /** Дальше по длине не искать: два ряда вышли одним, без пар ресиверов, не рекомендуемое, без продольного прохода. */
  stopLength(r, c, st) {
    if (c.two && r.rows === 1) return 'break';
    if (this.lay.forcePairs && !r.items.some(i => i.pairEnd)) return 'break';
    if (st === 'rec' && (warns(r).some(x => /^Проход|стоит в/.test(x)) || r.items.some(i => i.tight))) return 'break';
    return st === 'gate' && r.items.some(i => i.ends) ? 'break' : null;
  }

  /** Подходит ли расстановка уровню: без сервисных ворот, с доступом ко всем сторонам, рекомендуемые промежутки. */
  accepted(r, st, ll, close) {
    const w = warns(r);
    if (st === 'gate' && (r.items.some(i => i.tight) || (r.doors || []).some(d => d.kind !== 'entry'))) return false;
    if ((st === 'gate' || st === 'acc' || close) && w.some(x => /не подойти/.test(x))) return false;
    return !(ll === 0 && w.some(x => /^Промежутки|^Отступы/.test(x)));
  }

  /** Принятый размер: плотность, замечания исключений, мягкие замечания. */
  done({ r, g2, Wx }, { lw, m, wide, close }) {
    r.geo = g2;
    r.picked = true;
    r.density = LayoutMode.density(lw, m, r, wide);
    if (close) {
      const text = [r.density.id === 'max' ? r.density.text : '', 'ресиверы и фильтры вплотную']
        .filter(Boolean)
        .join(', ');
      r.density = { id: 'max', title: 'Максимально плотно', text };
    }
    if (this.fixL) {
      r.issues.push({
        level: 'info',
        fixL: true,
        text: `Длина задана: ${n(this.fixL)} мм — компоновка «${r.density.title}» (${r.density.text}); ширина и высота — по оборудованию.`,
      });
    }
    LayoutMode.soft(r);
    if (close) {
      r.issues.push({
        level: 'warn',
        close: true,
        text: 'Ресиверы и фильтры стоят вплотную друг к другу (промежутки — меньше «плотно» в правилах компоновки): исключение, чтобы станция прошла по габариту перевозки и ресиверы остались внутри (решение ПНЕВМОТЕХ: вплотную — только если иначе не в габарите). Осмотр — спереди и сбоку, через промежутки пар.',
      });
    }
    if (wide) {
      const road = n(StationGeo.ROAD_W);
      r.issues.push({
        level: 'warn',
        wide: true,
        text: `Негабарит: ширина ${n(Wx)} мм — шире габарита перевозки (без спецразрешения — до ${road} мм). Исключение: в ${road} мм не помещается даже плотно и без продольного прохода — перевозка со спецразрешением; иначе — две станции или меньше оборудования.`,
      });
    }
    return r;
  }
}

/** Удлинение подобранного контейнера, чтобы встали жалюзи или конвекторы. */
class Grower {
  constructor(size, plan, bad) {
    const [L0, W, H] = plan.geo.ext;
    const MD = plan.geo.mods;
    Object.assign(this, { lay: size.lay, plan, bad, L0, W, H, MD, ka: MD ? MD.a : 1 });
    this.step = StationGeo.STEP * this.ka;
    this.maxL = StationMatrix.fit().maxL * this.ka;
  }

  /** Расстановка в длине Lx (в том же режиме); жалюзи или конвекторы не встали — null. */
  at(Lx) {
    const { lay, MD, W, H, ka } = this;
    const size = MD ? `${Lx / ka} × ${W / MD.b} × ${H}` : `${Lx} × ${W} × ${H}`;
    const input = { ...lay.in, _grow: true, _mode: this.plan.mode || {}, cont: { ...lay.cont, size, sizeAuto: false } };
    const p = new lay.constructor(input).run();
    return p.level === 'error' || !p.vent || this.bad(p) ? null : p;
  }

  /** Конвекторам нет места — длиннее не больше чем на fit.growHeat. */
  heat() {
    const last = Math.min(this.maxL, this.L0 + StationMatrix.fit().growHeat * this.ka);
    for (let Lx = this.L0 + this.step; Lx <= last; Lx += this.step) {
      const p = this.at(Lx);
      if (p) return this.accept(p, Lx, 'конвекторы отопления');
    }
    return this.plan;
  }

  /** Жалюзи не встают — длиннее до fit.growVent: шагами по 5, затем наименьшая длина с шагом 1. */
  vent() {
    const { step } = this;
    const last = Math.min(this.maxL, this.L0 + StationMatrix.fit().growVent * this.ka);
    for (let Lx = this.L0 + 5 * step; Lx <= last; Lx += 5 * step) {
      const p = this.at(Lx);
      if (!p) continue;
      for (let L2 = Lx - 4 * step; L2 < Lx; L2 += step) {
        const q = L2 > this.L0 ? this.at(L2) : null;
        if (q) return this.accept(q, L2, 'жалюзи притока и выброса');
      }
      return this.accept(p, Lx, 'жалюзи притока и выброса');
    }
    return this.plan;
  }

  accept(p, Lx, what) {
    const { plan } = this;
    p.geo.auto = true;
    p.picked = true;
    p.density = plan.density;
    LayoutMode.soft(p);
    const wide = plan.issues.filter(i => i.wide);
    if (wide.length) {
      p.issues.unshift(...wide);
      if (p.level === 'ok') p.level = 'warn';
    }
    p.issues.push({
      level: 'info',
      text: `Длина контейнера ${n(Lx)} мм (по оборудованию — ${n(this.L0)} мм): так помещаются ${what}.`,
    });
    return p;
  }
}
