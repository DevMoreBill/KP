// Раздел 1 «Клиент».
'use strict';

// у клиента уже есть недавние КП (за 120 дней, по ИНН) — чтобы два менеджера не готовили параллельные предложения
const CL_PREV = { key:'', items:[], busy:false };
function clientPrevHtml(){
  if (!FEAT.on('clientPrev')) return '';
  const key=String(S.clientInn||'').replace(/\D/g,''); if (key.length<10) return '';
  if (CL_PREV.key!==key){ if (!CL_PREV.busy) clientPrevLoad(key); return ''; }
  const items=CL_PREV.items.filter(x=>x.id!==S.kpId); if (!items.length) return '';
  return `<div class="msg warn cl-prev">У этого клиента уже есть КП: ${items.slice(0,3).map(x=>`<b>№ ${esc(x.number)}</b> от ${esc(KpDate.ddmm(x.date))} — ${esc(jShort(x.manager||''))}, ${esc(KP_STATUS[KpTrack.status(x.track)].toLowerCase())}`).join('; ')}${items.length>3?` и ещё ${items.length-3}`:''}.
    <button type="button" class="lnk" data-a="clPrev">Показать в журнале</button></div>`;
}
async function clientPrevLoad(key){
  CL_PREV.busy=true; const since=KpDate.addDays(today(), -120);
  try{ const r=await api(`/api/history?limit=20&q=${encodeURIComponent(key)}`); CL_PREV.items=(r.items||[]).filter(x=>String(x.clientInn||'').replace(/\D/g,'')===key && (x.date||'')>=since); }
  catch(e){ CL_PREV.items=[]; }
  CL_PREV.key=key; CL_PREV.busy=false; if (STEP==='client' && CL_PREV.items.some(x=>x.id!==S.kpId)) renderForm();
}

function stepClient(){
  const has = !!(S.client || S.clientInn);
  const edit = S._clEdit || (has && !S.client.trim());
  const cl = curClient();
  const cons=(cl?.contacts||[]).filter(o=>o.name && norm(o.name)!==norm(S.contact.name));
  const objs=(cl?.objects||[]).filter(o=>(o.purpose||o.address) && !(norm(o.purpose)===norm(S.object.purpose) && norm(o.address)===norm(S.object.address)));
  // 1. Кому: поиск или карточка клиента
  const finder = `<div class="cl-find"><input type="text" id="clFind" placeholder="Название или ИНН клиента" autocomplete="off" aria-label="Поиск клиента"><div id="clList" class="cl-list" hidden></div></div>
    <p class="muted" style="margin:8px 0 0"><button type="button" class="lnk" data-a="clientManual">Ввести реквизиты вручную</button></p>`;
  const badge = S.clientStatus ? `<span class="st-badge ${/действ/i.test(S.clientStatus)?'ok':'bad'}">${esc(S.clientStatus)}</span>` : '';
  const risk = S.check && !S.check.error ? `<span class="st-badge ${S.check.score==='ok'?'ok':S.check.score==='warn'?'warn':'bad'}">${S.check.score==='ok'?'рисков не найдено':S.check.score==='warn'?'есть замечания':'высокий риск'}</span>` : '';
  const summary = `<div class="cl-card">
      <div class="cl-head"><b>${esc(S.client||'Без названия')}</b>${badge}${risk}</div>
      <div class="cl-meta">${[S.clientInn?'ИНН '+esc(S.clientInn):'',S.clientKpp?'КПП '+esc(S.clientKpp):'',S.clientOgrn?'ОГРН '+esc(S.clientOgrn):''].filter(Boolean).join(' · ')||'<span class="muted">реквизиты не указаны</span>'}</div>
      ${S.clientAddr?`<div class="cl-meta">${esc(S.clientAddr)}</div>`:''}
      ${S.clientDir?`<div class="cl-meta">${esc([S.clientDirPost||'Руководитель',S.clientDir].join(': '))}</div>`:''}
      <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-a="clientEdit">${edit?'Скрыть реквизиты':'Изменить реквизиты'}</button><button class="btn ghost" type="button" data-a="clientChange">Другой клиент</button>${ClientCard.on()&&(S.clientId||S.clientInn)?`<button class="btn ghost" type="button" data-cc="${esc(JSON.stringify({id:S.clientId||'', inn:String(S.clientInn||'').replace(/\D/g,''), name:S.client||''}))}" title="Все КП клиента, итоги, контакты и заметки">Карточка клиента</button>`:''}</div></div>`;
  const form = `<div class="cl-form">
      <div class="grid inn-row"><label class="f"><span>ИНН</span><input type="text" inputmode="numeric" data-p="clientInn" value="${esc(S.clientInn)}" placeholder="10 или 12 цифр" class="${!S.clientInn||validInn(S.clientInn)?'':'bad'}" maxlength="12"></label>
        <div style="align-self:end" class="row"><button class="btn" type="button" data-a="partyFind">Заполнить по ИНН</button><span class="muted" id="partyMsg">${S.clientSrc?'Данные: '+esc(S.clientSrc):''}</span></div></div>
      <div class="grid g2" style="margin-top:12px">${field('Название в КП','client',{req:1,ph:'ООО «Компания»'})}${field('Полное наименование','clientFull')}</div>
      <div class="grid g3" style="margin-top:12px">${field('КПП','clientKpp')}${field('ОГРН','clientOgrn')}${field('Руководитель','clientDir',{ph:'ФИО'})}</div>
      <div class="grid" style="margin-top:12px">${field('Юридический адрес','clientAddr')}</div></div>`;
  return `<section class="step" id="st-client"><h2><span class="n">1</span>Клиент${tip(`<p>Начните вводить название или ИНН: поиск идёт по вашему справочнику клиентов${CLIENTS_ALL?` (${CLIENTS_ALL})`:''}, а по ИНН — в реестре ФНС; реквизиты заполнятся сами.</p><p>Контактное лицо и объект необязательны: контакт выводится на титуле («Вниманию: …»), объект — для каких нужд и куда поставка.</p><p>Ключи Checko и DaData, загрузка клиентов списком ИНН — в меню «⋯» вверху.</p>`)}</h2>
  ${tenderBlock()}
  <div class="csec"><p class="sub">Кому</p>${has ? summary : finder}${(has&&edit)||S._clManual ? form : ''}${has?PartyCheck.line():''}${has?clientPrevHtml():''}</div>
  <div class="csec"><p class="sub">Контактное лицо <span class="muted">необязательно</span></p>
   ${cons.length?`<div class="chips" style="margin-bottom:8px"><span class="muted" style="font-size:13px">Ранее:</span>${cons.slice(0,4).map((c,k)=>`<button class="chip sm" type="button" data-a="pickContact" data-k="${(cl.contacts||[]).indexOf(c)}">${esc(c.name)}${c.post?' — '+esc(c.post):''}</button>`).join('')}</div>`:''}
   <div class="grid g2">${field('ФИО','contact.name',{ph:'Иванов Иван Иванович'})}${field('Должность','contact.post',{ph:'Главный энергетик'})}</div>
   <details class="more-lite"${S.contact.phone||S.contact.email?' open':''}><summary>Телефон и e-mail</summary><div class="grid g2" style="margin-top:8px">${field('Телефон','contact.phone',{ph:'+7 …'})}${field('E-mail','contact.email')}</div></details></div>
  <div class="csec"><p class="sub">Объект <span class="muted">необязательно</span></p>
   ${objs.length?`<div class="chips" style="margin-bottom:8px"><span class="muted" style="font-size:13px">Ранее у клиента:</span>${objs.slice(0,4).map(o=>`<button class="chip sm" type="button" data-a="pickObject" data-k="${(cl.objects||[]).indexOf(o)}">${esc([o.purpose,o.address].filter(Boolean).join(' — ').slice(0,70))}</button>`).join('')}</div>`:''}
   <div class="grid g2">${field('Назначение','object.purpose',{ph:'Например: резервное электроснабжение котельной',list:'purposeList'})}${field('Адрес объекта','object.address',{ph:'Город, улица, дом'})}</div>
   <datalist id="purposeList">${PURPOSES.map(p=>`<option value="${esc(p)}">`).join('')}</datalist></div>
  <div class="csec"><div class="grid g2">${field('Дата КП','date',{type:'date',req:1})}${field('Город','city')}</div></div>
  </section>`;
}

// ---------- вид КП: обычное или для тендера. Тендер — номер и ссылка на закупку в КП, журнале; файл «<номер> КП.docx / .pdf»
function tenderOn(){ return FEAT.on('tender') && !!(S.tender && S.tender.on); }
function tenderNo(){ return tenderOn() ? String(S.tender.number||'').trim() : ''; }
function tenderUrl(){ const u=tenderOn() ? String(S.tender.url||'').trim() : ''; return /^https?:\/\/\S+$/i.test(u) ? u : ''; }
// номер закупки из ссылки: ЕИС (regNumber=…), площадки (…/tender/123456, …?id=…), иначе — самая длинная группа цифр от 6 знаков
function tenderNoFromUrl(u){ u=String(u||''); let m=/[?&](?:regNumber|purchaseNumber|noticeNumber|lotNumber)=(\d{5,})/i.exec(u)
    || /(?:tender|purchase|trade|lot|procedure|auction|zakupk\w*|notice)[\w-]*[/=_-](\d{5,})/i.exec(u);
  if (m) return m[1]; const all=u.replace(/^https?:\/\/[^/]+/i,'').match(/\d{6,}/g)||[]; return all.sort((a,b)=>b.length-a.length)[0]||''; }
function tenderHost(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return ''; } }
function tenderBlock(){ if (!FEAT.on('tender')) return ''; const on=tenderOn(), T=S.tender||{}, url=String(T.url||'').trim(), badUrl=url && !tenderUrl();
  return `<div class="csec kp-kind${on?' on':''}" id="st-tender"><div class="kk-head"><p class="sub">Вид КП</p>
      <div class="seg" role="radiogroup" aria-label="Вид КП"><button type="button" role="radio" aria-checked="${!on}" class="${on?'':'on'}" data-a="kpKind" data-v="std">Обычное</button><button type="button" role="radio" aria-checked="${on}" class="${on?'on':''}" data-a="kpKind" data-v="tender">Для тендера</button></div></div>
    ${on?`<div class="grid kk-grid">${field('№ закупки (тендера)','tender.number',{req:1,ph:'Например: 4567892',cls:T.number&&String(T.number).trim()?'':'bad'})}
        <label class="f"><span>Ссылка на закупку <span class="muted">для журнала, в КП не выводится</span></span><input type="url" data-p="tender.url" value="${esc(url)}" placeholder="https://zakupki.gov.ru/…" autocomplete="off" class="${badUrl?'bad':''}"></label></div>
      <p class="muted kk-note" id="kkNote">${kkNote()}</p>
`
    :`<p class="muted kk-note">Для тендера КП собирается в шаблоне «Тендерный», в нём — номер закупки; файлы называются «№ закупки КП поставщик заказчик».</p>`}</div>`; }
function kkNote(){ const n=tenderNo(), u=String((S.tender||{}).url||'').trim();
  return (n ? `Файлы: <b>${esc(savedFileName())}</b> и <b>${esc(savedFileName().replace(/\.docx$/i,'.pdf'))}</b>.` : 'Номер закупки — в КП и в названии файлов: «4567892 КП ПНЕВМОТЕХ Заказчик.docx».')
    + (u && !tenderUrl() ? ' <span class="bad-t">Ссылка должна начинаться с http:// или https://</span>' : u ? ` Площадка: ${esc(tenderHost(u))}.` : ''); }
