// Документ Word (.docx) без шаблона — для документов, которые программа составляет сама (ТЗ на сборку станции): заголовки,
// абзацы, пункты, таблицы, рисунки, разрыв страницы, нижний колонтитул с номером страницы. WordprocessingML собирается
// строками и упаковывается JSZip; открывается в Word и LibreOffice. КП собирается по шаблону — docx/kpgen.js.
'use strict';

class DocxWriter {
  static EMU = 36000;          // единиц EMU в 1 мм
  static TW = 56.7;            // твипов (1/20 пункта) в 1 мм
  static PAGE = [210, 297];    // А4, мм
  static NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  /** o: {title — свойства документа, author, footer — текст нижнего колонтитула, margins — [верх, право, низ, лево], мм} */
  constructor(o={}){
    this.title=String(o.title||''); this.author=String(o.author||''); this.footer=String(o.footer||'');
    this.margins=o.margins||[20, 15, 20, 25]; this.body=[]; this.media=[];
  }
  /** ширина поля текста, мм */
  get width(){ return DocxWriter.PAGE[0]-this.margins[1]-this.margins[3]; }

  static esc(s){ return String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
  /** куски текста: строка или [[текст, {b, i, sz, color}], …]; перевод строки \n — разрыв строки */
  static runs(t, base={}){
    const parts=Array.isArray(t) ? t : [[t, {}]];
    return parts.map(([s, o={}])=>{ const r={ ...base, ...o };
      const pr=(r.b ? '<w:b/>' : '')+(r.i ? '<w:i/>' : '')+(r.sz ? `<w:sz w:val="${Math.round(r.sz*2)}"/>` : '')+(r.color ? `<w:color w:val="${r.color}"/>` : '');
      return String(s??'').split('\n').map((line, k)=>`<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${k ? '<w:br/>' : ''}<w:t xml:space="preserve">${this.esc(line)}</w:t></w:r>`).join(''); }).join('');
  }
  /** абзац: o — {style, align, keep (с следующим), page (с новой страницы), before/after (пт), ind/hang (мм), run (оформление текста)} */
  p(t, o={}){
    const sp=o.before!=null || o.after!=null ? `<w:spacing w:before="${Math.round((o.before||0)*20)}" w:after="${Math.round((o.after??4)*20)}"/>` : '';
    const ind=o.ind ? `<w:ind w:left="${Math.round(o.ind*DocxWriter.TW)}" w:hanging="${Math.round((o.hang||0)*DocxWriter.TW)}"/>` : '';
    const pPr=(o.style ? `<w:pStyle w:val="${o.style}"/>` : '')+(o.keep ? '<w:keepNext/>' : '')+(o.page ? '<w:pageBreakBefore/>' : '')+sp+ind+(o.align ? `<w:jc w:val="${o.align}"/>` : '');
    this.body.push(`<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${DocxWriter.runs(t, o.run||{})}</w:p>`); return this;
  }
  title1(t){ return this.p(t, { style:'Title' }); }
  h1(t, page){ return this.p(t, { style:'Heading1', keep:true, page }); }
  h2(t){ return this.p(t, { style:'Heading2', keep:true }); }
  /** пункты с номерами «1.», «2.» (prefix — «3.» → «3.1.»): номер текстом — одинаково в Word и LibreOffice */
  items(list, prefix=''){
    list.filter(Boolean).forEach((t, k)=>this.p([[`${prefix}${k+1}. `, {}], ...(Array.isArray(t) ? t : [[t, {}]])], { ind:8, hang:8, after:2 }));
    return this;
  }
  /** таблица: cols — ширины, мм (сумма — по ширине поля); head — заголовки; rows — ячейки (строка или куски текста) */
  table(cols, head, rows){
    const k=this.width/cols.reduce((a, b)=>a+b, 0), tw=cols.map(w=>Math.round(w*k*DocxWriter.TW));
    const cell=(t, j, h)=>`<w:tc><w:tcPr><w:tcW w:w="${tw[j]}" w:type="dxa"/>${h ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF5"/>' : ''}</w:tcPr>`
      +`<w:p><w:pPr><w:spacing w:before="20" w:after="20"/>${h ? '<w:keepNext/>' : ''}</w:pPr>${DocxWriter.runs(t, h ? { b:true } : {})}</w:p></w:tc>`;
    const tr=(r, h)=>`<w:tr><w:trPr><w:cantSplit/>${h ? '<w:tblHeader/>' : ''}</w:trPr>${r.map((t, j)=>cell(t, j, h)).join('')}</w:tr>`;
    this.body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="${tw.reduce((a, b)=>a+b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`
      +`<w:tblGrid>${tw.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head ? tr(head, true) : ''}${rows.map(r=>tr(r, false)).join('')}</w:tbl>`);
    return this.p('', { after:2 });
  }
  /** рисунок data:image/png|jpeg (px — ширина и высота в точках) шириной w мм, не выше maxH мм; подпись — под ним;
   *  page — с новой страницы (без пустого абзаца с разрывом: он мог бы уйти на отдельную страницу) */
  image(src, px, py, w, caption, maxH=235, page=false){
    const m=String(src||'').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/); if (!m || !(px>0 && py>0)) return this;
    let ww=Math.min(w||this.width, this.width), hh=ww*py/px; if (hh>maxH){ ww*=maxH/hh; hh=maxH; }
    const n=this.media.length+1, ext=m[1]==='png' ? 'png' : 'jpeg', id='rIdImg'+n, cx=Math.round(ww*DocxWriter.EMU), cy=Math.round(hh*DocxWriter.EMU);
    this.media.push({ name:`image${n}.${ext}`, data:m[2], id });
    this.body.push(`<w:p><w:pPr><w:keepNext/>${page ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="60" w:after="40"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
      +`<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Рисунок ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
      +`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>`
      +`<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
      +`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    if (caption) this.p(caption, { style:'Caption' });
    return this;
  }
  pageBreak(){ this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return this; }

  // ---- части пакета
  styles(){
    const st=(id, name, ppr, rpr, extra='')=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${DocxWriter.NS}>`
      +'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>'
      +'<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      +'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      +st('Title', 'Title', '<w:spacing w:before="0" w:after="120"/><w:jc w:val="center"/>', '<w:b/><w:sz w:val="30"/>', '<w:qFormat/>')
      +st('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="1F3A5F"/><w:sz w:val="26"/>', '<w:qFormat/>')
      +st('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="22"/>', '<w:qFormat/>')
      +st('Caption', 'caption', '<w:spacing w:before="20" w:after="160"/><w:jc w:val="center"/>', '<w:i/><w:sz w:val="18"/>', '<w:qFormat/>')
      +st('Footer', 'footer', '<w:spacing w:after="0"/><w:jc w:val="right"/>', '<w:color w:val="666666"/><w:sz w:val="16"/>')
      +'<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders>'
      +['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b=>`<w:${b} w:val="single" w:sz="4" w:space="0" w:color="8A96A3"/>`).join('')
      +'</w:tblBorders></w:tblPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>';
  }
  document(){
    const [t, r, b, l]=this.margins.map(v=>Math.round(v*DocxWriter.TW)), [pw, ph]=DocxWriter.PAGE.map(v=>Math.round(v*DocxWriter.TW));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DocxWriter.NS}><w:body>${this.body.join('')}`
      +`<w:sectPr>${this.footer ? '<w:footerReference w:type="default" r:id="rIdFoot"/>' : ''}<w:pgSz w:w="${pw}" w:h="${ph}"/>`
      +`<w:pgMar w:top="${t}" w:right="${r}" w:bottom="${b}" w:left="${l}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  }
  footerXml(){
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${DocxWriter.NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>`
      +`${DocxWriter.runs(this.footer+' — стр. ')}<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  }
  /** части пакета: путь → текст (XML) или {base64} */
  files(){
    const rel=(id, type, target)=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`;
    const now=new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const out={
      '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        +'<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
        +'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        +'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        +(this.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '')
        +'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        +'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        +rel('rId1', 'officeDocument/2006/relationships/officeDocument', 'word/document.xml')+rel('rId2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml')
        +rel('rId3', 'officeDocument/2006/relationships/extended-properties', 'docProps/app.xml')+'</Relationships>',
      'docProps/core.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        +'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        +`<dc:title>${DocxWriter.esc(this.title)}</dc:title><dc:creator>${DocxWriter.esc(this.author)}</dc:creator>`
        +`<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
      'docProps/app.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Конструктор КП</Application></Properties>',
      'word/document.xml':this.document(),
      'word/styles.xml':this.styles(),
      'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        +rel('rIdStyles', 'officeDocument/2006/relationships/styles', 'styles.xml')+(this.footer ? rel('rIdFoot', 'officeDocument/2006/relationships/footer', 'footer1.xml') : '')
        +this.media.map(m=>rel(m.id, 'officeDocument/2006/relationships/image', 'media/'+m.name)).join('')+'</Relationships>',
    };
    if (this.footer) out['word/footer1.xml']=this.footerXml();
    for (const m of this.media) out['word/media/'+m.name]={ base64:m.data };
    return out;
  }
  /** пакет .docx: type — 'blob' (браузер) или 'nodebuffer' (проверки в Node) */
  async pack(type='blob'){
    const z=new JSZip();
    for (const [path, v] of Object.entries(this.files())) z.file(path, typeof v==='string' ? v : v.base64, typeof v==='string' ? {} : { base64:true });
    return z.generateAsync({ type, mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression:'DEFLATE' });
  }
}
