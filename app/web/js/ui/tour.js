import { esc } from '../core/util.js';

/**
 * Тур первого входа: 6 подсказок по главным кнопкам (раз на устройство; повторить — «⋯ → Обзор программы»).
 * Кнопка, которой нет на экране (например, на телефоне), пропускается.
 */
export class Tour {
  static STORE = 'kp.tour';
  static START_MS = 2500;
  static GAP = 10;
  static WIDTH = 300;
  // [где, заголовок, что сказать]
  static STEPS = [
    [
      '[data-tab="kp"]',
      'КП',
      'Здесь собирается коммерческое предложение: клиент, оборудование, условия, цена — шаг за шагом.',
    ],
    ['#btnNew', 'Новое КП', 'Начать новое КП — с чистого листа или по заготовке. Открытые КП остаются вкладками.'],
    ['[data-tab="cab"]', 'Кабинет', 'Дела на сегодня, сделки и график. Новая заявка — кнопкой «＋ Новое».'],
    ['[data-tab="cat"]', 'Каталог', 'Оборудование с ценами и наличием: найти, сравнить, добавить в КП.'],
    [
      '[data-a="find"]',
      'Найти',
      'Одна строка для всего: КП, клиент, сделка, модель. Можно писать фразами: «просроченные», «без ответа».',
    ],
    ['.topmenu,[data-tab="more"]', 'Ещё', 'Мои настройки, тема, руководство и «Сообщить о проблеме».'],
  ];
  static step = -1;
  static box = null;

  /** Показать один раз — после загрузки, если не открыты окна. */
  static later() {
    if (this._done()) return;
    setTimeout(() => {
      if (!document.querySelector('dialog[open]') && !this._done()) this.start();
    }, this.START_MS);
  }

  /** Начать сначала. */
  static start() {
    this.step = -1;
    this._next();
  }

  static _done() {
    try {
      return localStorage.getItem(this.STORE) === '1';
    } catch {
      return true;
    }
  }

  static _target(selector) {
    return [...document.querySelectorAll(selector)].find(el => el.getClientRects().length && el.offsetParent !== null);
  }

  static _next() {
    for (let i = this.step + 1; i < this.STEPS.length; i++) {
      if (this._target(this.STEPS[i][0])) {
        this.step = i;
        this._show();
        return;
      }
    }
    this.finish();
  }

  /** Закрыть и больше не показывать. */
  static finish() {
    document.querySelector('.tour-hit')?.classList.remove('tour-hit');
    this.box?.remove();
    this.box = null;
    try {
      localStorage.setItem(this.STORE, '1');
    } catch {
      // без хранилища — покажется снова
    }
  }

  static _show() {
    const [selector, title, text] = this.STEPS[this.step];
    const target = this._target(selector);
    document.querySelector('.tour-hit')?.classList.remove('tour-hit');
    target.classList.add('tour-hit');
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.className = 'tour';
      this.box.setAttribute('role', 'dialog');
      this.box.addEventListener('click', event => {
        if (event.target.closest('[data-tourx]')) this.finish();
        else if (event.target.closest('[data-tourn]')) this._next();
      });
      document.body.append(this.box);
    }
    const last = !this.STEPS.slice(this.step + 1).some(([where]) => this._target(where));
    this.box.innerHTML = `<b>${esc(title)}</b><p>${esc(text)}</p><div class="row"><button class="btn ghost sm" type="button" data-tourx>Пропустить</button><span class="sp"></span><button class="btn primary sm" type="button" data-tourn>${last ? 'Готово' : 'Далее →'}</button></div>`;
    if (last) this.box.querySelector('[data-tourn]').setAttribute('data-tourx', '');
    this._place(target.getBoundingClientRect());
  }

  // под кнопкой, если помещается, иначе над ней; по ширине — в пределах экрана
  static _place(rect) {
    const box = this.box;
    const width = Math.min(this.WIDTH, window.innerWidth - this.GAP * 2);
    box.style.width = `${width}px`;
    const left = Math.min(Math.max(this.GAP, rect.left), window.innerWidth - width - this.GAP);
    box.style.left = `${left}px`;
    const below = rect.bottom + this.GAP;
    const fits = below + box.offsetHeight < window.innerHeight;
    box.style.top = `${fits ? below : Math.max(this.GAP, rect.top - box.offsetHeight - this.GAP)}px`;
  }
}
