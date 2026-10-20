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

  constructor(o) {
    this.o = o;
  }

  static list(a) {
    return `поз. ${a.join(', ')}`;
  }

  /** Номера позиций изделий плана, отобранных f, по возрастанию. */
  pos(f) {
    return [...new Set(this.o.p.items.filter(f).map(i => i.pos))].sort((a, b) => a - b);
  }

  /** Перечень составных частей: позиция, наименование, количество, масса. */
  rows() {
    const by = new Map();
    for (const it of [...this.o.p.items, ...this.o.ext, ...this.o.rf]) {
      const e = by.get(it.pos);
      if (e) e.n++;
      else by.set(it.pos, { pos: it.pos, name: it.brief || it.name, n: 1, mass: it.mass });
    }
    for (const pp of this.o.pipes.filter(q => q.pos != null))
      by.set(pp.pos, { pos: pp.pos, name: pp.brief || pp.name, n: pp.qty || 1, mass: null });
    return [...by.values()].sort((a, b) => a.pos - b.pos);
  }

  /** Техническая характеристика (ГОСТ 2.316): что известно о станции. */
  tech() {
    const { o } = this;
    const n = StationLayout.n;
    const a = o.p.air;
    const out = [];
    if (a && a.q > 0) out.push(`Производительность — ${AirChain.m3(a.q)} м³/мин при ${AirChain.m3(a.bar)} бар`);
    if (a && a.cls) out.push(`Класс воздуха по ISO 8573-1 — ${a.cls}`);
    out.push(...this.power());
    if (o.ms) out.push(StationMass.text(o.ms));
    out.push(`Внутри — ${n(o.Li)} × ${n(o.Wi)} × ${n(o.Hi)} мм`);
    if (o.g.t) out.push(`Утепление стен — ${n(o.g.t)} мм`);
    if (o.rise) {
      const R = StationGeo.ROOFS[o.g.roof];
      out.push(`Крыша — ${R.name}${R.deg ? `, уклон ${R.deg}°` : ''}`);
    }
    const col = String(o.m.colorText || '').replace(/^цвет\s+/i, '');
    if (col) out.push(`Окраска — ${col}`);
    out.push(...StationNorms.tech(o.p));
    return out;
  }

  /** Мощности и масса оборудования — если известны у всех. */
  power() {
    const n = StationLayout.n;
    const I = this.o.p.items;
    const kw = k => {
      const L = I.filter(i => i.kind === k);
      return L.length && L.every(i => i.kw > 0) ? L.reduce((s, i) => s + i.kw, 0) : 0;
    };
    const em = kw('compressor') + kw('pump');
    const dg = kw('dgu');
    const all = [...I, ...this.o.ext, ...this.o.rf];
    const mass = all.every(i => i.mass > 0) ? all.reduce((s, i) => s + i.mass, 0) : 0;
    return [
      em ? `Мощность электродвигателей — ${n(em)} кВт` : '',
      dg ? `Мощность ДГУ — ${n(dg)} кВт` : '',
      mass ? `Масса оборудования — ${n(mass)} кг` : '',
    ].filter(Boolean);
  }

  /** Технические требования: коротко, номерами пунктов. */
  reqs() {
    const p = this.o.p;
    return [
      'Размеры, привязки и трассы уточняются рабочим проектом.',
      this.guessed(),
      this.aisle(),
      this.cabinets(),
      this.air(),
      this.entry(),
      this.second(),
      ...this.o.gts.map(q => this.gate(q)),
      ...DrawText.SERVICE.map(([rear, t]) => this.service(rear, t)),
      ...DrawText.modsText(p),
      ...DrawText.dguDoorsText(this.o.dgs),
      ...this.exhaust(),
      this.outside(),
      this.fuel(),
      ...DrawText.heat(p),
      ...DrawText.vessels(p),
      ...StationNorms.tt(p),
      ...DrawText.lift(p, this.o.slingNo || 3),
      this.hidden(),
    ].filter(Boolean);
  }

  /** Габариты угаданы — уточнить по паспорту. */
  guessed() {
    const gu = [
      ...new Set([...this.o.p.items, ...this.o.ext].filter(i => i.known === false && i.pos != null).map(i => i.pos)),
    ];
    if (!gu.length) return '';
    return `Габариты ${DrawText.list(gu.sort((a, b) => a - b))} — условные (данных изготовителя нет): уточнить по паспорту до изготовления.`;
  }

  aisle() {
    const p = this.o.p;
    const n = StationLayout.n;
    const [aRec, aMin] = p.aisleRule || [1000, 800];
    if (p.mode && p.mode.tight)
      return `Проход для оператора и обслуживания — ${n((p.aisle && p.aisle.w) || aMin)} мм в свету: сужен по согласованию с заказчиком, чтобы станция прошла по габариту перевозки (норма — не менее ${n(StationClear.aisle()[1])} мм, ПУЭ, п. 4.1.23).`;
    const dgu = p.items.some(i => i.kind === 'dgu') ? '; вдоль ДГУ — не менее 600 мм' : '';
    return `Проход для оператора и обслуживания — не менее ${n(aMin)} мм в свету (ПУЭ, п. 4.1.23), рекомендуется ${n(aRec)} мм${dgu}.`;
  }

  cabinets() {
    const p = this.o.p;
    const n = StationLayout.n;
    const wall = this.pos(i => i.mount === 'wall');
    if (!wall.length) return '';
    const z0 = Math.min(...p.items.filter(i => i.mount === 'wall').map(i => i.z));
    const many = wall.length > 1;
    const aMin = (p.aisleRule || [1000, 800])[1];
    return `${many ? 'Шкафы' : 'Шкаф'} ${DrawText.list(wall)} — на стене, низ на высоте ${n(z0)} мм; проход перед ${many ? 'ними' : 'ним'} — не менее ${n(aMin)} мм.`;
  }

  /** Цепочка по ходу воздуха: компрессоры — в коллектор, одинаковые осушители и фильтры подряд — параллельно. */
  air() {
    const p = this.o.p;
    const hang = this.pos(i => i.mount === 'pipe');
    const U = p.air && p.air.chain.length > 1 ? p.air.units || [] : [];
    const pipe = hang.length ? `${DrawText.list(hang)} — на трубопроводе` : '';
    if (!U.length) return pipe ? `Фильтры ${pipe}.` : '';
    const step = (G, par) => {
      const k = G.reduce((s, u) => s + (u.qty || 1), 0);
      const ps = [...new Set(G.map(u => u.pos))].join(', ');
      return k > 1 ? `${ps} (${k} шт. ${par ? 'параллельно' : 'последовательно'})` : ps;
    };
    const C = U.filter(u => u.kind === 'compressor');
    const chain = [
      ...(C.length ? [step(C, true)] : []),
      ...AirChain.groups(U.filter(u => u.kind !== 'compressor')).map(G => step(G, G[0].kind !== 'receiver')),
    ];
    return `Сжатый воздух — последовательно: поз. ${chain.join(' → ')} → к потребителю${pipe ? `; фильтры ${pipe}` : ''}.`;
  }

  entry() {
    const en = this.o.en;
    if (!en || en.sea) return '';
    const n = StationLayout.n;
    const d = StationMatrix.door();
    return `Дверь оператора — одностворчатая ${n(d.w)} × ${n(d.h)} мм в свету${en.wall === 'left' ? ' в торце' : ''}, открывается наружу, с доводчиком; рядом — знаки и огнетушители.`;
  }

  second() {
    const p = this.o.p;
    if (!p.second) return '';
    const n = StationLayout.n;
    const gt = this.o.gt;
    let how = 'одностворчатая в стене прохода у дальнего торца';
    if (p.exit) how = `одностворчатая ${n(p.exit.w)} мм в дальнем торце`;
    else if (gt && gt.wicket) how = `калитка ${n(gt.wicket.w)} × ${n(gt.wicket.h)} мм в створке ворот`;
    else if (p.secondDgu) how = 'выход через дверь-жалюзи ДГУ';
    return `Вторая дверь оператора — ${how} (${p.second}); открывается наружу, с доводчиком.`;
  }

  /** Монтажные ворота в торце (у морского — его штатные двери). */
  gate(q) {
    const n = StationLayout.n;
    const pos = q.pos.length ? DrawText.list(q.pos) : '';
    if (q.sea) return pos ? `Монтаж и демонтаж ${pos} — через штатные двери контейнера в торце.` : '';
    const pair = q.wall === 'right' && (this.o.p.items || []).some(i => i.pairEnd);
    return `Распашные монтажные ворота ${q.full ? 'во весь торец ' : ''}${n(q.w)} × ${n(q.h)} мм в ${q.wall === 'left' ? 'торце у входа' : 'дальнем торце'}${pos ? ` — для монтажа и демонтажа ${pos}` : ''}; открываются наружу (${pair ? 'перед ними ресиверы в два ряда — не выход' : 'выход'}), утеплённые, с запорными штангами. ${StationLayout.gateAxis(q)} Проём в торцевой раме — с усилением по расчёту изготовителя.`;
  }

  service(rear, t) {
    const n = StationLayout.n;
    const D = (this.o.p.doors || []).filter(
      d => d.kind !== 'entry' && (rear === 'both' ? d.both : !d.both && !!d.rear === rear),
    );
    if (!D.length) return '';
    const list = D.map(d => `${n(d.w)} × ${n(d.h)} мм — поз. ${d.pos.join(', ')}`).join('; ');
    return `Сервисные распашные ${D.some(d => d.leaves > 1) ? 'ворота' : 'двери'} ${t}: ${list}; утеплённые, с запорными штангами.`;
  }

  /** Глушитель на крыше; выхлоп ДГУ через стену. */
  exhaust() {
    const { o } = this;
    const out = [];
    if (o.up)
      out.push(
        `Глушитель ${DrawText.list([...new Set(o.rf.map(m => m.pos))])} — на крыше над ДГУ, выхлоп — горизонтально в сторону; съёмный (при перевозке снимается).`,
      );
    if (o.exW.length)
      out.push(
        `Выхлоп ДГУ ${DrawText.list([...new Set(o.exW.map(e => e.pos))])} — через заднюю стену (глушитель встроен в ДГУ): гильза с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с колпаком.`,
      );
    return out;
  }

  outside() {
    const { ext, p } = this.o;
    if (!ext.length) return '';
    const ads = p.air && p.air.units.some(u => u.kind === 'dryer' && u.air && u.air.type === 'ads');
    return `${ext.length > 1 ? 'Ресиверы' : 'Ресивер'} ${DrawText.list([...new Set(ext.map(i => i.pos))])} — снаружи на бетонной площадке (ФНП ОРПД, п. 65); подключение через стену — с запорной арматурой${p.air && !ads ? ', отвод конденсата — с обогревом' : ''}.`;
  }

  fuel() {
    const f = this.o.fuel;
    if (!f) return '';
    const n = StationLayout.n;
    const way = f.gate ? `ворота в торце ${n(f.gate.w)} × ${n(f.gate.h)} мм` : 'своя дверь снаружи';
    return `Бак ${DrawText.list(this.pos(i => i.tank))} — в отсеке за противопожарной перегородкой (EI 45), вход — ${way}, горловина — в нише стены с лючком заподлицо, бак — в поддоне; топливопровод — по полу.`;
  }

  /** Системы без изображения на чертеже. */
  hidden() {
    const sys = (this.o.p.extra || [])
      .filter(e => e.kind === 'skip' && !e.nodims)
      .map(e =>
        String(e.name || '')
          .trim()
          .replace(/^./, c => c.toLowerCase()),
      )
      .filter(Boolean);
    return sys.length ? `Не показаны: ${DrawText.cut(sys.join(', '), 150)}.` : '';
  }

  static cut(s, n) {
    const t = String(s || '');
    return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
  }

  /** Пункты ТТ о строповке и знаках: схема — лист sl (3; разрез А–А на своём листе — 4); знаки по ГОСТ 14192-96. */
  static lift(p, sl = 3) {
    const M = p.mass;
    if (!M) return [];
    const n = StationLayout.n;
    const S = M.sling;
    return [
      `Строповка — по схеме (лист ${sl}): ${DrawText.slingHow(S, p.geo.sea)} Перевозить с закреплённым оборудованием, без топлива и воды.`,
      `Знаки по ГОСТ 14192-96: № 9 «Место строповки» — у каждой точки строповки с двух сторон, № 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести; надпись «Масса брутто ${n(M.mass)} кг».`,
    ];
  }

  /** Способ строповки: рамная траверса, траверса над контейнером или четырёхветвевой строп. */
  static slingHow(S, sea) {
    const n = StationLayout.n;
    const L = S.legs.map(q => q.len);
    const [a, b] = [Math.min(...L), Math.max(...L)];
    const at = sea ? 'верхние угловые фитинги' : 'петли в верхних углах';
    const L4 = a === b ? n(a) : `${n(a)}–${n(b)}`;
    const F = S.frame;
    if (F)
      return `рамной траверсой (спредером) за четыре ${at} — ветви вертикальны, ${n(a)} мм; рама — на двухветвевом стропе ${n(F.len)} мм от проушин над центром тяжести (угол с вертикалью ${F.deg}°). Наклонными стропами за верхние фитинги контейнер с оборудованием не поднимать (ISO 3874).`;
    if (S.beam)
      return `длина больше 6,5 м — с траверсой: четыре ветви ${L4} мм за ${at} к траверсе над контейнером, траверса подвешена над центром тяжести.`;
    return `четырёхветвевым стропом за ${at}, крюк — над центром тяжести, ветви ${L4} мм, угол ветви с вертикалью — не более ${StationMass.ANGLE}°.`;
  }

  /** Пункты ТТ об отоплении (конвекторы по расчёту — на плане у стен) и жалюзи. */
  static heat(p) {
    const h = p.heat;
    const out = [];
    if (h && h.on && h.n)
      out.push(
        `Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт с терморегуляторами — у стен (на плане): не ниже +${h.tin} °C при ${StationNorms.deg(h.tout)} снаружи.`,
      );
    const t = p.vent ? DrawText.vents(p.vent) : [];
    if (t.length) out.push(`Жалюзи (размер по рамке) с утеплёнными клапанами и электроприводами: ${t.join('; ')}.`);
    return out;
  }

  /** Жалюзи: приток, выброс, клапаны рециркуляции, вентиляторы, маркизы, радиатор ДГУ. */
  static vents(V) {
    const n = StationLayout.n;
    const f = v => String(v).replace('.', ',');
    const t = [];
    if (V.size.in) {
      const wh = StationVent.where(V).in;
      t.push(
        `приточные ${StationVent.list(V, 'in', null, 3)} внизу${wh ? ` ${wh}` : ''} (${n(V.q.in)} м³/ч, по рамке не менее ${f(V.need.in.gross)} м²)`,
      );
    }
    if (V.need.out) t.push(DrawText.outVent(V));
    if (Object.keys(V.ducts || {}).length)
      t.push('компрессоры — воздуховодами с клапанами рециркуляции (зимой тёплый воздух — в помещение)');
    if (V.exfan)
      t.push(
        `в проёмах выброса — осевые вытяжные вентиляторы (${n(V.exfan.L)} м³/ч, напор не менее ${V.exfan.dp} Па) с гравитационными жалюзи, по датчику температуры`,
      );
    if (V.infan)
      t.push(
        `приточные вентиляторы — ${V.infan.n} ${V.infan.n === 1 ? 'проём' : 'проёма(ов)'} (${n(V.infan.L)} м³/ч), по датчику температуры`,
      );
    return [...t, ...DrawText.hoods(V)];
  }

  static outVent(V) {
    const n = StationLayout.n;
    const rf = StationVent.roofList(V);
    const ow = V.louvers.some(q => q.kind === 'out') ? StationVent.list(V, 'out', null, 3) : '';
    const where = [ow ? `— жалюзи ${ow} ${StationVent.outAt(V)}` : '', rf ? `через крышу — колпаки ${rf}` : ''];
    const s = String(V.need.out.gross).replace('.', ',');
    return `выброс горячего воздуха ${where.filter(Boolean).join(', ')} (${n(V.q.out)} м³/ч, по рамке не менее ${s} м²); приток и выброс — на разных стенах`;
  }

  /** Маркизы на приточных и выбросе, жалюзи радиатора ДГУ. */
  static hoods(V) {
    const n = StationLayout.n;
    return [
      V.hood
        ? `на приточных — маркизы (снегозащита): откидные козырьки на петлях с боковыми створками-ограничителями, закрытые — щит на проёме, ${StationVent.hoodText(V)}`
        : '',
      V.hoodOut ? `на жалюзи выброса — маркизы (по требованию) ${StationVent.hoodText(V, 'out')}` : '',
      V.rad ? `радиатора ДГУ — ${V.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(V.rad.w)} × ${n(V.rad.h)} мм` : '',
    ].filter(Boolean);
  }

  /** Пункт ТТ об учёте сосудов под давлением в Ростехнадзоре (ФНП ОРПД): p·V больше 1,0 МПа·м³ — подлежит. */
  static vessels(p) {
    const V = (p.vessels || []).filter(v => v.pv != null);
    const reg = V.filter(v => v.reg);
    const free = V.filter(v => !v.reg);
    const pos = L => `поз. ${[...new Set(L.map(v => v.pos))].join(', ')}`;
    const many = L => L.reduce((s, v) => s + (v.qty || 1), 0) > 1;
    return [
      reg.length
        ? `${many(reg) ? 'Ресиверы' : 'Ресивер'} ${pos(reg)} подлеж${many(reg) ? 'а' : 'и'}т учёту в Ростехнадзоре (ФНП ОРПД: p·V более 1,0 МПа·м³).`
        : '',
      free.length
        ? `${many(free) ? 'Ресиверы' : 'Ресивер'} ${pos(free)} учёту в Ростехнадзоре не подлеж${many(free) ? 'а' : 'и'}т (p·V не более 1,0 МПа·м³).`
        : '',
    ].filter(Boolean);
  }

  /** Станция из модулей: пункт ТТ. */
  static modsText(p) {
    const g = p.geo;
    const md = g && g.mods;
    if (!md || !md.Lm) return [];
    const n = StationLayout.n;
    return [
      `Станция из модулей (М1…М${md.n} на плане): ${StationMods.shape(md)}, модуль ${n(md.Lm)} × ${n(md.Wm)} × ${n(g.ext[2])} мм — в габарите перевозки, каждый везётся отдельно; на объекте модули стыкуются в одно помещение: стыковые стены не устанавливаются (на перевозку — временные щиты), стыки — уплотнение, нащельники на стенах и кровле, пол без порога; оборудование — целиком в модулях, собрано и проверено на производстве, на перевозку расстыковываются только трубопровод, кабели и коммуникации на стыках.`,
    ];
  }

  /** Двери-жалюзи ДГУ словами: одинаковые — одной строкой. */
  static dguDoorsText(D) {
    if (!D.length) return [];
    const n = StationLayout.n;
    const wh = { right: 'в дальнем торце', left: 'в торце у входа', back: 'в задней стене' };
    const g = new Map();
    for (const d of D) {
      const k = `${d.w}×${d.h}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(d);
    }
    return [...g.values()].map(L => {
      const who =
        L.length > 1
          ? `ДГУ поз. ${[...new Set(L.map(d => d.pos))].join(', ')} (${L.length} шт.)`
          : `ДГУ поз. ${L[0].pos}`;
      const where = [...new Set(L.map(d => wh[d.wall]))].join(' и ');
      return `${who}: напротив радиатора ${L.length > 1 ? 'у каждой — своя ' : '— '}двустворчатая дверь-жалюзи ${n(L[0].w)} × ${n(L[0].h)} мм ${where} (выброс воздуха радиатора, монтаж и демонтаж ДГУ).`;
    });
  }
}
