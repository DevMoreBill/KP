// Экономика сделки — расчёт (без интерфейса). Методика: «Калькулятор расчёта экономики сделки».
// Все суммы — в рублях, полные платежи с налогами; без промежуточного округления.
//   R = S / (1 + v/100)                         выручка без НДС
//   C_cash = все платежи (оборудование, логистика, таможня, комиссии, страхование, монтаж, прочее, резервы)
//   C_net = C_cash − НДС к вычету;  C_total = C_net + F;  P = R − C_total
//   Наценка = P / C_total;  Маржинальность = P / R;  чистая прибыль = P − налог на прибыль (если P > 0)
// Финансирование F — простой процент (месяц = 30 дней) на недостающие деньги по графику платежей и поступлений
// до последней оплаты заказчика. Без аванса заказчика это ровно Σ платёж × i/100 × дней до оплаты / 30;
// поступления заказчика уменьшают финансируемую сумму, доход на свободный остаток не начисляется.
// Прочие расходы наличными (необязательно, d.xc): X — сумма на руки, «чистыми»; mode: net — % от чистой прибыли сделки
//   (после налога на прибыль, до этих расходов), sale — % от выручки без НДС, salevat — % от суммы продажи с НДС, sum — сумма в рублях. Получение наличных
//   стоит xc.cost % от перечисленного: расход компании K = X / (1 − cost/100). Налоговую базу K не уменьшает:
//   налог = P_учёт × ставка, где P_учёт = R − C_total; прибыль сделки P = P_учёт − K; чистая прибыль = P_учёт − налог − K.
//   Когда (xc.when): end — после последней оплаты заказчика (на финансирование не влияет); pay — частями с оплат заказчика
//   (аванс, промежуточные, окончательная; xc.off[этап]=false — с этой оплаты не выдаётся), пропорционально суммам оплат,
//   в день оплаты. Выданные раньше конца сделки наличные увеличивают финансирование; при расчёте от чистой прибыли сумма
//   и финансирование зависят друг от друга — считается последовательными приближениями до совпадения.
// Сроки в днях — календарных или рабочих (…K='work': prodK, shipK, pay[j].offK, cust.tr[k].offK, pnrK): рабочие дни
//   считаются по производственному календарю (kp.addWork), без даты договора — приблизительно (×7/5).
// Банковская гарантия (d.bg — список, необязательно): сумма — от аванса заказчика (% от всех оплат до поставки),
//   % от цены КП или в рублях; комиссия банка = сумма × ставка % годовых × дней / 365, не меньше минимальной.
//   Платится при выдаче гарантии (по умолчанию — при подписании договора), уменьшает прибыль и налоговую базу.
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

// Таможенные сборы за таможенные операции (ввоз), ₽ — фиксированная сумма за декларацию по её общей таможенной
// стоимости (цена товара + доставка до границы ЕАЭС + страховка, в рублях по курсу ЦБ на дату подачи декларации).
// ПП РФ от 28.11.2024 № 1637 в редакции ПП РФ от 23.10.2025 № 1638 — ставки с 01.01.2026.
// При изменении ставок поправьте таблицу; в расчёте сбор можно вписать вручную.
const CUSTOMS_FEES = { title:'ПП РФ № 1637 в ред. № 1638, с 01.01.2026', scale:[[200000,1231],[450000,2462],[1200000,4924],[2700000,13541],[4200000,18465],[5500000,21344],[10000000,49240],[Infinity,73860]] };

function customsFee(cv){ if (!(cv>0)) return 0; for (const [lim,fee] of CUSTOMS_FEES.scale) if (cv<=lim) return fee; return 0; }
// интервал шкалы для подсказки: «таможенная стоимость 3 100 000 ₽ — интервал 2 700 000,01–4 200 000 ₽»
function customsFeeBand(cv){ if (!(cv>0)) return ''; const sc=CUSTOMS_FEES.scale, i=sc.findIndex(x=>cv<=x[0]); if (i<0) return '';
  const f=v=>Math.round(v).toLocaleString('ru-RU'), lo=i?f(sc[i-1][0])+',01':'0', hi=sc[i][0]===Infinity?'и выше':'– '+f(sc[i][0]);
  return `таможенная стоимость ${f(cv)} ₽ → интервал ${lo} ${hi} ₽ → сбор ${f(sc[i][1])} ₽`; }

// Коды ТН ВЭД ЕАЭС и ставки ввозной пошлины по категориям оборудования — СПРАВОЧНО: ставка зависит от полного кода
// (10 знаков), его подтверждает таможенный брокер. В программе любой код и ставку можно исправить — для категории
// или для конкретной модели (хранится в базе, общая для отдела).
const DEAL_HS = {
  st_pump:          {code:'8413 70', duty:'0', note:'Насосная станция в контейнере — по основному насосу (центробежные); с двигателем внутреннего сгорания — 8413 81'},
  st_comp:          {code:'8414 80', duty:'0', note:'Компрессорная станция в контейнере — по компрессору (блочно-модульная установка)'},
  st_dgu:           {code:'8502 13', duty:'5', note:'Дизельная электростанция в контейнере — как ДГУ: до 75 кВА — 8502 11, 75–375 кВА — 8502 12, свыше 375 кВА — 8502 13'},
  container:        {code:'9406 90', duty:'', note:'Блок-контейнер — сборные строительные конструкции из чёрных металлов; ставку пошлины уточните у таможенного брокера'},
  dgu:              {code:'8502 13', duty:'5', note:'Генераторные установки с дизельным двигателем: до 75 кВА — 8502 11, 75–375 кВА — 8502 12, свыше 375 кВА — 8502 13'},
  light:            {code:'8502 39', duty:'5', note:'Осветительная мачта с генератором; без генератора — 9405'},
  welder:           {code:'8502 20', duty:'5', note:'Сварочный агрегат с двигателем; сварочные аппараты без двигателя — 8515'},
  comp_diesel:      {code:'8414 40', duty:'0', note:'Воздушные компрессоры на колёсном шасси, буксируемые'},
  comp_screw:       {code:'8414 80', duty:'0', note:'Компрессоры воздушные винтовые'},
  comp_scroll:      {code:'8414 80', duty:'0', note:'Компрессоры воздушные спиральные'},
  comp_piston:      {code:'8414 80', duty:'0', note:'Компрессоры воздушные поршневые'},
  comp_centrifugal: {code:'8414 80', duty:'0', note:'Турбокомпрессоры (центробежные)'},
  dryer_ads:        {code:'8421 39', duty:'0', note:'Оборудование для очистки газов (адсорбционные осушители)'},
  dryer_refrig:     {code:'8419 89', duty:'0', note:'Рефрижераторные осушители сжатого воздуха'},
  filter:           {code:'8421 39', duty:'0', note:'Фильтры для очистки газов'},
  receiver:         {code:'7311 00', duty:'5', note:'Ёмкости для сжатого газа из чёрных металлов'},
  blower:           {code:'8414 59', duty:'0', note:'Воздуходувки (нагнетатели) роторные; вакуумные насосы — 8414 10'},
  gen_n2:           {code:'8421 39', duty:'0', note:'Установки разделения газов (адсорбционные генераторы азота)'},
  gen_o2:           {code:'8421 39', duty:'0', note:'Установки разделения газов (адсорбционные генераторы кислорода)'},
  oil_sep:          {code:'8421 39', duty:'0', note:'Сепараторы масляного тумана и конденсата — оборудование для очистки газов'},
  ats:              {code:'8537 10', duty:'0', note:'Щиты и пульты управления на напряжение до 1000 В'},
  pump:             {code:'8413 70', duty:'0', note:'Насосы центробежные; мотопомпы с двигателем — 8413 70 / 8413 81'},
  spare:            {code:'8414 90', duty:'0', note:'Части компрессоров; части генераторов — 8503 00, фильтроэлементы — 8421 99, части насосов — 8413 91'},
  other:            {code:'8479 89', duty:'0', note:'Прочие машины и механизмы — уточните код по виду оборудования'},
};

// код для ДГУ — по мощности (кВА, иначе кВт / 0,8)
function dealHsAuto(cat, attrs){ const h=DEAL_HS[cat]; if (!h) return null;
  if (cat==='dgu' || cat==='st_dgu'){ const kva=dNum(attrs&&attrs.kva) || (dNum(attrs&&attrs.kw)||0)/0.8; if (kva>0) return {...h, code: kva<=75?'8502 11':kva<=375?'8502 12':'8502 13'}; }
  return h; }

// страна поставщика → таможенный режим, валюта, НДС
const DEAL_EAEU = ['Беларусь','Казахстан','Армения','Киргизия'];
const DEAL_COUNTRIES = [['Китай','CNY'],['Турция','USD'],['Германия','EUR'],['Италия','EUR'],['Россия','RUB'],['Беларусь','RUB'],['Казахстан','RUB'],
  ['Индия','USD'],['Корея','USD'],['Япония','USD'],['США','USD'],['Чехия','EUR'],['Польша','EUR'],['Испания','EUR'],['Франция','EUR'],['Швеция','EUR'],
  ['Финляндия','EUR'],['Великобритания','EUR'],['Тайвань','USD'],['Вьетнам','USD'],['ОАЭ','USD'],['Армения','RUB'],['Киргизия','RUB']];

function dealCountryPreset(country){ const c=String(country||'').trim(); if (!c) return null;
  if (/^росс/i.test(c)) return {cusMode:'none', vatIn:true, cur:'RUB'};
  if (DEAL_EAEU.some(x=>x.toLowerCase()===c.toLowerCase())) return {cusMode:'eaeu', vatIn:false, cur:'RUB'};
  const k=DEAL_COUNTRIES.find(x=>x[0].toLowerCase()===c.toLowerCase()); return {cusMode:'calc', vatIn:false, cur:k?k[1]:'USD'}; }

// этапы оплаты заказчика: событие + дней после него
const DEAL_EVENTS = { sign:'после подписания договора', ready:'при готовности к отгрузке', delivery:'после поставки', pnr:'после ПНР' };

// банковская гарантия: вид
const DEAL_BG_TYPES = { adv:'На возврат аванса', perf:'Исполнения договора', warr:'Гарантийных обязательств' };
// разработка документации: виды (отметки в «Расходах»; в условиях КП — какие виды входят в стоимость)
const DEAL_DOC_KINDS = { pd:'проектная', rd:'рабочая', id:'исполнительная' };
const dealDocKinds = d => Object.keys(DEAL_DOC_KINDS).filter(k=>d && d.docK && d.docK[k]).map(k=>DEAL_DOC_KINDS[k]).join(', ');
// ставка банка за гарантию по умолчанию, % годовых от суммы гарантии за её срок. Рынок 2026: обычно 1–3,5 %,
// в среднем ~2,2 % (Сбербанк — от 2 %, ВТБ — от 3,7 %); 3 % — с запасом для коммерческого договора. Правится в каждой гарантии.
const dealBgRate = () => typeof DEFN==='function' ? DEFN('deal.bgRate', 3) : 3;     // ставка банковской гарантии по умолчанию, % годовых (Настройки → Умолчания)

// этапы оплаты поставщику: событие поставки + дней после него; последний этап — остаток до 100 %
const DEAL_SUP_EVENTS = { order:'при заказе', ready:'перед отгрузкой (готовность)', delivery:'после поставки', pnr:'после шефмонтажа и ПНР' };

// этапы оплаты поставщику; у расчётов прежних версий — из «Аванс, %»: аванс при заказе, остаток перед отгрузкой
function dealSupPay(s){
  if (Array.isArray(s.pay) && s.pay.length) return s.pay;
  const a=dNum(s.adv);
  return a>0 ? [{name:'Аванс', pct:String(s.adv), ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}] : [{name:'Оплата', ev:'ready', off:'0'}];
}

// новый поставщик: страна, сроки, НДС при ввозе и этапы оплаты — из умолчаний администратора (Настройки → Умолчания)
const dealDef = (k, fb) => typeof DEF==='function' ? DEF(k) : fb;
function dealNewSupplier(id, def={}){
  const country=def.country!==undefined ? def.country : (dealDef('deal.country', 'Россия')||'');
  const p=dealCountryPreset(country) || {cusMode:'sum', vatIn:false};
  const s={ id, name:'', country, vatIn:p.vatIn, adv:def.adv??'20', prod:def.prod??dealDef('deal.prod','40')??'', ship:def.ship??dealDef('deal.ship','40')??'',
    extra:{v:'',cur:'RUB'}, log:{v:'',cur:'RUB'}, logRu:{v:''}, cusMode:p.cusMode, cus:{v:'',cur:'RUB'}, vi:'', vo:'',
    duty:'', ivat:dealDef('deal.ivat','22')||'22', fee:'', ins:'', fx:'', brk:{v:''}, voRu:'' };
  const pp=dealDef('deal.supPay', null);
  if (pp && typeof DL_SP_PRESETS!=='undefined' && DL_SP_PRESETS[pp]) s.pay=JSON.parse(JSON.stringify(DL_SP_PRESETS[pp][1]));
  return s;
}

function dealBlank(def={}){
  const adv=def.cAdv&&+def.cAdv>0 ? String(def.cAdv) : '', cp=dealDef('deal.custPay', null), tg=dealDef('deal.target', null);
  const tr = adv ? [{pct:adv, ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:def.defer??'30'}]
    : cp && typeof DL_TR_PRESETS!=='undefined' && DL_TR_PRESETS[cp] ? JSON.parse(JSON.stringify(DL_TR_PRESETS[cp][1])) : [{pct:'', ev:'delivery', off:def.defer??'30'}];
  return { v:3, touched:false, over:{price:'',vat:''}, rates:{}, sup:[dealNewSupplier('s1',def)], map:{},
    mnt:'', pnr:'', oth:'', doc:'', docK:{}, vo:'', warr:'', bonus:'', tax:def.tax??dealDef('deal.tax','25')??'25',
    cust:{ tr }, money:def.money??'', days:{}, target:{type:'margin', v:tg||''} };
}

// расчёт прежней версии (v1) → v2: недостающие поля, график оплаты заказчика этапами
function dealUpgrade(d){
  if (!d) return d;
  if (d.v===2){ d.sup.forEach(s=>{ if (s.country==null) s.country=''; }); d.v=3; return d; }
  if (d.v>=3) return d;
  d.sup=(d.sup||[]).map(s=>{ const n={...dealNewSupplier(s.id), ...s}; if (!s.pay) delete n.pay; return n; });   // этапы — из аванса прежней версии
  const c=d.cust||{}, adv=dNum(c.adv)||0;
  d.cust={ tr: adv>0 ? [{pct:String(c.adv), ev:'sign', off:String(c.day||'0')}, {pct:'', ev:'delivery', off:String(c.defer??'30')}]
    : [{pct:'', ev:'delivery', off:String(c.defer??'30')}] };
  Object.assign(d, { pnr:d.pnr??'', warr:d.warr??'', bonus:d.bonus??'', tax:d.tax??'25', target:d.target||{type:'margin', v:''}, v:3 });
  return d;
}

// kp — данные конструктора: { sumRub, vat, rates:{CNY:'12,4',…}, costNoVat, items:[{id,name,qty,cost,cur}], moneyAuto } (cost — за единицу, в валюте cur)
// d — S.deal (строки из полей). Возвращает все величины, график, структуру затрат, ошибки и предупреждения.
function dealAddDays(kp, base, n, kind){
  n=+n||0; if (kind!=='work' || !n) return base+n;
  return kp && kp.addWork ? kp.addWork(base, n) : base+Math.ceil(n*7/5);
}
const dlDaysTxt=(n,k)=>`${n} ${k==='work'?(n%10===1&&n%100!==11?'рабочий день':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'рабочих дня':'рабочих дней'):(n%10===1&&n%100!==11?'календарный день':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'календарных дня':'календарных дней')}`;

function dealCalc(kp, d){
  d=dealUpgrade(d);
  const err={}, warn=[];
  const addD=(base, n, k)=>dealAddDays(kp, base, n, k);
  const dk=k=>k==='work'?' раб. дн.':' дн.';
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
    const noVat = s.noVat!=null ? !!s.noVat : !!kp.costNoVat;      // цены поставщика указаны без НДС — к платежу добавляется НДС
    const byCur={}; let equip=0, equipFx=0; const noCost=[], lines=[];
    for (const x of items){ const q=+x.qty||0; if (!(x.cost>0)){ noCost.push(x); continue; }
      const c=x.cur||'RUB'; used.add(c); byCur[c]=(byCur[c]||0)+x.cost*q;
      const r=rate(c); if (!(r>0)) { err[P+'.rate']=`Нет курса ${c}`; continue; }
      const a=x.cost*q*r*(noVat?vatK:1); equip+=a; if (c!=='RUB') equipFx+=a;
      lines.push({id:x.id, name:x.name, qty:q, rub:a, duty:x.duty, code:x.code||''}); }
    const ex=num(P+'.extra', s.extra&&s.extra.v, {def:0}); if (ex){ const c=(s.extra.cur)||'RUB'; byCur[c]=(byCur[c]||0)+ex; }
    const exRub=money(P+'.extra', s.extra)*(noVat?vatK:1); equip+=exRub; if ((s.extra&&s.extra.cur||'RUB')!=='RUB') equipFx+=exRub;
    if (exRub) lines.push({id:'extra', name:'Прочая закупка у поставщика', qty:1, rub:exRub, duty:dNum(s.duty), code:''});
    const L=money(P+'.log', s.log), Lfx=(s.log&&s.log.cur||'RUB')!=='RUB' ? L : 0;
    const Lru=money(P+'.logRu', s.logRu, 'RUB'), brk=money(P+'.brk', s.brk, 'RUB');
    const adv=num(P+'.adv', s.adv, {def:0, max:100}), prod=num(P+'.prod', s.prod, {def:0, int:true}), ship=num(P+'.ship', s.ship, {def:0, int:true});
    const insP=num(P+'.ins', s.ins, {def:0, max:100}), fxP=num(P+'.fx', s.fx, {def:0, max:100});
    const ins=equip*insP/100, fxE=equipFx*fxP/100, fxL=Lfx*fxP/100;
    const payRaw=dealSupPay(s); let paySum=0;
    const stages=payRaw.map((t,j)=>{ const last=j===payRaw.length-1, p=last?null:num(`${P}.pay.${j}.pct`, t.pct, {def:0, max:100}); if (!last) paySum+=p;
      return {j, p, last, name:String(t.name||'').trim(), ev:DEAL_SUP_EVENTS[t.ev]?t.ev:'ready', off:num(`${P}.pay.${j}.off`, t.off, {def:0, int:true}), offK:t.offK==='work'?'work':''}; });
    if (paySum>100.0001) err[P+'.pay']='Сумма этапов оплаты поставщику больше 100 %';
    stages[stages.length-1].p=Math.max(0, 100-paySum);
    // таможня: расчёт по позициям (пошлина у каждой своя), ЕАЭС (только НДС), сумма целиком или нет (Россия)
    const mode = ['calc','eaeu','none','sum'].includes(s.cusMode) ? s.cusMode : 'sum';
    let T=0, vi=null, cv=0, dutyA=0, fee=0, feeAuto=true, ivatA=0; const noDuty=[];
    const ivP=num(P+'.ivat', s.ivat, {def:22, max:100});
    if (mode==='calc'){
      const add=L+ins;                                              // логистика до границы и страхование — в таможенную стоимость пропорционально цене
      for (const ln of lines){ ln.cv=ln.rub+(equip>0?add*ln.rub/equip:0); const dp=ln.duty; if (dp==null || Number.isNaN(dp)){ noDuty.push(ln); ln.dutyA=0; } else ln.dutyA=ln.cv*dp/100; cv+=ln.cv; dutyA+=ln.dutyA; }
      if (!lines.length) cv=add;
      const feeOwn=num(P+'.fee', s.fee); feeAuto=feeOwn==null; fee=feeAuto?customsFee(cv):feeOwn;
      ivatA=(cv+dutyA)*ivP/100; T=dutyA+fee+ivatA; vi=ivatA;
    } else if (mode==='eaeu'){                                      // ЕАЭС: пошлины и сбора нет, НДС при ввозе — в налоговую, к вычету
      cv=equip; ivatA=equip*ivP/100; T=ivatA; vi=ivatA;
    } else if (mode==='none'){ vi=0;                                // поставка внутри России — таможни нет
    } else {
      T=money(P+'.cus', s.cus);
      vi=num(P+'.vi', s.vi); if (vi==null && !T) vi=0;               // нет растаможки — нечего вычитать
      if (vi!=null && vi>T+0.005) err[P+'.vi']='Не больше суммы растаможки';
    }
    const suggest = s.vatIn ? inVat(equip) : 0;
    let vo = s.vatIn ? num(P+'.vo', s.vo) : 0; const voAuto = s.vatIn && vo==null; if (voAuto) vo=suggest;
    if (vo>equip+0.005) err[P+'.vo']='Не больше стоимости оборудования';
    const ruSuggest=inVat(Lru+brk); let voRu=num(P+'.voRu', s.voRu); const voRuAuto=voRu==null; if (voRuAuto) voRu=ruSuggest;
    if (voRu>Lru+brk+0.005) err[P+'.voRu']='Не больше суммы услуг в России';
    const cash=equip+fxE+fxL+ins+L+T+brk+Lru;
    const prodK=s.prodK==='work'?'work':'', shipK=s.shipK==='work'?'work':'', rdy=addD(0, prod, prodK), arr=addD(rdy, ship, shipK);
    return { id:s.id, name:(s.name||'').trim()||`Поставщик ${k+1}`, country:s.country||'', items, noCost, lines, byCur, noVat, equip, equipFx, L, Lru, brk, T, adv, prod, ship, prodK, shipK, rdy, arr, ins, fxE, fxL, stages,
      mode, calc:mode==='calc', cv, dutyA, fee, feeAuto, ivatA, ivP, noDuty, vi, vo, voAuto, suggest, voRu, voRuAuto, ruSuggest, cash, active: cash>0 }; });
  // сборка станции: элементы едут к сборщику (обычно производитель контейнера), там собирают и испытывают, потом станция едет
  // заказчику. У поставщиков элементов «доставка» — до сборщика; у сборщика «готово» — станция собрана, «доставка» — до заказчика
  const asm=d.asm||{}, kitIds=new Set((kp.items||[]).filter(x=>x.kit).map(x=>x.id));
  // сборщик — выбранный, иначе поставщик контейнера станции
  const A = asm.on!==false && kitIds.size ? (S_.find(s=>s.id===asm.sup) || S_.find(s=>s.items.some(x=>x.role==='container')) || null) : null;
  let asmC=null;
  if (asm.on!==false && kitIds.size && !A) warn.push({t:'Сборка станции: выберите, кто собирает станцию (производитель контейнера) — на вкладке «Закупка»', go:'buy'});
  if (A){
    const toAsm=S_.filter(s=>s!==A && s.items.some(x=>kitIds.has(x.id)));
    const days=num('asm.days', asm.days, {def:0, int:true}), daysK=asm.daysK==='work'?'work':'', cost=num('asm.cost.v', asm.cost&&asm.cost.v, {def:0});
    toAsm.forEach(s=>{ s.toAsm=true; if (s.items.some(x=>!kitIds.has(x.id))) warn.push({t:`${s.name}: позиции не из станции тоже поедут на сборку — выберите для них другого поставщика или отключите сборку`}); });
    const cRdy=A.rdy, start=Math.max(cRdy, ...toAsm.filter(s=>s.active).map(s=>s.arr)), end=addD(start, days, daysK);
    const late=toAsm.filter(s=>s.active && s.arr===start && start>cRdy);
    A.isAsm=true; A.active=true; A.cRdy=cRdy; A.asmStart=start; A.rdy=end; A.arr=addD(end, A.ship, A.shipK);
    asmC={on:true, A, toAsm, days, daysK, cost, start, end, cRdy, arr:A.arr, late};
  }
  for (const s of S_) if (s.noDuty.length) warn.push({t:`${s.name}: нет ставки пошлины у ${s.noDuty.length} ${s.noDuty.length===1?'позиции':'позиций'} — считается 0 %`});
  for (const s of S_) for (const x of s.noCost) warn.push({t:`«${x.name||'Без названия'}»: не указана цена закупки — позиция не учтена в расходах`});
  const M=num('mnt', d.mnt, {def:0}), E=num('oth', d.oth, {def:0}), Dc=num('doc', d.doc, {def:0}), pnrDays=num('pnr', d.pnr, {def:0, int:true});
  const Vo=num('vo', d.vo, {def:0});
  const warrP=num('warr', d.warr, {def:0, max:100}), bonusP=num('bonus', d.bonus, {def:0, max:100}), taxP=num('tax', d.tax, {def:25, max:100});
  const xc=d.xc||{}, xMode=['net','sale','salevat','sum'].includes(xc.mode)?xc.mode:'net';
  const xV=num('xc.v', xc.v, {def:0, max:xMode==='sum'?null:100}), xCost=num('xc.cost', xc.cost, {def:0, max:90}), xG=1/(1-xCost/100);
  const moneyOwn=num('money', d.money); const moneyAuto=moneyOwn==null; const i=moneyAuto ? (kp.moneyAuto ?? 2) : moneyOwn;
  const R=S/vatK, VATs=S-R;
  const W=R*warrP/100, Bn=R*bonusP/100;
  const sumOf=f=>S_.reduce((a,s)=>a+f(s),0);
  const viSum=sumOf(s=>s.vi||0), Tsum=sumOf(s=>s.T), Lsum=sumOf(s=>s.L), LruSum=sumOf(s=>s.Lru), brkSum=sumOf(s=>s.brk);
  if (Vo > Lsum+Tsum+M+E+Dc-viSum+0.005) err['vo']='Не больше расходов на логистику, таможню, монтаж и прочее за вычетом ввозного НДС';
  // график: платежи поставщикам, доставка по России, монтаж при поставке, поступления заказчика, бонусы и резерв
  const act=S_.filter(s=>s.active), multi=act.length>1, rows=[];
  const dayOf=(key, auto)=>{ const o=d.days&&d.days[key]; const n=dNum(o); if (o!=null && o!=='' && (Number.isNaN(n)||n<0||!Number.isInteger(n))) err['days.'+key]='Целое число дней'; return (n!=null && n>=0 && Number.isInteger(n)) ? n : auto; };
  let D=0, Rdy=0;
  for (const s of act){ if (s.toAsm) continue; D=Math.max(D, s.arr); Rdy=Math.max(Rdy, s.rdy); }
  const pnrK=d.pnrK==='work'?'work':'', pnrEnd=addD(D, pnrDays, pnrK);
  // поставщику: этапы оплаты оборудования (с комиссией банка), перевозка, страхование, таможня и брокер — перед отгрузкой
  for (const s of act){ const nm=multi?` «${s.name}»`:'', arr=s.arr, base=s.equip+s.fxE;
    const sd={order:0, ready:s.rdy, delivery:arr, pnr:pnrEnd};
    for (const st of s.stages){ const a=base*st.p/100; if (!(a>0)) continue;
      const nmS=st.name || (st.j===0 && st.ev==='order' ? 'Аванс' : st.last && s.stages.length>1 ? 'Остаток' : 'Оплата');
      rows.push({key:`sp:${s.id}:${st.j}`, auto:addD(sd[st.ev], st.off, st.offK), label:`Поставщику: ${nmS.charAt(0).toLowerCase()+nmS.slice(1)} ${dlPctTxt(st.p)}${nm}`, amount:-a, party:'sup', ev:DEAL_SUP_EVENTS[st.ev]+(st.off?` + ${st.off}${dk(st.offK)}`:'')}); }
    const B=s.fxL+s.ins+s.L+s.T+s.brk;
    if (B>0) rows.push({key:'log:'+s.id, auto:s.rdy, label:(s.T?'Перевозка, таможня и сборы':'Перевозка и сборы')+nm, amount:-B, party:'log', ev:'перед отгрузкой'});
    if (s.Lru>0) rows.push({key:'ru:'+s.id, auto:arr, label:'Доставка по России'+nm, amount:-s.Lru, party:'log', ev:'при поставке'}); }
  if (asmC && asmC.cost>0) rows.push({key:'asm', auto:asmC.end, label:`Сборка станции у «${asmC.A.name}»`, amount:-asmC.cost, party:'sup', ev:'после сборки'});
  if (Dc>0) rows.push({key:'doc', auto:Rdy, label:'Разработка документации', amount:-Dc, party:'oth', ev:'до отгрузки'});
  if (M+E>0) rows.push({key:'mnt', auto:D, label:'Монтаж, ПНР и прочие расходы', amount:-(M+E), party:'oth', ev:'при поставке'});
  // этапы оплаты заказчика: последний этап — остаток до 100 %
  const ev={sign:0, ready:Rdy, delivery:D, pnr:pnrEnd};
  const tr=(d.cust&&d.cust.tr&&d.cust.tr.length)?d.cust.tr:[{pct:'',ev:'delivery',off:'30'}];
  // этап — процентом или суммой в рублях (sum), со своим названием (name); последний — остаток
  let pctSum=0; const trs=tr.map((t,k)=>{ const last=k===tr.length-1, bySum=!last && t.mode==='sum';
    let p=null, sum=null;
    if (bySum){ sum=num(`cust.tr.${k}.sum`, t.sum, {def:0}); p=S>0?sum/S*100:0; }
    else if (!last) p=num(`cust.tr.${k}.pct`, t.pct, {def:0, max:100});
    if (!last) pctSum+=p;
    const off=num(`cust.tr.${k}.off`, t.off, {def:0, int:true});
    return {k, p, sum, bySum, name:String(t.name||'').trim(), ev:DEAL_EVENTS[t.ev]?t.ev:'delivery', off, offK:t.offK==='work'?'work':'', last}; });
  const restPct=100-pctSum; if (restPct<-0.0001) err['cust.tr']='Сумма этапов больше 100 %';
  trs[trs.length-1].p=Math.max(0,restPct);
  for (const t of trs){ if (!(t.p>0)) continue;
    rows.push({key:'c'+t.k, auto:addD(ev[t.ev], t.off, t.offK), label:`${t.name||'Оплата заказчика'} ${dlPctTxt(t.p)} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off}${dk(t.offK)}`:''}`, amount:t.bySum?t.sum:S*t.p/100, inflow:true, post:t.ev==='delivery'||t.ev==='pnr', pct:t.p, stage:t.k, party:'cust', ev:DEAL_EVENTS[t.ev]+(t.off?` + ${t.off}${dk(t.offK)}`:'')}); }
  if (!rows.some(r=>r.inflow)) rows.push({key:'c0', auto:D, label:'Оплата заказчика', amount:0, inflow:true, post:true, pct:100});
  // банковские гарантии
  const advSum=trs.filter(t=>t.p>0 && (t.ev==='sign'||t.ev==='ready')).reduce((a,t)=>a+(t.bySum?t.sum:S*t.p/100),0);
  const bgs=(Array.isArray(d.bg)?d.bg:[]).map((g,k)=>{ const P=`bg.${k}`, type=DEAL_BG_TYPES[g.type]?g.type:'adv';
    const base=['adv','pct','sum'].includes(g.base)?g.base:(type==='adv'?'adv':'pct');
    const v=num(P+'.v', g.v, {def:base==='adv'?100:base==='pct'?10:0, max:base==='sum'?null:100});
    const amount = base==='adv' ? advSum*v/100 : base==='pct' ? S*v/100 : v;
    const daysAuto = type==='adv' ? D : type==='perf' ? pnrEnd : 365;
    const dOwn=num(P+'.days', g.days, {int:true}), days=dOwn==null?daysAuto:dOwn;
    const rate=num(P+'.rate', g.rate, {def:dealBgRate(), max:100}), min=num(P+'.min', g.min, {def:0});
    const fee = amount>0 && (rate>0||min>0) ? Math.max(min, amount*rate/100*days/365) : 0;
    return {k, type, base, v, amount, days, daysAuto, daysOwn:dOwn!=null, rate, min, fee}; });
  const BG=bgs.reduce((a,g)=>a+g.fee,0);
  for (const g of bgs) if (g.fee>0) rows.push({key:'bg:'+g.k, auto:0, label:`Банковская гарантия ${DEAL_BG_TYPES[g.type].toLowerCase()} — комиссия банка`, amount:-g.fee, party:'oth', ev:'при подписании договора'});
  if (bgs.some(g=>g.base==='adv') && !(advSum>0)) warn.push({t:'Банковская гарантия на возврат аванса: у заказчика нет аванса — укажите аванс в «Оплате заказчика» или сумму гарантии'});
  // день платежа: по срокам или вручную; при заданной дате отсчёта и производственном календаре (kp.workShift) расчётный
  // день переносится на ближайший рабочий (банковский) день, вручную заданный — остаётся, но помечается, если он нерабочий
  rows.forEach((r,k)=>{ r.day=dayOf(r.key, r.auto); r.manual=r.day!==r.auto; r.ord=k;
    if (kp.workShift){ if (!r.manual){ const w=kp.workShift(r.day); if (w!==r.day){ r.shiftedFrom=r.day; r.day=w; } } else if (kp.isOff && kp.isOff(r.day)) r.offDay=true; } });
  const Tend=Math.max(...rows.filter(r=>r.inflow).map(r=>r.day));
  if (Bn>0) rows.push({key:'bonus', auto:Tend, day:Tend, fixed:true, label:'Бонусы и комиссии с продажи', amount:-Bn, ord:rows.length});
  if (W>0) rows.push({key:'warr', auto:Tend, day:Tend, fixed:true, label:'Резерв на гарантию', amount:-W, ord:rows.length});
  const isX=r=>String(r.key).startsWith('xc');
  const tail=r=>isX(r)?2:(r.key==='bonus'||r.key==='warr')?1:0;
  // в один день: сначала деньги заказчика, потом платежи; постоплата (после поставки, после ПНР) — после платежей этого дня
  const inRank=r=>r.inflow ? (r.post?1:-1) : 0;
  const order=()=>rows.sort((a,b)=>a.day-b.day || tail(a)-tail(b) || inRank(a)-inRank(b) || a.ord-b.ord);
  const finance=()=>{ order(); let bal=0, Fsum=0;
    rows.forEach((r,k)=>{ bal+=r.amount; r.balance=bal; const nx=rows[k+1];
      r.days=Math.max(0, Math.min(nx?nx.day:Tend, Tend)-r.day); if (r.day>=Tend) r.days=0;
      r.fin=Math.max(0,-bal)*r.days*i/100/30; Fsum+=r.fin; });
    return Fsum; };
  // прочие расходы наличными в графике: с оплат заказчика (пропорционально) или после последней оплаты
  const xWhen=xc.when==='pay'?'pay':'end', xOffSt=xc.off||{};
  const xFrom=xWhen==='pay' ? rows.filter(r=>r.inflow && r.amount>0 && xOffSt[r.stage]!==false) : [];
  const xBase=xFrom.reduce((a,r)=>a+r.amount,0);
  const setX=K=>{ for (let k=rows.length-1; k>=0; k--) if (isX(rows[k])) rows.splice(k,1);
    if (!(K>0)) return;
    if (xBase>0) xFrom.forEach(r=>rows.push({key:'xc:'+r.key, auto:r.day, day:r.day, fixed:true, label:`Прочие расходы (наличные) — с оплаты ${dlPctTxt(r.pct||0)}${t2n(r)}`, amount:-K*r.amount/xBase, party:'oth', ord:rows.length, from:r.key}));
    else rows.push({key:'xc', auto:Tend, day:Tend, fixed:true, label:'Прочие расходы (наличные)', amount:-K, party:'oth', ord:rows.length}); };
  const t2n=r=>{ const t=trs[r.stage]; return t&&t.name ? ` «${t.name}»` : ''; };
  let F=finance();
  const equipSum=sumOf(s=>s.equip);
  const asmCost=asmC?asmC.cost:0;
  const Ccash=sumOf(s=>s.cash)+M+E+Dc+W+Bn+BG+asmCost;
  const voSup=sumOf(s=>s.vo), voRuSum=sumOf(s=>s.voRu);
  const unknown=S_.filter(s=>s.vi==null);
  const VATinKnown=viSum+voSup+voRuSum+Vo+inVat(asmCost);      // сборка — услуга в России с НДС
  const res=VATin=>{ const Cnet=Ccash-VATin, Ctot=Cnet+F, Pa=R-Ctot, vb=VATs-VATin, tax=Pa>0?Pa*taxP/100:0;
    const X = !xV ? 0 : xMode==='sum' ? xV : xMode==='sale' ? R*xV/100 : xMode==='salevat' ? S*xV/100 : Math.max(0, Pa-tax)*xV/100, K=X*xG, P=Pa-K;
    return { VATin, Cnet, Ctot, Pa, X, K, P, tax, net:Pa-tax-K, markup: Ctot+K?P/(Ctot+K)*100:null, margin: R?P/R*100:null, vatBal:vb, payable:Math.max(vb,0), excess:Math.max(-vb,0),
      cashAfter: S-Ccash-F-K-Math.max(vb,0) }; };
  const viHi=VATinKnown+unknown.reduce((a,s)=>a+s.T,0);
  let lo=res(VATinKnown), hi=unknown.length?res(viHi):lo, xIt=0;
  // наличные в графике меняют финансирование, финансирование — прибыль и (от чистой прибыли) сумму наличных: до совпадения
  for (let Kg=0; xIt<60; xIt++){ const K=lo.K; if (xIt>0 && Math.abs(K-Kg)<0.0005) break;
    Kg=K; setX(Kg); F=finance(); lo=res(VATinKnown); hi=unknown.length?res(viHi):lo; }
  const base=unknown.length?null:lo, xr=lo;
  if (base && Math.abs(base.P-(base.cashAfter+base.excess))>0.01) warn.push({t:'Контрольное равенство не сошлось — сообщите разработчику', bad:true});
  if (xr.K>0 && xr.net<0) warn.push({t:`Прочие расходы наличными (${Math.round(xr.K).toLocaleString('ru-RU')} ₽) больше чистой прибыли сделки — компания в убытке`, bad:true});
  if (!(S>0)) warn.push({t:'Нет цены для заказчика: заполните цены в КП или укажите цену здесь', bad:true});
  if (!equipSum && !Lsum && !Tsum && !M && !E && !Dc) warn.push({t:'Расходы не указаны: укажите цены закупки в шаге «Закупка»', go:'price'});
  // структура затрат (для итога и Excel)
  const parts=[['Оборудование', equipSum], ['Комиссии за перевод и конвертацию', sumOf(s=>s.fxE+s.fxL)], ['Страхование груза', sumOf(s=>s.ins)],
    ['Логистика до границы', Lsum], ['Таможенные платежи', Tsum], ['Брокер, СВХ, сертификация', brkSum], ['Доставка по России', LruSum], ['Сборка станции', asmCost],
    ['Монтаж и ПНР', M], ['Разработка документации', Dc], ['Банковская гарантия', BG], ['Прочие расходы', E], ['Бонусы и комиссии с продажи', Bn], ['Резерв на гарантию', W], ['Финансирование', F],
    ['НДС к вычету (уменьшает затраты)', -(base||lo).VATin]].filter(x=>Math.abs(x[1])>0.004);
  return { asm:asmC, bgs, BG, advSum, xc:{mode:xMode, when:xWhen, off:xOffSt, from:xFrom.map(r=>r.key), v:xV, cost:xCost, g:xG, on:xV>0}, S, v, vatFromKp, rate, rateSrc, used:[...used].filter(c=>c!=='RUB'), sup:S_, M, E, Dc, Vo, W, Bn, warrP, bonusP, taxP, pnrDays, pnrK, pnrEnd, trs, ev, i, moneyAuto,
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

if (typeof module!=='undefined') module.exports={dealAddDays, dlDaysTxt, DEAL_BG_TYPES, dealBgRate, DEAL_SUP_EVENTS, dealSupPay, dealCalc, dealBlank, dealNewSupplier, dealUpgrade, dealSolve, customsFee, customsFeeBand, dNum, CUSTOMS_FEES, DEAL_EVENTS, DEAL_HS, dealHsAuto, dealCountryPreset};
