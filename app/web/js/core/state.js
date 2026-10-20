// Состояние КП (S): новое КП, черновик в браузере, доступ к полям по пути, итоги.
'use strict';

// контакты компании (телефон, сайт, адрес, режим работы) — из «Значений программы» (mgr.*), см. defManager
const DEF_MANAGER = { name:'', position:'', phone:'', ext:'', mobile:'', email:'', site:'', address:'', hours:'' };

// что ещё подставляется в новое КП («Настройки → Значения программы → КП и документы → Новое КП»)
DefRegistry.add([], [
  ['kp.showClients', 'kp', 'Страница «Наши клиенты» в новом КП', 'bool', true, {hint:'Включено — в новом КП сразу стоит переключатель «Страница „Наши клиенты“ в КП» (раздел «Оформление КП»): в документ попадает страница с логотипами клиентов компании. Выключено — страницы нет, менеджер включает её сам, когда нужно.'}],
]);

// условия КП и базовые варианты для быстрого выбора (раздел «Условия», кнопка ▾ у поля)
const COND = [
  ['Срок поставки', ['В наличии на складе','5–10 рабочих дней','10 рабочих дней','20 рабочих дней','30 рабочих дней','45 рабочих дней','60 рабочих дней','90 календарных дней','По согласованию']],
  ['Условия оплаты', ['100 % предоплата','50 % аванс, 50 % перед отгрузкой','30 % аванс, 70 % перед отгрузкой','70 % аванс, 30 % после поставки','Отсрочка платежа 30 дней','По согласованию']],
  ['Гарантия', ['12 месяцев','18 месяцев','24 месяца','36 месяцев','12 месяцев или 1 000 моточасов','24 месяца или 2 000 моточасов','12 месяцев с даты ввода в эксплуатацию']],
  ['Доставка', ['Самовывоз со склада в Москве','Доставка до объекта включена','Доставка по Москве включена','Доставка рассчитывается отдельно','Доставка транспортной компанией за счёт покупателя']],
  ['Срок действия предложения', ['5 рабочих дней','10 рабочих дней','14 дней','30 дней','До конца текущего месяца']],
  ['Монтаж, ШМР и ПНР', ['Шефмонтаж и пусконаладочные работы входят в стоимость','Монтаж и пусконаладочные работы входят в стоимость','Не входят в стоимость, выполняются по отдельному договору','По согласованию']]
];

// типовые оговорки для «Дополнительных условий» (добавляются строкой)
const COND_EXTRA = ['Цена действительна при заказе всего комплекта оборудования.','Пусконаладочные работы выполняются по отдельному договору.',
  'Стоимость доставки рассчитывается отдельно.','Срок поставки уточняется на момент оплаты.','Цена может быть изменена при изменении курса валют более чем на 3 %.',
  'Монтаж оборудования в стоимость не входит.','Гарантия действует при обслуживании в авторизованном сервисном центре.'];

function newItem(){ return { id:uid(), name:'', spec:'', qty:1, price:0, page:false, pageTitle:'', photoCaption:'', photo:null, logo:null, features:[], groups:[], hint:null, options:[], attrs:{} }; }

// контакты компании для нового менеджера — из умолчаний администратора
function defManager(){ const m={...DEF_MANAGER}; for (const k of ['phone','site','address','hours']){ const v=DEF('mgr.'+k); m[k]=v==null?'':v; } return m; }

function freshState(){
  let manager = defManager();
  try { const m = localStorage.getItem('kp.manager'); if (m) manager = JSON.parse(m); } catch(e){}
  return { client:'', clientId:'', clientInn:'', clientKpp:'', clientOgrn:'', clientFull:'', clientAddr:'', clientDir:'', clientDirPost:'', clientStatus:'',
    contact:{name:'',post:'',phone:'',email:''}, object:{purpose:'',address:''}, check:null,
    tender:{on:false, number:'', url:''},      // вид КП: обычное или для тендера (номер и ссылка на закупку — в КП, журнале и имени файла)
    date:today(), city:DEF('kp.city')||'', vat:DEFN('kp.vat', 22), showClients:DEF('kp.showClients')!==false,
    cover:{ title:'', model:'', desc:'', kpis:[{},{},{},{}], touched:false },
    pricing:{ cur:DEF('kp.cur')||'RUB', rates:{USD:'',EUR:'',CNY:''}, rateDate:'', rateSrc:'', margin:35, mode:'margin', costNoVat:false, round:DEF('kp.round')||'1' },
    items:[], conditions: COND.map(c=>({label:c[0], value:DEF('cond.'+c[0])||''})),
    // текст условий из «Умолчаний» — как автоматический: «Экономика сделки» заменит его своим расчётом, пока его не правили
    condAuto: Object.fromEntries(COND.map(c=>[c[0], DEF('cond.'+c[0])]).filter(x=>x[1])), condExtra:'', manager:{...manager}, managerId:'' };
}

// черновик КП в браузере (на случай закрытия вкладки). Большие картинки (data:, 3D-виды и листы чертежа станции — мегабайты)
// хранятся отдельными записями и пишутся один раз: иначе каждая правка КП ждала бы запись нескольких мегабайт (на слабом ПК —
// заметная задержка после каждого нажатия). В черновике вместо картинки — ссылка REF+номер
class LocalDraft {
  static KEY = 'kp.draft';
  static PRE = 'kp.img.';
  static REF = '\u0000img:';
  static MIN = 20000;          // меньше — прямо в черновике
  static ids = new Map();      // картинка → номер записи (уже записана)
  static n = 0;
  static save(st){
    const used=new Set();
    const s=JSON.stringify(st, (k, v)=>typeof v==='string' && v.length>=this.MIN && v.startsWith('data:') ? this.REF+this.put(v, used) : v);
    localStorage.setItem(this.KEY, s); this.sweep(used);
  }
  /** черновик без картинок (не хватило места в браузере) */
  static saveLite(st){ localStorage.setItem(this.KEY, JSON.stringify(st)); this.sweep(new Set()); }
  static put(v, used){
    let id=this.ids.get(v);
    if (!id){ id=Date.now().toString(36)+'_'+(++this.n); localStorage.setItem(this.PRE+id, v); this.ids.set(v, id); }
    used.add(id); return id;
  }
  /** убрать записи картинок, на которые черновик больше не ссылается */
  static sweep(used){
    for (let k=localStorage.length-1; k>=0; k--){ const key=localStorage.key(k);
      if (key && key.startsWith(this.PRE) && !used.has(key.slice(this.PRE.length))) localStorage.removeItem(key); }
    for (const [v, id] of this.ids) if (!used.has(id)) this.ids.delete(v);
  }
  static load(){
    const d=localStorage.getItem(this.KEY); if (!d) return null;
    return JSON.parse(d, (k, v)=>{ if (typeof v!=='string' || !v.startsWith(this.REF)) return v;
      const id=v.slice(this.REF.length), src=localStorage.getItem(this.PRE+id); if (src==null) return null;
      this.ids.set(src, id); return src; });
  }
  /** черновик переписан в другой вкладке (она могла убрать «чужие» картинки) — следующее сохранение пишет картинки заново */
  static watch(){ window.addEventListener('storage', e=>{ if (e.key==null || e.key===this.KEY || e.key.startsWith(this.PRE)) this.ids.clear(); }); }
}
LocalDraft.watch();

let S = freshState();

try { const d = LocalDraft.load(); if (d) { S = Object.assign(freshState(), d); S.pricing = Object.assign(freshState().pricing, S.pricing||{}); S.contact=Object.assign(freshState().contact,S.contact||{}); S.object=Object.assign(freshState().object,S.object||{}); S.items.forEach(x=>{ x._busy=false; x._srcImg=null; x.options=x.options||[]; x.attrs=x.attrs||{}; }); } } catch(e){}

let saveT;

// справочники, которые читают и переписывают и ES-модули (features/kp), и обычные скрипты: CLIENTS — последние
// использованные и найденные клиенты (их тысячи, поиск — на сервере), CLIENTS_ALL — сколько всего; MGRS — менеджеры;
// mgrT — отложенное сохранение контактов менеджера (docx/build.js сбрасывает его перед записью КП)
let CLIENTS = [], CLIENTS_ALL = 0, MGRS = [], mgrT = null;

// правка позиции каталога в карточке (features/catalog/catalog-edit.js): пока она открыта, S.items подменены — черновик не сохраняется
var CATED = null;

// каталог в браузере (features/catalog/ — Catalog.refresh) и открытая карточка позиции (ItemEditor): присваивают и читают все разделы
let catCache = [];
let EDIT = null;

// открытый раздел формы КП (ui/steps.js — Steps) и свои подсказки полей адреса (ui/geo-input.js — GeoInput,
// склады поставщиков добавляет features/deal): общие для нескольких модулей
let STEP = 'client';
const GEO_EXTRA = {};

function persist(){
  if (CATED) return;
  S.items.forEach(x=>{ Kit.sync(x); StationAuto.fill(x); StationName.apply(x); });     // закупка сборки — по текущим курсам; параметры станции — по составу
  coverSync();
  clearTimeout(saveT);
  saveT = setTimeout(()=>{
    if (CATED) return;
    const el = $('#saved');
    try { LocalDraft.save(S); el.textContent = 'Черновик сохранён'; }
    catch(e){
      try { const lite = JSON.parse(JSON.stringify(S)); lite.items.forEach(i=>{i.photo=null;i.logo=null; if(i.gallery) i.gallery=i.gallery.filter(g=>!String(g.src).startsWith('data:'));}); LocalDraft.saveLite(lite); el.textContent = 'Черновик сохранён без фото'; }
      catch(e2){ el.textContent = ''; }
    }
    try { localStorage.setItem('kp.manager', JSON.stringify(S.manager)); } catch(e){}
  }, 400);
}

// сумма позиции с учётом скидки для заказчика (KPGen.netPrice) и опций
function itemSum(x){ return (+x.qty||0)*KPGen.netPrice(x) + (x.options||[]).reduce((s,o)=>s+(+o.qty||0)*(o.price||0),0); }

function totalsS(){ return totals(S.items.map(x=>({qty:+x.qty||0, price:x.price||0, disc:x.disc, options:(x.options||[]).filter(o=>o.name).map(o=>({qty:+o.qty||0, price:o.price||0}))})), +S.vat||0); }
