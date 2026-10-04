// Контрагенты: поиск по ИНН, справочник клиентов, проверка Checko, ключи API.
'use strict';

const PURPOSES=['Резервное электроснабжение','Основной источник питания','Строительная площадка','Котельная','Производство','Сжатый воздух для производства','Водоснабжение / водоотведение'];

function validInn(v){ const s=String(v||'').replace(/\D/g,''); const c=(d,k)=>k.reduce((t,x,n)=>t+x*+d[n],0)%11%10;
  if (s.length===10) return c(s,[2,4,10,3,5,9,4,6,8])===+s[9];
  if (s.length===12) return c(s,[7,2,4,10,3,5,9,4,6,8])===+s[10] && c(s,[3,7,2,4,10,3,5,9,4,6,8])===+s[11];
  return false; }

// справочник контрагентов не грузится целиком (их тысячи): CLIENTS — последние использованные и найденные,
// поиск идёт на сервере; CLIENTS_ALL — сколько всего в справочнике
let CLIENTS=[], CLIENTS_ALL=0;
const CHECK_DAYS=30;   // через сколько дней проверка контрагента считается устаревшей
const CL_FETCH=new Set();

async function loadClients(){ try{ const r=await api('/api/clients?limit=50'); CLIENTS=r.items||[]; CLIENTS_ALL=r.all??CLIENTS.length; }catch(e){ CLIENTS=[]; } }

function clientsKeep(list){ for (const c of list||[]){ if (!c||!c.id) continue; const k=CLIENTS.findIndex(x=>x.id===c.id); if (k<0) CLIENTS.push(c); else CLIENTS[k]=c; } }

async function clientById(id){ if (!id) return null; const have=CLIENTS.find(c=>c.id===id); if (have) return have;
  try{ const c=await api('/api/clients/'+encodeURIComponent(id)); clientsKeep([c]); return c; }catch(e){ return null; } }

async function clientsFind(q, limit){ try{ const r=await api('/api/clients?limit='+(limit||6)+'&q='+encodeURIComponent(q)); clientsKeep(r.items); return r.items||[]; }catch(e){ return []; } }

function clientIdOf(){ const inn=String(S.clientInn||'').replace(/\D/g,''); if (inn) return 'inn'+inn;
  return S.clientId || ('c'+Date.now().toString(36)); }

function curClient(){ const id=S.clientId||(S.clientInn?'inn'+String(S.clientInn).replace(/\D/g,''):''); if (!id) return null;
  const c=CLIENTS.find(x=>x.id===id); if (c) return c;
  // нет среди загруженных — подгружаем с сервера один раз и перерисовываем форму
  if (!CL_FETCH.has(id)){ CL_FETCH.add(id); clientById(id).then(x=>{ if (x && typeof renderForm==='function') renderForm(); }); }
  return null; }

async function saveClient(usedInKp){
  if (!S.client.trim()) return null;
  const id=clientIdOf(); S.clientId=id;
  const c={ id, name:S.client.trim(), full:S.clientFull, inn:S.clientInn, kpp:S.clientKpp, ogrn:S.clientOgrn, address:S.clientAddr, director:S.clientDir, directorPost:S.clientDirPost,
    status:S.clientStatus, source:S.clientSrc||'', usedAt:new Date().toISOString(),
    contacts: S.contact.name?[{...S.contact}]:[], objects:(S.object.purpose||S.object.address)?[{...S.object}]:[], check:S.check||null, _usedInKp:!!usedInKp };
  try{
    const isNew=!CLIENTS.some(x=>x.id===id);
    const saved=await api('/api/clients/'+id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(c)});
    clientsKeep([saved]); if (isNew && !CL_FETCH.has(id)) CLIENTS_ALL++; return saved;
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
  const known=await clientById('inn'+inn);
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

// остаток проверок Checko на сегодня (на весь отдел): лимит 100 запросов в день, полная проверка — 4 запроса
let CHK_Q=null;
async function checkQuotaLoad(){ try{ CHK_Q=await api('/api/check/quota'); }catch(e){ CHK_Q=null; } return CHK_Q; }
function checkQuotaText(q){ q=q||CHK_Q; if (!q || !q.key) return '';
  if (q.left>=4) return `сегодня осталось ${q.checks} ${plural(q.checks,'полная проверка','полные проверки','полных проверок')} Checko`;
  if (q.left>0) return `сегодня осталось ${q.left} ${plural(q.left,'запрос','запроса','запросов')} Checko — будет краткая проверка`;
  return 'лимит Checko на сегодня исчерпан — будет бесплатная проверка по ФНС, полная — завтра автоматически'; }

function checkLine(){
  const c=S.check; const inn=String(S.clientInn||'').replace(/\D/g,'');
  if (!validInn(inn)) return '';
  if (!c){ if (!CHK_Q) checkQuotaLoad().then(q=>{ if (q && q.key) { const el=$('#chkQ'); if (el) el.textContent=checkQuotaText(q); } });
    return `<div class="chk-line"><button class="btn ghost" type="button" data-a="checkRun">Проверить контрагента</button><span class="muted" id="chkQ">${esc(checkQuotaText())}</span>${tip('<p>Проверка по данным Checko: регистрация, долги, суды, исполнительные производства. Видна только вам, в КП не попадает.</p><p>Бесплатно у Checko — 100 запросов в день на всех, полная проверка — 4 запроса. Если запросов не хватает, программа делает краткую проверку (1 запрос) или бесплатную по ФНС и сама выполняет полную на следующий день. Проверка хранится 7 дней и общая для отдела — повторная проверка того же ИНН запросы не тратит.</p>')}</div>`; }
  if (c.error) return `<div class="chk-line warn"><span>${c.error==='nokey'?'Проверка Checko: не задан API-ключ.':esc(c.message||c.error)}</span>${c.error==='nokey'?'<button class="btn ghost" type="button" data-a="integrations">Ключ — в «Настройках»</button>':'<button class="btn ghost" type="button" data-a="checkRun">Повторить</button>'}</div>`;
  // полная проверка стояла в очереди и могла уже выполниться (после 00:00 по Москве) — подтянуть её один раз
  if (c.queued && c.checkedAt && new Date(c.checkedAt).toDateString()!==new Date().toDateString() && S._chkAuto!==inn){ S._chkAuto=inn; setTimeout(()=>checkRun(false), 50); }
  const label={ok:'Существенных рисков не найдено',warn:'Есть на что обратить внимание',bad:'Высокий риск'}[c.score]||'';
  const age=c.checkedAt?(Date.now()-new Date(c.checkedAt))/864e5:0, old=age>CHECK_DAYS;   // проверка старше месяца — предложить обновить
  const nc='не проверено', src=c.free?`Бесплатная проверка (${c.source})`:c.partial?'Checko, краткая проверка':'Checko';
  const facts=[['Регистрация',c.regDate?KPGen.ruDate(c.regDate.slice(0,10))+(c.ageYears!=null?` (${String(c.ageYears).replace('.',',')} г.)`:''):''],['Уставный капитал',c.capital!=null?fmtRub(c.capital):''],
    ['Сотрудников',c.employees!=null?String(c.employees):''],['Категория МСП',c.msp],['Основной ОКВЭД',c.okved],['Налоговая недоимка',c.free?nc:c.taxDebt?fmtRub(c.taxDebt):'нет'],
    ['Арбитраж (ответчик)',!c.courts||c.courts.count==null?nc:c.courts.count?`${c.courts.count} дел на ${fmtRub(c.courts.sum)}`:'нет'],
    ['Исполнительные производства',!c.fssp||c.fssp.count==null?nc:c.fssp.count?`${c.fssp.count}${c.fssp.sum?' на '+fmtRub(c.fssp.sum):''}`:'нет']].filter(x=>x[1]);
  const q=c.quotaNow;
  return `<details class="chk ${c.score}"><summary><b>${esc(src)}: ${esc(label)}</b> <span class="muted">· ${esc(KPGen.ruDate((c.checkedAt||'').slice(0,10)))} · подробнее</span>${c.queued?' <span class="chk-old" title="Выполнится автоматически, когда обновится лимит Checko (после 00:00 по Москве)">полная — в очереди</span>':''}${old?` <span class="chk-old" title="Данные могли измениться">проверке ${Math.floor(age)} дн. — обновите</span>`:''}</summary>
    ${c.note?`<p class="chk-note">${esc(c.note)}</p>`:''}
    <ul class="flags">${(c.flags||[]).map(f=>`<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>
    ${(c.missing||[]).length?`<p class="muted chk-miss">Не проверено: ${esc(c.missing.join(', '))}.</p>`:''}
    <dl class="facts">${facts.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${(c.finances||[]).length?`<table class="fin"><tr><th>Год</th><th>Выручка</th><th>Чистая прибыль</th></tr>${c.finances.map(f=>`<tr><td>${esc(f.year)}</td><td>${fmtRub(f.revenue)}</td><td class="${f.profit<0?'bad-t':''}">${fmtRub(f.profit)}</td></tr>`).join('')}</table>`:''}
    ${(c.links||[]).length?`<p class="chk-links"><span class="muted">Проверить вручную (бесплатно):</span> ${c.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}</p>`:''}
    <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="checkRun" data-force="1">Обновить проверку</button><a class="btn ghost" href="${esc(c.url||'https://checko.ru/search?query='+inn)}" target="_blank" rel="noopener">Открыть на checko.ru</a>${q&&q.key?`<span class="muted">${q.left?`Checko сегодня: осталось ${q.left} из ${q.limit} запросов`:'Лимит Checko на сегодня исчерпан, обновится в 00:00 по Москве'}${q.queue?` · в очереди: ${q.queue}`:''}</span>`:''}</div></details>`;
}

async function checkRun(force){
  const inn=String(S.clientInn||'').replace(/\D/g,''); if(!validInn(inn)) return toast('Укажите корректный ИНН');
  const b=document.querySelector('[data-a="checkRun"]'); if(b){ b.disabled=true; b.textContent='Проверяю…'; }
  try{ S.check=await api('/api/check?inn='+inn+(force?'&force=1':'')); }catch(e){ S.check={error:'net',message:'Ошибка запроса: '+e.message,url:'https://checko.ru/search?query='+inn}; }
  if (S.check && S.check.quotaNow) CHK_Q=S.check.quotaNow;
  renderForm(); persist(); if (!S.check.error && S.client) saveClient(false);
}

async function openIntegrations(){
  const d=$('#dlg'); d.classList.remove('wide');
  let k={}; try{ k=await api('/api/integrations'); }catch(e){}
  d.innerHTML=`<div class="dlg-h"><h3>Интеграции</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><p class="muted" style="margin-top:0">Реквизиты по ИНН подтягиваются без ключей — из открытого сервиса ФНС (egrul.nalog.ru). С ключами данные полнее и быстрее, а Checko дополнительно проверяет контрагента. Ключи хранятся только на этом компьютере (в папке данных программы).</p>
   <label class="f"><span>API-ключ Checko ${k.checko?`<b class="ok-t">задан: ${esc(k.checkoMask)}</b>`:''}</span><input type="text" id="kChecko" placeholder="${k.checko?'Оставьте пустым, чтобы не менять':'Ключ из личного кабинета checko.ru → API'}" autocomplete="off"></label>
   <p class="muted">Checko: статус, финансы, суды, ФССП, реестры. Ключ — в личном кабинете checko.ru, раздел «API». Реквизиты по ИНН берутся из DaData и ФНС, запросы Checko тратятся только на проверки.</p>
   <label class="f"><span>Лимит Checko, запросов в день ${k.quota&&k.quota.key?`<b class="muted">сегодня использовано ${k.quota.used} из ${k.quota.limit}${k.quota.queue?` · в очереди на полную проверку: ${k.quota.queue}`:''}</b>`:''}</span><input type="number" id="kDaily" min="1" max="100000" step="1" value="${esc(k.checkoDaily||100)}"></label>
   <p class="muted">Бесплатно — 100 в календарный день (по Москве), полная проверка — 4 запроса. Когда лимит кончается, программа делает краткую или бесплатную проверку по ФНС, а полную выполняет сама на следующий день.</p>
   <label class="f"><span>API-ключ DaData ${k.dadata?`<b class="ok-t">задан: ${esc(k.dadataMask)}</b>`:''}</span><input type="text" id="kDadata" placeholder="${k.dadata?'Оставьте пустым, чтобы не менять':'Ключ из личного кабинета dadata.ru'}" autocomplete="off"></label>
   <p class="muted">DaData: быстрый поиск реквизитов по ИНН (бесплатно до 10 000 запросов в день).</p>
   <p class="sub" style="margin:14px 0 4px">Доставка по России — цены перевозчиков</p>
   <label class="f"><span>Токен ATI.SU «API Средних ставок» ${k.ati?`<b class="ok-t">задан: ${esc(k.atiMask)}</b>`:''}</span><input type="text" id="kAti" placeholder="${k.ati?'Оставьте пустым, чтобы не менять':'ati.su → Профиль → API → токен (нужна лицензия «API Средних ставок»)'}" autocomplete="off"></label>
   <p class="muted">Средние ставки на отдельную машину по направлению (верхняя граница) и автообновление ставок за км. Платная лицензия ATI.SU.</p>
   <label class="f"><span>Ключ Деловых Линий (appkey) ${k.dellin?`<b class="ok-t">задан: ${esc(k.dellinMask)}</b>`:''}</span><input type="text" id="kDellin" placeholder="${k.dellin?'Оставьте пустым, чтобы не менять':'dev.dellin.ru → регистрация → ключ приложения (бесплатно)'}" autocomplete="off"></label>
   <label class="f"><span>Токен КИТ ${k.kit?`<b class="ok-t">задан: ${esc(k.kitMask)}</b>`:''}</span><input type="text" id="kKit" placeholder="${k.kit?'Оставьте пустым, чтобы не менять':'tk-kit.ru → личный кабинет → API'}" autocomplete="off"></label>
   <p class="muted">Сборный груз: ПЭК — без ключа; Деловые Линии и КИТ — по ключу. Ключи хранятся только на этом компьютере.</p>
   <label class="f"><span>Ключ ConvertAPI для PDF ${k.convertapi?`<b class="ok-t">задан: ${esc(k.convertapiMask)}</b>`:''}</span><input type="text" id="kConv" placeholder="${k.convertapi?'Оставьте пустым, чтобы не менять':'Secret или токен из личного кабинета convertapi.com'}" autocomplete="off"></label>
   <p class="muted">Нужен, только если на компьютере, где работает программа, нет Microsoft Word и LibreOffice: тогда файл КП для PDF отправляется в сервис convertapi.com.</p>
   <div class="row"><button class="btn primary" type="button" id="kSave">Сохранить</button>${k.checko?'<button class="btn ghost" type="button" id="kDelC">Удалить ключ Checko</button>':''}${k.dadata?'<button class="btn ghost" type="button" id="kDelD">Удалить ключ DaData</button>':''}${k.ati?'<button class="btn ghost" type="button" id="kDelA">Удалить токен ATI.SU</button>':''}${k.dellin?'<button class="btn ghost" type="button" id="kDelL">Удалить ключ Деловых Линий</button>':''}${k.kit?'<button class="btn ghost" type="button" id="kDelK">Удалить токен КИТ</button>':''}${k.convertapi?'<button class="btn ghost" type="button" id="kDelV">Удалить ключ ConvertAPI</button>':''}</div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  const put=async body=>{ await api('/api/integrations',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)}); toast('Сохранено'); openIntegrations(); };
  $('#kSave').onclick=()=>{ const b={}; const dl=+$('#kDaily').value; if (dl>0 && dl!==k.checkoDaily) b.checkoDaily=dl; const c=$('#kChecko').value.trim(), dd=$('#kDadata').value.trim(), cv=$('#kConv').value.trim(); if(c) b.checkoKey=c; if(dd) b.dadataKey=dd; if(cv) b.convertapiKey=cv; const ka=$('#kAti').value.trim(), kd=$('#kDellin').value.trim(), kk=$('#kKit').value.trim(); if(ka) b.atiToken=ka; if(kd) b.dellinKey=kd; if(kk) b.kitToken=kk; put(b); };
  if ($('#kDelC')) $('#kDelC').onclick=()=>put({checkoKey:''}); if ($('#kDelD')) $('#kDelD').onclick=()=>put({dadataKey:''}); if ($('#kDelV')) $('#kDelV').onclick=()=>put({convertapiKey:''}); if ($('#kDelA')) $('#kDelA').onclick=()=>put({atiToken:''}); if ($('#kDelL')) $('#kDelL').onclick=()=>put({dellinKey:''}); if ($('#kDelK')) $('#kDelK').onclick=()=>put({kitToken:''});
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset && t.dataset.p==='clientInn'){ const v=t.value.replace(/\D/g,''); t.classList.toggle('bad', !!v && !validInn(v) && (v.length>=10)); if ((v.length===10||v.length===12) && validInn(v) && v!==S._lastInn){ S._lastInn=v; setTimeout(partyFind,50); } } });

let clFindSeq=0, clFindT=0;
document.addEventListener('input', e=>{ if (e.target.id!=='clFind') return; clearTimeout(clFindT); const inp=e.target; clFindT=setTimeout(()=>clFindRun(inp), 160); });
async function clFindRun(inp){ const raw=inp.value.trim(), q=norm(raw), L=$('#clList'), seq=++clFindSeq;
  const res=q?await clientsFind(raw, 6):[];
  if (seq!==clFindSeq || !L) return;      // пока ждали ответ, ввели ещё буквы
  const inp2=$('#clFind'); if (!inp2 || inp2.value.trim()!==raw) return;
  const inn=raw.replace(/\D/g,''), innOk=(inn.length===10||inn.length===12)&&/^\d[\d\s]*$/.test(raw)&&validInn(inn), known=res.some(c=>String(c.inn||'').replace(/\D/g,'')===inn);
  let html=res.map(c=>`<button type="button" data-clid="${esc(c.id)}"><b>${esc(c.name)}</b><span>${c.inn?'ИНН '+esc(c.inn)+' · ':''}${esc((c.address||'').slice(0,70))}${c.kpCount?' · КП: '+c.kpCount:''}</span></button>`).join('');
  if (innOk && !known) html+=`<button type="button" data-inn="${inn}"><b>Найти ИНН ${inn} в реестре</b><span>реквизиты подставятся автоматически</span></button>`;
  else if (/^\d+$/.test(inn) && inn.length>=10 && !innOk) html+=`<p class="muted" style="margin:10px 14px">ИНН с ошибкой: нужно 10 цифр (организация) или 12 (ИП)</p>`;
  else if (q && !res.length) html+=`<p class="muted" style="margin:10px 14px">Среди сохранённых не найдено. Введите ИНН — найдём в реестре.</p>`;
  L.hidden=!html; L.innerHTML=html; }

document.addEventListener('keydown', e=>{ if (e.target.id!=='clFind' || e.key!=='Enter') return; const b=$('#clList [data-clid], #clList [data-inn]'); if (b){ e.preventDefault(); b.click(); } });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-inn]'); if(!b) return; S.clientInn=b.dataset.inn; S._lastInn=b.dataset.inn; partyFind(); });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-clid]'); if(!b) return; const c=CLIENTS.find(x=>x.id===b.dataset.clid); if(c) applyClient(c); });
