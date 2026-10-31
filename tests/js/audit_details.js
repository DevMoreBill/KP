// Мелкие расчётные находки отчёта аудита 30.10 (п. 19): экономика сделки, логистика, КП, кабинет — у каждой проверка
// примера из отчёта (было → стало). Станции — в station_calc.js и station_layout.js, сервер — в test_audit_details.py.
// Запуск из корня репозитория: node tests/js/audit_details.js — код выхода 0, если всё прошло (tests/test_audit_details.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
global.document={ addEventListener(){} };
const web=require('./web.js');
web.load(path.join(JS, 'features', 'crm', 'index.js'));
web.load(path.join(JS, 'features', 'deal', 'index.js'));

// разделы КП и документа — прямо из своих файлов (их index.js вешает обработчики страницы)
const mod=file=>require(path.join(JS, file));
const { KpState }=mod('core/state.js');
const { DocxFill }=mod('features/doc/docx-fill.js');
const { KpDate }=mod('core/kp-date.js');
const { KpReport }=mod('features/kp/kp-report.js');
const { KpReportView }=mod('features/kp/kp-report-view.js');
const { Currency }=mod('core/currency.js');
const { WorkCalendar }=mod('core/date-picker.js');
const { FEAT }=mod('core/features.js');

const checks=[];
const check=(name, fn)=>checks.push([name, fn]);

check('CALC-050: спецпошлина ТН ВЭД — по дате сделки (после срока действия — ставка ЕТТ)', ()=>{
  assert.strictEqual(TnVed.special('8414 80 750 0', 'США', '2028-02-01'), null, 'после 31.12.2027 — без 30 %');
  assert.strictEqual(TnVed.special('8414 80 750 0', 'США', '2027-06-01').duty, 30);
  DealCal.load=()=>null;   // производственный календарь — с сервера отдела, в проверке не нужен
  const kp=DealState.kpInputs({ items:[], pricing:{}, vat:22, deal:{ start:'2028-02-01' } });
  assert.strictEqual(kp.date, '2028-02-01', 'в расчёт передаётся дата сделки');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(DealState.kpInputs({ items:[], pricing:{}, vat:22 }).date), 'без даты сделки — сегодня');
});

check('CALC-044: «Сумма, ₽» у цен без НДС — НДС поставщика и курс расчёта, как в итогах', ()=>{
  const card={ calc:{ rate:cur=>(cur==='USD' ? 90 : 1), sv:22 }, cs:{ noVat:true } };
  // КП без НДС, поставщик в России, 1 000 000 ₽ без НДС: было 1 000 000 ₽ (НДС КП 0 %), в расчёте — 1 220 000 ₽
  assert.strictEqual(DealSupplierCard.prototype._lineSum.call(card, { cost:100000000, qty:1, costCur:'RUB' }), 1220000);
  assert.strictEqual(DealSupplierCard.prototype._lineSum.call(card, { cost:100000, qty:2, costCur:'USD' }), 2000*90*1.22);
});

check('CALC-043: подсказка «Стоимость денег» — × дней в месяце / 365, как в расчёте', ()=>{
  const title=DealMoney._autoTitle({ rate:16.5, date:'01.10.2026' }, 3);
  assert.ok(/× 30 \/ 365/.test(title) && !/на 12/.test(title), title);
});

check('CALC-042: вписан код ТН ВЭД без ставки — ставка кода из справочника (нет в справочнике — «укажите»)', ()=>{
  assert.deepStrictEqual(TnVed.known('7311009100'), { code:'7311 00 910 0', duty:15 }, 'код в любой записи');
  assert.strictEqual(DealHs.dutyOf('7311 00 910 0'), '15', 'ресивер — 15 % (было: оставалась ставка станции 0 %)');
  assert.strictEqual(DealHs.dutyOf('1234 56 789 0'), '', 'нет в справочнике — пусто');
  const badge=DealHs.badge({ id:'a' }, { code:'7311 00 910 0', duty:'0', src:'вручную', ref:null });
  assert.ok(/код и ставка не совпадают со справочником/.test(badge), badge);
  assert.ok(!/не совпадают/.test(DealHs.badge({ id:'a' }, { code:'7311 00 910 0', duty:'15', src:'вручную', ref:null })));
});

check('CALC-045: строки «НДС к вычету» сходятся с итогом (НДС сборки станции и поправок Битрикс24 — строками)', ()=>{
  const blank=()=>{ const d=DealTerms.blank({}); d.cust={ tr:[{ pct:'', ev:'delivery', off:'30' }] }; d.tax='25'; return d; };
  const sup={ ...DealTerms.newSupplier('s1', { country:'Россия' }), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40', pay:[{ name:'Оплата', ev:'ready', off:'0' }] };
  const kp={ sumRub:2400000, vat:22, rates:{}, moneyAuto:2, date:'2026-10-19',
    items:[{ id:'c', name:'Контейнер', qty:1, cost:900000, cur:'RUB', kit:true, role:'container' }, { id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB', kit:true }] };
  const d=blank(); d.sup=[sup]; d.asm={ on:true, sup:'s1', days:'14', cost:{ v:'1220000' } };
  let calc=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
  const rows=c=>DealResult.vatRows(c).ded.reduce((sum, row)=>sum+row[1], 0);
  assert.ok(Math.abs(rows(calc)-calc.base.VATin)<0.01, `строки ${rows(calc)} = итог ${calc.base.VATin} (было: без НДС сборки 220 000 ₽)`);
  assert.ok(DealResult.vatRows(calc).ded.some(row=>row[0]==='НДС в сборке станции' && Math.abs(row[1]-220000)<0.01));
  // поправка из Битрикс24 — строкой «НДС в поправках»
  const raw=calc.equipSum; d.bxFix={ equip:{ to:raw+122000, base:raw } };
  calc=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
  assert.ok(Math.abs(rows(calc)-calc.base.VATin)<0.01 && DealResult.vatRows(calc).ded.some(row=>row[0]==='НДС в поправках из Битрикс24'), 'поправка — строкой');
});

check('CALC-046: гарантия «Исполнения договора» — окончание ПНР + месяц (44-ФЗ, ст. 96, ч. 3)', ()=>{
  assert.strictEqual(DealSchedule.prototype._bgDays.call({ D:10, pnrEnd:120 }, 'perf'), 150, '120 → 150 дн. (было 120)');
  assert.strictEqual(DealSchedule.prototype._bgDays.call({ D:10, pnrEnd:120 }, 'adv'), 10, 'возврат аванса — как было');
  // 1 000 000 ₽, 3 % годовых: 120 дн. — 9 863,01 ₽, 150 дн. — 12 328,77 ₽
  assert.strictEqual(Math.round(1000000*0.03*150/365*100)/100, 12328.77);
});

check('CALC-047: Excel — сроки изготовления и доставки справочно, месяц из «Значений», наличные «с оплат заказчика»', ()=>{
  const kp={ sumRub:1220000, vat:22, rates:{}, moneyAuto:2, date:'2026-10-19', items:[{ id:'a', name:'Компрессор', qty:1, cost:500000, cur:'RUB' }] };
  const d=DealTerms.blank({});
  d.sup=[{ ...DealTerms.newSupplier('s1', { country:'Россия' }), country:'Россия', cusMode:'none', vatIn:true, prod:'40', ship:'40', pay:[{ name:'Оплата', ev:'ready', off:'0' }] }];
  d.cust={ tr:[{ pct:'50', ev:'sign', off:'0' }, { pct:'', ev:'delivery', off:'30' }] }; d.tax='25'; d.xc={ mode:'net', v:'10', cost:'12', when:'pay' };
  const calc=DealCalculator.calc(kp, JSON.parse(JSON.stringify(d)));
  const sheet=new DealXlsxCalc({ calc, deal:d, kpData:kp, res:calc.base, unknown:false, kpTitle:'КП' }); sheet.build();
  const prod=sheet.rows.find(r=>r && r[0]==='Изготовление');
  assert.ok(prod && prod[1].s!=='inpInt' && /График платежей/.test(JSON.stringify(prod)), 'не жёлтая — справочно: '+JSON.stringify(prod));
  const cash=sheet.rows.find(r=>r && /^Прочие расходы наличными/.test(String(r[0])));
  assert.ok(cash && /с оплат заказчика/.test(JSON.stringify(cash)), JSON.stringify(cash));
  const saved=DealValues.num; DealValues.num=(key, def)=>(key==='deal.monthDays' ? 31 : saved.call(DealValues, key, def));
  try {
    const graph=new DealXlsxGraph(sheet, DealXlsx.NAMES); graph.head(); graph.build ? graph.build() : null;
    assert.ok(JSON.stringify(graph.rows||sheet.rows).includes('месяц = 31 дней'), 'месяц — из «Значений программы»');
  } finally { DealValues.num=saved; }
});

check('CALC-048: тарифы доставки без источника — с пометкой «требует подтверждения» (трал 22 т, тяжеловес 20 т и др.)', ()=>{
  const line=FreightTariffs.DEFAULTS.sources.find(text=>/^Требует подтверждения/.test(text));
  assert.ok(line && /22 т/.test(line) && /20 т/.test(line) && /ПП РФ от 21\.12\.2020 № 2200/.test(line) && /100 000 ₽/.test(line), line);
});

check('CALC-033: сумма строки позиции и итог КП — одни и те же опции (без названия — ни там, ни там)', ()=>{
  const item={ qty:1, price:100000, options:[{ name:'Монтаж', qty:1, price:20000 }, { name:'', qty:2, price:5000 }] };
  assert.deepStrictEqual(KpState.pricedOptions(item), [{ qty:1, price:20000 }]);
  assert.strictEqual(KpState.itemSum(item), 120000, 'было 130 000: опция без названия в строке, но не в итоге');
  KpState.replace({ items:[item], vat:22 });
  assert.strictEqual(KpState.totals().sum, KpState.itemSum(item), 'итог КП = сумма строки');
});

check('CALC-051: метки шаблона Word {constructor}, {toString} — «незнакомые», а не текст функции', ()=>{
  const missing=new Set();
  const para='<w:p><w:r><w:t>{constructor} и {toString} и {покупатель}</w:t></w:r></w:p>';
  const out=DocxFill._para(para, { покупатель:'ООО «Пример»' }, '', missing);
  assert.ok(!/function|native code|\[object/.test(out) && /ООО «Пример»/.test(out), out);
  assert.deepStrictEqual([...missing].sort(), ['constructor', 'toString']);
});

check('CALC-054: срок действия КП — клиент и сервер по одной таблице примеров (tests/offer_term_cases.json)', ()=>{
  const cases=JSON.parse(require('fs').readFileSync(path.join(ROOT, 'tests', 'offer_term_cases.json'), 'utf8'));
  for (const one of cases)
    assert.strictEqual(KpDate.validUntil({ date:one.date, conditions:[{ label:'Срок действия предложения', value:one.value }] }), one.until, `«${one.value}»`);
});

check('CALC-055: один разбор курса, одна конверсия, итог отчёта — тем же сложением, что по менеджерам', ()=>{
  assert.strictEqual(Currency.parseRate('1 234,56'), 1234.56); assert.ok(Number.isNaN(Currency.parseRate('0')) && Number.isNaN(Currency.parseRate('')));
  assert.strictEqual(KpReportView.conv({ won:1, lost:2 }), '33 %'); assert.strictEqual(KpReportView.conv({ won:0, lost:0 }), '—');
  const rows=[{ id:'1', sumRub:100, track:{ st:'won' }, profitRub:20, manager:'А' }, { id:'2', sumRub:50, track:{ st:'lost' }, manager:'Б' }, { id:'3', sumRub:30, manager:'А' }];
  const rep=KpReport.calc(rows);
  const byMgr=rep.mgr.reduce((sum, row)=>({ n:sum.n+row.n, sum:sum.sum+row.sum, won:sum.won+row.won, profit:sum.profit+row.profit }), { n:0, sum:0, won:0, profit:0 });
  assert.deepStrictEqual([rep.tot.n, rep.tot.sum, rep.tot.won, rep.tot.profit], [byMgr.n, byMgr.sum, byMgr.won, byMgr.profit]);
});

check('CALC-037: уведомления браузера — только по своей доске (кабинет коллеги или весь отдел — молчим)', async ()=>{
  const keep={ board:CrmData.board, who:CrmData.who, openTasks:CrmData.openTasks, openDeals:CrmData.openDeals, load:CrmData.load, say:BrowserNotify._say };
  try {
    let said=0; BrowserNotify._say=()=>{ said++; }; CrmData.load=async ()=>null; CrmData.openDeals=()=>[];
    const soon=new Date(Date.now()+5*60000), hhmm=`${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
    CrmData.openTasks=()=>[{ id:'t-audit', time:hhmm, due:mod('core/util.js').today(), title:'Звонок', deal:'' }];
    CrmData.board={ me:'m1' }; CrmData.who='m2';
    await BrowserNotify._tick(); assert.strictEqual(said, 0, 'чужая доска — без уведомлений');
    CrmData.who='m1'; await BrowserNotify._tick();
    if (soon.getDate()===new Date().getDate()) assert.strictEqual(said, 1, 'своя — уведомление о деле через 5 минут');
  } finally { Object.assign(CrmData, { board:keep.board, who:keep.who, openTasks:keep.openTasks, openDeals:keep.openDeals, load:keep.load }); BrowserNotify._say=keep.say; }
});

check('CALC-038: «Отдел» и «Клиенты» — отложенная сделка не «в работе» и не «без дела»', ()=>{
  const keep=FEAT.on; FEAT.on=()=>true;
  try {
    const row=CabTeam._blank('m1', 'Менеджер');
    CabTeam._count(row, { stage:'new', sum:100, pausedUntil:'2099-01-01' }, false);
    assert.deepStrictEqual([row.open, row.free], [0, 0], 'отложена до 2099 — не в работе');
    CabTeam._count(row, { stage:'new', sum:100 }, false);
    assert.deepStrictEqual([row.open, row.free], [1, 1]);
    assert.strictEqual(CabClients._open({ stage:'new', pausedUntil:'2099-01-01' }), false);
  } finally { FEAT.on=keep; }
});

check('CALC-039: «Неделя» на стыке лет — календари обоих лет, по загрузке — перерисовка кабинета', async ()=>{
  const keep={ year:WorkCalendar.year, dispatch:document.dispatchEvent };
  const asked=[], events=[];
  try {
    WorkCalendar.year=year=>{ asked.push(year); return null; };
    WorkCalendar.loading[2027]=Promise.resolve(); WorkCalendar.loading[2026]=Promise.resolve();
    document.dispatchEvent=event=>events.push(event.type);
    CabTodaySide._calendars(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-05']);
    await new Promise(done=>setTimeout(done, 0));
    assert.deepStrictEqual(asked.sort(), [2026, 2027], 'запрошены оба года (было: только текущий)');
    assert.ok(events.includes(CrmFmt.REDRAW), 'после загрузки — событие перерисовки');
  } finally { WorkCalendar.year=keep.year; document.dispatchEvent=keep.dispatch; delete WorkCalendar.loading[2027]; delete WorkCalendar.loading[2026]; }
});

check('CALC-040: «Регламент» и «Где тратится время» — ошибка с «Повторить», кэш не продлевается', async ()=>{
  const { Api }=mod('core/net.js');
  const keep=Api.request;
  try {
    Api.request=async ()=>{ throw new Error('нет связи с сервером отдела'); };
    for (const block of [TeamRegs, TeamTime]){
      block.data=null; block.loadedAt=0; block.failedAt=0;
      await block._load();
      assert.ok(block.data.error && block.loadedAt===0 && block.failedAt>0, 'ошибка — без продления кэша');
      const html=block===TeamRegs ? block._inner() : block._body();
      assert.ok(/Не загрузилось: нет связи с сервером отдела/.test(html) && /data-cabretry/.test(html) && !/выключен|нет — считать/.test(html), html);
      assert.strictEqual(block._due(), false, 'сразу не повторяет');
      block.failedAt=Date.now()-block.RETRY_MS-1; assert.strictEqual(block._due(), true, 'через 30 с — повторит');
    }
  } finally { Api.request=keep; }
});

(async ()=>{
  let passed=0;
  for (const [name, fn] of checks) {
    try { await fn(); passed++; } catch (e) { console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  }
  if (!process.exitCode) console.log(`Мелкие расчётные находки (аудит 30.10, п. 19): проверок ${passed} — все прошли`);
})();
