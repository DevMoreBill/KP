// Черновики КП на сервере и заготовки КП («как в прошлый раз»). Сервер — DraftsController (app/web_api.py), таблица drafts.
// • Черновик — незаконченное КП или несохранённые правки сохранённого КП; у каждого менеджера свои, видны с любого компьютера.
//   Автосохранение (Drafts.tick) раз в минуту и при уходе со страницы записывает изменения в черновик; «Новое КП»
//   и открытие другого КП откладывают текущее в черновики. После сохранения КП в журнал его черновик удаляется.
// • Заготовка — КП без клиента (позиции, условия, цены), общая для всех: новое КП из заготовки за один щелчок.
'use strict';

// значения черновиков для «Настройки → Значения программы» (раздел «КП и документы»)
DefRegistry.add([['draft', 'Черновики и автосохранение', 'kp', 'Незаконченные КП и несохранённые правки хранятся на сервере в «Черновиках» у каждого менеджера — с любого компьютера их можно продолжить.']], [
  ['kp.autosaveMin', 'draft', 'Автосохранение черновика — раз в', 'num', '1', {unit:'мин', req:true, min:0.5, max:60,
    hint:'Как часто программа сама записывает изменения открытого КП в «Черновики» на сервере (если в «Функциях» включено автосохранение). Ещё черновик пишется, когда менеджер уходит со страницы или сворачивает браузер. Меньше — меньше потерь при сбое компьютера, но чаще запросы к серверу. Пример: 1 — раз в минуту, 5 — раз в пять минут.'}],
  ['kp.newKpDrafts', 'draft', 'Черновиков в окне «Новое КП»', 'num', '5', {unit:'шт.', req:true, min:0, max:50,
    hint:'Сколько последних черновиков показывать в окне «Новое КП» в блоке «Продолжить черновик». Остальные — по кнопке «Все черновики». 0 — блок не показывать.'}],
]);

class Drafts {
  /** интервал автосохранения, мс — из «Значений программы» (читается при каждом запуске таймера) */
  static autoMs(){ return Math.round(DEFN('kp.autosaveMin', 1)*60000); }
  /** «раз в минуту» / «раз в 5 мин» — для пояснений */
  static autoText(){ const n=DEFN('kp.autosaveMin', 1); return n===1 ? 'раз в минуту' : `раз в ${String(n).replace('.', ',')} мин`; }
  static kp = null;        // КП, для которого запомнено состояние base (номер или '' — новое КП)
  static base = null;      // отпечаток состояния КП на момент последнего сохранения (в журнал или в черновик)
  static busy = false;
  static running = null;   // идущее сохранение (Promise) — stash ждёт его

  static on(){ return FEAT.on('drafts'); }
  static newId(p='d'){ return p+Date.now().toString(36)+Math.random().toString(36).slice(2, 8); }
  /** состояние КП без служебных полей (как в журнал) */
  static clean(){ return JSON.parse(JSON.stringify(S, (k, v)=>k.startsWith('_') ? undefined : v)); }
  static sig(st){ const s=JSON.stringify(st); let h=0x811c9dc5; for (let i=0; i<s.length; i++){ h^=s.charCodeAt(i); h=Math.imul(h, 16777619); } return s.length+':'+(h>>>0); }
  /** есть что сохранять: позиции или клиент */
  static meaningful(st){ return (st.items||[]).length>0 || String(st.client||'').trim()!==''; }
  static title(r){ return r.kp ? `Правки КП № ${r.kp}` : 'Новое КП'; }

  /** изменения с последнего сохранения: {st, sg} или null */
  static pending(){
    if (CATED) return null;
    const st=this.clean(), sg=this.sig(st), kp=S.kpId||'';
    if (this.kp!==kp){ this.kp=kp; this.base = kp && !S._draft ? sg : null; if (this.base) return null; }   // открыли другое КП — отсчёт с него
    if (sg===this.base || !this.meaningful(st)) return null;
    return {st, sg};
  }
  /** записать изменения в черновик; quiet — без сообщений */
  static async save(quiet=true){
    if (!this.on() || this.busy) return false;
    const p=this.pending(); if (!p) return false;
    this.busy=true; let id=S._draft || this.newId(); const t=totalsS(), mine=S;     // КП, которое сохраняем
    let done;
    this.running=new Promise(r=>{ done=r; });
    try{
      const put=()=>api('/api/drafts/'+id, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'},
        body:JSON.stringify({state:p.st, rev:S._rev, sum:t.sum, cur:(S.pricing&&S.pricing.cur)||'RUB'})});
      // черновик записан под другим менеджером (сменили «кто работает» на устройстве) — дальше новый черновик под текущим
      try{ await put(); }catch(e){ if (e.status!==403 || !S._draft) throw e; id=this.newId(); await put(); }
      mine._draft=id;
      if (S!==mine) return true;          // пока шёл ответ, открыли другое КП — его черновиком этот id не становится
      this.base=p.sg; persist();
      const el=$('#saved'); if (el) setTimeout(()=>{ el.textContent='Сохранено на сервере в '+new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}); }, 500);
      return true;
    }catch(e){ if (!quiet) toast('Черновик не сохранён: '+(e.message||e)); return false; }
    finally{ this.busy=false; done(); }
  }
  /** перед заменой КП (новое, другое из журнала, черновик, заготовка): текущие изменения — в черновики.
   *  → true — можно заменять; false — не отложилось (нет связи, черновики выключены) и менеджер выбрал «Отмена» */
  static async stash(){
    if (this.busy) await this.running;      // идёт автосохранение — дождаться, иначе изменения не отложатся
    if (!this.pending()) return true;        // несохранённого нет
    if (!this.on()) return confirm('Несохранённые изменения текущего КП пропадут. Продолжить?');
    if (await this.save(false)){ toast('Прежнее КП отложено в черновики (журнал → «Черновики»)'); return true; }
    return confirm('Текущее КП не удалось отложить в черновики (нет связи с сервером?). Заменить его — несохранённые изменения пропадут?');
  }
  /** КП сохранено в журнал: его черновик больше не нужен. sig — отпечаток сохранённого состояния (правки, сделанные
   *  во время сохранения, остаются «несохранёнными»). Идущее автосохранение дожидается — иначе оно воскресило бы черновик */
  static async saved(sig){
    if (this.busy) await this.running;
    const id=S._draft; delete S._draft; this.loaded();
    if (sig) this.base=sig;
    if (id) api(`/api/drafts/${id}/delete`, {method:'POST'}).catch(()=>{});
  }
  /** КП заменено копией или заготовкой: пока его не правили, откладывать нечего */
  static loaded(){ this.kp=S.kpId||''; this.base=this.sig(this.clean()); }
  static paused = false;      // идёт сохранение КП в журнал
  static tick(){ if (FEAT.on('autosave') && !this.paused) this.save(true); }
  static start(){
    this.pending();                       // отсчёт — с КП, открытого при запуске
    const next=()=>setTimeout(()=>{ this.tick(); next(); }, this.autoMs()); next();
    document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='hidden') this.tick(); });
  }
  static async list(){ try{ return (await api('/api/drafts')).items||[]; }catch(e){ return []; } }

  /** продолжить черновик */
  static async open(id){
    if (S._draft!==id && !await this.stash()) return;
    let r; try{ r=await api('/api/drafts/'+encodeURIComponent(id)); }catch(e){ return toast('Черновик не открылся: '+(e.message||e)); }
    S=Object.assign(freshState(), r.data.state||{}); if (r.data.rev!=null) S._rev=r.data.rev; S._draft=id;
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    renderForm(); persist(); window.scrollTo({top:0}); this.loaded();
    toast(r.row.kp ? `Открыты несохранённые правки КП № ${r.row.kp} — сохраните КП, чтобы они попали в журнал` : 'Черновик открыт');
  }
  static async remove(id){ try{ await api(`/api/drafts/${encodeURIComponent(id)}/delete`, {method:'POST'}); if (S._draft===id) delete S._draft; return true; }
    catch(e){ toast('Не удалено: '+(e.message||e)); return false; } }

  static rowHtml(r){
    return `<div class="st-row"><div><b>${esc(r.client||'Клиент не указан')}</b><span class="muted">${esc(this.title(r))} · ${r.positions||0} поз.${r.sum?` · ${money(r.sum)} ${esc(curSh(r.cur||'RUB'))}`:''} · ${esc(Fmt.dateTime(r.updated))}${S._draft===r.id?' · <b>открыт сейчас</b>':''}</span></div>
      <div class="acts"><button class="btn" type="button" data-dro="${esc(r.id)}">Продолжить</button><button class="btn ghost" type="button" data-drd="${esc(r.id)}" title="Удалить черновик">Удалить</button></div></div>`;
  }
  /** окно «Черновики» */
  static async dialog(){
    const m=new Modal(`<div class="dlg-h"><h3>Черновики</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Незаконченные КП и несохранённые правки — ваши, доступны с любого компьютера.${FEAT.on('autosave')?` Изменения записываются сюда автоматически ${this.autoText()}.`:''} После сохранения КП в журнал черновик удаляется.</p>
      <div class="dr-l"><p class="empty">Загружаю…</p></div>`, 'drafts-dlg');
    const draw=async()=>{ const L=await this.list(); m.$('.dr-l').innerHTML = L.length ? L.map(r=>this.rowHtml(r)).join('') : '<p class="empty">Черновиков нет.</p>'; };
    m.d.onclick=async e=>{ if (e.target.closest('[data-x]')) return m.close();
      const o=e.target.closest('[data-dro]'); if (o){ m.close(); return this.open(o.dataset.dro); }
      const dl=e.target.closest('[data-drd]'); if (dl && await this.remove(dl.dataset.drd)) draw(); };
    await draw();
  }
}

class Presets {
  // поля КП конкретного клиента — в заготовку не попадают
  static DROP = ['kpId','number','createdAt','authorId','managerId','manager','date','client','clientId','clientInn','clientKpp','clientOgrn','clientFull','clientAddr',
    'clientDir','clientDirPost','clientStatus','contact','object','check','tender','deal'];
  static on(){ return FEAT.on('presets'); }
  static async list(){ try{ const r=await api('/api/presets'); this.me=r.me; return r.items||[]; }catch(e){ return []; } }

  /** сохранить текущее КП как заготовку */
  static ask(){
    if (!S.items.length) return toast('Добавьте в КП позиции — заготовка хранит позиции, цены и условия');
    const m=new Modal(`<div class="dlg-h"><h3>Сохранить как заготовку</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">В заготовку войдут позиции, цены, валюта и условия — без клиента, контакта, объекта и экономики сделки. Заготовки видны всем менеджерам.</p>
      <label class="f"><span>Название</span><input type="text" id="prN" maxlength="120" placeholder="Например: Винтовой 37 кВт + осушитель + ресивер" value="${esc(S.items.slice(0,2).map(x=>x.name).filter(Boolean).join(' + ').slice(0,120))}"></label>
      <div class="dlg-acts"><button class="btn ghost" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-ok>Сохранить</button></div>`);
    const go=async()=>{ const title=m.$('#prN').value.trim(); if (!title) return m.$('#prN').focus();
      const st=Drafts.clean(); for (const k of this.DROP) delete st[k];
      try{ await api('/api/presets/'+Drafts.newId('p'), {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'},
        body:JSON.stringify({state:st, title, sum:totalsS().sum, cur:(S.pricing&&S.pricing.cur)||'RUB'})});
        m.close(); toast(`Заготовка «${title}» сохранена — «Новое КП» → по заготовке`); }
      catch(e){ toast('Не сохранено: '+(e.message||e)); } };
    m.d.onclick=e=>{ if (e.target.closest('[data-x]')) m.close(); else if (e.target.closest('[data-ok]')) go(); };
    m.$('#prN').onkeydown=e=>{ if (e.key==='Enter'){ e.preventDefault(); go(); } };
    m.$('#prN').select();
  }
  /** новое КП из заготовки: менеджер и его контакты — текущие */
  static async use(id){
    if (!await Drafts.stash()) return;
    let r; try{ r=await api('/api/presets/'+encodeURIComponent(id)); }catch(e){ return toast('Заготовка не открылась: '+(e.message||e)); }
    const keep={manager:S.manager, managerId:S.managerId};
    S=Object.assign(freshState(), r.data.state||{}, keep); S.authorId=meId()||S.managerId||''; S.date=today();
    S.items.forEach(x=>{ x.id=uid(); });
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    renderForm(); persist(); Drafts.loaded(); window.scrollTo({top:0}); goStep('client');
    toast(`Новое КП по заготовке «${r.row.title}» — укажите клиента`);
  }
  static async remove(id){ try{ await api(`/api/presets/${encodeURIComponent(id)}/delete`, {method:'POST'}); toast('Заготовка удалена'); return true; }
    catch(e){ toast('Не удалено: '+(e.message||e)); return false; } }
  static rowHtml(r){
    const mine=r.owner===this.me || ADMIN.on;
    return `<div class="st-row"><div><b>${esc(r.title)}</b><span class="muted">${r.positions||0} поз.${r.sum?` · ${money(r.sum)} ${esc(curSh(r.cur||'RUB'))}`:''}${r.owner_name?' · '+esc(jShort(r.owner_name)):''} · ${esc(Fmt.dateTime(r.updated))}</span></div>
      <div class="acts"><button class="btn primary" type="button" data-pru="${esc(r.id)}">Создать КП</button>${mine?`<button class="btn ghost" type="button" data-prd="${esc(r.id)}" data-prt="${esc(r.title)}">Удалить</button>`:''}</div></div>`;
  }
}

// «Новое КП»: пустое, из заготовки или продолжить черновик; текущее — в черновики
class NewKp {
  static open(){ return Modal.once('newkp', ()=>this._open()); }
  static async _open(){
    const mean=Drafts.meaningful(S), useD=Drafts.on(), useP=Presets.on();
    if (!useD && !useP){
      if (!confirm(S.kpId?'Начать новое КП? Сохранённое КП № '+S.number+' останется в журнале.':'Начать новое КП? Текущий черновик будет очищен (контакты менеджера сохранятся).')) return;
      return NewKp.blank();
    }
    const [P, D]=await Promise.all([useP?Presets.list():[], useD?Drafts.list():[]]);
    const nD=Math.round(DEFN('kp.newKpDrafts', 5));
    const note = !mean ? '' : S.kpId ? `Сохранённое КП № ${esc(S.number)} останется в журнале${useD?', несохранённые правки — в черновиках':''}.` : useD ? 'Текущее КП будет отложено в черновики.' : 'Текущее КП будет очищено.';
    const m=new Modal(`<div class="dlg-h"><h3>Новое КП</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      ${note?`<p class="muted" style="margin:0 0 10px">${note}</p>`:''}
      <div class="row nk-top"><button class="btn primary" type="button" data-nk>Пустое КП</button>${useP&&S.items.length?'<button class="btn" type="button" data-nps title="Позиции, цены и условия текущего КП — для следующих КП">Сохранить текущее как заготовку</button>':''}</div>
      ${useP?`<p class="sub" style="margin:4px 0 6px">По заготовке</p>${P.length>6?'<input type="search" class="f" id="nkQ" placeholder="Найти заготовку" style="margin-bottom:6px">':''}<div class="nk-l" id="nkP">${P.length?P.map(r=>Presets.rowHtml(r)).join(''):'<p class="empty">Заготовок пока нет. Соберите КП и нажмите «Сохранить текущее как заготовку».</p>'}</div>`:''}
      ${useD&&D.length&&nD?`<p class="sub" style="margin:14px 0 6px">Продолжить черновик</p><div class="nk-l">${D.slice(0,nD).map(r=>Drafts.rowHtml(r)).join('')}</div>${D.length>nD?`<button class="btn ghost" type="button" data-nall>Все черновики (${D.length})</button>`:''}`:''}`, 'newkp-dlg');
    const q=m.$('#nkQ'); if (q) q.oninput=()=>{ const s=q.value.trim().toLowerCase(); m.$('#nkP').innerHTML=P.filter(r=>!s||r.title.toLowerCase().includes(s)).map(r=>Presets.rowHtml(r)).join('')||'<p class="empty">Не найдено.</p>'; };
    m.d.onclick=async e=>{ const t=e.target;
      if (t.closest('[data-x]')) return m.close();
      if (t.closest('[data-nk]')){ m.close(); if (!await Drafts.stash()) return; return NewKp.blank(); }
      if (t.closest('[data-nps]')){ m.close(); return Presets.ask(); }
      if (t.closest('[data-nall]')){ m.close(); return Drafts.dialog(); }
      const u=t.closest('[data-pru]'); if (u){ m.close(); return Presets.use(u.dataset.pru); }
      const pd=t.closest('[data-prd]'); if (pd){ if (!confirm(`Удалить заготовку «${pd.dataset.prt}»?`)) return;
        if (await Presets.remove(pd.dataset.prd)) pd.closest('.st-row').remove(); return; }
      const o=t.closest('[data-dro]'); if (o){ m.close(); return Drafts.open(o.dataset.dro); }
      const dl=t.closest('[data-drd]'); if (dl && await Drafts.remove(dl.dataset.drd)) dl.closest('.st-row').remove(); };
  }
  /** чистое КП с моими контактами (без вывода) — для КП по сделке, клиенту */
  static fresh(){ S=freshState(); NewKp.myContacts(); }
  static blank(){ this.fresh(); renderForm(); persist(); window.scrollTo({top:0}); if (catCache.length) openCatalog({}); }
  /** контакты менеджера в новом КП: запомненные этим браузером, иначе — из карточки «кто я» (новый компьютер) */
  static myContacts(){ if (String(S.manager.name||'').trim()) return; const m=MGRS.find(x=>x.id===meId()); if (m){ S.managerId=m.id; S.manager={...S.manager, ...mgrFields(m)}; } }
}
