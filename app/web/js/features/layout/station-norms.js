import { AirChain } from './air-chain.js';
import { Mm } from './mm.js';
import { StationEquip } from './station-equip.js';

const WARM_WORDS = { compressor: 'компрессоры', dryer: 'осушитель', pump: 'насосы' };

/**
 * Нормы станции: шум (СанПиН 1.2.3685-21), климатическое исполнение (ГОСТ 15150-69), отопление и вентиляция, щиты длиннее
 * 7 м (ПУЭ, п. 4.1.23), категория помещения (СП 12.13130.2009), пожарная сигнализация (СП 486.1311500.2020).
 */
export class StationNorms {
  static PIPE = { air: 'сжатый воздух — синий', water: 'вода — зелёный', fuel: 'топливо — коричневый' };

  static get NOISE() {
    return StationRules.raw('norm.noise');
  }

  static get COLD() {
    return StationRules.raw('norm.cold');
  }

  static get INSIDE() {
    return StationRules.raw('heat.inside');
  }

  static get SHIELD() {
    return StationRules.raw('norm.shield');
  }

  /** Уровень звука по паспорту, дБА: поле «noise» или строка «Уровень шума (звука)». */
  static dba(p) {
    const own = StationEquip.num((p.attrs || {}).noise);
    if (own > 20 && own < 160) return own;
    const r = (p.rows || []).find(
      x => x && /шум|звук/i.test(String(x.k || '')) && /д\s*б/i.test(`${String(x.k || '')} ${String(x.v || '')}`),
    );
    const v = r ? AirChain.first(r.v) : null;
    return v > 20 && v < 160 ? v : null;
  }

  /** Уровень звука нескольких источников: 10·lg Σ 10^(L/10). */
  static sum(L) {
    return L.length ? 10 * Math.log10(L.reduce((s, v) => s + 10 ** (v / 10), 0)) : 0;
  }

  static req(plan) {
    return plan.req || {};
  }

  static deg(t) {
    const sign = t > 0 ? '+' : (t < 0 && '−') || '';
    return `${sign}${Math.abs(t)} °C`;
  }

  /** Замечания по нормам — в plan.issues. */
  static check(plan, eq) {
    const has = k => eq.some(e => e.place && e.kind === k);
    const ctx = { plan, eq, has, r: this.req(plan), sys: plan.sys || {}, iss: plan.issues };
    this.noise(ctx);
    this.climate(ctx);
    this.shield(ctx);
    this.fire(ctx);
  }

  /** Шум: паспортные уровни (на 1 м) складываются. */
  static noise({ eq, r, sys, iss }) {
    const lim = r.noise > 0 ? r.noise : this.NOISE;
    const L = eq.filter(e => e.place && e.noise > 0).flatMap(e => Array.from({ length: e.qty }, () => e.noise));
    const tot = this.sum(L);
    if (!L.length || !(tot > lim + 0.5)) return;
    const outside = sys.noise ? '' : '; снаружи — шумоизоляция контейнера (системы контейнера)';
    iss.push({
      level: 'warn',
      text: `Шум: оборудование по паспортам — около ${Math.round(tot)} дБА, больше ${lim} дБА на рабочем месте (СанПиН 1.2.3685-21). Внутри при работе — средства защиты слуха и знак об этом на двери${outside}.`,
    });
  }

  /** Климат: исполнение контейнера по наружной температуре; внутри — отопление и вентиляция. */
  static climate({ plan, has, r, sys, iss }) {
    const tmin = Number.isFinite(r.tmin) ? r.tmin : null;
    const tmax = Number.isFinite(r.tmax) ? r.tmax : null;
    this.execution(plan.climate, tmin, iss);
    const noHeat = sys.heat === false && (tmin == null || tmin < this.INSIDE);
    const warm = ['compressor', 'dryer', 'pump'].filter(has);
    if (warm.length && noHeat) {
      iss.push({
        level: 'warn',
        text: `Без отопления зимой внутри ниже +${this.INSIDE} °C: ${warm.map(k => WARM_WORDS[k]).join(', ')} работают в отапливаемом помещении — включите «Отопление» в системах контейнера.`,
      });
    }
    if (has('dgu') && noHeat) {
      iss.push({ level: 'info', text: 'ДГУ при морозе: для пуска — отопление контейнера и подогреватель двигателя.' });
    }
    this.heatVent({ has, sys, iss, tmax });
  }

  /** Исполнение контейнера холоднее наружного воздуха — УХЛ1, ХЛ1 или особое. */
  static execution(cl, tmin, iss) {
    const lo = this.COLD[cl];
    if (tmin == null || lo == null || !(tmin < lo)) return;
    const need = tmin < -60 ? 'особое (по согласованию)' : 'УХЛ1 или ХЛ1';
    iss.push({
      level: 'warn',
      text: `Наружный воздух до ${this.deg(tmin)}, а исполнение контейнера ${cl} — до ${this.deg(lo)} (ГОСТ 15150-69): нужно ${need}.`,
    });
  }

  static heatVent({ has, sys, iss, tmax }) {
    if ((has('compressor') || has('dgu')) && sys.vent === false) {
      const who = has('dgu') ? 'ДГУ и компрессоры выделяют' : 'Компрессоры выделяют';
      iss.push({
        level: 'warn',
        text: `${who} тепло: без вентиляции контейнер перегревается — включите «Вентиляцию» в системах контейнера.`,
      });
    }
    if (tmax != null && tmax > 40 && has('compressor')) {
      iss.push({
        level: 'info',
        text: `Летом до ${this.deg(tmax)}: компрессоры и осушитель работают обычно до +40…+45 °C — вентиляция с запасом, осушитель — с запасом производительности.`,
      });
    }
  }

  /** Шкафы в ряд длиннее 7 м — проход с двумя выходами. */
  static shield({ plan, iss }) {
    const len = (plan.items || []).filter(i => i.kind === 'cabinet').reduce((s, i) => s + Math.max(i.lx, i.ly), 0);
    if (!(len > this.SHIELD)) return;
    iss.push({
      level: 'warn',
      text: `Шкафы вместе — ${Mm.text(len)} мм, длиннее 7 м: проход обслуживания у щита — с двумя выходами (ПУЭ, п. 4.1.23).`,
    });
  }

  /** Категория А и Б — взрывоопасные; сигнализация и пожаротушение не выбраны — напомнить. */
  static fire({ plan, r, sys, iss }) {
    if (/^[АБ]$/.test(r.fire || '')) {
      iss.push({
        level: 'warn',
        text: `Категория ${r.fire} — взрывопожароопасное помещение: электрооборудование во взрывозащищённом исполнении (ПУЭ, гл. 7.3), легкосбрасываемые конструкции — по проекту.`,
      });
    }
    if (!plan.geo || !plan.sys || sys.ops || sys.fire) return;
    const [L0, W0] = plan.int || [0, 0];
    const area = String(Math.round((L0 * W0) / 1e5) / 10).replace('.', ',');
    iss.push({
      level: 'info',
      text: `Пожарная сигнализация и пожаротушение в системах контейнера не выбраны: нужны ли — по СП 486.1311500.2020 (категория ${r.fire || '—'}, площадь ${area} м²).`,
    });
  }

  /** Строки технической характеристики: категория и климатическое исполнение. */
  static tech(plan) {
    const r = this.req(plan);
    return [
      r.fire ? `Категория помещения — ${r.fire}${r.fireAuto ? ' (ориентир.)' : ''}` : '',
      plan.climate ? `Климатическое исполнение — ${plan.climate}` : '',
    ].filter(Boolean);
  }

  static medium(plan, r) {
    if ((plan.piping || []).some(p => (p.lines || []).some(l => l.medium === 'fuel'))) return 'fuel';
    return { pump: 'water', comp: 'air' }[r.kind] || '';
  }

  /** Пункты технических требований: пожарная безопасность, электрика и окраска, шум. */
  static tt(plan) {
    const r = this.req(plan);
    const med = this.medium(plan, r);
    const dgu = (plan.items || []).some(i => i.kind === 'dgu');
    const F = plan.fire;
    const ext = F ? ` ${F.ext} шт.` : '';
    const auto = F && F.auto ? `; пожаротушение — модули «Буран-2,5» на потолке, ${F.mods} шт.` : '';
    const tank = dgu && !plan.fuel ? '; топливный бак — с поддоном, вместимость и размещение — по СП 4.13130.2013' : '';
    const calc = r.fireAuto ? ', уточняется расчётом' : '';
    return [
      `Категория помещения по пожарной опасности${r.fire ? ` ${r.fire}` : ''} (СП 12.13130.2009${calc}) — табличка на двери снаружи; огнетушители${ext} — у выхода, верх не выше 1,5 м (ППР в РФ)${auto}; знаки безопасности — по ГОСТ 12.4.026-2015${tank}.`,
      `Заземление и уравнивание потенциалов — по ПУЭ, гл. 1.7; трубопроводы — опознавательная окраска по ГОСТ Р 71918-2024 (ГОСТ 14202-69)${med ? ` (${this.PIPE[med]})` : ''} со стрелками направления потока; уровень звука на рабочем месте — не более ${r.noise > 0 ? r.noise : this.NOISE} дБА (СанПиН 1.2.3685-21).`,
    ];
  }
}
