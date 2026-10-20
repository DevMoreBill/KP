/** Места оборудования на плане: на полу (из ряда), на стене, на трубе, снаружи; пересечения и занятая длина. */
export class LayoutItem {
  /** Общие поля места из оборудования e. */
  static base(unit) {
    return {
      id: unit.id,
      pos: unit.pos,
      unit: unit.unit,
      name: unit.name,
      brief: unit.brief,
      short: unit.short,
      kind: unit.kind,
      shape: unit.shape,
      look: unit.look || '',
      color: unit.color,
      colorKnown: unit.colorKnown,
      tones: unit.tones || null,
      maker: unit.maker || '',
      known: unit.known,
      mass: unit.mass,
      kw: unit.kw,
    };
  }

  /** Шкаф на стене, фильтр на трубе, ресивер снаружи — не из ряда; o — положение и отличия. */
  static unit(unit, extra) {
    return {
      ...this.base(unit),
      lx: unit.l,
      ly: unit.w,
      h: unit.h,
      rot: false,
      face: -1,
      back: 0,
      aisle: 0,
      l: unit.l,
      w: unit.w,
      row: -1,
      slot: false,
      pipe: Boolean(unit.pipe),
      air: unit.air || null,
      pic: unit.pic || null,
      ...extra,
    };
  }

  /**
   * Место из ряда: координаты полезной зоны (без зазора G на коммуникации) → координаты помещения.
   * @param {object} it место в ряду {o, ri, x, lx, d, y, face, back, aisle}
   */
  static floor(item, geo, gap) {
    const unit = item.o.e;
    return {
      ...this.base(unit),
      x: geo.x0 + gap + item.x,
      y: item.y + gap,
      z: 0,
      lx: item.lx,
      ly: item.d,
      h: unit.h,
      rot: Boolean(item.o.rot) || Boolean(unit.cross),
      face: item.face,
      back: item.back + gap,
      backRec: unit.cross ? 0 : unit.c.back[0] + gap,
      aisle: item.aisle + gap,
      cross: Boolean(unit.cross),
      l: unit.l,
      w: unit.w,
      row: item.ri,
      rad: item.o.rad || null,
      mount: unit.slot ? unit.mount : 'floor',
      slot: Boolean(unit.slot),
      pipe: Boolean(unit.pipe),
      air: unit.air || null,
      pic: unit.pic || null,
      flow: unit.flow || null,
      cool: unit.cool || null,
      comb: unit.comb || null,
      heat: unit.heat || null,
      ctype: unit.ctype || '',
    };
  }

  /** Пересекаются ли короба a и b (x, y, z, lx, ly, h) с зазором pad по длине. */
  static hit(first, second, pad) {
    const firstZ = first.z || 0;
    const secondZ = second.z || 0;
    return (
      first.x < second.x + second.lx + pad &&
      first.x + first.lx + pad > second.x &&
      first.y < second.y + second.ly &&
      first.y + first.ly > second.y &&
      firstZ < secondZ + second.h &&
      firstZ + first.h > secondZ
    );
  }

  /** Занятая длина: от первого до последнего на полу; free — свободно по длине помещения. */
  static used(items, geo) {
    const floor = items.filter(i => i.mount !== 'wall' && i.mount !== 'pipe' && !i.tank);
    const pool = floor.length ? floor : items;
    const x0 = Math.min(...pool.map(i => i.x));
    const x1 = Math.max(...pool.map(i => i.x + i.lx));
    return { x0, x1, free: Math.max(0, geo.int[0] - (x1 - x0) - geo.x0) };
  }
}
