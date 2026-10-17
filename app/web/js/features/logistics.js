// Логистика: вкладка «Логистика» в «Экономике сделки» и тарифы в «Настройках» (расчёт — logistics-calc.js).
// На вкладке — всё о перевозке по каждому поставщику: до границы и страхование (импорт), маршрут по России, груз,
// подобранный транспорт и разгрузка, цены перевозчиков и итог, который идёт в расчёт сделки.
'use strict';

const LG = { rt:{}, tar:null, saved:null, status:null, res:{}, fin:{}, busy:{}, err:{}, tried:{}, qT:{} };

async function lgLoad(force){
  if (LG.tar && !force) return LG.tar;
  try{ LG.saved=await api('/api/logistics'); }catch(e){ LG.saved={}; }
  LG.tar=Freight.tariffs(LG.saved); return LG.tar;
}
async function lgLoadAll(){ await lgLoad(true); try{ LG.status=await api('/api/logistics/status'); }catch(e){ LG.status=null; } }

const lgIn = v => v==null||v==='' ? '' : String(Math.round(v*1000)/1000).replace('.',',');
const lgRu = s => /^росс/i.test(s.country||'') || s.where==='ru';

// Груз, вписанный вручную на вкладке «Логистика»: габариты — в миллиметрах, масса — в килограммах.
// Хранится в s.lg.items[позиция] = {lmm, wmm, hmm, kg} как вписано (текст поля не переписывается под пальцами — иначе
// пропадала запятая: «2,4» превращалось в «24»). Прежние КП хранили метры и тонны {l, w, h, m} — читаются с переводом;
// правка поля переписывает его в новые единицы. Расчёт (Freight.calc) по-прежнему в метрах и тоннах.
class LgCargoIn {
  static KEY = { l:'lmm', w:'wmm', h:'hmm', m:'kg' };
  /** своё значение поля в единицах расчёта (м, т) или null — не вписано */
  static val(o, f){ o=o||{}; const n=lgNum(o[this.KEY[f]]); if (n!=null) return n/1000; return lgNum(o[f]); }
  static has(o, f){ return this.val(o, f)!=null; }
  /** текст поля: вписанное — как вписано; прежнее (м, т) и значение из характеристик — в мм / кг */
  static text(o, f, v){ const raw=(o||{})[this.KEY[f]]; if (raw!=null && String(raw).trim()!=='') return String(raw);
    return v==null ? '' : this.fmt(v, f); }
  static fmt(v, f){ return f==='m' ? String(Math.round(v*10000)/10).replace('.', ',') : String(Math.round(v*1000)); }
  /** ввод в поле: пусто — своё значение убирается (вернутся характеристики) */
  static set(o, f, txt){ delete o[f]; const t=String(txt??'').trim(); if (t==='') delete o[this.KEY[f]]; else o[this.KEY[f]]=t; }
  /** в подписях: масса (т) → «12 400 кг», длина (м) → «7 200 мм» */
  static kg(t){ return Math.round((+t||0)*1000).toLocaleString('ru-RU')+' кг'; }
  static mm(m){ return Math.round((+m||0)*1000).toLocaleString('ru-RU')+' мм'; }
}

// «Своя сумма» доставки по России — в рублях или в валюте (RUB, USD, EUR, CNY): s.logRu = {v, cur}. В рубли переводит расчёт
// сделки (DealCalculator.money) по курсу ЦБ из «Цены КП» (или своему курсу расчёта) — в итоги и график идут рубли.
// Режим «По расчёту» пишет рубли без валюты (src:'module'). Последняя выбранная валюта поставщика — s.lg.manCur.
class LgMoney {
  static cur(s){ const o=s.logRu||{};
    if (o.cur) return DEAL_CURS.includes(o.cur) ? o.cur : 'RUB';
    if (String(o.v??'').trim()!=='') return 'RUB';                      // сумма прежних версий и «по расчёту» — в рублях
    const c=(s.lg&&s.lg.manCur) || LgValues.manCur(); return DEAL_CURS.includes(c) ? c : 'RUB'; }
  static setCur(s, c){ if (!DEAL_CURS.includes(c)) return; s.lg=s.lg||{}; s.lg.manCur=c; s.logRu={v:(s.logRu&&s.logRu.src!=='module'&&s.logRu.v)||'', cur:c}; }
  /** переход на «Своя сумма»: сумма расчёта остаётся (в рублях), иначе — пусто в валюте по умолчанию */
  static toManual(s){ const v=dNum(s.logRu&&s.logRu.v); s.logRu = v ? {v:String(Math.round(v)), cur:'RUB'} : {v:'', cur:(s.lg&&s.lg.manCur)||LgValues.manCur()}; }
  static setDays(s){ const v=s.lg&&s.lg.setDays; return v==null ? LgValues.setDays() : v!==false; }
  /** под полем: «= 92 500 ₽ по курсу ЦБ 92,50 ₽ на 14.10.2026» или «нет курса …» с кнопкой */
  static rubNote(c, cs, cur){ if (cur==='RUB') return '';
    const r=c.rate(cur), P=S.pricing||{};
    if (!(r>0)) return `<small class="bad-t lg-rub">Нет курса ${esc(cur)} — <button type="button" class="lnk" data-dlx="cbr">загрузить курс ЦБ</button> или впишите его в «Цене КП»</small>`;
    const when=c.rateSrc[cur]==='deal' ? 'курс расчёта' : `курс ЦБ${P.rateDate?' на '+esc(KPGen.ruDate(P.rateDate)):''}`;
    return `<small class="muted lg-rub">= <b>${Fmt.rub(cs.Lru)}</b> · ${when}: 1 ${esc(cur)} = ${esc(String(Math.round(r*10000)/10000).replace('.', ','))} ₽</small>`; }
}

// сборка станции: A — кто собирает (к нему везут элементы), toAsm — поставщики элементов (их маршрут — до A)
function lgAsm(){
  const d=S.deal; if (!d || !d.asm || d.asm.on===false) return null;
  const A=d.sup.find(z=>z.id===d.asm.sup); if (!A) return null;
  const parts=kitLines(S).filter(l=>l.part); if (!parts.length) return null;
  return { A, toAsm:new Set(parts.map(l=>dlSupOf(l.id)).filter(id=>id!==A.id)) };
}
// груз сборщика: станция целиком — габариты контейнера, масса — сумма элементов (если у всех она есть)
function lgStations(){
  return S.items.filter(isKit).map(x=>{ const c=kitContainer(x), rows=[...((c&&c.rows)||[])];
    const ms=kitParts(x).map(p=>{ const m=lgCargoOf([{rows:p.rows||[]}]).mass; return m>0 ? m*(+p.qty||1) : null; });
    if (ms.length && ms.every(m=>m>0)) rows.push({k:'Масса станции в сборе', v:String(Math.round(ms.reduce((a,b)=>a+b,0)*1000))+' кг'});
    return {id:'st:'+x.id, name:'Станция в сборе: '+(x.name||'без названия'), qty:+x.qty||1, groups:[{name:'', rows}]}; });
}

// позиции поставщика: масса и габариты — из характеристик, свои правки — в s.lg.items
function lgItems(s){
  const own=(s.lg&&s.lg.items)||{}, asm=lgAsm();
  const list = asm && asm.A===s ? [...lgStations(), ...kitCargo().filter(x=>!String(x.id).includes('~') && dlSupOf(x.id)===s.id)]
    : kitCargo().filter(x=>dlSupOf(x.id)===s.id);
  return list.filter(x=>String(x.name||'').trim()).map(x=>{
    const cg=lgCargoOf(x.groups), o=own[x.id]||{}, d=cg.dims||{};
    const pick=(k,auto)=>{ const v=LgCargoIn.val(o, k); return v!=null ? {v, own:true, t:LgCargoIn.text(o, k, v)} : {v:auto??null, own:false, t:LgCargoIn.text({}, k, auto??null)}; };
    const l=pick('l',d.l), w=pick('w',d.w), h=pick('h',d.h), m=pick('m',cg.mass);
    return { id:x.id, name:x.name, qty:+x.qty||0, l, w, h, m, dimSrc:cg.dimSrc, massSrc:cg.massSrc }; });
}

function lgInput(s){
  const lg=s.lg||{}, T=LG.tar;
  const imp=!lgRu(s) && (s.where==='imp' || !!s.country);
  const from=String(s.wh||'').trim() || (imp ? T.hub : '');
  const asm=lgAsm(), toA=asm && asm.toAsm.has(s.id);        // элементы станции едут на сборку — до склада сборщика
  const to=String(lg.to ?? (toA ? (asm.A.wh||'') : (S.object&&S.object.address || S.clientAddr || ''))).trim();
  // стоимость груза (для страхования): у сборщика — станция целиком (все элементы) и его прочие позиции
  const its=kitCargo().filter(x=>String(x.name||'').trim() && (asm && asm.A===s ? String(x.id).includes('~') || dlSupOf(x.id)===s.id : dlSupOf(x.id)===s.id));
  const value=its.reduce((a,x)=>{ const q=+x.qty||0; if (x.cost) return a+x.cost/100*q*(rateOf(x.costCur||'RUB')||0);
    return a+(x.price||0)/100*q*(rateOf(kpCur())||0); },0);
  // точные адреса (с координатами) — пока текст поля совпадает с выбранной подсказкой
  const gf=s.whGeo&&String(s.whGeo.value||'').trim()===from ? s.whGeo : null;
  const gt=lg.toGeo&&String(lg.toGeo.value||'').trim()===to ? lg.toGeo : toA && asm.A.whGeo && String(asm.A.whGeo.value||'').trim()===to ? asm.A.whGeo : null;
  return { from:{addr:from, geo:gf}, to:{addr:to, geo:gt}, km:lg.km||'', route:lg.route||null, unload:lg.unload||LgValues.unload(), value,
    items:lgItems(s).map(x=>({name:x.name, qty:x.qty, l:x.l.v, w:x.w.v, h:x.h.v, m:x.m.v})), imp };
}

// ---------- расчёт перед каждой отрисовкой «Экономики сделки»: итог доставки по России — в сделку (если не своя сумма)
function lgSync(d){
  if (!LG.tar || DL.ex) return;
  for (const s of d.sup){
    if (!s.lg) s.lg={};
    // прежние сделки: сумма вписана вручную — так и остаётся
    if (s.lg.mode==null) s.lg.mode = s.logRu && String(s.logRu.v??'').trim()!=='' && s.logRu.src!=='module' ? 'manual' : LgValues.mode();
    const r=Freight.calc(lgInput(s), LG.tar), Q=lgQuoteFor(s, r), fin=lgFinal(r, Q, s.lg.pick);
    LG.res[s.id]=r; LG.fin[s.id]=fin;
    if (r.routeKey && !(s.lg.route&&s.lg.route.key===r.routeKey)) lgRoute(s, r);
    if (s.lg.mode==='auto'){
      const v = fin.price>0 && !r.need ? String(fin.price) : '';
      if (!s.logRu || s.logRu.v!==v || s.logRu.src!=='module') s.logRu={v, src:'module'};
      if (lgRu(s) && LgMoney.setDays(s) && r.days>0 && !r.need && String(s.ship)!==String(r.days)) s.ship=String(r.days);
    }
  }
}

// подсказки поля «Откуда»: склады поставщика из справочника (с адресом, режимом работы и контактами)
GEO_EXTRA.wh = inp => { const s=S.deal?dlDeal().sup[+inp.dataset.k]:null; if (!s) return [];
  const dir=(DL.sups||[]).find(x=>x.id===s.dirId) || (typeof dlDir==='function'?dlDir(s.name):null);
  return ((dir&&dir.warehouses)||[]).filter(w=>w.addr).map(w=>({value:w.addr, lat:w.lat??null, lon:w.lon??null, city:w.city||'', exact:w.lat!=null, src:'справочник поставщиков',
    tag:'склад', sub:[w.name, w.hours, w.phone].filter(Boolean).join(' · ')})); };

// расстояние по дорогам между точными адресами (OSRM через сервер); не ответил — остаётся «по прямой с поправкой»
function lgRoute(s, r){
  const key=r.routeKey; if (!key || LG.rt[key]) return; LG.rt[key]='busy';
  api(`/api/geo/route?a=${r.from.lat},${r.from.lon}&b=${r.to.lat},${r.to.lon}`).then(j=>{
    if (j && j.km>0){ LG.rt[key]='ok'; s.lg=s.lg||{}; s.lg.route={key, km:j.km, hours:j.hours, src:j.src}; persist(); dealRender(); }
    else LG.rt[key]=j&&j.error||'нет маршрута';
  }).catch(e=>{ LG.rt[key]=e.message||'нет связи'; });
}

// ---------- предложения перевозчиков (ATI.SU, ПЭК, Энергия, Деловые Линии, КИТ, СДЭК, Возовоз, ЖелДорЭкспедиция) — сервер /api/logistics/quote
function lgQuoteKey(r){ return JSON.stringify([r.from&&r.from.name, r.to&&r.to.name, r.km, r.vehicles.map(v=>v.C.id+':'+Math.round(v.cost)), r.unload&&r.unload.id, Math.round(r.transport||0)]); }
function lgQuoteFor(s, r){ const q=s.lg&&s.lg.quote; return q && q.key===lgQuoteKey(r) ? q : null; }
function lgRateSrc(r){ const src=[...new Set(r.vehicles.map(v=>v.C.src+(v.C.srcAt?' от '+Fmt.dateTime(v.C.srcAt).slice(0,10):'')))]; return src.join('; ')||'тарифы «Настроек»'; }

// предложения «дверь в дверь» в одних условиях: перевозка (+ забор и доставка по городу, если перевозчик возит до терминала)
// + агент-экспедитор + обязательное страхование груза + разгрузка на объекте
function lgOffers(r, Q){
  const T=LG.tar, un=r.unload?r.unload.cost:0, out=[];
  // перевозчик (сборный груз) — без агента: у транспортной компании комиссии агента нет;
  // его страхование (если посчитал) — вместо своего; отдельная машина и расчёт по тарифам — через агента, страхование своё
  const add=(o)=>{ const local=o.local||0, agent=o.kind==='ltl' ? 0 : Math.round((o.base+local+(LgValues.agentUnload()?un:0))*T.agentPct/100);
    const insTk=o.kind==='ltl' && o.insTk>0, ins=insTk ? o.insTk : r.ins;
    out.push({...o, local, agent, ins, insTk, unload:un, total:Math.round(o.base+local+agent+ins+un)}); };
  add({id:'model', src:'Тарифы «Настроек»', kind:'model', base:r.transport, note:[r.vehicles.map(v=>v.C.name).join(' + '), lgRateSrc(r)].filter(Boolean).join('; '), days:r.days});
  for (const o of (Q&&Q.res&&Q.res.offers)||[]){ if (o.kind==='model' || !o.complete) continue;
    const base = o.base!=null ? o.base : o.price-(o.unload||0)-(o.ins||0);
    add({id:o.src, src:o.src, kind:o.kind, base, insTk:+o.ins||0, local:o.door===false ? 2*(r.localLeg||0) : 0, note:o.note||'', days:o.days, url:o.url}); }
  return out;
}

// цена перевозчика, которая во много раз выше остальных (ошибка расчёта перевозчика, негабарит по его правилам), не должна
// становиться «максимальным предложением» сделки: помечается o.outlier = во сколько раз дороже медианы остальных
class LgOutlier {
  static median(a){ const s=[...a].sort((x,y)=>x-y), n=s.length; return n ? (n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2) : 0; }
  static mark(offs){
    const k=LgValues.outlierK(); if (!k || offs.length<3) return offs;
    for (const o of offs){ const m=this.median(offs.filter(x=>x!==o && x.total>0).map(x=>x.total));
      if (m>0 && o.total>k*m) o.outlier=Math.round(o.total/m*10)/10; }
    return offs;
  }
}

// итог: выбранное предложение (s.lg.pick) или максимальное (без «выбросов»); сноска — из чего цена, откуда данные и с чем сравнивали
function lgFinal(r, Q, pick){
  const T=LG.tar, offs=LgOutlier.mark(lgOffers(r, Q)), ok=offs.filter(o=>!o.outlier), pool=ok.length?ok:offs,
    max=pool.reduce((a,o)=>o.total>a.total?o:a, pool[0]);
  const ch=(pick && pick!=='max' && offs.find(o=>o.id===pick)) || max, manualPick=ch!==max || (pick && pick!=='max');
  const parts=[`перевозка ${Fmt.rub(ch.base)}`, ch.local?`забор и доставка по городу ${Fmt.rub(ch.local)}`:'', ch.agent?`агент ${String(T.agentPct).replace('.',',')} % ${Fmt.rub(ch.agent)}`:'',
    ch.insTk?`страхование ${ch.src} ${Fmt.rub(ch.ins)}`:`страхование ${String(T.insPct).replace('.',',')} %${r.insBase?` от ${Fmt.rub(r.insBase)}`:''} ${Fmt.rub(ch.ins)}`, ch.unload?`разгрузка ${Fmt.rub(ch.unload)}`:''].filter(Boolean);
  const others=offs.filter(o=>o!==ch).map(o=>`${o.src} — ${Fmt.rub(o.total)}${o.outlier?` (выброс: в ${String(o.outlier).replace('.',',')} раза дороже остальных, в максимум не взят)`:''}`);
  const when=Q&&Q.res?`, данные на ${Fmt.dateTime(Q.res.at)}`:' (цены перевозчиков ещё не получены)';
  return { price:ch.total, name:ch.src, src:ch.kind, chosen:ch, max, offers:offs, picked:manualPick,
    foot:`Цена — ${manualPick?'выбрано':'максимальное предложение'}: ${ch.src}${ch.note?' ('+ch.note+')':''}${when}. Дверь в дверь: ${parts.join(' + ')}.${others.length?' Для сравнения: '+others.join(', ')+'.':''}` };
}

// ближайшие крупные города (первые в таблице — крупнейшие) в пределах 150 км — для направлений перевозчиков
function lgNearBig(c){ if (!c) return [];
  return LG_CITIES.slice(0,60).filter(x=>x[0]!==c.name).map(x=>({n:x[0], d:lgHav(c,{lat:x[1],lon:x[2]})})).filter(x=>x.d<=150).sort((a,b)=>a.d-b.d).slice(0,2).map(x=>x.n); }

async function lgQuote(k){
  const d=dlDeal(), s=d.sup[k]; if (!s) return; const r=LG.res[s.id];
  if (!r || r.need || LG.busy[s.id]) return;
  const inp=lgInput(s), key=lgQuoteKey(r);
  const its=kitCargo().filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id);
  const declared=its.reduce((a,x)=>a+(x.cost?x.cost/100*(+x.qty||0)*(rateOf(x.costCur||'RUB')||0):0),0);
  const body={ from:{name:r.from&&r.from.name, addr:String(s.wh||'').trim()||(r.from&&r.from.name), alt:lgNearBig(r.from)}, to:{name:r.to&&r.to.name, addr:inp.to.addr, alt:lgNearBig(r.to)}, km:r.km,
    places:inp.items.filter(x=>x.l&&x.w&&x.h&&x.m&&x.qty).map(x=>({l:x.l, w:x.w, h:x.h, m:x.m, qty:x.qty})),
    vehicles:r.vehicles.map(v=>({id:v.C.id, name:v.C.name, extras:Math.round(v.parts.slice(1).reduce((a,p)=>a+p[1],0))})),
    unload:r.unload?r.unload.cost:0, model:Math.round(r.total), modelNote:[r.vehicles.map(v=>v.C.name).join(' + '), lgRateSrc(r)].filter(Boolean).join('; '), declared };
  LG.busy[s.id]=true; LG.err[s.id]=''; LG.tried[key]=true; dealRender();
  try{ const res=await api('/api/logistics/quote',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)});
    s.lg.quote={key, res}; persist(); }
  catch(e){ LG.err[s.id]='Не удалось запросить цены: '+(e.message||e); }
  LG.busy[s.id]=false; dealRender(); SidePanel.render();
}

// цены перевозчиков — сами, когда открыта вкладка и груз посчитан (после паузы во вводе, один раз на набор данных)
function lgAutoQuote(){
  if (!FEAT.on('carriers') || DL.ex || DL.open!=='log' || !LG.tar) return;
  dlDeal().sup.forEach((s,k)=>{ const r=LG.res[s.id]; if (!r || r.need) return; const key=lgQuoteKey(r);
    if (lgQuoteFor(s, r) || LG.tried[key] || LG.busy[s.id]) return;
    clearTimeout(LG.qT[s.id]); LG.qT[s.id]=setTimeout(()=>{ const r2=LG.res[s.id]; if (r2 && lgQuoteKey(r2)===key && DL.open==='log') lgQuote(k); }, 1200); });
}

// ---------- вкладка «Логистика»
function dlLogistics(c){
  const d=dlDeal(), ex=DL.ex, T=LG.tar;
  if (!T) return dlStep(0, 'Логистика', '', '<p class="muted">Загружаю тарифы…</p>', '', null, 'log');
  const asm=lgAsm();
  const cards=d.sup.map((s,k)=>{ const cs=c.sup[k], P=`sup.${k}`, ru=lgRu(s), lg=s.lg||{}, r=LG.res[s.id]||Freight.calc(lgInput(s), T), fin=LG.fin[s.id]||lgFinal(r,null,lg.pick);
    const toA=asm && asm.toAsm.has(s.id), isA=asm && asm.A===s, aName=asm?c.sup[d.sup.indexOf(asm.A)].name:'';
    const its=lgItems(s), inp=lgInput(s), nm=cs.name, Q=lgQuoteFor(s, r);
    const cell=(x,f,ph,lab)=>`<input type="text" inputmode="decimal" data-lgi="${esc(x.id)}" data-k="${k}" data-f="${f}" value="${esc(x[f].t)}" placeholder="${ph}" class="${x[f].v==null?'need':''}${x[f].own?' own':''}" aria-label="${esc(x.name+': '+lab)}" autocomplete="off"${ex?' disabled':''}>`;
    const ownCargo=Object.values(lg.items||{}).some(o=>Object.keys(o).length);
    // 1. до границы и страхование — только импорт
    const abroad = ru ? '' : `<div class="lg-sec lg-s-abr"><h5><span class="lg-sn">1</span>До границы РФ</h5><div class="dl-g">${dlField('Перевозка до границы РФ', P+'.log.v', {calc:c, cur:P+'.log.cur', src:s.log&&s.log.src, q:'Сколько стоит довезти груз от поставщика до границы ЕАЭС. Входит в таможенную стоимость.'})}
      ${dlField('Страхование груза', P+'.ins', {calc:c, unit:'% от оборудования', ph:'0,3', q:'Процент от стоимости оборудования. Входит в таможенную стоимость.'})}</div></div>`;
    const n0=ru?0:1;
    // 2. маршрут
    const pt=(p,what)=>!p?`<span class="bad-t">${what} не найден — впишите адрес или город</span>`
      : p.exact?`<b>${esc(p.name)}</b> <span class="geo-ok" title="${esc(p.lat.toFixed(5)+', '+p.lon.toFixed(5))}">точный адрес ✓</span>`
      : `<b>${esc(p.name)}</b>${p.how==='регион'?' <span class="muted">(центр региона — уточните адрес)</span>':' <span class="muted">(центр города)</span>'}`;
    const rt=r.routeKey&&LG.rt[r.routeKey], rtNote=r.routeKey&&!(lg.route&&lg.route.key===r.routeKey)&&!lgNum(lg.km) ? (rt==='busy'?' · считаю путь по дорогам…':rt&&rt!=='ok'?` · ${rt}`:'') : '';
    const where=[pt(r.from, ru?'склад':'пункт отправки'), pt(r.to, toA?'склад сборщика':'адрес объекта')].join(' → ')
      +(r.km?` · <b>${Fmt.num(r.km)} км</b> <span class="muted">${esc(r.kmSrc)}${lg.route&&lg.route.key===r.routeKey&&!lgNum(lg.km)&&lg.route.hours?', в пути без остановок ≈ '+String(lg.route.hours).replace('.',',')+' ч':''}${esc(rtNote)}</span>`:'');
    const route=`<div class="lg-sec lg-s-route"><h5><span class="lg-sn">${n0+1}</span>${toA?`Маршрут на сборку к «${esc(aName)}»`:isA?'Станция в сборе — до заказчика':'Маршрут по России'}</h5>
      ${toA&&!String(asm.A.wh||'').trim()?`<p class="msg warn">Укажите склад «${esc(aName)}» (адрес производства контейнера) в его карточке ниже — туда едут элементы станции.</p>`:''}
      <div class="lg-route">
        <label class="f"><span>Откуда — ${ru?'склад поставщика':'СВХ / терминал'}${dlQ((ru?'Точный адрес склада поставщика — выберите из подсказок (склады из справочника поставщиков, DaData или OpenStreetMap). Запоминается в справочнике поставщиков.':'Где груз выпускается с таможни и откуда едет по России. По умолчанию — из «Настроек» → «Логистика».')+' Можно вставить координаты или ссылку на точку из Google или Яндекс Карт — адрес определится сам. Достаточно и города — тогда расчёт от центра города.')}</span>
          <input type="text" data-lgf="wh" data-geo="wh" data-k="${k}" value="${esc(s.wh||'')}" placeholder="${esc(ru?'адрес склада, город или координаты':T.hub)}" autocomplete="off"${ex?' disabled':''}></label>
        <label class="f"><span>${toA?`Куда — склад «${esc(aName)}» (сборка)`:'Куда — адрес объекта'}${dlQ('Из раздела «Клиент» (объект или юридический адрес). Выберите точный адрес из подсказок (DaData или OpenStreetMap) или вставьте координаты / ссылку на точку из Google или Яндекс Карт. Можно просто город.')}</span>
          <input type="text" data-lgf="to" data-geo="to" data-k="${k}" value="${esc(lg.to ?? inp.to.addr)}" placeholder="${toA?'адрес производства контейнера':'адрес объекта, город или координаты'}" autocomplete="off"${ex?' disabled':''}></label>
        <label class="f lg-km"><span>Расстояние, км${dlQ('Расстояние по дорогам (OSRM, карты OpenStreetMap): между точными адресами, а если адрес не уточнён — от центра города. Пока маршрут не посчитан (нет связи) — по прямой с поправкой на дороги (точность ±5–10 %). Знаете точное — впишите.')}</span>
          <input type="text" inputmode="numeric" data-lgf="km" data-k="${k}" value="${esc(lg.km||'')}" placeholder="${r.km?esc(r.km)+' — авто':'авто'}"${ex?' disabled':''}></label></div>
      <p class="lg-where">${where}</p></div>`;
    // 3. груз
    const cargo=`<div class="lg-sec lg-s-cargo"><h5><span class="lg-sn">${n0+2}</span>Груз${dlQ('Масса и габариты — из характеристик позиций («Масса», «Габариты Д × Ш × В»). Габариты — в миллиметрах, масса одного места — в килограммах (например, 2400 × 1200 × 1800 и 1500). Пустые поля заполните; кнопка ниже сохранит их в каталог. К местам легче '+LgCargoIn.kg(T.packMax)+' добавляется упаковка +'+lgIn(T.pack)+' %.')}</h5>
      ${its.length?`<div class="lg-tw"><table class="lg-t"><thead><tr><th>Позиция</th><th class="num">Мест</th><th>Длина, мм</th><th>Ширина, мм</th><th>Высота, мм</th><th>Масса 1 шт, кг</th></tr></thead><tbody>
        ${its.map(x=>`<tr><td class="lg-nm"><b>${esc(x.name)}</b><small>${esc([x.dimSrc, x.massSrc].filter(Boolean).join(' · ')||'нет габаритов и массы в характеристиках')}</small></td><td class="num">${esc(x.qty)}</td>
          <td>${cell(x,'l','Д, мм','длина, мм')}</td><td>${cell(x,'w','Ш, мм','ширина, мм')}</td><td>${cell(x,'h','В, мм','высота, мм')}</td><td>${cell(x,'m','кг','масса 1 шт, кг')}</td></tr>`).join('')}</tbody></table></div>
        ${ownCargo&&!ex?`<div class="lg-row"><button class="btn ghost" type="button" data-lgx="savecargo" data-k="${k}">Сохранить массу и габариты в каталог</button><span class="muted">вписанные значения — в карточки позиций, в следующий раз подставятся сами</span></div>`:''}`
        :'<p class="muted">У этого поставщика нет позиций в КП.</p>'}</div>`;
    // 4. транспорт и разгрузка
    const veh=r.need?`<p class="msg">${esc(r.need)}${r.missing.length?`: ${esc(r.missing.join(', '))}`:''}</p>`
      : r.vehicles.map((v,i)=>`<div class="lg-veh"><div class="lg-vh"><b>${r.vehicles.length>1?`Машина ${i+1}: `:''}${esc(v.C.name)}</b>
        <span class="muted">${v.units.length} ${plural(v.units.length,'место','места','мест')} · ${LgCargoIn.kg(v.fit.mass)} · занято ${LgCargoIn.mm(v.fit.depth)} из ${LgCargoIn.mm(v.C.L)}</span>
        ${v.over?'<span class="lg-tag warn">негабарит</span>':''}${v.heavy?'<span class="lg-tag warn">тяжеловес</span>':''}${v.escort?'<span class="lg-tag bad">прикрытие</span>':''}</div>
        <table class="lg-p">${v.parts.map(([t,a])=>`<tr><td>${esc(t)}</td><td class="num">${Fmt.rub(a)}</td></tr>`).join('')}</table></div>`).join('')
        + (r.unload?`<div class="lg-veh"><table class="lg-p"><tr><td>Разгрузка: ${esc(r.unload.name)}</td><td class="num">${Fmt.rub(r.unload.cost)}</td></tr></table></div>`:'')
        + r.warn.map(w=>`<p class="msg warn">${esc(w)}</p>`).join('')
        + (r.missing.length?`<p class="msg warn">Не посчитаны (нет массы или габаритов): ${esc(r.missing.join(', '))}</p>`:'');
    const trans=`<div class="lg-sec lg-s-trans"><h5><span class="lg-sn">${n0+3}</span>Транспорт и разгрузка${dlQ('Машина подбирается по массе и габаритам: самая дешёвая из тарифов, куда помещается груз. Рейс — подача + ставка за км до 1 000 км + «дальняя» ставка дальше (не меньше минимального заказа). Морской контейнер 20 или 40 футов едет на контейнеровозе. Негабарит (шире 2,55 м, выше 4 м от дороги), тяжеловес (тяжелее грузоподъёмности без разрешения) и прикрытие — по правилам РФ. Ставки — «Настройки» → «Тарифы доставки».')}</h5>
      <label class="f lg-un"><span>Разгрузка на объекте</span><select data-lgf="unload" data-k="${k}"${ex?' disabled':''}>
        <option value="auto"${(lg.unload||LgValues.unload())==='auto'?' selected':''}>Подобрать по самому тяжёлому месту</option>
        <option value="none"${(lg.unload||LgValues.unload())==='none'?' selected':''}>Не нужна (разгружает заказчик)</option>
        ${T.unload.map(u=>`<option value="${esc(u.id)}"${(lg.unload||LgValues.unload())===u.id?' selected':''}>${esc(u.name)} — ${Fmt.rub(u.cost)}</option>`).join('')}</select></label>
      ${veh}<p class="muted lg-note">Ставки за км: ${esc(lgRateSrc(r))}. Погрузка на складе поставщика обычно за его счёт.</p></div>`;
    // 5. цены перевозчиков — все «дверь в дверь», с агентом и страхованием; выбор — любое или максимальное
    const pv=(LG.status&&LG.status.providers)||{}, noKey=[!pv.ati?'ATI.SU':'', !pv.dellin?'Деловые Линии':'', !pv.kit?'КИТ':'', !pv.cdek?'СДЭК':'', !pv.vozovoz?'Возовоз':''].filter(Boolean);
    const pick=lg.pick||'max', nmR=`lgpick${k}`;
    const kindT={model:'расчёт по тарифам',ftl:'отдельная машина',ltl:'сборный груз'};
    const offers = r.need ? '' : `<div class="lg-sec lg-s-off"><h5><span class="lg-sn">${n0+4}</span>Перевозчик и цена${dlQ('Все цены — от двери до двери в одних условиях: перевозка (если перевозчик возит до терминала — плюс забор и доставка по городу по тарифам), обязательное страхование груза и разгрузка. Страхование — перевозчика, если он его считает (по объявленной стоимости груза), иначе своё: '+String(T.insPct).replace('.',',')+' %, не меньше '+Fmt.rub(T.insMin)+'. Агент-экспедитор ('+String(T.agentPct).replace('.',',')+' %) — только для отдельной машины и расчёта по тарифам, на перевозку, разрешения, прикрытие'+(LgValues.agentUnload()?' и разгрузку':'')+' (страхование — без агентских): у транспортной компании комиссии агента нет. Отдельная машина — ATI.SU «Средние ставки» (верхняя граница за 30 дней, с НДС); сборный груз — ПЭК, Энергия, Деловые Линии, КИТ, СДЭК, Возовоз, ЖелДорЭкспедиция; крупногабаритный и длинномерный груз (больше пределов сборного) — ЖелДорЭкспедиция с надбавкой за негабарит. По умолчанию в сделку идёт максимальное предложение; можно выбрать перевозчика.')}
        ${ex?'':`<button class="btn ghost lg-qb" type="button" data-lgx="quote" data-k="${k}"${LG.busy[s.id]?' disabled':''}>${LG.busy[s.id]?'Запрашиваю…':Q?'Обновить цены':'Запросить цены'}</button>`}</h5>
      ${noKey.length&&!ex?`<p class="muted lg-note">Не подключены: ${esc(noKey.join(', '))} — ключи в «Настройки → Ключи API».</p>`:''}
      ${LG.err[s.id]?`<p class="msg err">${esc(LG.err[s.id])}</p>`:''}
      <div class="lg-tw"><table class="lg-p lg-of"><tbody>
        <tr class="${pick==='max'?'on':''}"><td><label class="lg-pk"><input type="radio" name="${nmR}" data-lgpick="max" data-k="${k}"${pick==='max'?' checked':''}${ex?' disabled':''}><b>Максимальное предложение</b></label><small>рекомендуется: запас на рост ставок — сейчас ${esc(fin.max.src)}</small></td><td></td><td></td><td class="num">${Fmt.rub(fin.max.total)}</td></tr>
        ${fin.offers.map(o=>`<tr class="${pick===o.id?'on':''}${o===fin.max?' best':''}"><td><label class="lg-pk"><input type="radio" name="${nmR}" data-lgpick="${esc(o.id)}" data-k="${k}"${pick===o.id?' checked':''}${ex?' disabled':''}><b>${esc(o.src)}</b></label>
            <small>${esc(o.note||'')}${o.local?` · + забор и доставка по городу ${Fmt.rub(o.local)}`:''} ${o.agent?' · агент '+Fmt.rub(o.agent):''} · страхование ${o.insTk?'перевозчика ':''}${Fmt.rub(o.ins)}${o.unload?' · разгрузка '+Fmt.rub(o.unload):''}</small></td>
          <td>${esc(kindT[o.kind]||'')}</td><td class="num">${o.days?esc(o.days)+' дн.':''}</td><td class="num">${Fmt.rub(o.total)}${o===fin.max?' <span class="lg-tag">макс.</span>':''}${o.outlier?` <span class="lg-tag bad" title="Дороже середины остальных предложений в ${esc(String(o.outlier).replace('.',','))} раза — в максимум не берётся (порог — «Настройки → Значения программы → Логистика»). Проверьте цену на сайте перевозчика; выбрать можно вручную.">выброс</span>`:''}</td></tr>`).join('')}
      </tbody></table></div>
      ${Q&&Q.res.errors.length?`<ul class="lg-errs">${Q.res.errors.map(e=>`<li class="${e.skip?'muted':''}"><b>${esc(e.src)}:</b> ${esc(e.msg)}${e.url&&!e.skip?` <a href="${esc(e.url)}" target="_blank" rel="noopener">посчитать на сайте ↗</a>`:''}</li>`).join('')}</ul>`:''}
      <p class="muted lg-note">${Q?'Цены перевозчиков запрошены '+esc(Fmt.dateTime(Q.res.at)):LG.busy[s.id]?'Запрашиваю цены перевозчиков…':'Цены перевозчиков ещё не запрошены — пока только расчёт по тарифам.'}</p></div>`;
    // итог — в сделку
    const manual=lg.mode==='manual', cur=dNum(s.logRu&&s.logRu.v)||0, ch=fin.chosen, mc=LgMoney.cur(s);
    const brk=[['Перевозка', ch.base], ['Забор и доставка по городу', ch.local], [`Агент-экспедитор ${String(T.agentPct).replace('.',',')} %`, ch.agent],
      [ch.insTk?`Страхование груза — ${ch.src} (по объявленной стоимости${r.insBase?' '+Fmt.rub(r.insBase):''})`:`Страхование груза ${String(T.insPct).replace('.',',')} %${r.insBase?' от '+Fmt.rub(r.insBase):''}`, ch.ins], ['Разгрузка', ch.unload]].filter(x=>x[1]);
    const total=`<div class="lg-tot"><div><small>Доставка по России, дверь в дверь → в расчёт сделки</small>
        ${manual?`<span class="dl-in cur lg-man"><input type="text" inputmode="decimal" data-lgman="${k}" value="${esc(s.logRu&&s.logRu.v||'')}" placeholder="сумма" aria-label="Своя сумма доставки"${c.err[P+'.logRu']?' aria-invalid="true"':''}${ex?' disabled':''}><select data-lgcur="${k}" aria-label="Валюта своей суммы"${ex?' disabled':''}>${DEAL_CURS.map(x=>`<option${x===mc?' selected':''}>${x}</option>`).join('')}</select></span>${LgMoney.rubNote(c, cs, mc)}`:`<b>${Fmt.rub(cur||fin.price)}</b>`}
        <span class="muted">${manual?'своя сумма (например, по счёту перевозчика)'+(mc==='RUB'?'':' — в расчёт сделки идут рубли по курсу ЦБ'):(fin.picked?'выбрано: ':'максимальное предложение: ')+esc(fin.name)}${r.days&&!r.need?` · в пути ≈ ${r.days} ${plural(r.days,'день','дня','дней')}`:''}</span>
        ${manual?'':`<table class="lg-p lg-brk">${brk.map(([t,v])=>`<tr><td>${esc(t)}</td><td class="num">${Fmt.rub(v)}</td></tr>`).join('')}</table>`}</div>
      <div class="lg-act">${ex?'':`<span class="dl-seg"><button type="button" class="${manual?'':'on'}" data-lgx="mode" data-k="${k}" data-v="auto">По расчёту</button><button type="button" class="${manual?'on':''}" data-lgx="mode" data-k="${k}" data-v="manual">Своя сумма</button></span>`}
        ${ru&&!ex?`<label class="cw-chk"><input type="checkbox" data-lgf="setDays" data-k="${k}"${LgMoney.setDays(s)?' checked':''}> срок в пути → «Доставка до заказчика»</label>`:''}</div></div>
      ${manual?'':`<p class="muted lg-note lg-foot">${esc(fin.foot)}</p>`}`;
    return `<div class="dl-card lg-card">${d.sup.length>1?`<div class="lg-ch"><b>${esc(nm)}</b><span class="muted">${ru?'покупаем в России':'ввозим сами'}${toA?` · везём на сборку к «${esc(aName)}»`:isA?' · собирает станцию и везёт заказчику':''}</span></div>`:''}
      ${abroad}${route}${cargo}${trans}${offers}${total}</div>`; }).join('');
  const sum=c.sup.reduce((a,x)=>a+x.L+x.Lru+x.ins,0);
  return dlStep(0, 'Логистика', asm?`Станция собирается у «${esc(c.sup[d.sup.indexOf(asm.A)].name)}»: поставщики элементов везут их туда, а собранная станция едет к заказчику одним грузом (габариты контейнера, масса — сумма элементов). Итог по каждому поставщику сразу идёт в расчёт сделки.`:'Перевозка от поставщика до объекта заказчика: маршрут, груз, транспорт, цены перевозчиков. Итог по каждому поставщику сразу идёт в расчёт сделки.',
    cards, '', ['Итого логистика', sum, 'до границы, страхование и доставка по России'], 'log');
}

// ---------- ввод на вкладке (обработчики вешаются на окно «Экономики сделки» — dealBind → lgBind)
function lgBind(dlg, touch){
  const upd=t=>{ const k=+t.dataset.k, d=dlDeal(), s=d.sup[k]; if (!s || DL.ex) return false; if (!s.lg) s.lg={};
    if (t.dataset.lgf){ const f=t.dataset.lgf;
      if (f==='wh'){ s.wh=t.value; clearTimeout(LG.whT); LG.whT=setTimeout(()=>dlSaveSupplier(s), 800); }
      else if (f==='setDays') s.lg.setDays=t.checked;
      else s.lg[f]=t.value;
      return true; }
    if (t.dataset.lgi){ const id=t.dataset.lgi, f=t.dataset.f; s.lg.items=s.lg.items||{}; const o=s.lg.items[id]=s.lg.items[id]||{};
      LgCargoIn.set(o, f, t.value); if (!Object.keys(o).length) delete s.lg.items[id]; return true; }
    return false; };
  dlg.addEventListener('input', e=>{ const t=e.target;
    if (t.dataset.lgman!=null){ const s=dlDeal().sup[+t.dataset.lgman]; if (!s||DL.ex) return; s.logRu={v:t.value, cur:LgMoney.cur(s)}; touch(); return dealRender(); }
    if ((t.dataset.lgf||t.dataset.lgi) && t.tagName==='INPUT' && t.type!=='checkbox' && upd(t)){ touch(); dealRender(); } });
  // выбран точный адрес из подсказок (или по координатам / ссылке карт)
  dlg.addEventListener('geo:pick', e=>{ const t=e.target, k=+t.dataset.k, s=dlDeal().sup[k]; if (!s || DL.ex || !t.dataset.lgf) return; s.lg=s.lg||{};
    const g={...e.detail}; delete g.note;
    if (t.dataset.lgf==='wh'){ s.wh=g.value; s.whGeo=g; dlSaveSupplier(s); }
    else if (t.dataset.lgf==='to'){ s.lg.to=g.value; s.lg.toGeo=g; }
    touch(); dealRender(); });
  dlg.addEventListener('change', e=>{ const t=e.target;
    if (t.dataset.lgcur!=null){ const s=dlDeal().sup[+t.dataset.lgcur]; if (!s||DL.ex) return; LgMoney.setCur(s, t.value); touch(); return dealRender(); }
    if (t.dataset.lgpick!=null){ const s=dlDeal().sup[+t.dataset.k]; if (!s||DL.ex) return; s.lg=s.lg||{}; s.lg.pick=t.dataset.lgpick; touch(); return dealRender(); }
    if ((t.tagName==='SELECT'||t.type==='checkbox') && t.dataset.lgf && upd(t)){ touch(); dealRender(); } });
  dlg.addEventListener('click', e=>{ const b=e.target.closest('[data-lgx]'); if (!b || DL.ex) return; const k=+b.dataset.k, s=dlDeal().sup[k]; if (!s) return;
    if (b.dataset.lgx==='quote'){ delete LG.tried[lgQuoteKey(LG.res[s.id]||{vehicles:[]})]; return lgQuote(k); }
    if (b.dataset.lgx==='savecargo') return lgSaveCargo(s).then(()=>dealRender());
    if (b.dataset.lgx==='mode'){ s.lg=s.lg||{}; s.lg.mode=b.dataset.v;
      if (s.lg.mode==='manual') LgMoney.toManual(s);
      touch(); dealRender(); setTimeout(()=>{ if (s.lg.mode==='manual') dlg.querySelector(`[data-lgman="${k}"]`)?.focus(); }, 30); } });
}

// вписанные в расчёт масса и габариты — в характеристики позиции КП и в карточку каталога
// (иначе при сохранении КП каталог получил бы прежние характеристики позиции)
async function lgSaveCargo(s){
  const own=(s.lg&&s.lg.items)||{}, its=lgItems(s);
  let saved=0, pend=0; const noCat=[], fail=[];
  for (const id of Object.keys(own)){
    const o=own[id], x=kitCargo().find(i=>i.id===id), it=its.find(i=>i.id===id); if (!x || !it) continue;
    const v={l:it.l.v, w:it.w.v, h:it.h.v, m:it.m.v};
    const what={ dims:['l','w','h'].some(k=>LgCargoIn.has(o, k)) && v.l>0 && v.w>0 && v.h>0, mass:LgCargoIn.has(o, 'm') && v.m>0 };
    if (!what.dims && !what.mass) continue;
    lgWriteCargo(x, v, what);
    if (!x.catId){ noCat.push(x.name); delete own[id]; continue; }
    try{ const doc=await CatSrv.get(x.catId); lgWriteCargo(doc, v, what); doc.updatedAt=new Date().toISOString();
      const r=await CatSrv.put(doc); if (r && r._pending) pend++; else saved++; delete own[id]; }
    catch(e){ fail.push(x.name+(e.code==='conflict'?' (карточку изменили — откройте расчёт заново)':'')); }
  }
  persist(); renderForm();
  if (typeof refreshCat==='function') refreshCat();
  toast([saved?`Масса и габариты сохранены в каталог: ${saved}`:'', pend?`отправлено на модерацию: ${pend}`:'', noCat.length?`нет в каталоге (записано только в КП): ${noCat.join(', ')}`:'',
    fail.length?`не сохранено: ${fail.join(', ')}`:''].filter(Boolean).join(' · ') || 'Нечего сохранять');
}

// ---------- «Настройки» → «Логистика»: тарифы (администратор)
const LG_SC=[['far','Граница дальнего рейса, км (дальше — «дальняя» ставка)',''],['agentPct','Агент-экспедитор (отдельная машина), %',''],['insPct','Страхование груза, % от стоимости (если перевозчик не страхует сам)',''],['insMin','Страхование: минимальная премия, ₽',''],
  ['hub','Импорт: город СВХ / терминала по умолчанию','text'],['permitAgent','Оформление разрешения через агента, ₽',''],['overKLowbed','Негабарит на трале: множитель ставки',''],['roadK','Коэффициент дорог: европейская часть',''],['roadKE','… Урал и Сибирь',''],['roadKFE','… восточнее Байкала',''],
  ['localKm','Доставка по городу, км',''],['pack','Упаковка лёгких мест, % к массе',''],['packMax','Без упаковки — места тяжелее, т',''],
  ['overK','Негабарит на площадке: множитель ставки',''],['permit','Госпошлина за спецразрешение, ₽ за машину',''],['heavyFrom','Тяжеловес — груз в машине тяжелее, т',''],
  ['heavyPermit','Госпошлина за разрешение на тяжеловес, ₽',''],['harmKm','Вред дорогам (тяжеловес), ₽/км',''],['escortW','Прикрытие — груз шире, м',''],['escortKm','Автомобиль прикрытия, ₽/км',''],['gibddW','Сопровождение ГИБДД — груз шире, м (предупреждение)',''],
  ['kmDay','Пробег в сутки, км',''],['kmDayOver','Пробег негабарита в сутки, км',''],['permitDays','Оформление разрешения, раб. дней',''],['range','Разброс оценки, ± %','']];
const LG_CC=[['name','Транспорт','text'],['L','Длина площадки, м'],['W','Ширина, м'],['h','Высота груза, м'],['hMax','Высота со спецразр., м'],['wMax','Ширина со спецразр., м'],
  ['t','Грузоподъём., т'],['tLegal','Без разреш. на тяжеловес, т'],['km','₽/км до 1 000 км'],['kmFar','₽/км дальше'],['base','Подача, ₽'],['min','Минимум, ₽']];

// «Настройки» → «Тарифы доставки»: машины, разгрузка, общие параметры, автообновление ATI.SU и сверка со счетами
class FreightSettings {
  static async open(m){
  await lgLoad(true);
  let stt=null; try{ stt=await api('/api/logistics/status'); }catch(e){}
  const au=(stt&&stt.auto)||null, cfg=(stt&&stt.settings)||{on:true, days:1, period:30, routes:[]}, pv=(stt&&stt.providers)||{};
  const T=LG.tar, inp=(v,t)=>`<input type="${t==='text'?'text':'text'}" inputmode="${t==='text'?'text':'decimal'}" value="${esc(t==='text'?v:lgIn(v))}">`;
  m.innerHTML=`<div class="st-card"><div class="sub st-mh">Тарифы по России ${tip('<p>По ним «Экономика сделки» считает доставку со склада поставщика до объекта: машина подбирается по массе и габаритам груза; рейс — подача + ставка за км до 1 000 км + «дальняя» ставка за км дальше (дальний рейс дешевле за км), не меньше минимального заказа; к рейсу добавляются негабарит, тяжеловес, прикрытие и разгрузка. Ставки — с НДС 22 %, ставка перевозчика (агент — отдельно).</p><p>Стандартные значения откалиброваны по рынку осени 2026 года. Точнее всего — по вашим счетам: впишите 5–10 последних счетов в «Сверку со счетами перевозчиков» внизу, программа покажет ошибку тарифа и предложит поправку.</p><p>Негабарит по правилам РФ: шире 2,55 м или выше 4 м от дороги (высота груза на площадке — в столбце «Высота груза»). На открытой площадке груз до 2,55 м шириной едет без спецразрешения.</p>')}</div>
    <div class="row lg-file"><button class="btn ghost" type="button" data-lgtpl>Скачать тарифы файлом (шаблон)</button>
      <input type="file" id="lgFile" accept=".xlsx,.csv,.txt" class="sr-file"><label for="lgFile" class="btn">Загрузить тарифы из файла…</label>
      ${tip('<p>Файл Excel (.xlsx) или CSV из шаблона: три таблицы — «Транспорт», «Разгрузка», «Параметр». Скачайте шаблон (в нём ваши текущие тарифы), поправьте ставки и загрузите. Перед применением программа покажет, что изменится.</p><p>Ставки из файла закрепляются: автообновление по ATI.SU для этих машин выключается (включить — галочка «Авто»).</p>')}</div>
    <div id="lgImp"></div>
    <details class="lg-src"><summary>Откуда стандартные ставки</summary><ul>${Freight.DEFAULTS.sources.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>
    <p class="muted">${LG.saved&&LG.saved.updatedAt?`Изменены ${esc(Fmt.dateTime(LG.saved.updatedAt))}${LG.saved.updatedBy?' · '+esc(LG.saved.updatedBy):''}`:'Стандартные значения — уточните по счетам перевозчиков'}</p>
    <div class="lg-auto">
      <div class="sub st-mh">Автообновление ставок за км ${tip('<p>Раз в заданное число дней программа запрашивает у ATI.SU «Средние ставки» по опорным направлениям и берёт <b>верхнюю границу</b> средних ставок за период (с НДС) — максимум по направлениям — для каждого класса машины.</p><p>Нужна лицензия «API Средних ставок» ATI.SU и ключ в «Настройки → Ключи API». Снимите галочку «Авто» у машины, чтобы закрепить свою ставку.</p>')}</div>
      <p class="${pv.ati?'muted':'bad-t'}">${pv.ati?'Ключ ATI.SU задан.':'Ключ ATI.SU не задан — автообновление не работает («Настройки → Ключи API»).'}
        ${au&&au.at?` Последнее обновление: <b>${esc(Fmt.dateTime(au.at))}</b>, классов обновлено: ${Object.keys(au.classes||{}).length}.`:' Обновлений ещё не было.'}</p>
      ${au&&(au.errors||[]).length?`<details class="lg-src"><summary>Замечания последнего обновления (${au.errors.length})</summary><ul>${au.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}
      <div class="lg-autog"><label class="cw-chk"><input type="checkbox" id="lgAuOn"${cfg.on!==false?' checked':''}> обновлять автоматически</label>
        <label class="f"><span>раз в, дней</span><input type="text" inputmode="numeric" id="lgAuDays" value="${esc(cfg.days||1)}"></label>
        <label class="f"><span>период ставок, дней</span><input type="text" inputmode="numeric" id="lgAuPer" value="${esc(cfg.period||30)}"></label>
        <button class="btn" type="button" data-lgref${pv.ati?'':' disabled'}>Обновить сейчас</button></div>
      <label class="f"><span>Опорные направления (по одному в строке: «Откуда — Куда»)</span><textarea id="lgAuRt" rows="4">${esc((cfg.routes||[]).join('\n'))}</textarea></label>
    </div>
    <div class="lg-tw"><table class="lg-st" id="lgCl"><thead><tr>${LG_CC.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th>Открытая</th><th>Авто</th><th>Источник ставки</th><th></th></tr></thead><tbody>
      ${T.classes.map((c,i)=>`<tr data-i="${i}" data-id="${esc(c.id)}">${LG_CC.map(([k,,t])=>`<td data-k="${k}">${(k==='km'||k==='kmFar')&&c.srcAuto?inp(c[k],t).replace('<input','<input readonly title="Ставка из автообновления — снимите «Авто», чтобы задать свою"'):inp(c[k],t)}</td>`).join('')}<td><input type="checkbox" data-k="open"${c.open?' checked':''} aria-label="Открытая площадка"></td>
        <td><input type="checkbox" data-k="auto"${c.auto!==false?' checked':''} aria-label="Ставка из автообновления"></td><td class="lg-srcc" title="${esc(c.src||'')}">${c.srcAuto?'ATI.SU · верх средних ставок':esc(c.src||'')}${c.srcAt?'<br>'+esc(Fmt.dateTime(c.srcAt)):''}</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td></tr>`).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="cl">+ Транспорт</button>
    <p class="sub" style="margin-top:14px">Разгрузка на объекте</p>
    <div class="lg-tw"><table class="lg-st" id="lgUn"><thead><tr><th>Техника</th><th>Масса места до, т</th><th>Стоимость, ₽</th><th></th></tr></thead><tbody>
      ${T.unload.map(u=>`<tr data-id="${esc(u.id)}"><td data-k="name">${inp(u.name,'text')}</td><td data-k="max">${inp(u.max)}</td><td data-k="cost">${inp(u.cost)}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td></tr>`).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="un">+ Техника</button>
    <p class="sub" style="margin-top:14px">Общие параметры</p>
    <div class="lg-sc">${LG_SC.map(([k,l,t])=>`<label class="f"><span>${esc(l)}</span>${inp(T[k],t).replace('<input','<input data-sc="'+k+'"')}</label>`).join('')}</div>
    ${FreightFacts.html(T)}
    <div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-lgsave>Сохранить тарифы</button><button class="btn ghost" type="button" data-lgreset>Вернуть стандартные</button></div></div>`;
  FreightFacts.bind(m, T);
  const read=()=>{
    const cls=[...m.querySelectorAll('#lgCl tbody tr')].map(tr=>{ const o={id:tr.dataset.id||('c'+Math.random().toString(36).slice(2,7))};
      tr.querySelectorAll('td[data-k]').forEach(td=>{ const k=td.dataset.k, v=td.querySelector('input').value.trim(); o[k]= k==='name' ? v : lgNum(v); });
      o.open=tr.querySelector('[data-k=open]').checked; const au2=tr.querySelector('[data-k=auto]'); o.auto=au2?au2.checked:true;
      if (o.auto && tr.querySelector('td[data-k=km] input[readonly]')){ const d=Freight.DEFAULTS.classes.find(x=>x.id===o.id); const prev=(LG.saved&&Array.isArray(LG.saved.classes)?LG.saved.classes.find(x=>x.id===o.id):null);
        o.km = prev&&prev.km>0 ? +prev.km : d ? d.km : o.km;     // своя ставка остаётся запасной, пока работает автообновление
        o.kmFar = prev&&prev.kmFar>0 ? +prev.kmFar : d ? d.kmFar : o.kmFar; }
      if (tr.dataset.src) o.src=tr.dataset.src;                 // тариф поправлен по сверке со счетами
      const was=LG.saved&&Array.isArray(LG.saved.classes)?LG.saved.classes.find(x=>x.id===o.id):null;
      if (was && was.src && !o.auto && +was.km===+o.km) o.src=was.src;   // ставка не менялась — источник (например, файл) сохраняется
      return o; }).filter(o=>o.name);
    const un=[...m.querySelectorAll('#lgUn tbody tr')].map(tr=>{ const o={id:tr.dataset.id||('u'+Math.random().toString(36).slice(2,7))};
      tr.querySelectorAll('td[data-k]').forEach(td=>{ const k=td.dataset.k, v=td.querySelector('input').value.trim(); o[k]= k==='name' ? v : lgNum(v); }); return o; }).filter(o=>o.name);
    const bad=cls.find(c=>['L','W','h','t','km'].some(k=>!(c[k]>0)));
    if (bad) throw new Error(`«${bad.name}»: укажите длину, ширину, высоту, грузоподъёмность и ставку`);
    const out={ver:3, classes:cls.sort((a,b)=>a.t-b.t), unload:un.sort((a,b)=>a.max-b.max), facts:FreightFacts.read(m)};
    m.querySelectorAll('[data-sc]').forEach(x=>{ const k=x.dataset.sc; out[k]= k==='hub' ? x.value.trim() : lgNum(x.value); });
    out.auto={ on:$('#lgAuOn').checked, days:Math.max(1, Math.round(lgNum($('#lgAuDays').value)||1)), period:Math.min(365, Math.max(7, Math.round(lgNum($('#lgAuPer').value)||30))),
      routes:$('#lgAuRt').value.split('\n').map(x=>x.trim()).filter(x=>/[—-]/.test(x)).slice(0,30) };
    return out; };
  const fi=m.querySelector('#lgFile');
  if (fi) fi.onchange=async()=>{ const f=fi.files[0]; fi.value=''; if (!f) return;
    try{ const rows=/\.xlsx$/i.test(f.name) ? await lgReadXlsx(await f.arrayBuffer()) : parseTable(await f.text());
      const imp=lgParseTariffs(rows); lgImportPreview(m, imp, f.name, T); }
    catch(err){ toast('Файл не прочитан: '+(err.message||err)); } };
  m.onclick=async e=>{
    if (e.target.closest('[data-lgtpl]')) return lgTemplate(T);
    const del=e.target.closest('[data-lgdel]'); if (del){ del.closest('tr').remove(); return; }
    const ref=e.target.closest('[data-lgref]');
    if (ref){ ref.disabled=true; ref.textContent='Обновляю…';
      try{ const out=read(); await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(out)});
        const r=await api('/api/logistics/refresh',{method:'POST'});
        toast(r.error ? r.error : `Ставки обновлены: ${Object.keys(r.classes||{}).length} классов${(r.errors||[]).length?`, замечаний: ${r.errors.length}`:''}`); }
      catch(err){ toast('Не обновлено: '+(err.message||err)); }
      return FreightSettings.open(m); }
    const add=e.target.closest('[data-lgadd]');
    if (add){ const tb=m.querySelector(add.dataset.lgadd==='cl'?'#lgCl tbody':'#lgUn tbody'), tr=document.createElement('tr');
      tr.innerHTML = add.dataset.lgadd==='cl' ? LG_CC.map(([k,,t])=>`<td data-k="${k}">${inp('',t)}</td>`).join('')+'<td><input type="checkbox" data-k="open" aria-label="Открытая площадка"></td><td><input type="checkbox" data-k="auto" aria-label="Ставка из автообновления"></td><td class="lg-srcc">вручную</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td>'
        : `<td data-k="name">${inp('','text')}</td><td data-k="max">${inp('')}</td><td data-k="cost">${inp('')}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td>`;
      tb.appendChild(tr); tr.querySelector('input').focus(); return; }
    if (e.target.closest('[data-lgsave]')){
      try{ const out=read(); await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(out)}); toast('Тарифы сохранены'); FreightSettings.open(m); }
      catch(err){ toast('Не сохранено: '+(err.message||err)); } return; }
    if (e.target.closest('[data-lgreset]')){
      if (!confirm('Вернуть стандартные тарифы доставки? Ваши ставки будут заменены.')) return;
      try{ await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:'{}'}); toast('Стандартные тарифы'); FreightSettings.open(m); }catch(err){ toast('Не сохранено: '+err.message); } }
  };
  }
}

// ---------- сверка тарифов со счетами перевозчиков (администратор): счета хранятся вместе с тарифами (kv «logistics».facts);
// каждый счёт сравнивается с ценой рейса по тарифу его машины, по классу — поправка тарифа (Freight.calibrate), «Применить»
// переносит её в таблицу машин (сохраняется кнопкой «Сохранить тарифы»)
class FreightFacts {
  static MAX = 300;
  static TIP = '<p>Впишите счета за перевозки отдельной машиной: дату, маршрут, расстояние по дорогам, машину и сумму по счёту с НДС (только перевозка — без агента, страхования и разгрузки).</p>'
    +'<p>Программа сравнит каждый счёт с ценой рейса по тарифу и предложит поправку: при трёх и больше счетах на разных расстояниях — отдельно подачу и ставки за км, иначе — общий множитель. «Применить» переносит поправку в таблицу машин, затем «Сохранить тарифы».</p>';

  static facts(){ return LG.saved&&Array.isArray(LG.saved.facts) ? LG.saved.facts : []; }

  static row(f, T){
    const opt=T.classes.map(c=>`<option value="${esc(c.id)}"${c.id===f.cls?' selected':''}>${esc(c.name)}</option>`).join('');
    return `<tr><td><input type="date" data-fa="at" value="${esc(f.at||'')}" aria-label="Дата счёта"></td>
      <td><input type="text" data-fa="route" value="${esc(f.route||'')}" placeholder="Москва — Казань" aria-label="Маршрут"></td>
      <td><input type="text" inputmode="numeric" data-fa="km" value="${esc(f.km||'')}" placeholder="км" aria-label="Расстояние, км"></td>
      <td><select data-fa="cls" aria-label="Машина">${opt}</select></td>
      <td><input type="text" inputmode="decimal" data-fa="sum" value="${esc(f.sum!=null?lgIn(f.sum):'')}" placeholder="₽ с НДС" aria-label="Сумма по счёту"></td>
      <td class="num" data-fa-model></td><td class="num" data-fa-dev></td>
      <td><button class="icon" type="button" data-lgfa="del" aria-label="Убрать счёт">✕</button></td></tr>`;
  }

  static html(T){
    return `<div class="lg-facts"><div class="sub" style="margin-top:14px">Сверка со счетами перевозчиков ${tip(FreightFacts.TIP)}</div>
      <div class="lg-tw"><table class="lg-st lg-fa" id="lgFa"><thead><tr><th>Дата</th><th>Маршрут</th><th>Км</th><th>Машина</th><th>По счёту, ₽ с НДС</th><th>По тарифу</th><th>Отклонение</th><th></th></tr></thead>
        <tbody>${FreightFacts.facts().map(f=>FreightFacts.row(f, T)).join('')}</tbody></table></div>
      <button class="btn ghost" type="button" data-lgfa="add">+ Счёт</button>
      <div id="lgFaRes" class="lg-fares"></div></div>`;
  }

  static read(m){
    return [...m.querySelectorAll('#lgFa tbody tr')].map(tr=>{ const v=k=>{ const x=tr.querySelector(`[data-fa="${k}"]`); return x?x.value.trim():''; };
      return {at:v('at'), route:v('route').slice(0,120), km:lgNum(v('km')), cls:v('cls'), sum:lgNum(v('sum'))}; })
      .filter(f=>f.km>0 && f.sum>0 && f.cls).slice(0, FreightFacts.MAX);
  }

  // пересчёт: по тарифу и отклонение в строках, поправки по классам
  static update(m, T){
    const all=[...m.querySelectorAll('#lgFa tbody tr')], facts=FreightFacts.read(m), cal=Freight.calibrate(facts, T);
    for (const tr of all){ const km=lgNum(tr.querySelector('[data-fa=km]').value), sum=lgNum(tr.querySelector('[data-fa=sum]').value), C=T.classes.find(c=>c.id===tr.querySelector('[data-fa=cls]').value);
      const mod=C&&km>0 ? Freight.run(C, km, T).v : null, dev=mod&&sum>0 ? (sum/mod-1)*100 : null;
      tr.querySelector('[data-fa-model]').textContent = mod ? Fmt.rub(mod) : '';
      const d=tr.querySelector('[data-fa-dev]'); d.textContent = dev==null ? '' : (dev>0?'+':'')+String(Math.round(dev*10)/10).replace('.',',')+' %';
      d.className='num '+(dev==null?'':Math.abs(dev)<=10?'ok-t':Math.abs(dev)<=25?'warn-t':'bad-t'); }
    const box=m.querySelector('#lgFaRes'); if (!box) return;
    const pct=x=>String(Math.round(x*10)/10).replace('.',',')+' %', k=x=>'×'+String(Math.round(x*1000)/1000).replace('.',','), far=Math.round(T.far).toLocaleString('ru-RU');
    // перерисовка — только если итог изменился: иначе уход фокуса с поля пересоздаст кнопку «Применить» под курсором и щелчок потеряется
    const html = cal.classes.length ? `<table class="lg-p"><tbody>${cal.classes.map(c=>`<tr><td><b>${esc(c.name)}</b> — ${c.n} ${plural(c.n,'счёт','счёта','счетов')}:
        средняя ошибка тарифа ${pct(c.before)} → после поправки ${pct(c.after)}<br><small class="muted">${esc(c.how)}: подача и минимум ${k(c.a)}, ставки за км ${k(c.b)} →
        подача ${Fmt.rub(c.fitted.base)}, ${Fmt.rub(c.fitted.km)}/км до ${far} км, ${Fmt.rub(c.fitted.kmFar)}/км дальше, минимум ${Fmt.rub(c.fitted.min)}</small></td>
        <td class="num">${Math.abs(c.a-1)<0.005&&Math.abs(c.b-1)<0.005?'<span class="muted">совпадает</span>':`<button class="btn ghost sm" type="button" data-lgfa="apply" data-id="${esc(c.id)}">Применить</button>`}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Счетов пока нет — добавьте хотя бы один, чтобы сверить тариф с фактом.</p>';
    if (box._html!==html){ box.innerHTML=html; box._html=html; }
    FreightFacts.last=cal;
  }

  static bind(m, T){
    const tb=m.querySelector('#lgFa tbody'); if (!tb) return;
    FreightFacts.update(m, T);
    const upd=()=>FreightFacts.update(m, T);
    m.querySelector('#lgFa').addEventListener('input', upd);
    m.querySelector('.lg-facts').addEventListener('click', e=>{
      const b=e.target.closest('[data-lgfa]'); if (!b) return;
      if (b.dataset.lgfa==='add'){ if (tb.children.length>=FreightFacts.MAX) return toast(`Не больше ${FreightFacts.MAX} счетов`);
        tb.insertAdjacentHTML('beforeend', FreightFacts.row({at:new Date().toISOString().slice(0,10), cls:'tent20'}, T)); tb.lastElementChild.querySelector('[data-fa=route]').focus(); return upd(); }
      if (b.dataset.lgfa==='del'){ b.closest('tr').remove(); return upd(); }
      if (b.dataset.lgfa==='apply'){ const c=(FreightFacts.last&&FreightFacts.last.classes||[]).find(x=>x.id===b.dataset.id), tr=m.querySelector(`#lgCl tbody tr[data-id="${CSS.escape(b.dataset.id)}"]`);
        if (!c || !tr) return;
        const put=(k,v)=>{ const i=tr.querySelector(`td[data-k="${k}"] input`); if (i){ i.readOnly=false; i.removeAttribute('title'); i.value=lgIn(v); } };
        put('base', c.fitted.base); put('min', c.fitted.min); put('km', c.fitted.km); put('kmFar', c.fitted.kmFar);
        const au=tr.querySelector('[data-k=auto]'); if (au) au.checked=false;      // ставка по счетам закрепляется — автообновление её не меняет
        tr.dataset.src=`по счетам перевозчиков: ${c.n} ${plural(c.n,'счёт','счёта','счетов')}, ${new Date().toLocaleDateString('ru-RU')}`;
        tr.classList.add('lg-upd'); toast(`«${c.name}»: тариф поправлен по счетам — нажмите «Сохранить тарифы»`); }
    });
  }
}

// ---------- тарифы файлом: шаблон (CSV для Excel) и загрузка .xlsx / .csv
const LG_FC=[['name','Транспорт',/^транспорт|^машин|^название/],['L','Длина площадки, м',/длина/],['W','Ширина площадки, м',/^ширина(?!.*спец)/],['h','Высота груза, м',/высота(?!.*спец)/],
  ['hMax','Высота со спецразрешением, м',/высота.*спец/],['wMax','Ширина со спецразрешением, м',/ширина.*спец/],['t','Грузоподъёмность, т',/грузоподъ(?!.*без)/],
  ['tLegal','Грузоподъёмность без разрешения на тяжеловес, т',/без .*(тяжелов|разреш)/],['km','Ставка за км до границы, ₽/км',/^(?!.*(дальн|дальш)).*(₽\s*\/\s*км|руб\.?\s*\/\s*км|ставка)/],
  ['kmFar','Ставка за км дальше границы (дальний рейс), ₽/км',/дальн|дальш/],['base','Подача, ₽',/подача/],['min','Минимальный заказ, ₽',/миним/],['open','Открытая площадка (да/нет)',/открыт/]];
const LG_FU=[['name','Разгрузка',/^разгрузка|^техника/],['max','Масса места до, т',/масса/],['cost','Стоимость, ₽',/стоимост|цена/]];
const lgFN = s => String(s??'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();

function lgTemplate(T){
  const q=v=>{ const t=String(v??''); return /[;"\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; }, n=v=>v==null||v===''?'':String(v).replace('.',',');
  const lines=[LG_FC.map(c=>c[1]), ...T.classes.map(c=>LG_FC.map(([k])=>k==='name'?c.name:k==='open'?(c.open?'да':'нет'):n(c[k]))), [],
    LG_FU.map(c=>c[1]), ...T.unload.map(u=>[u.name, n(u.max), n(u.cost)]), [],
    ['Параметр','Значение','Код'], ...LG_SC.map(([k,l])=>[l, k==='hub'?T[k]:n(T[k]), k])];
  const blob=new Blob(['﻿'+lines.map(r=>r.map(q).join(';')).join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Тарифы_доставки.csv'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 20000);
}

// первый лист .xlsx → строки ячеек (без сторонних библиотек: JSZip уже есть в программе)
async function lgReadXlsx(buf){
  const zip=await JSZip.loadAsync(buf), P=new DOMParser();
  const ss=[]; const sf=zip.file('xl/sharedStrings.xml');
  if (sf){ const x=P.parseFromString(await sf.async('string'), 'application/xml'); for (const si of x.getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map(t=>t.textContent).join('')); }
  const names=Object.keys(zip.files).filter(f=>/^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a,b)=>parseInt(a.match(/\d+/))-parseInt(b.match(/\d+/)));
  if (!names.length) throw new Error('в файле нет листов');
  const x=P.parseFromString(await zip.file(names[0]).async('string'), 'application/xml'), rows=[];
  const col=ref=>{ const m=String(ref||'').match(/^[A-Z]+/); let n=0; for (const ch of (m?m[0]:'A')) n=n*26+ch.charCodeAt(0)-64; return n-1; };
  for (const r of x.getElementsByTagName('row')){ const row=[];
    for (const c of r.getElementsByTagName('c')){ const t=c.getAttribute('t'), v=c.getElementsByTagName('v')[0];
      let val = t==='s' ? ss[+(v&&v.textContent)]||'' : t==='inlineStr' ? [...c.getElementsByTagName('t')].map(z=>z.textContent).join('') : v ? v.textContent : '';
      row[col(c.getAttribute('r'))]=val; }
    rows.push([...row].map(v=>v??'')); }
  return rows.filter(r=>r.some(v=>String(v).trim()!==''));
}

// строки файла → {classes, unload, params}; таблицы узнаются по заголовкам, столбцы — по названиям
function lgParseTariffs(rows){
  const out={classes:[], unload:[], params:{}}; let mode='', map=null;
  const head=(r, spec)=>{ const m={}; r.forEach((c,i)=>{ const f=spec.find(([k,,re])=>m[k]==null && re.test(lgFN(c))); if (f) m[f[0]]=i; }); return m; };
  for (const r of rows){
    const c0=lgFN(r[0]), c1=lgFN(r[1]);
    if (/^(транспорт|машин)/.test(c0) && /длина|площадк/.test(r.map(lgFN).join(' '))){ mode='cl'; map=head(r, LG_FC); continue; }
    if (/^(разгрузка|техника)/.test(c0) && /масса|стоимост/.test(r.map(lgFN).join(' '))){ mode='un'; map=head(r, LG_FU); continue; }
    if (/^параметр/.test(c0) && /значени/.test(c1)){ mode='pr'; continue; }
    if (!c0) continue;
    if (mode==='cl'){ const o={name:String(r[map.name??0]).trim()};
      for (const [k] of LG_FC) if (k!=='name' && k!=='open' && map[k]!=null) o[k]=lgNum(r[map[k]]);
      if (map.open!=null) o.open=/^(да|yes|1|true|\+)/i.test(String(r[map.open]).trim());
      if (map.kmFar==null && o.km>0) o.kmFar=o.km;          // файл прежней версии (одна ставка) — та же ставка по всему маршруту
      out.classes.push(o); }
    else if (mode==='un'){ out.unload.push({name:String(r[map.name??0]).trim(), max:lgNum(r[map.max??1]), cost:lgNum(r[map.cost??2])}); }
    else if (mode==='pr'){ const key=lgFN(r[2]), lab=c0; const sc=LG_SC.find(([k,l])=>lgFN(k)===key || lgFN(l)===lab); if (sc) out.params[sc[0]] = sc[0]==='hub' ? String(r[1]).trim() : lgNum(r[1]); }
  }
  if (!out.classes.length && !out.unload.length && !Object.keys(out.params).length) throw new Error('не найдены таблицы «Транспорт», «Разгрузка» или «Параметр» — возьмите шаблон');
  const bad=out.classes.filter(c=>!c.name || ['L','W','h','t','km'].some(k=>!(c[k]>0)));
  if (bad.length) throw new Error('у машин '+bad.map(c=>'«'+(c.name||'без названия')+'»').join(', ')+' не указаны длина, ширина, высота, грузоподъёмность или ставка');
  return out;
}

function lgImportPreview(m, imp, fname, T){
  const box=m.querySelector('#lgImp'), byName=(list,n)=>list.find(x=>lgFN(x.name)===lgFN(n)), ch=[];
  for (const c of imp.classes){ const o=byName(T.classes, c.name);
    if (!o){ ch.push(`<li><b>${esc(c.name)}</b> — новая машина: ${lgIn(c.L)} × ${lgIn(c.W)} м, ${lgIn(c.t)} т, ${lgIn(c.km)} ₽/км</li>`); continue; }
    const d=LG_FC.filter(([k])=>k!=='name' && c[k]!=null && String(c[k])!==String(o[k])).map(([k,l])=>`${l.replace(/, .*$/,'')}: ${k==='open'?(o.open?'да':'нет'):lgIn(o[k])} → <b>${k==='open'?(c.open?'да':'нет'):lgIn(c[k])}</b>`);
    if (d.length) ch.push(`<li><b>${esc(c.name)}</b>: ${d.join(', ')}</li>`); }
  for (const u of imp.unload){ const o=byName(T.unload, u.name);
    if (!o) ch.push(`<li><b>${esc(u.name)}</b> — новая техника разгрузки: до ${lgIn(u.max)} т, ${Fmt.rub(u.cost)}</li>`);
    else if (o.max!==u.max || o.cost!==u.cost) ch.push(`<li><b>${esc(u.name)}</b>: ${lgIn(o.max)} т / ${Fmt.rub(o.cost)} → <b>${lgIn(u.max)} т / ${Fmt.rub(u.cost)}</b></li>`); }
  const pv=v=>typeof v==='number'?lgIn(v):String(v??'');
  for (const [k,v] of Object.entries(imp.params)) if (v!=null && String(v)!==String(T[k])) ch.push(`<li>${esc((LG_SC.find(x=>x[0]===k)||[,k])[1])}: ${esc(pv(T[k]))} → <b>${esc(pv(v))}</b></li>`);
  const gone=T.classes.filter(o=>imp.classes.length && !byName(imp.classes, o.name));
  box.innerHTML=`<div class="lg-imp"><p class="sub">Файл «${esc(fname)}»: ${ch.length?`изменений — ${ch.length}`:'изменений нет'}</p>
    ${ch.length?`<ul>${ch.join('')}</ul>`:''}${gone.length?`<p class="muted">Машин нет в файле — останутся как есть: ${esc(gone.map(x=>x.name).join(', '))}</p>`:''}
    <div class="row">${ch.length?'<button class="btn primary" type="button" data-lgimp>Применить и сохранить</button>':''}<button class="btn ghost" type="button" data-lgimpx>Отмена</button></div></div>`;
  box.onclick=async e=>{
    if (e.target.closest('[data-lgimpx]')){ box.innerHTML=''; return; }
    if (!e.target.closest('[data-lgimp]')) return;
    const src=`файл «${fname}», ${new Date().toLocaleDateString('ru-RU')}`, saved=LG.saved||{};
    const base=Array.isArray(saved.classes)&&saved.classes.length ? saved.classes.map(x=>({...x})) : T.classes.map(({srcAt:_a, srcAuto:_u, ...x})=>({...x, ...(x.src&&/вручную/.test(x.src)?{src:undefined}:{})}));   // стандартные ставки — с их источником
    for (const c of imp.classes){ const o=byName(base, c.name);
      if (o) Object.assign(o, Object.fromEntries(Object.entries(c).filter(([,v])=>v!=null)), {auto:false, src});
      else base.push({id:'c'+Math.random().toString(36).slice(2,8), hMax:c.h, wMax:c.W, base:0, min:0, open:false, ...Object.fromEntries(Object.entries(c).filter(([,v])=>v!=null)), auto:false, src}); }
    const un=(Array.isArray(saved.unload)&&saved.unload.length?saved.unload:T.unload).map(x=>({...x}));
    for (const u of imp.unload){ const o=byName(un, u.name); if (o) Object.assign(o, u); else un.push({id:'u'+Math.random().toString(36).slice(2,8), ...u}); }
    const out={...Object.fromEntries(Object.entries(saved).filter(([k])=>!k.startsWith('_') && !['updatedAt','updatedBy'].includes(k))), ...imp.params, ver:3,
      classes:base.sort((a,b)=>a.t-b.t), unload:un.sort((a,b)=>a.max-b.max), fileSrc:src};
    try{ await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(out)}); toast('Тарифы из файла сохранены'); FreightSettings.open(m); }
    catch(err){ toast('Не сохранено: '+(err.message||err)); } };
}
