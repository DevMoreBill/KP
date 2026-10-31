// Картинки станций перед предпросмотром и сохранением КП (features/station/station-images.js, StationImages.syncAll):
// пересборка, идущая в фоне, сначала заканчивается — занятая станция не пропускается (было: в КП уходили прежние картинки,
// новые приходили после сохранения, и КП сразу числилось изменённым); отложенная пересборка отменяется — собирает syncAll.
// Запуск из корня репозитория: node tests/js/station_images.js — код выхода 0, если всё прошло (tests/test_station_layout.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'station', 'station-images.js'));

(async()=>{
  const item={ id:'st1', name:'Станция' };
  KpState.replace(Object.assign(KpState.fresh(), { items:[item] }));
  const synced=[];
  StationImages.sync=async one=>{ synced.push(one.id); return false; };

  StationImages.busy.add(item.id);
  let done=false;
  const all=StationImages.syncAll().then(()=>{ done=true; });
  await new Promise(resolve=>setTimeout(resolve, 300));
  assert.strictEqual(done, false, 'станция пересобирается в фоне — syncAll ждёт');
  assert.deepStrictEqual(synced, [], 'пока станция занята, своя пересборка не начинается');
  StationImages.busy.delete(item.id);
  await all;
  assert.deepStrictEqual(synced, ['st1'], 'после фоновой — пересборка станции по текущему составу');

  StationImages.soon(item);
  assert.strictEqual(StationImages.timers.size, 1, 'отложенная пересборка поставлена');
  await StationImages.syncAll();
  assert.strictEqual(StationImages.timers.size, 0, 'отложенная пересборка отменена — собирает syncAll');
  console.log('StationImages: проверки пройдены');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
