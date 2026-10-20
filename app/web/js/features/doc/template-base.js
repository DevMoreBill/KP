/**
 * Основа Word шаблона (base.docx): связи документа без картинок и ссылок, параметры страницы последнего раздела и нижний
 * колонтитул — программа пишет свой в файл, на который ссылается шаблон, или добавляет новый.
 */
export class TemplateBase {
  static FOOTER_REF = /<w:footerReference[^>]*w:type="default"[^>]*\/>/;
  static OWN_FOOTER =
    '<Relationship Id="rIdKpFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer_kp.xml"/>';

  /**
   * Значение атрибута XML-элемента.
   * @param {string} xml
   * @param {string} name
   * @returns {string}
   */
  static attr(xml, name) {
    const found = xml.match(new RegExp(`\\s${name}="([^"]*)"`));
    return found ? found[1] : '';
  }

  /**
   * Разбор основы Word.
   * @param {ArrayBuffer} docx
   * @returns {Promise<{rels: string, sect: string, footerPath: string, addFooter: boolean|null}>}
   */
  static async read(docx) {
    const zip = await JSZip.loadAsync(docx);
    const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
    const documentXml = await zip.file('word/document.xml').async('string');
    const keep = (relsXml.match(/<Relationship\s[^>]*\/>/g) || []).filter(
      rel => !/\/(image|hyperlink)"/.test(this.attr(rel, 'Type')),
    );
    const sects = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
    const sect = sects.length ? sects[sects.length - 1] : '';
    if (!sect) throw new Error('в base.docx не найдены параметры страницы');
    const footer = this._footer(sect, keep);
    return { rels: keep.join(''), ...footer };
  }

  static _footer(sect, keep) {
    const ref = sect.match(this.FOOTER_REF);
    const id = ref ? this.attr(ref[0], 'r:id') : '';
    const rel = id && keep.find(row => this.attr(row, 'Id') === id);
    if (rel) {
      const target = this.attr(rel, 'Target')
        .replace(/^\//, '')
        .replace(/^word\//, '');
      return { sect, footerPath: `word/${target}`, addFooter: null };
    }
    keep.push(this.OWN_FOOTER);
    const own = sect
      .replace(this.FOOTER_REF, '')
      .replace(
        /(<w:sectPr[^>]*>(?:\s*<w:headerReference[^>]*\/>)*)/,
        '$1<w:footerReference w:type="default" r:id="rIdKpFooter"/>',
      );
    return { sect: own, footerPath: 'word/footer_kp.xml', addFooter: true };
  }
}
