// Шаблоны КП (папка templates): выбор шаблона и загрузка основы DOCX.
'use strict';

let TEMPLATES=[];

const TPL_CACHE={};

async function loadTemplates(){ try{ TEMPLATES = await api('/api/templates'); }catch(e){ TEMPLATES=[]; }
  if (!S.template){ let t=''; try{ t=localStorage.getItem('kp.template')||''; }catch(e){} S.template = TEMPLATES.some(x=>x.id===t) ? t : (TEMPLATES.find(x=>x.id==='pnevmotekh')||TEMPLATES[0]||{}).id || ''; } }

function curTemplate(){ return TEMPLATES.find(t=>t.id===S.template) || null; }

function templatePicker(){
  const list=TEMPLATES.filter(t=>!t.error);
  return `<div class="tplpick"><label class="f"><span>Шаблон КП</span><select data-tpl="1">${list.map(t=>`<option value="${esc(t.id)}"${t.id===S.template?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
    <span class="muted">${esc((curTemplate()||{}).description||'')}</span><button class="btn ghost" type="button" data-a="tplFolder" title="Папка с шаблонами: base.docx (шапка, поля, стили) и template.json (цвета, тексты)">Папка шаблонов</button></div>`;
}

const relAttr=(x,n)=>{ const m=x.match(new RegExp('\\s'+n+'="([^"]*)"')); return m?m[1]:''; };

async function templatePack(id){
  if (TPL_CACHE[id]) return TPL_CACHE[id];
  const j=await (await fetch(`/tpl/${id}/template.json`,{cache:'no-store'})).json();
  const base=await (await fetch(`/tpl/${id}/base.docx`,{cache:'no-store'})).arrayBuffer();
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
  const tpl={...j, rels:keep.join(''), sect};
  let clients=null;
  if (j.clientsImage){ try{ const buf=await (await fetch(`/tpl/${id}/${encodeURIComponent(j.clientsImage)}`)).arrayBuffer();
      const ext=/\.png$/i.test(j.clientsImage)?'png':'jpg'; const bmp=await createImageBitmap(new Blob([buf]));
      clients={buf, file:'tpl_clients.'+ext}; tpl.clients={rid:'rIdTplClients', file:clients.file, w:bmp.width, h:bmp.height}; }catch(e){ tpl.clients=false; } }
  else tpl.clients=false;
  return TPL_CACHE[id]={base, tpl, footerPath, addFooter, clients};
}

document.addEventListener('change', e=>{ if (!e.target.dataset.tpl) return; S.template=e.target.value; try{ localStorage.setItem('kp.template',S.template); }catch(_){} renderForm(); persist(); toast('Шаблон КП: '+((curTemplate()||{}).name||'')); });
