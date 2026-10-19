import { AirChain } from './air-chain.js';
import { PipeMaterial } from './pipe-material.js';
import { RalColor } from './ral-color.js';
import { StationMatrix } from './station-matrix.js';
import { StationNorms } from './station-norms.js';
import { TankSize } from './tank-size.js';

const CABINET = /шкаф|щит|(?:^|[^а-яё])АВР(?![а-яё])|пульт/i;
const CHASSIS = /шасси|прицеп/i;
const MUFFLER = /глушител/i;
const PIPING = /трубопровод|топливопровод|обвязк/i;
const SKIP =
  /систем|освещ|электроснабж|сигнализац|пожар|обвязк|арматур|трубопровод|монтаж|вентиляц|отоплен|подогрев|кабел|комплект|ЗИП|документац|доставк|наладк|проект/i;

/** Наименьшее значение таблицы ступеней [предел, значение], подходящее для v (v не задан — первое). */
const step = (table, v) => table.find(([lim]) => v == null || v <= lim)[1];

/** Оборудование из состава станции: вид, габариты, масса, цвет, форма, подписи. */
export class StationEquip {
  static KINDS = [
    ['compressor', /^(comp_|blower$)/, /компрессор|воздуходувк/i],
    ['dryer', /^(dryer_|gen_n2$|gen_o2$)/, /осушител|генератор азота|генератор кислорода/i],
    ['receiver', /^receiver$/, /ресивер|воздухосборник/i],
    ['filter', /^(filter|oil_sep)$/, /фильтр|сепаратор|циклон/i],
    ['dgu', /^dgu$/, /дизель-?генератор|(?:^|[^а-яё])(?:ДГУ|ДЭС)(?![а-яё])|генераторн\S* установ/i],
    ['pump', /^pump$/, /насос|мотопомп/i],
    ['cabinet', /^ats$/, CABINET],
    ['tank', null, /бак|[её]мкост/i],
  ];

  static CABINET = CABINET;
  static CAB_FLOOR = /напольн/i;
  static CAB_WALL = /настенн|навесн|на стене/i;
  static CHASSIS = CHASSIS;
  static MUFFLER = MUFFLER;
  static PIPING = PIPING;
  static SKIP = SKIP;

  /** Виды по названию до общих слов: [образец, вид, только не для основного оборудования]. */
  static NAME_KINDS = [
    [CHASSIS, 'chassis', false],
    [MUFFLER, 'muffler', false],
    [PIPING, 'piping', true],
    [CABINET, 'cabinet', false],
    [SKIP, 'skip', true],
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

  static cat(p) {
    return String((p.attrs && p.attrs.cat) || p.cat || '');
  }

  /** Вид оборудования: по категории каталога, иначе по названию. */
  static kindOf(p) {
    if (p.role === 'container') return 'container';
    const cat = this.cat(p);
    const name = String(p.name || '');
    const main = p.role === 'main';
    const byCat = cat && this.KINDS.find(([, re]) => re && re.test(cat));
    if (byCat) return byCat[0];
    const byName = this.NAME_KINDS.find(([re, , extra]) => !(extra && main) && re.test(name));
    if (byName) return byName[1];
    const byWord = this.KINDS.find(([, , re]) => re.test(name));
    if (byWord) return byWord[0];
    return main ? 'other' : '';
  }

  static num(v) {
    const n = parseFloat(
      String(v ?? '')
        .replace(/\s+/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(n) ? n : null;
  }

  /** Число поля каталога; диапазон или «до 40» — верхняя граница: {v, range} или null. */
  static top(v) {
    const n = this.num(v);
    if (n != null && /^\s*[\d.,\s]+\s*$/.test(String(v))) return { v: n, range: false };
    const all = (String(v ?? '').match(/\d[\d\s]*(?:[.,]\d+)?/g) || []).map(t => this.num(t)).filter(x => x != null);
    return all.length ? { v: Math.max(...all), range: true } : null;
  }

  /** Расход воздуха по паспорту, м³/ч: cool — на охлаждение, comb — на горение; heat — тепловыделение, кВт. */
  static airRows(p) {
    const out = { cool: null, comb: null, heat: null };
    for (const r of p.rows || []) if (r) this.airRow(out, r);
    return out;
  }

  static airRow(out, r) {
    const k = String(r.k || '');
    if (/тепловыделен|теплоотдач|тепловой поток|тепловая мощность/i.test(k) && !/рекупер|возврат/i.test(k)) {
      this.heatRow(out, r);
      return;
    }
    if (!/воздух/i.test(k) || !/расход|поток|производительн/i.test(k)) return;
    const q = this.airFlow(r.v);
    const use = this.airUse(k, String(r.v || ''));
    if (q > 0 && use) out[use] = out[use] || q;
  }

  /** Расход на горение (comb) или на охлаждение (cool) по названию строки. */
  static airUse(k, v) {
    if (/горени|сгорани|двигател/i.test(`${k} ${v}`) && !/охлажд|радиатор/i.test(k)) return 'comb';
    return /охлажд|радиатор|вентилятор/i.test(k) ? 'cool' : null;
  }

  /** Тепловыделение по паспорту, кВт (рекуперируемая доля — не всё тепло, не берётся). */
  static heatRow(out, r) {
    const h = String(r.v || '').match(/(\d+(?:[.,]\d+)?)\s*(квт|kw)/i);
    if (h && !out.heat) out.heat = this.num(h[1]);
  }

  static PER_HOUR = [
    [/^(мин|min)$/, 60],
    [/^(с|сек|s)$/, 3600],
  ];

  /** «1 200 м³/мин» → м³/ч; нет единицы расхода — null. */
  static airFlow(v) {
    const m = String(v || '')
      .replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1')
      .match(/(\d+(?:[.,]\d+)?)\s*(м³|м3|m³|m3)\s*\/\s*(ч|час|h|мин|min|с|сек|s)(?![А-Яа-яЁёA-Za-z])/i);
    if (!m) return null;
    const unit = m[3].toLowerCase();
    const per = this.PER_HOUR.find(([re]) => re.test(unit));
    return Math.round(this.num(m[1]) * (per ? per[1] : 1));
  }

  /** «1090 × 790 × 870», «1150*430», «109 х 79 х 87 см» → 2 или 3 числа в мм. */
  static nums(text) {
    const a = this.sizes(text, this.DIM2);
    return a && a.every(v => v >= 50 && v <= 20000) ? a : null;
  }

  /** Размеры по образцу re (DIM2 | DIM3), мм: метры и сантиметры пересчитываются; нет — null. */
  static sizes(text, re) {
    const s = String(text || '')
      .replace(/(\d)\s+(?=\d{3}\b)/g, '$1')
      .replace(/[хxХX*]/g, '×');
    const m = s.match(re);
    if (!m) return null;
    const a = [m[1], m[2], m[3]].filter(Boolean).map(v => parseFloat(v.replace(',', '.')));
    const scale = this.sizeScale(a, s);
    return a.map(v => Math.round(v * scale));
  }

  static sizeScale(a, s) {
    if (Math.max(...a) < 40) return 1000;
    return /см/.test(s) ? 10 : 1;
  }

  /** Габариты, мм: {l ≥ w, h, known, src}; не указаны — условные по виду. */
  static dims(p, kind) {
    const found = this.sizeOf(p);
    const { src } = found;
    let { n } = found;
    if (n && n.length === 2) n = this.twoSizes(n, p, kind);
    if (n && n.length === 3 && kind === 'receiver' && this.standing(n, p)) {
      const s = [...n].sort((x, y) => y - x);
      n = [s[1], s[2], s[0]];
    }
    if (n && n.length === 3) {
      const [l, w] = n[0] >= n[1] ? [n[0], n[1]] : [n[1], n[0]];
      return { l, w, h: n[2], known: true, src };
    }
    const g = this.guess(p, kind);
    return { l: g[0], w: g[1], h: g[2], known: false, src: '' };
  }

  /** Размеры из поля «Габариты», строк характеристик (не упаковки, патрубков, радиатора, проёмов) или груза. */
  static sizeOf(p) {
    const own = this.nums((p.attrs || {}).size);
    let found = { n: own, src: own ? 'Габариты' : '' };
    if (!own || own.length < 3) found = this.sizeRows(p, found);
    if ((!found.n || found.n.length < 3) && typeof lgCargoOf === 'function') {
      const c = lgCargoOf([{ rows: p.rows || [] }]);
      if (c && c.dims)
        found = { n: [c.dims.l, c.dims.w, c.dims.h].map(v => Math.round(v * 1000)), src: c.dimSrc || 'Габариты' };
    }
    return found;
  }

  static sizeRows(p, found) {
    const key = r => String(r.k || '');
    const rows = (p.rows || []).filter(
      r =>
        r &&
        /габарит|размер|д\s*[×xх*]\s*ш/i.test(key(r)) &&
        !/упаков|присоедин|фланц|патрубк|радиатор|про[её]м|отверсти/i.test(key(r)),
    );
    let out = found;
    for (const r of rows) {
      const t = this.nums(r.v);
      if (!t || (out.n && t.length <= out.n.length)) continue;
      out = { n: t, src: key(r) };
      if (t.length === 3) break;
    }
    return out;
  }

  /** Два числа: у фильтров, ресиверов, осушителей и баков — высота × Ø, у глушителя — длина × Ø. */
  static twoSizes([a, b], p, kind) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (kind === 'muffler') return [hi, lo, lo];
    if (['filter', 'receiver', 'dryer', 'tank'].includes(kind)) return [lo, lo, hi];
    return [a, b, this.guess(p, kind)[2]];
  }

  /** Ресивер стоит: вертикальный по исполнению или названию, или «высота × Ø × Ø» без указания исполнения. */
  static standing(n, p) {
    const text = `${String((p.attrs || {}).orient || '')} ${String(p.name || '')}`;
    if (/гориз/i.test(text) || !(Math.max(...n) > n[2])) return false;
    return /верт/i.test(text) || this.upright(n);
  }

  /** Две меньшие стороны равны (до 5 %), большая — в 1,3 раза больше: стоит, если так отмечено в правилах. */
  static upright(n) {
    const s = [...n].sort((x, y) => y - x);
    return Boolean(StationMatrix.recv().upright) && s[1] <= s[2] * 1.05 && s[0] >= 1.3 * s[1];
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
  static guess(p, kind) {
    const a = p.attrs || {};
    const kw = this.num(a.kw);
    const row = TankSize.volumeRow(p);
    const vol = this.num(a.volume) ?? (row ? this.num(TankSize.firstNumber(row.v)) : null);
    const G = this.GUESS;
    const byKind = {
      compressor: () => step(G.compressor, kw),
      dgu: () => step(G.dgu, kw),
      receiver: () => {
        const [d, h] = step(G.receiver, vol || 500);
        return [d, d, h];
      },
      tank: () => {
        const d = TankSize.of(this.num(a.tank) || vol || 1000);
        return [d.l, d.w, d.h];
      },
      muffler: () => this.guessMuffler(kw),
      cabinet: () => (this.cabWord(p) === 'floor' ? [800, 400, 1800] : [600, 250, 800]),
    };
    return byKind[kind] ? byKind[kind]() : G.plain[kind] || [800, 600, 1000];
  }

  /** Шкаф: выбрано в составе или сказано в названии и характеристиках («на стене» / «на полу»); иначе null. */
  static cabWord(p) {
    if (p.mount === 'wall' || p.mount === 'floor') return p.mount;
    const text = [p.name, ...(p.rows || []).map(r => (r ? `${String(r.k || '')} ${String(r.v || '')}` : ''))].join(' ');
    if (this.CAB_FLOOR.test(text)) return 'floor';
    return this.CAB_WALL.test(text) ? 'wall' : null;
  }

  /** Шкаф на стене, если так выбрано, размеры не указаны или он невысокий и неглубокий (до 1400 × 450 мм). */
  static mount(p, d) {
    return this.cabWord(p) || (!d.known || (d.h <= 1400 && d.w <= 450) ? 'wall' : 'floor');
  }

  /** Глушитель ДГУ без размеров — по мощности ДГУ, кВт. */
  static guessMuffler(kw) {
    return step(this.GUESS.muffler, kw == null ? 200 : kw);
  }

  static mass(p) {
    const m = this.num((p.attrs || {}).mass);
    if (m > 0) return m;
    if (typeof lgCargoOf !== 'function') return null;
    const c = lgCargoOf([{ rows: p.rows || [] }]);
    return c && c.mass > 0 ? Math.round(c.mass * 1000) : null;
  }

  /** Цвет: главный цвет фото, иначе из характеристик (RAL или словами), иначе условный по виду. */
  static color(p, kind) {
    const c = this.colorRows(p, kind);
    const t = this.tint(p);
    return t ? { hex: t, known: true, text: c.text, photo: true, tones: this.tones(p) } : c;
  }

  static photo(p) {
    const s = p && p.photo && p.photo.src;
    return s && typeof PhotoTint !== 'undefined' ? String(s) : '';
  }

  /** Зоны других цветов по фото: [{u0, u1, v0, v1, hex}] или null. */
  static tones(p) {
    const s = this.photo(p);
    const z = s ? PhotoTint.tones(s) : [];
    return z.length ? z : null;
  }

  static tint(p) {
    const s = this.photo(p);
    return s ? PhotoTint.get(s) || '' : '';
  }

  static colorRows(p, kind) {
    const a = p.attrs || {};
    const key = r => String(r.k || '').trim();
    const rows = (p.rows || []).filter(
      r => r && (/^(цвет|окраск|покрыт|ral)/i.test(key(r)) || /RAL\s*-?\s*\d{4}/i.test(String(r.v || ''))),
    );
    const ral = [a.color, a.ral, ...rows.map(r => r.v)]
      .filter(v => v != null && String(v).trim())
      .map(v => RalColor.codes(v)[0])
      .find(Boolean);
    if (ral) return { hex: ral.hex, known: true, text: ral.code };
    const named = rows
      .filter(r => /^(цвет|окраск)/i.test(key(r)))
      .map(r => [RalColor.named(r.v), r.v])
      .find(([hex]) => hex);
    if (named) return { hex: named[0], known: true, text: String(named[1]).trim().slice(0, 40) };
    return { hex: this.COLOR[kind] || this.COLOR.other, known: false, text: '' };
  }

  /** Форма для 3D-вида: box — короб, vcyl — вертикальный цилиндр, hcyl — горизонтальный. */
  static shape(p, kind, d) {
    if (kind === 'receiver') return this.receiverShape(String((p.attrs && p.attrs.orient) || '').toLowerCase(), d);
    if (kind === 'filter' && d.l <= 1.3 * d.w && d.h >= 1.2 * d.l) return 'vcyl';
    return 'box';
  }

  static receiverShape(orient, d) {
    if (/гориз/.test(orient) || (!/верт/.test(orient) && d.l >= 1.6 * Math.max(d.w, d.h))) return 'hcyl';
    if (/верт/.test(orient) || (d.h >= 1.3 * d.l && d.l <= 1.25 * d.w)) return 'vcyl';
    return 'box';
  }

  static CTYPES = [
    ['piston', 'comp_piston', /поршнев/i],
    ['centrifugal', 'comp_centrifugal', /центробеж|турбокомпрес/i],
    ['scroll', 'comp_scroll', /спиральн/i],
  ];

  /** Тип компрессора для расчёта тепла: screw / piston / centrifugal / scroll. */
  static ctype(p) {
    const cat = this.cat(p);
    const name = String(p.name || '');
    const hit = this.CTYPES.find(([, c, re]) => cat === c || re.test(name));
    return hit ? hit[0] : 'screw';
  }

  /** Вид изделия на чертеже: поршневой компрессор (на ресивере) — 'piston', иначе ''. */
  static look(p, kind) {
    const piston = this.cat(p) === 'comp_piston' || /поршнев/i.test(String(p.name || ''));
    return kind === 'compressor' && piston ? 'piston' : '';
  }

  /** Свой рисунок модели для чертежа: {front, top} или null. */
  static pic(p) {
    const d = p.draw || {};
    const src = v => String((d[v] && d[v].src) || '');
    return src('front') || src('top') ? { front: src('front'), top: src('top') } : null;
  }

  /** Короткая подпись на чертеже: модель или первые слова названия. */
  static short(p, kind) {
    const model = String((p.attrs || {}).model || '').trim();
    if (model) return model.length > 22 ? `${model.slice(0, 21)}…` : model;
    const name = String(p.name || '').trim() || this.LABEL[kind] || 'Элемент';
    return name.length > 22 ? `${name.slice(0, 21).replace(/\s+\S*$/, '')}…` : name;
  }

  /** Коротко для экспликации, если название длинное: «Компрессор Remeza ВК60-2,5 ВС». */
  static brief(p, kind, name) {
    const a = p.attrs || {};
    const model = String(a.model || '').trim();
    const maker = String(a.maker || '').trim();
    if (name.length <= 56 || !model || kind === 'other') return name;
    const own = maker && !model.toLowerCase().includes(maker.toLowerCase()) ? maker : '';
    return [this.LABEL[kind], own, model].filter(Boolean).join(' ');
  }

  /**
   * Состав → оборудование с номерами позиций на чертеже.
   * @param {object[]} parts состав станции
   * @param {{recv?: string, recvOut?: boolean}} o recv — где ресивер без своей роли, recvOut — ресиверы снаружи
   */
  static list(parts, o = {}) {
    const pos = { n: 0 };
    const out = (parts || []).filter(p => p && p.role !== 'container').map(p => this.entry(p, pos));
    AirChain.assign(out, o.recv);
    if (o.recvOut)
      for (const e of out.filter(x => x.kind === 'receiver' && x.air && x.air.role === 'dry')) this.putOutside(e);
    const dgu = out.find(e => e.kind === 'dgu');
    for (const e of out.filter(x => x.kind === 'muffler' && !x.known)) {
      [e.l, e.w, e.h] = this.guessMuffler(dgu ? dgu.kw : null);
    }
    return out;
  }

  /** Ресивер после подготовки воздуха — снаружи, на площадке у дальнего торца; по ходу воздуха последний. */
  static putOutside(e) {
    e.place = false;
    e.outside = true;
    e.air.stage = 80;
    e.air.out = true;
  }

  static entry(p, pos) {
    const kind = this.kindOf(p);
    const name = String(p.name || '').trim() || this.LABEL[kind] || 'Элемент';
    const qty = Math.max(1, Math.min(20, Math.round(this.num(p.qty) || 1)));
    const base = { id: p.id, name, kind, qty, place: false };
    const special = this.special(p, base);
    if (special) return special(pos);
    const d = this.dims(p, kind);
    if (!kind && !d.known) return { ...base, kind: 'skip', nodims: true };
    return this.unit(p, { ...base, kind: kind || 'other' }, d, ++pos.n);
  }

  /** Не стоит в помещении: системы и шасси, ресивер у потребителя, трубопровод, глушитель. */
  static special(p, base) {
    const { kind } = base;
    if (kind === 'skip' || kind === 'chassis') return () => base;
    if (kind === 'receiver' && p.recvRole === 'local') {
      return () => ({ ...base, kind: 'skip', local: true, vol: AirChain.volume(p) });
    }
    if (kind === 'piping') return pos => this.piping(p, base, ++pos.n);
    if (kind === 'muffler') return pos => this.muffler(p, base, ++pos.n);
    return null;
  }

  static piping(p, base, pos) {
    const m = PipeMaterial.of(p);
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(p, base.kind, base.name),
      short: 'Трубопровод',
      kind: base.kind,
      qty: base.qty,
      place: false,
      mat: m ? m.id : '',
      dn: PipeMaterial.dn(p),
    };
  }

  static muffler(p, base, pos) {
    const d = this.dims(p, base.kind);
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(p, base.kind, base.name),
      short: this.short(p, base.kind),
      kind: base.kind,
      qty: base.qty,
      place: false,
      roof: !/внутр/i.test(base.name),
      l: d.l,
      w: d.w,
      h: d.h,
      known: d.known,
      src: d.src,
      mass: this.mass(p),
      color: this.color(p, base.kind).hex,
    };
  }

  static AIR_KINDS = ['compressor', 'dryer', 'receiver', 'filter'];

  /** Оборудование на полу, на стене или на трубопроводе. */
  static unit(p, base, d, pos) {
    const k = base.kind;
    const attrs = p.attrs || {};
    const c = this.color(p, k);
    const air = this.AIR_KINDS.includes(k) ? AirChain.info(p, k) : null;
    const pipe = k === 'filter' && air.grade !== 'cond' && Math.max(d.l, d.w) <= 700;
    return {
      id: base.id,
      pos,
      name: base.name,
      brief: this.brief(p, k, base.name),
      short: this.short(p, k),
      kind: k,
      qty: base.qty,
      l: d.l,
      w: d.w,
      h: d.h,
      known: d.known,
      src: d.src,
      mass: this.mass(p),
      kw: this.num(attrs.kw),
      maker: String(attrs.maker || '').trim(),
      color: c.hex,
      colorKnown: c.known,
      colorText: c.text,
      tones: c.tones || null,
      shape: this.shape(p, k, d),
      look: this.look(p, k),
      place: true,
      pipe,
      mount: this.mountOf(p, k, d, pipe),
      air,
      noise: StationNorms.dba(p),
      pic: this.pic(p),
      flow: k === 'pump' ? this.num(attrs.flow) : null,
      ...(k === 'tank' ? { vol: TankSize.vol(p) } : {}),
      ...(k === 'compressor' || k === 'dgu' ? this.airRows(p) : {}),
      ...(k === 'compressor' ? { ctype: this.ctype(p) } : {}),
    };
  }

  static mountOf(p, kind, d, pipe) {
    if (kind === 'cabinet') return this.mount(p, d);
    return pipe ? 'pipe' : 'floor';
  }
}
