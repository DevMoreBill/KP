// Системы контейнера станции — расчёты по расстановке (StationLayout.run → plan.fire, plan.light, plan.sockets, plan.power,
// plan.pipe), из них — 3D-вид (StOutfit), ТЗ на сборку (TzOut), вкладка «Компоновка» и характеристики станции: пожарная
// безопасность (StationFire), освещение (StationLight), сервисные розетки (StationSockets), электрические нагрузки и вводной
// автомат (StationPower), диаметр трубопровода (StationPipe), масса, центр тяжести и строповка (StationMass), места на
// стенах (StWalls) и жалюзи вентиляции по расчёту (StationVent).
'use strict';

// ---------------------------------------------------------------- пожарная безопасность
// Огнетушители (ППР в РФ): на видных местах вблизи от выходов, верх — не выше 1,5 м от пола, не за оборудованием (п. 409);
// число — по расстоянию до возможного очага: не более 30 м для категорий А, Б, В1–В4 и 70 м для Д (п. 406) — в контейнере
// по одному на помещение (при автоматическом пожаротушении — половина расчётного, не меньше одного, п. 405); помещение
// категории Д площадью до 100 м² огнетушителями можно не оснащать (п. 401) — один у выхода рекомендуется; ранг — по прил. 1:
// категории А, Б, В1–В4 — не ниже 3А, 70В (электрооборудование — 55В, С, Е), Г и Д — 2А, 55В.
// Автоматическое пожаротушение — модули порошкового пожаротушения самосрабатывающие «Буран-2,5-2С» на потолке: тепловой
// замок (180 °C, без питания) и электрический пуск от прибора ОПС. Число — по СП 485.1311500.2020, прил. И: по площади
// N = S / Sн · k1 · k2 · k3 · k4 (И.3) и по объёму N = V / Vн · k1 · k2 · k3 · k4 (И.1) — большее. По паспорту модуля
// (МПП(р)-2,5.02.00.000РЭ): Sн = 7 м² — квадрат 2,64 × 2,64 м под модулем, Vн = 18 м³ (пожар класса A) и 16 м³ (класса B) при
// высоте установки 2,5–3,5 м и негерметичности до 5 %, k1 = 1,0, k4 = 1,0; k3 = 1,0 (табл. И.1: дизельное топливо — 0,9,
// масло — 0,8 — принято с запасом). Геометрия распыла: модули — рядами с шагом не больше стороны квадрата (2,64 м), рядов —
// по ширине помещения. Затенение — не коэффициентом, а модулями над затенёнными зонами: за агрегатами у стены (k2 = 1,
// И.3.1.1); агрегаты в пределах одного квадрата — под одним модулем. Объём помещения — без вычета оборудования (п. 10.2.5);
// клапаны жалюзи закрываются при пуске (п. 10.4.3) — негерметичность не больше паспортной (п. 10.3.2); запас модулей —
// 100 % (п. 10.2.16). Табло: «Выход» — над дверью внутри; при пожаротушении — «Порошок! Уходи!» внутри у выхода, снаружи у
// входа — «Порошок! Не входи!» и «Автоматика отключена» (п. 10.3.1). На двери снаружи — табличка категории помещения по
// пожарной опасности и класса зоны по ПУЭ (ППР в РФ, п. 12; категория Д — без таблички).
class StationFire {
  static MOD = { name:'«Буран-2,5»', area:7, side:2640, vol:{ A:18, B:16 }, k1:1, k3:1, k4:1, d:250, h:154, kg:3, z:[2500, 3500] };
  static SHADE = { h:600, gap:150 };              // затеняет агрегат выше 600 мм; зона за ним — если до стены не меньше 150 мм
  static EXT = 'ОП-5(з)';                         // огнетушитель порошковый, 5 кг: пожары классов A, B, C и электрооборудование до 1000 В
  static RANK = { high:'3А, 70В, С, Е', low:'2А, 55В, С, Е' };   // ППР в РФ, прил. 1: категории А, Б, В1–В4 и Г, Д
  static TANK = { cat:'В1', zone:'П-I' };         // отсек топливного бака ДГУ: дизельное топливо — горючая жидкость
  static ZONE = { dgu:'П-I' };                    // класс зоны по ПУЭ, гл. 7.4: горючие жидкости с температурой вспышки выше 61 °C

  /** расчёт по расстановке: {cat, zone, cls — класс пожара, auto — пожаротушение, ops — сигнализация, ext — огнетушителей,
   *  mods — модулей, rooms: [{id, name, x0, x1, area, vol, nS, nV, calc — по формулам, grid — по геометрии распыла,
   *  shade — над затенёнными зонами, n, ext, need — огнетушителей по ППР, rank, cat, zone, mods: [{x, y, shade}]}], exit, low} */
  static calc(plan){
    const sys=plan.sys||{}, r=plan.req||{}, [L, W, H]=plan.int, x0=plan.geo.x0||0, f=plan.fuel, I=plan.items||[], M=this.MOD;
    const dgu=I.some(i=>i.kind==='dgu'), cls=dgu || I.some(i=>i.kind==='compressor') ? 'B' : 'A', cat=String(r.fire||''), k=M.k1*M.k3*M.k4;
    const rooms=[{ id:'main', name:'помещение оборудования', x0, x1:L, cat, zone:cat && cat!=='Д' && dgu ? this.ZONE.dgu : '', I:I.filter(i=>!i.tank) }];
    if (f) rooms.push({ id:'tank', name:'отсек топливного бака', x0:0, x1:f.x1, cat:this.TANK.cat, zone:this.TANK.zone, I:I.filter(i=>i.tank) });
    for (const q of rooms){
      const S=(q.x1-q.x0)*W/1e6, V=S*H/1000;
      Object.assign(q, { area:S, vol:V, nS:S/M.area*k, nV:V/M.vol[cls]*k });
      q.calc=sys.fire ? Math.max(1, Math.ceil(Math.max(q.nS, q.nV)-1e-6)) : 0;
      const P=sys.fire ? this.place(q, W) : { grid:[], shade:[] };
      q.grid=P.grid.length; q.shade=P.shade.length; q.mods=[...P.grid, ...P.shade];
      for (let j=q.mods.length; j<q.calc; j++) q.mods.push(this.extra(q, W));   // по формулам больше — дополнительные в промежутках
      q.n=q.mods.length;
      // огнетушители: по расстоянию — один; категория Д до 100 м² — можно без них (один у выхода рекомендуется)
      q.need=q.cat==='Д' && S<=100 ? 0 : 1; q.ext=1; q.rank=/^[ГД]$/.test(q.cat) ? this.RANK.low : this.RANK.high;
      delete q.I; }
    return { cat, zone:rooms[0].zone, cls, auto:!!sys.fire, ops:!!(sys.ops || sys.fire), rooms, exit:this.exit(plan),
      mods:rooms.reduce((s, q)=>s+q.n, 0), ext:rooms.reduce((s, q)=>s+q.ext, 0), low:!!sys.fire && H<M.z[0] };
  }
  /** модули на потолке: сетка по геометрии распыла — рядов по ширине, шаг вдоль помещения не больше стороны квадрата, у торцов
   *  — половина шага; над затенёнными зонами — за агрегатами у стены (агрегаты в пределах квадрата — под одним модулем) */
  static place(q, W){
    const M=this.MOD, a=M.side, len=q.x1-q.x0, rows=Math.max(1, Math.ceil(W/a)), cols=Math.max(1, Math.ceil(len/a)), grid=[], shade=[];
    for (let i=0; i<cols; i++) for (let j=0; j<rows; j++) grid.push({ x:Math.round(q.x0+len*(i+0.5)/cols), y:Math.round(W*(j+0.5)/rows), shade:false });
    const Z=[];   // затенённые зоны: [x0, x1, y — середина зазора у стены]
    for (const i of q.I.filter(i=>i.mount!=='pipe' && i.mount!=='wall' && i.h>=this.SHADE.h)){
      const back=i.y+i.ly/2>W/2 ? W-i.y-i.ly : i.y; if (back<this.SHADE.gap) continue;
      Z.push([i.x, i.x+i.lx, i.y+i.ly/2>W/2 ? W-back/2 : back/2]); }
    Z.sort((p, r)=>p[0]-r[0]);
    for (const z of Z){ const c=shade.find(m=>Math.abs(m.y-z[2])<300 && Math.max(m.b, z[1])-Math.min(m.a, z[0])<=a);
      if (c){ c.a=Math.min(c.a, z[0]); c.b=Math.max(c.b, z[1]); c.x=Math.round((c.a+c.b)/2); } else shade.push({ a:z[0], b:z[1], x:Math.round((z[0]+z[1])/2), y:Math.round(z[2]), shade:true }); }
    for (const m of shade){ m.y=Math.round(Math.min(W-150, Math.max(150, m.y))); delete m.a; delete m.b; }
    return { grid, shade };
  }
  /** дополнительный модуль по расчёту — в середине наибольшего промежутка между модулями по оси помещения */
  static extra(q, W){
    const X=[q.x0, ...q.mods.map(m=>m.x).sort((a, b)=>a-b), q.x1]; let g=0;
    for (let i=1; i<X.length; i++) if (X[i]-X[i-1]>X[g+1]-X[g]) g=i-1;
    return { x:Math.round((X[g]+X[g+1])/2), y:Math.round(W/2), shade:false };
  }
  /** выход из помещения оборудования — дверь оператора (front — в стене прохода, left — в торце): стена, середина проёма
   *  вдоль стены, ширина и верх проёма, мм; без прохода внутри (сервисные двери) — null */
  static exit(plan){
    const en=plan.entry; if (!en || (en.wall==='left' && plan.geo.x0)) return null;
    if (en.wall==='front') return { wall:'front', u:(en.x0+en.x1)/2, w:en.w, top:en.h };
    return { wall:'left', u:(en.y0+en.y1)/2, w:en.w, top:en.sea ? plan.int[2] : en.h };
  }
  static f1(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  /** число со словом в нужной форме: pl(2, ['светильник', 'светильника', 'светильников']) → «2 светильника» */
  static pl(n, w){ const a=Math.abs(n)%100, b=a%10; return n+' '+(a>10 && a<20 ? w[2] : b===1 ? w[0] : b>1 && b<5 ? w[1] : w[2]); }
  /** строка системы контейнера «Автоматическое пожаротушение»: модули по расчёту */
  static autoText(F){
    if (!F || !F.auto) return '';
    const f=this.f1, R=F.rooms, M=this.MOD, pl=this.pl;
    const room=q=>`${q.name} — ${q.n}: S = ${f(q.area)} м², V = ${f(q.vol)} м³, по площади S / ${M.area} = ${f(q.nS)}, по объёму V / ${M.vol[F.cls]} = ${f(q.nV)}, `+
      `по геометрии распыла — ${q.grid}${q.shade ? `, над затенёнными зонами за агрегатами — ${q.shade}` : ''}`;
    return `порошковое — модули самосрабатывающие типа ${M.name} на потолке, ${pl(F.mods, ['модуль', 'модуля', 'модулей'])} (${R.map(room).join('; ')}); `+
      `расчёт по СП 485.1311500.2020, прил. И: пожар класса ${F.cls}, Sн = ${M.area} м² (квадрат ${String(M.side/1000).replace('.', ',')} × ${String(M.side/1000).replace('.', ',')} м), Vн = ${M.vol[F.cls]} м³, k1 = k3 = k4 = 1,0 (паспорт модуля, табл. И.1), `+
      `k2 = 1 — модули над затенёнными зонами; высота установки по паспорту — ${f(M.z[0]/1000)}–${f(M.z[1]/1000)} м; пуск — от теплового замка и от прибора ОПС, при пуске клапаны жалюзи закрываются; `+
      'табло «Порошок! Уходи!» внутри у выхода, «Порошок! Не входи!» и «Автоматика отключена» — снаружи у входа; запас модулей 100 % — у заказчика или в сервисной организации (п. 10.2.16)';
  }
  /** пункты ТЗ: огнетушители, сигнализация, табло, таблички и знаки */
  static tt(plan){
    const F=plan.fire; if (!F) return [];
    const main=F.rooms[0], tank=F.rooms.find(q=>q.id==='tank'), ex=F.exit;
    const plate=q=>q.cat && q.cat!=='Д' ? `«Категория ${q.cat}${q.zone ? `, класс зоны ${q.zone}` : ''}»` : '';
    return [
      `Огнетушители порошковые ${this.EXT} с рангом тушения не ниже ${main.rank}${tank && tank.rank!==main.rank ? ` (в отсеке бака — ${tank.rank})` : ''} (ППР в РФ, прил. 1) — ${F.ext} шт.: в помещении оборудования — ${main.ext} у выхода${main.need ? '' : ' (категория Д до 100 м² — по п. 401 можно без него, рекомендуется)'}${tank ? `, в отсеке топливного бака — ${tank.ext} у двери` : ''}; до огнетушителя — не более ${/^[ГД]$/.test(main.cat) ? 70 : 30} м (п. 406); на видных местах, не за оборудованием, верх — не выше 1,5 м от пола (п. 409), над каждым — знак F04 «Огнетушитель» (ГОСТ 12.4.026-2015).`,
      F.ops ? `Охранно-пожарная сигнализация (СП 484.1311500.2020): щит ОПС — прибор приёмно-контрольный с резервным питанием${F.auto ? ' и управлением пожаротушением' : ''}, внутри у входа, органы управления на высоте 0,8–1,5 м; извещатели на потолке — дымовые${plan.items.some(i=>i.kind==='dgu') ? ', у ДГУ — тепловые' : ''}; ручной пожарный извещатель и оповещатель — у выхода; датчик открытия двери; сигналы «Пожар», «Неисправность», «Тревога» — на пульт («сухие контакты»).` : '',
      `Световые табло (с аккумулятором, по ГОСТ Р 53325-2012): «Выход» — ${ex ? (ex.wall==='front' ? 'над входной дверью внутри' : 'над воротами внутри') : 'у выхода'}${F.auto ? '; «Порошок! Уходи!» — рядом с ним; снаружи у входа — «Порошок! Не входи!» и «Автоматика отключена»' : ''}; надписи — в две строки, высотой не менее 50 мм.`,
      `Таблички и знаки снаружи: на входной двери — ${plate(main) ? `табличка ${plate(main)} (ППР в РФ, п. 12), ` : ''}знаки W08 «Опасность поражения электрическим током» и P06 «Доступ посторонним запрещён»${tank ? `; на двери отсека бака — ${plate(tank) ? `табличка ${plate(tank)}, ` : ''}W01 «Пожароопасно. Легковоспламеняющиеся вещества», P02 «Запрещается пользоваться открытым огнём и курить»; у заливной горловины — «ДТ» и W01` : ''}. Размер знаков — по расстоянию распознавания (ГОСТ 12.4.026-2015, п. 6.3.4.1), не менее 200 мм; надписи табличек — заглавными буквами не ниже 30 мм, категория — не ниже 80 мм: читаются с 5–10 м.`,
    ].filter(Boolean);
  }
}

// ---------------------------------------------------------------- освещение
// Основное — светодиодные светильники IP65 по 36 Вт (3600 лм) в ряд по оси помещения: число — методом коэффициента
// использования N = E · S · Кз / (Φ · η) по освещённости E = 200 лк в горизонтальной плоскости 0,8 м от пола
// (СП 52.13330.2016, табл. Л.2: компрессорные, машинные залы насосных, электромашинные помещения), Кз = 1,4; η — по индексу
// помещения i = S / (h · (A + B)), h — от светильника до рабочей плоскости, для светлых стен и потолка; не меньше двух и не
// реже чем через 1,5 h. Аварийное — половина светильников (не меньше одного, первый — у выхода) с блоками аварийного питания
// на 1 ч: на полу по оси прохода — не менее 1 лк, у выхода, огнетушителя и щита ОПС — не менее 5 лк (табл. 7.28); табло
// «Выход» — с аккумулятором. Отсек топливного бака и тамбур — по круглому светильнику 15 Вт IP65; снаружи над дверями —
// светодиодные прожекторы 30 Вт IP65 с фотореле и блоком аварийного питания (перед выходом — не менее 5 лк).
class StationLight {
  static get LUX(){ return StationRules.raw('norm.lux').lux; }
  static PLANE = 800;         // рабочая плоскость над полом, мм
  static get KZ(){ return StationRules.raw('norm.lux').kz; }
  static LAMP = { w:36, lm:3600, len:1200 };
  static SMALL = 15;          // круглый светильник в отсеке бака и тамбуре, Вт
  static FLOOD = 30;          // прожектор над дверью, Вт
  static EXIT = 3;            // табло «Выход» с аккумулятором, Вт
  static ETA = [[0.5, 0.34], [0.6, 0.39], [0.8, 0.46], [1, 0.51], [1.25, 0.56], [1.5, 0.6], [2, 0.65], [2.5, 0.69], [3, 0.71], [4, 0.74], [5, 0.76]];
  /** коэффициент использования по индексу помещения (линейно между точками таблицы) */
  static eta(i){
    const T=this.ETA; if (i<=T[0][0]) return T[0][1]; if (i>=T[T.length-1][0]) return T[T.length-1][1];
    for (let k=1; k<T.length; k++) if (i<=T[k][0]){ const [a, x]=T[k-1], [b, y]=T[k]; return x+(y-x)*(i-a)/(b-a); }
    return T[T.length-1][1];
  }
  /** расчёт: {on, lux, n, em, eta, i, area, E — получится, лк, small — светильников в отсеке и тамбуре, floods, kw} */
  static calc(plan){
    const sys=plan.sys||{}, [L, W, H]=plan.int, x0=plan.geo.x0||0, f=plan.fuel, A=(L-x0)/1000, B=W/1000, h=Math.max(0.8, (H-this.PLANE)/1000), S=A*B;
    const i=S/(h*(A+B)), eta=this.eta(i), M=this.LAMP;
    const n=Math.max(2, Math.ceil(this.LUX*S*this.KZ/(M.lm*eta)-1e-9), Math.ceil(A/(1.5*h)));
    const tb=x0-(f ? f.x1+f.part : 0), small=(f ? 1 : 0)+(tb>0 ? 1 : 0);
    const floods=(plan.entry && !plan.entry.sea ? 1 : 0)+(f ? 1 : 0);   // прожектор над дверью оператора и дверью отсека бака
    const on=sys.light!==false, kw=on ? (n*M.w+small*this.SMALL+floods*this.FLOOD+this.EXIT)/1000 : 0;
    return { on, lux:this.LUX, n, em:Math.max(1, Math.ceil(n/2)), eta, i, area:S, E:n*M.lm*eta/(S*this.KZ), small, floods, kw };
  }
  /** строка системы контейнера «Освещение» */
  static text(Lt){
    if (!Lt || !Lt.on) return '';
    const f=StationFire.f1, M=this.LAMP, pl=StationFire.pl;
    return `основное — ${pl(Lt.n, ['светодиодный светильник', 'светодиодных светильника', 'светодиодных светильников'])} IP65 по ${M.w} Вт (${M.lm} лм) в ряд под потолком: около ${Math.round(Lt.E)} лк на рабочей плоскости 0,8 м при норме ${Lt.lux} лк `+
      `(СП 52.13330.2016, табл. Л.2; метод коэффициента использования: S = ${f(Lt.area)} м², индекс помещения ${f(Lt.i)}, η = ${String(Math.round(Lt.eta*100)/100).replace('.', ',')}, Кз = ${String(this.KZ).replace('.', ',')}); `+
      `аварийное — ${pl(Lt.em, ['светильник', 'светильника', 'светильников'])} из них — с блоком аварийного питания на 1 ч (на полу по оси прохода — не менее 1 лк, у выхода, огнетушителя и щита ОПС — не менее 5 лк; табл. 7.28), табло «Выход» над дверью — с аккумулятором`+
      `${Lt.small ? `; отсек топливного бака${Lt.small>1 ? ' и тамбур' : ''} — по светильнику ${this.SMALL} Вт IP65` : ''}${Lt.floods ? `; снаружи над дверями — светодиодные прожекторы ${this.FLOOD} Вт IP65 с фотореле и блоком аварийного питания (перед выходом — не менее 5 лк), ${Lt.floods} шт.` : ''}`;
  }
}

// ---------------------------------------------------------------- сервисные розетки
// Для обслуживания и ремонта: 230 В 16 А IP54 с заземляющим контактом через УЗО 30 мА — у входа и у оборудования, одна на
// каждые 4 м длины помещения, не меньше двух; 380 В 16 А IP54 (3P+N+PE) — у основного оборудования; ящик с понижающим
// трансформатором ЯТП-0,25 (220/36 В) — у входа, для переносных светильников (помещение с повышенной опасностью: металлический
// пол, ПУЭ, п. 6.1.16 — переносные светильники не выше 50 В). Высота — 1,0 м от пола.
class StationSockets {
  static calc(plan){
    if ((plan.sys||{}).power===false) return null;
    const [L]=plan.int, x0=plan.geo.x0||0;
    return { n230:Math.max(2, Math.ceil((L-x0)/4000)), n380:1, ytp:1, z:1000 };
  }
  static text(K){
    return K ? `сервисные розетки: 230 В 16 А IP54 с заземляющим контактом — ${K.n230} шт. (у входа и у оборудования, через УЗО 30 мА), 380 В 16 А IP54 (3P+N+PE) — ${K.n380} шт. у основного оборудования, ящик ЯТП-0,25 (220/36 В) для переносных светильников — ${K.ytp} шт. у входа; высота — 1,0 м от пола` : '';
  }
}

// ---------------------------------------------------------------- электрические нагрузки станции
// Установленная мощность — сумма всех потребителей; расчётная — по наибольшему из режимов: «работа» (рабочие агрегаты без
// резервных, собственные нужды, подогрев воздуха, если тепла оборудования не хватает) и «простой зимой» (отопление на
// полную мощность, подогреватель ДГУ, собственные нужды); розеточная сеть — с коэффициентом спроса. Ток — при 3 × 400 В и
// cos φ 0,85; вводной автомат — ближайший номинал не меньше 1,25 расчётного тока. У ДГУ — собственные нужды станции (от
// сети через АВР в ожидании, при работе — от ДГУ).
class StationPower {
  static get U(){ return StationRules.raw('el.u'); }
  static get COS(){ return StationRules.raw('el.cos'); }
  static get BREAKERS(){ return StationRules.raw('el.breakers'); }
  static f(v){ return String(Math.abs(v)<1 ? Math.round(v*100)/100 : Math.round(v*10)/10).replace('.', ','); }
  /** мощность осушителя, кВт: по паспорту или оценка по производительности (рефрижераторный — 0,2 кВт на 1 м³/мин) */
  static dryer(i){ if (i.kw>0) return i.kw; const q=i.air && i.air.flow>0 ? i.air.flow : 0, t=i.air && i.air.type; return t==='refrig' || !t ? Math.max(0.3, Math.round(q*0.2*10)/10) : 0.1; }
  /** потребители: [{name, n, kw — за единицу, kc, run — работает в режиме «работа», idle — в «простое»}] и итоги */
  static calc(plan){
    const I=plan.items||[], r=plan.req||{}, h=plan.heat, Lt=plan.light, K=plan.sockets, F=plan.fire, out=[];
    const add=(name, n, kw, kc, run, idle)=>{ if (n>0 && kw>0) out.push({ name, n, kw:Math.round(kw*100)/100, kc, run, idle }); };
    const group=(kind, name, kwOf)=>{ const L=I.filter(i=>i.kind===kind && !i.tank); if (!L.length) return;
      const res=kind===(r.kind==='pump' ? 'pump' : 'compressor') ? Math.max(0, Math.min(L.length-1, Math.round(r.res||0))) : 0, kws=L.map(kwOf).sort((a, b)=>b-a);
      const work=kws.slice(0, L.length-res), spare=kws.slice(L.length-res), same=kws.every(v=>Math.abs(v-kws[0])<1e-6);
      if (same) { add(name, work.length, kws[0], 1, true, false); add(name+' — резервный', spare.length, kws[0], 0, false, false); }
      else { for (const v of work) add(name, 1, v, 1, true, false); for (const v of spare) add(name+' — резервный', 1, v, 0, false, false); } };
    group('compressor', 'Компрессор', i=>i.kw>0 ? i.kw : 0);
    group('pump', 'Насосный агрегат', i=>i.kw>0 ? i.kw : 0);
    group('dryer', 'Осушитель', i=>this.dryer(i));
    const dgu=I.find(i=>i.kind==='dgu');
    if (dgu){ add('Подогреватель двигателя ДГУ', 1, dgu.kw>250 ? 3 : 2, 1, false, true); add('Зарядное устройство АКБ ДГУ', 1, 0.1, 1, true, true);
      if (plan.fuel) add('Насос перекачки топлива', 1, 0.37, 1, true, true); }
    if (h && h.on && h.total>0) add(`Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт`, 1, h.total, 1, false, true);
    if (h && h.on && h.qRun>0) out.push({ name:'Подогрев воздуха при работе (часть конвекторов)', n:1, kw:0, kc:1, run:true, idle:false, extra:Math.round(h.qRun/10)/100 });
    if (Lt && Lt.on) add('Освещение (основное, аварийное, прожекторы)', 1, Lt.kw, 1, true, true);
    if (K){ add('Розетки 230 В (группа 16 А)', 1, 3.5, 0.3, true, true); add('Розетка 380 В 16 А', 1, 11, 0.2, true, true); add('ЯТП-0,25 (36 В)', 1, 0.25, 0.5, true, true); }
    if ((plan.sys||{}).vent!==false) add('Клапаны вентиляции с электроприводами', 1, 0.05, 1, true, true);
    if (F && F.ops) add(`Щит ОПС${F.auto ? ' и пожаротушения' : ''}`, 1, 0.05, 1, true, true);
    if (I.some(i=>i.kind==='cabinet' && /АСУ|диспетч/i.test(i.name||''))) add('Шкаф АСУ ТП', 1, 0.3, 1, true, true);
    const inst=out.reduce((s, q)=>s+q.n*q.kw, 0), mode=k=>out.reduce((s, q)=>s+(q[k] ? q.n*q.kw*q.kc+(q.extra||0) : 0), 0);
    const run=mode('run'), idle=mode('idle'), P=Math.max(run, idle), A=P*1000/(Math.sqrt(3)*this.U*this.COS);
    return { list:out, inst:Math.round(inst*10)/10, run:Math.round(run*10)/10, idle:Math.round(idle*10)/10, kw:Math.round(P*10)/10, mode:run>=idle ? 'run' : 'idle',
      amp:Math.round(A*10)/10, breaker:this.BREAKERS.find(b=>b>=A*StationRules.raw('el.breaker_k')) || null, dgu:!!dgu };
  }
  /** строки итога: для ТЗ и вкладки «Компоновка» */
  static lines(W){
    if (!W) return [];
    const f=this.f, own=W.dgu ? 'собственные нужды станции' : 'станция';
    return [`Установленная мощность (оборудование и системы контейнера) — ${f(W.inst)} кВт; расчётная (${own}) — ${f(W.kw)} кВт: ${W.mode==='run' ? 'при работе оборудования' : 'зимой при остановленном оборудовании (отопление)'}; при работе — ${f(W.run)} кВт, в простое зимой — ${f(W.idle)} кВт.`,
      `Ввод — 3 × 400 В, 50 Гц: расчётный ток ${f(W.amp)} А (cos φ ${String(this.COS).replace('.', ',')}); вводной автомат — ${W.breaker ? W.breaker+' А' : 'по проекту'}${W.dgu ? '' : `; выделяемая мощность — не менее ${f(W.kw)} кВт`}.`];
  }
}

// ---------------------------------------------------------------- диаметр трубопровода
// По расходу и допустимой скорости: d = √(4 · Q / (π · v)), внутренний диаметр — ближайший больший из ряда DN (трубы
// стальные по ГОСТ 3262 и ГОСТ 8732). Сжатый воздух — расход при рабочем давлении Q = Qсв · 1,013 / (p + 1,013), скорость в
// магистрали станции — не более 8 м/с (малые потери давления, конденсат не уносится к потребителю); вода — подача рабочих
// насосов (без резервных): напорный коллектор — не более 2 м/с, всасывающий — 1,2 м/с; дизельное топливо — 1,5 м/с по подаче
// насоса перекачки (около 2,4 м³/ч). DN в составе меньше расчётного — замечание в компоновке.
class StationPipe {
  static DN = [[15, 15.7], [20, 20.9], [25, 26.6], [32, 35.1], [40, 40.9], [50, 52.5], [65, 68], [80, 80.9], [100, 106], [125, 131], [150, 156], [200, 207], [250, 259], [300, 309]];
  static get V(){ return StationRules.raw('el.pipe_v'); }
  static FUEL = 2.4;          // подача насоса перекачки топлива, м³/ч
  /** DN по внутреннему диаметру, мм */
  static dn(d){ const r=this.DN.find(([, di])=>di>=d-1e-9); return r ? r[0] : this.DN[this.DN.length-1][0]; }
  static inner(dn){ const r=this.DN.find(([n])=>n===dn); return r ? r[1] : dn; }
  /** расчёт: {medium, why — откуда расход, lines: [{name, v — допустимая, d — нужный внутренний, мм, dn, vAct — при этом DN}],
   *  dn — магистрали (напорной), set — DN в составе (0 — не указан), small — указан меньше расчётного} или null */
  static calc(plan){
    const P=plan.piping||[], pp=P.find(p=>p.pos!=null) || P[0]; if (!(plan.lines||[]).length) return null;
    const set=pp ? +(String(pp.dn||'').match(/\d+/)||[0])[0] || 0 : 0, I=plan.items||[], r=plan.req||{}, f=StationFire.f1, lines=[];
    const add=(name, q, v)=>{ const d=Math.sqrt(4*q/(Math.PI*v))*1000, dn=this.dn(d), di=this.inner(dn)/1000; lines.push({ name, v, d:Math.round(d*10)/10, dn, vAct:Math.round(q/(Math.PI*di*di/4)*10)/10 }); };
    let medium='', why='';
    const pumps=I.filter(i=>i.kind==='pump' && i.flow>0).map(i=>i.flow).sort((a, b)=>b-a);
    if (plan.air && plan.air.q>0){ const bar=plan.air.bar||8, q=plan.air.q/60*1.013/(bar+1.013); medium='air';
      add('магистраль сжатого воздуха', q, this.V.air); why=`${f(plan.air.q)} м³/мин при ${f(bar)} бар — ${f(q*60)} м³/мин в трубе`; }
    else if (pumps.length){ const n=Math.max(1, pumps.length-Math.max(0, Math.round(r.res||0))), Q=pumps.slice(0, n).reduce((s, v)=>s+v, 0)/3600; medium='water';
      add('напорный коллектор', Q, this.V.out); add('всасывающий коллектор', Q, this.V.in); why=`подача рабочих насосов ${f(Q*3600)} м³/ч`; }
    else if (plan.fuel){ medium='fuel'; add('топливопровод', this.FUEL/3600, this.V.fuel); why=`подача насоса перекачки около ${f(this.FUEL)} м³/ч`; }
    if (!lines.length) return null;
    const dn=lines[0].dn;
    return { medium, why, lines, dn, set, small:set>0 && set<dn };
  }
  /** пункт ТЗ и строка «Компоновки»: DN по расчёту */
  static text(Q){
    if (!Q) return '';
    const f=StationFire.f1;
    return `диаметр — по расчёту (${Q.why}): ${Q.lines.map(l=>`${l.name} — DN ${l.dn} (внутри не менее ${f(l.d)} мм при скорости не более ${f(l.v)} м/с)`).join(', ')}`+
      (Q.set ? (Q.small ? `; в составе указан DN ${Q.set} — меньше расчётного, принять DN ${Q.dn}` : `; в составе — DN ${Q.set}`) : '');
  }
}

// ---------------------------------------------------------------- масса и центр тяжести, строповка
// Масса станции при подъёме: контейнер (морской — тара по ISO 668 и утепление изнутри; блок-контейнер и цельносварной —
// оценка: рама — по длине, стены и кровля — по площади, пол — рифлёный лист на лагах), оборудование внутри и на крыше —
// по паспортной массе (без неё не учтено — центр тяжести ориентировочный), трубопровод, кабели и системы — 5 % массы
// оборудования и 100 кг. Ресиверы снаружи стоят на своей площадке — в массу не входят. Центр тяжести — от наружного
// угла у входа: X — вдоль контейнера от торца у входа, Y — от лицевой стены (со стороны прохода), Z — от низа; у агрегата
// на полу — на 0,4 высоты (тяжёлое внизу), у контейнера — на 0,42 высоты. Строповка блок-контейнера — четырёхветвевым
// стропом за петли в верхних углах: крюк — над центром тяжести, угол ветви с вертикалью — не более 45° (между ветвями — не
// более 90°, ТОИ Р-66-18-93), длины ветвей — по расчёту; длиннее 6,5 м — с траверсой. Морской контейнер с грузом за верхние
// фитинги (ISO 1161) наклонными стропами не поднимают (ISO 3874; ICHCA, 2022) — только рамной траверсой (спредером): ветви к
// фитингам вертикальны, рама подвешена над центром тяжести. Знаки по ГОСТ 14192-96: № 9 «Место строповки» — у каждой точки
// строповки с двух сторон (п. 5.5.1), № 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести (п. 5.5.2).
class StationMass {
  static TARE = { sea10:1300, sea20:2250, sea20hc:2350, sea40:3750, sea40hc:3900 };   // кг, ISO 668 — типичная тара
  static FRAME = 110;        // рама блок-контейнера, кг на 1 м длины
  static PANEL = { block:22, north:27, welded:38 };   // стены и кровля, кг/м²: сэндвич-панели 100 мм, «Север», профлист с каркасом
  static LINING = 12;        // утепление и обшивка морского контейнера изнутри, кг/м²
  static FLOOR = 45;         // пол: рифлёный лист 4 мм на лагах, кг/м²
  static OTHER = [0.05, 100];   // трубопровод, кабели, системы: доля массы оборудования и постоянная часть, кг
  static ANGLE = 45;         // наибольший угол ветви стропа с вертикалью, °
  static LUG = [90, 60];     // точка строповки от торца и от боковой стены (наружные), мм

  /** {mass, cont, eq, other, cg:{x, y, z}, missing:[поз.], sling:{hook — высота крюка над крышей, legs:[{x, y, len, deg}], beam,
   *  frame}} */
  static calc(plan){
    const g=plan.geo; if (!g || !g.ext || !plan.int) return null;
    const [Le, We, He]=g.ext, [Li, Wi]=plan.int, ox=(Le-Li)/2, oy=(We-Wi)/2, zf=StationGeo.zFloor(g.type, g.t), m=v=>v/1000;
    let cont;
    if (g.sea) cont=(this.TARE[g.type] || 2250*Le/6058)+(g.t>0 ? this.LINING*2*(m(Li)*m(Wi)+m(Li)*m(He)+m(Wi)*m(He)) : 0);
    else cont=this.FRAME*m(Le)+(this.PANEL[g.type]||this.PANEL.block)*(2*m(Le)*m(He)+2*m(We)*m(He)+m(Le)*m(We))+this.FLOOR*m(Le)*m(We);
    const P=[{ m:cont, x:Le/2, y:We/2, z:He*0.42 }], missing=[];
    let eq=0;
    for (const it of plan.items||[]){ if (!(it.mass>0)){ if (!missing.includes(it.pos)) missing.push(it.pos); continue; }
      const low=it.mount==='floor' || it.mount==='frame'; eq+=it.mass;
      P.push({ m:it.mass, x:ox+it.x+it.lx/2, y:oy+it.y+it.ly/2, z:zf+it.z+it.h*(low ? 0.4 : 0.5) }); }
    for (const r of plan.roof||[]){ if (!(r.mass>0)){ if (!missing.includes(r.pos)) missing.push(r.pos); continue; }
      eq+=r.mass; P.push({ m:r.mass, x:ox+r.x+r.lx/2, y:oy+r.y+r.ly/2, z:He+r.gap+r.d/2 }); }
    const other=eq*this.OTHER[0]+this.OTHER[1]; P.push({ m:other, x:Le/2, y:We/2, z:He*0.3 });
    const M=P.reduce((s, q)=>s+q.m, 0), c=k=>P.reduce((s, q)=>s+q.m*q[k], 0)/M;
    const cg={ x:Math.round(c('x')), y:Math.round(c('y')), z:Math.round(c('z')) };
    return { mass:Math.round(M/10)*10, cont:Math.round(cont/10)*10, eq:Math.round(eq), other:Math.round(other), cg, missing:missing.sort((a, b)=>a-b), sling:this.sling(Le, We, cg, g.sea) };
  }
  static BEAM = { L:6500, z:2000, top:1500 };   // длиннее L — траверса: ветви до неё z, от неё до крюка top, мм
  static SPREADER = { z:1500, d:1500, top:2000 };   // рамная траверса морского контейнера: высота рамы, проушины ± d от ЦТ, до крюка top
  /** строповка: точки в верхних углах, крюк над центром тяжести на высоте, при которой угол каждой ветви с вертикалью — не
   *  больше ANGLE; длины ветвей — с округлением до 100 мм вверх. Длинный блок-контейнер — с траверсой над ним (ветви от точек
   *  строповки к траверсе, траверса подвешена над центром тяжести). Морской (sea) — рамной траверсой: четыре вертикальные
   *  ветви к фитингам, к крюку — двухветвевой строп от проушин рамы над центром тяжести.
   *  {hook, beam:{z, x0, x1}|null, frame:{z, x0, x1, y0, y1, lugs, top, len, deg}|null, legs} */
  static sling(Le, We, cg, sea){
    const [a, b]=this.LUG, pts=[[a, b], [Le-a, b], [a, We-b], [Le-a, We-b]], B=this.BEAM, r=v=>Math.ceil(v/100)*100, deg=(d, h)=>Math.round(Math.atan2(d, h)*180/Math.PI);
    if (sea){ const F=this.SPREADER, d=Math.min(F.d, Math.round(Le/4)), lugs=[Math.max(a, cg.x-d), Math.min(Le-a, cg.x+d)], h=Math.max(...lugs.map(x=>Math.abs(x-cg.x)));
      return { hook:F.z+F.top, beam:null, frame:{ z:F.z, x0:a, x1:Le-a, y0:b, y1:We-b, lugs, top:F.top, len:r(Math.hypot(h, F.top)), deg:deg(h, F.top) },
        legs:pts.map(([x, y])=>({ x, y, len:r(F.z), deg:0 })) }; }
    if (Le>B.L) return { hook:B.z+B.top, beam:{ z:B.z, x0:a, x1:Le-a }, frame:null, legs:pts.map(([x, y])=>{ const d=Math.abs(y-cg.y); return { x, y, len:r(Math.hypot(d, B.z)), deg:deg(d, B.z) }; }) };
    const d=pts.map(([x, y])=>Math.hypot(x-cg.x, y-cg.y)), hook=r(Math.max(...d)/Math.tan(this.ANGLE*Math.PI/180));
    return { hook, beam:null, frame:null, legs:pts.map(([x, y], i)=>({ x, y, len:r(Math.hypot(d[i], hook)), deg:deg(d[i], hook) })) };
  }
  /** строка технической характеристики: масса станции */
  static text(Ms){ return Ms ? `Масса станции — около ${StationLayout.n(Ms.mass)} кг${Ms.missing.length ? ` (без поз. ${Ms.missing.join(', ')} — масса не указана)` : ''}` : ''; }
}

// ---------------------------------------------------------------- места на стенах помещения оборудования (3D-вид, жалюзи)
// Стены: left — у начала помещения (торец или перегородка отсека / тамбура), right — дальний торец, back — задняя,
// front — со стороны прохода (зрителя). u — вдоль стены (left/right — y, back/front — x), z — от пола, мм.
class StWalls {
  static NEAR = 450;      // оборудование ближе к стене — место перед ним занято (до его высоты + 150 мм)
  /** o.equip=false — оборудование на полу и трубопровод место на стене не занимают (жалюзи за компрессором — забор воздуха) */
  constructor(plan, o={}){
    const [L, W, H]=plan.int, x0=plan.geo.x0||0, I=(plan.items||[]).filter(i=>!i.tank), N=StWalls.NEAR;
    this.L=L; this.W=W; this.x0=x0; this.B={ left:[], right:[], back:[], front:[] }; this.S={ left:[], right:[], back:[], front:[] };   // S — «мягкие» запреты (shade)
    for (const i of I){
      if (i.mount==='wall'){ this.busy(i.wall, ...(i.wall==='front' || i.wall==='back' ? [i.x, i.x+i.lx] : [i.y, i.y+i.ly]), i.z, i.z+i.h); continue; }
      if (i.mount==='pipe' || o.equip===false) continue;
      const top=(i.z||0)+i.h+150;
      if (i.y<N) this.busy('front', i.x, i.x+i.lx, 0, top);
      if (W-i.y-i.ly<N) this.busy('back', i.x, i.x+i.lx, 0, top);
      if (i.x-x0<N) this.busy('left', i.y, i.y+i.ly, 0, top);
      if (L-i.x-i.lx<N) this.busy('right', i.y, i.y+i.ly, 0, top); }
    for (const h of (plan.heat && plan.heat.heaters)||[]) this.busy(h.wall, ...(h.wall==='front' || h.wall==='back' ? [h.x, h.x+h.lx] : [h.y, h.y+h.ly]), 0, h.z+h.h+100);
    const en=plan.entry, G=plan.gates;   // дверь оператора, ворота в торце (у морского — его двери): изнутри на них ничего не вешать
    if (en) this.busy(en.wall, ...(en.wall==='front' ? [en.x0-100, en.x1+100] : [en.y0-100, en.y1+100]), 0, en.h+150);
    if (G) this.busy(G.wall, G.y0-100, G.y1+100, 0, G.h+150);
    for (const d of plan.doors||[]) this.busy(d.wall==='back' ? 'back' : 'front', d.x0-100, d.x1+100, 0, d.h+150);
    if (o.equip!==false) for (const l of plan.lines||[]) if (W-l.y<500) for (const [a, b] of StationLayout.runs(l)) this.busy('back', a, b, l.z-100, l.z+100);   // жалюзи за трубой — можно
    if ((plan.sys||{}).power!==false) this.busy('back', x0, L, H-320, H);   // кабельный лоток под потолком
  }
  busy(w, u0, u1, z0, z1){ if (this.B[w]) this.B[w].push([u0, u1, z0, z1]); }
  /** для огнетушителей и щитов — «мягкие» запреты: стены за оборудованием (на любом расстоянии от стены — к месту не
   *  подойти, из прохода его не видно) и стена прохода там, где проход узкий (огнетушитель сузит путь эвакуации) */
  shade(plan){
    const [L, W]=plan.int, x0=plan.geo.x0||0, a=(plan.aisleRule||[1000, 800])[1]+250, S=(w, u0, u1, z1)=>this.S[w].push([u0, u1, 0, z1]);
    for (const i of plan.items||[]){ if (i.tank || i.mount==='pipe' || i.mount==='wall') continue; const top=(i.z||0)+i.h+150;
      if (i.y+i.ly>W/2) S('back', i.x-50, i.x+i.lx+50, top);
      if (i.y<a) S('front', i.x-50, i.x+i.lx+50, top);
      if (L-i.x-i.lx<1200) S('right', i.y-50, i.y+i.ly+50, top);
      if (i.x-x0<1200) S('left', i.y-50, i.y+i.ly+50, top); }
  }
  /** участок свободен; soft — с «мягкими» запретами */
  free(w, u0, u1, z0, z1, soft=true){ const ok=q=>!(q[0]<u1 && q[1]>u0 && q[2]<z1 && q[3]>z0); return (this.B[w]||[]).every(ok) && (!soft || (this.S[w]||[]).every(ok)); }
  range(w){ return w==='left' || w==='right' ? [0, this.W] : [this.x0, this.L]; }
  /** начало свободного участка шириной wd на высоте z0…z1: от начала стены (lo) или от конца (hi); ok(u) — ещё условие;
   *  нет — null */
  find(w, wd, z0, z1, from='lo', ok){
    const [lo, hi]=this.range(w), good=u=>this.free(w, u, u+wd, z0, z1) && (!ok || ok(u));
    if (from==='lo'){ for (let u=lo+120; u+wd<=hi-120; u+=50) if (good(u)) return u; }
    else for (let u=hi-120-wd; u>=lo+120; u-=50) if (good(u)) return u;
    return null;
  }
}

// ---------------------------------------------------------------- вентиляция: жалюзи по расчёту
// Расход воздуха — из расчёта тепла (StationHeat.calc, plan.heat.vent): приток = вентиляция помещения (тепло корпусов,
// осушителей и солнца при перегреве не более 5 °C) + воздух на сжатие и на горение + охлаждение компрессоров + радиатор ДГУ.
// Вытяжка компрессорной — приток без сжатого воздуха (уходит по трубе). У ДГУ вентилятор радиатора протягивает воздух через
// помещение (он же уносит тепло корпуса): приток = max(радиатор, вентиляция помещения) + горение, выброс — через жалюзи
// радиатора (дверь-жалюзи в торце), горение — через выхлоп. Живое сечение = расход / (3600 · heat.face), размер жалюзи
// по рамке = живое сечение / vent.free; размеры кратны 50 мм, одна не помещается — несколько одинаковых. Приток — внизу
// (у ДГУ — подальше от радиатора), вытяжка — вверху в дальнем торце; места — на свободных участках стен (StWalls), мимо
// дверей, ворот, шкафов, конвекторов и знака «Центр тяжести». Чего не поместилось — замечание с недостающим сечением.
class StationVent {
  static STEP = 50;
  static GAP = 200;                                         // между жалюзи на стене, мм
  static IN = { z0:200, h:[300, 1000], w:[400, 1500] };     // приток: низ на 200 мм от пола, высота и ширина «от–до», мм
  static OUT = { top:420, h:[300, 800], w:[400, 1500] };    // вытяжка: верх на 420 мм ниже потолка (под кабельным лотком)
  static PIECE = 600;                                       // добавочные жалюзи (остаток сечения) — не уже, мм
  static get FACE(){ return StationRules.raw('heat.face'); }
  static get FREE(){ return StationRules.raw('vent.free'); }
  /** одинаковые жалюзи на площадь по рамке area, м²: {n, w, h} — площадь не меньше нужной, форма ближе к 3 : 2, меньше штук */
  static size(area, o){
    const S=this.STEP; let best=null;
    for (let n=1; n<=12; n++){ const a=area/n*1e6;
      for (let h=o.h[0]; h<=o.h[1]; h+=S){ const w=Math.max(o.w[0], Math.ceil(a/h/S)*S); if (w>o.w[1]) continue;
        const score=(n*w*h/1e6-area)/area+0.3*Math.abs(Math.log(w/h/1.5))+0.25*(n-1);
        if (!best || score<best.score) best={ n, w, h, score }; }
      if (best) break; }
    return best ? { n:best.n, w:best.w, h:best.h } : null;
  }
  /** проекция центра тяжести на стену w (как знак № 12 на 3D-виде): {u, z} мм или null */
  static cog(plan, w){
    const M=plan.mass, g=plan.geo; if (!M || !g || !g.ext) return null; const c=M.cg, [Le, We]=g.ext, [Li, Wi]=plan.int, zf=StationGeo.zFloor(g.type, g.t);
    return { u:w==='left' || w==='right' ? c.y-(We-Wi)/2 : c.x-(Le-Li)/2, z:c.z-zf };
  }
  /** расчёт и места: {q:{in, out, rad}, need:{in, out} — живое сечение и площадь по рамке, м²; size:{in, out}; louvers:
   *  [{kind:'in'|'out'|'rad', wall, u0, u1, z0, z1, w, h}]; short:{in, out} — не поместилось, м² по рамке; rad — радиатор ДГУ} */
  static calc(plan){
    const h=plan.heat, v=h && h.vent, sys=plan.sys||{}, I=plan.items||[], [, , H]=plan.int, dgu=I.find(i=>i.kind==='dgu' && !i.tank);
    if (!v || (!dgu && sys.vent===false)) return null;
    const F=this.FACE, k=this.FREE, r=x=>Math.round(x*100)/100;
    const room=Math.max(0, v.m3h-v.use), qRad=dgu ? Math.max(v.rad, room) : 0, qIn=dgu ? qRad+v.use+v.cool : v.m3h+v.cool, qOut=dgu ? v.cool : room+v.cool;
    const need=q=>{ const free=q/3600/F; return { q, free:r(free), gross:r(free/k) }; };
    const out={ q:{ in:Math.round(qIn), out:Math.round(qOut), rad:Math.round(qRad) }, need:{ in:need(qIn), out:qOut>0 ? need(qOut) : null }, size:{}, louvers:[], short:{ in:0, out:0 }, face:F, free:k, rad:null };
    const W=new StWalls(plan, { equip:false }), G=plan.gates && !plan.gates.sea ? plan.gates.wall : '', x0=plan.geo.x0||0;
    const leftOk=x0===0 && plan.door!=='end' && !plan.geo.sea && G!=='left', rightOk=!dgu && G!=='right';
    // радиатор ДГУ: дверь-жалюзи в торце или жалюзи напротив радиатора
    if (dgu){ const d=plan.dguDoor, L=d ? { kind:'rad', wall:'right', u0:d.y0, u1:d.y1, z0:0, z1:d.h, door:true }
        : { kind:'rad', wall:'right', u0:Math.round(dgu.y+80), u1:Math.round(dgu.y+dgu.ly-80), z0:Math.round(dgu.h*0.12), z1:Math.round(dgu.h*0.95) };
      L.w=L.u1-L.u0; L.h=L.z1-L.z0; out.louvers.push(L); W.busy('right', L.u0-90, L.u1+260, L.z0, L.z1+120);
      const fr=L.w*L.h/1e6*k; out.rad={ q:Math.round(qRad), free:r(fr), w:L.w, h:L.h, door:!!L.door, v:fr>0 ? Math.round(qRad/3600/fr*10)/10 : null }; }
    const cogHit=(w, u0, u1, z0, z1)=>{ const c=this.cog(plan, w), hh=150+120; return !!c && c.z+hh>z0 && c.z-hh<z1+220 && u0<c.u+hh && u1>c.u-hh; };
    // сначала — одинаковые по расчёту (size); не встали все — остаток той же высоты, ширина — под свободные участки стен
    // (не шире w[1]); приток и вытяжка на одной стене — каждая в своей половине высоты
    const band=Math.floor(((H-this.OUT.top-this.IN.z0)/2-90)/this.STEP)*this.STEP, both=qOut>0;
    const place=(kind, o0, walls)=>{
      const nd=out.need[kind]; if (!nd) return;
      const o={ ...o0, h:[o0.h[0], Math.max(o0.h[0], both ? Math.min(o0.h[1], band) : Math.min(o0.h[1], H-this.OUT.top-o0.z0))] };
      const sz=this.size(nd.gross, o), S=this.STEP; out.size[kind]=sz; if (!sz) return;
      const h=sz.h, z0=kind==='in' ? o.z0 : H-o.top-h, z1=z0+h; let left=nd.gross*1e6, uni=sz.n;
      const put=(wall, w, u)=>{ const u0=u+100, L={ kind, wall, u0, u1:u0+w, z0, z1, w, h }; out.louvers.push(L); W.busy(wall, u0-90-this.GAP, L.u1+260+this.GAP, z0-90, z1+90); left-=w*h; };
      const spot=(wall, from, w)=>W.find(wall, w+360, z0-90, z1+90, from, a=>!cogHit(wall, a+100, a+100+w, z0, z1));
      for (const [wall, from] of walls) while (uni>0 && left>1){ const u=spot(wall, from, sz.w); if (u==null) break; put(wall, sz.w, u); uni--; }
      for (const [wall, from] of walls) while (left>1){
        let w=Math.min(o.w[1], Math.max(this.PIECE, Math.ceil(left/h/S)*S)), u=null;
        for (; w>=this.PIECE; w-=S){ u=spot(wall, from, w); if (u!=null) break; }
        if (u==null) break; put(wall, w, u); }
      out.short[kind]=r(Math.max(0, left)/1e6);
    };
    place('in', this.IN, [...(leftOk ? [['left', 'lo']] : []), ['back', 'lo'], ...(rightOk ? [['right', 'lo']] : []), ['front', 'hi']]);   // лицевая (с дверями и логотипом) — последней
    if (qOut>0) place('out', this.OUT, [...(rightOk ? [['right', 'lo']] : []), ['back', 'hi'], ['front', 'hi']]);
    return out;
  }
  /** «2 × 1000 × 800 мм» */
  static text(sz){ const n=StationLayout.n; return sz ? `${sz.n>1 ? sz.n+' × ' : ''}${n(sz.w)} × ${n(sz.h)} мм` : ''; }
  /** жалюзи вида kind (на стене wall) по размерам: «2 × 1400 × 1000 мм + 900 × 1000 мм»; не поставлено — расчётный размер */
  static list(V, kind, wall){
    const L=V.louvers.filter(q=>q.kind===kind && (!wall || q.wall===wall)); if (!L.length) return wall ? '' : this.text(V.size[kind]);
    const g=new Map(); for (const q of L){ const k=q.w+'×'+q.h; g.set(k, (g.get(k)||0)+1); }
    return [...g].map(([k, c])=>{ const [w, h]=k.split('×').map(Number); return this.text({ n:c, w, h }); }).join(' + ');
  }
  /** замечания для «Компоновки»: расходы, сечения, размеры; не поместилось — предупреждение */
  static notes(plan){
    const V=plan.vent, iss=plan.issues; if (!V) return;
    const n=StationLayout.n, f=v=>String(v).replace('.', ','), H=plan.heat && plan.heat.vent, tm=H ? StationNorms.deg(H.tmax) : '';
    const part=(nm, kind)=>`${nm} ${n(V.q[kind])} м³/ч — живое сечение не менее ${f(V.need[kind].free)} м² (скорость ${f(V.face)} м/с), жалюзи ${this.list(V, kind) || 'по месту'}`;
    const t=[part('приток', 'in')];
    if (V.need.out) t.push(part('вытяжка', 'out'));
    if (V.rad) t.push(`радиатор ДГУ — ${n(V.rad.q)} м³/ч через ${V.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(V.rad.w)} × ${n(V.rad.h)} мм (живое сечение ${f(V.rad.free)} м², ${f(V.rad.v)} м/с)`);
    iss.push({ level:'info', text:`Вентиляция летом${tm ? ` (до ${tm})` : ''}: ${t.join('; ')}. Размеры — по рамке при живом сечении ${Math.round(V.free*100)} %; места жалюзи — на чертеже и 3D-виде.` });
    for (const [kind, nm] of [['in', 'приточных'], ['out', 'вытяжных']]) if (V.short[kind]>0) iss.push({ level:'warn', text:`Не поместилось ${nm} жалюзи на ${f(V.short[kind])} м² (по рамке): стены заняты дверями, шкафами и конвекторами — освободите место на стене или примите приток (вытяжку) воздуховодом через крышу.` });
    if (V.rad && V.rad.v>StationVent.RAD_V) iss.push({ level:'warn', text:`Через жалюзи радиатора ДГУ скорость воздуха около ${f(V.rad.v)} м/с — больше ${f(StationVent.RAD_V)} м/с: проверьте по паспорту ДГУ (расход воздуха радиатора и допустимое сопротивление) или увеличьте проём.` });
  }
  static RAD_V = 7.5;   // скорость выброса воздуха радиатора ДГУ через жалюзи, м/с — выше: проверить по паспорту ДГУ
}

if (typeof module!=='undefined') module.exports={ StationFire, StationLight, StationSockets, StationPower, StationPipe, StationMass, StWalls, StationVent };
