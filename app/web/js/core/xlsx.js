// Файл Excel (.xlsx) без сторонних библиотек: JSZip (уже есть в программе) + разметка SpreadsheetML.
// Ячейка: строка, число или { v, f, s } — значение, формула Excel (без «=»), стиль из XLSX_STYLES. Формулы пересчитываются при открытии.
// Лист: { name, cols:[ширины], rows:[[ячейки]], merges:['A1:F1'], heights:{номерСтроки:высота}, freeze:строк, grid:false,
//         landscape:true, titles:'4:4' (строки, повторяемые при печати), onePage:true — печать на одном листе }.
'use strict';

const XLSX_BLUE='FF0B45A0', XLSX_LINE='FFC9D1E0', XLSX_INK2='FF66718C';
// стиль: fmt — формат числа, font {b,i,sz,c}, fill — цвет заливки, bd — рамка ('all' | 'top' | 'bottom' | 'sec'), al {h, v, wrap, ind}
const XLSX_STYLES = {
  text:{al:{wrap:1, v:'top'}}, bold:{font:{b:1}}, note:{font:{i:1, sz:10, c:XLSX_INK2}, al:{wrap:1, v:'top'}},
  title:{font:{b:1, sz:16, c:XLSX_BLUE}}, sub:{font:{sz:10, c:XLSX_INK2}},
  money:{fmt:'#,##0.00'}, money0:{fmt:'#,##0'}, pct:{fmt:'0.00%'}, int:{fmt:'0'}, moneyB:{fmt:'#,##0.00', font:{b:1}}, pctB:{fmt:'0.00%', font:{b:1}},
  inp:{fill:'FFFFF4C2', bd:'all'}, inpMoney:{fmt:'#,##0.00', fill:'FFFFF4C2', bd:'all'}, inpInt:{fmt:'0', fill:'FFFFF4C2', bd:'all'},
  head:{font:{b:1, c:'FFFFFFFF'}, fill:XLSX_BLUE, bd:'all', al:{wrap:1, v:'center'}},
  headR:{font:{b:1, c:'FFFFFFFF'}, fill:XLSX_BLUE, bd:'all', al:{wrap:1, v:'center', h:'right'}},
  sec:{font:{b:1, sz:12, c:XLSX_BLUE}, bd:'sec'},
  grp:{font:{b:1}, fill:'FFE8EEF8'},
  td:{bd:'all', al:{wrap:1, v:'top'}}, tdC:{bd:'all', al:{h:'center', v:'top'}}, tdMoney:{fmt:'#,##0', bd:'all'}, tdMoney2:{fmt:'#,##0.00', bd:'all'},
  tdPct:{fmt:'0.0%', bd:'all'}, tdInt:{fmt:'0', bd:'all', al:{h:'center'}}, tdNote:{bd:'all', font:{i:1, sz:10, c:XLSX_INK2}, al:{wrap:1, v:'top'}},
  totL:{font:{b:1}, fill:'FFE8EEF8', bd:'all'}, totMoney:{fmt:'#,##0', font:{b:1}, fill:'FFE8EEF8', bd:'all'}, totPct:{fmt:'0.0%', font:{b:1}, fill:'FFE8EEF8', bd:'all'},
  kpiL:{font:{sz:10, c:XLSX_INK2}, fill:'FFF3F6FB', al:{wrap:1, v:'bottom'}},
  kpiV:{fmt:'#,##0 "₽"', font:{b:1, sz:14}, fill:'FFF3F6FB'}, kpiP:{fmt:'0.00%', font:{b:1, sz:14}, fill:'FFF3F6FB'},
  kpiVg:{fmt:'#,##0 "₽"', font:{b:1, sz:14, c:'FF1A7F37'}, fill:'FFF3F6FB'}, kpiVr:{fmt:'#,##0 "₽"', font:{b:1, sz:14, c:'FFC62828'}, fill:'FFF3F6FB'},
  kpiT:{font:{b:1, sz:12}, fill:'FFF3F6FB', al:{wrap:1}},
  ok:{font:{b:1, c:'FF1A7F37'}, al:{wrap:1, v:'top'}}, warn:{font:{c:'FF9A5B00'}, al:{wrap:1, v:'top'}}, bad:{font:{b:1, c:'FFC62828'}, al:{wrap:1, v:'top'}},
  sign:{bd:'bottom'},
};

function xlsxCol(n){ let s=''; n++; while(n){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }

function xlsxEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,''); }

// таблица стилей: шрифты, заливки, рамки и форматы собираются из XLSX_STYLES без повторов
function xlsxStyles(){
  const fonts=[], fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'], borders=['<border><left/><right/><top/><bottom/><diagonal/></border>'], fmts=[], xfs=[], idx={};
  const put=(arr, x)=>{ let k=arr.indexOf(x); if (k<0){ arr.push(x); k=arr.length-1; } return k; };
  const line=(t,c)=>`<${t} style="thin"><color rgb="${c}"/></${t}>`;
  const bds={ all:`<border>${['left','right','top','bottom'].map(s=>line(s,XLSX_LINE)).join('')}<diagonal/></border>`,
    bottom:`<border><left/><right/><top/><bottom style="thin"><color rgb="FF333333"/></bottom><diagonal/></border>`,
    sec:`<border><left/><right/><top/><bottom style="medium"><color rgb="${XLSX_BLUE}"/></bottom><diagonal/></border>` };
  put(fonts, '<font><sz val="11"/><name val="Calibri"/></font>');
  Object.entries(XLSX_STYLES).forEach(([name,o],k)=>{ const f=o.font||{};
    const font=put(fonts, `<font>${f.b?'<b/>':''}${f.i?'<i/>':''}<sz val="${f.sz||11}"/>${f.c?`<color rgb="${f.c}"/>`:''}<name val="Calibri"/></font>`);
    const fill=o.fill?put(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`):0;
    const bd=o.bd?put(borders, bds[o.bd]):0;
    const nf=o.fmt ? (o.fmt==='0'?1:164+put(fmts, o.fmt)) : 0, a=o.al;
    const al=a?`<alignment${a.h?` horizontal="${a.h}"`:''}${a.v?` vertical="${a.v}"`:''}${a.wrap?' wrapText="1"':''}/>`:'';
    xfs.push(`<xf numFmtId="${nf}" fontId="${font}" fillId="${fill}" borderId="${bd}" xfId="0"${nf?' applyNumberFormat="1"':''}${font?' applyFont="1"':''}${fill?' applyFill="1"':''}${bd?' applyBorder="1"':''}${al?' applyAlignment="1">'+al+'</xf>':'/>'}`);
    idx[name]=k+1; });
  xfs.unshift('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${fmts.length}">${fmts.map((f,k)=>`<numFmt numFmtId="${164+k}" formatCode="${xlsxEsc(f)}"/>`).join('')}</numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return {xml, idx};
}

function xlsxSheet(sh, idx){
  const H=sh.heights||{};
  const rows=sh.rows.map((row,r)=>{ if (!row) row=[];
    const cells=row.map((c,k)=>{ if (c==null || c==='') return '';
      const o=(typeof c==='object') ? c : {v:c}, ref=xlsxCol(k)+(r+1), s=idx[o.s||(typeof o.v==='number'?'money':'text')]||0;
      if (o.f){ const v=typeof o.v==='number'&&Number.isFinite(o.v) ? `<v>${o.v}</v>` : ''; return `<c r="${ref}" s="${s}"><f>${xlsxEsc(o.f)}</f>${v}</c>`; }
      if (typeof o.v==='number') return Number.isFinite(o.v) ? `<c r="${ref}" s="${s}"><v>${o.v}</v></c>` : `<c r="${ref}" s="${s}"/>`;
      if (o.v==null || o.v==='') return s ? `<c r="${ref}" s="${s}"/>` : '';
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xlsxEsc(o.v)}</t></is></c>`; }).join('');
    const h=H[r+1];
    if (!cells && !h) return '';
    return `<row r="${r+1}"${h?` ht="${h}" customHeight="1"`:''}>${cells}</row>`; }).join('');
  const cols=(sh.cols||[]).map((w,k)=>`<col min="${k+1}" max="${k+1}" width="${w}" customWidth="1"/>`).join('');
  const fr=sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze+1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze+1}" sqref="A${sh.freeze+1}"/>` : '';
  const mg=(sh.merges||[]).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${sh.grid===false?' showGridLines="0"':''}${sh.first?' tabSelected="1"':''}>${fr}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols?`<cols>${cols}</cols>`:''}<sheetData>${rows}</sheetData>${mg}
<printOptions horizontalCentered="1"/>${sh.onePage?'<pageMargins left="0.35" right="0.35" top="0.35" bottom="0.45" header="0.2" footer="0.2"/>':'<pageMargins left="0.5" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>'}<pageSetup paperSize="9" orientation="${sh.landscape?'landscape':'portrait'}" fitToWidth="1" fitToHeight="${sh.onePage?1:0}"/>
<headerFooter><oddFooter>&amp;L&amp;8${xlsxEsc(sh.footer||'')}&amp;R&amp;8Лист &amp;P из &amp;N</oddFooter></headerFooter></worksheet>`;
}

// sheets: [{ name, cols, rows, ... }] → Blob
async function makeXlsx(sheets, title){
  const z=new JSZip(), st=xlsxStyles();
  z.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s,k)=>`<Override PartName="/xl/worksheets/sheet${k+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  z.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  z.file('docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xlsxEsc(title||'')}</dc:title><dc:creator>Конструктор КП ПНЕВМОТЕХ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</dcterms:created></cp:coreProperties>`);
  const names=sheets.map((s,k)=>s.titles?`<definedName name="_xlnm.Print_Titles" localSheetId="${k}">'${xlsxEsc(s.name)}'!$${s.titles.replace(':',':$')}</definedName>`:'').join('');
  z.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,k)=>`<sheet name="${xlsxEsc(s.name)}" sheetId="${k+1}" r:id="rId${k+1}"/>`).join('')}</sheets>${names?`<definedNames>${names}</definedNames>`:''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  z.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,k)=>`<Relationship Id="rId${k+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', st.xml);
  sheets.forEach((s,k)=>z.file(`xl/worksheets/sheet${k+1}.xml`, xlsxSheet({...s, first:k===0}, st.idx)));
  return z.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
