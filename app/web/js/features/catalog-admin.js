// Каталог для администратора и менеджеров с особыми правами (сервер — app/catalog_admin.py):
// CatalogExportDlg — выгрузка отобранного в окне каталога (Excel, JSON, XML, YML; цены, остатки, картинки, параметры галочками);
// CatalogBin — «В корзину» (администратор или право «Удалять товары»); ModerationView — правка на модерации «было → стало»
// с выделением изменённого, приём целиком или по отмеченным полям, код правки — под «Расширенное»; ModerationList — очередь;
// GoodsTab — «Настройки → Каталог → Товары»; TrashTab — корзина: восстановить, удалить навсегда, очистить.
'use strict';

// ---------------------------------------------------------------- выгрузка отобранного
class CatalogExportDlg {
  static KEY = 'kp.catExport';
  static FMT = [['xlsx','Excel'],['json','JSON'],['xml','XML'],['yml','YML (Яндекс)']];
  static COLS = [['cat','Категория',1],['maker','Производитель',1],['model','Модель',1],['series','Серия',0],['art','Артикул',1],['sup','Поставщик',1],
    ['spec','Краткие характеристики',1],['desc','Описание',0],['specs','Характеристики (таблица)',0],['url','Страница товара',0]];
  static IMG = [['none','Без картинок'],['links','Ссылками'],['files','Файлами в архиве .zip']];

  static saved(){ try{ return JSON.parse(localStorage.getItem(this.KEY)||'{}')||{}; }catch(e){ return {}; } }
  static remember(o){ try{ localStorage.setItem(this.KEY, JSON.stringify(o)); }catch(e){} }

  /** параметры категорий отобранных позиций: [{key, label, n}] (марка, модель, серия, категория — отдельными столбцами) */
  static params(docs){
    const base=new Set(['cat','maker','model','series','article']), out=new Map(), cats=new Map();
    for (const x of docs){ const c=CatalogIndex.attrs(x).cat; cats.set(c, (cats.get(c)||0)+1); }
    for (const [c, n] of cats) for (const f of typeById(c).fields){ if (base.has(f.key)) continue;
      const o=out.get(f.key)||{key:f.key, label:f.label+(f.unit?', '+f.unit:''), n:0}; o.n+=n; out.set(f.key, o); }
    return [...out.values()].sort((a,b)=>b.n-a.n || a.label.localeCompare(b.label,'ru'));
  }

  static html(n, P, o){
    const admin=AUTH.admin || ADMIN.on, cols=o.cols||this.COLS.filter(c=>c[2]).map(c=>c[0]), allP=!o.params || o.params.includes('*');
    const ck=(k, label, on, extra='')=>`<label class="cx-ck"><input type="checkbox" data-cx="${k}"${on?' checked':''}${extra}> ${esc(label)}</label>`;
    return `<h3>Выгрузить ${Fmt.num(n)} ${plural(n,'позицию','позиции','позиций')}</h3>
      <p class="muted cx-note">Выгружается то, что сейчас отобрано в каталоге: поиск, фильтры и отметки галочками.</p>
      <div class="cx-g"><span class="cx-l">Формат</span><div class="seg" role="radiogroup">${this.FMT.map(([k,l])=>`<button type="button" role="radio" data-fmt="${k}" class="${(o.fmt||'xlsx')===k?'on':''}" aria-checked="${(o.fmt||'xlsx')===k}">${l}</button>`).join('')}</div></div>
      <div class="cx-g"><span class="cx-l">Цены и наличие</span><div class="cx-row">${ck('price','Цена КП', o.price!==false)}${ck('rrc','РРЦ', !!o.rrc)}${admin?ck('cost','Закупка', false):''}${ck('stock','Остатки', !!o.stock)}</div></div>
      <div class="cx-g"><span class="cx-l">Картинки</span><div class="seg" role="radiogroup">${this.IMG.map(([k,l])=>`<button type="button" role="radio" data-img="${k}" class="${(o.images||'none')===k?'on':''}" aria-checked="${(o.images||'none')===k}">${l}</button>`).join('')}</div></div>
      <div class="cx-g"><span class="cx-l">Столбцы</span><div class="cx-row">${this.COLS.map(([k,l])=>ck('c:'+k, l, cols.includes(k))).join('')}</div></div>
      <details class="cx-p"${P.length&&!allP?' open':''}><summary>Параметры категорий: <b class="cx-pn">${allP?'все':(o.params||[]).filter(k=>P.some(p=>p.key===k)).length+' из '+P.length}</b></summary>
        ${P.length?`<label class="cx-ck cx-all"><input type="checkbox" data-cxall${allP?' checked':''}> Все параметры</label><div class="cx-plist">${P.map(p=>ck('p:'+p.key, p.label, allP || (o.params||[]).includes(p.key), ` title="${esc(p.label)}: у ${p.n} поз."`)).join('')}</div>`:'<p class="muted">У отобранных позиций нет параметров категорий.</p>'}</details>
      ${admin?'<p class="muted cx-note">Закупка — только по галочке и только администратору; по умолчанию не выгружается.</p>':''}
      <div class="row"><button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-go>Выгрузить</button></div>`;
  }

  /** ids — позиции для выгрузки; docs — их карточки (для списка параметров) */
  static open(ids, docs){
    if (!can('export')) return cannot('export');
    if (!ids.length) return toast('Нет позиций для выгрузки — ослабьте фильтры');
    const P=this.params(docs), o=this.saved(), m=new Modal(this.html(ids.length, P, o), 'cx');
    const st={fmt:o.fmt||'xlsx', images:o.images||'none'};
    const count=()=>{ const all=m.$('[data-cxall]'); const k=[...m.d.querySelectorAll('[data-cx^="p:"]')].filter(i=>i.checked).length;
      if (all){ all.checked=k===P.length; all.indeterminate=k>0 && k<P.length; } const b=m.$('.cx-pn'); if (b) b.textContent=k===P.length?'все':k+' из '+P.length; };
    m.d.addEventListener('click', async e=>{
      const f=e.target.closest('[data-fmt]'), im=e.target.closest('[data-img]');
      if (f||im){ const k=f?'fmt':'images', v=f?f.dataset.fmt:im.dataset.img; st[k]=v;
        m.d.querySelectorAll(f?'[data-fmt]':'[data-img]').forEach(b=>{ const on=(f?b.dataset.fmt:b.dataset.img)===v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); return; }
      if (e.target.closest('[data-x]')) return m.close();
      const go=e.target.closest('[data-go]'); if (!go) return;
      const val=k=>!!m.$(`[data-cx="${k}"]`)?.checked;
      const params=[...m.d.querySelectorAll('[data-cx^="p:"]')].filter(i=>i.checked).map(i=>i.dataset.cx.slice(2));
      const body={ ids, fmt:st.fmt, images:st.images, price:val('price'), rrc:val('rrc'), cost:val('cost'), stock:val('stock'),
        cols:this.COLS.map(c=>c[0]).filter(k=>val('c:'+k)), params: P.length && params.length===P.length ? ['*'] : params };
      this.remember({...body, ids:undefined, cost:false, params: body.params});
      go.disabled=true; go.textContent='Готовлю файл…';
      try{ await this.download('/api/catalog/export', body); m.close(); }
      catch(err){ go.disabled=false; go.textContent='Выгрузить'; toast('Не выгружено: '+(err.message||err)); } });
    m.d.addEventListener('change', e=>{ const a=e.target.closest('[data-cxall]');
      if (a){ m.d.querySelectorAll('[data-cx^="p:"]').forEach(i=>{ i.checked=a.checked; }); }
      count(); });
  }

  /** POST и скачать ответ файлом (имя — из заголовка сервера) */
  static async download(path, body){
    const r=await api(path, {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body), raw:true});
    const cd=r.headers.get('content-disposition')||'', m=/filename\*=UTF-8''([^;]+)/i.exec(cd), name=m ? decodeURIComponent(m[1]) : 'выгрузка';
    saveFileA(name, await r.blob()); toast('Файл готов: '+name);
  }
}

// ---------------------------------------------------------------- в корзину (администратор или право «Удалять товары»)
class CatalogBin {
  static async put(ids, names){
    if (!can('catDelete')) return cannot('catDelete');
    const n=ids.length; if (!n) return false;
    const what=n===1 ? `«${names[0]||'позиция'}»` : `${n} ${plural(n,'позицию','позиции','позиций')}`;
    if (!await stConfirm(`Удалить ${what} в корзину?`, `Позиции исчезнут из каталога. В корзине они хранятся ${DEFN('srv.trashDays', 30)} дн. — восстановить может администратор («Настройки → Сотрудники и система → Корзина»). КП, в которых они есть, не меняются.`, 'Удалить в корзину')) return false;
    try{ const r=await api('/api/catalog/trash', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({ids})});
      await refreshCat(); toast(`В корзине: ${r.deleted} ${plural(r.deleted,'позиция','позиции','позиций')}`); return true; }
    catch(err){ toast('Не удалено: '+(err.message||err)); return false; }
  }
}

// ---------------------------------------------------------------- модерация: «было → стало»
class ModerationView {
  static ABSENT = '__absent__';
  /** где решать: администратор («Настройки») или менеджер с правом «Правки без модерации» */
  static url(id, act){ return ADMIN.on ? `pending/${id}${act?'/'+act:''}` : `/api/catalog/moderation/${id}${act?'/'+act:''}`; }
  static get(id){ return ADMIN.on ? aapi(this.url(id)) : api(this.url(id)); }
  static post(id, act, body){ return ADMIN.on ? ajson(this.url(id, act), body) : api(this.url(id, act), {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(body)}); }

  /** поле категории позиции; нет в её категории — то же поле любой другой категории (подпись и единица) */
  static field(f, cat){ return f.attr ? typeById(cat).fields.find(x=>x.key===f.attr) || TYPES.flatMap(t=>t.fields).find(x=>x.key===f.attr) : null; }
  static label(f, cat){
    if (!f.attr) return f.label;
    const fl=this.field(f, cat); if (fl) return fl.label+(fl.unit?', '+fl.unit:'');
    return ({cat:'Категория', maker:'Производитель', model:'Модель', series:'Серия', article:'Артикул'})[f.attr] || `Параметр «${f.attr}»`;
  }
  static empty(v){ return v===this.ABSENT || v==null || v==='' || (Array.isArray(v) && !v.length); }
  static big(v){ return v && typeof v==='object' && '__truncated__' in v; }

  /** слова: общие — как есть, убранные (было) и добавленные (стало) — выделены */
  static words(a, b){
    const A=String(a??'').split(/(\s+)/), B=String(b??'').split(/(\s+)/);
    if (A.length*B.length>160000) return [`<del>${esc(a)}</del>`, `<ins>${esc(b)}</ins>`];
    const L=Array.from({length:A.length+1}, ()=>new Uint16Array(B.length+1));
    for (let i=A.length-1; i>=0; i--) for (let j=B.length-1; j>=0; j--) L[i][j]=A[i]===B[j] ? L[i+1][j+1]+1 : Math.max(L[i+1][j], L[i][j+1]);
    let i=0, j=0; const x=[], y=[];
    while (i<A.length && j<B.length){
      if (A[i]===B[j]){ x.push(esc(A[i])); y.push(esc(B[j])); i++; j++; }
      else if (L[i+1][j]>=L[i][j+1]){ x.push(/^\s+$/.test(A[i])?esc(A[i]):`<del>${esc(A[i])}</del>`); i++; }
      else { y.push(/^\s+$/.test(B[j])?esc(B[j]):`<ins>${esc(B[j])}</ins>`); j++; } }
    while (i<A.length){ x.push(/^\s+$/.test(A[i])?esc(A[i]):`<del>${esc(A[i])}</del>`); i++; }
    while (j<B.length){ y.push(/^\s+$/.test(B[j])?esc(B[j]):`<ins>${esc(B[j])}</ins>`); j++; }
    return [x.join(''), y.join('')];
  }
  static pics(v){ const L=(Array.isArray(v)?v:[v]).filter(g=>g&&g.src&&g.on!==false); return L.length ? `<div class="mv-pics">${L.slice(0,12).map(g=>`<img src="${esc(g.src)}" alt="" loading="lazy">`).join('')}</div>` : ''; }
  /** блоки описания: без изменений — как есть; тот же заголовок с другим текстом — изменённые слова; новый или убранный блок — целиком */
  static blocks(v, other, side='b'){ const O=(Array.isArray(other)?other:[]).filter(b=>b&&(b.label||b.text)), has=new Set(O.map(b=>(b.label||'')+'\n'+(b.text||'')));
    return (Array.isArray(v)?v:[]).filter(b=>b&&(b.label||b.text)).map(b=>{ const lab=b.label?`<b>${esc(b.label)}.</b> `:'';
      if (has.has((b.label||'')+'\n'+(b.text||''))) return `<p>${lab}${esc(b.text||'')}</p>`;
      const pair=O.find(o=>(o.label||'')===(b.label||''));
      if (pair){ const [x, y]=side==='a' ? this.words(pair.text||'', b.text||'') : this.words(b.text||'', pair.text||''); return `<p class="mv-chg1">${lab}${side==='a'?y:x}</p>`; }
      return `<p class="mv-chg">${lab}${esc(b.text||'')}</p>`; }).join(''); }
  static rows(v, other){ const flat=g=>(Array.isArray(g)?g:[]).flatMap(x=>(x.rows||[]).filter(r=>r.k||r.v).map(r=>[x.name||'', r.k||'', String(r.v??'')]));
    const has=new Set(flat(other).map(r=>r.join('\n')));
    const R=flat(v); return R.length ? `<table class="pv-t mv-rows">${R.map(r=>`<tr class="${has.has(r.join('\n'))?'':'mv-chg'}"><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>` : ''; }

  /** значение поля «было» или «стало» (other — значение другой стороны, для выделения изменённого) */
  static val(f, v, other, side, cat){
    if (this.empty(v)) return '<i class="muted">пусто</i>';
    if (this.big(v)) return `<i class="muted">большое значение (${Fmt.num(v.__truncated__)} знаков) — см. «Расширенное»</i>`;
    if (f.attr==='cat') return esc(typeById(v).name);
    if (f.attr){ const fl=this.field(f, cat); const t=fl ? fmtField(fl, v) : String(v), o=this.empty(other)||this.big(other) ? '' : (fl ? fmtField(fl, other) : String(other));
      return this.words(side==='a'?o:t, side==='a'?t:o)[side==='a'?1:0]; }
    if (f.key==='photo' || f.key==='logo') return this.pics(v) || '<i class="muted">пусто</i>';
    if (f.key==='gallery') return this.pics(v) || '<i class="muted">пусто</i>';
    if (f.key==='features') return this.blocks(v, other, side) || '<i class="muted">пусто</i>';
    if (f.key==='groups') return this.rows(v, other) || '<i class="muted">пусто</i>';
    if (typeof v==='string' || typeof v==='number'){ const o=this.empty(other)||this.big(other)||typeof other==='object' ? '' : String(other);
      const [x, y]=side==='a' ? this.words(o, String(v)) : this.words(String(v), o); return side==='a' ? y : x; }
    return `<pre class="mv-pre">${esc(JSON.stringify(v, null, 1))}</pre>`;
  }

  /** карточка нового товара — как в каталоге: фото, название, параметры, описание, характеристики */
  static card(x){
    const a=x.attrs||{}, t=typeById(a.cat);
    const params=[['Категория', t.name],['Производитель',a.maker],['Серия',a.series],['Модель',a.model],...t.fields.map(f=>[f.label, fmtField(f, a[f.key])])].filter(([,v])=>v!=null&&v!=='');
    return `<div class="mv-card">${this.pics([x.photo, ...(x.gallery||[])].filter(Boolean))}
      <h4>${esc(x.name||'Без названия')}</h4>${x.spec?`<p class="muted">${esc(x.spec)}</p>`:''}
      ${x.price?`<p><b>${money(x.price)} ${curSh(x.priceCur||'RUB')}</b></p>`:''}
      ${params.length?`<table class="pv-t">${params.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:''}
      ${this.blocks(x.features, x.features)?`<p class="pv-cap">Описание</p>${this.blocks(x.features, x.features)}`:''}
      ${this.rows(x.groups, x.groups)?`<p class="pv-cap">Характеристики</p>${this.rows(x.groups, x.groups)}`:''}</div>`;
  }

  static async open(id, done){
    let p; try{ p=await this.get(id); }catch(e){ return toast(e.message||String(e)); }
    const cat=(p.afterDoc&&p.afterDoc.attrs&&p.afterDoc.attrs.cat)||(p.beforeDoc&&p.beforeDoc.attrs&&p.beforeDoc.attrs.cat)||'', isNew=p.kind==='create', pend=p.status==='pending';
    const D=p.diff||[];
    const rows=D.map(f=>`<label class="mv-r"><span class="mv-c">${pend&&!isNew?`<input type="checkbox" data-mf="${esc(f.key)}" checked aria-label="Принять: ${esc(this.label(f, cat))}">`:''}<b>${esc(this.label(f, cat))}</b></span>
        <div class="mv-b" data-l="Было">${this.val(f, f.before, f.after, 'b', cat)}</div><div class="mv-a" data-l="Стало">${this.val(f, f.after, f.before, 'a', cat)}</div></label>`).join('');
    const code=`<table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${D.map(x=>`<tr><td>${esc(x.key)}</td><td>${stVal(x.before)}</td><td>${stVal(x.after)}</td></tr>`).join('')||'<tr><td colspan="3">Отличий нет</td></tr>'}</table>`;
    const m=new Modal(`<div class="mv-h"><h3>${isNew?'Новый товар на модерации':'Правка товара'}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted mv-who"><b>${esc((p.afterDoc||{}).name||p.productId)}</b> · ${esc(typeById(cat).name)} · ${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.created))}${p.current||isNew?'':' · <span class="bad-t">товара сейчас нет в каталоге</span>'}</p>
      ${p.stale?'<p class="msg warn mv-stale">Товар изменили после отправки правки. Принятые поля лягут на текущую карточку, остальные её поля не изменятся.</p>':''}
      ${isNew ? this.card(p.afterDoc||{}) : `<div class="mv-t"><div class="mv-hd"><span class="mv-c">${pend?`<label class="mv-all"><input type="checkbox" data-mall checked aria-label="Отметить все поля"></label>`:''}Поле</span><span>Было</span><span>Стало</span></div>${rows||'<p class="muted">Отличий нет.</p>'}</div>`}
      <details class="mv-adv"><summary>Расширенное: код правки (JSON)</summary>${code}</details>
      ${pend?`<div class="mv-f"><input type="text" id="mvReason" maxlength="500" placeholder="Причина отклонения (видна сотруднику в журнале)" aria-label="Причина отклонения">
        <div class="row"><button class="btn danger" type="button" data-mv="reject">Отклонить</button>${isNew?'':`<button class="btn" type="button" data-mv="part" hidden>Принять отмеченное</button>`}<button class="btn primary" type="button" data-mv="approve">${isNew?'Принять товар':'Принять всё'}</button></div></div>`
        :`<p class="muted">${p.status==='approved'?'<span class="ok-t">Принято</span>':'<span class="bad-t">Отклонено</span>'} ${esc(p.reviewedBy||'')} ${esc(Fmt.dateTime(p.reviewedAt))}${p.reason?' — '+esc(p.reason):''}</p>`}`, 'mv');
    const sync=()=>{ const all=[...m.d.querySelectorAll('[data-mf]')], k=all.filter(i=>i.checked).length, part=m.$('[data-mv="part"]'), full=m.$('[data-mv="approve"]'), ma=m.$('[data-mall]');
      if (ma){ ma.checked=k===all.length; ma.indeterminate=k>0&&k<all.length; }
      m.d.querySelectorAll('.mv-r').forEach(r=>r.classList.toggle('off', !!r.querySelector('[data-mf]') && !r.querySelector('[data-mf]').checked));
      if (part){ part.hidden=k===all.length; part.textContent=`Принять отмеченное (${k} из ${all.length})`; part.disabled=!k; }
      if (full) full.hidden=!isNew && k<all.length; };
    m.d.addEventListener('change', e=>{ if (e.target.closest('[data-mall]')) m.d.querySelectorAll('[data-mf]').forEach(i=>{ i.checked=e.target.checked; }); sync(); });
    m.d.addEventListener('click', async e=>{ if (e.target.closest('[data-x]')) return m.close();
      const b=e.target.closest('[data-mv]'); if (!b) return;
      const reason=(m.$('#mvReason')?.value||'').trim(), act=b.dataset.mv;
      if (act==='reject' && !reason){ m.$('#mvReason').focus(); return toast('Укажите причину отклонения'); }
      const body={reason}; if (act==='part') body.fields=[...m.d.querySelectorAll('[data-mf]:checked')].map(i=>i.dataset.mf);
      b.disabled=true;
      try{ const r=await this.post(id, act==='reject'?'reject':'approve', body);
        if (r && r.ok===false){ toast(r.message||'Правка уже рассмотрена'); }
        else toast(act==='reject'?'Правка отклонена':act==='part'?'Приняты отмеченные поля':'Принято — изменения в каталоге');
        m.close(); refreshCat(); if (done) done(); }
      catch(err){ b.disabled=false; toast(err.message||String(err)); } });
    sync();
  }
}

// очередь правок: строка — товар, что изменено, кто и когда, «Посмотреть»
class ModerationList {
  static html(P, empty){
    return P.length ? P.map(p=>`<div class="st-row mv-item"><div><b>${esc(p.name)}</b>
        <span class="mv-tags">${p.kind==='create'?'<span class="mv-tag new">новый товар</span>':(p.fields||[]).slice(0,6).map(f=>`<span class="mv-tag">${esc(f)}</span>`).join('')+((p.fields||[]).length>6?`<span class="mv-tag">ещё ${p.fields.length-6}</span>`:'')}</span>
        <span class="muted">${p.cat?esc(typeById(p.cat).name)+' · ':''}${esc(p.userName||'—')} · ${esc(Fmt.dateTime(p.created))}${p.stale?' · <span class="bad-t">товар изменили после отправки</span>':''}</span></div>
        <div class="acts"><button class="btn" type="button" data-pend="${p.id}">Посмотреть</button></div></div>`).join('') : `<p class="muted">${esc(empty)}</p>`;
  }
  /** очередь для менеджера с правом «Правки без модерации» (из окна каталога) */
  static async open(){
    let r; try{ r=await api('/api/catalog/moderation'); }catch(e){ return toast(e.message||String(e)); }
    const m=new Modal(`<div class="mv-h"><h3>На модерации · ${r.pending.length}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="mv-q">${this.html(r.pending, 'Правок, ожидающих решения, нет.')}</div>`, 'mv mv-ql');
    m.d.addEventListener('click', e=>{ if (e.target.closest('[data-x]')) return m.close();
      const b=e.target.closest('[data-pend]'); if (b){ m.close(); ModerationView.open(+b.dataset.pend, ()=>{ CW.loadPending().then(()=>CW.redraw()); }); } });
  }
}

// ---------------------------------------------------------------- корзина
class TrashTab {
  static TYPES = [['','Всё'],['catalog','Товары'],['kp','КП'],['client','Клиенты'],['supplier','Поставщики'],['manager','Менеджеры']];
  static state = {type:'', q:''};
  static LIMIT = 300;

  /** box — куда рисовать; only — только этот вид (карточка корзины товаров во вкладке «Товары») */
  static async render(box, only){
    const S=only ? {type:only, q:this.state.q} : this.state;
    const r=await aapi('trash'+(S.type?'?type='+S.type:'')), q=norm(S.q||''), total=Object.values(r.counts||{}).reduce((a,b)=>a+b,0);
    const L=q ? r.items.filter(x=>norm((x.title||'')+' '+x.entityId).includes(q)) : r.items, label=Object.fromEntries(this.TYPES);
    box.innerHTML=`${only?'':`<div class="tr-types" role="tablist">${this.TYPES.map(([k,l])=>{ const n=k?(r.counts||{})[k]||0:total; return `<button type="button" role="tab" class="chip${S.type===k?' on':''}" data-trt="${k}" aria-selected="${S.type===k}">${l} <i>${n}</i></button>`; }).join('')}</div>`}
      <div class="row tr-bar"><input type="search" data-trq placeholder="Найти в корзине" value="${esc(S.q||'')}" autocomplete="off" aria-label="Найти в корзине"><span class="muted">${L.length>this.LIMIT?`показано ${this.LIMIT} из ${Fmt.num(L.length)}`:`записей: ${Fmt.num(L.length)}`} · хранятся ${r.days} дн.</span><span class="sp"></span>
        <button class="btn danger" type="button" data-trclear ${r.items.length?'':'disabled'}>${S.type?`Очистить: ${esc(label[S.type])}`:'Очистить корзину'}</button></div>
      <div class="tr-list">${L.slice(0, this.LIMIT).map(x=>`<div class="st-row tr-row"><div><b>${esc(x.title||x.entityId)}</b><span class="muted">${esc(ENT[x.entityType]||x.entityType)} · удалено ${esc(Fmt.dateTime(x.deletedAt))}${x.deletedBy?' · '+esc(x.deletedBy):''}</span></div>
        <div class="acts"><button class="btn" type="button" data-rest="${x.id}">Восстановить</button><button class="btn ghost danger-t" type="button" data-purge="${x.id}" title="Удалить навсегда — восстановить будет нельзя">Удалить навсегда</button></div></div>`).join('')||'<p class="muted">Корзина пуста.</p>'}</div>`;
    const qT=new Debounce(250);
    box.oninput=e=>{ const t=e.target.closest('[data-trq]'); if (!t) return; S.q=t.value; if (only) this.state.q=t.value; qT.run(()=>this.render(box, only).then(()=>{ const i=box.querySelector('[data-trq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); })); };
    box.onclick=async e=>{
      const tt=e.target.closest('[data-trt]'); if (tt){ S.type=tt.dataset.trt; return this.render(box, only); }
      const rs=e.target.closest('[data-rest]'), pg=e.target.closest('[data-purge]'), cl=e.target.closest('[data-trclear]');
      try{
        if (rs){ await ajson(`trash/${rs.dataset.rest}/restore`); toast('Восстановлено'); refreshCat(); loadManagers(); }
        else if (pg){ const x=r.items.find(z=>String(z.id)===pg.dataset.purge);
          if (!await stConfirm('Удалить навсегда?', `«${(x&&x.title)||'запись'}» удалится окончательно — восстановить будет нельзя.`, 'Удалить навсегда')) return;
          await ajson(`trash/${pg.dataset.purge}/purge`); toast('Удалено навсегда'); }
        else if (cl){ const n=S.type ? (r.counts||{})[S.type]||0 : total;
          if (!await stConfirm(S.type?`Очистить корзину: ${label[S.type]}?`:'Очистить корзину?', `${Fmt.num(n)} ${plural(n,'запись удалится','записи удалятся','записей удалятся')} окончательно — восстановить будет нельзя.`, 'Удалить навсегда')) return;
          const d=await ajson('trash/clear', {type:S.type}); toast(`Удалено навсегда: ${Fmt.num(d.deleted)}`); }
        else return;
      }catch(err){ toast(err.message||String(err)); }
      this.render(box, only); };
  }
}

// ---------------------------------------------------------------- «Настройки → Каталог → Товары»
class GoodsTab {
  static async render(m, auto){
    let mod={pending:[]}, tr={counts:{}};
    try{ [mod, tr]=await Promise.all([aapi('moderation'), aapi('trash?type=catalog')]); }catch(e){}
    const n=catCache.length, cats=new Set(catCache.map(x=>CatalogIndex.attrs(x).cat)).size, pend=(mod.pending||[]).length, bin=(tr.counts||{}).catalog||0;
    const tile=(v, l, tab)=>`<${tab?`button type="button" data-sttab="${tab}"`:'div'} class="st-tile"><b>${Fmt.num(v)}</b><span>${l}</span></${tab?'button':'div'}>`;
    m.innerHTML=`<div class="st-tiles gd-tiles">${tile(n, plural(n,'позиция','позиции','позиций'))}${tile(cats, 'категорий', 'types')}${tile(pend, 'на модерации', 'moderation')}${tile(bin, 'в корзине')}</div>
      <div class="st-card"><div class="row st-btns"><button class="btn primary" type="button" data-gd="open">Открыть товары</button><button class="btn" type="button" data-gd="new">+ Новая позиция</button>
        <button class="btn" type="button" data-gd="xls">Импорт из Excel…</button><button class="btn" type="button" data-gd="imp">Загрузить файл каталога (.json)…</button><button class="btn" type="button" data-gd="exp">Файл каталога для загрузки (.json)</button></div>
        <p class="muted">«Открыть товары» — окно каталога: поиск, фильтры, сортировка, карточка с фото, «Редактировать». Отметьте позиции галочками — внизу появятся «В корзину», «Выгрузить…» (Excel, JSON, XML, YML — по любому фильтру) и «Перенести в категорию…».</p></div>
      <div class="st-card"><p class="sub">Корзина товаров</p><div id="gdBin"><p class="muted">Загружаю…</p></div></div>`;
    TrashTab.render(m.querySelector('#gdBin'), 'catalog').catch(()=>{});
    m.onclick=e=>{ const b=e.target.closest('[data-gd]'); if (!b) return;
      const a=b.dataset.gd;
      if (a==='open') return GoodsTab.open();
      if (a==='new'){ setDlg().close(); return newEquip('catalog', ''); }
      return stCatalogTool(a); };
    if (auto) GoodsTab.open();
  }
  /** окно каталога поверх «Настроек» — в режиме администратора */
  static open(){ return openCatalog({admin:true}); }
}

// «⋯ → Выгрузить клиентов…» — администратор или менеджер с правом «Выгрузка» (сервер — catalog_admin.ClientsExport):
// реквизиты, адрес, контакт и объекты всех клиентов в Excel или JSON
class ClientsExportDlg {
  static sync(){ const b=document.querySelector('[data-a="clientsExport"]'); if (b) b.hidden=!can('export'); }
  static async open(){
    if (!can('export')) return cannot('export');
    const fmt=await Modal.ask(`<h3>Выгрузить клиентов</h3><p class="muted">Все клиенты: наименование, ИНН, КПП, ОГРН, адрес, контакт, объекты, число КП.</p>
      <div class="row"><button class="btn" type="button" data-v="0">Отмена</button><button class="btn" type="button" data-v="json">JSON</button><button class="btn primary" type="button" data-v="xlsx">Excel</button></div>`);
    if (!fmt) return;
    try{ await CatalogExportDlg.download('/api/clients/export', {fmt}); }catch(err){ toast('Не выгружено: '+(err.message||err)); }
  }
}
document.addEventListener('toggle', e=>{ if (e.target.matches && e.target.matches('.topmenu')) ClientsExportDlg.sync(); }, true);
