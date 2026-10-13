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
  static num(v){ return ReqNum.num(v); }   // ошибочное и вне допустимого — не в расчёт (ошибка поля — StationCalc.run)
  /** {kind, req — числа, cls, units — элементы состава по видам, parts} */
  static of(x){
    const r=StationReq.of(x), P=kitParts(x).filter(p=>p.role!=='container'), n=v=>this.num(v), g=k=>ReqNum.check(k, r[k]) ? null : this.num(r[k]);   // g — с проверкой диапазона
    const units=P.map(p=>{ const kind=StationEquip.kindOf(p), info=/^(compressor|dryer|filter|receiver)$/.test(kind) ? AirChain.info(p, kind) : {};
      return { p, kind, qty:Math.max(1, Math.min(20, Math.round(+p.qty||1))), info, name:String(p.name||'').trim(), attrs:p.attrs||{}, rows:p.rows||[] }; });
    return { kind:StationReq.kind(x), cls:StationUi.opts(x).air || '', units, parts:P, recvIn:StationReq.recvIn(x), recvOut:StationReq.recvOut(x),
      req:{ flow:g('flow'), pressure:g('pressure'), basis:r.basis==='normal' ? 'normal' : 'fad', alt:g('alt'), rh:g('rh'), margin:g('margin'),
        reserve:r.reserve!=null && r.reserve!=='' ? Math.max(0, Math.round(n(r.reserve)||0)) : null, work:n(r.work), tmin:g('tmin'), tmax:g('tmax'), tin:g('tin'),
        kw:g('kw'), load:g('load'), hours:g('hours'), motor:g('motor'), start:r.start||'', recvVol:g('recvVol'), mode:r.mode||'',
        q:g('q'), head:g('head'), hsuct:g('hsuct'), tliq:g('tliq'), liquid:r.liquid||'' } };
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
    if (unknown.length){ N.missing('comp.flow', 'Нет производительности: '+[...new Set(unknown.map(o=>o.u.name))].join(', '));
      for (const nm of new Set(unknown.map(o=>o.u.name))) N.issue('warn', `У «${nm}» в карточке не указана производительность — по нему проверка не выполнена; заполните карточку оборудования.`); }
    if (!work.some(o=>o.v>0)) return { need, Q };   // ни у одного рабочего нет производительности — сравнивать не с чем
    const fit=N.fits(sum, need), ok=fit.ok, mg=CalcNote.pct(sum, need);
    N.step({ what:'Компрессоры: рабочие против требуемой', formula:'Σ Qраб ≥ Qтр', data:[['рабочих', work.length+' шт.'], ['резервных', res+' шт.'+(res ? ' (самые крупные — не учитываются)' : '')],
      ...work.slice(0, 6).map((o, i)=>['№ '+(i+1), o.u.name+' — '+f(o.v)+' м³/мин'])], result:'Σ Qраб = '+f(sum)+' м³/мин', ok, margin:mg, note:fit.note, rules:fit.edge ? ['calc.tolerance'] : [], pick:[...new Set(C.map(o=>o.u.name))].join('; ') });
    if (!ok) N.issue('error', `Производительность рабочих компрессоров ${f(sum)} м³/мин меньше требуемой ${f(need)} м³/мин.`);
    if (res){ const big=work.length ? work[0].v : 0, low=spare.filter(o=>o.v<big-1e-9);
      N.step({ what:'Резерв', formula:'резервный не меньше самого крупного рабочего', rules:['flow.reserve'], data:spare.map(o=>['резервный', o.u.name+' — '+f(o.v)+' м³/мин']), ok:!low.length, result:low.length ? 'резервный меньше рабочего' : 'N + '+res });
      if (low.length) N.issue('error', 'Резервный компрессор меньше самого крупного рабочего — при его отказе станция не обеспечит потребность.'); }
    // электродвигатель на высоте и в жару
    const ma=N.rule('flow.motor_alt');
    if (H>ma.h || (r.tmax!=null && r.tmax>ma.t)){ N.issue('warn', `Условия выше номинальных для электродвигателя (до ${ma.h} м и +${ma.t} °C): ${[H>ma.h ? `высота ${f(H, 0)} м` : '', r.tmax!=null && r.tmax>ma.t ? `до +${f(r.tmax, 0)} °C` : ''].filter(Boolean).join(', ')} — снижение мощности по данным изготовителя.`);
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
    // s.k — постоянный множитель серии: номинал производителя указан не для точки росы +3 °C (EXELUTE XRD — для +10 °C)
    if (s){ const kp=this.k(s.f.p, bar), ki=this.k(s.f.inlet, s.f.inlet ? t.tin : null), ka=this.k(s.f.ambient, s.f.ambient ? t.amb : null), kc=s.k>0 ? s.k : 1;
      return { F:kp.k*ki.k*ka.k*kc, s, generic, kp, ki, ka, kc, out:[kp.out && 'давление', ki.out && 'температура входа', ka.out && 'температура помещения'].filter(Boolean) }; }
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
          ...(o.kc!==1 ? [[o.s.kWhat||'поправка серии', f(o.kc, 2)]] : []),
          ['источник', (o.generic ? 'типовые поправки по таблице «'+o.s.title+'» — ' : '')+[o.s.source.doc, o.s.source.item].filter(Boolean).join(', ')]];
        if (o.generic){ N.rule('dryer.generic'); rules.push('dryer.generic');
          N.missing('series.dryer.'+(u.attrs.maker||'')+'.'+(u.attrs.model||u.name), `Данные для расчёта неполные: поправок производителя для осушителя «${u.name}» нет — типовые по таблице «${o.s.title}»`); } }
      else { N.rule('dryer.kp'); N.rule('dryer.margin'); rules.push('dryer.kp', 'dryer.margin');
        data=[['давление', f(p, 1)+' бар → '+f(o.kp.k, 3)+' (типовая таблица)'], ['запас на температуру', '÷ '+f(StationRules.raw('dryer.margin'))]];
        N.missing('series.dryer.'+(u.attrs.maker||'')+'.'+(u.attrs.model||u.name), `Данные для расчёта неполные: поправки производителя для осушителя «${u.name}» не найдены — типовая таблица`); }
      const corr=cap*o.F, fit=N.fits(corr, Q), ok=fit.ok; if (fit.edge) rules.push('calc.tolerance');
      N.step({ what:`${u.name}${u.qty>1 ? ' × '+u.qty+' (параллельно)' : ''}`, formula:o.s ? 'Qосуш · Fp · Fвх'+(o.s.f.ambient ? ' · Fокр' : '')+(o.kc!==1 ? ' · Fтр' : '')+' ≥ Σ Qраб' : 'Qосуш · Kp ÷ запас ≥ Σ Qраб', data:[['номинал', f(cap)+' м³/мин'], ...data, ['через осушитель', f(Q)+' м³/мин']],
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
  /** раздел «Ресиверы» по методике ПНЕВМОТЕХ (ReceiverPlan): приоритеты 1–3, теоретический объём, рекомендация с обоснованием
   *  типоразмера, проверки «на здравый смысл» (ошибки и предупреждения — в замечания); затем учёт в Ростехнадзоре */
  static run(N, q){
    const f=CalcNote.f, l=v=>f(v, 0), C=q.units.filter(u=>u.kind==='compressor'); if (!C.length) return;
    N.section('recv', 'Ресиверы');
    const rq=q.recvIn||{}, eq=StationEquip.list(q.parts, { recv:rq.mode, recvOut:q.recvOut }), R=ReceiverPlan.from(eq, rq);
    if (!R){ N.missing('recv.flow', 'Объём ресивера не рассчитан: у компрессоров не указана производительность'); return; }
    const M=N.rule('receiver.method'), Rv=q.units.filter(u=>u.kind==='receiver');
    N.step({ what:'Приоритет 1. Цикл нагрузки/разгрузки (не более 10–15 циклов в час)', formula:`V = Q / (${M.cycles} · ΔP)`, rules:['receiver.method', ...(rq.dp>0 ? [] : ['pressure.band'])],
      data:[['Q — наибольший компрессор', `${R.big.name} — ${f(R.Q)} м³/мин`], ['ΔP (разгрузка − нагрузка)', `${f(R.dp)} бар${rq.dp>0 ? '' : ' (по правилу, не задан)'}`]], result:`V = ${l(R.V.p1)} л` });
    if (R.V.p2!=null) N.step({ what:'Приоритет 2. Пиковый разбор по циклограмме', formula:'V = T · (C − S) · Pa / (P1 − P2)', rules:['receiver.method'],
      data:[['T — длительность пика', f(R.cyc.T)+' мин'], ['C — расход в пике', f(R.cyc.C)+' м³/мин'], ['S — подача рабочих компрессоров', f(R.S)+' м³/мин'], ['Pa', f(M.pa)+' бар'], ['P1 − P2', f(R.cyc.drop)+' бар']],
      result:R.cyc.C>R.S ? `V = ${l(R.V.p2)} л` : 'компрессоры покрывают пик (C ≤ S): V = 0' });
    if (R.V.p3!=null) N.step({ what:'Приоритет 3. Базовый буфер (поршневой компрессор, циклограммы нет)', formula:'V ≥ 1 · Q (поршневой компрессор)', rules:['receiver.method'],
      data:[['Q', `${f(R.Q)} м³/мин = ${l(R.Q*1000)} л/мин`]], result:`V = ${l(R.V.p3)} л` });
    N.step({ what:'Теоретически необходимый суммарный объём', formula:'винтовой — по циклу (приоритет 1), с циклограммой — не меньше пикового разбора (2), поршневой — не меньше базового буфера (3)'+(R.V.tz ? ', не меньше объёма по ТЗ' : ''),
      data:R.V.tz ? [['по ТЗ', l(R.V.tz)+' л']] : [], result:`V = ${l(R.theor)} л — сработал приоритет ${ReceiverPlan.PRIO[R.prio]}` });
    N.step({ what:'Рекомендация', formula:'ряд 500 → 900 → 1 800 → 2 700 → …: объём ресивера кратно 900 л, 500 л — только при крайней необходимости; число — наименьшее допустимое: не меньше 80 % нужного и 15 % минутной производительности; мокрый — при риске проскока влаги или если задан', rules:['receiver.method'],
      data:[['основной', R.main.why], ...(R.wet ? [['мокрый (30–50 % основного)', R.wet.why]] : []), ...(R.local ? [['у потребителя', R.local.why]] : [])],
      result:ReceiverPlan.text(R), pick:Rv.map(u=>u.name+(u.qty>1 ? ' × '+u.qty : '')).join('; ') });
    const E=R.checks;
    N.step({ what:'Проверки «на здравый смысл»'+(Rv.length ? ' (по составу)' : ' (по рекомендации)'), formula:'запас 80–200 %; 15 % — 5-кратная минутная производительность; запас по давлению; «мёртвый объём»; ряд 900/500; осушитель',
      rules:['receiver.method'], data:E.map(c=>[c.level==='error' ? 'ошибка' : 'предупреждение', c.text]), result:E.length ? `сработало: ${E.length}` : 'Все проверки пройдены.',
      ok:E.some(c=>c.level==='error') ? false : E.length ? null : true });
    for (const c of E) N.issue(c.level, c.text);
    if (!Rv.length) N.issue('warn', `Ресиверов в составе нет — нужно: ${ReceiverPlan.text(R)}.`);
    const pv=N.rule('vessel.pv'), bar=R.bar;
    for (const u of Rv){ const v=u.info.vol||0, x=bar/10*v/1000;
      if (v>0 && bar>0) N.step({ what:'Учёт в Ростехнадзоре: '+u.name, formula:'p · V ≤ '+f(pv)+' МПа·м³', rules:['vessel.pv'], data:[['p', f(bar/10, 2)+' МПа'], ['V', f(v/1000, 3)+' м³']], result:'p·V = '+f(x, 3), ok:x<=pv+1e-9 });
      if (x>pv+1e-9) N.issue('warn', `${u.name}: p·V = ${f(x, 3)} МПа·м³ — подлежит учёту в Ростехнадзоре (ФНП ОРПД).`); }
  }
}

// ---------------------------------------------------------------- вентиляция: лето, зима, рекуперация (VentCalc), жалюзи (StationVent)
// Решение ПНЕВМОТЕХ 12.10: каждый шаг — формула, исходные числа, результат; коэффициенты — из правил vent.*, air.cp.
class VentSizing {
  static run(N, plan){
    const V=plan && plan.vent, H=plan && plan.heat && plan.heat.vent; if (!V) return;
    const f=CalcNote.f, n=StationLayout.n, S=H && H.sum, Wn=H && H.win, Rc=H && H.rec;
    N.section('vent', 'Вентиляция и отопление');
    if (S){ N.rule('air.cp'); N.rule('vent.temps');
      if (S.units.length){
        N.step({ what:'Тепловыделение компрессоров (лето)', formula:'Q = N · k; паспортное тепловыделение — важнее', rules:['vent.k_heat'],
          data:S.units.map(u=>[`поз. ${u.pos} (${VentCalc.TYPE[u.type]})`, u.k!=null ? `${f(u.kw, 1)} кВт · ${f(u.k, 2)}` : 'по паспорту']), result:`Q = ${f(S.Qc, 1)} кВт` });
        N.step({ what:'Перепад температур помещения летом', formula:'Δt = t_вн − t_нар (для тепла помещения); меньше 5 °C — расчёт при 5 °C', rules:['vent.temps'], data:[['t_вн', f(S.tIn, 1)+' °C'], ['t_нар', f(S.tSum, 1)+' °C']],
          result:`Δt = ${f(S.dt, 1)} °C${S.dtRaw<S.dt ? ` (по температурам ${f(S.dtRaw, 1)} °C — мало)` : ''}`, ok:S.dtRaw>=S.dt ? null : false,
          note:S.dtRaw<S.dt ? 'Недостаточный перепад: нужна принудительная вентиляция повышенной мощности или предварительное охлаждение воздуха.' : '' });
        N.step({ what:'Воздух охлаждения компрессоров', formula:'L = Q · 3600 / (c · ρ · Δt_к), ρ = 353 / (273 + t_нар); Δt_к — нагрев воздуха в компрессоре (его вентилятор, горячий воздух — воздуховодом наружу); паспортный расход — важнее', rules:['air.cp', 'heat.cool_dt'],
          data:[['c', f(N.rule('air.cp').c, 3)+' кДж/(кг·°C)'], ['ρ', f(S.rho, 3)+' кг/м³'], ['Δt_к', f(S.dtc, 1)+' °C'], ...S.units.map(u=>[`поз. ${u.pos}`, `${n(u.cool)} м³/ч (${u.src})`])], result:`L = ${n(S.Lcool)} м³/ч` }); }
      N.step({ what:'Вентиляция помещения', formula:'L = Q_пом · 3600 / (c · ρ · Δt) + воздух на сжатие и горение', rules:['heat.case', 'heat.sun'],
        data:[['Q_пом (корпуса, осушители, солнце)', f(S.qRoom, 1)+' кВт'], ['на сжатие и горение', n(S.use)+' м³/ч']], result:`L = ${n(S.Lroom)} м³/ч + ${n(S.use)} м³/ч` });
      N.step({ what:'Проверка по кратности воздухообмена', formula:'L_мин = 3 · V, L_авар = 8 · V', rules:['vent.ach'], data:[['V', f(S.V, 1)+' м³']],
        result:`L_мин = ${n(S.Lmin)} м³/ч, аварийная — ${n(S.Lemerg)} м³/ч${S.raised ? '; расход увеличен до нормативного минимума' : ''}`, ok:true });
      N.step({ what:'Расход воздуха летом', formula:S.units.length ? 'приток = max(охлаждение, помещение) + воздух на сжатие — компрессор протягивает воздух через помещение (один поток); t у входа компрессора = t_нар + Q_пом · 3600 / (c · ρ · L); выброс = воздуховоды компрессоров + общая вытяжка' : 'приток = помещение + воздух на сжатие и горение; выброс = помещение',
        data:[['1 CFM', '1,699 м³/ч'], ...(S.units.length ? [['t у входа компрессора', f(S.tComp, 1)+' °C'], ['общая вытяжка', n(S.Lgen)+' м³/ч']] : [])],
        result:`приток ${n(S.Lin)} м³/ч (${n(S.cfmIn)} CFM), выброс ${n(S.Lout)} м³/ч (${n(S.cfmOut)} CFM)`, ok:S.units.length ? S.tComp<=S.tIn : null });
      if (S.stand && !S.exfan){ N.rule('vent.fan');
        N.step({ what:'Вытяжной вентилятор при остановленных компрессорах', formula:'L = max(солнце · 3600 / (c · ρ · Δt), 3 · V) · 1,15, не меньше 500 м³/ч; P = L · ΔP / (3600 · 1000 · η); с термостатом', rules:['vent.fan', 'heat.sun'],
          data:[['ΔP', S.stand.dp+' Па'], ['η', f(S.stand.eta, 2)]], result:`${n(S.stand.L)} м³/ч, около ${f(S.stand.P, 2)} кВт${S.stand.user ? `; заданный ${n(S.stand.user.q)} м³/ч — ${S.stand.user.ok ? 'достаточно' : 'мал'}` : ''}`, ok:S.stand.user ? S.stand.user.ok : null }); }
      if (S.boost){ N.rule('vent.boost');
        N.step({ what:'Вентилятор в воздуховоде выброса', formula:'P = L · ΔP / (3600 · 1000 · η); приток и выброс — с большей скоростью (компактные жалюзи)', rules:['vent.boost'],
          data:[['L', n(S.boost.L)+' м³/ч'], ['ΔP', S.boost.dp+' Па'], ['η', f(S.boost.eta, 2)]], result:`около ${f(S.boost.P, 2)} кВт; приток ${f(S.vIn, 1)} м/с, выброс ${f(S.vOut, 1)} м/с по рамке` }); }
      if (S.exfan){ N.rule('vent.exfan');
        N.step({ what:'Вытяжные вентиляторы (стена напротив притока, по датчику температуры)', formula:'L_в = L_выброс · запас; P = L_в · ΔP / (3600 · 1000 · η); выброс — через проёмы вентиляторов, приток — до 4 м/с', rules:['vent.exfan'],
          data:[['L_выброс', n(S.Lout)+' м³/ч'], ['запас', f(S.exfan.reserve, 2)], ['ΔP', S.exfan.dp+' Па'], ['η', f(S.exfan.eta, 2)]],
          result:`${n(S.exfan.L)} м³/ч, около ${f(S.exfan.P, 2)} кВт${V.exfan ? ` — ${V.exfan.n} ${V.exfan.n===1 ? 'проём' : 'проёма(ов)'}` : ''}; приток ${f(S.vIn, 1)} м/с, выброс ${f(S.vOut, 1)} м/с по рамке; при остановленных компрессорах — те же вентиляторы` }); } }
    if (V.infan){ N.rule('vent.exfan');
      N.step({ what:'Приточные вентиляторы (жалюзи притока целиком не встали)', formula:'L_в = L_недостающий · запас; S = L_в / (3600 · v_вент) — по рамке; P = L_в · ΔP / (3600 · 1000 · η)', rules:['vent.exfan'],
        data:[['L_недостающий', n(V.infan.q)+' м³/ч'], ['v_вент', f(V.infan.v, 1)+' м/с'], ['ΔP', V.infan.dp+' Па']], result:`${n(V.infan.L)} м³/ч в ${V.infan.n} ${V.infan.n===1 ? 'проёме' : 'проёмах'}, около ${f(V.infan.P, 2)} кВт; включаются по датчику температуры` }); }
    // проёмы по рамке: S = L / (3600 · v), приток — с запасом; поставлено на стенах (и крыше) — против нужного
    const step=(what, kind)=>{ const nd=V.need[kind]; if (!nd) return;
      const roof=kind==='out' ? (V.roof||[]) : [], placed=V.louvers.filter(q=>q.kind===kind).reduce((s, q)=>s+q.w*q.h/1e6, 0)+roof.reduce((s, q)=>s+q.w*q.l/1e6, 0), ok=!(V.short[kind]>0);
      const wh=StationVent.where(V)[kind], list=[V.louvers.some(q=>q.kind===kind) ? 'жалюзи '+StationVent.list(V, kind) : '', roof.length ? 'через крышу '+StationVent.roofList(V) : ''].filter(Boolean).join(', ');
      const vl=kind==='in' ? V.vIn/V.res/V.free : V.vOut/V.free;
      N.step({ what, formula:kind==='in' ? 'S = L / (3600 · v) · запас — по рамке' : 'S = L / (3600 · v) — по рамке', rules:['vent.speed', 'vent.free'],
        data:[['L', n(V.q[kind])+' м³/ч'], ['v', f(nd.v, 1)+' м/с'], ...(kind==='in' ? [['запас', f(V.res, 2)]] : [])],
        result:`S ≥ ${f(nd.gross)} м²; ${list || 'жалюзи —'}${wh ? ' ('+wh+')' : ''}`, ok, margin:CalcNote.pct(placed, nd.gross),
        note:`В живом сечении решётки (${Math.round(V.free*100)} % рамки) — около ${f(vl, 1)} м/с.`+(kind==='out' && S && S.units.length && !S.boost && !S.exfan ? ` Воздуховод с жалюзи — не более ${S.ductDp} Па (штатный вентилятор компрессора): жалюзи с малым сопротивлением, подтвердить по паспорту.` : '') });
      if (!ok) N.issue('warn', `${what}: на стенах не поместилось ${f(V.short[kind])} м² жалюзи (по рамке) — освободите стену или выведите воздух воздуховодом через крышу.`); };
    step('Приточные жалюзи', 'in'); step('Выброс горячего воздуха', 'out');
    const D=V.draft; if (D){ N.rule('vent.fan');
      N.step({ what:'Естественная тяга общей вытяжки', formula:'ΔP = (ρ_нар − ρ_вн) · g · h, ρ = 353 / (273 + t)', rules:['vent.fan'],
        data:[['ρ_нар', f(D.rhoOut, 3)+' кг/м³'], ['ρ_вн', f(D.rhoIn, 3)+' кг/м³'], ['h', f(D.h, 2)+' м']], result:`ΔP = ${f(D.dp, 1)} Па${D.need ? ' — меньше 5 Па' : ''}`, ok:D.need ? null : true });
      if (D.fan) N.step({ what:'Вытяжной вентилятор помещения', formula:'L_в = L · 1,15; P = L_в · ΔP / (3600 · 1000 · η)', rules:['vent.fan'],
        data:[['L', n(D.L)+' м³/ч'], ['ΔP', D.fan.dp+' Па'], ['η', f(D.fan.eta, 2)]], result:`${n(D.fan.L)} м³/ч, напор ≥ ${D.fan.dp} Па, около ${f(D.fan.P, 2)} кВт${D.user ? `; заданный ${n(D.user.q)} м³/ч — ${D.user.ok ? 'достаточно' : 'мало, заменить'}` : ''}`, ok:D.user ? D.user.ok : null }); }
    if (Wn && !Wn.warm){ N.rule('vent.winter');
      N.step({ what:'Зимой: потери через ограждения', formula:'Q = U · A · Δt, Δt = t_вн_мин − t_нар_зима; U — по утеплителю', rules:['heat.lambda', 'heat.rsurf', 'heat.bridge'],
        data:[['U', f(Wn.U, 3)+' Вт/(м²·°C)'], ['A', f(Wn.A, 1)+' м²'], ['Δt', f(Wn.dt, 1)+' °C']], result:`Q_огр = ${f(Wn.Qenv, 2)} кВт` });
      N.step({ what:'Зимой: минимальный воздухообмен', formula:'L = max(2 · V, воздух на сжатие); Q = L · c · ρ · Δt / 3600', rules:['vent.ach'],
        data:[['L', n(Wn.Lw)+' м³/ч']], result:`Q_вент = ${f(Wn.Qvent, 2)} кВт` });
      N.step({ what:'Тепловой баланс зимой при работе', formula:'Q_баланс = Q_тепл − Q_огр − Q_вент (один работающий агрегат, рециркуляция)', rules:['heat.rec'],
        data:[['Q_тепл', f(Wn.Qrun, 2)+' кВт'], ['Q_потерь', f(Wn.Qloss, 2)+' кВт']], result:Wn.bal>=0 ? `профицит ${f(Wn.bal, 2)} кВт — частичная рециркуляция` : `дефицит ${f(-Wn.bal, 2)} кВт — подогрев`, ok:Wn.bal>=0 ? true : null });
      N.step({ what:'Зимой: открытие регулируемых жалюзи', formula:'доля = L_зима / L_лето (не меньше наименьшего открытия клапана); S_зима = S · L_зима / L_лето', rules:['vent.winter'],
        data:[['L_зима / L_лето', f(Wn.ratio, 1)+' %']], result:`открытие ${Wn.open} %; приток ${f(Wn.SinW)} м², выброс ${f(Wn.SoutW)} м²` }); }
    if (Rc && (Rc.on || Rc.worth)){ N.rule('vent.recup'); N.rule('vent.season');
      N.step({ what:`Рекуператор${Rc.on ? '' : ' (оценка — опция не включена)'}`, formula:'t_после = t_нар + η · (t_выб − t_нар); Q = L · ρ · c · η · (t_выб − t_нар) / 3600', rules:['vent.recup'],
        data:[['тип', VentCalc.TYPES[Rc.type]], ['η', f(Rc.eta, 2)], ['t_выб', f(Rc.tExh, 1)+' °C'], ['φ_выб', Rc.phi+' %']],
        result:`t_после = ${f(Rc.tAfter, 1)} °C; Q = ${f(Rc.Q, 2)} кВт; за год ≈ ${n(Rc.year)} кВт·ч (${Rc.days} сут, средняя ${f(Rc.tavg, 1)} °C)`,
        ok:Rc.frost ? false : null, note:[Rc.why.length ? 'Целесообразность: '+Rc.why.join('; ')+'.' : '', Rc.frost ? 'Риск обмерзания.' : '', Rc.measures.length ? 'Защита: '+Rc.measures.join(', ')+'.' : ''].filter(Boolean).join(' ') }); }
    // маркизы: угол открытия — по скорости во входе (на притоке) или выходе (на выбросе) под козырьком
    for (const [kind, Hd, what, rule, vmax] of [['in', V.hood, 'Маркиза на приточных жалюзи (снегозащита)', 'vent.hood_v', N.rule('vent.hood_v')], ['out', V.hoodOut, 'Маркиза на жалюзи выброса (по требованию)', 'vent.speed', V.face]]){
      if (!Hd) continue; const I=V.louvers.filter(q=>q.kind===kind && q.hood), q0=I.reduce((a, q)=>q.hood.v>a.hood.v ? q : a, I[0]), Qi=Math.round(q0.hood.v*3600*q0.hood.w/1000*q0.hood.d/1000);
      N.step({ what, formula:'вход (выход) под козырьком B × d, d = L · sin α — вылет; α — наименьший угол открытия 30…75° (шаг 5°), при котором Q / (3600 · B · d) ≤ v; у всех маркиз один — по самой нагруженной; L — высота жалюзи + 100 мм', rules:[rule],
        data:[['Q', n(Qi)+' м³/ч (жалюзи '+n(q0.w)+' × '+n(q0.h)+' мм)'], ['B × L', n(q0.hood.w)+' × '+n(q0.hood.l)+' мм'], ['v', f(vmax, 1)+' м/с']],
        result:StationVent.hoodText(V, kind), ok:!Hd.over }); }
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
    for (const nm of new Set(q.units.filter(u=>/^(compressor|pump)$/.test(u.kind) && !(CalcInput.num(u.attrs.kw)>0)).map(u=>u.name)))
      N.issue('warn', `У «${nm}» в карточке не указана мощность двигателя — в электрическую нагрузку станции не вошёл; заполните карточку.`);
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
  static TANK_MAX = 4500;   // наибольший бак в отсеке контейнера, л (3 000 × 1 000 × 1 500 мм — StationEquip.guess)
  /** расход топлива ДГУ при доле нагрузки x, л/ч: строки «При нагрузке N %» / «Расход топлива при N % нагрузки»; нет — null */
  static fuel(u, x){
    const T=[]; for (const r of u.rows||[]){ const m=String(r && r.k||'').match(/(\d{2,3})\s*%/); if (!m || !/нагрузк/i.test(String(r.k)) || !/л\s*\/\s*ч/i.test(String(r.k)+' '+String(r.v))) continue;
      const v=AirChain.first(r.v); if (v>0) T.push([+m[1]/100, v]); }
    T.sort((a, b)=>a[0]-b[0]); return T.length>=2 || (T.length===1 && Math.abs(T[0][0]-x)<0.01) ? StationRules.interp(T, x) : null;
  }
  /** топливо на автономность (часы из требований): доля нагрузки, расход одной рабочей ДГУ — по строкам паспорта, иначе
   *  удельный (правило dgu.lph); нужно с запасом dgu.fuel_margin; есть — баки ДГУ и дополнительные. Нет часов или ДГУ — null */
  /** мощность ДГУ, кВт: основной источник — PRP (kw); резервный — ESP (kwMax), нет ESP — PRP (с пометкой, в запас) */
  static cap(attrs, standby){ const prp=CalcInput.num((attrs||{}).kw)||0, esp=CalcInput.num((attrs||{}).kwMax)||0; return standby && esp>0 ? esp : prp; }
  /** полная мощность генератора, кВА: паспорт (kva), нет — PRP / cos φ ном. (dgu.cos) */
  static kva(attrs){ const k=CalcInput.num((attrs||{}).kva)||0, prp=CalcInput.num((attrs||{}).kw)||0; return k>0 ? { v:k, src:'паспорт' } : prp>0 ? { v:prp/StationRules.raw('dgu.cos'), src:'по мощности' } : { v:0, src:'' }; }
  /** топливо на автономность (часы из требований): доля нагрузки, расход каждой рабочей ДГУ — по строкам паспорта, иначе
   *  удельный (правило dgu.lph); c — суммарный расход рабочих, л/ч; нужно с запасом dgu.fuel_margin; есть — баки ДГУ и
   *  дополнительные. Нет часов, ДГУ или мощности — null */
  static fuelPlan(q){
    const r=q.req, G=q.units.filter(u=>u.kind==='dgu'); if (!G.length || !(r.hours>0)) return null;
    const U=G.flatMap(u=>Array.from({ length:u.qty }, ()=>({ u, prp:CalcInput.num(u.attrs.kw)||0 }))).sort((a, b)=>b.prp-a.prp);
    const res=r.reserve!=null ? Math.min(r.reserve, U.length-1) : 0, work=U.slice(res), PRP=work.reduce((s, o)=>s+o.prp, 0);
    if (!(PRP>0)) return null;
    const x=r.kw>0 ? Math.min(1.1, (r.load>0 ? r.kw*r.load/100 : r.kw)/PRP) : StationRules.raw('dgu.fuel_load');
    let c=0, src='паспорт ДГУ'; for (const o of work){ const v=this.fuel(o.u, x); if (v!=null) c+=v; else { c+=StationRules.raw('dgu.lph')*x*o.prp; src='удельный расход (правило)'; } }
    const built=G.reduce((s, u)=>s+this.tank(u)*u.qty, 0), extra=q.units.filter(u=>u.kind==='tank').reduce((s, u)=>s+(AirChain.volume(u.p)||CalcInput.num(u.attrs.tank)||0)*u.qty, 0);
    return { x, c, src, n:work.length, need:c*r.hours*StationRules.raw('dgu.fuel_margin'), built, extra, have:built+extra };
  }
  static plan(x){ return this.fuelPlan(CalcInput.of(x)); }
  static tank(u){ const r=CalcInput.row(u, /^(?:встроенн\S*\s+)?топливн\S*\s+бак|объ[её]м\s+(?:топливного\s+)?бака|[её]мкость\s.*бака/i, /(?:^|[^а-я])л(?:[^а-я]|$)/i); return r ? r.v : CalcInput.num(u.attrs.tank) || 0; }
  static run(N, q, E){
    const r=q.req, f=CalcNote.f, G=q.units.filter(u=>u.kind==='dgu'); N.section('dgu', 'ДГУ');
    if (!G.length){ N.issue('error', 'В составе нет ДГУ.'); return; }
    const standby=/standby|резерв|аварийн/i.test(r.mode||'');
    const units=G.flatMap(u=>Array.from({ length:u.qty }, ()=>u)).map(u=>{ const k=this.kva(u.attrs); return { u, prp:CalcInput.num(u.attrs.kw)||0, esp:CalcInput.num(u.attrs.kwMax)||0, cap:this.cap(u.attrs, standby), kva:k.v, ksrc:k.src }; }).sort((a, b)=>b.prp-a.prp);
    const res=r.reserve!=null ? Math.min(r.reserve, units.length-1) : 0, work=units.slice(res), PRP=work.reduce((s, o)=>s+o.prp, 0), CAP=work.reduce((s, o)=>s+o.cap, 0), KVA=work.reduce((s, o)=>s+o.kva, 0);
    if (r.reserve==null) N.missing('dgu.reserve.tz', 'Резерв ДГУ в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный ДГУ (N+1)?');
    const noKw=[...new Set(units.filter(o=>!(o.prp>0)).map(o=>o.u.name))];
    for (const nm of noKw) N.issue('warn', `У «${nm}» в карточке не указана мощность (PRP) — проверки мощности, нагрузки и топлива по нему не выполнены; заполните карточку.`);
    if (standby && work.some(o=>o.prp>0 && !(o.esp>0))) N.assume('Мощность ESP (резервный режим) в карточке ДГУ не указана — для проверки взята PRP (в запас).');
    if (!(r.kw>0)){ N.issue('info', 'Мощность нагрузки не задана — проверка мощности ДГУ не выполнена.'); N.ask('Мощность нагрузки ДЭС, кВт (длительная и максимальная).'); }
    if (r.kw>0 && CAP>0){ const fit=N.fits(CAP, r.kw), ok=fit.ok;
      N.step({ what:standby ? 'Мощность ESP (резервный источник) против нагрузки' : 'Мощность PRP против нагрузки', formula:'Σ Pраб ≥ Pнагр', rules:[standby ? 'dgu.esp_hours' : 'dgu.prp_avg'],
        data:[['нагрузка', f(r.kw, 0)+' кВт'], ['рабочих ДГУ', work.length+(res ? ' (+'+res+' резерв)' : '')], ...work.slice(0, 4).map(o=>['ДГУ', o.u.name+' — PRP '+f(o.prp, 0)+(o.esp>0 ? ' / ESP '+f(o.esp, 0) : '')+' кВт'])],
        result:(standby ? 'ESP = ' : 'PRP = ')+f(CAP, 0)+' кВт', ok, margin:CalcNote.pct(CAP, r.kw), note:fit.note, pick:[...new Set(G.map(u=>u.name))].join('; ') });
      N.rule(standby ? 'dgu.esp_hours' : 'dgu.prp_avg');
      if (!ok) N.issue('error', `Мощность ДГУ ${f(CAP, 0)} кВт меньше нагрузки ${f(r.kw, 0)} кВт.`);
      const avg=r.load>0 ? r.kw*r.load/100 : r.kw, lim=N.rule('dgu.prp_avg')*PRP, low=N.rule('dgu.minload')*PRP;
      if (!standby && PRP>0){ N.step({ what:'Средняя нагрузка за 24 ч', formula:'Pср ≤ 0,7 · PRP', rules:['dgu.prp_avg'], data:[['Pср', f(avg, 0)+' кВт'+(r.load>0 ? ' ('+f(r.load, 0)+' % от нагрузки)' : ' (график не задан — принята постоянной)')]], result:'0,7 · PRP = '+f(lim, 0)+' кВт', ok:avg<=lim+1e-9 ? true : null });
        if (!(r.load>0)) N.ask('График нагрузки за сутки: средняя нагрузка, % от максимальной.', true);
        if (avg>lim+1e-9) N.issue('warn', `Средняя нагрузка ${f(avg, 0)} кВт больше 70 % PRP (${f(lim, 0)} кВт): для постоянной круглосуточной нагрузки нужна мощность COP (уточните у производителя) или больше ДГУ.`);
        if (avg<low-1e-9) N.issue('warn', `Средняя нагрузка ${f(avg, 0)} кВт меньше ${Math.round(N.rule('dgu.minload')*100)} % PRP (${f(low, 0)} кВт): длительная работа на малой нагрузке ведёт к нагарообразованию — уточните у изготовителя минимальную нагрузку или подберите ДГУ меньшей мощности.`); } }
    // высота и температура: базовые условия изготовителя (dgu.site); выше — мощность снижается по его таблице (в каталоге нет)
    const site=N.rule('dgu.site'), hot=r.tmax!=null && r.tmax>site.t, high=(r.alt||0)>site.alt;
    if (hot || high){ const pb=AirDemand.baro(r.alt||0);
      N.issue('warn', `Условия площадки (${high ? 'высота '+f(r.alt, 0)+' м' : ''}${high && hot ? ', ' : ''}${hot ? 'до +'+f(r.tmax, 0)+' °C' : ''}) выше базовых условий изготовителей ДГУ (до ${f(site.alt, 0)} м и +${f(site.t, 0)} °C): мощность снижается по таблице изготовителя — в каталоге её нет; проверьте запас мощности по паспорту.`);
      N.missing('dgu.derate', 'Снижение мощности ДГУ по высоте и температуре — по таблице изготовителя (в каталоге нет)');
      N.step({ what:'Высота и температура площадки', formula:'местные условия против базовых условий изготовителя', rules:['dgu.site', 'dgu.ref'],
        data:[['высота', f(r.alt||0, 0)+' м → '+f(pb, 1)+' кПа'], ['до', r.tmax!=null ? f(r.tmax, 0)+' °C' : 'не задано']], result:'требуется снижение мощности по данным изготовителя', ok:null }); }
    // пуск наибольшего двигателя от ДГУ
    if (r.motor>0 || (E && E.Sst)){
      const K=N.rule('el.start'), how=r.start && K[r.start] ? r.start : (E && E.how) || '', cos=N.rule('el.cos'), eta=N.rule('el.eta'), P=r.motor>0 ? r.motor : E.kw;
      const S=(how ? K[how] : K.default)*P/(cos*eta), ratio=KVA>0 ? S/KVA : null, dip=N.rule('dgu.dip');
      if (work.some(o=>o.ksrc==='по мощности')) N.assume(`Полная мощность генератора в карточке ДГУ не указана — принята PRP / ${f(N.rule('dgu.cos'), 2)} (cos φ ном.).`);
      if (!how) N.missing('dgu.start', 'Способ пуска двигателя нагрузки не указан — принят прямой');
      N.step({ what:'Пуск наибольшего двигателя от ДГУ', formula:'Sпуск = k · P / (cos φ · η)', rules:['el.start', 'dgu.dip'], data:[['P', f(P, 1)+' кВт'], ['k', f(how ? K[how] : K.default, 1)], ['генератор', KVA>0 ? f(KVA, 0)+' кВА'+(work.some(o=>o.ksrc==='по мощности') ? ' (по мощности)' : '') : 'мощность не указана']],
        result:'Sпуск ≈ '+f(S, 0)+' кВА'+(ratio!=null ? ' ('+f(ratio*100, 0)+' % мощности генератора)' : ''), ok:null,
        note:`Допустимый провал напряжения по ISO 8528-5: G1 — ${dip.G1} %, G2 — ${dip.G2} %, G3 — ${dip.G3} %. Проверка — по паспорту генератора (кВА пуска при провале), в каталоге этих данных нет.` });
      N.missing('dgu.skva', 'Способность генератора к пуску двигателей (кВА пуска при допустимом провале) — по паспорту генератора');
      if (ratio!=null && ratio>1) N.issue('warn', `Пусковая мощность двигателя ≈ ${f(S, 0)} кВА больше мощности генератора ${f(KVA, 0)} кВА — нужен плавный пуск или частотный преобразователь, либо ДГУ больше (проверить по паспорту генератора).`); }
    // топливо
    const fp=this.fuelPlan(q);
    if (fp){ N.rule('dgu.fuel_margin'); if (fp.src!=='паспорт ДГУ') N.rule('dgu.lph'); if (!(r.kw>0)) N.rule('dgu.fuel_load');
      const need=fp.need, have=fp.have;
      N.step({ what:'Запас топлива на автономность', formula:'V = Σ расход рабочих ДГУ(нагрузка) · часы · запас', rules:['dgu.fuel_margin', fp.src==='паспорт ДГУ' ? '' : 'dgu.lph', r.kw>0 ? '' : 'dgu.fuel_load'],
        data:[['нагрузка', f(fp.x*100, 0)+' % PRP'], ['расход', f(fp.c, 1)+' л/ч, все рабочие ДГУ ('+fp.src+')'], ['рабочих ДГУ', String(fp.n)], ['часы', f(r.hours, 0)], ['баки', `ДГУ ${f(fp.built, 0)} л + дополнительные ${f(fp.extra, 0)} л`]],
        result:`нужно ${f(need, 0)} л; в баках ${f(have, 0)} л`, ok:N.fits(have, need).ok, margin:CalcNote.pct(have, need), note:N.fits(have, need).note });
      if (!N.fits(have, need).ok) N.issue('error', `Топлива в баках ${f(have, 0)} л — меньше нужного на ${f(r.hours, 0)} ч (${f(need, 0)} л).`); 
      const big=q.units.filter(u=>u.kind==='tank').map(u=>AirChain.volume(u.p)||CalcInput.num(u.attrs.tank)||0).filter(v=>v>this.TANK_MAX);
      if (big.length) N.issue('warn', `Дополнительный бак ${f(Math.max(...big), 0)} л больше ${f(this.TANK_MAX, 0)} л (3 000 × 1 000 × 1 500 мм) — в отсеке не поместится одним баком: два бака или бак вне контейнера.`); }
  }
}

// ---------------------------------------------------------------- насосная станция: подача, напор, резерв, кавитация
// Рабочие насосы (самые крупные — резерв, N + резерв из ТЗ) работают параллельно на общий коллектор: Σ Qраб ≥ Qтреб, каждый
// рабочий при своей доле подачи Q/n даёт напор не меньше требуемого. Кривые Q–H в каталоге нет — проверка по номинальной
// точке паспорта (подача и напор), рабочая точка по кривой — «требует подтверждения». Кавитационный запас (NPSH):
// NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас (pump.npsh) — только если в паспорте есть NPSHr, а в ТЗ —
// условия всасывания; жидкость — вода (другая — по паспорту и данным заказчика).
class PumpSizing {
  static G = 9.81;
  static units(q){ return q.units.filter(u=>u.kind==='pump').flatMap(u=>Array.from({ length:u.qty }, ()=>u)).map(u=>{
    const Q=StationEquip.top(u.attrs.flow), H=StationEquip.top(u.attrs.head), np=CalcInput.row(u, /NPSH|кавитацион/i);
    return { u, Q:Q ? Q.v : 0, H:H ? H.v : null, range:!!((Q && Q.range) || (H && H.range)), npsh:np ? np.v : null }; }); }
  static run(N, q){
    const r=q.req, f=CalcNote.f, U=this.units(q); N.section('pump', 'Насосы');
    if (!U.length){ N.issue('error', 'В составе нет насосов.'); return; }
    const noQ=[...new Set(U.filter(o=>!(o.Q>0)).map(o=>o.u.name))], noH=[...new Set(U.filter(o=>!(o.H>0)).map(o=>o.u.name))];
    for (const nm of noQ) N.issue('warn', `У «${nm}» в карточке не указана подача — по нему проверка подачи не выполнена; заполните карточку оборудования.`);
    for (const nm of noH) N.issue('warn', `У «${nm}» в карточке не указан напор — по нему проверка напора не выполнена; заполните карточку оборудования.`);
    if (U.some(o=>o.range)) N.assume('Подача или напор насоса в карточке заданы диапазоном («до …») — в расчёте взята верхняя граница; рабочая точка — по кривой Q–H из паспорта.');
    if (r.reserve==null) N.missing('pump.reserve.tz', 'Резерв насосов в ТЗ не задан — расчёт без резерва', 'Нужен ли резервный насос (N+1)?');
    const L=[...U].sort((a, b)=>b.Q-a.Q), res=r.reserve!=null ? Math.min(r.reserve, L.length-1) : 0, work=L.slice(res), Q=work.reduce((s, o)=>s+o.Q, 0), n=work.length;
    if (!(r.q>0)){ N.issue('info', 'Подача станции не задана — проверка насосов не выполнена.'); N.ask('Подача насосной станции, м³/ч, и требуемый напор, м.'); return; }
    const fq=N.fits(Q, r.q), qKnown=work.some(o=>o.Q>0);
    if (qKnown) N.step({ what:'Подача рабочих насосов против требуемой', formula:'Σ Qраб ≥ Qтреб (резервные — самые крупные, не считаются)', rules:['calc.tolerance'],
      data:[['Qтреб', f(r.q, 1)+' м³/ч'], ['рабочих', n+(res ? ' (+'+res+' резерв)' : '')], ...work.slice(0, 4).map(o=>['насос', o.u.name+' — '+(o.Q>0 ? f(o.Q, 1)+' м³/ч' : 'подача не указана')])],
      result:'Σ Qраб = '+f(Q, 1)+' м³/ч', ok:fq.ok, margin:CalcNote.pct(Q, r.q), note:fq.note, pick:[...new Set(work.map(o=>o.u.name))].join('; ') });
    if (qKnown && !fq.ok) N.issue('error', `Подача рабочих насосов ${f(Q, 1)} м³/ч меньше требуемой ${f(r.q, 1)} м³/ч.`);
    // напор: каждый рабочий насос при своей доле подачи (параллельная работа на общий коллектор)
    if (r.head>0){ const H=work.filter(o=>o.H>0);
      if (!H.length) N.missing('pump.head', 'Напор насосов в карточках не указан — проверка напора не выполнена', 'Напор насосов по паспорту, м.');
      else { const low=H.reduce((a, b)=>b.H<a.H ? b : a), share=r.q/n, fh=N.fits(low.H, r.head), over=low.Q>0 && share>low.Q*(1+N.rule('calc.tolerance'));
        N.step({ what:'Напор рабочих насосов против требуемого', formula:'Hнас ≥ Hтреб при подаче каждого Qтреб / n (номинальная точка паспорта)', rules:['calc.tolerance'],
          data:[['Hтреб', f(r.head, 1)+' м'], ['подача на насос', f(share, 1)+' м³/ч'], ['наименьший напор', low.u.name+' — '+f(low.H, 1)+' м'+(low.Q>0 ? ' при '+f(low.Q, 1)+' м³/ч' : '')]],
          result:'Hнас = '+f(low.H, 1)+' м', ok:fh.ok && !over, margin:CalcNote.pct(low.H, r.head), note:fh.note || (over ? 'Подача на насос больше номинальной — напор в этой точке ниже паспортного; проверьте по кривой Q–H.' : '') });
        if (!fh.ok) N.issue('error', `Напор насоса «${low.u.name}» ${f(low.H, 1)} м меньше требуемого ${f(r.head, 1)} м.`);
        N.missing('pump.curve', 'Рабочая точка — по кривой Q–H из паспорта насоса (в каталоге кривых нет), проверка по номинальной точке'); } }
    else N.ask('Требуемый напор насосной станции, м.', true);
    // кавитационный запас: нужны NPSHr (паспорт) и условия всасывания (ТЗ)
    const np=work.filter(o=>o.npsh>0);
    if (r.hsuct!=null && np.length){ const t=r.tliq!=null ? r.tliq : 20, A=N.rule('pump.antoine'), pv=Math.pow(10, A.A-A.B/(A.C+t))*0.133322, pa=AirDemand.baro(r.alt||0), rho=1000, loss=N.rule('pump.suct_loss'), mg=N.rule('pump.npsh');
      const NPSHa=(pa-pv)*1000/(rho*this.G)-r.hsuct-loss, need=Math.max(...np.map(o=>o.npsh))+mg, ok=NPSHa>=need-1e-9;
      N.step({ what:'Кавитационный запас на всасывании', formula:'NPSHa = (pатм − pнп(t)) / (ρ·g) − hвс − hпот ≥ NPSHr + запас', rules:['pump.suct_loss', 'pump.npsh', 'pump.antoine'],
        data:[['pатм', f(pa, 1)+' кПа'], ['pнп('+f(t, 0)+' °C)', f(pv, 2)+' кПа'], ['hвс', f(r.hsuct, 1)+' м'], ['hпот', f(loss, 1)+' м'], ['NPSHr', f(Math.max(...np.map(o=>o.npsh)), 1)+' м']],
        result:'NPSHa = '+f(NPSHa, 1)+' м', ok, margin:CalcNote.pct(NPSHa, need) });
      if (!ok) N.issue('error', `Кавитационный запас на всасывании ${f(NPSHa, 1)} м меньше нужного ${f(need, 1)} м — уменьшите высоту всасывания или подберите насос с меньшим NPSHr.`);
      if (!r.liquid) N.assume('Перекачиваемая жидкость — вода (плотность 1000 кг/м³); другая жидкость — по паспорту насоса и данным заказчика.'); }
    else N.missing('pump.npsh.data', 'Кавитационный запас (NPSH) не проверен: нужны NPSHr по паспорту насоса и высота всасывания по ТЗ');
  }
}

// ---------------------------------------------------------------- весь расчёт станции; вкладка и приложение к КП
class StationCalc {
  static cache=new Map();
  static run(x){
    const q=CalcInput.of(x), plan=StationUi.plan(x), key=JSON.stringify([ReqNum.errors(x), q.req, q.cls, !!StationReq.of(x).accept, q.units.map(u=>[u.name, u.qty, u.attrs]), StationRules.version(), plan.hash]);
    const c=this.cache.get(x.id); if (c && c.key===key) return c.res;
    const N=new CalcNote();
    if (!StationRules.ok()){ N.issue('warn', 'Файл инженерных правил станций не загружен — расчёт не выполнен.'); return N.result(); }
    for (const e of ReqNum.errors(x)) N.issue('error', `Требования: «${e.label}» — ${e.text}. Исправьте значение в «Подборе станции».`);
    for (const G of [plan.gates, plan.gates2].filter(Boolean)) if (G.off && !G.offWhy)
      N.issue('error', `Требования: «Причина смещения ворот» — ворота в торце смещены от оси на ${StationLayout.n(Math.abs(G.off))} мм без причины; укажите причину («Условия для расчёта станции» → «Ворота в торце»).`);
    try{
      if (q.kind==='comp'){ const A=AirDemand.run(N, q), P=PressureBudget.run(N, q, A); DryerSizing.run(N, q, A, P); FilterSizing.run(N, q, A, P); ReceiverSizing.run(N, q); ElectricLoad.run(N, q, plan); }
      else if (q.kind==='dgu') GensetSizing.run(N, q, ElectricLoad.run(N, q, plan));
      else if (q.kind==='pump'){ PumpSizing.run(N, q); ElectricLoad.run(N, q, plan); }
      else ElectricLoad.run(N, q, plan);
      VentSizing.run(N, plan);
    } catch(e){ N.issue('warn', 'Расчёт прерван: '+String(e && e.message || e).slice(0, 200)); }   // ошибка программы не мешает сохранить КП
    const res=N.result(); res.accept=!!StationReq.of(x).accept; this.cache.set(x.id, { key, res }); return res;
  }
  /** блокирующие ошибки расчёта — КП не сохраняется, пока их не исправят или не отметят «отклонения согласованы с заказчиком» */
  static errors(x){ if (!StationUi.on(x) || !isKit(x)) return []; const R=this.run(x); return R.accept ? R.errors.filter(e=>/^Требования: «/.test(e.text)) : R.errors; }   // ошибки ввода «согласованием» не снимаются

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
    // имя файла ТЗ заказчику не показываем; состав — один раз, в разделе «Состав изделия» (здесь — ссылка)
    const req=StationReq.line(Object.assign({}, x, { req:Object.assign({}, x.req||{}, { src:null }) })), parts=kitParts(x).filter(p=>p.role!=='container' && String(p.name||'').trim()), c=kitContainer(x);
    const head={ name:'Приложение. Расчётная записка и состав станции', rows:[
      ...(req ? [{ k:'Требования заказчика', v:req }] : []),
      ...(c ? [{ k:'Контейнер', v:[ctypeOf(c.ctype).name, c.size, c.ins, c.climate].filter(Boolean).join(', ') }] : []),
      ...(parts.length ? [{ k:'Состав станции', v:`${parts.length} поз. — перечень и характеристики в разделе «Состав изделия»` }] : []),
      { k:'Инженерные правила', v:'версия '+R.version+' — значения коэффициентов и источники в документе «Инженерные правила и источники»' }] };
    const out=[head, ...R.sections.map(s=>({ name:'Расчётная записка: '+s.title.toLowerCase(), rows:s.steps.map(o=>({ k:o.what, v:[o.formula, (o.data||[]).map(([k, v])=>k+': '+v).join('; '), (o.result||'')+ok(o.ok)+mg(o)].filter(Boolean).join('. ') })) }))];
    // заказчику — только расчёт и принятые допущения; внутренние списки («требует подтверждения», вопросы, предупреждения)
    // остаются в программе; ошибки попадают в КП лишь как согласованные отклонения
    if (R.assumptions.length) out.push({ name:'Допущения расчёта', rows:R.assumptions.map((a, i)=>({ k:String(i+1), v:a })) });
    if (R.accept && R.errors.length) out.push({ name:'Отклонения, согласованные с заказчиком', rows:R.errors.map((e, i)=>({ k:String(i+1), v:e.text })) });
    return out;
  }
}
