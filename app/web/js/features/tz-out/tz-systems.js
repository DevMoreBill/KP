import { StationFire } from '../layout/station-fire.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationLight } from '../layout/station-light.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationSockets } from '../layout/station-sockets.js';
import { StationVent } from '../layout/station-vent.js';

/** Системы контейнера для ТЗ: отопление и вентиляция — с мощностью и расходом по расчёту. */
export class TzSystems {
  static N = v => StationLayout.n(v);
  static BY = {
    heat: '_heat',
    vent: '_vent',
    snow: '_snow',
    snowout: '_snowOut',
    rec: '_rec',
    light: '_light',
    power: '_power',
    fire: '_fire',
    ops: '_ops',
  };

  static f(x) {
    return String(x).replace('.', ',');
  }

  /** Требование к системе id (v — её название); расчёта нет — само название. */
  static text(id, v, plan) {
    const m = Object.hasOwn(this.BY, id) ? this[this.BY[id]](v, plan) : null;
    return m === null ? v : m;
  }

  static _heat(v, plan) {
    const h = plan.heat;
    if (!(h && h.n)) return null;
    const kw = StationHeat.kw;
    return `${v}: ${h.n} × ${kw(h.kw)} кВт = ${kw(h.total)} кВт, места — по чертежу (раздел 5); внутри не ниже +${h.tin} °C при ${StationNorms.deg(h.tout)} снаружи — теплопотери ${kw(h.qStop / 1000)} кВт при остановленном оборудовании, запас 10 %${this._heatRun(h)}${h.short ? '; мест у стен не хватает — недостающую мощность добавить тепловентилятором или обогревом пола' : ''}`;
  }

  static _heatRun(h) {
    const kw = StationHeat.kw;
    if (!h.base) return '';
    if (h.qRun <= 0)
      return `; при работе тепла оборудования (${kw(h.base.q / 1000)} кВт${h.rec && h.base.kind !== 'pump' ? ', с рециркуляцией' : ''}) достаточно — конвекторы отключаются терморегуляторами`;
    return `; при работе — дополнительно подогрев забираемого воздуха (${kw(h.qRun / 1000)} кВт)`;
  }

  static _vent(v, plan) {
    return plan.vent ? this._ventCalc(v, plan) : this._ventRough(v, plan);
  }

  /** Вентиляция по расчёту: приток, выброс, маркизы, вентиляторы, радиаторы ДГУ, зима. */
  static _ventCalc(v, plan) {
    const n = this.N;
    const f = this.f;
    const V = plan.vent;
    const h = plan.heat;
    const t = [this._in(V)];
    if (V.need.out) t.push(this._out(V));
    t.push('приток и выброс — на разных стенах (не на одной стене)');
    if (V.hood)
      t.push(
        `на приточных жалюзи — маркизы (снегозащита) из оцинкованной стали: ${StationVent.hoodText(V)}; ${StationVent.HOOD_WHAT}; в открытом положении фиксируются упорами`,
      );
    if (V.hoodOut)
      t.push(
        `на жалюзи выброса горячего воздуха — маркизы (по требованию): ${StationVent.hoodText(V, 'out')}; открытые — горячий воздух уходит вниз, закрытые — защитный щит на проёме`,
      );
    t.push(...this._fans(V, h.vent.sum));
    if (V.rad) t.push(this._rad(V));
    const win = h.vent.win;
    return `${v}; летом (до ${StationNorms.deg(h.vent.tmax)}): ${t.join('; ')}; скорость по рамке — приток ${f(V.vIn)} м/с (с запасом ${Math.round((V.res - 1) * 100)} %), выброс ${f(V.vOut)} м/с, места — по чертежу; жалюзи с утеплёнными клапанами и электроприводами${win && !win.warm ? `; зимой клапаны прикрываются до ${win.open} % (минимальный воздухообмен ${n(win.Lw)} м³/ч)` : ''}`;
  }

  static _in(V) {
    const wh = StationVent.where(V);
    return `приток ${this.N(V.q.in)} м³/ч — жалюзи ${StationVent.list(V, 'in')} внизу${wh.in ? ` ${wh.in}` : ''}, проёмы по рамке не менее ${this.f(V.need.in.gross)} м²`;
  }

  static _out(V) {
    const rf = StationVent.roofList(V);
    const ow = V.louvers.some(q => q.kind === 'out') ? StationVent.list(V, 'out') : '';
    const how = [ow ? `жалюзи ${StationVent.outAt(V, true)}` : '', rf ? `через крышу (колпаки ${rf})` : '']
      .filter(Boolean)
      .join(' и ');
    return `выброс горячего воздуха ${this.N(V.q.out)} м³/ч — ${how}, по рамке не менее ${this.f(V.need.out.gross)} м²; компрессоры — воздуховодами с клапанами рециркуляции`;
  }

  /** Вентиляторы: вытяжные или стоянки, приточные, канальный в воздуховоде либо требование к сопротивлению жалюзи. */
  static _fans(V, Sm) {
    const n = this.N;
    const f = this.f;
    const t = [];
    if (Sm && Sm.exfan)
      t.push(
        `вытяжные вентиляторы (принудительный выброс горячего воздуха) — осевые настенные, вверху стены напротив притока, в проёмах выброса${V.exfan ? ` (${V.exfan.n} шт.)` : ''}: всего ${n(Sm.exfan.L)} м³/ч с запасом ${Math.round((Sm.exfan.reserve - 1) * 100)} %, напор не менее ${Sm.exfan.dp} Па, около ${f(Sm.exfan.P)} кВт; гравитационные жалюзи; воздуховоды компрессоров подвести к вентиляторам; включение — автоматически по датчику температуры (в том числе при остановленных компрессорах)`,
      );
    else if (Sm && Sm.stand)
      t.push(
        `вытяжной вентилятор помещения с термостатом (при остановленных компрессорах) — ${n(Sm.stand.L)} м³/ч, напор не менее ${Sm.stand.dp} Па, решётка вверху на стене выброса`,
      );
    if (V.infan)
      t.push(
        `приточные вентиляторы (жалюзи притока целиком не встали) — ${V.infan.n} ${V.infan.n === 1 ? 'проём' : 'проёма(ов)'} внизу на стенах притока: ${n(V.infan.L)} м³/ч, напор не менее ${V.infan.dp} Па, около ${f(V.infan.P)} кВт; включение — автоматически по датчику температуры`,
      );
    if (!Sm || Sm.exfan) return t;
    if (Sm.boost)
      t.push(
        `в воздуховоде выброса компрессора — канальный вентилятор ${n(Sm.boost.L)} м³/ч, напор не менее ${Sm.boost.dp} Па, около ${f(Sm.boost.P)} кВт, с термостатом`,
      );
    else if (Sm.units.length)
      t.push(
        `жалюзи выброса — с малым сопротивлением: воздуховод компрессора с жалюзи — не более ${Sm.ductDp} Па (штатный вентилятор компрессора; проверить по паспорту)`,
      );
    return t;
  }

  static _rad(V) {
    const n = this.N;
    if (V.rad.n > 1) {
      const own = { louvers: V.louvers.filter(q => q.kind === 'rad').map(q => ({ ...q, kind: 'x' })), size: {} };
      return `радиаторы ДГУ — ${n(V.rad.q)} м³/ч, у каждой ДГУ своя ${V.rad.door ? 'дверь-жалюзи' : 'решётка'} напротив радиатора ${StationVent.list(own, 'x')} и воздуховод от радиатора`;
    }
    return `радиатор ДГУ — ${n(V.rad.q)} м³/ч через ${V.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(V.rad.w)} × ${n(V.rad.h)} мм, воздуховод от радиатора`;
  }

  /** Без расчёта вентиляции: оценка по теплу компрессоров (нагрев воздуха на 10 °C) или паспорт ДГУ. */
  static _ventRough(v, plan) {
    const n = this.N;
    const items = plan.items || [];
    const heat = items.filter(i => i.kind === 'compressor' && i.kw > 0).reduce((s, i) => s + i.kw * 0.9, 0);
    if (heat > 0) {
      const m3 = Math.ceil((heat * 3600) / (1.2 * 1.005 * 10) / 100) * 100;
      return `${v}; тепло компрессоров — около ${n(heat)} кВт: расход — не менее ${n(m3)} м³/ч при нагреве воздуха на 10 °C (или горячий воздух компрессоров — воздуховодами наружу, по паспортам); зимой — рециркуляция, без переохлаждения`;
    }
    if (items.some(i => i.kind === 'dgu'))
      return `${v}; воздух на горение и охлаждение ДГУ — по паспорту ДГУ (жалюзи с электроприводом напротив радиатора, воздуховод радиатора)`;
    return null;
  }

  static _snow(v, plan) {
    return plan.vent && plan.vent.hood ? `${v}. По расчёту: ${StationVent.hoodText(plan.vent)}` : null;
  }

  static _snowOut(v, plan) {
    return plan.vent && plan.vent.hoodOut ? `${v}. По расчёту: ${StationVent.hoodText(plan.vent, 'out')}` : null;
  }

  static _rec(v, plan) {
    return `${v}: заслонка рециркуляции с электроприводом и термостатом на выбросе тёплого воздуха${(plan.items || []).some(i => i.kind === 'dgu') ? ' радиатора ДГУ' : ' компрессоров'}`;
  }

  static _light(v, plan) {
    return plan.light && plan.light.on ? StationLight.text(plan.light) : null;
  }

  static _power(v, plan) {
    return plan.sockets ? `${v}; ${StationSockets.text(plan.sockets)}` : null;
  }

  static _fire(v, plan) {
    return plan.fire && plan.fire.auto
      ? StationFire.autoText(plan.fire)
      : `${v}; по СП 485.1311500.2020, с выводом сигнала на пульт`;
  }

  static _ops(v) {
    return `${v}; по СП 484.1311500.2020`;
  }
}
