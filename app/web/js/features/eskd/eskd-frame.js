import { EskdSheet } from './eskd-sheet.js';

/** Рамка листа А4 и основная надпись. */
export class EskdFrame {
  static R = 205;
  static B = 292;
  static H = 2.5;

  /** Линии формы 1 от правого нижнего угла рамки: вертикальные [x, y0, y1, тип]. */
  static V1 = [
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
  static H1 = [
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

  static X(v) {
    return EskdFrame.R - v;
  }

  static Y(v) {
    return EskdFrame.B - v;
  }

  /** Tb — {name, doc, code, lit, mass, scale, sheet, sheets, org, dev, date, next}. */
  static draw(sh, tb) {
    sh.rect([20, 5, 185, 287], 'frame');
    if (tb.next) EskdFrame.form2a(sh, tb);
    else EskdFrame.form1(sh, tb);
    EskdFrame.margin(sh, !tb.next);
    EskdFrame.code26(sh, tb);
    sh.text(95, 296, 'Копировал', EskdFrame.H);
    sh.text(163, 296, `Формат ${sh.fmt}`, EskdFrame.H);
  }

  static form1(sh, tb) {
    const { X, Y } = EskdFrame;
    for (const [x, a, b, t] of EskdFrame.V1) sh.line(X(x), Y(a), X(x), Y(b), t || 'frame');
    for (const [y, a, b, t] of EskdFrame.H1) sh.line(X(a), Y(y), X(b), Y(y), t || 'frame');
    const cell = (x, y, s, o = {}) =>
      sh.text(X(x), Y(y) + (o.h || EskdFrame.H) / 2, s, o.h || EskdFrame.H, { a: o.a || 'middle' });
    for (const [x, s] of EskdFrame.CHANGES) cell(x, 32.5, s);
    for (const [y, s] of EskdFrame.SIGNS) cell(184.3, y, s, { a: 'start' });
    EskdFrame.fields(tb, cell);
    EskdFrame.name(sh, tb);
    if (tb.code) {
      const [t, hs] = EskdSheet.fit(tb.code, 116, 7, 3.5);
      cell(60, 47.5, t, { h: hs });
    }
    if (tb.org) {
      const L = EskdSheet.wrap(tb.org, 47, 3.5).slice(0, 2);
      L.forEach((s, i) => {
        const [t, hs] = EskdSheet.fit(s, 47, 3.5, 2.5);
        sh.text(X(25), Y(7.5) + hs / 2 + (i - (L.length - 1) / 2) * 4.6, t, hs, { a: 'middle' });
      });
    }
  }

  /** Разработчик, дата, литера, масса, масштаб, лист и листов. */
  static fields(tb, cell) {
    const h = EskdFrame.H;
    if (tb.dev) {
      const [s, hs] = EskdSheet.fit(tb.dev, 21.5, h, 1.8);
      cell(167.3, 27.5, s, { a: 'start', h: hs });
    }
    const dt = EskdSheet.date(tb.date) || tb.date;
    if (dt) cell(125, 27.5, dt, { h: EskdSheet.fit(dt, 9.4, h, 1.6)[1] });
    for (const [x, s] of [
      [42, 'Лит.'],
      [26.5, 'Масса'],
      [9, 'Масштаб'],
    ])
      cell(x, 37.5, s);
    if (tb.lit) cell(47.5, 27.5, tb.lit, { h: 3.5 });
    if (tb.mass) cell(26.5, 27.5, tb.mass, { h: EskdSheet.fit(tb.mass, 16, 3.5, 2.5)[1] });
    if (tb.scale) cell(9, 27.5, tb.scale, { h: EskdSheet.fit(tb.scale, 17, 3.5, 2.5)[1] });
    cell(49, 17.5, 'Лист', { a: 'start' });
    cell(29, 17.5, 'Листов', { a: 'start' });
    if (tb.sheet) cell(36, 17.5, String(tb.sheet));
    if (tb.sheets) cell(8.5, 17.5, String(tb.sheets));
  }

  /** Графа 1 (70 × 25 мм): наименование изделия и документа — крупно, если помещается, иначе мельче. */
  static name(sh, tb) {
    for (const [hh, nmax] of [
      [3.5, 3],
      [3, 4],
      [2.5, 5],
    ]) {
      const dl = EskdSheet.wrap(tb.doc || '', 66, hh);
      const nl = EskdSheet.wrap(tb.name || '', 66, hh);
      const lh = hh * 1.3;
      const room = Math.floor((23.5 - dl.length * lh) / lh);
      if (!(nl.length > Math.min(nmax, room) && hh > 2.5)) {
        const L = nl.slice(0, room);
        if (nl.length > room) L[room - 1] = EskdSheet.fit(`${L[room - 1]} ${nl[room]}`, 66, hh, hh)[0];
        const all = [...L, ...dl];
        const y0 = EskdFrame.Y(27.5) - (all.length * lh) / 2 + hh * 0.95;
        all.forEach((t, i) => sh.text(EskdFrame.X(85), y0 + i * lh, t, hh, { a: 'middle' }));
        return;
      }
    }
  }

  /** Форма 2а: изменения, обозначение документа, номер листа. */
  static form2a(sh, tb) {
    const { X, Y, R, B, H: h } = EskdFrame;
    sh.line(X(185), Y(15), R, Y(15), 'frame');
    for (const x of [178, 168, 145, 130, 120, 10]) sh.line(X(x), Y(15), X(x), B, 'frame');
    sh.line(X(185), Y(5), X(120), Y(5), 'frame');
    sh.line(X(185), Y(10), X(120), Y(10), 'thin');
    sh.line(X(10), Y(8), R, Y(8), 'frame');
    for (const [x, t] of EskdFrame.CHANGES) sh.text(X(x), Y(2.5) + h / 2, t, h, { a: 'middle' });
    sh.text(X(5), Y(11.5) + h / 2, 'Лист', h, { a: 'middle' });
    if (tb.sheet) sh.text(X(5), Y(4) + 1.75, String(tb.sheet), 3.5, { a: 'middle' });
    if (tb.code) {
      const [t, hs] = EskdSheet.fit(tb.code, 104, 7, 3.5);
      sh.text(X(65), Y(7.5) + hs / 2, t, hs, { a: 'middle' });
    }
  }

  /** Дополнительные графы на поле подшивки: 19–23 (внизу), на первом листе — и 24–25 (вверху). */
  static margin(sh, full) {
    for (const y of [292, 267, 232, 207, 182, 147]) sh.line(8, y, 20, y, 'frame');
    if (full) for (const y of [5, 65, 125]) sh.line(8, y, 20, y, 'frame');
    for (const x of [8, 13]) {
      sh.line(x, 147, x, 292, 'frame');
      if (full) sh.line(x, 5, x, 125, 'frame');
    }
    for (const [y, s] of EskdFrame.MARGIN.slice(0, full ? 7 : 5)) sh.vtext(10.5, y, s, EskdFrame.H);
  }

  /** Графа 26 — обозначение документа, повёрнутое на 180°. */
  static code26(sh, tb) {
    sh.rect([20, 5, 70, 14], 'frame');
    if (!tb.code) return;
    const [t, hs] = EskdSheet.fit(tb.code, 66, 5, 2.5);
    sh.text(55, 12 - hs / 2, t, hs, { a: 'middle', rot: 180 });
  }
}
