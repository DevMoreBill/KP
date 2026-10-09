// Общие помощники: DOM, экранирование, форматирование денег и чисел, даты, уведомления, файлы.
'use strict';

const $ = (s, el=document) => el.querySelector(s);

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const uid = () => Math.random().toString(36).slice(2,9);

const today = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

const { money, totals, plural, CURS } = KPGen;

const fnum = v => String(v).replace('.',',');

function numOf(v){ if (typeof v==='number') return v; const m=String(v??'').replace(/\s/g,'').replace(',','.').match(/-?\d+(\.\d+)?/); return m?+m[0]:null; }

const words = (k,c) => KPGen.words(k, c || (S && S.pricing && S.pricing.cur) || 'RUB');

async function dataURLtoBlobAsync(u){ return (await fetch(u)).blob(); }

const norm = s => String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»"]/g,'').replace(/\s+/g,' ').trim();

async function toDataURL(img){ if (!img) return null; if (String(img.src).startsWith('data:')) return img.src; return blobToURL(await (await fetch(img.src)).blob()); }

// уведомление показывается поверх открытого окна: всё, что вне модального окна, браузер прячет под затемнением
function toast(t){ let el=$('#toast'); if (!el){ el=document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); }   // окно могло перерисоваться вместе с уведомлением
  const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body; if (el.parentNode!==host) host.appendChild(el); el.textContent=t; el.classList.add('on'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'),2600); }

function parsePrice(s){
  s = String(s||'').replace(/[\s\u00A0]/g,'').replace(',', '.');
  if (!s) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [a,b=''] = s.split('.'); return (+a)*100 + (+(b+'00').slice(0,2));
}

const fmtPrice = k => k ? money(k) : '';

function fmtRub(v){ return v==null?'—':(Math.round(v)).toLocaleString('ru-RU')+' руб.'; }

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
