import { AirCheck } from './air-check.js';
import { PressureVessel } from './pressure-vessel.js';
import { StationEquip } from './station-equip.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Подготовка сжатого воздуха по ходу воздуха: компрессоры → (влагоотделитель) → «мокрый» ресивер → фильтры →
 * осушитель → фильтры → угольный → «сухой» ресивер → генератор. У аппаратов — один вход и один выход.
 */
export class AirChain {
  static _isYes = v => /^(да|есть|встроен)/i.test(String(v ?? '').trim());

  static _isSet = v => v != null && String(v).trim() !== '';

  static _key = row => String(row.k || '');

  static _val = row => String(row.v || '');

  /** Ступени фильтров по полю «Ступень очистки» — по порядку проверки. */
  static STAGE_WORDS = [
    [/пылев/i, 'dust'],
    [/предвар/i, 'pre'],
    [/сверхтонк|микро/i, 'micro'],
    [/уголь/i, 'carbon'],
    [/тонк/i, 'fine'],
  ];

  /** Ступени фильтров по тексту элемента — после тонкости по частицам. */
  static TEXT_WORDS = [
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
  static FLOW_UNITS = [
    [/л\s*\/\s*мин/i, v => v / 1000],
    [/м[³3]\s*\/\s*ч/i, v => v / 60],
    [/л\s*\/\s*с/i, v => v * 0.06],
  ];

  /** Ступень по ходу воздуха у фильтров: без осушителя и с осушителем (до и после него). */
  static FILTER_STAGE = {
    bare: { sep: 15, pre: 31, fine: 32, micro: 33, dust: 34, carbon: 35 },
    dryer: { sep: 15, pre: 31, fine: 32, dust: 52, carbon: 55 },
  };

  /** Чего не хватает по виду осушителя — ступени для фильтров без указанной ступени. */
  static WANT = {
    ads: ['micro', 'dust', 'carbon'],
    refrigBuilt: ['micro', 'carbon'],
    refrig: ['pre', 'micro', 'carbon'],
    none: ['pre', 'fine', 'micro', 'carbon'],
  };

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

  static get _DRYER_K() {
    return StationRules.raw('dryer.kp');
  }

  /** Запас производительности осушителя (правило dryer.margin). */
  static get MARGIN() {
    return StationRules.raw('dryer.margin');
  }

  /** Доля воздуха на продувку адсорбционного осушителя. */
  static get PURGE() {
    return StationRules.raw('flow.purge').default;
  }

  /** Продувка адсорбционного осушителя по типу регенерации — доля производительности. */
  static purge(regen) {
    const purge = StationRules.raw('flow.purge');
    const k = String(regen || '');
    return purge[k] != null ? purge[k] : purge.default;
  }

  static get _RECV_SIZES() {
    return StationRules.raw('receiver.sizes');
  }

  /** Ресивер по умолчанию (receiver.base): {volume, maker} или null. */
  static get BASE() {
    const base = StationRules.opt('receiver.base');
    return base && base.volume > 0 ? base : null;
  }

  static get _CLASSES() {
    return StationRules.raw('air.classes');
  }

  /** Точка росы по классам влажности ISO 8573-1. */
  static get PDP() {
    return StationRules.raw('air.pdp');
  }

  /** Пункты выбора класса чистоты; класс из ТЗ не из списка — в конце. */
  static options(cur) {
    const list = this._CLASSES.map(([v, title]) => [v, `${v} — ${title}`]);
    return cur && !this._CLASSES.some(cls => cls[0] === cur) ? [...list, [cur, `${cur} — по ТЗ`]] : list;
  }

  /** Текст элемента для распознавания: название, модель, ступень, тонкость, характеристики. */
  static text(part) {
    const attrs = part.attrs || {};
    const rows = (part.rows || []).map(row => (row ? `${AirChain._key(row)}: ${AirChain._val(row)}` : ''));
    return [part.name, attrs.model, attrs.stage, attrs.fineness, attrs.isoClass, attrs.series, ...rows]
      .filter(Boolean)
      .join(' · ');
  }

  /** Первое число строки характеристики. */
  static first(v) {
    const match = String(v ?? '').match(/\d[\d\s]*(?:[.,]\d+)?/);
    return match ? StationEquip.num(match[0]) : null;
  }

  /** Производительность, м³/мин: поле каталога или строка «Производительность» (л/мин, м³/ч, л/с). */
  static flow(part) {
    const own = StationEquip.num((part.attrs || {}).flow);
    if (own > 0) return own;
    for (const row of (part.rows || []).filter(
      x => x && /производительн|пропускн|расход воздух/i.test(AirChain._key(x)),
    )) {
      const v = this.first(row.v);
      if (!(v > 0)) continue;
      const unit = AirChain.FLOW_UNITS.find(([pattern]) => pattern.test(`${AirChain._key(row)} ${AirChain._val(row)}`));
      return unit ? unit[1](v) : v;
    }
    return null;
  }

  /** Рабочее давление, бар (МПа пересчитываются). */
  static bar(part) {
    const own = StationEquip.num((part.attrs || {}).pressure);
    if (own > 0) return own;
    const row = (part.rows || []).find(x => x && /давлени/i.test(AirChain._key(x)));
    const v = row ? this.first(row.v) : null;
    if (!(v > 0)) return null;
    return /мпа/i.test(AirChain._key(row) + AirChain._val(row)) ? v * 10 : v;
  }

  /** Объём, л (м³ пересчитываются). */
  static volume(part) {
    const own = StationEquip.num((part.attrs || {}).volume);
    if (own > 0) return own;
    const row = (part.rows || []).find(x => x && /^объ[её]м/i.test(AirChain._key(x).trim()));
    const v = row ? this.first(row.v) : null;
    if (!(v > 0)) return null;
    return /м[³3]/i.test(AirChain._key(row) + AirChain._val(row)) && v < 100 ? v * 1000 : v;
  }

  /** Ступень фильтра: поле «Ступень очистки», иначе по названию и характеристикам; cond — сепаратор конденсата. */
  static grade(part, cat, text) {
    if (cat === 'oil_sep' || /конденсат|масловод|водомасл|масляного тумана/i.test(text)) return 'cond';
    const byStage = this.gradeByStage(part);
    if (byStage) return byStage;
    if (/угол|угольн|активированн|пар\S*\s+масл|запах|(?:^|[^a-z])(?:QD|ACS)\s?\d/i.test(text)) return 'carbon';
    const byMicron = this._gradeByMicron(part, text);
    if (byMicron) return byMicron;
    const byText = AirChain.TEXT_WORDS.find(([pattern]) => pattern.test(text));
    return byText ? byText[1] : '';
  }

  /** По полю «Ступень очистки»; циклонный сепаратор — не фильтр, даже со ступенью «Предварительная». */
  static gradeByStage(part) {
    const row = (part.rows || []).find(cand => cand && /^ступень очистки/i.test(AirChain._key(cand).trim()));
    const stage = String((part.attrs || {}).stage || (row && row.v) || '');
    if (/циклон|влагоотдел|водоотдел/i.test(`${String(part.name || '')} ${stage}`)) return 'sep';
    const hit = AirChain.STAGE_WORDS.find(([pattern]) => pattern.test(stage));
    return hit ? hit[1] : '';
  }

  static _gradeByMicron(part, text) {
    const micron = this.micron(part);
    const limits = StationRules.raw('air.grade.micron');
    if (micron >= limits.pre) return 'pre';
    if (micron != null && micron <= limits.micro && !/пылев/i.test(text)) return 'micro';
    return '';
  }

  /** Тонкость фильтрации по частицам, мкм («Мкн» — тоже); нет — null. */
  static micron(part) {
    const pattern2 = /(\d+(?:[.,]\d+)?)\s*мк[мн]/i;
    const own = String((part.attrs || {}).fineness || '').match(pattern2);
    if (own) return StationEquip.num(own[1]);
    const rows = (part.rows || []).filter(
      row =>
        row &&
        /частиц|пыл|тонкост|степень (?:очистки|фильтрац)/i.test(AirChain._key(row)) &&
        !/масл|вод/i.test(AirChain._key(row)),
    );
    for (const row of rows) {
      const x =
        AirChain._val(row).match(pattern2) ||
        (/мк[мн]/i.test(AirChain._key(row)) ? AirChain._val(row).match(/(\d+(?:[.,]\d+)?)/) : null);
      if (x) return StationEquip.num(x[1]);
    }
    return null;
  }

  /** Остаточное масло после фильтра, мг/м³; нет — null. */
  static oil(part) {
    for (const row of (part.rows || []).filter(
      x => x && /масл/i.test(AirChain._key(x)) && /мг/i.test(`${AirChain._key(x)} ${AirChain._val(x)}`),
    )) {
      const v = this.first(row.v);
      if (v != null && v > 0) return v;
    }
    return null;
  }

  /** Фильтры в комплекте аппарата: строка «…фильтры в комплекте / в составе / встроенные» (не «нет»). */
  static kitFilters(part) {
    return (part.rows || []).some(
      row =>
        row &&
        /фильтр/i.test(AirChain._key(row)) &&
        /встроен|в\s+комплект|в\s+составе/i.test(`${AirChain._key(row)} ${AirChain._val(row)}`) &&
        !/^\s*(нет|-|—)\s*$/i.test(AirChain._val(row)),
    );
  }

  /** Сведения для цепочки по виду: производительность, давление и признаки вида. */
  static info(part, kind) {
    const info = { flow: this.flow(part), bar: this.bar(part) };
    const more = {
      compressor: () => this._compressorInfo(part),
      dryer: () => this._dryerInfo(part),
      receiver: () => this._receiverInfo(part),
      filter: () => this._filterInfo(part),
    }[kind];
    return more ? Object.assign(info, more()) : info;
  }

  static _compressorInfo(part) {
    const attrs = part.attrs || {};
    const name = String(part.name || '');
    const text = this.text(part);
    const dryerName =
      /(?:^|\s)со?\s+(?:встроенн\S*\s+)?(?:рефрижераторн\S*\s+)?осушител|встроенн\S*\s+(?:\S+\s+)?осушител|осушител\S*\s+встроен|(?:^|[^a-z])FF(?:[^a-z]|$)/i;
    const filterName = /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|(?:^|\s)с\s+(?:\S+\s+){0,3}фильтр/i;
    const rows = part.rows || [];
    return {
      dryer: AirChain._isSet(attrs.dryer)
        ? AirChain._isYes(attrs.dryer)
        : dryerName.test(name) ||
          rows.some(row => row && /осушител/i.test(AirChain._key(row)) && AirChain._isYes(row.v)),
      filter: AirChain._isSet(attrs.filters)
        ? AirChain._isYes(attrs.filters)
        : filterName.test(name) ||
          this.kitFilters(part) ||
          rows.some(row => row && /осушител\S*\s+и\s+(?:магистральн\S*\s+)?фильтр/i.test(AirChain._val(row))),
      vsd: AirChain._isSet(attrs.vsd)
        ? AirChain._isYes(attrs.vsd)
        : /частотн|инвертор|(?:^|[^a-z])VSD(?:[^a-z]|$)|(?:^|\s)ПЧ(?:\s|$)|переменн\S*\s+скорост/i.test(text),
      recv: StationEquip.num(attrs.receiver) > 0 || /на ресивере/i.test(text),
    };
  }

  static _dryerType(cat, name, text) {
    if (/^gen_/.test(cat) || /генератор/i.test(name)) return 'gen';
    return cat === 'dryer_ads' || /адсорбц|десикант|мембран/i.test(text) ? 'ads' : 'refrig';
  }

  static _dryerInfo(part) {
    const attrs = part.attrs || {};
    const text = this.text(part);
    const built =
      /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|фильтр\S*\s+(?:\S+\s+)?встроен|(?:^|\s)с\s+(?:\S+\s+)?фильтрам|интегрированн\S*\s+(?:\S+\s+)?фильтр/i;
    const pdp = this.first(String(attrs.dewPoint || '').replace('−', '-'));
    return {
      type: this._dryerType(String(attrs.cat || part.cat || ''), String(part.name || ''), text),
      filters: AirChain._isSet(attrs.filters)
        ? AirChain._isYes(attrs.filters)
        : built.test(text) || this.kitFilters(part),
      pdp: pdp != null && /[−-]/.test(String(attrs.dewPoint)) ? -Math.abs(pdp) : pdp,
    };
  }

  static _receiverInfo(part) {
    const name = String(part.name || '');
    const text = this.text(part);
    const own = part.recvRole === 'wet' || part.recvRole === 'dry' ? part.recvRole : '';
    const dry = /сух/i.test(name) || /после осушител/i.test(text);
    const guess = dry ? 'dry' : /мокр|влажн/i.test(name) && 'wet';
    return { role: own || guess || '', vol: this.volume(part) };
  }

  static _filterInfo(part) {
    const grade = String(part.airGrade || '');
    const cat = String((part.attrs || {}).cat || part.cat || '');
    return {
      grade: this.GRADES[grade] ? grade : this.grade(part, cat, this.text(part)),
      pinned: Boolean(this.GRADES[grade]),
      oil: this.oil(part),
      um: this.micron(part),
    };
  }

  /**
   * Порядок по ходу воздуха (e.air.stage), роли ресиверов и ступени фильтров без указания.
   * @param {string} recv где ресивер без своей роли: 'after' (по умолчанию), 'before', 'both'
   */
  static assign(equip, recv) {
    const units = equip.filter(unit => unit.air);
    const dryers = units.filter(unit => unit.kind === 'dryer' && unit.air.type !== 'gen');
    const ads = dryers.some(unit => unit.air.type === 'ads');
    for (const unit of units.filter(x => x.kind === 'receiver' && !x.air.role))
      unit.air.role = recv === 'before' ? 'wet' : 'dry';
    if (!ads) {
      for (const unit of units.filter(x => x.kind === 'filter' && x.air.grade === 'dust' && !x.air.pinned))
        unit.air.grade = 'pre';
    }
    this.guessGrades(units, dryers, ads);
    const stage = (unit, gradeOf) => this.stage(unit, gradeOf, dryers, ads);
    for (const unit of units) {
      unit.air.stage = stage(unit, unit.air.grade);
      if (unit.air.grades) unit.air.stages = unit.air.grades.map(grade => stage(unit, grade));
    }
  }

  /** Какую ступень осушки ждать от станции: адсорбционную или рефрижераторную. */
  static want(dryers, ads) {
    if (ads) return AirChain.WANT.ads;
    if (!dryers.some(unit => unit.air.type === 'refrig')) return AirChain.WANT.none;
    return dryers.some(unit => unit.air.filters) ? AirChain.WANT.refrigBuilt : AirChain.WANT.refrig;
  }

  /** Фильтры без ступени — чего не хватает по виду осушителя (несколько одной строкой — каждому своя). */
  static guessGrades(units, dryers, ads) {
    const filters = units.filter(unit => unit.kind === 'filter' && unit.air.grade !== 'cond');
    const have = new Set(filters.map(unit => unit.air.grade).filter(Boolean));
    const want = this.want(dryers, ads);
    for (const unit of filters.filter(x => !x.air.grade)) {
      const grades = Array.from({ length: unit.qty }, () => {
        const grade = want.find(want0 => !have.has(want0)) || 'fine';
        have.add(grade);
        return grade;
      });
      unit.air.grade = grades[0];
      unit.air.guess = true;
      if (grades.some(grade => grade !== grades[0])) unit.air.grades = grades;
    }
  }

  /** Ступень по ходу воздуха (меньше — раньше); фильтры одной ступени — от грубого к тонкому. */
  static stage(unit, gradeOf, dryers, ads) {
    const air = unit.air;
    const fixed = {
      compressor: () => 10,
      receiver: () => (air.role === 'dry' ? 60 : 20),
      dryer: () => ({ gen: 70, ads: 45 })[air.type] || 40,
    }[unit.kind];
    if (fixed) return fixed();
    if (unit.kind !== 'filter' || gradeOf === 'cond') return null;
    return this._filterStage(air, gradeOf, dryers, ads);
  }

  static _filterStage(air, gradeOf, dryers, ads) {
    const base = dryers.length
      ? { ...AirChain.FILTER_STAGE.dryer, micro: ads ? 43 : 51 }[gradeOf]
      : AirChain.FILTER_STAGE.bare[gradeOf];
    const fine = v => (v > 0 ? -Math.log10(v) : null);
    const fineStage = fine(air.um) ?? fine(air.oil);
    if (base == null || fineStage == null || (air.grades && air.grades.length > 1)) return base;
    const oilBonus = air.um > 0 && air.oil > 0 ? 0.01 * fine(air.oil) : 0;
    return base + Math.round(Math.min(0.9, Math.max(0.05, 0.5 + 0.1 * fineStage + oilBonus)) * 100) / 1000;
  }

  /** Единица k строки состава — её ступень. */
  static unit(air, k) {
    return air && air.grades ? { ...air, grade: air.grades[k], stage: air.stages[k] } : air;
  }

  /** Строки с разными ступенями — отдельными записями (qty 1). */
  static expand(units) {
    return units.flatMap(unit =>
      unit.air && unit.air.grades
        ? unit.air.grades.map((grade, k) => ({ ...unit, qty: 1, air: this.unit(unit.air, k) }))
        : [unit],
    );
  }

  /** Одинаковые аппараты подряд по ходу воздуха — параллельно (осушители и фильтры одной ступени). */
  static groups(list) {
    const out = [];
    for (const unit of list) {
      const last = out[out.length - 1];
      if (last && this.parallel(last[0], unit)) last.push(unit);
      else out.push([unit]);
    }
    return out;
  }

  /** Стоят ли два агрегата параллельно (одна ступень, одинаковый тип). */
  static parallel(first, unit) {
    return (
      (unit.kind === 'dryer' || unit.kind === 'filter') &&
      first.kind === unit.kind &&
      unit.air &&
      first.air &&
      first.air.stage === unit.air.stage
    );
  }

  /** Указание о параллельных группах для схемы и ТЗ или ''. */
  static parText(units) {
    const qty = group => group.reduce((acc, u) => acc + (u.qty || 1), 0);
    const groups = this.groups((units || []).filter(u => u.kind !== 'compressor')).filter(
      group => group[0].kind !== 'receiver' && qty(group) > 1,
    );
    if (!groups.length) return '';
    const what = group => {
      const kind = group[0].kind === 'filter' ? 'фильтры' : this._dryerWord(group[0]);
      return `${kind} поз. ${[...new Set(group.map(u => u.pos))].join(', ')} (${qty(group)} шт.)`;
    };
    return `Одинаковые ${groups.map(what).join('; ')} включены параллельно: производительность складывается; на входе и выходе каждого — кран, аппарат отключают на обслуживание, не останавливая остальные.`;
  }

  static _dryerWord(u) {
    return (u.air || {}).type === 'gen' ? 'генераторы' : 'осушители';
  }

  /** Поправка осушителя на давление. */
  static dryerK(bar) {
    return bar > 0 ? StationRules.interp(this._DRYER_K, bar) : 1;
  }

  /** Поправка фильтра на давление: пропорционально абсолютному давлению к номиналу. */
  static filterK(bar) {
    const rule = StationRules.raw('filter.kp');
    return bar > 0 ? Math.min(rule.cap, (bar + 1) / (rule.ref + 1)) : 1;
  }

  /** Число с одним знаком после запятой: 7.5 → «7,5». */
  static flowText(v) {
    return (Math.round(v * 10) / 10).toString().replace('.', ',');
  }

  /** Произведение давления на вместимость, МПа·м³ — для отнесения сосуда к подконтрольным. */
  static pvProduct(bar, litres) {
    return ((bar / 10) * litres) / 1000;
  }

  /** Ресиверы по умолчанию на объём V: {n, v} по BASE.volume; null — правила нет или ресивер подлежит учёту. */
  static base(vol, bar) {
    const base = this.BASE;
    if (!base || !(vol > 0)) return null;
    const v = base.volume;
    if (bar > 0 && this.pvProduct(bar, v) > PressureVessel.LIMIT + 1e-9) return null;
    return { n: Math.max(1, Math.ceil(Math.round(vol) / v - 1e-9)), v };
  }

  /** Ресиверы без учёта в Ростехнадзоре на объём V: наименьшее число одинаковых из ряда; не нужно — null. */
  static split(vol, bar) {
    if (!(vol > 0) || !(bar > 0) || this.pvProduct(bar, vol) <= PressureVessel.LIMIT + 1e-9) return null;
    const v = this._RECV_SIZES.filter(x => this.pvProduct(bar, x) <= PressureVessel.LIMIT + 1e-9).pop();
    return v ? { n: Math.ceil(vol / v - 1e-9), v } : null;
  }

  /** Проверка и подбор цепочки: {chain, q, bar, issues, recs, cls, units, cond} или null без компрессоров. */
  static check(equip, cls, req) {
    return new AirCheck(equip, cls, req).run();
  }
}
