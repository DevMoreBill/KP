import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/**
 * Станция из модулей: модуль везут с оборудованием внутри — каждый агрегат целиком в своём модуле, от линии стыка не
 * ближе полустойки каркаса. Поперёк — в ближайшую полосу модуля, где помещается; по длине — за стык, следующие в ряду
 * сдвигаются. Координаты — полезные (без зазора G).
 */
export class LayoutJoints {
  constructor(lay) {
    this.lay = lay;
  }

  fit(r, geo, Lu, W) {
    const J = StationMods.lines(geo);
    const s = StationMods.M.post / 2;
    const g = this.lay.G;
    const X = J.x.map(v => v - geo.x0 - g);
    const Y = J.y.map(v => v - g);
    const bad = this.across(r, Y, s, W);
    if (bad.length) return { ok: false, why: 'joint', bad: [...new Set(bad)] };
    if (X.length)
      for (const ri of [...new Set(r.items.map(i => i.ri))])
        this.along(
          r.items.filter(i => i.ri === ri).sort((p, q) => p.x - q.x),
          X,
          s,
          Lu,
        );
    const end = Math.max(...r.items.map(i => i.x + i.lx));
    if (end > Lu) return { ok: false, why: 'length', needL: end + 100, needL0: end + 100 };
    r.aisleW = Math.min(...r.items.map(i => i.aisle));
    this.entry(r, X, s);
    return r;
  }

  /** Полосы модулей поперёк: [от, до] между стыками с отступом в полстойки. */
  zones(Y, s, W) {
    return Array.from({ length: Y.length + 1 }, (_, k) => [k ? Y[k - 1] + s : 0, k < Y.length ? Y[k] - s : W]);
  }

  /** ДГУ вдоль — посередине своей полосы. */
  midDgu(it) {
    return it.o.e.kind === 'dgu' && !it.o.rot;
  }

  /** Поперёк: на стыке — в ближайшую полосу (у задней стены — у неё, у передней — у неё, ДГУ — ближайшую по середине). */
  across(r, Y, s, W) {
    const zones = this.zones(Y, s, W);
    const bad = [];
    const moved = [];
    for (const it of r.items.filter(i => Y.some(y => i.y < y + s && i.y + i.d > y - s))) {
      const z = this.zoneFor(it, zones);
      if (!z || it.o.e.cross || it.o.end) {
        bad.push(it.o.e);
        continue;
      }
      this.moveInto(it, z, W);
      if (it.back < this.backMin(it)) bad.push(it.o.e);
      moved.push(it);
    }
    if (moved.length && r.rows === 2) this.shareAisle(r, W);
    for (const it of moved.filter(i => i.aisle < this.aisleMin(i))) bad.push(it.o.e);
    return bad;
  }

  zoneFor(it, zones) {
    const d = it.d;
    const c = it.y + d / 2;
    const mid = this.midDgu(it);
    const byCenter = (p, q) => Math.abs((p[0] + p[1]) / 2 - c) - Math.abs((q[0] + q[1]) / 2 - c);
    const order = (p, q) => {
      if (!mid && it.face === -1) return q[1] - p[1];
      if (!mid && it.face === 1) return p[0] - q[0];
      return byCenter(p, q);
    };
    return zones.filter(([a, b]) => b - a >= d).sort(order)[0];
  }

  moveInto(it, z, W) {
    const d = it.d;
    it.y = this.midDgu(it) ? Math.round(z[0] + (z[1] - z[0] - d) / 2) : Math.min(Math.max(it.y, z[0]), z[1] - d);
    if (it.face === 1) it.back = it.y;
    else {
      it.back = W - it.y - d;
      it.aisle = it.y;
    }
  }

  backMin(it) {
    return this.midDgu(it) ? StationMatrix.grp('dgu').pass : Math.min(...it.o.e.c.back);
  }

  aisleMin(it) {
    return this.midDgu(it) ? StationMatrix.grp('dgu').pass : Math.min(this.lay.aisle[1], this.lay.front(it.o.e)[1]);
  }

  /** Два ряда: проход между рядами — общий. */
  shareAisle(r, W) {
    const A = r.items.filter(i => i.ri === 1);
    const B = r.items.filter(i => i.ri === 0);
    const free = (B.length ? Math.min(...B.map(i => i.y)) : W) - (A.length ? Math.max(...A.map(i => i.y + i.d)) : 0);
    for (const it of r.items) it.aisle = free;
  }

  /**
   * По длине, ряд слева направо: агрегат на стыке — за стык в ближнюю сторону, если промежуток к соседу не меньше
   * прежнего (и не меньше 700 мм); иначе — вместе со следующими (или предыдущими — за счёт свободной длины у двери).
   */
  along(row, X, s, Lu) {
    row.forEach((it, k) => {
      const x = X.find(v => it.x < v + s && it.x + it.lx > v - s);
      if (x == null) return;
      const near = this.nearSide(row, k, x, s, Lu);
      if (near != null) {
        it.x = near;
        return;
      }
      const dx = Math.round(x + s - it.x);
      const dl = Math.round(it.x + it.lx - (x - s));
      const last = row[row.length - 1];
      if (last.x + last.lx + dx > Lu && row[0].x - dl >= Math.min(row[0].x, 600)) {
        for (const q of row.slice(0, k + 1)) q.x -= dl;
        return;
      }
      for (const q of row.slice(k)) q.x += dx;
    });
  }

  /** Ближняя сторона стыка, куда агрегат встаёт сам; нет — null. */
  nearSide(row, k, x, s, Lu) {
    const it = row[k];
    const pv = row[k - 1];
    const nx = row[k + 1];
    const g0 = pv ? it.x - pv.x - pv.lx : it.x;
    const g1 = nx ? nx.x - it.x - it.lx : Lu - it.x - it.lx;
    const xl = Math.round(x - s - it.lx);
    const xr = Math.round(x + s);
    const okL = xl - (pv ? pv.x + pv.lx : 0) >= Math.min(g0, 700);
    const okR = (nx ? nx.x : Lu) - xr - it.lx >= Math.min(g1, 700);
    const opt = [okL ? xl : null, okR ? xr : null]
      .filter(v => v != null)
      .sort((p, q) => Math.abs(p - it.x) - Math.abs(q - it.x));
    return opt.length ? opt[0] : null;
  }

  /** Дверь оператора на стыке — за стык. */
  entry(r, X, s) {
    if (!r.entry) return;
    const v = X.find(q => r.entry[0] < q + s && r.entry[1] > q - s);
    if (v == null) return;
    const w = r.entry[1] - r.entry[0];
    r.entry = [v + s, v + s + w];
  }
}
