// Файл Excel (.xlsx) без сторонних библиотек: JSZip (уже есть в программе) + разметка SpreadsheetML.
// Ячейка: строка, число или { v, f, s } — значение, формула Excel (без «=»), стиль. Формулы пересчитываются при открытии.
'use strict';

const XLSX_STYLE = { text:0, bold:1, money:2, pct:3, head:4, title:5, int:6, moneyB:7, note:8, inp:9, inpMoney:10, inpInt:11, pctB:12 };

function xlsxCol(n){ let s=''; n++; while(n){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }

function xlsxEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,''); }

function xlsxSheet(sh){
  const rows=sh.rows.map((row,r)=>{ if (!row) return '';
    const cells=row.map((c,k)=>{ if (c==null || c==='') return '';
      const o=(typeof c==='object') ? c : {v:c}, ref=xlsxCol(k)+(r+1), s=XLSX_STYLE[o.s||(typeof o.v==='number'?'money':'text')]||0;
      if (o.f){ const v=typeof o.v==='number'&&Number.isFinite(o.v) ? `<v>${o.v}</v>` : ''; return `<c r="${ref}" s="${s}"><f>${xlsxEsc(o.f)}</f>${v}</c>`; }
      if (typeof o.v==='number') return Number.isFinite(o.v) ? `<c r="${ref}" s="${s}"><v>${o.v}</v></c>` : '';
      if (o.v==null || o.v==='') return s ? `<c r="${ref}" s="${s}"/>` : '';
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xlsxEsc(o.v)}</t></is></c>`; }).join('');
    return `<row r="${r+1}">${cells}</row>`; }).join('');
  const cols=(sh.cols||[]).map((w,k)=>`<col min="${k+1}" max="${k+1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${sh.freeze?'':''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols?`<cols>${cols}</cols>`:''}<sheetData>${rows}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

// sheets: [{ name, cols:[ширины], rows:[[ячейки]] }] → Blob
async function makeXlsx(sheets, title){
  const z=new JSZip();
  z.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s,k)=>`<Override PartName="/xl/worksheets/sheet${k+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  z.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  z.file('docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xlsxEsc(title||'')}</dc:title><dc:creator>Конструктор КП ПНЕВМОТЕХ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</dcterms:created></cp:coreProperties>`);
  z.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,k)=>`<sheet name="${xlsxEsc(s.name)}" sheetId="${k+1}" r:id="rId${k+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  z.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,k)=>`<Relationship Id="rId${k+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // стили: 0 текст, 1 жирный, 2 деньги, 3 проценты (число 22 → «22,00 %» не нужно: проценты в Excel — доли), 4 заголовок таблицы,
  // 5 заголовок листа, 6 целое, 7 деньги жирные, 8 примечание, 9–11 вводимые данные (жёлтая заливка), 12 проценты жирные
  z.file('xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B45A0"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF66718C"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B45A0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8DC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
<xf numFmtId="1" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s,k)=>z.file(`xl/worksheets/sheet${k+1}.xml`, xlsxSheet(s)));
  return z.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
