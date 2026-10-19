/** Места оборудования на плане: на полу (из ряда), на стене, на трубе, снаружи; пересечения и занятая длина. */
export class LayoutItem {
  /** Общие поля места из оборудования e. */
  static base(e) {
    return {
      id: e.id,
      pos: e.pos,
      unit: e.unit,
      name: e.name,
      brief: e.brief,
      short: e.short,
      kind: e.kind,
      shape: e.shape,
      look: e.look || '',
      color: e.color,
      colorKnown: e.colorKnown,
      tones: e.tones || null,
      maker: e.maker || '',
      known: e.known,
      mass: e.mass,
      kw: e.kw,
    };
  }

  /** Шкаф на стене, фильтр на трубе, ресивер снаружи — не из ряда; o — положение и отличия. */
  static unit(e, o) {
    return {
      ...this.base(e),
      lx: e.l,
      ly: e.w,
      h: e.h,
      rot: false,
      face: -1,
      back: 0,
      aisle: 0,
      l: e.l,
      w: e.w,
      row: -1,
      slot: false,
      pipe: Boolean(e.pipe),
      air: e.air || null,
      pic: e.pic || null,
      ...o,
    };
  }

  /**
   * Место из ряда: координаты полезной зоны (без зазора G на коммуникации) → координаты помещения.
   * @param {object} it место в ряду {o, ri, x, lx, d, y, face, back, aisle}
   */
  static floor(it, geo, G) {
    const e = it.o.e;
    return {
      ...this.base(e),
      x: geo.x0 + G + it.x,
      y: it.y + G,
      z: 0,
      lx: it.lx,
      ly: it.d,
      h: e.h,
      rot: Boolean(it.o.rot) || Boolean(e.cross),
      face: it.face,
      back: it.back + G,
      backRec: e.cross ? 0 : e.c.back[0] + G,
      aisle: it.aisle + G,
      cross: Boolean(e.cross),
      l: e.l,
      w: e.w,
      row: it.ri,
      rad: it.o.rad || null,
      mount: e.slot ? e.mount : 'floor',
      slot: Boolean(e.slot),
      pipe: Boolean(e.pipe),
      air: e.air || null,
      pic: e.pic || null,
      flow: e.flow || null,
      cool: e.cool || null,
      comb: e.comb || null,
      heat: e.heat || null,
      ctype: e.ctype || '',
    };
  }

  /** Пересекаются ли короба a и b (x, y, z, lx, ly, h) с зазором pad по длине. */
  static hit(a, b, pad) {
    const az = a.z || 0;
    const bz = b.z || 0;
    return (
      a.x < b.x + b.lx + pad &&
      a.x + a.lx + pad > b.x &&
      a.y < b.y + b.ly &&
      a.y + a.ly > b.y &&
      az < bz + b.h &&
      az + a.h > bz
    );
  }

  /** Занятая длина: от первого до последнего на полу; free — свободно по длине помещения. */
  static used(items, geo) {
    const floor = items.filter(i => i.mount !== 'wall' && i.mount !== 'pipe' && !i.tank);
    const I = floor.length ? floor : items;
    const x0 = Math.min(...I.map(i => i.x));
    const x1 = Math.max(...I.map(i => i.x + i.lx));
    return { x0, x1, free: Math.max(0, geo.int[0] - (x1 - x0) - geo.x0) };
  }
}
