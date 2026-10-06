// Автозаполнение карточки оборудования с помощью любого ИИ (ChatGPT, Claude, Алиса/YandexGPT, GigaChat, DeepSeek…):
// 1) источник — ссылка на страницу (текст и характеристики скачивает сервер, /api/pagetext), текст паспорта или просто модель;
// 2) «Скопировать запрос и открыть …» — запрос в буфере, сайт ИИ в новой вкладке: вставить и отправить;
// 3) ответ вставляется в поле — сразу разбирается (JSON, даже «неаккуратный»; или строки «параметр: значение»),
//    видно, что заполнится, «Заполнить карточку» — одна кнопка. Тот же порядок — у элемента станции (aiPartDialog).
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

// Копирование в буфер обмена. По сети (http://сервер:порт) браузер не даёт странице navigator.clipboard —
// тогда текст кладётся через событие copy; поле для выделения создаётся внутри открытого окна,
// потому что всё вне модального окна браузер делает неактивным. true — только если текст точно скопирован.
async function copyToClipboard(txt){
  if (navigator.clipboard && window.isSecureContext){ try{ await navigator.clipboard.writeText(txt); return true; }catch(e){} }
  let done=false;
  const onCopy=e=>{ try{ e.clipboardData.setData('text/plain', txt); e.preventDefault(); done=true; }catch(_){} };
  document.addEventListener('copy', onCopy, true);
  const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body;
  const ta=document.createElement('textarea'); ta.value=txt; ta.setAttribute('readonly',''); ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
  host.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); }catch(e){}
  document.removeEventListener('copy', onCopy, true); ta.remove();
  return done;
}

const AI_SITES = [['ChatGPT','https://chatgpt.com/'], ['Claude','https://claude.ai/new'], ['Алиса (YandexGPT)','https://alice.yandex.ru/'],
  ['GigaChat','https://giga.chat/'], ['DeepSeek','https://chat.deepseek.com/']];

// ответ ИИ → объект. Понимает блок ```json, текст вокруг, «умные» кавычки, запятые перед } и ], комментарии //.
// Не JSON — строки «Параметр: значение» / таблица из двух колонок становятся характеристиками.
function aiParse(raw){
  let s=String(raw||'').trim(); if (!s) return null;
  const fence=/```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s); if (fence && fence[1].includes('{')) s=fence[1];
  const a0=s.indexOf('{'), a1=s.lastIndexOf('}');
  if (a0>=0 && a1>a0){
    const body=s.slice(a0,a1+1);
    const tries=[body, body.replace(/[“”„«»]/g,'"').replace(/,\s*([}\]])/g,'$1').replace(/^\s*\/\/.*$/gm,'').replace(/\bNaN\b|\bundefined\b/g,'""')];
    for (const t of tries){ try{ const j=JSON.parse(t); if (j && typeof j==='object' && !Array.isArray(j)) return {kind:'json', j}; }catch(e){} }
    return {kind:'bad', err:'Ответ похож на JSON, но в нём ошибка — попросите ИИ «Повтори ответ строго одним JSON» или скопируйте ответ ещё раз целиком (кнопкой «Копировать» под ответом).'};
  }
  const groups=parseSpecs(s);
  if (groups.length) return {kind:'text', j:{groups}};
  return {kind:'bad', err:'Не нашёл в ответе ни JSON, ни строк «параметр: значение».'};
}

const aiN = (n, a, b, c) => `${n} ${plural(n, a, b, c)}`;
// что заполнится из ответа — коротким списком
function aiSummary(r){
  if (!r) return '';
  if (r.kind==='bad') return `<p class="ai-err">${esc(r.err)}</p>`;
  const j=r.j, L=[];
  if (j.name) L.push(`Наименование: <b>${esc(j.name)}</b>`);
  if (j.spec) L.push(`Строка под названием: ${esc(j.spec)}`);
  if (j.desc) L.push('Описание элемента');
  const nf=(j.features||[]).filter(f=>f&&(f.label||f.text)).length; if (nf) L.push(`Описание: ${aiN(nf,'блок','блока','блоков')}`);
  const rows=(j.groups||[]).reduce((a,g)=>a+((g&&g.rows)||[]).length,0)+((j.rows||[]).length);
  if (rows) L.push(`Характеристики: ${aiN(rows,'строка','строки','строк')}${(j.groups||[]).length>1?` в ${aiN(j.groups.length,'группе','группах','группах')}`:''}`);
  const na=Object.entries(j.attrs||{}).filter(([k,v])=>k!=='cat'&&v!==''&&v!=null).length; if (na) L.push(`Параметры для фильтров каталога: ${na}`);
  if (j.cover && (j.cover.model||j.cover.title)) L.push('Титульный лист');
  if (!L.length) return '<p class="ai-err">В ответе нет данных для карточки.</p>';
  return `<p class="ai-ok">${r.kind==='text'?'Распознана таблица характеристик (без ИИ-формата).':'Ответ распознан.'} Будет заполнено:</p><ul class="ai-list">${L.map(x=>`<li>${x}</li>`).join('')}</ul>`;
}

function aiSitesHtml(act, i, extra){
  return `<div class="ai-sites"><button class="btn primary" type="button" data-a="${act}" data-i="${i}"${extra||''}>Скопировать запрос</button>
    ${AI_SITES.map(([n,u])=>`<button class="chip" type="button" data-a="${act}" data-i="${i}" data-url="${esc(u)}"${extra||''} title="Скопировать запрос и открыть ${esc(n)} в новой вкладке">${esc(n)} ↗</button>`).join('')}</div>`;
}

// копирование и открытие сайта ИИ в одном нажатии: копирование стартует до открытия вкладки (иначе браузер его не даст)
function aiSend(txt, url, done){
  const p=copyToClipboard(txt);
  if (url) window.open(url, '_blank', 'noopener');
  p.then(ok=>{ done(ok);
    if (!ok){ const d=$('#dlg'); d.innerHTML=`<div class="dlg-h"><h3>Запрос для ИИ</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div><div class="dlg-b"><p class="muted" style="margin-top:0">Скопировать автоматически не вышло. Выделите текст (Ctrl+A), скопируйте (Ctrl+C) и вставьте в окно ИИ.</p><textarea rows="14" readonly>${esc(txt)}</textarea></div>`;
      if (!d.open) d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close(); const t=d.querySelector('textarea'); t.focus(); t.select(); } });
}

function aiCopy(i, url){
  const it=S.items[i];
  if (!String(it._src||'').trim() && !String(it.name||'').trim()){ it._aiMsg='Сначала шаг 1: ссылка, текст или хотя бы модель.'; return renderForm(); }
  aiSend(aiPrompt(it), url, ok=>{ it._aiMsg = ok ? `Запрос скопирован${url?' — вставьте его (Ctrl+V) в открывшемся окне ИИ и отправьте':' — вставьте его в любой ИИ'}. Ответ скопируйте целиком и вставьте в шаг 3.` : 'Скопируйте запрос из окна.'; it._aiStep=3; renderForm(); persist(); });
}

// текст и характеристики со страницы товара по ссылке → it._src, it._srcProps (и наименование, если пусто)
async function aiFetchInto(it){
  const url=String(it._srcUrl||'').trim();
  if (!/^https?:\/\/./.test(url)){ it._aiMsg='Вставьте ссылку на страницу товара (начинается с http).'; return false; }
  let r; try{ r=await api('/api/pagetext', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})}); }
  catch(e){ it._aiMsg=String(e.message||e)+'. Откройте страницу сами, выделите текст (Ctrl+A), скопируйте и вставьте в поле ниже.'; return false; }
  const props=(r.props||[]).filter(p=>p[0]&&p[1]);
  it._src=[`Страница: ${url}`, r.title?`Название: ${r.title}`:'', r.text||'', props.length?'Характеристики:\n'+props.map(p=>`${p[0]}: ${p[1]}`).join('\n'):''].filter(Boolean).join('\n\n');
  it._srcProps=props; if (!it.pageUrl && !(it.feed&&it.feed.url)) it.pageUrl=url;
  if (!String(it.name||'').trim() && r.title) it.name=r.title.slice(0,200);
  it._aiMsg=`Текст страницы загружен${props.length?`, характеристик: ${props.length}`:''}. Дальше — шаг 2: отправьте запрос в ИИ.`; it._aiStep=2;
  return true;
}
async function aiFetch(i){
  const it=S.items[i]; it._aiMsg='Загружаю страницу…'; renderForm();
  await aiFetchInto(it); renderForm(); persist();
}

// характеристики со страницы — сразу в таблицу, без ИИ
function aiProps(i){
  const it=S.items[i], P=it._srcProps||[]; if (!P.length) return;
  const g={name:'Основные', rows:P.map(([k,v])=>({k, v, hl:false}))};
  const has=(it.groups||[]).some(x=>(x.rows||[]).some(r=>r.k||r.v));
  if (has && !confirm('Заменить текущую таблицу характеристик характеристиками со страницы?')) return;
  it.groups=[g]; it.page=true; it._aiMsg=`В характеристики перенесено строк: ${P.length}. Описание и параметры — через ИИ (шаг 2) или вручную.`;
  renderForm(); persist(); toast('Характеристики со страницы перенесены');
}

function aiApply(i){
  const it=S.items[i], r=aiParse(it._ans);
  if (!r || r.kind==='bad'){ it._aiMsg=r?r.err:'Вставьте ответ ИИ в поле шага 3.'; return renderForm(); }
  const j=r.j, keep=!!it._aiKeep, empty=v=>!String(v||'').trim();
  const set=(k,v)=>{ if (v && (!keep || empty(it[k]))) it[k]=String(v); };
  set('name', j.name); set('spec', j.spec); set('pageTitle', j.pageTitle); set('photoCaption', j.photoCaption);
  const feats=(j.features||[]).filter(f=>f&&(f.label||f.text)).map(f=>({id:uid(), label:String(f.label||''), text:String(f.text||'')}));
  if (feats.length && (!keep || !(it.features||[]).some(f=>f.text))) it.features=feats;
  const groups=(j.groups||[]).filter(g=>g&&Array.isArray(g.rows)).map(g=>({name:String(g.name||''), rows:g.rows.filter(x=>x&&(x.k||x.v)).map(x=>({k:String(x.k||''), v:String(x.v??''), hl:!!x.hl}))})).filter(g=>g.rows.length);
  if (groups.length && (!keep || !(it.groups||[]).some(g=>(g.rows||[]).some(x=>x.v)))) it.groups=groups;
  if (j.cover && typeof j.cover==='object' && !CATED){ it.hint=j.cover; if (!S.cover.touched || !S.cover.model) applyCover(j.cover,false); }
  if (j.attrs && typeof j.attrs==='object'){
    const keepCat=(it.attrs||{}).cat, add=Object.fromEntries(Object.entries(j.attrs).filter(([,v])=>v!==''&&v!=null&&!String(v).includes(' | ')).map(([k,v])=>[k,String(v)]));
    it.attrs=keep ? {...add, ...Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null))} : {...(it.attrs||{}), ...add};
    if (keepCat && (typeById(keepCat).station || !TYPES.some(t=>t.id===it.attrs.cat))) it.attrs.cat=keepCat;   // станцию ИИ не переклассифицирует
    else if (!TYPES.some(t=>t.id===it.attrs.cat)) delete it.attrs.cat;
    const t=typeById(it.attrs.cat||keepCat); for (const f of t.fields) if (f.num && it.attrs[f.key]!=null){ const n=numOf(it.attrs[f.key]); it.attrs[f.key]=n!=null?n:it.attrs[f.key]; }
  }
  if (feats.length || groups.length) it.page=true;
  it._ans=''; it._aiStep=0; it._aiMsg='Карточка заполнена — проверьте вкладки «Основное», «Описание и фото», «Характеристики».';
  renderForm(); persist(); toast('Карточка заполнена из ответа ИИ');
}

// поля категории для запроса
function aiFields(t){ return t.fields.map(f=>`"${f.key}":"${f.label}${f.unit?', '+f.unit:''}${f.values&&f.values.length?' — одно из: '+f.values.join(' | '):''}${f.num?' (только число)':''}"`).join(','); }

function aiPrompt(it){
  const t=typeById(attrsOf(it).cat), st=t.station, parts=kitParts(it).filter(p=>p.name);
  const types=TYPES.filter(x=>!x.station).map(x=>`${x.id} — ${x.name}`).join('; ');
  return `Ты — инженер, готовишь технико-коммерческое предложение на русском языке.
Оборудование: ${t.item||t.name}${it.name?` — «${it.name}»`:''}.${st&&parts.length?`\nЭто ${t.item.toLowerCase()} в контейнере, в составе: ${parts.map(p=>p.name+(+p.qty>1?' × '+p.qty:'')).join('; ')}.`:''}
Задача: разнести исходные данные по полям. Бери ТОЛЬКО факты из исходных данных (и из приложенных файлов или скриншотов, если они есть). Ничего не придумывай: нет данных — пустая строка "" или пустой массив []. Значения — с единицами измерения, десятичный разделитель — запятая.

Ответ — строго один JSON-объект в блоке кода, без пояснений до и после:
\`\`\`json
{"name":"полное наименование, например «${t.item} …»",
"spec":"ключевые характеристики одной строкой через « · », до 90 символов",
"pageTitle":"заголовок страницы оборудования",
"features":[{"label":"Узел или особенность","text":"1–2 предложения по существу"}],
"groups":[{"name":"Основные","rows":[{"k":"Параметр, ед.","v":"значение","hl":true}]}],
"cover":{"title":"${t.coverTitle||t.name}","model":"марка и модель","desc":"1–2 предложения для титульного листа","kpis":[{"num":"число","unit":"ед.","cap":"что это"}]},
"attrs":{"cat":"${t.id}","maker":"производитель","series":"серия","model":"модель",${aiFields(t)}}}
\`\`\`
Правила: features — 2–4 блока об основных узлах и особенностях${st?' (для станции — о контейнере, основном оборудовании и системах)':''}; groups — все характеристики, сгруппированные по смыслу; hl=true — только у 2–4 главных параметров; kpis — ровно 4 главных числовых параметра; в attrs числовые поля — только число без единиц.${st?'':` Если оборудование другого типа, укажи attrs.cat из списка: ${types}.`}

ИСХОДНЫЕ ДАННЫЕ:
${String(it._src||'').trim()||'(только наименование выше — найди данные производителя по этой модели; если не уверен в значении — оставь пустым)'}`;
}

// ---------- окно «Заполнить с ИИ» для элемента станции (описание и характеристики элемента)
function aiPartPrompt(it, p){
  return `Ты — инженер, готовишь технико-коммерческое предложение на русском языке.
Элемент ${typeById(attrsOf(it).cat).item.toLowerCase()}${it.name?` «${it.name}»`:''}: «${p.name||'элемент'}».
Составь техническое описание элемента и таблицу его характеристик. Бери ТОЛЬКО факты из исходных данных (и приложенных файлов), ничего не придумывай; нет данных — пустая строка. Значения — с единицами измерения, десятичный разделитель — запятая.
Ответ — строго один JSON-объект в блоке кода, без пояснений:
\`\`\`json
{"name":"наименование элемента","desc":"назначение, конструкция, комплектация — 2–5 предложений","maker":"производитель","model":"модель","rows":[{"k":"Параметр, ед.","v":"значение"}]}
\`\`\`
ИСХОДНЫЕ ДАННЫЕ:
${String(p._src||'').trim()||'(только наименование — найди данные производителя; если не уверен — оставь пустым)'}`;
}

function aiPartDialog(i, j){
  const it=S.items[i], p=kitParts(it)[j]; if (!p) return;
  const d=$('#dlg'); d.classList.add('wide');
  const draw=()=>{ const r=aiParse(p._ans);
    d.innerHTML=`<div class="dlg-h"><h3>Заполнить с ИИ: ${esc(p.name||'элемент')}</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b ai3"><ol class="ai-steps">
      <li><b>Что известно об элементе</b><span class="muted">Текст паспорта, коммерческого предложения поставщика, требования заказчика — или просто модель.</span>
        <textarea id="aipSrc" rows="5" placeholder="Например: контейнер 40 футов HC, утепление 100 мм, ворота 2,4 × 2,5 м, отопление 2 × 3 кВт">${esc(p._src||'')}</textarea></li>
      <li><b>Отправьте запрос в любой ИИ</b><span class="muted">Кнопка с названием копирует запрос и открывает сайт — вставьте (Ctrl+V) и отправьте. Можно приложить PDF или скриншот.</span>${aiSitesHtml('aiPartCopy', i, ` data-j="${j}"`)}</li>
      <li><b>Вставьте ответ ИИ</b><textarea id="aipAns" rows="5" placeholder="Скопируйте ответ целиком и вставьте сюда (Ctrl+V)">${esc(p._ans||'')}</textarea>
        <div class="ai-prev" id="aipPrev">${aiSummary(r)}</div>
        <div class="row"><button class="btn primary" type="button" id="aipOk" ${r&&r.kind!=='bad'?'':'disabled'}>Заполнить элемент</button></div></li></ol></div>`;
    d.querySelector('[data-close]').onclick=()=>d.close();
    $('#aipSrc').oninput=e=>{ p._src=e.target.value; };
    $('#aipAns').oninput=e=>{ p._ans=e.target.value; const r2=aiParse(p._ans); $('#aipPrev').innerHTML=aiSummary(r2); $('#aipOk').disabled=!(r2&&r2.kind!=='bad'); };
    $('#aipOk').onclick=()=>{ const r2=aiParse(p._ans); if (!r2||r2.kind==='bad') return; const jj=r2.j;
      if (jj.name && !String(p.name||'').trim()) p.name=String(jj.name);
      if (jj.desc) p.desc=String(jj.desc);
      const rows=(jj.rows||[]).concat(...(jj.groups||[]).map(g=>g.rows||[])).filter(x=>x&&x.k&&x.v).map(x=>({k:String(x.k), v:String(x.v)}));
      if (rows.length) p.rows=rows;
      if (jj.maker || jj.model){ p.attrs={...(p.attrs||{}), ...(jj.maker?{maker:String(jj.maker)}:{}), ...(jj.model?{model:String(jj.model)}:{})}; if (jj.maker && !p.sup) p.sup=String(jj.maker); }
      delete p._ans; d.close(); renderForm(); persist(); toast('Элемент заполнен из ответа ИИ'); };
  };
  draw(); if (!d.open) d.showModal();
}

function aiPartCopy(i, j, url){
  const it=S.items[i], p=kitParts(it)[j]; if (!p) return;
  aiSend(aiPartPrompt(it, p), url, ok=>{ if (ok) toast(url?'Запрос скопирован — вставьте его в окне ИИ (Ctrl+V)':'Запрос скопирован'); });
}

// шаг 3 вкладки «Заполнить с ИИ»: ответ разбирается при вставке, без перерисовки окна
document.addEventListener('input', e=>{ const t=e.target; if (t.dataset.aians==null) return;
  const i=+t.dataset.aians, r=aiParse(t.value), pv=document.querySelector(`[data-aiprev="${i}"]`), ok=document.querySelector(`[data-aiok="${i}"]`);
  if (pv) pv.innerHTML=aiSummary(r); if (ok) ok.disabled=!(r&&r.kind!=='bad'); });
