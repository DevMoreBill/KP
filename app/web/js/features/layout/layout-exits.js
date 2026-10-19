import { LayoutGates } from './layout-gates.js';
import { LayoutItem } from './layout-item.js';
import { LayoutMode } from './layout-mode.js';
import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationNorms } from './station-norms.js';

const n = v => Mm.text(v);
const DGU_WALL = { right: 'в дальнем торце', left: 'в торце у входа', back: 'в задней стене' };
const WALL_NAME = {
  front: 'боковой стене (вход)',
  back: 'задней стене',
  left: 'торце у входа',
  right: 'дальнем торце',
};

/** Дальний конец ДГУ у торца (≤ 600 мм) — дверь-жалюзи там и выход. */
const dguAtEnd = (r, L) => r.items.some(i => i.kind === 'dgu' && !i.tank && L - (i.x + i.lx) <= 600);

/**
 * Дверь оператора (одностворчатая, наружу, с доводчиком), вторая дверь оператора — только если до выхода далеко или
 * шкафы длиннее 7 м, двери-жалюзи ДГУ, проёмы с отступами, итог по дверям и воротам.
 */
export class LayoutExits {
  constructor(lay) {
    this.lay = lay;
  }

  /** Проём двери оператора в свету {w, h}: у морского в два ряда — его двери в торце. */
  entryOpen(geo, door) {
    const pass = StationMatrix.move().pass;
    if (door === 'end' && geo.sea && geo.door)
      return { w: Math.min(geo.door[0], geo.int[1]) - 2 * pass, h: geo.door[1] - pass };
    const d = StationMatrix.door();
    return { w: d.w, h: d.h };
  }

  /** Дверь оператора: в стене прохода у торца ('side') или в торце по оси прохода ('end'); без прохода — null. */
  entry(r, geo) {
    const E = LayoutOpening.ENTRY;
    const w = E[1] - E[0];
    const h = StationMatrix.door().h + 100;
    const W = geo.int[1];
    if (r.door === 'side') {
      const ex = this.entrySpan(r, geo);
      return { wall: 'front', x0: ex[0], x1: ex[1], w, h };
    }
    if (r.door !== 'end') return null;
    if (geo.sea && geo.door) {
      const dw = Math.min(geo.door[0], W);
      return {
        wall: 'left',
        y0: Math.round((W - dw) / 2),
        y1: Math.round((W + dw) / 2),
        w: dw,
        h: geo.door[1],
        sea: true,
      };
    }
    const y0 = LayoutOpening.inWall(LayoutGates.aisleMid(r, W) - w / 2, w, W, LayoutOpening.gaps(geo).eW);
    return { wall: 'left', y0, y1: y0 + w, w, h };
  }

  /** Дверь оператора в стене прохода: [от, до] — у торца (за тамбуром) или между компрессором и следующим (r.entryX). */
  entrySpan(r, geo) {
    const E = LayoutOpening.ENTRY;
    const a = Math.max((geo.x0 || 0) + E[0], LayoutOpening.gaps(geo).eL);
    return r.entryX || [a, a + E[1] - E[0]];
  }

  /** Дверь оператора в торце по оси прохода; без сквозного прохода и оборудования за агрегатом — по оси торца. */
  endExit(r, geo, wall) {
    const W = geo.int[1];
    const E = LayoutOpening.ENTRY;
    const w = E[1] - E[0];
    const h = StationMatrix.door().h + 100;
    const behind =
      r.cross && r.items.some(i => (i.mount === 'floor' || i.mount === 'frame') && !i.cross && i.x >= r.cross.x1);
    const y0 =
      r.cross && !behind
        ? Math.round((W - w) / 2)
        : LayoutOpening.inWall(LayoutGates.aisleMid(r, W) - w / 2, w, W, LayoutOpening.gaps(geo).eW);
    return { wall, y0, y1: y0 + w, w, h };
  }

  /** Калитка в створке ворот в дальнем торце — если створка шире двери оператора с запасом. */
  wicket(G) {
    const min = StationMatrix.door().w;
    if (G.w / 2 < min + 150) return false;
    G.wicket = { w: Math.min(min, G.w / 2 - 150), h: Math.min(StationMatrix.door().h, G.h - 150) };
    return true;
  }

  /** Дверь оператора в стене прохода не ближе x к торцу: мимо сервисных ворот (door.gap). */
  sideDoor(r, a0, w, gap) {
    let a = a0;
    for (const d of r.doors.filter(q => q.wall === 'front').sort((p, q) => q.x0 - p.x0)) {
      if (a < d.x1 + gap && a + w > d.x0 - gap) a = d.x0 - gap - w;
    }
    return a;
  }

  entryDoor(a, w, why) {
    return {
      wall: 'front',
      x0: Math.round(a),
      x1: Math.round(a + w),
      w,
      h: StationMatrix.door().h + 100,
      leaves: 1,
      kind: 'entry',
      pos: [],
      why: [why],
    };
  }

  /**
   * Вторая дверь оператора — только если от дальней точки помещения до выхода больше exits.far или шкафы длиннее 7 м:
   * в стене прохода у дальнего торца, иначе калитка в воротах, выход через дверь-жалюзи ДГУ или дверь в торце.
   */
  second(r, geo) {
    if (r.cross) {
      this.crossSecond(r, geo);
      return;
    }
    const L = geo.int[0];
    const pairs = r.items.filter(i => i.pairEnd);
    const why = this.secondWhy(r, geo, pairs);
    if (!why) return;
    r.second = why;
    const E = LayoutOpening.ENTRY;
    const w = E[1] - E[0];
    const { gap, eL } = LayoutOpening.gaps(geo);
    const lim = pairs.length ? Math.min(...pairs.map(i => i.x)) - 200 : L;
    if (r.door === 'side') {
      const a = this.sideDoor(r, Math.min(L - Math.max(E[0], eL) - w, lim - w), w, gap);
      if (a >= this.entrySpan(r, geo)[1] + Math.max(1000, gap)) {
        r.doors.push(this.entryDoor(a, w, why));
        return;
      }
    }
    if (pairs.length) {
      this.closedEnd(r, why);
      return;
    }
    this.farExit(r, geo, L);
  }

  /** Дальний торец закрыт ресиверами парой — калитка и дверь там не выход; второй выход — ворота у входа. */
  closedEnd(r, why) {
    if (r.gates && r.gates.wall === 'left' && r.issues) {
      r.issues.push({
        level: 'info',
        text: `Выходы — дверь оператора и ворота в торце у входа: дальний торец закрыт ресиверами в два ряда, второй двери оператора до них места нет (${why}).`,
      });
    }
    delete r.second;
  }

  /** В дальнем торце: калитка в воротах (если ворот не двое), выход через дверь-жалюзи ДГУ, иначе дверь в торце. */
  farExit(r, geo, L) {
    const G = [r.gates, r.gates2].find(g => g && g.wall === 'right' && !g.sea);
    if (G && !(r.gates && r.gates2) && this.wicket(G)) return;
    if (dguAtEnd(r, L)) {
      r.secondDgu = true;
      return;
    }
    if (!G) r.exit = this.endExit(r, geo, 'right');
  }

  /** Почему нужна вторая дверь оператора; не нужна — ''. Выходы — дверь оператора, ворота в торце, двери-жалюзи ДГУ. */
  secondWhy(r, geo, pairs) {
    const L = geo.int[0];
    const x0 = geo.x0 || 0;
    const es = this.entrySpan(r, geo);
    const at = [r.door === 'side' ? (es[0] + es[1]) / 2 : x0];
    for (const G of [r.gates, r.gates2].filter(g => g && !(pairs.length && g.wall === 'right')))
      at.push(G.wall === 'left' ? 0 : L);
    if (dguAtEnd(r, L)) at.push(L);
    if (r.items.some(i => i.kind === 'dgu' && !i.tank && i.x - x0 <= 600 && i.rad === 'left')) at.push(x0);
    const far = Math.round(
      Math.max(Math.min(...at.map(a => Math.abs(a - x0))), Math.min(...at.map(a => Math.abs(L - a)))),
    );
    const X = StationMatrix.exits();
    if (far > X.far) return `от дальней точки помещения до выхода — ${n(far)} мм, больше ${n(X.far)} мм`;
    const cab = this.lay.eq.filter(e => e.kind === 'cabinet').reduce((s, e) => s + e.l * (e.qty || 1), 0);
    return cab > StationNorms.SHIELD ? `шкафы вдоль прохода — ${n(cab)} мм, длиннее 7 м (ПУЭ, п. 4.1.23)` : '';
  }

  /** Без сквозного прохода: вторая дверь оператора — во второй части (за агрегатом поперёк). */
  crossSecond(r, geo) {
    const L = geo.int[0];
    const E = LayoutOpening.ENTRY;
    const w = E[1] - E[0];
    const { gap, eL } = LayoutOpening.gaps(geo);
    const C = r.cross;
    r.second = `сквозного прохода нет — поз. ${C.pos} стоит поперёк станции: к нему сзади и к оборудованию за ним`;
    const a = this.sideDoor(r, L - Math.max(E[0], eL) - w, w, gap);
    if (a >= C.x1 + 100) {
      r.doors.push(this.entryDoor(a, w, r.second));
      return;
    }
    const G = r.gates2 && r.gates2.wall === 'right' ? r.gates2 : r.gates;
    if (G && G.wall === 'right' && !G.sea && this.wicket(G)) return;
    r.exit = this.endExit(r, geo, 'right');
  }

  /**
   * У каждой ДГУ напротив радиатора — двустворчатая дверь-жалюзи (шире на 200 мм, выше на 150): выброс воздуха радиатора
   * и проём для монтажа; радиатор дальше 600 мм от стены — нет.
   */
  dguDoors(r, geo) {
    const [L, W, H] = geo.int;
    const x0 = geo.x0 || 0;
    const pass = StationMatrix.move().pass;
    const h = g => Math.min(H - 100, Math.max(LayoutOpening.DOOR.h, g.h + 150));
    const out = [];
    for (const g of r.items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor')) {
      const rad = g.rad || 'right';
      if (rad === 'back') {
        if (W - (g.y + g.ly) > 600) continue;
        const pad = LayoutOpening.gaps(geo).eL;
        const w = Math.min(L - x0 - 2 * pad, LayoutOpening.dguDoorW(g.lx));
        const a = Math.round(Math.max(x0 + pad, Math.min(L - pad - w, g.x + g.lx / 2 - w / 2)));
        out.push({
          wall: 'back',
          x0: a,
          x1: a + w,
          w,
          h: h(g),
          leaves: 2,
          pos: g.pos,
          unit: g.unit,
          fits: w >= g.lx + 2 * pass,
        });
        continue;
      }
      if (rad === 'right' ? L - (g.x + g.lx) > 600 : g.x - x0 > 600) continue;
      const pad = LayoutOpening.gaps(geo).eW;
      const w = Math.min(W - 2 * pad, LayoutOpening.dguDoorW(g.ly));
      const y0 = Math.round(Math.max(pad, Math.min(W - pad - w, g.y + g.ly / 2 - w / 2)));
      out.push({
        wall: rad === 'left' ? 'left' : 'right',
        y0,
        y1: y0 + w,
        w,
        h: h(g),
        leaves: 2,
        pos: g.pos,
        unit: g.unit,
        fits: w >= g.ly + 2 * pass,
      });
    }
    return out;
  }

  /** Проёмы по стенам: [от, до, что] — двери, ворота, двери-жалюзи, вход в отсек бака. */
  openingsByWall(r) {
    const O = { front: [], back: [], left: [], right: [] };
    const put = (w, [a, b], t) => O[w] && O[w].push([a, b, t]);
    const span = d => (d.wall === 'front' || d.wall === 'back' ? [d.x0, d.x1] : [d.y0, d.y1]);
    for (const d of r.doors || [])
      put(d.wall, [d.x0, d.x1], d.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота');
    if (r.entry && !r.entry.sea) put(r.entry.wall, span(r.entry), 'дверь оператора');
    for (const g of [r.gates, r.gates2].filter(q => q && !q.sea)) put(g.wall, [g.y0, g.y1], 'ворота');
    if (r.exit) put(r.exit.wall, [r.exit.y0, r.exit.y1], 'дверь оператора');
    for (const d of r.dguDoors || []) put(d.wall, span(d), 'дверь-жалюзи ДГУ');
    this.fuelOpenings(r.fuel || {}, put);
    return O;
  }

  /** Вход в отсек бака: дверь в стене прохода или ворота в торце. */
  fuelOpenings(fuel, put) {
    if (fuel.door) put('front', [fuel.door.x0, fuel.door.x1], 'дверь отсека бака');
    if (fuel.gate) put('left', [fuel.gate.y0, fuel.gate.y1], 'ворота отсека бака');
  }

  /** Проёмы ближе door.edge к краю станции или ближе door.gap друг к другу — тексты замечаний. */
  openings(r, geo) {
    const [L, W] = geo.int;
    const Q = LayoutOpening.gaps(geo);
    const edge = StationMatrix.door().edge;
    const out = [];
    for (const [w, list] of Object.entries(this.openingsByWall(r))) {
      const lim = w === 'front' || w === 'back' ? [Q.eL, L - Q.eL] : [Q.eW, W - Q.eW];
      list.sort((a, b) => a[0] - b[0]);
      for (const [, , t] of list.filter(([a, b]) => a < lim[0] - 1 || b > lim[1] + 1)) {
        out.push(
          `${t[0].toUpperCase() + t.slice(1)} в ${WALL_NAME[w]} — ближе ${n(edge)} мм к краю станции: стена мала для проёма с отступами — проверьте у изготовителя или увеличьте контейнер.`,
        );
      }
      for (let k = 1; k < list.length; k++) {
        const gap = list[k][0] - list[k - 1][1];
        if (gap < Q.gap - 1)
          out.push(
            `В ${WALL_NAME[w]}: между проёмами (${list[k - 1][2]} и ${list[k][2]}) ${n(Math.max(0, gap))} мм — меньше ${n(Q.gap)} мм.`,
          );
      }
    }
    return [...new Set(out)];
  }

  /**
   * Двери и итог: дверь оператора, ворота, сервисные ворота, двери-жалюзи ДГУ — сведениями; проёмы и доступ к сторонам —
   * замечаниями; уровень и занятая длина.
   */
  finish(r, geo) {
    r.doors = r.doors || [];
    this.lay.gates.recheck(r, geo);
    this.doorNotes(r, geo);
    r.entry = this.entry(r, geo);
    r.dguDoors = this.dguDoors(r, geo);
    r.dguDoor = r.dguDoors[0] || null;
    for (const t of this.openings(r, geo)) r.issues.push({ level: 'warn', gap: true, text: t });
    this.dguNotes(r);
    r.access = this.lay.access.matrix(r, geo);
    for (const q of r.access.filter(x => x.miss.length)) {
      r.issues.push({
        level: 'warn',
        text: `Поз. ${q.pos}: к ${q.miss.map(k => this.lay.access.side(k)).join(' и ')} не подойти для обслуживания (${q.miss.map(k => q.s[k].t).join('; ')}) — нужен проход или сервисные ворота; увеличьте контейнер или поменяйте порядок в составе.`,
      });
    }
    r.level = this.level(r);
    r.used = LayoutItem.used(r.items, geo);
    delete r.segs;
  }

  level(r) {
    if (r.bad) return 'error';
    return r.issues.some(i => i.level === 'warn') ? 'warn' : 'ok';
  }

  /** Ворота в торце и сервисные ворота — сведениями; дверь оператора и вторая — одной строкой. */
  doorNotes(r, geo) {
    for (const q of [r.gates, r.gates2].filter(g => g && (g.pos.length || !g.sea)))
      r.issues.push({ level: 'info', text: this.gateText(q, r) });
    for (const { t, d, count } of this.serviceGroups(r)) {
      const via = d.rear && !d.both && !(r.gates && r.gates.pos.length) ? '; ворота в торце не нужны' : '';
      r.issues.push({
        level: 'info',
        text: `${t}${count > 1 ? ` (${count} шт.)` : ''} — для ${d.rear ? 'обслуживания, ' : ''}монтажа и демонтажа поз. ${d.pos.join(', ')}: ${d.why.join('; ')}${via}.`,
      });
    }
    const tight = new Set(r.doors.filter(d => d.rear).flatMap(d => d.pos));
    r.issues = r.issues.filter(i => !(i.tight != null && tight.has(i.tight)));
    r.issues.push({ level: 'info', text: this.entryText(r, geo) });
  }

  gateText(q, r) {
    if (q.sea)
      return `Монтаж и демонтаж поз. ${q.pos.join(', ')} — через штатные двери контейнера в торце (${n(q.w)} × ${n(q.h)} мм): ${q.why.join('; ')}.`;
    const far = q.wall === 'right';
    const exit = far && r.items.some(i => i.pairEnd) ? 'перед ними ресиверы в два ряда — это не выход' : 'это и выход';
    const what = q.pos.length
      ? ` — для монтажа и демонтажа поз. ${q.pos.join(', ')}`
      : ' — для монтажа и демонтажа оборудования';
    const why = q.why.length ? `: ${q.why.join('; ')}` : '';
    return `Распашные монтажные ворота ${q.full ? 'во весь торец ' : ''}${n(q.w)} × ${n(q.h)} мм в ${far ? 'дальнем торце' : 'торце у входа'}, открываются наружу (${exit})${what}${why}. ${LayoutMode.gateAxis(q)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя контейнера.`;
  }

  /** Одинаковые сервисные ворота — одной строкой с числом. */
  serviceGroups(r) {
    const groups = new Map();
    for (const d of r.doors.filter(q => q.kind !== 'entry')) {
      const t = `${d.leaves > 1 ? 'Сервисные распашные ворота' : 'Сервисная распашная дверь'} ${n(d.w)} × ${n(d.h)} мм в ${d.wall === 'back' ? 'задней' : 'боковой'} стене${this.serviceWhere(d)}`;
      const key = `${t}|${d.pos.join(',')}`;
      if (!groups.has(key)) groups.set(key, { t, d, count: 0 });
      groups.get(key).count++;
    }
    return [...groups.values()];
  }

  serviceWhere(d) {
    if (d.both) return d.wall === 'back' ? ' за компрессором' : ' перед компрессором';
    return d.rear ? ' за оборудованием' : '';
  }

  /** «Вход: дверь оператора …; вторая дверь оператора — … (почему)». */
  entryText(r, geo) {
    const E = this.entryOpen(geo, r.door);
    const G = r.gates;
    const who =
      r.door === 'end' && geo.sea
        ? 'штатные двери в торце'
        : `одностворчатая, ${n(E.w)} × ${n(E.h)} мм в свету, открывается наружу, с доводчиком`;
    const two =
      r.doors.some(d => d.kind === 'entry') ||
      r.exit ||
      (G && G.wicket) ||
      (r.gates2 && r.gates2.wicket) ||
      r.secondDgu;
    return `Вход: дверь оператора — ${who}${two ? `; вторая дверь оператора — ${this.secondWhere(r)} (${r.second})` : ''}.`;
  }

  secondWhere(r) {
    const G = r.gates;
    if (r.exit) return 'в дальнем торце по оси прохода';
    if (G && G.wicket) return `калитка ${n(G.wicket.w)} × ${n(G.wicket.h)} мм в створке ворот в дальнем торце`;
    return r.secondDgu ? 'выход через дверь-жалюзи ДГУ в дальнем торце' : 'в стене прохода у дальнего торца';
  }

  /** Двери-жалюзи ДГУ — сведениями (одинаковые — одной строкой). */
  dguNotes(r) {
    const groups = new Map();
    for (const d of r.dguDoors) {
      const key = [d.pos, d.wall, d.w, d.h, d.fits].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    for (const list of groups.values()) {
      const d = list[0];
      const many = list.length > 1 ? ` (${list.length} шт.): у каждой` : ':';
      const wide = d.fits ? '' : ' ДГУ шире проёма — демонтаж со снятием панели стены.';
      r.issues.push({
        level: 'info',
        text: `ДГУ поз. ${d.pos}${many} ${DGU_WALL[d.wall]} — двустворчатая дверь-жалюзи ${n(d.w)} × ${n(d.h)} мм — выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (отдельная сервисная дверь не нужна).${wide}`,
      });
    }
  }
}
