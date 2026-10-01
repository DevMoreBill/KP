// Сборка DOCX: имя файла, модели для титула, сохранение КП на сервере.
'use strict';

// корневые элементы document.xml и footer.xml (пространства имён Word)
const ROOTS = {
  document: "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14\">",
  footer: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:ftr xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14\">"
};

const SHORT_T={dgu:'ДГУ',light:'Мачта',welder:'Сварочный',comp_screw:'Компрессор',comp_piston:'Компрессор',comp_centrifugal:'Компрессор',pump:'Насос',ats:'АВР',other:''};

function equipShort(){
  const seen=new Set(), parts=[];
  for (const x of S.items){ const a=attrsOf(x), t=typeById(a.cat); if (t.role==='accessory') continue;
    let m=a.model || ((x.hint&&x.hint.model)||'').replace(/^(Tide Power|HERTZ|Energo|ТСС)\s+/i,'') || x.name.split(' ').slice(-1)[0];
    const s=[(t.short ?? SHORT_T[t.id] ?? ''), m].filter(Boolean).join(' ');
    if (!seen.has(s)){ seen.add(s); parts.push(s); } }
  if (!parts.length) return '';
  let out=parts.slice(0,2).join(' и '); if (parts.length>2) out+=` и ещё ${parts.length-2}`;
  return out;
}

// имя файла КП — по образцу из шаблона (fileName), метки: {номер} {префикс} {клиент} {оборудование} {дата}
function fileName(settings){
  const c = fsafe(String(S.client||'клиент').replace(/^(ООО|АО|ПАО|ЗАО|ИП|ОАО)\s+/i,'')).slice(0,40) || 'клиент';
  const eq = fsafe(equipShort()).slice(0,60);
  const pk = TPL_CACHE[S.template], tl = curTemplate() || {};
  const st = settings || (pk && pk.settings) || {};
  const pre = fsafe(st.filePrefix || tl.filePrefix || 'КП');
  const pat = st.fileName || tl.fileName || '{номер}_{префикс}_{клиент}_{оборудование}_{дата}';
  const name = KPGen.fill(pat, {'номер':S.number||'', 'префикс':pre, 'клиент':c, 'оборудование':eq, 'дата':S.date||today()})
    .replace(/[\\/:*?"<>|]/g,'').replace(/_{2,}/g,'_').replace(/^[_\s-]+|[_\s-]+$/g,'');
  return (name || 'КП') + '.docx';
}

function managerFolder(){ const m=S.manager||{}; return fsafe(m.folder || String(m.name||'').trim().split(/\s+/)[0] || '').slice(0,40); }

function stationsOf(){
  const map=new Map();
  for (const x of S.items){
    const a=attrsOf(x), t=typeById(a.cat); if (t.role==='accessory') continue;
    const model=(x.hint&&x.hint.model) || (a.model&&a.maker?a.maker+' '+a.model:'') || x.name;
    const key=norm(model); const pr=(x.groups||[]).flatMap(g=>g.rows||[]).find(r=>/основная мощность|номинальная мощность/i.test(r.k));
    const power = a.cat==='dgu' ? (pr?pr.v:(a.kva&&a.kw?`${a.kva} кВА / ${a.kw} кВт`:(a.kw?a.kw+' кВт':''))) : mainLine(x,2);
    const st=map.get(key)||{key:'st'+map.size, model, power, exec:a.execution||'', qty:0, photo:x.photo||null, type:a.cat, group:t.group||''};
    st.qty+=(+x.qty||0); if(!st.photo&&x.photo) st.photo=x.photo; map.set(key,st);
  }
  return [...map.values()];
}

// данные КП для документа (без служебных полей и изображений)
function docState(){
  S.items.forEach(x=>(x.features||[]).forEach(featId));
  const St = JSON.parse(JSON.stringify(S, (k,v)=>k.startsWith('_')?undefined:v));
  St.vat=+S.vat; St.cur={code:kpCur(), rate:kpCur()!=='RUB'?rateOf(kpCur()):null, date:S.pricing.rateDate||''}; St.items=S.items.map(x=>({...x, qty:+x.qty, photo:undefined, logo:undefined, _srcImg:undefined, options:(x.options||[]).filter(o=>o.name.trim()&&+o.qty>0).map(o=>({name:o.name.trim(), short:o.short, unit:o.unit, qty:+o.qty, price:o.price||0}))}));
  return St;
}

// сборка файла .docx: основа Word из шаблона + страницы по скелету шаблона с настройками settings
async function renderDocx(St, pack, settings){
  const T = settings.texts || {};
  const zip = await JSZip.loadAsync(pack.base);
  const img = settings.clientsImage ? await templateImage(pack, settings.clientsImage) : null;
  const clients = img ? {rid:'rIdTplClients', file:'tpl_clients.'+img.ext, w:img.w, h:img.h} : false;
  { if (clients) zip.file('word/media/'+clients.file, img.buf);
    if (pack.addFooter){ const ct=await zip.file('[Content_Types].xml').async('string');
      if (!ct.includes('/word/footer_kp.xml')) zip.file('[Content_Types].xml', ct.replace('</Types>','<Override PartName="/word/footer_kp.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')); }
    const ct=await zip.file('[Content_Types].xml').async('string');
    if (!/Extension="png"/i.test(ct) || !/Extension="jpg"/i.test(ct)) zip.file('[Content_Types].xml', ct.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+(/Extension="png"/i.test(ct)?'':'<Default Extension="png" ContentType="image/png"/>')+(/Extension="jpg"/i.test(ct)?'':'<Default Extension="jpg" ContentType="image/jpeg"/>'))); }
  const Min={cover:null,items:{}};
  const STS=stationsOf();
  if (STS.length>=2){
    St.stations=STS.map(s=>({key:s.key,model:s.model,power:s.power,exec:s.exec,qty:s.qty}));
    Min.thumbs={};
    for (const s of STS){ if(!s.photo) continue; zip.file(`word/media/${s.key}.jpg`, b64(await toDataURL(s.photo)), {base64:true}); Min.thumbs[s.key]={file:`${s.key}.jpg`,w:s.photo.w,h:s.photo.h}; }
    if (!S.cover.touched){
      const makers=new Set(STS.map(s=>s.model.split(' ')[0]));
      const kvas=STS.filter(s=>/кВА/.test(s.power||'')).map(s=>parseFloat(String(s.power).replace(',','.'))).filter(x=>x>0);
      if (STS.length>3) St.cover.model = `${STS.length} ${plural(STS.length,'модель','модели','моделей')}` + (kvas.length && STS.every(s=>s.type==='dgu')?` · ${Math.min(...kvas)}–${Math.max(...kvas)} кВА`.replace(/\./g,','):'');
      else St.cover.model = makers.size===1 && STS.every(s=>s.model.startsWith('Tide Power ')) ? 'Tide Power '+STS.map(s=>s.model.replace('Tide Power ','')).join(' · ') : STS.map(s=>s.model).join(' · ');
      const cats=new Set(STS.map(s=>s.type)), grps=new Set(STS.map(s=>s.group));
      St.cover.title = cats.size===1 ? (typeById([...cats][0]).coverTitle||typeById([...cats][0]).name) : grps.size===1 ? [...grps][0] : (T.coverMultiTitle||'Оборудование');
      St.cover.desc = KPGen.fill(T.coverMultiDesc||'', {count:`${STS.length} ${plural(STS.length,'модель','модели','моделей')}`});
    }
  }
  // фото на титул: выбранное в разделе «Титульный лист» или первой позиции с фото
  const coverItem=S.items.find(x=>x.id===S.cover.photoFrom && x.photo) || S.items.find(x=>x.photo);
  if (coverItem){ zip.file('word/media/cover.jpg', b64(await toDataURL(coverItem.photo)), {base64:true}); Min.cover={file:'cover.jpg',w:coverItem.photo.w,h:coverItem.photo.h}; }
  for (const x of S.items){ if(!x.page) continue; const m={};
    if (x.photo){ const t=await tileFrom(x.photo); zip.file(`word/media/tile_${x.id}.png`, b64(t.url), {base64:true}); m.tile={file:`tile_${x.id}.png`,w:t.w,h:t.h}; }
    if (x.logo){ zip.file(`word/media/logo_${x.id}.png`, b64(await toDataURL(x.logo)), {base64:true}); m.logo={file:`logo_${x.id}.png`,w:x.logo.w,h:x.logo.h}; }
    m.gallery=[]; m.featImgs={}; let gk=0;
    (x.features||[]).forEach(featId);
    for (const g of (x.gallery||[])){ if (g.on===false) continue; const du=await toDataURL(g); if(!du) continue;
      const ext=/^data:image\/png/.test(du)?'png':'jpg'; const fnm=`gal_${x.id}_${++gk}.${ext}`;
      zip.file(`word/media/${fnm}`, b64(du), {base64:true});
      const L=linkOf(x,g);
      if (L.kind==='feat') m.featImgs[L.f.id]={file:fnm, w:g.w, h:g.h};
      else m.gallery.push({file:fnm, w:g.w, h:g.h, caption:(g.caption||'').trim() || (L.kind==='group'?L.name:''), wide:galWide(g)}); }
    Min.items[x.id]=m; }
  // скелет, не умеющий показывать скидку (свой или старый), получает цены уже со скидкой — суммы сходятся
  if (!(pack.skel.features||[]).includes('discount')) St.items=St.items.map(x=>Object.assign({}, x, {price:KPGen.netPrice(x), disc:undefined}));
  let out;
  try{ out = pack.skel.build(St, Min, ROOTS, Object.assign({}, settings, {rels:pack.rels, sect:pack.sect, clients})); }
  catch(e){ throw new Error('ошибка в скелете шаблона (skeleton.js): '+(e&&e.message||e)); }
  zip.file('word/document.xml', out.document); zip.file(pack.footerPath, out.footer); zip.file('word/_rels/document.xml.rels', out.rels);
  return zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression:'DEFLATE'});
}

// пробный файл: текущее КП по шаблону с несохранёнными настройками — без номера и записи в журнал
async function previewDocx(id, settings){
  if (!S.items.length) throw new Error('добавьте в КП хотя бы одну позицию — пробный файл строится по текущему КП');
  const pack=await templatePack(id);
  const St=docState(); if (!St.number) St.number='ПРОБНЫЙ';
  const blob=await renderDocx(St, pack, settings || pack.settings);
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Пробный_'+fileName(settings || pack.settings);
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 30000);
}

async function download(){
  const msg=$('#dlmsg'); const btn=document.querySelector('[data-a="download"]');
  if (problems().length) return;
  if (!window.JSZip){ msg.className='msg err'; msg.textContent='Не загрузился модуль сборки файла. Обновите страницу.'; return; }
  btn.disabled=true; btn.textContent='Собираю файл…'; msg.textContent='';
  try{
    const St = docState();
    if (!S.template) throw new Error('не выбран шаблон КП (папка templates рядом с программой пуста)');
    let pack;
    try{ pack=await templatePack(S.template); }catch(e){ throw new Error('шаблон «'+S.template+'» не загрузился: '+e.message); }
    if (!S.kpId){ const r=await api('/api/kp/new',{method:'POST'}); S.kpId=r.id; S.number=r.number; St.kpId=r.id; St.number=r.number; }
    const blob = await renderDocx(St, pack, pack.settings);
    btn.textContent='Сохраняю в журнал…';
    await syncCatalog(S.number); await saveClient(true);
    for (const it of S.items){ it.photo=await uploadImg(it.photo, imgPlace(it,'photo')); it.logo=await uploadImg(it.logo, imgPlace(it,'logo')); if (it.gallery) for (const g of it.gallery){ const u=await uploadImg(g, imgPlace(it,'gallery',g)); if(u) g.src=u.src; } }
    if (!S.managerId && String(S.manager.name||'').trim()) await saveManager(true);   // новый менеджер попадает в справочник
    const t=totalsS(), fn=fileName();
    await api(`/api/kp/${S.kpId}/docx?name=${encodeURIComponent(fn)}&dir=${encodeURIComponent(managerFolder())}`,{method:'PUT',body:blob});
    const clean=JSON.parse(JSON.stringify(S,(k,v)=>k.startsWith('_')?undefined:v));
    await api(`/api/kp/${S.kpId}/state`,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(clean)});
    const meta={ id:S.kpId, number:S.number, date:S.date, client:S.client, sum:t.sum, units:t.units, positions:S.items.length,
      items:S.items.map(x=>x.name).slice(0,3), file:fn, manager:S.manager.name, savedAt:new Date().toISOString() };
    await api(`/api/kp/${S.kpId}/meta`,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(meta)});
    // PDF рядом с .docx — по галочке «Также сохранить в PDF»
    let pdfOk=false, pdfErr='';
    if (pdfWanted()){ btn.textContent='Создаю PDF…'; try{ await saveKpPdf(); pdfOk=true; }catch(e){ pdfErr=e.message||String(e); } }
    persist(); renderForm();
    const remote=SRV.info&&SRV.info.local===false, m2=$('#dlmsg'); m2.className='msg ok';
    m2.innerHTML=`КП № ${esc(S.number)} сохранено${pdfOk?' (DOCX и PDF)':''}, каталог обновлён.<div class="row" style="justify-content:center;margin-top:8px"><button class="btn" type="button" data-a="openDoc" data-id="${esc(S.kpId)}">${remote?'Скачать .docx':'Открыть в Word'}</button>${pdfOk?`<button class="btn" type="button" data-a="openPdf" data-id="${esc(S.kpId)}">${remote?'Скачать PDF':'Открыть PDF'}</button>`:''}${remote&&!SRV.info.docsShare?'':`<button class="btn" type="button" data-a="showDoc" data-id="${esc(S.kpId)}">${remote?'Путь к файлу':'Показать в папке'}</button>`}</div>`
      + (pdfErr?`<div class="msg err">PDF не создан: ${esc(pdfErr)}<div class="row" style="justify-content:center;margin-top:6px"><button class="btn" type="button" data-a="printPdf">Печать → «Сохранить как PDF»</button></div></div>`:'');
  } catch(e){
    msg.className='msg err';
    msg.textContent = e&&e.code==='declined' ? 'Сохранение отменено.' : e&&e.code==='rate_limited' ? 'Окно сохранения уже открыто.' : 'Не удалось собрать файл: '+(e&&e.message||e);
  }
  btn.disabled=false; btn.textContent='Сохранить КП';
}
