import { Mm } from '../layout/mm.js';
import { EskdSheet } from '../eskd/eskd-sheet.js';
import { EskdFrame } from '../eskd/eskd-frame.js';

/** Компоновка листов. */
export class DrawSheets {
  static TITLE_TOP = 237;
  static TOP = 22; // ниже графы 26
  /** Разрез А–А на листе 1 мельче 1:100 (технические требования длинные) — отдельным листом 2. */
  static MIN_N = 100;
  /** Поле изображений. */
  static FLD = { L0: 25, L1: 200, TOP: 22, BOT: 274 };
  static ROT = { L0: 0, L1: 252, TOP: 0, BOT: 175, rot: true };
  /** Наибольший масштаб из ряда, при котором ok(k). */
  static scaleFor(ok) {
    for (const denom of EskdSheet.SCALES.filter(value => value >= 10)) {
      const res = ok(1 / denom);
      if (res) return Object.assign({ N: denom, k: 1 / denom }, res);
    }
    const denom = EskdSheet.SCALES[EskdSheet.SCALES.length - 1];
    return Object.assign({ N: denom, k: 1 / denom }, ok(1 / denom, true) || {});
  }

  constructor(drawing) {
    this.drawing = drawing;
  }

  /** Разрез А–А с размерами справа: {w, h, left} при масштабе k (мм листа на мм). */
  mainBox(k) {
    const nOut = this.drawing.outs.length + this.drawing.souts.filter(out => out.wall === 'back').length;
    const nDim =
      nOut +
      1 +
      (this.drawing.roofRise || this.drawing.hood ? 1 : 0) +
      (this.drawing.rise ? 1 : 0) +
      (this.drawing.dz ? 1 : 0);
    const dimsR = 16 + 7 * (nDim - 1) + 2;
    const left = 14;
    return {
      w: left + (this.drawing.Le + this.drawing.outL) * k + dimsR,
      h:
        this.head() +
        this.dimPad(k) +
        (this.drawing.He + this.drawing.hTop + this.drawing.dz) * k +
        this.padBelow(k) +
        3,
      left,
      dimsR,
    };
  }
  /** Мелкий масштаб: подпись высоты (по середине размерной линии) длиннее изображения — место над ним, мм листа. */
  dimPad(k) {
    return Math.max(0, (this.dimTw() - this.drawing.He * k) / 2 - this.drawing.hTop * k);
  }
  /** Ниже изображения: подпись высоты и буква линии сечения Б–Б (под штрихом у потолка) — мм листа. */
  padBelow(k) {
    return Math.max(0, (this.dimTw() - this.drawing.He * k) / 2, 7.5 - (this.drawing.floorZ + this.drawing.Hi) * k);
  }
  /** Ширина надписи полной высоты, мм листа. */
  dimTw() {
    return (
      EskdSheet.textWidth(
        Mm.text(this.drawing.He + Math.max(this.drawing.roofRise, this.drawing.hood) + this.drawing.dz),
        3.5,
      ) + 2
    );
  }
  /** Разрез Б–Б (план) с размерами и номерами позиций (col — колонкой справа, иначе строкой под планом). */
  planBox(k, col) {
    const outRows = this.drawing.outside.length ? 0 : new Set(this.drawing.outs.map(out => out.y)).size;
    const left = 19 + (this.drawing.fit ? 7 : 0) + this.drawing.hoodLeft * k;
    const outR = Math.max(
      (outRows ? 16 + 7 * (outRows - 1) + 2 : 8) + (col ? 17 : 0) + this.drawing.hoodRight * k,
      this.drawing.swingR * k + 12,
    );
    const two =
      !col &&
      this.drawing.nPos > 1 &&
      ((this.drawing.field || DrawSheets.FLD).L1 - (this.drawing.field || DrawSheets.FLD).L0 - 10) /
        (this.drawing.nPos - 1) <
        EskdSheet.shelfMin([{ n: this.drawing.nPos }]); // номера — на двух полках
    const top = this.drawing.planView.chainTop(k);
    const height =
      6 +
      top +
      this.drawing.swingB * k +
      this.drawing.We * k +
      this.drawing.swing * k +
      (col ? 0 : 11 + (two ? 7 : 0)) +
      10 +
      (this.drawing.fit ? 7 : 0) +
      7 * this.drawing.souts.length;
    return { w: left + (this.drawing.Le + this.drawing.outL) * k + outR, h: height, left, top };
  }
  /** Виды с торцов В и Г рядом: размеры слева (высоты) и снизу (ширина). */
  endsBox(k) {
    const gates = this.drawing.gates.filter(gate => !gate.sea);
    const gateRight = gates.some(gate => gate.wall === 'right');
    const gateWide = gates.some(gate => !gate.full);
    const one = this.drawing.We * k;
    const height = (this.drawing.He + this.drawing.hTop + this.drawing.dz) * k;
    const leftPad = 13 + (this.drawing.rise ? 7 : 0);
    const gatePad = this.drawing.dguRight ? 6 : 10;
    const rightPad = (this.drawing.dguRight ? 13 : 3) + (gateRight ? gatePad : 0);
    const dguDoor = this.drawing.dguRight || this.drawing.dguLeft;
    return {
      w: leftPad + one + 16 + leftPad + one + rightPad,
      h: 9 + height + (dguDoor || gateWide ? 23 : 16) + (dguDoor && gateWide ? 7 : 0),
      one,
      hv: height,
      wl: leftPad,
    };
  }
  /** Схема строповки: вид сбоку и с торца рядом (или друг под другом), подписи и знаки. */
  slingBox(k, stack) {
    const sling = this.drawing.mass.sling;
    const height = (this.drawing.He + Math.max(this.drawing.hTop, sling.hook) + this.drawing.dz) * k + 8 + 23;
    const sideW = this.drawing.Le * k + 23;
    const endW = this.drawing.We * k + 8;
    return stack
      ? { w: Math.max(sideW, endW), h: 2 * height + 6, ws: sideW, we: endW, hv: height }
      : { w: sideW + endW + 10, h: height, ws: sideW, we: endW, hv: height };
  }
  /** Высота заголовка разреза А–А: обозначение и надпись «Шкаф поз. … не показан». */
  head() {
    return 8 + (this.drawing.hidden.length ? 4 : 0);
  }

  /** Лист: книжный или с изображением, повёрнутым на 90°; fn(sh) рисует в поле F. */
  page(field, draw) {
    const sheet = new EskdSheet('A4');
    const box = DrawSheets.FLD;
    const was = this.drawing.field;
    this.drawing.field = field;
    if (field.rot) sheet.group(`translate(${box.L1},${box.TOP}) rotate(90)`, () => draw(sheet));
    else draw(sheet);
    this.drawing.field = was;
    return sheet;
  }
  /** Из книжного и повёрнутого — где масштаб крупнее (pick(F) → {N, …}). */
  best(pick) {
    const upright = pick(DrawSheets.FLD);
    const rotated = pick(DrawSheets.ROT);
    return rotated.N < upright.N
      ? Object.assign(rotated, { F: DrawSheets.ROT })
      : Object.assign(upright, { F: DrawSheets.FLD });
  }

  /** Листы чертежа (SVG), число не ограничено (решение ПНЕВМОТЕХ). */
  sheets() {
    this.drawing.field = DrawSheets.FLD;
    const on1 = this.pickMain(this.lay1().room);
    const sepA = this.best(field => this.pickA(field));
    const sep = (this.drawing.sepA = on1.N > DrawSheets.MIN_N || on1.N > sepA.N);
    const both = this.pick2();
    const alone = this.best(field => this.pickPlan(field));
    const split = both.N > alone.N;
    const sling = this.drawing.mass ? this.mod(() => this.best(field => this.pickSling(field))) : null;
    const jobs = [];
    if (sep) jobs.push((i, count) => this.sheetA(i, count, sepA));
    if (split) {
      jobs.push((i, count) => this.sheetPlan(i, count, alone));
      jobs.push((i, count) => this.sheetEnds(i, count));
    } else jobs.push((i, count) => this.sheet2(i, count, both));
    if (sling) jobs.push((i, count) => this.mod(() => this.sheet3(i, count, sling)));
    const total = 1 + jobs.length;
    this.drawing.slingNo = sling ? total : null;
    const rest = jobs.map((job, j) => job(j + 2, total)); // листы с разрезом — раньше первого
    this.drawing.field = DrawSheets.FLD;
    return [this.sheet1(total, sep), ...rest];
  }
  /** Основная надпись: первый лист — форма 1 (масштаб — главного изображения), следующие — форма 2а. */
  titleBlock(sheetNo, sheets, denom) {
    const plan = this.drawing.plan;
    const code = EskdSheet.code(this.drawing.meta.org, plan.hash, 'ГЧ');
    return sheetNo === 1
      ? {
          name: this.drawing.meta.title || 'Станция в контейнере',
          doc: 'Габаритный чертёж',
          code,
          lit: 'П',
          scale: EskdSheet.scale(denom),
          sheet: 1,
          sheets,
          org: this.drawing.meta.org,
          dev: this.drawing.meta.dev,
          date: this.drawing.meta.date,
        }
      : { code, sheet: sheetNo, sheets, next: true };
  }
  /** Подпись изображения с масштабом, если он не тот, что в основной надписи (ГОСТ Р 2.316, п. 4.19). */
  label(text, denom) {
    return denom === this.drawing.mainScale ? text : `${text} (${EskdSheet.scale(denom)})`;
  }

  /** Раскладка листа 1: требования, характеристика, перечень позиций. */
  lay1() {
    const reqs = this.drawing.text.reqs();
    const tech = this.drawing.text.tech();
    const rows = this.drawing.text.rows();
    const hTT = new EskdSheet('A4').paras([0, 0, 175], reqs, 2.5, false);
    const twoCol = tech.every(text => EskdSheet.textWidth(text, 2.5) <= 86);
    const ind = EskdSheet.textWidth('10. ', 2.5);
    const tcL = twoCol
      ? []
      : tech
          .map((text, i) =>
            EskdSheet.wrap(text, 175 - ind, 2.5).map((line, j) => ({ t: line, num: j ? '' : `${i + 1}. ` })),
          )
          .flat(); // длинные — с переносом
    const nTC = twoCol ? Math.ceil(tech.length / 2) : tcL.length;
    const hTC = tech.length ? 5 + nTC * 3.8 + 0.8 : 0;
    const half = Math.ceil(rows.length / 2);
    const hTab = rows.length ? 5 + half * 4 : 0;
    const yTT = DrawSheets.TITLE_TOP - 2.5 - hTT;
    const yTTh = yTT - (tech.length ? 4.6 : 0);
    const yTC = yTTh - hTC;
    const yTab = yTC - (hTab ? hTab + 3 : 0);
    return { tt: reqs, tc: tech, tcL, ind, rows, twoCol, half, yTT, yTTh, yTC, yTab, room: yTab - 3 - DrawSheets.TOP };
  }
  /** Разрез А–А в наибольшем масштабе, который помещается в room по высоте (лист 1, книжный). */
  pickMain(room) {
    const field = this.drawing.field;
    return DrawSheets.scaleFor((k, last) => {
      const box = this.mainBox(k);
      return (box.w <= field.L1 - field.L0 && box.h <= room) || last ? { b: box } : null;
    });
  }
  /** Разрез А–А своим листом в поле F, не крупнее 1:20. */
  pickA(field) {
    return DrawSheets.scaleFor((k, last) => {
      const box = this.mainBox(k);
      return (1 / k >= 20 && box.w <= field.L1 - field.L0 && box.h <= field.BOT - field.TOP) || last
        ? { b: box }
        : null;
    });
  }
  /** Разрез А–А с верхом на yA. */
  drawMain(sheet, top, pick) {
    const field = this.drawing.field;
    const { k, b: box } = pick;
    this.drawing.scale = k;
    this.drawing.left = field.L0 + box.left + Math.max(0, (field.L1 - field.L0 - box.w) / 2);
    this.drawing.right = this.drawing.left + this.drawing.Le * k;
    this.drawing.outerRight = this.drawing.right + this.drawing.outL * k;
    this.drawing.ground =
      top + this.head() + this.dimPad(k) + (this.drawing.He + this.drawing.hTop + this.drawing.dz) * k;
    this.drawing.side.main(sheet, top, box);
  }
  /** Лист 1. */
  sheet1(total, sepA) {
    const sheet = new EskdSheet('A4');
    const lay = this.lay1();
    const { tt: reqs, tc: tech, rows, half } = lay;
    // без разреза — текстовая часть сверху листа
    const dy = sepA ? lay.yTab - DrawSheets.TOP - 2 : 0;
    const yTT = lay.yTT - dy;
    const yTTh = lay.yTTh - dy;
    const yTC = lay.yTC - dy;
    const yTab = lay.yTab - dy;
    if (!sepA) {
      const pick = this.pickMain(lay.room);
      this.drawing.mainScale = pick.N;
      this.drawMain(sheet, DrawSheets.TOP, pick);
    }
    if (rows.length) DrawSheets.parts(sheet, rows, half, yTab);
    if (tech.length) DrawSheets.techBlock(sheet, lay, [yTC, yTTh]);
    sheet.paras([25, yTT, 175], reqs, 2.5);
    EskdFrame.draw(sheet, this.titleBlock(1, total, this.drawing.mainScale));
    return sheet.svg();
  }
  /** Перечень составных частей — в две колонки. */
  static parts(sheet, rows, half, yTab) {
    const left = rows.slice(0, half);
    const right = rows.slice(half);
    const cols = [8, 56.5, 8, 20];
    const head = ['Поз.', 'Наименование', 'Кол.', 'Масса, кг'];
    const cell = row =>
      row
        ? [[String(row.pos), 'c'], row.name, [String(row.n), 'c'], [row.mass > 0 ? Mm.text(row.mass) : '—', 'c']]
        : ['', '', '', ''];
    sheet.table([20, yTab], cols, head, left.map(cell), [4, 5, 2.5]);
    if (right.length)
      sheet.table(
        [112.5, yTab],
        cols,
        head,
        left.map((x, i) => cell(right[i])),
        [4, 5, 2.5],
      );
  }

  /** Техническая характеристика (в две колонки или с переносами) и заголовок технических требований. */
  static techBlock(sheet, { tc: tech, tcL, ind, twoCol }, [yTC, yTTh]) {
    sheet.text(112.5, yTC + 3.9, 'Техническая характеристика', 3.5, { a: 'middle' });
    if (twoCol)
      tech.forEach((text, i) =>
        sheet.text(25 + (i % 2) * 90, yTC + 5 + (Math.floor(i / 2) + 1) * 3.8 - 0.6, `${i + 1}. ${text}`, 2.5),
      );
    else
      tcL.forEach((line, row) => {
        const rowY = yTC + 5 + (row + 1) * 3.8 - 0.6;
        if (line.num) sheet.text(25, rowY, line.num, 2.5);
        sheet.text(25 + ind, rowY, line.t, 2.5);
      });
    sheet.text(112.5, yTTh + 3.9, 'Технические требования', 3.5, { a: 'middle' });
  }

  /** Разрез А–А своим листом (книжным или повёрнутым на 90°). */
  sheetA(i, total, pick) {
    this.drawing.mainScale = pick.N;
    const sheet = this.page(pick.F, sheet =>
      this.drawMain(sheet, pick.F.TOP + Math.max(0, (pick.F.BOT - pick.F.TOP - pick.b.h) / 2), pick),
    );
    EskdFrame.draw(sheet, this.titleBlock(i, total));
    return sheet.svg();
  }
  /** План и виды с торцов на одном книжном листе. */
  pick2() {
    const field = DrawSheets.FLD;
    const room = field.BOT - field.TOP;
    const width = field.L1 - field.L0;
    const minE = this.endsBox(1 / 100).h;
    const was = this.drawing.field;
    this.drawing.field = field;
    try {
      return DrawSheets.scaleFor((k, last) => {
        for (const col of [false, true]) {
          const box = this.planBox(k, col);
          if (
            col &&
            this.drawing.nPos * 7 > box.top + this.drawing.swingB * k + this.drawing.We * k + this.drawing.swing * k + 4
          )
            continue;
          if ((box.w <= width && box.h + 8 + minE <= room) || last) return { P: box, col };
        }
        return null;
      });
    } finally {
      this.drawing.field = was;
    }
  }
  /** План один в поле F. */
  pickPlan(field) {
    const was = this.drawing.field;
    this.drawing.field = field;
    try {
      return DrawSheets.scaleFor((k, last) => {
        for (const col of [false, true]) {
          const box = this.planBox(k, col);
          if (
            col &&
            this.drawing.nPos * 7 > box.top + this.drawing.swingB * k + this.drawing.We * k + this.drawing.swing * k + 4
          )
            continue;
          if ((box.w <= field.L1 - field.L0 && box.h <= field.BOT - field.TOP) || last) return { P: box, col };
        }
        return null;
      });
    } finally {
      this.drawing.field = was;
    }
  }
  /** Разрез Б–Б (план) с дверями, размерами и номерами позиций с верхом на yB. */
  drawPlan(sheet, top, pick) {
    const field = this.drawing.field;
    const { k, P: box, col } = pick;
    const room = field.L1 - field.L0;
    this.drawing.scale = k;
    this.drawing.left = field.L0 + box.left + Math.max(0, (room - box.w) / 2);
    this.drawing.right = this.drawing.left + this.drawing.Le * k;
    this.drawing.outerRight = this.drawing.right + this.drawing.outL * k;
    this.drawing.planTop = top + 6 + box.top + this.drawing.swingB * k;
    this.drawing.planView.plan(sheet, top, col, pick.N);
  }
  /** Виды с торцов В (у входа) и Г (дальний) с верхом на yE — в наибольшем масштабе, который помещается до yMax (не крупнее 1:20). */
  drawEnds(sheet, top, yMax) {
    const field = this.drawing.field;
    const room = field.L1 - field.L0;
    const endPick = DrawSheets.scaleFor((endK, last) => {
      const ends = this.endsBox(endK);
      return (1 / endK >= 20 && ends.w <= room && top + ends.h <= yMax) || last ? { E: ends } : null;
    });
    const ends = endPick.E;
    this.drawing.scale = endPick.k;
    const x0 = (field.L0 + field.L1) / 2 - ends.w / 2 + ends.wl;
    this.drawing.ground = top + 9 + ends.hv;
    sheet.text(x0 + ends.one / 2, top + 5, this.label('В', endPick.N), 5, { a: 'middle' });
    this.drawing.ends.end(sheet, x0);
    this.drawing.ends.endDims(sheet, x0, true);
    const x1 = x0 + ends.one + 16 + ends.wl;
    sheet.text(x1 + ends.one / 2, top + 5, this.label('Г', endPick.N), 5, { a: 'middle' });
    this.drawing.ends.endR(sheet, x1);
    this.drawing.ends.endDims(sheet, x1, false);
  }
  /** Лист: план, под ним — виды с торцов. */
  sheet2(i, total, pick) {
    const sheet = this.page(DrawSheets.FLD, sheet => {
      const field = this.drawing.field;
      this.drawPlan(sheet, field.TOP, pick);
      this.drawEnds(sheet, field.TOP + pick.P.h + 8, field.BOT);
    });
    EskdFrame.draw(sheet, this.titleBlock(i, total));
    return sheet.svg();
  }
  /** Лист: план один (книжный или повёрнутый на 90°). */
  sheetPlan(i, total, pick) {
    const sheet = this.page(pick.F, sheet =>
      this.drawPlan(sheet, pick.F.TOP + Math.max(0, (pick.F.BOT - pick.F.TOP - pick.P.h) / 2), pick),
    );
    EskdFrame.draw(sheet, this.titleBlock(i, total));
    return sheet.svg();
  }
  /** Лист: виды с торцов (книжный). */
  sheetEnds(i, total) {
    const sheet = this.page(DrawSheets.FLD, sheet =>
      this.drawEnds(sheet, this.drawing.field.TOP, this.drawing.field.BOT),
    );
    EskdFrame.draw(sheet, this.titleBlock(i, total));
    return sheet.svg();
  }
  /** Схема строповки в поле F: вид сбоку и с торца рядом или друг под другом. */
  /** Станция из модулей. */
  mod(draw) {
    const mass = this.drawing.mass;
    const mods = mass && mass.mods && this.drawing.plan.geo.mods;
    if (!mods) return draw();
    const keep = [this.drawing.Le, this.drawing.We, this.drawing.mass, this.drawing.roofItems];
    const k = mass.mods.indexOf(mass.top) + 1;
    this.drawing.Le = mods.Lm;
    this.drawing.We = mods.Wm;
    this.drawing.mass = { ...mass, mass: mass.top.mass, cg: mass.top.cg, sling: mass.top.sling, modK: k };
    this.drawing.roofItems = [];
    try {
      return draw();
    } finally {
      [this.drawing.Le, this.drawing.We, this.drawing.mass, this.drawing.roofItems] = keep;
    }
  }
  /** Масштаб схемы строповки в поле field. */
  pickSling(field) {
    const width = field.L1 - field.L0;
    const room = field.BOT - field.TOP - 8 - this.drawing.sling.legendH(new EskdSheet('A4'));
    return DrawSheets.scaleFor((k, last) => {
      for (const stack of [false, true]) {
        const slingBox = this.slingBox(k, stack);
        if ((slingBox.w <= width && slingBox.h <= room) || (last && stack)) return { B: slingBox, stack, room };
      }
      return null;
    });
  }
  /** Лист схемы строповки: вид сбоку и с торца, знаки № 9 и № 12, центр тяжести и масса. */
  sheet3(i, total, pick) {
    const sheet = this.page(pick.F, page => this.slingSheet(page, pick));
    EskdFrame.draw(sheet, this.titleBlock(i, total));
    return sheet.svg();
  }

  /** Друг под другом — вид с торца в своём масштабе, крупнее, если помещается (не крупнее 1:20): {E, N}. */
  endScale({ k, B: slingBox, stack, room, N: denom }, width) {
    if (!stack) return { E: slingBox, N: denom };
    const endPick = DrawSheets.scaleFor((endK, last) => {
      const ends = this.slingBox(endK, true);
      return (1 / endK >= 20 && endK >= k && ends.we <= width && slingBox.hv + 6 + ends.hv <= room) || last
        ? { E: ends }
        : null;
    });
    return endPick.k > k ? { E: endPick.E, N: endPick.N } : { E: slingBox, N: denom };
  }

  /** Лист схемы строповки: вид сбоку, с торца и пояснения. */
  slingSheet(sheet, pick) {
    const field = this.drawing.field;
    const mid = (field.L0 + field.L1) / 2;
    const { k, B: slingBox, stack, room } = pick;
    const y0 = field.TOP + 8 + (field.rot ? Math.max(0, (room - slingBox.h) / 2) : 0);
    const { E: ends, N: endDenom } = this.endScale(pick, field.L1 - field.L0);
    const two = endDenom !== pick.N;
    const ttl = this.drawing.mass.modK ? `Схема строповки модуля М${this.drawing.mass.modK}` : 'Схема строповки';
    sheet.text(mid, y0 - 6, two ? ttl : this.label(ttl, pick.N), 5, { a: 'middle' });
    const slingX = stack ? mid - slingBox.ws / 2 + 19 : mid - slingBox.w / 2 + 19;
    const [side, end] = ['вид со стороны входа', 'вид с торца у входа'];
    this.drawing.scale = k;
    this.drawing.sling.slingSide(sheet, slingX, y0, slingBox.hv, two ? `${side} (${EskdSheet.scale(pick.N)})` : side);
    const endsX = stack ? mid - ends.we / 2 + 4 : slingX - 19 + slingBox.ws + 10 + 4;
    const endsY = stack ? y0 + slingBox.hv + 6 : y0;
    this.drawing.scale = 1 / endDenom;
    this.drawing.sling.slingEnd(sheet, endsX, endsY, ends.hv, two ? `${end} (${EskdSheet.scale(endDenom)})` : end);
    this.drawing.sling.signsLegend(sheet, field.L0 + 4, (stack ? endsY + ends.hv : y0 + slingBox.hv) + 6);
  }
}
