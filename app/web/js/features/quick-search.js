// Единый поиск (Ctrl+K, кнопка «Найти» в шапке, пункт меню телефона): одна строка — КП, клиенты, сделки и каталог сразу,
// стрелки и Enter. Пустая строка — «Недавнее»: последние КП и их клиенты (журнал), модели, недавно добавленные в КП (этот
// браузер). Решение владельца 18.10 (пункты 12 и 14).
'use strict';

class RecentModels {
  static KEY = 'kp.recentModels';
  static MAX = 6;
  static list(){ try{ const v=JSON.parse(localStorage.getItem(this.KEY)||'[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
  /** модель добавлена в КП — первой в списке (без повторов) */
  static add(x){ if (!x || !x.id) return;
    const L=[{id:x.id, name:x.name||''}, ...this.list().filter(m=>m.id!==x.id)].slice(0, this.MAX);
    try{ localStorage.setItem(this.KEY, JSON.stringify(L)); }catch(e){ /* приватный режим — без «недавних моделей» */ } }
}

class QuickSearch {
  static seq = 0;          // ответ на устаревший запрос (набирают дальше) не показывается
  static t = 0;
  static open(){
    const m=Modal.once('quick-search', ()=>this._open()); return m; }
  static _open(){
    const m=this.m=new Modal(`<div class="dlg-h"><h3>Найти</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <input type="search" id="qsQ" class="qs-q" placeholder="КП, клиент, ИНН, сделка, модель или артикул" autocomplete="off" aria-label="Что найти">
      <div class="qs-r" id="qsR" aria-live="polite"></div><p class="muted qs-k">↑ ↓ — выбрать, Enter — открыть, Esc — закрыть · Ctrl+K — этот поиск откуда угодно</p>`, 'qs-dlg');
    const q=m.$('#qsQ');
    q.addEventListener('input', ()=>{ clearTimeout(this.t); this.t=setTimeout(()=>this.run(q.value), 180); });
    q.addEventListener('keydown', e=>this.keys(e));
    m.d.addEventListener('keydown', e=>{ if (e.target!==q) this.keys(e); });
    m.d.addEventListener('click', e=>this.click(e));
    setTimeout(()=>q.focus(), 30);
    this.run('');
  }
  static sect(title, rows){ return rows.length ? `<p class="qs-h">${esc(title)}</p>${rows.join('')}` : ''; }
  static row(attrs, main, sub, extra=''){ return `<div class="qs-i"><button type="button" class="qs-b" ${attrs}><b>${main}</b>${sub?`<small>${sub}</small>`:''}</button>${extra}</div>`; }
  static async run(text){
    const my=++this.seq, q=String(text||'').trim(), box=this.m && this.m.$('#qsR'); if (!box) return;
    const kpRow=r=>this.row(`data-qkp="${esc(r.id)}"`, `КП № ${esc(r.number)} · ${esc(r.client||'без получателя')}`,
      `${esc(KPGen.ruDate(r.date))}${r.items&&r.items[0]?' · '+esc(r.items[0]):''}`,
      `<button type="button" class="btn sm ghost" data-qrep="${esc(r.id)}" title="Новое КП тому же клиенту: дата — сегодня, цены — как сейчас в каталоге">Повторить</button>`);
    const catRow=x=>this.row(`data-qcat="${esc(x.id)}"`, esc(x.name), x.price?`${money(x.price)} ${esc(curSh(x.priceCur||'RUB'))}`:'без цены',
      `<button type="button" class="btn sm ghost" data-qadd="${esc(x.id)}">В КП</button>`);
    if (!q){            // «Недавнее»
      let J=[]; try{ J=(await api('/api/history?limit=12&offset=0&q=')).items||[]; }catch(e){ /* нет связи — только модели */ }
      if (my!==this.seq) return;
      const seen=new Set(), cl=J.filter(r=>r.client && !seen.has(r.client) && seen.add(r.client)).slice(0, 5);
      const models=RecentModels.list().map(m=>CatFind.id(m.id)).filter(Boolean);
      box.innerHTML=this.sect('Последние КП', J.slice(0, 5).map(kpRow))
        + (ClientCard.on() ? this.sect('Недавние клиенты', cl.map(r=>this.row(`data-qcl="${esc(JSON.stringify({id:'', inn:r.clientInn||'', name:r.client}))}"`, esc(r.client), r.clientInn?'ИНН '+esc(r.clientInn):''))) : '')
        + this.sect('Недавно добавленные модели', models.map(catRow))
        || '<p class="empty">Начните вводить — найдутся КП, клиенты, сделки и оборудование.</p>';
      return;
    }
    const [kp, cl, dl]=await Promise.all([
      api('/api/history?limit=6&offset=0&q='+encodeURIComponent(q)).then(r=>r.items||[]).catch(()=>[]),
      ClientCard.on() ? clientsFind(q, 6) : Promise.resolve([]),
      MyDay.on() ? api('/api/crm/find?q='+encodeURIComponent(q)).then(r=>r.items||[]).catch(()=>[]) : Promise.resolve([])]);
    if (my!==this.seq) return;
    const cat=quickMatches(q).slice(0, 6);
    box.innerHTML=this.sect('КП', kp.map(kpRow))
      + this.sect('Клиенты', cl.map(c=>this.row(`data-qcl="${esc(JSON.stringify({id:c.id||'', inn:c.inn||'', name:c.name||''}))}"`, esc(c.name), c.inn?'ИНН '+esc(c.inn):'')))
      + this.sect('Сделки', dl.map(d=>this.row(`data-qdl="${esc(d.id)}"`, `${esc(d.title||d.client)}`, `№ ${esc(d.number)} · ${esc(d.client||'')}${d.sum?' · '+CrmFmt.rub(d.sum):''}`)))
      + this.sect('Каталог', cat.map(catRow)) + (cat.length ? `<div class="qs-i"><button type="button" class="qs-b qs-all" data-qall><b>Все модели по «${esc(q)}» — в каталоге</b></button></div>` : '')
      || '<p class="empty">Ничего не найдено.</p>';
  }
  static keys(e){
    if (e.key!=='ArrowDown' && e.key!=='ArrowUp' && e.key!=='Enter') return;
    const L=[...this.m.d.querySelectorAll('.qs-b')]; if (!L.length) return;
    const k=L.indexOf(document.activeElement);
    if (e.key==='Enter'){ if (k<0){ e.preventDefault(); L[0].click(); } return; }
    e.preventDefault(); const n=k<0 ? (e.key==='ArrowDown'?0:L.length-1) : Math.max(0, Math.min(L.length-1, k+(e.key==='ArrowDown'?1:-1)));
    L[n].focus();
  }
  static async click(e){
    const t=e.target, m=this.m, q=m.$('#qsQ').value.trim();
    if (t.closest('[data-x]')) return m.close();
    const b=t.closest('[data-qkp],[data-qrep],[data-qcl],[data-qdl],[data-qcat],[data-qadd],[data-qall]'); if (!b) return;
    m.close();
    if (b.dataset.qrep) return KpRepeat.run(b.dataset.qrep);
    if (b.dataset.qkp) return KpLoader.byId(b.dataset.qkp).catch(err=>toast('КП не открылось: '+err.message));
    if (b.dataset.qcl){ try{ return ClientCard.open(JSON.parse(b.dataset.qcl)); }catch(_){ return; } }
    if (b.dataset.qdl) return DealCard.open(b.dataset.qdl);
    if (b.dataset.qadd){ const x=CatFind.id(b.dataset.qadd); if (x){ goStep('equip'); return addFromCatalog(x); } return; }
    if (b.dataset.qcat){ const x=CatFind.id(b.dataset.qcat); return openCatalog({q:x ? x.name : q}); }
    if (b.hasAttribute('data-qall')) return openCatalog({q});
  }
}

// Ctrl+K (Cmd+K на Mac) — единый поиск откуда угодно
document.addEventListener('keydown', e=>{ if ((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==='k'||e.key==='K'||e.key==='л'||e.key==='Л')){ e.preventDefault(); QuickSearch.open(); } });
