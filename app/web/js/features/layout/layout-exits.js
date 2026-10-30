import { LayoutGates } from './layout-gates.js';
import { LayoutItem } from './layout-item.js';
import { LayoutMode } from './layout-mode.js';
import { LayoutOpening } from './layout-opening.js';
import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { StationNorms } from './station-norms.js';

/**
 * Дверь оператора (одностворчатая, наружу, с доводчиком), вторая дверь оператора — только если до выхода далеко или
 * шкафы длиннее 7 м, двери-жалюзи ДГУ, проёмы с отступами, итог по дверям и воротам.
 */
export class LayoutExits {
  static DGU_WALL = { right: 'в дальнем торце', left: 'в торце у входа', back: 'в задней стене' };

  static WALL_NAME = {
    front: 'боковой стене (вход)',
    back: 'задней стене',
    left: 'торце у входа',
    right: 'дальнем торце',
  };

  /** Дальний конец ДГУ у торца (≤ 600 мм) — дверь-жалюзи там и выход. */
  static _dguAtEnd = (res, len) => res.items.some(i => i.kind === 'dgu' && !i.tank && len - (i.x + i.lx) <= 600);

  constructor(lay) {
    this.lay = lay;
  }

  /** Проём двери оператора в свету {w, h}: у морского в два ряда — его двери в торце. */
  entryOpen(geo, door) {
    const pass = StationMatrix.move().pass;
    if (door === 'end' && geo.sea && geo.door)
      return { w: Math.min(geo.door[0], geo.int[1]) - 2 * pass, h: geo.door[1] - pass };
    const doorRule = StationMatrix.door();
    return { w: doorRule.w, h: doorRule.h };
  }

  /** Дверь оператора: в стене прохода у торца ('side') или в торце по оси прохода ('end'); без прохода — null. */
  entry(res, geo) {
    const entry = LayoutOpening.ENTRY;
    const width = entry[1] - entry[0];
    const height2 = StationMatrix.door().h + 100;
    const wid = geo.int[1];
    if (res.door === 'side') {
      const span = this.entrySpan(res, geo);
      return { wall: 'front', x0: span[0], x1: span[1], w: width, h: height2 };
    }
    if (res.door !== 'end') return null;
    if (geo.sea && geo.door) {
      const doorW = Math.min(geo.door[0], wid);
      return {
        wall: 'left',
        y0: Math.round((wid - doorW) / 2),
        y1: Math.round((wid + doorW) / 2),
        w: doorW,
        h: geo.door[1],
        sea: true,
      };
    }
    const y0 = LayoutOpening.inWall(LayoutGates.aisleMid(res, wid) - width / 2, width, wid, LayoutOpening.gaps(geo).eW);
    return { wall: 'left', y0, y1: y0 + width, w: width, h: height2 };
  }

  /** Дверь оператора в стене прохода: [от, до] — у торца (за тамбуром) или между компрессором и следующим (r.entryX). */
  entrySpan(res, geo) {
    const entry = LayoutOpening.ENTRY;
    const from = Math.max((geo.x0 || 0) + entry[0], LayoutOpening.gaps(geo).eL);
    return res.entryX || [from, from + entry[1] - entry[0]];
  }

  /** Дверь оператора в торце по оси прохода; без сквозного прохода и оборудования за агрегатом — по оси торца. */
  endExit(res, geo, wall) {
    const wid = geo.int[1];
    const entry = LayoutOpening.ENTRY;
    const width = entry[1] - entry[0];
    const height2 = StationMatrix.door().h + 100;
    const behind =
      res.cross && res.items.some(i => (i.mount === 'floor' || i.mount === 'frame') && !i.cross && i.x >= res.cross.x1);
    const y0 =
      res.cross && !behind
        ? Math.round((wid - width) / 2)
        : LayoutOpening.inWall(LayoutGates.aisleMid(res, wid) - width / 2, width, wid, LayoutOpening.gaps(geo).eW);
    return { wall, y0, y1: y0 + width, w: width, h: height2 };
  }

  /** Калитка в створке ворот в дальнем торце — если створка шире двери оператора с запасом. */
  wicket(gate) {
    const min = StationMatrix.door().w;
    if (gate.w / 2 < min + 150) return false;
    gate.wicket = { w: Math.min(min, gate.w / 2 - 150), h: Math.min(StationMatrix.door().h, gate.h - 150) };
    return true;
  }

  /** Дверь оператора в стене прохода не ближе x к торцу: мимо сервисных ворот (door.gap). */
  sideDoor(res, start, width, gap) {
    let pos = start;
    for (const door of res.doors.filter(right => right.wall === 'front').sort((left, right) => right.x0 - left.x0)) {
      if (pos < door.x1 + gap && pos + width > door.x0 - gap) pos = door.x0 - gap - width;
    }
    return pos;
  }

  _entryDoor(from, width, why) {
    return {
      wall: 'front',
      x0: Math.round(from),
      x1: Math.round(from + width),
      w: width,
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
  second(res, geo) {
    if (res.cross) {
      this.crossSecond(res, geo);
      return;
    }
    const len = geo.int[0];
    const pairs = res.items.filter(i => i.pairEnd);
    const why = this.secondWhy(res, geo, pairs);
    if (!why) return;
    res.second = why;
    const entry = LayoutOpening.ENTRY;
    const width = entry[1] - entry[0];
    const { gap, eL: edgeL } = LayoutOpening.gaps(geo);
    const lim = pairs.length ? Math.min(...pairs.map(i => i.x)) - 200 : len;
    if (res.door === 'side') {
      const from = this.sideDoor(res, Math.min(len - Math.max(entry[0], edgeL) - width, lim - width), width, gap);
      if (from >= this.entrySpan(res, geo)[1] + Math.max(1000, gap)) {
        res.doors.push(this._entryDoor(from, width, why));
        return;
      }
    }
    if (pairs.length) {
      this.closedEnd(res, why);
      return;
    }
    this.farExit(res, geo, len);
  }

  /** Дальний торец закрыт ресиверами парой — калитка и дверь там не выход; второй выход — ворота у входа. */
  closedEnd(res, why) {
    if (res.gates && res.gates.wall === 'left' && res.issues) {
      res.issues.push({
        level: 'info',
        text: `Выходы — дверь оператора и ворота в торце у входа: дальний торец закрыт ресиверами в два ряда, второй двери оператора до них места нет (${why}).`,
      });
    }
    delete res.second;
  }

  /** В дальнем торце: калитка в воротах (если ворот не двое), выход через дверь-жалюзи ДГУ, иначе дверь в торце. */
  farExit(res, geo, len) {
    const gate = [res.gates, res.gates2].find(gate0 => gate0 && gate0.wall === 'right' && !gate0.sea);
    if (gate && !(res.gates && res.gates2) && this.wicket(gate)) return;
    if (LayoutExits._dguAtEnd(res, len)) {
      res.secondDgu = true;
      return;
    }
    if (!gate) res.exit = this.endExit(res, geo, 'right');
  }

  /** Почему нужна вторая дверь оператора; не нужна — ''. Выходы — дверь оператора, ворота в торце, двери-жалюзи ДГУ. */
  secondWhy(res, geo, pairs) {
    const len = geo.int[0];
    const x0 = geo.x0 || 0;
    const entrySpan = this.entrySpan(res, geo);
    const exitsX = [res.door === 'side' ? (entrySpan[0] + entrySpan[1]) / 2 : x0];
    for (const gate of [res.gates, res.gates2].filter(gate0 => gate0 && !(pairs.length && gate0.wall === 'right')))
      exitsX.push(gate.wall === 'left' ? 0 : len);
    if (LayoutExits._dguAtEnd(res, len)) exitsX.push(len);
    if (res.items.some(i => i.kind === 'dgu' && !i.tank && i.x - x0 <= 600 && i.rad === 'left')) exitsX.push(x0);
    const far = Math.round(
      Math.max(Math.min(...exitsX.map(pos => Math.abs(pos - x0))), Math.min(...exitsX.map(pos => Math.abs(len - pos)))),
    );
    const exitsRule = StationMatrix.exits();
    if (far > exitsRule.far)
      return `от дальней точки помещения до выхода — ${Mm.text(far)} мм, больше ${Mm.text(exitsRule.far)} мм`;
    const cab = this.lay.equip
      .filter(unit => unit.kind === 'cabinet')
      .reduce((acc, unit) => acc + unit.l * (unit.qty || 1), 0);
    return cab > StationNorms.SHIELD
      ? `шкафы вдоль прохода — ${Mm.text(cab)} мм, длиннее ${StationNorms.shieldText()} (ПУЭ, п. 4.1.23)`
      : '';
  }

  /** Без сквозного прохода: вторая дверь оператора — во второй части (за агрегатом поперёк). */
  crossSecond(res, geo) {
    const len = geo.int[0];
    const entry = LayoutOpening.ENTRY;
    const width = entry[1] - entry[0];
    const { gap, eL: edgeL } = LayoutOpening.gaps(geo);
    const cross = res.cross;
    res.second = `сквозного прохода нет — поз. ${cross.pos} стоит поперёк станции: к нему сзади и к оборудованию за ним`;
    const from = this.sideDoor(res, len - Math.max(entry[0], edgeL) - width, width, gap);
    if (from >= cross.x1 + 100) {
      res.doors.push(this._entryDoor(from, width, res.second));
      return;
    }
    const gate = res.gates2 && res.gates2.wall === 'right' ? res.gates2 : res.gates;
    if (gate && gate.wall === 'right' && !gate.sea && this.wicket(gate)) return;
    res.exit = this.endExit(res, geo, 'right');
  }

  /**
   * У каждой ДГУ напротив радиатора — двустворчатая дверь-жалюзи (шире на 200 мм, выше на 150): выброс воздуха радиатора
   * и проём для монтажа; радиатор дальше 600 мм от стены — нет.
   */
  dguDoors(res, geo) {
    const [len, wid, height] = geo.int;
    const x0 = geo.x0 || 0;
    const pass = StationMatrix.move().pass;
    const heightOf = dgu => Math.min(height - 100, Math.max(LayoutOpening.DOOR.h, dgu.h + 150));
    const out = [];
    for (const dgu of res.items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor')) {
      const rad = dgu.rad || 'right';
      if (rad === 'back') {
        if (wid - (dgu.y + dgu.ly) > 600) continue;
        const pad = LayoutOpening.gaps(geo).eL;
        const width = Math.min(len - x0 - 2 * pad, LayoutOpening.dguDoorW(dgu.lx));
        const from = Math.round(Math.max(x0 + pad, Math.min(len - pad - width, dgu.x + dgu.lx / 2 - width / 2)));
        out.push({
          wall: 'back',
          x0: from,
          x1: from + width,
          w: width,
          h: heightOf(dgu),
          leaves: 2,
          pos: dgu.pos,
          unit: dgu.unit,
          fits: width >= dgu.lx + 2 * pass,
        });
        continue;
      }
      if (rad === 'right' ? len - (dgu.x + dgu.lx) > 600 : dgu.x - x0 > 600) continue;
      const pad = LayoutOpening.gaps(geo).eW;
      const width = Math.min(wid - 2 * pad, LayoutOpening.dguDoorW(dgu.ly));
      const y0 = Math.round(Math.max(pad, Math.min(wid - pad - width, dgu.y + dgu.ly / 2 - width / 2)));
      out.push({
        wall: rad === 'left' ? 'left' : 'right',
        y0,
        y1: y0 + width,
        w: width,
        h: heightOf(dgu),
        leaves: 2,
        pos: dgu.pos,
        unit: dgu.unit,
        fits: width >= dgu.ly + 2 * pass,
      });
    }
    return out;
  }

  /** Проёмы по стенам: [от, до, что] — двери, ворота, двери-жалюзи, вход в отсек бака. */
  openingsByWall(res) {
    const byWall = { front: [], back: [], left: [], right: [] };
    const put = (wall, [from, till], text) => byWall[wall] && byWall[wall].push([from, till, text]);
    const span = door => (door.wall === 'front' || door.wall === 'back' ? [door.x0, door.x1] : [door.y0, door.y1]);
    for (const door of res.doors || [])
      put(door.wall, [door.x0, door.x1], door.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота');
    if (res.entry && !res.entry.sea) put(res.entry.wall, span(res.entry), 'дверь оператора');
    for (const gate of [res.gates, res.gates2].filter(cand => cand && !cand.sea))
      put(gate.wall, [gate.y0, gate.y1], 'ворота');
    if (res.exit) put(res.exit.wall, [res.exit.y0, res.exit.y1], 'дверь оператора');
    for (const door of res.dguDoors || []) put(door.wall, span(door), 'дверь-жалюзи ДГУ');
    this.fuelOpenings(res.fuel || {}, put);
    return byWall;
  }

  /** Вход в отсек бака: дверь в стене прохода или ворота в торце. */
  fuelOpenings(fuel, put) {
    if (fuel.door) put('front', [fuel.door.x0, fuel.door.x1], 'дверь отсека бака');
    if (fuel.gate) put('left', [fuel.gate.y0, fuel.gate.y1], 'ворота отсека бака');
  }

  /** Проёмы ближе door.edge к краю станции или ближе door.gap друг к другу — тексты замечаний. */
  openings(res, geo) {
    const [len, wid] = geo.int;
    const edges = LayoutOpening.gaps(geo);
    const edge = StationMatrix.door().edge;
    const out = [];
    for (const [wall, list] of Object.entries(this.openingsByWall(res))) {
      const lim = wall === 'front' || wall === 'back' ? [edges.eL, len - edges.eL] : [edges.eW, wid - edges.eW];
      list.sort((from, till) => from[0] - till[0]);
      for (const [, , text] of list.filter(([from, till]) => from < lim[0] - 1 || till > lim[1] + 1)) {
        out.push(
          `${text[0].toUpperCase() + text.slice(1)} в ${LayoutExits.WALL_NAME[wall]} — ближе ${Mm.text(edge)} мм к краю станции: стена мала для проёма с отступами — проверьте у изготовителя или увеличьте контейнер.`,
        );
      }
      for (let k = 1; k < list.length; k++) {
        const gap = list[k][0] - list[k - 1][1];
        if (gap < edges.gap - 1)
          out.push(
            `В ${LayoutExits.WALL_NAME[wall]}: между проёмами (${list[k - 1][2]} и ${list[k][2]}) ${Mm.text(Math.max(0, gap))} мм — меньше ${Mm.text(edges.gap)} мм.`,
          );
      }
    }
    return [...new Set(out)];
  }

  /**
   * Двери и итог: дверь оператора, ворота, сервисные ворота, двери-жалюзи ДГУ — сведениями; проёмы и доступ к сторонам —
   * замечаниями; уровень и занятая длина.
   */
  finish(res, geo) {
    res.doors = res.doors || [];
    this.lay.gates.recheck(res, geo);
    this.doorNotes(res, geo);
    res.entry = this.entry(res, geo);
    res.dguDoors = this.dguDoors(res, geo);
    res.dguDoor = res.dguDoors[0] || null;
    for (const text of this.openings(res, geo)) res.issues.push({ level: 'warn', gap: true, text });
    this.dguNotes(res);
    res.access = this.lay.access.matrix(res, geo);
    for (const miss of res.access.filter(x => x.miss.length)) {
      res.issues.push({
        level: 'warn',
        text: `Поз. ${miss.pos}: к ${miss.miss.map(k => this.lay.access.side(k)).join(' и ')} не подойти для обслуживания (${miss.miss.map(k => miss.s[k].t).join('; ')}) — нужен проход или сервисные ворота; увеличьте контейнер или поменяйте порядок в составе.`,
      });
    }
    res.level = this.level(res);
    res.used = LayoutItem.used(res.items, geo);
    delete res.segs;
  }

  /** Уровень замечания о выходах: ошибка или предупреждение. */
  level(res) {
    if (res.bad) return 'error';
    return res.issues.some(i => i.level === 'warn') ? 'warn' : 'ok';
  }

  /** Ворота в торце и сервисные ворота — сведениями; дверь оператора и вторая — одной строкой. */
  doorNotes(res, geo) {
    for (const gate of [res.gates, res.gates2].filter(cand => cand && (cand.pos.length || !cand.sea)))
      res.issues.push({ level: 'info', text: this._gateText(gate, res) });
    for (const { t: text, d: door, count } of this.serviceGroups(res)) {
      const via = door.rear && !door.both && !(res.gates && res.gates.pos.length) ? '; ворота в торце не нужны' : '';
      res.issues.push({
        level: 'info',
        text: `${text}${count > 1 ? ` (${count} шт.)` : ''} — для ${door.rear ? 'обслуживания, ' : ''}монтажа и демонтажа поз. ${door.pos.join(', ')}: ${door.why.join('; ')}${via}.`,
      });
    }
    const tight = new Set(res.doors.filter(door => door.rear).flatMap(door => door.pos));
    res.issues = res.issues.filter(i => !(i.tight != null && tight.has(i.tight)));
    res.issues.push({ level: 'info', text: this.entryText(res, geo) });
  }

  _gateText(gate, res) {
    if (gate.sea)
      return `Монтаж и демонтаж поз. ${gate.pos.join(', ')} — через штатные двери контейнера в торце (${Mm.text(gate.w)} × ${Mm.text(gate.h)} мм): ${gate.why.join('; ')}.`;
    const far = gate.wall === 'right';
    const exit =
      far && res.items.some(i => i.pairEnd) ? 'перед ними ресиверы в два ряда — это не выход' : 'это и выход';
    const what = gate.pos.length
      ? ` — для монтажа и демонтажа поз. ${gate.pos.join(', ')}`
      : ' — для монтажа и демонтажа оборудования';
    const why = gate.why.length ? `: ${gate.why.join('; ')}` : '';
    return `Распашные монтажные ворота ${gate.full ? 'во весь торец ' : ''}${Mm.text(gate.w)} × ${Mm.text(gate.h)} мм в ${far ? 'дальнем торце' : 'торце у входа'}, открываются наружу (${exit})${what}${why}. ${LayoutMode.gateAxis(gate)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя контейнера.`;
  }

  /** Одинаковые сервисные ворота — одной строкой с числом. */
  serviceGroups(res) {
    const groups = new Map();
    for (const door of res.doors.filter(cand => cand.kind !== 'entry')) {
      const text = `${door.leaves > 1 ? 'Сервисные распашные ворота' : 'Сервисная распашная дверь'} ${Mm.text(door.w)} × ${Mm.text(door.h)} мм в ${door.wall === 'back' ? 'задней' : 'боковой'} стене${this._serviceWhere(door)}`;
      const key = `${text}|${door.pos.join(',')}`;
      if (!groups.has(key)) groups.set(key, { t: text, d: door, count: 0 });
      groups.get(key).count++;
    }
    return [...groups.values()];
  }

  _serviceWhere(door) {
    if (door.both) return door.wall === 'back' ? ' за компрессором' : ' перед компрессором';
    return door.rear ? ' за оборудованием' : '';
  }

  /** «Вход: дверь оператора …; вторая дверь оператора — … (почему)». */
  entryText(res, geo) {
    const entry = this.entryOpen(geo, res.door);
    const gate = res.gates;
    const who =
      res.door === 'end' && geo.sea
        ? 'штатные двери в торце'
        : `одностворчатая, ${Mm.text(entry.w)} × ${Mm.text(entry.h)} мм в свету, открывается наружу, с доводчиком`;
    const two =
      res.doors.some(door => door.kind === 'entry') ||
      res.exit ||
      (gate && gate.wicket) ||
      (res.gates2 && res.gates2.wicket) ||
      res.secondDgu;
    return `Вход: дверь оператора — ${who}${two ? `; вторая дверь оператора — ${this._secondWhere(res)} (${res.second})` : ''}.`;
  }

  _secondWhere(res) {
    const gate = res.gates;
    if (res.exit) return 'в дальнем торце по оси прохода';
    if (gate && gate.wicket)
      return `калитка ${Mm.text(gate.wicket.w)} × ${Mm.text(gate.wicket.h)} мм в створке ворот в дальнем торце`;
    return res.secondDgu ? 'выход через дверь-жалюзи ДГУ в дальнем торце' : 'в стене прохода у дальнего торца';
  }

  /** Двери-жалюзи ДГУ — сведениями (одинаковые — одной строкой). */
  dguNotes(res) {
    const groups = new Map();
    for (const door of res.dguDoors) {
      const key = [door.pos, door.wall, door.w, door.h, door.fits].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(door);
    }
    for (const list of groups.values()) {
      const door = list[0];
      const many = list.length > 1 ? ` (${list.length} шт.): у каждой` : ':';
      const wide = door.fits ? '' : ' ДГУ шире проёма — демонтаж со снятием панели стены.';
      res.issues.push({
        level: 'info',
        text: `ДГУ поз. ${door.pos}${many} ${LayoutExits.DGU_WALL[door.wall]} — двустворчатая дверь-жалюзи ${Mm.text(door.w)} × ${Mm.text(door.h)} мм — выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (отдельная сервисная дверь не нужна).${wide}`,
      });
    }
  }
}
