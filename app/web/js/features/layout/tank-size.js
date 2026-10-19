import { Mm } from './mm.js';
import { StationEquip } from './station-equip.js';
import { StationMatrix } from './station-matrix.js';

/**
 * Дополнительный топливный бак без своих габаритов — прямоугольный по расчётному объёму: начальные высота и ширина по
 * объёму, длиннее глубины — сначала выше (почти под потолок), затем глубже; длина — с шагом tank.step.
 */
export class TankSize {
  static H = 2290;
  static LITRE = /(?:^|[^а-яё])л(?![а-яё])|литр/i;

  /**
   * @param {number} v объём, л
   * @param {{h?: number, w?: number}} [lim] наибольшие высота и глубина в отсеке
   * @returns {{l: number, w: number, h: number} | null} мм снаружи
   */
  static of(v, lim) {
    const vol = +v;
    if (!(vol > 0)) return null;
    const T = StationMatrix.tank();
    const big = vol > T.big;
    const t = T.wall;
    const st = T.step || 50;
    const V = vol * 1e6;
    const up = x => Math.ceil(x / st) * st;
    let w = big ? T.w2 : T.w1;
    let h = big ? T.h2 : T.h1;
    const hMax = Math.max(h, Math.floor(((lim && lim.h) || this.H - T.top) / st) * st);
    const wMax = Math.max(w, Math.floor(Math.min(T.wMax, (lim && lim.w) || T.wMax) / st) * st);
    const len = (a, b) => up(V / ((a - 2 * t) * (b - 2 * t)) + 2 * t);
    if (len(w, h) > w) h = Math.min(hMax, Math.max(h, up(V / ((w - 2 * t) * (w - 2 * t)) + 2 * t)));
    if (len(w, h) > w) w = Math.min(wMax, Math.max(w, up(Math.sqrt(V / (h - 2 * t)) + 2 * t)));
    return { l: Math.max(w, len(w, h)), w, h };
  }

  /** «2 600 × 800 × 1 000 мм» */
  static text(d) {
    return d ? `${Mm.text(d.l)} × ${Mm.text(d.w)} × ${Mm.text(d.h)} мм` : '';
  }

  /** Объём бака из состава, л: поле tank / volume или строка «Объём … л». */
  static vol(p) {
    const a = (p && p.attrs) || {};
    const row = this.volumeRow(p);
    return (
      StationEquip.num(a.tank) || StationEquip.num(a.volume) || (row ? StationEquip.num(this.firstNumber(row.v)) : null)
    );
  }

  /** Строка «Объём … л» характеристик. */
  static volumeRow(p) {
    return ((p && p.rows) || []).find(
      r => r && /^объ[её]м/i.test(String(r.k || '')) && this.LITRE.test(`${String(r.v || '')} ${String(r.k || '')}`),
    );
  }

  static firstNumber(v) {
    return String(v).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0];
  }
}
