// Экономика сделки — расчёт (без интерфейса). Методика: «Калькулятор расчёта экономики сделки».
// Все суммы — в рублях, полные платежи с налогами; без промежуточного округления.
//   R = S / (1 + v/100)                         выручка без НДС
//   C_cash = все платежи (оборудование, логистика, таможня, комиссии, страхование, монтаж, прочее, резервы)
//   C_net = C_cash − НДС к вычету;  C_total = C_net + F;  P = R − C_total
//   Наценка = P / C_total;  Маржинальность = P / R;  чистая прибыль = P − налог на прибыль (если P > 0)
// Финансирование F — простой процент (месяц = 30 дней) на недостающие деньги по графику платежей и поступлений
// до последней оплаты заказчика. Без аванса заказчика это ровно Σ платёж × i/100 × дней до оплаты / 30;
// поступления заказчика уменьшают финансируемую сумму, доход на свободный остаток не начисляется.
// Таможня «Рассчитать»: таможенная стоимость CV = оборудование + логистика до границы + страхование;
//   пошлина = CV × ставка; сбор — по шкале; ввозной НДС = (CV + пошлина) × ставка НДС (к вычету).
'use strict';

// число из поля: null — пусто, NaN — ошибка ввода
function dNum(s){
  if (s==null) return null; if (typeof s==='number') return Number.isFinite(s)?s:NaN;
  const t=String(s).replace(/[\s ]/g,'').replace(',','.'); if (!t) return null;
  return /^-?\d*\.?\d+$/.test(t) ? +t : NaN;
}

const DEAL_CURS=['RUB','CNY','USD','EUR'];

// таможенные сборы за таможенные операции по таможенной стоимости, ₽ (ПП РФ от 28.11.2024 № 1637, с 01.01.2025).
// При изменении ставок поправьте таблицу; в расчёте сбор можно вписать вручную.
const CUSTOMS_FEES = { title:'ПП РФ № 1637 (с 01.01.2025)', scale:[[200000,1231],[450000,2462],[1200000,4924],[2700000,13541],[4200000,18465],[5500000,21344],[10000000,49240],[Infinity,73860]] };

function customsFee(cv){ if (!(cv>0)) return 0; for (const [lim,fee] of CUSTOMS_FEES.scale) if (cv<=lim) return fee; return 0; }

// этапы оплаты заказчика: событие + дней после него
const DEAL_EVENTS = { sign:'при подписании', ready:'при готовности к отгрузке', delivery:'после поставки', pnr:'после ПНР' };

function dealNewSupplier(id, def={}){
  return { id, name:'', vatIn:false, adv:def.adv??'20', prod:def.prod??'40', ship:def.ship??'40',
    extra:{v:'',cur:'RUB'}, log:{v:'',cur:'RUB'}, logRu:{v:''}, cusMode:'sum', cus:{v:'',cur:'RUB'}, vi:'', vo:'',
    duty:'', ivat:'22', fee:'', ins:'', fx:'', brk:{v:''}, voRu:'' };
}

function dealBlank(def={}){
  const adv=def.cAdv&&+def.cAdv>0 ? String(def.cAdv) : '';
  return { v:2, touched:false, over:{price:'',vat:''}, rates:{}, sup:[dealNewSupplier('s1',def)], map:{},
    mnt:'', pnr:'', oth:'', vo:'', warr:'', bonus:'', tax:def.tax??'25',
    cust:{ tr: adv ? [{pct:adv, ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:def.defer??'30'}] : [{pct:'', ev:'delivery', off:def.defer??'30'}] },
    money:def.money??'', days:{}, target:{type:'margin', v:''} };
}

// расчёт прежней версии (v1) → v2: недостающие поля, график оплаты заказчика этапами
function dealUpgrade(d){
  if (!d || d.v>=2) return d;
  d.sup=(d.sup||[]).map(s=>({...dealNewSupplier(s.id), ...s}));
  const c=d.cust||{}, adv=dNum(c.adv)||0;
  d.cust={ tr: adv>0 ? [{pct:String(c.adv), ev:'sign', off:String(c.day||'0')}, {pct:'', ev:'delivery', off:String(c.defer??'30')}]
    : [{pct:'', ev:'delivery', off:String(c.defer??'30')}] };
  Object.assign(d, { pnr:d.pnr??'', warr:d.warr??'', bonus:d.bonus??'', tax:d.tax??'25', target:d.target||{type:'margin', v:''}, v:2 });
  return d;
}

// kp — данные конструктора: { sumRub, vat, rates:{CNY:'12,4',…}, costNoVat, items:[{id,name,qty,cost,cur}], moneyAuto } (cost — за единицу, в валюте cur)
// d — S.deal (строки из полей). Возвращает все величины, график, структуру затрат, ошибки и предупреждения.
function dealCalc(kp, d){
  d=dealUpgrade(d);
  const err={}, warn=[];
  const num=(path, s, o={})=>{ const v=dNum(s);
    if (v==null) return o.def!==undefined ? o.def : null;
    if (Number.isNaN(v)) { err[path]='Число, например 12 400,50'; return o.def??0; }
    if (v<0) { err[path]='Не может быть отрицательным'; return o.def??0; }
    if (o.max!=null && v>o.max) { err[path]=`Не больше ${o.max}`; return o.max; }
    if (o.int && !Number.isInteger(v)) { err[path]='Целое число дней'; return Math.round(v); }
    return v; };
  // цена, НДС, курсы
  const S = d.over.price!=='' && d.over.price!=null ? num('over.price', d.over.price, {def:0}) : (kp.sumRub||0);
  const vatFromKp = d.over.vat==='' || d.over.vat==null;
  const v = vatFromKp ? (+kp.vat||0) : num('over.vat', d.over.vat, {def:0, max:100});
  const rateSrc={};
  const rate=c=>{ if (!c||c==='RUB') return 1;
    const own=d.rates&&d.rates[c];
    if (own!=null && own!==''){ const r=dNum(own); if (!(r>0)) { err['rates.'+c]='Курс больше 0'; return NaN; } rateSrc[c]='deal'; return r; }
    const r=dNum(kp.rates&&kp.rates[c]); rateSrc[c]='kp'; return r>0?r:NaN; };
  const used=new Set();
  const money=(path, o, cur)=>{ const a=num(path, o&&o.v, {def:0}); const c=cur||(o&&o.cur)||'RUB'; if (a) used.add(c);
    const r=rate(c); if (a && !(r>0)) { err[path]=err[path]||`Нет курса ${c}`; return 0; } return a*(r||0); };
  const vatK=1+v/100, inVat=x=>x*v/(100+v);
  // поставщики
  const sup=(d.sup&&d.sup.length?d.sup:[dealNewSupplier('s1')]);
  const supOf=id=>{ const s=d.map&&d.map[id]; return sup.some(x=>x.id===s) ? s : sup[0].id; };
  const S_=sup.map((s,k)=>{ const P=`sup.${k}`;
    const items=(kp.items||[]).filter(x=>supOf(x.id)===s.id);
    const byCur={}; let equip=0, equipFx=0; const noCost=[];
    for (const x of items){ const q=+x.qty||0; if (!(x.cost>0)){ noCost.push(x); continue; }
      const c=x.cur||'RUB'; used.add(c); byCur[c]=(byCur[c]||0)+x.cost*q;
      const r=rate(c); if (!(r>0)) { err[P+'.rate']=`Нет курса ${c}`; continue; }
      const a=x.cost*q*r*(kp.costNoVat?vatK:1); equip+=a; if (c!=='RUB') equipFx+=a; }
    const ex=num(P+'.extra', s.extra&&s.extra.v, {def:0}); if (ex){ const c=(s.extra.cur)||'RUB'; byCur[c]=(byCur[c]||0)+ex; }
    const exRub=money(P+'.extra', s.extra); equip+=exRub; if ((s.extra&&s.extra.cur||'RUB')!=='RUB') equipFx+=exRub;
    const L=money(P+'.log', s.log), Lfx=(s.log&&s.log.cur||'RUB')!=='RUB' ? L : 0;
    const Lru=money(P+'.logRu', s.logRu, 'RUB'), brk=money(P+'.brk', s.brk, 'RUB');
    const adv=num(P+'.adv', s.adv, {def:0, max:100}), prod=num(P+'.prod', s.prod, {def:0, int:true}), ship=num(P+'.ship', s.ship, {def:0, int:true});
    const insP=num(P+'.ins', s.ins, {def:0, max:100}), fxP=num(P+'.fx', s.fx, {def:0, max:100});
    const ins=equip*insP/100, fxE=equipFx*fxP/100, fxL=Lfx*fxP/100;
    // таможня: сумма целиком или расчёт
    let T=0, vi=null, cv=0, dutyA=0, fee=0, feeAuto=true, ivatA=0;
    const calc = s.cusMode==='calc';
    if (calc){
      const dutyP=num(P+'.duty', s.duty, {def:0, max:100}), ivP=num(P+'.ivat', s.ivat, {def:22, max:100});
      cv=equip+L+ins; dutyA=cv*dutyP/100;
      const feeOwn=num(P+'.fee', s.fee); feeAuto=feeOwn==null; fee=feeAuto?customsFee(cv):feeOwn;
      ivatA=(cv+dutyA)*ivP/100; T=dutyA+fee+ivatA; vi=ivatA;
    } else if (s.cusMode==='none'){ vi=0;                   // поставка внутри России — таможни нет
    } else {
      T=money(P+'.cus', s.cus);
      vi=num(P+'.vi', s.vi); if (vi==null && !T) vi=0;            // нет растаможки — нечего вычитать
      if (vi!=null && vi>T+0.005) err[P+'.vi']='Не больше суммы растаможки';
    }
    const suggest = s.vatIn ? inVat(equip) : 0;
    let vo = s.vatIn ? num(P+'.vo', s.vo) : 0; const voAuto = s.vatIn && vo==null; if (voAuto) vo=suggest;
    if (vo>equip+0.005) err[P+'.vo']='Не больше стоимости оборудования';
    const ruSuggest=inVat(Lru+brk); let voRu=num(P+'.voRu', s.voRu); const voRuAuto=voRu==null; if (voRuAuto) voRu=ruSuggest;
    if (voRu>Lru+brk+0.005) err[P+'.voRu']='Не больше суммы услуг в России';
    const cash=equip+fxE+fxL+ins+L+T+brk+Lru;
    return { id:s.id, name:(s.name||'').trim()||`Поставщик ${k+1}`, items, noCost, byCur, equip, equipFx, L, Lru, brk, T, adv, prod, ship, ins, fxE, fxL,
      calc, cv, dutyA, fee, feeAuto, ivatA, vi, vo, voAuto, suggest, voRu, voRuAuto, ruSuggest, cash, active: cash>0 }; });
  for (const s of S_) for (const x of s.noCost) warn.push({t:`«${x.name||'Без названия'}»: закупка не указана — позиция не учтена в расходах`, go:'price'});
  const M=num('mnt', d.mnt, {def:0}), E=num('oth', d.oth, {def:0}), pnrDays=num('pnr', d.pnr, {def:0, int:true});
  const Vo=num('vo', d.vo, {def:0});
  const warrP=num('warr', d.warr, {def:0, max:100}), bonusP=num('bonus', d.bonus, {def:0, max:100}), taxP=num('tax', d.tax, {def:25, max:100});
  const moneyOwn=num('money', d.money); const moneyAuto=moneyOwn==null; const i=moneyAuto ? (kp.moneyAuto ?? 2) : moneyOwn;
  const R=S/vatK, VATs=S-R;
  const W=R*warrP/100, Bn=R*bonusP/100;
  const sumOf=f=>S_.reduce((a,s)=>a+f(s),0);
  const viSum=sumOf(s=>s.vi||0), Tsum=sumOf(s=>s.T), Lsum=sumOf(s=>s.L), LruSum=sumOf(s=>s.Lru), brkSum=sumOf(s=>s.brk);
  if (Vo > Lsum+Tsum+M+E-viSum+0.005) err['vo']='Не больше расходов на логистику, таможню, монтаж и прочее за вычетом ввозного НДС';
  // график: платежи поставщикам, доставка по России, монтаж при поставке, поступления заказчика, бонусы и резерв
  const act=S_.filter(s=>s.active), multi=act.length>1, rows=[];
  const dayOf=(key, auto)=>{ const o=d.days&&d.days[key]; const n=dNum(o); if (o!=null && o!=='' && (Number.isNaN(n)||n<0||!Number.isInteger(n))) err['days.'+key]='Целое число дней'; return (n!=null && n>=0 && Number.isInteger(n)) ? n : auto; };
  let D=0, Rdy=0;
  for (const s of act){ const nm=multi?` «${s.name}»`:'';
    const A=(s.equip+s.fxE)*s.adv/100, B=s.equip+s.fxE-A+s.fxL+s.ins+s.L+s.T+s.brk, arr=s.prod+s.ship; D=Math.max(D,arr); Rdy=Math.max(Rdy,s.prod);
    if (A>0) rows.push({key:'adv:'+s.id, auto:0, label:'Аванс поставщику'+nm, amount:-A});
    if (B>0) rows.push({key:'rest:'+s.id, auto:s.prod, label:'Остаток'+(s.L||s.T||s.brk?', логистика и таможня':' поставщику')+nm, amount:-B});
    if (s.Lru>0) rows.push({key:'ru:'+s.id, auto:arr, label:'Доставка по России'+nm, amount:-s.Lru}); }
  if (M+E>0) rows.push({key:'mnt', auto:D, label:'Монтаж, ПНР и прочие расходы', amount:-(M+E)});
  // этапы оплаты заказчика: последний этап — остаток до 100 %
  const ev={sign:0, ready:Rdy, delivery:D, pnr:D+pnrDays};
  const tr=(d.cust&&d.cust.tr&&d.cust.tr.length)?d.cust.tr:[{pct:'',ev:'delivery',off:'30'}];
  let pctSum=0; const trs=tr.map((t,k)=>{ const last=k===tr.length-1;
    const p=last?null:num(`cust.tr.${k}.pct`, t.pct, {def:0, max:100}); if (!last) pctSum+=p;
    const off=num(`cust.tr.${k}.off`, t.off, {def:0, int:true}); return {k, p, ev:DEAL_EVENTS[t.ev]?t.ev:'delivery', off, last}; });
  const restPct=100-pctSum; if (restPct<-0.0001) err['cust.tr']='Сумма этапов больше 100 %';
  trs[trs.length-1].p=Math.max(0,restPct);
  for (const t of trs){ if (!(t.p>0)) continue;
    rows.push({key:'c'+t.k, auto:ev[t.ev]+t.off, label:`Оплата заказчика ${dlPctTxt(t.p)} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off} дн.`:''}`, amount:S*t.p/100, inflow:true, pct:t.p}); }
  if (!rows.some(r=>r.inflow)) rows.push({key:'c0', auto:D, label:'Оплата заказчика', amount:0, inflow:true, pct:100});
  rows.forEach((r,k)=>{ r.day=dayOf(r.key, r.auto); r.manual=r.day!==r.auto; r.ord=k; });
  const Tend=Math.max(...rows.filter(r=>r.inflow).map(r=>r.day));
  if (Bn>0) rows.push({key:'bonus', auto:Tend, day:Tend, fixed:true, label:'Бонусы и комиссии с продажи', amount:-Bn, ord:rows.length});
  if (W>0) rows.push({key:'warr', auto:Tend, day:Tend, fixed:true, label:'Резерв на гарантию', amount:-W, ord:rows.length});
  rows.sort((a,b)=>a.day-b.day || ((a.key==='bonus'||a.key==='warr')?1:0)-((b.key==='bonus'||b.key==='warr')?1:0) || (a.inflow?1:0)-(b.inflow?1:0) || a.ord-b.ord);
  let bal=0, Fsum=0;
  rows.forEach((r,k)=>{ bal+=r.amount; r.balance=bal; const nx=rows[k+1];
    r.days=Math.max(0, Math.min(nx?nx.day:Tend, Tend)-r.day); if (r.day>=Tend) r.days=0;
    r.fin=Math.max(0,-bal)*r.days*i/100/30; Fsum+=r.fin; });
  const F=Fsum;
  const equipSum=sumOf(s=>s.equip);
  const Ccash=sumOf(s=>s.cash)+M+E+W+Bn;
  const voSup=sumOf(s=>s.vo), voRuSum=sumOf(s=>s.voRu);
  const unknown=S_.filter(s=>s.vi==null);
  const VATinKnown=viSum+voSup+voRuSum+Vo;
  const res=VATin=>{ const Cnet=Ccash-VATin, Ctot=Cnet+F, P=R-Ctot, vb=VATs-VATin, tax=P>0?P*taxP/100:0;
    return { VATin, Cnet, Ctot, P, tax, net:P-tax, markup: Ctot?P/Ctot*100:null, margin: R?P/R*100:null, vatBal:vb, payable:Math.max(vb,0), excess:Math.max(-vb,0),
      cashAfter: S-Ccash-F-Math.max(vb,0) }; };
  const lo=res(VATinKnown), hi=unknown.length?res(VATinKnown+unknown.reduce((a,s)=>a+s.T,0)):lo;
  const base=unknown.length?null:lo;
  if (base && Math.abs(base.P-(base.cashAfter+base.excess))>0.01) warn.push({t:'Контрольное равенство не сошлось — сообщите разработчику', bad:true});
  if (!(S>0)) warn.push({t:'Нет цены для заказчика: заполните цены в КП или укажите цену здесь', bad:true});
  if (!equipSum && !Lsum && !Tsum && !M && !E) warn.push({t:'Расходы не указаны: укажите закупку в разделе «Цены» или суммы здесь', go:'price'});
  // структура затрат (для итога и Excel)
  const parts=[['Оборудование', equipSum], ['Комиссии за перевод и конвертацию', sumOf(s=>s.fxE+s.fxL)], ['Страхование груза', sumOf(s=>s.ins)],
    ['Логистика до границы', Lsum], ['Таможенные платежи', Tsum], ['Брокер, СВХ, сертификация', brkSum], ['Доставка по России', LruSum],
    ['Монтаж и ПНР', M], ['Прочие расходы', E], ['Бонусы и комиссии с продажи', Bn], ['Резерв на гарантию', W], ['Финансирование', F],
    ['НДС к вычету (уменьшает затраты)', -(base||lo).VATin]].filter(x=>Math.abs(x[1])>0.004);
  return { S, v, vatFromKp, rate, rateSrc, used:[...used].filter(c=>c!=='RUB'), sup:S_, M, E, Vo, W, Bn, warrP, bonusP, taxP, pnrDays, trs, ev, i, moneyAuto,
    rows, F, D, Rdy, Tend, R, VATs, Ccash, equipSum, Lsum, LruSum, brkSum, Tsum, voSup, voRuSum, unknown, base, lo, hi, cashBefore:S-Ccash-F, parts,
    err, warn, ok:!Object.keys(err).length };
}

function dlPctTxt(p){ return (Math.round(p*100)/100).toString().replace('.',',')+' %'; }

// цена с НДС, при которой показатель равен цели (type: margin | markup | profit | net); null — недостижимо.
// Неизвестный ввозной НДС — по нижней границе (без вычета): цена с запасом.
function dealSolve(kp, d, type, value){
  const f=S=>{ const c=dealCalc(kp, {...d, over:{...d.over, price:String(S)}}), r=c.base||c.lo;
    return type==='margin' ? r.margin : type==='markup' ? r.markup : type==='net' ? r.net : r.P; };
  if (!(Number.isFinite(value))) return null;
  let lo=0, hi=Math.max(1e5, dealCalc(kp,d).Ccash*4);
  for (let k=0; k<40 && !(f(hi)>=value); k++) hi*=2;
  if (!(f(hi)>=value)) return null;
  for (let k=0; k<80; k++){ const m=(lo+hi)/2, fm=f(m); if (fm==null || fm<value) lo=m; else hi=m; }
  return Math.ceil(hi*100)/100;
}

if (typeof module!=='undefined') module.exports={dealCalc, dealBlank, dealNewSupplier, dealUpgrade, dealSolve, customsFee, dNum, CUSTOMS_FEES, DEAL_EVENTS};
