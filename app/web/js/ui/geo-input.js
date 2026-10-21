import { Toast } from '../core/toast.js';
import { Api } from '../core/net.js';
import { LgGeo } from '../features/deal/lg-geo.js';
import { esc } from '../core/util.js';
/** Координаты из текста или ссылки карт: «55.751244, 37.618423», 55°45′04″N 37°37′06″E, ссылки Google и Яндекс Карт. */
export class GeoParse {
  static DIGITS = 6;
  static LAT_MAX = 90;
  static LON_MAX = 180;
  static MINUTE = 60;
  static SECOND = 3600;
  static SHORT = /^https?:\/\/(?:[\w-]+\.)*(?:goo\.gl|g\.co|yandex\.(?:ru|com|kz|by)|ya\.ru)\//i;
  // ссылка карт: шаблон и порядок чисел (широта, долгота или долгота, широта)
  static LINKS = [
    [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, 'latlon'], // Google: точка места
    [/[?&](?:whatshere\[point\]|pt|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, 'lonlat'], // Яндекс: долгота, широта
    [/[?&](?:q|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, 'latlon'],
    [/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, 'latlon'], // Google: центр карты
  ];
  static DMS =
    /(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSEWСЮВЗ])?/gi;
  static PAIR = /^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/;

  /**
   * Точка из текста или ссылки.
   * @param {string} text
   * @returns {{lat: number, lon: number}|null}
   */
  static point(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return this._link(value);
    const dms = [...value.matchAll(this.DMS)];
    if (dms.length === 2) return this._dms(dms);
    const pair = value.match(this.PAIR);
    return pair ? this._ok(pair[1].replace(',', '.'), pair[2].replace(',', '.')) : null;
  }

  static _ok(latText, lonText) {
    const lat = +latText;
    const lon = +lonText;
    const valid =
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= this.LAT_MAX &&
      Math.abs(lon) <= this.LON_MAX &&
      (lat || lon);
    return valid ? { lat: +lat.toFixed(this.DIGITS), lon: +lon.toFixed(this.DIGITS) } : null;
  }

  static _link(value) {
    let url = value;
    try {
      url = decodeURIComponent(value);
    } catch {
      // не раскодировалась — ищем в исходной
    }
    for (const [pattern, order] of this.LINKS) {
      const found = url.match(pattern);
      if (found) return order === 'latlon' ? this._ok(found[1], found[2]) : this._ok(found[2], found[1]);
    }
    return null;
  }

  static _degrees(part) {
    const number = k => parseFloat(String(part[k] || 0).replace(',', '.'));
    const value = number(1) + number(2) / this.MINUTE + number(3) / this.SECOND;
    return /[SWЮЗ]/i.test(part[4] || '') ? -value : value;
  }

  static _dms([first, second]) {
    const lonFirst = /[EWВЗ]/i.test(first[4] || '');
    return lonFirst
      ? this._ok(this._degrees(second), this._degrees(first))
      : this._ok(this._degrees(first), this._degrees(second));
  }

  /**
   * Короткая ссылка карт без координат (её открывает сервер).
   * @param {string} text
   * @returns {boolean}
   */
  static short(text) {
    return this.SHORT.test(String(text || '').trim()) && !this.point(text);
  }

  /**
   * Координаты текстом.
   * @param {{lat: number, lon: number}} point
   * @returns {string}
   */
  static text(point) {
    return `${point.lat.toFixed(this.DIGITS)}, ${point.lon.toFixed(this.DIGITS)}`;
  }
}

/**
 * Поле точного адреса с подсказками (атрибут data-geo): DaData (если задан ключ) или OpenStreetMap — сервер /api/geo/*.
 * Выбор — событие «geo:pick» на поле: detail = {value, lat, lon, city, region, exact, src}. Дополнительные пункты
 * (например, склады поставщика) — GeoInput.extra[имя из data-geo](поле) → [{value, lat, lon, city, sub, tag}].
 */
export class GeoInput {
  // свои подсказки полей адреса (склады поставщиков — раздел сделки)
  static extra = {};
  static state = { box: null, input: null, items: [], index: -1, timer: 0, seq: 0, msg: '', src: '' };
  static MIN_WIDTH = 280;
  static MAX_HEIGHT = 320;
  static GAP = 8;
  static OFFSET = 4;
  static MARGIN = 12;
  static CITY_MIN = 2;
  static QUERY_MIN = 3;
  static CITIES = 3;
  static TYPE_DELAY = 320;
  static BLUR_DELAY = 120;

  /** Закрыть список подсказок. */
  static close() {
    const state = this.state;
    if (state.box) state.box.remove();
    Object.assign(state, { box: null, input: null, items: [], index: -1, msg: '' });
    clearTimeout(state.timer);
  }

  /** Поставить список у поля (снизу, а если места мало — сверху). */
  static place() {
    const { box, input } = this.state;
    if (!box || !input || !input.isConnected) {
      this.close();
      return;
    }
    const rect = input.getBoundingClientRect();
    const width = Math.max(rect.width, this.MIN_WIDTH);
    box.style.left = `${Math.max(this.GAP, Math.min(rect.left, innerWidth - width - this.GAP))}px`;
    box.style.width = `${width}px`;
    const below = innerHeight - rect.bottom;
    const height = Math.min(this.MAX_HEIGHT, box.scrollHeight || this.MAX_HEIGHT);
    if (below < height + this.MARGIN && rect.top > below) {
      box.style.top = '';
      box.style.bottom = `${innerHeight - rect.top + this.OFFSET}px`;
    } else {
      box.style.bottom = '';
      box.style.top = `${rect.bottom + this.OFFSET}px`;
    }
  }

  static _box() {
    const box = document.createElement('div');
    box.className = 'geo-box';
    box.setAttribute('role', 'listbox');
    box.addEventListener('pointerdown', event => event.preventDefault()); // фокус остаётся в поле
    box.addEventListener('click', event => {
      const row = event.target.closest('[data-gi]');
      if (row) this.pick(+row.dataset.gi);
    });
    // внутри открытого окна (иначе модальное окно делает список недоступным); перерисовка окна его не удаляет
    box.setAttribute('data-morph-keep', '');
    (this.state.input.closest('dialog[open]') || document.body).appendChild(box);
    return box;
  }

  /** Нарисовать список подсказок. */
  static draw() {
    const state = this.state;
    if (!state.input) return;
    if (state.box && !state.box.isConnected) state.box = null;
    if (!state.box) state.box = this._box();
    const rows = state.items
      .map(
        (item, i) =>
          `<button type="button" role="option" data-gi="${i}"${i === state.index ? ' aria-selected="true"' : ''}><b>${esc(item.value)}</b>${item.tag ? `<em>${esc(item.tag)}</em>` : ''}${item.sub ? `<small>${esc(item.sub)}</small>` : ''}</button>`,
      )
      .join('');
    state.box.innerHTML = `${rows}${state.msg ? `<p class="geo-msg">${esc(state.msg)}</p>` : ''}<p class="geo-ft">${state.src ? `Подсказки: ${esc(state.src)} · ` : ''}можно вставить координаты или ссылку на точку из Google / Яндекс Карт</p>`;
    this.place();
  }

  static _extra(input, text) {
    const make = GeoInput.extra[input.dataset.geo];
    return (make ? make(input) || [] : []).filter(
      item => !text || LgGeo.norm(`${item.value} ${item.sub || ''}`).includes(LgGeo.norm(text)),
    );
  }

  static _single(item) {
    Object.assign(this.state, { items: [item], src: '', index: 0 });
    this.draw();
  }

  /**
   * Подсказки для поля: свои пункты, координаты, ссылка, города из встроенной таблицы, затем адреса с сервера.
   * @param {HTMLInputElement} input
   */
  static async query(input) {
    const state = this.state;
    const text = input.value.trim();
    const seq = ++state.seq;
    const extra = this._extra(input, text);
    state.msg = '';
    const point = GeoParse.point(text);
    if (point) {
      this._single({
        value: GeoParse.text(point),
        lat: point.lat,
        lon: point.lon,
        coords: true,
        tag: 'координаты',
        sub: 'Выберите — адрес определится по точке',
      });
      return;
    }
    if (GeoParse.short(text)) {
      this._single({ value: text, short: true, tag: 'ссылка', sub: 'Выберите — откроем ссылку и возьмём точку' });
      return;
    }
    // города из встроенной таблицы — сразу (и без интернета)
    const cities = this._cities(text);
    Object.assign(state, { items: [...extra, ...cities], index: -1 });
    this.draw();
    if (text.length < this.QUERY_MIN) return;
    if (await this._suggest({ input, text, seq, extra, cities })) this.draw();
  }

  static _cities(text) {
    if (text.length < this.CITY_MIN) return [];
    return LgGeo.IDX.filter(city => city.n.startsWith(LgGeo.norm(text)))
      .slice(0, this.CITIES)
      .map(city => ({
        value: city.name,
        lat: city.lat,
        lon: city.lon,
        city: city.name,
        sub: 'город — центр',
        tag: 'город',
        cityOnly: true,
      }));
  }

  // false — ответ устарел (поле сменилось или введено новое), список не перерисовывается
  static async _suggest({ input, text, seq, extra, cities }) {
    const state = this.state;
    try {
      const found = await Api.request(`/api/geo/suggest?q=${encodeURIComponent(text)}`);
      if (seq !== state.seq || state.input !== input) return false;
      if (found.error) state.msg = `Подсказки адресов недоступны: ${found.error}`;
      state.src = found.src || '';
      const items = (found.items || []).map(item => ({ ...item, sub: this._sub(item) }));
      state.items = [...extra, ...items, ...(found.items && found.items.length ? [] : cities)];
    } catch (error) {
      if (seq !== state.seq) return false;
      state.msg = `Подсказки адресов недоступны (${error.message || error}). Город из списка или координаты — работают.`;
    }
    return true;
  }

  static _sub(item) {
    let where = 'точка улицы / населённого пункта';
    if (item.lat == null) where = 'без координат — уточним по карте';
    else if (item.exact) where = 'точка дома';
    return [item.region && item.region !== item.city ? item.region : '', where].filter(Boolean).join(' · ');
  }

  static _status(msg) {
    Object.assign(this.state, { msg, items: [] });
    this.draw();
  }

  static async _resolve(picked) {
    let item = { ...picked };
    if (picked.short) {
      this._status('Открываю ссылку…');
      const found = await Api.request(`/api/geo/unshort?u=${encodeURIComponent(picked.value)}`);
      if (found.error) throw new Error(found.error);
      const point = GeoParse.point(found.url);
      if (!point) throw new Error('в ссылке нет координат точки — откройте точку на карте и скопируйте координаты');
      item = { value: GeoParse.text(point), ...point, coords: true };
    }
    if (item.coords) return this._reverse(item);
    if (item.lat == null && !item.cityOnly) {
      const found = await Api.request(`/api/geo/locate?q=${encodeURIComponent(item.value)}`);
      if (!found.error) item = { ...item, lat: found.lat, lon: found.lon, city: item.city || found.city };
    }
    return item;
  }

  static async _reverse(item) {
    this._status('Определяю адрес по координатам…');
    const found = await Api.request(`/api/geo/reverse?lat=${item.lat}&lon=${item.lon}`);
    if (found.error)
      return { ...item, value: GeoParse.text(item), city: '', exact: true, src: 'координаты', note: found.error };
    return { ...found, lat: item.lat, lon: item.lon, exact: true, src: `${found.src || ''} по координатам` };
  }

  /**
   * Выбрать подсказку: адрес по координатам или ссылке, точка адреса; событие «geo:pick» на поле.
   * @param {number} index
   */
  static async pick(index) {
    const input = this.state.input;
    const picked = this.state.items[index];
    if (!input || !picked) return;
    let item;
    try {
      item = await this._resolve(picked);
    } catch (error) {
      this._status(`Не получилось: ${error.message || error}`);
      return;
    }
    const clean = {
      value: item.value,
      lat: item.lat ?? null,
      lon: item.lon ?? null,
      city: item.city || '',
      region: item.region || '',
      exact: !!item.exact,
      src: item.src || (item.cityOnly ? 'город' : ''),
      cityOnly: !!item.cityOnly,
    };
    this.close();
    input.value = clean.value;
    input.dispatchEvent(new CustomEvent('geo:pick', { bubbles: true, detail: clean }));
    if (item.note) Toast.show(`Адрес по координатам не определён: ${item.note}`);
  }

  static _field(target) {
    return target.matches && target.matches('input[data-geo]') && !target.disabled && !target.readOnly;
  }

  static _take(input) {
    if (this.state.input !== input) {
      this.close();
      this.state.input = input;
    }
  }

  static _focus(input) {
    if (!this._field(input)) return;
    this._take(input);
    const make = GeoInput.extra[input.dataset.geo];
    if (make && (make(input) || []).length) this.query(input);
  }

  static _type(input) {
    if (!input.matches || !input.matches('input[data-geo]')) return;
    this._take(input);
    clearTimeout(this.state.timer);
    const text = input.value.trim();
    const now = GeoParse.point(text) || GeoParse.short(text);
    this.state.timer = setTimeout(() => this.query(input), now ? 0 : this.TYPE_DELAY);
  }

  static _key(event) {
    const state = this.state;
    if (event.target !== state.input || !state.box) return;
    const count = state.items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!count) return;
      event.preventDefault();
      state.index = (state.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      this.draw();
    } else if (event.key === 'Enter' && state.index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      this.pick(state.index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  // вставили координаты или ссылку на точку — сразу определяем адрес
  static _paste(input) {
    if (!this._field(input)) return;
    setTimeout(async () => {
      const text = input.value.trim();
      if (!(GeoParse.point(text) || GeoParse.short(text))) return;
      clearTimeout(this.state.timer);
      this.state.input = input;
      await this.query(input);
      if (this.state.input === input && this.state.items.length === 1) this.pick(0);
    }, 0);
  }

  /** Обработчики полей адреса. */
  static listen() {
    document.addEventListener('focusin', event => this._focus(event.target));
    document.addEventListener('input', event => this._type(event.target));
    document.addEventListener('focusout', event => {
      if (event.target !== this.state.input) return;
      setTimeout(() => {
        if (this.state.input && document.activeElement !== this.state.input) this.close();
      }, this.BLUR_DELAY);
    });
    document.addEventListener('keydown', event => this._key(event), true);
    window.addEventListener('resize', () => this.place());
    document.addEventListener(
      'scroll',
      event => {
        if (this.state.box && !this.state.box.contains(event.target)) this.place();
      },
      true,
    );
    document.addEventListener('paste', event => this._paste(event.target));
  }
}
