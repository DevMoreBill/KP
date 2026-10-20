export class StSvg {
  /** Число для SVG: до 0,1. */
  static fmt(value) {
    return Math.round(value * 10) / 10;
  }
  /** Точки многоугольника для атрибута points. */
  static points(points) {
    return points.map(point => `${this.fmt(point[0])},${this.fmt(point[1])}`).join(' ');
  }
  /** Многоугольник. */
  static poly(points, fill, stroke, strokeW = 1, extra = '') {
    return `<polygon points="${this.points(points)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round"` : ''}${extra}/>`;
  }
  /** Отрезок. */
  static line([x1, y1], [x2, y2], stroke, strokeW = 1, extra = '') {
    return `<line x1="${this.fmt(x1)}" y1="${this.fmt(y1)}" x2="${this.fmt(x2)}" y2="${this.fmt(y2)}" stroke="${stroke}" stroke-width="${strokeW}"${extra}/>`;
  }
  /** Прямоугольник. */
  static rect([x, y, width, height], fill, stroke, strokeW = 1, extra = '') {
    return `<rect x="${this.fmt(x)}" y="${this.fmt(y)}" width="${this.fmt(Math.max(0, width))}" height="${this.fmt(Math.max(0, height))}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeW}"` : ''}${extra}/>`;
  }
  /** Документ SVG. */
  static doc(width, height, body, defs = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif"><defs>${defs}</defs>${body}</svg>`;
  }
}
