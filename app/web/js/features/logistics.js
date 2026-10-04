// Расчёт доставки по России в «Экономике сделки» и тарифы в «Настройках» (расчёт — logistics-calc.js).
'use strict';

const LG = { tar:null, saved:null, k:0 };

async function lgLoad(force){
  if (LG.tar && !force) return LG.tar;
  try{ LG.saved=await api('/api/logistics'); }catch(e){ LG.saved={}; }
  LG.tar=lgTariffs(LG.saved); return LG.tar;
}

const lgIn = v => v==null||v==='' ? '' : String(Math.round(v*1000)/1000).replace('.',',');
const lgV = s => { const v=parseFloat(String(s??'').replace(/\s+/g,'').replace(',','.')); return Number.isFinite(v)?v:null; };

// позиции поставщика: масса и габариты — из характеристик, свои правки — в s.lg.items
function lgItems(s){
  const own=(s.lg&&s.lg.items)||{};
  return S.items.filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id).map(x=>{
    const cg=lgCargoOf(x.groups), o=own[x.id]||{}, d=cg.dims||{};
    const pick=(k,auto)=>{ const v=lgV(o[k]); return v!=null ? {v, own:true} : {v:auto??null, own:false}; };
    const l=pick('l',d.l), w=pick('w',d.w), h=pick('h',d.h), m=pick('m',cg.mass);
    return { id:x.id, name:x.name, qty:+x.qty||0, l, w, h, m, dimSrc:cg.dimSrc, massSrc:cg.massSrc }; });
}

function lgInput(s){
  const lg=s.lg||{}, T=LG.tar;
  const imp=!/^росс/i.test(s.country||'') && (s.where==='imp' || (s.country && !/^росс/i.test(s.country)));
  const from=String(s.wh||'').trim() || (imp ? T.hub : '');
  const to=String(lg.to ?? (S.object&&S.object.address || S.clientAddr || '')).trim();
  return { from:{addr:from, city:lg.fromCity||''}, to:{addr:to, city:lg.toCity||''}, km:lg.km||'', unload:lg.unload||'auto',
    items:lgItems(s).map(x=>({name:x.name, qty:x.qty, l:x.l.v, w:x.w.v, h:x.h.v, m:x.m.v})), imp };
}

async function openLogistics(k){
  await lgLoad();
  try{ LG.status=await api('/api/logistics/status'); }catch(e){ LG.status=null; }
  const d=dlDeal(), s=d.sup[k]; if (!s) return;
  if (!s.lg) s.lg={};
  LG.k=k;
  let dlg=$('#lgdlg');
  if (!dlg){ dlg=document.createElement('dialog'); dlg.id='lgdlg'; dlg.className='lgwin'; document.body.appendChild(dlg);
    dlg.addEventListener('input', lgOnInput); dlg.addEventListener('change', lgOnInput); dlg.addEventListener('click', lgOnClick);
    dlg.addEventListener('close', ()=>{ if (typeof dealRender==='function' && $('#dealdlg')?.open) dealRender(); }); }
  lgRender();
  if (!dlg.open) dlg.showModal();
  // цены перевозчиков — сразу при открытии, если расчёт полный и прежний запрос не подходит к нынешнему грузу
  if (LG.last && !LG.last.need && !lgQuoteFor(s, LG.last)) lgQuote();
}

function lgSup(){ const d=dlDeal(); return d.sup[LG.k]; }

function lgRender(){
  const dlg=$('#lgdlg'), s=lgSup(), T=LG.tar, inp=lgInput(s), its=lgItems(s), lg=s.lg||{};
  const nm=(s.name||'').trim()||'поставщик';
  const cityList=`<datalist id="lgCities">${LG_CITIES.map(c=>`<option value="${esc(c[0])}">`).join('')}</datalist>`;
  const cell=(x,k,ph)=>`<input type="text" inputmode="decimal" data-lgi="${esc(x.id)}" data-f="${k}" value="${esc(lgIn(x[k].v))}" placeholder="${ph}" class="${x[k].v==null?'need':''}${x[k].own?' own':''}" aria-label="${ph}">`;
  dlg.innerHTML=`<div class="dlg-h"><div><h3>Доставка по России</h3><p class="muted lg-sub">${esc(nm)} → объект заказчика</p></div><button class="icon" type="button" data-lgx="close" aria-label="Закрыть">✕</button></div>
  <div class="dlg-b lg-b">${cityList}
    <div class="lg-route">
      <label class="f"><span>Откуда — ${inp.imp?'склад временного хранения / терминал':'склад поставщика'} ${dlQ(inp.imp?'Где груз выпускается с таможни и откуда едет по России. По умолчанию — из «Настроек» → «Логистика».':'Город или адрес склада поставщика. Сохраняется в справочник поставщиков — в следующий раз подставится сам.')}</span>
        <input type="text" data-lgf="wh" value="${esc(s.wh||'')}" placeholder="${esc(inp.imp?T.hub:'например: Москва, Подольск, Екатеринбург')}" list="lgCities"></label>
      <label class="f"><span>Куда — адрес объекта ${dlQ('Из раздела «Клиент» (объект или юридический адрес). Можно вписать другой адрес или просто город.')}</span>
        <input type="text" data-lgf="to" value="${esc(inp.to.addr)}" placeholder="город, улица" list="lgCities"></label>
      <label class="f lg-km"><span>Расстояние, км ${dlQ('По таблице городов: по прямой с поправкой на дороги (точность ±10 %). Знаете точное — впишите.')}</span>
        <input type="text" inputmode="numeric" data-lgf="km" value="${esc(lg.km||'')}" placeholder="авто"></label>
    </div>
    <p class="lg-where" id="lgWhere"></p>
    <h5>Груз ${dlQ('Масса и габариты — из характеристик позиций каталога (строки «Масса», «Габариты Д × Ш × В»). Пустые поля заполните — правка сохранится в расчёте этой сделки. К лёгким местам (до '+lgIn(T.packMax)+' т) добавляется упаковка +'+lgIn(T.pack)+' %.')}</h5>
    ${its.length?`<div class="lg-tw"><table class="lg-t"><thead><tr><th>Позиция</th><th class="num">Мест</th><th>Длина, м</th><th>Ширина, м</th><th>Высота, м</th><th>Масса 1 шт, т</th></tr></thead><tbody>
      ${its.map(x=>`<tr><td class="lg-nm"><b>${esc(x.name)}</b><small>${esc([x.dimSrc, x.massSrc].filter(Boolean).join(' · ')||'нет габаритов и массы в характеристиках')}</small></td><td class="num">${esc(x.qty)}</td>
        <td>${cell(x,'l','Д')}</td><td>${cell(x,'w','Ш')}</td><td>${cell(x,'h','В')}</td><td>${cell(x,'m','т')}</td></tr>`).join('')}</tbody></table></div>`
      :'<p class="muted">У этого поставщика нет позиций в КП.</p>'}
    ${its.length?'<p class="muted lg-note">Вписанные масса и габариты при «Подставить» сохранятся в характеристики позиции и в карточку каталога — в следующий раз подставятся сами.</p>':''}
    <div class="lg-un"><label class="f"><span>Разгрузка на объекте</span><select data-lgf="unload">
      <option value="auto"${(lg.unload||'auto')==='auto'?' selected':''}>Подобрать по самому тяжёлому месту</option>
      <option value="none"${lg.unload==='none'?' selected':''}>Не нужна (разгружает заказчик)</option>
      ${T.unload.map(u=>`<option value="${esc(u.id)}"${lg.unload===u.id?' selected':''}>${esc(u.name)} — ${lgRub(u.cost)}</option>`).join('')}</select></label></div>
    <div id="lgRes" class="lg-res"></div>
  </div>`;
  lgResult();
}

function lgResult(){
  const s=lgSup(), T=LG.tar, inp=lgInput(s), r=lgCalc(inp, T), box=$('#lgRes'), wh=$('#lgWhere'); if (!box) return;
  LG.last=r;
  if (wh) wh.innerHTML=[r.from?`Откуда: <b>${esc(r.from.name)}</b>${r.from.how==='регион'?' <span class="muted">(центр региона)</span>':''}`:'<span class="bad-t">Откуда: город не найден — впишите город склада</span>',
    r.to?`Куда: <b>${esc(r.to.name)}</b>${r.to.how==='регион'?' <span class="muted">(центр региона — уточните город)</span>':''}`:'<span class="bad-t">Куда: город в адресе не найден — впишите город</span>',
    r.km?`<b>${stNumLg(r.km)} км</b> <span class="muted">${esc(r.kmSrc)}</span>`:''].filter(Boolean).join(' · ');
  if (r.need){ box.innerHTML=`<p class="msg">${esc(r.need)}${r.missing.length?`: ${esc(r.missing.join(', '))}`:''}</p>`; return; }
  const veh=r.vehicles.map((v,i)=>`<div class="lg-veh"><div class="lg-vh"><b>${r.vehicles.length>1?`Машина ${i+1}: `:''}${esc(v.C.name)}</b>
      <span class="muted">${v.units.length} ${plural(v.units.length,'место','места','мест')} · ${lgT(v.fit.mass)} т · занято ${lgM(v.fit.depth)} из ${lgM(v.C.L)} м площадки</span>
      ${v.over?'<span class="lg-tag warn">негабарит</span>':''}${v.heavy?'<span class="lg-tag warn">тяжеловес</span>':''}${v.escort?'<span class="lg-tag bad">прикрытие</span>':''}</div>
    <table class="lg-p">${v.parts.map(([t,a])=>`<tr><td>${esc(t)}</td><td class="num">${lgRub(a)}</td></tr>`).join('')}</table></div>`).join('');
  const ruSup=/^росс/i.test(s.country||'') || s.where==='ru';
  const Q=lgQuoteFor(s, r), fin=lgFinal(r, Q);
  LG.fin=fin;
  box.innerHTML=`${veh}
    ${r.unload?`<div class="lg-veh"><table class="lg-p"><tr><td>Разгрузка: ${esc(r.unload.name)}</td><td class="num">${lgRub(r.unload.cost)}</td></tr></table></div>`:''}
    ${r.warn.map(w=>`<p class="msg warn">${esc(w)}</p>`).join('')}
    ${r.missing.length?`<p class="msg warn">Не посчитаны (нет массы или габаритов): ${esc(r.missing.join(', '))}</p>`:''}
    ${lgOffersHtml(r, Q)}
    <div class="lg-tot"><div><small>Доставка по России — ${fin.src==='model'?'по тарифам программы':'по максимальному предложению'}${r.ok?'':' (неполная оценка)'}</small><b>${lgRub(fin.price)}</b><span class="muted">${fin.src==='model'?`диапазон ${lgRub(r.lo)} – ${lgRub(r.hi)} · `:''}в пути ≈ ${r.days} ${plural(r.days,'день','дня','дней')}${r.over?` (с оформлением разрешения ${T.permitDays} раб. дн.)`:''}</span></div>
      <div class="lg-act">${ruSup?`<label class="cw-chk"><input type="checkbox" id="lgDays"${s.lg&&s.lg.setDays===false?'':' checked'}> срок в пути → «Доставка до заказчика»</label>`:''}
        <button class="btn primary" type="button" data-lgx="apply"${fin.price>0?'':' disabled'}>Подставить ${lgRub(fin.price)}</button></div></div>
    <p class="muted lg-note lg-foot">¹ ${esc(fin.foot)}</p>
    <p class="muted lg-note">Ставки за км: ${esc(lgRateSrc(r))}. Погрузка на складе поставщика обычно за его счёт.</p>`;
}

// ---------- предложения перевозчиков (ATI.SU, ПЭК, Деловые Линии, КИТ) — сервер /api/logistics/quote
function lgQuoteKey(r){ return JSON.stringify([r.from&&r.from.name, r.to&&r.to.name, r.km, r.vehicles.map(v=>v.C.id+':'+Math.round(v.cost)), r.unload&&r.unload.id, Math.round(r.total)]); }
function lgQuoteFor(s, r){ const q=s.lg&&s.lg.quote; return q && q.key===lgQuoteKey(r) ? q : null; }
function lgRateSrc(r){ const src=[...new Set(r.vehicles.map(v=>v.C.src+(v.C.srcAt?' от '+stTime(v.C.srcAt).slice(0,10):'')))]; return src.join('; ')||'тарифы «Настроек»'; }

// итог — максимальное из полных предложений; сноска — откуда цена и с чем сравнивали
function lgFinal(r, Q){
  const model={src:'model', price:Math.round(r.total), name:'Тарифы «Настроек»'};
  if (!Q || !Q.res || !Q.res.best) return { ...model, foot:`Расчёт по тарифам программы (${lgRateSrc(r)})${Q&&Q.res?' — у перевозчиков нет полных предложений':' — цены перевозчиков не запрашивались'}.` };
  const b=Q.res.best, others=Q.res.offers.filter(o=>o!==b && o.complete && o.src!==b.src);
  const at=stTime(Q.res.at);
  return { src:b.kind, price:Math.round(b.price), name:b.src,
    foot:`Цена — максимальное предложение: ${b.src}${b.note?' ('+b.note+')':''}, данные на ${at}.${others.length?' Для сравнения: '+others.map(o=>`${o.src} — ${lgRub(o.price)}`).join(', ')+'.':''}` };
}

function lgOffersHtml(r, Q){
  if (r.need || !r.vehicles.length) return '';
  const pv=(LG.status&&LG.status.providers)||{};
  const keysHint=[!pv.ati?'ATI.SU':'', !pv.dellin?'Деловые Линии':'', !pv.kit?'КИТ':''].filter(Boolean);
  const head=`<div class="lg-oh"><b>Цены перевозчиков</b>${dlQ('Отдельная машина — ATI.SU «Средние ставки» (верхняя граница за 30 дней, с НДС) + разрешения и разгрузка по тарифам программы. Сборный груз (если места небольшие) — ПЭК, Деловые Линии, КИТ. В расчёт идёт максимальное полное предложение.')}
    <button class="btn ghost" type="button" data-lgx="quote">${LG.qBusy?'Запрашиваю…':Q?'Обновить':'Запросить цены'}</button>
    ${keysHint.length?`<span class="muted">без ключа: ${esc(keysHint.join(', '))} — «Интеграции»</span>`:''}</div>`;
  if (!Q) return `<div class="lg-offers">${head}${LG.qErr?`<p class="msg err">${esc(LG.qErr)}</p>`:''}</div>`;
  const res=Q.res, best=res.best;
  const isB=o=>best && o.src===best.src && o.price===best.price;
  const rows=res.offers.map(o=>`<tr class="${isB(o)?'best':''}"><td><b>${esc(o.src)}</b><small>${esc(o.note||'')}</small></td>
      <td>${esc({model:'расчёт',ftl:'отдельная машина',ltl:'сборный груз'}[o.kind]||'')}</td><td class="num">${o.days?esc(o.days)+' дн.':''}</td><td class="num">${lgRub(o.price)}${isB(o)?' <span class="lg-tag">макс.</span>':''}</td></tr>`).join('');
  const errs=res.errors.map(e=>`<li class="${e.skip?'muted':''}"><b>${esc(e.src)}:</b> ${esc(e.msg)}</li>`).join('');
  return `<div class="lg-offers">${head}<div class="lg-tw"><table class="lg-p lg-of">${rows}</table></div>${errs?`<ul class="lg-errs">${errs}</ul>`:''}
    <p class="muted lg-note">Запрошено ${esc(stTime(res.at))}</p></div>`;
}

// ближайшие крупные города (первые в таблице — крупнейшие) в пределах 150 км — для направлений ATI.SU
function lgNearBig(c){ if (!c) return [];
  return LG_CITIES.slice(0,60).filter(x=>x[0]!==c.name).map(x=>({n:x[0], d:lgHav(c,{lat:x[1],lon:x[2]})})).filter(x=>x.d<=150).sort((a,b)=>a.d-b.d).slice(0,2).map(x=>x.n); }

async function lgQuote(){
  const s=lgSup(), r=LG.last; if (!r || r.need || LG.qBusy) return;
  const inp=lgInput(s);
  const its=S.items.filter(x=>String(x.name||'').trim() && dlSupOf(x.id)===s.id);
  const declared=its.reduce((a,x)=>a+(x.cost?x.cost/100*(+x.qty||0)*(rateOf(x.costCur||'RUB')||0):0),0);
  const body={ from:{name:r.from&&r.from.name, addr:String(s.wh||'').trim()||(r.from&&r.from.name), alt:lgNearBig(r.from)}, to:{name:r.to&&r.to.name, addr:inp.to.addr, alt:lgNearBig(r.to)}, km:r.km,
    places:inp.items.filter(x=>x.l&&x.w&&x.h&&x.m&&x.qty).map(x=>({l:x.l, w:x.w, h:x.h, m:x.m, qty:x.qty})),
    vehicles:r.vehicles.map(v=>({id:v.C.id, name:v.C.name, extras:Math.round(v.parts.slice(1).reduce((a,p)=>a+p[1],0))})),
    unload:r.unload?r.unload.cost:0, model:Math.round(r.total), modelNote:`${r.vehicles.map(v=>v.C.name).join(' + ')}; ${lgRateSrc(r)}`, declared };
  LG.qBusy=true; LG.qErr=''; lgResult();
  try{ const res=await api('/api/logistics/quote',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)});
    s.lg.quote={key:lgQuoteKey(r), res}; persist(); }
  catch(e){ LG.qErr='Не удалось запросить цены: '+(e.message||e); }
  LG.qBusy=false; if ($('#lgdlg')?.open) lgResult();
}
const stNumLg = v => Number(v||0).toLocaleString('ru-RU');

function lgOnInput(e){
  const t=e.target, s=lgSup(); if (!s) return;
  // «change» у текстовых полей приходит при уходе из поля — уже учтено по «input»; перерисовка в этот момент
  // подменила бы кнопку под курсором («Подставить» не нажималась бы)
  if (e.type==='change' && t.tagName==='INPUT' && t.type!=='checkbox') return;
  if (t.dataset.lgf){ const f=t.dataset.lgf;
    if (f==='wh'){ s.wh=t.value; clearTimeout(LG.whT); LG.whT=setTimeout(()=>{ if (typeof dlSaveSupplier==='function') dlSaveSupplier(s); }, 800); }
    else s.lg[f]=t.value;
    persist(); return lgResult(); }
  if (t.dataset.lgi){ const id=t.dataset.lgi, f=t.dataset.f; s.lg.items=s.lg.items||{}; const o=s.lg.items[id]=s.lg.items[id]||{};
    if (String(t.value).trim()==='') delete o[f]; else o[f]=t.value;
    t.classList.toggle('own', String(t.value).trim()!==''); t.classList.toggle('need', lgV(t.value)==null && String(t.value).trim()==='');
    persist(); return lgResult(); }
  if (t.id==='lgDays'){ s.lg.setDays=t.checked; persist(); }
}

function lgOnClick(e){
  const b=e.target.closest('[data-lgx]'); if (!b) return;
  const dlg=$('#lgdlg'), s=lgSup(), r=LG.last;
  if (b.dataset.lgx==='close') return dlg.close();
  if (b.dataset.lgx==='quote') return lgQuote();
  const fin=LG.fin;
  if (b.dataset.lgx==='apply' && r && fin && fin.price>0){
    const ruSup=/^росс/i.test(s.country||'') || s.where==='ru', setDays=ruSup && !(s.lg&&s.lg.setDays===false);
    const note=`${r.from?r.from.name:'?'} → ${r.to?r.to.name:'?'}, ${r.km} км; ${r.vehicles.map(v=>v.C.name).join(' + ')}${r.unload?'; '+r.unload.name:''}; источник цены: ${fin.name}`;
    s.lg.res={ total:fin.price, km:r.km, note, foot:fin.foot, src:fin.name, at:new Date().toISOString(), ok:r.ok };
    dealSetLogistics(s.id, { ru:{v:fin.price}, note, ...(setDays?{ship:r.days}:{}) });
    dlg.close(); toast('Доставка по России: '+lgRub(fin.price)+' ('+fin.name+')'+(setDays?` · в пути ${r.days} дн.`:''));
    lgSaveCargo(s);
  }
}

// вписанные в расчёт масса и габариты — в характеристики позиции КП и в карточку каталога
// (иначе при сохранении КП каталог получил бы прежние характеристики позиции)
async function lgSaveCargo(s){
  const own=(s.lg&&s.lg.items)||{}, its=lgItems(s);
  let saved=0, pend=0; const noCat=[], fail=[];
  for (const id of Object.keys(own)){
    const o=own[id], x=S.items.find(i=>i.id===id), it=its.find(i=>i.id===id); if (!x || !it) continue;
    const v={l:it.l.v, w:it.w.v, h:it.h.v, m:it.m.v};
    const what={ dims:['l','w','h'].some(k=>lgV(o[k])!=null) && v.l>0 && v.w>0 && v.h>0, mass:lgV(o.m)!=null && v.m>0 };
    if (!what.dims && !what.mass) continue;
    lgWriteCargo(x, v, what);
    if (!x.catId){ noCat.push(x.name); delete own[id]; continue; }
    try{ const doc=await CatSrv.get(x.catId); lgWriteCargo(doc, v, what); doc.updatedAt=new Date().toISOString();
      const r=await CatSrv.put(doc); if (r && r._pending) pend++; else saved++; delete own[id]; }
    catch(e){ fail.push(x.name+(e.code==='conflict'?' (карточку изменили — откройте расчёт заново)':'')); }
  }
  persist(); if (typeof renderForm==='function') renderForm();
  if (saved||pend||noCat.length||fail.length){
    if (typeof refreshCat==='function') refreshCat();
    toast([saved?`Масса и габариты сохранены в каталог: ${saved}`:'', pend?`отправлено на модерацию: ${pend}`:'', noCat.length?`нет в каталоге (записано только в КП): ${noCat.join(', ')}`:'',
      fail.length?`не сохранено: ${fail.join(', ')}`:''].filter(Boolean).join(' · ')); }
}

// ---------- «Настройки» → «Логистика»: тарифы (администратор)
const LG_SC=[['hub','Импорт: город СВХ / терминала по умолчанию','text'],['permitAgent','Оформление разрешения через агента, ₽',''],['overKLowbed','Негабарит на трале: множитель ставки',''],['roadK','Коэффициент дорог: европейская часть',''],['roadKE','… Урал и Сибирь',''],['roadKFE','… восточнее Байкала',''],
  ['localKm','Доставка по городу, км',''],['pack','Упаковка лёгких мест, % к массе',''],['packMax','Без упаковки — места тяжелее, т',''],
  ['overK','Негабарит на площадке: множитель ставки',''],['permit','Госпошлина за спецразрешение, ₽ за машину',''],['heavyFrom','Тяжеловес — груз в машине тяжелее, т',''],
  ['heavyPermit','Госпошлина за разрешение на тяжеловес, ₽',''],['harmKm','Вред дорогам (тяжеловес), ₽/км',''],['escortW','Прикрытие — груз шире, м',''],['escortKm','Автомобиль прикрытия, ₽/км',''],
  ['kmDay','Пробег в сутки, км',''],['kmDayOver','Пробег негабарита в сутки, км',''],['permitDays','Оформление разрешения, раб. дней',''],['range','Разброс оценки, ± %','']];
const LG_CC=[['name','Транспорт','text'],['L','Длина площадки, м'],['W','Ширина, м'],['h','Высота груза, м'],['hMax','Высота со спецразр., м'],['wMax','Ширина со спецразр., м'],
  ['t','Грузоподъём., т'],['km','₽/км'],['base','Подача, ₽'],['min','Минимум, ₽']];

async function stLogistics(m){
  await lgLoad(true);
  let stt=null; try{ stt=await api('/api/logistics/status'); }catch(e){}
  const au=(stt&&stt.auto)||null, cfg=(stt&&stt.settings)||{on:true, days:1, period:30, routes:[]}, pv=(stt&&stt.providers)||{};
  const T=LG.tar, inp=(v,t)=>`<input type="${t==='text'?'text':'text'}" inputmode="${t==='text'?'text':'decimal'}" value="${esc(t==='text'?v:lgIn(v))}">`;
  m.innerHTML=`<div class="st-card"><div class="sub st-mh">Тарифы доставки по России ${tip('<p>По ним «Экономика сделки» считает доставку со склада поставщика до объекта: машина подбирается по массе и габаритам груза, к ставке за км добавляются подача, негабарит, тяжеловес, прикрытие и разгрузка.</p><p>Стандартные значения — ориентир. Уточните ставки по 5–10 последним счетам перевозчиков.</p><p>Негабарит по правилам РФ: шире 2,55 м или выше 4 м от дороги (высота груза на площадке указана в столбце «Высота груза»).</p>')}</div>
    <details class="lg-src"><summary>Откуда стандартные ставки</summary><ul>${LG_DEFAULTS.sources.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>
    <p class="muted">${LG.saved&&LG.saved.updatedAt?`Изменены ${esc(stTime(LG.saved.updatedAt))}${LG.saved.updatedBy?' · '+esc(LG.saved.updatedBy):''}`:'Стандартные значения — уточните по счетам перевозчиков'}</p>
    <div class="lg-auto">
      <div class="sub st-mh">Автообновление ставок за км ${tip('<p>Раз в заданное число дней программа запрашивает у ATI.SU «Средние ставки» по опорным направлениям и берёт <b>верхнюю границу</b> средних ставок за период (с НДС) — максимум по направлениям — для каждого класса машины.</p><p>Нужна лицензия «API Средних ставок» ATI.SU и ключ в «Интеграциях». Снимите галочку «Авто» у машины, чтобы закрепить свою ставку.</p>')}</div>
      <p class="${pv.ati?'muted':'bad-t'}">${pv.ati?'Ключ ATI.SU задан.':'Ключ ATI.SU не задан — автообновление не работает («Интеграции» → ключ ATI.SU).'}
        ${au&&au.at?` Последнее обновление: <b>${esc(stTime(au.at))}</b>, классов обновлено: ${Object.keys(au.classes||{}).length}.`:' Обновлений ещё не было.'}</p>
      ${au&&(au.errors||[]).length?`<details class="lg-src"><summary>Замечания последнего обновления (${au.errors.length})</summary><ul>${au.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}
      <div class="lg-autog"><label class="cw-chk"><input type="checkbox" id="lgAuOn"${cfg.on!==false?' checked':''}> обновлять автоматически</label>
        <label class="f"><span>раз в, дней</span><input type="text" inputmode="numeric" id="lgAuDays" value="${esc(cfg.days||1)}"></label>
        <label class="f"><span>период ставок, дней</span><input type="text" inputmode="numeric" id="lgAuPer" value="${esc(cfg.period||30)}"></label>
        <button class="btn" type="button" data-lgref${pv.ati?'':' disabled'}>Обновить сейчас</button></div>
      <label class="f"><span>Опорные направления (по одному в строке: «Откуда — Куда»)</span><textarea id="lgAuRt" rows="4">${esc((cfg.routes||[]).join('\n'))}</textarea></label>
    </div>
    <div class="lg-tw"><table class="lg-st" id="lgCl"><thead><tr>${LG_CC.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th>Открытая</th><th>Авто</th><th>Источник ставки</th><th></th></tr></thead><tbody>
      ${T.classes.map((c,i)=>`<tr data-i="${i}" data-id="${esc(c.id)}">${LG_CC.map(([k,,t])=>`<td data-k="${k}">${k==='km'&&c.srcAuto?inp(c[k],t).replace('<input','<input readonly title="Ставка из автообновления — снимите «Авто», чтобы задать свою"'):inp(c[k],t)}</td>`).join('')}<td><input type="checkbox" data-k="open"${c.open?' checked':''} aria-label="Открытая площадка"></td>
        <td><input type="checkbox" data-k="auto"${c.auto!==false?' checked':''} aria-label="Ставка из автообновления"></td><td class="lg-srcc" title="${esc(c.src||'')}">${c.srcAuto?'ATI.SU · верх средних ставок':esc(c.src||'')}${c.srcAt?'<br>'+esc(stTime(c.srcAt)):''}</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td></tr>`).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="cl">+ Транспорт</button>
    <p class="sub" style="margin-top:14px">Разгрузка на объекте</p>
    <div class="lg-tw"><table class="lg-st" id="lgUn"><thead><tr><th>Техника</th><th>Масса места до, т</th><th>Стоимость, ₽</th><th></th></tr></thead><tbody>
      ${T.unload.map(u=>`<tr data-id="${esc(u.id)}"><td data-k="name">${inp(u.name,'text')}</td><td data-k="max">${inp(u.max)}</td><td data-k="cost">${inp(u.cost)}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td></tr>`).join('')}
    </tbody></table></div><button class="btn ghost" type="button" data-lgadd="un">+ Техника</button>
    <p class="sub" style="margin-top:14px">Общие параметры</p>
    <div class="lg-sc">${LG_SC.map(([k,l,t])=>`<label class="f"><span>${esc(l)}</span>${inp(T[k],t).replace('<input','<input data-sc="'+k+'"')}</label>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-lgsave>Сохранить тарифы</button><button class="btn ghost" type="button" data-lgreset>Вернуть стандартные</button></div></div>`;
  const read=()=>{
    const cls=[...m.querySelectorAll('#lgCl tbody tr')].map(tr=>{ const o={id:tr.dataset.id||('c'+Math.random().toString(36).slice(2,7))};
      tr.querySelectorAll('td[data-k]').forEach(td=>{ const k=td.dataset.k, v=td.querySelector('input').value.trim(); o[k]= k==='name' ? v : lgV(v); });
      o.open=tr.querySelector('[data-k=open]').checked; const au2=tr.querySelector('[data-k=auto]'); o.auto=au2?au2.checked:true;
      if (o.auto && tr.querySelector('td[data-k=km] input[readonly]')){ const d=LG_DEFAULTS.classes.find(x=>x.id===o.id); const prev=(LG.saved&&Array.isArray(LG.saved.classes)?LG.saved.classes.find(x=>x.id===o.id):null);
        o.km = prev&&prev.km>0 ? +prev.km : d ? d.km : o.km; }   // своя ставка остаётся запасной, пока работает автообновление
      return o; }).filter(o=>o.name);
    const un=[...m.querySelectorAll('#lgUn tbody tr')].map(tr=>{ const o={id:tr.dataset.id||('u'+Math.random().toString(36).slice(2,7))};
      tr.querySelectorAll('td[data-k]').forEach(td=>{ const k=td.dataset.k, v=td.querySelector('input').value.trim(); o[k]= k==='name' ? v : lgV(v); }); return o; }).filter(o=>o.name);
    const bad=cls.find(c=>['L','W','h','t','km'].some(k=>!(c[k]>0)));
    if (bad) throw new Error(`«${bad.name}»: укажите длину, ширину, высоту, грузоподъёмность и ставку`);
    const out={classes:cls.sort((a,b)=>a.t-b.t), unload:un.sort((a,b)=>a.max-b.max)};
    m.querySelectorAll('[data-sc]').forEach(x=>{ const k=x.dataset.sc; out[k]= k==='hub' ? x.value.trim() : lgV(x.value); });
    out.auto={ on:$('#lgAuOn').checked, days:Math.max(1, Math.round(lgV($('#lgAuDays').value)||1)), period:Math.min(365, Math.max(7, Math.round(lgV($('#lgAuPer').value)||30))),
      routes:$('#lgAuRt').value.split('\n').map(x=>x.trim()).filter(x=>/[—-]/.test(x)).slice(0,30) };
    return out; };
  m.onclick=async e=>{
    const del=e.target.closest('[data-lgdel]'); if (del){ del.closest('tr').remove(); return; }
    const ref=e.target.closest('[data-lgref]');
    if (ref){ ref.disabled=true; ref.textContent='Обновляю…';
      try{ const out=read(); await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(out)});
        const r=await api('/api/logistics/refresh',{method:'POST'});
        toast(r.error ? r.error : `Ставки обновлены: ${Object.keys(r.classes||{}).length} классов${(r.errors||[]).length?`, замечаний: ${r.errors.length}`:''}`); }
      catch(err){ toast('Не обновлено: '+(err.message||err)); }
      return stLogistics(m); }
    const add=e.target.closest('[data-lgadd]');
    if (add){ const tb=m.querySelector(add.dataset.lgadd==='cl'?'#lgCl tbody':'#lgUn tbody'), tr=document.createElement('tr');
      tr.innerHTML = add.dataset.lgadd==='cl' ? LG_CC.map(([k,,t])=>`<td data-k="${k}">${inp('',t)}</td>`).join('')+'<td><input type="checkbox" data-k="open" aria-label="Открытая площадка"></td><td><input type="checkbox" data-k="auto" aria-label="Ставка из автообновления"></td><td class="lg-srcc">вручную</td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td>'
        : `<td data-k="name">${inp('','text')}</td><td data-k="max">${inp('')}</td><td data-k="cost">${inp('')}</td><td><button class="icon" type="button" data-lgdel="un" aria-label="Убрать">✕</button></td>`;
      tb.appendChild(tr); tr.querySelector('input').focus(); return; }
    if (e.target.closest('[data-lgsave]')){
      try{ const out=read(); await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(out)}); toast('Тарифы сохранены'); stLogistics(m); }
      catch(err){ toast('Не сохранено: '+(err.message||err)); } return; }
    if (e.target.closest('[data-lgreset]')){
      if (!confirm('Вернуть стандартные тарифы доставки? Ваши ставки будут заменены.')) return;
      try{ await api('/api/logistics',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:'{}'}); toast('Стандартные тарифы'); stLogistics(m); }catch(err){ toast('Не сохранено: '+err.message); } }
  };
}
