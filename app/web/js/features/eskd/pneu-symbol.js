/** Условные графические обозначения пневмосхем (ГОСТ 2.780…2.782-96 по ISO 1219-1; арматура — ГОСТ 2.785-70). */
export class PneuSymbol {
  /** Компрессор: окружность, незачернённый треугольник (пневматика) вершиной к выходу — вверх. */
  static compressor(sh, cx, cy, r = 5) {
    sh.circle(cx, cy, r, 'bold', '#fff');
    const t = r * 0.6;
    sh.poly(
      [
        [cx, cy - r],
        [cx - t * 0.62, cy - r + t],
        [cx + t * 0.62, cy - r + t],
      ],
      'bold',
      '#fff',
    );
    return { out: [cx, cy - r], inl: [cx, cy + r], shaft: [cx - r, cy] };
  }
  /** Электродвигатель привода: окружность с буквой M, вал — двойная линия. */
  static motor(sh, cx, cy, x2, r = 3.4) {
    sh.line(cx + r, cy - 0.55, x2, cy - 0.55, 'bold');
    sh.line(cx + r, cy + 0.55, x2, cy + 0.55, 'bold');
    sh.circle(cx, cy, r, 'bold', '#fff');
    const h = r < 3 ? 2.5 : 3.5;
    sh.text(cx, cy + h * 0.46, 'M', h, { a: 'middle' });
  }
  /** Ресивер: горизонтальная «капсула», вход и выход по бокам, слив снизу. */
  static receiver(sh, cx, cy, w = 16, h = 7) {
    sh.rect([cx - w / 2, cy - h / 2, w, h], 'bold', '#fff', h / 2);
    return { inl: [cx - w / 2, cy], out: [cx + w / 2, cy], top: cy - h / 2, bot: [cx, cy + h / 2] };
  }
  static diamond(sh, cx, cy, a) {
    sh.poly(
      [
        [cx - a, cy],
        [cx, cy - a],
        [cx + a, cy],
        [cx, cy + a],
      ],
      'bold',
      '#fff',
    );
  }
  /** Фильтр: drain — 'auto' | 'manual' | '' (без отвода); element=false — влагоотделитель. */
  static filter(sh, [cx, cy], a = 5, drain = 'auto', element = true) {
    this.diamond(sh, cx, cy, a);
    const yc = cy + a * 0.45;
    const half = a * 0.55;
    if (element) sh.line(cx, cy - a, cx, drain ? yc : cy + a, 'dash');
    if (drain) {
      sh.line(cx - half, yc, cx + half, yc, 'bold');
      if (drain === 'auto')
        sh.poly(
          [
            [cx - half * 0.5, yc + 0.35],
            [cx + half * 0.5, yc + 0.35],
            [cx, yc + half * 0.55],
          ],
          'thin',
        );
    }
    return { inl: [cx - a, cy], out: [cx + a, cy], bot: [cx, cy + a] };
  }
  /** Осушитель: ромб с двумя хордами у вершин. */
  static dryer(sh, cx, cy, a = 6) {
    this.diamond(sh, cx, cy, a);
    const d = a * 0.42;
    sh.line(cx - d, cy - a + d, cx + d, cy - a + d, 'bold');
    sh.line(cx - d, cy + a - d, cx + d, cy + a - d, 'bold');
    return { inl: [cx - a, cy], out: [cx + a, cy], bot: [cx, cy + a] };
  }
  /** Генератор азота (кислорода): прямоугольник с обозначением газа. */
  static generator(sh, cx, cy, gas, m = 1) {
    sh.rect([cx - 6 * m, cy - 4.5 * m, 12 * m, 9 * m], 'bold', '#fff');
    sh.text(cx, cy + 1.6, gas || 'N₂', 3.5, { a: 'middle' });
    return { inl: [cx - 6 * m, cy], out: [cx + 6 * m, cy], bot: [cx, cy + 4.5 * m] };
  }
  /** Запорный кран (ГОСТ 2.785-70): два треугольника вершинами друг к другу; vertical — на вертикальной линии. */
  static valve(sh, [cx, cy], s = 2, { vertical, closed } = {}) {
    const P = vertical
      ? [
          [cx - s * 0.6, cy - s],
          [cx + s * 0.6, cy - s],
          [cx - s * 0.6, cy + s],
          [cx + s * 0.6, cy + s],
        ]
      : [
          [cx - s, cy - s * 0.6],
          [cx - s, cy + s * 0.6],
          [cx + s, cy - s * 0.6],
          [cx + s, cy + s * 0.6],
        ];
    sh.poly(P, 'bold', closed ? '#000' : '#fff'); // нормально закрытый — зачернён
  }
  /** Клапан предохранительный угловой (ГОСТ 2.785-70): вход снизу, выход вбок, пружина сверху; выход в атмосферу. */
  static safety(sh, cx, cy, s = 1.8) {
    sh.poly(
      [
        [cx, cy],
        [cx - s * 0.6, cy + s],
        [cx + s * 0.6, cy + s],
      ],
      'bold',
      '#fff',
    );
    sh.poly(
      [
        [cx, cy],
        [cx + s, cy - s * 0.6],
        [cx + s, cy + s * 0.6],
      ],
      'bold',
      '#fff',
    );
    const z = [
      [cx, cy],
      [cx, cy - 0.6],
    ];
    for (let i = 0; i < 4; i++) z.push([cx + (i % 2 ? -0.8 : 0.8), cy - 0.95 - i * 0.5]);
    z.push([cx, cy - 3]);
    sh.poly(z, 'thin', 'none', true);
    sh.line(cx + s, cy, cx + s + 1.2, cy, 'bold');
    this.vent(sh, cx + s + 1.2, cy);
  }
  /** Выпуск в атмосферу (ISO 1219-1): незачернённый треугольник на конце линии. */
  static vent(sh, x, y) {
    sh.poly(
      [
        [x, y - 0.9],
        [x, y + 0.9],
        [x + 1.4, y],
      ],
      'thin',
      '#fff',
    );
  }
  /** Манометр (ГОСТ 2.781-96): окружность со стрелкой. */
  static gauge(sh, cx, cy, r = 1.8) {
    sh.circle(cx, cy, r, 'bold', '#fff');
    sh.line(cx + r * 0.5, cy + r * 0.5, cx - r * 0.45, cy - r * 0.45, 'thin');
    sh.poly(
      [
        [cx - r * 0.62, cy - r * 0.62],
        [cx - r * 0.62 + 0.85, cy - r * 0.62 + 0.3],
        [cx - r * 0.62 + 0.3, cy - r * 0.62 + 0.85],
      ],
      'thin',
      '#000',
    );
  }
  /** Насос (ГОСТ 2.782-96): окружность, зачернённый треугольник (гидравлика) вершиной к выходу — вверх. */
  static pump(sh, cx, cy, r = 5) {
    sh.circle(cx, cy, r, 'bold', '#fff');
    const t = r * 0.6;
    sh.poly(
      [
        [cx, cy - r],
        [cx - t * 0.62, cy - r + t],
        [cx + t * 0.62, cy - r + t],
      ],
      'bold',
      '#000',
    );
    return { out: [cx, cy - r], inl: [cx, cy + r] };
  }
  /** Клапан обратный (ГОСТ 2.785-70). */
  static check(sh, cx, cy, s = 2) {
    sh.poly(
      [
        [cx - s * 0.6, cy + s],
        [cx + s * 0.6, cy + s],
        [cx, cy],
      ],
      'bold',
      '#fff',
    );
    sh.poly(
      [
        [cx - s * 0.6, cy - s],
        [cx + s * 0.6, cy - s],
        [cx, cy],
      ],
      'bold',
      '#000',
    );
  }
  /** Гидробак мембранный (гидроаккумулятор): вертикальная «капсула» с мембраной, подключение сверху. */
  static membrane(sh, cx, top, w = 8, h = 12) {
    sh.rect([cx - w / 2, top, w, h], 'bold', '#fff', w / 2);
    sh.line(cx - w / 2, top + h * 0.45, cx + w / 2, top + h * 0.45, 'thin');
  }
  /** Стрелка направления потока на линии. */
  static flow(sh, x, y, dir = 1) {
    sh.poly(
      [
        [x + dir * 1.1, y],
        [x - dir * 0.9, y - 0.8],
        [x - dir * 0.9, y + 0.8],
      ],
      'thin',
      '#000',
    );
  }
}
