// Импорт позиций каталога из Excel/CSV по шаблону типа оборудования.
'use strict';

function xlsColumns(t){
  const cols=[['name','Наименование'],['maker','Производитель'],['series','Серия'],['model','Модель'],['spec','Краткие характеристики']];
  for (const f of t.fields) cols.push([f.key, f.label+(f.unit?', '+f.unit:'')]);
  cols.push(['cost','Закупка за ед.'],['costCur','Валюта закупки (RUB/USD/EUR/CNY)'],['price','Цена продажи за ед., руб.'],['margin','Маржа, %']);
  return cols;
}

function parseTable(txt){
  txt=txt.replace(/^\uFEFF/,''); const first=txt.split(/\r?\n/)[0]||'';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length>=first.split(',').length ? ';' : ',');
  const rows=[]; let row=[], cell='', q=false;
  for (let k=0;k<txt.length;k++){ const c=txt[k];
    if (q){ if (c==='"'){ if (txt[k+1]==='"'){ cell+='"'; k++; } else q=false; } else cell+=c; continue; }
    if (c==='"'){ q=true; continue; }
    if (c===sep){ row.push(cell); cell=''; continue; }
    if (c==='\n' || c==='\r'){ if (c==='\r'&&txt[k+1]==='\n') k++; row.push(cell); rows.push(row); row=[]; cell=''; continue; }
    cell+=c; }
  if (cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}

function openXlsImport(cat){
  const d=$('#dlg'); d.classList.remove('wide');
  let cur=cat||TYPES.find(t=>t.role!=='accessory')?.id||'other';
  d.innerHTML=`<div class="dlg-h"><h3>Импорт позиций из Excel</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b"><div class="grid g2"><label class="f"><span>Тип оборудования</span><select id="xType">${typeOptionsHtml(cur)}</select></label>
     <div style="align-self:end"><button class="btn" type="button" id="xTpl">Скачать шаблон для Excel</button></div></div>
   <ol class="muted" style="margin:12px 0;padding-left:18px"><li>Скачайте шаблон выбранного типа и откройте его в Excel — в нём все нужные столбцы.</li>
     <li>Заполните строки (одна строка — одна позиция) и сохраните как CSV или просто скопируйте таблицу вместе с заголовками.</li>
     <li>Вставьте таблицу ниже или выберите файл CSV — позиции появятся в каталоге. Фото можно добавить потом в карточке позиции.</li></ol>
   <textarea id="xText" rows="8" placeholder="Вставьте сюда таблицу из Excel вместе со строкой заголовков"></textarea>
   <div class="row" style="margin-top:10px"><button class="btn" type="button" id="xFile">Выбрать файл CSV…</button><span class="muted" id="xInfo"></span>
     <span style="flex:1"></span><button class="btn primary" type="button" id="xGo">Импортировать</button></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close();
  $('#xType').onchange=e=>{ cur=e.target.value; };
  $('#xTpl').onclick=()=>{ const t=typeById(cur); const cols=xlsColumns(t);
    const csv='\uFEFF'+cols.map(c=>'"'+c[1].replace(/"/g,'""')+'"').join(';')+'\r\n';
    saveFile(`Шаблон_${t.name.replace(/\s+/g,'_')}.csv`, new Blob([csv],{type:'text/csv;charset=utf-8'})); };
  $('#xFile').onclick=()=>{ const f=document.createElement('input'); f.type='file'; f.accept='.csv,.tsv,.txt,text/csv'; f.hidden=true; d.appendChild(f);
    f.onchange=async()=>{ const file=f.files[0]; if(!file) return; const buf=await file.arrayBuffer(); let txt=new TextDecoder('utf-8').decode(buf);
      if (txt.includes('\uFFFD')) txt=new TextDecoder('windows-1251').decode(buf);   // CSV из старого Excel
      $('#xText').value=txt; $('#xInfo').textContent=file.name; f.remove(); }; f.click(); };
  $('#xGo').onclick=async()=>{
    const t=typeById(cur), cols=xlsColumns(t), rows=parseTable($('#xText').value);
    if (rows.length<2) return toast('Нужна строка заголовков и хотя бы одна строка данных');
    const nk=s=>norm(String(s).replace(/,.*$/,'').replace(/\(.*\)/,''));
    const map=rows[0].map(h=>{ const c=cols.find(c=>nk(c[1])===nk(h)) || t.fields.map(f=>[f.key,f.label]).find(c=>nk(c[1])===nk(h)); return c?c[0]:null; });
    if (!map.includes('name') && !map.includes('model')) return toast('Не найден столбец «Наименование» или «Модель» — используйте шаблон');
    let n=0; const skipped=[];
    for (const r of rows.slice(1)){
      const v={}; map.forEach((k,ix)=>{ if(k && String(r[ix]??'').trim()!=='') v[k]=String(r[ix]).trim(); });
      if (!v.name && !v.model){ skipped.push(r.join(' ').slice(0,40)); continue; }
      const attrs={cat:t.id}; for (const k of ['maker','series','model']) if (v[k]) attrs[k]=v[k];
      for (const f of t.fields) if (v[f.key]!=null){ attrs[f.key]= f.num ? (numOf(v[f.key])??v[f.key]) : v[f.key]; }
      const name=v.name || [t.item, v.maker, v.model].filter(Boolean).join(' ');
      const x={ id:(t.id+'_'+norm((v.maker||'')+' '+(v.model||name)).replace(/[^a-z0-9а-я]+/g,'')).slice(0,60).replace(/[^A-Za-z0-9_-]/g,c=>'x'+c.charCodeAt(0).toString(36)).slice(0,64),
        name, spec:v.spec||'', attrs, price:parsePrice(v.price||'')||0, priceCur:'RUB', cost:parsePrice(v.cost||'')||0, costCur:(v.costCur||'RUB').toUpperCase().slice(0,3),
        margin:v.margin?numOf(v.margin):undefined, features:[], groups:[], photo:null, logo:null, prices:[], updatedAt:new Date().toISOString(), pageTitle:name, photoCaption:'' };
      if (!CUR_LIST.includes(x.costCur)) x.costCur='RUB';
      x.groups=groupsFromAttrs(x); x.hint=autoHint(x); if(!x.spec) x.spec=mainLine(x,4);
      const ex=await fullDoc(catCache.find(z=>z.id===x.id)); if (ex){ x.photo=ex.photo; x.logo=ex.logo; x.prices=ex.prices||[]; if(!x.price) x.price=ex.price||0; if (ex.features&&ex.features.length) x.features=ex.features; }
      await store().put(x); n++;
    }
    await refreshCat(); d.close(); toast(`Импортировано позиций: ${n}${skipped.length?`, пропущено строк без наименования: ${skipped.length}`:''}`);
    openCatalog({cat:t.id});
  };
}
