// Загрузка файлов интерфейса в проверках: ES-модули — через require (зависимости подключают сами через import),
// обычные скрипты (docx/kpgen.js) — в общий контекст, как в браузере. Для удобства проверок классы всех модулей
// доступны по имени (WebScripts.expose: модуль подключается при первом обращении к имени) — только в проверках, в
// программе общих имён нет. Минимальное окружение браузера (document, matchMedia, localStorage) — если проверка не
// задала своё.
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path');
const JS=path.resolve(__dirname, '..', '..', 'app', 'web', 'js');

class WebScripts {
  static ESM=/^(?:import|export)\s/m;
  static EXPORT=/^export (?:class|const|let|function) (\w+)/gm;
  static exposed=false;

  static load(file){
    WebScripts.browser();
    WebScripts.expose();
    // версия программы в отпечатке станции — пустая: слепки не зависят от номера выпуска (как раньше в Node)
    require(path.join(JS, 'features', 'help.js')).AppVersion.current='';
    const text=fs.readFileSync(file, 'utf8');
    if (WebScripts.ESM.test(text)) return require(file);
    vm.runInThisContext(text, { filename:file });
    return null;
  }

  static browser(){
    const g=global;
    g.window??=g;
    g.document??={};
    for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) g.document[k]??=()=>{};
    for (const k of ['querySelector', 'getElementById']) g.document[k]??=()=>null;
    g.document.querySelectorAll??=()=>[];
    g.document.documentElement??={ dataset:{}, style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false } };
    g.addEventListener??=()=>{};
    g.matchMedia??=()=>({ matches:false, addEventListener(){}, removeEventListener(){} });
    if (!g.localStorage){ const m=new Map(); g.localStorage={ get length(){ return m.size; }, key:i=>[...m.keys()][i] ?? null, getItem:k=>(m.has(k) ? m.get(k) : null), setItem:(k, v)=>m.set(k, String(v)), removeItem:k=>m.delete(k) }; }
    if (!g.KPGen) vm.runInThisContext(fs.readFileSync(path.join(JS, 'docx', 'kpgen.js'), 'utf8'), { filename:'kpgen.js' });
  }

  static expose(){
    if (WebScripts.exposed) return;
    WebScripts.exposed=true;
    for (const file of WebScripts.files(JS)){
      if (/[\\/](docx|boot\.js)/.test(file) || file.endsWith('index.js')) continue;
      for (const [, name] of fs.readFileSync(file, 'utf8').matchAll(WebScripts.EXPORT)){
        if (name in global) continue;
        Object.defineProperty(global, name, { get:()=>require(file)[name], configurable:true });
      }
    }
  }

  static files(dir){
    return fs.readdirSync(dir, { withFileTypes:true }).flatMap(e=>(e.isDirectory() ? WebScripts.files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  }
}

module.exports=WebScripts;
