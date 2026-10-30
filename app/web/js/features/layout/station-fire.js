import { StationMatrix } from './station-matrix.js';
import { StationRules } from '../rules/station-rules.js';

/**
 * Пожарная безопасность станции. Огнетушители — ППР в РФ (пп. 401, 405, 406, 409, прил. 1); пожаротушение — модули
 * «Буран-2,5» на потолке, число по СП 485.1311500.2020, прил. И: большее из N = S / Sн · k и N = V / Vн · k; затенение —
 * не коэффициентом, а модулями над зонами за агрегатами у стены (k2 = 1).
 */
export class StationFire {
  static EXT = 'ОП-5(з)';
  static RANK = { high: '3А, 70В, С, Е', low: '2А, 55В, С, Е' };
  static TANK = { cat: 'В1', zone: 'П-I' };
  static ZONE = { dgu: 'П-I' };

  /** Модуль пожаротушения из матрицы. */
  static get MOD() {
    return StationMatrix.derive('fireMod', () => {
      const rule = StationMatrix.grp('fire');
      return {
        name: '«Буран-2,5»',
        area: rule.modArea,
        side: rule.modSide,
        vol: { A: rule.modVolA, B: rule.modVolB },
        k1: rule.k1,
        k3: rule.k3,
        k4: rule.k4,
        d: rule.modD,
        h: rule.modH,
        kg: rule.modKg,
        z: [rule.modZ0, rule.modZ1],
      };
    });
  }

  static get _SHADE() {
    return StationMatrix.derive('fireShade', () => {
      const rule = StationMatrix.grp('fire');
      return { h: rule.shadeH, gap: rule.shadeGap };
    });
  }

  /** Помещения (оборудование, отсек бака): модули по формулам и по геометрии распыла, огнетушители, категория, зона. */
  static calc(plan) {
    const sys = plan.sys || {};
    const [, Wi, Hi] = plan.int;
    const items = plan.items || [];
    const cls = items.some(i => i.kind === 'dgu' || i.kind === 'compressor') ? 'B' : 'A';
    const cat = String((plan.req || {}).fire || '');
    const rooms = StationFire.rooms(plan, cat);
    for (const room of rooms) StationFire.room(room, { W: Wi, H: Hi, cls, on: !!sys.fire });
    return {
      cat,
      zone: rooms[0].zone,
      cls,
      auto: !!sys.fire,
      ops: !!(sys.ops || sys.fire),
      rooms,
      exit: StationFire.exit(plan),
      exit2: StationFire.exit2(plan),
      mods: rooms.reduce((total, room) => total + room.n, 0),
      ext: rooms.reduce((total, room) => total + room.ext, 0),
      detectors: StationFire.detectors(rooms[0]),
      low: !!sys.fire && Hi < StationFire.MOD.z[0],
    };
  }

  /**
   * Извещатели на потолке помещения оборудования (fire.detectors): не меньше min, через step по длине.
   * @param {object} room
   * @returns {number}
   */
  static detectors(room) {
    const rule = StationRules.raw('fire.detectors');
    return Math.max(rule.min, Math.ceil((room.x1 - room.x0) / rule.step));
  }

  /** Защищаемые помещения: основное и топливный отсек. */
  static rooms(plan, cat) {
    const items = plan.items || [];
    const dgu = items.some(i => i.kind === 'dgu');
    const zone = cat && cat !== 'Д' && dgu ? StationFire.ZONE.dgu : '';
    const rooms = [
      {
        id: 'main',
        name: 'помещение оборудования',
        x0: plan.geo.x0 || 0,
        x1: plan.int[0],
        cat,
        zone,
        I: items.filter(i => !i.tank),
      },
    ];
    if (plan.fuel) {
      const { cat: tankCls, zone: tankZone } = StationFire.TANK;
      rooms.push({
        id: 'tank',
        name: 'отсек топливного бака',
        x0: 0,
        x1: plan.fuel.x1,
        cat: tankCls,
        zone: tankZone,
        I: items.filter(i => i.tank),
      });
    }
    return rooms;
  }

  /** Расчёт модулей пожаротушения помещения. */
  static room(room, { W: Wi, H: Hi, cls, on: active }) {
    const mod = StationFire.MOD;
    const k = mod.k1 * mod.k3 * mod.k4;
    const area = ((room.x1 - room.x0) * Wi) / 1e6;
    const volume = (area * Hi) / 1000;
    Object.assign(room, { area, vol: volume, nS: (area / mod.area) * k, nV: (volume / mod.vol[cls]) * k });
    room.calc = active ? Math.max(1, Math.ceil(Math.max(room.nS, room.nV) - 1e-6)) : 0;
    const spots = active ? StationFire.place(room, Wi) : { grid: [], shade: [] };
    room.grid = spots.grid.length;
    room.shade = spots.shade.length;
    room.mods = [...spots.grid, ...spots.shade];
    for (let j = room.mods.length; j < room.calc; j++) room.mods.push(StationFire.extra(room, Wi));
    room.n = room.mods.length;
    room.need = room.cat === 'Д' && area <= 100 ? 0 : 1;
    room.ext = 1;
    room.rank = /^[ГД]$/.test(room.cat) ? StationFire.RANK.low : StationFire.RANK.high;
    delete room.I;
  }

  /** Сетка по геометрии распыла (шаг не больше стороны квадрата) и модули над затенёнными зонами. */
  static place(room, Wi) {
    const side = StationFire.MOD.side;
    const len = room.x1 - room.x0;
    const rows = Math.max(1, Math.ceil(Wi / side));
    const cols = Math.max(1, Math.ceil(len / side));
    const grid = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++)
        grid.push({
          x: Math.round(room.x0 + (len * (i + 0.5)) / cols),
          y: Math.round((Wi * (j + 0.5)) / rows),
          shade: false,
        });
    }
    return { grid, shade: StationFire.shade(room, Wi, side) };
  }

  /** Зоны за агрегатами у стены; агрегаты в пределах одного квадрата — под одним модулем. */
  static shade(room, Wi, side) {
    const { h: minH, gap } = StationFire._SHADE;
    const spans = [];
    for (const i of room.I.filter(unit => unit.mount !== 'pipe' && unit.mount !== 'wall' && unit.h >= minH)) {
      const far = i.y + i.ly / 2 > Wi / 2;
      const back = far ? Wi - i.y - i.ly : i.y;
      if (back >= gap) spans.push([i.x, i.x + i.lx, far ? Wi - back / 2 : back / 2]);
    }
    spans.sort((left, right) => left[0] - right[0]);
    const shade = [];
    for (const z of spans) {
      const near = shade.find(
        mark => Math.abs(mark.y - z[2]) < 300 && Math.max(mark.b, z[1]) - Math.min(mark.a, z[0]) <= side,
      );
      if (near) {
        near.a = Math.min(near.a, z[0]);
        near.b = Math.max(near.b, z[1]);
        near.x = Math.round((near.a + near.b) / 2);
      } else {
        shade.push({ a: z[0], b: z[1], x: Math.round((z[0] + z[1]) / 2), y: Math.round(z[2]), shade: true });
      }
    }
    for (const mark of shade) {
      mark.y = Math.round(Math.min(Wi - 150, Math.max(150, mark.y)));
      delete mark.a;
      delete mark.b;
    }
    return shade;
  }

  /** Дополнительный модуль по расчёту — в середине наибольшего промежутка по оси помещения. */
  static extra(room, Wi) {
    const bounds = [room.x0, ...room.mods.map(mod => mod.x).sort((left, right) => left - right), room.x1];
    let gap = 0;
    for (let i = 1; i < bounds.length; i++) if (bounds[i] - bounds[i - 1] > bounds[gap + 1] - bounds[gap]) gap = i - 1;
    return { x: Math.round((bounds[gap] + bounds[gap + 1]) / 2), y: Math.round(Wi / 2), shade: false };
  }

  /** Выход — дверь оператора: стена, середина проёма, ширина, верх; без прохода внутри — null. */
  static exit(plan) {
    const entry = plan.entry;
    if (!entry || (entry.wall === 'left' && plan.geo.x0)) return null;
    if (entry.wall === 'front') return { wall: 'front', u: (entry.x0 + entry.x1) / 2, w: entry.w, top: entry.h };
    return { wall: 'left', u: (entry.y0 + entry.y1) / 2, w: entry.w, top: entry.sea ? plan.int[2] : entry.h };
  }

  /** Второй выход: вторая дверь оператора, калитка в воротах или сами ворота в торце (дальние от входа). */
  static exit2(plan) {
    const door = (plan.doors || []).find(item => item.kind === 'entry');
    if (door) return { wall: door.wall, u: (door.x0 + door.x1) / 2, w: door.w, top: door.h };
    const exit = plan.exit;
    if (exit) return { wall: exit.wall, u: (exit.y0 + exit.y1) / 2, w: exit.w, top: exit.h };
    const gates = plan.gates;
    if (gates && gates.wicket)
      return { wall: gates.wall, u: gates.y0 + 80 + gates.wicket.w / 2, w: gates.wicket.w, top: gates.wicket.h + 60 };
    const gate = [plan.gates, plan.gates2]
      .filter(candidate => candidate && !candidate.sea)
      .sort((left, right) => (right.wall === 'right') - (left.wall === 'right'))[0];
    return gate ? { wall: gate.wall, u: (gate.y0 + gate.y1) / 2, w: gate.w, top: gate.h, gate: true } : null;
  }

  /** Число с одним знаком после запятой: «1,5». */
  static dec1(v) {
    return String(Math.round(v * 10) / 10).replace('.', ',');
  }

  /** Число со словом в нужной форме: pl(2, ['светильник', 'светильника', 'светильников']) → «2 светильника». */
  static plural(count, words) {
    const mod100 = Math.abs(count) % 100;
    const mod10 = mod100 % 10;
    if (mod100 > 10 && mod100 < 20) return `${count} ${words[2]}`;
    if (mod10 === 1) return `${count} ${words[0]}`;
    return `${count} ${mod10 > 1 && mod10 < 5 ? words[1] : words[2]}`;
  }

  /** Строка системы «Автоматическое пожаротушение»: модули по расчёту. */
  static autoText(fire) {
    if (!fire || !fire.auto) return '';
    const mod = StationFire.MOD;
    const side = String(mod.side / 1000).replace('.', ',');
    const room = part =>
      `${part.name} — ${part.n}: S = ${StationFire.dec1(part.area)} м², V = ${StationFire.dec1(part.vol)} м³, по площади S / ${mod.area} = ${StationFire.dec1(part.nS)}, по объёму V / ${mod.vol[fire.cls]} = ${StationFire.dec1(part.nV)}, ` +
      `по геометрии распыла — ${part.grid}${part.shade ? `, над затенёнными зонами за агрегатами — ${part.shade}` : ''}`;
    return (
      `порошковое — модули самосрабатывающие типа ${mod.name} на потолке, ${StationFire.plural(fire.mods, ['модуль', 'модуля', 'модулей'])} (${fire.rooms.map(room).join('; ')}); ` +
      `расчёт по СП 485.1311500.2020, прил. И: пожар класса ${fire.cls}, Sн = ${mod.area} м² (квадрат ${side} × ${side} м), Vн = ${mod.vol[fire.cls]} м³, k1 = k3 = k4 = 1,0 (паспорт модуля, табл. И.1), ` +
      `k2 = 1 — модули над затенёнными зонами; высота установки по паспорту — ${StationFire.dec1(mod.z[0] / 1000)}–${StationFire.dec1(mod.z[1] / 1000)} м; пуск — от теплового замка и от прибора ОПС, при пуске клапаны жалюзи закрываются; ` +
      'табло «Порошок! Уходи!» внутри у выхода, «Порошок! Не входи!» и «Автоматика отключена» — снаружи у входа; запас модулей 100 % — у заказчика или в сервисной организации (п. 10.2.16)'
    );
  }

  /** Пункты ТЗ: огнетушители, сигнализация, табло, таблички и знаки. */
  static techReqs(plan) {
    const fire = plan.fire;
    if (!fire) return [];
    return [
      StationFire._extText(fire),
      StationFire._opsText(plan, fire),
      StationFire._signText(fire),
      StationFire._plateText(fire),
    ].filter(Boolean);
  }

  /**
   * Наибольшее расстояние до огнетушителя по категории помещения (правило fire.ext_dist); не задана — наименьшее.
   * @param {string} cat категория: «А», «В1», «Г»…
   * @returns {number} м
   */
  static extDistance(cat) {
    const dist = StationRules.raw('fire.ext_dist');
    return dist[String(cat || '').charAt(0)] ?? Math.min(...Object.values(dist));
  }

  static _extText(fire) {
    const main = fire.rooms[0];
    const tank = fire.rooms.find(room => room.id === 'tank');
    const rank = tank && tank.rank !== main.rank ? ` (в отсеке бака — ${tank.rank})` : '';
    const need = main.need ? '' : ' (категория Д до 100 м² — по п. 401 можно без него, рекомендуется)';
    const inTank = tank ? `, в отсеке топливного бака — ${tank.ext} у двери` : '';
    return `Огнетушители порошковые ${StationFire.EXT} с рангом тушения не ниже ${main.rank}${rank} (ППР в РФ, прил. 1) — ${fire.ext} шт.: в помещении оборудования — ${main.ext} у выхода${need}${inTank}; до огнетушителя — не более ${StationFire.extDistance(main.cat)} м (п. 406); на видных местах, не за оборудованием, верх — не выше 1,5 м от пола (п. 409), над каждым — знак F04 «Огнетушитель» (ГОСТ 12.4.026-2015).`;
  }

  static _opsText(plan, fire) {
    if (!fire.ops) return '';
    const dgu = plan.items.some(i => i.kind === 'dgu') ? ', у ДГУ — тепловые' : '';
    return `Охранно-пожарная сигнализация (СП 484.1311500.2020): щит ОПС — прибор приёмно-контрольный с резервным питанием${fire.auto ? ' и управлением пожаротушением' : ''}, внутри у входа, органы управления на высоте 0,8–1,5 м; извещатели на потолке — дымовые${dgu}; ручной пожарный извещатель и оповещатель — у выхода; датчик открытия двери; сигналы «Пожар», «Неисправность», «Тревога» — на пульт («сухие контакты»).`;
  }

  static _signText(fire) {
    const exit = fire.exit;
    let where = 'у выхода';
    if (exit) where = exit.wall === 'front' ? 'над входной дверью внутри' : 'над воротами внутри';
    const auto = fire.auto
      ? '; «Порошок! Уходи!» — рядом с ним; снаружи у входа — «Порошок! Не входи!» и «Автоматика отключена»'
      : '';
    return `Световые табло (с аккумулятором, по ГОСТ Р 53325-2012): «Выход» — ${where}${auto}; надписи — в две строки, высотой не менее 50 мм.`;
  }

  static _plateText(fire) {
    const main = fire.rooms[0];
    const tank = fire.rooms.find(room => room.id === 'tank');
    const plate = room =>
      room.cat && room.cat !== 'Д' ? `«Категория ${room.cat}${room.zone ? `, класс зоны ${room.zone}` : ''}»` : '';
    const door = plate(main) ? `табличка ${plate(main)} (ППР в РФ, п. 12), ` : '';
    const inTank = tank
      ? `; на двери отсека бака — ${plate(tank) ? `табличка ${plate(tank)}, ` : ''}W01 «Пожароопасно. Легковоспламеняющиеся вещества», P02 «Запрещается пользоваться открытым огнём и курить»; у заливной горловины — «ДТ» и W01`
      : '';
    return `Таблички и знаки снаружи: на входной двери — ${door}знаки W08 «Опасность поражения электрическим током» и P06 «Доступ посторонним запрещён»${inTank}. Размер знаков — по расстоянию распознавания (ГОСТ 12.4.026-2015, п. 6.3.4.1), не менее 200 мм; надписи табличек — заглавными буквами не ниже 30 мм, категория — не ниже 80 мм: читаются с 5–10 м.`;
  }
}
