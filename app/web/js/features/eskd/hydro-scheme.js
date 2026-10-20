import { EskdSheet } from './eskd-sheet.js';
import { PneuSymbol } from './pneu-symbol.js';

/** Схема гидравлическая принципиальная насосной станции (ГОСТ 2.704). */
export class HydroScheme {
  /** Схема строится: в станции есть насосы. */
  static ok(plan) {
    return !!plan && (plan.items || []).some(i => i.kind === 'pump');
  }
  static TANK = /мембран|гидроаккум|гидробак|расширит/i;
  static TOP = 30;
  static X_LEFT = 26;

  /** Лист схемы гидравлической принципиальной (SVG). */
  static svg(plan, meta = {}) {
    return new HydroScheme(plan, meta)._draw();
  }

  constructor(plan, meta) {
    const items = plan.items || [];
    this.plan = plan;
    this.meta = meta;
    this.pumps = items
      .filter(i => i.kind === 'pump')
      .sort((first, second) => first.pos - second.pos || first.unit - second.unit);
    this.tank = items.find(i => i.kind === 'tank' && HydroScheme.TANK.test(i.name || ''));
    this.pipe = (plan.piping || []).find(pipe => pipe.pos != null);
    this.req = plan.req || {};
    this.res = Math.max(0, Math.round(+this.req.reserve || 0));
    this.sheet = new EskdSheet('A4');
  }

  _draw() {
    const { sheet, meta } = this;
    const notesY = this.texts();
    this.scheme(this.fit(notesY));
    sheet.frame({
      name: meta.title || 'Станция насосная',
      doc: 'Схема гидравлическая принципиальная',
      code: EskdSheet.code(meta.org, this.plan.hash, 'Г3'),
      lit: 'П',
      sheets: 1,
      org: meta.org,
      dev: meta.dev,
      date: meta.date,
    });
    return sheet.svg();
  }

  /** Строки перечня элементов: насосы (рабочие и резерв), гидробак, обвязка. */
  rows() {
    const byPos = new Map();
    for (const item of [...this.pumps, ...(this.tank ? [this.tank] : [])]) {
      const entry = byPos.get(item.pos);
      if (entry) entry.qty++;
      else byPos.set(item.pos, { it: item, qty: 1 });
    }
    const res = this.res;
    const note = (item, qty) => {
      if (item.kind !== 'pump') return 'на напорном коллекторе';
      return res && qty > res ? `${qty - res} рабочих, ${res} резервн.` : 'параллельно';
    };
    const rows = [...byPos.values()].map(({ it: item, qty }) => [
      [String(item.pos), 'c'],
      item.brief || item.name,
      [String(qty), 'c'],
      note(item, qty),
    ]);
    const pipe = this.pipe;
    if (pipe)
      rows.push([
        [String(pipe.pos), 'c'],
        pipe.brief || pipe.name,
        ['1', 'c'],
        'задвижки, обратные клапаны, манометры',
      ]);
    return rows.sort((first, second) => +first[0][0] - +second[0][0]);
  }

  /** Перечень элементов и указания над основной надписью; возвращает верх указаний. */
  texts() {
    const { sheet, req, res, pipe } = this;
    const rows = this.rows();
    const yList = 237 - 12 - (6 + rows.length * 6);
    sheet.table([20, yList], [14, 95, 12, 64], ['Поз.', 'Наименование', 'Кол.', 'Примечание'], rows, [6, 6, 2.5]);
    sheet.text(112.5, yList - 2.5, 'Перечень элементов', 3.5, { a: 'middle' });
    const num = value => (+value > 0 ? String(value).replace('.', ',') : '');
    const [duty, head] = [num(req.q), num(req.head)];
    const notes = [
      `Арматура (задвижки, обратные клапаны, мановакуумметры и манометры) показана условно${pipe ? `; входит в обвязку поз. ${pipe.pos}` : ''}.`,
      'Насосы включены параллельно: из всасывающего коллектора — в напорный; на каждом насосе — задвижки до и после, обратный клапан на напорной линии.',
      duty || head
        ? `Подача станции — ${duty ? `${duty} м³/ч` : 'по проекту'}, напор — ${head ? `${head} м` : 'по проекту'}${res ? `, резерв N + ${res}` : ''}.`
        : '',
      this.pumps.length > 6 ? `Показаны 6 насосов из ${this.pumps.length} — остальные подключены так же.` : '',
    ].filter(Boolean);
    const notesY = yList - 8 - sheet.paras([25, 0, 175], notes, 2.5, false);
    sheet.paras([25, notesY, 175], notes, 2.5);
    return notesY;
  }

  /** Модуль m: крупнее, пока схема помещается по высоте над указаниями и по ширине поля (до 200 мм). */
  fit(notesY) {
    const count = Math.max(1, Math.min(6, this.pumps.length));
    const geo = scale => {
      const leftPad = 11 * scale + 4;
      const colW = 16 * scale + 9.6;
      const width = HydroScheme.X_LEFT + 8 + leftPad + (count - 0.5) * colW + 30;
      return { m: scale, Lp: leftPad, colW, ok: width <= 200 && HydroScheme.TOP + 80 * scale + 16 <= notesY - 6 };
    };
    return [14, 13, 12, 11, 10, 9, 8, 7].map(tenths => geo(tenths / 10)).find(geom => geom.ok) || geo(0.7);
  }

  /** Насосы колонками между коллекторами (двигатель — слева от насоса, манометры — справа). */
  scheme({ m: scale, Lp: leftPad, colW }) {
    const { sheet, tank } = this;
    const pumps = this.pumps.slice(0, 6);
    const leftX = HydroScheme.X_LEFT;
    const discharge = HydroScheme.TOP + 8;
    const suction = discharge + 80 * scale;
    const x0 = leftX + 8 + leftPad;
    const colsX = pumps.map((unit, k) => x0 + k * colW);
    const lastColX = colsX[colsX.length - 1] + colW / 2;
    const rightX = lastColX + 30;
    // коллекторы
    sheet.line(x0 - leftPad, discharge, rightX, discharge, 'pipe');
    sheet.line(leftX, suction, lastColX, suction, 'pipe');
    PneuSymbol.flow(sheet, lastColX + 6, discharge, 1);
    sheet.arrow(rightX + 2.6, discharge, 1, 0);
    sheet.text(rightX + 2.6, discharge - 2.4, 'К потребителю', 2.5, { a: 'end' });
    sheet.arrow(leftX + 2.6, suction, 1, 0);
    PneuSymbol.flow(sheet, leftX + 8, suction, 1);
    sheet.text(leftX, suction + 5, 'Из источника', 2.5);
    sheet.line(lastColX + 2, discharge, lastColX + 2, discharge - 4.4, 'bold');
    PneuSymbol.gauge(sheet, lastColX + 2, discharge - 6.2, 1.8);
    if (tank) {
      const textX = rightX - 8;
      sheet.line(textX, discharge, textX, discharge + 7 * scale, 'bold');
      PneuSymbol.valve(sheet, [textX, discharge + 3.5 * scale], 1.6, { vertical: true });
      PneuSymbol.membrane(sheet, textX, discharge + 7 * scale, 7 * scale, 11 * scale);
      sheet.text(textX + 3.5 * scale + 1, discharge + 12 * scale, String(tank.pos), 3.5);
    }
    pumps.forEach((unit, k) => this.column(unit, colsX[k], [discharge, suction], scale));
  }

  /** Колонка насоса: задвижки, обратный клапан, манометр и мановакуумметр, насос с двигателем. */
  column(pump, x, [discharge, suction], scale) {
    const { sheet } = this;
    const size = 1.8 * scale;
    const pumpY = discharge + 46 * scale;
    const pumpR = 5 * scale;
    sheet.line(x, discharge, x, suction, 'bold');
    PneuSymbol.valve(sheet, [x, discharge + 8 * scale], size, { vertical: true });
    PneuSymbol.check(sheet, x, discharge + 18 * scale, size);
    sheet.line(x, discharge + 28 * scale, x + 5 * scale, discharge + 28 * scale, 'thin');
    PneuSymbol.gauge(sheet, x + 5 * scale + 1.8, discharge + 28 * scale, 1.8);
    PneuSymbol.pump(sheet, x, pumpY, pumpR);
    PneuSymbol.motor(sheet, x - pumpR - 4 - 3 * scale, pumpY, x - pumpR, 3 * scale);
    sheet.text(x + pumpR + 0.8, pumpY - pumpR + 0.8, String(pump.pos), 3.5);
    sheet.line(x, pumpY + 14 * scale, x + 5 * scale, pumpY + 14 * scale, 'thin');
    PneuSymbol.gauge(sheet, x + 5 * scale + 1.8, pumpY + 14 * scale, 1.8);
    PneuSymbol.valve(sheet, [x, suction - 8 * scale], size, { vertical: true });
    sheet.dot(x, discharge, 0.6);
    sheet.dot(x, suction, 0.6);
  }
}
