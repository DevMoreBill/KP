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
require('./web.js').load(path.join(JS, 'features', 'deal', 'index.js')); // части окна экономики перерисовывают его через DealLink — окно подключает себя
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

check('заготовка — без сделки (и заготовки прежних версий); «Копия» и «Сменить клиента» — сделка прежнего клиента не уходит к другому', async ()=>{
  assert.ok(Presets.DROP.includes('dealId'));
  assert.ok(KpRepeat.DROP.includes('dealId'), 'как у «Повторить КП»');
  const stripped=Presets._strip({ dealId:'deal-7', client:'ООО «А»', items:[{ id:'i1' }] });
  assert.ok(!('dealId' in stripped) && !('client' in stripped) && stripped.items.length===1, 'старая заготовка со сделкой — без неё');
  const cleared=(dealId, client, inn)=>{
    const state={ client:'ООО «А»', clientInn:'7700000001', dealId };
    ClientFields.clear(state);
    Object.assign(state, { client, clientInn:inn });
    return state;
  };
  const settled=state=>{ ClientFields.settleDeal(state); return state.dealId; };
  const state=cleared('deal-7', '', '');
  assert.strictEqual(state.dealId, 'deal-7', 'очистка клиента сделку не трогает (как до 3.226.4)');
  assert.strictEqual(settled(state), 'deal-7', 'клиент ещё не выбран — решение откладывается');
  assert.ok(state._dealFor, '…и отметка остаётся');
  assert.strictEqual(settled(cleared('deal-7', 'ООО «Б»', '7700000002')), undefined, 'другой клиент — сделка прежнего не остаётся');
  assert.strictEqual(settled(cleared('deal-7', 'ООО «А»', '7700000001')), 'deal-7', 'тот же клиент (ИНН) — как было, и закрытая сделка');
  assert.strictEqual(settled(cleared('deal-7', 'ооо а', '')), 'deal-7', 'тот же клиент без ИНН — по названию');
  const picked=cleared('deal-7', 'ООО «Б»', '7700000002');
  picked.dealId='deal-9';
  assert.strictEqual(settled(picked), 'deal-9', 'сделку выбрали в списке — остаётся');
  assert.strictEqual(settled(cleared('new', 'ООО «Б»', '7700000002')), 'new', '«Отдельная новая сделка» — остаётся');
  const twice=cleared('deal-7', 'ООО «Б»', '7700000002');
  ClientFields.clear(twice);
  Object.assign(twice, { client:'ООО «А»', clientInn:'7700000001' });
  assert.strictEqual(settled(twice), 'deal-7', '«Сменить клиента» дважды и снова прежний — сделка его');
  const fromCard={ client:'ООО «А»', clientInn:'7700000001', dealId:'deal-won' };
  assert.strictEqual(settled(fromCard), 'deal-won', '«＋ Новое КП» из карточки сделки (и закрытой) — без «Копии» не трогается');
  // сохранение КП: решение — до записи состояния КП на сервер (иначе в журнале осталась бы сделка прежнего клиента и
  // следующее сохранение КП из журнала перенесло бы его туда)
  const { KpSave }=mod('features/doc/kp-save.js');
  const { PriceGuard }=mod('features/kp/price-guard.js');
  const { StationImages }=mod('features/station/station-images.js');
  const { MgrLock, Managers }=mod('features/kp/managers.js');
  const { KpDocx }=mod('features/doc/kp-docx.js');
  const { KpFile }=mod('features/doc/kp-file.js');
  const { Drafts }=mod('features/kp/drafts.js');
  let journaled='не дошло';
  const was={ dealId:S.dealId, client:S.client, clientInn:S.clientInn, kpId:S.kpId, managerId:S.managerId, paused:Drafts.paused };
  try {
    Object.assign(S, { dealId:'deal-7', client:'ООО «А»', clientInn:'7700000001', kpId:'k1', managerId:'m1' });
    ClientFields.clear(S);
    Object.assign(S, { client:'ООО «Б»', clientInn:'7700000002' });
    await swap([
      [PriceGuard, 'confirm', async ()=>true], [StationImages, 'syncAll', async ()=>{}], [StationImages, 'confirmSave', ()=>true],
      [MgrLock, 'apply', ()=>{}], [MgrLock, 'locked', ()=>false], [KpDocx, 'state', ()=>({})], [KpDocx, 'render', async ()=>null],
      [KpSave, '_pack', async ()=>({ settings:{} })], [KpSave, '_number', async ()=>{}], [KpSave, '_uploadImages', async ()=>{}],
      [Managers, 'meId', ()=>'m1'], [KpState, 'totals', ()=>({})], [KpFile, 'name', ()=>'КП.docx'],
      [KpSave, '_journal', async ()=>{ journaled=Drafts.clean().dealId; throw new Error('стоп после записи состояния'); }],
    ], ()=>assert.rejects(KpSave._save({ textContent:'' }), { message:'стоп после записи состояния' }));
    assert.strictEqual(journaled, undefined, 'в состоянии КП, которое уходит в журнал, нет сделки прежнего клиента');
  } finally {
    Object.assign(S, { dealId:was.dealId, client:was.client, clientInn:was.clientInn, kpId:was.kpId, managerId:was.managerId });
    Drafts.paused=was.paused;
    delete S._dealFor;
  }
});

check('сохранение КП: сделка, которую назначил сервер, — не правка менеджера (было: ложное «Изменения … не вошли» и КП «не сохранено»)', async ()=>{
  const { KpSave }=mod('features/doc/kp-save.js');
  const { Api }=mod('core/net.js');
  const { Toast }=mod('core/toast.js');
  const { Drafts }=mod('features/kp/drafts.js');
  const said=[];
  const states=[];
  const run=async ({ deal, edit, dealEdit })=>{
    said.length=0;
    states.length=0;
    await swap([
      [mod('features/kp/price-guard.js').PriceGuard, 'confirm', async ()=>true],
      [mod('features/station/station-images.js').StationImages, 'syncAll', async ()=>{}],
      [mod('features/station/station-images.js').StationImages, 'confirmSave', ()=>true],
      [mod('features/kp/managers.js').MgrLock, 'apply', ()=>{}], [mod('features/kp/managers.js').MgrLock, 'locked', ()=>false],
      [mod('features/kp/managers.js').Managers, 'meId', ()=>'m1'],
      [mod('features/doc/kp-docx.js').KpDocx, 'state', ()=>({})], [mod('features/doc/kp-docx.js').KpDocx, 'render', async ()=>null],
      [mod('features/doc/kp-file.js').KpFile, 'name', ()=>'КП.docx'],
      [mod('features/catalog/catalog-fill.js').CatalogSync, 'run', async ()=>{}], [ClientStore, 'saveUsed', async ()=>{}],
      [KpSave, '_pack', async ()=>({ settings:{} })], [KpSave, '_number', async ()=>{}], [KpSave, '_uploadImages', async ()=>{}],
      [KpSave, '_putDocx', async ()=>{ if (edit) S.client='ООО «Правка во время сохранения»'; if (dealEdit) S.dealId=dealEdit; return {}; }],
      [KpSave, '_metaBody', ()=>({})], [KpSave, '_pdf', async ()=>null], [KpSave, '_done', ()=>{}],
      [mod('core/cond-memory.js').CondMemory, 'remember', ()=>{}], [KpState, 'persist', ()=>{}], [KpState, 'totals', ()=>({})],
      [FormView, 'render', ()=>{}], [Toast, 'show', text=>said.push(text)],
      [Api, 'request', async (url, opts)=>{ if (url.includes('/state')) states.push(JSON.parse(opts.body)); return url.includes('/meta') ? { ok:true, deal } : { rev:1 }; }],
    ], ()=>KpSave._save({ textContent:'' }));
  };
  const was={ dealId:S.dealId, client:S.client, kpId:S.kpId, number:S.number, managerId:S.managerId, paused:Drafts.paused };
  try {
    Object.assign(S, { kpId:'k1', number:'2026-001', client:'ООО «Новый»', managerId:'m1' });
    delete S.dealId;
    await run({ deal:'d-new' });
    assert.deepStrictEqual(said, [], 'новое КП: сервер создал сделку — ложного сообщения нет');
    assert.strictEqual(S.dealId, 'd-new');
    assert.strictEqual(Drafts.base, Drafts.sig(Drafts.clean()), '…и КП не числится несохранённым');
    await run({ deal:'d-new' });
    assert.deepStrictEqual(said, [], 'та же сделка — как было');
    await run({ deal:'d-new', edit:true });
    assert.deepStrictEqual(said, ['Изменения, сделанные во время сохранения, в КП не вошли — сохраните КП ещё раз'], 'правка во время сохранения — сообщение, как было');
    assert.notStrictEqual(Drafts.base, Drafts.sig(Drafts.clean()), '…и правка остаётся несохранённой');
    Object.assign(S, { client:'ООО «Новый»', dealId:'d-new' });
    await run({ deal:'d2', dealEdit:'d2' });
    assert.deepStrictEqual(said, ['Изменения, сделанные во время сохранения, в КП не вошли — сохраните КП ещё раз'], 'другую сделку выбрали в списке во время сохранения — правка (в журнале прежняя)');
    assert.notStrictEqual(Drafts.base, Drafts.sig(Drafts.clean()), '…и КП числится несохранённым до следующего сохранения');
    S.dealId='new';
    await run({ deal:'d1' });
    assert.deepStrictEqual(states.map(state=>state.dealId), ['new', 'd1'], '«Отдельная новая сделка»: в журнал ещё раз — уже с созданной сделкой');
    assert.deepStrictEqual(said, []);
    assert.strictEqual(Drafts.base, Drafts.sig(Drafts.clean()));
    S.dealId='new';
    await run({ deal:'d3', edit:true });
    assert.strictEqual(states.length, 1, 'с правкой во время сохранения — без повторной записи, сообщение');
    assert.strictEqual(said.length, 1);
    states.length=0;
    await run({ deal:'d-new' });
    assert.strictEqual(states.length, 1, 'обычное сохранение — одна запись в журнал, как было');
  } finally {
    Object.assign(S, { dealId:was.dealId, client:was.client, kpId:was.kpId, number:was.number, managerId:was.managerId });
    Drafts.paused=was.paused;
  }
});

check('строка журнала по номеру — седьмой среди похожих номеров («КП сохранено», «Ход сделки» из напоминаний; было: первые 5 и 1)', async ()=>{
  const { Api }=mod('core/net.js');
  const { KpSaved }=mod('features/doc/kp-saved.js');
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
  const { WorkCalendar, DatePicker }=mod('core/date-picker.js');
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
  const { AdminApi }=mod('core/admin-api.js');
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
  const { AdminApi }=mod('core/admin-api.js');
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
  const { AdminApi }=mod('core/admin-api.js');
  const { AdminState }=mod('features/admin/admin-state.js');
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
