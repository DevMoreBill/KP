// Закупка опций и услуг (features/kp/option-cost.js, KitDoc.lines): опция с ценой или закупкой — своя строка закупки
// экономики сделки («Позиция: опция»), поставщик по умолчанию — как у позиции (у станции — сборщик), закупка входит
// в себестоимость; выключатель optCost — как раньше (опций в закупке нет).
// Запуск из корня репозитория: node tests/js/option_cost.js — код выхода 0, если всё прошло (tests/test_option_cost.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'deal', 'index.js'));

let n=0;
const check=(name, fn)=>{ try{ DefRegistry.srv={}; FEAT.vals={}; fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };

function kp(){
  return {
    items:[{id:'a', name:'Компрессор', qty:2, price:100000000, cost:50000000, costCur:'RUB', attrs:{cat:'comp_screw', maker:'Завод'},
      options:[
        {id:'o1', name:'Шеф-монтаж', qty:1, unit:'усл.', price:5000000, cost:3000000, costCur:'RUB'},
        {id:'o2', name:'Фильтр', qty:2, price:400000, cost:0},
        {id:'o3', name:'Включено', qty:1, price:0},
        {id:'o4', name:'Комплект ЗИП', qty:1, price:0, cost:10000, costCur:'USD'},
      ]}],
  };
}
function deal(){
  const d=DealTerms.blank({});
  Object.assign(d.sup[0], {name:'Завод', country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40', pay:[{name:'Оплата', ev:'ready', off:'0'}]});
  d.sup.push({...DealTerms.newSupplier('s2', {}), name:'Монтажники', country:'Россия', cusMode:'none', vatIn:true, prod:'10', ship:'0', pay:[{name:'Оплата', ev:'ready', off:'0'}]});
  d.cust={tr:[{pct:'', ev:'delivery', off:'30'}]}; d.tax='25';
  return d;
}

check('опции с ценой или закупкой — свои строки закупки', ()=>{
  const lines=KitDoc.lines(kp());
  assert.deepStrictEqual(lines.map(l=>[l.id, l.name, l.qty, l.cost, l.costCur]), [
    ['a', 'Компрессор', 2, 50000000, 'RUB'],
    ['a~opt~o1', 'Шеф-монтаж', 1, 3000000, 'RUB'],
    ['a~opt~o2', 'Фильтр', 2, 0, 'RUB'],
    ['a~opt~o4', 'Комплект ЗИП', 1, 10000, 'USD'],
  ]);
  assert.strictEqual(lines[1].of, 'Компрессор');
});

check('выключено — опций в закупке нет', ()=>{
  FEAT.vals={optCost:false};
  assert.deepStrictEqual(KitDoc.lines(kp()).map(l=>l.id), ['a']);
  assert.deepStrictEqual(OptionCost.currencies(kp().items), []);
});

check('поставщик опции — как у позиции, можно сменить', ()=>{
  const state=kp(); KpState.replace(state); S.deal=deal(); S.deal.map={a:'s2'};
  assert.strictEqual(DealSuppliers.of('a~opt~o1'), 's2', 'как у позиции');
  S.deal.map['a~opt~o1']=S.deal.sup[0].id;
  assert.strictEqual(DealSuppliers.of('a~opt~o1'), S.deal.sup[0].id, 'своя привязка');
});

check('закупка опции — в себестоимости, валюта — по курсу', ()=>{
  const base={sumRub:2500000, vat:22, rates:{USD:'90'}, moneyAuto:2};
  const row=(id, name, qty, cost, cur)=>({id, name, qty, cost, cur});
  const plain=DealCalculator.calc({...base, items:[row('a', 'Компрессор', 2, 500000, 'RUB')]}, deal());
  const withOpt=DealCalculator.calc({...base, items:[row('a', 'Компрессор', 2, 500000, 'RUB'), row('a~opt~o1', 'Шеф-монтаж', 1, 30000, 'RUB'),
    row('a~opt~o4', 'ЗИП', 1, 100, 'USD')]}, deal());
  const equip=c=>c.sup.reduce((sum, sup)=>sum+sup.equip, 0);
  assert.ok(Math.abs(equip(withOpt)-equip(plain)-(30000+100*90))<0.01, `закупка: ${equip(withOpt)} − ${equip(plain)}`);
  assert.ok((withOpt.base||withOpt.lo).P < (plain.base||plain.lo).P, 'прибыль меньше на закупку опций');
});

check('строки экономики из КП: «Позиция: опция», закупка в рублях за единицу', ()=>{
  KpState.replace(kp()); S.deal=deal();
  const items=DealState.kpInputs(S).items;
  const opt=items.find(it=>it.id==='a~opt~o1');
  assert.strictEqual(opt.name, 'Компрессор — доп.: Шеф-монтаж');
  assert.strictEqual(opt.cost, 30000);
  assert.strictEqual(opt.kit, false);
});

check('маржа КП (журнал, проверка цен): закупка и продажа опций с закупкой', ()=>{
  const state={...kp(), pricing:{cur:'RUB', rates:{USD:'90'}}, vat:22};
  const econ=KpEconomics.of(state);
  // позиция: 2 × (1 000 000 − 500 000); шеф-монтаж: 50 000 − 30 000; ЗИП: 0 − 100 USD × 90; фильтр без закупки — не входит
  assert.strictEqual(econ.cost/100, 2*500000+30000+9000);
  assert.strictEqual(econ.sale/100, 2*1000000+50000);
  FEAT.vals={optCost:false};
  assert.strictEqual(KpEconomics.of(state).cost/100, 2*500000, 'выключено — как раньше');
});

if (!process.exitCode) console.log(`option_cost: ${n} проверок — OK`);
