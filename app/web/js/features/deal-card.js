// Карточка сделки (кабинет менеджера): этап, сумма, ожидаемая дата, заметка, ответственный, дела, КП сделки, история.
// Поля сохраняются сразу при изменении (номер правки — X-KP-Rev). Новая сделка — DealCard.create; выбор сделки в разделе
// «Клиент» КП — DealPick; новое КП для сделки — DealCard.newKp.
'use strict';

class DealCard {
  static d=null;
  static m=null;
  static changed=false;
  static open(id){ return Modal.once('deal-card', ()=>this._open(id)); }
  static async _open(id){
    let d; try{ d=await api('/api/crm/deal/'+encodeURIComponent(id)); }catch(e){ return toast('Сделка не открылась: '+e.message); }
    this.d=d; this.changed=false;
    const m=this.m=new Modal(this.html(), 'deal-dlg');
    m.d.addEventListener('close', ()=>{ if (this.changed && Cabinet.dlg().open) Cabinet.reload(); this.m=null; });
    m.d.addEventListener('click', e=>this.click(e));
    m.d.addEventListener('change', e=>this.change(e));
    CrmTask.bind(m.d, ()=>this.reload());
  }
  static async reload(){ try{ this.d=await api('/api/crm/deal/'+this.d.id); }catch(e){ return toast('Не обновилось: '+e.message); } this.changed=true; this.render(); }
  /** перерисовка на месте (morph): поле, в котором сейчас печатают, сохраняет набранное (ответ сервера пришёл позже) */
  static render(){ if (!this.m) return; const a=document.activeElement, f=a && this.m.d.contains(a) && (a.matches('input,textarea')) ? a : null, v=f ? f.value : null;
    morph(this.m.d, this.html()); if (f && f.isConnected && f.value!==v) f.value=v; }
  static stages(){ return this.d.stages||CrmData.stages(); }
  static html(){
    const d=this.d, S_=this.stages(), open=S_.filter(s=>!s.closed), i=open.findIndex(s=>s.key===d.stage), closed=d.stage==='won'||d.stage==='lost';
    const auto=(d.kps||[]).find(k=>k.status!=='lost')||(d.kps||[])[0];
    const step=`<div class="dk-st" role="radiogroup" aria-label="Этап сделки">${open.map((s,k)=>`<button type="button" role="radio" aria-checked="${s.key===d.stage}" class="dk-s${s.key===d.stage?' on t-'+CrmData.tone(s.key):k<i&&!closed?' past':''}" data-dks="${esc(s.key)}">${esc(s.label)}</button>`).join('')}
      <span class="dk-sp"></span><button type="button" role="radio" aria-checked="${d.stage==='won'}" class="dk-s dk-won${d.stage==='won'?' on':''}" data-dks="won">✓ ${esc((S_.find(s=>s.key==='won')||{}).label||'Выиграно')}</button><button type="button" role="radio" aria-checked="${d.stage==='lost'}" class="dk-s dk-lost${d.stage==='lost'?' on':''}" data-dks="lost">✕ ${esc((S_.find(s=>s.key==='lost')||{}).label||'Проиграно')}</button></div>
      ${d.stage==='lost'?`<p class="msg warn dk-why">Причина: ${esc(d.lostReason||'не указана')} <button type="button" class="lnk" data-dks="lost">изменить</button></p>`:''}`;
    const B=CrmData.B||{}, mgr=B.canAll&&(B.managers||[]).length ? `<label class="f"><span>Ответственный</span><select data-dkf="managerId">${(B.managers||[]).map(m=>`<option value="${esc(m.id)}"${m.id===d.managerId?' selected':''}>${esc(m.name)}</option>`).join('')}${(B.managers||[]).some(m=>m.id===d.managerId)?'':`<option value="${esc(d.managerId)}" selected>${esc(d.manager||'—')}</option>`}</select></label>` : '';
    const fields=`<div class="dk-f"><label class="f"><span>Клиент</span><input type="text" data-dkf="client" value="${esc(d.client||'')}" maxlength="300" list="dkCl" autocomplete="off"></label>
      <label class="f"><span>Сумма, ₽ ${d.sumOwn?'<em class="muted">своя</em>':'<em class="muted">по КП</em>'}</span><input type="text" inputmode="decimal" data-dkf="sum" value="${d.sumOwn?esc(String(Math.round((d.sum||0)/100))):''}" placeholder="${esc(auto?Math.round((auto.sum||0)/100).toLocaleString('ru-RU')+' — по КП № '+auto.number:'по последнему КП')}"></label>
      <label class="f"><span>Ожидаемая дата</span><input type="date" data-dkf="expected" value="${esc(d.expected||'')}"></label>${mgr}</div>
      <label class="f dk-note"><span>Заметка</span><textarea data-dkf="note" rows="2" maxlength="3000" placeholder="Кто принимает решение, бюджет, конкуренты, особенности объекта">${esc(d.note||'')}</textarea></label>
      <datalist id="dkCl">${(CLIENTS||[]).slice(0, 50).map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist>`;
    const T=d.tasks||[], tOpen=T.filter(t=>t.state==='open'), tDone=T.filter(t=>t.state!=='open');
    const tasks=`<section class="md-s"><div class="md-h"><p class="sub">Дела${tOpen.length?` <b class="md-c">${tOpen.length}</b>`:''}</p></div>${CrmTask.form(d.id)}
      <div class="tk-l">${tOpen.map(t=>CrmTask.row(t, {noDeal:true, date:true})).join('')||'<p class="empty">Запланируйте следующее дело — звонок, встречу или письмо.</p>'}
      ${tDone.length?`<details class="tk-done"><summary>Сделано и отменено (${tDone.length})</summary>${tDone.map(t=>CrmTask.row(t, {noDeal:true, date:true})).join('')}</details>`:''}</div></section>`;
    const K=d.kps||[];
    const kps=`<section class="md-s"><div class="md-h"><p class="sub">КП по сделке${K.length?` <b class="md-c">${K.length}</b>`:''}</p></div>
      ${K.map(k=>`<div class="md-r"><span class="md-n">№ ${esc(k.number)}</span><div><b>${esc(KpDate.ddmm(k.date))} · ${CrmFmt.rub(k.sum)}</b><span class="muted">${esc((k.items||[])[0]||'')}${k.positions>1?` и ещё ${k.positions-1}`:''}${k.validUntil?` · действует до ${esc(KpDate.ddmm(k.validUntil))}`:''}</span>${FEAT.on('track')?`<span class="md-st"><span class="jst st-${esc(k.status)}">${esc(KP_STATUS[k.status]||k.status)}</span></span>`:''}</div><button class="btn sm" type="button" data-dko="${esc(k.id)}">Открыть</button></div>`).join('')||'<p class="empty">КП ещё нет.</p>'}
      <div class="row dk-kb"><button class="btn primary" type="button" data-dknew>＋ Новое КП для сделки</button><button class="btn ghost" type="button" data-dklink>Добавить КП клиента</button></div></section>`;
    const H=(d.history||[]).slice().reverse();
    const hist=H.length?`<details class="dk-h"><summary>История (${H.length})</summary>${H.map(h=>`<div class="dk-hr"><span class="muted">${esc(Fmt.dateTime(h.at))} · ${esc(h.by||'')}</span> ${esc(this.hist(h))}</div>`).join('')}</details>`:'';
    const bx=d.bx ? (d.bx.id ? `<span class="dk-bx">Битрикс24: ${d.bx.url?`<a href="${esc(d.bx.url)}" target="_blank" rel="noopener">сделка ${esc(d.bx.id)}</a>`:'сделка '+esc(d.bx.id)} · синхронизировано ${esc(Fmt.dateTime(d.bx.at))}</span>`
      : `<span class="dk-bx${d.bx.error?' bad-t':''}">Битрикс24: ${d.bx.error?'не отправлено — '+esc(d.bx.error):'ждёт отправки'}</span>`) : '';
    return `<div class="dlg-h"><div class="dk-hd"><span class="muted">Сделка № ${esc(d.number)}${d.manager?' · '+esc(d.manager):''} · создана ${esc(KpDate.ddmm(String(d.created||'').slice(0,10)))}</span>${bx}
        <input type="text" class="dk-title" data-dkf="title" value="${esc(d.title||'')}" maxlength="200" aria-label="Название сделки" placeholder="Название: объект или задача клиента"></div>
        ${ClientCard.on()&&(d.client||d.clientInn)?`<button class="btn sm ghost" type="button" data-cc="${esc(JSON.stringify({id:d.clientId||'', inn:d.clientInn||'', name:d.client||''}))}">Карточка клиента</button>`:''}<button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${step}${fields}<div class="dk-g">${tasks}${kps}</div>${hist}`;
  }
  static hist(h){
    const st=k=>(this.stages().find(s=>s.key===k)||{label:k}).label;
    if (h.what==='create') return h.kp?`сделка создана по КП № ${h.kp}`:'сделка создана';
    if (h.what==='stage') return `этап: ${st(h.from)} → ${st(h.to)}${h.auto?' (по ходу КП)':''}`;
    if (h.what==='kp') return `добавлено КП № ${h.kp}`;
    if (h.what==='kpOut') return `КП № ${h.kp} перенесено в другую сделку`;
    if (h.what==='manager') return `ответственный: ${h.to}`;
    if (h.what==='edit') return 'изменено: '+(h.fields||[]).map(f=>({title:'название', client:'клиент', expected:'ожидаемая дата', sum:'сумма', note:'заметка'})[f]||f).join(', ');
    return '';
  }
  static q=Promise.resolve();      // сохранения — по очереди: каждое со свежим номером правки (иначе поле и кнопка этапа
                                   // подряд конфликтовали бы сами с собой)
  static save(body){ const r=this.q.then(()=>this._save(body)); this.q=r.catch(()=>{}); return r; }
  static async _save(body){
    if (!this.d) return false;
    try{ this.d=await api('/api/crm/deal/'+this.d.id, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8', 'X-KP-Rev':String(this.d.rev)}, body:JSON.stringify(body)});
      this.changed=true; return true; }
    catch(e){ toast('Не сохранено: '+e.message); try{ this.d=await api('/api/crm/deal/'+this.d.id); }catch(_){} return false; }
    finally{ this.render(); }
  }
  static async change(e){
    const f=e.target.closest('[data-dkf]'); if (!f) return;
    const k=f.dataset.dkf, v=f.value;
    if (k==='title' && !v.trim()) return toast('Название сделки не может быть пустым');
    const body={[k]:k==='sum'?v.replace(/\s/g,''):v};
    if (k==='client'){ const c=(CLIENTS||[]).find(x=>norm(x.name)===norm(v)); body.clientInn=c?c.inn||'':''; body.clientId=c?c.id:''; }
    if (await this.save(body)) toast('Сохранено');
  }
  static async click(e){
    const t=e.target, d=this.d;
    if (t.closest('[data-x]')) return this.m.close();
    const s=t.closest('[data-dks]'); if (s){ const k=s.dataset.dks; if (k===d.stage && k!=='lost') return;
      const body={stage:k}; if (k==='lost'){ const r=await this.lostReason(d); if (!r) return; body.lostReason=r; }
      if (await this.save(body)) toast('Этап: '+(this.stages().find(x=>x.key===k)||{}).label); return; }
    const o=t.closest('[data-dko]'); if (o){ this.m.close(); Cabinet.dlg().close(); return KpLoader.byId(o.dataset.dko).catch(err=>toast('Не открылось: '+err.message)); }
    if (t.closest('[data-dknew]')) return this.newKp(d);
    if (t.closest('[data-dklink]')) return this.link(d);
    const cc=t.closest('[data-cc]'); if (cc){ try{ return ClientCard.open(JSON.parse(cc.dataset.cc)); }catch(_){ return; } }
  }
  /** причина проигрыша: из списка «Причины проигрыша» или своя */
  static lostReason(d){
    return new Promise(res=>{ const L=[...new Set([...KP_LOST, ...(d.lostReason&&!KP_LOST.includes(d.lostReason)?[d.lostReason]:[])])];
      const m=new Modal(`<div class="dlg-h"><h3>Сделка проиграна</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
        <p class="muted" style="margin:0 0 8px">«${esc(d.title||d.client)}» — почему? Причины помогают руководителю видеть, где теряем сделки.</p>
        <div class="dk-lr">${L.map(r=>`<label class="ck"><input type="radio" name="dkr" value="${esc(r)}"${r===d.lostReason?' checked':''}> ${esc(r)}</label>`).join('')}
        <label class="f"><span>Другая причина</span><input type="text" id="dkrO" maxlength="200"></label></div>
        <div class="row"><button class="btn primary" type="button" data-ok>Сделка проиграна</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div>`, 'dk-lost-dlg');
      let v=null;
      m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) return m.close();
        if (e.target.closest('[data-ok]')){ v=m.$('#dkrO').value.trim() || (m.d.querySelector('input[name=dkr]:checked')||{}).value || '';
          if (!v) return toast('Выберите или впишите причину'); m.close(); } });
      m.d.addEventListener('close', ()=>res(v)); });
  }
  /** новое КП для сделки: клиент из сделки, КП сохранится в эту сделку */
  static async newKp(d){
    if (Drafts.meaningful(S)){ if (Drafts.on()){ if (!await Drafts.stash()) return; } else if (!confirm(S.kpId?'Начать новое КП? Сохранённое КП № '+S.number+' останется в журнале.':'Начать новое КП? Текущий черновик будет очищен.')) return; }
    if (this.m) this.m.close(); Cabinet.dlg().close();
    S=freshState(); NewKp.myContacts(); S.dealId=d.id;
    const c=(d.clientId||d.clientInn) ? await clientById(d.clientId||('inn'+d.clientInn)).catch(()=>null) : null;
    if (c) applyClient(c); else { S.client=d.client||''; S.clientInn=d.clientInn||''; renderForm(); persist(); }
    toast(`Новое КП для сделки «${d.title||d.client}»`);
    if (catCache.length) openCatalog({});
  }
  /** КП клиента — в эту сделку (из другой сделки оно уходит) */
  static async link(d){
    const q=d.clientInn||d.client; if (!q) return toast('У сделки не указан клиент');
    let L=[]; try{ L=((await api(`/api/history?limit=40&offset=0&q=${encodeURIComponent(q)}`)).items||[]).filter(x=>!(d.kps||[]).some(k=>k.id===x.id)); }catch(e){ return toast('Журнал недоступен: '+e.message); }
    const m=new Modal(`<div class="dlg-h"><h3>КП клиента в сделку</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 8px">КП из другой сделки перейдёт в эту.</p>
      <div class="nk-l">${L.map(x=>`<div class="md-r"><span class="md-n">№ ${esc(x.number)}</span><div><b>${esc(KpDate.ddmm(x.date))} · ${esc(x.client||'')}</b><span class="muted">${esc((x.items||[])[0]||'')} · ${esc(jShort(x.manager||''))}</span></div><button class="btn sm" type="button" data-kl="${esc(x.id)}">В сделку</button></div>`).join('')||'<p class="empty">Других КП этого клиента нет.</p>'}</div>`, 'dk-link-dlg');
    m.d.addEventListener('click', async e=>{ if (e.target.closest('[data-x]')) return m.close();
      const b=e.target.closest('[data-kl]'); if (!b) return;
      try{ await api(`/api/crm/deal/${d.id}/kp`, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({kp:b.dataset.kl})}); }
      catch(err){ return toast('Не добавлено: '+err.message); }
      b.closest('.md-r').remove(); toast('КП в сделке'); this.reload(); });
  }
  /** новая сделка: клиент и название (остальное — в карточке) */
  static create(){
    const m=new Modal(`<div class="dlg-h"><h3>Новая сделка</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Сделки появляются и сами — при сохранении КП. Здесь — сделка без КП: запрос, встреча, тендер.</p>
      <form class="dk-new"><label class="f"><span class="req">Клиент</span><input type="text" name="client" maxlength="300" list="dkNewCl" autocomplete="off" placeholder="Название или ИНН"></label>
        <label class="f"><span>Объект или задача</span><input type="text" name="title" maxlength="200" placeholder="Например: компрессорная для цеха № 3"></label>
        <label class="f"><span>Ожидаемая дата</span><input type="date" name="expected" value="${KpDate.addDays(today(), 30)}"></label>
        <datalist id="dkNewCl">${(CLIENTS||[]).slice(0, 50).map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist>
        <div class="row"><button class="btn primary" type="submit">Создать сделку</button><span class="sp"></span><button class="btn" type="button" data-x>Отмена</button></div></form>`, 'dk-new-dlg');
    const f=m.$('form'), E=f.elements;
    E.client.addEventListener('input', async ()=>{ const v=E.client.value.trim(); if (v.length<2) return;
      try{ const r=await api('/api/clients?limit=8&q='+encodeURIComponent(v)); clientsKeep(r.items||[]);
        m.$('#dkNewCl').innerHTML=(r.items||[]).map(c=>`<option value="${esc(c.name)}">${esc(c.inn?'ИНН '+c.inn:'')}</option>`).join(''); }catch(e){} });
    m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) m.close(); });
    f.onsubmit=async e=>{ e.preventDefault();
      const v=E.client.value.trim(), c=(CLIENTS||[]).find(x=>norm(x.name)===norm(v) || (x.inn && x.inn===v.replace(/\D/g,'')));
      if (!v && !E.title.value.trim()) return toast('Укажите клиента');
      const body={client:c?c.name:v, clientInn:c?c.inn||'':'', clientId:c?c.id:'', title:E.title.value.trim()||(c?c.name:v), expected:E.expected.value};
      if (CrmData.who && CrmData.who!=='all') body.managerId=CrmData.who;
      if (f.dataset.busy) return; f.dataset.busy='1';          // двойное нажатие / Enter — одна сделка
      try{ const d=await api('/api/crm/deal', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)});
        m.close(); if (Cabinet.dlg().open) await Cabinet.reload(); this.open(d.id); }
      catch(err){ toast('Сделка не создана: '+err.message); }
      finally{ delete f.dataset.busy; } };
    setTimeout(()=>E.client.focus(), 50);
  }
}

/** раздел «Клиент» КП: в какую сделку попадёт КП (показывается, когда у клиента есть незакрытые сделки или КП уже в сделке) */
class DealPick {
  static C={key:'', items:[], current:'', busy:false};
  static html(){
    if (!MyDay.on() || !(S.client||S.clientInn)) return '';
    const key=[String(S.clientInn||'').replace(/\D/g,''), norm(S.client), S.kpId||''].join('|'), C=this.C;
    if (C.key!==key){ if (!C.busy) this.load(key); return ''; }
    const cur=C.current, sel=S.dealId||cur||'', L=C.items;
    if (!L.length) return '';
    const st=k=>(C.stages||[]).find(s=>s.key===k)?.label||k;
    const opt=x=>`<option value="${esc(x.id)}"${x.id===sel?' selected':''}>№ ${esc(x.number)} · ${esc(x.title||x.client)} — ${esc(st(x.stage))}${x.id===cur?' (сейчас)':''}</option>`;
    return `<div class="csec deal-pick"><p class="sub">Сделка${tip('<p>Все КП по одной задаче клиента (объект, закупка) собираются в одну сделку — в «Кабинете» видно сумму, этап и дела по ней.</p><p>Выберите сделку, к которой относится это КП, или оставьте новую.</p>')}</p>
      <div class="row dp-r"><select data-p="dealId" aria-label="Сделка для этого КП">${cur?'':`<option value=""${sel?'':' selected'}>Новая сделка</option>`}${L.map(opt).join('')}${cur?`<option value="new"${sel==='new'?' selected':''}>Отдельная новая сделка</option>`:''}</select>
      ${sel&&sel!=='new'?`<button class="btn ghost" type="button" data-a="dealOpen" data-id="${esc(sel)}">Открыть сделку</button>`:''}</div></div>`;
  }
  static async load(key){
    this.C.busy=true; const [inn, , kp]=key.split('|');
    try{ const r=await api(`/api/crm/pick?inn=${encodeURIComponent(inn)}&name=${encodeURIComponent(S.client||'')}&kp=${encodeURIComponent(kp)}`);
      Object.assign(this.C, {items:r.items||[], current:r.current||'', stages:r.stages||[]}); }
    catch(e){ Object.assign(this.C, {items:[], current:''}); }
    this.C.key=key; this.C.busy=false; if (STEP==='client' && this.C.items.length) renderForm();
  }
}
