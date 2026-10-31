// Счёт, спецификация и договор из КП (app/web/js/features/doc/docs-gen.js, doc-data.js, docx-fill.js) и проверка цен перед
// сохранением (features/kp/price-guard.js): строки и итоги, НДС и «без НДС», сумма прописью, метки своего шаблона Word
// (метка, разрезанная Word на куски, {таблица}, незнакомые метки), цена ниже закупки, маржа, старый курс.
// Запуск из корня репозитория: node tests/js/docs_gen.js — код выхода 0, если всё прошло (tests/test_our_docs.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'app', 'web', 'vendor', 'jszip.min.js'), 'utf8'), { filename:'jszip.min.js' });
global.JSZip=JSZip;
const WebScripts=require('./web.js');
const JS=f=>path.join(ROOT, 'app', 'web', 'js', f);
WebScripts.load(JS('features/doc/docs-gen.js'));
const { DocsGen }=require(JS('features/doc/docs-gen.js'));
const { DocData }=require(JS('features/doc/doc-data.js'));
const { DocxFill }=require(JS('features/doc/docx-fill.js'));
const { DocxWriter }=require(JS('features/doc/docx-writer.js'));

const offer={
  number:'125', date:'2026-10-20', client:'ООО «Ромашка»', clientFull:'Общество «Ромашка» & Ко', clientInn:'7701234567', clientKpp:'770101001',
  clientAddr:'г. Москва', clientDir:'Петров П. П.', vat:22, pricing:{ cur:'RUB' }, object:{ address:'Тула, ул. Заводская, 1' },
  conditions:[{ label:'Срок поставки', value:'20 рабочих дней' }, { label:'Условия оплаты', value:'100 % предоплата' }, { label:'Гарантия', value:'' }],
  items:[
    { name:'Компрессор <ВК-10>', qty:2, price:100000000, disc:{ type:'pct', v:10 }, options:[{ name:'Фильтр', qty:1, price:500000 }, { name:'Пусто', qty:0, price:1 }] },
    { name:'Ресивер', qty:1, price:2000000 },
  ],
};
const firm={ id:'main', name:'ООО «Пример»', inn:'7700000001', kpp:'770001001', bank:'Банк', bik:'044525000', account:'40702810000000000001',
  corr:'30101810400000000225', director:'Иванов И. И.', vat:'' };

let n=0;
const tasks=[];
const check=(name, fn)=>tasks.push(async ()=>{ try{ await fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } });
const text=async blob=>{ const zip=await JSZip.loadAsync(blob.arrayBuffer ? await blob.arrayBuffer() : blob); return zip.file('word/document.xml').async('string'); };

check('строки и итоги', ()=>{
  const data=new DocData(offer, firm);
  const rows=data.rows();
  assert.deepStrictEqual(rows.map(r=>[r.name, r.qty, r.price, r.sum]), [
    ['Компрессор <ВК-10>', 2, 90000000, 180000000], ['Фильтр', 1, 500000, 500000], ['Ресивер', 1, 2000000, 2000000]]);
  const total=data.totals();
  assert.strictEqual(total.sum, 182500000);
  assert.strictEqual(total.vat, Math.round(182500000*22/122));
  assert.strictEqual(data.vatLine(), `В том числе НДС 22 %: ${KPGen.money(total.vat)} руб.`);
  const free=new DocData(offer, { ...firm, vat:'без НДС' });
  assert.strictEqual(free.totals().vat, 0);
  assert.strictEqual(free.vatLine(), 'Без налога (НДС)');
});

check('опции — как в КП: «нет цены — не в КП» не печатаются, единица — своя (было: строкой 0,00 и «шт.»)', ()=>{
  const withOpts={ ...offer, items:[{ name:'Компрессор', qty:1, price:100000000, options:[
    { name:'Шеф-монтаж', qty:1, price:3000000, unit:'усл.' }, { name:'Доставка', qty:1, price:0, askPrice:true }, { name:'  ', qty:1, price:1 }] }] };
  const rows=new DocData(withOpts, firm).rows();
  assert.deepStrictEqual(rows.map(r=>[r.name, r.qty, r.unit, r.sum]), [['Компрессор', 1, 'шт.', 100000000], ['Шеф-монтаж', 1, 'усл.', 3000000]]);
});

check('метки договора', ()=>{
  const tags=new DocData(offer, firm).tags({ number:'7', date:'2026-10-23' });
  assert.strictEqual(tags['покупатель_инн'], '7701234567');
  assert.strictEqual(tags['продавец_бик'], '044525000');
  assert.strictEqual(tags['сумма'], `${KPGen.money(182500000)} руб.`);
  assert.ok(tags['сумма_прописью'].startsWith('один миллион восемьсот двадцать пять тысяч рублей 00 копеек'), tags['сумма_прописью']);
  assert.strictEqual(tags['срок_поставки'], '20 рабочих дней');
  assert.strictEqual(tags['условия'], 'Срок поставки: 20 рабочих дней\nУсловия оплаты: 100 % предоплата');
  assert.strictEqual(tags['дата'], '23 октября 2026 г.');
});

check('счёт и спецификация — документ Word', async ()=>{
  const data=new DocData(offer, firm);
  for (const make of ['invoice', 'spec']){
    const writer=new DocxWriter();
    DocsGen[make](writer, data, { number:'7', date:'2026-10-23' });
    const xml=await text(await writer.pack('nodebuffer'));
    assert.ok(xml.includes('Компрессор &lt;ВК-10&gt;'), 'текст экранирован');
    assert.ok(xml.includes('Общество «Ромашка» &amp; Ко'));
    assert.ok(xml.includes(KPGen.money(180000000)), 'сумма позиции со скидкой');
    assert.ok(xml.includes('Один миллион восемьсот двадцать пять тысяч рублей 00 копеек'), make);
  }
  const writer=new DocxWriter();
  DocsGen.invoice(writer, data, { number:'7', date:'2026-10-23' });
  const xml=await text(await writer.pack('nodebuffer'));
  assert.ok(xml.includes('Счёт на оплату № 7 от 23 октября 2026 г.'));
  assert.ok(xml.includes('40702810000000000001') && xml.includes('044525000'));
});

check('свой шаблон Word', async ()=>{
  const tpl=new DocxWriter();
  tpl.para([['Покупатель: {покуп', {}], ['атель}', { b:true }], [', ИНН {покупатель_инн}', {}]]);
  tpl.para('{таблица}');
  tpl.para('Итого {сумма} — {неизвестная}');
  tpl.table([1, 1], null, [['{продавец}', '{дата}']]);
  const data=new DocData(offer, firm);
  const goods=DocsGen._goods(new DocxWriter(), data, { frame:'lines' }).body.join('');
  const { blob, missing }=await DocxFill.fill(await tpl.pack('nodebuffer'), data.tags({ number:'7', date:'2026-10-23' }), goods);
  const xml=await text(blob);
  assert.ok(xml.includes('Покупатель: ООО «Ромашка», ИНН 7701234567'), 'метка из двух кусков склеена');
  assert.ok(!xml.includes('{таблица}') && xml.includes('<w:tblBorders>') && xml.includes('Ресивер'), 'таблица товаров с рамками');
  assert.ok(xml.includes('ООО «Пример»') && xml.includes('23 октября 2026 г.'), 'метки в ячейке таблицы');
  assert.deepStrictEqual(missing, ['неизвестная']);
  assert.ok(xml.includes('{неизвестная}'));
});

check('проверка цен перед сохранением', ()=>{
  const { PriceGuard }=require(JS('features/kp/price-guard.js'));
  const { PriceHist }=require(JS('features/kp/price-hints.js'));
  const state=require(JS('core/state.js'));
  const { KpState }=state;
  const { DealLink }=require(JS('core/deal-link.js'));
  KpState.replace(Object.assign(KpState.fresh(), { items:[{ name:'Дешёвый', qty:1, price:900 }, { name:'Нормальный', qty:1, price:2000 }] }));
  PriceHist.doc=item=>({ cost:1000, costCur:'RUB', price:item.price });
  DealLink.summary=()=>({ confirmed:true, margin:8 });
  const pricing=state.S.pricing;
  pricing.cur='USD'; pricing.rates.USD='1'; pricing.rateDate='2020-01-01';
  const found=PriceGuard.problems();
  assert.ok(found.some(t=>t.includes('«Дешёвый» — цена ниже закупки')), found);
  assert.ok(!found.some(t=>t.includes('Нормальный')));
  assert.ok(found.some(t=>t.startsWith('Маржа 8 %')), found);
  assert.ok(found.some(t=>t.startsWith('Курс ЦБ устарел')), found);
  pricing.cur='RUB'; DealLink.summary=()=>null; PriceHist.doc=()=>null;
  assert.deepStrictEqual(PriceGuard.problems(), []);
  // цена после скидки позиции ниже закупки; закупка без НДС — с НДС поставщика
  PriceHist.doc=()=>({ cost:90000, costCur:'RUB' });
  KpState.replace(Object.assign(KpState.fresh(), { items:[{ name:'Скидка', qty:1, price:100000, disc:{ type:'pct', v:15 } }] }));
  const discounted=PriceGuard.problems();
  KpState.replace(Object.assign(KpState.fresh(), { items:[{ name:'Без НДС', qty:1, price:100000 }] }));
  state.S.pricing.costNoVat=true;
  assert.ok(PriceGuard.problems().some(t=>t.includes('«Без НДС» — цена ниже закупки')), 'закупка 90 000 без НДС = 109 800');
  state.S.pricing.costNoVat=false;
  assert.deepStrictEqual(PriceGuard.problems(), [], 'с НДС 90 000 < 100 000');
  assert.ok(discounted.some(t=>t.includes('«Скидка»')), JSON.stringify(discounted));
  // экономику не открывали — маржа по закупке позиций
  KpState.replace(Object.assign(KpState.fresh(), { items:[{ name:'Узкая', qty:1, price:100000, cost:95000 }] }));
  PriceHist.doc=()=>null;
  assert.ok(PriceGuard.problems().some(t=>t.startsWith('Маржа 5 %')), PriceGuard.problems());
  // понедельник утром: курс субботы ещё действует
  const realNow=Date.now;
  Date.now=()=>new Date('2026-10-26T09:00:00').getTime();
  KpState.replace(Object.assign(KpState.fresh(), { items:[] }));
  Object.assign(state.S.pricing, { cur:'USD', rates:{ USD:'90' }, rateDate:'2026-10-24' });
  assert.deepStrictEqual(PriceGuard.problems(), [], 'курс от субботы в понедельник — не устарел');
  state.S.pricing.rateDate='2026-10-22';
  assert.ok(PriceGuard.problems().length, 'курс четверга в понедельник — устарел');
  Date.now=realNow;
});

(async ()=>{
  for (const task of tasks) await task();
  console.log(`документы из КП: ${n} из ${tasks.length}`);
})();
