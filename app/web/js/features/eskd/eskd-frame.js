import { EskdSheet } from './eskd-sheet.js';

/** Рамка листа А4 и основная надпись. */
export class EskdFrame {
  static RIGHT = 205;
  static BOTTOM = 292;
  static TEXT_H = 2.5;

  /** Линии формы 1 от правого нижнего угла рамки: вертикальные [x, y0, y1, тип]. */
  static LINES_V = [
    [185, 0, 55],
    [120, 0, 55],
    [130, 0, 55],
    [145, 0, 55],
    [168, 0, 55],
    [178, 30, 55],
    [50, 0, 40],
    [35, 20, 40],
    [18, 20, 40],
    [30, 15, 20],
    [45, 20, 35, 'thin'],
    [40, 20, 35, 'thin'],
  ];

  /** Горизонтальные [y, x0, x1, тип]. */
  static LINES_H = [
    [55, 185, 0],
    [35, 185, 120],
    [30, 185, 120],
    [40, 120, 0],
    [15, 120, 0],
    [35, 50, 0],
    [20, 50, 0],
    [40, 185, 120, 'thin'],
    [45, 185, 120, 'thin'],
    [50, 185, 120, 'thin'],
    [25, 185, 120, 'thin'],
    [20, 185, 120, 'thin'],
    [15, 185, 120, 'thin'],
    [10, 185, 120, 'thin'],
    [5, 185, 120, 'thin'],
  ];

  static CHANGES = [
    [181.5, 'Изм.'],
    [173, 'Лист'],
    [156.5, '№ докум.'],
    [137.5, 'Подп.'],
    [125, 'Дата'],
  ];

  static SIGNS = [
    [27.5, 'Разраб.'],
    [22.5, 'Пров.'],
    [17.5, 'Т.контр.'],
    [7.5, 'Н.контр.'],
    [2.5, 'Утв.'],
  ];

  /** Графы на поле подшивки: [y, подпись]; первые пять — и на последующих листах. */
  static MARGIN = [
    [279.5, 'Инв. № подл.'],
    [249.5, 'Подп. и дата'],
    [219.5, 'Взам. инв. №'],
    [194.5, 'Инв. № дубл.'],
    [164.5, 'Подп. и дата'],
    [35, 'Перв. примен.'],
    [95, 'Справ. №'],
  ];

  /** Отступ v от правого края рамки — координата x. */
  static fromRight(value) {
    return EskdFrame.RIGHT - value;
  }

  /** Отступ v от нижнего края рамки — координата y. */
  static fromBottom(value) {
    return EskdFrame.BOTTOM - value;
  }

  /** Tb — {name, doc, code, lit, mass, scale, sheet, sheets, org, dev, date, next}. */
  static draw(sheet, titleBlock) {
    sheet.rect([20, 5, 185, 287], 'frame');
    if (titleBlock.next) EskdFrame.form2a(sheet, titleBlock);
    else EskdFrame._form1(sheet, titleBlock);
    EskdFrame.margin(sheet, !titleBlock.next);
    EskdFrame.code26(sheet, titleBlock);
    sheet.text(95, 296, 'Копировал', EskdFrame.TEXT_H);
    sheet.text(163, 296, `Формат ${sheet.fmt}`, EskdFrame.TEXT_H);
  }

  static _form1(sheet, titleBlock) {
    const { fromRight: fromRight, fromBottom: fromBottom } = EskdFrame;
    for (const [x, start, end, type] of EskdFrame.LINES_V)
      sheet.line(fromRight(x), fromBottom(start), fromRight(x), fromBottom(end), type || 'frame');
    for (const [y, start, end, type] of EskdFrame.LINES_H)
      sheet.line(fromRight(start), fromBottom(y), fromRight(end), fromBottom(y), type || 'frame');
    const cell = (x, y, text, opts = {}) =>
      sheet.text(fromRight(x), fromBottom(y) + (opts.h || EskdFrame.TEXT_H) / 2, text, opts.h || EskdFrame.TEXT_H, {
        a: opts.a || 'middle',
      });
    for (const [x, text] of EskdFrame.CHANGES) cell(x, 32.5, text);
    for (const [y, text] of EskdFrame.SIGNS) cell(184.3, y, text, { a: 'start' });
    EskdFrame.fields(titleBlock, cell);
    EskdFrame.name(sheet, titleBlock);
    if (titleBlock.code) {
      const [type, textH] = EskdSheet.fit(titleBlock.code, 116, 7, 3.5);
      cell(60, 47.5, type, { h: textH });
    }
    if (titleBlock.org) {
      const lines = EskdSheet.wrap(titleBlock.org, 47, 3.5).slice(0, 2);
      lines.forEach((text, i) => {
        const [type, textH] = EskdSheet.fit(text, 47, 3.5, 2.5);
        sheet.text(fromRight(25), fromBottom(7.5) + textH / 2 + (i - (lines.length - 1) / 2) * 4.6, type, textH, {
          a: 'middle',
        });
      });
    }
  }

  /** Разработчик, дата, литера, масса, масштаб, лист и листов. */
  static fields(titleBlock, cell) {
    const textH = EskdFrame.TEXT_H;
    if (titleBlock.dev) {
      const [text, fittedH] = EskdSheet.fit(titleBlock.dev, 21.5, textH, 1.8);
      cell(167.3, 27.5, text, { a: 'start', h: fittedH });
    }
    const date = EskdSheet.date(titleBlock.date) || titleBlock.date;
    if (date) cell(125, 27.5, date, { h: EskdSheet.fit(date, 9.4, textH, 1.6)[1] });
    for (const [x, text] of [
      [42, 'Лит.'],
      [26.5, 'Масса'],
      [9, 'Масштаб'],
    ])
      cell(x, 37.5, text);
    if (titleBlock.lit) cell(47.5, 27.5, titleBlock.lit, { h: 3.5 });
    if (titleBlock.mass) cell(26.5, 27.5, titleBlock.mass, { h: EskdSheet.fit(titleBlock.mass, 16, 3.5, 2.5)[1] });
    if (titleBlock.scale) cell(9, 27.5, titleBlock.scale, { h: EskdSheet.fit(titleBlock.scale, 17, 3.5, 2.5)[1] });
    cell(49, 17.5, 'Лист', { a: 'start' });
    cell(29, 17.5, 'Листов', { a: 'start' });
    if (titleBlock.sheet) cell(36, 17.5, String(titleBlock.sheet));
    if (titleBlock.sheets) cell(8.5, 17.5, String(titleBlock.sheets));
  }

  /** Графа 1 (70 × 25 мм): наименование изделия и документа — крупно, если помещается, иначе мельче. */
  static name(sheet, titleBlock) {
    for (const [textH, nmax] of [
      [3.5, 3],
      [3, 4],
      [2.5, 5],
    ]) {
      const docLines = EskdSheet.wrap(titleBlock.doc || '', 66, textH);
      const nameLines = EskdSheet.wrap(titleBlock.name || '', 66, textH);
      const lineH = textH * 1.3;
      const room = Math.floor((23.5 - docLines.length * lineH) / lineH);
      if (!(nameLines.length > Math.min(nmax, room) && textH > 2.5)) {
        const lines = nameLines.slice(0, room);
        if (nameLines.length > room)
          lines[room - 1] = EskdSheet.fit(`${lines[room - 1]} ${nameLines[room]}`, 66, textH, textH)[0];
        const all = [...lines, ...docLines];
        const y0 = EskdFrame.fromBottom(27.5) - (all.length * lineH) / 2 + textH * 0.95;
        all.forEach((line, i) => sheet.text(EskdFrame.fromRight(85), y0 + i * lineH, line, textH, { a: 'middle' }));
        return;
      }
    }
  }

  /** Форма 2а: изменения, обозначение документа, номер листа. */
  static form2a(sheet, titleBlock) {
    const { fromRight: fromRight, fromBottom: fromBottom, RIGHT: right, BOTTOM: bottom, TEXT_H: textH } = EskdFrame;
    sheet.line(fromRight(185), fromBottom(15), right, fromBottom(15), 'frame');
    for (const x of [178, 168, 145, 130, 120, 10])
      sheet.line(fromRight(x), fromBottom(15), fromRight(x), bottom, 'frame');
    sheet.line(fromRight(185), fromBottom(5), fromRight(120), fromBottom(5), 'frame');
    sheet.line(fromRight(185), fromBottom(10), fromRight(120), fromBottom(10), 'thin');
    sheet.line(fromRight(10), fromBottom(8), right, fromBottom(8), 'frame');
    for (const [x, text] of EskdFrame.CHANGES)
      sheet.text(fromRight(x), fromBottom(2.5) + textH / 2, text, textH, { a: 'middle' });
    sheet.text(fromRight(5), fromBottom(11.5) + textH / 2, 'Лист', textH, { a: 'middle' });
    if (titleBlock.sheet)
      sheet.text(fromRight(5), fromBottom(4) + 1.75, String(titleBlock.sheet), 3.5, { a: 'middle' });
    if (titleBlock.code) {
      const [text, fittedH] = EskdSheet.fit(titleBlock.code, 104, 7, 3.5);
      sheet.text(fromRight(65), fromBottom(7.5) + fittedH / 2, text, fittedH, { a: 'middle' });
    }
  }

  /** Дополнительные графы на поле подшивки: 19–23 (внизу), на первом листе — и 24–25 (вверху). */
  static margin(sheet, full) {
    for (const y of [292, 267, 232, 207, 182, 147]) sheet.line(8, y, 20, y, 'frame');
    if (full) for (const y of [5, 65, 125]) sheet.line(8, y, 20, y, 'frame');
    for (const x of [8, 13]) {
      sheet.line(x, 147, x, 292, 'frame');
      if (full) sheet.line(x, 5, x, 125, 'frame');
    }
    for (const [y, text] of EskdFrame.MARGIN.slice(0, full ? 7 : 5)) sheet.vtext(10.5, y, text, EskdFrame.TEXT_H);
  }

  /** Графа 26 — обозначение документа, повёрнутое на 180°. */
  static code26(sheet, titleBlock) {
    sheet.rect([20, 5, 70, 14], 'frame');
    if (!titleBlock.code) return;
    const [text, fittedH] = EskdSheet.fit(titleBlock.code, 66, 5, 2.5);
    sheet.text(55, 12 - fittedH / 2, text, fittedH, { a: 'middle', rot: 180 });
  }
}
