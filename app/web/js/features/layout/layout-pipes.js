import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { PipeMaterial } from './pipe-material.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/**
 * Трубопровод одной расстановки: магистрали за оборудованием (у задней стены или между рядами) с отводами и выходом
 * через дальний торец: насосы — всас и напор, компрессорная — сжатый воздух через аппараты, ДГУ — топливо от бака.
 */
class PipeRun {
  constructor(res, geo, hangH) {
    [this.Li, this.Wi, this.Hi] = geo.int;
    this.res = res;
    this.floor = res.items.filter(i => i.mount === 'floor');
    this.zTop = Math.max(600, Math.min(this.Hi - 400, 1500));
    this.hang = (hangH || 0) / 2 + 40;
    this.out = [];
  }

  /** Есть ли на полу агрегат вида. */
  has(kind) {
    return this.floor.some(i => i.kind === kind);
  }

  /** Агрегаты вида на полу. */
  of(kind) {
    return this.floor.filter(i => i.kind === kind);
  }

  /** Все трассы станции. */
  lines() {
    this.res.segs = [];
    if (!this.floor.length) return this.out;
    if (this.has('pump')) this.pumps();
    else if (this.has('compressor')) this.air();
    else if (this.has('dgu')) this.fuel();
    else
      this.line(
        this.floor.filter(i => i.kind !== 'cabinet'),
        { off: Math.max(150, this.hang), part: 0.5, z: Math.min(this.zTop, 1200), label: 'выход', medium: 'gen' },
      );
    return this.out;
  }

  /** Трассы насосов. */
  pumps() {
    const pumps = this.of('pump');
    this.line(pumps, { off: 110, part: 0.3, z: 450, label: 'вход', medium: 'in' });
    this.line(pumps, { off: 240, part: 0.7, z: Math.min(this.zTop, 1300), label: 'выход', medium: 'out' });
  }

  /** Топливная трасса от бака к ДГУ. */
  fuel() {
    if (this.has('tank'))
      this.out.push(
        ...LayoutPipes.fuelLine(
          this.floor.filter(i => i.kind === 'tank' || i.kind === 'dgu'),
          this.Wi,
        ),
      );
  }

  /** Магистраль сжатого воздуха. */
  air() {
    const main = new AirMain(this, Math.max(StationMatrix.grp('pipe').airY, this.hang)).build();
    this.out.push(...main.lines);
    this.res.segs = main.segs;
  }

  /** Линия от оборудования conn до дальнего торца. */
  line(conn, { off, part, z, label, medium }) {
    if (!conn.length) return;
    const group = this.place(conn, {
      off,
      part,
      z,
      medium,
      x0: Math.min(...conn.map(i => i.x + i.lx / 2)),
      x1: this.Li,
    });
    const branches = conn.map(i => LayoutPipes.branch(i, group.y, group.z)).filter(Boolean);
    const ends = [
      ...LayoutPipes._branchXs(branches),
      ...conn.filter(i => !branches.some(branch => branch.to === LayoutPipes._key(i))).map(LayoutPipes._mid),
    ];
    this.out.push({ x0: Math.min(...ends), x1: this.Li, y: group.y, z: group.z, label, medium, branches });
  }

  /**
   * Ось линии: полоса за оборудованием до стены (off — от стены, part — доля полосы, если она уже); нет места или ряды
   * напротив — над оборудованием; над сервисными воротами и над оборудованием на пути — выше.
   */
  /** Линия трассы вдоль задней стены: отступ за агрегатами, высота, пределы по длине. */
  place(conn, { off, part, z, medium, x0, x1 }) {
    const { Wi: Wi, Hi: Hi } = this;
    const back = conn.filter(i => i.row !== 1);
    const low = back.length ? Math.max(...back.map(i => i.y + i.ly)) : 0;
    const band = Wi - low;
    const y = Math.round(Math.min(Wi - 40, Wi - Math.min(off, band * part)));
    let zLine = z;
    if (band < LayoutPipes.ROOM[medium] || this.res.rows === 2)
      zLine = Math.min(Hi - 150, Math.max(zLine, ...conn.map(i => i.h + (medium === 'out' ? 450 : 200))));
    const toWall = y > Wi / 2 ? Wi - y : y;
    const doors = (this.res.doors || []).filter(
      door => door.wall === (y > Wi / 2 ? 'back' : 'front') && door.x0 < x1 + 100 && door.x1 > x0 - 100 && toWall < 600,
    );
    if (doors.length) zLine = Math.min(Hi - 120, Math.max(zLine, ...doors.map(door => door.h + 150)));
    const hit = this.floor.filter(
      i => i.x < x1 && i.x + i.lx > x0 && i.y < y + 60 && i.y + i.ly > y - 60 && i.h > zLine - 60,
    );
    if (hit.length) zLine = Math.min(Hi - 120, Math.max(zLine, ...hit.map(i => i.h + 150)));
    return { y, z: Math.round(zLine), lo: low, hi: Wi };
  }
}

/**
 * Сжатый воздух по ходу воздуха: компрессоры → коллектор → аппараты (у каждого один вход и один выход: магистраль на нём
 * прервана) → выход. Компрессоры не все до первого аппарата — коллектор отдельной трубой выше магистрали. Одинаковые
 * аппараты подряд — параллельно: выходы в магистраль, входы — от своего коллектора на другой высоте. segs — участки
 * между аппаратами: на них висят фильтры своей ступени.
 */
class AirMain {
  constructor(run, off) {
    const { Li: Li, Hi: Hi } = run;
    this.run = run;
    this.Li = Li;
    this.Hi = Hi;
    this.src = run.of('compressor');
    this.ser = run.floor
      .filter(i => LayoutPipes.series(i))
      .sort((left, right) => left.air.stage - right.air.stage || left.x - right.x);
    this.off = off;
    this.segs = [];
    this.heads = [];
    this.head = null;
  }

  /** Трасса магистрали: подключения, коллектор, отводы. */
  build() {
    const conn = [...this.src, ...this.ser];
    if (!conn.length) return { lines: [], segs: [] };
    const group = this.run.place(conn, {
      off: this.off,
      part: 0.5,
      z: this.run.zTop,
      medium: 'air',
      x0: Math.min(...conn.map(i => i.x)),
      x1: this.Li,
    });
    Object.assign(this, { group, y: group.y, z: group.z });
    this.highZ = group.z + 220 <= this.Hi - 120 ? group.z + 220 : group.z - 220;
    this.highY = Math.max(group.lo + 40, Math.min(group.hi - 40, group.y - 110));
    this.steps = AirChain.groups(this.ser).map(units => ({
      G: units,
      st: units[0].air.stage,
      P: units.map(i => LayoutPipes.ports(i, group.y, group.z)),
    }));
    this.main = {
      x0: 0,
      x1: this.Li,
      y: group.y,
      z: group.z,
      label: 'выход',
      medium: 'air',
      branches: [],
      gaps: [],
      bypass: [],
    };
    this.s0 = 10;
    const rest = this.start();
    for (const step of rest) {
      if (step.G.length === 1) this.single(step);
      else this.parallel(step);
      this.s0 = step.st;
    }
    this.segs.push({ a: this.startX, b: this.Li, s0: this.s0, s1: Infinity, line: this.main });
    return { lines: [...(this.head ? [this.head] : []), this.main, ...this.heads], segs: this.segs };
  }

  _outOf(i, y, z) {
    return {
      ...(LayoutPipes.branch(i, y, z) || { x: LayoutPipes._mid(i), y0: y, y1: y, z1: z, to: LayoutPipes._key(i) }),
      role: 'out',
    };
  }

  /** Начало магистрали: компрессоры до первого аппарата — на ней; иначе — коллектор к первому аппарату. */
  start() {
    const own = this.src.map(i => this._outOf(i, this.y, this.z));
    const firstIn = this.steps.length ? this.steps[0].P[0][0].x : this.Li;
    if (own.every(branch => branch.x < firstIn - 60)) {
      this.main.x0 = Math.min(...LayoutPipes._branchXs(own), firstIn);
      this.main.branches.push(...own);
      this.startX = own.length ? Math.max(...LayoutPipes._branchXs(own)) : this.main.x0;
      return this.steps;
    }
    this.header(this.steps[0]);
    return this.steps.slice(1);
  }

  /** Коллектор компрессоров к входу первого аппарата (группы); до него фильтр — на участке со всем воздухом. */
  header(step) {
    const { highY: highY, highZ: highZ } = this;
    const heads = this.src.map(i => this._outOf(i, highY, highZ));
    const hin = step.G.map(i => LayoutPipes.ports(i, highY, highZ)[0]);
    const headXs = [...LayoutPipes._branchXs(heads), ...LayoutPipes._branchXs(hin)];
    const x = hin[0].x;
    this.head = {
      x0: Math.min(...headXs),
      x1: Math.max(...headXs),
      y: highY,
      z: highZ,
      label: '',
      medium: 'air',
      branches: [...heads, ...hin],
      gaps: [],
      header: true,
      to: Math.round((x + hin[hin.length - 1].x) / 2),
    };
    if (hin.length > 1) this.head.par = step.G.map(i => i.pos);
    const left = LayoutPipes._branchXs(heads.filter(branch => branch.x < x));
    const right = LayoutPipes._branchXs(heads.filter(branch => branch.x > x));
    const leftMax = left.length ? Math.max(...left) : null;
    const rightMin = right.length ? Math.min(...right) : null;
    const leftSide = leftMax != null && (rightMin == null || x - leftMax >= rightMin - x);
    this.segs.push(
      leftSide
        ? { a: leftMax, b: x, s0: 10, s1: step.st, line: this.head }
        : { a: x, b: rightMin, s0: 10, s1: step.st, line: this.head },
    );
    const outs = step.P.map(pair => pair[1]);
    this.main.x0 = Math.min(...LayoutPipes._branchXs(outs));
    this.main.branches.push(...outs);
    this.startX = Math.max(...LayoutPipes._branchXs(outs));
    this.s0 = step.st;
  }

  /** Один аппарат: магистраль прервана от входа до выхода, у осушителя — байпас. */
  single(step) {
    const [pin, pout] = step.P[0];
    const bypass = LayoutPipes.bypass(step.G[0], step.P[0]);
    this.segs.push({ a: this.startX, b: pin.x, s0: this.s0, s1: step.st, line: this.main });
    this.main.branches.push(pin, pout);
    this.main.gaps.push([pin.x, pout.x]);
    if (bypass) this.main.bypass.push(bypass);
    this.startX = pout.x;
  }

  /** Параллельно: магистраль прервана от подъёма до первого выхода; коллектор входов — на другой высоте. */
  parallel(step) {
    const { Hi: Hi, y, z } = this;
    const firstIn = step.P[0][0].x;
    const rise = Math.round(Math.min(firstIn - 40, Math.max((this.startX + firstIn) / 2, firstIn - 150)));
    const outs = step.P.map(pair => pair[1]);
    let groupY = this.highY;
    let groupZ = this.highZ;
    if (this.head && this.head.x1 > rise - 100) {
      const mirrorZ = 2 * z - this.highZ;
      if (mirrorZ >= 300 && mirrorZ <= Hi - 120) groupZ = mirrorZ;
      else groupY = Math.max(this.group.lo + 40, this.highY - 110);
    }
    const pin = step.G.map(i => LayoutPipes.ports(i, groupY, groupZ)[0]);
    this.segs.push({ a: this.startX, b: rise, s0: this.s0, s1: step.st, line: this.main });
    this.main.branches.push(...outs);
    this.main.gaps.push([rise, outs[0].x]);
    this.heads.push({
      x0: rise,
      x1: Math.max(...LayoutPipes._branchXs(pin)),
      y: groupY,
      z: groupZ,
      label: '',
      medium: 'air',
      branches: [{ x: rise, y0: groupY, y1: y, z1: z, tee: true }, ...pin],
      gaps: [],
      par: step.G.map(i => i.pos),
    });
    this.startX = Math.max(...LayoutPipes._branchXs(outs));
  }
}

/** Трубопровод станции: линии, отводы, порты аппаратов, выход из станции, материал. */
export class LayoutPipes {
  static _key = i => `${i.id}#${i.unit}`;

  static _mid = i => Math.round(i.x + i.lx / 2);

  static _branchXs = list => list.map(branch => branch.x);

  /** Свободная полоса под трубой за оборудованием, мм, — меньше: линия над оборудованием. */
  static ROOM = { fuel: 50, air: 100, in: 140, out: 140, gen: 100 };

  static FUEL_Z = 60;

  /** Линии трубопровода расстановки; dh — наибольший фильтр на линии (ось — дальше от стены на его половину). */
  static lines(res, geo, hangH) {
    return new PipeRun(res, geo, hangH).lines();
  }

  /** Аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу). */
  static series(unit) {
    return (
      Boolean(unit.air) && unit.air.stage != null && unit.kind !== 'compressor' && unit.mount !== 'pipe' && !unit.pipe
    );
  }

  /** Топливопровод от бака к ДГУ — по полу в лотке: вдоль задней стены за ДГУ, если там есть место, иначе — у двери. */
  static fuelLine(conn, Wi) {
    const fuelZ = this.FUEL_Z;
    const dgus = conn.filter(i => i.kind === 'dgu');
    const back = dgus.every(i => !i.rad || i.rad !== 'back') && dgus.every(i => Wi - (i.y + i.ly) >= 200);
    const y = back ? Wi - 120 : 120;
    const branches = conn.map(i => this.branch(i, y, fuelZ)).filter(Boolean);
    const ends = [...LayoutPipes._branchXs(branches), ...conn.map(LayoutPipes._mid)];
    return [
      { x0: Math.min(...ends), x1: Math.max(...ends), y, z: fuelZ, label: '', medium: 'fuel', floor: true, branches },
    ];
  }

  /** Байпас осушителя с краном между входом и выходом: {x0, x1, pos} или null. */
  static bypass(i, pair) {
    const ok = i.kind === 'dryer' && i.air && i.air.type !== 'gen' && pair[1].x - pair[0].x >= 150;
    return ok ? { x0: pair[0].x, x1: pair[1].x, pos: i.pos } : null;
  }

  static PORTS = { hcyl: [0.15, 0.85], vcyl: [0.3, 0.7] };

  /** Вход и выход аппарата на магистрали: патрубки сверху у задней стороны; у вертикального ресивера вход — внизу. */
  static ports(i, y, z) {
    const target = LayoutPipes._key(i);
    const u = this.PORTS[i.shape] || [0.25, 0.75];
    const back = this.backSide(i, y);
    const sign = i.y + i.ly < y - 20 ? -1 : 1;
    const dz = Math.min(150, i.ly / 4);
    const top = z > i.h + 50;
    const low = i.shape === 'vcyl' && i.h >= 900 ? Math.round(Math.max(250, i.h * 0.22)) : 0;
    const port = (share, role, lowZ) => {
      const x = Math.round(i.x + i.lx * share);
      if (back == null) return { x, y0: y, y1: y, z1: Math.round(top ? i.h : z), to: target, role };
      if (lowZ) return { x, y0: y, y1: back, z1: lowZ, to: target, role };
      if (top) return { x, y0: y, y1: Math.round(back + sign * dz), z1: Math.round(i.h), to: target, role };
      return { x, y0: y, y1: back, z1: Math.round(z), to: target, role };
    };
    return [port(u[0], 'in', low), port(u[1], 'out', 0)];
  }

  /** Сторона аппарата к магистрали: задняя (магистраль за ним), передняя (перед ним) или null — магистраль над ним. */
  static backSide(i, y) {
    if (i.y + i.ly < y - 20) return i.y + i.ly;
    return i.y > y + 20 ? i.y : null;
  }

  /** Участки линии без разрывов (внутри аппарата магистраль прервана): [[x0, x1], …]. */
  static runs(line) {
    const gaps = (line.gaps || []).filter(([from, till]) => till > from).sort((left, right) => left[0] - right[0]);
    const out = [];
    let x = line.x0;
    for (const [from, till] of gaps) {
      if (from > x) out.push([x, Math.min(from, line.x1)]);
      x = Math.max(x, till);
    }
    if (line.x1 > x) out.push([x, line.x1]);
    return out;
  }

  /** Участок для фильтра на трубе по его ступени; без цепочки воздуха — линия, где он висит не ниже 150 мм. */
  static segOf(res, unit) {
    const segs = res.segs || [];
    const stage = unit.air && unit.air.stage != null ? unit.air.stage : 50;
    if (segs.length) return segs.find(group => stage > group.s0 && stage < group.s1) || segs[segs.length - 1];
    const line = this.airLine(res, unit.h);
    return line ? { a: line.x0 - 100, b: line.x1 + 100, s0: -Infinity, s1: Infinity, line } : null;
  }

  /** Отвод от магистрали (y, z) к задней стороне оборудования; магистраль выше — заходит на верх и спускается. */
  static branch(i, y, z) {
    const down = z > i.h + 50;
    const x = Math.round(i.x + i.lx * (down ? 0.8 : 0.5));
    const target = LayoutPipes._key(i);
    const dz = Math.min(150, i.ly / 4);
    const z1 = Math.round(down ? i.h : z);
    if (i.y + i.ly < y - 20) return { x, y0: y, y1: Math.round(down ? i.y + i.ly - dz : i.y + i.ly), z1, to: target };
    if (i.y > y + 20) return { x, y0: y, y1: Math.round(down ? i.y + dz : i.y), z1, to: target };
    return down ? { x, y0: y, y1: y, z1: Math.round(i.h), to: target } : null;
  }

  /** Линия для фильтров: сжатый воздух; иначе — самая высокая, где фильтр высотой h висит не ниже 150 мм. */
  static airLine(res, height) {
    const lines = (res.lines || []).filter(line => line.z + Math.max(60, height * 0.12) - height >= 150);
    return lines.find(line => line.medium === 'air') || lines.sort((left, right) => right.z - left.z)[0] || null;
  }

  /** Фильтр висит на линии: голова — на оси трубы, корпус — вниз; у стены — сдвинут в помещение. */
  static hangOn(item, line2, Wi) {
    item.y = Math.round(Math.max(20, Math.min(Wi - item.ly - 20, line2.y - item.ly / 2)));
    item.z = Math.round(line2.z + Math.max(60, item.h * 0.12) - item.h);
    item.line = line2.medium;
  }

  /** Путь выхода от конца магистрали до стены: {pts — точки внутри, dir — наружу}. */
  static outPath(line, Wi) {
    const out = line.out;
    if (!out) return null;
    if (out.wall === 'back' || out.wall === 'front') {
      const wallY = out.wall === 'back' ? Wi : 0;
      return {
        pts: [
          [out.x, line.y, line.z],
          [out.x, wallY, line.z],
        ],
        dir: [0, out.wall === 'back' ? 1 : -1],
      };
    }
    if (out.rise)
      return {
        pts: [
          [line.x1, line.y, line.z],
          [line.x1, line.y, out.z],
          [out.x, line.y, out.z],
        ],
        dir: [1, 0],
      };
    return { pts: [[out.x, line.y, line.z]], dir: [1, 0] };
  }

  /** Трубопровод в составе → линии с материалом и цветом; нет в составе, а фильтры на трубе — линия условно. */
  static route(plan, equip) {
    const pipings = equip.filter(unit => unit.kind === 'piping');
    const lines = plan.lines || [];
    const steel = PipeMaterial.get('steel').color;
    if (!lines.length) return [];
    if (!pipings.length) {
      return plan.items.some(i => i.mount === 'pipe')
        ? [
            {
              pos: null,
              implicit: true,
              name: 'Трубопровод',
              kind: 'piping',
              qty: 1,
              mat: '',
              matText: '',
              color: steel,
              dn: '',
              lines,
            },
          ]
        : [];
    }
    return pipings.map(pair => {
      const mat = PipeMaterial.get(pair.mat);
      return {
        pos: pair.pos,
        name: pair.name,
        brief: pair.brief,
        kind: 'piping',
        qty: pair.qty,
        mat: pair.mat,
        matText: mat ? mat.name.toLowerCase() : '',
        color: mat ? mat.color : steel,
        dn: pair.dn,
        lines,
      };
    });
  }

  /**
   * Выход трубопровода из станции: через дальний торец; там ворота, дверь или дверь-жалюзи ДГУ — на ближайшую свободную
   * стену (сначала — стену линии), затем над проёмом. Снаружи — патрубок с фланцем. l.out — {wall, x, y, z, moved, why}.
   */
  static outlet(plan, outside) {
    new PipeOutlet(plan, outside).place();
  }
}

/** Выход каждой магистрали из станции мимо проёмов (pipe.outGap от проёма, pipe.outEdge от торца). */
class PipeOutlet {
  constructor(plan, outside) {
    [this.Li, this.Wi, this.Hi] = plan.int;
    this.plan = plan;
    this.outside = outside;
    this.rule = StationMatrix.grp('pipe');
    this.iss = plan.issues = plan.issues || [];
    this.taken = [];
    this.ends = this.endOpenings();
  }

  /** Проёмы дальнего торца: ворота, вторая дверь оператора, двери-жалюзи ДГУ. */
  endOpenings() {
    const { plan, Wi: Wi, Hi: Hi } = this;
    const gates = [plan.gates, plan.gates2].filter(gate => gate && gate.wall === 'right');
    const exit = plan.exit && plan.exit.wall === 'right' ? [plan.exit] : [];
    return [
      ...gates.map(gate =>
        gate.sea ? { y0: 0, y1: Wi, h: Hi, t: 'штатные двери' } : { y0: gate.y0, y1: gate.y1, h: gate.h, t: 'ворота' },
      ),
      ...exit.map(exit2 => ({ y0: exit2.y0, y1: exit2.y1, h: exit2.h, t: 'вторая дверь оператора' })),
      ...(plan.dguDoors || [])
        .filter(door => door.wall === 'right')
        .map(door => ({ y0: door.y0, y1: door.y1, h: door.h, t: 'дверь-жалюзи ДГУ' })),
    ];
  }

  /** Проёмы и занятые места на боковой стене w. */
  wallOpenings(wall) {
    const { plan } = this;
    const post = StationMods.RULES.post / 2;
    const entry =
      plan.entry && plan.entry.wall === wall ? [{ x0: plan.entry.x0, x1: plan.entry.x1, t: 'дверь оператора' }] : [];
    return [
      ...(plan.doors || [])
        .filter(door => door.wall === wall)
        .map(door => ({ x0: door.x0, x1: door.x1, t: door.kind === 'entry' ? 'дверь оператора' : 'сервисные ворота' })),
      ...entry,
      ...(plan.dguDoors || [])
        .filter(door => door.wall === wall)
        .map(door => ({ x0: door.x0, x1: door.x1, t: 'дверь-жалюзи ДГУ' })),
      ...plan.items
        .filter(i => i.mount === 'wall' && i.wall === wall)
        .map(i => ({ x0: i.x, x1: i.x + i.lx, t: 'шкаф' })),
      ...StationMods.lines(plan.geo).x.map(x => ({ x0: x - post, x1: x + post, t: 'стык модулей' })),
    ];
  }

  /** Выходы трасс через торцевую стену. */
  place() {
    for (const line of (this.plan.lines || []).filter(cand => cand.label && !cand.header && cand.x1 >= this.Li - 1))
      this.one(line);
  }

  /** Выход одной трассы: мимо ворот, дверей и жалюзи. */
  one(line) {
    const gap = this.rule.outGap;
    const blocked = this.ends.find(out => line.y > out.y0 - gap && line.y < out.y1 + gap && line.z < out.h + gap);
    if (!blocked || this.outside) {
      line.out = this._straight(line);
      if (blocked) {
        this.iss.push({
          level: 'warn',
          text: `Выход трубопровода через торец — в проёме (${blocked.t}): ресиверы снаружи стоят за торцом. Перенесите их или ворота в другой торец.`,
        });
      }
      return;
    }
    const why = blocked.t;
    const out = this.moved(line, why);
    if (!out) {
      line.out = this._straight(line);
      this.iss.push({
        level: 'warn',
        text: `Выход трубопровода в дальнем торце — в проёме (${why}), а на стенах рядом места нет: перенесите ворота или укажите место выхода сборщику.`,
      });
      return;
    }
    if (out.wall !== 'right') line.x1 = out.x;
    else if (out.rise) line.x1 = Math.round(this.Li - 150);
    line.out = out;
    this.taken.push(out);
    this.iss.push({ level: 'info', text: this._movedText(line, out, why) });
  }

  _straight(line) {
    return { wall: 'right', x: this.Li, y: line.y, z: line.z, moved: false, flange: this.rule.flange };
  }

  /** Выход на ближнюю стену, на дальнюю или над проёмом в торце; места нет — null. */
  moved(line, why) {
    const near = line.y > this.Wi / 2 ? 'back' : 'front';
    const far = near === 'back' ? 'front' : 'back';
    return this.side(line, near, why) || this.side(line, far, why) || this._above(line, why);
  }

  _above(line, why) {
    const gap = this.rule.outGap;
    const z =
      Math.max(...this.ends.filter(cand => line.y > cand.y0 - gap && line.y < cand.y1 + gap).map(cand => cand.h)) +
      Math.min(gap, 100);
    return z <= this.Hi - 100
      ? { wall: 'right', x: this.Li, y: line.y, z, rise: true, moved: true, why, flange: this.rule.flange }
      : null;
  }

  /** Место на стене w: ближе к торцу, после последнего отвода и фильтров, мимо проёмов и оборудования. */
  side(line, wall, why) {
    const { plan, rule: rule, Wi: Wi } = this;
    const { outGap: gap, outEdge: edge } = rule;
    const pipeEnds = plan.items
      .filter(i => i.mount === 'pipe' && Math.abs(i.y + i.ly / 2 - line.y) < i.ly)
      .map(i => i.x + i.lx);
    const low = Math.max(0, ...(line.branches || []).map(branch => branch.x), ...pipeEnds) + 100;
    const wallY = wall === 'back' ? Wi : 0;
    const open = this.wallOpenings(wall).filter(out => out.x1 > low - gap);
    const free = x =>
      !open.some(out => x > out.x0 - gap && x < out.x1 + gap) &&
      !this.taken.some(taken => taken.wall === wall && Math.abs(taken.x - x) < 300) &&
      !plan.items.some(
        i =>
          i.mount !== 'pipe' &&
          i.mount !== 'wall' &&
          x > i.x - 60 &&
          x < i.x + i.lx + 60 &&
          i.y < Math.max(line.y, wallY) + 60 &&
          i.y + i.ly > Math.min(line.y, wallY) - 60 &&
          i.h > line.z - 120,
      );
    for (let x = Math.round(this.Li - edge); x >= low; x -= 50) {
      if (free(x)) return { wall, x, y: wallY, z: line.z, moved: true, why, flange: rule.flange };
    }
    return null;
  }

  _movedText(line, out, why) {
    const num = v => Mm.text(v);
    const where =
      out.wall === 'right'
        ? `Выход — над проёмом в торце, на высоте ${num(out.z)} мм от пола`
        : `Выход — через ${out.wall === 'back' ? 'заднюю стену' : 'стену прохода'} в ${num(this.Li - out.x)} мм от дальнего торца (внутри), на высоте ${num(out.z)} мм от пола`;
    return `Выход трубопровода${line.medium === 'air' ? ' сжатого воздуха' : ''} перенесён: в дальнем торце — ${why}. ${where}; снаружи — патрубок с фланцем.`;
  }
}
