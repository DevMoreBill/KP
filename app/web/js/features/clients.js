// Контрагенты: поиск по ИНН, справочник клиентов, проверка Checko, ключи API.
'use strict';

const PURPOSES=['Резервное электроснабжение','Основной источник питания','Строительная площадка','Котельная','Производство','Сжатый воздух для производства','Водоснабжение / водоотведение'];

function validInn(v){ const s=String(v||'').replace(/\D/g,''); const c=(d,k)=>k.reduce((t,x,n)=>t+x*+d[n],0)%11%10;
  if (s.length===10) return c(s,[2,4,10,3,5,9,4,6,8])===+s[9];
  if (s.length===12) return c(s,[7,2,4,10,3,5,9,4,6,8])===+s[10] && c(s,[3,7,2,4,10,3,5,9,4,6,8])===+s[11];
  return false; }

let CLIENTS=[];

async function loadClients(){ try{ CLIENTS = await api('/api/clients'); }catch(e){ CLIENTS=[]; } }

function clientIdOf(){ const inn=String(S.clientInn||'').replace(/\D/g,''); if (inn) return 'inn'+inn;
  return S.clientId || ('c'+Date.now().toString(36)); }

function curClient(){ const id=S.clientId||(S.clientInn?'inn'+String(S.clientInn).replace(/\D/g,''):''); return id?CLIENTS.find(c=>c.id===id):null; }

async function saveClient(usedInKp){
  if (!S.client.trim()) return null;
  const id=clientIdOf(); S.clientId=id;
  const c={ id, name:S.client.trim(), full:S.clientFull, inn:S.clientInn, kpp:S.clientKpp, ogrn:S.clientOgrn, address:S.clientAddr, director:S.clientDir, directorPost:S.clientDirPost,
    status:S.clientStatus, source:S.clientSrc||'', usedAt:new Date().toISOString(),
    contacts: S.contact.name?[{...S.contact}]:[], objects:(S.object.purpose||S.object.address)?[{...S.object}]:[], check:S.check||null, _usedInKp:!!usedInKp };
  try{
    const saved=await api('/api/clients/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(c)});
    await loadClients(); return saved;
  }catch(e){ toast('Контрагент не сохранён: '+e.message); return null; }
}

function applyClient(c){
  Object.assign(S,{ clientId:c.id, client:c.name||'', clientFull:c.full||'', clientInn:c.inn||'', clientKpp:c.kpp||'', clientOgrn:c.ogrn||'', clientAddr:c.address||'',
    clientDir:c.director||'', clientDirPost:c.directorPost||'', clientStatus:c.status||'', clientSrc:c.source||'', check:c.check||null });
  if (c.contacts&&c.contacts[0] && !S.contact.name) S.contact={...S.contact,...c.contacts[0]};
  S._clEdit=false; S._clManual=false;
  renderForm(); persist(); toast('Контрагент подставлен: '+(c.name||''));
}

async function partyFind(){
  const inn=String(S.clientInn||'').replace(/\D/g,'');
  if (!validInn(inn)) return toast('Проверьте ИНН: 10 цифр у организации, 12 — у ИП');
  const known=CLIENTS.find(c=>String(c.inn||'').replace(/\D/g,'')===inn);
  const msg=$('#partyMsg'); if(msg) msg.textContent='Ищу организацию…';
  try{
    const r=await api('/api/party?inn='+inn);
    if (r.error){ if (known) return applyClient(known); if(msg){ msg.textContent=r.error; msg.classList.add('bad-t'); } return; }
    Object.assign(S,{ clientInn:r.inn||inn, clientKpp:r.kpp||'', clientOgrn:r.ogrn||'', clientFull:r.full||'', clientAddr:r.address||'',
      clientDir:r.director||'', clientDirPost:r.directorPost||'', clientStatus:r.status||'', clientSrc:r.source||'' });
    S.client = shortName(r.short||r.full||S.client);
    if (known){ if (known.contacts&&known.contacts[0]&&!S.contact.name) S.contact={...S.contact,...known.contacts[0]}; }
    S.clientId='inn'+(r.inn||inn);
    S._clManual=false; renderForm(); persist(); toast('Реквизиты заполнены ('+(r.source||'')+')'); saveClient(false);
    if (r.active===false) toast('Внимание: организация не действует — '+(r.status||''));
  }catch(e){ if(msg) msg.textContent='Ошибка запроса: '+e.message; }
}

// Название клиента в КП — краткое наименование из выписки (ЕГРЮЛ / Checko / DaData) как есть:
// регистр букв и кавычки не меняются. Если краткого нет и пришло полное — сокращается только
// организационно-правовая форма («ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ» → «ООО»).
const OPF_SHORT=[[/^ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ\s*/i,'ООО'],[/^ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ПАО'],[/^НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'АО'],
  [/^АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'АО'],[/^ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ЗАО'],[/^ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО\s*/i,'ОАО'],[/^ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ\s*/i,'ИП'],
  [/^ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'ФГУП'],[/^МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'МУП'],[/^ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\s*/i,'ГУП']];
function shortName(s){
  s=String(s||'').replace(/\s+/g,' ').trim(); if (!s) return s;
  for (const [rx,ab] of OPF_SHORT) if (rx.test(s)) return ab+' '+s.replace(rx,'');
  return s;
}

function checkLine(){
  const c=S.check; const inn=String(S.clientInn||'').replace(/\D/g,'');
  if (!validInn(inn)) return '';
  if (!c) return `<div class="chk-line"><span class="muted">Проверка контрагента по данным Checko — только для вас, в КП не попадает.</span><button class="btn ghost" type="button" data-a="checkRun">Проверить</button></div>`;
  if (c.error) return `<div class="chk-line warn"><span>${c.error==='nokey'?'Проверка Checko: не задан API-ключ.':esc(c.message||c.error)}</span>${c.error==='nokey'?'<button class="btn ghost" type="button" data-a="integrations">Указать ключ Checko</button>':'<button class="btn ghost" type="button" data-a="checkRun">Повторить</button>'}</div>`;
  const label={ok:'Существенных рисков не найдено',warn:'Есть на что обратить внимание',bad:'Высокий риск'}[c.score]||'';
  const facts=[['Регистрация',c.regDate?KPGen.ruDate(c.regDate.slice(0,10))+(c.ageYears!=null?` (${String(c.ageYears).replace('.',',')} г.)`:''):''],['Уставный капитал',c.capital!=null?fmtRub(c.capital):''],
    ['Сотрудников',c.employees!=null?String(c.employees):''],['Категория МСП',c.msp],['Основной ОКВЭД',c.okved],['Налоговая недоимка',c.taxDebt?fmtRub(c.taxDebt):'нет'],
    ['Арбитраж (ответчик)',c.courts&&c.courts.count?`${c.courts.count} дел на ${fmtRub(c.courts.sum)}`:'нет'],['Исполнительные производства',c.fssp&&c.fssp.count?`${c.fssp.count}${c.fssp.sum?' на '+fmtRub(c.fssp.sum):''}`:'нет']].filter(x=>x[1]);
  return `<details class="chk ${c.score}"><summary><b>Checko: ${esc(label)}</b> <span class="muted">· ${esc(KPGen.ruDate((c.checkedAt||'').slice(0,10)))} · подробнее</span></summary>
    <ul class="flags">${(c.flags||[]).map(f=>`<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>
    <dl class="facts">${facts.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${(c.finances||[]).length?`<table class="fin"><tr><th>Год</th><th>Выручка</th><th>Чистая прибыль</th></tr>${c.finances.map(f=>`<tr><td>${esc(f.year)}</td><td>${fmtRub(f.revenue)}</td><td class="${f.profit<0?'bad-t':''}">${fmtRub(f.profit)}</td></tr>`).join('')}</table>`:''}
    <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="checkRun" data-force="1">Обновить проверку</button><a class="btn ghost" href="${esc(c.url||'https://checko.ru/search?query='+inn)}" target="_blank" rel="noopener">Открыть на checko.ru</a>${c.quota&&c.quota.balance!=null?`<span class="muted">Остаток запросов: ${esc(c.quota.balance)}</span>`:''}</div></details>`;
}

async function checkRun(force){
  const inn=String(S.clientInn||'').replace(/\D/g,''); if(!validInn(inn)) return toast('Укажите корректный ИНН');
  const b=document.querySelector('[data-a="checkRun"]'); if(b){ b.disabled=true; b.textContent='Проверяю…'; }
  try{ S.check=await api('/api/check?inn='+inn+(force?'&force=1':'')); }catch(e){ S.check={error:'net',message:'Ошибка запроса: '+e.message,url:'https://checko.ru/search?query='+inn}; }
  renderForm(); persist(); if (!S.check.error && S.client) saveClient(false);
}

async function openIntegrations(){
  const d=$('#dlg'); d.classList.remove('wide');
  let k={}; try{ k=await api('/api/integrations'); }catch(e){}
  d.innerHTML=`<div class="dlg-h"><h3>Интеграции</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><p class="muted" style="margin-top:0">Реквизиты по ИНН подтягиваются без ключей — из открытого сервиса ФНС (egrul.nalog.ru). С ключами данные полнее и быстрее, а Checko дополнительно проверяет контрагента. Ключи хранятся только на этом компьютере (в папке данных программы).</p>
   <label class="f"><span>API-ключ Checko ${k.checko?`<b class="ok-t">задан: ${esc(k.checkoMask)}</b>`:''}</span><input type="text" id="kChecko" placeholder="${k.checko?'Оставьте пустым, чтобы не менять':'Ключ из личного кабинета checko.ru → API'}" autocomplete="off"></label>
   <p class="muted">Checko: реквизиты, статус, финансы, суды, ФССП, реестры. Ключ — в личном кабинете checko.ru, раздел «API» (есть бесплатный тестовый лимит).</p>
   <label class="f"><span>API-ключ DaData ${k.dadata?`<b class="ok-t">задан: ${esc(k.dadataMask)}</b>`:''}</span><input type="text" id="kDadata" placeholder="${k.dadata?'Оставьте пустым, чтобы не менять':'Ключ из личного кабинета dadata.ru'}" autocomplete="off"></label>
   <p class="muted">DaData: быстрый поиск реквизитов по ИНН (бесплатно до 10 000 запросов в день).</p>
   <div class="row"><button class="btn primary" type="button" id="kSave">Сохранить</button>${k.checko?'<button class="btn ghost" type="button" id="kDelC">Удалить ключ Checko</button>':''}${k.dadata?'<button class="btn ghost" type="button" id="kDelD">Удалить ключ DaData</button>':''}</div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  const put=async body=>{ await api('/api/integrations',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)}); toast('Сохранено'); openIntegrations(); };
  $('#kSave').onclick=()=>{ const b={}; const c=$('#kChecko').value.trim(), dd=$('#kDadata').value.trim(); if(c) b.checkoKey=c; if(dd) b.dadataKey=dd; put(b); };
  if ($('#kDelC')) $('#kDelC').onclick=()=>put({checkoKey:''}); if ($('#kDelD')) $('#kDelD').onclick=()=>put({dadataKey:''});
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset && t.dataset.p==='clientInn'){ const v=t.value.replace(/\D/g,''); t.classList.toggle('bad', !!v && !validInn(v) && (v.length>=10)); if ((v.length===10||v.length===12) && validInn(v) && v!==S._lastInn){ S._lastInn=v; setTimeout(partyFind,50); } } });

document.addEventListener('input', e=>{ if (e.target.id!=='clFind') return; const raw=e.target.value.trim(), q=norm(raw), L=$('#clList');
  const res=q?CLIENTS.filter(c=>norm([c.name,c.full,c.inn,c.address].join(' ')).includes(q)).slice(0,6):[];
  const inn=raw.replace(/\D/g,''), innOk=(inn.length===10||inn.length===12)&&/^\d[\d\s]*$/.test(raw)&&validInn(inn), known=res.some(c=>String(c.inn||'').replace(/\D/g,'')===inn);
  let html=res.map(c=>`<button type="button" data-clid="${esc(c.id)}"><b>${esc(c.name)}</b><span>${c.inn?'ИНН '+esc(c.inn)+' · ':''}${esc((c.address||'').slice(0,70))}${c.kpCount?' · КП: '+c.kpCount:''}</span></button>`).join('');
  if (innOk && !known) html+=`<button type="button" data-inn="${inn}"><b>Найти ИНН ${inn} в реестре</b><span>реквизиты подставятся автоматически</span></button>`;
  else if (/^\d+$/.test(inn) && inn.length>=10 && !innOk) html+=`<p class="muted" style="margin:10px 14px">ИНН с ошибкой: нужно 10 цифр (организация) или 12 (ИП)</p>`;
  else if (q && !res.length) html+=`<p class="muted" style="margin:10px 14px">Среди сохранённых не найдено. Введите ИНН — найдём в реестре.</p>`;
  L.hidden=!html; L.innerHTML=html; });

document.addEventListener('keydown', e=>{ if (e.target.id!=='clFind' || e.key!=='Enter') return; const b=$('#clList [data-clid], #clList [data-inn]'); if (b){ e.preventDefault(); b.click(); } });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-inn]'); if(!b) return; S.clientInn=b.dataset.inn; S._lastInn=b.dataset.inn; partyFind(); });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-clid]'); if(!b) return; const c=CLIENTS.find(x=>x.id===b.dataset.clid); if(c) applyClient(c); });
