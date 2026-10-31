import { Mm } from './mm.js';
import { StationMatrix } from './station-matrix.js';
import { EquipField } from './equip-field.js';

/**
 * Дополнительный топливный бак без своих габаритов — прямоугольный по расчётному объёму: начальные высота и ширина по
 * объёму, длиннее глубины — сначала выше (почти под потолок), затем глубже; длина — с шагом tank.step.
 */
export class TankSize {
  static LITRE = /(?:^|[^а-яё])л(?![а-яё])|литр/i;

  /** Высота помещения, если контейнер ещё не подобран, мм. */
  static get HEIGHT() {
    return StationMatrix.tank().room;
  }

  /**
   * @param {number} v объём, л
   * @param {{h?: number, w?: number}} [lim] наибольшие высота и глубина в отсеке
   * @returns {{l: number, w: number, h: number} | null} мм снаружи
   */
  static of(v, lim) {
    const vol = +v;
    if (!(vol > 0)) return null;
    const tank = StationMatrix.tank();
    const big = vol > tank.big;
    const wall = tank.wall;
    const step = tank.step || 50;
    const volMm3 = vol * 1e6;
    const roundUp = x => Math.ceil(x / step) * step;
    let width = big ? tank.w2 : tank.w1;
    let height = big ? tank.h2 : tank.h1;
    const hMax = Math.max(height, Math.floor(((lim && lim.h) || this.HEIGHT - tank.top) / step) * step);
    const wMax = Math.max(width, Math.floor(Math.min(tank.wMax, (lim && lim.w) || tank.wMax) / step) * step);
    const len = (sideA, sideB) => roundUp(volMm3 / ((sideA - 2 * wall) * (sideB - 2 * wall)) + 2 * wall);
    if (len(width, height) > width)
      height = Math.min(hMax, Math.max(height, roundUp(volMm3 / ((width - 2 * wall) * (width - 2 * wall)) + 2 * wall)));
    if (len(width, height) > width)
      width = Math.min(wMax, Math.max(width, roundUp(Math.sqrt(volMm3 / (height - 2 * wall)) + 2 * wall)));
    return { l: Math.max(width, len(width, height)), w: width, h: height };
  }

  /** «2 600 × 800 × 1 000 мм» */
  static text(size) {
    return size ? `${Mm.text(size.l)} × ${Mm.text(size.w)} × ${Mm.text(size.h)} мм` : '';
  }

  /** Объём бака из состава, л: поле tank / volume или строка «Объём … л». */
  static vol(product) {
    const attrs = (product && product.attrs) || {};
    const row = this.volumeRow(product);
    return (
      EquipField.num(attrs.tank) ||
      EquipField.num(attrs.volume) ||
      (row ? EquipField.num(this.firstNumber(row.v)) : null)
    );
  }

  /** Строка «Объём … л» характеристик. */
  static volumeRow(product) {
    return ((product && product.rows) || []).find(
      row =>
        row &&
        /^объ[её]м/i.test(String(row.k || '')) &&
        this.LITRE.test(`${String(row.v || '')} ${String(row.k || '')}`),
    );
  }

  /** Первое число в тексте. */
  static firstNumber(v) {
    return String(v).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0];
  }
}
