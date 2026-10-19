import { StCam } from './st-cam.js';
import { StDecal } from './st-decal.js';
import { StGl } from './st-gl.js';
import { StScene } from './st-scene.js';

export class StationRender {
  static PASSES = 64; // проходов накопления
  static W = 1600;
  static cache = new Map(); // отпечаток расстановки → {src, w, h}
  static gl = null;
  static okFlag = null;
  static queue = Promise.resolve();

  /** WebGL2 с вещественным кадром есть (проверяется один раз). */
  static ok() {
    if (this.okFlag != null) return this.okFlag;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      this.okFlag = !!(gl && gl.getExtension('EXT_color_buffer_float'));
      if (gl) {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        const r = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
        this.soft = /swiftshader|llvmpipe|software|basic render/i.test(r);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (e) {
      this.okFlag = false;
    }
    return this.okFlag;
  }
  static key(plan, view, az) {
    return `${plan.hash || ''}${this.brandKey()}${view === 'out' ? `|o${az ?? ''}` : ''}`;
  }
  /** Фирменный стиль шаблона (надпись логотипа и цвета) — в отпечатке картинки: сменили — 3D перерисуется. */
  static brandKey() {
    try {
      return `.b${StationRules.fnv(JSON.stringify(StDecal.brandParts()))}`;
    } catch (e) {
      return '';
    }
  }
  static FAILS = 3; // сбоев подряд — дальше только SVG-вид
  static fails = 0;
  static cached(plan, view, az) {
    return this.cache.get(this.key(plan, view, az)) || null;
  }
  /** Кадр → JPEG (data URL) в фоне: toBlob кодирует вне основного потока (toDataURL держал окно на время сжатия). */
  static jpeg(c) {
    if (!c.toBlob) return Promise.resolve(c.toDataURL('image/jpeg', 0.92));
    return new Promise((res, rej) => {
      c.toBlob(
        b => {
          if (!b) {
            rej(new Error('кадр не сохранился'));
            return;
          }
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(b);
        },
        'image/jpeg',
        0.92,
      );
    });
  }
  /** Высота кадра — по сцене (длинный контейнер — ниже кадр, без пустых полей). */
  static size(scene) {
    const W = this.W;
    const c = StCam.fit(scene.bounds(), 1.6, 0.9, scene.az);
    const k = (c.span[1] / c.span[0]) * 1.6;
    return [W, Math.round(Math.max(760, Math.min(1100, (W / 1.6) * Math.max(0.62, Math.min(1, k * 1.12)))))];
  }
  static async draw(plan, meta, view, az) {
    const out = view === 'out';
    const m = await StDecal.meta(plan, { ...meta, view: out ? 'out' : 'in', ...(out && az != null ? { az } : {}) });
    const sc = new StScene(plan, m).build();
    const [w, h] = this.size(sc);
    await StDecal.prepare(sc);
    if (!this.gl) this.gl = new StGl(document.createElement('canvas'));
    const c = await this.gl.render(sc, {
      w,
      h,
      passes: this.soft ? Math.min(this.PASSES, 24) : this.PASSES,
      shadow: this.soft ? 1536 : 2048,
    });
    return { src: await this.jpeg(c), w: c.width, h: c.height };
  }

  /** 3D-вид картинкой. */
  static image(plan, meta, view, az) {
    const key = this.key(plan, view, az);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (!plan.geo || !plan.geo.ext || !this.ok()) return Promise.resolve(null);
    const run = async () => {
      if (this.cache.has(key)) return this.cache.get(key);
      try {
        const im = await this.draw(plan, meta, view, az);
        this.cache.set(key, im);
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
        this.fails = 0;
        this.lastErr = '';
        return im;
      } catch (e) {
        this.gl = null;
        this.fails++;
        this.lastErr = String((e && e.message) || e).slice(0, 200); // сбой — повтор при следующем построении
        if (this.fails >= this.FAILS) this.okFlag = false;
        return null;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => null);
    return p;
  }
}
