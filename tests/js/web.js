// Загрузка файлов интерфейса в проверках: обычные скрипты — в общий контекст (как в браузере), ES-модули — через require
// (их классы попадают в globalThis мостом модуля).
'use strict';
const vm=require('vm'), fs=require('fs');

class WebScripts {
  static ESM=/^(?:import|export)\s/m;

  static load(file){
    const text=fs.readFileSync(file, 'utf8');
    if (WebScripts.ESM.test(text)) require(file);
    else vm.runInThisContext(text, { filename:file });
  }
}

module.exports=WebScripts;
