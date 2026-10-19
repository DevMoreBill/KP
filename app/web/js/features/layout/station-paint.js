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
  static of(c) {
    const box = c || {};
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
  static set(c, key, value) {
    if (!this.KEYS.includes(key)) return;
    c.paint = {
      ...this.of(c),
      [key]: String(value || '')
        .trim()
        .slice(0, 60),
    };
    delete c.ral;
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
  static colors(c) {
    const o = this.of(c);
    const w = this.hex(o.wall);
    const f = this.hex(o.frame);
    const wall = w || '#CBD0CC';
    const frame = f || (w ? RalColor.shade(wall, 0.72) : '#154889');
    return {
      wall,
      frame,
      roof: this.hex(o.roof) || frame,
      door: this.hex(o.door) || wall,
      floor: this.hex(o.floor),
      known: Boolean(w || f),
    };
  }

  static book(c) {
    return Boolean(c && c.paintBook);
  }

  /** Строка «Окраска» в характеристиках КП; ничего не задано — ''. */
  static kp(c) {
    if (this.book(c)) return 'по буклету цветовых решений заказчика';
    const o = this.of(c);
    if (!Object.values(o).some(Boolean)) return '';
    const code = t => this.code(t);
    const roof = o.roof || o.frame;
    const floor = o.floor ? `пол ${code(o.floor)}` : `пол — ${StationGeo.FLOORS[StationGeo.floor(c)].short}`;
    return [
      o.frame && `каркас ${code(o.frame)}`,
      o.wall && `стены ${code(o.wall)}`,
      roof && !StationGeo.SEA[c.ctype] && `крыша ${code(roof)}`,
      o.door && code(o.door) !== code(o.wall) && `двери и ворота ${code(o.door)}`,
      floor,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Подпись на чертеже: «RAL 7035 / RAL 5005». */
  static short(c) {
    if (this.book(c)) return 'по буклету заказчика';
    const o = this.of(c);
    return [o.wall, o.frame]
      .filter(Boolean)
      .map(t => this.code(t))
      .join(' / ');
  }

  /** ТЗ на сборку: каждая часть и откуда её цвет. */
  static tz(c) {
    const o = this.of(c);
    const code = t => this.code(t);
    const or = (value, fallback) => (value ? code(value) : fallback);
    const like = (own, base, what) => (own ? code(own) : `${base ? `${code(base)}, ` : ''}в цвет ${what}`);
    const parts = [
      `каркас — ${or(o.frame, 'по согласованию')}`,
      `стены — ${or(o.wall, 'по согласованию')}`,
      StationGeo.SEA[c.ctype] ? '' : `крыша — ${like(o.roof, o.frame, 'каркаса')}`,
      `двери и ворота — ${like(o.door, o.wall, 'стен')}`,
      `пол — ${o.floor ? `окраска ${code(o.floor)}` : StationGeo.FLOORS[StationGeo.floor(c)].name}`,
    ].filter(Boolean);
    const book = this.book(c) ? 'по буклету цветовых решений заказчика (приложение к ТЗ); для ориентира: ' : '';
    return book + parts.join('; ');
  }

  /**
   * Рисунки заказчика: x, z — середина в долях стены (снаружи, слева направо и снизу вверх), w — ширина, мм.
   * @returns {{src: string, name: string, wall: string, x: number, z: number, w: number, ar: number}[]}
   */
  static arts(c) {
    const list = c && Array.isArray(c.art) ? c.art : [];
    return list
      .filter(a => a && a.src && this.WALLS[a.wall])
      .slice(0, this.ART_MAX)
      .map(a => ({
        src: String(a.src),
        name: String(a.name || ''),
        wall: a.wall,
        x: this.frac(a.x, 0.5),
        z: this.frac(a.z, 0.5),
        w: Math.max(100, Math.min(12000, +a.w || 1500)),
        ar: Math.max(0.1, Math.min(10, +a.ar || 1)),
      }));
  }

  static frac(v, fallback) {
    const x = +v;
    return x >= 0 && x <= 1 ? x : fallback;
  }

  /** «Передняя стена, по центру, посередине, ширина 1 500 мм» */
  static where(a) {
    const near = (list, v) => list.reduce((best, q) => (Math.abs(q[0] - v) < Math.abs(best[0] - v) ? q : best))[1];
    return `${this.WALLS[a.wall]}, ${near(this.ALONG, a.x)}, ${near(this.HIGH, a.z)}, ширина ${Mm.text(a.w)} мм`;
  }

  /** Отпечаток окраски — картинки пересобираются при правке цвета, рисунка, буклета. */
  static stamp(c) {
    const src = s => (s.length > 200 ? s.length + s.slice(-40) : s);
    const arts = this.arts(c).map(a => [src(a.src), a.wall, a.x, a.z, a.w]);
    return JSON.stringify([this.of(c), Boolean(this.book(c)), arts]);
  }
}
