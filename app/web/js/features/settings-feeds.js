// «Настройки → Фиды поставщиков»: товарный фид поставщика (YML) как API — по кнопке позиции фида становятся позициями
// каталога (характеристики, описание, фото, РРЦ, наличие), раз в день программа сверяет РРЦ и наличие (сервер: app/feeds.py).
'use strict';

const FD = { sel:null, prev:null, cats:{}, types:[], poll:0, edit:null, logs:{} };
const FD_REMEZA = { name:'Remeza', url:'https://www.remeza.org/bitrix/catalog_export/yandex_202475.php', maker:'Remeza', auto:true, pageDesc:true };

const fdRub = kop => kop==null ? '—' : money(kop)+' ₽';
const fdDate = iso => iso ? stTime(iso) : '—';

async function stFeeds(m){
  const r=await aapi('feeds'); FD.types=r.types||[]; const items=r.items||[];
  if (FD.sel && !items.some(f=>f.id===FD.sel)) FD.sel=null;
  if (!items.length && !FD.edit) FD.edit={...FD_REMEZA};
  const f=items.find(x=>x.id===FD.sel);
  m.innerHTML=`<div class="st-card"><div class="row fd-head"><div class="sub" style="margin:0">Фиды поставщиков${tip('<p>Товарный фид (YML, «Яндекс.Маркет») — выгрузка каталога с сайта поставщика: характеристики, фото, цены, наличие.</p><p>«Проверить фид» покажет, что в нём есть, и предложит категории. «Загрузить в каталог» создаст позиции (повторная загрузка обновит их, ручные правки сохранятся). Раз в день программа сверяет РРЦ и наличие — изменения видны в журнале ниже, в каталоге и в КП.</p>')}</div>
      <span class="sp"></span><button class="btn" type="button" data-fd="new">+ Новый фид</button></div>
    ${items.length?`<div class="st-list">${items.map(x=>`<div class="st-row${x.id===FD.sel?' on':''}"><div><b>${esc(x.name)}</b><span class="muted">${esc(x.url)}</span>
        <span class="muted">в каталоге: ${x.linked} ${plural(x.linked,'позиция','позиции','позиций')}${x.last&&x.last.check?` · проверка ${esc(fdDate(x.last.check.at))}`:''}${x.last&&x.last.import?` · загрузка ${esc(fdDate(x.last.import.at))}`:''}${x.auto?' · автопроверка раз в день':''}</span>
        ${x.job&&x.job.state==='run'?`<span class="ok-t">${x.job.kind==='import'?'Загружаю':'Проверяю'}… ${x.job.done}/${x.job.total||'?'}</span>`:''}</div>
        <div class="acts"><button class="btn" type="button" data-fd="open" data-id="${esc(x.id)}">${x.id===FD.sel?'Свернуть':'Открыть'}</button></div></div>`).join('')}</div>`:'<p class="muted">Фидов пока нет.</p>'}</div>
    ${FD.edit?fdForm(FD.edit, true):''}
    ${f?`<div class="st-card fd-panel" id="fdPanel">${fdForm(f)}${fdActions(f)}<div id="fdJob">${fdJob(f.job)}</div><div id="fdPrev">${FD.prev&&FD.prev.id===f.id?fdPreview(FD.prev):''}</div><div id="fdLog"></div></div>`:''}`;
  m.onclick=e=>fdClick(e, m);
  m.onchange=e=>{ const t=e.target; if (t.dataset.fdcat!=null){ FD.cats[t.dataset.fdcat]=t.value; fdCount(m); } };
  if (f){ fdLoadLog(f.id); if (f.job&&f.job.state==='run') fdPoll(f.id, m); }
}

function fdForm(f, isNew){
  return `<div class="${isNew?'st-card ':''}fd-form" data-fdform="${isNew?'new':esc(f.id)}">${isNew?'<p class="sub">Новый фид</p>':''}
    <div class="st-ed-g"><label class="f wide"><span>Адрес фида (YML)</span><input type="text" inputmode="url" data-fdf="url" value="${esc(f.url||'')}" placeholder="https://…/catalog_export/yandex.php"></label>
      <label class="f"><span>Название</span><input type="text" data-fdf="name" value="${esc(f.name||'')}" placeholder="Remeza"></label>
      <label class="f"><span>Производитель по умолчанию</span><input type="text" data-fdf="maker" value="${esc(f.maker||'')}" placeholder="если в фиде нет поля vendor"></label>
      <label class="f"><span>Наша скидка от РРЦ, %${tip('Если задана — закупка позиции = РРЦ минус скидка; обновляется вместе с РРЦ. Пусто — закупку фид не трогает.')}</span><input type="text" inputmode="decimal" data-fdf="discount" value="${esc(f.discount??'')}" placeholder="например, 25"></label>
      <label class="fd-auto"><input type="checkbox" data-fdf="auto"${f.auto!==false?' checked':''}> Раз в день проверять РРЦ и наличие</label>
      <label class="fd-auto"><input type="checkbox" data-fdf="pageDesc"${f.pageDesc!==false?' checked':''}> Описание, фото и применимость — со страницы товара${tip('При загрузке в каталог программа открывает страницу каждого товара (ссылка из фида): описание из блока описания (itemprop="description") — если оно длиннее описания в фиде; до 8 фото товара (без блоков «похожие товары»); характеристики, которых нет в фиде; у запчастей — применимость («Применяемость», «Подходит для…»). Страницы запоминаются на 30 дней; первая загрузка большого фида — дольше на несколько минут. Описание, исправленное вручную, не затирается.')}</label></div>
    <div class="row fd-fb"><button class="btn primary" type="button" data-fd="save">${isNew?'Добавить фид':'Сохранить'}</button>${isNew?'<button class="btn ghost" type="button" data-fd="cancel">Отмена</button>':'<button class="btn ghost danger" type="button" data-fd="del">Удалить фид</button>'}</div></div>`;
}

function fdActions(f){
  return `<div class="row fd-acts"><button class="btn" type="button" data-fd="preview">Проверить фид</button>
    <button class="btn primary" type="button" data-fd="import"${FD.prev&&FD.prev.id===f.id?'':' disabled title="Сначала «Проверить фид»"'}>Загрузить в каталог</button>
    <button class="btn" type="button" data-fd="check"${f.linked?'':' disabled title="Сначала загрузите позиции в каталог"'}>Проверить цены и наличие сейчас</button></div>`;
}

function fdJob(j){
  if (!j) return '';
  if (j.state==='run') return `<div class="fd-prog"><span>${j.kind==='import'?'Загружаю позиции, фото и характеристики':'Сверяю РРЦ и наличие'}… ${j.done} из ${j.total||'?'}</span><i style="width:${j.total?Math.round(j.done/j.total*100):5}%"></i></div>`;
  if (j.state==='error') return `<p class="msg err">${esc(j.msg)}</p>`;
  return j.msg ? `<p class="msg ok">${esc(j.msg)}</p>` : '';
}

function fdTypeName(id){ const t=FD.types.find(x=>x.id===id); return t ? t.name : (id==='other'||!id ? 'Прочее' : id); }
function fdKinds(k){ return (k||[]).map(([id,n])=>`${esc(fdTypeName(id))} ${n}`).join(' · '); }

function fdPreview(p){
  const tsel=(cid,v)=>`<select data-fdcat="${esc(cid)}" aria-label="Категория программы"><option value="skip"${v==='skip'?' selected':''}>— не загружать —</option>
    <option value=""${!v?' selected':''}>по названию позиции</option>${FD.types.map(t=>`<option value="${esc(t.id)}"${v===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select>`;
  return `<div class="fd-sum">${[['товаров', p.total], ['в наличии', p.available], ['с ценой', p.withPrice], ['с остатком', p.withQty], ['с фото', p.withPhoto], ['уже в каталоге', p.inCatalog]]
      .map(([t,v])=>`<span><b>${stNum(v)}</b> ${t}</span>`).join('')}${p.shop?`<span class="muted">${esc(p.shop)}${p.date?' · '+esc(p.date):''}</span>`:''}</div>
    <div class="sub">Категории фида → категории программы ${tip('По умолчанию категория определяется по названию каждой позиции: разделы фида часто — подборки («200 л/мин», «С ресивером»), где вперемешку винтовые и поршневые. Выберите категорию, только если весь раздел — одно и то же, или «не загружать».')}</div>
    <div class="fd-tw"><table class="fd-t"><thead><tr><th>Категория в фиде</th><th class="num">Товаров</th><th class="num">В каталоге</th><th>По названию</th><th>Категория программы</th></tr></thead>
      <tbody>${p.cats.map(c=>`<tr><td>${esc(c.path)}</td><td class="num">${c.count}</td><td class="num">${c.inCatalog||''}</td><td class="muted">${fdKinds(c.kinds)}</td><td>${tsel(c.id, FD.cats[c.id]??c.map)}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted fd-cnt" id="fdCnt"></p>
    ${p.params.length?`<details class="more"><summary>Характеристики в фиде (${p.params.length})</summary><p class="muted">${p.params.map(([k,n])=>`${esc(k)} <small>(${n})</small>`).join(' · ')}</p></details>`:''}
    <details class="more"><summary>Первые товары фида</summary><div class="fd-tw"><table class="fd-t"><thead><tr><th>Товар</th><th>Производитель, модель</th><th>Артикул</th><th>Категория</th><th class="num">РРЦ</th><th>Наличие</th><th class="num">Фото / ТТХ</th></tr></thead>
      <tbody>${p.sample.map(o=>`<tr><td>${esc(o.name)}</td><td>${esc([o.maker,o.model].filter(Boolean).join(' '))}</td><td>${esc(o.sku||'')}</td><td class="muted">${esc(fdTypeName(o.cat))}</td><td class="num">${o.price!=null?money(Math.round(o.price*100))+' '+esc(o.cur||''):'—'}</td>
        <td>${o.qty!=null?(o.qty>0?'в наличии '+o.qty:'нет'):(o.available?'в наличии':'нет')}</td><td class="num">${o.pics} / ${o.params}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function fdCount(m){ const p=FD.prev; if (!p) return; const el=m.querySelector('#fdCnt'); if (!el) return;
  const n=p.cats.filter(c=>(FD.cats[c.id]??c.map)!=='skip').reduce((a,c)=>a+c.count,0);
  el.textContent=`Будет загружено: ${n} ${plural(n,'позиция','позиции','позиций')}. Новые появятся в каталоге, уже загруженные обновятся (ручные правки сохранятся).`;
  const b=m.querySelector('[data-fd=import]'); if (b) b.textContent=`Загрузить в каталог (${n})`; }

async function fdLoadLog(fid){
  try{ const r=await aapi(`feeds/${fid}/log`); const el=$('#fdLog'); if (!el) return;
    el.innerHTML=(r.items||[]).length?`<p class="sub">Журнал загрузок и проверок</p>${r.items.map(x=>fdLogItem(x)).join('')}`:'<p class="muted">Загрузок и проверок ещё не было.</p>'; }
  catch(e){ const el=$('#fdLog'); if (el) el.innerHTML=`<p class="muted">Журнал не загрузился: ${esc(e.message||e)}</p>`; }
}

function fdLogItem(x){
  const kind=x.kind==='import'?'Загрузка в каталог':'Проверка РРЦ и наличия';
  if (x.error) return `<div class="st-row"><div><b>${esc(fdDate(x.at))} · ${kind}</b><span class="bad-t">${esc(x.error)}</span></div></div>`;
  const sum=x.kind==='import' ? `добавлено ${x.added}, обновлено ${x.updated}, без изменений ${x.same}` : `проверено ${x.checked}, обновлено ${x.updated}${x.new?`, новых в фиде ${x.new}`:''}`;
  const pc=x.price||[], sc=x.stock||[], gone=x.gone||[];
  const tbl=(rows, f)=>`<table class="fd-t"><tbody>${rows.map(f).join('')}</tbody></table>`;
  return `<details class="st-log"><summary><span class="t">${esc(fdDate(x.at))}</span><b>${kind}</b><span class="muted">${esc(sum)}${pc.length?` · РРЦ изменилась: ${pc.length}`:''}${sc.length?` · наличие: ${sc.length}`:''}${gone.length?` · нет в фиде: ${gone.length}`:''}</span><span class="u">${esc(x.by||'')}</span></summary>
    <div class="st-logb">${pc.length?`<p class="sub">РРЦ</p>${tbl(pc, c=>`<tr><td>${esc(c.name)}</td><td class="num">${fdRub(c.old)} → <b class="${c.new>c.old?'bad-t':'ok-t'}">${fdRub(c.new)}</b></td><td class="num">${c.old?((c.new-c.old)/c.old*100>0?'+':'')+String(Math.round((c.new-c.old)/c.old*1000)/10).replace('.',',')+' %':''}</td></tr>`)}`:''}
      ${sc.length?`<p class="sub">Наличие</p>${tbl(sc, c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.old)} → <b>${esc(c.new)}</b></td></tr>`)}`:''}
      ${gone.length?`<p class="sub">Пропали из фида</p>${tbl(gone, c=>`<tr><td>${esc(c.name)}</td></tr>`)}`:''}
      ${x.newSample&&x.newSample.length?`<p class="sub">Новые товары в фиде (ещё не в каталоге)</p><p class="muted">${x.newSample.map(esc).join(' · ')}${x.new>x.newSample.length?' …':''} — «Проверить фид» → «Загрузить в каталог».</p>`:''}
      ${(x.errors||[]).length?`<p class="sub">Ошибки</p><p class="bad-t">${x.errors.map(esc).join('<br>')}</p>`:''}
      ${!pc.length&&!sc.length&&!gone.length&&!(x.errors||[]).length&&!x.new?'<p class="muted">Изменений нет.</p>':''}</div></details>`;
}

function fdPoll(fid, m){
  clearTimeout(FD.poll);
  FD.poll=setTimeout(async()=>{ if (ST.tab!=='feeds' || !$('#fdPanel')) return;
    let j=null; try{ j=(await aapi(`feeds/${fid}/status`)).job; }catch(e){ return; }
    const el=$('#fdJob'); if (el) el.innerHTML=fdJob(j);
    if (j && j.state==='run') return fdPoll(fid, m);
    if (j && j.state==='done' && j.kind==='import' && typeof refreshCat==='function') refreshCat();
    FD.prev=null; stFeeds(m); }, 1500);
}

function fdVals(box){ const v={}; box.querySelectorAll('[data-fdf]').forEach(i=>{ v[i.dataset.fdf]=i.type==='checkbox'?i.checked:i.value.trim(); }); return v; }

async function fdClick(e, m){
  const b=e.target.closest('[data-fd]'); if (!b) return; const a=b.dataset.fd;
  try{
    if (a==='new'){ FD.edit={name:'', url:'', maker:'', auto:true, pageDesc:true}; return stFeeds(m); }
    if (a==='cancel'){ FD.edit=null; return stFeeds(m); }
    if (a==='open'){ FD.sel = FD.sel===b.dataset.id ? null : b.dataset.id; FD.prev=null; FD.cats={}; return stFeeds(m); }
    const form=b.closest('[data-fdform]') || m.querySelector(`[data-fdform="${FD.sel}"]`);
    if (a==='save'){ const isNew=form.dataset.fdform==='new', v=fdVals(form);
      const old=isNew?{}:(await aapi('feeds')).items.find(x=>x.id===FD.sel)||{};
      const f=await ajson('feeds', {...old, ...v, id:isNew?undefined:FD.sel}); FD.edit=null; FD.sel=f.id; toast('Фид сохранён'); return stFeeds(m); }
    if (a==='del'){ if (!await stConfirm('Удалить фид?','Позиции, уже загруженные в каталог, останутся; проверка РРЦ и наличия для них прекратится.','Удалить')) return;
      await ajson(`feeds/${FD.sel}/delete`); FD.sel=null; FD.prev=null; toast('Фид удалён'); return stFeeds(m); }
    if (a==='preview'){ b.disabled=true; b.textContent='Загружаю фид…'; const p=await ajson(`feeds/${FD.sel}/preview`);
      FD.prev={...p, id:FD.sel}; FD.cats={}; p.cats.forEach(c=>{ FD.cats[c.id]=c.map; }); await stFeeds(m); fdCount(m); return; }
    if (a==='import'){ const f=(await aapi('feeds')).items.find(x=>x.id===FD.sel); if (!f) return;
      await ajson('feeds', {...f, cats:{...FD.cats}});
      await ajson(`feeds/${FD.sel}/import`); toast('Загрузка началась — можно продолжать работу'); return stFeeds(m); }
    if (a==='check'){ await ajson(`feeds/${FD.sel}/check`); toast('Проверка началась'); return stFeeds(m); }
  }catch(err){ toast(err.message||String(err)); stFeeds(m); }
}
