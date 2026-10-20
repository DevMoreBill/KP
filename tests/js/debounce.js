// Задержка ввода (app/web/js/core/debounce.js, Debounce): одна на всю программу — поиск в журнале, каталоге, кабинете, клиентах,
// настройках. Повторный вызов откладывает, срабатывает один раз последним; своя задержка; отмена. И что самодельных
// таймеров поиска (clearTimeout + setTimeout на вводе) в этих окнах больше нет.
// Запуск из корня репозитория: node tests/js/debounce.js — код выхода 0, если всё прошло (tests/test_deal_logistics.py).
'use strict';
const fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), JS=f=>fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', f), 'utf8');
const { Debounce }=require(path.join(ROOT, 'app', 'web', 'js', 'core', 'debounce.js'));   // ES-модуль

const wait=ms=>new Promise(r=>setTimeout(r, ms));
(async ()=>{
  const got=[], d=new Debounce(30);
  for (const v of [1, 2, 3]){ d.run(()=>got.push(v)); await wait(5); }
  assert.ok(d.pending, 'ждёт'); await wait(60);
  assert.deepStrictEqual(got, [3], 'один раз, последним'); assert.ok(!d.pending);
  d.run(()=>got.push(4), 5); await wait(25); assert.deepStrictEqual(got, [3, 4], 'своя задержка');
  d.run(()=>got.push(5)).cancel(); await wait(50); assert.deepStrictEqual(got, [3, 4], 'отмена');
  for (const f of ['features/kp/journal.js', 'features/catalog/trash-tab.js', 'features/admin/defaults-tab.js', 'features/kp/quick-search.js', 'features/kp/client-find.js', 'features/admin/lists-panel.js', 'features/admin/settings-tools.js', 'features/crm/cabinet.js']){
    const own=JS(f).match(/clearTimeout\([^)]*\);\s*[\w.$]+=setTimeout\(/g); assert.ok(!own, f+': свой таймер ввода мимо Debounce: '+own); }
  console.log('Debounce: проверки пройдены');
})().catch(e=>{ console.error('ОШИБКА — '+(e && e.stack || e)); process.exitCode=1; });
