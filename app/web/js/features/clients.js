// Контрагенты: поиск по ИНН, справочник клиентов, проверка (Checko, резерв OFData, ГИР БО, Rusprofile), ключи API.
'use strict';

const PURPOSES=['Резервное электроснабжение','Основной источник питания','Строительная площадка','Котельная','Производство','Сжатый воздух для производства','Водоснабжение / водоотведение'];

function validInn(v){ const s=String(v||'').replace(/\D/g,''); const c=(d,k)=>k.reduce((t,x,n)=>t+x*+d[n],0)%11%10;
  if (s.length===10) return c(s,[2,4,10,3,5,9,4,6,8])===+s[9];
  if (s.length===12) return c(s,[7,2,4,10,3,5,9,4,6,8])===+s[10] && c(s,[3,7,2,4,10,3,5,9,4,6,8])===+s[11];
  return false; }

// справочник контрагентов не грузится целиком (их тысячи): CLIENTS — последние использованные и найденные,
// поиск идёт на сервере; CLIENTS_ALL — сколько всего в справочнике
let CLIENTS=[], CLIENTS_ALL=0;
// значения раздела «Клиент» — «Настройки → Значения программы → КП и документы»
DefRegistry.add([['client', 'Клиент в КП', 'kp', 'Раздел «Клиент» конструктора КП: поиск в справочнике контрагентов, проверка контрагента и предупреждение о параллельных КП.']], [
  ['kp.clientSuggest', 'client', 'Подсказок при поиске клиента', 'num', '6', {unit:'шт.', req:true, min:3, max:30,
    hint:'Сколько найденных контрагентов показывать под строкой «Название или ИНН клиента», пока менеджер печатает. Больше — шире выбор, но длиннее список на телефоне.'}],
  ['kp.checkDays', 'client', 'Проверка контрагента устаревает через', 'num', '30', {unit:'дн.', req:true, min:1, max:365,
    hint:'Через сколько дней после проверки (Checko, OFData) у клиента появляется пометка «проверке N дн. — обновите». Данные о компании (статус, суды, долги) меняются — перед крупной сделкой проверку лучше обновить. Пример: 30 — раз в месяц.'}],
  ['kp.dupDays', 'client', 'Предупреждать о КП этому клиенту за последние', 'num', '120', {unit:'дн.', req:true, min:1, max:3650,
    hint:'Если у клиента (по ИНН) уже есть КП за этот срок, в разделе «Клиент» появится жёлтое предупреждение «У этого клиента уже есть КП…» — чтобы два менеджера не готовили параллельные предложения. Пример: 120 — примерно за 4 месяца. Само предупреждение включается и выключается в «Функциях» («Предупреждение о КП клиента»).'}],
]);
const CL_FETCH=new Set();

async function loadClients(){ try{ const r=await api('/api/clients?limit=50'); CLIENTS=r.items||[]; CLIENTS_ALL=r.all??CLIENTS.length; }catch(e){ CLIENTS=[]; } }

function clientsKeep(list){ for (const c of list||[]){ if (!c||!c.id) continue; const k=CLIENTS.findIndex(x=>x.id===c.id); if (k<0) CLIENTS.push(c); else CLIENTS[k]=c; } }

async function clientById(id){ if (!id) return null; const have=CLIENTS.find(c=>c.id===id); if (have) return have;
  try{ const c=await api('/api/clients/'+encodeURIComponent(id)); clientsKeep([c]); return c; }catch(e){ return null; } }

async function clientsFind(q, limit){ try{ const r=await api('/api/clients?limit='+Math.round(limit||DEFN('kp.clientSuggest', 6))+'&q='+encodeURIComponent(q)); clientsKeep(r.items); return r.items||[]; }catch(e){ return []; } }

function clientIdOf(){ const inn=String(S.clientInn||'').replace(/\D/g,''); if (inn) return 'inn'+inn;
  return S.clientId || ('c'+Date.now().toString(36)); }

function curClient(){ const id=S.clientId||(S.clientInn?'inn'+String(S.clientInn).replace(/\D/g,''):''); if (!id) return null;
  const c=CLIENTS.find(x=>x.id===id); if (c) return c;
  // нет среди загруженных — подгружаем с сервера один раз и перерисовываем форму
  if (!CL_FETCH.has(id)){ CL_FETCH.add(id); clientById(id).then(x=>{ if (x) renderForm(); }); }
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

// получатель КП: «Сменить клиента» и копия КП из журнала — реквизиты, проверка, контакт и объект прежнего клиента
// не должны перейти в новое КП (иначе в документе остаются чужие ИНН и «Вниманию»)
class ClientFields {
  static clear(st){
    Object.assign(st,{client:'',clientId:'',clientInn:'',clientKpp:'',clientOgrn:'',clientFull:'',clientAddr:'',clientDir:'',clientDirPost:'',clientStatus:'',clientSrc:'',check:null,_clEdit:false,_clManual:false,_lastInn:''});
    st.contact={name:'',post:'',phone:'',email:''}; st.object={purpose:'',address:''};
  }
}

// Проверка контрагента: Checko — основной сервис, OFData — резерв (тот же формат данных), бухотчётность — бесплатно из
// ГИР БО ФНС, Rusprofile — кнопкой (открытого API у него нет). Лимиты — на весь отдел, по московскому дню.
class PartyCheck {
  static quota = null;      // последний известный остаток: Checko + reserve (OFData), если задан его ключ
  static TIP = '<p>Проверка по данным Checko: регистрация, долги, суды, исполнительные производства, бухотчётность. Видна только вам, в КП не попадает.</p>'
    +'<p>Бесплатно у Checko — 100 запросов в день на всех, полная проверка — 3 запроса: бухотчётность берётся бесплатно из ГИР БО ФНС. Резерв — OFData (свои 100 запросов в день, ключ — в «Настройки → Ключи API»): если у Checko кончился лимит или он не ответил, проверка идёт через OFData.</p>'
    +'<p>Если запросов не хватает нигде, программа делает краткую проверку (1 запрос) или бесплатную по ФНС и сама выполняет полную на следующий день. Проверка хранится 7 дней и общая для отдела — повторная проверка того же ИНН запросы не тратит. Rusprofile открывается кнопкой: у него нет API, карточка — в браузере.</p>';

  static async load(){ try{ PartyCheck.quota=await api('/api/check/quota'); }catch(e){ PartyCheck.quota=null; } return PartyCheck.quota; }

  static rusprofile(inn){ return 'https://www.rusprofile.ru/search?query='+encodeURIComponent(inn); }

  // сервисы с ключом: [Checko, OFData]
  static _apis(q){ q=q||PartyCheck.quota; return q ? [q.key?q:null, q.reserve||null].filter(Boolean) : []; }

  static quotaText(q){ const L=PartyCheck._apis(q); if (!L.length) return '';
    const full=L.reduce((t,x)=>t+(x.checks||0),0), left=L.reduce((t,x)=>t+(x.left||0),0), src=L.map(x=>x.name||'Checko').join(' + ');
    if (full>0) return `сегодня осталось ${full} ${plural(full,'полная проверка','полные проверки','полных проверок')} (${src})`;
    if (left>0) return `сегодня осталось ${left} ${plural(left,'запрос','запроса','запросов')} (${src}) — будет краткая проверка`;
    return `лимит ${src} на сегодня исчерпан — будет бесплатная проверка по ФНС, полная — завтра автоматически`; }

  // остаток под кнопками: «Checko сегодня: осталось 40 из 100 · OFData: 100 из 100 · в очереди: 2»
  static _left(q){ const L=PartyCheck._apis(q); if (!L.length) return '';
    return L.map(x=>`${esc(x.name||'Checko')} сегодня: ${x.left?`осталось ${x.left} из ${x.limit}`:'лимит исчерпан, обновится в 00:00 по Москве'}`).join(' · ')+(q.queue?` · в очереди: ${q.queue}`:''); }

  static line(){
    if (!FEAT.on('check')) return '';
    const c=S.check; const inn=String(S.clientInn||'').replace(/\D/g,'');
    if (!validInn(inn)) return '';
    const rp=`<a class="btn ghost" href="${esc((c&&c.rusprofile)||PartyCheck.rusprofile(inn))}" target="_blank" rel="noopener" title="Открыть карточку организации в Rusprofile (в браузере)">Rusprofile</a>`;
    if (!c){ if (!PartyCheck.quota) PartyCheck.load().then(q=>{ const el=$('#chkQ'); if (el) el.textContent=PartyCheck.quotaText(q); });
      return `<div class="chk-line"><button class="btn ghost" type="button" data-a="checkRun">Проверить контрагента</button><span class="muted" id="chkQ">${esc(PartyCheck.quotaText())}</span>${tip(PartyCheck.TIP)}</div>`; }
    if (c.error) return `<div class="chk-line warn"><span>${c.error==='nokey'?'Проверка Checko: не задан API-ключ.':esc(c.message||c.error)}</span>${c.error==='nokey'?'<button class="btn ghost" type="button" data-a="integrations">Ключ — в «Настройках»</button>':'<button class="btn ghost" type="button" data-a="checkRun">Повторить</button>'}${rp}</div>`;
    // полная проверка стояла в очереди и могла уже выполниться (после 00:00 по Москве) — подтянуть её один раз
    if (c.queued && c.checkedAt && new Date(c.checkedAt).toDateString()!==new Date().toDateString() && S._chkAuto!==inn){ S._chkAuto=inn; setTimeout(()=>PartyCheck.run(false), 50); }
    const label={ok:'Существенных рисков не найдено',warn:'Есть на что обратить внимание',bad:'Высокий риск'}[c.score]||'';
    const age=c.checkedAt?(Date.now()-new Date(c.checkedAt))/864e5:0, old=age>DEFN('kp.checkDays', 30);   // проверка устарела — предложить обновить
    const name=String(c.source||'Checko').replace(/^OFData$/,'OFData (резерв Checko)');
    const nc='не проверено', src=c.free?`Бесплатная проверка (${c.source})`:c.partial?`${name}, краткая проверка`:name;
    const facts=[['Регистрация',c.regDate?KPGen.ruDate(c.regDate.slice(0,10))+(c.ageYears!=null?` (${String(c.ageYears).replace('.',',')} г.)`:''):''],['Уставный капитал',c.capital!=null?fmtRub(c.capital):''],
      ['Сотрудников',c.employees!=null?String(c.employees):''],['Категория МСП',c.msp],['Основной ОКВЭД',c.okved],['Налоговая недоимка',c.free?nc:c.taxDebt?fmtRub(c.taxDebt):'нет'],
      ['Арбитраж (ответчик)',!c.courts||c.courts.count==null?nc:c.courts.count?`${c.courts.count} дел на ${fmtRub(c.courts.sum)}`:'нет'],
      ['Исполнительные производства',!c.fssp||c.fssp.count==null?nc:c.fssp.count?`${c.fssp.count}${c.fssp.sum?' на '+fmtRub(c.fssp.sum):''}`:'нет']].filter(x=>x[1]);
    const fin=(c.finances||[]).length?`<table class="fin"><tr><th>Год</th><th>Выручка</th><th>Чистая прибыль</th></tr>${c.finances.map(f=>`<tr><td>${esc(f.year)}</td><td>${fmtRub(f.revenue)}</td><td class="${f.profit<0?'bad-t':''}">${fmtRub(f.profit)}</td></tr>`).join('')}</table>`
      +(c.finSource?`<p class="muted chk-fin">Бухотчётность: ${c.finUrl?`<a href="${esc(c.finUrl)}" target="_blank" rel="noopener">${esc(c.finSource)}</a>`:esc(c.finSource)}</p>`:''):'';
    const q=c.quotaNow;
    return `<details class="chk ${c.score}"><summary><b>${esc(src)}: ${esc(label)}</b> <span class="muted">· ${esc(KPGen.ruDate((c.checkedAt||'').slice(0,10)))} · подробнее</span>${c.queued?' <span class="chk-old" title="Выполнится автоматически, когда обновится лимит (после 00:00 по Москве)">полная — в очереди</span>':''}${old?` <span class="chk-old" title="Данные могли измениться">проверке ${Math.floor(age)} дн. — обновите</span>`:''}</summary>
      ${c.note?`<p class="chk-note">${esc(c.note)}</p>`:''}
      <ul class="flags">${(c.flags||[]).map(f=>`<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>
      ${(c.missing||[]).length?`<p class="muted chk-miss">Не проверено: ${esc(c.missing.join(', '))}.</p>`:''}
      ${c.finNote?`<p class="muted chk-miss">${esc(c.finNote)}</p>`:''}
      <dl class="facts">${facts.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${fin}
      ${(c.links||[]).length?`<p class="chk-links"><span class="muted">Проверить вручную (бесплатно):</span> ${c.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}</p>`:''}
      <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="checkRun" data-force="1">Обновить проверку</button><a class="btn ghost" href="${esc(c.url||'https://checko.ru/search?query='+inn)}" target="_blank" rel="noopener">Открыть на checko.ru</a>${rp}${q?`<span class="muted">${PartyCheck._left(q)}</span>`:''}</div></details>`;
  }

  static async run(force){
    const inn=String(S.clientInn||'').replace(/\D/g,''); if(!validInn(inn)) return toast('Укажите корректный ИНН');
    const b=document.querySelector('[data-a="checkRun"]'); if(b){ b.disabled=true; b.textContent='Проверяю…'; }
    try{ S.check=await api('/api/check?inn='+inn+(force?'&force=1':'')); }catch(e){ S.check={error:'net',message:'Ошибка запроса: '+e.message,url:'https://checko.ru/search?query='+inn,rusprofile:PartyCheck.rusprofile(inn)}; }
    if (S.check && S.check.quotaNow) PartyCheck.quota=S.check.quotaNow;
    renderForm(); persist(); if (!S.check.error && S.client) saveClient(false);
  }
}

// резервная копия ключей: файл JSON, по желанию зашифрованный паролем (PBKDF2-SHA256 + AES-GCM, Web Crypto в браузере)
const KB = { file:null, crypto:!!(window.crypto&&crypto.subtle) };
const kb64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const kbBin = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
async function keysKey(pw, salt, iter){ const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']); }
async function keysEnc(text, pw){ const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12)), iter=250000;
  const data=await crypto.subtle.encrypt({name:'AES-GCM', iv}, await keysKey(pw, salt, iter), new TextEncoder().encode(text));
  return {alg:'PBKDF2-SHA256/AES-256-GCM', iter, salt:kb64(salt), iv:kb64(iv), data:kb64(data)}; }
async function keysDec(enc, pw){ if (!KB.crypto) throw new Error('нет Web Crypto');
  const data=await crypto.subtle.decrypt({name:'AES-GCM', iv:kbBin(enc.iv)}, await keysKey(pw, kbBin(enc.salt), enc.iter||250000), kbBin(enc.data));
  return new TextDecoder().decode(data); }
// что есть в файле копии: отметить, какие ключи восстановить (по умолчанию — все; текущие заменятся)
function keysImpHtml(k){ const F=KB.file; if (!F) return '';
  const head=`<p class="sub">Файл «${esc(F.name)}»${F.at?` от ${esc(String(F.at).slice(0,16).replace('T',' '))}`:''}</p>`;
  if (!F.keys) return `<div class="key-imp">${head}<p class="muted">Файл зашифрован паролем.</p>${F.err?`<p class="msg err">${esc(F.err)}</p>`:''}
    <div class="row"><input type="password" data-kipw placeholder="пароль копии" autocomplete="off"${KB.crypto?'':' disabled'}><button class="btn primary" type="button" data-kidec>Расшифровать</button><button class="btn ghost" type="button" data-kix>Отмена</button></div></div>`;
  const all=ApiKeys.GROUPS.flatMap(g=>g[2]).filter(f=>f.id), names=Object.keys(F.keys).filter(x=>F.keys[x]!=null && F.keys[x]!=='');
  const lab=id=>(all.find(f=>f.id===id)||{}).t || ApiKeys.DAILY[id] || id;
  const mask=v=>{ v=String(v); return v.length>10?v.slice(0,4)+'…'+v.slice(-4):'•••'; };
  return `<div class="key-imp">${head}${names.length?names.map(id=>`<label class="ck"><input type="checkbox" data-kik="${esc(id)}" checked> <b>${esc(lab(id))}</b> <span class="muted">${ApiKeys.DAILY[id]?esc(F.keys[id]):esc(mask(F.keys[id]))}${(all.find(f=>f.id===id)||{}).mask&&k[(all.find(f=>f.id===id)).mask]?' · заменит текущий':''}</span></label>`).join(''):'<p class="muted">В файле нет ключей.</p>'}
    <div class="row"><button class="btn primary" type="button" data-kiok${names.length?'':' disabled'}>Восстановить отмеченные</button><button class="btn ghost" type="button" data-kix>Отмена</button></div></div>`; }

// Перевозчики: включение и адреса API («Настройки → Внешние сервисы → Ключи API», под ключами доставки). Адрес пустой —
// действует адрес программы; перевозчик сменил адрес — вписать новый и «Проверить». Сервер: /api/logistics/carriers.
class CarrierApis {
  static async card(){
    let r={carriers:[]}; try{ r=await api('/api/logistics/carriers'); }catch(e){ return `<div class="st-card"><p class="msg err">Перевозчики: ${esc(e.message||e)}</p></div>`; }
    return `<div class="st-card ca-card"><p class="sub">Перевозчики: включение и адреса API</p>
      <p class="muted">Выключенный перевозчик не участвует в расчёте доставки. Если перевозчик сменил адрес API (ошибка «адрес сервиса изменился», HTTP 404 или 307) — впишите новый адрес из его документации и нажмите «Проверить». Пустое поле — адрес программы, «↺» — вернуть его.</p>
      ${r.carriers.map(c=>`<div class="ca-row" data-ca="${esc(c.id)}">
        <div class="ca-h"><label class="sw df-sw" title="Включить / выключить"><input type="checkbox" data-caon${c.on?' checked':''}><span></span></label>
          <b>${esc(c.name)}</b>${c.docs?`<a class="lnk" href="${esc(c.docs)}" target="_blank" rel="noopener noreferrer">документация API ↗</a>`:''}
          <span class="sp"></span><button class="btn ghost sm" type="button" data-catest>Проверить</button></div>
        ${c.fields.map(f=>`<label class="f ca-f"><span>${esc(f.label)}</span><span class="ca-in"><input type="url" data-caf="${esc(f.id)}" value="${esc(f.value)}" placeholder="${esc(f.default)}" autocomplete="off" spellcheck="false">
          <button class="icon" type="button" data-careset title="Вернуть адрес программы: ${esc(f.default)}" aria-label="Вернуть адрес программы"${f.value?'':' disabled'}>↺</button></span></label>`).join('')}
        <p class="muted ca-res" hidden></p></div>`).join('')}
      <div class="row"><span class="sp"></span><button class="btn primary" type="button" data-casave>Сохранить перевозчиков</button></div></div>`;
  }
  static _body(m){ const out={};
    m.querySelectorAll('[data-ca]').forEach(rw=>{ const urls={}; rw.querySelectorAll('[data-caf]').forEach(i=>{ urls[i.dataset.caf]=i.value.trim(); });
      out[rw.dataset.ca]={on:rw.querySelector('[data-caon]').checked, urls}; });
    return out; }
  static async save(m, quiet){
    try{ await api('/api/logistics/carriers',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(CarrierApis._body(m))});
      LG.status=null; if (!quiet) toast('Перевозчики сохранены'); return true; }
    catch(e){ toast('Не сохранено: '+(e.message||e)); return false; }
  }
  /** клик внутри вкладки ключей; true — обработано */
  static async click(e, m){
    const rs=e.target.closest('[data-careset]'); if (rs){ const i=rs.parentElement.querySelector('[data-caf]'); i.value=''; rs.disabled=true; return true; }
    if (e.target.closest('[data-casave]')){ await CarrierApis.save(m); return true; }
    const t=e.target.closest('[data-catest]'); if (!t) return false;
    const rw=t.closest('[data-ca]'), out=rw.querySelector('.ca-res');
    if (!await CarrierApis.save(m, true)) return true;          // проверяется то, что вписано сейчас
    t.disabled=true; out.hidden=false; out.className='muted ca-res'; out.textContent='Проверяю…';
    try{ const r=await api('/api/logistics/carriers/test',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({id:rw.dataset.ca})});
      out.className='ca-res '+(r.ok?'ok-t':'warn-t'); out.textContent=(r.ok?'✓ ':'✕ ')+r.msg; }
    catch(err){ out.className='ca-res warn-t'; out.textContent='✕ '+(err.message||err); }
    t.disabled=false; return true;
  }
}

// Ключи API — форма прямо в «Настройки → Ключи API» (отдельного окна нет). Ключи на сервере; в браузер приходит только маска.
class ApiKeys {
  static GROUPS=[
    ['Контрагенты', 'Реквизиты по ИНН подтягиваются и без ключей — из открытого сервиса ФНС (egrul.nalog.ru), бухотчётность — из ГИР БО ФНС (тоже без ключа). С ключами данные полнее и быстрее, а Checko ещё и проверяет контрагента: суды, ФССП, налоги, реестры. Резерв для Checko — OFData (тот же формат данных). Rusprofile открывается кнопкой в проверке: открытого API у него нет, ключ не нужен.', [
      {id:'checkoKey', on:'checko', mask:'checkoMask', t:'API-ключ Checko', ph:'Ключ из личного кабинета checko.ru → API', h:'Карточка, суды, ФССП, налоги, реестры (бухотчётность — бесплатно из ГИР БО). Запросы Checko тратятся только на проверки.'},
      {daily:'checkoDaily', name:'Checko', on:'checko', q:'main'},
      {id:'ofdataKey', on:'ofdata', mask:'ofdataMask', t:'API-ключ OFData — резерв Checko', ph:'Ключ из личного кабинета ofdata.ru → API', h:'Необязательно. Тот же формат данных, что у Checko, свои 100 бесплатных запросов в сутки: проверка идёт через OFData, когда у Checko кончился лимит, нет ключа или он не ответил; недостающее (суды, ФССП) OFData добирает за Checko.'},
      {daily:'ofdataDaily', name:'OFData', on:'ofdata', q:'reserve'},
      {id:'dadataKey', on:'dadata', mask:'dadataMask', t:'API-ключ DaData', ph:'Ключ из личного кабинета dadata.ru', h:'Быстрый поиск реквизитов по ИНН (бесплатно до 10 000 запросов в день).'}]],
    ['Доставка по России — цены перевозчиков', 'Без ключа считают ПЭК, Энергия и ЖелДорЭкспедиция (она же — крупногабаритный груз и длинномеры). Остальные перевозчики подключаются ключом — их цены появятся во вкладке «Логистика» сделки. В итог идёт максимальное предложение со сноской-источником.', [
      {id:'atiToken', on:'ati', mask:'atiMask', t:'ATI.SU — «API Средних ставок»', ph:'ati.su → Профиль → API → токен', h:'Отдельная машина: средние ставки по направлению (верхняя граница) и автообновление ставок за км. Платная лицензия.'},
      {id:'dellinKey', on:'dellin', mask:'dellinMask', t:'Деловые Линии (appkey)', ph:'dev.dellin.ru → регистрация → ключ приложения', h:'Сборный груз, бесплатно.'},
      {id:'kitToken', on:'kit', mask:'kitMask', t:'КИТ — токен', ph:'tk-kit.ru → личный кабинет → «Разработчикам» → «Получение ключа API»', h:'Сборный груз, дверь в дверь (тариф «Стандарт»). Лимит запросов — на каждый токен.'},
      {id:'cdekId', on:'cdek', mask:'cdekIdMask', t:'СДЭК — идентификатор (Account)', ph:'lk.cdek.ru → Интеграция → Account', h:'Нужен договор со СДЭК. Ключи выдаются в личном кабинете: «Интеграция → Создать ключ».'},
      {id:'cdekSecret', on:'cdek', mask:'cdekSecretMask', t:'СДЭК — секретный ключ (Secure password)', ph:'lk.cdek.ru → Интеграция → Secure password', h:'Считается тариф «дверь — дверь» (самый дешёвый из доступных).', secret:true},
      {id:'vozovozToken', on:'vozovoz', mask:'vozovozMask', t:'Возовоз — токен', ph:'vozovoz.ru → личный кабинет → API', h:'Сборный груз, бесплатно после регистрации.'}]],
    ['Документы', '', [
      {id:'convertapiKey', on:'convertapi', mask:'convertapiMask', t:'ConvertAPI для PDF', ph:'Secret или токен из личного кабинета convertapi.com', h:'Нужен, только если на компьютере, где работает программа, нет Microsoft Word и LibreOffice.'}]]];
  static DAILY={checkoDaily:'Лимит Checko в день', ofdataDaily:'Лимит OFData в день'};
  static FREE_DAILY=100;

  // лимит запросов в день: у Checko — с остатком и очередью, у OFData — с остатком резерва
  static _daily(f, k){ const Q=k.quota||{}, q=f.q==='reserve'?(Q.reserve||{}):Q;
    const info=k[f.on]&&q.limit?` <b class="muted">сегодня ${q.used} из ${q.limit}${f.q==='main'&&Q.queue?` · в очереди: ${Q.queue}`:''}</b>`:'';
    const h=f.q==='reserve'?'Бесплатно — 100 в сутки. Расходуется, только когда у Checko не хватает запросов или он не ответил.'
      :'Бесплатно — 100 в календарный день (по Москве), полная проверка — 3 запроса. Когда лимит кончается, проверка идёт через OFData (если задан ключ), иначе — краткая или бесплатная по ФНС, а полная — на следующий день.';
    return `<div class="key-f"><label class="f"><span>Лимит ${esc(f.name)}, запросов в день${info}</span><input type="number" data-kday="${esc(f.daily)}" min="1" max="100000" step="1" value="${esc(k[f.daily]||ApiKeys.FREE_DAILY)}"></label>
      <p class="muted">${esc(h)}</p></div>`; }

  static _field(f, k){ if (f.daily) return ApiKeys._daily(f, k);
    return `<div class="key-f"><div class="key-row"><label class="f"><span>${esc(f.t)} ${k[f.mask]?`<b class="ok-t">задан: ${esc(k[f.mask])}</b>`:(f.on&&k[f.on]===false&&f.id.startsWith('cdek')&&(k.cdekIdMask||k.cdekSecretMask)?'<b class="warn-t">нужны оба ключа</b>':'')}</span>
      <input type="${f.secret?'password':'text'}" data-key="${f.id}" placeholder="${esc(k[f.mask]?'Новый ключ — заменит текущий':f.ph)}" autocomplete="off"></label>
      ${k[f.mask]?`<button class="btn ghost sm" type="button" data-kdel="${f.id}" title="Удалить ключ">Удалить</button>`:''}</div>${f.h?`<p class="muted">${esc(f.h)}</p>`:''}</div>`; }

  static async form(m){
    let k={}; try{ k=await api('/api/integrations'); }catch(e){}
    const ca=await CarrierApis.card();
    m.innerHTML=ApiKeys.GROUPS.map(([t,h,fs])=>`<div class="st-card"><p class="sub">${esc(t)}</p>${h?`<p class="muted">${esc(h)}</p>`:''}<div class="key-grid">${fs.map(f=>ApiKeys._field(f, k)).join('')}</div></div>${t.startsWith('Доставка')?ca:''}`).join('')
      +`<div class="st-card"><p class="sub">Резервная копия ключей</p>
        <p class="muted">Файл со всеми ключами — чтобы перенести их на другой компьютер или восстановить после переустановки. С паролем файл зашифрован (AES-256): без пароля ключи из него не прочитать. Без пароля храните файл как пароль — в нём ключи открытым текстом; не выкладывайте его в репозиторий, почту и общие папки.</p>
        <div class="row key-bk"><label class="f"><span>Пароль для файла (необязательно)</span><input type="password" data-kpw autocomplete="new-password" placeholder="${KB.crypto?'пароль копии':'шифрование доступно только при входе через localhost или https'}"${KB.crypto?'':' disabled'}></label>
          <button class="btn" type="button" data-kexp>Скачать копию ключей</button><button class="btn ghost" type="button" data-kimp>Загрузить из копии…</button><input type="file" id="kFile" accept=".json,application/json" hidden></div>
        <div id="kImp">${KB.file?keysImpHtml(k):''}</div></div>`
      +`<div class="st-card key-bar"><span class="muted key-note">Ключи хранятся только на компьютере, где работает программа (в папке данных).</span><span class="sp"></span><button class="btn primary" type="button" data-ksave>Сохранить ключи</button></div>`;
    const put=async body=>{ try{ await api('/api/integrations',{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)}); toast('Сохранено'); LG.status=null; PartyCheck.quota=null; ApiKeys.form(m); }catch(e){ toast('Не сохранилось: '+(e.message||e)); } };
    m.querySelector('#kFile').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if (!f) return;
      try{ const j=JSON.parse(await f.text()); if (!j || j.kind!=='kp-keys' || !(j.keys||j.enc)) throw new Error('это не копия ключей программы');
        KB.file={name:f.name, at:j.at, keys:j.keys||null, enc:j.enc||null, err:''}; }catch(err){ return toast('Файл не подходит: '+(err.message||err)); }
      m.querySelector('#kImp').innerHTML=keysImpHtml(k); m.querySelector('#kImp [data-kipw]')?.focus(); };
    m.oninput=e=>{ const i=e.target.closest('[data-caf]'); if (i) i.parentElement.querySelector('[data-careset]').disabled=!i.value.trim(); };
    m.onclick=async e=>{ if (await CarrierApis.click(e, m)) return; const d=e.target.closest('[data-kdel]'); if (d) return put({[d.dataset.kdel]:''});
      if (e.target.closest('[data-kimp]')) return m.querySelector('#kFile').click();
      if (e.target.closest('[data-kexp]')){ try{ const j=await api('/api/integrations/export'), pw=(m.querySelector('[data-kpw]')||{}).value||'';
          const out = pw ? {kind:'kp-keys', v:1, at:j.at, enc:await keysEnc(JSON.stringify(j.keys), pw)} : j;
          const n=Object.keys(j.keys||{}).filter(x=>!ApiKeys.DAILY[x]).length; if (!n) return toast('Ключей пока нет — нечего сохранять');
          const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:'application/json'}));
          a.download=`ключи-API-${(j.at||'').slice(0,10)}${pw?'-зашифровано':''}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
          toast(`Копия сохранена: ${n} ${plural(n,'ключ','ключа','ключей')}${pw?', зашифровано паролем':''}`); }catch(err){ toast('Не получилось: '+(err.message||err)); } return; }
      if (e.target.closest('[data-kix]')){ KB.file=null; m.querySelector('#kImp').innerHTML=''; return; }
      if (e.target.closest('[data-kidec]')){ const pw=m.querySelector('[data-kipw]').value;
        try{ KB.file.keys=JSON.parse(await keysDec(KB.file.enc, pw)); KB.file.err=''; }catch(err){ KB.file.err='Пароль не подходит'; }
        m.querySelector('#kImp').innerHTML=keysImpHtml(k); return; }
      if (e.target.closest('[data-kiok]')){ const body={}; m.querySelectorAll('[data-kik]:checked').forEach(c=>{ body[c.dataset.kik]=KB.file.keys[c.dataset.kik]; });
        if (!Object.keys(body).length) return toast('Не выбрано, что восстановить');
        KB.file=null; return put(body); }
      if (!e.target.closest('[data-ksave]')) return;
      const b={}; m.querySelectorAll('[data-key]').forEach(i=>{ const v=i.value.trim(); if (v) b[i.dataset.key]=v; });
      m.querySelectorAll('[data-kday]').forEach(i=>{ const dl=+i.value, id=i.dataset.kday; if (dl>0 && dl!==(k[id]||ApiKeys.FREE_DAILY)) b[id]=dl; });
      if (!Object.keys(b).length) return toast('Нечего сохранять — введите ключ');
      put(b); };
    m.onkeydown=e=>{ if (e.key==='Enter' && e.target.matches('[data-caf]')){ e.preventDefault(); return CarrierApis.save(m); }
      if (e.key==='Enter' && e.target.matches('[data-key],[data-kday]')){ e.preventDefault(); m.querySelector('[data-ksave]').click(); } };
  }
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset && t.dataset.p==='clientInn'){ const v=t.value.replace(/\D/g,''); t.classList.toggle('bad', !!v && !validInn(v) && (v.length>=10)); if ((v.length===10||v.length===12) && validInn(v) && v!==S._lastInn){ S._lastInn=v; setTimeout(partyFind,50); } } });

let clFindSeq=0, clFindT=0;
document.addEventListener('input', e=>{ if (e.target.id!=='clFind') return; clearTimeout(clFindT); const inp=e.target; clFindT=setTimeout(()=>clFindRun(inp), 160); });
async function clFindRun(inp){ const raw=inp.value.trim(), q=norm(raw), L=$('#clList'), seq=++clFindSeq;
  const res=q?await clientsFind(raw):[];
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
