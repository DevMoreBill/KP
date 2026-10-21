import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Приток: стена напротив выброса → створки ворот и сервисных дверей → свободные стены (не стена выброса); одним проёмом,
 * иначе одинаковыми; у ДГУ — напротив каждой, одинаковый; не встал — приточные вентиляторы, затем нехватка.
 */
export class VentIntake {
  static _round2 = x => Math.round(x * 100) / 100;

  static OPPOSITE = { back: 'front', front: 'back', left: 'right', right: 'left' };

  static _floorDgu = items => items.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');

  constructor(ventPlan) {
    this.ventPlan = ventPlan;
    this.left = 0;
  }

  /** Стены притока по порядку и высоты (внизу, над конвекторами; с маркизой — сначала выше). */
  inWalls() {
    const { exhaust: exhaust, exW, dgu, radW, len: len, x0 } = this.ventPlan;
    const first =
      (exhaust ? [VentIntake.OPPOSITE[exhaust], 'left', 'right', 'front'].find(wall => !exW.has(wall)) : null) ||
      'front';
    const wallsOf = list => list.filter(([wall]) => !exW.has(wall) && (wall !== 'left' || this.ventPlan.leftOk));
    const lim = dgu && radW.size === 1 && radW.has('right') ? Math.round(len - 1500) : null;
    const mid = Math.round((x0 + len) / 2);
    const rest = wallsOf(this.restOrder(lim, mid));
    const firstW = wallsOf([[first, this._firstFrom(first, mid)]]);
    const { lo: low, hi: high } = this.heights();
    return {
      first,
      rest,
      firstW,
      lo: low,
      hi: high,
      allW: [...firstW, ...rest.filter(([wall]) => wall !== first)],
      bands: [low.z0, high.z0],
    };
  }

  /** Приток внизу и над конвекторами; с маркизой — сначала выше (вход под маркизой выше снегового покрова). */
  heights() {
    const grille = VentGrille.INLET;
    const z = VentGrille.LIFT;
    const lift = {
      ...grille,
      z0: z,
      h: [
        grille.h[0],
        Math.min(
          grille.h[1],
          Math.floor((this.ventPlan.height - this.ventPlan.outSize.top - 90 - z) / this.ventPlan.step) *
            this.ventPlan.step,
        ),
      ],
    };
    const low = this.ventPlan.sys.snow && lift.h[1] >= lift.h[0] ? lift : grille;
    return { lo: low, hi: low === grille ? lift : grille };
  }

  _firstFrom(first, mid) {
    if (this.ventPlan.dgu && this.ventPlan.radW.has('left') && (first === 'front' || first === 'back')) return mid;
    return first === 'front' ? 'hi' : 'lo';
  }

  /** У ДГУ — не у радиатора: в дальнем торце — от входа; к обоим торцам — от середины; поперёк — стена прохода и торцы. */
  restOrder(lim, mid) {
    const { dgu, radW } = this.ventPlan;
    if (!dgu) {
      return [
        ['left', 'lo'],
        ['right', 'lo'],
        ['back', 'lo'],
        ['front', 'hi'],
      ];
    }
    if (radW.has('back')) {
      return [
        ['front', 'lo'],
        ['left', 'lo'],
        ['right', 'lo'],
      ];
    }
    if (radW.has('left')) {
      return [
        ['back', mid],
        ['front', mid],
      ];
    }
    return [
      ['left', 'lo'],
      ['back', 'lo', lim],
      ['front', 'lo', lim],
    ];
  }

  /** В створках: ворота в торце, сервисные ворота и двери — внизу полотна, мимо запорных штанг и калитки. */
  leaves(door, wall, [u0, u1], count, skip) {
    const grille = VentGrille.INLET;
    const step = this.ventPlan.step;
    const leafW = (u1 - u0) / count;
    const z0 = grille.z0;
    const leafH = Math.floor(Math.min(door.h - 350 - z0, grille.h[1]) / step) * step;
    for (let i = 0; i < count && this.left > 1 && leafH >= grille.h[0]; i++) {
      const from = u0 + i * leafW + (i === 0 ? 120 : 160);
      const till = u0 + (i + 1) * leafW - (i === count - 1 ? 120 : 160);
      const width = Math.min(grille.w[1], Math.floor((till - from) / step) * step);
      if (i === skip || width < grille.w[0]) continue;
      const start = Math.round((from + till - width) / 2);
      this.ventPlan.out.louvers.push({
        kind: 'in',
        wall,
        u0: start,
        u1: start + width,
        z0,
        z1: z0 + leafH,
        w: width,
        h: leafH,
        leaf: true,
      });
      this.left -= width * leafH;
    }
  }

  _allLeaves() {
    const { plan, exW } = this.ventPlan;
    for (const gate of [plan.gates, plan.gates2].filter(opening => opening && !exW.has(opening.wall))) {
      const pad = gate.sea ? 150 : 0;
      if (this.left > 1)
        this.leaves(gate, gate.wall, [gate.y0 + pad, gate.y1 - pad], gate.leaves || 2, gate.wicket ? 0 : -1);
    }
    for (const door of (plan.doors || []).filter(opening => opening.kind !== 'entry' && !exW.has(opening.wall))) {
      if (this.left > 1) this.leaves(door, door.wall, [door.x0, door.x1], door.leaves || 1, -1);
    }
  }

  /** Жалюзи притока: стены, створки, ДГУ, вентиляторы. */
  run() {
    const out = this.ventPlan.out;
    const ctx = this.inWalls();
    this.left = this.ventPlan.need(this.ventPlan.qIn, 'in').gross * 1e6;
    if (this.ventPlan.dgu && this.left > 1) this.dguIntake(ctx);
    if (this.left > 1) this.wallIntake(ctx);
    if (!out.size.in) out.size.in = VentGrille.size(out.need.in.gross, VentGrille.INLET);
    this.inFans(ctx);
    out.short.in = VentIntake._round2(Math.max(0, this.left) / 1e6);
  }

  /** ДГУ: приток у каждой напротив неё (стена прохода, иначе задняя), одинаковый, расход поровну. */
  dguIntake({ lo: low, hi: high }) {
    const dgus = VentIntake._floorDgu(this.ventPlan.items);
    const per = this.left / dgus.length / 1e6;
    const walls = ['front', 'back'].filter(wall => !this.ventPlan.exW.has(wall));
    for (const band of [low, high]) {
      if (this.left <= 1) break;
      const hmax =
        Math.floor(
          Math.min(band.h[1], this.ventPlan.height - this.ventPlan.outSize.top - 90 - band.z0) / this.ventPlan.step,
        ) * this.ventPlan.step;
      for (let count = 1; hmax >= band.h[0] && count <= VentGrille.MAXN && this.left > 1; count++) {
        const shapes = VentGrille.sizesN(
          per,
          { ...band, w: [band.w[0], Math.max(band.w[1], VentGrille.WHOLE)], h: [band.h[0], hmax] },
          count,
        );
        const shape = shapes.find(opening => this._eachDgu(dgus, walls, opening, band.z0));
        if (shape) {
          this.ventPlan.out.size.in = { ...shape, n: count * dgus.length };
          this.ventPlan.out.inEach = true;
          this.left = 0;
        }
      }
    }
  }

  _eachDgu(dgus, walls, shape, z0) {
    const mark0 = this.ventPlan.walls.mark();
    const nL0 = this.ventPlan.out.louvers.length;
    if (dgus.every(dgu => this.atDgu(dgu, walls, shape, z0))) return true;
    this.ventPlan.walls.reset(mark0);
    this.ventPlan.out.louvers.length = nL0;
    return false;
  }

  /** n жалюзи в пределах ДГУ по длине (±1,5 м) на одной из стен ws. */
  atDgu(dgu, walls, shape, z0) {
    const { walls: wallSet, out } = this.ventPlan;
    const center = Math.round(dgu.x + dgu.lx / 2);
    const reach = Math.max(dgu.lx / 2, 1500);
    const z = [z0 - 90, z0 + shape.h + 90];
    for (const wall of walls) {
      const mark1 = wallSet.mark();
      const count0 = out.louvers.length;
      const ok = start =>
        Math.abs(start + 100 + shape.w / 2 - center) <= reach &&
        !this.ventPlan.cogHit(wall, start + 100, start + 100 + shape.w, z0, z0 + shape.h);
      let got = 0;
      while (got < shape.n) {
        const u = wallSet.find(wall, shape.w + 360, z, center, ok);
        if (u == null) break;
        this.ventPlan.putAt({ kind: 'in', wall, w: shape.w, u, z0, h: shape.h });
        got++;
      }
      if (got === shape.n) return true;
      wallSet.reset(mark1);
      out.louvers.length = count0;
    }
    return false;
  }

  /** На стенах одним проёмом или со створками ворот — где жалюзи меньше; иначе под свободные участки. */
  wallIntake({ first, rest, firstW, lo: low, hi: high, allW, bands }) {
    const { walls: walls, out } = this.ventPlan;
    const grille = VentGrille.INLET;
    const [left0, count0, mark0, sz0] = [this.left, out.louvers.length, walls.mark(), out.size.in];
    const undo = () => {
      walls.reset(mark0);
      out.louvers.length = count0;
      this.left = left0;
      out.size.in = sz0;
    };
    const onWalls = () => {
      if (!this.ventPlan.whole('in', grille, allW, this.left / 1e6, bands)) return false;
      this.left = 0;
      return true;
    };
    const withLeaves = () => {
      this._allLeaves();
      return this.left <= 1 || (this.left < left0 && onWalls());
    };
    const onWall = onWalls() ? out.louvers.length - count0 : 0;
    if (onWall !== 1) {
      undo();
      const onLeaves = withLeaves() ? out.louvers.length - count0 : 0;
      if (!onLeaves || (onWall && onLeaves >= onWall)) {
        undo();
        if (onWall) onWalls();
        else
          this._pieces(
            low,
            firstW,
            rest.filter(([wall]) => wall !== first),
          );
      }
    }
    if (this.left > 1 && high.h[1] >= high.h[0])
      this.left = this.ventPlan.place('in', high, allW, { gross: this.left / 1e6 });
  }

  _pieces(low, firstW, others) {
    this.left = this.ventPlan.place('in', low, firstW, { gross: this.left / 1e6 });
    this._allLeaves();
    if (this.left > 1) this.left = this.ventPlan.place('in', low, others, { gross: this.left / 1e6 });
  }

  /** Жалюзи притока не встали — приточные вентиляторы на остаток (проём меньше, по датчику температуры). */
  inFans({ hi: high, allW }) {
    const exRule = StationRules.opt('vent.exfan');
    if (!(this.left > 1 && exRule && this.ventPlan.sys.infan !== false && this.ventPlan.qIn > 0)) return;
    const out = this.ventPlan.out;
    const flowIn = ((this.left / 1e6) * 3600 * this.ventPlan.vIn) / this.ventPlan.res;
    const gross = (flowIn * exRule.reserve) / 3600 / exRule.vFanIn;
    const nL0 = out.louvers.length;
    let rest = this.ventPlan.place('in', VentGrille.INLET, allW, { gross });
    if (rest > 1 && high.h[1] >= high.h[0]) rest = this.ventPlan.place('in', high, allW, { gross: rest / 1e6 });
    const fans = out.louvers.slice(nL0);
    for (const opening of fans) opening.fan = true;
    if (!fans.length) return;
    const done = Math.min(1, 1 - Math.max(0, rest) / (gross * 1e6));
    const flow = Math.round((flowIn * done) / 10) * 10;
    const fanFlow = Math.round((flow * exRule.reserve) / 10) * 10;
    out.infan = {
      n: fans.length,
      q: flow,
      L: fanFlow,
      dp: exRule.dp,
      eta: exRule.eta,
      P: VentCalc.fanPower(fanFlow, exRule.dp, exRule.eta),
      v: exRule.vFanIn,
    };
    this.left *= 1 - done;
  }
}
