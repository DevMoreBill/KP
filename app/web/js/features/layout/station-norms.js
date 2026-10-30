import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { StationEquip } from './station-equip.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Нормы станции: шум (СанПиН 1.2.3685-21), климатическое исполнение (ГОСТ 15150-69), отопление и вентиляция, щиты длиннее
 * 7 м (ПУЭ, п. 4.1.23), категория помещения (СП 12.13130.2009), пожарная сигнализация (СП 486.1311500.2020).
 */
export class StationNorms {
  static WARM_WORDS = { compressor: 'компрессоры', dryer: 'осушитель', pump: 'насосы' };

  static PIPE = { air: 'сжатый воздух — синий', water: 'вода — зелёный', fuel: 'топливо — коричневый' };

  /** Перегородка отсека топливного бака (fire.fuel_wall) — один текст для ТТ чертежа, «Компоновки» и ТЗ. */
  static get FIRE_WALL() {
    return `EI ${StationRules.raw('fire.fuel_wall')}`;
  }

  static get _NOISE() {
    return StationRules.raw('norm.noise');
  }

  /** Нижние температуры исполнений. */
  static get COLD() {
    return StationRules.raw('norm.cold');
  }

  /** Температура внутри станции. */
  static get INSIDE() {
    return StationRules.raw('heat.inside');
  }

  /** Правила электрощита. */
  static get SHIELD() {
    return StationRules.raw('norm.shield');
  }

  /**
   * Длина щита для текста: «7 м».
   * @returns {string}
   */
  static shieldText() {
    return `${Mm.dec(this.SHIELD / 1000)} м`;
  }

  /** Уровень звука по паспорту, дБА: поле «noise» или строка «Уровень шума (звука)». */
  static dba(product) {
    const own = StationEquip.num((product.attrs || {}).noise);
    if (own > 20 && own < 160) return own;
    const row = (product.rows || []).find(
      x => x && /шум|звук/i.test(String(x.k || '')) && /д\s*б/i.test(`${String(x.k || '')} ${String(x.v || '')}`),
    );
    const v = row ? AirChain.first(row.v) : null;
    return v > 20 && v < 160 ? v : null;
  }

  /** Уровень звука нескольких источников: 10·lg Σ 10^(L/10). */
  static sum(levels) {
    return levels.length ? 10 * Math.log10(levels.reduce((acc, v) => acc + 10 ** (v / 10), 0)) : 0;
  }

  /** Требования заказчика. */
  static req(plan) {
    return plan.req || {};
  }

  /** Температура со знаком: «+5», «−40». */
  static deg(temp) {
    const sign = temp > 0 ? '+' : (temp < 0 && '−') || '';
    return `${sign}${Math.abs(temp)} °C`;
  }

  /** Замечания по нормам — в plan.issues. */
  static check(plan, equip) {
    const has = k => equip.some(unit => unit.place && unit.kind === k);
    const ctx = { plan, eq: equip, has, r: this.req(plan), sys: plan.sys || {}, iss: plan.issues };
    this.noise(ctx);
    this.climate(ctx);
    this.shield(ctx);
    this.fire(ctx);
  }

  /** Шум: паспортные уровни (на 1 м) складываются. */
  static noise({ eq: equip, r: req, sys, iss }) {
    const lim = req.noise > 0 ? req.noise : this._NOISE;
    const levels = equip
      .filter(unit => unit.place && unit.noise > 0)
      .flatMap(unit => Array.from({ length: unit.qty }, () => unit.noise));
    const tot = this.sum(levels);
    if (!levels.length || !(tot > lim + 0.5)) return;
    const outside = sys.noise ? '' : '; снаружи — шумоизоляция контейнера (системы контейнера)';
    iss.push({
      level: 'warn',
      text: `Шум: оборудование по паспортам — около ${Math.round(tot)} дБА, больше ${lim} дБА на рабочем месте (СанПиН 1.2.3685-21). Внутри при работе — средства защиты слуха и знак об этом на двери${outside}.`,
    });
  }

  /** Климат: исполнение контейнера по наружной температуре; внутри — отопление и вентиляция. */
  static climate({ plan, has, r: req, sys, iss }) {
    const tmin = Number.isFinite(req.tmin) ? req.tmin : null;
    const tmax = Number.isFinite(req.tmax) ? req.tmax : null;
    this.execution(plan.climate, tmin, iss);
    const noHeat = sys.heat === false && (tmin == null || tmin < this.INSIDE);
    const warm = ['compressor', 'dryer', 'pump'].filter(has);
    if (warm.length && noHeat) {
      iss.push({
        level: 'warn',
        text: `Без отопления зимой внутри ниже +${this.INSIDE} °C: ${warm.map(k => StationNorms.WARM_WORDS[k]).join(', ')} работают в отапливаемом помещении — включите «Отопление» в системах контейнера.`,
      });
    }
    if (has('dgu') && noHeat) {
      iss.push({ level: 'info', text: 'ДГУ при морозе: для пуска — отопление контейнера и подогреватель двигателя.' });
    }
    this._heatVent({ has, sys, iss, tmax });
  }

  /** Исполнение контейнера холоднее наружного воздуха — УХЛ1, ХЛ1 или особое. */
  static execution(cls, tmin, iss) {
    const low = this.COLD[cls];
    if (tmin == null || low == null || !(tmin < low)) return;
    const need = tmin < -60 ? 'особое (по согласованию)' : 'УХЛ1 или ХЛ1';
    iss.push({
      level: 'warn',
      text: `Наружный воздух до ${this.deg(tmin)}, а исполнение контейнера ${cls} — до ${this.deg(low)} (ГОСТ 15150-69): нужно ${need}.`,
    });
  }

  static _heatVent({ has, sys, iss, tmax }) {
    if ((has('compressor') || has('dgu')) && sys.vent === false) {
      const who = has('dgu') ? 'ДГУ и компрессоры выделяют' : 'Компрессоры выделяют';
      iss.push({
        level: 'warn',
        text: `${who} тепло: без вентиляции контейнер перегревается — включите «Вентиляцию» в системах контейнера.`,
      });
    }
    const room = tmax != null ? tmax + StationRules.raw('heat.vent_dt') : null;
    const limit = StationRules.raw('heat.comp_tmax');
    if (room != null && room > limit && has('compressor')) {
      iss.push({
        level: 'info',
        text: `Летом до ${this.deg(tmax)}, в помещении — до ${this.deg(room)}: выше обычных для компрессоров и осушителей ${this.deg(limit)} — вентиляция с запасом; допустимую температуру проверьте по паспорту изготовителя.`,
      });
    }
  }

  /** Шкафы в ряд длиннее norm.shield — проход с двумя выходами. */
  static shield({ plan, iss }) {
    const len = (plan.items || []).filter(i => i.kind === 'cabinet').reduce((acc, i) => acc + Math.max(i.lx, i.ly), 0);
    if (!(len > this.SHIELD)) return;
    iss.push({
      level: 'warn',
      text: `Шкафы вместе — ${Mm.text(len)} мм, длиннее ${this.shieldText()}: проход обслуживания у щита — с двумя выходами (ПУЭ, п. 4.1.23).`,
    });
  }

  /** Категория А и Б — взрывоопасные; сигнализация и пожаротушение не выбраны — напомнить. */
  static fire({ plan, r: req, sys, iss }) {
    if (/^[АБ]$/.test(req.fire || '')) {
      iss.push({
        level: 'warn',
        text: `Категория ${req.fire} — взрывопожароопасное помещение: электрооборудование во взрывозащищённом исполнении (ПУЭ, гл. 7.3), легкосбрасываемые конструкции — по проекту.`,
      });
    }
    if (!plan.geo || !plan.sys || sys.ops || sys.fire) return;
    const [Li, Wi] = plan.int || [0, 0];
    const area = String(Math.round((Li * Wi) / 1e5) / 10).replace('.', ',');
    iss.push({
      level: 'info',
      text: `Пожарная сигнализация и пожаротушение в системах контейнера не выбраны: нужны ли — по СП 486.1311500.2020 (категория ${req.fire || '—'}, площадь ${area} м²).`,
    });
  }

  /** Строки технической характеристики: категория и климатическое исполнение. */
  static tech(plan) {
    const req = this.req(plan);
    return [
      req.fire ? `Категория помещения — ${req.fire}${req.fireAuto ? ' (ориентир.)' : ''}` : '',
      plan.climate ? `Климатическое исполнение — ${plan.climate}` : '',
    ].filter(Boolean);
  }

  /** Среда станции: воздух, вода или топливо. */
  static medium(plan, req) {
    if ((plan.piping || []).some(pipe => (pipe.lines || []).some(line => line.medium === 'fuel'))) return 'fuel';
    return { pump: 'water', comp: 'air' }[req.kind] || '';
  }

  /** Пункты технических требований: пожарная безопасность, электрика и окраска, шум. */
  static techReqs(plan) {
    const req = this.req(plan);
    const med = this.medium(plan, req);
    const dgu = (plan.items || []).some(i => i.kind === 'dgu');
    const fire = plan.fire;
    const ext = fire ? ` ${fire.ext} шт.` : '';
    const auto = fire && fire.auto ? `; пожаротушение — модули «Буран-2,5» на потолке, ${fire.mods} шт.` : '';
    const tank = dgu && !plan.fuel ? '; топливный бак — с поддоном, вместимость и размещение — по СП 4.13130.2013' : '';
    const calc = req.fireAuto ? ', уточняется расчётом' : '';
    return [
      `Категория помещения по пожарной опасности${req.fire ? ` ${req.fire}` : ''} (СП 12.13130.2009${calc}) — табличка на двери снаружи; огнетушители${ext} — у выхода, верх не выше 1,5 м (ППР в РФ)${auto}; знаки безопасности — по ГОСТ 12.4.026-2015${tank}.`,
      `Заземление и уравнивание потенциалов — по ПУЭ, гл. 1.7; трубопроводы — опознавательная окраска по ГОСТ Р 71918-2024 (ГОСТ 14202-69)${med ? ` (${this.PIPE[med]})` : ''} со стрелками направления потока; уровень звука на рабочем месте — не более ${req.noise > 0 ? req.noise : this._NOISE} дБА (СанПиН 1.2.3685-21).`,
    ];
  }
}
