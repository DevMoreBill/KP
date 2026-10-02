// Шаблоны КП (папка templates): выбор шаблона и загрузка всего, что в папке шаблона —
// настроек (template.json), скелета документа (skeleton.js) и основы Word (base.docx).
'use strict';

let TEMPLATES=[];

const TPL_CACHE={};

async function loadTemplates(){ try{ TEMPLATES = await api('/api/templates'); }catch(e){ TEMPLATES=[]; } pickTemplate(); }

// у КП всегда выбран шаблон: «Новое КП» и КП из журнала без шаблона получают сохранённый в браузере или основной
function pickTemplate(){
  if (TEMPLATES.length && (!S.template || !TEMPLATES.some(x=>x.id===S.template))){ let t=''; try{ t=localStorage.getItem('kp.template')||''; }catch(e){} S.template = TEMPLATES.some(x=>x.id===t) ? t : (TEMPLATES.find(x=>x.id==='pnevmotekh')||TEMPLATES[0]||{}).id || ''; } }

function curTemplate(){ return TEMPLATES.find(t=>t.id===S.template) || null; }

function templatePicker(){
  const list=TEMPLATES.filter(t=>!t.error), bad=TEMPLATES.filter(t=>t.error);
  return `<div class="tplpick"><label class="f"><span>Шаблон КП${(curTemplate()||{}).description?tip(esc(curTemplate().description)):''}</span><select data-tpl="1">${list.map(t=>`<option value="${esc(t.id)}"${t.id===S.template?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
</div>
    ${bad.map(t=>`<p class="msg err">Шаблон «${esc(t.id)}»: ${esc(t.error)} <button class="btn ghost" type="button" data-a="settings">Исправить в «Настройках»</button></p>`).join('')}`;
}

const relAttr=(x,n)=>{ const m=x.match(new RegExp('\\s'+n+'="([^"]*)"')); return m?m[1]:''; };

// сбросить загруженный шаблон (после правки его файлов)
function dropTemplateCache(id){ if (id) delete TPL_CACHE[id]; else for (const k in TPL_CACHE) delete TPL_CACHE[k]; }

async function fetchOk(url, what){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('нет файла '+what); return r; }

// всё содержимое папки шаблона, готовое к сборке документа
async function templatePack(id){
  if (TPL_CACHE[id]) return TPL_CACHE[id];
  const t=encodeURIComponent(id);
  let json;
  try{ json=await (await fetchOk(`/tpl/${t}/template.json`,'template.json')).json(); }
  catch(e){ throw new Error(/нет файла/.test(e.message)?e.message:'ошибка в template.json — исправьте в «Настроить шаблон» или верните версию из истории'); }
  const skel=KPGen.loadSkeleton(await (await fetchOk(`/tpl/${t}/skeleton.js`,'skeleton.js')).text());
  const base=await (await fetchOk(`/tpl/${t}/base.docx`,'base.docx')).arrayBuffer();
  const z=await JSZip.loadAsync(base);
  const relsX=await z.file('word/_rels/document.xml.rels').async('string');
  const docX=await z.file('word/document.xml').async('string');
  const rels=(relsX.match(/<Relationship\s[^>]*\/>/g)||[]);
  const keep=rels.filter(x=>!/\/(image|hyperlink)"/.test(relAttr(x,'Type')) );
  const sects=docX.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)||[];
  let sect=sects.length?sects[sects.length-1]:'';
  if (!sect) throw new Error('в base.docx не найдены параметры страницы');
  // нижний колонтитул: программа пишет свой в файл, на который ссылается шаблон, или добавляет новый
  let footerPath=null, addFooter=null;
  const fm=sect.match(/<w:footerReference[^>]*w:type="default"[^>]*\/>/);
  const fid=fm?relAttr(fm[0],'r:id'):'';
  const frel=fid&&keep.find(x=>relAttr(x,'Id')===fid);
  if (frel) footerPath='word/'+relAttr(frel,'Target').replace(/^\//,'').replace(/^word\//,'');
  else { footerPath='word/footer_kp.xml'; addFooter=true;
    keep.push('<Relationship Id="rIdKpFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer_kp.xml"/>');
    sect=sect.replace(/<w:footerReference[^>]*w:type="default"[^>]*\/>/,'');
    sect=sect.replace(/(<w:sectPr[^>]*>(?:\s*<w:headerReference[^>]*\/>)*)/,'$1<w:footerReference w:type="default" r:id="rIdKpFooter"/>'); }
  const settings=KPGen.deepMerge(skel.defaults, json);
  return TPL_CACHE[id]={id, base, json, settings, skel, rels:keep.join(''), sect, footerPath, addFooter, images:{}};
}

// картинка шаблона (страница «Наши клиенты»): загружается один раз
async function templateImage(pack, file){
  if (!file) return null;
  if (!(file in pack.images)){
    try{ const buf=await (await fetchOk(`/tpl/${encodeURIComponent(pack.id)}/${encodeURIComponent(file)}`, file)).arrayBuffer();
      const bmp=await createImageBitmap(new Blob([buf])); pack.images[file]={buf, w:bmp.width, h:bmp.height, ext:/\.png$/i.test(file)?'png':'jpg'}; }
    catch(e){ pack.images[file]=null; } }
  return pack.images[file];
}

// параметры страницы из base.docx — для подсказки в редакторе
function pageInfo(sect){
  const n=(re)=>{ const m=re.exec(sect||''); return m?+m[1]:0; }, cmv=v=>String(Math.round(v/567*100)/100).replace('.',',');
  const w=n(/<w:pgSz[^>]*w:w="(\d+)"/), h=n(/<w:pgSz[^>]*w:h="(\d+)"/);
  if (!w||!h) return '';
  const fmt = Math.abs(w-11906)<30&&Math.abs(h-16838)<30 ? 'А4 книжный' : Math.abs(w-16838)<30&&Math.abs(h-11906)<30 ? 'А4 альбомный' : `${cmv(w)} × ${cmv(h)} см`;
  return `${fmt}; поля: левое ${cmv(n(/<w:pgMar[^>]*w:left="(\d+)"/))}, правое ${cmv(n(/<w:pgMar[^>]*w:right="(\d+)"/))}, верхнее ${cmv(n(/<w:pgMar[^>]*w:top="(\d+)"/))}, нижнее ${cmv(n(/<w:pgMar[^>]*w:bottom="(\d+)"/))} см`;
}

document.addEventListener('change', e=>{ if (!e.target.dataset.tpl) return; S.template=e.target.value; try{ localStorage.setItem('kp.template',S.template); }catch(_){} renderForm(); persist(); toast('Шаблон КП: '+((curTemplate()||{}).name||'')); });
