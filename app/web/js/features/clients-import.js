// Загрузка клиентов списком ИНН: реквизиты из ЕГРЮЛ ФНС (или Checko / DaData, если указаны ключи) → справочник клиентов.
'use strict';

const CI = { list:[], rows:[], run:false, stop:false };
const CI_PAUSE = 1300;   // пауза между запросами: сайт налоговой ограничивает частые обращения

// все ИНН из текста или таблицы: 10 цифр — организация, 12 — ИП; повторы убираются
function innsFrom(text){
  const found=[], bad=[], seen=new Set();
  for (const m of String(text||'').matchAll(/(^|\D)(\d{10}|\d{12})(?=\D|$)/g)){
    const inn=m[2]; if (seen.has(inn)) continue; seen.add(inn);
    (validInn(inn)?found:bad).push(inn);
  }
  return { found, bad };
}

// текст из файла: .xlsx — все ячейки всех листов, иначе — как текст
async function textOfFile(f){
  if (/\.xlsx$/i.test(f.name)){
    const z=await JSZip.loadAsync(await f.arrayBuffer()); let t='';
    for (const n of Object.keys(z.files)) if (/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(n)) t+=' '+(await z.file(n).async('string')).replace(/<[^>]+>/g,' ');
    return t;
  }
  return await f.text();
}

function openClientsImport(){
  const d=$('#dlg'); d.className='wide'; CI.rows=[]; CI.list=[];
  d.innerHTML=`<div class="dlg-h"><h3>Загрузить клиентов по списку ИНН</h3><button class="icon" type="button" data-ci="close" aria-label="Закрыть">✕</button></div>
   <div class="dlg-b" id="ciBody">
    <p class="muted" style="margin-top:0">Вставьте ИНН — столбец из Excel, через запятую или по одному в строке — или выберите файл (.xlsx, .csv, .txt). Программа возьмёт реквизиты в реестре ФНС (ЕГРЮЛ/ЕГРИП) и добавит клиентов в справочник. Уже известные клиенты обновятся: контакты и объекты сохранятся.</p>
    <textarea id="ciText" rows="7" placeholder="7707083893&#10;7729101200&#10;…" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace"></textarea>
    <div class="row" style="margin-top:8px"><label class="btn ghost">Выбрать файл…<input type="file" id="ciFile" accept=".xlsx,.csv,.txt" hidden></label><span class="muted" id="ciCount"></span><span style="flex:1"></span>
      <button class="btn primary" type="button" data-ci="start" disabled>Загрузить реквизиты</button></div>
    <div id="ciRes"></div></div>`;
  d.showModal();
}

function ciCount(){
  if (!$('#ciText')) return;
  const {found,bad}=innsFrom($('#ciText').value); CI.list=found;
  $('#ciCount').innerHTML = found.length||bad.length ? `Найдено ИНН: <b>${found.length}</b>${bad.length?` · <span class="bad-t">с ошибкой: ${bad.length} (${esc(bad.slice(0,5).join(', '))}${bad.length>5?'…':''})</span>`:''}` : '';
  const b=document.querySelector('[data-ci="start"]'); if (b) b.disabled=!found.length||CI.run;
}

const CI_ST = { wait:'в очереди', work:'запрашиваю…', new:'добавлен', upd:'обновлён', err:'ошибка' };
function ciTable(){
  if (!$('#ciRes')) return;   // окно закрыто — загрузка идёт до остановки
  const done=CI.rows.filter(r=>r.st!=='wait'&&r.st!=='work').length, n=CI.rows.length;
  const cnt=k=>CI.rows.filter(r=>r.st===k).length;
  $('#ciRes').innerHTML = `<div class="ci-prog"><div style="width:${n?done/n*100:0}%"></div></div>
    <div class="row" style="margin:6px 0 10px"><span>${CI.run?`Обработано ${done} из ${n}`:`Готово: добавлено <b>${cnt('new')}</b>, обновлено <b>${cnt('upd')}</b>${cnt('err')?`, ошибок <b class="bad-t">${cnt('err')}</b>`:''}`}</span><span style="flex:1"></span>
      ${CI.run?'<button class="btn ghost" type="button" data-ci="stop">Остановить</button>':`${cnt('err')?'<button class="btn ghost" type="button" data-ci="retry">Повторить ошибки</button>':''}<button class="btn" type="button" data-ci="csv">Скачать список (Excel)</button>`}</div>
    <div class="ci-tbl"><table><thead><tr><th>ИНН</th><th>Клиент</th><th>КПП</th><th>Статус</th><th>Итог</th></tr></thead><tbody>
    ${CI.rows.map(r=>`<tr class="${r.st}"><td>${esc(r.inn)}</td><td>${esc(r.c?r.c.name:'')}${r.c&&r.c.address?`<small>${esc(r.c.address)}</small>`:''}</td><td>${esc(r.c?r.c.kpp:'')}</td>
      <td>${r.c&&r.c.status?`<span class="st-badge ${/действ/i.test(r.c.status)?'ok':'bad'}">${esc(r.c.status)}</span>`:''}</td><td>${esc(r.st==='err'?r.err:CI_ST[r.st])}</td></tr>`).join('')}</tbody></table></div>`;
}

async function ciRun(list){
  CI.run=true; CI.stop=false; ciCount(); ciTable();
  for (const r of list){
    if (CI.stop) break;
    r.st='work'; ciTable();
    try{
      const p=await api('/api/party?inn='+r.inn);
      if (p.error) throw new Error(p.error.replace(/^Не удалось получить данные\.\s*/,''));
      const known=CLIENTS.find(c=>String(c.inn||'').replace(/\D/g,'')===r.inn);
      const c=Object.assign({}, known||{}, { id:'inn'+(p.inn||r.inn), name:shortName(p.short||p.full), full:p.full||'', inn:p.inn||r.inn, kpp:p.kpp||'', ogrn:p.ogrn||'',
        address:p.address||'', director:p.director||'', directorPost:p.directorPost||'', status:p.status||'', source:p.source||'' });
      r.c=await api('/api/clients/'+c.id,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(c)});
      r.st=known?'upd':'new';
    }catch(e){ r.st='err'; r.err=String(e.message||e).slice(0,160); }
    ciTable();
    if (!CI.stop && list.indexOf(r)<list.length-1) await new Promise(ok=>setTimeout(ok, CI_PAUSE));
  }
  list.forEach(r=>{ if (r.st==='work'||r.st==='wait'){ r.st='err'; r.err='остановлено'; } });
  CI.run=false; await loadClients(); ciTable(); ciCount(); if (typeof renderForm==='function') renderForm();
}

// список для Excel: CSV с разделителем «;» в UTF-8 с BOM — открывается двойным щелчком
function ciCsv(){
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const head=['ИНН','КПП','ОГРН','Краткое наименование','Полное наименование','Юридический адрес','Руководитель','Должность','Статус','Источник','Итог'];
  const lines=[head.map(q).join(';')].concat(CI.rows.map(r=>{ const c=r.c||{};
    return [r.inn,c.kpp,c.ogrn,c.name,c.full,c.address,c.director,c.directorPost,c.status,c.source,r.st==='err'?'Ошибка: '+r.err:CI_ST[r.st]].map(q).join(';'); }));
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
  a.download='Клиенты_по_ИНН_'+today()+'.csv'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },30000);
}

document.addEventListener('input', e=>{ if (e.target.id==='ciText') ciCount(); });
document.addEventListener('change', async e=>{ if (e.target.id!=='ciFile' || !e.target.files[0]) return;
  try{ const t=await textOfFile(e.target.files[0]); const {found}=innsFrom(t); $('#ciText').value=found.join('\n'); ciCount();
    if (!found.length) toast('В файле не найдено ИНН'); }catch(err){ toast('Не удалось прочитать файл: '+err.message); } });
document.addEventListener('click', e=>{
  const b=e.target.closest('[data-ci]'); if (!b) return; const a=b.dataset.ci;
  if (a==='close'){ if (CI.run && !confirm('Остановить загрузку? Уже загруженные клиенты сохранятся.')) return; CI.stop=true; const d=$('#dlg'); d.close(); d.className=''; return; }
  if (a==='start'){ CI.rows=CI.list.map(inn=>({inn, st:'wait'})); ciRun(CI.rows); return; }
  if (a==='retry'){ const l=CI.rows.filter(r=>r.st==='err'); l.forEach(r=>{ r.st='wait'; r.err=''; }); ciRun(l); return; }
  if (a==='stop'){ CI.stop=true; return; }
  if (a==='csv') return ciCsv();
});
