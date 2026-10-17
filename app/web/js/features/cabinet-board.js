// Кабинет менеджера: «Сделки» — доска по этапам (перетаскивание мышью, на телефоне — этап в карточке сделки)
// и «График» — сроки сделок, поставка по расчёту сделки КП, дела на ленте времени.
'use strict';

/** доска сделок по этапам */
class CabDeals {
  static closed=false;            // показать «Выиграно» и «Проиграно» (за последние 4 месяца)
  static drag=matchMedia('(pointer:fine)').matches;
  static html(){
    const D=(CrmData.B.deals||[]).filter(d=>Cabinet.match(d)), st=CrmData.stages().filter(s=>this.closed||!s.closed);
    const open=D.filter(d=>!CrmData.closed(d));
    const cols=st.map(s=>{ const L=D.filter(d=>d.stage===s.key).sort((a,b)=>String(a.expected||'9').localeCompare(String(b.expected||'9'))), sum=L.reduce((a,d)=>a+(d.sum||0),0);
      return `<section class="kb-c" data-kbs="${esc(s.key)}" aria-label="${esc(s.label)}"><header class="kb-h"><span class="cab-dot t-${CrmData.tone(s.key)}" aria-hidden="true"></span><b>${esc(s.label)}</b><span class="muted">${L.length}${sum?' · '+CrmFmt.short(sum):''}</span></header>
        <div class="kb-l">${L.map(d=>this.card(d)).join('')||`<p class="kb-e">${this.drag?'Перетащите сюда сделку':'Пусто'}</p>`}</div></section>`; }).join('');
    return `<div class="cab-bar">${Cabinet.search('Сделка, клиент, ИНН или № КП')}<label class="cab-ck"><input type="checkbox" id="cabClosed"${this.closed?' checked':''}> Закрытые</label>
      <span class="muted cab-tot">В работе ${open.length} · ${CrmFmt.short(open.reduce((a,d)=>a+(d.sum||0),0))}</span></div>
      ${D.length||Cabinet.q?'':'<p class="msg">Сделки появляются сами, когда вы сохраняете КП, — или нажмите «＋ Сделка».</p>'}
      <div class="kb">${cols}</div>`;
  }
  static card(d){
    const late=d.expected && d.expected<today() && !CrmData.closed(d), n=d.next, nOver=n && n.due<today(), k=(d.kps||[]).length;
    return `<article class="dc t-${CrmData.tone(d.stage)}" data-deal="${esc(d.id)}"${this.drag&&!CrmData.closed(d)?' draggable="true"':''} tabindex="0">
      <b class="dc-t">${esc(d.title||d.client||'Сделка № '+d.number)}</b>${d.client&&d.client!==d.title?`<span class="dc-c">${esc(d.client)}</span>`:''}
      <div class="dc-r"><b>${CrmFmt.short(d.sum)}</b>${d.expected?`<span class="${late?'bad-t':'muted'}" title="Ожидаемая дата">${late?'срок прошёл · ':'до '}${esc(CrmFmt.day(d.expected))}</span>`:''}</div>
      ${CrmData.closed(d)?(d.stage==='lost'&&d.lostReason?`<span class="dc-n muted">${esc(d.lostReason)}</span>`:''):n?`<span class="dc-n${nOver?' bad-t':''}">${CrmData.icon(n.kind)} ${esc(n.title)} · ${esc(CrmFmt.rel(n.due))}</span>`:'<span class="dc-n warn-t">Нет следующего дела</span>'}
      <span class="dc-f muted">${d.bxNew?'<b class="dc-new">Новая из Битрикс24</b> · ':''}${k?`КП ${k}`:'без КП'}${CrmData.all()?' · '+esc(CrmData.mgrShort(d)):''}${d.bxUrl?`<a class="dc-bx" href="${esc(d.bxUrl)}" target="_blank" rel="noopener" title="Открыть в Битрикс24">Б24 ↗</a>`:''}</span></article>`;
  }
  static bind(b){
    if (!this.drag || !b) return;
    b.addEventListener('dragstart', e=>{ const c=e.target.closest('.dc'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.deal); e.dataTransfer.effectAllowed='move'; c.classList.add('drag'); });
    b.addEventListener('dragend', e=>{ e.target.closest?.('.dc')?.classList.remove('drag'); b.querySelectorAll('.kb-c.over').forEach(x=>x.classList.remove('over')); });
    b.addEventListener('dragover', e=>{ const c=e.target.closest('.kb-c'); if (!c) return; e.preventDefault(); b.querySelectorAll('.kb-c.over').forEach(x=>{ if (x!==c) x.classList.remove('over'); }); c.classList.add('over'); });
    b.addEventListener('drop', e=>{ const c=e.target.closest('.kb-c'); if (!c) return; e.preventDefault(); c.classList.remove('over');
      const id=e.dataTransfer.getData('text/plain'), d=CrmData.deal(id); if (d && d.stage!==c.dataset.kbs) this.move(d, c.dataset.kbs); });
  }
  /** сменить этап сделки; «Проиграно» — с причиной */
  static async move(d, stage){
    const body={stage};
    if (stage==='lost'){ const r=await DealCard.lostReason(d); if (!r) return; body.lostReason=r; }
    try{ await api('/api/crm/deal/'+d.id, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8', 'X-KP-Rev':String(d.rev)}, body:JSON.stringify(body)});
      toast(`«${d.title||d.client}» → ${CrmData.stage(stage).label}`); }
    catch(e){ toast('Этап не изменён: '+e.message); }
    Cabinet.reload();
  }
}

/** лента времени: сделка (создана → ожидаемая дата), срок действия КП, поставка и оплаты по расчёту сделки, дела */
class CabGantt {
  static KEY='kp.cab.gantt';
  static SCALES={month:['Месяц', 26], quarter:['Квартал', 9], half:['Полгода', 4.5]};
  static o=null;
  static opt(){ if (!this.o){ let s={}; try{ s=JSON.parse(localStorage.getItem(this.KEY)||'{}'); }catch(e){}
    this.o={scale:this.SCALES[s.scale]?s.scale:'month', deal:s.deal!==false, sup:s.sup!==false, task:s.task!==false}; } return this.o; }
  static set(k, v){ this.opt()[k]=v; try{ localStorage.setItem(this.KEY, JSON.stringify(this.o)); }catch(e){} }
  /** поставка по последнему КП сделки с расчётом сроков: от договора (дата в расчёте или ожидаемая дата сделки) */
  static plan(d){
    const k=(d.kps||[]).find(x=>x.plan && x.status!=='lost'); if (!k) return null;
    const p=k.plan, s0=p.start || d.expected; if (!s0) return null;
    const b=CrmFmt.dn(s0), at=n=>Number.isFinite(n)?b+n:null;
    return {kp:k, start:b, ready:at(p.ready), delivery:at(p.delivery), end:at(p.end), pays:(p.pays||[]).map(x=>({d:b+x.d, p:x.p, t:x.t})), guess:!p.start};
  }
  static html(){
    const o=this.opt(), px=this.SCALES[o.scale][1], t0=CrmFmt.dn(today());
    const D=CrmData.openDeals().filter(d=>Cabinet.match(d)).sort((a,b)=>String(a.expected||'9').localeCompare(String(b.expected||'9')));
    const T=CrmData.openTasks(), free=T.filter(t=>!t.deal || !D.some(d=>d.id===t.deal));
    const rows=D.map(d=>({d, a:CrmFmt.dn(String(d.created||today()).slice(0,10)), b:CrmFmt.dn(d.expected||KpDate.addDays(String(d.created||today()).slice(0,10), 30)),
      p:o.sup?this.plan(d):null, kp:(d.kps||[]).find(k=>k.status!=='lost' && k.validUntil), t:T.filter(x=>x.deal===d.id)}));
    // границы ленты: от двух недель назад (или начала видимых полос, но не раньше 4 месяцев) до самой поздней отметки
    let lo=t0-14, hi=t0+(o.scale==='month'?45:o.scale==='quarter'?100:190);
    for (const r of rows){ if (o.deal) lo=Math.min(lo, Math.max(r.a, t0-120)); hi=Math.max(hi, r.b+7);
      if (r.p) hi=Math.max(hi, (r.p.end||r.p.delivery||r.p.start)+7); for (const x of r.t) hi=Math.max(hi, CrmFmt.dn(x.due)+3); }
    hi=Math.min(hi, t0+500);
    const W=Math.round((hi-lo+1)*px), x=n=>Math.round((n-lo)*px), cl=n=>Math.min(Math.max(n, lo), hi);
    // шапка: месяцы и (крупно) недели
    let mh='', wk='';
    for (let n=lo; n<=hi; n++){ const dt=new Date(n*864e5), dd=dt.getUTCDate(), wd=dt.getUTCDay();
      if (dd===1 || n===lo){ const nx=Math.min(hi+1, n+(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, 1))/864e5-n));
        mh+=`<span class="gn-m" style="left:${x(n)}px;width:${Math.round((nx-n)*px)}px"><span>${dt.toLocaleDateString('ru-RU', {month:px<6?'short':'long', timeZone:'UTC'})}${dt.getUTCMonth()===0||n===lo?' '+dt.getUTCFullYear():''}</span></span>`; }
      if (px>=8 ? wd===1 : (wd===1 && dd<=7)) wk+=`<span class="gn-w" style="left:${x(n)}px">${px>=8?dd:''}</span>`;
      if (px>=20 && (wd===0||wd===6)) wk+=`<i class="gn-we" style="left:${x(n)}px;width:${Math.round(px)}px"></i>`; }
    // полосы и отметки — подписи с подсказкой; нажатие по строке открывает сделку (на телефоне цель — вся строка)
    const bar=(a, b, cls, label, title)=>{ if (b<lo || a>hi) return ''; const A=cl(a), B=cl(b); return `<span class="gn-b ${cls}" style="left:${x(A)}px;width:${Math.max(6, x(B+1)-x(A))}px" title="${esc(title)}">${label?`<span>${esc(label)}</span>`:''}</span>`; };
    const mark=(n, cls, sym, title)=>n<lo||n>hi?'':`<span class="gn-k ${cls}" style="left:${x(n)+Math.round(px/2)}px" title="${esc(title)}">${sym}</span>`;
    const task=t=>mark(CrmFmt.dn(t.due), 'gn-t'+(t.due<today()?' over':''), CrmData.KINDS[t.kind]||'•', `${CrmData.kind(t.kind)}: ${t.title} · ${CrmFmt.day(t.due)}${t.time?' '+t.time:''}`);
    const line=r=>{ const d=r.d, nm=d.title||d.client, late=d.expected && d.expected<today();
      let tr='';
      if (o.deal){ tr+=bar(r.a, r.b, 'gb-d t-'+CrmData.tone(d.stage)+(late?' late':''), `${CrmData.stage(d.stage).label} · ${CrmFmt.short(d.sum)}`, `${nm}: ${CrmData.stage(d.stage).label}, ${CrmFmt.rub(d.sum)} · с ${CrmFmt.day(String(d.created).slice(0,10))} до ${CrmFmt.day(d.expected)}${late?' — ожидаемая дата прошла':''}`);
        if (r.kp) tr+=mark(CrmFmt.dn(r.kp.validUntil), 'gn-v', '◇', `КП № ${r.kp.number} действует до ${KpDate.ddmm(r.kp.validUntil)}`); }
      if (r.p){ const p=r.p, e=p.delivery??p.ready??p.start;
        tr+=bar(p.start, e, 'gb-s'+(p.guess?' guess':''), '', `${nm}: договор ${CrmFmt.day(CrmFmt.iso(p.start))}${p.guess?' (ожидаемая дата — в расчёте сделки дата договора не задана)':''}, готовность ${p.ready!=null?CrmFmt.day(CrmFmt.iso(p.ready)):'—'}, поставка ${CrmFmt.day(CrmFmt.iso(e))} · по КП № ${p.kp.number}`);
        if (e+1<=hi && e>=lo) tr+=`<span class="gn-x" style="left:${x(e+1)+14}px">поставка ${esc(CrmFmt.day(CrmFmt.iso(e)))}</span>`;
        if (p.ready!=null && p.ready!==e) tr+=mark(p.ready, 'gn-r', '◆', `Готовность к отгрузке: ${CrmFmt.day(CrmFmt.iso(p.ready))}`);
        for (const y of p.pays) tr+=mark(y.d, 'gn-p', '₽', `${y.t} · ${CrmFmt.day(CrmFmt.iso(y.d))}`); }
      if (o.task) tr+=r.t.map(task).join('');
      return `<div class="gn-r${r.p?' two':''}"><button type="button" class="gn-l" data-deal="${esc(d.id)}" title="${esc(nm)}"><b>${esc(nm)}</b><span class="muted">${esc(d.client&&d.client!==nm?d.client:CrmData.stage(d.stage).label)}${CrmData.all()?' · '+esc(CrmData.mgrShort(d)):''}</span></button><div class="gn-tr" data-deal="${esc(d.id)}" style="width:${W}px">${tr}</div></div>`; };
    const freeRow=o.task&&free.length?`<div class="gn-r"><div class="gn-l"><b>Дела без сделки</b><span class="muted">${free.length}</span></div><div class="gn-tr" style="width:${W}px">${free.map(task).join('')}</div></div>`:'';
    const ctl=`<div class="cab-bar">${Cabinet.search('Сделка или клиент')}<div class="seg" role="radiogroup" aria-label="Масштаб">${Object.entries(this.SCALES).map(([k,[l]])=>`<button type="button" role="radio" aria-checked="${o.scale===k}" class="${o.scale===k?'on':''}" data-gsc="${k}">${l}</button>`).join('')}</div>
      <label class="cab-ck"><input type="checkbox" data-gsh="deal"${o.deal?' checked':''}> Сроки сделок</label><label class="cab-ck"><input type="checkbox" data-gsh="sup"${o.sup?' checked':''}> Поставка</label><label class="cab-ck"><input type="checkbox" data-gsh="task"${o.task?' checked':''}> Дела</label></div>
      <details class="gn-lg muted"${isMob()?'':' open'}><summary>Обозначения</summary><div class="gn-lgi"><span><i class="gb-d t-s2"></i> сделка: создана → ожидаемая дата</span><span><i class="gb-s"></i> поставка по расчёту сделки</span><span>◇ КП действует до</span><span>◆ готовность</span><span>₽ оплата заказчика</span><span>☎ 👥 ✉ ✓ дела</span></div></details>`;
    if (!rows.length && !freeRow) return ctl+`<p class="empty">${Cabinet.q?'Не найдено.':'Сделок в работе нет.'}</p>`;
    return ctl+`<div class="gn" id="gn"><div class="gn-in" style="--gw:${W}px"><div class="gn-r gn-hd"><div class="gn-l"><b>Сделка</b></div><div class="gn-tr" style="width:${W}px">${mh}${wk}</div></div>
      <div class="gn-rows">${rows.map(line).join('')}${freeRow}<div class="gn-now" style="left:calc(var(--gl) + ${x(t0)+Math.round(px/2)}px)" aria-hidden="true"></div></div></div></div>`;
  }
  /** после вывода: лента прокручена к сегодняшнему дню */
  static after(b){ const g=b && b.querySelector('#gn'), n=g && g.querySelector('.gn-now'); if (!g || !n) return;
    const L=g.querySelector('.gn-l')?.offsetWidth||0; g.scrollLeft=Math.max(0, n.offsetLeft-L-Math.round((g.clientWidth-L)*0.2)); }
}
