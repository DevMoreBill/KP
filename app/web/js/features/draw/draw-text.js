import { Mm } from '../layout/mm.js';
import { PressureVessel } from '../layout/pressure-vessel.js';
import { AirChain } from '../layout/air-chain.js';
import { StationClear } from '../layout/station-clear.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMass } from '../layout/station-mass.js';
import { StationMatrix } from '../layout/station-matrix.js';
import { StationMods } from '../layout/station-mods.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationVent } from '../layout/station-vent.js';

/** Текстовая часть чертежа: перечень, техническая характеристика, технические требования. */
export class DrawText {
  /** Сервисные ворота и двери: отметка → где и зачем. */
  static SERVICE = [
    [
      'both',
      'с обеих сторон компрессора (без продольного прохода) — для обслуживания спереди и сзади, монтажа и демонтажа',
    ],
    [true, 'в стене за оборудованием (стоит плотно к стене) — для обслуживания, монтажа и демонтажа'],
    [false, 'в боковой стене — для монтажа и демонтажа (к торцу не провезти)'],
  ];

  constructor(drawing) {
    this.drawing = drawing;
  }

  /** «поз. 1, 2, 3». */
  static list(positions) {
    return `поз. ${positions.join(', ')}`;
  }

  /** Номера позиций изделий плана, отобранных f, по возрастанию. */
  pos(test) {
    return [...new Set(this.drawing.plan.items.filter(test).map(i => i.pos))].sort((left, right) => left - right);
  }

  /** Перечень составных частей: позиция, наименование, количество, масса. */
  rows() {
    const byPos = new Map();
    for (const item of [...this.drawing.plan.items, ...this.drawing.outside, ...this.drawing.roofItems]) {
      const row = byPos.get(item.pos);
      if (row) row.n++;
      else byPos.set(item.pos, { pos: item.pos, name: item.brief || item.name, n: 1, mass: item.mass });
    }
    for (const pipe of this.drawing.pipes.filter(line => line.pos != null))
      byPos.set(pipe.pos, { pos: pipe.pos, name: pipe.brief || pipe.name, n: pipe.qty || 1, mass: null });
    return [...byPos.values()].sort((left, right) => left.pos - right.pos);
  }

  /** Техническая характеристика (ГОСТ 2.316): что известно о станции. */
  tech() {
    const { drawing } = this;
    const num = Mm.text;
    const air = drawing.plan.air;
    const out = [];
    if (air && air.q > 0)
      out.push(`Производительность — ${AirChain.flowText(air.q)} м³/мин при ${AirChain.flowText(air.bar)} бар`);
    if (air && air.cls) out.push(`Класс воздуха по ISO 8573-1 — ${air.cls}`);
    out.push(...this.power());
    if (drawing.mass) out.push(StationMass.text(drawing.mass));
    out.push(`Внутри — ${num(drawing.Li)} × ${num(drawing.Wi)} × ${num(drawing.Hi)} мм`);
    if (drawing.geo.t) out.push(`Утепление стен — ${num(drawing.geo.t)} мм`);
    if (drawing.rise) {
      const roof = StationGeo.ROOFS[drawing.geo.roof];
      out.push(`Крыша — ${roof.name}${roof.deg ? `, уклон ${roof.deg}°` : ''}`);
    }
    const col = String(drawing.meta.colorText || '').replace(/^цвет\s+/i, '');
    if (col) out.push(`Окраска — ${col}`);
    out.push(...StationNorms.tech(drawing.plan));
    return out;
  }

  /** Мощности и масса оборудования — если известны у всех. */
  power() {
    const num = Mm.text;
    const items = this.drawing.plan.items;
    const kw = k => {
      const list = items.filter(i => i.kind === k);
      return list.length && list.every(i => i.kw > 0) ? list.reduce((sum, i) => sum + i.kw, 0) : 0;
    };
    const motorKw = kw('compressor') + kw('pump');
    const dguKw = kw('dgu');
    const all = [...items, ...this.drawing.outside, ...this.drawing.roofItems];
    const mass = all.every(i => i.mass > 0) ? all.reduce((sum, i) => sum + i.mass, 0) : 0;
    return [
      motorKw ? `Мощность электродвигателей — ${num(motorKw)} кВт` : '',
      dguKw ? `Мощность ДГУ — ${num(dguKw)} кВт` : '',
      mass ? `Масса оборудования — ${num(mass)} кг` : '',
    ].filter(Boolean);
  }

  /** Технические требования: коротко, номерами пунктов. */
  reqs() {
    const plan = this.drawing.plan;
    return [
      'Размеры, привязки и трассы уточняются рабочим проектом.',
      this.guessed(),
      this.aisle(),
      this.cabinets(),
      this.air(),
      this.entry(),
      this.second(),
      ...this.drawing.gates.map(gate => this.gate(gate)),
      ...DrawText.SERVICE.map(([rear, text]) => this.service(rear, text)),
      ...DrawText.modsText(plan),
      ...DrawText.dguDoorsText(this.drawing.dguDoors),
      ...this.exhaust(),
      this.outside(),
      this.fuel(),
      ...DrawText.heat(plan),
      ...DrawText.vessels(plan),
      ...StationNorms.techReqs(plan),
      ...DrawText.lift(plan, this.drawing.slingNo || 3),
      this.hidden(),
    ].filter(Boolean);
  }

  /** Габариты угаданы — уточнить по паспорту. */
  guessed() {
    const guessed = [
      ...new Set(
        [...this.drawing.plan.items, ...this.drawing.outside]
          .filter(i => i.known === false && i.pos != null)
          .map(i => i.pos),
      ),
    ];
    if (!guessed.length) return '';
    return `Габариты ${DrawText.list(guessed.sort((left, right) => left - right))} — условные (данных изготовителя нет): уточнить по паспорту до изготовления.`;
  }

  /** Проход обслуживания: ширина по правилу и фактическая. */
  aisle() {
    const plan = this.drawing.plan;
    const num = Mm.text;
    const [aRec, aMin] = plan.aisleRule || StationClear.aisle();
    if (plan.mode && plan.mode.tight)
      return `Проход для оператора и обслуживания — ${num((plan.aisle && plan.aisle.w) || aMin)} мм в свету: сужен по согласованию с заказчиком, чтобы станция прошла по габариту перевозки (норма — не менее ${num(StationClear.aisle()[1])} мм, ПУЭ, п. 4.1.23).`;
    const dgu = plan.items.some(i => i.kind === 'dgu')
      ? `; вдоль ДГУ — не менее ${num(StationMatrix.grp('dgu').pass)} мм`
      : '';
    return `Проход для оператора и обслуживания — не менее ${num(aMin)} мм в свету (ПУЭ, п. 4.1.23), рекомендуется ${num(aRec)} мм${dgu}.`;
  }

  /** Шкафы на стене: высота установки. */
  cabinets() {
    const plan = this.drawing.plan;
    const num = Mm.text;
    const wall = this.pos(i => i.mount === 'wall');
    if (!wall.length) return '';
    const z0 = Math.min(...plan.items.filter(i => i.mount === 'wall').map(i => i.z));
    const many = wall.length > 1;
    const aMin = (plan.aisleRule || StationClear.aisle())[1];
    return `${many ? 'Шкафы' : 'Шкаф'} ${DrawText.list(wall)} — на стене, низ на высоте ${num(z0)} мм; проход перед ${many ? 'ними' : 'ним'} — не менее ${num(aMin)} мм.`;
  }

  /** Цепочка по ходу воздуха: компрессоры — в коллектор, одинаковые осушители и фильтры подряд — параллельно. */
  air() {
    const plan = this.drawing.plan;
    const hang = this.pos(i => i.mount === 'pipe');
    const units = plan.air && plan.air.chain.length > 1 ? plan.air.units || [] : [];
    const pipe = hang.length ? `${DrawText.list(hang)} — на трубопроводе` : '';
    if (!units.length) return pipe ? `Фильтры ${pipe}.` : '';
    const step = (group, par) => {
      const k = group.reduce((sum, unit) => sum + (unit.qty || 1), 0);
      const positions = [...new Set(group.map(unit => unit.pos))].join(', ');
      return k > 1 ? `${positions} (${k} шт. ${par ? 'параллельно' : 'последовательно'})` : positions;
    };
    const compressors = units.filter(unit => unit.kind === 'compressor');
    const chain = [
      ...(compressors.length ? [step(compressors, true)] : []),
      ...AirChain.groups(units.filter(unit => unit.kind !== 'compressor')).map(group =>
        step(group, group[0].kind !== 'receiver'),
      ),
    ];
    return `Сжатый воздух — последовательно: поз. ${chain.join(' → ')} → к потребителю${pipe ? `; фильтры ${pipe}` : ''}.`;
  }

  /** Дверь оператора. */
  entry() {
    const entry = this.drawing.entry;
    if (!entry || entry.sea) return '';
    const num = Mm.text;
    const door = StationMatrix.door();
    return `Дверь оператора — одностворчатая ${num(door.w)} × ${num(door.h)} мм в свету${entry.wall === 'left' ? ' в торце' : ''}, открывается наружу, с доводчиком; рядом — знаки и огнетушители.`;
  }

  /** Вторая дверь или ворота как второй выход. */
  second() {
    const plan = this.drawing.plan;
    if (!plan.second) return '';
    const num = Mm.text;
    const gate = this.drawing.gate;
    let how = 'одностворчатая в стене прохода у дальнего торца';
    if (plan.exit) how = `одностворчатая ${num(plan.exit.w)} мм в дальнем торце`;
    else if (gate && gate.wicket) how = `калитка ${num(gate.wicket.w)} × ${num(gate.wicket.h)} мм в створке ворот`;
    else if (plan.secondDgu) how = 'выход через дверь-жалюзи ДГУ';
    return `Вторая дверь оператора — ${how} (${plan.second}); открывается наружу, с доводчиком.`;
  }

  /** Монтажные ворота в торце (у морского — его штатные двери). */
  gate(item) {
    const num = Mm.text;
    const pos = item.pos.length ? DrawText.list(item.pos) : '';
    if (item.sea) return pos ? `Монтаж и демонтаж ${pos} — через штатные двери контейнера в торце.` : '';
    const pair = item.wall === 'right' && (this.drawing.plan.items || []).some(i => i.pairEnd);
    return `Распашные монтажные ворота ${item.full ? 'во весь торец ' : ''}${num(item.w)} × ${num(item.h)} мм в ${item.wall === 'left' ? 'торце у входа' : 'дальнем торце'}${pos ? ` — для монтажа и демонтажа ${pos}` : ''}; открываются наружу (${pair ? 'перед ними ресиверы в два ряда — не выход' : 'выход'}), утеплённые, с запорными штангами. ${StationLayout.gateAxis(item)} Проём в торцевой раме — с усилением по расчёту изготовителя.`;
  }

  /** Сервисные двери стены where. */
  service(rear, where) {
    const num = Mm.text;
    const doors = (this.drawing.plan.doors || []).filter(
      door => door.kind !== 'entry' && (rear === 'both' ? door.both : !door.both && !!door.rear === rear),
    );
    if (!doors.length) return '';
    const list = doors.map(door => `${num(door.w)} × ${num(door.h)} мм — поз. ${door.pos.join(', ')}`).join('; ');
    return `Сервисные распашные ${doors.some(door => door.leaves > 1) ? 'ворота' : 'двери'} ${where}: ${list}; утеплённые, с запорными штангами.`;
  }

  /** Глушитель на крыше; выхлоп ДГУ через стену. */
  exhaust() {
    const { drawing } = this;
    const out = [];
    if (drawing.roofRise)
      out.push(
        `Глушитель ${DrawText.list([...new Set(drawing.roofItems.map(roofItem => roofItem.pos))])} — на крыше над ДГУ, выхлоп — горизонтально в сторону; съёмный (при перевозке снимается).`,
      );
    if (drawing.wallExhausts.length)
      out.push(
        `Выхлоп ДГУ ${DrawText.list([...new Set(drawing.wallExhausts.map(exhaust => exhaust.pos))])} — через заднюю стену (глушитель встроен в ДГУ): гильза с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с колпаком.`,
      );
    return out;
  }

  /** Ресиверы снаружи на площадке. */
  outside() {
    const { outside: ext, plan: plan } = this.drawing;
    if (!ext.length) return '';
    const ads = plan.air && plan.air.units.some(unit => unit.kind === 'dryer' && unit.air && unit.air.type === 'ads');
    return `${ext.length > 1 ? 'Ресиверы' : 'Ресивер'} ${DrawText.list([...new Set(ext.map(i => i.pos))])} — снаружи на бетонной площадке (ФНП ОРПД, п. 65); подключение через стену — с запорной арматурой${plan.air && !ads ? ', отвод конденсата — с обогревом' : ''}.`;
  }

  /** Топливный бак и заправка. */
  fuel() {
    const fuel = this.drawing.fuel;
    if (!fuel) return '';
    const num = Mm.text;
    const way = fuel.gate ? `ворота в торце ${num(fuel.gate.w)} × ${num(fuel.gate.h)} мм` : 'своя дверь снаружи';
    return `Бак ${DrawText.list(this.pos(i => i.tank))} — в отсеке за противопожарной перегородкой (${StationNorms.FIRE_WALL}), вход — ${way}, горловина — в нише стены с лючком заподлицо, бак — в поддоне; топливопровод — по полу.`;
  }

  /** Системы без изображения на чертеже. */
  hidden() {
    const sys = (this.drawing.plan.extra || [])
      .filter(entry => entry.kind === 'skip' && !entry.nodims)
      .map(entry =>
        String(entry.name || '')
          .trim()
          .replace(/^./, letter => letter.toLowerCase()),
      )
      .filter(Boolean);
    return sys.length ? `Не показаны: ${DrawText.cut(sys.join(', '), 150)}.` : '';
  }

  /** Текст не длиннее max знаков, по границе слова. */
  static cut(value, max) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
  }

  /** Пункты ТТ о строповке и знаках: схема — лист sl (3; разрез А–А на своём листе — 4); знаки по ГОСТ 14192-96. */
  static lift(plan, sheetNo = 3) {
    const mass = plan.mass;
    if (!mass) return [];
    const num = Mm.text;
    const sling = mass.sling;
    return [
      `Строповка — по схеме (лист ${sheetNo}): ${DrawText.slingHow(sling, plan.geo.sea)} Перевозить с закреплённым оборудованием, без топлива и воды.`,
      `Знаки по ГОСТ 14192-96: № 9 «Место строповки» — у каждой точки строповки с двух сторон, № 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести; надпись «Масса брутто ${num(mass.mass)} кг».`,
    ];
  }

  /** Способ строповки: рамная траверса, траверса над контейнером или четырёхветвевой строп. */
  static slingHow(sling, sea) {
    const num = Mm.text;
    const lens = sling.legs.map(leg => leg.len);
    const [shortest, longest] = [Math.min(...lens), Math.max(...lens)];
    const where = sea ? 'верхние угловые фитинги' : 'петли в верхних углах';
    const legText = shortest === longest ? num(shortest) : `${num(shortest)}–${num(longest)}`;
    const frame = sling.frame;
    if (frame)
      return `рамной траверсой (спредером) за четыре ${where} — ветви вертикальны, ${num(shortest)} мм; рама — на двухветвевом стропе ${num(frame.len)} мм от проушин над центром тяжести (угол с вертикалью ${frame.deg}°). Наклонными стропами за верхние фитинги контейнер с оборудованием не поднимать (ISO 3874).`;
    if (sling.beam)
      return `длина больше ${Mm.dec(StationMass.RULES.beamL / 1000)} м — с траверсой: четыре ветви ${legText} мм за ${where} к траверсе над контейнером, траверса подвешена над центром тяжести.`;
    return `четырёхветвевым стропом за ${where}, крюк — над центром тяжести, ветви ${legText} мм, угол ветви с вертикалью — не более ${StationMass.ANGLE}°.`;
  }

  /** Пункты ТТ об отоплении (конвекторы по расчёту — на плане у стен) и жалюзи. */
  static heat(plan) {
    const heat = plan.heat;
    const out = [];
    if (heat && heat.on && heat.n)
      out.push(
        `Электроконвекторы ${heat.n} × ${StationHeat.kw(heat.kw)} кВт с терморегуляторами — у стен (на плане): не ниже +${heat.tin} °C при ${StationNorms.deg(heat.tout)} снаружи.`,
      );
    const vents = plan.vent ? DrawText.vents(plan.vent) : [];
    if (vents.length)
      out.push(`Жалюзи (размер по рамке) с утеплёнными клапанами и электроприводами: ${vents.join('; ')}.`);
    return out;
  }

  /** Жалюзи: приток, выброс, клапаны рециркуляции, вентиляторы, маркизы, радиатор ДГУ. */
  static vents(vent) {
    const num = Mm.text;
    const dec = value => String(value).replace('.', ',');
    const lines = [];
    if (vent.size.in) {
      const where = StationVent.where(vent).in;
      lines.push(
        `приточные ${StationVent.list(vent, 'in', null, 3)} внизу${where ? ` ${where}` : ''} (${num(vent.q.in)} м³/ч, по рамке не менее ${dec(vent.need.in.gross)} м²)`,
      );
    }
    if (vent.need.out) lines.push(DrawText.outVent(vent));
    if (Object.keys(vent.ducts || {}).length)
      lines.push('компрессоры — воздуховодами с клапанами рециркуляции (зимой тёплый воздух — в помещение)');
    if (vent.exfan)
      lines.push(
        `в проёмах выброса — осевые вытяжные вентиляторы (${num(vent.exfan.L)} м³/ч, напор не менее ${vent.exfan.dp} Па) с гравитационными жалюзи, по датчику температуры`,
      );
    if (vent.infan)
      lines.push(
        `приточные вентиляторы — ${vent.infan.n} ${vent.infan.n === 1 ? 'проём' : 'проёма(ов)'} (${num(vent.infan.L)} м³/ч), по датчику температуры`,
      );
    return [...lines, ...DrawText.hoods(vent)];
  }

  /** Вытяжка: жалюзи и колпаки на крыше. */
  static outVent(vent) {
    const num = Mm.text;
    const roofs = StationVent.roofList(vent);
    const outWall = vent.louvers.some(louver => louver.kind === 'out') ? StationVent.list(vent, 'out', null, 3) : '';
    const where = [
      outWall ? `— жалюзи ${outWall} ${StationVent.outAt(vent)}` : '',
      roofs ? `через крышу — колпаки ${roofs}` : '',
    ];
    const gross = String(vent.need.out.gross).replace('.', ',');
    return `выброс горячего воздуха ${where.filter(Boolean).join(', ')} (${num(vent.q.out)} м³/ч, по рамке не менее ${gross} м²); приток и выброс — на разных стенах`;
  }

  /** Маркизы на приточных и выбросе, жалюзи радиатора ДГУ. */
  static hoods(vent) {
    const num = Mm.text;
    return [
      vent.hood
        ? `на приточных — маркизы (снегозащита): откидные козырьки на петлях с боковыми створками-ограничителями, закрытые — щит на проёме, ${StationVent.hoodText(vent)}`
        : '',
      vent.hoodOut ? `на жалюзи выброса — маркизы (по требованию) ${StationVent.hoodText(vent, 'out')}` : '',
      vent.rad
        ? `радиатора ДГУ — ${vent.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${num(vent.rad.w)} × ${num(vent.rad.h)} мм`
        : '',
    ].filter(Boolean);
  }

  /** Пункт ТТ об учёте сосудов под давлением в Ростехнадзоре (ФНП ОРПД): p·V больше vessel.pv — подлежит. */
  static vessels(plan) {
    const vessels = (plan.vessels || []).filter(vessel => vessel.pv != null);
    const reg = vessels.filter(vessel => vessel.reg);
    const free = vessels.filter(vessel => !vessel.reg);
    const pos = list => `поз. ${[...new Set(list.map(vessel => vessel.pos))].join(', ')}`;
    const many = list => list.reduce((sum, vessel) => sum + (vessel.qty || 1), 0) > 1;
    return [
      reg.length
        ? `${many(reg) ? 'Ресиверы' : 'Ресивер'} ${pos(reg)} подлеж${many(reg) ? 'а' : 'и'}т учёту в Ростехнадзоре (ФНП ОРПД: p·V более ${PressureVessel.limitText()} МПа·м³).`
        : '',
      free.length
        ? `${many(free) ? 'Ресиверы' : 'Ресивер'} ${pos(free)} учёту в Ростехнадзоре не подлеж${many(free) ? 'а' : 'и'}т (p·V не более ${PressureVessel.limitText()} МПа·м³).`
        : '',
    ].filter(Boolean);
  }

  /** Станция из модулей: пункт ТТ. */
  static modsText(plan) {
    const geo = plan.geo;
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm) return [];
    const num = Mm.text;
    return [
      `Станция из модулей (М1…М${mods.n} на плане): ${StationMods.shape(mods)}, модуль ${num(mods.Lm)} × ${num(mods.Wm)} × ${num(geo.ext[2])} мм — в габарите перевозки, каждый везётся отдельно; на объекте модули стыкуются в одно помещение: стыковые стены не устанавливаются (на перевозку — временные щиты), стыки — уплотнение, нащельники на стенах и кровле, пол без порога; оборудование — целиком в модулях, собрано и проверено на производстве, на перевозку расстыковываются только трубопровод, кабели и коммуникации на стыках.`,
    ];
  }

  /** Двери-жалюзи ДГУ словами: одинаковые — одной строкой. */
  static dguDoorsText(doors) {
    if (!doors.length) return [];
    const num = Mm.text;
    const wallName = { right: 'в дальнем торце', left: 'в торце у входа', back: 'в задней стене' };
    const groups = new Map();
    for (const door of doors) {
      const k = `${door.w}×${door.h}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(door);
    }
    return [...groups.values()].map(list => {
      const who =
        list.length > 1
          ? `ДГУ поз. ${[...new Set(list.map(door => door.pos))].join(', ')} (${list.length} шт.)`
          : `ДГУ поз. ${list[0].pos}`;
      const where = [...new Set(list.map(door => wallName[door.wall]))].join(' и ');
      return `${who}: напротив радиатора ${list.length > 1 ? 'у каждой — своя ' : '— '}двустворчатая дверь-жалюзи ${num(list[0].w)} × ${num(list[0].h)} мм ${where} (выброс воздуха радиатора, монтаж и демонтаж ДГУ).`;
    });
  }
}
