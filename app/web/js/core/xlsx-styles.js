/**
 * Таблица стилей книги Excel: шрифты, заливки, рамки и форматы собираются из STYLES без повторов. Стиль: fmt — формат
 * числа, font {b, i, sz, c}, fill — цвет заливки, bd — рамка ('all' | 'bottom' | 'sec'), al {h, v, wrap, ind}.
 */
export class XlsxStyles {
  static BLUE = 'FF0B45A0';
  static LINE = 'FFC9D1E0';
  static INK2 = 'FF66718C';
  static FONT_SIZE = 11;
  static FIRST_CUSTOM_FMT = 164;
  static STYLES = {
    text: { al: { wrap: 1, v: 'top' } },
    bold: { font: { b: 1 } },
    note: { font: { i: 1, sz: 10, c: XlsxStyles.INK2 }, al: { wrap: 1, v: 'top' } },
    title: { font: { b: 1, sz: 16, c: XlsxStyles.BLUE } },
    sub: { font: { sz: 10, c: XlsxStyles.INK2 } },
    money: { fmt: '#,##0.00' },
    money0: { fmt: '#,##0' },
    pct: { fmt: '0.00%' },
    int: { fmt: '0' },
    moneyB: { fmt: '#,##0.00', font: { b: 1 } },
    pctB: { fmt: '0.00%', font: { b: 1 } },
    inp: { fill: 'FFFFF4C2', bd: 'all' },
    inpMoney: { fmt: '#,##0.00', fill: 'FFFFF4C2', bd: 'all' },
    inpInt: { fmt: '0', fill: 'FFFFF4C2', bd: 'all' },
    head: { font: { b: 1, c: 'FFFFFFFF' }, fill: XlsxStyles.BLUE, bd: 'all', al: { wrap: 1, v: 'center' } },
    headR: {
      font: { b: 1, c: 'FFFFFFFF' },
      fill: XlsxStyles.BLUE,
      bd: 'all',
      al: { wrap: 1, v: 'center', h: 'right' },
    },
    sec: { font: { b: 1, sz: 12, c: XlsxStyles.BLUE }, bd: 'sec' },
    grp: { font: { b: 1 }, fill: 'FFE8EEF8' },
    td: { bd: 'all', al: { wrap: 1, v: 'top' } },
    tdC: { bd: 'all', al: { h: 'center', v: 'top' } },
    tdMoney: { fmt: '#,##0', bd: 'all' },
    tdMoney2: { fmt: '#,##0.00', bd: 'all' },
    tdPct: { fmt: '0.0%', bd: 'all' },
    tdInt: { fmt: '0', bd: 'all', al: { h: 'center' } },
    tdNote: { bd: 'all', font: { i: 1, sz: 10, c: XlsxStyles.INK2 }, al: { wrap: 1, v: 'top' } },
    totL: { font: { b: 1 }, fill: 'FFE8EEF8', bd: 'all' },
    totMoney: { fmt: '#,##0', font: { b: 1 }, fill: 'FFE8EEF8', bd: 'all' },
    totPct: { fmt: '0.0%', font: { b: 1 }, fill: 'FFE8EEF8', bd: 'all' },
    kpiL: { font: { sz: 9, c: XlsxStyles.INK2 }, fill: 'FFF3F6FB', al: { v: 'bottom', ind: 1 } },
    kpiV: { fmt: '#,##0 "₽"', font: { b: 1, sz: 13 }, fill: 'FFF3F6FB', al: { v: 'center', ind: 1 } },
    kpiP: { fmt: '0.00%', font: { b: 1, sz: 13 }, fill: 'FFF3F6FB', al: { v: 'center', h: 'left', ind: 1 } },
    kpiVg: { fmt: '#,##0 "₽"', font: { b: 1, sz: 13, c: 'FF1A7F37' }, fill: 'FFF3F6FB', al: { v: 'center', ind: 1 } },
    kpiVr: { fmt: '#,##0 "₽"', font: { b: 1, sz: 13, c: 'FFC62828' }, fill: 'FFF3F6FB', al: { v: 'center', ind: 1 } },
    kpiT: { font: { b: 1, sz: 10 }, fill: 'FFF3F6FB', al: { wrap: 1, v: 'center', ind: 1 } },
    inpDate: { fmt: 'dd.mm.yyyy', fill: 'FFFFF4C2', bd: 'all', al: { h: 'center' } },
    tdDate: { fmt: 'dd.mm.yyyy', bd: 'all', al: { h: 'center' } },
    ok: { font: { b: 1, c: 'FF1A7F37' }, al: { wrap: 1, v: 'top' } },
    warn: { font: { c: 'FF9A5B00' }, al: { wrap: 1, v: 'top' } },
    bad: { font: { b: 1, c: 'FFC62828' }, al: { wrap: 1, v: 'top' } },
    sign: { bd: 'bottom' },
  };

  /**
   * Текст для XML: экранирование, без управляющих символов.
   * @param {*} text
   * @returns {string}
   */
  static esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  static _put(list, xml) {
    let index = list.indexOf(xml);
    if (index < 0) {
      list.push(xml);
      index = list.length - 1;
    }
    return index;
  }

  static _borders() {
    const line = (tag, color) => `<${tag} style="thin"><color rgb="${color}"/></${tag}>`;
    return {
      all: `<border>${['left', 'right', 'top', 'bottom'].map(side => line(side, this.LINE)).join('')}<diagonal/></border>`,
      bottom: `<border><left/><right/><top/><bottom style="thin"><color rgb="FF333333"/></bottom><diagonal/></border>`,
      sec: `<border><left/><right/><top/><bottom style="medium"><color rgb="${this.BLUE}"/></bottom><diagonal/></border>`,
    };
  }

  static _horizontal(align) {
    if (align.h) return ` horizontal="${align.h}"`;
    return align.ind ? ' horizontal="left"' : '';
  }

  static _align(align) {
    if (!align) return '';
    return `<alignment${this._horizontal(align)}${align.v ? ` vertical="${align.v}"` : ''}${align.wrap ? ' wrapText="1"' : ''}${align.ind ? ` indent="${align.ind}"` : ''}/>`;
  }

  static _numFmt(parts, fmt) {
    if (!fmt) return 0;
    return fmt === '0' ? 1 : this.FIRST_CUSTOM_FMT + this._put(parts.fmts, fmt);
  }

  static _font(font) {
    return `<font>${font.b ? '<b/>' : ''}${font.i ? '<i/>' : ''}<sz val="${font.sz || this.FONT_SIZE}"/>${font.c ? `<color rgb="${font.c}"/>` : ''}<name val="Calibri"/></font>`;
  }

  static _xf(parts, style) {
    const fontId = this._put(parts.fonts, this._font(style.font || {}));
    const fill = style.fill
      ? this._put(
          parts.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const border = style.bd ? this._put(parts.borders, parts.kinds[style.bd]) : 0;
    const numFmt = this._numFmt(parts, style.fmt);
    const align = this._align(style.al);
    const flags = `${numFmt ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}`;
    const tail = align ? ` applyAlignment="1">${align}</xf>` : '/>';
    return `<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fill}" borderId="${border}" xfId="0"${flags}${tail}`;
  }

  /**
   * Таблица стилей и номера стилей по именам.
   * @returns {{xml: string, idx: object}}
   */
  static build() {
    const parts = {
      fonts: [],
      fills: ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'],
      borders: ['<border><left/><right/><top/><bottom/><diagonal/></border>'],
      fmts: [],
      kinds: this._borders(),
    };
    const xfs = [];
    const idx = {};
    this._put(parts.fonts, `<font><sz val="${this.FONT_SIZE}"/><name val="Calibri"/></font>`);
    Object.entries(this.STYLES).forEach(([name, style], k) => {
      xfs.push(this._xf(parts, style));
      idx[name] = k + 1;
    });
    xfs.unshift('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    return { xml: this._xml(parts, xfs), idx };
  }

  static _xml({ fonts, fills, borders, fmts }, xfs) {
    const numFmts = fmts
      .map((fmt, k) => `<numFmt numFmtId="${this.FIRST_CUSTOM_FMT + k}" formatCode="${this.esc(fmt)}"/>`)
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${fmts.length}">${numFmts}</numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}
