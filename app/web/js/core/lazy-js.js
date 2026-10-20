/**
 * Модули, нужные только по кнопке (выгрузка ТЗ, «Нормы станций»), — загружаются при первом открытии, а не со всей программой;
 * адрес с меткой версии — из <template id="lazyJs"> в index.html.
 */
export class LazyJs {
  static loading = {};
  static FAILED = 'модуль программы не загрузился — проверьте связь с сервером';

  /**
   * @param {string} name путь от папки features/, например «tz-out/index.js»
   * @returns {Promise<*>}
   */
  static load(name) {
    if (this.loading[name]) return this.loading[name];
    const el = this._tag(name);
    const src = el ? el.getAttribute('src') : `/web/js/features/${name}`;
    this.loading[name] = el && el.type === 'module' ? this._module(name, src) : this._script(name, src);
    return this.loading[name];
  }

  static _tag(name) {
    const tpl = document.getElementById('lazyJs');
    if (!tpl) return null;
    return [...tpl.content.querySelectorAll('script')].find(script =>
      script.getAttribute('src').split('?')[0].endsWith(`/${name}`),
    );
  }

  static _module(name, src) {
    return import(src).catch(() => {
      delete this.loading[name];
      throw new Error(this.FAILED);
    });
  }

  static _script(name, src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        delete this.loading[name];
        script.remove();
        reject(new Error(this.FAILED));
      };
      document.head.appendChild(script);
    });
  }
}

/** Картинка, файл которой пропал (перемещён, удалён, не скопирован), — спокойная заглушка «нет фото» вместо сломанной. */
export class ImgMiss {
  static SRC = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" rx="10" fill="#eef3f9"/><path d="M52 78l20-24 14 16 10-11 18 19z" fill="#c3d2e4"/><circle cx="98" cy="44" r="8" fill="#c3d2e4"/><text x="80" y="104" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#8aa0b8">нет фото</text></svg>')}`;

  /** Обработчик страницы. */
  static listen() {
    document.addEventListener(
      'error',
      event => {
        const img = event.target;
        if (!img || img.tagName !== 'IMG' || img.src === this.SRC) return;
        img.dataset.miss = '1';
        img.alt = img.alt || 'нет фото';
        img.src = this.SRC;
      },
      true,
    );
  }
}
