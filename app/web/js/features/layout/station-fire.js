import { StationMatrix } from './station-matrix.js';

const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

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

  static get MOD() {
    return StationMatrix.derive('fireMod', () => {
      const f = StationMatrix.grp('fire');
      return {
        name: '«Буран-2,5»',
        area: f.modArea,
        side: f.modSide,
        vol: { A: f.modVolA, B: f.modVolB },
        k1: f.k1,
        k3: f.k3,
        k4: f.k4,
        d: 250,
        h: 154,
        kg: 3,
        z: [f.modZ0, f.modZ1],
      };
    });
  }

  static get SHADE() {
    return StationMatrix.derive('fireShade', () => {
      const f = StationMatrix.grp('fire');
      return { h: f.shadeH, gap: f.shadeGap };
    });
  }

  /** Помещения (оборудование, отсек бака): модули по формулам и по геометрии распыла, огнетушители, категория, зона. */
  static calc(plan) {
    const sys = plan.sys || {};
    const [, W, H] = plan.int;
    const I = plan.items || [];
    const cls = I.some(i => i.kind === 'dgu' || i.kind === 'compressor') ? 'B' : 'A';
    const cat = String((plan.req || {}).fire || '');
    const rooms = StationFire.rooms(plan, cat);
    for (const q of rooms) StationFire.room(q, { W, H, cls, on: !!sys.fire });
    return {
      cat,
      zone: rooms[0].zone,
      cls,
      auto: !!sys.fire,
      ops: !!(sys.ops || sys.fire),
      rooms,
      exit: StationFire.exit(plan),
      exit2: StationFire.exit2(plan),
      mods: rooms.reduce((s, q) => s + q.n, 0),
      ext: rooms.reduce((s, q) => s + q.ext, 0),
      low: !!sys.fire && H < StationFire.MOD.z[0],
    };
  }

  static rooms(plan, cat) {
    const I = plan.items || [];
    const dgu = I.some(i => i.kind === 'dgu');
    const zone = cat && cat !== 'Д' && dgu ? StationFire.ZONE.dgu : '';
    const rooms = [
      {
        id: 'main',
        name: 'помещение оборудования',
        x0: plan.geo.x0 || 0,
        x1: plan.int[0],
        cat,
        zone,
        I: I.filter(i => !i.tank),
      },
    ];
    if (plan.fuel) {
      const { cat: tc, zone: tz } = StationFire.TANK;
      rooms.push({
        id: 'tank',
        name: 'отсек топливного бака',
        x0: 0,
        x1: plan.fuel.x1,
        cat: tc,
        zone: tz,
        I: I.filter(i => i.tank),
      });
    }
    return rooms;
  }

  static room(q, { W, H, cls, on }) {
    const M = StationFire.MOD;
    const k = M.k1 * M.k3 * M.k4;
    const S = ((q.x1 - q.x0) * W) / 1e6;
    const V = (S * H) / 1000;
    Object.assign(q, { area: S, vol: V, nS: (S / M.area) * k, nV: (V / M.vol[cls]) * k });
    q.calc = on ? Math.max(1, Math.ceil(Math.max(q.nS, q.nV) - 1e-6)) : 0;
    const P = on ? StationFire.place(q, W) : { grid: [], shade: [] };
    q.grid = P.grid.length;
    q.shade = P.shade.length;
    q.mods = [...P.grid, ...P.shade];
    for (let j = q.mods.length; j < q.calc; j++) q.mods.push(StationFire.extra(q, W));
    q.n = q.mods.length;
    q.need = q.cat === 'Д' && S <= 100 ? 0 : 1;
    q.ext = 1;
    q.rank = /^[ГД]$/.test(q.cat) ? StationFire.RANK.low : StationFire.RANK.high;
    delete q.I;
  }

  /** Сетка по геометрии распыла (шаг не больше стороны квадрата) и модули над затенёнными зонами. */
  static place(q, W) {
    const a = StationFire.MOD.side;
    const len = q.x1 - q.x0;
    const rows = Math.max(1, Math.ceil(W / a));
    const cols = Math.max(1, Math.ceil(len / a));
    const grid = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++)
        grid.push({
          x: Math.round(q.x0 + (len * (i + 0.5)) / cols),
          y: Math.round((W * (j + 0.5)) / rows),
          shade: false,
        });
    }
    return { grid, shade: StationFire.shade(q, W, a) };
  }

  /** Зоны за агрегатами у стены; агрегаты в пределах одного квадрата — под одним модулем. */
  static shade(q, W, a) {
    const { h, gap } = StationFire.SHADE;
    const Z = [];
    for (const i of q.I.filter(o => o.mount !== 'pipe' && o.mount !== 'wall' && o.h >= h)) {
      const far = i.y + i.ly / 2 > W / 2;
      const back = far ? W - i.y - i.ly : i.y;
      if (back >= gap) Z.push([i.x, i.x + i.lx, far ? W - back / 2 : back / 2]);
    }
    Z.sort((p, r) => p[0] - r[0]);
    const shade = [];
    for (const z of Z) {
      const c = shade.find(m => Math.abs(m.y - z[2]) < 300 && Math.max(m.b, z[1]) - Math.min(m.a, z[0]) <= a);
      if (c) {
        c.a = Math.min(c.a, z[0]);
        c.b = Math.max(c.b, z[1]);
        c.x = Math.round((c.a + c.b) / 2);
      } else {
        shade.push({ a: z[0], b: z[1], x: Math.round((z[0] + z[1]) / 2), y: Math.round(z[2]), shade: true });
      }
    }
    for (const m of shade) {
      m.y = Math.round(Math.min(W - 150, Math.max(150, m.y)));
      delete m.a;
      delete m.b;
    }
    return shade;
  }

  /** Дополнительный модуль по расчёту — в середине наибольшего промежутка по оси помещения. */
  static extra(q, W) {
    const X = [q.x0, ...q.mods.map(m => m.x).sort((a, b) => a - b), q.x1];
    let g = 0;
    for (let i = 1; i < X.length; i++) if (X[i] - X[i - 1] > X[g + 1] - X[g]) g = i - 1;
    return { x: Math.round((X[g] + X[g + 1]) / 2), y: Math.round(W / 2), shade: false };
  }

  /** Выход — дверь оператора: стена, середина проёма, ширина, верх; без прохода внутри — null. */
  static exit(plan) {
    const en = plan.entry;
    if (!en || (en.wall === 'left' && plan.geo.x0)) return null;
    if (en.wall === 'front') return { wall: 'front', u: (en.x0 + en.x1) / 2, w: en.w, top: en.h };
    return { wall: 'left', u: (en.y0 + en.y1) / 2, w: en.w, top: en.sea ? plan.int[2] : en.h };
  }

  /** Второй выход: вторая дверь оператора, калитка в воротах или сами ворота в торце (дальние от входа). */
  static exit2(plan) {
    const d = (plan.doors || []).find(o => o.kind === 'entry');
    if (d) return { wall: d.wall, u: (d.x0 + d.x1) / 2, w: d.w, top: d.h };
    const e = plan.exit;
    if (e) return { wall: e.wall, u: (e.y0 + e.y1) / 2, w: e.w, top: e.h };
    const G = plan.gates;
    if (G && G.wicket) return { wall: G.wall, u: G.y0 + 80 + G.wicket.w / 2, w: G.wicket.w, top: G.wicket.h + 60 };
    const g = [plan.gates, plan.gates2]
      .filter(q => q && !q.sea)
      .sort((a, b) => (b.wall === 'right') - (a.wall === 'right'))[0];
    return g ? { wall: g.wall, u: (g.y0 + g.y1) / 2, w: g.w, top: g.h, gate: true } : null;
  }

  static f1(v) {
    return f1(v);
  }

  /** Число со словом в нужной форме: pl(2, ['светильник', 'светильника', 'светильников']) → «2 светильника». */
  static pl(n, w) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return `${n} ${w[2]}`;
    if (b === 1) return `${n} ${w[0]}`;
    return `${n} ${b > 1 && b < 5 ? w[1] : w[2]}`;
  }

  /** Строка системы «Автоматическое пожаротушение»: модули по расчёту. */
  static autoText(F) {
    if (!F || !F.auto) return '';
    const M = StationFire.MOD;
    const side = String(M.side / 1000).replace('.', ',');
    const room = q =>
      `${q.name} — ${q.n}: S = ${f1(q.area)} м², V = ${f1(q.vol)} м³, по площади S / ${M.area} = ${f1(q.nS)}, по объёму V / ${M.vol[F.cls]} = ${f1(q.nV)}, ` +
      `по геометрии распыла — ${q.grid}${q.shade ? `, над затенёнными зонами за агрегатами — ${q.shade}` : ''}`;
    return (
      `порошковое — модули самосрабатывающие типа ${M.name} на потолке, ${StationFire.pl(F.mods, ['модуль', 'модуля', 'модулей'])} (${F.rooms.map(room).join('; ')}); ` +
      `расчёт по СП 485.1311500.2020, прил. И: пожар класса ${F.cls}, Sн = ${M.area} м² (квадрат ${side} × ${side} м), Vн = ${M.vol[F.cls]} м³, k1 = k3 = k4 = 1,0 (паспорт модуля, табл. И.1), ` +
      `k2 = 1 — модули над затенёнными зонами; высота установки по паспорту — ${f1(M.z[0] / 1000)}–${f1(M.z[1] / 1000)} м; пуск — от теплового замка и от прибора ОПС, при пуске клапаны жалюзи закрываются; ` +
      'табло «Порошок! Уходи!» внутри у выхода, «Порошок! Не входи!» и «Автоматика отключена» — снаружи у входа; запас модулей 100 % — у заказчика или в сервисной организации (п. 10.2.16)'
    );
  }

  /** Пункты ТЗ: огнетушители, сигнализация, табло, таблички и знаки. */
  static tt(plan) {
    const F = plan.fire;
    if (!F) return [];
    return [
      StationFire.extText(F),
      StationFire.opsText(plan, F),
      StationFire.signText(F),
      StationFire.plateText(F),
    ].filter(Boolean);
  }

  static extText(F) {
    const main = F.rooms[0];
    const tank = F.rooms.find(q => q.id === 'tank');
    const rank = tank && tank.rank !== main.rank ? ` (в отсеке бака — ${tank.rank})` : '';
    const need = main.need ? '' : ' (категория Д до 100 м² — по п. 401 можно без него, рекомендуется)';
    const inTank = tank ? `, в отсеке топливного бака — ${tank.ext} у двери` : '';
    return `Огнетушители порошковые ${StationFire.EXT} с рангом тушения не ниже ${main.rank}${rank} (ППР в РФ, прил. 1) — ${F.ext} шт.: в помещении оборудования — ${main.ext} у выхода${need}${inTank}; до огнетушителя — не более ${/^[ГД]$/.test(main.cat) ? 70 : 30} м (п. 406); на видных местах, не за оборудованием, верх — не выше 1,5 м от пола (п. 409), над каждым — знак F04 «Огнетушитель» (ГОСТ 12.4.026-2015).`;
  }

  static opsText(plan, F) {
    if (!F.ops) return '';
    const dgu = plan.items.some(i => i.kind === 'dgu') ? ', у ДГУ — тепловые' : '';
    return `Охранно-пожарная сигнализация (СП 484.1311500.2020): щит ОПС — прибор приёмно-контрольный с резервным питанием${F.auto ? ' и управлением пожаротушением' : ''}, внутри у входа, органы управления на высоте 0,8–1,5 м; извещатели на потолке — дымовые${dgu}; ручной пожарный извещатель и оповещатель — у выхода; датчик открытия двери; сигналы «Пожар», «Неисправность», «Тревога» — на пульт («сухие контакты»).`;
  }

  static signText(F) {
    const ex = F.exit;
    let where = 'у выхода';
    if (ex) where = ex.wall === 'front' ? 'над входной дверью внутри' : 'над воротами внутри';
    const auto = F.auto
      ? '; «Порошок! Уходи!» — рядом с ним; снаружи у входа — «Порошок! Не входи!» и «Автоматика отключена»'
      : '';
    return `Световые табло (с аккумулятором, по ГОСТ Р 53325-2012): «Выход» — ${where}${auto}; надписи — в две строки, высотой не менее 50 мм.`;
  }

  static plateText(F) {
    const main = F.rooms[0];
    const tank = F.rooms.find(q => q.id === 'tank');
    const plate = q => (q.cat && q.cat !== 'Д' ? `«Категория ${q.cat}${q.zone ? `, класс зоны ${q.zone}` : ''}»` : '');
    const door = plate(main) ? `табличка ${plate(main)} (ППР в РФ, п. 12), ` : '';
    const inTank = tank
      ? `; на двери отсека бака — ${plate(tank) ? `табличка ${plate(tank)}, ` : ''}W01 «Пожароопасно. Легковоспламеняющиеся вещества», P02 «Запрещается пользоваться открытым огнём и курить»; у заливной горловины — «ДТ» и W01`
      : '';
    return `Таблички и знаки снаружи: на входной двери — ${door}знаки W08 «Опасность поражения электрическим током» и P06 «Доступ посторонним запрещён»${inTank}. Размер знаков — по расстоянию распознавания (ГОСТ 12.4.026-2015, п. 6.3.4.1), не менее 200 мм; надписи табличек — заглавными буквами не ниже 30 мм, категория — не ниже 80 мм: читаются с 5–10 м.`;
  }
}
