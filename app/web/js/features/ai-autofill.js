// Автозаполнение карточки оборудования с помощью любого ИИ (ChatGPT, Claude, Алиса/YandexGPT, GigaChat, DeepSeek…), класс AiFill:
// 1) источник — ссылка на страницу (текст и характеристики скачивает сервер, /api/pagetext), текст паспорта или просто модель;
// 2) «Скопировать запрос и открыть …» — запрос в буфере, сайт ИИ в новой вкладке: вставить и отправить;
// 3) ответ вставляется в поле — сразу разбирается (JSON, даже «неаккуратный»; или строки «параметр: значение»),
//    видно, что заполнится, «Заполнить карточку» — одна кнопка. Тот же порядок — у элемента станции (aiPartDialog).
'use strict';

// автозаполнение нейросетью — группа «Автозаполнение» в «Настройки → Значения программы → Каталог, фото, фиды, ИИ»
DefRegistry.add([], [
  ['ai.supplement', 'ai', 'Дополнять карточку вторым запросом', 'bool', true,
    {hint:'Включено — если после ответа нейросети описания или ключевых характеристик меньше, чем обычно у карточек этой категории в каталоге, программа сама задаёт второй запрос «дополнить» (только достоверные данные с указанием источника). Выключено — один запрос: быстрее и дешевле, недостающее менеджер дополняет кнопкой «Скопировать запрос „дополнить“».'}],
  ['ai.keyShare', 'ai', 'Характеристика «обязательная» для категории, если есть у', 'num', '50', {unit:'% карточек', req:true, min:10, max:100,
    hint:'Нейросеть просят заполнить все характеристики, которые есть у такой доли карточек этой категории в каталоге (например, «Точка росы» у осушителей). 50 % — у половины карточек и больше. Меньше — длиннее список обязательных характеристик, больше — только самые общие.'}],
  ['ai.fileChars', 'ai', 'Текст из файла паспорта — не больше', 'num', '60000', {unit:'знаков', req:true, min:5000, max:500000,
    hint:'Сколько знаков текста из загруженного файла (PDF, Word, Excel) передаётся нейросети как исходные данные. Остальное отбрасывается. Больше — нейросеть видит весь каталог производителя, но запрос дольше и дороже, а у некоторых нейросетей есть предел длины запроса. 60 000 знаков — примерно 30 страниц.'}],
  ['ai.specLen', 'ai', 'Строка ключевых характеристик — до', 'num', '90', {unit:'символов', req:true, min:40, max:300,
    hint:'Сколько символов просить у нейросети для строки под названием позиции (например, «37 кВт · 7 бар · 6,2 м³/мин»). Короче — строка не переносится в КП и списке каталога.'}],
]);

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
    cells=cells.map(s=>s.trim()).filter((s,ix)=>ix<2||s);
    if (cells.filter(Boolean).length===1){ g={name:cells.find(Boolean),rows:[]}; groups.push(g); return; }
    if(!g){ g={name:'',rows:[]}; groups.push(g); }
    g.rows.push({k:cells[0],v:cells.slice(1).filter(Boolean).join(' ')});
  });
  return groups.filter(x=>x.rows.length);
}

// нейросеть прямо в программе (включает администратор: «Настройки → Нейросеть»)
const AI_DIRECT = { enabled:false, provider:'', model:'', busy:{} };
async function aiStatusLoad(){ try{ Object.assign(AI_DIRECT, await api('/api/ai/status')); }catch(e){ AI_DIRECT.enabled=false; } }

// запрос к нейросети через сервер; ответ — в то же поле, что и при ручном способе (видно, что заполнится)
async function aiDirect(prompt){ const r=await api('/api/ai/fill', {method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({prompt})}); return r.text||''; }

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
  const np=(j.parts||[]).filter(p=>p&&p.name).length; if (np) L.push(`Элементы станции: ${np} — новые добавятся в состав`);
  const nc=((j.container&&j.container.rows)||[]).filter(x=>x&&x.k).length; if (nc) L.push(`Требования к контейнеру: ${aiN(nc,'строка','строки','строк')}`);
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

// текст и характеристики со страницы товара по ссылке → it._src, it._srcProps (и наименование, если пусто)
async function aiFetchInto(it){
  const url=String(it._srcUrl||'').trim();
  if (!/^https?:\/\/./.test(url)){ it._aiMsg='Вставьте ссылку на страницу товара (начинается с http).'; return false; }
  let r; try{ r=await api('/api/pagetext', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})}); }
  catch(e){ it._aiMsg=String(e.message||e)+'. Откройте страницу сами, выделите текст (Ctrl+A), скопируйте и вставьте в поле ниже.'; return false; }
  const props=(r.props||[]).filter(p=>p[0]&&p[1]);
  it._src=[`Страница: ${url}`, r.title?`Название: ${r.title}`:'', r.text||'', props.length?'Характеристики:\n'+props.map(p=>`${p[0]}: ${p[1]}`).join('\n'):''].filter(Boolean).join('\n\n');
  it._srcProps=props; it._srcImgs=(r.imgs||[]).slice(0, Math.round(DEFN('img.maxCount', 12))); if (!it.pageUrl && !(it.feed&&it.feed.url)) it.pageUrl=url;
  if (!String(it.name||'').trim() && r.title) it.name=r.title.slice(0,200);
  it._aiMsg=`Со страницы загружено ${(r.text||'').length.toLocaleString('ru-RU')} знаков текста${props.length?` и ${props.length} ${plural(props.length,'характеристика','характеристики','характеристик')}`:''}${it._srcImgs.length?`, найдено фото: ${it._srcImgs.length} — выберите главное ниже`:''}${r.imgsSkipped?` (мелких и пустых картинок пропущено: ${r.imgsSkipped})`:''}. Дальше — шаг 2: ${AI_DIRECT.enabled?'«Заполнить автоматически»':'отправьте запрос в ИИ'}.`; it._aiStep=2;
  return true;
}
async function aiFetch(i){
  const it=S.items[i]; it._aiMsg='Загружаю страницу…'; renderForm();
  await aiFetchInto(it); renderForm(); persist();
}

// текст файла для шага 1: Word (.docx — абзацы и таблицы строками «ячейка | ячейка»), текст (.txt, .csv, .md)
async function aiFileText(f){
  const nm=String(f.name||'').toLowerCase();
  if (/\.docx$/.test(nm)){
    const z=await JSZip.loadAsync(await f.arrayBuffer()), x=await z.file('word/document.xml').async('string');
    const ent=t=>t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
    const para=p=>ent((p.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g)||[]).map(t=>t.startsWith('<w:t')?t.replace(/<[^>]+>/g,''):t==='<w:tab/>'?'\t':'\n').join('')).trim();
    const body=x.slice(x.indexOf('<w:body'));
    const out=[];
    // таблицы — строками, ячейки через «|»; абзацы вне таблиц — как есть
    body.replace(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g, blk=>{
      if (blk.startsWith('<w:tbl>')) (blk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)||[]).forEach(tr=>{
        const cells=(tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g)||[]).map(tc=>(tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[]).map(para).filter(Boolean).join(' ').trim()).filter(Boolean);
        if (cells.length) out.push(cells.join(' | ')); });
      else { const t=para(blk); if (t) out.push(t); }
      return ''; });
    return out.join('\n');
  }
  if (/\.(txt|csv|md|tsv)$/.test(nm) || /^text\//.test(f.type||'')) return await f.text();
  if (/\.pdf$/.test(nm) || f.type==='application/pdf'){
    // текст PDF читает сервер (pdf_text.py); скан без текста — понятная ошибка
    const r=await api('/api/pdftext', {method:'POST', headers:{'Content-Type':'application/pdf'}, body:f});
    return r.text||'';
  }
  throw new Error('Подходят файлы PDF, Word (.docx) и текстовые (.txt)');
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

// Заполнение карточки с ИИ: объём — как у карточек этой категории в каталоге (образец — /api/ai/profile, app/ai_profile.py),
// недостающее описание и ключевые характеристики — вторым запросом «дополнить». Дополнение принимается только с указанием
// источника (исходные данные или опубликованные данные производителя этой модели); приблизительное, повторы и правки
// уже заполненного отбрасываются; всё дополненное показывается списком «проверьте».
class AiFill {
  static ctx = {};                 // образец категории и данные этой же позиции из каталога: ключ — категория|производитель|наименование
  static SRC = /^(исходные данные|производитель|каталог)/i;
  static VAGUE = /≈|~|около|примерно|ориентировочн|уточн|нет данных|н\/д|не указ|неизвестн|зависит от|по запросу|может (быть|отличаться)/i;
  /** доля карточек категории, у которых есть характеристика, чтобы она считалась «ключевой» (ai.keyShare, 50 %) */
  static get KEY_SHARE(){ return DEFN('ai.keyShare', 50)/100; }

  // ---------- образец объёма и данные той же позиции
  static ctxKey(it, cat){ const a=attrsOf(it); return [cat||a.cat||'', a.maker||'', it.name||'', it.catId||''].join('|'); }
  static async context(it, cat){
    const a=attrsOf(it), k=this.ctxKey(it, cat); if (this.ctx[k]) return this.ctx[k];
    const q=new URLSearchParams({cat:cat||a.cat||'', maker:a.maker||'', model:a.model||'', name:it.name||'', id:it.catId||''});
    let r; try{ r=await api('/api/ai/profile?'+q); }catch(e){ r={}; }
    return this.ctx[k]={profile:r.profile||null, facts:r.facts||[]};
  }
  /** для показа запроса без ожидания: образец уже загружен — с ним, иначе загрузить и перерисовать */
  static promptNow(it){ const c=this.ctx[this.ctxKey(it)]; if (!c) this.context(it).then(()=>renderForm()); return this.prompt(it, c||{}); }

  static norm(k){ return String(k||'').replace(/\s*[,(].*$/, '').replace(/ё/g,'е').toLowerCase().replace(/\s+/g,' ').trim(); }
  static keysOf(j){ return new Set([...(j.groups||[]).flatMap(g=>(g&&g.rows)||[]), ...(j.rows||[])].filter(r=>r&&r.k&&String(r.v??'').trim()).map(r=>this.norm(r.k))); }

  /** объём — словами для запроса */
  static volume(p){
    if (!p) return 'features — 3–6 блоков по 2–4 предложения; groups — все характеристики из исходных данных, сгруппированные по смыслу.';
    const keys=p.keys.filter(x=>x.share>=this.KEY_SHARE).map(x=>x.k);
    return `Объём — как у карточек этой категории в каталоге программы (по ${p.cards} карточкам): описание — около ${p.features} ${plural(p.features,'блока','блоков','блоков')} по ~${p.blockChars} знаков (всего ~${p.descChars})${p.labels.length?`, типичные темы блоков: ${p.labels.join('; ')}`:''}; характеристики — около ${p.rows} строк${p.groups>1?` в ${p.groups} группах (${p.groupNames.join('; ')})`:''}.
Характеристики, которые есть у большинства карточек категории, — заполни каждую, для которой есть достоверное значение: ${keys.join('; ')||'—'}.
Если достоверных данных меньше, дай меньше — объём не повод придумывать.`;
  }
  static factsText(facts){
    return (facts||[]).map(f=>`«${f.name}»:\n${f.rows.map(r=>`${r[0]}: ${r[1]}`).join('\n')}${f.text?'\n'+f.text:''}`).join('\n\n');
  }
  static fields(t){ return t.fields.map(f=>`"${f.key}":"${f.label}${f.unit?', '+f.unit:''}${f.values&&f.values.length?' — одно из: '+f.values.join(' | '):''}${f.num?' (только число)':''}"`).join(','); }

  // ---------- основной запрос
  static prompt(it, c={}){
    const t=typeById(attrsOf(it).cat), st=t.station, parts=kitParts(it).filter(p=>p.name), p=c.profile;
    const types=TYPES.filter(x=>!x.station).map(x=>`${x.id} — ${x.name}`).join('; '), facts=this.factsText(c.facts);
    return `Ты — инженер, готовишь технико-коммерческое предложение на русском языке.
Оборудование: ${t.item||t.name}${it.name?` — «${it.name}»`:''}.${st&&parts.length?`\nЭто ${t.item.toLowerCase()} в контейнере, в составе: ${parts.map(x=>x.name+(+x.qty>1?' × '+x.qty:'')).join('; ')}.`:''}
Задача: разнести данные по полям карточки. Источники — исходные данные ниже (и приложенные файлы или скриншоты, если есть) и опубликованные данные производителя ИМЕННО этой модели и исполнения (паспорт, каталог, официальный сайт), в которых ты уверен. Не бери значения у соседних моделей и исполнений, не рассчитывай и не округляй; нет достоверных данных — пустая строка "" или пустой массив []. Значения — с единицами измерения, десятичный разделитель — запятая.

Ответ — строго один JSON-объект в блоке кода, без пояснений до и после:
\`\`\`json
{"name":"полное наименование, например «${t.item} …»",
"spec":"ключевые характеристики одной строкой через « · », до ${Math.round(DEFN('ai.specLen', 90))} символов",
"pageTitle":"заголовок страницы оборудования",
"features":[{"label":"Узел или особенность","text":"2–4 предложения по существу"}],
"groups":[{"name":"Основные","rows":[{"k":"Параметр, ед.","v":"значение","hl":true}]}],
"cover":{"title":"${t.coverTitle||t.name}","model":"марка и модель","desc":"1–2 предложения для титульного листа","kpis":[{"num":"число","unit":"ед.","cap":"что это"}]},
"attrs":{"cat":"${t.id}","maker":"производитель","series":"серия","model":"модель",${this.fields(t)}}${st?`,
"container":{"rows":[{"k":"Раздел — параметр (например «Стены — наружная обшивка»)","v":"требование"}]},
"parts":[{"name":"элемент станции (кроме контейнера), например «Шкаф АВР»","qty":1,"desc":"что требуется","rows":[{"k":"Параметр","v":"значение"}]}]`:''}}
\`\`\`
${this.volume(p)}
Правила:${st?' features — о контейнере, основном оборудовании и системах станции; если исходные данные — техническое задание заказчика: в container — все требования к контейнеру (корпус, обшивка, утепление, окраска, вентиляция, освещение, ОПС, пожаротушение, шум, климат), в parts — все требуемые элементы и опции станции, кроме контейнера и основного оборудования (АВР, подогреватели, глушитель, топливная система, мониторинг и т. п.);':''} groups — характеристики, сгруппированные по смыслу; hl=true — только у 2–4 главных параметров; kpis — ровно 4 главных числовых параметра; в attrs числовые поля — только число без единиц.${st?'':` Если оборудование другого типа, укажи attrs.cat из списка: ${types}.`}

ИСХОДНЫЕ ДАННЫЕ:
${String(it._src||'').trim()||'(только наименование выше — данные производителя по этой модели; не уверен в значении — оставь пустым)'}${facts?`

ДАННЫЕ ЭТОЙ ЖЕ ПОЗИЦИИ ИЗ КАТАЛОГА ПРОГРАММЫ (проверены, можно брать как есть):
${facts}`:''}`;
  }

  // ---------- чего не хватает по сравнению с образцом
  static gaps(j, p){
    if (!j || !p) return null;
    const feats=(j.features||[]).filter(f=>f&&String(f.text||'').trim()), chars=feats.reduce((a,f)=>a+String(f.text).length,0), have=this.keysOf(j);
    const keys=p.keys.filter(x=>x.share>=this.KEY_SHARE && !have.has(this.norm(x.k))).map(x=>x.k);
    const desc=feats.length<Math.max(2, Math.round(p.features*0.7)) || chars<p.descChars*0.5;
    const rows=have.size<p.rows*0.6;
    if (!desc && !rows && !keys.length) return null;
    const labels=p.labels.filter(l=>!feats.some(f=>this.norm(f.label)===this.norm(l)));
    return {desc, rows, keys, labels, feats:feats.length, chars, have:have.size};
  }
  static gapsText(g, max=8){
    const keys=g.keys.length>max ? g.keys.slice(0, max).join(', ')+` и ещё ${g.keys.length-max}` : g.keys.join(', ');
    return [g.desc?`описание (сейчас ${g.feats} ${plural(g.feats,'блок','блока','блоков')}, ~${g.chars} знаков)`:'', g.keys.length?`характеристики: ${keys}`:g.rows?`характеристики (сейчас ${g.have} строк)`:''].filter(Boolean).join('; ');
  }

  // ---------- запрос «дополнить»
  static supplementPrompt(it, j, g, p, c={}){
    const filled=[...this.keysOf(j)].join('; '), labels=(j.features||[]).map(f=>f&&f.label).filter(Boolean).join('; ');
    return `Ты дополняешь карточку оборудования для технико-коммерческого предложения на русском языке: «${j.name||it.name||''}»${(j.attrs&&j.attrs.maker)?`, производитель ${j.attrs.maker}`:''}${(j.attrs&&j.attrs.model)?`, модель ${j.attrs.model}`:''}.
Уже заполнено — НЕ повторяй и НЕ меняй: характеристики: ${filled||'—'}; блоки описания: ${labels||'—'}.
Не хватает (по образцу карточек этой категории в каталоге):
${g.desc?`— описания: нужно около ${p.features} ${plural(p.features,'блока','блоков','блоков')} по ~${p.blockChars} знаков (всего ~${p.descChars}); добавь недостающие блоки${g.labels.length?` (типичные темы: ${g.labels.join('; ')})`:''};\n`:''}${g.keys.length?`— характеристик: ${g.keys.join('; ')};\n`:''}${g.rows&&!g.keys.length?`— характеристик: у карточек категории их около ${p.rows}, сейчас ${g.have};\n`:''}
Источники — только исходные данные ниже и опубликованные данные производителя ИМЕННО этой модели и исполнения (паспорт, каталог, официальный сайт).
Строгие правила:
— добавляй значение, только если уверен, что оно верно для этой модели и исполнения; не бери у соседних моделей, серий и исполнений, не рассчитывай, не округляй;
— не уверен — не добавляй строку или блок вовсе (никаких «нет данных», «около», «уточняйте»);
— описание — только факты об этой модели (конструкция, узлы, комплектация, назначение), без рекламы;
— у каждой строки и каждого блока укажи "src": "исходные данные" или "производитель".
Ответ — строго один JSON-объект в блоке кода:
\`\`\`json
{"add":true,"features":[{"label":"тема","text":"2–4 предложения","src":"производитель"}],"rows":[{"group":"название группы","k":"Параметр, ед.","v":"значение","src":"исходные данные"}]}
\`\`\`
ИСХОДНЫЕ ДАННЫЕ:
${String(it._src||'').trim()||'(только наименование выше)'}${c.facts&&c.facts.length?`\n\nДАННЫЕ ЭТОЙ ЖЕ ПОЗИЦИИ ИЗ КАТАЛОГА ПРОГРАММЫ:\n${this.factsText(c.facts)}`:''}`;
  }

  /** ответ «дополнить» → в основной ответ; только с источником, без приблизительного и без повторов */
  static merge(j, add){
    const out=JSON.parse(JSON.stringify(j)), have=this.keysOf(out), added={rows:[], features:[], skipped:0};
    out.groups=Array.isArray(out.groups)?out.groups:[];
    for (const r of (add.rows||[])){
      const k=String(r&&r.k||'').trim(), v=String(r&&r.v||'').trim();
      if (!k || !v || !this.SRC.test(String(r.src||'')) || this.VAGUE.test(v) || have.has(this.norm(k))){ if (k) added.skipped++; continue; }
      const gn=String(r.group||'').trim()||'Основные';
      let g=out.groups.find(x=>x&&this.norm(x.name)===this.norm(gn)); if (!g){ g={name:gn, rows:[]}; out.groups.push(g); }
      g.rows.push({k, v, hl:false}); have.add(this.norm(k)); added.rows.push(k);
    }
    const labels=new Set((out.features||[]).map(f=>this.norm(f&&f.label)));
    out.features=Array.isArray(out.features)?out.features:[];
    for (const f of (add.features||[])){
      const label=String(f&&f.label||'').trim(), text=String(f&&f.text||'').trim();
      if (!text || text.length<40 || !this.SRC.test(String(f.src||'')) || this.VAGUE.test(text) || (label && labels.has(this.norm(label)))){ if (text) added.skipped++; continue; }
      out.features.push({label, text}); labels.add(this.norm(label)); added.features.push(label||'без названия');
    }
    out.added=added;
    return out;
  }

  // ---------- ответ в поле шага 3: основной или «дополнить» (сливается с сохранённым основным)
  static parse(it, text=it._ans){
    const r=aiParse(text); if (!r || r.kind==='bad' || !r.j.add) return r;
    const base=aiParse(it._ansBase||''); if (!base || base.kind==='bad') return {kind:'bad', err:'Это ответ «дополнить» — сначала нужен основной ответ ИИ.'};
    return {kind:'json', j:this.merge(base.j, r.j)};
  }
  static summary(it, r){
    let h=aiSummary(r); if (!r || r.kind==='bad') return h;
    const a=r.j.added;
    if (a && (a.rows.length || a.features.length)) h+=`<p class="ai-add">Дополнено — проверьте по паспорту: ${[a.features.length?`описание: ${a.features.join(', ')}`:'', a.rows.length?`характеристики: ${a.rows.join(', ')}`:''].filter(Boolean).join('; ')}${a.skipped?` · отброшено неуверенных: ${a.skipped}`:''}.</p>`;
    const c=this.ctx[this.ctxKey(it, r.j.attrs&&r.j.attrs.cat)]||this.ctx[this.ctxKey(it)], g=c&&this.gaps(r.j, c.profile);
    if (g && !AI_DIRECT.busy[it.id]) h+=`<p class="ai-gap">По сравнению с каталогом не хватает: ${esc(this.gapsText(g))}.${AI_DIRECT.enabled && DEF('ai.supplement')!==false?'':` <button class="lnk" type="button" data-a="aiMore" data-i="${S.items.indexOf(it)}">Скопировать запрос «дополнить»</button>`}</p>`;
    return h;
  }

  // ---------- нейросеть в программе: основной запрос, затем «дополнить», если не хватает
  static async auto(i){
    const it=S.items[i]; if (!it || AI_DIRECT.busy[it.id]) return;
    if (!String(it._src||'').trim() && !String(it.name||'').trim()){ it._aiMsg='Сначала шаг 1: ссылка, текст или хотя бы модель в наименовании.'; return renderForm(); }
    AI_DIRECT.busy[it.id]=true; const who=AI_DIRECT.provider||'Нейросеть';
    try{
      if (!String(it._src||'').trim() && /^https?:\/\//.test(it._srcUrl||it.pageUrl||'')){ it._srcUrl=it._srcUrl||it.pageUrl; it._aiMsg='Загружаю страницу товара — это достоверный источник…'; renderForm(); await aiFetchInto(it); }
      it._aiMsg=`${who} заполняет карточку… обычно 20–60 секунд`; renderForm();
      const c=await this.context(it), ans=await aiDirect(this.prompt(it, c)), r=aiParse(ans);
      if (!r || r.kind==='bad'){ it._ans=ans; it._aiStep=3; it._aiMsg=r?r.err:'Пустой ответ — повторите'; return; }
      const cat=(r.j.attrs&&r.j.attrs.cat)||attrsOf(it).cat, c2=await this.context(it, cat), g=this.gaps(r.j, c2.profile);
      let j=r.j;
      if (g && DEF('ai.supplement')!==false){ it._aiMsg=`Не хватает: ${this.gapsText(g)} — ${who} ищет достоверные данные…`; renderForm();
        try{ const add=aiParse(await aiDirect(this.supplementPrompt(it, j, g, c2.profile, c2))); if (add && add.kind!=='bad') j=this.merge(j, add.j); }
        catch(e){ it._aiMsg=String(e.message||e); } }
      it._ans=JSON.stringify(j, null, 1); it._aiStep=3;
      const a=j.added, left=this.gaps(j, c2.profile);
      it._aiMsg=`Ответ получен${a&&(a.rows.length||a.features.length)?`, дополнено: ${a.features.length} ${plural(a.features.length,'блок','блока','блоков')} описания и ${a.rows.length} ${plural(a.rows.length,'характеристика','характеристики','характеристик')}`:''}${left?`. Достоверных данных не нашлось: ${this.gapsText(left)} — оставлено пустым`:''}. Проверьте, что заполнится, и нажмите «Заполнить карточку».`;
    }catch(e){ it._aiMsg=String(e.message||e); }
    finally{ delete AI_DIRECT.busy[it.id]; renderForm(); persist(); }
  }

  // ---------- ИИ-чат в браузере
  static async copy(i, url){
    const it=S.items[i];
    if (!String(it._src||'').trim() && !String(it.name||'').trim()){ it._aiMsg='Сначала шаг 1: ссылка, текст или хотя бы модель.'; return renderForm(); }
    const c=this.ctx[this.ctxKey(it)]||{};       // образец уже загружен при показе вкладки; копирование — сразу (иначе браузер не даст)
    aiSend(this.prompt(it, c), url, ok=>{ it._aiMsg = ok ? `Запрос скопирован${url?' — вставьте его (Ctrl+V) в открывшемся окне ИИ и отправьте':' — вставьте его в любой ИИ'}. Ответ скопируйте целиком и вставьте в шаг 3.` : 'Скопируйте запрос из окна.'; it._aiStep=3; it._ansBase=''; renderForm(); persist(); });
  }
  static more(i){
    const it=S.items[i], r=aiParse(it._ans); if (!r || r.kind==='bad') return;
    const cat=(r.j.attrs&&r.j.attrs.cat)||attrsOf(it).cat, c=this.ctx[this.ctxKey(it, cat)]||this.ctx[this.ctxKey(it)], g=c&&this.gaps(r.j, c.profile); if (!g) return;
    aiSend(this.supplementPrompt(it, r.j, g, c.profile, c), '', ok=>{ it._ansBase=it._ans; it._ans='';
      it._aiMsg=ok?'Запрос «дополнить» скопирован — отправьте его в том же чате, ответ вставьте в шаг 3: он добавится к основному.':'Скопируйте запрос из окна.'; renderForm(); persist(); });
  }

  // ---------- «Заполнить карточку»
  static apply(i){
    const it=S.items[i], r=this.parse(it);
    if (!r || r.kind==='bad'){ it._aiMsg=r?r.err:'Вставьте ответ ИИ в поле шага 3.'; return renderForm(); }
    const j=r.j, keep=!!(it._aiKeep ?? DEF('ai.keep')), empty=v=>!String(v||'').trim();
    const set=(k,v)=>{ if (v && (!keep || empty(it[k]))) it[k]=String(v); };
    set('name', j.name); set('spec', j.spec); set('pageTitle', j.pageTitle); set('photoCaption', j.photoCaption);
    const feats=(j.features||[]).filter(f=>f&&(f.label||f.text)).map(f=>({id:uid(), label:String(f.label||''), text:String(f.text||'')}));
    if (feats.length && (!keep || !(it.features||[]).some(f=>f.text))) it.features=feats;
    const groups=(j.groups||[]).filter(g=>g&&Array.isArray(g.rows)).map(g=>({name:String(g.name||''), rows:g.rows.filter(x=>x&&(x.k||x.v)).map(x=>({k:String(x.k||''), v:String(x.v??''), hl:!!x.hl}))})).filter(g=>g.rows.length);
    if (groups.length && (!keep || !(it.groups||[]).some(g=>(g.rows||[]).some(x=>x.v)))) it.groups=groups;
    if (j.cover && typeof j.cover==='object' && !CATED){ it.hint=j.cover; coverSync(); }
    if (j.attrs && typeof j.attrs==='object') this.applyAttrs(it, j.attrs, keep);
    if (typeById(attrsOf(it).cat).station) this.applyStation(it, j);
    if (feats.length || groups.length) it.page=true;
    const a=j.added;
    it._ans=''; it._ansBase=''; it._aiStep=0;
    it._aiMsg=`Карточка заполнена — проверьте вкладки «Основное», «Описание и фото», «Характеристики».${a&&(a.rows.length||a.features.length)?' Дополненное ИИ сверьте с паспортом: '+[...a.features, ...a.rows].join(', ')+'.':''}`;
    renderForm(); persist(); toast('Карточка заполнена из ответа ИИ');
  }
  static applyAttrs(it, attrs, keep){
    const keepCat=(it.attrs||{}).cat, add=Object.fromEntries(Object.entries(attrs).filter(([,v])=>v!==''&&v!=null&&!String(v).includes(' | ')).map(([k,v])=>[k,String(v)]));
    it.attrs=keep ? {...add, ...Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null))} : {...(it.attrs||{}), ...add};
    if (keepCat && (typeById(keepCat).station || !TYPES.some(t=>t.id===it.attrs.cat))) it.attrs.cat=keepCat;   // станцию ИИ не переклассифицирует
    else if (!TYPES.some(t=>t.id===it.attrs.cat)) delete it.attrs.cat;
    const t=typeById(it.attrs.cat||keepCat); for (const f of t.fields) if (f.num && it.attrs[f.key]!=null){ const n=numOf(it.attrs[f.key]); it.attrs[f.key]=n!=null?n:it.attrs[f.key]; }
  }
  /** станция по ТЗ: требования к контейнеру — в его характеристики, недостающие элементы — в состав */
  static applyStation(it, j){
    it.kit=it.kit||{parts:[]}; const P=it.kit.parts, have=new Set(P.map(p=>norm(p.name)));
    const crow=((j.container&&j.container.rows)||[]).filter(x=>x&&x.k&&x.v).map(x=>({k:String(x.k), v:String(x.v)}));
    if (crow.length){ let c=P.find(p=>p.role==='container'); if (!c){ c=kitNewContainer('welded'); P.push(c); }
      for (const r of crow){ const o=c.rows.find(z=>norm(z.k)===norm(r.k)); if (o) o.v=r.v; else c.rows.push(r); } }
    for (const p of (j.parts||[])){ if (!p || !String(p.name||'').trim() || have.has(norm(p.name))) continue; have.add(norm(p.name));
      P.push(kitNewPart({name:String(p.name).trim(), qty:+p.qty>0?+p.qty:1, desc:String(p.desc||''), rows:(p.rows||[]).filter(x=>x&&x.k&&x.v).map(x=>({k:String(x.k), v:String(x.v)}))})); }
    stationFill(it);
  }
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
      <li><b>${AI_DIRECT.enabled?'Заполните автоматически':'Отправьте запрос в любой ИИ'}</b>${AI_DIRECT.enabled?`<div class="row"><button class="btn primary" type="button" id="aipAuto">✨ Заполнить автоматически — ${esc(AI_DIRECT.provider)}</button><span class="muted" id="aipSt"></span></div>
        <details class="ai-pr"><summary>или через ИИ-чат в браузере</summary>${aiSitesHtml('aiPartCopy', i, ` data-j="${j}"`)}</details>`
        :`<span class="muted">Кнопка с названием копирует запрос и открывает сайт — вставьте (Ctrl+V) и отправьте. Можно приложить PDF или скриншот.</span>${aiSitesHtml('aiPartCopy', i, ` data-j="${j}"`)}`}</li>
      <li><b>Вставьте ответ ИИ</b><textarea id="aipAns" rows="5" placeholder="Скопируйте ответ целиком и вставьте сюда (Ctrl+V)">${esc(p._ans||'')}</textarea>
        <div class="ai-prev" id="aipPrev">${aiSummary(r)}</div>
        <div class="row"><button class="btn primary" type="button" id="aipOk" ${r&&r.kind!=='bad'?'':'disabled'}>Заполнить элемент</button></div></li></ol></div>`;
    d.querySelector('[data-close]').onclick=()=>d.close();
    $('#aipSrc').oninput=e=>{ p._src=e.target.value; };
    if ($('#aipAuto')) $('#aipAuto').onclick=async e=>{ e.target.disabled=true; $('#aipSt').textContent='Заполняю… обычно 10–30 секунд';
      try{ p._ans=await aiDirect(aiPartPrompt(it, p)); draw(); }catch(x){ e.target.disabled=false; $('#aipSt').textContent=String(x.message||x); } };
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
document.addEventListener('change', async e=>{ const t=e.target; if (t.dataset.aifile==null || !t.files[0]) return;
  const it=S.items[+t.dataset.aifile], f=t.files[0]; t.value='';
  it._aiMsg=`Читаю «${f.name}»…`; renderForm();
  try{ const txt=await aiFileText(f); it._src=`Файл: ${f.name}\n\n`+txt.slice(0, Math.round(DEFN('ai.fileChars', 60000))); it._aiStep=2; it._aiMsg=`Файл «${f.name}» загружен (${txt.length.toLocaleString('ru-RU')} знаков). Дальше — шаг 2.`; }
  catch(x){ it._aiMsg=String(x.message||x); }
  renderForm(); persist(); });

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset.aians==null) return;
  const i=+t.dataset.aians, it=S.items[i], r=it?AiFill.parse(it, t.value):aiParse(t.value), pv=document.querySelector(`[data-aiprev="${i}"]`), ok=document.querySelector(`[data-aiok="${i}"]`);
  if (pv) pv.innerHTML=it?AiFill.summary(it, r):aiSummary(r); if (ok) ok.disabled=!(r&&r.kind!=='bad'); });
