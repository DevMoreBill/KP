// Опции и комплектация из ответа ИИ (features/catalog/ai-options.js, 3.222.0): входящее в состав — «включено», цена из КП
// поставщика — закупка без цены продажи (askPrice), без цены — askPrice, РРЦ — цена продажи; базовая комплектация — блок
// описания «Комплектация»; askPrice не попадает в документ заказчика и закупку сделки; выключатель aiOptions.
// Запуск из корня репозитория: node tests/js/ai_options.js — код выхода 0, если всё прошло (tests/test_doc_images.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'catalog', 'ai-options.js'));

let n=0;
const check=(name, fn)=>{ try{ DefRegistry.srv={}; FEAT.vals={}; fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };

function answer(kind){
  return {
    priceKind:kind, price:'250000', cur:'usd',
    complect:['Компрессорный блок', 'Комплект документации'],
    options:[
      {name:'Встроенный осушитель', qty:1, unit:'шт.', price:'', included:true},
      {name:'Шеф-монтаж', qty:1, unit:'усл.', price:'45000', cur:'RUB'},
      {name:'Комплект ЗИП', qty:'2', price:'', included:false},
      {name:'Шеф-монтаж', qty:1, price:'1'},
      {name:''},
    ],
  };
}
function item(){ return {id:'a', name:'Компрессор', qty:1, price:0, cost:0, options:[], features:[{id:'f1', label:'Комплектация', text:'— Компрессорный блок'}]}; }
function kp(){ KpState.replace({items:[], pricing:{cur:'RUB'}}); }

check('РРЦ: цена — продажа, входящее — «включено», без цены — askPrice, повторы — нет', ()=>{
  kp();
  const it=item();
  const done=AiOptions.apply(it, answer('rrc'));
  assert.deepStrictEqual(done, {options:3, complect:1, kind:'rrc'});
  assert.deepStrictEqual(it.options.map(o=>[o.name, o.qty, o.price, !!o.askPrice, o.cost]), [
    ['Встроенный осушитель', 1, 0, false, undefined],
    ['Шеф-монтаж', 1, 45000, false, undefined],
    ['Комплект ЗИП', 2, 0, true, undefined],
  ]);
  assert.strictEqual(it.features[0].text, '— Компрессорный блок\n— Комплект документации', 'дописана недостающая строка');
  assert.strictEqual(it.cost, 0, 'РРЦ — закупку позиции не трогаем');
});

check('КП поставщика: цены — закупка, продажи нет; закупка позиции — если пустая', ()=>{
  kp();
  const it=item();
  const done=AiOptions.apply(it, answer('cost'));
  assert.strictEqual(done.kind, 'cost');
  const mount=it.options[1];
  assert.deepStrictEqual([mount.price, mount.cost, mount.costCur, mount.askPrice], [0, 45000, 'RUB', true]);
  assert.deepStrictEqual([it.cost, it.costCur], [250000, 'USD']);
  const filled={...item(), cost:10};
  AiOptions.apply(filled, answer('cost'));
  assert.strictEqual(filled.cost, 10, 'заполненную закупку не меняем');
});

check('выбор менеджера сильнее мнения ИИ', ()=>{
  kp();
  const it={...item(), _aiPrices:'cost'};
  assert.strictEqual(AiOptions.apply(it, answer('rrc')).kind, 'cost');
  assert.strictEqual(it.options[1].cost, 45000);
});

check('цена в другой валюте: без пересчёта опций — askPrice, с ним — своя валюта', ()=>{
  kp();
  const usd={options:[{name:'Фильтр', qty:1, price:'100', cur:'USD'}]};
  FEAT.vals={optSaleCur:false};
  const off=item(); AiOptions.apply(off, usd);
  assert.deepStrictEqual([off.options[0].price, off.options[0].askPrice], [0, true]);
  FEAT.vals={};
  const on=item(); AiOptions.apply(on, usd);
  assert.strictEqual(on.options[0].saleCur, 'USD');
  assert.ok(!on.options[0].askPrice);
});

check('станция и выключатель — ничего', ()=>{
  FEAT.vals={aiOptions:false};
  const it=item();
  assert.deepStrictEqual(AiOptions.apply(it, answer('rrc')), {options:0, complect:0, kind:''});
  assert.strictEqual(it.options.length, 0);
  assert.strictEqual(AiOptions.json({}), '');
  FEAT.vals={};
  assert.strictEqual(AiOptions.json({station:true}), '');
  assert.ok(AiOptions.json({}).includes('"options"'));
});

check('askPrice — не в документе заказчика и не в закупке сделки, предупреждение', ()=>{
  const it={id:'a', name:'Компрессор', qty:1, price:100, cost:50, costCur:'RUB', attrs:{cat:'comp_screw'}, options:[
    {id:'o1', name:'Шеф-монтаж', qty:1, price:0, cost:45000, costCur:'RUB', askPrice:true},
    {id:'o2', name:'Фильтр', qty:1, price:500, cost:100, costCur:'RUB'},
  ]};
  KpState.replace({items:[it], pricing:{cur:'RUB'}});
  assert.deepStrictEqual(KpDocx._item(it).options.map(o=>o.name), ['Фильтр']);
  assert.deepStrictEqual(KitDoc.lines({items:[it]}).map(l=>l.id), ['a', 'a~opt~o2']);
  assert.ok(PriceGuard._noSale().some(text=>text.includes('Шеф-монтаж')));
});

if (!process.exitCode) console.log(`ai_options: ${n} проверок — ок`);
