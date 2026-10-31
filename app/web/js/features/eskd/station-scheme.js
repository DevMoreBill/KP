import { AirChain } from '../layout/air-chain.js';
import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';
import { SchemeLayout } from './scheme-layout.js';
import { SchemeUnits } from './scheme-units.js';
import { EskdFrame } from './eskd-frame.js';

/** Схема пневматическая принципиальная компрессорной станции (ГОСТ 2.701, 2.704). */
export class StationScheme {
  /** Есть ли что рисовать: в расстановке — компрессорная с цепочкой подготовки воздуха. */
  static ok(plan) {
    return !!(plan && plan.air && (plan.air.units || []).some(unit => unit.kind === 'compressor'));
  }

  /** Лист схемы пневматической принципиальной (SVG). */
  static svg(plan, meta = {}) {
    return new StationScheme(plan, meta)._draw();
  }

  constructor(plan, meta) {
    this.plan = plan;
    this.meta = meta;
    this.air = plan.air;
    this.units = this.air.units || [];
    this.comps = this.units.filter(unit => unit.kind === 'compressor');
    this.chain = this.units.filter(unit => unit.kind !== 'compressor');
    this.pipe = (plan.piping || []).find(pipe => pipe.pos != null);
    this.cond = this.air.cond || [];
    this.dry =
      this.units.some(x => x.kind === 'dryer' && (x.air || {}).type !== 'gen') ||
      this.comps.some(x => (x.air || {}).dryer);
    this.sheet = new EskdSheet('A4');
  }

  _draw() {
    const { sheet, meta } = this;
    const notesY = this.texts();
    const comp = this.comps.flatMap(unit => Array.from({ length: Math.min(unit.qty || 1, 4) }, () => unit)).slice(0, 6);
    const nodes = this.nodes();
    const textW = text => EskdSheet.textWidth(text, 2.5);
    const outW = Math.max(textW('К потребителю'), this.air.cls ? textW(`класс ${this.air.cls}`) : 0);
    const grid = SchemeLayout.layout(
      { nc: comp.length, nodes, wide: comp.some(StationScheme.built), outW },
      30,
      notesY - 6,
    );
    this.compressors(comp, grid);
    const placed = nodes.map((node, i) => ({ ...node, ...grid.pos[i], y: grid.Y[grid.pos[i].r], m: grid.m }));
    const state = this.line(placed, grid);
    this.outlet(state, grid);
    this.drains(state.drains, grid);
    EskdFrame.draw(sheet, {
      name: meta.title || 'Станция компрессорная',
      doc: 'Схема пневматическая принципиальная',
      code: EskdSheet.code(meta.org, this.plan.hash, 'П3'),
      lit: 'П',
      sheets: 1,
      org: meta.org,
      dev: meta.dev,
      date: meta.date,
    });
    return sheet.svg();
  }

  /** Встроенные в компрессор осушитель или фильтры. */
  static built(unit) {
    return !!((unit.air || {}).dryer || (unit.air || {}).filter);
  }

  /** Строки перечня: позиции цепочки, очистка конденсата, обвязка. */
  rows() {
    const byPos = new Map();
    for (const unit of this.units) {
      const entry = byPos.get(unit.pos);
      if (entry) entry.qty += unit.qty || 1;
      else byPos.set(unit.pos, { u: unit, qty: unit.qty || 1 });
    }
    const pipe = this.pipe;
    return [
      ...byPos.values(),
      ...this.cond.map(cond => ({
        u: { pos: cond.pos, kind: 'cond', brief: cond.brief, name: cond.name },
        qty: cond.qty || 1,
      })),
      ...(pipe ? [{ u: { pos: pipe.pos, kind: 'piping', brief: pipe.name }, qty: 1 }] : []),
    ].sort((first, second) => first.u.pos - second.u.pos);
  }

  /** Примечание в перечне. */
  note(unit) {
    const air = unit.air || {};
    const byKind = {
      compressor: () =>
        [
          air.dryer ? 'встроенный осушитель' : '',
          air.filter ? 'встроенные фильтры' : '',
          air.vsd ? 'частотное регулирование' : '',
        ]
          .filter(Boolean)
          .join(', '),
      dryer: () => ({ ads: 'адсорбционный', gen: 'генератор' })[air.type] || 'рефрижераторный',
      receiver: () => [this.recvWhere(air), air.out ? 'снаружи' : ''].filter(Boolean).join(', '),
      filter: () => (AirChain.GRADES[air.grade] ? AirChain.GRADES[air.grade].short : ''),
      cond: () => 'очистка конденсата',
      piping: () => 'краны, клапаны, манометры',
    };
    const text = byKind[unit.kind] ? byKind[unit.kind]() : '';
    return unit.kind === 'dryer' && air.filters ? `${text}, встроенные фильтры` : text;
  }

  /** Где ресивер по ходу воздуха. */
  recvWhere(recv) {
    if (recv.role !== 'dry') return this.dry ? 'до осушителя' : '';
    if (this.dry) return 'после осушителя';
    return this.units.some(x => x.kind === 'filter') ? 'после фильтров' : '';
  }

  /** Перечень элементов и указания над основной надписью; возвращает верх указаний. */
  texts() {
    const { sheet, air, pipe } = this;
    const rows = this.rows();
    const yList = 237 - 12 - (6 + rows.length * 6);
    const cells = rows.map(({ u: unit, qty }) => [
      [String(unit.pos), 'c'],
      unit.brief || unit.name || '',
      [String(qty), 'c'],
      this.note(unit),
    ]);
    sheet.table([20, yList], [14, 95, 12, 64], ['Поз.', 'Наименование', 'Кол.', 'Примечание'], cells, [6, 6, 2.5]);
    sheet.text(20 + 92.5, yList - 2.5, 'Перечень элементов', 3.5, { a: 'middle' });
    const qtyOf = group => group.reduce((sum, unit) => sum + (unit.qty || 1), 0);
    const bypass = AirChain.groups(this.chain).some(
      group => qtyOf(group) === 1 && group[0].kind === 'dryer' && (group[0].air || {}).type !== 'gen',
    );
    const out = this.units.filter(unit => unit.kind === 'receiver' && (unit.air || {}).out);
    const many = out.length > 1 || (out.length && (out[0].qty || 1) > 1);
    const notes = [
      `Арматура (запорные краны, предохранительный клапан, манометр, отвод конденсата) показана условно${pipe ? `; входит в обвязку поз. ${pipe.pos}` : ''}.`,
      'У ресивера, фильтров и осушителя — один вход и один выход: сжатый воздух проходит через них последовательно, по стрелкам; линии отвода конденсата — штриховые.',
      AirChain.parText(this.chain) || '',
      bypass
        ? 'У осушителя — байпас: обводная линия с краном (нормально закрыт), на входе и выходе осушителя — краны; осушитель обслуживают без остановки подачи воздуха.'
        : '',
      air.cls ? `На выходе — класс чистоты сжатого воздуха ${air.cls} по ISO 8573-1.` : '',
      out.length
        ? `${many ? 'Ресиверы' : 'Ресивер'} поз. ${[...new Set(out.map(unit => unit.pos))].join(', ')} — снаружи контейнера, на площадке; подключение через стену — с запорной арматурой.`
        : '',
    ].filter(Boolean);
    const notesY = yList - 8 - sheet.paras([25, 0, 175], notes, 2.5, false);
    sheet.paras([25, notesY, 175], notes, 2.5);
    return notesY;
  }

  /** Узлы по ходу воздуха. */
  nodes() {
    return AirChain.groups(this.chain).flatMap(group => {
      const count = group.reduce((sum, unit) => sum + (unit.qty || 1), 0);
      if (group[0].kind === 'receiver' || count < 2)
        return group.flatMap(unit =>
          Array.from({ length: Math.min(unit.qty || 1, 3) }, () => ({
            u: unit,
            w: 1,
            half: SchemeLayout.half(unit),
            ex: 0,
          })),
        );
      const all = group.flatMap(unit => Array(unit.qty || 1).fill(unit));
      const pick = new Set(group.slice(0, 3).map(unit => all.indexOf(unit)));
      for (let i = 0; i < all.length && pick.size < 3; i++) pick.add(i);
      const units = [...pick].sort((first, second) => first - second).map(i => all[i]);
      const geom = SchemeLayout.par(units[0], units.length);
      return [{ u: group[0], par: units, n: count, w: 2, half: geom.hw, ex: geom.ex }];
    });
  }

  /** Компрессоры с двигателями столбцом слева, краны, коллектор; встроенное — внутри штрихпунктирной границы. */
  compressors(comp, { m: scale, xCol, dy, yT: topY }) {
    const { sheet } = this;
    const motorX = 29 + 4 * (scale - 1);
    const compX = motorX + 13 * scale;
    comp.forEach((unit, i) => {
      const rowTop = topY + i * dy;
      const centerY = rowTop + 8 * scale;
      const air = unit.air || {};
      PneuSymbol.motor(sheet, motorX, centerY, compX - 5 * scale, 3.4 * scale);
      PneuSymbol.compressor(sheet, compX, centerY, 5 * scale);
      sheet.line(compX, centerY - 5 * scale, compX, rowTop, 'bold');
      sheet.line(compX, rowTop, xCol - 7.8 * scale, rowTop, 'bold');
      if (StationScheme.built(unit)) {
        if (air.dryer) PneuSymbol.dryer(sheet, compX + 11 * scale, rowTop, 4 * scale);
        if (air.filter) PneuSymbol.filter(sheet, [compX + (air.dryer ? 22 : 11) * scale, rowTop], 3.4 * scale, 'auto');
        sheet.rect(
          [motorX - 5.5 * scale, rowTop - 6.5 * scale, xCol - 10 * scale - (motorX - 5.5 * scale), 21.5 * scale],
          'axis',
        );
        sheet.text(motorX - 5.5 * scale, rowTop - 6.5 * scale - 1.2, String(unit.pos), 3.5);
      } else sheet.text(motorX - 3.4 * scale, centerY - 3.4 * scale - 1.4, String(unit.pos), 3.5, { a: 'middle' });
      PneuSymbol.valve(sheet, [xCol - 6 * scale, rowTop], 1.8 * scale);
      sheet.line(xCol - 4.2 * scale, rowTop, xCol, rowTop, 'bold');
      if (comp.length > 1) sheet.dot(xCol, rowTop, 0.6);
    });
    if (comp.length > 1) sheet.line(xCol, topY, xCol, topY + (comp.length - 1) * dy, 'bold');
  }

  /** Отрезок линии; горизонтальный длиннее 10 модулей — со стрелкой потока. */
  seg(x1, y1, [x2, y2], scale) {
    this.sheet.line(x1, y1, x2, y2, 'bold');
    if (y1 === y2 && Math.abs(x2 - x1) > 10 * scale) PneuSymbol.flow(this.sheet, (x1 + x2) / 2, y1, x2 > x1 ? 1 : -1);
  }

  /** Перенос линии на строку r — у правого (xR) или левого (xL) края. */
  wrap(state, row, grid) {
    const edgeX = state.pr % 2 === 0 ? grid.xR : grid.xL;
    this.seg(state.px, state.py, [edgeX, state.py], grid.m);
    this.sheet.line(edgeX, state.py, edgeX, grid.Y[row], 'bold');
    Object.assign(state, { px: edgeX, py: grid.Y[row], pr: row });
  }

  /** Аппараты по ходу воздуха; возвращает конец линии {px, py, pr} и точки слива. */
  line(placed, grid) {
    const state = { px: grid.xCol, py: grid.yT, pr: 0, drains: [] };
    for (const node of placed) {
      const halfW = node.half * grid.m;
      if (node.r !== state.pr) this.wrap(state, node.r, grid);
      this.seg(state.px, state.py, [node.ltr ? node.x - halfW : node.x + halfW, node.y], grid.m);
      if (node.par) state.drains.push(...SchemeUnits.group(this.sheet, node));
      else {
        const symbol = SchemeUnits.node(this.sheet, node);
        if (symbol) state.drains.push({ x: symbol[0], y: symbol[1], r: node.r });
      }
      state.px = node.ltr ? node.x + halfW : node.x - halfW;
      state.py = node.y;
    }
    return state;
  }

  /** Выход к потребителю: кран, стрелка, класс чистоты — за стрелкой, по ходу строки. */
  outlet(state, grid) {
    const { sheet, air } = this;
    const scale = grid.m;
    if (grid.rows - 1 > state.pr) this.wrap(state, grid.rows - 1, grid);
    const { px: fromX, py: fromY } = state;
    const dir = state.pr % 2 === 0 ? 1 : -1;
    const valveX = fromX + dir * 7 * scale;
    const outX = fromX + dir * 14 * scale;
    const tip = outX + dir * 2.6;
    const anchor = dir > 0 ? 'start' : 'end';
    this.seg(fromX, fromY, [valveX - dir * 1.8 * scale, fromY], scale);
    PneuSymbol.valve(sheet, [valveX, fromY], 1.8 * scale);
    sheet.line(valveX + dir * 1.8 * scale, fromY, outX, fromY, 'bold');
    sheet.arrow(tip, fromY, dir, 0);
    sheet.text(tip + dir * 1.2, fromY + 0.9, 'К потребителю', 2.5, { a: anchor });
    if (air.cls) sheet.text(tip + dir * 1.2, fromY + 4.8, `класс ${air.cls}`, 2.5, { a: anchor });
  }

  /** Отвод конденсата: от сливов вниз к линии сбора под строкой. */
  drains(drains, grid) {
    const lab = this.cond.length ? `конденсат — к поз. ${this.cond[0].pos}` : 'конденсат';
    for (const row of [...new Set(drains.map(drain => drain.r))])
      this.drainRow(
        drains.filter(drain => drain.r === row),
        row,
        grid,
        lab,
      );
  }

  /** Линия сбора строки r; подпись — за стрелкой, где не мешают перенос строки и компрессоры, иначе — под линией. */
  drainRow(drains, row, grid, lab) {
    const { sheet } = this;
    const labelW = EskdSheet.textWidth(lab, 2.5);
    const drainY = grid.Y[row] + (17 + grid.ex[row]) * grid.m;
    const [x0, x1] = [Math.min(...drains.map(dir => dir.x)), Math.max(...drains.map(dir => dir.x))];
    const ltr = row % 2 === 0;
    const [low, high] = StationScheme.drainRoom(grid, row, drainY);
    for (const dir of drains) sheet.line(dir.x, dir.y, dir.x, drainY, 'drain');
    const side = (ltr ? [1, -1] : [-1, 1])
      .map(dir => ({ d: dir, xe: dir > 0 ? x1 + 6 : x0 - 6 }))
      .find(opt => (opt.d > 0 ? opt.xe + 3.6 + labelW <= high : opt.xe - 3.6 - labelW >= low));
    if (side) {
      sheet.line(side.d > 0 ? x0 : x1, drainY, side.xe, drainY, 'drain');
      sheet.arrow(side.xe + side.d * 2.6, drainY, side.d, 0);
      sheet.text(side.xe + side.d * 3.6, drainY + 1.2, lab, 2.5, { a: side.d > 0 ? 'start' : 'end' });
      return;
    }
    const dir = ltr ? 1 : -1;
    const endX = dir > 0 ? x1 + 4 : x0 - 4;
    sheet.line(dir > 0 ? x0 : x1, drainY, endX, drainY, 'drain');
    sheet.arrow(endX + dir * 2.6, drainY, dir, 0);
    if (dir > 0) sheet.text(Math.max(low + labelW, Math.min(high, endX + 2.6)), drainY + 4.4, lab, 2.5, { a: 'end' });
    else sheet.text(Math.min(high - labelW, Math.max(low, endX - 2.6)), drainY + 4.4, lab, 2.5);
  }

  /** Где можно писать под строкой r: мимо переноса строки и столбца компрессоров — [lo, hi]. */
  static drainRoom(grid, row, drainY) {
    const ltr = row % 2 === 0;
    const next = row < grid.rows - 1;
    if (!ltr && next) return [grid.xL + 2, 200];
    return [grid.colBot < drainY - 4 ? 26 : grid.xCol + 2, ltr && next ? grid.xR - 2 : 200];
  }
}
