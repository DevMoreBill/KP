// Каталог 3.199.0 (features/catalog/price-age.js, catalog-analogs.js, features/kp/kp-lead.js, features/wizard/station-library.js):
// возраст цены и «цена устарела», аналоги других производителей в допуске, срок поставки в условия КП (своё, по поставщику,
// в наличии — нет, вписанное вручную не меняется), типовые станции.
// Запуск из корня репозитория: node tests/js/catalog_extras.js — код выхода 0, если всё прошло (tests/test_catalog_extras.py).
'use strict';
const path=require('path'), assert=require('assert');
const WebScripts=require('./web.js');
const JS=f=>path.join(__dirname, '..', '..', 'app', 'web', 'js', f);
WebScripts.load(JS('features/catalog/price-age.js'));
const { PriceAge }=require(JS('features/catalog/price-age.js'));
const { CatalogAnalogs }=require(JS('features/catalog/catalog-analogs.js'));
const { Catalog }=require(JS('features/catalog/catalog-store.js'));
const { Suppliers }=require(JS('features/catalog/suppliers.js'));
const { KpLead }=require(JS('features/kp/kp-lead.js'));
const { StationLibrary }=require(JS('features/wizard/station-library.js'));
const { EquipTypes }=require(JS('core/equip-types.js'));
const { Attrs }=require(JS('core/item-attrs.js'));
const state=require(JS('core/state.js'));

let n=0;
const tasks=[];
const check=(name, fn)=>tasks.push(async ()=>{ try{ await fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } });
const DAY=86400000, ago=d=>new Date(Date.now()-d*DAY).toISOString();

EquipTypes.byId=()=>({ id:'comp', name:'Компрессоры', fields:[{ key:'power', kpi:true }, { key:'pressure', kpi:true }, { key:'note' }] });
Attrs.of=card=>card.attrs || {};

check('возраст цены', ()=>{
  assert.strictEqual(PriceAge.days({ price:100, priceAt:ago(10) }), 10);
  assert.strictEqual(PriceAge.days({ price:0, priceAt:ago(10) }), null, 'без цены — нет возраста');
  assert.strictEqual(PriceAge.days({ price:1, updatedAt:ago(200) }), 200, 'без даты цены — по дате правки');
  assert.strictEqual(PriceAge.days({ price:1, priceAt:ago(200), rrc:{ at:ago(3) } }), 3, 'цена по РРЦ подтверждена фидом');
  assert.strictEqual(PriceAge.days({ price:1, priceAt:ago(200), priceSrc:'manual', rrc:{ at:ago(3) } }), 200, 'своя цена — фид не подтверждает');
  assert.ok(PriceAge.stale({ price:1, priceAt:ago(91) }));
  assert.ok(!PriceAge.stale({ price:1, priceAt:ago(89) }));
  assert.match(PriceAge.note({ price:1, priceAt:ago(120) }), /не обновлялась 120 дн\./);
});

check('аналоги других производителей', ()=>{
  const card=(id, maker, power, pressure, extra={})=>({ id, name:id, price:1, attrs:{ cat:'comp', maker, power:String(power), pressure:String(pressure) }, ...extra });
  const base=card('base', 'Atlas', 37, 8);
  Catalog.cache=[base, card('same-maker', 'Atlas', 37, 8), card('close', 'Dali', 37, 8.5), card('far', 'Remeza', 55, 8),
    card('instock', 'Kraft', 40, 8, { stock:{ qty:3 } }), card('nopress', 'Fubag', 37, 0), card('other-cat', 'Comp', 37, 8, { attrs:{ cat:'pump', maker:'X', power:'37', pressure:'8' } })];
  const ids=CatalogAnalogs.of(base).map(c=>c.id);
  assert.deepStrictEqual(ids, ['instock', 'close'], 'в наличии — первыми; свой производитель, далёкие, без параметра и другая категория — нет');
  assert.deepStrictEqual(CatalogAnalogs.of({ id:'z', attrs:{ cat:'comp', power:'37' } }), [], 'без производителя — нет');
});

check('аналоги: чистота газа — разницей, не долей', ()=>{
  const byId=EquipTypes.byId;
  EquipTypes.byId=()=>({ id:'gen', fields:[{ key:'flow', kpi:true }, { key:'purity', kpi:true, unit:'%' }] });
  const card=(id, maker, flow, purity)=>({ id, name:id, price:1, attrs:{ cat:'gen', maker, flow:String(flow), purity:String(purity) } });
  const base=card('base', 'Atlas', '7,5', '99,5');
  Catalog.cache=[base, card('near', 'Dali', '7,8', '99,9'), card('low', 'Kraft', 7.5, 95), card('big', 'Fubag', '1 000', 99.5)];
  assert.deepStrictEqual(CatalogAnalogs.of(base).map(c=>c.id), ['near'], '95 % к 99,5 % — не аналог; «1 000» — не 1');
  EquipTypes.byId=byId;
});

check('срок поставки в условия', async ()=>{
  const { KpState }=state;
  KpState.replace(Object.assign(KpState.fresh(), { items:[{ name:'А' }, { name:'Б' }], conditions:[{ label:'Срок поставки', value:'' }] }));
  Suppliers.sups=[{ name:'Поставщик', makers:['Dali'], prod:20, ship:10 }];
  const own={ attrs:{ maker:'Atlas' }, lead:'под заказ 6–8 недель' };
  assert.strictEqual(KpLead.of(own), 'под заказ 6–8 недель');
  assert.strictEqual(KpLead.of({ attrs:{ maker:'Dali' } }), 'под заказ, 30 рабочих дней', 'по поставщику: изготовление + доставка');
  assert.strictEqual(KpLead.of({ ...own, stock:{ qty:1 } }), '', 'в наличии — без срока');
  const S=()=>state.S;
  await KpLead.take(S().items[0], own);
  assert.strictEqual(S().conditions[0].value, 'под заказ 6–8 недель');
  await KpLead.take(S().items[1], { attrs:{ maker:'Dali' } });
  assert.strictEqual(S().conditions[0].value, 'А — под заказ 6–8 недель; Б — под заказ, 30 рабочих дней');
  S().conditions[0].value='30 дней';
  await KpLead.take(S().items[1], own);
  assert.strictEqual(S().conditions[0].value, '30 дней', 'вписанное вручную не меняется');
});

check('типовые станции', ()=>{
  assert.deepStrictEqual(StationLibrary.req('comp', 1), { flow:'10', pressure:'8' });
  assert.strictEqual(StationLibrary.req('comp', 99), null);
  assert.match(StationLibrary.html('dgu'), /data-nslib="0"/);
  assert.strictEqual(StationLibrary.html('none'), '');
});

check('окно «Каталог обновлён» — без пути к папкам сервера (аудит FE-010)', ()=>{
  const html=MigrationNotice._html([{id:'x', backup:'C:\\KP\\data\\backup\\kp-20261028-before-migration.zip'}]);
  assert.ok(!html.includes('C:\\KP') && html.includes('kp-20261028-before-migration.zip'), html);
});

(async ()=>{
  for (const task of tasks) await task();
  console.log(`каталог 3.199.0: ${n} из ${tasks.length}`);
})();
