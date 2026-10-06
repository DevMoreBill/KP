// Редактор шаблона КП: форма строится по editor.json из папки шаблона, настройки сохраняются в template.json.
// Всё оформление документа (цвета, шрифт, стили, надписи, разделы, правила) правится здесь без программирования.
'use strict';

const TE = { id:'', pack:null, form:null, work:null, dirty:false, tab:'', err:'', note:'' };

const FONTS = ['Arial','Calibri','Cambria','Segoe UI','Tahoma','Times New Roman','Verdana','Georgia','PT Sans','PT Serif','Roboto','Open Sans'];
const KIND_NAMES = { template:'Настройки (template.json)', base:'Основа Word (base.docx)', skeleton:'Скелет (skeleton.js)', editor:'Форма редактора (editor.json)' };

const getPath = (o, k) => String(k).split('.').reduce((a, p) => a == null ? a : a[p], o);
function setPath(o, k, v){ const ps=String(k).split('.'); let a=o; ps.slice(0,-1).forEach(p=>{ if (a[p]==null || typeof a[p]!=='object') a[p]={}; a=a[p]; }); a[ps[ps.length-1]]=v; }
const hex = v => '#'+String(v||'000000').replace(/^#/,'').padStart(6,'0').slice(0,6);
const colorOf = k => /^[0-9A-Fa-f]{6}$/.test(String(k||'')) ? k : ((TE.work&&TE.work.colors||{})[k] || '000000');

async function openTemplateEditor(id, keepNote){
  id = id || S.template;
  const d=$('#dlg'); d.className='tpled'; d.innerHTML='<div class="dlg-b"><p class="muted">Загружаю шаблон…</p></div>';
  if (!d.open) d.showModal();
  Object.assign(TE, { id, pack:null, form:null, work:null, dirty:false, err:'', note: keepNote ? TE.note : '' });
  dropTemplateCache(id);
  try{
    TE.pack = await templatePack(id);
    const r = await fetch(`/tpl/${encodeURIComponent(id)}/editor.json`, {cache:'no-store'});
    TE.form = r.ok ? await r.json() : {tabs:[]};
    TE.work = KPGen.deepMerge(TE.pack.skel.defaults, TE.pack.json);
    TE.work.sections = normSections(TE.work.sections, TE.pack.skel.defaults.sections);
  }catch(e){ TE.err = e.message || String(e); TE.form = {tabs:[{id:'files', title:'Файлы шаблона', fields:[{type:'files'}]}]}; }
  if (!TE.form.tabs || !TE.form.tabs.length) TE.form.tabs=[{id:'files', title:'Файлы шаблона', fields:[{type:'files'}]}];
  if (!TE.form.tabs.some(t=>t.id===TE.tab)) TE.tab = TE.err ? 'files' : TE.form.tabs[0].id;
  renderTE();
}

function normSections(list, defs){
  const given=(Array.isArray(list)?list:[]).filter(s=>s && defs.some(d=>d.id===s.id));
  return given.map(s=>Object.assign({}, defs.find(d=>d.id===s.id), s)).concat(defs.filter(d=>!given.some(s=>s.id===d.id)).map(d=>Object.assign({}, d)));
}

function renderTE(){
  const d=$('#dlg'), tabs=TE.form.tabs, tab=tabs.find(t=>t.id===TE.tab)||tabs[0];
  const list=TEMPLATES;
  d.innerHTML=`<div class="dlg-h"><h3>Шаблон КП</h3>
      <select class="te-pick" aria-label="Шаблон">${list.map(t=>`<option value="${esc(t.id)}"${t.id===TE.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select>
      <button class="btn" type="button" data-te="preview" ${TE.err?'disabled':''} title="Собрать .docx по текущему КП с этими настройками — без номера и записи в журнал">Пробный DOCX</button>
      <button class="btn primary" type="button" data-te="save" ${TE.err?'disabled':''}>Сохранить</button>
      <button class="icon" type="button" data-te="close" aria-label="Закрыть">✕</button></div>
    ${TE.err?`<p class="msg err te-err">Шаблон не загружается: ${esc(TE.err)}. Верните рабочую версию из истории или заводской вариант.</p>`:''}
    <div class="te-wrap"><nav class="te-nav">${tabs.map(t=>`<button type="button" data-tab="${esc(t.id)}" class="${t.id===tab.id?'on':''}">${esc(t.title)}</button>`).join('')}</nav>
      <div class="te-body" id="teBody">${tab.intro?`<p class="muted te-intro">${esc(tab.intro)}</p>`:''}${(tab.fields||[]).map(fieldHTML).join('')}</div></div>
    <div class="te-foot"><span id="teState" class="${TE.dirty?'warn':TE.note?'okn':'muted'}">${esc(TE.dirty?'Есть несохранённые изменения':TE.note||'Изменений нет')}</span>
      <span class="muted">Папка шаблона: templates/${esc(TE.id)}</span></div>`;
  if (tab.fields && tab.fields.some(f=>f.type==='files')) loadHistory();
}

// сообщение в строке состояния окна (всплывающие уведомления окно перекрывает)
function teNote(t){ TE.note=t; const s=$('#teState'); if (s){ s.textContent=t; s.className=TE.dirty?'warn':'okn'; } else toast(t); }

function markDirty(){ TE.dirty=true; TE.note=''; const s=$('#teState'); if (s){ s.textContent='Есть несохранённые изменения'; s.className='warn'; } }

// ---------------------------------------------------------------- поля формы
function fieldHTML(f){
  const v = f.key ? getPath(TE.work||{}, f.key) : undefined, k=esc(f.key||'');
  const lab = f.label?`<span>${esc(f.label)}</span>`:'', hint = f.hint?`<small class="muted">${esc(f.hint)}</small>`:'';
  switch (f.type){
    case 'group': return `<h4 class="te-group">${esc(f.title||'')}</h4>`;
    case 'text': return `<label class="f te-f">${lab}<input type="text" data-k="${k}" value="${esc(v??'')}" placeholder="${esc(f.placeholder||'')}">${hint}</label>`;
    case 'font': return `<label class="f te-f">${lab}<input type="text" data-k="${k}" list="teFonts" value="${esc(v??'')}"><datalist id="teFonts">${FONTS.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>${hint}</label>`;
    case 'textarea': return `<label class="f te-f">${lab}<textarea data-k="${k}" rows="${f.rows||3}">${esc(v??'')}</textarea>${hint}</label>`;
    case 'number': return `<label class="f te-f te-num">${lab}<span class="te-inline"><input type="number" data-k="${k}" data-num="1" value="${esc(v??'')}" min="${f.min??''}" max="${f.max??''}" step="${f.step??'any'}">${f.unit?`<em>${esc(f.unit)}</em>`:''}</span>${hint}</label>`;
    case 'toggle': return `<div class="te-f te-tog"><button class="sw" type="button" role="switch" aria-checked="${!!v}" data-sw="${k}"><i></i>${esc(f.label||'')}</button>${hint}</div>`;
    case 'select': return `<label class="f te-f">${lab}<select data-k="${k}">${(f.options||[]).map(o=>{ const [val,t]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(val)}"${String(val)===String(v)?' selected':''}>${esc(t)}</option>`; }).join('')}</select>${hint}</label>`;
    case 'color': return `<div class="te-f te-color"><span class="te-lab">${esc(f.label||'')}</span><span class="te-inline"><input type="color" data-color="${k}" value="${hex(v)}"><input type="text" class="te-hex" data-hex="${k}" value="${esc(String(v||'').toUpperCase())}" maxlength="7" spellcheck="false"></span>${hint}</div>`;
    case 'pairs': return pairsHTML(f, v);
    case 'brand': return brandHTML(f, v);
    case 'sections': return sectionsHTML(f, v);
    case 'style': return styleHTML(f, v);
    case 'image': return imageHTML(f, v);
    case 'files': return filesHTML();
    default: return '';
  }
}

function colorOptions(sel){
  const names=(TE.form&&TE.form.colorNames)||{}, keys=Object.keys((TE.work&&TE.work.colors)||{});
  const own = sel && !keys.includes(sel);
  return keys.map(c=>`<option value="${esc(c)}"${c===sel?' selected':''}>${esc(names[c]||c)}</option>`).join('') + (own?`<option value="${esc(sel)}" selected>#${esc(sel)}</option>`:'');
}

function pairsHTML(f, v){
  const rows=Array.isArray(v)?v:[], cols=f.cols||['Заголовок','Текст'];
  return `<div class="te-f"><span class="te-lab">${esc(f.label||'')}</span>
    <div class="te-rows">${rows.map((r,i)=>`<div class="te-pair"><input type="text" data-pair="${esc(f.key)}" data-i="${i}" data-j="0" value="${esc(r[0]||'')}" placeholder="${esc(cols[0])}">
      <textarea data-pair="${esc(f.key)}" data-i="${i}" data-j="1" rows="2" placeholder="${esc(cols[1])}">${esc(r[1]||'')}</textarea>
      <button class="icon" type="button" data-row-del="${esc(f.key)}" data-i="${i}" title="Удалить">✕</button></div>`).join('')}</div>
    ${!f.max||rows.length<f.max?`<button class="btn ghost" type="button" data-row-add="${esc(f.key)}" data-kind="pair">+ Добавить</button>`:''}${f.hint?`<small class="muted">${esc(f.hint)}</small>`:''}</div>`;
}

function brandHTML(f, v){
  const rows=Array.isArray(v)?v:[];
  const prev=rows.map(([t,c])=>`<b style="color:${hex(colorOf(c))}">${esc(t)}</b>`).join('');
  return `<div class="te-f"><span class="te-lab">${esc(f.label||'')} <span class="te-brand" style="font-family:${esc(TE.work.font||'Arial')}">${prev||'—'}</span></span>
    <div class="te-rows">${rows.map((r,i)=>`<div class="te-pair te-brandrow"><input type="text" data-pair="${esc(f.key)}" data-i="${i}" data-j="0" value="${esc(r[0]||'')}" placeholder="Текст">
      <select data-pair="${esc(f.key)}" data-i="${i}" data-j="1">${colorOptions(r[1])}</select>
      <button class="icon" type="button" data-row-del="${esc(f.key)}" data-i="${i}" title="Удалить">✕</button></div>`).join('')}</div>
    <button class="btn ghost" type="button" data-row-add="${esc(f.key)}" data-kind="brand">+ Часть</button>${f.hint?`<small class="muted">${esc(f.hint)}</small>`:''}</div>`;
}

function sectionsHTML(f, v){
  const rows=Array.isArray(v)?v:[], names=f.names||{}, hints=f.hints||{};
  return `<div class="te-f"><span class="te-lab">${esc(f.label||'')}</span><ol class="te-secs">${rows.map((s,i)=>`<li class="${s.on?'':'off'}">
      <span class="te-move"><button class="icon" type="button" data-sec-mv="-1" data-i="${i}" ${i?'':'disabled'} title="Выше">↑</button><button class="icon" type="button" data-sec-mv="1" data-i="${i}" ${i<rows.length-1?'':'disabled'} title="Ниже">↓</button></span>
      <span class="te-secname"><b>${esc(names[s.id]||s.id)}</b>${hints[s.id]?`<small class="muted">${esc(hints[s.id])}</small>`:''}</span>
      ${'newPage' in s && s.id!=='equipment'?`<label class="te-chk"><input type="checkbox" data-sec-np="${i}" ${s.newPage?'checked':''}> с новой страницы</label>`:'<span></span>'}
      <button class="sw" type="button" role="switch" aria-checked="${!!s.on}" data-sec-on="${i}"><i></i>${s.on?'включён':'выключен'}</button></li>`).join('')}</ol></div>`;
}

function styleSample(s, f){
  const c = f.dark ? 'color:#'+colorOf(s.color)+';background:'+hex(colorOf('NAVYD')) : 'color:'+hex(colorOf(s.color));
  return `font-family:'${esc((TE.work.font||'Arial').replace(/'/g,''))}',Arial,sans-serif;font-size:${Math.max(6,+s.size||10)*4/3}px;${c};font-weight:${s.bold?700:400};font-style:${s.italic?'italic':'normal'};text-transform:${s.caps?'uppercase':'none'};letter-spacing:${(+s.spacing||0)*4/3}px`;
}
function styleHTML(f, v){
  const s=v||{}, k=esc(f.key);
  const tg=(p,t,title)=>`<button type="button" class="te-t${s[p]?' on':''}" data-st="${k}" data-prop="${p}" aria-pressed="${!!s[p]}" title="${title}">${t}</button>`;
  return `<div class="te-style"><span class="te-lab">${esc(f.label||'')}</span>
    <span class="te-inline"><input type="number" data-k="${k}.size" data-num="1" value="${esc(s.size??'')}" min="5" max="72" step="0.5" title="Размер, пт"><em>пт</em></span>
    ${f.noColor?'<span class="muted te-nocol">цвет — по фирменному знаку</span>':`<select data-k="${k}.color" title="Цвет">${colorOptions(s.color)}</select>`}
    <span class="te-tgs">${tg('bold','Ж','Жирный')}${tg('italic','<i>К</i>','Курсив')}${tg('caps','АА','Прописные')}</span>
    <span class="te-sample" style="${styleSample(s,f)}">${esc(f.sample||'Образец')}</span></div>`;
}

function imageHTML(f, v){
  const url = v ? `/tpl/${encodeURIComponent(TE.id)}/${encodeURIComponent(v)}?t=${Date.now()}` : '';
  return `<div class="te-f"><span class="te-lab">${esc(f.label||'')}</span>
    <div class="te-img">${v?`<img src="${url}" alt=""><span class="muted">${esc(v)}</span>`:`<span class="muted">${esc(f.empty||'Картинки нет — страница не выводится')}</span>`}</div>
    <div class="row"><label class="btn ghost">Заменить…<input type="file" accept="image/jpeg,image/png" hidden data-img="${esc(f.key)}"></label>${v?`<button class="btn ghost" type="button" data-img-del="${esc(f.key)}">Убрать</button>`:''}</div>
    ${f.hint?`<small class="muted">${esc(f.hint)}</small>`:''}</div>`;
}

function filesHTML(){
  const t=encodeURIComponent(TE.id), info=TEMPLATES.find(x=>x.id===TE.id)||{}, remote=SRV.info&&SRV.info.local===false;
  const card=(file, title, text, openLabel)=>`<div class="te-card"><div><b>${esc(title)}</b> <code>${esc(file)}</code><p class="muted">${text}</p></div>
    <div class="row">${remote?'':`<button class="btn" type="button" data-te-open="${esc(file)}">${esc(openLabel)}</button>`}
      <a class="btn ghost" href="/tpl/${t}/${esc(file)}?download=1">Скачать</a>
      <label class="btn ghost">Заменить…<input type="file" hidden data-te-put="${esc(file)}" accept="${file.endsWith('.docx')?'.docx':file.endsWith('.js')?'.js':'.json'}"></label></div></div>`;
  return `<div class="te-files">
    ${card('base.docx','Основа Word','Шапка страницы (логотип, реквизиты), поля, размер листа, стили Word. '+(TE.pack?esc(pageInfo(TE.pack.sect)):'')+'. Откройте в Word, измените верхний колонтитул или поля (Макет → Поля), сохраните и закройте — программа подхватит изменения при следующем сохранении КП. Ширина таблиц подстраивается под поля автоматически.','Открыть в Word')}
    ${card('skeleton.js','Скелет документа','Раскладка страниц: какие блоки на титуле, странице оборудования, в таблице цен. Нужен, если настроек не хватает (новый блок, другая компоновка). Сохраните прежнюю версию — она останется в истории.','Открыть в Блокноте')}
    ${card('editor.json','Форма редактора','Какие настройки показывать в этом окне, их подписи и подсказки. Добавьте поле — и новая настройка из скелета появится здесь.','Открыть в Блокноте')}
    ${card('template.json','Настройки шаблона','То же, что в этом окне, в виде текста. Правки из Блокнота видны после повторного открытия редактора.','Открыть в Блокноте')}
    <div class="row te-actions">${remote?'':'<button class="btn ghost" type="button" data-te-open="">Открыть папку шаблона</button>'}
      <button class="btn ghost" type="button" data-te="copy">Создать копию шаблона…</button>
      ${info.factory?'<button class="btn ghost" type="button" data-te="reset">Вернуть заводской шаблон</button>':''}
      ${TEMPLATES.length>1?'<button class="btn ghost danger" type="button" data-te="delete">Удалить шаблон</button>':''}</div>
    <h4 class="te-group">История версий</h4><p class="muted">Перед каждым сохранением прежний файл откладывается сюда. «Вернуть» делает выбранную версию текущей (текущая тоже останется в истории).</p>
    <div id="teHist" class="te-hist muted">Загружаю…</div></div>`;
}

async function loadHistory(){
  const el=$('#teHist'); if (!el) return;
  try{ const h=await api(`/api/templates/${encodeURIComponent(TE.id)}/history`);
    el.innerHTML = h.length ? h.map(x=>`<div class="te-hrow"><span>${esc(x.time)}</span><span>${esc(KIND_NAMES[x.kind]||x.kind)}</span><button class="btn ghost" type="button" data-te-restore="${esc(x.name)}">Вернуть</button></div>`).join('') : 'Пока пусто — версии появятся после первого сохранения.';
  }catch(e){ el.textContent='История недоступна: '+e.message; }
}

// ---------------------------------------------------------------- действия
function refreshTab(){ const top=($('#teBody')||{}).scrollTop||0; renderTE(); const b=$('#teBody'); if (b) b.scrollTop=top; }

async function saveTE(){
  const w=JSON.parse(JSON.stringify(TE.work));
  const body=JSON.stringify(w, null, 2);
  await api(`/api/templates/${encodeURIComponent(TE.id)}/file?name=template.json`, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body});
  TE.dirty=false; dropTemplateCache(TE.id); await loadTemplates(); renderForm();
  TE.pack=await templatePack(TE.id); TE.note='Шаблон сохранён. Прежняя версия — в истории (вкладка «Файлы шаблона»).'; renderTE();
}

async function putTemplateFile(name, file){
  await api(`/api/templates/${encodeURIComponent(TE.id)}/file?name=${encodeURIComponent(name)}`, {method:'PUT', body:file});   // с токеном сессии администратора
}

const translit = s => String(s||'').toLowerCase().replace(/[а-яё]/g, ch => ({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'})[ch]||'')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);

async function teAction(a){
  const t=encodeURIComponent(TE.id);
  if (a==='close'){ if (TE.dirty && !confirm('Закрыть без сохранения? Изменения шаблона пропадут.')) return; const d=$('#dlg'); d.close(); d.className=''; return; }
  if (a==='save') return saveTE();
  if (a==='preview'){ teNote('Собираю пробный файл…'); await previewDocx(TE.id, TE.work); teNote('Пробный файл скачан — откройте его из загрузок браузера. Шаблон не изменён, пока не нажмёте «Сохранить».'); return; }
  if (a==='copy'){
    if (TE.dirty && !confirm('Сначала сохраните изменения — копия делается из сохранённого шаблона. Продолжить без них?')) return;
    const name=prompt('Название нового шаблона (например, для другой компании группы):', (TE.work&&TE.work.name||'Шаблон')+' — копия'); if (!name) return;
    let id=translit(name)||'tpl', n=1; const base=id; while (TEMPLATES.some(x=>x.id===id)) id=base+'-'+(++n);
    await api(`/api/templates/${t}/copy?to=${encodeURIComponent(id)}&title=${encodeURIComponent(name)}`, {method:'POST'});
    await loadTemplates(); renderForm(); TE.note='Создан шаблон «'+name+'» (папка templates/'+id+')'; return openTemplateEditor(id, true);
  }
  if (a==='reset'){ if (!confirm('Вернуть заводской вариант шаблона? Текущие файлы останутся в истории версий.')) return;
    await api(`/api/templates/${t}/reset`, {method:'POST'}); await loadTemplates(); renderForm(); TE.note='Заводской шаблон восстановлен, прежние файлы — в истории'; return openTemplateEditor(TE.id, true); }
  if (a==='delete'){ if (!confirm('Удалить шаблон «'+((TE.work&&TE.work.name)||TE.id)+'»? Папка будет перемещена в templates/_deleted.')) return;
    await api(`/api/templates/${t}/delete`, {method:'POST'}); dropTemplateCache(TE.id); await loadTemplates(); renderForm(); TE.note='Шаблон удалён (папка перенесена в templates/_deleted)';
    return openTemplateEditor(S.template, true); }
}

// ---------------------------------------------------------------- события формы
document.addEventListener('input', e=>{
  const el=e.target; if (!el.closest || !el.closest('#dlg.tpled') || !TE.work) return;
  if (el.dataset.k){ let v=el.value; if (el.dataset.num){ v=v===''?'':+v; if (v!=='' && !isFinite(v)) return; } setPath(TE.work, el.dataset.k, v); markDirty();
    if (/^styles\./.test(el.dataset.k) || el.dataset.k==='font') updateSamples(); return; }
  if (el.dataset.hex){ const h=el.value.replace(/^#/,'').toUpperCase(); if (!/^[0-9A-F]{6}$/.test(h)) return; setPath(TE.work, el.dataset.hex, h);
    const c=el.parentNode.querySelector('[data-color]'); if (c) c.value='#'+h; markDirty(); return; }
  if (el.dataset.color){ const h=el.value.replace('#','').toUpperCase(); setPath(TE.work, el.dataset.color, h); const x=el.parentNode.querySelector('[data-hex]'); if (x) x.value=h; markDirty(); return; }
  if (el.dataset.pair && el.tagName!=='SELECT'){ const arr=getPath(TE.work, el.dataset.pair); arr[+el.dataset.i][+el.dataset.j]=el.value; markDirty(); }
});
document.addEventListener('change', async e=>{
  const el=e.target; if (!el.closest || !el.closest('#dlg.tpled')) return;
  try{
    if (el.classList.contains('te-pick')){ if (TE.dirty && !confirm('Перейти к другому шаблону без сохранения изменений?')){ el.value=TE.id; return; } return openTemplateEditor(el.value); }
    if (el.dataset.pair && el.tagName==='SELECT'){ const arr=getPath(TE.work, el.dataset.pair); arr[+el.dataset.i][+el.dataset.j]=el.value; markDirty(); return refreshTab(); }
    if (el.dataset.k && el.tagName==='SELECT'){ updateSamples(); return; }
    if (el.dataset.secNp!=null){ TE.work.sections[+el.dataset.secNp].newPage=el.checked; markDirty(); return; }
    if (el.dataset.img && el.files[0]){ const f=el.files[0], name=el.dataset.img.replace(/Image$/,'').replace(/[^A-Za-z0-9_-]/g,'_')+'.'+(f.type==='image/png'?'png':'jpg');
      await putTemplateFile(name, f); dropTemplateCache(TE.id); TE.pack=await templatePack(TE.id);
      setPath(TE.work, el.dataset.img, name); markDirty(); refreshTab(); return teNote('Картинка загружена — нажмите «Сохранить»'); }
    if (el.dataset.tePut && el.files[0]){ const name=el.dataset.tePut;
      if (name==='template.json' && !confirm('Заменить настройки шаблона содержимым файла? Несохранённые изменения в окне пропадут.')) return;
      await putTemplateFile(name, el.files[0]); await loadTemplates(); renderForm(); TE.note='Файл '+name+' заменён, прежний — в истории'; return openTemplateEditor(TE.id, true); }
  }catch(err){ alert('Не получилось: '+(err.message||err)); }
});
document.addEventListener('click', async e=>{
  const d=$('#dlg'); if (!d || !d.classList.contains('tpled') || !d.contains(e.target)) return;
  const b=e.target.closest('button'); if (!b) return;
  try{
    if (b.dataset.te){ return await teAction(b.dataset.te); }
    if (b.dataset.tab){ TE.tab=b.dataset.tab; return renderTE(); }
    if (b.dataset.sw){ setPath(TE.work, b.dataset.sw, !getPath(TE.work, b.dataset.sw)); markDirty(); b.setAttribute('aria-checked', String(!!getPath(TE.work, b.dataset.sw))); return; }
    if (b.dataset.st){ const s=getPath(TE.work, b.dataset.st)||{}; s[b.dataset.prop]=!s[b.dataset.prop]; setPath(TE.work, b.dataset.st, s); markDirty();
      b.classList.toggle('on', !!s[b.dataset.prop]); b.setAttribute('aria-pressed', String(!!s[b.dataset.prop])); updateSamples(); return; }
    if (b.dataset.secOn!=null){ const s=TE.work.sections[+b.dataset.secOn]; s.on=!s.on; markDirty(); return refreshTab(); }
    if (b.dataset.secMv){ const i=+b.dataset.i, j=i+(+b.dataset.secMv), a=TE.work.sections; [a[i],a[j]]=[a[j],a[i]]; markDirty(); return refreshTab(); }
    if (b.dataset.rowAdd){ const arr=getPath(TE.work, b.dataset.rowAdd)||[]; arr.push(b.dataset.kind==='brand'?['', 'BLUE']:['', '']); setPath(TE.work, b.dataset.rowAdd, arr); markDirty(); return refreshTab(); }
    if (b.dataset.rowDel){ const arr=getPath(TE.work, b.dataset.rowDel); arr.splice(+b.dataset.i,1); markDirty(); return refreshTab(); }
    if (b.dataset.imgDel){ setPath(TE.work, b.dataset.imgDel, ''); markDirty(); return refreshTab(); }
    if (b.dataset.teOpen!=null){ const r=await api(`/api/templates/${encodeURIComponent(TE.id)}/open?name=${encodeURIComponent(b.dataset.teOpen)}`, {method:'POST'});
      if (r && r.remote) teNote('Файлы шаблона открываются на компьютере-сервере отдела — используйте «Скачать» и «Заменить…»');
      else if (b.dataset.teOpen==='base.docx') teNote('Открыто в Word. Сохраните и закройте документ — изменения будут в следующем КП и в «Пробном DOCX».');
      else if (b.dataset.teOpen) teNote('Открыто в Блокноте. После сохранения файла откройте редактор шаблона заново.');
      return; }
    if (b.dataset.teRestore){ if (TE.dirty && !confirm('Несохранённые изменения в окне пропадут. Продолжить?')) return;
      const r=await api(`/api/templates/${encodeURIComponent(TE.id)}/restore?name=${encodeURIComponent(b.dataset.teRestore)}`, {method:'POST'});
      await loadTemplates(); renderForm(); TE.note='Версия возвращена: '+r.file; return openTemplateEditor(TE.id, true); }
  }catch(err){ alert('Не получилось: '+(err.message||err)); }
});
function updateSamples(){
  document.querySelectorAll('#dlg.tpled .te-style').forEach(row=>{
    const inp=row.querySelector('[data-k$=".size"]'); if (!inp) return; const key=inp.dataset.k.replace(/\.size$/,'');
    const f=((TE.form.tabs.find(t=>t.id===TE.tab)||{}).fields||[]).find(x=>x.key===key)||{};
    const sm=row.querySelector('.te-sample'); if (sm) sm.setAttribute('style', styleSample(getPath(TE.work,key)||{}, f));
  });
}
// Esc закрывает окно — с тем же вопросом о несохранённых изменениях
document.addEventListener('DOMContentLoaded', ()=>{ const d=$('#dlg'); if (d) d.addEventListener('cancel', e=>{ if (d.classList.contains('tpled')){ e.preventDefault(); teAction('close'); } }); });
