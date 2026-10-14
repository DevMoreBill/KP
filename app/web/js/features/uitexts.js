// Тексты интерфейса, изменённые администратором: названия меню и разделов, подписи полей, кнопки, подсказки
// и всплывающие окна. Хранятся на сервере ({исходный текст: новый}) и применяются у всех: после любой перерисовки
// текст заменяется (MutationObserver). Режим правки — «⋯» → «✎ Тексты интерфейса» (только администратор):
// у текстов появляется карандаш, щелчок по нему — окно правки; «Вернуть исходный» — убрать замену.
'use strict';

const UIT = { map:{}, rev:{}, edit:false, raf:0 };
const UIT_ATTRS = ['title', 'placeholder', 'aria-label'];
const uitNorm = t => String(t||'').replace(/\s+/g, ' ').trim();
const uitSkip = el => !el || !!el.closest('script,style,textarea,select,[contenteditable="true"],.uit-dlg,.uit-pen,.uit-bar,[data-uit-skip]');

function uitLoad(){
  return api('/api/uitexts').then(m=>{ UIT.map = m && typeof m==='object' ? m : {}; uitIndex(); uitApply(document.body); }).catch(()=>{});
}
function uitIndex(){ UIT.rev = {}; for (const [k,v] of Object.entries(UIT.map)) UIT.rev[uitNorm(v)] = k; }

// замена одного текстового узла с сохранением пробелов по краям
function uitTextNode(n, map){
  const raw = n.nodeValue, t = uitNorm(raw); if (!t) return;
  const nv = map[t]; if (nv == null) return;
  const want = raw.match(/^\s*/)[0] + nv + raw.match(/\s*$/)[0];
  if (raw !== want) n.nodeValue = want;
}
function uitApply(root, map=UIT.map){
  if (!root || !Object.keys(map).length) return;
  if (root.nodeType === 3){ if (!uitSkip(root.parentElement)) uitTextNode(root, map); return; }
  if (root.nodeType !== 1 || uitSkip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => uitSkip(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n; while ((n = w.nextNode())) uitTextNode(n, map);
  for (const el of [root, ...root.querySelectorAll('[title],[placeholder],[aria-label]')]) for (const a of UIT_ATTRS){
    if (!el.hasAttribute(a) || uitSkip(el)) continue;
    const nv = map[uitNorm(el.getAttribute(a))]; if (nv != null && el.getAttribute(a) !== nv) el.setAttribute(a, nv);
  }
}

// ---------- режим правки: карандаш у каждого «жёсткого» текста
// свой текст элемента — его текстовые узлы без вложенных элементов; данные (суммы, даты, числа) не правятся
function uitOwnText(el){
  let best = null;
  for (const n of el.childNodes) if (n.nodeType === 3 && uitNorm(n.nodeValue).length > (best ? uitNorm(best.nodeValue).length : 0)) best = n;
  return best;
}
const uitIsData = t => /\d{3}|₽|\d+[.,]\d+|\d{2}\.\d{2}|^[\d\s.,%+−-]*$/.test(t) || !/[А-Яа-яЁёA-Za-z]{2}/.test(t);
function uitCandidate(el){
  if (uitSkip(el) || el.closest('input,option')) return false;
  if (el.closest('.brand b,.brand i,#side .words,#form .it-name,#form .iname,.dl-it td.c-nm,.dl-t td.c-ev,.cw-row,.jr,.st-list,.dl-cbl')) return false;   // позиции, журнал, списки — данные
  const n = uitOwnText(el); if (n && !uitIsData(uitNorm(n.nodeValue))) return true;
  return UIT_ATTRS.some(a => el.hasAttribute(a) && /[А-Яа-яЁё]{3}/.test(el.getAttribute(a)||'') && !uitIsData(uitNorm(el.getAttribute(a))));
}
function uitMark(){
  UIT.raf = 0; if (!UIT.edit) return;
  const top = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  for (const el of document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,label,legend,th,summary,button,a,span,p,small,b,em,div,li,dt,i'))
    if (!el.querySelector(':scope > .uit-pen') && uitCandidate(el) && el.getClientRects().length){
      const p = document.createElement('span'); p.className = 'uit-pen'; p.textContent = '✎'; p.title = 'Изменить текст'; p.setAttribute('aria-hidden', 'true'); el.appendChild(p);
    }
  let bar = top.querySelector(':scope > .uit-bar');
  if (!bar){ document.querySelectorAll('.uit-bar').forEach(b=>b.remove());
    bar = document.createElement('div'); bar.className = 'uit-bar';
    bar.innerHTML = '<span>✎ Правка текстов: нажмите карандаш у надписи или подсказки</span><button type="button" class="btn" data-uitoff>Готово</button>'; top.appendChild(bar); }
}
const uitSchedule = () => { if (UIT.edit && !UIT.raf) UIT.raf = requestAnimationFrame(uitMark); };

function uitToggle(on){
  UIT.edit = on==null ? !UIT.edit : !!on;
  document.body.classList.toggle('uit-edit', UIT.edit);
  if (!UIT.edit){ document.querySelectorAll('.uit-pen,.uit-bar').forEach(x=>x.remove()); return; }
  if (!ADMIN.on){ UIT.edit=false; document.body.classList.remove('uit-edit'); toast('Править тексты может администратор: войдите в «Настройки»'); return; }
  toast('Правка текстов: нажмите ✎ у надписи. «Готово» — выйти'); uitSchedule();
}

// окно правки: текст элемента и его всплывающая подсказка (title), подсказка поля (placeholder)
function uitOpen(el){
  const n = uitOwnText(el), cur = n ? uitNorm(n.nodeValue) : '';
  const fields = [];
  if (cur && !uitIsData(cur)) fields.push({kind:'text', label:'Текст', cur});
  for (const a of UIT_ATTRS){ const v = uitNorm(el.getAttribute(a)); if (v && !uitIsData(v) && v!==cur && !fields.some(f=>f.cur===v)) fields.push({kind:a, label:a==='title'?'Всплывающая подсказка':a==='placeholder'?'Подсказка в поле':'Название для экранного диктора', cur:v}); }
  if (!fields.length) return;
  fields.forEach(f=>{ f.orig = UIT.rev[f.cur] || f.cur; });
  const d = document.createElement('dialog'); d.className = 'uit-dlg';
  d.innerHTML = `<form method="dialog"><h3>Текст интерфейса</h3>
    ${fields.map((f,i)=>`<label class="f"><span>${esc(f.label)}${f.orig!==f.cur?' <em class="muted">изменён</em>':''}</span>
      <textarea rows="${Math.min(6, Math.ceil(f.cur.length/60)+1)}" data-uitf="${i}">${esc(f.cur)}</textarea>
      <small class="muted">Исходный: «${esc(f.orig)}»</small></label>`).join('')}
    <p class="muted">Изменение увидят все пользователи. Меняются все места, где встречается этот же текст.</p>
    <div class="row uit-acts"><button type="button" class="btn ghost" data-uitreset>Вернуть исходный</button><span class="sp"></span>
      <button type="button" class="btn" data-uitcancel>Отмена</button><button type="submit" class="btn primary">Сохранить</button></div></form>`;
  ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(d);
  const done = () => { d.close(); d.remove(); };
  const save = async reset => {
    const old = {...UIT.map}, back = {};
    fields.forEach((f,i)=>{ const v = reset ? f.orig : uitNorm(d.querySelector(`[data-uitf="${i}"]`).value);
      if (!v) return;
      if (UIT.map[f.orig] != null) back[uitNorm(UIT.map[f.orig])] = f.orig;   // прежняя замена — вернуть на экране
      if (v === f.orig) delete UIT.map[f.orig]; else UIT.map[f.orig] = v; });
    try{ await api('/api/uitexts', {method:'PUT', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify(UIT.map)}); }
    catch(e){ UIT.map = old; toast('Не сохранено: '+(e.message||e)); return; }
    uitIndex(); uitApply(document.body, back); uitApply(document.body); done(); toast(reset ? 'Возвращён исходный текст' : 'Текст изменён'); uitSchedule();
  };
  d.addEventListener('submit', e=>{ e.preventDefault(); save(false); });
  d.querySelector('[data-uitreset]').onclick = () => save(true);
  d.querySelector('[data-uitcancel]').onclick = done;
  d.addEventListener('cancel', done);
  d.showModal(); d.querySelector('textarea')?.select();
}

// щелчок по карандашу — правка (обычное действие элемента не выполняется); «Готово» — выход из режима
document.addEventListener('click', e=>{
  if (e.target.closest('[data-uitoff]')){ e.preventDefault(); e.stopPropagation(); uitToggle(false); return; }
  if (!UIT.edit) return;
  const pen = e.target.closest('.uit-pen'); if (!pen) return;
  e.preventDefault(); e.stopPropagation(); uitOpen(pen.parentElement);
}, true);

new MutationObserver(ms=>{
  // замен нет (обычный случай) — записи об изменениях страницы не перебираются: каждая перерисовка даёт их сотни
  if (Object.keys(UIT.map).length) for (const m of ms){
    if (m.type === 'characterData') uitApply(m.target);
    else if (m.type === 'attributes') uitApply(m.target);
    else for (const n of m.addedNodes) if (!(n.nodeType===1 && (n.classList.contains('uit-pen')||n.classList.contains('uit-bar')))) uitApply(n);
  }
  uitSchedule();
}).observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:UIT_ATTRS});

// пункт меню «✎ Тексты интерфейса» — только у администратора
setInterval(()=>{ document.querySelectorAll('[data-a="uitexts"]').forEach(b=>{ b.hidden = !ADMIN.on; }); if (UIT.edit && !ADMIN.on) uitToggle(false); }, 1500);
