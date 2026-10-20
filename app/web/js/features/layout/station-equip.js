import { AirChain } from './air-chain.js';
import { PipeMaterial } from './pipe-material.js';
import { RalColor } from './ral-color.js';
import { StationMatrix } from './station-matrix.js';
import { StationNorms } from './station-norms.js';
import { TankSize } from './tank-size.js';

/** Оборудование из состава станции: вид, габариты, масса, цвет, форма, подписи. */
export class StationEquip {
  static CABINET = /шкаф|щит|(?:^|[^а-яё])АВР(?![а-яё])|пульт/i;

  static CHASSIS = /шасси|прицеп/i;

  static MUFFLER = /глушител/i;

  static PIPING = /трубопровод|топливопровод|обвязк/i;

  static SKIP =
    /систем|освещ|электроснабж|сигнализац|пожар|обвязк|арматур|трубопровод|монтаж|вентиляц|отоплен|подогрев|кабел|комплект|ЗИП|документац|доставк|наладк|проект/i;

  /** Наименьшее значение таблицы ступеней [предел, значение], подходящее для v (v не задан — первое). */
  static _step = (table, v) => table.find(([lim]) => v == null || v <= lim)[1];

  static KINDS = [
    ['compressor', /^(comp_|blower$)/, /компрессор|воздуходувк/i],
    ['dryer', /^(dryer_|gen_n2$|gen_o2$)/, /осушител|генератор азота|генератор кислорода/i],
    ['receiver', /^receiver$/, /ресивер|воздухосборник/i],
    ['filter', /^(filter|oil_sep)$/, /фильтр|сепаратор|циклон/i],
    ['dgu', /^dgu$/, /дизель-?генератор|(?:^|[^а-яё])(?:ДГУ|ДЭС)(?![а-яё])|генераторн\S* установ/i],
    ['pump', /^pump$/, /насос|мотопомп/i],
    ['cabinet', /^ats$/, StationEquip.CABINET],
    ['tank', null, /бак|[её]мкост/i],
  ];

  static CABINET = StationEquip.CABINET;
  static CAB_FLOOR = /напольн/i;
  static CAB_WALL = /настенн|навесн|на стене/i;
  static CHASSIS = StationEquip.CHASSIS;
  static MUFFLER = StationEquip.MUFFLER;
  static PIPING = StationEquip.PIPING;
  static SKIP = StationEquip.SKIP;

  /** Виды по названию до общих слов: [образец, вид, только не для основного оборудования]. */
  static NAME_KINDS = [
    [StationEquip.CHASSIS, 'chassis', false],
    [StationEquip.MUFFLER, 'muffler', false],
    [StationEquip.PIPING, 'piping', true],
    [StationEquip.CABINET, 'cabinet', false],
    [StationEquip.SKIP, 'skip', true],
  ];

  static LABEL = {
    compressor: 'Компрессор',
    dryer: 'Осушитель',
    receiver: 'Ресивер',
    filter: 'Фильтр',
    dgu: 'ДГУ',
    pump: 'Насосный агрегат',
    cabinet: 'Шкаф',
    tank: 'Бак',
    muffler: 'Глушитель',
    piping: 'Трубопровод',
    other: 'Оборудование',
  };

  static COLOR = {
    compressor: '#D5DADF',
    dryer: '#E9ECEF',
    receiver: '#AEB7C1',
    filter: '#B7BEC6',
    dgu: '#C9CED3',
    pump: '#3A6EA5',
    cabinet: '#CBD0CC',
    tank: '#9AA3AC',
    muffler: '#6b7178',
    other: '#C9CED4',
  };

  static DIM2 = /(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)(?:\s*×\s*(\d+(?:[.,]\d+)?))?/;
  static DIM3 = /(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)/;

  static cat(part) {
    return String((part.attrs && part.attrs.cat) || part.cat || '');
  }

  /** Вид оборудования: по категории каталога, иначе по названию. */
  static kindOf(part) {
    if (part.role === 'container') return 'container';
    const cat = this.cat(part);
    const name = String(part.name || '');
    const main = part.role === 'main';
    const byCat = cat && this.KINDS.find(([, pattern]) => pattern && pattern.test(cat));
    if (byCat) return byCat[0];
    const byName = this.NAME_KINDS.find(([pattern, , extra]) => !(extra && main) && pattern.test(name));
    if (byName) return byName[1];
    const byWord = this.KINDS.find(([, , pattern]) => pattern.test(name));
    if (byWord) return byWord[0];
    return main ? 'other' : '';
  }

  static num(v) {
    const value = parseFloat(
      String(v ?? '')
        .replace(/\s+/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(value) ? value : null;
  }

  /** Число поля каталога; диапазон или «до 40» — верхняя граница: {v, range} или null. */
  static top(v) {
    const value = this.num(v);
    if (value != null && /^\s*[\d.,\s]+\s*$/.test(String(v))) return { v: value, range: false };
    const all = (String(v ?? '').match(/\d[\d\s]*(?:[.,]\d+)?/g) || [])
      .map(token => this.num(token))
      .filter(x => x != null);
    return all.length ? { v: Math.max(...all), range: true } : null;
  }

  /** Расход воздуха по паспорту, м³/ч: cool — на охлаждение, comb — на горение; heat — тепловыделение, кВт. */
  static airRows(part) {
    const out = { cool: null, comb: null, heat: null };
    for (const row of part.rows || []) if (row) this.airRow(out, row);
    return out;
  }

  static airRow(out, row) {
    const k = String(row.k || '');
    if (/тепловыделен|теплоотдач|тепловой поток|тепловая мощность/i.test(k) && !/рекупер|возврат/i.test(k)) {
      this.heatRow(out, row);
      return;
    }
    if (!/воздух/i.test(k) || !/расход|поток|производительн/i.test(k)) return;
    const flow = this.airFlow(row.v);
    const use = this.airUse(k, String(row.v || ''));
    if (flow > 0 && use) out[use] = out[use] || flow;
  }

  /** Расход на горение (comb) или на охлаждение (cool) по названию строки. */
  static airUse(k, v) {
    if (/горени|сгорани|двигател/i.test(`${k} ${v}`) && !/охлажд|радиатор/i.test(k)) return 'comb';
    return /охлажд|радиатор|вентилятор/i.test(k) ? 'cool' : null;
  }

  /** Тепловыделение по паспорту, кВт (рекуперируемая доля — не всё тепло, не берётся). */
  static heatRow(out, row) {
    const heat = String(row.v || '').match(/(\d+(?:[.,]\d+)?)\s*(квт|kw)/i);
    if (heat && !out.heat) out.heat = this.num(heat[1]);
  }

  static PER_HOUR = [
    [/^(мин|min)$/, 60],
    [/^(с|сек|s)$/, 3600],
  ];

  /** «1 200 м³/мин» → м³/ч; нет единицы расхода — null. */
  static airFlow(v) {
    const match = String(v || '')
      .replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1')
      .match(/(\d+(?:[.,]\d+)?)\s*(м³|м3|m³|m3)\s*\/\s*(ч|час|h|мин|min|с|сек|s)(?![А-Яа-яЁёA-Za-z])/i);
    if (!match) return null;
    const unit = match[3].toLowerCase();
    const per = this.PER_HOUR.find(([pattern]) => pattern.test(unit));
    return Math.round(this.num(match[1]) * (per ? per[1] : 1));
  }

  /** «1090 × 790 × 870», «1150*430», «109 х 79 х 87 см» → 2 или 3 числа в мм. */
  static nums(text) {
    const two = this.sizes(text, this.DIM2);
    return two && two.every(v => v >= 50 && v <= 20000) ? two : null;
  }

  /** Размеры по образцу re (DIM2 | DIM3), мм: метры и сантиметры пересчитываются; нет — null. */
  static sizes(text, pattern) {
    const clean = String(text || '')
      .replace(/(\d)\s+(?=\d{3}\b)/g, '$1')
      .replace(/[хxХX*]/g, '×');
    const match = clean.match(pattern);
    if (!match) return null;
    const nums = [match[1], match[2], match[3]].filter(Boolean).map(v => parseFloat(v.replace(',', '.')));
    const scale = this.sizeScale(nums, clean);
    return nums.map(v => Math.round(v * scale));
  }

  static sizeScale(nums, text) {
    if (Math.max(...nums) < 40) return 1000;
    return /см/.test(text) ? 10 : 1;
  }

  /** Габариты, мм: {l ≥ w, h, known, src}; не указаны — условные по виду. */
  static dims(part, kind) {
    const found = this.sizeOf(part);
    const { src } = found;
    let { n: nums } = found;
    if (nums && nums.length === 2) nums = this.twoSizes(nums, part, kind);
    if (nums && nums.length === 3 && kind === 'receiver' && this.standing(nums, part)) {
      const sorted = [...nums].sort((x, y) => y - x);
      nums = [sorted[1], sorted[2], sorted[0]];
    }
    if (nums && nums.length === 3) {
      const [len, wid] = nums[0] >= nums[1] ? [nums[0], nums[1]] : [nums[1], nums[0]];
      return { l: len, w: wid, h: nums[2], known: true, src };
    }
    const guess = this.guess(part, kind);
    return { l: guess[0], w: guess[1], h: guess[2], known: false, src: '' };
  }

  /** Размеры из поля «Габариты», строк характеристик (не упаковки, патрубков, радиатора, проёмов) или груза. */
  static sizeOf(part) {
    const own = this.nums((part.attrs || {}).size);
    let found = { n: own, src: own ? 'Габариты' : '' };
    if (!own || own.length < 3) found = this.sizeRows(part, found);
    if ((!found.n || found.n.length < 3) && typeof lgCargoOf === 'function') {
      const cargo = lgCargoOf([{ rows: part.rows || [] }]);
      if (cargo && cargo.dims)
        found = {
          n: [cargo.dims.l, cargo.dims.w, cargo.dims.h].map(v => Math.round(v * 1000)),
          src: cargo.dimSrc || 'Габариты',
        };
    }
    return found;
  }

  static sizeRows(part, found) {
    const key = row => String(row.k || '');
    const rows = (part.rows || []).filter(
      row =>
        row &&
        /габарит|размер|д\s*[×xх*]\s*ш/i.test(key(row)) &&
        !/упаков|присоедин|фланц|патрубк|радиатор|про[её]м|отверсти/i.test(key(row)),
    );
    let out = found;
    for (const row of rows) {
      const nums = this.nums(row.v);
      if (!nums || (out.n && nums.length <= out.n.length)) continue;
      out = { n: nums, src: key(row) };
      if (nums.length === 3) break;
    }
    return out;
  }

  /** Два числа: у фильтров, ресиверов, осушителей и баков — высота × Ø, у глушителя — длина × Ø. */
  static twoSizes([first, second], part, kind) {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    if (kind === 'muffler') return [high, low, low];
    if (['filter', 'receiver', 'dryer', 'tank'].includes(kind)) return [low, low, high];
    return [first, second, this.guess(part, kind)[2]];
  }

  /** Ресивер стоит: вертикальный по исполнению или названию, или «высота × Ø × Ø» без указания исполнения. */
  static standing(nums, part) {
    const text = `${String((part.attrs || {}).orient || '')} ${String(part.name || '')}`;
    if (/гориз/i.test(text) || !(Math.max(...nums) > nums[2])) return false;
    return /верт/i.test(text) || this.upright(nums);
  }

  /** Две меньшие стороны равны (до 5 %), большая — в 1,3 раза больше: стоит, если так отмечено в правилах. */
  static upright(nums) {
    const sorted = [...nums].sort((x, y) => y - x);
    return Boolean(StationMatrix.recv().upright) && sorted[1] <= sorted[2] * 1.05 && sorted[0] >= 1.3 * sorted[1];
  }

  static GUESS = {
    compressor: [
      [15, [1000, 700, 1100]],
      [37, [1400, 900, 1500]],
      [90, [2000, 1100, 1800]],
      [Infinity, [2700, 1500, 2000]],
    ],
    dgu: [
      [30, [1800, 800, 1300]],
      [100, [2500, 1000, 1600]],
      [250, [3200, 1200, 1900]],
      [500, [4000, 1600, 2200]],
      [Infinity, [5200, 2000, 2400]],
    ],
    receiver: [
      [300, [550, 1600]],
      [600, [650, 2000]],
      [1100, [800, 2300]],
      [2200, [1000, 2900]],
      [Infinity, [1200, 3100]],
    ],
    muffler: [
      [60, [1000, 300, 300]],
      [150, [1400, 400, 400]],
      [400, [1800, 500, 500]],
      [800, [2400, 650, 650]],
      [Infinity, [3000, 800, 800]],
    ],
    plain: { dryer: [900, 600, 1100], filter: [300, 300, 900], pump: [800, 500, 700] },
  };

  /** Условные габариты, мм — по мощности, объёму или виду. */
  static guess(part, kind) {
    const attrs = part.attrs || {};
    const kw = this.num(attrs.kw);
    const row = TankSize.volumeRow(part);
    const vol = this.num(attrs.volume) ?? (row ? this.num(TankSize.firstNumber(row.v)) : null);
    const guessRule = this.GUESS;
    const byKind = {
      compressor: () => StationEquip._step(guessRule.compressor, kw),
      dgu: () => StationEquip._step(guessRule.dgu, kw),
      receiver: () => {
        const [dims, height] = StationEquip._step(guessRule.receiver, vol || 500);
        return [dims, dims, height];
      },
      tank: () => {
        const dims = TankSize.of(this.num(attrs.tank) || vol || 1000);
        return [dims.l, dims.w, dims.h];
      },
      muffler: () => this.guessMuffler(kw),
      cabinet: () => (this.cabWord(part) === 'floor' ? [800, 400, 1800] : [600, 250, 800]),
    };
    return byKind[kind] ? byKind[kind]() : guessRule.plain[kind] || [800, 600, 1000];
  }

  /** Шкаф: выбрано в составе или сказано в названии и характеристиках («на стене» / «на полу»); иначе null. */
  static cabWord(part) {
    if (part.mount === 'wall' || part.mount === 'floor') return part.mount;
    const text = [
      part.name,
      ...(part.rows || []).map(row => (row ? `${String(row.k || '')} ${String(row.v || '')}` : '')),
    ].join(' ');
    if (this.CAB_FLOOR.test(text)) return 'floor';
    return this.CAB_WALL.test(text) ? 'wall' : null;
  }

  /** Шкаф на стене, если так выбрано, размеры не указаны или он невысокий и неглубокий (до 1400 × 450 мм). */
  static mount(part, dims) {
    return this.cabWord(part) || (!dims.known || (dims.h <= 1400 && dims.w <= 450) ? 'wall' : 'floor');
  }

  /** Глушитель ДГУ без размеров — по мощности ДГУ, кВт. */
  static guessMuffler(kw) {
    return StationEquip._step(this.GUESS.muffler, kw == null ? 200 : kw);
  }

  static mass(part) {
    const massKg = this.num((part.attrs || {}).mass);
    if (massKg > 0) return massKg;
    if (typeof lgCargoOf !== 'function') return null;
    const cargo = lgCargoOf([{ rows: part.rows || [] }]);
    return cargo && cargo.mass > 0 ? Math.round(cargo.mass * 1000) : null;
  }

  /** Цвет: главный цвет фото, иначе из характеристик (RAL или словами), иначе условный по виду. */
  static color(part, kind) {
    const color = this.colorRows(part, kind);
    const tint = this.tint(part);
    return tint ? { hex: tint, known: true, text: color.text, photo: true, tones: this.tones(part) } : color;
  }

  static photo(part) {
    const text = part && part.photo && part.photo.src;
    return text && typeof PhotoTint !== 'undefined' ? String(text) : '';
  }

  /** Зоны других цветов по фото: [{u0, u1, v0, v1, hex}] или null. */
  static tones(part) {
    const text = this.photo(part);
    const z = text ? PhotoTint.tones(text) : [];
    return z.length ? z : null;
  }

  static tint(part) {
    const text = this.photo(part);
    return text ? PhotoTint.get(text) || '' : '';
  }

  static colorRows(part, kind) {
    const attrs = part.attrs || {};
    const key = row => String(row.k || '').trim();
    const rows = (part.rows || []).filter(
      row => row && (/^(цвет|окраск|покрыт|ral)/i.test(key(row)) || /RAL\s*-?\s*\d{4}/i.test(String(row.v || ''))),
    );
    const ral = [attrs.color, attrs.ral, ...rows.map(row => row.v)]
      .filter(v => v != null && String(v).trim())
      .map(v => RalColor.codes(v)[0])
      .find(Boolean);
    if (ral) return { hex: ral.hex, known: true, text: ral.code };
    const named = rows
      .filter(row => /^(цвет|окраск)/i.test(key(row)))
      .map(row => [RalColor.named(row.v), row.v])
      .find(([hex]) => hex);
    if (named) return { hex: named[0], known: true, text: String(named[1]).trim().slice(0, 40) };
    return { hex: this.COLOR[kind] || this.COLOR.other, known: false, text: '' };
  }

  /** Форма для 3D-вида: box — короб, vcyl — вертикальный цилиндр, hcyl — горизонтальный. */
  static shape(part, kind, dims) {
    if (kind === 'receiver')
      return this.receiverShape(String((part.attrs && part.attrs.orient) || '').toLowerCase(), dims);
    if (kind === 'filter' && dims.l <= 1.3 * dims.w && dims.h >= 1.2 * dims.l) return 'vcyl';
    return 'box';
  }

  static receiverShape(orient, dims) {
    if (/гориз/.test(orient) || (!/верт/.test(orient) && dims.l >= 1.6 * Math.max(dims.w, dims.h))) return 'hcyl';
    if (/верт/.test(orient) || (dims.h >= 1.3 * dims.l && dims.l <= 1.25 * dims.w)) return 'vcyl';
    return 'box';
  }

  static CTYPES = [
    ['piston', 'comp_piston', /поршнев/i],
    ['centrifugal', 'comp_centrifugal', /центробеж|турбокомпрес/i],
    ['scroll', 'comp_scroll', /спиральн/i],
  ];

  /** Тип компрессора для расчёта тепла: screw / piston / centrifugal / scroll. */
  static ctype(part) {
    const cat = this.cat(part);
    const name = String(part.name || '');
    const hit = this.CTYPES.find(([, catKey, pattern]) => cat === catKey || pattern.test(name));
    return hit ? hit[0] : 'screw';
  }

  /** Вид изделия на чертеже: поршневой компрессор (на ресивере) — 'piston', иначе ''. */
  static look(part, kind) {
    const piston = this.cat(part) === 'comp_piston' || /поршнев/i.test(String(part.name || ''));
    return kind === 'compressor' && piston ? 'piston' : '';
  }

  /** Свой рисунок модели для чертежа: {front, top} или null. */
  static pic(part) {
    const draw = part.draw || {};
    const src = v => String((draw[v] && draw[v].src) || '');
    return src('front') || src('top') ? { front: src('front'), top: src('top') } : null;
  }

  /** Короткая подпись на чертеже: модель или первые слова названия. */
  static short(part, kind) {
    const model = String((part.attrs || {}).model || '').trim();
    if (model) return model.length > 22 ? `${model.slice(0, 21)}…` : model;
    const name = String(part.name || '').trim() || this.LABEL[kind] || 'Элемент';
    return name.length > 22 ? `${name.slice(0, 21).replace(/\s+\S*$/, '')}…` : name;
  }

  /** Коротко для экспликации, если название длинное: «Компрессор Remeza ВК60-2,5 ВС». */
  static brief(part, kind, name) {
    const attrs = part.attrs || {};
    const model = String(attrs.model || '').trim();
    const maker = String(attrs.maker || '').trim();
    if (name.length <= 56 || !model || kind === 'other') return name;
    const own = maker && !model.toLowerCase().includes(maker.toLowerCase()) ? maker : '';
    return [this.LABEL[kind], own, model].filter(Boolean).join(' ');
  }

  /**
   * Состав → оборудование с номерами позиций на чертеже.
   * @param {object[]} parts состав станции
   * @param {{recv?: string, recvOut?: boolean}} o recv — где ресивер без своей роли, recvOut — ресиверы снаружи
   */
  static list(parts, opts = {}) {
    const pos = { n: 0 };
    const out = (parts || []).filter(part => part && part.role !== 'container').map(part => this.entry(part, pos));
    AirChain.assign(out, opts.recv);
    if (opts.recvOut)
      for (const unit of out.filter(x => x.kind === 'receiver' && x.air && x.air.role === 'dry')) this.putOutside(unit);
    const dgu = out.find(unit => unit.kind === 'dgu');
    for (const unit of out.filter(x => x.kind === 'muffler' && !x.known)) {
      [unit.l, unit.w, unit.h] = this.guessMuffler(dgu ? dgu.kw : null);
    }
    return out;
  }

  /** Ресивер после подготовки воздуха — снаружи, на площадке у дальнего торца; по ходу воздуха последний. */
  static putOutside(unit) {
    unit.place = false;
    unit.outside = true;
    unit.air.stage = 80;
    unit.air.out = true;
  }

  static entry(part, pos) {
    const kind = this.kindOf(part);
    const name = String(part.name || '').trim() || this.LABEL[kind] || 'Элемент';
    const qty = Math.max(1, Math.min(20, Math.round(this.num(part.qty) || 1)));
    const base = { id: part.id, name, kind, qty, place: false };
    const special = this.special(part, base);
    if (special) return special(pos);
    const dims = this.dims(part, kind);
    if (!kind && !dims.known) return { ...base, kind: 'skip', nodims: true };
    return this.unit(part, { ...base, kind: kind || 'other' }, dims, ++pos.n);
  }

  /** Не стоит в помещении: системы и шасси, ресивер у потребителя, трубопровод, глушитель. */
  static special(part, base) {
    const { kind } = base;
    if (kind === 'skip' || kind === 'chassis') return () => base;
    if (kind === 'receiver' && part.recvRole === 'local') {
      return () => ({ ...base, kind: 'skip', local: true, vol: AirChain.volume(part) });
    }
    if (kind === 'piping') return pos => this.piping(part, base, ++pos.n);
    if (kind === 'muffler') return pos => this.muffler(part, base, ++pos.n);
    return null;
  }

  static piping(part, base, pos) {
    const mat = PipeMaterial.of(part);
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(part, base.kind, base.name),
      short: 'Трубопровод',
      kind: base.kind,
      qty: base.qty,
      place: false,
      mat: mat ? mat.id : '',
      dn: PipeMaterial.bore(part),
    };
  }

  static muffler(part, base, pos) {
    const dims = this.dims(part, base.kind);
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(part, base.kind, base.name),
      short: this.short(part, base.kind),
      kind: base.kind,
      qty: base.qty,
      place: false,
      roof: !/внутр/i.test(base.name),
      l: dims.l,
      w: dims.w,
      h: dims.h,
      known: dims.known,
      src: dims.src,
      mass: this.mass(part),
      color: this.color(part, base.kind).hex,
    };
  }

  static AIR_KINDS = ['compressor', 'dryer', 'receiver', 'filter'];

  /** Оборудование на полу, на стене или на трубопроводе. */
  static unit(part, base, dims, pos) {
    const k = base.kind;
    const attrs = part.attrs || {};
    const color = this.color(part, k);
    const air = this.AIR_KINDS.includes(k) ? AirChain.info(part, k) : null;
    const pipe = k === 'filter' && air.grade !== 'cond' && Math.max(dims.l, dims.w) <= 700;
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(part, k, base.name),
      short: this.short(part, k),
      kind: k,
      qty: base.qty,
      l: dims.l,
      w: dims.w,
      h: dims.h,
      known: dims.known,
      src: dims.src,
      mass: this.mass(part),
      kw: this.num(attrs.kw),
      maker: String(attrs.maker || '').trim(),
      color: color.hex,
      colorKnown: color.known,
      colorText: color.text,
      tones: color.tones || null,
      shape: this.shape(part, k, dims),
      look: this.look(part, k),
      place: true,
      pipe,
      mount: this.mountOf(part, k, dims, pipe),
      air,
      noise: StationNorms.dba(part),
      pic: this.pic(part),
      flow: k === 'pump' ? this.num(attrs.flow) : null,
      ...(k === 'tank' ? { vol: TankSize.vol(part) } : {}),
      ...(k === 'compressor' || k === 'dgu' ? this.airRows(part) : {}),
      ...(k === 'compressor' ? { ctype: this.ctype(part) } : {}),
    };
  }

  static mountOf(part, kind, dims, pipe) {
    if (kind === 'cabinet') return this.mount(part, dims);
    return pipe ? 'pipe' : 'floor';
  }
}
