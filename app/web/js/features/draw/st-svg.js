export class StSvg {
  static f(v) {
    return Math.round(v * 10) / 10;
  }
  static pts(P) {
    return P.map(p => `${this.f(p[0])},${this.f(p[1])}`).join(' ');
  }
  static poly(P, fill, stroke, sw = 1, extra = '') {
    return `<polygon points="${this.pts(P)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}${extra}/>`;
  }
  static line([x1, y1], [x2, y2], stroke, sw = 1, extra = '') {
    return `<line x1="${this.f(x1)}" y1="${this.f(y1)}" x2="${this.f(x2)}" y2="${this.f(y2)}" stroke="${stroke}" stroke-width="${sw}"${extra}/>`;
  }
  static rect([x, y, w, h], fill, stroke, sw = 1, extra = '') {
    return `<rect x="${this.f(x)}" y="${this.f(y)}" width="${this.f(Math.max(0, w))}" height="${this.f(Math.max(0, h))}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${extra}/>`;
  }
  static doc(W, H, body, defs = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif"><defs>${defs}</defs>${body}</svg>`;
  }
}
