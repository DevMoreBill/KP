// Автозаполнение позиции через Claude: запрос, вставка ответа, разбор таблиц.
'use strict';

function openPaste(i){
  const d=$('#dlg');
  d.innerHTML=`<div class="dlg-h"><h3>Вставить характеристики</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
  <div class="dlg-b"><p class="muted" style="margin-top:0">Скопируйте из Excel два столбца: «Параметр» и «Значение». Строка с одним заполненным столбцом станет названием группы. Также подходят строки вида «Параметр: значение».</p>
  <textarea id="pasteArea" rows="12" placeholder="Двигатель&#10;Марка / модель&#9;Cummins / 4BT3.9G2&#10;Рабочий объём&#9;3,9 л"></textarea>
  <div class="row" style="margin-top:12px;justify-content:flex-end"><label class="row muted"><input type="checkbox" id="pasteRepl" checked style="width:auto"> Заменить текущие</label><button class="btn primary" type="button" id="pasteOk">Добавить</button></div></div>`;
  d.showModal();
  d.querySelector('[data-close]').onclick=()=>d.close();
  $('#pasteOk').onclick=()=>{
    const groups=parseSpecs($('#pasteArea').value); if(!groups.length) return toast('Не нашёл строк с параметрами');
    const it=S.items[i]; it.groups = $('#pasteRepl').checked ? groups : it.groups.concat(groups); d.close(); renderForm(); persist(); toast(`Добавлено строк: ${groups.reduce((a,g)=>a+g.rows.length,0)}`);
  };
}

function parseSpecs(txt){
  const groups=[]; let g=null;
  txt.split(/\r?\n/).forEach(l=>{
    if(!l.trim()) return;
    let cells = l.includes('\t') ? l.split('\t') : (l.includes(':') ? [l.slice(0,l.indexOf(':')), l.slice(l.indexOf(':')+1)] : [l]);
    cells=cells.map(s=>s.trim()).filter((s,ix,a)=>ix<2||s);
    if (cells.filter(Boolean).length===1){ g={name:cells.find(Boolean),rows:[]}; groups.push(g); return; }
    if(!g){ g={name:'',rows:[]}; groups.push(g); }
    g.rows.push({k:cells[0],v:cells.slice(1).filter(Boolean).join(' ')});
  });
  return groups.filter(x=>x.rows.length);
}

async function aiCopy(i){
  const it=S.items[i], txt=aiPrompt(it);
  let ok=false;
  try{ await navigator.clipboard.writeText(txt); ok=true; }catch(e){
    const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
    try{ ok=document.execCommand('copy'); }catch(e2){} ta.remove(); }
  it._aiMsg = ok ? 'Запрос скопирован — вставьте его в Claude.' : 'Не удалось скопировать автоматически.';
  if (!ok){ const d=$('#dlg'); d.innerHTML=`<div class="dlg-h"><h3>Запрос для Claude</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div><div class="dlg-b"><p class="muted" style="margin-top:0">Выделите текст (Ctrl+A) и скопируйте (Ctrl+C).</p><textarea rows="14" readonly>${esc(txt)}</textarea></div>`; d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close(); }
  renderForm(); persist();
}

function aiApply(i){
  const it=S.items[i]; let s=(it._ans||'').trim();
  s=s.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a0=s.indexOf('{'), a1=s.lastIndexOf('}');
  let j; try{ j=JSON.parse(s.slice(a0,a1+1)); }catch(e){ it._aiMsg='Ответ не распознан: вставьте его целиком, начиная с «{».'; renderForm(); return; }
  if (!it.name && j.name) it.name=j.name;
  if (j.spec && !it.spec) it.spec=j.spec;
  if (j.pageTitle) it.pageTitle=j.pageTitle;
  if (j.photoCaption && !it.photoCaption) it.photoCaption=j.photoCaption;
  if (Array.isArray(j.features) && j.features.length) it.features=j.features.map(f=>({label:String(f.label||''),text:String(f.text||'')}));
  if (Array.isArray(j.groups) && j.groups.length) it.groups=j.groups.map(g=>({name:String(g.name||''),rows:(g.rows||[]).map(r=>({k:String(r.k||''),v:String(r.v||''),hl:!!r.hl}))}));
  if (j.cover) { it.hint=j.cover; if (!S.cover.touched || !S.cover.model) applyCover(j.cover,false); }
  if (j.attrs && typeof j.attrs==='object'){ const keepCat=(it.attrs||{}).cat; it.attrs=Object.fromEntries(Object.entries(j.attrs).filter(([k,v])=>v!==''&&v!=null&&!String(v).includes(' | ')));
    if (!TYPES.some(t=>t.id===it.attrs.cat)) { if (keepCat) it.attrs.cat=keepCat; else delete it.attrs.cat; }
    const t=typeById(it.attrs.cat||keepCat); for (const f of t.fields) if (f.num && it.attrs[f.key]!=null){ const n=numOf(it.attrs[f.key]); if(n!=null) it.attrs[f.key]=n; } }
  it._ans=''; it._aiMsg='Готово. Проверьте заполненные поля.';
  renderForm(); persist(); toast('Данные применены');
}

function aiPrompt(it){
  const t=typeById(attrsOf(it).cat);
  const fl=t.fields.map(f=>`"${f.key}":"${f.label}${f.unit?', '+f.unit:''}${f.values&&f.values.length?' — одно из: '+f.values.join(' | '):''}${f.num?' (число)':''}"`).join(',');
  const types=TYPES.map(x=>`${x.id} — ${x.name}`).join('; ');
  return `Помоги составить технико-коммерческое предложение на русском языке. Ниже исходные данные об оборудовании (и, возможно, приложенный скриншот). Тип оборудования: ${t.name}. Разнеси данные по полям. Используй ТОЛЬКО факты из источника, ничего не придумывай; если данных для поля нет — оставь пустую строку или пустой массив. Значения пиши с единицами измерения, десятичный разделитель — запятая.
Ответь строго одним JSON-объектом, без пояснений и без markdown:
{"name":"полное наименование позиции, напр. «${t.item} … »",
"spec":"краткая строка ключевых характеристик через « · » (до 90 символов)",
"pageTitle":"заголовок страницы оборудования",
"photoCaption":"подпись под фото, если понятно исполнение, иначе пусто",
"features":[{"label":"Узел или особенность","text":"одно-два предложения"}],
"groups":[{"name":"Основные","rows":[{"k":"Параметр","v":"значение","hl":true}]}],
"cover":{"title":"${t.coverTitle||t.name}","model":"марка и модель","desc":"1–2 предложения для титула","kpis":[{"num":"число","unit":"ед.","cap":"что это"}]},
"attrs":{"cat":"${t.id}","maker":"производитель","series":"серия","model":"модель",${fl}}}
Правила: features — 2–4 блока об основных узлах. groups — все характеристики, сгруппированные логично. hl=true только у 2–4 главных параметров. kpis — ровно 4 главных числовых параметра. В attrs числовые поля — только число без единиц. Если оборудование другого типа, укажи attrs.cat из списка: ${types}.
${it.name?`Текущее наименование позиции: ${it.name}\n`:''}ИСХОДНЫЕ ДАННЫЕ:
${(it._src||'').trim()||'(см. приложенный скриншот)'}`;
}
