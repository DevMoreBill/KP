// Правка позиции каталога прямо из окна каталога — в той же карточке, что и позиция КП
// (основное, описание и фото, характеристики, опции, автозаполнение) плюс цена в каталоге.
// На время правки список позиций КП подменяется одной позицией каталога (CATED, см. core/state.js):
// черновик КП в это время не сохраняется и не перерисовывается, после закрытия всё возвращается как было.
'use strict';

const CAT_TMP_KEYS=['_light','_a','_nv','_hay','pricesCount'];

function docToItem(doc){
  const x=JSON.parse(JSON.stringify(doc)); CAT_TMP_KEYS.forEach(k=>delete x[k]);
  return Object.assign(newItem(), x, { qty:1, page:true, features:x.features||[], groups:x.groups||[], attrs:x.attrs||{},
    options:(x.options||[]).map(o=>({...o, id:o.id||uid()})), gallery:(x.gallery||[]).map(g=>({...g, id:g.id||uid()})) });
}

function itemToDoc(it, base){
  const cl=v=>JSON.parse(JSON.stringify(v??null)), d=cl(base);
  Object.assign(d, { name:String(it.name||'').trim(), spec:it.spec||'', pageTitle:it.pageTitle||'', photoCaption:it.photoCaption||'',
    features:cl((it.features||[]).filter(f=>f.label||f.text)),
    groups:cl((it.groups||[]).map(g=>({...g, rows:(g.rows||[]).filter(r=>r.k||r.v)})).filter(g=>g.name||g.rows.length)),
    hint:cl(it.hint||null), photo:cl(it.photo||null), logo:cl(it.logo||null), photoSource:it.photoSource||null, pageUrl:it.pageUrl||undefined,
    // source — адрес картинки у поставщика: по нему фид не добавит то же фото повторно
    gallery:(it.gallery||[]).map(({id,src,w,h,caption,slot,wide,on,at,source})=>({id,src,w,h,caption,slot,wide,on,at,...(source?{source}:{})})),
    attrs:Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null)),
    options:(it.options||[]).filter(o=>o.name).map(({_priceText,...o})=>o),
    price:it.price||0, priceCur:it.priceCur||'RUB', cost:it.cost||0, costCur:it.costCur||'RUB' });
  if (isKit(it)) d.kit={parts:kitParts(it).map(({_costText,...p})=>cl(p))}; else delete d.kit;
  CAT_TMP_KEYS.forEach(k=>delete d[k]);
  if (JSON.stringify(d.photo||null)!==JSON.stringify(base.photo||null)) delete d.photoFrom;   // своё фото вместо фото похожей модели
  return d;
}

// isNew — позиции ещё нет в каталоге (копия): «Сохранить» нужно даже без правок
function openCatEditor(doc, onSave, isNew){
  if (!doc || doc._light) return cwNote('Не удалось загрузить позицию целиком — повторите');
  if (CATED || EDIT) return;
  const it=docToItem(doc);
  CATED={ items:S.items, base:doc, onSave, snap:'', isNew:!!isNew };
  S.items=[it]; CATED.snap=JSON.stringify(itemToDoc(it,doc));
  openEditor(0,'main');
}

// при включённой модерации правка уходит администратору, а не сразу в каталог
const catSaveLabel = () => CW.mod && !ADMIN.on ? 'Отправить на модерацию' : 'Сохранить в каталог';   // правки администратора — сразу

function catEdDirty(){ return !!CATED && (CATED.isNew || JSON.stringify(itemToDoc(S.items[0],CATED.base))!==CATED.snap); }

async function closeCatEditor(save){
  if (!CATED) return;
  const it=S.items[0]; let doc=null;
  if (save){
    if (!String(it.name||'').trim()){ EDIT.tab='main'; renderEditor(); setTimeout(()=>$('#edlg [data-p="items.0.name"]')?.focus(),30); return toast('Укажите наименование позиции'); }
    doc=itemToDoc(it,CATED.base); doc.updatedAt=new Date().toISOString();
    const btn=$('#edlg [data-catsave]'); if (btn){ btn.disabled=true; btn.textContent='Сохраняю…'; }
    try{ doc=await store().put(doc); }catch(e){ if (btn){ btn.disabled=false; btn.textContent=catSaveLabel(); } return toast('Не удалось сохранить в каталог: '+(e.message||e)); }
    if (doc._pending) toast('Отправлено на модерацию — изменения появятся в каталоге после одобрения администратором');
  } else if (catEdDirty() && !confirm('Закрыть без сохранения? Изменения позиции каталога будут потеряны.')) return;
  const cb=CATED.onSave; S.items=CATED.items; CATED=null; EDIT=null;
  const d=$('#edlg'); if (d.open) d.close();
  renderForm();
  if (doc && cb) await cb(doc);
}

function catPriceBlock(x){
  const cur=k=>`<select data-ccur="${k}" aria-label="Валюта">${Object.keys(CURS).map(c=>`<option value="${c}"${(x[k]||'RUB')===c?' selected':''}>${esc(CURS[c].sh)}</option>`).join('')}</select>`;
  const pt=x._priceText ?? (x.price?money(x.price):''), ct=x._costText ?? (x.cost?money(x.cost):'');
  return `<div class="ed-sec"><p class="sub">Цена в каталоге</p><div class="cprice">
      <label class="f"><span>Цена продажи</span><input type="text" inputmode="decimal" class="num" data-cprice="price" value="${esc(pt)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта</span>${cur('priceCur')}</label>
      <label class="f"><span>Закупка</span><input type="text" inputmode="decimal" class="num" data-cprice="cost" value="${esc(ct)}" placeholder="не указана" autocomplete="off"></label><label class="f"><span>Валюта закупки</span>${cur('costCur')}</label></div>
    <p class="muted" style="margin:6px 0 0">Цена подставляется в новые КП. При сохранении КП цена позиции в каталоге обновляется сама.</p></div>`;
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset.cprice==null || !CATED) return;
  const x=S.items[0], key=t.dataset.cprice, k=parsePrice(t.value);
  x['_'+key+'Text']=t.value; x[key]=Number.isNaN(k)?0:k; t.classList.toggle('bad', Number.isNaN(k)); });

document.addEventListener('focusout', e=>{ const t=e.target; if (t.dataset.cprice==null || !CATED) return;
  const x=S.items[0], key=t.dataset.cprice, k=parsePrice(t.value); if (!Number.isNaN(k)){ delete x['_'+key+'Text']; t.value=k?money(k):''; } });

document.addEventListener('change', e=>{ const t=e.target; if (t.dataset.ccur==null || !CATED) return; S.items[0][t.dataset.ccur]=t.value; });

document.addEventListener('click', e=>{ if (!CATED || !e.target.closest('#edlg')) return;
  if (e.target.closest('[data-catsave]')) return closeCatEditor(true);
  if (e.target.closest('[data-catcancel]')) return closeCatEditor(false); });

// Esc в карточке каталога — как «Отмена» (с вопросом, если есть несохранённые правки)
document.addEventListener('cancel', e=>{ if (e.target.id==='edlg' && CATED){ e.preventDefault(); closeCatEditor(false); } }, true);
