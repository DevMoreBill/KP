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
  const d=dlDeal(), s=d.sup[k]; if (!s) return;
  if (!s.lg) s.lg={};
  LG.k=k;
  let dlg=$('#lgdlg');
  if (!dlg){ dlg=document.createElement('dialog'); dlg.id='lgdlg'; dlg.className='lgwin'; document.body.appendChild(dlg);
    dlg.addEventListener('input', lgOnInput); dlg.addEventListener('change', lgOnInput); dlg.addEventListener('click', lgOnClick);
    dlg.addEventListener('close', ()=>{ if (typeof dealRender==='function' && $('#dealdlg')?.open) dealRender(); }); }
  lgRender();
  if (!dlg.open) dlg.showModal();
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
  box.innerHTML=`${veh}
    ${r.unload?`<div class="lg-veh"><table class="lg-p"><tr><td>Разгрузка: ${esc(r.unload.name)}</td><td class="num">${lgRub(r.unload.cost)}</td></tr></table></div>`:''}
    ${r.warn.map(w=>`<p class="msg warn">${esc(w)}</p>`).join('')}
    ${r.missing.length?`<p class="msg warn">Не посчитаны (нет массы или габаритов): ${esc(r.missing.join(', '))}</p>`:''}
    <div class="lg-tot"><div><small>Доставка по России${r.ok?'':' — неполная оценка'}</small><b>${lgRub(r.total)}</b><span class="muted">диапазон ${lgRub(r.lo)} – ${lgRub(r.hi)} · в пути ≈ ${r.days} ${plural(r.days,'день','дня','дней')}${r.over?` (с оформлением разрешения ${T.permitDays} раб. дн.)`:''}</span></div>
      <div class="lg-act">${ruSup?`<label class="cw-chk"><input type="checkbox" id="lgDays"${s.lg&&s.lg.setDays===false?'':' checked'}> срок в пути → «Доставка до заказчика»</label>`:''}
        <button class="btn primary" type="button" data-lgx="apply"${r.total>0?'':' disabled'}>Подставить ${lgRub(r.total)}</button></div></div>
    <p class="muted lg-note">Оценка по тарифам «Настроек» (${LG.saved&&LG.saved.updatedAt?'обновлены '+esc(stTime(LG.saved.updatedAt)):'стандартные — уточните по счетам перевозчиков'}). Погрузка на складе поставщика обычно за его счёт.</p>`;
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
  if (b.dataset.lgx==='apply' && r && r.total>0){
    const ruSup=/^росс/i.test(s.country||'') || s.where==='ru', setDays=ruSup && !(s.lg&&s.lg.setDays===false);
    const note=`${r.from?r.from.name:'?'} → ${r.to?r.to.name:'?'}, ${r.km} км; ${r.vehicles.map(v=>v.C.name).join(' + ')}${r.unload?'; '+r.unload.name:''}`;
    s.lg.res={ total:Math.round(r.total), km:r.km, note, at:new Date().toISOString(), ok:r.ok };
    dealSetLogistics(s.id, { ru:{v:Math.round(r.total)}, note, ...(setDays?{ship:r.days}:{}) });
    dlg.close(); toast('Доставка по России: '+lgRub(r.total)+(setDays?` · в пути ${r.days} дн.`:''));
  }
}

// ---------- «Настройки» → «Логистика»: тарифы (администратор)
const LG_SC=[['hub','Импорт: город СВХ / терминала по умолчанию','text'],['roadK','Коэффициент дорог: европейская часть',''],['roadKE','… Урал и Сибирь',''],['roadKFE','… восточнее Байкала',''],
  ['localKm','Доставка по городу, км',''],['pack','Упаковка лёгких мест, % к массе',''],['packMax','Без упаковки — места тяжелее, т',''],
  ['overK','Негабарит: множитель ставки за км',''],['permit','Спецразрешение на негабарит, ₽ за машину',''],['heavyFrom','Тяжеловес — груз в машине тяжелее, т',''],
  ['heavyPermit','Разрешение на тяжеловес, ₽ за машину',''],['harmKm','Вред дорогам (тяжеловес), ₽/км',''],['escortW','Прикрытие — груз шире, м',''],['escortKm','Автомобиль прикрытия, ₽/км',''],
  ['kmDay','Пробег в сутки, км',''],['kmDayOver','Пробег негабарита в сутки, км',''],['permitDays','Оформление разрешения, раб. дней',''],['range','Разброс оценки, ± %','']];
const LG_CC=[['name','Транспорт','text'],['L','Длина площадки, м'],['W','Ширина, м'],['h','Высота груза, м'],['hMax','Высота со спецразр., м'],['wMax','Ширина со спецразр., м'],
  ['t','Грузоподъём., т'],['km','₽/км'],['base','Подача, ₽'],['min','Минимум, ₽']];

async function stLogistics(m){
  await lgLoad(true);
  const T=LG.tar, inp=(v,t)=>`<input type="${t==='text'?'text':'text'}" inputmode="${t==='text'?'text':'decimal'}" value="${esc(t==='text'?v:lgIn(v))}">`;
  m.innerHTML=`<div class="st-card"><div class="sub st-mh">Тарифы доставки по России ${tip('<p>По ним «Экономика сделки» считает доставку со склада поставщика до объекта: машина подбирается по массе и габаритам груза, к ставке за км добавляются подача, негабарит, тяжеловес, прикрытие и разгрузка.</p><p>Стандартные значения — ориентир. Уточните ставки по 5–10 последним счетам перевозчиков.</p><p>Негабарит по правилам РФ: шире 2,55 м или выше 4 м от дороги (высота груза на площадке указана в столбце «Высота груза»).</p>')}</div>
    <p class="muted">${LG.saved&&LG.saved.updatedAt?`Изменены ${esc(stTime(LG.saved.updatedAt))}${LG.saved.updatedBy?' · '+esc(LG.saved.updatedBy):''}`:'Стандартные значения — уточните по счетам перевозчиков'}</p>
    <div class="lg-tw"><table class="lg-st" id="lgCl"><thead><tr>${LG_CC.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th>Открытая</th><th></th></tr></thead><tbody>
      ${T.classes.map((c,i)=>`<tr data-i="${i}" data-id="${esc(c.id)}">${LG_CC.map(([k,,t])=>`<td data-k="${k}">${inp(c[k],t)}</td>`).join('')}<td><input type="checkbox" data-k="open"${c.open?' checked':''} aria-label="Открытая площадка"></td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td></tr>`).join('')}
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
      o.open=tr.querySelector('[data-k=open]').checked; return o; }).filter(o=>o.name);
    const un=[...m.querySelectorAll('#lgUn tbody tr')].map(tr=>{ const o={id:tr.dataset.id||('u'+Math.random().toString(36).slice(2,7))};
      tr.querySelectorAll('td[data-k]').forEach(td=>{ const k=td.dataset.k, v=td.querySelector('input').value.trim(); o[k]= k==='name' ? v : lgV(v); }); return o; }).filter(o=>o.name);
    const bad=cls.find(c=>['L','W','h','t','km'].some(k=>!(c[k]>0)));
    if (bad) throw new Error(`«${bad.name}»: укажите длину, ширину, высоту, грузоподъёмность и ставку`);
    const out={classes:cls.sort((a,b)=>a.t-b.t), unload:un.sort((a,b)=>a.max-b.max)};
    m.querySelectorAll('[data-sc]').forEach(x=>{ const k=x.dataset.sc; out[k]= k==='hub' ? x.value.trim() : lgV(x.value); });
    return out; };
  m.onclick=async e=>{
    const del=e.target.closest('[data-lgdel]'); if (del){ del.closest('tr').remove(); return; }
    const add=e.target.closest('[data-lgadd]');
    if (add){ const tb=m.querySelector(add.dataset.lgadd==='cl'?'#lgCl tbody':'#lgUn tbody'), tr=document.createElement('tr');
      tr.innerHTML = add.dataset.lgadd==='cl' ? LG_CC.map(([k,,t])=>`<td data-k="${k}">${inp('',t)}</td>`).join('')+'<td><input type="checkbox" data-k="open" aria-label="Открытая площадка"></td><td><button class="icon" type="button" data-lgdel="cl" aria-label="Убрать">✕</button></td>'
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
