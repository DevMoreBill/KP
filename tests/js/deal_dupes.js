// Дубли сделок на «Сегодня» (features/crm/today-dupes.js), окно «Объединить сделки» и Битрикс24 (deal-merge.js),
// «Выровнять все» в «Расхождениях с Битрикс24» (features/admin/bitrix-diff.js) — 3.274.0.
// Запуск из корня репозитория: node tests/js/deal_dupes.js — код выхода 0, если всё прошло (tests/test_deal_dupes_js.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(JS, 'features', 'crm', 'index.js'));
require('./web.js').load(path.join(JS, 'features', 'admin', 'index.js'));

const swap=async (pairs, fn)=>{
  const saved=pairs.map(([owner, name])=>[owner, name, owner[name]]);
  for (const [owner, name, value] of pairs) owner[name]=value;
  try { return await fn(); } finally { for (const [owner, name, value] of saved) owner[name]=value; }
};
const checks=[];
const check=(name, fn)=>checks.push([name, fn]);
const deal=(id, number)=>({ id, number, title:'Сделка '+number, stage:'lead', funnel:'main', sum:100, kps:1, last:'2026-11-01', created:'2026-10-01' });
const GROUP={ client:'ООО «Альфа»', inn:'7700000001', manager:'Иванова', managerId:'m1', target:'d15',
  deals:[deal('d15', 15), deal('d12', 12), deal('d18', 18)] };

check('«Сегодня»: группа «Дубли» — клиент, номера, «Объединить в № итоговой», счёт в «Что сделать»', ()=>{
  TodayDupes.groups=[GROUP];
  const html=TodayDupes.html(6);
  assert.ok(html.includes('Дубли: у клиента несколько сделок'), html);
  assert.ok(html.includes('<b class="md-c">1</b>'));
  assert.ok(html.includes('ООО «Альфа»') && html.includes('3 сделки: № 15, № 12, № 18'));
  assert.ok(html.includes('data-tdm="0"') && html.includes('Объединить в № 15'));
  assert.ok(html.includes('data-deal="d15"'), 'название открывает итоговую');
  assert.strictEqual(TodayDupes.count(), 1);
  return swap([[CabToday, '_now', ()=>[]], [MyPrefs, 'limit', (key, base)=>base]], ()=>{
    const todo=CabToday._todo();
    assert.ok(todo.includes('Что сделать <b class="md-c">1</b>'), 'дубли — в счёте «Что сделать»');
    assert.ok(!todo.includes('Всё сделано'), 'есть дубли — не «всё сделано»');
  });
});

check('больше строк, чем показывать, — «и ещё N»; нажато — все', ()=>{
  TodayDupes.groups=Array.from({length:4}, (_, i)=>({ ...GROUP, client:'Клиент '+i }));
  TodayDupes.wide=false;
  const html=TodayDupes.html(2);
  assert.strictEqual((html.match(/data-tdm=/g) || []).length, 2);
  assert.ok(html.includes('и ещё 2 — показать все'));
  TodayDupes.wide=true;
  assert.strictEqual((TodayDupes.html(2).match(/data-tdm=/g) || []).length, 4);
  TodayDupes.wide=false;
});

check('выключено (или без «Объединить сделки») — группы нет и не загружается', async ()=>{
  TodayDupes.groups=[GROUP];
  FEAT.vals={ todayDupes:false };
  assert.strictEqual(TodayDupes.html(6), '');
  assert.strictEqual(TodayDupes.count(), 0);
  FEAT.vals={ dealMerge:false };
  assert.strictEqual(TodayDupes.html(6), '', 'работает только вместе с «Объединить сделки»');
  let asked=0;
  await swap([[Api, 'request', async ()=>{ asked++; return { groups:[GROUP] }; }]], ()=>TodayDupes.load());
  assert.strictEqual(asked, 0);
  assert.deepStrictEqual(TodayDupes.groups, []);
  FEAT.vals={};
});

check('загрузка: кабинет менеджера — его дубли; весь отдел — нет; ошибка — без группы', async ()=>{
  const urls=[];
  const api=async url=>{ urls.push(url); return { groups:[GROUP] }; };
  await swap([[Api, 'request', api]], async ()=>{
    CrmData.who='m2';
    await TodayDupes.load();
    assert.deepStrictEqual(urls, ['/api/crm/dupes/mine?manager=m2']);
    assert.strictEqual(TodayDupes.groups.length, 1);
    CrmData.who='all';
    await TodayDupes.load();
    assert.strictEqual(urls.length, 1, 'весь отдел — «Отдел» → «Дубли сделок»');
    assert.deepStrictEqual(TodayDupes.groups, []);
  });
  CrmData.who='';
  await swap([[Api, 'request', async ()=>{ throw new Error('нет связи'); }]], ()=>TodayDupes.load());
  assert.deepStrictEqual(TodayDupes.groups, []);
});

check('«Объединить в № …» — окно в итоговую с отмеченными остальными (и из «Отдела»)', async ()=>{
  const opened=[];
  await swap([[DealMerge, 'open', (target, done, marked)=>opened.push([target.id, target.client, target.clientInn, marked])]], ()=>{
    TodayDupes.groups=[GROUP];
    const handled=TodayDupes.click({ target:{ closest:sel=>sel==='[data-tdm]' ? { dataset:{ tdm:'0' } } : null } });
    assert.ok(handled);
    TeamDupes.data={ groups:[GROUP] };
    TeamDupes.merge({ dataset:{ tdmerge:'0' } });
  });
  assert.deepStrictEqual(opened, [['d15', 'ООО «Альфа»', '7700000001', ['d12', 'd18']], ['d15', 'ООО «Альфа»', '7700000001', ['d12', 'd18']]]);
});

check('окно «Объединить сделки»: Битрикс24 — лишние сделки закроются проигранными; выключено — «не удаляются»; связи нет — ни слова', ()=>{
  const view=bitrix=>({ deal:{ id:'d15', number:15, title:'Станция' }, items:[], stages:[], found:[], marked:new Set(), bitrix });
  assert.ok(DealMerge._html(view(true)).includes('В Битрикс24 лишние сделки закроются проигранными: «Объединена со сделкой № 15»'));
  FEAT.vals={ dealMergeBx:false };
  assert.ok(DealMerge._html(view(true)).includes('В Битрикс24 сделки не удаляются.'));
  FEAT.vals={};
  assert.ok(!DealMerge._html(view(false)).includes('Битрикс24'));
});

check('«Расхождения»: «Выровнять все (N)» — от двух сделок; все в очереди — «Отправить сейчас»; выключено — нет', ()=>{
  const row=id=>({ deal:id, title:'Сделка '+id, manager:'Иванова', diffs:[{ field:'sum', label:'сумма', program:10, bitrix:7 }] });
  BitrixDiffCard.report={ rows:[row('d1'), row('d2')], checked:5 };
  BitrixDiffCard.queued=new Set();
  let html=BitrixDiffCard.html(true);
  assert.ok(html.includes('data-bxdiff="all"') && html.includes('Выровнять все (2)'), html);
  BitrixDiffCard.queued=new Set(['d1']);
  html=BitrixDiffCard.html(true);
  assert.ok(html.includes('Выровнять все (1)') && html.includes('✓ В очереди'), 'выровненная — отметкой');
  BitrixDiffCard.queued=new Set(['d1', 'd2']);
  html=BitrixDiffCard.html(true);
  assert.ok(html.includes('data-bxdiff="send"') && html.includes('✓ В очереди: 2'));
  FEAT.vals={ bxDiffAll:false };
  assert.ok(!BitrixDiffCard.html(true).includes('data-bxdiff="all"') && !BitrixDiffCard.html(true).includes('data-bxdiff="send"'));
  FEAT.vals={};
  BitrixDiffCard.report={ rows:[row('d1')], checked:1 };
  BitrixDiffCard.queued=new Set();
  assert.ok(!BitrixDiffCard.html(true).includes('Выровнять все'), 'одна сделка — своей кнопкой');
});

check('«Выровнять все»: подтверждение → сделки списка в очередь; «Отправить сейчас» — обмен и новая проверка', async ()=>{
  const row=id=>({ deal:id, title:id, manager:'', diffs:[] });
  BitrixDiffCard.report={ rows:[row('d1'), row('d2')], checked:2 };
  BitrixDiffCard.queued=new Set();
  const posts=[];
  let redraws=0, kept=null;
  const host={ redraw:()=>{ redraws++; }, keep:reply=>{ kept=reply; } };
  const post=async (sub, body)=>{
    posts.push([sub, body]);
    if (sub==='bitrix/diff/align-all') return { ok:true, queued:body.deals.length };
    if (sub==='bitrix/run') return { on:true, result:{ sent:2 } };
    return { rows:[], checked:2 };
  };
  await swap([[AdminDialog, 'confirm', async ()=>null], [AdminApi, 'post', post], [Toast, 'show', ()=>{}]], ()=>BitrixDiffCard._alignAll(host));
  assert.strictEqual(posts.length, 0, '«Отмена» — ничего не отправлено');
  await swap([[AdminDialog, 'confirm', async ()=>'1'], [AdminApi, 'post', post], [Toast, 'show', ()=>{}]], ()=>BitrixDiffCard._alignAll(host));
  assert.deepStrictEqual(posts, [['bitrix/diff/align-all', { deals:['d1', 'd2'] }]]);
  assert.deepStrictEqual([...BitrixDiffCard.queued], ['d1', 'd2']);
  const button={ disabled:false, textContent:'' };
  await swap([[AdminApi, 'post', post], [Toast, 'show', ()=>{}]], ()=>BitrixDiffCard._send(button, host));
  assert.deepStrictEqual(posts.slice(1).map(([sub])=>sub), ['bitrix/run', 'bitrix/diff']);
  assert.deepStrictEqual(kept, { on:true, result:{ sent:2 } }, 'состояние связи — вкладке');
  assert.deepStrictEqual(BitrixDiffCard.report.rows, []);
  assert.strictEqual(BitrixDiffCard.queued.size, 0, 'новая проверка — новая очередь отметок');
  assert.ok(redraws>=2);
});

(async ()=>{
  let failed=0;
  for (const [name, fn] of checks) {
    try { FEAT.vals={}; await fn(); } catch (error) { failed++; console.error('ОШИБКА — '+name+':\n'+(error && error.stack || error)); }
  }
  console.log(`Проверок: ${checks.length}, ошибок: ${failed}`);
  process.exitCode=failed ? 1 : 0;
})();
