import { AirChain } from '../layout/air-chain.js';
import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';
import { SchemeLayout } from './scheme-layout.js';
import { SchemeUnits } from './scheme-units.js';

/** Схема пневматическая принципиальная компрессорной станции (ГОСТ 2.701, 2.704). */
export class StationScheme {
  /** Есть ли что рисовать: в расстановке — компрессорная с цепочкой подготовки воздуха. */
  static ok(plan) {
    return !!(plan && plan.air && (plan.air.units || []).some(u => u.kind === 'compressor'));
  }

  static svg(plan, meta = {}) {
    return new StationScheme(plan, meta).draw();
  }

  constructor(plan, meta) {
    this.plan = plan;
    this.meta = meta;
    this.a = plan.air;
    this.U = this.a.units || [];
    this.comps = this.U.filter(u => u.kind === 'compressor');
    this.chain = this.U.filter(u => u.kind !== 'compressor');
    this.pipe = (plan.piping || []).find(p => p.pos != null);
    this.cond = this.a.cond || [];
    this.dry =
      this.U.some(x => x.kind === 'dryer' && (x.air || {}).type !== 'gen') || this.comps.some(x => (x.air || {}).dryer);
    this.sh = new EskdSheet('A4');
  }

  draw() {
    const { sh, meta } = this;
    const yN = this.texts();
    const comp = this.comps.flatMap(u => Array.from({ length: Math.min(u.qty || 1, 4) }, () => u)).slice(0, 6);
    const nodes = this.nodes();
    const tw = t => EskdSheet.tw(t, 2.5);
    const outW = Math.max(tw('К потребителю'), this.a.cls ? tw(`класс ${this.a.cls}`) : 0);
    const G = SchemeLayout.layout({ nc: comp.length, nodes, wide: comp.some(StationScheme.built), outW }, 30, yN - 6);
    this.compressors(comp, G);
    const P = nodes.map((n, i) => ({ ...n, ...G.pos[i], y: G.Y[G.pos[i].r], m: G.m }));
    const st = this.line(P, G);
    this.outlet(st, G);
    this.drains(st.drains, G);
    sh.frame({
      name: meta.title || 'Станция компрессорная',
      doc: 'Схема пневматическая принципиальная',
      code: EskdSheet.code(meta.org, this.plan.hash, 'П3'),
      lit: 'П',
      sheets: 1,
      org: meta.org,
      dev: meta.dev,
      date: meta.date,
    });
    return sh.svg();
  }

  /** Встроенные в компрессор осушитель или фильтры. */
  static built(u) {
    return !!((u.air || {}).dryer || (u.air || {}).filter);
  }

  /** Строки перечня: позиции цепочки, очистка конденсата, обвязка. */
  rows() {
    const by = new Map();
    for (const u of this.U) {
      const r = by.get(u.pos);
      if (r) r.qty += u.qty || 1;
      else by.set(u.pos, { u, qty: u.qty || 1 });
    }
    const pp = this.pipe;
    return [
      ...by.values(),
      ...this.cond.map(c => ({ u: { pos: c.pos, kind: 'cond', brief: c.brief, name: c.name }, qty: c.qty || 1 })),
      ...(pp ? [{ u: { pos: pp.pos, kind: 'piping', brief: pp.name }, qty: 1 }] : []),
    ].sort((p, q) => p.u.pos - q.u.pos);
  }

  /** Примечание в перечне. */
  note(u) {
    const r = u.air || {};
    const by = {
      compressor: () =>
        [
          r.dryer ? 'встроенный осушитель' : '',
          r.filter ? 'встроенные фильтры' : '',
          r.vsd ? 'частотное регулирование' : '',
        ]
          .filter(Boolean)
          .join(', '),
      dryer: () => ({ ads: 'адсорбционный', gen: 'генератор' })[r.type] || 'рефрижераторный',
      receiver: () => [this.recvWhere(r), r.out ? 'снаружи' : ''].filter(Boolean).join(', '),
      filter: () => (AirChain.GRADES[r.grade] ? AirChain.GRADES[r.grade].short : ''),
      cond: () => 'очистка конденсата',
      piping: () => 'краны, клапаны, манометры',
    };
    const s = by[u.kind] ? by[u.kind]() : '';
    return u.kind === 'dryer' && r.filters ? `${s}, встроенные фильтры` : s;
  }

  /** Где ресивер по ходу воздуха. */
  recvWhere(r) {
    if (r.role !== 'dry') return this.dry ? 'до осушителя' : '';
    if (this.dry) return 'после осушителя';
    return this.U.some(x => x.kind === 'filter') ? 'после фильтров' : '';
  }

  /** Перечень элементов и указания над основной надписью; возвращает верх указаний. */
  texts() {
    const { sh, a, pipe } = this;
    const rows = this.rows();
    const yList = 237 - 12 - (6 + rows.length * 6);
    const cells = rows.map(({ u, qty }) => [
      [String(u.pos), 'c'],
      u.brief || u.name || '',
      [String(qty), 'c'],
      this.note(u),
    ]);
    sh.table([20, yList], [14, 95, 12, 64], ['Поз.', 'Наименование', 'Кол.', 'Примечание'], cells, [6, 6, 2.5]);
    sh.text(20 + 92.5, yList - 2.5, 'Перечень элементов', 3.5, { a: 'middle' });
    const qn = G => G.reduce((s, u) => s + (u.qty || 1), 0);
    const bypass = AirChain.groups(this.chain).some(
      G => qn(G) === 1 && G[0].kind === 'dryer' && (G[0].air || {}).type !== 'gen',
    );
    const out = this.U.filter(u => u.kind === 'receiver' && (u.air || {}).out);
    const many = out.length > 1 || (out.length && (out[0].qty || 1) > 1);
    const notes = [
      `Арматура (запорные краны, предохранительный клапан, манометр, отвод конденсата) показана условно${pipe ? `; входит в обвязку поз. ${pipe.pos}` : ''}.`,
      'У ресивера, фильтров и осушителя — один вход и один выход: сжатый воздух проходит через них последовательно, по стрелкам; линии отвода конденсата — штриховые.',
      AirChain.parText(this.chain) || '',
      bypass
        ? 'У осушителя — байпас: обводная линия с краном (нормально закрыт), на входе и выходе осушителя — краны; осушитель обслуживают без остановки подачи воздуха.'
        : '',
      a.cls ? `На выходе — класс чистоты сжатого воздуха ${a.cls} по ISO 8573-1.` : '',
      out.length
        ? `${many ? 'Ресиверы' : 'Ресивер'} поз. ${[...new Set(out.map(u => u.pos))].join(', ')} — снаружи контейнера, на площадке; подключение через стену — с запорной арматурой.`
        : '',
    ].filter(Boolean);
    const yN = yList - 8 - sh.paras([25, 0, 175], notes, 2.5, false);
    sh.paras([25, yN, 175], notes, 2.5);
    return yN;
  }

  /** Узлы по ходу воздуха. */
  nodes() {
    return AirChain.groups(this.chain).flatMap(G => {
      const n = G.reduce((s, u) => s + (u.qty || 1), 0);
      if (G[0].kind === 'receiver' || n < 2)
        return G.flatMap(u =>
          Array.from({ length: Math.min(u.qty || 1, 3) }, () => ({ u, w: 1, half: SchemeLayout.half(u), ex: 0 })),
        );
      const all = G.flatMap(u => Array(u.qty || 1).fill(u));
      const pick = new Set(G.slice(0, 3).map(u => all.indexOf(u)));
      for (let i = 0; i < all.length && pick.size < 3; i++) pick.add(i);
      const U = [...pick].sort((p, q) => p - q).map(i => all[i]);
      const g = SchemeLayout.par(U[0], U.length);
      return [{ u: G[0], par: U, n, w: 2, half: g.hw, ex: g.ex }];
    });
  }

  /** Компрессоры с двигателями столбцом слева, краны, коллектор; встроенное — внутри штрихпунктирной границы. */
  compressors(comp, { m, xCol, dy, yT }) {
    const { sh } = this;
    const xM = 29 + 4 * (m - 1);
    const xC = xM + 13 * m;
    comp.forEach((u, i) => {
      const yo = yT + i * dy;
      const cy = yo + 8 * m;
      const r = u.air || {};
      PneuSymbol.motor(sh, xM, cy, xC - 5 * m, 3.4 * m);
      PneuSymbol.compressor(sh, xC, cy, 5 * m);
      sh.line(xC, cy - 5 * m, xC, yo, 'bold');
      sh.line(xC, yo, xCol - 7.8 * m, yo, 'bold');
      if (StationScheme.built(u)) {
        if (r.dryer) PneuSymbol.dryer(sh, xC + 11 * m, yo, 4 * m);
        if (r.filter) PneuSymbol.filter(sh, [xC + (r.dryer ? 22 : 11) * m, yo], 3.4 * m, 'auto');
        sh.rect([xM - 5.5 * m, yo - 6.5 * m, xCol - 10 * m - (xM - 5.5 * m), 21.5 * m], 'axis');
        sh.text(xM - 5.5 * m, yo - 6.5 * m - 1.2, String(u.pos), 3.5);
      } else sh.text(xM - 3.4 * m, cy - 3.4 * m - 1.4, String(u.pos), 3.5, { a: 'middle' });
      PneuSymbol.valve(sh, [xCol - 6 * m, yo], 1.8 * m);
      sh.line(xCol - 4.2 * m, yo, xCol, yo, 'bold');
      if (comp.length > 1) sh.dot(xCol, yo, 0.6);
    });
    if (comp.length > 1) sh.line(xCol, yT, xCol, yT + (comp.length - 1) * dy, 'bold');
  }

  /** Отрезок линии; горизонтальный длиннее 10 модулей — со стрелкой потока. */
  seg(x1, y1, [x2, y2], m) {
    this.sh.line(x1, y1, x2, y2, 'bold');
    if (y1 === y2 && Math.abs(x2 - x1) > 10 * m) PneuSymbol.flow(this.sh, (x1 + x2) / 2, y1, x2 > x1 ? 1 : -1);
  }

  /** Перенос линии на строку r — у правого (xR) или левого (xL) края. */
  wrap(st, r, G) {
    const ex = st.pr % 2 === 0 ? G.xR : G.xL;
    this.seg(st.px, st.py, [ex, st.py], G.m);
    this.sh.line(ex, st.py, ex, G.Y[r], 'bold');
    Object.assign(st, { px: ex, py: G.Y[r], pr: r });
  }

  /** Аппараты по ходу воздуха; возвращает конец линии {px, py, pr} и точки слива. */
  line(P, G) {
    const st = { px: G.xCol, py: G.yT, pr: 0, drains: [] };
    for (const n of P) {
      const w = n.half * G.m;
      if (n.r !== st.pr) this.wrap(st, n.r, G);
      this.seg(st.px, st.py, [n.ltr ? n.x - w : n.x + w, n.y], G.m);
      if (n.par) st.drains.push(...SchemeUnits.group(this.sh, n));
      else {
        const d = SchemeUnits.node(this.sh, n);
        if (d) st.drains.push({ x: d[0], y: d[1], r: n.r });
      }
      st.px = n.ltr ? n.x + w : n.x - w;
      st.py = n.y;
    }
    return st;
  }

  /** Выход к потребителю: кран, стрелка, класс чистоты — за стрелкой, по ходу строки. */
  outlet(st, G) {
    const { sh, a } = this;
    const m = G.m;
    if (G.rows - 1 > st.pr) this.wrap(st, G.rows - 1, G);
    const { px, py } = st;
    const dir = st.pr % 2 === 0 ? 1 : -1;
    const xv = px + dir * 7 * m;
    const xo = px + dir * 14 * m;
    const tip = xo + dir * 2.6;
    const an = dir > 0 ? 'start' : 'end';
    this.seg(px, py, [xv - dir * 1.8 * m, py], m);
    PneuSymbol.valve(sh, [xv, py], 1.8 * m);
    sh.line(xv + dir * 1.8 * m, py, xo, py, 'bold');
    sh.arrow(tip, py, dir, 0);
    sh.text(tip + dir * 1.2, py + 0.9, 'К потребителю', 2.5, { a: an });
    if (a.cls) sh.text(tip + dir * 1.2, py + 4.8, `класс ${a.cls}`, 2.5, { a: an });
  }

  /** Отвод конденсата: от сливов вниз к линии сбора под строкой. */
  drains(D, G) {
    const lab = this.cond.length ? `конденсат — к поз. ${this.cond[0].pos}` : 'конденсат';
    for (const r of [...new Set(D.map(d => d.r))])
      this.drainRow(
        D.filter(d => d.r === r),
        r,
        G,
        lab,
      );
  }

  /** Линия сбора строки r; подпись — за стрелкой, где не мешают перенос строки и компрессоры, иначе — под линией. */
  drainRow(D, r, G, lab) {
    const { sh } = this;
    const lw = EskdSheet.tw(lab, 2.5);
    const yd = G.Y[r] + (17 + G.ex[r]) * G.m;
    const [x0, x1] = [Math.min(...D.map(d => d.x)), Math.max(...D.map(d => d.x))];
    const ltr = r % 2 === 0;
    const [lo, hi] = StationScheme.drainRoom(G, r, yd);
    for (const d of D) sh.line(d.x, d.y, d.x, yd, 'drain');
    const o = (ltr ? [1, -1] : [-1, 1])
      .map(d => ({ d, xe: d > 0 ? x1 + 6 : x0 - 6 }))
      .find(q => (q.d > 0 ? q.xe + 3.6 + lw <= hi : q.xe - 3.6 - lw >= lo));
    if (o) {
      sh.line(o.d > 0 ? x0 : x1, yd, o.xe, yd, 'drain');
      sh.arrow(o.xe + o.d * 2.6, yd, o.d, 0);
      sh.text(o.xe + o.d * 3.6, yd + 1.2, lab, 2.5, { a: o.d > 0 ? 'start' : 'end' });
      return;
    }
    const d = ltr ? 1 : -1;
    const xe = d > 0 ? x1 + 4 : x0 - 4;
    sh.line(d > 0 ? x0 : x1, yd, xe, yd, 'drain');
    sh.arrow(xe + d * 2.6, yd, d, 0);
    if (d > 0) sh.text(Math.max(lo + lw, Math.min(hi, xe + 2.6)), yd + 4.4, lab, 2.5, { a: 'end' });
    else sh.text(Math.min(hi - lw, Math.max(lo, xe - 2.6)), yd + 4.4, lab, 2.5);
  }

  /** Где можно писать под строкой r: мимо переноса строки и столбца компрессоров — [lo, hi]. */
  static drainRoom(G, r, yd) {
    const ltr = r % 2 === 0;
    const next = r < G.rows - 1;
    if (!ltr && next) return [G.xL + 2, 200];
    return [G.colBot < yd - 4 ? 26 : G.xCol + 2, ltr && next ? G.xR - 2 : 200];
  }
}
