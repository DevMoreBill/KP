/**
 * Связь с сервером отдела: запрос не дошёл — полоса сверху «Нет связи…», программа проверяет связь сама и убирает полосу,
 * когда сервер снова отвечает. Правки КП при этом остаются в черновике браузера.
 */
export class ServerLink {
  static RETRY_MS = 10000;
  static PING = '/api/version';
  static timer = 0;
  static lost = false;
  static waiting = [];

  /**
   * Сделать, когда сервер снова ответит (один раз).
   * @param {() => void} done
   */
  static onBack(done) {
    this.waiting.push(done);
  }

  /** Запрос не дошёл до сервера. */
  static gone() {
    if (this.lost) return;
    this.lost = true;
    this._bar().hidden = false;
    this._retry();
  }

  /** Сервер ответил. */
  static back() {
    if (!this.lost) return;
    this.lost = false;
    clearTimeout(this.timer);
    this._bar().hidden = true;
    const waiting = this.waiting.splice(0);
    waiting.forEach(done => done());
  }

  static _retry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        const reply = await fetch(this.PING, { cache: 'no-store' });
        if (reply.ok) {
          this.back();
          return;
        }
      } catch {
        // всё ещё нет связи
      }
      this._retry();
    }, this.RETRY_MS);
  }

  static _bar() {
    let bar = document.getElementById('linkBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'linkBar';
      bar.className = 'link-bar';
      bar.setAttribute('role', 'alert');
      bar.hidden = true;
      bar.textContent =
        'Нет связи с сервером отдела. Правки КП сохраняются в браузере и уйдут на сервер, когда связь вернётся — программа проверяет её сама.';
      document.body.prepend(bar);
    }
    return bar;
  }
}
