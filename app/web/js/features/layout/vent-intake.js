import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';

const r = x => Math.round(x * 100) / 100;
const OPP = { back: 'front', front: 'back', left: 'right', right: 'left' };
const floorDgu = I => I.filter(i => i.kind === 'dgu' && !i.tank && i.mount === 'floor');

/**
 * Приток: стена напротив выброса → створки ворот и сервисных дверей → свободные стены (не стена выброса); одним проёмом,
 * иначе одинаковыми; у ДГУ — напротив каждой, одинаковый; не встал — приточные вентиляторы, затем нехватка.
 */
export class VentIntake {
  constructor(vp) {
    this.vp = vp;
    this.left = 0;
  }

  /** Стены притока по порядку и высоты (внизу, над конвекторами; с маркизой — сначала выше). */
  inWalls() {
    const { E, exW, dgu, radW, L, x0 } = this.vp;
    const first = (E ? [OPP[E], 'left', 'right', 'front'].find(w => !exW.has(w)) : null) || 'front';
    const wallsOf = list => list.filter(([w]) => !exW.has(w) && (w !== 'left' || this.vp.leftOk));
    const lim = dgu && radW.size === 1 && radW.has('right') ? Math.round(L - 1500) : null;
    const mid = Math.round((x0 + L) / 2);
    const rest = wallsOf(this.restOrder(lim, mid));
    const firstW = wallsOf([[first, this.firstFrom(first, mid)]]);
    const { lo, hi } = this.heights();
    return {
      first,
      rest,
      firstW,
      lo,
      hi,
      allW: [...firstW, ...rest.filter(([w]) => w !== first)],
      bands: [lo.z0, hi.z0],
    };
  }

  /** Приток внизу и над конвекторами; с маркизой — сначала выше (вход под маркизой выше снегового покрова). */
  heights() {
    const IN = VentGrille.IN;
    const z = VentGrille.LIFT;
    const lift = {
      ...IN,
      z0: z,
      h: [IN.h[0], Math.min(IN.h[1], Math.floor((this.vp.H - this.vp.OB.top - 90 - z) / this.vp.S) * this.vp.S)],
    };
    const lo = this.vp.sys.snow && lift.h[1] >= lift.h[0] ? lift : IN;
    return { lo, hi: lo === IN ? lift : IN };
  }

  firstFrom(first, mid) {
    if (this.vp.dgu && this.vp.radW.has('left') && (first === 'front' || first === 'back')) return mid;
    return first === 'front' ? 'hi' : 'lo';
  }

  /** У ДГУ — не у радиатора: в дальнем торце — от входа; к обоим торцам — от середины; поперёк — стена прохода и торцы. */
  restOrder(lim, mid) {
    const { dgu, radW } = this.vp;
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
  leaves(d, wall, [u0, u1], n, skip) {
    const IN = VentGrille.IN;
    const S = this.vp.S;
    const lw = (u1 - u0) / n;
    const z0 = IN.z0;
    const hh = Math.floor(Math.min(d.h - 350 - z0, IN.h[1]) / S) * S;
    for (let i = 0; i < n && this.left > 1 && hh >= IN.h[0]; i++) {
      const a0 = u0 + i * lw + (i === 0 ? 120 : 160);
      const b0 = u0 + (i + 1) * lw - (i === n - 1 ? 120 : 160);
      const w = Math.min(IN.w[1], Math.floor((b0 - a0) / S) * S);
      if (i === skip || w < IN.w[0]) continue;
      const a = Math.round((a0 + b0 - w) / 2);
      this.vp.out.louvers.push({ kind: 'in', wall, u0: a, u1: a + w, z0, z1: z0 + hh, w, h: hh, leaf: true });
      this.left -= w * hh;
    }
  }

  allLeaves() {
    const { plan, exW } = this.vp;
    for (const Q of [plan.gates, plan.gates2].filter(q => q && !exW.has(q.wall))) {
      const pad = Q.sea ? 150 : 0;
      if (this.left > 1) this.leaves(Q, Q.wall, [Q.y0 + pad, Q.y1 - pad], Q.leaves || 2, Q.wicket ? 0 : -1);
    }
    for (const d of (plan.doors || []).filter(q => q.kind !== 'entry' && !exW.has(q.wall))) {
      if (this.left > 1) this.leaves(d, d.wall, [d.x0, d.x1], d.leaves || 1, -1);
    }
  }

  run() {
    const out = this.vp.out;
    const ctx = this.inWalls();
    this.left = this.vp.need(this.vp.qIn, 'in').gross * 1e6;
    if (this.vp.dgu && this.left > 1) this.dguIntake(ctx);
    if (this.left > 1) this.wallIntake(ctx);
    if (!out.size.in) out.size.in = VentGrille.size(out.need.in.gross, VentGrille.IN);
    this.inFans(ctx);
    out.short.in = r(Math.max(0, this.left) / 1e6);
  }

  /** ДГУ: приток у каждой напротив неё (стена прохода, иначе задняя), одинаковый, расход поровну. */
  dguIntake({ lo, hi }) {
    const DG = floorDgu(this.vp.I);
    const per = this.left / DG.length / 1e6;
    const ws = ['front', 'back'].filter(w => !this.vp.exW.has(w));
    for (const o of [lo, hi]) {
      if (this.left <= 1) break;
      const hmax = Math.floor(Math.min(o.h[1], this.vp.H - this.vp.OB.top - 90 - o.z0) / this.vp.S) * this.vp.S;
      for (let n = 1; hmax >= o.h[0] && n <= VentGrille.MAXN && this.left > 1; n++) {
        const shapes = VentGrille.sizesN(
          per,
          { ...o, w: [o.w[0], Math.max(o.w[1], VentGrille.WHOLE)], h: [o.h[0], hmax] },
          n,
        );
        const sz = shapes.find(q => this.eachDgu(DG, ws, q, o.z0));
        if (sz) {
          this.vp.out.size.in = { ...sz, n: n * DG.length };
          this.vp.out.inEach = true;
          this.left = 0;
        }
      }
    }
  }

  eachDgu(DG, ws, sz, z0) {
    const m = this.vp.W.mark();
    const nL0 = this.vp.out.louvers.length;
    if (DG.every(g => this.atDgu(g, ws, sz, z0))) return true;
    this.vp.W.reset(m);
    this.vp.out.louvers.length = nL0;
    return false;
  }

  /** n жалюзи в пределах ДГУ по длине (±1,5 м) на одной из стен ws. */
  atDgu(g, ws, sz, z0) {
    const { W, out } = this.vp;
    const c = Math.round(g.x + g.lx / 2);
    const reach = Math.max(g.lx / 2, 1500);
    const z = [z0 - 90, z0 + sz.h + 90];
    for (const w of ws) {
      const mk = W.mark();
      const k0 = out.louvers.length;
      const ok = a =>
        Math.abs(a + 100 + sz.w / 2 - c) <= reach && !this.vp.cogHit(w, a + 100, a + 100 + sz.w, z0, z0 + sz.h);
      let got = 0;
      while (got < sz.n) {
        const u = W.find(w, sz.w + 360, z, c, ok);
        if (u == null) break;
        this.vp.putAt({ kind: 'in', wall: w, w: sz.w, u, z0, h: sz.h });
        got++;
      }
      if (got === sz.n) return true;
      W.reset(mk);
      out.louvers.length = k0;
    }
    return false;
  }

  /** На стенах одним проёмом или со створками ворот — где жалюзи меньше; иначе под свободные участки. */
  wallIntake({ first, rest, firstW, lo, hi, allW, bands }) {
    const { W, out } = this.vp;
    const IN = VentGrille.IN;
    const [l0, nL, m0, sz0] = [this.left, out.louvers.length, W.mark(), out.size.in];
    const undo = () => {
      W.reset(m0);
      out.louvers.length = nL;
      this.left = l0;
      out.size.in = sz0;
    };
    const onWalls = () => {
      if (!this.vp.whole('in', IN, allW, this.left / 1e6, bands)) return false;
      this.left = 0;
      return true;
    };
    const withLeaves = () => {
      this.allLeaves();
      return this.left <= 1 || (this.left < l0 && onWalls());
    };
    const nA = onWalls() ? out.louvers.length - nL : 0;
    if (nA !== 1) {
      undo();
      const nB = withLeaves() ? out.louvers.length - nL : 0;
      if (!nB || (nA && nB >= nA)) {
        undo();
        if (nA) onWalls();
        else
          this.pieces(
            lo,
            firstW,
            rest.filter(([w]) => w !== first),
          );
      }
    }
    if (this.left > 1 && hi.h[1] >= hi.h[0]) this.left = this.vp.place('in', hi, allW, { gross: this.left / 1e6 });
  }

  pieces(lo, firstW, others) {
    this.left = this.vp.place('in', lo, firstW, { gross: this.left / 1e6 });
    this.allLeaves();
    if (this.left > 1) this.left = this.vp.place('in', lo, others, { gross: this.left / 1e6 });
  }

  /** Жалюзи притока не встали — приточные вентиляторы на остаток (проём меньше, по датчику температуры). */
  inFans({ hi, allW }) {
    const Ef = StationRules.opt('vent.exfan');
    if (!(this.left > 1 && Ef && this.vp.sys.infan !== false && this.vp.qIn > 0)) return;
    const out = this.vp.out;
    const qs = ((this.left / 1e6) * 3600 * this.vp.vIn) / this.vp.res;
    const g0 = (qs * Ef.reserve) / 3600 / Ef.vFanIn;
    const nL0 = out.louvers.length;
    let fl = this.vp.place('in', VentGrille.IN, allW, { gross: g0 });
    if (fl > 1 && hi.h[1] >= hi.h[0]) fl = this.vp.place('in', hi, allW, { gross: fl / 1e6 });
    const Fi = out.louvers.slice(nL0);
    for (const q of Fi) q.fan = true;
    if (!Fi.length) return;
    const done = Math.min(1, 1 - Math.max(0, fl) / (g0 * 1e6));
    const q = Math.round((qs * done) / 10) * 10;
    const Lf = Math.round((q * Ef.reserve) / 10) * 10;
    out.infan = {
      n: Fi.length,
      q,
      L: Lf,
      dp: Ef.dp,
      eta: Ef.eta,
      P: VentCalc.fanPower(Lf, Ef.dp, Ef.eta),
      v: Ef.vFanIn,
    };
    this.left *= 1 - done;
  }
}
