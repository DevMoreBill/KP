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

check('выключено — своего расположения нет', ()=>{
  FEAT.vals={cabLayout:false};
  assert.strictEqual(CabLayout.enabled(), false);
});

if (!process.exitCode) console.log(`cab_layout: ${n} проверок — OK`);
