// Вызовы «Класс.метод(…)» импортированных классов интерфейса: метод должен быть у самого класса. Метод, который убрали
// или переименовали при переписывании, а вызов остался, — падение кнопки у пользователя (аудит 30.10: DealCard.lostReason —
// «Проиграно» в своей воронке, RecordsTab.open — запись из поиска «Настроек»).
// Запуск из корня репозитория: node tests/js/static_calls.js — код выхода 0, если всё прошло (tests/test_static_calls.py).
'use strict';
const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname, '..', '..');
const JS=path.join(ROOT, 'app', 'web', 'js');
global.document={ addEventListener(){} };
const WebScripts=require('./web.js');
WebScripts.load(path.join(JS, 'core', 'str.js'));

const ESM=/^(?:import|export)\s/m;
const IMPORT=/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm;
const isClass=value=>typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));

const missing=[];
const broken=[];
let checked=0;
for (const file of WebScripts.files(JS)){
  const text=fs.readFileSync(file, 'utf8');
  if (!ESM.test(text)) continue;
  const where=path.relative(ROOT, file).split(path.sep).join('/');
  for (const [, names, from] of text.matchAll(IMPORT)){
    let mod;
    try { mod=require(path.resolve(path.dirname(file), from)); } catch (e){ broken.push(`${where}: ${from} — ${e.message}`); continue; }
    for (const part of names.split(',')){
      const [name, alias]=part.trim().split(/\s+as\s+/);
      const cls=name && mod[name.trim()];
      if (!isClass(cls)) continue;
      const local=(alias || name).trim();
      for (const [, member] of text.matchAll(new RegExp(`(?<![\\w$.])${local}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))){
        checked++;
        if (typeof cls[member] !== 'function') missing.push(`${where}: ${local}.${member}() — у класса нет такого метода`);
      }
    }
  }
}
const bad=[...broken, ...new Set(missing)];
if (bad.length){
  console.error(bad.join('\n'));
  process.exitCode=1;
} else console.log(`OK: вызовов методов классов проверено ${checked}`);
