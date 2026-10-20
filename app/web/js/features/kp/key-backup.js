/**
 * Резервная копия ключей API: файл JSON, по желанию зашифрованный паролем (PBKDF2-SHA256 + AES-GCM, Web Crypto в
 * браузере). file — загруженный файл копии: {name, at, keys, enc, err}.
 */
export class KeyBackup {
  static file = null;
  static crypto = !!(window.crypto && crypto.subtle);
  static ITERATIONS = 250000;
  static SALT_BYTES = 16;
  static IV_BYTES = 12;
  static KEY_BITS = 256;
  static MASK_FROM = 10;
  static MASK_KEEP = 4;
  static DATE_TIME = 16;

  static _b64(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  static _bin(text) {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
  }

  static async _key(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: this.KEY_BITS },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Зашифровать текст паролем.
   * @param {string} text
   * @param {string} password
   * @returns {Promise<object>}
   */
  static async encrypt(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_BYTES));
    const vector = crypto.getRandomValues(new Uint8Array(this.IV_BYTES));
    const iter = this.ITERATIONS;
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: vector },
      await this._key(password, salt, iter),
      new TextEncoder().encode(text),
    );
    return {
      alg: 'PBKDF2-SHA256/AES-256-GCM',
      iter,
      salt: this._b64(salt),
      iv: this._b64(vector),
      data: this._b64(data),
    };
  }

  /**
   * Расшифровать копию.
   * @param {object} enc
   * @param {string} password
   * @returns {Promise<string>}
   */
  static async decrypt(enc, password) {
    if (!this.crypto) throw new Error('нет Web Crypto');
    const data = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this._bin(enc.iv) },
      await this._key(password, this._bin(enc.salt), enc.iter || this.ITERATIONS),
      this._bin(enc.data),
    );
    return new TextDecoder().decode(data);
  }

  static _mask(value) {
    const text = String(value);
    return text.length > this.MASK_FROM ? `${text.slice(0, this.MASK_KEEP)}…${text.slice(-this.MASK_KEEP)}` : '•••';
  }

  /**
   * Что есть в файле копии: отметить, какие ключи восстановить (по умолчанию — все; текущие заменятся).
   * @param {object} current ключи программы (маски)
   * @param {{fields: object[], daily: object}} keys описание полей ключей
   * @returns {string}
   */
  static importHtml(current, keys) {
    const file = this.file;
    if (!file) return '';
    const head = `<p class="sub">Файл «${esc(file.name)}»${file.at ? ` от ${esc(String(file.at).slice(0, this.DATE_TIME).replace('T', ' '))}` : ''}</p>`;
    if (!file.keys) return this._locked(head, file);
    const names = Object.keys(file.keys).filter(name => file.keys[name] != null && file.keys[name] !== '');
    const rows = names.length
      ? names.map(id => this._row({ id, file, current, keys })).join('')
      : '<p class="muted">В файле нет ключей.</p>';
    return `<div class="key-imp">${head}${rows}
    <div class="row"><button class="btn primary" type="button" data-kiok${names.length ? '' : ' disabled'}>Восстановить отмеченные</button><button class="btn ghost" type="button" data-kix>Отмена</button></div></div>`;
  }

  static _locked(head, file) {
    return `<div class="key-imp">${head}<p class="muted">Файл зашифрован паролем.</p>${file.err ? `<p class="msg err">${esc(file.err)}</p>` : ''}
    <div class="row"><input type="password" data-kipw placeholder="пароль копии" autocomplete="off"${this.crypto ? '' : ' disabled'}><button class="btn primary" type="button" data-kidec>Расшифровать</button><button class="btn ghost" type="button" data-kix>Отмена</button></div></div>`;
  }

  static _row({ id, file, current, keys }) {
    const field = keys.fields.find(row => row.id === id) || {};
    const label = field.t || keys.daily[id] || id;
    const value = keys.daily[id] ? esc(file.keys[id]) : esc(this._mask(file.keys[id]));
    const replaces = field.mask && current[field.mask] ? ' · заменит текущий' : '';
    return `<label class="ck"><input type="checkbox" data-kik="${esc(id)}" checked> <b>${esc(label)}</b> <span class="muted">${value}${replaces}</span></label>`;
  }
}
