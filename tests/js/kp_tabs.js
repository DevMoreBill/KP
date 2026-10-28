// Вкладки КП (features/kp/kp-tabs.js, KpTabs): переключение не начинается, пока КП сохраняется в журнал — и пока идёт
// сборка файла, до паузы черновика (аудит FE-007: иначе ответы сохранения дописывались бы в другое КП).
// Запуск из корня репозитория: node tests/js/kp_tabs.js — код выхода 0, если всё прошло (tests/test_deal_logistics.py).
'use strict';
const path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'kp', 'kp-tabs.js'));

let shown='';
Toast.show=text=>{ shown=text; };
assert.strictEqual(KpTabs._free(), true, 'ничего не сохраняется — можно');
KpSave.busy=true;
assert.strictEqual(KpTabs._free(), false, 'сборка файла КП — нельзя');
assert.ok(/сохраняется/.test(shown), shown);
KpSave.busy=false;
console.log('KpTabs: проверки пройдены');
