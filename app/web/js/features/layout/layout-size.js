import { LayoutMode } from './layout-mode.js';
import { Mm } from './mm.js';
import { StationGeo } from './station-geo.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationTidy } from './station-tidy.js';

/**
 * Подбор размера блок-контейнера по оборудованию: шаг размеров, наименьшая площадь пола, всегда с проходом; в габарите
 * перевозки — сначала как обычно, затем исключения компрессорной, вплотную, негабарит — последним (если разрешён).
 * Из равных по площади — аккуратнейший; у модулей — модуль с шагом × число модулей.
 */
export class LayoutSize {
  static _warns = res => res.issues.filter(i => i.level === 'warn').map(i => i.text);

  /**
   * Уровни подбора: [отступы, промежутки (0 — рекомендуемые, 1 — не менее), что недопустимо]: 'rec' — всё рекомендуемое,
   * 'gate' — без сервисных ворот и с доступом ко всем сторонам, 'acc' — с доступом ко всем сторонам, '' — как вышло.
   */
  static LEVELS = {
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

  constructor(lay) {
    this.lay = lay;
  }

  /** Размер по оборудованию; ресиверы парами поперёк у торца — если так станция короче хотя бы на fit.recv2. */
  auto(units, geo) {
    const lay = this.lay;
    const res = this.pick(units, geo);
    const receivers = units.filter(unit => unit.kind === 'receiver' && !unit.outside).length;
    if (
      lay.forcePairs ||
      geo.fixL ||
      !res.geo ||
      !res.geo.ext ||
      (res.items || []).some(i => i.pairEnd) ||
      receivers < 2 ||
      !(StationMatrix.fit().recv2 > 0)
    )
      return res;
    let pairs = null;
    lay.forcePairs = true;
    try {
      pairs = this.pick(units, geo);
    } finally {
      lay.forcePairs = false;
    }
    if (!this._shorterWithPairs(pairs, res)) return res;
    pairs.issues.push({
      level: 'info',
      text: `Ресиверы — частью в два ряда поперёк у торца: станция короче на ${Mm.text(res.geo.ext[0] - pairs.geo.ext[0])} мм (${Mm.text(pairs.geo.ext[0])} вместо ${Mm.text(res.geo.ext[0])} мм); отступы — допустимые («не менее»).`,
    });
    return pairs;
  }

  _shorterWithPairs(pairs, res) {
    if (!pairs || pairs.level === 'error' || !pairs.geo || !pairs.items.some(i => i.pairEnd)) return false;
    return pairs.geo.ext[1] <= res.geo.ext[1] && pairs.geo.ext[0] <= res.geo.ext[0] - StationMatrix.fit().recv2;
  }

  /** Уровни подбора по порядку: [отступы, промежутки, негабарит, режим, что недопустимо, вплотную]. */
  tiers(fixL) {
    const lay = this.lay;
    const fit = StationMatrix.fit();
    const levels = (fixL && LayoutSize.LEVELS.fixed) || (fit.dense ? LayoutSize.LEVELS.dense : LayoutSize.LEVELS.roomy);
    const out = levels.map(([levelW, levelL, stage]) => [levelW, levelL, false, {}, stage]);
    for (const mode of lay
      .modes()
      .slice(1)
      .filter(x => !x.ends))
      out.push([1, 1, false, mode, '']);
    const close = lay.equip.some(
      unit => unit.place && (unit.kind === 'receiver' || (unit.kind === 'filter' && !unit.pipe)),
    );
    if (StationMatrix.recv().close && close)
      for (const mode of lay.modes().filter(x => !x.ends)) out.push([1, 1, false, mode, '', true]);
    if (fit.wide) for (const [levelW, levelL, stage] of levels) out.push([levelW, levelL, true, {}, stage]);
    return { levels, tiers: out };
  }

  /** Подбор размера станции под оборудование. */
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
    if (fixL) return fail(this._fixedText(units, geo, fixL));
    const block = StationGeo.BLOCK;
    const maxL = StationMatrix.fit().maxL;
    if (geo.mods) {
      return fail(
        `В раскладке «${StationMods.shape(geo.mods)}» оборудование не помещается (модуль — до ${Mm.text(StationGeo.ROAD_W)} мм по ширине и ${Mm.text(maxL)} мм по длине, высота — до ${Mm.text(block.maxH)} мм): выберите другую раскладку или больше модулей («Модули…»).`,
      );
    }
    const fit = StationMatrix.fit();
    const Wi = StationGeo.inner(geo.type, [10000, fit.wide ? block.maxW : StationGeo.ROAD_W, block.maxH], geo.t)[1];
    const wideOk = this.need(search.probe, Wi - 2 * this.lay.gap, 'row1', 1) != null;
    return fail(this._failText({ F: fit, wideOk, tall: search.tall, B: block, maxL }));
  }

  _fixedText(units, geo, fixL) {
    const auto0 = this.auto(units, { ...geo, fixL: null });
    const len0 = auto0.geo && auto0.geo.ext ? auto0.geo.ext[0] : null;
    if (len0)
      return `В заданную длину ${Mm.text(fixL)} мм оборудование не помещается даже максимально плотно — в габарите перевозки нужно не меньше ${Mm.text(len0)} мм. Увеличьте длину или уберите её (размер — по оборудованию).`;
    return `В заданную длину ${Mm.text(fixL)} мм оборудование не помещается. ${auto0.issues && auto0.issues[0] ? auto0.issues[0].text : ''}`;
  }

  _failText({ F: fit, wideOk, tall, B: block, maxL }) {
    if (!fit.wide && !wideOk) {
      return `Оборудование с проходом для оператора и обслуживания не проходит по ширине перевозки ${Mm.text(StationGeo.ROAD_W)} мм, а негабарит отключён в правилах компоновки («Настройки → Инженерные правила станций») — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
    }
    if (tall && !wideOk)
      return `Оборудование не помещается в блок-контейнер высотой до ${Mm.text(block.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`;
    if (!wideOk)
      return `Оборудование с проходом для оператора и обслуживания не проходит по ширине даже в блок-контейнере шириной ${Mm.text(block.maxW)} мм.`;
    return `Оборудование не помещается в один блок-контейнер длиной до ${Mm.text(maxL)} мм — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
  }

  /**
   * Длина ряда(ов) при ширине Wi: lvl 0 — рекомендуемые промежутки (без поворотов), 1 — «не менее»; null — не проходит
   * по ширине. ДГУ-станция — свои варианты; ДГУ вдоль посередине — сначала ширина с проходом с обеих сторон.
   */
  need(units, Wi, arr, lvl) {
    const lay = this.lay;
    if (!units.length) return 0;
    if (lay.dguSt && (arr !== 'row1' || this._dguTooNarrow(units, Wi))) return null;
    const res = this.row(units, Wi, arr, lvl);
    if (res.ok) return 0;
    if (!/^length/.test(res.why)) return null;
    if (!lvl) return res.needL0;
    return lay.closeOk && res.needLc != null ? res.needLc : res.needL;
  }

  _dguTooNarrow(units, Wi) {
    if (!this.lay.midNeed) return false;
    const dgus = units.filter(unit => unit.kind === 'dgu');
    const dguRule = StationMatrix.grp('dgu');
    const middle = dgus.length === 1 || (dgus.length === 2 && dguRule.two && !this.lay.tank);
    return middle && dgus.some(unit => Wi < unit.w + 2 * dguRule.pass);
  }

  /** Расстановка одного ряда в ширине. */
  row(units, Wi, arr, lvl) {
    const lay = this.lay;
    if (lay.dguSt) return lay.dgu.row(units, 0, Wi);
    const rows = {
      row1: () => lay.rows.one(units, 0, Wi, !lvl),
      rowX: () => lay.rows.cross(units, 0, Wi, !lvl),
      rowE: () => lay.rows.ends(units, 0, Wi, lay.wallT),
    };
    return (rows[arr] || (() => lay.rows.two(units, 0, Wi, !lvl)))();
  }

  /** Высота внутри над сервисными воротами за агрегатами: ворота, трубопровод, жалюзи выброса, зазор; ворот нет — 0. */
  overGate(res) {
    const doors = (res.doors || []).filter(door => door.rear);
    if (!doors.length) return 0;
    return (
      Math.max(...doors.map(door => door.h)) + StationMatrix.grp('exhaust').over + StationMatrix.louvre() + this.lay.gap
    );
  }

  /**
   * Жалюзи притока или выброса не встали на стены — контейнер длиннее (шагами по 5, затем точнее по 1 шагу; до fit.growVent),
   * конвекторам нет места — длиннее до fit.growHeat; не вышло — как есть.
   */
  grow(plan, geo) {
    const lay = this.lay;
    const shortHeat = plan2 => Boolean(plan2.heat && plan2.heat.short);
    const shortVent = plan2 => Boolean(plan2.vent && (plan2.vent.short.in > 0 || plan2.vent.short.out > 0));
    const blocked =
      !geo.auto || geo.fixL || lay.input._grow || plan.level === 'error' || !plan.vent || !plan.geo || !plan.geo.ext;
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
    const res = this.auto(units, lay.geoOf({ ctype: type, ins: `${geo.t} мм`, sizeAuto: true }));
    return res.level === 'error' ? null : { ctype: type, size: res.geo.ext, level: res.level };
  }

  /** Морской больше: сначала как обычно, затем с исключениями. */
  seaSuggest(units, geo) {
    const lay = this.lay;
    const cur = StationGeo.SEA[geo.type];
    for (const modes of [[{}], lay.modes()]) {
      let warnFit = null;
      for (const type of StationGeo.SEA_ORDER) {
        const sea = StationGeo.SEA[type];
        if (type === geo.type || (sea.ext[0] <= cur.ext[0] && sea.ext[2] <= cur.ext[2])) continue;
        const res = lay.fit(units, lay.geoOf({ ctype: type, ins: `${geo.t} мм` }), modes);
        if (res.level === 'ok') return { ctype: type, level: 'ok' };
        if (res.level === 'warn' && !warnFit) warnFit = { ctype: type, level: 'warn' };
      }
      if (warnFit) return warnFit;
    }
    return null;
  }

  /** Контейнер с большим запасом: морской — меньший морской не хуже, блок-контейнер своего размера — размер по оборудованию. */
  excess(units, geo, plan) {
    const rank = { ok: 0, warn: 1 };
    const level = plan.issues.some(i => i.level === 'warn') ? 1 : 0;
    if (geo.sea && !geo.own) this._smallerSea(units, geo, plan, { rank, lv: level });
    else if (geo.own && StationGeo.FLEX[geo.type]) this._smallerBlock(units, geo, plan, { rank, lv: level });
  }

  _smallerSea(units, geo, plan, { rank, lv: level }) {
    const lay = this.lay;
    const cur = StationGeo.SEA[geo.type];
    for (const type of StationGeo.SEA_ORDER) {
      const sea = StationGeo.SEA[type];
      const bigger = sea.ext[0] > cur.ext[0] || sea.ext[2] > cur.ext[2];
      if (type === geo.type || bigger || (sea.ext[0] === cur.ext[0] && sea.ext[2] === cur.ext[2])) continue;
      const res = lay.fit(units, lay.geoOf({ ctype: type, ins: `${geo.t} мм` }), [{}]);
      if (res.level === 'error' || rank[res.level] > level) continue;
      plan.suggest = { ctype: type, level: res.level, smaller: true };
      plan.issues.push({
        level: 'warn',
        big: true,
        text: `Контейнер с запасом: всё помещается в морской контейнер ${sea.label} — меньше по размеру, массе и цене.`,
      });
      return;
    }
  }

  _smallerBlock(units, geo, plan, { rank, lv: level }) {
    const res = this.auto(units, this.lay.geoOf({ ctype: geo.type, ins: `${geo.t} мм`, sizeAuto: true }));
    if (res.level === 'error' || !res.geo || !res.geo.ext || rank[res.level] > level) return;
    const ext = res.geo.ext;
    if (geo.ext[0] - ext[0] < 500 && geo.ext[1] - ext[1] < 300 && geo.ext[2] - ext[2] < 300) return;
    plan.suggest = { ctype: geo.type, size: ext, level: res.level, smaller: true };
    plan.issues.push({
      level: 'info',
      big: true,
      text: `Размер задан с запасом: по оборудованию достаточно ${Mm.text(ext[0])} × ${Mm.text(ext[1])} × ${Mm.text(ext[2])} мм.`,
    });
  }
}

/** Перебор размеров одного подбора: высота, ширины, кандидаты по площади, длина с шагом, отбор по уровню. */
class SizeSearch {
  constructor(size, units, geo) {
    const lay = size.lay;
    const flex = StationGeo.flex(geo.type);
    Object.assign(this, {
      size,
      lay,
      units,
      geo,
      block: StationGeo.BLOCK,
      fit: StationMatrix.fit(),
      tall: null,
      tried: new Map(),
    });
    this.fixL = geo.fixL || 0;
    this.x0 = geo.x0 || 0;
    this.wallX = 2 * (geo.t + flex.wall);
    this.hOf = flex.floor + geo.t + flex.roof;
    this.gaps2 = 2 * lay.gap;
    const floor = units.filter(unit => !unit.pipe && unit.mount !== 'wall');
    this.probe = floor.length ? floor : units.map(unit => ({ ...unit, slot: true }));
    this.mods = geo.mods;
    this.modsA = this.mods ? this.mods.a : 1;
    this.modsB = this.mods ? this.mods.b : 1;
    const Wroad =
      StationGeo.inner(geo.type, [10000, StationGeo.ROAD_W * this.modsB, this.block.maxH], geo.t)[1] - this.gaps2;
    this.midOk = units
      .filter(unit => unit.kind === 'dgu')
      .every(unit => unit.w + 2 * StationMatrix.grp('dgu').pass <= Wroad);
  }

  /** Высота внутри: проход в полный рост, оборудование и место над ним, настенный шкаф — от CAB_LOW. */
  needH(lvl) {
    const gap = this.lay.gap;
    const low = StationMatrix.cab().low;
    const needOf = unit => {
      if (unit.mount === 'wall') return unit.h + low + 150;
      return unit.h + Math.max(gap, unit.kind === 'compressor' ? unit.c.top[1] : unit.c.top[lvl]);
    };
    return Math.max(this.block.hWalk, ...this.units.filter(unit => !unit.pipe).map(needOf));
  }

  /** Компоновка в заданном размере и режиме (с памятью). */
  fitAt(geo2, mode) {
    const key = geo2.ext.join('×') + JSON.stringify(mode) + (this.lay.closeAll ? 'c' : '');
    if (!this.tried.has(key)) this.tried.set(key, this.lay.fit(this.units, geo2, [mode]));
    return this.tried.get(key);
  }

  /** Уровень [lw, ll, wide, m, st, close]: модули — без негабарита и без продольного прохода в два ряда модулей. */
  tier([levelW, levelL, wide, mode, stage, close]) {
    const { lay, mods: mods } = this;
    if (mods && (wide || (mode.ends && mods.b > 1))) return null;
    if (lay.forcePairs && (close || wide)) return null;
    lay.closeAll = Boolean(close);
    lay.closeOk = Boolean(close);
    lay.midNeed = !wide && Boolean(stage) && this.midOk;
    try {
      return lay.withMode(mode, () => this.atTier({ lw: levelW, ll: levelL, wide, m: mode, st: stage, close }));
    } finally {
      lay.closeAll = false;
      lay.midNeed = false;
    }
  }

  /** Ширины: у модулей — модуля × b; иначе с шагом до габарита перевозки (и сам габарит), негабарит — шире. */
  widths(wide) {
    const { block: block } = this;
    if (this.mods) return StationMods.widths().map(modW => modW * this.modsB);
    const out = [];
    for (
      let widX = StationGeo.roundUp(wide ? StationGeo.ROAD_W + 1 : block.minW);
      widX <= (wide ? block.maxW : StationGeo.ROAD_W);
      widX += StationGeo.STEP
    )
      out.push(widX);
    if (!wide && out[out.length - 1] < StationGeo.ROAD_W) out.push(StationGeo.ROAD_W);
    return out;
  }

  /** Длина станции по полезной длине L: у модулей — модуль с шагом × a, не короче mods.lMin. */
  lengthOf(len) {
    const { block: block, mods: mods, modsA: modsA } = this;
    return (
      modsA *
      Math.max(
        block.minL,
        mods ? StationMods.RULES.lMin : 0,
        StationGeo.roundUp((len + this.gaps2 + this.x0 + this.wallX) / modsA),
      )
    );
  }

  _arrangements(mode, levelW, widX) {
    const { lay, mods: mods } = this;
    const ends =
      lay.comp &&
      levelW &&
      !mode.cross &&
      !this.x0 &&
      (!mods || mods.b === 1) &&
      widX === StationGeo.ROAD_W * this.modsB &&
      StationMatrix.modes().ends;
    return ['row1', 'row2', ...(mode.cross ? ['rowX'] : []), ...(ends ? ['rowE'] : [])];
  }

  /** Кандидаты {Lx, Wx, two, a, m} — по приведённой площади (два ряда и без прохода — с поправкой на выигрыш). */
  candidates({ ll: levelL, m: mode, lw: levelW }, heightX) {
    const { lay, fit: fit, fixL } = this;
    const maxL = fit.maxL * this.modsA;
    const cand = [];
    for (const widX of this.widths(this.wide)) {
      const Wi = StationGeo.inner(this.geo.type, [10000, widX, heightX], this.geo.t)[1] - this.gaps2;
      for (const arr of this._arrangements(mode, levelW, widX)) {
        const len = this.size.need(this.probe, Wi, arr, levelL);
        if (len == null) continue;
        const lenX = this.lengthOf(len);
        if (fixL && lenX > fixL) continue;
        const k = { row2: 1 - fit.two / 100, rowE: 1 - fit.ends / 100 }[arr] || 1;
        if (lenX <= maxL && !lay.forcePairs)
          cand.push({
            Lx: lenX,
            Wx: widX,
            two: arr === 'row2',
            a: (lenX * widX) / k,
            m: arr === 'rowE' ? { ...mode, ends: true } : mode,
          });
        if (arr === 'row1') this.pairsCandidate(cand, { Wi, ll: levelL, Lx: lenX, Wx: widX, m: mode, maxL });
      }
    }
    return cand.sort((left, right) => left.a - right.a || left.Lx - right.Lx);
  }

  /** Ресиверы парами поперёк в конце ряда — если станция так заметно короче (или иначе длиннее наибольшей). */
  pairsCandidate(cand, { Wi, ll: levelL, Lx: lenX, Wx: widX, m: mode, maxL }) {
    const lay = this.lay;
    let len2 = null;
    lay.recv2 = true;
    try {
      len2 = this.size.need(this.probe, Wi, 'row1', lay.forcePairs ? 1 : levelL);
    } finally {
      lay.recv2 = false;
    }
    if (len2 == null || this.fixL) return;
    const Lx2 = this.lengthOf(len2);
    if (lay.forcePairs || Lx2 <= lenX - StationMatrix.fit().recv2 || lenX > maxL)
      cand.push({ Lx: Lx2, Wx: widX, two: false, a: Lx2 * widX, m: mode });
  }

  /** Уровень в режиме m: высота, кандидаты, первая подходящая длина; из равных по площади — аккуратнейшая. */
  atTier(tier) {
    const { block: block } = this;
    const heightX = Math.max(block.minH, StationGeo.roundUp(this.needH(tier.lw) + this.hOf));
    if (heightX > block.maxH) {
      this.tall = this.tall || heightX;
      return null;
    }
    this.wide = tier.wide;
    const look = StationTidy.RULES;
    const extra = this.mods ? look.modStep * StationGeo.STEP * this.modsA : 0;
    const state = { alt: null, pick: null, seen: new Set(), extra, tidy: look.tidy };
    for (const cand of this.candidates(tier, heightX)) {
      if (this.stop(cand, state)) break;
      const key = `${cand.Lx}×${cand.Wx}${cand.m.ends ? 'E' : ''}`;
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      const done = this.lengths(cand, heightX, tier, state);
      if (done) return this.done(done, tier);
    }
    if (state.pick) return this.done(state.pick, tier);
    return state.alt ? this.done(state.alt, tier) : null;
  }

  /** Пора ли прекратить перебор размеров. */
  stop(cand, { alt, pick, extra, tidy }) {
    if (alt && cand.a > alt.a * 1.2) return true;
    return Boolean(pick) && (!tidy || cand.Lx * cand.Wx > pick.area + extra * cand.Wx);
  }

  /** Длины от кандидата с шагом (шкафам и фильтрам может понадобиться место в ряду; у модулей — обойти стойку стыка). */
  lengths(cand, heightX, tier, state) {
    const { mods: mods, modsA: modsA, fixL } = this;
    const last = fixL || Math.min(this.fit.maxL * modsA, cand.Lx + (mods ? 1500 * modsA + 3000 : 1500));
    for (let lenX = fixL || cand.Lx; lenX <= last; lenX += StationGeo.STEP * modsA) {
      const got = this.tryLength(cand, lenX, heightX, tier);
      if (got === 'break') break;
      const step = got ? this.collect(got, cand, lenX, state) : 'next';
      if (step === 'done') return got;
      if (step === 'stop') break;
    }
    return null;
  }

  /** Учесть подходящую длину: 'done' — первая годится, 'stop' — дальше не искать, 'next' — следующая длина. */
  collect(got, cand, lenX, state) {
    if (got.alt) {
      state.alt = state.alt || { ...got, a: cand.a };
      return 'next';
    }
    if (!state.tidy && !state.extra) return 'done';
    this.take(state, got, lenX);
    return !state.extra || lenX >= state.pick.lim ? 'stop' : 'next';
  }

  /** Аккуратнейший из равных по площади (у модулей — и чуть длиннее, look.modStep). */
  take(state, { r: res, g2: geo2, Wx: widX }, lenX) {
    const score = StationTidy.score(res, geo2).score;
    const area = lenX * widX;
    if (!state.pick) state.pick = { r: res, g2: geo2, Wx: widX, sc: score, area, Lx: lenX, lim: lenX + state.extra };
    else if (score > state.pick.sc + 2 && area <= state.pick.area + state.extra * widX)
      Object.assign(state.pick, { r: res, g2: geo2, Wx: widX, sc: score, Lx: lenX });
  }

  _geoAt(lenX, widX, heightX) {
    const { mods: mods, modsA: modsA, modsB: modsB } = this;
    const geo2 = {
      ...this.geo,
      auto: false,
      road: true,
      ext: [lenX, widX, heightX],
      ...(mods ? { mods: { ...mods, Lm: lenX / modsA, Wm: widX / modsB } } : {}),
    };
    geo2.int = StationGeo.inner(this.geo.type, geo2.ext, this.geo.t);
    return geo2;
  }

  /**
   * Расстановка в размере Lx × Wx: подходит — {r, g2, Wx}; шкафы заняли торцы — {…, alt}; дальше по длине не искать —
   * 'break'; эта длина не подходит — null.
   */
  tryLength(cand, lenX, heightX, { st: stage, ll: levelL, close }) {
    let geo2 = this._geoAt(lenX, cand.Wx, heightX);
    let res = this.fitAt(geo2, cand.m);
    if (res.level === 'error' || (this.mods && StationMods.cross(res.items, geo2).length)) return null;
    [res, geo2] = this.higher(res, geo2, cand);
    const stop = this.stopLength(res, cand, stage);
    if (stop) return stop;
    if (!this.accepted(res, stage, levelL, close)) return null;
    const ends = (res.doors || []).some(door => (door.why || []).some(x => /торцы заняты шкафами/.test(x)));
    return { r: res, g2: geo2, Wx: cand.Wx, alt: ends };
  }

  /** Над сервисными воротами — трубопровод и выброс воздуха коробом: контейнер выше, если места мало. */
  higher(res, geo2, cand) {
    const upper = this.size.overGate(res);
    if (!(upper > geo2.int[2])) return [res, geo2];
    const height2 = StationGeo.roundUp(upper + this.hOf);
    if (height2 > this.block.maxH) return [res, geo2];
    const geo3 = { ...geo2, ext: [geo2.ext[0], cand.Wx, height2] };
    geo3.int = StationGeo.inner(this.geo.type, geo3.ext, this.geo.t);
    const res3 = this.fitAt(geo3, cand.m);
    return res3.level === 'error' ? [res, geo2] : [res3, geo3];
  }

  /** Дальше по длине не искать: два ряда вышли одним, без пар ресиверов, не рекомендуемое, без продольного прохода. */
  stopLength(res, cand, stage) {
    if (cand.two && res.rows === 1) return 'break';
    if (this.lay.forcePairs && !res.items.some(i => i.pairEnd)) return 'break';
    if (
      stage === 'rec' &&
      (LayoutSize._warns(res).some(x => /^Проход|стоит в/.test(x)) || res.items.some(i => i.tight))
    )
      return 'break';
    return stage === 'gate' && res.items.some(i => i.ends) ? 'break' : null;
  }

  /** Подходит ли расстановка уровню: без сервисных ворот, с доступом ко всем сторонам, рекомендуемые промежутки. */
  accepted(res, stage, levelL, close) {
    const warns = LayoutSize._warns(res);
    if (stage === 'gate' && (res.items.some(i => i.tight) || (res.doors || []).some(door => door.kind !== 'entry')))
      return false;
    if ((stage === 'gate' || stage === 'acc' || close) && warns.some(x => /не подойти/.test(x))) return false;
    return !(levelL === 0 && warns.some(x => /^Промежутки|^Отступы/.test(x)));
  }

  /** Принятый размер: плотность, замечания исключений, мягкие замечания. */
  done({ r: res, g2: geo2, Wx: widX }, { lw: levelW, m: mode, wide, close }) {
    res.geo = geo2;
    res.picked = true;
    res.density = LayoutMode.density(levelW, mode, res, wide);
    if (close) {
      const text = [res.density.id === 'max' ? res.density.text : '', 'ресиверы и фильтры вплотную']
        .filter(Boolean)
        .join(', ');
      res.density = { id: 'max', title: 'Максимально плотно', text };
    }
    if (this.fixL) {
      res.issues.push({
        level: 'info',
        fixL: true,
        text: `Длина задана: ${Mm.text(this.fixL)} мм — компоновка «${res.density.title}» (${res.density.text}); ширина и высота — по оборудованию.`,
      });
    }
    LayoutMode.soft(res);
    if (close) {
      res.issues.push({
        level: 'warn',
        close: true,
        text: 'Ресиверы и фильтры стоят вплотную друг к другу (промежутки — меньше «плотно» в правилах компоновки): исключение, чтобы станция прошла по габариту перевозки и ресиверы остались внутри (решение ПНЕВМОТЕХ: вплотную — только если иначе не в габарите). Осмотр — спереди и сбоку, через промежутки пар.',
      });
    }
    if (wide) {
      const road = Mm.text(StationGeo.ROAD_W);
      res.issues.push({
        level: 'warn',
        wide: true,
        text: `Негабарит: ширина ${Mm.text(widX)} мм — шире габарита перевозки (без спецразрешения — до ${road} мм). Исключение: в ${road} мм не помещается даже плотно и без продольного прохода — перевозка со спецразрешением; иначе — две станции или меньше оборудования.`,
      });
    }
    return res;
  }
}

/** Удлинение подобранного контейнера, чтобы встали жалюзи или конвекторы. */
class Grower {
  constructor(size, plan, bad) {
    const [len0, wid, height] = plan.geo.ext;
    const mods = plan.geo.mods;
    Object.assign(this, { lay: size.lay, plan, bad, len0, wid, height, mods, modsA: mods ? mods.a : 1 });
    this.step = StationGeo.STEP * this.modsA;
    this.maxL = StationMatrix.fit().maxL * this.modsA;
  }

  /** Расстановка в длине Lx (в том же режиме); жалюзи или конвекторы не встали — null. */
  placeAt(lenX) {
    const { lay, mods: mods, wid: wid, height: height, modsA: modsA } = this;
    const size = mods ? `${lenX / modsA} × ${wid / mods.b} × ${height}` : `${lenX} × ${wid} × ${height}`;
    const input = {
      ...lay.input,
      _grow: true,
      _mode: this.plan.mode || {},
      cont: { ...lay.cont, size, sizeAuto: false },
    };
    const plan2 = new lay.constructor(input).run();
    return plan2.level === 'error' || !plan2.vent || this.bad(plan2) ? null : plan2;
  }

  /** Конвекторам нет места — длиннее не больше чем на fit.growHeat. */
  heat() {
    const last = Math.min(this.maxL, this.len0 + StationMatrix.fit().growHeat * this.modsA);
    for (let lenX = this.len0 + this.step; lenX <= last; lenX += this.step) {
      const plan2 = this.placeAt(lenX);
      if (plan2) return this.accept(plan2, lenX, 'конвекторы отопления');
    }
    return this.plan;
  }

  /** Жалюзи не встают — длиннее до fit.growVent: шагами по 5, затем наименьшая длина с шагом 1. */
  vent() {
    const { step } = this;
    const last = Math.min(this.maxL, this.len0 + StationMatrix.fit().growVent * this.modsA);
    for (let lenX = this.len0 + 5 * step; lenX <= last; lenX += 5 * step) {
      const plan2 = this.placeAt(lenX);
      if (!plan2) continue;
      for (let len2 = lenX - 4 * step; len2 < lenX; len2 += step) {
        const shorter = len2 > this.len0 ? this.placeAt(len2) : null;
        if (shorter) return this.accept(shorter, len2, 'жалюзи притока и выброса');
      }
      return this.accept(plan2, lenX, 'жалюзи притока и выброса');
    }
    return this.plan;
  }

  /** Принимает расстановку, если она лучше прежней. */
  accept(plan2, lenX, what) {
    const { plan } = this;
    plan2.geo.auto = true;
    plan2.picked = true;
    plan2.density = plan.density;
    LayoutMode.soft(plan2);
    const wide = plan.issues.filter(i => i.wide);
    if (wide.length) {
      plan2.issues.unshift(...wide);
      if (plan2.level === 'ok') plan2.level = 'warn';
    }
    plan2.issues.push({
      level: 'info',
      text: `Длина контейнера ${Mm.text(lenX)} мм (по оборудованию — ${Mm.text(this.len0)} мм): так помещаются ${what}.`,
    });
    return plan2;
  }
}
