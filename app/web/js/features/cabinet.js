// Кабинет менеджера (функция myDay; сервер — app/crm.py, /api/crm/*): вкладки «Сегодня», «Сделки» (доска по этапам),
// «График» (сроки сделок, поставка, дела), «Клиенты», «Отдел» (администратору и менеджерам с правом «КП других менеджеров»).
// Сделка — клиент и его задача: все КП по ней, сумма, этап, ожидаемая дата, дела. КП попадает в сделку при сохранении.
'use strict';

// встроенные этапы сделки — «Настройки → Списки и тексты → Этапы сделки» (crm.stages); названия у сервера — из того же списка
const CRM_STAGES = [{id:'lead', name:'Запрос'}, {id:'sent', name:'КП отправлено'}, {id:'talks', name:'Переговоры'}, {id:'contract', name:'Договор и оплата'},
  {id:'delivery', name:'Поставка'}, {id:'won', name:'Выиграно'}, {id:'lost', name:'Проиграно'}];

class CrmFmt {
  /** суммы сделок хранятся в копейках */
  static rub(kop){ return Money.rub((+kop||0)/100); }
  /** коротко для карточек: 1,2 млн ₽ · 350 тыс. ₽ */
  static short(kop){ return Money.short((+kop||0)/100); }
  static day(iso){ const m=String(iso||'').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${m[2]}.${m[1]}` : ''; }
  static diff(iso){ return Math.round((CrmFmt.dn(iso)-CrmFmt.dn(today()))); }
  /** номер дня (для графика и сравнения) */
  static dn(iso){ return Math.round(Date.parse(String(iso).slice(0,10)+'T12:00:00Z')/864e5); }
  static iso(n){ return new Date(n*864e5).toISOString().slice(0,10); }
  /** «сегодня», «завтра», «вчера», «через 5 дн.», «3 дн. назад» */
  static rel(iso){ const d=CrmFmt.diff(iso);
    return d===0?'сегодня':d===1?'завтра':d===-1?'вчера':d>0&&d<7?`через ${d} дн.`:d<0&&d>-7?`${-d} дн. назад`:CrmFmt.day(iso); }
}

/** данные кабинета: ответ /api/crm/board и чей кабинет открыт */
class CrmData {
  static B=null;
  static who='';                    // '' — свой, 'all' — весь отдел, id — менеджер
  static KINDS={call:'☎', meet:'👥', mail:'✉', task:'✓'};
  static seq=0;          // ответ на устаревший запрос (успели сменить «Чей кабинет») не применяется
  static async load(){ const my=++this.seq, b=await api('/api/crm/board?manager='+encodeURIComponent(this.who)); if (my===this.seq) this.B=b; return this.B; }
  static stages(open=false){ return ((this.B&&this.B.stages)||[]).filter(s=>!open||!s.closed); }
  static stage(k){ return this.stages().find(s=>s.key===k)||{key:k, label:k}; }
  static closed(d){ return d.stage==='won' || d.stage==='lost'; }
  static openDeals(){ return ((this.B&&this.B.deals)||[]).filter(d=>!this.closed(d)); }
  static deal(id){ return ((this.B&&this.B.deals)||[]).find(d=>d.id===id); }
  static mine(){ return !this.who || (this.B && this.who===this.B.me); }
  static all(){ return this.who==='all'; }
  /** цвет этапа: открытые — от светлого к тёмному синему по порядку, «Выиграно» — зелёный, «Проиграно» — серый */
  static tone(k){ if (k==='won') return 'won'; if (k==='lost') return 'lost';
    const o=this.stages(true), i=Math.max(0, o.findIndex(s=>s.key===k)), n=Math.max(1, o.length-1);
    return 's'+Math.round(i/n*4); }
  static kind(k){ return ((this.B&&this.B.kinds)||[]).find(x=>x.key===k)?.label||k; }
  static icon(k){ return `<span class="tk-i tk-${esc(k)}" aria-hidden="true">${this.KINDS[k]||'•'}</span>`; }
  static tasks(){ return (this.B&&this.B.tasks)||[]; }
  static openTasks(){ return this.tasks().filter(t=>t.state==='open'); }
  static mgrShort(d){ return jShort(d.manager||((this.B&&this.B.managers)||[]).find(m=>m.id===d.managerId)?.name||''); }
}

/** дело: строка списка, быстрое добавление, правка */
class CrmTask {
  static row(t, o={}){
    const d=t.deal?CrmData.deal(t.deal):null, over=t.state==='open' && t.due<today(), done=t.state!=='open';
    const sub=[t.time, o.noDeal||!t.deal?'':`<button type="button" class="lnk" data-deal="${esc(t.deal)}">${esc(d?(d.title||d.client):'Сделка')}</button>`,
      CrmData.all()&&!o.noDeal?esc(jShort(((CrmData.B&&CrmData.B.managers)||[]).find(m=>m.id===t.managerId)?.name||'')):'', o.date?esc(CrmFmt.rel(t.due)):''].filter(Boolean).join(' · ');
    return `<div class="tk${over?' over':''}${done?' done':''}" data-task="${t.id}"><label class="tk-ck"><input type="checkbox" data-tdone="${t.id}"${done?' checked':''}${t.state==='cancel'?' disabled':''} aria-label="Сделано: ${esc(t.title)}"></label>
      ${CrmData.icon(t.kind)}<div><b>${esc(t.title)}${t.state==='cancel'?' <span class="muted">(отменено)</span>':''}</b>${sub?`<span class="muted">${sub}</span>`:''}${t.note?`<span class="muted tk-note">${esc(t.note)}</span>`:''}</div>
      ${done?'':`<button class="btn sm ghost" type="button" data-tlater="${t.id}" title="Перенести на завтра">+1 день</button>`}<button class="icon sm" type="button" data-tedit="${t.id}" aria-label="Изменить дело" title="Изменить">✎</button></div>`;
  }
  /** форма быстрого добавления: вид дела, что сделать, дата, время; deal — дело по сделке; pick — выбор сделки */
  static form(deal='', pick=false){
    const D=pick?CrmData.openDeals():[];
    return `<form class="tq" data-tq="${esc(deal)}"><div class="seg tq-k" role="radiogroup" aria-label="Вид дела">${((CrmData.B&&CrmData.B.kinds)||[]).map((k,i)=>`<button type="button" role="radio" aria-checked="${i===0}" class="${i===0?'on':''}" data-tqk="${k.key}">${CrmData.KINDS[k.key]||''} ${esc(k.label)}</button>`).join('')}</div>
      <div class="tq-r"><input type="text" name="title" maxlength="200" placeholder="Что сделать: например, позвонить главному инженеру" aria-label="Что сделать">
      <input type="date" name="due" value="${today()}" aria-label="Дата"><input type="time" name="time" aria-label="Время (необязательно)">
      ${pick&&D.length?`<select name="deal" aria-label="Сделка"><option value="">Без сделки</option>${D.map(d=>`<option value="${esc(d.id)}">${esc((d.title||'')+(d.client&&d.client!==d.title?' — '+d.client:''))}</option>`).join('')}</select>`:''}
      <button class="btn primary" type="submit">Добавить</button></div></form>`;
  }
  /** обработчики формы и строк дел внутри узла box; after(t) — после изменения */
  static bind(box, after){
    box.addEventListener('click', async e=>{ const t=e.target;
      const k=t.closest('[data-tqk]'); if (k){ const g=k.parentElement; g.querySelectorAll('button').forEach(b=>{ const on=b===k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); return; }
      const l=t.closest('[data-tlater]'); if (l){ const x=CrmData.tasks().find(z=>z.id===+l.dataset.tlater)||{}; const base=x.due&&x.due>today()?x.due:today();
        return this.put(+l.dataset.tlater, {due:KpDate.addDays(base, 1)}, after); }
      const ed=t.closest('[data-tedit]'); if (ed) return this.edit(+ed.dataset.tedit, after); });
    box.addEventListener('change', e=>{ const c=e.target.closest('[data-tdone]'); if (c) this.put(+c.dataset.tdone, {state:c.checked?'done':'open'}, after); });
    box.addEventListener('submit', async e=>{ const f=e.target.closest('form.tq'); if (!f) return; e.preventDefault();
      const E=f.elements, kind=f.querySelector('[data-tqk].on')?.dataset.tqk||'task', title=E.title.value.trim(), due=E.due.value;
      if (!due) return toast('Укажите дату дела');
      const body={kind, title, due, time:E.time.value, deal:f.dataset.tq||(E.deal?E.deal.value:'')};
      if (CrmData.all() && !body.deal && CrmData.B) body.managerId=CrmData.B.me;
      else if (CrmData.who && CrmData.who!=='all') body.managerId=CrmData.who;
      if (f.dataset.busy) return; f.dataset.busy='1';          // двойное нажатие / Enter — одно дело
      try{ const r=await api('/api/crm/task', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)});
        E.title.value=''; E.time.value=''; toast('Дело добавлено: '+r.title+', '+CrmFmt.rel(r.due)); if (after) after(r); }
      catch(err){ toast('Дело не добавлено: '+err.message); }
      finally{ delete f.dataset.busy; } });
  }
  static async put(id, body, after){
    try{ const r=await api('/api/crm/task/'+id, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)});
      if (body.state==='done') toast('Сделано: '+r.title); if (after) after(r); return r; }
    catch(e){ toast('Не сохранено: '+e.message); if (after) after(null); return null; }
  }
  /** правка дела: вид, что сделать, дата, время, заметка; «Отменить дело» (дела не удаляются) */
  static async edit(id, after, src){
    const t=(src||CrmData.tasks()).find(x=>x.id===id); if (!t) return;
    const m=new Modal(`<div class="dlg-h"><h3>Дело</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <form class="tk-ed"><div class="seg tq-k" role="radiogroup" aria-label="Вид дела">${((CrmData.B&&CrmData.B.kinds)||[]).map(k=>`<button type="button" role="radio" aria-checked="${k.key===t.kind}" class="${k.key===t.kind?'on':''}" data-tqk="${k.key}">${CrmData.KINDS[k.key]||''} ${esc(k.label)}</button>`).join('')}</div>
        <label class="f"><span>Что сделать</span><input type="text" name="title" maxlength="200" value="${esc(t.title)}"></label>
        <div class="row tk-dt"><label class="f"><span>Дата</span><input type="date" name="due" value="${esc(t.due)}"></label><label class="f"><span>Время</span><input type="time" name="time" value="${esc(t.time||'')}"></label></div>
        <label class="f"><span>Заметка</span><textarea name="note" rows="3" maxlength="1000">${esc(t.note||'')}</textarea></label>
        <div class="row"><button class="btn primary" type="submit">Сохранить</button>${t.state==='open'?'<button class="btn ghost" type="button" data-tcancel>Отменить дело</button>':'<button class="btn ghost" type="button" data-treopen>Вернуть в работу</button>'}<span class="sp"></span><button class="btn" type="button" data-x>Закрыть</button></div></form>`, 'tk-dlg');
    m.d.addEventListener('click', async e=>{ const x=e.target;
      if (x.closest('[data-x]')) return m.close();
      const k=x.closest('[data-tqk]'); if (k){ k.parentElement.querySelectorAll('button').forEach(b=>{ b.classList.toggle('on', b===k); b.setAttribute('aria-checked', b===k); }); return; }
      if (x.closest('[data-tcancel]')){ if (!confirm('Отменить дело «'+t.title+'»? Оно останется в истории.')) return; m.close(); return this.put(id, {state:'cancel'}, after); }
      if (x.closest('[data-treopen]')){ m.close(); return this.put(id, {state:'open'}, after); } });
    m.d.querySelector('form').onsubmit=e=>{ e.preventDefault(); const f=e.target, E=f.elements;
      if (!E.due.value) return toast('Укажите дату дела');
      m.close(); this.put(id, {kind:f.querySelector('[data-tqk].on')?.dataset.tqk||t.kind, title:E.title.value.trim(), due:E.due.value, time:E.time.value, note:E.note.value}, after); };
  }
}

/** окно кабинета: шапка (чей кабинет, быстрые кнопки), вкладки, содержимое вкладки */
class Cabinet {
  static TABS=[['today','Сегодня'], ['deals','Сделки'], ['gantt','График'], ['clients','Клиенты'], ['team','Отдел']];
  static KEY='kp.cab.tab';
  static tab='today';
  static q='';                      // поиск по сделкам и клиентам
  static dlg(){ return Modal.host('cabWin', 'cabwin', 'Кабинет менеджера', d=>this.init(d)); }
  static async open(tab){
    if (!MyDay.on()) return;
    try{ const s=localStorage.getItem('kp.cab.sort'); if (CabDeals.SORTS[s]) CabDeals.sort=s; }catch(e){}
    try{ this.tab=tab || localStorage.getItem(this.KEY) || 'today'; }catch(e){ this.tab=tab||'today'; }
    const d=this.dlg(); if (!d.open) d.showModal();
    if (!d.innerHTML) d.innerHTML='<p class="empty" style="padding:24px">Загружаю кабинет…</p>';
    await this.reload();
  }
  static async reload(){
    try{ await CrmData.load(); }
    catch(e){ const d=this.dlg(); d.innerHTML=`<div class="dlg-h"><h3>Кабинет</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div><p class="msg err">Кабинет не открылся: ${esc(e.message||e)}</p>`;
      if (e.status===403 && CrmData.who){ CrmData.who=''; } return; }
    if (this.tab==='team' && !CrmData.B.canAll) this.tab='today';
    if (FEAT.on('reminders') && CrmData.mine()) await Reminders.load();
    if (Drafts.on() && CrmData.mine()) this.drafts=await Drafts.list(); else this.drafts=[];
    this.render();
    const nb=CabToday.bxNew().length;
    if (nb && CrmData.mine() && this._bxSeen!==nb){ this._bxSeen=nb; toast(`Из Битрикс24 пришли новые сделки: ${nb} — вкладка «Сегодня»`); }
  }
  static hello(){ const h=new Date().getHours(); return h<5?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'; }
  static head(){
    const B=CrmData.B, me=MyDay.myName(), first=(me.split(/\s+/)[1]||me.split(/\s+/)[0]||'');
    const dt=new Date().toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'});
    const who=B.canAll ? `<select id="cabWho" class="cab-who" aria-label="Чей кабинет"><option value="">Мой кабинет</option><option value="all"${CrmData.who==='all'?' selected':''}>Весь отдел</option>
      ${(B.managers||[]).filter(m=>m.id!==B.me).map(m=>`<option value="${esc(m.id)}"${CrmData.who===m.id?' selected':''}>${esc(m.name)}</option>`).join('')}</select>` : '';
    const nT=CrmData.openTasks().filter(t=>t.due<=today()).length+CabToday.bxNew().length, nD=CrmData.openDeals().length;
    const tabs=this.TABS.filter(([k])=>k!=='team'||B.canAll).map(([k,l])=>`<button type="button" role="tab" aria-selected="${this.tab===k}" class="cab-tab${this.tab===k?' on':''}" data-ctab="${k}">${l}${k==='today'&&nT?` <b class="md-c">${nT}</b>`:k==='deals'&&nD?` <b class="md-c">${nD}</b>`:''}</button>`).join('');
    return `<div class="cab-h"><div class="cab-t"><h3>${CrmData.mine()?`${this.hello()}${first?', '+esc(first):''}!`:CrmData.all()?'Весь отдел':esc(((B.managers||[]).find(m=>m.id===CrmData.who)||{}).name||'Кабинет')}</h3><span class="muted md-date">${esc(dt)}</span></div>
      ${who}<div class="cab-q"><button class="btn primary" type="button" data-cq="newkp">＋ КП</button><button class="btn" type="button" data-cq="deal">＋ Сделка</button></div>
      <button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <nav class="cab-tabs" role="tablist" aria-label="Разделы кабинета">${tabs}</nav>`;
  }
  static render(){
    const d=this.dlg(), B=CrmData.B; if (!B) return;
    const sc=d.querySelector('.cab-b')?.scrollTop||0;
    const body = this.tab==='deals' ? CabDeals.html() : this.tab==='gantt' ? CabGantt.html() : this.tab==='clients' ? CabClients.html() : this.tab==='team' ? CabTeam.html() : CabToday.html();
    d.innerHTML=this.head()+`<div class="cab-b cab-${this.tab}">${body}</div>`;
    const b=d.querySelector('.cab-b'); if (b) b.scrollTop=sc;
    if (this.tab==='deals') CabDeals.bind(b);
    if (this.tab==='gantt') CabGantt.after(b);
  }
  static init(d){
    d.addEventListener('click', async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return d.close();
      if (t.closest('a.dc-bx')) return;          // ссылка на сделку в Битрикс24 — открывается в новой вкладке, без карточки
      const tb=t.closest('[data-ctab]'); if (tb){ this.tab=tb.dataset.ctab; try{ localStorage.setItem(this.KEY, this.tab); }catch(_){} return this.render(); }
      const q=t.closest('[data-cq]'); if (q){ const k=q.dataset.cq;
        if (k==='deal') return DealCard.create();
        d.close(); if (k==='newkp') return NewKp.open(); if (k==='journal') return openJournal(); if (k==='catalog') return openCatalog({}); if (k==='back') return; }
      const dl=t.closest('[data-deal]'); if (dl) return DealCard.open(dl.dataset.deal);
      const r=t.closest('[data-mdr]'); if (r){ const x=Reminders.items[+r.dataset.mdr]; d.close(); return KpLoader.byId(x.id).catch(err=>toast('Не открылось: '+err.message)); }
      if (t.closest('[data-mdall]')){ d.close(); return Reminders.open(); }
      if (t.closest('[data-mddr]')){ d.close(); return Drafts.dialog(); }
      const o=t.closest('[data-dro]'); if (o){ d.close(); return Drafts.open(o.dataset.dro); }
      const cc=t.closest('[data-cc]'); if (cc){ try{ return ClientCard.open(JSON.parse(cc.dataset.cc)); }catch(_){ return; } }
      const cd=t.closest('[data-cldeals]'); if (cd){ this.q=cd.dataset.cldeals; this.tab='deals'; return this.render(); }
      const tm=t.closest('[data-tmgr]'); if (tm){ CrmData.who=tm.dataset.tmgr; this.tab='deals'; return this.reload(); }
      const gs=t.closest('[data-gsc]'); if (gs){ CabGantt.set('scale', gs.dataset.gsc); return this.render(); } });
    d.addEventListener('change', e=>{ const t=e.target;
      if (t.id==='cabWho'){ CrmData.who=t.value; return this.reload(); }
      if (t.id==='mdStart'){ MyDay.setAtStart(t.checked); toast(t.checked?'Кабинет будет открываться при запуске':'Кабинет — в меню «⋯»'); return; }
      if (t.dataset.gsh){ CabGantt.set(t.dataset.gsh, t.checked); return this.render(); }
      if (t.id==='cabClosed'){ CabDeals.closed=t.checked; return this.render(); }
      if (t.id==='cabBxNew'){ CabDeals.bxOnly=t.checked; return this.render(); }
      if (t.id==='cabSort'){ CabDeals.sort=t.value; try{ localStorage.setItem('kp.cab.sort', t.value); }catch(_){} return this.render(); } });
    d.addEventListener('input', e=>{ const t=e.target; if (t.id==='cabQ'){ this.q=t.value; (this._qt=this._qt||new Debounce(250)).run(()=>{ const pos=t.selectionStart; this.render(); const n=this.dlg().querySelector('#cabQ'); if (n){ n.focus(); try{ n.setSelectionRange(pos, pos); }catch(_){} } }); } });
    CrmTask.bind(d, ()=>this.reload());
  }
  /** поиск: сделка подходит под строку (название, клиент, ИНН, номер, КП) */
  static match(d, q=this.q){ q=norm(q); if (!q) return true;
    return norm([d.title, d.client, d.clientInn, '№'+d.number, d.manager, ...(d.kps||[]).map(k=>k.number)].join(' ')).includes(q); }
  static search(ph){ return `<input type="search" id="cabQ" class="cab-s" value="${esc(this.q)}" placeholder="${esc(ph)}" aria-label="Поиск" autocomplete="off">`; }
}

/** «Сегодня»: показатели, дела, напоминания по КП, сделки без следующего дела, черновики */
class CabToday {
  /** новые сделки из Битрикс24, которые ответственный ещё не открывал */
  /** новая сделка из Битрикса не открыта больше суток */
  static late(d){ const t=Date.parse(d.created||''); return Number.isFinite(t) && Date.now()-t>864e5; }
  static bxNew(){ return CrmData.openDeals().filter(d=>d.bxNew && (!CrmData.B.me || d.managerId===CrmData.B.me || CrmData.all())); }
  static tile(label, val, sub='', cls=''){ return `<div class="cab-k${cls?' '+cls:''}"><span>${label}</span><b>${val}</b>${sub?`<small>${sub}</small>`:''}</div>`; }
  static html(){
    const T=CrmData.openTasks(), td=today(), over=T.filter(t=>t.due<td), now=T.filter(t=>t.due===td), tom=T.filter(t=>t.due===KpDate.addDays(td,1)),
      later=T.filter(t=>t.due>KpDate.addDays(td,1) && t.due<=KpDate.addDays(td,7)), doneToday=CrmData.tasks().filter(t=>t.state==='done' && String(t.doneAt||'').slice(0,10)===td);
    const D=CrmData.openDeals(), sum=D.reduce((a,d)=>a+(d.sum||0),0), mon=td.slice(0,7);
    const expM=D.filter(d=>String(d.expected||'').slice(0,7)<=mon), won=(CrmData.B.deals||[]).filter(d=>d.stage==='won' && String(d.stageAt||'').slice(0,7)===mon);
    const noTask=D.filter(d=>!d.next), late=D.filter(d=>d.expected && d.expected<td);
    const kpi=`<div class="cab-kpi">${this.tile('Дела на сегодня', over.length+now.length, over.length?`<span class="bad-t">${over.length} просрочено</span>`:doneToday.length?`сделано ${doneToday.length}`:'всё по плану', over.length?'bad':'')}
      ${this.tile('Сделки в работе', D.length, CrmFmt.short(sum))}${this.tile('Ожидаются в этом месяце', expM.length, CrmFmt.short(expM.reduce((a,d)=>a+(d.sum||0),0))+(late.length?` · <span class="bad-t">срок прошёл у ${late.length}</span>`:''))}
      ${this.tile('Выиграно в этом месяце', won.length, CrmFmt.short(won.reduce((a,d)=>a+(d.sum||0),0)), won.length?'ok':'')}</div>`;
    const grp=(t, L, o={})=>L.length?`<p class="tk-g${o.cls?' '+o.cls:''}">${t} <b class="md-c">${L.length}</b></p>${L.map(x=>CrmTask.row(x, o)).join('')}`:'';
    const tasks=`<section class="md-s cab-tasks"><div class="md-h"><p class="sub">Дела</p></div>${CrmTask.form('', true)}
      <div class="tk-l">${grp('Просрочено', over, {cls:'bad-t', date:true})}${grp('Сегодня', now)}${grp('Завтра', tom)}${grp('На неделе', later, {date:true})}
      ${!over.length&&!now.length&&!tom.length&&!later.length?'<p class="empty">Дел на неделю нет. Запланируйте звонок или встречу — кнопками выше.</p>':''}
      ${doneToday.length?`<details class="tk-done"><summary>Сделано сегодня (${doneToday.length})</summary>${doneToday.map(x=>CrmTask.row(x)).join('')}</details>`:''}</div></section>`;
    const R=FEAT.on('reminders')&&CrmData.mine() ? Reminders.items : [], nR=Math.round(DEFN('ui.mdRem', 5)), nD=Math.round(DEFN('ui.mdDrafts', 4)), Dr=Cabinet.drafts||[];
    const rem=FEAT.on('reminders')&&CrmData.mine() ? MyDay.section(`Напоминания по КП${R.length?` <b class="md-c">${R.length}</b>`:''}`, R.length ? R.slice(0, nR).map((x, i)=>`<div class="md-r${x.overdue?' over':''}"><span aria-hidden="true">${Reminders.icon(x.kind)}</span><div><b>${esc(x.text)}</b><span class="muted">КП № ${esc(x.number)} · ${esc(x.client)}${x.overdue?' · <span class="bad-t">просрочено</span>':''}</span></div><button class="btn sm" type="button" data-mdr="${i}">Открыть КП</button></div>`).join('') : '<p class="empty">Напоминаний нет.</p>', R.length>nR?'<button class="lnk" type="button" data-mdall>Все</button>':'') : '';
    const BX=this.bxNew();
    const bxs=BX.length ? MyDay.section(`Новые сделки из Битрикс24 <b class="md-c">${BX.length}</b>`, BX.slice(0, 6).map(d=>`<div class="md-r"><span class="cab-dot t-${CrmData.tone(d.stage)}" aria-hidden="true"></span><div><b>${esc(d.title||d.client)}</b><span class="muted">${esc(d.client&&d.client!==d.title?d.client+' · ':'')}${CrmFmt.short(d.sum)}${d.expected?' · до '+esc(CrmFmt.day(d.expected)):''}${this.late(d)?' · <span class="bad-t">ждёт больше суток</span>':''}</span></div><button class="btn sm primary" type="button" data-deal="${esc(d.id)}">Открыть</button></div>`).join('')) : '';
    const free=MyDay.section(`Сделки без следующего дела${noTask.length?` <b class="md-c">${noTask.length}</b>`:''}`, noTask.length ? noTask.slice(0, 6).map(d=>`<div class="md-r"><span class="cab-dot t-${CrmData.tone(d.stage)}" aria-hidden="true"></span><div><b>${esc(d.title||d.client)}</b><span class="muted">${esc(d.client&&d.client!==d.title?d.client+' · ':'')}${esc(CrmData.stage(d.stage).label)} · ${CrmFmt.short(d.sum)}</span></div><button class="btn sm" type="button" data-deal="${esc(d.id)}">Открыть</button></div>`).join('')+(noTask.length>6?`<p class="muted" style="margin:6px 0 0">и ещё ${noTask.length-6} — на вкладке «Сделки»</p>`:'') : '<p class="empty">У каждой сделки запланировано следующее дело.</p>');
    const drafts=Drafts.on()&&CrmData.mine() ? MyDay.section(`Черновики${Dr.length?` <b class="md-c">${Dr.length}</b>`:''}`, Dr.length?Dr.slice(0, nD).map(r=>`<div class="md-r"><div><b>${esc(r.client||'Клиент не указан')}</b><span class="muted">${esc(Drafts.title(r))} · ${r.positions||0} поз. · ${esc(Fmt.dateTime(r.updated))}</span></div><button class="btn sm" type="button" data-dro="${esc(r.id)}">Продолжить</button></div>`).join(''):'<p class="empty">Незаконченных КП нет.</p>', Dr.length>nD?'<button class="lnk" type="button" data-mddr>Все</button>':'') : '';
    const quick=`<div class="md-q cab-more"><button class="btn" type="button" data-cq="journal">Журнал КП</button><button class="btn" type="button" data-cq="catalog">Каталог</button>${Drafts.meaningful(S)?`<button class="btn ghost" type="button" data-cq="back" title="Вернуться к открытому КП">Продолжить ${S.kpId?'КП № '+esc(S.number):'текущее КП'}</button>`:''}</div>`;
    const who=!CrmData.B.me && !CrmData.all() ? '<p class="msg warn">Выберите себя в разделе «Менеджер» — тогда здесь будут ваши сделки и дела.</p>' : '';
    return `${who}${kpi}<div class="md-g cab-g">${tasks}<div class="md-col">${bxs}${rem}${free}${drafts}</div></div>${quick}
      <label class="md-start"><input type="checkbox" id="mdStart"${MyDay.atStart()?' checked':''}> Показывать кабинет при запуске программы</label>`;
  }
}

/** «Клиенты»: клиенты из сделок — в работе, сумма, выиграно, ближайшее дело */
class CabClients {
  static list(){
    const by=new Map();
    for (const d of (CrmData.B.deals||[])){
      const key=d.clientInn||norm(d.client||d.title); if (!key) continue;
      const c=by.get(key)||{key, name:d.client||d.title, inn:d.clientInn||'', id:d.clientId||'', open:0, sum:0, won:0, wonSum:0, last:'', next:null, deals:[]};
      c.deals.push(d); if (d.updated>c.last) c.last=d.updated;
      if (d.stage==='won'){ c.won++; c.wonSum+=d.sum||0; } else if (d.stage!=='lost'){ c.open++; c.sum+=d.sum||0; }
      if (d.next && (!c.next || d.next.due<c.next.due)) c.next=d.next;
      by.set(key, c); }
    return [...by.values()].sort((a,b)=>(b.open-a.open) || (b.sum-a.sum) || String(b.last).localeCompare(String(a.last)));
  }
  static html(){
    const L=this.list().filter(c=>!Cabinet.q || norm(c.name+' '+c.inn).includes(norm(Cabinet.q)));
    const card=c=>`<article class="cab-cl"><div class="cab-cl-h">${ClientCard.on()?`<button type="button" class="lnk cab-cln" data-cc="${esc(JSON.stringify({id:c.id, inn:c.inn, name:c.name}))}" title="Карточка клиента">${esc(c.name)}</button>`:`<b>${esc(c.name)}</b>`}${c.inn?`<span class="muted">ИНН ${esc(c.inn)}</span>`:''}</div>
      <div class="cab-cl-n"><span><small>В работе</small><b>${c.open}</b>${c.open?`<em>${CrmFmt.short(c.sum)}</em>`:''}</span><span><small>Выиграно</small><b>${c.won}</b>${c.won?`<em>${CrmFmt.short(c.wonSum)}</em>`:''}</span><span><small>Последнее</small><b>${esc(CrmFmt.day(c.last))}</b></span></div>
      <div class="cab-cl-f">${c.next?`<span class="muted">${CrmData.icon(c.next.kind)} ${esc(c.next.title)} · ${esc(CrmFmt.rel(c.next.due))}</span>`:c.open?'<span class="warn-t">Нет следующего дела</span>':'<span class="muted">Сделок в работе нет</span>'}
        <button class="btn sm" type="button" data-cldeals="${esc(c.name)}">Сделки (${c.deals.length})</button></div></article>`;
    return `<div class="cab-bar">${Cabinet.search('Клиент или ИНН')}</div>
      ${L.length?`<div class="cab-cls">${L.map(card).join('')}</div>`:`<p class="empty">${Cabinet.q?'Не найдено.':'Клиенты появятся вместе со сделками: сохраните КП или нажмите «＋ Сделка».'}</p>`}`;
  }
}

/** «Отдел»: воронка по этапам и итоги по менеджерам (администратору и менеджерам с правом «КП других менеджеров») */
class CabTeam {
  static html(){
    if (!CrmData.all()) return `<p class="empty">Сводка отдела — по всем менеджерам. <button class="btn sm" type="button" data-tmgr="all">Показать весь отдел</button></p>`;
    const D=CrmData.B.deals||[], O=D.filter(d=>!CrmData.closed(d)), mon=today().slice(0,7), td=today();
    const st=CrmData.stages(true), max=Math.max(1, ...st.map(s=>O.filter(d=>d.stage===s.key).reduce((a,d)=>a+(d.sum||0),0)));
    const funnel=st.map(s=>{ const L=O.filter(d=>d.stage===s.key), sum=L.reduce((a,d)=>a+(d.sum||0),0);
      return `<div class="fn-r"><span class="fn-l">${esc(s.label)}</span><span class="fn-b"><i class="t-${CrmData.tone(s.key)}" style="width:${Math.max(sum?2:0, sum/max*100).toFixed(1)}%"></i></span><span class="fn-v"><b>${L.length}</b> · ${CrmFmt.short(sum)}</span></div>`; }).join('');
    const M=new Map(); for (const m of CrmData.B.managers||[]) M.set(m.id, {id:m.id, name:m.name, open:0, sum:0, won:0, wonSum:0, lost:0, over:0, free:0});
    for (const d of D){ const r=M.get(d.managerId)||M.set(d.managerId, {id:d.managerId, name:d.manager||'Без менеджера', open:0, sum:0, won:0, wonSum:0, lost:0, over:0, free:0}).get(d.managerId);
      const m=String(d.stageAt||'').slice(0,7)===mon;
      if (d.stage==='won'){ if (m){ r.won++; r.wonSum+=d.sum||0; } } else if (d.stage==='lost'){ if (m) r.lost++; } else { r.open++; r.sum+=d.sum||0; if (!d.next) r.free++; } }
    for (const t of CrmData.openTasks()){ const r=M.get(t.managerId); if (r && t.due<td) r.over++; }
    const rows=[...M.values()].filter(r=>r.open||r.won||r.lost||r.over).sort((a,b)=>b.sum-a.sum);
    return `<div class="cab-team"><section class="md-s"><div class="md-h"><p class="sub">Воронка отдела</p><span class="muted">${O.length} в работе · ${CrmFmt.short(O.reduce((a,d)=>a+(d.sum||0),0))}</span></div><div class="fn">${funnel}</div></section>
      <section class="md-s"><div class="md-h"><p class="sub">Менеджеры</p><span class="muted">итоги месяца — с 1-го числа</span></div>
      <div class="tbl-wrap"><table class="cab-tt"><thead><tr><th>Менеджер</th><th>В работе</th><th>Сумма</th><th>Выиграно</th><th>Проиграно</th><th>Дела просрочены</th><th>Без дела</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><button type="button" class="lnk" data-tmgr="${esc(r.id)}" title="Открыть кабинет менеджера">${esc(r.name)}</button></td><td>${r.open}</td><td>${CrmFmt.short(r.sum)}</td><td>${r.won}${r.won?` · ${CrmFmt.short(r.wonSum)}`:''}</td><td>${r.lost}</td><td class="${r.over?'bad-t':''}">${r.over}</td><td class="${r.free?'warn-t':''}">${r.free}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">Сделок пока нет.</td></tr>'}
      </tbody></table></div></section></div>`;
  }
}
