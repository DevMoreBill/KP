/**
 * Документ Word (.docx) без шаблона — для документов, которые программа составляет сама (ТЗ на сборку станции, вопросы
 * заказчику, правила станций): заголовки, абзацы, пункты, таблицы, рисунки, разрыв страницы, нижний колонтитул с номером
 * страницы. WordprocessingML собирается строками и упаковывается JSZip. КП собирается по шаблону — KpDocx.
 */
export class DocxWriter {
  static EMU = 36000; // единиц EMU в 1 мм
  static TWIPS_PER_MM = 56.7; // твипов (1/20 пункта) в 1 мм
  static PAGE = [210, 297]; // А4, мм
  static MARGINS = [20, 15, 20, 25];
  static TWIPS_PER_POINT = 20;
  static HALF_POINTS = 2;
  static AFTER = 4;
  static MAX_HEIGHT = 235;
  static ITEM_INDENT = 8;
  static ITEM_AFTER = 2;
  static IMAGE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
  static CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  static ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  static NAMESPACES =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  static XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  static MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /**
   * @param {{title?: string, author?: string, footer?: string, margins?: number[]}} [options] title и author — свойства
   *   документа, footer — текст нижнего колонтитула, margins — [верх, право, низ, лево], мм
   */
  constructor(options = {}) {
    this.title = String(options.title || '');
    this.author = String(options.author || '');
    this.footer = String(options.footer || '');
    this.margins = options.margins || DocxWriter.MARGINS;
    this.body = [];
    this.media = [];
  }

  /**
   * Ширина поля текста, мм.
   * @returns {number}
   */
  get width() {
    return DocxWriter.PAGE[0] - this.margins[1] - this.margins[3];
  }

  /**
   * Текст для XML: без управляющих знаков, со сменой &, <, >, ".
   * @param {*} text
   * @returns {string}
   */
  static esc(text) {
    return String(text ?? '')
      .replace(this.CONTROL, '')
      .replace(/[&<>"]/g, char => this.ENTITIES[char]);
  }

  static _twips(points) {
    return Math.round(points * this.TWIPS_PER_POINT);
  }

  static _runProps(run) {
    return (
      (run.b ? '<w:b/>' : '') +
      (run.i ? '<w:i/>' : '') +
      (run.sz ? `<w:sz w:val="${Math.round(run.sz * this.HALF_POINTS)}"/>` : '') +
      (run.color ? `<w:color w:val="${run.color}"/>` : '')
    );
  }

  /**
   * Куски текста: строка или [[текст, {b, i, sz, color}], …]; перевод строки — разрыв строки.
   * @param {string|Array} text
   * @param {object} [base] оформление всех кусков
   * @returns {string}
   */
  static runs(text, base = {}) {
    const parts = Array.isArray(text) ? text : [[text, {}]];
    return parts
      .map(([value, own = {}]) => {
        const props = this._runProps({ ...base, ...own });
        const head = props ? `<w:rPr>${props}</w:rPr>` : '';
        return String(value ?? '')
          .split('\n')
          .map((line, k) => `<w:r>${head}${k ? '<w:br/>' : ''}<w:t xml:space="preserve">${this.esc(line)}</w:t></w:r>`)
          .join('');
      })
      .join('');
  }

  static _paraProps(options) {
    const spacing =
      options.before != null || options.after != null
        ? `<w:spacing w:before="${this._twips(options.before || 0)}" w:after="${this._twips(options.after ?? this.AFTER)}"/>`
        : '';
    const indent = options.ind
      ? `<w:ind w:left="${Math.round(options.ind * this.TWIPS_PER_MM)}" w:hanging="${Math.round((options.hang || 0) * this.TWIPS_PER_MM)}"/>`
      : '';
    return (
      (options.style ? `<w:pStyle w:val="${options.style}"/>` : '') +
      (options.keep ? '<w:keepNext/>' : '') +
      (options.page ? '<w:pageBreakBefore/>' : '') +
      spacing +
      indent +
      (options.align ? `<w:jc w:val="${options.align}"/>` : '')
    );
  }

  /**
   * Абзац.
   * @param {string|Array} text
   * @param {object} [options] style, align, keep (с следующим), page (с новой страницы), before/after (пт), ind/hang (мм),
   *   run (оформление текста)
   * @returns {DocxWriter}
   */
  para(text, options = {}) {
    const props = DocxWriter._paraProps(options);
    this.body.push(`<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${DocxWriter.runs(text, options.run || {})}</w:p>`);
    return this;
  }

  /**
   * Заголовок документа.
   * @param {string} text
   * @returns {DocxWriter}
   */
  title1(text) {
    return this.para(text, { style: 'Title' });
  }

  /**
   * Заголовок раздела.
   * @param {string} text
   * @param {{page?: boolean}} [options] page — с новой страницы
   * @returns {DocxWriter}
   */
  heading(text, options = {}) {
    return this.para(text, { style: 'Heading1', keep: true, page: options.page });
  }

  /**
   * Заголовок подраздела.
   * @param {string} text
   * @returns {DocxWriter}
   */
  subheading(text) {
    return this.para(text, { style: 'Heading2', keep: true });
  }

  /**
   * Пункты с номерами «1.», «2.» (prefix «3.» → «3.1.»): номер текстом — одинаково в Word и LibreOffice.
   * @param {Array} list
   * @param {string} [prefix]
   * @returns {DocxWriter}
   */
  items(list, prefix = '') {
    const step = DocxWriter.ITEM_INDENT;
    list.filter(Boolean).forEach((text, k) =>
      this.para([[`${prefix}${k + 1}. `, {}], ...(Array.isArray(text) ? text : [[text, {}]])], {
        ind: step,
        hang: step,
        after: DocxWriter.ITEM_AFTER,
      }),
    );
    return this;
  }

  /**
   * Таблица: ширины столбцов (мм, сумма — по ширине поля), заголовки, строки (строка или куски текста в ячейке).
   * @param {number[]} cols
   * @param {Array|null} head
   * @param {Array[]} rows
   * @returns {DocxWriter}
   */
  table(cols, head, rows) {
    const scale = this.width / cols.reduce((sum, width) => sum + width, 0);
    const twips = cols.map(width => Math.round(width * scale * DocxWriter.TWIPS_PER_MM));
    const row = (cells, isHead) =>
      `<w:tr><w:trPr><w:cantSplit/>${isHead ? '<w:tblHeader/>' : ''}</w:trPr>${cells.map((text, j) => this._cell(text, twips[j], isHead)).join('')}</w:tr>`;
    this.body.push(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="${twips.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
        `<w:tblGrid>${twips.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${head ? row(head, true) : ''}${rows.map(cells => row(cells, false)).join('')}</w:tbl>`,
    );
    return this.para('', { after: DocxWriter.ITEM_AFTER });
  }

  _cell(text, width, isHead) {
    return (
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF5"/>' : ''}</w:tcPr>` +
      `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/>${isHead ? '<w:keepNext/>' : ''}</w:pPr>${DocxWriter.runs(text, isHead ? { b: true } : {})}</w:p></w:tc>`
    );
  }

  /**
   * Рисунок data:image/png|jpeg шириной width мм, не выше maxH мм; подпись — под ним; page — с новой страницы (без
   * пустого абзаца с разрывом: он мог бы уйти на отдельную страницу).
   * @param {string} src
   * @param {{px: number, py: number, width?: number, caption?: string, maxH?: number, page?: boolean}} options px и py —
   *   ширина и высота картинки в точках
   * @returns {DocxWriter}
   */
  image(src, options) {
    const { px, py, caption, maxH = DocxWriter.MAX_HEIGHT, page } = options;
    const found = String(src || '').match(DocxWriter.IMAGE);
    if (!found || !(px > 0 && py > 0)) return this;
    let width = Math.min(options.width || this.width, this.width);
    let height = (width * py) / px;
    if (height > maxH) {
      width *= maxH / height;
      height = maxH;
    }
    const number = this.media.length + 1;
    const ext = found[1] === 'png' ? 'png' : 'jpeg';
    const id = `rIdImg${number}`;
    this.media.push({ name: `image${number}.${ext}`, data: found[2], id });
    const size = { cx: Math.round(width * DocxWriter.EMU), cy: Math.round(height * DocxWriter.EMU) };
    this.body.push(this._drawing({ number, ext, id, page, ...size }));
    if (caption) this.para(caption, { style: 'Caption' });
    return this;
  }

  _drawing({ number, ext, id, page, cx, cy }) {
    return (
      `<w:p><w:pPr><w:keepNext/>${page ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="60" w:after="40"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Рисунок ${number}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${number}" name="image${number}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }

  /**
   * Разрыв страницы.
   * @returns {DocxWriter}
   */
  pageBreak() {
    this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    return this;
  }

  /**
   * Стили документа (word/styles.xml).
   * @returns {string}
   */
  styles() {
    const style = (id, name, props, extra = '') =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:pPr>${props[0]}</w:pPr><w:rPr>${props[1]}</w:rPr></w:style>`;
    return [
      `${DocxWriter.XML}<w:styles ${DocxWriter.NAMESPACES}>`,
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>',
      '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
      style(
        'Title',
        'Title',
        ['<w:spacing w:before="0" w:after="120"/><w:jc w:val="center"/>', '<w:b/><w:sz w:val="30"/>'],
        '<w:qFormat/>',
      ),
      style(
        'Heading1',
        'heading 1',
        [
          '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/>',
          '<w:b/><w:color w:val="1F3A5F"/><w:sz w:val="26"/>',
        ],
        '<w:qFormat/>',
      ),
      style(
        'Heading2',
        'heading 2',
        ['<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="22"/>'],
        '<w:qFormat/>',
      ),
      style(
        'Caption',
        'caption',
        ['<w:spacing w:before="20" w:after="160"/><w:jc w:val="center"/>', '<w:i/><w:sz w:val="18"/>'],
        '<w:qFormat/>',
      ),
      style('Footer', 'footer', [
        '<w:spacing w:after="0"/><w:jc w:val="right"/>',
        '<w:color w:val="666666"/><w:sz w:val="16"/>',
      ]),
      '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders>',
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="8A96A3"/>`)
        .join(''),
      '</w:tblBorders></w:tblPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>',
    ].join('');
  }

  /**
   * Текст документа (word/document.xml).
   * @returns {string}
   */
  document() {
    const [top, right, bottom, left] = this.margins.map(value => Math.round(value * DocxWriter.TWIPS_PER_MM));
    const [pageW, pageH] = DocxWriter.PAGE.map(value => Math.round(value * DocxWriter.TWIPS_PER_MM));
    return (
      `${DocxWriter.XML}<w:document ${DocxWriter.NAMESPACES}><w:body>${this.body.join('')}` +
      `<w:sectPr>${this.footer ? '<w:footerReference w:type="default" r:id="rIdFoot"/>' : ''}<w:pgSz w:w="${pageW}" w:h="${pageH}"/>` +
      `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr></w:body></w:document>`
    );
  }

  /**
   * Нижний колонтитул с номером страницы.
   * @returns {string}
   */
  footerXml() {
    return (
      `${DocxWriter.XML}<w:ftr ${DocxWriter.NAMESPACES}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>` +
      `${DocxWriter.runs(`${this.footer} — стр. `)}<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`
    );
  }

  static _rel(id, type, target) {
    return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`;
  }

  _contentTypes() {
    return [
      `${DocxWriter.XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      this.footer
        ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        : '',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    ].join('');
  }

  static _packageRels() {
    return [
      `${this.XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
      this._rel('rId1', 'officeDocument/2006/relationships/officeDocument', 'word/document.xml'),
      this._rel('rId2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml'),
      this._rel('rId3', 'officeDocument/2006/relationships/extended-properties', 'docProps/app.xml'),
      '</Relationships>',
    ].join('');
  }

  _core() {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return (
      `${DocxWriter.XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${DocxWriter.esc(this.title)}</dc:title><dc:creator>${DocxWriter.esc(this.author)}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
    );
  }

  _documentRels() {
    return [
      `${DocxWriter.XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
      DocxWriter._rel('rIdStyles', 'officeDocument/2006/relationships/styles', 'styles.xml'),
      this.footer ? DocxWriter._rel('rIdFoot', 'officeDocument/2006/relationships/footer', 'footer1.xml') : '',
      this.media
        .map(media => DocxWriter._rel(media.id, 'officeDocument/2006/relationships/image', `media/${media.name}`))
        .join(''),
      '</Relationships>',
    ].join('');
  }

  /**
   * Части пакета: путь → текст (XML) или {base64}.
   * @returns {object}
   */
  files() {
    const out = {
      '[Content_Types].xml': this._contentTypes(),
      '_rels/.rels': DocxWriter._packageRels(),
      'docProps/core.xml': this._core(),
      'docProps/app.xml': `${DocxWriter.XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Конструктор КП</Application></Properties>`,
      'word/document.xml': this.document(),
      'word/styles.xml': this.styles(),
      'word/_rels/document.xml.rels': this._documentRels(),
    };
    if (this.footer) out['word/footer1.xml'] = this.footerXml();
    for (const media of this.media) out[`word/media/${media.name}`] = { base64: media.data };
    return out;
  }

  /**
   * Пакет .docx.
   * @param {string} [type] 'blob' (браузер) или 'nodebuffer' (проверки в Node)
   * @returns {Promise<Blob|Buffer>}
   */
  async pack(type = 'blob') {
    const zip = new JSZip();
    for (const [path, value] of Object.entries(this.files())) {
      if (typeof value === 'string') zip.file(path, value, {});
      else zip.file(path, value.base64, { base64: true });
    }
    return zip.generateAsync({ type, mimeType: DocxWriter.MIME, compression: 'DEFLATE' });
  }
}
