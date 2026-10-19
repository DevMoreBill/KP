// Экономика сделки и логистика (app/web/js/features/deal-calc.js, logistics-calc.js, logistics.js): ручной груз в мм и кг,
// прежние КП в метрах и тоннах, «своя сумма» доставки в валюте → рубли по курсу, значения из «Настройки → Значения
// программы» меняют расчёт, ручная перепроверка формул сделки.
// Запуск из корня репозитория: node tests/js/deal_logistics.js — код выхода 0, если всё прошло (tests/test_deal_logistics.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.GEO_EXTRA={};                                   // подсказки адресов (ui/geo-input.js) — в тесте не нужны
for (const f of ['core/money.js', 'core/defaults.js', 'features/deal-calc.js', 'features/logistics-calc.js', 'features/logistics.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }

let n=0;
const check=(name, fn)=>{ try{ DEFS_SRV={}; fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };
const near=(a, b, msg, eps=0.01)=>assert.ok(Math.abs(a-b)<=eps, `${msg}: ${a} ≠ ${b}`);

// простая сделка: поставщик в России, оплата поставщику 100 % перед отгрузкой, заказчик — через 30 дней после поставки
function deal(o={}){
  const d=dealBlank({});
  const s=d.sup[0]; Object.assign(s, {country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40', pay:[{name:'Оплата', ev:'ready', off:'0'}]}, o.sup||{});
  d.cust={tr:[{pct:'', ev:'delivery', off:'30'}]}; d.tax='25';
  return d;
}
const KP={sumRub:1220000, vat:22, rates:{USD:'92,5', EUR:'100'}, items:[{id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB'}], moneyAuto:2};

check('ручной груз: мм и кг → метры и тонны', ()=>{
  const o={}; LgCargoIn.set(o, 'l', '2400'); LgCargoIn.set(o, 'w', '1200,5'); LgCargoIn.set(o, 'h', '1 850'); LgCargoIn.set(o, 'm', '1500,5');
  assert.deepStrictEqual(o, {lmm:'2400', wmm:'1200,5', hmm:'1 850', kg:'1500,5'});
  near(LgCargoIn.val(o, 'l'), 2.4, 'длина'); near(LgCargoIn.val(o, 'w'), 1.2005, 'ширина', 1e-9); near(LgCargoIn.val(o, 'h'), 1.85, 'высота', 1e-9); near(LgCargoIn.val(o, 'm'), 1.5005, 'масса', 1e-9);
  // в поле — как вписано (запятая не пропадает при перерисовке)
  assert.strictEqual(LgCargoIn.text(o, 'w', 1.2005), '1200,5');
  assert.strictEqual(LgCargoIn.text({lmm:'2,'}, 'l', 0.002), '2,', 'недописанное число не переписывается');
  // пусто — своё значение убирается
  LgCargoIn.set(o, 'l', ' '); assert.ok(!('lmm' in o) && LgCargoIn.val(o, 'l')==null);
  // из характеристик (м, т) — показ в мм / кг
  assert.strictEqual(LgCargoIn.text({}, 'l', 3.197), '3197'); assert.strictEqual(LgCargoIn.text({}, 'm', 0.0125), '12,5'); assert.strictEqual(LgCargoIn.text({}, 'm', null), '');
});

check('прежнее КП в метрах и тоннах открывается верно', ()=>{
  const o={l:'1,2', w:'0.8', h:'2,05', m:'0,45'};
  assert.deepStrictEqual(['l', 'w', 'h', 'm'].map(f=>LgCargoIn.val(o, f)), [1.2, 0.8, 2.05, 0.45]);
  assert.deepStrictEqual(['l', 'w', 'h', 'm'].map(f=>LgCargoIn.text(o, f, LgCargoIn.val(o, f))), ['1200', '800', '2050', '450']);
  LgCargoIn.set(o, 'l', '1250');                         // правка поля переводит его в мм, остальные — прежние
  assert.deepStrictEqual(o, {w:'0.8', h:'2,05', m:'0,45', lmm:'1250'}); near(LgCargoIn.val(o, 'l'), 1.25, 'длина после правки', 1e-9);
  assert.ok(LgCargoIn.has(o, 'm') && !LgCargoIn.has({}, 'm'));
});

check('груз в мм и кг даёт тот же расчёт доставки, что прежний в метрах и тоннах', ()=>{
  const T=Freight.tariffs(), mm={lmm:'2400', wmm:'1200', hmm:'1850', kg:'1500'}, old={l:'2,4', w:'1,2', h:'1,85', m:'1,5'};
  const it=o=>({name:'Компрессор', qty:2, l:LgCargoIn.val(o, 'l'), w:LgCargoIn.val(o, 'w'), h:LgCargoIn.val(o, 'h'), m:LgCargoIn.val(o, 'm')});
  const a=Freight.calc({from:{addr:'Москва'}, to:{addr:'Казань'}, km:'', items:[it(mm)], value:1000000}, T), b=Freight.calc({from:{addr:'Москва'}, to:{addr:'Казань'}, km:'', items:[it(old)], value:1000000}, T);
  assert.ok(a.total>0 && !a.need, 'посчитано'); assert.strictEqual(a.total, b.total); assert.strictEqual(a.vehicles[0].C.id, b.vehicles[0].C.id);
  near(a.mass, 3.0, 'масса двух мест, т (без упаковки — тяжелее 3 т нет, легче — +10 %)', 0.31);
});

check('своя сумма доставки в валюте → рубли по курсу ЦБ', ()=>{
  const d=deal({sup:{logRu:{v:'1000,5', cur:'USD'}}}), c=dealCalc(KP, d), s=c.sup[0];
  near(s.Lru, 1000.5*92.5, 'доставка в рублях'); assert.ok(s.LruFx, 'признак валюты');
  assert.ok(c.used.includes('USD'), 'валюта попадает в курсы «Цены КП»');
  const row=c.rows.find(r=>r.key==='ru:'+s.id); near(row.amount, -1000.5*92.5, 'платёж в графике — рубли');
  near(s.voRu, 1000.5*92.5*22/122, 'НДС к вычету по услугам — от рублёвой суммы');
  // без валюты (прежние КП и «по расчёту») — рубли
  near(dealCalc(KP, deal({sup:{logRu:{v:'60000'}}})).sup[0].Lru, 60000, 'рубли');
  near(dealCalc(KP, deal({sup:{logRu:{v:'60000', src:'module'}}})).sup[0].Lru, 60000, 'по расчёту');
  // свой курс расчёта главнее курса КП; нет курса — ошибка поля, сумма не учитывается
  const d2=deal({sup:{logRu:{v:'100', cur:'EUR'}}}); d2.rates={EUR:'110'}; near(dealCalc(KP, d2).sup[0].Lru, 11000, 'свой курс');
  const c3=dealCalc({...KP, rates:{}}, deal({sup:{logRu:{v:'100', cur:'CNY'}}}));
  assert.strictEqual(c3.sup[0].Lru, 0); assert.ok(/курса/.test(c3.err['sup.0.logRu']||''), 'ошибка «Нет курса»');
});

check('LgMoney: валюта своей суммы', ()=>{
  const s={lg:{}, logRu:{v:'60000'}}; assert.strictEqual(LgMoney.cur(s), 'RUB', 'сумма прежних версий — рубли');
  DEFS_SRV={'log.manCur':{on:true, v:'EUR'}};
  assert.strictEqual(LgMoney.cur({lg:{}, logRu:{v:''}}), 'EUR', 'пусто — валюта по умолчанию из «Настроек»');
  const s2={lg:{}, logRu:{v:'5', src:'module'}}; LgMoney.setCur(s2, 'CNY'); assert.deepStrictEqual(s2.logRu, {v:'', cur:'CNY'}); assert.strictEqual(s2.lg.manCur, 'CNY');
  const s3={lg:{}, logRu:{v:'84 200', src:'module'}}; LgMoney.toManual(s3); assert.deepStrictEqual(s3.logRu, {v:'84200', cur:'RUB'}, 'сумма расчёта остаётся в рублях');
});

check('ручная перепроверка формул сделки', ()=>{
  const c=dealCalc(KP, deal({sup:{logRu:{v:'1000', cur:'USD'}}})), b=c.base, Lru=92500;
  near(c.R, 1000000, 'выручка без НДС = 1 220 000 / 1,22');
  near(c.Ccash, 500000+Lru, 'платежи: оборудование + доставка');
  const F=500000*0.02*40/30 + (500000+Lru)*0.02*30/30;          // день 40 → 80 → 110 (оплата заказчика)
  near(c.F, F, 'финансирование');
  const VATin=500000*22/122 + Lru*22/122; near(b.VATin, VATin, 'НДС к вычету');
  const Ctot=500000+Lru-VATin+F, P=1000000-Ctot; near(b.Ctot, Ctot, 'себестоимость'); near(b.P, P, 'прибыль');
  near(b.margin, P/1000000*100, 'маржинальность', 1e-6); near(b.markup, P/Ctot*100, 'наценка', 1e-6); near(b.net, P*0.75, 'чистая прибыль');
  near(b.P, b.cashAfter+b.excess, 'контрольное равенство'); assert.ok(!c.warn.some(w=>w.bad), 'нет плохих предупреждений');
});

check('значения программы меняют расчёт', ()=>{
  // таможенный сбор по шкале: встроенная — ПП РФ № 1637 / 1638
  assert.strictEqual(customsFee(1000000), 4924); assert.strictEqual(customsFee(20000000), 73860); assert.strictEqual(customsFee(200000), 1231);
  DEFS_SRV={'deal.fee3':{on:true, v:'5000'}, 'deal.feeLim7':{on:true, v:'12000000'}};
  assert.strictEqual(customsFee(1000000), 5000, 'свой сбор интервала 3'); assert.strictEqual(customsFee(11000000), 49240, 'своя граница 7'); assert.ok(DealValues.feeOwn());
  assert.ok(/свыше 12 000 000 ₽ — 73 860 ₽/.test(DealValues.feeText().replace(/\s/g, ' ')), DealValues.feeText());
  DEFS_SRV={'deal.feeLim2':{on:true, v:'100000'}};                // границы не по возрастанию — встроенная шкала
  assert.strictEqual(customsFee(300000), 2462); assert.ok(!DealValues.feeOwn());
  DEFS_SRV={'deal.fee1':{on:true, v:'-5'}};                        // вне допустимого — встроенное
  assert.strictEqual(customsFee(100000), 1231);
  // ввоз: сбор входит в таможню
  DEFS_SRV={'deal.fee3':{on:true, v:'7000'}};
  const kpI={...KP, items:[{id:'a', name:'Компрессор', qty:1, cost:10000, cur:'USD', duty:5}]};
  const ci=dealCalc(kpI, deal({sup:{country:'Китай', cusMode:'calc', vatIn:false}}));
  near(ci.sup[0].cv, 925000, 'таможенная стоимость'); assert.strictEqual(ci.sup[0].fee, 7000); near(ci.sup[0].T, 925000*0.05+7000+(925000*1.05)*0.22, 'таможенные платежи');
  // дней в месяце — финансирование
  DEFS_SRV={'deal.monthDays':{on:true, v:'31'}};
  near(dealCalc(KP, deal()).F, 500000*0.02*70/31, 'финансирование при 31 дне');
  // запасная стоимость денег, налог, отсрочка, аванс, гарантии, наличные
  DEFS_SRV={'deal.moneyFb':{on:true, v:'3'}, 'deal.tax':{on:true, v:'20'}, 'deal.defer':{on:true, v:'45'}, 'deal.supAdv':{on:true, v:'35'}, 'deal.xcCost':{on:true, v:'10'},
    'deal.bgPct':{on:true, v:'5'}, 'deal.bgWarrDays':{on:true, v:'730'}, 'deal.bgMin':{on:true, v:'1000'}, 'deal.bgAdvPct':{on:true, v:'50'}};
  const kp2={...KP}; delete kp2.moneyAuto;
  const d=deal(); d.tax=''; d.bg=[{type:'warr', rate:'3'}, {type:'perf', base:'pct', rate:'0'}]; d.xc={mode:'sum', v:'100000'};
  const c=dealCalc(kp2, d);
  assert.strictEqual(c.i, 3, 'стоимость денег без ставки ЦБ'); assert.strictEqual(c.taxP, 20, 'налог по умолчанию');
  assert.strictEqual(c.bgs[0].days, 730); near(c.bgs[0].amount, 1220000*0.05, 'гарантия 5 % цены'); near(c.bgs[0].fee, 61000*0.03*730/365, 'комиссия');
  assert.strictEqual(c.bgs[1].fee, 1000, 'минимальная комиссия'); near(c.base.K, 100000/0.9, 'наличные с 10 %');
  const nd=dealBlank({}); assert.strictEqual(nd.cust.tr[0].off, '45', 'отсрочка заказчика'); assert.strictEqual(nd.sup[0].adv, '35', 'аванс поставщику');
  assert.deepStrictEqual(dealSupPay(nd.sup[0]).map(t=>t.pct||''), ['35', '']);
});

check('значения логистики: умолчания и реестр', ()=>{
  assert.strictEqual(LgValues.unload(), 'none', 'по умолчанию разгружает заказчик'); assert.strictEqual(LgValues.mode(), 'auto'); assert.strictEqual(LgValues.manCur(), 'RUB'); assert.strictEqual(LgValues.setDays(), true);
  DEFS_SRV={'log.unload':{on:true, v:'auto'}, 'log.mode':{on:true, v:'manual'}, 'log.manCur':{on:true, v:'USD'}, 'log.setDays':{on:false}};
  assert.strictEqual(LgValues.unload(), 'auto'); assert.strictEqual(LgValues.mode(), 'manual'); assert.strictEqual(LgValues.manCur(), 'USD'); assert.strictEqual(LgValues.setDays(), false);
  assert.strictEqual(LgMoney.setDays({lg:{}}), false); assert.strictEqual(LgMoney.setDays({lg:{setDays:true}}), true, 'галочка в сделке главнее');
  // ключи раздела — с префиксом, в своих разделах, у чисел — пределы и подробная подсказка; встроенное — в пределах
  const mine=DEF_SCHEMA.filter(r=>/^(deal\.(fee|defer|supAdv|monthDays|moneyFb|xcCost|bg(AdvPct|Pct|WarrDays|Min)))|^log\./.test(r[0]));
  assert.ok(mine.length>=30, 'зарегистрировано '+mine.length);
  for (const [k, g, label, type, b, o={}] of mine){
    assert.strictEqual(DefRegistry.section(g), k.startsWith('log.') ? 'log' : 'deal', k+': раздел');
    assert.ok(label && o.hint && o.hint.length>40, k+': подробная подсказка');
    if (type==='num'){ assert.ok(o.req && o.min!=null && o.max!=null, k+': req, min, max'); assert.strictEqual(DefRegistry.check(k, b), '', k+': встроенное в пределах'); }
  }
  assert.strictEqual(new Set(DEF_SCHEMA.map(r=>r[0])).size, DEF_SCHEMA.length, 'ключи не повторяются');
});

check('выброс цены перевозчика не становится максимумом', ()=>{
  const offs=()=>[81034, 74345, 93730, 403840, 222873, 105720, 90773, 108095].map((t, i)=>({src:'п'+i, total:t}));
  const a=LgOutlier.mark(offs()), out=a.filter(o=>o.outlier).map(o=>o.total);
  assert.deepStrictEqual(out, [403840, 222873], 'выбросы при пороге 2 (медиана остальных ≈ 93 тыс.)');
  DEFS_SRV={'log.outlierK':{on:true, v:'0'}}; assert.ok(!LgOutlier.mark(offs()).some(o=>o.outlier), '0 — без защиты');
  DEFS_SRV={}; assert.ok(!LgOutlier.mark(offs().slice(0, 2).concat([{src:'x', total:900000}])).slice(0, 2).some(o=>o.outlier));
  assert.ok(!LgOutlier.mark([{total:100}, {total:500}]).some(o=>o.outlier), 'меньше трёх предложений — не размечается');
});

check('агент-экспедитор — и на разгрузку (решение 17.10), страхование без агентских; выключается в «Значениях программы»', ()=>{
  const T=Freight.tariffs(), inp={from:{addr:'Москва'}, to:{addr:'Казань'}, km:'800', items:[{name:'Компрессор', qty:1, l:2.4, w:1.2, h:1.85, m:2.5}], value:1000000, unload:'auto'};
  DEFS_SRV={};
  const a=Freight.calc(inp, T); assert.ok(a.unload && a.unload.cost>0, 'разгрузка подобрана');
  assert.strictEqual(a.agent, Math.round((a.transport+a.unload.cost)*T.agentPct/100), 'агент на рейс и разгрузку');
  DEFS_SRV={'log.agentUnload':{on:false}};
  const b=Freight.calc(inp, T); assert.strictEqual(b.agent, Math.round(b.transport*T.agentPct/100), 'выключено — только на рейс');
  assert.ok(a.total-b.total===a.agent-b.agent, 'разница — только агентские');
  DEFS_SRV={};
});

check('станция в сборе (решение 17.10) — только открытой машиной, сборный груз ТК не предлагается', ()=>{
  const T=Freight.tariffs(), it={name:'Станция', qty:1, l:6.06, w:2.44, h:2.59, m:4.5};
  const a=Freight.calc({from:{addr:'Москва'}, to:{addr:'Краснодар'}, km:'1478', items:[it], unload:'none'}, T);
  assert.ok(!a.openOnly && a.vehicles.length && !a.vehicles[0].C.open, 'обычный груз — закрытая машина дешевле');
  const b=Freight.calc({from:{addr:'Москва'}, to:{addr:'Краснодар'}, km:'1478', items:[{...it, open:true}], unload:'none'}, T);
  assert.ok(b.openOnly && b.vehicles.length && b.vehicles.every(v=>v.C.open), 'станция — контейнеровоз, площадка или трал');
  const keep=LG.tar; LG.tar=T;
  const Q={res:{offers:[{src:'ПЭК', kind:'ltl', complete:true, price:90000, base:90000}, {src:'ATI.SU', kind:'ftl', complete:true, price:150000, base:150000}]}};
  assert.deepStrictEqual(DealLogistics.offers(b, Q).map(o=>o.id), ['model', 'ATI.SU'], 'без сборного груза');
  assert.strictEqual(DealLogistics.offers(a, Q).length, 3, 'обычный груз — со сборным');
  LG.tar=keep;
});

// ---------------------------------------------------------------- проверка расчётов 19.10 (решение владельца «выполняй все»)
const clsOf=(file, name)=>{ const src=fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', 'features', file), 'utf8'), m=src.match(new RegExp('\\nclass '+name+' \\{[\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, name+' в '+file); vm.runInThisContext(m[0]+'\nglobal.'+name+'='+name+';'); };

check('автомобили прикрытия: Требования Минтранса № 343, п. 14 и 32', ()=>{
  const T=Freight.tariffs();
  assert.deepStrictEqual([[3.4, 0], [3.6, 0], [4.5, 0], [4.6, 0], [5.2, 0], [2.5, 4.6], [2.5, 4.4]].map(([w, h])=>Freight.escortCars(w, h, T)), [0, 2, 2, 3, 3, 1, 0]);
  // ширина 3,8 м, 500 км × 50 ₽/км × 2 машины = 50 000 ₽ (было одна — 25 000 ₽)
  const C=T.classes.find(c=>c.id==='lowbed') || T.classes.find(c=>c.open), fit={ overW:3.8, overH:0, mass:5 };
  const v=Freight.vehicleCost(C, fit, 500, T), p=v.parts.find(x=>/прикрытия/.test(x[0]));
  assert.ok(p && p[1]===2*T.escortKm*500 && v.escortCars===2, JSON.stringify(v.parts));
});

check('НДС к вычету по доставке — без страховой премии (НК РФ, ст. 149, п. 3, пп. 7)', ()=>{
  // доставка по расчёту 120 000 ₽, в ней страхование 7 500 ₽: вычет (120 000 − 7 500) × 22 / 122 = 20 286,89 ₽ (было 21 639,34)
  const d=deal(); d.sup[0].logRu={v:'120000', src:'module', ins:'7500'};
  const s=dealCalc(KP, d).sup[0]; near(s.voRu, 112500*22/122, 'вычет', 0.01); assert.strictEqual(s.LruIns, 7500);
  const m=deal(); m.sup[0].logRu={v:'120000'};
  near(dealCalc(KP, m).sup[0].voRu, 120000*22/122, 'своя сумма менеджера — как раньше', 0.01);
});

check('стоимость денег в месяц: годовая × 30 / 365 (месяц — 30 дней, как в финансировании)', ()=>{
  clsOf('deal.js', 'DealMoneyRate');
  near(DealMoneyRate.month(19.5), 19.5*30/365, 'месяц', 1e-9);       // 1,6027 % (было 19,5 / 12 = 1,625 %)
  near(DealMoneyRate.month(19.5)*365/30, 19.5, 'годовая ставка сходится', 1e-9);
});

check('срок поставки в условиях КП при сборке станции — цепочкой', ()=>{
  clsOf('deal.js', 'DealLeadTime');
  // контейнер 20 + 10 раб. дн., элементы 20 + 10 раб. дн. до сборщика, сборка 15 раб. дн. → 30 + 15 + 10 = 55 рабочих дней (было 30)
  const s1={ active:true, prod:20, ship:10, prodK:'work', shipK:'work' }, s2={ ...s1 };
  const c={ D:77, sup:[s1, s2], asm:{ A:s1, toAsm:[s2], days:15, daysK:'work' } };
  assert.deepStrictEqual(DealLeadTime.of(c), { n:55, kind:'work' });
  assert.deepStrictEqual(DealLeadTime.of({ ...c, asm:{ ...c.asm, daysK:'' } }), { n:77, kind:'' }, 'сборка в календарных — итог расчёта');
  assert.deepStrictEqual(DealLeadTime.of({ D:42, sup:[s1], asm:null }), { n:30, kind:'work' }, 'без сборки — как раньше');
});

if (!process.exitCode) console.log('OK: '+n+' проверок');
