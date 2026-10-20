/**
 * Настройки документа Word (word/settings.xml): автоматические переносы слов — по скелету шаблона (out.hyphenate);
 * элементы — на своём месте по схеме Word (сразу после defaultTabStop).
 */
export class DocxSettings {
  static FILE = 'word/settings.xml';
  static HYPH = /<w:(autoHyphenation|consecutiveHyphenLimit|hyphenationZone|doNotHyphenateCaps)\b[^>]*\/>/g;
  static HYPH_ON =
    '<w:autoHyphenation/><w:consecutiveHyphenLimit w:val="2"/><w:hyphenationZone w:val="284"/><w:doNotHyphenateCaps/>';

  /**
   * Переносы слов: включить, выключить или оставить как в шаблоне (hyphenate == null).
   * @param {JSZip} zip
   * @param {boolean|null|undefined} hyphenate
   */
  static async hyphenation(zip, hyphenate) {
    const file = zip.file(this.FILE);
    if (!file || hyphenate == null) return;
    let xml = (await file.async('string')).replace(this.HYPH, '');
    if (hyphenate) xml = this._insert(xml);
    zip.file(this.FILE, xml);
  }

  static _insert(xml) {
    if (/<w:defaultTabStop\b[^>]*\/>/.test(xml))
      return xml.replace(/(<w:defaultTabStop\b[^>]*\/>)/, `$1${this.HYPH_ON}`);
    if (/<w:characterSpacingControl\b/.test(xml))
      return xml.replace(/(<w:characterSpacingControl\b)/, `${this.HYPH_ON}$1`);
    if (/<w:compat>/.test(xml)) return xml.replace('<w:compat>', `${this.HYPH_ON}<w:compat>`);
    return xml;
  }
}

/** Типы частей пакета Word ([Content_Types].xml): свои колонтитулы КП и картинки png/jpg. */
export class DocxTypes {
  static FILE = '[Content_Types].xml';
  static HEAD = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';

  /**
   * Часть word/<name>.xml вида kind ('header' | 'footer') — объявить, если ещё не объявлена.
   * @param {JSZip} zip
   * @param {string} name
   * @param {string} kind
   */
  static async part(zip, name, kind) {
    const types = await zip.file(this.FILE).async('string');
    if (types.includes(`/word/${name}.xml`)) return;
    zip.file(
      this.FILE,
      types.replace(
        '</Types>',
        `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`,
      ),
    );
  }

  /**
   * Картинки png и jpg — объявить по расширению, если их нет.
   * @param {JSZip} zip
   */
  static async images(zip) {
    const types = await zip.file(this.FILE).async('string');
    const png = /Extension="png"/i.test(types);
    const jpg = /Extension="jpg"/i.test(types);
    if (png && jpg) return;
    const add =
      (png ? '' : '<Default Extension="png" ContentType="image/png"/>') +
      (jpg ? '' : '<Default Extension="jpg" ContentType="image/jpeg"/>');
    zip.file(this.FILE, types.replace(this.HEAD, this.HEAD + add));
  }
}

/** Поля страницы из настроек шаблона (page: {top, bottom, left, right} в см; пусто — как в base.docx). */
export class DocxPage {
  static SIDES = [
    ['top', 'w:top'],
    ['bottom', 'w:bottom'],
    ['left', 'w:left'],
    ['right', 'w:right'],
  ];
  static TWIPS_PER_CM = 567;
  static MIN = 0.5;
  static MAX = 6;

  /**
   * Параметры раздела с полями страницы из настроек.
   * @param {string} sect
   * @param {object|undefined} page
   * @returns {string}
   */
  static margins(sect, page) {
    if (!page) return sect;
    let out = sect;
    for (const [key, attr] of this.SIDES) {
      const value = +String(page[key] ?? '').replace(',', '.');
      if (!(value >= this.MIN && value <= this.MAX)) continue;
      out = out.replace(
        new RegExp(`(<w:pgMar[^>]*\\s${attr}=")\\d+(")`),
        `$1${Math.round(value * this.TWIPS_PER_CM)}$2`,
      );
    }
    return out;
  }
}
