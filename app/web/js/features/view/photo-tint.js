const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const sat = c => {
  const mx = Math.max(...c);
  return mx ? (mx - Math.min(...c)) / mx : 0;
};
const hex2 = v => Math.round(v).toString(16).padStart(2, '0');
const toHex = rgb => `#${rgb.map(hex2).join('')}`;

/**
 * Зоны другой окраски на фото изделия: палитра до трёх заметных цветов кроме главного; вертикальные полосы и пояса во
 * всю высоту/ширину, иначе сплошные участки сетки GRID × GRID; пёстрое (решётки, таблички) — не окраска.
 */
class TintZones {
  constructor(d, w, h, bg) {
    Object.assign(this, { d, w, h, bg });
  }

  /** Отличие от главного: цветное — от 90; серое от серого — от 200 (иначе это свет и тень граней, а не краска). */
  static far(c, main) {
    return dist(c, main) > (sat(c) < 0.25 && sat(main) < 0.25 ? 200 : 90);
  }

  /** Светлый и тёмный оттенки одной краски — вместе; заметные: насыщенный — от 3 %, серый — от 6 %, тёмный — от 15 %. */
  static palette(main) {
    const grp = [];
    for (const b of main.bins.filter(q => q.key !== main.key && TintZones.far(q.rgb, main.rgb))) {
      const p = grp.find(q => dist(q.rgb, b.rgb) < 100);
      if (p) {
        p.rgb = p.rgb.map((v, k) => (v * p.w + b.rgb[k] * b.w) / (p.w + b.w));
        p.w += b.w;
        p.dark = p.dark && b.key === 'd';
      } else {
        grp.push({ rgb: b.rgb.slice(), w: b.w, dark: b.key === 'd' });
      }
    }
    const min = p => {
      if (p.dark) return 0.15;
      return sat(p.rgb) >= 0.35 ? 0.03 : 0.06;
    };
    return grp
      .filter(p => TintZones.far(p.rgb, main.rgb) && p.w >= min(p))
      .sort((a, b) => b.w - a.w)
      .slice(0, 3);
  }

  /** Очертание изделия и метки: каждая точка — к ближайшему цвету палитры (дальше 110 — к главному). */
  scan(main, pal) {
    const { d, w, h, bg } = this;
    let [bx0, bx1, by0, by1] = [w, -1, h, -1];
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      [bx0, bx1, by0, by1] = [Math.min(bx0, x), Math.max(bx1, x), Math.min(by0, y), Math.max(by1, y)];
    }
    Object.assign(this, { bx0, bx1, by0, by1, BW: bx1 - bx0 + 1, BH: by1 - by0 + 1 });
    const all = [main.rgb, ...pal.map(p => p.rgb)];
    this.lab = new Int8Array(w * h).fill(-1);
    for (let i = 0; i < w * h; i++) {
      if (!bg[i]) this.lab[i] = TintZones.nearest([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], all);
    }
  }

  static nearest(c, all) {
    let k = 0;
    let m = 1e9;
    all.forEach((q, j) => {
      const e = dist(c, q);
      if (e < m) [m, k] = [e, j];
    });
    return k && m < 110 ? k : 0;
  }

  /** Доля точек цвета k в прямоугольнике (без фона). */
  share(k, [x0, x1], [y0, y1]) {
    let n = 0;
    let f = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * this.w + x;
        f += this.bg[i] ? 0 : 1;
        n += !this.bg[i] && this.lab[i] === k ? 1 : 0;
      }
    }
    return f ? n / f : 0;
  }

  /** Пестрота: средняя разница с соседом справа и снизу (решётка, жалюзи, табличка — пёстрые). */
  tex([x0, x1], [y0, y1]) {
    const { d, w, bg } = this;
    const dif = (i, j) =>
      Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2]);
    let t = 0;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const right = !bg[i] && x < x1 && !bg[i + 1];
        const down = !bg[i] && y < y1 && !bg[i + w];
        t += (right ? dif(i, i + 1) : 0) + (down ? dif(i, i + w) : 0);
        n += Number(right) + Number(down);
      }
    }
    return n ? t / n : 0;
  }

  /** Отрезки подряд идущих i, где ok(i); разрывы до gap (надписи, логотип на полосе) не делят отрезок. */
  static runs(n, ok, min, gap) {
    const R = [];
    for (let i = 0; i < n; i++) {
      const L = R[R.length - 1];
      if (!ok(i)) continue;
      if (L && i - L[1] - 1 <= gap) L[1] = i;
      else R.push([i, i]);
    }
    return R.filter(r => r[1] - r[0] + 1 >= min);
  }

  static span(n, ok) {
    const R = TintZones.runs(n, ok, 1, Math.round(n * 0.25));
    return R.length ? R.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m)) : null;
  }

  /** Зоны цвета палитры: вертикальные полосы и пояса; нет их — участки сетки. */
  zones(pal, grid, texLimit) {
    const out = [];
    pal.forEach((col, j) => {
      const k = j + 1;
      const tl = sat(col.rgb) >= 0.35 ? texLimit * 2 : texLimit;
      const before = out.length;
      out.push(...this.stripes(k, col, tl), ...this.belts(k, col, tl));
      if (out.length === before) out.push(...this.cells(k, col, tl, grid));
    });
    return out;
  }

  stripes(k, col, tl) {
    const { bx0, by0, by1, BW, BH } = this;
    const out = [];
    for (const [xa, xb] of TintZones.runs(
      BW,
      x => this.share(k, [bx0 + x, bx0 + x], [by0, by1]) >= 0.3,
      Math.max(2, Math.round(BW * 0.03)),
      Math.round(BW * 0.02),
    )) {
      const r = TintZones.span(BH, y => this.share(k, [bx0 + xa, bx0 + xb], [by0 + y, by0 + y]) >= 0.5);
      if (r && r[1] - r[0] + 1 >= BH * 0.3 && this.tex([bx0 + xa, bx0 + xb], [by0 + r[0], by0 + r[1]]) <= tl)
        out.push({ x0: xa, x1: xb, y0: r[0], y1: r[1], col });
    }
    return out;
  }

  belts(k, col, tl) {
    const { bx0, bx1, by0, BW, BH } = this;
    const out = [];
    for (const [ya, yb] of TintZones.runs(
      BH,
      y => this.share(k, [bx0, bx1], [by0 + y, by0 + y]) >= 0.3,
      Math.max(2, Math.round(BH * 0.04)),
      Math.round(BH * 0.02),
    )) {
      const r = TintZones.span(BW, x => this.share(k, [bx0 + x, bx0 + x], [by0 + ya, by0 + yb]) >= 0.5);
      if (r && r[1] - r[0] + 1 >= BW * 0.3 && this.tex([bx0 + r[0], bx0 + r[1]], [by0 + ya, by0 + yb]) <= tl)
        out.push({ x0: r[0], x1: r[1], y0: ya, y1: yb, col });
    }
    return out;
  }

  /** Сплошные участки сетки G × G: от трёх клеток, у верха и низа — от двух. */
  cells(k, col, tl, G) {
    const { bx0, by0, BW, BH } = this;
    const X = i => Math.floor((BW * i) / G);
    const Y = i => Math.floor((BH * i) / G);
    const cell = Array.from({ length: G }, (_, r) =>
      Array.from({ length: G }, (__, c) => {
        const xs = [bx0 + X(c), bx0 + X(c + 1) - 1];
        const ys = [by0 + Y(r), by0 + Y(r + 1) - 1];
        return xs[1] >= xs[0] && ys[1] >= ys[0] && this.share(k, xs, ys) >= 0.6 && this.tex(xs, ys) <= tl;
      }),
    );
    const blk = TintZones.blocks(cell, G);
    return blk
      .filter(b => (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) >= (b.r0 === 0 || b.r1 === G - 1 ? 2 : 3))
      .map(b => ({ x0: X(b.c0), x1: X(b.c1 + 1) - 1, y0: Y(b.r0), y1: Y(b.r1 + 1) - 1, col }));
  }

  /** Прямоугольники из клеток: отрезок строки продолжает блок той же ширины из строки выше. */
  static blocks(cell, G) {
    const blk = [];
    for (let r = 0; r < G; r++) {
      for (let c = 0; c < G; c++) {
        if (!cell[r][c]) continue;
        let c1 = c;
        while (c1 + 1 < G && cell[r][c1 + 1]) c1++;
        const b = blk.find(q => q.c0 === c && q.c1 === c1 && q.r1 === r - 1);
        if (b) b.r1 = r;
        else blk.push({ r0: r, r1: r, c0: c, c1 });
        for (let q = c; q <= c1; q++) cell[r][q] = false;
      }
    }
    return blk;
  }

  /** Одна краска по соседству (пояс, разорванный решёткой или надписью) — одна зона. */
  merge(out) {
    const tx = Math.max(1, this.BW * 0.04);
    const ty = Math.max(1, this.BH * 0.04);
    const near = (a, b) =>
      a.col === b.col &&
      ((Math.abs(a.x0 - b.x0) <= tx && Math.abs(a.x1 - b.x1) <= tx && a.y0 <= b.y1 + ty && b.y0 <= a.y1 + ty) ||
        (Math.abs(a.y0 - b.y0) <= ty && Math.abs(a.y1 - b.y1) <= ty && a.x0 <= b.x1 + tx && b.x0 <= a.x1 + tx));
    for (let i = 0; i < out.length; i++) {
      for (let j = out.length - 1; j > i; j--) {
        const [a, b] = [out[i], out[j]];
        if (!near(a, b)) continue;
        Object.assign(a, {
          x0: Math.min(a.x0, b.x0),
          x1: Math.max(a.x1, b.x1),
          y0: Math.min(a.y0, b.y0),
          y1: Math.max(a.y1, b.y1),
        });
        out.splice(j, 1);
        j = out.length;
      }
    }
    return out;
  }

  /** Доли очертания изделия: u — слева направо, v — снизу вверх; у края (6 %) — до края; до 10 крупнейших. */
  result(out) {
    const { BW, BH } = this;
    const lo = v => (v < 0.06 ? 0 : Math.round(v * 1000) / 1000);
    const hi = v => (v > 0.94 ? 1 : Math.round(v * 1000) / 1000);
    return out
      .sort((a, b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) - (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1))
      .slice(0, 10)
      .map(z => ({
        u0: lo(z.x0 / BW),
        u1: hi((z.x1 + 1) / BW),
        v0: lo(1 - (z.y1 + 1) / BH),
        v1: hi(1 - z.y0 / BH),
        hex: toHex(z.col.rgb),
      }));
  }
}

/** Цвет оборудования по главному фото (без фона; насыщенное и в центре — весомее) и зоны других цветов — для 3D. */
export class PhotoTint {
  static cache = new Map();
  static zones = new Map();
  static GRID = 8;
  static TEX = 50;
  static SIDE = 128;

  static src(p) {
    return String((p && p.photo && p.photo.src) || '');
  }

  static get(src) {
    return PhotoTint.cache.get(src);
  }

  static tones(src) {
    return PhotoTint.zones.get(src) || [];
  }

  /** У элементов станции есть фото, цвет которых ещё не определён. */
  static pending(x) {
    return kitParts(x).some(p => {
      const s = PhotoTint.src(p);
      return s && !PhotoTint.cache.has(s);
    });
  }

  /** Определить цвета фото элементов станции (по одному разу на адрес); true — что-то определено. */
  static async load(x) {
    let ch = false;
    for (const p of kitParts(x)) {
      const s = PhotoTint.src(p);
      if (!s || PhotoTint.cache.has(s)) continue;
      try {
        const r = PhotoTint.of(await readImg(s));
        PhotoTint.cache.set(s, r.hex);
        if (r.zones.length) PhotoTint.zones.set(s, r.zones);
      } catch {
        PhotoTint.cache.set(s, '');
      }
      ch = true;
    }
    return ch;
  }

  /** Картинка → {hex, zones} (уменьшается до SIDE точек по большей стороне); чужой сайт без разрешения — ''. */
  static of(im) {
    const iw = im.naturalWidth || im.width;
    const ih = im.naturalHeight || im.height;
    if (!iw || !ih) return { hex: '', zones: [] };
    const k = Math.min(1, PhotoTint.SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, w, h);
    try {
      return PhotoTint.parts(g.getImageData(0, 0, w, h).data, w, h);
    } catch {
      return { hex: '', zones: [] };
    }
  }

  static pick(d, w, h) {
    return PhotoTint.parts(d, w, h).hex;
  }

  /** Цвета по пикселям RGBA: фон — заливкой от краёв; главный — по корзинам цвета; зоны — части другой окраски. */
  static parts(d, w, h) {
    const bg = PhotoTint._bg(d, w, h);
    const main = PhotoTint._dom(d, w, h, bg);
    return main ? { hex: main.hex, zones: PhotoTint._zones(d, w, h, bg, main) } : { hex: '', zones: [] };
  }

  static _zones(d, w, h, bg, main) {
    const pal = TintZones.palette(main);
    if (!pal.length) return [];
    const Z = new TintZones(d, w, h, bg);
    Z.scan(main, pal);
    return Z.result(Z.merge(Z.zones(pal, PhotoTint.GRID, PhotoTint.TEX)));
  }

  /** Маска фона: заливка от краёв цветом, близким к краевому (медиана), и прозрачное. */
  static _bg(d, w, h) {
    const bg = new Uint8Array(w * h);
    const px = i => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const edge = PhotoTint.edge(w, h);
    const ec = edge.filter(i => d[i * 4 + 3] >= 128).map(px);
    const med = k => ec.map(c => c[k]).sort((a, b) => a - b)[ec.length >> 1];
    const M = ec.length ? [med(0), med(1), med(2)] : null;
    const isBg = i => d[i * 4 + 3] < 128 || (M && dist(px(i), M) <= 60);
    const q = edge.filter(isBg);
    for (const i of q) bg[i] = 1;
    while (q.length) {
      const i = q.pop();
      for (const j of PhotoTint.around(i, w, h).filter(k => !bg[k] && isBg(k))) {
        bg[j] = 1;
        q.push(j);
      }
    }
    return bg;
  }

  static edge(w, h) {
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    return edge;
  }

  /** Соседи точки слева, справа, сверху, снизу. */
  static around(i, w, h) {
    const x = i % w;
    const y = (i - x) / w;
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1].filter(j => j >= 0);
  }

  /** Корзина цвета точки: тёмные отдельно; серые — по яркости; цветные — тон × яркость; насыщенные весомее. */
  static bin(r, g, b) {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const v = mx / 255;
    const s = mx ? (mx - mn) / mx : 0;
    if (v < 0.16) return ['d', 0.45];
    if (s < 0.18) return [`g${Math.min(5, Math.floor(v * 6))}`, 0.9];
    let hh = (r - g) / (mx - mn) + 4;
    if (mx === r) hh = ((g - b) / (mx - mn) + 6) % 6;
    else if (mx === g) hh = (b - r) / (mx - mn) + 2;
    return [`h${Math.floor(hh * 3)}${v < 0.55 ? 'd' : 'l'}`, 1.15 + 0.6 * s];
  }

  /** Главный цвет кадра (без фона): {hex, rgb, key, fg, bins}; ближе к центру — весомее; фона больше 96 % — null. */
  static _dom(d, w, h, bg) {
    const bins = new Map();
    let fg = 0;
    let all = 0;
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      fg++;
      const x = i % w;
      const y = (i - x) / w;
      const [r, g, b] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
      const [key, wt] = PhotoTint.bin(r, g, b);
      const W8 = wt * (1 - 0.6 * Math.min(1, Math.hypot((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5) / 0.7071));
      const e = bins.get(key) || { w: 0, r: 0, g: 0, b: 0 };
      Object.assign(e, { w: e.w + W8, r: e.r + r * W8, g: e.g + g * W8, b: e.b + b * W8 });
      bins.set(key, e);
      all += W8;
    }
    if (fg < w * h * 0.04 || !all) return null;
    const L = [...bins.entries()].sort((a, b) => b[1].w - a[1].w);
    const [key, best] = L[0][0] === 'd' && L[0][1].w < all * 0.5 && L[1] ? L[1] : L[0];
    const rgb = [best.r, best.g, best.b].map(v => v / best.w);
    return {
      hex: toHex(rgb),
      rgb,
      key,
      fg,
      bins: L.map(([k, e]) => ({ key: k, w: e.w / all, rgb: [e.r / e.w, e.g / e.w, e.b / e.w] })),
    };
  }
}
