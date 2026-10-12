// Расчёт модульной станции (компрессорной и ДЭС) — по требованиям заказчика (x.req), составу станции из каталога и
// файлу инженерных правил (StationRules). Каждый шаг — исходные данные, формула, коэффициенты (с правилом и его
// источником), результат, выбранная позиция и запас в %. Ошибки (станция не пройдёт) и предупреждения — отдельно;
// правила со статусом «требует подтверждения» и данные, которых нет в каталоге, — отдельным списком. Недобор в пределах
// погрешности данных (правило calc.tolerance) — не ошибка; вопросы заказчику — только без ответа на которые станцию не
// подобрать, остальное — «можно уточнить позже» (расчёт берёт значение по умолчанию с запасом).
// Классы: CalcNote (записка), AirDemand (потребность → FAD), PressureBudget (давление и потери), DryerSizing, FilterSizing,
// ReceiverSizing, VentSizing (жалюзи), ElectricLoad (мощность, ток, пуск), GensetSizing (ДГУ), StationCalc (весь расчёт, вкладка и КП).
'use strict';

// ---------------------------------------------------------------- расчётная записка: шаги, замечания, допущения
class CalcNote {
  /** «Осушитель …», если название не начинается с этого слова */
  static lbl(word, name){ return String(name||'').toLowerCase().startsWith(word.toLowerCase().slice(0, 5)) ? name : word+' '+name; }
  constructor(){ this.sections=[]; this.cur=null; this.issues=[]; this.weak=new Map(); this.assumptions=[]; this.questions=[]; this.later=[]; this.used=new Set(); }
  static f(v, d=2){ if (v==null || !Number.isFinite(+v)) return '—'; const k=Math.pow(10, d), s=String(Math.round(+v*k)/k); return s.replace('.', ',').replace(/^-/, '−'); }
  static pct(a, b){ return b>0 ? Math.round((a/b-1)*1000)/10 : null; }
  section(id, title){ this.cur={ id, title, steps:[] }; this.sections.push(this.cur); return this; }
  /** значение правила; правило со статусом «требует подтверждения» — в список */
  rule(id){ this.used.add(id); const r=StationRules.rule(id);
    if (r.status==='unconfirmed' && !this.weak.has(id)) this.weak.set(id, { id, title:r.title, src:StationRules.src(id), note:r.note||'' });
    return r.value; }
  /** шаг: {what, formula, data:[[подпись, значение]], rules:[id], result, ok — true / false / null, margin — %, pick, note} */
  step(o){ if (!this.cur) this.section('misc', 'Прочее'); o.rules=(o.rules||[]).filter(Boolean); this.cur.steps.push(o); return o; }
  issue(level, text){ this.issues.push({ level, text, sec:this.cur ? this.cur.id : '' }); }
  /** хватает ли с учётом погрешности данных (calc.tolerance): ok — не меньше нужного за вычетом допуска (незначительный
   *  недобор трактуется в пользу заказчика — не ошибка и не вопрос), edge — в допуске, но меньше нужного; note — пояснение */
  fits(have, need){ const t=this.rule('calc.tolerance'), ok=have>=need*(1-t)-1e-9, edge=ok && have<need-1e-9;
    return { ok, edge, note:edge ? `На пределе: недобор ${CalcNote.f((1-have/need)*100, 1)} % — в пределах погрешности данных каталога; при желании — следующий типоразмер.` : '' }; }
  /** данных нет в каталоге или в ТЗ — пункт «требует подтверждения»; вопрос по нему — «можно уточнить позже»
   *  (расчёт уже взял значение с запасом в пользу заказчика) */
  missing(key, text, ask){ if (!this.weak.has(key)) this.weak.set(key, { id:key, title:text, src:'нет данных', note:'' }); if (ask) this.ask(ask, true); }
  assume(text){ if (!this.assumptions.includes(text)) this.assumptions.push(text); }
  /** вопрос заказчику: обязательный — без ответа станцию не подобрать (производительность, давление, мощность нагрузки);
   *  later — уточнение, без которого расчёт идёт по умолчанию */
  ask(text, later){ const L=later ? this.later : this.questions; if (!L.includes(text)) L.push(text); }
  result(){
    const err=this.issues.filter(i=>i.level==='error'), warn=this.issues.filter(i=>i.level==='warn');
    return { sections:this.sections.filter(s=>s.steps.length), issues:this.issues, errors:err, warnings:warn, weak:[...this.weak.values()],
      assumptions:this.assumptions, questions:this.questions, later:this.later, rules:[...this.used], version:StationRules.version(), ok:!err.length };
  }
}

// ---------------------------------------------------------------- исходные данные расчёта
class CalcInput {
  static num(v){ const n=parseFloat(String(v??'').replace(/\s+/g, '').replace(',', '.').replace(/[−–]/g, '-').replace(/^\+/, '')); return Number.isFinite(n) ? n : null; }
  /** {kind, req — числа, cls, units — элементы состава по видам, parts} */
  static of(x){
    const r=StationReq.of(x), n=this.num, P=kitParts(x).filter(p=>p.role!=='container');
    const units=P.map(p=>{ const kind=StationEquip.kindOf(p), info=/^(compressor|dryer|filter|receiver)$/.test(kind) ? AirChain.info(p, kind) : {};
      return { p, kind, qty:Math.max(1, Math.min(20, Math.round(+p.qty||1))), info, name:String(p.name||'').trim(), attrs:p.attrs||{}, rows:p.rows||[] }; });
    return { kind:StationReq.kind(x), cls:StationUi.opts(x).air || '', units, parts:P,
      req:{ flow:n(r.flow), pressure:n(r.pressure), basis:r.basis==='normal' ? 'normal' : 'fad', alt:n(r.alt), rh:n(r.rh), margin:n(r.margin),
        reserve:r.reserve!=null && r.reserve!=='' ? Math.max(0, Math.round(n(r.reserve)||0)) : null, work:n(r.work), tmin:n(r.tmin), tmax:n(r.tmax), tin:n(r.tin),
        kw:n(r.kw), load:n(r.load), hours:n(r.hours), motor:n(r.motor), start:r.start||'', recvVol:n(r.recvVol), mode:r.mode||'' } };
  }
  /** строка характеристик по ключу (рег. выражение) → число в единицах строки; unitRx — единица должна совпасть */
  static row(u, keyRx, unitRx){ for (const r of u.rows||[]){ if (!r || !keyRx.test(String(r.k||''))) continue; const t=String(r.k||'')+' '+String(r.v||'');
    if (unitRx && !unitRx.test(t)) continue; const v=AirChain.first(r.v); if (v!=null) return { v, t }; } return null; }
  /** перепад давления элемента по паспорту, бар (строка «перепад…», мбар или бар) */
  static dp(u){ const r=this.row(u, /перепад|потер[ия]\S* давлени/i); if (!r) return null; return /мбар|mbar/i.test(r.t) ? r.v/1000 : /кпа/i.test(r.t) ? r.v/100 : r.v; }
}

// ---------------------------------------------------------------- потребность → производительность компрессоров (FAD)
// ISO 1217: производительность (FAD) — объём при условиях всасывания. Потребность в н. м³ (0 °C, 101,325 кПа, сухой
// воздух — ГОСТ 2939-63) переводится в FAD по давлению на высоте (ГОСТ 4401-81) и парциальному давлению пара (формула
// Магнуса, WMO-No. 8): Qfad = Qн · pн / (pб − φ·pн.п(t)) · (273,15 + t) / 273,15. Далее — запас (ТЗ), продувка адсорбционного
// осушителя (по типу регенерации) и сравнение с рабочими компрессорами (резервные — самые крупные, не считаются).
class AirDemand {
  /** давление на высоте H, кПа */
  static baro(H){ const a=StationRules.raw('flow.isa'); return a.p0*Math.pow(1-a.a*Math.max(0, H||0), a.n); }
  /** давление насыщенного пара над водой при t, кПа */
  static psat(t){ const m=StationRules.raw('flow.psat'); return m.c*Math.exp(m.b*t/(m.l+t)); }
  /** н. м³/мин → FAD при условиях всасывания */
  static fad(Qn, H, t, rh){ const nc=StationRules.raw('flow.normal'), pb=this.baro(H), pv=(rh||0)/100*this.psat(t);
    return Qn*nc.p/(pb-pv)*(t+273.15)/(nc.t+273.15); }
  static units(q){ return q.units.filter(u=>u.kind==='compressor').flatMap(u=>Array.from({ length:u.qty }, ()=>u)); }

  static run(N, q){
    const r=q.req, f=CalcNote.f; N.section('air', 'Производительность');
    if (!(r.flow>0)){ N.issue('info', 'Производительность станции не задана — расчёт по потребности не выполнен.'); N.ask('Требуемая производительность станции, м³/мин, и к каким условиям она приведена (FAD — условия всасывания или нормальные м³).'); return null; }
    const H=r.alt!=null ? r.alt : 0, tAir=r.tmax!=null ? r.tmax : StationRules.raw('flow.fad_ref').t;
    if (r.alt==null){ N.assume('Высота над уровнем моря в ТЗ не указана — принято 0 м.'); N.ask('Высота площадки над уровнем моря, м.', true); }
    if (r.tmax==null){ N.missing('t.max', 'Наружная температура летом не задана — для расчёта принята '+f(tAir, 0)+' °C', 'Максимальная температура наружного воздуха на площадке (летом), °C.'); }
    let Q=r.flow;
    if (r.basis==='normal'){
      const rh=r.rh!=null ? r.rh : 100; if (r.rh==null) N.assume('Влажность воздуха не указана — для перевода н. м³ в FAD принято 100 % (с запасом).');
      N.rule('flow.normal'); N.rule('flow.isa'); N.rule('flow.psat');
      const pb=this.baro(H), ps=this.psat(tAir); Q=this.fad(r.flow, H, tAir, rh);
      N.step({ what:'Потребность в нормальных м³ → FAD (условия всасывания)', formula:'Qfad = Qн · 101,325 / (pб − φ·pн.п) · (273,15 + t) / 273,15',
        data:[['Qн', f(r.flow)+' н. м³/мин'], ['высота', f(H, 0)+' м → pб = '+f(pb, 3)+' кПа'], ['t всасывания', f(tAir, 0)+' °C'], ['φ', f(rh, 0)+' % → pн.п = '+f(ps, 3)+' кПа']],
        rules:['flow.normal', 'flow.isa', 'flow.psat'], result:'Qfad = '+f(Q)+' м³/мин' });
    } else N.step({ what:'Потребность — FAD (приведена к условиям всасывания, ISO 1217)', data:[['Q', f(Q)+' м³/мин']], rules:['flow.fad_ref'], result:'Qfad = '+f(Q)+' м³/мин' });
    N.rule('flow.fad_ref');
    // запас: по ТЗ; нормами РФ не установлен
    const m0=N.rule('flow.margin'), m=r.margin!=null ? r.margin : m0.default;
    if (r.margin==null){ N.missing('flow.margin.tz', 'Запас производительности в ТЗ не задан — принят '+f(m, 0)+' % (нормами РФ не установлен)', 'Нужен ли запас производительности сверх потребности (утечки, развитие производства), %?'); }
    // продувка адсорбционного осушителя
    const ads=q.units.filter(u=>u.kind==='dryer' && u.info.type==='ads'), regen=ads.length ? String(ads[0].attrs.regen||'') : '';
    let s=0; if (ads.length){ N.rule('flow.purge'); s=AirChain.purge(regen); }
    const need=Q*(1+m/100)/(1-s);
    N.step({ what:'Требуемая производительность рабочих компрессоров', formula:'Qтр = Qfad · (1 + запас) / (1 − продувка)',
      data:[['Qfad', f(Q)+' м³/мин'], ['запас', f(m, 1)+' %'+(r.margin==null ? ' (не задан в ТЗ)' : ' (ТЗ)')], ['продувка осушителя', ads.length ? f(s*100, 0)+' % ('+(regen||'тип регенерации не указан')+')' : 'нет адсорбционного осушителя']],
      rules:['flow.margin', ads.length ? 'flow.purge' : ''], result:'Qтр = '+f(need)+' м³/мин' });
    // рабочие и резервные
    const C=this.units(q).map(u=>({ u, v:u.info.flow||0 })).sort((a, b)=>b.v-a.v);
    if (!C.length){ N.issue('error', 'В составе нет компрессоров.'); return { need, Q }; }
    const res=r.reserve!=null ? Math.min(r.reserve, C.length-1) : 0, work=C.slice(res), spare=C.slice(0, res), sum=work.reduce((a, o)=>a+o.v, 0);
    if (r.reserve==null){ N.rule('flow.reserve'); N.missing('flow.reserve.tz', 'Резерв компрессоров в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный компрессор (N+1)?'); }
    const unknown=C.filter(o=>!(o.v>0));
    if (unknown.length) N.missing('comp.flow', 'Нет производительности: '+[...new Set(unknown.map(o=>o.u.name))].join(', '));
    const fit=N.fits(sum, need), ok=fit.ok, mg=CalcNote.pct(sum, need);
    N.step({ what:'Компрессоры: рабочие против требуемой', formula:'Σ Qраб ≥ Qтр', data:[['рабочих', work.length+' шт.'], ['резервных', res+' шт.'+(res ? ' (самые крупные — не учитываются)' : '')],
      ...work.slice(0, 6).map((o, i)=>['№ '+(i+1), o.u.name+' — '+f(o.v)+' м³/мин'])], result:'Σ Qраб = '+f(sum)+' м³/мин', ok, margin:mg, note:fit.note, rules:fit.edge ? ['calc.tolerance'] : [], pick:[...new Set(C.map(o=>o.u.name))].join('; ') });
    if (!ok) N.issue('error', `Производительность рабочих компрессоров ${f(sum)} м³/мин меньше требуемой ${f(need)} м³/мин.`);
    if (res){ const big=work.length ? work[0].v : 0, low=spare.filter(o=>o.v<big-1e-9);
      N.step({ what:'Резерв', formula:'резервный не меньше самого крупного рабочего', rules:['flow.reserve'], data:spare.map(o=>['резервный', o.u.name+' — '+f(o.v)+' м³/мин']), ok:!low.length, result:low.length ? 'резервный меньше рабочего' : 'N + '+res });
      if (low.length) N.issue('error', 'Резервный компрессор меньше самого крупного рабочего — при его отказе станция не обеспечит потребность.'); }
    // электродвигатель на высоте и в жару
    const ma=N.rule('flow.motor_alt');
    if (H>ma.h || (r.tmax!=null && r.tmax>ma.t)){ N.issue('warn', `Условия выше номинальных для электродвигателя (до ${ma.h} м и +${ma.t} °C): высота ${f(H, 0)} м, до ${f(r.tmax, 0)} °C — снижение мощности по данным изготовителя.`);
      N.missing('motor.derate', 'Снижение мощности двигателей компрессоров на высоте / в жару — по данным изготовителя'); }
    return { need, Q, sum, work, res };
  }
}

// ---------------------------------------------------------------- давление: потребитель + потери → компрессор
class PressureBudget {
  static run(N, q, A){
    const r=q.req, f=CalcNote.f; N.section('press', 'Давление');
    const C=q.units.filter(u=>u.kind==='compressor'); if (!C.length) return null;
    const pmax=Math.min(...C.map(u=>u.info.bar||Infinity)), vsd=C.every(u=>u.info.vsd);
    if (!Number.isFinite(pmax)){ N.missing('comp.bar', 'Нет рабочего давления компрессора'); return null; }
    let loss=0; const data=[], rules=[];
    for (const u of q.units.filter(u=>u.kind==='filter' && u.info.grade!=='cond')){ const d=CalcInput.dp(u);
      if (d!=null){ loss+=d; data.push([u.name, f(d)+' бар (паспорт)']); } else { const v=N.rule('loss.filter'); loss+=v; rules.push('loss.filter'); data.push([u.name, f(v)+' бар (правило)']); } }
    for (const u of q.units.filter(u=>u.kind==='dryer')){ const d=CalcInput.dp(u), t=u.info.type==='ads' ? 'ads' : 'refrig';
      if (d!=null){ loss+=d; data.push([u.name, f(d)+' бар (паспорт)']); } else { const v=N.rule('loss.dryer')[t]; loss+=v; rules.push('loss.dryer'); data.push([u.name, f(v)+' бар (правило)']); } }
    const lp=N.rule('loss.pipe'); loss+=lp; data.push(['трубопровод станции', f(lp)+' бар']); rules.push('loss.pipe');
    if (!(r.pressure>0)){ N.issue('info', 'Давление у потребителя не задано — проверка давления не выполнена.'); N.ask('Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.');
      return { pmax, loss, pOp:Math.max(1, pmax-(vsd ? 0 : StationRules.raw('pressure.band'))-loss) }; }
    const need=r.pressure+loss, band=vsd ? 0 : N.rule('pressure.band'), low=pmax-band;
    N.step({ what:'Требуемое давление компрессора', formula:'pтр = pпотр + Σ Δp', data:[['pпотр', f(r.pressure)+' бар'], ...data], rules, result:'pтр = '+f(need)+' бар' });
    const ok=low>=need-1e-9;
    N.step({ what:vsd ? 'Компрессоры с частотным регулированием: давление поддержания' : 'Компрессоры «нагрузка — холостой ход»: давление включения', formula:vsd ? 'pmax ≥ pтр' : 'pmax − Δpрег ≥ pтр',
      data:[['pmax (паспорт)', f(pmax)+' бар'], ...(vsd ? [] : [['Δpрег', f(band)+' бар']])], rules:vsd ? [] : ['pressure.band'], result:(vsd ? 'pmax = ' : 'pвкл = ')+f(low)+' бар', ok, margin:CalcNote.pct(low, need) });
    if (!N.fits(pmax, need).ok) N.issue('error', `Компрессор на ${f(pmax)} бар не обеспечит ${f(r.pressure)} бар у потребителя с потерями ${f(loss)} бар (нужно ${f(need)}).`);
    else if (!ok) N.issue('warn', `В нижней точке регулирования (${f(low)} бар) давление ниже требуемого ${f(need)} бар — сузьте диапазон регулирования или выберите компрессор на большее давление.`);
    // давление аппаратов
    for (const u of q.units.filter(u=>/^(receiver|dryer|filter)$/.test(u.kind))){ const b=u.info.bar||CalcInput.num(u.attrs.pressure);
      if (b>0 && b<pmax-1e-9) N.issue('error', `${u.name}: рассчитан на ${f(b)} бар — меньше наибольшего давления компрессора ${f(pmax)} бар.`); }
    return { pmax, loss, need, pOp:r.pressure+lp };   // давление у осушителя и фильтров — не ниже потребителя с потерями в трубах
  }
}

// ---------------------------------------------------------------- осушители: поправки производителя
class DryerSizing {
  /** значение таблицы и признак «вне таблицы» */
  static k(T, x){ if (!Array.isArray(T) || !T.length || x==null) return { k:1, out:false }; return { k:StationRules.interp(T, x), out:x<T[0][0]-1e-9 || x>T[T.length-1][0]+1e-9 }; }
  /** температуры для поправок: в помещении станции — наружная летом + нагрев вентиляцией (heat.vent_dt); на входе в
   *  осушитель — из ТЗ или в помещении + dryer.inlet_dt (после концевого охладителя компрессора) */
  static temps(r){ const amb=(r.tmax!=null ? r.tmax : StationRules.raw('dryer.ref').ambient)+StationRules.raw('heat.vent_dt');
    return { amb, tin:r.tin!=null ? r.tin : amb+StationRules.raw('dryer.inlet_dt') }; }
  /** поправочный множитель производительности осушителя p (позиция каталога или элемент состава) при давлении bar и
   *  температурах: серия производителя из файла правил — F = Fp · Fвх · Fокр; серии нет — таблицы типовой серии по виду
   *  осушителя (dryer.generic: рефрижераторный / адсорбционный, требует подтверждения); нет и её — Kp ÷ запас */
  static factor(p, bar, t, type){
    let s=StationRules.series(p, 'dryer'), generic=false;
    if (!s){ const g=StationRules.raw('dryer.generic')||{}, title=g[type==='ads' ? 'ads' : 'refrig']; s=((StationRules.data||{}).series||[]).find(z=>z.kind==='dryer' && z.title===title)||null; generic=!!s; }
    if (s){ const kp=this.k(s.f.p, bar), ki=this.k(s.f.inlet, s.f.inlet ? t.tin : null), ka=this.k(s.f.ambient, s.f.ambient ? t.amb : null);
      return { F:kp.k*ki.k*ka.k, s, generic, kp, ki, ka, out:[kp.out && 'давление', ki.out && 'температура входа', ka.out && 'температура помещения'].filter(Boolean) }; }
    const kp=AirChain.kp(bar); return { F:kp/StationRules.raw('dryer.margin'), s:null, generic:false, kp:{ k:kp }, out:[] };
  }
  static run(N, q, A, P){
    const r=q.req, f=CalcNote.f, D=q.units.filter(u=>u.kind==='dryer' && u.info.type!=='gen');
    if (!D.length){ const cls=String(q.cls||'').match(/^([1-6])\.([1-6])\.([1-4])$/), built=q.units.some(u=>u.kind==='compressor' && u.info.dryer);
      if (cls && !built){ N.section('dryer', 'Осушители'); N.rule('air.pdp');
        N.step({ what:'Осушитель для класса '+q.cls, formula:'точка росы под давлением ≤ '+f(AirChain.PDP[+cls[2]], 0)+' °C', rules:['air.pdp'], ok:false, result:'осушителя в составе нет' });
        N.issue('error', `Класс ${q.cls}: в составе нет осушителя (точка росы не выше ${f(AirChain.PDP[+cls[2]], 0)} °C).`); }
      return; }
    N.section('dryer', 'Осушители');
    const Q=A && A.sum>0 ? A.sum : null; if (!Q){ N.issue('info', 'Нет производительности компрессоров — осушитель не проверен.'); return; }
    const p=P && P.pOp>0 ? P.pOp : (r.pressure>0 ? r.pressure : StationRules.raw('dryer.ref').p), t=this.temps(r);
    N.rule('heat.vent_dt'); if (r.tin==null) N.rule('dryer.inlet_dt');
    if (r.tin==null) N.assume(`Температура воздуха на входе в осушитель — по правилу: в помещении станции ${f(t.amb, 0)} °C (наружная ${r.tmax!=null ? f(r.tmax, 0) : 'по умолчанию '+f(t.amb-StationRules.raw('heat.vent_dt'), 0)} °C + нагрев ${f(StationRules.raw('heat.vent_dt'), 0)} °C) + ${f(t.tin-t.amb, 0)} °C после охладителя компрессора = ${f(t.tin, 0)} °C.`);
    N.assume(`Давление на входе в осушитель и фильтры для поправок принято ${f(p, 1)} бар — не выше фактического (запас в меньшую сторону).`);
    const cls=String(q.cls||'').match(/^([1-6])\.([1-6])\.([1-4])$/), pdpNeed=cls ? AirChain.PDP[+cls[2]] : null;
    for (const u of D){
      const cap=(u.info.flow||0)*u.qty, o=this.factor(u.p, p, t, u.info.type), rules=['heat.vent_dt', r.tin==null ? 'dryer.inlet_dt' : ''];
      if (!(cap>0)){ N.missing('dryer.flow.'+u.name, 'Нет производительности осушителя '+u.name); continue; }
      let data;
      if (o.s){ data=[['давление', f(p, 1)+' бар → '+f(o.kp.k, 3)], ...(o.s.f.inlet ? [['вход', f(t.tin, 0)+' °C → '+f(o.ki.k, 3)]] : []), ...(o.s.f.ambient ? [['помещение', f(t.amb, 0)+' °C → '+f(o.ka.k, 3)]] : []),
          ['источник', (o.generic ? 'типовые поправки по таблице «'+o.s.title+'» — ' : '')+[o.s.source.doc, o.s.source.item].filter(Boolean).join(', ')]];
        if (o.generic){ N.rule('dryer.generic'); rules.push('dryer.generic');
          N.missing('series.dryer.'+(u.attrs.maker||'')+'.'+(u.attrs.model||u.name), `Данные для расчёта неполные: поправок производителя для осушителя «${u.name}» нет — типовые по таблице «${o.s.title}»`); } }
      else { N.rule('dryer.kp'); N.rule('dryer.margin'); rules.push('dryer.kp', 'dryer.margin');
        data=[['давление', f(p, 1)+' бар → '+f(o.kp.k, 3)+' (типовая таблица)'], ['запас на температуру', '÷ '+f(StationRules.raw('dryer.margin'))]];
        N.missing('series.dryer.'+(u.attrs.maker||'')+'.'+(u.attrs.model||u.name), `Данные для расчёта неполные: поправки производителя для осушителя «${u.name}» не найдены — типовая таблица`); }
      const corr=cap*o.F, fit=N.fits(corr, Q), ok=fit.ok; if (fit.edge) rules.push('calc.tolerance');
      N.step({ what:`${u.name}${u.qty>1 ? ' × '+u.qty+' (параллельно)' : ''}`, formula:o.s ? 'Qосуш · Fp · Fвх'+(o.s.f.ambient ? ' · Fокр' : '')+' ≥ Σ Qраб' : 'Qосуш · Kp ÷ запас ≥ Σ Qраб', data:[['номинал', f(cap)+' м³/мин'], ...data, ['через осушитель', f(Q)+' м³/мин']],
        rules, result:'с поправками '+f(corr)+' м³/мин', ok, margin:CalcNote.pct(corr, Q), note:fit.note, pick:u.name });
      if (!ok) N.issue('error', `${CalcNote.lbl('Осушитель', u.name)}: с поправками ${f(corr)} м³/мин — меньше производительности компрессоров ${f(Q)} м³/мин.`);
      if (o.out.length) N.issue('warn', `${CalcNote.lbl('Осушитель', u.name)}: условия вне таблицы производителя (${o.out.join(', ')}) — взяты крайние значения, уточните у производителя.`);
      if (pdpNeed!=null){ const pdp=u.info.pdp;
        if (pdp==null) N.missing('dryer.pdp.'+u.name, 'Нет точки росы осушителя '+u.name);
        else { const okp=pdp<=pdpNeed+1e-9; N.step({ what:'Точка росы под давлением', formula:'PDP осушителя ≤ PDP класса', rules:['air.pdp'], data:[['класс '+q.cls, f(pdpNeed, 0)+' °C'], ['осушитель', f(pdp, 0)+' °C']], ok:okp, result:okp ? 'обеспечивает' : 'не обеспечивает' });
          N.rule('air.pdp'); if (!okp) N.issue('error', `${CalcNote.lbl('Осушитель', u.name)}: точка росы ${f(pdp, 0)} °C — хуже требуемой по классу ${q.cls} (${f(pdpNeed, 0)} °C).`); } } }
  }
}

// ---------------------------------------------------------------- фильтры: поправка на давление и ступени по классу
class FilterSizing {
  static run(N, q, A, P){
    const f=CalcNote.f, Fl=q.units.filter(u=>u.kind==='filter' && u.info.grade!=='cond'); if (!Fl.length && !q.cls) return;
    N.section('filter', 'Фильтры');
    const Q=A && A.sum>0 ? A.sum : null, p=P && P.pOp>0 ? P.pOp : (q.req.pressure>0 ? q.req.pressure : 7);
    for (const u of Fl){ if (!Q) break;
      const cap=(u.info.flow||0)*u.qty, s=StationRules.series(u.p, 'filter');
      if (!(cap>0)){ N.missing('filter.flow.'+u.name, 'Нет производительности фильтра '+u.name); continue; }
      let k, data, rules=[];
      if (s){ const o=DryerSizing.k(s.f.p, p); k=o.k; data=[['давление', f(p, 1)+' бар → '+f(k, 3)], ['источник', [s.source.doc, s.source.item].filter(Boolean).join(', ')]];
        if (o.out) N.issue('warn', `${CalcNote.lbl('Фильтр', u.name)}: давление вне таблицы производителя.`); }
      else { k=AirChain.kf(p); N.rule('filter.kp'); rules=['filter.kp']; data=[['давление', f(p, 1)+' бар → '+f(k, 3)+' (типовая формула)']];
        N.missing('series.filter.'+(u.attrs.maker||'')+'.'+(u.attrs.series||u.attrs.model||u.name), `Данные для расчёта неполные: поправки производителя для фильтров «${[u.attrs.maker, u.attrs.series||u.attrs.model||u.name].filter(Boolean).join(' ')}» не найдены — типовая формула`); }
      const corr=cap*k, fit=N.fits(corr, Q), ok=fit.ok; if (fit.edge) rules.push('calc.tolerance');
      N.step({ what:`${u.name}${u.qty>1 ? ' × '+u.qty+' (параллельно)' : ''} — ${AirChain.GRADES[u.info.grade] ? AirChain.GRADES[u.info.grade].short : 'ступень не определена'}`, formula:'Qф · Kp ≥ Σ Qраб',
        data:[['номинал', f(cap)+' м³/мин'], ...data, ['через фильтр', f(Q)+' м³/мин']], rules, result:'с поправкой '+f(corr)+' м³/мин', ok, margin:CalcNote.pct(corr, Q), note:fit.note, pick:u.name });
      if (!ok) N.issue('error', `${CalcNote.lbl('Фильтр', u.name)}: с поправкой на давление ${f(corr)} м³/мин — меньше ${f(Q)} м³/мин.`);
      if (!u.info.grade) N.missing('filter.grade.'+u.name, 'Ступень очистки фильтра не определена: '+u.name);
    }
    // ступени по классу ISO 8573-1
    const cls=String(q.cls||'').match(/^([1-6])\.([1-6])\.([1-4])$/); if (!cls) { if (Fl.length) N.ask('Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1 (частицы.вода.масло) или требуемая точка росы.', true); return; }
    const R=N.rule('air.chain'), [pc, , oc]=[+cls[1], +cls[2], +cls[3]], have=new Set(Fl.map(u=>u.info.grade)), D=q.units.filter(u=>u.kind==='dryer');
    const need=[]; const lvl=Math.min(pc, oc); if (lvl===1) need.push(['частицы / масло класса 1', R['1']]); else if (lvl===2) need.push(['частицы / масло класса 2', R['2']]);
    if (oc===1) need.push(['масло класса 1 (пары)', R.oil1]);
    if (D.some(u=>u.info.type==='ads')) need.push(['после адсорбционного осушителя', R.afterAds]);
    // безмасляные компрессоры: пары масла — только из всасываемого воздуха, угольный фильтр — по анализу воздуха (предупреждение)
    const oilFree=q.units.filter(u=>u.kind==='compressor').every(u=>/^(да|есть|true)$/i.test(String(u.attrs.oilFree??'')) || (typeof TzPick!=='undefined' && TzPick.oilFree({ name:u.name, attrs:u.attrs })));
    for (const [why, G] of need){ const ok=G.some(g=>have.has(g)), soft=why.startsWith('после') || (G===R.oil1 && oilFree);
      N.step({ what:'Ступень очистки: '+why, formula:'в составе есть: '+G.map(g=>AirChain.GRADES[g].short).join(' или '), rules:['air.chain'], ok, result:ok ? 'есть' : 'нет' });
      if (!ok) N.issue(soft ? 'warn' : 'error', `Класс ${q.cls}: нет фильтра ${G.map(g=>AirChain.GRADES[g].short).join(' или ')} (${why}${G===R.oil1 && oilFree ? '; компрессоры безмасляные — по анализу всасываемого воздуха' : ''}).`); }
  }
}

// ---------------------------------------------------------------- ресиверы: объём по формуле, давление
class ReceiverSizing {
  static run(N, q, A){
    const f=CalcNote.f, C=q.units.filter(u=>u.kind==='compressor'); if (!C.length) return;
    N.section('recv', 'Ресиверы');
    const Rv=q.units.filter(u=>u.kind==='receiver'), have=Rv.reduce((s, u)=>s+(u.info.vol||0)*u.qty, 0);
    const big=C.reduce((m, u)=>(u.info.flow||0)>(m.info.flow||0) ? u : m, C[0]), vsd=!!big.info.vsd, fr=N.rule('receiver.formula');
    const per=vsd ? N.rule('receiver.vsd') : AirChain.RECV, V=Math.round((big.info.flow||0)*per), tz=q.req.recvVol>0 ? q.req.recvVol : 0, need=Math.max(V, tz);
    N.step({ what:'Объём ресивера', formula:vsd ? 'V = '+f(per, 0)+' л на 1 м³/мин (частотное регулирование)' : 'V = 0,25 · qc · p1 · T0 / (fmax · Δp · T1)',
      data:[['наибольший компрессор', big.name+' — '+f(big.info.flow)+' м³/мин'], ...(vsd ? [] : [['p1 · T0 / T1', f(fr.p1)+' бар · '+fr.T0+' / '+fr.T1+' K'], ['цикл', fr.cycle+' с'], ['Δp', f(fr.dp)+' бар']]),
        ...(tz ? [['по ТЗ', f(tz, 0)+' л']] : [])], rules:['receiver.formula', vsd ? 'receiver.vsd' : ''], result:'нужно ≥ '+f(need, 0)+' л; в составе '+f(have, 0)+' л',
      ok:N.fits(have, need).ok, margin:CalcNote.pct(have, need), note:N.fits(have, need).note, pick:Rv.map(u=>u.name+(u.qty>1 ? ' × '+u.qty : '')).join('; ') });
    if (!Rv.length) N.issue('warn', `Ресиверов в составе нет — нужно около ${f(need, 0)} л.`);
    else if (!N.fits(have, need).ok) N.issue(tz && !N.fits(have, tz).ok ? 'error' : 'warn', `Объём ресиверов ${f(have, 0)} л меньше ${tz && !N.fits(have, tz).ok ? 'требуемого по ТЗ' : 'расчётного'} ${f(need, 0)} л.`);
    const pv=N.rule('vessel.pv'), bar=Math.max(0, ...C.map(u=>u.info.bar||0));
    for (const u of Rv){ const v=u.info.vol||0, x=bar/10*v/1000;
      if (v>0 && bar>0) N.step({ what:'Учёт в Ростехнадзоре: '+u.name, formula:'p · V ≤ '+f(pv)+' МПа·м³', rules:['vessel.pv'], data:[['p', f(bar/10, 2)+' МПа'], ['V', f(v/1000, 3)+' м³']], result:'p·V = '+f(x, 3), ok:x<=pv+1e-9 });
      if (x>pv+1e-9) N.issue('warn', `${u.name}: p·V = ${f(x, 3)} МПа·м³ — подлежит учёту в Ростехнадзоре (ФНП ОРПД).`); }
  }
}

// ---------------------------------------------------------------- вентиляция: жалюзи (расчёт и места — StationVent, plan.vent)
class VentSizing {
  static run(N, plan){
    const V=plan && plan.vent; if (!V) return;
    const f=CalcNote.f, n=StationLayout.n, F=N.rule('heat.face'), k=N.rule('vent.free');
    N.section('vent', 'Вентиляция');
    const step=(what, kind)=>{ const nd=V.need[kind]; if (!nd) return;
      const roof=kind==='out' ? (V.roof||[]) : [], placed=V.louvers.filter(q=>q.kind===kind).reduce((s, q)=>s+q.w*q.h/1e6, 0)+roof.reduce((s, q)=>s+q.w*q.l/1e6, 0), ok=!(V.short[kind]>0);
      const wh=StationVent.where(V)[kind], list=[V.louvers.some(q=>q.kind===kind) ? 'жалюзи '+StationVent.list(V, kind) : '', roof.length ? 'через крышу '+StationVent.roofList(V) : ''].filter(Boolean).join(', ');
      N.step({ what, formula:'A = Q / (3600 · v); по рамке = A / k', rules:['heat.face', 'vent.free'], data:[['Q', n(V.q[kind])+' м³/ч'], ['v', f(F, 1)+' м/с'], ['k', f(k, 2)]],
        result:`A ≥ ${f(nd.free)} м², по рамке ≥ ${f(nd.gross)} м²; ${list || 'жалюзи —'}${wh ? ' ('+wh+')' : ''}`, ok, margin:CalcNote.pct(placed, nd.gross) });
      if (!ok) N.issue('warn', `${what}: на стенах не поместилось ${f(V.short[kind])} м² жалюзи (по рамке) — освободите стену или выведите воздух воздуховодом через крышу.`); };
    step('Приточные жалюзи', 'in'); step('Выброс горячего воздуха', 'out');
    if (V.hood){ const I=V.louvers.filter(q=>q.kind==='in' && q.hood), q0=I.reduce((a, q)=>q.hood.v>a.hood.v ? q : a, I[0]), A=I.reduce((s, q)=>s+q.w*q.h, 0), Qi=Math.round(V.q.in*q0.w*q0.h/A);
      N.step({ what:'Маркиза на приточных жалюзи (снегозащита)', formula:'вылет d = Q / (3600 · v · B), B — ширина маркизы; 250…1000 мм; у всех маркиз один — по самой нагруженной', rules:['vent.hood_v'],
        data:[['Q', n(Qi)+' м³/ч (доля жалюзи '+n(q0.w)+' × '+n(q0.h)+' мм)'], ['B', n(q0.hood.w)+' мм'], ['v', f(N.rule('vent.hood_v'), 1)+' м/с']],
        result:StationVent.hoodText(V), ok:!V.hood.over }); }
    if (V.rad) N.step({ what:'Выброс воздуха радиатора ДГУ', formula:'v = Q / (3600 · A)', rules:['vent.free'], data:[['Q', n(V.rad.q)+' м³/ч'], [V.rad.door ? 'дверь-жалюзи' : 'жалюзи', n(V.rad.w)+' × '+n(V.rad.h)+' мм'], ['A', f(V.rad.free)+' м²']],
      result:'v = '+f(V.rad.v, 1)+' м/с', ok:V.rad.v<=StationVent.RAD_V, note:V.rad.v>StationVent.RAD_V ? 'Больше '+f(StationVent.RAD_V, 1)+' м/с — проверьте по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление).' : '' });
  }
}

// ---------------------------------------------------------------- электрика: мощность, ток, пуск
class ElectricLoad {
  /** способ пуска компрессора: частотный — по полю vsd; иначе по строке «пуск» каталога; не указан — прямой (с запасом) */
  static start(u){ if (u.info && u.info.vsd) return 'vsd'; const r=(u.rows||[]).find(x=>x && /^(?:тип|способ|система)\s+(?:за)?пуска|^пуск$/i.test(String(x.k||'').trim())), t=r ? String(r.v||'').toLowerCase() : '';
    return /частот|чрп|vsd|преобразовател/.test(t) ? 'vsd' : /звезд|треуг|y\s*\/\s*[dδ]|star/.test(t) ? 'stardelta' : /плавн|soft/.test(t) ? 'soft' : /прям/.test(t) ? 'direct' : ''; }
  static run(N, q, plan){
    const f=CalcNote.f, W=plan && plan.power; N.section('el', 'Электропитание');
    if (W) N.step({ what:'Мощность и ток станции', formula:'I = P / (√3 · U · cos φ)', rules:['el.u', 'el.cos', 'el.breaker_k'],
      data:[['установленная', f(W.inst, 1)+' кВт'], ['расчётная', f(W.kw, 1)+' кВт ('+(W.mode==='run' ? 'работа' : 'простой зимой')+')'], ['U', N.rule('el.u')+' В'], ['cos φ', f(N.rule('el.cos'))]],
      result:'I = '+f(W.amp, 1)+' А; вводной автомат '+(W.breaker ? W.breaker+' А' : 'по проекту'), ok:null });
    N.rule('el.breaker_k');
    const M=q.units.filter(u=>(u.kind==='compressor' || u.kind==='pump') && CalcInput.num(u.attrs.kw)>0); if (!M.length) return null;
    const big=M.reduce((m, u)=>CalcInput.num(u.attrs.kw)>CalcInput.num(m.attrs.kw) ? u : m, M[0]), kw=CalcInput.num(big.attrs.kw);
    const K=N.rule('el.start'), how=this.start(big), k=how ? K[how] : K.default, U=N.rule('el.u'), cos=N.rule('el.cos'), eta=N.rule('el.eta');
    if (!how) N.missing('start.'+big.name, `Способ пуска «${big.name}» в каталоге не указан — принят прямой пуск (с запасом)`);
    const In=kw*1000/(Math.sqrt(3)*U*cos*eta), Ist=k*In, peak=(W ? W.amp : In)-In+Ist, Sst=Math.sqrt(3)*U*Ist/1000;
    N.step({ what:'Пуск наибольшего двигателя: '+big.name, formula:'Iном = P / (√3 · U · cos φ · η); Iпуск = k · Iном', rules:['el.start', 'el.eta'],
      data:[['P', f(kw, 1)+' кВт'], ['способ пуска', { direct:'прямой', stardelta:'звезда — треугольник', soft:'плавный пуск', vsd:'частотный преобразователь' }[how||'direct']+(how ? '' : ' (принят)')], ['k', f(k, 1)]],
      result:`Iном ≈ ${f(In, 0)} А; Iпуск ≈ ${f(Ist, 0)} А; пик при пуске (остальные работают) ≈ ${f(peak, 0)} А; Sпуск ≈ ${f(Sst, 0)} кВА`, ok:null });
    return { kw, how:how||'direct', In, Ist, Sst, peak };
  }
}

// ---------------------------------------------------------------- ДГУ: мощность, нагрузка, высота и жара, пуск, топливо
class GensetSizing {
  /** расход топлива ДГУ при доле нагрузки x, л/ч: строки «При нагрузке N %» / «Расход топлива при N % нагрузки»; нет — null */
  static fuel(u, x){
    const T=[]; for (const r of u.rows||[]){ const m=String(r && r.k||'').match(/(\d{2,3})\s*%/); if (!m || !/нагрузк/i.test(String(r.k)) || !/л\s*\/\s*ч/i.test(String(r.k)+' '+String(r.v))) continue;
      const v=AirChain.first(r.v); if (v>0) T.push([+m[1]/100, v]); }
    T.sort((a, b)=>a[0]-b[0]); return T.length>=2 || (T.length===1 && Math.abs(T[0][0]-x)<0.01) ? StationRules.interp(T, x) : null;
  }
  /** топливо на автономность (часы из требований): доля нагрузки, расход одной рабочей ДГУ — по строкам паспорта, иначе
   *  удельный (правило dgu.lph); нужно с запасом dgu.fuel_margin; есть — баки ДГУ и дополнительные. Нет часов или ДГУ — null */
  static fuelPlan(q){
    const r=q.req, G=q.units.filter(u=>u.kind==='dgu'); if (!G.length || !(r.hours>0)) return null;
    const U=G.flatMap(u=>Array.from({ length:u.qty }, ()=>({ u, prp:CalcInput.num(u.attrs.kw)||0 }))).sort((a, b)=>b.prp-a.prp);
    const res=r.reserve!=null ? Math.min(r.reserve, U.length-1) : 0, work=U.slice(res), PRP=work.reduce((s, o)=>s+o.prp, 0);
    const x=r.kw>0 && PRP>0 ? Math.min(1.1, (r.load>0 ? r.kw*r.load/100 : r.kw)/PRP) : StationRules.raw('dgu.fuel_load');
    let c=this.fuel(work[0].u, x), src='паспорт ДГУ'; if (c==null){ c=StationRules.raw('dgu.lph')*x*work[0].prp; src='удельный расход (правило)'; }
    const built=G.reduce((s, u)=>s+this.tank(u)*u.qty, 0), extra=q.units.filter(u=>u.kind==='tank').reduce((s, u)=>s+(AirChain.volume(u.p)||CalcInput.num(u.attrs.tank)||0)*u.qty, 0);
    return { x, c, src, n:work.length, need:c*work.length*r.hours*StationRules.raw('dgu.fuel_margin'), built, extra, have:built+extra };
  }
  static plan(x){ return this.fuelPlan(CalcInput.of(x)); }
  static tank(u){ const r=CalcInput.row(u, /^(?:встроенн\S*\s+)?топливн\S*\s+бак|объ[её]м\s+(?:топливного\s+)?бака|[её]мкость\s.*бака/i, /(?:^|[^а-я])л(?:[^а-я]|$)/i); return r ? r.v : CalcInput.num(u.attrs.tank) || 0; }
  static run(N, q, E){
    const r=q.req, f=CalcNote.f, G=q.units.filter(u=>u.kind==='dgu'); N.section('dgu', 'ДГУ');
    if (!G.length){ N.issue('error', 'В составе нет ДГУ.'); return; }
    const units=G.flatMap(u=>Array.from({ length:u.qty }, ()=>u)).map(u=>({ u, prp:CalcInput.num(u.attrs.kw)||0, esp:CalcInput.num(u.attrs.kwMax)||0, kva:CalcInput.num(u.attrs.kva)||0 })).sort((a, b)=>b.prp-a.prp);
    const res=r.reserve!=null ? Math.min(r.reserve, units.length-1) : 0, work=units.slice(res), PRP=work.reduce((s, o)=>s+o.prp, 0), ESP=work.reduce((s, o)=>s+o.esp, 0), KVA=work.reduce((s, o)=>s+o.kva, 0);
    if (r.reserve==null) N.missing('dgu.reserve.tz', 'Резерв ДГУ в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный ДГУ (N+1)?');
    if (!(r.kw>0)){ N.issue('info', 'Мощность нагрузки не задана — проверка мощности ДГУ не выполнена.'); N.ask('Мощность нагрузки ДЭС, кВт (длительная и максимальная).'); }
    const standby=/standby|резерв|аварийн/i.test(r.mode||'');
    if (r.kw>0){ const cap=standby ? ESP : PRP, fit=N.fits(cap, r.kw), ok=fit.ok;
      N.step({ what:standby ? 'Мощность ESP (резервный источник) против нагрузки' : 'Мощность PRP против нагрузки', formula:'Σ Pраб ≥ Pнагр', rules:[standby ? 'dgu.esp_hours' : 'dgu.prp_avg'],
        data:[['нагрузка', f(r.kw, 0)+' кВт'], ['рабочих ДГУ', work.length+(res ? ' (+'+res+' резерв)' : '')], ...work.slice(0, 4).map(o=>['ДГУ', o.u.name+' — PRP '+f(o.prp, 0)+' / ESP '+f(o.esp, 0)+' кВт'])],
        result:(standby ? 'ESP = ' : 'PRP = ')+f(cap, 0)+' кВт', ok, margin:CalcNote.pct(cap, r.kw), note:fit.note, pick:[...new Set(G.map(u=>u.name))].join('; ') });
      N.rule(standby ? 'dgu.esp_hours' : 'dgu.prp_avg');
      if (!ok) N.issue('error', `Мощность ДГУ ${f(cap, 0)} кВт меньше нагрузки ${f(r.kw, 0)} кВт.`);
      const avg=r.load>0 ? r.kw*r.load/100 : r.kw, lim=N.rule('dgu.prp_avg')*PRP;
      if (!standby){ N.step({ what:'Средняя нагрузка за 24 ч', formula:'Pср ≤ 0,7 · PRP', rules:['dgu.prp_avg'], data:[['Pср', f(avg, 0)+' кВт'+(r.load>0 ? ' ('+f(r.load, 0)+' % от нагрузки)' : ' (график не задан — принята постоянной)')]], result:'0,7 · PRP = '+f(lim, 0)+' кВт', ok:avg<=lim+1e-9, margin:CalcNote.pct(lim, avg) });
        if (!(r.load>0)) N.ask('График нагрузки за сутки: средняя нагрузка, % от максимальной.', true);
        if (avg>lim+1e-9) N.issue('warn', `Средняя нагрузка ${f(avg, 0)} кВт больше 70 % PRP (${f(lim, 0)} кВт): для постоянной круглосуточной нагрузки нужна мощность COP (уточните у производителя) или больше ДГУ.`); } }
    // высота и температура
    const ref=N.rule('dgu.ref'), pb=AirDemand.baro(r.alt||0);
    if (pb<ref.p-1e-9 || (r.tmax!=null && r.tmax>ref.t)) { N.missing('dgu.derate', `Условия площадки хуже стандартных ISO 3046-1 (${f(pb, 1)} кПа${r.tmax!=null ? ', до +'+f(r.tmax, 0)+' °C' : ''}) — снижение мощности по данным изготовителя двигателя (в каталоге нет)`);
      N.step({ what:'Высота и температура (ISO 3046-1)', formula:'местные условия против 100 кПа, 25 °C, 30 %', rules:['dgu.ref'], data:[['высота', f(r.alt||0, 0)+' м → '+f(pb, 1)+' кПа'], ['до', r.tmax!=null ? f(r.tmax, 0)+' °C' : '—']], result:'требуется снижение мощности по данным изготовителя', ok:null }); }
    // пуск наибольшего двигателя от ДГУ
    if (r.motor>0 || (E && E.Sst)){
      const K=N.rule('el.start'), how=r.start && K[r.start] ? r.start : (E && E.how) || '', cos=N.rule('el.cos'), eta=N.rule('el.eta'), P=r.motor>0 ? r.motor : E.kw;
      const S=(how ? K[how] : K.default)*P/(cos*eta), ratio=KVA>0 ? S/KVA : null, dip=N.rule('dgu.dip');
      if (!how) N.missing('dgu.start', 'Способ пуска двигателя нагрузки не указан — принят прямой');
      N.step({ what:'Пуск наибольшего двигателя от ДГУ', formula:'Sпуск = k · P / (cos φ · η)', rules:['el.start', 'dgu.dip'], data:[['P', f(P, 1)+' кВт'], ['k', f(how ? K[how] : K.default, 1)], ['генератор', f(KVA, 0)+' кВА']],
        result:'Sпуск ≈ '+f(S, 0)+' кВА'+(ratio!=null ? ' ('+f(ratio*100, 0)+' % мощности генератора)' : ''), ok:null,
        note:`Допустимый провал напряжения по ISO 8528-5: G1 — ${dip.G1} %, G2 — ${dip.G2} %, G3 — ${dip.G3} %. Проверка — по паспорту генератора (кВА пуска при провале), в каталоге этих данных нет.` });
      N.missing('dgu.skva', 'Способность генератора к пуску двигателей (кВА пуска при допустимом провале) — по паспорту генератора');
      if (ratio>1) N.issue('warn', `Пусковая мощность двигателя ≈ ${f(S, 0)} кВА больше мощности генератора ${f(KVA, 0)} кВА — нужен плавный пуск или частотный преобразователь, либо ДГУ больше (проверить по паспорту генератора).`); }
    // топливо
    const fp=this.fuelPlan(q);
    if (fp){ N.rule('dgu.fuel_margin'); if (fp.src!=='паспорт ДГУ') N.rule('dgu.lph'); if (!(r.kw>0)) N.rule('dgu.fuel_load');
      const need=fp.need, have=fp.have;
      N.step({ what:'Запас топлива на автономность', formula:'V = расход(нагрузка) · n · часы · запас', rules:['dgu.fuel_margin', fp.src==='паспорт ДГУ' ? '' : 'dgu.lph', r.kw>0 ? '' : 'dgu.fuel_load'],
        data:[['нагрузка', f(fp.x*100, 0)+' % PRP'], ['расход', f(fp.c, 1)+' л/ч на ДГУ ('+fp.src+')'], ['рабочих ДГУ', String(fp.n)], ['часы', f(r.hours, 0)], ['баки', `ДГУ ${f(fp.built, 0)} л + дополнительные ${f(fp.extra, 0)} л`]],
        result:`нужно ${f(need, 0)} л; в баках ${f(have, 0)} л`, ok:N.fits(have, need).ok, margin:CalcNote.pct(have, need), note:N.fits(have, need).note });
      if (!N.fits(have, need).ok) N.issue('error', `Топлива в баках ${f(have, 0)} л — меньше нужного на ${f(r.hours, 0)} ч (${f(need, 0)} л).`); }
  }
}

// ---------------------------------------------------------------- весь расчёт станции; вкладка и приложение к КП
class StationCalc {
  static cache=new Map();
  static run(x){
    const q=CalcInput.of(x), plan=StationUi.plan(x), key=JSON.stringify([q.req, q.cls, !!StationReq.of(x).accept, q.units.map(u=>[u.name, u.qty, u.attrs]), StationRules.version(), plan.hash]);
    const c=this.cache.get(x.id); if (c && c.key===key) return c.res;
    const N=new CalcNote();
    if (!StationRules.ok()){ N.issue('warn', 'Файл инженерных правил станций не загружен — расчёт не выполнен.'); return N.result(); }
    try{
      if (q.kind==='comp'){ const A=AirDemand.run(N, q), P=PressureBudget.run(N, q, A); DryerSizing.run(N, q, A, P); FilterSizing.run(N, q, A, P); ReceiverSizing.run(N, q, A); ElectricLoad.run(N, q, plan); }
      else if (q.kind==='dgu') GensetSizing.run(N, q, ElectricLoad.run(N, q, plan));
      else ElectricLoad.run(N, q, plan);
      VentSizing.run(N, plan);
    } catch(e){ N.issue('warn', 'Расчёт прерван: '+String(e && e.message || e).slice(0, 200)); }   // ошибка программы не мешает сохранить КП
    const res=N.result(); res.accept=!!StationReq.of(x).accept; this.cache.set(x.id, { key, res }); return res;
  }
  /** блокирующие ошибки расчёта — КП не сохраняется, пока их не исправят или не отметят «отклонения согласованы с заказчиком» */
  static errors(x){ if (!StationUi.on(x) || !isKit(x)) return []; const R=this.run(x); return R.accept ? [] : R.errors; }

  /** блок на вкладке «Компоновка» — под раскрытием (по умолчанию закрыт, открыт при ошибке): итог, замечания, обязательные
   *  вопросы, шаги расчёта по разделам; допущения, «требует подтверждения» и уточнения «на потом» — ещё одним раскрытием */
  static html(x, i){
    const R=this.run(x), o=StationUi.opts(x), f=CalcNote.f, st=v=>v===true ? '<b class="ok-t">✓</b>' : v===false ? '<b class="bad-t">✕</b>' : '';
    const lvl={ error:'Ошибка — станция не пройдёт', warn:'Предупреждение' }, src=ids=>[...new Set((ids||[]).map(id=>StationRules.short(id)))].join('; ');
    const mg=o=>o.margin==null ? '' : `<div class="${o.margin<0 ? (o.ok ? 'warn-t' : 'bad-t') : 'muted'}">запас ${o.margin>0 ? '+' : ''}${f(o.margin, 1)} %</div>`;
    const sec=R.sections.map(s=>`<h5 class="calc-h">${esc(s.title)}</h5><table class="calc-t"><tbody>${s.steps.map(o=>`<tr><td class="calc-s">${st(o.ok)}</td>
      <td><b>${esc(o.what)}</b>${o.formula ? `<div class="calc-f">${esc(o.formula)}</div>` : ''}${(o.data||[]).length ? `<div class="calc-d">${o.data.map(([k, v])=>`<span>${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</td>
      <td class="calc-res">${esc(o.result||'')}${mg(o)}${(o.rules||[]).length ? `<div class="calc-src">${esc(src(o.rules))}</div>` : ''}</td></tr>`).join('')}</tbody></table>`).join('');
    const iss=R.issues.filter(t=>t.level!=='info'), head=R.errors.length ? ['bad-t', `✕ Ошибок: ${R.errors.length}${R.accept ? ' — отклонения согласованы с заказчиком' : ' — КП не сохранится'}`]
      : R.warnings.length ? ['warn-t', '⚠ Предупреждений: '+R.warnings.length] : R.sections.length ? ['ok-t', '✓ Проверки пройдены'] : ['muted', 'нет данных для расчёта'];
    const li=L=>L.map(a=>`<li>${esc(a)}</li>`).join(''), more=R.assumptions.length+R.weak.length+R.later.length;
    return `<details class="stl-air calc stl-sp"${Spoiler.attr('calc:'+x.id, !!(R.errors.length && !R.accept))}><summary class="stl-air-h"><b>Расчёт станции</b><span class="${head[0]}">${head[1]}</span><small class="muted">формулы, коэффициенты, источники · правила ${esc(R.version)}</small></summary>
      <div class="calc-opts"><label class="stl-chk"><input type="checkbox" data-stl="calc" data-i="${i}"${o.calc ? ' checked' : ''}> в КП — приложение «Расчётная записка и состав станции»</label>
        ${R.errors.length ? `<label class="stl-chk"><input type="checkbox" data-req="${i}" data-rk="accept"${R.accept ? ' checked' : ''}> отклонения согласованы с заказчиком — КП сохраняется</label>` : ''}</div>
      ${iss.length ? `<ul class="stl-iss">${iss.map(t=>`<li class="${t.level}"><b>${lvl[t.level]}:</b> ${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${R.questions.length ? `<h5 class="calc-h">Нужно узнать у заказчика</h5><ol class="calc-l">${li(R.questions)}</ol>` : ''}
      ${sec || '<p class="muted">Укажите производительность и давление (или мощность нагрузки) в «Подборе станции» — расчёт появится здесь.</p>'}
      ${more ? `<details class="calc-more"${Spoiler.attr('calcm:'+x.id)}><summary>Допущения и данные «по умолчанию» (${more}) — расчёт принял их с запасом в пользу заказчика</summary>
        ${R.assumptions.length ? `<h5 class="calc-h">Допущения</h5><ul class="calc-l">${li(R.assumptions)}</ul>` : ''}
        ${R.weak.length ? `<h5 class="calc-h">Требует подтверждения</h5><ul class="calc-l">${R.weak.map(w=>`<li>${esc(w.title)}${w.src && w.src!=='нет данных' ? ` <span class="muted">— ${esc(w.src)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${R.later.length ? `<h5 class="calc-h">Можно уточнить у заказчика позже</h5><ul class="calc-l">${li(R.later)}</ul>` : ''}</details>` : ''}
      <p class="stl-hint muted">Условия для расчёта (высота, влажность, запас, к каким условиям приведена производительность, нагрузка ДЭС) — в «Подборе станции» → «Все требования, условия расчёта и проверки».
        <button class="btn ghost sm" type="button" data-rulesdoc>Инженерные правила и источники (DOCX)</button></p></details>`;
  }

  /** приложение к КП «Расчётная записка и состав станции» — таблицами характеристик (группы {name, rows:[{k, v}]}) */
  static docGroups(x){
    if (!StationUi.on(x) || !isKit(x) || StationUi.opts(x).calc===false) return [];
    const R=this.run(x), f=CalcNote.f; if (!R.sections.length) return [];
    const ok=v=>v===true ? ' — выполняется' : v===false ? ' — НЕ выполняется' : '';
    const mg=o=>o.margin==null ? '' : o.margin<0 && o.ok ? ' (в пределах погрешности данных)' : ' (запас '+f(o.margin, 1)+' %)';
    const req=StationReq.line(x), parts=kitParts(x).filter(p=>p.role!=='container' && String(p.name||'').trim()), c=kitContainer(x);
    const head={ name:'Приложение. Расчётная записка и состав станции', rows:[
      ...(req ? [{ k:'Требования заказчика', v:req }] : []),
      ...(c ? [{ k:'Контейнер', v:[ctypeOf(c.ctype).name, c.size, c.ins, c.climate].filter(Boolean).join(', ') }] : []),
      ...parts.map((p, n)=>({ k:`${n+1}. ${String(p.name).trim()}`, v:`${Math.max(1, +p.qty||1)} шт.`+(KitScope.of(p)==='asm' ? ' (сборщик контейнера)' : '') })),
      { k:'Инженерные правила', v:'версия '+R.version+' — значения коэффициентов и источники в документе «Инженерные правила и источники»' }] };
    const out=[head, ...R.sections.map(s=>({ name:'Расчётная записка: '+s.title.toLowerCase(), rows:s.steps.map(o=>({ k:o.what, v:[o.formula, (o.data||[]).map(([k, v])=>k+': '+v).join('; '), (o.result||'')+ok(o.ok)+mg(o)].filter(Boolean).join('. ') })) }))];
    // заказчику — только расчёт и принятые допущения; внутренние списки («требует подтверждения», вопросы, предупреждения)
    // остаются в программе; ошибки попадают в КП лишь как согласованные отклонения
    if (R.assumptions.length) out.push({ name:'Допущения расчёта', rows:R.assumptions.map((a, i)=>({ k:String(i+1), v:a })) });
    if (R.accept && R.errors.length) out.push({ name:'Отклонения, согласованные с заказчиком', rows:R.errors.map((e, i)=>({ k:String(i+1), v:e.text })) });
    return out;
  }
}
