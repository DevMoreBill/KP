// Своё расположение разделов кабинета (features/crm/cab-layout.js): сохранённое поверх умолчания, новые разделы — в свою
// колонку, исчезнувшие — не показываются, скрытые — вне колонок, выключатель cabLayout.
// Запуск из корня репозитория: node tests/js/cab_layout.js — код выхода 0, если всё прошло (tests/test_cab_layout.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'crm', 'index.js'));

let n=0;
const check=(name, fn)=>{ try{ FEAT.vals={}; MyPrefs.prefs={}; CabLayout._local={}; fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };
const KEYS=['todo', 'reminders', 'week', 'month', 'funnel', 'drafts'];

check('без своего — как в программе', ()=>{
  const layout=CabLayout.of('today', KEYS);
  assert.deepStrictEqual(layout.cols, {l:['todo', 'reminders'], r:['week', 'month', 'funnel', 'drafts']});
  assert.strictEqual(layout.ratio, 0.62);
});

check('своё: порядок и колонки, новые — в свою колонку, лишние — нет', ()=>{
  MyPrefs.prefs={cabLayout:{today:{cols:{l:['week', 'todo', 'gone'], r:['month']}, ratio:0.5, h:{todo:300}, hide:['funnel']}}};
  const layout=CabLayout.of('today', KEYS);
  assert.deepStrictEqual(layout.cols, {l:['week', 'todo', 'reminders'], r:['month', 'funnel', 'drafts']});
  assert.deepStrictEqual([layout.ratio, layout.h, layout.hide], [0.5, {todo:300}, ['funnel']]);
  const html=CabLayout.html('today', Object.fromEntries(KEYS.map(key=>[key, `<section>${key}</section>`])));
  assert.ok(!html.includes('data-cl="funnel"') && html.includes('Скрыто: Воронка'), 'скрытый — вне колонок, с «Показать все»');
  assert.ok(html.includes('data-cl="todo" style="height:300px"'), 'своя высота');
});

check('раздела нет сейчас — его места нет', ()=>{
  const layout=CabLayout.of('today', ['todo', 'week']);
  assert.deepStrictEqual(layout.cols, {l:['todo'], r:['week']});
});

check('скрыть и показать — в личных настройках', ()=>{
  let saved=null;
  MyPrefs.remember=patch=>{ saved=patch; };
  CabLayout._saving={ run: task=>task() };
  CabLayout.show('today', 'week', false);
  assert.deepStrictEqual(saved.cabLayout.today.hide, ['week']);
  CabLayout.show('today', 'week', true);
  assert.deepStrictEqual(saved.cabLayout.today.hide, []);
  CabLayout.reset('today');
  assert.deepStrictEqual(saved.cabLayout, {});
});

check('карточка сделки: сводка во всю ширину над колонками, вкладки слева, «Что сделать» и лента справа; своё — поверх', ()=>{
  const parts={sum:'<section>s</section>', now:'<section>n</section>', main:'<div>m</div>', feed:'<section>f</section>'};
  assert.deepStrictEqual(CabLayout.of('deal', ['now', 'main', 'feed']).cols, {l:['main'], r:['now', 'feed']});
  const own=DealLayout.html(parts, {feedTab:false});
  assert.ok(own.includes('data-clpage="deal"'));
  assert.ok(own.startsWith('<section>s</section>') && !own.includes('data-cl="sum"'), 'сводка — не раздел колонки, а над ними');
  assert.ok(DealLayout.html(parts, {feedTab:true}).startsWith('<section>s</section>'));
  assert.ok(DealLayout.html(parts, {feedTab:true}).includes('dk-cols'), 'лента вкладкой (телефон) — как в программе');
  FEAT.vals={dealLayout:false};
  assert.ok(!DealLayout.html(parts, {feedTab:false}).includes('lay-g'), 'выключено — как в программе');
});

check('«⤢» — раздел на весь экран, повторно — обратно; выключено — кнопки нет', ()=>{
  const parts={todo:'<section>t</section>', week:'<section>w</section>'};
  assert.ok(CabLayout.html('today', parts).includes('data-clmax="todo"'));
  CabLayout._full='todo';
  assert.ok(CabLayout.html('today', parts).includes('lay-s lay-full" data-cl="todo"'));
  CabLayout._full='';
  FEAT.vals={cabExpand:false};
  assert.ok(!CabLayout.html('today', parts).includes('data-clmax'));
});

check('выключено — своего расположения нет', ()=>{
  FEAT.vals={cabLayout:false};
  assert.strictEqual(CabLayout.enabled(), false);
});

if (!process.exitCode) console.log(`cab_layout: ${n} проверок — OK`);
