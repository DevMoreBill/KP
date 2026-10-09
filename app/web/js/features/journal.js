// Журнал КП: список сохранённых КП, открытие, копия, удаление.
'use strict';

const jTime = iso => { if (!iso) return ''; const d=new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU')+', '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); };

const jShort = n => { const p=String(n||'').trim().split(/\s+/); return p.length>1 ? p[0]+' '+p.slice(1).map(x=>x[0]+'.').join(' ') : (p[0]||''); };

// экономика КП из журнала: сумма в рублях (для итогов), прибыль и маржа — по позициям с закупкой
function jEcon(r){
  const e=r.econ||null, cur=(e&&e.cur)||'RUB', cs=curSh(cur), pc=v=>v==null||!Number.isFinite(v)?'—':v.toFixed(1).replace('.',',')+' %';
  if (!FEAT.on('deal')) return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line:'', sumRub: cur==='RUB'?((e?e.sum:r.sum)||0):(e&&e.sumRub)||null, profitRub:null };   // экономика выключена
  if (r.locked) return { sum:`${money(r.sum||0)} ${cs}`, line:'<span class="muted">экономика — у автора КП</span>', sumRub: cur==='RUB'?(r.sum||0):null, profitRub:null };
  // заполнен расчёт «Экономика сделки» — показываем его (с логистикой, растаможкой и финансированием)
  if (r.deal){ const dd=r.deal, sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
    const line = dd.confirmed ? `<span class="${dd.profit<0?'bad-t':'ok-t'}">прибыль ${money(Math.round(dd.profit*100))} руб.</span> · маржа ${pc(dd.margin)} <span class="muted">по расчёту сделки</span>`
      : `прибыль от ${money(dd.lo*100)} до ${money(dd.hi*100)} руб. <span class="muted">— нужен ввозной НДС</span>`;
    return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub: dd.confirmed ? Math.round(dd.profit*100) : null }; }
  const sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
  const profitRub = e&&e.withCost ? (cur==='RUB' ? e.profit : (e.sumRub&&e.sum ? Math.round(e.profit*e.sumRub/e.sum) : null)) : null;
  const line = !e ? '<span class="muted">считаю…</span>'
    : e.withCost ? `<span class="${e.profit<0?'bad-t':'ok-t'}">прибыль ${money(e.profit)} ${cs}</span> · маржа ${pc(e.margin)}${e.withCost<e.positions?` <span class="muted">(${e.withCost} из ${e.positions} поз.)</span>`:''}${e.discount?` · скидка ${money(e.discount)}`:''}`
    : '<span class="muted">закупка не указана</span>';
  return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub };
}

async function openJournal(){
  const d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Журнал КП</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="jbar"><input type="text" id="jQ" placeholder="Поиск: номер КП или закупки, получатель, ИНН, позиция" autocomplete="off"><select id="jK" aria-label="Вид КП"><option value="">Все КП</option><option value="std">Обычные</option><option value="tender">Тендеры</option></select><select id="jA" aria-label="Автор"><option value="">Все авторы</option></select><select id="jS" aria-label="Статус КП"${FEAT.on('track')?'':' hidden'}><option value="">Все статусы</option><option value="open">Не закрытые</option>${Object.entries(KP_STATUS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select><button class="btn" type="button" id="jMe" title="Только мои КП">Мои</button><button class="btn" type="button" id="jRep"${FEAT.on('report')?'':' hidden'} title="Отчёт по КП, прибыли и марже за период — по менеджерам и категориям">Отчёт</button></div>
   <div class="jtot muted" id="jTot"></div><div class="jfun" id="jFun"></div><div id="jList"><p class="empty">Загружаю…</p></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  // журнал — постранично: поиск, автор и итоги считает сервер, в браузер приходят только видимые КП
  const J={rows:[], total:0, agg:null, seq:0, size:50, any:false};
  // тендер: номер закупки и ссылка на неё; ссылка — только http(s)
  const tnd=r=>{ const t=r.tender; if (!t || !t.number) return ''; const u=/^https?:\/\//i.test(t.url||'') ? t.url : '';
    return `<span class="jr-t" title="КП для тендера${u?': '+esc(u):''}">Тендер № ${esc(t.number)}${u?` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть закупку на площадке">↗</a>`:''}</span>`; };
  const row=(r,e)=>`<div class="jr${r.tender&&r.tender.number?' tnd':''}"><div class="jr-n"><span class="n">№ ${esc(r.number)}</span><span class="muted">от ${esc(KPGen.ruDate(r.date))}</span>${tnd(r)}${r.savedAt?`<span class="muted" title="Последнее сохранение">сохр. ${esc(jTime(r.savedAt))}</span>`:''}</div>
      <div class="jr-m"><b>${esc(r.client)}</b><span class="muted">${(r.items&&r.items[0])?esc(r.items[0])+(r.positions>1?` и ещё ${r.positions-1}`:''):''}</span>${r.manager?`<span class="jr-a" title="${esc([r.manager,r.managerPost].filter(Boolean).join(', '))}">Автор: ${esc(jShort(r.manager))}</span>`:''}</div>
      <div class="jr-e"><b>${e.sum}</b><span>${e.line}</span><span class="jr-st">${KpTrack.chip(r)}</span></div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(r.id)}">Открыть</button><button class="btn" type="button" data-jc="${esc(r.id)}">Копия</button>${FEAT.on('versions')?`<button class="btn" type="button" data-jv="${esc(r.id)}" data-jn="${esc(r.number)}">Версии</button>`:''}${r.file&&FEAT.on('mail')?`<button class="btn" type="button" data-jm="${esc(r.id)}" title="Письмо клиенту с файлом КП">Отправить</button>`:''}${r.locked||!FEAT.on('deal')?'':`<button class="btn" type="button" data-je="${esc(r.id)}">Экономика</button>`}<button class="btn" type="button" data-a="openDoc" data-id="${esc(r.id)}">${SRV.info&&SRV.info.local===false?'Скачать':'Word'}</button></div></div>`;
  const draw=()=>{ const a=J.agg||{};
    $('#jTot').innerHTML = J.total ? `КП: <b>${J.total}</b> · на сумму <b>${money(a.sum||0)} руб.</b>${a.profitN&&FEAT.on('deal')?` · прибыль <b>${money(a.profit)} руб.</b> <span>(по ${a.profitN} КП с закупкой)</span>`:''}` : '';
    const fn=J.funnel||{}, nn=k=>(fn[k]||{}).n||0, won=nn('won'), lost=nn('lost');
    $('#jFun').innerHTML = FEAT.on('track') && Object.keys(fn).length ? Object.entries(KP_STATUS).filter(([k])=>nn(k)).map(([k,l])=>`<button type="button" class="jf st-${k}${$('#jS').value===k?' on':''}" data-jf="${k}" title="Показать только «${l}»"><b>${nn(k)}</b> ${l} <span>${money((fn[k]||{}).sum||0)} руб.</span></button>`).join('')
      + (won+lost?`<span class="jf-c" title="Выиграно из закрытых (выиграно + проиграно)">Конверсия <b>${Math.round(won/(won+lost)*100)} %</b></span>`:'') : '';
    const more=J.total-J.rows.length;
    $('#jList').innerHTML = J.rows.length ? J.rows.map(r=>row(r, jEcon(r))).join('')
        + (more>0?`<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" type="button" data-jmore>Показать ещё ${Math.min(more,J.size)} из ${more}</button></div>`:'')
      : `<p class="empty">${J.any?'Ничего не найдено.':'Журнал пуст. Сохранённые КП появятся здесь.'}</p>`; };
  const load=async more=>{ const seq=++J.seq, au=$('#jA').value, q=$('#jQ').value.trim(), kd=$('#jK').value, ks=$('#jS').value;
    let r; try{ r=await api(`/api/history?limit=${J.size}&offset=${more?J.rows.length:0}&q=${encodeURIComponent(q)}&author=${encodeURIComponent(au)}&kind=${encodeURIComponent(kd)}&status=${encodeURIComponent(ks)}`); }
    catch(e){ if (seq===J.seq) $('#jList').innerHTML='<p class="empty">Журнал недоступен.</p>'; return; }
    if (seq!==J.seq || !d.open) return;          // пока ждали ответ, изменили поиск
    J.rows = more ? J.rows.concat(r.items||[]) : (r.items||[]); J.total=r.total||0; J.agg=r.agg||null; J.funnel=r.funnel||null; if (!q && !au && !kd && !ks) J.any=J.total>0; else J.any=true;
    if (!$('#jA').dataset.ok){ $('#jA').dataset.ok='1'; $('#jA').innerHTML+=(r.authors||[]).map(a=>`<option>${esc(a)}</option>`).join(''); }
    draw();
    // КП, сохранённые прежней версией: экономика считается по сохранённому состоянию КП
    for (const x of (r.items||[]).filter(x=>!x.econ && !x.locked)){ if (!d.open || seq!==J.seq) break;
      try{ x.econ=kpEconomics(await api(`/api/kp/${x.id}/state`)); }catch(e){ x.econ={cur:'RUB',sum:x.sum||0,withCost:0,positions:x.positions||0}; } }
    if (d.open && seq===J.seq) draw(); };
  let qT=0; $('#jQ').oninput=()=>{ clearTimeout(qT); qT=setTimeout(()=>load(false), 220); }; $('#jA').onchange=$('#jK').onchange=$('#jS').onchange=()=>load(false);
  $('#jFun').onclick=e=>{ const b=e.target.closest('[data-jf]'); if (!b) return; const s=$('#jS'); s.value = s.value===b.dataset.jf ? '' : b.dataset.jf; load(false); };
  $('#jRep').onclick=()=>KpReport.open({author:$('#jA').value, kind:$('#jK').value});
  $('#jMe').onclick=()=>{ const me=(typeof AUTH!=='undefined'&&AUTH.user&&AUTH.user.name)||meName(), a=$('#jA');
    if (!me) return toast('Выберите себя в разделе «Менеджер» — тогда журнал покажет ваши КП');
    if (![...a.options].some(o=>o.value===me)) return toast('У вас ещё нет сохранённых КП');
    a.value = a.value===me ? '' : me; $('#jMe').classList.toggle('on', a.value===me); load(false); };
  await load(false);
  $('#jList').onclick=async e=>{
    if (e.target.closest('.jr-t a')) return;        // ссылка на закупку открывается в браузере
    if (e.target.closest('[data-jmore]')) return load(true);
    const js=e.target.closest('[data-jst]'); if (js){ const r=J.rows.find(x=>x.id===js.dataset.jst); if (r) KpTrack.open(r, tr=>{ r.track=tr; draw(); load(false); }); return; }
    const jm=e.target.closest('[data-jm]'); if (jm){ const r=J.rows.find(x=>x.id===jm.dataset.jm); if (r) MailDlg.open(r.id, r.number, tr=>{ r.track=tr; draw(); }); return; }
    const jv=e.target.closest('[data-jv]'); if (jv) return openKpVersions(jv.dataset.jv, jv.dataset.jn, ()=>{ d.close(); d.classList.remove('wide'); });
    const o=e.target.closest('[data-jo]'), c=e.target.closest('[data-jc]'), ec=e.target.closest('[data-je]'); if(!o&&!c&&!ec) return;
    try{
      const st=await api(`/api/kp/${(o||c||ec).dataset[o?'jo':c?'jc':'je']}/state`);
      S=Object.assign(freshState(), st); if (!c){ const m=J.rows.find(x=>x.id===st.kpId); if (m && m.file) S._file=m.file; }
      if (c){ delete S.kpId; delete S.number; delete S.createdAt; delete S._rev; S.date=today(); S.client=''; S.authorId=meId();
        if (S.tender && S.tender.on) S.tender={on:true, number:'', url:''}; }     // копия тендерного КП — под другую закупку
      d.close(); d.classList.remove('wide'); renderForm(); persist(); window.scrollTo({top:0});
      if (ec) return openDeal();
      toast(c?(S.tender&&S.tender.on?'Создана копия — укажите получателя и № закупки':'Создана копия — укажите получателя'):'КП № '+S.number+' открыто для редактирования');
    }catch(err){ toast('Не удалось открыть КП'); }
  };
}

// история версий КП: при каждом пересохранении прежний вариант остаётся в базе (последние 30)
async function openKpVersions(id, number, closeJournal){
  let list=[]; try{ list=await api(`/api/kp/${encodeURIComponent(id)}/versions`); }catch(e){ toast('История версий недоступна'); return; }
  const d=document.createElement('dialog'); d.className='st-confirm kpver';
  const fmtT=t=>t?new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  d.innerHTML=`<div class="dlg-h"><h3>Версии КП № ${esc(number||id)}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
    <p class="muted">Текущая версия — в журнале. Здесь — прежние варианты: сохраняются автоматически при каждом пересохранении КП (последние 30).</p>
    <div class="kpver-l">${list.length?list.map((v,k)=>`<div class="st-row"><div><b>Версия ${list.length-k}</b><span class="muted">до сохранения ${esc(fmtT(v.created))}${v.by?' ('+esc(v.by)+')':''}${v.sum!=null?` · ${money(v.sum)} ${esc(curSh(v.cur||'RUB'))}`:''}${v.client?' · '+esc(v.client):''}</span></div>
      <div class="acts"><button class="btn" type="button" data-vc="${v.id}" title="Что изменилось с тех пор">Сравнить с текущей</button><button class="btn" type="button" data-vo="${v.id}">Открыть</button></div></div>`).join(''):'<p class="empty">Прежних версий нет — КП сохранялось один раз.</p>'}</div>`;
  document.body.appendChild(d); d.showModal();
  const done=()=>{ d.close(); d.remove(); };
  d.addEventListener('cancel', done);
  d.onclick=async e=>{ if (e.target.closest('[data-x]')) return done();
    const vc=e.target.closest('[data-vc]'); if (vc) return KpDiff.open(id, vc.dataset.vc, number);
    const b=e.target.closest('[data-vo]'); if (!b) return;
    try{ const st=await api(`/api/kp/${encodeURIComponent(id)}/versions/${b.dataset.vo}`);
      S=Object.assign(freshState(), st);
      try{ S._rev=(await api(`/api/kp/${encodeURIComponent(id)}/rev`)).rev; }catch(e2){ delete S._rev; }   // прежняя версия заменит текущую правку КП
      done(); closeJournal&&closeJournal(); renderForm(); persist(); window.scrollTo({top:0});
      toast(`Открыта прежняя версия КП № ${S.number||''}. Сохраните КП, чтобы она стала текущей (нынешняя останется в истории).`); }
    catch(err){ toast('Не удалось открыть версию'); } };
}
