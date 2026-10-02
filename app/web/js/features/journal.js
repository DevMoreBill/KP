// Журнал КП: список сохранённых КП, открытие, копия, удаление.
'use strict';

const jTime = iso => { if (!iso) return ''; const d=new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString('ru-RU')+', '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); };

const jShort = n => { const p=String(n||'').trim().split(/\s+/); return p.length>1 ? p[0]+' '+p.slice(1).map(x=>x[0]+'.').join(' ') : (p[0]||''); };

// экономика КП из журнала: сумма в рублях (для итогов), прибыль и маржа — по позициям с закупкой
function jEcon(r){
  const e=r.econ||null, cur=(e&&e.cur)||'RUB', cs=curSh(cur), pc=v=>v==null?'—':v.toFixed(1).replace('.',',');
  if (r.locked) return { sum:`${money(r.sum||0)} ${cs}`, line:'<span class="muted">экономика — у автора КП</span>', sumRub: cur==='RUB'?(r.sum||0):null, profitRub:null };
  // заполнен расчёт «Экономика сделки» — показываем его (с логистикой, растаможкой и финансированием)
  if (r.deal){ const dd=r.deal, sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
    const line = dd.confirmed ? `<span class="${dd.profit<0?'bad-t':'ok-t'}">прибыль ${money(Math.round(dd.profit*100))} руб.</span> · маржа ${pc(dd.margin)} % <span class="muted">по расчёту сделки</span>`
      : `прибыль от ${money(dd.lo*100)} до ${money(dd.hi*100)} руб. <span class="muted">— нужен ввозной НДС</span>`;
    return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub: dd.confirmed ? Math.round(dd.profit*100) : null }; }
  const sumRub = cur==='RUB' ? (e?e.sum:r.sum)||0 : (e&&e.sumRub)||null;
  const profitRub = e&&e.withCost ? (cur==='RUB' ? e.profit : (e.sumRub&&e.sum ? Math.round(e.profit*e.sumRub/e.sum) : null)) : null;
  const line = !e ? '<span class="muted">считаю…</span>'
    : e.withCost ? `<span class="${e.profit<0?'bad-t':'ok-t'}">прибыль ${money(e.profit)} ${cs}</span> · маржа ${pc(e.margin)} %${e.withCost<e.positions?` <span class="muted">(${e.withCost} из ${e.positions} поз.)</span>`:''}${e.discount?` · скидка ${money(e.discount)}`:''}`
    : '<span class="muted">закупка не указана</span>';
  return { sum:`${money((e?e.sum:r.sum)||0)} ${cs}`, line, sumRub, profitRub };
}

async function openJournal(){
  const d=$('#dlg'); d.classList.add('wide');
  d.innerHTML=`<div class="dlg-h"><h3>Журнал КП</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="jbar"><input type="text" id="jQ" placeholder="Поиск: номер, получатель, ИНН, позиция" autocomplete="off"><select id="jA" aria-label="Автор"><option value="">Все авторы</option></select></div>
   <div class="jtot muted" id="jTot"></div><div id="jList"><p class="empty">Загружаю…</p></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>{ d.close(); d.classList.remove('wide'); };
  let rows=[]; try{ rows=await api('/api/history'); }catch(e){ $('#jList').innerHTML='<p class="empty">Журнал недоступен.</p>'; return; }
  rows.sort((a,b)=>String(b.number).localeCompare(String(a.number)));
  const authors=[...new Set(rows.map(r=>r.manager).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#jA').innerHTML+=authors.map(a=>`<option>${esc(a)}</option>`).join('');
  const draw=()=>{ const q=norm($('#jQ').value), au=$('#jA').value;
    const list=rows.filter(r=>(!au||r.manager===au) && (!q||norm([r.number,r.client,r.clientInn,r.manager,(r.items||[]).join(' ')].join(' ')).includes(q)));
    const ec=list.map(jEcon), sum=ec.reduce((s,e)=>s+(e.sumRub||0),0), pr=ec.filter(e=>e.profitRub!=null);
    $('#jTot').innerHTML = list.length ? `КП: <b>${list.length}</b> · на сумму <b>${money(sum)} руб.</b>${pr.length?` · прибыль <b>${money(pr.reduce((s,e)=>s+e.profitRub,0))} руб.</b> <span>(по ${pr.length} КП с закупкой)</span>`:''}` : '';
    $('#jList').innerHTML = list.length ? list.map((r,k)=>{ const e=ec[k];
      return `<div class="jr"><div class="jr-n"><span class="n">№ ${esc(r.number)}</span><span class="muted">от ${esc(KPGen.ruDate(r.date))}</span>${r.savedAt?`<span class="muted" title="Последнее сохранение">сохр. ${esc(jTime(r.savedAt))}</span>`:''}</div>
      <div class="jr-m"><b>${esc(r.client)}</b><span class="muted">${(r.items&&r.items[0])?esc(r.items[0])+(r.positions>1?` и ещё ${r.positions-1}`:''):''}</span>${r.manager?`<span class="jr-a" title="${esc([r.manager,r.managerPost].filter(Boolean).join(', '))}">Автор: ${esc(jShort(r.manager))}</span>`:''}</div>
      <div class="jr-e"><b>${e.sum}</b><span>${e.line}</span></div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(r.id)}">Открыть</button><button class="btn" type="button" data-jc="${esc(r.id)}">Копия</button>${r.locked?'':`<button class="btn" type="button" data-je="${esc(r.id)}">Экономика</button>`}<button class="btn" type="button" data-a="openDoc" data-id="${esc(r.id)}">${SRV.info&&SRV.info.local===false?'Скачать':'Word'}</button></div></div>`; }).join('')
      : `<p class="empty">${rows.length?'Ничего не найдено.':'Журнал пуст. Сохранённые КП появятся здесь.'}</p>`; };
  draw(); $('#jQ').oninput=draw; $('#jA').onchange=draw;
  // КП, сохранённые прежней версией: экономика считается по сохранённому состоянию КП
  for (const r of rows.filter(r=>!r.econ && !r.locked)){ if (!d.open) break;
    try{ r.econ=kpEconomics(await api(`/api/kp/${r.id}/state`)); }catch(e){ r.econ={cur:'RUB',sum:r.sum||0,withCost:0,positions:r.positions||0}; } }
  if (d.open) draw();
  $('#jList').onclick=async e=>{
    const o=e.target.closest('[data-jo]'), c=e.target.closest('[data-jc]'), ec=e.target.closest('[data-je]'); if(!o&&!c&&!ec) return;
    try{
      const st=await api(`/api/kp/${(o||c||ec).dataset[o?'jo':c?'jc':'je']}/state`);
      S=Object.assign(freshState(), st);
      if (c){ delete S.kpId; delete S.number; delete S.createdAt; S.date=today(); S.client=''; S.authorId=meId(); }
      d.close(); d.classList.remove('wide'); renderForm(); persist(); window.scrollTo({top:0});
      if (ec) return openDeal();
      toast(c?'Создана копия — укажите получателя':'КП № '+S.number+' открыто для редактирования');
    }catch(err){ toast('Не удалось открыть КП'); }
  };
}
