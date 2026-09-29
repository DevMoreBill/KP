// Журнал КП: список сохранённых КП, открытие, копия, удаление.
'use strict';

async function openJournal(){
  const d=$('#dlg');
  d.innerHTML=`<div class="dlg-h"><h3>Журнал КП</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><input type="text" id="jQ" placeholder="Поиск по номеру, получателю или позиции" autocomplete="off" style="margin-bottom:8px"><div id="jList"><p class="empty">Загружаю…</p></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  let rows=[]; try{ rows=await api('/api/history'); }catch(e){ $('#jList').innerHTML='<p class="empty">Журнал недоступен.</p>'; return; }
  rows.sort((a,b)=>String(b.number).localeCompare(String(a.number)));
  const draw=()=>{ const q=norm($('#jQ').value); const list=rows.filter(r=>!q||norm([r.number,r.client,(r.items||[]).join(' ')].join(' ')).includes(q));
    $('#jList').innerHTML = list.length ? list.map(r=>`<div class="jr"><div><span class="n">№ ${esc(r.number)}</span><div class="muted">${esc(KPGen.ruDate(r.date))}</div></div>
      <div><b>${esc(r.client)}</b><span class="muted">${money(r.sum||0)} руб. · ${r.positions||0} ${plural(r.positions||0,'позиция','позиции','позиций')}${(r.items&&r.items[0])?' · '+esc(r.items[0]):''}</span></div>
      <div class="acts"><button class="btn" type="button" data-jo="${esc(r.id)}">Открыть</button><button class="btn" type="button" data-jc="${esc(r.id)}">Копия</button><button class="btn" type="button" data-a="openDoc" data-id="${esc(r.id)}">${SRV.info&&SRV.info.local===false?'Скачать':'Word'}</button></div></div>`).join('')
      : `<p class="empty">${rows.length?'Ничего не найдено.':'Журнал пуст. Сохранённые КП появятся здесь.'}</p>`; };
  draw(); $('#jQ').oninput=draw;
  $('#jList').onclick=async e=>{
    const o=e.target.closest('[data-jo]'), c=e.target.closest('[data-jc]'); if(!o&&!c) return;
    try{
      const st=await api(`/api/kp/${(o||c).dataset[o?'jo':'jc']}/state`);
      S=Object.assign(freshState(), st);
      if (c){ delete S.kpId; delete S.number; S.date=today(); S.client=''; }
      d.close(); renderForm(); persist(); window.scrollTo({top:0});
      toast(c?'Создана копия — укажите получателя':'КП № '+S.number+' открыто для редактирования');
    }catch(err){ toast('Не удалось открыть КП'); }
  };
}
