/** Правка на модерации «было → стало»: значения полей с выделением изменённого (слова, блоки описания, строки таблиц). */
export class ModerationDiff {
  static ABSENT = '__absent__';
  static MAX_CELLS = 160000;
  static PICS = 12;
  static EMPTY = '<i class="muted">пусто</i>';
  static ATTRS = { cat: 'Категория', maker: 'Производитель', model: 'Модель', series: 'Серия', article: 'Артикул' };
  static SPACE = /^\s+$/;

  /**
   * Поле категории позиции; нет в её категории — то же поле любой другой категории (подпись и единица).
   * @param {object} change
   * @param {string} cat
   * @returns {object|null}
   */
  static field(change, cat) {
    if (!change.attr) return null;
    return (
      typeById(cat).fields.find(field => field.key === change.attr) ||
      TYPES.flatMap(type => type.fields).find(field => field.key === change.attr)
    );
  }

  /**
   * Подпись поля.
   * @param {object} change
   * @param {string} cat
   * @returns {string}
   */
  static label(change, cat) {
    if (!change.attr) return change.label;
    const field = this.field(change, cat);
    if (field) return field.label + (field.unit ? `, ${field.unit}` : '');
    return this.ATTRS[change.attr] || `Параметр «${change.attr}»`;
  }

  /**
   * Пустое значение.
   * @param {*} value
   * @returns {boolean}
   */
  static empty(value) {
    return value === this.ABSENT || value == null || value === '' || (Array.isArray(value) && !value.length);
  }

  /**
   * Значение обрезано сервером (слишком большое).
   * @param {*} value
   * @returns {boolean}
   */
  static big(value) {
    return value && typeof value === 'object' && '__truncated__' in value;
  }

  static _lcs(from, target) {
    const table = Array.from({ length: from.length + 1 }, () => new Uint16Array(target.length + 1));
    for (let i = from.length - 1; i >= 0; i--) {
      for (let j = target.length - 1; j >= 0; j--) {
        table[i][j] = from[i] === target[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  static _mark(word, tag) {
    return this.SPACE.test(word) ? esc(word) : `<${tag}>${esc(word)}</${tag}>`;
  }

  /**
   * Слова: общие — как есть, убранные (было) и добавленные (стало) — выделены.
   * @param {string} before
   * @param {string} after
   * @returns {string[]} [было, стало]
   */
  static words(before, after) {
    const from = String(before ?? '').split(/(\s+)/);
    const target = String(after ?? '').split(/(\s+)/);
    if (from.length * target.length > this.MAX_CELLS) return [`<del>${esc(before)}</del>`, `<ins>${esc(after)}</ins>`];
    const table = this._lcs(from, target);
    let i = 0;
    let j = 0;
    const was = [];
    const now = [];
    while (i < from.length && j < target.length) {
      if (from[i] === target[j]) {
        was.push(esc(from[i++]));
        now.push(esc(target[j++]));
      } else if (table[i + 1][j] >= table[i][j + 1]) was.push(this._mark(from[i++], 'del'));
      else now.push(this._mark(target[j++], 'ins'));
    }
    while (i < from.length) was.push(this._mark(from[i++], 'del'));
    while (j < target.length) now.push(this._mark(target[j++], 'ins'));
    return [was.join(''), now.join('')];
  }

  /**
   * Картинки значения.
   * @param {object|object[]} value
   * @returns {string}
   */
  static pics(value) {
    const list = (Array.isArray(value) ? value : [value]).filter(pic => pic && pic.src && pic.on !== false);
    if (!list.length) return '';
    return `<div class="mv-pics">${list
      .slice(0, this.PICS)
      .map(pic => `<img src="${esc(pic.src)}" alt="" loading="lazy">`)
      .join('')}</div>`;
  }

  static _blocks(list) {
    return (Array.isArray(list) ? list : []).filter(block => block && (block.label || block.text));
  }

  static _blockKey(block) {
    return `${block.label || ''}\n${block.text || ''}`;
  }

  static _block(block, { others, same, side }) {
    const label = block.label ? `<b>${esc(block.label)}.</b> ` : '';
    if (same.has(this._blockKey(block))) return `<p>${label}${esc(block.text || '')}</p>`;
    const pair = others.find(other => (other.label || '') === (block.label || ''));
    if (!pair) return `<p class="mv-chg">${label}${esc(block.text || '')}</p>`;
    const text =
      side === 'a'
        ? this.words(pair.text || '', block.text || '')[1]
        : this.words(block.text || '', pair.text || '')[0];
    return `<p class="mv-chg1">${label}${text}</p>`;
  }

  /**
   * Блоки описания: без изменений — как есть; тот же заголовок с другим текстом — изменённые слова; новый или убранный
   * блок — целиком.
   * @param {object[]} value
   * @param {object[]} other значение другой стороны
   * @param {string} [side] b — было, a — стало
   * @returns {string}
   */
  static blocks(value, other, side = 'b') {
    const others = this._blocks(other);
    const same = new Set(others.map(block => this._blockKey(block)));
    return this._blocks(value)
      .map(block => this._block(block, { others, same, side }))
      .join('');
  }

  static _flat(groups) {
    return (Array.isArray(groups) ? groups : []).flatMap(group =>
      (group.rows || []).filter(row => row.k || row.v).map(row => [group.name || '', row.k || '', String(row.v ?? '')]),
    );
  }

  /**
   * Таблица характеристик; изменённые строки выделены.
   * @param {object[]} value
   * @param {object[]} other
   * @returns {string}
   */
  static rows(value, other) {
    const same = new Set(this._flat(other).map(row => row.join('\n')));
    const rows = this._flat(value);
    if (!rows.length) return '';
    return `<table class="pv-t mv-rows">${rows.map(row => `<tr class="${same.has(row.join('\n')) ? '' : 'mv-chg'}"><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join('')}</table>`;
  }

  static _pair(side, mine, theirs) {
    return side === 'a' ? this.words(theirs, mine)[1] : this.words(mine, theirs)[0];
  }

  static _attr(change, { value, other, side, cat }) {
    if (change.attr === 'cat') return esc(typeById(value).name);
    const field = this.field(change, cat);
    const text = field ? fmtField(field, value) : String(value);
    let theirs = '';
    if (!this.empty(other) && !this.big(other)) theirs = field ? fmtField(field, other) : String(other);
    return this._pair(side, text, theirs);
  }

  static _rich(change, { value, other, side }) {
    if (change.key === 'photo' || change.key === 'logo' || change.key === 'gallery')
      return this.pics(value) || this.EMPTY;
    if (change.key === 'features') return this.blocks(value, other, side) || this.EMPTY;
    if (change.key === 'groups') return this.rows(value, other) || this.EMPTY;
    return null;
  }

  static _plain(value, { other, side }) {
    if (typeof value !== 'string' && typeof value !== 'number')
      return `<pre class="mv-pre">${esc(JSON.stringify(value, null, 1))}</pre>`;
    const theirs = this.empty(other) || this.big(other) || typeof other === 'object' ? '' : String(other);
    return this._pair(side, String(value), theirs);
  }

  /**
   * Значение поля «было» или «стало».
   * @param {object} change поле правки
   * @param {{value: *, other: *, side: string, cat: string}} view other — значение другой стороны, side — b | a
   * @returns {string}
   */
  static val(change, view) {
    const { value } = view;
    if (this.empty(value)) return this.EMPTY;
    if (this.big(value))
      return `<i class="muted">большое значение (${Fmt.num(value.__truncated__)} знаков) — см. «Расширенное»</i>`;
    if (change.attr) return this._attr(change, view);
    return this._rich(change, view) ?? this._plain(value, view);
  }

  /**
   * Карточка нового товара — как в каталоге: фото, название, параметры, описание, характеристики.
   * @param {object} doc
   * @returns {string}
   */
  static card(doc) {
    const attrs = doc.attrs || {};
    const type = typeById(attrs.cat);
    const params = [
      ['Категория', type.name],
      ['Производитель', attrs.maker],
      ['Серия', attrs.series],
      ['Модель', attrs.model],
      ...type.fields.map(field => [field.label, fmtField(field, attrs[field.key])]),
    ].filter(([, value]) => value != null && value !== '');
    const feats = this.blocks(doc.features, doc.features);
    const rows = this.rows(doc.groups, doc.groups);
    return `<div class="mv-card">${this.pics([doc.photo, ...(doc.gallery || [])].filter(Boolean))}
      <h4>${esc(doc.name || 'Без названия')}</h4>${doc.spec ? `<p class="muted">${esc(doc.spec)}</p>` : ''}
      ${doc.price ? `<p><b>${money(doc.price)} ${curSh(doc.priceCur || 'RUB')}</b></p>` : ''}
      ${params.length ? `<table class="pv-t">${params.map(([key, value]) => `<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('')}</table>` : ''}
      ${feats ? `<p class="pv-cap">Описание</p>${feats}` : ''}
      ${rows ? `<p class="pv-cap">Характеристики</p>${rows}` : ''}</div>`;
  }
}
