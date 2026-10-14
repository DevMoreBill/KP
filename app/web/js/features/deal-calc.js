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

// Значения экономики сделки, которые правит администратор: «Настройки → Значения программы → Экономика сделки»
// (реестр — js/core/defaults.js, DefRegistry). Встроенные — прежние значения программы; читаются в момент расчёта.
class DealValues {
  // Таможенные сборы за таможенные операции (ввоз), ₽ — фиксированная сумма за декларацию по её общей таможенной
  // стоимости (цена товара + доставка до границы ЕАЭС + страховка, в рублях по курсу ЦБ на дату подачи декларации).
  // ПП РФ от 28.11.2024 № 1637 в редакции ПП РФ от 23.10.2025 № 1638 — ставки с 01.01.2026. [до, сбор]
  static FEE = [[200000,1231],[450000,2462],[1200000,4924],[2700000,13541],[4200000,18465],[5500000,21344],[10000000,49240],[Infinity,73860]];
  static FEE_TITLE = 'ПП РФ № 1637 в ред. № 1638, с 01.01.2026';
  static n(key, fb){ return typeof DEFN==='function' ? DEFN(key, fb) : fb; }
  /** шкала сбора из «Значений программы»; границы не по возрастанию — встроенная шкала (ошибку видно в «Настройках») */
  static feeScale(){ const B=this.FEE, out=B.map(([lim, fee], i)=>[i<B.length-1 ? this.n('deal.feeLim'+(i+1), lim) : Infinity, this.n('deal.fee'+(i+1), fee)]);
    for (let i=1; i<out.length; i++) if (!(out[i][0]>out[i-1][0])) return B.map(x=>[...x]);
    return out; }
  static feeOwn(){ return this.feeScale().some((x, i)=>x[0]!==this.FEE[i][0] || x[1]!==this.FEE[i][1]); }
  static rub(v){ return Math.round(v).toLocaleString('ru-RU'); }
  /** шкала текстом для подсказки: «до 200 000 ₽ — 1 231 ₽, …, свыше 10 000 000 ₽ — 73 860 ₽» */
  static feeText(){ const sc=this.feeScale(); return sc.map(([lim, fee], i)=>`${lim===Infinity ? 'свыше '+this.rub(sc[i-1][0]) : 'до '+this.rub(lim)} ₽ — ${this.rub(fee)} ₽`).join(', '); }
  static register(){
    if (typeof DefRegistry==='undefined') return;
    const B=this.FEE, last=B.length-1, rows=[];
    B.forEach(([lim, fee], i)=>{
      if (i<last) rows.push(['deal.feeLim'+(i+1), 'dealFee', `Интервал ${i+1}: таможенная стоимость до`, 'num', String(lim), {unit:'₽', req:true, min:1, max:1e10,
        hint:`Таможенная стоимость ${i ? 'больше границы интервала '+i+' и ' : ''}не больше этой суммы — сбор интервала ${i+1}. Границы должны расти от интервала к интервалу, иначе программа считает по шкале постановления.`}]);
      rows.push(['deal.fee'+(i+1), 'dealFee', i<last ? `Интервал ${i+1}: сбор` : `Интервал ${i+1} (дороже последней границы): сбор`, 'num', String(fee), {unit:'₽', req:true, min:0, max:1e6,
        hint:`Сколько платим на таможне за одну декларацию в интервале ${i+1}. Пример: таможенная стоимость ${this.rub(!i ? lim/2 : i<last ? (B[i-1][0]+lim)/2 : B[i-1][0]*1.5)} ₽ → сбор ${this.rub(fee)} ₽.`}]); });
    DefRegistry.add([
      ['dealFee', 'Таможенный сбор — шкала', 'deal', 'Сбор за таможенное оформление ввоза — одна сумма за декларацию, зависит от таможенной стоимости (цена оборудования + доставка до границы + страхование, в рублях). Ставки — ПП РФ от 28.11.2024 № 1637 в ред. ПП РФ от 23.10.2025 № 1638, действуют с 01.01.2026. Вышло новое постановление — поправьте границы и суммы здесь: расчёт сделки и Excel возьмут их сразу. В сделке сбор можно вписать и вручную.'],
      ['dealPay', 'Сроки и оплата — когда менеджер не выбрал своё', 'deal', 'Запасные значения: подставляются, если в «Значениях программы» выключены готовые варианты оплаты (выше) или менеджер их не выбрал.'],
      ['dealMoney', 'Деньги, наличные, банковская гарантия', 'deal', 'С чем считается стоимость денег, прочие расходы наличными и банковская гарантия в новой сделке. В каждой сделке менеджер может вписать своё.'],
    ], [...rows,
      ['deal.defer', 'dealPay', 'Окончательная оплата заказчика — через сколько дней после поставки', 'num', '30', {unit:'дн.', req:true, min:0, max:365,
        hint:'Отсрочка последнего платежа заказчика, если вариант «Оплата заказчика» не выбран. Пример: 30 — заказчик платит через 30 календарных дней после поставки, на эти дни программа считает стоимость денег.'}],
      ['deal.supAdv', 'dealPay', 'Аванс поставщику, если вариант оплаты поставщику не выбран', 'num', '20', {unit:'%', req:true, min:0, max:100,
        hint:'Доля цены оборудования, которую платим поставщику при заказе; остаток — перед отгрузкой. Действует, когда выключено значение «Оплата поставщику» в разделе «Экономика сделки». Пример: 20 % от 1 000 000 ₽ — 200 000 ₽ при заказе и 800 000 ₽ перед отгрузкой.'}],
      ['deal.monthDays', 'dealPay', 'Дней в месяце для стоимости денег', 'num', '30', {unit:'дн.', req:true, min:28, max:31,
        hint:'Финансирование = недостающие деньги × ставка % в месяц × дней / это число. По методике расчёта сделки месяц — 30 дней. Пример: 1 000 000 ₽ × 2 % × 45 дн. / 30 = 30 000 ₽.'}],
      ['deal.moneyFb', 'dealMoney', 'Стоимость денег, если ключевая ставка ЦБ не получена', 'num', '2', {unit:'% в месяц', req:true, min:0, max:20,
        hint:'Обычно стоимость денег = (ключевая ставка ЦБ + надбавка) / 12. Когда сайт ЦБ недоступен и сохранённой ставки нет — берётся это число. 2 % в месяц ≈ 24 % годовых.'}],
      ['deal.xcCost', 'dealMoney', 'Стоимость получения наличных', 'num', '0', {unit:'%', req:true, min:0, max:90,
        hint:'Для «Прочих расходов наличными»: сколько процентов от перечисленной суммы удерживают за выдачу наличных. Расход компании = сумма на руки / (1 − % / 100). Пример: на руки 100 000 ₽ при 10 % → расход 111 111 ₽. 0 — менеджер вписывает сам.'}],
      ['deal.bgAdvPct', 'dealMoney', 'Гарантия на возврат аванса — сумма, % от аванса', 'num', '100', {unit:'%', req:true, min:0, max:100,
        hint:'Новая банковская гарантия «На возврат аванса» — на эту долю авансов заказчика (все оплаты до поставки). Обычно заказчик требует гарантию на весь аванс — 100 %.'}],
      ['deal.bgPct', 'dealMoney', 'Гарантия исполнения и гарантийных обязательств — сумма, % от цены КП', 'num', '10', {unit:'%', req:true, min:0, max:100,
        hint:'Новая гарантия «Исполнения договора» или «Гарантийных обязательств» — на эту долю цены КП с НДС. По 44-ФЗ (ст. 96) обеспечение исполнения контракта — от 0,5 до 30 % начальной цены; точную долю пишет заказчик в документации.'}],
      ['deal.bgWarrDays', 'dealMoney', 'Срок гарантии гарантийных обязательств', 'num', '365', {unit:'дн.', req:true, min:1, max:3650,
        hint:'На сколько дней берётся гарантия «Гарантийных обязательств», если менеджер не вписал свой срок. Комиссия банка = сумма × ставка % годовых × дней / 365. Пример: гарантия 1 000 000 ₽, 3 % годовых, 365 дн. → 30 000 ₽.'}],
      ['deal.bgMin', 'dealMoney', 'Минимальная комиссия банка за гарантию', 'num', '0', {unit:'₽', req:true, min:0, max:1e7,
        hint:'У многих банков есть минимальная комиссия за выдачу гарантии — уточните в своём банке. Если комиссия по ставке меньше — в расчёт идёт эта сумма. 0 — без минимума.'}],
    ]);
  }
}
DealValues.register();

const CUSTOMS_FEES = { title:DealValues.FEE_TITLE, get scale(){ return DealValues.feeScale(); } };

function customsFee(cv){ if (!(cv>0)) return 0; for (const [lim,fee] of CUSTOMS_FEES.scale) if (cv<=lim) return fee; return 0; }
// интервал шкалы для подсказки: «таможенная стоимость 3 100 000 ₽ — интервал 2 700 000,01–4 200 000 ₽»
function customsFeeBand(cv){ if (!(cv>0)) return ''; const sc=CUSTOMS_FEES.scale, i=sc.findIndex(x=>cv<=x[0]); if (i<0) return '';
  const f=v=>Math.round(v).toLocaleString('ru-RU'), lo=i?f(sc[i-1][0])+',01':'0', hi=sc[i][0]===Infinity?'и выше':'– '+f(sc[i][0]);
  return `таможенная стоимость ${f(cv)} ₽ → интервал ${lo} ${hi} ₽ → сбор ${f(sc[i][1])} ₽`; }

// Коды ТН ВЭД ЕАЭС и ставки пошлины по видам оборудования — класс TnVed (features/tnved.js).

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
const dealBgRate = () => DealValues.n('deal.bgRate', 3);     // ставка банковской гарантии по умолчанию, % годовых (Настройки → Умолчания)

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
  const s={ id, name:'', country, vatIn:p.vatIn, adv:def.adv??String(DealValues.n('deal.supAdv', 20)), prod:def.prod??dealDef('deal.prod','40')??'', ship:def.ship??dealDef('deal.ship','40')??'',
    extra:{v:'',cur:'RUB'}, log:{v:'',cur:'RUB'}, logRu:{v:''}, cusMode:p.cusMode, cus:{v:'',cur:'RUB'}, vi:'', vo:'',
    duty:'', ivat:dealDef('deal.ivat','22')||'22', fee:'', ins:'', fx:'', brk:{v:''}, voRu:'' };
  const pp=dealDef('deal.supPay', null);
  if (pp && typeof DL_SP_PRESETS!=='undefined' && DL_SP_PRESETS[pp]) s.pay=JSON.parse(JSON.stringify(DL_SP_PRESETS[pp][1]));
  return s;
}

function dealBlank(def={}){
  const adv=def.cAdv&&+def.cAdv>0 ? String(def.cAdv) : '', cp=dealDef('deal.custPay', null), tg=dealDef('deal.target', null), defer=def.defer??String(DealValues.n('deal.defer', 30));
  const tr = adv ? [{pct:adv, ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:defer}]
    : cp && typeof DL_TR_PRESETS!=='undefined' && DL_TR_PRESETS[cp] ? JSON.parse(JSON.stringify(DL_TR_PRESETS[cp][1])) : [{pct:'', ev:'delivery', off:defer}];
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

// Расчёт сделки — класс: этапы расчёта — методы, общие величины — поля. Порядок шагов и проверок важен:
// ошибки и предупреждения выдаются в том же порядке, что видит менеджер. dealCalc(kp, d) — прежняя точка входа.
class DealCalculator {
  constructor(kp, d){ this.kp=kp; this.d=dealUpgrade(d); this.err={}; this.warn=[]; this.used=new Set(); this.rateSrc={}; }
  addD(base, n, k){ return dealAddDays(this.kp, base, n, k); }
  static dk(k){ return k==='work'?' раб. дн.':' дн.'; }
  /** число из поля с проверкой; ошибка — в err[path], возвращается запасное значение */
  num(path, s, o={}){ const v=dNum(s), err=this.err;
    if (v==null) return o.def!==undefined ? o.def : null;
    if (Number.isNaN(v)) { err[path]='Число, например 12 400,50'; return o.def??0; }
    if (v<0) { err[path]='Не может быть отрицательным'; return o.def??0; }
    if (o.max!=null && v>o.max) { err[path]=`Не больше ${o.max}`; return o.max; }
    if (o.int && !Number.isInteger(v)) { err[path]='Целое число дней'; return Math.round(v); }
    return v; }
  /** курс валюты к рублю: свой в расчёте сделки или из КП */
  rate(c){ if (!c||c==='RUB') return 1; const d=this.d;
    const own=d.rates&&d.rates[c];
    if (own!=null && own!==''){ const r=dNum(own); if (!(r>0)) { this.err['rates.'+c]='Курс больше 0'; return NaN; } this.rateSrc[c]='deal'; return r; }
    const r=dNum(this.kp.rates&&this.kp.rates[c]); this.rateSrc[c]='kp'; return r>0?r:NaN; }
  /** сумма в валюте → рубли */
  money(path, o, cur){ const a=this.num(path, o&&o.v, {def:0}); const c=cur||(o&&o.cur)||'RUB'; if (a) this.used.add(c);
    const r=this.rate(c); if (a && !(r>0)) { this.err[path]=this.err[path]||`Нет курса ${c}`; return 0; } return a*(r||0); }
  inVat(x){ return x*this.v/(100+this.v); }

  // ---------- цена, НДС
  price(){ const d=this.d, kp=this.kp;
    this.S = d.over.price!=='' && d.over.price!=null ? this.num('over.price', d.over.price, {def:0}) : (kp.sumRub||0);
    this.vatFromKp = d.over.vat==='' || d.over.vat==null;
    this.v = this.vatFromKp ? (+kp.vat||0) : this.num('over.vat', d.over.vat, {def:0, max:100});
    this.vatK=1+this.v/100; }

  // ---------- поставщик: закупка, логистика, таможня, этапы оплаты, сроки
  supplier(s, k, supOf){ const P=`sup.${k}`, kp=this.kp, vatK=this.vatK, num=(...a)=>this.num(...a), money=(...a)=>this.money(...a);
    const items=(kp.items||[]).filter(x=>supOf(x.id)===s.id);
    const mode = ['calc','eaeu','none','sum'].includes(s.cusMode) ? s.cusMode : 'sum';
    // цены поставщика без НДС — к платежу добавляется НДС; только у поставщика в России: у ввозимого НДС считается при ввозе
    const noVat = mode==='none' && (s.noVat!=null ? !!s.noVat : !!kp.costNoVat);
    const byCur={}; let equip=0, equipFx=0; const noCost=[], lines=[];
    for (const x of items){ const q=+x.qty||0; if (!(x.cost>0)){ noCost.push(x); continue; }
      const c=x.cur||'RUB'; this.used.add(c); byCur[c]=(byCur[c]||0)+x.cost*q;
      const r=this.rate(c); if (!(r>0)) { this.err[P+'.rate']=`Нет курса ${c}`; continue; }
      const a=x.cost*q*r*(noVat?vatK:1); equip+=a; if (c!=='RUB') equipFx+=a;
      lines.push({id:x.id, name:x.name, qty:q, rub:a, duty:x.duty, code:x.code||''}); }
    const ex=num(P+'.extra', s.extra&&s.extra.v, {def:0}); if (ex){ const c=(s.extra.cur)||'RUB'; byCur[c]=(byCur[c]||0)+ex; }
    const exRub=money(P+'.extra', s.extra)*(noVat?vatK:1); equip+=exRub; if ((s.extra&&s.extra.cur||'RUB')!=='RUB') equipFx+=exRub;
    // прочая закупка (опции, ЗИП): своя ставка пошлины или средняя по стоимости позиций поставщика с известной ставкой
    if (exRub){ const own=mode==='calc' ? num(P+'.duty', s.duty, {max:100}) : null, wd=lines.filter(l=>l.duty!=null && !Number.isNaN(l.duty)), wb=wd.reduce((a,l)=>a+l.rub,0);
      lines.push({id:'extra', name:'Прочая закупка у поставщика', qty:1, rub:exRub, duty: own!=null ? own : wb>0 ? wd.reduce((a,l)=>a+l.rub*l.duty,0)/wb : null,
        dutyAuto: own==null && wb>0, code:String(s.hsx||'').trim()}); }
    const L=money(P+'.log', s.log), Lfx=(s.log&&s.log.cur||'RUB')!=='RUB' ? L : 0;
    // доставка по России: «по расчёту» — рубли; «своя сумма» — в рублях или валюте (s.logRu.cur), в рубли по курсу
    const Lru=money(P+'.logRu', s.logRu), LruFx=(s.logRu&&s.logRu.cur||'RUB')!=='RUB', brk=money(P+'.brk', s.brk, 'RUB');
    const adv=num(P+'.adv', s.adv, {def:0, max:100}), prod=num(P+'.prod', s.prod, {def:0, int:true}), ship=num(P+'.ship', s.ship, {def:0, int:true});
    const insP=num(P+'.ins', s.ins, {def:0, max:100}), fxP=num(P+'.fx', s.fx, {def:0, max:100});
    const ins=equip*insP/100, fxE=equipFx*fxP/100, fxL=Lfx*fxP/100;
    const payRaw=dealSupPay(s); let paySum=0;
    const stages=payRaw.map((t,j)=>{ const last=j===payRaw.length-1, p=last?null:num(`${P}.pay.${j}.pct`, t.pct, {def:0, max:100}); if (!last) paySum+=p;
      return {j, p, last, name:String(t.name||'').trim(), ev:DEAL_SUP_EVENTS[t.ev]?t.ev:'ready', off:num(`${P}.pay.${j}.off`, t.off, {def:0, int:true}), offK:t.offK==='work'?'work':''}; });
    if (paySum>100.0001) this.err[P+'.pay']='Сумма этапов оплаты поставщику больше 100 %';
    stages[stages.length-1].p=Math.max(0, 100-paySum);
    // таможня: расчёт по позициям (пошлина у каждой своя), ЕАЭС (только НДС), сумма целиком или нет (Россия)
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
      if (vi!=null && vi>T+0.005) this.err[P+'.vi']='Не больше суммы растаможки';
    }
    const suggest = s.vatIn ? this.inVat(equip) : 0;
    let vo = s.vatIn ? num(P+'.vo', s.vo) : 0; const voAuto = s.vatIn && vo==null; if (voAuto) vo=suggest;
    if (vo>equip+0.005) this.err[P+'.vo']='Не больше стоимости оборудования';
    const ruSuggest=this.inVat(Lru+brk); let voRu=num(P+'.voRu', s.voRu); const voRuAuto=voRu==null; if (voRuAuto) voRu=ruSuggest;
    if (voRu>Lru+brk+0.005) this.err[P+'.voRu']='Не больше суммы услуг в России';
    const cash=equip+fxE+fxL+ins+L+T+brk+Lru;
    const prodK=s.prodK==='work'?'work':'', shipK=s.shipK==='work'?'work':'', rdy=this.addD(0, prod, prodK), arr=this.addD(rdy, ship, shipK);
    return { id:s.id, name:(s.name||'').trim()||`Поставщик ${k+1}`, country:s.country||'', items, noCost, lines, byCur, noVat, equip, equipFx, L, Lru, LruFx, brk, T, adv, prod, ship, prodK, shipK, rdy, arr, ins, fxE, fxL, stages,
      mode, calc:mode==='calc', cv, dutyA, fee, feeAuto, ivatA, ivP, noDuty, vi, vo, voAuto, suggest, voRu, voRuAuto, ruSuggest, cash, active: cash>0 }; }
  suppliers(){ const d=this.d;
    const sup=(d.sup&&d.sup.length?d.sup:[dealNewSupplier('s1')]);
    const supOf=id=>{ const s=d.map&&d.map[id]; return sup.some(x=>x.id===s) ? s : sup[0].id; };
    this.S_=sup.map((s,k)=>this.supplier(s, k, supOf)); }

  // ---------- сборка станции: элементы едут к сборщику (обычно производитель контейнера), там собирают и испытывают, потом станция едет
  // заказчику. У поставщиков элементов «доставка» — до сборщика; у сборщика «готово» — станция собрана, «доставка» — до заказчика
  assembly(){ const d=this.d, S_=this.S_, warn=this.warn;
    const asm=d.asm||{}, kitIds=new Set((this.kp.items||[]).filter(x=>x.kit).map(x=>x.id));
    // сборщик — выбранный, иначе поставщик контейнера станции
    const A = asm.on!==false && kitIds.size ? (S_.find(s=>s.id===asm.sup) || S_.find(s=>s.items.some(x=>x.role==='container')) || null) : null;
    this.asmC=null;
    if (asm.on!==false && kitIds.size && !A) warn.push({t:'Сборка станции: выберите, кто собирает станцию (производитель контейнера) — на вкладке «Закупка»', go:'buy'});
    if (A){
      const toAsm=S_.filter(s=>s!==A && s.items.some(x=>kitIds.has(x.id)));
      const days=this.num('asm.days', asm.days, {def:0, int:true}), daysK=asm.daysK==='work'?'work':'', cost=this.num('asm.cost.v', asm.cost&&asm.cost.v, {def:0});
      toAsm.forEach(s=>{ s.toAsm=true; if (s.items.some(x=>!kitIds.has(x.id))) warn.push({t:`${s.name}: позиции не из станции тоже поедут на сборку — выберите для них другого поставщика или отключите сборку`}); });
      const cRdy=A.rdy, start=Math.max(cRdy, ...toAsm.filter(s=>s.active).map(s=>s.arr)), end=this.addD(start, days, daysK);
      const late=toAsm.filter(s=>s.active && s.arr===start && start>cRdy);
      A.isAsm=true; A.active=true; A.cRdy=cRdy; A.asmStart=start; A.rdy=end; A.arr=this.addD(end, A.ship, A.shipK);
      this.asmC={on:true, A, toAsm, days, daysK, cost, start, end, cRdy, arr:A.arr, late};
    }
    for (const s of S_) if (s.noDuty.length) warn.push({t:`${s.name}: нет ставки пошлины у ${s.noDuty.length} ${s.noDuty.length===1?'позиции':'позиций'} — считается 0 %`});
    for (const s of S_) for (const x of s.noCost) warn.push({t:`«${x.name||'Без названия'}»: не указана цена закупки — позиция не учтена в расходах`}); }

  // ---------- прочие расходы сделки, налоги, стоимость денег
  expenses(){ const d=this.d, num=(...a)=>this.num(...a);
    this.M=num('mnt', d.mnt, {def:0}); this.E=num('oth', d.oth, {def:0}); this.Dc=num('doc', d.doc, {def:0}); this.pnrDays=num('pnr', d.pnr, {def:0, int:true});
    this.Vo=num('vo', d.vo, {def:0});
    this.warrP=num('warr', d.warr, {def:0, max:100}); this.bonusP=num('bonus', d.bonus, {def:0, max:100}); this.taxP=num('tax', d.tax, {def:DealValues.n('deal.tax', 25), max:100});
    const xc=d.xc||{}; this.xc=xc; this.xMode=['net','sale','salevat','sum'].includes(xc.mode)?xc.mode:'net';
    this.xV=num('xc.v', xc.v, {def:0, max:this.xMode==='sum'?null:100}); this.xCost=num('xc.cost', xc.cost, {def:DealValues.n('deal.xcCost', 0), max:90}); this.xG=1/(1-this.xCost/100);
    const moneyOwn=num('money', d.money); this.moneyAuto=moneyOwn==null; this.i=this.moneyAuto ? (this.kp.moneyAuto ?? DealValues.n('deal.moneyFb', 2)) : moneyOwn;
    this.R=this.S/this.vatK; this.VATs=this.S-this.R;
    this.W=this.R*this.warrP/100; this.Bn=this.R*this.bonusP/100;
    const S_=this.S_, sumOf=f=>S_.reduce((a,s)=>a+f(s),0); this.sumOf=sumOf;
    this.viSum=sumOf(s=>s.vi||0); this.Tsum=sumOf(s=>s.T); this.Lsum=sumOf(s=>s.L); this.LruSum=sumOf(s=>s.Lru); this.brkSum=sumOf(s=>s.brk);
    if (this.Vo > this.Lsum+this.Tsum+this.M+this.E+this.Dc-this.viSum+0.005) this.err['vo']='Не больше расходов на логистику, таможню, монтаж и прочее за вычетом ввозного НДС'; }

  // ---------- график: платежи поставщикам, доставка по России, монтаж при поставке
  supplierRows(){ const d=this.d, act=this.S_.filter(s=>s.active), multi=act.length>1, rows=this.rows=[], asmC=this.asmC, dk=DealCalculator.dk;
    let D=0, Rdy=0;
    for (const s of act){ if (s.toAsm) continue; D=Math.max(D, s.arr); Rdy=Math.max(Rdy, s.rdy); }
    this.D=D; this.Rdy=Rdy;
    this.pnrK=d.pnrK==='work'?'work':''; this.pnrEnd=this.addD(D, this.pnrDays, this.pnrK);
    // поставщику: этапы оплаты оборудования (с комиссией банка), перевозка, страхование, таможня и брокер — перед отгрузкой
    for (const s of act){ const nm=multi?` «${s.name}»`:'', arr=s.arr, base=s.equip+s.fxE;
      const sd={order:0, ready:s.rdy, delivery:arr, pnr:this.pnrEnd};
      for (const st of s.stages){ const a=base*st.p/100; if (!(a>0)) continue;
        const nmS=st.name || (st.j===0 && st.ev==='order' ? 'Аванс' : st.last && s.stages.length>1 ? 'Остаток' : 'Оплата');
        rows.push({key:`sp:${s.id}:${st.j}`, auto:this.addD(sd[st.ev], st.off, st.offK), label:`Поставщику: ${nmS.charAt(0).toLowerCase()+nmS.slice(1)} ${dlPctTxt(st.p)}${nm}`, amount:-a, party:'sup', ev:DEAL_SUP_EVENTS[st.ev]+(st.off?` + ${st.off}${dk(st.offK)}`:'')}); }
      const B=s.fxL+s.ins+s.L+s.T+s.brk;
      if (B>0) rows.push({key:'log:'+s.id, auto:s.rdy, label:(s.T?'Перевозка, таможня и сборы':'Перевозка и сборы')+nm, amount:-B, party:'log', ev:'перед отгрузкой'});
      if (s.Lru>0) rows.push({key:'ru:'+s.id, auto:arr, label:'Доставка по России'+nm, amount:-s.Lru, party:'log', ev:'при поставке'}); }
    if (asmC && asmC.cost>0) rows.push({key:'asm', auto:asmC.end, label:`Сборка станции у «${asmC.A.name}»`, amount:-asmC.cost, party:'sup', ev:'после сборки'});
    if (this.Dc>0) rows.push({key:'doc', auto:Rdy, label:'Разработка документации', amount:-this.Dc, party:'oth', ev:'до отгрузки'});
    if (this.M+this.E>0) rows.push({key:'mnt', auto:D, label:'Монтаж, ПНР и прочие расходы', amount:-(this.M+this.E), party:'oth', ev:'при поставке'}); }

  // ---------- этапы оплаты заказчика: последний этап — остаток до 100 %; этап — процентом или суммой в рублях (sum), со своим названием (name)
  customerRows(){ const d=this.d, S=this.S, rows=this.rows, dk=DealCalculator.dk;
    const ev=this.ev={sign:0, ready:this.Rdy, delivery:this.D, pnr:this.pnrEnd};
    const tr=(d.cust&&d.cust.tr&&d.cust.tr.length)?d.cust.tr:[{pct:'',ev:'delivery',off:'30'}];
    let pctSum=0; const trs=this.trs=tr.map((t,k)=>{ const last=k===tr.length-1, bySum=!last && t.mode==='sum';
      let p=null, sum=null;
      if (bySum){ sum=this.num(`cust.tr.${k}.sum`, t.sum, {def:0}); p=S>0?sum/S*100:0; }
      else if (!last) p=this.num(`cust.tr.${k}.pct`, t.pct, {def:0, max:100});
      if (!last) pctSum+=p;
      const off=this.num(`cust.tr.${k}.off`, t.off, {def:0, int:true});
      return {k, p, sum, bySum, name:String(t.name||'').trim(), ev:DEAL_EVENTS[t.ev]?t.ev:'delivery', off, offK:t.offK==='work'?'work':'', last}; });
    const restPct=100-pctSum; if (restPct<-0.0001) this.err['cust.tr']='Сумма этапов больше 100 %';
    trs[trs.length-1].p=Math.max(0,restPct);
    for (const t of trs){ if (!(t.p>0)) continue;
      rows.push({key:'c'+t.k, auto:this.addD(ev[t.ev], t.off, t.offK), label:`${t.name||'Оплата заказчика'} ${dlPctTxt(t.p)} — ${DEAL_EVENTS[t.ev]}${t.off?` + ${t.off}${dk(t.offK)}`:''}`, amount:t.bySum?t.sum:S*t.p/100, inflow:true, post:t.ev==='delivery'||t.ev==='pnr', pct:t.p, stage:t.k, party:'cust', ev:DEAL_EVENTS[t.ev]+(t.off?` + ${t.off}${dk(t.offK)}`:'')}); }
    if (!rows.some(r=>r.inflow)) rows.push({key:'c0', auto:this.D, label:'Оплата заказчика', amount:0, inflow:true, post:true, pct:100}); }

  // ---------- банковские гарантии
  guarantees(){ const d=this.d, S=this.S, trs=this.trs;
    const advSum=this.advSum=trs.filter(t=>t.p>0 && (t.ev==='sign'||t.ev==='ready')).reduce((a,t)=>a+(t.bySum?t.sum:S*t.p/100),0);
    const bgs=this.bgs=(Array.isArray(d.bg)?d.bg:[]).map((g,k)=>{ const P=`bg.${k}`, type=DEAL_BG_TYPES[g.type]?g.type:'adv';
      const base=['adv','pct','sum'].includes(g.base)?g.base:(type==='adv'?'adv':'pct');
      const v=this.num(P+'.v', g.v, {def:base==='adv'?DealValues.n('deal.bgAdvPct', 100):base==='pct'?DealValues.n('deal.bgPct', 10):0, max:base==='sum'?null:100});
      const amount = base==='adv' ? advSum*v/100 : base==='pct' ? S*v/100 : v;
      const daysAuto = type==='adv' ? this.D : type==='perf' ? this.pnrEnd : Math.round(DealValues.n('deal.bgWarrDays', 365));
      const dOwn=this.num(P+'.days', g.days, {int:true}), days=dOwn==null?daysAuto:dOwn;
      const rate=this.num(P+'.rate', g.rate, {def:dealBgRate(), max:100}), min=this.num(P+'.min', g.min, {def:DealValues.n('deal.bgMin', 0)});
      const fee = amount>0 && (rate>0||min>0) ? Math.max(min, amount*rate/100*days/365) : 0;
      return {k, type, base, v, amount, days, daysAuto, daysOwn:dOwn!=null, rate, min, fee}; });
    this.BG=bgs.reduce((a,g)=>a+g.fee,0);
    for (const g of bgs) if (g.fee>0) this.rows.push({key:'bg:'+g.k, auto:0, label:`Банковская гарантия ${DEAL_BG_TYPES[g.type].toLowerCase()} — комиссия банка`, amount:-g.fee, party:'oth', ev:'при подписании договора'});
    if (bgs.some(g=>g.base==='adv') && !(advSum>0)) this.warn.push({t:'Банковская гарантия на возврат аванса: у заказчика нет аванса — укажите аванс в «Оплате заказчика» или сумму гарантии'}); }

  // ---------- день платежа: по срокам или вручную; при заданной дате отсчёта и производственном календаре (kp.workShift) расчётный
  // день переносится на ближайший рабочий (банковский) день, вручную заданный — остаётся, но помечается, если он нерабочий
  days(){ const d=this.d, kp=this.kp, rows=this.rows;
    const dayOf=(key, auto)=>{ const o=d.days&&d.days[key]; const n=dNum(o); if (o!=null && o!=='' && (Number.isNaN(n)||n<0||!Number.isInteger(n))) this.err['days.'+key]='Целое число дней'; return (n!=null && n>=0 && Number.isInteger(n)) ? n : auto; };
    rows.forEach((r,k)=>{ r.day=dayOf(r.key, r.auto); r.manual=r.day!==r.auto; r.ord=k;
      if (kp.workShift){ if (!r.manual){ const w=kp.workShift(r.day); if (w!==r.day){ r.shiftedFrom=r.day; r.day=w; } } else if (kp.isOff && kp.isOff(r.day)) r.offDay=true; } });
    const Tend=this.Tend=Math.max(...rows.filter(r=>r.inflow).map(r=>r.day));
    if (this.Bn>0) rows.push({key:'bonus', auto:Tend, day:Tend, fixed:true, label:'Бонусы и комиссии с продажи', amount:-this.Bn, ord:rows.length});
    if (this.W>0) rows.push({key:'warr', auto:Tend, day:Tend, fixed:true, label:'Резерв на гарантию', amount:-this.W, ord:rows.length}); }

  // ---------- финансирование: простой процент на недостающие деньги по графику до последней оплаты заказчика
  static isX(r){ return String(r.key).startsWith('xc'); }
  finance(){ const rows=this.rows, Tend=this.Tend, i=this.i, isX=DealCalculator.isX, M=DealValues.n('deal.monthDays', 30);
    const tail=r=>isX(r)?2:(r.key==='bonus'||r.key==='warr')?1:0;
    // в один день: сначала деньги заказчика, потом платежи; постоплата (после поставки, после ПНР) — после платежей этого дня
    const inRank=r=>r.inflow ? (r.post?1:-1) : 0;
    rows.sort((a,b)=>a.day-b.day || tail(a)-tail(b) || inRank(a)-inRank(b) || a.ord-b.ord);
    let bal=0, Fsum=0;
    rows.forEach((r,k)=>{ bal+=r.amount; r.balance=bal; const nx=rows[k+1];
      r.days=Math.max(0, Math.min(nx?nx.day:Tend, Tend)-r.day); if (r.day>=Tend) r.days=0;
      r.fin=Math.max(0,-bal)*r.days*i/100/M; Fsum+=r.fin; });
    return Fsum; }
  /** прочие расходы наличными в графике: с оплат заказчика (пропорционально) или после последней оплаты */
  setCash(K){ const rows=this.rows, isX=DealCalculator.isX, xFrom=this.xFrom, xBase=this.xBase, trs=this.trs;
    const t2n=r=>{ const t=trs[r.stage]; return t&&t.name ? ` «${t.name}»` : ''; };
    for (let k=rows.length-1; k>=0; k--) if (isX(rows[k])) rows.splice(k,1);
    if (!(K>0)) return;
    if (xBase>0) xFrom.forEach(r=>rows.push({key:'xc:'+r.key, auto:r.day, day:r.day, fixed:true, label:`Прочие расходы (наличные) — с оплаты ${dlPctTxt(r.pct||0)}${t2n(r)}`, amount:-K*r.amount/xBase, party:'oth', ord:rows.length, from:r.key}));
    else rows.push({key:'xc', auto:this.Tend, day:this.Tend, fixed:true, label:'Прочие расходы (наличные)', amount:-K, party:'oth', ord:rows.length}); }
  /** итоги при заданном НДС к вычету */
  result(VATin){ const R=this.R, S=this.S, xV=this.xV, xMode=this.xMode;
    const Cnet=this.Ccash-VATin, Ctot=Cnet+this.F, Pa=R-Ctot, vb=this.VATs-VATin, tax=Pa>0?Pa*this.taxP/100:0;
    const X = !xV ? 0 : xMode==='sum' ? xV : xMode==='sale' ? R*xV/100 : xMode==='salevat' ? S*xV/100 : Math.max(0, Pa-tax)*xV/100, K=X*this.xG, P=Pa-K;
    return { VATin, Cnet, Ctot, Pa, X, K, P, tax, net:Pa-tax-K, markup: Ctot+K?P/(Ctot+K)*100:null, margin: R?P/R*100:null, vatBal:vb, payable:Math.max(vb,0), excess:Math.max(-vb,0),
      cashAfter: S-this.Ccash-this.F-K-Math.max(vb,0) }; }

  run(){
    this.price(); this.suppliers(); this.assembly(); this.expenses();
    this.supplierRows(); this.customerRows(); this.guarantees(); this.days();
    const xc=this.xc, rows=this.rows, S_=this.S_, sumOf=this.sumOf, warn=this.warn;
    this.xWhen=xc.when==='pay'?'pay':'end'; const xOffSt=xc.off||{};
    this.xFrom=this.xWhen==='pay' ? rows.filter(r=>r.inflow && r.amount>0 && xOffSt[r.stage]!==false) : [];
    this.xBase=this.xFrom.reduce((a,r)=>a+r.amount,0);
    this.F=this.finance();
    const equipSum=sumOf(s=>s.equip), asmCost=this.asmC?this.asmC.cost:0;
    this.Ccash=sumOf(s=>s.cash)+this.M+this.E+this.Dc+this.W+this.Bn+this.BG+asmCost;
    const voSup=sumOf(s=>s.vo), voRuSum=sumOf(s=>s.voRu);
    const unknown=S_.filter(s=>s.vi==null);
    const VATinKnown=this.viSum+voSup+voRuSum+this.Vo+this.inVat(asmCost);      // сборка — услуга в России с НДС
    const viHi=VATinKnown+unknown.reduce((a,s)=>a+s.T,0);
    let lo=this.result(VATinKnown), hi=unknown.length?this.result(viHi):lo, xIt=0;
    // наличные в графике меняют финансирование, финансирование — прибыль и (от чистой прибыли) сумму наличных: до совпадения
    for (let Kg=0; xIt<60; xIt++){ const K=lo.K; if (xIt>0 && Math.abs(K-Kg)<0.0005) break;
      Kg=K; this.setCash(Kg); this.F=this.finance(); lo=this.result(VATinKnown); hi=unknown.length?this.result(viHi):lo; }
    const base=unknown.length?null:lo, xr=lo, S=this.S, F=this.F;
    if (base && Math.abs(base.P-(base.cashAfter+base.excess))>0.01) warn.push({t:'Контрольное равенство не сошлось — сообщите разработчику', bad:true});
    if (xr.K>0 && xr.net<0) warn.push({t:`Прочие расходы наличными (${Math.round(xr.K).toLocaleString('ru-RU')} ₽) больше чистой прибыли сделки — компания в убытке`, bad:true});
    if (!(S>0)) warn.push({t:'Нет цены для заказчика: заполните цены в КП или укажите цену здесь', bad:true});
    if (!equipSum && !this.Lsum && !this.Tsum && !this.M && !this.E && !this.Dc) warn.push({t:'Расходы не указаны: укажите цены закупки в шаге «Закупка»', go:'price'});
    // структура затрат (для итога и Excel)
    const parts=[['Оборудование', equipSum], ['Комиссии за перевод и конвертацию', sumOf(s=>s.fxE+s.fxL)], ['Страхование груза', sumOf(s=>s.ins)],
      ['Логистика до границы', this.Lsum], ['Таможенные платежи', this.Tsum], ['Брокер, СВХ, сертификация', this.brkSum], ['Доставка по России', this.LruSum], ['Сборка станции', asmCost],
      ['Монтаж и ПНР', this.M], ['Разработка документации', this.Dc], ['Банковская гарантия', this.BG], ['Прочие расходы', this.E], ['Бонусы и комиссии с продажи', this.Bn], ['Резерв на гарантию', this.W], ['Финансирование', F],
      ['НДС к вычету (уменьшает затраты)', -(base||lo).VATin]].filter(x=>Math.abs(x[1])>0.004);
    return { asm:this.asmC, bgs:this.bgs, BG:this.BG, advSum:this.advSum, xc:{mode:this.xMode, when:this.xWhen, off:xOffSt, from:this.xFrom.map(r=>r.key), v:this.xV, cost:this.xCost, g:this.xG, on:this.xV>0},
      S, v:this.v, vatFromKp:this.vatFromKp, rate:c=>this.rate(c), rateSrc:this.rateSrc, used:[...this.used].filter(c=>c!=='RUB'), sup:S_, M:this.M, E:this.E, Dc:this.Dc, Vo:this.Vo, W:this.W, Bn:this.Bn,
      warrP:this.warrP, bonusP:this.bonusP, taxP:this.taxP, pnrDays:this.pnrDays, pnrK:this.pnrK, pnrEnd:this.pnrEnd, trs:this.trs, ev:this.ev, i:this.i, moneyAuto:this.moneyAuto,
      rows, F, D:this.D, Rdy:this.Rdy, Tend:this.Tend, R:this.R, VATs:this.VATs, Ccash:this.Ccash, equipSum, Lsum:this.Lsum, LruSum:this.LruSum, brkSum:this.brkSum, Tsum:this.Tsum, voSup, voRuSum, unknown, base, lo, hi, cashBefore:S-this.Ccash-F, parts,
      err:this.err, warn, ok:!Object.keys(this.err).length };
  }

  /** цена с НДС, при которой показатель равен цели (type: margin | markup | profit | net); null — недостижимо.
   *  Неизвестный ввозной НДС — по нижней границе (без вычета): цена с запасом. */
  static solve(kp, d, type, value){
    const f=S=>{ const c=dealCalc(kp, {...d, over:{...d.over, price:String(S)}}), r=c.base||c.lo;
      return type==='margin' ? r.margin : type==='markup' ? r.markup : type==='net' ? r.net : r.P; };
    if (!(Number.isFinite(value))) return null;
    let lo=0, hi=Math.max(1e5, dealCalc(kp,d).Ccash*4);
    for (let k=0; k<40 && !(f(hi)>=value); k++) hi*=2;
    if (!(f(hi)>=value)) return null;
    for (let k=0; k<80; k++){ const m=(lo+hi)/2, fm=f(m); if (fm==null || fm<value) lo=m; else hi=m; }
    return Math.ceil(hi*100)/100;
  }
}

// прежние точки входа
function dealCalc(kp, d){ return new DealCalculator(kp, d).run(); }

function dlPctTxt(p){ return (Math.round(p*100)/100).toString().replace('.',',')+' %'; }

// цена с НДС, при которой показатель равен цели — DealCalculator.solve
function dealSolve(kp, d, type, value){ return DealCalculator.solve(kp, d, type, value); }

if (typeof module!=='undefined') module.exports={DealCalculator, DealValues, dealAddDays, dlDaysTxt, DEAL_BG_TYPES, dealBgRate, DEAL_SUP_EVENTS, dealSupPay, dealCalc, dealBlank, dealNewSupplier, dealUpgrade, dealSolve, customsFee, customsFeeBand, dNum, CUSTOMS_FEES, DEAL_EVENTS, dealCountryPreset};
