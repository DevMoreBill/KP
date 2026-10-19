import { Mm } from './mm.js';
import { StationNorms } from './station-norms.js';
import { VentCalc } from './vent-calc.js';
import { VentGrille } from './vent-grille.js';
import { VentPlan } from './vent-plan.js';

const n = v => Mm.text(v);
const f = v => String(v).replace('.', ',');
const groupBy = (L, k) => {
  const g = new Map();
  for (const q of L) g.set(k(q), (g.get(k(q)) || 0) + 1);
  return [...g].map(([s, c]) => [c, ...s.split('×').map(Number)]);
};

/** Жалюзи вентиляции по расчёту (VentPlan) и их описание словами для «Компоновки», ТЗ и КП. */
export class StationVent extends VentGrille {
  static HOOD_WHAT =
    'маркиза — откидной козырёк на петлях над жалюзи: открыт — с раскрывающимися боковыми створками-ограничителями (воздух проходит только снизу, снег и дождь не задуваются), закрыт — закрывает проём жалюзи как защитный щит (перевозка, простой, непогода)';
  static WALL = { back: 'задней стене', front: 'стене прохода', left: 'торце у входа', right: 'дальнем торце' };

  static cog(plan, w) {
    return VentPlan.cog(plan, w);
  }

  /**
   * Второй ряд компрессоров — выброс в стену прохода, если приток весь встаёт на торцах, иначе через крышу; притока не
   * хватает при выбросе на стене — выброс компрессоров через крышу (исключение), если так не хватает меньше.
   */
  static calc(plan) {
    let a = StationVent.calc0(plan, true);
    if (a && a.short.in > 0 && a.louvers.some(q => q.kind === 'out' && q.wall === 'front' && q.duct)) {
      const b = StationVent.calc0(plan, false);
      if (b.short.in < a.short.in) a = b;
    }
    if (!a || !(a.short.in > 0) || !Object.values(a.ducts || {}).includes('wall')) return a;
    const c = StationVent.calc0(plan, true, true);
    if (!c || c.short.in >= a.short.in) return a;
    c.roofWhy = `приточные жалюзи на стенах не помещались (не хватало ${f(Math.round(a.short.in * 100) / 100)} м²): выброс компрессоров — через крышу, стена выброса — под приток`;
    return c;
  }

  static calc0(plan, front, roof = false) {
    return new VentPlan(plan, front, roof).run();
  }

  /** «2 × 1000 × 800 мм». */
  static text(sz) {
    return sz ? `${sz.n > 1 ? `${sz.n} × ` : ''}${n(sz.w)} × ${n(sz.h)} мм` : '';
  }

  /** Жалюзи вида kind по размерам: «2 × 1400 × 1000 мм + 900 × 1000 мм»; больше max разных — «7 шт., 9,4 м² по рамке». */
  static list(V, kind, wall, max = 0) {
    const L = V.louvers.filter(q => q.kind === kind && (!wall || q.wall === wall));
    if (!L.length) return wall ? '' : StationVent.text(V.size[kind]);
    const g = groupBy(L, q => `${q.w}×${q.h}`);
    if (max && g.length > max)
      return `${L.length} шт., ${f(Math.round(L.reduce((s, q) => s + q.w * q.h, 0) / 1e4) / 100)} м² по рамке`;
    return g.map(([c, w, h]) => StationVent.text({ n: c, w, h })).join(' + ');
  }

  /** Выброс через крышу: колпаки, размер проёма. */
  static roofList(V) {
    return groupBy(V.roof || [], q => `${q.w}×${q.l}`)
      .map(([c, w, l]) => StationVent.text({ n: c, w, h: l }))
      .join(' + ');
  }

  /** «радиатор ДГУ — в дальнем торце», «радиаторы ДГУ — в торце у входа и в дальнем торце». */
  static radAt(V) {
    const L = (V.rad && V.rad.list) || [V.rad];
    const ws = [...new Set(L.map(q => q.wall || 'right'))].map(w => StationVent.WALL[w]);
    return `${L.length > 1 ? 'радиаторы ДГУ' : 'радиатор ДГУ'} — в ${ws.join(' и в ')}`;
  }

  /** Радиаторы ДГУ для замечания: расход, двери-жалюзи, живое сечение и скорость каждой. */
  static radText(V) {
    const L = V.rad.list || [V.rad];
    const at = q => StationVent.WALL[q.wall || 'right'];
    if (L.length === 1) {
      const q = L[0];
      return `радиатор ДГУ — ${n(V.rad.q)} м³/ч через ${q.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(q.w)} × ${n(q.h)} мм в ${at(q)} (живое сечение ${f(q.free)} м², ${f(q.v)} м/с)`;
    }
    const each = L.map(q => `${n(q.q)} м³/ч через ${n(q.w)} × ${n(q.h)} мм в ${at(q)} (${f(q.v)} м/с)`).join('; ');
    return `радиаторы ДГУ — ${n(V.rad.q)} м³/ч, у каждой ДГУ своя ${L.every(q => q.door) ? 'дверь-жалюзи' : 'решётка'} напротив радиатора: ${each}`;
  }

  /** Где жалюзи выброса (без крыши); sizes — с размерами по местам. */
  static outAt(V, sizes = false) {
    const O = V.louvers.filter(q => q.kind === 'out');
    const part = (t, L) =>
      L.length ? [t + (sizes ? ` ${StationVent.list({ louvers: L, size: {} }, 'out')}` : '')] : [];
    const R = O.filter(q => !q.over);
    const ws = [...new Set(R.map(q => q.wall))];
    return [
      ...part(
        'над сервисными воротами',
        O.filter(q => q.over),
      ),
      ...ws.flatMap(w =>
        part(
          `вверху в ${StationVent.WALL[w]}`,
          R.filter(q => q.wall === w),
        ),
      ),
    ].join(', ');
  }

  /** Где приток и где выброс — словами. */
  static where(V) {
    const I = V.louvers.filter(q => q.kind === 'in');
    const ws = [...new Set(I.filter(q => !q.leaf).map(q => StationVent.WALL[q.wall]))];
    const a = [...ws.map(w => `в ${w}`), ...(I.some(q => q.leaf) ? ['в створках ворот и сервисных дверей'] : [])].join(
      ', ',
    );
    const oa = StationVent.outAt(V);
    const b = [
      ...(oa ? [oa] : []),
      ...((V.roof || []).length ? ['через крышу'] : []),
      ...(V.rad ? [StationVent.radAt(V)] : []),
    ].join(', ');
    return { in: a, out: b };
  }

  /** Маркизы словами: «2 × 1 660 × 1 300 мм, открыты на 45° — вылет 920 мм (воздух входит снизу — до 1,42 м/с, не более 1,5 м/с)». */
  static hoodText(V, kind = 'in') {
    const I = V.louvers.filter(q => q.kind === kind && q.hood);
    if (!I.length) return '';
    const lim = kind === 'in' ? StationVent.HOOD_V : V.face;
    const vmax = Math.max(...I.map(q => q.hood.v));
    const D = I.map(q => q.hood.d);
    const [d0, d1] = [Math.min(...D), Math.max(...D)];
    const sizes = groupBy(I, q => `${q.hood.w}×${q.hood.l}`)
      .map(([c, w, l]) => `${c > 1 ? `${c} × ` : ''}${n(w)} × ${n(l)} мм`)
      .join(' + ');
    const how = kind === 'in' ? 'воздух входит снизу' : 'горячий воздух выходит вниз';
    return `${sizes}, открыты на ${I[0].hood.a}° — вылет ${d0 === d1 ? '' : 'до '}${n(d1)} мм (${how} — до ${f(vmax)} м/с, ${vmax > lim + 0.005 ? 'больше нормы' : 'не более'} ${f(lim)} м/с)`;
  }

  /** Замечания «Компоновки»: расходы, сечения, размеры, где приток и выброс; рециркуляция; зима; не поместилось. */
  static notes(plan) {
    const V = plan.vent;
    if (!V) return;
    const H = plan.heat && plan.heat.vent;
    const iss = plan.issues;
    iss.push({ level: 'info', text: StationVent.summer(V, H) });
    StationVent.fans(V, H, iss);
    StationVent.winter(plan, H, iss);
    for (const w of (H && H.warn) || []) if (!iss.some(i => i.text === w.text)) iss.push(w);
    StationVent.recirc(plan, V, iss);
    StationVent.shortages(V, iss);
  }

  static summer(V, H) {
    const Sm = H && H.sum;
    const tm = H ? StationNorms.deg(H.tmax) : '';
    const wh = StationVent.where(V);
    const cfm = q => (Sm ? ` (${n(VentCalc.cfm(q))} CFM)` : '');
    const t = [
      `приток ${n(V.q.in)} м³/ч${cfm(V.q.in)} — проёмы по рамке не менее ${f(V.need.in.gross)} м² (${f(V.vIn)} м/с, запас ${Math.round((V.res - 1) * 100)} %), жалюзи ${StationVent.list(V, 'in') || 'по месту'}${wh.in ? ` — ${wh.in}` : ''}`,
    ];
    if (V.need.out) t.push(StationVent.outText(V, cfm));
    if (V.rad) t.push(StationVent.radText(V));
    const comp = Sm && Sm.units.length ? StationVent.compText(Sm, V) : '';
    return `Вентиляция летом${tm ? ` (до ${tm})` : ''}: ${t.join('; ')}.${comp} Приток и выброс — на разных стенах; размеры — по рамке (в живом сечении решётки скорость выше), места жалюзи — на чертеже и 3D-виде.`;
  }

  static outText(V, cfm) {
    const w = V.louvers.some(q => q.kind === 'out') ? StationVent.list(V, 'out') : '';
    const rf = StationVent.roofList(V);
    const where = [w ? `жалюзи ${StationVent.outAt(V, true)}` : '', rf ? `через крышу — колпаки ${rf}` : '']
      .filter(Boolean)
      .join(', ');
    return `выброс горячего воздуха ${n(V.q.out)} м³/ч${cfm(V.q.out)} — не менее ${f(V.need.out.gross)} м² (${f(V.vOut)} м/с): ${where}`;
  }

  static compText(Sm, V) {
    const head = ` Тепло компрессоров ${f(Sm.Qc)} кВт (N·k или паспорт); воздух охлаждения ${n(Sm.Lcool)} м³/ч — вентилятором компрессора (нагрев в нём ${f(Sm.dtc)} °C, паспорт важнее), горячий — воздуховодом наружу; тот же поток продувает помещение — у входа компрессора около ${VentCalc.f(Sm.tComp)} °C (не выше ${f(Sm.tIn)} °C).`;
    let stand = '';
    if (Sm.stand) {
      stand = Sm.exfan
        ? ' При остановленных компрессорах помещение продувают те же вытяжные вентиляторы (по датчику температуры).'
        : ` При остановленных компрессорах — вытяжной вентилятор с термостатом ${n(Sm.stand.L)} м³/ч (около ${f(Sm.stand.P)} кВт) — прямо на канале общей вытяжки рядом с осушителем.`;
    }
    return head + stand + StationVent.fanText(Sm, V);
  }

  static fanText(Sm, V) {
    if (Sm.exfan) {
      return ` Вытяжные вентиляторы — вверху стены напротив притока (осевые, с гравитационными жалюзи, включаются автоматически по датчику температуры): ${n(Sm.exfan.L)} м³/ч (запас ${Math.round((Sm.exfan.reserve - 1) * 100)} %)${V.exfan ? ` в ${V.exfan.n} ${V.exfan.n === 1 ? 'проёме' : 'проёмах'}` : ''}, напор не менее ${Sm.exfan.dp} Па, около ${f(Sm.exfan.P)} кВт; воздуховоды компрессоров подведены к ним.`;
    }
    if (Sm.boost)
      return ` Вентилятор в воздуховоде выброса: ${n(Sm.boost.L)} м³/ч, напор не менее ${Sm.boost.dp} Па, около ${f(Sm.boost.P)} кВт.`;
    return ` Жалюзи выброса — с малым сопротивлением: воздуховод с жалюзи не более ${Sm.ductDp} Па (штатный вентилятор компрессора).`;
  }

  /** Приточные вентиляторы; выброс компрессоров через крышу — исключение. */
  static fans(V, H, iss) {
    const Sm = H && H.sum;
    if (V.infan) {
      const q = V.infan;
      iss.push({
        level: 'info',
        text: `Приточные вентиляторы: приточные жалюзи целиком не встали — ${q.n} ${q.n === 1 ? 'проём' : 'проёма(ов)'} с осевыми вентиляторами на ${n(q.q)} м³/ч (с запасом ${n(q.L)} м³/ч, ${f(q.v)} м/с по рамке, напор не менее ${q.dp} Па, около ${f(q.P)} кВт); включаются автоматически по датчику температуры.`,
      });
    }
    const viaRoof = Object.values(V.ducts || {}).filter(t => t === 'roof').length;
    if (viaRoof && Sm && Sm.units.length) {
      iss.push({
        level: 'info',
        text: `Выброс горячего воздуха ${viaRoof > 1 ? `всех ${viaRoof} компрессоров` : 'компрессора'} — через крышу, каналы одного размера: над воротами места нет, а в торце выброс невозможен (компрессор не у торца или в торце ворота).`,
      });
    }
  }

  /** Зима: баланс тепла при работе и открытие регулируемых жалюзи; рекуператор — по требованию заказчика. */
  static winter(plan, H, iss) {
    const Wn = H && H.win;
    const Rc = H && H.rec;
    if (Wn && !Wn.warm) {
      const I = plan.items || [];
      let who = 'агрегата';
      if (I.some(i => i.kind === 'dgu')) who = 'агрегата (ДГУ)';
      else if (I.some(i => i.kind === 'compressor')) who = 'компрессора';
      const bal =
        Wn.bal >= 0
          ? `профицит ${f(Wn.bal)} кВт, достаточно частичной рециркуляции`
          : `дефицит ${f(-Wn.bal)} кВт — подогрев`;
      iss.push({
        level: 'info',
        text: `Вентиляция зимой (${StationNorms.deg(Wn.tWin)}): потери ограждений ${f(Wn.Qenv)} кВт + минимальный воздухообмен ${n(Wn.Lw)} м³/ч — ${f(Wn.Qvent)} кВт; тепло работающего ${who} ${f(Wn.Qrun)} кВт — ${bal}. Регулируемые жалюзи зимой открыты на ${Wn.open} % (нужно ${f(Wn.ratio)} % летнего расхода).`,
      });
    }
    if (Rc && Rc.on) iss.push(StationVent.recup(Rc));
  }

  static recup(Rc) {
    const protect = Rc.measures.length ? `; защита от обмерзания: ${Rc.measures.join(', ')}` : '';
    return {
      level: Rc.frost ? 'warn' : 'info',
      text: `Рекуператор (по требованию заказчика): ${VentCalc.TYPES[Rc.type]}, КПД ${f(Rc.eta)}; приток после него ${Rc.tAfter > 0 ? '+' : ''}${VentCalc.f(Rc.tAfter)} °C; экономия ${f(Rc.Q)} кВт при расчётной зимней, за отопительный период около ${n(Rc.year)} кВт·ч${protect}.`,
    };
  }

  static recirc(plan, V, iss) {
    const ducts = Object.keys(V.ducts || {}).length;
    if (!(ducts || V.rad) || (plan.sys || {}).rec === false) return;
    const what = [
      ducts ? 'на воздуховодах компрессоров — клапаны рециркуляции с электроприводом и термостатом' : '',
      V.rad ? 'у радиатора ДГУ — заслонка рециркуляции' : '',
    ]
      .filter(Boolean)
      .join(', ');
    iss.push({
      level: 'info',
      text: `Рециркуляция тепла: ${what}: зимой горячий воздух — в помещение (отопление без конвекторов при работе), летом — наружу.`,
    });
  }

  /** Не поместилось, маркизы, скорость через радиатор ДГУ. */
  static shortages(V, iss) {
    if (V.short.out > 0) {
      iss.push({
        level: 'warn',
        text: `Не поместилось колпаков выброса на крыше на ${f(V.short.out)} м² (по рамке): крыша занята глушителем и другими колпаками — примите выброс общим коробом или увеличьте контейнер.`,
      });
    }
    if (V.hood) {
      const over = V.hood.over
        ? ' Скорость на входе больше нормы и при наибольшем угле открытия — увеличьте приточные жалюзи (шире).'
        : '';
      iss.push({
        level: V.hood.over ? 'warn' : 'info',
        text: `Маркизы на приточных жалюзи (снегозащита): ${StationVent.hoodText(V)}; ${StationVent.HOOD_WHAT}.${over}`,
      });
    }
    if (V.hoodOut) {
      const over = V.hoodOut.over ? ' Выход под маркизой меньше живого сечения жалюзи — увеличьте жалюзи выброса.' : '';
      iss.push({
        level: V.hoodOut.over ? 'warn' : 'info',
        text: `Маркизы на жалюзи выброса горячего воздуха (по требованию): ${StationVent.hoodText(V, 'out')}; открытые — горячий воздух уходит вниз, закрытые — защитный щит на проёме.${over}`,
      });
    }
    if (V.short.in > 0) {
      iss.push({
        level: 'warn',
        text: `Не поместилось приточных жалюзи на ${f(V.short.in)} м² (по рамке): стена напротив выброса, створки ворот и свободные стены заняты дверями, шкафами и конвекторами — освободите место на стене или примите приток воздуховодом через крышу.`,
      });
    }
    if (V.rad && V.rad.v > StationVent.RAD_V) {
      iss.push({
        level: 'warn',
        text: `Через жалюзи радиатора ДГУ скорость воздуха около ${f(V.rad.v)} м/с — больше ${f(StationVent.RAD_V)} м/с: проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление) или увеличьте проём.`,
      });
    }
  }
}
