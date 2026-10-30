import { esc, isoDay } from '../core/util.js';
import { Mobile } from './mobile.js';
import { Api } from '../core/net.js';
/**
 * Производственный календарь РФ (/api/calendar: выходные, праздники, переносы, сокращённые дни; сервер обновляет раз в
 * 30 дней). Без загруженного года — выходные по дням недели и праздники ст. 112 ТК РФ.
 */
export class WorkCalendar {
  static years = {};
  static loading = {};
  static failed = new Set(); // год, который сервер не отдал, — не запрашивать снова (перерисовка запрашивала бы без конца)
  // официальные праздники (ст. 112 ТК РФ) — чтобы отличать праздник от перенесённого выходного
  static HOLIDAYS = {
    '1-1': 'Новогодние каникулы',
    '1-2': 'Новогодние каникулы',
    '1-3': 'Новогодние каникулы',
    '1-4': 'Новогодние каникулы',
    '1-5': 'Новогодние каникулы',
    '1-6': 'Новогодние каникулы',
    '1-7': 'Рождество Христово',
    '1-8': 'Новогодние каникулы',
    '2-23': 'День защитника Отечества',
    '3-8': 'Международный женский день',
    '5-1': 'Праздник Весны и Труда',
    '5-9': 'День Победы',
    '6-12': 'День России',
    '11-4': 'День народного единства',
  };
  static DAY_MS = 864e5;
  static SATURDAY = 6;

  /**
   * Календарь года (null — ещё загружается; по окончании загрузки календарь дат перерисовывается).
   * @param {number} year
   * @returns {object|null}
   */
  static year(year) {
    if (this.years[year] || this.loading[year] || this.failed.has(year)) return this.years[year] || null;
    this.loading[year] = Api.request(`/api/calendar?year=${year}`)
      .then(result => {
        if (result && result.days) this.years[year] = result;
        else this.failed.add(year);
      })
      .catch(error => {
        this.failed.add(year);
        console.warn(`Производственный календарь ${year} не загружен:`, error);
      })
      .finally(() => {
        delete this.loading[year];
        if (DatePicker.state.input) DatePicker.draw();
      });
    return null;
  }

  static _dayOfYear(date) {
    const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((day - Date.UTC(date.getFullYear(), 0, 1)) / this.DAY_MS);
  }

  /**
   * Вид дня: hol — праздник, wkd — выходной, move — перенесённый выходной, work — рабочая суббота или воскресенье,
   * short — сокращённый.
   * @param {Date} date
   * @returns {{off: boolean, cls: string, t: string}}
   */
  static day(date) {
    const cal = this.years[date.getFullYear()];
    const index = this._dayOfYear(date);
    const weekDay = date.getDay();
    const weekend = weekDay === 0 || weekDay === this.SATURDAY;
    const holiday = this.HOLIDAYS[`${date.getMonth() + 1}-${date.getDate()}`];
    const off = cal ? cal.days[index] === '1' : weekend || !!holiday;
    const short = !!(cal && cal.short && cal.short[index] === '1');
    if (off) return this._off(holiday, weekend);
    if (weekend) return { off: false, cls: 'work', t: 'Рабочий день (перенос)' };
    if (short) return { off: false, cls: 'short', t: 'Сокращённый предпраздничный день' };
    return { off: false, cls: '', t: '' };
  }

  static _off(holiday, weekend) {
    if (holiday) return { off: true, cls: 'hol', t: holiday };
    if (!weekend) return { off: true, cls: 'move', t: 'Нерабочий день (перенос выходного)' };
    return { off: true, cls: 'wkd', t: 'Выходной' };
  }
}

/**
 * Календарь для всех полей дат программы: выходные, праздники, переносы и сокращённые дни. По щелчку по полю даты
 * открывается свой (встроенный не умеет отмечать праздники); с клавиатуры дату можно ввести в поле, Alt+↓ или F4 —
 * открыть календарь.
 */
export class DatePicker {
  static state = { input: null, box: null, year: 0, month: 0 };
  static MONTHS = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  static WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  static WORK_DAYS = 5;
  static DECEMBER = 11;
  static GAP = 8;
  static OFFSET = 4;

  /**
   * Открыть календарь у поля.
   * @param {HTMLInputElement} input
   */
  static open(input) {
    if (input.disabled || input.readOnly) return;
    this.close();
    const value = input.value ? new Date(`${input.value}T00:00:00`) : new Date();
    Object.assign(this.state, { input, year: value.getFullYear(), month: value.getMonth() });
    const host = input.closest('dialog[open]') || document.body; // внутри модального окна — иначе окажется под ним
    const box = document.createElement('div');
    box.className = 'dp';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Выбор даты');
    host.appendChild(box);
    this.state.box = box;
    box.addEventListener('pointerdown', event => event.stopPropagation());
    box.addEventListener('click', event => this._click(event));
    this.draw();
    this.place();
  }

  /** Закрыть календарь. */
  static close() {
    if (this.state.box) this.state.box.remove();
    this.state.box = null;
    this.state.input = null;
  }

  /** Поставить календарь у поля (на телефоне — снизу листом). */
  static place() {
    const { box, input } = this.state;
    if (!box || !input) return;
    if (Mobile.isPhone()) {
      box.classList.add('sheet');
      box.style.removeProperty('left');
      box.style.removeProperty('top');
      return;
    }
    const rect = input.getBoundingClientRect();
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const left = Math.min(Math.max(this.GAP, rect.left), innerWidth - width - this.GAP);
    let top = rect.bottom + this.OFFSET;
    if (top + height > innerHeight - this.GAP) top = Math.max(this.GAP, rect.top - height - this.OFFSET);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  /** Нарисовать месяц. */
  static draw() {
    const { box, input, year, month } = this.state;
    if (!box || !input) return;
    WorkCalendar.year(year);
    const shift = (new Date(year, month, 1).getDay() + this.WORK_DAYS + 1) % this.WEEK.length;
    const days = new Date(year, month + 1, 0).getDate();
    const counted = { off: 0 };
    let cells = '<span></span>'.repeat(shift);
    for (let day = 1; day <= days; day++) cells += this._cell(new Date(year, month, day), counted);
    const cal = WorkCalendar.years[year];
    const week = this.WEEK.map((name, i) => `<span${i >= this.WORK_DAYS ? ' class="we"' : ''}>${name}</span>`).join('');
    box.innerHTML = `<div class="dp-h"><button type="button" class="dp-nav" data-dpm="-1" aria-label="Предыдущий месяц">‹</button><b>${this.MONTHS[month]} ${year}</b><button type="button" class="dp-nav" data-dpm="1" aria-label="Следующий месяц">›</button></div>
    <div class="dp-w">${week}</div>
    <div class="dp-g">${cells}</div>
    <div class="dp-l"><span><i class="hol"></i>праздник</span><span><i class="wkd"></i>выходной</span><span><i class="short"></i>сокращённый</span><span><i class="work"></i>рабочий перенос</span></div>
    <div class="dp-f"><span class="muted">${days - counted.off} раб. дн. · ${this._source(cal)}</span><span class="sp"></span>
      ${input.required ? '' : '<button type="button" class="lnk" data-dpx="clear">Очистить</button>'}<button type="button" class="lnk" data-dpx="today">Сегодня</button></div>`;
  }

  static _source(cal) {
    if (!cal) return 'загружаю календарь…';
    return cal.approx ? 'приблизительно' : 'произв. календарь';
  }

  static _cell(date, counted) {
    const { input } = this.state;
    const iso = isoDay(date);
    const kind = WorkCalendar.day(date);
    if (kind.off) counted.off++;
    const min = input.min || '';
    const max = input.max || '';
    const disabled = (min && iso < min) || (max && iso > max);
    const title = [date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }), kind.t]
      .filter(Boolean)
      .join(' — ');
    const classes = `${kind.off ? ' off' : ''}${kind.cls ? ` ${kind.cls}` : ''}${iso === input.value ? ' sel' : ''}${iso === isoDay(new Date()) ? ' today' : ''}`;
    return `<button type="button" class="dp-d${classes}" data-dpd="${iso}"${disabled ? ' disabled' : ''} title="${esc(title)}">${date.getDate()}</button>`;
  }

  static _set(iso) {
    const input = this.state.input;
    if (!input) return;
    input.value = iso;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.close();
  }

  static _click(event) {
    const day = event.target.closest('[data-dpd]');
    if (day && !day.disabled) {
      this._set(day.dataset.dpd);
      return;
    }
    const nav = event.target.closest('[data-dpm]');
    if (nav) {
      this._turn(+nav.dataset.dpm);
      return;
    }
    const action = event.target.closest('[data-dpx]');
    if (!action) return;
    if (action.dataset.dpx === 'clear') this._set('');
    else if (action.dataset.dpx === 'today') this._set(isoDay(new Date()));
  }

  static _turn(step) {
    const state = this.state;
    state.month += step;
    if (state.month < 0) {
      state.month = this.DECEMBER;
      state.year--;
    }
    if (state.month > this.DECEMBER) {
      state.month = 0;
      state.year++;
    }
    this.draw();
  }

  // щелчок по полю даты — свой календарь вместо встроенного (во всех формах программы)
  static _pointer(event) {
    const input = event.target.closest && event.target.closest('input[type=date]');
    if (!input) {
      if (this.state.box && !this.state.box.contains(event.target)) this.close();
      return;
    }
    if (input.disabled || input.readOnly) return;
    event.preventDefault(); // встроенный календарь и клавиатура телефона не открываются
    if (this.state.input === input) this.close();
    else this.open(input);
  }

  static _key(event) {
    if (this.state.box && event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.close();
      return;
    }
    const input = event.target;
    const opens = (event.altKey && event.key === 'ArrowDown') || event.key === 'F4';
    if (input && input.type === 'date' && opens) {
      event.preventDefault();
      this.open(input);
    }
  }

  /** Обработчики полей дат. */
  static listen() {
    document.addEventListener('pointerdown', event => this._pointer(event), true);
    document.addEventListener('keydown', event => this._key(event), true);
    window.addEventListener('resize', () => this.close());
    document.addEventListener(
      'scroll',
      event => {
        if (this.state.box && !this.state.box.contains(event.target)) this.place();
      },
      true,
    );
    // встроенный календарь браузера открывается по щелчку — его не показываем
    document.addEventListener(
      'click',
      event => {
        const input = event.target.closest && event.target.closest('input[type=date]');
        if (input && !input.disabled && !input.readOnly) event.preventDefault();
      },
      true,
    );
  }
}
