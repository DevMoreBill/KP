import { Suppliers } from './suppliers.js';
import { Str } from '../../core/str.js';
import { Attrs } from '../../core/item-attrs.js';

/**
 * Поиск по каталогу: «DVK30-13» = «DVK D 30-13», «5.5» = «5,5», «далгакиран» = «Dalgakiran», латинская «C» в «СА11» =
 * кириллическая. Поисковая строка и атрибуты запоминаются на карточке.
 */
export class CatalogIndex {
  static TRANSLIT = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  static HOMOGLYPH = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' };
  static MIN_FOLD = 2;
  /** ревизия поисковых строк: позиция изменилась — отборы считают совпадения с поиском заново */
  static rev = 0;

  /**
   * Транслит.
   * @param {string} text
   * @returns {string}
   */
  static translit(text) {
    return text.replace(/[а-я]/g, char => this.TRANSLIT[char] ?? char);
  }

  /**
   * Свёрнутая форма: кириллица, похожая на латиницу, — латиницей, без пробелов и знаков.
   * @param {string} text
   * @returns {string}
   */
  static fold(text) {
    return text.replace(/[авекмнорстух]/g, char => this.HOMOGLYPH[char]).replace(/[\s\-./,_()×x*]+/g, '');
  }

  /**
   * Атрибуты позиции (с запоминанием на позиции).
   * @param {object} card
   * @returns {object}
   */
  static attrs(card) {
    if (!card._a) card._a = Attrs.of(card);
    return card._a;
  }

  /**
   * Нормализованное значение атрибута (с запоминанием).
   * @param {object} card
   * @param {string} key
   * @returns {string}
   */
  static normValue(card, key) {
    if (!card._nv) card._nv = {};
    const memo = card._nv;
    if (!(key in memo)) memo[key] = Str.norm(this.attrs(card)[key]);
    return memo[key];
  }

  /**
   * Позиция изменилась — запомненное сбрасывается, совпадения с поиском считаются заново.
   * @param {object} card
   */
  static forget(card) {
    delete card._a;
    delete card._nv;
    delete card._hay;
    delete card._sup;
    delete card._pq;
    this.changed();
  }

  /** Позиции изменились (правка, загружен список) — отборы считают совпадения с поиском заново. */
  static changed() {
    this.rev++;
  }

  /**
   * Артикул.
   * @param {object} card
   * @returns {string}
   */
  static art(card) {
    return card.art || card.feed?.sku || this.attrs(card).article || '';
  }

  /**
   * Есть на складе поставщика.
   * @param {object} card
   * @returns {boolean}
   */
  static inStock(card) {
    const stock = card.stock;
    if (!stock || stock.gone) return false;
    return stock.qty != null ? stock.qty > 0 : !!stock.available;
  }

  static _plain(card, attrs) {
    const rows = (card.groups || []).flatMap(group => (group.rows || []).map(row => `${row.k} ${row.v}`));
    return Str.norm(
      [card.name, card.spec, card.st || '', this.art(card), Suppliers.of(card), ...Object.values(attrs), ...rows].join(
        ' ',
      ),
    );
  }

  /**
   * Поисковая строка позиции (один раз): текст, свёрнутый текст, транслит, модель без пробелов и знаков.
   * @param {object} card
   * @returns {object}
   */
  static hay(card) {
    if (card._hay) return card._hay;
    const attrs = this.attrs(card);
    const plain = this._plain(card, attrs);
    // транслит — только название, марка, модель, артикул: транслит всего текста занимал около трети памяти поиска
    const short = Str.norm(
      [card.name, attrs.maker, attrs.model, attrs.series, this.art(card), Suppliers.of(card)].filter(Boolean).join(' '),
    );
    const model = Str.norm([attrs.model, card.name, this.art(card)].filter(Boolean).join(' '));
    card._hay = {
      plain,
      fold: this.fold(plain),
      tr: this.translit(short),
      model: this.fold(model),
      model2: this.fold(model.replace(/(^|\s)[a-zа-яё](?=\s)/g, ' ')), // «DVK D 30-13» → «dvk3013»
      m0: this.fold(Str.norm(attrs.model || '')),
      name: Str.norm(card.name),
    };
    return card._hay;
  }

  /**
   * Слово запроса с готовыми «свёрнутой» формой и транслитом (один раз на запрос).
   * @param {string} word
   * @returns {{w: string, f: string, t: string}}
   */
  static word(word) {
    return { w: word, f: this.fold(word), t: this.translit(word) };
  }

  /**
   * Слово запроса есть в поисковой строке.
   * @param {object} hay
   * @param {{w: string, f: string, t: string}} word
   * @returns {boolean}
   */
  static wordHit(hay, word) {
    if (hay.plain.includes(word.w)) return true;
    if (word.f.length >= this.MIN_FOLD && (hay.fold.includes(word.f) || hay.model2.includes(word.f))) return true;
    return word.t !== word.w && hay.tr.includes(word.t);
  }
}
