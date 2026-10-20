// Списки и выборы: варианты выпадающих меню и подсказок, которые администратор правит в «Настройках → Списки и выборы»
// (сервер: app/lists.py, kv settings.lists = {ключ: [строки]}). Каждый список — ListDef: где он живёт в программе
// (target — массив, которым пользуются формы), как строка массива превращается в строку таблицы и обратно, какие у неё поля.
// Встроенный вариант запоминается при запуске; свой вариант администратора подменяет содержимое массива на месте,
// поэтому формы, мастер и расчёты сразу видят новые пункты. Последний вариант с сервера хранится в браузере.
'use strict';

class ListDef {
  /** o: {key, group, label, hint, cols:[[поле, подпись, тип('text'|'area'|'num'), {req, id, ph}]], target:()=>массив,
   *      toRow:(элемент)=>строка, fromRow:(строка)=>элемент | null, min — меньше строк нельзя} */
  /** late — массив объявлен в ES-модуле (загружается позже): встроенный вариант запоминается в LISTS.ready */
  constructor(o){ Object.assign(this, { hint:'', min:1, late:false }, o); this.builtin = this.late ? null : this.read(); }
  read(){ return this.target().map(x=>this.toRow(x)); }
  apply(rows){ const arr=this.target(), items=(rows||this.builtin).map(r=>this.fromRow(r)).filter(x=>x!=null);
    if (items.length >= this.min) arr.splice(0, arr.length, ...items); }
  /** проверка перед сохранением: пустая строка — ошибка; поле-идентификатор — латиница, без повторов */
  validate(rows){
    if (rows.length < this.min) return `Нужно хотя бы ${this.min} ${plural(this.min,'значение','значения','значений')}`;
    for (const [f, label, type, o={}] of this.cols){
      for (const [i, r] of rows.entries()){ const v=String(r[f]??'').trim();
        if (o.req && !v) return `Строка ${i+1}: заполните «${label}»`;
        if (type==='num' && v && !Number.isFinite(parseFloat(v.replace(',','.')))) return `Строка ${i+1}: «${label}» — число`;
        if (o.id && v && !/^[a-z0-9_-]{1,30}$/.test(v)) return `Строка ${i+1}: «${label}» — латиница, цифры, «-» и «_»`; }
      if (o.id || o.unique){ const seen=new Set(); for (const r of rows){ const v=String(r[f]??'').trim().toLowerCase(); if (!v) continue;
        if (seen.has(v)) return `«${label}»: «${r[f]}» повторяется`; seen.add(v); } } }
    return ''; }
  /** строка таблицы без пустых полей; числа — числом */
  clean(r){ const out={}; for (const [f, , type] of this.cols){ let v=r[f]; if (v==null) continue; v=String(v).trim(); if (v==='') continue;
      out[f] = type==='num' ? parseFloat(v.replace(',','.')) : v; } return out; }
}

class ListRegistry {
  constructor(){ this.defs=new Map(); this.srv={}; this.groups=[]; }
  group(id, title, hint=''){ this.groups.push({id, title, hint}); return this; }
  add(o){ const d=new ListDef(o); this.defs.set(d.key, d); return d; }
  get(key){ return this.defs.get(key); }
  inGroup(g){ return [...this.defs.values()].filter(d=>d.group===g); }
  rows(key){ return this.srv[key] || this.defs.get(key).builtin; }
  isOwn(key){ return Array.isArray(this.srv[key]); }
  /** варианты администратора → в массивы программы (неизвестные ключи пропускаются) */
  use(map){ this.srv = map && typeof map==='object' && !Array.isArray(map) ? map : {};
    for (const d of this.defs.values()) this.applyDef(d); }
  applyDef(d){ if (d.builtin==null) return; try{ d.apply(this.isOwn(d.key) ? this.srv[d.key] : null); }catch(e){ d.apply(null); } }
  /** списки из ES-модуля: запомнить встроенный вариант и подставить свой (из браузера или сервера) */
  ready(keys){ for (const key of keys){ const d=this.defs.get(key); if (!d || d.builtin!=null) continue; d.builtin=d.read(); this.applyDef(d); } }
  cache(){ try{ localStorage.setItem('kp.lists', JSON.stringify(this.srv)); }catch(e){} }
  fromCache(){ try{ this.use(JSON.parse(localStorage.getItem('kp.lists')||'{}')); }catch(e){ this.use({}); } }
  async load(){ try{ this.use(await api('/api/lists')); this.cache(); }catch(e){} }
}

const LISTS = new ListRegistry();

// ---------- реестр: группы и списки. Строки-«значения» — одно поле v
const lstStr = (key, group, label, target, hint, extra={}) => LISTS.add(Object.assign({ key, group, label, hint, target,
  cols:[['v', 'Значение', 'text', {req:true, unique:true}]], toRow:v=>({v:String(v)}), fromRow:r=>String(r.v||'').trim()||null }, extra));

LISTS.group('kp', 'КП: условия и объект', 'Варианты в выпадающих меню раздела «Условия» и подсказки в разделе «Клиент». Менеджер всегда может вписать своё.')
  .group('st', 'Станции в контейнере', 'Выбор контейнера, утепления, климата и систем в карточке станции и мастере. Уже созданные станции не меняются.')
  .group('deal', 'Экономика сделки', '')
  .group('crm', 'Кабинет менеджера', 'Этапы сделок на доске «Сделки», в карточке сделки и в воронке отдела.')
  .group('misc', 'Прочее', '');

COND.forEach(([label, opts]) => lstStr('cond.'+label, 'kp', 'Условие «'+label+'»', ()=>opts, 'Варианты в меню «'+label+'».'));
lstStr('cond.extra', 'kp', 'Дополнительные условия (типовые оговорки)', ()=>COND_EXTRA, 'Добавляются в «Дополнительные условия» одной кнопкой.');
lstStr('obj.purposes', 'kp', 'Назначение объекта', ()=>PURPOSES, 'Подсказки в поле «Назначение» раздела «Клиент».');
lstStr('kp.lost', 'kp', 'Причины проигрыша КП', ()=>KP_LOST, 'Варианты в окне «Ход сделки» при статусе «Проиграно» (журнал КП) и при закрытии сделки как проигранной (кабинет менеджера).');
LISTS.add({ key:'crm.stages', group:'crm', label:'Этапы сделки', target:()=>CrmStages.LIST, min:3, late:true,
  hint:'Порядок строк — порядок этапов на доске. Код — внутренний (латиница): у этапов, по которым уже есть сделки, его не меняйте. «Выиграно» (won) и «Проиграно» (lost) есть всегда и стоят в конце — их можно только переименовать. По ходу КП сделка сама идёт вперёд до этапов lead (КП подготовлено), sent (отправлено), talks (в работе), contract (выиграно), если они есть в списке.',
  cols:[['id','Код','text',{req:true, id:true, ph:'tender'}],['name','Название','text',{req:true}]],
  toRow:x=>({id:x.id, name:x.name}), fromRow:r=>r.id&&r.name ? {id:String(r.id).trim(), name:String(r.name).trim()} : null });

LISTS.add({ key:'st.types', group:'st', label:'Типы контейнеров', target:()=>ContainerKind.TYPES, late:true,
  hint:'Код — внутренний, не меняйте его у типов, которые уже есть в КП. Утепление и климат — свои для этого типа (иначе — из «Умолчаний»).',
  cols:[['id','Код','text',{req:true, id:true, ph:'block'}],['name','Название','text',{req:true}],['short','В тексте КП («в …»)','text',{req:true, ph:'блок-контейнере'}],
    ['size','Размеры','text'],['ins','Утепление','text',{ph:'по умолчанию'}],['climate','Климат','text',{ph:'по умолчанию'}],['desc','Описание в КП','area',{req:true}]],
  toRow:c=>({...c}), fromRow:r=>r.id&&r.name ? Object.fromEntries(Object.entries(r).filter(([,v])=>v!=='' && v!=null)) : null });
lstStr('st.ins', 'st', 'Утепление контейнера', ()=>ContainerKind.INSULATION, 'Например: 80 мм.', {late:true});
LISTS.add({ key:'st.climates', group:'st', label:'Климатические исполнения', target:()=>ContainerKind.CLIMATES, late:true,
  cols:[['code','Код','text',{req:true, unique:true, ph:'УХЛ1'}],['desc','Описание','text',{req:true}],['t','Мин. температура, °C','num',{ph:'−60'}]],
  toRow:([code, desc, t])=>({code, desc, t:t==null?'':String(t)}), fromRow:r=>r.code ? [String(r.code), String(r.desc||''), r.t===''||r.t==null?null:+r.t] : null });
LISTS.add({ key:'st.systems', group:'st', label:'Системы контейнера', target:()=>ContainerKind.SYSTEMS, late:true,
  hint:'Кнопки «Системы контейнера» в карточке станции; описание — строкой в характеристиках КП.',
  cols:[['id','Код','text',{req:true, id:true, ph:'heat'}],['name','Название','text',{req:true}],['desc','Что входит','area',{req:true}]],
  toRow:([id, name, desc])=>({id, name, desc}), fromRow:r=>r.id&&r.name ? [r.id, r.name, String(r.desc||'')] : null });
lstStr('kit.presets', 'st', 'Быстрые элементы состава', ()=>Kit.PRESETS, 'Кнопки «+ …» во вкладке «Состав станции».', {late:true});

LISTS.add({ key:'deal.countries', group:'deal', label:'Страны поставщиков', target:()=>DEAL_COUNTRIES,
  hint:'Подсказки в поле «Где покупаем» и валюта закупки по умолчанию для страны.',
  cols:[['name','Страна','text',{req:true, unique:true}],['cur','Валюта','text',{req:true, ph:'USD'}]],
  toRow:([name, cur])=>({name, cur}), fromRow:r=>r.name ? [String(r.name), String(r.cur||'USD').toUpperCase()] : null });

LISTS.add({ key:'ai.sites', group:'misc', label:'Нейросети для автозаполнения', target:()=>AiChat.SITES, late:true,
  hint:'Кнопки быстрого перехода в «Заполнить с ИИ»: запрос копируется, сайт открывается в новой вкладке.',
  cols:[['name','Название','text',{req:true}],['url','Адрес','text',{req:true, ph:'https://…'}]],
  toRow:([name, url])=>({name, url}), fromRow:r=>r.name && /^https?:\/\//i.test(r.url||'') ? [r.name, r.url] : null });
lstStr('tpl.fonts', 'misc', 'Шрифты в редакторе шаблона', ()=>FONTS, 'Подсказки в поле «Шрифт» (шрифт должен быть на компьютерах, где открывают КП).');

// при запуске — последний вариант из браузера (до ответа сервера), затем свежий с сервера (main.js)
LISTS.fromCache();
