import { EskdSheet } from './eskd-sheet.js';
import { StationLayout } from '../layout/station-layout.js';
import { IconAir } from './icon-air.js';
import { IconParts } from './icon-parts.js';
import { IconUnits } from './icon-units.js';

/** Оборудование на габаритном чертеже — упрощённые рисунки, схематически сходные с изделием, в его пропорциях. */
export class EquipIcon {
  /**
   * Картинка модели из кэша загруженных (вкладка «Состав станции») — подключает состав станции (kit/index.js).
   * @returns {string}
   */
  static picture = () => '';

  /** Вид спереди (разрез А–А). */
  static front(sheet, item, [x0, y0, x1, y1]) {
    const frame = EquipIcon.ctx(sheet, item, [x0, y0, x1, y1]);
    if (!frame) return;
    frame.side = !!item.rot || Math.abs(item.face) === 2;
    frame.rear = !frame.side && item.face > 0;
    const own = !frame.side && !frame.rear && item.pic;
    if (own && sheet.image([x0, y0, x1 - x0, y1 - y0], EquipIcon.src(item.pic.front), 'xMidYMax')) return;
    EquipIcon._frontDraw(frame);
  }

  static _frontDraw(frame) {
    const { item } = frame;
    if (item.mount === 'pipe') IconAir.filter(frame);
    else if (item.shape === 'hcyl') IconAir.hreceiver(frame, item.kind === 'receiver');
    else if (item.shape === 'vcyl') IconAir.vreceiver(frame, item.kind === 'receiver' ? 'receiver' : 'housing');
    else (EquipIcon.FRONT[item.kind] || IconParts.box)(frame);
  }

  /** Рисунки спереди по виду оборудования. */
  static FRONT = {
    compressor: frame => {
      if (frame.item.look === 'piston') IconAir.piston(frame);
      else if ((frame.item.air || {}).recv) IconAir.tankMounted(frame);
      else IconAir.screw(frame);
    },
    dryer: frame => (StationLayout.twinDryer(frame.item) ? IconAir.twin(frame) : IconAir.refrig(frame)),
    filter: frame => ((frame.item.air || {}).grade === 'cond' ? IconAir.separator(frame) : IconParts.box(frame)),
    cabinet: frame => IconUnits.cabinet(frame, frame.item.mount === 'floor' || frame.item.mount === 'frame'),
    // ДГУ: радиатор у входа — зеркально, поперёк — с торца
    dgu: frame => {
      if (frame.item.rad === 'back') IconUnits.dguEnd(frame);
      else if (frame.item.rad === 'left') IconParts.mirror(frame.sheet, frame.x0, frame.x1, () => IconUnits.dgu(frame));
      else IconUnits.dgu(frame);
    },
    pump: frame => (frame.height > frame.width * 1.2 ? IconUnits.vpump(frame) : IconUnits.pump(frame)),
    tank: frame => IconUnits.tank(frame),
  };

  /** Рисунки сверху по виду оборудования. */
  static TOP = {
    compressor: frame => (frame.item.look === 'piston' ? IconAir.pistonTop(frame) : IconAir.screwTop(frame)),
    dryer: frame => (StationLayout.twinDryer(frame.item) ? IconAir.twinTop(frame) : IconAir.refrigTop(frame)),
    cabinet: frame => IconUnits.cabinetTop(frame),
    dgu: frame => IconUnits.dguTop(frame),
    pump: frame => (frame.item.h > frame.item.lx * 1.2 ? IconUnits.vpumpTop(frame) : IconUnits.pumpTop(frame)),
    tank: frame => IconUnits.tankTop(frame),
  };

  /** Рисунок модели для SVG — только data:image (внешние адреса в картинку чертежа не попадают); адрес /img/… — из кэша загруженных (EquipIcon.picture). */
  static src(src) {
    const text = String(src || '');
    if (text.startsWith('data:image/')) return text;
    return EquipIcon.picture(text);
  }

  /** Вид сверху (разрез Б–Б): лицевая сторона — к проходу (вниз), к задней стене (вверх) или вдоль торца. */
  static plan(sheet, item, box) {
    const [x0, , x1] = box;
    if (item.rot && item.mount !== 'pipe' && item.shape === 'box') EquipIcon.planAcross(sheet, item, box);
    else if (item.kind === 'dgu' && item.rad === 'left')
      IconParts.mirror(sheet, x0, x1, () => EquipIcon.plan(sheet, { ...item, rad: null }, box)); // радиатор к торцу у входа
    else EquipIcon._planDraw(sheet, item, box);
  }

  /** Повёрнуто поперёк: рисунок вдоль длины изделия, повёрнутый на 90° (ДГУ поперёк — радиатором к задней стене). */
  static planAcross(sheet, item, [x0, y0, x1, y1]) {
    const fmt = EskdSheet.fmt;
    const [centerX, centerY] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [halfW, halfH] = [(y1 - y0) / 2, (x1 - x0) / 2];
    const turned = { ...item, rot: false, rad: null, lx: item.ly, ly: item.lx, face: -1 };
    sheet.group(
      `rotate(${item.kind === 'dgu' && item.rad === 'back' ? -90 : 90} ${fmt(centerX)} ${fmt(centerY)})`,
      () => EquipIcon.plan(sheet, turned, [centerX - halfW, centerY - halfH, centerX + halfW, centerY + halfH]),
    );
  }

  static _planDraw(sheet, item, box) {
    const frame = EquipIcon.ctx(sheet, item, box);
    if (!frame) return;
    const face = item.face;
    frame.front = { 2: 'r', '-2': 'l' }[face] || (face > 0 ? 't' : 'b');
    if (EquipIcon.picTop(sheet, item, frame)) return;
    if (item.mount === 'pipe') IconAir.filterTop(frame);
    else if (item.shape === 'vcyl') IconAir.vesselTop(frame, item.kind === 'receiver');
    else if (item.shape === 'hcyl') IconAir.hvesselTop(frame);
    else if (EquipIcon.TOP[item.kind]) EquipIcon.TOP[item.kind](frame);
    else frame.sheet.rect([frame.x0, frame.y0, frame.width, frame.height], 'main', '#fff');
  }

  /** Свой рисунок модели сверху (лицевая сторона — внизу рисунка). */
  static picTop(sheet, item, frame) {
    const src = item.pic ? EquipIcon.src(item.pic.top) : '';
    if (!src || (frame.front !== 'b' && frame.front !== 't')) return false;
    const rect = [frame.x0, frame.y0, frame.width, frame.height];
    if (frame.front === 'b') return sheet.image(rect, src);
    const fmt = EskdSheet.fmt;
    let ok = false;
    sheet.group(`rotate(180 ${fmt(frame.centerX)} ${fmt(frame.centerY)})`, () => {
      ok = sheet.image(rect, src);
    });
    return ok;
  }

  /** Рамка рисунка: k — мм листа на мм изделия; S(v, min) — размер детали в мм изделия на листе, не меньше min. */
  static ctx(sheet, item, [x0, y0, x1, y1]) {
    const width = x1 - x0;
    const height = y1 - y0;
    if (!(width > 0.3 && height > 0.3)) return null;
    const k = item.lx > 0 ? width / item.lx : 0.02;
    const scale = (value, min = 0) => Math.max(min, value * k);
    return {
      sheet,
      item,
      k,
      scale,
      x0,
      y0,
      x1,
      y1,
      width,
      height,
      centerX: (x0 + x1) / 2,
      centerY: (y0 + y1) / 2,
      minSide: Math.min(width, height),
    };
  }
}
