import { EskdSheet } from './eskd-sheet.js';
import { StationLayout } from '../layout/station-layout.js';
import { IconAir } from './icon-air.js';
import { IconParts } from './icon-parts.js';
import { IconUnits } from './icon-units.js';

/** Оборудование на габаритном чертеже — упрощённые рисунки, схематически сходные с изделием, в его пропорциях. */
export class EquipIcon {
  /** Вид спереди (разрез А–А). */
  static front(sh, it, [x0, y0, x1, y1]) {
    const c = EquipIcon.ctx(sh, it, [x0, y0, x1, y1]);
    if (!c) return;
    c.side = !!it.rot || Math.abs(it.face) === 2;
    c.rear = !c.side && it.face > 0;
    const own = !c.side && !c.rear && it.pic;
    if (own && sh.image([x0, y0, x1 - x0, y1 - y0], EquipIcon.src(it.pic.front), 'xMidYMax')) return;
    EquipIcon.frontDraw(c);
  }

  static frontDraw(c) {
    const { it } = c;
    if (it.mount === 'pipe') IconAir.filter(c);
    else if (it.shape === 'hcyl') IconAir.hreceiver(c, it.kind === 'receiver');
    else if (it.shape === 'vcyl') IconAir.vreceiver(c, it.kind === 'receiver' ? 'receiver' : 'housing');
    else (EquipIcon.FRONT[it.kind] || IconParts.box)(c);
  }

  /** Рисунки спереди по виду оборудования. */
  static FRONT = {
    compressor: c => {
      if (c.it.look === 'piston') IconAir.piston(c);
      else if ((c.it.air || {}).recv) IconAir.tankMounted(c);
      else IconAir.screw(c);
    },
    dryer: c => (StationLayout.twinDryer(c.it) ? IconAir.twin(c) : IconAir.refrig(c)),
    filter: c => ((c.it.air || {}).grade === 'cond' ? IconAir.separator(c) : IconParts.box(c)),
    cabinet: c => IconUnits.cabinet(c, c.it.mount === 'floor' || c.it.mount === 'frame'),
    // ДГУ: радиатор у входа — зеркально, поперёк — с торца
    dgu: c => {
      if (c.it.rad === 'back') IconUnits.dguEnd(c);
      else if (c.it.rad === 'left') IconParts.mirror(c.sh, c.x0, c.x1, () => IconUnits.dgu(c));
      else IconUnits.dgu(c);
    },
    pump: c => (c.h > c.w * 1.2 ? IconUnits.vpump(c) : IconUnits.pump(c)),
    tank: c => IconUnits.tank(c),
  };

  /** Рисунки сверху по виду оборудования. */
  static TOP = {
    compressor: c => (c.it.look === 'piston' ? IconAir.pistonTop(c) : IconAir.screwTop(c)),
    dryer: c => (StationLayout.twinDryer(c.it) ? IconAir.twinTop(c) : IconAir.refrigTop(c)),
    cabinet: c => IconUnits.cabinetTop(c),
    dgu: c => IconUnits.dguTop(c),
    pump: c => (c.it.h > c.it.lx * 1.2 ? IconUnits.vpumpTop(c) : IconUnits.pumpTop(c)),
    tank: c => IconUnits.tankTop(c),
  };

  /** Рисунок модели для SVG — только data:image (внешние адреса в картинку чертежа не попадают); адрес /img/… — из кэша загруженных (DrawPic, вкладка «Состав станции»). */
  static src(s) {
    const t = String(s || '');
    if (t.startsWith('data:image/')) return t;
    return typeof DrawPic !== 'undefined' ? DrawPic.data(t) : '';
  }

  /** Вид сверху (разрез Б–Б): лицевая сторона — к проходу (вниз), к задней стене (вверх) или вдоль торца. */
  static plan(sh, it, box) {
    const [x0, , x1] = box;
    if (it.rot && it.mount !== 'pipe' && it.shape === 'box') EquipIcon.planAcross(sh, it, box);
    else if (it.kind === 'dgu' && it.rad === 'left')
      IconParts.mirror(sh, x0, x1, () => EquipIcon.plan(sh, { ...it, rad: null }, box)); // радиатор к торцу у входа
    else EquipIcon.planDraw(sh, it, box);
  }

  /** Повёрнуто поперёк: рисунок вдоль длины изделия, повёрнутый на 90° (ДГУ поперёк — радиатором к задней стене). */
  static planAcross(sh, it, [x0, y0, x1, y1]) {
    const f = EskdSheet.f;
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [hw, hh] = [(y1 - y0) / 2, (x1 - x0) / 2];
    const turned = { ...it, rot: false, rad: null, lx: it.ly, ly: it.lx, face: -1 };
    sh.group(`rotate(${it.kind === 'dgu' && it.rad === 'back' ? -90 : 90} ${f(cx)} ${f(cy)})`, () =>
      EquipIcon.plan(sh, turned, [cx - hw, cy - hh, cx + hw, cy + hh]),
    );
  }

  static planDraw(sh, it, box) {
    const c = EquipIcon.ctx(sh, it, box);
    if (!c) return;
    const f = it.face;
    c.front = { 2: 'r', '-2': 'l' }[f] || (f > 0 ? 't' : 'b');
    if (EquipIcon.picTop(sh, it, c)) return;
    if (it.mount === 'pipe') IconAir.filterTop(c);
    else if (it.shape === 'vcyl') IconAir.vesselTop(c, it.kind === 'receiver');
    else if (it.shape === 'hcyl') IconAir.hvesselTop(c);
    else if (EquipIcon.TOP[it.kind]) EquipIcon.TOP[it.kind](c);
    else c.sh.rect([c.x0, c.y0, c.w, c.h], 'main', '#fff');
  }

  /** Свой рисунок модели сверху (лицевая сторона — внизу рисунка). */
  static picTop(sh, it, c) {
    const src = it.pic ? EquipIcon.src(it.pic.top) : '';
    if (!src || (c.front !== 'b' && c.front !== 't')) return false;
    const rect = [c.x0, c.y0, c.w, c.h];
    if (c.front === 'b') return sh.image(rect, src);
    const F = EskdSheet.f;
    let ok = false;
    sh.group(`rotate(180 ${F(c.cx)} ${F(c.cy)})`, () => {
      ok = sh.image(rect, src);
    });
    return ok;
  }

  /** Рамка рисунка: k — мм листа на мм изделия; S(v, min) — размер детали в мм изделия на листе, не меньше min. */
  static ctx(sh, it, [x0, y0, x1, y1]) {
    const w = x1 - x0;
    const h = y1 - y0;
    if (!(w > 0.3 && h > 0.3)) return null;
    const k = it.lx > 0 ? w / it.lx : 0.02;
    const S = (v, min = 0) => Math.max(min, v * k);
    return { sh, it, k, S, x0, y0, x1, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, m: Math.min(w, h) };
  }
}
