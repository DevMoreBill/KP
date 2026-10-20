/** Цвета RGB: расстояние, насыщенность, запись #rrggbb. */
class Rgb {
  /** Расстояние между цветами (сумма разностей каналов). */
  static dist(first, second) {
    return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) + Math.abs(first[2] - second[2]);
  }

  /** Насыщенность 0…1. */
  static sat(rgb) {
    const max = Math.max(...rgb);
    return max ? (max - Math.min(...rgb)) / max : 0;
  }

  /** Цвет #rrggbb. */
  static hex(rgb) {
    return `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  }
}

/**
 * Зоны другой окраски на фото изделия: палитра до трёх заметных цветов кроме главного; вертикальные полосы и пояса во
 * всю высоту/ширину, иначе сплошные участки сетки GRID × GRID; пёстрое (решётки, таблички) — не окраска.
 */
class TintZones {
  constructor(data, width, height, mask) {
    Object.assign(this, { data, width, height, mask });
  }

  /** Отличие от главного: цветное — от 90; серое от серого — от 200 (иначе это свет и тень граней, а не краска). */
  static far(rgb, main) {
    return Rgb.dist(rgb, main) > (Rgb.sat(rgb) < 0.25 && Rgb.sat(main) < 0.25 ? 200 : 90);
  }

  /** Светлый и тёмный оттенки одной краски — вместе; заметные: насыщенный — от 3 %, серый — от 6 %, тёмный — от 15 %. */
  static palette(main) {
    const grp = [];
    for (const bin of main.bins.filter(cand => cand.key !== main.key && TintZones.far(cand.rgb, main.rgb))) {
      const group = grp.find(cand => Rgb.dist(cand.rgb, bin.rgb) < 100);
      if (group) {
        group.rgb = group.rgb.map((v, k) => (v * group.w + bin.rgb[k] * bin.w) / (group.w + bin.w));
        group.w += bin.w;
        group.dark = group.dark && bin.key === 'd';
      } else {
        grp.push({ rgb: bin.rgb.slice(), w: bin.w, dark: bin.key === 'd' });
      }
    }
    const min = group => {
      if (group.dark) return 0.15;
      return Rgb.sat(group.rgb) >= 0.35 ? 0.03 : 0.06;
    };
    return grp
      .filter(group => TintZones.far(group.rgb, main.rgb) && group.w >= min(group))
      .sort((first, bin) => bin.w - first.w)
      .slice(0, 3);
  }

  /** Очертание изделия и метки: каждая точка — к ближайшему цвету палитры (дальше 110 — к главному). */
  scan(main, pal) {
    const { data: data, width: width, height: height, mask: mask } = this;
    let [bx0, bx1, by0, by1] = [width, -1, height, -1];
    for (let i = 0; i < width * height; i++) {
      if (mask[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      [bx0, bx1, by0, by1] = [Math.min(bx0, x), Math.max(bx1, x), Math.min(by0, y), Math.max(by1, y)];
    }
    Object.assign(this, { bx0, bx1, by0, by1, boxW: bx1 - bx0 + 1, boxH: by1 - by0 + 1 });
    const all = [main.rgb, ...pal.map(group => group.rgb)];
    this.lab = new Int8Array(width * height).fill(-1);
    for (let i = 0; i < width * height; i++) {
      if (!mask[i]) this.lab[i] = TintZones.nearest([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], all);
    }
  }

  /** Номер ближайшего цвета палитры (дальше 110 — главный). */
  static nearest(rgb, all) {
    let k = 0;
    let best = 1e9;
    all.forEach((cand, j) => {
      const diff = Rgb.dist(rgb, cand);
      if (diff < best) [best, k] = [diff, j];
    });
    return k && best < 110 ? k : 0;
  }

  /** Доля точек цвета k в прямоугольнике (без фона). */
  share(k, [x0, x1], [y0, y1]) {
    let count = 0;
    let filled = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * this.width + x;
        filled += this.mask[i] ? 0 : 1;
        count += !this.mask[i] && this.lab[i] === k ? 1 : 0;
      }
    }
    return filled ? count / filled : 0;
  }

  /** Пестрота: средняя разница с соседом справа и снизу (решётка, жалюзи, табличка — пёстрые). */
  tex([x0, x1], [y0, y1]) {
    const { data: data, width: width, mask: mask } = this;
    const dif = (i, j) =>
      Math.abs(data[i * 4] - data[j * 4]) +
      Math.abs(data[i * 4 + 1] - data[j * 4 + 1]) +
      Math.abs(data[i * 4 + 2] - data[j * 4 + 2]);
    let diffs = 0;
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        const right = !mask[i] && x < x1 && !mask[i + 1];
        const down = !mask[i] && y < y1 && !mask[i + width];
        diffs += (right ? dif(i, i + 1) : 0) + (down ? dif(i, i + width) : 0);
        count += Number(right) + Number(down);
      }
    }
    return count ? diffs / count : 0;
  }

  /** Отрезки подряд идущих i, где ok(i); разрывы до gap (надписи, логотип на полосе) не делят отрезок. */
  static runs(count, ok, min, gap) {
    const runs = [];
    for (let i = 0; i < count; i++) {
      const last = runs[runs.length - 1];
      if (!ok(i)) continue;
      if (last && i - last[1] - 1 <= gap) last[1] = i;
      else runs.push([i, i]);
    }
    return runs.filter(run => run[1] - run[0] + 1 >= min);
  }

  /** Самый длинный отрезок, где ok. */
  static span(count, ok) {
    const runs = TintZones.runs(count, ok, 1, Math.round(count * 0.25));
    return runs.length ? runs.reduce((best, run) => (run[1] - run[0] > best[1] - best[0] ? run : best)) : null;
  }

  /** Зоны цвета палитры: вертикальные полосы и пояса; нет их — участки сетки. */
  zones(pal, grid, texLimit) {
    const out = [];
    pal.forEach((col, j) => {
      const k = j + 1;
      const limit = Rgb.sat(col.rgb) >= 0.35 ? texLimit * 2 : texLimit;
      const before = out.length;
      out.push(...this.stripes(k, col, limit), ...this.belts(k, col, limit));
      if (out.length === before) out.push(...this.cells(k, col, limit, grid));
    });
    return out;
  }

  /** Вертикальные полосы цвета k во всю высоту. */
  stripes(k, col, texLimit) {
    const { bx0, by0, by1, boxW: boxW, boxH: boxH } = this;
    const out = [];
    for (const [fromX, tillX] of TintZones.runs(
      boxW,
      x => this.share(k, [bx0 + x, bx0 + x], [by0, by1]) >= 0.3,
      Math.max(2, Math.round(boxW * 0.03)),
      Math.round(boxW * 0.02),
    )) {
      const run = TintZones.span(boxH, y => this.share(k, [bx0 + fromX, bx0 + tillX], [by0 + y, by0 + y]) >= 0.5);
      if (
        run &&
        run[1] - run[0] + 1 >= boxH * 0.3 &&
        this.tex([bx0 + fromX, bx0 + tillX], [by0 + run[0], by0 + run[1]]) <= texLimit
      )
        out.push({ x0: fromX, x1: tillX, y0: run[0], y1: run[1], col });
    }
    return out;
  }

  /** Пояса цвета k во всю ширину. */
  belts(k, col, texLimit) {
    const { bx0, bx1, by0, boxW: boxW, boxH: boxH } = this;
    const out = [];
    for (const [fromY, tillY] of TintZones.runs(
      boxH,
      y => this.share(k, [bx0, bx1], [by0 + y, by0 + y]) >= 0.3,
      Math.max(2, Math.round(boxH * 0.04)),
      Math.round(boxH * 0.02),
    )) {
      const run = TintZones.span(boxW, x => this.share(k, [bx0 + x, bx0 + x], [by0 + fromY, by0 + tillY]) >= 0.5);
      if (
        run &&
        run[1] - run[0] + 1 >= boxW * 0.3 &&
        this.tex([bx0 + run[0], bx0 + run[1]], [by0 + fromY, by0 + tillY]) <= texLimit
      )
        out.push({ x0: run[0], x1: run[1], y0: fromY, y1: tillY, col });
    }
    return out;
  }

  /** Сплошные участки сетки G × G: от трёх клеток, у верха и низа — от двух. */
  cells(k, col, texLimit, grid) {
    const { bx0, by0, boxW: boxW, boxH: boxH } = this;
    const cellX = i => Math.floor((boxW * i) / grid);
    const cellY = i => Math.floor((boxH * i) / grid);
    const cell = Array.from({ length: grid }, (_, row) =>
      Array.from({ length: grid }, (_unused, column) => {
        const spanX = [bx0 + cellX(column), bx0 + cellX(column + 1) - 1];
        const spanY = [by0 + cellY(row), by0 + cellY(row + 1) - 1];
        return (
          spanX[1] >= spanX[0] &&
          spanY[1] >= spanY[0] &&
          this.share(k, spanX, spanY) >= 0.6 &&
          this.tex(spanX, spanY) <= texLimit
        );
      }),
    );
    const blk = TintZones.blocks(cell, grid);
    return blk
      .filter(
        block =>
          (block.r1 - block.r0 + 1) * (block.c1 - block.c0 + 1) >= (block.r0 === 0 || block.r1 === grid - 1 ? 2 : 3),
      )
      .map(block => ({
        x0: cellX(block.c0),
        x1: cellX(block.c1 + 1) - 1,
        y0: cellY(block.r0),
        y1: cellY(block.r1 + 1) - 1,
        col,
      }));
  }

  /** Прямоугольники из клеток: отрезок строки продолжает блок той же ширины из строки выше. */
  static blocks(cell, grid) {
    const blk = [];
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        if (!cell[row][col]) continue;
        let colEnd = col;
        while (colEnd + 1 < grid && cell[row][colEnd + 1]) colEnd++;
        const open = blk.find(cand => cand.c0 === col && cand.c1 === colEnd && cand.r1 === row - 1);
        if (open) open.r1 = row;
        else blk.push({ r0: row, r1: row, c0: col, c1: colEnd });
        for (let cand = col; cand <= colEnd; cand++) cell[row][cand] = false;
      }
    }
    return blk;
  }

  /** Одна краска по соседству (пояс, разорванный решёткой или надписью) — одна зона. */
  merge(out) {
    const tolX = Math.max(1, this.boxW * 0.04);
    const tolY = Math.max(1, this.boxH * 0.04);
    const near = (first, second) =>
      first.col === second.col &&
      ((Math.abs(first.x0 - second.x0) <= tolX &&
        Math.abs(first.x1 - second.x1) <= tolX &&
        first.y0 <= second.y1 + tolY &&
        second.y0 <= first.y1 + tolY) ||
        (Math.abs(first.y0 - second.y0) <= tolY &&
          Math.abs(first.y1 - second.y1) <= tolY &&
          first.x0 <= second.x1 + tolX &&
          second.x0 <= first.x1 + tolX));
    for (let i = 0; i < out.length; i++) {
      for (let j = out.length - 1; j > i; j--) {
        const [first, second] = [out[i], out[j]];
        if (!near(first, second)) continue;
        Object.assign(first, {
          x0: Math.min(first.x0, second.x0),
          x1: Math.max(first.x1, second.x1),
          y0: Math.min(first.y0, second.y0),
          y1: Math.max(first.y1, second.y1),
        });
        out.splice(j, 1);
        j = out.length;
      }
    }
    return out;
  }

  /** Доли очертания изделия: u — слева направо, v — снизу вверх; у края (6 %) — до края; до 10 крупнейших. */
  result(out) {
    const { boxW: boxW, boxH: boxH } = this;
    const snapLow = v => (v < 0.06 ? 0 : Math.round(v * 1000) / 1000);
    const snapHigh = v => (v > 0.94 ? 1 : Math.round(v * 1000) / 1000);
    return out
      .sort(
        (first, second) =>
          (second.x1 - second.x0 + 1) * (second.y1 - second.y0 + 1) -
          (first.x1 - first.x0 + 1) * (first.y1 - first.y0 + 1),
      )
      .slice(0, 10)
      .map(z => ({
        u0: snapLow(z.x0 / boxW),
        u1: snapHigh((z.x1 + 1) / boxW),
        v0: snapLow(1 - (z.y1 + 1) / boxH),
        v1: snapHigh(1 - z.y0 / boxH),
        hex: Rgb.hex(z.col.rgb),
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

  /** Адрес главного фото позиции. */
  static src(item) {
    return String((item && item.photo && item.photo.src) || '');
  }

  /** Цвет корпуса по фото (из памяти). */
  static get(src) {
    return PhotoTint.cache.get(src);
  }

  /** Зоны окраски по фото (из памяти). */
  static tones(src) {
    return PhotoTint.zones.get(src) || [];
  }

  /** У элементов станции есть фото, цвет которых ещё не определён. */
  static pending(x) {
    return Kit.parts(x).some(item => {
      const src = PhotoTint.src(item);
      return src && !PhotoTint.cache.has(src);
    });
  }

  /** Определить цвета фото элементов станции (по одному разу на адрес); true — что-то определено. */
  static async load(x) {
    let changed = false;
    for (const item of Kit.parts(x)) {
      const src = PhotoTint.src(item);
      if (!src || PhotoTint.cache.has(src)) continue;
      try {
        const res = PhotoTint.of(await readImg(src));
        PhotoTint.cache.set(src, res.hex);
        if (res.zones.length) PhotoTint.zones.set(src, res.zones);
      } catch {
        PhotoTint.cache.set(src, '');
      }
      changed = true;
    }
    return changed;
  }

  /** Картинка → {hex, zones} (уменьшается до SIDE точек по большей стороне); чужой сайт без разрешения — ''. */
  static of(image) {
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    if (!imgW || !imgH) return { hex: '', zones: [] };
    const k = Math.min(1, PhotoTint.SIDE / Math.max(imgW, imgH));
    const width = Math.max(1, Math.round(imgW * k));
    const height = Math.max(1, Math.round(imgH * k));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    try {
      return PhotoTint.parts(ctx.getImageData(0, 0, width, height).data, width, height);
    } catch {
      return { hex: '', zones: [] };
    }
  }

  /** Главный цвет изделия на картинке. */
  static pick(data, width, height) {
    return PhotoTint.parts(data, width, height).hex;
  }

  /** Цвета по пикселям RGBA: фон — заливкой от краёв; главный — по корзинам цвета; зоны — части другой окраски. */
  static parts(data, width, height) {
    const mask = PhotoTint._bg(data, width, height);
    const main = PhotoTint._dom(data, width, height, mask);
    return main ? { hex: main.hex, zones: PhotoTint._zones(data, width, height, mask, main) } : { hex: '', zones: [] };
  }

  static _zones(data, width, height, mask, main) {
    const pal = TintZones.palette(main);
    if (!pal.length) return [];
    const zones = new TintZones(data, width, height, mask);
    zones.scan(main, pal);
    return zones.result(zones.merge(zones.zones(pal, PhotoTint.GRID, PhotoTint.TEX)));
  }

  /** Маска фона: заливка от краёв цветом, близким к краевому (медиана), и прозрачное. */
  static _bg(data, width, height) {
    const mask = new Uint8Array(width * height);
    const pixel = i => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const edge = PhotoTint.edge(width, height);
    const edgeRgb = edge.filter(i => data[i * 4 + 3] >= 128).map(pixel);
    const med = k => edgeRgb.map(rgb => rgb[k]).sort((first, second) => first - second)[edgeRgb.length >> 1];
    const median = edgeRgb.length ? [med(0), med(1), med(2)] : null;
    const isBg = i => data[i * 4 + 3] < 128 || (median && Rgb.dist(pixel(i), median) <= 60);
    const queue = edge.filter(isBg);
    for (const i of queue) mask[i] = 1;
    while (queue.length) {
      const i = queue.pop();
      for (const j of PhotoTint.around(i, width, height).filter(k => !mask[k] && isBg(k))) {
        mask[j] = 1;
        queue.push(j);
      }
    }
    return mask;
  }

  /** Точки края картинки. */
  static edge(width, height) {
    const edge = [];
    for (let x = 0; x < width; x++) edge.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) edge.push(y * width, y * width + width - 1);
    return edge;
  }

  /** Соседи точки слева, справа, сверху, снизу. */
  static around(i, width, height) {
    const x = i % width;
    const y = (i - x) / width;
    return [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ].filter(j => j >= 0);
  }

  /** Корзина цвета точки: тёмные отдельно; серые — по яркости; цветные — тон × яркость; насыщенные весомее. */
  static bin(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const v = max / 255;
    const satur = max ? (max - min) / max : 0;
    if (v < 0.16) return ['d', 0.45];
    if (satur < 0.18) return [`g${Math.min(5, Math.floor(v * 6))}`, 0.9];
    let hue = (red - green) / (max - min) + 4;
    if (max === red) hue = ((green - blue) / (max - min) + 6) % 6;
    else if (max === green) hue = (blue - red) / (max - min) + 2;
    return [`h${Math.floor(hue * 3)}${v < 0.55 ? 'd' : 'l'}`, 1.15 + 0.6 * satur];
  }

  /** Главный цвет кадра (без фона): {hex, rgb, key, fg, bins}; ближе к центру — весомее; фона больше 96 % — null. */
  static _dom(data, width, height, mask) {
    const bins = new Map();
    let fore = 0;
    let all = 0;
    for (let i = 0; i < width * height; i++) {
      if (mask[i]) continue;
      fore++;
      const x = i % width;
      const y = (i - x) / width;
      const [red, green, blue] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      const [key, weight] = PhotoTint.bin(red, green, blue);
      const weighted =
        weight * (1 - 0.6 * Math.min(1, Math.hypot((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5) / 0.7071));
      const acc = bins.get(key) || { w: 0, r: 0, g: 0, b: 0 };
      Object.assign(acc, {
        w: acc.w + weighted,
        r: acc.r + red * weighted,
        g: acc.g + green * weighted,
        b: acc.b + blue * weighted,
      });
      bins.set(key, acc);
      all += weighted;
    }
    if (fore < width * height * 0.04 || !all) return null;
    const last = [...bins.entries()].sort((first, blue) => blue[1].w - first[1].w);
    const [key, best] = last[0][0] === 'd' && last[0][1].w < all * 0.5 && last[1] ? last[1] : last[0];
    const rgb = [best.r, best.g, best.b].map(v => v / best.w);
    return {
      hex: Rgb.hex(rgb),
      rgb,
      key,
      fg: fore,
      bins: last.map(([k, acc]) => ({ key: k, w: acc.w / all, rgb: [acc.r / acc.w, acc.g / acc.w, acc.b / acc.w] })),
    };
  }
}
