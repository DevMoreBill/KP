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

  /** Внутренняя обшивка морского контейнера, мм. */
  static get LINING() {
    return StationMatrix.grp('shell').seaLining;
  }

  static get _SEA_FLOOR() {
    return StationMatrix.grp('shell').seaFloor;
  }

  /** Блок-контейнеры «по проекту»: стена сверх утеплителя, пол, кровля; «Север» — с тамбуром. */
  static get FLEX() {
    return StationMatrix.derive('flex', () => {
      const shell = StationMatrix.grp('shell');
      return {
        block: { wall: shell.blockWall, floor: shell.blockFloor, roof: shell.blockRoof },
        welded: { wall: shell.weldWall, floor: shell.weldFloor, roof: shell.weldRoof },
        north: { wall: shell.northWall, floor: shell.northFloor, roof: shell.northRoof, tambour: shell.tambour },
      };
    });
  }

  /** Шаг подбора размеров, мм. */
  static get STEP() {
    return StationMatrix.fit().step;
  }

  /** Пределы блок-контейнера. */
  static get BLOCK() {
    const { minL, minW, minH, hWalk, maxW, maxH } = StationMatrix.fit();
    return { minL, minW, minH, hWalk, maxW, maxH };
  }

  /** Наибольшая ширина для перевозки без разрешения, мм. */
  static get ROAD_W() {
    return StationMatrix.fit().roadW;
  }

  /** Виды кровли и их уклоны. */
  static get ROOFS() {
    return StationMatrix.derive('roofs', () => {
      const shell = StationMatrix.grp('shell');
      return {
        flat: { name: 'плоская', deg: 0 },
        gable: { name: 'двускатная', deg: shell.gable },
        mono: { name: 'односкатная', deg: shell.mono },
        arch: { name: 'арочная (покатая)', deg: 0, k: 0.075 },
      };
    });
  }

  /** Вверх до шага размеров блок-контейнера. */
  static roundUp(v) {
    return Math.ceil(v / this.STEP - 1e-9) * this.STEP;
  }

  /** «6 × 2,4 × 2,5 м» → [6000, 2400, 2500]; иначе null. */
  static parseMm(text) {
    const sizes = StationEquip.sizes(text, StationEquip.DIM3);
    return sizes && sizes.every(v => v >= 500 && v <= 30000) ? sizes : null;
  }

  /** Заданная длина блок-контейнера: «10 000 мм», «10 м», «10,5» → мм в пределах; иначе null. */
  static len(text) {
    const clean = String(text ?? '')
      .trim()
      .replace(/(\d)\s+(?=\d{3}\b)/g, '$1');
    const match = clean.match(/^(\d+(?:[.,]\d+)?)\s*(мм|м)?$/i);
    if (!match) return null;
    const raw = parseFloat(match[1].replace(',', '.'));
    const v = Math.round(/^м$/i.test(match[2] || '') || raw < 40 ? raw * 1000 : raw);
    const fit = StationMatrix.fit();
    return v >= fit.minL && v <= fit.maxL ? v : null;
  }

  /** Утеплитель, мм: из карточки; не указан — по умолчанию правил. */
  static ins(text) {
    const num = parseFloat(String(text || '').replace(',', '.'));
    return num > 0 && num < 400 ? num : StationMatrix.grp('shell').ins;
  }

  /** Вид кровли станции. */
  static roof(cont) {
    const roofText = String((cont && cont.roof) || '');
    if (cont && this.SEA[cont.ctype]) return 'flat';
    return this.ROOFS[roofText] ? roofText : 'flat';
  }

  /** Подъём крыши над стенами, мм: двускатная — до конька, односкатная — у стены с дверью, арочная — дуга. */
  static rise(roof, Wi) {
    const roofRule = this.ROOFS[roof] || this.ROOFS.flat;
    const tan = Math.tan((roofRule.deg * Math.PI) / 180);
    const rise = { gable: (Wi / 2) * tan, mono: Wi * tan, arch: Wi * roofRule.k };
    return Math.round(rise[roof] || 0);
  }

  /** Вид пола станции. */
  static floor(cont) {
    const floorText = String((cont && cont.floor) || '');
    if (this.FLOORS[floorText]) return floorText;
    const row = ((cont && cont.rows) || []).find(line => line && /^пол(?![а-яё])/i.test(String(line.k || '').trim()));
    return row && /алюмин/i.test(String(row.v || '')) ? 'alu' : 'steel';
  }

  /** Правила корпуса типа контейнера. */
  static flex(type) {
    return this.FLEX[type] || (this.SEA[type] ? null : this.FLEX.block);
  }

  /** Внутренние размеры по наружным: морской — штатные стенки и утепление, блок-контейнер — стены, пол и кровля. */
  static inner(type, ext, ins) {
    const sea = this.SEA[type];
    if (sea) {
      const wall = sea.ext.map((v, i) => v - sea.int[i]);
      const k = ins + this.LINING;
      return [ext[0] - wall[0] - 2 * k, ext[1] - wall[1] - 2 * k, ext[2] - wall[2] - k - this._SEA_FLOOR];
    }
    const flex = this.flex(type);
    return [ext[0] - 2 * (ins + flex.wall), ext[1] - 2 * (ins + flex.wall), ext[2] - flex.floor - (ins + flex.roof)];
  }

  /**
   * Геометрия элемента «контейнер»; у станции из модулей размер в составе — одного модуля.
   * @returns {object} {type, t, sea, own, auto, fixL, ext, int, x0, door, roof, floor, mods}
   */
  static of(cont) {
    const type = cont.ctype || 'block';
    const ins = this.ins(cont.ins);
    const sea = this.SEA[type];
    const own = cont.sizeAuto ? null : this.parseMm(cont.size);
    const mods = sea ? null : StationMods.of(cont);
    const mod = own && mods ? own : null;
    const ext = this._extOf(mod, mods, own, sea);
    return {
      type,
      t: ins,
      sea: Boolean(sea),
      own: Boolean(own),
      auto: !ext,
      fixL: ext || sea ? null : this.fixLen(cont, mods),
      ext,
      int: ext ? this.inner(type, ext, ins) : null,
      x0: this.tambour(type),
      door: sea ? sea.door : null,
      roof: this.roof(cont),
      floor: this.floor(cont),
      mods: mods ? { ...mods, ...(mod ? { Lm: mod[0], Wm: mod[1] } : {}) } : null,
    };
  }

  /** Заданная длина станции (у модулей — модуля × число по длине) или null. */
  static fixLen(cont, mods) {
    const len = this.len(cont.lenFix);
    return len && mods ? len * mods.a : len;
  }

  /** Длина тамбура типа контейнера. */
  static tambour(type) {
    const flex = this.flex(type);
    return (flex && flex.tambour) || 0;
  }

  static _extOf(mod, mods, own, sea) {
    if (mod) return [mod[0] * mods.a, mod[1] * mods.b, mod[2]];
    return own || (sea ? sea.ext.slice() : null);
  }

  /** Высота пола внутри над низом контейнера, мм. */
  static zFloor(type) {
    const sea = this.SEA[type];
    return sea ? sea.ext[2] - sea.int[2] - 40 + this._SEA_FLOOR : this.flex(type).floor;
  }
}
