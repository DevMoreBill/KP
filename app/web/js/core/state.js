// Состояние КП (S): новое КП, черновик в браузере, доступ к полям по пути, итоги.
'use strict';

const DEF_MANAGER = { name:'', position:'',
  phone:'+7 (495) 690-91-96', ext:'', mobile:'', email:'', site:'www.kompr.ru',
  address:'Москва, ул. Малая Пироговская, д. 18с1', hours:'Пн–Пт, 9:00–18:00' };

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

function freshState(){
  let manager = DEF_MANAGER;
  try { const m = localStorage.getItem('kp.manager'); if (m) manager = JSON.parse(m); } catch(e){}
  return { client:'', clientId:'', clientInn:'', clientKpp:'', clientOgrn:'', clientFull:'', clientAddr:'', clientDir:'', clientDirPost:'', clientStatus:'',
    contact:{name:'',post:'',phone:'',email:''}, object:{purpose:'',address:''}, check:null,
    date:today(), city:'Москва', vat:22, showClients:true,
    cover:{ title:'', model:'', desc:'', kpis:[{},{},{},{}], touched:false },
    pricing:{ cur:'RUB', rates:{USD:'',EUR:'',CNY:''}, rateDate:'', rateSrc:'', margin:35, mode:'margin', costNoVat:false, round:'1' },
    items:[], conditions: COND.map(c=>({label:c[0], value:''})), condExtra:'', manager:{...manager}, managerId:'' };
}

let S = freshState();

try { const d = localStorage.getItem('kp.draft'); if (d) { S = Object.assign(freshState(), JSON.parse(d)); S.pricing = Object.assign(freshState().pricing, S.pricing||{}); S.contact=Object.assign(freshState().contact,S.contact||{}); S.object=Object.assign(freshState().object,S.object||{}); S.items.forEach(x=>{ x._busy=false; x._srcImg=null; x.options=x.options||[]; x.attrs=x.attrs||{}; }); } } catch(e){}

let saveT;

// правка позиции каталога в карточке (features/catalog-edit.js): пока она открыта, S.items подменены — черновик не сохраняется
var CATED = null;

function persist(){
  if (CATED) return;
  if (typeof kitSync==='function') S.items.forEach(x=>{ kitSync(x); stationFill(x); stationAutoName(x); });     // закупка сборки — по текущим курсам; параметры станции — по составу
  if (typeof coverSync==='function') coverSync();
  clearTimeout(saveT);
  saveT = setTimeout(()=>{
    if (CATED) return;
    const el = $('#saved');
    try { localStorage.setItem('kp.draft', JSON.stringify(S)); el.textContent = 'Черновик сохранён'; }
    catch(e){
      try { const lite = JSON.parse(JSON.stringify(S)); lite.items.forEach(i=>{i.photo=null;i.logo=null; if(i.gallery) i.gallery=i.gallery.filter(g=>!String(g.src).startsWith('data:'));}); localStorage.setItem('kp.draft', JSON.stringify(lite)); el.textContent = 'Черновик сохранён без фото'; }
      catch(e2){ el.textContent = ''; }
    }
    try { localStorage.setItem('kp.manager', JSON.stringify(S.manager)); } catch(e){}
  }, 400);
}

function getP(path){ return path.split('.').reduce((o,k)=>o==null?o:o[k], S); }

function setP(path, v){ const ks=path.split('.'); let o=S; for(let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks.at(-1)]=v; }

// сумма позиции с учётом скидки для заказчика (KPGen.netPrice) и опций
function itemSum(x){ return (+x.qty||0)*KPGen.netPrice(x) + (x.options||[]).reduce((s,o)=>s+(+o.qty||0)*(o.price||0),0); }

function totalsS(){ return totals(S.items.map(x=>({qty:+x.qty||0, price:x.price||0, disc:x.disc, options:(x.options||[]).filter(o=>o.name).map(o=>({qty:+o.qty||0, price:o.price||0}))})), +S.vat||0); }
