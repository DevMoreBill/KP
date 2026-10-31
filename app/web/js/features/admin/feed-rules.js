import { FeedState } from './feed-state.js';
import { FeedsTab } from './feeds-tab.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Modal } from '../../core/modal.js';
import { Toast } from '../../core/toast.js';
import { DefRegistry } from '../../core/defaults.js';
import { esc } from '../../core/util.js';
import { Fmt, Str } from '../../core/str.js';
import { AdminApi } from '../../core/admin-api.js';
import { AdminDialog } from '../../core/admin-dialog.js';
import { Currency } from '../../core/currency.js';

/** Удаление позиций, загруженных фидом: все или одной категории фида — в корзину; «не загружать снова» (feeds.FeedPurge). */
export class FeedPurgeUi {
  static SAMPLE = 6;
  static TRASH_DAYS = 30;

  /**
   * Строка кнопок в разделе «Позиции фида».
   * @param {object} feed
   * @returns {string}
   */
  static row(feed) {
    return `<div class="row fd-acts fd-purge"><button class="btn ghost danger" type="button" data-fd="purge"${feed.linked ? '' : ' disabled title="В каталоге нет позиций этого фида"'}>Удалить позиции фида…</button>
      ${feed.excluded ? `<span class="muted">Удалено и не загружается снова: ${Fmt.num(feed.excluded)}</span><button class="btn ghost" type="button" data-fd="unblock">Вернуть в загрузку</button>` : ''}</div>`;
  }

  static _html(first) {
    const cats = first.cats
      .map(cat => `<option value="${esc(cat.cat)}">${esc(cat.title)} — ${Fmt.num(cat.n)}</option>`)
      .join('');
    return `<div class="dlg-h"><h3>Удалить позиции фида</h3><button class="icon" type="button" data-fp="x" aria-label="Закрыть">✕</button></div>
      <label class="f"><span>Что удалить</span><select data-fp="cat"><option value="">Все позиции фида — ${Fmt.num(first.total)}</option>${cats}</select></label>
      <p class="muted" data-fp="info"></p>
      <p><label class="chk-chip"><input type="checkbox" data-fp="block" checked> Не загружать их снова при следующей загрузке фида</label></p>
      <p class="muted">Позиции уйдут в корзину («Обслуживание → Корзина»), восстановить можно ${DefRegistry.num('srv.trashDays', this.TRASH_DAYS)} дн. КП, в которых они уже есть, не меняются.</p>
      <div class="row"><button class="btn danger-bg" type="button" data-fp="go">Удалить в корзину</button><button class="btn ghost" type="button" data-fp="x">Отмена</button></div>`;
  }

  /**
   * Окно удаления.
   * @param {string} feedId
   * @param {HTMLElement} main вкладка фидов
   */
  static async open(feedId, main) {
    const first = await AdminApi.post(`feeds/${feedId}/purge`, { preview: true });
    if (!first.total) {
      Toast.show('В каталоге нет позиций этого фида');
      return;
    }
    const dialog = new Modal(this._html(first), 'fp-dlg');
    const state = { feedId, main, dialog, current: first };
    this._info(state);
    dialog.$('[data-fp=cat]').onchange = async event => {
      try {
        state.current = await AdminApi.post(`feeds/${feedId}/purge`, { preview: true, cat: event.target.value });
      } catch (error) {
        Toast.show(error.message || String(error));
        return;
      }
      this._info(state);
    };
    dialog.d.addEventListener('click', event => this._click(state, event));
  }

  static _info({ dialog, current }) {
    const sample = current.sample.length
      ? ` — ${current.sample.slice(0, this.SAMPLE).map(esc).join(' · ')}${current.picked > this.SAMPLE ? ' …' : ''}`
      : '';
    dialog.$('[data-fp=info]').innerHTML = `Будет удалено: <b>${Fmt.num(current.picked)}</b>${sample}`;
  }

  static async _click({ feedId, main, dialog, current }, event) {
    const action = event.target.closest('[data-fp]')?.dataset.fp;
    if (action === 'x') {
      dialog.close();
      return;
    }
    if (action !== 'go') return;
    const cat = dialog.$('[data-fp=cat]').value;
    const block = dialog.$('[data-fp=block]').checked;
    const text = `Позиции фида уйдут в корзину${block ? ' и больше не будут загружаться из фида (вернуть — «Вернуть в загрузку»)' : ''}.`;
    if (!(await AdminDialog.confirm(`Удалить ${Fmt.num(current.picked)} поз.?`, text, 'Удалить'))) return;
    event.target.disabled = true;
    try {
      const reply = await AdminApi.post(`feeds/${feedId}/purge`, { cat, block });
      dialog.close();
      Toast.show(`Удалено в корзину: ${Fmt.num(reply.deleted)}`);
      Catalog.refresh();
      FeedsTab.render(main);
    } catch (error) {
      event.target.disabled = false;
      Toast.show(error.message || String(error));
    }
  }
}

/** «Что загружать» (feeds.FeedRules): отбор предложений фида, поля обновления и план «Что загрузится…». */
export class FeedRulesUi {
  static FIELDS = [
    ['name', 'Название'],
    ['desc', 'Описание'],
    ['photo', 'Фото'],
    ['params', 'Характеристики'],
    ['cat', 'Категория'],
    ['price', 'Цены (РРЦ, закупка)'],
    ['stock', 'Наличие'],
  ];
  static STATUS = { add: 'Добавится', update: 'Изменится', same: 'Без изменений', skip: 'Пропущено' };
  static SHOWN = 1500;

  /**
   * Отбор и поля обновления фида.
   * @param {object} feed
   * @returns {{rules: object, fields: object}}
   */
  static rules(feed) {
    const fields = feed.fields || {};
    return {
      rules: feed.filter || {},
      fields: Object.fromEntries(this.FIELDS.map(([key]) => [key, fields[key] !== false])),
    };
  }

  /**
   * Итог одной строкой (в заголовке раздела).
   * @param {object} feed
   * @returns {string}
   */
  static sum(feed) {
    const { rules, fields } = this.rules(feed);
    const off = this.FIELDS.filter(([key]) => !fields[key]).map(([, label]) => label.toLowerCase());
    const picked = [
      rules.brands && rules.brands.length ? `марки: ${rules.brands.length}` : '',
      rules.words ? 'слова' : '',
      rules.stop ? 'стоп-слова' : '',
      rules.priceMin != null || rules.priceMax != null ? 'цена' : '',
      rules.avail ? 'в наличии' : '',
      rules.priced ? 'с ценой' : '',
      rules.add === false ? 'новые не создаются' : '',
    ].filter(Boolean);
    return (
      (picked.length ? `отбор: ${picked.join(', ')}` : 'загружается всё') +
      (off.length ? ` · не обновлять: ${off.join(', ')}` : '')
    );
  }

  static _check(attr, label, value, hint = '') {
    return `<label class="cx-ck"${hint ? ` title="${esc(hint)}"` : ''}><input type="checkbox" ${attr}${value ? ' checked' : ''}> ${esc(label)}</label>`;
  }

  static _brands(rules, plan) {
    const brands = plan ? plan.brands : (rules.brands || []).map(brand => [brand, null]);
    const picked = new Set((rules.brands || []).map(brand => Str.norm(brand)));
    const list = brands.length
      ? `<div class="fr-brands">${brands.map(([brand, count]) => this._check(`data-frb="${esc(brand)}"`, brand + (count != null ? ` · ${count}` : ''), picked.has(Str.norm(brand)))).join('')}</div>`
      : '';
    return `<div class="fr-g"><span class="fr-l">Марки</span><div>${list}
        <p class="muted" style="margin:4px 0 0">${picked.size ? 'Загружаются только отмеченные марки.' : 'Не отмечено ничего — загружаются все марки.'}${plan ? '' : ' Список марок фида — после «Что загрузится…».'}</p></div></div>`;
  }

  /**
   * Форма «Что загружать».
   * @param {object} feed
   * @returns {string}
   */
  static html(feed) {
    const { rules, fields } = this.rules(feed);
    const plan = FeedState.rplan && FeedState.rplan.id === feed.id ? FeedState.rplan : null;
    return `<div class="fr" data-frform>
      ${this._brands(rules, plan)}
      <div class="fr-g"><span class="fr-l">Название</span><div class="fr-row"><input type="text" data-frf="words" value="${esc(rules.words || '')}" placeholder="загружать, если есть слово: компрессор, осушитель" aria-label="Слова в названии">
        <input type="text" data-frf="stop" value="${esc(rules.stop || '')}" placeholder="не загружать, если есть: б/у, уценка" aria-label="Стоп-слова"></div></div>
      <div class="fr-g"><span class="fr-l">Цена и наличие</span><div class="fr-row"><input class="fr-n" type="text" inputmode="decimal" data-frf="priceMin" value="${esc(rules.priceMin ?? '')}" placeholder="цена от" aria-label="Цена от"><input class="fr-n" type="text" inputmode="decimal" data-frf="priceMax" value="${esc(rules.priceMax ?? '')}" placeholder="до" aria-label="Цена до">
        ${this._check('data-frc="priced"', 'Только с ценой', rules.priced)}${this._check('data-frc="avail"', 'Только в наличии', rules.avail)}${this._check('data-frc="add"', 'Создавать новые позиции', rules.add !== false, 'Выключено — фид только обновляет уже загруженные позиции')}</div></div>
      <div class="fr-g"><span class="fr-l">Обновлять у загруженных</span><div class="fr-row">${this.FIELDS.map(([key, label]) => this._check(`data-frx="${key}"`, label, fields[key])).join('')}</div></div>
      <p class="muted">Категории фида («не загружать» или своя категория) — после «Проверить фид». Новые позиции создаются целиком; выключенные поля у загруженных остаются как в каталоге — и при ежедневной проверке цен и наличия. Ручные правки фид не затирает в любом случае.</p>
      <div class="row fd-fb"><button class="btn" type="button" data-fd="rsave">Сохранить</button><button class="btn primary" type="button" data-fd="rplan">Что загрузится…</button></div>
      <div id="frPlan">${plan ? this.plan(plan) : ''}</div></div>`;
  }

  /**
   * Прочитать форму.
   * @param {HTMLElement} box
   * @returns {{filter: object, fields: object}}
   */
  static read(box) {
    const value = key => (box.querySelector(`[data-frf="${key}"]`) || {}).value || '';
    const checked = key => !!box.querySelector(`[data-frc="${key}"]`)?.checked;
    const brands = [...box.querySelectorAll('[data-frb]')]
      .filter(input => input.checked)
      .map(input => input.dataset.frb);
    return {
      filter: {
        brands,
        words: value('words'),
        stop: value('stop'),
        priceMin: value('priceMin'),
        priceMax: value('priceMax'),
        priced: checked('priced'),
        avail: checked('avail'),
        add: checked('add'),
      },
      fields: Object.fromEntries(
        this.FIELDS.map(([key]) => [key, !!box.querySelector(`[data-frx="${key}"]`)?.checked]),
      ),
    };
  }

  static _pickable(row) {
    return row.status === 'add' || row.status === 'update';
  }

  static _box(row) {
    if (!this._pickable(row)) return '';
    const checked = FeedState.roff.has(row.oid) ? '' : ' checked';
    return `<input type="checkbox" data-rpo="${esc(row.oid)}"${checked} aria-label="Загрузить">`;
  }

  static _planRow(row) {
    const price =
      row.price != null ? `${Fmt.num(Math.round(row.price))} ${esc(Currency.short(row.cur || 'RUB'))}` : '—';
    return `<tr class="${row.status}"><td class="c">${this._box(row)}</td><td>${esc(row.name)}${row.feedCat ? `<br><small class="muted">${esc(row.feedCat)}</small>` : ''}</td><td>${esc(row.maker || '')}</td><td>${esc(row.cat || '')}</td>
          <td class="num">${price}</td><td><span class="fr-st ${row.status}">${this.STATUS[row.status]}</span>${row.changes && row.changes.length ? `<br><small class="muted">${esc(row.changes.join(', '))}</small>` : ''}${row.why ? `<br><small class="muted">${esc(row.why)}</small>` : ''}</td></tr>`;
  }

  /**
   * План «Что загрузится…».
   * @param {object} plan
   * @returns {string}
   */
  static plan(plan) {
    const counts = plan.counts;
    const filter = FeedState.rpf;
    const rows = filter ? plan.rows.filter(row => row.status === filter) : plan.rows;
    const chip = (key, count) =>
      `<button type="button" class="chip ${key}${filter === key ? ' on' : ''}" data-rpf="${key}">${this.STATUS[key]} <b>${Fmt.num(count)}</b></button>`;
    const total = counts.add + counts.update;
    return `<div class="fr-sum">${chip('add', counts.add)}${chip('update', counts.update)}${chip('same', counts.same)}${chip('skip', counts.skip)}${filter ? '<button type="button" class="lnk" data-rpf="">все</button>' : ''}</div>
      ${plan.cut ? `<p class="muted">Показаны первые ${Fmt.num(plan.rows.length)} из ${Fmt.num(plan.total)}.</p>` : ''}
      <div class="fr-tw"><table class="pv-t fr-t"><thead><tr><th class="c"><input type="checkbox" data-rpall checked aria-label="Отметить все"></th><th>Позиция фида</th><th>Марка</th><th>Категория</th><th class="num">Цена</th><th>Что будет</th></tr></thead>
        <tbody>${
          rows
            .slice(0, this.SHOWN)
            .map(row => this._planRow(row))
            .join('') || '<tr><td colspan="6" class="muted">Нет позиций.</td></tr>'
        }</tbody></table></div>
      ${rows.length > this.SHOWN ? '<p class="muted">В таблице — первые 1 500 строк этого вида; загрузятся все отмеченные выше и все остальные этого вида.</p>' : ''}
      <div class="fr-go"><button class="btn primary" type="button" id="frGo" data-fd="rimport"${total ? '' : ' disabled'}>Загрузить отмеченное (${Fmt.num(total)})</button><span class="muted">Фото и описания со страниц товаров скачиваются при загрузке. Пропущенное и «без изменений» не трогается.</span></div>`;
  }

  /**
   * Отмеченные строки плана: все «добавится» и «изменится», кроме снятых галочек (null — всё по правилам).
   * @param {HTMLElement} main
   * @returns {string[]|null}
   */
  static only(main) {
    const plan = FeedState.rplan;
    if (!plan) return null;
    main.querySelectorAll('[data-rpo]').forEach(input => this.pick(input));
    const off = FeedState.roff;
    const all = plan.rows.filter(row => this._pickable(row)).map(row => row.oid);
    if (!off.size && !plan.cut) return null;
    return all.filter(oid => !off.has(oid));
  }

  /**
   * Запомнить галочку строки плана: отбор по виду строки перерисовывает таблицу, снятое должно остаться снятым.
   * @param {HTMLInputElement} input
   */
  static pick(input) {
    if (input.checked) FeedState.roff.delete(input.dataset.rpo);
    else FeedState.roff.add(input.dataset.rpo);
  }

  /**
   * Пересчитать кнопку «Загрузить отмеченное».
   * @param {HTMLElement} main
   */
  static count(main) {
    const plan = FeedState.rplan;
    const button = main.querySelector('#frGo');
    if (!plan || !button) return;
    const count = plan.counts.add + plan.counts.update - FeedState.roff.size;
    button.textContent = `Загрузить отмеченное (${Fmt.num(count)})`;
    button.disabled = !count;
  }
}
