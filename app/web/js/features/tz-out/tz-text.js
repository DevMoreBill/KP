import { Mm } from '../layout/mm.js';
import { AirChain } from '../layout/air-chain.js';
import { DrawText } from '../draw/draw-text.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { PipeMaterial } from '../layout/pipe-material.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationFire } from '../layout/station-fire.js';
import { StationHeat } from '../layout/station-heat.js';
import { StationJoints } from '../layout/station-joints.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationPipe } from '../layout/station-pipe.js';
import { StationPower } from '../layout/station-power.js';
import { TzContainer } from './tz-container.js';

/** Текст ТЗ на сборку станции: разделы по порядку, нумерация — сквозная. */
export class TzText {
  static KIND = { comp: 'компрессорная станция', dgu: 'дизель-генераторная электростанция', pump: 'насосная станция' };
  static MEDIUM = { comp: 'сжатый воздух', pump: 'вода', dgu: 'дизельное топливо' };
  static MOUNT = { wall: 'на стене', pipe: 'на трубопроводе', frame: 'на раме' };
  static WALL = { front: 'стена с дверью', back: 'задняя стена', left: 'левый торец', right: 'правый торец' };
  static FILL = { left: 'в левом торце', back: 'в задней стене за баком' };
  static SECTIONS = [
    '_general',
    '_container',
    '_ours',
    '_works',
    '_placement',
    '_pipes',
    '_power',
    '_norms',
    '_tests',
    '_docs',
    '_shipping',
  ];

  /** Документ d (DocxWriter): станция x, расстановка plan, заказчик сборки org. */
  static write(doc, x, plan, org) {
    const spec = this._ctx(doc, x, plan, org);
    this._head(spec);
    for (const section of this.SECTIONS) this[section](spec);
  }

  static _ctx(doc, x, plan, org) {
    const parts = kitParts(x);
    const container = kitContainer(x) || {};
    const equip = StationEquip.list(parts);
    return {
      d: doc,
      x,
      plan,
      org,
      parts,
      c: container,
      eq: equip,
      pos: new Map(equip.filter(unit => unit.pos).map(unit => [unit.id, unit])),
      req: StationReq.plan(x),
      r: StationReq.of(x),
      cl: CLIMATES.find(z => z[0] === container.climate),
      ok: plan.level !== 'error' && plan.geo && plan.geo.ext,
      no: 0,
    };
  }

  /** Заголовок раздела со следующим номером; ответ — префикс пунктов раздела. */
  static _h1(spec, title) {
    spec.no += 1;
    spec.d.h1(`${spec.no}. ${title}`);
    return `${spec.no}.`;
  }

  static _head(spec) {
    const { d: doc } = spec;
    doc.title1('Техническое задание на сборку станции в контейнере');
    doc.p([[spec.x.name || 'Станция', { b: true }]], { align: 'center', after: 2 });
    doc.p(`${spec.org}${S.number ? ` · КП № ${S.number}` : ''}${S.date ? ` от ${EskdSheet.date(S.date)}` : ''}`, {
      align: 'center',
      after: 10,
      run: { color: '555555' },
    });
  }

  static _general(spec) {
    const { x, c: container } = spec;
    const prefix = this._h1(spec, 'Общие сведения');
    const line = StationReq.line({ ...x, req: { ...spec.r, src: null } }); // без имени файла ТЗ заказчика
    spec.d.items(
      [
        [
          ['Изделие: ', { b: true }],
          [`${x.name || 'станция'} — ${this.KIND[spec.req.kind] || 'станция'} в контейнере.`, {}],
        ],
        ...(line
          ? [
              [
                ['Параметры станции: ', { b: true }],
                [`${line}.`, {}],
              ],
            ]
          : []),
        [
          ['Заказчик сборки: ', { b: true }],
          [`${spec.org}${this._contact(S.manager || {})}.`, {}],
        ],
        [
          ['Сборщик: ', { b: true }],
          [
            `${String(container.sup || '').trim() || 'изготовитель контейнера'} — изготавливает контейнер с системами, принимает и монтирует оборудование заказчика, поставляет и монтирует шкафы, трубопроводы, обвязку и оборудование безопасности, испытывает станцию и сдаёт её заказчику.`,
            {},
          ],
        ],
        'Отступления от ТЗ, замена материалов и оборудования сборщика — только по письменному согласованию с заказчиком.',
        'Размеры, привязки и трассы уточняются рабочей документацией сборщика и согласуются с заказчиком до начала работ.',
      ],
      prefix,
    );
  }

  static _contact(mgr) {
    if (!mgr.name) return '';
    return `, ответственный — ${mgr.name}${mgr.phone ? `, ${mgr.phone}` : ''}${mgr.email ? `, ${mgr.email}` : ''}`;
  }

  static _container(spec) {
    const { d: doc, x, c: container } = spec;
    this._h1(spec, 'Контейнер и его системы');
    doc.table([42, 128], ['Параметр', 'Требование'], TzContainer.rows(spec));
    const off = CONT_SYSTEMS.filter(([id]) => !KitView.sysOn(x, container, id)).map(([, k]) => k.toLowerCase());
    if (off.length)
      doc.p(`Не требуются (не входят в поставку): ${off.join(', ')}.`, { after: 6, run: { color: '555555' } });
  }

  static _scope(spec, scope) {
    return spec.parts.filter(part => part.role !== 'container' && KitScope.of(part) === scope);
  }

  /** Оборудование заказчика — давальческое: поставляет ПНЕВМОТЕХ, монтирует сборщик. */
  static _ours(spec) {
    const { d: doc } = spec;
    this._h1(spec, 'Оборудование заказчика (давальческое)');
    const our = this._scope(spec, 'our');
    doc.p(
      `Поставляет ${spec.org} на площадку сборщика; приёмка — по количеству и внешнему виду, по акту. До монтажа — хранить в упаковке, в сухом помещении; консервацию не снимать.`,
    );
    if (!our.length) {
      doc.p('Нет — всё оборудование поставляет сборщик.');
      return;
    }
    doc.table(
      [12, 70, 12, 44, 20, 22],
      ['Поз.', 'Наименование', 'Кол.', 'Габариты Д × Ш × В, мм', 'Масса, кг', 'Мощность, кВт'],
      our.map(part => this._ourRow(spec, part)),
    );
  }

  static _ourRow(spec, part) {
    const unit = spec.pos.get(part.id) || {};
    const kw = StationEquip.num((part.attrs || {}).kw);
    return [
      String(unit.pos || '—'),
      part.name || '',
      String(part.qty || 1),
      unit.known ? `${Mm.text(unit.l)} × ${Mm.text(unit.w)} × ${Mm.text(unit.h)}` : 'по паспорту',
      unit.mass > 0 ? Mm.text(unit.mass) : '—',
      kw > 0 ? Mm.dec(kw) : '—',
    ];
  }

  static _works(spec) {
    const { d: doc } = spec;
    const prefix = this._h1(spec, 'Поставка и работы сборщика');
    const asm = this._scope(spec, 'asm');
    if (asm.length)
      doc.table(
        [12, 58, 12, 88],
        ['Поз.', 'Наименование', 'Кол.', 'Требования'],
        asm.map(part => {
          const unit = spec.pos.get(part.id) || {};
          return [String(unit.pos || '—'), part.name || '', String(part.qty || 1), this.asmText(part, unit)];
        }),
      );
    doc.items(
      [
        'Монтаж оборудования заказчика по габаритному чертежу (приложение 1) и инструкциям изготовителей: на раму или анкерами к полу, с виброопорами, где они предусмотрены; на время перевозки — транспортное крепление.',
        'Трубопроводная обвязка, запорная и предохранительная арматура, манометры — по схеме (приложение 2) и разделу 6.',
        'Электромонтаж: питание оборудования от шкафов, кабели в лотках и гофре, заземление и уравнивание потенциалов — по разделу 7.',
        'Проходы обслуживания и отступы оборудования от стен — не меньше указанных на чертеже: оборудование обслуживается без демонтажа соседнего.',
        'Пусконаладка — совместно с заказчиком после монтажа; до неё оборудование заказчика не включать.',
      ],
      prefix,
    );
  }

  /** Требования к элементу сборщика: описание или главные характеристики. */
  static asmText(part, unit) {
    const rows = (part.rows || [])
      .filter(row => row && row.k && row.v)
      .slice(0, 4)
      .map(row => `${row.k} — ${row.v}`);
    const mat = PipeMaterial.of(part);
    const texts = [
      this._short(String(part.desc || '').trim()),
      rows.join('; '),
      mat ? `материал — ${mat.row}` : '',
      unit.kind === 'cabinet' ? `установка — ${unit.mount === 'floor' ? 'на полу' : 'на стене'}` : '',
    ].filter(Boolean);
    return texts.join('. ') || 'по согласованию с заказчиком';
  }

  static _short(desc) {
    return desc.length > 220 ? `${desc.slice(0, 219).replace(/\s+\S*$/, '')}…` : desc;
  }

  /** Размещение: привязки оборудования, конвекторы, отсек бака, что учесть при сборке. */
  static _placement(spec) {
    if (!spec.ok) return;
    const { d: doc, plan } = spec;
    const prefix = this._h1(spec, 'Размещение оборудования');
    const side = plan.door === 'side';
    doc.p(
      `Привязки — от внутренних поверхностей стен до ближнего края оборудования: X — от левого торца${side ? ' (со стороны двери оператора)' : ''}, Y — от передней стены${side ? ' (с дверью оператора)' : ''}; Z — от пола до низа. Допуск ±50 мм; иное — по согласованию.`,
    );
    doc.table(
      [12, 66, 20, 20, 20, 32],
      ['Поз.', 'Наименование', 'X, мм', 'Y, мм', 'Z, мм', 'Установка'],
      this._places(plan),
    );
    this._heaters(spec);
    if (plan.fuel) this._fuelBay(spec, prefix);
    const iss = plan.issues.filter(i => i.level === 'warn').map(i => i.text);
    if (!iss.length) return;
    doc.h2('Учесть при сборке');
    doc.items(iss, prefix);
  }

  static _places(plan) {
    const name = i => (i.short || i.name || '') + (i.unit ? ` (${i.unit + 1})` : '');
    const items = [...plan.items].sort((first, second) => first.pos - second.pos || first.unit - second.unit);
    return [
      ...items.map(i => [
        String(i.pos),
        name(i),
        Mm.text(i.x),
        Mm.text(i.y),
        Mm.text(i.z || 0),
        this.MOUNT[i.mount] || 'на полу',
      ]),
      ...(plan.outside || []).map(i => [
        String(i.pos),
        name(i),
        '—',
        '—',
        '—',
        `снаружи, ${Mm.text(StationLayout.OUT_GAP)} мм от дальнего торца, на площадке`,
      ]),
    ];
  }

  static _heaters(spec) {
    const heaters = (spec.plan.heat && spec.plan.heat.heaters) || [];
    if (!heaters.length) return;
    spec.d.h2('Электроконвекторы');
    spec.d.table(
      [12, 66, 20, 20, 20, 32],
      ['№', 'Конвектор', 'X, мм', 'Y, мм', 'Z, мм', 'Где'],
      heaters.map((heater, k) => [
        String(k + 1),
        `${StationHeat.kw(heater.kw)} кВт, ${Mm.text(Math.max(heater.lx, heater.ly))} × ${Mm.text(heater.h)} мм`,
        Mm.text(heater.x),
        Mm.text(heater.y),
        Mm.text(heater.z),
        this.WALL[heater.wall] || '',
      ]),
    );
  }

  /** Отсек топливного бака ДГУ: перегородка, вход, горловина в нише, поддон, насос перекачки. */
  static _fuelBay(spec, prefix) {
    const fuel = spec.plan.fuel;
    spec.d.h2('Отсек топливного бака');
    spec.d.items(
      [
        `Отсек — у левого торца, длина внутри ${Mm.text(fuel.x1)} мм; противопожарная перегородка 1-го типа (EI 45) толщиной ${Mm.text(fuel.part)} мм на всю ширину и высоту, без проёмов; топливопровод — через перегородку в гильзе с негорючим уплотнением.`,
        `${this._fuelEntry(fuel)}; заливная горловина — ${this.FILL[fuel.fill.wall] || 'в стене с дверью'} на высоте ${Mm.text(fuel.fill.z)} мм, утоплена в стену: ниша с лючком заподлицо под замок (снаружи ничего не выступает), с трубой до бака.`,
        'Бак — в поддоне на полный объём бака; дыхательный клапан с огнепреградителем — над крышей; указатель уровня; естественная вентиляция отсека — жалюзи внизу и вверху; огнетушитель и знаки безопасности у двери.',
        `Насос перекачки топлива из дополнительного бака в бак ДГУ — в отсеке у бака на раме: подача около ${Math.round(StationPipe.FUEL / 0.06)} л/мин, 0,37 кВт; включается автоматически по датчикам уровня в баке ДГУ (нижний — пуск, верхний — останов), защита от сухого хода и переполнения, ручной режим; на всасывании — кран и фильтр; питание — от щита собственных нужд.`,
      ],
      prefix,
    );
  }

  static _fuelEntry(fuel) {
    if (fuel.gate)
      return `Вход в отсек — двустворчатые ворота в левом торце ${Mm.text(fuel.gate.w)} × ${Mm.text(fuel.gate.h)} мм, Y ${Mm.text(fuel.gate.y0)}…${Mm.text(fuel.gate.y1)} мм (монтаж и замена бака), открываются наружу, жалюзи внизу и вверху створок`;
    if (fuel.door)
      return `Дверь отсека — в стене с дверью, X ${Mm.text(fuel.door.x0)}…${Mm.text(fuel.door.x1)} мм, открывается наружу`;
    return 'Вход в отсек — через штатные двери контейнера';
  }

  static _pipes(spec) {
    const { plan, ok } = spec;
    const prefix = this._h1(spec, 'Трубопроводы и арматура');
    spec.d.items(
      [
        this._medium(spec),
        ok && plan.pipe ? `${StationPipe.text(plan.pipe).replace(/^./, letter => letter.toUpperCase())}.` : '',
        ...(ok ? StationPipe.outs(plan) : []),
        ...this._pipeKind(spec),
        'Испытания трубопроводов на прочность и плотность — 1,25 рабочего давления (ГОСТ 32569-2013), с протоколом; затем продувка (промывка).',
        'Опознавательная окраска и маркировка — по ГОСТ Р 71918-2024, стрелки направления потока.',
        ...((plan.outside || []).length
          ? [
              'Ресивер снаружи: бетонная площадка с выступом 200 мм, трубопровод через стену в гильзе, запорная арматура у стены внутри; предохранительный клапан и манометр — на ресивере.',
            ]
          : []),
      ],
      prefix,
    );
  }

  static _medium(spec) {
    const { plan } = spec;
    const pipe = (plan.piping || []).find(line => line.pos != null);
    const mat = pipe && PipeMaterial.get(pipe.mat);
    const bar = plan.air && plan.air.bar > 0 ? plan.air.bar : null;
    return `Среда — ${this.MEDIUM[spec.req.kind] || 'рабочая среда'}${bar ? `, рабочее давление ${Mm.dec(bar)} бар` : ''}; материал труб — ${mat ? mat.row : 'сталь (согласовать)'}${pipe && pipe.dn ? `, ${pipe.dn}` : ''}; соединения — сварные или фланцевые, резьбовые — у арматуры.`;
  }

  /** Пункты по виду станции; неподходящие — пустые (как раньше в документе). */
  static _pipeKind(spec) {
    const { plan, ok } = spec;
    const kind = spec.req.kind;
    const air = kind === 'comp' && ok;
    return [
      kind === 'comp'
        ? 'Сжатый воздух — последовательно по схеме: у ресивера, осушителя и фильтров один вход и один выход; уклон линий — к сборникам конденсата, отвод конденсата — в масловодоотделитель или дренаж.'
        : '',
      air && (plan.lines || []).some(line => (line.bypass || []).length)
        ? 'У осушителя — байпас: обводная линия с краном (нормально закрыт) между входом и выходом, на входе и выходе осушителя — краны; осушитель обслуживают и меняют без остановки подачи воздуха.'
        : '',
      air && plan.air
        ? AirChain.parText(plan.air.units).replace(
            /: производительность/,
            ' (общий коллектор на входе, фильтры на трубе — на обводных петлях): производительность',
          )
        : '',
      kind === 'pump'
        ? 'Насосы — параллельно между всасывающим и напорным коллекторами; на каждом — задвижки до и после, обратный клапан на напоре, манометры.'
        : '',
      kind === 'dgu'
        ? 'Топливопровод — сталь, без полимерных вставок; подключение бака — с запорным клапаном, у ДГУ — гибкие подводки изготовителя.'
        : '',
    ];
  }

  static _power(spec) {
    const { d: doc, ok, plan } = spec;
    const prefix = this._h1(spec, 'Электрооборудование');
    const power = ok ? plan.power : null;
    if (power && power.list.length) this._loads(doc, power);
    doc.items(this._powerLines(spec, power), prefix);
    if (ok) StationJoints.tz(plan, doc); // станция из модулей: что расстыковывают на перевозку
  }

  static _loads(doc, power) {
    const kwText = StationPower.f;
    doc.p(
      power.dgu
        ? 'Нагрузки собственных нужд станции (ДГУ — источник, в расчёт не входит; в ожидании — от сети через АВР):'
        : 'Электрические нагрузки станции:',
      { after: 2 },
    );
    doc.table(
      [78, 12, 24, 14, 42],
      ['Потребитель', 'Кол.', 'Мощность, кВт', 'Кс', 'Расчётная, кВт: работа / простой'],
      power.list.map(load => {
        const total = load.extra ? load.extra : load.n * load.kw * load.kc;
        return [
          load.name,
          String(load.n),
          load.kw ? kwText(load.n * load.kw) : '—',
          load.extra ? '—' : Mm.dec(load.kc),
          `${load.run ? kwText(total) : '—'} / ${load.idle ? kwText(total) : '—'}`,
        ];
      }),
    );
  }

  static _powerLines(spec, power) {
    const { r: needs } = spec;
    const kw = spec.eq
      .filter(unit => unit.place && unit.kw > 0 && /^(compressor|pump|dryer)$/.test(unit.kind))
      .reduce((sum, unit) => sum + unit.kw * unit.qty, 0);
    return [
      ...StationPower.lines(power),
      !power && kw
        ? `Установленная мощность оборудования заказчика — около ${Mm.text(kw)} кВт (плюс собственные нужды контейнера); ввод и шкафы — с запасом по току пуска.`
        : '',
      'Шкафы — на местах по чертежу; проход перед шкафами — не менее 800 мм (ПУЭ, п. 4.1.23), щит длиннее 7 м — с двумя выходами; двери электропомещения открываются наружу (п. 4.2.94).',
      'Заземление и уравнивание потенциалов оборудования, трубопроводов и металлоконструкций контейнера — по ПУЭ, гл. 1.7; болт заземления снаружи контейнера.',
      'Кабели — с медными жилами, не распространяющие горение (нг(А)-LS); вводы — сальниковые, герметичные.',
      'Шкафы управления — с декларациями ТР ТС 004/2011 и 020/2011, схемами и паспортами.',
      needs.ats
        ? 'Электроснабжение — два ввода; шкаф АВР переключает питание станции на резервный ввод при пропадании основного (с ручным режимом и индикацией).'
        : '',
      needs.scada
        ? 'Диспетчеризация: шкаф АСУ ТП собирает сигналы работы и аварий оборудования и передаёт их в диспетчерскую (Modbus TCP / Ethernet или GSM — по проекту); кабельные линии связи — от каждого агрегата.'
        : '',
      needs.vsd
        ? 'Частотное регулирование — у оборудования заказчика (по ТЗ); кабели питания от преобразователей — экранированные, с заземлением экрана.'
        : '',
    ];
  }

  static _norms(spec) {
    const { ok, plan, req } = spec;
    const prefix = this._h1(spec, 'Безопасность и нормы');
    spec.d.items(
      [
        ok
          ? StationNorms.tt(plan)[0]
          : `Категория помещения по пожарной опасности — ${req.fire}${req.fireAuto ? ' (ориентировочно, уточняется расчётом по СП 12.13130.2009)' : ' (СП 12.13130.2009)'}; табличка с категорией — на двери снаружи.`,
        ...(ok ? StationFire.tt(plan) : []),
        `Уровень звука на рабочем месте — не более ${req.noise} дБА (СанПиН 1.2.3685-21); выше — шумоизоляция контейнера и знак о средствах защиты слуха.`,
        ...(ok ? DrawText.vessels(plan) : []),
        `Климатическое исполнение контейнера${spec.cl ? ` — ${spec.cl[0]}` : ''} по ГОСТ 15150-69; внутри при работе — не ниже +${StationNorms.INSIDE} °C, оборудование — в исполнении для отапливаемых помещений.`,
        spec.r.notes ? `Требования заказчика станции: ${String(spec.r.notes).trim()}` : '',
      ],
      prefix,
    );
  }

  static _tests(spec) {
    const prefix = this._h1(spec, 'Испытания и приёмка');
    spec.d.items(
      [
        'Перед отгрузкой: испытания трубопроводов, измерение сопротивления изоляции кабелей, проверка металлосвязи (заземления), проверка освещения, отопления, вентиляции, сигнализации — с протоколами.',
        'Приёмка — на площадке сборщика с участием заказчика: внешний осмотр, соответствие чертежу и ТЗ, протоколы; замечания устраняются до отгрузки.',
        'Фотоотчёт о монтаже (общий вид, узлы обвязки, шкафы, заземление) — с документами.',
      ],
      prefix,
    );
  }

  static _docs(spec) {
    const prefix = this._h1(spec, 'Документы от сборщика');
    spec.d.items(
      [
        'Паспорт контейнера (блок-контейнера) и руководство по эксплуатации его систем.',
        'Исполнительные схемы: трубопроводов, электрическая принципиальная, расположения оборудования.',
        'Протоколы испытаний (раздел выше), акт приёмки.',
        'Декларации (сертификаты) соответствия, паспорта на оборудование и материалы сборщика (шкафы, арматура, кабели, огнетушители).',
      ],
      prefix,
    );
  }

  static _shipping(spec) {
    const { plan } = spec;
    const prefix = this._h1(spec, 'Упаковка и отгрузка');
    const outside = plan.outside || [];
    const mass = spec.ok ? [...plan.items, ...outside].reduce((sum, i) => sum + (i.mass > 0 ? i.mass : 0), 0) : 0;
    spec.d.items(
      [
        'Оборудование и шкафы закреплены на время перевозки; двери, люки и жалюзи закрыты и опломбированы; открытые патрубки заглушены.',
        plan.roof && plan.roof.length
          ? 'Глушитель ДГУ на время перевозки снимается и закрепляется внутри; выхлоп на крыше — заглушка от осадков.'
          : '',
        outside.length ? 'Ресивер снаружи перевозится отдельно, с заглушками на патрубках.' : '',
        `Строповочные узлы — по схеме строповки сборщика${mass ? `; масса оборудования заказчика — около ${Mm.text(mass)} кг (без контейнера)` : ''}.`,
      ],
      prefix,
    );
  }
}
