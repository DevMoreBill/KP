// Общие помощники: DOM, экранирование, форматирование денег и чисел, даты, уведомления, файлы.
'use strict';

const $ = (s, el=document) => el.querySelector(s);

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const uid = () => Math.random().toString(36).slice(2,9);

// дата по местному времени в виде ГГГГ-ММ-ДД (toISOString дал бы дату по Гринвичу — ночью это вчерашний день)
const isoDay = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

const today = () => isoDay(new Date());

const { money, totals, plural, CURS } = KPGen;

const fnum = v => String(v).replace('.',',');

function numOf(v){ if (typeof v==='number') return v; const m=String(v??'').replace(/\s/g,'').replace(',','.').match(/-?\d+(\.\d+)?/); return m?+m[0]:null; }

const words = (k,c) => KPGen.words(k, c || (S && S.pricing && S.pricing.cur) || 'RUB');

async function dataURLtoBlobAsync(u){ return (await fetch(u)).blob(); }

const norm = s => String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»"]/g,'').replace(/\s+/g,' ').trim();


// уведомление показывается поверх открытого окна: всё, что вне модального окна, браузер прячет под затемнением
function toast(t, ms=2600){ let el=$('#toast'); if (!el){ el=document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); }   // окно могло перерисоваться вместе с уведомлением
  const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body; if (el.parentNode!==host) host.appendChild(el); el.textContent=t; el.classList.add('on'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'), ms); }

function parsePrice(s){
  s = String(s||'').replace(/[\s\u00A0]/g,'').replace(',', '.');
  if (!s) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [a,b=''] = s.split('.'); return (+a)*100 + (+(b+'00').slice(0,2));
}

const fmtPrice = k => k ? money(k) : '';

function fmtRub(v){ return v==null?'—':(Math.round(v)).toLocaleString('ru-RU')+' руб.'; }

// числа, деньги, размер файла и время для показа на экране (русская запись: «1 234 567 ₽», «16.10.2026, 14:05»)
class Fmt {
  static DATE_TIME = {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'};
  static num(v){ return Number(v||0).toLocaleString('ru-RU'); }
  /** рубли без копеек; не посчитано (нет данных) — прочерк */
  static rub(v){ return Number.isFinite(v) ? Math.round(v).toLocaleString('ru-RU')+' ₽' : '—'; }
  static size(bytes){ const b=+bytes||0, MB=1048576;
    return b<MB ? Math.max(1, Math.round(b/1024))+' КБ' : (b/MB).toFixed(b<10*MB ? 1 : 0).replace('.', ',')+' МБ'; }
  static dateTime(iso){ const d=iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString('ru-RU', Fmt.DATE_TIME) : ''; }
}

// значение по пути «a.b.c» в объекте; запись создаёт недостающие вложенные объекты
const getPath = (o, k) => String(k).split('.').reduce((a, p) => a == null ? a : a[p], o);
function setPath(o, k, v){ const ps=String(k).split('.'); let a=o; ps.slice(0,-1).forEach(p=>{ if (a[p]==null || typeof a[p]!=='object') a[p]={}; a=a[p]; }); a[ps[ps.length-1]]=v; }

const fsafe=s=>String(s||'').replace(/[«»"'\\/:*?<>|]/g,'').replace(/\s+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');

const b64 = u => u.split(',')[1];

async function saveFile(name, blob){
  if (window.showSaveFilePicker){
    try{
      const ext=name.split('.').pop();
      const types = ext==='docx' ? [{description:'Документ Word',accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}] : ext==='pdf' ? [{description:'Документ PDF',accept:{'application/pdf':['.pdf']}}] : [{description:'Каталог',accept:{'application/json':['.json']}}];
      const h=await window.showSaveFilePicker({suggestedName:name, types});
      const w=await h.createWritable(); await w.write(blob); await w.close(); return true;
    }catch(e){ if (e && e.name==='AbortError') return false; }
  }
  saveFileA(name, blob); return true;
}

function saveFileA(name, blob){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name; (document.querySelector('dialog[open]')||document.body).appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),4000); }

/** окно поверх всего: new Modal(html, класс); m.$(селектор), m.close(); закрытое окно удаляется со страницы */
class Modal {
  constructor(html, cls=''){ const d=this.d=document.createElement('dialog'); d.className='st-confirm '+cls; d.innerHTML=html;
    document.body.appendChild(d); d.showModal(); d.addEventListener('cancel', ()=>this.close()); d.addEventListener('close', ()=>d.remove()); }
  close(){ if (this.d.open) this.d.close(); }
  $(s){ return this.d.querySelector(s); }

  /** выбор кнопкой data-v: обещание со значением нажатой кнопки; data-v="0" и Esc — null */
  static ask(html){
    return new Promise(res=>{ const m=new Modal(html); let v=null;
      m.d.addEventListener('click', e=>{ const b=e.target.closest('[data-v]'); if (b){ v=b.dataset.v==='0' ? null : b.dataset.v; m.close(); } });
      m.d.addEventListener('close', ()=>res(v)); });
  }

  /** постоянное окно раздела (каталог, «Настройки», руководство…): создаётся при первом открытии и остаётся на странице;
   *  init(d) — один раз, при создании (обработчики окна) */
  static host(id, cls, label, init){
    let d=document.getElementById(id);
    if (!d){ d=document.createElement('dialog'); d.id=id; d.className=cls; d.setAttribute('aria-label', label); document.body.appendChild(d); if (init) init(d); }
    return d;
  }
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

function blobToURL(b){ return new Promise(r=>{ const f=new FileReader(); f.onload=()=>r(f.result); f.readAsDataURL(b); }); }

// Обновить разметку элемента, не пересоздавая совпадающие узлы: фото не загружаются заново, фокус, курсор
// и прокрутка не сбиваются, нажатие не «проваливается» в заменённую кнопку (важно на телефонах).
function morph(el, html){
  const t=document.createElement('template'); t.innerHTML=html; morphKids(el, t.content);
}

// узел с ключом (id, data-id, поле data-p) сопоставляется только с узлом того же ключа, где бы он ни стоял:
// иначе при появлении новой кнопки перед полем ввода поле «превратилось» бы в соседнее вместе с набираемым текстом
function morphKey(n){ return n.nodeType===1 ? (n.id || n.getAttribute('data-id') || n.getAttribute('data-p') || '') : ''; }

function morphSame(a, b){
  if (a.nodeType!==b.nodeType || a.nodeName!==b.nodeName) return false;
  return a.nodeType!==1 || (morphKey(a)===morphKey(b) && (a.type||'')===(b.type||''));
}

function morphKids(a, b){
  const keyed=new Map(); for (const c of a.childNodes){ const k=morphKey(c); if (k && !keyed.has(k)) keyed.set(k,c); }
  let cur=a.firstChild;
  for (const n of [...b.childNodes]){
    const k=morphKey(n); let o=null;
    if (k){ o=keyed.get(k)||null; if (o && !morphSame(o,n)) o=null; if (o) keyed.delete(k); }
    else if (cur && !morphKey(cur) && morphSame(cur,n)) o=cur;
    if (!o){ a.insertBefore(n,cur); continue; }
    if (o===cur) cur=cur.nextSibling; else a.insertBefore(o,cur);
    if (o.nodeType!==1){ if (o.nodeValue!==n.nodeValue) o.nodeValue=n.nodeValue; }
    else morphEl(o,n);
  }
  while (cur){ const nx=cur.nextSibling; if (!(cur.nodeType===1 && cur.hasAttribute('data-morph-keep'))) cur.remove(); cur=nx; }   // всплывающие списки поверх окна — не трогаем
}

function morphEl(o, n){
  for (const at of [...o.attributes]) if (!n.hasAttribute(at.name)) o.removeAttribute(at.name);
  for (const at of [...n.attributes]) if (o.getAttribute(at.name)!==at.value) o.setAttribute(at.name, at.value);
  const tag=o.nodeName;
  if (tag==='INPUT'){
    if (o.type==='checkbox'||o.type==='radio') o.checked=n.hasAttribute('checked');
    else if (o.type!=='file'){ const v=n.getAttribute('value')??''; if (o.value!==v) o.value=v; }
    return; }
  if (tag==='TEXTAREA'){ if (o.value!==n.value) o.value=n.value; return; }
  morphKids(o,n);
  if (tag==='SELECT'){ const v=n.querySelector('option[selected]')?.value ?? n.querySelector('option')?.value; if (v!=null && o.value!==v) o.value=v; }
}

// картинка на странице, файл которой пропал (перемещён, удалён, не скопирован на этот компьютер), —
// спокойная заглушка «нет фото» вместо значка сломанной картинки
const IMG_MISS='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" rx="10" fill="#eef3f9"/><path d="M52 78l20-24 14 16 10-11 18 19z" fill="#c3d2e4"/><circle cx="98" cy="44" r="8" fill="#c3d2e4"/><text x="80" y="104" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#8aa0b8">нет фото</text></svg>');
document.addEventListener('error', e=>{ const t=e.target;
  if (t && t.tagName==='IMG' && t.src!==IMG_MISS){ t.dataset.miss='1'; t.alt=t.alt||'нет фото'; t.src=IMG_MISS; } }, true);
