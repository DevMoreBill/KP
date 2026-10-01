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
      const types = ext==='docx' ? [{description:'Документ Word',accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}] : [{description:'Каталог',accept:{'application/json':['.json']}}];
      const h=await window.showSaveFilePicker({suggestedName:name, types});
      const w=await h.createWritable(); await w.write(blob); await w.close(); return true;
    }catch(e){ if (e && e.name==='AbortError') return false; }
  }
  saveFileA(name, blob); return true;
}

function saveFileA(name, blob){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name; (document.querySelector('dialog[open]')||document.body).appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),4000); }

function blobToURL(b){ return new Promise(r=>{ const f=new FileReader(); f.onload=()=>r(f.result); f.readAsDataURL(b); }); }
