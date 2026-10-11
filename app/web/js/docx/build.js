// Сборка DOCX: имя файла, модели для титула, сохранение КП на сервере.
'use strict';

// корневые элементы document.xml и footer.xml (пространства имён Word)
const ROOTS = {
  document: "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14\">",
  footer: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:ftr xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14\">"
};

ROOTS.header = ROOTS.footer.replace('<w:ftr ', '<w:hdr ');

// поля страницы из настроек шаблона (page: {top, bottom, left, right} в см; пусто — как в base.docx)
function sectWithPage(sect, page){
  if (!page) return sect;
  let out=sect;
  for (const [k,a] of [['top','w:top'],['bottom','w:bottom'],['left','w:left'],['right','w:right']]){
    const v=+String(page[k]??'').replace(',','.'); if (!(v>=0.5 && v<=6)) continue;
    out=out.replace(new RegExp(`(<w:pgMar[^>]*\\s${a}=")\\d+(")`), `$1${Math.round(v*567)}$2`); }
  return out;
}

const SHORT_T={dgu:'ДГУ',light:'Мачта',welder:'Сварочный',comp_screw:'Компрессор',comp_piston:'Компрессор',comp_centrifugal:'Компрессор',pump:'Насос',ats:'АВР',other:''};

// имя файла КП — по образцу из шаблона (fileName), метки: {номер} {префикс} {клиент} {оборудование} {дата}
function fileName(settings){
  if (tenderNo()) return tenderFileName(settings);
  const c = fsafe(String(S.client||'клиент').replace(/^(ООО|АО|ПАО|ЗАО|ИП|ОАО)\s+/i,'')).slice(0,40) || 'клиент';
  const eq = fsafe(KpModels.short()).slice(0,60);
  const pk = TPL_CACHE[S.template], tl = curTemplate() || {};
  const st = settings || (pk && pk.settings) || {};
  const pre = fsafe(st.filePrefix || tl.filePrefix || 'КП');
  const pat = st.fileName || tl.fileName || '{номер}_{префикс}_{клиент}_{оборудование}_{дата}';
  const name = KPGen.fill(pat, {'номер':S.number||'', 'префикс':pre, 'клиент':c, 'оборудование':eq, 'дата':S.date||today()})
    .replace(/[\\/:*?"<>|]/g,'').replace(/_{2,}/g,'_').replace(/^[_\s-]+|[_\s-]+$/g,'');
  return (name || 'КП') + '.docx';
}

// имя файла, как его сохранил сервер: «4567892 КП (2).docx», если «4567892 КП» уже у другого КП той же закупки
function savedFileName(){ const fn=fileName(), sv=S._file||''; return sv && sv.replace(/ \(\d+\)(?=\.docx$)/i,'')===fn ? sv : fn; }

// тендер: «<№ закупки> КП <поставщик> <заказчик>.docx», например «4567892 КП ПНЕВМОТЕХ ПАВЛИК.docx»
function tenderFileName(settings){
  const clean = s => String(s||'').replace(/[«»"'\\/:*?<>|\x00-\x1f]/g,'').replace(/\s+/g,' ').trim();
  const pk = TPL_CACHE[S.template], st = settings || (pk && pk.settings) || {}, tl = curTemplate() || {};
  const sup = clean(st.company || tl.company || (st.brandParts||[]).map(x=>x[0]).join('') || 'ПНЕВМОТЕХ').slice(0,40);
  const cl = clean(String(S.client||'').replace(/^(ООО|АО|ПАО|ЗАО|ИП|ОАО|НАО)\s+/i,'')).slice(0,60);
  return [clean(tenderNo()).slice(0,60) || 'Тендер', 'КП', sup, cl].filter(Boolean).join(' ') + '.docx';
}

function managerFolder(){ const m=S.manager||{}; return fsafe(m.folder || String(m.name||'').trim().split(/\s+/)[0] || '').slice(0,40); }

// модели КП для титула: позиции одной модели — одной строкой (количество суммируется), комплектующие не считаются;
// станция в контейнере — по основному оборудованию и с типом контейнера; kind — вид оборудования (для сводки на титуле)
class KpModels {
  static list(){
    const map=new Map();
    for (const x of S.items){
      const a=attrsOf(x), t=typeById(a.cat); if (t.role==='accessory') continue;
      const station=!!stationOf(x);
      const model=(!station && x.hint && x.hint.model) || (station ? CoverHint.model(x) : (a.model&&a.maker?a.maker+' '+a.model:'')) || x.name;
      const key=(station?'станция ':'')+norm(model); const pr=(x.groups||[]).flatMap(g=>g.rows||[]).find(r=>/основная мощность|номинальная мощность/i.test(r.k));
      const power = a.cat==='dgu' ? (pr?pr.v:(a.kva&&a.kw?`${a.kva} кВА / ${a.kw} кВт`:(a.kw?a.kw+' кВт':''))) : mainLine(x,2);
      const st=map.get(key)||{key:'st'+map.size, model, power, exec:a.execution||(station?a.container:'')||'', qty:0, photo:x.photo||null, type:a.cat, group:t.group||'', kind:t.name||''};
      st.qty+=(+x.qty||0); if(!st.photo&&x.photo) st.photo=x.photo; map.set(key,st);
    }
    return [...map.values()];
  }
  // оборудование коротко — для имени файла: «Компрессор EAGLE-N 110 и ДГУ 30 MP-FW-S и ещё 2»; станция — по основному оборудованию
  static short(){
    const seen=new Set(), parts=[];
    for (const x of S.items){ const a=attrsOf(x), t=typeById(a.cat); if (t.role==='accessory') continue;
      const st=stationOf(x) ? (kitMainPart(x)||{}).attrs||{} : null;
      let m=(st ? st.model : a.model) || ((x.hint&&x.hint.model)||'').replace(/^(Tide Power|HERTZ|Energo|ТСС)\s+/i,'') || x.name.split(' ').slice(-1)[0];
      const s=[(t.short ?? SHORT_T[t.id] ?? (st ? t.item : '')), m].filter(Boolean).join(' ');
      if (!seen.has(s)){ seen.add(s); parts.push(s); } }
    if (!parts.length) return '';
    let out=parts.slice(0,2).join(' и '); if (parts.length>2) out+=` и ещё ${parts.length-2}`;
    return out;
  }
}

// настройки документа Word (word/settings.xml): автоматические переносы слов — по скелету шаблона (out.hyphenate);
// элементы — на своём месте по схеме Word (сразу после defaultTabStop)
class DocxSettings {
  static HYPH = /<w:(autoHyphenation|consecutiveHyphenLimit|hyphenationZone|doNotHyphenateCaps)\b[^>]*\/>/g;
  static async hyphenation(zip, on){
    const f=zip.file('word/settings.xml'); if (!f || on==null) return;
    let x=(await f.async('string')).replace(DocxSettings.HYPH, '');
    if (on){ const add='<w:autoHyphenation/><w:consecutiveHyphenLimit w:val="2"/><w:hyphenationZone w:val="284"/><w:doNotHyphenateCaps/>';
      if (/<w:defaultTabStop\b[^>]*\/>/.test(x)) x=x.replace(/(<w:defaultTabStop\b[^>]*\/>)/, '$1'+add);
      else if (/<w:characterSpacingControl\b/.test(x)) x=x.replace(/(<w:characterSpacingControl\b)/, add+'$1');
      else if (/<w:compat>/.test(x)) x=x.replace('<w:compat>', add+'<w:compat>'); }
    zip.file('word/settings.xml', x);
  }
}

// данные КП для документа (без служебных полей и изображений)
function docState(){
  S.items.forEach(x=>(x.features||[]).forEach(featId));
  const St = JSON.parse(JSON.stringify(S, (k,v)=>k.startsWith('_')?undefined:v));
  St.vat=+S.vat; St.cur={code:kpCur(), rate:kpCur()!=='RUB'?rateOf(kpCur()):null, date:S.pricing.rateDate||''}; St.items=S.items.map(x=>Object.assign(kitDocItem(x), isKit(x)?{kitDoc:kitDocData(x)}:{}, {info:(a=>({maker:a.maker||'', model:a.model||'', type:a.type||''}))(attrsOf(x))})).map(x=>({...x, kit:undefined, qty:+x.qty, photo:undefined, logo:undefined, _srcImg:undefined, options:(x.options||[]).filter(o=>o.name.trim()&&+o.qty>0).map(o=>({name:o.name.trim(), short:o.short, unit:o.unit, qty:+o.qty, price:o.price||0}))}));
  return St;
}

// изображения документа: файл пропал (удалён из папки картинок, база перенесена без картинок) — КП собирается без него,
// а кому не хватило фото — в DOC_MISS (показывается после сохранения и в предпросмотре)
let DOC_MISS = [];
async function docImg(img, who){ if (!img || !img.src) return null;
  try{ if (String(img.src).startsWith('data:')) return img.src;
    const r=await fetch(img.src); if (!r.ok || !/^image\//.test(r.headers.get('Content-Type')||'')) throw new Error(String(r.status));
    return await blobToURL(await r.blob()); }
  catch(e){ if (who && !DOC_MISS.includes(who)) DOC_MISS.push(who); return null; } }
async function docTile(img, who){ const du=await docImg(img, who); if (!du) return null;
  try{ return await tileFrom({src:du}); }catch(e){ if (who && !DOC_MISS.includes(who)) DOC_MISS.push(who); return null; } }
function docMissHtml(){ return DOC_MISS.length ? `<div class="msg warn">Не найден файл фото: ${esc(DOC_MISS.slice(0,5).join('; '))}${DOC_MISS.length>5?` и ещё ${DOC_MISS.length-5}`:''}. КП собрано без этих фото — замените их в карточке позиции.</div>` : ''; }

// сборка файла .docx: основа Word из шаблона + страницы по скелету шаблона с настройками settings
async function renderDocx(St, pack, settings){
  const T = settings.texts || {}; DOC_MISS = [];
  const zip = await JSZip.loadAsync(pack.base);
  const img = settings.clientsImage ? await templateImage(pack, settings.clientsImage) : null;
  const clients = img ? {rid:'rIdTplClients', file:'tpl_clients.'+img.ext, w:img.w, h:img.h} : false;
  { if (clients) zip.file('word/media/'+clients.file, img.buf);
    if (pack.addFooter){ const ct=await zip.file('[Content_Types].xml').async('string');
      if (!ct.includes('/word/footer_kp.xml')) zip.file('[Content_Types].xml', ct.replace('</Types>','<Override PartName="/word/footer_kp.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')); }
    const ct=await zip.file('[Content_Types].xml').async('string');
    if (!/Extension="png"/i.test(ct) || !/Extension="jpg"/i.test(ct)) zip.file('[Content_Types].xml', ct.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+(/Extension="png"/i.test(ct)?'':'<Default Extension="png" ContentType="image/png"/>')+(/Extension="jpg"/i.test(ct)?'':'<Default Extension="jpg" ContentType="image/jpeg"/>'))); }
  const Min={cover:null,items:{}};
  const STS=KpModels.list();
  if (STS.length>=2){
    St.stations=STS.map(s=>({key:s.key,model:s.model,power:s.power,exec:s.exec,qty:s.qty,kind:s.kind}));
    Min.thumbs={};
    for (const s of STS){ if(!s.photo) continue; const du=await docImg(s.photo, s.model); if (!du) continue;
      zip.file(`word/media/${s.key}.jpg`, b64(du), {base64:true}); Min.thumbs[s.key]={file:`${s.key}.jpg`,w:s.photo.w,h:s.photo.h}; }
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
  const covers=[S.items.find(x=>x.id===S.cover.photoFrom && x.photo), ...S.items.filter(x=>x.photo)].filter(Boolean);
  for (const ci of covers){ const du=await docImg(ci.photo, ci.name); if (!du) continue;
    zip.file('word/media/cover.jpg', b64(du), {base64:true}); Min.cover={file:'cover.jpg',w:ci.photo.w,h:ci.photo.h}; break; }
  for (const x of S.items.map(kitDocItem)){ if(!x.page) continue; const m={};
    if (x.photo){ const t=await docTile(x.photo, x.name); if (t){ zip.file(`word/media/tile_${x.id}.png`, b64(t.url), {base64:true}); m.tile={file:`tile_${x.id}.png`,w:t.w,h:t.h}; } }
    if (x.logo){ const du=await docImg(x.logo, x.name+' (логотип)'); if (du){ zip.file(`word/media/logo_${x.id}.png`, b64(du), {base64:true}); m.logo={file:`logo_${x.id}.png`,w:x.logo.w,h:x.logo.h}; } }
    m.gallery=[]; m.featImgs={}; let gk=0;
    (x.features||[]).forEach(featId);
    for (const g of (x.gallery||[])){ if (g.on===false) continue; const du=await docImg(g, x.name+(g.caption?' — '+g.caption:'')); if(!du) continue;
      const ext=/^data:image\/png/.test(du)?'png':'jpg'; const fnm=`gal_${x.id}_${++gk}.${ext}`;
      zip.file(`word/media/${fnm}`, b64(du), {base64:true});
      const L=linkOf(x,g);
      if (L.kind==='feat') m.featImgs[L.f.id]={file:fnm, w:g.w, h:g.h};
      else m.gallery.push({file:fnm, w:g.w, h:g.h, caption:(g.caption||'').trim() || (L.kind==='group'?L.name:''), wide:galWide(g), sheet:g.gen==='stdraw'}); }
    Min.items[x.id]=m; }
  // дополнительные картинки шаблона и шапка из настроек (если скелет это умеет)
  const feats=pack.skel.features||[];
  if (feats.includes('images')){ Min.extra={};
    for (const x of (settings.images||[])){ const im=x&&x.file ? await templateImage(pack, x.file) : null; if (!im) continue;
      const fnm=`tplx_${String(x.id).replace(/[^A-Za-z0-9_-]/g,'')}.${im.ext}`; zip.file('word/media/'+fnm, im.buf); Min.extra[x.id]={file:fnm, w:im.w, h:im.h}; } }
  let sect=sectWithPage(pack.sect, settings.page), rels=pack.rels, hdrLogo=null;
  const hdrOn = feats.includes('header') && settings.header && settings.header.on;
  if (hdrOn){
    const lg=settings.header.logo ? await templateImage(pack, settings.header.logo) : null;
    if (lg){ hdrLogo={rid:'rIdHdrLogo', file:'tpl_hdr_logo.'+lg.ext, w:lg.w, h:lg.h}; zip.file('word/media/'+hdrLogo.file, lg.buf); }
    // своя шапка: прежние ссылки на шапки убираются, первая страница — с той же шапкой
    sect=sect.replace(/<w:headerReference[^>]*\/>/g,'').replace(/<w:titlePg\/>/g,'').replace(/(<w:sectPr[^>]*>)/,'$1<w:headerReference w:type="default" r:id="rIdKpHeader"/>');
    rels+='<Relationship Id="rIdKpHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header_kp.xml"/>';
    const ct=await zip.file('[Content_Types].xml').async('string');
    if (!ct.includes('/word/header_kp.xml')) zip.file('[Content_Types].xml', ct.replace('</Types>','<Override PartName="/word/header_kp.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  }
  // скелет, умеющий показывать сборки (feature 'kit'), получает состав как есть: it.kit.parts — таблица состава и карточки элементов;
  // остальным — состав, разложенный в блоки описания и таблицы (kitDocItem)
  if (feats.includes('kit')){
    St.items=St.items.map(x=>x.kitDoc ? Object.assign({}, x, x.kitDoc.base, {kit:{parts:x.kitDoc.parts}, kitDoc:undefined}) : x);
    for (const x of S.items){ if (!isKit(x) || !Min.items[x.id]) continue; const m=Min.items[x.id]; m.kitImgs={};
      for (const p of kitParts(x)){ if (!p.photo || !p.photo.src) continue; const du=await docImg(p.photo, x.name+' — '+(p.name||'элемент')); if (!du) continue;
        const ext=/^data:image\/png/.test(du)?'png':'jpg', fnm=`kit_${x.id}_${String(p.id).replace(/[^A-Za-z0-9_-]/g,'')}.${ext}`;
        zip.file('word/media/'+fnm, b64(du), {base64:true}); m.kitImgs[p.id]={file:fnm, w:p.photo.w, h:p.photo.h}; } } }
  else St.items=St.items.map(x=>x.kitDoc ? Object.assign({}, x, {kitDoc:undefined}) : x);
  // подпись и печать (картинки шаблона) — для блока подписи, если скелет его умеет (feature 'sign')
  if (feats.includes('sign')){ Min.sign={};
    for (const k of ['signImage','stampImage']){ const im=settings[k] ? await templateImage(pack, settings[k]) : null; if (!im) continue;
      const fnm=`tpl_${k}.${im.ext}`; zip.file('word/media/'+fnm, im.buf); Min.sign[k.replace('Image','')]={file:fnm, w:im.w, h:im.h}; } }
  // скелет, не умеющий показывать скидку (свой или старый), получает цены уже со скидкой — суммы сходятся
  if (!(pack.skel.features||[]).includes('discount')) St.items=St.items.map(x=>Object.assign({}, x, {price:KPGen.netPrice(x), disc:undefined}));
  let out;
  try{ out = pack.skel.build(St, Min, ROOTS, Object.assign({}, settings, {rels, sect, clients, headerLogo:hdrLogo})); }
  catch(e){ throw new Error('ошибка в скелете шаблона (skeleton.js): '+(e&&e.message||e)); }
  zip.file('word/document.xml', out.document); zip.file(pack.footerPath, out.footer); zip.file('word/_rels/document.xml.rels', out.rels);
  await DocxSettings.hyphenation(zip, out.hyphenate);
  if (hdrOn && out.header){ zip.file('word/header_kp.xml', out.header);
    zip.file('word/_rels/header_kp.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      (hdrLogo?`<Relationship Id="rIdHdrLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${hdrLogo.file}"/>`:'')+'</Relationships>'); }
  const blob=await zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression:'DEFLATE'});
  blob.kpFloats=out.floats||[];   // плавающие объекты по порядку — предпросмотр дорисовывает надписи (docx-preview их не показывает)
  return blob;
}

// пробный файл: текущее КП по шаблону с несохранёнными настройками — без номера и записи в журнал
async function previewDocx(id, settings){
  if (!S.items.length) throw new Error('добавьте в КП хотя бы одну позицию — пробный файл строится по текущему КП');
  const pack=await templatePack(id);
  await StationImages.syncAll();
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
    await StationImages.syncAll();          // 3D-вид и чертёж станций — по текущему составу
    const St = docState(), isNew = !S.kpId;
    if (!S.template) throw new Error('не выбран шаблон КП (папка templates рядом с программой пуста)');
    let pack;
    try{ pack=await templatePack(S.template); }catch(e){ throw new Error('шаблон «'+S.template+'» не загрузился: '+e.message); }
    if (!S.kpId){ const r=await api('/api/kp/new',{method:'POST'}); S.kpId=r.id; S.number=r.number; St.kpId=r.id; St.number=r.number; S.authorId=meId()||S.managerId||''; S._rev=0; }
    else if (S._rev!=null){   // КП успели пересохранить у коллеги — спросить до записи файла
      const rv=await api(`/api/kp/${S.kpId}/rev`);
      if (rv.rev!==S._rev){ if (!conflictAsk(rv, '/api/kp/')){ const e=new Error('declined'); e.code='declined'; throw e; } S._rev=rv.rev; } }
    else if (!S.authorId && dealAllowed()) S.authorId=meId()||S.managerId||'';   // КП прежней версии: автор — тот, кто его ведёт
    const blob = await renderDocx(St, pack, pack.settings);
    btn.textContent='Сохраняю в журнал…';
    await syncCatalog(S.number); await saveClient(true);
    for (const it of S.items){ it.photo=await ImgUpload.put(it.photo, imgPlace(it,'photo')); it.logo=await ImgUpload.put(it.logo, imgPlace(it,'logo')); if (it.gallery) for (const g of it.gallery){ const u=await ImgUpload.put(g, imgPlace(it,'gallery',g)); if(u) g.src=u.src; }
      for (const p of kitParts(it)) if (p.photo) p.photo=await ImgUpload.put(p.photo, imgPlace(it,'gallery',{caption:p.name})); }
    if (!S.managerId && String(S.manager.name||'').trim()) await saveManager(true);   // новый менеджер попадает в справочник
    if (!S.authorId) S.authorId=meId()||S.managerId||'';
    const t=totalsS(), fn=fileName();
    // имя файла может получить «(2)», если такое уже занято другим КП (два КП по одному тендеру)
    const dr=await api(`/api/kp/${S.kpId}/docx?name=${encodeURIComponent(fn)}&dir=${encodeURIComponent(managerFolder())}`,{method:'PUT',body:blob});
    const fnSaved=(dr && dr.rel ? String(dr.rel).split('/').pop() : '') || fn; S._file=fnSaved;
    if (!S.createdAt) S.createdAt=new Date().toISOString();   // когда КП создано (для журнала)
    const clean=JSON.parse(JSON.stringify(S,(k,v)=>k.startsWith('_')?undefined:v));
    const sr=await api(`/api/kp/${S.kpId}/state`,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8',...(S._rev!=null?{'X-KP-Rev':String(S._rev)}:{})},body:JSON.stringify(clean)});
    if (sr && sr.rev!=null) S._rev=sr.rev;
    const meta={ id:S.kpId, number:S.number, date:S.date, client:S.client, clientInn:S.clientInn||'', sum:t.sum, units:t.units, positions:S.items.length,
      items:S.items.map(x=>x.name).slice(0,3), file:fnSaved, manager:S.manager.name, tender: tenderNo() ? {number:tenderNo(), url:tenderUrl()} : undefined, managerPost:S.manager.position||'',
      createdAt:S.createdAt, savedAt:new Date().toISOString(), econ:kpEconomics(), authorId:S.authorId||'', managerId:S.managerId||'', deal:dealSummary(), validUntil:KpDate.validUntil()||undefined };
    await api(`/api/kp/${S.kpId}/meta`,{method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(meta)});
    Drafts.saved();      // КП в журнале — черновик не нужен
    // PDF рядом с .docx — по галочке «Также сохранить в PDF»
    let pdfOk=false, pdfErr='';
    if (pdfWanted()){ btn.textContent='Создаю PDF…'; try{ await saveKpPdf(); pdfOk=true; }catch(e){ pdfErr=e.message||String(e); } }
    rememberConds(); persist(); renderForm();
    const remote=SRV.info&&SRV.info.local===false, m2=$('#dlmsg'); m2.className='msg ok';
    m2.innerHTML=docMissHtml()+`КП № ${esc(S.number)} сохранено${pdfOk?' (DOCX и PDF)':''}, каталог обновлён.<div class="row" style="justify-content:center;margin-top:8px"><button class="btn" type="button" data-a="openDoc" data-id="${esc(S.kpId)}">${remote?'Скачать .docx':'Открыть в Word'}</button>${pdfOk?`<button class="btn" type="button" data-a="openPdf" data-id="${esc(S.kpId)}">${remote?'Скачать PDF':'Открыть PDF'}</button>`:''}${remote&&!SRV.info.docsShare?'':`<button class="btn" type="button" data-a="showDoc" data-id="${esc(S.kpId)}">${remote?'Путь к файлу':'Показать в папке'}</button>`}${FEAT.on('mail')?`<button class="btn primary" type="button" data-a="mailKp" data-id="${esc(S.kpId)}" title="Письмо клиенту с файлом КП">Отправить клиенту</button>`:''}</div>`
      + (pdfErr?`<div class="msg err">PDF не создан: ${esc(pdfErr)}<div class="row" style="justify-content:center;margin-top:6px"><button class="btn" type="button" data-a="printPdf">Печать → «Сохранить как PDF»</button></div></div>`:'');
    if (FEAT.on('saveDlg')) KpSaved.open({pdfOk, pdfErr, isNew});     // окно «КП сохранено»: файл, клиенту, дальше
  } catch(e){
    msg.className='msg err';
    msg.textContent = e&&e.code==='declined' ? 'Сохранение отменено.' : e&&e.code==='rate_limited' ? 'Окно сохранения уже открыто.' : 'Не удалось собрать файл: '+(e&&e.message||e);
  }
  btn.disabled=false; btn.textContent=S.kpId?'Сохранить изменения КП № '+S.number:'Сохранить КП';
}
