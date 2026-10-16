// Карточка клиента (ClientCard): реквизиты, контакты и объекты из справочника, все КП клиента с итогами
// по статусам, заметки отдела о клиенте. Сервер — ClientCardController (app/web_api.py). Открывается из раздела
// «Клиент» и из журнала (название клиента).
'use strict';

class ClientCard {
  static on(){ return FEAT.on('clientCard'); }
  static link(o, text){ if (!this.on() || !(o.id || o.inn || o.name)) return esc(text||'');
    return `<button type="button" class="lnk cc-l" data-cc="${esc(JSON.stringify({id:o.id||'', inn:o.inn||'', name:o.name||''}))}" title="Карточка клиента">${esc(text||o.name||'')}</button>`; }

  /** сумма КП в его валюте (для строки карточки) */
  static sum(x){ return ((x.econ&&x.econ.sum!=null)?x.econ.sum:x.sum)||0; }
  static tile(label, val, sub=''){ return `<div class="cc-t"><span>${label}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`; }
  static notesHtml(L, me){
    return L.length ? L.map(n=>`<div class="cc-n"><div><span class="muted">${esc(Fmt.dateTime(n.at))} · ${esc(n.by||'')}</span><p>${esc(n.text)}</p></div>${n.uid===me||ADMIN.on?`<button class="icon" type="button" data-ccnd="${esc(n.at)}" aria-label="Удалить заметку" title="Удалить заметку">✕</button>`:''}</div>`).join('')
      : '<p class="empty">Заметок нет. Запишите то, что важно знать коллегам: кто принимает решение, бюджет, особенности объекта.</p>';
  }

  static async open(o){
    if (!this.on()) return;
    let r; try{ r=await api(`/api/clientcard?id=${encodeURIComponent(o.id||'')}&inn=${encodeURIComponent(o.inn||'')}&name=${encodeURIComponent(o.name||'')}`); }
    catch(e){ return toast('Карточка клиента недоступна: '+(e.message||e)); }
    const c=r.client||{}, K=r.kps||[], by=r.by||{}, n=k=>(by[k]||{}).n||0, s=k=>(by[k]||{}).sum||0, me=meId()||'';
    const won=n('won'), lost=n('lost'), open=K.length-won-lost, tr=FEAT.on('track');
    const req=[c.inn||r.inn?'ИНН '+esc(c.inn||r.inn):'', c.kpp?'КПП '+esc(c.kpp):'', c.ogrn?'ОГРН '+esc(c.ogrn):''].filter(Boolean).join(' · ');
    const cons=(c.contacts||[]).filter(x=>x&&x.name), objs=(c.objects||[]).filter(x=>x&&(x.purpose||x.address));
    const m=new Modal(`<div class="dlg-h"><div><h3>${esc(c.name||r.name||'Клиент')}</h3><span class="muted cc-req">${req||'реквизиты не указаны'}${c.status?' · '+esc(c.status):''}</span></div><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${c.address||c.director?`<p class="muted cc-addr">${esc(c.address||'')}${c.director?`${c.address?'<br>':''}${esc((c.directorPost||'Руководитель')+': '+c.director)}`:''}</p>`:''}
      <div class="cc-tiles">${this.tile('Всего КП', K.length, `${money(r.total||0)} руб.`)}
        ${tr?this.tile('В работе', open, `${money(K.length?(r.total||0)-s('won')-s('lost'):0)} руб.`)+this.tile('Выиграно', won, `${money(s('won'))} руб.`)+this.tile('Конверсия', won+lost?Math.round(won/(won+lost)*100)+' %':'—', won+lost?`из ${won+lost} закрытых`:'нет закрытых'):''}
        ${this.tile('Последнее КП', K[0]?esc(KpDate.ddmm(K[0].date)):'—', K[0]?esc(jShort(K[0].manager||'')):'')}</div>
      <div class="cc-g">
        <section class="cc-kps"><p class="sub">КП клиента${r.managers&&r.managers.length?` <span class="muted">· ведут: ${r.managers.slice(0,3).map(x=>esc(jShort(x))).join(', ')}</span>`:''}</p>
          <div class="cc-kl">${K.length?K.map(x=>`<div class="md-r"><span class="md-n">№ ${esc(x.number)}</span><div><b>${esc(KpDate.ddmm(x.date))} · ${money(ClientCard.sum(x))} ${esc(curSh((x.econ&&x.econ.cur)||'RUB'))}</b><span class="muted">${esc((x.items||[])[0]||'')}${x.positions>1?` и ещё ${x.positions-1}`:''} · ${esc(jShort(x.manager||''))}</span>${tr?`<span class="md-st">${KpTrack.chip(x)}</span>`:''}</div><button class="btn sm" type="button" data-cco="${esc(x.id)}">Открыть</button></div>`).join(''):'<p class="empty">КП этому клиенту ещё не было.</p>'}</div></section>
        <div class="cc-side">
          <section><p class="sub">Контакты</p>${cons.length?cons.slice(0,8).map(x=>`<div class="cc-c"><b>${esc(x.name)}</b><span class="muted">${esc([x.post, x.phone, x.email].filter(Boolean).join(' · '))}</span></div>`).join(''):'<p class="empty">Контакты появятся после сохранения КП с контактным лицом.</p>'}</section>
          ${objs.length?`<section><p class="sub">Объекты</p>${objs.slice(0,6).map(x=>`<div class="cc-c"><b>${esc(x.purpose||'Объект')}</b><span class="muted">${esc(x.address||'')}</span></div>`).join('')}</section>`:''}
          <section><p class="sub">Заметки</p>${c.id?`<div class="cc-add"><textarea id="ccN" rows="2" maxlength="2000" placeholder="Заметка о клиенте — видна всем менеджерам"></textarea><button class="btn" type="button" data-ccna>Добавить</button></div>`:'<p class="muted" style="margin:0 0 6px;font-size:13px">Клиента нет в справочнике — заметки появятся после сохранения КП.</p>'}
            <div id="ccNotes">${this.notesHtml(r.notes||[], me)}</div></section>
        </div>
      </div>
      <div class="dlg-acts"><button class="btn primary" type="button" data-ccnew>＋ Новое КП этому клиенту</button></div>`, 'cc-dlg');
    const note=async body=>{ try{ const x=await api('/api/clientcard/note', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({id:c.id, ...body})});
      m.$('#ccNotes').innerHTML=this.notesHtml(x.notes||[], me); return true; }catch(e){ toast('Не сохранено: '+(e.message||e)); return false; } };
    m.d.onclick=async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return m.close();
      const ko=t.closest('[data-cco]'); if (ko){ m.close(); return KpLoader.byId(ko.dataset.cco).catch(err=>toast('Не открылось: '+err.message)); }
      const st=t.closest('[data-jst]'); if (st){ const row=K.find(x=>x.id===st.dataset.jst); if (row){ m.close(); KpTrack.open(row); } return; }
      if (t.closest('[data-ccna]')){ const v=m.$('#ccN').value.trim(); if (!v) return m.$('#ccN').focus(); if (await note({text:v})) m.$('#ccN').value=''; return; }
      const nd=t.closest('[data-ccnd]'); if (nd){ if (confirm('Удалить заметку?')) note({del:nd.dataset.ccnd}); return; }
      if (t.closest('[data-ccnew]')){ m.close(); await Drafts.stash(); S=freshState(); if (c.id) applyClient(c); else { S.client=r.name||''; S.clientInn=r.inn||''; renderForm(); persist(); }
        Drafts.loaded(); goStep('equip'); toast('Новое КП для '+(c.name||r.name||'клиента')); } };
  }
}


document.addEventListener('click', e=>{ const b=e.target.closest('[data-cc]'); if (!b) return; e.preventDefault();
  let o={}; try{ o=JSON.parse(b.dataset.cc); }catch(err){ return; } ClientCard.open(o); });
