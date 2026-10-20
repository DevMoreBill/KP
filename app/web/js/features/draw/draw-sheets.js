import { StationLayout } from '../layout/station-layout.js';
import { StationDrawing } from './station-drawing.js';

/** Компоновка листов. */
export class DrawSheets {
  constructor(o) {
    this.o = o;
  }

  /** Разрез А–А с размерами справа: {w, h, left} при масштабе k (мм листа на мм). */
  mainBox(k) {
    const nOut = this.o.outs.length + this.o.souts.filter(o => o.wall === 'back').length;
    const nDim = nOut + 1 + (this.o.up || this.o.hood ? 1 : 0) + (this.o.rise ? 1 : 0) + (this.o.dz ? 1 : 0);
    const dimsR = 16 + 7 * (nDim - 1) + 2;
    const left = 14;
    return {
      w: left + (this.o.Le + this.o.outL) * k + dimsR,
      h: this.head() + this.dimPad(k) + (this.o.He + this.o.hTop + this.o.dz) * k + this.padBelow(k) + 3,
      left,
      dimsR,
    };
  }
  /** Мелкий масштаб: подпись высоты (по середине размерной линии) длиннее изображения — место над ним, мм листа. */
  dimPad(k) {
    return Math.max(0, (this.dimTw() - this.o.He * k) / 2 - this.o.hTop * k);
  }
  /** Ниже изображения: подпись высоты и буква линии сечения Б–Б (под штрихом у потолка) — мм листа. */
  padBelow(k) {
    return Math.max(0, (this.dimTw() - this.o.He * k) / 2, 7.5 - (this.o.zf + this.o.Hi) * k);
  }
  dimTw() {
    return EskdSheet.tw(StationLayout.n(this.o.He + Math.max(this.o.up, this.o.hood) + this.o.dz), 3.5) + 2;
  }
  /** Разрез Б–Б (план) с размерами и номерами позиций (col — колонкой справа, иначе строкой под планом). */
  planBox(k, col) {
    const nY = this.o.ext.length ? 0 : new Set(this.o.outs.map(o => o.y)).size;
    const left = 19 + (this.o.fit ? 7 : 0) + this.o.mkL * k;
    const outR = Math.max((nY ? 16 + 7 * (nY - 1) + 2 : 8) + (col ? 17 : 0) + this.o.mkR * k, this.o.swingR * k + 12);
    const two =
      !col &&
      this.o.nPos > 1 &&
      ((this.o.F || StationDrawing.FLD).L1 - (this.o.F || StationDrawing.FLD).L0 - 10) / (this.o.nPos - 1) <
        EskdSheet.shelfMin([{ n: this.o.nPos }]); // номера — на двух полках
    const top = this.o.planView.chainTop(k);
    const h =
      6 +
      top +
      this.o.swingB * k +
      this.o.We * k +
      this.o.swing * k +
      (col ? 0 : 11 + (two ? 7 : 0)) +
      10 +
      (this.o.fit ? 7 : 0) +
      7 * this.o.souts.length;
    return { w: left + (this.o.Le + this.o.outL) * k + outR, h, left, top };
  }
  /** Виды с торцов В и Г рядом: размеры слева (высоты) и снизу (ширина). */
  endsBox(k) {
    const G = this.o.gts.filter(q => !q.sea);
    const gR = G.some(q => q.wall === 'right');
    const gW = G.some(q => !q.full);
    const one = this.o.We * k;
    const hv = (this.o.He + this.o.hTop + this.o.dz) * k;
    const wl = 13 + (this.o.rise ? 7 : 0);
    const gw = this.o.dg ? 6 : 10;
    const wr = (this.o.dg ? 13 : 3) + (gR ? gw : 0);
    const dE = this.o.dg || this.o.dgL;
    return { w: wl + one + 16 + wl + one + wr, h: 9 + hv + (dE || gW ? 23 : 16) + (dE && gW ? 7 : 0), one, hv, wl };
  }
  /** Схема строповки: вид сбоку и с торца рядом (или друг под другом), подписи и знаки. */
  slingBox(k, stack) {
    const S = this.o.ms.sling;
    const hv = (this.o.He + Math.max(this.o.hTop, S.hook) + this.o.dz) * k + 8 + 23;
    const ws = this.o.Le * k + 23;
    const we = this.o.We * k + 8;
    return stack ? { w: Math.max(ws, we), h: 2 * hv + 6, ws, we, hv } : { w: ws + we + 10, h: hv, ws, we, hv };
  }
  /** Высота заголовка разреза А–А: обозначение и надпись «Шкаф поз. … не показан». */
  head() {
    return 8 + (this.o.hidden.length ? 4 : 0);
  }

  /** Лист: книжный или с изображением, повёрнутым на 90°; fn(sh) рисует в поле F. */
  page(F, fn) {
    const sh = new EskdSheet('A4');
    const P = StationDrawing.FLD;
    const was = this.o.F;
    this.o.F = F;
    if (F.rot) sh.group(`translate(${P.L1},${P.TOP}) rotate(90)`, () => fn(sh));
    else fn(sh);
    this.o.F = was;
    return sh;
  }
  /** Из книжного и повёрнутого — где масштаб крупнее (pick(F) → {N, …}). */
  best(pick) {
    const a = pick(StationDrawing.FLD);
    const b = pick(StationDrawing.ROT);
    return b.N < a.N ? Object.assign(b, { F: StationDrawing.ROT }) : Object.assign(a, { F: StationDrawing.FLD });
  }

  /** Листы чертежа (SVG), число не ограничено (решение ПНЕВМОТЕХ). */
  sheets() {
    const C = StationDrawing;
    this.o.F = C.FLD;
    const on1 = this.pickMain(this.lay1().room);
    const sepA = this.best(F => this.pickA(F));
    const sep = (this.o.sepA = on1.N > C.MIN_N || on1.N > sepA.N);
    const both = this.pick2();
    const alone = this.best(F => this.pickPlan(F));
    const split = both.N > alone.N;
    const sling = this.o.ms ? this.mod(() => this.best(F => this.pickSling(F))) : null;
    const jobs = [];
    if (sep) jobs.push((i, n) => this.sheetA(i, n, sepA));
    if (split) {
      jobs.push((i, n) => this.sheetPlan(i, n, alone));
      jobs.push((i, n) => this.sheetEnds(i, n));
    } else jobs.push((i, n) => this.sheet2(i, n, both));
    if (sling) jobs.push((i, n) => this.mod(() => this.sheet3(i, n, sling)));
    const total = 1 + jobs.length;
    this.o.slingNo = sling ? total : null;
    const rest = jobs.map((f, j) => f(j + 2, total)); // листы с разрезом — раньше первого
    this.o.F = C.FLD;
    return [this.sheet1(total, sep), ...rest];
  }
  /** Основная надпись: первый лист — форма 1 (масштаб — главного изображения), следующие — форма 2а. */
  tb(sheet, sheets, N) {
    const T = this.o.p;
    const code = EskdSheet.code(this.o.m.org, T.hash, 'ГЧ');
    return sheet === 1
      ? {
          name: this.o.m.title || 'Станция в контейнере',
          doc: 'Габаритный чертёж',
          code,
          lit: 'П',
          scale: EskdSheet.scale(N),
          sheet: 1,
          sheets,
          org: this.o.m.org,
          dev: this.o.m.dev,
          date: this.o.m.date,
        }
      : { code, sheet, sheets, next: true };
  }
  /** Подпись изображения с масштабом, если он не тот, что в основной надписи (ГОСТ Р 2.316, п. 4.19). */
  label(t, N) {
    return N === this.o.N1 ? t : `${t} (${EskdSheet.scale(N)})`;
  }

  lay1() {
    const C = StationDrawing;
    const tt = this.o.text.reqs();
    const tc = this.o.text.tech();
    const rows = this.o.text.rows();
    const hTT = new EskdSheet('A4').paras(0, 0, 175, tt, 2.5, false);
    const twoCol = tc.every(t => EskdSheet.tw(t, 2.5) <= 86);
    const ind = EskdSheet.tw('10. ', 2.5);
    const tcL = twoCol
      ? []
      : tc
          .map((t, i) => EskdSheet.wrap(t, 175 - ind, 2.5).map((ln, j) => ({ t: ln, num: j ? '' : `${i + 1}. ` })))
          .flat(); // длинные — с переносом
    const nTC = twoCol ? Math.ceil(tc.length / 2) : tcL.length;
    const hTC = tc.length ? 5 + nTC * 3.8 + 0.8 : 0;
    const half = Math.ceil(rows.length / 2);
    const hTab = rows.length ? 5 + half * 4 : 0;
    const yTT = C.TB - 2.5 - hTT;
    const yTTh = yTT - (tc.length ? 4.6 : 0);
    const yTC = yTTh - hTC;
    const yTab = yTC - (hTab ? hTab + 3 : 0);
    return { tt, tc, tcL, ind, rows, twoCol, half, yTT, yTTh, yTC, yTab, room: yTab - 3 - C.TOP };
  }
  /** Разрез А–А в наибольшем масштабе, который помещается в room по высоте (лист 1, книжный). */
  pickMain(room) {
    const F = this.o.F;
    return StationDrawing.scaleFor((k, last) => {
      const b = this.mainBox(k);
      return (b.w <= F.L1 - F.L0 && b.h <= room) || last ? { b } : null;
    });
  }
  /** Разрез А–А своим листом в поле F, не крупнее 1:20. */
  pickA(F) {
    return StationDrawing.scaleFor((k, last) => {
      const b = this.mainBox(k);
      return (1 / k >= 20 && b.w <= F.L1 - F.L0 && b.h <= F.BOT - F.TOP) || last ? { b } : null;
    });
  }
  /** Разрез А–А с верхом на yA. */
  drawMain(sh, yA, pick) {
    const F = this.o.F;
    const { k, b } = pick;
    this.o.k = k;
    this.o.xL = F.L0 + b.left + Math.max(0, (F.L1 - F.L0 - b.w) / 2);
    this.o.xR = this.o.xL + this.o.Le * k;
    this.o.xE = this.o.xR + this.o.outL * k;
    this.o.Yg = yA + this.head() + this.dimPad(k) + (this.o.He + this.o.hTop + this.o.dz) * k;
    this.o.side.main(sh, yA, b);
  }
  /** Лист 1. */
  sheet1(total, sepA) {
    const sh = new EskdSheet('A4');
    const C = StationDrawing;
    const L = this.lay1();
    const { tt, tc, rows, half } = L;
    // без разреза — текстовая часть сверху листа
    const dy = sepA ? L.yTab - C.TOP - 2 : 0;
    const yTT = L.yTT - dy;
    const yTTh = L.yTTh - dy;
    const yTC = L.yTC - dy;
    const yTab = L.yTab - dy;
    if (!sepA) {
      const pick = this.pickMain(L.room);
      this.o.N1 = pick.N;
      this.drawMain(sh, C.TOP, pick);
    }
    if (rows.length) DrawSheets.parts(sh, rows, half, yTab);
    if (tc.length) DrawSheets.techBlock(sh, L, [yTC, yTTh]);
    sh.paras(25, yTT, 175, tt, 2.5);
    sh.frame(this.tb(1, total, this.o.N1));
    return sh.svg();
  }
  /** Перечень составных частей — в две колонки. */
  static parts(sh, rows, half, yTab) {
    const H = rows.slice(0, half);
    const R = rows.slice(half);
    const cols = [8, 56.5, 8, 20];
    const head = ['Поз.', 'Наименование', 'Кол.', 'Масса, кг'];
    const cell = r =>
      r
        ? [[String(r.pos), 'c'], r.name, [String(r.n), 'c'], [r.mass > 0 ? StationLayout.n(r.mass) : '—', 'c']]
        : ['', '', '', ''];
    sh.table(20, yTab, cols, head, H.map(cell), 4, 5, 2.5);
    if (R.length)
      sh.table(
        112.5,
        yTab,
        cols,
        head,
        H.map((x, i) => cell(R[i])),
        4,
        5,
        2.5,
      );
  }

  /** Техническая характеристика (в две колонки или с переносами) и заголовок технических требований. */
  static techBlock(sh, { tc, tcL, ind, twoCol }, [yTC, yTTh]) {
    sh.text(112.5, yTC + 3.9, 'Техническая характеристика', 3.5, { a: 'middle' });
    if (twoCol)
      tc.forEach((t, i) =>
        sh.text(25 + (i % 2) * 90, yTC + 5 + (Math.floor(i / 2) + 1) * 3.8 - 0.6, `${i + 1}. ${t}`, 2.5),
      );
    else
      tcL.forEach((q, r) => {
        const yy = yTC + 5 + (r + 1) * 3.8 - 0.6;
        if (q.num) sh.text(25, yy, q.num, 2.5);
        sh.text(25 + ind, yy, q.t, 2.5);
      });
    sh.text(112.5, yTTh + 3.9, 'Технические требования', 3.5, { a: 'middle' });
  }

  /** Разрез А–А своим листом (книжным или повёрнутым на 90°). */
  sheetA(i, total, pick) {
    this.o.N1 = pick.N;
    const sh = this.page(pick.F, sh =>
      this.drawMain(sh, pick.F.TOP + Math.max(0, (pick.F.BOT - pick.F.TOP - pick.b.h) / 2), pick),
    );
    sh.frame(this.tb(i, total));
    return sh.svg();
  }
  /** План и виды с торцов на одном книжном листе. */
  pick2() {
    const C = StationDrawing;
    const F = C.FLD;
    const room = F.BOT - F.TOP;
    const W = F.L1 - F.L0;
    const minE = this.endsBox(1 / 100).h;
    const was = this.o.F;
    this.o.F = F;
    try {
      return C.scaleFor((k, last) => {
        for (const col of [false, true]) {
          const P = this.planBox(k, col);
          if (col && this.o.nPos * 7 > P.top + this.o.swingB * k + this.o.We * k + this.o.swing * k + 4) continue;
          if ((P.w <= W && P.h + 8 + minE <= room) || last) return { P, col };
        }
        return null;
      });
    } finally {
      this.o.F = was;
    }
  }
  /** План один в поле F. */
  pickPlan(F) {
    const was = this.o.F;
    this.o.F = F;
    try {
      return StationDrawing.scaleFor((k, last) => {
        for (const col of [false, true]) {
          const P = this.planBox(k, col);
          if (col && this.o.nPos * 7 > P.top + this.o.swingB * k + this.o.We * k + this.o.swing * k + 4) continue;
          if ((P.w <= F.L1 - F.L0 && P.h <= F.BOT - F.TOP) || last) return { P, col };
        }
        return null;
      });
    } finally {
      this.o.F = was;
    }
  }
  /** Разрез Б–Б (план) с дверями, размерами и номерами позиций с верхом на yB. */
  drawPlan(sh, yB, pick) {
    const F = this.o.F;
    const { k, P, col } = pick;
    const W = F.L1 - F.L0;
    this.o.k = k;
    this.o.xL = F.L0 + P.left + Math.max(0, (W - P.w) / 2);
    this.o.xR = this.o.xL + this.o.Le * k;
    this.o.xE = this.o.xR + this.o.outL * k;
    this.o.yPT = yB + 6 + P.top + this.o.swingB * k;
    this.o.planView.plan(sh, yB, col, pick.N);
  }
  /** Виды с торцов В (у входа) и Г (дальний) с верхом на yE — в наибольшем масштабе, который помещается до yMax (не крупнее 1:20). */
  drawEnds(sh, yE, yMax) {
    const C = StationDrawing;
    const F = this.o.F;
    const W = F.L1 - F.L0;
    const pe = C.scaleFor((ke, last) => {
      const E = this.endsBox(ke);
      return (1 / ke >= 20 && E.w <= W && yE + E.h <= yMax) || last ? { E } : null;
    });
    const E = pe.E;
    this.o.k = pe.k;
    const x0 = (F.L0 + F.L1) / 2 - E.w / 2 + E.wl;
    this.o.Yg = yE + 9 + E.hv;
    sh.text(x0 + E.one / 2, yE + 5, this.label('В', pe.N), 5, { a: 'middle' });
    this.o.ends.end(sh, x0);
    this.o.ends.endDims(sh, x0, true);
    const x1 = x0 + E.one + 16 + E.wl;
    sh.text(x1 + E.one / 2, yE + 5, this.label('Г', pe.N), 5, { a: 'middle' });
    this.o.ends.endR(sh, x1);
    this.o.ends.endDims(sh, x1, false);
  }
  /** Лист: план, под ним — виды с торцов. */
  sheet2(i, total, pick) {
    const sh = this.page(StationDrawing.FLD, sh => {
      const F = this.o.F;
      this.drawPlan(sh, F.TOP, pick);
      this.drawEnds(sh, F.TOP + pick.P.h + 8, F.BOT);
    });
    sh.frame(this.tb(i, total));
    return sh.svg();
  }
  /** Лист: план один (книжный или повёрнутый на 90°). */
  sheetPlan(i, total, pick) {
    const sh = this.page(pick.F, sh =>
      this.drawPlan(sh, pick.F.TOP + Math.max(0, (pick.F.BOT - pick.F.TOP - pick.P.h) / 2), pick),
    );
    sh.frame(this.tb(i, total));
    return sh.svg();
  }
  /** Лист: виды с торцов (книжный). */
  sheetEnds(i, total) {
    const sh = this.page(StationDrawing.FLD, sh => this.drawEnds(sh, this.o.F.TOP, this.o.F.BOT));
    sh.frame(this.tb(i, total));
    return sh.svg();
  }
  /** Схема строповки в поле F: вид сбоку и с торца рядом или друг под другом. */
  /** Станция из модулей. */
  mod(fn) {
    const M = this.o.ms;
    const md = M && M.mods && this.o.p.geo.mods;
    if (!md) return fn();
    const keep = [this.o.Le, this.o.We, this.o.ms, this.o.rf];
    const k = M.mods.indexOf(M.top) + 1;
    this.o.Le = md.Lm;
    this.o.We = md.Wm;
    this.o.ms = { ...M, mass: M.top.mass, cg: M.top.cg, sling: M.top.sling, modK: k };
    this.o.rf = [];
    try {
      return fn();
    } finally {
      [this.o.Le, this.o.We, this.o.ms, this.o.rf] = keep;
    }
  }
  pickSling(F) {
    const C = StationDrawing;
    const W = F.L1 - F.L0;
    const room = F.BOT - F.TOP - 8 - this.o.sling.legendH(new EskdSheet('A4'));
    return C.scaleFor((k, last) => {
      for (const stack of [false, true]) {
        const B = this.slingBox(k, stack);
        if ((B.w <= W && B.h <= room) || (last && stack)) return { B, stack, room };
      }
      return null;
    });
  }
  /** Лист схемы строповки: вид сбоку и с торца, знаки № 9 и № 12, центр тяжести и масса. */
  sheet3(i, total, pick) {
    const sh = this.page(pick.F, s => this.slingSheet(s, pick));
    sh.frame(this.tb(i, total));
    return sh.svg();
  }

  /** Друг под другом — вид с торца в своём масштабе, крупнее, если помещается (не крупнее 1:20): {E, N}. */
  endScale({ k, B, stack, room, N }, W) {
    if (!stack) return { E: B, N };
    const pe = StationDrawing.scaleFor((ke, last) => {
      const E = this.slingBox(ke, true);
      return (1 / ke >= 20 && ke >= k && E.we <= W && B.hv + 6 + E.hv <= room) || last ? { E } : null;
    });
    return pe.k > k ? { E: pe.E, N: pe.N } : { E: B, N };
  }

  slingSheet(sh, pick) {
    const F = this.o.F;
    const mid = (F.L0 + F.L1) / 2;
    const { k, B, stack, room } = pick;
    const y0 = F.TOP + 8 + (F.rot ? Math.max(0, (room - B.h) / 2) : 0);
    const { E, N: Ne } = this.endScale(pick, F.L1 - F.L0);
    const two = Ne !== pick.N;
    const ttl = this.o.ms.modK ? `Схема строповки модуля М${this.o.ms.modK}` : 'Схема строповки';
    sh.text(mid, y0 - 6, two ? ttl : this.label(ttl, pick.N), 5, { a: 'middle' });
    const xs = stack ? mid - B.ws / 2 + 19 : mid - B.w / 2 + 19;
    const [side, end] = ['вид со стороны входа', 'вид с торца у входа'];
    this.o.k = k;
    this.o.sling.slingSide(sh, xs, y0, B.hv, two ? `${side} (${EskdSheet.scale(pick.N)})` : side);
    const xe = stack ? mid - E.we / 2 + 4 : xs - 19 + B.ws + 10 + 4;
    const ye = stack ? y0 + B.hv + 6 : y0;
    this.o.k = 1 / Ne;
    this.o.sling.slingEnd(sh, xe, ye, E.hv, two ? `${end} (${EskdSheet.scale(Ne)})` : end);
    this.o.sling.signsLegend(sh, F.L0 + 4, (stack ? ye + E.hv : y0 + B.hv) + 6);
  }
}
