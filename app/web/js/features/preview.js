// Предпросмотр КП без скачивания: документ собирается так же, как при сохранении, и показывается в окне
// (vendor/docx-preview). Титул — живое превью в разделе «Титульный лист». PDF — на компьютере-сервере
// (Word или LibreOffice, см. app/pdf_convert.py); если их нет — печать из предпросмотра «Сохранить как PDF».
'use strict';

// документ по текущему КП: без номера и записи в журнал
async function buildKpBlob(){
  if (!S.items.length) throw new Error('добавьте в КП хотя бы одну позицию');
  if (!window.docx || !window.JSZip) throw new Error('не загрузился модуль предпросмотра — обновите страницу');
  const pack=await templatePack(S.template);
  const St=docState(); if (!St.number) St.number=S.number||'—';
  return renderDocx(St, pack, pack.settings);
}

const DOCX_OPTS = { inWrapper:true, breakPages:true, ignoreLastRenderedPageBreak:true, experimental:true, renderHeaders:true, renderFooters:true, useBase64URL:true };

async function renderDocxInto(blob, host){
  const style=document.createElement('div'), body=document.createElement('div');
  await docx.renderAsync(blob, body, style, DOCX_OPTS);
  host.replaceChildren(style, body);
}

// ---------- превью титула в разделе «Титульный лист»
const CVP = { key:'', node:null, t:null, busy:false };

function coverKey(){ try{ return JSON.stringify([S.template, S.cover, S.client, S.date, S.items.map(x=>[x.id, x.photo&&x.photo.src&&x.photo.src.length, x.photo&&x.photo.src&&x.photo.src.slice(-40), x.name, x.qty, x.price, x.attrs, x.hint]), S.manager.name]); }catch(e){ return String(Math.random()); } }

function coverThumbSoon(){
  const box=$('#cvThumb'); if (!box) return;
  if (!S.items.length){ box.innerHTML='<p class="muted cv-empty">Добавьте оборудование — здесь появится титульный лист с фото, как в КП.</p>'; return; }
  if (CVP.node && CVP.key===coverKey()){ box.replaceChildren(CVP.node); return; }
  if (CVP.node) box.replaceChildren(CVP.node);
  box.classList.add('loading');
  clearTimeout(CVP.t); CVP.t=setTimeout(renderCoverThumb, CVP.node?900:150);
}

async function renderCoverThumb(){
  const box=$('#cvThumb'); if (!box || STEP!=='cover') return;
  if (CVP.busy){ CVP.t=setTimeout(renderCoverThumb, 500); return; }
  CVP.busy=true; const key=coverKey();
  try{
    const blob=await buildKpBlob(); const host=document.createElement('div'); host.className='cv-page';
    await renderDocxInto(blob, host);
    const secs=host.querySelectorAll('section.docx'); secs.forEach((s,k)=>{ if (k>0) s.remove(); });
    CVP.node=host; CVP.key=key;
    const b2=$('#cvThumb'); if (b2){ b2.replaceChildren(host); b2.classList.remove('loading'); fitCoverThumb(); }
  }catch(e){ const b2=$('#cvThumb'); if (b2){ b2.classList.remove('loading'); b2.innerHTML=`<p class="muted cv-empty">Превью не построено: ${esc(e.message||e)}</p>`; } }
  CVP.busy=false;
  if (STEP==='cover' && CVP.key!==coverKey()) coverThumbSoon();
}

function fitCoverThumb(){ const box=$('#cvThumb'), sec=box&&box.querySelector('section.docx'); if (!sec) return;
  const w=sec.offsetWidth||794, k=Math.min(1, (box.clientWidth-2)/w); box.style.setProperty('--k', k); box.style.height=Math.ceil((sec.offsetHeight||1123)*k)+'px'; }

addEventListener('resize', ()=>{ if (STEP==='cover') fitCoverThumb(); });

// ---------- окно предпросмотра всего КП
function pvDlg(){ let d=$('#pvdlg'); if (!d){ d=document.createElement('dialog'); d.id='pvdlg'; d.className='kpprev'; document.body.appendChild(d); } return d; }

async function openKpPreview(){
  const d=pvDlg();
  d.innerHTML=`<div class="pv-hd"><h3>Предпросмотр КП${S.number?' № '+esc(S.number):''}</h3><span class="muted pv-note">${S.kpId?'':'Номер присвоится при сохранении'}</span><span class="sp"></span>
      <div class="pv-zoom"><button class="icon" type="button" data-pz="-1" aria-label="Мельче">−</button><span id="pvZ">100%</span><button class="icon" type="button" data-pz="1" aria-label="Крупнее">+</button></div>
      <button class="btn" type="button" data-pva="pdf">Скачать PDF</button><button class="btn" type="button" data-pva="print" title="Печать или «Сохранить как PDF» средствами браузера">Печать</button>
      <button class="btn primary" type="button" data-pva="save"${problems().length?' disabled title="Сначала заполните обязательные поля — список справа"':''}>${S.kpId?'Сохранить изменения':'Сохранить КП'}</button>
      <button class="icon" type="button" data-pva="close" aria-label="Закрыть">✕</button></div>
    <div class="pv-msg" id="pvMsg" hidden></div>
    <div class="pv-body" id="pvBody"><p class="empty">Собираю документ…</p></div>`;
  if (!d.open) d.showModal();
  d.onclick=e=>{ const z=e.target.closest('[data-pz]'); if (z) return pvZoom(+z.dataset.pz);
    const a=e.target.closest('[data-pva]'); if (!a) return;
    if (a.dataset.pva==='close') return d.close();
    if (a.dataset.pva==='print') return pvPrint();
    if (a.dataset.pva==='pdf') return pvPdf(a);
    if (a.dataset.pva==='save'){ d.close(); return download(); } };
  try{ PV.blob=await buildKpBlob(); await renderDocxInto(PV.blob, $('#pvBody')); pvFit(); }
  catch(e){ $('#pvBody').innerHTML=`<p class="empty">Не удалось собрать КП: ${esc(e.message||e)}</p>`; }
}

const PV = { blob:null, z:1 };

function pvApply(){ const b=$('#pvBody'); if (b) b.style.setProperty('--z', PV.z); const t=$('#pvZ'); if (t) t.textContent=Math.round(PV.z*100)+'%'; }

function pvFit(){ const b=$('#pvBody'), s=b&&b.querySelector('section.docx'); if (!s) return; PV.z=Math.max(.4, Math.min(1, (b.clientWidth-48)/s.offsetWidth)); PV.z=Math.round(PV.z*20)/20; pvApply(); }

function pvZoom(dir){ PV.z=Math.max(.3, Math.min(2, Math.round((PV.z+dir*.1)*10)/10)); pvApply(); }

function pvMsg(html, cls){ const m=$('#pvMsg'); if (!m) return; m.hidden=!html; m.className='pv-msg '+(cls||''); m.innerHTML=html||''; }

function pvPrint(){ document.body.classList.add('printing-kp'); const done=()=>{ document.body.classList.remove('printing-kp'); removeEventListener('afterprint', done); }; addEventListener('afterprint', done); window.print(); setTimeout(done, 1500); }

// PDF по текущему КП (без записи в журнал): преобразует компьютер-сервер
async function pdfFromBlob(blob){
  const r=await fetch('/api/pdf?name='+encodeURIComponent(fileName().replace(/\.docx$/i,'.pdf')), {method:'POST', body:blob});
  if (!r.ok) throw new Error((await r.text()).replace(/^PDF не создан:\s*/,'') || 'HTTP '+r.status);
  return r.blob();
}

async function pvPdf(btn){
  if (!PV.blob) return;
  btn.disabled=true; const t=btn.textContent; btn.textContent='Создаю PDF…'; pvMsg('');
  try{ const pdf=await pdfFromBlob(PV.blob); await saveFile(fileName().replace(/\.docx$/i,'.pdf'), pdf); pvMsg('PDF готов.', 'ok'); }
  catch(e){ pvMsg(`PDF не создан: ${esc(e.message||e)}. <button class="btn" type="button" data-pva="print">Печать → «Сохранить как PDF»</button>`, 'err'); }
  btn.disabled=false; btn.textContent=t;
}

// после сохранения КП: PDF рядом с .docx в папке КП
async function saveKpPdf(){
  const r=await fetch(`/api/kp/${S.kpId}/pdf`, {method:'POST'});
  if (!r.ok) throw new Error((await r.text()).replace(/^PDF не создан:\s*/,'') || 'HTTP '+r.status);
  return r.json();
}

function pdfWanted(){ try{ return localStorage.getItem('kp.pdf')==='1'; }catch(e){ return false; } }

document.addEventListener('change', e=>{ if (e.target.id!=='pdfToo') return; try{ localStorage.setItem('kp.pdf', e.target.checked?'1':'0'); }catch(_){} });

document.addEventListener('change', e=>{ if (e.target.dataset.cvphoto==null) return; S.cover.photoFrom=e.target.value; renderForm(); persist(); });

document.addEventListener('click', e=>{ const b=e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a==='kpPreview') openKpPreview();
  else if (b.dataset.a==='openPdf') api(`/api/kp/${b.dataset.id}/openpdf`,{method:'POST'}).then(remoteResult).catch(err=>toast(String(err.message||err)));
  else if (b.dataset.a==='printPdf') openKpPreview().then(()=>setTimeout(pvPrint, 300)); });
