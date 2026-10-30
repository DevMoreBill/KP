// Ошибки поведения интерфейса, найденные аудитом 30.10 (3.226.4–3.226.7): дата по номеру дня на «Графике», итоги и
// сортировка списка сделок по всем строкам, отбор «Без движения», заготовка и смена клиента — без сделки прежнего клиента,
// поиск строки журнала по номеру КП, ошибка пары в редакторе компоновки, тарифы, которые не загрузились, «Проиграно»,
// «Отдел» и «Настройки» при отказе сервера, повтор запросов без конца (календари сделки и дат, вкладки Битрикс24), опрос
// загрузки фида, копирование по http://сервер, снятые галочки плана фида.
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

check('«Без движения» → «показать все»: отбор idle есть и тот же, что у «Сегодня»; чип — только выбранному, выключатель — и в отборе', ()=>{
  const old=KpDate.addDays(today(), -30), fresh=today();
  const deals=[{ id:'a', next:{ due:fresh }, updated:old }, { id:'b', next:{ due:fresh }, updated:fresh }, { id:'c', updated:old }];
  assert.deepStrictEqual(deals.filter(CabDeals.FILTERS.idle[1]).map(deal=>deal.id), ['a']);
  assert.deepStrictEqual(CabToday._idle(deals).map(deal=>deal.id), ['a']);
  const chips=filter=>swap([
    [CrmData, 'openDeals', ()=>deals], [CrmData, 'inFunnel', ()=>true], [CrmData, 'deals', ()=>deals], [CrmData, 'paused', ()=>false],
  ], ()=>{ CabDeals.filter=filter; try { return CabDeals._chips(); } finally { CabDeals.filter=''; } });
  return (async ()=>{
    assert.ok(!(await chips('')).includes('data-cflt="idle"'), 'в строке чипов «Без движения» нет, пока не выбран (как до 3.226.4)');
    assert.ok((await chips('idle')).includes('data-cflt="idle"'), 'выбран из «Сегодня» — чип виден, его можно снять');
    FEAT.vals={ idleDeals:false };
    assert.deepStrictEqual(deals.filter(CabDeals.FILTERS.idle[1]), [], 'функция выключена — отбор пуст, как и блок «Сегодня»');
  })();
});

check('заготовка — без сделки (и заготовки прежних версий); «Копия» и «Сменить клиента» — сделка прежнего клиента не остаётся скрыто', async ()=>{
  assert.ok(Presets.DROP.includes('dealId'));
  assert.ok(KpRepeat.DROP.includes('dealId'), 'как у «Повторить КП»');
  const stripped=Presets._strip({ dealId:'deal-7', client:'ООО «А»', items:[{ id:'i1' }] });
  assert.ok(!('dealId' in stripped) && !('client' in stripped) && stripped.items.length===1, 'старая заготовка со сделкой — без неё');
  const state={ client:'ООО «А»', clientInn:'7700000001', dealId:'deal-7' };
  ClientFields.clear(state);
  assert.strictEqual(state.dealId, 'deal-7', 'очистка клиента сделку не трогает (как до 3.226.4): её проверяет блок «Сделка»');
  const { Api }=mod('core/net.js');
  const { DealPick }=mod('features/crm/deal-pick.js');
  const pick=async (dealId, answer)=>{
    S.dealId=dealId; DealPick.state={ key:'', items:[], current:'', stages:[], busy:false };
    await swap([[Api, 'request', answer], [Steps, 'current', 'deal']], ()=>DealPick._load('7700000002|ооо «б»|')); // без перерисовки формы
    return S.dealId;
  };
  const items=async ()=>({ items:[{ id:'deal-9', number:'9', stage:'new' }], current:'' });
  const was=S.dealId;
  try {
    assert.strictEqual(await pick('deal-7', items), undefined, 'сделка прежнего клиента, которой нет в списке нового, — сбрасывается');
    assert.strictEqual(await pick('deal-9', items), 'deal-9', 'сделка этого клиента — остаётся');
    assert.strictEqual(await pick('new', items), 'new', '«Отдельная новая сделка» — остаётся');
    assert.strictEqual(await pick('deal-3', async ()=>({ items:[], current:'deal-3' })), 'deal-3', 'текущая сделка КП — остаётся');
    assert.strictEqual(await pick('deal-7', async ()=>{ throw new Error('нет связи'); }), 'deal-7', 'список не загрузился — не трогаем');
  } finally { S.dealId=was; }
});

check('строка журнала по номеру — седьмой среди похожих номеров («КП сохранено», «Ход сделки» из напоминаний; было: первые 5 и 1)', async ()=>{
  const { Api }=mod('core/net.js');
  const { KpSaved }=mod('features/kp/kp-saved.js');
  const rows=Array.from({ length:7 }, (_, i)=>({ id:'k'+i, number:'2026-100'+(i ? i : ''), client:'ООО «А»', status:'sent' }));
  // сервер отдаёт не больше limit строк, найденных по части номера
  const answer=async url=>({ items:rows.slice(0, Number(new URL(url, 'http://kp').searchParams.get('limit'))) });
  const was=[S.number, S.kpId];
  try {
    S.number='2026-100'; S.kpId='k6';
    const found=await swap([[Api, 'request', answer]], ()=>KpSaved.row());
    assert.strictEqual(found && found.id, 'k6');
  } finally { [S.number, S.kpId]=was; }
  let opened=null;
  await swap([[Api, 'request', answer], [KpTrack, 'open', row=>{ opened=row; }]],
    ()=>Reminders._act({ close(){} }, 'rs', { id:'k6', number:'2026-100', client:'ООО «А»' }));
  assert.strictEqual(opened && opened.status, 'sent', '«Ход сделки» — по строке журнала, а не по заглушке без статуса');
});

check('редактор правил компоновки: «плотно» больше «рекомендуется» у пары — понятная ошибка с названиями (было: TypeError из второго _label)', ()=>{
  const { LayoutEditor }=mod('features/rules-doc/layout-editor.js');
  const editor=Object.create(LayoutEditor.prototype);
  editor.work={ a:[1000, 800], t:700, m:{ service:{ min:1, max:2 }, pair:{ rows:[{ a:'other', b:'other', base:300, k:0, min:500 }] } } };
  assert.throws(()=>editor.build(), { message:'Пара Прочее ↔ Прочее: «плотно» больше «рекомендуется»' });
});

check('«Тарифы доставки», которые не загрузились, — сообщение вместо правки (сохранение заменило бы ставки встроенными)', async ()=>{
  const { Api }=mod('core/net.js');
  const { FreightSettings }=mod('features/deal/freight-settings.js');
  const { DealLogistics }=mod('features/deal/deal-logistics.js');
  const { LgState }=mod('features/deal/lg-state.js');
  const box={ innerHTML:'' };
  await swap([[Api, 'request', async ()=>{ throw new Error('сервер не отвечает'); }]], ()=>FreightSettings.open(box));
  assert.ok(box.innerHTML.includes('Тарифы доставки не загрузились: сервер не отвечает'), box.innerHTML);
  assert.strictEqual(LgState.failed, 'сервер не отвечает');
  await swap([[Api, 'request', async ()=>({})]], ()=>DealLogistics.reload());
  assert.strictEqual(LgState.failed, '', 'загрузились — правка снова доступна');
});

// окно Modal без браузера: поля — по селектору, press('data-ok') — щелчок по кнопке с этим атрибутом
const fakeDialog=fields=>{
  const listeners={};
  return {
    open:false, className:'', innerHTML:'',
    showModal(){ this.open=true; },
    close(){ this.open=false; for (const fn of listeners.close || []) fn(); },
    remove(){},
    addEventListener(type, fn){ (listeners[type] ||= []).push(fn); },
    querySelector:selector=>fields[selector] ?? null,
    press(attr){ for (const fn of listeners.click || []) fn({ target:{ closest:selector=>(selector===`[${attr}]` ? {} : null) } }); },
  };
};

check('«Проиграно» в своей воронке: причина из списка, своя причина, без причины — подсказка, «Отмена» — пусто', async ()=>{
  const { LostPick }=mod('features/crm/lost-pick.js');
  const { Toast }=mod('core/toast.js');
  const said=[];
  const run=async (fields, ...buttons)=>{
    const dialog=fakeDialog(fields);
    const saved=[document.createElement, document.body];
    document.createElement=()=>dialog; document.body={ appendChild(){} };
    try {
      return await swap([[Toast, 'show', text=>said.push(text)]], async ()=>{
        const answer=LostPick._reason({ title:'Сделка', lostReason:'' });
        for (const button of buttons) dialog.press(button);
        return answer;
      });
    } finally { [document.createElement, document.body]=saved; }
  };
  assert.strictEqual(await run({ 'input[name=lpR]:checked':{ value:'Высокая цена' }, '#lpO':{ value:'' } }, 'data-ok'), 'Высокая цена');
  assert.strictEqual(await run({ 'input[name=lpR]:checked':{ value:'Высокая цена' }, '#lpO':{ value:' Ушли к конкуренту ' } }, 'data-ok'), 'Ушли к конкуренту');
  assert.strictEqual(await run({ '#lpO':{ value:'' } }, 'data-ok', 'data-x'), '', 'без причины окно не закрылось, «Отмена» — пусто');
  assert.deepStrictEqual(said, ['Выберите или впишите причину']);
  await swap([[CrmFunnel, 'failures', ()=>[]], [LostPick, '_reason', async ()=>'Высокая цена']], async ()=>{
    assert.deepStrictEqual(await LostPick.ask({ funnel:'' }), { stage:'lost', lostReason:'Высокая цена' });
  });
  await swap([[CrmFunnel, 'failures', ()=>[]], [LostPick, '_reason', async ()=>'']], async ()=>{
    assert.strictEqual(await LostPick.ask({ funnel:'' }), null, '«Отмена» — сделка не закрывается');
  });
});

check('«Отдел»: «Регламент Битрикс24» и «Где тратится время» не загрузились — «Не загрузилось», а не «выключен» и «сделок нет»', async ()=>{
  const { Api }=mod('core/net.js');
  const { TeamRegs }=mod('features/crm/team-regs.js');
  const { TeamTime }=mod('features/crm/cab-team.js');
  const fail=async ()=>{ throw new Error('сервер не отвечает'); };
  for (const block of [TeamRegs, TeamTime]) { block.data=null; block.loading=false; }
  await swap([[Api, 'request', fail]], async ()=>{ await TeamRegs._load(); await TeamTime._load(); });
  assert.ok(TeamRegs._inner().includes('Не загрузилось: сервер не отвечает') && !TeamRegs._inner().includes('выключен'));
  assert.ok(TeamTime._body().includes('Не загрузилось: сервер не отвечает') && !TeamTime._body().includes('Сделок за полгода нет'));
  TeamRegs.data={ on:true, gaps:0, deals:3 };
  await swap([[Api, 'request', fail]], ()=>TeamRegs._load());
  assert.ok(TeamRegs._inner().includes('Все 3 открытых сделок'), 'прежние данные при сбое остаются');
  for (const block of [TeamRegs, TeamTime]) block.data=null;
});

check('«Настройки»: вкладка или панель не загрузилась — ошибка на месте «Загружаю…»; вход истёк — дальше, к окну входа', async ()=>{
  const { AdminNav }=mod('features/admin/admin-nav.js');
  const { AdminSession }=mod('core/net.js');
  const body={ innerHTML:'Загружаю…' };
  const was=AdminSession.on;
  try {
    AdminSession.on=true;
    assert.strictEqual(await AdminNav._fill(body, async ()=>{}), true);
    assert.strictEqual(await AdminNav._fill(body, async ()=>{ throw new Error('нет связи <b>'); }), false);
    assert.strictEqual(body.innerHTML, '<p class="msg err">нет связи &lt;b&gt;</p>');
    AdminSession.on=false;
    await assert.rejects(AdminNav._fill(body, async ()=>{ throw new Error('вход истёк'); }), { message:'вход истёк' });
  } finally { AdminSession.on=was; }
});

check('«Настройки» → поиск: найденный товар или КП, который не открылся, — сообщение (было: необработанный отказ)', async ()=>{
  const { SettingsSearch }=mod('features/admin/settings-tools.js');
  const { RecordEdit }=mod('features/admin/records-tab.js');
  const { Toast }=mod('core/toast.js');
  const said=[];
  const entry=SettingsSearch._record({ row:{ id:'c1', title:'Компрессор' }, type:'catalog', kind:'Каталог', tab:'goods', query:'комп' });
  await swap([[RecordEdit, 'open', async ()=>{ throw new Error('Позиция не найдена'); }], [Toast, 'show', text=>said.push(text)]],
    ()=>entry.open());
  assert.deepStrictEqual(said, ['Не открылось: Позиция не найдена']);
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
