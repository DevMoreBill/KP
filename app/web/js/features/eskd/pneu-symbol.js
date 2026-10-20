/** Условные графические обозначения пневмосхем (ГОСТ 2.780…2.782-96 по ISO 1219-1; арматура — ГОСТ 2.785-70). */
export class PneuSymbol {
  /** Компрессор: окружность, незачернённый треугольник (пневматика) вершиной к выходу — вверх. */
  static compressor(sheet, centerX, centerY, radius = 5) {
    sheet.circle(centerX, centerY, radius, 'bold', '#fff');
    const tri = radius * 0.6;
    sheet.poly(
      [
        [centerX, centerY - radius],
        [centerX - tri * 0.62, centerY - radius + tri],
        [centerX + tri * 0.62, centerY - radius + tri],
      ],
      'bold',
      '#fff',
    );
    return { out: [centerX, centerY - radius], inl: [centerX, centerY + radius], shaft: [centerX - radius, centerY] };
  }
  /** Электродвигатель привода: окружность с буквой M, вал — двойная линия. */
  static motor(sheet, centerX, centerY, x2, radius = 3.4) {
    sheet.line(centerX + radius, centerY - 0.55, x2, centerY - 0.55, 'bold');
    sheet.line(centerX + radius, centerY + 0.55, x2, centerY + 0.55, 'bold');
    sheet.circle(centerX, centerY, radius, 'bold', '#fff');
    const textH = radius < 3 ? 2.5 : 3.5;
    sheet.text(centerX, centerY + textH * 0.46, 'M', textH, { a: 'middle' });
  }
  /** Ресивер: горизонтальная «капсула», вход и выход по бокам, слив снизу. */
  static receiver(sheet, centerX, centerY, width = 16, height = 7) {
    sheet.rect([centerX - width / 2, centerY - height / 2, width, height], 'bold', '#fff', height / 2);
    return {
      inl: [centerX - width / 2, centerY],
      out: [centerX + width / 2, centerY],
      top: centerY - height / 2,
      bot: [centerX, centerY + height / 2],
    };
  }
  static _diamond(sheet, centerX, centerY, half) {
    sheet.poly(
      [
        [centerX - half, centerY],
        [centerX, centerY - half],
        [centerX + half, centerY],
        [centerX, centerY + half],
      ],
      'bold',
      '#fff',
    );
  }
  /** Фильтр: drain — 'auto' | 'manual' | '' (без отвода); element=false — влагоотделитель. */
  static filter(sheet, [centerX, centerY], halfSize = 5, drain = 'auto', element = true) {
    this._diamond(sheet, centerX, centerY, halfSize);
    const drainY = centerY + halfSize * 0.45;
    const half = halfSize * 0.55;
    if (element) sheet.line(centerX, centerY - halfSize, centerX, drain ? drainY : centerY + halfSize, 'dash');
    if (drain) {
      sheet.line(centerX - half, drainY, centerX + half, drainY, 'bold');
      if (drain === 'auto')
        sheet.poly(
          [
            [centerX - half * 0.5, drainY + 0.35],
            [centerX + half * 0.5, drainY + 0.35],
            [centerX, drainY + half * 0.55],
          ],
          'thin',
        );
    }
    return {
      inl: [centerX - halfSize, centerY],
      out: [centerX + halfSize, centerY],
      bot: [centerX, centerY + halfSize],
    };
  }
  /** Осушитель: ромб с двумя хордами у вершин. */
  static dryer(sheet, centerX, centerY, half = 6) {
    this._diamond(sheet, centerX, centerY, half);
    const inset = half * 0.42;
    sheet.line(centerX - inset, centerY - half + inset, centerX + inset, centerY - half + inset, 'bold');
    sheet.line(centerX - inset, centerY + half - inset, centerX + inset, centerY + half - inset, 'bold');
    return { inl: [centerX - half, centerY], out: [centerX + half, centerY], bot: [centerX, centerY + half] };
  }
  /** Генератор азота (кислорода): прямоугольник с обозначением газа. */
  static generator(sheet, centerX, centerY, gas, scale = 1) {
    sheet.rect([centerX - 6 * scale, centerY - 4.5 * scale, 12 * scale, 9 * scale], 'bold', '#fff');
    sheet.text(centerX, centerY + 1.6, gas || 'N₂', 3.5, { a: 'middle' });
    return {
      inl: [centerX - 6 * scale, centerY],
      out: [centerX + 6 * scale, centerY],
      bot: [centerX, centerY + 4.5 * scale],
    };
  }
  /** Запорный кран (ГОСТ 2.785-70): два треугольника вершинами друг к другу; vertical — на вертикальной линии. */
  static valve(sheet, [centerX, centerY], size = 2, { vertical, closed } = {}) {
    const points = vertical
      ? [
          [centerX - size * 0.6, centerY - size],
          [centerX + size * 0.6, centerY - size],
          [centerX - size * 0.6, centerY + size],
          [centerX + size * 0.6, centerY + size],
        ]
      : [
          [centerX - size, centerY - size * 0.6],
          [centerX - size, centerY + size * 0.6],
          [centerX + size, centerY - size * 0.6],
          [centerX + size, centerY + size * 0.6],
        ];
    sheet.poly(points, 'bold', closed ? '#000' : '#fff'); // нормально закрытый — зачернён
  }
  /** Клапан предохранительный угловой (ГОСТ 2.785-70): вход снизу, выход вбок, пружина сверху; выход в атмосферу. */
  static safety(sheet, centerX, centerY, size = 1.8) {
    sheet.poly(
      [
        [centerX, centerY],
        [centerX - size * 0.6, centerY + size],
        [centerX + size * 0.6, centerY + size],
      ],
      'bold',
      '#fff',
    );
    sheet.poly(
      [
        [centerX, centerY],
        [centerX + size, centerY - size * 0.6],
        [centerX + size, centerY + size * 0.6],
      ],
      'bold',
      '#fff',
    );
    const z = [
      [centerX, centerY],
      [centerX, centerY - 0.6],
    ];
    for (let i = 0; i < 4; i++) z.push([centerX + (i % 2 ? -0.8 : 0.8), centerY - 0.95 - i * 0.5]);
    z.push([centerX, centerY - 3]);
    sheet.poly(z, 'thin', 'none', true);
    sheet.line(centerX + size, centerY, centerX + size + 1.2, centerY, 'bold');
    this.vent(sheet, centerX + size + 1.2, centerY);
  }
  /** Выпуск в атмосферу (ISO 1219-1): незачернённый треугольник на конце линии. */
  static vent(sheet, x, y) {
    sheet.poly(
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
  static gauge(sheet, centerX, centerY, radius = 1.8) {
    sheet.circle(centerX, centerY, radius, 'bold', '#fff');
    sheet.line(
      centerX + radius * 0.5,
      centerY + radius * 0.5,
      centerX - radius * 0.45,
      centerY - radius * 0.45,
      'thin',
    );
    sheet.poly(
      [
        [centerX - radius * 0.62, centerY - radius * 0.62],
        [centerX - radius * 0.62 + 0.85, centerY - radius * 0.62 + 0.3],
        [centerX - radius * 0.62 + 0.3, centerY - radius * 0.62 + 0.85],
      ],
      'thin',
      '#000',
    );
  }
  /** Насос (ГОСТ 2.782-96): окружность, зачернённый треугольник (гидравлика) вершиной к выходу — вверх. */
  static pump(sheet, centerX, centerY, radius = 5) {
    sheet.circle(centerX, centerY, radius, 'bold', '#fff');
    const tri = radius * 0.6;
    sheet.poly(
      [
        [centerX, centerY - radius],
        [centerX - tri * 0.62, centerY - radius + tri],
        [centerX + tri * 0.62, centerY - radius + tri],
      ],
      'bold',
      '#000',
    );
    return { out: [centerX, centerY - radius], inl: [centerX, centerY + radius] };
  }
  /** Клапан обратный (ГОСТ 2.785-70). */
  static check(sheet, centerX, centerY, size = 2) {
    sheet.poly(
      [
        [centerX - size * 0.6, centerY + size],
        [centerX + size * 0.6, centerY + size],
        [centerX, centerY],
      ],
      'bold',
      '#fff',
    );
    sheet.poly(
      [
        [centerX - size * 0.6, centerY - size],
        [centerX + size * 0.6, centerY - size],
        [centerX, centerY],
      ],
      'bold',
      '#000',
    );
  }
  /** Гидробак мембранный (гидроаккумулятор): вертикальная «капсула» с мембраной, подключение сверху. */
  static membrane(sheet, centerX, top, width = 8, height = 12) {
    sheet.rect([centerX - width / 2, top, width, height], 'bold', '#fff', width / 2);
    sheet.line(centerX - width / 2, top + height * 0.45, centerX + width / 2, top + height * 0.45, 'thin');
  }
  /** Стрелка направления потока на линии. */
  static flow(sheet, x, y, dir = 1) {
    sheet.poly(
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
