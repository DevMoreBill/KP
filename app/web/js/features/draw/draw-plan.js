import { StationLayout } from '../layout/station-layout.js';
import { StationMods } from '../layout/station-mods.js';
import { StationVent } from '../layout/station-vent.js';

/** Разрез Б–Б (план): расстановка, двери с дугами открывания, позиции, цепочка размеров, модули. */
export class DrawPlan {
  constructor(o) {
    this.o = o;
  }

  modsPlan(sh, YP) {
    const md = this.o.p.geo.mods;
    if (!md || !md.Lm) return;
    const k = this.o.k;
    const X = v => this.o.X(v);
    const { Le, We } = this.o;
    const ps = StationMods.M.post;
    for (let i = 1; i < md.a; i++) {
      const x = X(i * md.Lm);
      sh.line(x, YP(We) - 2, x, YP(0) + 2, 'phantom');
    }
    for (let j = 1; j < md.b; j++) {
      const y = YP(j * md.Wm);
      sh.line(X(0) - 2, y, X(Le) + 2, y, 'phantom');
    }
    md.cells.forEach(([i, j], q) => sh.text(X(i * md.Lm) + 2, YP((j + 1) * md.Wm) + 4.2, `М${q + 1}`, 3.5));
    for (const p of StationMods.posts(this.o.p.geo)) {
      const s = Math.max(0.8, ps * k);
      sh.rect(X(this.o.ox + p.x) - s / 2, YP(this.o.oy + p.y) - s / 2, s, s, 'thin', '#000');
    }
  }
  /** Маркизы на плане: открытый козырёк за наружной стеной (тонкой штрихпунктирной — откидные). */
  hoodsPlan(sh, YP) {
    const k = this.o.k;
    const X = v => this.o.X(v);
    const { ox, oy, Le, We } = this.o;
    const s = StationVent.HOOD_SIDE;
    for (const q of ((this.o.p.vent && this.o.p.vent.louvers) || []).filter(q => q.hood)) {
      const d = q.hood.d;
      if (q.wall === 'front') sh.rect(X(ox + q.u0 - s), YP(0), (q.u1 - q.u0 + 2 * s) * k, d * k, 'phantom');
      else if (q.wall === 'back') sh.rect(X(ox + q.u0 - s), YP(We + d), (q.u1 - q.u0 + 2 * s) * k, d * k, 'phantom');
      else if (q.wall === 'left') sh.rect(X(-d), YP(oy + q.u1 + s), d * k, (q.u1 - q.u0 + 2 * s) * k, 'phantom');
      else sh.rect(X(Le), YP(oy + q.u1 + s), d * k, (q.u1 - q.u0 + 2 * s) * k, 'phantom');
    }
  }
  /** Разрез Б–Б: план под потолком. */
  plan(sh, yB, col, N) {
    const { k, We, xL } = this.o;
    const YP = y => this.o.yPT + (We - y) * k;
    sh.text((xL + this.o.xR) / 2, yB + 4.6, this.o.layout.label('Б–Б', N), 5, { a: 'middle' });
    // направления взгляда на торцы
    this.o.ends.viewArrow(sh, xL - 3 - this.o.mkL * k, YP(We * 0.72), 1, 'В');
    this.o.ends.viewArrow(sh, this.o.xE + 3 + this.o.swingR * k, YP(We * 0.72), -1, 'Г');
    this.walls(sh, YP);
    this.doorsPlan(sh, YP);
    this.hoodsPlan(sh, YP);
    // оборудование — по высоте
    const { ox, oy } = this.o;
    const X = v => this.o.X(v);
    for (const it of [...this.o.p.items].sort((a, c) => a.z + a.h - (c.z + c.h)))
      EquipIcon.plan(sh, it, X(ox + it.x), YP(oy + it.y + it.ly), X(ox + it.x + it.lx), YP(oy + it.y));
    this.pipesPlan(sh, YP);
    // глушитель на крыше — над секущей плоскостью: штриховой
    for (const m of this.o.rf)
      sh.rect(X(ox + m.x), YP(oy + m.y + m.ly), m.lx * k, m.ly * k, 'dash', 'none', (m.ly * k) / 2);
    this.modsPlan(sh, YP);
    this.fittings(sh, YP);
    const ya = YP(oy + Math.min(60, this.o.Wi * 0.03));
    this.o.side.cutMarkV(sh, xL - 1.5 - this.o.mkL * k, ya, -1, 'А');
    this.o.side.cutMarkV(sh, this.o.xE + 1.5 + this.o.mkR * k, ya, 1, 'А');
    // цепочка размеров у задней стены (установочные размеры оборудования)
    this.chain(sh, YP(We) - this.o.swingB * k - 8, YP(oy + this.o.Wi));
    this.dimsH(sh, YP, col);
    const xo = this.dimsV(sh, YP);
    const L = this.labels(sh, YP, { col, yB, xo });
    this.aisleLabel(sh, YP, L);
    if (this.o.hl) this.hlPlan(sh, YP);
  }

  /** Стены в сечении, помещение, тамбур, отсек бака с нишей горловины, конвекторы. */
  walls(sh, YP) {
    const { k, ox, oy, Le, We, Li, Wi, xL, g } = this.o;
    const X = v => this.o.X(v);
    sh.section(xL, YP(oy), Le * k, oy * k);
    sh.section(xL, YP(We), Le * k, oy * k);
    sh.section(xL, YP(We - oy), ox * k, Wi * k);
    sh.section(X(Le - ox), YP(We - oy), ox * k, Wi * k);
    sh.rect(xL, YP(We), Le * k, We * k, 'main');
    sh.rect(X(ox), YP(oy + Wi), Li * k, Wi * k, 'thin');
    const fu = this.o.fuel;
    if ((g.x0 || 0) - (fu ? fu.x1 + fu.part : 0) > 0)
      sh.rect(X(ox + g.x0) - Math.max(0.5, 30 * k), YP(oy + Wi), Math.max(1, 60 * k), (Wi - 1000) * k, 'thin', '#000');
    if (fu) {
      sh.section(X(ox + fu.x1), YP(oy + Wi), fu.part * k, Wi * k);
      const b = Math.max(1.2, 220 * k);
      const d = oy * k + b * 0.5;
      if (fu.fill.wall === 'left') sh.rect(xL, YP(oy + fu.fill.y) - b / 2, ox * k + b * 0.5, b, 'main', '#fff');
      else if (fu.fill.wall === 'back') sh.rect(X(ox + fu.fill.x) - b / 2, YP(We), b, d, 'main', '#fff');
      else sh.rect(X(ox + fu.fill.x) - b / 2, YP(0) - d, b, d, 'main', '#fff');
    }
    for (const h of this.o.heaters) sh.rect(X(ox + h.x), YP(oy + h.y + h.ly), h.lx * k, h.ly * k, 'main', '#fff');
  }

  /** Трубопровод со стрелками потока; выходы через дальний торец и боковые стены (с фланцем); к ресиверам снаружи. */
  pipesPlan(sh, YP) {
    const { k, ox, oy } = this.o;
    const X = v => this.o.X(v);
    for (const l of this.o.lines) {
      const y = YP(oy + l.y);
      for (const br of l.branches)
        sh.line(X(ox + br.x), YP(oy + br.y0), X(ox + br.x), YP(oy + br.y1), br.tee ? 'pipe' : 'main');
      for (const [a, c] of StationLayout.runs(l)) {
        sh.line(X(ox + a), y, X(ox + c), y, 'pipe');
        if (l.medium === 'air' && !l.header && (c - a) * k > 9) PneuSymbol.flow(sh, X(ox + (a + c) / 2), y, 1);
      }
    }
    if (this.o.ext.length) this.outPlan(sh, YP);
    else this.outlets(sh, YP);
    this.sideOuts(sh, YP);
  }

  /** Выходы через дальний торец — с фланцем и стрелкой. */
  outlets(sh, YP) {
    const { k, oy, xR } = this.o;
    const xf = xR + Math.max(1.2, this.o.flg * k);
    for (const o of this.o.outs) {
      const y = YP(oy + o.y);
      sh.line(xR, y, xf + 5, y, 'pipe');
      this.o.side.flangeMark(sh, xf, y, 'v');
      sh.arrow(xf + 7.6, y, 1, 0);
    }
  }

  /** Выходы через боковые стены. */
  sideOuts(sh, YP) {
    const { k, ox, oy } = this.o;
    const X = v => this.o.X(v);
    for (const o of this.o.souts) {
      const x = X(ox + o.x);
      const back = o.wall === 'back';
      const s = back ? -1 : 1;
      const yf = YP(back ? this.o.We : 0) + s * Math.max(1.2, this.o.flg * k);
      sh.line(x, YP(oy + o.y), x, yf + s * 5, 'pipe');
      this.o.side.flangeMark(sh, x, yf, 'h');
      sh.arrow(x, yf + s * 7.6, 0, s);
    }
  }

  /** Угловые фитинги морского контейнера. */
  fittings(sh, YP) {
    if (!this.o.fit) return;
    const { k, Le, We } = this.o;
    const [fl, fw] = this.o.fit;
    const [ex, ey] = [(Le - fl) / 2, (We - fw) / 2];
    const s = Math.max(0.8, 170 * k);
    for (const [x, y] of [
      [ex, ey],
      [Le - ex, ey],
      [ex, We - ey],
      [Le - ex, We - ey],
    ])
      sh.rect(this.o.X(x) - s / 2, YP(y) - s / 2, s, s, 'thin');
  }

  /** Размеры под планом: габаритная длина, до ресивера снаружи, между фитингами, выходы через боковую стену. */
  dimsH(sh, YP, col) {
    const { k, ox, oy, Le, We, xL, xR } = this.o;
    const n = StationLayout.n;
    const X = v => this.o.X(v);
    let yd = YP(0) + this.o.swing * k + (col ? 0 : 11) + 8;
    sh.dimH(xL, xR, yd, n(Le), YP(0), YP(0));
    if (this.o.ext.length) {
      const r = this.o.ext.reduce((a, c) => (c.x < a.x ? c : a));
      sh.dimH(xR, X(ox + r.x), yd, n(ox + r.x - Le), null, YP(oy + r.y));
    }
    if (this.o.fit) {
      const [fl, fw] = this.o.fit;
      const [ex, ey] = [(Le - fl) / 2, (We - fw) / 2];
      yd += 7;
      sh.dimH(X(ex), X(Le - ex), yd, n(fl), YP(ey), YP(ey));
    }
    for (const o of this.o.souts) {
      yd += 7;
      sh.dimH(X(ox + o.x), xR, yd, n(Le - ox - o.x), o.wall === 'back' ? YP(We) : YP(0), YP(0), { out: 'l' });
    }
  }

  /** Размеры слева (ширина, между фитингами), ширина прохода, справа — привязки выходов; возвращает x следующего справа. */
  dimsV(sh, YP) {
    const { k, ox, oy, Le, We, xL, xR, ai } = this.o;
    const n = StationLayout.n;
    const X = v => this.o.X(v);
    let xd = xL - 14 - this.o.mkL * k;
    sh.dimV(YP(We), YP(0), xd, n(We), xL, xL);
    if (this.o.fit) {
      const [fl, fw] = this.o.fit;
      const [ex, ey] = [(Le - fl) / 2, (We - fw) / 2];
      xd -= 7;
      sh.dimV(YP(We - ey), YP(ey), xd, n(fw), X(ex), X(ex));
    }
    if (ai) sh.dimV(YP(oy + ai.y1), YP(oy + ai.y0), X(ox + ai.xm), n(ai.w), null, null);
    const ys = this.o.ext.length ? [] : [...new Set(this.o.outs.map(o => o.y))].sort((a, c) => c - a);
    let xo = this.o.xE + 16 + this.o.mkR * k; // правее буквы линии сечения А–А
    for (const y of ys) {
      sh.dimV(YP(We), YP(oy + y), xo, n(We - oy - y), xR, xR + 7.6);
      xo += 7;
    }
    return ys.length ? xo : null;
  }

  /** Номера позиций: строкой под планом или колонкой справа (выноски не пересекаются); возвращает полки. */
  labels(sh, YP, { col, yB, xo }) {
    const { k, ox, oy } = this.o;
    const X = v => this.o.X(v);
    const A = this.o.posPlan
      .map(it => ({ ...this.anchor(it, X, YP), n: it.pos }))
      .concat(this.o.posRoof.map(m => ({ x: X(ox + m.x + m.lx * 0.25), y: YP(oy + m.y + m.ly / 2), n: m.pos })));
    if (this.o.pipePos) {
      const l = this.o.lines.find(q => !q.header) || this.o.lines[0];
      const r = l ? [...StationLayout.runs(l)].sort((a, c) => c[1] - c[0] - (a[1] - a[0]))[0] : null;
      if (r) A.push({ x: X(ox + (r[0] + r[1]) / 2), y: YP(oy + l.y), n: this.o.pipePos.pos });
    }
    const y0 = YP(0) + this.o.swing * k;
    const xc = (xo != null ? xo - 7 + 5 : this.o.xE + 10 + this.o.mkR * k) + 2;
    const L = col
      ? EskdSheet.shelves(A, 'y', yB + 8, y0 + 4, xc, 7)
      : EskdSheet.shelves(A, 'x', this.o.F.L0 + 2, this.o.F.L1 - 8, y0 + 8, 9, y0 + 15);
    for (const q of L) sh.pos(q.px, q.py, q.sx, q.sy, q.n, 1);
    return L;
  }

  /** Надпись «Проход обслуживания» — в свободной от выносок и шкафов части прохода. */
  aisleLabel(sh, YP, L) {
    const { k, ox, oy, xR, ai } = this.o;
    if (!ai || (ai.y1 - ai.y0) * k <= 3.5) return;
    const X = v => this.o.X(v);
    const lab = 'Проход обслуживания';
    const lw = EskdSheet.tw(lab, 2.5);
    const yc = YP(oy + (ai.y0 + ai.y1) / 2) + 1.2;
    const xm = X(ox + ai.xm);
    const wallIt = this.o.p.items.filter(i => i.mount === 'wall' && i.wall === 'front' && YP(oy + i.y + i.ly) < yc + 1);
    const hit = (a, c) =>
      L.some(q => DrawPlan.crosses(q, [a, c], yc)) ||
      (xm > a - 4 && xm < c + 4) ||
      wallIt.some(i => X(ox + i.x) - 1 < c && X(ox + i.x + i.lx) + 1 > a);
    for (let a = X(ox + (this.o.g.x0 || 0)) + 2; a + lw <= xR - 2; a += 1)
      if (!hit(a, a + lw)) {
        sh.text(a + lw / 2, yc, lab, 2.5, { a: 'middle' });
        return;
      }
  }

  /** Выноска q проходит через полосу надписи [a, c] × [yc − 3, yc + 0,6]. */
  static crosses(q, [a, c], yc) {
    const t0 = (yc - 3 - q.py) / (q.sy - q.py);
    const t1 = (yc + 0.6 - q.py) / (q.sy - q.py);
    const xa = q.px + (q.sx - q.px) * Math.max(0, Math.min(1, t0));
    const xb = q.px + (q.sx - q.px) * Math.max(0, Math.min(1, t1));
    return (
      Math.max(xa, xb) > a && Math.min(xa, xb) < c && Math.max(q.py, q.sy) > yc - 3 && Math.min(q.py, q.sy) < yc + 0.6
    );
  }

  /** «Показать на чертеже»: рамки вокруг позиций, ворот, дверей, жалюзи или прохода из замечания (meta.hl). */
  hlPlan(sh, YP) {
    const H = this.o.hl;
    const X = v => this.o.X(v);
    const { ox, oy, Le, p } = this.o;
    const pad = 1.2;
    const m = ([x0, x1, y0, y1]) =>
      sh.mark(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.abs(x1 - x0) + 2 * pad, Math.abs(y1 - y0) + 2 * pad);
    const pos = new Set(H.pos || []);
    for (const it of [...p.items, ...this.o.ext, ...this.o.rf])
      if (pos.has(it.pos) && it.lx > 0)
        m([X(ox + it.x), X(ox + it.x + it.lx), YP(oy + it.y), YP(oy + it.y + (it.ly || it.lx))]);
    const kinds = new Set(H.kinds || []);
    for (const b of this.hlBoxes(kinds, YP)) m(b);
    if (kinds.has('aisle') && this.o.ai)
      m([X(ox + (this.o.g.x0 || 0)), X(Le - ox), YP(oy + this.o.ai.y0), YP(oy + this.o.ai.y1)]);
  }

  /** Рамки дверей: сервисные, оператора в стене прохода, двери-жалюзи ДГУ. */
  hlDoors(box) {
    const { ox, oy, p, en } = this.o;
    const front = en && en.wall === 'front' ? [en] : [];
    return [
      ...[...(p.doors || []), ...front].map(d => box(d.wall === 'back' ? 'back' : 'front', [d.x0, d.x1], oy)),
      ...this.o.dgs.map(d => (d.wall === 'back' ? box('back', [d.x0, d.x1], oy) : box(d.wall, [d.y0, d.y1], ox))),
    ];
  }

  /** Рамки проёмов из замечания: ворота, двери, жалюзи. */
  hlBoxes(kinds, YP) {
    const { ox, oy, p } = this.o;
    const box = (w, [a, b], t) => this.wallBox(w, [a, b], t, YP);
    const L = (p.vent && p.vent.louvers) || [];
    return [
      ...(kinds.has('gate') ? this.o.gts.map(q => box(q.wall, [q.y0, q.y1], ox)) : []),
      ...(kinds.has('door') ? this.hlDoors(box) : []),
      ...(kinds.has('vent') ? L.map(q => box(q.wall, [q.u0, q.u1], Math.max(oy, 120))) : []),
    ];
  }

  /** Полоса стены w толщиной t (мм) на участке [a, b] (мм внутри): [x0, x1, y0, y1] на листе. */
  wallBox(w, [a, b], t, YP) {
    const X = v => this.o.X(v);
    const { ox, oy, Le, We } = this.o;
    if (w === 'front') return [X(ox + a), X(ox + b), YP(0), YP(t)];
    if (w === 'back') return [X(ox + a), X(ox + b), YP(We), YP(We - t)];
    if (w === 'left') return [X(0), X(t), YP(oy + a), YP(oy + b)];
    return [X(Le - t), X(Le), YP(oy + a), YP(oy + b)];
  }
  /** Ресиверы снаружи на плане. */
  outPlan(sh, YP) {
    const k = this.o.k;
    const X = v => this.o.X(v);
    const { ox, oy, xR } = this.o;
    const E = this.o.ext;
    const o = this.o.outs[0];
    const f = EskdSheet.f;
    for (const it of E) {
      sh.rect(X(ox + it.x - 200), YP(oy + it.y + it.ly + 200), (it.lx + 400) * k, (it.ly + 400) * k, 'thin', '#fff');
      EquipIcon.plan(sh, it, X(ox + it.x), YP(oy + it.y + it.ly), X(ox + it.x + it.lx), YP(oy + it.y));
    }
    if (!o) return;
    const x0 = Math.min(...E.map(i => i.x));
    const xm = (xR + X(ox + x0)) / 2;
    const yo = YP(oy + o.y);
    const yc = E.map(i => YP(oy + i.y + i.ly / 2));
    sh.line(xR, yo, xm, yo, 'pipe');
    PneuSymbol.flow(sh, (xR + xm) / 2, yo, 1);
    const lo = Math.min(yo, ...yc);
    const hi = Math.max(yo, ...yc);
    if (hi - lo > 0.2) sh.line(xm, lo, xm, hi, 'pipe');
    for (const it of E) {
      const y = YP(oy + it.y + it.ly / 2);
      sh.line(xm, y, X(ox + it.x), y, 'pipe');
    }
    const far = E.reduce((a, c) => (c.x + c.lx > a.x + a.lx ? c : a));
    const ye = YP(oy + far.y + far.ly / 2);
    const xe = X(ox + far.x + far.lx) + 4;
    sh.path(`M${f(X(ox + far.x + far.lx / 2))},${f(ye)} H${f(xe)}`, 'pipe');
    sh.arrow(xe + 2.6, ye, 1, 0);
  }
  /** Двери на плане. */
  doorsPlan(sh, YP) {
    const { ox, p, en } = this.o;
    const X = v => this.o.X(v);
    const front = [p.fuel && p.fuel.door, en && en.wall === 'front' ? en : null].filter(Boolean);
    for (const d of front) {
      this.gap(sh, YP, [ox + d.x0, ox + d.x1], false);
      this.swingArc(sh, [X(ox + d.x0), X(ox + d.x1)], YP(0), 1);
    }
    for (const d of p.doors || []) this.leaves(sh, YP, d, d.leaves);
    for (const d of this.o.dgs.filter(q => q.wall !== 'back')) this.dguEnd(sh, YP, d);
    for (const d of this.o.dgB) this.leaves(sh, YP, { ...d, wall: 'back' }, 2);
    this.endLeaves(sh, YP);
  }

  /** В торцах: ворота (у морского — штатные двери), ворота отсека бака, двери оператора — створки в проёме. */
  endLeaves(sh, YP) {
    const { p, en } = this.o;
    for (const q of this.o.gts) this.inEnd(sh, YP, [q, q.wall === 'left', 2]);
    if (p.fuel && p.fuel.gate) this.inEnd(sh, YP, [p.fuel.gate, true, 2]);
    if (p.exit) this.inEnd(sh, YP, [p.exit, p.exit.wall === 'left', 1]);
    if (en && en.wall === 'left' && !en.sea) this.inEnd(sh, YP, [en, true, 1]);
  }

  /** Дуга открывания створки: петля xh, край xf у стены yw, наружу dir. */
  swingArc(sh, [xh, xf], yw, dir) {
    const f = EskdSheet.f;
    const r = Math.abs(xf - xh);
    const ye = yw + dir * r;
    sh.line(xh, yw, xh, ye, 'phantom');
    sh.path(`M${f(xh)},${f(ye)} A${f(r)},${f(r)} 0 0 ${xf > xh === dir > 0 ? 0 : 1} ${f(xf)},${f(yw)}`, 'phantom');
  }

  /** Проём в длинной стене: x0…x1 (мм), back — в задней. */
  gap(sh, YP, [x0, x1], back) {
    const { k, oy, We } = this.o;
    const X = v => this.o.X(v);
    const y0 = back ? YP(We) : YP(oy);
    const h = oy * k;
    sh.rect(X(x0), y0, (x1 - x0) * k, h, 'thin', '#fff');
    sh.line(X(x0), y0, X(x0), y0 + h, 'main');
    sh.line(X(x1), y0, X(x1), y0 + h, 'main');
  }

  /** Сервисные ворота (двери) и двери-жалюзи ДГУ в задней стене: проём и n створок, чётные — от левого края. */
  leaves(sh, YP, d, n) {
    const { ox, We } = this.o;
    const X = v => this.o.X(v);
    const back = d.wall === 'back';
    const lw = d.w / n;
    this.gap(sh, YP, [ox + d.x0, ox + d.x1], back);
    for (let i = 0; i < n; i++) {
      const a = ox + d.x0 + i * lw;
      const b = a + lw;
      const left = i % 2 === 0;
      this.swingArc(sh, [X(left ? a : b), X(left ? b : a)], back ? YP(We) : YP(0), back ? -1 : 1);
    }
  }

  /** Дверь-жалюзи ДГУ в торце: проём и две створки наружу. */
  dguEnd(sh, YP, d) {
    const { ox, oy, Le } = this.o;
    const X = v => this.o.X(v);
    const f = EskdSheet.f;
    const L = d.wall === 'left';
    const [ya, yb] = [YP(oy + d.y0), YP(oy + d.y1)];
    const [x0, x1] = L ? [X(0), X(ox)] : [X(Le - ox), X(Le)];
    const xo = L ? x0 : x1;
    const sx = L ? -1 : 1;
    const r = (ya - yb) / 2;
    sh.rect(x0, yb, x1 - x0, ya - yb, 'thin', '#fff');
    sh.line(x0, ya, x1, ya, 'main');
    sh.line(x0, yb, x1, yb, 'main');
    for (const [yh, s] of [
      [ya, -1],
      [yb, 1],
    ]) {
      sh.line(xo, yh, xo + sx * r, yh, 'phantom');
      sh.path(
        `M${f(xo + sx * r)},${f(yh)} A${f(r)},${f(r)} 0 0 ${s > 0 === sx > 0 ? 1 : 0} ${f(xo)},${f(yh + s * r)}`,
        'phantom',
      );
    }
  }

  /** Створки в проёме торца: d — проём (y0…y1), left — торец у входа, n — створок. */
  inEnd(sh, YP, [d, left, n]) {
    const { k, ox, oy, Le } = this.o;
    const xw = left ? this.o.xL : this.o.X(Le - ox);
    const y0 = oy + d.y0;
    const w = d.y1 - d.y0;
    const lw = w / n;
    sh.rect(xw, YP(y0 + w), ox * k, w * k, 'thin', '#fff');
    for (let i = 0; i < n; i++)
      sh.rect(xw + ox * k * 0.25, YP(y0 + lw * (i + 1)), Math.max(0.4, ox * k * 0.5), lw * k, 'main', '#fff');
  }
  /** Цепочка размеров вдоль задней стены по заднему ряду. */
  chainPlan(k) {
    const x0 = this.o.g.x0 || 0;
    const row = this.o.p.items.filter(i => i.row === 0 && i.mount !== 'pipe').sort((a, c) => a.x - c.x);
    if (!row.length) return { segs: [], lift: 0, tick: false, skip: [] };
    const pts = [x0];
    for (const it of row) pts.push(it.x, it.x + it.lx);
    pts.push(this.o.Li);
    const xs = [...new Set(pts.map(v => Math.round(v)))].filter(v => v >= x0 && v <= this.o.Li).sort((a, c) => a - c);
    const busy = [[], [], [], [], [], []];
    const segs = [];
    const skip = [];
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1] * k;
      const c = xs[i] * k;
      const t = StationLayout.n(xs[i] - xs[i - 1]);
      const w = EskdSheet.tw(t, 3.5);
      const m = (a + c) / 2;
      const [lift, x] = w + 1 > c - a ? DrawPlan.place(busy, m, w) : [0, m];
      if (lift < 0) {
        skip.push(t);
        continue;
      }
      busy[lift].push([x - w / 2, x + w / 2]);
      segs.push({ a: xs[i - 1], c: xs[i], t, lift, x });
    }
    return {
      segs,
      lift: Math.max(0, ...segs.map(q => q.lift)),
      tick: segs.some(q => (q.c - q.a) * k < 2 * EskdSheet.AR[0] + 1.5),
      skip,
    };
  }
  /** Тесное число цепочки — выше (уровни 1…5) со сдвигом вбок, где свободно: [уровень, x]; не нашлось — [−1, m]. */
  static place(busy, m, w) {
    const free = (lv, x) => !busy[lv].some(([p, q]) => x - w / 2 - 1 < q && x + w / 2 + 1 > p);
    const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
    for (const lv of [1, 2, 3, 4, 5]) {
      const s = steps.find(q => free(lv, m + q * (w / 2 + 1.2)));
      if (s !== undefined) return [lv, m + s * (w / 2 + 1.2)];
    }
    return [-1, m];
  }

  /** Запас над планом под цепочку размеров, мм (и строка «не показаны …»). */
  chainTop(k) {
    const c = this.chainPlan(k);
    return c.segs.length ? 8 + 4.6 + c.lift * 5.1 + (c.skip.length ? 4.2 : 0) : 4;
  }
  chain(sh, y, from) {
    const X = v => this.o.X(v);
    const ox = this.o.ox;
    const c = this.chainPlan(this.o.k);
    const base = X(ox);
    c.segs.forEach((q, i) =>
      sh.dimH(X(ox + q.a), X(ox + q.c), y, q.t, i ? null : from, from, { lift: q.lift, tick: c.tick, tx: base + q.x }),
    );
    if (c.skip.length)
      sh.text(
        base,
        y - 0.8 - c.lift * 5.1 - 5,
        `Мелкие размеры цепочки не показаны в масштабе: ${c.skip.join('; ')} мм`,
        2.5,
      );
  }
  /** Проход: [y0, y1] поперёк контейнера, ширина в самом узком месте и где мерить. */
  static aisle(plan) {
    const it = plan.items.filter(i => i.mount === 'floor' || i.mount === 'frame');
    if (!it.length) return null;
    if (plan.rows === 2) {
      const A = it.filter(i => i.row === 1);
      const B = it.filter(i => i.row === 0);
      if (!A.length || !B.length) return null;
      const y0 = Math.max(...A.map(i => i.y + i.ly));
      const y1 = Math.min(...B.map(i => i.y));
      const m = B.find(i => i.y === y1);
      return { y0, y1, w: y1 - y0, xm: m.x + m.lx / 2 };
    }
    const y1 = Math.min(...it.map(i => i.y));
    const m = it.find(i => i.y === y1);
    return { y0: 0, y1, w: y1, xm: m.x + m.lx / 2, dgu: m.kind === 'dgu' };
  }

  /** Отрезки трубопровода на плане (лист). */
  pipeSegs(X, YP) {
    const { ox, oy } = this.o;
    const S = [];
    for (const l of this.o.lines) {
      for (const [a, c] of StationLayout.runs(l)) S.push([X(ox + a), YP(oy + l.y), X(ox + c), YP(oy + l.y)]);
      for (const b of l.branches || []) S.push([X(ox + b.x), YP(oy + b.y0), X(ox + b.x), YP(oy + b.y1)]);
      const P = ((l.out && StationLayout.outPath(l, this.o.p.int[1])) || { pts: [] }).pts.map(([x, y]) => [
        X(ox + x),
        YP(oy + y),
      ]);
      for (let k = 1; k < P.length; k++) S.push([...P[k - 1], ...P[k]]);
    }
    return S;
  }

  /** Расстояние от точки до ближайшего отрезка. */
  static gap(S, x, y) {
    return Math.min(
      Infinity,
      ...S.map(([a, b, c, e]) => {
        const [dx, dy] = [c - a, e - b];
        const L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((x - a) * dx + (y - b) * dy) / L2)) : 0;
        return Math.hypot(x - a - t * dx, y - b - t * dy);
      }),
    );
  }

  /** Точка выноски номера позиции на плане — мимо труб (не ближе 1,5 мм листа), иначе самая далёкая от них. */
  anchor(it, X, YP) {
    const { ox, oy } = this.o;
    const S = this.pipeSegs(X, YP);
    const [x0, x1] = [X(ox + it.x), X(ox + it.x + it.lx)];
    const [y0, y1] = [YP(oy + it.y + it.ly), YP(oy + it.y)];
    const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    let [best, bd] = [c, DrawPlan.gap(S, c.x, c.y)];
    if (!S.length || bd >= 1.5) return c;
    for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8])
      for (const fy of [0.5, 0.65, 0.35, 0.8, 0.2]) {
        const p = { x: x0 + (x1 - x0) * fx, y: y0 + (y1 - y0) * fy };
        const q = DrawPlan.gap(S, p.x, p.y);
        if (q >= 1.5) return p;
        if (q > bd) [best, bd] = [p, q];
      }
    return best;
  }
}
