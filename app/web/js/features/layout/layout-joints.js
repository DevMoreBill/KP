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

  fit(res, geo, lenUse, Wi) {
    const joints = StationMods.lines(geo);
    const half = StationMods.RULES.post / 2;
    const wallGap = this.lay.gap;
    const jointsX = joints.x.map(v => v - geo.x0 - wallGap);
    const jointsY = joints.y.map(v => v - wallGap);
    const bad = this.across(res, jointsY, half, Wi);
    if (bad.length) return { ok: false, why: 'joint', bad: [...new Set(bad)] };
    if (jointsX.length)
      for (const rowIx of [...new Set(res.items.map(i => i.ri))])
        this.along(
          res.items.filter(i => i.ri === rowIx).sort((left, right) => left.x - right.x),
          jointsX,
          half,
          lenUse,
        );
    const end = Math.max(...res.items.map(i => i.x + i.lx));
    if (end > lenUse) return { ok: false, why: 'length', needL: end + 100, needL0: end + 100 };
    res.aisleW = Math.min(...res.items.map(i => i.aisle));
    this.entry(res, jointsX, half);
    return res;
  }

  /** Полосы модулей поперёк: [от, до] между стыками с отступом в полстойки. */
  zones(jointsY, half, Wi) {
    return Array.from({ length: jointsY.length + 1 }, (_, k) => [
      k ? jointsY[k - 1] + half : 0,
      k < jointsY.length ? jointsY[k] - half : Wi,
    ]);
  }

  /** ДГУ вдоль — посередине своей полосы. */
  midDgu(item) {
    return item.o.e.kind === 'dgu' && !item.o.rot;
  }

  /** Поперёк: на стыке — в ближайшую полосу (у задней стены — у неё, у передней — у неё, ДГУ — ближайшую по середине). */
  across(res, jointsY, half, Wi) {
    const zones = this.zones(jointsY, half, Wi);
    const bad = [];
    const moved = [];
    for (const item of res.items.filter(i => jointsY.some(y => i.y < y + half && i.y + i.d > y - half))) {
      const z = this.zoneFor(item, zones);
      if (!z || item.o.e.cross || item.o.end) {
        bad.push(item.o.e);
        continue;
      }
      this.moveInto(item, z, Wi);
      if (item.back < this.backMin(item)) bad.push(item.o.e);
      moved.push(item);
    }
    if (moved.length && res.rows === 2) this.shareAisle(res, Wi);
    for (const item of moved.filter(i => i.aisle < this.aisleMin(i))) bad.push(item.o.e);
    return bad;
  }

  zoneFor(item, zones) {
    const depth = item.d;
    const center = item.y + depth / 2;
    const mid = this.midDgu(item);
    const byCenter = (left, right) =>
      Math.abs((left[0] + left[1]) / 2 - center) - Math.abs((right[0] + right[1]) / 2 - center);
    const order = (left, right) => {
      if (!mid && item.face === -1) return right[1] - left[1];
      if (!mid && item.face === 1) return left[0] - right[0];
      return byCenter(left, right);
    };
    return zones.filter(([from, till]) => till - from >= depth).sort(order)[0];
  }

  moveInto(item, z, Wi) {
    const depth = item.d;
    item.y = this.midDgu(item)
      ? Math.round(z[0] + (z[1] - z[0] - depth) / 2)
      : Math.min(Math.max(item.y, z[0]), z[1] - depth);
    if (item.face === 1) item.back = item.y;
    else {
      item.back = Wi - item.y - depth;
      item.aisle = item.y;
    }
  }

  backMin(item) {
    return this.midDgu(item) ? StationMatrix.grp('dgu').pass : Math.min(...item.o.e.c.back);
  }

  aisleMin(item) {
    return this.midDgu(item) ? StationMatrix.grp('dgu').pass : Math.min(this.lay.aisle[1], this.lay.front(item.o.e)[1]);
  }

  /** Два ряда: проход между рядами — общий. */
  shareAisle(res, Wi) {
    const far = res.items.filter(i => i.ri === 1);
    const near = res.items.filter(i => i.ri === 0);
    const free =
      (near.length ? Math.min(...near.map(i => i.y)) : Wi) - (far.length ? Math.max(...far.map(i => i.y + i.d)) : 0);
    for (const item of res.items) item.aisle = free;
  }

  /**
   * По длине, ряд слева направо: агрегат на стыке — за стык в ближнюю сторону, если промежуток к соседу не меньше
   * прежнего (и не меньше 700 мм); иначе — вместе со следующими (или предыдущими — за счёт свободной длины у двери).
   */
  along(row, jointsX, half, lenUse) {
    row.forEach((item, k) => {
      const x = jointsX.find(v => item.x < v + half && item.x + item.lx > v - half);
      if (x == null) return;
      const near = this.nearSide(row, k, x, half, lenUse);
      if (near != null) {
        item.x = near;
        return;
      }
      const dx = Math.round(x + half - item.x);
      const shift = Math.round(item.x + item.lx - (x - half));
      const last = row[row.length - 1];
      if (last.x + last.lx + dx > lenUse && row[0].x - shift >= Math.min(row[0].x, 600)) {
        for (const unit of row.slice(0, k + 1)) unit.x -= shift;
        return;
      }
      for (const unit of row.slice(k)) unit.x += dx;
    });
  }

  /** Ближняя сторона стыка, куда агрегат встаёт сам; нет — null. */
  nearSide(row, k, x, half, lenUse) {
    const item = row[k];
    const prev = row[k - 1];
    const next = row[k + 1];
    const gapPrev = prev ? item.x - prev.x - prev.lx : item.x;
    const gapNext = next ? next.x - item.x - item.lx : lenUse - item.x - item.lx;
    const leftX = Math.round(x - half - item.lx);
    const rightX = Math.round(x + half);
    const okL = leftX - (prev ? prev.x + prev.lx : 0) >= Math.min(gapPrev, 700);
    const okR = (next ? next.x : lenUse) - rightX - item.lx >= Math.min(gapNext, 700);
    const opt = [okL ? leftX : null, okR ? rightX : null]
      .filter(v => v != null)
      .sort((left, right) => Math.abs(left - item.x) - Math.abs(right - item.x));
    return opt.length ? opt[0] : null;
  }

  /** Дверь оператора на стыке — за стык. */
  entry(res, jointsX, half) {
    if (!res.entry) return;
    const v = jointsX.find(joint => res.entry[0] < joint + half && res.entry[1] > joint - half);
    if (v == null) return;
    const width = res.entry[1] - res.entry[0];
    res.entry = [v + half, v + half + width];
  }
}
