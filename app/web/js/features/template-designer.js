// Графический редактор шаблона КП (только администратор): документ виден как в Word, щелчок по тексту или картинке
// выбирает элемент, справа — его свойства (шрифт, размер, цвет, начертание, надпись; ширина картинки, место, выравнивание).
// Картинки тянутся за уголок, свои картинки шаблона переносятся мышью в начало/конец любого раздела, разделы —
// перетаскиванием в списке. Шапка страницы (логотип, реквизиты), поля листа, палитра — для новой компании без Word.
// Всё хранится в template.json шаблона; «Сохранить как новый…» делает копию папки шаблона под другую компанию.
'use strict';

const TD = { id:'', pack:null, form:null, work:null, saved:'', undo:[], redo:[], sel:null, tab:'struct', z:0, busy:false, again:false, t:0, demo:false, err:'' };
const TD_SEC_NAMES = { cover:'Титульный лист', clients:'Наши клиенты', equipment:'Страницы оборудования', offer:'Коммерческое предложение', conditions:'Условия', contacts:'Контакты' };
const TD_IMG = {   // картинки скелета: правило ширины → подпись и парное правило высоты (рамка масштабируется вместе)
  coverPhotoWidthCm: ['Фото на титуле', 'coverPhotoHeightCm'], equipPhotoWidthCm: ['Главное фото оборудования', 'heroPhotoHeightCm'],
  componentPhotoWidthCm: ['Фото узлов', 'componentPhotoHeightCm'], logoWidthCm: ['Логотип производителя', ''], clientsWidthCm: ['Картинка «Наши клиенты»', ''],
  headerLogo: ['Логотип в шапке', ''] };
const TD_BLOCK_SEC = k => /^cover/.test(k) ? 'cover' : /^(equip|spec)/.test(k) ? 'equipment' : /^(discount|amountInWords|currencyNote)$/.test(k) ? 'offer' : 'all';
const tdCm = v => String(Math.round((+v||0)*100)/100).replace('.', ',');
const tdNum = v => { const n = +String(v??'').replace(',', '.'); return isFinite(n) ? n : NaN; };

function tdDlg(){
  let d = $('#tddlg');
  if (!d){ d = document.createElement('dialog'); d.id = 'tddlg'; d.className = 'tdwin'; d.setAttribute('aria-label', 'Графический редактор шаблона'); document.body.appendChild(d);
    d.addEventListener('cancel', e=>{ e.preventDefault(); tdClose(); }); }
  return d;
}

async function openTemplateDesigner(id){
  if (!ADMIN.on){ toast('Графический редактор шаблона доступен администратору: войдите в «Настройках»'); return; }
  id = id || S.template;
  const d = tdDlg(); d.innerHTML = '<p class="muted td-load">Загружаю шаблон…</p>'; if (!d.open) d.showModal();
  Object.assign(TD, { id, pack:null, form:null, work:null, undo:[], redo:[], sel:null, err:'' });
  dropTemplateCache(id);
  try{
    TD.pack = await templatePack(id);
    const r = await fetch(`/tpl/${encodeURIComponent(id)}/editor.json`, {cache:'no-store'});
    TD.form = r.ok ? await r.json() : {tabs:[]};
    TD.work = KPGen.deepMerge(TD.pack.skel.defaults, TD.pack.json);
    TD.work.sections = normSections(TD.work.sections, TD.pack.skel.defaults.sections);
    if (!TD.work.page || typeof TD.work.page!=='object') TD.work.page = {};
    if (!Array.isArray(TD.work.images)) TD.work.images = [];
  }catch(e){ TD.err = e.message || String(e); }
  TD.saved = JSON.stringify(TD.work);
  const feats = TD.pack && TD.pack.skel.features || [];
  if (!TD.err && !feats.includes('design')) TD.err = 'скелет этого шаблона (skeleton.js) не поддерживает графический редактор — верните заводской скелет или используйте «Настроить» (форму)';
  tdRender(); if (!TD.err) tdPreview(true);
}

// ---------------------------------------------------------------- подписи из формы редактора (editor.json)
function tdFields(type){ return ((TD.form && TD.form.tabs) || []).flatMap(t => t.fields || []).filter(f => !type || f.type===type); }
function tdStyleLabel(k){ if (k==='headerText') return 'Шапка: реквизиты'; const f = tdFields('style').find(x => x.key==='styles.'+k); return f ? f.label : k; }
function tdTextLabel(k){ const f = tdFields().find(x => x.key==='texts.'+k); return f ? f.label : k; }
function tdColorNames(){ return (TD.form && TD.form.colorNames) || {}; }
function tdSecName(id){ const f = tdFields('sections')[0]; return (f && f.names && f.names[id]) || TD_SEC_NAMES[id] || id; }
const tdColorHex = c => /^[0-9A-Fa-f]{6}$/.test(String(c||'')) ? String(c).toUpperCase() : ((TD.work && TD.work.colors || {})[c] || '000000');

// ---------------------------------------------------------------- изменения, отмена/повтор
function tdChange(fn, opts={}){
  const before = JSON.stringify(TD.work);
  fn(TD.work);
  if (JSON.stringify(TD.work) === before) return;
  const last = TD.undo[TD.undo.length-1];
  if (!(opts.merge && last && last.tag===opts.merge && Date.now()-last.at < 1200)) TD.undo.push({ s:before, tag:opts.merge||'', at:Date.now() });
  else last.at = Date.now();
  if (TD.undo.length > 80) TD.undo.shift();
  TD.redo = [];
  if (opts.panels !== false) tdPanels(); else tdTop();
  tdPreview();
}
function tdUndo(back){
  const from = back ? TD.undo : TD.redo, to = back ? TD.redo : TD.undo;
  const x = from.pop(); if (!x) return;
  to.push({ s:JSON.stringify(TD.work), tag:'', at:0 }); TD.work = JSON.parse(x.s);
  tdPanels(); tdPreview();
}
const tdDirty = () => TD.work && JSON.stringify(TD.work) !== TD.saved;

// ---------------------------------------------------------------- окно
function tdRender(){
  const d = tdDlg();
  d.innerHTML = `<div class="td-top" id="tdTop"></div>
    ${TD.err ? `<p class="msg err td-err">Шаблон не открывается в графическом редакторе: ${esc(TD.err)}</p>` : ''}
    <div class="td-main">
      <aside class="td-left"><nav class="td-tabs" role="tablist">${[['struct','Структура'],['look','Оформление'],['head','Шапка'],['imgs','Изображения']].map(([k,t]) =>
        `<button type="button" role="tab" data-tdtab="${k}" aria-selected="${TD.tab===k}">${t}</button>`).join('')}</nav><div class="td-panel" id="tdPanel"></div></aside>
      <div class="td-canvas" id="tdCanvas"><div class="td-pages" id="tdPages"></div><div class="td-sel" id="tdSelBox" hidden><i class="td-grip" title="Потяните, чтобы изменить размер"></i><span class="td-dim"></span></div><div class="td-drop" id="tdDrop" hidden></div></div>
      <aside class="td-right" id="tdInsp"></aside>
    </div>
    <div class="td-foot"><span id="tdState" class="muted"></span><span class="muted">Щелчок по тексту или картинке — свойства справа. Ctrl+Z — отменить. Папка: templates/${esc(TD.id)}</span></div>`;
  tdPanels();
}
function tdTop(){
  const el = $('#tdTop'); if (!el) return;
  // панель строится один раз; дальше меняются только состояния кнопок — иначе щелчок, во время которого
  // поле теряет фокус (и окно обновляется), попадал бы в уже удалённую кнопку
  if (!el.firstChild || el.dataset.id !== TD.id){ el.dataset.id = TD.id;
    el.innerHTML = `<h3>Графический редактор шаблона</h3>
    <select class="td-pick" aria-label="Шаблон">${TEMPLATES.filter(t=>!t.error).map(t=>`<option value="${esc(t.id)}"${t.id===TD.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select>
    <span class="td-grp"><button class="icon" type="button" data-td="undo" title="Отменить (Ctrl+Z)">↶</button><button class="icon" type="button" data-td="redo" title="Повторить (Ctrl+Y)">↷</button></span>
    <span class="td-grp"><button class="icon" type="button" data-td="zout" title="Мельче">−</button><button class="btn ghost td-zv" type="button" data-td="zfit" title="По ширине окна">—</button><button class="icon" type="button" data-td="zin" title="Крупнее">+</button></span>
    <span class="sp"></span>
    <button class="btn ghost" type="button" data-td="form" title="Все настройки шаблона формой: надписи, правила, файлы, история версий">Форма настроек</button>
    <button class="btn" type="button" data-td="docx" ${TD.err?'disabled':''} title="Скачать .docx с этими настройками (без записи в журнал)">Пробный DOCX</button>
    <button class="btn" type="button" data-td="saveas" ${TD.err?'disabled':''} title="Сохранить как отдельный шаблон — например, для другой компании группы">Сохранить как новый…</button>
    <button class="btn primary" type="button" data-td="save">Сохранить</button>
    <button class="icon" type="button" data-td="close" aria-label="Закрыть">✕</button>`; }
  const q = a => el.querySelector(`[data-td="${a}"]`);
  q('undo').disabled = !TD.undo.length; q('redo').disabled = !TD.redo.length; q('save').disabled = !!TD.err || !tdDirty();
  q('zfit').textContent = TD.z ? Math.round(TD.z*100)+'%' : '—';
  const s = $('#tdState'); if (s){ s.textContent = tdDirty() ? 'Есть несохранённые изменения' : (TD.note || 'Изменений нет'); s.className = tdDirty() ? 'warn' : TD.note ? 'okn' : 'muted'; }
}
function tdPanels(){
  tdTop();
  const p = $('#tdPanel'); if (p && TD.work){ const top = p.scrollTop; p.innerHTML = tdPanelHTML(); p.scrollTop = top; }
  document.querySelectorAll('#tddlg [data-tdtab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tdtab===TD.tab)));
  const i = $('#tdInsp'); if (i && TD.work){ const top = i.scrollTop; i.innerHTML = tdInspHTML(); i.scrollTop = top; }
}

// ---------------------------------------------------------------- левая панель
function tdPanelHTML(){
  const W = TD.work;
  if (TD.tab==='struct'){
    const blocks = tdFields('toggle').filter(f => /^blocks\./.test(f.key));
    return `<p class="muted td-hint">Перетащите раздел мышью, чтобы поменять порядок. Щелчок по названию — показать раздел в документе.</p>
      <ol class="td-secs" id="tdSecs">${W.sections.map((s,i)=>`<li draggable="true" data-tdsec="${i}" class="${s.on?'':'off'}${TD.sel&&TD.sel.kind==='sec'&&TD.sel.key===s.id?' on':''}">
        <span class="td-drag" aria-hidden="true">⋮⋮</span><button type="button" class="td-secname" data-tdgo="${esc(s.id)}">${esc(tdSecName(s.id))}</button>
        <button class="sw" type="button" role="switch" aria-checked="${!!s.on}" data-tdsecon="${i}" title="${s.on?'Раздел включён':'Раздел выключен'}"><i></i></button></li>`).join('')}</ol>
      <h4 class="td-h">Блоки внутри разделов</h4>
      ${['cover','equipment','offer','all'].map(sec=>{ const list = blocks.filter(f=>TD_BLOCK_SEC(f.key.slice(7))===sec); return list.length ? `<div class="td-blk"><b>${esc(sec==='all'?'Все страницы':tdSecName(sec))}</b>${list.map(f=>
        `<label class="td-chk"><input type="checkbox" data-tdpath="${esc(f.key)}" ${getPath(W,f.key)?'checked':''}> ${esc(f.label)}</label>`).join('')}</div>` : ''; }).join('')}`;
  }
  if (TD.tab==='look'){
    const m = W.page || {}, info = pageInfo(TD.pack.sect);
    const num = (k, base) => `<label class="td-n"><span>${{top:'Верхнее',bottom:'Нижнее',left:'Левое',right:'Правое'}[k]}</span><input type="number" min="0.5" max="6" step="0.1" data-tdpage="${k}" value="${esc(m[k]??'')}" placeholder="${esc(base)}"></label>`;
    const base = k => { const r = new RegExp(`<w:pgMar[^>]*w:${k}="(\\d+)"`).exec(TD.pack.sect||''); return r ? tdCm(+r[1]/567) : ''; };
    const groups = []; let cur = null;
    for (const t of (TD.form.tabs||[])) if (t.id==='styles') for (const f of t.fields||[]){ if (f.type==='group'){ cur = {title:f.title, list:[]}; groups.push(cur); } else if (f.type==='style'){ if (!cur){ cur={title:'Стили', list:[]}; groups.push(cur); } cur.list.push(f); } }
    return `<h4 class="td-h">Шрифт документа</h4>
      <input type="text" list="tdFonts" data-tdpath="font" value="${esc(W.font||'')}" class="td-font"><datalist id="tdFonts">${FONTS.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <small class="muted">Шрифт должен быть установлен на компьютерах, где открывают КП.</small>
      <h4 class="td-h">Фирменные цвета</h4>
      <div class="td-pal">${Object.keys(W.colors||{}).map(c=>`<label class="td-sw" title="${esc(tdColorNames()[c]||c)}"><input type="color" data-tdcolor="${esc(c)}" value="#${esc(tdColorHex(c))}"><span>${esc(tdColorNames()[c]||c)}</span></label>`).join('')}</div>
      <h4 class="td-h">Фирменный знак</h4>
      <div class="td-brand">${(W.brandParts||[]).map((b,i)=>`<span class="td-bp"><input type="text" data-tdbrand="${i}" value="${esc(b[0]||'')}"><select data-tdbrandc="${i}">${tdColorOpts(b[1])}</select><button class="icon" type="button" data-tdbranddel="${i}" title="Убрать">✕</button></span>`).join('')}
        <button class="btn ghost" type="button" data-td="brandadd">+ Часть</button></div>
      <label class="td-l"><span>Сайт</span><input type="text" data-tdpath="site" value="${esc(W.site||'')}"></label>
      <h4 class="td-h">Поля страницы, см</h4>
      <div class="td-marg">${['top','bottom','left','right'].map(k=>num(k, base(k))).join('')}</div>
      <small class="muted">Пусто — как в основе Word (${esc(info||'base.docx')}).</small>
      <h4 class="td-h">Стили текста</h4><p class="muted td-hint">Или щёлкните текст в документе.</p>
      ${groups.map(g=>`<details class="td-sg"><summary>${esc(g.title)}</summary>${g.list.map(f=>{ const k=f.key.slice(7), s=getPath(W,f.key)||{};
        return `<button type="button" class="td-sty${TD.sel&&TD.sel.kind==='style'&&TD.sel.key===k?' on':''}" data-tdstyle="${esc(k)}"><span style="${tdSample(s,f)}">Аа</span>${esc(f.label)}</button>`; }).join('')}</details>`).join('')}`;
  }
  if (TD.tab==='head'){
    const H = W.header || {}, lg = H.logo;
    return `<p class="muted td-hint">Своя шапка на каждой странице — логотип и реквизиты компании. Включите её для новой компании, чтобы не править base.docx в Word.</p>
      <button class="sw" type="button" role="switch" aria-checked="${!!H.on}" data-tdtog="header.on"><i></i>Шапка из настроек</button>
      <div class="td-hdr${H.on?'':' dis'}">
        <h4 class="td-h">Логотип</h4>
        <div class="td-img1">${lg?`<img src="/tpl/${encodeURIComponent(TD.id)}/${encodeURIComponent(lg)}" alt="">`:'<span class="muted">Нет логотипа</span>'}</div>
        <div class="row"><label class="btn ghost">${lg?'Заменить…':'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="header"></label>${lg?'<button class="btn ghost" type="button" data-td="hdrlogodel">Убрать</button>':''}</div>
        <label class="td-l"><span>Ширина логотипа, см</span><input type="number" min="0.5" max="12" step="0.1" data-tdnum="header.logoWidthCm" value="${esc(H.logoWidthCm??4)}"></label>
        <div class="td-seg"><span>Логотип</span>${[['left','слева'],['right','справа']].map(([v,t])=>`<button type="button" data-tdset="header.logoSide" data-v="${v}" class="${(H.logoSide||'left')===v?'on':''}">${t}</button>`).join('')}</div>
        <h4 class="td-h">Реквизиты</h4>
        <textarea rows="5" data-tdpath="header.lines" placeholder="ООО «Компания»&#10;ИНН 0000000000, г. Москва, ул. …&#10;+7 (000) 000-00-00 · info@site.ru">${esc(H.lines||'')}</textarea>
        <small class="muted">Каждая строка — отдельная строка шапки. Первая может быть крупнее и другим цветом.</small>
        <label class="td-l"><span>Размер текста, пт</span><input type="number" min="5" max="16" step="0.5" data-tdnum="header.textSize" value="${esc(H.textSize??8)}"></label>
        <label class="td-l"><span>Цвет текста</span><select data-tdpath="header.textColor">${tdColorOpts(H.textColor||'GRAY')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.firstBold" ${H.firstBold?'checked':''}> Первая строка жирнее и крупнее</label>
        <label class="td-l"><span>Цвет первой строки</span><select data-tdpath="header.firstColor">${tdColorOpts(H.firstColor||'BLUE')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.rule" ${H.rule!==false?'checked':''}> Линия под шапкой</label>
        <label class="td-l"><span>Цвет линии</span><select data-tdpath="header.ruleColor">${tdColorOpts(H.ruleColor||'LINE')}</select></label>
      </div>`;
  }
  // изображения
  const cl = W.clientsImage;
  return `<h4 class="td-h">Картинка «Наши клиенты»</h4>
    <div class="td-img1">${cl?`<img src="/tpl/${encodeURIComponent(TD.id)}/${encodeURIComponent(cl)}" alt="">`:'<span class="muted">Нет картинки — страница не выводится</span>'}</div>
    <div class="row"><label class="btn ghost">${cl?'Заменить…':'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="clients"></label>${cl?'<button class="btn ghost" type="button" data-td="clientsdel">Убрать</button>':''}</div>
    <label class="td-l"><span>Ширина, см (0 — во всю ширину)</span><input type="number" min="0" max="25" step="0.1" data-tdnum="rules.clientsWidthCm" value="${esc(W.rules.clientsWidthCm??0)}"></label>
    <h4 class="td-h">Свои картинки шаблона</h4>
    <p class="muted td-hint">Баннер, печать, подпись, сертификат… Ставятся в начало или в конец раздела; в документе их можно перетащить мышью и потянуть за уголок.</p>
    <div class="td-imgs">${W.images.map((x,i)=>`<div class="td-ix${TD.sel&&TD.sel.kind==='img'&&TD.sel.key==='X_'+x.id?' on':''}" data-tdix="${i}">
      <img src="/tpl/${encodeURIComponent(TD.id)}/${encodeURIComponent(x.file)}" alt="" data-tdpickimg="X_${esc(x.id)}">
      <div><b>${esc(x.name||x.file)}</b><small class="muted">${esc(tdPlaceName(x.place))} · ${tdCm(x.widthCm)} см</small></div>
      <button class="icon" type="button" data-tdimgdel="${i}" title="Удалить">✕</button></div>`).join('') || '<p class="muted">Пока нет.</p>'}</div>
    <label class="btn">+ Добавить картинку…<input type="file" accept="image/png,image/jpeg" hidden data-tdup="extra"></label>`;
}
function tdColorOpts(sel){
  const keys = Object.keys(TD.work.colors||{}), nm = tdColorNames(), own = sel && !keys.includes(sel);
  return keys.map(c=>`<option value="${esc(c)}"${c===sel?' selected':''}>${esc(nm[c]||c)}</option>`).join('') + (own?`<option value="${esc(sel)}" selected>#${esc(sel)}</option>`:'');
}
function tdSample(s, f){
  return `font-family:'${esc(String(TD.work.font||'Arial').replace(/'/g,''))}',Arial,sans-serif;color:#${tdColorHex(s.color)};${f&&f.dark?'background:#'+tdColorHex('NAVYD')+';':''}font-weight:${s.bold?700:400};font-style:${s.italic?'italic':'normal'}`;
}
function tdPlaces(){
  const on = TD.work.sections.filter(s=>s.on);
  return on.flatMap(s => [[s.id+'Top', tdSecName(s.id)+' — в начале'], [s.id+'End', tdSecName(s.id)+' — в конце']]);
}
function tdPlaceName(p){ const x = tdPlaces().find(q=>q[0]===p); return x ? x[1] : (TD_SEC_NAMES[String(p).replace(/(Top|End)$/,'')] ? tdSecName(String(p).replace(/(Top|End)$/,''))+' (раздел выключен)' : '—'); }

// ---------------------------------------------------------------- инспектор (правая панель)
function tdInspHTML(){
  const sel = TD.sel, W = TD.work;
  if (!sel) return `<div class="td-empty"><b>Ничего не выбрано</b><p class="muted">Щёлкните в документе текст — откроются шрифт, размер, цвет и надпись. Щёлкните картинку — ширина, место и выравнивание; её можно потянуть за уголок.</p>
    <p class="muted">${TD.demo?'Документ показан на примере: в текущем КП нет позиций.':'Документ построен по текущему КП.'}</p></div>`;
  if (sel.kind==='style'){
    const k = sel.key;
    if (k==='headerText') return `<h4 class="td-ih">Шапка: реквизиты</h4><p class="muted">Текст, размер и цвета шапки — на вкладке «Шапка».</p><button class="btn" type="button" data-tdtab="head">Открыть «Шапка»</button>`;
    const f = tdFields('style').find(x=>x.key==='styles.'+k) || {}, s = W.styles[k] || {};
    const tg = (p,t,ti) => `<button type="button" class="td-t${s[p]?' on':''}" data-tdst="${p}" aria-pressed="${!!s[p]}" title="${ti}">${t}</button>`;
    const texts = tdTextsFor(sel.text||'');
    return `<h4 class="td-ih">${esc(tdStyleLabel(k))}</h4><small class="muted">Стиль «${esc(k)}» — меняется везде, где он встречается</small>
      <div class="td-row"><span>Размер</span><span class="td-step"><button class="icon" type="button" data-tdsz="-0.5">−</button><input type="number" min="5" max="72" step="0.5" data-tdnum="styles.${esc(k)}.size" value="${esc(s.size??'')}"><button class="icon" type="button" data-tdsz="0.5">+</button></span><em>пт</em></div>
      <div class="td-row"><span>Начертание</span><span class="td-tgs">${tg('bold','Ж','Жирный')}${tg('italic','<i>К</i>','Курсив')}${tg('caps','АА','Прописные')}</span></div>
      <div class="td-row"><span>Разрядка</span><input type="number" min="0" max="10" step="0.25" data-tdnum="styles.${esc(k)}.spacing" value="${esc(s.spacing??0)}"><em>пт</em></div>
      ${f.noColor?'<p class="muted">Цвет — по частям фирменного знака (вкладка «Оформление»).</p>':`<div class="td-col"><span>Цвет</span><div class="td-chips">${Object.keys(W.colors||{}).map(c=>`<button type="button" class="td-chip${s.color===c?' on':''}" data-tdscol="${esc(c)}" title="${esc(tdColorNames()[c]||c)}" style="background:#${tdColorHex(c)}"></button>`).join('')}
        <label class="td-chip own${/^[0-9A-Fa-f]{6}$/.test(s.color||'')?' on':''}" title="Свой цвет"><input type="color" data-tdscolown="1" value="#${tdColorHex(s.color)}"></label></div></div>`}
      <div class="td-prev" style="${tdSample(s,f)};font-size:${Math.min(40,(+s.size||10)*4/3)}px;text-transform:${s.caps?'uppercase':'none'};letter-spacing:${(+s.spacing||0)*4/3}px">${esc((sel.text||'Образец').slice(0,60))}</div>
      ${texts.length?`<h4 class="td-ih2">Надпись</h4>${texts.map(t=>`<label class="td-l"><span>${esc(tdTextLabel(t))}</span><textarea rows="${Math.min(5,Math.ceil(String(W.texts[t]||'').length/34)+1)}" data-tdpath="texts.${esc(t)}">${esc(W.texts[t]||'')}</textarea></label>`).join('')}
        <small class="muted">{…} — подставляется из КП, оставьте как есть.</small>`:'<p class="muted td-note">Этот текст берётся из КП или каталога — здесь меняется только оформление.</p>'}`;
  }
  if (sel.kind==='img'){
    const k = sel.key;
    if (/^X_/.test(k)){
      const i = W.images.findIndex(x=>'X_'+x.id===k), x = W.images[i]; if (!x) return '';
      return `<h4 class="td-ih">Картинка «${esc(x.name||x.file)}»</h4>
        <div class="td-img1"><img src="/tpl/${encodeURIComponent(TD.id)}/${encodeURIComponent(x.file)}" alt=""></div>
        <label class="td-l"><span>Название</span><input type="text" data-tdpath="images.${i}.name" value="${esc(x.name||'')}"></label>
        <div class="td-row"><span>Ширина</span><span class="td-step"><button class="icon" type="button" data-tdw="-0.5">−</button><input type="number" min="0.5" max="25" step="0.1" data-tdnum="images.${i}.widthCm" value="${esc(x.widthCm)}"><button class="icon" type="button" data-tdw="0.5">+</button></span><em>см</em></div>
        <label class="td-l"><span>Место</span><select data-tdpath="images.${i}.place">${tdPlaces().map(([v,t])=>`<option value="${esc(v)}"${v===x.place?' selected':''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="td-row"><span>Выравнивание</span><span class="td-seg">${[['left','⟸','Влево'],['center','⇔','По центру'],['right','⟹','Вправо']].map(([v,t,ti])=>`<button type="button" data-tdset="images.${i}.align" data-v="${v}" class="${(x.align||'center')===v?'on':''}" title="${ti}">${t}</button>`).join('')}</span></div>
        <div class="row"><button class="btn ghost" type="button" data-tdimgmv="-1">↑ Раньше</button><button class="btn ghost" type="button" data-tdimgmv="1">↓ Позже</button></div>
        <div class="row"><label class="btn ghost">Заменить…<input type="file" accept="image/png,image/jpeg" hidden data-tdup="replace"></label><button class="btn ghost danger" type="button" data-tdimgdel="${i}">Удалить</button></div>
        <small class="muted">Перетащите картинку в документе в другой раздел; уголок справа внизу меняет размер.</small>`;
    }
    const [label, pair] = TD_IMG[k] || [k, ''];
    const path = k==='headerLogo' ? 'header.logoWidthCm' : 'rules.'+k, v = getPath(W, path);
    return `<h4 class="td-ih">${esc(label)}</h4>
      <div class="td-row"><span>Ширина</span><span class="td-step"><button class="icon" type="button" data-tdw="-0.5">−</button><input type="number" min="0" max="25" step="0.1" data-tdnum="${esc(path)}" value="${esc(v??'')}"><button class="icon" type="button" data-tdw="0.5">+</button></span><em>см</em></div>
      ${pair?`<div class="td-row"><span>Высота рамки</span><input type="number" min="0.5" max="25" step="0.1" data-tdnum="rules.${pair}" value="${esc(W.rules[pair]??'')}"><em>см</em></div><small class="muted">Фото вписывается в рамку ширина × высота с сохранением пропорций; уголок меняет обе стороны.</small>`:''}
      ${k==='clientsWidthCm'?'<small class="muted">0 — во всю ширину текста. Заменить картинку — вкладка «Изображения».</small>':''}
      ${k==='headerLogo'?'<small class="muted">Заменить логотип — вкладка «Шапка».</small>':''}
      ${/^(cover|equip|component|logo)/.test(k)?'<p class="muted td-note">Сама картинка берётся из КП или каталога; шаблон задаёт её размер.</p>':''}`;
  }
  if (sel.kind==='sec'){
    const i = W.sections.findIndex(s=>s.id===sel.key), s = W.sections[i]; if (!s) return '';
    const blocks = tdFields('toggle').filter(f=>/^blocks\./.test(f.key) && TD_BLOCK_SEC(f.key.slice(7))===s.id);
    return `<h4 class="td-ih">Раздел «${esc(tdSecName(s.id))}»</h4>
      <button class="sw" type="button" role="switch" aria-checked="${!!s.on}" data-tdsecon="${i}"><i></i>${s.on?'включён':'выключен'}</button>
      ${'newPage' in s && s.id!=='equipment'?`<label class="td-chk"><input type="checkbox" data-tdpath="sections.${i}.newPage" ${s.newPage?'checked':''}> С новой страницы</label>`:''}
      <div class="row"><button class="btn ghost" type="button" data-tdsecmv="-1" ${i?'':'disabled'}>↑ Выше</button><button class="btn ghost" type="button" data-tdsecmv="1" ${i<W.sections.length-1?'':'disabled'}>↓ Ниже</button></div>
      ${blocks.length?`<h4 class="td-ih2">Блоки</h4>${blocks.map(f=>`<label class="td-chk"><input type="checkbox" data-tdpath="${esc(f.key)}" ${getPath(W,f.key)?'checked':''}> ${esc(f.label)}</label>`).join('')}`:''}`;
  }
  return '';
}

// надписи шаблона, из которых мог получиться выбранный текст: {подстановки} — любое значение
function tdTextsFor(text){
  const t = String(text||'').replace(/\s+/g,' ').trim().toLowerCase(); if (!t) return [];
  const out = [];
  for (const [k, v] of Object.entries(TD.work.texts||{})){
    const s = String(v||''); if (!s.replace(/\{[^}]*\}/g,'').trim()) continue;
    const re = new RegExp(s.split(/\{[^}]*\}/).map(x=>x.replace(/\s+/g,' ').trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s\\S]*?'));
    if (re.test(t)) out.push(k);
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- превью документа
function tdDemoState(){
  const D = freshState();
  Object.assign(D, { client:'ООО «Пример заказчика»', clientInn:'7700000000', number:'001', object:{purpose:'Объект заказчика', address:'г. Москва'},
    contact:{name:'Иванов Иван Иванович', post:'Главный инженер', phone:'', email:''}, manager:{...S.manager, name:S.manager.name||'Петров Пётр', position:S.manager.position||'Менеджер'} });
  D.conditions.forEach(c=>{ c.value = (COND.find(x=>x[0]===c.label)||[0,['—']])[1][0]; });
  return D;
}
async function tdState(){
  if (S.items.length){ TD.demo = false; return null; }
  TD.demo = true;
  const D = tdDemoState();
  let list = []; try{ list = await store().list(); }catch(e){}
  const pick = list.filter(x=>x.price && x.photo).slice(0,1).concat(list.filter(x=>x.price && !x.photo)).slice(0,2);
  for (const x of pick){ const it = newItem(); const prev = S; S = D; try{ fillFromCat(it, await fullDoc(x)); }catch(e){} finally{ S = prev; } it.qty = 1; D.items.push(it); }
  if (!D.items.length){ const it = newItem(); Object.assign(it, {name:'Компрессор винтовой ПРИМЕР-37', spec:'37 кВт, 6,2 м³/мин', price:1250000, page:true,
    groups:[{name:'Основные', rows:[{k:'Производительность',v:'6,2 м³/мин'},{k:'Мощность',v:'37 кВт'},{k:'Давление',v:'8 бар'}]}], features:[{id:uid(), label:'Назначение', text:'Пример описания оборудования для показа оформления шаблона.'}]}); D.items.push(it); }
  return D;
}
async function tdBuild(){
  const D = await tdState(), prev = S, cat = CATED;
  const settings = Object.assign(JSON.parse(JSON.stringify(TD.work)), { design:true });
  if (D){ S = D; CATED = 'designer'; }   // пример КП: черновик пользователя не сохраняется и не меняется
  try{ const St = docState(); if (!St.number) St.number = S.number || 'ПРИМЕР'; return await renderDocx(St, TD.pack, settings); }
  finally{ if (D){ S = prev; CATED = cat; } }
}
function tdPreview(now){
  clearTimeout(TD.t);
  TD.t = setTimeout(tdRun, now ? 0 : 450);
}
async function tdRun(){
  if (!TD.work || TD.err || !$('#tdPages')) return;
  if (TD.busy){ TD.again = true; return; }
  TD.busy = true; TD.again = false;
  const cv = $('#tdCanvas'); cv.classList.add('busy');
  try{
    const blob = await tdBuild(), host = document.createElement('div');
    await renderDocxInto(blob, host);
    const pages = $('#tdPages'); if (!pages) return;
    const top = cv.scrollTop, left = cv.scrollLeft;
    pages.replaceChildren(...host.childNodes); tdTag(); if (!TD.z) tdFit(); else tdZoom(0);
    cv.scrollTop = top; cv.scrollLeft = left; tdMarkSel();
  }catch(e){ const p = $('#tdPages'); if (p) p.innerHTML = `<p class="msg err">Документ не построен: ${esc(e.message||e)}</p>`; }
  finally{ TD.busy = false; const c = $('#tdCanvas'); if (c) c.classList.remove('busy'); if (TD.again) tdPreview(true); }
}
// пометки скелета (стили KPS_, картинки KPI_, разделы KPSEC_) → атрибуты для выбора мышью
function tdTag(){
  const styles = Object.keys(TD.work.styles||{}).concat(['headerText']), low = {}; styles.forEach(k=>{ low[k.toLowerCase()] = k; });
  const imgs = {}; Object.keys(TD_IMG).forEach(k=>{ imgs[k.toLowerCase()] = k; }); TD.work.images.forEach(x=>{ imgs[('X_'+x.id).toLowerCase()] = 'X_'+x.id; });
  const secs = {}; TD.work.sections.forEach(s=>{ secs[s.id.toLowerCase()] = s.id; });
  for (const el of document.querySelectorAll('#tdPages [class*="docx_kp"]')){
    for (const c of el.classList){
      let m;
      if ((m = /^docx_kps_(.+)$/.exec(c)) && low[m[1]]) el.dataset.tds = low[m[1]];
      else if ((m = /^docx_kpi_(.+)$/.exec(c)) && imgs[m[1]]) el.dataset.tdi = imgs[m[1]];
      else if ((m = /^docx_kpsec_(.+)$/.exec(c)) && secs[m[1]]) el.dataset.tdsec = secs[m[1]];
    }
  }
}
function tdPageCm(){ const m = /<w:pgSz[^>]*w:w="(\d+)"/.exec(TD.pack.sect||''); return m ? +m[1]/567 : 21; }
function tdPxPerCm(){ const s = document.querySelector('#tdPages section.docx'); return s ? s.getBoundingClientRect().width / tdPageCm() : 37.8*(TD.z||1); }
function tdFit(){ const cv = $('#tdCanvas'), s = document.querySelector('#tdPages section.docx'); if (!cv||!s) return;
  TD.z = Math.max(.35, Math.min(1.4, Math.round((cv.clientWidth-40)/s.offsetWidth*20)/20)); tdZoom(0); }
function tdZoom(dir){ TD.z = Math.max(.3, Math.min(2.5, Math.round(((TD.z||1)+dir)*20)/20)); const p = $('#tdPages'); if (p) p.style.zoom = TD.z; tdTop(); tdMarkSel(); }

// выделение: рамка вокруг выбранной картинки (с уголком для размера), подсветка всех мест стиля
function tdMarkSel(){
  document.querySelectorAll('#tdPages .td-on').forEach(e=>e.classList.remove('td-on'));
  const box = $('#tdSelBox'); if (box) box.hidden = true;
  const sel = TD.sel; if (!sel) return;
  if (sel.kind==='style') document.querySelectorAll(`#tdPages [data-tds="${CSS.escape(sel.key)}"]`).forEach(e=>e.classList.add('td-on'));
  if (sel.kind==='sec'){ const m = document.querySelector(`#tdPages [data-tdsec="${CSS.escape(sel.key)}"]`); if (m) m.classList.add('td-on'); }
  if (sel.kind==='img'){
    const list = [...document.querySelectorAll(`#tdPages [data-tdi="${CSS.escape(sel.key)}"] img`)]; list.forEach(e=>e.classList.add('td-on'));
    const im = (sel.el && sel.el.isConnected && list.includes(sel.el)) ? sel.el : list[0]; sel.el = im;
    if (im && box) tdPlaceBox(im);
  }
}
function tdPlaceBox(im){
  const box = $('#tdSelBox'), cv = $('#tdCanvas'); if (!box||!cv) return;
  const r = im.getBoundingClientRect(), c = cv.getBoundingClientRect();
  Object.assign(box.style, { left:(r.left-c.left+cv.scrollLeft)+'px', top:(r.top-c.top+cv.scrollTop)+'px', width:r.width+'px', height:r.height+'px' });
  box.querySelector('.td-dim').textContent = tdCm(r.width/tdPxPerCm())+' × '+tdCm(r.height/tdPxPerCm())+' см';
  box.hidden = false;
}
function tdSelect(sel, opts={}){
  TD.sel = sel;
  tdPanels(); tdMarkSel();
  if (opts.scroll){ const el = sel.kind==='sec' ? document.querySelector(`#tdPages [data-tdsec="${CSS.escape(sel.key)}"]`) : sel.kind==='style' ? document.querySelector(`#tdPages [data-tds="${CSS.escape(sel.key)}"]`) : sel.el;
    if (el) el.scrollIntoView({block:'center', behavior:'smooth'}); else if (sel.kind==='style') toast('Этот стиль сейчас не встречается в документе'); }
}

// ---------------------------------------------------------------- сохранение
function tdClean(){ const w = JSON.parse(JSON.stringify(TD.work)); delete w.design; if (w.page && !Object.values(w.page).some(v=>v!==''&&v!=null)) delete w.page; return w; }
async function tdSave(){
  await api(`/api/templates/${encodeURIComponent(TD.id)}/file?name=template.json`, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(tdClean(), null, 2)});
  TD.saved = JSON.stringify(TD.work); dropTemplateCache(TD.id); await loadTemplates(); renderForm();
  TD.pack = await templatePack(TD.id); TD.note = 'Шаблон сохранён. Прежняя версия — в истории (Форма настроек → Файлы шаблона).'; tdTop();
}
async function tdSaveAs(){
  const name = prompt('Название нового шаблона (например, название компании):', (TD.work.name||'Шаблон')+' — копия'); if (!name || !name.trim()) return;
  let id = translit(name)||'tpl', n = 1; const base = id; while (TEMPLATES.some(x=>x.id===id)) id = base+'-'+(++n);
  await api(`/api/templates/${encodeURIComponent(TD.id)}/copy?to=${encodeURIComponent(id)}&title=${encodeURIComponent(name.trim())}`, {method:'POST'});
  const w = tdClean(); w.name = name.trim();
  await api(`/api/templates/${encodeURIComponent(id)}/file?name=template.json`, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(w, null, 2)});
  TD.saved = JSON.stringify(TD.work);   // изменения ушли в новый шаблон, исходный не тронут
  await loadTemplates(); renderForm();
  await openTemplateDesigner(id); TD.note = 'Создан шаблон «'+name.trim()+'» (папка templates/'+id+'). Выбрать его для КП — на шаге «Титульный лист».'; tdTop();
}
// новый шаблон для другой компании: копия основного шаблона, сразу в графическом редакторе на вкладке «Шапка»
async function tdNewCompany(){
  if (!ADMIN.on){ toast('Создавать шаблоны может администратор: войдите в «Настройках»'); return; }
  const from = (TEMPLATES.find(t=>t.id==='pnevmotekh' && !t.error) || TEMPLATES.find(t=>!t.error) || {}).id; if (!from) throw new Error('нет исходного шаблона');
  const name = prompt('Название компании (так будет называться шаблон):', ''); if (!name || !name.trim()) return;
  let id = translit(name)||'tpl', n = 1; const base = id; while (TEMPLATES.some(x=>x.id===id)) id = base+'-'+(++n);
  await api(`/api/templates/${encodeURIComponent(from)}/copy?to=${encodeURIComponent(id)}&title=${encodeURIComponent(name.trim())}`, {method:'POST'});
  await loadTemplates(); renderForm();
  TD.tab = 'head'; await openTemplateDesigner(id);
  TD.note = 'Создан шаблон «'+name.trim()+'». Задайте шапку с логотипом, фирменный знак и цвета, затем «Сохранить».'; tdTop();
}
function tdClose(){
  if (tdDirty() && !confirm('Закрыть без сохранения? Изменения шаблона пропадут.')) return;
  const d = $('#tddlg'); if (d){ d.close(); d.innerHTML = ''; } TD.work = null; TD.sel = null;
}
async function tdUpload(kind, file){
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('нужна картинка PNG или JPEG');
  const ext = file.type==='image/png' ? 'png' : 'jpg', stamp = Date.now().toString(36);
  const name = kind==='clients' ? `clients_${stamp}.${ext}` : kind==='header' ? `hdr_logo_${stamp}.${ext}` : `img_${stamp}.${ext}`;
  await api(`/api/templates/${encodeURIComponent(TD.id)}/file?name=${encodeURIComponent(name)}`, {method:'PUT', body:file});
  return name;
}

// ---------------------------------------------------------------- события
function tdSetNum(path, v){ const n = tdNum(v); if (v==='' || !isFinite(n)) return; tdChange(w=>setPath(w, path, n), {merge:path, panels:false}); }
function tdResizeTo(key, cm, ratio){
  tdChange(w=>{
    if (/^X_/.test(key)){ const x = w.images.find(q=>'X_'+q.id===key); if (x) x.widthCm = cm; return; }
    if (key==='headerLogo'){ w.header.logoWidthCm = cm; return; }
    const pair = (TD_IMG[key]||[])[1];
    if (pair && ratio) w.rules[pair] = Math.round(Math.max(.5, (+w.rules[pair]||cm)*ratio)*10)/10;
    w.rules[key] = cm;
  });
}
function tdImgCm(key){ if (/^X_/.test(key)){ const x = TD.work.images.find(q=>'X_'+q.id===key); return x ? +x.widthCm : 0; } if (key==='headerLogo') return +TD.work.header.logoWidthCm||4; return +TD.work.rules[key]||0; }

document.addEventListener('click', async e=>{
  const d = $('#tddlg'); if (!d || !d.open || !d.contains(e.target)) return;
  const b = e.target.closest('button,[data-tdpickimg]');
  try{
    if (!b){
      if (e.target.closest('#tdPages')){
        const t = e.target;
        const im = t.closest('[data-tdi]'), st = t.closest('[data-tds]');
        if (im && t.tagName==='IMG') return tdSelect({kind:'img', key:im.dataset.tdi, el:t});
        if (st) return tdSelect({kind:'style', key:st.dataset.tds, text:(st.closest('p')||st).textContent});
        const sec = tdSecAt(e.clientY); if (sec) return tdSelect({kind:'sec', key:sec});
        return tdSelect(null);
      }
      return;
    }
    if (b.dataset.tdpickimg){ const el = document.querySelector(`#tdPages [data-tdi="${CSS.escape(b.dataset.tdpickimg)}"] img`); return tdSelect({kind:'img', key:b.dataset.tdpickimg, el}, {scroll:true}); }
    const a = b.dataset.td;
    if (a==='close') return tdClose();
    if (a==='undo' || a==='redo') return tdUndo(a==='undo');
    if (a==='zin' || a==='zout') return tdZoom(a==='zin' ? .1 : -.1);
    if (a==='zfit') return tdFit();
    if (a==='save') return await tdSave();
    if (a==='saveas') return await tdSaveAs();
    if (a==='docx'){ TD.note='Собираю пробный файл…'; tdTop(); const prev=S.items.length; if (!prev){ toast('В КП нет позиций — добавьте оборудование, чтобы скачать пробный файл'); TD.note=''; tdTop(); return; }
      await previewDocx(TD.id, tdClean()); TD.note='Пробный файл скачан (шаблон не изменён, пока не нажмёте «Сохранить»)'; return tdTop(); }
    if (a==='form'){ if (tdDirty() && !confirm('Несохранённые изменения графического редактора пропадут. Перейти к форме?')) return; TD.saved = JSON.stringify(TD.work); const id = TD.id; tdClose(); return openTemplateEditor(id); }
    if (a==='brandadd') return tdChange(w=>{ (w.brandParts = w.brandParts||[]).push(['', 'BLUE']); });
    if (a==='hdrlogodel') return tdChange(w=>{ w.header.logo = ''; });
    if (a==='clientsdel') return tdChange(w=>{ w.clientsImage = ''; });
    if (b.dataset.tdtab){ TD.tab = b.dataset.tdtab; return tdPanels(); }
    if (b.dataset.tdgo) return tdSelect({kind:'sec', key:b.dataset.tdgo}, {scroll:true});
    if (b.dataset.tdstyle) return tdSelect({kind:'style', key:b.dataset.tdstyle, text:(document.querySelector(`#tdPages [data-tds="${CSS.escape(b.dataset.tdstyle)}"]`)||{}).textContent||''}, {scroll:true});
    if (b.dataset.tdsecon!=null) return tdChange(w=>{ const s = w.sections[+b.dataset.tdsecon]; s.on = !s.on; });
    if (b.dataset.tdsecmv){ const i = TD.work.sections.findIndex(s=>s.id===TD.sel.key), j = i+(+b.dataset.tdsecmv); if (j<0||j>=TD.work.sections.length) return;
      return tdChange(w=>{ const x = w.sections; [x[i],x[j]] = [x[j],x[i]]; }); }
    if (b.dataset.tdtog) return tdChange(w=>setPath(w, b.dataset.tdtog, !getPath(w, b.dataset.tdtog)));
    if (b.dataset.tdset) return tdChange(w=>setPath(w, b.dataset.tdset, b.dataset.v));
    if (b.dataset.tdbranddel!=null) return tdChange(w=>{ w.brandParts.splice(+b.dataset.tdbranddel, 1); });
    if (b.dataset.tdimgdel!=null){ const x = TD.work.images[+b.dataset.tdimgdel]; if (!x || !confirm('Убрать картинку «'+(x.name||x.file)+'» из шаблона?')) return;
      if (TD.sel && TD.sel.key==='X_'+x.id) TD.sel = null; return tdChange(w=>{ w.images.splice(+b.dataset.tdimgdel, 1); }); }
    if (b.dataset.tdimgmv){ const i = TD.work.images.findIndex(x=>'X_'+x.id===TD.sel.key); if (i<0) return; const pl = tdPlaces().map(p=>p[0]);
      const k = pl.indexOf(TD.work.images[i].place)+(+b.dataset.tdimgmv); if (k<0||k>=pl.length) return; return tdChange(w=>{ w.images[i].place = pl[k]; }); }
    if (b.dataset.tdst){ const k = TD.sel.key; return tdChange(w=>{ const s = w.styles[k] = w.styles[k]||{}; s[b.dataset.tdst] = !s[b.dataset.tdst]; }); }
    if (b.dataset.tdscol){ const k = TD.sel.key; return tdChange(w=>{ (w.styles[k] = w.styles[k]||{}).color = b.dataset.tdscol; }); }
    if (b.dataset.tdsz){ const k = TD.sel.key; return tdChange(w=>{ const s = w.styles[k] = w.styles[k]||{}; s.size = Math.max(5, Math.min(72, Math.round(((+s.size||10)+(+b.dataset.tdsz))*2)/2)); }, {merge:'sz'+k}); }
    if (b.dataset.tdw){ const k = TD.sel.key, cm = Math.max(0.5, Math.round((tdImgCm(k)+(+b.dataset.tdw))*10)/10), old = tdImgCm(k)||cm; return tdResizeTo(k, cm, cm/old); }
  }catch(err){ alert('Не получилось: '+(err.message||err)); }
});
document.addEventListener('input', e=>{
  const el = e.target; if (!el.closest || !el.closest('#tddlg') || !TD.work) return;
  if (el.dataset.tdnum) return tdSetNum(el.dataset.tdnum, el.value);
  if (el.dataset.tdpage!=null){ const v = el.value; return tdChange(w=>{ w.page = w.page||{}; w.page[el.dataset.tdpage] = v===''?'':tdNum(v); }, {merge:'page'+el.dataset.tdpage, panels:false}); }
  if (el.dataset.tdcolor) return tdChange(w=>{ w.colors[el.dataset.tdcolor] = el.value.replace('#','').toUpperCase(); }, {merge:'col'+el.dataset.tdcolor, panels:false});
  if (el.dataset.tdscolown){ const k = TD.sel.key; return tdChange(w=>{ (w.styles[k] = w.styles[k]||{}).color = el.value.replace('#','').toUpperCase(); }, {merge:'scol'+k, panels:false}); }
  if (el.dataset.tdbrand!=null) return tdChange(w=>{ w.brandParts[+el.dataset.tdbrand][0] = el.value; }, {merge:'brand', panels:false});
  if (el.dataset.tdpath && (el.tagName==='TEXTAREA' || el.type==='text')) return tdChange(w=>setPath(w, el.dataset.tdpath, el.value), {merge:el.dataset.tdpath, panels:false});
});
document.addEventListener('change', async e=>{
  const el = e.target; if (!el.closest || !el.closest('#tddlg') || !TD.work) return;
  try{
    if (el.classList.contains('td-pick')){ if (tdDirty() && !confirm('Перейти к другому шаблону без сохранения изменений?')){ el.value = TD.id; return; } TD.saved = JSON.stringify(TD.work); return openTemplateDesigner(el.value); }
    // поля ввода уже применены при наборе; окно здесь не перерисовывается, чтобы не потерять щелчок, снявший фокус
    if (el.dataset.tdnum || el.dataset.tdpage!=null || el.dataset.tdcolor || el.dataset.tdscolown || el.dataset.tdbrand!=null) return;
    if (el.dataset.tdbrandc!=null) return tdChange(w=>{ w.brandParts[+el.dataset.tdbrandc][1] = el.value; });
    if (el.type==='checkbox' && el.dataset.tdpath) return tdChange(w=>setPath(w, el.dataset.tdpath, el.checked));
    if (el.tagName==='SELECT' && el.dataset.tdpath) return tdChange(w=>setPath(w, el.dataset.tdpath, el.value));
    if (el.dataset.tdpath) return;
    if (el.dataset.tdup && el.files[0]){
      const kind = el.dataset.tdup, f = el.files[0]; el.value = '';
      TD.note = 'Загружаю картинку…'; tdTop();
      const name = await tdUpload(kind==='replace' ? 'extra' : kind, f); TD.note = '';
      if (kind==='clients') return tdChange(w=>{ w.clientsImage = name; });
      if (kind==='header') return tdChange(w=>{ w.header.logo = name; w.header.on = true; });
      if (kind==='replace'){ const k = TD.sel.key; return tdChange(w=>{ const x = w.images.find(q=>'X_'+q.id===k); if (x) x.file = name; }); }
      const id = Date.now().toString(36), place = (TD.sel && TD.sel.kind==='sec' ? TD.sel.key : (TD.work.sections.find(s=>s.on)||{id:'cover'}).id)+'End';
      tdChange(w=>{ w.images.push({ id, file:name, name:f.name.replace(/\.[^.]+$/,'').slice(0,60), place, widthCm:6, align:'center' }); });
      TD.sel = {kind:'img', key:'X_'+id}; tdPanels();
    }
  }catch(err){ TD.note = ''; tdTop(); alert('Не получилось: '+(err.message||err)); }
});
document.addEventListener('keydown', e=>{
  const d = $('#tddlg'); if (!d || !d.open) return;
  if (!(e.ctrlKey||e.metaKey) || e.target.closest('input,textarea,select')) return;
  const k = e.key.toLowerCase();
  if (k==='z' || k==='я'){ e.preventDefault(); tdUndo(!e.shiftKey); }
  else if (k==='y' || k==='н'){ e.preventDefault(); tdUndo(false); }
  else if (k==='s' || k==='ы'){ e.preventDefault(); if (tdDirty()) tdSave().catch(err=>alert('Не сохранено: '+(err.message||err))); }
});

// раздел документа под точкой: последняя метка начала раздела выше неё
function tdSecAt(y){
  let best = null;
  for (const m of document.querySelectorAll('#tdPages [data-tdsec]')) if (m.getBoundingClientRect().top <= y + 2) best = m.dataset.tdsec;
  return best || (TD.work.sections.find(s=>s.on)||{}).id || null;
}
// места для своих картинок: начало и конец каждого включённого раздела (по меткам разделов)
function tdSlots(){
  const marks = [...document.querySelectorAll('#tdPages [data-tdsec]')], out = [];
  const pagesEnd = (()=>{ const s = [...document.querySelectorAll('#tdPages section.docx')].pop(); return s ? s.getBoundingClientRect().bottom - 40 : 0; })();
  const heads = [...document.querySelectorAll('#tdPages [data-tds="heading"]')];
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  marks.forEach((m, i)=>{
    const r = m.getBoundingClientRect(), nx = marks[i+1], next = nx ? nx.getBoundingClientRect().top : pagesEnd;
    const head = m.dataset.tdsec==='cover' ? null : heads.find(h => after(m, h) && (!nx || after(h, nx)));
    const topY = head ? head.getBoundingClientRect().bottom + 14 : r.top;
    out.push({place:m.dataset.tdsec+'Top', y:topY, x:r.left, w:r.width||300});
    out.push({place:m.dataset.tdsec+'End', y:next - 4, x:r.left, w:r.width||300});
  });
  return out;
}

// мышь в документе: уголок выделения — размер картинки; своя картинка — перенос в другой раздел
document.addEventListener('pointerdown', e=>{
  const d = $('#tddlg'); if (!d || !d.open || e.button!==0) return;
  const grip = e.target.closest('#tdSelBox .td-grip');
  if (grip && TD.sel && TD.sel.kind==='img' && TD.sel.el){
    e.preventDefault(); const im = TD.sel.el, r0 = im.getBoundingClientRect(), x0 = e.clientX, ppc = tdPxPerCm(), key = TD.sel.key, cm0 = tdImgCm(key) || r0.width/ppc;
    const k0 = cm0 / (r0.width/ppc);   // правило ширины может быть рамкой, а не шириной картинки — масштаб сохраняется
    let w = r0.width;
    const mv = ev=>{ w = Math.max(12, r0.width + (ev.clientX - x0)); im.style.width = w+'px'; im.style.height = (r0.height*w/r0.width)+'px'; tdPlaceBox(im); };
    const up = ()=>{ removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const cm = Math.max(0.5, Math.round(w/ppc*k0*10)/10); if (Math.abs(cm - cm0) >= 0.1) tdResizeTo(key, cm, cm/cm0); else tdMarkSel(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); return;
  }
  const im = e.target.closest('#tdPages [data-tdi^="X_"] img');
  if (!im) return;
  e.preventDefault();
  const key = im.closest('[data-tdi]').dataset.tdi, x0 = e.clientX, y0 = e.clientY, drop = $('#tdDrop'), cv = $('#tdCanvas');
  let drag = false, slot = null, slots = null;
  const mv = ev=>{
    if (!drag && Math.hypot(ev.clientX-x0, ev.clientY-y0) < 6) return;
    if (!drag){ drag = true; slots = tdSlots(); im.classList.add('td-dragging'); }
    slot = slots.reduce((a, s)=> !a || Math.abs(s.y-ev.clientY) < Math.abs(a.y-ev.clientY) ? s : a, null);
    if (slot && drop){ const c = cv.getBoundingClientRect(); Object.assign(drop.style, {top:(slot.y-c.top+cv.scrollTop)+'px', left:(slot.x-c.left+cv.scrollLeft)+'px', width:slot.w+'px'}); drop.dataset.t = tdPlaceName(slot.place); drop.hidden = false; }
    const c = cv.getBoundingClientRect(); if (ev.clientY < c.top+40) cv.scrollTop -= 14; else if (ev.clientY > c.bottom-40) cv.scrollTop += 14;
  };
  const up = ()=>{ removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (drop) drop.hidden = true; im.classList.remove('td-dragging');
    if (!drag){ tdSelect({kind:'img', key, el:im}); return; }
    TD.sel = {kind:'img', key};
    if (slot) tdChange(w=>{ const x = w.images.find(q=>'X_'+q.id===key); if (x) x.place = slot.place; }); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
// наведение — подсказка, что можно выбрать
document.addEventListener('mouseover', e=>{
  const t = e.target.closest && e.target.closest('#tdPages [data-tds], #tdPages [data-tdi] img'); if (!t) return;
  const k = t.dataset.tds ? tdStyleLabel(t.dataset.tds) : ((TD_IMG[(t.closest('[data-tdi]')||{}).dataset.tdi]||[])[0] || 'Картинка шаблона');
  if (t.title !== k) t.title = k;
});
// перетаскивание разделов в списке «Структура»
document.addEventListener('dragstart', e=>{ const li = e.target.closest && e.target.closest('#tdSecs li'); if (!li) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.dataset.tdsec); li.classList.add('drag'); });
document.addEventListener('dragover', e=>{ const li = e.target.closest && e.target.closest('#tdSecs li'); if (!li) return; e.preventDefault();
  document.querySelectorAll('#tdSecs li').forEach(x=>x.classList.remove('over-t','over-b')); const r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top+r.height/2 ? 'over-t' : 'over-b'); });
document.addEventListener('dragend', ()=>{ document.querySelectorAll('#tdSecs li').forEach(x=>x.classList.remove('over-t','over-b','drag')); });
document.addEventListener('drop', e=>{ const li = e.target.closest && e.target.closest('#tdSecs li'); if (!li) return; e.preventDefault();
  const from = +e.dataTransfer.getData('text/plain'), r = li.getBoundingClientRect(); let to = +li.dataset.tdsec + (e.clientY < r.top+r.height/2 ? 0 : 1);
  if (!isFinite(from)) return; if (from < to) to--; if (to===from) return;
  tdChange(w=>{ const [x] = w.sections.splice(from, 1); w.sections.splice(to, 0, x); }); });
addEventListener('resize', ()=>{ if (TD.sel && TD.sel.kind==='img') tdMarkSel(); });
