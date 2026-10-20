/**
 * Воронки кабинета: своя воронка программы и воронки, повторяющие Битрикс24 (стадии — как в Битриксе). Закрытые стадии на
 * доске — две колонки: «успех» и «провал» (у воронки Битрикса провалов несколько — стадия видна в карточке как причина).
 */
export class CrmFunnel {
  static KEY = 'kp.cab.funnel';
  static MAIN = 'main';
  static TONES = 4;
  static cache = [];
  static picked = null;

  /**
   * Все воронки (ответ доски или карточки сделки).
   * @returns {object[]}
   */
  static all() {
    const fromBoard = typeof CrmData !== 'undefined' && CrmData.board && CrmData.board.funnels;
    return fromBoard || this.cache;
  }

  /**
   * Воронки для выбора (без скрытых администратором).
   * @returns {object[]}
   */
  static visible() {
    return this.all().filter(funnel => !funnel.hidden);
  }

  /**
   * Воронка по id (неизвестная — своя воронка программы).
   * @param {string} id
   * @returns {object}
   */
  static get(id) {
    const list = this.all();
    return (
      list.find(funnel => funnel.id === (id || this.MAIN)) ||
      list.find(funnel => funnel.id === this.MAIN) || { id: this.MAIN, name: '', stages: [] }
    );
  }

  /**
   * Воронка сделки.
   * @param {object} deal
   * @returns {object}
   */
  static of(deal) {
    return this.get(deal && deal.funnel);
  }

  /**
   * Открытая на доске воронка: выбранная раньше, иначе та, где больше сделок в работе.
   * @param {object[]} [deals]
   * @returns {string}
   */
  static current(deals = []) {
    const visible = this.visible();
    if (this.picked === null) this.picked = this._stored();
    if (visible.some(funnel => funnel.id === this.picked)) return this.picked;
    const counts = visible.map(funnel => [funnel.id, this.count(funnel.id, deals)]);
    counts.sort((one, two) => two[1] - one[1]);
    return counts.length ? counts[0][0] : this.MAIN;
  }

  /**
   * Запомнить выбранную воронку (в этом браузере).
   * @param {string} id
   */
  static set(id) {
    this.picked = id;
    try {
      localStorage.setItem(this.KEY, id);
    } catch {
      // без памяти выбора
    }
  }

  static _stored() {
    try {
      return localStorage.getItem(this.KEY) || '';
    } catch {
      return '';
    }
  }

  /**
   * Сделок в работе в воронке.
   * @param {string} id
   * @param {object[]} deals
   * @returns {number}
   */
  static count(id, deals) {
    return deals.filter(deal => (deal.funnel || this.MAIN) === id && !this.closed(deal)).length;
  }

  /**
   * Сделка закрыта (успех или провал).
   * @param {object} deal
   * @returns {boolean}
   */
  static closed(deal) {
    return deal.stage === 'won' || deal.stage === 'lost';
  }

  /**
   * Колонки доски: открытые стадии и две закрытые (успех, провал).
   * @param {string} id
   * @returns {object[]}
   */
  static columns(id) {
    const stages = this.get(id).stages || [];
    const won = stages.filter(stage => stage.sem === 'won');
    const lost = stages.filter(stage => stage.sem === 'lost');
    return [
      ...stages.filter(stage => !stage.sem),
      { key: 'won', label: won.length === 1 ? won[0].label : 'Выиграно', closed: true },
      { key: 'lost', label: lost.length === 1 ? lost[0].label : 'Проиграно', closed: true },
    ];
  }

  /**
   * Стадия сделки (точная — у воронки Битрикса).
   * @param {object} deal
   * @returns {{key: string, label: string, color?: string}}
   */
  static stage(deal) {
    const key = deal.fstage || deal.stage;
    const found = (this.of(deal).stages || []).find(stage => stage.key === key);
    return found || this.columns(deal.funnel).find(stage => stage.key === key) || { key, label: key };
  }

  /**
   * Название стадии сделки.
   * @param {object} deal
   * @returns {string}
   */
  static label(deal) {
    return this.stage(deal).label;
  }

  /**
   * Название стадии по ключу в любой воронке (история сделки).
   * @param {string} key
   * @returns {string}
   */
  static anyLabel(key) {
    for (const funnel of this.all()) {
      const found = (funnel.stages || []).find(stage => stage.key === key);
      if (found) return found.label;
    }
    return key;
  }

  /**
   * Цвет стадии для классов t-*: открытые — от светлого к тёмному по порядку, «won» — зелёный, «lost» — серый.
   * @param {string} id воронка
   * @param {string} key стадия (столбец доски)
   * @returns {string}
   */
  static tone(id, key) {
    if (key === 'won' || key === 'lost') return key;
    const open = this.columns(id).filter(stage => !stage.closed);
    const index = Math.max(
      0,
      open.findIndex(stage => stage.key === key),
    );
    return `s${Math.round((index / Math.max(1, open.length - 1)) * this.TONES)}`;
  }

  /**
   * Цвет сделки.
   * @param {object} deal
   * @returns {string}
   */
  static toneOf(deal) {
    return this.tone(deal.funnel, deal.stage);
  }

  /**
   * Стадии провала воронки.
   * @param {string} id
   * @returns {object[]}
   */
  static failures(id) {
    return (this.get(id).stages || []).filter(stage => stage.sem === 'lost');
  }

  /**
   * Выбор воронки над доской (когда воронок больше одной).
   * @param {object[]} deals
   * @param {string} cur
   * @returns {string}
   */
  static switcher(deals, cur) {
    const visible = this.visible();
    if (visible.length < 2) return '';
    const options = visible
      .map(
        funnel =>
          `<option value="${esc(funnel.id)}"${funnel.id === cur ? ' selected' : ''}>${esc(funnel.name)} (${this.count(funnel.id, deals)})</option>`,
      )
      .join('');
    return `<select id="cabFunnel" class="cab-sort cab-fn" aria-label="Воронка">${options}</select>`;
  }
}
