// Компоновка станции в контейнере: расстановка оборудования рядами с проходом обслуживания, двери и ворота, трубопровод,
// подбор размера контейнера. Классы данных и норм (контейнер, оборудование, матрица расстановки, воздух, отопление) —
// ES-модули features/layout/ (index.js кладёт их в globalThis).
//
// Координаты — внутри контейнера, мм: x — вдоль от торца с дверью (0), y — поперёк от стены прохода (0) к задней стене,
// z — от пола вверх.
'use strict';

// ---------------------------------------------------------------- расстановка
// Оборудование на полу стоит рядами вдоль длинных стен лицевой стороной к проходу обслуживания: один ряд у задней стены
// (проход — вдоль стены с дверью) или, если не хватает длины и позволяет ширина, два ряда с проходом посередине. ДГУ — в
// дальнем торце радиатором к жалюзи, дополнительный топливный бак — рядом с ДГУ. Настенные шкафы — на стене прохода
// напротив оборудования (проход перед ними — не уже 600 мм), магистральные фильтры — на трубопроводе (висят на линии после
// осушителя); не нашлось места — своё место в ряду. Проход внутри есть всегда (станций «только с сервисными дверями» нет —
// решение ПНЕВМОТЕХ). Глушитель ДГУ — на крыше прямо над ДГУ. Отступы: сначала «не менее»
// (помещается ли), затем свободное место раздаётся до рекомендуемых; остаток длины — у двери. Блок-контейнер без своего
// размера — по необходимому месту (шаг 100 мм, наименьшая площадь пола); заданный контейнер, в который не помещается, —
// ошибка и подсказка, какой подойдёт; контейнер с большим запасом — подсказка, какой меньший подойдёт.
class StationLayout {
  static VER = 25;          // версия правил и рисунков: изменилась — картинки станций в КП пересобираются (ещё — версия программы в отпечатке)
  static get MAX_L(){ return StationMatrix.fit().maxL; }
  static get PIPE_PAD(){ return StationMatrix.grp('pipe').pad; }    // зазор вокруг фильтра на трубопроводе, мм
  static get AIR_Y(){ return StationMatrix.grp('pipe').airY; }       // линия сжатого воздуха: ось — в 150 мм от задней стены (или посередине между рядами)
  // сервисные двери и ворота: проём шире оборудования на service.addW (от service.min до service.max), створка до
  // service.leaf, высота не ниже двери оператора, от углов внутри — door.pad (матрица расстановки)
  static get DOOR(){ const s=StationMatrix.service(), d=StationMatrix.door(); return { min:s.min, max:s.max, leaf:s.leaf, h:d.h, pad:d.pad }; }
  // входная дверь оператора в стене прохода блок-контейнера: проём от торца (за тамбуром), мм — дверь в свету (матрица:
  // 900–1000 × 2000–2100) и коробка 50 мм с каждой стороны
  static get ENTRY(){ const d=StationMatrix.door(); return [300, 300+d.w+100]; }
  static get DOOR_MIN(){ return StationMatrix.door().w; }   // дверь оператора — не уже 900 мм в свету
  /** начало проёма шириной w на стене длиной W: по месту v, но не ближе pad к краям; стена уже — по середине */
  static inWall(v, w, W, pad){ return Math.round(W-2*pad<w ? (W-w)/2 : Math.max(pad, Math.min(W-pad-w, v))); }
  /** проёмы дверей и ворот (решение ПНЕВМОТЕХ): на одной стене между ними — не меньше door.gap, от края станции
   *  (наружного угла) — не меньше door.edge (матрица расстановки): {gap, eL — от торца по длине внутри, eW — от боковой стены
   *  по ширине внутри}, мм */
  static gaps(geo){ const d=StationMatrix.door(), e=geo && geo.ext, i=geo && geo.int, tL=e && i ? (e[0]-i[0])/2 : 0, tW=e && i ? (e[1]-i[1])/2 : 0;
    return { gap:d.gap, eL:Math.max(this.DOOR.pad, Math.ceil(d.edge-tL)), eW:Math.max(this.DOOR.pad, Math.ceil(d.edge-tW)) }; }
  static get PASS(){ return StationMatrix.move().pass; }   // вынос агрегата через проём и по проходу (на роликах): зазор с каждой стороны, мм
  /** сервисные ворота по размеру агрегата: ширина = сторона + service.addW (+ 2·T стенки), с округлением service.step, от
   *  service.min до service.max; высота = высота + service.addH (+ T), не ниже service.minH (не у стоящего плотно к стене — не
   *  ниже двери оператора) и под потолком на 100 мм */
  static svcW(len, T=0){ const s=StationMatrix.service(), st=s.step||100; return Math.max(s.min, Math.min(s.max, Math.ceil((len+s.addW+(s.wall===0 ? 0 : 2*T))/st)*st)); }
  static svcH(h, T, rear, H){ const s=StationMatrix.service(), st=Math.min(50, s.step||50); return Math.min(H-100, Math.max(rear ? s.minH : StationMatrix.door().h, Math.ceil((h+s.addH+(s.wall===0 ? 0 : T))/st)*st)); }   // сервисные ворота за агрегатом — проём обслуживания: по высоте агрегата, не ниже
  static get CAB_TOP(){ return StationMatrix.cab().top; }       // настенный шкаф: верх — на уровне глаз (рукоятки и панель оператора),
  static get CAB_LOW(){ return StationMatrix.cab().low; }       // низ — не ниже
  static get OUT_GAP(){ return StationMatrix.recv().outGap; }   // ресивер снаружи: от торцевой стены — проход для осмотра и обслуживания, мм
  static get OUT_STEP(){ return StationMatrix.recv().outStep; } // между ресиверами снаружи, мм
  static get PAD(){ return StationMatrix.recv().pad; }          // бетонная площадка под ресивером снаружи: высота над землёй, мм
  static get ROOF_GAP(){ return StationMatrix.muffler().gap; }  // глушитель ДГУ на опорах над крышей, мм
  static get OUTLET(){ return StationMatrix.muffler().outlet; } // вывод выхлопа — горизонтально в сторону радиатора, мм
  static ROAD_H = 4000;                                          // наибольшая высота при перевозке (с платформой), мм
  static CHASSIS_H = 1150;                                       // высота платформы шасси, мм

  static solve(input){ return new StationLayout(input).run(); }
  /** положение ворот в торце одной фразой: по оси торца, или смещены — на сколько и почему (вручную — с причиной менеджера) */
  static gateAxis(q){ if (!q || q.sea) return ''; if (q.full) return 'Ворота во весь торец — по оси торца.';
    return q.off ? `Ворота смещены от оси торца на ${this.n(Math.abs(q.off))} мм${q.offWhy ? ` — ${q.manual ? 'причина: ' : ''}${q.offWhy.replace(/^смещены на \S+ мм от оси торца /, '')}` : ' — причина не указана'}.` : 'Ворота — по оси торца.'; }

  /** отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить */
  static hash(input){
    const c=input.cont||{}, pick=a=>a ? {cat:a.cat, size:a.size, mass:a.mass, model:a.model, maker:a.maker, orient:a.orient, kw:a.kw, volume:a.volume, color:a.color, flow:a.flow, pressure:a.pressure, stage:a.stage, dryer:a.dryer, vsd:a.vsd, dewPoint:a.dewPoint, receiver:a.receiver} : null;
    // версия программы — в отпечатке: новая программа всегда пересобирает картинки, даже при своих сохранённых правилах
    const s=JSON.stringify([this.VER, typeof APP_VERSION!=='undefined' ? APP_VERSION : '', typeof StationRules!=='undefined' && StationRules.ok() ? StationRules.version()+'.'+StationRules.stamp() : '', StationClear.aisle(), [c.ctype, c.size, c.sizeAuto, c.lenFix||null, c.ins, StationPaint.stamp(c), c.mods ? JSON.stringify(StationMods.rect(c.mods.cells)) : null, c.sys||null, c.climate||'', c.roof||'', StationGeo.floor(c)], input.chassisH||null, input.recv||'', !!input.recvOut, input.req||null,
      (input.parts||[]).filter(p=>p && p.role!=='container').map(p=>[p.name, p.qty, p.role||'', p.pipeMat||'', p.dn||'', p.mount||'', pick(p.attrs), StationEquip.tint(p), StationEquip.tones(p), (p.rows||[]).filter(r=>r && /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL|установк|исполнен|производительн|пропускн|давлени|ступен|очистк|фильтр|осушител|регулирован|точк\S* росы|воздух|теплов|охлажд/i.test(String(r.k||'')+' '+String(r.v||''))).map(r=>[r.k, r.v]), StationEquip.pic(p)])]);
    return StationRules.fnv(s);
  }

  constructor(input){
    this.in=input||{}; this.cont=this.in.cont||null;
    this.eq=StationEquip.list(this.in.parts||[], { recv:this.in.recv, recvOut:this.in.recvOut });
    this.aisle0=StationClear.aisle(); this.aisle=this.aisle0; this.mode={};
    // зазор на коммуникации у стен (по длине и ширине — с обеих сторон) и под потолком: полезные размеры компрессорной
    // = внутренние − 2·G (по высоте — G под потолком: у пола коммуникаций нет); ДГУ и насосные — по своим нормам
    this.comp=this.eq.some(e=>e.kind==='compressor') && !this.eq.some(e=>e.kind==='dgu');
    this.G=this.comp ? StationMatrix.gap() : 0;
    this.dguSt=this.eq.some(e=>e.kind==='dgu' && e.place) && !this.eq.some(e=>e.place && (e.kind==='compressor' || e.kind==='pump'));   // ДГУ-станция — своя расстановка (rowD)
  }

  // ---- исключения, чтобы станция прошла по габариту перевозки (решение ПНЕВМОТЕХ, компрессорная): без продольного прохода
  // (компрессор у торца); проход оператора «в крайнем случае» — не меньше 600 мм (norm.aisle_tight; уже 600 мм — нельзя);
  // без сквозного прохода — агрегат поперёк станции и вторая дверь оператора (доступ ко всему
  // оборудованию — с разных сторон). Сначала — как обычно; исключения — только если иначе не помещается (негабарит — после них)
  static get TIGHT(){ return Math.max(600, StationRules.opt('norm.aisle_tight') || 600); }
  /** режимы по порядку: обычный, без продольного прохода (компрессор у торца — доступ через ворота), проход «в крайнем
   *  случае», без сквозного прохода, оба */
  modes(){ if (!this.comp) return [{}]; const M=StationMatrix.modes();
    return [{}, ...(M.ends ? [{ ends:true }] : []), ...(M.tight ? [{ tight:true }] : []), ...(M.cross ? [{ cross:true }] : []), ...(M.cross && M.tight ? [{ cross:true, tight:true }] : [])]; }
  /** выполнить fn в режиме m (проход «в крайнем случае»; агрегат поперёк; без продольного прохода) */
  withMode(m, fn){
    const a=this.aisle, md=this.mode; this.mode=m||{};
    this.aisle=this.mode.tight ? [this.aisle0[0], Math.min(this.aisle0[1], StationLayout.TIGHT)] : this.aisle0;
    try{ return fn(); } finally{ this.aisle=a; this.mode=md; }
  }
  /** замечания режима-исключения: что сделано и почему (согласовать с заказчиком) */
  modeNotes(r, m, geo){
    const n=StationLayout.n, why=geo.auto || geo.road ? `станция прошла по габариту перевозки без спецразрешения (ширина до ${n(StationGeo.ROAD_W)} мм)` : 'оборудование поместилось в заданный контейнер';
    if (m.tight){ const w=r.aisle && r.aisle.w; r.aisleRule=[this.aisle0[0], Math.min(this.aisle0[1], StationLayout.TIGHT)];
      if (w<this.aisle0[1]) r.issues.push({ level:'warn', text:`Проход оператора сужен до ${n(w)} мм (норма — не менее ${n(this.aisle0[1])} мм, ПУЭ, п. 4.1.23): исключение, чтобы ${why}. Согласуйте с заказчиком.` }); }
    if (m.ends && r.ends && r.ends.n>1){ const E=r.ends; r.issues.push({ level:'info', text:`Без продольного прохода: компрессоры поз. ${E.all.join(', ')} (${E.n} шт.) — рядом в ряд от торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце и промежутки не меньше ${StationLayout.n(StationMatrix.modes().next)} мм между компрессорами и за последним; дверь оператора — между последним компрессором и ${E.next ? `поз. ${E.next}` : 'остальным оборудованием'}${E.recv.length ? `; ресиверы поз. ${E.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там` : ''}. Так ${why}.` }); }
    else if (m.ends && r.ends){ const E=r.ends; r.issues.push({ level:'info', text:`Без продольного прохода: поз. ${E.pos} (компрессор) — у торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; дверь оператора — между компрессором и ${E.next ? `поз. ${E.next}` : 'остальным оборудованием'}${E.recv.length ? `; ресиверы поз. ${E.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там` : ''}. Так ${why}.` }); }
    if (m.cross && r.cross) r.issues.push({ level:'warn', text:`Сквозного прохода нет: поз. ${r.cross.pos} стоит поперёк станции лицом к входу — к нему спереди и к оборудованию до него подходят от двери оператора, к нему сзади и к оборудованию за ним — через вторую дверь оператора. Доступ ко всему оборудованию остаётся с разных сторон. Исключение, чтобы ${why}.` });
    r.mode=m;
  }

  run(){
    const placed=this.eq.filter(e=>e.place), extra=this.eq.filter(e=>!e.place);
    const base={ items:[], extra, chassis:extra.some(e=>e.kind==='chassis'), muffler:extra.some(e=>e.kind==='muffler'), aisleRule:this.aisle, issues:[] };
    if (!this.cont) return Object.assign(base, { level:'none', text:'Выберите контейнер в составе станции.' });
    if (!placed.length) return Object.assign(base, { level:'none', text:'Добавьте в состав оборудование — компрессор, насос, ДГУ и т. п.' });
    let units=this.units(placed);
    const g0=StationGeo.of(this.cont), in0=g0.int || StationGeo.inner(g0.type, [10000, StationGeo.ROAD_W, 2600], g0.t), Wi=in0[1];
    // размер по оборудованию — бак по ширине обычного блок-контейнера (2 300 мм): станция шире ради бака не делается
    const We=g0.int ? g0.ext[1] : Math.min(StationGeo.ROAD_W, 2300), Wt=g0.int ? Wi : StationGeo.inner(g0.type, [10000, We, 2600], g0.t)[1];
    this.tank=this.tankRoom(units, Wt, in0[2], !!g0.sea, Wt-2*StationLayout.gaps({ ext:[0, We, 0], int:[0, Wt, 0] }).eW);        // ДГУ с дополнительным баком — бак в отдельном отсеке у ближнего торца
    if (this.tank) units=units.filter(e=>e.kind!=='tank');
    const geo=this.geoOf(this.cont); this.T=geo.t||0;
    let plan=geo.auto ? this.autoSize(units, geo) : this.in._mode ? this.fit(units, geo, [this.in._mode]) : this.fit(units, geo);   // удлинение (grow) — в том же режиме
    if (plan.level==='error' && !geo.auto) plan.suggest=this.suggest(units, geo);   // какой контейнер нужен (с проходом)
    else if (plan.level!=='error' && !geo.auto && !this.in._grow) this.excess(units, geo, plan);
    if (plan.level!=='error' && plan.items && plan.items.length){ plan.roof=this.roof(plan); plan.exhausts=this.exhausts(plan); this.outlet(plan); plan.piping=this.route(plan); plan.outside=this.outside(plan, extra.some(e=>e.kind==='chassis')); this.modsNotes(plan); }
    // «не помещается» точно, если не помещается и без оборудования с условными габаритами; иначе — лишь оценка (assumed)
    if (plan.level==='error' && units.some(e=>!e.known)){ const k=units.filter(e=>e.known);
      plan.assumed=!k.length || (geo.auto ? this.autoSize(k, geo) : this.fit(k, geo)).level!=='error'; }
    plan=Object.assign(base, plan, { issues:plan.issues||[] }, this.colors());
    const air=AirChain.check(this.eq, this.in.air, this.in.req && this.in.req.recvIn);
    if (air && plan.level!=='error'){ plan.air=air; plan.issues.push(...air.issues); }
    plan.vessels=PressureVessel.list(this.eq, Math.max(0, ...this.eq.filter(e=>e.kind==='compressor' && e.air).map(e=>e.air.bar||0)));
    plan.req=this.in.req||null; plan.climate=(this.cont && this.cont.climate)||'';
    if (plan.geo && plan.geo.ext) plan.geo.rise=StationGeo.rise(plan.geo.roof, plan.geo.ext[1]);
    if (plan.level!=='error' && plan.geo && plan.geo.ext && plan.int){ plan.heat=StationHeat.calc(plan); plan.fire=StationFire.calc(plan);
      plan.light=StationLight.calc(plan); plan.sockets=StationSockets.calc(plan); plan.power=StationPower.calc(plan); plan.pipe=StationPipe.calc(plan); plan.mass=StationMass.calc(plan); plan.issues.push(...StationMass.issues(plan.mass));
      plan.vent=StationVent.calc(plan);   // жалюзи: размеры по расходу воздуха, места — мимо дверей, шкафов, конвекторов и знаков
      plan.tidy=StationTidy.score(plan, plan.geo);   // аккуратность компоновки (оценка и пояснения)
      if (plan.fire.low) plan.issues.push({ level:'info', text:`Высота помещения ${StationLayout.n(plan.int[2])} мм — ниже паспортной высоты установки модулей «Буран-2,5» (2,5–3,5 м): зона тушения — по диаграмме распыла изготовителя при этой высоте (согласовать с проектировщиком пожаротушения).` });
      const pq=plan.pipe; if (pq && pq.small) plan.issues.push({ level:'warn', text:`Трубопровод DN ${pq.set} меньше расчётного DN ${pq.dn} (${pq.why}): скорость больше ${String(pq.lines[0].v).replace('.', ',')} м/с — потери давления и шум. Укажите DN ${pq.dn} в составе станции.` }); }
    if (plan.level!=='error') StationNorms.check(plan, this.eq);
    this.notes(plan);
    if (plan.level==='ok' && plan.issues.some(i=>i.level==='warn')) plan.level='warn';
    return this.grow(plan, geo);
  }
  /** плотность компоновки подобранного размера (названия — как у готовых наборов правил): просторно — рекомендуемые
   *  отступы и проход; плотно — допустимые; максимально плотно — исключения (без продольного прохода, проход 600 мм,
   *  агрегат поперёк) */
  static density(lw, m, r, wide){
    const md={ ...(m||{}), ...(r.mode||{}) }, ex=[md.ends && 'без продольного прохода', md.tight && 'проход в крайнем случае', md.cross && 'агрегат поперёк'].filter(Boolean);
    const roomy=lw===0 || !(r.issues||[]).some(i=>/рекоменд/i.test(i.text));   // всё рекомендуемое вышло и на уровне «плотно» (длина задана с запасом)
    const d=ex.length ? { id:'max', title:'Максимально плотно', text:ex.join(', ') } : roomy ? { id:'roomy', title:'Просторно', text:'рекомендуемые отступы и проход' } : { id:'dense', title:'Плотно', text:'допустимые отступы и проход' };
    if (wide) d.text+=', негабарит по ширине'; return d;
  }
  /** размер подобран плотно (решение ПНЕВМОТЕХ): отступы и проход меньше рекомендуемых, но не меньше допустимых — так
   *  задумано, а не недочёт: сведения, а не предупреждения */
  static soft(r){
    if (!StationMatrix.fit().dense) return r;
    for (const i of r.issues||[]) if (i.level==='warn' && !i.wide && /рекоменд/.test(i.text) && !/исключение/i.test(i.text)) i.level='info';
    if (r.level==='warn' && !r.issues.some(i=>i.level==='warn')) r.level='ok';
    return r;
  }
  /** размер «по оборудованию»: жалюзи притока или выброса не поместились на стенах — контейнер длиннее (поиск шагами по
   *  500 мм, затем наименьшая длина с шагом 100 мм; до +3 000 мм и не длиннее наибольшего); не вышло — как есть (с замечанием) */
  grow(plan, geo){
    const hs=p=>!!(p.heat && p.heat.short), vs=p=>!!(p.vent && (p.vent.short.in>0 || p.vent.short.out>0));
    if (!geo.auto || geo.fixL || this.in._grow || plan.level==='error' || !plan.vent || !(vs(plan) || hs(plan)) || !plan.geo || !plan.geo.ext) return plan;
    // жалюзи не встают — длиннее до 3 000 мм; конвекторам нет места — длиннее не больше чем на 500 мм (иначе — замечание:
    // мощность другим способом; плотная компоновка важнее)
    // из модулей — длиннее каждый модуль (размер в составе — модуля)
    const [L0, W, H]=plan.geo.ext, MD=plan.geo.mods, ka=MD ? MD.a : 1, S=StationGeo.STEP*ka, V=vs(plan), bad=p=>V ? vs(p) : hs(p), MAXL=StationLayout.MAX_L*ka;
    const at=Lx=>{ const p=new StationLayout({ ...this.in, _grow:true, _mode:plan.mode||{}, cont:{ ...this.cont, size:MD ? `${Lx/ka} × ${W/MD.b} × ${H}` : `${Lx} × ${W} × ${H}`, sizeAuto:false } }).run();
      return p.level==='error' || !p.vent || bad(p) ? null : p; };
    const ok=(p, Lx)=>{ p.geo.auto=true; p.picked=true; p.density=plan.density; StationLayout.soft(p);
      const wd=plan.issues.filter(i=>i.wide); if (wd.length){ p.issues.unshift(...wd); if (p.level==='ok') p.level='warn'; }   // негабарит — и в удлинённом
      p.issues.push({ level:'info', text:`Длина контейнера ${StationLayout.n(Lx)} мм (по оборудованию — ${StationLayout.n(L0)} мм): так помещаются ${V ? 'жалюзи притока и выброса' : 'конвекторы отопления'}.` });
      return p; };
    const F=StationMatrix.fit();   // насколько можно удлинить: жалюзи — fit.growVent (3 000 мм), конвекторы — fit.growHeat (500 мм)
    if (!V){ for (let Lx=L0+S; Lx<=Math.min(MAXL, L0+F.growHeat*ka); Lx+=S){ const p=at(Lx); if (p) return ok(p, Lx); } return plan; }
    for (let Lx=L0+5*S; Lx<=Math.min(MAXL, L0+F.growVent*ka); Lx+=5*S){
      let p=at(Lx); if (!p) continue;
      for (let L2=Lx-4*S; L2<Lx; L2+=S){ const q=L2>L0 ? at(L2) : null; if (q){ p=q; Lx=L2; break; } }   // наименьшая длина — с шагом 100 мм
      return ok(p, Lx);
    }
    return plan;
  }


  /** единицы оборудования в порядке расстановки от двери: шкафы, остальное по составу (сжатый воздух — по ходу воздуха:
   *  компрессоры, ресивер, фильтры, осушитель…), топливный бак, ДГУ — в дальнем торце */
  units(placed){
    const u=[]; for (const e of placed) for (let k=0; k<e.qty; k++) u.push(Object.assign({}, e, { unit:k, c:this.clear(e), air:AirChain.unit(e.air, k) }));
    const dgu=placed.some(e=>e.kind==='dgu'), air=placed.some(e=>e.kind==='compressor');
    const rank=e=>e.kind==='cabinet' ? 0 : e.kind==='dgu' ? 2 : e.kind==='tank' && dgu ? 1.5 : air && e.air && e.air.stage!=null ? 1+e.air.stage/100 : air ? 1.8 : 1;
    return u.map((e, i)=>[e, i]).sort((a, b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(([e])=>e);
  }
  /** отступы агрегата: нормы вида (StationClear) и матрица расстановки — от стены за ним max(база, коэф · D); «плотно» —
   *  только виду, который обслуживают сзади через сервисные ворота (компрессор, …); у остальных — не меньше нормы вида */
  clear(e){
    const c=StationClear.of(e.kind, e), w=StationMatrix.wall(e);
    if (e.kind==='dgu'){ const R=StationMatrix.grp('dgu').rad; return { ...c, far:[R, R] }; }   // радиатор — вплотную к жалюзи (решение владельца 19.10)
    if (!w || e.kind==='cabinet' || e.kind==='tank') return c;
    return { ...c, back:[w[0], StationLayout.gated(e.kind) ? w[1] : Math.max(w[1], Math.min(w[0], c.back[1]))] };
  }
  /** вид обслуживают сзади (матрица: сторона «З») и ему допускаются сервисные ворота за ним (ДГУ — своя дверь-жалюзи) */
  static gated(kind){ return kind!=='dgu' && kind!=='cabinet' && kind!=='tank' && !StationMatrix.noDoor(kind) && StationMatrix.sides(kind).B; }
  // ДГУ с дополнительным топливным баком: бак — в отдельном отсеке у ближнего торца. Отсек отделён противопожарной
  // перегородкой 1-го типа (EI 45, без проёмов; топливопровод — через гильзу с уплотнением), вход — ворота в торце (tank.gates)
  // или своя дверь снаружи, заливная горловина — в нише стены с лючком заподлицо, дыхательный клапан с огнепреградителем — над крышей, бак — в поддоне
  // на полный объём, в отсеке — естественная вентиляция (жалюзи внизу и вверху)
  static get TANK(){ return StationMatrix.tank(); }
  /** отсек бака: {units — [{e, lx — вдоль контейнера, ly — поперёк}], room — длина отсека внутри, len — с перегородкой};
   *  бак — поперёк, если перед ним остаётся проход (отсек короче); нет ДГУ или бака — null. Wi — ширина внутри */
  tankRoom(units, Wi, Hi, sea, gMax=Wi){
    const T=units.filter(e=>e.kind==='tank'); if (!T.length || !units.some(e=>e.kind==='dgu')) return null;
    const C=StationLayout.TANK, open=C.gates && !sea;
    // бак без своих габаритов — по объёму под этот отсек: выше — почти под потолок, глубже — с воротами в торце на всю ширину
    // контейнера (решение владельца 19.10; проход перед баком не нужен — к нему через ворота), иначе — не уже прохода перед ним
    // с воротами — не шире их наибольшего проёма (бак меняют через ворота: зазор move.pass с каждой стороны)
    const deep=open ? Math.min(Wi-2*C.back, gMax-2*StationLayout.PASS) : Wi-C.back-C.aisle;
    for (const e of T) if (!e.known){ const d=TankSize.of(e.vol||1000, { h:(Hi||TankSize.H)-C.top, w:deep }); e.l=d.l; e.w=d.w; e.h=d.h; }
    const U=T.map(e=>{ const a=Math.max(e.l, e.w), b=Math.min(e.l, e.w); return a<=deep ? { e, lx:b, ly:a } : { e, lx:a, ly:b }; });
    const body=U.reduce((s, u)=>s+u.lx, 0)+C.gap*(U.length-1), room=Math.max(body+2*C.pad, C.door+2*C.pad);
    return { units:U, room, len:room+C.part };
  }
  /** геометрия контейнера: оборудование — после отсека бака (и тамбура «Севера») */
  geoOf(c){ const g=StationGeo.of(c); if (this.tank) g.x0=(g.x0||0)+this.tank.len; return g; }
  /** баки — в отсеке вдоль задней стены (в поддоне); дверь отсека — в стене прохода посередине отсека; горловина — снаружи
   *  в торце напротив бака (у морского контейнера в торце — его двери: горловина в задней стене за баком) */
  tankPlace(r, geo){
    const [, W, H]=geo.int, C=StationLayout.TANK, t=this.tank, n=StationLayout.n; let x=C.pad;
    for (const { e, lx, ly } of t.units){ const y=Math.max(0, W-C.back-ly);
      r.items.push(this.unitItem(e, { x, y, z:0, lx, ly, rot:lx<e.l, mount:'floor', face:-1, row:0, back:C.back, aisle:y, tank:true })); x+=lx+C.gap; }
    const T=r.items.filter(i=>i.tank), d0=Math.round((t.room-C.door)/2), f=T[0];
    r.fuel={ x1:t.room, part:C.part, door:{ x0:d0, x1:d0+C.door }, fill:geo.sea ? { wall:'back', x:Math.round(f.x+f.lx/2), z:C.fill } : { wall:'left', y:Math.round(f.y+f.ly/2), z:C.fill } };
    // вход в отсек — двустворчатые ворота в торце (tank.gates, решение владельца 19.10: монтаж и замена бака), у морского — его
    // двери; горловина — в нише заподлицо с лючком: в торце рядом с воротами, не встала — в стене с дверью оператора
    if (C.gates && !geo.sea){ const Q=StationLayout.gaps(geo), Ts=T.reduce((a, i)=>[Math.min(a[0], i.y), Math.max(a[1], i.y+i.ly)], [W, 0]);
      const w=Math.min(W-2*Q.eW, StationLayout.dguDoorW(Ts[1]-Ts[0])), y0=Math.round(Math.max(Q.eW, Math.min(W-Q.eW-w, (Ts[0]+Ts[1])/2-w/2))), h=Math.min(H-100, Math.max(StationLayout.DOOR.h, Math.max(...T.map(i=>i.h))+150));
      r.fuel.door=null; r.fuel.gate={ wall:'left', y0, y1:y0+w, w, h, leaves:2 };
      const fy=y0-Q.gap-150; r.fuel.fill=fy-150>=Q.eW ? { wall:'left', y:Math.round(fy), z:C.fill } : { wall:'front', x:Math.round(t.room/2), z:C.fill }; }
    r.fuel.fill.niche=true;   // горловина утоплена в стену, лючок заподлицо — габарит не меняется
    const iss=r.issues=r.issues||[], aisle=Math.min(...T.map(i=>i.y));
    if (aisle<C.aisle && !r.fuel.gate) iss.push({ level:'warn', text:`Отсек топливного бака: проход перед баком ${n(aisle)} мм — меньше ${n(C.aisle)} мм.` });
    for (const i of T) if (i.h+200>H){ r.bad=true; iss.push({ level:'error', text:`Топливный бак поз. ${i.pos} не проходит по высоте отсека: ${n(i.h)} мм, внутри ${n(H)} мм.` }); }
  }
  /** в два ряда — в задний ряд: ДГУ; аппараты цепочки сжатого воздуха (если есть компрессоры) — подряд по ходу воздуха;
   *  ресиверы — в любом ряду (решение ПНЕВМОТЕХ: ресиверы можно ставить в два ряда) */
  backRow(e, units){ return e.kind==='dgu' || (units.some(u=>u.kind==='compressor') && ((StationLayout.series(e) && e.kind!=='receiver') || (e.slot && e.kind==='filter'))); }
  /** аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу) */
  static series(e){ return LayoutPipes.series(e); }
  static key(e){ return e.id+'#'+e.unit; }
  /** осушитель рисуется двумя колоннами: адсорбционный или генератор (вид — из цепочки сжатого воздуха: категория каталога,
   *  название, характеристики), а не по одному названию */
  static twinDryer(it){ const t=it && it.air && it.air.type; return t ? t==='ads' || t==='gen' : /адсорбц|десикант|adsorp|desicc/i.test(String((it && it.name)||'')); }

  /** перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё) */
  front(e){
    return [this.aisle[0], e.c.front!=null ? Math.min(this.aisle[1], e.c.front) : this.aisle[1]];
  }

  // ---- высота: оборудование + место над ним; настенный шкаф — от 300 мм над полом; фильтры висят на трубе
  heights(units, H){
    const iss=[], n=StationLayout.n; let bad=false;
    for (const e of units){ if (e.unit || e.pipe) continue;
      if (e.mount==='wall'){ if (e.h+StationLayout.CAB_LOW>H-50){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не помещается на стене по высоте: ${n(e.h)} мм и не ниже ${n(StationLayout.CAB_LOW)} мм от пола, а высота внутри — ${n(H)} мм.` }); } continue; }
      const top=e.c.top, room=H-e.h;
      if (room<top[1]){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не проходит по высоте: ${n(e.h)} мм и не менее ${n(top[1])} мм над ним, а высота внутри — ${n(H)} мм.${e.kind==='receiver' ? ` Замените на горизонтальный ресивер или несколько меньших${e.air && e.air.vol>0 ? ` (например, 2 × ${n(Math.ceil(e.air.vol/2/100)*100)} л)` : ''}, либо ресивер — снаружи (ФНП ОРПД, п. 65).` : ''}` }); }
      else if (room<top[0]){
        if (e.kind==='compressor') iss.push({ level:'info', text:`Над компрессором (поз. ${e.pos}) ${n(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).` });
        else iss.push({ level:'warn', text:`Над поз. ${e.pos} «${e.short}» ${n(room)} мм до потолка — рекомендуется ${n(top[0])} мм.` }); }
    }
    return { bad, iss };
  }

  // ---- один ряд: у задней стены лицом к проходу
  row1(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false }));
    const depth=o=>o.rot ? o.e.l : o.e.w, lenX=o=>o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && StationLayout.turnable(o.e);   // шкаф — дверцами к проходу
    const pw=o=>Math.min(o.e.c.back[1], StationMatrix.recv().pairWall);   // пара у торца — от стен до recv.pairWall
    const need=o=>depth(o)+(o.end ? 2*pw(o) : o.e.c.back[1]+this.front(o.e)[1]), wide=o=>need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:Math.max(...narrow.map(need)) };
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (this.recv2) this.endPairs(U, wide, ()=>false);   // подбор размера: вариант с ресиверами в два ряда в конце ряда
    if (len(1)>Lu){   // не хватает длины — поворачиваем поперёк то, что позволяет ширина (сначала дающее больше длины): сначала —
      // только если и после поворота сзади остаётся рекомендуемый отступ (иначе агрегат «плотно к стене» — сервисные ворота), затем любые
      const roomy=o=>depth(o)+o.e.c.back[0]+this.front(o.e)[1]<=W;
      for (const ok of [roomy, wide]){ if (len(1)<=Lu) break; StationLayout.turn(U.filter(o=>canRot(o) && !o.rot), ok, ()=>len(1)<=Lu); } }
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0), needLc:len(2) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }
  /** агрегат «пара ресиверов один за другим» (передний a, задний b, промежуток gap между ними): глубина — оба и промежуток */
  static pairUnit(a, b, gap){ return Object.assign({}, a, { l:Math.max(a.l, b.l), w:a.w+gap+b.w, h:Math.max(a.h, b.h), pairD:Math.max(a.w, b.w) }); }
  /** можно повернуть боком (поперёк): разрешено матрицей, короб и заметно длиннее, чем глубже */
  static turnable(e){ return StationMatrix.rot(e.kind) && e.shape==='box' && e.l>e.w+50; }
  /** не хватает длины — поворачиваем боком (сначала дающее больше длины), пока ok(o) после поворота и ряд не уложится (fits) */
  static turn(list, ok, fits){
    for (const o of list.sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!ok(o)){ o.rot=false; continue; } if (fits()) break; }
  }
  /** не хватает длины (после поворотов): крайний случай — ресиверы и фильтры вплотную в линию (только в заданном
   *  контейнере: подобранный по размеру просто длиннее), затем ресиверы парой — один за другим поперёк. Уровень промежутков
   *  «не менее»: 1 или 2 (вплотную) */
  squeeze(U, len, Lu, wide, noRotate){
    if (len(1)<=Lu) return 1;
    // сначала ресиверы в два ряда с обычными промежутками, «вплотную» — последним приёмом (решения владельца 12.10, 14.10, 19.10)
    const done1=()=>len(1)<=Lu;
    if (!noRotate) this.pairs(U, wide, done1);   // ресиверы — парой (один за другим)
    if (!noRotate && !done1()) this.endPairs(U, wide, done1);   // ресиверы в конце ряда — парами поперёк, во всю ширину
    if (len(1)<=Lu) return 1;
    if (this.closeOk && len(2)<=Lu) return 2;
    // самый крайний случай — без прохода к боку агрегата у торца (замечание в «Доступ к оборудованию»)
    return len(1)<=Lu || !this.closeOk ? 1 : len(2)<=Lu ? 2 : 3;
  }

  // ---- ресиверы в два ряда: соседние — парой, один за другим (задний — ближе к стене); осмотр заднего — сбоку, через
  // промежутки между ресиверами; пара — как один агрегат в ряду (глубина — два ресивера и промежуток между ними)
  pairs(U, wide, done){
    for (let k=0; k<U.length-1 && !done(); k++){ const a=U[k], b=U[k+1];
      if (a.pair || b.pair || a.rot || b.rot || a.e.kind!=='receiver' || b.e.kind!=='receiver' || a.e.slot || b.e.slot) continue;
      const gap=Math.max(a.e.c.side[1], b.e.c.side[1]), o={ e:StationLayout.pairUnit(a.e, b.e, gap), rot:false, pair:[a.e, b.e], gap }; if (!wide(o)) continue;
      U.splice(k, 2, o); }
  }
  /** ресиверы в два ряда в конце ряда — поперёк контейнера, чтобы станция была короче (решение ПНЕВМОТЕХ): хвост
   *  цепочки из ресиверов — парами один за другим во всю ширину (передний — не ближе 300 мм к стене прохода); проход доходит
   *  до пары сбоку, осмотр заднего — сбоку через промежутки; друг к другу вплотную — только в заданном контейнере */
  endPairs(U, wide, done){
    const solo=o=>!o.pair && !o.rot && o.e.kind==='receiver' && !o.e.slot && !o.e.cross;
    let k=U.length; while (k>0 && solo(U[k-1])) k--;
    for (let j=U.length-2; j>=k && !done(); j-=2){ const a=U[j], b=U[j+1];
      let o=null; for (const g of this.closeOk ? [Math.max(a.e.c.side[1], b.e.c.side[1]), 0] : [Math.max(a.e.c.side[1], b.e.c.side[1])]){
        const t={ e:StationLayout.pairUnit(a.e, b.e, g), rot:false, pair:[a.e, b.e], gap:g, end:true }; if (wide(t)){ o=t; break; } }
      if (!o) break; U.splice(j, 2, o); }
  }
  /** пара ресиверов → два места: передний — у прохода, задний — за ним */
  unpair(it, geo){
    const [f, b]=it.o.pair, g=it.o.gap, mk=(e, y, d, back, aisle)=>this.item({ o:{ e, rot:false }, ri:it.ri, x:it.x+Math.round((it.lx-e.l)/2), lx:e.l, d, y, face:it.face, back, aisle }, geo);
    const E=it.o.end ? { pairEnd:true } : {};
    return [Object.assign(mk(f, it.y, f.w, it.back+g+b.w, it.aisle), { pair:true }, E), Object.assign(mk(b, it.y+f.w+g, b.w, it.back, it.aisle+f.w+g), { pair:true }, E)];
  }

  // ---- два ряда у длинных стен, проход посередине
  row2(units, Lu, W, noRotate){
    const A=[], B=[], dep=o=>o.rot ? o.e.l : o.e.w, lx=o=>o.rot ? o.e.w : o.e.l, lenOf=(R, lvl)=>this.chain(R.map(o=>o.e), lvl).sum+R.reduce((s, o)=>s+lx(o), 0);
    let rr=null;   // ресиверы — подряд в одном ряду (друг за другом)
    for (const e of units){ const o={ e, rot:false };
      if (this.backRow(e, units)) B.push(o); else if (e.kind==='receiver' && rr) rr.push(o); else { const R=lenOf(A, 1)<=lenOf(B, 1) ? A : B; R.push(o); if (e.kind==='receiver') rr=R; } }
    if (!A.length || !B.length) return { ok:false, why:'rows' };
    const dmax=R=>Math.max(...R.map(o=>dep(o)+o.e.c.back[1])), aMin=Math.max(...[...A, ...B].map(o=>this.front(o.e)[1])), fits=()=>W-dmax(A)-dmax(B)>=aMin;
    if (!fits()) return { ok:false, why:'width2' };
    let lv=1; const L=()=>Math.max(lenOf(A, lv), lenOf(B, lv)), L0=Math.max(lenOf(A, 0), lenOf(B, 0));
    if (L()>Lu && !noRotate)   // не хватает длины — боком (поперёк) то, что позволяет ширина прохода между рядами
      StationLayout.turn([...A, ...B].filter(o=>StationLayout.turnable(o.e)), fits, ()=>L()<=Lu);
    if (L()>Lu && this.closeOk){ lv=2; if (L()>Lu){ lv=3; if (L()>Lu) lv=1; } }   // крайний случай — ресиверы и фильтры вплотную, затем без прохода у торца
    if (L()>Lu) return { ok:false, why:'length2', needL:L(), needL0:L0, needLc:Math.max(lenOf(A, 2), lenOf(B, 2)) };
    return this.place([B, A], Lu, W, dep, lx, lv);
  }

  // ---- без сквозного прохода (исключение, компрессорная): один ряд у задней стены, а агрегат, который с проходом не встаёт
  // по ширине, — поперёк станции лицом к входу (по середине ширины). Перед ним — проход обслуживания от двери оператора, за
  // ним — отступ сзади и вторая часть станции со своей дверью оператора: к нему сзади и к оборудованию за ним
  rowX(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false })), depth=o=>o.e.cross ? o.e.l : o.rot ? o.e.l : o.e.w, lenX=o=>o.e.cross ? o.e.w : o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && StationLayout.turnable(o.e);
    const need=o=>depth(o)+o.e.c.back[1]+this.front(o.e)[1], wide=o=>o.e.cross || need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length!==1) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:narrow.length ? Math.max(...narrow.map(need)) : W+1 };
    const X=narrow[0]; if (/^(dgu|cabinet|pump)$/.test(X.e.kind) || X.e.slot || X.e.l>W) return { ok:false, why:'width', bad:[X.e], needW:need(X) };
    X.rot=false; X.e=Object.assign({}, X.e, { cross:true });
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (len(1)>Lu) StationLayout.turn(U.filter(o=>!o.e.cross && canRot(o)), wide, ()=>len(1)<=Lu);
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0), needLc:len(2) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }

  // ---- без продольного прохода (исключение, компрессорная; решение ПНЕВМОТЕХ): компрессор — у торца по середине
  // ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; за ним —
  // дверь оператора (между компрессором и осушителем), дальше — осушители и прочее с проходом перед ними; ресиверы — в два
  // ряда у дальнего торца, доступ — через ворота там, при необходимости плотнее (в паре — до вплотную, от стен — как
  // «плотно» у компрессора). Контейнер уже — в габарит перевозки.
  // Несколько компрессоров — рядом в ряд от торца (так короче трубопровод), каждый по середине ширины с сервисными воротами
  // спереди и сзади; между компрессорами и за последним — не меньше modes.next (1 000 мм) для обслуживания сбоку; дверь
  // оператора — за последним компрессором
  rowE(units, Lu, W, T=0, pe=StationMatrix.door().edge){
    const C=units.filter(e=>e.kind==='compressor' && !e.slot);
    if (!C.length || units.some(e=>/^(dgu|pump|tank)$/.test(e.kind))) return { ok:false, why:'mode' };
    const c=C[0], nc=C.length, n=StationLayout.n, aRec=this.aisle[0], twOf=e=>{ const wt=StationMatrix.wall(e); return wt ? wt[1] : e.c.back[1]; }, tw=twOf(c);
    const wide=C.filter(e=>e.w+2*twOf(e)>W); if (wide.length) return { ok:false, why:'width', bad:wide, needW:Math.max(...wide.map(e=>e.w+2*twOf(e))) };
    // шкафы и фильтры, которым места на стене и трубе не нашлось, — перед ресиверами (ресиверы — у дальнего торца)
    const isR=e=>e.kind==='receiver' && !e.slot, rest=units.filter(e=>!C.includes(e)); let t=rest.length; while (t>0 && (isR(rest[t-1]) || rest[t-1].slot)) t--;
    const U=[...C.map(e=>({ e, rot:false, ends:true })), ...[...rest.slice(0, t), ...rest.slice(t).filter(e=>!isR(e)), ...rest.slice(t).filter(isR)].map(e=>({ e, rot:false }))];
    // ресиверы в конце — парами поперёк (решение ПНЕВМОТЕХ: «плотнее для сохранения 2-рядной компоновки»): сначала от
    // стен — до 100 мм («плотно» компрессора), промежуток в паре — по правилу «ресивер — ресивер»: рекомендуемый, при нехватке
    // ширины — сколько есть, но не меньше «не менее»; меньше (до вплотную) — только при отметке «вплотную можно»; иначе
    // ресиверы — в ряд
    let k=U.length; while (k>1 && U[k-1].e.kind==='receiver' && !U[k-1].e.slot) k--;
    const cw=(StationMatrix.wall({ kind:'compressor', w:0 })||[0, 100])[1];   // от стен — до «плотно» компрессора (100 мм)
    for (let j=U.length-2; j>=k; j-=2){ const a=U[j].e, b=U[j+1].e, pr=StationMatrix.pair(a, b), rw=Math.min(Math.max(a.c.back[1], b.c.back[1]), cw);
      const lo=pr ? (pr[2]===0 ? 0 : pr[1]) : 300, g=Math.min(pr ? pr[0] : 300, W-a.w-b.w-2*rw); if (g<lo || W-a.w-b.w-g<2*tw) break;
      U.splice(j, 2, { e:StationLayout.pairUnit(a, b, g), rot:false, pair:[a, b], gap:g, end:true }); }
    const need=o=>o.e.w+o.e.c.back[1]+this.front(o.e)[1], bad=U.filter(o=>!o.ends && !o.end && need(o)>W);
    if (bad.length) return { ok:false, why:'width', bad:bad.map(o=>o.e), needW:Math.max(...bad.map(need)) };
    // промежуток за компрессором: дверь оператора (с коробкой) мимо его сервисных ворот (шире его на addW, с шагом 100 мм) —
    // через door.gap; от края станции — не ближе door.edge (pe — внутри от торца)
    const D=StationLayout.DOOR, Ew=StationLayout.ENTRY[1]-StationLayout.ENTRY[0], dg=StationMatrix.door().gap;
    const ovOf=e=>Math.max(0, (StationLayout.svcW(e.l, T)-e.l)/2), ov=ovOf(c), cl=C[nc-1], dn=Math.ceil(ovOf(cl)+dg+Ew+D.pad), nx=StationMatrix.modes().next;
    // от торца — «плотно», но его сервисные ворота (шире его) не упираются в угол; между компрессорами — не меньше modes.next
    // и чтобы их сервисные ворота стояли через door.gap; за последним — дверь оператора, не меньше modes.next
    const E=U.map(o=>o.e), gapsOf=lvl=>{ const g=this.chain(E, lvl).gaps; g[0]=Math.max(tw, Math.ceil(ov+Math.max(D.pad, pe)-this.G));
      for (let i=1; i<nc; i++) g[i]=Math.max(g[i], nx, Math.ceil(ovOf(C[i-1])+ovOf(C[i])+2*dg+Ew));   // и дверь оператора между ними
      g[nc]=Math.max(g[nc], dn, nx); return g; };
    const body=U.reduce((s, o)=>s+o.e.l, 0), rec=gapsOf(0), mn=gapsOf(this.closeOk ? 2 : 1), sum=a=>a.reduce((s, v)=>s+v, 0);   // вплотную — ресиверы и фильтры (крайний случай)
    if (body+sum(mn)>Lu) return { ok:false, why:'length', needL:body+sum(mn), needL0:body+sum(rec) };
    const q=sum(rec)>sum(mn) ? Math.max(0, Math.min(1, (Lu-body-sum(mn))/(sum(rec)-sum(mn)))) : 1;
    const gaps=mn.map((v, i)=>Math.floor(v+(rec[i]-v)*q)); gaps[nc]+=Lu-body-sum(gaps);   // свободная длина — у двери оператора
    const items=[], iss=[]; let x=gaps[0];
    U.forEach((o, i)=>{ const d=o.e.w, budget=W-d, it={ o, ri:0, x, lx:o.e.l, d, face:-1 };
      if (o.ends || o.end){ it.back=Math.round(budget/2); it.aisle=budget-it.back; }
      else { const b=o.e.c.back, fr=this.front(o.e)[0]; it.back=budget-b[0]>=fr ? b[0] : budget-fr>=b[1] ? budget-fr : b[1]; it.aisle=budget-it.back; }
      it.y=W-it.back-d; items.push(it); x+=o.e.l+gaps[i+1]; });
    const ce=items[nc-1].x+cl.l, entry=[Math.round(Math.max(ce+ovOf(cl)+dg, ce+(gaps[nc]-Ew)/2)), 0]; entry[1]=entry[0]+Ew;
    const eq=items.filter(i=>!i.o.ends && !i.o.end && !i.o.e.slot), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W-c.w;
    if (eq.length && aisleW<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleW)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (q<1 && gaps.length>2) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(Math.min(...gaps.slice(1, -1)))} мм — по длине не хватает места для рекомендуемых.` });
    return { ok:true, rows:1, aisleW, items, iss, entry };
  }

  // ---- ДГУ-станция (решение владельца 19.10): радиатор каждой ДГУ — вплотную к своим жалюзи (dgu.rad), у каждой — свой выброс
  // горячего воздуха и свой выхлоп. Одна ДГУ — вдоль, радиатором к дальнему торцу; две без бака — по одной у каждого торца
  // радиаторами наружу, между ними — проход и дверь оператора; от dgu.across штук (и две с баком — левый торец занят отсеком) —
  // поперёк, радиаторами к задней стене, генератором к проходу. Поворот на 90° — и одной или двум, если так короче (dgu.rot).
  /** варианты для этих ДГУ: line — вдоль (одна), ends — к двум торцам, across — поперёк */
  dguWays(D){
    const M=StationMatrix.grp('dgu'), n=D.length, w=[];
    if (n===1 || this.inMods) w.push('line'); else if (n===2 && M.two && !this.tank) w.push('ends');   // из модулей — и в линию вдоль (каждая в своём модуле)
    if (n===2 && M.two && !this.tank && this.inMods) w.push('ends');
    if (n>=M.across || (n>=2 && (this.tank || !M.two)) || M.rot) w.push('across');
    return w.length ? w : ['across'];
  }
  /** ряд ДГУ-станции: лучший из вариантов — помещается и короче (поровну — по порядку: вдоль, к торцам, поперёк) */
  rowD(units, Lu, W){
    const D=units.filter(e=>e.kind==='dgu'), O=units.filter(e=>e.kind!=='dgu');
    let best=null, fail=null;
    for (const way of this.dguWays(D)){
      let r=way==='line' ? this.dLine(units, Lu, W) : way==='ends' ? this.dEnds(D, O, Lu, W) : this.dAcross(D, O, Lu, W);
      if (r.ok && this.jGeo && Lu>0) r=this.joints(r, this.jGeo, Lu, W);   // из модулей: каждая ДГУ — в своём модуле
      if (r.ok){ if (!best || r.used<best.used) best=r; }
      else if (!fail || (fail.why==='width' && r.why!=='width') || (r.why===fail.why && (r.needL||r.needW||0)<(fail.needL||fail.needW||0))) fail=r; }
    return best || fail;
  }
  /** одна ДГУ вдоль: прежний ряд, радиатор — к дальнему торцу (отступ — clear far = dgu.rad) */
  dLine(units, Lu, W){
    const r=this.row1(units, Lu, W, true); if (!r.ok) return r;
    for (const it of r.items) if (it.o.e.kind==='dgu'){ it.o.rad='right'; Object.assign(it, this.dMid(it.o.e, it.d, W)); }
    r.aisleW=Math.min(...r.items.map(i=>i.aisle)); r.iss=(r.iss||[]).filter(i=>!/^Проход обслуживания/.test(i.text)); this.dPass(r.items, r.iss);
    r.used=Math.max(...r.items.map(i=>i.x+i.lx)); r.way='line'; return r;
  }
  /** ДГУ вдоль — посередине ширины контейнера (решение владельца 19.10, отступы уменьшены: проход с каждой стороны — не
   *  меньше dgu.pass, иначе замечание) */
  dMid(e, d, W){ const y=Math.round((W-d)/2); return { back:W-d-y, aisle:y, y }; }
  /** замечание: проход вдоль ДГУ посередине уже dgu.pass */
  dPass(items, iss){ const P=StationMatrix.grp('dgu').pass, n=StationLayout.n, a=Math.min(...items.filter(i=>i.o.e.kind==='dgu').map(i=>i.aisle));
    if (a<P) iss.push({ level:'warn', text:`ДГУ посередине ширины: проход с каждой стороны ${n(a)} мм — меньше ${n(P)} мм («Настройки → Правила компоновки → ДГУ в контейнере»); нужен контейнер шире.` }); }
  /** задний отступ и проход у агрегата глубиной d (один ряд): сзади — рекомендуемый, если проход остаётся не уже допустимого */
  dBack(e, d, W){ const b=e.c.back, budget=W-d, fm=this.front(e)[1]; const back=budget-b[0]>=fm ? b[0] : budget-fm>=b[1] ? budget-fm : b[1]; return { back, aisle:budget-back, y:W-back-d }; }
  /** две ДГУ — у торцов радиаторами наружу; между генераторами — проход обслуживания (сторона генератора — clear side) и дверь
   *  оператора в стене прохода (с промежутками door.gap); прочее на полу — между ними */
  dEnds(D, O, Lu, W){
    const R=StationMatrix.grp('dgu').rad, [A, B]=D, dg=StationMatrix.door().gap, Ew=StationLayout.ENTRY[1]-StationLayout.ENTRY[0];
    const need=e=>e.w+e.c.back[1]+this.front(e)[1], bad=D.filter(e=>need(e)>W);
    if (bad.length) return { ok:false, why:'width', bad, needW:Math.max(...bad.map(need)) };
    // прочее — сразу за ДГУ у входа; дверь оператора — в промежутке между прочим и второй ДГУ (не уже двери с промежутками)
    const mid=lvl=>{ const l1=Math.min(1, lvl), s=Math.max(A.c.side[l1], B.c.side[l1]);
      if (!O.length) return Math.max(s, Ew+2*dg);
      let m=Math.max(A.c.side[l1], O[0].c.side[l1]); for (let i=1; i<O.length; i++) m+=Math.max(O[i-1].c.side[l1], O[i].c.side[l1]);
      return m+Math.max(O[O.length-1].c.side[l1], B.c.side[l1], Ew+2*dg)+O.reduce((s2, e)=>s2+e.l, 0); };
    const body=A.l+B.l+2*R, needL=body+mid(1), needL0=body+mid(0);
    if (needL>Lu) return { ok:false, why:'length', needL, needL0, needLc:needL };
    const items=[], iss=[], put=(e, x, rad)=>{ const o={ e, rot:false, rad }, q=this.dMid(e, e.w, W); items.push({ o, ri:0, x, lx:e.l, d:e.w, face:-1, ...q }); };
    put(A, R, 'left'); put(B, Lu-R-B.l, 'right');
    const x1=R+A.l, x2=Lu-R-B.l;
    if (O.length){ const s0=Math.max(A.c.side[1], O[0].c.side[1]); let x=x1+s0;
      for (let i=0; i<O.length; i++){ const e=O[i], q=this.dBack(e, e.w, W); items.push({ o:{ e, rot:false }, ri:0, x, lx:e.l, d:e.w, face:-1, ...q }); x+=e.l+(i<O.length-1 ? Math.max(e.c.side[1], O[i+1].c.side[1]) : 0); } }
    // дверь оператора — по середине самого широкого промежутка между генераторами и прочим
    const occ=items.map(i=>[i.x, i.x+i.lx]).sort((a, b)=>a[0]-b[0]), gaps=[];
    for (let i=1; i<occ.length; i++) gaps.push([occ[i-1][1], occ[i][0]]);
    const g=gaps.filter(([a, b])=>a>=x1 && b<=x2).sort((p, q)=>(q[1]-q[0])-(p[1]-p[0]))[0] || [x1, x2], e0=Math.round((g[0]+g[1]-Ew)/2);
    const aisleW=Math.min(...items.map(i=>i.aisle)); this.dPass(items, iss);
    return { ok:true, rows:1, aisleW, items, iss, entry:[e0, e0+Ew], used:Lu, way:'ends' };
  }
  /** ДГУ поперёк: повёрнуты на 90°, радиатор — к задней стене (dgu.rad), генератор — к проходу у передней стены (не уже
   *  clear side «не менее» и прохода оператора); между ДГУ — проход к длинным сторонам (от aisle.service), у торцов — clear back */
  dAcross(D, O, Lu, W){
    const R=StationMatrix.grp('dgu').rad, n=StationLayout.n, sv=StationMatrix.grp('aisle').service, E=[...O, ...D];
    const fr=(e, l)=>Math.max(this.aisle[l], e.c.side[l]), need=e=>e.l+R+fr(e, 1), bad=D.filter(e=>need(e)>W);
    if (bad.length) return { ok:false, why:'width', bad, needW:Math.max(...bad.map(need)) };
    const lenX=e=>e.kind==='dgu' ? e.w : e.l, as=StationMatrix.access().side, Dm=StationMatrix.door(), edge=Math.max(StationLayout.DOOR.pad, Dm.edge-(this.T||0));
    // дверь-жалюзи шире ДГУ (StationLayout.dguDoorW): её выступ — до края станции не меньше door.edge, до соседней — door.gap
    const over=e=>e.kind==='dgu' ? (StationLayout.dguDoorW(e.w)-e.w)/2 : 0;
    // длинный бок ДГУ поперёк — к торцу или соседу: не меньше отступа сзади и доступа к боку (access.side)
    const lb=(e, l)=>e.kind==='dgu' ? Math.max(e.c.back[l], as, over(e)+edge) : e.c.side[l];
    const gapsOf=lvl=>{ const l=Math.min(1, lvl), g=[], s=(a, b)=>a.kind==='dgu' && b.kind==='dgu' ? Math.max(sv, l ? Math.max(sv, a.c.back[1]) : Math.max(a.c.side[0], sv), over(a)+over(b)+Dm.gap) : Math.max(lb(a, l), lb(b, l));
      g.push(lb(E[0], l)); for (let i=1; i<E.length; i++) g.push(s(E[i-1], E[i])); g.push(lb(E[E.length-1], l)); return g; };
    const body=E.reduce((s, e)=>s+lenX(e), 0), sum=a=>a.reduce((s, v)=>s+v, 0), mn=gapsOf(1), rec=gapsOf(0);
    const needL=body+sum(mn), needL0=body+sum(rec);
    if (needL>Lu) return { ok:false, why:'length', needL, needL0, needLc:needL };
    const q=sum(rec)>sum(mn) ? Math.max(0, Math.min(1, (Lu-needL)/(sum(rec)-sum(mn)))) : 1, gaps=mn.map((v, i)=>Math.floor(v+(rec[i]-v)*q));
    const items=[], iss=[]; let x=gaps[0]+Math.max(0, Lu-body-sum(gaps));   // свободная длина — у двери
    E.forEach((e, i)=>{ if (e.kind==='dgu'){ const d=e.l, y=W-R-d; items.push({ o:{ e, rot:true, rad:'back' }, ri:0, x, lx:e.w, d, face:-1, back:R, aisle:y, y }); }
      else { const q2=this.dBack(e, e.w, W); items.push({ o:{ e, rot:false }, ri:0, x, lx:e.l, d:e.w, face:-1, ...q2 }); }
      x+=lenX(e)+gaps[i+1]; });
    const aisleW=Math.min(...items.map(i=>i.aisle)), aRec=this.aisle[0];
    if (aisleW<aRec) iss.push({ level:'warn', text:`Проход перед ДГУ ${n(aisleW)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    return { ok:true, rows:1, aisleW, items, iss, used:Math.max(...items.map(i=>i.x+i.lx))+gaps[gaps.length-1], way:'across' };
  }

  /** промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее) */
  chain(E, lvl){
    const g=[]; if (!E.length) return { gaps:g, sum:0 };
    // агрегат поперёк (cross): перед ним — проход обслуживания (лицом к входу), за ним — отступ сзади и проход второй части;
    // соседи — по матрице расстановки (lvl 2 — крайний случай: ресиверы и фильтры вплотную), иначе — по нормам вида
    const l1=Math.min(1, lvl), fr=e=>this.front(e)[l1], bk=e=>Math.max(e.c.back[l1], this.aisle[1]);
    // вплотную (lvl 2) — только одиночные ресиверы и фильтры: у пары (один за другим) задний осматривают сбоку — промежуток
    // не меньше recv.pairSide и «вплотную» его не уменьшает
    const nb=(a, b)=>{ const p=StationMatrix.pair(a, b); if (!p) return Math.max(a.c.side[l1], b.c.side[l1]);
      return lvl>=2 && (a.pairD || b.pairD) ? Math.max(p[2], Math.min(p[1], StationLayout.PAIR_SIDE)) : p[Math.min(lvl, 2)]; };
    // у торца — проход к боку агрегата, который обслуживают сбоку (матрица: стороны Л/П); самый крайний случай (lvl 3) — по нормам
    const end=e=>Math.max(e.c.side[l1], lvl<3 && (StationMatrix.sides(e.kind).L || StationMatrix.sides(e.kind).R) ? StationMatrix.access().side : 0);
    g.push(E[0].cross ? fr(E[0]) : end(E[0]));
    for (let i=1; i<E.length; i++) g.push(E[i].cross ? Math.max(E[i-1].c.side[l1], fr(E[i])) : E[i-1].cross ? Math.max(bk(E[i-1]), E[i].c.side[l1]) : nb(E[i-1], E[i]));
    const last=E[E.length-1]; g.push(last.cross ? bk(last) : last.c.far ? last.c.far[l1] : end(last));
    return { gaps:g, sum:g.reduce((s, v)=>s+v, 0) };
  }

  /** места в рядах: R[0] — у задней стены, R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым */
  place(R, Lu, W, depth, lenX, lv=1){
    const n=StationLayout.n, aRec=this.aisle[0], items=[], iss=[], rows=R.filter(r=>r.length).length;
    let gapsShort=false, minGap=Infinity;
    R.forEach((row, ri)=>{ if (!row.length) return;
      const E=row.map(o=>o.e), rec=this.chain(E, 0), mn=this.chain(E, lv), body=row.reduce((s, o)=>s+lenX(o), 0);
      const k=rec.sum>mn.sum ? Math.max(0, Math.min(1, (Lu-body-mn.sum)/(rec.sum-mn.sum))) : 1;
      const gaps=mn.gaps.map((v, i)=>Math.round(v+(rec.gaps[i]-v)*k));
      for (let over=body+gaps.reduce((s, v)=>s+v, 0)-Lu, i=gaps.length-1; over>0 && i>=0; i--){ const d=Math.min(over, gaps[i]); gaps[i]-=d; over-=d; }   // округление — не длиннее ряда
      const free=Lu-body-gaps.reduce((s, v)=>s+v, 0);
      if (k<1) gapsShort=true;
      const lead=E.findIndex(e=>e.kind!=='cabinet');      // свободная длина — у двери, после шкафов
      let x=gaps[0];
      row.forEach((o, i)=>{ if (i===Math.max(0, lead) && free>0) x+=free;
        items.push({ o, ri, x, lx:lenX(o), d:depth(o) }); if (i>0) minGap=Math.min(minGap, gaps[i]);
        x+=lenX(o)+gaps[i+1]; });
    });
    StationTidy.even(items);
    // поперёк: задний отступ и проход. Сначала задний отступ до рекомендуемого (иначе агрегат «плотно к стене» —
    // дорогие сервисные ворота), если проход при этом не уже допустимого; затем проход до рекомендуемого
    const back=it=>it.o.e.c.back;
    if (rows===1){
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e)[0], fm=this.front(it.o.e)[1];
        if (it.o.e.cross){ it.y=Math.round(budget/2); it.back=it.y; it.aisle=0; it.face=-2; continue; }   // поперёк: по середине ширины, лицом к входу
        if (it.o.end){ const bw=Math.min(b[1], StationMatrix.recv().pairWall); it.back=Math.max(bw, Math.round((budget)/2)); it.back=Math.min(it.back, budget-bw); it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; continue; }   // пара во всю ширину: отступы от стен поровну, не меньше recv.pairWall
        it.back = budget-b[0]>=fm ? b[0] : budget-fm>=b[1] ? budget-fm : b[1];
        if (budget-it.back>fr && it.back<b[0]) it.back=Math.min(b[0], budget-fr);
        it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; }
    } else {
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const recOk=W-dm(A, i=>i.d+back(i)[0])-dm(B, i=>i.d+back(i)[0])>=this.aisle[1];   // проход не уже допустимого — сзади рекомендуемый
      for (const it of items) it.back=recOk ? back(it)[0] : back(it)[1];
      if (!recOk){   // сзади «не менее», а проход шире рекомендуемого — излишек поровну рядам назад (к обслуживанию сзади)
        const per=Math.max(0, W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back)-aRec)/((A.length ? 1 : 0)+(B.length ? 1 : 0));
        for (const it of items) it.back=Math.floor(Math.min(back(it)[0], back(it)[1]+per)); }
      const free=W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back);
      for (const it of B){ it.y=W-it.back-it.d; it.face=-1; it.aisle=free; }
      for (const it of A){ it.y=it.back; it.face=1; it.aisle=free; }
    }
    StationTidy.facade(items, W, rows, aRec);
    const eq=items.filter(i=>!i.o.e.slot && !i.o.e.cross && !i.o.end), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W, dgu=eq.find(i=>i.o.e.kind==='dgu'), other=eq.filter(i=>i.o.e.kind!=='dgu');
    const aisleO=other.length ? Math.min(...other.map(i=>i.aisle)) : Infinity;
    if (aisleO<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (dgu && dgu.aisle<aRec) iss.push({ level:'warn', text:`Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.front(dgu.o.e)[1])} мм).` });
    if (gapsShort && Number.isFinite(minGap)) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(minGap)} мм — по длине не хватает места для рекомендуемых.` });
    else if (gapsShort) iss.push({ level:'warn', text:'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.' });
    for (const it of eq) if (it.back<back(it)[0] && back(it)[0]>150 && !it.o.e.unit) iss.push({ level:'warn', tight:it.o.e.pos, text:`Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back+this.G)} мм от стены — рекомендуется ${n(back(it)[0]+this.G)} мм.` });
    return { ok:true, rows, aisleW, items, iss };
  }

  /** станция из модулей (решение владельца 19.10): модуль везут с оборудованием внутри — каждый агрегат целиком в своём
   *  модуле, от линии стыка не ближе полустойки каркаса. Поперёк — агрегат в ближайшую полосу модуля, где он помещается
   *  (ДГУ вдоль — посередине своей полосы), с отступом от стены и проходом не меньше допустимых; по длине — за стык, следующие
   *  в ряду сдвигаются (не хватает длины — станция длиннее). Координаты — полезные (без зазора G) */
  joints(r, geo, Lu, W){
    const J=StationMods.lines(geo), s=StationMods.M.post/2, g=this.G, X=J.x.map(v=>v-geo.x0-g), Y=J.y.map(v=>v-g);
    const zones=[]; for (let k=0; k<=Y.length; k++) zones.push([k ? Y[k-1]+s : 0, k<Y.length ? Y[k]-s : W]);
    const bad=[], moved=[];
    for (const it of r.items){ const d=it.d, e=it.o.e;
      if (!Y.some(y=>it.y<y+s && it.y+d>y-s)) continue;
      // у задней стены (лицом к проходу) — в полосе у этой стены, у передней — у передней; посередине (ДГУ) — в ближайшей
      const c=it.y+d/2, mid=e.kind==='dgu' && !it.o.rot, Z=zones.filter(([a, b])=>b-a>=d).sort((p, q)=>!mid && it.face===-1 ? q[1]-p[1] : !mid && it.face===1 ? p[0]-q[0] : Math.abs((p[0]+p[1])/2-c)-Math.abs((q[0]+q[1])/2-c));
      const z=Z[0]; if (!z || it.o.e.cross || it.o.end){ bad.push(e); continue; }
      it.y=e.kind==='dgu' && !it.o.rot ? Math.round(z[0]+(z[1]-z[0]-d)/2) : Math.min(Math.max(it.y, z[0]), z[1]-d);
      if (it.face===1) it.back=it.y; else { it.back=W-it.y-d; it.aisle=it.y; }
      if (it.back<(e.kind==='dgu' && !it.o.rot ? StationMatrix.grp('dgu').pass : Math.min(...e.c.back))) bad.push(e);
      moved.push(it); }
    if (moved.length && r.rows===2){ const A=r.items.filter(i=>i.ri===1), B=r.items.filter(i=>i.ri===0);
      const free=(B.length ? Math.min(...B.map(i=>i.y)) : W)-(A.length ? Math.max(...A.map(i=>i.y+i.d)) : 0); for (const it of r.items) it.aisle=free; }
    for (const it of moved) if (it.aisle<(it.o.e.kind==='dgu' && !it.o.rot ? StationMatrix.grp('dgu').pass : Math.min(this.aisle[1], this.front(it.o.e)[1]))) bad.push(it.o.e);
    if (bad.length) return { ok:false, why:'joint', bad:[...new Set(bad)] };
    // по длине: ряд за рядом слева направо — агрегат на стыке отодвигается за стык в ближнюю сторону, если промежуток к соседу
    // остаётся не меньше прежнего (и не меньше 700 мм — между агрегатами, СП 30.13330); иначе — за стык вместе со следующими
    if (X.length) for (const ri of [...new Set(r.items.map(i=>i.ri))]){
      const row=r.items.filter(i=>i.ri===ri).sort((p, q)=>p.x-q.x);
      for (let k=0; k<row.length; k++){ const it=row[k], x=X.find(v=>it.x<v+s && it.x+it.lx>v-s); if (x==null) continue;
        const pv=row[k-1], nx=row[k+1], g0=pv ? it.x-pv.x-pv.lx : it.x, g1=nx ? nx.x-it.x-it.lx : Lu-it.x-it.lx;
        const xl=Math.round(x-s-it.lx), xr=Math.round(x+s), okL=xl-(pv ? pv.x+pv.lx : 0)>=Math.min(g0, 700), okR=(nx ? nx.x : Lu)-xr-it.lx>=Math.min(g1, 700);
        const opt=[okL && xl, okR && xr].filter(v=>v!==false).sort((p, q)=>Math.abs(p-it.x)-Math.abs(q-it.x));
        if (opt.length){ it.x=opt[0]; continue; }
        // вместе с соседями: следующие — за стык (вправо), если не упираются в торец; иначе предыдущие — до стыка (влево) за счёт
        // свободной длины у двери
        const dx=Math.round(x+s-it.x), dl=Math.round(it.x+it.lx-(x-s)), last=row[row.length-1];
        if (last.x+last.lx+dx>Lu && row[0].x-dl>=Math.min(row[0].x, 600)){ for (let m=0; m<=k; m++) row[m].x-=dl; continue; }
        for (let m=k; m<row.length; m++) row[m].x+=dx; } }
    const end=Math.max(...r.items.map(i=>i.x+i.lx));
    if (end>Lu) return { ok:false, why:'length', needL:end+100, needL0:end+100 };
    r.aisleW=Math.min(...r.items.map(i=>i.aisle));
    if (r.entry && X.some(v=>r.entry[0]<v+s && r.entry[1]>v-s)){ const v=X.find(q=>r.entry[0]<q+s && r.entry[1]>q-s), w=r.entry[1]-r.entry[0]; r.entry=[v+s, v+s+w]; }
    return r;
  }

  /** заданный контейнер: сначала как обычно, не помещается — исключения (компрессорная: без продольного прохода,
   *  проход «в крайнем случае», без сквозного прохода); modes — только эти режимы (автоподбор размера и подсказки задают их сами). Не помещается ни в одном —
   *  ответ обычного режима (его замечания понятнее) */
  fit(units, geo, modes){
    const M=modes || this.modes(); let first=null;
    for (const m of M){ const r=this.withMode(m, ()=>this.fit0(units, geo));
      if (r.level!=='error'){ this.modeNotes(r, m, geo); if (m.tight || m.cross || m.ends) r.level=r.issues.some(i=>i.level==='warn') ? 'warn' : r.level; return r; }
      first=first||r; }
    return first;
  }
  /** оборудование на полу — рядами; настенные шкафы — на стене прохода, фильтры — на трубопроводе; не нашлось им места —
   *  своё место в ряду (шкаф — на стене за ним, фильтр — на трубе) */
  fit0(units, geo){
    let wall=units.filter(e=>e.mount==='wall'), hang=units.filter(e=>e.pipe), floor=units.filter(e=>!e.pipe && e.mount!=='wall');
    if (!floor.length){ floor=units.map(e=>Object.assign({}, e, { slot:true })); wall=[]; hang=[]; }
    const pass=avoid=>{ const q=this.fitRow(floor, geo, units); if (q.level==='error') return { q, left:[] };
      if (this.tank) this.tankPlace(q, geo); this.exits(q, geo, avoid); return { q, left:this.attach(q, wall, hang, geo) }; };
    let { q:r, left }=pass([]);
    if (r.level==='error') return r;
    // ворота заняли торец, и шкафам на стене не хватило места — шкафы важнее (иначе нет прохода): ворота в другом торце,
    // нет места и там — демонтаж через сервисную дверь в боковой стене
    for (const avoid of [r.gates && !r.gates.sea ? [r.gates.wall] : null, ['left', 'right']]){ if (!left.length || !avoid || !(r.gates && !r.gates.sea)) break;
      const t=pass(avoid); if (t.left.length<left.length){ r=t.q; left=t.left; } }
    // не нашлось места на стене или трубе — своё место в ряду; после перестановки трубопровод короче, и места может не
    // хватить следующему фильтру — тогда и ему (ничего не теряется: не поместилось в ряд — контейнер мал)
    for (let slots=left; left.length; slots=[...slots, ...left]){
      const ids=new Set(slots.map(StationLayout.key)), rest=e=>!ids.has(StationLayout.key(e));
      // своё место в ряду — в конце; не помещается — перед ресиверами в конце ряда (по ходу воздуха фильтры — до «сухого»
      // ресивера; ресиверы остаются в конце и могут встать парами поперёк у торца)
      const sl=slots.map(e=>Object.assign({}, e, { slot:true }));
      let r2=this.fitRow([...floor, ...sl], geo, units), k=floor.length; while (k>0 && floor[k-1].kind==='receiver') k--;
      if (r2.level==='error' && k<floor.length){ const r3=this.fitRow([...floor.slice(0, k), ...sl, ...floor.slice(k)], geo, units); if (r3.level!=='error') r2=r3; }
      if (r2.level==='error') return r2;
      if (this.tank) this.tankPlace(r2, geo);
      this.exits(r2, geo);
      left=this.attach(r2, wall.filter(rest), hang.filter(rest), geo);
      r=r2;
    }
    this.finish(r, geo);
    return r;
  }

  /** ряды в заданном контейнере: высота, затем один ряд, при нехватке — два ряда. Внутри всегда проход для оператора и
   *  обслуживания: не помещается с ним — контейнер мал (станций «только с сервисными дверями» нет) */
  fitRow(units, geo, all){
    const g=this.G, [L, Wi, H]=geo.int, Lu=L-geo.x0-2*g, W=Wi-2*g, hh=this.heights(all, H), n=StationLayout.n;   // полезные размеры (под потолком зазор G — внутри отступа сверху)
    this.inMods=!!(geo.mods && geo.mods.Lm); this.jGeo=this.inMods ? geo : null;
    this.closeOk=!!this.closeAll || (!geo.auto && !geo.road);   // вплотную (ресиверы, фильтры) — в заданном контейнере; при подборе размера — последним приёмом перед выносом ресиверов наружу (closeAll)
    let r=this.dguSt ? this.rowD(units, Lu, W) : this.mode.ends ? (geo.x0 ? { ok:false, why:'mode' } : this.rowE(units, Lu, W, geo.t||0, StationLayout.gaps(geo).eL)) : this.row1(units, Lu, W);
    if (!this.dguSt && !this.mode.ends && (!r.ok || r.iss.some(i=>i.level==='warn'))){ const r2=this.row2(units, Lu, W); if (r2.ok && (!r.ok || !r2.iss.some(i=>i.level==='warn'))) r=r2; }
    if (!r.ok && this.mode.cross && !this.dguSt){ const r3=this.rowX(units, Lu, W); if (r3.ok) r=r3; }   // исключение: агрегат поперёк, две двери
    if (this.jGeo && !this.dguSt && !this.mode.ends){   // из модулей: бок о бок — сначала два ряда (ряд в своей полосе модулей), на стыке — другой вариант
      const V=(geo.mods.b>1 ? ['row2', 'row1'] : ['row1', 'row2']).map(k=>k==='row2' ? this.row2(units, Lu, W) : this.row1(units, Lu, W)).filter(q=>q.ok);
      let first=null; r=null;
      for (const q of V){ const j=this.joints(q, geo, Lu, W); if (j.ok && (!r || (r.iss.some(i=>i.level==='warn') && !j.iss.some(i=>i.level==='warn')))) r=j; first=first||j; if (r && !r.iss.some(i=>i.level==='warn')) break; }
      r=r || first || this.row1(units, Lu, W); }
    else if (r.ok && this.jGeo && !this.dguSt) r=this.joints(r, geo, Lu, W);
    const res={ geo, ext:geo.ext, int:geo.int };
    if (!r.ok){
      const iss=[...hh.iss];
      if (r.why==='joint') iss.unshift({ level:'error', text:`Поз. ${r.bad.map(e=>e.pos).join(', ')} — на стыке модулей: каждый агрегат должен быть целиком в своём модуле (модуль везут с оборудованием внутри).` });
      else if (r.why==='mode') iss.unshift({ level:'error', text:'Без продольного прохода — только компрессорная (без ДГУ и насосов).' });
      else if (r.why==='width') iss.unshift({ level:'error', text:`Не проходит по ширине: ${r.bad.filter(e=>!e.unit).slice(0, 3).map(e=>`поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`).join(', ')} — вместе с проходом для оператора и обслуживания, отступом от стены и зазором на коммуникации нужно ${n(r.needW+2*g)} мм, а ширина внутри — ${n(Wi)} мм.` });
      else iss.unshift({ level:'error', text:`Не помещается по длине: нужно ${n(r.needL+2*g)} мм, а внутри контейнера ${n(Lu+2*g)} мм — не хватает ${n(r.needL-Lu)} мм.` });
      return Object.assign(res, { level:'error', issues:iss, need:{ L:r.needL||null, W:r.needW||null } });
    }
    const items=r.items.flatMap(it=>it.o.pair ? this.unpair(it, geo) : [Object.assign(this.item(it, geo), it.o.ends ? { ends:true } : {})]), iss=[...hh.iss, ...r.iss];
    const X=items.find(i=>i.cross), cross=X ? { pos:X.pos, x0:X.x, x1:X.x+X.lx } : null;
    const P=[...new Set(items.filter(i=>i.pair).map(i=>i.pos))];
    if (P.length) iss.push({ level:'info', text:`Ресиверы поз. ${P.join(', ')} — в два ряда (один за другим${items.some(i=>i.pairEnd) ? ', в конце ряда поперёк контейнера — станция короче' : ''}): осмотр и обслуживание заднего — сбоку, через промежутки между ресиверами.` });
    // дверь оператора: агрегат поперёк — в стене прохода перед ним, если места хватает, иначе — в ближнем торце
    const door=cross ? (cross.x0-geo.x0>=StationLayout.ENTRY[1]+100 ? 'side' : 'end') : !this.tank && r.rows===2 ? 'end' : 'side';
    const CE=items.filter(i=>i.ends).sort((a, b)=>a.x-b.x), C=CE[0], CZ=CE[CE.length-1], ends=C ? { pos:C.pos, x0:C.x, x1:CZ.x+CZ.lx, n:CE.length, all:[...new Set(CE.map(i=>i.pos))],
      next:(items.filter(i=>i.mount==='floor' && !i.ends && i.x>=CZ.x+CZ.lx).sort((a, b)=>a.x-b.x)[0]||{}).pos||null, recv:[...new Set(items.filter(i=>i.pairEnd).map(i=>i.pos))] } : null;
    const entryX=r.entry ? r.entry.map(v=>Math.round(geo.x0+this.G+v)) : null;
    return Object.assign(res, { level:hh.bad ? 'error' : 'ok', bad:hh.bad, items, rows:r.rows, door, cross, ends, entryX,
      doors:null, aisle:{ w:r.aisleW, rows:r.rows }, issues:iss });
  }

  /** двери и итог: уровень, занятая длина. Внутри — проход: дверь оператора (entry) и для агрегатов, которые через неё не
   *  вынести, — распашные ворота в торце (exits; у морского — его штатные двери в торце), сервисные двери — только для
   *  демонтажа, где к воротам не провезти; ДГУ — дверь-жалюзи напротив радиатора (dguDoors) */
  finish(r, geo){
    const n=StationLayout.n;
    r.doors=r.doors||[]; this.recheck(r, geo);
    { const E=this.entryOpen(geo, r.door), G=r.gates, two=r.doors.some(d=>d.kind==='entry') || r.exit || (G && G.wicket) || (r.gates2 && r.gates2.wicket) || r.secondDgu;
      const who=`дверь оператора — ${r.door==='end' && geo.sea ? 'штатные двери в торце' : `одностворчатая, ${n(E.w)} × ${n(E.h)} мм в свету, открывается наружу, с доводчиком`}`;
      for (const q of [G, r.gates2]) if (q && (q.pos.length || !q.sea)) r.issues.push({ level:'info', text:q.sea ? `Монтаж и демонтаж поз. ${q.pos.join(', ')} — через штатные двери контейнера в торце (${n(q.w)} × ${n(q.h)} мм): ${q.why.join('; ')}.`
        : `Распашные монтажные ворота ${q.full ? 'во весь торец ' : ''}${n(q.w)} × ${n(q.h)} мм в ${q.wall==='left' ? 'торце у входа' : 'дальнем торце'}, открываются наружу (${q.wall==='right' && r.items.some(i=>i.pairEnd) ? 'перед ними ресиверы в два ряда — это не выход' : 'это и выход'})${q.pos.length ? ` — для монтажа и демонтажа поз. ${q.pos.join(', ')}` : ' — для монтажа и демонтажа оборудования'}${q.why.length ? ': '+q.why.join('; ') : ''}. ${StationLayout.gateAxis(q)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя контейнера.` });
      // одинаковые ворота (несколько одинаковых агрегатов) — одной строкой с числом
      const sv=new Map(); for (const d of r.doors.filter(d=>d.kind!=='entry')){
        const t=`${d.leaves>1 ? 'Сервисные распашные ворота' : 'Сервисная распашная дверь'} ${n(d.w)} × ${n(d.h)} мм в ${d.wall==='back' ? 'задней' : 'боковой'} стене${d.both ? (d.wall==='back' ? ' за компрессором' : ' перед компрессором') : d.rear ? ' за оборудованием' : ''}`;
        const k=t+'|'+d.pos.join(','); if (!sv.has(k)) sv.set(k, { t, d, n:0 }); sv.get(k).n++; }
      for (const { t, d, n:c } of sv.values()) r.issues.push({ level:'info', text:`${t}${c>1 ? ` (${c} шт.)` : ''} — для ${d.rear ? 'обслуживания, ' : ''}монтажа и демонтажа поз. ${d.pos.join(', ')}: ${d.why.join('; ')}${d.rear && !d.both && !(G && G.pos.length) ? '; ворота в торце не нужны' : ''}.` });
      const tight=new Set(r.doors.filter(d=>d.rear).flatMap(d=>d.pos));   // плотно к стене, но с воротами за ним — не замечание
      r.issues=r.issues.filter(i=>!(i.tight!=null && tight.has(i.tight)));
      r.issues.push({ level:'info', text:`Вход: ${who}${two ? `; вторая дверь оператора — ${r.exit ? 'в дальнем торце по оси прохода' : G && G.wicket ? `калитка ${n(G.wicket.w)} × ${n(G.wicket.h)} мм в створке ворот в дальнем торце` : r.secondDgu ? 'выход через дверь-жалюзи ДГУ в дальнем торце' : 'в стене прохода у дальнего торца'} (${r.second})` : ''}.` }); }
    r.entry=this.entry(r, geo);
    r.dguDoors=this.dguDoors(r, geo); r.dguDoor=r.dguDoors[0]||null;
    for (const t of this.openings(r, geo)) r.issues.push({ level:'warn', gap:true, text:t });
    const dgG=new Map(); for (const d of r.dguDoors){ const k=[d.pos, d.wall, d.w, d.h, d.fits].join('|'); if (!dgG.has(k)) dgG.set(k, []); dgG.get(k).push(d); }
    for (const [d, q] of [...dgG.values()].map(L=>[L[0], L.length])){ const wh={ right:'в дальнем торце', left:'в торце у входа', back:'в задней стене' }[d.wall]; r.issues.push({ level:'info', text:`ДГУ поз. ${d.pos}${q>1 ? ` (${q} шт.): у каждой` : ':'} ${wh} — двустворчатая дверь-жалюзи ${n(d.w)} × ${n(d.h)} мм — выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (отдельная сервисная дверь не нужна).${d.fits ? '' : ' ДГУ шире проёма — демонтаж со снятием панели стены.'}` }); }
    r.access=this.access(r, geo);
    for (const q of r.access) if (q.miss.length) r.issues.push({ level:'warn', text:`Поз. ${q.pos}: к ${q.miss.map(k=>StationLayout.SIDE[k][1]).join(' и ')} не подойти для обслуживания (${q.miss.map(k=>q.s[k].t).join('; ')}) — нужен проход или сервисные ворота; увеличьте контейнер или поменяйте порядок в составе.` });
    r.level=r.bad ? 'error' : r.issues.some(i=>i.level==='warn') ? 'warn' : 'ok';
    r.used=this.used(r.items, geo);
    delete r.segs;
  }
  /** проёмы дверей и ворот по стенам: ближе door.edge к краю станции или ближе door.gap друг к другу (не уместились) —
   *  тексты замечаний */
  openings(r, geo){
    const [L, W]=geo.int, Q=StationLayout.gaps(geo), n=StationLayout.n, O={ front:[], back:[], left:[], right:[] }, out=[];
    const name={ front:'боковой стене (вход)', back:'задней стене', left:'торце у входа', right:'дальнем торце' }, put=(w, a, b, t)=>O[w] && O[w].push([a, b, t]);
    for (const d of r.doors||[]) put(d.wall, d.x0, d.x1, d.kind==='entry' ? 'дверь оператора' : 'сервисные ворота');
    const e=r.entry; if (e && !e.sea) e.wall==='front' ? put('front', e.x0, e.x1, 'дверь оператора') : put(e.wall, e.y0, e.y1, 'дверь оператора');
    for (const g of [r.gates, r.gates2]) if (g && !g.sea) put(g.wall, g.y0, g.y1, 'ворота');
    if (r.exit) put(r.exit.wall, r.exit.y0, r.exit.y1, 'дверь оператора'); for (const d of r.dguDoors||[]) d.wall==='back' ? put('back', d.x0, d.x1, 'дверь-жалюзи ДГУ') : put(d.wall, d.y0, d.y1, 'дверь-жалюзи ДГУ');
    if (r.fuel && r.fuel.door) put('front', r.fuel.door.x0, r.fuel.door.x1, 'дверь отсека бака');
    if (r.fuel && r.fuel.gate) put('left', r.fuel.gate.y0, r.fuel.gate.y1, 'ворота отсека бака');
    for (const [w, list] of Object.entries(O)){ const lim=w==='front' || w==='back' ? [Q.eL, L-Q.eL] : [Q.eW, W-Q.eW]; list.sort((a, b)=>a[0]-b[0]);
      for (const [a, b, t] of list) if (a<lim[0]-1 || b>lim[1]+1) out.push(`${t[0].toUpperCase()+t.slice(1)} в ${name[w]} — ближе ${n(StationMatrix.door().edge)} мм к краю станции: стена мала для проёма с отступами — проверьте у изготовителя или увеличьте контейнер.`);
      for (let k=1; k<list.length; k++) if (list[k][0]-list[k-1][1]<Q.gap-1) out.push(`В ${name[w]}: между проёмами (${list[k-1][2]} и ${list[k][2]}) ${n(Math.max(0, list[k][0]-list[k-1][1]))} мм — меньше ${n(Q.gap)} мм.`); }
    return [...new Set(out)];
  }
  static SIDE = { F:['спереди', 'лицевой стороне'], B:['сзади', 'задней стороне'], L:['слева', 'левому боку'], R:['справа', 'правому боку'] };
  /** матрица доступа: у каждого агрегата на полу — 4 стороны (Ф, З, Л, П) и чем к ним подойти: проход, зазор, сервисные
   *  ворота, ворота торца, дверь; сторона, которую обслуживать не нужно (StationMatrix.sides), — «не требуется».
   *  miss — обслуживаемые стороны без доступа (замечание) */
  access(r, geo){
    const [L, W]=geo.int, n=StationLayout.n, A=StationMatrix.access(), sv=StationMatrix.aisle().service, out=[];
    const fl=r.items.filter(i=>i.mount==='floor' && !i.tank && i.kind!=='cabinet');
    const ov=(a0, a1, b0, b1)=>Math.min(a1, b1)-Math.max(a0, b0)>50;
    // свободно от агрегата в направлении: -y (к стене прохода), +y (к задней стене), -x (к торцу у входа), +x (к дальнему торцу)
    const gap=(i, d)=>{ const O=r.items.filter(o=>o!==i && (o.mount==='floor' || o.tank));
      if (d==='-y'){ const b=O.filter(o=>ov(o.x, o.x+o.lx, i.x, i.x+i.lx) && o.y+o.ly<=i.y+1); return [b.length ? i.y-Math.max(...b.map(o=>o.y+o.ly)) : i.y, !b.length]; }
      if (d==='+y'){ const b=O.filter(o=>ov(o.x, o.x+o.lx, i.x, i.x+i.lx) && o.y>=i.y+i.ly-1); return [b.length ? Math.min(...b.map(o=>o.y))-i.y-i.ly : W-i.y-i.ly, !b.length]; }
      if (d==='-x'){ const b=O.filter(o=>ov(o.y, o.y+o.ly, i.y, i.y+i.ly) && o.x+o.lx<=i.x+1); return [b.length ? i.x-Math.max(...b.map(o=>o.x+o.lx)) : i.x-(geo.x0||0), !b.length]; }
      const b=O.filter(o=>ov(o.y, o.y+o.ly, i.y, i.y+i.ly) && o.x>=i.x+i.lx-1); return [b.length ? Math.min(...b.map(o=>o.x))-i.x-i.lx : L-i.x-i.lx, !b.length]; };
    // проём в стене напротив агрегата
    const hole=(i, d)=>{ const G=[r.gates, r.gates2].filter(Boolean);
      if ((r.dguDoors||[]).some(q=>q.pos===i.pos && q.wall==={ '+x':'right', '-x':'left', '+y':'back' }[d])) return 'дверь-жалюзи ДГУ';
      if (d==='-x' || d==='+x'){ const s=d==='-x' ? 'left' : 'right', g=G.find(q=>q.wall===s && ov(q.y0, q.y1, i.y, i.y+i.ly));
        return g ? (g.sea ? 'штатные двери торца' : 'ворота торца') : null; }
      const s=d==='+y' ? 'back' : 'front', dd=(r.doors||[]).find(q=>q.wall===s && ov(q.x0, q.x1, i.x, i.x+i.lx));
      return dd ? (dd.kind==='entry' ? 'дверь оператора' : 'сервисные ворота') : null; };
    // стороны агрегата → направления: лицом к проходу (face -1 — к стене прохода, 1 — к задней, ±2 — к торцам)
    const dirs=f=>f===1 ? { F:'+y', B:'-y', L:'+x', R:'-x' } : f===2 ? { F:'+x', B:'-x', L:'-y', R:'+y' } : f===-2 ? { F:'-x', B:'+x', L:'+y', R:'-y' } : { F:'-y', B:'+y', L:'-x', R:'+x' };
    const cnt=new Map(), all=new Map(); for (const i of fl) all.set(i.pos, (all.get(i.pos)||0)+1);
    for (const i of fl){
      const k1=(cnt.get(i.pos)||0)+1; cnt.set(i.pos, k1);
      // малые насосы (СП 31.13330.2021, п. 10.15) — можно по два на общей раме без прохода: сбоку достаточно их отступа
      const need=StationMatrix.sides(i.kind), D=dirs(i.face), s={}, miss=[], side=i.kind==='pump' && StationClear.of('pump', i)===StationClear.PUMP_SMALL ? StationClear.PUMP_SMALL.side[1] : A.side;
      for (const k of ['F', 'B', 'L', 'R']){
        const d=D[k], [g, wall]=gap(i, d), mid=i.kind==='dgu' && !i.rot && (k==='F' || k==='B'), min=mid ? Math.min(StationMatrix.grp('dgu').pass, k==='F' ? sv : A.back) : k==='F' ? sv : k==='B' ? A.back : side, h=wall ? hole(i, d) : null;
        if (!need[k]){ s[k]={ ok:true, t:'не требуется', g }; continue; }
        if (g>=min) s[k]={ ok:true, t:`${k==='F' ? 'проход' : 'зазор'} ${n(Math.round(g))} мм`, g };
        else if (h) s[k]={ ok:true, t:h, g };
        else if (k==='F' && i.pair && Math.max(gap(i, D.L)[0], gap(i, D.R)[0])>=StationLayout.PAIR_SIDE) s[k]={ ok:true, t:`сбоку, через промежуток ${n(Math.round(Math.max(gap(i, D.L)[0], gap(i, D.R)[0])))} мм (ресиверы в два ряда)`, g };
        else { s[k]={ ok:false, t:`${n(Math.max(0, Math.round(g)))} мм${wall ? ' до стены' : ' до соседнего'}, нужно ${n(min)}`, g }; miss.push(k); } }
      // класс по ширине: узкое — с основным проходом и рекомендуемым отступом; широкое — только с проходом «в крайнем случае»
      // и плотно к стене (сервисные ворота); сверхширокое — не проходит и так (поперёк, негабарит)
      const nw=Math.min(i.l||i.lx, i.w||i.ly), wr=StationMatrix.wall(i)||[0, 0], Wu=W-2*this.G;
      const cls=nw+StationClear.aisle()[0]+wr[0]<=Wu ? 'узкое' : nw+StationLayout.TIGHT+wr[1]<=Wu ? 'широкое' : 'сверхширокое';
      out.push({ cls, pos:all.get(i.pos)>1 ? `${i.pos} (${k1})` : String(i.pos), kind:i.kind, name:i.short||i.name, s, miss }); }
    return out;
  }

  /** на стены и трубы: трубопровод (геометрия), места в ряду для шкафов и фильтров, настенные шкафы, фильтры на линии.
   *  Возвращает то, чему места не нашлось */
  attach(r, cabs, hang, geo){
    const left=[], dh=Math.max(0, ...[...hang, ...r.items.filter(i=>i.slot && i.kind==='filter')].map(e=>Math.max(e.l, e.w))), st=e=>e.air && e.air.stage!=null ? e.air.stage : 50;
    r.lines=this.lines(r, geo, dh);
    for (const it of r.items.filter(i=>i.slot)) this.mountSlot(it, r, geo);
    for (const e of cabs){ const it=this.wallSpot(e, r, geo); if (it) r.items.push(it); else left.push(e); }
    // фильтры на трубе — у осушителя: перед ним — справа налево от его входа, после — слева направо от выхода (по ходу воздуха)
    const groups=new Map(); for (const e of hang){ const g=this.segOf(r, e); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
    // одинаковые (одна ступень) — параллельно: первый — на магистрали, следующие — на обводных петлях рядом с ним (loop)
    for (const [g, E] of groups){ const back=!!g && g.s1>=40 && g.s1<50, base=new Map(), cnt=new Map();
      E.sort((a, b)=>back ? st(b)-st(a) : st(a)-st(b)); for (const e of E) cnt.set(st(e), (cnt.get(st(e))||0)+1);
      for (const e of E){ const b=base.get(st(e)), it=(b && this.loop(e, b, r, geo)) || this.pipeSpot(e, r, geo, g, back, !b && cnt.get(st(e))>1);
        if (!it){ left.push(e); continue; }
        r.items.push(it); if (!b) base.set(st(e), { it, n:0 }); } }
    return left;
  }
  /** фильтр e параллельно фильтру b.it на магистрали: на своей обводной петле рядом (нет места — над или под магистралью):
   *  петля — линия вдоль фильтра с двумя перемычками к магистрали по краям (tee; место под них оставлено — pipeSpot wide),
   *  фильтр на ней — напротив первого. Места нет — null (тогда — на магистрали подряд) */
  loop(e, b, r, geo){
    const [, W, H]=geo.int, f=b.it, ln=(r.lines||[])[f.on]; if (!ln || ln.loop) return null;
    const d=f.lx, xa=f.x-100, xb=f.x+d+100, s=b.n+1, dy=s*(d+100), dz=s*(e.h-Math.max(60, e.h*0.12)+90);   // над магистралью — низ корпуса в 90 мм над её осью
    const stub=(y, z)=>({ x:xa-30, y:Math.min(y, ln.y)-30, z:Math.min(z, ln.z)-30, lx:xb-xa+60, ly:Math.abs(y-ln.y)+60, h:Math.abs(z-ln.z)+60 });
    for (const [y, z] of [[ln.y-dy, ln.z], [ln.y+dy, ln.z], [ln.y, ln.z+dz], [ln.y, ln.z-dz]]){
      if (y<40 || y>W-40 || z>H-120) continue;   // у стены — как на магистрали: корпус сдвинут в помещение, труба — в его габарите
      const it=this.unitItem(e, { x:f.x, y:Math.round(Math.max(20, Math.min(W-d-20, y-d/2))), z:Math.round(z+Math.max(60, e.h*0.12)-e.h), mount:'pipe', lx:d, ly:d, line:ln.medium, on:-1 });
      if (it.z<150 || it.z+e.h>H-50) continue;
      if (r.items.some(i=>this.hit(it, i, 0) || (i!==f && i.mount!=='pipe' && this.hit(stub(y, z), i, 0)))) continue;
      r.lines.push({ x0:xa, x1:xb, y:Math.round(y), z:Math.round(z), label:'', medium:ln.medium, branches:[xa, xb].map(x=>({ x, y0:Math.round(y), y1:ln.y, z1:ln.z, tee:true })), gaps:[], par:[f.pos, e.pos], loop:true });
      b.n=s; return it; }
    return null;
  }

  lines(r, geo, dh){ return LayoutPipes.lines(r, geo, dh); }
  segOf(r, e){ return LayoutPipes.segOf(r, e); }
  hangOn(it, ln, W){ LayoutPipes.hangOn(it, ln, W); }
  static runs(l){ return LayoutPipes.runs(l); }
  static get FUEL_Z(){ return LayoutPipes.FUEL_Z; }

  /** свои места в ряду: шкаф — на стене за местом, фильтр — на трубе над местом */
  mountSlot(it, r, geo){
    const [, W, H]=geo.int;
    if (it.kind==='cabinet'){
      it.z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-it.h);
      it.mount='wall'; if (it.row===1){ it.y=0; it.wall='front'; } else { it.y=W-it.ly; it.wall='back'; }
      return;
    }
    const g=this.segOf(r, it), ln=g && g.line; if (!ln || ln.z+Math.max(60, it.h*0.12)-it.h<150 || ln.z+Math.max(60, it.h*0.12)>H-50){ it.mount='floor'; it.z=0; return; }
    const was={ x:it.x, y:it.y, z:it.z };
    it.mount='pipe'; this.hangOn(it, ln, W);
    // не заходит в соседнее оборудование (труба между рядами): сдвиг поперёк трубы — труба остаётся внутри его габарита
    const fl=r.items.filter(i=>i!==it && i.mount!=='pipe' && i.mount!=='wall'), y0=it.y;
    if (fl.some(i=>this.hit(it, i, 0))) found: for (let d=10; d<=it.ly; d+=10) for (const sg of [1, -1]){ const y=y0+sg*d;
      if (ln.y<y+20 || ln.y>y+it.ly-20 || y<20 || y+it.ly>W-20) continue;
      if (!fl.some(i=>this.hit(Object.assign({}, it, { y }), i, 0))){ it.y=y; break found; } }
    // на трубе это место уже занято другим фильтром (несколько фильтров на своих местах у конца трубы) — стоит на своём
    // месте в ряду, на полу
    if (r.items.some(i=>i!==it && i.mount==='pipe' && this.hit(it, i, 0))){ Object.assign(it, was, { mount:'floor', z:0 }); return; }
    ln.x0=Math.min(ln.x0, Math.round(it.x+it.lx/2)); ln.x1=Math.max(ln.x1, Math.round(it.x+it.lx/2));
  }

  /** настенный шкаф не мешает проходу оператора: проход перед ним — не уже прохода обслуживания (ПУЭ, п. 4.1.23: у щитов —
   *  не менее 0,8 м в свету; сужение до 0,6 м — только строительными конструкциями). Места по порядку: на стене прохода у
   *  двери, где перед шкафом остаётся рекомендуемый проход (напротив промежутка между оборудованием или неглубокого); на торце
   *  у двери; на дальнем торце (не у ДГУ — там жалюзи радиатора); на стене прохода с проходом «не менее». При двух рядах
   *  или места нет — null (своё место в ряду) */
  wallSpot(e, r, geo){
    if (r.rows!==1) return null;
    const [L, W, H]=geo.int, x0=geo.x0||0, w=e.l, d=e.w, z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-e.h);
    if (z+e.h>H-50) return null;
    const fl=r.items.filter(i=>i.mount!=='wall' && i.mount!=='pipe'), cabs=r.items.filter(i=>i.mount==='wall');
    // станция из модулей: не на стыке (модуль везут со шкафом на стене)
    const JL=StationMods.lines(geo), js=StationMods.M.post/2, jX=JL.x.map(v=>[v-js, v+js]), jY=JL.y.map(v=>[v-js, v+js]);
    // на стене прохода — не на пути к воротам в торце: то, что выносят через них, проходит мимо шкафа
    const G=r.gates && r.gates.pos.length ? r.gates : null, P=StationLayout.PASS, out=G ? this.bulky(r, geo).filter(b=>G.pos.includes(b.it.pos)) : [];
    const clear=x=>{ if (!out.length) return true;
      const u=fl.filter(i=>i.x<x+w && i.x+i.lx>x), room=(u.length ? Math.min(...u.map(i=>i.y)) : W)-d;
      return out.every(b=>(G.wall==='right' ? b.it.x>=x+w : b.it.x+b.it.lx<=x) || b.narrow+2*P<=room); };
    const front=need=>{
      const busy=[...cabs.filter(i=>i.wall==='front').map(i=>[i.x-100, i.x+i.lx+100]), ...jX];
      if (r.door==='side'){ const ex=this.entrySpan(r, geo); busy.push([ex[0]-150, ex[1]+150]); }
      for (const dd of (r.doors||[]).filter(dd=>dd.wall==='front')) busy.push([dd.x0-150, dd.x1+150]);   // не на сервисной двери
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || i.y-d>=need) && clear(x) && !r.items.some(i=>this.hit({ x, y:0, z, lx:w, ly:d, h:e.h }, i, 0));
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:0, z, mount:'wall', wall:'front', face:1 });
      return null; };
    // торец: шкаф вдоль торцевой стены в зоне прохода — перед ним (вдоль контейнера) проход «не менее» свободен
    const end=side=>{
      if (side==='left' && (r.door==='end' || (x0>0 && geo.type==='north'))) return null;   // вход оператора в торце; у «Севера» — тамбур (перегородка отсека бака — сплошная: можно)
      if ([r.gates, r.gates2].some(g=>g && g.wall===side)) return null;   // ворота для демонтажа (у морского — его двери)
      if (side==='right' && fl.some(i=>i.kind==='dgu')) return null;
      const xa=side==='left' ? x0 : L-d, zone=[side==='left' ? x0 : L-d-this.aisle[1], side==='left' ? x0+d+this.aisle[1] : L];
      const taken=[...cabs.filter(i=>i.wall===side).map(i=>[i.y-100, i.y+i.ly+100]), ...jY];
      for (let y=100; y+w<=W-100; y+=50){
        if (taken.some(([a, b])=>y<b && y+w>a)) continue;
        if (fl.some(i=>i.x<zone[1] && i.x+i.lx>zone[0] && i.y<y+w && i.y+i.ly>y)) continue;
        if (r.items.some(i=>this.hit({ x:xa, y, z, lx:d, ly:w, h:e.h }, i, 0))) continue;   // и не на фильтре на трубе
        return this.unitItem(e, { x:xa, y, z, lx:d, ly:w, mount:'wall', wall:side, face:side==='left' ? 2 : -2 }); }
      return null; };
    // без продольного прохода: на задней стене напротив двери оператора (между компрессором и следующим оборудованием)
    const back=need=>{ if (!r.ends) return null;
      const busy=[...cabs.filter(i=>i.wall==='back').map(i=>[i.x-100, i.x+i.lx+100]), ...jX, ...(r.doors||[]).filter(dd=>dd.wall==='back').map(dd=>[dd.x0-150, dd.x1+150])];
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || W-d-(i.y+i.ly)>=need) && !r.items.some(i=>this.hit({ x, y:W-d, z, lx:w, ly:d, h:e.h }, i, 0));
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:W-d, z, mount:'wall', wall:'back', face:-1 });
      return null; };
    if (fl.some(i=>i.kind==='dgu')) return front(this.aisle[0]) || front(this.aisle[1]) || end('left');   // у ДГУ торец у входа — под приток воздуха
    return front(this.aisle[0]) || back(this.aisle[0]) || end('left') || end('right') || front(this.aisle[1]) || back(this.aisle[1]);
  }

  /** фильтр на трубопроводе — на своём участке по ходу воздуха (до осушителя или после — по ступени), по порядку ступеней;
   *  где под ним нет оборудования, сначала — где к нему подойти из прохода (колба и элемент снимаются вниз); wide — первый
   *  из одинаковых: по краям — место под перемычки обводных петель (loop) */
  pipeSpot(e, r, geo, g, back, wide){
    const ln=g && g.line; if (!ln || ln.z+Math.max(60, e.h*0.12)-e.h<150 || ln.z+Math.max(60, e.h*0.12)>geo.int[2]-50) return null;   // под потолком не висит
    const d=Math.max(e.l, e.w), ex=wide ? 100 : 0, pad=StationLayout.PIPE_PAD+ex, it=this.unitItem(e, { x:0, y:0, z:0, mount:'pipe', lx:d, ly:d, on:(r.lines||[]).indexOf(ln) }); this.hangOn(it, ln, geo.int[1]);
    const lo=Math.ceil(Math.max(g.a+80+ex, (g.next ?? -Infinity)+ex, ln.x0-d/2)/10)*10, hi=Math.floor((Math.min(g.b-80-ex, (g.lim ?? Infinity)-ex, ln.x1+d/2, geo.int[0]-100)-d)/10)*10;
    const open=x=>r.rows!==1 || !r.items.some(i=>i.mount==='floor' && i.x<x+d && i.x+i.lx>x && i.y<it.y);
    const free=(x, o)=>!ln.branches.some(b=>b.x>x-80-ex && b.x<x+d+80+ex) && !r.items.some(i=>this.hit({ x, y:it.y, z:it.z, lx:d, ly:d, h:it.h }, i, pad)) && (!o || open(x));
    for (const o of [true, false]){
      if (back){ for (let x=hi; x>=lo; x-=20) if (free(x, o)){ it.x=x; g.lim=x-pad; return it; } }
      else for (let x=lo; x<=hi; x+=20) if (free(x, o)){ it.x=x; g.next=x+d+pad; return it; } }
    return null;
  }
  hit(a, b, pad){ return LayoutItem.hit(a, b, pad); }

  /** дверь оператора: проём в свету {w, h}, мм — одностворчатая 900 × 2000 (у морского в два ряда — его двери в торце) */
  entryOpen(geo, door){
    const W=geo.int[1], P=StationLayout.PASS;
    if (door==='end' && geo.sea && geo.door) return { w:Math.min(geo.door[0], W)-2*P, h:geo.door[1]-P };
    const d=StationMatrix.door(); return { w:d.w, h:d.h };
  }
  /** дверь оператора: одностворчатая, наружу, с доводчиком — в стене прохода у торца ('side') или в торце по оси прохода
   *  (два ряда, 'end'; у морского — его двери в торце): {wall, x0, x1 | y0, y1, w, h}; без прохода — null */
  entry(r, geo){
    const E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.gaps(geo).eW }, w=E[1]-E[0], W=geo.int[1];
    if (r.door==='side'){ const ex=this.entrySpan(r, geo); return { wall:'front', x0:ex[0], x1:ex[1], w, h:D.h }; }
    if (r.door!=='end') return null;
    if (geo.sea && geo.door){ const dw=Math.min(geo.door[0], W); return { wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], sea:true }; }
    const y0=StationLayout.inWall(this.aisleMid(r, W)-w/2, w, W, D.pad);
    return { wall:'left', y0, y1:y0+w, w, h:D.h };
  }
  /** дверь оператора в стене прохода: [от, до] по длине, мм — у торца (за тамбуром) или, без продольного прохода, между
   *  компрессором и следующим оборудованием (r.entryX) */
  entrySpan(r, geo){ const x0=geo.x0||0, E=StationLayout.ENTRY, a=Math.max(x0+E[0], StationLayout.gaps(geo).eL); return r.entryX || [a, a+E[1]-E[0]]; }
  /** полоса прохода поперёк контейнера [от, до], мм: один ряд — от передней стены до оборудования, два — между рядами */
  aisleBand(r, W){
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && !i.cross); if (!fl.length) return [0, W];
    if (r.rows!==2) return [0, Math.min(...fl.map(i=>i.y))];
    const A=fl.filter(i=>i.row===1), B=fl.filter(i=>i.row!==1); return [A.length ? Math.max(...A.map(i=>i.y+i.ly)) : 0, B.length ? Math.min(...B.map(i=>i.y)) : W];
  }
  /** середина прохода поперёк контейнера, мм */
  aisleMid(r, W){ const [lo, hi]=this.aisleBand(r, W); return (lo+hi)/2; }
  /** что не вынести через дверь оператора (ДГУ — через дверь-жалюзи в торце): не проходит в проём — компрессор, осушитель,
   *  насос стоя (меньший размер в плане и высота), ресивер, фильтр, шкаф, бак — и наклонив (двумя меньшими размерами);
   *  ресиверам и рефрижераторным осушителям ворота обычно не нужны, крупному адсорбционному — нужны. [{it, narrow, why}] */
  bulky(r, geo){
    const E=this.entryOpen(geo, r.door), P=StationLayout.PASS, n=StationLayout.n, out=[];
    for (const it of r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && i.kind!=='dgu')){
      const tilt=StationMatrix.tilt(it.kind), [a, b]=[it.l, it.w, it.h].sort((p, q)=>p-q), narrow=tilt ? a : Math.min(it.l, it.w);
      const fits=tilt ? (a+2*P<=E.w && b+P<=E.h) || (b+2*P<=E.w && a+P<=E.h) : narrow+2*P<=E.w && it.h+P<=E.h;
      if (!fits) out.push({ it, narrow, why:`поз. ${it.pos} ${tilt ? 'и наклонённым ' : ''}не проходит в дверь оператора (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм)` }); }
    return out;
  }
  /** стоит плотно к стене: сзади свободно меньше access.back (матрица, 500 мм) — обслуживание сзади, монтаж и демонтаж —
   *  через сервисные распашные ворота в стене за агрегатом (компрессор, насос и прочее; осушитель, ресивер, фильтр, шкаф,
   *  ДГУ — нет) */
  tight(it){ return StationLayout.gated(it.kind) && (it.mount==='floor' || it.mount==='frame') && !it.tank && !it.slot && !it.cross && it.back<StationMatrix.access().back; }
  /** что монтируют и демонтируют через ворота в торце: компрессоры (к ним есть доступ для обслуживания — ворота в торце
   *  всегда) и всё, что не проходит в дверь оператора; кроме стоящего плотно к стене — у него свои ворота сзади */
  mounts(r, geo){
    const big=this.bulky(r, geo).filter(b=>!this.tight(b.it)), n=StationLayout.n;
    for (const it of r.items.filter(i=>i.kind==='compressor' && i.mount==='floor' && !this.tight(i) && !big.some(b=>b.it===i)))
      big.push({ it, narrow:Math.min(it.l, it.w), why:`поз. ${it.pos} — компрессор (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм): к нему есть доступ для обслуживания, монтаж и демонтаж — через ворота в торце` });
    return big;
  }
  /** ширина пути к торцу side для агрегата it — по проходу мимо соседей и шкафов на стене ниже его верха, мм */
  pathTo(it, side, r, geo){
    const [L, W]=geo.int, x0=geo.x0||0, lo=side==='left' ? x0 : it.x, hi=side==='left' ? it.x+it.lx : L;
    const fl=r.items.filter(o=>o!==it && (o.mount==='floor' || o.mount==='frame') && !o.tank && o.x<hi && o.x+o.lx>lo);
    let w=r.rows===2 ? Infinity : Math.min(...fl.map(o=>o.aisle), Infinity);
    if (r.rows===2){ const mid=this.aisleMid(r, W), A=fl.filter(o=>o.y+o.ly<=mid), B=fl.filter(o=>o.y>=mid);
      w=(B.length ? Math.min(...B.map(o=>o.y)) : W)-(A.length ? Math.max(...A.map(o=>o.y+o.ly)) : 0); }
    for (const c of r.items.filter(c=>c.mount==='wall' && c.wall==='front' && c.x<hi && c.x+c.lx>lo && c.z<it.h+50)){
      const u=fl.filter(o=>o.x<c.x+c.lx && o.x+o.lx>c.x); w=Math.min(w, (u.length ? Math.min(...u.map(o=>o.y)) : W)-c.ly); }
    return w;
  }
  /** двери и ворота (с проходом): дверь оператора — всегда (entry), проход длиннее 7 м — вторая в дальнем конце (second);
   *  компрессоры и то, что не пройдёт в дверь оператора, — через распашные ворота в торце: дальнем, если к нему по проходу
   *  можно довезти, иначе у входа; у морского — его штатные двери в торце. Стоящее плотно к стене — через сервисные
   *  распашные ворота в стене за ним (тогда ему ворота в торце не нужны). Торец занят (отсек бака, тамбур, вход оператора,
   *  дверь-жалюзи ДГУ) или пути нет — сервисные ворота в боковой стене напротив агрегата. r.gates — {wall, y0, y1, w, h,
   *  leaves:2, pos, why[, sea, wicket]} | null, r.doors — [{wall, x0, x1, w, leaves, h, kind:'service'|'entry', pos, why[, rear]}],
   *  r.exit — вторая дверь оператора в дальнем торце {wall:'right', y0, y1, w, h} | null */
  exits(r, geo, avoid=[]){
    r.gates=null; r.gates2=null; r.doors=[]; r.exit=null;
    const L=geo.int[0], x0=geo.x0||0, P=StationLayout.PASS, n=StationLayout.n, GM=StationMatrix.gate();
    for (const it of r.items) it.tight=this.tight(it);
    if (r.ends) return this.endsExits(r, geo);
    const rear=r.items.filter(i=>i.tight).map(it=>({ it, rear:true, why:`поз. ${it.pos} стоит в ${n(it.back)} мм от стены (для обслуживания сзади нужно не меньше ${n(StationMatrix.access().back)} мм) — обслуживание сзади, монтаж и демонтаж через них` }));
    if (geo.sea && geo.door && r.door!=='end') r.gates=this.seaDoors(geo);
    const big=this.mounts(r, geo), dgu=r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600);
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank);
    // монтажные ворота в торце — у компрессорной и насосной всегда (решение ПНЕВМОТЕХ): по возможности в дальнем
    // торце (у входа — дверь оператора, логотип и приток воздуха)
    const always=!dgu && fl.some(i=>i.kind==='compressor' || i.kind==='pump');
    const free=s=>!avoid.includes(s) && (s==='left' ? x0===0 && r.door!=='end' : !dgu);
    const sides=r.gates ? ['left'] : ['right', 'left'].filter(free);
    const reach=(b, s)=>b.narrow+2*P<=this.pathTo(b.it, s, r, geo);
    let best=null;
    for (const s of sides){ const ok=big.filter(b=>reach(b, s)); if (ok.length && (!best || ok.length>best.ok.length)) best={ s, ok }; }
    if (!best && always && sides.length && !r.gates) best={ s:sides[0], ok:[] };
    const mk=(s, list)=>this.gateFor(r, geo, s, list.length ? list.map(b=>b.it) : fl.filter(i=>i.kind==='compressor' || i.kind==='pump'));
    if (best){ const ok=best.ok;
      if (!r.gates) r.gates=mk(best.s, ok);
      for (const b of ok) if (!r.gates.pos.includes(b.it.pos)){ r.gates.pos.push(b.it.pos); r.gates.why.push(b.why); } }
    // до ворот не провезти — ворота и во втором торце (если он свободен); цепочка длиннее twoAt — ворота с обоих торцов
    let far=big.filter(b=>!best || !best.ok.includes(b));
    const other=r.gates ? (r.gates.wall==='left' ? 'right' : 'left') : null, used=fl.length ? Math.max(...fl.map(i=>i.x+i.lx))-Math.min(...fl.map(i=>i.x)) : 0;
    if (other && free(other) && !(r.gates.sea && other==='left')){
      const ok2=far.filter(b=>reach(b, other)), long=used>GM.twoAt;
      if (ok2.length || long){ r.gates2=mk(other, ok2.length ? ok2 : best ? best.ok : []);
        for (const b of ok2){ r.gates2.pos.push(b.it.pos); r.gates2.why.push(b.why.replace(/ через ворота в торце$/, ' через ворота во втором торце')); }
        if (long && !ok2.length) r.gates2.why.push(`оборудование стоит на ${n(used)} мм — длиннее ${n(GM.twoAt)} мм: ворота с обоих торцов`);
        far=far.filter(b=>!ok2.includes(b)); } }
    far=far.filter(b=>!this.toGate(r, geo, b, sides));
    far=far.map(b=>{ const w=Math.max(0, ...sides.map(s=>this.pathTo(b.it, s, r, geo)).filter(Number.isFinite));
      return Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+(sides.length ? `, по проходу к торцу не провезти (${w ? `проход ${n(w)} мм, ` : ''}агрегат — ${n(b.narrow)} мм)` : avoid.length ? ', торцы заняты шкафами на стене' : ', торцы заняты (отсек бака, дверь-жалюзи ДГУ, вход оператора)') }); });
    r.side=[...rear, ...far]; r.doors=this.sideDoors(r.side, r, geo); StationTidy.doors(r.doors);
    this.regate(r, geo);
    this.second(r, geo);
  }
  /** осушитель или ресивер, которого к воротам по проходу не провезти: сервисных дверей им не делают (решение ПНЕВМОТЕХ)
   *  — монтаж и демонтаж через ближние ворота в торце (нет ворот — новые в ближнем свободном торце), при демонтаже
   *  соседнее оборудование переставляют. true — отнесён к воротам; false — не осушитель и не ресивер или торцы заняты */
  toGate(r, geo, b, sides){
    if (!StationMatrix.noDoor(b.it.kind)) return false;
    const L=geo.int[0], x0=geo.x0||0, far=s=>s==='left' ? b.it.x-x0 : L-b.it.x-b.it.lx, near=a=>a.sort((p, q)=>far(p)-far(q))[0];
    let G=[r.gates, r.gates2].filter(Boolean).sort((p, q)=>far(p.wall)-far(q.wall))[0];
    if (!G){ const s=near(sides.slice()); if (!s) return false; G=r.gates=this.gateFor(r, geo, s, [b.it]); }
    if (!G.pos.includes(b.it.pos)){ G.pos.push(b.it.pos);
      G.why.push(`${b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')}: сервисных дверей осушителям и ресиверам не делают — монтаж и демонтаж через ворота в торце, при демонтаже соседнее оборудование переставляют`); }
    return true;
  }
  /** штатные двери морского контейнера в торце у входа — как ворота в торце */
  seaDoors(geo){ const W=geo.int[1], dw=Math.min(geo.door[0], W); return { wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], leaves:2, pos:[], why:[], sea:true }; }
  /** ворота в торце по итогу: ширина — по агрегатам, которые через них монтируют, высота — по самому высокому оборудованию
   *  станции (gateFor); положение, вручную смещённое, — как задано */
  regate(r, geo){
    for (const G of [r.gates, r.gates2]){ if (!G || G.sea) continue;
      const U=r.items.filter(i=>G.pos.includes(i.pos) && (i.mount==='floor' || i.mount==='frame') && !i.tank), q=this.gateFor(r, geo, G.wall, U);
      for (const k of ['y0', 'y1', 'w', 'h', 'full', 'off', 'offWhy', 'manual']) G[k]=q[k]; }
  }
  /** без продольного прохода (r.ends): компрессору — сервисные ворота с обеих сторон (спереди и сзади) и ворота в торце у
   *  него (у морского — его штатные двери); ресиверам в два ряда у дальнего торца — ворота там; остальному, что не пройдёт в
   *  дверь оператора, — ворота в торце, если к ним по проходу провезти, иначе сервисные ворота напротив */
  endsExits(r, geo){
    const P=StationLayout.PASS, C=r.items.filter(i=>i.ends), T=r.items.filter(i=>i.pairEnd), side=[], uniq=a=>[...new Set(a)];
    for (const it of C) it.tight=false;
    r.gates=geo.sea && geo.door ? this.seaDoors(geo) : this.gateFor(r, geo, 'left', C);
    const pc=uniq(C.map(i=>i.pos)); r.gates.pos.push(...pc); r.gates.why.push(`поз. ${pc.join(', ')} — ${C.length>1 ? 'компрессоры в ряд от торца' : 'компрессор у торца'} без продольного прохода: обслуживание сбоку, монтаж и демонтаж — через ворота в торце${C.length>1 ? ' и сервисные ворота' : ''}`);
    if (T.length){ const pr=uniq(T.map(i=>i.pos)); r.gates2=this.gateFor(r, geo, 'right', T); r.gates2.pos.push(...pr);
      r.gates2.why.push(`поз. ${pr.join(', ')} — ресиверы в два ряда у дальнего торца: осмотр, обслуживание, монтаж и демонтаж — через ворота в торце`); }
    for (const it of C) for (const wall of ['front', 'back'])
      side.push({ it, wall, both:true, rear:true, why:`поз. ${it.pos} — без продольного прохода: обслуживание ${wall==='front' ? 'спереди' : 'сзади'}` });
    // между компрессорами — своя дверь оператора в стене прохода (решение ПНЕВМОТЕХ: «для доступа в пространство между
    // компрессорами нужно организовать дверь оператора»; напротив неё — место конвектору)
    const E=StationLayout.ENTRY, ew=E[1]-E[0], eh=StationMatrix.door().h+100, CS=C.slice().sort((a, b)=>a.x-b.x), mid=[];
    for (let i=1; i<CS.length; i++){ const a=CS[i-1].x+CS[i-1].lx, b=CS[i].x, x0=Math.round((a+b-ew)/2);
      mid.push({ wall:'front', x0, x1:x0+ew, w:ew, h:eh, leaves:1, kind:'entry', between:true, pos:[], why:[`между компрессорами поз. ${CS[i-1].pos} и ${CS[i].pos} — доступ к ним сбоку`] }); }
    for (const b of this.bulky(r, geo).filter(b=>!C.includes(b.it) && !T.includes(b.it))){
      const G=[r.gates, r.gates2].find(g=>g && b.narrow+2*P<=this.pathTo(b.it, g.wall, r, geo));
      if (G){ if (!G.pos.includes(b.it.pos)){ G.pos.push(b.it.pos); G.why.push(`${b.why}, монтаж и демонтаж — через ворота в торце`); } }
      else if (!this.toGate(r, geo, b, [])) side.push(Object.assign({}, b, { why:`${b.why}, к воротам в торце не провезти` })); }
    r.side=side; r.doors=mid;   // сервисные ворота — мимо дверей оператора между компрессорами
    r.doors=[...this.sideDoors(side, r, geo), ...mid];
    this.regate(r, geo);
    this.second(r, geo);
  }
  /** распашные монтажные ворота в торце s для агрегатов U: Ш = max W агрегатов + addW + 2·T, В = самое высокое оборудование
   *  станции + addH + T (решение ПНЕВМОТЕХ: ворота в обоих торцах одной высоты), не ниже проёма двери оператора (ворота —
   *  и выход) и не выше помещения; шире доли торца — во весь торец */
  gateFor(r, geo, s, U){
    const [, W, H]=geo.int, D={ ...StationLayout.DOOR, pad:StationLayout.gaps(geo).eW }, n=StationLayout.n, T=geo.t||0, GM=StationMatrix.gate();
    const nw=Math.max(0, ...U.map(i=>Math.min(i.l, i.w))), hh=Math.max(0, ...r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank).map(i=>i.h));
    let w=Math.max(GM.minW, Math.ceil((nw+GM.addW+2*T)/100)*100); const full=w>=GM.full*W || w>W-2*D.pad;
    if (full) w=W-2*D.pad;
    // по оси торца (решение ПНЕВМОТЕХ); смещение — только если агрегат по проходу у стены к центральным воротам не
    // провезти (проём над проходом уже агрегата с зазорами) — на наименьшее нужное, с причиной; вручную — «эксперт» (gate.off)
    const yc=Math.round((W-w)/2), band=this.aisleBand(r, W), needW=nw+2*StationLayout.PASS, lap=y=>Math.min(y+w, band[1])-Math.max(y, band[0]);
    let y0=full ? D.pad : yc, off=0, why='';
    if (!full && U.length && needW<=band[1]-band[0]+1e-9 && lap(yc)<needW-1e-9){ const y=band[1]<=W/2 ? Math.min(yc, band[1]-needW) : Math.max(yc, band[0]+needW-w);
      y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, y))); off=y0-yc;
      if (off) why=`смещены на ${n(Math.abs(off))} мм от оси торца к проходу у ${band[1]<=W/2 ? 'передней' : 'задней'} стены: агрегат шириной ${n(nw)} мм провозят по проходу ${n(Math.round(band[1]-band[0]))} мм, по оси торца проём над проходом уже агрегата`; }
    const G0=(this.in.req && this.in.req.gate)||{};
    if (!full && Number.isFinite(G0.off) && G0.off){ y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, yc+G0.off))); off=y0-yc; why=String(G0.why||'').trim(); }
    return { wall:s, y0, y1:y0+w, w, h:Math.min(H-GM.top, Math.max(GM.minH, Math.ceil((hh+GM.addH+T)/50)*50)), leaves:2, pos:[], why:[], full, off, offWhy:why, manual:!!(Number.isFinite(G0.off) && G0.off) };
  }
  /** со шкафами на стене: проход до ворот ещё есть; нет — тому агрегату сервисные ворота в боковой стене */
  recheck(r, geo){
    const G=r.gates, side=r.side||[]; delete r.side; if (!G || !G.pos.length) return;
    const P=StationLayout.PASS, lost=this.mounts(r, geo).filter(b=>G.pos.includes(b.it.pos) && !StationMatrix.noDoor(b.it.kind) && !side.some(q=>q.it===b.it) && b.narrow+2*P>this.pathTo(b.it, G.wall, r, geo)); if (!lost.length) return;
    for (const b of lost){ const k=G.pos.indexOf(b.it.pos); if (k<0) continue; G.pos.splice(k, 1); G.why=G.why.filter(t=>!t.startsWith(`поз. ${b.it.pos} `)); }
    if (!G.pos.length && !G.sea){ if (G.wicket && !r.exit) r.exit=this.endExit(r, geo, 'right'); r.gates=null; }
    const keep=r.doors.filter(d=>d.kind==='entry');
    r.doors=[...this.sideDoors([...side, ...lost.map(b=>Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+', до ворот в торце не провезти мимо шкафов на стене' }))], r, geo), ...keep];
  }
  /** сервисные распашные ворота (уже 1200 мм — дверь): стоящему плотно к стене (rear) — в стене за ним, остальным — в
   *  боковой стене напротив (два ряда — в стене за ним); шире агрегата на service.addW (service.min…service.max), выше на service.addH (не ниже service.minH / двери),
   *  мимо двери оператора; соседние — одними воротами, пока не шире 2400 мм, иначе — рядом через стойку 200 мм */
  sideDoors(list, r, geo){
    const [L, , H]=geo.int, x0=geo.x0||0, D=StationLayout.DOOR, ex=r.door==='side' ? this.entrySpan(r, geo) : null, out=[], T=geo.t||0;
    const { gap, eL }=StationLayout.gaps(geo), lo=Math.max(x0+D.pad, eL), hi=L-eL;   // от края станции и между проёмами
    const keep=(r.doors||[]).filter(d=>d.kind==='entry');   // вторая дверь оператора (сервисные ворота пересчитываются после неё)
    for (const { it, why, rear, wall:w0, both } of list){
      const wall=w0 || (rear ? (r.rows===2 && it.row===1 ? 'front' : 'back') : r.rows===2 && it.row!==1 ? 'back' : 'front');
      // Ш = сторона агрегата + addW + 2·T, В = высота агрегата + addH + T (матрица расстановки)
      const w=StationLayout.svcW(it.lx, T), c=it.x+it.lx/2;
      let d0=Math.max(lo, Math.min(hi-w, c-w/2));
      if (wall==='front' && ex && d0<ex[1]+gap && d0+w>ex[0]-gap) d0=d0+w/2<(ex[0]+ex[1])/2 && ex[0]-gap-w>=lo ? ex[0]-gap-w : Math.min(hi-w, ex[1]+gap);   // мимо двери оператора
      for (const q of keep) if (wall===q.wall && d0<q.x1+gap && d0+w>q.x0-gap) d0=q.x0-gap-w>=lo ? q.x0-gap-w : Math.min(hi-w, q.x1+gap);   // мимо второй двери
      out.push({ wall, x0:Math.round(d0), x1:Math.round(d0+w), h:StationLayout.svcH(it.h, T, rear, H), kind:'service', pos:[it.pos], why:[why], rear:!!rear, both:!!both }); }
    const got=[]; for (const d of out.sort((p, q)=>p.wall.localeCompare(q.wall) || p.x0-q.x0)){ const last=got[got.length-1];
      if (last && last.wall===d.wall && d.x0<last.x1+gap){
        if (Math.max(last.x1, d.x1)-last.x0<=D.max){ last.x1=Math.max(last.x1, d.x1); last.h=Math.max(last.h, d.h); last.rear=last.rear || d.rear;
          for (const v of d.pos) if (!last.pos.includes(v)) last.pos.push(v); for (const t of d.why) if (!last.why.includes(t)) last.why.push(t); continue; }
        const w=d.x1-d.x0; d.x0=last.x1+gap; d.x1=Math.min(hi, d.x0+w); if (d.x1-d.x0<D.min) continue; }   // некуда — агрегат обслуживают через соседние ворота
      got.push(d); }
    // итог по стене: мимо двери оператора и друг от друга — не ближе gap, в пределах стены; не уместилась — агрегат
    // обслуживают через соседние ворота
    const res=[];
    for (const wall of ['front', 'back']){ let prev=null;
      for (const d of got.filter(q=>q.wall===wall).sort((p, q)=>p.x0-q.x0)){ const w=d.x1-d.x0;
        if (prev && d.x0<prev.x1+gap){ d.x0=prev.x1+gap; d.x1=d.x0+w; }
        if (wall==='front' && ex && d.x0<ex[1]+gap && d.x1>ex[0]-gap){ d.x0=ex[1]+gap; d.x1=d.x0+w; }
        for (const q of keep) if (q.wall===wall && d.x0<q.x1+gap && d.x1>q.x0-gap){ d.x0=q.x1+gap; d.x1=d.x0+w; }
        d.x1=Math.min(hi, d.x1); if (d.x1-d.x0<D.min) continue;
        d.w=d.x1-d.x0; d.leaves=Math.max(1, Math.ceil(d.w/D.leaf)); res.push(d); prev=d; } }
    return res;
  }
  /** вторая дверь оператора: проход от двери оператора до дальнего конца длиннее 7 м или шкафы вдоль прохода длиннее 7 м
   *  (ПУЭ, п. 4.1.23) — в дальнем конце прохода: один ряд — в стене прохода у дальнего торца (в r.doors, kind:'entry'), два
   *  ряда — в дальнем торце по оси прохода (r.exit); там ворота — калитка в створке ворот (gates.wicket), дверь-жалюзи ДГУ —
   *  выход через неё */
  second(r, geo){
    const L=geo.int[0], x0=geo.x0||0, E=StationLayout.ENTRY, eh=StationMatrix.door().h+100, n=StationLayout.n, X=StationMatrix.exits(), { gap, eL }=StationLayout.gaps(geo), aR=Math.max(E[0], eL);
    if (r.cross){   // без сквозного прохода: вторая дверь оператора — во второй части (за агрегатом поперёк)
      const C=r.cross, w=E[1]-E[0]; r.second=`сквозного прохода нет — поз. ${C.pos} стоит поперёк станции: к нему сзади и к оборудованию за ним`;
      let a=L-aR-w; for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+gap && a+w>d.x0-gap) a=d.x0-gap-w;
      if (a>=C.x1+100){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[r.second] }); return; }
      const G=r.gates2 && r.gates2.wall==='right' ? r.gates2 : r.gates; if (G && G.wall==='right' && !G.sea && G.w/2>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, G.w/2-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; }
      r.exit=this.endExit(r, geo, 'right'); return; }
    // выходы: дверь оператора, монтажные ворота в торце (открываются наружу) и дверь-жалюзи ДГУ
    // ресиверы в два ряда поперёк в конце ряда — к дальнему торцу не пройти: ворота там — не выход, вторая дверь — до них
    const pe=r.items.filter(i=>i.pairEnd), lim=pe.length ? Math.min(...pe.map(i=>i.x))-200 : L;
    const es=this.entrySpan(r, geo), at=[], en=r.door==='side' ? (es[0]+es[1])/2 : x0;
    at.push(en); for (const G of [r.gates, r.gates2]) if (G && !(pe.length && G.wall==='right')) at.push(G.wall==='left' ? 0 : L);
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)) at.push(L);   // дверь-жалюзи ДГУ — выход
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && i.x-x0<=600 && i.rad==='left')) at.push(x0);   // и у ближнего торца (две ДГУ у торцов — решение владельца 19.10: вторая дверь оператора лишняя)
    // вторая дверь оператора — только если до выхода далеко (exits.far) или ряд шкафов длиннее 7 м (ПУЭ, п. 4.1.23); «выходов не
    // меньше 2» и «между выходами 5 м» её больше не требуют (решение владельца 19.10: «тут лишняя дверь оператора, достаточно одной»)
    const far=Math.round(Math.max(Math.min(...at.map(a=>Math.abs(a-x0))), Math.min(...at.map(a=>Math.abs(L-a)))));
    const cab=this.eq.filter(e=>e.kind==='cabinet').reduce((s, e)=>s+e.l*(e.qty||1), 0);
    const why=far>X.far ? `от дальней точки помещения до выхода — ${n(far)} мм, больше ${n(X.far)} мм`
      : cab>StationNorms.SHIELD ? `шкафы вдоль прохода — ${n(cab)} мм, длиннее 7 м (ПУЭ, п. 4.1.23)` : ''; if (!why) return;
    r.second=why;
    if (r.door==='side'){ const w=E[1]-E[0];
      let a=Math.min(L-aR-w, lim-w); for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+gap && a+w>d.x0-gap) a=d.x0-gap-w;
      if (a>=es[1]+Math.max(1000, gap)){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[why] }); return; } }
    if (pe.length){   // дальний торец закрыт ресиверами — калитка и дверь там не выход; второй выход — ворота у входа
      if (r.gates && r.gates.wall==='left' && r.issues) r.issues.push({ level:'info', text:`Выходы — дверь оператора и ворота в торце у входа: дальний торец закрыт ресиверами в два ряда, второй двери оператора до них места нет (${why}).` });
      delete r.second; return; }
    const G=[r.gates, r.gates2].find(g=>g && g.wall==='right' && !g.sea);
    if (G && !(r.gates && r.gates2)){ const lw=G.w/2; if (lw>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, lw-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; } }
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)){ r.secondDgu=true; return; }   // выход — через дверь-жалюзи ДГУ
    if (!G) r.exit=this.endExit(r, geo, 'right');
  }
  /** дверь оператора в торце по оси прохода: одностворчатая, наружу, с доводчиком */
  endExit(r, geo, wall){
    const W=geo.int[1], E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.gaps(geo).eW }, w=E[1]-E[0];
    if (r.cross && !r.items.some(i=>(i.mount==='floor' || i.mount==='frame') && !i.cross && i.x>=r.cross.x1)){ const y0=Math.round((W-w)/2); return { wall, y0, y1:y0+w, w, h:D.h }; }
    const y0=StationLayout.inWall(this.aisleMid(r, W)-w/2, w, W, D.pad);
    return { wall, y0, y1:y0+w, w, h:D.h };
  }
  /** у каждой ДГУ напротив радиатора — двустворчатая дверь-жалюзи: выброс горячего воздуха и проём для монтажа и демонтажа ДГУ
   *  (шире её на 200 мм, выше на 150 мм): в дальнем торце (rad right), в торце у входа (left) или в задней стене (поперёк, back).
   *  [{wall, y0, y1 (торец) | x0, x1 (задняя стена), w, h, leaves:2, pos, unit, fits}] — радиатор дальше 600 мм от стены — нет */
  /** ширина двери-жалюзи ДГУ по её стороне напротив радиатора, мм: +200 мм, шаг 100, не уже сервисной двери */
  static dguDoorW(len){ return Math.max(StationLayout.DOOR.min, Math.ceil((len+200)/100)*100); }
  dguDoors(r, geo){
    const [L, W, H]=geo.int, x0=geo.x0||0, out=[], hD=g=>Math.min(H-100, Math.max(StationLayout.DOOR.h, g.h+150));
    for (const g of r.items.filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor')){
      const rad=g.rad || 'right';
      if (rad==='back'){ if (W-(g.y+g.ly)>600) continue; const pad=StationLayout.gaps(geo).eL, w=Math.min(L-x0-2*pad, StationLayout.dguDoorW(g.lx)), a=Math.round(Math.max(x0+pad, Math.min(L-pad-w, g.x+g.lx/2-w/2)));
        out.push({ wall:'back', x0:a, x1:a+w, w, h:hD(g), leaves:2, pos:g.pos, unit:g.unit, fits:w>=g.lx+2*StationLayout.PASS }); continue; }
      if (rad==='right' ? L-(g.x+g.lx)>600 : g.x-x0>600) continue;
      const pad=StationLayout.gaps(geo).eW, w=Math.min(W-2*pad, StationLayout.dguDoorW(g.ly)), y0=Math.round(Math.max(pad, Math.min(W-pad-w, g.y+g.ly/2-w/2)));
      out.push({ wall:rad==='left' ? 'left' : 'right', y0, y1:y0+w, w, h:hD(g), leaves:2, pos:g.pos, unit:g.unit, fits:w>=g.ly+2*StationLayout.PASS }); }
    return out;
  }

  /** ресиверы снаружи (ФНП ОРПД, п. 65) — на бетонной площадке за дальним торцом, где выходит трубопровод: первый — по оси
   *  выхода, следующие — к стене прохода через 600 мм; не помещаются по ширине контейнера — следующий ряд дальше от стены.
   *  Координаты — как у оборудования внутри (от внутренних стен и пола): x за торцом, z — от площадки на земле */
  outside(plan, chassis){
    const E=this.eq.filter(e=>e.outside); if (!E.length) return [];
    const [L, W]=plan.int, ext=plan.geo.ext, ox=(ext[0]-L)/2, oy=(ext[1]-W)/2, zf=StationGeo.zFloor(plan.geo.type), C=StationLayout;
    const air=(plan.piping||[]).flatMap(p=>p.lines||[]).filter(l=>l.medium==='air' && !l.header && l.x1>=L-1), yc=air.length ? air[0].y : W-C.AIR_Y;
    const lo=-oy, hi=W+oy, first=ly=>Math.round(Math.min(hi-ly, Math.max(lo, yc-ly/2))), out=[];
    let x=L+ox+C.OUT_GAP, top=null, col=0;
    for (const e of E) for (let k=0; k<e.qty; k++){
      const lx=e.l, ly=e.w; let y=top==null ? first(ly) : top-C.OUT_STEP-ly;
      if (top!=null && y<lo){ x+=col+C.OUT_STEP; col=0; y=first(ly); }
      top=y; col=Math.max(col, lx);
      out.push(this.unitItem(e, { unit:k, x:Math.round(x), y, z:-(zf+(chassis ? C.CHASSIS_H : 0))+C.PAD, mount:'out', face:-2, air:AirChain.unit(e.air, k) })); }
    return out;
  }

  /** на крыше: глушитель ДГУ — прямо над ДГУ (по центру его длины и ширины), на опорах, вывод выхлопа — вбок; выхлопная
   *  труба — от двигателя вертикально сквозь крышу в глушитель */
  roof(plan){
    const ms=this.eq.filter(e=>e.kind==='muffler' && e.roof); if (!ms.length) return [];
    const [L, W]=plan.int, ow=plan.geo && plan.geo.ext ? (plan.geo.ext[1]-W)/2 : 100, dg=plan.items.filter(i=>i.kind==='dgu' && !i.tank).sort((a, b)=>a.x-b.x), out=[];
    // хоть у одной ДГУ глушитель на крыше — на крыше у всех (решение владельца 19.10): недостающие — как последний в составе
    const all=[]; for (const m of ms) for (let u=0; u<m.qty; u++) all.push([m, u]);
    for (let u=all.length; u<dg.length; u++){ const m=all[all.length-1][0]; all.push([m, u-all.filter(q=>q[0]!==m).length]); }
    let k=0, next=Math.max(100, L/2-ms[0].l/2);
    for (const [m, u] of all){ k++; const kk=k-1;
      const d=m.w, g=dg[kk], rad=(g && g.rad) || 'right', R={ pos:m.pos, unit:u, name:m.name, brief:m.brief, short:m.short, kind:'muffler', h:d, d, known:m.known, mass:m.mass, color:m.color,
        gap:StationLayout.ROOF_GAP, outlet:StationLayout.OUTLET, dgu:g ? { pos:g.pos, unit:g.unit } : null };
      // ДГУ поперёк — глушитель вдоль неё (по ширине станции), выхлоп — к задней стене (над радиатором)
      if (rad==='back'){ const l=Math.min(m.l, W+2*ow-80), y=Math.round(Math.max(-ow+40, Math.min(W+ow-40-l, g.y+g.ly/2-l/2))), x=Math.round(Math.max(100, Math.min(L-100-d, g.x+g.lx/2-d/2)));
        out.push({ ...R, x, y, lx:d, ly:l, dir:'y+', exhaust:{ x:Math.round(g.x+g.lx/2), y:Math.round(Math.max(y+120, Math.min(y+l-120, g.y+g.ly*0.62))), z:g.h } }); continue; }
      const l=Math.min(m.l, L-200), cx=g ? g.x+g.lx/2 : next+l/2;
      const x=Math.round(Math.max(100, Math.min(L-100-l, cx-l/2))), y=Math.round(g ? Math.max(-ow+40, Math.min(W+ow-40-d, g.y+g.ly/2-d/2)) : W/2-d/2);
      const ex=g ? Math.round(Math.max(x+120, Math.min(x+l-120, g.x+g.lx*(rad==='left' ? 0.38 : 0.62)))) : null;   // выхлоп двигателя — входит в глушитель снизу
      out.push({ ...R, x, y, lx:l, ly:d, dir:rad==='left' ? 'x-' : 'x+', exhaust:g ? { x:ex, y:Math.round(g.y+g.ly/2), z:g.h } : null });
      next=x+l+300; }
    return out;
  }
  /** станция из модулей: сведения (раскладка, размер модуля, стыковка); оборудование на стыке — ошибка (модуль везут с
   *  оборудованием внутри); стойки каркаса на пересечениях стыков — в проходе, замечание */
  modsNotes(plan){
    const g=plan.geo, m=g && g.mods; if (!m || !m.Lm) return;
    const n=StationLayout.n, iss=plan.issues=plan.issues||[], [L, W, H]=plan.int, P=StationMods.posts(g), ps=StationMods.M.post/2;
    const fl=(plan.items||[]).filter(i=>i.mount!=='wall' && i.mount!=='pipe');
    iss.push({ level:'info', mods:true, text:`Станция из модулей: ${StationMods.shape(m)} — модуль ${n(m.Lm)} × ${n(m.Wm)} × ${n(g.ext[2])} мм (в габарите перевозки, каждый везётся отдельно), вместе ${n(g.ext[0])} × ${n(g.ext[1])} мм, внутри — одно помещение ${n(L)} × ${n(W)} × ${n(H)} мм. Каждый агрегат — целиком в своём модуле. На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения), стыковые проёмы — временными щитами; модули везут с оборудованием внутри. На объекте — быстрая стыковка: соединение каркасов, уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык; стыков — ${StationMods.joints(m)}.` });
    const ws=StationMods.widths(), wl=ws[0], wh=ws[ws.length-1];
    if (m.Wm<wl || m.Wm>wh) iss.push({ level:'warn', mods:true, text:`Ширина модуля ${n(m.Wm)} мм — вне ${n(wl)}…${n(wh)} мм (модули — одной ширины, не шире габарита перевозки): уберите размер — он подберётся по оборудованию.` });
    if (m.Lm<StationMods.M.lMin) iss.push({ level:'warn', mods:true, text:`Длина модуля ${n(m.Lm)} мм — меньше ${n(StationMods.M.lMin)} мм (модуль станции из нескольких модулей — не короче; «Настройки → Правила компоновки → Станция из нескольких модулей»): уберите размер — он подберётся по оборудованию, или соберите станцию из меньшего числа модулей.` });
    if (m.Lm>StationLayout.MAX_L) iss.push({ level:'warn', mods:true, text:`Длина модуля ${n(m.Lm)} мм — больше наибольшей длины перевозки ${n(StationLayout.MAX_L)} мм.` });
    const on=StationMods.cross(plan.items, g);
    if (on.length){ plan.level='error'; iss.push({ level:'error', mods:true, text:`Поз. ${[...new Set(on.map(i=>i.pos))].join(', ')} — на стыке модулей: модуль везут с оборудованием внутри, каждый агрегат должен быть целиком в своём модуле. Выберите другую раскладку или размер модуля по оборудованию («Модули…»).` }); }
    for (const p of P){ const hit=StationMods.hits(fl, g).filter(i=>i.x<p.x+ps && i.x+i.lx>p.x-ps && i.y<p.y+ps && i.y+i.ly>p.y-ps);
      if (hit.length){ plan.level='error'; iss.push({ level:'error', mods:true, text:`Поз. ${[...new Set(hit.map(i=>i.pos))].join(', ')} — на стойке каркаса стыка модулей (${n(p.x)}, ${n(p.y)} мм): выберите другую раскладку модулей или измените состав.` }); }
      else iss.push({ level:'info', mods:true, text:`Стойка каркаса на пересечении стыков модулей — ${n(2*ps)} × ${n(2*ps)} мм (${n(p.x)}, ${n(p.y)} мм от угла помещения): в проходе её обходят.` }); }
  }
  /** выхлоп каждой ДГУ (решение владельца 19.10): глушитель на крыше — если он в составе для неё, иначе — вывод через стену
   *  (глушитель встроен в ДГУ, у небольших ДГУ — штатно): у ДГУ вдоль — в задней стене над двигателем, поперёк — в задней
   *  стене рядом с дверью-жалюзи; высота — над ДГУ (не выше 200 мм под потолком). [{pos, unit, how:'roof'|'wall', wall, u, z}] */
  exhausts(plan){
    const [, W, H]=plan.int, dg=(plan.items||[]).filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor'), roof=plan.roof||[];
    return dg.map(g=>{ const r=roof.find(m=>m.dgu && m.dgu.pos===g.pos && m.dgu.unit===g.unit), o={ pos:g.pos, unit:g.unit, x:Math.round(g.x+g.lx/2), y:Math.round(g.y+g.ly/2) };
      if (r) return { ...o, how:'roof' };
      const rad=g.rad || 'right', z=Math.round(Math.min(H-200, g.h+250)), d=(plan.dguDoors||[]).find(q=>q.pos===g.pos && q.unit===g.unit);
      // над турбиной двигателя (у радиатора, как рисует 3D-вид); поперёк — рядом с дверью-жалюзи
      const u=rad==='back' ? Math.round(d ? d.x1+200 : g.x+g.lx/2) : Math.round(rad==='left' ? g.x+g.lx*0.16+300 : g.x+g.lx*0.84-300);
      return { ...o, how:'wall', wall:'back', u, z, gap:Math.max(0, W-g.y-g.ly) }; });
  }

  outlet(plan){ LayoutPipes.outlet(plan, this.eq.some(e=>e.outside)); }
  static outPath(l, W){ return LayoutPipes.outPath(l, W); }
  route(plan){ return LayoutPipes.route(plan, this.eq); }

  item(it, geo){ return LayoutItem.floor(it, geo, this.G); }
  unitItem(e, o){ return LayoutItem.unit(e, o); }
  used(items, geo){ return LayoutItem.used(items, geo); }

  /** длина ряда(ов) при ширине Wi, мм: row1 — один ряд, row2 — два ряда с проходом;
   *  lvl 0 — с рекомендуемыми промежутками (без поворотов), 1 — с «не менее» (поперёк — что помещается по ширине);
   *  null — не проходит по ширине */
  need(units, Wi, arr, lvl){
    if (!units.length) return 0;
    if (this.dguSt && arr!=='row1') return null;    // ДГУ-станция — свои варианты (rowD)
    // ДГУ вдоль — посередине ширины: подбор контейнера сначала ищет ширину, где проход с обеих сторон не уже допустимого
    if (this.dguSt && this.midNeed){ const D=units.filter(e=>e.kind==='dgu'), M=StationMatrix.grp('dgu');
      if ((D.length===1 || (D.length===2 && M.two && !this.tank)) && D.some(e=>Wi<e.w+2*M.pass)) return null; }
    const r=this.dguSt ? this.rowD(units, 0, Wi) : arr==='row1' ? this.row1(units, 0, Wi, !lvl) : arr==='rowX' ? this.rowX(units, 0, Wi, !lvl) : arr==='rowE' ? this.rowE(units, 0, Wi, this.T) : this.row2(units, 0, Wi, !lvl);
    if (r.ok) return 0;
    if (!/^length/.test(r.why)) return null;
    return lvl ? (this.closeOk && r.needLc!=null ? r.needLc : r.needL) : r.needL0;
  }

  /** высота внутри, мм, нужная над сервисными воротами за агрегатами: ворота + трубопровод над ними + жалюзи выброса
   *  (короб-воздухоотвод) + зазор под потолком; ворот нет — 0 */
  overGate(r){ const D=(r.doors||[]).filter(d=>d.rear); return D.length ? Math.max(...D.map(d=>d.h))+StationLayout.OVER_GATE+StationMatrix.louvre()+this.G : 0; }
  // без продольного прохода (две пары сервисных ворот и ворота в обоих торцах — дороже) — если площадь пола меньше хотя бы
  // на fit.ends %; ресиверы парами поперёк — если станция короче хотя бы на fit.recv2 мм; два ряда — если площадь меньше
  // на fit.two % (матрица расстановки, «Настройки»)
  static get RECV2(){ return StationMatrix.fit().recv2; }
  static get ENDS_K(){ return 1-StationMatrix.fit().ends/100; }
  static get PAIR_SIDE(){ return StationMatrix.recv().pairSide; }   // ресиверы в два ряда: осмотр сбоку — через промежуток не меньше, мм
  static get OVER_GATE(){ return StationMatrix.grp('exhaust').over; }   // над сервисными воротами: перемычка и трубопровод до низа жалюзи выброса, мм
  /** блок-контейнер «по проекту» — по необходимому месту, без запаса (шаг 100 мм), всегда с проходом для оператора и
   *  обслуживания. Варианты по порядку: проход и все отступы рекомендуемые; проход и отступ от стены «не менее», промежутки
   *  рекомендуемые; всё «не менее» — в ширине, которую везут без спецразрешения; затем шире. В варианте — наименьшая площадь пола
   *  (длина × ширина); два ряда — только если заметно меньше одного (на четверть: один ряд удобнее в обслуживании и обвязке) */
  /** размер по оборудованию; ресиверы (от двух) — парами поперёк в конце ряда, если так станция короче хотя бы на fit.recv2
   *  при той же или меньшей ширине, даже с отступами «не менее» (решение владельца 19.10: «часть ресиверов — в 2 ряда для
   *  экономии длины»; раньше пары брались только в варианте с теми же отступами) */
  autoSize(units, geo){
    const r=this.autoSize0(units, geo);
    if (this.forcePairs || geo.fixL || !r.geo || !r.geo.ext || (r.items||[]).some(i=>i.pairEnd) || units.filter(e=>e.kind==='receiver' && !e.outside).length<2 || !(StationLayout.RECV2>0)) return r;
    let q=null; this.forcePairs=true; try{ q=this.autoSize0(units, geo); } finally{ this.forcePairs=false; }
    if (!q || q.level==='error' || !q.geo || !q.items.some(i=>i.pairEnd) || q.geo.ext[1]>r.geo.ext[1] || q.geo.ext[0]>r.geo.ext[0]-StationLayout.RECV2) return r;
    q.issues.push({ level:'info', text:`Ресиверы — частью в два ряда поперёк у торца: станция короче на ${StationLayout.n(r.geo.ext[0]-q.geo.ext[0])} мм (${StationLayout.n(q.geo.ext[0])} вместо ${StationLayout.n(r.geo.ext[0])} мм); отступы — допустимые («не менее»).` });
    return q;
  }
  autoSize0(units, geo){
    this.inMods=!!geo.mods; this.jGeo=null;
    const G=StationGeo, B=G.BLOCK, t=geo.t, f=G.flex(geo.type), n=StationLayout.n, x0=geo.x0||0, wallX=2*(t+f.wall), hOf=f.floor+t+f.roof;
    const floor=units.filter(e=>!e.pipe && e.mount!=='wall'), probe=floor.length ? floor : units.map(e=>Object.assign({}, e, { slot:true }));
    const g2=2*this.G, needH=lvl=>Math.max(B.hWalk, ...units.filter(e=>!e.pipe).map(e=>e.mount==='wall' ? e.h+StationLayout.CAB_LOW+150 : e.h+Math.max(this.G, e.kind==='compressor' ? e.c.top[1] : e.c.top[lvl])));
    // в габарите перевозки: как обычно (по умолчанию — сразу самая плотная компоновка: допустимые отступы и проход, решение
    // ПНЕВМОТЕХ; «просторно» — сначала рекомендуемые), затем исключения компрессорной; негабарит — последним и только
    // если он разрешён правилами (fit.wide)
    // уровень: [отступ сзади и проход, промежутки, что недопустимо в варианте]: 'rec' — всё рекомендуемое; 'gate' — без
    // сервисных ворот (они дороже: сначала шире или длиннее в пределах габарита) и с доступом ко всем сторонам; 'acc' — с
    // доступом ко всем сторонам (сервисные ворота или без продольного прохода — что меньше); '' — как вышло
    // длина задана (fixL): ширина и высота — по оборудованию, плотность — какая нужна в этой длине: сначала просторно,
    // затем плотно, затем исключения
    const F=StationMatrix.fit(), fixL=geo.fixL||0, lv=fixL ? [[0, 0, 'rec'], [1, 0, ''], [1, 1, 'gate'], [1, 1, 'acc'], [1, 1, '']] : F.dense ? [[1, 1, 'gate'], [1, 1, 'acc'], [1, 1, '']] : [[0, 0, 'rec'], [1, 0, ''], [1, 1, '']], tiers=[];
    for (const [lw, ll, st] of lv) tiers.push([lw, ll, false, {}, st]);
    for (const m of this.modes().slice(1).filter(m=>!m.ends)) tiers.push([1, 1, false, m, '']);
    // последний приём в габарите перевозки перед выносом ресиверов наружу и негабаритом (решение ПНЕВМОТЕХ: ресиверы и
    // фильтры вплотную — только если иначе станция не в габарите; отметка recv.close в «Настройках»)
    if (StationMatrix.recv().close && this.eq.some(e=>e.place && (e.kind==='receiver' || (e.kind==='filter' && !e.pipe)))) for (const m of this.modes().filter(m=>!m.ends)) tiers.push([1, 1, false, m, '', true]);
    if (F.wide) for (const [lw, ll, st] of lv) tiers.push([lw, ll, true, {}, st]);
    // расстановка в размере ext и режиме m — одна на весь подбор: уровни (tiers) и соседние варианты длины проверяют одни и те
    // же размеры (принятый вариант дописывается в done — после этого поиск заканчивается)
    const tried=new Map(), fitAt=(g, m)=>{ const k=g.ext.join('×')+JSON.stringify(m)+(this.closeAll ? 'c' : ''); let r=tried.get(k); if (!r){ r=this.fit(units, g, [m]); tried.set(k, r); } return r; };
    let tall=null;
    // ДГУ посередине ширины — только если так встаёт в габарите перевозки (иначе — ближе к задней стене, как выйдет)
    // из модулей: ширина — модуля (в габарите перевозки) × b, длина — модуля (до наибольшей) × a; негабарита нет
    const MD=geo.mods, ka=MD ? MD.a : 1, kb=MD ? MD.b : 1;
    const Wroad=G.inner(geo.type, [10000, G.ROAD_W*kb, B.maxH], t)[1]-g2, midOk=units.filter(e=>e.kind==='dgu').every(e=>e.w+2*StationMatrix.grp('dgu').pass<=Wroad);
    for (const [lw, ll, wide, m, st, close] of tiers){ if (MD && (wide || (m.ends && MD.b>1))) continue; if (this.forcePairs && (close || wide)) continue;   /* модули: без негабарита; без продольного прохода (сервисные ворота, двери оператора между компрессорами) — в один ряд модулей (решение владельца 19.10) */ this.closeAll=!!close; this.closeOk=!!close; this.midNeed=!wide && !!st && midOk; let got=null;
      try{ got=this.withMode(m, ()=>{
        const Hx=Math.max(B.minH, G.up(needH(lw)+hOf)); if (Hx>B.maxH){ tall=tall||Hx; return null; }
        const cand=[];
        const Ws=[]; if (MD) for (const Wm of StationMods.widths()) Ws.push(Wm*kb);   // модули — одинаковой ширины mods.wMin…wMax (решение владельца 19.10)
        else { for (let Wx=G.up(wide ? G.ROAD_W+1 : B.minW); Wx<=(wide ? B.maxW : G.ROAD_W); Wx+=G.STEP) Ws.push(Wx);
          if (!wide && Ws[Ws.length-1]<G.ROAD_W) Ws.push(G.ROAD_W); }   // наибольшая ширина без спецразрешения — 2 550 мм (не кратна 100)
        const LX=L=>ka*Math.max(B.minL, MD ? StationMods.M.lMin : 0, G.up((L+g2+x0+wallX)/ka));   // длина станции: у модулей — модуль с шагом 100 мм × a
        for (const Wx of Ws){
          const Wi=G.inner(geo.type, [10000, Wx, Hx], t)[1];
          // без продольного прохода — ради габарита перевозки: только если с проходом всё рекомендуемое не вышло, и в наибольшей
          // ширине без спецразрешения (уже — плотнее без нужды)
          for (const arr of ['row1', 'row2', ...(m.cross ? ['rowX'] : []), ...(this.comp && lw && !m.cross && !x0 && (!MD || MD.b===1) && Wx===G.ROAD_W*kb && StationMatrix.modes().ends ? ['rowE'] : [])]){
            const L=this.need(probe, Wi-g2, arr, ll); if (L==null) continue;
            const Lx=LX(L); if (fixL && Lx>fixL) continue;
            if (Lx<=StationLayout.MAX_L*ka && !this.forcePairs) cand.push({ Lx, Wx, two:arr==='row2', a:Lx*Wx/(arr==='row2' ? 1-F.two/100 : arr==='rowE' ? StationLayout.ENDS_K : 1), m:arr==='rowE' ? { ...m, ends:true } : m });
            // ресиверы в два ряда в конце ряда (поперёк) — если станция так заметно короче
            // (и если без них длиннее наибольшей длины — иначе станция не помещается вовсе)
            if (arr==='row1'){ this.recv2=true; let L2=null; try{ L2=this.need(probe, Wi-g2, arr, this.forcePairs ? 1 : ll); } finally{ this.recv2=false; }
              const Lx2=L2==null ? null : LX(L2); if (Lx2!=null && (this.forcePairs || Lx2<=Lx-StationLayout.RECV2 || Lx>StationLayout.MAX_L*ka) && !fixL) cand.push({ Lx:Lx2, Wx, two:false, a:Lx2*Wx, m }); }
          } }
        cand.sort((p, q)=>p.a-q.a || p.Lx-q.Lx);
        const seen=new Set();
        const done=(r, g2, Wx)=>{ r.geo=g2; r.picked=true;
          r.density=StationLayout.density(lw, m, r, wide);
          if (close) r.density={ id:'max', title:'Максимально плотно', text:[r.density.id==='max' ? r.density.text : '', 'ресиверы и фильтры вплотную'].filter(Boolean).join(', ') };
          if (fixL) r.issues.push({ level:'info', fixL:true, text:`Длина задана: ${n(fixL)} мм — компоновка «${r.density.title}» (${r.density.text}); ширина и высота — по оборудованию.` });
          StationLayout.soft(r);
          if (close) r.issues.push({ level:'warn', close:true, text:'Ресиверы и фильтры стоят вплотную друг к другу (промежутки — меньше «плотно» в правилах компоновки): исключение, чтобы станция прошла по габариту перевозки и ресиверы остались внутри (решение ПНЕВМОТЕХ: вплотную — только если иначе не в габарите). Осмотр — спереди и сбоку, через промежутки пар.' });
          if (wide) r.issues.push({ level:'warn', wide:true, text:`Негабарит: ширина ${n(Wx)} мм — шире габарита перевозки (без спецразрешения — до ${n(G.ROAD_W)} мм). Исключение: в ${n(G.ROAD_W)} мм не помещается даже плотно и без продольного прохода — перевозка со спецразрешением; иначе — две станции или меньше оборудования.` });
          return r; };
        // шкафы заняли торцы, и демонтаж — через сервисные ворота в боковой стене (дорого): сначала — длиннее или шире (площадь —
        // до 1,2 от первого варианта), чтобы шкафы встали на стену прохода, а ворота — в торец; не вышло — первый вариант
        let alt=null, pick=null;   // pick — аккуратнейший из равных по площади (у модулей — и чуть длиннее, look.modStep)
        const T=StationTidy.M, extra=MD ? T.modStep*G.STEP*ka : 0;
        const take=(r, g2, Wx, Lx)=>{ const sc=StationTidy.score(r, g2).score, area=Lx*Wx;
          if (!pick) pick={ r, g2, Wx, sc, area, Lx, lim:Lx+extra }; else if (sc>pick.sc+2 && area<=pick.area+extra*Wx) Object.assign(pick, { r, g2, Wx, sc, Lx }); };
        for (const c of cand){ if (alt && c.a>alt.a*1.2) break; if (pick && (!T.tidy || c.Lx*c.Wx>pick.area+extra*c.Wx)) break; const key=c.Lx+'×'+c.Wx+(c.m.ends ? 'E' : ''); if (seen.has(key)) continue; seen.add(key);
          for (let Lx=fixL || c.Lx; Lx<=(fixL || Math.min(StationLayout.MAX_L*ka, c.Lx+(MD ? 1500*ka+3000 : 1500))); Lx+=G.STEP*ka){   // у модулей — дальше: стойку стыка обойти   // шкафам и фильтрам может понадобиться место в ряду
            let g2=Object.assign({}, geo, { auto:false, road:true, ext:[Lx, c.Wx, Hx], ...(MD ? { mods:{ ...MD, Lm:Lx/ka, Wm:c.Wx/kb } } : {}) }); g2.int=G.inner(geo.type, g2.ext, t);
            let r=fitAt(g2, c.m); if (r.level==='error') continue;
            if (MD && StationMods.cross(r.items, g2).length) continue;   // на стыке модулей — длиннее или другая ширина (каждый агрегат — целиком в своём модуле)
            // сервисные ворота за агрегатом: над ними — трубопровод и выброс горячего воздуха коробом (решение ПНЕВМОТЕХ) —
            // контейнер выше, если места над воротами мало
            const up=this.overGate(r); if (up>g2.int[2]){ const H2=G.up(up+hOf);
              if (H2<=B.maxH){ const g3=Object.assign({}, g2, { ext:[Lx, c.Wx, H2] }); g3.int=G.inner(geo.type, g3.ext, t); const r3=fitAt(g3, c.m); if (r3.level!=='error'){ r=r3; g2=g3; } } }
            if (c.two && r.rows===1) break;                                          // вышел один ряд — его место среди однорядных
            if (this.forcePairs && !r.items.some(i=>i.pairEnd)) break;                // ресиверы парами: длиннее — уже не парами
            const w=r.issues.filter(i=>i.level==='warn').map(i=>i.text);
            if (st==='rec' && (w.some(x=>/^Проход|стоит в/.test(x)) || r.items.some(i=>i.tight))) break;   // рекомендуемые проход и отступ сзади не вышли — другая ширина
            if (st==='gate' && r.items.some(i=>i.ends)) break;   // без продольного прохода — не в этом уровне
            if (st==='gate' && (r.items.some(i=>i.tight) || (r.doors||[]).some(d=>d.kind!=='entry'))) continue;   // без сервисных ворот и дверей не вышло — длиннее (без поворота агрегата) или другая ширина
            // не ко всем сторонам есть доступ — длиннее (промежутки растут); сразу другая ширина давала станцию больше при
            // меньших отступах в правилах
            if ((st==='gate' || st==='acc' || close) && w.some(x=>/не подойти/.test(x))) continue;   // вплотную — только если к ресиверам и фильтрам остаётся подход
            if (ll===0 && w.some(x=>/^Промежутки|^Отступы/.test(x))) continue;      // промежутки — длиннее (место шкафу или фильтру в ряду)
            if ((r.doors||[]).some(d=>(d.why||[]).some(x=>/торцы заняты шкафами/.test(x)))){ alt=alt || { r, g2, Wx:c.Wx, a:c.a }; continue; }
            if (!T.tidy && !extra) return done(r, g2, c.Wx);
            take(r, g2, c.Wx, Lx);
            if (!extra || Lx>=pick.lim) break;   // у модулей — ещё до look.modStep шагов длиннее: стык между группами, массы ровнее
          } }
        if (pick) return done(pick.r, pick.g2, pick.Wx);
        return alt ? done(alt.r, alt.g2, alt.Wx) : null; }); }
      finally{ this.closeAll=false; this.midNeed=false; }
      if (got) return got; }
    if (fixL){ const r0=this.autoSize(units, { ...geo, fixL:null }), L0=r0.geo && r0.geo.ext ? r0.geo.ext[0] : null;
      return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text:L0 ? `В заданную длину ${n(fixL)} мм оборудование не помещается даже максимально плотно — в габарите перевозки нужно не меньше ${n(L0)} мм. Увеличьте длину или уберите её (размер — по оборудованию).` : `В заданную длину ${n(fixL)} мм оборудование не помещается. ${r0.issues && r0.issues[0] ? r0.issues[0].text : ''}` }] }; }
    if (MD) return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text:`В раскладке «${StationMods.shape(MD)}» оборудование не помещается (модуль — до ${n(G.ROAD_W)} мм по ширине и ${n(StationLayout.MAX_L)} мм по длине, высота — до ${n(B.maxH)} мм): выберите другую раскладку или больше модулей («Модули…»).` }] };
    const Wi=G.inner(geo.type, [10000, F.wide ? B.maxW : G.ROAD_W, B.maxH], t)[1];
    const wideOk=this.need(probe, Wi-g2, 'row1', 1)!=null;
    const text=!F.wide && !wideOk ? `Оборудование с проходом для оператора и обслуживания не проходит по ширине перевозки ${n(G.ROAD_W)} мм, а негабарит отключён в правилах компоновки («Настройки → Инженерные правила станций») — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`
      : tall && !wideOk ? `Оборудование не помещается в блок-контейнер высотой до ${n(B.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`
      : !wideOk ? `Оборудование с проходом для оператора и обслуживания не проходит по ширине даже в блок-контейнере шириной ${n(B.maxW)} мм.`
      : `Оборудование не помещается в один блок-контейнер длиной до ${n(StationLayout.MAX_L)} мм — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
    return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text }] };
  }

  /** контейнер, в который всё поместится с проходом: морской — следующий по размеру, иначе блок-контейнер с подобранным
   *  размером */
  suggest(units, geo){
    if (geo.sea && !geo.own){
      let warnFit=null; const cur=StationGeo.SEA[geo.type];
      for (const M of [[{}], this.modes()]){   // сначала как обычно, затем — с исключениями (без продольного прохода, проход «в крайнем случае», без сквозного прохода)
        for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t]; if (t===geo.type || (s.ext[0]<=cur.ext[0] && s.ext[2]<=cur.ext[2])) continue;   // не больше — не поможет
          const r=this.fit(units, this.geoOf({ ctype:t, ins:geo.t+' мм' }), M);
          if (r.level==='ok') return { ctype:t, level:'ok' }; if (r.level==='warn' && !warnFit) warnFit={ ctype:t, level:'warn' }; }
        if (warnFit) return warnFit; }
    }
    const type=StationGeo.FLEX[geo.type] ? geo.type : 'block', r=this.autoSize(units, this.geoOf({ ctype:type, ins:geo.t+' мм', sizeAuto:true }));
    return r.level==='error' ? null : { ctype:type, size:r.geo.ext, level:r.level };
  }

  /** контейнер с большим запасом: морской — меньший морской, в который всё помещается не хуже; блок-контейнер со своим
   *  размером — размер по оборудованию. Подсказка и кнопка «заменить» */
  excess(units, geo, plan){
    const n=StationLayout.n, rank={ ok:0, warn:1 }, lv=plan.issues.some(i=>i.level==='warn') ? 1 : 0;
    if (geo.sea && !geo.own){
      const cur=StationGeo.SEA[geo.type];
      for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t];
        if (t===geo.type || s.ext[0]>cur.ext[0] || s.ext[2]>cur.ext[2] || (s.ext[0]===cur.ext[0] && s.ext[2]===cur.ext[2])) continue;
        const r=this.fit(units, this.geoOf({ ctype:t, ins:geo.t+' мм' }), [{}]);   // меньший — только без исключений
        if (r.level==='error' || rank[r.level]>lv) continue;
        plan.suggest={ ctype:t, level:r.level, smaller:true };
        plan.issues.push({ level:'warn', big:true, text:`Контейнер с запасом: всё помещается в морской контейнер ${s.label} — меньше по размеру, массе и цене.` });
        return; }
    } else if (geo.own && StationGeo.FLEX[geo.type]){
      const r=this.autoSize(units, this.geoOf({ ctype:geo.type, ins:geo.t+' мм', sizeAuto:true }));
      if (r.level==='error' || !r.geo || !r.geo.ext || rank[r.level]>lv) return;
      const e=r.geo.ext; if (geo.ext[0]-e[0]<500 && geo.ext[1]-e[1]<300 && geo.ext[2]-e[2]<300) return;
      plan.suggest={ ctype:geo.type, size:e, level:r.level, smaller:true };
      plan.issues.push({ level:'info', big:true, text:`Размер задан с запасом: по оборудованию достаточно ${n(e[0])} × ${n(e[1])} × ${n(e[2])} мм.` });
    }
  }

  /** окраска контейнера (StationPaint): стены, каркас, крыша, двери и ворота, пол (null — по материалу); не указана —
   *  RAL 7035 / RAL 5005 условно; рисунки заказчика — на стенах снаружи */
  colors(){
    const c=this.cont||{}, k=StationPaint.colors(c);
    return { wallColor:k.wall, frameColor:k.frame, roofColor:k.roof, doorColor:k.door, floorColor:k.floor, colorKnown:k.known, colorText:StationPaint.short(c),
      arts:StationPaint.arts(c), sys:c.sys||null };
  }

  /** сведения: условные габариты, что не попало на чертёж */
  notes(plan){
    const iss=plan.issues, nm=e=>`поз. ${e.pos} «${e.short}»`, n=StationLayout.n;
    const tk=this.eq.filter(e=>e.place && !e.known && e.kind==='tank');
    if (tk.length) iss.push({ level:'info', text:`Габариты бака — по расчётному объёму (прямоугольный, стенка ${n(StationMatrix.tank().wall)} мм; требует подтверждения изготовителем бака): ${tk.map(e=>`${nm(e)} ${e.vol ? n(e.vol)+' л — ' : ''}${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ')}. Свои размеры — строкой «Габариты» в составе станции.` });
    const g=this.eq.filter(e=>e.place && !e.known && e.kind!=='tank'); if (g.length) iss.push({ level:'info', text:`Габариты не указаны в характеристиках — взяты условные: ${g.map(e=>`${nm(e)} ${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ')}. Укажите размеры в составе станции (характеристики элемента).` });
    const nd=this.eq.filter(e=>e.nodims); if (nd.length) iss.push({ level:'info', text:`Не размещены — нет габаритов: ${nd.map(e=>'«'+e.name+'»').join(', ')}.` });
    // ресиверы снаружи: площадка, подключение; при морозе — конденсат, если воздух не осушен адсорбционным осушителем
    const out=plan.outside||[];
    if (out.length){ const P=[...new Set(out.map(i=>i.pos))].join(', '), D=this.eq.filter(e=>e.kind==='dryer' && e.air && e.air.type!=='gen');
      iss.push({ level:'info', text:`${out.length>1 ? 'Ресиверы' : 'Ресивер'} поз. ${P} — снаружи, на бетонной площадке в ${n(StationLayout.OUT_GAP)} мм от дальнего торца (ФНП ОРПД, п. 65): трубопровод — через стену с запорной арматурой, на ресивере — предохранительный клапан и манометр, площадка — с ограждением от наезда.` });
      if (!D.length) iss.push({ level:'warn', text:`Ресивер снаружи без осушителя: зимой конденсат в ресивере и отводе замерзает — нужен обогреваемый отвод конденсата (греющий кабель, теплоизоляция) или осушитель перед ресивером.` });
      else if (!D.some(e=>e.air.type==='ads')) iss.push({ level:'info', text:`Ресивер снаружи после рефрижераторного осушителя (точка росы +3 °C): при морозе в нём выпадает и замерзает конденсат — нужен обогреваемый отвод конденсата или адсорбционный осушитель (точка росы −40 °C).` });
      if (plan.chassis) iss.push({ level:'info', text:`Станция на шасси: ресивер снаружи перевозится отдельно и ставится на площадку на объекте.` }); }
    if (plan.fuel){ const P=[...new Set((plan.items||[]).filter(i=>i.tank).map(i=>i.pos))].join(', ');
      const F=plan.fuel, G=F.gate, fw={ left:'в торце', front:'в стене с дверью оператора', back:'в задней стене' }[F.fill.wall];
      iss.push({ level:'info', text:`Топливный бак поз. ${P} — в отдельном отсеке у торца: противопожарная перегородка 1-го типа (EI 45) без проёмов, топливопровод — через гильзу с уплотнением; вход в отсек — ${G ? `двустворчатые ворота в торце ${n(G.w)} × ${n(G.h)} мм (монтаж и замена бака)` : plan.geo && plan.geo.sea ? 'штатные двери контейнера' : 'своя дверь снаружи'}; заливная горловина — ${fw}, утоплена в стену: ниша с лючком заподлицо под замок (ничего не выступает, габарит не меняется); дыхательный клапан с огнепреградителем — над крышей; бак — в поддоне на полный объём; в отсеке — естественная вентиляция.` }); }
    StationHeat.notes(plan);
    // учёт в Ростехнадзоре — по произведению давления на вместимость
    const V=(plan.vessels||[]).filter(v=>v.pv!=null), reg=V.filter(v=>v.reg), free=V.filter(v=>!v.reg);
    if (reg.length) iss.push({ level:'info', text:`Подлежат учёту в Ростехнадзоре (ФНП ОРПД, п. 223: p·V больше 1,0 МПа·м³): ${reg.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}. Регистрация, техническое освидетельствование и ответственные за исправное состояние — у эксплуатирующей организации${reg.some(v=>!v.out) ? '; размещают на открытой площадке или в отдельном здании, в помещении — когда иначе нельзя (п. 65): «Ресивер снаружи» — в требованиях заказчика на вкладке «Состав станции»' : ''}.` });
    if (free.length) iss.push({ level:'info', text:`Учёту в Ростехнадзоре не подлежат (p·V не больше 1,0 МПа·м³): ${free.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}.` });
    const rf=plan.roof||[]; if (rf.length && plan.geo && plan.geo.ext){
      const top=Math.max(...rf.map(m=>m.gap+m.d)), h=plan.geo.ext[2]+Math.max(top, plan.geo.rise||0), ch=plan.chassis ? StationLayout.CHASSIS_H : 0;
      iss.push({ level:'info', text:`Глушитель на крыше над ДГУ, выхлоп — горизонтально в сторону (не вверх): высота станции с глушителем ${n(h)} мм${ch ? ` (на шасси — ${n(h+ch)} мм)` : ''}. Глушитель съёмный: при перевозке его снимают и ставят на объекте — высота с платформой не более ${n(StationLayout.ROAD_H)} мм.` });
      const mq=this.eq.filter(e=>e.kind==='muffler' && e.roof).reduce((s, e)=>s+e.qty, 0);
      if (rf.length>mq) iss.push({ level:'warn', text:`Глушитель на крыше — у каждой ДГУ (если хоть у одной он на крыше): в составе ${mq} шт., нужно ${rf.length} — увеличьте количество «${rf[0].name}» до ${rf.length}.` });
      if (rf.some(m=>!m.known)) iss.push({ level:'info', text:`Размер глушителя не указан — взят условный по мощности ДГУ: ${[...new Set(rf.filter(m=>!m.known).map(m=>`поз. ${m.pos} — ${n(Math.max(m.lx, m.ly))} × Ø${n(m.d)} мм`))].join('; ')}.` }); }
    // выхлоп каждой ДГУ: без своего глушителя на крыше — через стену (глушитель встроен в ДГУ)
    const exW=(plan.exhausts||[]).filter(e=>e.how==='wall'), dgN=(plan.exhausts||[]).length;
    if (exW.length) iss.push({ level:'info', text:`Выхлоп ${exW.length===dgN ? (dgN>1 ? 'всех ДГУ' : 'ДГУ') : exW.length>1 ? `${exW.length} ДГУ` : 'одной ДГУ'} — через заднюю стену (у каждой — свой вывод, над ДГУ на высоте ${[...new Set(exW.map(e=>n(e.z)))].join(' / ')} мм): глушителя на крыше для ${exW.length>1 ? 'них' : 'неё'} в составе нет — глушитель встроен в ДГУ (у небольших ДГУ — штатно). Проходка — через гильзу с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с дождевым колпаком; не напротив приточных жалюзи и дверей. Если встроенного глушителя нет — добавьте в состав «Глушитель на крыше» (по одному на ДГУ).` });
    const hang=(plan.items||[]).filter(i=>i.mount==='pipe' && !i.unit);
    for (const pp of plan.piping||[]){
      if (pp.implicit){ iss.push({ level:'info', text:`Фильтры (${hang.map(i=>'поз. '+i.pos).join(', ')}) висят на трубопроводе, а трубопроводной обвязки в составе нет — добавьте элемент «Трубопроводная обвязка и запорная арматура».` }); continue; }
      if (!pp.mat) iss.push({ level:'info', text:`Материал трубопровода (поз. ${pp.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='dgu')) iss.push({ level:'warn', text:`Топливопровод (поз. ${pp.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='compressor')) iss.push({ level:'info', text:`Полипропилен для сжатого воздуха (поз. ${pp.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.` });
    }
  }

  /** 12345 → «12 345» */
  static n(v){ const s=String(Math.round(v)); return s.length<4 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
}
