import { Num } from './num.js';
import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationTidy } from './station-tidy.js';

/**
 * Монтаж и демонтаж: распашные ворота в торце (у компрессорной и насосной — всегда, по возможности в дальнем торце; у
 * морского — его штатные двери), сервисные ворота за агрегатом, стоящим плотно к стене, и в боковой стене напротив того,
 * что к торцу не провезти. Осушителям и ресиверам сервисных ворот не делают.
 */
export class LayoutGates {
  static _onFloor = i => (i.mount === 'floor' || i.mount === 'frame') && !i.tank;

  static VIA_GATES = /, монтаж и демонтаж — через ворота в торце$/;

  constructor(lay) {
    this.lay = lay;
  }

  /** Вид обслуживают сзади (сторона «З») и ему допускаются сервисные ворота за ним. */
  static gated(kind) {
    return (
      kind !== 'dgu' &&
      kind !== 'cabinet' &&
      kind !== 'tank' &&
      !StationMatrix.noDoor(kind) &&
      StationMatrix.sides(kind).B
    );
  }

  /** Стоит плотно к стене: сзади свободно меньше access.back — обслуживание и демонтаж через ворота за ним. */
  static tight(item) {
    return (
      LayoutGates.gated(item.kind) &&
      LayoutGates._onFloor(item) &&
      !item.slot &&
      !item.cross &&
      item.back < StationMatrix.access().back
    );
  }

  /** Полоса прохода поперёк [от, до], мм: один ряд — от стены прохода до оборудования, два — между рядами. */
  static aisleBand(res, wid) {
    const floor = res.items.filter(i => LayoutGates._onFloor(i) && !i.cross);
    if (!floor.length) return [0, wid];
    if (res.rows !== 2) return [0, Math.min(...floor.map(i => i.y))];
    const rowA = floor.filter(i => i.row === 1);
    const rowB = floor.filter(i => i.row !== 1);
    return [
      rowA.length ? Math.max(...rowA.map(i => i.y + i.ly)) : 0,
      rowB.length ? Math.min(...rowB.map(i => i.y)) : wid,
    ];
  }

  static aisleMid(res, wid) {
    const [low, high] = this.aisleBand(res, wid);
    return (low + high) / 2;
  }

  /** Что не вынести через дверь оператора — стоя, а сосуды, фильтры, шкафы и баки — и наклонив. [{it, narrow, why}] */
  bulky(res, geo) {
    const entryOpen = this.lay.exits.entryOpen(geo, res.door);
    const pass = StationMatrix.move().pass;
    const out = [];
    for (const item of res.items.filter(i => LayoutGates._onFloor(i) && i.kind !== 'dgu')) {
      const tilt = StationMatrix.tilt(item.kind);
      const [least, mid] = [item.l, item.w, item.h].sort((left, right) => left - right);
      const narrow = tilt ? least : Math.min(item.l, item.w);
      const fits = tilt
        ? (least + 2 * pass <= entryOpen.w && mid + pass <= entryOpen.h) ||
          (mid + 2 * pass <= entryOpen.w && least + pass <= entryOpen.h)
        : narrow + 2 * pass <= entryOpen.w && item.h + pass <= entryOpen.h;
      if (!fits) {
        out.push({
          it: item,
          narrow,
          why: `поз. ${item.pos} ${tilt ? 'и наклонённым ' : ''}не проходит в дверь оператора (${Mm.text(item.l)} × ${Mm.text(item.w)} × ${Mm.text(item.h)} мм)`,
        });
      }
    }
    return out;
  }

  /** Через ворота в торце: компрессоры (кроме стоящих плотно к стене) и всё, что не проходит в дверь оператора. */
  mounts(res, geo) {
    const big = this.bulky(res, geo).filter(one => !LayoutGates.tight(one.it));
    const compressors = res.items.filter(
      i => i.kind === 'compressor' && i.mount === 'floor' && !LayoutGates.tight(i) && !big.some(one => one.it === i),
    );
    for (const item of compressors) {
      big.push({
        it: item,
        narrow: Math.min(item.l, item.w),
        why: `поз. ${item.pos} — компрессор (${Mm.text(item.l)} × ${Mm.text(item.w)} × ${Mm.text(item.h)} мм): к нему есть доступ для обслуживания, монтаж и демонтаж — через ворота в торце`,
      });
    }
    return big;
  }

  /** Ширина пути к торцу side для агрегата it — по проходу мимо соседей и шкафов на стене ниже его верха, мм. */
  pathTo(item, side, res, geo) {
    const [len, wid] = geo.int;
    const left = side === 'left';
    const low = left ? geo.x0 || 0 : item.x;
    const high = left ? item.x + item.lx : len;
    const floor = res.items.filter(
      other => other !== item && LayoutGates._onFloor(other) && other.x < high && other.x + other.lx > low,
    );
    let aisle =
      res.rows === 2 ? this.betweenRows(res, floor, wid) : Math.min(...floor.map(other => other.aisle), Infinity);
    for (const cabinet of res.items.filter(
      cab =>
        cab.mount === 'wall' && cab.wall === 'front' && cab.x < high && cab.x + cab.lx > low && cab.z < item.h + 50,
    )) {
      const under = floor.filter(other => other.x < cabinet.x + cabinet.lx && other.x + other.lx > cabinet.x);
      aisle = Math.min(aisle, (under.length ? Math.min(...under.map(other => other.y)) : wid) - cabinet.ly);
    }
    return aisle;
  }

  betweenRows(res, floor, wid) {
    const mid = LayoutGates.aisleMid(res, wid);
    const rowA = floor.filter(other => other.y + other.ly <= mid);
    const rowB = floor.filter(other => other.y >= mid);
    return (
      (rowB.length ? Math.min(...rowB.map(other => other.y)) : wid) -
      (rowA.length ? Math.max(...rowA.map(other => other.y + other.ly)) : 0)
    );
  }

  /**
   * Двери и ворота: ворота в торце для того, что туда провезти (дальний торец — по возможности), второй торец — для
   * остального или длинной цепочки, сервисные ворота — стоящему плотно к стене и тому, что к торцам не провезти.
   */
  plan(res, geo, avoid = []) {
    Object.assign(res, { gates: null, gates2: null, doors: [], exit: null });
    for (const item of res.items) item.tight = LayoutGates.tight(item);
    if (res.ends) {
      this.ends(res, geo);
      return;
    }
    const len = geo.int[0];
    const x0 = geo.x0 || 0;
    const dgu = res.items.some(i => i.kind === 'dgu' && !i.tank && len - (i.x + i.lx) <= 600);
    const floor = res.items.filter(LayoutGates._onFloor);
    if (geo.sea && geo.door && res.door !== 'end') res.gates = this.seaDoors(geo);
    const ctx = { r: res, geo, fl: floor, big: this.mounts(res, geo) };
    ctx.free = side => !avoid.includes(side) && (side === 'left' ? x0 === 0 && res.door !== 'end' : !dgu);
    ctx.sides = res.gates ? ['left'] : ['right', 'left'].filter(ctx.free);
    ctx.reach = (big, side) => big.narrow + 2 * StationMatrix.move().pass <= this.pathTo(big.it, side, res, geo);
    const always = !dgu && floor.some(i => i.kind === 'compressor' || i.kind === 'pump');
    const best = this.mainGate(ctx, always);
    let far = ctx.big.filter(big => !best || !best.ok.includes(big));
    far = this.secondGate(ctx, best, far);
    far = far.filter(big => !this.toGate(res, geo, big, ctx.sides)).map(big => this.sideWhy(big, ctx, avoid));
    const rear = res.items.filter(i => i.tight).map(item => ({ it: item, rear: true, why: this.rearWhy(item) }));
    res.side = [...rear, ...far];
    res.doors = this.sideDoors(res.side, res, geo);
    StationTidy.doors(res.doors);
    this.regate(res, geo);
    this.lay.exits.second(res, geo);
  }

  rearWhy(item) {
    return `поз. ${item.pos} стоит в ${Mm.text(item.back)} мм от стены (для обслуживания сзади нужно не меньше ${Mm.text(StationMatrix.access().back)} мм) — обслуживание сзади, монтаж и демонтаж через них`;
  }

  gateFrom(ctx, side, list) {
    const units = list.length
      ? list.map(big => big.it)
      : ctx.fl.filter(i => i.kind === 'compressor' || i.kind === 'pump');
    return this.gateFor(ctx.r, ctx.geo, side, units);
  }

  /** Ворота в торце, куда провезти больше всего; у компрессорной и насосной — всегда. */
  mainGate(ctx, always) {
    const { r: res } = ctx;
    let best = null;
    for (const side of ctx.sides) {
      const ok = ctx.big.filter(big => ctx.reach(big, side));
      if (ok.length && (!best || ok.length > best.ok.length)) best = { s: side, ok };
    }
    if (!best && always && ctx.sides.length && !res.gates) best = { s: ctx.sides[0], ok: [] };
    if (!best) return null;
    if (!res.gates) res.gates = this.gateFrom(ctx, best.s, best.ok);
    for (const big of best.ok) this.addTo(res.gates, big.it.pos, big.why);
    return best;
  }

  /** Агрегат через эти ворота (одна позиция — один раз). */
  addTo(gate, pos, why) {
    if (gate.pos.includes(pos)) return;
    gate.pos.push(pos);
    gate.why.push(why);
  }

  /** До ворот не провезти — ворота и во втором торце; цепочка длиннее gate.twoAt — ворота с обоих торцов. */
  secondGate(ctx, best, far) {
    const { r: res } = ctx;
    const other = this.otherSide(res);
    if (!other || !ctx.free(other) || (res.gates.sea && other === 'left')) return far;
    const ok = far.filter(big => ctx.reach(big, other));
    const used = this.chainLength(ctx.fl);
    const twoAt = StationMatrix.gate().twoAt;
    if (!ok.length && used <= twoAt) return far;
    res.gates2 = this.gateFrom(ctx, other, ok.length ? ok : (best && best.ok) || []);
    for (const big of ok) {
      res.gates2.pos.push(big.it.pos);
      res.gates2.why.push(big.why.replace(/ через ворота в торце$/, ' через ворота во втором торце'));
    }
    if (!ok.length)
      res.gates2.why.push(
        `оборудование стоит на ${Mm.text(used)} мм — длиннее ${Mm.text(twoAt)} мм: ворота с обоих торцов`,
      );
    return far.filter(big => !ok.includes(big));
  }

  /** Длина цепочки оборудования на полу, мм. */
  chainLength(floor) {
    return floor.length ? Math.max(...floor.map(i => i.x + i.lx)) - Math.min(...floor.map(i => i.x)) : 0;
  }

  otherSide(res) {
    if (!res.gates) return null;
    return res.gates.wall === 'left' ? 'right' : 'left';
  }

  /** Почему сервисные ворота сбоку: к торцу не провезти или торцы заняты. */
  sideWhy(big, { r: res, geo, sides }, avoid) {
    const base = big.why.replace(LayoutGates.VIA_GATES, '');
    if (!sides.length) {
      const busy = avoid.length
        ? ', торцы заняты шкафами на стене'
        : ', торцы заняты (отсек бака, дверь-жалюзи ДГУ, вход оператора)';
      return { ...big, why: base + busy };
    }
    const width = Math.max(0, ...sides.map(side => this.pathTo(big.it, side, res, geo)).filter(Number.isFinite));
    return {
      ...big,
      why: `${base}, по проходу к торцу не провезти (${width ? `проход ${Mm.text(width)} мм, ` : ''}агрегат — ${Mm.text(big.narrow)} мм)`,
    };
  }

  /** Осушитель или ресивер, которого к воротам не провезти, — через ближние ворота в торце (соседнее переставляют). */
  toGate(res, geo, big, sides) {
    if (!StationMatrix.noDoor(big.it.kind)) return false;
    const len = geo.int[0];
    const x0 = geo.x0 || 0;
    const far = side => (side === 'left' ? big.it.x - x0 : len - big.it.x - big.it.lx);
    let gate = [res.gates, res.gates2].filter(Boolean).sort((left, right) => far(left.wall) - far(right.wall))[0];
    if (!gate) {
      const side = sides.slice().sort((left, right) => far(left) - far(right))[0];
      if (!side) return false;
      gate = res.gates = this.gateFor(res, geo, side, [big.it]);
    }
    if (!gate.pos.includes(big.it.pos)) {
      gate.pos.push(big.it.pos);
      gate.why.push(
        `${big.why.replace(LayoutGates.VIA_GATES, '')}: сервисных дверей осушителям и ресиверам не делают — монтаж и демонтаж через ворота в торце, при демонтаже соседнее оборудование переставляют`,
      );
    }
    return true;
  }

  /** Штатные двери морского контейнера в торце у входа — как ворота в торце. */
  seaDoors(geo) {
    const wid = geo.int[1];
    const doorW = Math.min(geo.door[0], wid);
    return {
      wall: 'left',
      y0: Math.round((wid - doorW) / 2),
      y1: Math.round((wid + doorW) / 2),
      w: doorW,
      h: geo.door[1],
      leaves: 2,
      pos: [],
      why: [],
      sea: true,
    };
  }

  /** Ворота в торце по итогу: ширина — по агрегатам, которые через них монтируют, высота — по самому высокому. */
  regate(res, geo) {
    for (const gate of [res.gates, res.gates2].filter(cand => cand && !cand.sea)) {
      const units = res.items.filter(i => gate.pos.includes(i.pos) && LayoutGates._onFloor(i));
      const fixed = this.gateFor(res, geo, gate.wall, units);
      for (const k of ['y0', 'y1', 'w', 'h', 'full', 'off', 'offWhy', 'manual']) gate[k] = fixed[k];
    }
  }

  /** Без продольного прохода: компрессорам — ворота с обеих сторон и в торце, ресиверам у дальнего торца — ворота там. */
  ends(res, geo) {
    const comps = res.items.filter(i => i.ends);
    const pairs = res.items.filter(i => i.pairEnd);
    for (const item of comps) item.tight = false;
    res.gates = geo.sea && geo.door ? this.seaDoors(geo) : this.gateFor(res, geo, 'left', comps);
    const many = comps.length > 1;
    const compPos = Num.uniq(comps.map(i => i.pos));
    res.gates.pos.push(...compPos);
    res.gates.why.push(
      `поз. ${compPos.join(', ')} — ${many ? 'компрессоры в ряд от торца' : 'компрессор у торца'} без продольного прохода: обслуживание сбоку, монтаж и демонтаж — через ворота в торце${many ? ' и сервисные ворота' : ''}`,
    );
    if (pairs.length) {
      const pairPos = Num.uniq(pairs.map(i => i.pos));
      res.gates2 = this.gateFor(res, geo, 'right', pairs);
      res.gates2.pos.push(...pairPos);
      res.gates2.why.push(
        `поз. ${pairPos.join(', ')} — ресиверы в два ряда у дальнего торца: осмотр, обслуживание, монтаж и демонтаж — через ворота в торце`,
      );
    }
    const side = comps.flatMap(item =>
      ['front', 'back'].map(wall => ({
        it: item,
        wall,
        both: true,
        rear: true,
        why: `поз. ${item.pos} — без продольного прохода: обслуживание ${wall === 'front' ? 'спереди' : 'сзади'}`,
      })),
    );
    const mid = this.betweenCompressors(comps);
    side.push(...this.endsOthers(res, geo, comps, pairs));
    res.side = side;
    res.doors = mid;
    res.doors = [...this.sideDoors(side, res, geo), ...mid];
    this.regate(res, geo);
    this.lay.exits.second(res, geo);
  }

  /** Дверь оператора между компрессорами — доступ к ним сбоку. */
  betweenCompressors(comps) {
    const entry = LayoutOpening.ENTRY;
    const entryW = entry[1] - entry[0];
    const entryH = StationMatrix.door().h + 100;
    const sorted = comps.slice().sort((left, right) => left.x - right.x);
    return sorted.slice(1).map((next, i) => {
      const x0 = Math.round((sorted[i].x + sorted[i].lx + next.x - entryW) / 2);
      return {
        wall: 'front',
        x0,
        x1: x0 + entryW,
        w: entryW,
        h: entryH,
        leaves: 1,
        kind: 'entry',
        between: true,
        pos: [],
        why: [`между компрессорами поз. ${sorted[i].pos} и ${next.pos} — доступ к ним сбоку`],
      };
    });
  }

  /** Остальное, что не пройдёт в дверь оператора: к воротам в торце, иначе — сервисные ворота напротив. */
  endsOthers(res, geo, comps, pairs) {
    const pass = StationMatrix.move().pass;
    const side = [];
    for (const big of this.bulky(res, geo).filter(x => !comps.includes(x.it) && !pairs.includes(x.it))) {
      const gate = [res.gates, res.gates2].find(
        cand => cand && big.narrow + 2 * pass <= this.pathTo(big.it, cand.wall, res, geo),
      );
      if (gate) this.addTo(gate, big.it.pos, `${big.why}, монтаж и демонтаж — через ворота в торце`);
      else if (!this.toGate(res, geo, big, [])) side.push({ ...big, why: `${big.why}, к воротам в торце не провезти` });
    }
    return side;
  }

  /**
   * Распашные монтажные ворота в торце s для агрегатов U: ширина — по ним, высота — по самому высокому оборудованию
   * станции (в обоих торцах одинаковая); по оси торца, смещение — только если агрегат по проходу у стены иначе не провезти
   * (или вручную, gate.off в требованиях); шире доли торца — во весь торец.
   */
  gateFor(res, geo, side, units) {
    const [, wid, height] = geo.int;
    const pad = LayoutOpening.gaps(geo).eW;
    const wallT = geo.t || 0;
    const gateRule = StationMatrix.gate();
    const narrow = Math.max(0, ...units.map(i => Math.min(i.l, i.w)));
    const tallest = Math.max(0, ...res.items.filter(LayoutGates._onFloor).map(i => i.h));
    const needW = Math.max(gateRule.minW, Math.ceil((narrow + gateRule.addW + 2 * wallT) / 100) * 100);
    const full = needW >= gateRule.full * wid || needW > wid - 2 * pad;
    const width = full ? wid - 2 * pad : needW;
    const fromY = Math.round((wid - width) / 2);
    const place = full
      ? { y0: pad, off: 0, why: '' }
      : this.offAxis(res, { W: wid, w: width, yc: fromY, nw: narrow, pad, U: units });
    const own = (this.lay.input.req && this.lay.input.req.gate) || {};
    const manual = Boolean(Number.isFinite(own.off) && own.off);
    if (!full && manual) {
      const y0 = Math.round(Math.max(pad, Math.min(wid - pad - width, fromY + own.off)));
      Object.assign(place, { y0, off: y0 - fromY, why: String(own.why || '').trim() });
    }
    const gateH = Math.min(
      height - gateRule.top,
      Math.max(gateRule.minH, Math.ceil((tallest + gateRule.addH + wallT) / 50) * 50),
    );
    return {
      wall: side,
      y0: place.y0,
      y1: place.y0 + width,
      w: width,
      h: gateH,
      leaves: 2,
      pos: [],
      why: [],
      full,
      off: place.off,
      offWhy: place.why,
      manual,
    };
  }

  /** Смещение ворот от оси к проходу у стены: агрегат по оси над проходом не провезти. */
  offAxis(res, { W: wid, w: width, yc: fromY, nw: narrow, pad, U: units }) {
    const band = LayoutGates.aisleBand(res, wid);
    const needW = narrow + 2 * StationMatrix.move().pass;
    const lap = y => Math.min(y + width, band[1]) - Math.max(y, band[0]);
    if (!units.length || needW > band[1] - band[0] + 1e-9 || !(lap(fromY) < needW - 1e-9))
      return { y0: fromY, off: 0, why: '' };
    const front = band[1] <= wid / 2;
    const y = front ? Math.min(fromY, band[1] - needW) : Math.max(fromY, band[0] + needW - width);
    const y0 = Math.round(Math.max(pad, Math.min(wid - pad - width, y)));
    const off = y0 - fromY;
    const why = off
      ? `смещены на ${Mm.text(Math.abs(off))} мм от оси торца к проходу у ${front ? 'передней' : 'задней'} стены: агрегат шириной ${Mm.text(narrow)} мм провозят по проходу ${Mm.text(Math.round(band[1] - band[0]))} мм, по оси торца проём над проходом уже агрегата`
      : '';
    return { y0, off, why };
  }

  /** Со шкафами на стене: проход до ворот ещё есть; нет — тому агрегату сервисные ворота в боковой стене. */
  recheck(res, geo) {
    const gate = res.gates;
    const side = res.side || [];
    delete res.side;
    if (!gate || !gate.pos.length) return;
    const pass = StationMatrix.move().pass;
    const lost = this.mounts(res, geo).filter(
      big =>
        gate.pos.includes(big.it.pos) &&
        !StationMatrix.noDoor(big.it.kind) &&
        !side.some(cand => cand.it === big.it) &&
        big.narrow + 2 * pass > this.pathTo(big.it, gate.wall, res, geo),
    );
    if (!lost.length) return;
    for (const big of lost) {
      const k = gate.pos.indexOf(big.it.pos);
      if (k < 0) continue;
      gate.pos.splice(k, 1);
      gate.why = gate.why.filter(text => !text.startsWith(`поз. ${big.it.pos} `));
    }
    if (!gate.pos.length && !gate.sea) {
      if (gate.wicket && !res.exit) res.exit = this.lay.exits.endExit(res, geo, 'right');
      res.gates = null;
    }
    const keep = res.doors.filter(door => door.kind === 'entry');
    const moved = lost.map(big => ({
      ...big,
      why: `${big.why.replace(LayoutGates.VIA_GATES, '')}, до ворот в торце не провезти мимо шкафов на стене`,
    }));
    res.doors = [...this.sideDoors([...side, ...moved], res, geo), ...keep];
  }

  /**
   * Сервисные распашные ворота (уже створки — дверь): стоящему плотно к стене — в стене за ним, остальным — в боковой
   * напротив (два ряда — в стене за ним); мимо дверей оператора; соседние — одними воротами до service.max, иначе рядом.
   */
  sideDoors(list, res, geo) {
    const [len, , height] = geo.int;
    const wallT = geo.t || 0;
    const { gap, eL: edges } = LayoutOpening.gaps(geo);
    const doorRule = LayoutOpening.DOOR;
    const ctx = {
      gap,
      lo: Math.max((geo.x0 || 0) + doorRule.pad, edges),
      hi: len - edges,
      ex: res.door === 'side' ? this.lay.exits.entrySpan(res, geo) : null,
      keep: (res.doors || []).filter(door => door.kind === 'entry'),
    };
    const out = list.map(cand => this.serviceDoor(cand, res, { ...ctx, T: wallT, H: height }));
    return this.spaced(this.merged(out, ctx), ctx);
  }

  wallFor({ it: item, rear, wall }, res) {
    if (wall) return wall;
    const two = res.rows === 2;
    if (rear) return two && item.row === 1 ? 'front' : 'back';
    return two && item.row !== 1 ? 'back' : 'front';
  }

  serviceDoor(cand, res, { gap, lo: low, hi: high, ex: entry, keep, T: wallT, H: height }) {
    const { it: item, why, rear, both } = cand;
    const wall = this.wallFor(cand, res);
    const width = LayoutOpening.svcW(item.lx, wallT);
    let from = Math.max(low, Math.min(high - width, item.x + item.lx / 2 - width / 2));
    if (wall === 'front' && entry && from < entry[1] + gap && from + width > entry[0] - gap) {
      from =
        from + width / 2 < (entry[0] + entry[1]) / 2 && entry[0] - gap - width >= low
          ? entry[0] - gap - width
          : Math.min(high - width, entry[1] + gap);
    }
    for (const k of keep.filter(x => wall === x.wall)) {
      if (from < k.x1 + gap && from + width > k.x0 - gap)
        from = k.x0 - gap - width >= low ? k.x0 - gap - width : Math.min(high - width, k.x1 + gap);
    }
    return {
      wall,
      x0: Math.round(from),
      x1: Math.round(from + width),
      h: LayoutOpening.svcH(item.h, wallT, rear, height),
      kind: 'service',
      pos: [item.pos],
      why: [why],
      rear: Boolean(rear),
      both: Boolean(both),
    };
  }

  /** Соседние на одной стене — одними воротами, пока не шире service.max; иначе — рядом через door.gap. */
  merged(out, { gap, hi: high }) {
    const doorRule = LayoutOpening.DOOR;
    const got = [];
    for (const door of out.sort((left, right) => left.wall.localeCompare(right.wall) || left.x0 - right.x0)) {
      const last = got[got.length - 1];
      if (last && last.wall === door.wall && door.x0 < last.x1 + gap) {
        if (Math.max(last.x1, door.x1) - last.x0 <= doorRule.max) {
          this.join(last, door);
          continue;
        }
        const width = door.x1 - door.x0;
        door.x0 = last.x1 + gap;
        door.x1 = Math.min(high, door.x0 + width);
        if (door.x1 - door.x0 < doorRule.min) continue;
      }
      got.push(door);
    }
    return got;
  }

  join(last, door) {
    last.x1 = Math.max(last.x1, door.x1);
    last.h = Math.max(last.h, door.h);
    last.rear = last.rear || door.rear;
    for (const v of door.pos) if (!last.pos.includes(v)) last.pos.push(v);
    for (const text of door.why) if (!last.why.includes(text)) last.why.push(text);
  }

  /** Итог по стене: мимо дверей оператора и друг от друга — не ближе door.gap; не уместилась — через соседние ворота. */
  spaced(got, ctx) {
    const res = [];
    for (const wall of ['front', 'back']) {
      let prev = null;
      for (const door of got.filter(right => right.wall === wall).sort((left, right) => left.x0 - right.x0)) {
        if (!this.fit(door, prev, ctx)) continue;
        res.push(door);
        prev = door;
      }
    }
    return res;
  }

  /** Сдвиг ворот мимо предыдущих и дверей оператора; уже service.min — не ставятся. */
  fit(door, prev, { gap, hi: high, ex: entry, keep }) {
    const doorRule = LayoutOpening.DOOR;
    const width = door.x1 - door.x0;
    const clash = (from, till) => door.x0 < till + gap && door.x1 > from - gap;
    const shift = x => Object.assign(door, { x0: x, x1: x + width });
    if (prev && door.x0 < prev.x1 + gap) shift(prev.x1 + gap);
    if (door.wall === 'front' && entry && clash(entry[0], entry[1])) shift(entry[1] + gap);
    for (const k of keep.filter(kept => kept.wall === door.wall)) if (clash(k.x0, k.x1)) shift(k.x1 + gap);
    door.x1 = Math.min(high, door.x1);
    if (door.x1 - door.x0 < doorRule.min) return false;
    door.w = door.x1 - door.x0;
    door.leaves = Math.max(1, Math.ceil(door.w / doorRule.leaf));
    return true;
  }
}
