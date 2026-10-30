// Ошибки поведения интерфейса, найденные аудитом 30.10 (3.226.4): дата по номеру дня на «Графике», итоги и сортировка
// списка сделок по всем строкам, отбор «Без движения», заготовка и смена клиента — без сделки прежнего клиента, поиск
// строки журнала по номеру КП, повтор запросов без конца (календари сделки и дат, вкладки Битрикс24), опрос загрузки фида,
// копирование по http://сервер, снятые галочки плана фида.
// Запуск из корня репозитория: node tests/js/audit_ui.js — код выхода 0, если всё прошло (tests/test_audit_ui.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(JS, 'features', 'crm', 'index.js'));
// классы с одинаковым именем в разных папках (DealWin) — прямо из своего файла
const mod=file=>require(path.join(JS, file));
const ticks=async count=>{ for (let i=0; i<count; i++) await new Promise(resolve=>setImmediate(resolve)); };
// подмена статических методов на время проверки: [класс, имя, замена] → вернуть как было
const swap=async (pairs, fn)=>{
  const saved=pairs.map(([owner, name])=>[owner, name, owner[name]]);
  for (const [owner, name, value] of pairs) owner[name]=value;
  try { return await fn(); } finally { for (const [owner, name, value] of saved) owner[name]=value; }
};

const checks=[];
const check=(name, fn)=>checks.push([name, fn]);

check('номер дня и дата по нему — тот же день (было: на день позже)', ()=>{
  for (const day of ['2026-10-30', '2026-01-01', '2026-03-29', '2026-12-31']) {
    assert.strictEqual(CrmFmt.iso(CrmFmt.dayNo(day)), day);
  }
  assert.strictEqual(CrmFmt.dayNo('2026-10-31')-CrmFmt.dayNo('2026-10-30'), 1, 'разница дней — как была');
});

check('список сделок: «Всего» и сумма — по всем строкам отбора, показ — первые limit', ()=>{
  CabList.cols=['name', 'sum'];
  const deals=Array.from({length:150}, (_, i)=>({ id:'d'+i, number:String(i), title:'Сделка '+i, sum:100*(i+1) }));
  const row={ expected:()=>'', next:()=>'' };
  const html=CabList.html(deals, { more:'', row, limit:100 });
  assert.ok(html.includes('Всего: <b>150</b>'), 'всего — 150, а не 100');
  assert.ok(html.includes(CrmFmt.short(deals.reduce((sum, deal)=>sum+deal.sum, 0))), 'сумма — по всем 150');
  assert.strictEqual((html.match(/ data-deal="/g) || []).length, 100, 'строк сделок показано — 100');
  CabList.sortBy='sum'; CabList.desc=true;
  const top=CabList.html(deals, { more:'', row, limit:100 });
  assert.ok(top.indexOf('Сделка 149')>=0 && top.indexOf('Сделка 149')<top.indexOf('Сделка 148'), 'сортировка по сумме — по всем строкам');
  CabList.sortBy=null; CabList.desc=false;
});

check('«Без движения» → «показать все»: отбор idle есть и тот же, что у «Сегодня»', ()=>{
  const old=KpDate.addDays(today(), -30), fresh=today();
  const deals=[{ id:'a', next:{ due:fresh }, updated:old }, { id:'b', next:{ due:fresh }, updated:fresh }, { id:'c', updated:old }];
  assert.deepStrictEqual(deals.filter(CabDeals.FILTERS.idle[1]).map(deal=>deal.id), ['a']);
  assert.deepStrictEqual(CabToday._idle(deals).map(deal=>deal.id), ['a']);
});

check('заготовка, «Копия» и «Сменить клиента» — без сделки прежнего клиента', ()=>{
  assert.ok(Presets.DROP.includes('dealId'));
  const state={ client:'ООО «А»', clientInn:'7700000001', dealId:'deal-7' };
  ClientFields.clear(state);
  assert.ok(!('dealId' in state) && state.client==='');
  assert.ok(KpRepeat.DROP.includes('dealId'), 'как у «Повторить КП»');
});

check('строка журнала по номеру — среди нескольких (номер бывает частью других)', ()=>{
  assert.ok(Reminders.JOURNAL_ROWS>=20);
});

check('редактор правил компоновки: подпись ключа пары и подпись поля — разные методы', ()=>{
  assert.strictEqual(typeof LayoutEditor._keyLabel, 'function');
  assert.strictEqual(typeof LayoutEditor._label, 'function');
});

check('календарь сделки: год, который сервер не отдал, не запрашивается снова (было: запрос → отказ → перерисовка без конца)', async ()=>{
  const { DealCal }=mod('features/deal/deal-cal.js');
  const { DealWin }=mod('features/deal/deal-win.js');
  const { SidePanel }=mod('ui/side-panel.js');
  const { Api }=mod('core/net.js');
  const asked=[];
  await swap([
    [Api, 'request', url=>{ asked.push(url); return Promise.reject(new Error('Год вне диапазона')); }],
    [DealWin, 'render', ()=>DealCal.load('1999-05-01')],
    [SidePanel, 'render', ()=>{}],
    [console, 'warn', ()=>{}],
  ], async ()=>{
    DealCal.load('1999-05-01');
    await ticks(30);
  });
  assert.strictEqual(asked.length, 3, 'по одному запросу на год: '+asked.join(', '));
  assert.ok(!DealCal.ready('1999-05-01'), 'расчёт — без календаря, как до загрузки');
});

check('календарь дат: год, который сервер не отдал, не запрашивается снова (было: перерисовка → запрос → отказ без конца)', async ()=>{
  const { WorkCalendar, DatePicker }=mod('ui/date-picker.js');
  const { Api }=mod('core/net.js');
  const asked=[];
  DatePicker.state.input={};
  await swap([
    [Api, 'request', url=>{ asked.push(url); return Promise.reject(new Error('Год вне диапазона')); }],
    [DatePicker, 'draw', ()=>WorkCalendar.year(20206)],
    [console, 'warn', ()=>{}],
  ], async ()=>{
    WorkCalendar.year(20206);
    await ticks(30);
  });
  DatePicker.state.input=null;
  assert.strictEqual(asked.length, 1, 'один запрос: '+asked.join(', '));
});

check('календарь сделки: загруженные годы — окно перерисовывается, календарь готов', async ()=>{
  const { DealCal }=mod('features/deal/deal-cal.js');
  const { DealWin }=mod('features/deal/deal-win.js');
  const { SidePanel }=mod('ui/side-panel.js');
  const { Api }=mod('core/net.js');
  let renders=0;
  await swap([
    [Api, 'request', ()=>Promise.resolve({ days:'0'.repeat(366) })],
    [DealWin, 'render', ()=>{ renders++; }],
    [SidePanel, 'render', ()=>{}],
  ], async ()=>{
    DealCal.load('2030-01-10');
    await ticks(30);
  });
  assert.ok(DealCal.ready('2030-01-10'));
  assert.strictEqual(renders, 3);
});

check('Битрикс24, «Регламент» и «Экономика сделки»: отказ сервера не повторяется перерисовкой; снова — при открытии вкладки', async ()=>{
  const { BitrixPanel }=mod('features/admin/bitrix-panel.js');
  const { BitrixRegs }=mod('features/admin/bitrix-regs.js');
  const { BitrixEcon }=mod('features/admin/bitrix-econ.js');
  const { AdminApi }=mod('features/admin/admin-core.js');
  for (const [view, tab] of [[BitrixRegs, 'regs'], [BitrixEcon, 'econ']]) {
    let calls=0;
    view.view=null;
    view.asked=false;
    await swap([
      [AdminApi, 'get', ()=>{ calls++; return Promise.reject(new Error('Нет связи с Битрикс24')); }],
      [BitrixPanel, 'state', { hasUrl:true }],
      [BitrixPanel, 'render', ()=>view.bind()],
    ], async ()=>{
      view.bind();
      await ticks(30);
      assert.strictEqual(calls, 1, tab+': один запрос, а не без конца');
      BitrixPanel._again(tab);
      view.bind();
      await ticks(30);
      assert.strictEqual(calls, 2, tab+': вкладку открыли снова — новая попытка');
    });
  }
});

check('Битрикс24, «Воронки и этапы»: стадии каждой воронки — один запрос (было: отказ — без конца, успех — повторы)', async ()=>{
  const { BitrixPanel }=mod('features/admin/bitrix-panel.js');
  const { BitrixStages }=mod('features/admin/bitrix-tabs.js');
  const { AdminApi }=mod('features/admin/admin-core.js');
  const blocks=['1', '2', '3'].map(bxcat=>({ dataset:{ bxcat } }));
  for (const fail of [true, false]) {
    const asked=[];
    BitrixStages.asked.clear();
    await swap([
      [AdminApi, 'post', (url, body)=>{ asked.push(body.category); return fail ? Promise.reject(new Error('Нет связи')) : Promise.resolve({ stages:[] }); }],
      [BitrixPanel, 'portal', { stagesBy:{} }],
      [BitrixPanel, 'embed', 'cats'],
      [BitrixPanel, 'all', selector=>(selector==='[data-bxcat]' ? blocks : [])],
      [BitrixPanel, 'one', ()=>({})],
      [BitrixPanel, 'render', ()=>BitrixStages.bind()],
    ], async ()=>{
      BitrixStages.bind();
      await ticks(30);
    });
    assert.deepStrictEqual(asked.sort(), ['1', '2', '3'], (fail ? 'отказ' : 'успех')+': '+asked.join(', '));
  }
});

check('фиды: опрос загрузки и проверки идёт, пока открыта панель «Фиды» (с 3.189 — в вкладке «Каталог»)', async ()=>{
  const { FeedsTab }=mod('features/admin/feeds-tab.js');
  const { AdminApi, AdminState }=mod('features/admin/admin-core.js');
  const { Catalog }=mod('features/catalog/catalog-store.js');
  let asked=0, refreshed=0;
  AdminState.tab='catalog';
  await swap([
    [document, 'querySelector', selector=>(selector==='#fdPanel' || selector==='#fdJob' ? {} : null)],
    [AdminApi, 'get', ()=>{ asked++; return Promise.resolve({ job:{ state:'done' } }); }],
    [Catalog, 'refresh', ()=>{ refreshed++; }],
    [FeedsTab, 'render', ()=>{}],
  ], ()=>FeedsTab._tick('f1', {}));
  assert.strictEqual(asked, 1, 'состояние загрузки запрошено');
  assert.strictEqual(refreshed, 1, 'загрузка закончилась — каталог обновлён');
});

check('фиды, «Что загрузится…»: снятая галочка остаётся снятой при отборе по виду строки и не загружается', ()=>{
  const { FeedRulesUi }=mod('features/admin/feed-rules.js');
  const { FeedState }=mod('features/admin/feed-state.js');
  FeedState.rplan={ id:'f', counts:{ add:2, update:1, same:0, skip:0 },
    rows:[{ oid:'a', status:'add', name:'A' }, { oid:'b', status:'add', name:'B' }, { oid:'c', status:'update', name:'C' }] };
  FeedState.roff=new Set();
  FeedState.rpf='';
  FeedRulesUi.pick({ checked:false, dataset:{ rpo:'b' } });
  FeedState.rpf='add';
  const html=FeedRulesUi.plan(FeedState.rplan);
  assert.ok(/data-rpo="a" checked/.test(html), 'отмеченная — отмечена');
  assert.ok(/data-rpo="b" aria-label/.test(html), 'снятая — снята и после отбора');
  const main={ querySelectorAll:()=>[], querySelector:()=>null };
  assert.deepStrictEqual(FeedRulesUi.only(main), ['a', 'c'], 'загрузятся все, кроме снятой');
  FeedState.forget();
  assert.strictEqual(FeedState.roff.size, 0, 'другой фид — без чужих галочек');
});

check('ТЗ заказчика, «Копировать вопросы» — через CopyText (по http://сервер у браузера нет navigator.clipboard)', async ()=>{
  const { TzImport }=mod('features/tz/tz-import.js');
  const { CopyText }=mod('core/files.js');
  const { Toast }=mod('core/toast.js');
  const said=[];
  let copied='';
  TzImport.cur={ r:{ questions:['Рабочее давление?'], later:['Срок поставки?'] } };
  await swap([
    [CopyText, 'copy', async text=>{ copied=text; return true; }],
    [Toast, 'show', text=>said.push(text)],
  ], ()=>TzImport._copyQuestions());
  assert.strictEqual(copied, '1. Рабочее давление?\n2. Срок поставки?');
  assert.deepStrictEqual(said, ['Вопросы скопированы']);
});

(async ()=>{
  let passed=0;
  for (const [name, fn] of checks) {
    try { FEAT.vals={}; await fn(); passed++; } catch (e) { console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  }
  if (!process.exitCode) console.log(`OK: ${passed}`);
})();
