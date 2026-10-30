// Слепок расчёта экономики сделки (app/web/js/features/deal/): 18 типовых сделок — поставщик в России, Китай и
// Европа с растаможкой по позициям, ЕАЭС, растаможка суммой, два поставщика, сборка станции, расходы, наличные, банковские
// гарантии, своя цена и НДС, ошибки ввода, подбор цены под цель. Все итоговые величины, график платежей и структура затрат
// сверяются с tests/js/deal_golden.json — любое изменение расчёта (хоть на копейку) видно сразу. Расчёт поменяли
// намеренно (новая норма, исправление) — пересоздать слепок: node tests/js/deal_golden.js --update и показать разницу в git.
// Запуск из корня репозитория: node tests/js/deal_golden.js — код выхода 0, если совпало (tests/test_deal_logistics.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), SNAP=path.join(__dirname, 'deal_golden.json');
const WebScripts=require('./web.js');
global.document={ addEventListener(){} };
WebScripts.load(path.join(ROOT, 'app', 'web', 'js', 'features', 'deal', 'index.js'));

class Golden {
  static KP(o={}){ return {sumRub:1220000, vat:22, rates:{USD:'92,5', EUR:'100', CNY:'12,8'}, moneyAuto:2, date:'2026-10-19',
    items:[{id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB', duty:5, code:'8414805900'}], ...o}; }
  static sup(o={}){ return {...DealTerms.newSupplier('s1', {country:'Россия'}), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40',
    pay:[{name:'Оплата', ev:'ready', off:'0'}], ...o}; }
  static deal(o={}){ const d=DealTerms.blank({}); d.sup=[this.sup(o.sup)]; d.cust={tr:[{pct:'', ev:'delivery', off:'30'}]}; d.tax='25';
    const {sup:_s, ...rest}=o; return Object.assign(d, rest); }
  static china(o={}){ return this.sup({country:'Китай', cusMode:'calc', vatIn:false, log:{v:'30000', cur:'CNY'}, ins:'0,3', fx:'1', brk:{v:'45000'},
    logRu:{v:'180000'}, pay:[{name:'Аванс', pct:'30', ev:'order', off:'0'}, {name:'Остаток', ev:'ready', off:'0'}], ...o}); }

  static cases(){
    const K=this.KP.bind(this), D=this.deal.bind(this);
    const cn=K({items:[{id:'a', name:'Винтовой компрессор', qty:2, cost:28000, cur:'CNY', duty:0, code:'8414805900'},
      {id:'b', name:'Осушитель', qty:1, cost:9500, cur:'CNY', duty:5, code:'8421390090'}]});
    return [
      ['Россия: оплата перед отгрузкой, заказчик через 30 дней', K(), D()],
      ['Россия: аванс заказчика 50 %', K(), D({cust:{tr:[{pct:'50', ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:'10'}]}})],
      ['Россия: цены закупки без НДС', K({costNoVat:true}), D()],
      ['Китай: растаможка по позициям, страхование, комиссия за перевод', cn, D({sup:this.china()})],
      ['Германия: EUR, пошлина 5 %, брокер и доставка по России', K({items:[{id:'a', name:'Компрессор', qty:1, cost:6000, cur:'EUR', duty:5, code:'8414805900'}]}),
        D({sup:this.sup({country:'Германия', cusMode:'calc', vatIn:false, log:{v:'2500', cur:'EUR'}, brk:{v:'35000'}, logRu:{v:'60000'}})})],
      ['Беларусь (ЕАЭС): только НДС при ввозе', K(), D({sup:this.sup({country:'Беларусь', cusMode:'eaeu', vatIn:false})})],
      ['Растаможка суммой с НДС к вычету', K({items:[{id:'a', name:'Компрессор', qty:1, cost:5000, cur:'USD'}]}),
        D({sup:this.sup({country:'Турция', cusMode:'sum', vatIn:false, cus:{v:'150000', cur:'RUB'}, vi:'110000'})})],
      ['Два поставщика: Россия и Китай', K({items:[{id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB'}, {id:'b', name:'Осушитель', qty:1, cost:9500, cur:'CNY', duty:5, code:'8421390090'}]}),
        (()=>{ const d=D(); d.sup.push({...this.china({log:{v:'5000', cur:'CNY'}}), id:'s2'}); d.map={b:'s2'}; return d; })()],
      ['Расходы: монтаж, ПНР, документация, прочее, гарантия, бонус', K(), D({mnt:'80000', pnr:'10', doc:'45000', oth:'20000', warr:'2', bonus:'3', vo:'15000'})],
      ['Своя цена и КП без НДС', K(), D({over:{price:'1500000', vat:'0'}})],
      ['Наличные: % от чистой прибыли, с оплаты', K(), D({cust:{tr:[{pct:'30', ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:'15'}]}, xc:{mode:'net', v:'10', when:'pay', cost:'12'}})],
      ['Наличные: сумма после последней оплаты', K(), D({xc:{mode:'sum', v:'50000', cost:'10'}})],
      ['Банковские гарантии: аванс, исполнение, гарантийные', K(), D({cust:{tr:[{pct:'30', ev:'sign', off:'0'}, {pct:'', ev:'delivery', off:'30'}]},
        bg:[{type:'adv'}, {type:'perf', rate:'2,5'}, {type:'warr', v:'5', days:'730', min:'5000'}]})],
      ['Сборка станции у производителя контейнера', K({items:[{id:'c', name:'Контейнер', qty:1, cost:900000, cur:'RUB', kit:true, role:'container'},
        {id:'a', name:'Компрессор', qty:1, cost:28000, cur:'CNY', duty:0, kit:true, code:'8414805900'}], sumRub:2400000}),
        (()=>{ const d=D(); d.sup.push({...this.china(), id:'s2'}); d.map={a:'s2'}; d.asm={on:true, sup:'s1', days:'14', cost:{v:'120000'}}; return d; })()],
      ['Ошибки ввода: отрицательное, буквы, этапы больше 100 %', K(), D({mnt:'-5', oth:'сто', cust:{tr:[{pct:'70', ev:'sign', off:'0'}, {pct:'40', ev:'ready', off:'0'}, {pct:'', ev:'delivery', off:'0'}]}})],
      // налогообложение продавца («Наши реквизиты» → «НДС продавца»): УСН с НДС 5–7 % и «без НДС» — без вычета (НК РФ, ст. 170, п. 2)
      ['Продавец на УСН с НДС 5 %: входной НДС без вычета — в себестоимости', K({sumRub:1050000, vat:5, sellerVat:'5', items:[{id:'a', name:'Компрессор', qty:1, cost:610000, cur:'RUB'}]}), D()],
      ['Продавец — экспорт 0 %: вычет НДС поставщика, к возмещению', K({sumRub:1000000, vat:0, sellerVat:'0'}), D()],
      ['Продавец без НДС, а в КП НДС 22 % — предупреждение', K({sellerVat:'без НДС'}), D()],
      ['Продавец на УСН «доходы» с НДС 5 %: налог 6 % с выручки без НДС', K({sumRub:1050000, vat:5, sellerVat:'5', sellerUsn:'income', items:[{id:'a', name:'Компрессор', qty:1, cost:610000, cur:'RUB'}]}), D()],
      ['Продавец на УСН «доходы минус расходы» 10 % (регион), наличные от прибыли', K({sellerVat:'22', sellerUsn:'profit', sellerUsnRate:'10'}), D({xc:{mode:'net', v:'10', cost:'12'}})],
    ];
  }

  static r(v){ return typeof v==='number' && Number.isFinite(v) ? Math.round(v*100)/100 : v; }
  static res(x){ if (!x) return null; const o={};
    for (const k of ['VATin', 'Cnet', 'Ctot', 'Pa', 'X', 'K', 'P', 'tax', 'net', 'markup', 'margin', 'vatBal', 'payable', 'excess', 'cashAfter']) o[k]=this.r(x[k]);
    return o; }
  static shot(kp, d){
    const c=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
    const top={}; for (const k of ['S', 'R', 'VATs', 'Ccash', 'F', 'equipSum', 'Lsum', 'LruSum', 'brkSum', 'Tsum', 'voSup', 'voRuSum', 'M', 'E', 'Dc', 'W', 'Bn', 'BG', 'advSum', 'D', 'Rdy', 'Tend', 'cashBefore'])
      top[k]=this.r(c[k]);
    return { top, base:this.res(c.base), lo:this.res(c.lo), hi:this.res(c.hi),
      sup:c.sup.map(s=>({id:s.id, mode:s.mode, equip:this.r(s.equip), L:this.r(s.L), T:this.r(s.T), cv:this.r(s.cv), dutyA:this.r(s.dutyA), fee:this.r(s.fee),
        ivatA:this.r(s.ivatA), vi:this.r(s.vi), vo:this.r(s.vo), ins:this.r(s.ins), fxE:this.r(s.fxE), fxL:this.r(s.fxL), cash:this.r(s.cash), rdy:s.rdy, arr:s.arr})),
      rows:c.rows.map(r=>[r.key, r.day, this.r(r.amount), this.r(r.balance), this.r(r.fin)]),
      parts:c.parts.map(([n, v])=>[n, this.r(v)]), bgs:(c.bgs||[]).map(g=>[g.type, this.r(g.amount), g.days, this.r(g.fee)]),
      err:Object.keys(c.err).sort(), warn:c.warn.map(w=>w.t) };
  }
  static all(){
    const out={};
    for (const [name, kp, d] of this.cases()) out[name]=this.shot(kp, d);
    const [, kp, d]=this.cases()[0];
    out['Подбор цены под цель']={ margin20:this.r(DealCalculator.solve(kp, d, 'margin', 20)), markup30:this.r(DealCalculator.solve(kp, d, 'markup', 30)),
      profit300k:this.r(DealCalculator.solve(kp, d, 'profit', 300000)), net200k:this.r(DealCalculator.solve(kp, d, 'net', 200000)) };
    out['Таможенный сбор по шкале']=[1, 200000, 200000.01, 450000, 1200001, 2700000, 4200001, 5500000, 10000000, 10000001].map(v=>[v, DealValues.fee(v)]);
    return out;
  }
}

const now=Golden.all();
if (process.argv.includes('--update')){
  fs.writeFileSync(SNAP, JSON.stringify(now, null, 1)+'\n'); console.log('слепок обновлён: '+Object.keys(now).length+' сделок'); process.exit(0); }
const was=JSON.parse(fs.readFileSync(SNAP, 'utf8'));
let bad=0;
for (const k of new Set([...Object.keys(was), ...Object.keys(now)])){
  try{ assert.deepStrictEqual(now[k], was[k]); }
  catch(e){ bad++; console.error('РАСЧЁТ ИЗМЕНИЛСЯ — '+k+':\n'+String(e.message).split('\n').slice(0, 40).join('\n')); }
}
// контроль самого расчёта (не только слепка): равенство «прибыль = деньги после сделки + переплата НДС» во всех сделках без ошибок
for (const [name, kp, d] of Golden.cases()){ const c=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d))), b=c.base;
  if (b && c.ok && Math.abs(b.P-(b.cashAfter+b.excess))>0.01){ bad++; console.error('НЕ СХОДИТСЯ — '+name); } }
// пример отчёта аудита (CALC-015): КП с НДС 5 % на 1 050 000 ₽, закупка 610 000 ₽ с НДС 22 % — себестоимость с НДС поставщика,
// НДС к уплате 50 000 ₽; при ОСНО тот же расчёт вычитает 110 000 ₽
{ const kp=Golden.KP({sumRub:1050000, vat:5, items:[{id:'a', name:'Компрессор', qty:1, cost:610000, cur:'RUB'}]}), d=Golden.deal();
  const usn=DealCalculator.calc({ ...kp, sellerVat:'5' }, JSON.parse(JSON.stringify(d))).base, osno=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d))).base;
  const near=(a, b)=>Math.abs(a-b)<0.01;
  if (!(usn.VATin===0 && near(usn.payable, 50000) && near(osno.VATin, 110000) && near(usn.Cnet-osno.Cnet, 110000))){
    bad++; console.error('УСН 5 %: входной НДС не в себестоимости — '+JSON.stringify({ usn, osno })); } }
if (bad) process.exitCode=1; else console.log('экономика сделки: '+Object.keys(now).length+' слепков совпали');
