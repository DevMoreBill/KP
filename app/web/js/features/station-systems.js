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
  // паспорт модуля и коэффициенты — матрица расстановки, раздел fire («Настройки → Инженерные правила станций»)
  static get MOD(){ return StationMatrix.derive('fireMod', ()=>{ const f=StationMatrix.grp('fire');
    return { name:'«Буран-2,5»', area:f.modArea, side:f.modSide, vol:{ A:f.modVolA, B:f.modVolB }, k1:f.k1, k3:f.k3, k4:f.k4, d:250, h:154, kg:3, z:[f.modZ0, f.modZ1] }; }); }
  static get SHADE(){ return StationMatrix.derive('fireShade', ()=>{ const f=StationMatrix.grp('fire'); return { h:f.shadeH, gap:f.shadeGap }; }); }   // затеняет агрегат выше 600 мм; зона за ним — если до стены не меньше 150 мм
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
    return { cat, zone:rooms[0].zone, cls, auto:!!sys.fire, ops:!!(sys.ops || sys.fire), rooms, exit:this.exit(plan), exit2:this.exit2(plan),
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
  /** второй выход: вторая дверь оператора (в стене прохода у дальнего торца, в дальнем торце), калитка в воротах или сами
   *  монтажные ворота в торце */
  static exit2(plan){
    const d=(plan.doors||[]).find(d=>d.kind==='entry'); if (d) return { wall:d.wall, u:(d.x0+d.x1)/2, w:d.w, top:d.h };
    const e=plan.exit; if (e) return { wall:e.wall, u:(e.y0+e.y1)/2, w:e.w, top:e.h };
    const G=plan.gates; if (G && G.wicket) return { wall:G.wall, u:G.y0+80+G.wicket.w/2, w:G.wicket.w, top:G.wicket.h+60 };
    // ворота в торце открываются наружу — это и выход (решение ПНЕВМОТЕХ): дальние от входа
    const g=[plan.gates, plan.gates2].filter(q=>q && !q.sea).sort((a, b)=>(b.wall==='right')-(a.wall==='right'))[0];
    if (g) return { wall:g.wall, u:(g.y0+g.y1)/2, w:g.w, top:g.h, gate:true };
    return null;
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
  static get PLANE(){ return StationMatrix.grp('light').plane; }   // рабочая плоскость над полом, мм (раздел light матрицы)
  static get KZ(){ return StationRules.raw('norm.lux').kz; }
  static get LAMP(){ return StationMatrix.derive('lamp', ()=>{ const L=StationMatrix.grp('light'); return { w:L.lampW, lm:L.lampLm, len:L.lampLen }; }); }
  static get SMALL(){ return StationMatrix.grp('light').small; }   // круглый светильник в отсеке бака и тамбуре, Вт
  static get FLOOD(){ return StationMatrix.grp('light').flood; }   // прожектор над дверью, Вт
  static get EXIT(){ return StationMatrix.grp('light').exit; }     // табло «Выход» с аккумулятором, Вт
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
    const two=(plan.doors||[]).some(d=>d.kind==='entry') || plan.exit ? 1 : 0, exits=1+(two || (plan.gates && plan.gates.wicket) ? 1 : 0);
    const floods=(plan.entry && !plan.entry.sea ? 1 : 0)+two+(f ? 1 : 0);   // прожекторы над дверями оператора и дверью отсека бака
    const on=sys.light!==false, kw=on ? (n*M.w+small*this.SMALL+floods*this.FLOOD+exits*this.EXIT)/1000 : 0;
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
    const P=StationMatrix.grp('power');   // по одной розетке 230 В на каждые sockStep мм длины, не меньше sockMin (раздел power матрицы)
    return { n230:Math.max(P.sockMin, Math.ceil((L-x0)/P.sockStep)), n380:P.sock380, ytp:1, z:P.sockZ };
  }
  static text(K){
    return K ? `сервисные розетки: 230 В 16 А IP54 с заземляющим контактом — ${K.n230} шт. (у входа и у оборудования, через УЗО 30 мА), 380 В 16 А IP54 (3P+N+PE) — ${K.n380} шт. у основного оборудования, ящик ЯТП-0,25 (220/36 В) для переносных светильников — ${K.ytp} шт. у входа; высота — ${(K.z/1000).toFixed(1).replace('.', ',')} м от пола` : '';
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
  static dryer(i){ if (i.kw>0) return i.kw; const q=i.air && i.air.flow>0 ? i.air.flow : 0, t=i.air && i.air.type, P=StationMatrix.grp('power'); return t==='refrig' || !t ? Math.max(P.dryerMin, Math.round(q*P.dryerK*10)/10) : P.dryerAds; }
  /** потребители: [{name, n, kw — за единицу, kc, run — работает в режиме «работа», idle — в «простое»}] и итоги */
  static calc(plan){
    const I=plan.items||[], r=plan.req||{}, h=plan.heat, Lt=plan.light, K=plan.sockets, F=plan.fire, out=[], D=StationMatrix.grp('power');   // мощности по умолчанию — раздел power матрицы
    // двигатель (компрессор, насос): в паспорте — мощность на валу, из сети он берёт P / η (правило el.eta, как в расчётной записке)
    const eta=StationRules.raw('el.eta')||1;
    const add=(name, n, kw, kc, run, idle, motor)=>{ if (n>0 && kw>0) out.push({ name, n, kw:Math.round(kw*100)/100, kc, run, idle, el:motor ? 1/eta : 1 }); };
    const group=(kind, name, kwOf)=>{ const L=I.filter(i=>i.kind===kind && !i.tank); if (!L.length) return;
      const res=kind===(r.kind==='pump' ? 'pump' : 'compressor') ? Math.max(0, Math.min(L.length-1, Math.round(r.res||0))) : 0, kws=L.map(kwOf).sort((a, b)=>b-a);
      const work=kws.slice(0, L.length-res), spare=kws.slice(L.length-res), same=kws.every(v=>Math.abs(v-kws[0])<1e-6);
      const motor=kind==='compressor' || kind==='pump';
      if (same) { add(name, work.length, kws[0], 1, true, false, motor); add(name+' — резервный', spare.length, kws[0], 0, false, false, motor); }
      else { for (const v of work) add(name, 1, v, 1, true, false, motor); for (const v of spare) add(name+' — резервный', 1, v, 0, false, false, motor); } };
    group('compressor', 'Компрессор', i=>i.kw>0 ? i.kw : 0);
    group('pump', 'Насосный агрегат', i=>i.kw>0 ? i.kw : 0);
    group('dryer', 'Осушитель', i=>this.dryer(i));
    // у каждой ДГУ — свой подогреватель двигателя и зарядное устройство АКБ
    const DG=I.filter(i=>i.kind==='dgu' && !i.tank), dgu=DG[0];
    if (dgu){ for (const big of [true, false]){ const q=DG.filter(g=>(g.kw>D.dguHeatKw)===big).length; if (q) add('Подогреватель двигателя ДГУ', q, big ? D.dguHeatBig : D.dguHeat, 1, false, true); }
      add('Зарядное устройство АКБ ДГУ', DG.length, D.charger, 1, true, true);
      if (plan.fuel) add('Насос перекачки топлива', 1, D.fuelPumpKw, 1, true, true); }
    if (h && h.on && h.total>0) add(`Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт`, 1, h.total, 1, false, true);
    if (h && h.on && h.qRun>0) out.push({ name:'Подогрев воздуха при работе (часть конвекторов)', n:1, kw:0, kc:1, run:true, idle:false, extra:Math.round(h.qRun/10)/100 });
    if (Lt && Lt.on) add('Освещение (основное, аварийное, прожекторы)', 1, Lt.kw, 1, true, true);
    if (K){ add('Розетки 230 В (группа 16 А)', 1, D.s230, D.s230k, true, true); add('Розетка 380 В 16 А', 1, D.s380, D.s380k, true, true); add('ЯТП-0,25 (36 В)', 1, D.ytp, D.ytpK, true, true); }
    if ((plan.sys||{}).vent!==false) add('Клапаны вентиляции с электроприводами', 1, D.valves, 1, true, true);
    if (F && F.ops) add(`Щит ОПС${F.auto ? ' и пожаротушения' : ''}`, 1, D.ops, 1, true, true);
    if (I.some(i=>i.kind==='cabinet' && /АСУ|диспетч/i.test(i.name||''))) add('Шкаф АСУ ТП', 1, D.asu, 1, true, true);
    const inst=out.reduce((s, q)=>s+q.n*q.kw, 0), mode=k=>out.reduce((s, q)=>s+(q[k] ? q.n*q.kw*(q.el||1)*q.kc+(q.extra||0) : 0), 0);
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
  static get FUEL(){ return StationMatrix.grp('light').fuelPump; }   // подача насоса перекачки топлива, м³/ч
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
  // числа — матрица расстановки, раздел mass («Настройки → Инженерные правила станций → Масса станции и строповка»)
  static get M(){ return StationMatrix.grp('mass'); }
  static get TARE(){ return StationMatrix.derive('tare', ()=>{ const m=this.M; return { sea10:m.tare10, sea20:m.tare20, sea20hc:m.tare20hc, sea40:m.tare40, sea40hc:m.tare40hc }; }); }   // кг, ISO 668 — типичная тара
  static get FRAME(){ return this.M.frame; }        // рама блок-контейнера, кг на 1 м длины
  static get PANEL(){ return StationMatrix.derive('panel', ()=>{ const m=this.M; return { block:m.pBlock, north:m.pNorth, welded:m.pWelded }; }); }   // стены и кровля, кг/м²: сэндвич-панели 100 мм, «Север», профлист с каркасом
  static get LINING(){ return this.M.lining; }      // утепление и обшивка морского контейнера изнутри, кг/м²
  static get FLOOR(){ return this.M.floor; }        // пол: рифлёный лист 4 мм на лагах, кг/м²
  static get OTHER(){ return [this.M.otherK, this.M.otherKg]; }   // трубопровод, кабели, системы: доля массы оборудования и постоянная часть, кг
  static get ANGLE(){ return this.M.angle; }        // наибольший угол ветви стропа с вертикалью, °
  static get LUG(){ return [this.M.lugL, this.M.lugW]; }   // точка строповки от торца и от боковой стены (наружные), мм

  /** {mass, cont, eq, other, cg:{x, y, z}, missing:[поз.], sling:{hook — высота крюка над крышей, legs:[{x, y, len, deg}], beam,
   *  frame}} */
  static calc(plan){
    const g=plan.geo; if (!g || !g.ext || !plan.int) return null;
    const [Le, We, He]=g.ext, [Li, Wi]=plan.int, ox=(Le-Li)/2, oy=(We-Wi)/2, zf=StationGeo.zFloor(g.type), m=v=>v/1000;
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
    const mass=Math.round(M/10)*10, sling=this.sling(Le, We, cg, g.sea);
    return { mass, cont:Math.round(cont/10)*10, eq:Math.round(eq), other:Math.round(other), cg, missing:missing.sort((a, b)=>a-b), sling:{ ...sling, wll:this.wll(mass, sling) },
      max:g.sea ? this.max(g.type) : null };
  }
  /** наибольшая масса брутто морского контейнера по типу (ISO 668; правило mass.iso_max — требует подтверждения), кг */
  static max(type){ const v=StationRules.v('mass.iso_max')||{}; return v[type] || (/^sea40/.test(type) ? v.sea40 : /^sea10/.test(type) ? v.sea10 : v.sea20) || null; }
  /** грузоподъёмность ветви стропа, т: S = Q / (n · cos α), n — ветвей в расчёте (РД 10-33-93, п. 2.1.4: две), α — наибольший
   *  угол ветви с вертикалью; с округлением до 0,1 т вверх. Рамная траверса: ветви вертикальны; к крюку — двухветвевой строп */
  static wll(mass, S){
    const n=Math.max(1, +StationRules.v('sling.legs')||2), t=mass/1000, a=Math.max(0, ...S.legs.map(q=>q.deg||0)), up=v=>Math.ceil(v*10-1e-9)/10;
    return { leg:up(t/(n*Math.cos(a*Math.PI/180))), top:S.frame ? up(t/(2*Math.cos(S.frame.deg*Math.PI/180))) : null, n, deg:a };
  }
  /** замечания по массе: брутто больше допустимого для морского контейнера */
  static issues(Ms){
    if (!Ms || !(Ms.max>0) || Ms.mass<=Ms.max) return [];
    const n=StationLayout.n;
    return [{ level:'warn', text:`Масса станции около ${n(Ms.mass)} кг — больше наибольшей массы брутто контейнера ${n(Ms.max)} кг (ISO 668, требует подтверждения по табличке CSC): облегчите состав или выберите другой контейнер.` }];
  }
  static get BEAM(){ const m=this.M; return { L:m.beamL, z:m.beamZ, top:m.beamTop }; }   // длиннее L — траверса: ветви до неё z, от неё до крюка top, мм
  static get SPREADER(){ const m=this.M; return { z:m.sprZ, d:m.sprD, top:m.sprTop }; }   // рамная траверса морского контейнера: высота рамы, проушины ± d от ЦТ, до крюка top
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
  static get NEAR(){ return StationMatrix.grp('grille').near; }   // оборудование ближе к стене — место перед ним занято (до его высоты + 150 мм)
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
    for (const Q of [G, plan.gates2]) if (Q) this.busy(Q.wall, Q.y0-100, Q.y1+100, 0, Q.h+150);
    if (plan.exit) this.busy(plan.exit.wall, plan.exit.y0-100, plan.exit.y1+100, 0, plan.exit.h+150);   // вторая дверь оператора в торце
    for (const d of plan.doors||[]) this.busy(d.wall==='back' ? 'back' : 'front', d.x0-100, d.x1+100, 0, d.h+150);
    if (o.equip!==false) for (const l of plan.lines||[]) if (W-l.y<500) for (const [a, b] of StationLayout.runs(l)) this.busy('back', a, b, l.z-100, l.z+100);   // жалюзи за трубой — можно
    // кабельный лоток под потолком — у задней стены; там сервисные ворота с выбросом над ними — у стены прохода
    if ((plan.sys||{}).power!==false) this.busy((plan.doors||[]).some(d=>d.rear && d.wall==='back') ? 'front' : 'back', x0, L, H-320, H);
  }
  busy(w, u0, u1, z0, z1){ if (this.B[w]) this.B[w].push([u0, u1, z0, z1]); }
  /** отметка занятых мест — для пробной расстановки: reset(mark()) убирает всё, что занято после отметки */
  mark(){ return Object.fromEntries(Object.entries(this.B).map(([k, v])=>[k, v.length])); }
  reset(m){ for (const k in m) this.B[k].length=m[k]; }
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
  /** начало свободного участка шириной wd на высоте z0…z1: от начала стены (lo), от конца (hi) или ближе всего к точке
   *  from (число — середина участка); ok(u) — ещё условие; нет — null */
  find(w, wd, z0, z1, from='lo', ok){
    const [lo, hi]=this.range(w), good=u=>this.free(w, u, u+wd, z0, z1) && (!ok || ok(u));
    if (typeof from==='number'){ const a=lo+120, b=hi-120-wd, u0=Math.round((from-wd/2)/50)*50;
      for (let d=0; u0-d>=a || u0+d<=b; d+=50) for (const u of d ? [u0-d, u0+d] : [u0]) if (u>=a && u<=b && good(u)) return u;
      return null; }
    if (from==='lo'){ for (let u=lo+120; u+wd<=hi-120; u+=50) if (good(u)) return u; }
    else for (let u=hi-120-wd; u>=lo+120; u-=50) if (good(u)) return u;
    return null;
  }
}

// ---------------------------------------------------------------- вентиляция: расчёт расходов и проёмов (лето, зима, рекуперация)
// Решение ПНЕВМОТЕХ. Коэффициенты — в файле инженерных правил (vent.k_heat, vent.temps, vent.ach, vent.speed, vent.fan,
// vent.winter, vent.recup, vent.season, air.cp), режим «эксперт» — в требованиях станции («Условия для расчёта»).
// Лето: тепло компрессора Q = N·k (паспорт — важнее); воздух охлаждения — по паспорту, иначе его вентилятором:
// L = Q·3600 / (c·ρ·Δt_к), Δt_к — нагрев воздуха в компрессоре (heat.cool_dt), ρ = 353 / (273 + t_нар); помещение (тепло
// корпусов, осушителей, солнца) — перепадом Δt = t_вн − t_нар (меньше vent.temps.dtMin — предупреждение и расчёт при нём),
// один поток с охлаждением; не меньше 3 объёмов в час. Проёмы — по рамке: S = L / (3600·v), приток — с запасом.
// Зима: потери ограждений (U по утеплителю) и минимального воздухообмена (2 объёма в час) против тепла работающего
// компрессора (рециркуляция) — профицит или дефицит, открытие жалюзи. Рекуператор — по требованию заказчика.
class VentCalc {
  static CFM = 1.69901;      // 1 CFM (фут³/мин) = 0,0283168 м³ · 60 = 1,699 м³/ч
  static G = 9.81;           // ускорение свободного падения, м/с²
  static R(id){ return StationRules.raw(id); }
  static r10(v){ return Math.round(v/10)*10; }                    // расход — до 10 м³/ч
  static r2(v){ return Math.round(v*100)/100; }                    // площадь — до 0,01 м²
  static r1(v){ return Math.round(v*10)/10; }                      // температура — до 0,1 °C
  /** плотность воздуха при t, кг/м³: ρ = p / (R·T) = 101 325 / (287,05·(273 + t)) ≈ 353 / (273 + t) */
  static rho(t){ return this.R('air.cp').rhoK/(273+t); }
  /** расход воздуха, м³/ч, уносящий Q кВт при нагреве на dt °C (воздух при t): L = Q·3600 / (c·ρ·Δt) */
  static flow(Q, t, dt){ return Q>0 && dt>0 ? Q*3600/(this.R('air.cp').c*this.rho(t)*dt) : 0; }
  /** тепло, кВт, которое уносит (или на которое подогревается) L м³/ч при Δt: Q = L·c·ρ·Δt / 3600 */
  static heatOf(L, t, dt){ return L*this.R('air.cp').c*this.rho(t)*dt/3600; }
  static cfm(L){ return Math.round(L/this.CFM); }
  /** число из режима «эксперт»: в пределах [lo, hi] — оно, иначе null (и предупреждение) */
  static ex(ex, key, lo, hi, W, what){
    const v=ex && ex[key]; if (v==null || v==='' || !Number.isFinite(+v)) return null;
    if (+v<lo || +v>hi){ W.push({ level:'warn', text:`Режим «эксперт»: ${what} ${String(v).replace('.', ',')} — вне допустимого (${String(lo).replace('.', ',')}…${String(hi).replace('.', ',')}), взято значение по умолчанию.` }); return null; }
    return +v;
  }
  /** тип компрессора для k: screw / piston / centrifugal / scroll */
  static type(t){ return /^(piston|centrifugal|scroll)$/.test(t) ? t : 'screw'; }
  /** k (доля мощности в тепло) — эксперт в диапазоне типа, иначе по умолчанию */
  static k(type, ex, W){ const K=this.R('vent.k_heat'), t=this.type(type), [lo, hi]=K.range[t]||[0.5, 1];
    return this.ex(ex, 'k', lo, hi, W, 'k для типа «'+this.TYPE[t]+'»') ?? K.def[t]; }
  static TYPE = { screw:'винтовой', piston:'поршневой', centrifugal:'центробежный', scroll:'спиральный' };

  /** летний режим («сбалансированная вентиляция», решение ПНЕВМОТЕХ). inp: {units:[{key, pos, type, kw, heat?, cool?}] —
   *  рабочие компрессоры, qRoom — тепло в помещение (корпуса, осушители, солнце), кВт, qSun — солнце (остановленная станция),
   *  кВт, use — воздух на сжатие и горение из помещения, м³/ч, V — объём помещения, м³, tSum — наружная летом, boost —
   *  система «Вентилятор в воздуховоде выброса», exfan — система «Вытяжные вентиляторы» (осевые в стене напротив притока,
   *  решение ПНЕВМОТЕХ), ex — «эксперт»} */
  static summer(inp, W){
    const ex=inp.ex||{}, T=this.R('vent.temps'), A=this.R('vent.ach'), Sp=this.R('vent.speed'), F=this.R('vent.fan'), B=this.R('vent.boost'), E=StationRules.opt('vent.exfan'), tSum=inp.tSum, ac=this.R('air.cp');
    // Δt помещения = t_вн − t_нар: допустимая внутри минус наружная летом; меньше наименьшего — предупреждение и расчёт при наименьшем
    const tIn=this.ex(ex, 'tIn', 20, 60, W, 't_вн летом, °C') ?? T.tIn, dtSet=this.ex(ex, 'dt', 1, 40, W, 'Δt, °C');
    const dtRaw=dtSet ?? tIn-tSum, dt=Math.max(T.dtMin, dtRaw);
    if (dtRaw<T.dtMin) W.push({ level:'warn', text:`Недостаточный перепад температур летом: Δt = ${this.f(dtRaw)} °C (t_вн ${this.f(tIn)} − t_нар ${this.f(tSum)}) меньше ${T.dtMin} °C — расход посчитан при Δt = ${T.dtMin} °C. Требуется принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха; уточните допустимую температуру в помещении по паспорту компрессора.` });
    // компрессоры: тепло Q = паспорт или N·k; воздух охлаждения — паспорт или его собственный вентилятор: L = Q·3600 / (c·ρ·Δt_к),
    // Δt_к — нагрев воздуха в компрессоре (heat.cool_dt): горячий воздух уходит воздуховодом, помещение не греет
    const dtc=this.ex(ex, 'dtc', 5, 30, W, 'нагрев воздуха в компрессоре, °C') ?? this.R('heat.cool_dt');
    const units=(inp.units||[]).map(u=>{ const k=this.k(u.type, ex, W), Q=u.heat>0 ? u.heat : (u.kw||0)*k, L=u.cool>0 ? u.cool : this.r10(this.flow(Q, tSum, dtc));
      return { key:u.key, pos:u.pos, type:this.type(u.type), kw:u.kw||0, k:u.heat>0 ? null : k, Q:this.r1(Q), cool:L, src:u.cool>0 ? 'паспорт' : 'расчёт', qsrc:u.heat>0 ? 'паспорт' : 'N·k' }; });
    const Lcool=units.reduce((s, u)=>s+u.cool, 0), Qc=units.reduce((s, u)=>s+u.Q, 0), comp=units.length>0;
    // помещение: тепло корпусов, осушителей, солнца — перепадом помещения; плюс воздух на сжатие и горение
    const Lroom=this.r10(this.flow(inp.qRoom||0, tSum, dt)), use=Math.round(inp.use||0), V=inp.V||0;
    // при работе компрессоры протягивают воздух через помещение — один поток: больший из охлаждения и вентиляции помещения
    let Lrun=comp ? Math.max(Lcool, Lroom) : Lroom;
    // кратность: общий воздухообмен не меньше 3 объёмов в час
    const Lmin=this.r10(A.min*V), Lemerg=this.r10(A.emerg*V), raised=Lrun+use<Lmin;
    if (raised){ Lrun=Lmin-use; W.push({ level:'info', text:`Расход увеличен до нормативного минимума по кратности: ${A.min} объёма в час — ${this.n(Lmin)} м³/ч.` }); }
    // остановленная компрессорная: малый вытяжной вентилятор с термостатом — солнце перепадом помещения, не меньше 3V и vent.fan.stand
    const Lsun=this.flow(inp.qSun||0, tSum, dt), Lst=comp ? this.r10(Math.max(F.stand, Math.max(Lsun, A.min*V)*F.reserve)) : 0;
    // общая вытяжка (мимо воздуховодов компрессоров): у компрессорной — вентилятор стоянки или избыток помещения над охлаждением
    const Lgen=comp ? Math.max(Lrun-Lcool, Lst) : Lrun, Lin=Math.max(Lrun, Lst)+use, Lout=Lcool+Lgen;
    // воздух у входа компрессора: наружный + нагрев теплом помещения в общем потоке (Atlas Copco — до 46 °C)
    const tComp=this.r1(tSum+(inp.qRoom||0)*3600/(ac.c*this.rho(tSum)*Math.max(1, Lrun+use)));
    if (comp && tComp>tIn) W.push({ level:'warn', text:`Воздух у входа компрессора около ${this.f(tComp)} °C — выше допустимых ${this.f(tIn)} °C: увеличьте приток или проверьте паспорт компрессора.` });
    // проёмы — по рамке: S = L / (3600·v), приток — с запасом; «Вентилятор в воздуховоде выброса» — компактнее; «Вытяжные
    // вентиляторы» в стене напротив притока (по термостату) — выброс через их проёмы, приток — до предела Atlas Copco 4 м/с;
    // с ними канальный вентилятор не нужен
    const exfan=!!inp.exfan && comp && !!E, boost=!!inp.boost && comp && !exfan;
    if (inp.boost && exfan) W.push({ level:'info', text:'Вентилятор в воздуховоде выброса не нужен: горячий воздух выводят вытяжные вентиляторы в стене — систему «Вентилятор в воздуховоде выброса» можно выключить.' });
    const vIn=this.ex(ex, 'vIn', 0.5, 8, W, 'скорость притока, м/с') ?? (exfan ? E.vIn : boost ? B.vIn : Sp.in), vOut=this.ex(ex, 'vOut', 0.5, 10, W, 'скорость выброса, м/с') ?? (exfan ? E.vOut : boost ? B.vOut : Sp.out);
    const res=this.ex(ex, 'res', 1, 2, W, 'запас притока') ?? Sp.inReserve;
    if (vIn>Sp.max) W.push({ level:'warn', text:`Скорость воздуха в притоке ${this.f(vIn)} м/с больше ${Sp.max} м/с (Atlas Copco) — высокие потери давления и шум; увеличьте проём.` });
    else if (vIn<Sp.inRange[0] || vIn>Sp.inRange[1]) W.push({ level:'info', text:`Скорость воздуха в притоке ${this.f(vIn)} м/с — вне рекомендуемого диапазона ${this.f(Sp.inRange[0])}…${this.f(Sp.inRange[1])} м/с.` });
    if (!boost && !exfan && vOut>Sp.max) W.push({ level:'warn', text:`Скорость воздуха в выбросе ${this.f(vOut)} м/с больше ${Sp.max} м/с — штатный вентилятор компрессора может не справиться; увеличьте проём или включите «Вентилятор в воздуховоде выброса».` });
    else if (!boost && !exfan && (vOut<Sp.outRange[0] || vOut>Sp.outRange[1])) W.push({ level:'info', text:`Скорость воздуха в выбросе ${this.f(vOut)} м/с — вне рекомендуемого диапазона ${this.f(Sp.outRange[0])}…${this.f(Sp.outRange[1])} м/с.` });
    const Sin=this.r2(Lin/(3600*vIn)*res), Sout=this.r2(Lout/(3600*vOut)), free=this.R('vent.free');
    const user=comp ? this.ex(ex, 'fan', 1, 1e6, W, 'вытяжной вентилятор, м³/ч') : null;
    if (user && user<Lst) W.push({ level:'warn', text:`Вытяжной вентилятор ${this.n(user)} м³/ч меньше нужного при остановленных компрессорах ${this.n(Lst)} м³/ч — замените вентилятор.` });
    return { tSum, tIn, dtRaw:this.r1(dtRaw), dt, dtc, rho:Math.round(this.rho(tSum)*1000)/1000, units, Qc:this.r1(Qc), qRoom:this.r1(inp.qRoom||0), Lcool, Lroom, Lrun, Lgen, use, Lin, Lout, V:this.r1(V),
      Lmin, Lemerg, raised, tComp, cfmIn:this.cfm(Lin), cfmOut:this.cfm(Lout), vIn, vOut, res, Sin, Sout, free, vLiveIn:this.r1(vIn/res/free), vLiveOut:this.r1(vOut/free), ductDp:Sp.ductDp,
      stand:comp ? { L:Lst, dp:F.dp, eta:F.eta, P:this.fanPower(Lst, F.dp, F.eta), user:user ? { q:user, ok:user>=Lst } : null } : null,
      boost:boost ? { L:Lcool, dp:B.dp, eta:B.eta, P:this.fanPower(Lcool, B.dp, B.eta) } : null,
      // вытяжные вентиляторы: весь выброс (охлаждение компрессоров и помещение) с запасом; при остановке — они же по термостату
      exfan:exfan ? { L:this.r10(Lout*E.reserve), dp:E.dp, eta:E.eta, P:this.fanPower(this.r10(Lout*E.reserve), E.dp, E.eta), reserve:E.reserve } : null };
  }
  /** мощность вентилятора, кВт: P = L·ΔP / (3600·1000·η) (L — м³/ч, ΔP — Па), до 0,001 кВт */
  static fanPower(L, dp, eta){ return Math.round(L*dp/(3600*1000*eta)*1000)/1000; }
  /** естественная тяга общей вытяжки помещения (жалюзи выброса без воздуховода компрессора): ΔP = (ρ_нар − ρ_вн)·g·h,
   *  h — от середины приточных до середины вытяжных, м. Меньше vent.fan.draft — вытяжной вентилятор (L·запас, напор, мощность) */
  static draft(S, h, Lroom, ex, W){
    const F=this.R('vent.fan'), rO=this.rho(S.tSum), rI=this.rho(S.tIn), dp=Math.round((rO-rI)*this.G*Math.max(0, h)*10)/10, need=Lroom>0 && dp<F.draft;
    const Lf=this.r10(Lroom*F.reserve), P=this.fanPower(Lf, F.dp, F.eta);
    const user=this.ex(ex, 'fan', 1, 1e6, W, 'вытяжной вентилятор, м³/ч');
    const out={ h:this.r2(h), rhoOut:Math.round(rO*1000)/1000, rhoIn:Math.round(rI*1000)/1000, dp, need, L:Lroom, fan:need || user ? { L:Lf, dp:F.dp, P, eta:F.eta } : null, user:user ? { q:user, ok:user>=Lf-1e-9 } : null };
    if (need) W.push({ level:'info', text:`Естественная тяга общей вытяжки ${this.f(dp)} Па меньше ${F.draft} Па — рекомендуется вытяжной вентилятор помещения: ${this.n(Lf)} м³/ч, напор не менее ${F.dp} Па, около ${this.f(P, 2)} кВт (при остановленном компрессоре его вентилятор помещение не продувает).` });
    if (out.user && !out.user.ok) W.push({ level:'warn', text:`Вытяжной вентилятор ${this.n(user)} м³/ч меньше нужного ${this.n(Lf)} м³/ч (расход общей вытяжки × ${String(F.reserve).replace('.', ',')}) — замените вентилятор.` });
    return out;
  }
  /** зимний режим. inp: {tWin, tInMin, V, env:{U, A, qEnv — Вт при tInMin − tWin}, Qrun — тепло работающего (самый холодный
   *  режим — один агрегат) в помещение, кВт, useRun — его воздух на сжатие, м³/ч, ex}; S — летний результат */
  static winter(inp, S, W){
    const ex=inp.ex||{}, A=this.R('vent.ach'), Wt=this.R('vent.winter'), tWin=inp.tWin, tInMin=inp.tInMin, dt=tInMin-tWin, V=inp.V||0;
    if (dt<=0){ W.push({ level:'info', text:`Зимняя расчётная ${this.f(tWin)} °C не ниже допустимой внутри ${this.f(tInMin)} °C — защита от переохлаждения не нужна.` }); return { tWin, tInMin, dt:0, warm:true }; }
    // потери через ограждения: U по утеплителю (как в расчёте отопления); «эксперт» — своё U: Q = U·A·Δt
    const Ux=this.ex(ex, 'U', 0.1, 6, W, 'U, Вт/(м²·°C)'), U=Ux ?? inp.env.U, A0=inp.env.A, Qenv=(Ux!=null ? Ux*A0*dt : inp.env.qEnv)/1000;
    // минимальный воздухообмен зимой — 2 объёма в час (влага, масляный туман), не меньше воздуха на сжатие
    const Lw=this.r10(Math.max(A.winter*V, inp.useRun||0)), Qvent=this.heatOf(Lw, tWin, dt), Qloss=Qenv+Qvent;
    const Qrun=inp.Qrun||0, bal=Qrun-Qloss;
    // регулируемые жалюзи: доля открытия = L_зима / L_лето, не меньше наименьшего открытия клапана
    const ratio=S && S.Lin>0 ? Lw/S.Lin : 1, open=Math.max(ratio, Wt.openMin);
    if (bal<0) W.push({ level:'info', text:`Зимой при работе тепла не хватает: дефицит ${this.f(-bal)} кВт — подогрев (конвекторы) и полная рециркуляция при минимальном притоке.` });
    return { tWin, tInMin, dt, U:Math.round(U*1000)/1000, A:this.r1(A0), Qenv:this.r2(Qenv), Lw, Qvent:this.r2(Qvent), Qloss:this.r2(Qloss), Qrun:this.r2(Qrun), bal:this.r2(bal),
      ratio:Math.round(ratio*1000)/10, open:Math.round(open*100), SinW:S ? this.r2(S.Sin*ratio) : null, SoutW:S ? this.r2(S.Sout*ratio) : null, heat:bal<0 ? this.r2(-bal) : 0, warm:false };
  }
  /** рекуператор (по требованию заказчика): целесообразность, тип, КПД, температура притока после, обмерзание, экономия.
   *  on — система «Рекуператор» включена; Wn — зимний результат */
  static recup(on, Wn, inp, W){
    if (!Wn || Wn.warm) return null;
    const ex=inp.ex||{}, Rc=this.R('vent.recup'), Se=this.R('vent.season'), why=[];
    if (Wn.Qloss>Rc.worth*Wn.Qrun) why.push(`потери зимой ${this.f(Wn.Qloss)} кВт больше ${Math.round(Rc.worth*100)} % тепла компрессора`);
    if (Wn.bal<0) why.push('нужен подогрев приточного воздуха');
    if (on) why.push('требование заказчика');
    // приток и выброс — на разных стенах: потоки разнесены — по умолчанию с промежуточным теплоносителем
    const type=/^(plate|rotary|glycol)$/.test(ex.hrvType||'') ? ex.hrvType : 'glycol', [lo, hi]=Rc.range[type];
    const eta=this.ex(ex, 'eta', lo, hi, W, 'КПД рекуператора') ?? Rc.eta[type];
    const tExh=this.ex(ex, 'tExh', Wn.tInMin, 40, W, 't выбросного воздуха зимой, °C') ?? Wn.tInMin, phi=this.ex(ex, 'phi', 5, 100, W, 'влажность выбросного воздуха, %') ?? Rc.phi;
    // η = (t_после − t_нар) / (t_выб − t_нар) → t_после = t_нар + η·(t_выб − t_нар)
    const tAfter=this.r1(Wn.tWin+eta*(tExh-Wn.tWin)), frost=tAfter<Rc.frost.t && phi>Rc.frost.phi, bypass=Wn.tWin<Rc.frost.bypass;
    const measures=[...(frost || bypass ? [`предподогрев приточного воздуха до +${Rc.frost.preheat} °C`] : []), ...(bypass ? [`байпас рекуператора при наружной ниже ${Rc.frost.bypass} °C`] : []), ...(frost && type==='plate' ? ['периодическая разморозка'] : [])];
    // Q_рекуп = L_зима·ρ·c·η·(t_выб − t_нар) / 3600 — при расчётной зимней; за год — при средней температуре периода
    const days=this.ex(ex, 'days', 0, 365, W, 'отопительный период, сут') ?? Se.days, tavg=this.ex(ex, 'tavg', -40, 8, W, 'средняя температура отопительного периода, °C') ?? Se.tavg;
    const Q=this.heatOf(Wn.Lw, Wn.tWin, eta*(tExh-Wn.tWin)), Qavg=this.heatOf(Wn.Lw, tavg, eta*Math.max(0, tExh-tavg)), year=Math.round(Qavg*days*24);
    if (on && frost) W.push({ level:'warn', text:`Рекуператор: приток после него ${this.f(tAfter)} °C при влажности выбросного воздуха ${phi} % — риск обмерзания; ${measures.join(', ')}.` });
    return { on, worth:why.length>0, why, type, eta, tExh, phi, tAfter, frost, bypass, measures, Q:this.r2(Q), Qavg:this.r2(Qavg), year, days, tavg };
  }
  static TYPES = { plate:'пластинчатый перекрёстный', rotary:'роторный', glycol:'с промежуточным теплоносителем' };
  static f(v, d=1){ const k=Math.pow(10, d); return String(Math.round(v*k)/k).replace('.', ',').replace(/^-/, '−'); }
  static n(v){ return StationLayout.n(Math.round(v)); }
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
  // размеры, пределы и отступы — матрица расстановки, раздел grille («Настройки → … → Жалюзи притока и выброса, маркизы»)
  static get G(){ return StationMatrix.grp('grille'); }
  static get STEP(){ return this.G.step; }
  static get GAP(){ return this.G.gap; }                    // между жалюзи на стене, мм
  static get IN(){ return StationMatrix.derive('ventIn', ()=>{ const g=this.G; return { z0:g.inZ, h:[g.inHmin, g.inHmax], w:[g.inWmin, g.inWmax] }; }); }   // приток: низ на 200 мм от пола, высота и ширина «от–до», мм
  static get WHOLE(){ return this.G.whole; }                // одним проёмом — до 2 400 мм шириной; больше — несколько одинаковых
  static get MAXN(){ return this.G.maxn; }                  // одинаковых проёмов — не больше; не встали — под свободные участки
  // маркиза — откидной козырёк на петлях над жалюзи: закрыт — закрывает проём (щит), открыт на угол от стены — с боковыми
  // створками-ограничителями, воздух проходит только снизу
  static get HOOD_SIDE(){ return this.G.hoodSide; }         // козырёк шире жалюзи на 80 мм с каждой стороны
  static get HOOD_LAP(){ return this.G.hoodLap; }           // закрытый — перекрывает рамку на 50 мм сверху и снизу (петли — на 50 мм выше)
  static get HOOD_ANG(){ return [this.G.hoodAng0, this.G.hoodAng1]; }   // угол открытия от стены, °: меньше — вход узкий, больше — почти горизонтален
  static get HOOD_LOW(){ return this.G.hoodLow; }           // длиннее (вход мал и при 75°) — закрытый не ниже 100 мм от пола
  static get HOOD_GAP(){ return this.G.hoodGap; }           // маркиза — не ближе 300 мм к проёму двери или ворот (сверх обычного)
  static get HOOD_V(){ return StationRules.raw('vent.hood_v'); }
  static HOOD_WHAT = 'маркиза — откидной козырёк на петлях над жалюзи: открыт — с раскрывающимися боковыми створками-ограничителями (воздух проходит только снизу, снег и дождь не задуваются), закрыт — закрывает проём жалюзи как защитный щит (перевозка, простой, непогода)';
  static get LIFT(){ return this.G.lift; }                  // приток над конвектором (внизу места нет): низ, мм
  static get OUT(){ return StationMatrix.derive('ventOut', ()=>{ const g=this.G; return { top:g.outTop, h:[g.outHmin, g.outHmax], w:[g.outWmin, g.outWmax] }; }); }   // вытяжка: верх на 420 мм ниже потолка (под кабельным лотком)
  static get HOOD(){ return this.G.roofHood; }              // колпак выброса на крыше: высота над крышей, мм
  static get PIECE(){ return this.G.piece; }                // добавочные жалюзи (остаток сечения) — не уже, мм
  static get FAN_MIN(){ return this.G.fanMin; }             // проём вытяжного вентилятора — не ниже, мм (осевой вентилятор от Ø 400 мм)
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
  /** n одинаковых жалюзи на площадь по рамке area, м²: {n, w, h} — площадь не меньше нужной, форма ближе к 3 : 2 */
  static sizeN(area, o, n){ return this.sizesN(area, o, n)[0] || null; }
  /** все формы n одинаковых жалюзи (по высоте с шагом; высота — не больше двух ширин), лучшие — первыми: не встала лучшая —
   *  пробуем следующую */
  static sizesN(area, o, n){
    const S=this.STEP, out=[];
    for (let h=o.h[0]; h<=o.h[1]; h+=S){ const w=Math.max(o.w[0], Math.ceil(area/n*1e6/h/S)*S); if (w>o.w[1] || h>2*w) continue;
      out.push({ n, w, h, score:(n*w*h/1e6-area)/area+0.3*Math.abs(Math.log(w/h/1.5)) }); }
    return out.sort((a, b)=>a.score-b.score).map(({ n, w, h })=>({ n, w, h }));
  }
  /** маркиза над жалюзи w × h (верх — z1, мм от пола): козырёк шириной B, длиной l (жалюзи + перекрытие); открыт на угол a
   *  от стены — вход снизу B × d, d = l · sin a (вылет). Угол — наименьший (шаг 5°), при котором скорость во входе не больше
   *  vmax; не хватает и при HOOD_ANG[1] — козырёк длиннее (вниз, не ниже HOOD_LOW). q — расход, м³/ч:
   *  {w:B, l, a, d, drop — насколько кромка ниже петель, v — скорость во входе} */
  static hood(q, w, h, z1, vmax){
    const B=w+2*this.HOOD_SIDE, need=q/3600/vmax/(B/1000)*1000, rad=Math.PI/180, [a0, a1]=this.HOOD_ANG, l0=h+2*this.HOOD_LAP;
    const l=need>l0*Math.sin(a1*rad) ? Math.max(l0, Math.min(z1+this.HOOD_LAP-this.HOOD_LOW, Math.ceil(need/Math.sin(a1*rad)/this.STEP)*this.STEP)) : l0;
    return this.hoodAt({ w:B, l }, Math.min(a1, Math.max(a0, Math.ceil(Math.asin(Math.min(1, need/l))/rad/5)*5)), q);
  }
  /** маркиза H, открытая на угол a, °: вылет, опускание кромки и скорость во входе при расходе q, м³/ч */
  static hoodAt(H, a, q){ const r=a*Math.PI/180, d=Math.round(H.l*Math.sin(r)); return { w:H.w, l:H.l, a, d, drop:Math.round(H.l*Math.cos(r)), v:Math.round(q/3600/(H.w/1000*d/1000)*100)/100 }; }
  /** проекция центра тяжести на стену w (как знак № 12 на 3D-виде): {u, z} мм или null */
  static cog(plan, w){
    const M=plan.mass, g=plan.geo; if (!M || !g || !g.ext) return null; const c=M.cg, [Le, We]=g.ext, [Li, Wi]=plan.int, zf=StationGeo.zFloor(g.type);
    return { u:w==='left' || w==='right' ? c.y-(We-Wi)/2 : c.x-(Le-Li)/2, z:c.z-zf };
  }
  /** расчёт и места. Приток и выброс горячего воздуха — никогда на одной стене: выброс — радиатор ДГУ в дальнем торце или
   *  вверху задней стены (за компрессорами — их воздуховоды с клапаном рециркуляции; сервисные ворота — над ними, в створки
   *  ворот выброс не ставится никогда), затем торец у компрессора без ворот, иначе все компрессоры через крышу (решения
   *  ПНЕВМОТЕХ, calc0). Приток — внизу на стене напротив выброса, затем в створках ворот и сервисных дверей (не на стене выброса), затем на остальных стенах (у ДГУ — в
   *  половине у входа, дальше от радиатора). {q:{in, out, rad}, need:{in, out} — живое сечение и площадь по рамке, м²;
   *  size:{in, out}; louvers:[{kind:'in'|'out'|'rad', wall, u0, u1, z0, z1, w, h[, leaf, duct]}]; roof:[{kind:'out', x0, x1,
   *  y0, y1, w, l, q[, duct]}] — выброс через крышу; exhaust — стена выброса | null; ducts:{ключ компрессора: 'wall'|'roof'};
   *  short:{in, out} — не поместилось, м² по рамке; rad — радиатор ДГУ} */
  static calc(plan){
    // второй ряд компрессоров — выброс в стену прохода над их сервисными воротами, если приток весь встаёт на торцах;
    // иначе — через крышу (крайний случай)
    const a=this.calc0(plan, true);
    if (!a || !(a.short.in>0) || !a.louvers.some(q=>q.kind==='out' && q.wall==='front' && q.duct)) return a;
    const b=this.calc0(plan, false); return b.short.in<a.short.in ? b : a;
  }
  /** расчёт при выбросе второго ряда компрессоров в стену прохода (front) или через крышу */
  static calc0(plan, front){
    const h=plan.heat, v=h && h.vent, sys=plan.sys||{}, I=plan.items||[], [L, Wd, H]=plan.int, dgu=I.find(i=>i.kind==='dgu' && !i.tank);
    if (!v || (!dgu && sys.vent===false)) return null;
    // проёмы — по рамке (решение ПНЕВМОТЕХ): S = L / (3600·v); приток — с запасом (vent.speed.inReserve); живое
    // сечение решётки (доля vent.free) — справочно
    const Sm=v.sum, vIn=Sm ? Sm.vIn : StationRules.raw('vent.speed').in, vOut=Sm ? Sm.vOut : StationRules.raw('vent.speed').out, res=Sm ? Sm.res : StationRules.raw('vent.speed').inReserve;
    const F=vOut, k=this.FREE, r=x=>Math.round(x*100)/100, S=this.STEP, key=StationLayout.key, x0=plan.geo.x0||0;
    // room — общая вытяжка помещения (у компрессорной — вентилятор стоянки или избыток над охлаждением); приток компрессорной —
    // один поток: больший из охлаждения и вентиляции помещения плюс воздух на сжатие (VentCalc.summer)
    const room=Math.max(0, v.m3h-v.use), qRad=dgu ? Math.max(v.rad, room) : 0, qIn=dgu ? qRad+v.use+v.cool : Sm && Sm.Lin ? Sm.Lin : v.m3h+v.cool;
    const comp=I.filter(i=>i.kind==='compressor' && i.mount==='floor' && !i.tank), qc=c=>Math.round(StationHeat.coolOf(c, plan));
    const qOut=(dgu ? 0 : room)+comp.reduce((s, c)=>s+qc(c), 0);
    const need=(q, kind)=>{ const gross=kind==='in' ? q/3600/vIn*res : q/3600/vOut; return { q, gross:r(gross), free:r(gross*k), v:kind==='in' ? vIn : vOut }; };
    const rearBack=(plan.doors||[]).some(d=>d.rear && d.wall==='back');
    // стена выброса — сбоку: задняя (при сервисных воротах за компрессорами — над воротами, коробом-воздухоотводом); через
    // крышу — только остаток, который на стене не поместился
    const radW=new Set(I.filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor').map(i=>i.rad || 'right')), E=dgu ? (radW.has('right') ? 'right' : [...radW][0]) : 'back';
    const out={ q:{ in:Math.round(qIn), out:Math.round(qOut), rad:Math.round(qRad) }, need:{ in:need(qIn, 'in'), out:qOut>0 ? need(qOut, 'out') : null }, size:{}, louvers:[], roof:[],
      exhaust:E, ducts:{}, short:{ in:0, out:0 }, face:F, vIn, vOut, res, free:k, rad:null, draft:null };
    const W=new StWalls(plan, { equip:false }), snow=!!sys.snow, snowOut=!!sys.snowout;
    // маркиза выступает от стены — от дверей и ворот на 300 мм дальше (полотно, открытое наружу на 90°, её не задевает)
    if (snow || snowOut){ const D=this.HOOD_GAP;
      for (const d of (plan.doors||[])) W.busy(d.wall==='back' ? 'back' : 'front', d.x0-D, d.x1+D, 0, d.h+150);
      for (const q of [plan.entry, plan.exit, plan.gates, plan.gates2].filter(Boolean)) if (q.wall==='front') W.busy('front', q.x0-D, q.x1+D, 0, q.h+150); else W.busy(q.wall, q.y0-D, q.y1+D, 0, q.h+150); }
    // радиатор ДГУ: у каждой — своя дверь-жалюзи (или жалюзи) напротив радиатора (дальний торец, торец у входа или задняя
    // стена — поперёк); расход — её радиатора (паспорт или по мощности), общий qRad делится в той же доле
    if (dgu){ const DG=I.filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor'), R=StationRules.raw('heat.dgu_rad'), A=StationHeat.AIR;
      const own=i=>i.cool>0 ? i.cool : i.kw*1000*R.share/(A*R.dt), sum=DG.reduce((s, i)=>s+own(i), 0)||1, rads=[];
      for (const g of DG){ const wall=g.rad || 'right', end=wall!=='back', d=(plan.dguDoors||[]).find(q=>q.pos===g.pos && q.unit===g.unit);
        const Lr=d ? { kind:'rad', wall, u0:end ? d.y0 : d.x0, u1:end ? d.y1 : d.x1, z0:0, z1:d.h, door:true, pos:g.pos, unit:g.unit }
          : { kind:'rad', wall, u0:Math.round((end ? g.y : g.x)+80), u1:Math.round((end ? g.y+g.ly : g.x+g.lx)-80), z0:Math.round(g.h*0.12), z1:Math.round(g.h*0.95), pos:g.pos, unit:g.unit };
        Lr.w=Lr.u1-Lr.u0; Lr.h=Lr.z1-Lr.z0; Lr.q=Math.round(qRad*own(g)/sum); out.louvers.push(Lr); W.busy(wall, Lr.u0-90, Lr.u1+260, Lr.z0, Lr.z1+120);
        const fr=Lr.w*Lr.h/1e6*k; rads.push({ q:Lr.q, free:r(fr), w:Lr.w, h:Lr.h, door:!!Lr.door, wall, v:fr>0 ? Math.round(Lr.q/3600/fr*10)/10 : null }); }
      // сводка — самая нагруженная (наибольшая скорость), n — сколько; list — все
      const top=rads.reduce((a, b)=>(b.v||0)>(a.v||0) ? b : a, rads[0]); if (top) out.rad={ ...top, qOne:top.q, q:Math.round(qRad), n:rads.length, list:rads }; }
    const cogHit=(w, u0, u1, z0, z1)=>{ const c=this.cog(plan, w), hh=150+120; return !!c && c.z+hh>z0 && c.z-hh<z1+220 && u0<c.u+hh && u1>c.u-hh; };
    const gross=q=>q/3600/vOut*1e6;   // выброс по рамке, мм² (S = L / (3600·v_выброс))
    // выброс через крышу: колпак над источником (компрессор — над ним), по площади; мимо глушителя и других колпаков
    const roofs=(plan.roof||[]).map(m=>[m.x-150, m.x+m.lx+150, m.y-150, m.y+m.ly+150]);
    // место — ближе к источнику: сдвиг вдоль крыши и поперёк; нет места — двумя колпаками поменьше; не вышло — не поместилось
    const hood=(q, xc, yc, duct, depth=0)=>{ const a=gross(q), sy=Math.min(Wd-300, Math.max(400, Math.ceil(Math.sqrt(a)/S)*S)), sx=Math.max(400, Math.ceil(a/sy/S)*S);
      const hit=(x, y)=>x<x0+150 || x+sx>L-150 || roofs.some(([a, b, c, d])=>x<b && x+sx>a && y<d && y+sy>c);
      const ys=[...new Set([yc-sy/2, 150, Wd-150-sy].map(y=>Math.round(Math.max(150, Math.min(Wd-150-sy, y)))))], x1=Math.round(xc-sx/2);
      let at=null; for (let d=0; d<=L && !at; d+=S) for (const x of d ? [x1+d, x1-d] : [x1]) for (const y of ys) if (!at && !hit(x, y)) at=[x, y];
      if (!at){ if (depth<2 && a>0.5e6){ hood(q/2, xc, yc, duct, depth+1); hood(q/2, xc, yc, duct, depth+1); } else out.short.out=r(out.short.out+a/1e6); return; }
      const [xa, ya]=at; roofs.push([xa-150, xa+sx+150, ya-150, ya+sy+150]);
      out.roof.push({ kind:'out', x0:xa, x1:xa+sx, y0:ya, y1:ya+sy, w:sx, l:sy, q:Math.round(q), ...(duct ? { duct } : {}) }); };
    const OB=this.OUT, oh=Math.max(OB.h[0], Math.min(OB.h[1], H-OB.top-this.IN.z0-this.IN.h[0]-200));   // вытяжка — вверху: высота жалюзи
    let qWall=dgu ? 0 : room, outRest=0;   // outRest — общая вытяжка, не вставшая на стену выброса (мм² по рамке)
    // компрессоры: горячий воздух — воздуховодом с клапаном рециркуляции к стене, у которой компрессор стоит (задняя; второй
    // ряд — стена прохода, если приток весь встаёт на торцах, иначе крыша). За компрессором сервисные ворота — жалюзи НАД
    // воротами (по ширине его части ворот); в створки ворот выброс не ставится; ворот нет — вверху стены над компрессором
    // (сдвиг до 1,5 м). Не хватило площади — добавка на ближайшей боковой стене: торец, у которого компрессор стоит (между
    // ним и торцом нет оборудования), если в этом торце нет ворот. Не вывести из стены хоть одного компрессора — через крышу
    // все компрессоры, каналы на крыше одного размера. Решётки выброса у всех компрессоров станции одинаковые (решение
    // ПНЕВМОТЕХ) — размер общий и встаёт у каждого; добавку в торце получают все или никто (иначе остаток всех — в общую
    // вытяжку стены выброса).
    // С системой «Вытяжные вентиляторы» на тех же местах — проёмы осевых вентиляторов (скорость выброса vOut — из расчёта)
    const exWall=c=>E!=='back' ? null : plan.rows===2 && c.row===1 ? (front ? 'front' : null) : 'back';
    const gate=(c, w)=>(plan.doors||[]).find(d=>d.rear && d.wall===w && d.pos.includes(c.pos) && d.x0<c.x+c.lx && d.x1>c.x);
    const share=(G, w)=>comp.filter(c=>exWall(c)===w && gate(c, w)===G).sort((a, b)=>a.x-b.x);   // компрессоры за одними воротами
    const z1T=H-100, leftOk0=x0===0 && !plan.geo.sea, hMin=Sm && Sm.exfan ? this.FAN_MIN : OB.h[0];   // с вентиляторами — проём не ниже FAN_MIN
    const zTop=w=>H-(w==='back' && rearBack ? 100 : OB.top);
    // свободное место для жалюзи w × hh вверху стены wall: ближе всего к uc, сдвиг не больше maxd → {u, z0, z1, d} | null
    const fitAt=(wall, w, hh, uc, maxd, ok)=>{ const z1=zTop(wall), z0=z1-hh, end=wall==='left' || wall==='right', lo=end ? 100 : x0+100, hi=end ? Wd-100 : L-100;
      for (let d=0; d<=maxd; d+=S) for (const sg of d ? [1, -1] : [1]){ const a=Math.round(uc-w/2+sg*d);
        if (a>=lo && a+w<=hi && W.free(wall, a-90, a+w+90, z0-90, z1+90) && !cogHit(wall, a, a+w, z0, z1) && (!ok || ok(a))) return { u:a, z0, z1, d }; }
      return null; };
    // ближайшая боковая стена — торец, у которого компрессор стоит: между ним и торцом (в его полосе по ширине) нет
    // оборудования, в торце нет ворот; торцы — только пока второй ряд не выбрасывает в стену прохода (тогда приток — на торцах)
    const endsOk=!comp.some(c=>exWall(c)==='front'), gatesOn=w=>[plan.gates, plan.gates2].some(g=>g && g.wall===w);
    const floor=I.filter(i=>!i.tank && i.mount!=='pipe' && i.mount!=='wall');
    const atEnd=(c, e)=>!floor.some(i=>i!==c && i.y<c.y+c.ly && i.y+i.ly>c.y && (e==='right' ? i.x>=c.x+c.lx-1 : i.x+i.lx<=c.x+1));
    const side=(c, w, hh)=>{ const cx=c.x+c.lx/2, cy=c.y+c.ly/2; let best=null;
      for (const e of endsOk ? ['right', ...(leftOk0 ? ['left'] : [])].filter(e=>!gatesOn(e) && atEnd(c, e)) : []){
        if (w>Wd-200) continue; const r2=fitAt(e, w, hh, cy, Wd); if (!r2) continue;
        const len=(e==='right' ? L-cx : cx-x0)+r2.d; if (!best || len<best.len) best={ wall:e, ...r2, len }; }
      return best; };
    const mark=()=>({ b:W.mark(), n:out.louvers.length });
    const unmark=m=>{ W.reset(m.b); out.louvers.length=m.n; };
    const add=L=>{ out.louvers.push(L); W.busy(L.wall, L.u0-90-this.GAP, L.u1+260+this.GAP, L.z0-90, L.z1+90); return L; };
    // место компрессора: над его воротами (его часть ворот: ширина, высота от перемычки +240 мм до 100 мм под потолком) или
    // вверху стены над ним
    const slot=c=>{ const wall=exWall(c), G=wall && gate(c, wall); if (!G) return { c, wall, hMax:oh, wMax:this.WHOLE };
      const S2=share(G, wall), i=S2.indexOf(c), sw=(G.x1-G.x0)/S2.length, gap=S2.length>1 ? this.GAP/2 : 0;
      return { c, wall, G, a0:G.x0+i*sw, sw, hMax:Math.floor(Math.min(OB.h[1], z1T-(G.h+240))/S)*S, wMax:Math.min(this.WHOLE, Math.floor((sw-2*gap)/S)*S) }; };
    const at=(s, w, hh)=>{ const kk=key(s.c);
      if (s.G){ const u=Math.round(s.a0+(s.sw-w)/2); return add({ kind:'out', wall:s.wall, u0:u, u1:u+w, z0:z1T-hh, z1:z1T, w, h:hh, duct:kk, over:true }); }
      const r=fitAt(s.wall, w, hh, s.c.x+s.c.lx/2, 1500); return r && add({ kind:'out', wall:s.wall, u0:r.u, u1:r.u+w, z0:r.z0, z1:r.z1, w, h:hh, duct:kk }); };
    // одна решётка w × hh у каждого компрессора группы; не встала хоть у одного — ничего не ставится
    const all=(G, w, hh, f)=>{ const m=mark(); for (const s of G) if (!f(s, w, hh)){ unmark(m); return false; } return true; };
    // все компрессоры станции — одна группа: решётки у всех одного размера, по наибольшему расходу (и у разных исполнений
    // одного компрессора, например DL-55/8GA и DL-55/8GA-F)
    const groups=comp.length ? [comp.slice().sort((a, b)=>qc(b)-qc(a))] : [];
    const mC=W.mark(), nC=out.louvers.length, nR0=out.roof.length, qW0=qWall;
    let viaRoof=comp.some(c=>!exWall(c));
    for (const Cs of viaRoof ? [] : groups){ const q=qc(Cs[0]), need0=gross(q), Sl=Cs.map(slot);
      const hTop=Math.min(...Sl.map(s=>s.hMax)), wTop=Math.min(...Sl.map(s=>s.wMax)); let got=null, part=null;
      // размер — по самому стеснённому месту группы: выше решётка — уже; полностью не хватает — наибольшая, что встаёт у всех
      for (let hh=hTop; hh>=hMin && wTop>=OB.w[0]; hh-=50){ const w=Math.max(OB.w[0], Math.min(wTop, Math.ceil(need0/hh/S)*S)), m=mark();
        if (!all(Sl, w, hh, at)) continue;
        if (w*hh>=need0){ got=[w, hh]; break; }
        unmark(m); if (!part || w*hh>part[0]*part[1]) part=[w, hh]; }
      if (!got && part && all(Sl, part[0], part[1], at)) got=part;
      if (!got){ viaRoof=true; break; }
      let rest=Math.max(0, q-got[0]*got[1]/1e6*F*3600);
      // остаток — добавка одного размера в торце у каждого; хоть одному некуда — у всех в общую вытяжку
      if (rest>1){ for (let hh=oh; hh>=hMin && rest>1; hh-=50){ const w=Math.max(OB.w[0], Math.min(this.WHOLE, Math.ceil(gross(rest)/hh/S)*S));
          if (all(Sl, w, hh, (s, w2, h2)=>{ const r=side(s.c, w2, h2); return r && add({ kind:'out', wall:r.wall, u0:r.u, u1:r.u+w2, z0:r.z0, z1:r.z1, w:w2, h:h2, duct:key(s.c), side:true }); })) rest=Math.max(0, rest-w*hh/1e6*F*3600); } }
      for (const c of Cs) out.ducts[key(c)]='wall';
      // не хватило и сбоку — остаток в общую вытяжку стены выброса (задняя), у стены прохода — колпаком
      if (rest>1){ if (Sl.every(s=>s.wall==='back')) qWall+=rest*Cs.length; else { viaRoof=true; break; } } }
    // через крышу — все компрессоры, колпаки одного размера (по наибольшему расходу)
    if (viaRoof){ W.reset(mC); out.louvers.length=nC; out.roof.length=nR0; qWall=qW0; out.ducts={};
      const qMax=Math.max(...comp.map(qc)); for (const c of comp){ const kk=key(c); out.ducts[kk]='roof'; hood(qMax, c.x+c.lx/2, c.y+c.ly/2, kk); } }
    const exW=new Set([E, ...out.louvers.filter(q=>q.kind==='out' || q.kind==='rad').map(q=>q.wall)]);   // стены выброса: притока на них нет
    // места на стене: жалюзи u0…u1 (слева 100 мм, справа 260 мм — электропривод клапана), мимо знака «Центр тяжести»
    const spotAt=(wall, from, w, lim, z0, z1)=>W.find(wall, w+360, z0-90, z1+90, from, a=>!cogHit(wall, a+100, a+100+w, z0, z1) && (!lim || a+100+w<=lim));
    const putAt=(kind, wall, w, u, z0, hh)=>{ const u0=u+100, Lv={ kind, wall, u0, u1:u0+w, z0, z1:z0+hh, w, h:hh }; out.louvers.push(Lv); W.busy(wall, u0-90-this.GAP, Lv.u1+260+this.GAP, z0-90, z0+hh+90); return w*hh; };
    // без лишнего разбиения: одним проёмом, иначе наименьшим числом одинаковых (до MAXN), если они встают целиком; bands —
    // высоты низа (приток: внизу, затем над конвекторами); не встали — false (ничего не поставлено)
    const whole=(kind, o, walls, gross, bands)=>{
      for (let n=1; n<=this.MAXN; n++) for (const zb of bands){
        const hmax=Math.floor(Math.min(o.h[1], kind==='in' ? H-OB.top-90-zb : H-o.top-this.IN.z0-this.IN.h[0]-200)/S)*S; if (hmax<o.h[0]) continue;
        for (const sz of this.sizesN(gross, { ...o, w:[o.w[0], Math.max(o.w[1], this.WHOLE)], h:[o.h[0], hmax] }, n)){   // лучшая форма не встала — следующая
          const z0=kind==='in' ? zb : H-o.top-sz.h, mark=W.mark(), nL=out.louvers.length;
          let got=0; for (const [wall, from, lim] of walls) while (got<n){ const u=spotAt(wall, from, sz.w, lim, z0, z0+sz.h); if (u==null) break; putAt(kind, wall, sz.w, u, z0, sz.h); got++; }
          if (got===n){ out.size[kind]=sz; return true; }
          W.reset(mark); out.louvers.length=nL; } }
      return false;
    };
    // одинаковые жалюзи по расчёту (size); не встали все — остаток той же высоты, ширина — под свободные участки стен
    const place=(kind, o, walls, need0)=>{
      const nd=need0; if (!nd || nd.gross<=0) return 0;
      const sz=this.size(nd.gross, o); out.size[kind]=out.size[kind]||sz; if (!sz) return nd.gross*1e6;
      const hh=sz.h, z0=kind==='in' ? o.z0 : H-o.top-hh; let left=nd.gross*1e6, uni=sz.n;
      const put=(wall, w, u)=>{ left-=putAt(kind, wall, w, u, z0, hh); };
      const spot=(wall, from, w, lim)=>spotAt(wall, from, w, lim, z0, z0+hh);
      for (const [wall, from, lim] of walls) while (uni>0 && left>1){ const u=spot(wall, from, sz.w, lim); if (u==null) break; put(wall, sz.w, u); uni--; }
      for (const [wall, from, lim] of walls) while (left>1){
        let w=Math.min(o.w[1], Math.max(this.PIECE, Math.ceil(left/hh/S)*S)), u=null;
        for (; w>=this.PIECE; w-=S){ u=spot(wall, from, w, lim); if (u==null) continue; break; }
        if (u==null) break; put(wall, w, u); }
      return Math.max(0, left);
    };
    // общая вытяжка (тепло корпусов, осушителей, солнца; остаток от компрессоров) — вверху на стене выброса, остальное — крыша
    // у компрессорной — рядом с осушителем (решение ПНЕВМОТЕХ: «дополнительный канал отвода тепла — рядом с осушителем, а
    // не в случайном месте», на этом же канале — вытяжной вентилятор по необходимости)
    const dr=comp.length ? I.filter(i=>i.kind==='dryer' && i.mount==='floor').sort((a, b)=>a.x-b.x)[0] : null, hub=dr ? Math.round(dr.x+dr.lx/2) : 'hi';
    // общая вытяжка (дополнительный канал у осушителя) — своего расчётного размера, никогда над сервисными воротами — там
    // только компрессорные
    for (const d of (plan.doors||[]).filter(d=>d.wall==='back')) W.busy('back', d.x0-150, d.x1+150, 0, H);
    if (qWall>0){ const o={ ...OB, h:[OB.h[0], oh] };
      let left=E==='back' ? (whole('out', o, [['back', hub]], need(qWall, 'out').gross, [0]) ? 0 : place('out', o, [['back', hub]], need(qWall, 'out'))) : need(qWall, 'out').gross*1e6;
      // не встало — остаток выше ростом (на стене выброса притока нет): на крышу — только в самом крайнем случае
      if (left>1 && E==='back'){ const hT=Math.floor(Math.max(OB.h[0], H-OB.top-600)/S)*S;
        if (hT>oh) left=place('out', { ...OB, h:[OB.h[0], hT] }, [['back', hub]], { gross:left/1e6 }); }
      if (left>1) outRest=left; }
    if (!out.size.out && out.need.out) out.size.out=this.size(out.need.out.gross, OB);
    // приток: стена напротив выброса → створки ворот и сервисных дверей (не на стене выброса) → остальные стены (не выброса)
    const opp={ back:'front', front:'back', left:'right', right:'left' }, IN=this.IN;
    const first=(E ? [opp[E], 'left', 'right', 'front'].find(w=>!exW.has(w)) : null) || 'front', leftOk=x0===0 && !plan.geo.sea, G=plan.gates;
    let left=need(qIn, 'in').gross*1e6;
    const wallsOf=list=>list.filter(([w])=>!exW.has(w) && (w!=='left' || leftOk));
    // у ДГУ — не у радиатора: радиатор в дальнем торце — приток от входа (не ближе 1,5 м к торцу); две ДГУ радиаторами к торцам —
    // на длинных стенах от середины (к генераторам); поперёк (радиаторы к задней стене) — стена прохода и торцы
    const lim=dgu && radW.size===1 && radW.has('right') ? Math.round(L-1500) : null, mid=Math.round((x0+L)/2);
    const rest=wallsOf(!dgu ? [['left', 'lo'], ['right', 'lo'], ['back', 'lo'], ['front', 'hi']]
      : radW.has('back') ? [['front', 'lo'], ['left', 'lo'], ['right', 'lo']]
      : radW.has('left') ? [['back', mid], ['front', mid]] : [['left', 'lo'], ['back', 'lo', lim], ['front', 'lo', lim]]);
    const firstW=wallsOf([[first, dgu && radW.has('left') && (first==='front' || first==='back') ? mid : first==='front' ? 'hi' : 'lo']]);
    // одним проёмом (наименьшим числом одинаковых): напротив выброса, затем на свободных стенах — внизу, затем над конвекторами
    // с маркизой — сначала выше (над конвекторами): вход под маркизой выше снегового покрова
    const lift={ ...IN, z0:this.LIFT, h:[IN.h[0], Math.min(IN.h[1], Math.floor((H-OB.top-90-this.LIFT)/S)*S)] }, lo=snow && lift.h[1]>=lift.h[0] ? lift : IN, hi=lo===IN ? lift : IN;
    const allW=[...firstW, ...rest.filter(([w])=>w!==first)], bands=[lo.z0, hi.z0];
    // в створках: ворота в торце (не морского), сервисные ворота и двери — внизу полотна, мимо запорных штанг и калитки
    const leaves=(d, wall, u0, u1, n, skip)=>{ const lw=(u1-u0)/n, z0=IN.z0, hh=Math.floor(Math.min(d.h-350-z0, IN.h[1])/S)*S;
      for (let i=0; i<n && left>1 && hh>=IN.h[0]; i++){ if (i===skip) continue;
        const a0=u0+i*lw+(i===0 ? 120 : 160), b0=u0+(i+1)*lw-(i===n-1 ? 120 : 160), w=Math.min(IN.w[1], Math.floor((b0-a0)/S)*S); if (w<IN.w[0]) continue;
        const a=Math.round((a0+b0-w)/2); out.louvers.push({ kind:'in', wall, u0:a, u1:a+w, z0, z1:z0+hh, w, h:hh, leaf:true }); left-=w*hh; } };
    const allLeaves=()=>{ for (const Q of [G, plan.gates2]) if (left>1 && Q && !exW.has(Q.wall)) leaves(Q, Q.wall, Q.y0+(Q.sea ? 150 : 0), Q.y1-(Q.sea ? 150 : 0), Q.leaves||2, Q.wicket ? 0 : -1);   // у морского — в его дверях
      for (const d of (plan.doors||[]).filter(d=>d.kind!=='entry' && !exW.has(d.wall))) if (left>1) leaves(d, d.wall, d.x0, d.x1, d.leaves||1, -1); };
    // или: створки ворот и сервисных дверей (проём уже есть), остаток — так же; из двух — где жалюзи меньше (поровну — на стенах)
    const l0=left, nL=out.louvers.length, m0=W.mark(), sz0=out.size.in;
    const undo=()=>{ W.reset(m0); out.louvers.length=nL; left=l0; out.size.in=sz0; };
    const onWalls=()=>{ if (!whole('in', IN, allW, left/1e6, bands)) return false; left=0; return true; };
    const withLeaves=()=>{ allLeaves(); if (left<=1) return true; if (left>=l0 || !whole('in', IN, allW, left/1e6, bands)) return false; left=0; return true; };
    const nA=onWalls() ? out.louvers.length-nL : 0;
    if (nA!==1){ undo(); const nB=withLeaves() ? out.louvers.length-nL : 0;
      if (!nB || (nA && nB>=nA)){ undo();
        if (nA) onWalls();
        else { left=place('in', lo, firstW, { gross:left/1e6 }); allLeaves();   // одинаковыми не встало — под свободные участки
          if (left>1) left=place('in', lo, rest.filter(([w])=>w!==first), { gross:left/1e6 }); } } }
    // на этой высоте места нет (конвекторы, знаки) — на другой, на тех же стенах
    if (left>1 && hi.h[1]>=hi.h[0]) left=place('in', hi, allW, { gross:left/1e6 });
    if (!out.size.in) out.size.in=this.size(out.need.in.gross, IN);
    // жалюзи притока не встали — приточные вентиляторы на остаток (решение ПНЕВМОТЕХ, «при необходимости»): проём
    // меньше (скорость vFanIn по рамке), включаются по датчику температуры; не встали и они — нехватка притока
    const Ef=StationRules.opt('vent.exfan');
    if (left>1 && Ef && sys.infan!==false && qIn>0){ const qs=left/1e6*3600*vIn/res, g0=qs*Ef.reserve/3600/Ef.vFanIn, nL0=out.louvers.length;
      let fl=place('in', IN, allW, { gross:g0 }); if (fl>1 && hi.h[1]>=hi.h[0]) fl=place('in', hi, allW, { gross:fl/1e6 });
      const Fi=out.louvers.slice(nL0); Fi.forEach(q=>{ q.fan=true; });
      if (Fi.length){ const done=Math.min(1, 1-Math.max(0, fl)/(g0*1e6)), q=Math.round(qs*done/10)*10, Lf=Math.round(q*Ef.reserve/10)*10;
        out.infan={ n:Fi.length, q, L:Lf, dp:Ef.dp, eta:Ef.eta, P:VentCalc.fanPower(Lf, Ef.dp, Ef.eta), v:Ef.vFanIn }; left=left*(1-done); } }
    out.short.in=r(Math.max(0, left)/1e6);
    // остаток вытяжки — сбоку, на торцах без притока (наверху), и только потом — через крышу (самый крайний случай)
    if (outRest>1){ const ends=['right', ...(leftOk ? ['left'] : [])].filter(w=>w!==E && !out.louvers.some(q=>q.kind==='in' && q.wall===w));
      const hT=Math.floor(Math.max(OB.h[0], H-OB.top-600)/S)*S;
      if (ends.length) outRest=place('out', { ...OB, h:[OB.h[0], hT] }, ends.map(w=>[w, 'hi']), { gross:outRest/1e6 });
      // в створки ворот выброс не ставится — остаток через крышу
      if (outRest>1) hood(outRest/1e6*F*3600, L-Math.min(1500, (L-x0)/4), Wd/2, null); }
    // маркизы: на приточных (снегозащита; расход — по площади жалюзи, вход снизу не быстрее vent.hood_v) и по требованию на
    // жалюзи выброса (расход — по сечению жалюзи; выход вниз не меньше живого сечения — не быстрее heat.face); угол открытия у
    // всех один — наибольший из нужных
    const marks=(I, Q, vmax)=>{ if (!I.length) return null;
      const H=I.map(q=>this.hood(Q(q), q.w, q.h, q.z1, vmax)), a=Math.max(...H.map(h=>h.a));
      I.forEach((q, i)=>{ q.hood=this.hoodAt(H[i], a, Q(q)); });
      return { n:I.length, v:vmax, a, d:Math.max(...I.map(q=>q.hood.d)), over:I.filter(q=>q.hood.v>vmax+0.005).length }; };
    // естественная тяга общей вытяжки помещения — у станций без компрессоров (у компрессорной помещение продувает вентилятор
    // компрессора, при остановке — вентилятор стоянки): от середины притока до середины выброса
    const zc=L=>L.reduce((s, q)=>s+(q.z0+q.z1)/2*q.w*q.h, 0)/Math.max(1, L.reduce((s, q)=>s+q.w*q.h, 0));
    const Li=out.louvers.filter(q=>q.kind==='in'), Lo=out.louvers.filter(q=>q.kind==='out' && !q.duct);
    if (!dgu && Sm && !Sm.units.length && Li.length && (Lo.length || (out.roof||[]).some(q=>!q.duct))){ const zo=Lo.length ? zc(Lo) : H+StationVent.HOOD;
      out.draft=VentCalc.draft(Sm, (zo-zc(Li))/1000, room, v.ex||{}, v.warn||[]); }
    if (snow){ const I=out.louvers.filter(q=>q.kind==='in'), A=I.reduce((s, q)=>s+q.w*q.h, 0); out.hood=marks(I, q=>qIn*q.w*q.h/A, this.HOOD_V); }
    if (snowOut) out.hoodOut=marks(out.louvers.filter(q=>q.kind==='out'), q=>q.w*q.h/1e6*F*3600, F);
    // «Вытяжные вентиляторы»: все проёмы выброса на стенах и колпаки на крыше — с осевыми вентиляторами (по термостату)
    if (Sm && Sm.exfan){ const Lx=out.louvers.filter(q=>q.kind==='out'); Lx.forEach(q=>{ q.fan=true; }); (out.roof||[]).forEach(q=>{ q.fan=true; });
      out.exfan={ n:Lx.length+(out.roof||[]).length, L:Sm.exfan.L, dp:Sm.exfan.dp, P:Sm.exfan.P }; }
    return out;
  }
  /** «2 × 1000 × 800 мм» */
  static text(sz){ const n=StationLayout.n; return sz ? `${sz.n>1 ? sz.n+' × ' : ''}${n(sz.w)} × ${n(sz.h)} мм` : ''; }
  /** жалюзи вида kind (на стене wall) по размерам: «2 × 1400 × 1000 мм + 900 × 1000 мм»; не поставлено — расчётный размер;
   *  max — больше разных размеров — коротко: «7 шт., 9,4 м² по рамке» */
  static list(V, kind, wall, max=0){
    const L=V.louvers.filter(q=>q.kind===kind && (!wall || q.wall===wall)); if (!L.length) return wall ? '' : this.text(V.size[kind]);
    const g=new Map(); for (const q of L){ const k=q.w+'×'+q.h; g.set(k, (g.get(k)||0)+1); }
    if (max && g.size>max) return `${L.length} шт., ${String(Math.round(L.reduce((s, q)=>s+q.w*q.h, 0)/1e4)/100).replace('.', ',')} м² по рамке`;
    return [...g].map(([k, c])=>{ const [w, h]=k.split('×').map(Number); return this.text({ n:c, w, h }); }).join(' + ');
  }
  /** выброс через крышу: «2 × 1000 × 800 мм» (колпаки, размер проёма) */
  static roofList(V){ const g=new Map(); for (const q of V.roof||[]){ const k=q.w+'×'+q.l; g.set(k, (g.get(k)||0)+1); }
    return [...g].map(([k, c])=>{ const [w, l]=k.split('×').map(Number); return this.text({ n:c, w, h:l }); }).join(' + '); }
  static WALL = { back:'задней стене', front:'стене прохода', left:'торце у входа', right:'дальнем торце' };
  /** где радиаторы ДГУ: «радиатор ДГУ — в дальнем торце», «радиаторы ДГУ — в торце у входа и в дальнем торце» */
  static radAt(V){ const L=(V.rad && V.rad.list)||[V.rad], ws=[...new Set(L.map(q=>q.wall||'right'))].map(w=>this.WALL[w]);
    return `${L.length>1 ? 'радиаторы ДГУ' : 'радиатор ДГУ'} — в ${ws.join(' и в ')}`; }
  /** радиаторы ДГУ словами для замечания: расход, двери-жалюзи, живое сечение и скорость каждой */
  static radText(V){ const n=StationLayout.n, f=v=>String(v).replace('.', ','), L=(V.rad.list)||[V.rad];
    if (L.length===1){ const q=L[0]; return `радиатор ДГУ — ${n(V.rad.q)} м³/ч через ${q.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(q.w)} × ${n(q.h)} мм в ${this.WALL[q.wall||'right']} (живое сечение ${f(q.free)} м², ${f(q.v)} м/с)`; }
    return `радиаторы ДГУ — ${n(V.rad.q)} м³/ч, у каждой ДГУ своя ${L.every(q=>q.door) ? 'дверь-жалюзи' : 'решётка'} напротив радиатора: ${L.map(q=>`${n(q.q)} м³/ч через ${n(q.w)} × ${n(q.h)} мм в ${this.WALL[q.wall||'right']} (${f(q.v)} м/с)`).join('; ')}`; }
  /** где жалюзи выброса (без крыши): «над сервисными воротами, вверху в задней стене»;
   *  sizes — с размерами по местам: «над сервисными воротами 2 × 1 400 × 350 мм, вверху в задней стене 400 × 300 мм» */
  static outAt(V, sizes=false){
    const O=V.louvers.filter(q=>q.kind==='out'), part=(t, L)=>L.length ? [t+(sizes ? ' '+this.list({ louvers:L, size:{} }, 'out') : '')] : [];
    const R=O.filter(q=>!q.over), ws=[...new Set(R.map(q=>q.wall))];
    return [...part('над сервисными воротами', O.filter(q=>q.over)), ...ws.flatMap(w=>part('вверху в '+this.WALL[w], R.filter(q=>q.wall===w)))].join(', ');
  }
  /** где приток и где выброс — словами: «приток — в стене прохода и в створках ворот; выброс — вверху задней стены и через крышу» */
  static where(V){
    const I=V.louvers.filter(q=>q.kind==='in'), ws=[...new Set(I.filter(q=>!q.leaf).map(q=>this.WALL[q.wall]))], lf=I.some(q=>q.leaf);
    const a=[...ws.map(w=>'в '+w), ...(lf ? ['в створках ворот и сервисных дверей'] : [])].join(', '), oa=this.outAt(V);
    const b=[...(oa ? [oa] : []), ...((V.roof||[]).length ? ['через крышу'] : []), ...(V.rad ? [this.radAt(V)] : [])].join(', ');
    return { in:a, out:b };
  }
  /** маркизы словами (kind — 'in' на притоке, 'out' на выбросе): «2 × 1 660 × 1 300 мм, открыты на 45° — вылет 920 мм
   *  (воздух входит снизу — до 1,42 м/с, не более 1,5 м/с)» */
  static hoodText(V, kind='in'){
    const I=V.louvers.filter(q=>q.kind===kind && q.hood); if (!I.length) return '';
    const n=StationLayout.n, f=v=>String(v).replace('.', ','), g=new Map(), lim=kind==='in' ? this.HOOD_V : V.face;
    for (const q of I){ const k=q.hood.w+'×'+q.hood.l; g.set(k, (g.get(k)||0)+1); }
    const vmax=Math.max(...I.map(q=>q.hood.v)), D=I.map(q=>q.hood.d), d0=Math.min(...D), d1=Math.max(...D);
    return [...g].map(([k, c])=>{ const [w, l]=k.split('×').map(Number); return `${c>1 ? c+' × ' : ''}${n(w)} × ${n(l)} мм`; }).join(' + ')
      +`, открыты на ${I[0].hood.a}° — вылет ${d0===d1 ? '' : 'до '}${n(d1)} мм (${kind==='in' ? 'воздух входит снизу' : 'горячий воздух выходит вниз'} — до ${f(vmax)} м/с, ${vmax>lim+0.005 ? 'больше нормы' : 'не более'} ${f(lim)} м/с)`;
  }
  /** замечания для «Компоновки»: расходы, сечения, размеры, где приток и выброс (не на одной стене); рециркуляция; не
   *  поместилось — предупреждение */
  static notes(plan){
    const V=plan.vent, iss=plan.issues; if (!V) return;
    const n=StationLayout.n, f=v=>String(v).replace('.', ','), H=plan.heat && plan.heat.vent, tm=H ? StationNorms.deg(H.tmax) : '', wh=this.where(V);
    const Sm=H && H.sum, cfm=q=>Sm ? ` (${n(VentCalc.cfm(q))} CFM)` : '';
    const t=[`приток ${n(V.q.in)} м³/ч${cfm(V.q.in)} — проёмы по рамке не менее ${f(V.need.in.gross)} м² (${f(V.vIn)} м/с, запас ${Math.round((V.res-1)*100)} %), жалюзи ${this.list(V, 'in') || 'по месту'}${wh.in ? ' — '+wh.in : ''}`];
    if (V.need.out){ const w=V.louvers.some(q=>q.kind==='out') ? this.list(V, 'out') : '', rf=this.roofList(V);
      t.push(`выброс горячего воздуха ${n(V.q.out)} м³/ч${cfm(V.q.out)} — не менее ${f(V.need.out.gross)} м² (${f(V.vOut)} м/с): ${[w ? `жалюзи ${this.outAt(V, true)}` : '', rf ? `через крышу — колпаки ${rf}` : ''].filter(Boolean).join(', ')}`); }
    if (V.rad) t.push(this.radText(V));
    const dtx=Sm && Sm.units.length ? ` Тепло компрессоров ${f(Sm.Qc)} кВт (N·k или паспорт); воздух охлаждения ${n(Sm.Lcool)} м³/ч — вентилятором компрессора (нагрев в нём ${f(Sm.dtc)} °C, паспорт важнее), горячий — воздуховодом наружу; тот же поток продувает помещение — у входа компрессора около ${VentCalc.f(Sm.tComp)} °C (не выше ${f(Sm.tIn)} °C).`
      +(Sm.stand ? Sm.exfan ? ' При остановленных компрессорах помещение продувают те же вытяжные вентиляторы (по датчику температуры).' : ` При остановленных компрессорах — вытяжной вентилятор с термостатом ${n(Sm.stand.L)} м³/ч (около ${f(Sm.stand.P)} кВт) — прямо на канале общей вытяжки рядом с осушителем.` : '')
      +(Sm.exfan ? ` Вытяжные вентиляторы — вверху стены напротив притока (осевые, с гравитационными жалюзи, включаются автоматически по датчику температуры): ${n(Sm.exfan.L)} м³/ч (запас ${Math.round((Sm.exfan.reserve-1)*100)} %)${V.exfan ? ` в ${V.exfan.n} ${V.exfan.n===1 ? 'проёме' : 'проёмах'}` : ''}, напор не менее ${Sm.exfan.dp} Па, около ${f(Sm.exfan.P)} кВт; воздуховоды компрессоров подведены к ним.`
      : Sm.boost ? ` Вентилятор в воздуховоде выброса: ${n(Sm.boost.L)} м³/ч, напор не менее ${Sm.boost.dp} Па, около ${f(Sm.boost.P)} кВт.` : ` Жалюзи выброса — с малым сопротивлением: воздуховод с жалюзи не более ${Sm.ductDp} Па (штатный вентилятор компрессора).`) : '';
    iss.push({ level:'info', text:`Вентиляция летом${tm ? ` (до ${tm})` : ''}: ${t.join('; ')}.${dtx} Приток и выброс — на разных стенах; размеры — по рамке (в живом сечении решётки скорость выше), места жалюзи — на чертеже и 3D-виде.` });
    if (V.infan) iss.push({ level:'info', text:`Приточные вентиляторы: приточные жалюзи целиком не встали — ${V.infan.n} ${V.infan.n===1 ? 'проём' : 'проёма(ов)'} с осевыми вентиляторами на ${n(V.infan.q)} м³/ч (с запасом ${n(V.infan.L)} м³/ч, ${f(V.infan.v)} м/с по рамке, напор не менее ${V.infan.dp} Па, около ${f(V.infan.P)} кВт); включаются автоматически по датчику температуры.` });
    // выброс компрессора через крышу — исключение: на стенах места нет
    const viaRoof=Object.values(V.ducts||{}).filter(t=>t==='roof').length;
    if (viaRoof && Sm && Sm.units.length) iss.push({ level:'info', text:`Выброс горячего воздуха ${viaRoof>1 ? 'всех '+viaRoof+' компрессоров' : 'компрессора'} — через крышу, каналы одного размера: над воротами места нет, а в торце выброс невозможен (компрессор не у торца или в торце ворота).` });
    // зима: баланс тепла при работе и открытие регулируемых жалюзи; рекуператор — по требованию заказчика
    const Wn=H && H.win, Rc=H && H.rec;
    if (Wn && !Wn.warm) iss.push({ level:'info', text:`Вентиляция зимой (${StationNorms.deg(Wn.tWin)}): потери ограждений ${f(Wn.Qenv)} кВт + минимальный воздухообмен ${n(Wn.Lw)} м³/ч — ${f(Wn.Qvent)} кВт; тепло работающего ${(plan.items||[]).some(i=>i.kind==='dgu') ? 'агрегата (ДГУ)' : (plan.items||[]).some(i=>i.kind==='compressor') ? 'компрессора' : 'агрегата'} ${f(Wn.Qrun)} кВт — ${Wn.bal>=0 ? `профицит ${f(Wn.bal)} кВт, достаточно частичной рециркуляции` : `дефицит ${f(-Wn.bal)} кВт — подогрев`}. Регулируемые жалюзи зимой открыты на ${Wn.open} % (нужно ${String(Wn.ratio).replace('.', ',')} % летнего расхода).` });
    if (Rc && Rc.on) iss.push({ level:Rc.frost ? 'warn' : 'info', text:`Рекуператор (по требованию заказчика): ${VentCalc.TYPES[Rc.type]}, КПД ${f(Rc.eta)}; приток после него ${Rc.tAfter>0 ? '+' : ''}${VentCalc.f(Rc.tAfter)} °C; экономия ${f(Rc.Q)} кВт при расчётной зимней, за отопительный период около ${n(Rc.year)} кВт·ч${Rc.measures.length ? '; защита от обмерзания: '+Rc.measures.join(', ') : ''}.` });
    for (const w of (H && H.warn)||[]) if (!iss.some(i=>i.text===w.text)) iss.push(w);
    const ducts=Object.keys(V.ducts||{}).length;
    if ((ducts || V.rad) && (plan.sys||{}).rec!==false) iss.push({ level:'info', text:`Рециркуляция тепла: ${ducts ? `на воздуховодах компрессоров — клапаны рециркуляции с электроприводом и термостатом` : ''}${ducts && V.rad ? ', ' : ''}${V.rad ? 'у радиатора ДГУ — заслонка рециркуляции' : ''}: зимой горячий воздух — в помещение (отопление без конвекторов при работе), летом — наружу.` });
    if (V.short.out>0) iss.push({ level:'warn', text:`Не поместилось колпаков выброса на крыше на ${f(V.short.out)} м² (по рамке): крыша занята глушителем и другими колпаками — примите выброс общим коробом или увеличьте контейнер.` });
    if (V.hood) iss.push({ level:V.hood.over ? 'warn' : 'info', text:`Маркизы на приточных жалюзи (снегозащита): ${this.hoodText(V)}; ${this.HOOD_WHAT}.${V.hood.over ? ' Скорость на входе больше нормы и при наибольшем угле открытия — увеличьте приточные жалюзи (шире).' : ''}` });
    if (V.hoodOut) iss.push({ level:V.hoodOut.over ? 'warn' : 'info', text:`Маркизы на жалюзи выброса горячего воздуха (по требованию): ${this.hoodText(V, 'out')}; открытые — горячий воздух уходит вниз, закрытые — защитный щит на проёме.${V.hoodOut.over ? ' Выход под маркизой меньше живого сечения жалюзи — увеличьте жалюзи выброса.' : ''}` });
    if (V.short.in>0) iss.push({ level:'warn', text:`Не поместилось приточных жалюзи на ${f(V.short.in)} м² (по рамке): стена напротив выброса, створки ворот и свободные стены заняты дверями, шкафами и конвекторами — освободите место на стене или примите приток воздуховодом через крышу.` });
    if (V.rad && V.rad.v>StationVent.RAD_V) iss.push({ level:'warn', text:`Через жалюзи радиатора ДГУ скорость воздуха около ${f(V.rad.v)} м/с — больше ${f(StationVent.RAD_V)} м/с: проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление) или увеличьте проём.` });
  }
  static get RAD_V(){ return this.G.radV; }   // скорость выброса воздуха радиатора ДГУ через жалюзи, м/с — выше: проверить по паспорту ДГУ
}

if (typeof module!=='undefined') module.exports={ StationFire, StationLight, StationSockets, StationPower, StationPipe, StationMass, StWalls, VentCalc, StationVent };
