// Системы контейнера станции — расчёты по расстановке (StationLayout.run → plan.fire, plan.light, plan.sockets, plan.power,
// plan.pipe), из них — 3D-вид (StOutfit), ТЗ на сборку (TzOut), вкладка «Компоновка» и характеристики станции: пожарная
// безопасность (StationFire), освещение (StationLight), сервисные розетки (StationSockets), электрические нагрузки и вводной
// автомат (StationPower), диаметр трубопровода (StationPipe).
'use strict';

// ---------------------------------------------------------------- пожарная безопасность
// Огнетушители (ППР в РФ): на видных местах вблизи от выходов, верх — не выше 1,5 м от пола, не за оборудованием; в
// помещении оборудования — два (у выхода и у основного оборудования), в отсеке топливного бака — свой.
// Автоматическое пожаротушение — модули порошкового пожаротушения самосрабатывающие типа «Буран-2,5» на потолке: тепловой
// замок (без питания, около 180 °C) и электрический пуск от прибора ОПС. Число — по методике расчёта модульных установок
// порошкового пожаротушения (СП 485.1311500.2020): по площади N = S / Sн · k1 · k2 и по объёму N = V / Vн · k1 · k2 —
// большее; Sн = 7 м², Vн = 16 м³ при пожаре класса B (масло, топливо) и 18 м³ — класса A, k1 = 1,2 — неравномерность
// распыла, k2 = 1 + 1,33 · Sз / S — затенение оборудованием (Sз — площадь под ним). Модули — равномерно по длине помещения,
// ряд над оборудованием (у помещения шире 3 м — два ряда). Табло: «Выход» — над дверью внутри; при пожаротушении —
// «Порошок! Уходи!» внутри у выхода, снаружи у входа — «Порошок! Не входи!» и «Автоматика отключена». На двери снаружи —
// табличка категории помещения по пожарной опасности и класса зоны по ПУЭ (ППР в РФ, п. 12; категория Д — без таблички).
class StationFire {
  static MOD = { name:'«Буран-2,5»', area:7, vol:{ A:18, B:16 }, k1:1.2, d:250, h:150 };
  static EXT = 'ОП-5(з)';                         // огнетушитель порошковый, 5 кг: пожары классов A, B, C и электрооборудование до 1000 В
  static TANK = { cat:'В1', zone:'П-I' };         // отсек топливного бака ДГУ: дизельное топливо — горючая жидкость
  static ZONE = { dgu:'П-I' };                    // класс зоны по ПУЭ, гл. 7.4: горючие жидкости с температурой вспышки выше 61 °C

  /** расчёт по расстановке: {cat, zone, cls — класс пожара, auto — пожаротушение, ops — сигнализация, ext — огнетушителей,
   *  mods — модулей, rooms: [{id, name, x0, x1, area, vol, shade, k2, nS, nV, n, ext, cat, zone, mods: [{x, y}]}], exit} */
  static calc(plan){
    const sys=plan.sys||{}, r=plan.req||{}, [L, W, H]=plan.int, x0=plan.geo.x0||0, f=plan.fuel, I=plan.items||[], M=this.MOD;
    const dgu=I.some(i=>i.kind==='dgu'), cls=dgu || I.some(i=>i.kind==='compressor') ? 'B' : 'A', cat=String(r.fire||'');
    const rooms=[{ id:'main', name:'помещение оборудования', x0, x1:L, cat, zone:cat && cat!=='Д' && dgu ? this.ZONE.dgu : '', I:I.filter(i=>!i.tank) }];
    if (f) rooms.push({ id:'tank', name:'отсек топливного бака', x0:0, x1:f.x1, cat:this.TANK.cat, zone:this.TANK.zone, I:I.filter(i=>i.tank) });
    for (const q of rooms){
      const S=(q.x1-q.x0)*W/1e6, V=S*H/1000, Sz=q.I.filter(i=>i.mount!=='pipe' && i.mount!=='wall').reduce((s, i)=>s+i.lx*i.ly/1e6, 0), k2=1+1.33*Math.min(1, Sz/Math.max(S, 0.1));
      Object.assign(q, { area:S, vol:V, shade:Sz, k2, nS:S/M.area*M.k1*k2, nV:V/M.vol[cls]*M.k1*k2, ext:q.id==='main' ? 2 : 1 });
      q.n=sys.fire ? Math.max(1, Math.ceil(Math.max(q.nS, q.nV)-1e-6)) : 0;
      q.mods=this.place(q, W); delete q.I; }
    return { cat, zone:rooms[0].zone, cls, auto:!!sys.fire, ops:!!(sys.ops || sys.fire), rooms, exit:this.exit(plan),
      mods:rooms.reduce((s, q)=>s+q.n, 0), ext:rooms.reduce((s, q)=>s+q.ext, 0) };
  }
  /** модули на потолке: равномерно по длине помещения; ряд — над оборудованием (у помещения шире 3 м — два ряда) */
  static place(q, W){
    const n=q.n, two=W>3000 && n>1, out=[];
    for (let k=0; k<n; k++){ const row=two ? k%2 : 0, i=two ? Math.floor(k/2) : k, m=two ? Math.ceil((n-row)/2) : n;
      out.push({ x:Math.round(q.x0+(q.x1-q.x0)*(i+0.5)/m), y:Math.round(two ? W*(row ? 0.75 : 0.25) : W*0.62) }); }
    return out;
  }
  /** выход из помещения оборудования: стена (front — входная дверь в стене прохода, left — ворота в торце), середина проёма
   *  вдоль стены и верх проёма, мм; без прохода внутри (сервисные двери) — null */
  static exit(plan){
    const x0=plan.geo.x0||0, E=StationLayout.ENTRY;
    if (plan.door==='side') return { wall:'front', u:x0+(E[0]+E[1])/2, w:E[1]-E[0], top:StationLayout.DOOR.h };
    if (plan.door==='end' && !x0){ const g=plan.geo, sea=!!g.sea, W=plan.int[1];
      return { wall:'left', u:W/2, w:Math.min(1800, g.ext[1]-400), top:sea ? plan.int[2] : 160+Math.min(2200, g.ext[2]-400)-StationGeo.zFloor(g.type, g.t) }; }
    return null;
  }
  static f1(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  /** число со словом в нужной форме: pl(2, ['светильник', 'светильника', 'светильников']) → «2 светильника» */
  static pl(n, w){ const a=Math.abs(n)%100, b=a%10; return n+' '+(a>10 && a<20 ? w[2] : b===1 ? w[0] : b>1 && b<5 ? w[1] : w[2]); }
  /** строка системы контейнера «Автоматическое пожаротушение»: модули по расчёту */
  static autoText(F){
    if (!F || !F.auto) return '';
    const f=this.f1, R=F.rooms, M=this.MOD;
    return `порошковое — модули самосрабатывающие типа ${M.name} на потолке, ${F.mods} шт. (${R.map(q=>`${q.name} — ${q.n}: S = ${f(q.area)} м², V = ${f(q.vol)} м³, под оборудованием ${f(q.shade)} м²`).join('; ')}; `+
      `по площади N = S / ${M.area} · ${String(M.k1).replace('.', ',')} · k2, по объёму N = V / ${M.vol[F.cls]} · ${String(M.k1).replace('.', ',')} · k2, k2 = 1 + 1,33 · Sз / S — большее, пожар класса ${F.cls}); `+
      'пуск — от теплового замка и от прибора ОПС; табло «Порошок! Уходи!» внутри у выхода, «Порошок! Не входи!» и «Автоматика отключена» — снаружи у входа; по СП 485.1311500.2020';
  }
  /** пункты ТЗ: огнетушители, сигнализация, табло, таблички и знаки */
  static tt(plan){
    const F=plan.fire; if (!F) return [];
    const main=F.rooms[0], tank=F.rooms.find(q=>q.id==='tank'), ex=F.exit;
    const plate=q=>q.cat && q.cat!=='Д' ? `«Категория ${q.cat}${q.zone ? `, класс зоны ${q.zone}` : ''}»` : '';
    return [
      `Огнетушители порошковые ${this.EXT} — ${F.ext} шт.: в помещении оборудования — ${main.ext} (у выхода и у основного оборудования)${tank ? `, в отсеке топливного бака — ${tank.ext} (у двери)` : ''}; на видных местах, не за оборудованием, верх — не выше 1,5 м от пола, над каждым — знак F04 «Огнетушитель» (ППР в РФ, ГОСТ 12.4.026-2015).`,
      F.ops ? `Охранно-пожарная сигнализация (СП 484.1311500.2020): щит ОПС — прибор приёмно-контрольный с резервным питанием${F.auto ? ' и управлением пожаротушением' : ''}, внутри у входа, органы управления на высоте 0,8–1,5 м; извещатели на потолке — дымовые${plan.items.some(i=>i.kind==='dgu') ? ', у ДГУ — тепловые' : ''}; ручной пожарный извещатель и оповещатель — у выхода; датчик открытия двери; сигналы «Пожар», «Неисправность», «Тревога» — на пульт («сухие контакты»).` : '',
      `Световые табло (с аккумулятором, по ГОСТ Р 53325-2012): «Выход» — ${ex ? (ex.wall==='front' ? 'над входной дверью внутри' : 'над воротами внутри') : 'у выхода'}${F.auto ? '; «Порошок! Уходи!» — рядом с ним; снаружи у входа — «Порошок! Не входи!» и «Автоматика отключена»' : ''}; надписи — в две строки, высотой не менее 50 мм.`,
      `Таблички и знаки снаружи: на входной двери — ${plate(main) ? `табличка ${plate(main)} (ППР в РФ, п. 12), ` : ''}знаки W08 «Опасность поражения электрическим током» и P06 «Доступ посторонним запрещён»${tank ? `; на двери отсека бака — ${plate(tank) ? `табличка ${plate(tank)}, ` : ''}W01 «Пожароопасно. Легковоспламеняющиеся вещества», P02 «Запрещается пользоваться открытым огнём и курить»; у заливной горловины — «ДТ» и W01` : ''}. Размер знаков — по расстоянию распознавания (ГОСТ 12.4.026-2015, п. 6.3.4.1), не менее 200 мм; надписи табличек — заглавными буквами не ниже 30 мм, категория — не ниже 80 мм: читаются с 5–10 м.`,
    ].filter(Boolean);
  }
}

// ---------------------------------------------------------------- освещение
// Основное — светодиодные светильники IP65 по 36 Вт (3600 лм) в ряд по оси помещения: число — методом коэффициента
// использования N = E · S · Кз / (Φ · η) по освещённости E = 150 лк на полу (обслуживание оборудования; СП 52.13330.2016),
// Кз = 1,4; η — по индексу помещения i = S / (h · (A + B)) для светлых стен и потолка; не меньше двух и не реже чем через
// 1,5 h. Аварийное — половина светильников (не меньше одного, первый — у выхода) с блоками аварийного питания на 1 ч:
// эвакуационное освещение — не менее 1 лк на полу (СП 52.13330.2016), табло «Выход» — с аккумулятором. Отсек топливного
// бака и тамбур — по круглому светильнику 15 Вт IP65; снаружи над дверями — светодиодные прожекторы 30 Вт IP65 с фотореле.
class StationLight {
  static LUX = 150;
  static KZ = 1.4;
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
    const sys=plan.sys||{}, [L, W, H]=plan.int, x0=plan.geo.x0||0, f=plan.fuel, A=(L-x0)/1000, B=W/1000, h=H/1000, S=A*B;
    const i=S/(h*(A+B)), eta=this.eta(i), M=this.LAMP;
    const n=Math.max(2, Math.ceil(this.LUX*S*this.KZ/(M.lm*eta)-1e-9), Math.ceil(A/(1.5*h)));
    const tb=x0-(f ? f.x1+f.part : 0), small=(f ? 1 : 0)+(tb>0 ? 1 : 0);
    const floods=(plan.door==='side' ? 1 : 0)+(plan.door==='end' && !(plan.geo && plan.geo.sea) ? 1 : 0)+(f ? 1 : 0);
    const on=sys.light!==false, kw=on ? (n*M.w+small*this.SMALL+floods*this.FLOOD+this.EXIT)/1000 : 0;
    return { on, lux:this.LUX, n, em:Math.max(1, Math.ceil(n/2)), eta, i, area:S, E:n*M.lm*eta/(S*this.KZ), small, floods, kw };
  }
  /** строка системы контейнера «Освещение» */
  static text(Lt){
    if (!Lt || !Lt.on) return '';
    const f=StationFire.f1, M=this.LAMP, pl=StationFire.pl;
    return `основное — ${pl(Lt.n, ['светодиодный светильник', 'светодиодных светильника', 'светодиодных светильников'])} IP65 по ${M.w} Вт (${M.lm} лм) в ряд под потолком: около ${Math.round(Lt.E)} лк на полу при норме ${Lt.lux} лк `+
      `(метод коэффициента использования: S = ${f(Lt.area)} м², индекс помещения ${f(Lt.i)}, η = ${String(Math.round(Lt.eta*100)/100).replace('.', ',')}, Кз = ${String(this.KZ).replace('.', ',')}; СП 52.13330.2016); `+
      `аварийное — ${pl(Lt.em, ['светильник', 'светильника', 'светильников'])} из них — с блоком аварийного питания на 1 ч (эвакуационное — не менее 1 лк на полу), табло «Выход» над дверью — с аккумулятором`+
      `${Lt.small ? `; отсек топливного бака${Lt.small>1 ? ' и тамбур' : ''} — по светильнику ${this.SMALL} Вт IP65` : ''}${Lt.floods ? `; снаружи над дверями — светодиодные прожекторы ${this.FLOOD} Вт IP65 с фотореле, ${Lt.floods} шт.` : ''}`;
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
  static U = 400;
  static COS = 0.85;
  static BREAKERS = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];
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
      amp:Math.round(A*10)/10, breaker:this.BREAKERS.find(b=>b>=A*1.25) || null, dgu:!!dgu };
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
  static V = { air:8, out:2, in:1.2, fuel:1.5 };
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

if (typeof module!=='undefined') module.exports={ StationFire, StationLight, StationSockets, StationPower, StationPipe };
