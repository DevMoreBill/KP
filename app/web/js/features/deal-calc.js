// Экономика сделки — расчёт (без интерфейса). Методика: «Калькулятор расчёта экономики сделки».
// Все суммы — в рублях, полные платежи с налогами; без промежуточного округления.
//   R = S / (1 + v/100)                    выручка без НДС
//   C_cash = оборудование + L + T + M + E   прямые платежи (всё переведено в рубли)
//   C_net = C_cash − НДС к вычету;  C_total = C_net + F;  P = R − C_total
//   Наценка = P / C_total;  Маржинальность = P / R
// Финансирование F — простой процент (месяц = 30 дней) на недостающие деньги по графику платежей и поступлений
// до последней оплаты заказчика. Без аванса заказчика это ровно Σ платёж × i/100 × дней до оплаты / 30;
// аванс заказчика уменьшает финансируемую сумму, доход на свободный остаток не начисляется.
'use strict';

// число из поля: null — пусто, NaN — ошибка ввода
function dNum(s){
  if (s==null) return null; if (typeof s==='number') return Number.isFinite(s)?s:NaN;
  const t=String(s).replace(/[\s ]/g,'').replace(',','.'); if (!t) return null;
  return /^-?\d*\.?\d+$/.test(t) ? +t : NaN;
}

const DEAL_CURS=['RUB','CNY','USD','EUR'];

function dealNewSupplier(id, def={}){
  return { id, name:'', vatIn:false, adv:def.adv??'20', prod:def.prod??'40', ship:def.ship??'40',
    extra:{v:'',cur:'RUB'}, log:{v:'',cur:'RUB'}, cus:{v:'',cur:'RUB'}, vi:'', vo:'' };
}

function dealBlank(def={}){
  return { v:1, touched:false, over:{price:'',vat:''}, rates:{}, sup:[dealNewSupplier('s1',def)], map:{},
    mnt:'', oth:'', vo:'', cust:{adv:def.cAdv??'0', day:'0', defer:def.defer??'30'}, money:def.money??'2', days:{} };
}

// kp — данные конструктора: { sumRub, vat, rates:{CNY:'12,4',…}, costNoVat, items:[{id,name,qty,cost,cur}] } (cost — за единицу, в валюте cur)
// d — S.deal (строки из полей). Возвращает все величины, график, ошибки и предупреждения.
function dealCalc(kp, d){
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
  const money=(path, o)=>{ const a=num(path, o&&o.v, {def:0}); const c=(o&&o.cur)||'RUB'; if (a) used.add(c);
    const r=rate(c); if (a && !(r>0)) { err[path]=err[path]||`Нет курса ${c}`; return 0; } return a*(r||0); };
  // поставщики: оборудование из позиций КП + закупка вне позиций, логистика, растаможка
  const sup=(d.sup&&d.sup.length?d.sup:[dealNewSupplier('s1')]);
  const supOf=id=>{ const s=d.map&&d.map[id]; return sup.some(x=>x.id===s) ? s : sup[0].id; };
  const vatK=1+v/100;
  const S_=sup.map((s,k)=>{ const P=`sup.${k}`;
    const items=(kp.items||[]).filter(x=>supOf(x.id)===s.id);
    const byCur={}; let equip=0; const noCost=[];
    for (const x of items){ const q=+x.qty||0; if (!(x.cost>0)){ noCost.push(x); continue; }
      const c=x.cur||'RUB'; used.add(c); byCur[c]=(byCur[c]||0)+x.cost*q;
      const r=rate(c); if (!(r>0)) { err[P+'.rate']=`Нет курса ${c}`; continue; }
      equip+=x.cost*q*r*(kp.costNoVat?vatK:1); }
    const ex=num(P+'.extra', s.extra&&s.extra.v, {def:0}); if (ex){ const c=(s.extra.cur)||'RUB'; byCur[c]=(byCur[c]||0)+ex; }
    equip+=money(P+'.extra', s.extra);
    const L=money(P+'.log', s.log), T=money(P+'.cus', s.cus);
    const adv=num(P+'.adv', s.adv, {def:0, max:100}), prod=num(P+'.prod', s.prod, {def:0, int:true}), ship=num(P+'.ship', s.ship, {def:0, int:true});
    let vi=num(P+'.vi', s.vi); if (vi==null && !T) vi=0;            // нет растаможки — нечего вычитать
    if (vi!=null && vi>T+0.005) err[P+'.vi']='Не больше суммы растаможки';
    const suggest = s.vatIn ? equip*v/(100+v) : 0;
    let vo = s.vatIn ? num(P+'.vo', s.vo) : 0; const voAuto = s.vatIn && vo==null; if (voAuto) vo=suggest;
    if (vo>equip+0.005) err[P+'.vo']='Не больше стоимости оборудования';
    return { id:s.id, name:(s.name||'').trim()||`Поставщик ${k+1}`, items, noCost, byCur, equip, L, T, adv, prod, ship, vi, vo, voAuto, suggest,
      active: equip>0||L>0||T>0 }; });
  for (const s of S_) for (const x of s.noCost) warn.push({t:`«${x.name||'Без названия'}»: закупка не указана — позиция не учтена в расходах`, go:'price'});
  const M=num('mnt', d.mnt, {def:0}), E=num('oth', d.oth, {def:0});
  let Vo=num('vo', d.vo, {def:0});
  const cAdv=num('cust.adv', d.cust.adv, {def:0, max:100}), cDay=num('cust.day', d.cust.day, {def:0, int:true}), defer=num('cust.defer', d.cust.defer, {def:0, int:true});
  const i=num('money', d.money, {def:0});
  const viSum=S_.reduce((a,s)=>a+(s.vi||0),0), Tsum=S_.reduce((a,s)=>a+s.T,0), Lsum=S_.reduce((a,s)=>a+s.L,0);
  if (Vo > Lsum+Tsum+M+E-viSum+0.005) err['vo']='Не больше расходов на логистику, растаможку, монтаж и прочее за вычетом ввозного НДС';
  // график: платежи поставщикам, монтаж при доставке, поступления от заказчика
  const multi=S_.filter(s=>s.active).length>1, rows=[];
  const dayOf=(key, auto)=>{ const o=d.days&&d.days[key]; const n=dNum(o); if (o!=null && o!=='' && (Number.isNaN(n)||n<0||!Number.isInteger(n))) err['days.'+key]='Целое число дней'; return (n!=null && n>=0 && Number.isInteger(n)) ? n : auto; };
  let D=0;
  for (const s of S_){ if (!s.active) continue; const nm=multi?` «${s.name}»`:'';
    const A=s.equip*s.adv/100, B=s.equip-A+s.L+s.T, arr=s.prod+s.ship; D=Math.max(D,arr);
    if (A>0) rows.push({key:'adv:'+s.id, auto:0, label:'Аванс поставщику'+nm, amount:-A});
    if (B>0) rows.push({key:'rest:'+s.id, auto:s.prod, label:'Остаток'+(s.L||s.T?', логистика и растаможка':' поставщику')+nm, amount:-B}); }
  if (M+E>0) rows.push({key:'mnt', auto:D, label:'Монтаж, ПНР и прочие расходы', amount:-(M+E)});
  const inAdv=S*cAdv/100;
  if (inAdv>0) rows.push({key:'cadv', auto:cDay, label:'Аванс заказчика', amount:inAdv, inflow:true});
  rows.push({key:'cfin', auto:D+defer, label:inAdv>0?'Оплата заказчика (остаток)':'Оплата заказчика', amount:S-inAdv, inflow:true});
  rows.forEach((r,k)=>{ r.day=dayOf(r.key, r.auto); r.manual=r.day!==r.auto; r.ord=k; });
  rows.sort((a,b)=>a.day-b.day || (a.inflow?1:0)-(b.inflow?1:0) || a.ord-b.ord);
  const Tend=Math.max(...rows.filter(r=>r.inflow).map(r=>r.day));
  let bal=0, Fsum=0;
  rows.forEach((r,k)=>{ bal+=r.amount; r.balance=bal; const nx=rows[k+1];
    r.days=Math.max(0, Math.min(nx?nx.day:Tend, Tend)-r.day); if (r.day>=Tend) r.days=0;
    r.fin=Math.max(0,-bal)*r.days*i/100/30; Fsum+=r.fin; });
  const F=Fsum;
  const R=v>-100 ? S/vatK : NaN, VATs=S-R;
  const equipSum=S_.reduce((a,s)=>a+s.equip,0);
  const Ccash=equipSum+Lsum+Tsum+M+E;
  const voSup=S_.reduce((a,s)=>a+s.vo,0);
  const unknown=S_.filter(s=>s.vi==null);
  const VATinKnown=S_.reduce((a,s)=>a+(s.vi||0),0)+voSup+Vo;
  const res=VATin=>{ const Cnet=Ccash-VATin, Ctot=Cnet+F, P=R-Ctot, bal=VATs-VATin;
    return { VATin, Cnet, Ctot, P, markup: Ctot?P/Ctot*100:null, margin: R?P/R*100:null, vatBal:bal, payable:Math.max(bal,0), excess:Math.max(-bal,0),
      cashAfter: S-Ccash-F-Math.max(bal,0) }; };
  const lo=res(VATinKnown), hi=unknown.length?res(VATinKnown+unknown.reduce((a,s)=>a+s.T,0)):lo;
  const base=unknown.length?null:lo;
  if (base && Math.abs(base.P-(base.cashAfter+base.excess))>0.01) warn.push({t:'Контрольное равенство не сошлось — сообщите разработчику', bad:true});
  if (!(S>0)) warn.push({t:'Нет цены для заказчика: заполните цены в КП или укажите цену здесь', bad:true});
  if (!equipSum && !Lsum && !Tsum && !M && !E) warn.push({t:'Расходы не указаны: укажите закупку в разделе «Цены» или суммы здесь', go:'price'});
  return { S, v, vatFromKp, rate, rateSrc, used:[...used].filter(c=>c!=='RUB'), sup:S_, M, E, Vo, cAdv, cDay, defer, i,
    rows, F, D, Tend, R, VATs, Ccash, equipSum, Lsum, Tsum, voSup, unknown, base, lo, hi, cashBefore:S-Ccash-F, err, warn, ok:!Object.keys(err).length };
}

if (typeof module!=='undefined') module.exports={dealCalc, dealBlank, dealNewSupplier, dNum};
