import { Mm } from '../layout/mm.js';
import { StationFire } from '../layout/station-fire.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLight } from '../layout/station-light.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationSockets } from '../layout/station-sockets.js';
import { StationVent } from '../layout/station-vent.js';

/** Системы контейнера для ТЗ: отопление и вентиляция — с мощностью и расходом по расчёту. */
export class TzSystems {
  static HANDLER = {
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

  /** Требование к системе id (v — её название); расчёта нет — само название. */
  static text(id, base, plan) {
    const found = Object.hasOwn(this.HANDLER, id) ? this[this.HANDLER[id]](base, plan) : null;
    return found === null ? base : found;
  }

  static _heat(base, plan) {
    const heat = plan.heat;
    if (!(heat && heat.n)) return null;
    const kw = StationHeat.kw;
    return `${base}: ${heat.n} × ${kw(heat.kw)} кВт = ${kw(heat.total)} кВт, места — по чертежу (раздел 5); внутри не ниже +${heat.tin} °C при ${StationNorms.deg(heat.tout)} снаружи — теплопотери ${kw(heat.qStop / 1000)} кВт при остановленном оборудовании, запас 10 %${this._heatRun(heat)}${heat.short ? '; мест у стен не хватает — недостающую мощность добавить тепловентилятором или обогревом пола' : ''}`;
  }

  static _heatRun(heat) {
    const kw = StationHeat.kw;
    if (!heat.base) return '';
    if (heat.qRun <= 0)
      return `; при работе тепла оборудования (${kw(heat.base.q / 1000)} кВт${heat.rec && heat.base.kind !== 'pump' ? ', с рециркуляцией' : ''}) достаточно — конвекторы отключаются терморегуляторами`;
    return `; при работе — дополнительно подогрев забираемого воздуха (${kw(heat.qRun / 1000)} кВт)`;
  }

  static _vent(base, plan) {
    return plan.vent ? this._ventCalc(base, plan) : this._ventRough(base, plan);
  }

  /** Вентиляция по расчёту: приток, выброс, маркизы, вентиляторы, радиаторы ДГУ, зима. */
  static _ventCalc(base, plan) {
    const vent = plan.vent;
    const heat = plan.heat;
    const lines = [this._in(vent)];
    if (vent.need.out) lines.push(this._out(vent));
    lines.push('приток и выброс — на разных стенах (не на одной стене)');
    if (vent.hood)
      lines.push(
        `на приточных жалюзи — маркизы (снегозащита) из оцинкованной стали: ${StationVent.hoodText(vent)}; ${StationVent.HOOD_WHAT}; в открытом положении фиксируются упорами`,
      );
    if (vent.hoodOut)
      lines.push(
        `на жалюзи выброса горячего воздуха — маркизы (по требованию): ${StationVent.hoodText(vent, 'out')}; открытые — горячий воздух уходит вниз, закрытые — защитный щит на проёме`,
      );
    lines.push(...this._fans(vent, heat.vent.sum));
    if (vent.rad) lines.push(this._rad(vent));
    const win = heat.vent.win;
    return `${base}; летом (до ${StationNorms.deg(heat.vent.tmax)}): ${lines.join('; ')}; скорость по рамке — приток ${Mm.dec(vent.vIn)} м/с (с запасом ${Math.round((vent.res - 1) * 100)} %), выброс ${Mm.dec(vent.vOut)} м/с, места — по чертежу; жалюзи с утеплёнными клапанами и электроприводами${win && !win.warm ? `; зимой клапаны прикрываются до ${win.open} % (минимальный воздухообмен ${Mm.text(win.Lw)} м³/ч)` : ''}`;
  }

  static _in(vent) {
    const where = StationVent.where(vent);
    return `приток ${Mm.text(vent.q.in)} м³/ч — жалюзи ${StationVent.list(vent, 'in')} внизу${where.in ? ` ${where.in}` : ''}, проёмы по рамке не менее ${Mm.dec(vent.need.in.gross)} м²`;
  }

  static _out(vent) {
    const roofs = StationVent.roofList(vent);
    const outWall = vent.louvers.some(louver => louver.kind === 'out') ? StationVent.list(vent, 'out') : '';
    const how = [
      outWall ? `жалюзи ${StationVent.outAt(vent, true)}` : '',
      roofs ? `через крышу (колпаки ${roofs})` : '',
    ]
      .filter(Boolean)
      .join(' и ');
    return `выброс горячего воздуха ${Mm.text(vent.q.out)} м³/ч — ${how}, по рамке не менее ${Mm.dec(vent.need.out.gross)} м²; компрессоры — воздуховодами с клапанами рециркуляции`;
  }

  /** Вентиляторы: вытяжные или стоянки, приточные, канальный в воздуховоде либо требование к сопротивлению жалюзи. */
  static _fans(vent, sum) {
    const lines = [];
    if (sum && sum.exfan)
      lines.push(
        `вытяжные вентиляторы (принудительный выброс горячего воздуха) — осевые настенные, вверху стены напротив притока, в проёмах выброса${vent.exfan ? ` (${vent.exfan.n} шт.)` : ''}: всего ${Mm.text(sum.exfan.L)} м³/ч с запасом ${Math.round((sum.exfan.reserve - 1) * 100)} %, напор не менее ${sum.exfan.dp} Па, около ${Mm.dec(sum.exfan.P)} кВт; гравитационные жалюзи; воздуховоды компрессоров подвести к вентиляторам; включение — автоматически по датчику температуры (в том числе при остановленных компрессорах)`,
      );
    else if (sum && sum.stand)
      lines.push(
        `вытяжной вентилятор помещения с термостатом (при остановленных компрессорах) — ${Mm.text(sum.stand.L)} м³/ч, напор не менее ${sum.stand.dp} Па, решётка вверху на стене выброса`,
      );
    if (vent.infan)
      lines.push(
        `приточные вентиляторы (жалюзи притока целиком не встали) — ${vent.infan.n} ${vent.infan.n === 1 ? 'проём' : 'проёма(ов)'} внизу на стенах притока: ${Mm.text(vent.infan.L)} м³/ч, напор не менее ${vent.infan.dp} Па, около ${Mm.dec(vent.infan.P)} кВт; включение — автоматически по датчику температуры`,
      );
    if (!sum || sum.exfan) return lines;
    if (sum.boost)
      lines.push(
        `в воздуховоде выброса компрессора — канальный вентилятор ${Mm.text(sum.boost.L)} м³/ч, напор не менее ${sum.boost.dp} Па, около ${Mm.dec(sum.boost.P)} кВт, с термостатом`,
      );
    else if (sum.units.length)
      lines.push(
        `жалюзи выброса — с малым сопротивлением: воздуховод компрессора с жалюзи — не более ${sum.ductDp} Па (штатный вентилятор компрессора; проверить по паспорту)`,
      );
    return lines;
  }

  static _rad(vent) {
    if (vent.rad.n > 1) {
      const own = {
        louvers: vent.louvers.filter(louver => louver.kind === 'rad').map(louver => ({ ...louver, kind: 'x' })),
        size: {},
      };
      return `радиаторы ДГУ — ${Mm.text(vent.rad.q)} м³/ч, у каждой ДГУ своя ${vent.rad.door ? 'дверь-жалюзи' : 'решётка'} напротив радиатора ${StationVent.list(own, 'x')} и воздуховод от радиатора`;
    }
    return `радиатор ДГУ — ${Mm.text(vent.rad.q)} м³/ч через ${vent.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${Mm.text(vent.rad.w)} × ${Mm.text(vent.rad.h)} мм, воздуховод от радиатора`;
  }

  /** Без расчёта вентиляции: оценка по теплу компрессоров (нагрев воздуха на 10 °C) или паспорт ДГУ. */
  static _ventRough(base, plan) {
    const items = plan.items || [];
    const heat = items.filter(i => i.kind === 'compressor' && i.kw > 0).reduce((total, i) => total + i.kw * 0.9, 0);
    if (heat > 0) {
      const flow = Math.ceil((heat * 3600) / (1.2 * 1.005 * 10) / 100) * 100;
      return `${base}; тепло компрессоров — около ${Mm.text(heat)} кВт: расход — не менее ${Mm.text(flow)} м³/ч при нагреве воздуха на 10 °C (или горячий воздух компрессоров — воздуховодами наружу, по паспортам); зимой — рециркуляция, без переохлаждения`;
    }
    if (items.some(i => i.kind === 'dgu'))
      return `${base}; воздух на горение и охлаждение ДГУ — по паспорту ДГУ (жалюзи с электроприводом напротив радиатора, воздуховод радиатора)`;
    return null;
  }

  static _snow(base, plan) {
    return plan.vent && plan.vent.hood ? `${base}. По расчёту: ${StationVent.hoodText(plan.vent)}` : null;
  }

  static _snowOut(base, plan) {
    return plan.vent && plan.vent.hoodOut ? `${base}. По расчёту: ${StationVent.hoodText(plan.vent, 'out')}` : null;
  }

  static _rec(base, plan) {
    return `${base}: заслонка рециркуляции с электроприводом и термостатом на выбросе тёплого воздуха${(plan.items || []).some(i => i.kind === 'dgu') ? ' радиатора ДГУ' : ' компрессоров'}`;
  }

  static _light(base, plan) {
    return plan.light && plan.light.on ? StationLight.text(plan.light) : null;
  }

  static _power(base, plan) {
    return plan.sockets ? `${base}; ${StationSockets.text(plan.sockets)}` : null;
  }

  static _fire(base, plan) {
    return plan.fire && plan.fire.auto
      ? StationFire.autoText(plan.fire)
      : `${base}; по СП 485.1311500.2020, с выводом сигнала на пульт`;
  }

  static _ops(base) {
    return `${base}; по СП 484.1311500.2020`;
  }
}
