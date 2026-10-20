import { LgCities } from './lg-cities.js';

/**
 * Точки маршрута и расстояние: город по адресу («г Москва, ул …», «Свердловская обл, г Екатеринбург»), центр региона,
 * точный адрес с координатами (подсказка DaData / OpenStreetMap, координаты с карты), расстояние по прямой с поправкой на
 * дороги, пока маршрут по дорогам не посчитан.
 */
export class LgGeo {
  static EARTH_KM = 6371;
  static NEAR_KM = 40;
  static CITY_K = 1.4;
  static CITY_MIN = 3;
  static FAR_EAST = 105;
  static EAST = 59;
  static ROUND_KM = 10;
  static DEG = 180;
  static FAR = 1e9;

  /**
   * Название для сравнения: строчные, «ё» → «е», без кавычек и дефисов.
   * @param {*} text
   * @returns {string}
   */
  static norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[«»"()]/g, ' ')
      .replace(/[-‐–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // длинные названия первыми: «Нижний Новгород» раньше «Новгород»
  static IDX = LgCities.CITIES.map(([name, lat, lon, noRoad]) => ({
    name,
    lat,
    lon,
    noRoad: !!noRoad,
    n: LgGeo.norm(name),
  })).sort((left, right) => right.n.length - left.n.length);

  /**
   * Город из таблицы по названию (с учётом сокращений «спб», «н новгород»).
   * @param {string} name
   * @returns {object|null}
   */
  static byName(name) {
    const norm = this.norm(name);
    const alias = LgCities.ALIAS[norm];
    const want = alias ? this.norm(alias) : norm;
    return this.IDX.find(city => city.n === want) || null;
  }

  /**
   * Город по адресу; нет города — центр региона.
   * @param {string} addr
   * @returns {object|null}
   */
  static city(addr) {
    const text = ` ${this.norm(addr).replace(/[.,;]/g, ' ').replace(/\s+/g, ' ')} `;
    if (text.trim() === '') return null;
    const has = name => text.includes(` ${name} `);
    for (const [alias, name] of Object.entries(LgCities.ALIAS)) {
      if (has(this.norm(alias))) return { ...this.byName(name), how: 'город' };
    }
    // город с пометкой «г» — надёжнее (в адресе бывает и улица с названием города)
    const marked = this.IDX.find(
      city => text.includes(` г ${city.n} `) || text.includes(` город ${city.n} `) || text.includes(` ${city.n} г `),
    );
    if (marked) return { ...marked, how: 'город' };
    const any = this.IDX.find(city => has(city.n));
    if (any) return { ...any, how: 'город' };
    return this._region(text);
  }

  static _region(text) {
    for (const [stem, name] of LgCities.REGIONS) {
      if (!text.includes(` ${stem}`)) continue;
      const city = this.byName(name);
      if (city) return { ...city, how: 'регион' };
    }
    return null;
  }

  /**
   * Расстояние по прямой, км.
   * @param {{lat: number, lon: number}} from
   * @param {{lat: number, lon: number}} dest
   * @returns {number}
   */
  static hav(from, dest) {
    const rad = deg => (deg * Math.PI) / this.DEG;
    const dLat = rad(dest.lat - from.lat);
    const dLon = rad(dest.lon - from.lon);
    const half = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(dest.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * this.EARTH_KM * Math.asin(Math.sqrt(half));
  }

  /**
   * Расстояние по дорогам, пока маршрут не посчитан: по прямой × коэффициент дорог, по городу — свои правила.
   * @param {object} from
   * @param {object} dest
   * @param {object} tariffs
   * @returns {number|null}
   */
  static roadKm(from, dest, tariffs) {
    if (!from || !dest) return null;
    if (from.exact && dest.exact) {
      const direct = this.hav(from, dest);
      // точные адреса рядом — по городу
      if (direct < this.NEAR_KM) return Math.max(this.CITY_MIN, Math.round(direct * this.CITY_K));
    } else if (from.name === dest.name) return tariffs.localKm;
    return (
      Math.round((this.hav(from, dest) * this._roadK(Math.max(from.lon, dest.lon), tariffs)) / this.ROUND_KM) *
      this.ROUND_KM
    );
  }

  static _roadK(east, tariffs) {
    if (east > this.FAR_EAST) return tariffs.roadKFE;
    return east > this.EAST ? tariffs.roadKE : tariffs.roadK;
  }

  /**
   * Точка маршрута: точный адрес с координатами или город из адреса.
   * @param {{city?: string, addr?: string, geo?: object}} place
   * @returns {object|null}
   */
  static point(place) {
    if (!place) return null;
    const geo = place.geo;
    if (geo && Number.isFinite(+geo.lat) && Number.isFinite(+geo.lon) && geo.lat !== null && geo.lon !== null) {
      return this._exact(place, geo);
    }
    return place.city ? this.byName(place.city) : this.city(place.addr);
  }

  static _exact(place, geo) {
    const lat = +geo.lat;
    const lon = +geo.lon;
    const base =
      (geo.city && (this.byName(geo.city) || this.city(geo.city))) ||
      this.city(geo.value || place.addr) ||
      this._nearest(lat, lon);
    return {
      name: geo.city || (base && base.name) || 'точка на карте',
      lat,
      lon,
      how: geo.cityOnly ? 'город' : 'адрес',
      exact: !geo.cityOnly,
      noRoad: !!(base && base.noRoad),
      near: base && base.name,
    };
  }

  static _nearest(lat, lon) {
    return this.IDX.reduce(
      (best, city) => {
        const dist = this.hav(city, { lat, lon });
        return dist < best.dist ? { city, dist } : best;
      },
      { city: null, dist: this.FAR },
    ).city;
  }

  /**
   * Ближайшие крупные города (первые в таблице) в пределах радиуса — для направлений перевозчиков.
   * @param {object} point
   * @param {{top: number, km: number, count: number}} limits
   * @returns {string[]}
   */
  static nearBig(point, limits) {
    if (!point) return [];
    return LgCities.CITIES.slice(0, limits.top)
      .filter(row => row[0] !== point.name)
      .map(row => ({ name: row[0], dist: this.hav(point, { lat: row[1], lon: row[2] }) }))
      .filter(row => row.dist <= limits.km)
      .sort((left, right) => left.dist - right.dist)
      .slice(0, limits.count)
      .map(row => row.name);
  }
}
