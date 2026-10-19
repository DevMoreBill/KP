import { StationEquip } from './station-equip.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';

/** Контейнер: наружные и внутренние размеры, крыша, пол, двери морского контейнера. */
export class StationGeo {
  static SEA = {
    sea10: { ext: [2991, 2438, 2591], int: [2831, 2352, 2393], door: [2340, 2280], label: '10 футов' },
    sea20: { ext: [6058, 2438, 2591], int: [5898, 2352, 2393], door: [2340, 2280], label: '20 футов' },
    sea20hc: { ext: [6058, 2438, 2896], int: [5898, 2352, 2698], door: [2340, 2585], label: '20 футов HC' },
    sea40: { ext: [12192, 2438, 2591], int: [12032, 2352, 2393], door: [2340, 2280], label: '40 футов' },
    sea40hc: { ext: [12192, 2438, 2896], int: [12032, 2352, 2698], door: [2340, 2585], label: '40 футов HC' },
  };

  static SEA_ORDER = ['sea10', 'sea20', 'sea20hc', 'sea40', 'sea40hc'];

  static FLOORS = {
    steel: {
      name: 'рифлёный стальной лист, окраска чёрная',
      short: 'сталь рифлёная, чёрная',
      color: '#26292c',
      m: 0.25,
      r: 0.55,
    },
    alu: { name: 'рифлёный алюминиевый лист без окраски', short: 'алюминий рифлёный', color: '#c9cdd2', m: 1, r: 0.3 },
  };

  static get LINING() {
    return StationMatrix.grp('shell').seaLining;
  }

  static get SEA_FLOOR() {
    return StationMatrix.grp('shell').seaFloor;
  }

  /** Блок-контейнеры «по проекту»: стена сверх утеплителя, пол, кровля; «Север» — с тамбуром. */
  static get FLEX() {
    return StationMatrix.derive('flex', () => {
      const s = StationMatrix.grp('shell');
      return {
        block: { wall: s.blockWall, floor: s.blockFloor, roof: s.blockRoof },
        welded: { wall: s.weldWall, floor: s.weldFloor, roof: s.weldRoof },
        north: { wall: s.northWall, floor: s.northFloor, roof: s.northRoof, tambour: s.tambour },
      };
    });
  }

  static get STEP() {
    return StationMatrix.fit().step;
  }

  static get BLOCK() {
    const { minL, minW, minH, hWalk, maxW, maxH } = StationMatrix.fit();
    return { minL, minW, minH, hWalk, maxW, maxH };
  }

  static get ROAD_W() {
    return StationMatrix.fit().roadW;
  }

  static get ROOFS() {
    return StationMatrix.derive('roofs', () => {
      const s = StationMatrix.grp('shell');
      return {
        flat: { name: 'плоская', deg: 0 },
        gable: { name: 'двускатная', deg: s.gable },
        mono: { name: 'односкатная', deg: s.mono },
        arch: { name: 'арочная (покатая)', deg: 0, k: 0.075 },
      };
    });
  }

  /** Вверх до шага размеров блок-контейнера. */
  static up(v) {
    return Math.ceil(v / this.STEP - 1e-9) * this.STEP;
  }

  /** «6 × 2,4 × 2,5 м» → [6000, 2400, 2500]; иначе null. */
  static mm(text) {
    const a = StationEquip.sizes(text, StationEquip.DIM3);
    return a && a.every(v => v >= 500 && v <= 30000) ? a : null;
  }

  /** Заданная длина блок-контейнера: «10 000 мм», «10 м», «10,5» → мм в пределах; иначе null. */
  static len(text) {
    const s = String(text ?? '')
      .trim()
      .replace(/(\d)\s+(?=\d{3}\b)/g, '$1');
    const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(мм|м)?$/i);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(',', '.'));
    const v = Math.round(/^м$/i.test(m[2] || '') || raw < 40 ? raw * 1000 : raw);
    const f = StationMatrix.fit();
    return v >= f.minL && v <= f.maxL ? v : null;
  }

  /** Утеплитель, мм: из карточки; не указан — по умолчанию правил. */
  static ins(text) {
    const n = parseFloat(String(text || '').replace(',', '.'));
    return n > 0 && n < 400 ? n : StationMatrix.grp('shell').ins;
  }

  static roof(c) {
    const r = String((c && c.roof) || '');
    if (c && this.SEA[c.ctype]) return 'flat';
    return this.ROOFS[r] ? r : 'flat';
  }

  /** Подъём крыши над стенами, мм: двускатная — до конька, односкатная — у стены с дверью, арочная — дуга. */
  static rise(roof, W) {
    const R = this.ROOFS[roof] || this.ROOFS.flat;
    const tan = Math.tan((R.deg * Math.PI) / 180);
    const by = { gable: (W / 2) * tan, mono: W * tan, arch: W * R.k };
    return Math.round(by[roof] || 0);
  }

  static floor(c) {
    const f = String((c && c.floor) || '');
    if (this.FLOORS[f]) return f;
    const row = ((c && c.rows) || []).find(q => q && /^пол(?![а-яё])/i.test(String(q.k || '').trim()));
    return row && /алюмин/i.test(String(row.v || '')) ? 'alu' : 'steel';
  }

  static flex(type) {
    return this.FLEX[type] || (this.SEA[type] ? null : this.FLEX.block);
  }

  /** Внутренние размеры по наружным: морской — штатные стенки и утепление, блок-контейнер — стены, пол и кровля. */
  static inner(type, ext, t) {
    const sea = this.SEA[type];
    if (sea) {
      const d = sea.ext.map((v, i) => v - sea.int[i]);
      const k = t + this.LINING;
      return [ext[0] - d[0] - 2 * k, ext[1] - d[1] - 2 * k, ext[2] - d[2] - k - this.SEA_FLOOR];
    }
    const f = this.flex(type);
    return [ext[0] - 2 * (t + f.wall), ext[1] - 2 * (t + f.wall), ext[2] - f.floor - (t + f.roof)];
  }

  /**
   * Геометрия элемента «контейнер»; у станции из модулей размер в составе — одного модуля.
   * @returns {object} {type, t, sea, own, auto, fixL, ext, int, x0, door, roof, floor, mods}
   */
  static of(c) {
    const type = c.ctype || 'block';
    const t = this.ins(c.ins);
    const sea = this.SEA[type];
    const own = c.sizeAuto ? null : this.mm(c.size);
    const M = sea ? null : StationMods.of(c);
    const mod = own && M ? own : null;
    const ext = this.extOf(mod, M, own, sea);
    return {
      type,
      t,
      sea: Boolean(sea),
      own: Boolean(own),
      auto: !ext,
      fixL: ext || sea ? null : this.fixLen(c, M),
      ext,
      int: ext ? this.inner(type, ext, t) : null,
      x0: this.tambour(type),
      door: sea ? sea.door : null,
      roof: this.roof(c),
      floor: this.floor(c),
      mods: M ? { ...M, ...(mod ? { Lm: mod[0], Wm: mod[1] } : {}) } : null,
    };
  }

  /** Заданная длина станции (у модулей — модуля × число по длине) или null. */
  static fixLen(c, M) {
    const L = this.len(c.lenFix);
    return L && M ? L * M.a : L;
  }

  static tambour(type) {
    const f = this.flex(type);
    return (f && f.tambour) || 0;
  }

  static extOf(mod, M, own, sea) {
    if (mod) return [mod[0] * M.a, mod[1] * M.b, mod[2]];
    return own || (sea ? sea.ext.slice() : null);
  }

  /** Высота пола внутри над низом контейнера, мм. */
  static zFloor(type) {
    const sea = this.SEA[type];
    return sea ? sea.ext[2] - sea.int[2] - 40 + this.SEA_FLOOR : this.flex(type).floor;
  }
}
