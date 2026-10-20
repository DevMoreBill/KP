import { StCam } from './st-cam.js';
import { StDecal } from './st-decal.js';
import { StGl } from './st-gl.js';
import { StScene } from './st-scene.js';

export class StationRender {
  static PASSES = 64; // проходов накопления
  static WIDTH = 1600;
  static cache = new Map(); // отпечаток расстановки → {src, w, h}
  static renderer = null;
  static okFlag = null;
  static queue = Promise.resolve();

  /** WebGL2 с вещественным кадром есть (проверяется один раз). */
  static ok() {
    if (this.okFlag != null) return this.okFlag;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl2');
      this.okFlag = !!(ctx && ctx.getExtension('EXT_color_buffer_float'));
      if (ctx) {
        const info = ctx.getExtension('WEBGL_debug_renderer_info');
        const renderer = info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
        this.soft = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
        const lose = ctx.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (err) {
      this.okFlag = false;
    }
    return this.okFlag;
  }
  /** Ключ памяти картинки. */
  static key(plan, view, azimuth) {
    return `${plan.hash || ''}${this.brandKey()}${view === 'out' ? `|o${azimuth ?? ''}` : ''}`;
  }
  /** Фирменный стиль шаблона (надпись логотипа и цвета) — в отпечатке картинки: сменили — 3D перерисуется. */
  static brandKey() {
    try {
      return `.b${StationRules.fnv(JSON.stringify(StDecal.brandParts()))}`;
    } catch (err) {
      return '';
    }
  }
  static FAILS = 3; // сбоев подряд — дальше только SVG-вид
  static fails = 0;
  /** Готовая картинка из памяти. */
  static cached(plan, view, azimuth) {
    return this.cache.get(this.key(plan, view, azimuth)) || null;
  }
  /** Кадр → JPEG (data URL) в фоне: toBlob кодирует вне основного потока (toDataURL держал окно на время сжатия). */
  static jpeg(canvas) {
    if (!canvas.toBlob) return Promise.resolve(canvas.toDataURL('image/jpeg', 0.92));
    return new Promise((res, rej) => {
      canvas.toBlob(
        blob => {
          if (!blob) {
            rej(new Error('кадр не сохранился'));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = () => rej(reader.error);
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        0.92,
      );
    });
  }
  /** Высота кадра — по сцене (длинный контейнер — ниже кадр, без пустых полей). */
  static size(scene) {
    const width = this.WIDTH;
    const cam = StCam.fit(scene.bounds(), 1.6, 0.9, scene.azimuth);
    const k = (cam.span[1] / cam.span[0]) * 1.6;
    return [width, Math.round(Math.max(760, Math.min(1100, (width / 1.6) * Math.max(0.62, Math.min(1, k * 1.12)))))];
  }
  /** Отрисовать 3D-вид — {src, w, h}. */
  static async draw(plan, meta, view, azimuth) {
    const out = view === 'out';
    const fullMeta = await StDecal.meta(plan, {
      ...meta,
      view: out ? 'out' : 'in',
      ...(out && azimuth != null ? { az: azimuth } : {}),
    });
    const scene = new StScene(plan, fullMeta).build();
    const [width, height] = this.size(scene);
    await StDecal.prepare(scene);
    if (!this.renderer) this.renderer = new StGl(document.createElement('canvas'));
    const canvas = await this.renderer.render(scene, {
      w: width,
      h: height,
      passes: this.soft ? Math.min(this.PASSES, 24) : this.PASSES,
      shadow: this.soft ? 1536 : 2048,
    });
    return { src: await this.jpeg(canvas), w: canvas.width, h: canvas.height };
  }

  /** 3D-вид картинкой. */
  static image(plan, meta, view, azimuth) {
    const key = this.key(plan, view, azimuth);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (!plan.geo || !plan.geo.ext || !this.ok()) return Promise.resolve(null);
    const run = async () => {
      if (this.cache.has(key)) return this.cache.get(key);
      try {
        const image = await this.draw(plan, meta, view, azimuth);
        this.cache.set(key, image);
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
        this.fails = 0;
        this.lastErr = '';
        return image;
      } catch (err) {
        this.renderer = null;
        this.fails++;
        this.lastErr = String((err && err.message) || err).slice(0, 200); // сбой — повтор при следующем построении
        if (this.fails >= this.FAILS) this.okFlag = false;
        return null;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => null);
    return next;
  }
}
