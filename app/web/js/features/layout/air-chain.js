import { AirCheck } from './air-check.js';
import { PressureVessel } from './pressure-vessel.js';
import { StationEquip } from './station-equip.js';

const YES = v => /^(да|есть|встроен)/i.test(String(v ?? '').trim());
const SET = v => v != null && String(v).trim() !== '';
const key = r => String(r.k || '');
const val = r => String(r.v || '');

/** Ступени фильтров по полю «Ступень очистки» — по порядку проверки. */
const STAGE_WORDS = [
  [/пылев/i, 'dust'],
  [/предвар/i, 'pre'],
  [/сверхтонк|микро/i, 'micro'],
  [/уголь/i, 'carbon'],
  [/тонк/i, 'fine'],
];

/** Ступени фильтров по тексту элемента — после тонкости по частицам. */
const TEXT_WORDS = [
  [/пылев|после адсорбц|пыл\S*\s+адсорбент|(?:^|[^a-z])(?:DDp|PDp)\s?\d/i, 'dust'],
  [/сверхтонк|микрофильтр|0[.,]01\s*мкм|(?:^|[^a-z])(?:PD|AA)\s?\d/i, 'micro'],
  [
    /тонк\S*\s+(?:очистк|фильтр)|(?:^|\D)1\s*мкм|0[.,]1\s*мг|от масла|маслоотдел|коалесц|(?:^|[^a-z])(?:DD|AO)\s?\d/i,
    'fine',
  ],
  [/предварит|грубой|общей очистк|общего назначени|(?:^|\D)[35]\s*мкм|механическ/i, 'pre'],
  [/циклон|влагоотдел|сепаратор\S*\s+(?:влаг|вод)|водоотдел/i, 'sep'],
];

/** Производительность в строке характеристик → м³/мин. */
const FLOW_UNITS = [
  [/л\s*\/\s*мин/i, v => v / 1000],
  [/м[³3]\s*\/\s*ч/i, v => v / 60],
  [/л\s*\/\s*с/i, v => v * 0.06],
];

/** Ступень по ходу воздуха у фильтров: без осушителя и с осушителем (до и после него). */
const FILTER_STAGE = {
  bare: { sep: 15, pre: 31, fine: 32, micro: 33, dust: 34, carbon: 35 },
  dryer: { sep: 15, pre: 31, fine: 32, dust: 52, carbon: 55 },
};

/** Чего не хватает по виду осушителя — ступени для фильтров без указанной ступени. */
const WANT = {
  ads: ['micro', 'dust', 'carbon'],
  refrigBuilt: ['micro', 'carbon'],
  refrig: ['pre', 'micro', 'carbon'],
  none: ['pre', 'fine', 'micro', 'carbon'],
};

/**
 * Подготовка сжатого воздуха по ходу воздуха: компрессоры → (влагоотделитель) → «мокрый» ресивер → фильтры →
 * осушитель → фильтры → угольный → «сухой» ресивер → генератор. У аппаратов — один вход и один выход.
 */
export class AirChain {
  static GRADES = {
    sep: { name: 'Влагоотделитель (циклонный сепаратор)', short: 'влагоотделитель', stage: 'Влагоотделитель (циклон)' },
    pre: {
      name: 'Фильтр предварительной очистки (3–5 мкм)',
      short: 'предварительной очистки',
      stage: 'Предварительная',
    },
    fine: { name: 'Фильтр тонкой очистки (1 мкм, масло до 0,1 мг/м³)', short: 'тонкой очистки', stage: 'Тонкая' },
    micro: {
      name: 'Фильтр сверхтонкой очистки от масла (0,01 мкм, 0,01 мг/м³)',
      short: 'сверхтонкой очистки от масла',
      stage: 'Сверхтонкая (микрофильтр)',
    },
    dust: {
      name: 'Пылевой фильтр после адсорбционного осушителя (сухой фильтр частиц)',
      short: 'пылевой',
      stage: 'Пылевой (после адсорбционного осушителя)',
    },
    carbon: {
      name: 'Угольный фильтр (пары масла и запах, 0,003 мг/м³)',
      short: 'угольный',
      stage: 'Угольный (от паров масла)',
    },
  };

  static get KP() {
    return StationRules.raw('dryer.kp');
  }

  static get MARGIN() {
    return StationRules.raw('dryer.margin');
  }

  static get PURGE() {
    return StationRules.raw('flow.purge').default;
  }

  /** Продувка адсорбционного осушителя по типу регенерации — доля производительности. */
  static purge(regen) {
    const P = StationRules.raw('flow.purge');
    const k = String(regen || '');
    return P[k] != null ? P[k] : P.default;
  }

  static get RECV_SIZES() {
    return StationRules.raw('receiver.sizes');
  }

  /** Ресивер по умолчанию (receiver.base): {volume, maker} или null. */
  static get BASE() {
    const b = StationRules.opt('receiver.base');
    return b && b.volume > 0 ? b : null;
  }

  static get CLASSES() {
    return StationRules.raw('air.classes');
  }

  static get PDP() {
    return StationRules.raw('air.pdp');
  }

  /** Пункты выбора класса чистоты; класс из ТЗ не из списка — в конце. */
  static options(cur) {
    const list = this.CLASSES.map(([v, t]) => [v, `${v} — ${t}`]);
    return cur && !this.CLASSES.some(c => c[0] === cur) ? [...list, [cur, `${cur} — по ТЗ`]] : list;
  }

  /** Текст элемента для распознавания: название, модель, ступень, тонкость, характеристики. */
  static text(p) {
    const a = p.attrs || {};
    const rows = (p.rows || []).map(r => (r ? `${key(r)}: ${val(r)}` : ''));
    return [p.name, a.model, a.stage, a.fineness, a.isoClass, a.series, ...rows].filter(Boolean).join(' · ');
  }

  /** Первое число строки характеристики. */
  static first(v) {
    const m = String(v ?? '').match(/\d[\d\s]*(?:[.,]\d+)?/);
    return m ? StationEquip.num(m[0]) : null;
  }

  /** Производительность, м³/мин: поле каталога или строка «Производительность» (л/мин, м³/ч, л/с). */
  static flow(p) {
    const own = StationEquip.num((p.attrs || {}).flow);
    if (own > 0) return own;
    for (const r of (p.rows || []).filter(x => x && /производительн|пропускн|расход воздух/i.test(key(x)))) {
      const v = this.first(r.v);
      if (!(v > 0)) continue;
      const unit = FLOW_UNITS.find(([re]) => re.test(`${key(r)} ${val(r)}`));
      return unit ? unit[1](v) : v;
    }
    return null;
  }

  /** Рабочее давление, бар (МПа пересчитываются). */
  static bar(p) {
    const own = StationEquip.num((p.attrs || {}).pressure);
    if (own > 0) return own;
    const r = (p.rows || []).find(x => x && /давлени/i.test(key(x)));
    const v = r ? this.first(r.v) : null;
    if (!(v > 0)) return null;
    return /мпа/i.test(key(r) + val(r)) ? v * 10 : v;
  }

  /** Объём, л (м³ пересчитываются). */
  static volume(p) {
    const own = StationEquip.num((p.attrs || {}).volume);
    if (own > 0) return own;
    const r = (p.rows || []).find(x => x && /^объ[её]м/i.test(key(x).trim()));
    const v = r ? this.first(r.v) : null;
    if (!(v > 0)) return null;
    return /м[³3]/i.test(key(r) + val(r)) && v < 100 ? v * 1000 : v;
  }

  /** Ступень фильтра: поле «Ступень очистки», иначе по названию и характеристикам; cond — сепаратор конденсата. */
  static grade(p, cat, t) {
    if (cat === 'oil_sep' || /конденсат|масловод|водомасл|масляного тумана/i.test(t)) return 'cond';
    const byStage = this.gradeByStage(p);
    if (byStage) return byStage;
    if (/угол|угольн|активированн|пар\S*\s+масл|запах|(?:^|[^a-z])(?:QD|ACS)\s?\d/i.test(t)) return 'carbon';
    const byMicron = this.gradeByMicron(p, t);
    if (byMicron) return byMicron;
    const byText = TEXT_WORDS.find(([re]) => re.test(t));
    return byText ? byText[1] : '';
  }

  /** По полю «Ступень очистки»; циклонный сепаратор — не фильтр, даже со ступенью «Предварительная». */
  static gradeByStage(p) {
    const row = (p.rows || []).find(r => r && /^ступень очистки/i.test(key(r).trim()));
    const stage = String((p.attrs || {}).stage || (row && row.v) || '');
    if (/циклон|влагоотдел|водоотдел/i.test(`${String(p.name || '')} ${stage}`)) return 'sep';
    const hit = STAGE_WORDS.find(([re]) => re.test(stage));
    return hit ? hit[1] : '';
  }

  static gradeByMicron(p, t) {
    const um = this.micron(p);
    const G = StationRules.raw('air.grade.micron');
    if (um >= G.pre) return 'pre';
    if (um != null && um <= G.micro && !/пылев/i.test(t)) return 'micro';
    return '';
  }

  /** Тонкость фильтрации по частицам, мкм («Мкн» — тоже); нет — null. */
  static micron(p) {
    const rx = /(\d+(?:[.,]\d+)?)\s*мк[мн]/i;
    const own = String((p.attrs || {}).fineness || '').match(rx);
    if (own) return StationEquip.num(own[1]);
    const rows = (p.rows || []).filter(
      r => r && /частиц|пыл|тонкост|степень (?:очистки|фильтрац)/i.test(key(r)) && !/масл|вод/i.test(key(r)),
    );
    for (const r of rows) {
      const x = val(r).match(rx) || (/мк[мн]/i.test(key(r)) ? val(r).match(/(\d+(?:[.,]\d+)?)/) : null);
      if (x) return StationEquip.num(x[1]);
    }
    return null;
  }

  /** Остаточное масло после фильтра, мг/м³; нет — null. */
  static oil(p) {
    for (const r of (p.rows || []).filter(x => x && /масл/i.test(key(x)) && /мг/i.test(`${key(x)} ${val(x)}`))) {
      const v = this.first(r.v);
      if (v != null && v > 0) return v;
    }
    return null;
  }

  /** Фильтры в комплекте аппарата: строка «…фильтры в комплекте / в составе / встроенные» (не «нет»). */
  static kitFilters(p) {
    return (p.rows || []).some(
      r =>
        r &&
        /фильтр/i.test(key(r)) &&
        /встроен|в\s+комплект|в\s+составе/i.test(`${key(r)} ${val(r)}`) &&
        !/^\s*(нет|-|—)\s*$/i.test(val(r)),
    );
  }

  /** Сведения для цепочки по виду: производительность, давление и признаки вида. */
  static info(p, kind) {
    const o = { flow: this.flow(p), bar: this.bar(p) };
    const more = {
      compressor: () => this.compressorInfo(p),
      dryer: () => this.dryerInfo(p),
      receiver: () => this.receiverInfo(p),
      filter: () => this.filterInfo(p),
    }[kind];
    return more ? Object.assign(o, more()) : o;
  }

  static compressorInfo(p) {
    const a = p.attrs || {};
    const name = String(p.name || '');
    const t = this.text(p);
    const dryerName =
      /(?:^|\s)со?\s+(?:встроенн\S*\s+)?(?:рефрижераторн\S*\s+)?осушител|встроенн\S*\s+(?:\S+\s+)?осушител|осушител\S*\s+встроен|(?:^|[^a-z])FF(?:[^a-z]|$)/i;
    const filterName = /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|(?:^|\s)с\s+(?:\S+\s+){0,3}фильтр/i;
    const rows = p.rows || [];
    return {
      dryer: SET(a.dryer)
        ? YES(a.dryer)
        : dryerName.test(name) || rows.some(r => r && /осушител/i.test(key(r)) && YES(r.v)),
      filter: SET(a.filters)
        ? YES(a.filters)
        : filterName.test(name) ||
          this.kitFilters(p) ||
          rows.some(r => r && /осушител\S*\s+и\s+(?:магистральн\S*\s+)?фильтр/i.test(val(r))),
      vsd: SET(a.vsd)
        ? YES(a.vsd)
        : /частотн|инвертор|(?:^|[^a-z])VSD(?:[^a-z]|$)|(?:^|\s)ПЧ(?:\s|$)|переменн\S*\s+скорост/i.test(t),
      recv: StationEquip.num(a.receiver) > 0 || /на ресивере/i.test(t),
    };
  }

  static dryerType(cat, name, t) {
    if (/^gen_/.test(cat) || /генератор/i.test(name)) return 'gen';
    return cat === 'dryer_ads' || /адсорбц|десикант|мембран/i.test(t) ? 'ads' : 'refrig';
  }

  static dryerInfo(p) {
    const a = p.attrs || {};
    const t = this.text(p);
    const built =
      /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|фильтр\S*\s+(?:\S+\s+)?встроен|(?:^|\s)с\s+(?:\S+\s+)?фильтрам|интегрированн\S*\s+(?:\S+\s+)?фильтр/i;
    const pdp = this.first(String(a.dewPoint || '').replace('−', '-'));
    return {
      type: this.dryerType(String(a.cat || p.cat || ''), String(p.name || ''), t),
      filters: SET(a.filters) ? YES(a.filters) : built.test(t) || this.kitFilters(p),
      pdp: pdp != null && /[−-]/.test(String(a.dewPoint)) ? -Math.abs(pdp) : pdp,
    };
  }

  static receiverInfo(p) {
    const name = String(p.name || '');
    const t = this.text(p);
    const own = p.recvRole === 'wet' || p.recvRole === 'dry' ? p.recvRole : '';
    const dry = /сух/i.test(name) || /после осушител/i.test(t);
    const guess = dry ? 'dry' : /мокр|влажн/i.test(name) && 'wet';
    return { role: own || guess || '', vol: this.volume(p) };
  }

  static filterInfo(p) {
    const g = String(p.airGrade || '');
    const cat = String((p.attrs || {}).cat || p.cat || '');
    return {
      grade: this.GRADES[g] ? g : this.grade(p, cat, this.text(p)),
      pinned: Boolean(this.GRADES[g]),
      oil: this.oil(p),
      um: this.micron(p),
    };
  }

  /**
   * Порядок по ходу воздуха (e.air.stage), роли ресиверов и ступени фильтров без указания.
   * @param {string} recv где ресивер без своей роли: 'after' (по умолчанию), 'before', 'both'
   */
  static assign(eq, recv) {
    const A = eq.filter(e => e.air);
    const D = A.filter(e => e.kind === 'dryer' && e.air.type !== 'gen');
    const ads = D.some(e => e.air.type === 'ads');
    for (const e of A.filter(x => x.kind === 'receiver' && !x.air.role)) e.air.role = recv === 'before' ? 'wet' : 'dry';
    if (!ads) {
      for (const e of A.filter(x => x.kind === 'filter' && x.air.grade === 'dust' && !x.air.pinned))
        e.air.grade = 'pre';
    }
    this.guessGrades(A, D, ads);
    const stage = (e, gr) => this.stage(e, gr, D, ads);
    for (const e of A) {
      e.air.stage = stage(e, e.air.grade);
      if (e.air.grades) e.air.stages = e.air.grades.map(g => stage(e, g));
    }
  }

  static want(D, ads) {
    if (ads) return WANT.ads;
    if (!D.some(e => e.air.type === 'refrig')) return WANT.none;
    return D.some(e => e.air.filters) ? WANT.refrigBuilt : WANT.refrig;
  }

  /** Фильтры без ступени — чего не хватает по виду осушителя (несколько одной строкой — каждому своя). */
  static guessGrades(A, D, ads) {
    const F = A.filter(e => e.kind === 'filter' && e.air.grade !== 'cond');
    const have = new Set(F.map(e => e.air.grade).filter(Boolean));
    const want = this.want(D, ads);
    for (const e of F.filter(x => !x.air.grade)) {
      const grades = Array.from({ length: e.qty }, () => {
        const g = want.find(w => !have.has(w)) || 'fine';
        have.add(g);
        return g;
      });
      e.air.grade = grades[0];
      e.air.guess = true;
      if (grades.some(g => g !== grades[0])) e.air.grades = grades;
    }
  }

  /** Ступень по ходу воздуха (меньше — раньше); фильтры одной ступени — от грубого к тонкому. */
  static stage(e, gr, D, ads) {
    const a = e.air;
    const fixed = {
      compressor: () => 10,
      receiver: () => (a.role === 'dry' ? 60 : 20),
      dryer: () => ({ gen: 70, ads: 45 })[a.type] || 40,
    }[e.kind];
    if (fixed) return fixed();
    if (e.kind !== 'filter' || gr === 'cond') return null;
    return this.filterStage(a, gr, D, ads);
  }

  static filterStage(a, gr, D, ads) {
    const base = D.length ? { ...FILTER_STAGE.dryer, micro: ads ? 43 : 51 }[gr] : FILTER_STAGE.bare[gr];
    const fine = v => (v > 0 ? -Math.log10(v) : null);
    const f = fine(a.um) ?? fine(a.oil);
    if (base == null || f == null || (a.grades && a.grades.length > 1)) return base;
    const oilBonus = a.um > 0 && a.oil > 0 ? 0.01 * fine(a.oil) : 0;
    return base + Math.round(Math.min(0.9, Math.max(0.05, 0.5 + 0.1 * f + oilBonus)) * 100) / 1000;
  }

  /** Единица k строки состава — её ступень. */
  static unit(air, k) {
    return air && air.grades ? { ...air, grade: air.grades[k], stage: air.stages[k] } : air;
  }

  /** Строки с разными ступенями — отдельными записями (qty 1). */
  static expand(A) {
    return A.flatMap(e =>
      e.air && e.air.grades ? e.air.grades.map((g, k) => ({ ...e, qty: 1, air: this.unit(e.air, k) })) : [e],
    );
  }

  /** Одинаковые аппараты подряд по ходу воздуха — параллельно (осушители и фильтры одной ступени). */
  static groups(list) {
    const out = [];
    for (const e of list) {
      const g = out[out.length - 1];
      if (g && this.parallel(g[0], e)) g.push(e);
      else out.push([e]);
    }
    return out;
  }

  static parallel(a, e) {
    return (
      (e.kind === 'dryer' || e.kind === 'filter') && a.kind === e.kind && e.air && a.air && a.air.stage === e.air.stage
    );
  }

  /** Указание о параллельных группах для схемы и ТЗ или ''. */
  static parText(units) {
    const qty = G => G.reduce((s, u) => s + (u.qty || 1), 0);
    const P = this.groups((units || []).filter(u => u.kind !== 'compressor')).filter(
      G => G[0].kind !== 'receiver' && qty(G) > 1,
    );
    if (!P.length) return '';
    const what = G => {
      const kind = G[0].kind === 'filter' ? 'фильтры' : this.dryerWord(G[0]);
      return `${kind} поз. ${[...new Set(G.map(u => u.pos))].join(', ')} (${qty(G)} шт.)`;
    };
    return `Одинаковые ${P.map(what).join('; ')} включены параллельно: производительность складывается; на входе и выходе каждого — кран, аппарат отключают на обслуживание, не останавливая остальные.`;
  }

  static dryerWord(u) {
    return (u.air || {}).type === 'gen' ? 'генераторы' : 'осушители';
  }

  /** Поправка осушителя на давление. */
  static kp(bar) {
    return bar > 0 ? StationRules.interp(this.KP, bar) : 1;
  }

  /** Поправка фильтра на давление: пропорционально абсолютному давлению к номиналу. */
  static kf(bar) {
    const f = StationRules.raw('filter.kp');
    return bar > 0 ? Math.min(f.cap, (bar + 1) / (f.ref + 1)) : 1;
  }

  static m3(v) {
    return (Math.round(v * 10) / 10).toString().replace('.', ',');
  }

  static pv(bar, litres) {
    return ((bar / 10) * litres) / 1000;
  }

  /** Ресиверы по умолчанию на объём V: {n, v} по BASE.volume; null — правила нет или ресивер подлежит учёту. */
  static base(V, bar) {
    const b = this.BASE;
    if (!b || !(V > 0)) return null;
    const v = b.volume;
    if (bar > 0 && this.pv(bar, v) > PressureVessel.LIMIT + 1e-9) return null;
    return { n: Math.max(1, Math.ceil(Math.round(V) / v - 1e-9)), v };
  }

  /** Ресиверы без учёта в Ростехнадзоре на объём V: наименьшее число одинаковых из ряда; не нужно — null. */
  static split(V, bar) {
    if (!(V > 0) || !(bar > 0) || this.pv(bar, V) <= PressureVessel.LIMIT + 1e-9) return null;
    const v = this.RECV_SIZES.filter(x => this.pv(bar, x) <= PressureVessel.LIMIT + 1e-9).pop();
    return v ? { n: Math.ceil(V / v - 1e-9), v } : null;
  }

  /** Проверка и подбор цепочки: {chain, q, bar, issues, recs, cls, units, cond} или null без компрессоров. */
  static check(eq, cls, rq) {
    return new AirCheck(eq, cls, rq).run();
  }
}
