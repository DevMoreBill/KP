import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';

/** Схема гидравлическая принципиальная насосной станции (ГОСТ 2.704). */
export class HydroScheme {
  static ok(plan) {
    return !!plan && (plan.items || []).some(i => i.kind === 'pump');
  }
  static TANK = /мембран|гидроаккум|гидробак|расширит/i;
  static TOP = 30;
  static XL = 26;

  static svg(plan, meta = {}) {
    return new HydroScheme(plan, meta).draw();
  }

  constructor(plan, meta) {
    const I = plan.items || [];
    this.plan = plan;
    this.meta = meta;
    this.P = I.filter(i => i.kind === 'pump').sort((a, b) => a.pos - b.pos || a.unit - b.unit);
    this.tank = I.find(i => i.kind === 'tank' && HydroScheme.TANK.test(i.name || ''));
    this.pipe = (plan.piping || []).find(p => p.pos != null);
    this.r = plan.req || {};
    this.res = Math.max(0, Math.round(+this.r.reserve || 0));
    this.sh = new EskdSheet('A4');
  }

  draw() {
    const { sh, meta } = this;
    const yN = this.texts();
    this.scheme(this.fit(yN));
    sh.frame({
      name: meta.title || 'Станция насосная',
      doc: 'Схема гидравлическая принципиальная',
      code: EskdSheet.code(meta.org, this.plan.hash, 'Г3'),
      lit: 'П',
      sheets: 1,
      org: meta.org,
      dev: meta.dev,
      date: meta.date,
    });
    return sh.svg();
  }

  /** Строки перечня элементов: насосы (рабочие и резерв), гидробак, обвязка. */
  rows() {
    const by = new Map();
    for (const it of [...this.P, ...(this.tank ? [this.tank] : [])]) {
      const e = by.get(it.pos);
      if (e) e.qty++;
      else by.set(it.pos, { it, qty: 1 });
    }
    const res = this.res;
    const note = (it, qty) => {
      if (it.kind !== 'pump') return 'на напорном коллекторе';
      return res && qty > res ? `${qty - res} рабочих, ${res} резервн.` : 'параллельно';
    };
    const rows = [...by.values()].map(({ it, qty }) => [
      [String(it.pos), 'c'],
      it.brief || it.name,
      [String(qty), 'c'],
      note(it, qty),
    ]);
    const pp = this.pipe;
    if (pp)
      rows.push([[String(pp.pos), 'c'], pp.brief || pp.name, ['1', 'c'], 'задвижки, обратные клапаны, манометры']);
    return rows.sort((a, b) => +a[0][0] - +b[0][0]);
  }

  /** Перечень элементов и указания над основной надписью; возвращает верх указаний. */
  texts() {
    const { sh, r, res, pipe } = this;
    const rows = this.rows();
    const yList = 237 - 12 - (6 + rows.length * 6);
    sh.table([20, yList], [14, 95, 12, 64], ['Поз.', 'Наименование', 'Кол.', 'Примечание'], rows, [6, 6, 2.5]);
    sh.text(112.5, yList - 2.5, 'Перечень элементов', 3.5, { a: 'middle' });
    const num = v => (+v > 0 ? String(v).replace('.', ',') : '');
    const [q, head] = [num(r.q), num(r.head)];
    const notes = [
      `Арматура (задвижки, обратные клапаны, мановакуумметры и манометры) показана условно${pipe ? `; входит в обвязку поз. ${pipe.pos}` : ''}.`,
      'Насосы включены параллельно: из всасывающего коллектора — в напорный; на каждом насосе — задвижки до и после, обратный клапан на напорной линии.',
      q || head
        ? `Подача станции — ${q ? `${q} м³/ч` : 'по проекту'}, напор — ${head ? `${head} м` : 'по проекту'}${res ? `, резерв N + ${res}` : ''}.`
        : '',
      this.P.length > 6 ? `Показаны 6 насосов из ${this.P.length} — остальные подключены так же.` : '',
    ].filter(Boolean);
    const yN = yList - 8 - sh.paras([25, 0, 175], notes, 2.5, false);
    sh.paras([25, yN, 175], notes, 2.5);
    return yN;
  }

  /** Модуль m: крупнее, пока схема помещается по высоте над указаниями и по ширине поля (до 200 мм). */
  fit(yN) {
    const n = Math.max(1, Math.min(6, this.P.length));
    const geo = m => {
      const Lp = 11 * m + 4;
      const colW = 16 * m + 9.6;
      const w = HydroScheme.XL + 8 + Lp + (n - 0.5) * colW + 30;
      return { m, Lp, colW, ok: w <= 200 && HydroScheme.TOP + 80 * m + 16 <= yN - 6 };
    };
    return [14, 13, 12, 11, 10, 9, 8, 7].map(v => geo(v / 10)).find(g => g.ok) || geo(0.7);
  }

  /** Насосы колонками между коллекторами (двигатель — слева от насоса, манометры — справа). */
  scheme({ m, Lp, colW }) {
    const { sh, tank } = this;
    const U = this.P.slice(0, 6);
    const xL = HydroScheme.XL;
    const yD = HydroScheme.TOP + 8;
    const yS = yD + 80 * m;
    const x0 = xL + 8 + Lp;
    const xs = U.map((u, k) => x0 + k * colW);
    const xE = xs[xs.length - 1] + colW / 2;
    const xR = xE + 30;
    // коллекторы
    sh.line(x0 - Lp, yD, xR, yD, 'pipe');
    sh.line(xL, yS, xE, yS, 'pipe');
    PneuSymbol.flow(sh, xE + 6, yD, 1);
    sh.arrow(xR + 2.6, yD, 1, 0);
    sh.text(xR + 2.6, yD - 2.4, 'К потребителю', 2.5, { a: 'end' });
    sh.arrow(xL + 2.6, yS, 1, 0);
    PneuSymbol.flow(sh, xL + 8, yS, 1);
    sh.text(xL, yS + 5, 'Из источника', 2.5);
    sh.line(xE + 2, yD, xE + 2, yD - 4.4, 'bold');
    PneuSymbol.gauge(sh, xE + 2, yD - 6.2, 1.8);
    if (tank) {
      const xt = xR - 8;
      sh.line(xt, yD, xt, yD + 7 * m, 'bold');
      PneuSymbol.valve(sh, [xt, yD + 3.5 * m], 1.6, { vertical: true });
      PneuSymbol.membrane(sh, xt, yD + 7 * m, 7 * m, 11 * m);
      sh.text(xt + 3.5 * m + 1, yD + 12 * m, String(tank.pos), 3.5);
    }
    U.forEach((u, k) => this.column(u, xs[k], [yD, yS], m));
  }

  /** Колонка насоса: задвижки, обратный клапан, манометр и мановакуумметр, насос с двигателем. */
  column(u, x, [yD, yS], m) {
    const { sh } = this;
    const s = 1.8 * m;
    const yP = yD + 46 * m;
    const rp = 5 * m;
    sh.line(x, yD, x, yS, 'bold');
    PneuSymbol.valve(sh, [x, yD + 8 * m], s, { vertical: true });
    PneuSymbol.check(sh, x, yD + 18 * m, s);
    sh.line(x, yD + 28 * m, x + 5 * m, yD + 28 * m, 'thin');
    PneuSymbol.gauge(sh, x + 5 * m + 1.8, yD + 28 * m, 1.8);
    PneuSymbol.pump(sh, x, yP, rp);
    PneuSymbol.motor(sh, x - rp - 4 - 3 * m, yP, x - rp, 3 * m);
    sh.text(x + rp + 0.8, yP - rp + 0.8, String(u.pos), 3.5);
    sh.line(x, yP + 14 * m, x + 5 * m, yP + 14 * m, 'thin');
    PneuSymbol.gauge(sh, x + 5 * m + 1.8, yP + 14 * m, 1.8);
    PneuSymbol.valve(sh, [x, yS - 8 * m], s, { vertical: true });
    sh.dot(x, yD, 0.6);
    sh.dot(x, yS, 0.6);
  }
}
