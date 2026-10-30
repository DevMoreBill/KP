// Деньги и документы по отчёту аудита 30.10 (пп. 12–18): договорной курс — «курс расчёта», а не «курс ЦБ РФ на дату»
// (п. 16), сделки без ожидаемой даты — не в прогнозе месяца (п. 17), сумма вкладки КП — один подсчёт с опциями (п. 18),
// налогообложение продавца — вычет НДС в экономике сделки (п. 13), Excel — поправки Битрикс24 в «Расчёте» (п. 14).
// Запуск из корня репозитория: node tests/js/audit_money.js — код выхода 0, если всё прошло (tests/test_audit_money.py).
'use strict';
const path=require('path'), fs=require('fs'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
global.document={ addEventListener(){} };
const web=require('./web.js');
web.load(path.join(JS, 'features', 'crm', 'index.js'));
web.load(path.join(JS, 'features', 'deal', 'index.js'));
require(path.join(JS, 'docx', 'kpgen.js'));
// разделы КП и документа — прямо из своих файлов (их index.js вешает обработчики страницы)
const mod=file=>require(path.join(JS, file));
const { RateSource }=mod('features/kp/rate-source.js');
const { KpDocx }=mod('features/doc/kp-docx.js');
const { KpTabs }=mod('features/kp/kp-tabs.js');
const { KpEconomics }=mod('features/kp/price-calc.js');
const { KpState }=mod('core/state.js');
const { today }=mod('core/util.js');
const { SellerTax }=mod('core/seller-tax.js');
const { IncomeTax }=mod('core/income-tax.js');
const swap=async (pairs, fn)=>{
  const saved=pairs.map(([owner, name])=>[owner, name, owner[name]]);
  for (const [owner, name, value] of pairs) owner[name]=value;
  try { return await fn(); } finally { for (const [owner, name, value] of saved) owner[name]=value; }
};

const checks=[];
const check=(name, fn)=>checks.push([name, fn]);

check('курс: вписан вручную — свой у каждой валюты; «Курс ЦБ» для пустых не делает договорной курсом ЦБ', ()=>{
  const pricing={ cur:'USD', rates:{ USD:'95,0000' }, rateDate:'2026-10-20', rateSrc:'ЦБ РФ (cbr.ru)' };
  assert.strictEqual(RateSource.manual(pricing, 'USD'), false);
  RateSource.mark(pricing, 'USD');
  assert.strictEqual(RateSource.manual(pricing, 'USD'), true);
  RateSource.cbr(pricing, ['EUR', 'CNY'], { date:'2026-10-30', src:'ЦБ РФ (cbr.ru)' });   // fillEmpty: USD не трогали
  assert.strictEqual(RateSource.manual(pricing, 'USD'), true, 'договорной USD — по-прежнему договорной (было: «ЦБ РФ на 30.10»)');
  assert.strictEqual(RateSource.manual(pricing, 'EUR'), false);
  assert.strictEqual(pricing.rateSrc, 'вручную');
  RateSource.cbr(pricing, ['USD'], { date:'2026-10-30', src:'ЦБ РФ (cbr.ru)' });   // кнопка «Курс ЦБ»
  assert.strictEqual(RateSource.manual(pricing, 'USD'), false);
  assert.strictEqual(pricing.rateSrc, 'ЦБ РФ (cbr.ru)');
  assert.strictEqual(RateSource.manual({ rateSrc:'вручную' }, 'USD'), true, 'КП прежних версий: «вручную» — не курс ЦБ');
});

check('документ КП: договорной курс — «Справочно: курс расчёта», без даты ЦБ; курс ЦБ — как было', ()=>{
  const state={ pricing:{ cur:'USD', rates:{ USD:'95' }, rateDate:'2026-10-20', rateSrc:'' }, items:[], vat:22, conditions:[] };
  const cur=st=>swap([[KpState, 'replace', KpState.replace]], ()=>{ KpState.replace(st); return KpDocx.state().cur; });
  return (async ()=>{
    let got=await cur(JSON.parse(JSON.stringify(state)));
    assert.deepStrictEqual([got.own, got.date], [false, '2026-10-20']);
    const own=JSON.parse(JSON.stringify(state)); RateSource.mark(own.pricing, 'USD');
    got=await cur(own);
    assert.deepStrictEqual([got.own, got.date, got.rate], [true, '', 95]);
    for (const tid of ['pnevmotekh', 'tender']) {
      const text=fs.readFileSync(path.join(ROOT, 'templates', tid, 'skeleton.js'), 'utf8');
      const sk=KPGen.loadSkeleton(text);
      assert.ok(/курс расчёта/.test(sk.defaults.texts.currencyRateOwn) && !/ЦБ/.test(sk.defaults.texts.currencyRateOwn), tid);
      assert.ok(text.includes("txt(S.cur.own ? 'currencyRateOwn' : 'currencyRate'"), tid+': текст по источнику курса');
      const tpl=JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.json'), 'utf8'));
      assert.strictEqual(tpl.texts.currencyRateOwn, sk.defaults.texts.currencyRateOwn, tid+': template.json');
    }
  })();
});

check('прогноз месяца, «Ожидаем договоров» и отбор «Ожидаются в этом месяце» — без сделок без ожидаемой даты', ()=>{
  const month=today().slice(0, 7);
  const deals=[{ id:'a', expected:today(), sum:100, stage:'work' }, { id:'b', expected:'', sum:1000, stage:'work' },
    { id:'c', sum:10, stage:'work' }, { id:'d', expected:'2099-01-05', sum:5, stage:'work' }];
  assert.deepStrictEqual(deals.filter(deal=>CrmData.expectedBy(deal, month)).map(deal=>deal.id), ['a']);
  assert.deepStrictEqual(deals.filter(CabDeals.FILTERS.month[1]).map(deal=>deal.id), ['a'], 'отбор списка');
  // прогноз: только «a» — 100 × 0,5 = 50 (было: и «b», «c» без даты — 610)
  return swap([[CrmData, 'openDeals', ()=>deals], [CrmData, 'deals', ()=>deals], [CrmData, 'board', { odds:{ work:0.5 } }],
    [FEAT, 'on', ()=>true]], ()=>{
    const html=CabTodaySide._month();
    assert.ok(/data-kpi="month"><span>Ожидаем договоров<\/span><b>1<\/b>/.test(html), html.slice(0, 400));
    assert.ok(html.includes(`<span>Прогноз месяца</span><b>${CrmFmt.short(50)}</b>`), html.slice(-400));
  });
});

check('вкладка КП: сумма — с платными опциями и у отложенного КП (было: у отложенного — без опций)', ()=>{
  const state={ pricing:{ cur:'RUB', rates:{} }, vat:22, items:[{ qty:1, price:100000, options:[{ name:'Монтаж', qty:1, price:20000 }] }] };
  assert.strictEqual(KpTabs._sum(state), 120000);
  assert.strictEqual(KpTabs._sum(state), KpEconomics.of(state).sum, 'как в журнале');
});

check('Excel экономики, лист «Расчёт»: поправки из Битрикс24 — строками и в формулах «Прямые платежи» и «НДС к вычету» (было: только на «Сводке»)', ()=>{
  const kp={ sumRub:1220000, vat:22, rates:{ USD:'92,5', EUR:'100', CNY:'12,8' }, moneyAuto:2, date:'2026-10-19',
    items:[{ id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB', duty:5, code:'8414805900' }] };
  const deal=DealTerms.blank({});
  deal.sup=[{ ...DealTerms.newSupplier('s1', { country:'Россия' }), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40',
    pay:[{ name:'Оплата', ev:'ready', off:'0' }], logRu:{ v:'60000' } }];
  deal.cust={ tr:[{ pct:'', ev:'delivery', off:'30' }] }; deal.tax='25';
  const build=d=>{
    const calc=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
    const res=calc.base || calc.lo;
    const ctx={ calc, deal:d, kpData:kp, res, unknown:calc.unknown.length>0, kpTitle:'КП' };
    const sheet=new DealXlsxCalc(ctx); sheet.build();
    const graph=new DealXlsxGraph(sheet, DealXlsx.NAMES); graph.head();
    new DealXlsxResult(sheet, graph).build();
    const formula=label=>{ const row=sheet.rows.find(r=>r && r[0]===label); return row && row[1] && row[1].f; };
    return { calc, sheet, formula };
  };
  const plain=build(deal);
  assert.ok(!plain.sheet.bxOn && !plain.sheet.rows.some(r=>r && /Битрикс24/.test(String(r[0]))), 'без поправок — лист прежний');
  const raw=plain.calc.Lsum+plain.calc.LruSum+plain.calc.sup.reduce((sum, sup)=>sum+(sup.ins || 0), 0);
  const fixed=build({ ...deal, bxFix:{ logistics:{ base:raw, to:raw+100000 } } });
  assert.ok(fixed.sheet.bxOn, 'поправка логистики действует');
  const bxf=fixed.sheet.rubRef('BXF'), bxv=fixed.sheet.rubRef('BXV');
  assert.ok(fixed.formula('Прямые платежи').includes(bxf), fixed.formula('Прямые платежи'));
  assert.ok(fixed.formula('НДС к вычету').includes(bxv), fixed.formula('НДС к вычету'));
  const row=key=>fixed.sheet.rows.find(r=>r && r[0] && String(r[0]).startsWith(key));
  const line=fixed.calc.bxFix.find(l=>l.key==='logistics');
  assert.ok(line && line.active && Math.abs(line.delta-100000)<0.01 && line.vat>0, JSON.stringify(fixed.calc.bxFix));
  assert.strictEqual(row('Поправки из Битрикс24 — к прямым платежам')[1].v, line.delta);
  assert.strictEqual(row('Поправки из Битрикс24 — НДС к вычету')[1].v, line.vat);
  // «Прямые платежи» листа = расчёт программы (с поправкой), как на «Сводке»
  const direct=fixed.sheet.rows.find(r=>r && r[0]==='Прямые платежи')[1];
  assert.ok(Math.abs(direct.v-fixed.calc.Ccash)<0.01 && Math.abs(fixed.calc.Ccash-plain.calc.Ccash-100000)<0.01, [direct.v, fixed.calc.Ccash, plain.calc.Ccash].join(' / '));
});

check('продавец сделки (п. 13): основное юрлицо, режим из «НДС продавца»; УСН 5 % — вычета нет и в Excel; выключено — как при ОСНО', ()=>{
  const own={ main:'b', items:[{ id:'a', name:'ООО «Альфа»', vat:'' }, { id:'b', name:'ИП Бета', vat:'5' }] };
  const deal={};
  return swap([[DealSeller, 'own', own], [DealSeller, 'failed', false], [FEAT, 'on', ()=>true]], ()=>{
    DealSeller.sync(deal);
    assert.deepStrictEqual([deal.seller, deal.sellerVat], ['b', '5'], 'по умолчанию — основное юрлицо');
    DealSeller.choose(deal, 'a');
    assert.deepStrictEqual([deal.seller, deal.sellerVat], ['a', ''], 'выбор — своё налогообложение');
    DealSeller.choose(deal, 'b');
    assert.strictEqual(DealSeller.vatOf(deal), '5');
    // не загрузились — выбор в сделке не трогается
    DealSeller.failed=true; DealSeller.choose(deal, 'нет такого'); DealSeller.failed=false;
    assert.deepStrictEqual([deal.seller, deal.sellerVat], ['нет такого', '5']);
    DealSeller.choose(deal, 'b');
    assert.ok(SellerTax.deducts('') && SellerTax.deducts('22') && SellerTax.deducts('0'), 'ОСНО и экспорт — вычет');
    assert.ok(!SellerTax.deducts('5') && !SellerTax.deducts('7') && !SellerTax.deducts('без НДС'), 'УСН 5–7 % и без НДС — нет');
    assert.deepStrictEqual(['', 'без НДС', '7'].map(v=>SellerTax.rate(v)), [null, 0, 7]);
    // Excel: «НДС к вычету» — 0, строка поставщика — «без вычета»
    const kp={ sumRub:1050000, vat:5, rates:{}, moneyAuto:2, date:'2026-10-19', sellerVat:DealSeller.vatOf(deal),
      items:[{ id:'a', name:'Компрессор', qty:1, cost:610000, cur:'RUB' }] };
    const d=DealTerms.blank({});
    d.sup=[{ ...DealTerms.newSupplier('s1', { country:'Россия' }), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40',
      pay:[{ name:'Оплата', ev:'ready', off:'0' }] }];
    d.cust={ tr:[{ pct:'', ev:'delivery', off:'30' }] }; d.tax='25';
    const calc=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
    assert.strictEqual(calc.deduct, false);
    const sheet=new DealXlsxCalc({ calc, deal:d, kpData:kp, res:calc.base, unknown:false, kpTitle:'КП' }); sheet.build();
    const graph=new DealXlsxGraph(sheet, DealXlsx.NAMES); graph.head();
    new DealXlsxResult(sheet, graph).build();
    const vi=sheet.rows.find(r=>r && r[0]==='НДС к вычету');
    assert.ok(vi && vi[1].f==='0' && vi[1].v===0 && /Вычета нет/.test(JSON.stringify(vi)), JSON.stringify(vi));
    assert.ok(sheet.rows.some(r=>r && r[0]==='НДС поставщика (без вычета — в себестоимости)'), 'строка поставщика');
    assert.ok(/Вычета нет — продавец: УСН с НДС 5 %/.test(DealResult.vat(calc, calc.base)), 'окно: «НДС к уплате»');
  }).then(()=>swap([[FEAT, 'on', key=>key!=='sellerTax']], ()=>{
    assert.strictEqual(DealSeller.vatOf(deal), '', 'выключено — как при ОСНО');
    assert.strictEqual(DealMoney._seller(), '', 'строки «Продавец» нет');
  }));
});

check('налог при УСН (3.246.0): объект и ставка — у юрлица; «доходы» — с выручки без НДС, «доходы минус расходы» — с прибыли; поле сделки — только для ОСНО; Excel — та же формула', ()=>{
  const own={ main:'a', items:[{ id:'a', name:'ИП Доход', vat:'5', usn:'income', usnRate:'' }, { id:'b', name:'ООО Расход', vat:'22', usn:'profit', usnRate:'10' },
    { id:'c', name:'ООО Старое', vat:'7' }] };
  const deal={};
  const D=()=>{ const d=DealTerms.blank({});
    d.sup=[{ ...DealTerms.newSupplier('s1', { country:'Россия' }), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40',
      pay:[{ name:'Оплата', ev:'ready', off:'0' }] }];
    d.cust={ tr:[{ pct:'', ev:'delivery', off:'30' }] }; d.tax='25'; return d; };
  const K=o=>({ sumRub:1050000, vat:5, rates:{}, moneyAuto:2, date:'2026-10-19', items:[{ id:'a', name:'Компрессор', qty:1, cost:610000, cur:'RUB' }], ...o });
  const near=(a, b, msg)=>assert.ok(Math.abs(a-b)<0.01, `${msg}: ${a} ≠ ${b}`);
  return swap([[DealSeller, 'own', own], [DealSeller, 'failed', false], [FEAT, 'on', ()=>true]], ()=>{
    DealSeller.sync(deal);
    assert.deepStrictEqual([deal.seller, deal.sellerVat, deal.sellerUsn, deal.sellerUsnRate], ['a', '5', 'income', '']);
    assert.strictEqual(DealSeller.label(deal), 'УСН с НДС 5 % — без вычета · УСН «доходы» 6 %');
    const inc=DealCalculator.calc(K({ sellerVat:'5', sellerUsn:'income' }), D());
    const res=inc.base;
    assert.deepStrictEqual([inc.usn, inc.taxBase, inc.taxP], ['income', 'income', 6], 'ставка по закону, поле сделки 25 % не действует');
    near(res.tax, inc.R*0.06, 'налог — 6 % выручки без НДС');
    near(res.net, res.Pa-res.tax-res.K, 'чистая прибыль');
    // убыточная сделка: налог с выручки всё равно платится
    const loss=DealCalculator.calc(K({ sumRub:500000, sellerVat:'5', sellerUsn:'income' }), D()).base;
    assert.ok(loss.Pa<0 && loss.tax>0, 'при убытке налог УСН «доходы» есть');
    DealSeller.choose(deal, 'b');
    assert.deepStrictEqual([deal.sellerUsn, deal.sellerUsnRate], ['profit', '10']);
    const pro=DealCalculator.calc(K({ vat:22, sumRub:1220000, sellerVat:'22', sellerUsn:'profit', sellerUsnRate:'10' }), D());
    assert.deepStrictEqual([pro.taxBase, pro.taxP], ['profit', 10], 'своя ставка региона');
    near(pro.base.tax, Math.max(0, pro.base.Pa)*0.1, 'налог — с прибыли');
    assert.strictEqual(IncomeTax.rate('profit', '16'), 15, 'выше закона — по закону');
    assert.strictEqual(IncomeTax.rate('income', '1,5'), 1.5);
    assert.strictEqual(IncomeTax.rate('', '6'), null, 'ОСНО — ставка сделки');
    // ОСНО: прежний расчёт — ставка поля сделки
    const osno=DealCalculator.calc(K({ vat:22, sumRub:1220000 }), { ...D(), tax:'20' });
    assert.deepStrictEqual([osno.usn, osno.taxBase, osno.taxP], ['', 'profit', 20]);
    near(osno.base.tax, Math.max(0, osno.base.Pa)*0.2, 'налог на прибыль');
    // УСН с НДС 7 % без объекта УСН (юрлицо до 3.246.0) — налог на прибыль и предупреждение
    DealSeller.choose(deal, 'c');
    assert.deepStrictEqual([deal.sellerVat, deal.sellerUsn], ['7', '']);
    const old=DealCalculator.calc(K({ vat:7, sellerVat:'7' }), D());
    assert.ok(old.warn.some(w=>/налог считается как налог на прибыль 25 %/.test(w.t)), JSON.stringify(old.warn));
    assert.ok(!inc.warn.some(w=>/налог считается как налог на прибыль/.test(w.t)), 'при УСН предупреждения нет');
    // окно: поле сделки при УСН не правится
    const prevDeal=S.deal; KpState.replace({ ...S, deal:D() });
    try {
      const html=DealMoney._tax(inc);
      assert.ok(/Налог УСН «доходы»/.test(html) && /<b>6 %<\/b>/.test(html) && !/data-dl="tax"/.test(html), html);
      assert.ok(/data-dl="tax"/.test(DealMoney._tax(osno)), 'ОСНО — поле ставки');
    } finally { KpState.replace({ ...S, deal:prevDeal }); }
    // Excel: формула налога — с выручки без НДС, подписи — по режиму
    const sheet=new DealXlsxCalc({ calc:inc, deal:D(), kpData:K({ sellerVat:'5', sellerUsn:'income' }), res, unknown:false, kpTitle:'КП' }); sheet.build();
    const graph=new DealXlsxGraph(sheet, DealXlsx.NAMES); graph.head();
    new DealXlsxResult(sheet, graph).build();
    const head=r=>r && r[0] && typeof r[0]==='object' ? r[0].v : r && r[0];
    const row=label=>sheet.rows.find(r=>head(r)===label);
    assert.ok(row('Налог УСН «доходы»') && row('Налог УСН «доходы»')[1].v===6, 'ячейка ставки');
    const taxRow=sheet.rows.filter(r=>r && r[0]==='Налог УСН «доходы»').pop();
    assert.ok(taxRow[1].f && taxRow[1].f.includes(sheet.ref('Rv')) && taxRow[1].f.includes(sheet.ref('TAX')), JSON.stringify(taxRow));
    near(taxRow[1].v, res.tax, 'значение в Excel');
    assert.ok(row('Прибыль до налога УСН'), 'подпись прибыли');
    // выключено — как при ОСНО
    return swap([[FEAT, 'on', key=>key!=='sellerTax']], ()=>{
      assert.strictEqual(DealSeller.usnOf(deal), '');
      assert.strictEqual(DealState.kpInputs({ ...S, deal:{ ...deal, sellerUsn:'income' } }).sellerUsn, '');
    });
  });
});

(async ()=>{
  let passed=0;
  for (const [name, fn] of checks) {
    try { await fn(); passed++; } catch (e) { console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  }
  if (!process.exitCode) console.log(`Деньги и документы (аудит 30.10): проверок ${passed} — все прошли`);
})();
