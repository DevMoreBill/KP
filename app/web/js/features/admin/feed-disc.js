import { AdminApi } from './admin-core.js';
import { FeedFmt, FeedState } from './feed-state.js';
import { FeedsTab } from './feeds-tab.js';

/** Сетка скидок поставщика: правила по категориям, приводу и мощности, «остальное», серии по приводу. */
export class FeedDiscounts {
  static SAMPLE = 3;
  static ACTIONS = { discadd: '_add', discdel: '_drop', discplan: '_plan', discsave: '_save', discapply: '_apply' };

  /**
   * Сетка открытого фида (правится до сохранения).
   * @param {object} feed
   * @returns {object}
   */
  static of(feed) {
    if (!FeedState.disc || FeedState.disc.id !== feed.id)
      FeedState.disc = {
        id: feed.id,
        discount: feed.discount ?? '',
        driveHints: { ...(feed.driveHints || {}) },
        discounts: JSON.parse(JSON.stringify(feed.discounts || [])),
      };
    return FeedState.disc;
  }

  /**
   * Категории правила одной строкой.
   * @param {string[]} cats
   * @returns {string}
   */
  static catsText(cats) {
    return (cats || []).length ? cats.map(id => FeedFmt.typeName(id)).join(', ') : 'любая категория';
  }

  static _num(value) {
    return value == null ? '' : FeedFmt.dec(value);
  }

  static _row(rule, index) {
    const types = FeedState.types
      .map(
        type =>
          `<label><input type="checkbox" data-fdc="${esc(type.id)}"${(rule.cats || []).includes(type.id) ? ' checked' : ''}> ${esc(type.name)}</label>`,
      )
      .join('');
    const drives = FeedState.DRIVES.map(
      ([value, title]) =>
        `<option value="${value}"${(rule.drive || 'any') === value ? ' selected' : ''}>${title}</option>`,
    ).join('');
    return `<tr data-fdr="${index}">
      <td><input type="text" data-fdd="label" value="${esc(rule.label || '')}" placeholder="Например: Ременные компрессоры до 75 кВт" aria-label="Название правила"></td>
      <td data-l="Категории"><details class="fd-dc" data-fdr="${index}"><summary>${esc(this.catsText(rule.cats))}</summary><div class="fd-dcl">${types}</div></details></td>
      <td data-l="Привод"><select data-fdd="drive" aria-label="Привод">${drives}</select></td>
      <td data-l="Мощность до, кВт"><input type="text" inputmode="decimal" data-fdd="kwMax" value="${esc(this._num(rule.kwMax))}" placeholder="любая" aria-label="Мощность до, кВт">
        <label class="fd-dku"${rule.kwMax ? '' : ' hidden'}><input type="checkbox" data-fdd="kwUnknown"${rule.kwUnknown ? ' checked' : ''}> не указана — тоже</label></td>
      <td data-l="Скидка, %"><input type="text" inputmode="decimal" data-fdd="pct" value="${esc(this._num(rule.pct))}" placeholder="%" aria-label="Скидка, %"></td>
      <td class="num"><button class="btn ghost" type="button" data-fd="discdel" data-i="${index}" title="Удалить правило" aria-label="Удалить правило">✕</button></td></tr>`;
  }

  static _tip(base) {
    return `<p>Закупка позиции = ${base} минус скидка. Правила проверяются сверху вниз: первое подходящее даёт скидку; не подошло ни одно — «Остальное оборудование».</p><p>Категория — категория программы у позиции каталога. Привод определяется по признаку частотника (VSD, инвертор), по сериям из полей ниже (в названии позиции или на листе прайса) и по строке «Привод» в характеристиках. Мощность — поле «Мощность» позиции; «до 75» — включительно. Если мощность у позиции не указана, правило с ограничением мощности её пропускает — или применяется, когда отмечено «не указана — тоже».</p><p>Цены обновляются у всех позиций производителя: и у загруженных из фида, и у заведённых вручную — для них строка прайса подбирается по серии, типоразмеру и исполнению (ресивер, осушитель, водяное охлаждение, частотник).</p><p>Закупка и цена, исправленные вручную в карточке, не меняются. Применённая скидка видна в карточке позиции.</p>`;
  }

  /**
   * Сетка скидок.
   * @param {object} feed
   * @returns {string}
   */
  static html(feed) {
    const disc = this.of(feed);
    const base = FeedFmt.costKind(feed) ? 'цены прайса' : 'РРЦ';
    return `<div class="fd-disc"><div class="row fd-dh"><div class="sub" style="margin:0">Сетка скидок поставщика${tip(this._tip(base))}</div>
      </div>
    <div class="fd-tw"><table class="fd-t fd-dt"><thead><tr><th>Правило</th><th>Категории</th><th>Привод</th><th>Мощность до, кВт</th><th>Скидка, %</th><th></th></tr></thead>
      <tbody>${disc.discounts.map((rule, index) => this._row(rule, index)).join('')}
      <tr class="fd-dother"><td><b>Остальное оборудование</b></td><td class="muted" colspan="3">всё, что не подошло под правила выше</td><td data-l="Скидка, %"><input type="text" inputmode="decimal" data-fddo="discount" value="${esc(this._num(disc.discount))}" placeholder="нет" aria-label="Скидка на остальное, %"></td><td></td></tr></tbody></table></div>
    <div class="row fd-fb"><button class="btn" type="button" data-fd="discadd">+ Правило</button></div>
    <div class="st-ed-g fd-dhint">
      <label class="f"><span>Серии с ременным приводом${tip('Через запятую. Ищутся в названии позиции и в названии листа прайса целым словом. Пример для Dalgakiran: TIDY, DVK, DS.')}</span><input type="text" data-fdh="belt" value="${esc(disc.driveHints.belt || '')}" placeholder="TIDY, DVK, DS"></label>
      <label class="f"><span>Серии с прямым приводом${tip('Через запятую; проверяются раньше ременных — «DVK D» точнее, чем «DVK». Частотник (VSD, INVERSYS, инвертор) определяется сам.')}</span><input type="text" data-fdh="direct" value="${esc(disc.driveHints.direct || '')}" placeholder="DVK D, IMPETUS, EAGLE"></label></div>
    <div class="row fd-fb"><button class="btn" type="button" data-fd="discplan">Показать распределение</button><button class="btn" type="button" data-fd="discsave">Сохранить сетку</button>
      <button class="btn primary" type="button" data-fd="discapply"${feed.linked ? '' : ' disabled title="Сначала загрузите позиции в каталог"'}>Сохранить и обновить цены</button></div>
    <div id="fdPlan">${FeedState.plan && FeedState.plan.id === feed.id ? this.plan(FeedState.plan) : ''}</div></div>`;
  }

  static _positive(value) {
    const number = parseFloat(
      String(value || '')
        .replace(/\s/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  static _readRow(rule, line) {
    rule.label = line.querySelector('[data-fdd=label]').value.trim();
    rule.drive = line.querySelector('[data-fdd=drive]').value;
    rule.kwMax = this._positive(line.querySelector('[data-fdd=kwMax]').value);
    rule.pct = this._positive(line.querySelector('[data-fdd=pct]').value);
    rule.kwUnknown = !!line.querySelector('[data-fdd=kwUnknown]')?.checked;
    rule.cats = [...line.querySelectorAll('[data-fdc]:checked')].map(box => box.dataset.fdc);
  }

  /**
   * Прочитать сетку с экрана.
   * @param {HTMLElement} main
   * @returns {object|null}
   */
  static read(main) {
    const disc = FeedState.disc;
    if (!disc) return disc;
    const box = main.querySelector('.fd-disc');
    if (!box) return disc;
    box.querySelectorAll('tr[data-fdr]').forEach(line => {
      const rule = disc.discounts[+line.dataset.fdr];
      if (rule) this._readRow(rule, line);
    });
    disc.discount = this._positive(box.querySelector('[data-fddo=discount]').value);
    box.querySelectorAll('[data-fdh]').forEach(input => {
      disc.driveHints[input.dataset.fdh] = input.value.trim();
    });
    return disc;
  }

  static _body(disc) {
    return { discounts: disc.discounts.filter(rule => rule.pct), discount: disc.discount, driveHints: disc.driveHints };
  }

  static _pct(value) {
    return value == null || value === '' ? 'нет' : `${FeedFmt.dec(value)} %`;
  }

  /**
   * Распределение позиций по правилам.
   * @param {object} plan
   * @returns {string}
   */
  static plan(plan) {
    const rows = plan.groups
      .map(
        group =>
          `<tr><td>${esc(group.label)}</td><td class="num">${this._pct(group.pct)}</td><td class="num">${Fmt.num(group.count)}</td><td class="muted">${esc(group.sample.slice(0, this.SAMPLE).join(' · '))}${group.count > this.SAMPLE ? ' …' : ''}</td></tr>`,
      )
      .join('');
    return `<div class="fd-tw"><table class="fd-t"><thead><tr><th>Правило</th><th class="num">Скидка</th><th class="num">Позиций</th><th>Например</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${plan.unknownCount ? `<details class="more"><summary class="bad-t">Не распознано: ${Fmt.num(plan.unknownCount)} — получат скидку «остальное»</summary><p class="muted">${plan.unknown.map(entry => `${esc(entry.name)} <small>(${esc(entry.why)})</small>`).join(' · ')}</p><p class="muted">Добавьте серию в поле «Серии с ременным / прямым приводом» или укажите привод и мощность в карточке позиции.</p></details>` : ''}
    ${plan.manual ? `<p class="muted">Закупка исправлена вручную у ${Fmt.num(plan.manual)} ${plural(plan.manual, 'позиции', 'позиций', 'позиций')} — её сетка не меняет.</p>` : ''}
    ${plan.noprice ? `<p class="muted">Пока без цены: ${Fmt.num(plan.noprice)} ${plural(plan.noprice, 'позиция', 'позиции', 'позиций')} — закупка появится после «Сохранить и обновить цены», если в прайсе есть цена.</p>` : ''}`;
  }

  /**
   * Кнопки сетки.
   * @param {string} action
   * @param {HTMLButtonElement} button
   * @param {HTMLElement} main
   * @returns {Promise<*>}
   */
  static async click(action, button, main) {
    const feed = (await AdminApi.get('feeds')).items.find(entry => entry.id === FeedState.sel);
    if (!feed) return undefined;
    const ctx = { feed, button, main, disc: this.read(main) || this.of(feed) };
    if (action !== 'discadd' && action !== 'discdel' && ctx.disc.discounts.some(rule => !rule.pct)) {
      toast('У каждого правила укажите скидку, % (или удалите правило)');
      return undefined;
    }
    const method = this.ACTIONS[action];
    return method ? this[method](ctx) : undefined;
  }

  static _redraw({ main, feed }) {
    const box = main.querySelector('#fdDisc');
    if (box) box.innerHTML = this.html(feed);
  }

  static _add(ctx) {
    ctx.disc.discounts.push({ label: '', cats: [], drive: 'any', kwMax: null, pct: null });
    this._redraw(ctx);
  }

  static _drop(ctx) {
    ctx.disc.discounts.splice(+ctx.button.dataset.i, 1);
    this._redraw(ctx);
  }

  static async _plan(ctx) {
    ctx.button.disabled = true;
    ctx.button.textContent = 'Считаю…';
    FeedState.plan = {
      ...(await AdminApi.post(`feeds/${FeedState.sel}/discounts`, this._body(ctx.disc))),
      id: FeedState.sel,
    };
    this._redraw(ctx);
  }

  static async _store(ctx) {
    await AdminApi.post('feeds', { ...ctx.feed, ...this._body(ctx.disc) });
    FeedState.disc = null;
  }

  static async _save(ctx) {
    await this._store(ctx);
    toast('Сетка скидок сохранена');
    FeedState.plan = null;
    return FeedsTab.render(ctx.main);
  }

  static async _apply(ctx) {
    await this._store(ctx);
    await AdminApi.post(`feeds/${FeedState.sel}/check`);
    toast('Сетка сохранена, обновляю цены по прайсу');
    FeedState.plan = null;
    return FeedsTab.render(ctx.main);
  }
}
