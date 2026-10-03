// Графический редактор шаблона КП (только администратор): документ виден как в Word.
//   • щелчок по тексту или картинке — выбор, справа его свойства, над ним — мини-панель;
//   • свои картинки и надписи ставятся мышью в любое место страницы (плавающие объекты Word), размер — за любой из
//     8 маркеров, ширина и высота независимо (Shift — с сохранением пропорций);
//   • текст и картинки макета тоже двигаются мышью: сдвиг записывается в отступы абзаца этого стиля;
//   • стрелки двигают выбранное (Shift — крупнее), Delete — удалить, Ctrl+D — копия, Ctrl+Z / Ctrl+Y — отмена / повтор.
// Шапка страницы, поля листа, палитра, разделы — для новой компании без Word. Всё хранится в template.json шаблона;
// «Сохранить как новый…» делает копию папки шаблона под другую компанию.
'use strict';

const TD = { id:'', pack:null, form:null, work:null, saved:'', undo:[], redo:[], sel:null, tab:'struct', z:0, busy:false, again:false, t:0, demo:false, err:'', note:'' };
const TD_SEC_NAMES = { cover:'Титульный лист', clients:'Наши клиенты', equipment:'Страницы оборудования', offer:'Коммерческое предложение', conditions:'Условия', contacts:'Контакты' };
const TD_IMG = {   // картинки макета: ключ (правило ширины) → подпись
  coverPhotoWidthCm:'Фото на титуле', equipPhotoWidthCm:'Главное фото оборудования', componentPhotoWidthCm:'Фото узлов',
  logoWidthCm:'Логотип производителя', clientsWidthCm:'Картинка «Наши клиенты»', headerLogo:'Логотип в шапке' };
const TD_VARS = ['клиент','номер','дата','менеджер','телефон','email','сайт'];
const TD_BLOCK_SEC = k => /^cover/.test(k) ? 'cover' : /^(equip|spec)/.test(k) ? 'equipment' : /^(discount|amountInWords|currencyNote)$/.test(k) ? 'offer' : 'all';
const tdCm = v => String(Math.round((+v||0)*100)/100).replace('.', ',');
const tdNum = v => { const n = +String(v??'').replace(',', '.'); return isFinite(n) ? n : NaN; };
const tdR = (v, k=10) => Math.round(v*k)/k;
const tdQ = s => document.querySelector('#tdPages '+s), tdQA = s => [...document.querySelectorAll('#tdPages '+s)];
const tdUid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,5);

function tdDlg(){
  let d = $('#tddlg');
  if (!d){ d = document.createElement('dialog'); d.id = 'tddlg'; d.className = 'tdwin'; d.setAttribute('aria-label', 'Графический редактор шаблона'); document.body.appendChild(d);
    // Esc: сначала снимает выделение, потом закрывает окно
    d.addEventListener('cancel', e=>{ e.preventDefault(); if (TD.sel) tdSelect(null); else tdClose(); }); }
  return d;
}

async function openTemplateDesigner(id){
  if (!ADMIN.on){ toast('Графический редактор шаблона доступен администратору: войдите в «Настройках»'); return; }
  id = id || S.template;
  const d = tdDlg(); d.innerHTML = '<p class="muted td-load">Загружаю шаблон…</p>'; if (!d.open) d.showModal();
  Object.assign(TD, { id, pack:null, form:null, work:null, undo:[], redo:[], sel:null, err:'', note:'' });
  dropTemplateCache(id);
  try{
    TD.pack = await templatePack(id);
    const r = await fetch(`/tpl/${encodeURIComponent(id)}/editor.json`, {cache:'no-store'});
    TD.form = r.ok ? await r.json() : {tabs:[]};
    TD.work = KPGen.deepMerge(TD.pack.skel.defaults, TD.pack.json);
    TD.work.sections = normSections(TD.work.sections, TD.pack.skel.defaults.sections);
    for (const k of ['page','imgSize','para']) if (!TD.work[k] || typeof TD.work[k]!=='object' || Array.isArray(TD.work[k])) TD.work[k] = {};
    for (const k of ['images','labels']) if (!Array.isArray(TD.work[k])) TD.work[k] = [];
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

// ---------------------------------------------------------------- объекты
const tdOwnImg = key => /^X_/.test(key||'') ? TD.work.images.find(x=>'X_'+x.id===key) : null;
const tdLabel = key => /^L_/.test(key||'') ? TD.work.labels.find(x=>'L_'+x.id===key) : null;
const tdItem = sel => !sel ? null : sel.kind==='label' ? tdLabel(sel.key) : sel.kind==='img' ? tdOwnImg(sel.key) : null;
const tdOwn = sel => !!tdItem(sel);
const tdParaKey = sel => !sel ? '' : sel.kind==='style' ? sel.key : sel.kind==='img' && !tdOwn(sel) ? 'IMG_'+sel.key : '';
function tdEls(sel){
  if (!sel) return [];
  const k = CSS.escape(sel.key);
  if (sel.kind==='style') return tdQA(`[data-tds="${k}"]`);
  if (sel.kind==='img') return tdQA(`[data-tdi="${k}"] img`);
  if (sel.kind==='label') return tdQA(`.kp-lbl[data-tdl="${k}"]`);
  if (sel.kind==='sec') return tdQA(`[data-tdsec="${k}"]`);
  return [];
}
function tdPrimary(sel=TD.sel){ const list = tdEls(sel); if (sel && sel.el && sel.el.isConnected && list.includes(sel.el)) return sel.el; if (sel) sel.el = list[0]; return list[0] || null; }

// ---------------------------------------------------------------- изменения, отмена/повтор
function tdChange(fn, opts={}){
  const before = JSON.stringify(TD.work);
  fn(TD.work);
  if (JSON.stringify(TD.work) === before) return;
  const last = TD.undo[TD.undo.length-1];
  if (!(opts.merge && last && last.tag===opts.merge && Date.now()-last.at < 1200)) TD.undo.push({ s:before, tag:opts.merge||'', at:Date.now() });
  else last.at = Date.now();
  if (TD.undo.length > 100) TD.undo.shift();
  TD.redo = []; TD.note = '';
  if (opts.panels !== false) tdPanels(); else tdTop();
  tdPreview(opts.now);
}
function tdUndo(back){
  const from = back ? TD.undo : TD.redo, to = back ? TD.redo : TD.undo;
  const x = from.pop(); if (!x) return;
  to.push({ s:JSON.stringify(TD.work), tag:'', at:0 }); TD.work = JSON.parse(x.s);
  if (TD.sel && (TD.sel.kind==='img' || TD.sel.kind==='label') && /^[XL]_/.test(TD.sel.key) && !tdItem(TD.sel)) TD.sel = null;
  tdPanels(); tdPreview(true);
}
const tdDirty = () => TD.work && JSON.stringify(TD.work) !== TD.saved;

// ---------------------------------------------------------------- окно
function tdRender(){
  const d = tdDlg();
  d.innerHTML = `<div class="td-top" id="tdTop"></div>
    ${TD.err ? `<p class="msg err td-err">Шаблон не открывается в графическом редакторе: ${esc(TD.err)}</p>` : ''}
    <div class="td-main">
      <aside class="td-left"><nav class="td-tabs" role="tablist">${[['struct','Структура'],['look','Оформление'],['head','Шапка'],['objs','Объекты']].map(([k,t]) =>
        `<button type="button" role="tab" data-tdtab="${k}" aria-selected="${TD.tab===k}">${t}</button>`).join('')}</nav><div class="td-panel" id="tdPanel"></div></aside>
      <div class="td-canvas" id="tdCanvas"><div class="td-pages" id="tdPages"></div>
        <div class="td-sel" id="tdSelBox" hidden>${['nw','n','ne','e','se','s','sw','w'].map(h=>`<i class="td-h td-h-${h}" data-h="${h}"></i>`).join('')}<span class="td-dim"></span></div>
        <div class="td-mini" id="tdMini" hidden></div><div class="td-guide" id="tdGuide" hidden></div></div>
      <aside class="td-right" id="tdInsp"></aside>
    </div>
    <div class="td-foot"><span id="tdState" class="muted"></span><span class="muted">Перетаскивайте мышью · маркеры — размер (Shift — пропорционально) · стрелки — точный сдвиг · Delete · Ctrl+D — копия · Ctrl+Z</span></div>`;
  tdPanels();
}
function tdTop(){
  const el = $('#tdTop'); if (!el) return;
  // панель строится один раз; дальше меняются только состояния кнопок — иначе щелчок, во время которого
  // поле теряет фокус (и окно обновляется), попадал бы в уже удалённую кнопку
  if (!el.firstChild || el.dataset.id !== TD.id){ el.dataset.id = TD.id;
    el.innerHTML = `<h3>Графический редактор</h3>
    <select class="td-pick" aria-label="Шаблон">${TEMPLATES.filter(t=>!t.error).map(t=>`<option value="${esc(t.id)}"${t.id===TD.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select>
    <span class="td-grp"><button class="icon" type="button" data-td="undo" title="Отменить (Ctrl+Z)">↶</button><button class="icon" type="button" data-td="redo" title="Повторить (Ctrl+Y)">↷</button></span>
    <span class="td-grp"><button class="icon" type="button" data-td="zout" title="Мельче (Ctrl + колесо мыши)">−</button><button class="btn ghost td-zv" type="button" data-td="zfit" title="По ширине окна">—</button><button class="icon" type="button" data-td="zin" title="Крупнее">+</button></span>
    <span class="td-grp td-add"><button class="btn ghost" type="button" data-td="addlabel" ${TD.err?'disabled':''} title="Надпись в любом месте страницы">＋ Надпись</button><label class="btn ghost" title="Картинка в любом месте страницы: печать, подпись, баннер…">＋ Картинка<input type="file" accept="image/png,image/jpeg" hidden data-tdup="extra"></label></span>
    <span class="sp"></span>
    <button class="btn ghost" type="button" data-td="form" title="Все настройки шаблона формой: надписи, правила, файлы, история версий">Форма</button>
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
  tdMini();
}

// ---------------------------------------------------------------- общие кусочки форм
function tdColorOpts(sel){
  const keys = Object.keys(TD.work.colors||{}), nm = tdColorNames(), own = sel && !keys.includes(sel);
  return keys.map(c=>`<option value="${esc(c)}"${c===sel?' selected':''}>${esc(nm[c]||c)}</option>`).join('') + (own?`<option value="${esc(sel)}" selected>#${esc(sel)}</option>`:'');
}
// палитра: path — куда записать цвет; none — подпись варианта «нет» (для фона и рамки)
function tdChips(path, cur, none){
  const keys = Object.keys(TD.work.colors||{});
  return `<div class="td-chips">${none?`<button type="button" class="td-chip none${!cur?' on':''}" data-tdsetc="${esc(path)}" data-v="" title="${esc(none)}"></button>`:''}${keys.map(c=>`<button type="button" class="td-chip${cur===c?' on':''}" data-tdsetc="${esc(path)}" data-v="${esc(c)}" title="${esc(tdColorNames()[c]||c)}" style="background:#${tdColorHex(c)}"></button>`).join('')}
    <label class="td-chip own${cur && /^[0-9A-Fa-f]{6}$/.test(cur)?' on':''}" title="Свой цвет"><input type="color" data-tdcolorown="${esc(path)}" value="#${tdColorHex(cur||'000000')}"></label></div>`;
}
const tdNumIn = (path, v, o={}) => `<input type="number" data-tdnum="${esc(path)}" value="${esc(v??'')}" step="${o.step||0.1}"${o.min!=null?` min="${o.min}"`:''}${o.max!=null?` max="${o.max}"`:''}${o.ph?` placeholder="${esc(o.ph)}"`:''}>`;
const tdSeg = (path, cur, opts) => `<span class="td-seg">${opts.map(([v,t,ti])=>`<button type="button" data-tdset="${esc(path)}" data-v="${esc(v)}" class="${String(cur??'')===v?'on':''}" title="${esc(ti||t)}">${t}</button>`).join('')}</span>`;
const TD_ALIGN = [['left','⯇','Влево'],['center','≡','По центру'],['right','⯈','Вправо'],['both','☰','По ширине']];
function tdSample(s, f){
  return `font-family:'${esc(String(TD.work.font||'Arial').replace(/'/g,''))}',Arial,sans-serif;color:#${tdColorHex(s.color)};${f&&f.dark?'background:#'+tdColorHex('NAVYD')+';':''}font-weight:${s.bold?700:400};font-style:${s.italic?'italic':'normal'}`;
}
function tdPlaces(){ return TD.work.sections.filter(s=>s.on).flatMap(s => [[s.id+'Top', tdSecName(s.id)+' — начало'], [s.id+'End', tdSecName(s.id)+' — конец']]); }
function tdPlaceName(p){ const x = tdPlaces().find(q=>q[0]===p); return x ? x[1] : (TD_SEC_NAMES[String(p).replace(/(Top|End)$/,'')] ? tdSecName(String(p).replace(/(Top|End)$/,''))+' (раздел выключен)' : '—'); }
const tdImgUrl = f => `/tpl/${encodeURIComponent(TD.id)}/${encodeURIComponent(f)}`;

// ---------------------------------------------------------------- левая панель
function tdPanelHTML(){
  const W = TD.work;
  if (TD.tab==='struct'){
    const blocks = tdFields('toggle').filter(f => /^blocks\./.test(f.key));
    return `<p class="muted td-hint">Перетащите раздел, чтобы поменять порядок. Щелчок по названию — показать раздел.</p>
      <ol class="td-secs" id="tdSecs">${W.sections.map((s,i)=>`<li data-tdsec="${i}" class="${s.on?'':'off'}${TD.sel&&TD.sel.kind==='sec'&&TD.sel.key===s.id?' on':''}">
        <span class="td-drag" aria-hidden="true">⋮⋮</span><button type="button" class="td-secname" data-tdgo="${esc(s.id)}">${esc(tdSecName(s.id))}</button>
        <button class="sw" type="button" role="switch" aria-checked="${!!s.on}" data-tdsecon="${i}" title="${s.on?'Раздел включён':'Раздел выключен'}"><i></i></button></li>`).join('')}</ol>
      <h4 class="td-h">Блоки внутри разделов</h4>
      ${['cover','equipment','offer','all'].map(sec=>{ const list = blocks.filter(f=>TD_BLOCK_SEC(f.key.slice(7))===sec); return list.length ? `<div class="td-blk"><b>${esc(sec==='all'?'Все страницы':tdSecName(sec))}</b>${list.map(f=>
        `<label class="td-chk"><input type="checkbox" data-tdpath="${esc(f.key)}" ${getPath(W,f.key)?'checked':''}> ${esc(f.label)}</label>`).join('')}</div>` : ''; }).join('')}`;
  }
  if (TD.tab==='look'){
    const m = W.page || {}, info = pageInfo(TD.pack.sect);
    const base = k => { const r = new RegExp(`<w:pgMar[^>]*w:${k}="(\\d+)"`).exec(TD.pack.sect||''); return r ? tdCm(+r[1]/567) : ''; };
    const num = k => `<label class="td-n"><span>${{top:'Верхнее',bottom:'Нижнее',left:'Левое',right:'Правое'}[k]}</span><input type="number" min="0.5" max="6" step="0.1" data-tdpage="${k}" value="${esc(m[k]??'')}" placeholder="${esc(base(k))}"></label>`;
    const groups = []; let cur = null;
    for (const t of (TD.form.tabs||[])) if (t.id==='styles') for (const f of t.fields||[]){ if (f.type==='group'){ cur = {title:f.title, list:[]}; groups.push(cur); } else if (f.type==='style'){ if (!cur){ cur={title:'Стили', list:[]}; groups.push(cur); } cur.list.push(f); } }
    const moved = Object.keys(W.para||{}).length + Object.keys(W.imgSize||{}).length;
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
      <div class="td-marg">${['top','bottom','left','right'].map(num).join('')}</div>
      <small class="muted">Пусто — как в основе Word (${esc(info||'base.docx')}).</small>
      ${moved?`<h4 class="td-h">Сдвиги и размеры мышью</h4><p class="muted td-hint">Изменено элементов макета: ${moved}.</p><button class="btn ghost" type="button" data-td="resetmoves">Вернуть все на места</button>`:''}
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
        <div class="td-img1">${lg?`<img src="${tdImgUrl(lg)}" alt="">`:'<span class="muted">Нет логотипа</span>'}</div>
        <div class="row"><label class="btn ghost">${lg?'Заменить…':'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="header"></label>${lg?'<button class="btn ghost" type="button" data-td="hdrlogodel">Убрать</button>':''}</div>
        <div class="td-wh"><label class="td-n"><span>Ширина, см</span>${tdNumIn('header.logoWidthCm', H.logoWidthCm??4, {min:0.5,max:12})}</label><label class="td-n"><span>Высота, см</span>${tdNumIn('header.logoHeightCm', +H.logoHeightCm||'', {min:0,max:8,ph:'авто'})}</label></div>
        <div class="td-row2"><span>Логотип</span>${tdSeg('header.logoSide', H.logoSide||'left', [['left','слева'],['right','справа']])}</div>
        <h4 class="td-h">Реквизиты</h4>
        <textarea rows="5" data-tdpath="header.lines" placeholder="ООО «Компания»&#10;ИНН 0000000000, г. Москва, ул. …&#10;+7 (000) 000-00-00 · info@site.ru">${esc(H.lines||'')}</textarea>
        <small class="muted">Каждая строка — отдельная строка шапки. Первая может быть крупнее и другим цветом.</small>
        <label class="td-l"><span>Размер текста, пт</span>${tdNumIn('header.textSize', H.textSize??8, {min:5,max:16,step:0.5})}</label>
        <label class="td-l"><span>Цвет текста</span><select data-tdpath="header.textColor">${tdColorOpts(H.textColor||'GRAY')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.firstBold" ${H.firstBold?'checked':''}> Первая строка жирнее и крупнее</label>
        <label class="td-l"><span>Цвет первой строки</span><select data-tdpath="header.firstColor">${tdColorOpts(H.firstColor||'BLUE')}</select></label>
        <label class="td-chk"><input type="checkbox" data-tdpath="header.rule" ${H.rule!==false?'checked':''}> Линия под шапкой</label>
        <label class="td-l"><span>Цвет линии</span><select data-tdpath="header.ruleColor">${tdColorOpts(H.ruleColor||'LINE')}</select></label>
      </div>`;
  }
  // объекты: свои картинки и надписи, картинка «Наши клиенты»
  const cl = W.clientsImage, on = k => TD.sel && TD.sel.key===k ? ' on' : '';
  return `<div class="row td-addrow"><button class="btn" type="button" data-td="addlabel">＋ Надпись</button><label class="btn">＋ Картинка<input type="file" accept="image/png,image/jpeg" hidden data-tdup="extra"></label></div>
    <p class="muted td-hint">Появляются в видимой части листа. Перетащите мышью в любое место, тяните за маркеры — размер.</p>
    <div class="td-imgs">${W.labels.map(l=>`<button type="button" class="td-ix${on('L_'+l.id)}" data-tdpick="label" data-key="L_${esc(l.id)}">
        <span class="td-ixi td-ixt" style="color:#${tdColorHex(l.color||'DARK')}">Аа</span><span><b>${esc(String(l.text||'').split('\n')[0].slice(0,40)||'Надпись')}</b><small class="muted">Надпись · ${l.float?'свободно':'в тексте'}</small></span></button>`).join('')}
      ${W.images.map(x=>`<button type="button" class="td-ix${on('X_'+x.id)}" data-tdpick="img" data-key="X_${esc(x.id)}">
        <img class="td-ixi" src="${tdImgUrl(x.file)}" alt=""><span><b>${esc(x.name||x.file)}</b><small class="muted">Картинка · ${x.float?'свободно':'в тексте'} · ${tdCm(x.widthCm)}${+x.heightCm?' × '+tdCm(x.heightCm):''} см</small></span></button>`).join('')}
      ${!W.labels.length && !W.images.length ? '<p class="muted">Пока нет своих надписей и картинок.</p>' : ''}</div>
    <h4 class="td-h">Картинка «Наши клиенты»</h4>
    <div class="td-img1">${cl?`<img src="${tdImgUrl(cl)}" alt="">`:'<span class="muted">Нет картинки — страница не выводится</span>'}</div>
    <div class="row"><label class="btn ghost">${cl?'Заменить…':'Загрузить…'}<input type="file" accept="image/png,image/jpeg" hidden data-tdup="clients"></label>${cl?'<button class="btn ghost" type="button" data-td="clientsdel">Убрать</button>':''}</div>`;
}

// ---------------------------------------------------------------- инспектор (правая панель)
function tdParaHTML(pk){
  const a = TD.work.para[pk] || {};
  return `<h4 class="td-ih2">Положение на странице</h4>
    <div class="td-row2"><span>Выравнивание</span>${tdSeg(`para.${pk}.align`, a.align||'', [['','авто','Как в макете']].concat(TD_ALIGN))}</div>
    <div class="td-wh"><label class="td-n"><span>Сдвиг ⇆, см</span>${tdNumIn(`para.${pk}.indent`, +a.indent||0, {min:-2,max:15})}</label>
      <label class="td-n"><span>Сверху, пт</span>${tdNumIn(`para.${pk}.before`, +a.before||0, {step:1,min:-60,max:300})}</label>
      <label class="td-n"><span>Снизу, пт</span>${tdNumIn(`para.${pk}.after`, +a.after||0, {step:1,min:-60,max:300})}</label></div>
    <small class="muted">Или перетащите элемент мышью в документе (стрелки — точный сдвиг). Сдвиг одинаков для всех таких элементов.</small>
    ${Object.keys(a).length?`<button class="btn ghost" type="button" data-tdparareset="${esc(pk)}">Вернуть на место</button>`:''}`;
}
function tdPosHTML(path, x, kind){
  return `<div class="td-row2"><span>Положение</span>${tdSeg(path+'.float', x.float?'1':'', [['1','свободно','В любом месте страницы, текст не сдвигает'],['','в тексте','Строкой в начале или конце раздела, сдвигает текст']])}</div>
    ${x.float?`<div class="td-wh"><label class="td-n"><span>X, см</span>${tdNumIn(path+'.x', tdR(+x.x||0,100), {step:0.1})}</label><label class="td-n"><span>Y, см</span>${tdNumIn(path+'.y', tdR(+x.y||0,100), {step:0.1})}</label></div>`:
      `<div class="td-row2"><span>Выравнивание</span>${tdSeg(path+'.align', x.align||(kind==='img'?'center':'left'), TD_ALIGN.slice(0, kind==='img'?3:4))}</div>`}
    <label class="td-l"><span>${x.float?'Привязка (страница, где объект)':'Место'}</span><select data-tdpath="${esc(path)}.place">${tdPlaces().map(([v,t])=>`<option value="${esc(v)}"${v===x.place?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function tdInspHTML(){
  const sel = TD.sel, W = TD.work;
  if (!sel) return `<div class="td-empty"><b>Как работать</b>
    <ul class="td-tips"><li><b>Щёлкните</b> текст или картинку — справа свойства, над элементом — быстрые кнопки.</li>
      <li><b>Перетащите</b> мышью — элемент переедет. Свои надписи и картинки ставятся в любое место страницы.</li>
      <li><b>Маркеры</b> по краям — размер; ширина и высота меняются независимо, с <kbd>Shift</kbd> — пропорционально.</li>
      <li><kbd>←↑→↓</kbd> — точный сдвиг, <kbd>Delete</kbd> — удалить, <kbd>Ctrl+D</kbd> — копия, <kbd>Ctrl+Z</kbd> — отменить.</li>
      <li><b>＋ Надпись</b> и <b>＋ Картинка</b> вверху — добавить свои элементы.</li></ul>
    <p class="muted">${TD.demo?'Документ показан на примере: в текущем КП нет позиций.':'Документ построен по текущему КП.'}</p></div>`;
  if (sel.kind==='label'){
    const i = W.labels.findIndex(l=>'L_'+l.id===sel.key), l = W.labels[i]; if (!l) return '';
    const P = `labels.${i}`, tg = (p,t,ti) => `<button type="button" class="td-t${l[p]?' on':''}" data-tdtog="${P}.${p}" aria-pressed="${!!l[p]}" title="${ti}">${t}</button>`;
    return `<h4 class="td-ih">Надпись</h4>
      <textarea rows="${Math.min(8, String(l.text||'').split('\n').length+1)}" data-tdpath="${P}.text" id="tdLblText">${esc(l.text||'')}</textarea>
      <div class="td-vars">${TD_VARS.map(v=>`<button type="button" data-tdvar="{${v}}" title="Подставить из КП">{${v}}</button>`).join('')}</div>
      <div class="td-row"><span>Размер</span><span class="td-step"><button class="icon" type="button" data-tdstep="${P}.size" data-d="-1">−</button>${tdNumIn(P+'.size', l.size||10, {min:5,max:96,step:0.5})}<button class="icon" type="button" data-tdstep="${P}.size" data-d="1">+</button></span><em>пт</em></div>
      <div class="td-row"><span>Начертание</span><span class="td-tgs">${tg('bold','Ж','Жирный')}${tg('italic','<i>К</i>','Курсив')}${tg('caps','АА','Прописные')}</span></div>
      <div class="td-row2"><span>Выравнивание</span>${tdSeg(P+'.align', l.align||'left', TD_ALIGN)}</div>
      <div class="td-col"><span>Цвет текста</span>${tdChips(P+'.color', l.color||'DARK')}</div>
      <div class="td-col"><span>Фон</span>${tdChips(P+'.bg', l.bg||'', 'Без фона')}</div>
      <div class="td-col"><span>Рамка</span>${tdChips(P+'.border', l.border||'', 'Без рамки')}</div>
      <h4 class="td-ih2">Расположение</h4>
      ${tdPosHTML(P, l, 'label')}
      ${l.float?`<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${tdNumIn(P+'.widthCm', tdR(+l.widthCm||6,100), {min:0.5,max:25})}</label><label class="td-n"><span>Высота, см</span>${tdNumIn(P+'.heightCm', tdR(+l.heightCm||1.2,100), {min:0.3,max:30})}</label></div>`:''}
      <div class="row"><button class="btn ghost" type="button" data-td="dup">⧉ Копия</button><button class="btn ghost danger" type="button" data-td="del">Удалить</button></div>`;
  }
  if (sel.kind==='img' && /^X_/.test(sel.key)){
    const i = W.images.findIndex(x=>'X_'+x.id===sel.key), x = W.images[i]; if (!x) return '';
    const P = `images.${i}`;
    return `<h4 class="td-ih">Картинка шаблона</h4>
      <div class="td-img1"><img src="${tdImgUrl(x.file)}" alt=""></div>
      <label class="td-l"><span>Название</span><input type="text" data-tdpath="${P}.name" value="${esc(x.name||'')}"></label>
      <h4 class="td-ih2">Размер</h4>
      <div class="td-wh"><label class="td-n"><span>Ширина, см</span>${tdNumIn(P+'.widthCm', tdR(+x.widthCm||6,100), {min:0.3,max:30})}</label><label class="td-n"><span>Высота, см</span>${tdNumIn(P+'.heightCm', +x.heightCm?tdR(+x.heightCm,100):'', {min:0,max:30,ph:'авто'})}</label></div>
      <label class="td-chk"><input type="checkbox" data-tdpath="${P}.lock" ${x.lock?'checked':''}> Сохранять пропорции</label>
      ${+x.heightCm?`<button class="btn ghost" type="button" data-tdset="${P}.heightCm" data-v="0">Вернуть пропорции</button>`:''}
      <h4 class="td-ih2">Расположение</h4>
      ${tdPosHTML(P, x, 'img')}
      ${x.float?`<label class="td-chk"><input type="checkbox" data-tdpath="${P}.behind" ${x.behind?'checked':''}> За текстом (фон, водяной знак)</label>`:''}
      <div class="row"><label class="btn ghost">Заменить…<input type="file" accept="image/png,image/jpeg" hidden data-tdup="replace"></label><button class="btn ghost" type="button" data-td="dup">⧉ Копия</button><button class="btn ghost danger" type="button" data-td="del">Удалить</button></div>`;
  }
  if (sel.kind==='img'){
    const k = sel.key, hdr = k==='headerLogo', fix = W.imgSize[k] || {}, el = tdPrimary(), ppc = tdPxPerCm();
    const wNow = el ? tdR(el.getBoundingClientRect().width/ppc, 100) : '', hNow = el ? tdR(el.getBoundingClientRect().height/ppc, 100) : '';
    return `<h4 class="td-ih">${esc(TD_IMG[k]||'Картинка')}</h4>
      <h4 class="td-ih2">Размер</h4>
      ${hdr?`<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${tdNumIn('header.logoWidthCm', W.header.logoWidthCm??4, {min:0.5,max:12})}</label><label class="td-n"><span>Высота, см</span>${tdNumIn('header.logoHeightCm', +W.header.logoHeightCm||'', {min:0,max:8,ph:'авто'})}</label></div>`:
      `<div class="td-wh"><label class="td-n"><span>Ширина, см</span>${tdNumIn(`imgSize.${k}.w`, fix.w??'', {min:0.3,max:30,ph:wNow})}</label><label class="td-n"><span>Высота, см</span>${tdNumIn(`imgSize.${k}.h`, fix.h??'', {min:0.3,max:30,ph:hNow})}</label></div>
      <small class="muted">Пусто — по правилам макета (с сохранением пропорций). Тяните маркеры в документе.</small>
      ${fix.w||fix.h?`<button class="btn ghost" type="button" data-tdimgreset="${esc(k)}">Вернуть размер по макету</button>`:''}`}
      ${k==='headerLogo'?'<small class="muted">Заменить логотип — вкладка «Шапка».</small>':''}
      ${k==='clientsWidthCm'?'<small class="muted">Заменить картинку — вкладка «Объекты».</small>':''}
      ${/^(cover|equip|component|logo)/.test(k)?'<p class="muted td-note">Сама картинка берётся из КП или каталога; шаблон задаёт её размер и место.</p>':''}
      ${tdParaHTML('IMG_'+k)}`;
  }
  if (sel.kind==='style'){
    const k = sel.key;
    if (k==='headerText') return `<h4 class="td-ih">Шапка: реквизиты</h4><p class="muted">Текст, размер и цвета шапки — на вкладке «Шапка».</p><button class="btn" type="button" data-tdtab="head">Открыть «Шапка»</button>`;
    const f = tdFields('style').find(x=>x.key==='styles.'+k) || {}, s = W.styles[k] || {};
    const tg = (p,t,ti) => `<button type="button" class="td-t${s[p]?' on':''}" data-tdtog="styles.${esc(k)}.${p}" aria-pressed="${!!s[p]}" title="${ti}">${t}</button>`;
    const texts = tdTextsFor(sel.text||'');
    return `<h4 class="td-ih">${esc(tdStyleLabel(k))}</h4><small class="muted">Стиль «${esc(k)}» — меняется везде, где он встречается</small>
      <div class="td-row"><span>Размер</span><span class="td-step"><button class="icon" type="button" data-tdstep="styles.${esc(k)}.size" data-d="-0.5">−</button>${tdNumIn(`styles.${k}.size`, s.size??'', {min:5,max:72,step:0.5})}<button class="icon" type="button" data-tdstep="styles.${esc(k)}.size" data-d="0.5">+</button></span><em>пт</em></div>
      <div class="td-row"><span>Начертание</span><span class="td-tgs">${tg('bold','Ж','Жирный')}${tg('italic','<i>К</i>','Курсив')}${tg('caps','АА','Прописные')}</span></div>
      <div class="td-row"><span>Разрядка</span>${tdNumIn(`styles.${k}.spacing`, s.spacing??0, {min:0,max:10,step:0.25})}<em>пт</em></div>
      ${f.noColor?'<p class="muted">Цвет — по частям фирменного знака (вкладка «Оформление»).</p>':`<div class="td-col"><span>Цвет</span>${tdChips(`styles.${k}.color`, s.color||'DARK')}</div>`}
      <div class="td-prev" style="${tdSample(s,f)};font-size:${Math.min(40,(+s.size||10)*4/3)}px;text-transform:${s.caps?'uppercase':'none'};letter-spacing:${(+s.spacing||0)*4/3}px">${esc((sel.text||'Образец').slice(0,60))}</div>
      ${texts.length?`<h4 class="td-ih2">Надпись</h4>${texts.map(t=>`<label class="td-l"><span>${esc(tdTextLabel(t))}</span><textarea rows="${Math.min(5,Math.ceil(String(W.texts[t]||'').length/34)+1)}" data-tdpath="texts.${esc(t)}">${esc(W.texts[t]||'')}</textarea></label>`).join('')}
        <small class="muted">{…} — подставляется из КП, оставьте как есть.</small>`:'<p class="muted td-note">Этот текст берётся из КП или каталога — здесь меняется оформление и положение.</p>'}
      ${tdParaHTML(k)}`;
  }
  if (sel.kind==='sec'){
    const i = W.sections.findIndex(s=>s.id===sel.key), s = W.sections[i]; if (!s) return '';
    const blocks = tdFields('toggle').filter(f=>/^blocks\./.test(f.key) && TD_BLOCK_SEC(f.key.slice(7))===s.id);
    return `<h4 class="td-ih">Раздел «${esc(tdSecName(s.id))}»</h4>
      <button class="sw" type="button" role="switch" aria-checked="${!!s.on}" data-tdsecon="${i}"><i></i>${s.on?'включён':'выключен'}</button>
      ${'newPage' in s && s.id!=='equipment'?`<label class="td-chk"><input type="checkbox" data-tdpath="sections.${i}.newPage" ${s.newPage?'checked':''}> С новой страницы</label>`:''}
      <div class="row"><button class="btn ghost" type="button" data-tdsecmv="-1" ${i?'':'disabled'}>↑ Выше</button><button class="btn ghost" type="button" data-tdsecmv="1" ${i<W.sections.length-1?'':'disabled'}>↓ Ниже</button></div>
      ${blocks.length?`<h4 class="td-ih2">Блоки</h4>${blocks.map(f=>`<label class="td-chk"><input type="checkbox" data-tdpath="${esc(f.key)}" ${getPath(W,f.key)?'checked':''}> ${esc(f.label)}</label>`).join('')}`:''}
      <div class="row"><button class="btn ghost" type="button" data-td="addlabel">＋ Надпись сюда</button></div>`;
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

// ---------------------------------------------------------------- мини-панель над выбранным
function tdMini(){
  const m = $('#tdMini'); if (!m) return;
  const sel = TD.sel, el = sel && sel.kind!=='sec' ? tdPrimary() : null;
  if (!el){ m.hidden = true; return; }
  let h = '';
  if (tdOwn(sel)){
    const x = tdItem(sel);
    h = (sel.kind==='label' ? `<button type="button" data-tdstep="labels.${TD.work.labels.indexOf(x)}.size" data-d="-1" title="Мельче">A−</button><button type="button" data-tdstep="labels.${TD.work.labels.indexOf(x)}.size" data-d="1" title="Крупнее">A+</button><button type="button" data-tdtog="labels.${TD.work.labels.indexOf(x)}.bold" class="${x.bold?'on':''}" title="Жирный"><b>Ж</b></button><i></i>` : '') +
      (sel.kind==='img' && x.float ? `<button type="button" data-tdtog="images.${TD.work.images.indexOf(x)}.behind" class="${x.behind?'on':''}" title="За текстом">▤</button>` : '') +
      `<button type="button" data-td="dup" title="Копия (Ctrl+D)">⧉</button><button type="button" data-td="del" title="Удалить (Delete)">🗑</button>`;
  } else if (sel.kind==='style' && sel.key!=='headerText'){
    const P = `styles.${sel.key}`, s = TD.work.styles[sel.key] || {};
    h = `<button type="button" data-tdstep="${esc(P)}.size" data-d="-0.5" title="Мельче">A−</button><button type="button" data-tdstep="${esc(P)}.size" data-d="0.5" title="Крупнее">A+</button>
      <button type="button" data-tdtog="${esc(P)}.bold" class="${s.bold?'on':''}" title="Жирный"><b>Ж</b></button><button type="button" data-tdtog="${esc(P)}.italic" class="${s.italic?'on':''}" title="Курсив"><i>К</i></button>` +
      (TD.work.para[sel.key] ? `<button type="button" data-tdparareset="${esc(sel.key)}" title="Вернуть на место">⟲</button>` : '');
  } else if (sel.kind==='img'){
    h = (TD.work.imgSize[sel.key] ? `<button type="button" data-tdimgreset="${esc(sel.key)}" title="Размер по макету">⤢</button>` : '') +
      (TD.work.para['IMG_'+sel.key] ? `<button type="button" data-tdparareset="IMG_${esc(sel.key)}" title="Вернуть на место">⟲</button>` : '');
  }
  if (!h){ m.hidden = true; return; }
  m.innerHTML = h; m.hidden = false;
  const cv = $('#tdCanvas'), r = el.getBoundingClientRect(), c = cv.getBoundingClientRect();
  m.style.left = Math.max(4, r.left - c.left + cv.scrollLeft) + 'px';
  m.style.top = Math.max(4, r.top - c.top + cv.scrollTop - (sel.kind==='style' ? 42 : 66)) + 'px';   // над подписью размера
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
  TD.t = setTimeout(tdRun, now ? 0 : 400);
}
async function tdRun(){
  if (!TD.work || TD.err || !$('#tdPages')) return;
  if (TD.busy){ TD.again = true; return; }
  if (TD.drag){ TD.t = setTimeout(tdRun, 300); return; }   // не перестраивать документ под рукой
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
// пометки скелета (стили KPS_, картинки KPI_, разделы KPSEC_, места привязки KPANC_) → атрибуты для выбора мышью
function tdTag(){
  const low = {}; Object.keys(TD.work.styles||{}).concat(['headerText']).forEach(k=>{ low[k.toLowerCase()] = k; });
  const imgs = {}; Object.keys(TD_IMG).forEach(k=>{ imgs[k.toLowerCase()] = k; }); TD.work.images.forEach(x=>{ imgs[('X_'+x.id).toLowerCase()] = 'X_'+x.id; });
  const lbl = {}; TD.work.labels.forEach(l=>{ lbl[('L_'+l.id).toLowerCase().slice(2)] = 'L_'+l.id; });
  const secs = {}, anc = {}; TD.work.sections.forEach(s=>{ secs[s.id.toLowerCase()] = s.id; anc[(s.id+'Top').toLowerCase()] = s.id+'Top'; anc[(s.id+'End').toLowerCase()] = s.id+'End'; });
  for (const el of tdQA('[class*="docx_kp"]')){
    for (const c of el.classList){
      let m;
      if ((m = /^docx_kps_(.+)$/.exec(c)) && low[m[1]]) el.dataset.tds = low[m[1]];
      else if ((m = /^docx_kpi_(.+)$/.exec(c)) && imgs[m[1]]) el.dataset.tdi = imgs[m[1]];
      else if ((m = /^docx_kpsec_(.+)$/.exec(c)) && secs[m[1]]) el.dataset.tdsec = secs[m[1]];
      else if ((m = /^docx_kpanc_(.+)$/.exec(c)) && anc[m[1]]) el.dataset.tdanc = anc[m[1]];
      else if ((m = /^docx_kpl_(.+)$/.exec(c)) && lbl[m[1]] && !el.closest('.kp-float')){ el.dataset.tdl = lbl[m[1]]; el.classList.add('kp-lbl'); }
    }
  }
}
function tdPageCm(){ const m = /<w:pgSz[^>]*w:w="(\d+)"/.exec(TD.pack.sect||''); return m ? +m[1]/567 : 21; }
function tdPxPerCm(){ const s = tdQ('section.docx'); return s ? s.getBoundingClientRect().width / tdPageCm() : 37.8*(TD.z||1); }
function tdFit(){ const cv = $('#tdCanvas'), s = tdQ('section.docx'); if (!cv||!s) return;
  TD.z = Math.max(.35, Math.min(1.4, Math.round((cv.clientWidth-40)/s.offsetWidth*20)/20)); tdZoom(0); }
function tdZoom(dir){ TD.z = Math.max(.3, Math.min(2.5, Math.round(((TD.z||1)+dir)*20)/20)); const p = $('#tdPages'); if (p) p.style.zoom = TD.z; tdTop(); tdMarkSel(); }

// выделение: рамка с маркерами вокруг картинки или надписи, подсветка всех мест стиля, мини-панель
function tdMarkSel(){
  document.querySelectorAll('#tdPages .td-on').forEach(e=>e.classList.remove('td-on'));
  const box = $('#tdSelBox'); if (box) box.hidden = true;
  const sel = TD.sel; if (!sel){ tdMini(); return; }
  tdEls(sel).forEach(e=>e.classList.add('td-on'));
  const el = tdPrimary();
  if (el && box && (sel.kind==='img' || sel.kind==='label')) tdPlaceBox(el.getBoundingClientRect());
  tdMini();
}
function tdPlaceBox(r){
  const box = $('#tdSelBox'), cv = $('#tdCanvas'); if (!box||!cv) return;
  const c = cv.getBoundingClientRect(), ppc = tdPxPerCm();
  Object.assign(box.style, { left:(r.left-c.left+cv.scrollLeft)+'px', top:(r.top-c.top+cv.scrollTop)+'px', width:r.width+'px', height:r.height+'px' });
  box.querySelector('.td-dim').textContent = tdCm(r.width/ppc)+' × '+tdCm(r.height/ppc)+' см';
  box.hidden = false;
}
function tdSelect(sel, opts={}){
  TD.sel = sel;
  tdPanels(); tdMarkSel();
  if (opts.scroll && sel){ const el = sel.kind==='sec' ? tdQ(`[data-tdsec="${CSS.escape(sel.key)}"]`) : tdPrimary();
    if (el) el.scrollIntoView({block:'center', behavior:'smooth'}); else if (sel.kind==='style') toast('Этот стиль сейчас не встречается в документе'); }
}

// ---------------------------------------------------------------- места привязки и свободные координаты
function tdAnchors(){ return tdQA('[data-tdanc]').map(el=>({ el, place:el.dataset.tdanc, r:el.getBoundingClientRect(), page:el.closest('section.docx') })); }
function tdPageAt(y){ return tdQA('section.docx').find(s=>{ const r = s.getBoundingClientRect(); return y >= r.top && y <= r.bottom; }) || null; }
// точка на экране → место привязки (ближайшее выше на той же странице) и смещение от него в см
function tdAnchorFor(x, y){
  const A = tdAnchors(); if (!A.length) return null;
  const page = tdPageAt(y), same = page ? A.filter(a=>a.page===page) : [];
  let a = same.filter(a=>a.r.top <= y+1).pop() || same[0], far = false;
  if (!a){ a = A.filter(a=>a.r.top <= y).pop() || A[0]; far = true; }
  const ppc = tdPxPerCm();
  return { place:a.place, x:tdR((x-a.r.left)/ppc, 100), y:tdR((y-a.r.top)/ppc, 100), far };
}
// новое место для объекта — видимая часть листа
function tdHere(){
  const cv = $('#tdCanvas').getBoundingClientRect(), page = tdPageAt(cv.top + cv.height*0.3) || tdQ('section.docx');
  if (!page) return { place:(TD.work.sections.find(s=>s.on)||{id:'cover'}).id+'Top', x:0, y:0 };
  const pr = page.getBoundingClientRect(), y = Math.max(pr.top + 60, Math.min(pr.bottom - 120, cv.top + cv.height*0.3));
  const a = tdAnchorFor(pr.left + pr.width*0.3, y) || { place:'coverTop', x:0, y:0 };
  return a;
}

// ---------------------------------------------------------------- сохранение
function tdClean(){ const w = JSON.parse(JSON.stringify(TD.work)); delete w.design; if (w.page && !Object.values(w.page).some(v=>v!==''&&v!=null)) delete w.page; return w; }
async function tdSave(){
  await api(`/api/templates/${encodeURIComponent(TD.id)}/file?name=template.json`, {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(tdClean(), null, 2)});
  TD.saved = JSON.stringify(TD.work); dropTemplateCache(TD.id); await loadTemplates(); renderForm();
  TD.pack = await templatePack(TD.id); TD.note = 'Шаблон сохранён. Прежняя версия — в истории («Форма» → «Файлы шаблона»).'; tdTop();
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

// ---------------------------------------------------------------- действия с объектами
function tdAddLabel(){
  const h = tdHere(), id = tdUid();
  if (TD.sel && TD.sel.kind==='sec') { h.place = TD.sel.key+'Top'; h.x = 0; h.y = 0.5; }
  tdChange(w=>{ w.labels.push({ id, text:'Новая надпись', place:h.place, float:true, x:Math.max(0, h.x), y:h.y, widthCm:7, heightCm:1.2, size:14, color:'BLUE', bold:true, align:'left' }); }, {now:true});
  TD.sel = { kind:'label', key:'L_'+id }; TD.tab = 'objs'; tdPanels();
  setTimeout(()=>{ const t = $('#tdLblText'); if (t){ t.focus(); t.select(); } }, 50);
}
function tdDup(){
  const sel = TD.sel, x = tdItem(sel); if (!x) return;
  const id = tdUid(), list = sel.kind==='label' ? 'labels' : 'images';
  tdChange(w=>{ const c = JSON.parse(JSON.stringify(x)); c.id = id; if (c.float){ c.x = tdR((+c.x||0)+0.5, 100); c.y = tdR((+c.y||0)+0.5, 100); } w[list].push(c); }, {now:true});
  TD.sel = { kind:sel.kind, key:(sel.kind==='label'?'L_':'X_')+id }; tdPanels();
}
function tdDel(){
  const sel = TD.sel, x = tdItem(sel); if (!x) return;
  const list = sel.kind==='label' ? 'labels' : 'images';
  TD.sel = null; tdChange(w=>{ w[list] = w[list].filter(q=>q.id!==x.id); }, {now:true});
  TD.note = 'Удалено. Ctrl+Z — вернуть'; tdTop();
}
// точный сдвиг стрелками: свой объект — координаты (в тексте — станет свободным), элемент макета — отступы абзаца
function tdNudge(dx, dy){
  const sel = TD.sel; if (!sel) return;
  const x = tdItem(sel);
  if (x){
    if (!x.float){ const el = tdPrimary(); if (!el) return; const r = el.getBoundingClientRect(), a = tdAnchorFor(r.left, r.top); if (!a) return;
      return tdChange(w=>{ const q = tdItem(sel); Object.assign(q, { float:true, place:a.place, x:tdR(a.x+dx,100), y:tdR(a.y+dy,100) }); if (sel.kind==='label' && !q.widthCm){ q.widthCm = tdR(r.width/tdPxPerCm(),100); q.heightCm = tdR(r.height/tdPxPerCm(),100); } }, {merge:'nudge'}); }
    return tdChange(()=>{ const q = tdItem(sel); q.x = tdR((+q.x||0)+dx, 100); q.y = tdR((+q.y||0)+dy, 100); }, {merge:'nudge', panels:false});
  }
  const pk = tdParaKey(sel); if (!pk) return;
  tdChange(w=>{ const a = w.para[pk] = w.para[pk] || {}; if (dx) a.indent = tdR((+a.indent||0)+dx, 100); if (dy) a.before = tdR((+a.before||0)+dy*28.35, 2); }, {merge:'nudge'});
}

// ---------------------------------------------------------------- события
function tdSetNum(path, v){ const n = tdNum(v); if (v==='' || !isFinite(n)) return; tdChange(w=>setPath(w, path, n), {merge:path, panels:false}); }

document.addEventListener('click', async e=>{
  const d = $('#tddlg'); if (!d || !d.open || !d.contains(e.target)) return;
  if (TD.clickBlock){ TD.clickBlock = false; if (e.target.closest('#tdPages, #tdSecs')) return; }
  const b = e.target.closest('button');
  try{
    if (!b){
      if (e.target.closest('#tdPages')){
        const t = e.target, lb = t.closest('.kp-lbl[data-tdl]'), im = t.closest('[data-tdi]'), st = t.closest('[data-tds]');
        if (lb) return tdSelect({kind:'label', key:lb.dataset.tdl, el:lb});
        if (im && t.tagName==='IMG') return tdSelect({kind:'img', key:im.dataset.tdi, el:t});
        if (st) return tdSelect({kind:'style', key:st.dataset.tds, text:(st.closest('p')||st).textContent, el:st});
        const sec = tdSecAt(e.clientY); if (sec) return tdSelect({kind:'sec', key:sec});
        return tdSelect(null);
      }
      return;
    }
    const a = b.dataset.td;
    if (a==='close') return tdClose();
    if (a==='undo' || a==='redo') return tdUndo(a==='undo');
    if (a==='zin' || a==='zout') return tdZoom(a==='zin' ? .1 : -.1);
    if (a==='zfit') return tdFit();
    if (a==='save') return await tdSave();
    if (a==='saveas') return await tdSaveAs();
    if (a==='addlabel') return tdAddLabel();
    if (a==='dup') return tdDup();
    if (a==='del') return tdDel();
    if (a==='docx'){ if (!S.items.length){ toast('В КП нет позиций — добавьте оборудование, чтобы скачать пробный файл'); return; }
      TD.note='Собираю пробный файл…'; tdTop(); await previewDocx(TD.id, tdClean()); TD.note='Пробный файл скачан (шаблон не изменён, пока не нажмёте «Сохранить»)'; return tdTop(); }
    if (a==='form'){ if (tdDirty() && !confirm('Несохранённые изменения графического редактора пропадут. Перейти к форме?')) return; TD.saved = JSON.stringify(TD.work); const id = TD.id; tdClose(); return openTemplateEditor(id); }
    if (a==='brandadd') return tdChange(w=>{ (w.brandParts = w.brandParts||[]).push(['', 'BLUE']); });
    if (a==='hdrlogodel') return tdChange(w=>{ w.header.logo = ''; });
    if (a==='clientsdel') return tdChange(w=>{ w.clientsImage = ''; });
    if (a==='resetmoves'){ if (!confirm('Вернуть все сдвинутые мышью тексты и картинки макета на места и к размерам по макету?')) return; return tdChange(w=>{ w.para = {}; w.imgSize = {}; }); }
    if (b.dataset.tdtab){ TD.tab = b.dataset.tdtab; return tdPanels(); }
    if (b.dataset.tdpick){ return tdSelect({kind:b.dataset.tdpick, key:b.dataset.key}, {scroll:true}); }
    if (b.dataset.tdgo) return tdSelect({kind:'sec', key:b.dataset.tdgo}, {scroll:true});
    if (b.dataset.tdstyle){ const el = tdQ(`[data-tds="${CSS.escape(b.dataset.tdstyle)}"]`); return tdSelect({kind:'style', key:b.dataset.tdstyle, text:el?(el.closest('p')||el).textContent:'', el}, {scroll:true}); }
    if (b.dataset.tdvar){ const t = $('#tdLblText'); if (!t) return; const s0 = t.selectionStart??t.value.length, s1 = t.selectionEnd??s0;
      t.value = t.value.slice(0,s0) + b.dataset.tdvar + t.value.slice(s1); t.focus(); t.selectionStart = t.selectionEnd = s0 + b.dataset.tdvar.length; t.dispatchEvent(new Event('input', {bubbles:true})); return; }
    if (b.dataset.tdsecon!=null) return tdChange(w=>{ const s = w.sections[+b.dataset.tdsecon]; s.on = !s.on; });
    if (b.dataset.tdsecmv){ const i = TD.work.sections.findIndex(s=>s.id===TD.sel.key), j = i+(+b.dataset.tdsecmv); if (j<0||j>=TD.work.sections.length) return;
      return tdChange(w=>{ const x = w.sections; [x[i],x[j]] = [x[j],x[i]]; }); }
    if (b.dataset.tdtog) return tdChange(w=>setPath(w, b.dataset.tdtog, !getPath(w, b.dataset.tdtog)));
    if (b.dataset.tdset){ const v = b.dataset.v, path = b.dataset.tdset;
      if (/\.float$/.test(path)) return tdSetFloat(path.replace(/\.float$/,''), v==='1');
      return tdChange(w=>{ if (v==='') { const ps = path.split('.'), o = getPath(w, ps.slice(0,-1).join('.')); if (o) delete o[ps[ps.length-1]]; } else setPath(w, path, /^-?\d+(\.\d+)?$/.test(v) && !/align|Side/.test(path) ? +v : v); }); }
    if (b.dataset.tdsetc!=null){ const v = b.dataset.v, path = b.dataset.tdsetc; return tdChange(w=>setPath(w, path, v)); }
    if (b.dataset.tdstep){ const path = b.dataset.tdstep, dd = +b.dataset.d; return tdChange(w=>setPath(w, path, Math.max(5, Math.min(96, tdR((+getPath(w, path)||10)+dd, 2)))), {merge:'step'+path}); }
    if (b.dataset.tdparareset){ const k = b.dataset.tdparareset; return tdChange(w=>{ delete w.para[k]; }); }
    if (b.dataset.tdimgreset){ const k = b.dataset.tdimgreset; return tdChange(w=>{ delete w.imgSize[k]; }); }
    if (b.dataset.tdbranddel!=null) return tdChange(w=>{ w.brandParts.splice(+b.dataset.tdbranddel, 1); });
  }catch(err){ alert('Не получилось: '+(err.message||err)); }
});
// свободно / в тексте: координаты — там, где объект сейчас на экране
function tdSetFloat(path, on){
  const sel = TD.sel, el = tdPrimary(), ppc = tdPxPerCm();
  const a = on && el ? tdAnchorFor(el.getBoundingClientRect().left, el.getBoundingClientRect().top) : null;
  tdChange(w=>{ const x = getPath(w, path); if (!x) return; x.float = on;
    if (on && a){ x.place = a.place; x.x = a.x; x.y = a.y; if (sel && sel.kind==='label' && el){ x.widthCm = x.widthCm || tdR(el.getBoundingClientRect().width/ppc, 100); x.heightCm = x.heightCm || tdR(el.getBoundingClientRect().height/ppc, 100); } } });
}
document.addEventListener('input', e=>{
  const el = e.target; if (!el.closest || !el.closest('#tddlg') || !TD.work) return;
  if (el.dataset.tdnum) return tdSetNum(el.dataset.tdnum, el.value);
  if (el.dataset.tdpage!=null){ const v = el.value; return tdChange(w=>{ w.page = w.page||{}; w.page[el.dataset.tdpage] = v===''?'':tdNum(v); }, {merge:'page'+el.dataset.tdpage, panels:false}); }
  if (el.dataset.tdcolor) return tdChange(w=>{ w.colors[el.dataset.tdcolor] = el.value.replace('#','').toUpperCase(); }, {merge:'col'+el.dataset.tdcolor, panels:false});
  if (el.dataset.tdcolorown) return tdChange(w=>setPath(w, el.dataset.tdcolorown, el.value.replace('#','').toUpperCase()), {merge:'own'+el.dataset.tdcolorown, panels:false});
  if (el.dataset.tdbrand!=null) return tdChange(w=>{ w.brandParts[+el.dataset.tdbrand][0] = el.value; }, {merge:'brand', panels:false});
  if (el.dataset.tdpath && (el.tagName==='TEXTAREA' || el.type==='text')) return tdChange(w=>setPath(w, el.dataset.tdpath, el.value), {merge:el.dataset.tdpath, panels:false});
});
document.addEventListener('change', async e=>{
  const el = e.target; if (!el.closest || !el.closest('#tddlg') || !TD.work) return;
  try{
    if (el.classList.contains('td-pick')){ if (tdDirty() && !confirm('Перейти к другому шаблону без сохранения изменений?')){ el.value = TD.id; return; } TD.saved = JSON.stringify(TD.work); return openTemplateDesigner(el.value); }
    // поля ввода уже применены при наборе; окно здесь не перерисовывается, чтобы не потерять щелчок, снявший фокус
    if (el.dataset.tdnum || el.dataset.tdpage!=null || el.dataset.tdcolor || el.dataset.tdcolorown || el.dataset.tdbrand!=null) return;
    if (el.dataset.tdbrandc!=null) return tdChange(w=>{ w.brandParts[+el.dataset.tdbrandc][1] = el.value; });
    if (el.type==='checkbox' && el.dataset.tdpath) return tdChange(w=>{ setPath(w, el.dataset.tdpath, el.checked); if (/\.lock$/.test(el.dataset.tdpath) && el.checked) setPath(w, el.dataset.tdpath.replace(/\.lock$/,'.heightCm'), 0); });
    if (el.tagName==='SELECT' && el.dataset.tdpath) return tdChange(w=>setPath(w, el.dataset.tdpath, el.value));
    if (el.dataset.tdpath) return;
    if (el.dataset.tdup && el.files[0]){
      const kind = el.dataset.tdup, f = el.files[0]; el.value = '';
      TD.note = 'Загружаю картинку…'; tdTop();
      const name = await tdUpload(kind==='replace' ? 'extra' : kind, f); TD.note = '';
      if (kind==='clients') return tdChange(w=>{ w.clientsImage = name; });
      if (kind==='header') return tdChange(w=>{ w.header.logo = name; w.header.on = true; });
      if (kind==='replace'){ const k = TD.sel.key; return tdChange(w=>{ const x = w.images.find(q=>'X_'+q.id===k); if (x) x.file = name; }); }
      const id = tdUid(), h = tdHere();
      tdChange(w=>{ w.images.push({ id, file:name, name:f.name.replace(/\.[^.]+$/,'').slice(0,60), place:h.place, float:true, x:Math.max(0, h.x), y:h.y, widthCm:6, heightCm:0, align:'center' }); }, {now:true});
      TD.sel = {kind:'img', key:'X_'+id}; TD.tab = 'objs'; tdPanels();
    }
  }catch(err){ TD.note = ''; tdTop(); alert('Не получилось: '+(err.message||err)); }
});
document.addEventListener('keydown', e=>{
  const d = $('#tddlg'); if (!d || !d.open || !TD.work) return;
  const inField = e.target.closest('input,textarea,select,[contenteditable]');
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey){
    if (inField) return;
    if (k==='z' || k==='я'){ e.preventDefault(); tdUndo(!e.shiftKey); }
    else if (k==='y' || k==='н'){ e.preventDefault(); tdUndo(false); }
    else if (k==='s' || k==='ы'){ e.preventDefault(); if (tdDirty()) tdSave().catch(err=>alert('Не сохранено: '+(err.message||err))); }
    else if (k==='d' || k==='в'){ e.preventDefault(); tdDup(); }
    return;
  }
  if (inField || !TD.sel) return;
  const st = e.shiftKey ? 1 : 0.1, mv = { arrowleft:[-st,0], arrowright:[st,0], arrowup:[0,-st], arrowdown:[0,st] }[k];
  if (mv){ e.preventDefault(); return tdNudge(mv[0], mv[1]); }
  if ((k==='delete' || k==='backspace') && tdOwn(TD.sel)){ e.preventDefault(); tdDel(); }
});
// Ctrl + колесо — масштаб
document.addEventListener('wheel', e=>{ if (!(e.ctrlKey||e.metaKey) || !e.target.closest || !e.target.closest('#tdCanvas')) return; e.preventDefault(); tdZoom(e.deltaY < 0 ? .1 : -.1); }, {passive:false});

// раздел документа под точкой: последняя метка начала раздела выше неё
function tdSecAt(y){
  let best = null;
  for (const m of tdQA('[data-tdsec]')) if (m.getBoundingClientRect().top <= y + 2) best = m.dataset.tdsec;
  return best || (TD.work.sections.find(s=>s.on)||{}).id || null;
}

// ---------------------------------------------------------------- мышь: перенос и размер
// направляющие: левый край, центр и правый край текста страницы (притягивают в пределах 6 px)
function tdSnapX(left, width, page){
  const a = tdAnchors().find(q=>q.page===page) || tdAnchors()[0]; if (!a) return { dx:0 };
  const cols = [a.r.left, a.r.left + a.r.width/2, a.r.right], pr = page ? page.getBoundingClientRect() : null;
  if (pr) cols.push(pr.left + pr.width/2);
  let best = { dx:0, d:7, x:null };
  for (const c of cols) for (const [edge, off] of [[left,0],[left+width/2,width/2],[left+width,width]]){ const d = Math.abs(edge-c); if (d < best.d) best = { dx:c-edge, d, x:c, off }; }
  return best;
}
function tdGuide(x){ const g = $('#tdGuide'), cv = $('#tdCanvas'); if (!g) return; if (x==null){ g.hidden = true; return; }
  const c = cv.getBoundingClientRect(); g.style.left = (x - c.left + cv.scrollLeft)+'px'; g.style.top = cv.scrollTop+'px'; g.style.height = cv.clientHeight+'px'; g.hidden = false; }

document.addEventListener('pointerdown', e=>{
  const d = $('#tddlg'); if (!d || !d.open || e.button!==0 || !TD.work) return;
  const hdl = e.target.closest('#tdSelBox .td-h');
  if (hdl && TD.sel) return tdResizeStart(e, hdl.dataset.h);
  if (!e.target.closest('#tdPages')) return;
  const t = e.target, lb = t.closest('.kp-lbl[data-tdl]'), imw = t.tagName==='IMG' && t.closest('[data-tdi]'), st = !lb && !imw && t.closest('[data-tds]');
  const sel = lb ? {kind:'label', key:lb.dataset.tdl, el:lb} : imw ? {kind:'img', key:imw.dataset.tdi, el:t} : st ? {kind:'style', key:st.dataset.tds, text:(st.closest('p')||st).textContent, el:st} : null;
  if (!sel || sel.key==='headerText') return;
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY, own = tdItem(sel), cv = $('#tdCanvas');
  let drag = false, moved = [], r0 = null, last = {dx:0, dy:0, snap:null};
  const mv = ev=>{
    let dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!drag){ if (Math.hypot(dx, dy) < 5) return; drag = true; TD.drag = true;
      if (TD.sel?.key !== sel.key){ TD.sel = sel; tdPanels(); tdMarkSel(); }
      r0 = sel.el.getBoundingClientRect();
      // что двигается на экране: свой объект — его рамка (или сам он), элемент макета — все его абзацы
      moved = own ? [sel.el.closest('.kp-float') || sel.el] : [...new Set(tdEls(sel).map(x=>x.closest('p')||x))];
      moved.forEach(m=>m.classList.add('td-moving')); $('#tdMini').hidden = true; }
    let snap = null;
    if (own){ const s = tdSnapX(r0.left+dx, r0.width, tdPageAt(r0.top+dy) || tdPageAt(ev.clientY)); if (s.x!=null){ dx += s.dx; snap = s.x; } }
    last = { dx, dy, snap };
    moved.forEach(m=>{ m.style.transform = `translate(${dx/TD.z}px, ${dy/TD.z}px)`; });
    tdGuide(snap);
    const box = $('#tdSelBox'); if (own && box){ tdPlaceBox({left:r0.left+dx, top:r0.top+dy, width:r0.width, height:r0.height}); const a = tdAnchorFor(r0.left+dx, r0.top+dy);
      if (a) box.querySelector('.td-dim').textContent = `X ${tdCm(a.x)} · Y ${tdCm(a.y)} см`; }
    const c = cv.getBoundingClientRect(); if (ev.clientY < c.top+30) cv.scrollTop -= 12; else if (ev.clientY > c.bottom-30) cv.scrollTop += 12;
  };
  const up = ()=>{
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); tdGuide(null);
    if (!drag) return;
    TD.drag = false; TD.clickBlock = true; setTimeout(()=>{ TD.clickBlock = false; }, 0);
    const { dx, dy } = last, ppc = tdPxPerCm();
    if (own){
      const a = tdAnchorFor(r0.left+dx, r0.top+dy);
      if (!a){ moved.forEach(m=>{ m.style.transform = ''; }); return; }
      if (a.far) toast('На этой странице нет места привязки — объект привязан к ближайшему разделу выше');
      tdChange(()=>{ const q = tdItem(sel); if (!q) return; const was = q.float; Object.assign(q, { float:true, place:a.place, x:a.x, y:a.y });
        if (!was && sel.kind==='label'){ q.widthCm = q.widthCm || tdR(r0.width/ppc, 100); q.heightCm = q.heightCm || tdR(r0.height/ppc, 100); } }, {now:true});
    } else {
      const pk = tdParaKey(sel); if (!pk) return;
      tdChange(w=>{ const p = w.para[pk] = w.para[pk] || {};
        if (Math.abs(dx) > 2) p.indent = tdR((+p.indent||0) + dx/ppc, 100);
        if (Math.abs(dy) > 2) p.before = tdR((+p.before||0) + dy/ppc*28.35, 2);
        if (!Object.keys(p).length) delete w.para[pk]; }, {now:true});
      if (dy < -2) toast('Сдвиг вверх ограничен отступом макета над элементом');
    }
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up, {once:true});
});

// размер за маркеры: ширина и высота независимо; Shift (или «Сохранять пропорции») — пропорционально
function tdResizeStart(e, h){
  const sel = TD.sel, el = tdPrimary(); if (!el || !(sel.kind==='img' || sel.kind==='label')) return;
  e.preventDefault(); e.stopPropagation();
  const own = tdItem(sel), r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, ratio = r0.width/Math.max(1, r0.height), ppc = tdPxPerCm();
  const cont = own && own.float ? el.closest('.kp-float') : null;
  let g = { L:r0.left, T:r0.top, W:r0.width, H:r0.height };
  TD.drag = true; $('#tdMini').hidden = true;
  const mv = ev=>{
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    let L = r0.left, T = r0.top, R = r0.right, B = r0.bottom;
    if (h.includes('e')) R += dx; if (h.includes('w')) L += dx; if (h.includes('s')) B += dy; if (h.includes('n')) T += dy;
    let W = Math.max(8, R-L), H = Math.max(8, B-T);
    if ((ev.shiftKey || (own && own.lock)) ){
      if (h.length===2){ if (W/H > ratio) H = W/ratio; else W = H*ratio; }
      else if (h==='e' || h==='w') H = W/ratio; else W = H*ratio;
    }
    if (h.includes('w')) L = R - W; if (h.includes('n')) T = B - H;
    g = { L, T, W, H };
    el.style.width = (W/TD.z)+'px'; el.style.height = (H/TD.z)+'px'; el.style.maxWidth = 'none';
    if (cont) cont.style.transform = `translate(${(L-r0.left)/TD.z}px, ${(T-r0.top)/TD.z}px)`;
    tdPlaceBox({ left:L, top:T, width:W, height:H });
  };
  const up = ()=>{
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); TD.drag = false;
    const wcm = tdR(g.W/ppc, 100), hcm = tdR(g.H/ppc, 100), dxc = tdR((g.L-r0.left)/ppc, 100), dyc = tdR((g.T-r0.top)/ppc, 100);
    if (Math.abs(g.W-r0.width) < 1 && Math.abs(g.H-r0.height) < 1) return tdMarkSel();
    tdChange(w=>{
      const q = tdItem(sel);
      if (q){ q.widthCm = wcm; if (sel.kind==='label' || !q.lock) q.heightCm = hcm; else q.heightCm = 0;
        if (q.float){ q.x = tdR((+q.x||0)+dxc, 100); q.y = tdR((+q.y||0)+dyc, 100); } return; }
      if (sel.key==='headerLogo'){ w.header.logoWidthCm = wcm; w.header.logoHeightCm = hcm; return; }
      w.imgSize[sel.key] = { w:wcm, h:hcm };
    }, {now:true});
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up, {once:true});
}

// наведение — подсказка, что можно выбрать
document.addEventListener('mouseover', e=>{
  const t = e.target.closest && e.target.closest('#tdPages [data-tds], #tdPages [data-tdi] img, #tdPages .kp-lbl'); if (!t || !TD.work) return;
  const k = t.dataset.tds ? tdStyleLabel(t.dataset.tds)+' — щёлкните, чтобы изменить; перетащите, чтобы сдвинуть'
    : t.classList.contains('kp-lbl') ? 'Надпись — перетащите в любое место'
    : /^X_/.test((t.closest('[data-tdi]')||{}).dataset?.tdi||'') ? 'Картинка шаблона — перетащите в любое место' : (TD_IMG[(t.closest('[data-tdi]')||{}).dataset.tdi]||'Картинка')+' — маркеры меняют размер';
  if (t.title !== k) t.title = k;
});
// перетаскивание разделов в списке «Структура» — указателем (мышь, перо, палец), за любое место строки, кроме переключателя
document.addEventListener('pointerdown', e=>{
  const li = e.target.closest && e.target.closest('#tdSecs li'); if (!li || e.button!==0 || e.target.closest('.sw')) return;
  const list = li.parentElement, from = +li.dataset.tdsec, y0 = e.clientY; let drag = false, to = from;
  const items = () => [...list.children];
  const mv = ev=>{
    if (!drag){ if (Math.abs(ev.clientY-y0) < 5) return; drag = true; li.classList.add('drag'); document.body.classList.add('td-sorting'); }
    ev.preventDefault();
    li.style.transform = `translateY(${ev.clientY-y0}px)`;
    items().forEach(x=>x.classList.remove('over-t','over-b'));
    const others = items().filter(x=>x!==li); let tgt = null, after = false;
    for (const x of others){ const r = x.getBoundingClientRect(); if (ev.clientY < r.top + r.height/2){ tgt = x; after = false; break; } tgt = x; after = true; }
    if (tgt){ tgt.classList.add(after ? 'over-b' : 'over-t'); const k = +tgt.dataset.tdsec; to = after ? k + 1 : k; if (to > from) to--; }
  };
  const up = ()=>{ removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    document.body.classList.remove('td-sorting'); li.style.transform = ''; li.classList.remove('drag'); items().forEach(x=>x.classList.remove('over-t','over-b'));
    if (!drag) return;
    TD.clickBlock = true; setTimeout(()=>{ TD.clickBlock = false; }, 0);
    if (to !== from && to >= 0) tdChange(w=>{ const [x] = w.sections.splice(from, 1); w.sections.splice(to, 0, x); }, {now:true}); };
  addEventListener('pointermove', mv, {passive:false}); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
// встроенное перетаскивание браузера (картинки, выделенный текст) в документе не нужно — оно перехватывало мышь,
// и объект «возвращался» на место
document.addEventListener('dragstart', e=>{ if (e.target.closest && e.target.closest('#tdPages, #tdCanvas')) e.preventDefault(); }, true);
addEventListener('resize', ()=>{ if (TD.sel) tdMarkSel(); });
document.addEventListener('scroll', e=>{ if (e.target && e.target.id==='tdCanvas' && TD.sel && !TD.drag) tdMini(); }, true);
