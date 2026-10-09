// «Настройки → Списки и выборы» и «Настройки → Тексты интерфейса» — панели админки.
// ListsPanel: слева — все списки по группам (метка «свой» — изменён администратором), справа — таблица строк выбранного:
//   добавить, поменять порядок ↑ ↓, удалить, «Вернуть встроенный». Реестр списков — js/core/lists.js (LISTS).
// TextsPanel: все заменённые тексты интерфейса одним списком с поиском: правка, «Вернуть исходный», режим правки на экране.
'use strict';

class ListsPanel {
  constructor(m){ this.m=m; this.key=ListsPanel.last || [...LISTS.defs.keys()][0]; this.rows=null; this.dirty=false; }
  def(){ return LISTS.get(this.key); }
  start(){ this.rows=JSON.parse(JSON.stringify(LISTS.rows(this.key))); this.dirty=false; }
  async open(){ const r=await aapi('lists'); LISTS.use(r.values||{}); LISTS.cache(); this.start(); this.render(); this.bind(); }

  navHtml(){ return LISTS.groups.map(g=>{ const ds=LISTS.inGroup(g.id); return ds.length ? `<p class="ls-g">${esc(g.title)}</p>`
      + ds.map(d=>`<button type="button" class="ls-it${d.key===this.key?' on':''}" data-lsk="${esc(d.key)}"><span>${esc(d.label)}</span>${LISTS.isOwn(d.key)?'<i>свой</i>':''}</button>`).join('') : ''; }).join(''); }
  cellHtml(r, i, [f, label, type, o={}]){ const v=r[f]==null?'':String(r[f]);
    return type==='area' ? `<textarea rows="2" data-lsf="${f}" data-i="${i}" aria-label="${esc(label)}" placeholder="${esc(o.ph||'')}">${esc(v)}</textarea>`
      : `<input type="text" data-lsf="${f}" data-i="${i}" value="${esc(v)}" aria-label="${esc(label)}" placeholder="${esc(o.ph||'')}"${type==='num'?' inputmode="decimal"':''}>`; }
  tableHtml(){ const d=this.def(), wide=d.cols.length>1;
    return `<div class="ls-t${wide?' wide':''}" style="--ls-cols:${d.cols.map(c=>c[2]==='area'?'minmax(220px,2fr)':'minmax(110px,1fr)').join(' ')}">
      <div class="ls-h"><span>№</span>${d.cols.map(([, l, , o={}])=>`<span>${esc(l)}${o.req?' *':''}</span>`).join('')}<span></span></div>
      ${this.rows.map((r,i)=>`<div class="ls-r"><span class="ls-n">${i+1}</span>${d.cols.map(c=>this.cellHtml(r,i,c)).join('')}
        <span class="ls-a"><button type="button" class="icon" data-lsm="-1" data-i="${i}" title="Выше" aria-label="Выше"${i?'':' disabled'}>↑</button><button type="button" class="icon" data-lsm="1" data-i="${i}" title="Ниже" aria-label="Ниже"${i<this.rows.length-1?'':' disabled'}>↓</button><button type="button" class="icon" data-lsdel data-i="${i}" title="Удалить строку" aria-label="Удалить строку">✕</button></span></div>`).join('')}
    </div>`; }
  render(){ const d=this.def(), own=LISTS.isOwn(this.key);
    this.m.innerHTML=`<div class="st-card"><p class="sub" style="margin:0">Списки и выборы</p><p class="muted" style="margin:6px 0 0">Варианты выпадающих меню и подсказок во всей программе.
        Изменения видят все пользователи; уже созданные КП не меняются. «Вернуть встроенный» — список, как в программе.</p></div>
      <div class="ls"><nav class="ls-nav" aria-label="Списки">${this.navHtml()}</nav>
        <section class="ls-ed"><div class="ls-hd"><h4>${esc(d.label)}${own?' <i class="ls-own">свой</i>':''}</h4>${d.hint?`<p class="muted">${esc(d.hint)}</p>`:''}
          ${(LISTS.groups.find(g=>g.id===d.group)||{}).hint?`<p class="muted ls-gh">${esc(LISTS.groups.find(g=>g.id===d.group).hint)}</p>`:''}</div>
          ${this.tableHtml()}
          <button type="button" class="btn ls-add" data-lsadd>+ Добавить строку</button>
          <div class="df-bar ls-bar"><span class="muted" id="lsSt">${this.dirty?'Есть несохранённые изменения':own?'Действует ваш список':'Действует встроенный список'}</span>
            <button type="button" class="btn ghost" data-lsreset${own?'':' disabled'}>Вернуть встроенный</button>
            <button type="button" class="btn" data-lsundo${this.dirty?'':' disabled'}>Отменить</button>
            <button type="button" class="btn primary" data-lssave${this.dirty?'':' disabled'}>Сохранить</button></div></section></div>`; }
  touch(){ this.dirty=true; const st=$('#lsSt'); if (st) st.textContent='Есть несохранённые изменения';
    this.m.querySelectorAll('[data-lssave],[data-lsundo]').forEach(b=>b.disabled=false); }
  async save(values, msg){
    try{ const r=await ajson('lists', {values}); LISTS.use(r.values||{}); LISTS.cache(); this.start(); this.render(); toast(msg); renderForm(); }
    catch(e){ toast('Не сохранено: '+(e.message||e)); } }
  bind(){ const m=this.m;
    m.oninput=e=>{ const t=e.target; if (t.dataset.lsf==null) return; this.rows[+t.dataset.i][t.dataset.lsf]=t.value; this.touch(); };
    m.onclick=async e=>{ const t=e.target;
      const k=t.closest('[data-lsk]'); if (k){ if (this.dirty && !await stConfirm('Не сохранено','Изменения в этом списке пропадут.','Перейти')) return;
        this.key=ListsPanel.last=k.dataset.lsk; this.start(); return this.render(); }
      if (t.closest('[data-lsadd]')){ this.rows.push({}); this.touch(); this.render(); this.m.querySelector('.ls-r:last-child [data-lsf]')?.focus(); return; }
      const mv=t.closest('[data-lsm]'); if (mv){ const i=+mv.dataset.i, j=i+(+mv.dataset.lsm); [this.rows[i], this.rows[j]]=[this.rows[j], this.rows[i]]; this.touch(); return this.render(); }
      const dl=t.closest('[data-lsdel]'); if (dl){ this.rows.splice(+dl.dataset.i, 1); this.touch(); return this.render(); }
      if (t.closest('[data-lsundo]')){ this.start(); return this.render(); }
      if (t.closest('[data-lsreset]')){ if (!await stConfirm('Вернуть встроенный список?', 'Ваши варианты «'+this.def().label+'» удалятся, будет действовать список программы.', 'Вернуть')) return;
        return this.save({[this.key]: null}, 'Возвращён встроенный список'); }
      if (t.closest('[data-lssave]')){ const d=this.def(), rows=this.rows.map(r=>d.clean(r)).filter(r=>Object.keys(r).length);
        const err=d.validate(rows); if (err) return toast(err);
        const same=JSON.stringify(rows)===JSON.stringify(d.builtin.map(r=>d.clean(r)));
        return this.save({[this.key]: same ? null : rows}, same ? 'Список совпадает со встроенным — действует встроенный' : 'Список сохранён — действует у всех'); } };
  }
}
ListsPanel.last = '';

class TextsPanel {
  constructor(m){ this.m=m; this.q=''; }
  async open(){ await uitLoad(); this.render(); this.bind(); }
  entries(){ const q=norm(this.q); return Object.entries(UIT.map).filter(([a,b])=>!q || norm(a).includes(q) || norm(b).includes(q)).sort((p,r)=>p[0].localeCompare(r[0],'ru')); }
  render(){ const all=Object.keys(UIT.map).length, list=this.entries();
    this.m.innerHTML=`<div class="st-card"><p class="sub" style="margin:0">Тексты интерфейса</p>
        <p class="muted" style="margin:6px 0 10px">Названия разделов и кнопок, подписи полей, подсказки — как их видят все пользователи. Новую замену удобнее сделать прямо на экране:
        «Править на экране» → карандаш у надписи. Здесь — все замены сразу: изменить или вернуть исходный текст.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-txon>✎ Править на экране</button>
          <input type="search" id="txQ" placeholder="Поиск по тексту" value="${esc(this.q)}" autocomplete="off" style="flex:1 1 220px" aria-label="Поиск по тексту"></div></div>
      <div class="st-card"><p class="sub">Заменено текстов: ${all}${this.q?` · найдено: ${list.length}`:''}</p>
        ${list.length ? `<div class="tx-l" data-uit-skip>${list.map(([a,b])=>`<div class="tx-r" data-txk="${esc(a)}"><div class="tx-o"><small class="muted">Исходный</small><span>${esc(a)}</span></div>
            <label class="tx-n"><small class="muted">Сейчас</small><textarea rows="${Math.min(4, Math.ceil(b.length/50)+1)}" data-txv aria-label="Новый текст">${esc(b)}</textarea></label>
            <div class="tx-a"><button type="button" class="btn sm" data-txsave disabled>Сохранить</button><button type="button" class="btn ghost sm" data-txdel>Вернуть исходный</button></div></div>`).join('')}</div>`
          : `<p class="empty">${all?'Ничего не найдено.':'Тексты не менялись — везде исходные надписи программы.'}</p>`}</div>`; }
  async put(map, back, msg){ const old=UIT.map; UIT.map=map;
    try{ await api('/api/uitexts', {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(map)}); }
    catch(e){ UIT.map=old; return toast('Не сохранено: '+(e.message||e)); }
    uitIndex(); uitApply(document.body, back); uitApply(document.body); toast(msg); this.render(); }
  bind(){ const m=this.m; let qT=0;
    m.oninput=e=>{ if (e.target.id==='txQ'){ clearTimeout(qT); qT=setTimeout(()=>{ this.q=e.target.value; this.render(); const q=$('#txQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200); return; }
      const r=e.target.closest('.tx-r'); if (r) r.querySelector('[data-txsave]').disabled=false; };
    m.onclick=e=>{ const t=e.target;
      if (t.closest('[data-txon]')){ $('#setdlg')?.close(); return uitToggle(true); }
      const r=t.closest('.tx-r'); if (!r) return; const k=r.dataset.txk;
      if (t.closest('[data-txdel]')) { const map={...UIT.map}, back={[uitNorm(map[k])]:k}; delete map[k]; return this.put(map, back, 'Возвращён исходный текст'); }
      if (t.closest('[data-txsave]')){ const v=uitNorm(r.querySelector('[data-txv]').value); if (!v) return toast('Текст не может быть пустым — «Вернуть исходный»');
        const map={...UIT.map}, back={[uitNorm(map[k])]:k}; if (v===k) delete map[k]; else map[k]=v; return this.put(map, back, 'Текст изменён'); } };
  }
}

async function stLists(m){ await new ListsPanel(m).open(); }
async function stTexts(m){ await new TextsPanel(m).open(); }
