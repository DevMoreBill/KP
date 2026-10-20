import { XlsxStyles } from './xlsx-styles.js';

/**
 * Лист книги: ячейка — строка, число или { v, f, s } — значение, формула Excel (без «=»), стиль из XlsxStyles.STYLES.
 * Лист: { name, hidden — скрытый, cols: [ширины], rows: [[ячейки]], merges: ['A1:F1'], heights: {номерСтроки: высота},
 * freeze: строк, grid: false, landscape, titles: '4:4' (строки, повторяемые при печати), onePage — печать на одном листе }.
 */
export class XlsxSheet {
  static LETTERS = 26;
  static CODE_A = 65;

  /**
   * Буква столбца: 0 → A, 26 → AA.
   * @param {number} index
   * @returns {string}
   */
  static col(index) {
    let name = '';
    let rest = index + 1;
    while (rest) {
      const letter = (rest - 1) % this.LETTERS;
      name = String.fromCharCode(this.CODE_A + letter) + name;
      rest = Math.floor((rest - 1) / this.LETTERS);
    }
    return name;
  }

  static _cell(cell, ref, idx) {
    if (cell == null || cell === '') return '';
    const data = typeof cell === 'object' ? cell : { v: cell };
    const isNum = typeof data.v === 'number';
    const style = idx[data.s || (isNum ? 'money' : 'text')] || 0;
    if (data.f) {
      const cached = isNum && Number.isFinite(data.v) ? `<v>${data.v}</v>` : '';
      return `<c r="${ref}" s="${style}"><f>${XlsxStyles.esc(data.f)}</f>${cached}</c>`;
    }
    return isNum ? this._num(data.v, ref, style) : this._text(data.v, ref, style);
  }

  static _num(value, ref, style) {
    return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}"/>`;
  }

  static _text(value, ref, style) {
    if (value == null || value === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${XlsxStyles.esc(value)}</t></is></c>`;
  }

  static _rows(sheet, idx) {
    const heights = sheet.heights || {};
    return sheet.rows
      .map((row, i) => {
        const cells = (row || []).map((cell, k) => this._cell(cell, this.col(k) + (i + 1), idx)).join('');
        const height = heights[i + 1];
        if (!cells && !height) return '';
        return `<row r="${i + 1}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`;
      })
      .join('');
  }

  static _freeze(rows) {
    if (!rows) return '';
    return `<pane ySplit="${rows}" topLeftCell="A${rows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${rows + 1}" sqref="A${rows + 1}"/>`;
  }

  static _merges(merges) {
    if (!(merges || []).length) return '';
    return `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  }

  static _print(sheet) {
    const margins = sheet.onePage
      ? '<pageMargins left="0.35" right="0.35" top="0.35" bottom="0.45" header="0.2" footer="0.2"/>'
      : '<pageMargins left="0.5" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>';
    return `<printOptions horizontalCentered="1"/>${margins}<pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="${sheet.onePage ? 1 : 0}"/>`;
  }

  /**
   * Разметка листа (first — выбранный при открытии).
   * @param {object} sheet
   * @param {object} idx номера стилей по именам
   * @returns {string}
   */
  static xml(sheet, idx) {
    const cols = (sheet.cols || [])
      .map((width, k) => `<col min="${k + 1}" max="${k + 1}" width="${width}" customWidth="1"/>`)
      .join('');
    const view = `<sheetView workbookViewId="0"${sheet.grid === false ? ' showGridLines="0"' : ''}${sheet.first ? ' tabSelected="1"' : ''}>${this._freeze(sheet.freeze)}</sheetView>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${this._rows(sheet, idx)}</sheetData>${this._merges(sheet.merges)}
${this._print(sheet)}
<headerFooter><oddFooter>&amp;L&amp;8${XlsxStyles.esc(sheet.footer || '')}&amp;R&amp;8Лист &amp;P из &amp;N</oddFooter></headerFooter></worksheet>`;
  }
}

/** Файл Excel (.xlsx) без сторонних библиотек: JSZip (уже есть в программе) + разметка SpreadsheetML; формулы пересчитываются при открытии. */
export class XlsxBook {
  static MS_PER_DAY = 864e5;
  // 1970-01-01 в днях Excel (счёт от 30.12.1899)
  static UNIX_EPOCH_DAY = 25569;
  static XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  static MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /**
   * Дата → число Excel; 'ГГГГ-ММ-ДД' или пусто.
   * @param {string} iso
   * @returns {number | string}
   */
  static date(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return '';
    return Date.UTC(+match[1], +match[2] - 1, +match[3]) / this.MS_PER_DAY + this.UNIX_EPOCH_DAY;
  }

  /**
   * Книга из листов.
   * @param {object[]} sheets [{ name, cols, rows, ... }]
   * @param {string} [title]
   * @returns {Promise<Blob>}
   */
  static make(sheets, title) {
    const zip = new JSZip();
    const styles = XlsxStyles.build();
    zip.file('[Content_Types].xml', this._types(sheets));
    zip.file('_rels/.rels', this._rels());
    zip.file('docProps/core.xml', this._core(title));
    zip.file('xl/workbook.xml', this._workbook(sheets));
    zip.file('xl/_rels/workbook.xml.rels', this._bookRels(sheets));
    zip.file('xl/styles.xml', styles.xml);
    sheets.forEach((sheet, k) =>
      zip.file(`xl/worksheets/sheet${k + 1}.xml`, XlsxSheet.xml({ ...sheet, first: k === 0 }, styles.idx)),
    );
    return zip.generateAsync({ type: 'blob', mimeType: this.MIME });
  }

  static _types(sheets) {
    const overrides = sheets
      .map(
        (_, k) =>
          `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('');
    return `${this.XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  }

  static _rels() {
    return `${this.XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  }

  static _core(title) {
    const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return `${this.XML}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${XlsxStyles.esc(title || '')}</dc:title><dc:creator>Конструктор КП ПНЕВМОТЕХ</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`;
  }

  static _workbook(sheets) {
    const names = sheets
      .map((sheet, k) =>
        sheet.titles
          ? `<definedName name="_xlnm.Print_Titles" localSheetId="${k}">'${XlsxStyles.esc(sheet.name)}'!$${sheet.titles.replace(':', ':$')}</definedName>`
          : '',
      )
      .join('');
    const list = sheets
      .map(
        (sheet, k) =>
          `<sheet name="${XlsxStyles.esc(sheet.name)}" sheetId="${k + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${k + 1}"/>`,
      )
      .join('');
    return `${this.XML}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${list}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  }

  static _bookRels(sheets) {
    const list = sheets
      .map(
        (_, k) =>
          `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`,
      )
      .join('');
    return `${this.XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }
}
