import { Mm } from './mm.js';
import { RalColor } from './ral-color.js';
import { StationGeo } from './station-geo.js';

/** Окраска контейнера по частям и рисунки заказчика на стенах. */
export class StationPaint {
  static PARTS = [
    ['frame', 'Цвет каркаса', 'RAL 5005'],
    ['wall', 'Цвет стен', 'RAL 7035'],
    ['roof', 'Цвет крыши', 'как каркас'],
    ['floor', 'Цвет пола', 'по материалу'],
    ['door', 'Цвет дверей и ворот', 'как стены'],
  ];

  static WALLS = { front: 'Передняя стена', back: 'Задняя стена', left: 'Левый торец', right: 'Правый торец' };

  static ALONG = [
    [0.15, 'у левого края'],
    [0.3, 'левее центра'],
    [0.5, 'по центру'],
    [0.7, 'правее центра'],
    [0.85, 'у правого края'],
  ];

  static HIGH = [
    [0.75, 'вверху'],
    [0.5, 'посередине'],
    [0.3, 'внизу'],
  ];

  static ART_MAX = 6;

  static get KEYS() {
    return this.PARTS.map(([key]) => key);
  }

  /**
   * Окраска частей как вписал менеджер; прежнее поле «Цвет» (c.ral) — первый RAL стены, второй каркас.
   * @returns {{frame: string, wall: string, roof: string, floor: string, door: string}}
   */
  static of(cont) {
    const box = cont || {};
    if (box.paint && typeof box.paint === 'object') {
      return Object.fromEntries(this.KEYS.map(k => [k, String(box.paint[k] || '').trim()]));
    }
    const out = Object.fromEntries(this.KEYS.map(k => [k, '']));
    const [wall, frame] = RalColor.codes(box.ral);
    if (wall) Object.assign(out, { wall: wall.code, frame: frame ? frame.code : '' });
    else out.wall = String(box.ral || '').trim();
    return out;
  }

  /** Поле окраски изменено: дальше — только отдельные поля, прежнее «Цвет» не читается. */
  static set(cont, key, value) {
    if (!this.KEYS.includes(key)) return;
    cont.paint = {
      ...this.of(cont),
      [key]: String(value || '')
        .trim()
        .slice(0, 60),
    };
    delete cont.ral;
  }

  /** @returns {string | null} RAL → hex, «синий» → условный цвет */
  static hex(text) {
    const [ral] = RalColor.codes(text);
    return ral ? ral.hex : RalColor.named(text);
  }

  /** «RAL 7035» — код RAL, иначе текст менеджера. */
  static code(text) {
    const [ral] = RalColor.codes(text);
    return ral ? ral.code : String(text || '').trim();
  }

  /** Цвета для 3D и видов; не заданы — RAL 7035 / RAL 5005 условно, пол null — по материалу. */
  static colors(cont) {
    const paint = this.of(cont);
    const wallHex = this.hex(paint.wall);
    const frameHex = this.hex(paint.frame);
    const wall = wallHex || '#CBD0CC';
    const frame = frameHex || (wallHex ? RalColor.shade(wall, 0.72) : '#154889');
    return {
      wall,
      frame,
      roof: this.hex(paint.roof) || frame,
      door: this.hex(paint.door) || wall,
      floor: this.hex(paint.floor),
      known: Boolean(wallHex || frameHex),
    };
  }

  static book(cont) {
    return Boolean(cont && cont.paintBook);
  }

  /** Строка «Окраска» в характеристиках КП; ничего не задано — ''. */
  static kpLine(cont) {
    if (this.book(cont)) return 'по буклету цветовых решений заказчика';
    const paint = this.of(cont);
    if (!Object.values(paint).some(Boolean)) return '';
    const code = value => this.code(value);
    const roof = paint.roof || paint.frame;
    const floor = paint.floor ? `пол ${code(paint.floor)}` : `пол — ${StationGeo.FLOORS[StationGeo.floor(cont)].short}`;
    return [
      paint.frame && `каркас ${code(paint.frame)}`,
      paint.wall && `стены ${code(paint.wall)}`,
      roof && !StationGeo.SEA[cont.ctype] && `крыша ${code(roof)}`,
      paint.door && code(paint.door) !== code(paint.wall) && `двери и ворота ${code(paint.door)}`,
      floor,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Подпись на чертеже: «RAL 7035 / RAL 5005». */
  static short(cont) {
    if (this.book(cont)) return 'по буклету заказчика';
    const paint = this.of(cont);
    return [paint.wall, paint.frame]
      .filter(Boolean)
      .map(value => this.code(value))
      .join(' / ');
  }

  /** ТЗ на сборку: каждая часть и откуда её цвет. */
  static tzRows(cont) {
    const paint = this.of(cont);
    const code = val => this.code(val);
    const orCode = (value, fallback) => (value ? code(value) : fallback);
    const like = (own, base, what) => (own ? code(own) : `${base ? `${code(base)}, ` : ''}в цвет ${what}`);
    const parts = [
      `каркас — ${orCode(paint.frame, 'по согласованию')}`,
      `стены — ${orCode(paint.wall, 'по согласованию')}`,
      StationGeo.SEA[cont.ctype] ? '' : `крыша — ${like(paint.roof, paint.frame, 'каркаса')}`,
      `двери и ворота — ${like(paint.door, paint.wall, 'стен')}`,
      `пол — ${paint.floor ? `окраска ${code(paint.floor)}` : StationGeo.FLOORS[StationGeo.floor(cont)].name}`,
    ].filter(Boolean);
    const book = this.book(cont) ? 'по буклету цветовых решений заказчика (приложение к ТЗ); для ориентира: ' : '';
    return book + parts.join('; ');
  }

  /**
   * Рисунки заказчика: x, z — середина в долях стены (снаружи, слева направо и снизу вверх), w — ширина, мм.
   * @returns {{src: string, name: string, wall: string, x: number, z: number, w: number, ar: number}[]}
   */
  static arts(cont) {
    const list = cont && Array.isArray(cont.art) ? cont.art : [];
    return list
      .filter(art => art && art.src && this.WALLS[art.wall])
      .slice(0, this.ART_MAX)
      .map(art => ({
        src: String(art.src),
        name: String(art.name || ''),
        wall: art.wall,
        x: this.frac(art.x, 0.5),
        z: this.frac(art.z, 0.5),
        w: Math.max(100, Math.min(12000, +art.w || 1500)),
        ar: Math.max(0.1, Math.min(10, +art.ar || 1)),
      }));
  }

  static frac(v, fallback) {
    const x = +v;
    return x >= 0 && x <= 1 ? x : fallback;
  }

  /** «Передняя стена, по центру, посередине, ширина 1 500 мм» */
  static where(art) {
    const near = (list, v) =>
      list.reduce((best, pair) => (Math.abs(pair[0] - v) < Math.abs(best[0] - v) ? pair : best))[1];
    return `${this.WALLS[art.wall]}, ${near(this.ALONG, art.x)}, ${near(this.HIGH, art.z)}, ширина ${Mm.text(art.w)} мм`;
  }

  /** Отпечаток окраски — картинки пересобираются при правке цвета, рисунка, буклета. */
  static stamp(cont) {
    const src = text => (text.length > 200 ? text.length + text.slice(-40) : text);
    const arts = this.arts(cont).map(art => [src(art.src), art.wall, art.x, art.z, art.w]);
    return JSON.stringify([this.of(cont), Boolean(this.book(cont)), arts]);
  }
}
