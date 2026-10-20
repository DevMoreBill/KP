import { Mm } from './mm.js';
import { StationNorms } from './station-norms.js';
import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { VentPlan } from './vent-plan.js';

/** Жалюзи вентиляции по расчёту (VentPlan) и их описание словами для «Компоновки», ТЗ и КП. */
export class StationVent extends VentGrille {
  static _groupBy = (list, k) => {
    const map = new Map();
    for (const item of list) map.set(k(item), (map.get(k(item)) || 0) + 1);
    return [...map].map(([key, count]) => [count, ...key.split('×').map(Number)]);
  };

  static HOOD_WHAT =
    'маркиза — откидной козырёк на петлях над жалюзи: открыт — с раскрывающимися боковыми створками-ограничителями (воздух проходит только снизу, снег и дождь не задуваются), закрыт — закрывает проём жалюзи как защитный щит (перевозка, простой, непогода)';
  static WALL = { back: 'задней стене', front: 'стене прохода', left: 'торце у входа', right: 'дальнем торце' };

  static cog(plan, wall) {
    return VentPlan.cog(plan, wall);
  }

  /**
   * Второй ряд компрессоров — выброс в стену прохода, если приток весь встаёт на торцах, иначе через крышу; притока не
   * хватает при выбросе на стене — выброс компрессоров через крышу (исключение), если так не хватает меньше.
   */
  static calc(plan) {
    let first = StationVent.calc0(plan, true);
    if (
      first &&
      first.short.in > 0 &&
      first.louvers.some(louver => louver.kind === 'out' && louver.wall === 'front' && louver.duct)
    ) {
      const second = StationVent.calc0(plan, false);
      if (second.short.in < first.short.in) first = second;
    }
    if (!first || !(first.short.in > 0) || !Object.values(first.ducts || {}).includes('wall')) return first;
    const third = StationVent.calc0(plan, true, true);
    if (!third || third.short.in >= first.short.in) return first;
    third.roofWhy = `приточные жалюзи на стенах не помещались (не хватало ${Mm.dec(Math.round(first.short.in * 100) / 100)} м²): выброс компрессоров — через крышу, стена выброса — под приток`;
    return third;
  }

  static calc0(plan, front, roof = false) {
    return new VentPlan(plan, front, roof).run();
  }

  /** «2 × 1000 × 800 мм». */
  static text(size) {
    return size ? `${size.n > 1 ? `${size.n} × ` : ''}${Mm.text(size.w)} × ${Mm.text(size.h)} мм` : '';
  }

  /** Жалюзи вида kind по размерам: «2 × 1400 × 1000 мм + 900 × 1000 мм»; больше max разных — «7 шт., 9,4 м² по рамке». */
  static list(vent, kind, wall, max = 0) {
    const list = vent.louvers.filter(louver => louver.kind === kind && (!wall || louver.wall === wall));
    if (!list.length) return wall ? '' : StationVent.text(vent.size[kind]);
    const groups = StationVent._groupBy(list, louver => `${louver.w}×${louver.h}`);
    if (max && groups.length > max)
      return `${list.length} шт., ${Mm.dec(Math.round(list.reduce((acc, louver) => acc + louver.w * louver.h, 0) / 1e4) / 100)} м² по рамке`;
    return groups.map(([count, width, height]) => StationVent.text({ n: count, w: width, h: height })).join(' + ');
  }

  /** Выброс через крышу: колпаки, размер проёма. */
  static roofList(vent) {
    return StationVent._groupBy(vent.roof || [], louver => `${louver.w}×${louver.l}`)
      .map(([count, width, len]) => StationVent.text({ n: count, w: width, h: len }))
      .join(' + ');
  }

  /** «радиатор ДГУ — в дальнем торце», «радиаторы ДГУ — в торце у входа и в дальнем торце». */
  static radAt(vent) {
    const list = (vent.rad && vent.rad.list) || [vent.rad];
    const walls = [...new Set(list.map(louver => louver.wall || 'right'))].map(wall => StationVent.WALL[wall]);
    return `${list.length > 1 ? 'радиаторы ДГУ' : 'радиатор ДГУ'} — в ${walls.join(' и в ')}`;
  }

  /** Радиаторы ДГУ для замечания: расход, двери-жалюзи, живое сечение и скорость каждой. */
  static radText(vent) {
    const list = vent.rad.list || [vent.rad];
    const wallOf = louver => StationVent.WALL[louver.wall || 'right'];
    if (list.length === 1) {
      const louver = list[0];
      return `радиатор ДГУ — ${Mm.text(vent.rad.q)} м³/ч через ${louver.door ? 'дверь-жалюзи' : 'жалюзи'} ${Mm.text(louver.w)} × ${Mm.text(louver.h)} мм в ${wallOf(louver)} (живое сечение ${Mm.dec(louver.free)} м², ${Mm.dec(louver.v)} м/с)`;
    }
    const each = list
      .map(
        louver =>
          `${Mm.text(louver.q)} м³/ч через ${Mm.text(louver.w)} × ${Mm.text(louver.h)} мм в ${wallOf(louver)} (${Mm.dec(louver.v)} м/с)`,
      )
      .join('; ');
    return `радиаторы ДГУ — ${Mm.text(vent.rad.q)} м³/ч, у каждой ДГУ своя ${list.every(louver => louver.door) ? 'дверь-жалюзи' : 'решётка'} напротив радиатора: ${each}`;
  }

  /** Где жалюзи выброса (без крыши); sizes — с размерами по местам. */
  static outAt(vent, sizes = false) {
    const outs = vent.louvers.filter(louver => louver.kind === 'out');
    const part = (text, list) =>
      list.length ? [text + (sizes ? ` ${StationVent.list({ louvers: list, size: {} }, 'out')}` : '')] : [];
    const low = outs.filter(louver => !louver.over);
    const walls = [...new Set(low.map(louver => louver.wall))];
    return [
      ...part(
        'над сервисными воротами',
        outs.filter(louver => louver.over),
      ),
      ...walls.flatMap(wall =>
        part(
          `вверху в ${StationVent.WALL[wall]}`,
          low.filter(louver => louver.wall === wall),
        ),
      ),
    ].join(', ');
  }

  /** Где приток и где выброс — словами. */
  static where(vent) {
    const intake = vent.louvers.filter(louver => louver.kind === 'in');
    const walls = [...new Set(intake.filter(louver => !louver.leaf).map(louver => StationVent.WALL[louver.wall]))];
    const inText = [
      ...walls.map(wall => `в ${wall}`),
      ...(intake.some(louver => louver.leaf) ? ['в створках ворот и сервисных дверей'] : []),
    ].join(', ');
    const outAt = StationVent.outAt(vent);
    const outText = [
      ...(outAt ? [outAt] : []),
      ...((vent.roof || []).length ? ['через крышу'] : []),
      ...(vent.rad ? [StationVent.radAt(vent)] : []),
    ].join(', ');
    return { in: inText, out: outText };
  }

  /** Маркизы словами: «2 × 1 660 × 1 300 мм, открыты на 45° — вылет 920 мм (воздух входит снизу — до 1,42 м/с, не более 1,5 м/с)». */
  static hoodText(vent, kind = 'in') {
    const intake = vent.louvers.filter(louver => louver.kind === kind && louver.hood);
    if (!intake.length) return '';
    const lim = kind === 'in' ? StationVent.HOOD_V : vent.face;
    const vmax = Math.max(...intake.map(louver => louver.hood.v));
    const depths = intake.map(louver => louver.hood.d);
    const [minD, maxD] = [Math.min(...depths), Math.max(...depths)];
    const sizes = StationVent._groupBy(intake, louver => `${louver.hood.w}×${louver.hood.l}`)
      .map(([count, width, len]) => `${count > 1 ? `${count} × ` : ''}${Mm.text(width)} × ${Mm.text(len)} мм`)
      .join(' + ');
    const how = kind === 'in' ? 'воздух входит снизу' : 'горячий воздух выходит вниз';
    return `${sizes}, открыты на ${intake[0].hood.a}° — вылет ${minD === maxD ? '' : 'до '}${Mm.text(maxD)} мм (${how} — до ${Mm.dec(vmax)} м/с, ${vmax > lim + 0.005 ? 'больше нормы' : 'не более'} ${Mm.dec(lim)} м/с)`;
  }

  /** Замечания «Компоновки»: расходы, сечения, размеры, где приток и выброс; рециркуляция; зима; не поместилось. */
  static notes(plan) {
    const vent = plan.vent;
    if (!vent) return;
    const heatVent = plan.heat && plan.heat.vent;
    const iss = plan.issues;
    iss.push({ level: 'info', text: StationVent.summer(vent, heatVent) });
    StationVent.fans(vent, heatVent, iss);
    StationVent.winter(plan, heatVent, iss);
    for (const warn of (heatVent && heatVent.warn) || []) if (!iss.some(i => i.text === warn.text)) iss.push(warn);
    StationVent.recirc(plan, vent, iss);
    StationVent.shortages(vent, iss);
  }

  static summer(vent, heatVent) {
    const summary = heatVent && heatVent.sum;
    const tmax = heatVent ? StationNorms.deg(heatVent.tmax) : '';
    const where = StationVent.where(vent);
    const cfm = louver => (summary ? ` (${Mm.text(VentCalc.cfm(louver))} CFM)` : '');
    const lines = [
      `приток ${Mm.text(vent.q.in)} м³/ч${cfm(vent.q.in)} — проёмы по рамке не менее ${Mm.dec(vent.need.in.gross)} м² (${Mm.dec(vent.vIn)} м/с, запас ${Math.round((vent.res - 1) * 100)} %), жалюзи ${StationVent.list(vent, 'in') || 'по месту'}${where.in ? ` — ${where.in}` : ''}`,
    ];
    if (vent.need.out) lines.push(StationVent.outText(vent, cfm));
    if (vent.rad) lines.push(StationVent.radText(vent));
    const comp = summary && summary.units.length ? StationVent.compText(summary, vent) : '';
    return `Вентиляция летом${tmax ? ` (до ${tmax})` : ''}: ${lines.join('; ')}.${comp} Приток и выброс — на разных стенах; размеры — по рамке (в живом сечении решётки скорость выше), места жалюзи — на чертеже и 3D-виде.`;
  }

  static outText(vent, cfm) {
    const wallText = vent.louvers.some(louver => louver.kind === 'out') ? StationVent.list(vent, 'out') : '';
    const roofText = StationVent.roofList(vent);
    const where = [
      wallText ? `жалюзи ${StationVent.outAt(vent, true)}` : '',
      roofText ? `через крышу — колпаки ${roofText}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `выброс горячего воздуха ${Mm.text(vent.q.out)} м³/ч${cfm(vent.q.out)} — не менее ${Mm.dec(vent.need.out.gross)} м² (${Mm.dec(vent.vOut)} м/с): ${where}`;
  }

  static compText(summary, vent) {
    const head = ` Тепло компрессоров ${Mm.dec(summary.Qc)} кВт (N·k или паспорт); воздух охлаждения ${Mm.text(summary.Lcool)} м³/ч — вентилятором компрессора (нагрев в нём ${Mm.dec(summary.dtc)} °C, паспорт важнее), горячий — воздуховодом наружу; тот же поток продувает помещение — у входа компрессора около ${VentCalc.dec(summary.tComp)} °C (не выше ${Mm.dec(summary.tIn)} °C).`;
    let stand = '';
    if (summary.stand) {
      stand = summary.exfan
        ? ' При остановленных компрессорах помещение продувают те же вытяжные вентиляторы (по датчику температуры).'
        : ` При остановленных компрессорах — вытяжной вентилятор с термостатом ${Mm.text(summary.stand.L)} м³/ч (около ${Mm.dec(summary.stand.P)} кВт) — прямо на канале общей вытяжки рядом с осушителем.`;
    }
    return head + stand + StationVent.fanText(summary, vent);
  }

  static fanText(summary, vent) {
    if (summary.exfan) {
      return ` Вытяжные вентиляторы — вверху стены напротив притока (осевые, с гравитационными жалюзи, включаются автоматически по датчику температуры): ${Mm.text(summary.exfan.L)} м³/ч (запас ${Math.round((summary.exfan.reserve - 1) * 100)} %)${vent.exfan ? ` в ${vent.exfan.n} ${vent.exfan.n === 1 ? 'проёме' : 'проёмах'}` : ''}, напор не менее ${summary.exfan.dp} Па, около ${Mm.dec(summary.exfan.P)} кВт; воздуховоды компрессоров подведены к ним.`;
    }
    if (summary.boost)
      return ` Вентилятор в воздуховоде выброса: ${Mm.text(summary.boost.L)} м³/ч, напор не менее ${summary.boost.dp} Па, около ${Mm.dec(summary.boost.P)} кВт.`;
    return ` Жалюзи выброса — с малым сопротивлением: воздуховод с жалюзи не более ${summary.ductDp} Па (штатный вентилятор компрессора).`;
  }

  /** Приточные вентиляторы; выброс компрессоров через крышу — исключение. */
  static fans(vent, heatVent, iss) {
    const summary = heatVent && heatVent.sum;
    if (vent.infan) {
      const inFan = vent.infan;
      iss.push({
        level: 'info',
        text: `Приточные вентиляторы: приточные жалюзи целиком не встали — ${inFan.n} ${inFan.n === 1 ? 'проём' : 'проёма(ов)'} с осевыми вентиляторами на ${Mm.text(inFan.q)} м³/ч (с запасом ${Mm.text(inFan.L)} м³/ч, ${Mm.dec(inFan.v)} м/с по рамке, напор не менее ${inFan.dp} Па, около ${Mm.dec(inFan.P)} кВт); включаются автоматически по датчику температуры.`,
      });
    }
    const viaRoof = Object.values(vent.ducts || {}).filter(target => target === 'roof').length;
    if (viaRoof && summary && summary.units.length) {
      iss.push({
        level: 'info',
        text: `Выброс горячего воздуха ${viaRoof > 1 ? `всех ${viaRoof} компрессоров` : 'компрессора'} — через крышу, каналы одного размера: над воротами места нет, а в торце выброс невозможен (компрессор не у торца или в торце ворота).`,
      });
    }
  }

  /** Зима: баланс тепла при работе и открытие регулируемых жалюзи; рекуператор — по требованию заказчика. */
  static winter(plan, heatVent, iss) {
    const winter = heatVent && heatVent.win;
    const recup = heatVent && heatVent.rec;
    if (winter && !winter.warm) {
      const items = plan.items || [];
      let who = 'агрегата';
      if (items.some(i => i.kind === 'dgu')) who = 'агрегата (ДГУ)';
      else if (items.some(i => i.kind === 'compressor')) who = 'компрессора';
      const bal =
        winter.bal >= 0
          ? `профицит ${Mm.dec(winter.bal)} кВт, достаточно частичной рециркуляции`
          : `дефицит ${Mm.dec(-winter.bal)} кВт — подогрев`;
      iss.push({
        level: 'info',
        text: `Вентиляция зимой (${StationNorms.deg(winter.tWin)}): потери ограждений ${Mm.dec(winter.Qenv)} кВт + минимальный воздухообмен ${Mm.text(winter.Lw)} м³/ч — ${Mm.dec(winter.Qvent)} кВт; тепло работающего ${who} ${Mm.dec(winter.Qrun)} кВт — ${bal}. Регулируемые жалюзи зимой открыты на ${winter.open} % (нужно ${Mm.dec(winter.ratio)} % летнего расхода).`,
      });
    }
    if (recup && recup.on) iss.push(StationVent.recup(recup));
  }

  static recup(recup) {
    const protect = recup.measures.length ? `; защита от обмерзания: ${recup.measures.join(', ')}` : '';
    return {
      level: recup.frost ? 'warn' : 'info',
      text: `Рекуператор (по требованию заказчика): ${VentCalc.TYPES[recup.type]}, КПД ${Mm.dec(recup.eta)}; приток после него ${recup.tAfter > 0 ? '+' : ''}${VentCalc.dec(recup.tAfter)} °C; экономия ${Mm.dec(recup.Q)} кВт при расчётной зимней, за отопительный период около ${Mm.text(recup.year)} кВт·ч${protect}.`,
    };
  }

  static recirc(plan, vent, iss) {
    const ducts = Object.keys(vent.ducts || {}).length;
    if (!(ducts || vent.rad) || (plan.sys || {}).rec === false) return;
    const what = [
      ducts ? 'на воздуховодах компрессоров — клапаны рециркуляции с электроприводом и термостатом' : '',
      vent.rad ? 'у радиатора ДГУ — заслонка рециркуляции' : '',
    ]
      .filter(Boolean)
      .join(', ');
    iss.push({
      level: 'info',
      text: `Рециркуляция тепла: ${what}: зимой горячий воздух — в помещение (отопление без конвекторов при работе), летом — наружу.`,
    });
  }

  /** Не поместилось, маркизы, скорость через радиатор ДГУ. */
  static shortages(vent, iss) {
    if (vent.short.out > 0) {
      iss.push({
        level: 'warn',
        text: `Не поместилось колпаков выброса на крыше на ${Mm.dec(vent.short.out)} м² (по рамке): крыша занята глушителем и другими колпаками — примите выброс общим коробом или увеличьте контейнер.`,
      });
    }
    if (vent.hood) {
      const over = vent.hood.over
        ? ' Скорость на входе больше нормы и при наибольшем угле открытия — увеличьте приточные жалюзи (шире).'
        : '';
      iss.push({
        level: vent.hood.over ? 'warn' : 'info',
        text: `Маркизы на приточных жалюзи (снегозащита): ${StationVent.hoodText(vent)}; ${StationVent.HOOD_WHAT}.${over}`,
      });
    }
    if (vent.hoodOut) {
      const over = vent.hoodOut.over
        ? ' Выход под маркизой меньше живого сечения жалюзи — увеличьте жалюзи выброса.'
        : '';
      iss.push({
        level: vent.hoodOut.over ? 'warn' : 'info',
        text: `Маркизы на жалюзи выброса горячего воздуха (по требованию): ${StationVent.hoodText(vent, 'out')}; открытые — горячий воздух уходит вниз, закрытые — защитный щит на проёме.${over}`,
      });
    }
    if (vent.short.in > 0) {
      iss.push({
        level: 'warn',
        text: `Не поместилось приточных жалюзи на ${Mm.dec(vent.short.in)} м² (по рамке): стена напротив выброса, створки ворот и свободные стены заняты дверями, шкафами и конвекторами — освободите место на стене или примите приток воздуховодом через крышу.`,
      });
    }
    if (vent.rad && vent.rad.v > StationVent.RAD_V) {
      iss.push({
        level: 'warn',
        text: `Через жалюзи радиатора ДГУ скорость воздуха около ${Mm.dec(vent.rad.v)} м/с — больше ${Mm.dec(StationVent.RAD_V)} м/с: проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление) или увеличьте проём.`,
      });
    }
  }
}
